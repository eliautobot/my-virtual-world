// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Strike Lane in the world (the rules: shared/arcade/games/strike-lane.js; the frame: ../machine-play.js): on the Mini
// Bowling Lane itself. Its own ten pins (its parts: render/furniture-arcade.js 'pin0' … 'pin9') tumbling over the way they
// were knocked and sliding, cleared by a sweep bar, a fresh rack dropped in; the ball rolling from where you stand, into
// the gutter if it strays; a faint line where you aim; the camera going down the lane with the ball and back; the frame
// and the score on the screen over the pins.
import { BOWL, bowlPins } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/strike-lane.js';

const { FRAMES, toPx, total } = sim;
const T = BOWL.top, BR = BOWL.ballR, START = 2.05, SPOTS = bowlPins();
const AIM_CAM = { pos: [0, 1.45, 4.0], at: [0, 0.3, -1.4] };

export function create({ THREE, group, play, app }) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BR, 24, 16), new THREE.MeshStandardMaterial({ color: '#6d28d9', roughness: 0.25, metalness: 0.2 }));
  for (const [x, y] of [[-0.018, 0.03], [0.018, 0.03], [0, -0.01]]) { const h = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), new THREE.MeshBasicMaterial({ color: '#111' })); h.position.set(x, y, BR * 0.985); h.lookAt(x * 3, y * 3, BR * 3); ball.add(h); }
  group.add(ball);
  const lineMat = new THREE.LineBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.5, toneMapped: false });
  const aim = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)), lineMat); aim.frustumCulled = false; group.add(aim);
  const sweep = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.4 })); group.add(sweep);
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), lay = new THREE.Quaternion(), id = new THREE.Quaternion();
  const fall = SPOTS.map(() => ({ t: -1, dx: 0, dz: -1 }));
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), inv = new THREE.Matrix4(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  const cam = { pos: new THREE.Vector3(...AIM_CAM.pos), at: new THREE.Vector3(...AIM_CAM.at) }, want = { pos: new THREE.Vector3(), at: new THREE.Vector3() };
  let lx = 0, lz = START, drop = 0, flash = '', flashT = 0, lastPin = 0, wasAll = true;
  return {
    camera: { pos: AIM_CAM.pos, at: AIM_CAM.at, fov: 52, fit: 1.2 },
    board: { w: 300, h: 96, ...BOWL.screen },
    reset() { fall.forEach(f => { f.t = -1; }); drop = 0; },
    /** The camera: down the lane with the ball, then back to where you stand. */
    cameraNow(s, dt) {
      if (!s) return null;
      const B = s.ball, rolling = s.ph === 'roll' || (s.ph === 'sweep' && s.pt < 30);
      if (rolling) { const z = Math.max(-0.7, (B.live ? B.z : -3) + 2.3); want.pos.set(0, 1.12, z); want.at.set(0, 0.2, Math.max(-3.0, z - 2.4)); }
      else { want.pos.set(...AIM_CAM.pos); want.at.set(...AIM_CAM.at); }
      const k = 1 - Math.exp(-dt * (rolling ? 4 : 2.5)); cam.pos.lerp(want.pos, k); cam.at.lerp(want.at, k);
      return { pos: [cam.pos.x, cam.pos.y, cam.pos.z], at: [cam.at.x, cam.at.y, cam.at.z] };
    },
    /** The lane's own pins: standing, tumbling over the way they were knocked, sliding, gone into the pit; a new rack dropped in. */
    part(part, M, s) {
      const m = /^pin(\d)$/.exec(part.name); if (!m) return undefined;
      if (!s) return false;
      const k = Number(m[1]), p = s.pins[k], f = fall[k], [x0, z0] = SPOTS[k];
      if (p.out) { M.makeScale(1e-4, 1e-4, 1e-4); return true; }
      if (p.up) { if (drop > 0) { M.makeTranslation(0, drop, 0); return true; } return false; }
      const u = f.t < 0 ? 0 : Math.min(1, f.t / 0.3), e = u * u * (3 - 2 * u);
      dir.set(f.dx, 0, f.dz); lay.setFromUnitVectors(Y, dir); q.copy(id).slerp(lay, e);
      pos.set(p.x - x0, 0.035 * e, p.z - z0); M.compose(pos, q, one); return true;
    },
    /** Where across the lane the pointer is, as the game reads it. */
    pointer(p, camera) {
      const r = app.stage.renderer.domElement.getBoundingClientRect();
      ndc.set(((p.x / 255) * innerWidth - r.left) / r.width * 2 - 1, -(((p.y / 255) * innerHeight - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.set(new THREE.Vector3(0, 1, 0), -play.world([0, T, 0]).y);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.applyMatrix4(inv.copy(play.M).invert());
      if (hit.z > START || hit.z < BOWL.deck - 0.3 || Math.abs(hit.x) > 0.8) return null;
      // (a point on the lane: the line from where you stand through it, carried on to the pins)
      const s = play.s, x0 = s ? s.x0 : 0, t = (BOWL.head - START) / Math.min(-0.05, hit.z - START), x = x0 + (hit.x - x0) * t;
      return { px: toPx(Math.max(-BOWL.hw, Math.min(BOWL.hw, x))), py: 128 };
    },
    event(ev) {
      if (ev.k === 'count') {
        flash = ev.kind === 'strike' ? 'STRIKE!' : ev.kind === 'spare' ? 'SPARE!' : ev.down === 0 ? 'MISS' : String(ev.down); flashT = 1.8;
        const at = [0, T + 0.7, BOWL.head + 0.2];
        if (ev.kind === 'strike') { play.float('STRIKE!', at, { color: '#fde047', size: 44, life: 1.8 }); play.burst([0, T + 0.25, BOWL.head - 0.1], ['#fde047', '#ffffff', '#f472b6'], 40, 1.2, 1); }
        else if (ev.kind === 'spare') play.float('SPARE!', at, { color: '#4ade80', size: 40, life: 1.6 });
        else play.float(ev.down === 0 ? 'Nothing down' : `${ev.down} down`, at, { color: '#ffffff', size: 28, life: 1.3 });
      } else if (ev.k === 'gutter') play.float('GUTTER', [0, T + 0.3, 0], { color: '#fca5a5', size: 30 });
      else if (ev.k === 'over') play.float(`Final score ${ev.score}`, [0, T + 0.7, BOWL.head + 0.4], { color: '#fde047', size: 36, life: 2 });
    },
    sfx(ev) {
      if (ev.k === 'pin') { const now = performance.now(); if (now - lastPin < 45) return null; lastPin = now; return ['click', Math.min(1, ev.v / 0.03)]; }
      if (ev.k === 'count') return ev.kind === 'strike' ? [['crash'], ['fanfare']] : ev.kind === 'spare' ? ['bonus'] : ev.down ? ['point'] : ['lost'];
      return { roll: ['thrust'], gutter: ['lost'], ready: ['tick'], over: ['over'] }[ev.k] || null;
    },
    buzz(ev) { return ev.k === 'count' && ev.kind === 'strike' ? 60 : ev.k === 'pin' ? 6 : 0; },
    update(s, dt) {
      if (!s) return;
      flashT = Math.max(0, flashT - dt);
      // pins: a fall begins when one is seen down (the way it was going)
      s.pins.forEach((p, k) => {
        const f = fall[k];
        if (p.up) f.t = -1;
        else if (f.t < 0) { const l = Math.hypot(p.vx, p.vz); f.dx = l > 1e-6 ? p.vx / l : 0; f.dz = l > 1e-6 ? p.vz / l : -1; f.t = 0; }
        else f.t += dt;
      });
      // a fresh rack: dropped in from above during the sweep
      const all = s.pins.every(p => p.up);
      if (s.ph === 'sweep' && all && !wasAll) drop = 0.4;
      wasAll = all;
      if (drop > 0) drop = Math.max(0, drop - dt * 0.6);
      // the sweep bar: down, back over the deck, up
      const u = s.ph === 'sweep' ? s.pt / 45 : 1;
      sweep.visible = s.ph === 'sweep';
      sweep.position.set(0, u < 0.25 ? 0.6 - (u / 0.25) * 0.47 : u < 0.6 ? 0.13 : 0.13 + ((u - 0.6) / 0.4) * 0.5, u < 0.25 ? BOWL.head + 0.12 : u < 0.6 ? BOWL.head + 0.12 - ((u - 0.25) / 0.35) * 0.4 : BOWL.head - 0.28);
      // the ball: in your hand at the foul line, rolling, turning as it rolls, low in the gutter
      const B = s.ball, inHand = s.ph === 'aim';
      ball.visible = inHand || B.live;
      const bx = inHand ? s.x0 : B.x, bz = inHand ? START : B.z;
      const dx = bx - lx, dz = bz - lz, d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 0.5) { ax.set(dz, 0, -dx).normalize(); ball.quaternion.premultiply(q.setFromAxisAngle(ax, d / BR)); }
      lx = bx; lz = bz;
      ball.position.set(bx, T + BR - (B.gutter && !inHand ? 0.045 : 0), bz);
      // the aim: from where you stand to where you point, on to the pins
      aim.visible = inHand;
      if (inHand) { const pp = aim.geometry.attributes.position; pp.setXYZ(0, s.x0, T + 0.003, START - 0.1); pp.setXYZ(1, s.tx, T + 0.003, BOWL.head + 0.15); pp.needsUpdate = true; lineMat.opacity = 0.35 + 0.2 * Math.sin(performance.now() / 200); }
    },
    hud(s) {
      return {
        info: `Frame ${Math.min(FRAMES, s.frame)} of ${FRAMES} · Ball ${s.r + 1} · Score ${total(s)}`,
        meter: s.ph === 'aim' && s.chg >= 0 ? s.pw : null,
        hint: s.ph === 'aim' && s.frame === 1 && s.r === 0 ? 'Point where to roll · ◀ ▶ where you stand · hold the mouse button (or Z), let go to roll' : '',
        board: flashT > 0 ? [flash, `SCORE ${total(s)}`] : [`FRAME ${Math.min(FRAMES, s.frame)}`, `SCORE ${total(s)}`],
      };
    },
    dispose() {},
  };
}
