// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Mole Mayhem in the world (the rules: shared/arcade/games/mole-mayhem.js; the frame: ../machine-play.js): the
// Whack-a-Mole machine's own five holes. Seen from where its player stands, moles come up out of them (round, furry, big
// eyes; a gold one glowing, one in a hard hat holding a lit bomb), a foam mallet hangs over the hole you are on (lit by a
// ring round it) and comes down on it, sparks fly, the hit mole squashes and sees stars. The machine's screen shows the
// score and the time. The machine's own still moles and mallet are put away meanwhile (its parts: render/venue-motion.js).
import { WHACK } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/mole-mayhem.js';

const { ROUND, FRENZY, GOLD, BOMB, NORMAL, out, mult, holePx } = sim;
const DEPTH = 0.17;   // how far below the deck a mole hides

export function create({ THREE, group, play, app }) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0, ...o });
  const M = {
    fur: std('#8b5a2b'), gold: std('#fbbf24', { emissive: '#b45309', emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3 }), grey: std('#78716c'),
    belly: std('#f5deb3'), white: std('#ffffff', { roughness: 0.3 }), black: std('#111111', { roughness: 0.3 }), pink: std('#f472b6'),
    hat: std('#f59e0b'), bomb: std('#18181b', { roughness: 0.4 }), fuse: new THREE.MeshBasicMaterial({ color: '#fb923c', toneMapped: false }),
    star: new THREE.MeshBasicMaterial({ color: '#fde047', toneMapped: false }), ring: new THREE.MeshBasicMaterial({ color: '#fef08a', transparent: true, opacity: 0.85, toneMapped: false }),
    handle: std('#7c2d12'), head: std('#ef4444', { roughness: 0.8 }), band: std('#fde047'),
  };
  const G = {
    body: new THREE.SphereGeometry(0.068, 18, 12), belly: new THREE.SphereGeometry(0.05, 14, 10), snout: new THREE.SphereGeometry(0.03, 14, 10), ear: new THREE.SphereGeometry(0.018, 10, 8), paw: new THREE.SphereGeometry(0.022, 10, 8), eye: new THREE.SphereGeometry(0.016, 10, 8), pupil: new THREE.SphereGeometry(0.009, 8, 6),
    nose: new THREE.SphereGeometry(0.014, 10, 8), tooth: new THREE.BoxGeometry(0.009, 0.014, 0.004), hat: new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    bomb: new THREE.SphereGeometry(0.032, 14, 10), fuse: new THREE.SphereGeometry(0.009, 8, 6), star: new THREE.OctahedronGeometry(0.012), ring: new THREE.TorusGeometry(WHACK.holeR + 0.012, 0.008, 8, 28),
  };
  const moles = WHACK.holes.map(([x, z]) => {
    const g = new THREE.Group(), body = new THREE.Mesh(G.body, M.fur);
    body.scale.set(1, 1.35, 1); body.position.y = 0.075;
    const belly = new THREE.Mesh(G.belly, M.belly); belly.scale.set(0.85, 1.0, 0.42); belly.position.set(0, 0.035, 0.05);
    const snout = new THREE.Mesh(G.snout, M.belly); snout.scale.set(1.15, 0.85, 1.0); snout.position.set(0, 0.095, 0.058);
    const ears = [-1, 1].map(s => { const e = new THREE.Mesh(G.ear, M.fur); e.scale.set(1, 1, 0.6); e.position.set(s * 0.05, 0.155, 0.0); return e; });
    const paws = [-1, 1].map(s => { const e = new THREE.Mesh(G.paw, M.belly); e.scale.set(1.2, 0.6, 1.0); e.position.set(s * 0.05, 0.012, 0.07); return e; });
    const eyes = [-1, 1].map(s => { const e = new THREE.Mesh(G.eye, M.white); e.position.set(s * 0.027, 0.13, 0.05); const p = new THREE.Mesh(G.pupil, M.black); p.position.set(0, -0.002, 0.012); e.add(p); return e; });
    const nose = new THREE.Mesh(G.nose, M.pink); nose.scale.set(1.2, 0.85, 0.85); nose.position.set(0, 0.104, 0.088);
    const teeth = [-1, 1].map(s => { const t = new THREE.Mesh(G.tooth, M.white); t.position.set(s * 0.006, 0.07, 0.08); return t; });
    const hat = new THREE.Mesh(G.hat, M.hat); hat.position.y = 0.145; hat.scale.set(1.05, 0.6, 1.05);
    const bomb = new THREE.Mesh(G.bomb, M.bomb); bomb.position.set(0.05, 0.045, 0.06);
    const fuse = new THREE.Mesh(G.fuse, M.fuse); fuse.position.set(0.012, 0.03, 0); bomb.add(fuse);
    const stars = [0, 1, 2].map(() => { const s = new THREE.Mesh(G.star, M.star); g.add(s); return s; });
    g.add(body, belly, snout, ...ears, ...paws, ...eyes, nose, ...teeth, hat, bomb);
    g.position.set(x, WHACK.deck - DEPTH, z);
    group.add(g);
    return { g, body, ears, hat, bomb, fuse, stars, x, z, kind: -1 };
  });
  // a ring round the hole the mallet is on
  const ring = new THREE.Mesh(G.ring, M.ring); ring.rotation.x = Math.PI / 2; group.add(ring);
  // the foam mallet: a handle and a head, swung down from over the hole
  const mallet = new THREE.Group(), arm = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.34, 10), M.handle); handle.rotation.z = Math.PI / 2; handle.position.x = 0.17;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.15, 18), M.head); head.position.x = 0.0;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.02, 18), M.band); head.add(band);
  arm.add(handle, head); mallet.add(arm); group.add(mallet);
  let T = 0, mx = 0, mz = 0.25, swing = 0;
  const hit = new Map();   // hole → squash time left
  return {
    camera: { pos: [0, 1.78, 1.5], at: [0, 1.0, -0.12], fov: 50, fit: 1.15 },
    board: { w: 256, h: 144, x0: -0.4, x1: 0.4, y0: 1.1, y1: 1.55, z: -0.388 },
    reset() { hit.clear(); },
    /** The machine's own moles and its parked mallet are put away while the game's are out. */
    part(part, Mx) { const k = part.info?.kind; if (k === 'mole' || k === 'parked') { Mx.makeScale(1e-4, 1e-4, 1e-4); return true; } return undefined; },
    pointer(p, camera) {
      // the hole under the pointer (on the screen), told as the game reads it
      const r = app.stage.renderer.domElement.getBoundingClientRect();
      const sx = (p.x / 255) * innerWidth, sy = (p.y / 255) * innerHeight, v = new THREE.Vector3();
      let best = -1, bd = Infinity;
      WHACK.holes.forEach(([x, z], i) => {
        v.copy(play.world([x, WHACK.deck + 0.05, z])).project(camera);
        const hx = r.left + (v.x + 1) / 2 * r.width, hy = r.top + (1 - v.y) / 2 * r.height, d = (hx - sx) ** 2 + (hy - sy) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return best >= 0 && bd < (r.width * 0.12) ** 2 ? { px: holePx(best), py: 0 } : null;
    },
    event(ev) {
      if (ev.i !== undefined && !WHACK.holes[ev.i]) return;
      const at = ev.i !== undefined ? [WHACK.holes[ev.i][0], WHACK.deck + 0.14, WHACK.holes[ev.i][1]] : null;
      if (ev.k === 'hit') {
        hit.set(ev.i, 0.25);
        play.burst(at, ev.kind === GOLD ? ['#fde047', '#ffffff', '#f59e0b'] : ['#ffffff', '#fde68a', '#f472b6'], ev.kind === GOLD ? 40 : 18, ev.kind === GOLD ? 1.4 : 1, 1);
        play.float(`+${ev.pts}`, at, { color: ev.kind === GOLD ? '#fde047' : '#ffffff', size: ev.kind === GOLD ? 34 : 26 });
      } else if (ev.k === 'bomb') {
        hit.set(ev.i, 0.3);
        play.burst(at, ['#fb923c', '#f87171', '#fde047', '#3f3f46'], 50, 1.6, 1.2);
        play.float(`${ev.pts}`, at, { color: '#f87171', size: 32 });
      } else if (ev.k === 'whiff') play.burst([at[0], WHACK.deck + 0.01, at[2]], ['#94a3b8', '#cbd5e1'], 8, 0.5, 0.4);
      else if (ev.k === 'mult') play.float(`x${ev.m} COMBO`, [0, 1.25, 0.1], { color: '#f0abfc', size: 30, life: 1.3 });
      else if (ev.k === 'frenzy') play.float('FRENZY!', [0, 1.3, 0.1], { color: '#fde047', size: 40, life: 1.6 });
    },
    sfx(ev) { return { pop: ev.kind === GOLD ? ['bonus'] : ['molepop'], hit: ev.kind === GOLD ? [['whack'], ['bonus']] : ['whack', ev.combo], bomb: ['boom'], whiff: ['bump'], break: ['lost'], mult: ['level'], frenzy: ['fanfare'], count: ['tick'], over: ['buzzer'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'bomb' ? 160 : ev.k === 'hit' ? 18 : 0; },
    update(s, dt) {
      T += dt;
      moles.forEach((m, i) => {
        const st = s ? s.moles[i] : { ph: 2, kind: NORMAL, t: 0 }, u = s ? out(st) : 0;
        if (st.kind !== m.kind) {
          m.kind = st.kind;
          m.body.material = st.kind === GOLD ? M.gold : st.kind === BOMB ? M.grey : M.fur;
          for (const e of m.ears) e.material = m.body.material;
          m.hat.visible = m.bomb.visible = st.kind === BOMB;
        }
        const h = hit.get(i) || 0;
        if (h > 0) hit.set(i, h - dt);
        const sq = h > 0 ? 1 - 0.35 * Math.sin((h / 0.25) * Math.PI) : 1;
        m.g.position.y = WHACK.deck - DEPTH + DEPTH * u * (h > 0 ? 0.85 : 1);
        m.g.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
        m.g.rotation.y = Math.sin(T * 2 + i) * 0.15 * u;
        m.fuse.visible = Math.sin(T * 30) > 0;
        const dizzy = st.ph === 3;
        m.stars.forEach((x, k) => { x.visible = dizzy; if (dizzy) { const a = T * 6 + k * 2.1; x.position.set(Math.cos(a) * 0.06, 0.2, Math.sin(a) * 0.06); x.rotation.y = a; } });
      });
      // the mallet over the hole it is on, coming down when it swings
      const cur = s ? s.cur : 1, [hx, hz] = WHACK.holes[cur];
      mx += (hx - mx) * Math.min(1, dt * 18); mz += (hz - mz) * Math.min(1, dt * 18);
      const down = s && s.swing > 0 ? s.swing / 9 : 0;
      swing += ((down > 0 ? 1 : 0) - swing) * Math.min(1, dt * (down > 0 ? 40 : 10));
      mallet.position.set(mx + 0.02, WHACK.deck + 0.3 - swing * 0.17, mz + 0.06);
      mallet.rotation.set(0, -0.5, -0.9 + swing * 0.9);
      mallet.visible = !!s && !s.over;
      ring.position.set(hx, WHACK.deck + 0.004, hz);
      ring.material.opacity = s && s.stun > 0 ? 0.25 : 0.6 + 0.3 * Math.sin(T * 8);
      ring.visible = !!s && !s.over;
    },
    hud(s) {
      const secs = Math.ceil(s.left / 60), m = mult(s);
      return {
        info: `⏱ ${secs}s · x${m}`,
        hint: s.t < 120 ? 'Whack the moles: click a hole, or ◀ ▶ ▲ ▼ and Z' : s.stun > 0 ? 'Stunned!' : s.left <= FRENZY && !s.over ? 'FRENZY!' : s.combo >= 3 ? `${s.combo} in a row` : '',
        board: [String(s.score), `TIME ${secs}`],
      };
    },
    dispose() { Object.values(G).forEach(g => g.dispose()); Object.values(M).forEach(m => m.dispose()); },
  };
}
