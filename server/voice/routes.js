// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice over HTTP (docs/features/CHAT.md §9.2). Every route goes through the server's pipeline (session, capability, Origin,
// CSRF; JSON except the recording, which is the body itself).
// - POST /api/voice/speak { agent?, text? | session+message+part?, connection?+voice? (a preview), speed? } → the audio
//   (audio/mpeg or audio/wav), with X-Voice-Seconds, -Source, -Part, -Parts. When the browser's own voice is to read it:
//   409 use_browser with the pronounceable text (and why: the person's choice, none set up, the plan's minutes, a limit).
// - POST /api/voice/transcribe?language=&seconds= (the recording as the body, at most 25 MB and 5 minutes) → { text,
//   language, seconds, source }; 409 use_browser when the browser is to listen.
// - GET /api/voice/options?agent= — what this account can use: who listens to it and who speaks for that agent, its
//   services, its voice minutes, the limits. GET /api/voice/voices?connection=&language= — a service's voices.
// - GET/POST /api/voice/prefs — the account's own choices. GET/POST /api/voice/agent — an agent's voice (whoever
//   manages it). GET /api/voice/overview — today's voice (administrators).
// A service's failure answers in our words with fallback: 'browser', so the page carries on with the browser's voice.
import { VoiceError, MAX_AUDIO_BYTES } from './voice.js';

const EXTRA = ['fallback', 'reason', 'text', 'part', 'parts', 'browserVoice', 'speed', 'language', 'retryAfterMs', 'service'];

/**
 * @param {object} router
 * @param {import('./voice.js').Voice} voice
 */
export function addVoiceRoutes(router, voice) {
  const ok = (json, status = 200, headers) => ({ status, json, ...(headers ? { headers } : {}) });
  const fail = e => ok({ error: e.message, code: e.code, ...Object.fromEntries(EXTRA.filter(k => e[k] !== undefined).map(k => [k, e[k]])) }, e.status,
    e.retryAfterMs ? { 'retry-after': String(Math.ceil(e.retryAfterMs / 1000)) } : undefined);
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) { if (e instanceof VoiceError) return fail(e); throw e; }
  };
  const id = v => (v === null || v === undefined || v === '' ? null : /^\d{1,9}$/.test(String(v)) ? Number(v) : NaN);

  router.add({ method: 'GET', path: '/api/voice/options', cap: 'chat.use', handler: run(({ P, url }) => voice.options(P, id(url.searchParams.get('agent')))) });

  router.add({ method: 'GET', path: '/api/voice/voices', cap: 'chat.use', handler: run(({ P, url }) => voice.voices(P, id(url.searchParams.get('connection')), url.searchParams.get('language') || '')) });

  router.add({ method: 'POST', path: '/api/voice/speak', cap: 'chat.use', handler: async ({ P, body }) => {
    try {
      const b = body || {};
      const r = await voice.speak(P, { agent: id(b.agent), text: typeof b.text === 'string' ? b.text : undefined, session: id(b.session), message: b.message === undefined ? undefined : id(b.message),
        part: b.part, connection: b.connection === undefined || b.connection === null || b.connection === '' ? null : id(b.connection), voice: b.voice, model: b.model, speed: b.speed,
        plain: b.plain === true });
      return { status: 200, pre: { body: r.audio }, headers: { 'content-type': r.mime, 'cache-control': 'private, no-store', 'x-voice-seconds': String(r.seconds), 'x-voice-source': r.source,
        'x-voice-part': String(r.part), 'x-voice-parts': String(r.parts), ...(r.cached ? { 'x-voice-cached': '1' } : {}) } };
    } catch (e) { if (e instanceof VoiceError) return fail(e); throw e; }
  } });

  // the recording is the body (as the browser recorded it); a refused upload is read to its end so the answer reaches the page
  router.add({ method: 'POST', path: '/api/voice/transcribe', cap: 'chat.use', raw: true, handler: async ({ P, req, url }) => {
    try {
      const len = Number(req.headers['content-length']);
      if (Number.isFinite(len) && len > MAX_AUDIO_BYTES) { drain(req); throw new VoiceError(413, 'too_large', 'A recording may be at most 25 MB'); }
      const audio = await readAudio(req, MAX_AUDIO_BYTES);
      return ok(await voice.transcribe(P, { audio, language: url.searchParams.get('language'), seconds: url.searchParams.get('seconds') }));
    } catch (e) { if (e instanceof VoiceError) return fail(e); throw e; }
  } });

  router.add({ method: 'GET', path: '/api/voice/prefs', cap: 'account.self', handler: run(({ P }) => voice.prefs(voice.me(P))) });
  router.add({ method: 'POST', path: '/api/voice/prefs', cap: 'account.self', handler: run(({ P, body }) => voice.setPrefs(P, body || {})) });

  router.add({ method: 'GET', path: '/api/voice/agent', cap: 'chat.use', handler: run(({ P, url }) => {
    const a = voice.managed(P, id(url.searchParams.get('agent')));
    return { agent: { id: a.id, name: a.name }, voice: voice.agentVoice(a), speaks: voice.describe(voice.speaker(P, { agent: a })) };
  }) });
  router.add({ method: 'POST', path: '/api/voice/agent', cap: 'chat.use', handler: run(({ P, body }) => {
    const b = body || {};
    const v = voice.setAgentVoice(P, id(b.agent), b, P.account ? { id: P.account.id, login: P.account.login } : null);
    const a = voice.agents.get(id(b.agent));
    return { voice: v, speaks: voice.describe(voice.speaker(P, { agent: a })) };
  }) });

  router.add({ method: 'GET', path: '/api/voice/overview', cap: 'freewill.admin', handler: run(() => voice.overview()) });
}

function drain(req) { req.on('error', () => {}); req.resume(); }
/** The request's body up to max bytes; past it the rest is read and dropped (the 413 still reaches the page). */
function readAudio(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', d => {
      size += d.length;
      if (size > max) { if (!over) { over = true; chunks.length = 0; } if (size > max * 2) req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => (over ? reject(new VoiceError(413, 'too_large', 'A recording may be at most 25 MB')) : resolve(Buffer.concat(chunks))));
    req.on('error', () => reject(new VoiceError(400, 'bad_request', 'The recording did not arrive whole')));
    req.on('close', () => { if (over) reject(new VoiceError(413, 'too_large', 'A recording may be at most 25 MB')); });
  });
}
