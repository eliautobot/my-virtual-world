// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A chat window (docs/features/CHAT.md §6–§7): the world's own, ChatGPT/Claude-like; up to four are open at once, each
// made here (create) and kept by the manager, ui/chat.js. Each is a window on the chats this account has with the
// agents it may use: a list of the agent's chats (pinned first, by day, searchable) and the open chat — its answer
// written as it comes (the socket's pieces; the events route as a fallback), Markdown with code
// blocks to copy, the reasoning a model shows, the steps it took, what it took (model, tokens, cost, time); Stop; edit a
// message, write an answer again; attachments (any file: pick, drop, paste; images shrunk before they go); the chat's
// own model and thinking effort; voice — dictation, read aloud and voice mode (chat-voice.js). Everything it shows comes
// from the server, which decides who may chat with what.
// Opened by the manager for every way of talking to someone (the selection card's Talk, the right-click menu's Talk, the
// Agent Studio's Chat, the floating 💬 button, the team list); who can't chat is told in one line.
// Agent Providers (docs/features/agent-providers.md §4): an agent of a provider (OpenClaw) brings more — what a run is
// doing before it writes, each step as a card (its title and kind, its command, its output as it comes, how it ended),
// approvals with the provider's own choices (allow once, always, deny), the thinking levels its models have, and the
// context meter; its history is the provider's (no editing or writing again: caps.rewrite false).
// (2026-10-08, §12) A floating window — the first at the bottom right, the others beside it; sized from any edge or
// corner (2026-10-18), moved by its header — or full screen (⛶; always on a phone), or put away (—) to its button by 💬; see-through as Settings → Display says; the Sidebar lists the
// open agent's own chats and holds the tools (Search, Projects, Library, Notifications, and its PC — in the side panel); the header finds the agent in
// the world and opens its Agent Studio; a rail of ticks at the right edge goes back to any message the person sent.
import { S, select } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';
import { stateOf, isExt, manages } from '../core/agent-view.js';
import { render } from './chat-md.js';
import { Rail } from './chat-rail.js';
import { icon } from '../core/icons.js';
import { attach as attachVoice } from './chat-voice.js';
import { attach as attachDock } from './chat-dock.js';
import { options as voiceOptions } from './voice.js';
import { inset as docksInset } from './docks.js';
import { itemsHtml as noteItems, approvalStatuses, clickItem as noteClick } from './notify.js';
import * as hermesView from './providers/hermes-chat.js';

let app;   // (the page: given by create)
// (Agent Providers: the window is the same for every agent; a provider with a view of its own lays its turns out the way
// its own app does — Hermes as Hermes Desktop. Others: the window's own drawing.)
const VIEWS = { hermes: hermesView };
const SUGGEST = ['What have you been up to today?', 'Help me plan my week', 'Summarise a document for me', 'Explain this like I\'m five'];
// (its owner's chats are at Work or in Life — CHAT.md §13: what to ask it differs)
const SUGGEST_MODE = { work: ['Help me plan my week', 'Draft an email for me', 'Summarise a document for me', 'Explain this like I\'m five'],
  life: ['What have you been up to today?', 'How is life in the city?', 'Help me plan my week', 'Explain this like I\'m five'] };
// (an agent of an agent provider: a working assistant, not a resident)
const SUGGEST_PROVIDER = ['What can you do?', 'Help me plan my week', 'Summarise a document for me', 'Explain this like I\'m five'];
const KIND_ICON = { read: '📄', edit: '✏️', delete: '🗑️', move: '📦', search: '🔍', execute: '⌨️', think: '💭', fetch: '🌐', other: '🔧' };
const DECIDE = { 'allow-once': 'Allow once', 'allow-session': 'Allow in this chat', 'allow-always': 'Always allow', deny: 'Deny' };
const EFFORT = [['', 'Default', 'The agent\'s own setting'], ['off', 'Off', 'Answers at once'], ['low', 'Low', 'Thinks briefly'], ['medium', 'Medium', 'Thinks it through'], ['high', 'High', 'Thinks hardest; slower and costs more']];
const TOOL_WORDS = { menu: 'Looked at a menu', buy: 'Bought something', pay: 'Paid', flats: 'Looked at flats', rent_flat: 'Rented a flat', ask_owner: 'Asked you for money', plan: 'Added to its plans', remember: 'Remembered', note: 'Kept a work note' };
const IMG_MAX_SIDE = 2048, IMG_SHRINK_BYTES = 3 * 1048576, MAX_FILES = 10;
const touch = () => matchMedia('(pointer: coarse)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = micro => (!Number.isFinite(micro) || micro <= 0 ? '' : micro < 100 ? '<$0.0001' : `$${(micro / 1e6).toFixed(micro < 1e4 ? 4 : micro < 1e6 ? 3 : 2)}`);
const kTok = n => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const secs = ms => (ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
const agentRec = id => (S.agentList || []).find(a => a.id === id) || null;
const chattable = () => (S.agentList || []).filter(a => a.level);   // (whether each can chat now: asked when chosen)
const MODE_KEY = 'mvw.chat.mode', GEO_KEY = 'mvw.chat.place', WIDE_PX = 820, MIN_W = 340, MIN_H = 380, GAP = 10;
const phone = () => innerWidth < 700;
const GRIPS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];   // (the floating window's edges and corners, to size it from)
const EDGE_BTN = 40;   // (a side panel's edge button: the strip it takes beside the panel, ui/docks.js)
/** The room the floating windows have: the screen less the top bar and the selection widget under it, an open side panel
 *  on either side (and the left one's edge button), and the floating buttons at the right (px from each edge). */
export function room() {
  const css = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 56;
  // (where the selection widget ends at the top, open or folded to its handle: ui.js selRoom)
  const selB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sel-b')) || 0;
  const fb = document.getElementById('floatbtns'), fbW = fb ? fb.offsetWidth : 0;   // (0 when it is not shown)
  return {
    top: Math.max(css + GAP, selB),
    right: docksInset.r + (fbW ? 12 + fbW + GAP : 16),
    // (the left side panel's edge button, beside it open or closed, near the top: its strip kept clear — ui/docks.js)
    left: docksInset.l + (docksInset.l || docksInset.tl ? EDGE_BTN : 0) + GAP,
    bottom: 16,
  };
}
/** The person's Side by side: `n` windows across the room, left to right, each its full height — as wide as the room
 *  shares out, never under MIN_W (then they overlap evenly). Each { w, h, r, b }, the leftmost first. */
export function tiles(n) {
  const R = room(), availW = Math.max(200, innerWidth - R.left - R.right), availH = Math.max(200, innerHeight - R.top - R.bottom);
  const w = Math.max(Math.min(MIN_W, availW), Math.floor((availW - GAP * (n - 1)) / n)), step = n > 1 ? Math.min(w + GAP, (availW - w) / (n - 1)) : 0;
  return Array.from({ length: n }, (_, k) => ({ w, h: availH, r: Math.max(0, Math.round(availW - w - k * step)), b: 0 }));
}
/** A side question or background task a chat started, answered (Hermes' /btw, /bg): kept with its chat once — shown in
 *  the window that has that chat open (ctx), if one does. */
export function sideAnswer(m, ctx) { for (const v of new Set(Object.values(VIEWS))) v.onSide?.(m, ctx); }
/** Where a new floating window goes (w × h, in a room availW × availH; `others`: the windows floating there, each
 *  { w, h, r, b } from the room's right and bottom edges, the top one last): along the bottom from the right, in the first
 *  gap none of them covers — at its size, else narrowed to the gap (not under MIN_W); with no gap, a step up and in from
 *  the top one, over them. Only where it opens: once open, nothing but the person moves it. */
function spotFor(w, h, availW, availH, others) {
  w = Math.min(w, availW); h = Math.min(h, availH);
  const hits = (r, b, ww, hh) => others.some(o => r < o.r + o.w && o.r < r + ww && b < o.b + o.h && o.b < b + hh);
  const xs = [0, ...others.map(o => o.r + o.w + GAP)].filter(r => r < availW).sort((p, q) => p - q);
  for (const r of xs) if (r + w <= availW && !hits(r, 0, w, h)) return { w, h, r, b: 0 };
  for (const r of xs) {
    // (the room to its left up to the next window there, or the room's edge)
    const room = Math.min(availW, ...others.filter(o => o.r >= r && o.b < h).map(o => o.r - GAP)) - r;
    if (room >= Math.min(MIN_W, availW) && !hits(r, 0, room, h)) return { w: room, h, r, b: 0 };
  }
  const STEP = 28, top = others[others.length - 1];
  return { w, h, r: top.r + STEP + w <= availW ? top.r + STEP : Math.max(0, top.r - STEP), b: top.b + STEP + h <= availH ? top.b + STEP : Math.max(0, top.b - STEP) };
}
const store ={ get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
/** A chat's messages, asked for now (pick starts it with the rest). */
const historyOf = (agentId, sessionId) => getJSON(`/api/providers/history?agent=${agentId}&session=${sessionId}`);
const AV = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mp3|m4a|wav|ogg|oga|opus|flac|aac)$/i;
const isAvFile = file => /^(video|audio)\//.test(file.type || '') || AV.test(file.name || '');
const mb = n => `${Math.round(n / 1048576 * 10) / 10} MB`;
// ------------------------------------------------------------------------------------------------ the Sidebar
const VIEW_TITLES = { search: 'Search', projects: 'Projects', library: 'Library', notify: 'Notifications' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function dayGroup(ms) {
  const d = new Date(ms), now = new Date(), day = 86400000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= start) return 'Today';
  if (ms >= start - day) return 'Yesterday';
  if (ms >= start - 6 * day) return 'Previous 7 days';
  if (ms >= start - 29 * day) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
const sizeOf = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
/** The browser's time zone: an agent at work tells the time where its owner is, unless its job names one (CHAT.md §13). */
function zoneArg() { try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return tz ? { tz } : {}; } catch { return {}; } }
const cap1 = s => String(s || '').replace(/^\w/, c => c.toUpperCase());
/** The context meter (Agent Providers): how much of the model's window the conversation fills now. */
const pctOf = u => (u && u.size > 0 && Number.isFinite(u.used) ? Math.min(100, Math.round(100 * u.used / u.size)) : null);
function filesHtml(list) {
  if (!list?.length) return '';
  const src = f => `/api/chat/attachments/file?id=${encodeURIComponent(f.id)}`;
  return `<div class="cw-mfiles">${list.map(f => (/^video\//.test(f.mime) ? `<figure class="cw-mvid cw-mine"><video src="${src(f)}" controls preload="metadata" playsinline></video><figcaption>🎥 ${esc(f.name)}${Number.isFinite(f.size) ? ` · ${fileSize(f.size)}` : ''}</figcaption></figure>`
    : /^audio\//.test(f.mime) ? `<figure class="cw-maud cw-mine"><audio src="${src(f)}" controls preload="none"></audio><figcaption>🎧 ${esc(f.name)}</figcaption></figure>`
    : /^image\//.test(f.mime) ? `<a class="cw-thumb" href="/api/chat/attachments/file?id=${encodeURIComponent(f.id)}" target="_blank" rel="noopener"><img src="/api/chat/attachments/file?id=${encodeURIComponent(f.id)}" alt="${esc(f.name)}" loading="lazy"></a>`
    : `<a class="cw-fchip" href="/api/chat/attachments/file?id=${encodeURIComponent(f.id)}" target="_blank" rel="noopener"><span aria-hidden="true">${fileIcon(f.name)}</span><span>${esc(f.name)}</span></a>`)).join('')}</div>`;
}
const fileSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** Whether a picture can go to the clipboard here (a secure page: https, or this machine). */
const canCopyImage = () => !!(window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem);
/** A picture to the clipboard, as PNG (what browsers take for images). */
async function copyImage(src) {
  const blob = await (await fetch(src, { credentials: 'same-origin' })).blob();
  let png = blob;
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob), c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
    png = await new Promise(r => c.toBlob(r, 'image/png'));
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
const ZOOM_MIN = 0.1, ZOOM_MAX = 8, ZOOM_STEP = 1.25;
function fileIcon(n) { const e = (/\.(\w+)$/.exec(n || '') || [])[1]?.toLowerCase(); return /^(png|jpe?g|gif|webp)$/.test(e) ? '🖼' : /^(mp4|m4v|mov|webm|mkv|avi|3gp)$/.test(e) ? '🎥' : /^(mp3|m4a|wav|ogg|oga|opus|flac|aac)$/.test(e) ? '🎧' : '📄'; }
function metaLine(meta) {
  if (!meta) return '';
  const bits = [meta.model, meta.effort && meta.effort !== 'off' ? `${meta.effort} effort` : '', Number.isFinite(meta.tokensIn) ? `${kTok(meta.tokensIn)} in · ${kTok(meta.tokensOut || 0)} out` : '', money(meta.cost), Number.isFinite(meta.ms) ? secs(meta.ms) : ''].filter(Boolean);
  return bits.length ? `<span class="cw-meta" title="What this answer took">${esc(bits.join(' · '))}</span>` : '';
}
/**
 * The answer being written: this chat's own run, or (observed) one the provider runs from another channel. Drawn once as a
 * frame of parts — its reasoning, its steps, its text, what waits for the person — then kept up to date part by
 * part (updateLive): only a part that changed is touched, the text only from its first changed paragraph, at most LIVE_MS
 * apart (2026-10-16: "my GPU is screaming while the chat works" — the whole answer was drawn again for every piece).
 */
const LIVE_MS = 80;        // ≈12 updates a second while it writes
const RECENT_STEPS = 3;    // finished steps shown as cards; the ones before fold into one row
/** Puts `html` into the live answer's part `name` — only when it differs from what is there. */
function setPart(live, name, html) {
  const el = live.querySelector(`[data-part="${name}"]`);
  if (!el || el._h === html) return false;
  el._h = html; el.innerHTML = html;
  return true;
}
/**
 * The task progress card, in the composer (OpenClaw's own: the agent's notes and checklist, sliding up from the message
 * box), kept up to date as the agent works, and when a refresh or another channel changes it. As OpenClaw shows it: open
 * on a wide screen until every step is done, opening again when a turn starts or ends; folded on a phone; folded by
 * itself when the person scrolls back through the conversation — unless they opened it again twice there. Their own
 * open or fold stands for that chat while the page is open. Folded, it is one row: the step under way and how far along.
 * Drawn again only when what it shows changed; opening and folding only moves it.
 */
const CARD_READING_PX = 320;          // scrolled back this far from the end: reading, the card folds
const CARD_REFRESH_MS = 120000;       // a refresh with no new card after this long: said so (it may still come)
const narrow = () => matchMedia('(max-width: 700px), (pointer: coarse)').matches;
/** A request's own key (random; getRandomValues works on a page served over plain http, randomUUID does not). */
const requestKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
/** The step the folded card names: the one under way, else the next, else that all are done (or the note's first line). */
function cardNow(p, steps, complete) {
  const x = steps.find(t => t.status === 'in_progress') || steps.find(t => t.status === 'pending');
  if (x) return x.step;
  if (complete) return 'All steps done';
  return String(p.markdown || '').split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '';
}
const REFRESH_SAYS = { pending: 'Refreshing task progress…', updated: 'Task progress updated', failed: 'Could not refresh. Previous update kept.', timeout: 'No new update yet. The request may still be running.' };
/** "just now", "5m ago", "2h ago", or the day. */
function updatedAgo(t) {
  const s = (Date.now() - t) / 1000;
  return s < 45 ? 'just now' : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `on ${new Date(t).toLocaleDateString()}`;
}
/** The person's answers to a question card: { questionId: [choices and words] }, or a reason it isn't complete. */
function answersOf(card) {
  const out = {};
  for (const el of card.querySelectorAll('.cw-q')) {
    const picked = [...el.querySelectorAll('.cw-q-o[aria-pressed="true"]')].map(b => b.dataset.label);
    const text = el.querySelector('.cw-q-text')?.value.trim();
    const list = [...picked, ...(text ? [text] : [])];
    if (!list.length) return { missing: el.querySelector('p')?.textContent || 'a question' };
    out[el.dataset.q] = el.dataset.multi === '1' ? list : [list[list.length - 1]];
  }
  return { answers: out };
}
/** A short signature of some markup (what a card shows: data-sig). */
function sigOf(html) { let x = 0; for (let k = 0; k < html.length; k++) x = (x * 31 + html.charCodeAt(k)) | 0; return `${html.length}:${x}`; }
const tailOf = (s, lines = 40) => { const l = String(s || '').split('\n'); return (l.length > lines ? `…\n${l.slice(-lines).join('\n')}` : l.join('\n')).slice(-6000); };
let foldSeq = 0;   // (folded steps' ids: foldHtml)
/** A piece added where it starts (`at`): what the page already has (the events route read the whole so far) is not added
 *  twice; a piece after a gap waits for the events route to fill it. */
function joinAt(cur, piece, at) {
  if (!Number.isInteger(at)) return cur + piece;
  if (at > cur.length) return cur;
  return at + piece.length <= cur.length ? cur : cur + piece.slice(cur.length - at);
}
/** A pause the run can cut short (R.wake: a gap in the pieces is filled at once). */
const nap = (R, ms) => new Promise(resolve => { const t = setTimeout(resolve, ms); R.wake = () => { clearTimeout(t); R.wake = null; resolve(); }; });

/**
 * One chat window (the manager, ui/chat.js, keeps up to four): its own agent and chat, Sidebar, side panel, composer,
 * files, model and effort, voice, and the provider's own view of the turns (Hermes as Hermes Desktop; OpenClaw's cards).
 * mgr: the manager's hooks — front (to the top), changed (its button and the saved windows follow), closed, holder (the
 * window already showing a chat), open (another window), rects (where the others float), claimVoice (one window speaks
 * or listens at a time), count. o: how it opens — { geo, mode, min, side, dock, draft } when it comes back with the page.
 */
export function create(a, mgr, o = {}) {
  app = a;
  let W = null;        // W: this window's state, or null once it is closed
  const view = () => (W && W.can && W.can.ok && Object.hasOwn(VIEWS, W.can.kind || '') ? VIEWS[W.can.kind] : null);
  /** The window says whose view it shows (its styles: pv-<kind>). */
  function paintKind() {
    const win = W && W.el.querySelector('.chatwin');
    if (!win) return;
    for (const c of [...win.classList]) if (c.startsWith('pv-')) win.classList.remove(c);
    const v = view();
    if (v) win.classList.add(`pv-${v.kind}`);
  }
  /** What the voice (chat-voice.js) and the side panel (chat-dock.js) may use of the window. */
  const host = {
    get el() { return W.el; }, get agentId() { return W?.agentId ?? null; }, get agent() { return W ? agentRec(W.agentId) : null; }, get session() { return W?.session || null; },
    input: () => $w('.cw-in'), grow: () => grow(), paintSend: () => paintSend(), toast: (m, kind = '', ms = 3800, ic) => app.toast?.(m, kind, ms, ic),
    say: text => sendVoice(text), stop: () => stop(), run: () => W?.run || null, focus: () => { if (W && !touch()) $w('.cw-in').focus(); },
    /** Its name over its head in the world glows with how loud it talks (0–1; null: no more) — render/labels.js. */
    labelGlow: lv => app.labels?.voice?.(lv === null || !W ? -1 : agentRec(W.agentId)?.i ?? -1, lv || 0),
    can: () => W?.can || null, wide: () => !!W?.wide,
    /** It begins to listen or speak: the other windows stop theirs (one microphone, one voice at a time). */
    claimVoice: () => mgr.claimVoice(me),
    /** The side panel opened, closed or changed tab: kept with the window. */
    changed: () => mgr.changed(me),
  };

  /** Shows agent `id` — its latest chat (latest: false — a new one), or `session` — or, with no agent named, the account's
   *  most recent chat. quiet: coming back with the page (a chat it may no longer have closes the window without a word). */
  async function show(id = null, { session = null, latest = !session, onClose = null, project = null, quiet = false } = {}) {
    if (!W) build();
    if (onClose) W.onClose = onClose;
    const tok = ++W.token;
    if (id === null) {
      // the most recent chat's agent (or the first it may chat with) — one no other window shows
      let recent = [];
      try { recent = (await getJSON('/api/chat/recent')).sessions || []; } catch { /* none */ }
      if (!W || tok !== W.token) return;
      const last = recent.find(s => !mgr.holder(s.agentId, s.id, me));
      if (last) return pick(last.agentId, last.id);
      const first = chattable()[0];
      if (first) return pick(first.id, null);
      return blocked({ message: 'You have no agents to chat with yet. Create one in the Agents list, or ask someone to share theirs with you.' });
    }
    return pick(id, session, { latest, project, quiet });
  }
  /** The open agent's own chats and projects (the Sidebar's list). */
  async function loadList(tok = W.token) {
    try {
      const r = await getJSON(`/api/chat/recent?agent=${W.agentId}`);
      if (!W || tok !== W.token) return;
      W.sessions = r.sessions || []; W.projects = r.projects || [];
    } catch { if (W && tok === W.token) { W.sessions = []; W.projects = []; } }
  }

  /** Shows agent `id`'s chat `sessionId` (null: a new chat, made when the first message is sent). */
  async function pick(id, sessionId, { latest = false, project = null, quiet = false } = {}) {
    // (a chat another window shows: that window comes forward — one chat is never in two windows)
    const elsewhere = sessionId ? mgr.holder(id, sessionId, me) : null;
    if (elsewhere) { mgr.front(elsewhere, { reveal: true }); if (!W.agentId) close(); return; }
    const tok = ++W.token;
    const other = W.agentId !== id;
    W.obs = null; stopWatching();
    W.agentId = id; W.session = null; W.messages = []; W.models = null; W.subs = new Map(); W.pending = { model: null, effort: null, mode: null }; W.newIn = project; W.usage = null; W.prov = null; W.plan = null;
    W.want = sessionId;   // (the chat it is opening: the other windows know it is taken before it has loaded)
    if (other) W.limits = null;
    if (other) W.commands = null;
    W.editing = null;
    if (other) {
      // (files waiting to be sent were for the other agent, which may read them; this one may not)
      W.files.forEach(f => { f.xhr?.abort(); if (f.preview) URL.revokeObjectURL(f.preview); }); W.files = [];
      // (the Sidebar is the new agent's: its chats, its projects)
      W.view = 'chats'; W.projectId = null; W.inProject = null; W.hits = null; W.search = ''; W.library = null; W.sessions = []; W.projects = []; W.notes = null;
      const si = W.el.querySelector('.cw-search input'); if (si) si.value = '';
    }
    W.can = null; abandonRun(); W.voice?.reset(); W.early = []; W.queued = []; W.done = new Set();
    paintKind();
    head(); paintThread(); paintComposer(); W.dock?.sync();
    if (other) loadNotes();
    // (asked together, not one after another: whether it may chat, its chats and — a chat named — that chat's messages;
    // each round trip waited for the one before, three in a row on a phone's network)
    const canP = getJSON(`/api/chat/can?agent=${id}`).catch(e => ({ ok: false, message: e.message }));
    const listP = loadList(tok);
    const histP = sessionId ? historyOf(id, sessionId) : null;
    histP?.catch(() => {});   // (not used when it may not chat: its failure is nobody's)
    const can = await canP;
    if (!W || tok !== W.token) return;
    W.can = can;
    paintKind();
    await listP;
    if (!W || tok !== W.token) return;
    // (its latest chat — unless another window shows it: then a new one here, beside it)
    if (latest && !sessionId) { const s0 = W.sessions[0]; sessionId = s0 && !mgr.holder(id, s0.id, me) ? s0.id : null; W.want = sessionId; }
    if (W.view === 'project') loadProject(W.projectId);
    if (!can.ok) { const rec = agentRec(id); if (!can.fix && !W.sessions.some(s => s.agentId === id)) { close(); return quiet ? undefined : app.toast?.(can.message, '', 4500, '💬'); } blocked(can, rec); head(); return; }
    W.el.querySelector('.cw-blocked').classList.add('hidden');
    voiceOptions(id).catch(() => {});   // (what listens and speaks, ready for the first 🎤 or 🔊)
    if (sessionId) {
      W.session = sessionOf(sessionId);
      W.want = W.session ? W.session.id : null;   // (a chat gone meanwhile: a new one here, not remembered as that)
      await loadHistory(tok, histP);
      loadSubs();
      paintQueue(); flushOutbox();   // (what was queued in this chat: still here; the agent free now: the next goes)
    }
    if (!W || tok !== W.token) return;
    head(); paintSide(); paintThread(); paintComposer();
    W.dock.sync();   // (the chat's background tasks, for whoever manages the provider)
    // (back with the page: what was typed, the side panel as it was)
    const back = W.back; W.back = null;
    if (back?.draft && !$w('.cw-in').value) { $w('.cw-in').value = back.draft; grow(); paintSend(); }
    if (back?.dock) W.dock.toggle(true, back.dock, { quiet: true });
    if (!touch() && mgr.isFront(me) && !W.min) W.el.querySelector('.cw-in').focus();   // (a window behind the others doesn't take the keys)
    loadModels(tok);
    loadLimits(tok);
    mgr.changed(me);
  }

  async function loadHistory(tok = W.token, started = null) {
    if (!W.session) { W.messages = []; W.dock?.sync(); view()?.loaded?.(cctx()); return; }
    try {
      const j = await (started || historyOf(W.agentId, W.session.id));
      if (!W || tok !== W.token) return;
      W.messages = (j.messages || []).filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system');
      // (a provider's own messages carry no id of this installation's: each gets one for this page — below zero, never a
      // transcript id — so its actions, copy and read aloud find it)
      let pid = 0;
      for (const m of W.messages) if (m.id === undefined || m.id === null) m.id = -(++pid);
      // (a provider view's own lines among them — Hermes: what its commands said, kept for the page's life)
      if (view()?.withNotes) W.messages = view().withNotes(W.session.id, W.messages);
      W.usage = j.usage || null; W.prov = j.session || null;   // (a provider's: the context meter, the session's own model and thinking)
      W.plan = j.plan && ((j.plan.steps && j.plan.steps.length) || j.plan.markdown) ? j.plan : null;   // (… and its progress card)
      W.planCan = j.planCan || {};
      W.liveRun = j.live || null;   // (an answer of this person's still being written here: followed — attachRun)
      if (W.liveRun && !W.run && !W.sending && !W.queued.some(q => q.id === W.liveRun)) attachRun(W.liveRun, { reload: false });
      if (!W.obs || W.obs.observed) watchSession();
      W.dock.sync();   // (another chat: its background tasks)
      post('/api/notifications/read', { agent: W.agentId, session: W.session.id }).catch(() => {});   // (what told of this chat is read)
      view()?.loaded?.(cctx());   // (a provider view's own reading for the chat — Hermes: its commands)
      await apprStatus();
    } catch (e) { if (W && tok === W.token) W.messages = [{ role: 'system', text: e.message }]; }
  }
  /** Where the approvals in this chat stand (pending ones are asked again: they may have been answered elsewhere). */
  async function apprStatus(all = false) {
    const ids = [...new Set([...W.messages.flatMap(m => (m.meta?.approvals || []).map(a => a.id)), ...(W.run?.approvals || []).map(a => a.id)])]
      .filter(id => /^econ:/.test(id) && (all || !W.apprs.has(id) || W.apprs.get(id) === 'pending'));
    if (!ids.length) return;
    try { for (const a of (await getJSON(`/api/economy/approvals?ids=${encodeURIComponent(ids.map(x => x.slice(5)).join(','))}`)).approvals || []) W.apprs.set(`econ:${a.id}`, a.status); } catch { /* shown as asked */ }
  }
  /** The largest file the agent's provider takes (OpenClaw announces it), to say so before a file is uploaded. */
  async function loadLimits(tok) {
    if (!W.can?.caps?.attachments || W.limits) return;
    try { const r = await getJSON(`/api/providers/limits?agent=${W.agentId}`); if (W && tok === W.token) W.limits = r || {}; } catch { /* the send says it */ }
  }
  async function loadModels(tok) {
    if (!W.can?.caps?.models) return;
    try { const m = await getJSON(`/api/providers/models?agent=${W.agentId}`); if (W && tok === W.token) { W.models = m; paintComposer(); } } catch { /* the picker stays on the default */ }
  }

  /** keep: closed with the page's account (signed out), not by the person — it comes back with the account. */
  function close({ keep = false } = {}) {
    if (!W) return;
    const w = W; W = null;
    w.token++;
    abandonRun(w);
    stopWatching(w);
    w.voice?.close();
    w.rail?.destroy(); w.ro?.disconnect(); w.dock?.close(); clearInterval(w.cardTick);
    for (const u of w.tabShots.values()) if (u) URL.revokeObjectURL(u);
    for (const f of w.files) f.xhr?.abort();
    w.el.remove();
    document.removeEventListener('pointerdown', w.away, true);
    try { w.onClose?.(); } catch { /* its opener is gone */ }
    mgr.closed(me, { keep });
  }

  // ------------------------------------------------------------------------------------------------ the window
  function build() {
    const el = mgr.layer().appendChild(h(`<div class="chat-back" data-win="${me.id}">
    <div class="chatwin panel" role="dialog" aria-label="Chat">
      ${GRIPS.map(g => `<div class="cw-grip ${g}" data-grip="${g}" aria-hidden="true"></div>`).join('')}
      <aside class="cw-side" aria-label="Sidebar">
        <div class="cw-side-head"><b class="cw-side-title">Sidebar</b><span class="cw-grow"></span>
          <button type="button" class="btn icon cw-side-x" title="Hide the Sidebar" aria-label="Hide the Sidebar">⟨</button></div>
        <button type="button" class="btn cw-new" title="New chat (Ctrl+Shift+O)">✎ New chat</button>
        <nav class="cw-navs" aria-label="Tools">
          <button type="button" class="cw-nav" data-view="search" title="Search this agent's chats (Ctrl+K)"><span class="cw-nav-ic" aria-hidden="true">🔍</span><span>Search</span></button>
          <button type="button" class="cw-nav" data-view="projects" title="Folders of chats, with their own instructions"><span class="cw-nav-ic" aria-hidden="true">🗂</span><span>Projects</span></button>
          <button type="button" class="cw-nav" data-view="library" title="The files and pictures you've sent"><span class="cw-nav-ic" aria-hidden="true">📚</span><span>Library</span></button>
          <button type="button" class="cw-nav" data-view="notify" title="What this agent asked, told you or answered"><span class="cw-nav-ic" aria-hidden="true">🔔</span><span>Notifications</span><span class="cw-nav-n hidden"></span></button>
          <button type="button" class="cw-nav hidden" data-pc="1" title="Its PC beside the chat: what it is doing on it, live"><span class="cw-nav-ic" aria-hidden="true">💻</span><span>PC</span></button>
        </nav>
        <div class="cw-view-head hidden"><button type="button" class="btn icon small cw-back" title="Back to the chats" aria-label="Back to the chats">⟨</button>
          <b class="cw-view-title" data-noicon></b><span class="cw-grow"></span><button type="button" class="btn small cw-view-act hidden"></button></div>
        <label class="cw-search hidden"><span aria-hidden="true">🔍</span><input type="search" placeholder="Search this agent's chats" aria-label="Search this agent's chats" autocomplete="off"></label>
        <div class="cw-list" role="list"></div>
      </aside>
      <section class="cw-main">
        <header class="cw-head" title="">
          <button type="button" class="btn icon cw-burger" title="Sidebar (Ctrl+K: search)" aria-label="Sidebar">☰</button>
          <button type="button" class="cw-agent" aria-haspopup="listbox" title="Chat with another agent"><span class="cw-av" data-avatar>🤖</span>
            <span class="cw-id"><b class="cw-name">Chat</b><span class="cw-status"></span></span><span class="cw-caret" aria-hidden="true">▾</span></button>
          <span class="cw-title" title="" data-noicon></span>
          <div class="cw-acts">
            <button type="button" class="btn icon cw-wins hidden" title="Your chat windows" aria-label="Your chat windows" aria-haspopup="menu">${icon('windows')}<span class="cw-wins-n"></span></button>
            <button type="button" class="btn icon cw-dockb hidden" title="Side panel: background tasks, the agents' browser, the agent's phone" aria-label="Side panel" aria-pressed="false">${icon('panel')}<span class="cw-dockb-n hidden"></span></button>
            <button type="button" class="btn icon cw-find" title="Find it in the world" aria-label="Find it in the world">🎥</button>
            <button type="button" class="btn icon cw-studio" title="Its Agent Studio" aria-label="Its Agent Studio">${icon('agent')}</button>
            <button type="button" class="btn icon cw-min" title="Put away (it stays by the 💬 button, still working)" aria-label="Put away">${icon('minimize')}</button>
            <button type="button" class="btn icon cw-max" title="Full screen" aria-label="Full screen" aria-pressed="false"></button>
            <button type="button" class="btn icon cw-x" title="Close (Esc)" aria-label="Close">✕</button></div>
        </header>
        <div class="cw-scroll"><div class="cw-thread" role="log" aria-live="polite" aria-relevant="additions"></div></div>
        <button type="button" class="cw-down hidden" title="Go to the latest" aria-label="Go to the latest">⬇</button>
        <div class="cw-blocked hidden" role="status"></div>
        <footer class="cw-foot">
          <button type="button" class="cw-tchip hidden" title="The background tasks this chat started"></button>
          <div class="cw-vq hidden" aria-live="polite"></div>
          <div class="cw-box">
            <div class="cw-card hidden" aria-live="polite"></div>
            <div class="cw-files"></div>
            <textarea class="cw-in" rows="1" placeholder="Message…" aria-label="Your message" enterkeyhint="send"></textarea>
            <div class="cw-tools">
              <button type="button" class="cw-tool cw-attach" title="Attach files (images, PDFs, documents, code)" aria-label="Attach files">＋</button>
              <input type="file" class="cw-file" multiple hidden>
              <button type="button" class="cw-tool cw-model" aria-haspopup="listbox" title="Model"><span class="cw-tool-lb">Model</span> ▾</button>
              <button type="button" class="cw-tool cw-effort" aria-haspopup="listbox" title="Thinking effort"><span aria-hidden="true">💡</span> <span class="cw-tool-lb">Default</span> ▾</button>
              <button type="button" class="cw-tool cw-ctx hidden" title="Context"><svg class="cw-ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><circle class="cw-ring-v" cx="10" cy="10" r="8"/></svg><span class="cw-tool-lb">0%</span></button>
              <div class="cw-cmode hidden" role="radiogroup" aria-label="Work or Life">
                <button type="button" class="cw-tool" data-cm="work" role="radio" aria-checked="false" title="Work: on the job for you — the real date and time, its job, what it knows and its notes; nothing of its city life"><span aria-hidden="true">💼</span><span class="cw-tool-lb">Work</span></button>
                <button type="button" class="cw-tool" data-cm="life" role="radio" aria-checked="false" title="Life: the resident of the city — its own life, plans and memories, and its city tools"><span aria-hidden="true">🏠</span><span class="cw-tool-lb">Life</span></button></div>
              <div class="cw-tools-r">
                <button type="button" class="cw-tool cw-vm-state hidden" aria-live="polite"></button>
                <button type="button" class="cw-tool cw-mic" title="Dictate: say it, it is written here" aria-label="Dictate" aria-pressed="false">🎤</button>
                <button type="button" class="cw-tool cw-vm" title="Voice mode: talk with it" aria-label="Voice mode">🎧</button>
                <button type="button" class="cw-tool cw-queue hidden" title="Queue message" aria-label="Queue message">${icon('layers')}</button>
                <button type="button" class="cw-send" title="Send (Enter)" aria-label="Send">↑</button></div>
            </div>
          </div>
          <div class="cw-note">Agents can make mistakes. Check important information.</div>
        </footer>
        <div class="cw-drop hidden" aria-hidden="true"><div>Drop files to attach</div></div>
      </section>
      <aside class="cw-dock" aria-label="Side panel" hidden></aside>
    </div></div>`));
    W = { el, token: 0, agentId: null, session: null, sessions: [], projects: [], messages: [], run: null, queued: [], done: new Set(), sending: 0, files: [], can: null, models: null, pending: { model: null, effort: null, mode: null },
      usage: null, prov: null, steps: new Map(), stepSeen: new Map(), folds: new Map(), cards: new Map(), tabShots: new Map(), planCan: {}, plan: null, commands: null,   // (plan: the session's progress card; commands: the agent's / menu)   // (stepSeen: what a step showed as it ran — its title, exit code, time: the history keeps only its tool's name and output)   // (Agent Providers: the context meter, the provider's own session settings, the steps a person opened or closed)
      pop: null, view: 'chats', search: '', hits: null, stick: true, onClose: null, editing: null, apprs: new Map(), early: [], newIn: null, library: null,
      // (its place: as it was when it comes back with the page; a first window as the last one was; another beside them)
      choice: o.mode === 'max' || o.mode === 'float' ? o.mode : mgr.count() <= 1 && store.get(MODE_KEY, 'float') === 'max' ? 'max' : 'float', mode: null, geo: o.geo || null,
      min: false, unread: 0, back: o.draft || o.dock ? { draft: o.draft || '', dock: o.dock || null } : null };
    W.voice = attachVoice(host);
    W.dock = attachDock(host);
    W.cardTick = setInterval(() => { if (W && W.plan) paintCard(); }, 30000);   // (its "Updated 5m ago" moves on)
    const $ = s => el.querySelector(s);
    $('.cw-x').onclick = () => close();
    $('.cw-min').onclick = () => setMin(true);
    $('.cw-wins').onclick = e => winsMenu(e.currentTarget);
    el.addEventListener('pointerdown', e => { if (e.target === el && W.mode === 'max') close(); });
    // (whatever is touched in it brings it to the top of the others)
    $('.chatwin').addEventListener('pointerdown', () => mgr.front(me), true);
    $('.chatwin').addEventListener('focusin', () => mgr.front(me));
    $('.cw-new').onclick = () => newChat();
    $('.cw-burger').onclick = () => toggleSide();
    $('.cw-side-x').onclick = () => toggleSide(false);
    $('.cw-agent').onclick = e => agentMenu(e.currentTarget);
    $('.cw-find').onclick = findAgent;
    // (its Agent Studio over the world: the window put away meanwhile — its chat as it was, by the 💬 button)
    $('.cw-studio').onclick = () => { const id = W.agentId; setMin(true); app.studio?.open(id, 'overview'); };
    $('.cw-max').onclick = () => setMode(W.mode === 'max' ? 'float' : 'max');
    $('.cw-head').addEventListener('dblclick', e => { if (!e.target.closest('button') && !phone()) setMode(W.mode === 'max' ? 'float' : 'max'); });
    // the dimmed chat behind the Sidebar (when it slides over): a tap closes the Sidebar
    // (the dimming is the chat's ::after, over all of it: what is tapped is the chat itself)
    $('.cw-main').addEventListener('pointerdown', e => { if (e.target === e.currentTarget && W.el.querySelector('.chatwin.drawer')) { e.preventDefault(); toggleSide(false); } });
    $('.cw-model').onclick = e => modelMenu(e.currentTarget);
    $('.cw-effort').onclick = e => effortMenu(e.currentTarget);
    $('.cw-ctx').onclick = e => ctxInfo(e.currentTarget);
    // (a step card a person opens or closes stays so as the answer is written)
    el.addEventListener('toggle', e => {
      const d = e.target;
      if (d.matches?.('details.cw-tstep') && !d.dataset.painting) W.steps.set(d.dataset.tool, d.open);
      if (d.matches?.('details.cw-tfold') && d.open) fillFold(d);   // (folded steps: drawn when opened)
    }, true);
    $('.cw-cmode').onclick = e => { const b = e.target.closest('[data-cm]'); if (b) setChatMode(b.dataset.cm); };
    // (a radio group: the arrows move between Work and Life)
    $('.cw-cmode').onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const m = curMode() === 'work' ? 'life' : 'work';
      setChatMode(m).then(() => W?.el.querySelector(`.cw-cmode [data-cm="${m}"]`)?.focus());
    };
    $('.cw-attach').onclick = () => $('.cw-file').click();
    $('.cw-file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
    $('.cw-send').onclick = () => submit({ button: true });
    $('.cw-queue').onclick = () => view()?.submit?.(cctx(), { queue: true });
    $('.cw-vq').onclick = e => {
      const o = e.target.closest('[data-oq]');
      if (o) { outboxAction(o.dataset.oq, o.closest('[data-q]')?.dataset.q); return; }
      const b = e.target.closest('[data-qa]'); if (!b) return; view()?.queueAction?.(cctx(), b.dataset.qa, b.closest('[data-q]')?.dataset.q, b);
    };
    const input = $('.cw-in');
    input.addEventListener('input', () => { grow(); paintSend(); cmdMenu(); mgr.changed(me); });   // (what is typed is kept with the window)
    input.addEventListener('keydown', e => {
      // the / menu (a provider's slash commands): the arrows move, Enter or Tab picks, Esc closes
      if (W.pop?.classList.contains('cw-pop-cmds')) {
        const items = [...W.pop.querySelectorAll('[data-k]')];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); W.cmdAt = (W.cmdAt + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; items.forEach((b, k) => b.classList.toggle('hl', k === W.cmdAt)); items[W.cmdAt]?.scrollIntoView({ block: 'nearest' }); return; }
        // (Enter on what is already written in full — a command typed out: that one, whichever is highlighted)
        const exact = e.key === 'Enter' ? items.find(b => b.dataset.ins !== undefined && b.dataset.ins.trim() === input.value.trim()) : null;
        if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing) || e.key === 'Tab') { e.preventDefault(); (exact || items[W.cmdAt])?.click(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
      }
      // (a provider's own Esc while it works — Hermes: stop the turn, as its Desktop)
      if (e.key === 'Escape' && !W.voice.dictating && view()?.escape?.(cctx())) { e.preventDefault(); e.stopPropagation(); return; }
      if (W.voice.dictating) {
        // while dictating: Enter is done, Esc puts the text back as it was
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); W.voice.finishDictation(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); W.voice.cancelDictation(); return; }
      }
      // Enter sends — on a phone too: its keyboard shows a send key (enterkeyhint) and that key sends; Shift+Enter is a new
      // line (2026-10-20: the phone's send key wrote a new line, and Enter was ignored while the agent was still answering)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit({ ctrl: e.ctrlKey || e.metaKey });
      }
      if (e.key === 'ArrowUp' && !input.value && !W.run) { const last = [...W.messages].reverse().find(m => m.role === 'user' && m.id); if (last) { e.preventDefault(); startEdit(last.id); } }
    });
    // (some phone keyboards send no Enter key, only the new line it would write: that is the send key too)
    input.addEventListener('beforeinput', e => {
      if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && touch() && !W.voice.dictating) { e.preventDefault(); setTimeout(() => submit({}), 0); }
    });
    input.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f.map(x => (x.name && x.name !== 'image.png' ? x : new File([x], `pasted-${Date.now()}.${(x.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: x.type })))); } });
    // files dropped anywhere on the chat
    const main = $('.cw-main');
    let depth = 0;
    main.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; $('.cw-drop').classList.remove('hidden'); } });
    main.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('.cw-drop').classList.add('hidden'); } });
    main.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    main.addEventListener('drop', e => { e.preventDefault(); depth = 0; $('.cw-drop').classList.add('hidden'); addFiles([...(e.dataTransfer?.files || [])]); });
    // the thread: copy, edit, write again, suggestions, retries, opening an image
    $('.cw-thread').addEventListener('click', onThreadClick);
    // (a provider view's own controls in the conversation: its typing and its keys)
    $('.cw-thread').addEventListener('input', e => { if (e.target.closest('[class^="hv-"], [class*=" hv-"]')) view()?.input?.(cctx(), e.target); });
    $('.cw-thread').addEventListener('keydown', e => { if (view()?.key?.(cctx(), e)) e.stopPropagation(); });
    $('.cw-card').addEventListener('click', onCardClick);   // (the task progress card: open, fold, refresh)
    $('.cw-thread').addEventListener('error', mediaFailed, true);   // (a medium that couldn't be fetched: its card)
    const scroll = $('.cw-scroll');
    scroll.addEventListener('scroll', () => { if (!W) return; W.stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80; $('.cw-down').classList.toggle('hidden', W.stick); cardOnScroll(scroll); });   // (a glide may end after it closed)
    $('.cw-down').onclick = () => { W.stick = true; toBottom(true); };
    // the rail: back to any message the person sent
    W.rail = new Rail(scroll, main, { onJump: () => { if (W) W.stick = false; } });
    // the Sidebar: its tools and views, the list
    $('.cw-list').addEventListener('click', onListClick);
    $('.cw-list').addEventListener('auxclick', e => { if (e.button === 1 && e.target.closest('[data-open]')) { e.preventDefault(); onListClick(e); } });
    $('.cw-navs').addEventListener('click', e => {
      const b = e.target.closest('.cw-nav');
      if (!b) return;
      // (its PC: in the side panel beside the chat — a Sidebar over the chat steps aside for it)
      if (b.dataset.pc) { if (W.dock.isOpen() && W.dock.tab() === 'pc') W.dock.toggle(false); else { W.dock.openPc(); if (!W.wide) toggleSide(false); } return; }
      setView(W.view === b.dataset.view ? 'chats' : b.dataset.view);
    });
    $('.cw-back').onclick = () => setView('chats');
    $('.cw-view-act').onclick = () => viewAction();
    let st = null;
    $('.cw-search input').addEventListener('input', e => { clearTimeout(st); W.search = e.target.value.trim(); st = setTimeout(searchNow, 220); if (!W.search) { W.hits = null; paintSide(); } });
    // its shortcuts, also while typing: Ctrl/⌘+K the search, Ctrl/⌘+Shift+O a new chat, Esc a menu (or the window)
    el.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'k') { e.preventDefault(); toggleSide(true); setView('search'); }
      else if (mod && e.shiftKey && k === 'o') { e.preventDefault(); newChat(); }
      else if (e.key === 'Escape' && (W.pop || e.target.closest('.cw-search'))) { e.preventDefault(); e.stopPropagation(); if (W.pop) closePop(); else { e.target.blur(); } }
    });
    W.away = e => { if (W?.pop && !W.pop.contains(e.target) && !e.target.closest('[aria-haspopup]')) closePop(); };
    document.addEventListener('pointerdown', W.away, true);
    // moving and resizing (floating): the header moves it, every edge and corner sizes it
    $('.cw-head').addEventListener('pointerdown', e => { if (W.mode === 'float' && e.button === 0 && !e.target.closest('button, input, select, textarea')) drag(e, 'move'); });
    for (const g of el.querySelectorAll('.cw-grip')) g.addEventListener('pointerdown', e => { if (W.mode === 'float' && e.button === 0) drag(e, g.dataset.grip); });
    // the Sidebar sits beside the chat when there is room, over it (a drawer) when there isn't — at every size
    W.ro = new ResizeObserver(() => { if (!W) return; const wide = $('.chatwin').getBoundingClientRect().width >= WIDE_PX; if (wide !== W.wide) { W.wide = wide; layout(); } else W.dock.layout(); });
    W.ro.observe($('.chatwin'));
    if (o.side) $('.chatwin').classList.add('side-hidden');
    W.min = !!o.min;
    setMode(W.choice, { save: false });
    paintNavCount();
    mgr.front(me);   // (a new window opens on top of the others)
  }
  const $w = s => W.el.querySelector(s);
  function escape() { if (W.voice?.voiceMode) return; if (W.pop) closePop(); else if (W.el.querySelector('.cw-main.side-open')) toggleSide(false); else close(); }

  /** Floating (bottom right, its own size) or full screen, as chosen (`save`: kept for next time on this device); a phone
   *  is always full screen, and goes back to the choice when the screen is wide again. */
  function setMode(choice, { save = true } = {}) {
    W.choice = choice;
    if (save) store.set(MODE_KEY, choice);
    const mode = phone() ? 'max' : choice;
    W.mode = mode;
    // (put away: neither over the world nor floating — the world goes on drawing; ui/main.js covered)
    W.el.classList.toggle('min', W.min);
    W.el.classList.toggle('modal-back', mode === 'max' && !W.min);
    W.el.classList.toggle('floating', mode === 'float' && !W.min);
    W.el.querySelector('.chatwin').setAttribute('aria-modal', mode === 'max' ? 'true' : 'false');
    const b = $w('.cw-max');
    b.innerHTML = icon(mode === 'max' ? 'restore' : 'maximize');
    b.title = mode === 'max' ? 'Back to a window' : 'Full screen'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(mode === 'max'));
    b.classList.toggle('hidden', phone());
    place();
    fit();
    mgr.changed(me);
  }
  /** Put away (to its button by the 💬 one: it goes on working, an answer that comes meanwhile is counted there) or back. */
  function setMin(on) {
    if (!W || W.min === !!on) return;
    W.min = !!on;
    if (on) { closePop(); if (W.el.contains(document.activeElement)) document.activeElement.blur(); }
    else W.unread = 0;
    setMode(W.choice, { save: false });
    if (on) mgr.put(me);
    else { mgr.front(me); if (!touch()) $w('.cw-in').focus(); }
  }
  /** The floating window's place and size. What the person chose (W.geo: its size, and how far it sits from the room's
   *  right and bottom edges — kept with the window) is shown as far as the room allows: a panel opening moves it aside
   *  first and sizes it down only when it must; when the panel closes it goes back. Nothing else ever moves it: no
   *  snapping, no rearranging when another window opens or closes. */
  function place() {
    const box = $w('.chatwin');
    if (W.mode !== 'float') { for (const k of ['left', 'top', 'right', 'bottom', 'width', 'height']) box.style[k] = ''; return; }
    const R = room(), availW = Math.max(200, innerWidth - R.left - R.right), availH = Math.max(200, innerHeight - R.top - R.bottom);
    const g = W.geo || (W.geo = firstGeo(availW, availH));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const w = clamp(Number(g.w) || 460, Math.min(MIN_W, availW), availW), hh = clamp(Number(g.h) || Math.min(680, availH), Math.min(MIN_H, availH), availH);
    const r = clamp(Number.isFinite(g.r) ? g.r : 0, 0, availW - w), b = clamp(Number.isFinite(g.b) ? g.b : 0, 0, availH - hh);
    W.shown = { w, h: hh, r, b };
    Object.assign(box.style, { width: `${w}px`, height: `${hh}px`, right: `${R.right + r}px`, bottom: `${R.bottom + b}px`, left: '', top: '' });
  }
  /** Where a window opens the first time: the only one shown, where the last one was; beside the others, at the last
   *  one's size, when they float there already. */
  function firstGeo(availW, availH) {
    const last = store.get(GEO_KEY, null) || {}, others = mgr.rects(me);
    if (!others.length) return last;
    return spotFor(Number(last.w) || 460, Number(last.h) || Math.min(680, availH), availW, availH, others);
  }
  /** Moving (the header) or sizing (an edge or a corner) the floating window with the pointer: from where it is shown,
   *  the edge held following the pointer and the opposite one staying put, never past the room nor under its least size;
   *  let go, that is the person's choice. */
  function drag(e, how) {
    e.preventDefault();
    const box = $w('.chatwin'), g0 = { ...W.shown }, x0 = e.clientX, y0 = e.clientY, target = e.currentTarget;
    const R = room(), availW = Math.max(200, innerWidth - R.left - R.right), availH = Math.max(200, innerHeight - R.top - R.bottom);
    const minW = Math.min(MIN_W, availW), minH = Math.min(MIN_H, availH), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const left = g0.r + g0.w, top = g0.b + g0.h;   // (its far edges, as distances from the room's right and bottom)
    try { target.setPointerCapture(e.pointerId); } catch { /* fine */ }
    box.classList.add('dragging');
    const moveTo = ev => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (how === 'move') W.geo = { ...g0, r: g0.r - dx, b: g0.b - dy };
      else {
        const g = { ...g0 };
        if (how.includes('e')) { g.r = clamp(g0.r - dx, 0, left - minW); g.w = left - g.r; }
        if (how.includes('w')) g.w = clamp(left - dx, g0.r + minW, availW) - g0.r;
        if (how.includes('s')) { g.b = clamp(g0.b - dy, 0, top - minH); g.h = top - g.b; }
        if (how.includes('n')) g.h = clamp(top - dy, g0.b + minH, availH) - g0.b;
        W.geo = g;
      }
      place();
    };
    const up = () => {
      target.removeEventListener('pointermove', moveTo); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
      box.classList.remove('dragging');
      W.geo = { ...W.shown };
      store.set(GEO_KEY, W.geo);
      mgr.changed(me);
    };
    target.addEventListener('pointermove', moveTo); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  }

  /** The window's height follows the visible part of the screen (a phone's keyboard takes some of it). */
  function fit() {
    const vv = window.visualViewport, box = $w('.chatwin');
    if ((phone() ? 'max' : W.choice) !== W.mode) return setMode(W.choice, { save: false });
    if (phone() && vv) box.style.height = `${Math.round(vv.height - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 56))}px`;
    else if (W.mode === 'max') box.style.height = '';
    else place();
    W.wide = box.getBoundingClientRect().width >= WIDE_PX;
    layout();
    if (W.stick) toBottom();
  }
  function layout() {
    const box = $w('.chatwin');
    box.classList.toggle('wide', !!W.wide);
    if (W.wide) { $w('.cw-main').classList.remove('side-open'); box.classList.remove('drawer'); }
    W.dock?.layout();
  }
  function toggleSide(on) {
    const box = $w('.chatwin');
    if (W.wide) { box.classList.toggle('side-hidden', on === undefined ? !box.classList.contains('side-hidden') : !on); W.dock.layout(); mgr.changed(me); return; }
    $w('.cw-main').classList.toggle('side-open', on === undefined ? !$w('.cw-main').classList.contains('side-open') : on);
    box.classList.toggle('drawer', $w('.cw-main').classList.contains('side-open'));
  }
  /** Find: the camera follows the agent's body in the world (a full-screen chat steps back to a window so the world shows;
   *  on a phone, where it is always full screen, it is put away). */
  function findAgent() {
    const rec = agentRec(W.agentId), i = rec && rec.i >= 0 && S.people[rec.i] ? rec.i : -1;
    if (i < 0) { app.toast?.(`${rec?.name || 'This agent'} has no body in the world right now.`, '', 3500, '🎥'); return; }
    if (W.mode === 'max') { if (phone()) setMin(true); else setMode('float'); }
    app.setMode?.('explore');
    select(i, { force: true, follow: true });
  }

  // ------------------------------------------------------------------------------------------------ the header
  function head() {
    if (!W) return;
    const rec = agentRec(W.agentId), st = rec ? stateOf(rec, S.presence[rec.key]) : null;
    // (it runs with every piece of an answer: only what changed is written)
    const set = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
    set($w('.cw-av'), rec?.emoji || '🤖');
    set($w('.cw-name'), rec?.name || (W.agentId ? 'Agent' : 'Chats'));
    const s = $w('.cw-status');
    set(s, !W.can ? '' : !W.can.ok ? 'can\'t chat' : W.run ? (W.run.text ? 'writing…' : 'thinking…') : st?.live ? st.label : (isExt(rec) ? (st?.label || '') : 'online'));
    s.classList.toggle('live', !!(W.run || st?.live));
    const t = $w('.cw-title'), label = W.session?.label && W.session.label !== 'New chat' && W.session.label !== 'New session' ? W.session.label : '';
    const pj = projOf(W.session ? W.session.projectId : W.newIn);
    const title = pj ? `${pj.name} › ${label || 'New chat'}` : label;
    set(t, title); if (t.title !== title) t.title = title;
    W.placeholder = rec ? `Message ${rec.name}…` : 'Message…';
    paintPlaceholder();
    const body = !!(rec && rec.i >= 0 && S.people[rec.i]);
    const f = $w('.cw-find'); f.disabled = !body; f.title = body ? `Find ${rec.name} in the world` : `${rec?.name || 'It'} has no body in the world`;
    $w('.cw-studio').classList.toggle('hidden', !manages(rec));
    mgr.changed(me);   // (its button by the 💬 one: working, waiting, its name)
  }

  function blocked(can, rec = null) {
    const b = $w('.cw-blocked');
    b.innerHTML = `<div class="cw-blk-card"><div class="cw-blk-av" data-avatar>${esc(rec?.emoji || '💬')}</div><p>${esc(can.message || 'This chat isn\'t available.')}</p>
      ${can.fix === 'brain' ? '<button type="button" class="btn primary" data-fix="brain">Connect a brain</button>' : ''}</div>`;
    b.classList.remove('hidden');
    b.onclick = e => {
      const f = e.target.closest('[data-fix]')?.dataset.fix;
      if (f === 'brain' && rec) { const id = rec.id; close(); app.studio?.open(id, 'brain'); }
    };
    W.messages = []; paintThread(); paintComposer();
  }

  const projOf = id => (id && W?.projects.find(p => p.id === id)) || null;
  /** The Sidebar shows this agent's chats, or one of its tools: Search, Projects (and one project), the Library. */
  function setView(v, { project = null } = {}) {
    if (!W) return;
    W.view = v || 'chats';
    W.projectId = W.view === 'project' ? project : null;
    if (W.view !== 'search') W.hits = null;
    if (W.view === 'project') { W.inProject = null; loadProject(W.projectId); }
    paintSide();
    if (W.view === 'search') { const i = $w('.cw-search input'); i.value = W.search; if (!touch()) setTimeout(() => i.focus(), 0); if (W.search) searchNow(); }
    if (W.view === 'library') loadLibrary();
    if (W.view === 'notify') loadNotes();
    $w('.cw-list').scrollTop = 0;
  }
  async function searchNow() {
    if (!W) return;
    const q = W.search;
    if (!q) { W.hits = null; return paintSide(); }
    try { const r = await getJSON(`/api/chat/search?q=${encodeURIComponent(q)}&agent=${W.agentId}`); if (W && W.search === q && W.view === 'search') { W.hits = r.results || []; paintSide(); } } catch { /* stays */ }
  }
  /** One project's chats (all of them: the agent's list holds only its most recent 200). */
  async function loadProject(id) {
    try {
      const r = await getJSON(`/api/chat/recent?agent=${W.agentId}&project=${id}`);
      if (!W || W.view !== 'project' || W.projectId !== id) return;
      W.inProject = r.sessions || [];
      const k = W.projects.findIndex(p => p.id === id); if (k >= 0 && r.project) W.projects[k] = r.project;
    } catch (e) { if (W && W.projectId === id) { app.toast?.(e.message, 'bad'); W.projects = W.projects.filter(p => p.id !== id); W.view = 'projects'; } }
    if (W) paintSide();
  }
  /** This agent's notifications — what it asked for (approvals), told its owner or answered while they were away — and
   *  how many are unread; the top bar's bell holds every agent's. */
  async function loadNotes() {
    if (!W || !W.agentId || !auth.account) return;
    const id = W.agentId;
    try {
      const r = await getJSON(`/api/notifications?agent=${id}&limit=50`);
      await approvalStatuses(r.notifications || []);
      if (!W || W.agentId !== id) return;
      W.notes = { list: r.notifications || [], unread: r.agentUnread || 0 };
    } catch (e) { if (W && W.agentId === id) W.notes = { list: [], unread: 0, error: e.message }; }
    if (!W) return;
    paintNavCount();
    if (W.view === 'notify') paintSide();
  }
  /** The files and pictures this account has sent (in any chat): to look at again, or to attach to the next message. */
  async function loadLibrary() {
    try { const r = await getJSON('/api/chat/attachments'); if (W) { W.library = { list: r.attachments || [], used: r.used, max: r.quotaBytes ?? null }; if (W.view === 'library') paintSide(); } }
    catch (e) { if (W) { W.library = { list: [], error: e.message }; if (W.view === 'library') paintSide(); } }
  }
  function paintNavCount() {
    if (!W) return;
    const n = W.notes?.unread || 0, b = $w('.cw-nav-n'), name = agentRec(W.agentId)?.name || 'this agent';
    b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !n);
    b.closest('.cw-nav').title = n ? `${name}'s notifications (${n} new)` : `${name}'s notifications`;
  }
  function paintSide() {
    if (!W) return;
    const v = W.view, name = agentRec(W.agentId)?.name || 'this agent', proj = v === 'project' ? projOf(W.projectId) : null;
    if (v === 'project' && !proj) { W.view = 'projects'; return paintSide(); }
    $w('.cw-side').dataset.view = v;
    for (const b of W.el.querySelectorAll('.cw-nav[data-view]')) { const on = b.dataset.view === v || (v === 'project' && b.dataset.view === 'projects'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    $w('.cw-view-head').classList.toggle('hidden', v === 'chats');
    $w('.cw-view-title').textContent = proj ? proj.name : VIEW_TITLES[v] || '';
    const act = $w('.cw-view-act');
    act.classList.toggle('hidden', v !== 'projects' && v !== 'project' && !(v === 'notify' && W.notes?.unread));
    act.textContent = v === 'projects' ? '＋ New project' : v === 'notify' ? 'Mark all read' : '⋯';
    act.title = v === 'projects' ? 'New project' : v === 'notify' ? `Mark all of ${name}'s notifications read` : 'Rename or delete this project'; act.setAttribute('aria-label', act.title);
    act.setAttribute('aria-haspopup', v === 'project' ? 'menu' : 'false');
    $w('.cw-search').classList.toggle('hidden', v !== 'search');
    $w('.cw-search input').placeholder = `Search your chats with ${name}`;
    const L = $w('.cw-list');
    if (v === 'search') {
      L.innerHTML = !W.search ? `<div class="cw-empty">Find any word you or ${esc(name)} wrote in your chats.</div>` : !W.hits ? '<div class="cw-empty">Searching…</div>'
        : W.hits.length ? `<div class="cw-group">${plural(W.hits.length, 'result')}</div>${W.hits.map(r => `<button type="button" class="cw-item hit" data-open="${r.session}" data-msg="${r.id}" role="listitem">
        <span class="cw-item-t" data-noicon>${esc(r.label)}</span><span class="cw-snip" data-noicon>${esc(r.snippet).replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>')}</span></button>`).join('')}` : '<div class="cw-empty">No chat mentions that.</div>';
    } else if (v === 'projects') {
      L.innerHTML = W.projects.length ? W.projects.map(p => `<button type="button" class="cw-item cw-proj-item" data-proj="${p.id}" role="listitem"><span class="cw-proj-ic" aria-hidden="true">📂</span>
        <span class="cw-item-t" data-noicon>${esc(p.name)}</span><span class="cw-item-n">${p.chats ? plural(p.chats, 'chat') : 'empty'}</span></button>`).join('')
        : `<div class="cw-empty">A project keeps the chats about one thing together, with instructions ${esc(name)} follows in each of them — “we're planning the bakery; answer in Spanish”.<br><button type="button" class="btn small primary" data-a="proj-new">＋ New project</button></div>`;
    } else if (v === 'project') {
      const ta = L.querySelector('.cw-proj-in'), kept = ta && Number(ta.dataset.p) === proj.id && ta.value !== proj.instructions ? ta.value : null;
      L.innerHTML = `<div class="cw-proj"><label class="cw-proj-l" for="cw-proj-in-${me.id}">Instructions for every chat in this project</label>
        <textarea id="cw-proj-in-${me.id}" class="cw-proj-in input" data-p="${proj.id}" maxlength="4000" rows="4" placeholder="What should ${esc(name)} know or do in every chat of this project?" data-noicon>${esc(proj.instructions || '')}</textarea>
        <div class="cw-proj-row"><span class="cw-proj-st dim"></span><span class="cw-grow"></span><button type="button" class="btn small primary" data-a="proj-save" disabled>Save</button></div>
        <button type="button" class="btn cw-proj-new" data-a="proj-chat">✎ New chat in this project</button></div>
        ${W.inProject === null ? '<div class="cw-empty">Loading its chats…</div>' : chatsHtml(W.inProject, { chip: false, empty: 'No chats in this project yet. Start one above, or move a chat here from its ⋯ menu.' })}`;
      const t = L.querySelector('.cw-proj-in'), save = L.querySelector('[data-a="proj-save"]');
      if (kept !== null) { t.value = kept; save.disabled = false; }
      t.oninput = () => { save.disabled = t.value.trim() === (projOf(W.projectId)?.instructions || '').trim(); L.querySelector('.cw-proj-st').textContent = ''; };
      t.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!save.disabled) saveProject(); } };
    } else if (v === 'library') {
      const lib = W.library;
      L.innerHTML = !lib ? '<div class="cw-empty">Loading your files…</div>' : lib.error ? `<div class="cw-empty">${esc(lib.error)}</div>`
        : !lib.list.length ? '<div class="cw-empty">The files and pictures you send in your chats are kept here, to open again or to send once more.</div>'
        : `<div class="cw-group">${plural(lib.list.length, 'file')}${lib.used ? ` · ${sizeOf(lib.used)}${lib.max ? ` of ${sizeOf(lib.max)}` : ''}` : ''}</div><div class="cw-lib">${lib.list.map(f => {
          const url = `/api/chat/attachments/file?id=${encodeURIComponent(f.id)}`, img = /^image\/(png|jpeg|gif|webp)$/.test(f.mime);
          return `<div class="cw-lib-item" role="listitem"><a class="cw-lib-open" href="${url}" target="_blank" rel="noopener" title="Open ${esc(f.name)}">${img ? `<img src="${url}" alt="" loading="lazy">` : `<span class="cw-lib-ic" aria-hidden="true">${fileIcon(f.name)}</span>`}</a>
            <span class="cw-lib-t"><span class="cw-lib-n" data-noicon>${esc(f.name)}</span><span class="cw-lib-s">${sizeOf(f.size)} · ${new Date(f.created).toLocaleDateString()}</span></span>
            <span class="cw-lib-b"><button type="button" class="btn small" data-attach="${esc(f.id)}" title="Attach it to your next message">Attach</button>
            <button type="button" class="btn icon small" data-unfile="${esc(f.id)}" title="Delete ${esc(f.name)}" aria-label="Delete ${esc(f.name)}">🗑</button></span></div>`;
        }).join('')}</div>`;
    } else if (v === 'notify') {
      const N = W.notes;
      L.innerHTML = !N ? '<div class="cw-empty">Loading…</div>' : N.error ? `<div class="cw-empty">${esc(N.error)}</div>`
        : !N.list.length ? `<div class="cw-empty">When ${esc(name)} needs your OK, has something to tell you, or answers while you're away, it shows here. Every agent's are under the bell in the top bar.</div>`
        : `<div class="cw-notes" role="list">${noteItems(N.list, { inChat: true })}</div>`;
    } else L.innerHTML = chatsHtml(W.sessions, { chip: true, empty: `Your chats with ${esc(name)} will be listed here.` });
  }
  /** Chats as the Sidebar lists them: pinned on top, then by day; `chip`: each one's project named. */
  function chatsHtml(list, { chip = true, empty = '' } = {}) {
    if (!list.length) return `<div class="cw-empty">${empty}</div>`;
    let html = '', group = null;
    for (const s of list) {
      const g = s.pinned ? 'Pinned' : dayGroup(s.updated);
      if (g !== group) { html += `<div class="cw-group">${esc(g)}</div>`; group = g; }
      const p = chip ? projOf(s.projectId) : null;
      // (a chat the agent is working in now — an answer being written, or its provider running a turn there from anywhere)
      const busy = s.working || (W.session && W.session.id === s.id && !!(W.run || W.obs));
      // (waiting: for the person — an approval, a question; a provider view marks it apart, as its app does)
      const waiting = s.working === 'waiting' || (W.session && W.session.id === s.id && W.run && cctx().blocking());
      const pv = view();
      // (a chat another window shows: marked — opening it brings that window forward)
      const there = !(W.session && W.session.id === s.id) && !!mgr.holder(W.agentId, s.id, me);
      html += `<div class="cw-item${W.session && W.session.id === s.id ? ' on' : ''}${busy ? ' working' : ''}${waiting ? ' waiting' : ''}${there ? ' elsewhere' : ''}" role="listitem"><button type="button" class="cw-item-open" data-open="${s.id}">
        ${busy ? `<span class="cw-item-w" role="img" aria-label="${waiting ? 'Waiting for you' : 'Working'}" title="${waiting ? 'Waiting for you' : 'Working now'}"></span>` : ''}<span class="cw-item-t" data-noicon>${esc(s.label)}</span>${there ? `<span class="cw-item-win" title="Open in another window" aria-label="Open in another window">${icon('windows')}</span>` : ''}${p ? `<span class="cw-item-p" title="In the project ${esc(p.name)}" data-noicon>${esc(p.name)}</span>` : ''}${pv?.since ? `<span class="cw-item-ago">${esc(pv.since(s.updated))}</span>` : ''}</button>
        <button type="button" class="cw-item-more" data-more="${s.id}" title="Rename, pin, move, export or delete" aria-label="More for this chat" aria-haspopup="menu">⋯</button></div>`;
    }
    return html;
  }
  const sessionOf = id => W.sessions.find(x => x.id === id) || W.inProject?.find(x => x.id === id) || null;
  async function onListClick(e) {
    if (e.target.closest('.cw-notes')) {
      const did = await noteClick(e, { beforeOpen: () => { if (W && !W.wide) toggleSide(false); } });
      if (did === 'approval' || did === 'read') loadNotes();
      return;
    }
    const m = e.target.closest('[data-more]');
    if (m) { const s = sessionOf(Number(m.dataset.more)); if (s) chatMenu(m, s); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'proj-new') return openNewProject();
    if (a === 'proj-save') return saveProject();
    if (a === 'proj-chat') return newChat({ project: W.projectId });
    const pj = e.target.closest('[data-proj]');
    if (pj) return setView('project', { project: Number(pj.dataset.proj) });
    const at = e.target.closest('[data-attach]');
    if (at) return attachFromLibrary(at.dataset.attach);
    const un = e.target.closest('[data-unfile]');
    if (un) return deleteFile(un.dataset.unfile);
    const o = e.target.closest('[data-open]');
    if (!o) return;
    const sid = Number(o.dataset.open), msg = o.dataset.msg ? Number(o.dataset.msg) : null;
    // (Ctrl/⌘ or the middle button: in a window of its own, beside this one)
    if ((e.ctrlKey || e.metaKey || e.button === 1) && !msg && W.session?.id !== sid) { mgr.open(W.agentId, { session: sid, newWindow: true }); return; }
    if (!W.wide) toggleSide(false);
    if (!sessionOf(sid)) await loadList();
    if (!W) return;
    await pick(W.agentId, sid);
    if (msg && W) { const el = W.el.querySelector(`.cw-msg[data-id="${msg}"]`); if (el) { W.stick = false; el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
  }
  async function refreshList() {
    if (!W) return;
    const tok = W.token;
    await loadList(tok);
    if (!W || tok !== W.token) return;
    if (W.session) W.session = sessionOf(W.session.id) || W.session;
    if (W.view === 'project') loadProject(W.projectId); else paintSide();
    head();
  }
  /** A new chat with this agent (in `project`, when started from it). */
  function newChat({ project = null } = {}) {
    if (!W || !W.agentId) return;
    W.session = null; W.messages = []; W.newIn = project; W.pending.mode = null; abandonRun();
    W.obs = null; W.plan = null; W.usage = null; W.prov = null; stopWatching();
    head(); paintSide(); paintThread(); paintComposer();
    if (!W.wide) toggleSide(false);
    if (!touch()) $w('.cw-in').focus();
  }
  function attachFromLibrary(id) {
    const f = W.library?.list.find(x => String(x.id) === String(id));
    if (!f || !W.can?.ok) return;
    if (!W.can.caps?.attachments) return app.toast?.(`${agentRec(W.agentId)?.name || 'This agent'} can't read files.`, 'bad');
    if (W.files.some(x => x.id === f.id)) return;
    if (W.files.length >= MAX_FILES) return app.toast?.(`At most ${MAX_FILES} files in one message.`, 'bad');
    W.files.push({ id: f.id, name: f.name, mime: f.mime, size: f.size, status: 'ok', progress: 1, preview: null, kept: true });
    paintFiles(); paintSend();
    if (!W.wide) toggleSide(false);
    if (!touch()) $w('.cw-in').focus();
  }

  async function deleteFile(id) {
    const f = W.library?.list.find(x => String(x.id) === String(id));
    if (!f || !confirm(`Delete “${f.name}”? It is gone from the chats it was sent in too.`)) return;
    try {
      const r = await post('/api/chat/attachments/delete', { id: f.id });
      if (!W?.library) return;
      W.library.list = W.library.list.filter(x => x.id !== f.id); W.library.used = r.used;
      W.files = W.files.filter(x => x.id !== f.id); paintFiles(); paintSend();
      if (W.view === 'library') paintSide();
    } catch (e) { app.toast?.(e.message, 'bad'); }
  }

  // ------------------------------------------------------------------------------------------------ projects
  async function newProject() {
    const name = prompt('Name the project', '');
    if (name === null || !name.trim()) return null;
    try {
      const r = await post('/api/chat/projects/create', { agent: W.agentId, name: name.trim() });
      W.projects.unshift(r.project);
      return r.project;
    } catch (e) { app.toast?.(e.message, 'bad'); return null; }
  }
  /** A new project, then opened (to write its instructions). */
  async function openNewProject() { const p = await newProject(); if (p && W) setView('project', { project: p.id }); }
  async function viewAction() {
    if (W.view === 'projects') return openNewProject();
    if (W.view === 'notify') {
      // (the server tells the account's pages the new count: the bell follows, and this list with it)
      try { await post('/api/notifications/read', { agent: W.agentId }); } catch (e) { app.toast?.(e.message, 'bad'); }
      return loadNotes();
    }
    const p = projOf(W.projectId);
    if (!p) return;
    popup($w('.cw-view-act'), [
      { label: 'Rename the project', run: async () => {
        const name = prompt('Name the project', p.name);
        if (name === null || !name.trim()) return;
        try { const r = await post('/api/chat/projects/update', { agent: W.agentId, project: p.id, name: name.trim() }); Object.assign(p, r.project); paintSide(); } catch (e) { app.toast?.(e.message, 'bad'); }
      } },
      { label: 'Delete the project', sub: 'Its chats stay, outside any project', danger: true, run: async () => {
        if (!confirm(`Delete the project “${p.name}”? Its chats are kept; only the project and its instructions go.`)) return;
        try { await post('/api/chat/projects/delete', { agent: W.agentId, project: p.id }); W.projects = W.projects.filter(x => x.id !== p.id); setView('projects'); await refreshList(); } catch (e) { app.toast?.(e.message, 'bad'); }
      } },
    ]);
  }
  async function saveProject() {
    const p = projOf(W.projectId), t = W.el.querySelector('.cw-proj-in');
    if (!p || !t) return;
    const b = W.el.querySelector('[data-a="proj-save"]'); b.disabled = true;
    try {
      const r = await post('/api/chat/projects/update', { agent: W.agentId, project: p.id, instructions: t.value.trim() });
      Object.assign(p, r.project);
      if (W?.view === 'project') { t.value = p.instructions; const st = W.el.querySelector('.cw-proj-st'); if (st) st.textContent = 'Saved'; }
    } catch (e) { b.disabled = false; app.toast?.(e.message, 'bad'); }
  }
  async function moveTo(s, projectId) {
    try {
      const r = await post('/api/chat-sessions/move', { agent: s.agentId, session: s.id, project: projectId });
      if (W?.session?.id === s.id) W.session = r.session;
      const p = projOf(projectId);
      app.toast?.(p ? `Moved to ${p.name}.` : 'Taken out of its project.', '', 2500, '📂');
      await refreshList();
    } catch (e) { app.toast?.(e.message, 'bad'); }
  }
  function moveMenu(anchor, s) {
    const items = W.projects.map(p => ({ label: p.name, on: s.projectId === p.id, run: () => moveTo(s, p.id) }));
    if (items.length) items.push({ sep: true });
    if (s.projectId) items.push({ label: 'No project', sub: 'Take it out of its project', run: () => moveTo(s, null) });
    items.push({ label: '＋ New project…', run: async () => { const p = await newProject(); if (p) moveTo(s, p.id); } });
    popup(anchor, items, { cls: 'cw-pop-move' });
  }

  // ------------------------------------------------------------------------------------------------ menus
  function closePop() { if (W?.pop) { W.pop.remove(); W.pop = null; } }
  /** A small menu under (or above) `anchor`: items [{ label, sub, on, run, danger }] or HTML with its own handler. */
  function popup(anchor, items, { cls = '', html = null, wire = null } = {}) {
    closePop();
    const p = W.pop = W.el.querySelector('.chatwin').appendChild(h(`<div class="cw-pop ${cls}" role="menu"></div>`));
    if (html !== null) { p.innerHTML = html; wire?.(p); }
    else {
      p.innerHTML = items.map((it, k) => (it.sep ? '<div class="cw-sep"></div>' : `<button type="button" class="cw-pi${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}" data-k="${k}" role="menuitem" ${it.disabled ? 'disabled' : ''}>
        <span class="cw-pi-l" data-noicon>${esc(it.label)}</span>${it.sub ? `<span class="cw-pi-s">${esc(it.sub)}</span>` : ''}${it.on ? '<span class="cw-pi-ok" aria-hidden="true">✓</span>' : ''}</button>`)).join('');
      p.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const it = items[Number(b.dataset.k)]; if (it.keep) { it.run?.(b); return; } closePop(); it.run?.(); };
    }
    // placed by its anchor, inside the window, above when there is no room below
    const box = W.el.querySelector('.chatwin').getBoundingClientRect(), r = anchor.getBoundingClientRect();
    p.style.left = `${Math.max(8, Math.min(r.left - box.left, box.width - p.offsetWidth - 8))}px`;
    const below = box.bottom - r.bottom, above = r.top - box.top;
    if (below >= p.offsetHeight + 12 || below >= above) { p.style.top = `${r.bottom - box.top + 6}px`; p.style.maxHeight = `${below - 16}px`; }
    else { p.style.bottom = `${box.bottom - r.top + 6}px`; p.style.maxHeight = `${above - 16}px`; }
    return p;
  }
  /** The agents to chat with: one picked shows here (one another window already shows: that window comes forward); the
   *  ⧉ beside each opens it in a window of its own (Ctrl/⌘ or the middle button on its row too). */
  function agentMenu(anchor) {
    const list = chattable();
    if (!list.length) return;
    const more = mgr.canOpen();
    // (an agent of an agent provider says which: OpenClaw · its connection's name)
    const html = list.map((a, k) => {
      const there = a.id !== W.agentId ? mgr.showing(a.id, me) : null, on = a.id === W.agentId;
      const sub = [there ? 'Open in another window' : '', a.provider ? `${a.provider.label} · ${a.provider.connection}` : '', a.mine ? 'yours' : a.level === 'manage' ? 'shared to manage' : 'shared with you'].filter(Boolean).join(' · ');
      return `<div class="cw-pi-row" role="none"><button type="button" class="cw-pi${on ? ' on' : ''}" data-k="${k}" role="menuitem"><span class="cw-pi-l" data-noicon>${esc(`${a.emoji || '🤖'}  ${a.name}`)}</span><span class="cw-pi-s">${esc(sub)}</span>${on ? '<span class="cw-pi-ok" aria-hidden="true">✓</span>' : ''}</button>
        <button type="button" class="cw-pi-new" data-new="${k}" title="${more ? `Open ${esc(a.name)} in a new window` : 'Four chat windows are open: close one first'}" aria-label="Open ${esc(a.name)} in a new window"${more ? '' : ' disabled'}>${icon('newwin')}</button></div>`;
    }).join('');
    popup(anchor, null, { cls: 'cw-pop-agents', html, wire: p => {
      const go = (e, neww) => {
        const b = e.target.closest('[data-k], [data-new]');
        if (!b || b.disabled) return;
        const a = list[Number(b.dataset.k ?? b.dataset.new)];
        closePop();
        if (neww || b.dataset.new !== undefined) { mgr.open(a.id, { newWindow: true }); return; }
        const there = mgr.showing(a.id, me);
        if (there && a.id !== W.agentId) mgr.front(there, { reveal: true });
        else if (a.id !== W.agentId) pick(a.id, null, { latest: true });
      };
      p.onclick = e => go(e, e.ctrlKey || e.metaKey);
      p.onauxclick = e => { if (e.button === 1) { e.preventDefault(); go(e, true); } };
    } });
  }
  function chatMenu(anchor, s) {
    // (a provider's own chat actions — Hermes: Branch, Copy ID, Archive, as its Desktop's chat menu — beside the window's)
    const caps = W.can?.caps || {}, provider = s.key && s.key !== '@new';
    const own = view() && provider ? [
      ...(caps.branch ? [{ label: 'Branch', sub: 'The whole chat, in a new one', run: () => branchChat(s) }] : []),
      { label: 'Copy ID', sub: 'The provider\'s own id for this chat', run: () => copyText(s.key).then(ok => ok && app.toast?.('Copied')) },
    ] : [];
    popup(anchor, [
      { label: 'Rename', run: () => rename(s) },
      { label: s.pinned ? 'Unpin' : 'Pin to the top', run: () => prefs(s, { pinned: !s.pinned }).then(refreshList).catch(e => app.toast?.(e.message, 'bad')) },
      ...own,
      { label: 'Move to a project', sub: projOf(s.projectId)?.name || '', keep: true, run: () => moveMenu(anchor, s) },
      ...(W.session?.id !== s.id && !mgr.holder(s.agentId || W.agentId, s.id, me) ? [{ label: 'Open in a new window', sub: mgr.canOpen() ? 'Beside this one' : 'Four chat windows are open: close one first', disabled: !mgr.canOpen(), run: () => mgr.open(s.agentId || W.agentId, { session: s.id, newWindow: true }) }] : []),
      { label: 'Export as Markdown', sub: 'Download this chat as a text file', run: () => exportChat(s) },
      { sep: true },
      ...(view() && provider && caps.archive ? [{ label: 'Archive', sub: 'Kept by the provider, out of the list', run: () => archiveChat(s) }] : []),
      { label: 'Delete', danger: true, run: () => remove(s) },
    ]);
  }
  /** The chat windows open (its header's button, with two or more): each to go to; Side by side, put the others away,
   *  close them. */
  function winsMenu(anchor) {
    const list = mgr.list();
    const items = list.map(({ win, st }) => ({ label: `${st.emoji}  ${st.name}`, on: win === me, run: () => { if (win !== me) mgr.front(win, { reveal: true }); },
      sub: [win === me ? 'This window' : st.min ? 'Put away' : '', st.title, st.waiting ? 'waiting for you' : st.working ? 'working' : '', st.unread ? `${st.unread} new` : ''].filter(Boolean).join(' · ') }));
    items.push({ sep: true });
    if (!phone()) items.push({ label: 'Side by side', sub: 'Every open window across the screen', disabled: list.length < 2, run: () => mgr.tile() });
    items.push({ label: 'Put the others away', sub: 'They keep working, each by the 💬 button', disabled: !list.some(x => x.win !== me && !x.st.min), run: () => mgr.putOthers(me) });
    items.push({ label: 'Close the others', danger: true, disabled: list.length < 2, run: () => mgr.closeOthers(me) });
    popup(anchor, items, { cls: 'cw-pop-wins' });
  }
  /** The whole chat copied into a new one (a provider's branch), opened. */
  async function branchChat(s) {
    try { const r = await post('/api/providers/branch', { agent: s.agentId || W.agentId, session: s.id }); await refreshList(); if (W && r.session) pick(W.agentId, r.session.id); }
    catch (e) { app.toast?.(e.message || 'Branch failed', 'bad'); }
  }
  /** A chat archived on its provider; it leaves the list here (the open one: a new chat instead). */
  async function archiveChat(s) {
    try {
      await post('/api/providers/archive', { agent: s.agentId || W.agentId, session: s.id });
      if (W?.session?.id === s.id) newChat();
      await refreshList();
      app.toast?.('Archived');
    } catch (e) { app.toast?.(e.message || 'Could not archive it', 'bad'); }
  }
  async function rename(s) {
    const label = prompt('Name this chat', s.label);
    if (label === null || !label.trim()) return;
    try { await post('/api/chat-sessions/rename', { agent: s.agentId, session: s.id, label: label.trim() }); await refreshList(); } catch (e) { app.toast?.(e.message, 'bad'); }
  }
  async function remove(s) {
    if (!confirm(`Delete “${s.label}”? Its messages are gone for good.`)) return;
    try {
      await post('/api/chat-sessions/delete', { agent: s.agentId, session: s.id });
      if (W.session?.id === s.id) { W.session = null; W.messages = []; paintThread(); }
      await refreshList(); head();
    } catch (e) { app.toast?.(e.message, 'bad'); }
  }
  /** The chat as Markdown: who said what, when, and the files sent — downloaded to this device. */
  async function exportChat(s) {
    let msgs = W.session?.id === s.id ? W.messages : null;
    if (!msgs) { try { msgs = (await getJSON(`/api/providers/history?agent=${s.agentId}&session=${s.id}`)).messages || []; } catch (e) { return app.toast?.(e.message, 'bad'); } }
    const rec = agentRec(s.agentId), me = auth.account?.displayName || 'You', when = t => (t ? new Date(t).toLocaleString() : '');
    const out = [`# ${s.label}`, '', `A chat with ${rec?.name || 'an agent'} · exported ${new Date().toLocaleString()}`, ''];
    for (const m of msgs) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      out.push(`## ${m.role === 'user' ? me : rec?.name || 'Agent'}${m.ts ? ` — ${when(m.ts)}` : ''}`, '');
      if (m.text) out.push(m.text, '');
      for (const f of m.meta?.attachments || []) out.push(`- Attached: ${f.name}`);
      if (m.meta?.attachments?.length) out.push('');
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${String(s.label || 'chat').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'chat'}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function prefs(s, p) { return post('/api/chat-sessions/prefs', { agent: s.agentId, session: s.id, ...p }).then(r => { if (W?.session?.id === s.id) W.session = r.session; return r; }); }

  function curModel() { return W.session ? W.session.model : W.pending.model; }
  function curEffort() { return W.session ? W.session.effort : W.pending.effort; }
  /** Work or Life (CHAT.md §13): the chat's own, else the agent's default; null when this chat has neither. */
  function curMode() { return W?.can?.modes ? ((W.session ? W.session.mode : W.pending.mode) || W.can.modes.default) : null; }
  async function setChatMode(m) {
    if (!W || !W.can?.modes || curMode() === m) return;
    if (W.run) return app.toast?.('Let it finish answering, or stop it, before switching', 'bad');
    if (!W.session) { W.pending.mode = m; paintComposer(); if (!W.messages.length) paintThread(); return; }
    try {
      const r = await prefs(W.session, { mode: m });
      if (r.line && W?.session?.id === r.session.id) { W.messages.push(r.line); paintThread(); }
    } catch (e) { app.toast?.(e.message, 'bad'); }
    paintComposer();
    if (W && !W.messages.length) paintThread();
  }
  async function setPref(k, v) {
    if (W.session) { try { await prefs(W.session, { [k]: v }); } catch (e) { return app.toast?.(e.message, 'bad'); } }
    else W.pending[k] = v;
    paintComposer();
  }
  /** The / menu: while the message is a slash command being typed, the agent's commands that start so (a provider's —
   *  OpenClaw's /help, /status, /skill…), each with what it does; picking one writes it. */
  async function cmdMenu() {
    const pv = view();
    if (pv?.completions) return pvMenu(pv);
    const i = $w('.cw-in'), v = i.value, open = W.pop?.classList.contains('cw-pop-cmds');
    if (!W.can?.caps?.commands || !/^\/[\w:.-]*$/.test(v)) { if (open) closePop(); return; }
    if (!W.commands) {
      W.commands = [];
      try { W.commands = (await getJSON(`/api/providers/commands?agent=${W.agentId}${W.session ? `&session=${W.session.id}` : ''}`)).commands || []; } catch { /* none to offer */ }
      if (!W || i.value !== v) return;
    }
    const q = v.slice(1).toLowerCase();
    const list = W.commands.filter(c => c.name.toLowerCase().startsWith(q) || c.alias.slice(1).toLowerCase().startsWith(q)).slice(0, 14);
    if (!list.length) { if (open) closePop(); return; }
    W.cmdAt = 0;
    const p = popup($w('.cw-box'), list.map(c => ({ label: c.alias, sub: c.description + (c.args.length ? ` · ${c.args.map(a => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')}` : ''),
      run: () => { i.value = c.alias + (c.args.length ? ' ' : ''); grow(); paintSend(); i.focus(); } })), { cls: 'cw-pop-cmds' });
    p.querySelector('[data-k]')?.classList.add('hl');
  }
  /** A provider view's own suggestions as the composer is typed into (Hermes: its / commands and @references, as its Desktop
   *  suggests them), in groups; picking one writes it in place of what it completes — and suggests on from there when it
   *  is only the start of one (@file: → the files). Enter on one that is already written in full sends it. */
  let pvSeq = 0;
  async function pvMenu(pv) {
    const i = $w('.cw-in'), v = i.value, caret = i.selectionStart ?? v.length, open = W.pop?.classList.contains('cw-pop-cmds'), n = ++pvSeq, w = W;
    let res = null;
    try { res = await pv.completions(cctx(), v, caret); } catch { res = null; }
    if (!W || W !== w || n !== pvSeq || i.value !== v) return;
    const groups = (res?.groups || []).filter(g => g.items.length);
    if (!groups.length) { if (open) closePop(); return; }
    const flat = groups.flatMap(g => g.items);
    let k = 0;
    const html = groups.map(g => `${g.label ? `<div class="cw-pop-h">${esc(g.label)}</div>` : ''}${g.items.map(it => `<button type="button" class="cw-pi pv-ci" data-k="${k++}" data-ins="${esc(v.slice(0, res.from) + it.insert + v.slice(res.to))}" role="menuitem"><span class="pv-ci-ic" aria-hidden="true">${it.icon || ''}</span><span class="pv-ci-l" data-noicon>${esc(it.label)}</span>${it.sub ? `<span class="pv-ci-s" data-noicon>${esc(it.sub)}</span>` : ''}</button>`).join('')}`).join('');
    W.cmdAt = 0;
    const choose = it => {
      const nv = v.slice(0, res.from) + it.insert + v.slice(res.to);
      closePop();
      // (written in full already: Enter sends it)
      if (nv.trim() === v.trim()) { pv.submit ? pv.submit(cctx(), {}) : send(); return; }
      i.value = nv; const c = res.from + it.insert.length; i.setSelectionRange(c, c); grow(); paintSend(); i.focus();
      if (it.again) cmdMenu();
    };
    const p = popup($w('.cw-box'), null, { cls: 'cw-pop-cmds pv-pop', html, wire: el => { el.onclick = e => { const b = e.target.closest('[data-k]'); if (b) choose(flat[Number(b.dataset.k)]); }; } });
    p.querySelector('[data-k]')?.classList.add('hl');
  }
  function modelMenu(anchor) {
    const m = W.models;
    if (!m || !m.models?.length) return popup(anchor, [{ label: m ? 'No other models here' : 'Loading the models…', disabled: true }]);
    const cur = curModel() || m.default, price = x => (x.priceIn !== undefined ? `$${x.priceIn} / $${x.priceOut} per M tokens` : '');
    const row = x => `<button type="button" class="cw-pi${x.id === cur ? ' on' : ''}" data-model="${esc(x.id)}" role="option">
      <span class="cw-pi-l">${esc(x.label || x.id)}${x.id === m.default ? ' <em>default</em>' : ''}</span>
      <span class="cw-pi-s">${[x.images ? '👁 images' : '', x.files ? '📄 files' : '', price(x), x.context ? `${kTok(x.context)} context` : ''].filter(Boolean).join(' · ')}</span>${x.id === cur ? '<span class="cw-pi-ok">✓</span>' : ''}</button>`;
    const paint = (p, q) => {
      const t = q.toLowerCase(), list = m.models.filter(x => !t || x.id.toLowerCase().includes(t) || String(x.label || '').toLowerCase().includes(t));
      list.sort((a, b) => (b.id === m.default) - (a.id === m.default) || (b.id === cur) - (a.id === cur));
      p.querySelector('.cw-mlist').innerHTML = list.slice(0, 150).map(row).join('') || '<div class="cw-empty">No model by that name</div>';
    };
    popup(anchor, null, { cls: 'cw-pop-models', html: `${m.models.length > 8 ? '<input type="search" class="cw-msearch input" placeholder="Search models" aria-label="Search models">' : ''}<div class="cw-mlist" role="listbox"></div>
      ${m.offered ? '<div class="cw-pop-note">The models this server offers. Their use counts toward your plan at their price.</div>' : ''}`,
    wire: p => {
      paint(p, '');
      const s = p.querySelector('.cw-msearch'); if (s) { s.oninput = () => paint(p, s.value); if (!touch()) setTimeout(() => s.focus(), 0); }
      p.onclick = e => { const b = e.target.closest('[data-model]'); if (!b) return; closePop(); setPref('model', b.dataset.model === m.default ? null : b.dataset.model); };
    } });
  }
  /** The thinking levels to choose from: the chosen model's own where the provider names them (Agent Providers), else the
   *  world's (off, low, medium, high). */
  function efforts() {
    const mid = curModel() || W?.prov?.model || W?.models?.default;
    const mm = W?.models?.models?.find(x => x.id === mid);
    if (!mm || !Array.isArray(mm.effort) || !mm.effort.length) return EFFORT;
    return [['', 'Default', mm.effortDefault ? `The model's own: ${mm.effortDefault}` : 'The model\'s own'], ...mm.effort.map(x => [x.id, cap1(x.label || x.id), x.id === 'off' ? 'Answers at once' : ''])];
  }
  function effortMenu(anchor) {
    const cur = curEffort() || '';
    popup(anchor, efforts().map(([v, l, s]) => ({ label: l, sub: s, on: v === cur, run: () => setPref('effort', v || null) })), { cls: 'cw-pop-effort' });
  }
  function paintCtx(caps) {
    const b = $w('.cw-ctx'), u = W.usage, pct = pctOf(u);
    b.classList.toggle('hidden', !caps.context || pct === null);
    if (pct === null) return;
    b.querySelector('.cw-tool-lb').textContent = `${pct}%`;
    b.querySelector('.cw-ring-v').style.strokeDasharray = `${(50.27 * pct / 100).toFixed(2)} 50.27`;
    b.classList.toggle('warn', pct >= 75); b.classList.toggle('bad', pct >= 92);
    b.title = `Context: ${kTok(u.used)} of ${kTok(u.size)} tokens (${pct}%)`;
  }
  function ctxInfo(anchor) {
    const u = W.usage, pct = pctOf(u);
    if (pct === null) return;
    popup(anchor, [{ label: `${u.used.toLocaleString()} of ${u.size.toLocaleString()} tokens`, sub: `${pct}% of this model's context window is used by the conversation`, disabled: true },
      ...(pct >= 75 ? [{ label: 'Nearly full', sub: 'The agent compacts older messages when it fills up; a new chat starts empty', disabled: true }] : [])], { cls: 'cw-pop-ctx' });
  }

  // ------------------------------------------------------------------------------------------------ the thread
  function paintThread() {
    if (!W) return;
    const T = $w('.cw-thread'), rec = agentRec(W.agentId);
    paintCard();
    if (!W.can?.ok || (!W.messages.length && !W.run)) W.rail.set([]);
    if (!W.can?.ok) { T.innerHTML = ''; return; }
    if (!W.messages.length && !W.run && !W.obs) {
      T.innerHTML = `<div class="cw-hello"><div class="cw-hello-av" data-avatar>${esc(rec?.emoji || '🤖')}</div>
        <h2>How can I help${auth.account?.displayName ? `, ${esc(auth.account.displayName.split(' ')[0])}` : ''}?</h2>
        <p class="dim">${esc(rec?.name || 'Your agent')} ${rec?.provider ? `works through ${esc(rec.provider.label)}: its steps, the tools it uses and what it asks you show here as it works.` : curMode() === 'work' ? 'is at work for you: it knows its job, what you told it and the real date and time, and reads the files you attach.' : 'reads what you write and the files you attach, and can do things for you in the city.'}</p>
        <div class="cw-sugg">${(rec?.provider ? SUGGEST_PROVIDER : SUGGEST_MODE[curMode()] || SUGGEST).map(s => `<button type="button" class="cw-sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
      return;
    }
    const lastA = [...W.messages].reverse().find(m => m.role === 'assistant');
    W.folds = new Map();   // (the folded steps of the messages drawn now: their cards are drawn when opened)
    T.innerHTML = W.messages.map(m => msgHtml(m, rec, m === lastA && !W.run)).join('') + (W.run || W.obs ? runHtml(rec) : '');
    const live = T.querySelector('.cw-msg.live');
    if (live) updateLive(live, W.run || W.obs);
    tabShot();
    toBottom();
    const mine = W.messages.filter(m => m.role === 'user');
    W.rail.set([...T.querySelectorAll('.cw-msg.user')].map((el, k) => ({ el, text: mine[k]?.text || (mine[k]?.meta?.attachments || []).map(f => f.name).join(', ') })));
  }
  /** What an answer carries (Agent Providers: the images, video, audio an agent attached): pictures, players, files. Each
   *  comes from this server at an address it signed (/api/providers/media); one it couldn't get becomes a card (mediaFailed). */
  function mediaHtml(list) {
    if (!list?.length) return '';
    return `<div class="cw-media">${list.map(m => {
      const src = esc(m.src || ''), name = esc(m.name || 'attachment');
      const size = Number.isFinite(m.size) && m.size > 0 ? ` · ${fileSize(m.size)}` : '', dl = label => `<a class="cw-ic" href="${src}" download="${name}" title="${label}" aria-label="${label}">⤓</a>`;
      // (as OpenClaw's Control UI: a picture opens large; download it, or copy it where the browser allows)
      if (m.kind === 'image') return `<span class="cw-mimgw"><a class="cw-mimg" href="${src}" target="_blank" rel="noopener" title="${name}" data-name="${name}"><img src="${src}" alt="${name}" loading="lazy" decoding="async"${m.w > 0 && m.h > 0 ? ` width="${Math.round(m.w)}" height="${Math.round(m.h)}"` : ''}></a>
        <span class="cw-mimg-acts">${dl('Download image')}${canCopyImage() ? `<button type="button" class="cw-ic" data-a="img-copy" data-src="${src}" title="Copy image" aria-label="Copy image">⧉</button>` : ''}</span></span>`;
      if (m.kind === 'video') return `<figure class="cw-mvid" data-name="${name}"><video src="${src}" controls preload="metadata" playsinline></video><figcaption>🎥 ${name}${size} ${dl(`Download ${name}`)}</figcaption></figure>`;
      if (m.kind === 'audio') return `<figure class="cw-maud" data-name="${name}"><audio src="${src}" controls preload="none"></audio><figcaption>🎧 ${name}${size} ${dl(`Download ${name}`)}</figcaption></figure>`;
      return `<a class="cw-fchip" href="${src}" target="_blank" rel="noopener"><span aria-hidden="true">${fileIcon(m.name)}</span><span>${name}</span></a>`;
    }).join('')}</div>`;
  }
  /** A medium the provider wouldn't send (a file its session may not show, too large, gone): its name on a card instead. */
  function mediaFailed(e) {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.matches('.cw-media img, .cw-media video, .cw-media audio')) return;
    const box = el.closest('.cw-mimg, .cw-mvid, .cw-maud');
    if (!box || box.classList.contains('cw-mfail')) return;
    const icon = box.classList.contains('cw-mimg') ? '🖼' : box.classList.contains('cw-mvid') ? '🎥' : '🎧';
    box.replaceWith(h(`<span class="cw-mfail" title="The agent platform did not send this file: open it there">${icon} ${esc(box.dataset.name || 'attachment')} <small>couldn't be shown here</small></span>`));
  }
  /** A picture of an answer, large, over the chat: ← → through that answer's pictures, Esc (or a click outside) to close. */
  /**
   * The browser tabs an answer's steps left (the agent opened or went to a page), as OpenClaw's Control UI shows them: a card
   * for each tab — the latest step's — with its title and address; Open shows it in the side panel's Browser tab, Copy URL,
   * Open in new tab. The chat's latest card shows the page itself (tabShot).
   */
  function tabCardsHtml(steps) {
    const tabs = new Map();
    for (const st of steps || []) if (st && st.tab && st.done !== false && st.ok !== false) { tabs.delete(st.tab.targetId); tabs.set(st.tab.targetId, st.tab); }
    if (!tabs.size) return '';
    const can = !!(W.can?.manage && W.can?.caps?.browser);
    return `<div class="cw-btabs">${[...tabs.values()].map(t => {
      let host = t.url; try { host = new URL(t.url).host || t.url; } catch { /* as given */ }
      const title = t.title || host || 'Browser';
      return `<div class="cw-btab" data-btab-card="${esc(t.targetId)}" data-url="${esc(t.url)}">
        ${can ? `<button type="button" class="cw-btab-shot" data-a="btab-open" title="Open in the side panel" hidden><img alt=""></button>` : ''}
        <div class="cw-btab-bar"><span class="cw-btab-ic" aria-hidden="true">${icon('globe')}</span><span class="cw-btab-id"><b data-noicon>${esc(title)}</b><span data-noicon>${esc(t.url)}</span></span>
          ${can ? '<button type="button" class="btn small" data-a="btab-open" title="Open in the side panel">Open</button>' : ''}
          <button type="button" class="cw-ic" data-a="btab-copy" title="Copy URL" aria-label="Copy URL">⧉</button>
          <a class="cw-ic" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" title="Open in new tab" aria-label="Open in new tab">${icon('external')}</a></div></div>`;
    }).join('')}</div>`;
  }
  /** The page of the chat's latest browser card, as it is now (one picture of the agents' browser, for whoever may see it);
   *  kept per tab while the chat is open, taken again when a step changes that tab. */
  async function tabShot() {
    if (!W || !W.can?.manage || !W.can?.caps?.browser) return;
    const cards = W.el.querySelectorAll('.cw-thread .cw-btab'), card = cards[cards.length - 1];
    if (!card) return;
    const id = card.dataset.btabCard, w = W;
    let src = W.tabShots.get(id);
    if (src === undefined) {
      W.tabShots.set(id, null);   // (asked for: once)
      try {
        const r = await fetch(`/api/providers/browser/frame?agent=${W.agentId}&tab=${encodeURIComponent(id)}&after=0`, { credentials: 'same-origin', cache: 'no-store' });
        if (W !== w) return;
        if (r.status === 200) { src = URL.createObjectURL(await r.blob()); W.tabShots.set(id, src); }
      } catch { /* no picture: the card says the rest */ }
    }
    if (!src || W !== w) return;
    for (const c of W.el.querySelectorAll(`.cw-thread .cw-btab[data-btab-card="${CSS.escape(id)}"]`)) {
      const b = c.querySelector('.cw-btab-shot');
      if (!b) continue;
      b.hidden = c !== card;
      if (c === card && b.querySelector('img').getAttribute('src') !== src) b.querySelector('img').src = src;
    }
  }
  function viewImage(a) {
    const all = [...a.closest('.cw-media').querySelectorAll('.cw-mimg')];
    let k = Math.max(0, all.indexOf(a));
    // (as OpenClaw's viewer: the picture fitted, or zoomed — − and +, Ctrl+wheel, + − 0 keys; the % fits it again; download, copy)
    const v = h(`<div class="cw-viewer" role="dialog" aria-modal="true" aria-label="Image" tabindex="-1">
      <div class="cw-vstage"><img alt="" draggable="false"></div><div class="cw-vbar"><span class="cw-vname"></span>
      <button type="button" class="cw-ic" data-v="prev" aria-label="Previous image">‹</button><button type="button" class="cw-ic" data-v="next" aria-label="Next image">›</button>
      <span class="cw-vzoom"><button type="button" class="cw-ic" data-v="out" title="Zoom out" aria-label="Zoom out">−</button><button type="button" class="cw-vz" data-v="fit" title="Fit to the window">100%</button><button type="button" class="cw-ic" data-v="in" title="Zoom in" aria-label="Zoom in">+</button></span>
      <a class="cw-ic" data-v="dl" download title="Download image" aria-label="Download image">⤓</a>${canCopyImage() ? '<button type="button" class="cw-ic" data-v="copy" title="Copy image" aria-label="Copy image">⧉</button>' : ''}
      <a class="cw-ic" data-v="open" target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab">↗</a><button type="button" class="cw-ic" data-v="close" aria-label="Close">✕</button></div></div>`);
    const img = v.querySelector('img'), stage = v.querySelector('.cw-vstage');
    let z = null;   // (null: fitted to the window; a number: the picture's own size times it)
    const eff = () => z ?? (img.naturalWidth ? img.getBoundingClientRect().width / img.naturalWidth : 1);
    const zoomed = () => {
      stage.classList.toggle('zoomed', z !== null);
      img.style.width = z === null ? '' : `${Math.round(img.naturalWidth * z)}px`;
      v.querySelector('.cw-vz').textContent = `${Math.round(eff() * 100)}%`;
    };
    const zoom = f => { if (!img.naturalWidth) return; z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, eff() * f)); zoomed(); };
    img.addEventListener('load', zoomed);
    const show = () => {
      const x = all[k];
      z = null;
      img.src = x.href; img.alt = x.dataset.name || '';
      v.querySelector('.cw-vname').textContent = `${x.dataset.name || ''}${all.length > 1 ? ` · ${k + 1} of ${all.length}` : ''}`;
      v.querySelector('[data-v="open"]').href = x.href;
      const dl = v.querySelector('[data-v="dl"]'); dl.href = x.href; dl.setAttribute('download', x.dataset.name || 'image');
      for (const d of ['prev', 'next']) v.querySelector(`[data-v="${d}"]`).classList.toggle('hidden', all.length < 2);
      zoomed();
    };
    const main = $w('.cw-main');
    const close = () => { v.remove(); main.classList.remove('viewing'); a.focus(); };
    const step = d => { k = (k + d + all.length) % all.length; show(); };
    v.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-v]'), what = b?.dataset.v;
      if (what === 'prev') step(-1); else if (what === 'next') step(1);
      else if (what === 'in') zoom(ZOOM_STEP); else if (what === 'out') zoom(1 / ZOOM_STEP); else if (what === 'fit') { z = null; zoomed(); }
      else if (what === 'copy') { try { await copyImage(img.src); b.textContent = '✓'; setTimeout(() => { b.textContent = '⧉'; }, 1200); } catch { app.toast?.('Could not copy the image', 'bad'); } }
      else if (what === 'close' || ev.target === v || ev.target === stage) close();
    });
    stage.addEventListener('wheel', ev => { if (!ev.ctrlKey) return; ev.preventDefault(); zoom(ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP); }, { passive: false });
    v.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); close(); } else if (ev.key === 'ArrowLeft') step(-1); else if (ev.key === 'ArrowRight') step(1);
      else if (ev.key === '+' || ev.key === '=') zoom(ZOOM_STEP); else if (ev.key === '-') zoom(1 / ZOOM_STEP); else if (ev.key === '0') { z = null; zoomed(); }
    });
    main.classList.add('viewing');   // (the thread hidden behind it: a playing video draws over anything in some browsers)
    main.appendChild(v);
    show(); v.focus();
  }
  function msgHtml(m, rec, last) {
    const pv = view();
    if (m.role === 'user' && pv?.userHtml) return pv.userHtml(m, { editing: W.editing === m.id, busy: !!W.run });
    if (m.role === 'system' && m.meta?.note && pv?.noteHtml) return pv.noteHtml(m);
    if (m.role === 'user') {
      if (W.editing === m.id) return `<div class="cw-msg user editing" data-id="${m.id}"><textarea class="cw-edit-in input" aria-label="Edit your message">${esc(m.text)}</textarea>
        <div class="cw-edit-acts"><button type="button" class="btn" data-a="edit-cancel">Cancel</button><button type="button" class="btn primary" data-a="edit-send">Send</button></div></div>`;
      return `<div class="cw-msg user"${m.id ? ` data-id="${m.id}"` : ''}>${filesHtml(m.meta?.attachments)}${m.text ? `<div class="cw-bubble" data-noicon>${esc(m.text)}</div>` : ''}
        <div class="cw-mact">${m.id && !W.run && rewrites() ? '<button type="button" class="cw-ic" data-a="edit" title="Edit and send again" aria-label="Edit">✎</button>' : ''}<button type="button" class="cw-ic" data-a="copy" title="Copy" aria-label="Copy">⧉</button></div></div>`;
    }
    // a switch between Work and Life (CHAT.md §13): a divider across the thread
    if (m.role === 'system' && m.status === 'mode') {
      const work = (m.meta?.mode || (/Work/.test(m.text) ? 'work' : 'life')) === 'work';
      return `<div class="cw-msg sys cw-modeline ${work ? 'work' : 'life'}"${m.id ? ` data-id="${m.id}"` : ''}><span><span aria-hidden="true">${work ? '💼' : '🏠'}</span> ${esc(m.text)}</span></div>`;
    }
    if (m.role === 'system') {
      const fail = m.status === 'failed' || m.status === 'error' || m.status === 'uncertain';
      return `<div class="cw-msg sys${fail ? ' bad' : ''}"${m.id ? ` data-id="${m.id}"` : ''}><span>${esc(m.text)}</span>${fail && last !== false && !W.run && rewrites() ? ' <button type="button" class="btn small" data-a="retry">Try again</button>' : ''}</div>`;
    }
    const v = view();
    if (v) {
      // (the provider's own drawing of the turn; the window's own copy, read aloud, media and what it took around it)
      return `<div class="cw-msg assistant pv${m.status === 'stopped' ? ' stopped' : ''}"${m.id ? ` data-id="${m.id}"` : ''}><div class="cw-mbody">${v.answerHtml(m, { last: last === true, sid: W.session?.id ?? null })}${mediaHtml(m.meta?.media)}${apprHtml(m.meta?.approvals)}
        ${v.actionsHtml ? v.actionsHtml(m, { last, busy: !!W.run, read: m.id && m.text ? readBtn(m.id) : '', meta: metaLine(m.meta), caps: W.can?.caps || {} }) : `<div class="cw-mact"><button type="button" class="cw-ic" data-a="copy" title="Copy" aria-label="Copy">⧉</button>${m.id && m.text ? readBtn(m.id) : ''}${metaLine(m.meta)}</div>`}</div></div>`;
    }
    const r = render(m.text);
    return `<div class="cw-msg assistant${m.status === 'stopped' ? ' stopped' : ''}"${m.id ? ` data-id="${m.id}"` : ''}><div class="cw-mav" data-avatar>${esc(rec?.emoji || '🤖')}</div><div class="cw-mbody">
      ${m.meta?.thinking ? `<details class="cw-think"><summary>Thought${Number.isFinite(m.meta.ms) ? ` for ${secs(m.meta.ms)}` : ''}</summary><div class="cw-think-t" data-noicon>${esc(m.meta.thinking)}</div></details>` : ''}
      ${m.meta?.steps?.length ? stepsHtml(m.meta.steps.map(s => ({ ...s, ...(W.stepSeen.get(String(s.id)) || {}), done: true })), false) : ''}${tabCardsHtml(m.meta?.steps)}<div class="cw-md" data-noicon>${r.html}</div>${mediaHtml(m.meta?.media)}${apprHtml(m.meta?.approvals)}${m.status === 'stopped' ? '<div class="cw-stopped">Stopped</div>' : ''}
      <div class="cw-mact"><button type="button" class="cw-ic" data-a="copy" title="Copy" aria-label="Copy">⧉</button>${m.id && m.text ? readBtn(m.id) : ''}${last && rewrites() ? '<button type="button" class="cw-ic" data-a="regen" title="Write it again" aria-label="Write it again">↻</button>' : ''}${metaLine(m.meta)}</div></div></div>`;
  }
  function readBtn(id) {
    const on = W.voice?.readingId === id;
    return `<button type="button" class="cw-ic${on ? ' on' : ''}" data-a="speak" title="${on ? 'Stop reading' : 'Read aloud'}" aria-label="${on ? 'Stop reading' : 'Read aloud'}">${on ? '⏹' : '🔊'}</button>`;
  }
  function runHtml(rec, R = W.run || W.obs) {
    const via = R.observed ? '<div class="cw-via">From another of its channels</div>' : '';
    if (view()) return `<div class="cw-msg assistant live pv${R.observed ? ' observed' : ''}"><div class="cw-mbody">${via}<div data-part="flow" class="hv-flow"></div><div data-part="appr"></div><div data-part="qs"></div><div data-part="foot"></div></div></div>`;
    return `<div class="cw-msg assistant live${R.observed ? ' observed' : ''}"><div class="cw-mav" data-avatar>${esc(rec?.emoji || '🤖')}</div><div class="cw-mbody">${via}`
      + '<div data-part="think"></div><div data-part="steps"></div><div data-part="tabs"></div><div data-part="body"></div><div data-part="appr"></div><div data-part="qs"></div></div></div>';
  }
  /** Brings the live answer up to date with the run, touching only what changed. */
  function updateLive(live, R) {
    const v = view();
    if (v) {
      v.updateFlow(live.querySelector('[data-part="flow"]'), R);
      if (setPart(live, 'foot', v.footHtml(R))) v.tick(live, R, waitingOn(R));
      // (what waits for the person, as the provider's own app draws it)
      const pn = v.panels ? v.panels(R, cctx()) : { appr: apprHtml(R.approvals), qs: (R.questions || []).map(questionHtml).join('') };
      setPart(live, 'appr', pn.appr);
      setPart(live, 'qs', pn.qs);
      return;
    }
    const steps = R.tools.slice(R.cutTools || 0), text = R.text.slice(R.cut || 0), thinking = R.thinking.slice(R.cutThinking || 0);
    // the reasoning: drawn once, then only its words
    const tp = live.querySelector('[data-part="think"]');
    if (thinking && !tp.firstChild) tp.innerHTML = '<details class="cw-think live"><summary><span class="cw-think-l">Thinking…</span></summary><div class="cw-think-t" data-noicon></div></details>';
    if (!thinking && tp.firstChild) tp.innerHTML = '';
    const tt = tp.querySelector('.cw-think-t');
    if (tt && tt._t !== thinking) { tt._t = thinking; tt.textContent = thinking; }
    updateSteps(live.querySelector('[data-part="steps"]'), R, steps);
    if (setPart(live, 'tabs', tabCardsHtml(steps))) tabShot();
    // the text: rendered whole, put in from its first changed paragraph on; or, before any, what it is doing
    const body = live.querySelector('[data-part="body"]');
    const working = steps.some(t => !t.done) || R.questions?.some(q => q.status === 'pending');
    if (text.trim()) {
      if (body._t !== text) {
        body._t = text;
        let md = body.querySelector('.cw-md');
        if (!md) { body.innerHTML = '<div class="cw-md" data-noicon></div><span class="cw-caret" aria-hidden="true"></span>'; body._h = null; md = body.firstChild; }
        const tpl = document.createElement('template');
        tpl.innerHTML = render(text).html;
        const fresh = [...tpl.content.childNodes], old = [...md.childNodes];
        let k = 0;
        while (k < old.length && k < fresh.length && old[k].isEqualNode(fresh[k])) k++;
        for (const n of old.slice(k)) n.remove();
        md.append(...fresh.slice(k));
      }
    } else {
      body._t = null;
      // (its clock is written by tickWait: this is drawn again only when what it is doing changes)
      setPart(live, 'body', working ? '' : `<div class="cw-wait"><span class="cw-dots" aria-hidden="true"><i></i><i></i><i></i></span><span> ${esc(R.phase || 'Thinking')}</span></div>`);
      tickWait();
    }
    const appr = apprHtml(R.approvals);
    setPart(live, 'appr', appr ? `<div class="cw-apprs">${appr}</div>` : '');
    setPart(live, 'qs', (R.questions || []).map(questionHtml).join(''));
  }
  /** The live steps: the last few as cards (each drawn again only when it changed), the finished ones before them folded. */
  function updateSteps(box, R, steps) {
    const cards = steps.some(t => t.title || t.kind);
    if (!cards) {   // (the world's own tools: small chips, as they were)
      const html = steps.length ? `<div class="cw-steps">${steps.map(t => `<span class="cw-step${t.done ? (t.ok ? ' ok' : ' bad') : ''}">${t.done ? (t.ok ? '✓' : '✗') : '…'} ${esc(TOOL_WORDS[t.name] || t.name)}</span>`).join('')}</div>` : '';
      if (box._h !== html) { box._h = html; box.innerHTML = html; }
      return;
    }
    if (box._h !== 'cards') { box._h = 'cards'; box.innerHTML = '<div class="cw-tsteps"></div>'; }
    const list = box.firstChild;
    // a finished step before the last RECENT_STEPS folds (never past one still running)
    let fold = 0;
    while (fold < steps.length - RECENT_STEPS && steps[fold].done) fold++;
    R.foldN = fold;
    let row = list.querySelector(':scope > .cw-tfold');
    if (fold && !row) { list.insertAdjacentHTML('afterbegin', foldHtml(steps.slice(0, fold), 'live')); row = list.firstChild; row._n = fold; }
    if (row && row._n !== fold) {
      row._n = fold;
      const bad = steps.slice(0, fold).filter(t => t.ok === false).length;
      row.querySelector('.cw-tt').textContent = `${fold} step${fold === 1 ? '' : 's'}`;
      let b = row.querySelector('.cw-tfold-bad');
      if (bad && !b) { row.querySelector('summary').insertAdjacentHTML('beforeend', '<span class="cw-tfold-bad"></span>'); b = row.querySelector('.cw-tfold-bad'); }
      if (b) b.textContent = bad ? `${bad} failed` : '';
      if (row.open) fillFold(row);
    }
    // the cards after it: one per step, in order, each replaced only when what it shows changed
    const want = steps.slice(fold), have = new Map([...list.querySelectorAll(':scope > .cw-tstep')].map(el => [el.dataset.tool, el]));
    let prev = row || null;
    for (const t of want) {
      const html = stepHtml(t, true), id = String(t.id);
      let el = have.get(id);
      if (el && el._h !== html) { const n = h(html); n._h = html; settleToggle(n); el.replaceWith(n); el = n; }
      if (!el) { el = h(html); el._h = html; settleToggle(el); }
      have.delete(id);
      if ((prev ? prev.nextElementSibling : list.firstElementChild) !== el) { if (prev) prev.after(el); else list.prepend(el); }
      prev = el;
    }
    for (const el of have.values()) el.remove();   // (folded now)
  }
  /** A card drawn open fires a toggle as it appears: not the person's choice (W.steps keeps only theirs). */
  function settleToggle(el) { if (el.open) { el.dataset.painting = '1'; setTimeout(() => { delete el.dataset.painting; }, 0); } }
  function cardState() {
    const key = W.session ? W.session.id : 'new';
    let c = W.cards.get(key);
    if (!c) { c = { manual: undefined, auto: undefined, reopens: 0, run: null, ended: null, refresh: null }; W.cards.set(key, c); }
    return c;
  }
  function paintCard() {
    if (!W) return;
    // (a provider view keeps its plan in its own status stack, as its app does)
    if (view()) { $w('.cw-card').classList.add('hidden'); paintQueue(); return; }
    const el = $w('.cw-card'), R = W.run || W.obs, p = W.plan;   // (the run's updates and the provider's own both land in W.plan)
    const steps = p?.steps || [], has = !!(steps.length || p?.markdown);
    el.classList.toggle('hidden', !has);
    if (!has) { el._h = ''; return; }
    const c = cardState(), done = steps.filter(x => x.status === 'completed').length, complete = steps.length > 0 && done === steps.length;
    // a turn starting opens it (wide screens); one ending opens it again unless the person is reading back
    if (R && R.id !== c.run) { c.run = R.id; if (c.manual === undefined) c.auto = !narrow(); }
    if (!R && c.run && c.ended !== c.run) { c.ended = c.run; if (c.manual === undefined && !W.cardReading) c.auto = !narrow() || c.auto; }
    const rf = c.refresh, live = !!R;
    if (rf && rf.state === 'pending' && rf.accepted && Number.isInteger(p.revision) && p.revision > rf.baseline) { clearTimeout(rf.timer); rf.state = 'updated'; rf.fade = setTimeout(() => { if (c.refresh === rf) { c.refresh = null; paintCard(); } }, 5000); }
    // (as OpenClaw counts: the step under way — else the next, else the last done — as "2 of 3"; when, as "Updated 5m ago")
    const cur = steps.find(x => x.status === 'in_progress') || steps.find(x => x.status === 'pending') || steps.findLast(x => x.status === 'completed');
    const pos = Math.max(1, steps.indexOf(cur) + 1), at = Math.max(p.updatedAt || 0, p.at || 0), when = at ? `Updated ${updatedAgo(at)}` : '';
    const now = cardNow(p, steps, complete), marker = complete ? 'done' : steps.some(x => x.status === 'in_progress') ? (live ? 'now' : 'paused') : 'todo';
    const mark = st => (st === 'done' ? icon('check') : st === 'now' ? '<span class="cw-ps-spin"></span>' : icon('clock'));   // (OpenClaw's: done, under way, paused or to do)
    const busy = rf?.state === 'pending', retry = rf && /failed|timeout/.test(rf.state);
    const html = `<div class="cw-card-h"><button type="button" class="cw-card-tg" data-a="card"><span class="cw-card-mk ${marker}" aria-hidden="true">${mark(marker)}</span>
        <span class="cw-card-now" data-noicon>${esc(now)}</span>${steps.length ? `<span class="cw-card-n">${pos}/${steps.length}</span>` : ''}
        <b class="cw-card-t">Task progress</b><span class="cw-card-sub">${[when, steps.length ? `${pos} of ${steps.length}` : 'Progress note'].filter(Boolean).join(' · ')}</span></button>
        ${W.planCan.dismiss && complete && Number.isInteger(p.revision) ? `<button type="button" class="cw-ic cw-card-x" data-a="card-dismiss" title="Dismiss progress card" aria-label="Dismiss progress card">${icon('x')}</button>` : ''}
        ${W.planCan.refresh ? `<button type="button" class="cw-ic cw-card-rf${busy ? ' busy' : ''}${rf?.state === 'updated' ? ' ok' : ''}" data-a="card-refresh" ${busy ? 'disabled aria-busy="true"' : ''} title="${busy ? REFRESH_SAYS.pending : retry ? 'Retry progress refresh' : 'Refresh task progress'}" aria-label="${busy ? REFRESH_SAYS.pending : retry ? 'Retry progress refresh' : 'Refresh task progress'}">${icon(rf?.state === 'updated' ? 'check' : 'rotate')}</button>` : ''}
        <button type="button" class="cw-ic cw-card-chev" data-a="card" aria-label="Task progress: show or hide">${icon('chevdown')}</button></div>
      ${rf ? `<div class="cw-card-st ${rf.state}" role="status"${rf.error ? ` title="${esc(rf.error)}"` : ''}>${REFRESH_SAYS[rf.state]}</div>` : ''}
      <div class="cw-card-b"><div class="cw-card-in"><div class="cw-card-sc" role="region" aria-label="${steps.length ? `${done} of ${steps.length} steps done` : 'Progress note'}">
        ${p.markdown ? `<div class="cw-md cw-plan-md" data-noicon>${render(p.markdown).html}</div>` : ''}
        ${steps.length ? `<ol class="cw-plan-steps">${steps.map(x => { const st = x.status === 'completed' ? 'done' : x.status === 'in_progress' ? (live ? 'now' : 'paused') : 'todo'; return `<li class="${st}"><span class="cw-ps-ic" aria-hidden="true">${mark(st)}</span><span data-noicon>${esc(x.step)}</span></li>`; }).join('')}</ol>` : ''}</div></div></div>`;
    if (el._h !== html) { el._h = html; el.innerHTML = html; }
    const open = c.manual ?? c.auto ?? (!complete && !narrow());
    el.classList.toggle('open', open); el.classList.toggle('complete', complete);
    for (const b of el.querySelectorAll('[data-a="card"]')) b.setAttribute('aria-expanded', String(open));
  }
  /** The conversation scrolled: far enough back from the end (the person reading), an open card folds out of the way. */
  function cardOnScroll(scroll) {
    if (!W) return;
    const back = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    const reading = back > CARD_READING_PX;
    if (reading === !!W.cardReading) return;
    W.cardReading = reading;
    if (!reading || !W.plan) return;
    const c = cardState(), el = $w('.cw-card');
    if (!el.classList.contains('open') || c.manual === false || c.reopens >= 2) return;
    c.manual = undefined; c.auto = false;
    paintCard();
  }
  async function onCardClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b || !W) return;
    const c = cardState(), w = W, sess = W.session;
    if (b.dataset.a === 'card') {
      const open = !$w('.cw-card').classList.contains('open');
      c.manual = open; if (open && W.cardReading) c.reopens += 1;
      paintCard();
    } else if (b.dataset.a === 'card-refresh' && sess && c.refresh?.state !== 'pending') {
      // (a retry after no answer is the same request — the gateway answers it once; after a failure, a new one)
      const was = c.refresh, key = was && was.state === 'timeout' ? was.key : requestKey();
      clearTimeout(was?.timer); clearTimeout(was?.fade);
      const rf = c.refresh = { state: 'pending', key, baseline: was && was.state === 'timeout' ? was.baseline : (W.plan?.revision || 0), accepted: false };
      rf.timer = setTimeout(() => { if (c.refresh === rf && rf.state === 'pending') { rf.state = 'timeout'; if (W === w) paintCard(); } }, CARD_REFRESH_MS);
      paintCard();
      try {
        const r = await post('/api/providers/progress/refresh', { agent: W.agentId, session: sess.id, key });
        if (c.refresh !== rf) return;
        rf.accepted = !!r.accepted; rf.baseline = Math.max(rf.baseline, Number.isInteger(r.revision) ? r.revision : 0);
      } catch (err) { if (c.refresh !== rf) return; clearTimeout(rf.timer); rf.state = 'failed'; rf.error = err.message; }
      if (W === w) paintCard();
    } else if (b.dataset.a === 'card-dismiss' && sess && Number.isInteger(W.plan?.revision)) {
      b.disabled = true;
      try {
        const r = await post('/api/providers/progress/dismiss', { agent: W.agentId, session: sess.id, revision: W.plan.revision });
        if (W !== w || W.session !== sess) return;
        W.plan = r.dismissed ? null : r.plan || W.plan;
        if (!r.dismissed) app.toast?.('The agent updated its task progress meanwhile: here it is', '', 4000);
        W.cards.delete(sess.id);
        paintCard();
      } catch (err) { app.toast?.(`Could not dismiss the progress card: ${err.message}`, 'bad'); b.disabled = false; }
    }
  }
  /** What the agent asks (a provider's questions): each with its options (one, or several), a free answer where it takes
   *  one, a secret's field; Send answer and Skip — or, once answered, what was answered. */
  function questionHtml(q) {
    const pending = q.status === 'pending';
    const html = `<div class="cw-q-head"><span aria-hidden="true">❓</span> <b>${pending ? `${esc(agentRec(W.agentId)?.name || 'It')} asks you` : 'It asked you'}</b></div>
      ${q.questions.map(x => `<div class="cw-q" data-q="${esc(x.questionId)}" data-multi="${x.multiSelect ? 1 : 0}">${x.header ? `<span class="cw-q-h" data-noicon>${esc(x.header)}</span>` : ''}<p data-noicon>${esc(x.question)}</p>
        ${pending ? `${x.options.length ? `<div class="cw-q-opts" role="${x.multiSelect ? 'group' : 'radiogroup'}">${x.options.map(o => `<button type="button" class="cw-q-o" data-a="q-opt" aria-pressed="false" data-label="${esc(o.label)}"${o.description ? ` title="${esc(o.description)}"` : ''}><span data-noicon>${esc(o.label)}</span>${o.description ? `<small data-noicon>${esc(o.description)}</small>` : ''}</button>`).join('')}</div>` : ''}
          ${x.secret ? '<input type="password" class="input cw-q-text" autocomplete="off" placeholder="Your answer (kept secret)">' : x.other || !x.options.length ? `<input type="text" class="input cw-q-text" maxlength="2000" placeholder="${x.options.length ? 'Or write your own answer' : 'Your answer'}">` : ''}`
        : `<div class="cw-q-ans" data-noicon>${esc(q.status === 'answered' ? (q.answers?.[x.questionId] || []).join(', ') || 'Answered' : q.status === 'cancelled' ? 'Skipped' : 'No answer')}</div>`}</div>`).join('')}
      ${pending ? '<div class="cw-q-acts"><button type="button" class="btn small primary" data-a="q-send">Send answer</button><button type="button" class="btn small" data-a="q-skip">Skip</button></div>' : ''}`;
    return `<div class="cw-qs ${pending ? 'pending' : 'done'}" data-key="q:${esc(q.id)}" data-sig="${esc(sigOf(html))}" data-qid="${esc(q.id)}">${html}</div>`;
  }
  async function sendAnswers(card, cancel = false) {
    // (this chat's own run, or one another of its channels runs here: whichever asked)
    const R = [W?.run, W?.obs].find(x => x && (x.questions || []).some(q => q.id === card.dataset.qid));
    if (!R) return;
    const got = cancel ? {} : answersOf(card);
    if (got.missing) { app.toast?.(`Answer: ${got.missing}`, 'bad'); return; }
    card.querySelectorAll('button, input').forEach(x => { x.disabled = true; });
    try {
      await post('/api/providers/questions', { run: R.id, question: card.dataset.qid, ...(cancel ? { cancel: true } : { answers: got.answers }) });
      const q = R.questions.find(x => x.id === card.dataset.qid);
      if (q) { q.status = cancel ? 'cancelled' : 'answered'; if (!cancel) q.answers = got.answers; }
    } catch (e) { app.toast?.(e.message, 'bad'); card.querySelectorAll('button, input').forEach(x => { x.disabled = false; }); }
    if (W?.run || W?.obs) paintRun();
  }
  /** Whether this chat's messages can be edited and written again (a provider that keeps the history itself: no). */
  const rewrites = () => W?.can?.caps?.rewrite !== false;
  /** A run's steps as cards: what each is (its kind's icon, its title), how it stands, its input (the command), its output
   *  — open while it runs, closed once it is done, unless the person opened or closed it. */
  function stepsHtml(list, live) {
    // (finished steps before the last few fold into one row — drawn only when opened: a long turn stays light)
    const fold = !live && list.length > RECENT_STEPS + 1 ? list.length - RECENT_STEPS : 0;
    return `<div class="cw-tsteps">${fold ? foldHtml(list.slice(0, fold)) : ''}${list.slice(fold).map(t => stepHtml(t, live)).join('')}</div>`;
  }
  /** One step as a card: its kind's icon, its title, how it stands, its input and output. */
  function stepHtml(t, live) {
    const st = !t.done ? 'run' : t.ok === false ? 'bad' : 'ok';
    const foot = [Number.isFinite(t.exitCode) ? `exit ${t.exitCode}` : '', Number.isFinite(t.ms) ? secs(t.ms) : ''].filter(Boolean).join(' · ');
    const chosen = W.steps.get(String(t.id)), open = chosen !== undefined ? chosen : live && !t.done;
    const input = t.input && t.input !== (t.title || t.name) ? `<div class="cw-tin"><code data-noicon>${esc(String(t.input).slice(0, 2000))}</code></div>` : '';
    const out = t.output ? `<pre class="cw-tout" data-noicon>${esc(tailOf(t.output))}</pre>` : '';
    // (a finished step is drawn the same from then on: data-sig lets a repaint keep it — and its open or closed state)
    return `<details class="cw-tstep ${st}" data-tool="${esc(String(t.id))}"${t.done ? ` data-key="step:${esc(String(t.id))}" data-sig="${esc(sigOf(`${st}|${foot}|${t.output || ''}|${t.title}`))}"` : ''}${open ? ' open' : ''}><summary><span class="cw-tic" aria-hidden="true">${KIND_ICON[t.kind] || KIND_ICON.other}</span>
        <span class="cw-tt" data-noicon>${esc(t.title || TOOL_WORDS[t.name] || t.name)}</span><span class="cw-tst" aria-label="${st === 'run' ? 'Running' : st === 'ok' ? 'Done' : 'Failed'}">${st === 'run' ? '<i class="cw-spin"></i>' : st === 'ok' ? '✓' : '✗'}</span>${foot ? `<span class="cw-tfoot">${esc(foot)}</span>` : ''}</summary>
        ${input}${out}${t.cwd && t.done ? `<div class="cw-tcwd">in ${esc(t.cwd)}</div>` : ''}</details>`;
  }
  /** Finished steps folded into one row ("✓ 57 steps"); their cards are drawn when it is opened (fillFold). */
  function foldHtml(steps, id = String(++foldSeq)) {
    if (id !== 'live') W.folds.set(id, steps);
    const bad = steps.filter(t => t.ok === false).length;
    return `<details class="cw-tfold" data-fold="${id}"><summary><span class="cw-tic" aria-hidden="true">✓</span><span class="cw-tt">${steps.length} step${steps.length === 1 ? '' : 's'}</span>${bad ? `<span class="cw-tfold-bad">${bad} failed</span>` : ''}</summary><div class="cw-tfold-in"></div></details>`;
  }
  function fillFold(d) {
    const R = W.run || W.obs, list = d.dataset.fold === 'live' ? (R ? R.tools.slice(R.cutTools || 0, (R.cutTools || 0) + (R.foldN || 0)) : []) : W.folds.get(d.dataset.fold) || [];
    const inner = d.querySelector('.cw-tfold-in'), from = inner._n || 0;
    if (list.length > from) inner.insertAdjacentHTML('beforeend', list.slice(from).map(t => stepHtml(t, false)).join(''));
    inner._n = Math.max(from, list.length);
  }
  /** An agent's payment waiting for its owner's OK: what it is, Approve and Decline (or how it was answered). */
  function apprHtml(list) {
    if (!list?.length) return '';
    return list.filter(a => !/^econ:/.test(a.id) && a.options).map(provApprHtml).join('') + list.filter(a => /^econ:/.test(a.id)).map(a => {
      const st = W.apprs.get(a.id) || 'pending';
      return `<div class="cw-appr ${st}" data-appr-id="${esc(a.id)}"><span class="cw-appr-ic" aria-hidden="true">✋</span><div class="cw-appr-t"><b data-noicon>${esc(a.summary || 'It wants to spend money')}</b>
        <span class="cw-appr-s">${st === 'pending' ? 'Waiting for your OK — your spending rules ask for it above your limit.' : { approved: 'Approved — done.', declined: 'Declined.', expired: 'Expired: it waited a day.', failed: 'Approved, but it failed.' }[st] || st}</span></div>
        ${st === 'pending' ? '<div class="cw-appr-b"><button type="button" class="btn small primary" data-a="appr-yes">Approve</button><button type="button" class="btn small" data-a="appr-no">Decline</button></div>' : ''}</div>`;
    }).join('');
  }
  /** A step of a provider's run waiting for the person (Agent Providers): what it would do — the command and where — and
   *  the answers it takes, or how it was answered. */
  function provApprHtml(a) {
    const st = W.apprs.get(a.id) || 'pending';
    const word = st === 'pending' ? 'Waiting for your answer.' : st === 'deny' ? 'Denied.' : st === 'allow-always' ? 'Allowed, from now on.' : st === 'allow-session' ? 'Allowed in this chat.' : st === 'allow-once' ? 'Allowed once.' : st === 'cancelled' ? 'Withdrawn.' : st;
    return `<div class="cw-appr prov ${st === 'pending' ? 'pending' : st === 'deny' ? 'declined' : 'approved'}" data-appr-id="${esc(a.id)}"><span class="cw-appr-ic" aria-hidden="true">✋</span>
      <div class="cw-appr-t"><b data-noicon>${esc(a.title || 'It asks for your OK')}</b>${a.command ? `<code class="cw-appr-cmd" data-noicon>${esc(a.command)}</code>` : ''}
        ${a.cwd ? `<span class="cw-appr-s" data-noicon>in ${esc(a.cwd)}</span>` : ''}${a.summary ? `<span class="cw-appr-s" data-noicon>${esc(a.summary)}</span>` : ''}<span class="cw-appr-s">${esc(word)}</span></div>
      ${st === 'pending' ? `<div class="cw-appr-b">${a.options.map(o => `<button type="button" class="btn small${o === 'allow-once' ? ' primary' : o === 'deny' ? ' danger' : ''}" data-a="appr-dec" data-dec="${esc(o)}">${esc(DECIDE[o] || o)}</button>`).join('')}</div>` : ''}</div>`;
  }
  async function answerProvAppr(id, decision, b) {
    const R = W?.run;
    if (!R) return;
    // (the window's card, or a provider view's own: whatever holds the approval's id)
    const card = b.closest('[data-appr-id]');
    card?.querySelectorAll('button').forEach(x => { x.disabled = true; });
    try { await post('/api/providers/approvals', { run: R.id, approval: id, decision }); W.apprs.set(id, decision); }
    catch (e) { app.toast?.(e.message, 'bad'); card?.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
    if (W?.run) paintRun(); else paintThread();
  }
  async function answerAppr(id, yes, b) {
    b.closest('.cw-appr')?.querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      const r = await post('/api/economy/approval/answer', { id: id.slice(5), approve: yes });
      W.apprs.set(id, r.approval?.status || (yes ? 'approved' : 'declined'));
      if (r.approval?.status === 'failed') app.toast?.(`Approved, but it failed: ${r.approval?.result?.error || 'unknown'}`, 'bad');
      post('/api/notifications/read', { approval: id.slice(5) }).catch(() => {});
    } catch (e) { if (/no longer waiting/i.test(e.message)) W.apprs.set(id, 'expired'); app.toast?.(e.message, 'bad'); }
    if (W?.run) paintRun(); else paintThread();
  }
  /** Only the answer being written (cheaper than the whole thread; a frame at most). */
  function paintRun() {
    if (!W || W.painting) return;
    W.painting = true;
    const w = W, wait = Math.max(0, LIVE_MS - (performance.now() - (W.paintedAt || 0)));
    setTimeout(() => requestAnimationFrame(() => {
      if (W !== w) return;
      W.painting = false; W.paintedAt = performance.now();
      const R = W.run || W.obs, live = $w('.cw-thread').querySelector('.cw-msg.live');
      if (!R) return;
      if (!live) { paintThread(); return; }
      updateLive(live, R);
      toBottom();
    }), wait);
  }
  function toBottom(smooth = false) {
    if (!W || !W.stick) return;
    const s = $w('.cw-scroll');
    s.scrollTo({ top: s.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch { const ta = document.body.appendChild(h('<textarea style="position:fixed;opacity:0"></textarea>')); ta.value = t; ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
  }
  async function onThreadClick(e) {
    const img = e.target.closest('.cw-mimg');
    if (img && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); viewImage(img); return; }
    const sug = e.target.closest('[data-sug]');
    if (sug) { const i = $w('.cw-in'); i.value = sug.dataset.sug; grow(); paintSend(); i.focus(); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const msg = cp.closest('.cw-msg'), code = cp.closest('.md-code')?.querySelector('code')?.textContent;
      if (code !== undefined && await copyText(code)) { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy'; }, 1400); }
      void msg; return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const card = b.closest('.cw-btab');
    if (card && b.dataset.a === 'btab-open') { W.dock.openTab(card.dataset.btabCard); return; }
    if (b.dataset.a === 'img-copy') { try { await copyImage(b.dataset.src); b.textContent = '✓'; setTimeout(() => { b.textContent = '⧉'; }, 1200); } catch { app.toast?.('Could not copy the image', 'bad'); } return; }
    if (card && b.dataset.a === 'btab-copy') { if (await copyText(card.dataset.url)) { b.textContent = '✓'; setTimeout(() => { b.textContent = '⧉'; }, 1200); } return; }
    if (b.dataset.a.startsWith('hv-')) { view()?.click?.(cctx(), b); return; }
    const el = b.closest('.cw-msg'), id = el?.dataset.id ? Number(el.dataset.id) : null, m = id ? W.messages.find(x => x.id === id) : null;
    switch (b.dataset.a) {
      case 'copy': { const t = m ? m.text : el.querySelector('.cw-bubble, .cw-md')?.innerText || ''; if (await copyText(t)) { b.textContent = '✓'; setTimeout(() => { b.textContent = '⧉'; }, 1200); } break; }
      case 'regen': regenerate(); break;
      case 'speak': if (m) W.voice.readAloud(m); break;
      case 'edit': startEdit(id); break;
      case 'edit-cancel': W.editing = null; paintThread(); break;
      case 'edit-send': { const t = el.querySelector('.cw-edit-in').value.trim(); if (t) sendEdit(id, t); break; }
      case 'retry': regenerate(); break;
      case 'appr-yes': case 'appr-no': answerAppr(b.closest('.cw-appr').dataset.apprId, b.dataset.a === 'appr-yes', b); break;
      case 'appr-dec': answerProvAppr(b.closest('[data-appr-id]').dataset.apprId, b.dataset.dec, b); break;
      case 'q-opt': {
        // (one answer: choosing it chooses it alone — and a card of one such question, with nothing to write, is sent at once)
        const q = b.closest('.cw-q'), card = b.closest('.cw-qs'), on = b.getAttribute('aria-pressed') !== 'true';
        if (q.dataset.multi !== '1') q.querySelectorAll('.cw-q-o').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(on));
        if (on && q.dataset.multi !== '1' && card.querySelectorAll('.cw-q').length === 1 && !q.querySelector('.cw-q-text')) sendAnswers(card);
        break;
      }
      case 'q-send': sendAnswers(b.closest('.cw-qs')); break;
      case 'q-skip': sendAnswers(b.closest('.cw-qs'), true); break;
    }
  }
  function startEdit(id) {
    W.editing = id; paintThread();
    const ta = W.el.querySelector('.cw-edit-in');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.style.height = `${Math.min(300, ta.scrollHeight + 4)}px`;
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !touch()) { e.preventDefault(); const t = ta.value.trim(); if (t) sendEdit(id, t); } if (e.key === 'Escape') { e.stopPropagation(); W.editing = null; paintThread(); } }; }
  }

  // ------------------------------------------------------------------------------------------------ the composer
  function grow() { const i = $w('.cw-in'); i.style.height = 'auto'; i.style.height = `${Math.min(i.scrollHeight, Math.round(innerHeight * 0.38))}px`; }
  /** The composer's prompt: while it works, a provider that takes messages then — Enter sends one now, Ctrl/Cmd+Enter after
   *  this answer. */
  function paintPlaceholder() {
    const look = view()?.sendLook?.(cctx());
    const p = look?.placeholder ? look.placeholder : W.run && W.can?.caps?.queue ? `Send now (Enter) or after this answer (${/Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}+Enter)…`
      : W.run ? 'Write your next message — it is sent when this answer ends…' : (W.placeholder || 'Message…');
    const i = $w('.cw-in');
    if (i.placeholder !== p) i.placeholder = p;
  }
  function paintSend() {
    const b = $w('.cw-send'), busy = !!W.run;
    paintPlaceholder();
    const ready = !!$w('.cw-in').value.trim() || W.files.some(f => f.id);
    const look = view()?.sendLook?.(cctx());
    if (look) {
      // (the provider's own: Send with words — redirecting a running turn —, Stop without; Queue message beside while it works)
      b.classList.toggle('stop', look.stop);
      b.textContent = look.stop ? '⏹' : '↑';
      b.title = look.title; b.setAttribute('aria-label', look.stop ? 'Stop' : 'Send');
      b.disabled = !look.stop && (!ready || W.files.some(f => f.status === 'up') || !W.can?.ok);
      $w('.cw-queue').classList.toggle('hidden', !look.queue);
      return;
    }
    $w('.cw-queue').classList.add('hidden');
    // (while it works: with words written, the button sends them — into this answer for a provider that takes them, else
    // queued until it ends; with nothing written, it stops the answer)
    const stopping = busy && !ready;
    b.classList.toggle('stop', stopping);
    b.textContent = stopping ? '⏹' : '↑';
    b.title = stopping ? 'Stop' : busy ? (W.can?.caps?.queue ? 'Send now (Enter) — or after this answer (Ctrl+Enter)' : 'Queue it: sent when this answer ends (Enter)') : 'Send (Enter)';
    b.setAttribute('aria-label', stopping ? 'Stop' : busy && !W.can?.caps?.queue ? 'Queue message' : 'Send');
    b.disabled = !stopping && (!ready || W.files.some(f => f.status === 'up') || !W.can?.ok);
  }
  function paintComposer() {
    if (!W) return;
    paintQueue();
    const ok = !!W.can?.ok, caps = W.can?.caps || {};
    $w('.cw-foot').classList.toggle('hidden', !ok);
    $w('.cw-attach').classList.toggle('hidden', !caps.attachments);
    const mb = $w('.cw-model');
    mb.classList.toggle('hidden', !caps.models);
    const mid = curModel() || W.prov?.model || W.models?.default || '';
    mb.querySelector('.cw-tool-lb').textContent = mid ? (W.models?.models?.find(x => x.id === mid)?.label || mid).replace(/^[\w-]+\//, '').slice(0, 28) : 'Model';
    const eb = $w('.cw-effort');
    eb.classList.toggle('hidden', !caps.effort);
    const ef = curEffort() || W.prov?.effort || null;
    eb.querySelector('.cw-tool-lb').textContent = efforts().find(x => x[0] === (ef || ''))?.[1] || 'Default';
    eb.classList.toggle('on', !!ef && ef !== 'off');
    paintCtx(caps);
    const cm = curMode(), mw = $w('.cw-cmode');
    mw.classList.toggle('hidden', !cm);
    for (const b of mw.querySelectorAll('[data-cm]')) { const on = b.dataset.cm === cm; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    $w('.cw-box').dataset.cmode = cm || '';
    paintFiles(); paintSend();
  }
  function paintFiles() {
    const box = $w('.cw-files');
    box.innerHTML = W.files.map((f, k) => `<div class="cw-file-chip${f.status === 'bad' ? ' bad' : ''}" title="${esc(f.error || f.name)}">
      ${f.preview ? `<img src="${f.preview}" alt="">` : `<span class="cw-file-ic" aria-hidden="true">${fileIcon(f.name)}</span>`}
      <span class="cw-file-n">${esc(f.name)}</span>${f.status === 'up' ? `<span class="cw-file-p">${Math.round(f.progress * 100)}%</span>` : f.status === 'bad' ? '<span class="cw-file-p">✗</span>' : ''}
      <button type="button" class="cw-file-x" data-x="${k}" aria-label="Remove ${esc(f.name)}">✕</button></div>`).join('');
    box.classList.toggle('hidden', !W.files.length);
    box.onclick = e => { const x = e.target.closest('[data-x]'); if (!x) return; const f = W.files[Number(x.dataset.x)]; f?.xhr?.abort(); if (f?.preview) URL.revokeObjectURL(f.preview); W.files.splice(Number(x.dataset.x), 1); paintFiles(); paintSend(); };
  }
  /** Files to attach: images shrunk to IMG_MAX_SIDE first when large, each uploaded with its progress. */
  async function addFiles(list) {
    if (!W || !W.can?.ok) return;
    if (!W.can.caps?.attachments) return app.toast?.(`${agentRec(W.agentId)?.name || 'This agent'} can't read files.`, 'bad');
    const name = agentRec(W.agentId)?.name || 'This agent';
    for (const file of list) {
      if (W.files.length >= MAX_FILES) { app.toast?.(`At most ${MAX_FILES} files in one message.`, 'bad'); break; }
      // (said before anything is uploaded: a video or recording to an agent that can't take one; a file larger than its
      // provider takes — a picture is made smaller below, so only its own limit counts for it)
      const av = isAvFile(file), image = /^image\//.test(file.type || '');
      if (av && !W.can.caps?.files) { app.toast?.(`${name} can't take videos or recordings (${file.name}).`, 'bad', 5000); continue; }
      const cap = W.limits && !image ? W.limits.maxBytes : null;
      if (cap && file.size > cap) { app.toast?.(`${file.name} is ${mb(file.size)}; ${name}'s provider takes files up to ${mb(cap)}.`, 'bad', 6000); continue; }
      const f = { name: file.name || 'file', size: file.size, mime: file.type, status: 'up', progress: 0, preview: /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? URL.createObjectURL(file) : null };
      W.files.push(f); paintFiles(); paintSend();
      let body = file;
      if (f.preview && file.type !== 'image/gif') { try { const s = await shrink(file); if (s) { body = s.blob; f.name = s.name; } } catch { /* sent as it is */ } }
      upload(f, body);
    }
  }
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const side = Math.max(bmp.width, bmp.height);
    if (side <= IMG_MAX_SIDE && file.size <= IMG_SHRINK_BYTES) { bmp.close?.(); return null; }
    const k = Math.min(1, IMG_MAX_SIDE / side), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    return blob ? { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg' } : null;
  }
  function upload(f, body) {
    const x = f.xhr = new XMLHttpRequest();
    x.open('POST', `/api/chat/attachments?name=${encodeURIComponent(f.name)}`);
    x.setRequestHeader('content-type', 'application/octet-stream');
    if (auth.csrf) x.setRequestHeader('x-csrf-token', auth.csrf);
    x.upload.onprogress = e => { if (e.lengthComputable && W) { f.progress = e.loaded / e.total; paintFiles(); } };
    x.onload = () => {
      let j = null; try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status === 200 && j?.attachment) { Object.assign(f, { id: j.attachment.id, status: 'ok', mime: j.attachment.mime }); }
      else { f.status = 'bad'; f.error = j?.error || 'This file could not be attached.'; app.toast?.(`${f.name}: ${f.error}`, 'bad'); }
      f.xhr = null; if (W) { paintFiles(); paintSend(); }
    };
    x.onerror = () => { f.status = 'bad'; f.error = 'The upload failed.'; f.xhr = null; if (W) { paintFiles(); paintSend(); } };
    x.send(body);
  }

  // ------------------------------------------------------------------------------------------------ sending, the answer
  async function ensureSession() {
    if (W.session) return W.session;
    const r = await post('/api/chat-sessions/create', { agent: W.agentId, label: 'New chat' });
    W.session = r.session;
    // (started in a project: in it before its first message, so that message already follows the project's instructions)
    if (W.newIn) { try { W.session = (await post('/api/chat-sessions/move', { agent: W.agentId, session: W.session.id, project: W.newIn })).session; } catch (e) { app.toast?.(e.message, 'bad'); } }
    W.newIn = null;
    if (W.pending.model || W.pending.effort || W.pending.mode) { try { await prefs(W.session, { model: W.pending.model, effort: W.pending.effort, ...(W.pending.mode ? { mode: W.pending.mode } : {}) }); } catch { /* the defaults */ } }
    W.pending = { model: null, effort: null, mode: null };
    return W.session;
  }
  /** Sends what is written. While the agent works, a provider that takes messages then (caps.queue: OpenClaw) gets it as it
   *  is set up to — into the running turn by default; later: after this answer (Ctrl/Cmd+Enter), as OpenClaw's Control UI. */
  async function send({ later = false, redirect = false, item = null } = {}) {
    if (!W || !W.can?.ok || (W.run && !W.can.caps?.queue)) return false;
    const follow = !!W.run;
    // (item: a message the provider's queue held — sent as it was, the composer left as it is)
    const input = $w('.cw-in'), text = item ? item.text.trim() : input.value.trim(), files = item ? item.files : W.files.filter(f => f.status === 'ok' && f.id);
    if (!text && !files.length) return false;
    if (!item && W.files.some(f => f.status === 'up')) return false;
    const tok = W.token;
    // (a redirect, as Hermes Desktop records it: the person's words at once, under what the turn wrote so far — the rest of
    // the turn comes below them, whatever the answer to the request races)
    let early = null;
    if (follow && redirect) {
      if (!item) { input.value = ''; grow(); paintSend(); }   // (the composer emptied at once, as Desktop's)
      cutLive();
      early = { role: 'user', text: item?.display || text, meta: null };
      W.messages.push(early); W.stick = true; paintThread();
    }
    try {
      const s = await ensureSession();
      if (follow && !item) input.value = '';   // (cleared at once: the next one can be written while this one goes)
      const r = await postRun({ agent: W.agentId, session: s.id, input: text, attachments: files.map(f => f.id), ...zoneArg(), ...(follow && redirect ? { queue: 'redirect' } : follow && later ? { queue: 'later' } : {}) });
      if (!W || tok !== W.token) return true;   // (it went; the window moved on meanwhile)
      // (a chat just begun has its session on the provider now: followed from this first answer on — what the provider
      // does there from elsewhere, the background tasks this answer starts)
      if (r.session && W.session?.id === r.session.id && W.session.key !== r.session.key) { W.session = r.session; watchSession(); W.dock.sync(); }
      if (!item) {
        input.value = ''; grow();
        for (const f of W.files) if (f.preview) URL.revokeObjectURL(f.preview);
        W.files = []; paintFiles();
      }
      let mine = r.message || { role: 'user', text, meta: files.length ? { attachments: files.map(f => ({ id: f.id, name: f.name, mime: f.mime })) } : null };
      // (a provider command's message — a skill's words: shown as the command, as the provider's own app shows it)
      if (item?.display) mine = { ...mine, text: item.display };
      if (early) {
        // (recorded already: the server's copy of it takes its place; its run, ended at once, is the turn's)
        const k = W.messages.indexOf(early);
        if (k >= 0) W.messages[k] = mine;
        W.queued.push({ id: r.runId, buf: [], ended: null });
        paintThread(); paintSend();
      } else if (W.run) {
        // sent while it works: what it wrote so far stays above this message, what follows comes below it; this message's
        // own run (if the provider gives it one: after this answer) is shown when its turn comes
        cutLive();
        W.messages.push(mine);
        W.queued.push({ id: r.runId, buf: [], ended: null });
        W.stick = true; paintThread(); paintSend();
      } else { W.messages.push(mine); startRun(r.runId); }
      refreshList();
      return true;
    } catch (e) {
      if (W && tok === W.token) {
        if (early) { const k = W.messages.indexOf(early); if (k >= 0) W.messages.splice(k, 1); }
        if (follow && !item && !input.value) input.value = text;
        note(e.message);
      }
      return false;
    }
  }
  /** Enter, the phone keyboard's send key and the send button: one way in. A provider's own rules while it works (Hermes:
   *  redirect, queue, stop); else — not working: send; working: a provider that takes messages then (OpenClaw) gets it now,
   *  Ctrl/Cmd+Enter after this answer; any other agent (the built-in ones) queues it, sent by itself when the answer ends
   *  (as OpenClaw's Control UI queues follow-ups). The button with nothing written stops the answer. */
  function submit({ ctrl = false, button = false } = {}) {
    if (!W) return;
    const v = view();
    if (v?.submit) { v.submit(cctx(), button ? { button: true } : { ctrl }); return; }
    const ready = !!$w('.cw-in').value.trim() || W.files.some(f => f.status === 'ok' && f.id);
    if (!ready) { if (button && W.run) stop(); return; }
    if (W.files.some(f => f.status === 'up') || !W.can?.ok) return;
    if (!W.run) { send(); return; }
    if (W.can.caps?.queue) { send({ later: ctrl }); return; }
    enqueue();
  }
  // ---- the window's queue (agents that take no message while they work): per chat, shown above the composer
  const outboxKey = () => (W.session ? W.session.id : 'new');
  function outbox() { W.outboxes = W.outboxes || new Map(); let q = W.outboxes.get(outboxKey()); if (!q) { q = { items: [], parked: false }; W.outboxes.set(outboxKey(), q); } return q; }
  function enqueue() {
    const input = $w('.cw-in'), text = input.value.trim(), files = W.files.filter(f => f.status === 'ok' && f.id);
    if (!text && !files.length) return;
    const q = outbox();
    q.items.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, files: files.map(f => ({ id: f.id, name: f.name, mime: f.mime, status: 'ok' })) });
    input.value = ''; grow();
    for (const f of W.files) if (f.preview) URL.revokeObjectURL(f.preview);
    W.files = []; paintFiles();
    paintQueue(); paintSend(); mgr.changed(me);
  }
  function outboxHtml() {
    if (!W) return '';
    const q = W.outboxes?.get(outboxKey());
    if (!q || !q.items.length) return '';
    return `<div class="hv-q-h"><span class="hv-ic" aria-hidden="true">${icon('layers')}</span><span>${q.items.length} Queued${q.parked ? ' — paused' : ' — sent when this answer ends'}</span>${q.parked && !W.run ? '<button type="button" class="btn small" data-oq="resume" title="Send the next one now">Resume</button>' : ''}</div>`
      + q.items.map(x => `<div class="hv-q-row" data-q="${esc(x.id)}"><button type="button" class="cw-ic hv-q-x" data-oq="delete" title="Delete" aria-label="Delete">${icon('x')}</button>
        <div class="hv-q-t" data-noicon>${esc(x.text || 'Attachment only')}${x.files.length ? `<span class="hv-q-f">${x.files.map(f => `<span class="hv-ic" aria-hidden="true">${icon('doc')}</span>${esc(f.name)}`).join(' ')}</span>` : ''}</div>
        <span class="hv-q-acts"><button type="button" class="cw-ic" data-oq="edit" title="Edit (back into the message box)" aria-label="Edit">${icon('pencil')}</button></span></div>`).join('');
  }
  function outboxAction(act, id) {
    const q = outbox(), k = q.items.findIndex(x => x.id === id);
    if (act === 'resume') { q.parked = false; paintQueue(); flushOutbox(); return; }
    if (k < 0) return;
    if (act === 'delete') q.items.splice(k, 1);
    if (act === 'edit') {
      // (back into the box, after what is written there; its files with it)
      const [x] = q.items.splice(k, 1), input = $w('.cw-in');
      input.value = input.value.trim() ? `${input.value.trim()}\n${x.text}` : x.text;
      W.files.push(...x.files); paintFiles(); grow();
      if (!touch()) input.focus();
    }
    paintQueue(); paintSend(); mgr.changed(me);
  }
  /** The next queued message, once the agent is free (one a turn, in order). Stopped by the person: the queue waits until
   *  Resume; a message that couldn't be sent goes back first in line, and the queue waits. */
  async function flushOutbox(stopped = false) {
    if (!W || W.run || W.sending || W.flushing || !W.can?.ok) return;
    const q = W.outboxes?.get(outboxKey());
    if (!q || !q.items.length) return;
    if (stopped) { q.parked = true; paintQueue(); return; }
    if (q.parked) return;
    const it = q.items.shift();
    W.flushing = true; paintQueue();
    let ok = false;
    try { ok = await send({ item: { text: it.text, files: it.files } }); } finally { if (W) W.flushing = false; }
    if (!W) return;
    if (!ok) { q.items.unshift(it); q.parked = true; }
    paintQueue(); paintSend();
  }

  /** What a provider's own composer rules (its view: submit, queue) may use of the window. */
  function cctx() {
    const key = () => (W.session ? W.session.id : 'new');
    return {
      busy: () => !!W?.run,
      // (a turn waiting for the person — an approval, a question: Hermes can't take words into it, they queue)
      blocking: () => !!W?.run && ((W.run.approvals || []).some(a => W.apprs.get(a.id) === 'pending') || (W.run.questions || []).some(q => q.status === 'pending')),
      /** What the turn waits on: its questions (ids) and how many other things (approvals, passwords, secrets). */
      waiting: () => {
        const R = W?.run, qs = (R?.questions || []).filter(q => q.status === 'pending');
        return { clarify: qs.filter(q => !q.questions.some(x => x.secret)).map(q => q.id),
          others: (R?.approvals || []).filter(a => W.apprs.get(a.id) === 'pending').length + qs.filter(q => q.questions.some(x => x.secret)).length };
      },
      text: () => $w('.cw-in').value,
      files: () => W.files.filter(f => f.status === 'ok' && f.id),
      uploading: () => W.files.some(f => f.status === 'up'),
      send: o => send(o),
      stop: () => stop(),
      /** The composer's words and files, taken out of it (into the queue). */
      take: () => {
        const i = $w('.cw-in'), text = i.value.trim(), files = W.files.filter(f => f.status === 'ok' && f.id).map(f => ({ id: f.id, name: f.name, mime: f.mime }));
        if (!text && !files.length) return null;
        i.value = ''; grow();
        for (const f of W.files) if (f.preview) URL.revokeObjectURL(f.preview);
        W.files = []; paintFiles();
        return { text, files };
      },
      /** A queued message back into the composer, to be edited. */
      put: it => {
        const i = $w('.cw-in');
        i.value = it.text; grow();
        W.files = [...W.files, ...it.files.map(f => ({ ...f, status: 'ok' }))]; paintFiles();
        if (!touch()) i.focus();
      },
      /** How an approval of the run stands (pending, or the answer given). */
      apprState: id => W.apprs.get(id) || 'pending',
      approve: (id, decision, b) => answerProvAppr(id, decision, b),
      /** Answers one of the run's questions ({ qid: [choices and words] }, or null: skipped / cancelled). */
      answer: async (qid, answers) => {
        const R = W?.run;
        if (!R) throw new Error('Nothing is waiting');
        try { await post('/api/providers/questions', { run: R.id, question: qid, ...(answers ? { answers } : { cancel: true }) }); }
        catch (e) { app.toast?.(e.message, 'bad'); throw e; }
        const q = (R.questions || []).find(x => x.id === qid);
        if (q) { q.status = answers ? 'answered' : 'cancelled'; if (answers) q.answers = answers; }
        if (W?.run) paintRun();
      },
      menu: (anchor, items) => popup(anchor, items),
      /** The page's message by its id; all of them, in order. */
      message: id => W.messages.find(x => x.id === id) || null,
      messages: () => W.messages,
      /** A message being edited (its id, or null). */
      edit: id => { W.editing = id; paintThread(); setTimeout(() => { const t = W.el.querySelector('.cw-msg.user.editing textarea'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 0); },
      /** The provider's record rewound to before the person's message `m` (its row there), and `text` sent from that point
       *  — what follows it goes from the page at once. */
      rewind: async (m, text, display = null) => {
        if (!W.session || W.run) return;
        const row = m.meta && m.meta.row;
        if (!Number.isInteger(row)) { app.toast?.('That message can\'t be gone back to yet', 'bad'); return; }
        const k = W.messages.indexOf(m), keep = W.messages.slice(0, k < 0 ? W.messages.length : k);
        try {
          const r = await postRun({ agent: W.agentId, session: W.session.id, input: text, rewind: row, ...zoneArg() });
          if (!W) return;
          view()?.dropNotesAfter?.(W.session.id, keep.filter(x => !x.meta?.note).length);
          const mine = r.message || { role: 'user', text };
          W.messages = [...keep, display ? { ...mine, text: display } : mine];
          W.editing = null;
          startRun(r.runId);
          refreshList();
        } catch (e) { app.toast?.(e.message, 'bad'); }
      },
      /** The chat copied into a new one up to an answer (the provider's count of its record there); opened. */
      branch: async upto => {
        try {
          const r = await post('/api/providers/branch', { agent: W.agentId, session: W.session.id, ...(upto ? { upto } : {}) });
          await refreshList();
          if (W && r.session) pick(W.agentId, r.session.id);
        } catch (e) { app.toast?.(e.message || 'Branch failed', 'bad'); }
      },
      toast: (m, kind = '') => app.toast?.(m, kind),
      /** The chat's plan (the provider's todo list) and its subagents, as the page knows them. */
      plan: () => W.plan || null,
      subs: () => [...(W.subs || new Map()).values()],
      steer: async (id, text) => {
        try { const r = await post('/api/providers/tasks/steer', { agent: W.agentId, session: W.session?.id, task: id, text }); if (!r.steered) app.toast?.(r.reason || 'It did not take it', 'bad'); return !!r.steered; }
        catch (e) { app.toast?.(e.message, 'bad'); return false; }
      },
      stopTask: async id => {
        try { const r = await post('/api/providers/tasks/cancel', { agent: W.agentId, session: W.session?.id, task: id }); if (r.task) noteTask({ change: 'upserted', task: r.task }); if (!r.cancelled) app.toast?.(r.reason || 'Could not stop it', 'bad'); }
        catch (e) { app.toast?.(e.message, 'bad'); }
      },
      openTasks: () => W.dock?.toggle?.(true, 'tasks'),
      /** A dialog over the window (one at a time, kept while its key stays the same: what is typed in it stays). */
      overlay: (html, key = null) => overlay(html, key),
      confirm: o => confirmBox(o),
      queue: () => { W.vq = W.vq || new Map(); let q = W.vq.get(key()); if (!q) { q = { items: [], parked: false }; W.vq.set(key(), q); } return q; },
      paint: () => { paintQueue(); paintSend(); },
      /** One of the provider's own calls for its view, on this chat's session (made first when `ensure`: a command acts on
       *  it; `preview`: the command, a new chat's name until the provider names it). Resolves its answer; a chat just begun
       *  on the provider is followed from here. */
      native: async (method, params = {}, { ensure = false, preview = null } = {}) => {
        const s = ensure ? await ensureSession() : W.session;
        const agent = W.agentId, r = await post('/api/providers/native', { agent, session: s ? s.id : null, method, params, ...(preview ? { preview: String(preview).slice(0, 60) } : {}) });
        if (W && W.agentId === agent && r.session && W.session?.id === r.session.id && (W.session.key !== r.session.key || W.session.label !== r.session.label)) {
          const fresh = W.session.key !== r.session.key;
          W.session = r.session;
          if (fresh) { watchSession(); W.dock.sync(); }
          refreshList();
        }
        return r.result || {};
      },
      ensure: () => ensureSession(),
      manages: () => !!W?.can?.manage,
      agentId: () => W.agentId,
      sessionId: () => W.session?.id ?? null,
      hasProviderSession: () => !!(W.session && W.session.key && W.session.key !== '@new'),
      repaint: () => paintThread(),
      newChat: () => newChat(),
      models: () => { const b = $w('.cw-model'); if (b && !b.classList.contains('hidden')) modelMenu(b); },
      efforts: () => efforts().map(x => x[0]).filter(Boolean),
      effort: v => setPref('effort', v),
      chats: () => W.sessions || [],
      openChat: id => pick(W.agentId, id),
      openChats: () => { toggleSide(true); setView('chats'); },
      usage: u => { W.usage = u; paintComposer(); },
      reload: async () => { await loadHistory(); if (W) paintThread(); },
      /** The window's own element (what a view draws again in it stays in it: another window may show the same view). */
      root: () => W.el,
    };
  }
  /** A provider view's dialog over the chat window (Hermes: a sudo password, a secret) — drawn when its key changes, gone
   *  with null; its controls answer through the view. */
  function overlay(html, key) {
    const win = W.el.querySelector('.chatwin');
    let o = win.querySelector(':scope > .hv-ovl:not(.confirm)');
    if (!html) { o?.remove(); return; }
    if (o && o.dataset.k === key) return;
    o?.remove();
    o = win.appendChild(h(`<div class="hv-ovl" data-k="${esc(key || '')}">${html}</div>`));
    o.addEventListener('click', e => { const b = e.target.closest('[data-a^="hv-"]'); if (b) view()?.click?.(cctx(), b); });
    o.addEventListener('keydown', e => { if (view()?.key?.(cctx(), e)) e.stopPropagation(); });
    setTimeout(() => o.querySelector('input, button.primary')?.focus(), 0);
  }
  /** A yes/no question over the window: { title, body, code, yes } → true when the person says yes. */
  function confirmBox({ title, body, code = '', yes = 'OK' }) {
    return new Promise(resolve => {
      const win = W.el.querySelector('.chatwin');
      const o = win.appendChild(h(`<div class="hv-ovl confirm"><div class="hv-dlg" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div class="hv-dlg-h"><b data-noicon>${esc(title)}</b></div>
        <p class="hv-dlg-d" data-noicon>${esc(body)}</p>${code ? `<pre class="hv-dlg-code" data-noicon>${esc(code)}</pre>` : ''}
        <div class="hv-dlg-b"><button type="button" class="btn small" data-v="0">Cancel</button><button type="button" class="btn small primary" data-v="1">${esc(yes)}</button></div></div></div>`));
      const done = v => { o.remove(); resolve(v); };
      o.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === o) done(false); });
      o.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
      setTimeout(() => o.querySelector('[data-v="1"]')?.focus(), 0);
    });
  }
  /** A change of the open chat's background tasks (session.task) for a provider view's own stack and cards. */
  function noteTask(c) {
    if (!W || !c) return;
    W.subs = W.subs || new Map();
    if (c.change === 'upserted' && c.task && c.here !== false && c.task.here !== false) W.subs.set(c.task.id, c.task);
    else if (c.change === 'deleted' && c.taskId) W.subs.delete(c.taskId);
    else if (c.change === 'restored') { loadSubs(); return; }
    paintQueue(); view()?.onTasks?.(cctx());
  }
  /** The open chat's background tasks, read when it opens (a provider view that shows them, for whoever manages it). */
  async function loadSubs() {
    if (!W || !view()?.onTasks || !W.can?.caps?.tasks || !W.can?.manage || !W.session || W.session.key === '@new') return;
    const tok = W.token, sid = W.session.id;
    try {
      const r = await getJSON(`/api/providers/tasks?agent=${W.agentId}&session=${sid}`);
      if (!W || tok !== W.token || W.session?.id !== sid) return;
      W.subs = W.subs || new Map();
      // (an event newer than what was read meanwhile stands)
      for (const t of [...(r.active || []), ...(r.recent || [])]) { const was = W.subs.get(t.id); if (t.here !== false && !(was && (was.updatedAt || 0) > (t.updatedAt || 0))) W.subs.set(t.id, t); }
      paintQueue(); view()?.onTasks?.(cctx());
    } catch { /* the stack shows the rest */ }
  }
  /** The provider's queue panel above the composer (Hermes: the messages waiting for the turn to end). */
  function paintQueue() {
    const el = $w('.cw-vq'), v = view();
    const html = v?.queueHtml ? v.queueHtml(cctx()) : outboxHtml();
    el.classList.toggle('hidden', !html);
    if (el._h !== html) { el._h = html; el.innerHTML = html; v?.restore?.(el, cctx()); }
  }
  /** What the answer being written shows so far, kept as it is above a message the person sends while it works; the live
   *  answer goes on below that message with what comes next (a step still running stays with it). */
  function cutLive() {
    const R = W.run;
    if (!R) return;
    const v = view();
    if (v) {
      // (the provider's view: its sections so far, kept as they were drawn; the turn goes on below the message)
      const parts = v.cut(R);
      if (parts.length) { const m = { role: 'assistant', text: R.text.slice(R.cut || 0), status: 'partial', meta: { parts } }; W.messages.push(m); v.kept?.(cctx(), m); }
      R.cut = R.text.length; R.cutThinking = R.thinking.length; R.cutTools = R.tools.length;
      return;
    }
    const tools = R.tools.slice(R.cutTools || 0), running = tools.findIndex(t => !t.done), k = running < 0 ? tools.length : running;
    const text = R.text.slice(R.cut || 0);
    if (text.trim() || k) W.messages.push({ role: 'assistant', text, status: 'partial', meta: k ? { steps: tools.slice(0, k).map(t => ({ ...t, done: true })) } : null });
    R.cut = R.text.length; R.cutTools = (R.cutTools || 0) + k; R.cutThinking = R.thinking.length;
  }
  /** The next message sent while it worked whose answer is its own (the provider ran it after): shown now. One taken into
   *  the turn that just ended, or answered meanwhile, is in the history already. */
  function promoteQueued() {
    let missed = false;
    while (W && !W.run && W.queued.length) {
      const q = W.queued.shift();
      if (q.ended) { W.done.add(q.id); if (!q.ended.steered) missed = true; continue; }
      startRun(q.id);
      for (const m of q.buf) onFrame(m);
    }
    if (missed && W && !W.run) loadHistory().then(() => { if (W && !W.run) paintThread(); });
  }
  /** Starts a run (the person's message, written again, edited). While it is on its way the socket may bring the answer's
   *  first pieces: they are this run's (kept for startRun), not one this page should follow by itself. */
  async function postRun(body) {
    W.sending = (W.sending || 0) + 1;
    const w = W;
    try { return await post('/api/providers/runs', body); } finally { w.sending -= 1; }
  }
  /** Follows an answer of this chat that this page didn't start — begun before it was opened (a refresh), in another tab,
   *  or the turn a message sent while it worked was taken into: what it did so far is in the history (read again), the
   *  live answer shows what comes next, and anything waiting for the person (an approval, a question) at once. */
  async function attachRun(id, { reload = true } = {}) {
    if (!W || W.run || W.done.has(id)) return;
    const tok = W.token;
    if (reload) { await loadHistory(tok); if (!W || tok !== W.token || W.run) return; }
    startRun(id);
    const R = W.run;
    try {
      const r = await getJSON(`/api/providers/runs/events?run=${encodeURIComponent(id)}&since=0`);
      if (!W || W.run !== R) return;
      if (typeof r.partial === 'string' && r.partial.length > R.text.length) R.text = r.partial;
      if (typeof r.thinking === 'string' && r.thinking.length > R.thinking.length) R.thinking = r.thinking;
      for (const it of r.events || []) event(R, it.event, it.seq);
    } catch { /* the poll catches up */ }
    if (!W || W.run !== R || R.ended) return;
    R.cut = R.text.length; R.cutThinking = R.thinking.length;
    R.cutTools = R.tools.filter(t => t.done).length === R.tools.length ? R.tools.length : R.tools.findIndex(t => !t.done);
    paintThread();
  }
  /** Voice mode's turn: `text` as the person's message (an answer being stopped ends first). Resolves the run's id. */
  async function sendVoice(text) {
    for (let k = 0; W && W.run && k < 60; k++) await sleep(100);
    if (!W || !W.can?.ok) throw new Error('This chat isn\'t available now.');
    if (W.run) throw new Error('It is still answering; try again in a moment.');
    const tok = W.token, s = await ensureSession();
    const r = await postRun({ agent: W.agentId, session: s.id, input: text, ...zoneArg() });
    if (!W || tok !== W.token) throw new Error('The chat changed.');
    W.messages.push(r.message || { role: 'user', text });
    startRun(r.runId);
    refreshList();
    return r.runId;
  }
  async function regenerate() {
    if (!W || W.run || !W.session) return;
    try {
      const r = await postRun({ agent: W.agentId, session: W.session.id, input: '', regenerate: true, ...zoneArg() });
      const lastUser = W.messages.map(m => m.role).lastIndexOf('user');
      W.messages = W.messages.slice(0, lastUser + 1);
      startRun(r.runId);
    } catch (e) { note(e.message); }
  }
  async function sendEdit(id, text) {
    if (!W || W.run || !W.session) return;
    try {
      const r = await postRun({ agent: W.agentId, session: W.session.id, input: text, editFrom: id, ...zoneArg() });
      const k = W.messages.findIndex(m => m.id === id);
      W.messages = W.messages.slice(0, k < 0 ? W.messages.length : k);
      W.messages.push(r.message || { role: 'user', text });
      W.editing = null;
      startRun(r.runId);
    } catch (e) { note(e.message); }
  }
  function note(text) { W.messages.push({ role: 'system', text, status: 'failed' }); paintThread(); }

  function startRun(runId) {
    W.run = { id: runId, text: '', thinking: '', tools: [], approvals: [], t0: Date.now(), since: 0, session: W.session.id, agent: W.agentId, frames: 0 };
    view()?.startRun(W.run);
    W.stick = true;
    head(); paintThread(); paintSend(); paintQueue();
    poll(W.run);
    W.run.timer = setInterval(tickWait, 1000);   // (the "thinking · 12 s" clock: its words only, so nothing else is redrawn under the pointer)
    // the pieces that came before the page knew this run (kept by onFrame)
    const early = W.early.filter(x => x.m.run === runId && Date.now() - x.at < 30000).map(x => x.m);
    W.early = W.early.filter(x => x.m.run !== runId && Date.now() - x.at < 30000);
    for (const m of early) onFrame(m);
  }
  /** Whether the turn waits for the person now (an approval or a question of it unanswered). */
  const waitingOn = R => (R.approvals || []).some(a => W.apprs.get(a.id) === 'pending') || (R.questions || []).some(q => q.status === 'pending');
  function tickWait() {
    const R = W?.run, v = R && view();
    if (v) { const live = W.el.querySelector('.cw-msg.live'); if (live) v.tick(live, R, waitingOn(R)); return; }
    const el = R && W.el.querySelector('.cw-msg.live .cw-wait');
    if (!el) return;
    const ms = Math.max(0, Date.now() - R.t0);
    el.lastChild.textContent = ` ${R.phase || 'Thinking'}${ms > 3000 ? ` · ${secs(ms)}` : ''}`;
  }
  function abandonRun(w = W) { if (w?.run) { clearInterval(w.run.timer); w.run.gone = true; w.run = null; } w?.el?.querySelector('.chatwin > .hv-ovl:not(.confirm)')?.remove(); }
  async function stop() {
    if (!W?.run) return;
    const id = W.run.id;
    W.run.stopAsked = true;   // (the person stopped it: what they queued waits — the end may come as 'stopped' or not)
    $w('.cw-send').disabled = true;
    try { await post('/api/providers/interrupt', { run: id }); } catch (e) { note(e.message); }
  }
  /** The socket's frames for the answer being written. */
  function onFrame(m) {
    if (m.working !== undefined && m.session) {   // (one of the agent's chats began or stopped working: its mark in the Sidebar)
      if (W && m.agent === W.agentId) for (const s of [sessionOf(m.session)].filter(Boolean)) { s.working = m.working || false; if (W.view === 'chats' || W.view === 'project') paintSide(); }
      return;
    }
    if (m.card) { if (W && W.session && m.session === W.session.id && m.agent === W.agentId) { W.plan = { ...(W.plan || {}), ...m.card }; paintCard(); } return; }
    if (m.task) { if (W && W.session && m.session === W.session.id && m.agent === W.agentId) { W.dock.onTask(m.task); noteTask(m.task); } return; }
    // (a side question or background task a chat started, answered: the manager hands it on once — to the window that
    // shows that chat, if one does)
    if (m.side) return;
    if (m.observed) { onObserved(m); return; }
    const Q = W?.queued.find(q => q.id === m.run);
    if (Q) { Q.buf.push(m); if (Q.buf.length > 5000) Q.buf.shift(); if (m.event?.type === 'run.end') Q.ended = m.event; return; }
    const R = W?.run;
    // (an answer of the open chat this page doesn't follow — begun before it was opened, in another tab, or the turn a
    // message sent while it worked was taken into — is followed: now if nothing is shown, or instead of a run of ours that
    // hasn't begun (it waits behind this one), or after the one under way)
    if (W && m.run && (!R || m.run !== R.id) && !W.sending && !W.done.has(m.run) && W.session && m.session === W.session.id && m.agent === W.agentId && (m.delta || (m.event && m.event.type !== 'run.end'))) {
      W.early.push({ m, at: Date.now() });
      if (!R) { attachRun(m.run); return; }
      if (!R.text && !R.tools.length && !R.thinking) {
        clearInterval(R.timer); R.gone = true; W.run = null;
        W.queued.unshift({ id: R.id, buf: [], ended: null });
        attachRun(m.run);
        return;
      }
      W.queued.push({ id: m.run, buf: [m], ended: null });
      W.early.pop();
      return;
    }
    if (!R || m.run !== R.id) {
      // an answer's first pieces can come before the page knows its run (the socket is quicker than the reply to the
      // POST): kept a moment for startRun, never dropped
      if (W && m.run && m.agent === W.agentId && (m.delta || m.event)) { W.early.push({ m, at: Date.now() }); if (W.early.length > 300) W.early.shift(); }
      if (W && m.event?.type === 'run.end') refreshList();
      return;
    }
    R.frames++;
    if (m.delta) {
      const was = R.text.length;
      if (m.delta.replace && typeof m.delta.text === 'string') R.text = m.delta.text;   // (the provider rewrote the answer so far)
      else if (m.delta.text) R.text = joinAt(R.text, m.delta.text, m.delta.at);
      if (m.delta.thinking) R.thinking = joinAt(R.thinking, m.delta.thinking, m.delta.tat);
      paintRun(); head();
      if (R.text.length > was) W.voice.onRun('delta', R);
      else if (Number.isInteger(m.delta.at) && m.delta.at > R.text.length) R.wake?.();   // (a gap: the events route fills it now)
      return;
    }
    if (m.event) event(R, m.event, m.seq);
  }
  /** Live activity (Agent Providers): a run the provider does from another channel in the session open here, shown as it
   *  happens (never in the way of this chat's own: it doesn't hold the composer); when it ends, the history has it. */
  function onObserved(m) {
    if (!W || !W.session || m.session !== W.session.id || m.agent !== W.agentId) return;
    if (W.run && W.run.id === m.run) return;
    if (!W.obs || W.obs.id !== m.run) {
      if (m.event?.type === 'run.end') return;
      W.obs = { id: m.run, observed: true, text: '', thinking: '', tools: [], approvals: [], questions: [], t0: Date.now(), since: 0, session: W.session.id };
    }
    const R = W.obs;
    // (one that goes quiet — its end missed — is let go after a while: the history shows what happened)
    clearTimeout(R.quiet); R.quiet = setTimeout(() => { if (W && W.obs === R) { W.obs = null; loadHistory().then(() => paintThread()); } }, 300000);
    if (m.delta) {
      if (m.delta.replace && typeof m.delta.text === 'string') R.text = m.delta.text;
      else if (m.delta.text) R.text = joinAt(R.text, m.delta.text, m.delta.at);
      if (m.delta.thinking) R.thinking = joinAt(R.thinking, m.delta.thinking, m.delta.tat);
      paintRun(); return;
    }
    if (m.event?.type === 'run.end') { const w = W; clearTimeout(R.quiet); if (W.min) W.unread++; loadHistory().then(() => { if (W === w && W.obs === R) { W.obs = null; paintThread(); paintComposer(); refreshList(); } }); return; }
    if (m.event) event(R, m.event, m.seq);
  }
  function stopWatching(w = W) {
    if (!w) return;
    clearInterval(w.watchTimer); w.watchTimer = null;
    if (w.watching) { post('/api/providers/watch', { ...w.watching, on: false }).catch(() => {}); w.watching = null; }
  }
  /** The open provider session is watched for live activity while it stays open (a lease renewed every minute). */
  function watchSession() {
    if (!W) return;
    if (W.watching && W.session && W.watching.session === W.session.id && W.watchTimer) return;
    stopWatching();
    if (!W.session || !W.can?.caps?.observe || W.session.key === '@new') return;
    const w = { agent: W.agentId, session: W.session.id };
    // (followed from now: the chat's subagents read once — one that began before the lease would else be missed)
    const renew = () => post('/api/providers/watch', w).then(r => { if (W && r && r.ok) { const first = !W.watching; W.watching = w; if (first) loadSubs(); } }, () => {});
    renew();
    W.watchTimer = setInterval(renew, 60000);
  }
  function event(R, e, seq) {
    if (seq) R.since = Math.max(R.since, seq);
    if (e.type === 'native') {
      // (in order, once: the socket and the events route may both bring one — its number says whether it was applied)
      if (seq) { if (seq <= (R.nativeSeq || 0)) return; R.nativeSeq = seq; }
      const v = view(); if (v) { v.onNative(R, e.ev); paintRun(); }
      // (the provider named the chat — or renamed it — as it goes: its name here at once, in the header and the Sidebar)
      if (e.ev && e.ev.op === 'title' && W.session && R.session === W.session.id && !R.observed) { W.session = { ...W.session, label: e.ev.text.slice(0, 60) }; head(); const it = (W.sessions || []).find(x => x.id === W.session.id); if (it) { it.label = W.session.label; paintSide(); } }
      // (a delegation sent its children off: the chat's subagents read again — their first events may have gone by)
      if (e.ev && e.ev.op === 'tool' && e.ev.ph === 'end' && e.ev.name === 'delegate_task') loadSubs();
      return;
    }
    const step = id => R.tools.find(x => x.id === id);
    if (e.type === 'tool.start') {
      if (!step(e.toolId)) R.tools.push({ id: e.toolId, name: e.name, title: e.title, kind: e.toolKind, input: e.input || '', output: '', done: false });
      paintRun();
    } else if (e.type === 'tool.update') {
      const t = step(e.toolId); if (!t) return;
      if (e.input) t.input = e.input;
      if (typeof e.text === 'string') t.output = e.replace ? e.text : (t.output || '') + e.text;
      paintRun();
    } else if (e.type === 'tool.end') {
      let t = step(e.toolId);
      if (!t) { t = { id: e.toolId, name: e.name || 'step', title: e.title, kind: e.toolKind }; R.tools.push(t); }
      Object.assign(t, { done: true, ok: e.ok !== false }, e.text ? { output: e.text } : {}, Number.isFinite(e.exitCode) ? { exitCode: e.exitCode } : {}, Number.isFinite(e.ms) ? { ms: e.ms } : {}, e.cwd ? { cwd: e.cwd } : {});
      if (e.tab) { t.tab = e.tab; W.tabShots.delete(e.tab.targetId); }   // (the page changed: its picture is taken again)
      paintRun();
    } else if (e.type === 'approval.requested') {
      if (!R.approvals.some(a => a.id === e.approvalId)) {
        R.approvals.push({ id: e.approvalId, tool: e.tool, summary: e.summary, title: e.title, command: e.command, cwd: e.cwd, options: e.options || null });
        W.apprs.set(e.approvalId, 'pending');
      }
      paintRun();
    } else if (e.type === 'approval.resolved') { if (W.apprs.get(e.approvalId) === 'pending') W.apprs.set(e.approvalId, e.decision || (e.approved ? 'allow-once' : 'deny')); paintRun(); }
    else if (e.type === 'run.status') { R.phase = e.phase; paintRun(); }
    else if (e.type === 'question.requested') { R.questions = R.questions || []; if (!R.questions.some(q => q.id === e.questionId)) R.questions.push({ id: e.questionId, questions: e.questions, status: 'pending' }); paintRun(); }
    else if (e.type === 'question.resolved') { const q = (R.questions || []).find(x => x.id === e.questionId); if (q) { q.status = e.status || 'answered'; if (e.answers) q.answers = e.answers; } paintRun(); }
    else if (e.type === 'plan.update') { W.plan = R.plan = { ...(W.plan || {}), ...Object.fromEntries(Object.entries({ title: e.title, steps: e.steps, explanation: e.explanation, markdown: e.markdown, revision: e.revision, updatedAt: e.updatedAt }).filter(([, v]) => v !== undefined)), at: Date.now() }; paintCard(); }
    else if (e.type === 'usage.update') { W.usage = { used: e.used, size: e.size }; paintComposer(); }
    else if (e.type === 'run.end') { if (!R.observed) finishRun(R, e); }
  }
  async function finishRun(R, e) {
    if (R.gone || R.ended) return;
    R.ended = true;
    W?.done.add(R.id);
    clearInterval(R.timer);
    if (!W || W.run !== R) return;
    for (const t of R.tools) W.stepSeen.set(String(t.id), Object.fromEntries(Object.entries({ title: t.title, exitCode: t.exitCode, ms: t.ms, cwd: t.cwd }).filter(([, v]) => v !== undefined)));
    // the whole answer, with its id and what it took, from the history (and the chat's new name from the list)
    await loadHistory();
    if (!W || W.run !== R) return;
    // (a turn stopped or cut off part-way that the provider hasn't kept — or not yet: what it showed stays as it was drawn,
    // as Hermes Desktop keeps it; the history read next time has the provider's own)
    if (e.status !== 'ok') {
      const lastUser = W.messages.map(m => m.role).lastIndexOf('user'), answered = W.messages.slice(lastUser + 1).some(m => m.role === 'assistant');
      const v = view(), text = R.text.slice(R.cut || 0), parts = v ? v.partsOf(R) : null;
      if (!answered && (text.trim() || (parts && parts.length))) W.messages.push({ role: 'assistant', text, status: 'stopped', meta: parts ? { parts } : null });
    }
    if (e.status === 'error' && !W.messages.some(m => m.role === 'system' && m.text && m.text.includes(e.error || '\u0000'))) W.messages.push({ role: 'system', text: e.error || 'It could not answer.', status: 'failed' });
    W.run = null;
    if (W.min) W.unread++;   // (answered while it was put away: counted on its button)
    overlay(null);   // (a provider view's dialog for this run: nothing waits any more)
    head(); paintThread(); paintComposer();   // (the composer too: the context meter, from the history just read)
    refreshList();
    promoteQueued();
    if (!W.run && W.liveRun && W.liveRun !== R.id) attachRun(W.liveRun);
    if (!W.run) { paintSend(); view()?.afterRun?.(cctx()); }
    if (!W.run) flushOutbox(e.status === 'stopped' || !!R.stopAsked);
    // the whole answer as kept (its last words too) for voice mode
    const after = W.messages.slice(W.messages.map(m => m.role).lastIndexOf('user') + 1), ans = after.find(m => m.role === 'assistant');
    W.voice.onRun('end', R, { text: ans ? ans.text : R.text, error: e.status === 'error' ? (e.error || 'It could not answer.') : null });
    // (its owner's own agent: the answer in its bubble too, on this page only — ui/talk-bar.js)
    if (e.status === 'ok' && (ans?.text || R.text)) app.talk?.bubble(W.agentId, ans ? ans.text : R.text);
  }
  /** The events route: what the socket missed (a page that was away, a socket down) — and the end, for sure. */
  async function poll(R) {
    await nap(R, 1500);
    while (W && W.run === R && !R.ended) {
      try {
        const r = await getJSON(`/api/providers/runs/events?run=${encodeURIComponent(R.id)}&since=${R.since}`);
        if (!W || W.run !== R) return;
        if (typeof r.partial === 'string' && r.partial.length > R.text.length) { R.text = r.partial; paintRun(); W.voice.onRun('delta', R); }
        if (typeof r.thinking === 'string' && r.thinking.length > R.thinking.length) R.thinking = r.thinking;
        for (const it of r.events || []) event(R, it.event, it.seq);
        if (r.done && !R.ended) { const end = (r.events || []).map(x => x.event).find(x => x.type === 'run.end') || { type: 'run.end', status: 'ok' }; finishRun(R, end); }
      } catch (err) { if (err.status === 404 && W?.run === R) finishRun(R, { type: 'run.end', status: 'ok' }); }
      await nap(R, R.frames ? 2500 : 900);
    }
  }

  // ------------------------------------------------------------------------------------------------ for the manager
  const waitingNow = () => !!W?.run && waitingOn(W.run);
  const me = {
    id: o.id,
    show, close, setMin,
    get el() { return W?.el || null; },
    get agentId() { return W?.agentId ?? null; },
    /** The chat it shows, or is opening (null: a new chat). */
    sessionId: () => (W ? W.session?.id ?? W.want ?? null : null),
    get min() { return !!W?.min; },
    get max() { return !!W && W.mode === 'max' && !W.min; },
    /** Where it floats now ({ w, h, r, b } in the room), when it floats. */
    shown: () => (W && W.mode === 'float' && !W.min && W.shown ? { ...W.shown } : null),
    /** Placed by the person's Side by side: floating, at `g`. */
    arrange: g => { if (!W) return; W.geo = g; if (W.min) W.min = false; setMode('float', { save: false }); store.set(GEO_KEY, W.geo); },
    frame: m => { if (W) onFrame(m); },
    agents: () => { if (W) { head(); paintSide(); } },
    presence: () => { if (W) head(); },
    approvals: () => { if (W) apprStatus(true).then(() => W && paintThread()); },
    notes: () => { if (!W) return; clearTimeout(W.noteT); W.noteT = setTimeout(() => W && loadNotes(), 150); },
    room: () => { if (W && W.mode === 'float' && !W.min) place(); },
    fit: () => { if (W) fit(); },
    escape: () => { if (W) escape(); },
    focus: () => { if (W && !W.min && !touch()) $w('.cw-in').focus(); },
    /** How many chat windows are open (its header's button shows them, from two). */
    paintWins: n => {
      if (!W) return;
      const b = $w('.cw-wins'), t = `${n} chat windows open`;
      b.classList.toggle('hidden', n < 2);
      b.querySelector('.cw-wins-n').textContent = n > 1 ? String(n) : '';
      if (b.title !== t) { b.title = t; b.setAttribute('aria-label', t); }
    },
    setOnClose: fn => { if (W) W.onClose = fn; },
    /** Its phone in the side panel (false: it has none to show here). */
    openPhone: x => !!W && W.dock.openPhone(x),
    /** Whether showing another chat in it loses nothing: no answer coming, nothing typed, attached or being edited, no voice. */
    idle: () => !!W && !W.run && !W.obs && !W.sending && !$w('.cw-in').value.trim() && !W.files.length && W.editing === null && !W.voice?.voiceMode && !W.voice?.dictating,
    voiceOff: () => W?.voice?.reset(),
    ctx: () => (W ? cctx() : null),
    /** Its button by the 💬 one: who, which chat, working or waiting for the person, answers that came while it was away. */
    status: () => {
      if (!W) return null;
      const rec = agentRec(W.agentId), label = W.session?.label && W.session.label !== 'New chat' && W.session.label !== 'New session' ? W.session.label : '';
      return { emoji: rec?.emoji || '🤖', name: rec?.name || 'Chat', title: label, working: !!(W.run || W.obs), waiting: waitingNow(), unread: W.unread, min: W.min };
    },
    /** What comes back with the page: its agent and chat, place, size, full screen or put away, the Sidebar, the side
     *  panel's tab, what was typed. */
    snapshot: () => {
      if (!W || !W.agentId) return null;
      const g = W.geo, box = $w('.chatwin'), draft = $w('.cw-in').value;
      return { a: W.agentId, s: me.sessionId(), ...(!W.session && W.newIn ? { p: W.newIn } : {}), ...(g && Number.isFinite(g.w) ? { g: { w: Math.round(g.w), h: Math.round(g.h), r: Math.round(g.r), b: Math.round(g.b) } } : {}),
        m: W.choice, ...(W.min ? { min: 1 } : {}), ...(box.classList.contains('side-hidden') ? { side: 1 } : {}), ...(W.dock?.isOpen() ? { dock: W.dock.tab() } : {}), ...(draft.trim() ? { d: draft.slice(0, 8000) } : {}) };
    },
  };
  return me;
}
