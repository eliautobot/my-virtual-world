// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice in the page (docs/features/CHAT.md §9.4): hearing someone — a recording sent to the server's voice service, or the
// browser's own recognition — and speaking — audio from the server's voice service played through Web Audio, or the
// browser's own voice — plus what the window, the Studio and Settings ask the server. Which service listens and speaks
// is the server's decision (GET /api/voice/options); when it says the browser (409 use_browser: the person's choice, none
// set up, the plan's minutes used) the browser carries on, so a conversation is never cut off.
import { auth } from '../core/auth.js';
import { getJSON } from '../core/net.js';
import { bus } from '../core/state.js';
import { level } from '../audio/mixer.js';

export const can = {
  record: () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
  recognize: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  synth: () => typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function',
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A refusal or failure from the voice routes, in our words, with what came with it (code, fallback, reason, text…). */
export class VoiceFail extends Error {
  constructor(status, j, fallbackMsg = 'Voice didn\'t work') {
    super((j && j.error) || fallbackMsg);
    this.status = status;
    for (const k of ['code', 'fallback', 'reason', 'text', 'part', 'parts', 'browserVoice', 'speed', 'language', 'retryAfterMs', 'service']) if (j && j[k] !== undefined) this[k] = j[k];
  }
}

// ------------------------------------------------------------------------------------------------ what this account can use
const optCache = new Map();
/** GET /api/voice/options (for an agent: who speaks for it), kept 30 s. */
export function options(agent = null, force = false) {
  const k = agent ?? '', hit = optCache.get(k);
  if (!force && hit && Date.now() - hit.at < 30000) return hit.p;
  const p = getJSON(`/api/voice/options${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`);
  optCache.set(k, { at: Date.now(), p });
  p.catch(() => optCache.delete(k));
  return p;
}
/** Forgets what options said (a choice changed). */
export function forget() { optCache.clear(); }

/** A POST with the session's CSRF token (refreshed and retried once when stale); the answer as it came. */
async function send(url, init, retried = false) {
  const headers = { ...(init.headers || {}) };
  if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
  const r = await fetch(url, { ...init, method: 'POST', headers });
  if (r.ok || retried || r.status !== 403) return r;
  let j = null; try { j = await r.clone().json(); } catch { /* not JSON */ }
  if (j?.code === 'csrf') { await auth.refresh(); return send(url, init, true); }
  return r;
}

/** Hears a recording: { text, language, seconds, source }; a VoiceFail otherwise (code use_browser: the browser listens). */
export async function hear(blob, { seconds = null, language = '' } = {}) {
  const q = new URLSearchParams();
  if (language) q.set('language', language);
  if (seconds) q.set('seconds', String(Math.round(seconds * 10) / 10));
  const r = await send(`/api/voice/transcribe${q.size ? `?${q}` : ''}`, { headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new VoiceFail(r.status, j, 'Your words couldn\'t be heard');
  return j;
}

/**
 * Asks for speech (POST /api/voice/speak: { agent?, text } | { session, message, part } | a preview { connection, voice,
 * speed, text }). Resolves { audio: ArrayBuffer, part, parts } — or { browser: true, text, part, parts, browserVoice,
 * reason, note } when the browser's own voice is to read it. A VoiceFail otherwise (fallback 'browser': the browser may).
 */
export async function speak(body, signal) {
  const r = await send('/api/voice/speak', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const type = r.headers.get('content-type') || '';
  if (r.ok && /^audio\//i.test(type)) {
    return { audio: await r.arrayBuffer(), mime: type, part: Number(r.headers.get('x-voice-part')) || 0, parts: Number(r.headers.get('x-voice-parts')) || 1, source: r.headers.get('x-voice-source') || '' };
  }
  const j = await r.json().catch(() => null);
  if (r.status === 409 && j?.code === 'use_browser') return { browser: true, text: j.text || '', part: j.part ?? 0, parts: j.parts ?? 1, browserVoice: j.browserVoice || '', rate: Number(j.speed) || 1, reason: j.reason || '', note: j.error || '' };
  throw new VoiceFail(r.status, j, 'The voice couldn\'t speak');
}

// ------------------------------------------------------------------------------------------------ sound out
let AC = null, OUT = null, VOL = null;   // OUT: what the agent says, measured (its orb and mouth); VOL: the Agents' voices volume
/** The page's one audio context (phones allow a handful): made and resumed inside a tap, where sound may start. */
export function audioCtx() {
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    AC = new C();
    OUT = AC.createAnalyser(); OUT.fftSize = 512;
    VOL = AC.createGain(); VOL.gain.value = level('voices'); OUT.connect(VOL); VOL.connect(AC.destination);
    bus.on('sound', () => { if (VOL) VOL.gain.setTargetAtTime(level('voices'), AC.currentTime, 0.05); });
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
/** Call inside a tap or key press: lets sound (and the browser's voice) start later without one — a phone's rule. */
export function unlock({ synth = false } = {}) {
  const ctx = audioCtx();
  if (ctx) { try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch { /* nothing to play */ } }
  if (synth && can.synth()) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* none */ } }
}
const decode = (ctx, buf) => new Promise((resolve, reject) => { try { const p = ctx.decodeAudioData(buf, resolve, reject); p?.catch?.(reject); } catch (e) { reject(e); } });
/** How loud a sound is now (RMS, 0–1). */
export function levelOf(an, buf) {
  if (!an) return 0;
  an.getFloatTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/** The browser's voices (they arrive a moment after the page loads). */
export const browserVoices = () => (can.synth() ? speechSynthesis.getVoices() : []);
export function voicesReady() {
  if (!can.synth()) return Promise.resolve([]);
  if (browserVoices().length) return Promise.resolve(browserVoices());
  return new Promise(resolve => {
    const done = () => { speechSynthesis.removeEventListener?.('voiceschanged', done); resolve(browserVoices()); };
    speechSynthesis.addEventListener?.('voiceschanged', done);
    setTimeout(done, 1500);
  });
}
/** A browser voice by its name, else one for the language, else the device's default (null). */
export function findVoice(name, lang = '') {
  const list = browserVoices();
  if (name) { const v = list.find(x => x.name === name) || list.find(x => x.voiceURI === name); if (v) return v; }
  if (lang) { const l = lang.toLowerCase(); return list.find(x => x.lang?.toLowerCase() === l) || list.find(x => x.lang?.toLowerCase().startsWith(l.split('-')[0])) || null; }
  return null;
}
/** Short pieces for the browser's voice (Chrome stops one utterance after about 15 seconds). */
function shortPieces(text, max = 200) {
  const out = [];
  for (const sent of String(text).match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [String(text)]) {
    let s = sent.trim();
    while (s.length > max) { let k = s.lastIndexOf(' ', max); if (k < 40) k = max; out.push(s.slice(0, k)); s = s.slice(k).trim(); }
    if (s) out.push(s);
  }
  return out;
}
/** Says `text` in the browser's own voice; resolves when it has been said (or cancelled: `stopped()` true). */
export function browserSay(text, { browserVoice = '', lang = '', rate = 1 } = {}, stopped = () => false) {
  if (!can.synth() || !String(text || '').trim()) return Promise.resolve(false);
  const voice = findVoice(browserVoice, lang), parts = shortPieces(text);
  return new Promise(resolve => {
    let k = 0, dog = null, over = false;
    const finish = () => { if (over) return; over = true; clearTimeout(dog); resolve(true); };
    const next = () => {
      clearTimeout(dog);
      if (stopped() || k >= parts.length) return finish();
      const u = new SpeechSynthesisUtterance(parts[k++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else if (lang) u.lang = lang;
      u.rate = clamp(Number(rate) || 1, 0.5, 2);
      u.volume = level('voices');   // (Settings → Sound; taken as each part starts)
      u.onend = next; u.onerror = next;
      dog = setTimeout(next, 3000 + u.text.length * 110 / u.rate);   // (a browser that never says it ended)
      speechSynthesis.speak(u);
    };
    next();
  });
}

/** Plays pieces one after another: { audio } through Web Audio, or { text, browserVoice, lang, rate } in the browser's voice. */
export class Player {
  constructor() { this.gen = 0; this.src = null; this.buf = new Float32Array(512); this.browser = false; }
  async play(v) {
    const g = this.gen;
    if (v && v.audio) {
      const ctx = audioCtx();
      if (!ctx) throw new Error('This browser can\'t play sound');
      const b = await decode(ctx, v.audio);
      if (g !== this.gen) return;
      await new Promise(resolve => {
        const s = ctx.createBufferSource();
        s.buffer = b; s.connect(OUT);
        bus.emit('audio:speaking', true);   // (the background music dips while an agent speaks: audio/score.js)
        s.onended = () => { if (this.src === s) this.src = null; bus.emit('audio:speaking', false); resolve(); };
        this.src = s; s.start();
      });
    } else if (v && v.text) {
      this.browser = true; bus.emit('audio:speaking', true);
      try { await browserSay(v.text, v, () => g !== this.gen); } finally { this.browser = false; bus.emit('audio:speaking', false); }
    }
  }
  /** How loud it is now (0–1); the browser's voice can't be measured: a gentle pulse instead. */
  level() { return this.src ? levelOf(OUT, this.buf) : this.browser ? 0.04 + 0.03 * Math.sin(performance.now() / 120) : 0; }
  get busy() { return !!this.src || this.browser; }
  stop() {
    this.gen++;
    const s = this.src; this.src = null;
    try { s?.stop(); } catch { /* already over */ }
    if (this.browser && can.synth()) speechSynthesis.cancel();
    this.browser = false;
  }
}

/** Pieces to say in order, each a promise of what to play (fetched ahead while the one before plays). */
export class SpeechQueue {
  constructor(player = new Player()) { this.player = player; this.items = []; this.playing = null; this.gen = 0; this.onPlay = null; this.onIdle = null; this.onError = null; }
  get waiting() { return this.items.length; }
  get idle() { return !this.playing && !this.items.length; }
  add(promise, info = {}) { promise.catch(() => {}); this.items.push({ promise, info }); this.pump(); }
  async pump() {
    if (this.playing) return;
    const it = this.items.shift();
    if (!it) { this.onIdle?.(); return; }
    const g = this.gen;
    this.playing = it;
    try {
      const v = await it.promise;
      if (g !== this.gen) return;
      if (v) { this.onPlay?.(it.info, v); await this.player.play(v); }
    } catch (e) { if (g === this.gen) this.onError?.(e, it.info); }
    if (g !== this.gen) return;
    this.playing = null;
    this.pump();
  }
  stop() { this.gen++; this.items = []; this.playing = null; this.player.stop(); }
}

// ------------------------------------------------------------------------------------------------ sound in
const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/aac'];
export const recordMime = () => (window.MediaRecorder?.isTypeSupported ? MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '' : '');
/** The microphone in our words. */
export function micWords(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Allow the microphone for this site to talk (the lock or the camera icon in the address bar).';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The microphone is in use by another app.';
  return 'The microphone couldn\'t start.';
}

/** The microphone: its loudness, and recordings of it (one at a time). */
export class Mic {
  constructor() { this.stream = null; this.opening = null; this.gen = 0; }
  /** Opens the microphone (once: a second call while it is being asked for waits for the same). Let go meanwhile
   *  (close()), the stream that arrives is stopped at once — no microphone stays on behind a closed conversation. */
  open() {
    if (this.stream && this.stream.getAudioTracks().some(t => t.readyState === 'live')) return Promise.resolve();
    if (this.opening) return this.opening;
    if (this.stream) this.close();   // (an ended one — another app took the microphone: its node goes too)
    const gen = this.gen;
    this.opening = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (gen !== this.gen) { for (const t of stream.getTracks()) t.stop(); return; }
        this.stream = stream;
        const ctx = audioCtx();
        if (ctx) {
          this.node = ctx.createMediaStreamSource(stream);
          this.an = ctx.createAnalyser(); this.an.fftSize = 1024; this.buf = new Float32Array(this.an.fftSize);
          this.node.connect(this.an);
        }
      } finally { if (gen === this.gen) this.opening = null; }
    })();
    return this.opening;
  }
  level() { return this.an ? levelOf(this.an, this.buf) : 0; }
  start() {
    this.cancel();
    const mime = recordMime();
    const rec = this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    this.chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.t0 = performance.now();
    rec.start(1000);   // (pieces each second: some browsers give nothing otherwise)
  }
  get recording() { return this.rec?.state === 'recording'; }
  get elapsed() { return this.recording ? performance.now() - this.t0 : 0; }
  /** Ends the recording: { blob, seconds }. */
  stop() {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve({ blob: new Blob([]), seconds: 0 });
    const seconds = (performance.now() - this.t0) / 1000;
    return new Promise(resolve => {
      rec.onstop = () => { this.rec = null; resolve({ blob: new Blob(this.chunks, { type: (rec.mimeType || recordMime() || 'audio/webm').split(';')[0] }), seconds }); };
      try { rec.requestData?.(); } catch { /* not recording */ }
      rec.stop();
    });
  }
  /** Drops the recording. */
  cancel() {
    const rec = this.rec; this.rec = null;
    if (rec && rec.state !== 'inactive') { rec.ondataavailable = null; rec.onstop = null; try { rec.stop(); } catch { /* over */ } }
  }
  /** Lets the microphone go (its light goes off; a phone plays sound loud again). */
  close() {
    this.gen++; this.opening = null;
    this.cancel();
    try { this.node?.disconnect(); } catch { /* gone */ }
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null; this.node = null; this.an = null;
  }
}

/** The browser's own recognition in our words. */
function earWords(err) {
  return ({ 'not-allowed': 'Allow the microphone for this site to talk.', 'service-not-allowed': 'This browser doesn\'t allow its speech recognition here.',
    network: 'The browser\'s speech recognition can\'t be reached right now.', 'audio-capture': 'No microphone was found on this device.',
    'language-not-supported': 'The browser can\'t listen in that language.' })[err] || 'The browser couldn\'t listen.';
}
/** The browser's own speech recognition: start() resolves the words heard when it ends (stop(): now; abort(): nothing). */
export class BrowserEar {
  constructor({ lang = '', continuous = false, onWords = null } = {}) { Object.assign(this, { lang, continuous, onWords }); this.aborted = false; }
  start() {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = this.r = new R();
    r.lang = this.lang || navigator.language || 'en-US';
    r.interimResults = true; r.continuous = this.continuous; r.maxAlternatives = 1;
    let final = '', interim = '', err = null;
    return new Promise((resolve, reject) => {
      r.onresult = e => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; }
        this.onWords?.(`${final}${interim}`.trim());
      };
      r.onerror = e => { err = e.error; };
      r.onend = () => {
        if (this.aborted) return resolve('');
        const words = `${final}${interim}`.replace(/\s+/g, ' ').trim();
        if (err && err !== 'no-speech' && err !== 'aborted' && !words) reject(Object.assign(new Error(earWords(err)), { code: `browser_${err}` }));
        else resolve(words);
      };
      try { r.start(); } catch (e) { reject(Object.assign(new Error(earWords('')), { cause: e })); }
    });
  }
  stop() { try { this.r?.stop(); } catch { /* over */ } }
  abort() { this.aborted = true; try { this.r?.abort(); } catch { /* over */ } }
}
