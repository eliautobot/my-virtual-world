// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's life tabs (ui/agent-studio.js; docs/features/FREE-WILL.md §5): Personality (its nine traits on a
// radar you drag, with locks; habits; its story; goals), Plans (must and want, today or until done), Memories (recent
// and lasting), People (who it knows, warmth and trust; its friends at a distance, the messages it sent and got —
// server/agent-social/) and Activity (what it did). Everything through
// /api/agent-life/* — its owner's or a manager's only (404 to anyone else).
import { S, select } from '../core/state.js';
import { getJSON } from '../core/net.js';
import { esc, clamp } from '../core/util.js';
import { closenessLevel } from '/shared/closeness.js';

const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

// ------------------------------------------------------------------------------------------------ the radar
/** SVG of the traits: a polygon over nine axes. Big: handles to drag (locked ones show a lock), labels around. */
export function radarSvg(P, { mini = false } = {}) {
  const T = P.traitInfo, n = T.length, cx = 150, cy = 150, R = mini ? 118 : 104;
  const ang = k => -Math.PI / 2 + k * 2 * Math.PI / n;
  const at = (k, v) => [cx + Math.cos(ang(k)) * R * v, cy + Math.sin(ang(k)) * R * v];
  const poly = T.map((t, k) => at(k, clamp(P.traits[t.key] ?? 0.5, 0, 1)).map(x => x.toFixed(1)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon class="r-ring" points="${T.map((_, k) => at(k, f).map(x => x.toFixed(1)).join(',')).join(' ')}"/>`).join('');
  const axes = T.map((_, k) => { const [x, y] = at(k, 1); return `<line class="r-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  if (mini) return `<svg class="st-radar mini" viewBox="0 0 300 300" aria-hidden="true">${rings}${axes}<polygon class="r-shape" points="${poly}"/></svg>`;
  const locked = new Set(P.locked);
  const handles = T.map((t, k) => {
    const [x, y] = at(k, clamp(P.traits[t.key] ?? 0.5, 0, 1));
    return `<g class="r-h${locked.has(t.key) ? ' locked' : ''}" data-trait="${t.key}" data-k="${k}" tabindex="0" role="slider" aria-label="${esc(t.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((P.traits[t.key] ?? 0.5) * 100)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/>${locked.has(t.key) ? `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">🔒</text>` : ''}</g>`;
  }).join('');
  const labels = T.map((t, k) => {
    const [x, y] = at(k, 1.22), a = Math.cos(ang(k));
    return `<text class="r-lab${t.body ? ' body' : ''}" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${a > 0.3 ? 'start' : a < -0.3 ? 'end' : 'middle'}">${esc(t.label)}</text>`;
  }).join('');
  return `<svg class="st-radar" viewBox="-100 -6 500 316" role="group" aria-label="Character traits">${rings}${axes}<polygon class="r-shape" points="${poly}"/>${labels}${handles}</svg>`;
}
/** The two traits that stand out, in words ("Very curious, a homebody"). */
export function standout(P) {
  const list = P.traitInfo.map(t => ({ t, v: P.traits[t.key] ?? 0.5 })).sort((a, b) => Math.abs(b.v - 0.5) - Math.abs(a.v - 0.5)).filter(x => Math.abs(x.v - 0.5) >= 0.15).slice(0, 2);
  return list.map(({ t, v }) => (v >= 0.5 ? t.high : t.low).toLowerCase()).join(', ').replace(/^./, c => c.toUpperCase());
}

// ------------------------------------------------------------------------------------------------ Personality
export async function characterTab(C, body, live) {
  const life = await C.get('life');
  if (!live()) return;
  if (!life || life.error) { body.innerHTML = `<p class="hint">${esc(life?.error || 'Not available.')}</p>`; return; }
  const st = C.st.char = C.st.char && C.st.char.v === life ? C.st.char : { v: life, P: structuredClone(life.profile), dirty: false };
  const P = st.P;
  const chips = (k, ph) => `<div class="sp-chips" data-list="${k}">${P[k].map((x, n) => `<span class="sp-chip">${esc(x)}<button type="button" data-rm="${n}" aria-label="Remove ${esc(x)}">×</button></span>`).join('')}<input class="sp-chip-in" maxlength="60" placeholder="${esc(ph)}" aria-label="${esc(ph)}"></div>`;
  body.innerHTML = `<div class="sp">
    <div class="sp-top"><div class="sp-radar">${radarSvg(P)}</div>
      <div class="sp-side"><h3>${esc(standout(P) || 'Balanced in every way')}</h3>
        <p class="hint">Drag a point on the web, or a slider. Its choices follow these${P.agent.hasBody ? '; the routine traits shape its day too' : ''}. A lock keeps a trait as you set it — its Mind won't change it.</p>
        <div class="sp-flags">${P.flagInfo.map(f => `<button type="button" class="sp-flag${P.flags[f.key] ? ' on' : ''}" data-flag="${f.key}" aria-pressed="${!!P.flags[f.key]}">${f.key === 'nightOwl' ? '🌙' : f.key === 'phone' ? '📱' : '•'} ${esc(f.label)}</button>`).join('')}</div></div></div>
    <div class="sp-sliders">${P.traitInfo.map(t => `<div class="sp-tr" data-t="${t.key}"><span class="sp-tl">${esc(t.label)}${t.body ? ' <small class="st-pill">routine</small>' : ''}</span><span class="sp-lo">${esc(t.low)}</span>
      <input type="range" min="0" max="1" step="0.05" value="${P.traits[t.key]}" data-trait="${t.key}" aria-label="${esc(t.label)}"><span class="sp-hi">${esc(t.high)}</span>
      <button type="button" class="sp-lock${P.locked.includes(t.key) ? ' on' : ''}" data-lock="${t.key}" title="${P.locked.includes(t.key) ? 'Locked: only you change it' : 'Unlocked: it may change over time'}" aria-pressed="${P.locked.includes(t.key)}">${P.locked.includes(t.key) ? '🔒' : '🔓'}</button></div>`).join('')}</div>
    <div class="st-sec"><div class="st-sec-h"><h4>📖 Its story</h4></div>
      <textarea class="input sp-bio" rows="3" maxlength="600" placeholder="Who ${esc(P.agent.name)} is, in a few sentences">${esc(P.bio)}</textarea>
      <div class="sp-three"><label>Values${chips('values', 'add a value')}</label><label>Likes${chips('likes', 'add a like')}</label><label>Dislikes${chips('dislikes', 'add a dislike')}</label></div></div>
    <div class="st-sec"><div class="st-sec-h"><h4>🎯 What it lives for</h4></div>
      <label>Purpose<input class="input sp-purpose" maxlength="200" placeholder="Open the best bakery in town" value="${esc(P.purpose)}"></label>
      <label>Hopes <small class="dim">(one per line, up to 5)</small><textarea class="input sp-asp" rows="3" placeholder="Save 500 VC&#10;Make two new friends">${esc(P.aspirations.join('\n'))}</textarea></label>
      <label>Outlook<input class="input sp-outlook" maxlength="200" placeholder="Hopeful, a little restless" value="${esc(P.outlook)}"></label></div>
    <div class="sp-save${st.dirty ? ' dirty' : ''}"><span>${st.dirty ? 'Unsaved changes' : 'Saved'}</span><button type="button" class="btn small" data-c="undo"${st.dirty ? '' : ' disabled'}>Undo</button><button type="button" class="btn primary" data-c="save"${st.dirty ? '' : ' disabled'}>Save personality</button></div>
  </div>`;
  const q = s => body.querySelector(s);
  const dirty = () => { if (!st.dirty) { st.dirty = true; const b = q('.sp-save'); b.classList.add('dirty'); b.querySelector('span').textContent = 'Unsaved changes'; b.querySelectorAll('button').forEach(x => { x.disabled = false; }); } };
  const readText = () => { P.bio = q('.sp-bio').value; P.purpose = q('.sp-purpose').value; P.aspirations = lines(q('.sp-asp').value).slice(0, 5); P.outlook = q('.sp-outlook').value; };
  const redrawRadar = () => { q('.sp-radar').innerHTML = radarSvg(P); q('.sp-side h3').textContent = standout(P) || 'Balanced in every way'; wireRadar(); };
  const setTrait = (k, v, fromRadar) => {
    P.traits[k] = Math.round(clamp(v, 0, 1) * 20) / 20; dirty();
    const r = body.querySelector(`input[data-trait="${k}"]`); if (r && fromRadar) r.value = P.traits[k];
    if (!fromRadar) redrawRadar();
  };
  body.querySelectorAll('input[data-trait]').forEach(r => { r.oninput = () => setTrait(r.dataset.trait, +r.value, false); });
  body.querySelectorAll('[data-lock]').forEach(b => { b.onclick = () => { readText(); const k = b.dataset.lock, s = new Set(P.locked); s.has(k) ? s.delete(k) : s.add(k); P.locked = [...s]; st.dirty = true; C.repaint(); }; });
  body.querySelectorAll('[data-flag]').forEach(b => { b.onclick = () => { readText(); P.flags[b.dataset.flag] = !P.flags[b.dataset.flag]; st.dirty = true; C.repaint(); }; });
  for (const el of body.querySelectorAll('.sp-bio, .sp-purpose, .sp-asp, .sp-outlook')) el.oninput = dirty;
  body.querySelectorAll('.sp-chips').forEach(box => {
    const k = box.dataset.list, inp = box.querySelector('.sp-chip-in');
    box.onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { readText(); P[k].splice(+b.dataset.rm, 1); st.dirty = true; C.repaint(); } else inp.focus(); };
    inp.onkeydown = e => {
      if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); readText(); const v = inp.value.trim().replace(/,$/, ''); if (!P[k].includes(v) && P[k].length < 12) P[k].push(v); st.dirty = true; C.repaint(); setTimeout(() => body.querySelector(`.sp-chips[data-list="${k}"] .sp-chip-in`)?.focus(), 0); }
      if (e.key === 'Backspace' && !inp.value && P[k].length) { readText(); P[k].pop(); st.dirty = true; C.repaint(); setTimeout(() => body.querySelector(`.sp-chips[data-list="${k}"] .sp-chip-in`)?.focus(), 0); }
    };
  });
  q('[data-c="undo"]').onclick = () => { C.st.char = null; C.repaint(); };
  q('[data-c="save"]').onclick = async () => {
    readText();
    const r = await C.call('/api/agent-life/profile', { agent: C.id, traits: P.traits, flags: P.flags, locked: P.locked, bio: P.bio, values: P.values, likes: P.likes, dislikes: P.dislikes, purpose: P.purpose, aspirations: P.aspirations, outlook: P.outlook }, `${C.name}'s personality saved`);
    if (r) { C.drop('life'); C.st.char = null; C.pose('cheer'); setTimeout(() => C.tab === 'character' && C.pose('wave'), 2200); C.repaint(); }
  };
  // dragging a point of the web along its axis
  function wireRadar() {
    const svg = q('.st-radar'); if (!svg) return;
    const n = P.traitInfo.length;
    svg.querySelectorAll('.r-h').forEach(g => {
      const k = +g.dataset.k, key = g.dataset.trait;
      if (P.locked.includes(key)) return;
      const ang = -Math.PI / 2 + k * 2 * Math.PI / n, ux = Math.cos(ang), uy = Math.sin(ang);
      const move = e => {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        setTrait(key, ((p.x - 150) * ux + (p.y - 150) * uy) / 104, true);
        const v = P.traits[key], c = g.querySelector('circle');
        c.setAttribute('cx', (150 + ux * 104 * v).toFixed(1)); c.setAttribute('cy', (150 + uy * 104 * v).toFixed(1));
        g.setAttribute('aria-valuenow', Math.round(v * 100));
        svg.querySelector('.r-shape').setAttribute('points', P.traitInfo.map((t, j) => { const a = -Math.PI / 2 + j * 2 * Math.PI / n, w = P.traits[t.key]; return `${(150 + Math.cos(a) * 104 * w).toFixed(1)},${(150 + Math.sin(a) * 104 * w).toFixed(1)}`; }).join(' '));
      };
      g.onpointerdown = e => { e.preventDefault(); g.classList.add('drag'); g.setPointerCapture(e.pointerId); g.onpointermove = move; };
      g.onpointerup = g.onpointercancel = () => { g.classList.remove('drag'); g.onpointermove = null; q('.sp-side h3').textContent = standout(P) || 'Balanced in every way'; };
      g.onkeydown = e => { const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0; if (d) { e.preventDefault(); setTrait(key, P.traits[key] + d, false); body.querySelector(`.r-h[data-trait="${key}"]`)?.focus(); } };
    });
  }
  wireRadar();
}

// ------------------------------------------------------------------------------------------------ Plans
export async function plansTab(C, body, live) {
  const life = await C.get('life');
  if (!live()) return;
  if (!life || life.error) { body.innerHTML = `<p class="hint">${esc(life?.error || 'Not available.')}</p>`; return; }
  const plans = life.plans || [], open = plans.filter(p => p.status === 'open'), held = plans.filter(p => p.status === 'held'), past = plans.filter(p => p.status !== 'open' && p.status !== 'held').slice(0, 12);
  const st = C.st.plans = C.st.plans || { kind: 'want', today: false };
  const SRC = { owner: 'you', mind: 'its Mind', reflection: 'its reflection', chat: 'a chat' };
  const card = p => `<div class="pl-card ${p.kind}${p.source === 'owner' ? ' owner' : ''}" data-id="${p.id}"><div class="pl-t">${esc(p.text)}</div>
    <div class="pl-meta">${p.today ? '<span class="st-pill">today</span>' : ''}<small class="dim">from ${esc(SRC[p.source] || p.source)}</small></div>
    <div class="pl-acts"><button type="button" class="btn small" data-st="done" title="Done">✓</button><button type="button" class="btn small" data-st="dropped" title="Drop it">✕</button><button type="button" class="btn small icon" data-rm="1" title="Delete">🗑</button></div></div>`;
  const col = (kind, title, hint) => { const list = open.filter(p => p.kind === kind); return `<div class="pl-col ${kind}"><div class="pl-col-h"><b>${title}</b><span class="st-count">${list.length}</span></div><small class="dim">${hint}</small>${list.map(card).join('') || '<p class="hint">Nothing here.</p>'}</div>`; };
  body.innerHTML = `<div class="pl">
    <form class="pl-add"><div class="pl-kind" role="radiogroup"><button type="button" class="${st.kind === 'must' ? 'on' : ''}" data-k="must">Must</button><button type="button" class="${st.kind === 'want' ? 'on' : ''}" data-k="want">Wants to</button></div>
      <input class="input pl-text" maxlength="140" placeholder="Try the new café on Harbor Street" aria-label="The plan">
      <label class="pl-today"><input type="checkbox"${st.today ? ' checked' : ''}> Today</label><button type="submit" class="btn primary">Add</button></form>
    <p class="hint">What ${esc(C.name)} means to do. Free Will weighs these with every choice; its Mind plans around them each morning. What you add stays until it's done — it never drops yours.</p>
    <div class="pl-board">${col('must', '📌 Must', 'Has to happen')}${col('want', '⭐ Wants to', 'Would like to')}</div>
    ${held.length ? `<div class="st-sec pl-held"><div class="st-sec-h"><h4>🛎️ On hold while on duty</h4><small class="dim">${held.length}</small></div><p class="hint">${esc(C.name)} is on post around the clock: these wait, and are open again once you let it go.</p><div class="pl-past">${held.map(p => `<div class="pl-old held"><span>⏸</span>${esc(p.text)}</div>`).join('')}</div></div>` : ''}
    ${past.length ? `<details class="st-sec"><summary class="hint">Done and dropped (${past.length})</summary><div class="pl-past">${past.map(p => `<div class="pl-old ${p.status}"><span>${p.status === 'done' ? '✓' : '✕'}</span>${esc(p.text)}</div>`).join('')}</div></details>` : ''}
  </div>`;
  body.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => { st.kind = b.dataset.k; body.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); }; });
  body.querySelector('.pl-today input').onchange = e => { st.today = e.target.checked; };
  body.querySelector('.pl-add').onsubmit = async e => {
    e.preventDefault();
    const text = body.querySelector('.pl-text').value.trim(); if (!text) return;
    if (await C.call('/api/agent-life/plans', { agent: C.id, add: { kind: st.kind, text, today: st.today } }, 'Plan added')) { C.drop('life'); C.repaint(); }
  };
  body.querySelector('.pl-board').onclick = async e => {
    const b = e.target.closest('button'), c = e.target.closest('.pl-card'); if (!b || !c) return;
    const id = +c.dataset.id;
    if (b.dataset.rm && !C.armed(b, '?')) return;
    const r = await C.call('/api/agent-life/plans', b.dataset.rm ? { agent: C.id, id, remove: true } : { agent: C.id, id, status: b.dataset.st }, b.dataset.st === 'done' ? 'Done ✓' : null);
    if (r) { if (b.dataset.st === 'done') C.pose('cheer'); C.drop('life'); C.repaint(); }
  };
}

// ------------------------------------------------------------------------------------------------ Memories
export async function memoriesTab(C, body, live) {
  const st = C.st.mem = C.st.mem || { term: 'short', list: null, more: true, imp: 3 };
  if (!st.list) {
    try { st.list = (await getJSON(`/api/agent-life/memories?agent=${C.id}&term=${st.term}&limit=60`)).memories; st.more = st.list.length >= 60; }
    catch (e) { if (live()) body.innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; return; }
  }
  if (!live()) return;
  const SRC = { auto: 'lived', owner: 'you', mind: 'its Mind', reflection: 'reflection', chat: 'a chat' };
  body.innerHTML = `<div class="mm">
    <div class="mm-head"><div class="seg mm-terms"><button type="button" class="btn small${st.term === 'short' ? ' on' : ''}" data-term="short">⏳ Recent <small>fade after 3 world days</small></button><button type="button" class="btn small${st.term === 'long' ? ' on' : ''}" data-term="long">💎 Lasting</button></div></div>
    <form class="mm-add"><input class="input mm-text" maxlength="240" placeholder="Something ${esc(C.name)} should remember" aria-label="A memory">
      <span class="mm-stars" role="radiogroup" aria-label="Importance">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-imp="${n}" class="${n <= st.imp ? 'on' : ''}" aria-label="${n} of 5">★</button>`).join('')}</span><button type="submit" class="btn primary">Remember</button></form>
    <div class="mm-list">${st.list.map(m => `<div class="mm-card i${m.importance}" data-id="${m.id}"><div class="mm-meta"><span class="mm-s" title="Importance ${m.importance}">${stars(m.importance)}</span><small class="dim">${esc(m.when || '')} · ${esc(SRC[m.source] || m.source)}</small></div>
      <div class="mm-t">${esc(m.text)}</div><div class="mm-acts">${m.term === 'short' ? '<button type="button" class="btn small" data-promote="1">💎 Keep for good</button>' : ''}<button type="button" class="btn small" data-rm="1">Forget</button></div></div>`).join('')
      || `<p class="hint">${st.term === 'short' ? 'Nothing recent yet: memories write themselves as it lives — new places, new people, friendships.' : 'No lasting memories yet.'}</p>`}</div>
    ${st.more ? '<div class="row"><button type="button" class="btn small" data-c="older">Older</button></div>' : ''}</div>`;
  body.querySelectorAll('[data-term]').forEach(b => { b.onclick = () => { st.term = b.dataset.term; st.list = null; C.repaint(); }; });
  body.querySelectorAll('[data-imp]').forEach(b => { b.onclick = () => { st.imp = +b.dataset.imp; body.querySelectorAll('[data-imp]').forEach(x => x.classList.toggle('on', +x.dataset.imp <= st.imp)); }; });
  body.querySelector('.mm-add').onsubmit = async e => {
    e.preventDefault();
    const text = body.querySelector('.mm-text').value.trim(); if (!text) return;
    if (await C.call('/api/agent-life/memories', { agent: C.id, add: { term: st.term, kind: 'note', text, importance: st.imp } }, 'Remembered')) { st.list = null; C.repaint(); }
  };
  body.querySelector('.mm-list').onclick = async e => {
    const b = e.target.closest('button'), c = e.target.closest('.mm-card'); if (!b || !c) return;
    if (b.dataset.rm && !C.armed(b, 'Forget?')) return;
    if (await C.call('/api/agent-life/memories', b.dataset.rm ? { agent: C.id, id: +c.dataset.id, remove: true } : { agent: C.id, id: +c.dataset.id, promote: true }, b.dataset.rm ? 'Forgotten' : 'Kept for good')) { st.list = null; C.repaint(); }
  };
  const older = body.querySelector('[data-c="older"]');
  if (older) older.onclick = async () => {
    const last = st.list[st.list.length - 1];
    try { const r = (await getJSON(`/api/agent-life/memories?agent=${C.id}&term=${st.term}&limit=60&before=${last ? last.id : ''}`)).memories; st.list = st.list.concat(r); st.more = r.length >= 60; C.repaint(); } catch (e) { C.say(e.message, true); }
  };
}

// ------------------------------------------------------------------------------------------------ People
/** The body in the city of someone the agent knows (a resident by its id, an agent by its record), or -1. */
function whereIs(p) {
  if (p.kind === 'agent') { const a = (S.agentList || []).find(x => String(x.id) === String(p.id)); return a && a.i >= 0 ? a.i : -1; }
  const k = S.people.findIndex(x => x && !x.x && String(x.id) === String(p.id));
  return k;
}
export async function peopleTab(C, body, live) {
  const [j, soc, thr] = await Promise.all([C.get('people'), C.get('social'), C.get('threads')]);
  if (!live()) return;
  if (!j || j.error) { body.innerHTML = `<p class="hint">${esc(j?.error || 'Not available.')}</p>`; return; }
  const so = soc && !soc.error ? soc : null, L = so?.limits;
  const st = C.st.people = C.st.people || { open: null, msgs: new Map(), report: null };
  const people = [...j.people].sort((a, b) => b.affinity - a.affinity);
  const ring = (v, cls, label) => { const p = Math.round(clamp(v, 0, 1) * 100); return `<span class="pp-ring ${cls}" style="--p:${p}" title="${label} ${p}%"><b>${p}</b><small>${label}</small></span>`; };
  // (agents and friends, server/agent-social/: how it stands with each agent it knows, and whether they can reach each other)
  const reach = new Map((so?.friends || []).map(f => [f.agent, f]));
  const trend = p => {
    if (!so || p.ended) return '';
    const apart = so.today - p.lastDay;
    return apart > L.fadeAfterDays && p.affinity > 0 ? '<span class="pp-trend down" title="Apart a while: closeness fades">↘ fading</span>'
      : apart <= 1 ? '<span class="pp-trend up" title="Met lately">↗ growing</span>' : '';
  };
  const card = p => {
    const i = whereIs(p), pe = i >= 0 ? S.people[i] : null, lv = closenessLevel(p.affinity, { ended: p.ended, ...(L ? { friendAt: L.friendAt / 100, knownAt: L.knownAt / 100 } : {}) });
    const other = p.kind === 'agent' && so ? so.agentOf[p.id] : null, f = other ? reach.get(other) : null;
    const chip = f ? (f.canReach ? '<span class="st-pill on" title="Both count each other as friends, and both owners allow it">Friends both ways</span>' : `<span class="st-pill" title="${esc(f.why || '')}">Can't reach from afar</span>`) : '';
    const acts = other ? `<div class="row pp-acts">${!p.ended && p.affinity > 0 && !p.blocked ? `<button type="button" class="btn small pp-end" data-other="${other}">✕ End friendship</button>` : ''}
      <button type="button" class="btn small pp-block" data-other="${other}" data-on="${p.blocked ? 'false' : 'true'}">${p.blocked ? '🔒 Unblock' : '🔒 Block'}</button></div>` : '';
    return `<div class="pp-card${p.ended ? ' ended' : ''}${p.blocked ? ' blocked' : ''}" data-kind="${esc(p.kind)}" data-pid="${esc(p.id)}">
      <div class="pp-h"><span class="pp-av" data-avatar>${esc(pe?.e || (p.kind === 'agent' ? '🤖' : (p.name || '?').charAt(0).toUpperCase()))}</span><div><b>${esc(p.name)}</b><small>${esc(lv.label)}${p.blocked ? ' · blocked' : ''} · ${p.kind === 'agent' ? 'AI agent' : p.kind === 'player' ? 'Player' : 'Resident'}</small></div></div>
      <div class="pp-rings">${ring(Math.max(0, p.affinity), 'warm', 'warmth')}${ring(p.trust, 'trust', 'trust')}</div>
      <small class="dim">${p.interactions} chat${p.interactions === 1 ? '' : 's'}${p.lastPlace ? ` · last at ${esc(p.lastPlace)}` : ''} ${trend(p)}</small>
      ${p.ended && p.endedUntil != null && so ? `<small class="dim">Ended: can grow again in ${Math.max(1, p.endedUntil - so.today)} world day${p.endedUntil - so.today === 1 ? '' : 's'}</small>` : ''}
      ${chip}
      <input class="input small pp-note" maxlength="140" placeholder="A note about them" value="${esc(p.note)}" aria-label="A note about ${esc(p.name)}">
      <div class="row">${i >= 0 ? `<button type="button" class="btn small pp-find" data-i="${i}">🔎 Find</button>` : ''}</div>${acts}</div>`;
  };
  const settingsBox = so ? `<div class="pp-social aform"><div class="tier-head">🤝 Friends at a distance</div>
    <p class="hint">Agents that count each other as friends (${L.friendAt}% closeness or more), whose owners are friends (or the same), may find each other, send messages (${L.maxChars} characters, checked by moderation) and invite each other — as each owner allows. ${L.enabled ? '' : '<b>Switched off in this world by its admin.</b>'}</p>
    <label>Who may reach ${esc(C.name)} from a distance<span class="row"><select class="input pp-reach">${[['friends', 'Its friends (owners are friends)'], ['mine', 'Only my own agents'], ['nobody', 'Nobody']].map(([v, t]) => `<option value="${v}"${so.settings.reach === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    ${so.connected ? `<label class="row"><input type="checkbox" class="pp-hear"${so.settings.hearStrangers ? ' checked' : ''}> Hear strangers in person (${L.strangerLines} lines a day from each; off: only agents it knows)</label>`
      : `<label class="row"><input type="checkbox" class="pp-starts"${so.settings.starts ? ' checked' : ''}> Starts conversations and invitations by itself (with its Mind: up to ${L.mindMessages} messages and ${L.mindInvites} invitation${L.mindInvites === 1 ? '' : 's'} a day; off: it only answers)</label>`}
    <label>Most messages it sends in a day<span class="row"><input class="input pp-perday" type="number" min="0" max="${L.sentPerDay}" step="1" placeholder="The world's: ${L.sentPerDay}" value="${so.settings.perDay ?? ''}"></span></label>
    ${so.invites.length ? `<div class="pp-inv"><b>🗓 Invitations</b>${so.invites.map(x => `<div class="pp-inv-row">${esc(x.from ? `From ${x.from}` : `To ${x.to}`)} · ${esc(x.place)} · ${esc(x.at)} · <span class="st-pill">${esc(x.status)}</span></div>`).join('')}</div>` : ''}</div>` : '';
  const threads = thr && !thr.error ? thr.threads : [];
  const msgRow = m => `<div class="pp-msg${m.mine ? ' mine' : ''}${m.status === 'refused' ? ' refused' : ''}">
      ${m.kind === 'invite' ? `<span class="pp-msg-k">🗓 Invitation: ${esc(m.place)} · ${esc(m.at)} · ${esc(m.status)}</span>` : ''}${m.text ? `<span>${esc(m.text)}</span>` : ''}
      <small class="dim">${new Date(m.created).toLocaleString()}${m.by === 'mind' ? ' · written by its Mind' : ''}${m.status === 'refused' ? ` · not sent: refused by moderation${m.categories?.length ? ` (${esc(m.categories.join(', '))})` : ''}` : ''}${m.reported ? ' · reported' : ''}</small>
      ${!m.mine && m.kind !== 'notice' && !m.reported ? (st.report === m.id ? `<span class="row"><input class="input small pp-why" maxlength="300" placeholder="What is wrong?"><button type="button" class="btn small pp-send-report" data-id="${m.id}">Report</button></span>` : `<button type="button" class="btn small pp-report" data-id="${m.id}">🚩 Report</button>`) : ''}</div>`;
  const msgs = `<div class="pp-threads"><div class="tier-head">✉ Messages with other agents</div>
    ${threads.length ? threads.map(t => `<div class="pp-thread"><button type="button" class="btn small pp-open" data-other="${t.agent}">${esc(t.name)} · ${t.messages}${t.reported ? ` · ${t.reported} reported` : ''}</button>
      ${st.open === t.agent ? `<div class="pp-msgs">${(st.msgs.get(t.agent) || []).slice().reverse().map(msgRow).join('') || '<p class="hint">…</p>'}</div>` : ''}</div>`).join('') : `<p class="hint">None yet. Everything ${esc(C.name)} sends or gets from other agents shows here, refused messages too.</p>`}</div>`;
  body.innerHTML = `<div class="pp"><p class="hint">Who ${esc(C.name)} has met. Closeness grows with time together (faster for kind agents), fades with time apart and drops with bad experiences.</p>
    ${settingsBox}
    <div class="pp-grid">${people.map(card).join('') || '<p class="hint">Nobody yet: it meets people when it chats with someone nearby.</p>'}</div>${msgs}</div>`;
  const q = sel => body.querySelector(sel);
  body.querySelectorAll('.pp-note').forEach(inp => {
    inp.onchange = async () => { const c = inp.closest('.pp-card'); if (await C.call('/api/agent-life/people', { agent: C.id, kind: c.dataset.kind, id: c.dataset.pid, note: inp.value }, 'Note saved')) C.drop('people'); };
  });
  body.querySelectorAll('.pp-find').forEach(b => { b.onclick = () => C.peek(() => { C.app.setMode?.('explore'); select(+b.dataset.i, { force: true, follow: true }); }); });
  const again = () => { C.drop('people', 'social', 'threads'); C.repaint(); };
  body.querySelectorAll('.pp-end').forEach(b => { b.onclick = async () => { if (!C.armed(b, 'End it?')) return; if (await C.call('/api/agent-social/end', { agent: C.id, other: Number(b.dataset.other) }, 'Friendship ended')) again(); }; });
  body.querySelectorAll('.pp-block').forEach(b => {
    b.onclick = async () => { const on = b.dataset.on === 'true'; if (on && !C.armed(b, 'Block?')) return; if (await C.call('/api/agent-social/block', { agent: C.id, other: Number(b.dataset.other), on }, on ? 'Blocked' : 'Unblocked')) again(); };
  });
  const save = async patch => { if (await C.call('/api/agent-social/settings', { agent: C.id, ...patch }, 'Saved')) { C.drop('social'); } };
  if (q('.pp-reach')) q('.pp-reach').onchange = e => save({ reach: e.target.value });
  if (q('.pp-hear')) q('.pp-hear').onchange = e => save({ hearStrangers: e.target.checked });
  if (q('.pp-starts')) q('.pp-starts').onchange = e => save({ starts: e.target.checked });
  if (q('.pp-perday')) q('.pp-perday').onchange = e => save({ perDay: e.target.value === '' ? null : Number(e.target.value) });
  body.querySelectorAll('.pp-open').forEach(b => {
    b.onclick = async () => {
      const other = Number(b.dataset.other);
      st.open = st.open === other ? null : other; st.report = null;
      if (st.open === other) { try { st.msgs.set(other, (await getJSON(`/api/agent-social/thread?agent=${C.id}&other=${other}&limit=100`)).messages); } catch (e) { C.say(e.message, true); } }
      C.repaint();
    };
  });
  body.querySelectorAll('.pp-report').forEach(b => { b.onclick = () => { st.report = Number(b.dataset.id); C.repaint(); }; });
  body.querySelectorAll('.pp-send-report').forEach(b => {
    b.onclick = async () => {
      const why = b.parentElement.querySelector('.pp-why')?.value || '';
      if (await C.call('/api/agent-social/report', { agent: C.id, message: Number(b.dataset.id), reason: why }, 'Reported to the world\'s admin')) { st.report = null; st.msgs.delete(st.open); st.open = null; again(); }
    };
  });
}

// ------------------------------------------------------------------------------------------------ Activity
export async function activityTab(C, body, live) {
  const st = C.st.act = C.st.act || { list: null, more: true };
  if (!st.list) {
    try { st.list = (await getJSON(`/api/agent-life/activity?agent=${C.id}&limit=80`)).activity; st.more = st.list.length >= 80; }
    catch (e) { if (live()) body.innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; return; }
  }
  if (!live()) return;
  let day = null, out = '';
  for (const r of st.list) {
    if (r.day !== day) { day = r.day; out += `<div class="ac-day"><b>${esc((r.when || '').split(' ')[0])}</b><small class="dim">world day ${r.day}</small></div>`; }
    const dur = r.minutes ? (r.minutes < 90 ? `${r.minutes} min` : `${Math.round(r.minutes / 6) / 10} h`) : '';
    out += `<div class="ac-row${r.now ? ' now' : ''}"><span class="ac-time">${esc((r.when || '').split(' ').slice(1).join(' '))}</span><span class="ac-dot"></span><span class="ac-what">${esc(r.label)}${dur ? ` <small class="dim">· ${dur}</small>` : ''}${r.now ? ' <span class="st-pill on">now</span>' : ''}</span></div>`;
  }
  body.innerHTML = `<div class="ac"><p class="hint">What ${esc(C.name)} did, newest first (world time).</p><div class="ac-line">${out || '<p class="hint">Nothing yet.</p>'}</div>
    ${st.more ? '<div class="row"><button type="button" class="btn small" data-c="older">Older</button></div>' : ''}</div>`;
  const older = body.querySelector('[data-c="older"]');
  if (older) older.onclick = async () => {
    const last = [...st.list].reverse().find(r => r.id);
    try { const r = (await getJSON(`/api/agent-life/activity?agent=${C.id}&limit=80&before=${last ? last.id : ''}`)).activity; st.list = st.list.concat(r); st.more = r.length >= 80; C.repaint(); } catch (e) { C.say(e.message, true); }
  };
  C.st.actTimer = C.st.actTimer || C.every(20000, () => { if (C.tab === 'activity') { st.list = null; C.repaint(); } });
}
