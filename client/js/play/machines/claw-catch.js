// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Claw Catch in the world (the rules: shared/arcade/games/claw-catch.js; the frame: ../machine-play.js): inside the Claw
// Machine's own glass (shared/arcade/machines.js CLAW). The game's prizes on its floor (bears, bunnies, dinosaurs and a
// golden star: the machine's own pile put away meanwhile, its part 'prizes'), its gantry riding the rails, the cable
// paying out and the three-pronged claw opening, closing and lifting (the machine's own still claw put away), a faint
// beam down from it and a lit spot on the floor under it so you can judge where it is, the chute in the front corner a
// prize drops into. The
// marquee over the glass shows the score and the try.
import { CLAW } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/claw-catch.js';

const { TRIES, STEER, KINDS, toPx } = sim;
const COLORS = ['#f472b6', '#60a5fa', '#a78bfa', '#fb923c', '#34d399', '#f87171'];

export function create({ THREE, group, play, app }) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0, ...o });
  const chrome = std('#d2d6dc', { roughness: 0.25, metalness: 0.8 });
  const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), m);
  /** A prize by its kind: a teddy, a bunny (long ears), a dinosaur (a back of spikes), the golden star. */
  function prize(kind, k) {
    const g = new THREE.Group();
    if (kind === 3) {
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.022 : 0.05; shape[i ? 'lineTo' : 'moveTo'](Math.sin(a) * r, Math.cos(a) * r); }
      const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }), std('#facc15', { emissive: '#b45309', emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 }));
      star.position.set(0, 0.055, -0.01); g.add(star);
      return g;
    }
    const col = std(kind === 2 ? '#22c55e' : COLORS[k % COLORS.length]), pale = std('#f5e6d3');
    const body = sph(0.04, col); body.scale.set(1, 1.05, 0.9); body.position.y = 0.04;
    const head = sph(0.032, col); head.position.set(0, kind === 2 ? 0.075 : 0.095, kind === 2 ? 0.03 : 0);
    const snout = sph(0.014, kind === 2 ? col : pale); snout.position.set(0, head.position.y - 0.006, head.position.z + 0.028);
    const eyes = [-1, 1].map(s => { const e = sph(0.005, std('#111111')); e.position.set(s * 0.013, head.position.y + 0.008, head.position.z + 0.027); return e; });
    g.add(body, head, snout, ...eyes);
    if (kind === 0) for (const s of [-1, 1]) { const e = sph(0.012, col); e.position.set(s * 0.026, 0.122, 0); g.add(e); }
    if (kind === 1) for (const s of [-1, 1]) { const e = sph(0.011, col); e.scale.set(1, 3, 0.7); e.position.set(s * 0.013, 0.15, 0); g.add(e); }
    if (kind === 2) for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.02, 6), std('#facc15')); sp.position.set(0, 0.085 - i * 0.012, -0.012 - i * 0.016); sp.rotation.x = -0.5; g.add(sp); }
    return g;
  }
  // the gantry: a bar across (moving to and fro), a carriage on it, the cable and the claw
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.02, 0.04), chrome); group.add(rail);
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.07), std('#1f2937', { metalness: 0.4 })); group.add(carriage);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 6), std('#111827')); group.add(cable);
  const claw = new THREE.Group(), hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 14), chrome);
  claw.add(hub);
  const prongs = [0, 1, 2].map(k => {
    const pivot = new THREE.Group(); pivot.rotation.y = (k / 3) * Math.PI * 2;
    const arm = new THREE.Group(); arm.position.set(0, -0.02, 0.03); pivot.add(arm);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6), chrome); upper.position.y = -0.035; arm.add(upper);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.04, 6), chrome); tip.position.set(0, -0.075, -0.012); tip.rotation.x = 0.7; arm.add(tip);
    claw.add(pivot); return arm;
  });
  group.add(claw);
  // the lit spot under the claw, the chute
  const spot = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 24), new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }));
  spot.rotation.x = -Math.PI / 2; group.add(spot);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.03, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.2, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
  group.add(beam);
  const [cx, cz] = CLAW.chute, chute = new THREE.Group();
  const walls = new THREE.MeshStandardMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.35, roughness: 0.1 });
  for (const [x, z, w, d] of [[0, CLAW.chuteR, CLAW.chuteR * 2, 0.006], [0, -CLAW.chuteR, CLAW.chuteR * 2, 0.006], [CLAW.chuteR, 0, 0.006, CLAW.chuteR * 2], [-CLAW.chuteR, 0, 0.006, CLAW.chuteR * 2]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), walls); m.position.set(x, 0.06, z); chute.add(m); }
  const lip = new THREE.Mesh(new THREE.TorusGeometry(CLAW.chuteR * 1.35, 0.005, 6, 4), new THREE.MeshBasicMaterial({ color: '#f472b6', toneMapped: false })); lip.rotation.set(Math.PI / 2, 0, Math.PI / 4); lip.position.y = 0.12; chute.add(lip);
  chute.position.set(cx, CLAW.floor, cz); group.add(chute);
  let meshes = [], T = 0, falls = [];
  const setPrizes = s => {
    for (const m of meshes) group.remove(m);
    meshes = s.prizes.map((p, i) => { const m = prize(p.kind, i); m.rotation.y = (p.yaw / 1024) * Math.PI * 2; group.add(m); return m; });
  };
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), inv = new THREE.Matrix4(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  return {
    camera: { pos: [0, 1.66, 1.25], at: [0, 1.28, -0.1], fov: 56, fit: 1.0 },
    board: { w: 320, h: 52, ...CLAW.sign },
    reset(s) { falls = []; if (s) setPrizes(s); },
    /** The machine's own pile and its still claw are put away while the game's are out. */
    part(part, M) { const k = part.info?.kind; if (k === 'prizes' || k === 'claw') { M.makeScale(1e-4, 1e-4, 1e-4); return true; } return undefined; },
    /** Where the pointer is over the prize floor, as the game reads it. */
    pointer(p, camera) {
      const r = app.stage.renderer.domElement.getBoundingClientRect();
      ndc.set(((p.x / 255) * innerWidth - r.left) / r.width * 2 - 1, -(((p.y / 255) * innerHeight - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const y = play.world([0, CLAW.floor + 0.06, 0]).y;
      plane.set(new THREE.Vector3(0, 1, 0), -y);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.applyMatrix4(inv.copy(play.M).invert());
      if (Math.abs(hit.x) > CLAW.reach + 0.05 || Math.abs(hit.z) > CLAW.reach + 0.05) return null;
      const [px, py] = toPx(Math.max(-CLAW.reach, Math.min(CLAW.reach, hit.x)), Math.max(-CLAW.reach, Math.min(CLAW.reach, hit.z)));
      return { px, py };
    },
    event(ev, s) {
      if (ev.k === 'grab') play.float(KINDS[ev.kind].id === 'star' ? 'GOT THE STAR!' : 'Got it!', [0, 1.5, 0], { color: '#a5f3fc', size: 24 });
      else if (ev.k === 'miss') play.float('Missed', [0, 1.5, 0], { color: '#cbd5e1', size: 22 });
      else if (ev.k === 'slip') { play.float('Slipped!', [ev.x, 1.4, ev.z], { color: '#fca5a5', size: 26 }); }
      else if (ev.k === 'win') {
        const at = [cx, CLAW.floor + 0.12, cz];
        play.burst(at, ev.kind === 3 ? ['#fde047', '#ffffff', '#f59e0b'] : ['#f472b6', '#ffffff', '#a5f3fc'], ev.kind === 3 ? 44 : 22, 0.9, 1);
        play.float(`+${ev.pts} ${KINDS[ev.kind].id.toUpperCase()}!`, [cx, CLAW.floor + 0.3, cz], { color: ev.kind === 3 ? '#fde047' : '#ffffff', size: ev.kind === 3 ? 34 : 26, life: 1.4 });
      } else if (ev.k === 'master') play.float('CLAW MASTER +500', [0, 1.6, 0], { color: '#fde047', size: 34, life: 1.8 });
      else if (ev.k === 'hurry') play.float('5 seconds!', [0, 1.55, 0.1], { color: '#fca5a5', size: 24 });
    },
    sfx(ev) { return { drop: ['clawmotor'], grab: ['catch'], miss: ['lost'], slip: ['bump'], win: ev.kind === 3 ? ['fanfare'] : ['bonus'], master: ['fanfare'], ready: ['tick'], hurry: ['tick'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'win' ? 50 : ev.k === 'grab' ? 20 : 0; },
    update(s, dt) {
      T += dt;
      if (!s) return;
      if (meshes.length !== s.prizes.length) setPrizes(s);
      const y = CLAW.top - (CLAW.top - (CLAW.low + 0.1)) * s.drop;
      rail.position.set(0, CLAW.top + 0.01, s.z);
      carriage.position.set(s.x, CLAW.top - 0.01, s.z);
      claw.position.set(s.x, y, s.z);
      cable.position.set(s.x, (CLAW.top + y) / 2, s.z); cable.scale.y = Math.max(0.01, CLAW.top - y);
      claw.rotation.y = s.moving ? Math.sin(T * 9) * 0.05 : 0;
      for (const a of prongs) a.rotation.x = -0.15 - 0.55 * s.open;
      spot.visible = beam.visible = s.ph === 'steer'; spot.position.set(s.x, CLAW.floor + 0.004, s.z);
      const top = y - 0.09; beam.position.set(s.x, (top + CLAW.floor) / 2, s.z); beam.scale.y = Math.max(0.01, top - CLAW.floor);
      spot.material.opacity = 0.45 + 0.3 * Math.sin(T * 6);
      s.prizes.forEach((p, i) => {
        const m = meshes[i]; if (!m) return;
        if (p.won) {
          // into the chute: down and out of sight
          if (m.userData.fall === undefined) m.userData.fall = 0;
          m.userData.fall += dt; m.position.set(cx, CLAW.floor + 0.08 - m.userData.fall * 0.9, cz); m.visible = m.userData.fall < 0.4;
        } else if (s.hold === p.id) m.position.set(s.x, y - 0.13, s.z);
        else m.position.set(p.x, CLAW.floor, p.z);
        // (the golden star stands facing you and turns a little, so it shines)
        if (p.kind === 3 && !p.won) m.rotation.y = Math.sin(T * 1.3 + i) * 0.7;
      });
    },
    hud(s) {
      const left = s.ph === 'steer' ? Math.max(0, Math.ceil((STEER - s.pt) / 60)) : null;
      return {
        info: `Try ${Math.min(TRIES, s.try + 1)} of ${TRIES}${left !== null ? ` · ⏱ ${left}s` : ''}`,
        hint: s.ph === 'steer' && s.try === 0 && s.pt < 600 ? 'Steer: ◀ ▶ ▲ ▼ or the mouse over the glass · Z (or a click) drops the claw' : '',
        board: [`${s.score}`, `TRY ${Math.min(TRIES, s.try + 1)}/${TRIES}`],
      };
    },
    dispose() {},
  };
}
