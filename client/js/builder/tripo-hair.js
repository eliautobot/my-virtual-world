// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as T from "three";
import { Sculpture } from "./hair-styles.js";
import { groomScalp, tintFade } from "./hair-roots.js";
import { tripoHair } from "./tripo-hair-catalog.js";
import { androidHelmet } from "./tripo-helmet.js";

const pi = Math.PI,
  tau = 2 * pi;
const mix = T.MathUtils.lerp;
const smooth = (x, low, high) => T.MathUtils.smoothstep(x, low, high);
const clamp = T.MathUtils.clamp;
const vec = (x, y, z) => new T.Vector3(x, y, z);
const up = vec(0, 1, 0),
  forward = vec(0, 0, 1);
const radial = (a) => vec(Math.sin(a), 0, Math.cos(a));
const around = (a) => vec(Math.cos(a), 0, -Math.sin(a));
const noise = (i) => Math.sin(15.39 * i + 3.15 * Math.sin(1.534 * i));
const bell = (x) => Math.exp(-x * x);
const path = (count, fn) =>
  Array.from({ length: count + 1 }, (_, i) => fn(i / count));
const geometries = new Map();

function groom(gender, style) {
  const scalp = groomScalp(gender);
  const model = new Sculpture();
  const streak = new Sculpture();
  const top = scalp.top * 1000;
  const female = gender === "female";
  const cy = female ? 932 : 942;
  const part = style.part ?? 0.3;
  const channels = style.channels ?? 7;
  const bulk = style.volume ?? 5;
  const loose = ["waves", "bob", "rollBob"].includes(style.cut);
  const curls = ["curl", "halo"].includes(style.cut);

  // Form the cap over the actual foundation. A raised midsection below the
  // crown carries the highlight, then feathers into the measured hairline.
  function hem(a) {
    return 1000 * scalp.hairline(a);
  }
  // The frontal border belongs to the haircut. It follows the underside of
  // long sweeping bangs instead of leaving a band of forehead between the
  // foundation's generic hairline and the tips at the temples.
  const pairedFringe =
    loose ||
    style.cut === "pony" ||
    style.cut === "curtain" ||
    (style.cut === "sweep" && !style.sleek) ||
    style.roll;
  function frontHem(a) {
    if (!pairedFringe) return hem(a);
    const angle = Math.atan2(Math.sin(a), Math.cos(a));
    const s = part >= 0 ? -1 : 1,
      big = angle * s;
    const split = style.cut === "curtain" ? 0 : -0.21 - 0.38 * Math.abs(part);
    const arc =
      big >= split
        ? smooth(big - split, 0.025, 1.23)
        : smooth(split - big, 0.03, 0.96);
    const drop =
      (big >= split || style.cut === "curtain" ? 29 : 22) +
      (style.fringe ?? 5) * 0.42;
    const target = (female ? 925.5 : 940) + 29 - drop * arc;
    return Math.min(
      hem(a),
      mix(hem(a), target, 1 - smooth(Math.abs(angle), 1.03, 1.43)),
    );
  }
  function scalpPoint(a, y, loft = 0) {
    const q = scalp.sample(a, clamp(y / 1000, 0.847, scalp.top));
    return q.p.multiplyScalar(1000).addScaledVector(q.n, loft);
  }
  function capRise(a, u) {
    const rim = 1 - smooth(u, 0.84, 1);
    const frontal = 0.5 + 0.5 * Math.cos(a);
    const crest = style.crest ?? (loose ? 2 : 0.8);
    const texture = style.cut === "buzz" ? 0.11 : curls ? 0.36 : 0.57;
    const twist = a + 0.84 * part * (1 - u) + 0.085 * Math.sin(2 * a + 3 * u);
    const ribs =
      texture *
      (Math.cos(23 * twist - 0.8 * u) + 0.25 * Math.cos(53 * twist + 3 * u)) *
      smooth(u, 0.04, 0.25);
    return mix(
      1.15,
      bulk + crest * frontal * bell((u - 0.51) / 0.5) + ribs,
      rim,
    );
  }
  function skull(a, u, add = 0) {
    const line = frontHem(a),
      c = Math.cos(0.5 * pi * Math.min(1, u));
    return scalpPoint(
      a,
      mix(line, top, c) - 70 * Math.max(0, u - 1),
      capRise(a, u) + add,
    );
  }
  function volumeCap() {
    model.shell(
      32,
      120,
      (t, v) => {
        const a = tau * v,
          u = mix(0.004, 0.999, t);
        const shade =
          0.965 +
          0.019 * Math.cos(41 * a - 4 * u + part) * smooth(u, 0.08, 0.34);
        return [skull(a, u), shade];
      },
      [skull(0, 0), vec(0, 935, -6)],
      true,
    );
  }
  // These side parts are one swept surface from the crown to the hairline
  // and hem. A combed ridge changes the surface relief itself, including at
  // the temples where a separate fringe panel would expose its underside.
  function sweptScalp() {
    const waves = style.cut === "waves", bob = style.cut === "bob";
    const falls = waves || bob;
    const tilt = part * 0.74;
    const crownZ = scalp.sample(0, scalp.top).p.z * 1000;
    function surface(a, t) {
      const signed = Math.atan2(Math.sin(a), Math.cos(a));
      const angle = Math.abs(signed), f = Math.cos(a);
      const lowSide = signed < part;
      const sweep = smooth(Math.abs(signed - part), 0.09, lowSide ? 1.19 : 1.04);
      const lifted = style.cut === "braid";
      const brow = (lifted ? 966 : 957.8) - (style.fringe ?? 3) * 0.40
        - (lowSide ? 22 : 19) * sweep;
      const scallop = (waves ? 2.2 : lifted ? 0.6 : 1.6) * Math.cos(10 * a - 0.65) * smooth(sweep, 0, 0.23);
      const hairline = Math.min(hem(a) - 0.7, mix(brow + scallop, hem(a), smooth(angle, 0.84, 1.35)));
      const fall = falls ? smooth(angle, lowSide ? 0.66 : 0.78, lowSide ? 1.12 : 1.24) : 0;
      const tip = (style.hem ?? hairline) + (style.angleHem ?? 3) * f
        + (style.ends ?? 0) * (0.55 * Math.cos(15 * a + 0.5) + 0.45 * Math.cos(10 * a));
      const end = mix(hairline, tip, fall);
      const y = mix(end, top, Math.cos(0.5 * pi * t));
      // Freeze the guide radius below the cranium. Blend over a full temple
      // instead of changing direction abruptly at ear height.
      const turn = 941 + 3 * f;
      const rise = y - turn;
      const guide = falls ? mix(y, turn + 0.5 * (rise + Math.hypot(rise, 7)), fall) : y;
      const q = scalp.sample(a, Math.min(scalp.top, guide * 0.001));
      const base = q.p.multiplyScalar(1000);
      const dir = vec(base.x, base.y - cy, base.z - crownZ).normalize();
      const across = dir.x * Math.cos(tilt) - dir.y * Math.sin(tilt);
      const hanging = smooth(951 - y, 0, 39) * fall;
      const crown = Math.max(0, dir.y);
      const dx = dir.x - 1.6 * Math.sin(tilt) * crown;
      const dz = dir.z + 0.29 * crown;
      const twist = Math.tanh(3 * across) * ((style.roll ? 1.36 : lifted ? 0.46 : 0.98) * crown + 0.19 * crown * dir.z);
      const lane = (style.roll ? 9 : waves ? 11 : 13) * (Math.atan2(dx, dz) + twist);
      const parting = smooth(Math.hypot(dx, dz), 0.16, 0.57);
      const scalpCourse = (0.67 * Math.cos(lane) + 0.23 * Math.cos(2 * lane + 0.48)
        + 0.10 * Math.cos(3 * lane + 0.27)) * parting;
      const ripple = waves ? 0.63 * Math.sin((top - y) * 0.058 + 1.8 * a) : 0.12;
      const hemCourse = Math.cos(19 * a + ripple);
      const course = mix(scalpCourse, hemCourse, hanging);
      const edge = smooth(t, 0.78, 1);
      const heft = style.roll ? 4.1 : waves ? 3.5 : bob ? 2.8 : 1.8;
      const loft = bulk + 1.6 + heft * (0.52 + course) - 1.6 * (1 - parting);
      const p = base.addScaledVector(q.n, mix(loft, -0.8, edge * (1 - fall)));
      p.y += y - guide;
      const drop = smooth(951 - y, 0, 56) * fall;
      const ear = bell((angle - 1.55) / 0.42) * bell((y - 901) / 29);
      p.addScaledVector(radial(a), 7.2 * ear * fall);
      const wave = (style.bend ?? 0) * Math.sin((947 - y) * 0.060 + 1.65 * a);
      p.addScaledVector(radial(a), drop * ((style.breadth ?? 0) * 0.64 + wave
        - (bob ? 3.7 : 0.9) * edge));
      // Waves fall beside the jaw, and move behind the shoulder together.
      p.z -= smooth(846 - y, 0, 46) * drop * (32 + 17 * Math.max(0, f));
      return [p, 0.945 + 0.052 * course - 0.035 * edge];
    }
    // Line the visible lower cut a few millimetres inside its outer wall.
    // Closing straight to a central cranium vertex leaves a shelf under bobs.
    const aroundHead = 192, rows = 62, liningRows = 6;
    model.shell(rows + liningRows, aroundHead, (u, v) => {
      const row = Math.round(u * (rows + liningRows)), a = tau * v;
      if (row <= rows) return surface(a, mix(0.002, 1, row / rows));
      const d = (row - rows) / liningRows;
      const [p] = surface(a, 1 - 0.11 * d);
      p.addScaledVector(radial(a), -4.6 * smooth(d, 0, 0.55) - 6 * d);
      return [p, 0.78];
    }, [surface(0, 0)[0], vec(0, 935, -6)], true);
  }
  // Front-to-back central part. Each lock begins on its own side of the
  // part and arcs to a distinct temple, so the crown flows in two directions.
  function parting({
    fringe = style.fringe ?? 3,
    heavy = false,
    sleek = false,
    split = part,
  } = {}) {
    const count = heavy ? channels + 2 : channels;
    for (const s of [-1, 1]) {
      const big = split * s <= 0;
      for (let k = 0; k < count + 4; k++) {
        const v = k / (count + 3);
        const a = s * mix(big ? 0.16 : 0.56, 2.75, v) + 0.03 * noise(k + 3 * s);
        const lane = Math.abs(a);
        // Swept fringe patches cover the brow. Start the surrounding courses
        // well behind them so the same forehead never carries stacked ends.
        if (
          lane < 1.09 &&
          (loose ||
            style.cut === "pony" ||
            style.cut === "curtain" ||
            (style.cut === "sweep" && !style.sleek) ||
            style.roll)
        )
          continue;
        const arch = mix(1.13, -1.09, v);
        const initialY = cy + (top - cy) * Math.cos(arch) * Math.cos(split);
        const initialA = Math.atan2(
          Math.sin(split),
          Math.cos(split) * Math.sin(arch),
        );
        const start = scalpPoint(
          initialA,
          initialY,
          2.3 + (style.crest ?? 1.6) * 0.48,
        );
        const startDirection = start
          .clone()
          .sub(vec(0, cy, -5))
          .normalize();
        const endY =
          hem(a) -
          (big ? fringe : fringe * 0.52) * Math.max(0.1, Math.cos(a)) -
          (style.length ?? 0) * smooth(lane, 0.7, 2.5);
        const finish = scalpPoint(a, endY, 0.4);
        const endDirection = finish
          .clone()
          .sub(vec(0, cy, -5))
          .normalize();
        const points = path(15, (t) => {
          const d = startDirection.clone().lerp(endDirection, t).normalize();
          const progress = smooth(t, 0, 1);
          let az = Math.atan2(d.x, d.z) + s * 0.1 * Math.sin(pi * t);
          let y = cy + (top - cy) * d.y;
          y = mix(y, endY, smooth(t, 0.62, 1));
          // At very short parts the curve roots sit on opposite crown slopes;
          // sample the cap at the same latitude to prevent floating ridges.
          const u =
            (2 / pi) * Math.acos(clamp((y - hem(az)) / (top - hem(az)), 0, 1));
          const archLift = (heavy ? 2.3 : sleek ? 0.4 : 1.5) * Math.sin(pi * t);
          const tuck =
            (1.7 + 0.6 * Math.cos(2 * pi * v)) * (1 - smooth(t, 0, 0.27));
          const p = scalpPoint(az, y, capRise(az, u) + archLift - tuck);
          if (t > 0.72 && lane < 1.7)
            p.addScaledVector(radial(az), (heavy ? 2 : 0.75) * progress);
          return p;
        });
        const w =
          (sleek ? 4.8 : heavy ? 9.1 : 7.3) *
          (big ? 1.0 : 0.82) *
          (1 - 0.18 * v);
        const thickness = sleek ? 1.55 : heavy ? 4.5 : 3.1;
        model.lock(points, w, thickness, {
          startWidth: 0.23,
          root: 0.18,
          tip: big ? 0.52 : 0.6,
          underside: thickness + 2,
          tint: 0.96 + 0.039 * noise(k + 4 * s),
        });
      }
    }
  }
  function sweptForelock(sign, strength, small = false) {
    const brow = female ? 925.5 : 940,
      curtain = style.cut === "curtain";
    const bands = 43;
    const crownPart = curtain ? 0.12 : Math.abs(part) + 0.12;
    const guides = path(bands - 1, (v) => {
      const begin = -sign * crownPart * (0.6 + 0.77 * v);
      const finish = sign * mix(small || curtain ? 0.16 : -0.16, 1.28, v);
      const slope = (small ? 17 : 24) * v,
        rawTip = brow + (small ? 30 : 22) - 0.71 * strength - slope;
      const rim = 1 - Math.sin(pi * v) ** 0.65;
      const tip = mix(rawTip, frontHem(finish) + 0.64, rim);
      const tilt = 0.95 * v - 0.08;
      return new T.CatmullRomCurve3(
        [
          vec(begin, top - 1.6 - 8 * v, 0),
          vec(begin * 0.85 + sign * 0.12, top - 9 - 7 * v, 0),
          vec(sign * tilt * 0.3, top - 19 - 8 * v, 0),
          vec(begin * 0.15 + finish * 0.5, mix(top - 18, tip, 0.66), 0),
          vec(finish * 0.85, mix(top - 17, tip, 0.9), 0),
          vec(finish, tip + 0.9 * Math.cos(8 * pi * v), 0),
        ],
        false,
        "catmullrom",
        0.42,
      );
    });
    function surface(t, v, inside = false) {
      const { x: a, y } = guides[Math.round(v * (bands - 1))].getPoint(t);
      const edgeY = frontHem(a);
      const lat =
        (2 / pi) * Math.acos(clamp((y - edgeY) / (top - edgeY), 0, 1));
      const edge = Math.sin(pi * v) ** 0.44;
      const mass = (small ? 2.5 : 4.7) * edge * Math.sin(pi * t) ** 0.77;
      const course = Math.cos(
        tau * (small ? 2.8 : 4.3) * v + 0.72 * Math.sin(pi * t),
      );
      const fine = 0.14 * Math.cos(tau * 21 * v + 1.3 * t);
      const root = smooth(t, 0, 0.22),
        tip = smooth(t, 0.68, 1);
      const shoulderFade = 1 - edge;
      const rootTuck = (1 - smooth(t, 0.025, 0.31)) * 3.7;
      const bed = capRise(a, lat);
      const crest =
        bed +
        1.25 +
        root * mass +
        (small ? 0.68 : 1.17) * (course + fine) * edge * Math.sin(pi * t) -
        rootTuck -
        2.3 * shoulderFade -
        0.85 * tip;
      const p = scalpPoint(a, y, crest - (inside ? 3.9 : 0));
      if (inside) p.y += 0.75;
      return [p, inside ? 0.76 : 0.971 + 0.038 * course * edge];
    }
    model.shell(
      27,
      2 * bands,
      (t, u) => {
        const j = Math.round(u * 2 * bands),
          back = j >= bands;
        return surface(t, (back ? 2 * bands - j - 1 : j) / (bands - 1), back);
      },
      null,
      sign > 0,
    );
    if (style.streak && !small) {
      const pts = path(26, (t) => {
        const p = surface(mix(0.08, 0.96, t), 0.39)[0];
        return p
          .clone()
          .addScaledVector(
            vec(p.x, (p.y - cy) * 0.9, p.z + 5).normalize(),
            0.62,
          );
      });
      streak.lock(pts, (t) => 2.15 + 1.05 * Math.sin(pi * t), 0.8, {
        normal: (p) => vec(p.x, (p.y - cy) * 0.9, p.z + 5).normalize(),
        root: 0.21,
        tip: 0.71,
        underside: 1.7,
        tint: 0.86,
      });
    }
  }
  function fringePair(strength = style.fringe ?? 5) {
    const s = part >= 0 ? -1 : 1;
    sweptForelock(s, strength);
    sweptForelock(
      -s,
      style.cut === "curtain" ? strength : strength * 0.46,
      style.cut !== "curtain",
    );
  }
  function brush() {
    for (let i = 0; i < channels + 3; i++) {
      const v = i / (channels + 2),
        lane = mix(-0.9, 0.88, v);
      const square = Math.max(0, 1 - lane * lane);
      const guides = path(19, (t) => {
        const sweep = lane + part * 0.48 * Math.sin(pi * t) + 0.11 * (1 - t);
        const arc = mix(1.39, -1.75, t);
        const d = vec(
          Math.sin(sweep),
          Math.cos(sweep) * Math.cos(arc),
          Math.cos(sweep) * Math.sin(arc),
        );
        const a = Math.atan2(d.x, d.z);
        const y = Math.max(hem(a), cy + (top - cy) * d.y);
        const lat =
          (2 / pi) * Math.acos(clamp((y - hem(a)) / (top - hem(a)), 0, 1));
        const p = scalpPoint(
          a,
          y,
          capRise(a, lat) +
            (style.crest ?? 4) * bell((t - 0.26) / 0.24) * square -
            1.4,
        );
        p.z += 4.4 * square * bell((t - 0.18) / 0.14);
        return p;
      });
      model.lock(guides, 7.9 - 0.95 * Math.abs(lane), 3.8, {
        tip: 0.63,
        root: 0.21,
        underside: 7,
        tint: 0.97 + 0.035 * noise(i),
      });
    }
    for (const s of [-1, 1])
      for (let j = 0; j < 6; j++) {
        const angle = s * (0.96 + j * 0.3);
        model.lock(
          path(12, (t) => skull(angle + s * 0.48 * t, mix(0.44, 1.01, t), 0.6)),
          4,
          1.5,
          { underside: 3.6, tip: 0.47 },
        );
      }
  }
  function pixie() {
    const shag = style.cut === "shag";
    for (let row = 0; row < 4; row++) {
      const n = [9, 13, 17, 22][row];
      for (let j = 0; j < n; j++) {
        const id = row * 53 + j + style.seed * 3;
        const a = ((j + row * 0.43) * tau) / n + noise(id) * 0.06;
        const f = Math.max(0, Math.cos(a));
        const fr = (style.fringe ?? 3) * (shag ? 0.35 + 0.65 * f : f);
        const start = 0.07 + 0.186 * row,
          end = start + 0.27 + 0.038 * noise(id + 2);
        const pts = path(13, (t) => {
          const theta =
            a + part * (1.9 - 1.5 * t) + 0.085 * Math.sin(pi * t + id);
          const level = mix(start, end, t);
          const p = skull(
            theta,
            level,
            0.7 + (1.2 + style.jag * 0.24) * Math.sin(pi * t),
          );
          if (row === 3) {
            const looseTip = smooth(t, 0.59, 1);
            p.y -= (fr + 2.7 * noise(2 + id)) * looseTip;
            p.addScaledVector(
              around(theta),
              looseTip * (style.jag * 0.44 * noise(id)),
            );
            p.addScaledVector(
              radial(theta),
              looseTip * (1.3 + 0.32 * style.jag * (0.5 + 0.5 * noise(id))),
            );
          }
          return p;
        });
        model.lock(
          pts,
          6.8 + (shag ? 1.25 : 0.3) * noise(id),
          shag ? 3.2 : 2.55,
          {
            root: 0.18,
            tip: 0.47,
            underside: 5.8,
            tint: 0.96 + 0.051 * noise(id + 3),
          },
        );
      }
    }
    const shaggy = shag || female;
    const n = shag ? 10 : 8;
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1),
        a = mix(-1.19, 1.19, u);
      const seed = k + (style.seed ?? 0) * 4;
      const start = a + part * (shag ? 0.48 : 1.45) + 0.13 * noise(seed);
      const end = a - part * 0.38 + noise(seed + 0.7) * 0.15;
      const length = shaggy ? 13 + (style.fringe ?? 5) * 0.47 : 3.0;
      const endY = hem(end) - length - 3.7 * noise(seed);
      const guides = path(16, (t) => {
        const theta =
          mix(start, end, smooth(t, 0.04, 1)) + 0.06 * Math.sin(pi * t);
        const y = mix(top - 8 - 3.4 * noise(seed), endY, t ** 1.23);
        const lat =
          (2 / pi) *
          Math.acos(clamp((y - hem(theta)) / (top - hem(theta)), 0, 1));
        const loft =
          mix(capRise(theta, lat) + 3.0, 1.35, smooth(t, 0.64, 1)) +
          1.85 * Math.sin(pi * t);
        return scalpPoint(theta, y, loft);
      });
      model.lock(guides, shag ? 6.2 : 6.8, shag ? 3.2 : 2.8, {
        tip: 0.4,
        root: 0.14,
        underside: 6.0,
        tint: 0.98 + 0.035 * noise(seed),
      });
    }
  }

  // A double-walled cut surrounds the nape and ends in a turned hem. The
  // width, fall, curl amplitude, fringe length and front/back hem are drafted
  // separately. Below shoulder level the fall follows the back of the torso.
  function skirtedHair() {
    const rolled = style.cut === "rollBob",
      waves = style.cut === "waves";
    const begin = waves ? 1.03 : rolled ? 0.86 : 0.78,
      bands = 88,
      fall = style.hem;
    function surface(a, u) {
      const f = Math.cos(a),
        side = Math.sin(a),
        phase = 1.55 * a + 0.52 * side;
      const tips =
        (style.ends ?? 1.1) *
        (0.62 * Math.cos(18 * a) + 0.38 * Math.sin(11 * a));
      const earLift = rolled ? 18 * smooth(Math.abs(side), 0.24, 0.88) : 0;
      const end = fall + (style.angleHem ?? 3.5) * f + tips + earLift;
      const y = mix(top - 3, end, u),
        guide = Math.max(934 + 4 * f, y);
      const p = scalpPoint(a, guide, bulk + (rolled ? 2.2 : 1.4));
      const drape = smooth(u, 0.22, 0.62);
      const bend = style.bend ?? 0;
      const curl =
        bend *
        Math.sin((waves ? 4.5 : 1.85) * pi * u + phase) *
        smooth(u, 0.19, 0.56);
      const rake = style.breadth * (waves ? 0.65 : 1) * Math.sin(pi * u * 0.82);
      p.addScaledVector(
        radial(a),
        (rake + curl + 1.2 - (rolled ? 10 : 3) * smooth(u, 0.8, 1)) * drape,
      );
      p.addScaledVector(
        around(a),
        (waves ? bend * 0.6 : 0.7) * Math.sin(4.3 * pi * u + 0.8 * a) * drape,
      );
      p.y = y;
      const shoulder = smooth(844 - y, 0, 48);
      p.z -= shoulder * (32 + 22 * Math.max(0, f));
      p.z -= 3.5 * Math.sin(pi * u) * Math.max(0, -f);
      if (rolled) p.addScaledVector(radial(a), -7.1 * smooth(u, 0.88, 1));
      return p;
    }
    const rowPts = Array.from({ length: 35 }, (_, i) =>
      Array.from({ length: bands }, (_, j) => {
        const a = mix(begin, tau - begin, j / (bands - 1));
        return surface(a, i / 34);
      }),
    );
    model.shell(
      34,
      2 * bands,
      (u, v) => {
        const j = Math.round(v * 2 * bands),
          k = j < bands ? j : 2 * bands - 1 - j;
        const a = mix(begin, tau - begin, k / (bands - 1)),
          inside = j >= bands;
        const p = rowPts[Math.round(u * 34)][k].clone();
        if (inside) {
          p.addScaledVector(radial(a), -3.5);
          p.y += 1.7;
        }
        return [p, inside ? 0.74 : 0.956 + 0.027 * Math.cos(21 * a + u * 2.1)];
      },
      null,
      true,
    );
    const count = waves ? 19 : rolled ? 18 : 20;
    for (let k = 0; k < count; k++) {
      const v = k / (count - 1),
        angle = mix(begin + 0.012, tau - begin - 0.012, v);
      const pts = path(19, (t) => {
        const u = mix(0.18 + 0.045 * (k % 3), 0.97 + 0.03 * noise(k), t);
        const shift =
          (waves ? 0.09 : rolled ? 0.2 : 0.027) *
          Math.sin((waves ? 3 : 1) * pi * u + angle * 0.8);
        return surface(angle + shift, u).addScaledVector(
          radial(angle),
          0.45 + 1.2 * Math.sin(pi * t),
        );
      });
      model.lock(
        pts,
        waves ? 10.3 : rolled ? 8.9 : 6.9,
        waves ? 3.6 : rolled ? 2.55 : 1.55,
        {
          normal: radial(angle),
          root: 0.19,
          tip: waves ? 0.55 : 0.83,
          endWidth: waves ? 0.025 : 0.15,
          underside: 5.0,
          tint: 0.97 + 0.036 * noise(k),
        },
      );
    }
    if (style.frontFall) {
      // Distinct over-shoulder section in the floral dress and copper bob.
      const [angle, amp] = style.frontFall,
        s = -1;
      for (let k = 0; k < 4; k++) {
        const theta = s * (angle + 0.092 * k),
          yEnd = fall + (k - 1) * 4.1;
        const pts = path(21, (t) => {
          const u = mix(0.22, 1, t),
            p = surface(theta, u);
          const forwardRoll = smooth(t, 0.18, 0.83);
          p.x +=
            s * amp * 0.78 * Math.sin(3.4 * pi * u + 0.4 * k) * forwardRoll;
          p.z +=
            forwardRoll * (waves && fall < 830 ? 39 : 11) +
            2.6 * Math.sin(3.5 * pi * t);
          p.x -= s * (waves && fall < 830 ? 5.5 : 0) * Math.sin(pi * t);
          p.y = mix(p.y, yEnd, smooth(t, 0.84, 1));
          return p;
        });
        model.lock(pts, 9.5 - k * 0.7, 5.4, {
          normal: vec(-0.55, 0, 0.84),
          root: 0.12,
          tip: 0.7,
          underside: 5.7,
          tint: 0.96 + 0.023 * k,
        });
      }
    }
  }

  function ellipsoidSample(c, radii, t, a) {
    const n = vec(
      Math.sin(t) * Math.sin(a),
      Math.cos(t),
      Math.sin(t) * Math.cos(a),
    );
    return {
      p: c.clone().add(vec(n.x * radii.x, n.y * radii.y, n.z * radii.z)),
      n,
    };
  }
  // Interlocking curl buds are rooted inside a continuous silhouette. Their
  // spiral relief opens towards the surface while the underside stays buried.
  function bud(p, n, r, seed, helix = true) {
    let x = new T.Vector3().crossVectors(up, n);
    if (x.lengthSq() < 0.025) x = new T.Vector3().crossVectors(forward, n);
    x.normalize();
    const y = new T.Vector3().crossVectors(n, x).normalize();
    function knot(t, a) {
      const co = Math.cos(t),
        si = Math.sin(t),
        ridges =
          0.085 * Math.sin(4 * a + 1.1 * seed + 3.2 * t) * si +
          0.045 * Math.cos(7 * a - 2 * t) * si;
      return p
        .clone()
        .addScaledVector(n, r * (0.3 + 0.65 * co))
        .addScaledVector(x, r * (1 + ridges) * si * Math.cos(a))
        .addScaledVector(y, r * (0.91 + ridges) * si * Math.sin(a));
    }
    model.shell(
      6,
      11,
      (v, a) => [
        knot(mix(0.08, pi - 0.08, v), tau * a),
        0.91 + 0.046 * Math.cos(3 * tau * a + seed) + 0.033 * noise(seed),
      ],
      [knot(0, 0), knot(pi, 0)],
      true,
    );
    if (helix) {
      const pts = path(13, (t) => {
        const a = tau * (0.14 + 1.05 * t) + seed,
          rr = mix(0.86, 0.13, t);
        return p
          .clone()
          .addScaledVector(x, r * rr * Math.cos(a))
          .addScaledVector(y, r * rr * 0.91 * Math.sin(a))
          .addScaledVector(n, r * (0.33 + 0.65 * Math.sqrt(1 - rr * rr)));
      });
      model.lock(pts, r * 0.21, r * 0.14, {
        normal: n,
        length: 13,
        sides: 7,
        tip: 0.84,
        underside: r * 0.15,
        tint: 1.0 + 0.035 * noise(seed),
      });
    }
  }
  function texturedMass(
    surface,
    rings,
    circumference,
    radius,
    phase,
    limits = () => 1,
  ) {
    model.shell(
      28,
      96,
      (t, a) => {
        const s = surface(mix(0.002, 0.999, t), tau * a);
        return [s.p, 0.925 + 0.025 * Math.cos(24 * tau * a + 7 * t)];
      },
      [surface(0, 0).p, surface(1, 0).p.clone().addScaledVector(up, -2)],
      true,
    );
    // Distribute by surface area in a golden-angle spiral to avoid obvious
    // horizontal rows, most visible in light, closely cropped curls.
    const sweep = pi * 0.7;
    const population = Math.ceil(
      (circumference * rings * (1 - Math.cos(sweep))) / sweep,
    );
    for (let j = 0; j < population; j++) {
      const seed = j + phase;
      const a = (2.3999632297 * j + 0.036 * noise(seed)) % tau;
      const t =
        Math.acos(1 - ((j + 0.45) / population) * (1 - Math.cos(sweep))) /
        sweep;
      if (t > limits(a)) continue;
      const q = surface(
        clamp(t + (noise(seed + 2) * 0.17) / rings, 0.004, 0.996),
        a,
      );
      const r = radius * (0.83 + 0.29 * (0.5 + 0.5 * noise(seed + 6))) * q.size;
      bud(q.p, q.n, r, seed, r > 2.2);
    }
  }
  function afro() {
    const big = style.volume > 15;
    function surface(t, a) {
      const front = smooth(Math.cos(a), -0.05, 0.9);
      const theta = Math.atan2(Math.sin(a), Math.cos(a));
      const fringe = big
        ? 22 * bell((theta + 0.68) / 0.58) + 5 * bell((theta - 0.98) / 0.35)
        : 0;
      const endY = mix(
        style.bottom - (big ? 24 : 5),
        hem(a) - (big ? 6.5 : 5.6) - fringe,
        front,
      );
      const h = big ? 939 : 943,
        yr = top + style.volume - h;
      const angle = Math.acos(clamp((endY - h) / yr, -0.97, 0.97)) * t;
      const rad = vec(
        52 + style.breadth + style.volume * 0.38,
        yr,
        66 + style.volume * 0.48,
      );
      const q = ellipsoidSample(vec(style.side, h, -3.6), rad, angle, a);
      if (big) {
        q.p.x += 5.4 * Math.sin(a) * Math.sin(angle) ** 1.4;
        q.p.y += 4.0 * bell((theta - 0.34) / 0.34) * smooth(t, 0.48, 1);
      }
      const edge = smooth(t, 0.86, 1),
        drift = (big ? 2.8 : 1.5) * Math.sin(6 * a + 7 * t) * Math.sin(pi * t);
      q.p.addScaledVector(q.n, drift - edge * 3.8);
      if (big) q.p.x += 2.8 * Math.sin(pi * t);
      return {
        ...q,
        size: (0.65 + 0.35 * Math.sin(pi * t * 0.8)) * (1 - 0.36 * edge),
      };
    }
    texturedMass(surface, big ? 15 : 12, big ? 46 : 39, style.radius, 21);
  }
  function coiledCrop() {
    const volume = style.volume,
      r = style.radius;
    function surface(t, a) {
      const end = 1 + ((style.fringe ?? 0) / 70) * Math.max(0, Math.cos(a));
      const p = skull(a, t * end, 0.1);
      const n = vec(p.x, (p.y - cy) * 0.98, p.z + 4).normalize();
      const front = Math.max(0, Math.cos(a)),
        h = t * 0.96;
      p.addScaledVector(
        n,
        (0.8 + 0.37 * volume + front * (style.crest ?? 0)) * Math.sin(pi * h),
      );
      p.x += (style.sweep ?? 0) * 3 * front * Math.sin(pi * h);
      return { p, n, size: 1 - 0.79 * smooth(t, 0.57 + 0.18 * front, 0.99) };
    }
    const wide = r > 6.9;
    texturedMass(
      surface,
      wide ? 10 : 12,
      wide ? 27 : Math.round((32 * 5.4) / r),
      r,
      11,
    );
  }
  function shortTurf() {
    // Fine relief cut into the cap reads as clipping-grain at full silhouette,
    // without placing hundreds of individually detached dots on the hairline.
    model.shell(
      47,
      154,
      (t, v) => {
        const a = tau * v,
          u = mix(0.003, 0.999, t),
          f = Math.max(0, Math.cos(a));
        const fade = style.fade
          ? smooth(u, 0.39 + 0.23 * f, 0.99)
          : 0.18 * smooth(u, 0.69, 1);
        const grit =
          0.47 * Math.sin(104 * a + 96 * u) * Math.cos(68 * a - 117 * u) +
          0.38 * Math.sin(141 * a + 71 * u);
        const veil = (1 - 0.7 * fade) * smooth(u, 0.02, 0.23);
        const p = skull(a, u, grit * 0.46 * veil + (0.32 + 0.48 * f) * (1 - u));
        return [
          p,
          (0.94 + 0.115 * grit * veil) * mix(1, style.fade ? 1.67 : 1.1, fade),
        ];
      },
      [skull(0, 0), vec(0, 933, -4)],
      true,
    );
  }

  function shellBun(center, radii, puff = false) {
    const size = style.bunSize ?? 18;
    function knot(t, a) {
      const ang = t * pi;
      const q = ellipsoidSample(center, radii, ang, a);
      q.p.addScaledVector(
        q.n,
        size * 0.048 * Math.sin(10 * a - 5.8 * ang) * Math.sin(ang),
      );
      return q;
    }
    if (puff) {
      // Complete UV sphere with decreasing populations near both poles.
      model.shell(
        25,
        74,
        (t, a) => [knot(mix(0.003, 0.997, t), tau * a).p, 0.94],
        [knot(0, 0).p, knot(1, 0).p],
        true,
      );
      for (let row = 0; row < 12; row++) {
        const u = (row + 0.43) / 12,
          n = Math.max(4, Math.round(27 * Math.sin(pi * u)));
        for (let j = 0; j < n; j++) {
          const seed = 37 * row + j,
            a = (tau * (j + 0.4 * (row % 2) + 0.15 * noise(seed))) / n;
          const q = knot(u + 0.011 * noise(seed + 1), a);
          bud(q.p, q.n, style.radius * (0.95 + 0.15 * noise(seed + 3)), seed);
        }
      }
    } else {
      model.shell(
        26,
        68,
        (t, a) => [
          knot(mix(0.002, 0.998, t), tau * a).p,
          0.96 + 0.025 * Math.cos(10 * tau * a - 6 * pi * t),
        ],
        [knot(0, 0).p, knot(1, 0).p],
        true,
      );
      for (let i = 0; i < 5; i++) {
        const p = path(
          22,
          (t) => knot(mix(0.14, 0.87, t), (tau * i) / 5 + 2.8 * t).p,
        );
        model.lock(p, 3.3, 1.45, {
          normal: (p) => p.clone().sub(center).normalize(),
          tip: 0.83,
          underside: 2.7,
          tint: 0.976 + 0.022 * noise(i),
        });
      }
    }
  }
  function gathering(toY, elevation) {
    // Fanned courses from the two temples and nape terminate at the tie.
    for (const sign of [-1, 1])
      for (let j = 0; j < 9; j++) {
        const angle = sign * mix(0.88, 2.99, j / 8);
        const end = sign * (pi - (0.12 * (8 - j)) / 8);
        const pts = path(15, (t) => {
          const theta = mix(angle, end, smooth(t, 0, 1));
          const y =
            mix(hem(angle) + 2.2, toY, t) + elevation * Math.sin(pi * t);
          return scalpPoint(theta, y, bulk * 0.74 + 0.78 * Math.sin(pi * t));
        });
        model.lock(pts, 4.8, 1.75, {
          root: 0.19,
          tip: 0.68,
          underside: 3.6,
          tint: 0.969 + 0.028 * noise(j),
        });
      }
  }
  function templeRinglet(side, long = false) {
    const travel = long ? 111 : 92;
    const points = path(21, (t) => {
      const y = 965 - t * travel,
        arc = side * (0.96 - 0.145 * Math.sin(pi * t) + 0.075 * t);
      const q = scalpPoint(
        arc,
        Math.max(y, 908),
        3.5 + 1.25 * Math.sin(pi * t),
      );
      q.y = y;
      q.x +=
        side *
        (long ? 3.15 : 1.5) *
        Math.sin(tau * 1.25 * t) *
        smooth(t, 0.12, 0.64);
      q.z += 4.8 * smooth(t, 0.12, 0.53) + 2.4 * Math.sin(pi * 1.8 * t);
      return q;
    });
    model.lock(points, long ? 3.9 : 3.3, 2.7, {
      normal: vec(side * 0.5, 0, 0.866),
      root: 0.2,
      tip: 0.38,
      tint: 0.96,
    });
  }
  function pony() {
    parting({ heavy: style.temples === 2 });
    fringePair(style.fringe);
    const tie = vec(-1, style.tieY, -39);
    gathering(style.tieY - 3, 11);
    let centers;
    if (style.loop)
      centers = [
        tie,
        vec(-4, 1002, -64),
        vec(-7, 1016, -76),
        vec(-9, 1014, -87),
        vec(-13, 997, -92),
        vec(-14, 974, -91),
        vec(-13, 947, -86),
        vec(-9, style.hem, -89),
      ];
    else
      centers = [
        tie,
        vec(-4, style.tieY + 13, -69),
        vec(-9, style.tieY + 12, -82),
        vec(-13, style.tieY - 7, -92),
        vec(-16, mix(style.tieY, style.hem, 0.46), -90),
        vec(-12, mix(style.tieY, style.hem, 0.68), -85),
        vec(-17, mix(style.tieY, style.hem, 0.86), -82),
        vec(-22, style.hem, -85),
      ];
    if (!style.loop) {
      // Both long ponytails fall to one side of the nape in front view. Their
      // ties stay at the rear centre. The honey loop is a short upright tail.
      const endX = style.temples === 1 ? -49 : 43;
      for (let i = 1; i < centers.length; i++) {
        const t = i / (centers.length - 1),
          side = smooth(t, 0.13, 0.74);
        centers[i].x = T.MathUtils.lerp(
          centers[i].x,
          endX + 4 * Math.sin(pi * t),
          side,
        );
        centers[i].z += 16 * side;
      }
    }
    const curve = new T.CatmullRomCurve3(centers);
    const width = (t) =>
      style.wide *
      (0.79 + 0.43 * smooth(t, 0.01, 0.24)) *
      (1 - 0.77 * smooth(t, 0.69, 1));
    const middle = path(25, (t) => curve.getPoint(t));
    model.lock(
      middle,
      (t) => width(t),
      (t) => width(t) * 0.75,
      {
        normal: vec(0, 0, -1),
        root: 0.09,
        startWidth: 0.55,
        tip: 0.88,
        underside: 1.7,
        tint: 0.92,
      },
    );
    for (let k = 0; k < 13; k++) {
      const a = (tau * k) / 13,
        n = vec(Math.cos(a), 0, Math.sin(a));
      const pts = path(24, (t) => {
        const p = curve.getPoint(t),
          w = width(t);
        const loop = 2.5 * pi * t + a;
        const u = smooth(t, 0.12, 0.45);
        p.x += w * 0.81 * Math.cos(a) + u * style.wave * Math.sin(loop);
        p.z += w * 0.61 * Math.sin(a) + 0.66 * u * style.wave * Math.cos(loop);
        p.y += 3.6 * noise(k) * smooth(t, 0.65, 1);
        return p;
      });
      model.lock(
        pts,
        (t) => width(t) * 0.4,
        (t) => width(t) * 0.28,
        {
          normal: n,
          root: 0.11,
          startWidth: 0.56,
          tip: 0.69,
          underside: 2.9,
          tint: 0.95 + 0.046 * noise(k),
        },
      );
    }
    for (const s of [-1, 1]) templeRinglet(s, style.temples === 2);
  }
  function plait(guides, width, turns, outward, endWidth) {
    const curve = new T.CatmullRomCurve3(guides);
    for (let strand = 0; strand < 3; strand++) {
      const breadth = (t) => width * (1 - (1 - endWidth) * smooth(t, 0.15, 1));
      const pts = path(Math.ceil(19 * turns), (t) => {
        const q = curve.getPoint(t),
          n = outward(q, t),
          tangent = curve.getTangent(t);
        const x = new T.Vector3().crossVectors(n, tangent).normalize();
        const y = new T.Vector3().crossVectors(tangent, x).normalize();
        const a = tau * (turns * t + strand / 3);
        return q
          .addScaledVector(x, 0.52 * breadth(t) * Math.sin(a))
          .addScaledVector(y, 0.265 * breadth(t) * Math.sin(2 * a));
      });
      model.lock(
        pts,
        (t) => breadth(t) * 0.56,
        (t) => breadth(t) * 0.45,
        {
          normal: outward,
          length: pts.length - 1,
          sides: 9,
          startWidth: 0.75,
          endWidth: 0.8,
          root: 0.04,
          tip: 0.95,
          tint: 0.9 + 0.063 * strand,
        },
      );
    }
  }
  function sideBraid() {
    const guides = [
      [-1, 909, -54],
      [18, 894, -58],
      [32, 872, -51],
      [41, 852, -45],
      [50, 836, -29],
      [60, 824, -7],
      [64, 816, 23],
      [60, 808, 52],
      [58, 794, 65],
      [60, 768, 69],
      [59, style.hem + 19, 71],
    ].map((p) => vec(...p));
    const facing = (_p, t) =>
      vec(0.87 - 0.76 * t, 0, -0.45 + 1.45 * t).normalize();
    plait(guides, 17.5, 6.2, facing, 0.48);
    const tip = guides.at(-1);
    model.lock(
      [
        tip.clone().addScaledVector(up, 4),
        tip.clone(),
        vec(60, style.hem + 9, 73),
        vec(65, style.hem, 72),
      ],
      6.8,
      4.2,
      { normal: forward, root: 0.12, tip: 0.49 },
    );
  }
  function microbraids() {
    // Independent rope paths keep the pony's tiny parallel ridges visible in
    // profile. The tie is anchored high; the ends finish in a blunt fan.
    const tie = vec(0, 973, -41);
    for (let i = 0; i < 44; i++) {
      const a = (tau * i) / 44;
      const pts = path(19, (t) => {
        const angle = a + 0.37 * Math.sin(a) * t;
        return skull(angle, mix(0.98, 0.2, t), 1.05 + 0.82 * Math.sin(pi * t));
      });
      model.lock(pts, 2.08, 1.34, {
        root: 0.08,
        startWidth: 0.42,
        tip: 0.81,
        underside: 2.8,
        tint: 0.88 + 0.13 * ((i % 3) / 2),
      });
    }
    const guide = new T.CatmullRomCurve3([
      tie,
      vec(-1, 992, -58),
      vec(-4, 986, -70),
      vec(-4, 958, -75),
      vec(-6, 919, -74),
      vec(-4, 874, -72),
      vec(-3, 817, -75),
      vec(-2, style.hem, -75),
    ]);
    const width = (t) =>
      mix(16, 28, smooth(t, 0.04, 0.64)) * (1 - 0.1 * smooth(t, 0.77, 1));
    model.lock(
      path(24, (t) => guide.getPoint(t)),
      (t) => width(t),
      (t) => width(t) * 0.55,
      {
        normal: vec(0, 0, -1),
        root: 0.09,
        tip: 0.99,
        endWidth: 0.92,
        underside: 1.5,
        tint: 0.85,
      },
    );
    for (let j = 0; j < 34; j++) {
      const a = (tau * j) / 34;
      for (const lane of [0, 1]) {
        const pts = path(76, (t) => {
          const p = guide.getPoint(t),
            w = width(t);
          const spin = 13 * t * tau + j + lane * pi;
          p.x +=
            w * Math.cos(a) +
            0.78 * Math.cos(spin) +
            0.65 * Math.sin(a + 6 * t);
          p.z += w * 0.57 * Math.sin(a) + 0.72 * Math.sin(spin);
          p.y +=
            0.65 * Math.sin(spin) * Math.cos(a) +
            2.1 * noise(j) * smooth(t, 0.77, 1);
          return p;
        });
        model.lock(pts, 1.46, 1.17, {
          normal: vec(Math.cos(a), 0, Math.sin(a)),
          length: 76,
          sides: 6,
          root: 0.12,
          startWidth: 0.53,
          tip: 0.97,
          endWidth: 0.44,
          tint: lane ? 0.97 : 0.91,
        });
      }
    }
    templeRinglet(-1, true);
    templeRinglet(1, true);
  }

  const continuousPart = style.cut === "bob" || style.cut === "braid" ||
    (style.cut === "lowBun" && style.roll) ||
    (style.cut === "waves" && style.hem < 830);
  if (continuousPart) sweptScalp();
  else if (style.cut !== "buzz" && style.cut !== "halo" && style.cut !== "curl")
    volumeCap();
  switch (style.cut) {
    case "buzz":
      shortTurf();
      break;
    case "halo":
      afro();
      break;
    case "curl":
      coiledCrop();
      break;
    case "brush":
      brush();
      break;
    case "pixie":
    case "shag":
      pixie();
      break;
    case "sweep":
    case "curtain":
      parting({ heavy: !style.sleek, sleek: style.sleek });
      if (!style.sleek) fringePair();
      break;
    case "bob":
    case "rollBob":
    case "waves":
      if (continuousPart) break;
      skirtedHair();
      parting({ heavy: style.cut !== "bob", sleek: style.cut === "bob" });
      fringePair();
      break;
    case "braids":
      microbraids();
      break;
    case "braid":
      sideBraid();
      break;
    case "pony":
      pony();
      break;
    case "puff":
      gathering(971, 18);
      shellBun(
        vec(0, style.bunY + 17, -30),
        vec(style.bunSize * 1.06, style.bunSize * 0.83, style.bunSize * 0.92),
        true,
      );
      templeRinglet(-1);
      templeRinglet(1);
      break;
    case "lowBun":
      if (!continuousPart) {
        gathering(style.bunY + 10, 16);
        parting({ sleek: true });
      }
      shellBun(
        vec(0, style.bunY, -60),
        vec(style.bunSize, style.bunSize * 0.9, style.bunSize),
      );
      if (!continuousPart && style.temples) templeRinglet(-1);
      break;
  }
  const geometry = model.geometry();
  const extra = streak.positions.length ? streak.geometry() : null;
  if (female && (style.hem ?? 1000) < 845) {
    // Keep the roots and ties rigid to the skull, gradually sharing weight
    // with the neck and chest only on hair draped below the jaw.
    const p = geometry.attributes.position;
    const si = new Uint16Array(p.count * 4),
      sw = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      const under = smooth(0.857 - p.getY(i), 0, 0.083);
      const chest = under * 0.47,
        neck = under * 0.28;
      si.set([39, 38, 13, 0], i * 4);
      sw.set([1 - chest - neck, neck, chest, 0], i * 4);
    }
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(si, 4));
    geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(sw, 4));
  }
  return { geometry, extra };
}

export function addTripoHair(female, index, color, material, add, skin) {
  const gender = female ? "female" : "male",
    style = tripoHair[gender][index];
  if (!style) return;
  if (style.cut === "helmet")
    return androidHelmet(gender, style, color, material, add);
  let entry = geometries.get(style.source);
  if (!entry) {
    entry = groom(gender, style);
    // Sculpt data are repeatable. Keep a small working set when browsing all
    // variants, without retaining every large microbraid and curl mesh.
    if (geometries.size >= 8) geometries.delete(geometries.keys().next().value);
    geometries.set(style.source, entry);
  }
  const geom = entry.geometry.clone(),
    rough = ["buzz", "curl", "halo", "puff", "braids"].includes(style.cut)
      ? 0.68
      : 0.52;
  const dye =
    style.silver || (style.fade && skin) ? new T.Color("white") : color;
  if (style.fade && skin) tintFade(geom, gender, color, skin);
  if (style.silver) {
    const p = geom.attributes.position,
      c = geom.attributes.color;
    const silver = new T.Color("#9d99a2"),
      strand = new T.Color();
    for (let i = 0; i < p.count; i++) {
      const x = Math.abs(p.getX(i)),
        y = p.getY(i),
        z = p.getZ(i);
      const grain = 0.8 + 0.16 * Math.sin(1745 * y + 410 * z);
      const temples =
        smooth(x, 0.032, 0.052) *
        (1 - smooth(y, 0.945, 0.979)) *
        (0.79 + 0.21 * smooth(z, -0.046, 0.047));
      strand
        .copy(color)
        .lerp(silver, style.silver * temples * grain)
        .multiplyScalar(c.getX(i));
      c.setXYZ(i, strand.r, strand.g, strand.b);
    }
  }
  add("Hair / " + style.name, geom, material(dye, true, { roughness: rough }));
  if (entry.extra)
    add(
      "Hair / silver part streak",
      entry.extra.clone(),
      material("#b1a8ad", true, { roughness: 0.57 }),
    );
}
