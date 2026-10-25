// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hoop Fever in the world (the rules: shared/arcade/games/hoop-fever.js; the frame: ../machine-play.js): the Basketball
// Hoops machine's own rim, backboard and nets (shared/arcade/machines.js HOOPS). From where its player stands: a ball in
// hand, raised as the shot charges; let go and it flies in its real arc, spinning, off the rim or the board and through
// the net; the rim slides along its track in bonus time (its part: render/furniture-arcade.js 'hoop'). The machine's red
// LED board shows the score and the time.
import { HOOPS } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/hoop-fever.js';

const { BONUS, powerOf, hoopX, toItem } = sim;
const R = HOOPS.ballR;

/** A basketball's skin: orange, its black seams. */
function skin(THREE) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#c2410c'); g.addColorStop(0.5, '#f97316'); g.addColorStop(1, '#c2410c');
  x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  x.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 900; i++) x.fillRect((i * 97) % 256, (i * 57) % 128, 1, 1);
  x.strokeStyle = '#1c1917'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 64); x.lineTo(256, 64); x.stroke();
  for (const cx of [64, 192]) { x.beginPath(); x.moveTo(cx, 0); x.lineTo(cx, 128); x.stroke(); }
  for (const cx of [0, 128, 256]) { x.beginPath(); x.ellipse(cx, 64, 34, 64, 0, 0, Math.PI * 2); x.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function create({ THREE, group, play }) {
  const mat = new THREE.MeshStandardMaterial({ map: skin(THREE), roughness: 0.75, metalness: 0 });
  const geo = new THREE.SphereGeometry(R, 22, 16);
  const pool = [], live = new Map();
  const ballFor = id => { let m = live.get(id); if (!m) { m = pool.pop() || new THREE.Mesh(geo, mat); group.add(m); live.set(id, m); m.userData.spin = Math.random() * 6; } return m; };
  const hand = new THREE.Mesh(geo, mat); group.add(hand);
  // the aim: a faint line on the ramp toward the hoop
  const aimMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false });
  const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 1), aimMat); group.add(aim);
  let T = 0;
  return {
    camera: { pos: [0, 1.78, 2.55], at: [0, 1.74, -0.9], fov: 55, fit: 1.25 },
    board: { w: 320, h: 80, x0: -0.5, x1: 0.5, y0: 2.3, y1: 2.56, z: -1.292 },
    reset() { for (const [, m] of live) { m.visible = false; pool.push(m); } live.clear(); },
    /** The rim slides along its track in bonus time. */
    part(part, M, s) { if (part.info?.kind !== 'hoop') return undefined; if (!s) return false; M.makeTranslation(hoopX(s), 0, 0); return true; },
    event(ev) {
      const rim = [HOOPS.rim[0], HOOPS.rim[1] - 0.1, HOOPS.rim[2]];
      if (ev.k === 'score') {
        play.burst(rim, ev.fire ? ['#fb923c', '#fde047', '#ef4444'] : ['#ffffff', '#fde68a'], ev.fire ? 30 : 14, 0.9, 0.6);
        play.float(`+${ev.pts}${ev.swish ? ' SWISH!' : ev.bank ? ' BANK!' : ''}`, rim, { color: ev.fire ? '#fb923c' : ev.swish ? '#fde047' : '#ffffff', size: ev.swish || ev.fire ? 32 : 26 });
      } else if (ev.k === 'fire') play.float('ON FIRE!', [0, 2.0, -1.0], { color: '#fb923c', size: 40, life: 1.6 });
      else if (ev.k === 'cold' && ev.n >= 3) play.float('Cooled off', [0, 2.0, -1.0], { color: '#93c5fd', size: 26 });
      else if (ev.k === 'bonus') play.float('BONUS TIME!', [0, 2.05, -1.0], { color: '#f0abfc', size: 40, life: 1.8 });
      else if (ev.k === 'rim') play.burst(rim, ['#fdba74'], 5, 0.4, 0.3);
    },
    sfx(ev) { return { shoot: ['hoopshot', ev.power], rim: ['rim'], board: ['bump'], net: ['bump'], score: ev.swish ? [['swish'], ev.fire ? ['bonus'] : null].filter(Boolean) : ['swish'], fire: ['power'], cold: ['lost'], bonus: ['fanfare'], count: ['tick'], buzzer: ['buzzer'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'rim' ? 15 : ev.k === 'score' ? 30 : 0; },
    update(s, dt) {
      T += dt;
      const seen = new Set();
      for (const b of s?.balls || []) {
        const m = ballFor(b.id), p = toItem(b.x, b.y, b.z);
        m.position.set(p[0], p[1], p[2]); m.visible = true;
        m.userData.spin += dt * 9; m.rotation.set(-m.userData.spin, 0.4, 0);
        seen.add(b.id);
      }
      for (const [id, m] of live) if (!seen.has(id)) { m.visible = false; pool.push(m); live.delete(id); }
      // the ball in hand: raised as the shot charges
      const ready = !!s && s.left > 0 && s.reload === 0;
      hand.visible = ready; aim.visible = ready;
      if (ready) {
        const pw = s.charge >= 0 ? powerOf(s.charge) : 0, p = toItem(0, -0.03 + pw * 0.1, 0.02);
        hand.position.set(p[0], p[1], p[2]); hand.rotation.set(T, 0.4, 0);
        // (on the ramp, which rises 0.35 over its 2.4 m toward the hoop: render/furniture-arcade.js hoop_shot)
        const a = (s.aim / 1024) * Math.PI * 2, len = 2.2, g = toItem(Math.sin(a) * len * 0.5, 0, len * 0.5), slope = Math.atan2(0.35, 2.4);
        g[1] = 0.78 + (1.25 - g[2]) * Math.tan(slope) + 0.025;
        aim.position.set(g[0], g[1], g[2]); aim.scale.y = len;
        aim.rotation.set(slope - Math.PI / 2, 0, -a);
        aimMat.opacity = s.charge >= 0 ? 0.25 + 0.5 * pw : 0.3 + 0.1 * Math.sin(T * 5);
      }
    },
    hud(s) {
      const secs = Math.ceil(s.left / 60);
      return {
        info: `⏱ ${secs}s${s.left <= BONUS && s.left > 0 ? ' · BONUS' : ''}${s.fire ? ' · 🔥' : ''}`,
        meter: s.left > 0 && s.reload === 0 ? (s.charge >= 0 ? powerOf(s.charge) : 0) : null,
        hint: s.shots === 0 && s.charge < 0 ? 'Aim with ◀ ▶ or the mouse, hold Z (or the mouse button), let go to shoot' : s.fire ? 'ON FIRE: double points' : s.streak >= 2 ? `${s.streak} in a row` : '',
        board: [String(s.score), `TIME ${secs}`],
      };
    },
    dispose() { geo.dispose(); mat.map?.dispose(); mat.dispose(); },
  };
}
