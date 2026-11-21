// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as T from "three";
import { Sculpture } from "./hair-styles.js";

const pi = Math.PI,
  tau = 2 * pi;
const vec = (x, y, z) => new T.Vector3(x, y, z);
const sin = Math.sin,
  cos = Math.cos;
const cache = new Map();

function pattern(gender) {
  const f = gender === "female",
    cy = f ? 921 : 922.5,
    h = f ? 93.5 : 99,
    rx = f ? 64 : 66,
    rz = f ? 79 : 82;
  const shell = new Sculpture(),
    gasket = new Sculpture(),
    visor = new Sculpture();
  const trim = new Sculpture(),
    ear = new Sculpture(),
    lights = new Sculpture(),
    reflection = new Sculpture();
  function surface(t, a, offset = 0) {
    const s = sin(t),
      c = cos(t);
    // The chin section projects forward and the back clears the neck socket.
    const tilt = (1 - c) * 2.5,
      jaw = 1 - 0.105 * Math.max(0, -c);
    const p = vec(
      (rx + offset) * s * sin(a) * jaw,
      cy + (h + offset) * c,
      2 + tilt + (rz + offset) * s * cos(a) * (1 + (cos(a) > 0 ? 0.07 : 0)),
    );
    const n = vec((s * sin(a)) / rx, c / h, (s * cos(a)) / rz).normalize();
    return { p, n };
  }
  shell.shell(
    44,
    112,
    (v, u) => [surface(0.004 + (pi - 0.008) * v, tau * u).p, 0.985],
    [surface(0, 0).p, surface(pi, 0).p],
    true,
  );
  // A superellipse defines the visor opening. The layered closed lens, dark
  // compression seal and aluminum perimeter follow the compound shell curve.
  const belt = (a, b, p) => Math.sign(a) * Math.abs(a) ** p * b;
  function panel(radius, t, extra) {
    const x = belt(sin(t), f ? 1.085 : 1.11, 0.77) * radius;
    const y = belt(cos(t), 0.95, 0.84) * radius;
    const lat = 1.67 + y;
    const taper = 1 - 0.2 * Math.max(0, y);
    const q = surface(lat, x * taper);
    return q.p.addScaledVector(q.n, extra + 1.3 * (1 - radius * radius));
  }
  function disc(model, size, lift) {
    const p = panel(0.001, 0, lift);
    model.shell(
      22,
      100,
      (v, u) => [panel((0.001 + 0.999 * v) * size, tau * u, lift), 0.98],
      [p, vec(0, cy, 62)],
      true,
    );
  }
  disc(gasket, 1.06, 1.8);
  disc(visor, 1.0, 3.2);
  function ring(model, size, extra, width, depth) {
    const guides = [];
    for (let i = 0; i <= 100; i++)
      guides.push(panel(size, (tau * i) / 100, extra));
    model.lock(guides, width, depth, {
      length: 128,
      sides: 10,
      startWidth: 1,
      endWidth: 1,
      normal: (p) => vec(p.x, p.y - cy, p.z - 3).normalize(),
    });
  }
  ring(trim, 1.047, 2.4, 1.18, 0.77);
  ring(gasket, 0.997, 3.3, 0.76, 0.87);
  // A subdued surface reflection travels with the lens lighting and remains
  // readable even in an engine without an environment map.
  for (let stripe = 0; stripe < 2; stripe++) {
    const guides = [];
    for (let j = 0; j <= 15; j++) {
      const t = j / 15,
        q = surface(0.86 + 0.37 * t, -0.44 + 0.07 * t + stripe * 0.046, 4.4);
      guides.push(q.p);
    }
    reflection.lock(guides, stripe ? 0.62 : 1.45, 0.35, {
      normal: vec(-0.32, 0.45, 0.83).normalize(),
      root: 0.32,
      tip: 0.62,
      tint: stripe ? 0.56 : 0.8,
    });
  }
  for (const sign of [-1, 1]) {
    const center = vec(sign * (rx - 1), cy + 3, -5.2);
    function discAt(model, r, start, depth) {
      const front = vec(sign, 0, 0);
      const guide = (u, a) =>
        center
          .clone()
          .addScaledVector(front, start + depth * u)
          .add(
            vec(
              0,
              cos(a) * r * (0.955 + 0.045 * sin(pi * u)),
              sin(a) * r * (0.955 + 0.045 * sin(pi * u)),
            ),
          );
      model.shell(
        7,
        60,
        (u, a) => [guide(u, tau * a), 0.965],
        [
          center.clone().addScaledVector(front, start),
          center.clone().addScaledVector(front, start + depth),
        ],
        sign > 0,
      );
    }
    discAt(gasket, 22.5, -4.2, 6.4);
    discAt(trim, 21.5, 2.25, 2.3);
    discAt(ear, 18.7, 4.6, 2);
    discAt(lights, f ? 12.9 : 14.6, 6.6, 1);
    discAt(ear, 11.2, 7.65, 1.28);
    if (!f) {
      for (let j = 0; j < 3; j++) {
        const a = (j * tau) / 3 + pi * 0.36;
        const points = [4, 8, 14].map((r, i) =>
          center
            .clone()
            .add(vec(sign * (9 + i * 0.05), r * cos(a), r * sin(a))),
        );
        gasket.lock(points, 1.65, 0.63, {
          normal: vec(sign, 0, 0),
          root: 0.08,
          startWidth: 0.8,
          tip: 0.94,
          endWidth: 0.45,
        });
      }
    }
    const latch = [];
    for (let i = 0; i <= 16; i++) {
      const q = surface(0.55 + (1.92 * i) / 16, sign * (f ? 2.39 : 2.64), 0.3);
      latch.push(q.p);
    }
    trim.lock(latch, 1.0, 0.47, {
      normal: (p) => vec(p.x, p.y - cy, p.z).normalize(),
      root: 0.25,
      tip: 0.78,
      tint: 0.87,
    });
  }
  // The back ferrule is a stepped elastomer collar; its open top is enclosed
  // by the helmet. Its lower rim meets the upper edge of the armour suit.
  const bellows = new Sculpture();
  const low = f ? 795 : 813,
    high = f ? 847 : 861;
  const neckZ = f ? -12 : -16;
  bellows.shell(
    36,
    70,
    (t, a) => {
      const ring = 1.0 * Math.cos(t * 8 * pi),
        w = (f ? 36 : 40) - 2.1 * sin(pi * t) + ring;
      return [
        vec(
          w * sin(tau * a),
          low + (high - low) * t,
          neckZ + (w + 5) * cos(tau * a),
        ),
        0.85 + 0.075 * cos(t * 8 * pi),
      ];
    },
    [vec(0, low, neckZ), vec(0, high, neckZ)],
    false,
  );
  const pieces = [
    shell,
    gasket,
    visor,
    trim,
    ear,
    lights,
    reflection,
    bellows,
  ].map((m) => m.geometry());
  const neck = pieces.at(-1),
    points = neck.attributes.position;
  const joint = new Uint16Array(points.count * 4),
    weight = new Float32Array(points.count * 4);
  for (let i = 0; i < points.count; i++) {
    const t = T.MathUtils.clamp(
      (1000 * points.getY(i) - low) / (high - low),
      0,
      1,
    );
    const head = 0.13 + 0.71 * t,
      spine = (1 - t) * 0.57;
    joint.set([39, 38, 13, 0], 4 * i);
    weight.set([head, 1 - head - spine, spine, 0], 4 * i);
  }
  neck.setAttribute("skinIndex", new T.Uint16BufferAttribute(joint, 4));
  neck.setAttribute("skinWeight", new T.Float32BufferAttribute(weight, 4));
  return pieces;
}

export function androidHelmet(gender, style, color, material, add) {
  if (!cache.has(gender)) cache.set(gender, pattern(gender));
  const colors = [
    color,
    "#26282e",
    "#151a21",
    "#a7adb8",
    "#515666",
    "#3897ac",
    "#737b86",
    "#33343a",
  ];
  const names = [
    style.name,
    "visor seals",
    "smoked faceplate",
    "brushed trim",
    "ear receivers",
    "signal rings",
    "visor reflection",
    "articulated neck bellows",
  ];
  const rough = [0.44, 0.74, 0.21, 0.38, 0.53, 0.3, 0.21, 0.76],
    metal = [0.26, 0.03, 0.3, 0.42, 0.19, 0.17, 0.18, 0.03];
  cache
    .get(gender)
    .forEach((g, i) =>
      add(
        "Hair / " + names[i],
        g.clone(),
        material(colors[i], true, { roughness: rough[i], metalness: metal[i] }),
      ),
    );
}
