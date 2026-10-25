// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Pool Shark in the world (the rules: shared/arcade/games/pool-shark.js; the frame: ../machine-play.js): on the Billiards
// Table itself. Its own sixteen balls (its parts: render/furniture-arcade.js 'ball0' … 'ball15') rolled by the game,
// turning as they roll and dropping into the pockets; the cue laid on the table put away; a cue in hand behind the cue
// ball, drawn back with the power and struck; for your shot a guide: the line to the first ball, the ghost ball where the
// cue ball will meet it and the way it will go; the score on the lamp over the table. You look down the table from its
// near end.
import { POOL, poolRack } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/pool-shark.js';

const { toPx, groupOf, left, CLOCK } = sim;
const T = POOL.top, R = POOL.ballR;
const ORDER = [1, 10, 2, 11, 8, 3, 12, 4, 13, 5, 9, 6, 14, 7, 15];   // (the model's own rack: render/furniture-arcade.js)
const NAME = ['', 'SOLIDS', 'STRIPES'];

export function create({ THREE, group, play, app }) {
  const rest = []; rest[0] = [POOL.head[0], POOL.head[1]];
  poolRack().forEach((p, i) => { rest[ORDER[i]] = p; });
  const spin = Array.from({ length: 16 }, () => new THREE.Quaternion()), last = Array.from({ length: 16 }, () => null), sunk = new Array(16).fill(0);
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  // the cue in hand: a tapered shaft, its tip and butt
  const cue = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 1.3, 12), new THREE.MeshStandardMaterial({ color: '#e7cf9f', roughness: 0.5 }));
  shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.65;
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.016, 0.42, 12), new THREE.MeshStandardMaterial({ color: '#2b1b12', roughness: 0.4 }));
  butt.rotation.x = Math.PI / 2; butt.position.z = 1.1;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.01, 10), new THREE.MeshStandardMaterial({ color: '#3b82f6' }));
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.005;
  cue.add(shaft, butt, tip); group.add(cue);
  // the guide: a line to the first ball, the ghost ball, the object ball's way
  const lineMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, toneMapped: false });
  const mkLine = () => { const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)); const l = new THREE.Line(g, lineMat); l.frustumCulled = false; group.add(l); return l; };
  const aimLine = mkLine(), objLine = mkLine();
  const ghost = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  ghost.rotation.x = -Math.PI / 2; group.add(ghost);
  const setLine = (l, a, b) => { const p = l.geometry.attributes.position; p.setXYZ(0, a[0], T + R, a[1]); p.setXYZ(1, b[0], T + R, b[1]); p.needsUpdate = true; };
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), inv = new THREE.Matrix4(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  let follow = 0;
  /** Where the cue ball going (ax, az) first meets a ball (its middle then, and the ball), or the cushion. */
  function trace(s) {
    const c = s.balls[0]; let best = null, bt = 1e9;
    for (const b of s.balls) {
      if (b.in || b.n === 0) continue;
      const ox = b.x - c.x, oz = b.z - c.z, tc = ox * s.ax + oz * s.az; if (tc <= 0) continue;
      const d2 = ox * ox + oz * oz - tc * tc, rr = 4 * R * R; if (d2 > rr) continue;
      const t = tc - Math.sqrt(rr - d2); if (t < bt) { bt = t; best = b; }
    }
    let tw = 1e9;
    for (const [lim, v, p] of [[POOL.hw - R, s.ax, c.x], [-(POOL.hw - R), s.ax, c.x], [POOL.hl - R, s.az, c.z], [-(POOL.hl - R), s.az, c.z]]) { if (v && (lim - p) / v > 0) tw = Math.min(tw, (lim - p) / v); }
    const t = Math.min(bt, tw);
    return { at: [c.x + s.ax * t, c.z + s.az * t], ball: bt <= tw ? best : null };
  }
  return {
    camera: { pos: [0, 2.4, 2.05], at: [0, T, 0.25], fov: 50, fit: 1.55, narrow: { pos: [0, 2.55, 2.15], at: [0, T, 0.1], fit: 1.75, noBoard: true } },
    board: { w: 320, h: 48, ...POOL.sign },
    reset() { spin.forEach(q0 => q0.identity()); last.fill(null); sunk.fill(0); },
    /** The table's own balls where the game has them, turned as they rolled; its cues put away. */
    part(part, M, s) {
      if (part.name === 'cues') { if (!s) return false; M.makeScale(1e-4, 1e-4, 1e-4); return true; }
      if (part.name === 'lamp') { if (!play.narrow) return false; M.makeScale(1e-4, 1e-4, 1e-4); return true; }   // (on a phone held upright the lamp would hide the far end)
      const m = /^ball(\d+)$/.exec(part.name); if (!m) return undefined;
      if (!s) return false;
      const n = Number(m[1]), b = s.balls[n], r0 = rest[n];
      if (b.in) {
        const u = Math.min(1, sunk[n] / 0.3); if (u >= 1) { M.makeScale(1e-4, 1e-4, 1e-4); return true; }
        pos.set(b.x - r0[0], -0.05 * u, b.z - r0[1]); M.compose(pos, spin[n], one); return true;
      }
      pos.set(b.x - r0[0], 0, b.z - r0[1]); M.compose(pos, spin[n], one); return true;
    },
    /** The way from the cue ball to where the pointer is on the cloth, as the game reads it (an angle). */
    pointer(p, camera) {
      const s = play.s; if (!s) return null;
      const r = app.stage.renderer.domElement.getBoundingClientRect();
      ndc.set(((p.x / 255) * innerWidth - r.left) / r.width * 2 - 1, -(((p.y / 255) * innerHeight - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.set(new THREE.Vector3(0, 1, 0), -play.world([0, T + R, 0]).y);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.applyMatrix4(inv.copy(play.M).invert());
      const c = s.balls[0], dx = hit.x - c.x, dz = hit.z - c.z;
      if (dx * dx + dz * dz < 0.0004) return null;
      const [px, py] = toPx(dx, dz); return { px, py };
    },
    event(ev) {
      const at = (x, z, h = 0.1) => [x, T + h, z];
      if (ev.k === 'pot') { sunk[ev.n] = 0; if (ev.n) play.burst(at(POOL.pockets[ev.pocket][0], POOL.pockets[ev.pocket][1], 0.05), ['#ffffff', '#fde047'], 8, 0.4, 0.4); }
      else if (ev.k === 'points') play.float(`+${ev.pts}${ev.run > 1 ? ` · RUN ×${ev.run}` : ''}`, [0, T + 0.35, 0.2], { color: '#fde047', size: 26 });
      else if (ev.k === 'groups') play.float(`You are ${NAME[ev.group]}`, [0, T + 0.4, 0], { color: '#ffffff', size: 28, life: 1.8 });
      else if (ev.k === 'foul') play.float(ev.why === 'scratch' ? 'FOUL: SCRATCH' : ev.why === 'miss' ? 'FOUL: NO BALL HIT' : 'FOUL: WRONG BALL FIRST', [0, T + 0.35, 0.3], { color: '#fca5a5', size: 24, life: 1.5 });
      else if (ev.k === 'turn') play.float(ev.to === 1 ? 'Your shot' : "The computer's shot", [0, T + 0.3, 0.6], { color: ev.to === 1 ? '#4ade80' : '#93c5fd', size: 24, life: 1.2 });
      else if (ev.k === 'spot8') play.float('The 8 on the break: spotted again', [0, T + 0.3, -0.6], { color: '#e2e8f0', size: 22 });
      else if (ev.k === 'time') play.float('Time!', [0, T + 0.35, 0.6], { color: '#fca5a5', size: 26 });
      else if (ev.k === 'over') play.float(ev.walked ? 'You walked away' : ev.win ? 'YOU WIN!' : ev.out ? 'Out of shots' : 'THE COMPUTER WINS', [0, T + 0.45, 0], { color: ev.win ? '#fde047' : '#e2e8f0', size: 36, life: 2 });
    },
    sfx(ev) {
      if (ev.k === 'click') return ['click', Math.min(1, ev.v / 0.05)];
      if (ev.k === 'cushion') return ev.v > 0.012 ? ['bump'] : null;
      return { strike: ['footkick', 0.04 + 0.04 * ev.p], pot: ev.n === 0 ? ['lost'] : ['thump'], points: ['point'], groups: ['bonus'], foul: ['buzzer'], time: ['tick'], over: ev.win ? ['fanfare'] : ['over'] }[ev.k] || null;
    },
    buzz(ev) { return ev.k === 'strike' && ev.who === 1 ? 20 : ev.k === 'pot' && ev.n ? 15 : 0; },
    update(s, dt) {
      if (!s) return;
      // each ball turned by how far it rolled (about the line across its way)
      for (const b of s.balls) {
        const l = last[b.n];
        if (b.in) { sunk[b.n] += dt; last[b.n] = null; continue; }
        if (l) { const dx = b.x - l[0], dz = b.z - l[1], d = Math.sqrt(dx * dx + dz * dz); if (d > 1e-5 && d < 0.3) { ax.set(dz, 0, -dx).normalize(); spin[b.n].premultiply(q.setFromAxisAngle(ax, d / R)); } }
        last[b.n] = [b.x, b.z];
      }
      // the cue: behind the cue ball on the line, drawn back with the power; struck, it follows through and is put down
      const c = s.balls[0], aiming = (s.ph === 'aim' || s.ph === 'cpu') && !c.in;
      follow = s.ph === 'roll' ? follow + dt : 0;
      cue.visible = aiming || (s.ph === 'roll' && follow < 0.35);
      if (cue.visible) {
        const back = aiming ? 0.02 + s.pw * 0.22 : Math.max(0, 0.02 - follow * 0.3);
        cue.position.set(c.x - s.ax * (R + back), T + R + 0.012, c.z - s.az * (R + back));
        cue.rotation.set(0, Math.atan2(-s.ax, -s.az), 0); cue.rotateX(-0.08);   // (the butt raised a little)
      }
      // the guide, for your own shot
      const guide = s.ph === 'aim' && !c.in;
      aimLine.visible = objLine.visible = ghost.visible = guide;
      if (guide) {
        const tr = trace(s);
        setLine(aimLine, [c.x, c.z], tr.at);
        ghost.visible = !!tr.ball; ghost.position.set(tr.at[0], T + 0.002, tr.at[1]);
        if (tr.ball) {
          let ux = tr.ball.x - tr.at[0], uz = tr.ball.z - tr.at[1]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
          setLine(objLine, [tr.ball.x, tr.ball.z], [tr.ball.x + ux * 0.3, tr.ball.z + uz * 0.3]);
          const ok = !s.group ? tr.ball.n !== 8 : left(s, s.group) ? groupOf(tr.ball.n) === s.group : tr.ball.n === 8;
          lineMat.color.set(ok ? '#ffffff' : '#f87171');
        } else { objLine.visible = false; lineMat.color.set('#ffffff'); }
      }
    },
    hud(s) {
      const g = s.group, clock = Math.ceil(s.clock / 60);
      return {
        info: `${g ? `You: ${NAME[g]} ${7 - left(s, g)}/7 · CPU ${7 - left(s, 3 - g)}/7` : 'Open table'}${s.ph === 'aim' ? ` · ⏱ ${clock}s` : ''}`,
        meter: s.ph === 'aim' && s.chg >= 0 ? s.pw : null,
        hint: s.ph === 'aim' && s.shots === 0 ? 'Point to aim the cue · hold the mouse button (or Z) and let go to strike · ◀ ▶ fine aim' : s.ph === 'cpu' ? 'The computer is lining up its shot…' : s.ph === 'aim' && clock <= 5 && s.clock < CLOCK ? 'Hurry: take your shot' : '',
        board: [String(s.score), s.over ? (s.win ? 'YOU WIN' : 'CPU WINS') : s.turn === 1 ? 'YOUR SHOT' : 'CPU SHOT'],
      };
    },
    dispose() {},
  };
}
