// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Skee Roll in the world (the rules: shared/arcade/games/skee-roll.js; the frame: ../machine-play.js): the Skee-Ball
// machine's own lane and ring board (shared/arcade/machines.js SKEE). From where its player stands: the ball at the near
// end of the lane, a lit line on the wood where it is aimed; let go and it rolls up the lane, spinning, leaps off the
// hump in an arc, lands on the ring board, rolls back a little into its cup and drops in; the cup's points rise from it.
// The machine's screen shows the score and the ball.
import { SKEE, skeeLane } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/skee-roll.js';

const { BALLS, HUMP, powerOf } = sim;
const L = skeeLane(), [LY0, LZ0] = SKEE.laneNear, R = SKEE.ballR;
const BS = Math.sin(SKEE.boardSlope), BC = Math.cos(SKEE.boardSlope);
/** A point on the lane (x across, d along it from its near end) in the machine's frame, the ball resting on it. */
const lane = (x, d) => [x, LY0 + d * L.sin + R, LZ0 - d * L.cos];
/** A point on the ring board (x across, u up it from its bottom edge), the ball resting on it (out along its face). */
const board = (x, u, out = R) => [x, SKEE.board0[0] + u * BS + out * BC, SKEE.board0[1] - u * BC + out * BS];
const COL = { 10: '#38bdf8', 20: '#22c55e', 30: '#facc15', 40: '#fb923c', 50: '#f43f5e', 100: '#e879f9' };

export function create({ THREE, group, play }) {
  const mat = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.35, metalness: 0.1 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), mat);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, R * 0.12, 6, 20), new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.4 }));
  ball.add(stripe); group.add(ball);
  // the aim: a lit strip on the lane
  const aimMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false });
  const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 1), aimMat); group.add(aim);
  let T = 0, spin = 0, last = null;
  const at = p => ball.position.set(p[0], p[1], p[2]);
  return {
    camera: { pos: [0, 1.62, 2.45], at: [0, 0.98, -0.45], fov: 55, fit: 0.95 },
    board: { w: 256, h: 128, x0: -0.3, x1: 0.3, y0: 1.55, y1: 1.85, z: -1.408 },
    reset() { last = null; },
    event(ev) {
      if (ev.k === 'cup' && ev.pts > 0) {
        const p = board(ev.x, ev.u, 0.03);
        play.burst(p, [COL[ev.pts], '#ffffff'], ev.pts >= 50 ? 36 : 14, ev.pts >= 50 ? 1.1 : 0.7, 0.9);
        play.float(`+${ev.pts}`, p, { color: COL[ev.pts], size: ev.pts >= 50 ? 36 : 26 });
        if (ev.bonus) play.float(`HAT TRICK +${ev.bonus}`, [0, 1.6, -0.9], { color: '#fde047', size: 32, life: 1.6 });
      } else if (ev.k === 'cup') play.float('NO SCORE', lane(0, 0.3), { color: '#cbd5e1', size: 22 });
    },
    sfx(ev) { return { roll: ['skeeroll', ev.power], jump: ['hop'], land: ['skeeland'], cup: ev.pts >= 100 ? ['fanfare'] : ev.pts >= 50 ? ['bonus'] : ev.pts ? ['point'] : ['lost'], rail: ['bump'], backboard: ['bump'], over: ['over'], ready: ['tick'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'land' ? 25 : ev.k === 'cup' && ev.pts >= 50 ? 60 : 0; },
    update(s, dt) {
      T += dt;
      const b = s?.b;
      ball.visible = !!s && !s.over && (!!b || s.wait <= 0);
      aim.visible = !!s && !b && s.wait <= 0 && !s.over;
      if (!s) return;
      if (!b) {
        // waiting at the near end; the aim line up the lane
        at(lane(0, 0.06));
        const a = (s.aim / 1024) * Math.PI * 2, len = HUMP * 0.92, sx = Math.sin(a), mid = lane(sx * len * 0.5, 0.06 + len * 0.5);
        aim.position.set(mid[0], mid[1] - R + 0.003, mid[2]);
        aim.scale.y = len;
        aim.rotation.set(Math.asin(L.sin) - Math.PI / 2, 0, -a);   // (flat on the lane, its length up it, leaning the way it is aimed)
        aimMat.opacity = s.charge >= 0 ? 0.35 + 0.5 * powerOf(s.charge) : 0.4 + 0.15 * Math.sin(T * 5);
        return;
      }
      if (b.ph === 'roll' || b.ph === 'back') { at(lane(b.x, b.d)); spin += (b.ph === 'back' ? -1 : 1) * Math.abs(b.vd || 1) * dt / R; }
      else if (b.ph === 'fly') {
        const u = b.t / b.ft, p0 = lane(b.x0, HUMP), p1 = board(b.x1, b.u), h = Math.max(0.05, b.peak) * 4 * u * (1 - u);
        at([p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u + h, p0[2] + (p1[2] - p0[2]) * u]);
        spin += dt * 12;
      } else if (b.ph === 'settle') {
        const u = Math.min(1, b.t / 18), x = b.sx + (b.mx - b.sx) * u, uu = b.su + (b.mu - b.su) * u, sink = Math.max(0, (b.t - 18) / 12);
        at(board(x, uu, R * (1 - sink * 1.6)));
        spin += dt * 6 * (1 - u);
      }
      ball.rotation.x = -spin;
      last = b;
    },
    hud(s) {
      const b = s.b;
      return {
        info: `Ball ${Math.min(BALLS, s.ball + 1)} of ${BALLS}`,
        meter: !b && s.charge >= 0 ? powerOf(s.charge) : !b && !s.over ? 0 : null,
        hint: !b && s.ball === 0 && s.charge < 0 && s.wait <= 0 ? 'Aim with ◀ ▶ or the mouse, hold Z (or the mouse button), let go to roll' : '',
        board: [String(s.score), `BALL ${Math.min(BALLS, s.ball + 1)}/${BALLS}`],
      };
    },
    dispose() {},
  };
}
