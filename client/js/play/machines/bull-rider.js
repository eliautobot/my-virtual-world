// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Bull Rider in the world (the rules: shared/arcade/games/bull-rider.js; the frame: ../machine-play.js): on the Mechanical
// Bull itself. You ride it: the camera is in the rider's eyes, over its horns, and goes with it as it turns and rocks on
// its pole (its part: render/furniture-arcade.js 'bull') and with your lean; thrown, you land on the padded mat beside it
// and look back up at it. The balance ring over the world shows how far you lean.
import { BULL } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/bull-rider.js';

const { levelOf } = sim;
const [PX, PY, PZ] = BULL.pivot, EYE = [BULL.saddle[0], BULL.saddle[1] + 0.62 - PY, BULL.saddle[2] - 0.05 - PZ];

export function create({ THREE, play }) {
  const R = new THREE.Matrix4(), E = new THREE.Euler(), v = new THREE.Vector3(), w = new THREE.Vector3();
  let T = 0, fall = null, lastEye = null, lastAt = null, shake = 0;
  /** The bull's turn about its pivot (yaw, nose down for pitch < 0, its right side down for roll > 0). */
  const turn = s => R.makeRotationFromEuler(E.set(-s.pitch, s.yaw, s.roll, 'YXZ'));
  return {
    camera: { pos: [EYE[0], EYE[1] + PY, EYE[2] + PZ], at: [0, 0.95, 1.6], fov: 62 },
    board: null,
    reset() { fall = null; lastEye = null; },
    part(part, M, s) { if (part.info?.kind !== 'bull') return undefined; if (!s) return false; M.copy(turn(s)); return true; },
    /** The rider's eyes: on the bull as it moves, leaning; thrown, down onto the mat. */
    cameraNow(s, dt) {
      if (!s) return null;
      T += dt;
      if (s.ph !== 'thrown') {
        turn(s);
        // (leaning: right is -x for a rider facing the bull's head, +z; back is -z)
        v.set(EYE[0] - s.lx * 0.2, EYE[1] - 0.06 * Math.min(1, Math.hypot(s.lx, s.lz)), EYE[2] - s.lz * 0.16).applyMatrix4(R);
        w.set(-s.lx * 0.1, -0.42, 1.0).applyMatrix4(R).add(v);
        shake = Math.max(0, shake - dt * 3);
        const j = shake * 0.01 * Math.sin(T * 60);
        lastEye = [PX + v.x + j, PY + v.y + j, PZ + v.z];
        lastAt = [PX + w.x, PY + w.y, PZ + w.z];
        return { pos: lastEye, at: lastAt };
      }
      // thrown: an arc down to the mat on the side the rider fell, then looking up at the bull
      if (!fall) {
        const yawNow = s.yaw, side = s.fellX || (s.fellZ ? 0.4 : 1), back = s.fellZ;
        const out = new THREE.Vector3(-side * 0.9, 0, -back * 0.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawNow);
        fall = { from: lastEye || [0, 1.8, 0], to: [PX + out.x, 0.32, PZ + out.z], t: 0 };
      }
      fall.t = Math.min(1, fall.t + dt / 0.75);
      const u = fall.t, h = 0.35 * 4 * u * (1 - u);
      const pos = [0, 1, 2].map(k => fall.from[k] + (fall.to[k] - fall.from[k]) * u);
      pos[1] += h;
      return { pos, at: [PX, 1.05 + (1 - u) * 0.3, PZ] };
    },
    event(ev) {
      // (words float just ahead of where the rider looks)
      const ahead = lastAt ? [lastAt[0], lastAt[1] + 0.35, lastAt[2]] : [0, 1.6, 1.2];
      if (ev.k === 'move') shake = Math.min(1, 0.3 + ev.lv * 0.1);
      else if (ev.k === 'go') play.float('GO!', ahead, { color: '#fde047', size: 40 });
      else if (ev.k === 'eight') play.float('8 SECONDS! +100', ahead, { color: '#fde047', size: 34, life: 1.6 });
      else if (ev.k === 'smooth') play.float('SMOOTH +25', ahead, { color: '#4ade80', size: 24 });
      else if (ev.k === 'level') play.float('WILDER!', ahead, { color: '#fb923c', size: 34 });
      else if (ev.k === 'tamed') play.float('BULL TAMED! +500', ahead, { color: '#fde047', size: 38, life: 2 });
      else if (ev.k === 'thrown') play.float('THROWN!', ahead, { color: '#f87171', size: 38 });
    },
    sfx(ev) { return { go: ['fanfare'], move: ['bullbuck', ev.lv], eight: ['bonus'], smooth: ['point'], level: ['level'], thrown: ['thump'], tamed: ['fanfare'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'move' ? 25 + ev.lv * 10 : ev.k === 'thrown' ? 200 : 0; },
    update() {},
    hud(s) {
      const secs = Math.floor(s.ride / 60), lv = levelOf(s);
      return {
        info: `⏱ ${secs}s · Level ${lv + 1}`,
        balance: s.ph === 'ride' || s.ph === 'start' ? { x: s.lx, z: s.lz } : null,
        hint: s.ph === 'start' ? 'Hold on! Lean against the bull: ◀ ▶ ▲ ▼, or move the mouse the way you lean' : s.ph === 'thrown' ? `Thrown after ${secs} seconds!` : s.ph === 'tamed' ? 'BULL TAMED!' : '',
        board: [String(sim.score(s))],
      };
    },
    dispose() {},
  };
}
