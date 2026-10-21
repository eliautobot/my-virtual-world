// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Talking with an AI agent in the city (docs/features/CHAT.md §14; 2026-10-08) - Play mode's E face to face, or Talk
// on the selection card from the map:
// - its owner's own agent: the chat window opens on it (no limits, every tool); in Play mode it stops and turns to
//   them, and each answer also shows in its speech bubble, to them alone;
// - someone else's agent: this bar - a short message (with 🎤 to say it), sent; the answer shows only in the agent's
//   speech bubble, only on this page. The conversation's limits are the admin's and the server's (server/agent-talk/):
//   the bar shows what is left - the time before it is cleared, messages, characters - and what the server refused;
// - an agent that only greets (a resident's way: its brain can't take a stranger's words), or one whose owner blocked
//   this player: the greeting, as with any resident, or the reason in one line.
// The bubble holds the whole answer (scrolling inside when long: render/labels.js) and stays while the bar is open.
// The answer arrives as the chat's run events (bus 'msg:chat', to this account alone). Escape, ✕, or walking away (Play
// mode, more than WALK_OFF metres) closes the bar; the conversation itself is kept until the server clears it.
import { S, bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';
import { render } from './chat-md.js';
import { can, options as voiceOptions, hear, Mic, BrowserEar, micWords, unlock } from './voice.js';

const WALK_OFF = 8, BUBBLE_MAX = 4000;
let app = null, T = null;   // T: the open bar { rec, i, st, el, run, timer, ears }

export function init(a) {
  app = a;
  app.talk = { to, close, bubble, get open() { return !!T; } };
  bus.on('msg:chat', onFrame);
  bus.on('auth', () => { if (T && !auth.account) close(); });
  bus.on('mode', m => { if (T && T.play && m !== 'play') close(); });
}

const recOf = i => { const p = S.people[i]; return (S.agentList || []).find(a => a.i === i || (p?.ag && a.key === p.ag)) || null; };
/** The text a bubble shows: the answer without its Markdown - its paragraphs and list items on lines of their own, code
 *  and tables left out - at most BUBBLE_MAX characters. */
export function plain(md) {
  const t = document.createElement('template');
  t.innerHTML = render(String(md || '')).html;
  const c = t.content;
  c.querySelectorAll('.md-code, pre, table').forEach(x => { const p = document.createElement('p'); p.textContent = '…'; x.replaceWith(p); });
  for (const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); w.nextNode();) w.currentNode.data = w.currentNode.data.replace(/\s+/g, ' ');
  c.querySelectorAll('li').forEach(x => { x.prepend('• '); x.append('\n'); });
  c.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote').forEach(x => x.append('\n\n'));
  c.querySelectorAll('ul, ol').forEach(x => { if (!x.parentElement?.closest('li')) x.append('\n'); });
  c.querySelectorAll('br').forEach(x => x.replaceWith('\n'));
  const s = c.textContent.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > BUBBLE_MAX ? `${s.slice(0, BUBBLE_MAX - 1).trimEnd()}…` : s;
}
/** Seconds of real time a bubble stays, by its length (time to read it) - as world time for the labels (S.simT). */
const forSecs = text => Math.min(120, 6 + String(text).length / 14) * (app?.net?.clock?.rate || 1);

/** An answer of agent `agentId` in its bubble, on this page only (its owner's chat window, or a talk). */
export function bubble(agentId, text) {
  const rec = (S.agentList || []).find(a => a.id === agentId), i = rec?.i ?? -1;
  if (i < 0 || !text) return;
  const t = plain(text);
  if (t) S.says.set(i, { text: t, until: S.simT + forSecs(t) });
  return t;
}

/** Talk with person i: its owner's agent in the chat window, someone else's in the bar, a resident's greeting. at: where
 *  the player stands (Play mode), for the agent to turn to. */
export async function to(i, at = null) {
  const p = S.people[i];
  if (!p) return;
  const rec = p.v ? recOf(i) : null;
  if (!rec || !auth.account) return greet(i, at, p.v && !auth.account ? 'Sign in to talk with agents.' : null);
  let st;
  try { st = await getJSON(`/api/agent-talk?agent=${rec.id}`); } catch (e) { return app.toast?.(e.message, 'bad'); }
  if (st.mode === 'own') {
    app.chat?.open(rec.id);
    if (at) post('/api/agent-talk/face', { agent: rec.id, x: at.x, z: at.z }).catch(() => {});
    return;
  }
  if (st.mode === 'greet') return greet(i, at, st.why === 'greets_only' ? null : st.message);
  open(rec, i, st, at);
}
/** A resident's way: out loud in the world (Play mode, face to face), or one line from the map. */
async function greet(i, at, note) {
  if (note) app.toast?.(note, '', 3600, '💬');
  if (!at) { if (!note) app.toast?.(`${S.people[i]?.n || 'They'} only greet${S.people[i]?.v ? 's' : ''} passers-by.`, '', 3200, '💬'); return; }
  try { const r = await post('/api/talk', { i, x: at.x, z: at.z }); if (r?.text) S.says.set(i, { text: r.text, until: S.simT + forSecs(r.text) }); }
  catch (e) { app.toast?.(e.message || String(e), 'bad'); }
}

// ------------------------------------------------------------------------------------------------ the bar
function open(rec, i, st, at) {
  if (T && T.rec.id === rec.id) { T.st = st; T.at = at; paint(); focus(); return; }
  close();
  const el = (document.getElementById('ui') || document.body).appendChild(h(`<div class="tb panel" role="dialog" aria-label="Talking with ${esc(rec.name)}">
    <div class="tb-top"><span class="tb-av" data-avatar aria-hidden="true">${esc(rec.emoji || '🤖')}</span><b class="tb-name" data-noicon>${esc(rec.name)}</b>
      <span class="tb-left" aria-live="polite"></span><button type="button" class="tb-x" title="Close (Esc)" aria-label="Close">✕</button></div>
    <div class="tb-row"><input class="tb-in" type="text" autocomplete="off" enterkeyhint="send" aria-label="What you say to ${esc(rec.name)}">
      <span class="tb-count" aria-hidden="true"></span>
      <button type="button" class="tb-mic" title="Say it" aria-label="Say it" aria-pressed="false">🎤</button>
      <button type="button" class="tb-send" title="Send (Enter)" aria-label="Send">↑</button></div>
    <div class="tb-note" role="status"></div></div>`));
  T = { rec, i, st, at, el, run: null, play: !!app.player?.active, ears: null };
  const input = el.querySelector('.tb-in');
  input.addEventListener('input', paint);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();   // (typing here never walks or steers)
  });
  el.querySelector('.tb-send').onclick = send;
  el.querySelector('.tb-x').onclick = close;
  el.querySelector('.tb-mic').onclick = () => (T?.ears ? stopEars(true) : listen());
  T.timer = setInterval(tick, 500);
  paint(); focus();
  bus.emit('talkbar', true);   // (the labels keep long bubbles out from under it: render/labels.js)
}
function focus() { if (T && !matchMedia('(pointer: coarse)').matches) setTimeout(() => T?.el.querySelector('.tb-in').focus(), 0); }
export function close() {
  if (!T) return;
  const t = T; T = null;
  clearInterval(t.timer); stopEars(false, t);
  t.el.remove();
  bus.emit('talkbar', false);
}
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** What is left, from the server's word: the time before it is cleared (from its first message), messages, characters. */
function paint() {
  if (!T) return;
  const st = T.st, input = T.el.querySelector('.tb-in'), n = input.value.length, now = Date.now();
  input.maxLength = st.maxChars;
  input.placeholder = T.run ? `${T.rec.name} is answering…` : `Say something to ${T.rec.name}…`;
  const live = st.endsAt && st.endsAt > now, msgs = live ? st.left : st.maxMessages;
  const time = live ? fmt(st.endsAt - now) : fmt(st.windowMs);
  T.el.querySelector('.tb-left').innerHTML = `<span class="tb-time${live ? ' on' : ''}" title="${live ? 'Then this conversation is cleared' : 'From your first message'}">⏱ ${time}</span>`
    + `<span class="tb-msgs${msgs <= 3 ? ' low' : ''}" title="Messages left in this conversation">💬 ${msgs}/${st.maxMessages}</span>`;
  const c = T.el.querySelector('.tb-count');
  c.textContent = `${n}/${st.maxChars}`; c.classList.toggle('low', n > st.maxChars * 0.9);
  const out = live && st.left <= 0;
  input.disabled = !!out; T.el.querySelector('.tb-send').disabled = !!T.run || out || !input.value.trim();
  T.el.querySelector('.tb-mic').disabled = !!T.run || out;
  T.el.classList.toggle('busy', !!T.run);
}
function note(text, bad = false) { if (!T) return; const n = T.el.querySelector('.tb-note'); n.textContent = text || ''; n.classList.toggle('bad', !!bad); }
/** Every half second: the clock; a cleared conversation starts afresh; walking away (Play mode) closes the bar; its last
 *  answer stays in its bubble while the bar is open. */
function tick() {
  if (!T) return;
  const st = T.st, said = T.said && S.says.get(T.i);
  if (said && said.text === T.said) said.until = Math.max(said.until, S.simT + 2 * (app.net?.clock?.rate || 1));
  if (st.endsAt && st.endsAt <= Date.now()) { Object.assign(st, { session: null, used: 0, left: st.maxMessages, endsAt: null }); note('That conversation was cleared: the next message starts a new one.'); }
  if (T.play && app.player?.active) {
    const A = app.agents, P = app.player;
    const d = Math.hypot((A.rx[T.i] ?? 1e9) - P.x, (A.rz[T.i] ?? 1e9) - P.z);
    if (d > WALK_OFF) { close(); return; }
  }
  paint();
}

async function send() {
  if (!T || T.run) return;
  const input = T.el.querySelector('.tb-in'), text = input.value.trim();
  if (!text) return;
  const pl = app.player?.active ? app.player : null;
  note('');
  T.run = { id: null, text };
  paint();
  S.says.set(T.i, { text: '…', until: S.simT + forSecs('…') * 4 });   // (it is thinking: its bubble says so)
  try {
    const r = await post('/api/agent-talk/say', { agent: T.rec.id, text, ...(pl ? { x: pl.x, z: pl.z } : T.at ? { x: T.at.x, z: T.at.z } : {}) });
    if (!T) return;
    T.run.id = r.runId;
    Object.assign(T.st, { session: r.session, used: r.used, left: r.left, endsAt: r.endsAt, maxMessages: r.maxMessages, maxChars: r.maxChars, windowMs: r.windowMs });
    input.value = '';
    // (its answer may have come before this reply did: the pieces kept below)
    const early = T.early?.get(r.runId); if (early) finish(early);
  } catch (e) {
    if (!T) return;
    T.run = null; S.says.delete(T.i);
    if (e.code === 'talk_limit') { T.st.left = 0; note(e.message, true); }
    else if (e.code === 'own') { const id = T.rec.id; close(); app.chat?.open(id); return; }
    else note(e.message, true);
  }
  paint();
}
/** The answer's end (to this account alone): into the agent's bubble. */
function onFrame(m) {
  if (!T || !m.run || m.event?.type !== 'run.end') return;
  if (T.run && T.run.id === m.run) return finish(m.event);
  if (T.run && !T.run.id) (T.early ||= new Map()).set(m.run, m.event);   // (before the POST answered)
}
function finish(e) {
  if (!T || !T.run) return;
  T.run = null;
  if (e.status === 'ok' && e.text) T.said = bubble(T.rec.id, e.text);
  else { S.says.delete(T.i); note(e.error || `${T.rec.name} couldn't answer.`, true); }
  paint(); focus();
}

// ------------------------------------------------------------------------------------------------ 🎤 saying it
/** Listens once: the voice service (a recording, sent when 🎤 is pressed again) or the browser's recognition. */
async function listen() {
  if (!T || T.ears) return;
  unlock();
  const t = T, b = t.el.querySelector('.tb-mic');
  let o = null;
  try { o = await voiceOptions(t.rec.id); } catch { /* the server says on the first call */ }
  const server = (o ? o.listen?.source !== 'browser' : true) && can.record();
  if (!server && !can.recognize()) { note('This browser can\'t listen. Type instead.', true); return; }
  b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); note(server ? 'Listening… press 🎤 again when you\'re done' : 'Listening…');
  if (!server) {
    const ear = t.ears = new BrowserEar({ lang: o?.listen?.language || '', onWords: w => { if (T === t) put(w); } });
    try { put(await ear.start()); } catch (e) { if (T === t) note(e.message, true); }
    if (T === t) stopEars(false);
    return;
  }
  const mic = t.ears = new Mic();
  try { await mic.open(); mic.start(); } catch (e) { if (T === t) { note(micWords(e), true); stopEars(false); } return; }
  t.mic = mic;
}
async function stopEars(hearIt, t = T) {
  if (!t || !t.ears) return;
  const ears = t.ears; t.ears = null;
  const b = t.el.querySelector('.tb-mic'); b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
  if (ears instanceof BrowserEar) { if (hearIt) ears.stop(); else ears.abort?.(); return; }
  if (!hearIt) { try { ears.cancel?.(); ears.close(); } catch { /* gone */ } return; }
  note('Hearing it…');
  try {
    const { blob, seconds } = await ears.stop(); ears.close();
    const r = await hear(blob, { seconds });
    if (T === t) { put(r.text); note(''); }
  } catch (e) { if (T === t) note(e.message || 'It wasn\'t heard. Type instead.', true); }
}
function put(words) {
  if (!T) return;
  const input = T.el.querySelector('.tb-in'), w = String(words || '').trim();
  if (!w) return;
  input.value = `${input.value ? `${input.value.trim()} ` : ''}${w}`.slice(0, T.st.maxChars);
  paint(); focus();
}
