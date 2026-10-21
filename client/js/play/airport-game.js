// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's ring game (docs/features/play-modules.md §Airport): while flying, G (or 🏁 on the instruments) opens the
// ring courses for this aircraft — locked ones say what opens them, the others their stars, best time and what they pay.
// Start one: the server lays its rings out over this airport (POST /api/play/start); they hang in the sky, the next one
// gold with a beam of light, an arrow at the top of the screen pointing at it with the distance. The clock starts at the
// first ring (the gate) and runs against the course's limit; through the last ring the flight path goes to the server
// (POST /api/play/finish: it finds the passes itself and works the time out) and the result comes back — stars, the
// time, a new best, the place on the leaderboard, experience, Virtual Coin, new badges, level-ups — with Retry, the next
// course and the leaderboard. A crash, getting out or running out of time ends the run (nothing is recorded).
// Rings: one instanced torus mesh and one beam, only for the pilot flying the course (docs: §Performance).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { formatScore, fmtVc } from '/shared/play.js';
import { AIRCRAFT } from '/shared/aircraft-specs.js';
import { anglesOf } from '/shared/flight-model.js';

const SAMPLE_MS = 125, MAX_RINGS = 32;
let app = null, E = {}, cat = null, prog = null, run = null, rings = null, beam = null, last = null;
const C_NEXT = new THREE.Color('#ffc83d'), C_LATER = new THREE.Color('#5ad7ff'), C_FAR = new THREE.Color('#d8f3ff');
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);

export function init(a) {
  app = a;
  if (!app.flight) return;
  build(document.getElementById('ui'));
  const geo = new THREE.TorusGeometry(1, 0.07, 10, 48);
  rings = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false }), MAX_RINGS);
  rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
  rings.count = 0; rings.frustumCulled = false; rings.renderOrder = 3; rings.name = 'ring-course';
  beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  beam.visible = false; beam.frustumCulled = false;
  app.stage.scene.add(rings, beam);
  app.flight.onFrame(frame);
  bus.on('flight', ev => { E.btn.classList.toggle('hidden', !ev.on); if (!ev.on) { stop('You got out'); closePick(); } });
  bus.on('flight-crash', () => stop('Crashed'));
  app.hooks.key.unshift(onKey);
  app.ringGame = { open: openPick, get run() { return run; } };
  document.addEventListener('visibilitychange', () => { if (document.hidden && run) stop('You left the game window'); });   // the page stops drawing: the flight path would have a gap
}
function build(root) {
  E.btn = root.appendChild(h('<button type="button" class="btn rg-open hidden" title="Ring courses (G)">🏁 Ring courses <kbd>G</kbd></button>'));
  E.btn.onclick = () => (E.pick.classList.contains('hidden') ? openPick() : closePick());
  E.hud = root.appendChild(h(`<div id="ringhud" class="hidden"><div class="rh-top"><b class="rh-name"></b><span class="rh-n"></span></div>
    <div class="rh-time"></div><div class="rh-sub"></div><div class="rh-arrow"><i></i><span class="rh-dist"></span></div>
    <button type="button" class="btn small rh-quit">✕ Stop</button></div>`));
  E.hud.querySelector('.rh-quit').onclick = () => stop('Run stopped');
  E.pick = root.appendChild(h('<div id="ringpick" class="panel hidden" role="dialog" aria-label="Ring courses"><div class="rp-head"><h3>🏁 Ring courses</h3><button type="button" class="btn small rp-x">✕</button></div><div class="rp-body"></div></div>'));
  E.pick.querySelector('.rp-x').onclick = closePick;
  E.pick.addEventListener('click', onPickClick);
  E.res = root.appendChild(h('<div id="ringres" class="panel hidden" role="dialog" aria-label="Ring course result"></div>'));
  E.res.addEventListener('click', onResClick);
}
function onKey(e) {
  if (!app.flight?.active) return false;
  if (e.code === 'KeyG' && !e.repeat) { E.pick.classList.contains('hidden') ? openPick() : closePick(); return true; }
  if (e.code === 'Escape' && !E.pick.classList.contains('hidden')) { closePick(); return true; }
  if (e.code === 'Escape' && !E.res.classList.contains('hidden')) { E.res.classList.add('hidden'); return true; }
  return false;
}

// ------------------------------------------------------------------ choosing a course
async function load() {
  [cat, prog] = await Promise.all([cat ? Promise.resolve(cat) : getJSON('/api/play'), getJSON('/api/play/profile').catch(() => null)]);
}
async function openPick() {
  E.res.classList.add('hidden');
  E.pick.classList.remove('hidden');
  const body = E.pick.querySelector('.rp-body');
  body.innerHTML = '<p class="hint">Loading…</p>';
  try { await load(); } catch (err) { body.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
  const m = cat.modules.find(x => x.id === 'airport'), mine = prog?.modules?.airport || { best: {}, unlocked: [m.courses[0].id] }, type = app.flight.type;
  const row = c => {
    const b = mine.best[c.id], open = mine.unlocked.includes(c.id), here = c.tier === type, A = AIRCRAFT[c.tier];
    const after = c.after ? m.courses.find(x => x.id === c.after) : null;
    const stars = b ? `<span class="pf-stars" data-noicon>${'★'.repeat(b.stars)}<i>${'★'.repeat(3 - b.stars)}</i></span>` : '';
    const why = !open ? `🔒 Finish ${esc(after?.label || 'the one before')} first` : !here ? `${A.icon} Needs a ${esc(A.label.toLowerCase())}` : '';
    return `<div class="rp-row${open && here ? '' : ' off'}">
      <div class="rp-l"><b>${esc(c.label)}</b> <span class="rp-dots" title="Difficulty ${c.difficulty} of 10">${'●'.repeat(Math.ceil(c.difficulty / 2))}<i>${'●'.repeat(5 - Math.ceil(c.difficulty / 2))}</i></span>
        <small class="dim">${esc(c.blurb || '')}</small>
        <small>${b ? `Best ${esc(formatScore(m, b.score))} ${stars} · #${b.place}` : `★ ${esc(formatScore(m, c.stars[0]))} · ★★ ${esc(formatScore(m, c.stars[1]))} · ★★★ ${esc(formatScore(m, c.stars[2]))}`}${m.prizes?.[c.id] ? ` · <span class="pf-vc">up to ${fmtVc(m.prizes[c.id])}</span>` : ''}</small></div>
      <div class="rp-r">${why ? `<small class="dim">${why}</small>` : `<button type="button" class="btn primary small" data-start="${c.id}">Fly it</button>`}<button type="button" class="btn small" data-board="${c.id}" title="Leaderboard">🏆</button></div></div>`;
  };
  const list = m.courses.filter(c => c.tier === type).concat(m.courses.filter(c => c.tier !== type));
  body.innerHTML = `<p class="hint">Courses for the ${esc(AIRCRAFT[type].label.toLowerCase())} first. The clock starts at the first ring; fly every ring in order.</p>${list.map(row).join('')}`;
}
function closePick() { E.pick.classList.add('hidden'); }
function onPickClick(e) {
  const s = e.target.closest('[data-start]'); if (s) { start(s.dataset.start); return; }
  const b = e.target.closest('[data-board]'); if (b) { app.profile?.board('airport', b.dataset.board); }
}

// ------------------------------------------------------------------ a run
async function start(courseId) {
  if (!app.flight?.active) return;
  closePick(); E.res.classList.add('hidden');
  if (run) await stop(null);
  let r;
  try { r = await post('/api/play/start', { module: 'airport', course: courseId, where: app.flight.module }); }
  catch (err) { app.toast(err.message, 'bad', 4000); return; }
  const m = cat.modules.find(x => x.id === 'airport'), c = m.courses.find(x => x.id === courseId);
  run = { id: r.run, course: c, m, rings: r.data.rings, limit: r.limit, stars: r.stars, best: r.best, t0: performance.now(), path: [], next: 0, gateAt: null, lastSample: 0, flashAt: 0 };
  last = null;
  drawRings();
  E.hud.classList.remove('hidden');
  E.hud.querySelector('.rh-name').textContent = `🏁 ${c.label}`;
  app.toast(`${c.label}: fly through the gold ring to start the clock`, 'good', 3500);
}
/** Ends a run without a result (why: told in a toast; null: quietly). */
async function stop(why) {
  if (!run) return;
  const id = run.id; run = null;
  rings.count = 0; beam.visible = false; E.hud.classList.add('hidden');
  if (why) app.toast(`🏁 ${why} — the run did not count`, 'warn', 3000);
  try { await post('/api/play/abandon', { run: id }); } catch { /* it lapses by itself */ }
}
function drawRings() {
  if (!run) return;
  const R = run.rings; let n = 0;
  for (let k = 0; k < R.length && n < MAX_RINGS; k++) {
    const r = R[k], passed = k < run.next;
    _q.setFromAxisAngle(_y, Math.atan2(r.nx, r.nz));
    _s.setScalar(passed ? 0.0001 : r.r * (k === run.next ? 1 + 0.04 * Math.sin(performance.now() / 160) : 1));
    rings.setMatrixAt(n, _m.compose(_p.set(r.x, r.y, r.z), _q, _s));
    rings.setColorAt(n, k === run.next ? C_NEXT : k === run.next + 1 ? C_LATER : C_FAR);
    n++;
  }
  rings.count = n; rings.instanceMatrix.needsUpdate = true; if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  const nx = R[run.next];
  beam.visible = !!nx;
  if (nx) { beam.position.set(nx.x, nx.y + 150 + nx.r, nx.z); beam.scale.set(1, 300, 1); }
}
/** Every flying frame: record the path, find the passes, keep the clock and the arrow. */
function frame(s) {
  if (!run) return;
  const now = performance.now(), t = now - run.t0, p = s.p;
  if (last) {
    const R = run.rings[run.next];
    if (R) {
      const sa = (last.x - R.x) * R.nx + (last.z - R.z) * R.nz, sb = (p.x - R.x) * R.nx + (p.z - R.z) * R.nz;
      if (sa < 0 && sb >= 0) {
        const u = sa === sb ? 0 : -sa / (sb - sa), x = last.x + (p.x - last.x) * u, y = last.y + (p.y - last.y) * u, z = last.z + (p.z - last.z) * u;
        if (Math.hypot(x - R.x, y - R.y, z - R.z) <= R.r) {
          sample(last.t, last); sample(t, p);   // the samples either side of the pass
          run.lastSample = now;
          if (run.next === 0) run.gateAt = t;
          bus.emit('ring:pass', { k: run.next, gate: run.next === 0, last: run.next === run.rings.length - 1 });
          run.next++; run.flashAt = now;
          if (run.next >= run.rings.length) { finish(); return; }
        }
      }
    }
  }
  if (now - run.lastSample >= SAMPLE_MS) { run.lastSample = now; sample(t, p); }
  last = { x: p.x, y: p.y, z: p.z, t };
  if (run.gateAt != null && (t - run.gateAt) / 1000 > run.limit) { bus.emit('ring:fail'); stop('Out of time'); return; }
  drawRings();
  hud(s, t);
}
/** A sample of the flight path: [ms since the start, x, y, z], each later than the one before (the server checks the
 *  speed between them). */
function sample(t, p) {
  const ms = Math.round(t), P = run.path;
  if (P.length && ms <= P[P.length - 1][0]) return;
  P.push([ms, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
}
let hudAt = 0;
function hud(s, t) {
  const now = performance.now(); if (now - hudAt < 70) return; hudAt = now;
  const R = run.rings, nx = R[run.next], el = run.gateAt != null ? (t - run.gateAt) / 1000 : 0;
  E.hud.querySelector('.rh-n').textContent = `Ring ${Math.min(run.next + 1, R.length)} of ${R.length}`;
  E.hud.querySelector('.rh-time').textContent = run.gateAt == null ? 'Through the gate to start' : formatScore(run.m, el);
  const [t1, t2, t3] = run.stars, pace = el <= t3 ? 3 : el <= t2 ? 2 : el <= t1 ? 1 : 0, left = run.limit - el;
  E.hud.querySelector('.rh-sub').innerHTML = run.gateAt == null ? (run.best ? `Best ${esc(formatScore(run.m, run.best.score))}` : `★★★ under ${esc(formatScore(run.m, t3))}`)
    : `${left < 20 ? `<b class="rh-hurry">${Math.ceil(left)} s left</b> · ` : ''}<span data-noicon class="rh-pace">${pace ? '★'.repeat(pace) + ' pace' : 'no star yet'}</span>${run.best ? ` · best ${esc(formatScore(run.m, run.best.score))}` : ''}`;
  E.hud.classList.toggle('flash', now - run.flashAt < 350);
  if (nx) {   // the arrow: the direction to the next ring, against the nose (and how far)
    const a = anglesOf(s.q), dx = nx.x - s.p.x, dz = nx.z - s.p.z, dist = Math.hypot(dx, dz, nx.y - s.p.y);
    const rel = Math.atan2(dx, dz) - a.heading, deg = -rel * 180 / Math.PI, up = Math.atan2(nx.y - s.p.y, Math.hypot(dx, dz)) * 180 / Math.PI;
    E.hud.querySelector('.rh-arrow i').style.transform = `rotate(${deg.toFixed(0)}deg)`;
    E.hud.querySelector('.rh-dist').textContent = `${dist > 999 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}${Math.abs(up) > 6 ? (up > 0 ? ' ▲' : ' ▼') : ''}`;
  }
}
async function finish() {
  const r = run; run = null;
  rings.count = 0; beam.visible = false; E.hud.classList.add('hidden');
  let res;
  try { res = await post('/api/play/finish', { run: r.id, report: { aircraft: app.flight.type, path: r.path } }); }
  catch (err) { app.toast(err.message, 'bad', 4000); return; }
  result(r, res);
  bus.emit('ring:finish', { stars: res?.ok ? res.stars : 0 });
  prog = null;   // fetched again for the next list (best times, places, courses opened)
  app.profile?.refresh?.();
}
function result(r, x) {
  const m = r.m, c = r.course;
  if (!x.ok) {
    E.res.innerHTML = `<h3>🏁 ${esc(c.label)}</h3><p class="rr-bad">${esc(x.why || 'That run did not count')}</p>
      <div class="rr-acts"><button type="button" class="btn primary" data-retry="${c.id}">↻ Retry</button><button type="button" class="btn" data-close="1">Close</button></div>`;
    E.res.classList.remove('hidden'); return;
  }
  const next = m.courses.find(o => o.after === c.id && o.tier === app.flight.type) || (x.unlocked?.length ? m.courses.find(o => o.id === x.unlocked[0]) : null);
  const vc = x.vc || {};
  E.res.innerHTML = `<h3>🏁 ${esc(c.label)}</h3>
    <div class="rr-stars" data-noicon>${[0, 1, 2].map(k => `<span class="${k < x.stars ? 'on' : ''}" style="animation-delay:${k * 0.25}s">★</span>`).join('')}</div>
    <div class="rr-time">${esc(formatScore(m, x.score))}${x.newBest ? ' <span class="rr-best">New best!</span>' : x.prevBest ? ` <small class="dim">best ${esc(formatScore(m, x.prevBest.score))}</small>` : ''}</div>
    <div class="rr-facts">
      ${x.place ? `<span>🏆 #${x.place} on the leaderboard</span>` : ''}
      <span>+${x.xp} XP${x.module.level > x.module.was ? ` · ✈️ Airport level ${x.module.level}!` : ''}</span>
      ${vc.paid ? `<span class="pf-vc">+${fmtVc(vc.paid)}</span>` : vc.why ? `<span class="dim">${esc(vc.why)}</span>` : ''}
      ${x.player.level > x.player.was ? `<span>⭐ Level ${x.player.level}${x.player.rankUp ? ` — ${esc(x.player.rank.icon)} ${esc(x.player.rank.name)} rank!` : ''}</span>` : ''}
    </div>
    ${vc.parts?.length ? `<p class="rr-parts dim">${vc.parts.map(p => `${esc(p.label)} ${fmtVc(p.amount)}`).join(' · ')}</p>` : ''}
    ${x.badges?.length ? `<div class="rr-badges">${x.badges.map(b => `<div class="pf-sb t-${b.tier}"><span>${b.icon}</span><b>${esc(b.label)}</b></div>`).join('')}</div>` : ''}
    ${x.unlocked?.length ? `<p class="rr-open">🔓 ${x.unlocked.map(id => esc(m.courses.find(o => o.id === id)?.label || id)).join(', ')} opened</p>` : ''}
    <div class="rr-acts"><button type="button" class="btn primary" data-retry="${c.id}">↻ Retry</button>
      ${next && next.id !== c.id ? `<button type="button" class="btn" data-retry="${next.id}">Next: ${esc(next.label)} →</button>` : ''}
      <button type="button" class="btn" data-board="${c.id}">🏆 Leaderboard</button><button type="button" class="btn" data-close="1">Close</button></div>`;
  E.res.classList.remove('hidden');
}
function onResClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.retry) { E.res.classList.add('hidden'); load().then(() => start(t.dataset.retry)); }
  else if (t.dataset.board) app.profile?.board('airport', t.dataset.board);
  else if (t.dataset.close) E.res.classList.add('hidden');
}
