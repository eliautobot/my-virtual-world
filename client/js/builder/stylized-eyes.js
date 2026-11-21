// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";
import { addEyeMorph, addGlobeGaze } from "./eye-pose.js";
import { pupilSettings, pupilRestYaw } from "./face-settings.js";
import { extendedPortraits } from "./portrait-library.js";
import { lashGeometry, lashNames } from "./lash-library.js";

const scaled = (v) =>
  THREE.MathUtils.clamp(Number.isFinite(v) ? v : 1, 0.75, 1.25);
const lerp = THREE.MathUtils.lerp,
  tau = 2 * Math.PI;
// Rounded, beveled brow plaque. The end caps keep their width nearly to the
// corner; a conventional tapered stroke reads like thin painted makeup.
function browShape(side, spec, depth) {
  const { eyeX, eyeY, w, hi, female, variant, reference, browHeight } = spec;
  const design = spec.design;
  const L = Math.min(
    w * (female ? (reference ? 1.04 : 1.17) : 1.46) * (design?.length ?? 1),
    eyeX - 0.0013,
  );
  const y0 =
    (reference
      ? female
        ? 0.9248
        : 0.9397
      : eyeY + hi + (female ? 0.0094 : 0.01)) +
    (browHeight - 1) * 0.036;
  const H =
    (female ? 0.0032 : 0.0041) * (design?.thickness ?? [1, 0.91, 0.9][variant]);
  const R = female ? 0.0012 : 0.00135,
    pos = [],
    uv = [],
    idx = [];
  // Rounded rectangle perimeter, then nested rings for a rolled edge.
  const profile = [];
  for (const [cx, cy, angle] of [
    [L - R, H - R, 0],
    [-L + R, H - R, 90],
    [-L + R, -H + R, 180],
    [L - R, -H + R, 270],
  ]) {
    for (let j = 0; j <= 6; j++) {
      const a = ((angle + j * 15) * Math.PI) / 180;
      profile.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  }
  // Extra points along the long edges allow the brow to wrap the forehead.
  const path = [];
  for (let k = 0; k < profile.length; k++) {
    const p = profile[k],
      q = profile[(k + 1) % profile.length],
      n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.0017));
    for (let j = 0; j < n; j++)
      path.push([
        p[0] + ((q[0] - p[0]) * j) / n,
        p[1] + ((q[1] - p[1]) * j) / n,
      ]);
  }
  const count = path.length,
    loops = [];
  for (const [radius, rise] of [
    [0, -0.00023],
    [0.56, -0.00021],
    [1, -0.00018],
    [1, 0.00037],
    [0.96, 0.001],
    [0.87, 0.00146],
    [0.62, 0.00158],
    [0.28, 0.00168],
    [0, 0.00172],
  ]) {
    const loop = [];
    for (const [px, py] of radius === 0 ? [[0, 0]] : path) {
      loop.push(pos.length / 3);
      const u = (px / L) * radius;
      const peak = design?.peak ?? 0;
      const along = (u - peak) / (u < peak ? 1 + peak : 1 - peak);
      const arch = design
        ? design.arch * (1 - Math.abs(along) ** (2.8 - 1.7 * design.corner))
        : (female ? [0.00255, 0.00018, 0.00195] : [0.00024, 0.00295, 0.00105])[
            variant
          ] *
          (1 - u * u);
      const tilt = design
        ? design.cant * u
        : (female ? [-0.00067, 0.00012, 0.0024] : [-0.00018, -0.00045, 0.0009])[
            variant
          ] * u;
      const taper =
        design?.taper ??
        (female ? [0.18, 0.035, 0.46] : [0.035, 0.135, 0.49])[variant];
      const x = side * (eyeX + px * radius),
        y = y0 + arch + tilt + py * radius * (1 - taper * u);
      pos.push(x, y, depth(x, y) + rise);
      uv.push((u + 1) / 2, (py / H + 1) / 2);
    }
    const prev = loops.at(-1);
    loops.push(loop);
    if (prev)
      for (let i = 0; i < count; i++) {
        const a = prev[i % prev.length],
          b = prev[(i + 1) % prev.length],
          c = loop[(i + 1) % loop.length],
          d = loop[i % loop.length];
        if (side > 0) {
          if (a !== b) idx.push(a, b, c);
          if (c !== d) idx.push(a, c, d);
        } else {
          if (a !== b) idx.push(a, c, b);
          if (c !== d) idx.push(a, d, c);
        }
      }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

// Closed surface of revolution in the local tangent plane of the face. Each
// band is a separate modeled component of the eye. No pupil, rim, lash or
// catchlight is painted onto the white of the eye.
function band(
  cx,
  cy,
  rx,
  ry,
  tilt,
  side,
  surface,
  rings,
  segments = 64,
  cornerTaper = 0,
) {
  const p = [],
    idx = [],
    uv = [],
    n = [],
    loops = [];
  for (let j = 0; j < rings.length; j++) {
    const [radius, zOffset] = rings[j],
      loop = [],
      size = radius === 0 ? 1 : segments;
    for (let i = 0; i < size; i++) {
      const a = (i * tau) / segments,
        dx = radius * Math.cos(a),
        dy = radius * Math.sin(a);
      const x = cx + rx * dx,
        y = cy + ry * dy * (1 - cornerTaper * dx * dx) + side * tilt * dx;
      loop.push(p.length / 3);
      p.push(x, y, surface(x, y) + zOffset);
      uv.push(0.5 + 0.5 * dx, 0.5 + 0.5 * dy);
      const e = 0.00008,
        nx = -(surface(x + e, y) - surface(x - e, y)) / (2 * e),
        ny = -(surface(x, y + e) - surface(x, y - e)) / (2 * e);
      const orientation = j < 2 ? -1 : 1,
        l = Math.hypot(nx, ny, 1) * orientation;
      n.push(nx / l, ny / l, 1 / l);
    }
    loops.push(loop);
    if (!j) continue;
    const prev = loops[j - 1];
    for (let i = 0; i < segments; i++) {
      const a = prev[i % prev.length],
        b = prev[(i + 1) % prev.length],
        c = loop[(i + 1) % loop.length],
        d = loop[i % loop.length];
      if (a !== b) idx.push(a, b, c);
      if (c !== d) idx.push(a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const frontRings = (steps, edge, thickness) => [
  [0, -thickness],
  [1, -thickness],
  [1, edge],
  ...Array.from({ length: steps }, (_, i) => [1 - (i + 1) / steps, edge]),
];

// The same smooth orbit is sampled repeatedly while building the gaze, lid
// and liner shapes. A local height field keeps feature sliders responsive.
function sampledSocket(depth, cx, cy, width, high) {
  const cols = 53,
    rows = 47;
  const left = cx - 1.95 * width,
    bottom = cy - 1.65 * high,
    dx = (3.9 * width) / (cols - 1),
    dy = (3.3 * high) / (rows - 1);
  const field = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      field[j * cols + i] = depth(left + i * dx, bottom + j * dy);
  return (x, y) => {
    const u = (x - left) / dx,
      v = (y - bottom) / dy,
      i = Math.floor(u),
      j = Math.floor(v);
    if (i < 0 || j < 0 || i >= cols - 1 || j >= rows - 1) return depth(x, y);
    const index = j * cols + i;
    return lerp(
      lerp(field[index], field[index + 1], u - i),
      lerp(field[index + cols], field[index + cols + 1], u - i),
      v - j,
    );
  };
}

function morphCopy(geometry) {
  const target = new THREE.BufferGeometry();
  target.setAttribute("position", geometry.attributes.position.clone());
  target.setAttribute("normal", geometry.attributes.normal.clone());
  return target;
}

export function portraitEyes({
  female,
  variant,
  eyeX,
  eyeY,
  eye,
  hair,
  detail,
  reference = false,
  graphic,
  depth,
  skinDepth = depth,
  meshGrid,
  mat,
  add,
  browVariant = variant,
  browColor,
  adjustments = {},
  graphicOnly = false,
  mode,
  lashVariant = -1,
}) {
  const lashesOnly = mode === "lashes";
  if (
    (variant < 0 && browVariant < 0) ||
    (lashesOnly && (!female || variant < 0 || !lashNames[lashVariant])) ||
    (graphicOnly && (!graphic || !female || variant < 0))
  )
    return;
  const eyeFit = adjustments.eyes ?? {},
    browFit = adjustments.brows ?? {};
  const eyeSpace = scaled(eyeFit.spacing),
    browSpace = scaled(browFit.spacing),
    ew = scaled(eyeFit.width),
    eh = scaled(eyeFit.height);
  const foundationSurface = depth;
  if (reference) {
    const base = depth;
    depth = (x, y) => {
      const z = base(x, y);
      if (z > -0.105) return z;
      let sum = 0,
        count = 0;
      for (let r = 0.0015; r <= 0.027 && !count; r += 0.0015)
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6,
            d = base(x + r * Math.cos(a), y + r * Math.sin(a));
          if (d > 0.024) {
            sum += d;
            count++;
          }
        }
      return count ? sum / count : 0.046;
    };
  }
  const showEye = variant >= 0 && !graphicOnly && !lashesOnly;
  const eyeMat = showEye && mat("#fffaf4", false, { roughness: 0.39 }),
    ink = showEye && mat("#1a1820", false, { roughness: 0.46 }),
    spec = showEye && mat("#fffaf3", false, { roughness: 0.3 });
  const iris =
    showEye &&
    mat(
      eye.clone().multiplyScalar(0.85).lerp(new THREE.Color("#241e26"), 0.1),
      false,
      { roughness: 0.43 },
    );
  const brow =
    browVariant >= 0 &&
    !graphicOnly &&
    !lashesOnly &&
    mat(
      browColor ??
        hair
          .clone()
          .lerp(
            new THREE.Color(female ? "#432c20" : "#2c2320"),
            female ? 0.35 : 0.54,
          ),
      false,
      { roughness: 0.82 },
    );
  const browIndex = Math.max(0, browVariant),
    ei = Math.max(0, variant);
  const designs = extendedPortraits[female ? "female" : "male"],
    eyeDesign = designs.eyes[ei - 3],
    browDesign = designs.brows[browIndex - 3];
  const baseW = female ? [0.01085, 0.0121, 0.0119] : [0.01065, 0.0119, 0.012],
    baseH = female ? [0.0101, 0.0113, 0.00885] : [0.0102, 0.01105, 0.00865];
  const restW = eyeDesign?.width ?? baseW[ei],
    restH = eyeDesign?.height ?? baseH[ei];
  const width = restW * ew,
    high = restH * eh;
  const tilt =
    eyeDesign?.cant ??
    (female ? [0.00075, 0.00018, 0.00165] : [0.0003, 0.0001, 0.001])[ei];
  const cornerTaper =
    eyeDesign?.taper ??
    (female ? [0.32, 0.14, 0.5][ei] : [0.15, 0.09, 0.31][ei]);
  const opticalBuilders = [];
  for (const side of [-1, 1]) {
    const name = side > 0 ? "Left" : "Right",
      cx = side * eyeX * eyeSpace,
      cy = eyeY;
    if (!graphicOnly && !lashesOnly && browVariant >= 0) {
      const g = browShape(
        side,
        {
          eyeX: eyeX * browSpace,
          eyeY,
          w: (baseW[browIndex] ?? baseW[0]) * scaled(browFit.width),
          hi: baseH[browIndex] ?? baseH[0],
          design: browDesign,
          female,
          variant: browIndex,
          reference,
          browHeight: scaled(browFit.height),
        },
        depth,
      );
      add("Brow / " + name, g, brow);
    }
    if (variant < 0) continue;
    const socket = sampledSocket(depth, cx, cy, width, high);
    const e = 0.0014;
    const dx = (socket(cx + e, cy) - socket(cx - e, cy)) / (2 * e),
      dy = (socket(cx, cy + e) - socket(cx, cy - e)) / (2 * e),
      cz = socket(cx, cy);
    const taperAt = (u) => 1 - cornerTaper * Math.min(1, u * u);
    const pointY = (u, v) => {
      const contour = !eyeDesign
        ? 1
        : (v >= 0 ? eyeDesign.upper : eyeDesign.lower) *
          (1 + side * u * eyeDesign.peak);
      return cy + high * v * taperAt(u) * contour + side * tilt * u;
    };
    // The opening is a cut through the eyelids. Its shape and height are
    // independent of the globe that continues beneath the skin on every side.
    const radius = 1.47 * Math.max(restW, restH);
    const gx = cx + radius * THREE.MathUtils.clamp(dx * 0.85, -0.2, 0.2);
    const gy = cy + radius * THREE.MathUtils.clamp(dy * 0.85, -0.12, 0.12);
    const cap = (x, y) =>
      Math.sqrt(Math.max(0, radius * radius - (x - gx) ** 2 - (y - gy) ** 2));
    let gz = cz - radius;
    // Seat the sphere just in front of the orbital bed across this aperture,
    // including the nose-side corner on a strongly curved face.
    for (const ring of [0, 0.65, 1]) {
      for (let i = 0; i < 72; i++) {
        const a = (i * tau) / 72,
          u = ring * Math.cos(a);
        const x = cx + width * u,
          y = pointY(u, ring * Math.sin(a));
        gz = Math.max(gz, socket(x, y) - cap(x, y) + 0.00028);
      }
    }
    const pivot = [gx, gy, gz];
    const front = (x, y) => gz + cap(x, y);
    const seam = (u) =>
      -0.405 * Math.sqrt(Math.max(0, 1 - u * u)) + 0.035 * (1 - u * u);

    function blinkRecess(geometry) {
      for (const [key, retract] of [
        ["BlinkMid", 0.00004],
        ["Blink", 0.0004],
      ]) {
        const target = morphCopy(geometry),
          p = target.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - retract);
        addEyeMorph(geometry, key, target);
      }
      return geometry;
    }
    function blinkGeometry(shape) {
      const rest = shape(0);
      addEyeMorph(rest, "BlinkMid", shape(0.5));
      addEyeMorph(rest, "Blink", shape(1));
      return rest;
    }
    const cheek = sampledSocket(
      (x, y) => {
        const z = skinDepth(x, y);
        return z > -0.105 ? z : depth(x, y);
      },
      cx,
      cy,
      width,
      high,
    );
    function surroundingSkin(x, y) {
      const z = socket(x, y),
        r = Math.hypot(x - gx, y - gy) / radius;
      return lerp(cheek(x, y), z, THREE.MathUtils.smoothstep(r, 0.95, 1.4));
    }
    function coverDepth(x, y, blink) {
      const skinZ = surroundingSkin(x, y) - 0.00012;
      const lidRadius = radius + 0.00102 + 0.00075 * Math.sin(blink * Math.PI);
      const r = Math.hypot(x - gx, y - gy);
      const join = 0.92 * lidRadius,
        depthAtJoin = Math.sqrt(lidRadius ** 2 - join ** 2);
      const globeZ =
        gz +
        (r < join
          ? Math.sqrt(lidRadius ** 2 - r ** 2)
          : depthAtJoin - ((r - join) * join) / depthAtJoin);
      // A rolled margin rides above the cornea. Farther from the opening the
      // lid follows the skull and turns back into the cheek or the brow.
      const blend = 0.0045;
      const mix = Math.max(0, 1 - Math.abs(skinZ - globeZ) / blend);
      const lid = Math.max(skinZ, globeZ) + 0.25 * blend * mix * mix;
      return lerp(
        lid,
        skinZ,
        THREE.MathUtils.smoothstep(r / radius, 1.06, 1.39),
      );
    }
    function movingEdge(u, upper, blink) {
      const arc = Math.sqrt(Math.max(0, 1 - u * u)),
        ridge = seam(u);
      return lerp(
        (upper ? 1 : -1) * arc * 0.986,
        ridge + (upper ? -0.027 : 0.018) * arc,
        upper ? blink : blink ** 2.2,
      );
    }
    function lidSurface(upper, blink) {
      const sheet = meshGrid(
        58,
        24,
        (t, row) => {
          const u = -Math.cos(Math.PI * t),
            arch = Math.sin(Math.PI * t);
          const rim = Math.min(1, row * 12);
          const k = Math.max(0, (row * 24 - 2) / 22);
          const x = lerp(
            cx + side * width * u,
            gx + side * 1.42 * radius * u,
            k,
          );
          const inner = movingEdge(u, upper, blink);
          const y =
            lerp(
              pointY(side * u, inner),
              gy + (upper ? 1 : -1) * 1.42 * radius * arch,
              k,
            ) +
            (upper ? 1 : -1) * arch * 0.00018 * (1 - rim);
          const roll = Math.sin(Math.PI * k) * Math.exp(-5 * k) * arch;
          const z =
            lerp(front(x, y) - 0.00013, coverDepth(x, y, blink), rim) +
            (upper ? 0.0009 : 0.00055) * roll;
          return [x, y, z];
        },
        upper ? side < 0 : side > 0,
      );

      // Match the skin normal at the orbital boundary. Within the lid a
      // softer normal keeps the rolled lower margin from reading as a ring.
      const p = sheet.attributes.position,
        n = sheet.attributes.normal;
      const cheekNormal = new THREE.Vector3(),
        bedNormal = new THREE.Vector3();
      for (let i = 0; i < n.count; i++) {
        const x = p.getX(i),
          y = p.getY(i);
        cheekNormal.set(0, 0, 1);
        skinDepth(x, y, cheekNormal);
        const influence =
          THREE.MathUtils.smoothstep(
            p.getZ(i) - surroundingSkin(x, y),
            -0.00005,
            0.0025,
          ) * (upper ? 0.68 : 0.5);
        const skinZ = foundationSurface(x, y, bedNormal);
        const seam = THREE.MathUtils.smoothstep(
          p.getZ(i) - skinZ,
          0.0001,
          0.003,
        );
        const nx = lerp(
            bedNormal.x,
            lerp(cheekNormal.x, n.getX(i), influence),
            seam,
          ),
          ny = lerp(
            bedNormal.y,
            lerp(cheekNormal.y, n.getY(i), influence),
            seam,
          ),
          nz = lerp(
            bedNormal.z,
            lerp(cheekNormal.z, n.getZ(i), influence),
            seam,
          );
        const length = Math.hypot(nx, ny, nz);
        n.setXYZ(i, nx / length, ny / length, nz / length);
      }
      return sheet;
    }
    function lashLine(blink, graphicLine, upper = true) {
      return meshGrid(
        58,
        6,
        (t, k) => {
          const u = -Math.cos(Math.PI * t),
            arch = Math.sin(Math.PI * t);
          const baseThickness = upper ? (adjustments.lashLine?.upper ?? 1) : (adjustments.lashLine?.lower ?? 0);
          const thickness =
            (graphicLine ? Math.max(0.166, 0.113 * baseThickness) : (female ? 0.113 : 0.069) * baseThickness) *
            high *
            arch ** 0.53 *
            (eyeDesign?.lash ?? 1);
          const x = cx + side * width * u;
          const y =
            pointY(side * u, movingEdge(u, upper, blink)) +
            (upper ? 1 : -1) * thickness * (k - 0.30);
          // The lash is on the free rim. From halfway onwards it glides up
          // onto the skin sheet, including graphics attached to the lid.
          const z =
            coverDepth(x, y, blink) +
            (graphicLine ? 0.00033 : 0.00018) +
            0.00008 * Math.sin(k * Math.PI) * arch;
          return [x, y, z];
        },
        upper ? side < 0 : side > 0,
      );
    }
    function lashWing(blink, extended) {
      const anchor = cx + side * 0.82 * width;
      const slope =
        (socket(anchor + side * 0.001, cy) -
          socket(anchor - side * 0.001, cy)) /
        0.002;
      const run = (extended ? 0.52 : 0.41) / Math.hypot(1, 0.82 * slope);
      return meshGrid(
        28,
        6,
        (t, k) => {
          const u = 0.82 + run * t,
            x = cx + side * u * width;
          const start = pointY(side * 0.82, movingEdge(0.82, true, blink));
          const tail = pointY(side * u, 0.37 + (extended ? 0.17 : 0.05) * t);
          const y =
            lerp(start, tail, t) -
            high * 0.13 * Math.sin(Math.PI * t) +
            (k - 0.5) * (extended ? 0.0021 : 0.0016) * (1 - t);
          return [
            x,
            y,
            coverDepth(x, y, blink) +
              (extended ? 0.00039 : 0.00022) +
              0.00012 * (1 - t) * Math.sin(k * Math.PI),
          ];
        },
        side < 0,
      );
    }
    if (lashesOnly) {
      const anchor = (u, upper, blink) => {
        const x = cx + side * width * u;
        const y =
          pointY(side * u, movingEdge(u, upper, blink)) +
          (upper ? 0.00017 : -0.00014) * Math.sqrt(1 - u * u);
        const z = coverDepth(x, y, blink) + (upper ? 0.00022 : 0.00008);
        const slope = THREE.MathUtils.clamp(
          (coverDepth(x + 0.00015, y, blink) -
            coverDepth(x - 0.00015, y, blink)) /
            0.0003,
          -0.68,
          0.68,
        );
        return {
          root: new THREE.Vector3(x, y, z),
          lateral: new THREE.Vector3(1, 0, slope).normalize(),
          forward: new THREE.Vector3(-slope, 0, 1).normalize(),
        };
      };
      add(
        "Lashes / " + name + " / " + lashNames[lashVariant],
        blinkGeometry((blink) =>
          lashGeometry(lashVariant, side, blink, anchor),
        ),
        mat(detail, false, { roughness: 0.72 }),
      );
      continue;
    }
    if (graphicOnly) {
      const liner = mat(detail, false, { roughness: 0.76 });
      add(
        "Detail / " + name + " / graphic upper liner",
        blinkGeometry((blink) => lashLine(blink, true)),
        liner,
      );
      add(
        "Detail / " + name + " / graphic wing",
        blinkGeometry((blink) => lashWing(blink, true)),
        liner,
      );
      continue;
    }
    add(
      "Eye / " + name + " / sclera",
      blinkRecess(new THREE.SphereGeometry(radius, 80, 56).translate(...pivot)),
      eyeMat,
    );
    const iy = cy + 0.00048,
      irx = width * (eyeDesign?.iris ?? (ei === 2 ? 0.51 : 0.545)),
      iry = high * 0.84;
    const irisFront = (x, y) =>
      front(x, y) +
      0.0001 +
      0.00035 * Math.max(0, 1 - ((x - cx) / irx) ** 2 - ((y - iy) / iry) ** 2);
    opticalBuilders.push((fit) => {
      const rx = irx * 0.79 * fit.size,
        ry = iry * 0.79 * fit.size;
      const pupilFront = (x, y) =>
        irisFront(x, y) +
        0.00007 +
        0.00019 * Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((y - iy) / ry) ** 2);
      const hx = cx - irx * 0.27 * fit.size,
        hy = iy + iry * 0.5 * fit.size;
      const gloss = (female ? 0.00075 : 0.00047) * Math.sqrt(fit.size);
      const movable = (part, geometry, material) =>
        add(
          "Eye / " + name + " / " + part,
          blinkRecess(
            addGlobeGaze(
              geometry,
              pivot,
              side * pupilRestYaw(fit.spacing),
              fit.height * 0.18,
            ),
          ),
          material,
        );
      return [
        movable(
          "iris",
          band(
            cx,
            iy,
            irx,
            iry,
            0,
            1,
            irisFront,
            frontRings(14, 0.00002, 0.00058),
          ),
          iris,
        ),
        movable(
          "pupil",
          band(
            cx,
            iy,
            rx,
            ry,
            0,
            1,
            pupilFront,
            frontRings(10, 0.00003, 0.00041),
          ),
          ink,
        ),
        movable(
          "catchlight",
          band(
            hx,
            hy,
            gloss,
            gloss * 1.05,
            0,
            1,
            pupilFront,
            frontRings(4, 0.00018, 0.00006),
            24,
          ),
          spec,
        ),
      ];
    });
    const lidMat = mat("#ffffff", true, { roughness: 0.76 });
    const lashMat = mat(female ? "#34252a" : "#574338", false, {
      roughness: 0.82,
    });
    add(
      "Eye / " + name + " / upper lid",
      blinkGeometry((blink) => lidSurface(true, blink)),
      lidMat,
      "eyelid",
    );
    add(
      "Eye / " + name + " / lower lid",
      blinkGeometry((blink) => lidSurface(false, blink)),
      lidMat,
      "eyelid",
    );
    add(
      "Eye / " + name + " / lash line",
      blinkGeometry((blink) => lashLine(blink, false)),
      lashMat,
    );
    if ((adjustments.lashLine?.lower ?? 0) > 0)
      add("Eye / " + name + " / lower lash line",
        blinkGeometry((blink) => lashLine(blink, false, false)), lashMat);
    if (female)
      add(
        "Eye / " + name + " / lash flick",
        blinkGeometry((blink) => lashWing(blink, false)),
        lashMat,
      );
  }
  if (opticalBuilders.length) {
    const create = (raw) => {
      const fit = pupilSettings(raw);
      return opticalBuilders.flatMap((make) => make(fit));
    };
    let meshes = create(adjustments.pupils);
    return (raw, release) => {
      for (const mesh of meshes) release(mesh);
      meshes = create(raw);
    };
  }
}
