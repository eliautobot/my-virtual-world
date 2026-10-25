// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Foos Frenzy in the world (the rules: shared/arcade/games/foos-frenzy.js; the frame: ../machine-play.js): on the Foosball
// table itself. Its own eight rods (its parts: render/furniture-arcade.js 'rod0' … 'rod7') slid and turned by the game,
// your red ones and the computer's blue; the ball rolling on the felt, into the goal and gone; a faint line across the
// field where your men are going; the score panel on the far side. You stand at your rods' handles.
import { FOOS } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/foos-frenzy.js';

const { GOALS, toPx, twistOf } = sim;
const T = FOOS.top, R = FOOS.ballR;
const clock = n => { const t = Math.max(0, Math.ceil(n / 60)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function create({ THREE, group, play, app }) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 18, 12), new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.4 }));
  const spot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.35, 8, 6), new THREE.MeshStandardMaterial({ color: '#111827' })); spot.position.set(0, 0, R * 0.92); ball.add(spot);
  group.add(ball);
  const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.03, FOOS.hl * 2), new THREE.MeshBasicMaterial({ color: '#f87171', transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
  aim.rotation.x = -Math.PI / 2; aim.position.y = T + 0.002; group.add(aim);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), inv = new THREE.Matrix4(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  const q = new THREE.Quaternion(), ax = new THREE.Vector3();
  let sank = 0, lx = 0, lz = 0;
  return {
    // (on a phone held upright: from behind your goal, the field running up the screen, your men sliding across it)
    camera: { pos: [1.02, 1.6, 0], at: [-0.02, T, 0], fov: 55, fit: 1.62, narrow: { pos: [0, 2.0, -1.45], at: [0, T, 0.12], fit: 0.95 } },
    board: { w: 256, h: 80, ...FOOS.sign },
    reset(s) { sank = 0; if (s) { lx = s.bx; lz = s.bz; } },
    /** The table's own rods: slid and turned as the game has them. */
    part(part, M, s) {
      const m = /^rod(\d)$/.exec(part.name); if (!m) return undefined;
      if (!s) return false;
      const i = Number(m[1]), tw = twistOf(s, i);
      M.makeTranslation(s.sl[i], 0, 0).multiply(new THREE.Matrix4().makeRotationX(FOOS.red[i] ? -tw : tw));
      return true;
    },
    /** Where the pointer is across the field, as the game reads it. */
    pointer(p, camera) {
      const r = app.stage.renderer.domElement.getBoundingClientRect();
      ndc.set(((p.x / 255) * innerWidth - r.left) / r.width * 2 - 1, -(((p.y / 255) * innerHeight - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.set(new THREE.Vector3(0, 1, 0), -play.world([0, T + 0.02, 0]).y);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.applyMatrix4(inv.copy(play.M).invert());
      if (Math.abs(hit.x) > FOOS.hw + 0.4 || Math.abs(hit.z) > FOOS.hl + 0.3) return null;
      const [px, py] = toPx(Math.max(-FOOS.hw, Math.min(FOOS.hw, hit.x)), Math.max(-FOOS.hl, Math.min(FOOS.hl, hit.z)));
      return { px, py };
    },
    event(ev) {
      if (ev.k === 'kick') play.burst([ev.x, T + 0.02, ev.z], ev.red ? ['#fecaca', '#ffffff'] : ['#bfdbfe', '#ffffff'], 5, 0.4, 0.3);
      else if (ev.k === 'goal') {
        sank = 0;
        const z = ev.who === 1 ? FOOS.hl : -FOOS.hl;
        play.burst([ev.x, T + 0.05, z], ev.who === 1 ? ['#fde047', '#ffffff', '#f87171'] : ['#60a5fa', '#ffffff'], ev.who === 1 ? 40 : 16, 1, 0.9);
        if (ev.who === 1) {
          play.float('GOAL!', [0, T + 0.32, 0.35], { color: '#fde047', size: 40, life: 1.4 });
          play.float(`+${ev.pts}${ev.tags.length ? ' ' + ev.tags.join(' · ') : ''}`, [0, T + 0.2, 0.3], { color: '#ffffff', size: 24, life: 1.5 });
        } else play.float('Goal against', [0, T + 0.25, -0.35], { color: '#93c5fd', size: 26, life: 1.3 });
      } else if (ev.k === 'block') play.float('BLOCK +10', [ev.x, T + 0.15, ev.z], { color: '#4ade80', size: 22 });
      else if (ev.k === 'dead') play.float('Dead ball: served again', [0, T + 0.2, 0], { color: '#cbd5e1', size: 20 });
      else if (ev.k === 'hurry') play.float('10 seconds!', [0, T + 0.3, 0], { color: '#fca5a5', size: 26 });
      else if (ev.k === 'over') play.float(ev.win ? (ev.shutout ? 'SHUTOUT WIN!' : 'YOU WIN!') : ev.me === ev.cpu ? 'A DRAW' : 'THE COMPUTER WINS', [0, T + 0.35, 0], { color: ev.win ? '#fde047' : '#e2e8f0', size: 36, life: 2 });
    },
    sfx(ev) {
      if (ev.k === 'kick') return ['footkick', 0.06];
      if (ev.k === 'bump') return ev.v > 0.012 ? ['footkick', ev.v] : null;
      if (ev.k === 'goal') return ev.who === 1 ? [['goalhorn'], ['bonus']] : [['goalhorn'], ['lost']];
      return { wall: ['bump'], block: ['point'], serve: ['tick'], dead: ['tick'], hurry: ['tick'], buzzer: ['buzzer'], swing: ['turn'], over: ev.win ? ['fanfare'] : ['over'] }[ev.k] || null;
    },
    buzz(ev) { return ev.k === 'goal' ? 60 : ev.k === 'kick' && ev.red ? 18 : 0; },
    update(s, dt) {
      if (!s) return;
      if (s.ph === 'goal') {
        sank += dt;
        const u = Math.min(1, sank / 0.3), z = s.scorer === 1 ? FOOS.hl : -FOOS.hl;
        ball.position.set(lx, T + R - 0.06 * u, z + Math.sign(z) * 0.03 * u); ball.visible = u < 1;
        return;
      }
      ball.visible = true;
      // rolling: turned about the axis across its way, as far as it went
      const dx = s.bx - lx, dz = s.bz - lz, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1e-5 && d < 0.2) { ax.set(dz, 0, -dx).normalize(); ball.quaternion.premultiply(q.setFromAxisAngle(ax, d / R)); }
      lx = s.bx; lz = s.bz;
      ball.position.set(s.bx, T + R, s.bz);
      aim.position.x = s.tx;
    },
    hud(s) {
      return {
        info: `You ${s.me} · ${s.cpu} CPU · ⏱ ${clock(s.clock)}`,
        hint: s.t < 360 ? `Point at the ball to bring your men to it · click (or Z) to kick · first to ${GOALS}` : '',
        board: [`${s.me}  -  ${s.cpu}`, clock(s.clock)],
      };
    },
    dispose() {},
  };
}
