// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The companions' voice (docs/features/companions.md §9): one microphone for the people you are out with, without a chat
// window over the world — a phone with the window open cannot see the city it is walking through. Three ways to talk:
//   Hold  — press and hold the button (or V): it records while held and answers when let go.
//   Wake  — it listens for your companions' names ("hey Sam", "hey team") and answers what follows (the browser's own
//           recognition: nothing is sent anywhere until a name is heard).
//   Live  — an open conversation: it answers when you have finished — your patience, your own pauses and whether your words
//           so far sound finished (voice.js LiveEar, Settings → Voice) — never at your first breath.
// Who answers: whoever is named ("Sam, …", "… what do you think, Lara?"), several named together, everyone ("everyone",
// "team", "guys") one after another — each in their own voice, each told what the others said (the group's thread,
// server/chat/groups.js) — or, with no name, the one you spoke to last. It never listens while they speak (it would hear
// them); the button interrupts them.
// One conversation: each companion is spoken with in the chat the person has with it now — the one its chat window shows
// or would open (ui/chat.js current), never a new one of its own —, and each answer shows in its speech bubble over its
// head, once, however many ways show it (ui/talk-bar.js bubble).
import { bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { can, Mic, LiveEar, Player, SpeechQueue, hear, options, speak, unlock, micWords } from './voice.js';
import { Segmenter, takeUnits, PATIENCE_DEFAULT } from './voice-core.js';
import { addressed, wakeOf } from './companion-voice-words.js';

const MODES = ['off', 'hold', 'wake', 'live'];
const GROUP_MAX = 3;            // at most this many answer one turn, one after another
const ANSWER_MS = 180000;       // an answer that takes longer than this is let go
const TURN_MS = 4000;           // who answers a line nobody was called in: the server's judgment, waited for this long
const S = { mode: 'off', mic: null, ear: null, queue: null, player: null, busy: false, last: null, companions: [], byName: new Map(), inited: false, gen: 0, lang: '', prefs: null, limits: null, waking: null, turns: new Set(), busyGen: -1, runs: new Set() };
// one row beside the Companions bar (above it where the bar sits low, under it where it sits high — a phone's): the button,
// who is listening and what it is doing, and the way to talk; over the world's buttons, under the chat windows (chat.css
// .chat-layer is 7); not there at all with nobody out with you
const CSS = [
  '#cv-dock{position:fixed;left:12px;z-index:5;display:flex;align-items:center;gap:8px;padding:4px 6px 4px 4px;border-radius:999px;',
  'border:1px solid var(--line);background:var(--bg-0);color:var(--text);box-shadow:var(--shadow);font:inherit;font-size:12px;',
  'max-width:min(320px,calc(100vw - 24px));user-select:none;-webkit-user-select:none}',
  '#cv-dock.none{display:none}',
  '#cv-dock .cv-mic{position:relative;flex:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:var(--btn-hover,rgba(255,255,255,.08));',
  'color:inherit;font-size:16px;cursor:pointer;touch-action:none;display:grid;place-items:center}',
  '#cv-dock .cv-mic[aria-pressed="true"]{background:var(--gold,#e0a83a);border-color:var(--gold,#e0a83a);color:#1a1205;',
  'box-shadow:0 0 0 calc(2px + var(--lv,0) * 8px) color-mix(in srgb,var(--gold,#e0a83a) 30%,transparent)}',
  // (a pause in your turn: a ring fills towards the moment it answers; talking again empties it)
  '#cv-dock .cv-mic.waiting::after{content:"";position:absolute;inset:-5px;border-radius:50%;pointer-events:none;',
  'background:conic-gradient(var(--gold,#e0a83a) calc(var(--wait,0) * 360deg),transparent 0);-webkit-mask:radial-gradient(circle,transparent 21px,#000 22px);mask:radial-gradient(circle,transparent 21px,#000 22px)}',
  '#cv-dock .cv-t{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.2}',
  '#cv-dock .cv-who{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '#cv-dock .cv-status{opacity:.72;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '#cv-dock .cv-way{flex:none;padding:4px 9px;border-radius:999px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit;font-size:11.5px;cursor:pointer}',
  '#cv-dock .cv-way:hover,#cv-dock .cv-way[aria-expanded="true"]{border-color:var(--gold,#e0a83a)}',
  '#cv-dock.cv-off .cv-mic{opacity:.8}',
  '.cv-menu{position:fixed;z-index:9;width:250px;max-width:calc(100vw - 16px);padding:6px;display:flex;flex-direction:column;gap:2px}',
  '.cv-menu button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--text);font:inherit;text-align:left;cursor:pointer}',
  '.cv-menu button:hover,.cv-menu button[aria-checked="true"]{background:var(--btn-hover,rgba(255,255,255,.08))}',
  '.cv-menu button b{font-size:12.5px}.cv-menu button small{font-size:11px;opacity:.72}',
  // the lamp (on the button here and on the small mic by the 👥 button, js: glow → data-light): dark — off or paused;
  // light — ready; red, blinking — live, it hears you; amber, steady — standing by for a name (Wake); amber, blinking —
  // about to answer / thinking; green — speaking
  '.cv-led{position:absolute;right:-2px;top:-2px;width:10px;height:10px;border-radius:50%;background:#64748b;pointer-events:none;',
  'box-shadow:0 0 0 2px var(--panel-strong,#15171d)}',
  '[data-light="off"] .cv-led,[data-light="paused"] .cv-led{background:#475569}[data-light="ready"] .cv-led{background:#cbd5e1}',
  '[data-light="live"] .cv-led{background:#ef4444;box-shadow:0 0 0 2px var(--panel-strong,#15171d),0 0 8px #ef4444;animation:cv-blink 1s ease-in-out infinite}',
  '[data-light="standby"] .cv-led{background:#f59e0b;box-shadow:0 0 0 2px var(--panel-strong,#15171d),0 0 6px #f59e0b}',
  '[data-light="thinking"] .cv-led{background:#f59e0b;animation:cv-blink .7s ease-in-out infinite}',
  '[data-light="speaking"] .cv-led{background:#22c55e;box-shadow:0 0 0 2px var(--panel-strong,#15171d),0 0 8px #22c55e;animation:cv-blink 1.2s ease-in-out infinite}',
  '@keyframes cv-blink{50%{opacity:.35}}',
  // the small mic on the 👥 button (a phone: js/ui/companions.js puts it there) — the same as the button here: hold to talk,
  // or tap to listen / pause, whichever way to talk is chosen
  // (on the button's top edge, in the middle — the product owner's choice, 2026-11-21)
  '.cv-mini{position:absolute;left:50%;top:0;transform:translate(-50%,-58%);z-index:1;width:28px;height:28px;padding:0;border-radius:50%;',
  'border:1px solid var(--line-2,var(--line));background:var(--panel-strong,#1b1d24);color:var(--text);font-size:12px;display:grid;place-items:center;',
  'cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent;box-shadow:0 2px 10px rgba(0,0,0,.45)}',
  '.cv-mini.hidden{display:none}',
  '.cv-mini .cv-led{width:8px;height:8px;right:-2px;top:-1px}',
  '.cv-mini[aria-pressed="true"]{background:var(--gold,#e0a83a);border-color:var(--gold,#e0a83a);color:#1a1205;',
  'box-shadow:0 0 0 calc(2px + var(--lv,0) * 6px) color-mix(in srgb,var(--gold,#e0a83a) 35%,transparent)}',
  '@media (prefers-reduced-motion:reduce){#cv-dock .cv-mic[aria-pressed="true"],.cv-mini[aria-pressed="true"]{box-shadow:none}.cv-led{animation:none!important}}',
].join('');
const WAYS = {
  off: ['Off', 'Your companions don\'t listen'],
  hold: ['Hold to talk', 'Hold the button (or V) while you speak'],
  wake: ['Wake word', 'Say "hey Sam" or "hey team", then speak — Chrome, Edge, Safari'],
  live: ['Live', 'An open conversation: it answers when you have finished'],
};
/** Its own log, with live voice's (localStorage 'mvw.voice.debug' = '1': the console). */
const dbg = (...a) => { try { if (localStorage.getItem('mvw.voice.debug') === '1') console.debug('[voice] companions:', ...a); } catch { } };
const label = m => ({ off: 'Off', hold: 'Hold', wake: 'Wake', live: 'Live' }[m] || m) + ' ▾';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function init(app) {
  if (S.inited) return;
  S.inited = true;
  S.app = app;
  S.player = new Player();
  S.queue = new SpeechQueue(S.player);
  S.queue.onPlay = () => { unwatch(); setStatus('speaking'); };
  S.queue.onIdle = () => { if (quiet()) afterSpeaking(); };

  const dock = buildDock();
  S.dock = dock;
  (document.getElementById('ui') || document.body).appendChild(dock.el);
  window.addEventListener('resize', place);
  load();
  // (the bar's own frames name everyone out with you: the same list the Companions panel shows)
  bus.on('msg:companions', m => setCompanions((m && m.companions) || []));
  refreshCompanions();
  bus.on('msg:session', () => { if (S.mode !== 'off') stopAll(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (S.mode === 'live' || S.mode === 'wake')) { S.hidden = true; stopEars(true); setStatus('paused'); }
    else if (!document.hidden && S.hidden) { S.hidden = false; if (!S.busy && S.queue.idle) listenAgain(); }
  });
  setInterval(glow, 80);
  paint();
  if (S.mode === 'wake' || S.mode === 'live') S.paused = true;   // (a page that opens never starts listening by itself: a tap does)
}

/** Nobody is answering and nothing is left to say. */
function quiet() { return !S.busy && S.queue.idle && !S.turns.size; }
function setCompanions(list) {
  S.companions = list.map(c => c.name).filter(Boolean);
  S.byName = new Map(list.filter(c => c.name).map(c => [c.name, c.agent]));
  paint();
}
function refreshCompanions() { return getJSON('/api/companions').then(l => setCompanions((l && l.companions) || [])).catch(() => { }); }

function buildDock() {
  const el = document.createElement('div');
  el.id = 'cv-dock';
  el.className = 'none';
  el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Talk with your companions');
  el.innerHTML = '<style>' + CSS + '</style>' +
    '<button type="button" class="cv-mic" aria-label="Talk" aria-pressed="false"><span aria-hidden="true">&#127908;</span><i class="cv-led" aria-hidden="true"></i></button>' +
    '<span class="cv-t"><span class="cv-who">companions</span><span class="cv-status" aria-live="polite">off</span></span>' +
    '<button type="button" class="cv-way" aria-haspopup="menu" aria-expanded="false" title="How you talk to your companions"></button>';
  el.querySelector('.cv-way').addEventListener('click', e => { e.stopPropagation(); menu(); });
  const mic = el.querySelector('.cv-mic');
  bindMic(mic);
  keys();
  // (the Companions bar grows and shrinks as companions come and go, and its panel opens: the row follows it)
  const bar = () => document.getElementById('party');
  const watch = () => { const b = bar(); if (b && window.ResizeObserver && !S.ro) { S.ro = new ResizeObserver(place); S.ro.observe(b); } };
  watch(); setTimeout(watch, 1500);
  return { el, mic, status: el.querySelector('.cv-status'), who: el.querySelector('.cv-who'), way: el.querySelector('.cv-way') };
}
/** A talk button: hold to talk (Off: the first hold chooses Hold), or a tap to listen / pause (Wake, Live). */
function bindMic(btn) {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    unlock({ synth: true });
    try { btn.setPointerCapture(e.pointerId); } catch { }
    if (S.mode === 'off') { setMode('hold'); press(); }
    else if (S.mode === 'hold') press();
    else toggle();
  });
  btn.addEventListener('pointerup', e => { e.preventDefault(); if (S.mode === 'hold') release(); });
  btn.addEventListener('pointercancel', () => { if (S.mode === 'hold') release(); });
  btn.addEventListener('click', e => e.stopPropagation());   // (not the 👥 button's tap under it)
}
/** The small mic for the 👥 button (a phone's Companions button: js/ui/companions.js) — a shortcut to the same talking,
 *  with the same lamp. Hidden with nobody out with you. */
export function miniMic() {
  if (!S.mini) {
    S.mini = document.createElement('button');
    S.mini.type = 'button'; S.mini.className = 'cv-mini hidden';
    S.mini.setAttribute('aria-pressed', 'false'); S.mini.setAttribute('aria-label', 'Talk to your companions');
    S.mini.innerHTML = '<span aria-hidden="true">&#127908;</span><i class="cv-led" aria-hidden="true"></i>';
    bindMic(S.mini);
    if (S.dock) paint();
  }
  return S.mini;
}
/** What the lamp shows: speaking, thinking (an answer coming, or the pause before it), live (it hears you), standby
 *  (Wake, listening for a name), ready, paused, off. */
function lightOf() {
  if (S.player?.busy || (S.queue && !S.queue.idle)) return 'speaking';
  if (S.busy || S.turns.size || S.dock.mic.classList.contains('waiting')) return 'thinking';
  if (S.dock.mic.getAttribute('aria-pressed') === 'true') return S.mode === 'wake' && !S.waking ? 'standby' : 'live';
  if (S.mode === 'off') return 'off';
  return S.paused || S.hidden ? 'paused' : 'ready';
}
/** The ways to talk, to choose from. */
function menu() {
  if (S.menu) return closeMenu();
  const m = S.menu = document.createElement('div');
  m.className = 'cv-menu card'; m.setAttribute('role', 'menu');
  m.innerHTML = MODES.map(k => '<button type="button" role="menuitemradio" data-mode="' + k + '" aria-checked="' + (k === S.mode) + '"><b>' + WAYS[k][0] + '</b><small>' + WAYS[k][1] + '</small></button>').join('');
  (document.getElementById('ui') || document.body).appendChild(m);
  const r = S.dock.way.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
  m.style.top = (r.top - mh - 6 > 8 ? r.top - mh - 6 : Math.min(innerHeight - mh - 8, r.bottom + 6)) + 'px';
  S.dock.way.setAttribute('aria-expanded', 'true');
  // (a tap: sound may start from here on — a phone's rule — and the microphone's sound is measured)
  m.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) { unlock({ synth: true }); closeMenu(); setMode(b.dataset.mode); } });
  setTimeout(() => document.addEventListener('pointerdown', S.away = e => { if (!e.target.closest('.cv-menu') && !e.target.closest('.cv-way')) closeMenu(); }, true));
}
function closeMenu() {
  S.menu?.remove(); S.menu = null;
  if (S.away) { document.removeEventListener('pointerdown', S.away, true); S.away = null; }
  S.dock?.way.setAttribute('aria-expanded', 'false');
}

function setStatus(t) { if (S.dock) { S.dock.status.textContent = t; S.status = t; } }
function hint(t) { if (S.dock && t) setStatus(t); }

/** At the foot of the Companions card (ui/companions.js: its .party-voice), one panel with it — or, with no card shown,
 *  where the card would be: above it where it sits low on the screen (a computer's), under it where it sits high (a
 *  phone's, under the top bar). */
function place() {
  if (!S.dock) return;
  const el = S.dock.el, bar = document.getElementById('party'), slot = bar?.querySelector('.party-voice');
  if (slot && (getComputedStyle(bar).display !== 'none' || bar.classList.contains('as-sheet'))) {   // (a phone's sheet, put away: the row stays in it)
    if (el.parentElement !== slot) { slot.appendChild(el); if (S.menu) closeMenu(); }
    el.classList.add('in-party'); el.style.left = el.style.top = el.style.bottom = '';
    return;
  }
  const home = document.getElementById('ui') || document.body;
  if (el.parentElement !== home) { home.appendChild(el); el.classList.remove('in-party'); }
  const r = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect() : null;
  el.style.left = (r ? Math.max(8, Math.round(r.left)) : 12) + 'px';
  if (r && r.height > 0 && r.top < innerHeight / 2) { el.style.top = Math.round(r.bottom + 6) + 'px'; el.style.bottom = ''; }
  else { el.style.top = ''; el.style.bottom = (r && r.height > 0 ? Math.round(innerHeight - r.top + 6) : 230) + 'px'; }
  if (S.menu) closeMenu();
}
function paint() {
  if (!S.dock) return;
  const el = S.dock.el;
  el.classList.toggle('none', !S.companions.length);
  el.classList.toggle('cv-off', S.mode === 'off');
  S.dock.way.textContent = label(S.mode);
  S.dock.way.title = WAYS[S.mode][1] + ' — tap to change';
  // (everyone with you hears you — no one of them holds the conversation: whoever a line is for answers it)
  const who = S.companions.length === 1 ? S.companions[0] : S.companions.length <= 3 ? S.companions.join(' · ') : S.companions.length + ' companions';
  S.dock.who.textContent = who;
  S.dock.who.title = S.companions.length > 1 ? `${S.companions.join(', ')} all hear you; whoever you talk to answers (call a name, or say "everyone")` : S.companions.join(', ');
  S.dock.mic.disabled = !S.companions.length;
  S.dock.mic.setAttribute('aria-label', S.mode === 'hold' || S.mode === 'off' ? 'Hold to talk' : 'Listen, or pause');
  S.dock.mic.title = S.mode === 'hold' || S.mode === 'off' ? 'Hold to talk (or V)' : 'Tap: listen or pause · while they talk: stop them · while you talk: done';
  if (S.mini) {
    S.mini.classList.toggle('hidden', !S.companions.length);
    S.mini.disabled = !S.companions.length;
    S.mini.setAttribute('aria-label', `${S.mode === 'hold' || S.mode === 'off' ? 'Hold to talk' : 'Listen, or pause'} — ${who || 'your companions'}`);
    S.mini.title = `Talk to ${who || 'your companions'} · ${S.dock.mic.title}`;
  }
  if (!S.busy) setStatus(S.mode === 'off' ? 'hold the button to talk' : S.paused ? 'tap to listen' : S.status && !/^hold the button/.test(S.status) ? S.status : 'ready');
  place();
}
/** The button's glow follows the microphone, or the voice speaking. */
function glow() {
  if (!S.dock) return;
  const lv = S.ear?.T ? Math.min(1, S.ear.level() * 8) : S.mic?.recording ? Math.min(1, S.mic.level() * 8) : S.player?.busy ? Math.min(1, S.player.level() * 6) : 0;
  S.dock.mic.style.setProperty('--lv', lv.toFixed(3));
  const light = lightOf();
  if (S.dock.el.dataset.light !== light) S.dock.el.dataset.light = light;
  if (S.mini) {
    if (S.mini.dataset.light !== light) S.mini.dataset.light = light;
    S.mini.style.setProperty('--lv', lv.toFixed(3));
    const on = S.dock.mic.getAttribute('aria-pressed');
    if (S.mini.getAttribute('aria-pressed') !== on) S.mini.setAttribute('aria-pressed', on);
  }
}

function load() { try { const m = localStorage.getItem('mvw.cv.mode'); if (MODES.includes(m)) S.mode = m; } catch { } }
function save() { try { localStorage.setItem('mvw.cv.mode', S.mode); } catch { } }

function setMode(m) {
  if (!MODES.includes(m) || S.mode === m) return;
  stopAll(m === 'off' || m === 'hold');
  S.mode = m; save();
  S.paused = false;
  paint();
  if (m === 'wake' || m === 'live') listenAgain();
}
function keys() {
  document.addEventListener('keydown', e => {
    if ((e.key !== 'v' && e.key !== 'V') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (S.mode !== 'hold' || S.dock.mic.disabled) return;
    e.preventDefault(); unlock({ synth: true }); press();
  }, true);
  document.addEventListener('keyup', e => {
    if ((e.key === 'v' || e.key === 'V') && S.mode === 'hold') { e.preventDefault(); release(); }
  }, true);
}

// ----------------------------------------------------------------------------------------------- what you and they can do
/** The person's voice choices (Settings → Voice), fetched once a while: who listens, their language and patience. */
async function prefs() {
  const first = S.companions[0] ? S.byName.get(S.companions[0]) : null;
  const o = await options(first).catch(() => null);
  S.prefs = (o && o.prefs && o.prefs.listen) || {};
  S.limits = (o && o.limits) || {};
  S.lang = (o && o.listen && o.listen.language) || S.prefs.language || '';
  S.source = o && o.listen && o.listen.source === 'browser' ? 'browser' : can.record() ? 'server' : can.recognize() ? 'browser' : null;
  return o;
}
function earFor(source) {
  const p = S.prefs || {};
  const o = { source, language: S.lang, patience: p.patience || PATIENCE_DEFAULT, smart: p.smart !== false, learn: p.learn !== false,
    maxSeconds: Number(S.limits && S.limits.maxSeconds) || 300, idleMs: S.mode === 'wake' ? (S.waking ? 10000 : 300000) : 60000, onState: earState };
  if (S.ear) S.ear.set(o); else S.ear = new LiveEar(o);
  return S.ear;
}
function earState(st, info) {
  const mic = S.dock.mic;
  if (st === 'pause') { mic.style.setProperty('--wait', String(info.progress || 0)); mic.classList.toggle('waiting', (info.progress || 0) > 0); return; }
  mic.classList.remove('waiting'); mic.style.removeProperty('--wait');
  if (st === 'listening') setStatus(S.mode === 'wake' ? (S.waking ? 'listening for ' + S.waking : 'waiting for a name') : 'listening');
  else if (st === 'heard') setStatus(S.mode === 'wake' && !S.waking ? 'waiting for a name' : 'listening…');
  else if (st === 'hearing') setStatus(S.mode === 'wake' && !S.waking ? 'waiting for a name' : 'got it…');
  else if (st === 'limit') hint(info.left + ' s left in this turn');
}

// ----------------------------------------------------------------------------------------------- hold
async function press() {
  if (!S.companions.length || S.mode !== 'hold') return;
  stopSpeaking();
  if (!S.prefs) await prefs();
  const mic = S.mic || (S.mic = new Mic());
  S.holding = true;
  try { await mic.open(); } catch (e) { S.holding = false; return setStatus(micWords(e).slice(0, 60)); }
  if (!S.holding) return;   // (let go while the microphone was being asked for)
  mic.start();
  S.dock.mic.setAttribute('aria-pressed', 'true');
  setStatus('listening');
}
async function release() {
  S.holding = false;
  S.dock.mic.setAttribute('aria-pressed', 'false');
  if (!S.mic || !S.mic.recording) return;
  const r = await S.mic.stop();
  if (r.seconds < 0.4) return setStatus('ready');
  setStatus('got it…');
  let text = '';
  try { text = String(((await hear(r.blob, { seconds: r.seconds, language: S.lang })).text) || '').trim(); }
  catch (e) { return setStatus(String((e && e.message) || 'could not hear that').slice(0, 70)); }
  if (!text) return setStatus('nothing heard');
  ask(text);
}

// ----------------------------------------------------------------------------------------------- live and wake
/** Listens for the next turn (live: anything said; wake: a name first) — never while they speak. */
async function listenAgain() {
  if (S.mode !== 'live' && S.mode !== 'wake') return;
  if (S.paused || !quiet() || document.hidden || !S.companions.length) { if (!S.companions.length) setStatus('no companions'); return; }
  const gen = ++S.gen;
  await prefs();
  if (gen !== S.gen || S.paused || S.busy) return;
  const source = S.mode === 'wake' ? (can.recognize() ? 'browser' : null) : S.source;
  if (!source) { setStatus(S.mode === 'wake' ? 'wake needs Chrome, Edge or Safari' : 'this browser can\'t listen'); return; }
  const ear = earFor(source);
  S.dock.mic.setAttribute('aria-pressed', 'true');
  dbg('listening', S.mode, 'gen', gen);
  let r;
  try { r = await ear.turn(); }
  catch (e) {
    if (gen !== S.gen) return;
    S.dock.mic.setAttribute('aria-pressed', 'false');
    if ((e.code === 'use_browser' || e.fallback === 'browser') && can.recognize() && S.source !== 'browser') { S.source = 'browser'; hint('the browser listens now'); return listenAgain(); }
    setStatus(String(e && (e.status || e.code) ? e.message : micWords(e)).slice(0, 70));
    S.paused = true;
    return;
  }
  dbg('heard', r && { why: r.why, text: String(r.text || '').slice(-60) }, 'gen', gen, 'now', S.gen);
  if (gen !== S.gen) return;
  if (!r) return;   // (stopped)
  if (r.why === 'idle') {
    if (S.mode === 'wake') { S.waking = null; return listenAgain(); }
    S.paused = true; S.dock.mic.setAttribute('aria-pressed', 'false'); ear.close();
    return setStatus('tap to listen');
  }
  if (S.mode === 'wake') {
    if (S.waking) { const who = S.waking; S.waking = null; if (r.text) return ask(r.text, who); return listenAgain(); }
    const w = wakeOf(r.text, S.companions);
    if (!w) return listenAgain();   // (no name: it was not for them)
    if (!w.rest) { S.waking = w.who === 'all' ? 'everyone' : w.who; setStatus('listening for ' + S.waking); return listenAgain(); }
    return ask(w.rest, w.who === 'all' ? 'everyone' : w.who);
  }
  if (!r.text) return listenAgain();
  ask(r.text);
}
/** The button in live and wake: listening → pause; paused → listen; while they speak → stop them and listen. */
function toggle() {
  if (!quiet()) { stopSpeaking(); S.paused = false; return listenAgain(); }
  if (S.ear && S.ear.T && !S.paused) {
    if (S.mode === 'live' && S.ear.talking) return S.ear.send();   // (a tap while you talk: done — it goes now)
    S.paused = true; stopEars(true); S.dock.mic.setAttribute('aria-pressed', 'false'); return setStatus('paused');
  }
  S.paused = false;
  listenAgain();
}
function afterSpeaking() {
  if (S.mode === 'off' || S.mode === 'hold') return setStatus(S.mode === 'off' ? 'off' : 'ready');
  setStatus('ready');
  listenAgain();
}

// ----------------------------------------------------------------------------------------------- answers
/** What was said: who it is for (forced: the name a wake phrase called), then their answers, one after another. */
async function ask(text, forced = null) {
  dbg('ask', String(text).slice(-60), S.busy ? '(busy: dropped)' : '');
  if (S.busy) return;
  stopEars(false);
  const gen = S.gen;
  // (what they said, until one of them has it: someone who goes on talking before any answer began says it all again)
  S.asked = { text, delivered: false };
  S.busy = true; S.busyGen = gen;
  S.dock.mic.setAttribute('aria-pressed', 'false');
  paint();
  watch(gen);
  try {
    const who = forced === 'everyone' ? { all: true } : forced ? { who: forced } : addressed(text, S.companions);
    let names = who && who.all ? S.companions.slice(0, GROUP_MAX)
      : who && who.names ? who.names.filter(n => S.companions.includes(n)).slice(0, GROUP_MAX)
        : who && who.who ? [who.who] : null;
    // (said to everyone: they take turns at answering first — the same one always first set the tone and the others echoed it)
    if (who && who.all && names.length > 1) { const k = (S.round = (S.round || 0) + 1) % names.length; names = names.slice(k).concat(names.slice(0, k)); }
    // (nobody called by name: everyone heard it — who answers is judged from what was said and what was said just before,
    //  the way people in a group know who a line is for; no one companion holds the conversation. Without an answer in
    //  time, the one last spoken with.)
    if (!names) {
      names = S.companions.length > 1 ? await turnFor(text) : null;
      if (gen !== S.gen) return;
      if (!names || !names.length) names = S.last && S.companions.includes(S.last) ? [S.last] : S.companions.slice(0, 1);
    }
    if (!names.length) { setStatus('no one to answer'); return; }
    S.last = names[names.length === 1 ? 0 : names.length - 1];
    paint();
    // (a group: everyone out with you, so each is told what the others said — the server keeps the thread)
    const members = S.companions.map(n => S.byName.get(n)).filter(Number.isInteger);
    // (who it was said to, when several: each one's chat marks the line so — "to Sam and Lara")
    const to = names.length > 1 ? names.map(n => S.byName.get(n)).filter(Number.isInteger) : null;
    let first = true;
    for (const name of names) {
      if (gen !== S.gen) break;
      setStatus(names.length > 1 ? name + ' is answering' : name + ' is thinking');
      await answer(name, text, members, first, gen, to);
      first = false;
    }
  } finally {
    if (S.busyGen === gen) {
      S.busy = false;
      paint();
      if (gen === S.gen && quiet()) afterSpeaking();
    }
  }
}

/** Who answers a line nobody was called by name in (the server's judgment: POST /api/companions/turn): their names in
 *  the order they answer, or null (no answer in time: the caller falls back). */
async function turnFor(text) {
  const ids = S.companions.map(n => S.byName.get(n)).filter(Number.isInteger);
  if (ids.length < 2) return null;
  setStatus('listening…');
  try {
    const r = await Promise.race([post('/api/companions/turn', { agents: ids, text }), sleep(TURN_MS).then(() => null)]);
    const byId = new Map([...S.byName].map(([n, id]) => [id, n]));
    const out = (r && Array.isArray(r.agents) ? r.agents : []).map(id => byId.get(id)).filter(n => n && S.companions.includes(n));
    dbg('turn', out.join(', ') || '(none)', r && r.how);
    return out.length ? out.slice(0, GROUP_MAX) : null;
  } catch (e) { dbg('turn failed', e && e.message); return null; }
}

/** One companion's answer: written by its brain, spoken in its voice as it is written (after whoever spoke before). */
async function answer(name, text, members, groupSay, gen, to = null) {
  const agent = S.byName.get(name);
  if (!Number.isInteger(agent)) return;
  const sess = await sessionFor(agent);
  if (!sess || gen !== S.gen) return;
  const body = { agent, session: sess, input: text, spoken: true };   // (said out loud: answered as people talk)
  if (members.length > 1 && members.includes(agent)) Object.assign(body, { group: members, groupSay, to: to || [agent] });
  let run;
  // (an answer just stopped — they went on talking — may still be ending in that chat: a moment for it, then this one)
  for (let k = 0; ; k++) {
    try { run = await post('/api/providers/runs', body); break; }
    catch (e) {
      if (e && e.code === 'busy' && k < 50 && gen === S.gen) { await sleep(300); continue; }
      dbg('the run was refused', e && e.message); setStatus(String((e && e.message) || 'it could not answer').slice(0, 70)); return;
    }
  }
  dbg('run', name, run && run.runId);
  if (!run || !run.runId) return;
  S.app?.talk?.voiced?.(run.runId);   // (said aloud here: a chat window showing the same answer doesn't say it again)
  if (S.asked && S.asked.text === text) S.asked.delivered = true;   // (in its chat now: the next turn need not say it again)
  if (gen !== S.gen) { post('/api/providers/interrupt', { run: run.runId }).catch(() => { }); return; }
  S.runs.add(run.runId);
  try { await follow(run, name, agent, gen); } finally { S.runs.delete(run.runId); }
}
/** The answer as it is written, spoken as it comes. */
async function follow(run, name, agent, gen) {
  const T = { seg: new Segmenter(), units: [], first: true, fetching: 0, ended: false, gen };
  S.turns.add(T);
  const feed = (t, final) => { T.units.push(...T.seg.feed(t, final)); pump(T, agent); };
  const t0 = performance.now();
  let since = 0, said = '', end = null;
  for (;;) {
    if (gen !== S.gen) { S.turns.delete(T); return; }
    const ev = await getJSON('/api/providers/runs/events?run=' + encodeURIComponent(run.runId) + '&since=' + since).catch(() => null);
    if (!ev) { await sleep(600); if (performance.now() - t0 > ANSWER_MS) break; continue; }
    for (const it of ev.events || []) {
      since = Math.max(since, it.seq || 0);
      const e = it.event || {};
      if (e.type === 'run.delta' && e.text) said += e.text;
      else if (e.type === 'run.end') end = e;
    }
    if (typeof ev.partial === 'string' && ev.partial.length > said.length) said = ev.partial;
    if (ev.done) {
      const all = end && typeof end.text === 'string' && end.text ? end.text : said;
      feed(all, true);
      if (end && end.status && end.status !== 'ok') setStatus(name + ' could not answer');
      // (its answer over its head too, as the chat window's — one bubble when both show it)
      else if (all) S.app?.talk?.bubble?.(agent, all, { spoken: true, run: run.runId });
      break;
    }
    if (said) feed(said, false);
    if (performance.now() - t0 > ANSWER_MS) break;
    await sleep(250);
  }
  // (the next one starts thinking now; its voice waits in line behind this one's)
  T.ended = true;
  pump(T, agent);
}

function pump(T, agent) {
  if (T.gen !== S.gen) { S.turns.delete(T); clearInterval(T.waiter); T.waiter = null; return; }
  while (T.units.length && T.fetching < 2 && S.queue.waiting < 3) {
    const text = takeUnits(T.units, { first: T.first });
    T.first = false;
    T.fetching++;
    const p = speech(agent, text).finally(() => { T.fetching--; pump(T, agent); });
    S.queue.add(p, { text });
  }
  if (T.units.length && !T.waiter) {
    // (more to say than the line holds: try again as it empties)
    T.waiter = setInterval(() => { if (!T.units.length) { clearInterval(T.waiter); T.waiter = null; return; } pump(T, agent); }, 300);
  }
  // (all of it handed to the voice: this answer no longer holds the conversation)
  if (T.ended && !T.units.length && !T.fetching) {
    S.turns.delete(T);
    if (quiet()) afterSpeaking();
  }
}
async function speech(agent, text) {
  if (!can.synth() && !window.AudioContext && !window.webkitAudioContext) return null;
  try {
    const r = await speak({ agent, text });
    if (r && r.browser) return can.synth() ? { text: r.text, browserVoice: r.browserVoice, rate: r.rate, lang: S.lang } : null;
    return r || null;
  } catch { return can.synth() ? { text: String(text).replace(/[*_#|>`]/g, ''), lang: S.lang } : null; }
}

/** The chat this companion is spoken with: the one the person has with it now — the one rule of ui/chat.js current (its
 *  chat window's, else the one last written in; a first one only for an agent with none). */
async function sessionFor(agent) {
  try { return (await S.app?.chat?.current?.(agent, { make: true })) ?? null; } catch { return null; }
}

/** In Live, while the answer is thought (nothing said yet), the ear stays on: someone who goes on talking had not
 *  finished — the answers stop, and what they say now is heard as the rest of their turn (voice.js LiveEar, watch). */
async function watch(gen) {
  if (S.mode !== 'live' || !S.ear || !S.source) return;
  let r;
  try { r = await S.ear.turn({ watch: true, onMore: () => { if (gen === S.gen) { stopRuns(); stopSpeaking(); setStatus('listening…'); S.dock.mic.setAttribute('aria-pressed', 'true'); } } }); } catch { return; }
  if (!r || !r.more || S.mode !== 'live') return;
  if (!r.text) return listenAgain();
  // (the turn before reached no one — no answer had begun —: it goes with the rest)
  const before = S.asked && !S.asked.delivered ? S.asked.text : '';
  ask(before ? before + ' ' + r.text : r.text);
}
/** The answer begins to be said: the ear stops watching (it would hear it). */
function unwatch() { const W = S.ear && S.ear.T; if (W && W.watch && !W.talked) S.ear.cancel(); }
/** Every answer being written stops. */
function stopRuns() { for (const id of S.runs) post('/api/providers/interrupt', { run: id }).catch(() => { }); S.runs.clear(); }

// ----------------------------------------------------------------------------------------------- stopping
function stopEars(release) {
  if (S.ear) { if (release) S.ear.close(); else S.ear.cancel(); }
  if (S.mic && S.mic.recording) { try { S.mic.cancel(); } catch { } }
  if (release && S.mic) { try { S.mic.close(); } catch { } S.mic = null; }
  if (S.dock) { S.dock.mic.classList.remove('waiting'); S.dock.mic.setAttribute('aria-pressed', 'false'); }
}
function stopSpeaking() {
  S.gen++;
  stopRuns();
  try { S.queue.stop(); } catch { }
  for (const T of S.turns) { clearInterval(T.waiter); T.waiter = null; }
  S.turns.clear();
  S.busy = false; S.busyGen = -1;
}
function stopAll(release) {
  stopSpeaking();
  stopEars(release);
  S.waking = null;
}
