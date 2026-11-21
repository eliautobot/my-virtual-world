// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import {
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  Vector3,
} from "three";

// Span is relative to the mouth. Thickness, projection and the drop of a
// connected tail (or lift of a pointed tip) use normalized-head millimetres.
const cuts = {
  "Short boxed beard": { span: 1.38, thick: 6.0, lift: 1.95, drop: 7.8 },
  "Rounded full beard": {
    span: 1.54,
    thick: 10.8,
    lift: 4.5,
    drop: 8.6,
    wing: 4.5,
    crown: 13.3,
    arch: 1.1,
  },
  "Ducktail beard": {
    span: 1.52,
    thick: 10.2,
    lift: 4.3,
    drop: 8.1,
    wing: 4.0,
    crown: 12.6,
    arch: 1.9,
  },
  "Square full beard": {
    span: 1.58,
    thick: 11.5,
    lift: 4.9,
    drop: 7.1,
    wing: 5.1,
    crown: 14.0,
    arch: 0.65,
  },
  "Classic goatee": { span: 1.24, thick: 5.2, lift: 1.85, drop: 8.8 },
  "Balbo beard": { span: 1.03, thick: 5.3, lift: 2.1, tip: 0.75 },
  "Anchor beard": { span: 0.95, thick: 3.2, lift: 1.2, tip: 1.0 },
  "Forked beard": {
    span: 1.57,
    thick: 11.1,
    lift: 4.75,
    drop: 9.0,
    wing: 4.9,
    crown: 13.8,
    arch: 1.6,
  },
  "Faded stubble": {
    span: 1.32,
    thick: 5.5,
    lift: 0.25,
    drop: 6.8,
    stubble: true,
  },
};
const smooth = (a, b, x) => MathUtils.smoothstep(x, a, b);
const bell = (x) => Math.exp(-x * x);
const columns = 132,
  rows = 18;

export function detailMoustacheFullness(beardName) {
  return cuts[beardName]?.wing ? 1.65 : 1.18;
}

export function addBeardUpper({
  name,
  lip,
  mouthY,
  skin,
  tint,
  depth,
  noseDepth,
  add,
  mat,
}) {
  const cut = cuts[name];
  if (!cut) return;
  const halfWidth = lip?.halfWidth ?? 0.0182;
  const upperAt =
    lip?.upperAt ??
    ((x) => mouthY + 0.0014 + 0.0033 * Math.max(0, 1 - (x / halfWidth) ** 2));
  const span = halfWidth * cut.span;

  function section(u) {
    const x = u * span,
      a = Math.abs(u),
      mouthFraction = Math.abs(x) / halfWidth;
    const border = upperAt(x);
    // Bridge the small central dip between the two peaks of the Cupid's bow.
    const envelope = Math.max(
      border,
      0.45 * upperAt(x - 0.0018) + 0.1 * border + 0.45 * upperAt(x + 0.0018),
    );
    const corner = upperAt(Math.sign(u) * halfWidth);
    let lower = envelope + 0.00044;
    if (cut.drop) {
      const turn = smooth(0.87, cut.span, mouthFraction);
      lower = MathUtils.lerp(lower, corner - cut.drop * 0.001, turn);
      if (mouthFraction <= 1) lower = Math.max(lower, border + 0.00032);
    } else {
      lower += cut.tip * 0.001 * smooth(0.55, 1, a);
    }
    const part = 1 - (cut.wing ? 0.1 : 0.26) * bell(u / 0.085);
    const taper = 1 - smooth(cut.drop ? 0.78 : 0.59, 1, a);
    let height =
      0.001 *
      cut.thick *
      part *
      (0.77 + 0.25 * bell((a - 0.35) / 0.35)) *
      (cut.drop ? 0.32 + 0.68 * taper : 0.035 + 0.965 * taper);
    // Long cuts keep mass through the sides of the moustache. The wings
    // grow around the commissures and taper inside the cheek coat.
    if (cut.wing) {
      height += 0.001 * cut.wing * bell((a - 0.7) / 0.27);
      const crest =
        mouthY +
        0.001 *
          (cut.crown +
            cut.arch * bell((a - 0.35) / 0.27) -
            7.8 * smooth(0.4, 1, a));
      height = Math.min(height, Math.max(0.0002, crest - lower));
    }
    // Keep the philtrum roots under the particular nose selected. Sample
    // relief, so the buried flange on a wide nose does not trim the hair.
    if (noseDepth && Math.abs(x) < 0.015) {
      for (let y = lower; y < lower + height + 0.0007; y += 0.00035) {
        if (noseDepth(x, y) - depth(x, y) > 0.00145) {
          height = Math.min(height, Math.max(0.00012, y - lower - 0.00042));
          break;
        }
      }
    }
    return { lower, height };
  }
  const raw = Array.from({ length: columns + 1 }, (_, i) =>
    section((2 * i) / columns - 1),
  );
  const sections = raw.map(({ height, lower }, i) => {
    let ceiling = 0;
    for (let j = -4; j <= 4; j++) {
      const s = raw[MathUtils.clamp(i + j, 0, columns)];
      ceiling += ((s.height + s.lower) * (5 - Math.abs(j))) / 25;
    }
    return {
      lower,
      height: Math.max(0.00012, Math.min(height, ceiling - lower)),
    };
  });
  const positions = [],
    colors = [],
    indices = [],
    boundaries = [];
  const dye = tint.clone(),
    pigment = skin.clone(),
    surfaceNormal = new Vector3();
  function sample(u, v) {
    const f = MathUtils.clamp((u + 1) * 0.5 * columns, 0, columns);
    const i = Math.min(columns - 1, Math.floor(f)),
      t = f - i;
    const lower = MathUtils.lerp(sections[i].lower, sections[i + 1].lower, t);
    const height = MathUtils.lerp(
      sections[i].height,
      sections[i + 1].height,
      t,
    );
    const x = u * span,
      a = Math.abs(u);
    const grainPhase =
      (a + 0.2 * v - 0.055 * v * v + 0.019 * Math.sin(6 * a + v)) * Math.PI;
    const grain =
      0.53 * Math.cos(47 * grainPhase) +
      0.29 * Math.cos(83 * grainPhase) +
      0.18 * Math.cos(131 * grainPhase);
    const end = 1 - smooth(0.89, 1, a);
    const y = lower + height * v;
    const surface = depth(x, y, surfaceNormal);
    const fullness = (1 - (cut.wing ? 0.17 : 0.34) * bell(u / 0.064)) * end;
    const barrel = Math.sin(Math.PI * v) ** (cut.wing ? 0.62 : 0.85);
    const relief =
      0.001 *
      cut.lift *
      fullness *
      barrel *
      (1 + (cut.wing ? 0.1 : 0.15) * grain);
    const opacity =
      smooth(0, cut.wing ? 0.11 : 0.19, v) *
      (1 - smooth(cut.wing ? 0.84 : 0.7, 1, v)) *
      end *
      (1 - (cut.wing ? 0.17 : 0.4) * bell(u / 0.045)) *
      smooth(0.00012, 0.001, height);
    return { x, y, z: surface + 0.000085 + relief, grain, opacity, fullness };
  }
  function vertex(u, v, extra = 0, fiber = false) {
    const s = sample(u, v),
      index = positions.length / 3;
    positions.push(s.x, s.y, s.z + extra);
    const density = cut.stubble ? (fiber ? 0.91 : 0.25) : fiber ? 1 : 0.97;
    dye.copy(tint).multiplyScalar((fiber ? 1.16 : 0.94) + 0.2 * s.grain);
    pigment
      .copy(skin)
      .lerp(dye, Math.min(1, s.opacity * density * (fiber ? 1.35 : 1)));
    colors.push(pigment.r, pigment.g, pigment.b);
    if (!fiber && s.opacity < 0.65)
      boundaries.push([
        index,
        surfaceNormal.clone(),
        1 - smooth(0, 0.65, s.opacity),
      ]);
    return index;
  }
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      const end = vertex((2 * i) / columns - 1, j / rows);
      if (i && j) {
        const below = end - columns - 1;
        indices.push(below - 1, below, end, below - 1, end, end - 1);
      }
    }
  // Short tapered fibers comb down and out from the philtrum. The stubble
  // variant uses discrete follicles over a lightly shadowed skin surface.
  let seed = 128971;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const count = cut.stubble ? 1100 : 520;
  for (let i = 0; i < count; i++) {
    const u = (random() * 2 - 1) * 0.988,
      v = 0.14 + 0.79 * random();
    if (random() > sample(u, v).opacity) continue;
    const dir = Math.sign(u);
    const du = dir * (cut.stubble ? 0.006 : 0.023) * (0.55 + random());
    const dv = (cut.stubble ? 0.068 : 0.18) * (0.65 + random());
    const w = (cut.stubble ? 0.0025 : 0.0048) * (0.65 + 0.55 * random());
    const end = MathUtils.clamp(u + du, -0.994, 0.994);
    const base = vertex(u - w, v, 0.00007, true);
    vertex(u + w, v, 0.00007, true);
    vertex((u + end) / 2, v - dv * 0.43, cut.stubble ? 0.00018 : 0.00022, true);
    vertex(end, Math.max(0.025, v - dv), 0.00009, true);
    indices.push(
      base,
      base + 3,
      base + 2,
      base + 2,
      base + 3,
      base + 1,
      base,
      base + 2,
      base + 1,
    );
  }
  const g = new BufferGeometry();
  g.setIndex(indices);
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const normal = new Vector3(),
    attr = g.attributes.normal;
  for (const [index, n, blend] of boundaries) {
    normal.fromBufferAttribute(attr, index).lerp(n, blend).normalize();
    attr.setXYZ(index, normal.x, normal.y, normal.z);
  }
  add(
    "Beard / Moustache / " + name,
    g,
    mat("white", true, { roughness: 0.84 }),
  );
}
