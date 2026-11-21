// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { Color, MathUtils, Vector3 } from "three";
import { extendedPortraits } from "./portrait-library.js";

// Each profile describes the vermilion outline in foundation bind space.
const original = {
  female: [
    [16.7, 3.2, 4.5, 1.7, 0.42, 0.3, 1.0],
    [18.4, 3.7, 3.8, 2.5, 0.78, 0.29, 1.05],
    [17.0, 4.4, 5.4, 0.85, 0.21, 0.34, 1.27],
  ],
  male: [
    [18.2, 3.0, 3.8, 1.5, 0.28, 0.34, 0.98],
    [19.5, 3.8, 3.9, 2.0, 0.67, 0.31, 1.05],
    [17.5, 4.2, 4.9, 0.65, 0.24, 0.38, 1.23],
  ],
};
// Soft outer slopes, lower-lip breadth and the central dip are independent
// of size. A broad lip can have a quiet upper arch or a sculpted double peak.
const contours = {
  female: [
    [0.23, 0.75, 0.8],
    [0.16, 0.87, 1.02],
    [0.32, 0.57, 0.36],
    [0.17, 1.05, 0.9],
    [0.25, 0.84, 0.56],
    [0.36, 0.6, 0.32],
    [0.16, 0.85, 1.1],
    [0.23, 0.76, 0.65],
    [0.35, 0.55, 0.3],
    [0.21, 1.04, 0.78],
    [0.32, 0.89, 0.35],
    [0.155, 0.78, 1.05],
    [0.31, 0.7, 0.52],
  ],
  male: [
    [0.3, 0.84, 0.5],
    [0.205, 0.88, 0.78],
    [0.34, 0.64, 0.44],
    [0.33, 0.62, 0.38],
    [0.24, 0.91, 0.56],
    [0.34, 1.03, 0.27],
    [0.26, 0.57, 0.62],
    [0.165, 0.86, 0.97],
    [0.28, 0.98, 0.44],
    [0.35, 0.53, 0.29],
    [0.26, 0.7, 0.48],
    [0.2, 0.96, 0.74],
    [0.33, 0.69, 0.38],
  ],
};
const bell = (x) => Math.exp(-x * x);
const smooth = (a, b, x) => MathUtils.smoothstep(x, a, b);
const rows = 28;
// Outer sculpt landmark used to fit facial hair around the whole lip roll.
export const lipBorderV = 18 / rows;
// The visible vermilion ends at the turn of each lip, inside that roll.
// Both borders fall on mesh edges so triangle interpolation stops there.
const pigmentBorder = (top) => (top ? 9 : 10) / rows;

export function sculptLips({
  gender,
  style,
  origin,
  fit = {},
  skin,
  dye,
  depth,
  meshGrid,
  mat,
  add,
}) {
  const female = gender === "female";
  let design = extendedPortraits[gender].mouth[style - 3];
  if (!design) {
    const [span, upper, lower, smile, bow, peaks, relief] =
      original[gender][style];
    design = {
      span: span / 1000,
      upper: upper / 1000,
      lower: lower / 1000,
      smile: smile / 1000,
      bow,
      peaks,
      relief,
    };
  }
  const width = design.span * (fit.width ?? 1);
  const height = fit.height ?? 1;
  const upper = (0.0013 + 1.24 * design.upper) * height * (fit.upper ?? 1);
  const lower = (0.00145 + 1.2 * design.lower) * height * (fit.lower ?? 1);
  const bow = design.bow * (fit.bow ?? 1),
    peak = design.peaks;
  const smile = design.smile * height + ((fit.corners ?? 1) - 1) * 0.005;
  const volume = design.relief * (fit.projection ?? 1);
  const dyeColor = new Color(dye);
  // Preserve the value of the natural lip pigment across skin tones. A
  // custom lip color remains usable for opaque makeup or fantasy palettes.
  if (dyeColor.getHexString() === (female ? "d98772" : "bd8363")) {
    const luminance = skin.r * 0.213 + skin.g * 0.715 + skin.b * 0.072;
    dyeColor.multiplyScalar(
      MathUtils.clamp((luminance / 0.54) ** 0.58, 0.21, 1.12),
    );
  }
  const upperColor = skin
    .clone()
    .lerp(dyeColor, female ? 0.91 : 0.76)
    .multiplyScalar(0.85);
  const lowerColor = skin.clone().lerp(dyeColor, female ? 0.87 : 0.7);
  const innerColor = upperColor.clone().multiply(new Color("#866166"));
  const wetColor = lowerColor.clone().lerp(skin, 0.12).multiplyScalar(1.045);
  const gap = design.gap ?? 0;
  const [peakWidth, lowerTaper, centralDip] = contours[gender][style];

  function profile(u) {
    const a = Math.abs(u),
      arch = Math.max(0, 1 - u * u);
    const center = bell(u / (0.18 + 0.055 * design.relief));
    const peaks = bell((a - peak) / peakWidth);
    const pillows = bell((a - 0.29) / 0.255);
    // The central tubercle dips below the lateral upper-lip planes.
    const seam =
      origin +
      smile * a ** 2.6 +
      (design.slant ?? 0) * u +
      height *
        arch *
        centralDip *
        (0.00046 * peaks - (0.00048 + 0.00062 * bow) * center);
    const taper = arch ** (0.68 + 0.1 * (1 - design.relief));
    const opening = taper * height * (0.00028 + gap * (1.24 - 0.21 * center));
    const heightAtU =
      upper * taper * (0.8 + (0.12 + 0.4 * bow) * peaks - 0.105 * bow * center);
    // Preserve philtrum space when overall fullness, upper fullness and bow
    // are all raised. The neutral profiles fall below the start of this ease.
    const limitStart = origin + 0.0095 - seam - opening;
    const upperH =
      heightAtU <= limitStart
        ? heightAtU
        : limitStart + 0.0031 * Math.tanh((heightAtU - limitStart) / 0.0031);
    const lowerH =
      lower * arch ** lowerTaper * (0.92 + 0.105 * pillows + 0.028 * center);
    return { a, arch, center, peaks, pillows, seam, opening, upperH, lowerH };
  }
  // The red lip and the surrounding skin are a continuous cross section.
  // Carry the profile above the Cupid's bow and into the chin before the
  // patch meets the foundation. The tangent is flat at that outer join.
  function vertex(u, v, top) {
    const p = profile(u),
      x = u * width,
      thickness = top ? p.upperH : p.lowerH;
    const t = Math.min(1, v / lipBorderV);
    const skinT = Math.max(0, (v - lipBorderV) / (1 - lipBorderV));
    const margin = (top ? 0.0046 : 0.0058) * p.arch ** 0.72;
    const y =
      p.seam + (top ? 1 : -1) * (p.opening + t * thickness + skinT * margin);
    const weight = p.arch ** 1.12;
    const crest = top ? 0.34 : 0.43;
    const anatomyScale = Math.min(
      1.18,
      Math.max(0.4, thickness / (top ? 0.005 : 0.0061)),
    );
    const anatomy = top
      ? 0.82 + 0.31 * p.center + 0.23 * p.peaks
      : 0.92 + 0.26 * p.pillows - 0.07 * p.center;
    const ridge = (top ? 0.00258 : 0.0022) * anatomy * anatomyScale;
    const lipEdge = (top ? 0.00106 : 0.00072) * anatomyScale;
    const border = (top ? 0.00082 : 0.00055) * anatomyScale;
    const projection =
      t < crest
        ? MathUtils.lerp(lipEdge, ridge, smooth(0, crest, t))
        : MathUtils.lerp(ridge, border, smooth(crest, 1, t));
    const relief = projection * (1 - smooth(0, 1, skinT));
    // Shallow, curved radial creases taper before both margins.
    const phase =
      u * (top ? 13.5 : 15.4) + 0.14 * Math.sin(9 * u) + 0.55 * u * (t - 0.42);
    const grooves = Math.max(0, Math.cos(phase * Math.PI * 2)) ** 9;
    const grain =
      grooves *
      0.000055 *
      Math.sin(Math.PI * t) ** 2 *
      (0.8 + 0.2 * Math.cos(17 * u));
    const z =
      depth(x, y) +
      weight * volume * (relief - grain) +
      0.000035 -
      0.00014 * Math.max(smooth(0.65, 1, skinT), smooth(0.96, 1, p.a));
    const color = (top ? upperColor : lowerColor)
      .clone()
      .lerp(innerColor, 0.26 * (1 - smooth(0, 0.2, t)) + 0.09 * p.a ** 3)
      .lerp(wetColor, (top ? 0.08 : 0.13) * bell((t - 0.32) / 0.21))
      .multiplyScalar(1 - 0.018 * grooves * Math.sin(Math.PI * t) ** 2);
    const edge = pigmentBorder(top);
    const pigment = (1 - smooth(edge - 2 / rows, edge, v)) * smooth(0, 0.16, p.arch);
    color.lerp(skin, 1 - pigment);
    return [x, y, z, color];
  }
  for (const top of [true, false]) {
    const g = meshGrid(112, rows, (t, v) => vertex(2 * t - 1, v, top), !top);
    const { normal, position, uv } = g.attributes,
      faceNormal = new Vector3(),
      lipNormal = new Vector3();
    const border = pigmentBorder(top);
    for (let i = 0; i < position.count; i++) {
      depth(position.getX(i), position.getY(i), faceNormal);
      lipNormal.fromBufferAttribute(normal, i);
      if (lipNormal.z < 0) lipNormal.negate();
      const edge = Math.max(
        smooth(border - 3 / rows, border + 3 / rows, uv.getY(i)),
        smooth(0.81, 0.99, Math.abs(2 * uv.getX(i) - 1)),
      );
      lipNormal.lerp(faceNormal, 0.055 + 0.945 * edge).normalize();
      normal.setXYZ(i, lipNormal.x, lipNormal.y, lipNormal.z);
    }
    add(
      top ? "Mouth / Upper lip" : "Mouth / Lower lip",
      g,
      mat("white", true, { roughness: 0.76 }),
    );
    // Return the free edge into the mouth. At oblique angles the camera
    // sees this inner lip surface between the forward roll and the aperture.
    const lining = meshGrid(
      112,
      5,
      (t, v) => {
        const u = 2 * t - 1,
          p = profile(u),
          [x, edgeY, edgeZ, edgeColor] = vertex(u, 0, top);
        const y = p.seam + (edgeY - p.seam) * (0.81 + 0.19 * v);
        const back = depth(x, y) + 0.00008 + 0.00029 * p.arch * volume;
        const z = MathUtils.lerp(back, edgeZ, v);
        return [
          x,
          y,
          z,
          innerColor
            .clone()
            .lerp(edgeColor, v * 0.83)
            .lerp(skin, 1 - smooth(0, 0.1, p.arch)),
        ];
      },
      !top,
    );
    add(
      top ? "Mouth / Upper inner rim" : "Mouth / Lower inner rim",
      lining,
      mat("white", true, { roughness: 0.53 }),
    );
  }
  // The aperture sits behind the inward-facing rolls with enamel only on
  // open smiles. All meshes follow the same per-vertex head attachment.
  const interior = meshGrid(96, 6, (t, v) => {
    const u = t * 2 - 1,
      x = u * width,
      p = profile(u),
      y = p.seam + (2 * v - 1) * p.opening * 1.1;
    const pigment = innerColor
      .clone()
      .multiplyScalar(gap ? 0.45 : 0.7)
      .lerp(upperColor, 0.26 * Math.abs(2 * v - 1))
      .lerp(skin, 1 - smooth(0, 0.11, p.arch));
    return [x, y, depth(x, y) + 0.00009 + 0.00031 * p.arch * volume, pigment];
  });
  add("Mouth / Aperture", interior, mat("white", true, { roughness: 0.8 }));
  if (gap > 0.00085) {
    const enamel = meshGrid(
      72,
      6,
      (t, v) => {
        const u = (t * 2 - 1) * 0.85,
          p = profile(u),
          x = u * width,
          arc = Math.max(0, 1 - (u / 0.85) ** 4);
        const y = p.seam + p.opening * (1.08 - v * arc * 0.9);
        return [
          x,
          y,
          depth(x, y) +
            0.00013 +
            0.00038 * volume * p.arch +
            0.000055 * Math.sin(Math.PI * v),
        ];
      },
      true,
    );
    add(
      "Mouth / Upper teeth",
      enamel,
      mat("#f1dfcd", false, { roughness: 0.46 }),
    );
  }
  return {
    halfWidth: width,
    upperAt(x) {
      const section = profile(MathUtils.clamp(x / width, -1, 1));
      return section.seam + section.opening + section.upperH;
    },
    lowerAt(x) {
      const section = profile(MathUtils.clamp(x / width, -1, 1));
      return section.seam - section.opening - section.lowerH;
    },
  };
}
