// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The voice services (server/providers/voice.js, docs/features/CHAT.md §9): every provider's request and answer against a
// fake of its documented API — speaking (the body, the headers, the audio back; a long text in pieces joined in order),
// listening (multipart or JSON or raw audio, the language, the length the service reports), the voices list — and their
// refusals in our own words (a service's error text is never passed on), the custom server's and Qwen's address rules.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import adapter, { BASE, pieces } from '../../server/providers/voice.js';
import { seconds, sniff } from '../../server/voice/audio.js';
import { mp3, wav } from '../helpers/audio.mjs';


let srv, url;
const reqs = [];
let script = null;   // (req, res, raw: Buffer) => void
before(async () => {
  srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let json = null; if (/json/.test(String(req.headers['content-type'] || ''))) { try { json = JSON.parse(raw.toString()); } catch { /* not JSON */ } }
      reqs.push({ method: req.method, url: req.url, headers: req.headers, raw, json, form: /multipart/.test(String(req.headers['content-type'] || '')) ? form(req.headers['content-type'], raw) : null });
      script(req, res, raw, json);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  url = `http://127.0.0.1:${srv.address().port}`;
  Object.assign(BASE, { openai: `${url}/openai`, openrouter: `${url}/or`, groq: `${url}/groq`, elevenlabs: `${url}/el`, googleTts: `${url}/gtts`, googleStt: `${url}/gstt`,
    deepgram: `${url}/dg`, xai: `${url}/xai`, qwen: `${url}/qwen` });
});
after(() => srv.close());

/** A multipart body's fields in order: [{ name, filename?, type?, data }]. */
function form(type, raw) {
  const b = /boundary=(.+)$/.exec(type)[1], out = [];
  for (const part of raw.toString('latin1').split(`--${b}`).slice(1, -1)) {
    const i = part.indexOf('\r\n\r\n'), head = part.slice(0, i), data = part.slice(i + 4, -2);
    out.push({ name: /name="([^"]+)"/.exec(head)[1], filename: /filename="([^"]+)"/.exec(head)?.[1], type: /Content-Type: (.+)/.exec(head)?.[1]?.trim(), data: Buffer.from(data, 'latin1') });
  }
  return out;
}
const audioRes = (res, buf, type = 'audio/mpeg') => { res.writeHead(200, { 'content-type': type }); res.end(buf); };
const jsonRes = (res, j, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(j)); };
const P = (provider, extra = {}) => ({ config: { provider, ...(extra.config || {}) }, secrets: { apiKey: 'KEY-SECRET-123' }, ...extra, ...(extra.config ? { config: { provider, ...extra.config } } : {}) });
const last = () => reqs[reqs.length - 1];
const field = (r, k) => r.form.find(x => x.name === k)?.data.toString();

test('OpenAI: speech as MP3 with the voice, speed and instructions; transcription as multipart with the file last', async () => {
  script = (req, res) => (req.url.endsWith('/audio/speech') ? audioRes(res, mp3(100)) : jsonRes(res, { text: 'Hello there.' }));
  const r = await adapter.speak(P('openai', { text: 'Hello **there**.', voice: 'coral', speed: 1.25, instructions: 'Cheerful.' }));
  const q = last();
  assert.equal(q.url, '/openai/audio/speech'); assert.equal(q.headers.authorization, 'Bearer KEY-SECRET-123');
  assert.deepEqual(q.json, { model: 'gpt-4o-mini-tts', input: 'Hello **there**.', voice: 'coral', response_format: 'mp3', speed: 1.25, instructions: 'Cheerful.' });
  assert.equal(r.mime, 'audio/mpeg'); assert.equal(r.format, 'mp3'); assert.equal(r.pieces, 1);
  assert.ok(Math.abs(r.seconds - 100 * 1152 / 44100) < 0.01, `the length is read from the frames: ${r.seconds}`);
  assert.deepEqual(Buffer.from(r.audio, 'base64'), mp3(100));
  const t = await adapter.transcribe(P('openai', { audio: wav(1.5).toString('base64'), language: 'en-US' }));
  const u = last();
  assert.equal(u.url, '/openai/audio/transcriptions');
  assert.deepEqual(u.form.map(x => x.name), ['model', 'language', 'response_format', 'temperature', 'file'], 'the file comes last');
  assert.equal(field(u, 'model'), 'gpt-4o-mini-transcribe'); assert.equal(field(u, 'language'), 'en'); assert.equal(field(u, 'response_format'), 'json', 'gpt-4o transcribers answer json');
  assert.equal(u.form.at(-1).filename, 'audio.wav'); assert.equal(u.form.at(-1).type, 'audio/wav');
  assert.equal(t.text, 'Hello there.'); assert.equal(t.seconds, null, 'json says no length'); assert.ok(Math.abs(t.measured - 1.5) < 0.01, 'the file says it');
  const v = await adapter.voices(P('openai'));
  assert.ok(v.voices.some(x => x.id === 'marin') && v.voices.length === 13);
});

test('Groq: Orpheus speaks at most 200 characters a call and only WAV — a long text in pieces, joined in order; whisper with verbose_json', async () => {
  const lens = [];
  script = (req, res, raw, j) => {
    if (req.url.endsWith('/audio/speech')) { lens.push(j.input.length); return audioRes(res, wav(j.input.length / 100), 'audio/wav'); }
    jsonRes(res, { text: ' hola ', language: 'spanish', duration: 2.25 });
  };
  const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} is here, and it says something useful about the city.`).join(' ');
  const r = await adapter.speak(P('groq', { text }));
  assert.ok(lens.length > 1 && lens.every(n => n <= 190), `pieces of at most 190: ${lens}`);
  assert.equal(lens.reduce((a, b) => a + b, 0) + lens.length - 1, text.length, 'every character spoken once (pieces split at spaces)');
  assert.equal(r.format, 'wav'); assert.equal(r.pieces, lens.length);
  assert.ok(Math.abs(r.seconds - lens.reduce((a, b) => a + b / 100, 0)) < 0.01, 'the joined file lasts as long as its pieces');
  const sp = reqs.find(x => x.url === '/groq/audio/speech');
  assert.deepEqual(Object.keys(sp.json), ['model', 'input', 'voice', 'response_format']); assert.equal(sp.json.response_format, 'wav'); assert.equal(sp.json.voice, 'troy');
  const t = await adapter.transcribe(P('groq', { audio: wav(2.25).toString('base64') }));
  assert.equal(field(last(), 'response_format'), 'verbose_json'); assert.equal(field(last(), 'model'), 'whisper-large-v3-turbo');
  assert.equal(t.text, 'hola'); assert.equal(t.seconds, 2.25);
  assert.equal((await adapter.voices(P('groq'))).voices.length, 6);
});

test('OpenRouter: speech as MP3; transcription as JSON with the audio in base64, its length and cost; voices by model', async () => {
  script = (req, res, raw, j) => {
    if (req.url.endsWith('/audio/speech')) return audioRes(res, mp3(40));
    if (req.url.startsWith('/or/models')) return jsonRes(res, { data: [{ id: 'hexgrad/kokoro-82m', name: 'Kokoro 82M', supported_voices: ['af_heart', 'af_bella'], pricing: { prompt: '0.00000062' } }, { id: 'x/other', supported_voices: ['z'] }] });
    jsonRes(res, { text: 'Bonjour', usage: { seconds: 3.2, cost: 0.000508 } });
  };
  await adapter.speak(P('openrouter', { text: 'Hi.', speed: 1 }));
  assert.deepEqual(last().json, { model: 'hexgrad/kokoro-82m', input: 'Hi.', voice: 'af_heart', response_format: 'mp3' }, 'speed 1 is not sent');
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200)]);
  const t = await adapter.transcribe(P('openrouter', { audio: webm.toString('base64'), language: 'fr' }));
  assert.equal(last().url, '/or/audio/transcriptions');
  assert.deepEqual({ ...last().json, input_audio: { ...last().json.input_audio, data: last().json.input_audio.data.length } }, { model: 'openai/whisper-large-v3', input_audio: { data: webm.toString('base64').length, format: 'webm' }, language: 'fr' });
  assert.deepEqual([t.text, t.seconds, t.costUsd], ['Bonjour', 3.2, 0.000508]);
  const v = await adapter.voices(P('openrouter'));
  assert.equal(last().url, '/or/models?output_modalities=speech');
  assert.deepEqual(v.voices.map(x => x.id), ['af_heart', 'af_bella']); assert.equal(v.models[0].pricePerMChars, 0.62);
});

test('ElevenLabs: its own API — the voice in the path, MP3 at 44.1 kHz, speed in voice settings; Scribe; its voices', async () => {
  script = (req, res) => {
    if (req.url.startsWith('/el/v1/text-to-speech/')) return audioRes(res, mp3(10, true));
    if (req.url === '/el/v1/speech-to-text') return jsonRes(res, { language_code: 'eng', text: 'Testing one two', words: [{ text: 'Testing', start: 0, end: 0.5 }, { text: 'two', start: 1, end: 1.4 }] });
    jsonRes(res, { voices: [{ voice_id: 'v1', name: 'George', labels: { gender: 'male', accent: 'british' }, preview_url: 'https://cdn.example/p.mp3' }], has_more: false });
  };
  const r = await adapter.speak(P('elevenlabs', { text: 'Hello.', speed: 1.1, language: 'en' }));
  const q = last();
  assert.equal(q.url, '/el/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128'); assert.equal(q.headers['xi-api-key'], 'KEY-SECRET-123');
  assert.deepEqual(q.json, { text: 'Hello.', model_id: 'eleven_flash_v2_5', voice_settings: { speed: 1.1 }, language_code: 'en' });
  assert.equal(r.format, 'mp3');
  const t = await adapter.transcribe(P('elevenlabs', { audio: wav(1.4).toString('base64') }));
  assert.equal(field(last(), 'model_id'), 'scribe_v2'); assert.equal(last().form.at(-1).name, 'file');
  assert.deepEqual([t.text, t.seconds, t.language], ['Testing one two', 1.4, 'eng'], 'no duration given: the last word\'s end');
  const v = await adapter.voices(P('elevenlabs'));
  assert.equal(last().url, '/el/v2/voices?page_size=100');
  assert.deepEqual(v.voices, [{ id: 'v1', label: 'George', gender: 'male', lang: 'british', preview: 'https://cdn.example/p.mp3' }]);
  // a voice that would leave the path is refused before any call
  await assert.rejects(adapter.speak(P('elevenlabs', { text: 'x', voice: '../../v1/user' })), e => e.code === 'bad_request');
});

test('Google Cloud: an API key in a header (never the address), MP3 from text:synthesize; recognize with the browser\'s Opus at 48 kHz', async () => {
  script = (req, res) => {
    if (req.url === '/gtts/text:synthesize') return jsonRes(res, { audioContent: mp3(20).toString('base64') });
    if (req.url.startsWith('/gtts/voices')) return jsonRes(res, { voices: [{ languageCodes: ['en-GB'], name: 'en-GB-Neural2-A', ssmlGender: 'FEMALE' }] });
    jsonRes(res, { results: [{ alternatives: [{ transcript: 'good morning' }], languageCode: 'en-us' }, { alternatives: [{ transcript: ' everyone' }] }], totalBilledTime: '4.5s' });
  };
  const r = await adapter.speak(P('google', { text: 'Hi.', voice: 'en-GB-Neural2-A', speed: 0.9 }));
  const q = last();
  assert.equal(q.headers['x-goog-api-key'], 'KEY-SECRET-123'); assert.ok(!q.url.includes('KEY'), 'the key is not in the address');
  assert.deepEqual(q.json, { input: { text: 'Hi.' }, voice: { languageCode: 'en-GB', name: 'en-GB-Neural2-A' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9 } });
  assert.equal(r.format, 'mp3');
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200)]);
  const t = await adapter.transcribe(P('google', { audio: webm.toString('base64'), language: 'en' }));
  assert.equal(last().url, '/gstt/v1/speech:recognize');
  assert.deepEqual(last().json.config, { languageCode: 'en-US', enableAutomaticPunctuation: true, encoding: 'WEBM_OPUS', sampleRateHertz: 48000 });
  assert.deepEqual([t.text, t.seconds], ['good morning everyone', 4.5]);
  await adapter.transcribe(P('google', { audio: wav(1).toString('base64') }));
  assert.deepEqual(last().json.config, { languageCode: 'en-US', enableAutomaticPunctuation: true }, 'WAV: read from its header');
  await adapter.transcribe(P('google', { audio: mp3(30).toString('base64') }));
  assert.equal(last().url, '/gstt/v1p1beta1/speech:recognize'); assert.deepEqual([last().json.config.encoding, last().json.config.sampleRateHertz], ['MP3', 44100]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypM4A '), Buffer.alloc(100)]);
  await assert.rejects(adapter.transcribe(P('google', { audio: mp4.toString('base64') })), e => e.code === 'unsupported' && /another listening service/.test(e.message));
  await assert.rejects(adapter.transcribe(P('google', { audio: wav(75).toString('base64') })), e => e.code === 'unsupported' && /a minute/.test(e.message));
  const v = await adapter.voices(P('google', { language: 'en-GB' }));
  assert.equal(last().url, '/gtts/voices?languageCode=en-GB'); assert.deepEqual(v.voices, [{ id: 'en-GB-Neural2-A', label: 'en-GB-Neural2-A', lang: 'en-GB', gender: 'female' }]);
});

test('Deepgram: Aura voices are models; /v1/listen takes the raw recording and says its length', async () => {
  script = (req, res) => {
    if (req.url.startsWith('/dg/speak')) return audioRes(res, mp3(12));
    if (req.url === '/dg/models') return jsonRes(res, { stt: [], tts: [{ name: 'thalia', canonical_name: 'aura-2-thalia-en', languages: ['en'], metadata: { sample: 'https://static.deepgram.com/x.wav' } }] });
    jsonRes(res, { metadata: { duration: 6.02 }, results: { channels: [{ detected_language: 'en', alternatives: [{ transcript: 'Deepgram heard this.' }] }] } });
  };
  const long = 'Word. '.repeat(500);
  const r = await adapter.speak(P('deepgram', { text: long }));
  const sp = reqs.filter(x => x.url.startsWith('/dg/speak'));
  assert.equal(sp[0].url, '/dg/speak?model=aura-2-thalia-en&encoding=mp3'); assert.equal(sp[0].headers.authorization, 'Token KEY-SECRET-123');
  assert.ok(sp.length >= 2 && sp.every(x => x.json.text.length <= 1900), 'at most 2,000 characters a call');
  assert.equal(r.format, 'mp3'); assert.ok(Math.abs(r.seconds - sp.length * 12 * 1152 / 44100) < 0.01, 'the MP3s joined');
  const audio = wav(6);
  const t = await adapter.transcribe(P('deepgram', { audio: audio.toString('base64') }));
  assert.equal(last().url, '/dg/listen?model=nova-3&smart_format=true&detect_language=true'); assert.equal(last().headers['content-type'], 'audio/wav');
  assert.deepEqual(last().raw, audio, 'the recording itself is the body');
  assert.deepEqual([t.text, t.seconds, t.language], ['Deepgram heard this.', 6.02, 'en']);
  assert.equal((await adapter.voices(P('deepgram'))).voices[0].id, 'aura-2-thalia-en');
});

test('xAI: /v1/tts with a language (auto by default) and its voices; /v1/stt multipart with the file last', async () => {
  script = (req, res) => {
    if (req.url === '/xai/tts') return audioRes(res, mp3(8));
    if (req.url === '/xai/tts/voices') return jsonRes(res, { voices: [{ voice_id: 'eve', name: 'Eve' }, { voice_id: 'ara', name: 'Ara' }] });
    jsonRes(res, { text: 'The balance is $167.', language: 'en', duration: 3.45, words: [] });
  };
  await adapter.speak(P('xai', { text: 'Hello.', speed: 3 }));
  assert.deepEqual(last().json, { text: 'Hello.', voice_id: 'eve', language: 'auto', speed: 1.5 }, 'speed kept within its 0.7–1.5');
  const t = await adapter.transcribe(P('xai', { audio: mp3(50).toString('base64'), language: 'en' }));
  assert.deepEqual(last().form.map(x => x.name), ['model', 'language', 'file']); assert.equal(field(last(), 'model'), 'grok-voice-transcribe-2.0');
  assert.deepEqual([t.text, t.seconds], ['The balance is $167.', 3.45]);
  assert.deepEqual((await adapter.voices(P('xai'))).voices.map(v => v.id), ['eve', 'ara']);
});

test('Qwen: streamed 24 kHz PCM made into WAV, at most 600 characters a call; Qwen-ASR through its OpenAI-compatible endpoint', async () => {
  script = (req, res, raw, j) => {
    if (req.url === '/qwen/api/v1/services/aigc/multimodal-generation/generation') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const half = Buffer.alloc(24000).toString('base64');   // 0.5 s each
      res.write(`data: ${JSON.stringify({ output: { audio: { data: half } } })}\n\n`);
      res.write(`data: ${JSON.stringify({ output: { audio: { data: half }, finish_reason: null } })}\n\n`);
      res.end(`data: ${JSON.stringify({ output: { audio: { data: '', url: 'http://elsewhere/x.wav' }, finish_reason: 'stop' }, usage: { characters: j.input.text.length } })}\n\n`);
      return;
    }
    jsonRes(res, { choices: [{ message: { role: 'assistant', content: '欢迎', annotations: [{ type: 'audio_info', language: 'zh' }] } }], usage: { seconds: 2 } });
  };
  const r = await adapter.speak(P('qwen', { text: 'Hello there.', language: 'en' }));
  const q = last();
  assert.equal(q.headers['x-dashscope-sse'], 'enable');
  assert.deepEqual(q.json, { model: 'qwen3-tts-flash', input: { text: 'Hello there.', voice: 'Cherry', language_type: 'English' } });
  assert.equal(r.format, 'wav'); assert.equal(r.seconds, 1, 'two half seconds of PCM');
  const long = 'A sentence about nothing much at all. '.repeat(40);
  const r2 = await adapter.speak(P('qwen', { text: long }));
  assert.ok(r2.pieces >= 3 && r2.seconds === r2.pieces, 'pieces of at most 550 characters, joined');
  const t = await adapter.transcribe(P('qwen', { audio: mp3(20).toString('base64') }));
  const u = last();
  assert.equal(u.url, '/qwen/compatible-mode/v1/chat/completions');
  assert.match(u.json.messages[0].content[0].input_audio.data, /^data:audio\/mpeg;base64,/);
  assert.deepEqual([t.text, t.seconds, t.language], ['欢迎', 2, 'zh']);
  // an error inside the stream is a refusal in our words
  script = (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ code: 'InvalidApiKey', message: 'Invalid API-key provided: KEY-SECRET-123' })}\n\n`); };
  await assert.rejects(adapter.speak(P('qwen', { text: 'x' })), e => e.code === 'auth' && !e.message.includes('KEY'));
  // a Qwen address must be Alibaba Cloud's
  await assert.rejects(adapter.speak(P('qwen', { text: 'x', config: { baseUrl: 'https://evil.example.com' } })), e => e.code === 'blocked');
  assert.equal((await adapter.voices(P('qwen'))).voices[0].id, 'Cherry');
});

test('a custom OpenAI-compatible server: https and public unless the installation\'s; its voices if it lists them', async () => {
  script = (req, res) => {
    if (req.url === '/custom/v1/audio/speech') return audioRes(res, wav(0.5), 'audio/wav');
    if (req.url === '/custom/v1/audio/voices') return jsonRes(res, { voices: ['af_bella', 'am_adam'] });
    jsonRes(res, { text: 'local' });
  };
  const mine = { config: { baseUrl: `${url}/custom/v1`, speakModel: 'kokoro', voice: 'af_bella' } };
  await assert.rejects(adapter.speak(P('custom', { ...mine, text: 'x' })), e => e.code === 'blocked', 'an account\'s custom server must be https');
  await assert.rejects(adapter.speak(P('custom', { config: { baseUrl: 'https://[::1]:1/v1' }, text: 'x' })), e => e.code === 'blocked', 'and on the public internet');
  await assert.rejects(adapter.speak(P('custom', { config: { baseUrl: 'https://127.0.0.1:1/v1' }, text: 'x' })), e => e.code === 'blocked');
  const r = await adapter.speak(P('custom', { ...mine, text: 'Local voice.', allowPrivate: true }));
  assert.equal(r.format, 'wav', 'whatever the server sent, read by its bytes'); assert.deepEqual(last().json, { model: 'kokoro', input: 'Local voice.', voice: 'af_bella', response_format: 'mp3' });
  assert.deepEqual((await adapter.voices(P('custom', { ...mine, allowPrivate: true }))).voices.map(v => v.id), ['af_bella', 'am_adam']);
  assert.equal((await adapter.transcribe(P('custom', { ...mine, allowPrivate: true, audio: wav(1).toString('base64') }))).text, 'local');
});

test('a server of one\'s own: what it does is what is tested and used; with no key, no Authorization header', async () => {
  script = (req, res) => {
    if (req.url === '/tts/v1/audio/speech') return audioRes(res, wav(0.5), 'audio/wav');
    if (req.url === '/tts/v1/audio/voices') return jsonRes(res, { status: 'ok', voices: ['Abigail.wav', 'Adrian.wav'] });
    if (req.url === '/asr/v1/audio/transcriptions') return jsonRes(res, { text: 'heard' });
    jsonRes(res, { detail: 'Not Found' }, 404);
  };
  // a text-to-speech server (Kokoro): it only speaks, and has no key
  const tts = { config: { provider: 'custom', baseUrl: `${url}/tts/v1`, speakModel: 'kokoro', voice: 'af_bella', does: 'speak' }, secrets: {}, allowPrivate: true };
  const t1 = await adapter.test(tts);
  assert.equal(t1.ok, true, JSON.stringify(t1)); assert.match(t1.detail, /spoke/); assert.doesNotMatch(t1.detail, /listened/, 'not asked to listen');
  assert.equal(last().headers.authorization, undefined, 'no key: no Authorization header');
  await assert.rejects(adapter.transcribe({ ...tts, audio: wav(1).toString('base64') }), e => e.code === 'unsupported');
  // no voice set: the first the server lists (OpenAI's alloy is none of its voices)
  await adapter.speak({ ...tts, config: { ...tts.config, voice: undefined }, text: 'Hi.' });
  assert.equal(last().json.voice, 'Abigail.wav');
  await adapter.speak({ ...tts, config: { ...tts.config, voice: undefined }, voice: 'Adrian.wav', text: 'Hi.' });
  assert.equal(last().json.voice, 'Adrian.wav', 'a voice asked for wins');
  // a transcription server (Qwen3-ASR on vLLM): it only listens
  const asr = { config: { provider: 'custom', baseUrl: `${url}/asr/v1`, listenModel: 'Qwen/Qwen3-ASR-0.6B', does: 'listen' }, secrets: { apiKey: 'k-1' }, allowPrivate: true };
  const t2 = await adapter.test(asr);
  assert.equal(t2.ok, true, JSON.stringify(t2)); assert.match(t2.detail, /listened/); assert.doesNotMatch(t2.detail, /spoke/);
  assert.equal(last().headers.authorization, 'Bearer k-1', 'a key, when there is one');
  await assert.rejects(adapter.speak({ ...asr, text: 'x' }), e => e.code === 'unsupported');
  // said to do both (what every connection made before said), the server only speaks: which half failed and how to say so
  const both = await adapter.test({ ...tts, config: { ...tts.config, does: undefined } });
  assert.equal(both.ok, false); assert.match(both.error, /^Listening:/); assert.match(both.fix, /Speaks only/);
  // a vendor's service still needs its key, and a member's own server still must be public https
  await assert.rejects(adapter.speak({ config: { provider: 'openai' }, secrets: {}, text: 'x' }), e => e.code === 'auth');
  await assert.rejects(adapter.speak({ ...tts, allowPrivate: false, text: 'x' }), e => e.code === 'blocked' && /administrator/.test(e.message));
});

test('refusals in our words: key, credit, rate limit with its wait, a disabled API, a bad model; not audio; nothing to say', async () => {
  const cases = [
    [401, { error: { message: 'Incorrect API key provided: KEY-SECRET-123' } }, {}, 'auth'],
    [402, { error: { message: 'Insufficient credits' } }, {}, 'quota'],
    [401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of KEY-SECRET-123' } }, {}, 'quota'],
    [429, { error: 'slow down' }, { 'retry-after': '7' }, 'rate_limited'],
    [403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }, {}, 'bad_request'],
    [400, { error: { message: 'Unknown voice KEY-SECRET-123' } }, {}, 'bad_request'],
    [500, { error: 'boom KEY-SECRET-123' }, {}, 'provider_error'],
  ];
  for (const [status, body, headers, code] of cases) {
    script = (req, res) => jsonRes(res, body, status, headers);
    const e = await adapter.speak(P('openai', { text: 'x' })).then(() => null, x => x);
    assert.equal(e?.code, code, `${status} → ${code}`);
    assert.ok(!e.message.includes('KEY-SECRET') && !e.message.includes('Incorrect'), 'never the service\'s words');
    if (code === 'rate_limited') assert.equal(e.retryAfterMs, 7000);
  }
  script = (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not audio</html>'); };
  await assert.rejects(adapter.speak(P('openai', { text: 'x' })), e => e.code === 'provider_error');
  await assert.rejects(adapter.speak(P('openai', { text: '   ' })), e => e.code === 'bad_request');
  await assert.rejects(adapter.transcribe(P('openai', { audio: Buffer.from('just some text, not a recording at all — certainly not audio of any kind').toString('base64') })), e => e.code === 'unsupported');
  await assert.rejects(adapter.speak({ config: { provider: 'openai' }, secrets: {}, text: 'x' }), e => e.code === 'auth');
  // test(): the smallest real calls, and the fix for what went wrong
  script = (req, res) => (req.url.endsWith('/audio/speech') ? audioRes(res, mp3(5)) : jsonRes(res, { text: '' }));
  const ok = await adapter.test(P('openai'));
  assert.equal(ok.ok, true); assert.match(ok.detail, /OpenAI: spoke .* listened in/);
  script = (req, res) => jsonRes(res, {}, 401);
  const bad = await adapter.test(P('openai'));
  assert.deepEqual([bad.ok, bad.code], [false, 'auth']); assert.match(bad.fix, /API key/);
});

test('text in pieces: at sentence ends, a long sentence at a comma or a space, nothing lost', () => {
  const t = 'One. Two two two two, two two two two two two two two two two two two. Three?';
  const p = pieces(t, 30);
  assert.ok(p.every(x => x.length <= 30), JSON.stringify(p));
  assert.equal(p.join(' ').replace(/\s+/g, ' '), t);
  assert.deepEqual(pieces('Short.', 100), ['Short.']);
  assert.deepEqual(pieces('', 100), []);
  assert.equal(sniff(mp3(2, true)).format, 'mp3'); assert.ok(seconds(mp3(2, true)) > 0.05);
});
