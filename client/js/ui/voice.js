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
import { TurnTaker, PauseHabit, sounds, PATIENCE, PATIENCE_DEFAULT, MORE_MS, WAIT_MAX } from './voice-core.js';

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

// (the loudness measured on the audio thread, one module a page's audio context: voice-meter.worklet.js)
const METERS = new WeakMap();
/** The microphone: its loudness, and recordings of it (one at a time). onLevel(rms, ms, pcm), when set, hears it every 20 ms
 *  from the audio thread (meter: set) — its loudness, how long, and the sound at 16 kHz — exact however busy the page is. */
export class Mic {
  constructor() { this.stream = null; this.opening = null; this.gen = 0; this.meter = null; this.onLevel = null; }
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
          // (the sound on the audio thread: waited for a moment, so a conversation's first turn has it too)
          await Promise.race([this.meterOn(ctx, gen), new Promise(r => setTimeout(r, 2000))]);
        }
      } finally { if (gen === this.gen) this.opening = null; }
    })();
    return this.opening;
  }
  /** The loudness measured on the audio thread (voice-meter.worklet.js), once its module is loaded: then onLevel hears it.
   *  An older browser has none: the page reads the loudness itself (level()). */
  async meterOn(ctx, gen) {
    if (!ctx.audioWorklet || typeof AudioWorkletNode !== 'function') return;
    try {
      if (!METERS.has(ctx)) METERS.set(ctx, ctx.audioWorklet.addModule(new URL('./voice-meter.worklet.js', import.meta.url).href));
      await METERS.get(ctx);
      if (gen !== this.gen || !this.node || this.meter) return;
      const m = new AudioWorkletNode(ctx, 'mvw-voice-meter', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { ms: 20 } });
      m.port.onmessage = e => { const d = e.data; if (this.meter === m && this.onLevel) this.onLevel(d[0], d[1], d[2]); };
      this.node.connect(m); this.meter = m;
      if (debugOn()) console.debug('[voice] the loudness is measured on the audio thread');
    } catch (e) { this.meter = null; if (debugOn()) console.debug(`[voice] the loudness is read by the page (${e && e.message})`); }
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
  /** What it has recorded so far, while it goes on recording: { blob, seconds } — or null (not recording, or the browser
   *  gave nothing in time). The pieces so far are the start of the same file, so a voice service hears them as one. */
  snapshot(waitMs = 800) {
    const rec = this.rec;
    if (!rec || rec.state !== 'recording') return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true; clearTimeout(dog); rec.removeEventListener('dataavailable', on);
        resolve(ok && this.rec === rec && this.chunks.length ? { blob: new Blob(this.chunks, { type: (rec.mimeType || recordMime() || 'audio/webm').split(';')[0] }), seconds: (performance.now() - this.t0) / 1000 } : null);
      };
      // (ondataavailable, set when it started, keeps the piece first; this listener then takes all of them)
      const on = () => finish(true);
      const dog = setTimeout(() => finish(false), waitMs);
      rec.addEventListener('dataavailable', on);
      try { rec.requestData(); } catch { finish(false); }
    });
  }
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
    if (this.meter) { this.meter.port.onmessage = null; try { this.meter.disconnect(); } catch { /* gone */ } }
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null; this.node = null; this.an = null; this.meter = null;
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

// ------------------------------------------------------------------------------------------------ a live conversation's ear
const HABIT_KEY = 'mvw.voice.pauses';
/** The pauses this person makes while talking, as learned on this device (one list a way of listening). */
export function pauseHabit(source = 'server') {
  try { return new PauseHabit(JSON.parse(localStorage.getItem(`${HABIT_KEY}.${source}`) || '[]')); } catch { return new PauseHabit(); }
}
function keepHabit(source, habit) { try { localStorage.setItem(`${HABIT_KEY}.${source}`, JSON.stringify(habit)); } catch { /* private mode */ } }
/** Forgets what was learned of this person's pauses on this device (Settings → Voice). */
export function forgetPauses() { try { for (const s of ['server', 'browser']) localStorage.removeItem(`${HABIT_KEY}.${s}`); } catch { /* none */ } }

/** Live voice's own log, for finding out why a turn ended when it did: localStorage 'mvw.voice.debug' = '1' (the console). */
const debugOn = () => { try { return localStorage.getItem('mvw.voice.debug') === '1'; } catch { return false; } };
export const PCM_RATE = 16000;   // (the sound from the audio thread: voice-meter.worklet.js)
/** Pieces of 16 kHz 16-bit sound as one WAV file. */
export function wavOf(pieces) {
  let n = 0;
  for (const p of pieces) n += p.length;
  const b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, PCM_RATE, true); v.setUint32(28, PCM_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  const out = new Int16Array(b, 44, n);
  let k = 0;
  for (const p of pieces) { out.set(p, k); k += p.length; }
  return new Blob([b], { type: 'audio/wav' });
}
const CHECK_FULL_S = 15;         // the words of a pause: all of the turn up to this long (they are then the turn's words) …
const CHECK_TAIL_S = 10;         // … else its last seconds (enough to tell how the thought ends)
const PRE_MS = 400;              // kept from before the talking started (its first sound, under the start's threshold)
const BETWEEN_MS = 8000;         // the sound right after a turn ended, kept for a turn that begins at once (watching)
const MORE_MS_TALK = 450;        // talking again while the answer is thought: this much of it stops the answer
const IDLE_RESTART_MS = 8000;    // nobody talking: the recording starts over this often (silence isn't sent to be heard)
const CHECKS_MAX = 8;            // its words checked at most this often in one turn
const CHECK_AFTER_MS = 700;      // … and only after this much more talking since the last check

/**
 * One person's turns in a live conversation (🎧 voice mode in a chat, the companions' voice): turn() listens until they
 * have finished — their patience, their habit and their words so far (voice-core.js TurnTaker) — and resolves what they
 * said: { text, seconds, why: 'end' | 'tap' | 'limit' | 'idle' } (idle: nobody spoke for idleMs; text '') — or null when
 * cancelled. A voice service hears a recording (the words of a pause are checked while they go on — the same words then
 * answer at once when it was the end); the browser's own recognition is followed word by word.
 * o: { source 'server'|'browser', language, patience, smart (check the words of a pause), learn (their habit),
 *      maxSeconds, idleMs, onState(state, info) — 'listening' | 'heard' | 'pause' {progress} | 'hearing' | 'limit' {left},
 *      onWords(words) — the browser's recognition: what it has heard so far }.
 * Errors from the microphone or the voice service reject turn() (code use_browser: the caller may switch to the browser).
 */
export class LiveEar {
  constructor(o = {}) {
    this.o = { source: 'server', language: '', patience: PATIENCE_DEFAULT, smart: true, learn: true, maxSeconds: 300, idleMs: 40000, onState: null, onWords: null, ...o };
    this.mic = null; this.ear = null; this.T = null; this.gen = 0; this.between = []; this.betweenMs = 0; this.lastEnd = null;
    this.habit = this.o.learn ? pauseHabit(this.o.source) : null;
  }
  set(o) {
    const was = this.o.source;
    Object.assign(this.o, o);
    if (o.source && o.source !== was) this.habit = this.o.learn ? pauseHabit(this.o.source) : null;
    if (o.learn === false) this.habit = null; else if (o.learn === true && !this.habit) this.habit = pauseHabit(this.o.source);
  }
  state(s, info = {}) { if (this.T?.watch && !this.T.talked && s !== 'more') return; try { this.o.onState?.(s, info); } catch { /* the page's */ } }
  /** The pause that ends a turn, now (ms). */
  get waitMs() { return this.T?.tt ? this.T.tt.waitMs : Math.max(PATIENCE[this.o.patience] || PATIENCE[PATIENCE_DEFAULT], this.habit?.need() || 0); }
  /** How loud it is now (0–1, the microphone's level; the browser's recognition: a gentle pulse while it hears words). */
  level() { return this.mic ? this.mic.level() : this.ear && this.T?.words ? 0.04 + 0.03 * Math.sin(performance.now() / 120) : 0; }
  get talking() { return !!this.T?.tt?.started || !!this.T?.words; }
  /** Whether the microphone is open already (the next turn starts at once). */
  get open() { return !!this.mic?.stream; }

  /**
   * One turn. watch: right after a turn, while its answer is being thought (nothing playing yet) — silent unless the person
   * starts talking again (they had not finished): onMore() is called once they clearly do (the caller stops the answer),
   * and the turn goes on as any other, from their first word — what they said since the last turn ended is kept.
   */
  turn({ watch = false, onMore = null } = {}) {
    this.cancel();
    const T = this.T = { gen: ++this.gen, resolve: null, reject: null, checks: 0, checkedAt: -Infinity, check: null, words: '', tt: null, watch: !!watch, onMore, talked: false };
    const p = new Promise((resolve, reject) => { T.resolve = resolve; T.reject = reject; });
    (this.o.source === 'browser' ? this.browserTurn(T) : this.serverTurn(T)).catch(e => this.fail(T, e));
    return p;
  }
  /** The person is done (a tap): what they said goes now. */
  send() {
    const T = this.T;
    if (!T) return;
    if (T.ear) { T.sent = true; T.ear.stop(); return; }
    if (T.tt) this.finish(T, 'tap');
  }
  /** Drops the turn (turn() resolves null); the microphone stays open for the next. */
  cancel() {
    const T = this.T;
    if (!T) return;
    this.T = null;
    clearInterval(T.loop); T.loop = null;
    if (T.ear) { T.ear.abort(); T.ear = null; }
    this.ear = null;
    this.mic?.cancel();
    T.resolve(null);
  }
  /** Lets the microphone go (its light goes off; a phone plays sound loud again). */
  close() { this.cancel(); this.mic?.close(); this.mic = null; }
  done(T, v) { if (this.T !== T) return; this.T = null; clearInterval(T.loop); T.loop = null; T.resolve(T.watch && v ? { ...v, more: !!T.talked } : v); }
  fail(T, e) { if (this.T !== T) return; this.T = null; clearInterval(T.loop); T.loop = null; this.mic?.cancel(); T.reject(e); }

  // -------------------------------------------------------------------------------------------- a voice service hears it
  async serverTurn(T) {
    const mic = this.mic || (this.mic = new Mic());
    await mic.open();
    if (this.T !== T) return;
    T.tt = new TurnTaker({ patience: PATIENCE[this.o.patience] ? this.o.patience : PATIENCE_DEFAULT, habit: this.habit, maxMs: Math.max(10, Number(this.o.maxSeconds) || 300) * 1000 - 5000 });
    T.debug = debugOn(); T.idle = performance.now(); T.quietFor = 0; T.warned = false; T.shown = -1;
    if (T.debug) console.debug(`[voice] a turn${T.watch ? ' (watching while the answer is thought)' : ''}: ${this.between.length} pieces kept since the last`);
    // the turn's sound: from the audio thread (exact, its own timing; T.pcm: [pcm, ms]); an older browser: a recording
    T.pcmMode = !!mic.meter; T.pcm = []; T.pre = []; T.preMs = 0;
    if (!T.pcmMode) mic.start();
    T.t0 = performance.now(); T.heardMs = 0;
    this.state('listening');   // (only now: what is said from here on is kept)
    if (!mic.onLevel) mic.onLevel = (lv, ms, pcm) => this.level20(lv, ms, pcm);
    // (a turn right after the last: the sound since that one ended goes first — words said meanwhile are kept)
    if (T.watch && T.pcmMode) for (const r of this.between.splice(0)) this.level20(...r);
    this.between = []; this.betweenMs = 0;
    let last = performance.now();
    T.loop = setInterval(() => {
      if (this.T !== T || T.finishing) return;
      const now = performance.now(), dt = now - last; last = now;
      // (no sound from the audio thread: the loudness read here, and a late read never counts for more than a moment of
      //  quiet — it waits longer rather than cut someone off)
      if (!T.metered) this.stepT(T, mic.level(), Math.min(120, dt));
      const tt = T.tt;
      if (!tt.started && now - T.idle > IDLE_RESTART_MS) {
        // nobody spoke: a recording starts over (silence isn't sent to be heard), and after a while it says so
        T.quietFor += now - T.idle; T.idle = now;
        if (T.quietFor >= this.o.idleMs && !T.watch) { mic.cancel(); this.done(T, { text: '', seconds: 0, why: 'idle' }); }
        else if (!T.pcmMode) { mic.start(); tt.reset(); }
      }
    }, 50);
  }
  /** 20 ms of the microphone from the audio thread: to the turn being listened for — or, between turns, kept a moment
   *  (the next turn may begin with it: someone who goes on talking right after their turn ended). */
  level20(lv, ms, pcm) {
    const T = this.T;
    if (!T || !T.tt || T.finishing) {
      this.between.push([lv, ms, pcm]); this.betweenMs += ms;
      while (this.betweenMs > BETWEEN_MS && this.between.length > 1) this.betweenMs -= this.between.shift()[1];
      return;
    }
    T.metered = true;
    if (T.pcmMode && pcm) {
      if (T.tt.started) T.pcm.push([pcm, ms]);
      else { T.pre.push([pcm, ms]); T.preMs += ms; while (T.preMs > PRE_MS && T.pre.length > 1) T.preMs -= T.pre.shift()[1]; }
    }
    this.stepT(T, lv, ms);
  }
  /** One reading of the loudness (and how long it lasted) through the turn. */
  stepT(T, lv, dt) {
    const tt = T.tt, ev = tt.step(lv, dt);
    T.heardMs += dt;
    if (T.debug) { T.dms = (T.dms || 0) + dt; if (ev || T.dms >= 1000) { T.dms = 0; console.debug(`[voice] ${ev || '·'} at ${(T.heardMs / 1000).toFixed(2)} s (read ${Math.round(performance.now() - T.t0 - T.heardMs)} ms late) level ${lv.toFixed(4)} floor ${(tt.floor ?? 0).toFixed(4)} keep ${tt.keep.toFixed(4)} talk ${tt.talk.toFixed(4)} quiet ${Math.round(tt.quiet)} wait ${tt.waitMs} words ${tt.kind || '-'}${tt.pending ? ' (checking)' : ''}`); } }
    // (watching while the answer is thought: only someone clearly talking again — not a cough, a door, a voice from the
    //  street — stops it: half a second of words. The pause before it was one of theirs: learned as longer than it was let be)
    if (T.watch && !T.talked && tt.started && tt.voiced >= MORE_MS_TALK) {
      T.talked = true;
      if (this.habit && this.lastEnd) { this.habit.add(this.lastEnd.quiet + T.heardMs - tt.voiced + 400); keepHabit(this.o.source, this.habit); }
      try { T.onMore?.(); } catch { /* the caller's */ }
      this.state('heard');
    }
    if (ev === 'speech') { T.quietFor = 0; if (T.pcmMode) { T.pcm = T.pre; T.pre = []; T.preMs = 0; } this.state('heard'); }
    else if (ev === 'pause') this.check(T);
    else if (ev === 'resume') { T.check = null; tt.words(null); this.state('heard'); T.shown = -1; }
    else if ((ev === 'end' || ev === 'limit') && T.watch && !T.talked) { tt.reset(); T.pcm = []; T.pre = []; T.preMs = 0; }   // (a sound, not someone talking again: still watching)
    else if (ev === 'end' || ev === 'limit') this.finish(T, ev);
    else if (ev === 'noise') { tt.reset(); T.pcm = []; if (!T.pcmMode) this.mic?.start(); T.idle = performance.now(); this.state('listening'); }
    else if (tt.started) {
      // (the pause, as it goes on: the page may show how near the end it is — a step at a time, not every reading)
      if (tt.quiet > 300) { const pr = Math.round(tt.progress * 20) / 20; if (pr !== T.shown) { T.shown = pr; this.state('pause', { progress: pr, waitMs: tt.waitMs }); } }
      else if (tt.quiet === 0 && T.shown !== -1) { T.shown = -1; this.state('heard'); }
      const left = tt.maxMs - tt.long;
      if (!T.warned && left < 30000) { T.warned = true; this.state('limit', { left: Math.round(left / 1000) }); }
    }
  }
  /** The turn's sound so far: { blob, seconds, full } — all of it, or its last `tailS` seconds (full: false). */
  sound(T, { tailS = 0, trimMs = 0 } = {}) {
    let parts = T.pcm.slice();
    // (the end's own pause, but a breath of it, is not sent)
    let cut = Math.max(0, trimMs);
    while (cut > 0 && parts.length > 1) { const [, ms] = parts[parts.length - 1]; if (ms > cut) break; cut -= ms; parts.pop(); }
    let ms = parts.reduce((n, p) => n + p[1], 0);
    const full = !tailS || ms <= tailS * 1000;
    if (!full) { let keep = 0, i = parts.length; while (i > 0 && keep < tailS * 1000) keep += parts[--i][1]; parts = parts.slice(i); ms = keep; }
    return { blob: wavOf(parts.map(p => p[0])), seconds: ms / 1000, full };
  }
  /** The words of this pause: heard while the pause goes on, so the end knows whether the thought was finished — and when it
   *  was (and they are all of the turn), they are already the answer. */
  async check(T) {
    const tt = T.tt;
    if (!this.o.smart || T.checks >= CHECKS_MAX || tt.voiced < tt.minSpeechMs || tt.voiced - T.checkedAt < CHECK_AFTER_MS) return;
    T.checks++; T.checkedAt = tt.voiced;
    const c = T.check = { at: tt.voiced, text: null, ok: false, done: false, full: false };
    tt.checking();
    const snap = T.pcmMode ? this.sound(T, { tailS: T.pcm.reduce((n, p) => n + p[1], 0) > CHECK_FULL_S * 1000 ? CHECK_TAIL_S : 0, trimMs: tt.quiet - 250 }) : await this.mic?.snapshot();
    if (this.T !== T || T.check !== c) return;
    if (!snap) { c.done = true; tt.words(null); T.check = null; if (T.waiting) T.waiting(); return; }
    c.full = snap.full !== false;
    const t0 = performance.now();
    try {
      const r = await hear(snap.blob, { seconds: snap.seconds, language: this.o.language });
      c.text = String(r.text || '').trim(); c.ok = true;
    } catch (e) { c.ok = false; c.error = e && e.message; }
    c.done = true;
    if (T.debug) console.debug(`[voice] words of the pause in ${Math.round(performance.now() - t0)} ms (${Math.round(snap.seconds * 10) / 10} s heard${c.full ? '' : ', its end'}): ${c.ok ? `"${c.text.slice(-60)}" → ${sounds(c.text) || 'no telling'}` : `failed: ${c.error}`}`);
    if (this.T !== T || T.check !== c) return;
    if (tt.voiced === c.at) tt.words(c.ok ? c.text : null); else tt.words(null);
    if (T.waiting) T.waiting();
  }
  async finish(T, why) {
    if (this.T !== T || T.finishing) return;
    T.finishing = true;
    // (from here the sound is the next turn's: kept, from the end of this one — however long hearing it takes)
    this.between = []; this.betweenMs = 0;
    clearInterval(T.loop); T.loop = null;
    const tt = T.tt;
    this.state('hearing');
    // (the words of this very pause, still being heard: they are the turn when nothing was said since — wait for them)
    let c = T.check;
    if (c && !c.done && c.at === tt.voiced) {
      await new Promise(r => { T.waiting = r; setTimeout(r, 4000); });
      T.waiting = null;
      if (this.T !== T) return;
      c = T.check;
    }
    this.lastEnd = { quiet: why === 'end' ? tt.quiet : 0 };
    const cut = why !== 'tap' && why !== 'limit' && sounds(c?.text) === 'incomplete';
    if (cut && this.habit) this.habit.add(tt.waitMs + 700);   // (it ended mid-thought: they needed longer)
    if (this.habit) keepHabit(this.o.source, this.habit);
    if (c && c.ok && c.full && c.at === tt.voiced && c.text) {
      if (!T.pcmMode) this.mic?.cancel();
      return this.done(T, { text: c.text, seconds: T.heardMs / 1000, why, early: true });
    }
    let snap;
    if (T.pcmMode) {
      if (!tt.started || !T.pcm.length) return this.done(T, { text: '', seconds: 0, why });
      snap = this.sound(T, { trimMs: why === 'end' ? tt.quiet - 300 : 0 });
    } else {
      if (!this.mic?.recording) return this.done(T, { text: '', seconds: 0, why });
      snap = await this.mic.stop();
      if (this.T !== T) return;
      if (snap.seconds < 0.3 || !tt.started) return this.done(T, { text: '', seconds: snap.seconds, why });
    }
    const r = await hear(snap.blob, { seconds: snap.seconds, language: this.o.language });
    if (this.T !== T) return;
    const text = String(r.text || '').trim();
    if (why === 'end' && this.habit && !cut && sounds(text) === 'incomplete') { this.habit.add(tt.waitMs + 700); keepHabit(this.o.source, this.habit); }
    this.done(T, { text, seconds: snap.seconds, why });
  }

  // -------------------------------------------------------------------------------------------- the browser hears it
  /** The browser's recognition, word by word: the turn ends after a pause in the words as long as the wait (the same
   *  patience, habit and words-so-far); when the browser stops listening by itself mid-turn, it listens again and the
   *  words go on. */
  async browserTurn(T) {
    if (!can.recognize()) throw Object.assign(new Error('This browser can\'t listen.'), { code: 'no_ears' });
    this.mic?.close(); this.mic = null;   // (the browser's recognition takes the microphone itself)
    this.state('listening');
    const habit = this.habit, base = () => Math.max(PATIENCE[this.o.patience] || PATIENCE[PATIENCE_DEFAULT], habit?.need() || 0);
    const t0 = performance.now();
    let before = '', changed = 0, lastWords = '', restarts = 0, warned = false, shown = -1;
    T.tt = null;
    const wait = () => (sounds(T.words) === 'incomplete' ? Math.min(WAIT_MAX, base() + MORE_MS) : base());
    for (;;) {
      const ear = T.ear = this.ear = new BrowserEar({ lang: this.o.language, continuous: true, onWords: w => {
        if (this.T !== T) return;
        const all = `${before} ${w}`.trim();
        if (all !== lastWords) {
          const now = performance.now();
          if (lastWords && changed && now - changed >= 600 && habit) habit.add(now - changed);   // (a pause they went on after)
          if (!T.words) this.state('heard');
          lastWords = all; T.words = all; changed = now; shown = -1;
          // (watching while the answer is thought: two words or more is someone talking again — the answer stops)
          if (T.watch && !T.talked && all.split(/\s+/).length >= 2) { T.talked = true; try { T.onMore?.(); } catch { /* the caller's */ } this.state('heard'); }
          try { this.o.onWords?.(all); } catch { /* the page's */ }
        }
      } });
      clearInterval(T.loop);
      T.loop = setInterval(() => {
        if (this.T !== T) return;
        const now = performance.now();
        if (!T.words) {
          if (now - t0 >= this.o.idleMs && !T.watch) { ear.abort(); this.done(T, { text: '', seconds: 0, why: 'idle' }); }
          return;
        }
        const quiet = now - changed, w = wait();
        if (quiet >= w) { T.sent = true; T.why = 'end'; ear.stop(); return; }
        const pr = Math.round(Math.min(1, quiet / w) * 20) / 20;
        if (quiet > 400 && pr !== shown) { shown = pr; this.state('pause', { progress: pr, waitMs: w }); }
        const left = this.o.maxSeconds * 1000 - 5000 - (now - t0);
        if (left <= 0) { T.sent = true; T.why = 'limit'; ear.stop(); }
        else if (!warned && left < 30000) { warned = true; this.state('limit', { left: Math.round(left / 1000) }); }
      }, 100);
      const words = await ear.start();
      if (this.T !== T) return;
      const all = `${before} ${words || ''}`.trim();
      // (the browser stopped by itself in the middle of the turn — a long pause, its own limit: it listens on)
      if (!T.sent && all && performance.now() - changed < wait() && restarts < 20) { before = all; restarts++; continue; }
      if (!T.sent && !all && performance.now() - t0 < this.o.idleMs && restarts < 200) { restarts++; continue; }
      clearInterval(T.loop); T.loop = null; T.ear = null; this.ear = null;
      if (habit) keepHabit('browser', habit);
      this.state('hearing');
      return this.done(T, { text: all, seconds: (performance.now() - t0) / 1000, why: all ? (T.why || 'tap') : 'idle' });
    }
  }
}
