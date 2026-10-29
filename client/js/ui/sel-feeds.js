// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A selected person's feeds (2026-10-07): one panel with tabs — Activity (what they are doing now, then what they
// did, newest first), for an agent this account manages its Thoughts (2026-10-08: what its Mind planned, reflected,
// answered and said, newest first: GET /api/mind/thoughts) and Money (their savings and rent, then what they spent and
// earned, newest first). The three newest
// lines are clear, each older one fainter; scrolled down to read back, all of them clear — ten lines, and under the last,
// for an agent this account manages, "See full feed" opens its Agent Studio at Activity or Money; a live update never moves
// a reader who scrolled down. ui.js draws the panel in the selection (the floating card or the Info panel); this fills it,
// from GET /api/people/recent (server/recent.js) and GET /api/economy/person. An agent's day and money are its owner's,
// so for anyone else the server answers "private" and only the public parts show (what it is doing now; no Money tab).
import { S, bus } from '../core/state.js';
import { studioAgentAt } from '../core/agent-view.js';
import { getJSON } from '../core/net.js';
import { esc } from '../core/util.js';
import { vc, coin } from './economy.js';
import { KIND as THOUGHT, ERR as THOUGHT_ERR } from './mind.js';

const ICON = { sleep: '😴', nap: '💤', home: '🏠', meal: '🍽️', cafe: '☕', visit: '🚪', park: '🌳', shop: '🛍️', gym: '🏋️', bar: '🍷', lounge: '🛋️', arcade: '🕹️', lounge_bar: '🍸', club: '💃', walk: '🚶', jog: '🏃', task: '💻', work: '💼', meeting: '👥', chat: '💬', talk: '🗣️', post: '🛎️', radio: '🎙️' };
const MONEY = { buy: '🛍️', settlement: '🧾', wage: '💼', rent: '🔑', transfer: '🤝', purchase: '🛒', fund: '🎁', draw: '↩', grant: '🎁', refund: '↺', tax: '🏛️', fee: '🏷️', property: '🏠', ad_income: '🪧', prize: '🏆' };
const EVERY = 6000;   // how often the feeds of the selected person refresh
const SHOW = 10;      // lines a feed shows; below the last, "See full feed" opens the Agent Studio (agents this account manages)
const TAB = 'mvw.selFeed';   // the tab last chosen (this browser): it stays as other people are selected
const cache = new Map();   // person index → { act, money, thoughts, at }

let app = null, cur = null, seq = 0;
export function init(a) {
  app = a;
  app.inspHooks = app.inspHooks || { building: [], resident: [] };
  app.inspHooks.resident.push(feeds);
  setInterval(() => { if (!document.hidden && S.sel >= 0 && cur && cur.i === S.sel && cur.box.isConnected) load(cur, true); }, EVERY);
  bus.on('select', i => { if (i < 0) cur = null; });
}
const tabNow = () => (['money', 'thoughts'].includes(localStorage.getItem(TAB)) ? localStorage.getItem(TAB) : 'act');

/** The agent whose body is person i, when this account may open its Agent Studio (its owner, or a manage share). */
const studioOf = i => studioAgentAt(S.agentList, i);
const fullFeed = (F, tab) => (studioOf(F.i) ? `<button type="button" class="fi-more" data-full="${tab}">See full feed</button>` : '');

/** ui.js drew person i's card (again): wire the tabs, fill from what is known, then ask for what is new. */
function feeds(body, i) {
  const box = body.querySelector('.sel-feed');
  if (!box) return;
  const F = cur = { i, box, token: ++seq };
  box.addEventListener('click', e => { const b = e.target.closest('[data-full]'); const a = b && studioOf(F.i); if (a) app.studio?.open(a.id, b.dataset.full); });
  box.querySelector('.sf-tabs').onclick = e => { const b = e.target.closest('[data-ft]'); if (b) { localStorage.setItem(TAB, b.dataset.ft); showTab(F); } };
  showTab(F);
  const c = cache.get(i);
  if (c) { paintAct(F, c.act); paintThoughts(F, c.thoughts); paintMoney(F, c.money); }
  load(F, !!c);
}
function showTab(F) {
  const want = tabNow(), t = F.box.querySelector(`[data-ft="${want}"]:not(.hidden)`) ? want : 'act';   // (a tab not shown for this one: Activity)
  for (const b of F.box.querySelectorAll('[data-ft]')) { const on = b.dataset.ft === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  for (const p of F.box.querySelectorAll('[data-pane]')) p.classList.toggle('hidden', p.dataset.pane !== t);
}
async function load(F, fresh) {
  if (fresh && Date.now() - (cache.get(F.i)?.at || 0) < EVERY) return;
  const econOn = !!app.econ?.status?.()?.enabled;
  const ag = studioOf(F.i);   // (an agent's thoughts are its owner's and its managers' only)
  const [act, money, thoughts] = await Promise.all([
    getJSON(`/api/people/recent?i=${F.i}`).catch(() => null),
    econOn ? getJSON(`/api/economy/person?i=${F.i}`).catch(() => null) : Promise.resolve(null),
    ag ? getJSON(`/api/mind/thoughts?agent=${ag.id}&limit=${SHOW}`).catch(() => null) : Promise.resolve(null),
  ]);
  cache.set(F.i, { act, money, thoughts, at: Date.now() });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  if (cur !== F || !F.box.isConnected) return;
  paintAct(F, act); paintThoughts(F, thoughts); paintMoney(F, money);
}

/** Where the reader left each feed of the selected person (null: at the newest line, the top). The card is redrawn when
 *  the city changes, so a feed scrolled down to read older lines is put back where it was. */
const pos = { i: -1, act: null, money: null, thoughts: null };
/** Repaints a feed newest first; one read where it was stays at the same line when new ones arrive on top. */
function keepTop(scroll, which, fn) {
  const fresh = !scroll.dataset.seen, h0 = scroll.scrollHeight;
  const atTop = fresh ? pos[which] === null : scroll.scrollTop <= 4;
  const top0 = scroll.scrollTop;
  fn();
  scroll.dataset.seen = '1';
  if (atTop) scroll.scrollTop = 0;
  else scroll.scrollTop = fresh ? pos[which] : top0 + (scroll.scrollHeight - h0);
  scroll.classList.toggle('down', !atTop);
}
function watch(scroll, i, which) {
  if (pos.i !== i) { pos.i = i; pos.act = null; pos.money = null; pos.thoughts = null; }
  if (scroll.dataset.watch) return;
  scroll.dataset.watch = '1';
  scroll.addEventListener('scroll', () => {
    const down = scroll.scrollTop > 4;   // (any scroll: a phone's short feed scrolls only a little)
    scroll.classList.toggle('down', down);
    if (pos.i === i) pos[which] = down ? scroll.scrollTop : null;
  }, { passive: true });
}
const id = x => `${x.when || x.at}|${x.label}|${x.minutes ?? x.amount}`;

function paintAct(F, j) {
  const pane = F.box.querySelector('[data-pane="act"]'), items = pane.querySelector('.feed-items'), scroll = pane.querySelector('.feed-scroll');
  watch(scroll, F.i, 'act');
  // newest first; the one going on now is the live line above them (ui.js keeps it current)
  const list = j && !j.private ? (j.activity || []).filter(r => !r.now).reverse().slice(0, SHOW) : [];
  const key = list.map(id).join('~') + (j?.private ? '#p' : '');
  if (items.dataset.key === key) return;
  const before = new Set((items.dataset.key || '').split('~'));
  keepTop(scroll, 'act', () => {
    items.innerHTML = (j?.private ? '<div class="fi-note">Its day is private: its owner sees it in the Agent Studio.</div>' : '')
      + (!list.length && !j?.private ? '<div class="fi-note">Their day so far shows here as they live it.</div>' : '')
      + list.map(r => `<div class="fi${!items.dataset.key || before.has(id(r)) ? '' : ' new'}"><span class="fi-ic">${ICON[r.kind] || '•'}</span><div class="fi-t"><b>${esc(r.label)}</b><small>${esc(r.when || '')}${r.minutes ? ` · ${r.minutes < 90 ? `${r.minutes} min` : `${Math.round(r.minutes / 6) / 10} h`}` : ''}</small></div></div>`).join('')
      + (list.length ? fullFeed(F, 'activity') : '');
    items.dataset.key = key;
  });
}

/** An agent's thoughts, newest first, one line each: what it thought (or did), the kind of thought, when. Only for an agent
 *  this account manages (others: no tab); without a brain of its own yet, a line says what will show here. */
function paintThoughts(F, j) {
  const tab = F.box.querySelector('[data-ft="thoughts"]'), pane = F.box.querySelector('[data-pane="thoughts"]');
  const has = !!j && Array.isArray(j.thoughts);
  if (tab.classList.contains('hidden') === has) { tab.classList.toggle('hidden', !has); showTab(F); }
  if (!has) return;
  const items = pane.querySelector('.feed-items'), scroll = pane.querySelector('.feed-scroll');
  watch(scroll, F.i, 'thoughts');
  const list = j.thoughts.slice(0, SHOW), key = list.map(t => `${t.id}:${t.status}`).join('~');
  if (items.dataset.key === key) return;
  const before = new Set((items.dataset.key || '').split('~')), name = S.people[F.i]?.n || 'It';
  keepTop(scroll, 'thoughts', () => {
    items.innerHTML = list.length ? list.map(t => {
      const [ic, title] = THOUGHT[t.kind] || ['🧠', 'Thought'], d = t.did || {}, k = `${t.id}:${t.status}`;
      const what = t.status !== 'ok' ? `${t.status === 'skipped' ? 'Skipped' : 'Could not think'}${t.error ? `: ${THOUGHT_ERR[t.error] || t.error}` : ''}`
        : d.thought ? `“${d.thought}”` : t.kind === 'speech' ? (d.shown ? `“${d.said || ''}”` : 'Kept it to itself') : d.told ? `Told you: “${d.told}”` : (d.plans || []).length ? `Plans: ${d.plans.map(p => p.replace(/^(must|want): /, '')).join(' · ')}` : title;
      return `<div class="fi thought${t.status !== 'ok' ? ' bad' : ''}${!items.dataset.key || before.has(k) ? '' : ' new'}"><span class="fi-ic">${ic}</span><div class="fi-t"><b data-noicon title="${esc(what)}">${esc(what)}</b><small>${esc(title)} · ${ago(t.at)}</small></div></div>`;
    }).join('') + fullFeed(F, 'brain')
      : `<div class="fi-note">${esc(name)}'s thoughts show here: with a brain it plans its day when it wakes and reflects at bedtime.</div>`;
    items.dataset.key = key;
  });
}

const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
function paintMoney(F, j) {
  const tab = F.box.querySelector('[data-ft="money"]'), pane = F.box.querySelector('[data-pane="money"]');
  const lines = (j?.lines || []).slice().reverse().slice(0, SHOW);
  // an agent's money is its owner's: no Money tab for anyone else (a body passing for a resident shows what it bought)
  const has = !!j && !j.private && (!!j.wallet || lines.length > 0);
  if (tab.classList.contains('hidden') === has) { tab.classList.toggle('hidden', !has); showTab(F); }
  if (!has) return;
  const avail = j.wallet ? j.wallet.balance - (j.wallet.pending || 0) : null;
  tab.querySelector('.sf-bal').textContent = avail === null ? '' : vc(avail);
  pane.querySelector('.mf-head').innerHTML = `<span class="mf-bal">${coin()} ${avail === null ? '<b>Spent lately</b>' : `<b>${vc(avail)}</b>${j.wallet.pending ? ` <small class="dim">· ${vc(j.wallet.pending)} on account today</small>` : ''}`}</span>${j.rent ? `<span class="mf-rent">🏠 ${vc(j.rent)} a night${j.landlord ? ` to ${esc(j.landlord)}` : ''}</span>` : ''}`;
  const items = pane.querySelector('.feed-items'), scroll = pane.querySelector('.feed-scroll');
  watch(scroll, F.i, 'money');
  const key = lines.map(l => `${l.at}:${l.amount}`).join('~');
  if (items.dataset.key === key) return;
  const before = new Set((items.dataset.key || '').split('~'));
  keepTop(scroll, 'money', () => {
    items.innerHTML = lines.length ? lines.map(l => `<div class="fi money${!items.dataset.key || before.has(`${l.at}:${l.amount}`) ? '' : ' new'}"><span class="fi-ic">${MONEY[l.kind] || '🪙'}</span><div class="fi-t"><b>${esc(l.label)}</b><small>${esc(l.when || ago(l.at))}${l.note ? ` · ${esc(l.note)}` : ''}</small></div><b class="fi-amt ${l.amount > 0 ? 'in' : 'out'}">${l.amount > 0 ? '+' : '−'}${vc(Math.abs(l.amount), false)}</b></div>`).join('') + fullFeed(F, 'money')
      : '<div class="fi-note">Nothing spent or earned yet today.</div>';
    items.dataset.key = key;
  });
}
