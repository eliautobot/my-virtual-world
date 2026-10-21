// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Finding the fish on a trip (docs/features/fishing.md §Finding fish): the grounds as they show on the water
// (render/fishing-grounds.js), the chart (C, 🗺️) - the water round the dock with the grounds you can see or have found,
// the legend when it's sighted, the dock and you - a course set to any of them (an arrow at the top of the screen
// with its distance, a buoy and a beam on the water), auto-cruise there (player/boating.js cruise), and the fish
// finder: the sonar's picture under the boat, scrolling - the bottom, fish marks over a ground, more as you get into
// it; a hidden ground (a reef, a wreck, the deep) within its range goes on the chart. The trip's marks are drawn on
// the map and the radar too (ui/worldmap.js app.mapMarks).
import * as THREE from 'three';
import { h, esc } from '../core/util.js';
import { drawIcon, iconFor } from '../core/icons.js';
import { GroundMarks } from '../render/fishing-grounds.js';
import { waterUnder } from '../render/sea-probe.js';
import { islandPicture } from '../render/island-picture.js';
import { GROUNDS, groundPos, groundAt as groundAtShared } from '/shared/fishing-trip.js';

const FINDER_COLS = 105, FINDER_DT = 0.12;
const KIND_COL = { birds: '#e8eef2', boil: '#9fe6ff', reef: '#3fb6a8', drop: '#4a8ad8', wreck: '#c79a5a', blue: '#3a6ae8', deep: '#6a5ad8', flats: '#e8d38a', shore: '#a8a090', pads: '#6ac25a', weed: '#8aa04a', rocks: '#a89a8a', hole: '#5a4ab8' };
const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
const compass = a => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.PI - a) * 180 / Math.PI % 360 + 360) % 360 / 45) % 8];   // (the HUD's heading: 0° = −z)
const dist = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export class TripNav {
  constructor(app, getFx) {
    this.app = app; this.getFx = getFx; this.trip = null; this.nav = null; this.revealed = new Set(); this.sel = null;
    this.marks = new GroundMarks(app.stage.scene);
    this.cols = []; this.finderAt = 0;
    const root = document.getElementById('ui');
    this.E = {};
    const E = this.E;
    E.chart = root.appendChild(h(`<div id="fishchart" class="panel hidden" role="dialog" aria-label="Chart"><div class="rp-head"><h3>🗺️ Chart</h3><button type="button" class="btn small rp-x">✕</button></div>
      <canvas class="fc-cv"></canvas><div class="fc-list"></div></div>`));
    E.cv = E.chart.querySelector('canvas'); E.list = E.chart.querySelector('.fc-list');
    E.chart.querySelector('.rp-x').onclick = () => this.closeChart();
    E.cv.addEventListener('click', e => this.pick(e));
    E.list.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const m = this.markById(b.dataset.id); if (!m) return; if (b.dataset.go === 'cruise') this.setCourse(m, true); else this.setCourse(m, false); });
    E.nav = root.appendChild(h('<div id="fishnav" class="hidden"><i class="fn-arrow">➤</i><b class="fn-name"></b><span class="fn-d"></span><button type="button" class="btn small fn-cruise">▶ Cruise</button><button type="button" class="btn small fn-x" title="Clear the course">✕</button></div>'));
    E.nav.querySelector('.fn-x').onclick = () => this.clearCourse();
    E.nav.querySelector('.fn-cruise').onclick = () => { if (this.nav) this.cruise(!app.boating?.cruising); };
    E.finder = root.appendChild(h('<div id="fishfinder" class="hidden"><div class="ff-top"><b>📡</b><span class="ff-d"></span><small class="ff-r"></small></div><canvas></canvas></div>'));
    E.fcv = E.finder.querySelector('canvas'); E.fctx = E.fcv.getContext('2d');
    // the buoy where the course goes, with a beam to see it by
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 10), new THREE.MeshStandardMaterial({ color: '#ff6a2a', roughness: 0.6 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6), new THREE.MeshStandardMaterial({ color: '#ffe0a0', emissive: '#ffb040', emissiveIntensity: 1.2 }));
    body.position.y = 0.3; cap.position.y = 1.0;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 60, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb84a', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 30; beam.renderOrder = 3;
    g.add(body, cap, beam); g.visible = false; g.name = 'course-buoy';
    app.stage.scene.add(g); this.buoy = g;
    (app.mapMarks ||= []).push((ctx, X, Z, s, o) => this.drawMarks(ctx, X, Z, s, o));
  }
  // ---------------------------------------------------------------- the trip
  begin(trip) {
    this.trip = trip; this.revealed = new Set(); this.nav = null; this.cols = [];
    this.marks.set(trip.plan, (x, z) => waterUnder(x, z)?.level ?? null);
    this.E.finder.classList.remove('hidden');
  }
  end() {
    this.trip = null; this.marks.clear(); this.clearCourse(); this.closeChart();
    this.E.finder.classList.add('hidden');
  }
  minute() { return this.trip ? (performance.now() - this.trip.t0) / 60000 : 0; }
  /** The ground at (x, z) now (wandering ones where they are), hidden or not, or null. */
  groundAt(x, z) { return this.trip ? groundAtShared(this.trip.plan, x, z, this.minute()) : null; }
  reveal(id, why) {
    if (!this.trip || this.revealed.has(id)) return;
    this.revealed.add(id);
    const g = this.trip.plan.grounds.find(x => x.id === id);
    if (g) this.app.toast(`${why === 'note' ? '🍾' : '📡'} ${why === 'note' ? 'The note marks' : 'Sonar:'} a ${GROUNDS[g.kind].label.toLowerCase()}${why === 'note' ? '' : ' under you'} - it's on your chart`, 'good', 3200);
  }
  /** The marks a chart shows: the grounds you can see or have found, the legend while it's about, the dock. */
  visibleMarks() {
    const T = this.trip; if (!T) return [];
    const min = this.minute(), lg = T.plan.legend, legendOn = lg && min >= lg.from && min <= lg.to, out = [];
    for (const g of T.plan.grounds) {
      const seen = !g.hidden || this.revealed.has(g.id), legend = legendOn && lg.ground === g.id;
      if (!seen && !legend) continue;
      const p = groundPos(g, min, T.plan.water), G = GROUNDS[g.kind];
      out.push({ id: g.id, x: p.x, z: p.z, r: g.r, icon: legend ? '👑' : G.icon, label: legend ? `${G.label} - a legend sighted!` : G.label, kind: g.kind, found: g.hidden && this.revealed.has(g.id), legend, ground: g });
    }
    const d = T.data.dock; out.push({ id: 'dock', x: d.x, z: d.z, r: 0, icon: '⚓', label: 'The dock', kind: 'dock' });
    return out;
  }
  markById(id) { return this.visibleMarks().find(m => m.id === id) || null; }
  // ---------------------------------------------------------------- the course
  setCourse(m, cruise) {
    this.nav = { id: m.id, x: m.x, z: m.z, label: m.label, icon: m.icon, ground: m.ground || null, r: m.ground ? Math.min(40, m.ground.r * 0.7) : 25 };
    this.E.nav.classList.remove('hidden');
    this.closeChart();
    if (cruise) this.cruise(true);
    else this.app.toast(`📍 Course set: ${m.label}`, 'good', 1800);
  }
  clearCourse() {
    if (this.app.boating?.cruising) this.app.boating.cruise(null);
    this.nav = null; this.E.nav.classList.add('hidden'); this.buoy.visible = false;
  }
  cruise(on) {
    const b = this.app.boating; if (!b?.active || !this.nav) return;
    if (!on) { b.cruise(null); return; }
    b.cruise({ x: this.nav.x, z: this.nav.z, label: this.nav.label, r: this.nav.r });
    this.app.toast(`▶ Cruising to ${this.nav.label} - touch the wheel or the lever to take over`, '', 2600);
  }
  // ---------------------------------------------------------------- the chart
  openChart() {
    if (!this.trip) { this.app.toast('Start a trip first: 🎣 Trips (T)', '', 2200); return; }
    this.E.chart.classList.remove('hidden'); this.drawChart(); this.listMarks();
  }
  closeChart() { this.E.chart.classList.add('hidden'); }
  toggleChart() { this.E.chart.classList.contains('hidden') ? this.openChart() : this.closeChart(); }
  view() {
    const T = this.trip, d = T.data.dock, gs = T.plan.grounds;
    if (T.water === 'lake') {
      let x0 = d.x, x1 = d.x, z0 = d.z, z1 = d.z;
      for (const g of gs) { x0 = Math.min(x0, g.x - g.r); x1 = Math.max(x1, g.x + g.r); z0 = Math.min(z0, g.z - g.r); z1 = Math.max(z1, g.z + g.r); }
      return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, R: Math.max(80, Math.max(x1 - x0, z1 - z0) * 0.62) };
    }
    return { cx: d.x, cz: d.z, R: (T.course.reach || 700) * 1.08 };
  }
  drawChart() {
    const cv = this.E.cv, W = cv.clientWidth || 480, H = cv.clientHeight || 360, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = this.view(), s = Math.min(W, H) / (2 * v.R), X = x => W / 2 + (x - v.cx) * s, Z = z => H / 2 + (z - v.cz) * s;
    this.cv = { X, Z, s, W, H };
    ctx.fillStyle = '#1d3a4c'; ctx.fillRect(0, 0, W, H);
    const pic = islandPicture();
    if (pic) { const b = pic.bounds; ctx.filter = 'saturate(0.8) brightness(0.95)'; ctx.drawImage(pic.canvas, X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s); ctx.filter = 'none'; }
    if (this.trip.water === 'sea') { ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(v.cx), Z(v.cz), (this.trip.course.reach || 700) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    this.drawMarks(ctx, X, Z, s, { radar: false, rot: 0, chart: { W, H } });
  }
  listMarks() {
    const b = this.app.boating?.state?.(), from = b ? { x: b.x, z: b.z } : this.trip.data.dock;
    const ms = this.visibleMarks().map(m => ({ ...m, d: Math.hypot(m.x - from.x, m.z - from.z), brg: compass(Math.atan2(m.x - from.x, m.z - from.z)) })).sort((a, c) => a.d - c.d);
    const hidden = this.trip.plan.grounds.filter(g => g.hidden && !this.revealed.has(g.id)).length;
    this.E.list.innerHTML = ms.map(m => `<div class="fc-row${this.nav?.id === m.id ? ' on' : ''}${m.legend ? ' legend' : ''}"><span class="fc-ic">${m.icon}</span><span class="fc-l"><b>${esc(m.label)}</b><small>${dist(m.d)} ${m.brg}${m.found ? ' · found by sonar' : ''}</small></span>
      <button type="button" class="btn small" data-id="${m.id}" data-go="set">📍</button><button type="button" class="btn small primary" data-id="${m.id}" data-go="cruise">▶ Cruise</button></div>`).join('')
      + (hidden ? `<p class="hint">${hidden} more ground${hidden === 1 ? '' : 's'} out there that only the fish finder shows.</p>` : '');
  }
  pick(e) {
    if (!this.cv) return;
    const r = this.E.cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, bd = 26;
    for (const m of this.visibleMarks()) { const d = Math.hypot(this.cv.X(m.x) - px, this.cv.Z(m.z) - py); if (d < bd) { bd = d; best = m; } }
    if (best) { this.sel = best.id; this.setCourse(best, false); }
  }
  /** The trip's marks in a map's frame (the chart, the map, the radar). */
  drawMarks(ctx, X, Z, s, o) {
    if (!this.trip) return;
    const icon = (ch, x, y, size, col) => { ctx.save(); ctx.translate(x, y); if (o.rot) ctx.rotate(-o.rot); ctx.fillStyle = 'rgba(8,18,26,.78)'; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, size * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); if (!drawIcon(ctx, iconFor(ch), 0, 0, size * 0.72, '#f4f8fa')) { ctx.font = `${size * 0.7}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 1); } ctx.restore(); };
    const size = o.radar ? 14 : o.chart ? 22 : 18;
    for (const m of this.visibleMarks()) {
      const x = X(m.x), y = Z(m.z), col = m.legend ? '#ffc83d' : KIND_COL[m.kind] || '#ffffff';
      if (!o.radar && m.r * s > 6) { ctx.fillStyle = col + '30'; ctx.beginPath(); ctx.arc(x, y, m.r * s, 0, Math.PI * 2); ctx.fill(); }
      icon(m.icon, x, y, size, col);
      if (o.chart && this.nav?.id === m.id) { ctx.strokeStyle = '#ffb84a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, size * 0.95, 0, Math.PI * 2); ctx.stroke(); }
    }
    // the course, and you (on the chart: the map and the radar draw you themselves)
    const b = this.app.boating?.state?.();
    if (this.nav && b) { ctx.setLineDash([5, 5]); ctx.strokeStyle = '#ffb84a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(b.x), Z(b.z)); ctx.lineTo(X(this.nav.x), Z(this.nav.z)); ctx.stroke(); ctx.setLineDash([]); }
    if (o.chart && b) { ctx.save(); ctx.translate(X(b.x), Z(b.z)); ctx.rotate(Math.PI - b.heading); ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
  }
  // ---------------------------------------------------------------- every frame
  update(dt, t) {
    if (!this.trip) return;
    const app = this.app, min = this.minute(), cam = app.stage.camera.position;
    this.marks.update(dt, t, min, cam, this.getFx());
    // the course follows a wandering ground; the arrow, the buoy
    if (this.nav) {
      if (this.nav.ground) { const p = groundPos(this.nav.ground, min, this.trip.plan.water); this.nav.x = p.x; this.nav.z = p.z; const c = app.boating?.cruising; if (c) { c.x = p.x; c.z = p.z; } }
      const b = app.boating?.state?.(), from = b || app.player?.extra;
      if (from) {
        const dx = this.nav.x - from.x, dz = this.nav.z - from.z, d = Math.hypot(dx, dz), look = app.cam.yaw + Math.PI;
        this.E.nav.querySelector('.fn-arrow').style.transform = `rotate(${(-angDiff(look, Math.atan2(dx, dz)) * 180 / Math.PI).toFixed(1)}deg)`;
        const nm = `${this.nav.icon} ${this.nav.label}`;
        if (this.E.nav.querySelector('.fn-name').textContent !== nm) this.E.nav.querySelector('.fn-name').textContent = nm;
        this.E.nav.querySelector('.fn-d').textContent = dist(d);
        // fishing: the banner steps aside (the toasts and the fight have the top; the chart keeps the course, and the banner
        // is back when you take the wheel)
        this.E.nav.classList.toggle('hidden', document.body.classList.contains('fishing'));
        this.E.nav.querySelector('.fn-cruise').textContent = app.boating?.cruising ? '✕ Stop' : '▶ Cruise';
        this.E.nav.querySelector('.fn-cruise').classList.toggle('hidden', !app.boating?.active);
        const w = waterUnder(this.nav.x, this.nav.z);
        this.buoy.visible = !!w && d > 15; if (w) this.buoy.position.set(this.nav.x, w.level - 0.2 + 0.08 * Math.sin(t * 1.7), this.nav.z);
        this.buoy.children[2].material.opacity = Math.min(0.3, d / 900);
      }
    }
    if (!this.E.chart.classList.contains('hidden') && (this._chartAt = (this._chartAt || 0) + dt) > 0.5) { this._chartAt = 0; this.drawChart(); }
    // the fish finder
    if ((this.finderAt += dt) >= FINDER_DT) { this.finderAt = 0; this.finder(); }
  }
  finder() {
    const app = this.app, b = app.boating?.state?.(), T = app.terrain, trip = this.trip;
    if (!b || !T?.ground) { this.E.finder.classList.add('hidden'); return; }
    this.E.finder.classList.remove('hidden');
    const w = T.ground.water(b.x, b.z), depth = w ? Math.max(0, w.level - T.pointHeight(b.x, b.z)) : 0, range = trip.L.boat.finder || 25, min = this.minute();
    // what's under it: over (or near) a ground, marks at that ground's kind of depth; a hidden one in range is found
    let near = null, nd = Infinity;
    for (const g of trip.plan.grounds) { const p = groundPos(g, min, trip.plan.water), d = Math.hypot(p.x - b.x, p.z - b.z) - g.r; if (d < range && d < nd) { nd = d; near = g; } }
    if (near?.hidden && nd < range * 0.6) this.reveal(near.id, 'sonar');
    const marks = [], over = near && nd <= 0, k = near ? (over ? 0.5 : 0.25 * (1 - nd / range)) : 0.04;
    if (Math.random() < k && depth > 1) {
      const bottomish = near && ['reef', 'wreck', 'hole', 'deep', 'drop', 'rocks'].includes(near.kind), surf = near && ['birds', 'boil', 'blue', 'pads'].includes(near.kind);
      const n = 1 + (over && Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) marks.push({ f: bottomish ? 0.6 + Math.random() * 0.32 : surf ? 0.08 + Math.random() * 0.35 : 0.2 + Math.random() * 0.65, big: Math.random() < 0.12 + (trip.course.difficulty || 1) * 0.03 });
    }
    this.cols.push({ depth, marks }); if (this.cols.length > FINDER_COLS) this.cols.shift();
    // draw it: the water, the bottom (brightest at the bed), the fish as arches
    const cv = this.E.fcv, W = 210, H = 100, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = this.E.fctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const maxD = Math.max(6, ...this.cols.map(c => c.depth)) * 1.15, cw = W / FINDER_COLS;
    ctx.fillStyle = '#071a2a'; ctx.fillRect(0, 0, W, H);
    this.cols.forEach((c, i) => {
      const x = W - (this.cols.length - i) * cw, y = Math.min(H, c.depth / maxD * H);
      const g = ctx.createLinearGradient(0, y, 0, H); g.addColorStop(0, '#ffb02e'); g.addColorStop(0.12, '#c4581a'); g.addColorStop(0.4, '#4a2a1a'); g.addColorStop(1, '#1a1210');
      ctx.fillStyle = g; ctx.fillRect(x, y, cw + 0.6, H - y);
      for (const m of c.marks) { const my = m.f * y; ctx.strokeStyle = m.big ? '#ff5a4a' : '#ffe14a'; ctx.lineWidth = m.big ? 2.2 : 1.6; ctx.beginPath(); ctx.arc(x, my + (m.big ? 4 : 3), m.big ? 5 : 3.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    });
    this.E.finder.querySelector('.ff-d').textContent = `${depth.toFixed(1)} m`;
    this.E.finder.querySelector('.ff-r').textContent = near ? (over ? `${GROUNDS[near.kind].icon} on a ${GROUNDS[near.kind].label.toLowerCase()}` : `range ${range} m`) : `range ${range} m`;
  }
}
