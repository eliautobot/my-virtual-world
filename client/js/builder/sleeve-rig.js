// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { BufferAttribute, BufferGeometry, MathUtils, Vector3 } from "three";

const smooth = MathUtils.smoothstep;

// Work on the sewn exterior. A short sleeve in the bind pose can touch the
// side seam, but an edge path between those two points passes over the armhole.
function outerShell(g, shoulderY) {
  const p = g.attributes.position, indices = g.index.array;
  const links = Array.from({ length: p.count }, () => new Map());
  for (let i = 0; i < indices.length; i += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const a = indices[i + corner], b = indices[i + (corner + 1) % 3];
      if (a === b) continue;
      links[a].set(b, (links[a].get(b) || 0) + 1);
      links[b].set(a, (links[b].get(a) || 0) + 1);
    }
  }
  const seen = new Uint8Array(p.count);
  let shell = [], best = 0;
  for (let i = 0; i < p.count; i++) {
    if (seen[i]) continue;
    const region = [i];
    seen[i] = 1;
    for (let j = 0; j < region.length; j++) {
      for (const k of links[region[j]].keys()) {
        if (seen[k]) continue;
        seen[k] = 1;
        region.push(k);
      }
    }
    // A long dress or coat can contain a separate skirt panel larger than
    // its entire bodice. Locate the exterior at shoulder height.
    let count = 0;
    for (const id of region) if (p.getY(id) > shoulderY - .10) count++;
    if (count > best) {
      best = count;
      shell = region;
    }
  }
  const edges = new Array(p.count), boundary = new Array(p.count);
  for (const i of shell) {
    edges[i] = [];
    for (const [j, count] of links[i]) {
      const d = Math.hypot(p.getX(i) - p.getX(j), p.getY(i) - p.getY(j), p.getZ(i) - p.getZ(j));
      edges[i].push({ j, d });
      if (count === 1) (boundary[i] ??= []).push(j);
    }
  }
  return { shell, edges, boundary };
}

function cuffVertices(shell, boundary, p, shoulderX, shoulderY) {
  const seen = new Uint8Array(p.count), cuffs = [];
  for (const id of shell) {
    if (!boundary[id] || seen[id]) continue;
    const rim = [id];
    seen[id] = 1;
    let low = Infinity, high = -Infinity, top = -Infinity;
    for (let k = 0; k < rim.length; k++) {
      const i = rim[k];
      low = Math.min(low, p.getX(i));
      high = Math.max(high, p.getX(i));
      top = Math.max(top, p.getY(i));
      for (const j of boundary[i]) {
        if (seen[j]) continue;
        seen[j] = 1;
        rim.push(j);
      }
    }
    if (top < shoulderY - .025 && (low > shoulderX / 2 || high < -shoulderX / 2))
      cuffs.push(...rim);
  }
  return cuffs;
}

function surfaceDistances(edges, seeds) {
  const distance = new Float64Array(edges.length).fill(Infinity), buckets = [seeds.slice()];
  for (const i of seeds) distance[i] = 0;
  for (let band = 0; band < buckets.length; band++) {
    const bucket = buckets[band];
    if (!bucket) continue;
    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k], d = distance[i];
      if (Math.floor(d * 1000) !== band) continue;
      for (const edge of edges[i]) {
        const next = d + edge.d;
        if (next >= distance[edge.j]) continue;
        distance[edge.j] = next;
        (buckets[Math.floor(next * 1000)] ??= []).push(edge.j);
      }
    }
  }
  return distance;
}

const cell = .016;
function cellKey(x, y, z) {
  return x + 128 * y + 16384 * z;
}

// Bind seams and cuff returns to the underlying panel. Their recorded panel
// owner disambiguates the sleeve and chest where they touch in bind space.
function trimCorrespondence(shell, active, p, blend) {
  const bins = new Map(), matches = new Map();
  for (const i of shell) {
    const key = cellKey(Math.floor(p.getX(i) / cell), Math.floor(p.getY(i) / cell), Math.floor(p.getZ(i) / cell));
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(i);
  }
  for (const i of active) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nearby = [];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++)
          for (const j of bins.get(cellKey(cx + a, cy + b, cz + c)) || []) {
            const d = (p.getX(j) - x) ** 2 + (p.getY(j) - y) ** 2 + (p.getZ(j) - z) ** 2 +
              (.026 * (blend[i] - blend[j]) / 255) ** 2;
            nearby.push({ j, d });
          }
    nearby.sort((a, b) => a.d - b.d);
    const near = nearby.slice(0, 8);
    if (!near.length || near[0].d > .008 ** 2) continue;
    if (near[0].d < 1e-13) {
      matches.set(i, [{ j: near[0].j, weight: 1 }]);
      continue;
    }
    let total = 0;
    for (const n of near) {
      n.weight = (.000016 + n.d) ** -1.65;
      total += n.weight;
    }
    for (const n of near) n.weight /= total;
    matches.set(i, near);
  }
  return matches;
}

// Use the same panel coordinates to carry both bone weights and arm girth.
export function sleevePanels(g, shoulder, elbow, gender) {
  const p = g.attributes.position, blend = g.userData.armBlend;
  if (!blend || !g.index) return;
  const sx = Math.abs(shoulder.x), sy = shoulder.y;
  const { shell, edges, boundary } = outerShell(g, sy);
  const cuffs = cuffVertices(shell, boundary, p, sx, sy);
  if (!cuffs.length) return;
  // On a dropped, long sleeve the forearm already anchors the outside
  // panel. A shallow correction keeps its printed bands continuous around
  // the bicep. A short sleeve needs the whole armhole to carry the free rim.
  let cuffY = -Infinity;
  for (const id of cuffs) cuffY = Math.max(cuffY, p.getY(id));
  const shortSleeve = smooth(cuffY, elbow.y - .004, elbow.y + .029);
  const arm = [...cuffs], torso = [];
  const cuffSet = new Set(cuffs);
  for (const i of shell) {
    const x = Math.abs(p.getX(i)), y = p.getY(i);
    if (blend[i] > 247 && (y < sy - .087 || x > sx + .024)) arm.push(i);
    if (blend[i] < 8 && !cuffSet.has(i) && (y < sy - .087 || x < sx - .027)) torso.push(i);
  }
  if (!torso.length) return;
  const da = surfaceDistances(edges, arm), dt = surfaceDistances(edges, torso);
  const dc = surfaceDistances(edges, cuffs);
  const ratio = new Float32Array(p.count), rim = new Float32Array(p.count);
  const zone = new Float32Array(p.count), medialFit = new Float32Array(p.count), trim = [];
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), y = p.getY(i);
    const along = MathUtils.clamp((shoulder.y - y) / (shoulder.y - elbow.y), 0, 1);
    const axisX = MathUtils.lerp(sx, Math.abs(elbow.x), along);
    const axisZ = MathUtils.lerp(shoulder.z, elbow.z, along);
    const medial = (1 - smooth(x - axisX, -.004, .018)) *
      (1 - smooth(Math.abs(p.getZ(i) - axisZ), .019, .046));
    // The projected front of the fitted women's bodice overlaps the
    // shoulder in XY. It sits well in front of the humerus in depth.
    // Retain the pattern's torso drape there while allowing a full or
    // puffed sleeve with its own panel weights to follow the upper arm.
    const bodice = gender === "female"
      ? (1 - blend[i] / 255) * smooth(p.getZ(i) - axisZ, .047, .073)
      : 0;
    const shoulderPanel = (1 - bodice) * (1 - smooth(y, sy - .041, sy + .017)) * smooth(y, sy - .128, sy - .102) *
      smooth(x, sx - .057, sx - .03) * (1 - smooth(x, sx + .035, sx + .061));
    zone[i] = shoulderPanel * MathUtils.lerp(.18 * medial, 1, shortSleeve);
    medialFit[i] = shoulderPanel * medial;
    if (edges[i]) {
      ratio[i] = smooth(dt[i] / (dt[i] + da[i] || 1), 0, 1);
      rim[i] = (1 - smooth(dc[i], .006, .032)) * smooth(y, sy - .140, sy - .115);
    } else if (y > sy - .140 && y < sy + .018 && x > sx - .058) {
      const lining = g.userData.armLining;
      if (!lining || i < lining[0] || i >= lining[1]) trim.push(i);
    }
  }
  const matches = trimCorrespondence(shell, trim, p, blend);
  for (const [i, near] of matches) {
    for (const { j, weight } of near) {
      ratio[i] += weight * ratio[j];
      rim[i] += weight * rim[j];
    }
  }
  for (let i = 0; i < p.count; i++) {
    if (!edges[i] && !matches.has(i)) zone[i] = 0;
    ratio[i] += (1 - ratio[i]) * rim[i];
    zone[i] = Math.max(zone[i], rim[i]);
  }
  return { shell, edges, boundary, zone, medialFit, shortSleeve, ratio, rim, matches, gender };
}

// The medial sleeve rests against the ribs in bind. Spread both arms in a
// temporary modeling pose to relax the sewn bend, then take the displacement
// back through the inverse skin transform for ordinary GLB vertex attributes.
export function fairUnderarms(g, panels, shoulder, armJoints, joints, weights) {
  const { shell, edges, boundary, zone, medialFit, shortSleeve, rim, matches } = panels;
  const p = g.attributes.position, raised = new Float64Array(p.array.length);
  const diagonal = new Float64Array(p.count), spin = new Float64Array(p.count);
  const active = [];
  const turn = Math.PI * .36, cos = Math.cos(turn), sin = Math.sin(turn);
  for (const i of shell) {
    let amount = 0;
    for (let lane = 0; lane < 4; lane++)
      if (armJoints.has(joints.getComponent(i, lane))) amount += weights.getComponent(i, lane);
    const sign = Math.sign(p.getX(i)), pivot = sign * Math.abs(shoulder.x);
    diagonal[i] = 1 + amount * (cos - 1);
    spin[i] = sign * amount * sin;
    const dx = p.getX(i) - pivot, dy = p.getY(i) - shoulder.y;
    raised[3 * i] = pivot + diagonal[i] * dx - spin[i] * dy;
    raised[3 * i + 1] = shoulder.y + spin[i] * dx + diagonal[i] * dy;
    raised[3 * i + 2] = p.getZ(i);
    // Anchor both cut edges and the cloth immediately above the cuff. The
    // exterior of the deltoid and the side farther down the chest keep their draft.
    const area = MathUtils.lerp(Math.min(zone[i], medialFit[i]), zone[i], shortSleeve);
    // Relax the concealed axilla. The men's short jersey already has a smooth
    // anterior chest; fairing it in a raised-arm pose pushes a rectangular
    // hollow into that panel when the arm returns to the bind pose.
    const front = panels.gender === "male"
      ? shortSleeve * smooth(p.getZ(i)-shoulder.z, .008, .035)
      : 0;
    const influence = area * (1-front) * (1 - rim[i]) * smooth(p.getY(i), shoulder.y - .092, shoulder.y - .055);
    if (influence > .001 && !boundary[i]) active.push({ i, influence });
  }
  let current = raised.slice(), next = raised.slice();
  const modelingPose = new BufferGeometry();
  modelingPose.setIndex(g.index);
  modelingPose.setAttribute("position", new BufferAttribute(raised, 3));
  modelingPose.computeVertexNormals();
  const normal = new Vector3(), delta = new Vector3(), neighbor = new Vector3();
  for (const { i } of active) {
    const center = delta.fromArray(raised, 3 * i);
    let total = 0;
    for (const e of edges[i]) {
      neighbor.fromArray(raised, 3 * e.j);
      e.fair = 1 / Math.max(.002, center.distanceTo(neighbor));
      total += e.fair;
    }
    for (const e of edges[i]) e.fair /= total;
  }
  for (let pass = 0; pass < 18; pass++) {
    for (const { i, influence } of active) {
      for (let axis = 0; axis < 3; axis++) {
        const k = 3 * i + axis;
        let target = 0;
        for (const e of edges[i]) target += current[3 * e.j + axis] * e.fair;
        next[k] = MathUtils.lerp(current[k], target, .62 * influence);
      }
    }
    [current, next] = [next, current];
  }
  const offset = new Float32Array(p.array.length);
  for (const { i, influence } of active) {
    const k = 3 * i;
    // Long sleeves often have rows of narrow triangles at stripe cuts. Keep
    // those rows aligned. On short sleeves the free panel can ease around
    // the bicep, while the rim constraints keep its binding in place.
    normal.fromBufferAttribute(modelingPose.attributes.normal, i);
    delta.fromArray(current, k).sub(neighbor.fromArray(raised, k));
    normal.multiplyScalar(delta.dot(normal)).lerp(delta, shortSleeve).clampLength(0, .0045 * influence);
    const det = diagonal[i] ** 2 + spin[i] ** 2;
    offset[k] = (diagonal[i] * normal.x + spin[i] * normal.y) / det;
    offset[k + 1] = (diagonal[i] * normal.y - spin[i] * normal.x) / det;
    offset[k + 2] = normal.z;
  }
  for (const [i, near] of matches)
    for (const { j, weight } of near)
      for (let axis = 0; axis < 3; axis++) offset[3 * i + axis] += offset[3 * j + axis] * weight;
  for (let k = 0; k < p.array.length; k++) p.array[k] += offset[k];
}
