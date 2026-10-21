// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// DOM labels: AI-agent name tags (with live presence dots), selected / hovered person, activity tags for the
// focused floor, speech bubbles and the player tag. Pooled elements, positioned with transforms after each frame.
// Above each head - except in first person (the player's own eyes), where up close a head is above the view and its
// tag and bubble were cut off (2026-10-08): there they stand beside the person, at the shoulder on its right as the
// camera sees it (on its left when the right has no room), the bubble above the tag, its tail toward the person.
// A long bubble (an agent's answer: ui/talk-bar.js) shows all of it, scrolling inside (2026-10-08), and stays while
// the pointer is on it or it was just scrolled; it is no taller than the room under what covers the top of the screen (the
// top bar; on a phone the talk bar too) - with no room even for a few lines, it slides down to start just under it - so
// its first words aren't hidden. Bubbles are kept per speaker, so one being
// read is never handed to another.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { esc } from '../core/util.js';
import { USES, USE_LIST } from '/shared/catalog.js';

const _v = new THREE.Vector3(), P = { x: 0, y: 0 };
const HEAD = 2.02, SHOULDER = 1.42, SIDE = 0.34;   // (metres: over the head; the shoulder, and how far beside its middle, in first person)
const BUBBLE_W = 260;                              // (the bubble's widest, app.css .bubble)
const MAXL = 64, LIM = [1e9, 1e9, 1e9, 380, 60];
const READ_MS = 4000;                              // (a bubble scrolled this long ago, or under the pointer, stays: being read)
const BT_MAX = 152, BT_MIN = 64, BT_CHROME = 36;   // (a bubble's text: its tallest and shortest; its name and padding, app.css .bubble)
/** Screen-space declutter: true if a label of width w at (x, y) does not overlap any placed label. */
function fits(L, x, y, w) { for (const r of L) if (Math.abs(r.x - x) < (r.w + w) / 2 + 2 && Math.abs(r.y - y) < 21) return false; return true; }

export class Labels {
  constructor(app) {
    this.app = app; this.root = document.getElementById('labels');
    this.tags = []; this.bubs = new Map(); this.vips = []; this.cand = []; this.fn = 0;   // (bubs: speaker → its bubble)
    this.talk = { i: -1, lv: 0 };   // who is talking in the chat now (voice mode, read aloud) and how loud: its name glows
    this.top = 0; this.topAt = -1e9;   // (how far down the screen is covered, read every half second and when a bar comes or goes)
    this.refresh();
    bus.on('people', () => this.refresh());
    bus.on('talkbar', () => { this.topAt = -1e9; });
    addEventListener('resize', () => { this.topAt = -1e9; });
  }
  refresh() { this.vips = S.people.filter(p => p && p.v).map(p => p.i); }
  /** An agent talking in the chat (ui/chat-voice.js): its name over its head is shown and glows blue with how loud it is
   *  (0–1); -1: nobody now. */
  voice(i, lv = 0) { this.talk.i = Number.isInteger(i) ? i : -1; this.talk.lv = Math.max(0, Math.min(1, Number(lv) || 0)); }
  node(pool, k, cls) {
    let e = pool[k];
    if (!e) { e = document.createElement('div'); e.className = cls; e.style.display = 'none'; e._k = e._t = e._z = ''; this.root.appendChild(e); pool[k] = e; }
    return e;
  }
  /** The bubble of speaker `key` this frame - its own element while it speaks (a scrolled bubble keeps its place). */
  bubble(key) {
    let e = this.bubs.get(key);
    if (!e) {
      e = document.createElement('div'); e.className = 'bubble'; e.style.display = 'none';
      e._k = e._t = e._z = ''; e._touch = 0; e._hid = performance.now();
      e.addEventListener('pointerenter', () => { e._hover = true; });
      e.addEventListener('pointerleave', () => { e._hover = false; });
      // (capture: the text's own scroll doesn't bubble up)
      e.addEventListener('scroll', ev => { const t = ev.target; e._touch = performance.now(); e.classList.toggle('end', t.scrollTop + t.clientHeight >= t.scrollHeight - 2); }, true);
      this.root.appendChild(e); this.bubs.set(key, e);
    }
    e._used = this.fn;
    return e;
  }
  /** Speaker `key`'s bubble: `name` and what they say, placed like place(); a long one scrolls. `say` (its entry) is kept
   *  on screen until at least `keepTo` (its clock's units) while it is being read. */
  speak(key, name, text, x, y, z, side, say, keepTo) {
    const b = this.bubble(key), k = name + '\n' + text;
    if (b._k !== k) { b._k = k; b.innerHTML = `<b>${esc(name)}</b><div class="bt">${esc(text)}</div>`; b.classList.remove('scroll', 'end'); b._chk = true; b._mh = 0; }
    // (its bottom is at y: the room above it, in steps of 8 px so a walking speaker doesn't re-lay it out every frame)
    const mh = Math.max(BT_MIN, Math.min(BT_MAX, Math.round(innerHeight * 0.26), Math.floor((y - this.top - BT_CHROME) / 8) * 8));
    if (b._mh !== mh) { b._mh = mh; b.lastChild.style.maxHeight = mh + 'px'; b._chk = true; }
    const low = !!b._h && y - b._h < this.top + 4;   // (b._h: its height, measured when its words or room change)
    this.place(b, x, low ? this.top + 4 + b._h : y, z, side, true);
    if (b._low !== low) { b._low = low; b.classList.toggle('low', low); }
    if (b._chk) { b._chk = false; const t = b.lastChild; b.classList.toggle('scroll', t.scrollHeight > t.clientHeight + 1); b._h = b.offsetHeight; }
    if (say && (b._hover || performance.now() - b._touch < READ_MS) && say.until < keepTo) say.until = keepTo;
  }
  /** side: 0 over the head (its bottom middle at x, y); 1 beside it on the right (its left edge at x, centred on y, a
   *  bubble's bottom at y), -1 on the left (its right edge at x). */
  place(e, x, y, z, side = 0, bubble = false) {
    const t = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(${side > 0 ? '0' : side < 0 ? '-100%' : '-50%'},${side && !bubble ? '-50%' : '-100%'})`;
    if (e._t !== t) { e.style.transform = t; e._t = t; }
    if (e.style.display === 'none') e.style.display = '';
    const zz = String(z); if (e._z !== zz) { e.style.zIndex = zz; e._z = zz; }
    const sc = side > 0 ? 'side' : side < 0 ? 'side flip' : '';
    if (e._s !== sc) { e.classList.toggle('side', !!side); e.classList.toggle('flip', side < 0); e._s = sc; }
  }
  project(x, y, z) {
    const cam = this.app.stage.camera;
    _v.set(x, y, z);
    const d = _v.distanceTo(cam.position);
    _v.project(cam);
    if (_v.z > 1 || _v.x < -1.15 || _v.x > 1.15 || _v.y < -1.2 || _v.y > 1.3) return -1;
    P.x = (_v.x + 1) * 0.5 * innerWidth; P.y = (1 - _v.y) * 0.5 * innerHeight;
    return d;
  }
  /** First person: where a tag `w` wide goes beside a body whose shoulder is at (cx, cy) on the screen, `d` metres away -
   *  just past it on its right (SIDE metres from its middle), else on its left, else (a body filling the view: a phone
   *  held upright, a step away) on the side with more room, kept on the screen over the body's edge. { x, y, side }. */
  beside(cx, cy, d, w) {
    const cam = this.app.stage.camera, f = innerHeight / (2 * Math.tan((cam.fov || 50) * Math.PI / 360));
    const off = SIDE * f / Math.max(0.3, d), y = Math.max(28, Math.min(innerHeight - 28, cy));
    if (cx + off + w <= innerWidth - 6) return { x: cx + off, y, side: 1 };
    if (cx - off - w >= 6) return { x: cx - off, y, side: -1 };
    return cx <= innerWidth / 2 ? { x: Math.max(6, Math.min(cx + off, innerWidth - w - 6)), y, side: 1 } : { x: Math.min(innerWidth - 6, Math.max(cx - off, w + 6)), y, side: -1 };
  }
  /** How far down the screen is covered at the top (before this frame's writes: no forced layout). */
  covered(now) {
    if (now - this.topAt < 500) return;
    this.topAt = now;
    let top = 0;
    for (const e of document.querySelectorAll('#topbar, #ui > .tb')) {
      const r = e.getBoundingClientRect();
      if (r.height && r.top < innerHeight / 3) top = Math.max(top, r.bottom);
    }
    this.top = top;
  }
  frame() {
    const app = this.app, A = app.agents, fr = A.frame, cand = this.cand, seen = new Set();
    this.covered(performance.now());
    const fp = !!(app.cam?.fp && app.player?.active);   // (first person: tags beside the bodies, not over the heads)
    cand.length = 0;
    const push = (i, pri) => {
      if (i < 0 || seen.has(i) || A.last[i] !== fr) return;
      seen.add(i);
      const d = this.project(A.rx[i], A.ry[i] + (fp ? SHOULDER : HEAD), A.rz[i]);
      if (d < 0 || d > LIM[pri]) return;
      cand.push({ i, pri, d, x: P.x, y: P.y });
    };
    const sel = S.sel, t = S.simT, now = performance.now(), keep = t + (READ_MS / 1000) * (app.net?.clock?.rate || 1);
    this.fn++;
    if (sel >= 0) push(sel, 0);
    if (this.talk.i >= 0) push(this.talk.i, 1);   // (talking: shown, like one speaking out loud)
    for (const [i, s] of S.says) { if (t > s.until) { S.says.delete(i); continue; } push(i, 1); }
    if (S.hover >= 0) push(S.hover, 2);
    if (S.labels) {
      for (const i of this.vips) push(i, 3);
      if (S.focus.b >= 0) { const fc = S.focus.b * 64 + S.focus.f; for (let n = 0; n < A.nDrawn; n++) { const i = A.drawn[n]; if (A.ctx[i] === fc) push(i, 4); } }
    }
    cand.sort((a, b) => a.pri - b.pri || a.d - b.d);
    let nt = 0;
    const pl = app.player;
    if (pl && pl.active && pl.state !== 'drive' && !fp) {   // (first person: these are its own eyes - no tag of its own)
      const d = this.project(pl.x, pl.y + HEAD, pl.z);
      if (d >= 0) {
        const e = this.node(this.tags, nt++, 'lbl');
        if (e._k !== 'you') { e._k = 'you'; e.innerHTML = '<div class="tagname sel"><span class="ico">🎮</span>You</div>'; }
        this.place(e, P.x, P.y, 3000);
        const say = app.remote && app.remote.me ? app.remote.says.get(app.remote.me.pid) : null;
        if (say) this.speak('you', 'You', say.text, P.x, P.y - 30, 6000, 0, say, now / 1000 + READ_MS / 1000);
      }
    }
    // Other players (WP1.10): display-name tags, an "observing" marker, friends marked, chat bubbles.
    const R = app.remote;
    if (R) {
      const friends = app.social ? app.social.friendIds : null;
      for (const r of R.drawn) {
        if (nt >= MAXL) break;
        const X = r.extra, say = R.says.get(r.pid), d = this.project(X.x, X.y + (fp ? SHOULDER : HEAD), X.z);
        if (d < 0 || d > 420) continue;
        const at = fp ? this.beside(P.x, P.y, d, say ? BUBBLE_W : 30 + r.name.length * 7.5) : { x: P.x, y: P.y, side: 0 }, side = at.side;
        const friend = !!(friends && friends.has(r.pid));
        const cls = `tagname player${r.observing ? ' obs' : ''}${friend ? ' friend' : ''}${r.you ? ' me' : ''}`;
        const html = `<span class="ico">${r.observing ? '👁️' : friend ? '⭐' : '🧍'}</span>${esc(r.you ? `${r.name} (you)` : r.name)}${r.observing ? '<span class="obs-t">observing</span>' : ''}`;
        const e = this.node(this.tags, nt++, 'lbl'), key = cls + html;
        if (e._k !== key) { e._k = key; e.innerHTML = `<div class="${cls}">${html}</div>`; }
        e.style.opacity = r.fade < 1 ? String(Math.max(0, r.fade)) : '';
        const z = 2500 + 1000 - Math.min(999, Math.round(d)), x = at.x, y = at.y;
        this.place(e, x, y, z, side);
        if (say) this.speak('p' + r.pid, r.name, say.text, x, side ? y - 16 : y - 30, z + 3000, side, say, now / 1000 + READ_MS / 1000);
      }
    }
    const placed = [];
    for (let n = 0; n < cand.length && nt < MAXL; n++) {
      const c = cand[n], i = c.i, p = S.people[i], vip = !!(p && p.v), selc = i === sel;
      const u = USES[USE_LIST[A.use[i]]], icon = u && u.icon !== '•' ? u.icon : '';
      const nm = p ? (vip || selc || c.pri === 2 ? p.n : p.n.split(' ')[0]) : '#' + i;
      const live = vip && S.presence[p.ag] && S.presence[p.ag].working;
      const w = 30 + nm.length * 7.5 + (icon ? 18 : 0) + (vip ? 18 : 0) + (p?.po ? 18 : 0), say = S.says.get(i);
      // (first person: on the side with room for it - and for its bubble, when it speaks)
      let side = 0;
      if (fp) { const at = this.beside(c.x, c.y, c.d, say ? BUBBLE_W : w); side = at.side; c.x = at.x; c.y = at.y; }
      const cx = c.x + side * w / 2;   // (the tag's middle, for keeping tags apart)
      let y = c.y;
      if (c.pri >= 3) {
        for (let k = 0; k < 3 && !fits(placed, cx, y, w); k++) y -= 21;
        if (!fits(placed, cx, y, w)) continue;
      }
      placed.push({ x: cx, y, w });
      let html;
      // (🛎 on post around the clock: anyone may walk up and ask - server/agent-posts/)
      if (vip) html = `<span class="ico" data-avatar>${p.e || '⭐'}</span>${esc(nm)}${live ? '<i class="dot"></i>' : ''}${p.po ? ' <span class="ico post" title="On duty around the clock">🛎</span>' : ''}${selc && icon && !p.po ? ` <span class="ico">${icon}</span>` : ''}`;
      else html = `${icon ? `<span class="ico">${icon}</span>` : ''}${esc(nm)}`;
      const talking = i === this.talk.i;
      const cls = `tagname${vip ? ' vip' : ''}${selc ? ' sel' : ''}${c.pri === 4 && !vip ? ' small' : ''}${talking ? ' voicing' : ''}`;
      const key = cls + html;
      const e = this.node(this.tags, nt++, 'lbl');
      if (e._k !== key) { e._k = key; e.innerHTML = `<div class="${cls}">${html}</div>`; }
      const lv = talking ? this.talk.lv.toFixed(3) : '';
      if (e._lv !== lv) { if (lv) e.style.setProperty('--lv', lv); else e.style.removeProperty('--lv'); e._lv = lv; }
      const z = (c.pri === 0 ? 2000 : c.pri <= 2 ? 1500 : 0) + 1000 - Math.min(999, Math.round(c.d));
      this.place(e, c.x, y, z, side);
      if (say) this.speak(i, p ? p.n : '', say.text, c.x, side ? y - 16 : y - 30, z + 3000, side, say, keep);
    }
    for (let k = nt; k < this.tags.length; k++) if (this.tags[k].style.display !== 'none') this.tags[k].style.display = 'none';
    // (not this frame: hidden - off the screen a moment, or its words are over - and gone after a while)
    for (const [k, b] of this.bubs) {
      if (b._used === this.fn) continue;
      if (b.style.display !== 'none') { b.style.display = 'none'; b._hid = now; b._hover = false; }
      else if (now - b._hid > 3000) { b.remove(); this.bubs.delete(k); }
    }
  }
}

export function init(app) {
  const L = app.labels = new Labels(app);
  bus.on('postframe', () => L.frame());
}
