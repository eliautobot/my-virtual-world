// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as T from "three";
import { groomScalp } from "./hair-roots.js";

export const newHairNames = {
  female: [
    "Feathered pixie",
    "Rounded coils",
    "Twin puff buns",
    "Butterfly layers",
    "Crown braid",
    "Sculpted finger waves",
    "Side fishtail",
    "Blunt lob",
    "Half-up cascade",
    "Victory rolls",
  ],
  male: [
    "Ivy taper",
    "Low pompadour",
    "Rounded high-top",
    "Caesar fringe",
    "Short twists",
    "Nape knot",
    "Flow cut",
    "Braided rows",
    "Textured mohawk",
    "Coiled fringe",
  ],
};

// All drafting distances are millimetres on the editor's one-metre foundation.
const pi = Math.PI,
  tau = pi * 2;
const mix = T.MathUtils.lerp;
const ease = (x, lo, hi) => T.MathUtils.smoothstep(x, lo, hi);
const vec = (x, y, z) => new T.Vector3(x, y, z);
const forward = vec(0, 0, 1),
  up = vec(0, 1, 0);
const radial = (a) => vec(Math.sin(a), 0, Math.cos(a));
const azimuth = (a) => vec(Math.cos(a), 0, -Math.sin(a));
const noise = (i) => Math.sin(i * 19.371 + 4.891);
const cross = (a, b) => new T.Vector3().crossVectors(a, b);
const cache = new Map();

export class Sculpture {
  positions = [];
  colors = [];
  triangles = [];

  vertex(point, value) {
    const index = this.positions.length / 3;
    this.positions.push(point.x * 0.001, point.y * 0.001, point.z * 0.001);
    this.colors.push(value, value, value);
    return index;
  }

  // Each cross section has a stable cyclic ordering. Close the end loops so
  // a turned head and a low camera can both see the underside of a lock.
  shell(rows, sides, sample, ends, reverse = false) {
    const start = this.positions.length / 3;
    const tri = (a, b, c) => {
      if (reverse) this.triangles.push(a, c, b);
      else this.triangles.push(a, b, c);
    };
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j < sides; j++) {
        this.vertex(...sample(i / rows, j / sides));
        if (i === 0) continue;
        const a = start + (i - 1) * sides + j;
        const b = start + (i - 1) * sides + ((j + 1) % sides);
        tri(a, b, b + sides);
        tri(a, b + sides, a + sides);
      }
    }
    for (const end of [0, 1]) {
      if (!ends) {
        const loop = start + end * rows * sides;
        for (let j = 1; j < sides / 2; j++) {
          const a = loop + j - 1,
            b = loop + j;
          const c = loop + sides - j - 1,
            d = loop + sides - j;
          if (end) {
            tri(a, b, c);
            tri(a, c, d);
          } else {
            tri(a, c, b);
            tri(a, d, c);
          }
        }
        continue;
      }
      const cap = this.vertex(ends[end], 0.76);
      const loop = start + end * rows * sides;
      for (let j = 0; j < sides; j++) {
        const a = loop + j,
          b = loop + ((j + 1) % sides);
        if (end) tri(cap, a, b);
        else tri(cap, b, a);
      }
    }
  }

  lock(
    points,
    width,
    depth,
    {
      normal,
      length = 24,
      sides = 14,
      tip = 0.65,
      root = 0.18,
      tint = 1,
      startWidth = 0.06,
      endWidth = 0.012,
      underside = 0,
    } = {},
  ) {
    const curve = new T.CatmullRomCurve3(points, false, "centripetal");
    const frames = Array.from({ length: length + 1 }, (_, i) => {
      const t = i / length,
        p = curve.getPoint(t),
        tang = curve.getTangent(t);
      let out = typeof normal === "function" ? normal(p, t) : normal;
      if (!out) out = vec(p.x, (p.y - 941) * 0.9, p.z + 5).normalize();
      let across = cross(out, tang);
      if (across.lengthSq() < 0.0001) across = cross(vec(1, 0, 0), tang);
      across.normalize();
      return { p, across, out: cross(tang, across).normalize() };
    });
    this.shell(
      length,
      sides,
      (t, u) => {
        const f = frames[Math.round(t * length)],
          a = tau * u;
        const envelope =
          mix(startWidth, 1, ease(t, 0, root) ** 0.55) *
          mix(1, endWidth, ease(t, tip, 1) ** 1.15);
        const groove = 0.94 + 0.06 * Math.cos(3 * a + 0.6 * t);
        const w = typeof width === "function" ? width(t) : width;
        const h = typeof depth === "function" ? depth(t) : depth;
        const height =
          h * envelope * groove * Math.sin(a) -
          underside *
            Math.min(1, 2.8 * envelope) *
            Math.max(0, -Math.sin(a)) ** 1.2;
        const p = f.p
          .clone()
          .addScaledVector(f.across, w * envelope * Math.cos(a))
          .addScaledVector(f.out, height);
        return [p, tint * (0.9 + groove * 0.08 + 0.047 * Math.sin(a))];
      },
      [points[0], points.at(-1)],
    );
  }

  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.triangles);
    g.computeVertexNormals();
    return g;
  }
}

function groom(female, index) {
  const sex = female ? "female" : "male",
    source = groomScalp(sex);
  const model = new Sculpture();
  // Relief carries one broad highlight per course of hair. It fades into the
  // shared roots at the temple and nape, where the crests naturally taper.
  let volume = 5,
    ribs = 13,
    bend = 0.55,
    ripple = 1.2;
  let relief = () => 0;
  let fringe = 0,
    texture = 0,
    flatTop = false;
  function crown(a, t) {
    const front = ease(Math.cos(a), 0.45, 0.92);
    const line =
      (female ? 5.5 : 3.5) +
      1.45 * Math.cos(3 * a + 0.4) +
      0.8 * Math.cos(8 * a - 0.7);
    const hem = source.hairline(a) - 0.001 * (line + fringe) * front;
    const y = mix(hem, source.top, Math.cos(0.5 * pi * t));
    const s = source.sample(a, y);
    const crest = ease(t, 0.035, 0.24);
    const turn = a + bend * (1 - t) ** 1.6 + 0.065 * Math.sin(2 * a + 3.7 * t);
    const phase = ribs * turn;
    const flute =
      crest * (0.72 * Math.cos(phase) + 0.18 * Math.cos(2 * phase + 0.4));
    const edge = 1 - ease(t, 0.8, 1.0);
    const wave =
      Math.sin(15 * a + 5.5 * Math.sin(6.4 * t) + 2 * t) *
        Math.sin(23 * t + 1.4 * Math.cos(9 * a)) +
      0.62 * Math.sin(27 * a - 19 * t + 0.9 * Math.cos(7 * a));
    const textureHeight = texture * crest * wave;
    const offset =
      0.4 +
      edge * (volume * (1 - 0.36 * t) + ripple * flute + relief(a, t)) +
      textureHeight * (1 - ease(t, 0.91, 1));
    const projection = mix(Math.max(1.35, offset), -0.82, ease(t, 0.965, 1));
    const p = s.p.multiplyScalar(1000).addScaledVector(s.n, projection);
    if (flatTop) {
      const smoothSide = 1 - ease(t, 0.5, 0.83);
      p.x *= 1 + 0.23 * smoothSide;
      p.z = -5 + (p.z + 5) * (1 + 0.22 * smoothSide);
      p.y +=
        16.4 * smoothSide +
        (1000 * source.top - p.y) * 0.84 * (1 - ease(t, 0.42, 0.67));
    }
    return {
      p,
      n: s.n,
      shade:
        0.86 + edge * 0.082 + flute * ripple * 0.033 + 0.032 * textureHeight,
    };
  }
  function cap() {
    const pole = crown(0, 0).p;
    model.shell(
      36,
      144,
      (lat, lon) => {
        const q = crown(tau * lon, mix(0.002, 0.999, lat));
        return [q.p, q.shade];
      },
      [pole, vec(0, 940, -5)],
      true,
    );
  }
  function surfacePoint(a, t, offset = 0) {
    const clamped = Math.min(1, t),
      q = crown(a, clamped);
    q.p.addScaledVector(q.n, offset);
    // Below the fringe the same follicle direction rolls away from the brow.
    if (t > 1) {
      q.p.y -= (t - 1) * 75;
      q.p.addScaledVector(radial(a), 0.8 + 2 * (t - 1));
    }
    return q.p;
  }
  function ribbon(a, start, end, sweep, w, h, opts = {}) {
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const theta =
        a + sweep * (1 - ease(u, 0, 1)) + (opts.wave || 0) * Math.sin(pi * u);
      const raise = (opts.lift || 0) * Math.sin(pi * u);
      points.push(surfacePoint(theta, mix(start, end, u), raise));
    }
    model.lock(points, w, h, { underside: 4.2, ...opts });
  }
  function sidePart(sign, amount, length, width, crest = 0) {
    for (let i = 0; i < 8; i++) {
      const a = sign * mix(-1.55, 1.08, i / 7);
      ribbon(
        a,
        0.11 + 0.035 * (i % 3),
        length + 0.045 * noise(i),
        sign * (amount + 0.12 * Math.cos(a)),
        width,
        3.5,
        {
          lift: crest * (1 - 0.4 * Math.abs(a)),
          wave: 0.12 * sign,
          tint: 0.98 + 0.035 * noise(i),
        },
      );
    }
  }
  function partedFace(count, end = 1.13, width = 7, wave = 0.06) {
    for (const sign of [-1, 1])
      for (let i = 0; i < count; i++) {
        const theta = sign * (0.52 + i * 0.2);
        ribbon(
          theta,
          0.1 + i * 0.045,
          end + i * 0.022,
          -sign * (0.72 + 0.038 * i),
          width,
          3.5,
          { wave: sign * wave, tint: 1.02 - 0.045 * (i % 2) },
        );
      }
  }
  function textureCoil(point, normal, span, width, phase = 0) {
    let w = cross(up, normal);
    if (w.lengthSq() < 0.02) w = cross(forward, normal);
    w.normalize();
    const h = cross(normal, w).normalize(),
      points = [];
    for (let j = 0; j <= 11; j++) {
      const t = j / 11,
        a = phase + 1.65 * pi * t,
        r = span * (1 - 0.39 * t);
      points.push(
        point
          .clone()
          .addScaledVector(w, Math.cos(a) * r)
          .addScaledVector(h, Math.sin(a) * r * 0.87)
          .addScaledVector(normal, -0.65 + 1.8 * Math.sin(pi * t)),
      );
    }
    model.lock(points, width, width * 0.82, {
      normal,
      length: 14,
      sides: 9,
      root: 0.16,
      tip: 0.75,
      underside: 4.2,
      tint: 0.97 + 0.03 * Math.cos(phase),
    });
  }
  function coils(lower, count, span, fiber, onlyFront = false) {
    for (let k = 0; k < count.length; k++)
      for (let j = 0; j < count[k]; j++) {
        const angle =
          (tau * (j + (k % 2) * 0.5 + 0.11 * noise(j + k))) / count[k];
        if (onlyFront && Math.cos(angle) < -0.1) continue;
        const t =
          mix(0.15, lower, k / (count.length - 1)) + 0.015 * noise(13 * k + j);
        const q = crown(angle, t);
        textureCoil(
          q.p,
          q.n,
          span * (1 + 0.1 * noise(j + k)),
          fiber,
          angle + 1.2 * k,
        );
      }
  }

  function bun(center, size, coilsOnSurface) {
    function sample(t, a) {
      const p = pi * t,
        sp = Math.sin(p),
        h = Math.cos(p);
      const n = vec(sp * Math.sin(a), h, sp * Math.cos(a));
      const flutes = coilsOnSurface
        ? sp *
          (0.055 * Math.sin(9 * a + 8 * p) + 0.04 * Math.sin(5 * a - 11 * p))
        : 0.044 * Math.cos(6 * a - 4.1 * p) * sp;
      const point = center
        .clone()
        .add(
          vec(n.x * size.x, n.y * size.y, n.z * size.z).multiplyScalar(
            1 + flutes,
          ),
        );
      return { p: point, n, tint: 0.96 + 0.52 * flutes };
    }
    model.shell(
      26,
      64,
      (t, u) => {
        const q = sample(mix(0.003, 0.997, t), u * tau);
        return [q.p, q.tint];
      },
      [
        center.clone().add(vec(0, size.y, 0)),
        center.clone().add(vec(0, -size.y, 0)),
      ],
      true,
    );
    if (coilsOnSurface)
      for (let k = 0; k < 4; k++)
        for (let j = 0; j < 8; j++) {
          const a = (tau * (j + 0.43 * k)) / 8,
            q = sample(0.16 + 0.212 * k, a);
          textureCoil(q.p, q.n, 2.8 + 0.55 * Math.cos(a), 1.9, a + k);
        }
    if (!coilsOnSurface) {
      const path = [];
      for (let j = 0; j <= 46; j++) {
        const u = j / 46,
          a = pi * (0.35 + 3.4 * u),
          r = 0.96 - 0.84 * u;
        const x = r * Math.cos(a),
          y = r * Math.sin(a);
        path.push(
          center
            .clone()
            .add(vec(size.x * x, size.y * y, -size.z * Math.sqrt(1 - r * r))),
        );
      }
      model.lock(path, 4.4, 3.0, {
        normal: vec(0, 0, -1),
        length: 58,
        underside: 2.7,
        tip: 0.8,
      });
    }
  }

  // A continuous double-sided mass supports the hanging locks. Cross
  // sections follow a horseshoe around the neck; the tips turn back under.
  function curtain(frontAngle, hem, flare, wave, tier) {
    const count = 92;
    function outside(a, u) {
      const angle =
        a + wave * 0.085 * Math.sin(tau * u + 1.4 * a) * ease(u, 0, 0.6);
      const level =
        hem +
        4 * Math.cos(4 * a + 0.4) +
        6 * Math.cos(a) +
        1.3 * Math.cos(17 * a);
      const y = mix(991, level, u);
      const hairline = source.hairline(angle) * 1000,
        top = source.top * 1000;
      const guideY = Math.max(944 + 4 * Math.cos(a), y);
      const lat =
        (2 / pi) *
        Math.acos(
          T.MathUtils.clamp((guideY - hairline) / (top - hairline), 0, 1),
        );
      const q = crown(angle, lat);
      const anchor = q.p;
      const t = ease(u, 0.04, 0.45);
      const front = Math.max(0, Math.cos(a));
      const spread =
        flare * Math.sin(pi * u * 0.9) +
        2 +
        wave *
          (2.9 * Math.sin(u * tau * 1.3 + 2.4 * a) +
            2 * Math.cos(14 * a + u * 5));
      const bend = 1.6 * Math.cos(18 * a + 1.35 * Math.sin(u * pi));
      anchor.addScaledVector(radial(angle), -1.7 + (spread + bend) * t);
      anchor.y = y;
      anchor.z += front * 7.5 * ease(u, 0.53, 1);
      return anchor;
    }
    const points = [];
    // Rounded outer, inner and hem geometry have deterministic vertex
    // correspondence so they keep a clean edge under a head turn.
    for (let i = 0; i <= 28; i++) {
      const row = [];
      for (let j = 0; j < count; j++) {
        const u = i / 28,
          a = mix(frontAngle, tau - frontAngle, j / (count - 1));
        const p = outside(a, u);
        row.push({ a, p, shade: 0.94 + 0.06 * Math.cos(14 * a + u * 4) });
      }
      points.push(row);
    }
    model.shell(
      28,
      count * 2,
      (u, v) => {
        const j = Math.round(v * count * 2);
        const back = j >= count,
          k = back ? 2 * count - 1 - j : j;
        const q = points[Math.round(u * 28)][k],
          p = q.p.clone();
        if (back) {
          p.addScaledVector(radial(q.a), -mix(2.1, 1.35, ease(u, 0.89, 1)));
          p.y += 0.9;
        }
        return [p, back ? 0.73 : q.shade];
      },
      null,
      true,
    );
    for (let k = 0; k < tier; k++) {
      const a = mix(
        frontAngle + 0.045,
        tau - frontAngle - 0.045,
        k / Math.max(1, tier - 1),
      );
      const points = [];
      for (let j = 0; j <= 12; j++) {
        const t = j / 12,
          theta = a + 0.095 * Math.sin(t * tau + 1.6 * a) * wave;
        const u = mix(0.19 + 0.045 * (k % 3), 0.96 + 0.04 * noise(k), t);
        points.push(
          outside(theta, u).addScaledVector(
            radial(theta),
            1.1 + 2.4 * Math.sin(pi * t),
          ),
        );
      }
      model.lock(points, 9.5, 3.4, {
        normal: radial(a),
        underside: 4.7,
        tint: 0.95 + 0.048 * noise(k),
        tip: 0.5,
      });
    }
  }

  function plait(points, breadth, pitch, outward, tipSize = 0.2) {
    const curve = new T.CatmullRomCurve3(points),
      strands = [[], [], []];
    const steps = Math.ceil(pitch * 18);
    for (let j = 0; j <= steps; j++) {
      const t = j / steps,
        p = curve.getPoint(t);
      const n = typeof outward === "function" ? outward(p, t) : outward;
      const tangent = curve.getTangent(t),
        across = cross(n, tangent).normalize(),
        out = cross(tangent, across).normalize();
      const size = breadth * mix(1, tipSize, ease(t, 0.05, 1));
      for (let k = 0; k < 3; k++) {
        const phase = tau * (pitch * t + k / 3);
        strands[k].push(
          p
            .clone()
            .addScaledVector(across, size * 0.54 * Math.sin(phase))
            .addScaledVector(out, size * 0.21 * Math.sin(phase * 2)),
        );
      }
    }
    // A plait consists of three uninterrupted paths. The width of the paths
    // follows the same taper as their interlacing, down to the tie.
    for (const [k, strand] of strands.entries()) {
      const radius = (t) => breadth * mix(1, tipSize, ease(t, 0.05, 1));
      model.lock(
        strand,
        (t) => 0.54 * radius(t),
        (t) => 0.4 * radius(t),
        {
          normal: outward,
          length: pitch * 18,
          sides: 10,
          startWidth: 1,
          endWidth: 1,
          tint: 0.92 + 0.05 * k,
        },
      );
    }
  }

  // A longitude traced over the crown, from the hairline to the nape.
  function sagittal(x, arch, extra = 0) {
    const c = Math.cos(x);
    const direction = vec(Math.sin(x), c * Math.cos(arch), c * Math.sin(arch));
    const a = Math.atan2(direction.x, direction.z),
      polar = Math.acos(direction.y);
    const hem = source.hairline(a) * 1000;
    const h = Math.max(hem, 941 + (source.top * 1000 - 941) * Math.cos(polar));
    const t =
      (2 / pi) *
      Math.acos(T.MathUtils.clamp((h - hem) / (1000 * source.top - hem), 0, 1));
    return surfacePoint(a, t, extra);
  }

  function quiff() {
    for (let k = 0; k < 9; k++) {
      const x = (k - 4) * 0.13,
        points = [];
      for (let j = 0; j <= 15; j++) {
        const u = j / 15,
          w = 1 - Math.abs(x);
        const q = sagittal(
          x - 0.22 * Math.sin(pi * u),
          mix(1.29, -1.13, u),
          0.55 + 3.3 * Math.sin(pi * u),
        );
        q.y += 11.5 * w * Math.sin(pi * u) ** 1.2;
        q.z += 7 * w * Math.sin(pi * u) * (1 - u);
        points.push(q);
      }
      model.lock(points, 8.1, 5.1, {
        tip: 0.46,
        underside: 18.0,
        tint: 0.96 + 0.037 * noise(k),
      });
    }
  }

  function twistedCrop() {
    for (let ring = 0; ring < 4; ring++) {
      const count = [5, 9, 13, 16][ring];
      for (let i = 0; i < count; i++) {
        const a = (tau * (i + ring * 0.45)) / count;
        const start = 0.12 + 0.16 * ring + 0.018 * noise(i + ring);
        const end = start + 0.31 + 0.06 * Math.cos(a);
        const paths = [[], []],
          centers = [];
        for (let j = 0; j <= 22; j++) {
          const u = j / 22;
          const theta = a + 0.27 * u + 0.055 * Math.sin(pi * u + ring);
          const q = crown(theta, mix(start, end, u));
          const out = 1.4 + 4.9 * Math.sin(pi * u) + 1.5 * u;
          centers.push(q.p.clone().addScaledVector(q.n, out));
          const across = azimuth(theta),
            angle = u * tau * 1.55 + i;
          for (let k = 0; k < 2; k++) {
            const phase = angle + k * pi;
            paths[k].push(
              centers[j]
                .clone()
                .addScaledVector(across, 1.86 * Math.cos(phase))
                .addScaledVector(q.n, 1.15 * Math.sin(phase)),
            );
          }
        }
        for (const [side, path] of paths.entries()) {
          model.lock(path, 2.65, 2.24, {
            length: 22,
            sides: 10,
            tip: 0.9,
            endWidth: 0.36,
            underside: 4.8,
            tint: 0.94 + side * 0.06 + 0.02 * noise(i),
          });
        }
      }
    }
  }
  function mohawk() {
    // One narrow swept crest follows the sagittal line, with its width and
    // height falling away at the hairline and nape. The clipped sides and
    // the longer centre share their boundary through every head pose.
    function section(a, t) {
      const edge = source.hairline(a) - 0.0014;
      const y = mix(edge, source.top, Math.cos(t * pi / 2));
      const { p, n } = source.sample(a, y);
      p.multiplyScalar(1000);
      const x = p.x, arch = Math.atan2(p.z + 5, p.y - 941);
      const u = T.MathUtils.clamp((1.30 - arch) / 3.77, 0, 1);
      const ends = ease(u, 0, 0.115) * (1 - ease(u, 0.75, 1));
      const ridgeX = 1.3 * Math.sin(13 * u) + 0.8 * Math.sin(30 * u);
      const width = mix(7.2, 15.6, ends) * (1 - 0.23 * ease(u, 0.42, 1));
      const lateral = Math.abs(x - ridgeX) / width;
      const profile = Math.max(0, 1 - lateral * lateral) ** 1.8;
      const course = 2 * pi * (8.9 * u + 0.82 * lateral - 0.10 * Math.sin(17 * u));
      const comb = 0.5 + 0.5 * Math.cos(course);
      const height = ends * profile * (14.7 + 13 * Math.exp(-(((u - 0.27) / 0.32) ** 2))
        + 8.3 * (comb ** 1.5 - 0.38));
      const topNormal = vec(0, n.y, n.z).normalize();
      const back = vec(0, topNormal.z, -topNormal.y);
      const stubble = Math.sin(195 * a + 122 * t) * Math.sin(130 * t - 53 * a);
      p.addScaledVector(n, mix(1.9 + 0.15 * stubble, -0.85, ease(t, 0.96, 1)))
        .addScaledVector(topNormal, height)
        .addScaledVector(back, height * (0.49 + 0.07 * comb));
      p.x += Math.sign(x - ridgeX) * Math.sin(pi * Math.min(1, lateral))
        * ends * (1.8 * Math.cos(course) + 0.27 * Math.cos(3 * course));
      return [p, 0.86 + 0.14 * comb * profile + 0.018 * stubble * (1 - profile) * ease(t, 0.03, 0.18)];
    }
    model.shell(66, 192, (t, u) => section(tau * u, mix(0.002, 1, t)),
      [section(0, 0)[0], vec(0, 935, -5)], true);
  }
  if (female) {
    switch (index) {
      case 0:
        volume = 4;
        bend = 1.05;
        cap();
        sidePart(1, 1.0, 1.12, 8.2);
        for (let k = 0; k < 10; k++)
          ribbon(1.32 + k * 0.38, 0.38, 1.02, -0.4, 6.5, 2.8, { tip: 0.5 });
        break;
      case 1:
        volume = 15.5;
        ribs = 12;
        ripple = 1.9;
        texture = 3.1;
        fringe = 2.8;
        relief = (a, t) =>
          5 * Math.sin(pi * t) +
          2.8 * Math.sin(5 * a + 7 * t) * Math.sin(pi * t);
        cap();
        coils(0.93, [5, 11, 17, 22, 25, 27], 6.2, 3.6);
        break;
      case 2:
        volume = 3.6;
        bend = 0.15;
        cap();
        for (const s of [-1, 1]) {
          bun(vec(s * 47, 988, -40), vec(25, 27, 24), true);
          ribbon(s * 0.78, 0.15, 1.23, -s * 0.55, 5.7, 2.7);
        }
        break;
      case 3:
        volume = 6.3;
        cap();
        curtain(0.78, 824, 11.5, 1.05, 16);
        partedFace(4, 1.16, 8.0, 0.14);
        break;
      case 4: {
        volume = 4.4;
        bend = 0.84;
        ribs = 15;
        cap();
        const ring = [];
        for (let j = 0; j <= 100; j++) {
          const a = (tau * j) / 100;
          ring.push(surfacePoint(a, 0.55 + 0.075 * Math.cos(a), 4.6));
        }
        plait(
          ring,
          7.8,
          13,
          (p) => vec(p.x, p.y - 944, p.z + 5).normalize(),
          1,
        );
        bun(vec(0, 914, -63), vec(19, 14, 14), false);
        break;
      }
      case 5:
        volume = 5.4;
        ribs = 6;
        ripple = 0.24;
        fringe = 2.4;
        relief = (a, t) =>
          3.8 *
          Math.cos(6.4 * pi * t + 2.35 * Math.sin(2 * a - 0.5)) *
          Math.sin(pi * t);
        cap();
        for (let j = 0; j < 3; j++) {
          const pts = [];
          for (let k = 0; k <= 20; k++) {
            const u = k / 20,
              a = mix(-1.91, 1.19, u) + 0.19 * j;
            pts.push(
              surfacePoint(
                a,
                0.37 + 0.178 * j + 0.11 * Math.sin(2 * a - 0.4),
                1.15,
              ),
            );
          }
          model.lock(pts, 5.1, 2.75, {
            underside: 5.2,
            tint: 0.99 + 0.025 * noise(j),
          });
        }
        break;
      case 6: {
        volume = 4.7;
        bend = -0.95;
        cap();
        sidePart(-1, 0.87, 0.99, 7.4);
        const tail = [
          [-30, 930, -44],
          [-49, 918, -35],
          [-56, 896, -21],
          [-59, 876, -4],
          [-61, 854, 10],
          [-60, 837, 19],
          [-60, 826, 20],
        ].map((p) => vec(...p));
        plait(tail, 15.5, 5, vec(-0.36, 0, 0.93).normalize(), 0.42);
        model.lock(
          [
            tail.at(-1).clone().addScaledVector(up, 4),
            vec(-60, 818, 20),
            vec(-55, 805, 23),
          ],
          6.3,
          4.7,
          { normal: forward },
        );
        break;
      }
      case 7:
        volume = 5.6;
        fringe = 14;
        cap();
        curtain(0.76, 855, 5.2, 0.14, 12);
        for (let j = 0; j < 9; j++)
          ribbon(
            mix(-0.81, 0.81, j / 8),
            0.25,
            1.025 + 0.021 * noise(j),
            -0.17,
            7.3,
            2.5,
            { tip: 0.75, endWidth: 0.14 },
          );
        break;
      case 8:
        volume = 4.8;
        cap();
        curtain(1.14, 837, 6.2, 0.5, 13);
        partedFace(3, 1.08, 7.0);
        bun(vec(0, 974, -61), vec(19, 17, 17), false);
        break;
      case 9:
        volume = 5;
        cap();
        for (const s of [-1, 1]) {
          const pts = [
            [47, 950, 30],
            [49, 967, 33],
            [44, 984, 35],
            [36, 999, 38],
            [25, 1007, 39],
            [15, 1006, 41],
            [10, 998, 45],
            [11, 989, 48],
            [21, 984, 49],
            [28, 990, 47],
            [26, 996, 44],
            [21, 997, 42],
          ].map(([x, y, z]) => vec(s * x, y + (s < 0 ? 2 : 0), z));
          model.lock(pts, 9.4, 8.9, { normal: forward, root: 0.16, tip: 0.84 });
        }
        curtain(1.7, 879, 4.7, 0.45, 8);
        break;
    }
  } else {
    switch (index) {
      case 0:
        volume = 3.0;
        bend = 0.92;
        cap();
        sidePart(-1, 0.97, 0.9, 7.4, 2.0);
        break;
      case 1:
        volume = 4.2;
        cap();
        quiff();
        break;
      case 2:
        volume = 3.3;
        ripple = 0.4;
        texture = 2;
        flatTop = true;
        cap();
        coils(0.75, [4, 9, 15, 19, 23], 3.75, 2.3);
        break;
      case 3:
        volume = 4.4;
        ribs = 16;
        bend = 0.18;
        fringe = 9.6;
        cap();
        for (let j = 0; j < 8; j++)
          ribbon(
            mix(-0.88, 0.88, j / 7),
            0.17,
            1.05 + 0.027 * noise(j),
            0.26,
            7.6,
            3.1,
            { tip: 0.8, endWidth: 0.11, tint: 0.95 + 0.04 * noise(j) },
          );
        break;
      case 4:
        volume = 7.8;
        ripple = 0.6;
        texture = 1.3;
        cap();
        twistedCrop();
        break;
      case 5:
        volume = 3.6;
        ribs = 17;
        bend = -0.68;
        cap();
        bun(vec(0, 924, -66), vec(21, 18, 20), false);
        for (let i = 0; i < 7; i++)
          ribbon(1.4 + i * 0.52, 0.18, 0.98, 0.65, 4.9, 2.15);
        break;
      case 6:
        volume = 5.2;
        cap();
        curtain(1.02, 882, 6.5, 0.85, 13);
        partedFace(4, 1.12, 7.7, 0.16);
        break;
      case 7:
        volume = 2.6;
        ribs = 17;
        ripple = 0.3;
        cap();
        for (let i = -3; i <= 3; i++) {
          const path = [];
          for (let j = 0; j <= 56; j++) {
            const u = j / 56;
            path.push(
              sagittal(
                i * 0.212 + 0.045 * Math.sin(u * tau + i),
                mix(1.25, -2.36, u),
                2.05,
              ),
            );
          }
          plait(
            path,
            4.4,
            9,
            (p) => vec(p.x, p.y - 941, p.z + 5).normalize(),
            0.72,
          );
        }
        break;
      case 8:
        mohawk();
        break;
      case 9:
        volume = 6.5;
        ripple = 1.1;
        texture = 1.65;
        fringe = 4.2;
        relief = (a, t) =>
          7.5 * ease(Math.cos(a), -0.35, 0.8) * Math.sin(pi * t);
        cap();
        coils(0.98, [4, 10, 16, 20, 21], 5.1, 3.2, true);
        for (let i = 0; i < 7; i++) {
          const a = mix(-0.85, 0.85, i / 6),
            q = crown(a, 0.93);
          textureCoil(
            q.p.addScaledVector(q.n, 1.9).addScaledVector(up, -4.0),
            q.n,
            5.0,
            3.1,
            i * 0.58,
          );
        }
        break;
    }
  }
  return model.geometry();
}

export function addStudioHair(female, index, color, material, add, skin) {
  const gender = female ? "female" : "male";
  const name = newHairNames[gender][index];
  if (!name) return;
  const key = gender + "/" + index;
  if (!cache.has(key)) cache.set(key, groom(female, index));
  const roughness = (female ? [1, 2] : [2, 4, 9]).includes(index) ? 0.67 : 0.53;
  const geometry = cache.get(key).clone();
  const clipped = !female && index === 8 && skin;
  if (clipped) {
    const p = geometry.attributes.position, c = geometry.attributes.color, tint = new T.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const side = ease(Math.abs(x), 0.0095, 0.021);
      const grain = 0.94 + 0.06 * Math.sin(x * 19341 + y * 7252 + z * 17319);
      const skinMix = side * (0.25 + 0.38 * (1 - ease(y, 0.92, 0.99))) * grain;
      tint.copy(color).lerp(skin, skinMix).multiplyScalar(c.getX(i));
      c.setXYZ(i, tint.r, tint.g, tint.b);
    }
  }
  add(
    "Hair / " + name,
    geometry,
    material(clipped ? "white" : color, true, { roughness: clipped ? 0.72 : roughness }),
  );
}
