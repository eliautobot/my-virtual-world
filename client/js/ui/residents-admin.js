// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Settings → Residents (WP4.12, PLAN WP4.12): administrators create, edit and remove residents — name and look (the
// customizer), home (an apartment building, or any free home), work (an office or a venue, free time, or looking for
// work), work hours and the daily routine (waking, lunch, bedtime). Every change goes through /api/edit: undoable,
// in the activity log. Residents never hold title to land; they live and work in buildings (DECISIONS E25).
import { S } from '../core/state.js';
import { esc } from '../core/util.js';
import { post } from '../core/net.js';

const hhmm = v => { if (!Number.isFinite(v)) return ''; const h = Math.floor(v) % 24, m = Math.round((v % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`; };
const hours = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] + +m[2] / 60 : NaN; };
const moved = (a, b) => !Number.isFinite(b) || Math.abs(a - b) > 0.01;

export function residentsTab(app) {
  return (d, body) => {
    body.innerHTML = `
      <h4>🏠 How many live here</h4>
      <p class="hint">The city's homes decide: its residents fill this share of the beds in its apartment buildings. Offices, shops and restaurants bring jobs, which they take. New homes fill up over a world day or two; when homes go, or the share is lowered, people move away the same way.</p>
      <label class="tr-l">Homes filled<span class="row tr-row"><input type="range" class="pop-pct" min="0" max="100" step="1" value="30" aria-describedby="pop-stat"><output class="tr-v pop-v">30%</output></span></label>
      <p class="hint pop-stat" id="pop-stat">…</p>
      <label class="row pop-moves-l"><input type="checkbox" class="pop-moves" checked> Residents move between towns</label>
      <p class="hint">A few a world hour: to the town where they work, to a town with work when theirs has none, or away from a town that does much worse than another; newcomers choose a town by how well it does (the economy window shows each town's needs). Agents, and residents moved into a flat by its owner, stay.</p>
      <div class="sep"></div>
      <p class="hint">Create, change and remove residents. Homes and work places are free ones in the building you pick. Every change can be undone.</p>
      <div class="row"><input class="input rq" placeholder="Search residents" style="flex:1"> <button type="button" class="btn small primary rnew">➕ New resident</button></div>
      <div class="rlist scroll" style="max-height:220px;margin-top:6px"></div>
      <div class="rform"></div>`;
    const q = s => body.querySelector(s);
    // how many live here: the share of the homes, and the numbers as they are now
    const num = n => Number(n || 0).toLocaleString('en-US');
    const paintPop = async (force = false) => {
      let st = null; try { const r = await fetch('/api/population'); if (r.ok) st = await r.json(); } catch { /* offline */ }
      if (!st || !body.isConnected) return;
      if (force || document.activeElement !== q('.pop-pct')) { q('.pop-pct').value = st.pct; q('.pop-v').textContent = `${st.pct}%`; }
      const gap = st.target - st.residents;
      q('.pop-stat').textContent = `${num(st.beds)} beds in the city's homes · ${num(st.residents)} residents now, ${num(st.target)} at ${st.pct}%`
        + (gap > 0 ? ` — ${num(gap)} more moving in over the next world day or two` : gap < 0 ? ` — ${num(-gap)} moving away over the next world day or two` : ' — settled')
        + (st.homeless ? ` · ${num(st.homeless)} without a home (they move away after a world day if none frees up)` : '');
    };
    paintPop();
    // residents moving between towns (server/sim/migration.js): the setting as saved
    fetch('/api/settings').then(r => (r.ok ? r.json() : null)).then(v => { const e = v?.settings?.find(x => x.path === 'world.townMoves'); if (e && body.isConnected) { q('.pop-moves').checked = e.value !== false; q('.pop-moves').disabled = !e.canChange; } }).catch(() => {});
    q('.pop-moves').onchange = async () => {
      const on = q('.pop-moves').checked;
      try { await post('/api/settings', { values: { 'world.townMoves': on } }); app.toast?.(on ? 'Residents move between towns' : 'Residents stay in their towns', 'good'); }
      catch (e) { q('.pop-moves').checked = !on; if (!e.quiet) app.toast?.(e.message, 'bad'); }
    };
    const popTimer = setInterval(() => { if (!body.isConnected) clearInterval(popTimer); else paintPop(); }, 5000);
    q('.pop-pct').oninput = () => { q('.pop-v').textContent = `${q('.pop-pct').value}%`; };
    q('.pop-pct').onchange = async () => {
      try { await post('/api/settings', { values: { 'world.homesFilled': Number(q('.pop-pct').value) } }); app.toast?.(`Homes filled: ${q('.pop-pct').value}%`, 'good'); }
      catch (e) { if (!e.quiet) app.toast?.(e.message, 'bad'); }   // (the password asked again and not given: quiet)
      paintPop(true);   // (the share as saved)
    };
    const list = () => {
      const t = q('.rq').value.trim().toLowerCase(), B = S.world.buildings;
      const rows = (S.people || []).map((p, i) => ({ p, i })).filter(({ p }) => p && !p.x && (!t || p.n.toLowerCase().includes(t))).slice(0, 80);
      q('.rlist').innerHTML = rows.map(({ p, i }) => `<div class="ditem" role="button" data-i="${i}">${p.v ? '🤖' : '🧑'} ${esc(p.n)} <span class="dim">${esc(p.hb >= 0 ? B[p.hb]?.name || '' : 'no home')} · ${esc(p.jt || p.jk)}</span></div>`).join('') || '<p class="hint">Nobody by that name.</p>';
    };
    q('.rq').oninput = list;
    q('.rnew').onclick = () => app.openCustomizer?.({ kind: 'new' });
    q('.rlist').onclick = e => { const r = e.target.closest('[data-i]'); if (r) form(+r.dataset.i); };
    async function form(i) {
      const p = S.people[i]; if (!p) return;
      let info = {}; try { const r = await fetch(`/api/agent/${i}`); if (r.ok) info = await r.json(); } catch { /* offline: what the list knows */ }
      info.name = info.name || p.n;
      const B = S.world.buildings.filter(b => b && !b.gone);
      const homes = B.filter(b => b.type === 'apartment'), work = B.filter(b => b.type !== 'apartment' && b.type !== 'park');
      const agent = !!p.v, s = info.sched || {}, j = info.job || {};
      q('.rform').innerHTML = `<div class="sep"></div>
        <h4>${agent ? '🤖' : '🧑'} ${esc(info.name)}</h4>
        <label>Name<span class="row"><input class="input fn" maxlength="40" value="${esc(info.name)}"></span></label>
        <div class="row"><button type="button" class="btn small flook">🎨 Look</button></div>
        <label>Home<span class="row"><select class="input fh"><option value="">(keep)</option>${agent ? '' : '<option value="auto">Any free home</option>'}${homes.map(b => `<option value="${b.idx}"${info.home?.b === b.idx ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          <select class="input fu"></select></span></label>
        ${agent ? '<p class="hint">An agent&rsquo;s resident: its agent gives it its work; you choose the flat it lives in.</p>' : `
        <label>Work<span class="row"><select class="input fj"><option value="">(keep)</option><option value="free">Free time</option><option value="auto">Looking for work</option>${work.map(b => `<option value="${b.idx}"${j.b === b.idx ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></span></label>
        <label>Work hours<span class="row"><input class="input fs" value="${hhmm(j.start)}" placeholder="09:00" style="width:80px"> to <input class="input fe" value="${hhmm(j.end)}" placeholder="17:00" style="width:80px"></span></label>
        <label>Day<span class="row">wakes <input class="input fw" value="${hhmm(s.wake)}" style="width:72px"> lunch <input class="input fl" value="${hhmm(s.lunch)}" style="width:72px"> bed <input class="input fb" value="${hhmm(s.bed)}" style="width:72px"></span></label>`}
        <div class="row"><button type="button" class="btn small primary fsave">Save</button> ${agent ? '' : '<button type="button" class="btn small danger fdel">Remove resident</button>'}</div>
        <p class="hint fstat"></p>`;
      const f = s2 => q('.rform ' + s2), stat = t => { f('.fstat').textContent = t; };
      // the flats of the chosen building: "floor 3 · flat 2 · one-bedroom" (any bed in the building when none is picked)
      const KIND = { studio: 'studio', one: 'one-bedroom', two: 'two-bedroom' };
      const flatsOf = () => {
        const b = +f('.fh').value, Bh = Number.isFinite(b) && f('.fh').value !== '' && f('.fh').value !== 'auto' ? S.world.buildings[b] : null, opts = [];
        if (Bh) for (let fl = 1; fl < Bh.floors; fl++) (S.world.levels[Bh.lv[fl]]?.units || []).forEach((u, k) => opts.push(`<option value="${fl}:${k}"${p.hb === b && p.hf === fl && p.hu === k ? ' selected' : ''}>floor ${fl + 1} · flat ${k + 1} · ${KIND[u.kind] || 'flat'}</option>`));
        f('.fu').innerHTML = `<option value="">${agent ? 'Choose a flat' : 'Any flat'}</option>${opts.join('')}`;
        f('.fu').classList.toggle('hidden', !Bh);
      };
      f('.fh').onchange = flatsOf; flatsOf();
      f('.flook').onclick = () => app.openCustomizer?.({ kind: 'person', i });
      f('.fsave').onclick = async () => {
        const op = { op: 'person.set', i, name: f('.fn').value.trim() };
        const fu = f('.fu').value;
        if (f('.fh').value && fu) { const [fl, k] = fu.split(':').map(Number); op.home = { b: +f('.fh').value, f: fl, u: k }; }
        if (!agent) {
          if (f('.fh').value && !fu) op.home = f('.fh').value === 'auto' ? 'auto' : { b: +f('.fh').value };
          if (f('.fj').value) op.job = ['free', 'auto'].includes(f('.fj').value) ? f('.fj').value : { b: +f('.fj').value };
          const st = hours(f('.fs').value), en = hours(f('.fe').value);
          if (Number.isFinite(st) && Number.isFinite(en) && (moved(st, j.start) || moved(en % 24, (j.end ?? NaN) % 24))) op.hours = { start: st, end: en < st ? en + 24 : en };
          const w = hours(f('.fw').value), l = hours(f('.fl').value), bd = hours(f('.fb').value);
          if ([w, l, bd].every(Number.isFinite) && (moved(w, s.wake) || moved(l, s.lunch) || moved(bd % 24, (s.bed ?? NaN) % 24))) op.sched = { wake: w, lunch: l, bed: bd < 12 ? bd + 24 : bd };
        }
        try { await post('/api/edit', { ops: [op] }); list(); await form(i); q('.rform .fstat').textContent = 'Saved.'; } catch (e) { stat(e.message); }
      };
      if (!agent) f('.fdel').onclick = async () => {
        if (!confirm(`Remove ${info.name}? They move away; you can undo.`)) return;
        try { await post('/api/edit', { ops: [{ op: 'person.del', i }] }); stat(`${info.name} moved away.`); list(); } catch (e) { stat(e.message); }
      };
    }
    list();
  };
}
