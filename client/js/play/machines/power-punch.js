// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Power Punch in the world (the rules: shared/arcade/games/power-punch.js; the frame: ../machine-play.js): the Punching
// Machine's own ball on its arm (its part: render/furniture-arcade.js 'bag'), folding down into place for each punch and
// knocked back by it; a timing strip on its panel with a light running along it; a boxing glove in front of you that
// draws back as you wind up and drives into the ball when you let go; the machine's screen counting the strength up and
// calling it.
import { BOXER } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/power-punch.js';

const { PUNCHES, powerOf, swingNow, gradeOf } = sim;
const DROP = 40;
const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function create({ THREE, group, play }) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0, ...o });
  // the timing strip: a dark bar, its green middle, the running light
  const S = BOXER.strip, strip = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(S.w * 2 + 0.04, 0.05, 0.01), std('#0b0b12'));
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(S.w * 0.22, 0.034), new THREE.MeshBasicMaterial({ color: '#22c55e', toneMapped: false })); mid.position.z = 0.006;
  const ends = [-1, 1].map(k => { const m = new THREE.Mesh(new THREE.PlaneGeometry(S.w * 0.35, 0.034), new THREE.MeshBasicMaterial({ color: '#7f1d1d', toneMapped: false })); m.position.set(k * S.w * 0.82, 0, 0.006); return m; });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), new THREE.MeshBasicMaterial({ color: '#fde047', toneMapped: false })); light.position.z = 0.014;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false })); light.add(glow);
  strip.add(bar, mid, ...ends, light); strip.position.set(0, S.y, S.z + 0.006); group.add(strip);
  // the glove: a padded fist, its thumb, a white cuff
  const glove = new THREE.Group(), red = std('#dc2626', { roughness: 0.35 });
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12), red); fist.scale.set(1, 0.95, 1.2);
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), red); thumb.position.set(0.055, -0.01, -0.02);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.05, 16), std('#f8fafc')); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.085;
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.006, 6, 20), std('#facc15')); trim.position.z = 0.06;
  glove.add(fist, thumb, cuff, trim); glove.scale.setScalar(0.85); group.add(glove);
  const REST = [0.2, 1.3, 0.86], HIT = [BOXER.ball[0] + 0.02, BOXER.ball[1], BOXER.ball[2] + BOXER.ballR + 0.06];
  let T = 0, shown = 0, wind = 0;
  return {
    camera: { pos: [0, 1.62, 1.6], at: [0, 1.42, -0.1], fov: 50, fit: 0.95 },
    board: { w: 256, h: 176, ...BOXER.screen },
    reset() { shown = 0; },
    /** The ball on its arm: folding down into place, knocked back by the punch. */
    part(part, M, s) {
      if (part.info?.kind !== 'bag') return undefined;
      if (!s) return false;
      const a = s.ph === 'drop' ? -1.45 * (1 - ease(s.pt / DROP)) : s.ph === 'hit' ? -1.25 * swingNow(s) : 0;
      M.makeRotationX(a); return true;
    },
    event(ev) {
      const face = [BOXER.ball[0], BOXER.ball[1], BOXER.ball[2] + BOXER.ballR];
      if (ev.k === 'punch') {
        play.burst(face, ev.perfect ? ['#fde047', '#ffffff', '#f97316'] : ['#ffffff', '#fecaca', '#fde68a'], 18 + Math.round(ev.n / 30), 1 + ev.n / 600, 0.8);
        play.float(String(ev.n), [face[0], face[1] + 0.2, face[2]], { color: '#fde047', size: 30 + Math.round(ev.n / 40) });
      } else if (ev.k === 'grade') {
        play.float(`${ev.grade}!`, [0, 1.95, 0.1], { color: ev.n >= 900 ? '#fde047' : ev.n >= 750 ? '#fb923c' : '#e2e8f0', size: 30, life: 1.4 });
        if (ev.perfect) play.float('PERFECT +100', [0, 1.78, 0.2], { color: '#4ade80', size: 28, life: 1.4 });
      }
    },
    sfx(ev) { return { ready: ['tick'], wind: ['turn'], full: ['power'], punch: ['punchhit', ev.n / 999], grade: ev.n >= 900 ? ['fanfare'] : ev.n >= 600 ? ['bonus'] : ['point'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'punch' ? 40 + Math.round(ev.n / 8) : 0; },
    update(s, dt) {
      T += dt;
      if (!s) return;
      strip.visible = s.ph === 'aim';
      light.position.x = s.light * S.w;
      const near = 1 - Math.abs(s.light);
      light.material.color.set(near > 0.9 ? '#4ade80' : near > 0.6 ? '#fde047' : '#f87171'); glow.material.color.copy(light.material.color);
      // the glove: drawn back with the wind-up, driven into the ball, back to rest
      const w = s.ph === 'aim' && s.charge >= 0 ? powerOf(s.charge) : 0;
      wind += (w - wind) * Math.min(1, dt * 14);
      let p = [REST[0], REST[1] - wind * 0.05, REST[2] + wind * 0.16];
      if (s.ph === 'hit') {
        const u = s.pt / 22, k = u < 0.3 ? ease(u / 0.3) : Math.max(0, 1 - ease((u - 0.3) / 0.7));
        p = [REST[0] + (HIT[0] - REST[0]) * k, REST[1] + (HIT[1] - REST[1]) * k, REST[2] + (HIT[2] - REST[2]) * k];
      }
      glove.position.set(p[0], p[1] + Math.sin(T * 3) * 0.004, p[2]);
      glove.rotation.set(-0.15, 0.25 - wind * 0.15, -0.1);
      glove.visible = !s.over;
      // the screen: the strength counting up, then its name
      const target = s.ph === 'hit' || s.ph === 'show' ? s.last : 0;
      shown = target ? Math.min(target, shown + Math.max(1, target) * dt * 1.6) : 0;
    },
    hud(s) {
      const n = Math.round(shown), showing = s.ph === 'hit' || s.ph === 'show';
      return {
        info: `Punch ${Math.min(PUNCHES, s.punch + 1)} of ${PUNCHES}`,
        meter: s.ph === 'aim' ? (s.charge >= 0 ? powerOf(s.charge) : 0) : null,
        hint: s.ph === 'aim' && s.punch === 0 && s.charge < 0 ? 'Hold Z (or the mouse button) to wind up; let go when the light is in the green' : s.ph === 'drop' ? 'Get ready…' : '',
        board: showing ? [String(n), n >= s.last ? gradeOf(s.last) : '', `TOTAL ${s.score}`] : [`PUNCH ${Math.min(PUNCHES, s.punch + 1)}`, `TOTAL ${s.score}`],
      };
    },
    dispose() {},
  };
}
