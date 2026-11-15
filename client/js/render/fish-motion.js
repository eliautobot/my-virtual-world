// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How the fishing game's fish move (2026-11-14, the product owner: "the fishes fighting, swimming and animations look too
// stiff, too buggy and not normal ... study how fishes move, and apply better movements"). The hooked, leaping and held
// fish is no longer posed by its model's short baked loops (a 6-bone rig whose clip and speed snapped each time the
// fight changed: the tail jumped to another place in its beat) but swims the way fish do:
//
//  • A wave runs down the body from head to tail (its length about the body's, a little longer in stiff fast fish), its
//    sideways reach small at the head and growing to the tail (the head's own small sway is the body's recoil). How the
//    reach grows is the fish's way of swimming — the swimming modes of fish biomechanics (Breder; Lindsey; Videler):
//      thunniform (tunas, mackerels, billfish, mahi): a stiff body, nearly all the movement in the tail's last third;
//      carangiform (jacks, snappers, bass, groupers, trout…): the rear half bends, the front stays fairly still;
//      subcarangiform (pike, gar, catfish, sturgeon, bowfin, sharks): more of the body bends, a longer, lazier wave;
//      rajiform (the ray): a wave runs back along the edges of its wings, up and down;
//      the squid: its mantle pulses (jet) and its arms trail and ripple.
//  • The tail beats faster the harder it swims (Bainbridge: the speed grows with the beat's frequency; big fish beat
//    slower than small ones), and the beat's phase is carried on frame to frame, so a change of pace never jumps.
//  • It turns by bending into a C (curvature from how fast it turns) and banks a little into the turn; it pitches with
//    the way it climbs or dives; when it isn't working hard it beats and glides (burst-and-coast), as fish do.
//  • On the line it faces where it is trying to go — away from the angler, pulling, even while it is reeled in — and
//    comes round to face the boat only when it swims toward it.
//  • A head-shake is a fast side-to-side whip of the head with a roll; a leap carries it up and over in an arc, body
//    flexing; held up, it hangs still, the gills working, and now and then flops hard (a few strong C-bends) and tires.
// The bending is done in the vertex shader on the model's own mesh (one fish, so a plain mesh with uniforms), the swim's
// state on the CPU (FishMotion). Finds (a boot, a tyre…) are drawn rigid.
import * as THREE from 'three';
import { speciesOf } from '/shared/fish-species.js';

// swimming styles: e (sideways reach of the wave at u, 0 the nose … 1 the tail tip, as a fraction of the length, at
// full effort: e0 + e1·u + e2·u² — after Videler's carangiform envelope), lam (the wave's length, body lengths),
// stiff (how little the front bends into a turn), freq (the beat at full effort for a 1 m fish, Hz), kind 0 wave, 1 ray, 2 squid
const STYLES = {
  thunniform: { e: [0.012, -0.05, 0.16], head: 0.24, lam: 1.25, stiff: 0.75, freq: 4.2, kind: 0 },
  carangiform: { e: [0.02, -0.08, 0.18], head: 0.2, lam: 1.0, stiff: 0.45, freq: 4.6, kind: 0 },
  subcarangiform: { e: [0.035, -0.06, 0.15], head: 0.12, lam: 0.85, stiff: 0.3, freq: 3.2, kind: 0 },
  shark: { e: [0.03, -0.07, 0.16], head: 0.22, lam: 1.1, stiff: 0.4, freq: 2.4, kind: 0 },
  ray: { e: [0.02, 0.0, 0.0], head: 0, lam: 1.4, stiff: 0.9, freq: 1.4, kind: 1 },
  squid: { e: [0.0, 0.0, 0.08], head: 0, lam: 0.55, stiff: 0.6, freq: 1.6, kind: 2 },
  rigid: { e: [0, 0, 0], head: 0, lam: 1, stiff: 1, freq: 0, kind: 3 },
};
const STYLE_OF = {
  tuna: 'thunniform', mackerel: 'thunniform', billfish: 'thunniform', mahi: 'thunniform', cobia: 'carangiform',
  pike: 'subcarangiform', gar: 'subcarangiform', catfish: 'subcarangiform', sturgeon: 'subcarangiform', bowfin: 'subcarangiform',
  shark: 'shark', ray: 'ray', squid: 'squid',
};
export function styleOf(what) {
  if (!what || what.find) return STYLES.rigid;
  const sp = speciesOf(what.species);
  return STYLES[STYLE_OF[sp?.body?.shape] || 'carangiform'];
}

const VERT = /* glsl */`
uniform vec4 uFishWave;    // phase (beats), effort (0..1.3: how far the wave reaches), bend (C-bend: curvature × length), flex (up/down arch)
uniform vec4 uFishStyle;   // e0, e1, e2, wave length (body lengths)
uniform vec4 uFishStyle2;  // kind (0 body wave, 1 ray, 2 squid, 3 rigid), the nose's x, the length, the half width
uniform float uFishStiff;  // how little the front bends into a C
uniform float uFishHead;   // the head's length (of the body's): it moves as one piece
vec3 fishPos; vec3 fishNrm;
void fishBend(vec3 p, vec3 n) {
  fishPos = p; fishNrm = n;
  float kind = uFishStyle2.x, L = uFishStyle2.z;
  if (kind > 2.5) return;
  float u = clamp((uFishStyle2.y - p.x) / L, 0.0, 1.0), lam = uFishStyle.w;
  float w = 6.28318 * (uFishWave.x - u / lam), amp = uFishWave.y;
  if (kind > 0.5 && kind < 1.5) {
    // the ray: a wave back along the wings' edges, up and down (more at the tips), the tail trailing
    float e = clamp(abs(p.z) / uFishStyle2.w, 0.0, 1.0), sz = p.z >= 0.0 ? 1.0 : -1.0;
    float dy = L * amp * 0.11 * e * e * sin(w) + L * uFishWave.w * 0.5 * (u - 0.4) * (u - 0.4);
    float dydz = L * amp * 0.11 * 2.0 * e * sin(w) / uFishStyle2.w * sz;
    fishPos.y += dy;
    float a = atan(dydz); fishNrm = vec3(n.x, n.y * cos(a) - n.z * sin(a), n.y * sin(a) + n.z * cos(a));
    // and the whole body turns into a curve a little
    float bz = L * uFishWave.z * 0.5 * max(0.0, u - 0.3) * max(0.0, u - 0.3);
    fishPos.z += bz;
    return;
  }
  float env = uFishStyle.x + uFishStyle.y * u + uFishStyle.z * u * u, denv = uFishStyle.y + 2.0 * uFishStyle.z * u;
  if (kind > 1.5) {
    // the squid (its head and arms forward, the mantle behind): the mantle pulses (its jet), the arms ripple, the body
    // undulates a little along its fins
    float m = smoothstep(0.3, 0.5, u), pulse = 1.0 + m * 0.1 * amp * sin(6.28318 * uFishWave.x);
    fishPos.y *= pulse; fishPos.z *= pulse;
    float arms = 1.0 - smoothstep(0.0, 0.25, u);
    env = 0.025 + arms * 0.05; denv = 0.0;
  }
  // the C-bend: zero at the pivot (about a third back), the front bending less than the back (stiffness). Each cross-
  // section of the body is carried along its bent spine as a rigid slice (turned with the spine's slope there), and the
  // head — everything ahead of uFishHead — moves as one piece: a wide head (the hammerhead's) never shears or warps.
  float uq = max(u, uFishHead), d = uq - 0.33, kb = d < 0.0 ? (1.0 - uFishStiff) : 1.0;
  float side = L * (amp * env * sin(w) + 0.5 * uFishWave.z * kb * d * d * sign(d));
  float dside = amp * (denv * sin(w) - env * 6.28318 / lam * cos(w)) + uFishWave.z * kb * abs(d);   // d(side)/d(u·L)
  float lift = L * 0.5 * uFishWave.w * d * d;
  float dlift = uFishWave.w * d;
  float xq = uFishStyle2.y - uq * L;
  vec3 off = vec3(p.x - xq, p.y, p.z);   // (the point from its slice's centre; ahead of the head's slice, along the head)
  float a = atan(-dside), c = cos(a), s = sin(a);
  off = vec3(c * off.x - s * off.z, off.y, s * off.x + c * off.z);
  fishNrm = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
  float bb = atan(-dlift); c = cos(bb); s = sin(bb);
  off = vec3(c * off.x - s * off.y, s * off.x + c * off.y, off.z);
  fishNrm = vec3(c * fishNrm.x - s * fishNrm.y, s * fishNrm.x + c * fishNrm.y, fishNrm.z);
  // (keep its length: a bent spine's slices come in a little along it)
  fishPos = vec3(xq + L * 0.25 * (dside * dside + dlift * dlift) * d, side, lift) + off;
}
`;

/** The material: the model's painting and its coat (as render/fauna-skinned.js colours it), bent by the swim. */
function material(A, coat) {
  const m = new THREE.MeshStandardMaterial({ map: A.color, roughness: A.man.roughness ?? 0.6, metalness: A.man.metalness ?? 0 });
  const u = m.userData.u = {
    uFishWave: { value: new THREE.Vector4() }, uFishStyle: { value: new THREE.Vector4() }, uFishStyle2: { value: new THREE.Vector4() }, uFishStiff: { value: 0.5 }, uFishHead: { value: 0.18 },
    uMask: { value: A.mask }, uRef: { value: new THREE.Vector3(...['body', 'hair', 'points'].map(k => (A.man.refLumLinear || A.man.refLum)[k])) },
    uBody: { value: coat.body }, uHair: { value: coat.hair }, uLegs: { value: coat.legs },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT + '\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'fishBend(position, normal);\nvec3 objectNormal = normalize(fishNrm);')
      .replace('#include <begin_vertex>', 'vec3 transformed = fishPos;');
    sh.fragmentShader = 'uniform sampler2D uMask;\nuniform vec3 uRef, uBody, uHair, uLegs;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 k = texture2D(uMask, vMapUv).rgb;
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 c = diffuseColor.rgb * clamp(1.0 - k.r - k.g - k.b, 0.0, 1.0) + k.r * uBody * (l / uRef.x) + k.g * uHair * (l / uRef.y) + k.b * uLegs * (l / uRef.z);
        diffuseColor.rgb = min(c, vec3(1.0));
      }`);
  };
  m.customProgramCacheKey = () => 'fish-motion-1';
  return m;
}

const angDiff = (a, b) => { let d = b - a; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

/**
 * One fish's swim: its mesh (the model's nearest detail level) and its state. update() each frame with where the fight
 * (or the leap, or the hold) puts it; the mesh is placed and bent to match.
 */
export class FishMotion {
  /** A: the loaded model (render/fauna-skinned.js loadSkinned), what: { species } or { find }, coat: { body, hair, legs } */
  constructor(A, what, coat, scene, uw = null) {
    this.A = A; this.what = what; this.style = styleOf(what);
    const g = A.lods[0], L0 = A.man.lods[0];
    this.mat = material(A, coat); if (uw) uw(this.mat);
    const st = this.style, u = this.mat.userData.u;
    u.uFishStyle.value.set(st.e[0], st.e[1], st.e[2], st.lam);
    u.uFishStyle2.value.set(st.kind, L0.max[0], L0.max[0] - L0.min[0], Math.max(L0.max[2], -L0.min[2]));
    u.uFishStiff.value = st.stiff;
    u.uFishHead.value = what.species === 'hammerhead' ? 0.3 : st.head;   // (the hammer: a wide, stiff head)
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.name = 'catch-fish'; this.mesh.visible = false;
    scene.add(this.mesh); this.scene = scene;
    this.s = null;   // the swim state, from its first frame
  }
  dispose() { this.scene.remove(this.mesh); this.mat.dispose(); }
  /** Hide it (the state is forgotten: shown again, it starts afresh where it is put). */
  hide() { this.mesh.visible = false; this.s = null; }
  /** The nose's point now (where the line goes in), or null. */
  mouth(out = new THREE.Vector3()) {
    if (!this.mesh.visible) return null;
    const L0 = this.A.man.lods[0];
    // where the mouth is, not the snout's tip: behind a billfish's bill, under a shark's snout (and the hammer), at the
    // front of the jaw for the rest (its height from the model's own: the mouth sits a little below the middle)
    const sh = this.what.find ? null : speciesOf(this.what.species)?.body?.shape, ham = this.what.species === 'hammerhead';
    const M = sh === 'billfish' ? [0.24, -0.04] : ham ? [0.13, -0.32] : sh === 'shark' ? [0.1, -0.3] : sh === 'gar' || sh === 'pike' ? [0.05, -0.05] : sh === 'catfish' ? [0.03, -0.12] : [0.035, -0.12];
    const len = L0.max[0] - L0.min[0], hgt = L0.max[1] - L0.min[1];
    return this.bent(out.set(L0.max[0] - M[0] * len, M[1] * hgt, 0)).applyMatrix4(this.mesh.matrixWorld);
  }
  /** A point of the head (model space), moved as the shader moves the head this frame (its slice at uFishHead). */
  bent(p) {
    const u = this.mat.userData.u, st = this.style; if (st.kind !== 0 && st.kind !== 2) return p;
    const [ph, amp, bend, flex] = u.uFishWave.value.toArray(), L = u.uFishStyle2.value.z, nose = u.uFishStyle2.value.y, uq = u.uFishHead.value;
    const lam = st.lam, w = 2 * Math.PI * (ph - uq / lam), e = st.kind === 2 ? 0.025 + (1 - Math.min(1, uq / 0.25)) * 0.05 : st.e[0] + st.e[1] * uq + st.e[2] * uq * uq, de = st.kind === 2 ? 0 : st.e[1] + 2 * st.e[2] * uq;
    const d = uq - 0.33, kb = d < 0 ? 1 - st.stiff : 1;
    const side = L * (amp * e * Math.sin(w) + 0.5 * bend * kb * d * d * Math.sign(d)), dside = amp * (de * Math.sin(w) - e * 2 * Math.PI / lam * Math.cos(w)) + bend * kb * Math.abs(d);
    const lift = L * 0.5 * flex * d * d, dlift = flex * d, xq = nose - uq * L;
    let ox = p.x - xq, oy = p.y, oz = p.z;
    let a = Math.atan(-dside), c = Math.cos(a), s = Math.sin(a); [ox, oz] = [c * ox - s * oz, s * ox + c * oz];
    a = Math.atan(-dlift); c = Math.cos(a); s = Math.sin(a); [ox, oy] = [c * ox - s * oy, s * ox + c * oy];
    return p.set(xq + L * 0.25 * (dside * dside + dlift * dlift) * d + ox, lift + oy, side + oz);
  }
  /**
   * mode: 'under' (on the line, in the water: p where the fight has it, act { mode (the fight's: run, blitz, dive, shake,
   * rocks, plant, toward, rest), from: { x, z } the angler }), 'air' (leaping: p, yaw, pitch given by the leap, act { u }),
   * 'held' (in the hands: p, yaw, pitch, roll given). len: its length (m). now: seconds.
   */
  update(mode, p, yaw, pitch, roll, len, act, now) {
    const s0 = this.s, dt = s0 ? clamp(now - s0.t, 0, 0.1) : 0;
    const s = this.s ||= { t: now, x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, roll: 0, rate: 0, phase: Math.random(), amp: 0.4, bend: 0, flex: 0, glide: 0, flop: 0, nextFlop: 1 + Math.random() * 2, mode, seed: Math.random() * 6.28, kick: 0, kickIn: 0.4 + Math.random(), kickDir: 1 };
    s.t = now;
    const st = this.style, L = Math.max(0.12, len);
    let effort = 0.5, tYaw = s.yaw, tPitch = 0, tRoll = 0, bendX = 0, flexT = 0, freqK = 1;
    if (mode === 'under') {
      // where it is: following the fight's place closely, with weight (no jolts when the fight changes its mind)
      const k = 26, c = 2 * Math.sqrt(k);
      const ax = k * (p.x - s.x) - c * s.vx, ay = k * (p.y - s.y) - c * s.vy, az = k * (p.z - s.z) - c * s.vz;
      if (s0 && s.mode === 'under') { s.vx += ax * dt; s.vy += ay * dt; s.vz += az * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; }
      else { s.x = p.x; s.y = p.y; s.z = p.z; s.vx = s.vy = s.vz = 0; }
      const m = act?.mode || 'run', sp = Math.hypot(s.vx, s.vz);
      // (2026-11-14, the product owner: "when the fish gets hooked, they need to be more active trying to get away":
      // a hooked fish never rests easy — even its pauses are short, and every second or two it kicks: a hard whip of
      // the body, a lunge to one side, the tail beating flat out)
      const hooked = !!act?.from;
      effort = hooked ? ({ run: 1.1, blitz: 1.25, dive: 1.05, shake: 0.9, rocks: 1.05, plant: 0.65, toward: 0.95, rest: 0.55, jump: 1.1 }[m] ?? 0.9)
        : ({ cruise: 0.55, run: 1, blitz: 1.15, dive: 0.95, shake: 0.7, rocks: 0.95, plant: 0.45, toward: 0.85, rest: 0.25, jump: 1 }[m] ?? 0.7);
      // which way it faces: where it's trying to go. Away from the angler (pulling against the line), turned toward
      // the side it's running to; toward the boat only when it swims to it
      // (free, off the line — the wildlife, a lab: along the way it swims)
      const free = !act?.from, fx = free ? (sp > 0.02 ? s.vx : Math.sin(s.yaw)) : s.x - act.from.x, fz = free ? (sp > 0.02 ? s.vz : Math.cos(s.yaw)) : s.z - act.from.z, fd = Math.hypot(fx, fz) || 1;
      let hx = fx / fd, hz = fz / fd;
      if (m === 'toward') { hx = -hx; hz = -hz; }
      if (!free && sp > 0.05 * L) { const rx = -hz, rz = hx, lat = (s.vx * rx + s.vz * rz) / sp; hx += rx * lat * 1.6; hz += rz * lat * 1.6; }
      if (m === 'rest' && !free) { hx += Math.sin(now * 0.5) * 0.5; }
      tYaw = Math.atan2(hx, hz);
      tPitch = clamp(Math.atan2(s.vy, Math.max(0.3, sp)) * 0.8, -0.6, 0.6) + (m === 'dive' ? -0.45 : act?.up ? 0.15 : 0);
      if (m === 'shake') {   // the head-shake: a fast whip from side to side, rolling with it
        const w = Math.sin(now * Math.PI * 2 * (3.2 + 1.2 / Math.sqrt(L)));
        bendX = 0.55 * w; tRoll = 0.3 * w; freqK = 1.4;
      }
      if (m === 'rocks') bendX = 0.25 * Math.sin(now * 5);
      if (hooked) {
        // a weaving run (fish under strain swim with their head working side to side)
        tYaw += 0.22 * Math.sin(now * 2.6 + s.seed) + 0.12 * Math.sin(now * 4.1 + s.seed * 2);
        tRoll += 0.12 * Math.sin(now * 3.3 + s.seed);
        // the kicks
        s.kickIn -= dt;
        if (s.kickIn <= 0 && s.kick <= 0 && m !== 'shake') { s.kick = 0.35 + Math.random() * 0.3; s.kickDir = Math.random() < 0.5 ? -1 : 1; s.kickIn = (m === 'rest' || m === 'plant' ? 1.0 : 0.7) + Math.random() * 1.3; }
        if (s.kick > 0) {
          s.kick -= dt; const k = Math.min(1, s.kick / 0.15);
          bendX += 0.5 * k * Math.sin(now * Math.PI * 2 * (3.6 + 1 / Math.sqrt(L))); tYaw += 0.55 * s.kickDir * k; tRoll += 0.25 * s.kickDir * k; effort = Math.max(effort, 1.3); freqK = 1.35;
        }
      }
    } else {
      s.x = p.x; s.y = p.y; s.z = p.z; s.vx = s.vy = s.vz = 0;
      tYaw = yaw; tPitch = pitch; tRoll = roll || 0;
      if (mode === 'air') {   // in the air: the body flexing hard, the tail working
        effort = 1.1; freqK = 0.9; bendX = 0.35 * Math.sin(now * Math.PI * 2 * 2.2); flexT = 0.15 * Math.sin(now * Math.PI * 2 * 1.4);
      } else {   // held: still, the gills working; now and then a hard flop (a few strong bends) that tires it a little
        effort = 0.05;
        s.nextFlop -= dt;
        if (s.nextFlop <= 0 && s.flop <= 0) { s.flop = 0.9 + Math.random() * 0.5; s.nextFlop = 2.2 + Math.random() * 3.5; }
        if (act?.flopAt != null && s.flop <= 0 && (now % act.flopAt) < dt) { s.flop = 1.2; s.nextFlop = 9; }   // (a lab: at set times)
        if (s.flop > 0) {
          s.flop -= dt; const f = Math.min(1, s.flop / 0.4);
          bendX = 0.8 * f * Math.sin(now * Math.PI * 2 * 2.6); flexT = 0.6 * f * Math.sin(now * Math.PI * 2 * 1.3 + 1); effort = 0.5 * f;
        } else bendX = 0.05 * Math.sin(now * 2.1);
      }
    }
    // turning: rate-limited, the body bending into it and banking
    const maxRate = mode === 'under' ? (act?.from ? 2.6 : 1.6) + 1.8 / Math.sqrt(L) : 40;
    const want = angDiff(s.yaw, tYaw) * (mode === 'under' ? 3.2 : 30);
    const rate = clamp(want, -maxRate, maxRate);
    s.rate += (rate - s.rate) * Math.min(1, dt * 6);
    s.yaw += s.rate * dt;
    if (mode !== 'under') s.yaw = tYaw;
    s.pitch += (tPitch - s.pitch) * Math.min(1, dt * (mode === 'under' ? 3 : 30));
    const bank = mode === 'under' ? clamp(-s.rate * 0.12, -0.35, 0.35) : 0;
    s.roll += (tRoll + bank - s.roll) * Math.min(1, dt * 8);
    // the wave: its reach eases to the effort; at a gentle pace it beats and glides; the beat's phase carried on
    if (mode === 'under' && effort < 0.5) {
      s.glide -= dt; if (s.glide < -1.6 - Math.random()) s.glide = 0.7 + Math.random() * 0.6;
      if (s.glide > 0) effort *= 0.25;
    }
    s.amp += (effort - s.amp) * Math.min(1, dt * 3);
    const f = st.freq * (0.35 + 0.75 * s.amp) * freqK / Math.pow(L, 0.45);
    s.phase = (s.phase + clamp(f, 0.4, 7) * dt) % 1000;
    const bendTurn = mode === 'under' ? clamp(-s.rate / Math.max(0.6, Math.hypot(s.vx, s.vz) / L + 1) * 0.5, -0.5, 0.5) : 0;
    s.bend += (bendTurn + bendX - s.bend) * Math.min(1, dt * 10);
    s.flex += (flexT - s.flex) * Math.min(1, dt * 8);
    s.mode = mode;
    // to the GPU
    this.mat.userData.u.uFishWave.value.set(s.phase, st.kind === 3 ? 0 : s.amp + 0.15, st.kind === 3 ? 0 : s.bend, st.kind === 3 ? 0 : s.flex);
    const k = this.what.find ? 1 : L;
    _q.setFromEuler(_e.set(-s.pitch, s.yaw, s.roll, 'YXZ')).multiply(_turn);
    this.mesh.position.set(s.x, s.y, s.z); this.mesh.quaternion.copy(_q); this.mesh.scale.setScalar(k);
    this.mesh.visible = true; this.mesh.updateMatrixWorld();
    return s;
  }
}
