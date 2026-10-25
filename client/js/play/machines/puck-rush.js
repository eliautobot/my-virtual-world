// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Puck Rush in the world (the rules: shared/arcade/games/puck-rush.js; the frame: ../machine-play.js): on the Air Hockey
// table itself. Its own puck and both its strikers (its parts: render/furniture-arcade.js 'puck', 'parked0' yours,
// 'parked1' the computer's) moved by the game; a glow trailing a fast puck, sparks where it is hit, the puck sliding into
// the goal; the scoreboard over the far goal showing the score and the clock. You look down the table from your end.
import { HOCKEY } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/puck-rush.js';

const { GOALS, toPx, ZMIN } = sim;
const T = HOCKEY.top, TRAIL = 10;
const clock = n => { const t = Math.max(0, Math.ceil(n / 60)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function create({ THREE, group, play, app }) {
  // the trail: fading discs where the puck was
  const disc = new THREE.CircleGeometry(HOCKEY.puckR, 18); disc.rotateX(-Math.PI / 2);
  const trail = Array.from({ length: TRAIL }, (_, k) => {
    const m = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    m.position.y = T + 0.004; m.scale.setScalar(1 - k / (TRAIL * 1.6)); group.add(m); return m;
  });
  const past = [];
  // a ring of light round your striker, so you see where it is
  const ring = new THREE.Mesh(new THREE.RingGeometry(HOCKEY.strikerR + 0.008, HOCKEY.strikerR + 0.02, 28), new THREE.MeshBasicMaterial({ color: '#f87171', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = T + 0.003; group.add(ring);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), inv = new THREE.Matrix4(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  let T0 = 0, sank = 0;
  return {
    camera: { pos: [0, 1.58, 1.7], at: [0, T, 0.3], fov: 55, fit: 1.5 },
    board: { w: 256, h: 96, ...HOCKEY.sign },
    reset() { past.length = 0; sank = 0; },
    /** The table's own puck and strikers, where the game has them. */
    part(part, M, s) {
      const n = part.name;
      if (n === 'puck') {
        if (!s) return false;
        if (s.ph === 'goal') { const u = Math.min(1, sank / 0.25); M.makeTranslation(s.gx, -0.06 * u, s.gz + Math.sign(s.gz) * 0.05 * u); if (u >= 1) M.scale(new THREE.Vector3(1e-4, 1e-4, 1e-4)); return true; }
        M.makeTranslation(s.px, 0, s.pz); return true;
      }
      if (n === 'parked0') { if (!s) return false; M.makeTranslation(s.sx, 0, s.sz - HOCKEY.park); return true; }
      if (n === 'parked1') { if (!s) return false; M.makeTranslation(s.cx, 0, s.cz + HOCKEY.park); return true; }
      return undefined;
    },
    /** Where the pointer is over your half of the table, as the game reads it. */
    pointer(p, camera) {
      const r = app.stage.renderer.domElement.getBoundingClientRect();
      ndc.set(((p.x / 255) * innerWidth - r.left) / r.width * 2 - 1, -(((p.y / 255) * innerHeight - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.set(new THREE.Vector3(0, 1, 0), -play.world([0, T + 0.02, 0]).y);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.applyMatrix4(inv.copy(play.M).invert());
      if (Math.abs(hit.x) > HOCKEY.hw + 0.3 || hit.z > HOCKEY.hl + 0.4 || hit.z < -HOCKEY.hl) return null;
      const [px, py] = toPx(Math.max(-HOCKEY.hw, Math.min(HOCKEY.hw, hit.x)), Math.max(ZMIN, Math.min(HOCKEY.hl, hit.z)));
      return { px, py };
    },
    event(ev) {
      const at = (x, z, h = 0.03) => [x, T + h, z];
      if (ev.k === 'hit') { if (ev.v > 0.02) play.burst(at(ev.x, ev.z), ev.who === 1 ? ['#fecaca', '#ffffff', '#f87171'] : ['#bfdbfe', '#ffffff', '#60a5fa'], 6 + Math.round(ev.v * 160), 0.5 + ev.v * 8, 0.3); }
      else if (ev.k === 'rail') { if (ev.v > 0.03) play.burst(at(ev.x, ev.z), ['#a5f3fc', '#ffffff'], 6, 0.6, 0.3); }
      else if (ev.k === 'goal') {
        sank = 0;
        const z = ev.who === 1 ? -HOCKEY.hl : HOCKEY.hl;
        play.burst(at(ev.x, z, 0.06), ev.who === 1 ? ['#fde047', '#ffffff', '#f87171', '#22d3ee'] : ['#60a5fa', '#ffffff'], ev.who === 1 ? 46 : 18, 1.2, 1);
        if (ev.who === 1) {
          play.float('GOAL!', [0, T + 0.4, -0.6], { color: '#fde047', size: 40, life: 1.4 });
          play.float(`+${ev.pts}${ev.tags.length ? ' ' + ev.tags.join(' · ') : ''}`, [0, T + 0.25, -0.5], { color: '#ffffff', size: 24, life: 1.5 });
        } else play.float('Goal against', [0, T + 0.3, 0.6], { color: '#93c5fd', size: 26, life: 1.3 });
      } else if (ev.k === 'save') play.float('SAVE +20', [ev.x, T + 0.2, ev.z], { color: '#4ade80', size: 24 });
      else if (ev.k === 'hurry') play.float('10 seconds!', [0, T + 0.4, -0.3], { color: '#fca5a5', size: 26 });
      else if (ev.k === 'over') play.float(ev.win ? (ev.shutout ? 'SHUTOUT WIN!' : 'YOU WIN!') : ev.me === ev.cpu ? 'A DRAW' : 'THE COMPUTER WINS', [0, T + 0.45, -0.3], { color: ev.win ? '#fde047' : '#e2e8f0', size: 36, life: 2 });
    },
    sfx(ev) {
      if (ev.k === 'hit') return ['puckhit', ev.v];
      if (ev.k === 'rail') return ev.v > 0.02 ? ['bump'] : null;
      if (ev.k === 'goal') return ev.who === 1 ? [['goalhorn'], ['bonus']] : [['goalhorn'], ['lost']];
      return { save: ['point'], serve: ['tick'], hurry: ['tick'], buzzer: ['buzzer'], over: ev.win ? ['fanfare'] : ['over'] }[ev.k] || null;
    },
    buzz(ev) { return ev.k === 'goal' ? 60 : ev.k === 'hit' && ev.who === 1 ? Math.min(40, Math.round(ev.v * 500)) : 0; },
    update(s, dt) {
      T0 += dt;
      if (!s) return;
      if (s.ph === 'goal') sank += dt;
      // the trail: the last places of a fast puck
      const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      past.unshift([s.px, s.pz]); if (past.length > TRAIL) past.length = TRAIL;
      trail.forEach((m, k) => {
        const q = past[k];
        m.visible = !!q && s.ph === 'play';
        if (!q) return;
        m.position.x = q[0]; m.position.z = q[1];
        m.material.opacity = Math.max(0, Math.min(0.5, (sp - 0.025) * 8)) * (1 - k / TRAIL);
      });
      ring.position.x = s.sx; ring.position.z = s.sz; ring.material.opacity = 0.45 + 0.2 * Math.sin(T0 * 5);
    },
    hud(s) {
      return {
        info: `You ${s.me} · ${s.cpu} CPU · ⏱ ${clock(s.clock)}`,
        hint: s.t < 300 ? `Move the mouse or a finger over the table to move your striker · first to ${GOALS}` : '',
        board: [`${s.me}  -  ${s.cpu}`, clock(s.clock)],
      };
    },
    dispose() { disc.dispose(); },
  };
}
