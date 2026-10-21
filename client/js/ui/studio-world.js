// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's world tabs (ui/agent-studio.js):
// - Home & Work: which flat is its home - the building's floors with its floor lit, the floor's plan with its flat lit
//   and its door, who lives with it, the rent - and "Show me", which looks inside that floor and marks the flat in the
//   world (render/flat-marker.js); its job, workplace and hours on a day bar.
// - Money (its owner): its wallet, giving and taking back, what it may use money for (the spending rules the economy
//   checks before every spend: server/economy/agents.js), approvals waiting, and its statement.
// - Settings: its name, badge and role; who it is shared with; removing it. (Its look: the Customize tab, studio-look.js.)
import { S, bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON } from '../core/net.js';
import { esc, clamp } from '../core/util.js';
import { isExt } from '../core/agent-view.js';
import { load as reloadAgents } from '../core/agents.js';
import { formatClock } from '/shared/constants.js';
import { flatRecord, openFlat } from './flats.js';
import { vc, coin } from './economy.js';

const KIND = { studio: 'Studio', one: 'One-bedroom', two: 'Two-bedroom' };
const toCents = v => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ------------------------------------------------------------------------------------------------ where it lives
/** Its home from /api/agent/:i: the building, floor, flat and its kind, or null when it has none. */
export function homeOf(info) {
  const hm = info?.home;
  if (!hm || !(hm.b >= 0)) return null;
  const B = S.world?.buildings?.[hm.b];
  if (!B || B.gone) return null;
  const L = S.world.levels[B.lv?.[hm.f]], u = Number.isInteger(hm.u) ? hm.u : -1, U = u >= 0 ? L?.units?.[u] : null;
  return { b: hm.b, f: hm.f, u, B, L, U, building: B.name || hm.name || 'Its building', kind: U ? KIND[U.kind] || 'Flat' : null, place: hm.place };
}
/** The plan of its floor: every flat (its own lit, with a 🏠 and its door), from the floor's real layout. */
export function floorPlanSvg(home, { mini = false } = {}) {
  const units = home?.L?.units;
  if (!units?.length) return '';
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const U of units) { x0 = Math.min(x0, U.x0); z0 = Math.min(z0, U.z0); x1 = Math.max(x1, U.x1); z1 = Math.max(z1, U.z1); }
  const pad = 1.2, w = x1 - x0 + pad * 2, d = z1 - z0 + pad * 2;
  const cells = units.map((U, k) => {
    const me = k === home.u, cx = (U.x0 + U.x1) / 2, cz = (U.z0 + U.z1) / 2, small = Math.min(U.x1 - U.x0, U.z1 - U.z0);
    const door = U.door ? `<circle class="fp-door" cx="${U.door[0].toFixed(2)}" cy="${U.door[1].toFixed(2)}" r="${mini ? 0.45 : 0.38}"/>` : '';
    const fs = clamp(small * 0.32, 0.9, 2.4);
    return `<g class="fp-u${me ? ' me' : ''}"><rect x="${U.x0.toFixed(2)}" y="${U.z0.toFixed(2)}" width="${(U.x1 - U.x0).toFixed(2)}" height="${(U.z1 - U.z0).toFixed(2)}" rx="0.25"/>${door}
      ${mini ? (me ? `<text x="${cx.toFixed(2)}" y="${(cz + fs * 0.35).toFixed(2)}" font-size="${(fs * 1.3).toFixed(2)}">🏠</text>` : '') : `<text x="${cx.toFixed(2)}" y="${(cz + fs * 0.35).toFixed(2)}" font-size="${fs.toFixed(2)}">${me ? '🏠 ' : ''}${k + 1}</text>`}</g>`;
  }).join('');
  return `<svg class="fp${mini ? ' mini' : ''}" viewBox="${(x0 - pad).toFixed(2)} ${(z0 - pad).toFixed(2)} ${w.toFixed(2)} ${d.toFixed(2)}" role="img" aria-label="Floor ${home.f + 1}: flat ${home.u + 1} is its home"><rect class="fp-hall" x="${(x0 - pad / 2).toFixed(2)}" y="${(z0 - pad / 2).toFixed(2)}" width="${(w - pad).toFixed(2)}" height="${(d - pad).toFixed(2)}" rx="0.6"/>${cells}</svg>`;
}
/** The building's floors, top to bottom, its own lit. */
function stackHtml(home) {
  const B = home.B, rows = [];
  for (let f = B.floors - 1; f >= 0; f--) {
    const L = S.world.levels[B.lv?.[f]], n = L?.units?.length || 0, me = f === home.f;
    rows.push(`<div class="hs-floor${me ? ' me' : ''}"><span class="hs-n">${f + 1}</span><span class="hs-cells">${n ? Array.from({ length: n }, (_, k) => `<i class="${me && k === home.u ? 'me' : ''}"></i>`).join('') : `<em>${f === 0 ? 'Street floor' : 'No flats'}</em>`}</span></div>`);
  }
  return `<div class="hs" aria-hidden="true"><div class="hs-roof"></div>${rows.join('')}<div class="hs-ground"></div></div>`;
}

export async function placeTab(C, body, live) {
  const [info, res, pst] = await Promise.all([C.get('info', true), C.get('resident'), C.get('post')]);
  if (!live()) return;
  if (!info || info.error) { body.innerHTML = `<p class="hint">${esc(info?.error || 'It has no body in the city right now.')}</p>`; return; }
  const home = homeOf(info), j = info.job || {}, sc = info.sched || {};
  const mates = home ? S.people.map((p, k) => (p && !p.x && k !== C.i && p.hb === home.b && p.hf === home.f && p.hu === home.u ? p : null)).filter(Boolean) : [];
  const onFloor = home ? S.people.filter(p => p && !p.x && p.hb === home.b && p.hf === home.f).length : 0;
  const rec = home && home.u >= 0 ? flatRecord(home.b, home.f, home.u) : null;
  const deal = rec ? (rec.deal === 'sold' ? 'Bought' : rec.deal === 'rented' ? 'Rented' : rec.deal === 'assigned' ? 'Assigned' : '') : '';
  const r = res && !res.error ? res.resident : null;
  const homeHtml = home ? `<div class="hw-home">
      <div class="hw-viz">${stackHtml(home)}<div class="hw-plan">${floorPlanSvg(home) || '<p class="hint">This floor has no flats drawn.</p>'}<small class="dim">Floor ${home.f + 1} seen from above · the dot is its door</small></div></div>
      <div class="hw-facts"><h3>🏠 ${esc(home.building)}</h3><div class="hw-addr">${esc(home.place || '')}</div>
        <div class="hw-tiles"><div><b>${home.f + 1}</b><span>floor</span></div>${home.u >= 0 ? `<div><b>${home.u + 1}</b><span>flat</span></div>` : ''}${home.kind ? `<div><b>${esc(home.kind)}</b><span>size</span></div>` : ''}<div><b>${onFloor}</b><span>on this floor</span></div></div>
        <div class="kv">${r?.rent ? `<span class="k">Rent</span><span>${coin()} ${vc(r.rent)} a night${r.landlord ? ` to ${esc(r.landlord)}` : ''}</span>` : ''}
          ${deal ? `<span class="k">The flat</span><span>${deal}${rec.locked ? ' · 🔒 door locked' : ''}</span>` : rec?.locked ? '<span class="k">Door</span><span>🔒 locked</span>' : ''}
          <span class="k">Lives with</span><span>${mates.length ? mates.map(p => esc(p.n)).join(', ') : 'Nobody - it lives alone'}</span></div>
        <div class="row wrap"><button type="button" class="btn primary" data-c="show">📍 Show me in the world</button>${home.u >= 0 ? '<button type="button" class="btn" data-c="flat">🚪 The flat</button>' : ''}</div></div></div>`
    : '<div class="st-sec"><p class="hint">It has no home yet: residents look for a free flat on their own.</p></div>';
  const bar = (h0, h1, cls, label) => {
    if (h0 === null || h0 === undefined || h1 === null || h1 === undefined) return '';
    const segs = h1 >= h0 ? [[h0, h1]] : [[h0, 24], [0, h1]];
    return segs.map(([a, b]) => `<i class="${cls}" style="left:${(a / 24 * 100).toFixed(2)}%;width:${((b - a) / 24 * 100).toFixed(2)}%" title="${label}"></i>`).join('');
  };
  const hour = ((S.hour ?? 12) % 24 + 24) % 24;
  const workHtml = `<div class="st-sec hw-work"><div class="st-sec-h"><h4>💼 Work</h4></div>
    ${j.b >= 0 ? `<div class="hw-job"><div><b>${esc(j.title || 'Works')}</b><small>${esc(j.place || '')}</small></div><button type="button" class="btn small" data-c="work">📍 Show workplace</button></div>` : '<p class="hint">Between jobs.</p>'}
    <div class="hw-day"><div class="hw-bar">${bar(sc.bed % 24, sc.wake, 'sleep', 'Asleep')}${j.b >= 0 ? bar(j.start, j.end, 'work', 'At work') : ''}${sc.lunch != null ? `<i class="lunch" style="left:${(sc.lunch / 24 * 100).toFixed(2)}%" title="Lunch"></i>` : ''}<b class="now" style="left:${(hour / 24 * 100).toFixed(2)}%"></b></div>
      <div class="hw-hours"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <div class="hw-legend"><span class="sleep">Asleep ${sc.bed != null ? `${formatClock(sc.bed)}–${formatClock(sc.wake)}` : ''}</span>${j.b >= 0 && j.start != null ? `<span class="work">Work ${formatClock(j.start)}–${formatClock(j.end)}</span>` : ''}${sc.lunch != null ? `<span class="lunch">Lunch ${formatClock(sc.lunch)}</span>` : ''}</div></div></div>`;
  body.innerHTML = `<div class="hw">${homeHtml}${postHtml(C, pst)}${workHtml}</div>`;
  postWire(C, body, pst);
  const q = s => body.querySelector(s);
  if (q('[data-c="show"]')) q('[data-c="show"]').onclick = () => (home.u >= 0 ? C.showFlat(home.b, home.f, home.u) : C.peek(() => C.app.lookInside?.(home.b, home.f)));
  if (q('[data-c="flat"]')) q('[data-c="flat"]').onclick = () => openFlat(home.b, home.f, home.u);
  if (q('[data-c="work"]')) q('[data-c="work"]').onclick = () => C.peek(() => C.app.lookInside?.(j.b, j.f >= 0 ? j.f : 0));
}

// ------------------------------------------------------------------------------------------------ its post
// On post around the clock (server/agent-posts/, 2026-10-08: "assign agents to be permanent occupants of certain
// spots, like the reception desk … restaurants … 24/7"): where it is, or the spots its owner may choose - the serving side
// of a reception desk, a counter or a checkout, a desk, a kitchen, where they could furnish.
const POST_USE = { staff: 'serving side', work: 'desk', computer: 'desk', cook: 'stove', prep: 'counter' };
function postHtml(C, d) {
  if (!d || d.error) return '';
  const p = d.post, st = C.st.post ||= { choosing: false };
  const head = '<div class="st-sec-h"><h4>🛎️ Its post</h4></div>';
  if (p) {
    return `<div class="st-sec pt">${head}
      <div class="pt-now"><span class="pt-ico" aria-hidden="true">🛎️</span><div><b>On post at the ${esc(p.furniture.toLowerCase())}</b><small>${esc(p.place)}${p.since ? ` · since ${new Date(p.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</small></div></div>
      <p class="hint">It stays there day and night: no sleep, meals or free time, its needs waiting. Whoever walks up talks with it as you chose in <button type="button" class="linkish" data-go="visitors">Visitors</button>.</p>
      <div class="row wrap"><button type="button" class="btn small" data-pt="show">📍 Show me</button><button type="button" class="btn small" data-pt="leave">Let it go</button><button type="button" class="btn small" data-pt="choose">Move it</button></div>
      ${st.choosing ? spotsHtml(d) : ''}</div>`;
  }
  return `<div class="st-sec pt">${head}
    <p class="hint">Post ${esc(C.name)} around the clock at a reception desk, a counter, a checkout, a desk or a kitchen in a place you hold - anyone who walks up there talks with it, day and night.</p>
    ${st.choosing ? spotsHtml(d) : `<button type="button" class="btn small primary" data-pt="choose">Choose a post</button>`}</div>`;
}
/** The spots by building and floor; on a floor, alike pieces (a row of desks) are one line - the first free one is taken -
 *  and a piece of its own (a reception desk, a counter) a line of its own, with who is there. */
function spotsHtml(d) {
  const bs = d.buildings || [];
  if (!bs.length) return '<p class="hint dim">Nowhere yet: you can post an agent where you could furnish - a building on a lot you hold, or a flat you own or rent.</p>';
  const isMine = (b, f, it, s) => d.post && d.post.b === b && d.post.f === f && d.post.item === it.id && d.post.slot === s.k;
  const floorRows = (b, f) => {
    const groups = new Map();
    for (const it of f.items) for (const s of it.slots) {
      const key = `${it.name}|${s.use}`;
      let g = groups.get(key); if (!g) groups.set(key, g = { name: it.name, use: s.use, all: [] });
      g.all.push({ it, s });
    }
    return [...groups.values()].map(g => {
      const free = g.all.filter(x => !x.s.holder && !isMine(b.b, f.f, x.it, x.s)), first = free[0], here = g.all.find(x => isMine(b.b, f.f, x.it, x.s));
      const word = POST_USE[g.use] || g.use, says = !g.name.toLowerCase().includes(word.split(' ')[0]);   // (no "Counter · counter")
      const label = `${esc(g.name)}${says && (g.all.length > 1 || g.all[0].it.slots.length > 1) ? ` · ${esc(word)}` : ''}`;
      const note = here ? 'its post now' : g.all.length > 1 ? `${free.length} of ${g.all.length} free` : g.all[0].s.holder ? (g.all[0].s.holder.post ? `${g.all[0].s.holder.name} is on post` : `${g.all[0].s.holder.name}'s place at work`) : '';
      return `<li class="wk-file"><span class="wk-fi" aria-hidden="true">🛎️</span><span>${label}</span><small>${esc(note)}</small>
        <button type="button" class="btn small" ${first ? `data-post="${b.b}:${f.f}:${first.it.id}:${first.s.k}"` : 'disabled'}>Post here</button></li>`;
    }).join('');
  };
  return `<div class="pt-spots">${bs.map(b => `<details class="pt-b"${bs.length === 1 ? ' open' : ''}><summary><b>${esc(b.name)}</b><small>${b.floors.length === 1 ? esc(b.floors[0].name) : `${b.floors.length} floors`}</small></summary>
    ${b.floors.map(f => `<div class="pt-f"><small class="dim">${esc(f.name)}</small><ul class="wk-files">${floorRows(b, f)}</ul></div>`).join('')}</details>`).join('')}</div>`;
}
function postWire(C, body, d) {
  if (!d || d.error) return;
  const st = C.st.post ||= { choosing: false };
  body.querySelectorAll('[data-go]').forEach(x => { x.onclick = () => C.go(x.dataset.go); });
  const btn = k => body.querySelector(`[data-pt="${k}"]`);
  if (btn('choose')) btn('choose').onclick = () => { st.choosing = !st.choosing; C.repaint(); };
  if (btn('show')) btn('show').onclick = () => C.peek(() => C.app.lookInside?.(d.post.b, d.post.f));
  if (btn('leave')) btn('leave').onclick = async () => {
    if (!C.armed(btn('leave'), 'Let it go?')) return;
    if (await C.call('/api/agent-posts/leave', { agent: C.id })) { C.toast(`${C.name} is back to its day`); st.choosing = false; C.drop('post', 'info'); C.repaint(); }
  };
  body.querySelectorAll('[data-post]').forEach(x => {
    x.onclick = async () => {
      const [b, f, item, slot] = x.dataset.post.split(':').map(Number);
      const r = await C.call('/api/agent-posts', { agent: C.id, b, f, item, slot });
      if (!r) return;
      C.toast(`${C.name} is on its way to its post at ${r.post?.place || 'the spot'}`);
      st.choosing = false; C.drop('post', 'info'); C.repaint();
    };
  });
}

// ------------------------------------------------------------------------------------------------ money
const SCOPES = [
  ['work', '👷', 'Work', 'Take shifts and be paid'],
  ['buy', '🛍️', 'Buy', 'Food, coffee and things at venues'],
  ['pay', '🤝', 'Pay', 'Send money to people and businesses'],
  ['rent', '🔑', 'Rent', 'Rent a home or a place to run'],
  ['business', '🏪', 'Business', 'Run a business: stock, wages'],
];
export async function moneyTab(C, body, live) {
  const st = C.st.money = C.st.money || { stmt: null, draft: null };
  if (!C.app.econ?.status?.()?.enabled) { body.innerHTML = '<div class="st-sec"><p class="hint">The economy is switched off in this world.</p></div>'; return; }
  const econ = await C.get('econ');
  if (!live()) return;
  if (!econ || econ.error) { body.innerHTML = `<p class="hint">${esc(econ?.error || 'Not available.')}</p>`; return; }
  const a = econ.agents.find(x => x.id === C.id);
  if (!a) { body.innerHTML = `<div class="st-sec"><p class="hint">Only ${esc(C.name)}'s owner sees and moves its money.</p></div>`; return; }
  if (!st.stmt) {
    try { st.stmt = (await getJSON(`/api/economy/statement?wallet=${encodeURIComponent(a.wallet.id)}&limit=25`)).statement; } catch { st.stmt = []; }
    if (!live()) return;
  }
  const L = st.draft || (st.draft = { scopes: [...a.limits.scopes], dailyCap: a.limits.dailyCap, approveAbove: a.limits.approveAbove, paused: !!a.limits.paused });
  const dirty = JSON.stringify(L) !== JSON.stringify({ scopes: [...a.limits.scopes], dailyCap: a.limits.dailyCap, approveAbove: a.limits.approveAbove, paused: !!a.limits.paused });
  const used = a.limits.dailyCap ? clamp(a.limits.spent24h / a.limits.dailyCap, 0, 1) : 0;
  const appr = (econ.approvals || []).filter(p => p.agent?.id === C.id);
  const w = a.wallet;
  body.innerHTML = `<div class="mn">
    <div class="mn-hero"><div class="mn-coin">${coin('lg')}</div><div><small>${esc(C.name)}'s wallet</small><b class="mn-bal">${vc(w.balance)}</b>${w.held ? `<small>${vc(w.available)} available · ${vc(w.held)} set aside</small>` : ''}${w.status === 'frozen' ? '<small class="bad">🧊 Frozen</small>' : ''}</div>
      <div class="mn-move"><div class="mn-quick">${[10, 50, 100, 500].map(n => `<button type="button" class="btn small" data-amt="${n}">${n}</button>`).join('')}</div>
        <div class="row"><input class="input mn-amt" inputmode="decimal" placeholder="VC" aria-label="Amount in VC"><button type="button" class="btn small primary" data-w="fund">Give</button><button type="button" class="btn small" data-w="take">Take back</button></div>
        <small class="dim">Your wallet: ${vc(econ.wallet?.balance ?? 0)}</small></div></div>
    ${appr.length ? `<div class="st-sec mn-appr"><div class="st-sec-h"><h4>✋ Waiting for you</h4><span class="st-count">${appr.length}</span></div>${appr.map(p => `<div class="mn-ask"><div><b>${esc(p.action === 'buy' ? 'Buy' : 'Pay')} ${vc(p.amount)}</b><small>${p.payload?.memo ? `“${esc(p.payload.memo)}” · ` : ''}${esc(p.summary || '')} · asked ${when(p.created)}</small></div><button type="button" class="btn small primary" data-appr="${esc(p.id)}" data-yes="1">Approve</button><button type="button" class="btn small" data-appr="${esc(p.id)}" data-yes="0">Decline</button></div>`).join('')}</div>` : ''}
    <div class="st-sec"><div class="st-sec-h"><h4>📐 Its spending rules</h4>${toggleHtml('mn-pause', L.paused, 'Pause all spending')}</div>
      <p class="hint">The world checks these before every coin it spends - whether it decides itself or you ask it in a chat.</p>
      <div class="mn-scopes">${SCOPES.map(([k, ic, lb, d]) => `<button type="button" class="mn-scope${L.scopes.includes(k) ? ' on' : ''}" data-scope="${k}" aria-pressed="${L.scopes.includes(k)}"><span>${ic}</span><b>${lb}</b><small>${d}</small></button>`).join('')}</div>
      <div class="mn-limits"><label>Most it spends in 24 h<span class="mn-in">${coin()}<input class="input" data-l="dailyCap" inputmode="decimal" value="${(L.dailyCap / 100).toFixed(0)}"></span></label>
        <label>Ask me first above<span class="mn-in">${coin()}<input class="input" data-l="approveAbove" inputmode="decimal" value="${(L.approveAbove / 100).toFixed(0)}"></span></label></div>
      <div class="mn-gauge"><div class="st-meter"><i style="width:${Math.max(1, Math.round(used * 100))}%"></i></div><small>${vc(a.limits.spent24h)} spent in the last 24 h of ${vc(a.limits.dailyCap)}</small></div>
      <div class="sp-save${dirty ? ' dirty' : ''}"><span>${dirty ? 'Unsaved changes' : 'Saved'}</span><button type="button" class="btn small" data-w="undo"${dirty ? '' : ' disabled'}>Undo</button><button type="button" class="btn primary" data-w="limits"${dirty ? '' : ' disabled'}>Save rules</button></div></div>
    <div class="st-sec"><div class="st-sec-h"><h4>🧾 Lately</h4></div><div class="mn-stmt">${st.stmt.length ? st.stmt.map(l => `<div class="mn-line"><span class="mn-k">${esc(l.memo || l.kind)}</span><small class="dim">${l.with ? `${esc(l.with)} · ` : ''}${when(l.at)}</small><b class="${l.amount > 0 ? 'good' : ''}">${l.amount > 0 ? '+' : ''}${vc(l.amount)}</b></div>`).join('') : '<p class="hint">Nothing yet.</p>'}</div></div>
  </div>`;
  const q = s => body.querySelector(s);
  const refresh = async msg => { if (msg) C.toast(msg); C.drop('econ'); st.stmt = null; st.draft = null; C.app.econ?.refresh?.(); C.repaint(); };
  body.querySelectorAll('[data-amt]').forEach(b => { b.onclick = () => { q('.mn-amt').value = b.dataset.amt; }; });
  body.querySelectorAll('[data-scope]').forEach(b => { b.onclick = () => { const k = b.dataset.scope, s = new Set(L.scopes); s.has(k) ? s.delete(k) : s.add(k); L.scopes = SCOPES.map(x => x[0]).filter(x => s.has(x)); C.repaint(); }; });
  q('.mn-pause').onchange = e => { L.paused = e.target.checked; C.repaint(); };
  body.querySelectorAll('[data-l]').forEach(inp => { inp.onchange = () => { const v = toCents(inp.value); if (Number.isSafeInteger(v)) { L[inp.dataset.l] = v; C.repaint(); } else C.say('A whole amount of VC, please', true); }; });
  q('[data-w="undo"]').onclick = () => { st.draft = null; C.repaint(); };
  q('[data-w="limits"]').onclick = async () => { if (await C.call('/api/economy/agent/limits', { agent: C.id, ...L })) refresh('Spending rules saved'); };
  for (const dir of ['fund', 'take']) q(`[data-w="${dir}"]`).onclick = async () => {
    const amount = toCents(q('.mn-amt').value);
    if (!Number.isSafeInteger(amount) || amount <= 0) return C.say('How much?', true);
    if (await C.call('/api/economy/agent/move', { agent: C.id, amount, dir })) { if (dir === 'fund') C.pose('cheer'); refresh(dir === 'fund' ? `Gave ${C.name} ${vc(amount)}` : `Took back ${vc(amount)}`); }
  };
  body.querySelectorAll('[data-appr]').forEach(b => {
    b.onclick = async () => {
      const yes = b.dataset.yes === '1';
      if (yes && !C.armed(b, 'Tap again')) return;
      const r = await C.call('/api/economy/approval/answer', { id: b.dataset.appr, approve: yes });
      if (r) refresh(yes ? (r.approval?.status === 'failed' ? `It didn't go through: ${r.approval.result?.error || 'refused'}` : 'Approved: done') : 'Declined');
    };
  });
}
const toggleHtml = (cls, on, label) => `<label class="st-switch"><input type="checkbox" class="${cls}"${on ? ' checked' : ''}><span class="st-knob"></span><span>${esc(label)}</span></label>`;

// ------------------------------------------------------------------------------------------------ settings
const BADGES = ['🤖', '🧠', '⚡', '💡', '🔥', '⭐', '💎', '🚀', '🎨', '📚', '💼', '🛠', '🧭', '🔭', '🎮', '🎹', '🏓', '☕', '🌿', '🌷', '🌊', '☀', '🌙', '🎈', '🎁', '🏆', '👔', '👷', '🧑', '🙂'];
export async function settingsTab(C, body, live) {
  const friends = auth.can('players.friends') ? await C.get('friends') : null;
  if (!live()) return;
  const r = C.rec(), ext = isExt(r), mg = C.manage;
  const st = C.st.set = C.st.set || { emoji: r.emoji || '🤖' };
  const fr = friends && !friends.error ? friends.friends : [];
  const nameOf = s => s.kind === 'role' ? `Everyone who is ${s.who} or above` : (fr.find(f => String(f.id) === String(s.who))?.name || `Account #${s.who}`);
  const identity = mg && !ext ? `<div class="st-sec"><div class="st-sec-h"><h4>👤 Who it is</h4></div>
      <div class="ss-id"><div class="ss-badge" data-avatar aria-live="polite">${esc(st.emoji)}</div><div class="ss-fields"><label>Name<input class="input ss-name" maxlength="32" value="${esc(r.name)}"></label><label>Role<input class="input ss-role" maxlength="60" placeholder="What it does" value="${esc(r.role || '')}"></label></div></div>
      <div class="ss-badges" role="listbox" aria-label="Badge">${BADGES.map(e => `<button type="button" class="${e === st.emoji ? 'on' : ''}" data-avatar data-emoji="${e}" role="option" aria-selected="${e === st.emoji}">${e}</button>`).join('')}<input class="input ss-emoji" maxlength="8" placeholder="Other" aria-label="Another emoji"></div>
      <div class="row end"><button type="button" class="btn primary" data-c="save-id">Save</button></div></div>`
    : `<div class="st-sec"><p class="hint">${ext ? `${esc(r.name)} is a third-party agent: who can see it, who can chat with it and its connection are in its Brain tab.` : 'Only its owner, or someone it is shared with to manage it, changes these.'}</p>${ext ? '<button type="button" class="btn small" data-go="brain">Open its connection</button>' : ''}</div>`;
  // (who else has it, and removing it, are its owner's alone; a manager sees who it is shared with - step 8)
  // (a connected agent is shared only to manage, with a person: who may chat with it is its slot's audience - 2026-10-11)
  const own = C.owner;
  const share = own ? `<div class="st-sec"><div class="st-sec-h"><h4>👥 Shared with</h4></div>
      <div class="ss-shares">${(r.shares || []).map(s => `<div class="ss-share"><span>${esc(nameOf(s))}</span><span class="st-pill">${s.level === 'manage' ? 'may manage' : 'may use'}</span><button type="button" class="btn small" data-unshare="${esc(s.kind)}:${esc(s.who)}">Remove</button></div>`).join('') || `<p class="hint">${ext ? 'Only you. Share it with a friend to manage it with you; who may chat with it is set in its Brain tab.' : 'Only you. Share it with a friend, or with everyone of a role.'}</p>`}</div>
      ${ext && !fr.length ? '<p class="hint">To share it, add the person as a friend first (People → Friends).</p>' : `<div class="ss-add"><select class="input ss-who" aria-label="With whom">${fr.map(f => `<option value="account:${f.id}">${esc(f.name)}</option>`).join('')}${ext ? '' : '<option value="role:member">Every member</option><option value="role:admin">Every administrator</option>'}</select>
        <select class="input ss-level" aria-label="What they may do">${ext ? '' : '<option value="use">may use (chat, see it work)</option>'}<option value="manage">may manage (all of this but removing or sharing it)</option></select><button type="button" class="btn" data-c="share">Share</button></div>`}</div>`
    : mg ? `<div class="st-sec"><p class="hint">${esc(r.name)} is shared with you to manage. Only its owner shares it with others${ext ? ' or disconnects it' : ' or removes it'}.</p></div>` : '';
  const danger = own && !ext ? `<details class="st-sec ss-danger"><summary><h4>⚠ Remove ${esc(r.name)}</h4></summary><p class="hint">Its body leaves the city; its history is kept. Type its name to confirm.</p>
      <div class="row"><input class="input ss-confirm" placeholder="${esc(r.name)}" aria-label="Type its name"><button type="button" class="btn danger" data-c="remove">Remove it</button></div></details>` : '';
  body.innerHTML = `<div class="ss">${identity}${share}${danger}</div>`;
  const q = s => body.querySelector(s);
  body.querySelectorAll('[data-emoji]').forEach(b => { b.onclick = () => { st.emoji = b.dataset.emoji; body.querySelectorAll('[data-emoji]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); q('.ss-badge').textContent = st.emoji; }; });
  const other = q('.ss-emoji');
  if (other) other.oninput = () => { const v = other.value.trim(); if (v) { st.emoji = v; q('.ss-badge').textContent = v; body.querySelectorAll('[data-emoji]').forEach(x => x.classList.remove('on')); } };
  const save = q('[data-c="save-id"]');
  if (save) save.onclick = async () => {
    const name = q('.ss-name').value.trim();
    if (!name) return C.say('It needs a name', true);
    if (await C.call('/api/agents/update', { id: C.id, name, role: q('.ss-role').value.trim(), emoji: st.emoji }, 'Saved')) { await reloadAgents(); C.st.set = null; C.head(); C.repaint(); }
  };
  for (const x of body.querySelectorAll('.st-sec [data-go]')) x.onclick = () => C.go(x.dataset.go);
  body.querySelectorAll('[data-unshare]').forEach(b => {
    b.onclick = async () => {
      if (!C.armed(b, 'Sure?')) return;
      const [kind, ...rest] = b.dataset.unshare.split(':');
      if (await C.call('/api/agents/unshare', { id: C.id, kind, who: rest.join(':') }, 'No longer shared')) { await reloadAgents(); C.repaint(); }
    };
  });
  const sh = q('[data-c="share"]');
  if (sh) sh.onclick = async () => {
    const [kind, who] = q('.ss-who').value.split(':');
    if (kind === 'role' && q('.ss-level').value === 'manage') return C.say('Everyone of a role may use it; share it to manage with a person.', true);
    if (await C.call('/api/agents/share', { id: C.id, kind, who, level: q('.ss-level').value }, 'Shared')) { await reloadAgents(); C.repaint(); }
  };
  const rm = q('[data-c="remove"]');
  if (rm) rm.onclick = async () => {
    if (q('.ss-confirm').value.trim() !== r.name) return C.say(`Type “${r.name}” to confirm`, true);
    if (await C.call('/api/agents/remove', { id: C.id }, `${r.name} has left the city`)) { await reloadAgents(); C.app.studio?.close(); bus.emit('agentlist'); }
  };
}
