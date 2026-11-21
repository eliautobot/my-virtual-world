// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { getReferenceHead, headLandmarks } from "./reference-head.js";
import { facialStructure } from "./facial-structure.js";
import {
  neutralizeFront,
  addFaceModules,
  insertDepth,
} from "./face-modules.js";
import { jawStubble } from "./stubble.js";
import { neutralEarEye, addReferenceEars } from "./ear-eye-base.js";
import * as THREE from "three";
import { portraitEyes } from "./stylized-eyes.js";
import { sculptHair } from "./hair.js";

import { faceOptions } from "./face-catalog.js";
import { addBeard } from "./beard-library.js";
import { addBeardUpper, detailMoustacheFullness } from "./beard-upper.js";
import { addComplexion, skinBlush } from "./complexion-library.js";
export { faceOptions };

const pi = Math.PI,
  tau = pi * 2,
  sat = (x) => Math.min(1, Math.max(0, x));
const S = (a, b, x) => {
  let t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ga = (x) => Math.exp(-x * x),
  col = (x) => new THREE.Color(x),
  sr = (a, b, t) => a.clone().lerp(b, t);
const cache = new WeakMap();
function meshGrid(n, m, fn, rev = false) {
  const p = [],
    c = [],
    uv = [],
    idx = [];
  for (let j = 0; j <= m; j++)
    for (let i = 0; i <= n; i++) {
      const a = fn(i / n, j / m);
      p.push(a[0], a[1], a[2]);
      uv.push(i / n, j / m);
      if (a[3]) c.push(a[3].r, a[3].g, a[3].b);
      if (j && i) {
        const v = j * (n + 1) + i,
          k = v - n - 2;
        if (rev) idx.push(k, v, k + 1, k, v - 1, v);
        else idx.push(k, k + 1, v, k, v, v - 1);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (c.length) g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function joinGeometry(list) {
  const p = [],
    n = [],
    co = [],
    idx = [];
  let offset = 0;
  for (const g of list) {
    const a = g.attributes;
    p.push(...a.position.array);
    n.push(...a.normal.array);
    if (a.color) co.push(...a.color.array);
    for (const i of g.index.array) idx.push(i + offset);
    offset += a.position.count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  if (co.length)
    g.setAttribute("color", new THREE.Float32BufferAttribute(co, 3));
  g.setIndex(idx);
  return g;
}
// An orthographic depth query gives lids, blush and lip contours the same curvature as
// the imported head. Work from triangles, not nearest vertices: cheeks are low poly.
function headSurface(geo) {
  if (cache.has(geo)) return cache.get(geo);
  const pos = geo.attributes.position,
    ind = geo.index?.array ?? Array.from({ length: pos.count }, (_, i) => i);
  const v = Array.from({ length: pos.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(pos, i),
  );
  const bins = new Map(),
    triangles = [],
    int = (x) => Math.floor(x / 0.008),
    key = (x, y) => x + 256 * y;
  for (let i = 0; i < ind.length; i += 3) {
    const a = v[ind[i]],
      b = v[ind[i + 1]],
      c = v[ind[i + 2]],
      tri = [a, b, c, ind[i], ind[i + 1], ind[i + 2]];
    triangles.push(tri);
    for (
      let x = int(Math.min(a.x, b.x, c.x));
      x <= int(Math.max(a.x, b.x, c.x));
      x++
    )
      for (
        let y = int(Math.min(a.y, b.y, c.y));
        y <= int(Math.max(a.y, b.y, c.y));
        y++
      ) {
        const k = key(x, y);
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(tri);
      }
  }
  function depth(x, y, outNormal, hit) {
    let z = -0.12;
    for (const [a, b, c, ia, ib, ic] of bins.get(key(int(x), int(y))) ?? []) {
      const bx = b.x - a.x,
        by = b.y - a.y,
        cx = c.x - a.x,
        cy = c.y - a.y,
        det = bx * cy - by * cx;
      if (Math.abs(det) < 1e-12) continue;
      const u = ((x - a.x) * cy - (y - a.y) * cx) / det,
        w = (bx * (y - a.y) - by * (x - a.x)) / det;
      if (u >= -1e-5 && w >= -1e-5 && u + w <= 1.00001) {
        const zz = a.z + u * (b.z - a.z) + w * (c.z - a.z);
        if (zz <= z) continue;
        z = zz;
        if (outNormal) {
          const n = geo.attributes.normal,
            interp = (j) =>
              n.getComponent(ia, j) * (1 - u - w) +
              n.getComponent(ib, j) * u +
              n.getComponent(ic, j) * w;
          outNormal.set(interp(0), interp(1), interp(2)).normalize();
        }
        if (hit) {
          hit[0] = ia;
          hit[1] = ib;
          hit[2] = ic;
          hit[3] = 1 - u - w;
          hit[4] = u;
          hit[5] = w;
        }
      }
    }
    return z;
  }
  // Ray intersections from inside the cranium fit a continuous scalp to the
  // original head. Angle bins keep small style/color changes interactive.
  const origin = new THREE.Vector3(0, 0.941, 0.003),
    ray = new THREE.Ray(origin),
    tmp = new THREE.Vector3(),
    rt = new Map();
  function angles(p) {
    const x = p.x - origin.x,
      y = p.y - origin.y,
      z = p.z - origin.z;
    return [Math.atan2(x, z), Math.atan2(Math.hypot(x, z), y)];
  }
  const step = pi / 24;
  for (const tri of triangles) {
    const vertices = tri.slice(0, 3);
    if (vertices.every((p) => p.y < 0.864)) continue;
    const a = vertices.map(angles);
    if (a.some((p) => p[0] - a[0][0] > pi || p[0] - a[0][0] < -pi))
      for (const p of a) if (p[0] < 0) p[0] += tau;
    const polarLo = Math.min(...a.map((p) => p[1])),
      polarHi = Math.max(...a.map((p) => p[1]));
    let lo = Math.min(...a.map((p) => p[0])),
      hi = Math.max(...a.map((p) => p[0]));
    if (polarLo < 0.3) {
      lo = -pi;
      hi = pi;
    }
    for (let i = Math.floor(lo / step) - 1; i <= Math.floor(hi / step) + 1; i++)
      for (
        let j = Math.floor(polarLo / step) - 1;
        j <= Math.floor(polarHi / step) + 1;
        j++
      ) {
        let k = (((i % 48) + 48) % 48) + 64 * j;
        if (!rt.has(k)) rt.set(k, []);
        rt.get(k).push(tri);
      }
  }
  function scalp(a, p) {
    const d = ray.direction.set(
      Math.sin(a) * Math.sin(p),
      Math.cos(p),
      Math.cos(a) * Math.sin(p),
    );
    let len = 0;
    const k =
      (((Math.floor(a / step) % 48) + 48) % 48) + 64 * Math.floor(p / step);
    for (const [v0, v1, v2] of rt.get(k) ?? [])
      if (ray.intersectTriangle(v0, v1, v2, false, tmp))
        len = Math.max(len, origin.distanceTo(tmp));
    if (!len) len = 1 / Math.hypot(d.x / 0.049, d.y / 0.058, d.z / 0.064);
    return [origin.x + d.x * len, origin.y + d.y * len, origin.z + d.z * len];
  }
  const surf = { depth, scalp };
  cache.set(geo, surf);
  return surf;
}

const neutralCache = new WeakMap();
function neutralShell(gender, source) {
  let bed = neutralCache.get(source);
  if (!bed) {
    const eyesCleared = neutralEarEye(gender, source);
    bed = neutralizeFront(eyesCleared, gender);
    neutralCache.set(source, bed);
  }
  return bed;
}

export function buildFace(
  body,
  selections = {},
  colors = {},
  adjustments = {},
  sourceOnly = false,
) {
  const group = new THREE.Group(),
    gender = body.gender,
    female = gender === "female";
  group.name = "Modular portrait";
  body.parts.head.visible = sourceOnly;
  if (sourceOnly) {
    group.userData.dispose = () => group.removeFromParent();
    return group;
  }
  const raw = getReferenceHead(gender);
  let structure = facialStructure(gender, adjustments.structure);
  const bed = neutralShell(gender, raw.skin),
    { depth, scalp } = headSurface(bed);
  const cheek = headSurface(neutralizeFront(raw.skin, gender)).depth;
  const { eyeX, eyeY, mouthY } = headLandmarks[gender];
  const buckets = new Map();
  const blushSurfaces = new WeakMap();
  let blushName, blushDye;
  let current, skinTints, skinFallback;
  let lastHairColor = colors.hair;
  function clear(slot) {
    const bucket = buckets.get(slot);
    if (!bucket) return;
    for (const mesh of bucket.meshes) body.releaseMesh(mesh);
    for (const material of bucket.materials) material.dispose();
    buckets.delete(slot);
  }
  function mat(c, vertexColors = false, options = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: c,
      vertexColors,
      roughness: 0.77,
      side: THREE.DoubleSide,
      ...options,
    });
    current.materials.add(m);
    return m;
  }
  function add(name, g, m, bind = "surface") {
    if (current.slot === "nose") current.depth = insertDepth(g);
    if (!(g.hasAttribute("skinWeight") && g.hasAttribute("skinIndex"))) {
      const p = g.attributes.position,
        si = new Uint16Array(p.count * 4),
        sw = new Float32Array(si.length),
        hit = new Array(6),
        joints = bed.attributes.skinIndex,
        weights = bed.attributes.skinWeight,
        headIndex = body.bones.indexOf(body.boneMap.get("Head"));
      const skinColors =
        bind === "eyelid" ? new Float32Array(3 * p.count) : null;
      for (let i = 0; i < p.count; i++) {
        const offset = 4 * i;
        si[offset] = headIndex;
        sw[offset] = 1;
        if (
          bind === "head" ||
          depth(p.getX(i), p.getY(i), null, hit) < -0.105
        ) {
          if (skinColors) skinFallback.toArray(skinColors, 3 * i);
          continue;
        }
        if (skinColors)
          for (let c = 0; c < 3; c++)
            skinColors[3 * i + c] =
              skinTints.getComponent(hit[0], c) * hit[3] +
              skinTints.getComponent(hit[1], c) * hit[4] +
              skinTints.getComponent(hit[2], c) * hit[5];
        const influences = new Map();
        for (let a = 0; a < 3; a++)
          for (let j = 0; j < 4; j++) {
            const idx = joints.getComponent(hit[a], j),
              w = weights.getComponent(hit[a], j) * hit[a + 3];
            if (w > 0) influences.set(idx, (influences.get(idx) ?? 0) + w);
          }
        const best = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = best.reduce((a, b) => a + b[1], 0);
        for (let k = 0; k < best.length; k++) {
          si[offset + k] = best[k][0];
          sw[offset + k] = best[k][1] / sum;
        }
      }
      if (skinColors)
        g.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(skinColors, 3),
        );
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    }
    const pigment = female && (["base","nose"].includes(current.slot) || bind === "eyelid")
      ? skinBlush(g, eyeY) : null;
    const mesh = body.skinGeometry(g, name, m, "head", structure);
    if (pigment) {
      blushSurfaces.set(mesh, pigment);
      if (blushName) pigment(blushName, blushDye);
    }
    mesh.userData.feature = current.slot;
    current.meshes.add(mesh);
    group.add(mesh);
    return mesh;
  }
  function stroke(fn, width, rise, steps = 36) {
    return meshGrid(steps, 6, (t, v) => {
      const [x, y, z] = fn(t),
        [xa, ya] = fn(Math.max(0, t - 0.001)),
        [xb, yb] = fn(Math.min(1, t + 0.001)),
        dx = xb - xa,
        dy = yb - ya,
        len = Math.hypot(dx, dy) || 1;
      const w = width(t) * (2 * v - 1),
        xx = x - (dy / len) * w,
        yy = y + (dx / len) * w;
      return [
        xx,
        yy,
        depth(xx, yy) +
          z +
          Math.sin(pi * v) * rise * Math.min(1, 12 * t, 12 * (1 - t)),
      ];
    });
  }
  function draw(slot, sel, dyes, fit) {
    clear(slot);
    current = { slot, meshes: new Set(), materials: new Set() };
    buckets.set(slot, current);
    const skin = col(dyes.skin ?? "#eab28e"),
      hair = col(dyes.hair ?? "#452b24"),
      eye = col(dyes.eyes ?? "#29252a"),
      detail = col(dyes.detail ?? "#935f4d");
    const detailName = faceOptions[gender].detail[sel.detail] ?? "";
    if (female && slot === "detail") {
      const name = ["Warm flush", "Rosy nose"].includes(detailName) ? detailName : null;
      if (name || blushName) {
        blushName = name;
        blushDye = dyes.detail;
        for (const mesh of group.children) blushSurfaces.get(mesh)?.(name, blushDye);
      }
      if (name) return;
    }
    const lip = buckets.get("mouth")?.lip;
    function moustacheStroke(path, radius, rise, steps) {
      const fullness = detailMoustacheFullness(
        faceOptions.male.beard[sel.beard],
      );
      const width = (t) => fullness * radius(t);
      if (!lip) return stroke(path, width, rise * fullness, steps);
      return stroke(
        (t) => {
          let [x, y, z] = path(t);
          x *= lip.halfWidth / 0.0182;
          const lift = Math.max(
            0,
            lip.upperAt(x) + 0.0004 + 0.83 * width(t) - y,
          );
          y += lift * (1 - S(0.86, 1.18, Math.abs(x / lip.halfWidth)));
          return [x, y, z];
        },
        width,
        rise * fullness,
        steps,
      );
    }
    if (slot === "base") {
      const g = bed.clone(),
        p = g.attributes.position,
        cs = new Float32Array(p.count * 3),
        ao = bed.userData.ao;
      const tint = new THREE.Color(),
        shadow = skin.clone().multiply(col("#c28c79"));
      for (let i = 0; i < p.count; i++) {
        const cheek =
          ga((Math.abs(p.getX(i)) - 0.034) / 0.011) *
          ga((p.getY(i) - eyeY + 0.022) / 0.012) *
          S(0.03, 0.05, p.getZ(i));
        tint
          .copy(skin)
          .lerp(shadow, cheek * (female ? 0.13 : 0.052))
          .multiplyScalar(0.84 + (0.16 * (ao?.[i] ?? 255)) / 255)
          .toArray(cs, i * 3);
      }
      g.userData = {};
      g.setAttribute("color", new THREE.Float32BufferAttribute(cs, 3));
      skinTints = g.attributes.color;
      skinFallback = skin;
      // The skull and neck form a volume. Casting from its far surface
      // keeps grazing light from drawing shadow-map stripes under the jaw.
      add("Head and neck", g, mat("white", true, {
        roughness: 0.76,
        shadowSide: THREE.BackSide,
      }));
    } else if (slot === "eyes" || slot === "brows") {
      current.updatePupils = portraitEyes({
        female,
        variant: slot === "eyes" ? (sel.eyes ?? 0) : -1,
        browVariant: slot === "brows" ? (sel.brows ?? 0) : -1,
        browColor: dyes.brows ? col(dyes.brows) : null,
        eyeX,
        eyeY,
        eye,
        hair,
        skin,
        detail,
        reference: true,
        skinDepth: cheek,
        depth,
        meshGrid,
        mat,
        add,
        adjustments: fit,
      });
    } else if (
      slot === "lashes" &&
      female &&
      sel.lashes >= 0 &&
      (sel.eyes ?? 0) >= 0
    ) {
      portraitEyes({
        female,
        mode: "lashes",
        lashVariant: sel.lashes,
        variant: sel.eyes ?? 0,
        browVariant: -1,
        eyeX,
        eyeY,
        eye,
        hair,
        skin,
        detail: col(dyes.lashes || "#34252a"),
        reference: true,
        skinDepth: cheek,
        depth,
        meshGrid,
        mat,
        add,
        adjustments: fit,
      });
    } else if (slot === "beard" && !female && sel.beard >= 0) {
      const name = faceOptions.male.beard[sel.beard];
      const tint = col(dyes.beard || dyes.hair || "#452b24");
      addBeard({
        name,
        head: bed,
        mouthY,
        lip,
        skin,
        tint,
        add,
        mat,
      });
      current.customMoustache = detailName.includes("moustache");
      if (!current.customMoustache)
        addBeardUpper({
          name,
          mouthY,
          lip,
          skin,
          tint,
          depth,
          noseDepth: buckets.get("nose")?.depth,
          add,
          mat,
        });
    } else if (slot === "ears") {
      addReferenceEars({
        gender,
        style: sel.ears ?? 0,
        skin,
        tint: col(dyes.ears || dyes.skin || "#eab28e"),
        mat,
        add,
        adjustments: fit,
      });
    } else if (slot === "nose" || slot === "mouth") {
      current.lip = addFaceModules({
        female,
        selections: {
          ...sel,
          nose: slot === "nose" ? (sel.nose ?? 0) : -1,
          mouth: slot === "mouth" ? (sel.mouth ?? 0) : -1,
        },
        colors: dyes,
        skin,
        depth,
        meshGrid,
        mat,
        add,
        adjustments: fit,
      });
    } else if (slot === "hair" && (sel.hair ?? 0) >= 0) {
      sculptHair(
        sel.hair ?? 0,
        female,
        hair,
        scalp,
        mat,
        (n, g, m) => add(n, g, m, "head"),
        false,
        skin,
      );
    } else if (slot === "detail" && female && sel.detail === 2) {
      portraitEyes({
        female,
        variant: sel.eyes ?? 0,
        browVariant: -1,
        eyeX,
        eyeY,
        eye,
        hair,
        skin,
        detail,
        reference: true,
        graphicOnly: true,
        skinDepth: cheek,
        graphic: true,
        depth,
        meshGrid,
        mat,
        add,
        adjustments: fit,
      });
    } else if (slot === "detail" && sel.detail >= 3) {
      const noseDepth = buckets.get("nose")?.depth;
      addComplexion({
        name: faceOptions[gender].detail[sel.detail],
        eyeY,
        mouthY,
        depth: noseDepth
          ? (x, y) => Math.max(depth(x, y), noseDepth(x, y))
          : depth,
        skin,
        tint: detail,
        meshGrid,
        stroke: detailName.includes("moustache") ? moustacheStroke : stroke,
        add,
        mat,
        join: joinGeometry,
        head: bed,
      });
    } else if (slot === "detail" && (sel.detail ?? -1) >= 0) {
      faceDetail(
        sel.detail,
        female,
        eyeX,
        eyeY,
        mouthY,
        hair,
        detail,
        skin,
        depth,
        detailName.includes("moustache") ? moustacheStroke : stroke,
        add,
        mat,
        bed,
      );
    }
  }
  const slots = [
    "base",
    "ears",
    "eyes",
    "brows",
    "nose",
    "mouth",
    "hair",
    "detail",
    female ? "lashes" : "beard",
  ];
  for (const s of slots) draw(s, selections, colors, adjustments);
  group.userData.update = (slot, sel, dyes, fit = {}) => {
    if (slot === "structure") {
      structure = facialStructure(gender, fit.structure);
      body.fitFaceStructure(group.children, structure);
      return;
    }
    if (slot === "pupils") {
      current = buckets.get("eyes");
      current?.updatePupils?.(fit.pupils, (mesh) => {
        current.meshes.delete(mesh);
        body.releaseMesh(mesh);
      });
      return;
    }
    if (slot === "skin") {
      for (const s of slots) draw(s, sel, dyes, fit);
      return;
    }
    draw(slot, sel, dyes, fit);
    if (slot === "hair") {
      if (lastHairColor !== dyes.hair && !dyes.brows)
        draw("brows", sel, dyes, fit);
      if (
        !female &&
        sel.beard >= 0 &&
        lastHairColor !== dyes.hair &&
        !dyes.beard
      )
        draw("beard", sel, dyes, fit);
      lastHairColor = dyes.hair;
    }
    if (
      (slot === "mouth" || slot === "beard") &&
      !female &&
      faceOptions.male.detail[sel.detail]?.includes("moustache")
    )
      draw("detail", sel, dyes, fit);
    if (
      !female &&
      sel.beard >= 0 &&
      (slot === "mouth" ||
        slot === "nose" ||
        (slot === "detail" &&
          buckets.get("beard")?.customMoustache !==
            (faceOptions.male.detail[sel.detail]?.includes("moustache") ??
              false)))
    )
      draw("beard", sel, dyes, fit);
    if (slot === "eyes" && female && sel.lashes >= 0)
      draw("lashes", sel, dyes, fit);
    if (slot === "eyes" && female && sel.detail === 2)
      draw("detail", sel, dyes, fit);
    if (
      slot === "nose" &&
      ["Nose freckles", "Rosy nose"].includes(
        faceOptions[gender].detail[sel.detail],
      )
    )
      draw("detail", sel, dyes, fit);
  };
  group.userData.dispose = () => {
    for (const s of slots) clear(s);
    group.removeFromParent();
    body.parts.head.visible = true;
  };
  return group;
}

function faceDetail(
  style,
  female,
  eyeX,
  eyeY,
  mouthY,
  hair,
  tint,
  skin,
  depth,
  stroke,
  add,
  mat,
  head,
) {
  let seed = 1948;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const geos = [];
  function mark(x, y, rx, ry, c, z = 0.00028) {
    if (depth(x, y) < 0.018) return;
    geos.push(
      meshGrid(
        10,
        2,
        (u, t) => {
          const a = tau * u,
            xx = x + Math.cos(a) * rx * t,
            yy = y + Math.sin(a) * ry * t;
          return [xx, yy, depth(xx, yy) + z + 0.00012 * (1 - t), c];
        },
        true,
      ),
    );
  }
  if (style === 0) {
    for (const side of [-1, 1])
      for (let i = 0; i < 14; i++) {
        const r = Math.sqrt(rand()),
          a = rand() * tau,
          x = side * (0.0205 + 0.0115 * r * Math.cos(a)),
          y =
            eyeY - 0.0163 + 0.0039 * r * Math.sin(a) + 0.0028 * r * Math.cos(a),
          s = 0.00038 + 0.00052 * rand();
        mark(
          x,
          y,
          s,
          s * (0.81 + 0.2 * rand()),
          sr(skin, tint, 0.38 + 0.31 * rand()),
        );
      }
  } else if (female && style === 1) {
    mark(-0.0278, mouthY + 0.0065, 0.00115, 0.001, tint);
    mark(0.033, eyeY - 0.012, 0.00075, 0.00067, sr(tint, skin, 0.15));
  } else if (!female && style === 1) {
    for (const side of [-1, 1]) {
      add(
        "Sculpted moustache " + side,
        stroke(
          (t) => [
            side * (0.00038 + 0.014 * t),
            mouthY + 0.0054 + 0.00165 * Math.sin(pi * t) - 0.0025 * t * t,
            0.0006,
          ],
          (t) =>
            0.00155 *
            (0.35 + 0.65 * Math.sin(pi * t) ** 0.52) *
            (1 - 0.96 * S(0.57, 1, t)),
          0.00091,
        ),
        mat(tint),
      );
    }
  } else if (!female && style === 2) {
    add(
      "Jaw stubble",
      jawStubble(head, mouthY, tint),
      mat("white", true, { roughness: 0.84 }),
    );
  }
  if (geos.length)
    add("Complexion markings", joinGeometry(geos), mat("white", true));
}
