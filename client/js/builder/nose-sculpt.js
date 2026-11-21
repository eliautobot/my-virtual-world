// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { Color, MathUtils, Vector3 } from "three";
import profiles from "/assets/builder/tripo-nose-profiles.js";
import meridians, {
  noseMeridianOffsets,
} from "/assets/builder/tripo-nose-meridians.js";
import { extendedPortraits } from "./portrait-library.js";
import { noseSourceIds, studioNoseSources } from "./nose-library.js";

const clamp = MathUtils.clamp;
const smooth = (low, high, value) => MathUtils.smoothstep(value, low, high);
const bell = (x) => Math.exp(-x * x);

// Fit broad anatomical sections of the source. A direct displacement map
// also captures the eye sockets beside the bridge and facial hair below it.
function crossSection(profile, y) {
  const rows = profile.relief,
    last = rows.length - 1;
  const row =
    clamp(
      (y + profile.belowTip) / (profile.belowTip + profile.aboveTip),
      0,
      1,
    ) * last;
  const i = Math.min(last - 1, Math.floor(row));
  return rows[i].map((value, j) =>
    MathUtils.lerp(value, rows[i + 1][j], row - i),
  );
}
function halfDepthWidth(row, span) {
  const center = row[0];
  for (let i = 1; i < row.length; i++) {
    if (row[i] >= center * 0.5) continue;
    const fraction = (row[i - 1] - center * 0.5) / (row[i - 1] - row[i]);
    return ((i - 1 + fraction) * span) / (row.length - 1);
  }
  return span;
}

// Sample the fair measured cross-sections with a cubic B-spline. The four
// taps round scanner tessellation without introducing a new ridge between rows.
function spline(t, a, b, c, d) {
  const s = 1 - t;
  return (
    (s * s * s * a +
      (4 - 6 * t * t + 3 * t * t * t) * b +
      (1 + 3 * t + 3 * t * t - 3 * t * t * t) * c +
      t * t * t * d) /
    6
  );
}
function sampledRelief(profile, u, v) {
  const grid = profile.relief,
    nx = grid[0].length - 1,
    ny = grid.length - 1;
  const ax = Math.abs(u) * nx,
    ay = v * ny,
    ix = Math.floor(ax),
    iy = Math.floor(ay);
  const sampleRow = (j) => {
    const r = grid[clamp(j, 0, ny)];
    return spline(
      ax - ix,
      r[Math.abs(ix - 1)],
      r[ix],
      r[Math.min(nx, ix + 1)],
      r[Math.min(nx, ix + 2)],
    );
  };
  return spline(
    ay - iy,
    sampleRow(iy - 1),
    sampleRow(iy),
    sampleRow(iy + 1),
    sampleRow(iy + 2),
  );
}

// A monotone cubic meridian gives the tip one rounded apex and a continuous
// tangent down its underside. Flat endpoint tangents meet the host skin.
function meridian(points) {
  const slopes = points
    .slice(1)
    .map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
  const tangents = points.map((_, i) => {
    if (i === 0 || i === slopes.length || slopes[i - 1] * slopes[i] <= 0)
      return 0;
    return 2 / (1 / slopes[i - 1] + 1 / slopes[i]);
  });
  return (y) => {
    const j = points.findIndex(([at]) => at > y);
    if (j <= 0) return 0;
    const [a, lo] = points[j - 1],
      [b, hi] = points[j],
      h = b - a,
      t = (y - a) / h;
    return (
      MathUtils.lerp(lo, hi, t * t * (3 - 2 * t)) +
      h * t * (1 - t) * ((1 - t) * tangents[j - 1] - t * tangents[j])
    );
  };
}

const fitted = new Map();
// These rounded tips peak above the relief-grid landmark. Register the
// refinement on the actual dome, including the narrower M14 apex above
// its grid landmark and the longer sweep from the tip up the F17 bridge.
const domeFits = {
  f17: { center: 0.08, forward: 0.00165, under: 0.0004, bridge: 0.0018 },
  f20: { center: 0.04, forward: 0.0003, under: 0.00025, bridge: 0 },
  m13: { center: 0.065, forward: 0.00155, under: 0.0015, bridge: 0 },
  m14: { center: 0.09, forward: 0.0018, under: 0.0004, bridge: 0.0007 },
};

// The source's cheek plane can tilt relative to the editable face. Fit the
// profile between the philtrum and upper bridge on this particular face.
// The depth above that chord is independent of the original head's pitch.
function profileCorrection(source, profile, shape, origin, depth) {
  const { targetIPD, underClear, sourceSag } = meridians[source];
  const bed = depth(0, origin);
  const initial = (y) => {
    const t = (y + profile.belowTip) / (profile.belowTip + profile.aboveTip);
    if (t <= 0 || t >= 1) return 0;
    return (
      MathUtils.lerp(
        shape.roll(y),
        sampledRelief(profile, 0, t),
        shape.angular ? 0.8 : 0.54,
      ) *
      smooth(-1, -0.78, y / profile.belowTip) *
      (1 - smooth(0.91, 1, y / profile.aboveTip))
    );
  };
  const peak = initial(0);
  const errors = noseMeridianOffsets.map((t, i) => {
    const y = t * targetIPD;
    return depth(0, origin + y) - bed + initial(y) - peak + sourceSag[i];
  });
  const lower = -0.18,
    upper = 0.45;
  const high = errors[noseMeridianOffsets.indexOf(upper)];
  const low = underClear ? errors[noseMeridianOffsets.indexOf(lower)] : 0;
  const pitch = (high - low) / (upper - lower);
  const lift = clamp(low - lower * pitch, -0.0025, 0.005);
  const points = [[-profile.belowTip, 0]];
  for (const [i, t] of noseMeridianOffsets.entries()) {
    const y = t * targetIPD;
    if (y <= -profile.belowTip + 0.0008 || y >= profile.aboveTip - 0.001)
      continue;
    const offset = clamp(lift + pitch * t - errors[i], -0.0038, 0.005);
    const fade =
      smooth(-1, -0.68, y / profile.belowTip) *
      (1 - smooth(0.67, 1, y / profile.aboveTip));
    // A moustache conceals the subnasal surface in several source scans.
    const visible = underClear ? 1 : smooth(-0.18, 0, t);
    points.push([y, offset * fade * visible]);
  }
  points.push([profile.aboveTip, 0]);
  const correction = meridian(points);
  const fit = domeFits[source];
  if (!fit) return correction;
  const dome = meridian([
    [-profile.belowTip / targetIPD - fit.center, 0],
    [-0.18, -fit.under],
    [-0.065, fit.forward * 0.75],
    [0, fit.forward],
    [0.085, fit.forward * 0.68],
    [0.3, -fit.bridge],
    [profile.aboveTip / targetIPD - fit.center, 0],
  ]);
  return (y) => correction(y) + dome(y / targetIPD - fit.center);
}
function fitSections(source, profile) {
  if (fitted.has(source)) return fitted.get(source);
  const hi = profile.aboveTip,
    lo = profile.belowTip,
    hw = profile.halfWidth;
  const tip = crossSection(profile, 0);
  const mid = crossSection(profile, hi * 0.4),
    root = crossSection(profile, hi * 0.71);
  const peak = Math.max(tip[0], crossSection(profile, -0.12 * lo)[0]);
  const midFraction = clamp(mid[0] / peak, 0.24, 0.76);
  const highFraction = clamp(root[0] / peak, 0.07, midFraction * 0.78);
  const under = crossSection(profile, -0.48 * lo);
  const underside = clamp(under[0] / peak, 0.49, 0.81);
  const roll = meridian([
    [-lo, 0],
    [-0.77 * lo, peak * 0.1],
    [-0.46 * lo, peak * underside],
    [0, peak],
    [
      0.13 * hi,
      peak * clamp(crossSection(profile, hi * 0.13)[0] / peak, 0.73, 0.945),
    ],
    [0.4 * hi, peak * midFraction],
    [0.71 * hi, peak * highFraction],
    [hi, 0],
  ]);
  const tipHalf = clamp(
    halfDepthWidth(tip, hw),
    0.33 * profile.alaWidth,
    0.84 * profile.alaWidth,
  );
  const bridgeHalf = clamp(halfDepthWidth(mid, hw), 0.0024, tipHalf * 1.1);
  const rootHalf = clamp(
    halfDepthWidth(root, hw),
    bridgeHalf * 0.78,
    bridgeHalf * 1.52,
  );
  const angular = source === "m11" || source === "f11";
  const narrowRims = {
    f02: 0.42,
    f05: 0.53,
    f06: 0.33,
    f07: 0.67,
    f08: 0.39,
    f10: 0.3,
    m02: 0.37,
    m07: 0.59,
    m08: 0.33,
    m19: 0.42,
  };
  const definition = angular
    ? 0
    : Math.max(profile.nostrilStrength, narrowRims[source] ?? 0.18);
  const baseWidth = profile.alaWidth;
  const wingX = 0.74 * baseWidth;
  const wingY = Math.max(-lo * 0.26, profile.nostrilY + baseWidth * 0.16);
  const values = {
    peak,
    roll,
    tipHalf,
    bridgeHalf,
    rootHalf,
    angular,
    definition,
    baseWidth,
    wingX,
    wingY,
  };
  fitted.set(source, values);
  return values;
}

const initialShapes = {
  female: [
    { width: 0.97, height: 0.93, tip: 1.08 },
    { width: 0.92, height: 1.05, root: 0.82 },
    { width: 1.05, tip: 1.14, wing: 1.06 },
  ],
  male: [
    { width: 1.02, height: 1.03, bridge: 0.04 },
    { width: 1.06, tip: 1.16, wing: 1.07 },
    { width: 0.95, height: 1.07, root: 0.92, bridge: 0.17 },
  ],
};

export function sculptNose({
  gender,
  style,
  origin,
  skin,
  dye,
  fit = {},
  depth,
  meshGrid,
  mat,
  add,
}) {
  const studioSources = studioNoseSources[gender];
  const source =
    studioSources[style] ?? noseSourceIds[gender][style - studioSources.length];
  const profile = profiles[source];
  const design =
    style < studioSources.length
      ? (initialShapes[gender][style] ??
        extendedPortraits[gender].nose[style - 3])
      : null;
  const width = (fit.width ?? 1) * (1 + 0.57 * ((design?.width ?? 1) - 1));
  const length = (fit.height ?? 1) * (1 + 0.55 * ((design?.height ?? 1) - 1));
  const projection =
    (fit.projection ?? 1) * (1 + 0.62 * ((design?.reach ?? 1) - 1));
  const bridgeWidth =
    (fit.bridge ?? 1) * (1 + 0.56 * ((design?.root ?? 1) - 1));
  const wingWidth = (fit.wings ?? 1) * (1 + 0.45 * ((design?.wing ?? 1) - 1));
  const tipTurn = (fit.turn ?? 1) - 1;
  const color = new Color(dye ?? skin),
    faceNormal = new Vector3();
  const shape = fitSections(source, profile);
  const correct = profileCorrection(source, profile, shape, origin, depth);
  const { peak, baseWidth } = shape;
  const cols = 96,
    rows = 88,
    stride = cols + 1;
  const lifts = new Float32Array(stride * (rows + 1));
  const nostrilX = clamp(profile.nostrilX, baseWidth * 0.42, baseWidth * 0.73);
  const nostrilY = clamp(
    profile.nostrilY,
    -profile.belowTip * 0.59,
    -profile.belowTip * 0.29,
  );
  const cavityWidth = Math.max(0.00075, baseWidth * 0.19);
  const cavityHeight = Math.max(0.00052, cavityWidth * 0.56);
  const g = meshGrid(cols, rows, (s, v) => {
    const u = 2 * s - 1,
      localX = u * profile.halfWidth,
      absX = Math.abs(localX);
    const localY = MathUtils.lerp(-profile.belowTip, profile.aboveTip, v);
    const yBridge = localY / profile.aboveTip,
      yBase = localY / profile.belowTip;
    const bridge = smooth(0.08, 0.56, yBridge);
    const nearWing =
      bell((localY - shape.wingY) / (profile.belowTip * 0.74)) *
      smooth(0.16, 0.78, absX / baseWidth);
    const tip =
      bell(localY / (0.65 * profile.belowTip)) *
      bell(localX / (0.72 * baseWidth));
    const tipToBridge = MathUtils.lerp(
      shape.tipHalf,
      shape.bridgeHalf,
      smooth(0.015, 0.41, yBridge),
    );
    const halfWidth =
      MathUtils.lerp(tipToBridge, shape.rootHalf, smooth(0.41, 0.84, yBridge)) *
      MathUtils.lerp(
        shape.angular ? 0.5 : 0.32,
        1,
        smooth(-0.81, -0.07, yBase),
      );
    const cross = Math.exp(
      -Math.LN2 * (absX / halfWidth) ** (shape.angular ? 1.86 : 2.13),
    );
    const sideFade = 1 - smooth(0.79, 1, Math.abs(u));
    const wing =
      bell((absX - shape.wingX) / (0.33 * baseWidth)) *
      bell((localY - shape.wingY) / (0.38 * profile.belowTip));
    const section =
      shape.roll(localY) * cross +
      (shape.angular ? 0.025 : 0.19 + 0.09 * shape.definition) * peak * wing;
    const h =
      MathUtils.lerp(
        section,
        sampledRelief(profile, u, v),
        shape.angular ? 0.8 : 0.54,
      ) *
      sideFade *
      smooth(-1, -0.78, yBase) *
      (1 - smooth(0.91, 1, yBridge));
    const x =
      localX *
      width *
      (1 +
        (bridgeWidth - 1) * bridge +
        (wingWidth - 1) * nearWing +
        0.46 * ((design?.tip ?? 1) - 1) * tip);
    const rowShift = (design?.tilt ?? 0) * 0.42 + tipTurn * 0.0075;
    const across = (absX - nostrilX) / cavityWidth;
    const underTip = bell((localY - nostrilY) / (0.49 * profile.belowTip));
    const rimLift = shape.angular
      ? 0
      : underTip *
        (0.14 + 0.86 * shape.definition) *
        (0.00135 * bell(across * 0.73) -
          0.00055 * bell(localX / (0.33 * baseWidth)));
    const y = origin + localY * length + rowShift * tip + rimLift;
    const crest =
      (design?.bridge ?? 0) *
      peak *
      0.33 *
      bell((localY / profile.aboveTip - 0.39) / 0.23) *
      bell(localX / (profile.alaWidth * 0.52));
    const ringY =
      nostrilY +
      cavityHeight *
        (0.22 * across + 0.35 * (1 - Math.min(1, across * across)));
    const cavity =
      bell(across) *
      bell((localY - ringY) / cavityHeight) *
      shape.definition *
      smooth(0.00025, 0.0013, h);
    const sagittal = correct(localY) * cross * sideFade;
    const relief = Math.max(
      0,
      (h + sagittal + crest - 0.0024 * cavity) * projection,
    );
    const join = smooth(0.00002, 0.0009, relief);
    const offset = relief + MathUtils.lerp(-0.00019, 0.00004, join);
    lifts[Math.round(v * rows) * stride + Math.round(s * cols)] = offset;
    const tint = skin.clone().lerp(color, smooth(0.0003, 0.004, relief));
    tint.multiplyScalar(1 - 0.28 * cavity);
    return [x, y, depth(x, y) + offset, tint];
  });
  const { position: p, normal } = g.attributes;
  // Differentiate the fitted surface in its curved anatomical coordinates.
  // Use the interpolated cheek tangent under the relief to keep the join
  // smooth even when the insert crosses a triangle of the foundation.
  const du = new Vector3(),
    dv = new Vector3(),
    n = new Vector3();
  for (let i = 0; i < p.count; i++) {
    const col = i % stride,
      row = Math.floor(i / stride);
    const l = col > 0 ? i - 1 : i,
      r = col < cols ? i + 1 : i;
    const b = row > 0 ? i - stride : i,
      t = row < rows ? i + stride : i;
    du.set(p.getX(r) - p.getX(l), p.getY(r) - p.getY(l), lifts[r] - lifts[l]);
    dv.set(p.getX(t) - p.getX(b), p.getY(t) - p.getY(b), lifts[t] - lifts[b]);
    n.crossVectors(du, dv);
    depth(p.getX(i), p.getY(i), faceNormal);
    const scale = n.z / Math.max(0.18, faceNormal.z);
    n.set(
      n.x + scale * faceNormal.x,
      n.y + scale * faceNormal.y,
      n.z,
    ).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  const mesh = add(
    "Nose / " + source.toUpperCase(),
    g,
    mat("white", true, { roughness: 0.76 }),
  );
  mesh.userData.sourceModel = source.toUpperCase();
}
