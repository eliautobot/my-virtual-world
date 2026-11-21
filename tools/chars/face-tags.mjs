// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A face made in the character builder, tagged for its motion (2026-11-19, the product owner: facial animations for the
// builder's eyes, eyebrows and mouths): the crowd's heads (tools/chars/crowd-pack.mjs) and characters built in the Agent
// Studio (tools/chars/custom-kind.mjs). M: a joined kit — pos (metres), n, and each vertex's part (partOf → names, roles).
/**
 * A head's face, tagged for its motion (render/characters.js: the brows raised, the lips smiling and talking, the eyes
 * turning to look): each vertex's region (face: 1 a brow, 2 the upper lip — its rim and teeth — 3 the lower lip, 4 the
 * mouth's opening above its seam, 5 below it, 6 the left eye's globe — sclera, iris, pupil — 7 the right's), where it lies across the mouth or along its
 * brow (u, 0…1: the mouth's right corner to its left; a brow's inner end to its outer), and its share of the opening (w:
 * the lower half of the opening stretched with the lower lip). eyes: each eye's centre (its sclera's sphere), left, right.
 */
export function faceTags(M) {
  const n = M.n, face = new Uint8Array(n), u = new Float32Array(n), w = new Float32Array(n).fill(1);
  const role = v => M.roles[M.partOf[v]], name = v => String(M.names[M.partOf[v]] || '').toLowerCase(), X = v => M.pos[v * 3], Y = v => M.pos[v * 3 + 1];
  let lx0 = 9, lx1 = -9, ay0 = 9, ay1 = -9;
  for (let v = 0; v < n; v++) {
    const r = role(v), nm = name(v);
    if (r === 'mouth') {
      if (/aperture/.test(nm)) { face[v] = 4; ay0 = Math.min(ay0, Y(v)); ay1 = Math.max(ay1, Y(v)); }
      else { face[v] = /lower/.test(nm) ? 3 : 2; if (/lip/.test(nm)) { lx0 = Math.min(lx0, X(v)); lx1 = Math.max(lx1, X(v)); } }
    } else if (r === 'brows') face[v] = 1;
    else if (r === 'eyes' && /^eye \/.*\/ (sclera|iris|pupil)$/.test(nm)) face[v] = X(v) > 0 ? 6 : 7;   // (the globe only: its lids, lash lines and catchlight stay)
  }
  const cx = lx1 > lx0 ? (lx0 + lx1) / 2 : 0, hw = lx1 > lx0 ? (lx1 - lx0) / 2 : 0.025, mid = (ay0 + ay1) / 2;
  const brow = { 1: [9, -9], [-1]: [9, -9] };
  for (let v = 0; v < n; v++) if (face[v] === 1) { const s = X(v) > 0 ? 1 : -1, a = Math.abs(X(v)); brow[s][0] = Math.min(brow[s][0], a); brow[s][1] = Math.max(brow[s][1], a); }
  for (let v = 0; v < n; v++) {
    const f = face[v];
    if (f >= 2 && f <= 4) {
      u[v] = Math.min(1, Math.max(0, ((X(v) - cx) / hw + 1) / 2));
      if (f === 4 && Y(v) < mid) { face[v] = 5; w[v] = ay1 > ay0 ? Math.min(1, (mid - Y(v)) / Math.max(1e-4, mid - ay0)) : 1; }
    } else if (f === 1) { const b = brow[X(v) > 0 ? 1 : -1]; u[v] = b[1] > b[0] ? (Math.abs(X(v)) - b[0]) / (b[1] - b[0]) : 0.5; }
  }
  // each eye's centre: the sphere through its sclera (least squares), else the middle of its parts
  const eyes = [6, 7].map(f => {
    const ids = []; for (let v = 0; v < n; v++) if (face[v] === f && /sclera/.test(name(v))) ids.push(v);
    const all = ids.length >= 12 ? ids : (() => { const a = []; for (let v = 0; v < n; v++) if (face[v] === f) a.push(v); return a; })();
    if (!all.length) return null;
    const N = new Float64Array(16), b = new Float64Array(4);
    for (const v of all) { const p = [M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]], row = [2 * p[0], 2 * p[1], 2 * p[2], 1], rhs = p[0] * p[0] + p[1] * p[1] + p[2] * p[2]; for (let i = 0; i < 4; i++) { b[i] += row[i] * rhs; for (let k = 0; k < 4; k++) N[i * 4 + k] += row[i] * row[k]; } }
    const c = solve4(N, b), mean = [0, 1, 2].map(q => all.reduce((a2, v) => a2 + M.pos[v * 3 + q], 0) / all.length);
    const ok = c && ids.length >= 12 && Math.hypot(c[0] - mean[0], c[1] - mean[1], c[2] - mean[2]) < 0.03;
    return (ok ? c.slice(0, 3) : mean).map(x => Math.round(x * 1e5) / 1e5);
  });
  return { face, u, w, eyes };
}
function solve4(A, b) {
  const M = [0, 1, 2, 3].map(i => [A[i * 4], A[i * 4 + 1], A[i * 4 + 2], A[i * 4 + 3], b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[4] / r[i]);
}
