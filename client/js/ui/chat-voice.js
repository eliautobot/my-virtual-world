// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window's voice (docs/features/CHAT.md §9.4), on the server's voice (§9.3):
// - 🎤 dictation in the composer: a recording heard by the voice service, or the browser's own recognition (its choice,
//   none set up, the plan's minutes used); the words go where the cursor was.
// - 🔊 read aloud under every answer: the answer's parts from the voice service in turn, each fetched while the one before
//   plays; Stop. When the browser is to read it, the browser's own voice reads the text the server made pronounceable.
// - 🎧 voice mode: a conversation right in the chat (2026-10-08: no window of its own) - listening, the end of talking
//   found from a second of quiet (or a tap on its status), thinking, then the answer spoken sentence by sentence while it
//   is still being written; what is said shows in the chat as messages. 🎧 again ends it; 🎤 mutes and unmutes; its status
//   beside them says what it is doing (tap: done talking, interrupt, talk). It never stops mid-conversation: when the
//   plan's minutes run out or a service fails, the browser's own voice and recognition carry on.
// - Seen while it talks (2026-10-08): a blue glow that pulses with the sound - the voice mode button, the top edge of
//   the message box and the agent's name over its head in the world in voice mode; for read aloud, its name in the world
//   and the blue stop square of the answer being read (not the voice mode button).
// chat.js owns the window and hands over a host: who the agent is, the open chat, sending a message, Stop, the answer.
import { h, esc } from '../core/util.js';
import { bus } from '../core/state.js';
import { render } from './chat-md.js';
import { Segmenter, takeUnits, Vad } from './voice-core.js';
import { can, options, hear, speak, unlock, Player, SpeechQueue, Mic, BrowserEar, micWords } from './voice.js';

const touchScreen = () => matchMedia('(pointer: coarse)').matches;
/** The world's sounds turned down while the page listens (audio/ambience.js), and back after. */
const duck = (who, on) => bus.emit('audio:duck', { who, on });
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const NO_EARS = 'This browser can\'t listen. Use Chrome, Edge or Safari, or add a voice service in Settings → Voice.';

/** A pronounceable text made in the page (only when the voice service failed and the browser reads instead). */
function plain(md) {
  const t = document.createElement('template');
  t.innerHTML = render(String(md || '')).html;
  t.content.querySelectorAll('.md-code, pre').forEach(x => x.replaceWith(' (a code block) '));
  t.content.querySelectorAll('table').forEach(x => x.replaceWith(' (a table) '));
  return t.content.textContent.replace(/\s+/g, ' ').trim();
}

/** Who listens and who speaks for this agent, from the server, and what this browser can do. */
async function modesFor(agentId) {
  let o = null;
  try { o = await options(agentId); } catch { /* the server will say on the first call */ }
  const ears = o ? o.listen.source !== 'browser' : true;
  const listen = ears && can.record() ? 'server' : can.recognize() ? 'browser' : null;
  const speakMode = o && o.speak.source === 'browser' ? (can.synth() ? 'browser' : 'none') : 'server';
  return { o, listen, speak: speakMode, language: o?.listen?.language || o?.prefs?.listen?.language || '', browserVoice: o?.speak?.browserVoice || o?.prefs?.browserVoice || '', rate: Number(o?.speak?.speed) || 1 };
}

/** Wires voice into the window. host: { el, agentId, agent, session, input, grow, paintSend, toast, say(text), stop(), run(),
 *  claimVoice() - it begins to listen or speak: the other chat windows stop theirs }. */
export function attach(host) {
  const V = { D: null, RA: null, VM: null };
  // (the window's element, kept: as the window closes, what stops - reading, a conversation - still finds its parts)
  const root = host.el;
  const box = root.querySelector('.cw-box');
  const strip = box.appendChild(h(`<div class="cw-rec hidden" role="group" aria-label="Dictation">
    <button type="button" class="cw-rec-x" title="Cancel (Esc)" aria-label="Cancel">✕</button>
    <span class="cw-rec-dot" aria-hidden="true"></span><span class="cw-rec-wave" aria-hidden="true">${'<i></i>'.repeat(28)}</span>
    <span class="cw-rec-t" aria-live="off">0:00</span><span class="cw-rec-s"></span>
    <button type="button" class="cw-rec-ok" title="Done (Enter)" aria-label="Done">✓</button></div>`));
  const mic = root.querySelector('.cw-mic'), vm = root.querySelector('.cw-vm'), pill = root.querySelector('.cw-vm-state');
  const ears = can.record() || can.recognize();
  mic.classList.toggle('hidden', !ears); vm.classList.toggle('hidden', !ears);
  // (in voice mode 🎤 mutes and unmutes the conversation; otherwise it dictates)
  mic.onclick = () => (V.VM ? V.VM.mute(!V.VM.muted) : V.D ? finishDictation() : startDictation());
  vm.onclick = () => (V.VM ? V.VM.end() : openVoiceMode());
  pill.onclick = () => V.VM?.tap();
  strip.querySelector('.cw-rec-x').onclick = () => cancelDictation();
  strip.querySelector('.cw-rec-ok').onclick = () => finishDictation();

  // ---------------------------------------------------------------------------------------------- dictation
  const bars = [...strip.querySelectorAll('.cw-rec-wave i')], hist = new Array(bars.length).fill(0);
  function showStrip(on, status = '') {
    strip.classList.toggle('hidden', !on);
    box.classList.toggle('dictating', on);
    strip.querySelector('.cw-rec-s').textContent = status;
    mic.classList.toggle('on', on);
    mic.setAttribute('aria-pressed', String(on));
  }
  async function startDictation() {
    if (V.D || V.VM) return;
    host.claimVoice?.();   // (one window listens at a time: the others' stop)
    const input = host.input();
    const D = V.D = { before: input.value.slice(0, input.selectionStart ?? input.value.length), after: input.value.slice(input.selectionEnd ?? input.value.length), t0: performance.now(), busy: false };
    showStrip(true, 'Starting…');
    duck('dictation', true);
    const m = await modesFor(host.agentId);
    if (V.D !== D) return;
    D.lang = m.language;
    if (!m.listen) { endDictation(); return host.toast(NO_EARS, 'bad'); }
    D.mode = m.listen;
    if (D.mode === 'server') {
      D.mic = new Mic();
      try { await D.mic.open(); } catch (e) { if (V.D !== D) return; endDictation(); return host.toast(micWords(e), 'bad'); }
      if (V.D !== D) { D.mic.close(); return; }
      D.mic.start(); D.t0 = performance.now();
      showStrip(true, '');
      D.timer = setInterval(() => tick(D), 70);
    } else browserDictation(D);
  }
  function browserDictation(D) {
    D.mode = 'browser';
    showStrip(true, 'Listening (browser)');
    D.t0 = performance.now();
    D.timer = setInterval(() => tick(D), 70);
    D.ear = new BrowserEar({ lang: D.lang, continuous: true, onWords: w => { if (V.D === D) { put(D, w); } } });
    D.ear.start().then(words => { if (V.D !== D) return; put(D, words); endDictation(true); }, e => { if (V.D !== D) return; host.toast(e.message, 'bad'); put(D, ''); endDictation(); });
  }
  function tick(D) {
    const secs = (performance.now() - D.t0) / 1000;
    strip.querySelector('.cw-rec-t').textContent = fmt(secs);
    const lv = D.mic ? Math.min(1, D.mic.level() * 9) : 0.15 + 0.15 * Math.abs(Math.sin(secs * 5));
    hist.push(lv); hist.shift();
    bars.forEach((b, k) => { b.style.transform = `scaleY(${Math.max(0.08, hist[k])})`; });
    if (secs > 295) finishDictation();   // (a recording may be at most 5 minutes)
  }
  /** The words where the cursor was. */
  function put(D, words) {
    const input = host.input(), w = String(words || '').trim();
    const pre = D.before && w && !/\s$/.test(D.before) ? ' ' : '', post = D.after && w && !/^\s/.test(D.after) ? ' ' : '';
    input.value = `${D.before}${pre}${w}${post}${D.after}`;
    const at = (D.before + pre + w).length;
    try { input.setSelectionRange(at, at); } catch { /* not focused */ }
    host.grow(); host.paintSend();
  }
  async function finishDictation() {
    const D = V.D;
    if (!D || D.busy) return;
    if (D.mode === 'browser') { D.ear?.stop(); return; }
    if (!D.mic?.recording) { endDictation(); return; }
    D.busy = true; clearInterval(D.timer);
    showStrip(true, 'Hearing…');
    strip.classList.add('busy');
    const { blob, seconds } = await D.mic.stop();
    D.mic.close();
    try {
      const r = await hear(blob, { seconds, language: D.lang });
      if (V.D !== D) return;
      if (!String(r.text || '').trim()) host.toast('Nothing was heard. Try again a little closer to the microphone.', '', 3200, '🎤');
      put(D, r.text); endDictation(true);
    } catch (e) {
      if (V.D !== D) return;
      strip.classList.remove('busy');
      if ((e.code === 'use_browser' || e.fallback === 'browser') && can.recognize()) {
        host.toast(`${e.message}. Say it again: the browser listens now.`, '', 4200, '🎤');
        D.busy = false; D.mic = null; return browserDictation(D);
      }
      host.toast(e.message, 'bad'); endDictation();
    }
  }
  function cancelDictation() {
    const D = V.D;
    if (!D) return;
    D.ear?.abort();
    put(D, '');
    endDictation();
  }
  function endDictation(focus = false) {
    const D = V.D;
    if (!D) return;
    V.D = null;
    clearInterval(D.timer); D.mic?.close();
    duck('dictation', false);
    strip.classList.remove('busy');
    showStrip(false);
    if (focus && !touchScreen()) host.input().focus();
  }

  // ---------------------------------------------------------------------------------------------- read aloud
  function mark(id, on) {
    const b = root.querySelector(`.cw-msg[data-id="${id}"] [data-a="speak"]`);
    if (!b) return;
    b.classList.toggle('on', on); b.textContent = on ? '⏹' : '🔊';
    b.title = on ? 'Stop reading' : 'Read aloud'; b.setAttribute('aria-label', b.title);
  }
  async function readAloud(m) {
    if (!m?.id || !host.session) return;
    if (V.RA && V.RA.id === m.id) return stopReading();
    stopReading();
    host.claimVoice?.();   // (one window speaks at a time)
    unlock({ synth: true });
    const ra = V.RA = { id: m.id, abort: new AbortController(), queue: new SpeechQueue(), parts: 1, next: 1, lang: '', lv: 0 };
    mark(m.id, true);
    glowOn();
    const session = host.session.id;
    const as = r => (r.browser ? (can.synth() ? { text: r.text, browserVoice: r.browserVoice, rate: r.rate, lang: ra.lang } : null) : r);
    const fetchPart = k => speak({ session, message: m.id, part: k }, ra.abort.signal).then(as);
    const more = () => {
      if (V.RA !== ra) return;
      if (ra.next < ra.parts && ra.queue.waiting < 1) { const k = ra.next++; ra.queue.add(fetchPart(k), { k }); }
    };
    ra.queue.onPlay = () => more();
    ra.queue.onIdle = () => { if (V.RA === ra && ra.next >= ra.parts) stopReading(); };
    ra.queue.onError = e => { if (V.RA !== ra || e.name === 'AbortError') return; host.toast(e.message, 'bad'); stopReading(); };
    let first;
    try {
      const o = await options(host.agentId).catch(() => null);
      ra.lang = o?.listen?.language || '';
      first = as(await speak({ session, message: m.id, part: 0 }, ra.abort.signal));
    } catch (e) {
      if (V.RA !== ra || e.name === 'AbortError') return;
      // the voice service failed: the browser's own voice reads it (if it can)
      if (e.fallback === 'browser' && can.synth()) { host.toast(`${e.message}. The browser's voice reads it instead.`, '', 3500, '🔊'); ra.parts = 1; first = { text: plain(m.text), lang: ra.lang }; }
      else { host.toast(e.message, 'bad'); stopReading(); return; }
    }
    if (V.RA !== ra) return;
    if (!first) { host.toast('This browser can\'t speak.', 'bad'); stopReading(); return; }
    ra.parts = first.parts || ra.parts;
    ra.queue.add(Promise.resolve(first), { k: 0 });
  }
  function stopReading() {
    const ra = V.RA;
    if (!ra) return;
    V.RA = null;
    ra.abort.abort(); ra.queue.stop();
    mark(ra.id, false);
  }

  // ---------------------------------------------------------------------------------------------- voice mode
  function openVoiceMode() {
    if (V.VM) return;
    cancelDictation(); stopReading();
    host.claimVoice?.();   // (a conversation in one window: the others stop listening and speaking)
    unlock({ synth: true });   // (inside the tap: a phone lets sound start later)
    V.VM = new Conversation(host, { root, box, vm, mic, pill }, () => { V.VM = null; });
    V.VM.start();
    glowOn();
  }

  // ---------------------------------------------------------------------------------------------- the blue glow
  // While it talks - voice mode, or an answer read aloud - the glow follows how loud it is, every frame: in voice mode
  // the 🎧 button, the top edge of the message box and its name in the world; reading aloud, its name in the world and
  // the answer's blue stop square. The page's own frames, only while one of them is on.
  function glowOn() { if (!V.raf) V.raf = requestAnimationFrame(glowFrame); }
  function glowFrame() {
    V.raf = 0;
    const read = root.querySelector('.cw-msg [data-a="speak"].on');
    if (!V.VM && !V.RA) { host.labelGlow(null); vm.style.removeProperty('--lv'); box.style.removeProperty('--lv'); read?.style.removeProperty('--lv'); return; }
    let lv;
    if (V.VM) lv = V.VM.level();
    else { const raw = Math.min(1, V.RA.queue.player.level() * 6); V.RA.lv += (raw - V.RA.lv) * 0.35; lv = V.RA.lv; }
    const v = lv.toFixed(3);
    if (V.VM) { vm.style.setProperty('--lv', v); box.style.setProperty('--lv', v); }
    if (read) read.style.setProperty('--lv', v);
    host.labelGlow(lv);
    V.raf = requestAnimationFrame(glowFrame);
  }

  return {
    get dictating() { return !!V.D; },
    get readingId() { return V.RA?.id ?? null; },
    get voiceMode() { return !!V.VM; },
    finishDictation, cancelDictation, readAloud, stopReading, openVoiceMode,
    /** The answer being written (from chat.js): voice mode speaks it. */
    onRun(type, R, info) { V.VM?.onRun(type, R, info); },
    /** Another chat, or the window closes: everything stops (a conversation too: it was with that chat). */
    reset() { cancelDictation(); stopReading(); V.VM?.end(); },
    close() { cancelDictation(); stopReading(); V.VM?.end(); },
  };
}

// ------------------------------------------------------------------------------------------------ voice mode
const STATE_WORDS = { starting: 'Starting…', listening: 'Listening', heard: 'Listening…', hearing: 'Got it…', thinking: 'Thinking', speaking: 'Speaking', paused: 'Tap to talk', muted: 'Muted' };
// (listening needs nothing from the person: it answers when they pause - 2026-10-08: "a natural back and forth, not
// requiring a click to send"; a tap on the status still sends at once, said in its tooltip)
const ORB_LABEL = { listening: '', heard: '', hearing: '', thinking: 'tap to stop', speaking: 'tap to interrupt', paused: '', muted: 'unmute to talk', starting: '' };

/** A conversation in the chat window: its status beside the composer's buttons, what is said in the chat. */
class Conversation {
  constructor(host, ui, onEnd) {
    Object.assign(this, { host, ui, onEnd });
    this.player = new Player(); this.queue = new SpeechQueue(this.player);
    this.vad = new Vad({ silenceMs: 1000 });
    this.mic = null; this.ear = null; this.turn = null; this.state = 'starting'; this.muted = false; this.on = false;
    this.abort = new AbortController(); this.failures = 0; this.told = new Set(); this.lv = 0; this.quietMs = 0;
    this.queue.onPlay = info => { if (this.turn && info.turn === this.turn.n) { this.set('speaking'); this.pump(); } };
    this.queue.onIdle = () => this.maybeDone();
    this.queue.onError = () => this.maybeDone();
  }

  // -------------------------------------------------------------------------------------------- in the chat
  build() {
    this.on = true;
    duck('voice-mode', true);
    const { vm, box, mic, pill } = this.ui;
    vm.classList.add('vm-on'); vm.setAttribute('aria-pressed', 'true');
    vm.title = 'End the voice conversation (Esc)'; vm.setAttribute('aria-label', vm.title);
    box.classList.add('vm-on');
    mic.title = 'Mute the microphone (M)'; mic.setAttribute('aria-label', mic.title); mic.setAttribute('aria-pressed', 'false');
    pill.classList.remove('hidden');
    this.ui.root.querySelector('.chatwin')?.classList.add('voice-mode');
    this.keys = e => {
      if (!this.on) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.end(); }
      else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); this.mute(!this.muted); }
    };
    document.addEventListener('keydown', this.keys, true);
    this.vis = () => { if (document.hidden && (this.state === 'listening' || this.state === 'heard')) this.pause(); if (!document.hidden) this.wake(); };
    document.addEventListener('visibilitychange', this.vis);
  }
  set(state, sub = '') {
    this.state = state;
    if (!this.on) return;
    const pill = this.ui.pill, hint = sub || ORB_LABEL[state] || '';
    pill.dataset.state = state;
    this.ui.root.querySelector('.chatwin')?.setAttribute('data-vm', state);
    pill.innerHTML = `<i class="cw-vm-dot" aria-hidden="true"></i><b>${esc(STATE_WORDS[state] || state)}</b>${hint ? ` <small>· ${esc(hint)}</small>` : ''}`;
    pill.setAttribute('aria-label', `${STATE_WORDS[state] || state}${hint ? `, ${hint}` : ''}`);
    clearInterval(this.clock);
    if (state === 'thinking') { const t0 = performance.now(); this.clock = setInterval(() => { const e = (performance.now() - t0) / 1000; if (e > 3 && this.state === 'thinking') { const sm = pill.querySelector('small'); if (sm) sm.textContent = `· ${Math.round(e)} s · tap to stop`; } }, 1000); }
  }
  note(text) { if (this.on && text) this.host.toast(text, '', 6000, '🎧'); }
  /** A fallback said once a conversation (minutes used, a service down), not at every piece. */
  noteOnce(key, text) { if (this.told.has(key)) return; this.told.add(key); this.note(text); }
  /** What the browser's recognition hears so far, on its status. */
  you(text, live = false) { if (this.on && live && text) { const sm = this.ui.pill.querySelector('small'); if (sm) sm.textContent = `· “${text.length > 48 ? `…${text.slice(-47)}` : text}”`; } }
  caption() { /* (what it says is the answer in the chat) */ }
  src() {
    const m = this.m, o = m.o;
    const ear = m.listen === 'browser' ? 'the browser' : o?.listen?.service?.label || 'voice service';
    const mouth = m.speak === 'browser' ? 'the browser\'s voice' : m.speak === 'none' ? 'the chat only (this browser can\'t speak)' : `${o?.speak?.service?.label || 'voice service'}${o?.speak?.voice ? ` · ${o.speak.voice}` : ''}`;
    this.ui.pill.title = `Talk: it answers when you pause (a tap sends at once) · hears with ${ear} · speaks with ${mouth}`;
  }
  /** How loud it is now, smoothed (the microphone while it listens, its voice while it speaks): the blue glow. */
  level() {
    const raw = this.state === 'listening' || this.state === 'heard' ? (this.mic ? Math.min(1, this.mic.level() * 8) : this.ear ? 0.12 : 0) : this.state === 'speaking' ? Math.min(1, this.player.level() * 6) : 0;
    this.lv += (raw - this.lv) * 0.35;
    return this.lv;
  }

  // -------------------------------------------------------------------------------------------- the conversation
  async start() {
    this.build();
    this.set('starting');
    this.wake();
    this.m = await modesFor(this.host.agentId);
    if (!this.on) return;
    this.src();
    if (!this.m.listen) { this.note(NO_EARS); this.set('paused', 'Type in the chat instead'); return; }
    if (this.m.speak === 'none') this.note('This browser can\'t speak: the answers are shown here and in the chat.');
    // an answer already being written: it is spoken first
    const R = this.host.run();
    if (R) { this.newTurn(R.id); this.feed(R.text, false); this.set('thinking'); return; }
    this.listen();
  }
  /** Keeps the screen on while the conversation is open (the browser lets it go when the page is hidden: taken again on
   *  return; one that arrives after the end is let go at once). */
  async wake() {
    if (!this.on || this.waking || (this.lock && !this.lock.released) || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    this.waking = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.on) this.lock = lock; else lock.release().catch(() => {});
    } catch { /* the screen may sleep */ } finally { this.waking = false; }
  }
  tap() {
    unlock({ synth: this.m?.speak === 'browser' });
    switch (this.state) {
      case 'listening': case 'heard': return this.utteranceDone(true);
      case 'thinking': case 'speaking': return this.interrupt();
      case 'paused': return this.listen();
      case 'muted': return this.mute(false);
      default: return undefined;
    }
  }
  mute(on) {
    this.muted = on;
    const b = this.ui.mic;
    b.setAttribute('aria-pressed', String(on)); b.classList.toggle('muted', on);
    b.title = on ? 'Unmute the microphone (M)' : 'Mute the microphone (M)'; b.setAttribute('aria-label', b.title);
    if (on && (this.state === 'listening' || this.state === 'heard')) { this.stopEars(true); this.set('muted'); }
    else if (on) this.letMicGo();
    else if (!on && (this.state === 'muted' || this.state === 'paused')) this.listen();
  }
  /** Stops listening; between turns a computer keeps the microphone open (the next turn starts at once), a phone lets it
   *  go (it plays sound quietly while one is open) - and muted or resting, every device lets it go (its light goes off). */
  stopEars(release = false) {
    clearInterval(this.loop); this.loop = null;
    this.mic?.cancel(); this.ear?.abort(); this.ear = null;
    if (release || touchScreen()) this.letMicGo();
  }
  letMicGo() { this.mic?.close(); this.mic = null; }
  pause(sub) { this.stopEars(true); this.set(this.muted ? 'muted' : 'paused', sub); }

  /** Listens for one turn: the voice service (a recording, the end found from quiet) or the browser's recognition. */
  async listen() {
    if (!this.on) return;
    if (this.muted) return this.set('muted');
    this.stopEars();
    if (!this.m.listen) { this.note(NO_EARS); return this.set('paused', 'Type in the chat instead'); }
    if (this.m.listen === 'browser') return this.listenBrowser();
    this.set('listening');
    const mic = this.mic || (this.mic = new Mic());
    try { await mic.open(); }
    catch (e) { if (this.mic === mic) this.mic = null; if (!this.on) return; this.note(micWords(e)); return this.pause(); }
    // (the microphone may have been asked for while the conversation ended, was muted or moved on: let it go then)
    if (this.mic !== mic) { mic.close(); return; }
    if (!this.on || this.state !== 'listening') return;
    this.mic.start(); this.vad.reset();
    let last = performance.now(), since = last;
    this.loop = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now;
      const ev = this.vad.step(this.mic.level(), dt);
      if (ev === 'speech') { this.quietMs = 0; this.set('heard'); }
      else if (ev === 'end') this.utteranceDone(false);
      else if (ev === 'noise') { this.vad.reset(); this.mic.start(); since = now; this.set('listening'); }
      else if (this.vad.started && this.mic.elapsed > 60000) this.utteranceDone(false);   // (a turn of a minute at most)
      else if (!this.vad.started && now - since > 8000) {
        // nobody spoke: start the recording again (silence isn't sent to be heard), and after a while rest
        this.quietMs += now - since; since = now;
        if (this.quietMs > 40000) this.pause('Tap to talk');
        else this.mic.start();
      }
    }, 50);
  }
  async listenBrowser() {
    this.set('listening');
    const ear = this.ear = new BrowserEar({ lang: this.m.language, onWords: w => { if (this.ear === ear) { this.you(w, true); if (w) this.set('heard'); } } });
    let words = '';
    try { words = await ear.start(); } catch (e) { if (this.ear === ear) { this.ear = null; this.note(e.message); this.pause(); } return; }
    if (this.ear !== ear) return;
    this.ear = null;
    if (!words) { this.quietMs += 8000; if (this.quietMs > 40000) return this.pause('Tap to talk'); return this.listen(); }
    this.quietMs = 0;
    this.ask(words);
  }
  /** The turn ends (quiet after words, or a tap): hear the recording, then ask. */
  async utteranceDone(tapped) {
    if (this.ear) { this.ear.stop(); return; }   // (the browser's recognition answers in listenBrowser)
    if (!this.mic?.recording) return;
    clearInterval(this.loop); this.loop = null;
    if (!tapped && !this.vad.started) return this.listen();
    this.set('hearing');
    const { blob, seconds } = await this.mic.stop();
    if (touchScreen()) this.letMicGo();
    if (!this.on) return;
    let text = '';
    try { text = String((await hear(blob, { seconds, language: this.m.language })).text || '').trim(); }
    catch (e) {
      if (!this.on) return;
      if ((e.code === 'use_browser' || e.fallback === 'browser') && can.recognize()) {
        // minutes used, or the service is down: the browser listens from now on
        this.m.listen = 'browser'; this.src();
        this.note(`${e.message}. The browser listens now - say that again.`);
        return this.listen();
      }
      this.note(e.message);
      return this.pause();
    }
    if (!this.on || this.state !== 'hearing') return;
    if (!text) return this.listen();   // (nothing heard)
    this.ask(text);
  }
  async ask(text) {
    this.set('thinking');
    const T = this.newTurn(null);
    try { const id = await this.host.say(text); if (T === this.turn && !T.run) T.run = id; }
    catch (e) { if (T === this.turn) { this.turn = null; this.note(e.message); this.pause(); } }
  }
  newTurn(runId) {
    this.queue.stop(); this.abort.abort(); this.abort = new AbortController();
    this.turn = { n: (this.turn?.n || 0) + 1, run: runId, seg: new Segmenter(), units: [], fetching: 0, first: true, ended: false };
    return this.turn;
  }
  /** The answer being written (chat.js): its new whole pieces are spoken. */
  onRun(type, R, info = {}) {
    const T = this.turn;
    if (!T || (T.run && T.run !== R.id)) return;
    if (!T.run) T.run = R.id;
    if (type === 'delta') this.feed(R.text, false);
    else if (type === 'end') {
      T.ended = true;
      if (info.error) { this.note(info.error); }
      this.feed(typeof info.text === 'string' ? info.text : R.text, true);
    }
  }
  feed(text, final) {
    const T = this.turn;
    if (!T) return;
    T.units.push(...T.seg.feed(text, final));
    this.pump();
  }
  /** Asks for the next pieces' speech while the ones before play (two requests at most, three pieces waiting). */
  pump() {
    const T = this.turn;
    if (!T) return;
    while (T.units.length && T.fetching < 2 && this.queue.waiting < 3) {
      const text = takeUnits(T.units, { first: T.first });
      T.first = false;
      T.fetching++;
      const p = this.speech(text).finally(() => { T.fetching--; if (this.turn === T) { this.pump(); this.maybeDone(); } });
      this.queue.add(p, { turn: T.n, text });
    }
    this.maybeDone();
  }
  /** One piece's speech: the voice service's audio, or the browser's voice (the text the server made pronounceable). */
  async speech(text) {
    if (this.m.speak === 'none') { this.caption(text); return null; }
    const b = { browserVoice: this.m.browserVoice, lang: this.m.language, rate: this.m.rate };
    if (this.m.speak === 'forced') return { text: plain(text), ...b };
    try {
      const r = await speak({ agent: this.host.agentId, text }, this.abort.signal);
      if (r.browser) {
        if (r.reason && r.reason !== 'choice' && r.reason !== 'none') this.noteOnce(`speak:${r.reason}`, r.note);
        if (this.m.speak !== 'browser') { this.m.speak = 'browser'; this.src(); }
        return can.synth() ? { text: r.text, ...b, browserVoice: r.browserVoice || b.browserVoice, rate: r.rate || b.rate } : (this.caption(r.text), null);
      }
      this.failures = 0;
      return r;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      // a busy or failing voice service: this piece in the browser's voice; after two in a row, the rest too
      if (++this.failures >= 2) { this.m.speak = can.synth() ? 'forced' : 'none'; this.src(); }
      this.noteOnce('speak:fail', `${e.message}. The browser's voice carries on.`);
      return can.synth() ? { text: plain(text), ...b } : null;
    }
  }
  /** The answer is over and said: listen again. */
  maybeDone() {
    const T = this.turn;
    if (!T || !T.ended || T.units.length || T.fetching || !this.queue.idle) {
      if (T && !T.ended && this.queue.idle && this.state === 'speaking') this.set('thinking');   // (more is being written)
      return;
    }
    this.turn = null;
    if (this.on) this.listen();
  }
  /** A tap while it thinks or speaks: it stops (the answer too, if still being written) and listens. */
  interrupt() {
    const T = this.turn;
    this.queue.stop(); this.abort.abort(); this.abort = new AbortController();
    this.turn = null;
    if (T && this.host.run() && (!T.run || this.host.run().id === T.run)) this.host.stop();
    this.listen();
  }
  end() {
    if (!this.on) return;
    this.on = false;
    duck('voice-mode', false);
    this.turn = null;
    this.queue.stop(); this.abort.abort(); this.stopEars(true);
    clearInterval(this.clock);
    document.removeEventListener('keydown', this.keys, true);
    document.removeEventListener('visibilitychange', this.vis);
    try { this.lock?.release(); } catch { /* released */ }
    const { vm, box, mic, pill } = this.ui;
    vm.classList.remove('vm-on'); vm.setAttribute('aria-pressed', 'false'); vm.title = 'Voice mode: talk with it'; vm.setAttribute('aria-label', 'Voice mode');
    box.classList.remove('vm-on');
    mic.classList.remove('muted'); mic.setAttribute('aria-pressed', 'false'); mic.title = 'Dictate: say it, it is written here'; mic.setAttribute('aria-label', 'Dictate');
    pill.classList.add('hidden'); pill.innerHTML = ''; delete pill.dataset.state;
    const win = this.ui.root.querySelector('.chatwin'); win?.classList.remove('voice-mode'); win?.removeAttribute('data-vm');
    this.onEnd?.();
    this.host.focus?.();
  }
}
