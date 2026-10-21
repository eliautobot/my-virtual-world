// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice services (docs/features/CHAT.md §9): an account's or the installation's own speech service, called with its own API
// key. Runs inside the provider helper process (./host-main.mjs) like the models adapter: its environment holds none of
// the server's secrets and the key arrives with each call. Who uses which service, for whom, and what it may cost is the
// server's (server/voice/); this adapter makes the calls:
// - speak({ text, voice, model, speed, instructions, language }) → { audio (base64), mime, format, seconds, chars, ... }:
//   MP3 where the service gives it, else WAV (Groq gives WAV; Qwen streams raw PCM, made into WAV here). A service that
//   speaks only a few hundred characters a call (Groq 200, Qwen 600, Deepgram 2,000, Google 5,000 bytes) gets the text in
//   pieces cut at sentences, a few at a time, and the pieces are joined into one file in order.
// - transcribe({ audio (base64), language }) → { text, language, seconds, ... }: the recording as it came from the browser
//   (WebM/Opus, Ogg, MP4/AAC, WAV, MP3, FLAC); its format is read from its bytes. seconds is the service's own figure where
//   it gives one (the server measures the file too).
// - voices() → { voices: [{ id, label, lang?, gender?, preview? }] }: the service's own list where it has one (OpenRouter
//   by model, ElevenLabs, Google, Deepgram, xAI), else its documented built-in voices.
// - test(): the smallest real call (a word spoken, or half a second of silence heard), for Settings.
// Services (VOICE_PROVIDERS in ./manifest.js): OpenAI, OpenRouter, Groq and any OpenAI-compatible server ("custom") through
// /audio/speech and /audio/transcriptions (OpenRouter's transcription as JSON with the audio in base64); ElevenLabs,
// Google Cloud (Text-to-Speech and Speech-to-Text v1, an API key), Deepgram, xAI and Qwen (Alibaba Model Studio) through
// their own APIs. A custom server must be a public HTTPS address unless the connection is the installation's, and a Qwen
// address must be Alibaba Cloud's - both checked when the connection is used, the custom one again on every connection.
// Errors carry a code the server acts on (auth, quota, rate_limited, bad_request, unsupported, timeout, network, blocked,
// provider_error) and words of our own: a service's error text is never passed on.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { BUILTIN_MANIFESTS, VOICE_PROVIDERS } from './manifest.js';
import { privateAddress, guardedLookup } from './models.js';
import { sniff, seconds as audioSeconds, wavFromPcm, joinWav, joinMp3 } from '../voice/audio.js';

const manifest = BUILTIN_MANIFESTS.find(m => m.id === 'voice');
const MAX_TEXT = 5000;               // characters a speak call takes (the server's routes allow 4,000)
const MAX_AUDIO_IN = 25 * 1048576;   // a recording to transcribe
const MAX_AUDIO_OUT = 40 * 1048576;  // what a service may send back
const MAX_JSON = 4 * 1048576;
const PARALLEL = 4;                  // pieces of one text spoken at once
export const BASE = {   // (the tests point a service at a local fake)
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  elevenlabs: 'https://api.elevenlabs.io',
  googleTts: 'https://texttospeech.googleapis.com/v1',
  googleStt: 'https://speech.googleapis.com',
  deepgram: 'https://api.deepgram.com/v1',
  xai: 'https://api.x.ai/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com',
};
/** Characters one call takes, per service (cut at sentences below it). */
const PIECE = { openai: 4000, openrouter: 3000, groq: 190, elevenlabs: 5000, google: 1500, deepgram: 1900, xai: 10000, qwen: 550, custom: 4000 };
/** The speaking speed each service accepts (none: it has no speed). */
const SPEED = { openai: [0.25, 4], openrouter: [0.5, 2], elevenlabs: [0.7, 1.2], google: [0.25, 4], deepgram: [0.7, 1.5], xai: [0.7, 1.5], custom: [0.25, 4] };
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
/** How OpenAI's voices sound (OpenAI doesn't say; by ear, for picking a voice to suit a character - alloy is neither). */
const OPENAI_GENDER = { ash: 'male', ballad: 'male', coral: 'female', echo: 'male', fable: 'male', onyx: 'male', nova: 'female', sage: 'female', shimmer: 'female', verse: 'male', marin: 'female', cedar: 'male' };
/** Kokoro's voices are named by language, gender and name - af_heart: American English, female, Heart (hexgrad/Kokoro-82M
 *  VOICES.md). Through OpenRouter or a self-hosted Kokoro server they come as bare names: their language and gender read
 *  from the name, and a label a person can read. */
const KOKORO_LANG = { a: ['en-US', 'American English'], b: ['en-GB', 'British English'], e: ['es', 'Spanish'], f: ['fr', 'French'], h: ['hi', 'Hindi'], i: ['it', 'Italian'], j: ['ja', 'Japanese'], p: ['pt-BR', 'Brazilian Portuguese'], z: ['zh', 'Mandarin Chinese'] };
export function kokoroVoice(id) {
  const m = /^([abefhijpz])([fm])_([a-z]+)$/.exec(String(id || ''));
  if (!m) return null;
  const [lang, langName] = KOKORO_LANG[m[1]], gender = m[2] === 'f' ? 'female' : 'male';
  // (its Santa voices are for the holidays: choosable, never picked for an agent on its own - novelty)
  return { id: m[0], label: `${m[3][0].toUpperCase()}${m[3].slice(1)} - ${langName}, ${gender}`, lang, gender, ...(m[3] === 'santa' ? { novelty: true } : {}) };
}
const described = v => kokoroVoice(v.id) || v;
const GROQ_VOICES = {
  'canopylabs/orpheus-v1-english': [['autumn', 'Autumn', 'female'], ['diana', 'Diana', 'female'], ['hannah', 'Hannah', 'female'], ['austin', 'Austin', 'male'], ['daniel', 'Daniel', 'male'], ['troy', 'Troy', 'male']],
  'canopylabs/orpheus-arabic-saudi': [['abdullah', 'Abdullah', 'male'], ['fahad', 'Fahad', 'male'], ['sultan', 'Sultan', 'male'], ['lulwa', 'Lulwa', 'female'], ['noura', 'Noura', 'female'], ['aisha', 'Aisha', 'female']],
};
const QWEN_VOICES = [['Cherry', 'Cherry - sunny, friendly young woman', 'female'], ['Ethan', 'Ethan - warm, energetic', 'male'], ['Jennifer', 'Jennifer - cinematic American English', 'female'],
  ['Ryan', 'Ryan - rhythmic, dramatic', 'male'], ['Katerina', 'Katerina - mature, rich rhythm', 'female'], ['Elias', 'Elias - clear, storytelling', 'female'], ['Nofish', 'Nofish - a designer, playful', 'male']];
const QWEN_LANG = { en: 'English', zh: 'Chinese', de: 'German', it: 'Italian', pt: 'Portuguese', es: 'Spanish', ja: 'Japanese', ko: 'Korean', fr: 'French', ru: 'Russian' };
const GOOGLE_LANG = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'cmn-Hans-CN', ru: 'ru-RU', ar: 'ar-XA', hi: 'hi-IN', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR', sv: 'sv-SE' };
/** OpenRouter's names for a recording's format. */
const OR_FORMAT = { wav: 'wav', mp3: 'mp3', flac: 'flac', mp4: 'm4a', ogg: 'ogg', webm: 'webm', aac: 'aac' };

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const num = v => (Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------ where
/** The service, its key and where its API is. */
function target(p) {
  const c = p.config || {}, provider = c.provider || 'openai', def = VOICE_PROVIDERS[provider];
  if (!def) throw fail('bad_request', 'Unknown voice service');
  const key = p.secrets && p.secrets.apiKey;
  if (!key) throw fail('auth', 'No API key is set for this connection');
  const local = p.allowPrivate === true;   // (the server says so only for the installation's own connections)
  if (provider === 'custom') {
    let u;
    try { u = new URL(String(c.baseUrl || '')); } catch { throw fail('bad_request', 'The custom service needs a base URL'); }
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw fail('blocked', 'A custom voice service must use https');
    if (u.username || u.password) throw fail('bad_request', 'Put the key in the API key field, not in the URL');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!local && net.isIP(host) && privateAddress(host)) throw fail('blocked', 'That server is not on the public internet');
    return { provider, def, key, base: u.href.replace(/\/+$/, ''), guard: !local };
  }
  if (provider === 'qwen' && c.baseUrl) {
    // a region's or a workspace's own address - Alibaba Cloud's only (the key goes there)
    let u;
    try { u = new URL(String(c.baseUrl)); } catch { throw fail('bad_request', 'That is not a Model Studio address'); }
    if (u.protocol !== 'https:' || !/(^|\.)aliyuncs\.com$/i.test(u.hostname) || u.username || u.password) throw fail('blocked', 'A Qwen address must be an https address of Alibaba Cloud (…aliyuncs.com)');
    return { provider, def, key, base: u.origin, guard: true };
  }
  return { provider, def, key, base: provider === 'google' ? null : BASE[provider], guard: false };
}
const modelOf = (t, p, kind) => {
  const over = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : '';
  const m = over || String((p.config || {})[kind === 'speak' ? 'speakModel' : 'listenModel'] || '').trim() || t.def[kind === 'speak' ? 'speakModel' : 'listenModel'];
  if (m.length > 200 || /[\s\u0000-\u001f\u007f]/.test(m)) throw fail('bad_request', 'That is not a model name');
  return m;
};
const voiceOf = (t, p) => {
  const v = typeof p.voice === 'string' && p.voice.trim() ? p.voice.trim() : String((p.config || {}).voice || '').trim() || t.def.voice;
  if (!v || v.length > 200 || /[\u0000-\u001f\u007f/?#\\]/.test(v)) throw fail('bad_request', 'That is not a voice name');
  return v;
};
const speedOf = (t, p) => {
  const r = SPEED[t.provider], s = Number(p.speed);
  return r && Number.isFinite(s) && Math.abs(s - 1) > 0.001 ? Math.max(r[0], Math.min(r[1], s)) : null;
};
const langOf = p => (typeof p.language === 'string' && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/.test(p.language) ? p.language : '');

// ------------------------------------------------------------------ HTTP
/** One request; resolves { status, headers, body: Buffer }. body: a Buffer, or an object sent as JSON. */
function send(method, url, headers, body, { timeoutMs = 60000, guard = false, max = MAX_AUDIO_OUT, onLine = null } = {}) {
  const u = new URL(url), lib = u.protocol === 'http:' ? http : https;
  const data = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const json = data && !Buffer.isBuffer(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method, timeout: timeoutMs,
      headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(data ? { 'Content-Length': data.length } : {}), ...headers },
      ...(guard ? { lookup: guardedLookup, autoSelectFamily: false } : {}),
    }, res => {
      const chunks = []; let size = 0, buf = '';
      const sse = onLine && res.statusCode === 200 && /event-stream/i.test(String(res.headers['content-type'] || ''));
      if (sse) res.setEncoding('utf8');
      res.on('data', d => {
        size += d.length;
        if (size > max) { req.destroy(fail('provider_error', 'The service sent too much')); return; }
        if (!sse) { chunks.push(d); return; }
        buf += d;
        let i; while ((i = buf.indexOf('\n')) >= 0) { try { onLine(buf.slice(0, i).replace(/\r$/, '')); } catch (e) { req.destroy(e); return; } buf = buf.slice(i + 1); }
      });
      res.on('end', () => { if (sse && buf) { try { onLine(buf); } catch (e) { reject(e); return; } } resolve({ status: res.statusCode, headers: res.headers, body: sse ? Buffer.alloc(0) : Buffer.concat(chunks) }); });
      res.on('error', () => reject(fail('network', 'The voice service could not be reached')));
    });
    // (a deadline for the whole call, not only for silence: a slow trickle still ends)
    const cap = setTimeout(() => req.destroy(fail('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs + 1000); cap.unref?.();
    req.on('close', () => clearTimeout(cap));
    req.on('timeout', () => req.destroy(fail('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s`)));
    req.on('error', e => reject(['blocked', 'timeout', 'provider_error'].includes(e.code) ? e : fail('network', 'The voice service could not be reached')));
    if (data) req.write(data);
    req.end();
  });
}
const parse = res => { if (res.body.length > MAX_JSON) return null; try { return JSON.parse(res.body.toString('utf8')); } catch { return null; } };
/** A multipart/form-data body: fields first, the file last (xAI reads the file only after its options). */
function multipart(fields, file) {
  const b = `----mvw${crypto.randomBytes(12).toString('hex')}`, parts = [];
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}

/** The error for a service's refusal, by status and what its JSON says (never its words). */
function refusal(res, what) {
  const j = parse(res) || {};
  const flat = JSON.stringify(j).slice(0, 4000).toLowerCase();
  if (/quota_exceeded|insufficient_quota|insufficient credits|insufficient_credits|credit balance|billing/.test(flat) || res.status === 402) return fail('quota', 'The voice service account has no credit left');
  if (/api_key_invalid|api key not valid|invalid_api_key|invalid api key|unauthorized/.test(flat) || res.status === 401) return fail('auth', 'The API key was refused');
  if (res.status === 403 && /service_disabled|has not been used|is disabled/.test(flat)) return fail('bad_request', 'This API isn\'t switched on for the key\'s project - enable it in the provider\'s console');
  if (res.status === 403) return fail('auth', 'The API key may not use this service');
  if (res.status === 429 || res.status === 529) {
    const ra = Number(res.headers && res.headers['retry-after']);
    return fail('rate_limited', 'The voice service is limiting requests', { retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 300000) : 0 });
  }
  if (res.status === 404) return fail('bad_request', `${what}: not found (HTTP 404) - check the model or the voice`);
  if (res.status === 413) return fail('bad_request', 'The recording is too large for this service');
  if (res.status === 415) return fail('unsupported', 'The service doesn\'t take this recording\'s format');
  if (res.status === 400 || res.status === 422) return fail('bad_request', `${what} refused the request (HTTP ${res.status}) - check the model and the voice`);
  return fail('provider_error', `${what} failed (HTTP ${res.status})`);
}
const ok = (res, what) => { if (res.status < 200 || res.status > 299) throw refusal(res, what); return res; };
const bearer = t => ({ Authorization: `Bearer ${t.key}` });

// ------------------------------------------------------------------ text in pieces
/** The text cut into pieces of at most n characters, at sentence ends where it can, else at a comma or a space. */
export function pieces(text, n) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s ? [s] : [];
  const sentences = s.match(/[^.!?…。！？]+(?:[.!?…。！？]+["'»”)\]]*|$)\s*/g) || [s];
  const out = []; let cur = '';
  const push = x => { x = x.trim(); if (x) out.push(x); };
  for (let sen of sentences) {
    while (sen.length > n) {   // one sentence longer than a piece: at a comma, then a space, then anywhere
      const cut = sen.slice(0, n), at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '));
      const k = at > n * 0.4 ? at + 1 : (cut.lastIndexOf(' ') > n * 0.4 ? cut.lastIndexOf(' ') : n);
      push(cur); cur = '';
      push(sen.slice(0, k)); sen = sen.slice(k);
    }
    if ((cur + sen).length > n) { push(cur); cur = sen; } else cur += sen;
  }
  push(cur);
  return out;
}
/** Runs fn over the items, at most k at once, results in order. */
async function inOrder(items, k, fn) {
  const out = new Array(items.length); let next = 0, failed = null;
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => {
    while (next < items.length && !failed) { const i = next++; try { out[i] = await fn(items[i], i); } catch (e) { failed = e; } }
  }));
  if (failed) throw failed;
  return out;
}

// ------------------------------------------------------------------ speak, per service
/** One piece of speech: resolves a Buffer of audio. */
async function speakOne(t, p, text, model, voice, speed, ms) {
  const lang = langOf(p);
  switch (t.provider) {
    case 'openai': case 'openrouter': case 'groq': case 'custom': {
      const body = { model, input: text, voice, response_format: t.provider === 'groq' ? 'wav' : 'mp3',
        ...(speed !== null ? { speed } : {}),
        ...(p.instructions && (t.provider === 'openai' || t.provider === 'openrouter') ? { instructions: String(p.instructions).slice(0, 1000) } : {}) };
      return ok(await send('POST', `${t.base}/audio/speech`, { ...bearer(t), Accept: 'audio/*' }, body, { timeoutMs: ms, guard: t.guard }), 'The voice service').body;
    }
    case 'elevenlabs': {
      const body = { text, model_id: model, ...(speed !== null ? { voice_settings: { speed } } : {}), ...(lang && !/multilingual_v2/.test(model) ? { language_code: lang.slice(0, 2).toLowerCase() } : {}) };
      return ok(await send('POST', `${t.base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { 'xi-api-key': t.key, Accept: 'audio/mpeg' }, body, { timeoutMs: ms }), 'ElevenLabs').body;
    }
    case 'google': {
      const lc = /^([a-z]{2,3}-[A-Z]{2})-/.exec(voice)?.[1] || (lang.includes('-') ? lang : GOOGLE_LANG[lang.slice(0, 2)] || 'en-US');
      const body = { input: { text }, voice: { languageCode: lc, name: voice }, audioConfig: { audioEncoding: 'MP3', ...(speed !== null ? { speakingRate: speed } : {}) } };
      const res = ok(await send('POST', `${BASE.googleTts}/text:synthesize`, { 'X-Goog-Api-Key': t.key }, body, { timeoutMs: ms }), 'Google Text-to-Speech');
      const j = parse(res);
      if (!j || typeof j.audioContent !== 'string') throw fail('provider_error', 'Google answered without audio');
      return Buffer.from(j.audioContent, 'base64');
    }
    case 'deepgram': {
      const q = new URLSearchParams({ model: voice, encoding: 'mp3', ...(speed !== null ? { speed: String(speed) } : {}) });
      return ok(await send('POST', `${t.base}/speak?${q}`, { Authorization: `Token ${t.key}`, Accept: 'audio/mpeg' }, { text }, { timeoutMs: ms }), 'Deepgram').body;
    }
    case 'xai': {
      const body = { text, voice_id: voice, language: lang || 'auto', ...(speed !== null ? { speed } : {}) };
      return ok(await send('POST', `${t.base}/tts`, { ...bearer(t), Accept: 'audio/mpeg' }, body, { timeoutMs: ms }), 'xAI').body;
    }
    case 'qwen': {
      // streamed: base64 pieces of 16-bit PCM at 24 kHz (the non-streamed answer is a link to a file elsewhere)
      const pcm = []; let err = null;
      const body = { model, input: { text, voice, language_type: QWEN_LANG[lang.slice(0, 2).toLowerCase()] || 'Auto' } };
      const res = await send('POST', `${t.base}/api/v1/services/aigc/multimodal-generation/generation`, { ...bearer(t), 'X-DashScope-SSE': 'enable', Accept: 'text/event-stream' }, body, {
        timeoutMs: ms, guard: t.guard,
        onLine: l => {
          if (!l.startsWith('data:')) return;
          let j; try { j = JSON.parse(l.slice(5).trim()); } catch { return; }
          if (j.code && !err) err = fail(/Arrearage|quota|Insufficient/i.test(j.code) ? 'quota' : /InvalidApiKey|Unauthorized/i.test(j.code) ? 'auth' : /Throttl|RateQuota/i.test(j.code) ? 'rate_limited' : 'bad_request', 'Qwen refused the request - check the model and the voice');
          const d = j.output && j.output.audio && j.output.audio.data;
          if (typeof d === 'string' && d) pcm.push(Buffer.from(d, 'base64'));
        } });
      ok(res, 'Qwen');
      if (err) throw err;
      if (!pcm.length) throw fail('provider_error', 'Qwen answered without audio');
      return wavFromPcm(Buffer.concat(pcm), { rate: 24000, channels: 1, bits: 16 });
    }
    default: throw fail('unsupported', 'This service doesn\'t speak');
  }
}

/** p: { config, secrets, allowPrivate, text, voice?, model?, speed?, instructions?, language?, timeoutMs? } */
async function speak(p) {
  const t = target(p);
  if (!t.def.speak) throw fail('unsupported', `${t.def.label} doesn't speak`);
  const text = String(p.text || '').trim();
  if (!text) throw fail('bad_request', 'Nothing to say');
  if (text.length > MAX_TEXT) throw fail('bad_request', `At most ${MAX_TEXT} characters at a time`);
  const model = modelOf(t, p, 'speak'), voice = voiceOf(t, p), speed = speedOf(t, p);
  const ms = Math.max(2000, Math.min(120000, Number(p.timeoutMs) || 60000)), t0 = Date.now();
  const list = pieces(text, PIECE[t.provider] || 4000);
  const bufs = await inOrder(list, PARALLEL, x => speakOne(t, p, x, model, voice, speed, ms));
  const kinds = bufs.map(b => sniff(b));
  if (kinds.some(k => !k)) throw fail('provider_error', 'The voice service sent something that isn\'t audio');
  const format = kinds[0].format;
  if (kinds.some(k => k.format !== format)) throw fail('provider_error', 'The voice service sent pieces in different formats');
  const audio = bufs.length === 1 ? bufs[0] : format === 'wav' ? joinWav(bufs) : format === 'mp3' ? joinMp3(bufs) : null;
  if (!audio) throw fail('provider_error', 'The voice service\'s pieces could not be joined');
  return { audio: audio.toString('base64'), mime: kinds[0].mime, format, bytes: audio.length, seconds: num(audioSeconds(audio, format)),
    chars: text.length, pieces: list.length, model: t.provider === 'deepgram' ? voice : model, voice, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------ transcribe, per service
/** p: { config, secrets, allowPrivate, audio (base64), language?, model?, timeoutMs? } */
async function transcribe(p) {
  const t = target(p);
  if (!t.def.listen) throw fail('unsupported', `${t.def.label} doesn't listen`);
  const audio = typeof p.audio === 'string' ? Buffer.from(p.audio, 'base64') : null;
  if (!audio || audio.length < 64) throw fail('bad_request', 'Nothing to hear');
  if (audio.length > MAX_AUDIO_IN) throw fail('bad_request', 'The recording is too large');
  const kind = sniff(audio);
  if (!kind) throw fail('unsupported', 'That recording\'s format isn\'t one a voice service takes (WebM, Ogg, MP4, WAV, MP3 or FLAC)');
  const model = modelOf(t, p, 'listen'), lang = langOf(p);
  const ms = Math.max(2000, Math.min(120000, Number(p.timeoutMs) || 60000)), t0 = Date.now();
  const file = { name: `audio.${kind.format === 'mp4' ? 'm4a' : kind.format}`, mime: kind.mime, data: audio };
  let text = '', language = null, secs = null, costUsd = null;
  switch (t.provider) {
    case 'openai': case 'groq': case 'custom': {
      // verbose_json says how long the recording was; OpenAI's gpt-4o transcribers answer json only
      const verbose = t.provider === 'groq' || (t.provider === 'openai' && /^whisper/.test(model));
      const m = multipart({ model, ...(lang ? { language: lang.slice(0, 2).toLowerCase() } : {}), response_format: verbose ? 'verbose_json' : 'json', temperature: '0' }, file);
      const j = parse(ok(await send('POST', `${t.base}/audio/transcriptions`, { ...bearer(t), 'Content-Type': m.type, Accept: 'application/json' }, m.body, { timeoutMs: ms, guard: t.guard, max: MAX_JSON }), 'The voice service'));
      if (!j || typeof j.text !== 'string') throw fail('provider_error', 'The voice service answered without text');
      text = j.text; language = j.language || null; secs = num(Number(j.duration)) ?? num(Number(j.usage && j.usage.seconds));
      break;
    }
    case 'openrouter': {
      const body = { model, input_audio: { data: audio.toString('base64'), format: OR_FORMAT[kind.format] || kind.format }, ...(lang ? { language: lang.slice(0, 2).toLowerCase() } : {}) };
      const j = parse(ok(await send('POST', `${t.base}/audio/transcriptions`, { ...bearer(t), Accept: 'application/json' }, body, { timeoutMs: ms, max: MAX_JSON }), 'OpenRouter'));
      if (!j || typeof j.text !== 'string') throw fail('provider_error', 'OpenRouter answered without text');
      text = j.text; language = j.language || null; secs = num(Number(j.usage && j.usage.seconds)) ?? num(Number(j.duration)); costUsd = num(Number(j.usage && j.usage.cost));
      break;
    }
    case 'elevenlabs': {
      const m = multipart({ model_id: model, ...(lang ? { language_code: lang.slice(0, 2).toLowerCase() } : {}), tag_audio_events: 'false' }, file);
      const j = parse(ok(await send('POST', `${t.base}/v1/speech-to-text`, { 'xi-api-key': t.key, 'Content-Type': m.type, Accept: 'application/json' }, m.body, { timeoutMs: ms, max: MAX_JSON }), 'ElevenLabs'));
      if (!j || typeof j.text !== 'string') throw fail('provider_error', 'ElevenLabs answered without text');
      const words = Array.isArray(j.words) ? j.words : [];
      text = j.text; language = j.language_code || null; secs = num(Number(j.audio_duration_secs)) ?? num(Number(words.length ? words[words.length - 1].end : NaN));
      break;
    }
    case 'google': {
      // synchronous recognition: up to a minute; WebM/Ogg Opus at 48 kHz from a browser, WAV/FLAC by their headers,
      // MP3 through v1p1beta1 (its only home); MP4/AAC isn't taken
      const measured = audioSeconds(audio, kind.format);
      if (measured !== null && measured > 59) throw fail('unsupported', 'Google listens to at most a minute at a time here; speak in shorter turns or choose another listening service');
      const enc = { webm: ['WEBM_OPUS', 48000], ogg: ['OGG_OPUS', 48000], wav: [null], flac: [null], mp3: ['MP3', mp3Rate(audio)] }[kind.format];
      if (!enc) throw fail('unsupported', 'Google doesn\'t take this recording\'s format (MP4/AAC); choose another listening service');
      const lc = lang.includes('-') ? lang : GOOGLE_LANG[lang.slice(0, 2).toLowerCase()] || 'en-US';
      const config = { languageCode: lc, enableAutomaticPunctuation: true, ...(enc[0] ? { encoding: enc[0], sampleRateHertz: enc[1] } : {}), ...(model ? { model } : {}) };
      const res = ok(await send('POST', `${BASE.googleStt}/${kind.format === 'mp3' ? 'v1p1beta1' : 'v1'}/speech:recognize`, { 'X-Goog-Api-Key': t.key }, { config, audio: { content: audio.toString('base64') } }, { timeoutMs: ms, max: MAX_JSON }), 'Google Speech-to-Text');
      const j = parse(res);
      if (!j) throw fail('provider_error', 'Google answered without a result');
      const results = Array.isArray(j.results) ? j.results : [];
      text = results.map(r => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '').join(' ').replace(/\s+/g, ' ').trim();
      language = results.find(r => r.languageCode)?.languageCode || lc;
      secs = /^\d+(\.\d+)?s$/.test(String(j.totalBilledTime || '')) ? Number(String(j.totalBilledTime).slice(0, -1)) : null;
      break;
    }
    case 'deepgram': {
      const q = new URLSearchParams({ model, smart_format: 'true', ...(lang ? { language: lang } : { detect_language: 'true' }) });
      const j = parse(ok(await send('POST', `${t.base}/listen?${q}`, { Authorization: `Token ${t.key}`, 'Content-Type': kind.mime, Accept: 'application/json' }, audio, { timeoutMs: ms, max: MAX_JSON }), 'Deepgram'));
      const ch = j && j.results && Array.isArray(j.results.channels) ? j.results.channels[0] : null;
      if (!ch || !Array.isArray(ch.alternatives)) throw fail('provider_error', 'Deepgram answered without text');
      text = (ch.alternatives[0] && ch.alternatives[0].transcript) || ''; language = ch.detected_language || lang || null; secs = num(Number(j.metadata && j.metadata.duration));
      break;
    }
    case 'xai': {
      const m = multipart({ model, ...(lang ? { language: lang } : {}) }, file);
      const j = parse(ok(await send('POST', `${t.base}/stt`, { ...bearer(t), 'Content-Type': m.type, Accept: 'application/json' }, m.body, { timeoutMs: ms, max: MAX_JSON }), 'xAI'));
      if (!j || typeof j.text !== 'string') throw fail('provider_error', 'xAI answered without text');
      text = j.text; language = j.language || null; secs = num(Number(j.duration));
      break;
    }
    case 'qwen': {
      if (audio.length > 7 * 1048576) throw fail('bad_request', 'Qwen hears recordings of at most 7 MB; speak in shorter turns');
      const body = { model, stream: false, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${kind.mime};base64,${audio.toString('base64')}` } }] }],
        asr_options: { enable_itn: true, ...(lang ? { language: lang.slice(0, 2).toLowerCase() } : {}) } };
      const j = parse(ok(await send('POST', `${t.base}/compatible-mode/v1/chat/completions`, { ...bearer(t), Accept: 'application/json' }, body, { timeoutMs: ms, guard: t.guard, max: MAX_JSON }), 'Qwen'));
      const msg = j && Array.isArray(j.choices) && j.choices[0] ? j.choices[0].message : null;
      if (!msg || typeof msg.content !== 'string') throw fail('provider_error', 'Qwen answered without text');
      text = msg.content; secs = num(Number(j.usage && j.usage.seconds));
      language = (Array.isArray(msg.annotations) && msg.annotations.find(a => a && a.language)?.language) || null;
      break;
    }
    default: throw fail('unsupported', 'This service doesn\'t listen');
  }
  return { text: String(text).trim().slice(0, 20000), language: language ? String(language).slice(0, 20) : null, seconds: secs, measured: num(audioSeconds(audio, kind.format)),
    format: kind.format, model, ms: Date.now() - t0, costUsd };
}
/** An MP3's sample rate (its first frame's). */
function mp3Rate(buf) {
  let p = buf.toString('latin1', 0, 3) === 'ID3' && buf.length > 10 ? 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)) : 0;
  for (; p + 4 <= buf.length; p++) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[p + 1] >> 3) & 3, ri = (buf[p + 2] >> 2) & 3;
    const r = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver];
    if (r && ri < 3) return r[ri];
  }
  return 44100;
}

// ------------------------------------------------------------------ voices
const fixed = list => list.map(([id, label, gender]) => ({ id, label, ...(gender ? { gender } : {}) }));
async function voices(p) {
  const t = target(p);
  const s = v => String(v ?? '').slice(0, 120);
  switch (t.provider) {
    case 'openai': return { voices: OPENAI_VOICES.map(v => ({ id: v, label: v[0].toUpperCase() + v.slice(1), ...(OPENAI_GENDER[v] ? { gender: OPENAI_GENDER[v] } : {}) })) };
    case 'groq': { const m = modelOf(t, p, 'speak'); return { voices: fixed(GROQ_VOICES[m] || GROQ_VOICES['canopylabs/orpheus-v1-english']) }; }
    case 'qwen': return { voices: fixed(QWEN_VOICES) };
    case 'openrouter': {
      // the speaking models and each one's voices (their supported_voices)
      const j = parse(ok(await send('GET', `${t.base}/models?output_modalities=speech`, { ...bearer(t), Accept: 'application/json' }, null, { timeoutMs: 15000, max: MAX_JSON }), 'OpenRouter'));
      const list = j && Array.isArray(j.data) ? j.data : [];
      const model = modelOf(t, p, 'speak'), m = list.find(x => x && x.id === model);
      const vs = m && Array.isArray(m.supported_voices) ? m.supported_voices : [];
      return { voices: vs.slice(0, 400).map(v => (typeof v === 'string' ? { id: s(v), label: s(v) } : { id: s(v.id || v.name), label: s(v.name || v.id) })).filter(v => v.id).map(described),
        models: list.slice(0, 200).map(x => ({ id: s(x.id), label: s(x.name || x.id), ...(Number.isFinite(Number(x.pricing && x.pricing.prompt)) ? { pricePerMChars: Math.round(Number(x.pricing.prompt) * 1e8) / 100 } : {}) })) };
    }
    case 'elevenlabs': {
      const j = parse(ok(await send('GET', `${t.base}/v2/voices?page_size=100`, { 'xi-api-key': t.key, Accept: 'application/json' }, null, { timeoutMs: 15000, max: MAX_JSON }), 'ElevenLabs'));
      return { voices: (j && Array.isArray(j.voices) ? j.voices : []).slice(0, 300).map(v => ({ id: s(v.voice_id), label: s(v.name || v.voice_id),
        ...(v.labels && v.labels.gender ? { gender: s(v.labels.gender) } : {}), ...(v.labels && (v.labels.language || v.labels.accent) ? { lang: s(v.labels.language || v.labels.accent) } : {}),
        ...(typeof v.preview_url === 'string' && /^https:\/\//.test(v.preview_url) ? { preview: v.preview_url.slice(0, 400) } : {}) })).filter(v => v.id) };
    }
    case 'google': {
      const lang = langOf(p);
      const j = parse(ok(await send('GET', `${BASE.googleTts}/voices${lang ? `?languageCode=${encodeURIComponent(lang)}` : ''}`, { 'X-Goog-Api-Key': t.key, Accept: 'application/json' }, null, { timeoutMs: 15000, max: MAX_JSON }), 'Google Text-to-Speech'));
      return { voices: (j && Array.isArray(j.voices) ? j.voices : []).slice(0, 600).map(v => ({ id: s(v.name), label: s(v.name), lang: s((v.languageCodes || [])[0]),
        ...(v.ssmlGender ? { gender: s(v.ssmlGender).toLowerCase() } : {}) })).filter(v => v.id) };
    }
    case 'deepgram': {
      const j = parse(ok(await send('GET', `${t.base}/models`, { Authorization: `Token ${t.key}`, Accept: 'application/json' }, null, { timeoutMs: 15000, max: MAX_JSON }), 'Deepgram'));
      return { voices: (j && Array.isArray(j.tts) ? j.tts : []).slice(0, 300).map(v => ({ id: s(v.canonical_name || v.name), label: s(v.name ? v.name[0].toUpperCase() + v.name.slice(1) : v.canonical_name),
        lang: s((v.languages || [])[0]), ...(v.metadata && typeof v.metadata.sample === 'string' && /^https:\/\//.test(v.metadata.sample) ? { preview: v.metadata.sample.slice(0, 400) } : {}) })).filter(v => v.id) };
    }
    case 'xai': {
      const j = parse(ok(await send('GET', `${t.base}/tts/voices`, { ...bearer(t), Accept: 'application/json' }, null, { timeoutMs: 15000, max: MAX_JSON }), 'xAI'));
      return { voices: (j && Array.isArray(j.voices) ? j.voices : []).slice(0, 300).map(v => ({ id: s(v.voice_id), label: s(v.name || v.voice_id), ...(v.gender ? { gender: s(v.gender) } : {}) })).filter(v => v.id) };
    }
    case 'custom': {
      // an OpenAI-compatible server may list its voices (Kokoro, Speaches: /audio/voices); otherwise the configured one
      try {
        const res = await send('GET', `${t.base}/audio/voices`, { ...bearer(t), Accept: 'application/json' }, null, { timeoutMs: 8000, guard: t.guard, max: MAX_JSON });
        const j = res.status === 200 ? parse(res) : null;
        const list = j && (Array.isArray(j.voices) ? j.voices : Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : null);
        if (list && list.length) return { voices: list.slice(0, 400).map(v => (typeof v === 'string' ? { id: s(v), label: s(v) } : { id: s(v.id || v.voice_id || v.name), label: s(v.name || v.id) })).filter(v => v.id).map(described) };
      } catch (e) { if (e.code === 'blocked') throw e; }
      return { voices: [{ id: voiceOf(t, p), label: voiceOf(t, p) }] };
    }
    default: return { voices: [] };
  }
}

/** Half a second of silence (16 kHz mono), for a listening test. */
const SILENCE = () => wavFromPcm(Buffer.alloc(16000), { rate: 16000, channels: 1, bits: 16 });

export default {
  manifest,
  speak,
  transcribe,
  voices,
  async test(p) {
    try {
      const t = target(p), out = [];
      if (t.def.speak) {
        const r = await speak({ ...p, text: 'Hello.', timeoutMs: 20000 });
        out.push(`spoke ${r.seconds !== null ? `${r.seconds.toFixed(1)} s` : 'a word'} with ${r.voice} in ${r.ms} ms`);
      }
      if (t.def.listen) {
        const r = await transcribe({ ...p, audio: SILENCE().toString('base64'), timeoutMs: 20000 });
        out.push(`listened in ${r.ms} ms`);
      }
      return { ok: true, detail: `${t.def.label}: ${out.join(', ')}` };
    } catch (e) {
      const fix = { auth: 'Paste a valid API key in the connection settings.', quota: 'Add credit to the service\'s account.', bad_request: 'Check the models and the voice (and the base URL for a custom service).',
        rate_limited: 'Wait a minute and test again.', blocked: 'A custom service must be a public https address.', unsupported: 'Choose another service for this.' }[e.code] || 'Try again in a minute; if it keeps failing, check the service\'s status page.';
      return { ok: false, error: e.message, code: e.code, fix };
    }
  },
};
