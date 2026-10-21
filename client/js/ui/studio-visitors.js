// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Visitors tab (docs/features/CHAT.md §14.3; 2026-10-08): what others - players, or anyone
// choosing it on the map - get when they talk with it in the city: its job (Work: the job brief and what it knows,
// never its work notes), itself as a resident (Life), or only a greeting. Then everyone who did - each conversation, to
// read - and the players and agents blocked from talking with any of its owner's agents. A conversation's limits are the
// city admin's (Settings); the server keeps to all of this (server/agent-talk/), this only asks and shows.
import { S } from '../core/state.js';
import { getJSON } from '../core/net.js';
import { esc } from '../core/util.js';
import { ago } from './mind.js';

const TALKS = new Set(['models', 'agentapi']);   // (the brains that take a stranger's words safely: server/agent-talk/talk.js)
/** What others get, in a word (the Overview's chip). */
export const PUBLIC_WORDS = { work: 'Work', life: 'Life', greet: 'Greets only' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mins = ms => Math.max(1, Math.round(ms / 60000));

export async function visitorsTab(C, body, live) {
  const r = C.rec();
  const [data, work, bl] = await Promise.all([C.get('talks'), C.get('work'), C.get('blocks')]);
  if (!live()) return;
  if (!data || data.error) { body.innerHTML = `<p class="hint">${esc(data?.error || 'Not available.')}</p>`; return; }
  const st = C.st.visitors ||= { open: null, read: new Map() };
  const name = esc(r.name), conn = r.connection, L = data.limits, mode = data.publicMode, blocks = bl?.blocks || [];
  const b = work && !work.error ? work.brief : null, briefed = !!(b && (b.instructions || b.knowledge || b.company || work.files?.length));
  // what it can be asked: by its brain - the Mind takes all three; a connected agent's platform answers for itself; one
  // with tools on real machines, or none, only greets
  const kinds = !conn ? null : conn.kind === 'models' ? ['work', 'life', 'greet'] : conn.kind === 'agentapi' ? ['life', 'greet'] : null;
  const OPTS = {
    work: ['💼', 'Work', 'Its job: the brief, its instructions and what it knows (the Work tab). Never your work notes, your chats, its money or its life in the city.'],
    life: conn?.kind === 'agentapi' ? ['💬', 'Talks with them', `${esc(conn.label)} answers them as a visitor, the way its platform does.`]
      : ['🏠', 'Life', 'As itself, a resident of the city: its day, its plans, the people it knows. Never your work or your chats.'],
    greet: ['👋', 'Just a greeting', 'A hello to whoever stops by: no conversations.'],
  };
  // (each choice a button of text alone: a button inside a button breaks the page's layout)
  const choice = kinds ? `<div class="vt-modes" role="radiogroup" aria-label="When others talk with ${name}">${kinds.map(k => {
    const [ic, label, text] = OPTS[k], on = mode === k || (k === 'life' && !kinds.includes(mode));
    return `<button type="button" class="vt-mode${on ? ' on' : ''}" data-mode="${k}" role="radio" aria-checked="${on}"><span class="vt-mi" aria-hidden="true">${ic}</span>
      <span class="vt-mt"><b>${label}</b><small>${text}</small></span></button>`;
  }).join('')}</div>${kinds.includes('work') && !briefed ? `<p class="wk-note vt-nobrief">${name} has no job brief yet: at Work it could only say so. Write one in <button type="button" class="linkish" data-go="work">Work</button>.</p>` : ''}`
    : `<p class="wk-note">${!conn ? `${name} has no brain yet, so it greets passers-by. Give it one in <button type="button" class="linkish" data-go="brain">Brain</button>.`
      : `${name} thinks on <b>${esc(conn.label)}</b>, which has tools on real machines: it never gets a stranger's words, so it only greets passers-by.`}</p>`;
  const off = data.why === 'talk_off' ? `<p class="wk-note">Talking with others' agents is switched off in this city for now (its admin's setting): everyone gets a greeting.</p>` : '';
  const convs = data.conversations || [];
  const rows = convs.map(c => {
    const open = st.open === c.id, msgs = open ? st.read.get(c.id) : null;
    return `<li class="vt-c${open ? ' open' : ''}${c.blocked ? ' blocked' : ''}">
      <div class="vt-row"><button type="button" class="vt-who" data-open="${c.id}" aria-expanded="${open}"><span class="vt-car" aria-hidden="true">${open ? '▾' : '▸'}</span><b>${esc(c.account.name)}</b>
        <small>${plural(c.messages, 'message')} · ${ago(c.updated || c.started)}</small>${c.blocked ? '<span class="vt-tag">Blocked</span>' : ''}</button>
        <button type="button" class="btn small vt-blk" data-account="${c.account.id}" data-on="${!c.blocked}">${c.blocked ? 'Unblock' : 'Block'}</button></div>
      ${open ? `<div class="vt-thread">${!msgs ? '<p class="hint">Reading it…</p>' : msgs.error ? `<p class="hint bad">${esc(msgs.error)}</p>`
        : msgs.map(m => `<p class="vt-m ${m.role === 'user' ? 'them' : 'it'}"><b>${m.role === 'user' ? esc(c.account.name) : name}</b><span>${esc(m.text)}</span></p>`).join('') || '<p class="hint">Nothing in it.</p>'}</div>` : ''}</li>`;
  }).join('');
  // other agents it may be kept from: everyone else's, not already blocked
  const blockedAgents = new Set(blocks.filter(x => x.agent).map(x => x.agent.id));
  const others = (S.agentList || []).filter(a => !a.mine && a.id !== r.id && !blockedAgents.has(a.id)).sort((a, z) => a.name.localeCompare(z.name));
  body.innerHTML = `<div class="wk vt">
    <p class="hint wk-intro">When someone else - a player, or anyone choosing ${name} on the map - talks with it, it answers in its speech bubble, to them alone. You choose what they get; you read every conversation, and block whom you choose.</p>
    <div class="st-sec"><div class="st-sec-h"><h4>🛎️ When others talk with ${name}</h4></div>${off}${choice}
      ${L ? `<p class="hint vt-lim">Each conversation: up to ${plural(L.maxMessages, 'message')} of ${L.maxChars} characters, cleared ${mins(L.windowMs)} minutes after its first message - the city's limits, against misuse and runaway cost.</p>` : ''}</div>
    <div class="st-sec"><div class="st-sec-h"><h4>💬 Conversations with others</h4><span class="st-pill">${convs.length}</span><button type="button" class="btn small icon vt-ref" data-c="refresh" title="Look again" aria-label="Look again">↻</button></div>
      <p class="hint">Everyone who talked with ${name} in the last 30 days. Only you see them.</p>
      ${rows ? `<ul class="vt-list">${rows}</ul>` : '<p class="hint dim">Nobody yet.</p>'}</div>
    <div class="st-sec"><div class="st-sec-h"><h4>🔒 Blocked</h4><span class="st-pill">${blocks.length}</span></div>
      <p class="hint">Blocked players can't talk with any of your agents; your agents don't stop to chat with blocked agents.</p>
      ${blocks.length ? `<ul class="wk-files vt-blocks">${blocks.map(x => `<li class="wk-file"><span class="wk-fi" aria-hidden="true">${x.account ? '🧍' : '🤖'}</span><span>${esc((x.account || x.agent).name)}</span>
        <small>${x.account ? 'player' : 'agent'} · ${ago(x.created)}</small><button type="button" class="btn small" ${x.account ? `data-unblock-account="${x.account.id}"` : `data-unblock-agent="${x.agent.id}"`}>Unblock</button></li>`).join('')}</ul>` : ''}
      ${others.length ? `<div class="wk-add"><select class="input vt-pick" aria-label="An agent to block"><option value="">Block an agent…</option>${others.map(a => `<option value="${a.id}">${esc(a.emoji || '🤖')} ${esc(a.name)}</option>`).join('')}</select>
        <button type="button" class="btn small" data-c="block-agent" disabled>Block</button></div>` : ''}</div>
  </div>`;
  const q = s => body.querySelector(s);
  const again = (...keys) => { C.drop(...keys); C.repaint(); };
  body.querySelectorAll('[data-go]').forEach(x => { x.onclick = e => { e.stopPropagation(); C.go(x.dataset.go); }; });
  body.querySelectorAll('[data-mode]').forEach(x => {
    x.onclick = async () => {
      const k = x.dataset.mode;
      if (k === mode || (k === 'life' && !kinds.includes(mode))) return;
      const res = await C.call('/api/agent-work', { agent: C.id, publicMode: k });
      if (!res) return;
      C.toast(k === 'work' ? `Others get ${r.name} at work now` : k === 'greet' ? `${r.name} only greets others now` : `Others get ${r.name} as itself now`);
      const chip = C.chips?.find(x => x.tab === 'visitors');   // (the header's chip says it at once)
      if (chip) { chip.html = `🛎️ Visitors: ${conn.kind === 'agentapi' && k !== 'greet' ? 'Talks' : PUBLIC_WORDS[k]}`; C.head(); }
      again('talks', 'work');
    };
  });
  body.querySelectorAll('[data-open]').forEach(x => {
    x.onclick = async () => {
      const id = Number(x.dataset.open);
      st.open = st.open === id ? null : id;
      C.repaint();
      if (st.open !== id || st.read.has(id)) return;
      let m;
      try { m = (await getJSON(`/api/agent-talk/conversation?agent=${C.id}&session=${id}`)).messages; } catch (e) { m = { error: e.message }; }
      st.read.set(id, m);
      if (C.st.visitors === st && st.open === id) C.repaint();
    };
  });
  const block = async (what, on) => { if (await C.call('/api/agent-talk/block', { agent: C.id, ...what, on })) again('talks', 'blocks'); };
  body.querySelectorAll('.vt-blk').forEach(x => {
    x.onclick = () => { const on = x.dataset.on === 'true'; if (on && !C.armed(x, 'Block?')) return; block({ account: Number(x.dataset.account) }, on); };
  });
  body.querySelectorAll('[data-unblock-account]').forEach(x => { x.onclick = () => block({ account: Number(x.dataset.unblockAccount) }, false); });
  body.querySelectorAll('[data-unblock-agent]').forEach(x => { x.onclick = () => block({ other: Number(x.dataset.unblockAgent) }, false); });
  const pick = q('.vt-pick');
  if (pick) {
    const btn = q('[data-c="block-agent"]');
    pick.onchange = () => { btn.disabled = !pick.value; };
    btn.onclick = () => { if (pick.value) block({ other: Number(pick.value) }, true); };
  }
  q('[data-c="refresh"]').onclick = () => { st.read.clear(); again('talks', 'blocks'); };
}

/** Its conversations with others and its owner's blocks, for the Studio's data (agent-studio.js LOAD). */
export const loadTalks = id => getJSON(`/api/agent-talk/conversations?agent=${id}`);
export const loadBlocks = id => getJSON(`/api/agent-talk/blocks?agent=${id}`);
