// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Star Pinball in the world (the rules: shared/arcade/games/star-pinball.js; the frame: ../machine-play.js): on the Pinball
// machine itself. Its own flippers, ball, drop targets and plunger (its parts: render/furniture-arcade.js 'flipL',
// 'flipR', 'ball', 'drop0' … 'drop2', 'plunger') moved by the game; the pop bumpers and slingshots flash when hit; the
// rollover lanes and the bonus multiplier light up; the score on the backbox's display. You stand at the front.
import { PIN, pinAt } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/star-pinball.js';

const { BALLS, MULT_MAX } = sim;
const S = PIN.surf, TURN = (Math.PI * 2) / 1024;

export function create({ THREE, group, play }) {
  // the playfield's own frame: x, up from its surface, z down the slope
  const pf = new THREE.Group(); pf.position.set(...PIN.pivot); pf.rotation.x = PIN.tilt; group.add(pf);
  const glow = (c, o = 0) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const bumps = PIN.bumpers.map(([x, z], i) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(PIN.bumperR * 1.7, 24), glow(['#f472b6', '#22d3ee', '#facc15'][i]));
    m.rotation.x = -Math.PI / 2; m.position.set(x, S + 0.05, z); pf.add(m); return m;
  });
  const slings = PIN.slings.map(([a, , c]) => {
    const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.BoxGeometry(l, 0.03, 0.02), glow('#ffffff'));
    m.position.set((a[0] + c[0]) / 2, S + 0.015, (a[1] + c[1]) / 2); m.rotation.y = Math.atan2(-dz, dx); pf.add(m); return m;
  });
  const lamp = (x, z, r) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: '#7c2d12', toneMapped: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, S + 0.0016, z); pf.add(m); return m; };
  const lanes = PIN.lanes.map(x => lamp(x, -0.39, 0.012));
  const mults = Array.from({ length: MULT_MAX - 1 }, (_, k) => lamp(-0.03 + (k - 1.5) * 0.04, 0.27, 0.011));
  const targetsLit = PIN.targets.map(z => lamp(PIN.targetX + 0.035, z, 0.008));
  const fb = { bump: [0, 0, 0], sling: [0, 0] };
  const UP = new THREE.Vector3(0, Math.cos(PIN.tilt), Math.sin(PIN.tilt)), ALONG = new THREE.Vector3(0, -Math.sin(PIN.tilt), Math.cos(PIN.tilt));
  const REST = pinAt(PIN.lane.rest[0], PIN.lane.rest[1], PIN.ballR);
  let T = 0;
  const at = (x, z, h = 0.1) => pinAt(x, z, h);
  return {
    camera: { pos: [0, 1.7, 1.12], at: [0, 1.0, 0.0], fov: 50, fit: 0.86 },
    board: { w: 256, h: 120, ...PIN.screen },
    reset() { fb.bump.fill(0); fb.sling.fill(0); },
    /** The machine's own flippers, ball, drop targets and plunger, where the game has them. */
    part(part, M, s) {
      const n = part.name;
      if (n === 'flipL' || n === 'flipR') {
        if (!s) return false;
        const i = n === 'flipR' ? 1 : 0, a = s.fa[i];
        M.makeRotationAxis(UP, (i ? a - PIN.flipRest : PIN.flipRest - a) * TURN); return true;
      }
      if (n === 'ball') {
        if (!s) return false;
        if (s.ph === 'drain' || s.over) { M.makeScale(1e-4, 1e-4, 1e-4); return true; }
        const p = pinAt(s.x, s.z, PIN.ballR); M.makeTranslation(p[0] - REST[0], p[1] - REST[1], p[2] - REST[2]); return true;
      }
      const d = /^drop(\d)$/.exec(n);
      if (d) { if (!s) return false; if (!s.down[Number(d[1])]) return false; M.makeTranslation(-UP.x * 0.031, -UP.y * 0.031, -UP.z * 0.031); return true; }
      if (n === 'plunger') { if (!s) return false; const k = s.ph === 'lane' ? s.pull * 0.045 : 0; M.makeTranslation(ALONG.x * k, ALONG.y * k, ALONG.z * k); return true; }
      return undefined;
    },
    /** (the flippers are held by halves of the screen: shared/arcade/catalog.js pointer.sides; no aiming) */
    pointer() { return null; },
    event(ev) {
      if (ev.k === 'bumper') { fb.bump[ev.j] = 1; const [x, z] = PIN.bumpers[ev.j]; play.burst(at(x, z, 0.05), ['#ffffff', ['#f472b6', '#22d3ee', '#facc15'][ev.j]], 6, 0.35, 0.25); }
      else if (ev.k === 'sling') fb.sling[ev.i] = 1;
      else if (ev.k === 'target') play.float('+200', at(PIN.targetX + 0.05, PIN.targets[ev.j]), { color: '#fde047', size: 20 });
      else if (ev.k === 'targets') play.float(`TARGETS! x${ev.mult}`, at(-0.03, -0.05, 0.2), { color: '#fde047', size: 30, life: 1.4 });
      else if (ev.k === 'lanes') play.float(`LANES! x${ev.mult}`, at(-0.01, -0.3, 0.2), { color: '#fde047', size: 30, life: 1.4 });
      else if (ev.k === 'skill') { play.float('SKILL SHOT +1000', at(PIN.lanes[ev.j], -0.35, 0.2), { color: '#4ade80', size: 30, life: 1.6 }); play.burst(at(PIN.lanes[ev.j], -0.39, 0.03), ['#4ade80', '#ffffff', '#fde047'], 24, 0.6, 0.6); }
      else if (ev.k === 'saved') play.float('BALL SAVED', at(-0.03, 0.3, 0.2), { color: '#4ade80', size: 30, life: 1.5 });
      else if (ev.k === 'drain') play.float(`BONUS ${ev.bonus.toLocaleString('en-US')}${ev.mult > 1 ? ` x${ev.mult}` : ''}`, at(-0.03, 0.2, 0.25), { color: '#fde047', size: 28, life: 1.8 });
      else if (ev.k === 'ball') play.float(`BALL ${ev.n}`, at(-0.03, 0.1, 0.25), { color: '#ffffff', size: 30, life: 1.4 });
      else if (ev.k === 'search') play.float('Ball search', at(-0.03, 0, 0.2), { color: '#cbd5e1', size: 20 });
    },
    sfx(ev) {
      return { bumper: ['popbumper', ev.j], sling: ['sling'], target: ['droptarget'], targets: ['bonus'], lane: ['rollover', ev.j], lanes: ['bonus'], skill: ['fanfare'], flip: ['flipper'], launch: ['plunger', ev.p], saved: ['point'], drain: ['lost'], ball: ['start'], search: ['tick'], over: ['over'] }[ev.k] || null;
    },
    buzz(ev) { return ev.k === 'bumper' ? 14 : ev.k === 'flip' ? 8 : ev.k === 'drain' ? 50 : ev.k === 'skill' ? 40 : 0; },
    update(s, dt) {
      T += dt;
      for (let j = 0; j < 3; j++) { fb.bump[j] = Math.max(0, fb.bump[j] - dt * 5); bumps[j].material.opacity = 0.85 * fb.bump[j]; bumps[j].scale.setScalar(0.8 + 0.4 * fb.bump[j]); }
      for (let i = 0; i < 2; i++) { fb.sling[i] = Math.max(0, fb.sling[i] - dt * 6); slings[i].material.opacity = 0.9 * fb.sling[i]; }
      if (!s) return;
      const blink = Math.sin(T * 10) > 0;
      lanes.forEach((m, j) => m.material.color.set(s.lit[j] ? '#fde047' : s.skill && s.ph !== 'drain' && j === s.skillLane && blink ? '#4ade80' : '#7c2d12'));
      mults.forEach((m, k) => m.material.color.set(s.mult >= k + 2 ? '#22d3ee' : '#1e3a8a'));
      targetsLit.forEach((m, j) => m.material.color.set(s.down[j] ? '#f472b6' : '#4c1d3d'));
    },
    hud(s) {
      return {
        info: `Ball ${Math.min(BALLS, s.ball)} of ${BALLS}${s.mult > 1 ? ` · x${s.mult}` : ''}`,
        meter: s.ph === 'lane' && s.pull > 0 ? s.pull : null,
        hint: s.ph === 'lane' && s.ball === 1 && !s.saved ? 'Hold ▼ (or Space, or the right of the screen) and let go to launch · ◀ ▶ (or each half of the screen) flip' : '',
        board: [s.score.toLocaleString('en-US'), `BALL ${Math.min(BALLS, s.ball)}${s.mult > 1 ? '  X' + s.mult : ''}`],
      };
    },
    dispose() {},
  };
}
