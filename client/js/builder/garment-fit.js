// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";
import { shoeProfile } from "./wardrobe-catalog.js";
import coverageMasks from "/assets/builder/garment-coverage.js";
import { getReferenceHead } from "./reference-head.js";
import { sleevePanels, fairUnderarms } from "./sleeve-rig.js";
import { waistbandSeam, sewWaistFacing } from "./waist-facing.js";

// Horizontal cross sections in foundation bind space. Intersect the triangles,
// including between their vertices, so the skirt can follow the actual seat
// and a waistband fits the particular outer garment selected in the editor.
const directions = 112;
const full = Math.PI * 2;
const step = full / directions;
const cos = Array.from({ length: directions }, (_, i) => Math.cos(i * step));
const sin = Array.from({ length: directions }, (_, i) => Math.sin(i * step));
const wrap = (i) => ((i % directions) + directions) % directions;
const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

function sections(geometries, lo, hi, cx = 0, cz = 0, accept = null, innerLimit = null) {
  const rows = Math.ceil((hi - lo) / 0.002) + 1;
  const dy = (hi - lo) / (rows - 1);
  const values = new Float32Array(rows * directions);
  for (const g of geometries) {
    const pos = g.attributes.position,
      ix = g.index;
    for (let k = 0; k < ix.count; k += 3) {
      const aa = ix.getX(k),
        bb = ix.getX(k + 1),
        cc = ix.getX(k + 2);
      if (accept && !accept(g, aa, bb, cc)) continue;
      const a = pos.getY(aa),
        b = pos.getY(bb),
        c = pos.getY(cc);
      const i0 = Math.max(0, Math.ceil((Math.min(a, b, c) - lo) / dy)),
        i1 = Math.min(rows - 1, Math.floor((Math.max(a, b, c) - lo) / dy));
      if (i0 > i1) continue;
      const ids = [aa, bb, cc],
        ys = [a, b, c];
      for (let row = i0; row <= i1; row++) {
        const y = lo + row * dy,
          points = [];
        for (let e = 0; e < 3; e++) {
          const next = (e + 1) % 3;
          if (ys[e] <= y === ys[next] <= y) continue;
          const u = (y - ys[e]) / (ys[next] - ys[e]);
          const p = ids[e],
            q = ids[next];
          points.push([
            THREE.MathUtils.lerp(pos.getX(p), pos.getX(q), u) - cx,
            THREE.MathUtils.lerp(pos.getZ(p), pos.getZ(q), u) - cz,
          ]);
        }
        if (points.length !== 2) continue;
        const [[x, z], [bx, bz]] = points,
          dx = bx - x,
          dz = bz - z;
        const a0 = Math.atan2(x, z),
          a1 =
            a0 +
            Math.atan2(
              Math.sin(Math.atan2(bx, bz) - a0),
              Math.cos(Math.atan2(bx, bz) - a0),
            );
        const first = Math.ceil(Math.min(a0, a1) / step - 1e-6),
          last = Math.floor(Math.max(a0, a1) / step + 1e-6);
        for (let n = first; n <= last; n++) {
          const j = wrap(n),
            det = sin[j] * dz - cos[j] * dx;
          if (Math.abs(det) < 1e-12) continue;
          const r = (x * dz - z * dx) / det,
            at = row * directions + j;
          if (innerLimit) {
            if (r >= innerLimit[j] && (!values[at] || r < values[at])) values[at] = r;
          } else if (r > values[at]) values[at] = r;
        }
      }
    }
  }
  return { values, lo, dy, rows, cx, cz };
}
function sample(grid, x, y, z) {
  const u = Math.atan2(x - grid.cx, z - grid.cz) / step,
    v = clamp((y - grid.lo) / grid.dy, 0, grid.rows - 1);
  const a = Math.floor(u),
    b = Math.floor(v),
    t = u - a,
    s = v - b;
  const arr = grid.values,
    index = b * directions,
    next = Math.min(b + 1, grid.rows - 1) * directions;
  const mix = THREE.MathUtils.lerp;
  return mix(
    mix(arr[index + wrap(a)], arr[index + wrap(a + 1)], t),
    mix(arr[next + wrap(a)], arr[next + wrap(a + 1)], t),
    s,
  );
}
function neededEase(body, cloth, gap) {
  const raw = Float32Array.from(cloth.values, (r, i) =>
    r > 0.008 && body.values[i] > 0.006
      ? Math.max(0, body.values[i] + gap - r)
      : 0,
  );
  const values = new Float32Array(raw.length);
  // Spread local corrections over a few neighbouring sections. The seat
  // stays a draped panel instead of imprinting the gluteal crease in fabric.
  for (let row = 0; row < body.rows; row++)
    for (let col = 0; col < directions; col++) {
      let sum = 0,
        weight = 0,
        max = 0;
      for (let j = -4; j <= 4; j++)
        for (let i = -4; i <= 4; i++) {
          const v =
              raw[
                clamp(row + j, 0, body.rows - 1) * directions + wrap(col + i)
              ],
            w = (5 - Math.abs(i)) * (5 - Math.abs(j));
          sum += v * w;
          weight += w;
          if (v > max) max = v;
        }
      values[row * directions + col] = Math.max(
        raw[row * directions + col],
        (sum / weight) * 0.55 + max * 0.45,
      );
    }
  return { ...cloth, values };
}
const cache = new WeakMap();
function forBody(body) {
  if (!cache.has(body)) cache.set(body, new Map());
  return cache.get(body);
}

// Relax the clavicle panel against the clothed body's union of torso and neck.
function supportNecklineYoke(g, skin, low, cz) {
  const p = g.attributes.position;
  // Lowering the neckband also moves the upper yoke over the sloping
  // clavicles. Lift/expand the drape along the actual skin normal so the
  // shoulder remains covered all the way to the newly seated opening.
  for (let pass = 0; pass < 2; pass++) {
    const dressed = sections(
      [g],
      skin.lo,
      skin.lo + skin.dy * (skin.rows - 1),
      0,
      cz,
    );
    const radial = new Float32Array(skin.values.length),
      lift = radial.slice();
    for (let row = 1; row < skin.rows - 1; row++)
      for (let j = 0; j < directions; j++) {
        const i = row * directions + j,
          fabric = dressed.values[i],
          radius = skin.values[i];
        if (fabric < 0.015 || radius < 0.014 || fabric > 0.13 || radius > 0.146)
          continue;
        const above = skin.values[i + directions] || radius,
          below = skin.values[i - directions] || radius;
        const slope = clamp((above - below) / (2 * skin.dy), -5, 4);
        const norm = Math.sqrt(1 + slope * slope);
        const gap = (radius - fabric) / norm + 0.0028;
        if (gap <= 0) continue;
        const offset = Math.min(0.013, gap * 1.1) / norm;
        radial[i] = offset;
        lift[i] = -slope * offset;
      }
    // The horizontal section can jump at a clavicle or a lapel. Spread the
    // normal displacement across neighbouring rows before moving the yoke.
    const rg = { ...skin, values: radial.slice() },
      yg = { ...skin, values: lift.slice() };
    for (let row = 3; row < skin.rows - 3; row++)
      for (let j = 0; j < directions; j++) {
        let r = 0,
          h = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const i = (row + dy) * directions + wrap(j + dx),
              w = (4 - Math.abs(dy)) * (3 - Math.abs(dx));
            r += w * radial[i];
            h += w * lift[i];
          }
        const i = row * directions + j;
        rg.values[i] = r / 144;
        yg.values[i] = h / 144;
      }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i) - cz,
        r = Math.hypot(x, z);
      const w =
        smooth(y, low - 0.006, low + 0.012) * (1 - smooth(r, 0.103, 0.126));
      if (!w || !r) continue;
      const dr = sample(rg, x, y, cz + z) * w,
        dy = sample(yg, x, y, cz + z) * w;
      p.setXYZ(i, x * (1 + dr / r), y + dy, cz + z * (1 + dr / r));
    }
  }
}

// Move the sewn cap and its overlays in one smooth field. Extruding along each
// piece's own normals would separate a seam from its topstitching or lining.
function easeSleeveCaps(body, g, cuffY, neckRadii, neckZ) {
  const p = g.attributes.position;
  const point = new THREE.Vector3(),
    onClavicle = new THREE.Vector3(),
    onArm = new THREE.Vector3();
  const origin = body.restJointPosition("Neck");
  for (const [side, sign] of [
    ["Left", 1],
    ["Right", -1],
  ]) {
    const clavicle = body.restJointPosition(side + "Shoulder");
    const shoulder = body.restJointPosition(side + "Arm");
    const elbow = body.restJointPosition(side + "ForeArm");
    const collarbone = new THREE.Line3(clavicle, shoulder);
    const humerus = new THREE.Line3(shoulder, elbow);
    const inner = sign * (clavicle.x - origin.x) + 0.02;
    const low = Math.max(cuffY + 0.014, shoulder.y - 0.095);
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i);
      const across = sign * (point.x - origin.x);
      if (across <= inner || point.y <= low) continue;
      const angle = Math.atan2(point.x, point.z - neckZ) / step;
      const j = Math.floor(angle);
      const rim = THREE.MathUtils.lerp(
        neckRadii[wrap(j)],
        neckRadii[wrap(j + 1)],
        angle - j,
      );
      const fromNeck = Math.hypot(point.x, point.z - neckZ) - rim;
      if (fromNeck <= 0.006) continue;
      collarbone.closestPointToPoint(point, true, onClavicle);
      humerus.closestPointToPoint(point, true, onArm);
      const dc = point.distanceTo(onClavicle),
        da = point.distanceTo(onArm);
      // Blend the two bone axes over the deltoid. Points at the same place
      // in the shell, piping and lining receive exactly the same offset.
      onClavicle.lerp(onArm, smooth(dc - da, -0.016, 0.016));
      const outward = point.sub(onClavicle);
      const distance = outward.length();
      const fit =
        smooth(across, inner, inner + 0.024) *
        smooth(p.getY(i), low, low + 0.04) *
        smooth(fromNeck, 0.006, 0.023) *
        (1 - smooth(distance, 0.055, 0.082));
      if (!fit) continue;
      const scale = (0.0035 * fit) / Math.max(distance, 0.02);
      p.setXYZ(
        i,
        p.getX(i) + outward.x * scale,
        p.getY(i) + outward.y * scale,
        p.getZ(i) + outward.z * scale,
      );
    }
  }
}

function fitUpperBody(body, { g, style, design }, originalHead) {
  const cache = forBody(body);
  const key = "neckline/" + style + "/" + originalHead;
  const p = g.attributes.position;
  if (cache.has(key)) {
    p.array.set(cache.get(key));
    p.needsUpdate = true;
    return;
  }
  const female = body.gender === "female";
  const cz = female ? -0.012 : -0.02;
  const low = female ? 0.738 : 0.761,
    high = female ? 0.865 : 0.887;
  const skinKey = "neck-surface/" + originalHead;
  if (!cache.has(skinKey)) {
    const neck = originalHead
      ? body.restGeometry("head")
      : getReferenceHead(body.gender).skin;
    cache.set(
      skinKey,
      sections([body.restGeometry("torso"), neck], low - 0.014, high, 0, cz),
    );
  }
  const skin = cache.get(skinKey);
  const nominal = cos.map((facing) =>
    female ? 0.041 - 0.0065 * facing : 0.046 - 0.009 * facing,
  );
  // Locate the visible neckband rather than the underside of a turned lapel.
  // Its radial/vertical position varies around a scoop, stand, or boatneck.
  const cloth = sections(
    [g],
    low,
    high,
    0,
    cz,
    null,
    nominal.map((r) => r * 0.73),
  );
  const rings = nominal.map((r, j) => {
    const collarY = female ? 0.826 - 0.004 * cos[j] : 0.847;
    let score = Infinity,
      rimR = r,
      rimY = collarY;
    for (let i = 0; i < cloth.rows; i++) {
      const y = cloth.lo + i * cloth.dy,
        radius = cloth.values[i * directions + j];
      if (!radius || radius > r + 0.042) continue;
      const cost =
        radius +
        Math.abs(y - collarY) * 0.42 +
        Math.max(0, collarY - 0.028 - y) * 1.4;
      if (cost < score) {
        score = cost;
        rimR = radius;
        rimY = y;
      }
    }
    return { r: rimR, y: rimY, found: Number.isFinite(score) };
  });
  const drop = [],
    pull = [],
    band = [],
    levels = [],
    skinAtBand = [];
  const hood = design?.cut === "hoodie" || design?.cut === "layerDenim";
  for (let j = 0; j < directions; j++) {
    const ring = rings[j],
      front = Math.max(0, cos[j]),
      back = Math.max(0, -cos[j]);
    const closed = smooth(ring.y, low + 0.014, female ? 0.81 : 0.835);
    const lower =
      (female
        ? 0.005 + 0.013 * front ** 1.5 + 0.004 * back
        : 0.006 + 0.024 * front ** 1.5 + 0.005 * back) * closed;
    const y = ring.y - lower;
    const rad = sample(skin, sin[j] * ring.r, y, cz + cos[j] * ring.r);
    const ease = 0.0034 + (1 - closed) * 0.0025 + (hood ? 0.0025 * back : 0);
    drop[j] = ring.found ? lower : 0;
    pull[j] =
      ring.found && rad > 0 ? clamp(rad + ease - ring.r, -0.023, 0.024) : 0;
    band[j] = ring.r;
    levels[j] = ring.y;
    skinAtBand[j] = rad;
  }
  // A smooth field carries the binding, its foldback, seams and underlayer
  // together. Preserve the height and flare of cuts outside the neck seat.
  function smoothRing(values) {
    return values.map((_, j) => {
      let sum = 0;
      for (let k = -3; k <= 3; k++)
        sum += (4 - Math.abs(k)) * values[wrap(j + k)];
      return sum / 16;
    });
  }
  const dy = smoothRing(drop),
    dr = smoothRing(pull),
    edge = smoothRing(band);
  const by = smoothRing(levels),
    bodyR = smoothRing(skinAtBand);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i) - cz,
      r = Math.hypot(x, z);
    if (y <= low - 0.043 || !r) continue;
    const theta = Math.atan2(x, z) / step,
      j = Math.floor(theta),
      t = theta - j;
    const read = (row) =>
      THREE.MathUtils.lerp(row[wrap(j)], row[wrap(j + 1)], t);
    const rim = read(edge);
    const w =
      smooth(y, low - 0.043, female ? 0.806 : 0.831) *
      (1 - smooth(r, rim + 0.017, rim + 0.082)) *
      (1 - smooth(y, high - 0.006, high + 0.018));
    if (!w) continue;
    const newY = y - w * read(dy);
    const stand = smooth(y - read(by), 0, 0.004);
    const curve =
      stand * clamp(sample(skin, x, newY, cz + z) - read(bodyR), -0.016, 0.019);
    const scale = 1 + (w * (read(dr) + curve)) / r;
    p.setXYZ(i, x * scale, newY, cz + z * scale);
  }
  supportNecklineYoke(g, skin, low, cz);
  if (design?.cut !== "armor") {
    const cuffY =
      design?.sleeve ??
      (female ? [0.68, 0.67, 0.522] : [0.681, 0.688, 0.506])[style];
    easeSleeveCaps(
      body,
      g,
      cuffY,
      edge.map((radius, j) => radius + dr[j]),
      cz,
    );
  }
  p.needsUpdate = true;
  cache.set(key, p.array.slice());
}
function tailorShell(body, g, slot, style) {
  if (
    (slot === "shoes" ? style >= 6 || shoeProfile(style) !== 0 : style !== 0) ||
    !(slot === "shoes" || (slot === "bottom" && body.gender === "female"))
  )
    return;
  const p = g.attributes.position,
    saved = forBody(body),
    key = "fit/" + slot + "/" + style;
  if (saved.has(key)) {
    p.array.set(saved.get(key));
    p.needsUpdate = true;
    return;
  }
  const skirt = slot === "bottom";
  const sides = skirt ? [0] : [-1, 1];
  for (const side of sides) {
    const targets = (
      skirt
        ? ["torso", "leftLeg", "rightLeg"]
        : [side > 0 ? "leftLeg" : "rightLeg"]
    ).map((k) => body.restGeometry(k));
    const lo = skirt ? 0.426 : 0.0004,
      hi = skirt ? 0.609 : 0.052,
      cx = skirt ? 0 : side * 0.102,
      cz = skirt ? 0 : -0.024;
    const cloth = sections(
      [g],
      lo,
      hi,
      cx,
      cz,
      (_, a) => !side || p.getX(a) * side > 0,
    );
    const skin = sections(targets, lo, hi, cx, cz);
    const ease = neededEase(skin, cloth, skirt ? 0.0045 : 0.0022);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      if (side && x * side < 0) continue;
      const fade = skirt ? smooth(y, 0.396, lo) : 1 - smooth(y, 0.039, 0.06);
      if (!fade) continue;
      const r = Math.hypot(x - cx, z - cz),
        shellRadius = sample(cloth, x, y, z);
      if (r < 0.001 || shellRadius < 0.005) continue;
      const scale =
        1 + (fade * sample(ease, x, y, z)) / Math.max(r, shellRadius);
      p.setXYZ(i, cx + (x - cx) * scale, y, cz + (z - cz) * scale);
    }
  }
  saved.set(key, p.array.slice());
  p.needsUpdate = true;
}
const hems = { female: [0.602, 0.579, 0.573], male: [0.572, 0.565, 0.568] };
function tuckUnder(inside, outer, hem, side = 0, openFront = false) {
  const p = inside.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    if (y < hem - 0.011 || (side && x * side < 0)) continue;
    const limit = sample(outer, x, y, z) - (side ? 0.003 : 0.0055),
      r = Math.hypot(x - outer.cx, z - outer.cz);
    if (limit < (side ? 0.011 : 0.025) || r <= limit) continue;
    // At the overcoat opening a radial sample can straddle a panel edge
    // and empty space. The visible front rise stays in the trousers' own cut.
    const facing = openFront && z > .004 ? smooth(Math.abs(x), .035, .052) : 1;
    const amount = facing * smooth(y, hem - 0.011, hem + 0.001),
      scale = 1 - amount * (1 - limit / r);
    p.setXYZ(
      i,
      outer.cx + (x - outer.cx) * scale,
      y,
      outer.cz + (z - outer.cz) * scale,
    );
  }
  p.needsUpdate = true;
}
function tuckWaist(body, bottom, top, topStyle, hem, waist) {
  const hi = Math.max(body.gender === "female" ? 0.617 : 0.599, waist + 0.003);
  if (hem + 0.001 >= hi) return;
  const cache = forBody(body),
    key = "waist/" + topStyle + "/" + hi;
  if (!cache.has(key)) {
    const part = top.userData.fitParts;
    cache.set(
      key,
      sections(
        [top],
        hem + 0.001,
        hi,
        0,
        0,
        (_, a, b, c) => !part || [a, b, c].every((i) => part[i] === "torso"),
      ),
    );
  }
  tuckUnder(bottom, cache.get(key), hem);
}
function fitCoatLayers(body, top, bottom) {
  const hem = top.design.hem, waist = Math.max(.62, bottom.design?.waist ?? 0);
  const cache = forBody(body), key = "coat-inner/" + top.style + "/" + waist;
  if (!cache.has(key)) {
    const sides = top.g.userData.fitParts;
    // The hem panels follow both thighs in motion. Include those panels
    // when measuring the inner face, and exclude the independently hanging
    // sleeves. Empty rays through a coat opening leave that trouser area free.
    const shell = sections([top.g], hem + .0007, waist, 0, 0,
      (_,a,b,c) => [a,b,c].every(i => !sides[i].endsWith("Arm")));
    cache.set(key,shell);
  }
  tuckUnder(bottom.g, cache.get(key), hem, 0, top.design.cut === "overcoat");
}
function finishWaist(body, bottom) {
  const waist = bottom.design?.waist ?? (body.gender === "female" ? .611 : .593);
  const saved = forBody(body), key = "waist-opening/" + bottom.style;
  if (!saved.has(key)) saved.set(key, waistbandSeam(bottom.g, waist));
  if (!saved.has("waist-skin"))
    saved.set("waist-skin", sections([body.restGeometry("torso")], .54, .63));
  const skin = saved.get("waist-skin");
  const paint = foundationPaintSamples(body, "torso", .52, .66);
  const totals = new Float64Array(body.bones.length);
  sewWaistFacing(bottom.g, saved.get(key), (x, y, z, i) => {
    // A real facing turns down against the torso, keeping an unbroken ring
    // even when a tucked shirt narrows the outside rim. Finish just inside
    // the skin so a grazing view cannot see into the masked pelvis.
    const h = y - .002, r = Math.hypot(x, z);
    const skinRadius = sample(skin, x, h, z);
    const scale = Math.min(r - .0006, skinRadius - .005) / r;
    totals.fill(0);
    mixFoundationPaint(paint, x * skinRadius / r, h, z * skinRadius / r, 1, totals);
    writeJointWeights(bottom.g.attributes.skinIndex, bottom.g.attributes.skinWeight, i, totals);
    return [x * scale, h, z * scale];
  });
}
function fitTrouserCuffs(body, shoes, bottom) {
  const hem = bottom.design
    ? bottom.design.tuckShoe
      ? bottom.design.hem
      : 0
    : (body.gender === "female" ? [0, 0.064, 0] : [0.08, 0, 0.058])[
        bottom.style
      ];
  if (!hem) return;
  const p = bottom.g.attributes.position;
  const upper = shoes.g.attributes.position;
  shoes.g.computeBoundingBox();
  const peak = shoes.g.boundingBox.max.y;
  if (peak < hem + 0.025) return;
  // Fit the draping trouser cuff over the tongue and shaft. Changing trousers
  // must never alter the shape of the counter, eye stays or lace bed.
  const low = Math.max(0.012, hem - 0.018);
  const cache = forBody(body);
  for (const side of [-1, 1]) {
    const key = "shoe-cuff/" + shoes.style + "/" + low + "/" + side;
    if (!cache.has(key)) {
      const grid = sections(
        [shoes.g],
        low,
        Math.max(low + 0.004, peak),
        side * 0.091,
        -0.04,
        (_, a, b, c) => [a, b, c].every((i) => upper.getX(i) * side > 0),
      );
      cache.set(key, grid);
    }
    const grid = cache.get(key);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      if (x * side <= 0 || y < low || y > peak + 0.025) continue;
      const dx = x - grid.cx,
        dz = z - grid.cz,
        radius = Math.hypot(dx, dz);
      if (radius < 0.001) continue;
      // Spread the bulk of a raised tongue into the cloth above its top edge.
      let required = 0;
      for (const offset of [0, 0.005, 0.01]) {
        if (y - offset > peak || y - offset < low) continue;
        const level = y - offset;
        // Only a closed shaft needs the cuff released. A tongue can
        // sit in front of a trouser break without changing its outline.
        const quarter = sample(grid, grid.cx + 0.03, level, grid.cz);
        const otherQuarter = sample(grid, grid.cx - 0.03, level, grid.cz);
        if (Math.min(quarter, otherQuarter) < 0.012) continue;
        required = Math.max(
          required,
          Math.min(
            sample(grid, x, level, z),
            1.26 * Math.max(quarter, otherQuarter),
          ) -
            offset * 0.58,
        );
      }
      if (required <= 0 || radius >= required + 0.003) continue;
      const scale = 1 + Math.min(0.008, required + 0.003 - radius) / radius;
      p.setXYZ(i, grid.cx + dx * scale, y, grid.cz + dz * scale);
    }
  }
  p.needsUpdate = true;
}

// Preserve local rig paint around a fitted joint. The front and back of a
// limb or clavicle can have very different weights at the same height.
function foundationPaintSamples(body, part, low, high) {
  const cache = forBody(body);
  const key = "paint/" + part + "/" + low + "/" + high;
  if (!cache.has(key)) {
    const { position, skinIndex, skinWeight } = body.restGeometry(part).attributes;
    const bands = [];
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y < low || y > high) continue;
      const band = Math.floor(y / .02);
      (bands[band] ??= []).push(i);
    }
    cache.set(key, { position, skinIndex, skinWeight, bands });
  }
  return cache.get(key);
}

function mixFoundationPaint(samples, x, y, z, amount, totals, count = 8, softness = .000007) {
  if (amount <= 0) return;
  const { position, skinIndex, skinWeight, bands } = samples;
  const band = Math.floor(y / .02);
  const near = [];
  // Search height bands in both directions until even a vertically aligned
  // vertex in the next band would be farther than the retained samples.
  for (let delta = 0; delta < bands.length; delta++) {
    for (const index of delta ? [band - delta, band + delta] : [band]) {
      for (const i of bands[index] ?? []) {
        const d = (x - position.getX(i)) ** 2 + (y - position.getY(i)) ** 2 +
          (z - position.getZ(i)) ** 2;
        if (near.length === count && d >= near[count - 1].d) continue;
        let rank = near.length;
        while (rank && near[rank - 1].d > d) rank--;
        near.splice(rank, 0, { i, d });
        if (near.length > count) near.pop();
      }
    }
    if (near.length === count && (delta * .02) ** 2 >= near[count - 1].d) break;
  }
  let sum = 0;
  for (const point of near) {
    point.weight = (point.d + softness) ** -1.4;
    sum += point.weight;
  }
  for (const { i, weight } of near) {
    const scale = amount * weight / sum;
    for (let lane = 0; lane < 4; lane++)
      totals[skinIndex.getComponent(i, lane)] += scale * skinWeight.getComponent(i, lane);
  }
}

function writeJointWeights(joints, weights, i, totals) {
  const best = [];
  for (let joint = 0; joint < totals.length; joint++)
    if (totals[joint] > 0) best.push(joint);
  best.sort((a, b) => totals[b] - totals[a]);
  const total = best.slice(0, 4).reduce((sum, joint) => sum + totals[joint], 0);
  for (let lane = 0; lane < 4; lane++) {
    const joint = best[lane] ?? 0;
    joints.setComponent(i, lane, joint);
    weights.setComponent(i, lane, lane < best.length ? totals[joint] / total : 0);
  }
}

function bindSleeves(body, { g, style, design }, originalHead) {
  if (design?.cut === "armor" || !g.userData.armBlend) return;
  const cache = forBody(body), key = "sleeve-fit/" + style + "/" + originalHead;
  if (!cache.has(key)) {
    const shoulder = body.restJointPosition("RightArm");
    const panels = sleevePanels(g, shoulder, body.restJointPosition("RightForeArm"), body.gender);
    if (!panels) return;
    const { ratio, zone, rim } = panels;
    const p = g.attributes.position, blend = g.userData.armBlend.slice();
    const joints = g.attributes.skinIndex.clone(), weights = g.attributes.skinWeight.clone();
    const totals = new Float64Array(body.bones.length);
    const skin = ["torso", "leftArm", "rightArm"].map((part) =>
      foundationPaintSamples(body, part, .57, .86));
    const boneIndex = (name) => body.bones.indexOf(body.boneMap.get(name));
    const armBones = ["LeftArm", "RightArm"].map(boneIndex);
    for (let i = 0; i < p.count; i++) {
      if (!zone[i]) continue;
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), side = Number(x < 0);
      const field = zone[i] * (1 - rim[i]);
      totals.fill(0);
      for (let lane = 0; lane < 4; lane++)
        totals[joints.getComponent(i, lane)] += (1 - zone[i]) * (1 - rim[i]) * weights.getComponent(i, lane);
      mixFoundationPaint(skin[0], x, y, z, field * (1 - ratio[i]), totals, 16, .000022);
      mixFoundationPaint(skin[1 + side], x, y, z, field * ratio[i], totals, 16, .000022);
      totals[armBones[side]] += rim[i];
      writeJointWeights(joints, weights, i, totals);
      blend[i] = Math.round(THREE.MathUtils.lerp(blend[i], ratio[i] * 255, zone[i]));
    }
    const armJoints = new Set([...armBones, boneIndex("LeftForeArm"), boneIndex("RightForeArm")]);
    fairUnderarms(g, panels, shoulder, armJoints, joints, weights);
    cache.set(key, { joints, weights, blend, positions: p.array.slice() });
  }
  const { joints, weights, blend, positions } = cache.get(key);
  g.attributes.position.array.set(positions);
  g.setAttribute("skinIndex", joints.clone());
  g.setAttribute("skinWeight", weights.clone());
  g.userData.armBlend = blend;
}

// The front of the Ballet wrap crosses the clavicle and bends with it when
// the arms fold inward. Transfer the fitted torso's local joint influences
// to the cloth and its binding together, blending back into the sleeve paint.
function weightWrapYoke(body, g, originalHead) {
  const cache = forBody(body),
    key = "wrap-yoke/" + originalHead;
  if (!cache.has(key)) {
    const p = g.attributes.position;
    const joints = g.attributes.skinIndex.clone(),
      weights = g.attributes.skinWeight.clone();
    const skin = foundationPaintSamples(body, "torso", 0.7, 0.86);
    const totals = new Float64Array(body.bones.length);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      const across = Math.abs(x);
      const influence =
        smooth(y, 0.715, 0.755) *
        (1 - smooth(y, 0.825, 0.851)) *
        smooth(across, 0.014, 0.043) *
        (1 - smooth(across, 0.083, 0.105)) *
        smooth(z, -0.057, -0.025);
      if (!influence) continue;
      totals.fill(0);
      for (let lane = 0; lane < 4; lane++)
        totals[joints.getComponent(i, lane)] +=
          (1 - influence) * weights.getComponent(i, lane);
      mixFoundationPaint(skin, x, y, z, influence, totals);
      writeJointWeights(joints, weights, i, totals);
    }
    cache.set(key, { joints, weights });
  }
  const { joints, weights } = cache.get(key);
  g.setAttribute("skinIndex", joints.clone());
  g.setAttribute("skinWeight", weights.clone());
}

function weightHangingPanels(body, { g, style, design }) {
  const cache = forBody(body);
  const key = "skirt-drape/" + style;
  if (!cache.has(key)) {
    const p = g.attributes.position;
    // Decoded clothing packets are shared by subsequent equips and by other
    // avatars. Only the fitted geometry receives this foundation's joint paint.
    const joints = g.attributes.skinIndex.clone();
    const weights = g.attributes.skinWeight.clone();
    const leftLeg = foundationPaintSamples(body, "leftLeg", .14, .65);
    const rightLeg = foundationPaintSamples(body, "rightLeg", .14, .65);
    const totals = new Float64Array(body.bones.length);
    const waist = design?.waist ?? .611;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const yoke = smooth(y, .516, Math.min(.593, waist));
      if (yoke === 1) continue;
      totals.fill(0);
      for (let lane = 0; lane < 4; lane++)
        totals[joints.getComponent(i, lane)] += yoke * weights.getComponent(i, lane);
      const left = smooth(x, -.051, .051);
      const reach = Math.max(.021, Math.abs(x));
      mixFoundationPaint(leftLeg, reach, y, z, left * (1 - yoke), totals);
      mixFoundationPaint(rightLeg, -reach, y, z, (1 - left) * (1 - yoke), totals);
      writeJointWeights(joints, weights, i, totals);
    }
    cache.set(key, { joints, weights });
  }
  const { joints, weights } = cache.get(key);
  g.setAttribute("skinIndex", joints.clone());
  g.setAttribute("skinWeight", weights.clone());
}
export function fitGarments(body, items, originalHead = false) {
  for (const [slot, { style, g }] of items) tailorShell(body, g, slot, style);
  const shirt = items.get("top");
  if (shirt) {
    fitUpperBody(body, shirt, originalHead);
    bindSleeves(body, shirt, originalHead);
    if (body.gender === "female" && shirt.style === 3) weightWrapYoke(body, shirt.g, originalHead);
  }
  const outer = items.get("top")?.design, inner = items.get("bottom")?.design;
  const lower = items.get("bottom");
  if ((inner?.skirt && !inner.source) || (body.gender === "female" && lower?.style === 0))
    weightHangingPanels(body, lower);
  if (
    items.has("top") &&
    items.has("bottom") &&
    !outer?.coat && outer?.cut !== "tunic" && outer?.cut !== "blazer" && !(outer?.cut === "armor" && inner?.cut === "armor")
  ) {
    const top = items.get("top");
    const bottom = items.get("bottom");
    tuckWaist(
      body,
      bottom.g,
      top.g,
      top.style,
      top.design?.hem ?? hems[body.gender][top.style],
      bottom.design?.waist ?? (body.gender === "female" ? 0.611 : 0.593),
    );
  }
  if (lower && (outer?.coat || outer?.cut === "tunic")) fitCoatLayers(body, shirt, lower);
  if (items.has("shoes") && items.has("bottom")) {
    const bottom = items.get("bottom");
    const shoes = items.get("shoes");
    fitTrouserCuffs(body, shoes, bottom);
  }
  if (lower) finishWaist(body, lower);
  for (const { g } of items.values()) g.computeVertexNormals();
  const top = items.get("top"),
    bottom = items.get("bottom");
  const packed =
    coverageMasks[body.gender].layers?.[top?.style]?.[bottom?.style];
  if (packed) {
    const g = bottom.g,
      faces = g.index.array,
      kept = [];
    const bits = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
    const groups = g.groups.slice();
    g.clearGroups();
    for (const { start, count, materialIndex } of groups) {
      const at = kept.length;
      for (let i = start; i < start + count; i += 3) {
        const triangle = i / 3;
        if (!(bits[triangle >>> 3] & (1 << (triangle & 7))))
          kept.push(faces[i], faces[i + 1], faces[i + 2]);
      }
      if (kept.length > at) g.addGroup(at, kept.length - at, materialIndex);
    }
    g.setIndex(new THREE.BufferAttribute(faces.constructor.from(kept), 1));
  }
}

// These triangles sit wholly inside a garment, away from its hem, cuff or
// neckline. Removing them prevents skin breakthrough when the leg bones
// separate under a skirt. The source index is restored as soon as it is bare.
const coverageOwner = new WeakMap();
function skirtLiningTop(body, geometry, style) {
  const cache = forBody(body);
  const key = "liningTop/" + style;
  if (cache.has(key)) return cache.get(key);
  // The outer hem rolls back up inside the sculpt. Find the lowest open
  // loop and then follow it around the entire lining, including its high
  // back edge. That interior edge is where masking can safely begin.
  const p = geometry.attributes.position,
    idx = geometry.index,
    n = p.count,
    edges = new Map();
  for (let i = 0; i < idx.count; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = idx.getX(i + j),
        b = idx.getX(i + ((j + 1) % 3)),
        key = Math.min(a, b) * n + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const neighbors = new Map();
  let lowest = -1;
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    const a = Math.floor(key / n),
      b = key % n;
    for (const [u, v] of [
      [a, b],
      [b, a],
    ]) {
      if (!neighbors.has(u)) neighbors.set(u, []);
      neighbors.get(u).push(v);
      if (lowest < 0 || p.getY(u) < p.getY(lowest)) lowest = u;
    }
  }
  const seen = new Set(),
    stack = lowest < 0 ? [] : [lowest];
  let high = 0;
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i)) continue;
    seen.add(i);
    high = Math.max(high, p.getY(i));
    stack.push(...neighbors.get(i));
  }
  // A closed replacement skirt can keep the original full thigh underneath.
  const limit = lowest < 0 ? Infinity : high + 0.025;
  cache.set(key, limit);
  return limit;
}
// Original torso faces visible across each collar in bind and studio poses.
// Measured at the actual neckline, including the distant clavicle in profile.
// Rows follow the thirteen original top patterns on each supplied foundation.
const collarInterior = {
  female: [
    [
      2082, 2084, 2085, 2094, 2098, 2339, 2340, 2341, 2343, 2344, 2368, 2369, 2370,
      2371, 2373, 2375, 2379, 2637, 2642, 2643, 2661, 2662, 2663, 2664, 2668
    ],
    [2637],
    [2082, 2085, 2094, 2098, 2637, 2642, 2643, 2661, 2662, 2664, 2668],
    [
      993, 1699, 1700, 1701, 1770, 1771, 1773, 1774, 1775, 1949, 1950, 1951, 1952,
      1953, 1954, 1956, 1957, 1958, 1960, 1961, 1962, 1964, 2056, 2073, 2111, 2112,
      2116, 2142, 2143, 2144, 2145, 2146, 2147, 2151, 2152, 2153, 2154, 2165, 2274,
      2276, 2278, 2339, 2340, 2341, 2342, 2343, 2344, 2345, 2346, 2347, 2348, 2350,
      2351, 2352, 2368, 2369, 2370, 2371, 2373, 2375, 2376, 2379, 2381, 2382, 2383,
      2637, 2642, 2643, 2667, 2673, 2674, 2675, 2680, 2688, 2691, 2698, 2756, 2760,
      2761, 2763, 2764, 2766, 2767, 2773, 2774, 2779, 2780, 2785, 2786, 2788, 2791,
      2794, 2800, 4207, 4208
    ],
    [
      1949, 1950, 1951, 1952, 1953, 1954, 1957, 1958, 1960, 1962, 1964, 1967, 1969,
      1977, 1978, 2056, 2077, 2082, 2084, 2085, 2094, 2098, 2111, 2112, 2116, 2130,
      2131, 2339, 2340, 2341, 2343, 2344, 2365, 2368, 2369, 2370, 2371, 2373, 2375,
      2379, 2382, 2637, 2642, 2643, 2661, 2662, 2663, 2664, 2665, 2667, 2668, 2671,
      2673, 2674, 2680, 2754, 2760, 2761, 2763, 2764, 2766, 2767, 2773, 2774, 2779,
      2780, 2785, 2786, 2788, 2791, 2794, 2800, 2801, 2888, 2892
    ],
    [2098, 2637, 2642, 2643, 2662],
    [],
    [
      971, 972, 976, 993, 1700, 1701, 1771, 1773, 1774, 1956, 1961, 2056, 2075,
      2076, 2077, 2080, 2082, 2084, 2085, 2094, 2098, 2111, 2112, 2116, 2142, 2143,
      2144, 2145, 2147, 2151, 2153, 2154, 2274, 2276, 2278, 2339, 2340, 2341, 2343,
      2344, 2347, 2348, 2352, 2368, 2369, 2370, 2371, 2373, 2375, 2376, 2379, 2382,
      2525, 2637, 2642, 2643, 2661, 2662, 2663, 2664, 2665, 2667, 2668, 2670, 2671,
      2673, 2674, 2675, 2680, 2688, 2698, 2756, 2760, 2761, 4189, 4190, 4207, 4208
    ],
    [2098, 2637, 2642, 2643, 2662],
    [
      1700, 1949, 1950, 1951, 1952, 1953, 1954, 1957, 1958, 1960, 1962, 1964, 1967,
      1969, 1977, 1978, 2056, 2073, 2075, 2076, 2077, 2082, 2084, 2085, 2094, 2098,
      2111, 2112, 2116, 2127, 2130, 2131, 2339, 2340, 2341, 2343, 2344, 2352, 2354,
      2363, 2365, 2368, 2369, 2370, 2371, 2373, 2375, 2379, 2382, 2637, 2642, 2643,
      2661, 2662, 2663, 2664, 2665, 2667, 2668, 2670, 2671, 2673, 2674, 2680, 2754,
      2760, 2761, 2763, 2764, 2766, 2767, 2773, 2774, 2779, 2780, 2785, 2786, 2788,
      2791, 2794, 2800, 2801, 2888, 2892, 2893
    ],
    [],
    [2056, 2082, 2084, 2085, 2111, 2637, 2642, 2661, 2662, 2663, 2664, 2668],
    [],
  ],
  male: [
    [
      2473, 2785, 2855, 2953, 2954, 2976, 3248, 3249, 3330, 3331, 3332, 3334, 3335,
      3416, 3417, 3433, 3536, 3540, 3542, 3543, 3545, 3696, 3700, 3800, 3806, 3807,
      3809
    ],
    [3036, 3447, 3699, 3700, 3800],
    [3700],
    [3036, 3447, 3699, 3700, 3800],
    [],
    [],
    [],
    [],
    [
      1313, 1315, 2432, 2433, 2522, 2523, 2527, 2752, 2753, 2754, 2953, 2954, 2955, 2976,
      3036, 3248, 3249, 3330, 3331, 3332, 3334, 3335, 3416, 3417, 3433, 3447, 3526, 3536,
      3540, 3542, 3543, 3545, 3696, 3699, 3700, 3800, 3806, 3807, 3809
    ],
    [],
    [
      1313, 1315, 2430, 2432, 2433, 2522, 2523, 2527, 2542, 2545, 2738, 2752, 2753, 2754,
      2879, 2953, 2954, 2955, 2976, 3036, 3248, 3330, 3331, 3332, 3334, 3335, 3416, 3417,
      3433, 3447, 3526, 3540, 3542, 3543, 3545, 3696, 3699, 3700, 3800, 3806, 3807, 3809
    ],
    [
      1313, 1315, 2017, 2430, 2432, 2433, 2506, 2522, 2523, 2527, 2542, 2545, 2738, 2752,
      2753, 2754, 2879, 3036, 3134, 3447, 3699, 3700, 3800
    ],
    [],
  ],
};

// Project a sleeve cap into bind-space XZ. A shrug or arm crossing can lift
// the lateral torso above the sleeve even when their bind silhouettes agree.
// The neckline and any genuinely bare shoulder have no fabric overhead.
function coveredShoulder(body, top, originalHead) {
  if (!top) return null;
  const cache = forBody(body), key = "shoulder-cap/" + top.style + "/" + originalHead;
  if (cache.has(key)) return cache.get(key);
  const female = body.gender === "female", floor = female ? .712 : .731;
  const step = .003, width = 96, depth = 80;
  const gridX = (x) => x / step + width / 2;
  const gridZ = (z) => z / step + depth / 2;
  const height = new Float32Array(width * depth);
  const cloth = top.g.attributes.position, faces = top.g.index;
  for (let i = 0; i < faces.count; i += 3) {
    const a = faces.getX(i), b = faces.getX(i + 1), c = faces.getX(i + 2);
    const ay = cloth.getY(a), by = cloth.getY(b), cy = cloth.getY(c);
    if (Math.max(ay, by, cy) < floor) continue;
    const ax = gridX(cloth.getX(a)), az = gridZ(cloth.getZ(a));
    const bx = gridX(cloth.getX(b)) - ax, bz = gridZ(cloth.getZ(b)) - az;
    const cx = gridX(cloth.getX(c)) - ax, cz = gridZ(cloth.getZ(c)) - az;
    const det = bx * cz - bz * cx;
    if (Math.abs(det) < 1e-8) continue;
    const xmin = Math.max(0, Math.ceil(ax + Math.min(0, bx, cx)));
    const xmax = Math.min(width - 1, Math.floor(ax + Math.max(0, bx, cx)));
    const zmin = Math.max(0, Math.ceil(az + Math.min(0, bz, cz)));
    const zmax = Math.min(depth - 1, Math.floor(az + Math.max(0, bz, cz)));
    for (let z = zmin; z <= zmax; z++)
      for (let x = xmin; x <= xmax; x++) {
        const u = ((x - ax) * cz - (z - az) * cx) / det;
        const v = (bx * (z - az) - bz * (x - ax)) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const k = x + width * z;
        height[k] = Math.max(height[k], ay + u * (by - ay) + v * (cy - ay));
      }
  }
  const p = body.restGeometry("torso").attributes.position;
  const near = [-width, -1, 0, 1, width];
  const interior = [-2 * width, -width - 1, -width + 1, -2, 2, width - 1, width + 1, 2 * width];
  const covered = Uint8Array.from({ length: p.count }, (_, i) => {
    const x = p.getX(i), y = p.getY(i);
    if (y < floor || Math.abs(x) < (female ? .052 : .061)) return 0;
    const k = Math.round(gridX(x)) + Math.round(gridZ(p.getZ(i))) * width;
    // Require cloth across a six-millimeter patch, keeping the interior lip
    // and bare side of even wide boatnecks and wrapped collars.
    if (!near.every((offset) => height[k + offset] > y - .002)) return 0;
    // Rebuilt tops have measured per-face masks at the openings. Supplement
    // those only where a wider patch of the fitted sleeve covers the skin.
    return !top.design?.source || interior.every((offset) => height[k + offset] > y - .005);
  });
  cache.set(key, covered);
  return covered;
}

export function coverFoundation(body, items, originalHead = false) {
  const sex = body.gender,
    female = sex === "female";
  const top = items.get("top")?.style,
    bottom = items.get("bottom")?.style,
    shoes = items.get("shoes")?.style;
  // The smooth trainer and low shoe have deeper, open throats. Keep the
  // instep intact where it can be seen from above their padded collars.
  const shoeCoverHeight =
    items.get("shoes")?.design?.coverHeight ??
    [female ? 0.055 : 0.049, 0.014, 0.095, 0.03, 0.014, 0.095][shoes];
  const token = {};
  coverageOwner.set(body, token);
  const shirt = items.get("top")?.design,
    lower = items.get("bottom")?.design;
  const shoulder = coveredShoulder(body, items.get("top"), originalHead);
  const neckline = new Set(collarInterior[sex][top] ?? []);
  const skirt = lower?.skirt || (female && bottom === 0);
  // Flared, short and wrap skirts expose more of the thighs from below.
  // Keep the legs continuous up to the narrow part of their fitted hip yoke.
  const thighOpening = lower?.skirt
    ? Math.max(0.49, lower.hem + 0.115)
    : skirt
      ? skirtLiningTop(body, items.get("bottom").g, bottom)
      : 0;
  function concealed(part, x, y, z) {
    const leg = part.endsWith("Leg"),
      arm = part.endsWith("Arm");
    let coverage = 0;
    if (arm && shirt?.cut === "armor") coverage |= 1;
    // The closed side of a source-pattern sleeve stays covered when an elbow
    // folds across the chest. Keep its opening and the sleeve cap intact.
    if (arm && shirt?.source && y > shirt.sleeve + .070 && y < .785)
      coverage |= 1;
    // The flexible suit is continuous beneath the articulated breastplate.
    // Its collar ends at .836/.854; retain an interior rim and all skin above.
    if (part === "torso" && shirt?.cut === "armor" &&
        y > shirt.hem && y < (female ? .825 : .843)) coverage |= 1;
    if (top !== undefined && !shirt?.source) {
      if (part === "torso") {
        if (
          y >
            (shirt?.hem ?? hems[sex][top]) +
              (shirt ? 0.076 : top === 0 ? 0.044 : 0.055) &&
          y < (shirt?.coveredTop ?? (female ? 0.743 : 0.774))
        )
          coverage |= 1;
      } else if (arm) {
        let sleeve = shirt
          ? shirt.sleeve
          : (female ? [0.68, 0.67, 0.522] : [0.681, 0.688, 0.506])[top];
        if (top === 0)
          sleeve += 0.165 * (Math.abs(x) - (female ? 0.101 : 0.118));
        if (sleeve != null && y > sleeve + 0.03) coverage |= 1;
      }
    }
    if (bottom !== undefined && (leg || part === "torso")) {
      const kneeOpening = lower?.kneeWindows && Math.abs(Math.abs(x)-.073)<.048
        && y>.236 && y<.303 && z>-.012;
      const hem =
        lower?.hem ??
        (female ? [0.357, 0.064, 0.39] : [0.08, 0.355, 0.058])[bottom];
      const waist = lower?.waist ?? (female ? 0.611 : 0.593);
      if (lower?.tights || lower?.cut === "armor") {
        // These two garments include a continuous opaque stretch suit. Its
        // ankles are the actual skin openings, even under a pleated outer
        // shell or between articulated plates at the seat and knees.
        const ankle = lower.tights ? .035 : hem;
        if (y > ankle + .016 && y < waist - .020) coverage |= 2;
      }
      if (
        // Open trouser cuffs reveal more leg when viewed from below.
        y > Math.max(hem + (thighOpening ? 0.016 : 0.048), thighOpening) &&
        y < waist - (thighOpening ? 0.026 : lower ? 0.034 : 0.013) && !kneeOpening
      )
        coverage |= 2;
    }
    if (shoeCoverHeight > 0 && leg && y < shoeCoverHeight) coverage |= 4;
    return coverage;
  }
  function setIndex(mesh, attr) {
    // Release the old GPU index buffer as the number of exported triangles
    // changes. The geometry, rig, morph state and vertex attributes survive.
    mesh.geometry.dispose();
    mesh.geometry.setIndex(attr);
    mesh.visible = attr.count > 0;
  }
  const affected = [];
  const maskCache = forBody(body);
  for (const part of ["torso", "leftArm", "rightArm", "leftLeg", "rightLeg"]) {
    const mesh = body.parts[part],
      src = body.restGeometry(part),
      index = src.index,
      p = src.attributes.position;
    const hidden = Uint8Array.from({ length: p.count }, (_, i) =>
      concealed(part, p.getX(i), p.getY(i), p.getZ(i)) |
        (part === "torso" && shoulder?.[i] ? 1 : 0),
    );
    // Per-triangle coverage is baked from the actual openings of each
    // individual garment. The index follows the outfit into the exported
    // GLB, independent of which animation is later applied to the skeleton.
    const masks = [];
    for (const [slot, item] of items) {
      const packed = coverageMasks[sex][slot]?.[item.style]?.[part];
      if (!packed) continue;
      const key = ["coverage", slot, item.style, part].join("/");
      if (!maskCache.has(key))
        maskCache.set(
          key,
          Uint8Array.from(atob(packed), (c) => c.charCodeAt(0)),
        );
      masks.push(maskCache.get(key));
    }
    const keep = [];
    for (let i = 0; i < index.count; i += 3) {
      const triangle = i / 3;
      if (masks.some((bits) => bits[triangle >>> 3] & (1 << (triangle & 7))))
        continue;
      const a = index.getX(i),
        b = index.getX(i + 1),
        c = index.getX(i + 2);
      const visibleAtCollar = part === "torso" && neckline.has(triangle);
      if (visibleAtCollar || !(hidden[a] & hidden[b] & hidden[c])) keep.push(a, b, c);
    }
    if (keep.length === index.count) {
      if (mesh.geometry.index.count !== index.count)
        setIndex(mesh, index.clone());
      continue;
    }
    setIndex(
      mesh,
      new THREE.BufferAttribute(index.array.constructor.from(keep), 1),
    );
    affected.push([mesh, src]);
  }
  return () => {
    if (coverageOwner.get(body) !== token) return;
    coverageOwner.delete(body);
    for (const [mesh, src] of affected) setIndex(mesh, src.index.clone());
  };
}
