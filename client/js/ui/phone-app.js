// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's phone (docs/features/phone.md), as one component shown in the Agent Studio's Phone tab and in the chat
// window's side panel. Without a phone yet: connect a Twilio account (two fields), pick one of its numbers or buy one.
// With one: Messages (conversations, the agent's drafts to send or discard, a composer), Calls (missed, voicemail with
// its transcript and a player, call back), Contacts, a Keypad, and Settings (what reaches the agent, its replies, how
// calls are answered, notifications). The server decides everything (server/phone/); this asks and shows, and follows
// the 'phone' frames so a text that arrives shows at once.
import { bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';

const NAV = [
  { id: 'messages', label: 'Messages', icon: '💬' },
  { id: 'calls', label: 'Calls', icon: '📞' },
  { id: 'contacts', label: 'Contacts', icon: '👥' },
  { id: 'keypad', label: 'Keypad', icon: '⌨️' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];
const TEXT_MAX = 1600;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'];
const KEY_SUB = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '' };
const STATUS_WORD = { queued: 'Sending…', accepted: 'Sending…', sending: 'Sending…', sent: 'Sent', delivered: 'Delivered', read: 'Read', undelivered: 'Not delivered', failed: 'Failed', receiving: 'Arriving…' };
const CALL_WORD = { completed: 'Answered', 'no-answer': 'Missed', busy: 'Busy', failed: 'Failed', canceled: 'Cancelled', ringing: 'Ringing…', 'in-progress': 'On the call', queued: 'Calling…', initiated: 'Calling…' };

/** +15552010042 → (555) 201-0042 (as the server's prettyNumber). */
export const pretty = n => { const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(n || '')); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(n || ''); };
function when(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date(), day = 86400000;
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (new Date(now - day).toDateString() === d.toDateString()) return `Yesterday ${time}`;
  if (now - d < 6 * day) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
const span = m => (m >= 60 ? `${m / 60} h` : `${m} min`);
const secs = s => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`);
/** How many texts a message is sent as (GSM 160/153, else 70/67), for the composer's counter. */
function segments(t) {
  const gsm = /^[\n\r -~£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/.test(t);
  const one = gsm ? 160 : 70, many = gsm ? 153 : 67;
  return t.length <= one ? 1 : Math.ceil(t.length / many);
}
const initials = s => String(s || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '#';

/**
 * @param {HTMLElement} el  where the phone is drawn
 * @param {number} agentId
 * @param {{ compact?: boolean, toast?: (m: string, kind?: string) => void, onCounts?: (c: object) => void }} [o]
 */
export function mountPhone(el, agentId, { compact = false, toast = () => {}, onCounts = null } = {}) {
  const P = { st: null, view: 'messages', peer: null, threads: null, thread: null, calls: null, contacts: null, editing: null, keypad: '', compose: { to: '', body: '' },
    setup: { connection: null, numbers: null, buy: null, err: null, form: {} }, busy: false, err: null, open: new Set(), timer: null, seq: 0, alive: true, filter: '' };
  el.classList.add('ph-app'); el.classList.toggle('ph-compact', compact);
  const q = `agent=${agentId}`;
  const say = (m, bad = true) => { P.err = bad ? m : null; if (!bad && m) toast(m, 'good'); paint(); };

  // ---------------------------------------------------------------- reading
  async function load(what = P.view) {
    const my = ++P.seq;
    try {
      const st = await getJSON(`/api/phone?${q}`);
      if (!P.alive || my !== P.seq) return;
      P.st = st;
      onCounts?.(st.line ? st.counts : null);
      if (!st.line) { if (!P.setup.connection && st.accounts.length) P.setup.connection = (st.accounts.find(a => a.enabled) || st.accounts[0]).id; if (P.setup.connection && !P.setup.numbers) loadNumbers(); paint(); return; }
      if (what === 'messages' || what === 'compose') P.threads = (await getJSON(`/api/phone/threads?${q}`)).threads;
      else if (what === 'thread' && P.peer) P.thread = await getJSON(`/api/phone/thread?${q}&peer=${encodeURIComponent(P.peer)}`);
      else if (what === 'calls') P.calls = (await getJSON(`/api/phone/calls?${q}`)).calls;
      if (what === 'contacts' || what === 'compose' || what === 'contact' || !P.contacts) P.contacts = (await getJSON(`/api/phone/contacts?${q}`)).contacts;
      if (!P.alive || my !== P.seq) return;
    } catch (e) { if (P.alive && my === P.seq) P.err = e.message; }   // (an error stays until the next action or view: go() and act() clear it)
    paint();
  }
  async function loadNumbers() {
    const c = P.setup.connection;
    if (!c) return;
    P.setup.numbers = 'loading'; paint();
    try { P.setup.numbers = (await getJSON(`/api/phone/numbers?connection=${c}`)).numbers; P.setup.err = null; }
    catch (e) { P.setup.numbers = null; P.setup.err = e.message; }
    paint();
  }
  async function act(url, body, okMsg) {
    if (P.busy) return null;
    P.busy = true; P.err = null; paint();
    try { const r = await post(url, { agent: agentId, ...body }); if (okMsg) toast(okMsg, 'good'); return r || {}; }
    catch (e) { P.err = e.message; return null; }
    finally { P.busy = false; paint(); }
  }
  const go = (view, extra = {}) => { Object.assign(P, { view, err: null }, extra); paint(); load(view); };

  // ---------------------------------------------------------------- drawing
  function paint() {
    if (!P.alive) return;
    const st = P.st;
    let html;
    if (!st) html = `<div class="ph-empty">${P.err ? esc(P.err) : 'Opening the phone…'}</div>`;
    else if (!st.line) html = setupHtml(st);
    else html = `${headHtml(st)}<div class="ph-body" data-view="${P.view}">${P.err ? `<div class="ph-err" role="alert">${esc(P.err)}</div>` : ''}${viewHtml(st)}</div>${navHtml(st)}`;
    const keepScroll = el.querySelector('.ph-body')?.scrollTop ?? 0, atBottom = (() => { const b = el.querySelector('.ph-msgs'); return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 40; })();
    const focused = document.activeElement && el.contains(document.activeElement) ? { cls: document.activeElement.dataset.f, start: document.activeElement.selectionStart } : null;
    if (el._h === html) return;
    el._h = html; el.innerHTML = html;
    const body = el.querySelector('.ph-body'); if (body && P.view !== 'thread') body.scrollTop = keepScroll;
    const msgs = el.querySelector('.ph-msgs'); if (msgs && atBottom) msgs.scrollTop = msgs.scrollHeight;
    if (focused?.cls) { const f = el.querySelector(`[data-f="${focused.cls}"]`); if (f) { f.focus(); try { f.setSelectionRange(focused.start, focused.start); } catch { /* not text */ } } }
  }
  function headHtml(st) {
    const l = st.line, bad = l.state === 'error' || l.state === 'off';
    return `<header class="ph-head"><div class="ph-who"><span class="ph-av" aria-hidden="true">${esc(st.agent.emoji || '🤖')}</span><div><b>${esc(st.agent.name)}'s phone</b>
      <div class="ph-num" data-noicon>${esc(l.pretty)}</div></div></div>
      <div class="ph-sync${bad ? ' bad' : ''}" title="${esc(bad ? l.error || 'Not checking' : `Checked ${when(l.sync.at) || 'just now'}`)}"><span class="dot ${bad ? 'bad' : 'ok'}"></span>${bad ? 'Not connected' : 'Live'}</div>
      <button type="button" class="cw-ic ph-refresh" data-a="sync" title="Check for new texts and calls now" aria-label="Check for new texts and calls now"${P.busy ? ' disabled' : ''}>↻</button></header>
      ${controlHtml(st)}`;
  }
  /** Who handles the phone: the agent, or the person (the whole phone) - a switch, and a bar while the person has it. */
  function controlHtml(st) {
    const c = st.control || {}, h = c.human, name = esc(st.agent.name);
    const sw = `<div class="ph-ctl" role="radiogroup" aria-label="Who handles this phone">
      <button type="button" class="ph-ctlb${h ? '' : ' on'}" role="radio" aria-checked="${!h}" data-a="mode-agent" title="${name} reads its texts and answers as you set it">🤖 ${name}</button>
      <button type="button" class="ph-ctlb${h ? ' on' : ''}" role="radio" aria-checked="${!!h}" data-a="mode-human" title="You handle every text: ${name} doesn't read or answer them">👤 You</button></div>`;
    const bar = h ? `<div class="ph-human" role="status"><b>✋ You're handling ${name}'s phone.</b> It doesn't read or answer its texts.
      <span class="ph-hsub">${h.endsAt ? `Back to ${name} at ${esc(when(h.endsAt))} (${esc(span(c.handbackMinutes))} after your last text).` : 'Back to it only when you hand it back.'}</span>
      <button type="button" class="btn small" data-a="mode-agent">↩ Hand back to ${name}</button></div>` : '';
    return `<div class="ph-ctlrow">${sw}${!h && c.takeovers?.length ? `<span class="ph-hsub">You're handling ${c.takeovers.length} conversation${c.takeovers.length === 1 ? '' : 's'}</span>` : ''}</div>${bar}`;
  }
  function navHtml(st) {
    const n = { messages: st.counts.unread + st.counts.drafts, calls: st.counts.missed };
    const cur = P.view === 'thread' || P.view === 'compose' ? 'messages' : P.view === 'contact' ? 'contacts' : P.view;
    return `<nav class="ph-nav" role="tablist" aria-label="Phone">${NAV.map(t => `<button type="button" class="ph-tab${cur === t.id ? ' on' : ''}" role="tab" aria-selected="${cur === t.id}" data-go="${t.id}">
      <span class="ph-ti" aria-hidden="true">${t.icon}</span><span class="ph-tl">${t.label}</span>${n[t.id] ? `<span class="ph-badge">${n[t.id]}</span>` : ''}</button>`).join('')}</nav>`;
  }
  function viewHtml(st) {
    switch (P.view) {
      case 'thread': return threadHtml(st);
      case 'compose': return composeHtml();
      case 'calls': return callsHtml(st);
      case 'contacts': return contactsHtml();
      case 'contact': return contactHtml();
      case 'keypad': return keypadHtml(st);
      case 'settings': return settingsHtml(st);
      default: return threadsHtml(st);
    }
  }
  const nameOf = (num, fallback = null) => P.contacts?.find(c => c.number === num)?.name || fallback || pretty(num);

  // ---- setup: connect a Twilio account, pick or buy a number
  function setupHtml(st) {
    const S = P.setup, accts = st.accounts;
    const head = `<div class="ph-setup-h"><span class="ph-big" aria-hidden="true">📱</span><div><b>Give ${esc(st.agent.name)} a phone</b>
      <p class="hint">A real phone number from Twilio: ${esc(st.agent.name)} gets texts and calls, and you see everything here - contacts, texts, calls and voicemail.</p></div></div>`;
    const err = P.err || S.err ? `<div class="ph-err" role="alert">${esc(P.err || S.err)}</div>` : '';
    if (!accts.length || S.adding) {
      return `<div class="ph-setup">${head}${err}<div class="ph-card"><h5>1 · Connect your Twilio account</h5>
        <p class="hint">In <a href="https://console.twilio.com/" target="_blank" rel="noopener">Twilio's console</a>, the <b>Account info</b> box shows both. They're stored encrypted on this server and never shown again.</p>
        <label>Account SID<input class="input" data-f="sid" name="sid" placeholder="AC…" autocomplete="off" spellcheck="false" maxlength="34" value="${esc(S.form.sid || '')}"></label>
        <label>Auth Token<input class="input" data-f="tok" name="tok" type="password" autocomplete="new-password" spellcheck="false" maxlength="128" value="${esc(S.form.tok || '')}"></label>
        <details class="ph-more"${S.form.key ? ' open' : ''}><summary>Use an API key instead</summary><label>API key SID<input class="input" data-f="key" name="key" placeholder="SK…" autocomplete="off" spellcheck="false" maxlength="34" value="${esc(S.form.key || '')}"></label>
          <p class="hint">Then put the API key's secret in Auth Token.</p></details>
        <div class="row"><button type="button" class="btn primary" data-a="connect"${P.busy ? ' disabled' : ''}>${P.busy ? 'Connecting…' : 'Connect'}</button>${accts.length ? '<button type="button" class="btn" data-a="cancel-add">Cancel</button>' : ''}</div></div></div>`;
    }
    const pick = accts.length > 1 ? `<label>Twilio account<select class="input" data-f="conn">${accts.map(a => `<option value="${a.id}"${a.id === S.connection ? ' selected' : ''}>${esc(a.label)}${a.mine ? '' : ' (shared)'}${a.enabled ? '' : ' - off'}</option>`).join('')}</select></label>` : '';
    const nums = S.numbers === 'loading' ? '<p class="hint">Reading the account\'s numbers…</p>' : !S.numbers ? '' : !S.numbers.length ? '<p class="hint">This account has no numbers yet: buy one below.</p>'
      : `<div class="ph-numbers" role="radiogroup" aria-label="Numbers">${S.numbers.map(n => {
        const used = n.usedBy, on = S.pick === n.sid;
        return `<button type="button" class="ph-numopt${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-pick="${esc(n.sid)}"${used ? ' disabled' : ''}>
          <b data-noicon>${esc(n.pretty)}</b><span class="ph-numlab">${esc(n.label !== n.number ? n.label : '')}</span>
          <span class="ph-caps">${n.sms ? '<span class="tag">Texts</span>' : ''}${n.voice ? '<span class="tag">Calls</span>' : ''}${n.mms ? '<span class="tag">Pictures</span>' : ''}</span>
          ${used ? `<span class="ph-used">${esc(used.name)}'s phone</span>` : n.answeredBy ? `<span class="ph-used soft">Calls answered by ${esc(n.answeredBy)} (kept)</span>` : ''}</button>`;
      }).join('')}</div>`;
    const B = S.buy;
    const buy = `<details class="ph-more"${B ? ' open' : ''}><summary>Buy a new number</summary>
      <div class="row wrap"><select class="input" data-f="bcountry"><option value="US">United States</option><option value="CA">Canada</option></select>
        <select class="input" data-f="btype"><option value="local">Local</option><option value="tollfree">Toll-free</option></select>
        <input class="input ph-ac" data-f="barea" placeholder="Area code" inputmode="numeric" maxlength="4" value="${esc(B?.area || '')}">
        <button type="button" class="btn" data-a="search"${P.busy ? ' disabled' : ''}>Search</button></div>
      ${B?.list ? (B.list.length ? `<div class="ph-numbers">${B.list.map(n => `<div class="ph-numopt buy"><b data-noicon>${esc(n.pretty)}</b><span class="ph-numlab">${esc([n.locality, n.region].filter(Boolean).join(', '))}</span>
        <button type="button" class="btn small primary" data-buy="${esc(n.number)}">Buy</button></div>`).join('')}</div><p class="hint">Twilio charges your account for a number every month.</p>` : '<p class="hint">No numbers there: try another area code.</p>') : ''}</details>`;
    return `<div class="ph-setup">${head}${err}<div class="ph-card"><h5>Pick its number</h5>${pick}${nums}
      <div class="row"><button type="button" class="btn primary" data-a="attach"${!S.pick || P.busy ? ' disabled' : ''}>${P.busy ? 'Setting up…' : 'Use this number'}</button>
      <button type="button" class="btn linkish" data-a="add-account">Another Twilio account…</button></div>${buy}</div>
      <p class="hint">Texts from ${esc(st.agent.name)}'s contacts reach it; its replies wait for your OK. You can change both in its phone's settings.</p></div>`;
  }

  // ---- messages
  function threadsHtml() {
    if (!P.threads) return '<div class="ph-empty">Loading…</div>';
    const list = P.threads.length ? P.threads.map(t => {
      const name = t.contact?.name || t.pretty, last = t.last;
      return `<button type="button" class="ph-row${t.unread ? ' unread' : ''}" data-peer="${esc(t.peer)}"><span class="ph-face" aria-hidden="true">${t.contact ? esc(initials(t.contact.name)) : '#'}</span>
        <span class="ph-rmain"><span class="ph-rtop"><b data-noicon>${esc(name)}</b>${t.human ? '<span class="tag ph-you" title="You\'re handling this conversation">👤 You</span>' : ''}<time>${esc(when(last?.at))}</time></span>
        <span class="ph-rsub" data-noicon>${t.drafts ? '<span class="ph-draftmark">Draft ·</span> ' : ''}${last ? `${last.direction === 'out' ? 'You: ' : ''}${esc(last.body || '🖼️ Picture')}` : ''}</span></span>
        ${t.unread ? `<span class="ph-badge">${t.unread}</span>` : ''}</button>`;
    }).join('') : '<div class="ph-empty">No texts yet.</div>';
    return `<div class="ph-bar"><b>Messages</b><button type="button" class="btn small primary" data-a="new">✏️ New text</button></div><div class="ph-list">${list}</div>`;
  }
  function threadHtml(st) {
    const T = P.thread;
    if (!T || T.peer !== P.peer) return `<div class="ph-bar"><button type="button" class="cw-ic" data-a="back" aria-label="Back">←</button><b>${esc(nameOf(P.peer))}</b></div><div class="ph-empty">Loading…</div>`;
    const c = T.contact;
    const msgs = T.messages.map(m => {
      if (m.state === 'draft') {
        const ed = P.open.has(`edit-${m.id}`);
        return `<div class="ph-msg out draft" data-id="${m.id}"><div class="ph-draft-h">✏️ ${esc(st.agent.name)} wrote this - send it?</div>
          ${ed ? `<textarea class="input ph-draft-in" data-f="draft-${m.id}" maxlength="${TEXT_MAX}" rows="3">${esc(m.body)}</textarea>` : `<div class="ph-txt" data-noicon>${esc(m.body)}</div>`}
          <div class="ph-draft-a"><button type="button" class="btn small primary" data-send-draft="${m.id}">Send</button>
          ${ed ? '' : `<button type="button" class="btn small" data-edit-draft="${m.id}">Edit</button>`}<button type="button" class="btn small" data-discard="${m.id}">Discard</button></div></div>`;
      }
      const meta = m.direction === 'out' ? `${esc(STATUS_WORD[m.status] || (m.state === 'failed' ? 'Failed' : m.status || ''))}${m.origin === 'agent' ? ` · by ${esc(st.agent.name)}` : ''}` : '';
      return `<div class="ph-msg ${m.direction}${m.state === 'failed' ? ' failed' : ''}" data-id="${m.id}"><div class="ph-txt" data-noicon>${esc(m.body)}</div>
        ${m.media ? Array.from({ length: Math.min(m.media, 4) }, (_, i) => `<a class="ph-pic" href="/api/phone/media?${q}&message=${m.id}&i=${i}" target="_blank" rel="noopener"><img alt="Picture" loading="lazy" src="/api/phone/media?${q}&message=${m.id}&i=${i}"></a>`).join('') : ''}
        <div class="ph-meta"><time>${esc(when(m.at))}</time>${meta ? ` · ${meta}` : ''}${m.direction === 'in' && m.agentState === 'delivered' ? ` · ${esc(st.agent.name)} read it` : ''}</div>
        ${m.error ? `<div class="ph-why">${esc(m.error)}</div>` : ''}</div>`;
    }).join('');
    const body = P.compose.peer === P.peer ? P.compose.body : '';
    return `<div class="ph-bar"><button type="button" class="cw-ic" data-a="back" aria-label="Back to messages">←</button>
        <div class="ph-tw"><b data-noicon>${esc(c ? c.name : T.pretty)}</b>${c ? `<span class="ph-sub" data-noicon>${esc(T.pretty)}</span>` : ''}</div>
        ${T.control?.human ? '' : `<button type="button" class="btn small ph-take" data-take="${esc(T.peer)}" title="Handle this conversation yourself: ${esc(st.agent.name)} won't read or answer it">✋ Take over</button>`}
        <button type="button" class="cw-ic" data-dial="${esc(T.peer)}" title="Call" aria-label="Call">📞</button>
        ${c ? '' : `<button type="button" class="cw-ic" data-save="${esc(T.peer)}" title="Save as a contact" aria-label="Save as a contact">＋👤</button>`}</div>
      ${T.control?.human && !T.control.whole ? `<div class="ph-human" role="status"><b>✋ You're handling this conversation.</b> ${esc(st.agent.name)} won't read or answer it.
        <span class="ph-hsub">${T.control.endsAt ? `Back to ${esc(st.agent.name)} at ${esc(when(T.control.endsAt))} (${esc(span(st.control?.handbackMinutes || 120))} after your last text).` : 'Back to it only when you hand it back.'}</span>
        <button type="button" class="btn small" data-give="${esc(T.peer)}">↩ Hand back to ${esc(st.agent.name)}</button></div>` : ''}
      ${c?.blocked ? '<div class="ph-note">Blocked: their texts don\'t notify you or reach the agent.</div>' : T.control?.human ? '' : !c ? `<div class="ph-note">Not in ${esc(st.agent.name)}'s contacts${st.line.inbound === 'contacts' ? ': their texts don\'t reach it' : ''}.</div>` : ''}
      <div class="ph-msgs" aria-live="polite">${msgs || '<div class="ph-empty">No texts yet.</div>'}</div>
      ${c?.blocked ? '' : composer(body)}`;
  }
  function composer(body) {
    const n = body.length, seg = n ? segments(body) : 0;
    return `<div class="ph-compose"><textarea class="input" data-f="body" rows="2" maxlength="${TEXT_MAX}" placeholder="Text message" aria-label="Text message">${esc(body)}</textarea>
      <div class="ph-cfoot"><span class="ph-count">${n ? `${n}/${TEXT_MAX}${seg > 1 ? ` · ${seg} texts` : ''}` : ''}</span><button type="button" class="btn small primary" data-a="send"${!body.trim() || P.busy ? ' disabled' : ''}>Send</button></div></div>`;
  }
  function composeHtml() {
    const C = P.compose;
    const opts = (P.contacts || []).filter(c => !c.blocked).map(c => `<option value="${esc(c.pretty)}">${esc(c.name)}</option>`).join('');
    return `<div class="ph-bar"><button type="button" class="cw-ic" data-a="back" aria-label="Back">←</button><b>New text</b></div>
      <div class="ph-card"><label>To<input class="input" data-f="to" list="ph-dl-${agentId}" inputmode="tel" placeholder="Name or number" value="${esc(C.to)}" autocomplete="off"></label>
      <datalist id="ph-dl-${agentId}">${opts}</datalist></div>${composer(C.body)}`;
  }

  // ---- calls
  function callsHtml(st) {
    if (!P.calls) return '<div class="ph-empty">Loading…</div>';
    const ring = st.line.ringMe ? '' : `<div class="ph-note">To call from this phone, set <button type="button" class="linkish" data-go="settings">Ring me at</button>: your own phone rings first, then theirs.</div>`;
    const list = P.calls.length ? P.calls.map(c => {
      const name = c.contact?.name || c.pretty, open = P.open.has(`call-${c.id}`);
      const ic = c.direction === 'out' ? '↗' : c.missed ? '✕' : '↙';
      const what = c.voicemail ? `Voicemail · ${secs(c.recordingSeconds)}` : c.direction === 'out' ? (c.duration ? `Outgoing · ${secs(c.duration)}` : CALL_WORD[c.status] || c.status) : c.missed ? 'Missed' : `${CALL_WORD[c.status] || c.status}${c.duration ? ` · ${secs(c.duration)}` : ''}`;
      return `<div class="ph-call${c.missed ? ' missed' : ''}${c.read ? '' : ' unread'}"><button type="button" class="ph-row" data-call="${c.id}" aria-expanded="${open}">
        <span class="ph-face ${c.missed ? 'bad' : ''}" aria-hidden="true">${ic}</span><span class="ph-rmain"><span class="ph-rtop"><b data-noicon>${esc(name)}</b><time>${esc(when(c.at))}</time></span>
        <span class="ph-rsub">${esc(what)}${c.voicemail ? ' 🎙️' : ''}</span></span></button>
        ${open ? `<div class="ph-callx">${c.voicemail ? `<audio controls preload="none" src="/api/phone/voicemail?${q}&call=${c.id}"></audio>
          <div class="ph-tr">${c.transcript ? `<span class="hint">Transcript</span><div data-noicon>“${esc(c.transcript)}”</div>` : c.transcriptState === 'pending' || c.transcriptState === 'none' ? '<span class="hint">The transcript is on its way…</span>' : '<span class="hint">No transcript.</span>'}</div>` : ''}
          <div class="row wrap"><button type="button" class="btn small" data-dial="${esc(c.peer)}">📞 Call back</button><button type="button" class="btn small" data-text="${esc(c.peer)}">💬 Text</button>
          ${c.contact ? '' : `<button type="button" class="btn small" data-save="${esc(c.peer)}">＋ Save contact</button>`}</div></div>` : ''}</div>`;
    }).join('') : '<div class="ph-empty">No calls yet.</div>';
    return `<div class="ph-bar"><b>Calls</b>${st.counts.missed ? '<button type="button" class="btn small" data-a="calls-read">Mark seen</button>' : ''}</div>${ring}<div class="ph-list">${list}</div>`;
  }

  // ---- contacts
  function contactsHtml() {
    if (!P.contacts) return '<div class="ph-empty">Loading…</div>';
    const f = P.filter.trim().toLowerCase();
    const list = P.contacts.filter(c => !f || c.name.toLowerCase().includes(f) || c.number.includes(f.replace(/\D/g, '') || '~'));
    return `<div class="ph-bar"><b>Contacts</b><button type="button" class="btn small primary" data-a="add-contact">＋ Add</button></div>
      ${P.contacts.length > 6 ? `<div class="ph-card slim"><input class="input" data-f="filter" placeholder="Search contacts" value="${esc(P.filter)}" aria-label="Search contacts"></div>` : ''}
      <div class="ph-list">${list.length ? list.map(c => `<button type="button" class="ph-row" data-contact="${c.id}"><span class="ph-face" aria-hidden="true">${esc(initials(c.name))}</span>
        <span class="ph-rmain"><span class="ph-rtop"><b data-noicon>${esc(c.name)}</b>${c.blocked ? '<span class="tag bad">Blocked</span>' : ''}</span><span class="ph-rsub" data-noicon>${esc(c.pretty)}${c.note ? ` · ${esc(c.note)}` : ''}</span></span></button>`).join('')
        : `<div class="ph-empty">${P.contacts.length ? 'Nobody matches.' : 'No contacts yet. Texts from contacts reach the agent; from anyone else, only you see them.'}</div>`}</div>`;
  }
  function contactHtml() {
    const c = P.editing || {};
    return `<div class="ph-bar"><button type="button" class="cw-ic" data-a="back-contacts" aria-label="Back to contacts">←</button><b>${c.id ? 'Edit contact' : 'New contact'}</b></div>
      <div class="ph-card"><label>Name<input class="input" data-f="cname" maxlength="80" value="${esc(c.name || '')}" autocomplete="off"></label>
      <label>Phone number<input class="input" data-f="cnum" inputmode="tel" maxlength="24" value="${esc(c.pretty || c.number || '')}" placeholder="(555) 123-4567 or +44…"></label>
      <label>Note (the agent sees it)<textarea class="input" data-f="cnote" rows="2" maxlength="500">${esc(c.note || '')}</textarea></label>
      <label class="check"><input type="checkbox" data-f="cblock"${c.blocked ? ' checked' : ''}> Block: their texts don't notify you or reach the agent</label>
      <div class="row wrap"><button type="button" class="btn primary" data-a="save-contact"${P.busy ? ' disabled' : ''}>Save</button>
      ${c.id ? `<button type="button" class="btn" data-text="${esc(c.number)}">💬 Text</button><button type="button" class="btn" data-dial="${esc(c.number)}">📞 Call</button>
        <button type="button" class="btn danger" data-a="del-contact">Delete</button>` : ''}</div></div>`;
  }

  // ---- keypad
  function keypadHtml(st) {
    return `<div class="ph-pad"><div class="ph-display" aria-live="polite" data-noicon>${esc(P.keypad ? (/^\+?1?\d{10}$/.test(P.keypad.replace(/\D/g, '')) && !P.keypad.startsWith('+') ? pretty(`+1${P.keypad.replace(/\D/g, '').slice(-10)}`) : P.keypad) : '')}<span class="ph-caret"></span></div>
      <div class="ph-keys">${KEYS.map(k => `<button type="button" class="ph-key${k === '⌫' ? ' del' : ''}" data-key="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}${KEY_SUB[k] !== undefined ? `<small>${KEY_SUB[k]}</small>` : ''}</button>`).join('')}</div>
      <div class="ph-padact"><button type="button" class="btn ph-callbtn" data-dial-pad${!P.keypad || P.busy ? ' disabled' : ''} title="${st.line.ringMe ? `Rings you at ${esc(pretty(st.line.ringMe))} first` : 'Set Ring me at in Settings first'}">📞 Call</button>
      <button type="button" class="btn" data-text-pad${!P.keypad ? ' disabled' : ''}>💬 Text</button></div>
      <p class="hint">${st.line.ringMe ? `A call rings your phone, ${esc(pretty(st.line.ringMe))}, first; they see ${esc(st.line.pretty)}.` : 'Set <b>Ring me at</b> in Settings to make calls from this number.'}</p></div>`;
  }

  // ---- settings
  function settingsHtml(st) {
    const l = st.line, name = esc(st.agent.name), n = st.number || {};
    const radio = (key, val, label, help = '') => `<label class="ph-opt"><input type="radio" name="${key}-${agentId}" data-set="${key}" value="${val}"${l[key] === val ? ' checked' : ''}><span><b>${label}</b>${help ? `<small>${help}</small>` : ''}</span></label>`;
    return `<div class="ph-card"><h5>Texts</h5><p class="hint">Which texts reach ${name} (you always see every one here):</p>
        ${radio('inbound', 'contacts', 'From its contacts', 'Recommended. Strangers\' texts stay in this phone for you.')}
        ${radio('inbound', 'anyone', 'From anyone', `Anyone who has the number can write to ${name}. Their words are marked as information, never instructions - still, an agent with tools on real machines is safer with contacts only.`)}
        ${radio('inbound', 'off', 'None', `${name} doesn't read its texts.`)}
        <p class="hint">${name}'s answers to them:</p>
        ${radio('replies', 'draft', 'Drafts for my OK', 'You get a notification; Send, edit or discard each one.')}
        ${radio('replies', 'auto', 'Send them', 'Sent at once - only ever to a contact; anyone else gets a draft.')}
        ${radio('replies', 'off', 'No replies', 'It reads them and tells you what matters.')}
        <p class="hint">Texts ${name} starts itself (its tools):</p>
        ${radio('agentSend', 'draft', 'Drafts for my OK')}${radio('agentSend', 'auto', 'Send them (to contacts)')}${radio('agentSend', 'off', 'Not allowed')}
        <label>When you take over a conversation or the phone, ${name} gets it back<select class="input" data-set-num="handbackMinutes">${[[30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [1440, '24 hours'], [0, '']].map(([m, lab]) => `<option value="${m}"${(st.control?.handbackMinutes ?? 120) === m ? ' selected' : ''}>${m ? `${lab} after your last text` : 'Only when you hand it back'}</option>`).join('')}</select></label>
        <p class="hint">Each text you send restarts the time, so it stays yours while you're texting.</p>
        ${n.textsTo ? `<div class="ph-note">Twilio also sends this number's texts to <b>${esc(n.textsTo)}</b>. If nothing should answer them there, <button type="button" class="linkish" data-a="texts-direct">stop that</button>.</div>` : ''}</div>
      <div class="ph-card"><h5>Calls</h5>
        ${radio('calls', 'keep', 'As they are in Twilio', n.answeredBy ? `Answered by ${esc(n.answeredBy)} today.` : 'Nothing answers them today.')}
        ${radio('calls', 'forward', 'Ring a phone', 'Then voicemail if nobody answers.')}
        ${radio('calls', 'voicemail', 'Voicemail', 'A greeting, then a message with its transcript.')}
        ${l.calls === 'forward' || P.open.has('fwd') ? `<div class="row wrap"><label>Ring<input class="input" data-f="fwd" inputmode="tel" value="${esc(l.forwardTo ? pretty(l.forwardTo) : '')}" placeholder="(555) 123-4567"></label>
          <label>for<select class="input" data-f="ringsec">${[10, 15, 20, 25, 30, 40, 60].map(s => `<option value="${s}"${l.ringSeconds === s ? ' selected' : ''}>${s} s</option>`).join('')}</select></label></div>
          <label class="check"><input type="checkbox" data-f="vm"${l.voicemail ? ' checked' : ''}> Voicemail when nobody answers</label>` : ''}
        ${l.calls !== 'keep' ? `<label>Greeting<input class="input" data-f="greet" maxlength="300" value="${esc(l.greeting)}" placeholder="You have reached ${name}. Please leave a message after the tone."></label>` : ''}
        ${l.calls === 'forward' || l.calls === 'voicemail' || P.open.has('fwd') ? `<div class="row"><button type="button" class="btn small primary" data-a="save-calls"${P.busy ? ' disabled' : ''}>Save call settings</button></div>` : ''}
        <label class="check"><input type="checkbox" data-set-bool="callsToAgent"${l.callsToAgent ? ' checked' : ''}> Tell ${name} about missed calls and voicemail</label>
        <label>Ring me at (calls you make from this phone ring you first)<span class="row"><input class="input" data-f="ringme" inputmode="tel" value="${esc(l.ringMe ? pretty(l.ringMe) : '')}" placeholder="Your phone">
          <button type="button" class="btn small" data-a="save-ringme">Save</button></span></label></div>
      <div class="ph-card"><h5>Notifications</h5><label class="check"><input type="checkbox" data-set-bool="notify"${l.notify ? ' checked' : ''}> Tell me about new texts, missed calls, voicemail and ${name}'s drafts</label>
        <p class="hint">On every device where notifications are on (the bell, then Notifications on this device).</p></div>
      <div class="ph-card"><h5>The number</h5><p class="hint">${esc(l.pretty)} · ${esc(st.account?.label || 'Twilio')}.</p>
        ${st.chats ? `<label>${name} reads its texts in<select class="input" data-f="chat">${st.chats.some(c => c.id === l.sessionId) ? '' : '<option value="" selected>(a chat that was deleted - pick one)</option>'}${st.chats.map(c => `<option value="${c.id}"${c.id === l.sessionId ? ' selected' : ''}>${esc(c.label || 'Chat')}</option>`).join('')}<option value="new">A new chat “📱 Phone”</option></select></label>
          <p class="hint">Your chats with ${name}: its texts arrive there as messages, and you read along in the chat window. A chat it already works in gives it that context.</p>` : ''}
        <div class="row wrap">${st.chats ? '' : '<button type="button" class="btn small" data-a="new-chat">Start a new phone chat</button>'}
        <button type="button" class="btn small danger" data-a="detach">Remove the phone</button></div>
        <p class="hint">Removing it keeps the number in your Twilio account (calls answered as before); its texts and calls here go.</p></div>`;
  }

  // ---------------------------------------------------------------- doing
  const field = f => el.querySelector(`[data-f="${f}"]`);
  const armed = (b, text) => {
    if (b.dataset.armed) return true;
    b.dataset.armed = '1'; const was = b.innerHTML; b.textContent = text; b.classList.add('armed');
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.innerHTML = was; b.classList.remove('armed'); } }, 3500);
    return false;
  };
  const toNumber = s => {
    const t = String(s || '').trim(), c = P.contacts?.find(x => x.name.toLowerCase() === t.toLowerCase() || x.pretty === t);
    if (c) return c.number;
    const d = t.replace(/[^\d+]/g, '');
    return d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : d;
  };
  async function setLine(patch, msg) { const r = await act('/api/phone/settings', patch, msg); if (r && r.line) { P.st = r; onCounts?.(r.counts); paint(); } return r; }
  async function onClick(e) {
    const t = e.target.closest('button, [data-peer], [data-call], [data-contact]');
    if (!t || !el.contains(t)) return;
    const d = t.dataset;
    if (d.go) return go(d.go);
    if (d.peer) return go('thread', { peer: d.peer, thread: null });
    if (d.text) return go('thread', { peer: d.text, thread: null });
    if (d.call) { const k = `call-${d.call}`; P.open.has(k) ? P.open.delete(k) : P.open.add(k); return paint(); }
    if (d.contact) { P.editing = P.contacts.find(c => c.id === Number(d.contact)) || null; return go('contact'); }
    if (d.save) { P.editing = { number: d.save, pretty: pretty(d.save) }; return go('contact'); }
    if (d.pick) { P.setup.pick = d.pick; return paint(); }
    if (d.key) { P.keypad = d.key === '⌫' ? P.keypad.slice(0, -1) : (P.keypad + d.key).slice(0, 20); return paint(); }
    if ('dialPad' in d) return dial(toNumber(P.keypad));
    if ('textPad' in d) return go('thread', { peer: toNumber(P.keypad), thread: null });
    if (d.dial) return dial(d.dial);
    if (d.buy) { if (!armed(t, 'Tap again to buy (monthly charge)')) return; const r = await act('/api/phone/buy', { connection: P.setup.connection, number: d.buy }, 'Bought - it\'s the agent\'s phone now'); if (r) { P.st = r; load('messages'); } return; }
    if (d.sendDraft) {
      const ed = field(`draft-${d.sendDraft}`);
      const r = await act('/api/phone/drafts/send', { id: Number(d.sendDraft), ...(ed ? { body: ed.value } : {}) }, 'Sent');
      if (r) { P.open.delete(`edit-${d.sendDraft}`); load('thread'); } return;
    }
    if (d.editDraft) { P.open.add(`edit-${d.editDraft}`); return paint(); }
    if (d.take) { const r = await act('/api/phone/takeover', { peer: d.take, on: true }, `You're handling this conversation - ${P.st.agent.name} won't answer it`); if (r?.line) { P.st = r; load('thread'); } return; }
    if (d.give) { const r = await act('/api/phone/takeover', { peer: d.give, on: false }, `${P.st.agent.name} has this conversation back`); if (r?.line) { P.st = r; load('thread'); } return; }
    if (d.discard) { const r = await act('/api/phone/drafts/discard', { id: Number(d.discard) }, 'Discarded'); if (r) load('thread'); return; }
    switch (d.a) {
      case 'mode-human': case 'mode-agent': {
        const human = d.a === 'mode-human';
        if (!!P.st?.control?.human === human) return;
        const r = await act('/api/phone/control', { mode: human ? 'human' : 'agent' }, human ? `You're handling every text - ${P.st.agent.name} won't read or answer them` : `${P.st.agent.name} has its phone back`);
        if (r?.line) { P.st = r; load(); } return;
      }
      case 'sync': { const r = await act('/api/phone/sync', {}); if (r && r.line) { P.st = r; load(); } return; }
      case 'back': return go('messages', { peer: null, thread: null });
      case 'back-contacts': return go('contacts');
      case 'new': P.compose = { to: '', body: '' }; return go('compose');
      case 'send': return send();
      case 'calls-read': { await act('/api/phone/calls/read', {}); return load('calls'); }
      case 'add-contact': P.editing = null; return go('contact');
      case 'save-contact': {
        const r = await act('/api/phone/contacts', { id: P.editing?.id, name: field('cname').value, number: field('cnum').value, note: field('cnote').value, blocked: field('cblock').checked }, 'Saved');
        if (r) { P.contacts = null; P.editing = r.contact; go(P.peer && P.peer === r.contact.number ? 'thread' : 'contacts'); } return;
      }
      case 'del-contact': { if (!armed(t, 'Tap again to delete')) return; const r = await act('/api/phone/contacts/remove', { id: P.editing.id }, 'Deleted'); if (r) { P.contacts = null; go('contacts'); } return; }
      case 'save-calls': {
        const patch = { calls: el.querySelector(`[data-set="calls"]:checked`)?.value || P.st.line.calls };
        if (field('fwd')) patch.forwardTo = field('fwd').value;
        if (field('ringsec')) patch.ringSeconds = Number(field('ringsec').value);
        if (field('vm')) patch.voicemail = field('vm').checked;
        if (field('greet')) patch.greeting = field('greet').value;
        const r = await setLine(patch, patch.calls === 'keep' ? 'Calls are answered as before' : 'Saved - set up in your Twilio account');
        if (r) P.open.delete('fwd'); return;
      }
      case 'save-ringme': return setLine({ ringMe: field('ringme').value }, 'Saved');
      case 'texts-direct': { const r = await act('/api/phone/texts-direct', {}, 'Twilio now only keeps its texts for this phone'); if (r?.line) { P.st = r; paint(); } return; }
      case 'new-chat': return setLine({ session: 'new' }, 'Its texts go to a new phone chat');
      case 'detach': { if (!armed(t, 'Tap again to remove the phone')) return; const r = await act('/api/phone/detach', {}, 'The phone is removed'); if (r) { P.setup = { connection: null, numbers: null, buy: null, err: null, form: {} }; P.threads = P.calls = P.contacts = null; P.view = 'messages'; load(); } return; }
      case 'connect': return connect();
      case 'add-account': P.setup.adding = true; return paint();
      case 'cancel-add': P.setup.adding = false; return paint();
      case 'attach': { const r = await act('/api/phone/attach', { connection: P.setup.connection, numberSid: P.setup.pick }, 'It\'s the agent\'s phone now'); if (r && r.line) { P.st = r; P.view = 'messages'; P.threads = null; paint(); setTimeout(() => load('messages'), 1500); } return; }
      case 'search': {
        P.setup.buy = { area: field('barea').value.trim(), list: null };
        try { P.setup.buy.list = (await getJSON(`/api/phone/available?connection=${P.setup.connection}&country=${field('bcountry').value}&type=${field('btype').value}&areaCode=${encodeURIComponent(P.setup.buy.area)}`)).numbers; P.setup.err = null; }
        catch (err) { P.setup.err = err.message; }
        return paint();
      }
      default:
    }
  }
  async function connect() {
    const sid = field('sid').value.trim(), tok = field('tok').value.trim(), key = field('key')?.value.trim() || '';
    if (!/^AC[0-9a-f]{32}$/i.test(sid)) return say('The Account SID starts with AC and has 34 characters');
    if (tok.length < 16) return say('Paste the Auth Token too');
    if (P.busy) return;
    P.busy = true; P.err = null; paint();
    try {
      const c = await post('/api/connections', { kind: 'twilio', label: 'Twilio', scope: 'account', config: { accountSid: sid, ...(key ? { apiKeySid: key } : {}) }, secrets: { authToken: tok } });
      const t = await post('/api/connections/test', { id: c.id });
      if (t && t.ok === false) { await post('/api/connections/remove', { id: c.id }).catch(() => {}); throw new Error(`${t.error}${t.fix ? ` - ${t.fix}` : ''}`); }
      toast(t?.detail || 'Connected', 'good');
      P.setup = { connection: c.id, numbers: null, buy: null, err: null, adding: false, form: {} };
    } catch (err) { P.err = err.message; }
    finally { P.busy = false; paint(); }
    load();
  }
  async function send() {
    const box = field('body'), body = box?.value || '';
    const to = P.view === 'compose' ? toNumber(field('to').value) : P.peer;
    if (!to) return say('Who is it to?');
    if (!body.trim()) return;
    const r = await act('/api/phone/send', { to, body });
    if (!r) return;
    P.compose = { to: '', body: '' };
    if (P.view === 'compose') return go('thread', { peer: r.message?.peer || to, thread: null });
    load('thread');
  }
  async function dial(num) {
    if (!P.st?.line?.ringMe) return go('settings', { err: 'Set "Ring me at" first: your own phone rings, then theirs.' });
    const r = await act('/api/phone/dial', { to: num });
    if (r) toast(`Calling you at ${r.ringing} - pick up to be connected to ${nameOf(num)}`, 'good');
  }
  function onInput(e) {
    const f = e.target.dataset.f;
    if (f === 'body') {
      if (P.view === 'compose') P.compose.body = e.target.value; else P.compose = { ...P.compose, peer: P.peer, body: e.target.value };
      const n = e.target.value.length, s = n ? segments(e.target.value) : 0, c = el.querySelector('.ph-count'), b = el.querySelector('[data-a="send"]');
      if (c) c.textContent = n ? `${n}/${TEXT_MAX}${s > 1 ? ` · ${s} texts` : ''}` : '';
      if (b) b.disabled = !e.target.value.trim() || P.busy;
    } else if (f === 'to') P.compose.to = e.target.value;
    else if (f === 'sid' || f === 'tok' || f === 'key') P.setup.form[f] = e.target.value;   // (kept through a refusal: nothing to type again)
    else if (f === 'filter') { P.filter = e.target.value; const pos = e.target.selectionStart; el._h = null; paint(); const x = field('filter'); if (x) { x.focus(); x.setSelectionRange(pos, pos); } }
  }
  async function onChange(e) {
    const t = e.target, d = t.dataset;
    if (d.f === 'conn') { P.setup.connection = Number(t.value); P.setup.numbers = null; P.setup.pick = null; return loadNumbers(); }
    if (d.f === 'chat' && t.value) return setLine({ session: t.value === 'new' ? 'new' : Number(t.value) }, t.value === 'new' ? 'Its texts go to a new phone chat' : 'Its texts go to that chat now');
    if (d.set) {
      if (d.set === 'calls') {
        if (t.value === 'keep') return setLine({ calls: 'keep' }, 'Calls are answered as before');
        if (t.value === 'voicemail') return setLine({ calls: 'voicemail' }, 'Voicemail is on - set up in your Twilio account');
        P.open.add('fwd'); el._h = null; return paint();
      }
      return setLine({ [d.set]: t.value }, 'Saved');
    }
    if (d.setBool) return setLine({ [d.setBool]: t.checked }, 'Saved');
    if (d.setNum) return setLine({ [d.setNum]: Number(t.value) }, 'Saved');
  }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.dataset.f === 'body' && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); }
    if (P.view === 'keypad' && !e.target.closest('input, textarea')) {
      if (/^[0-9+]$/.test(e.key)) { P.keypad = (P.keypad + e.key).slice(0, 20); paint(); }
      else if (e.key === 'Backspace') { P.keypad = P.keypad.slice(0, -1); paint(); }
    }
  }
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', onKey);
  // a text, a call, a draft arriving: what is shown is read again (a few at once read once)
  const onFrame = m => {
    if (!m || Number(m.agent) !== Number(agentId)) return;
    clearTimeout(P.timer);
    P.timer = setTimeout(() => load(P.view === 'thread' && m.peer && m.peer !== P.peer ? 'messages-bg' : P.view), 250);
  };
  const unFrame = bus.on('msg:phone', onFrame);
  load();
  return {
    /** Shows a conversation (a notification's), the calls, or a view. */
    show(view, arg = null) { if (view === 'thread' && arg) go('thread', { peer: arg, thread: null }); else go(view); },
    refresh: () => load(),
    destroy() { P.alive = false; clearTimeout(P.timer); unFrame(); el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); el.removeEventListener('keydown', onKey); el.innerHTML = ''; el._h = null; el.classList.remove('ph-app', 'ph-compact'); },
  };
}
