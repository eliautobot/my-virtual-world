// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's library in two files (2026-11-24, the product owner: "start up is very slow"): a body's library
// (assets/crowd/<female|male>.bin, tools/chars/crowd-pack.mjs) is one file of ~35 MB — its animation, then each part's
// levels of detail, finest first — and nobody was drawn until all of it had come (on a slow line, 17 s after the world).
// Split here into what the residents are drawn with from a distance (the animation and every part's coarser levels:
// about half of the bytes sent) and the finest level of each part (level 0, for those close by), both made by the server
// from whichever library it serves (server/crowd-split.js) and read by the browser (render/characters.js), which draws
// everyone with the first and puts the second in place when it comes. The manifest (<sex>.json) is the library's own and
// unchanged: this layout is worked out from it the same way on both sides.

/** The manifest's buffer entries: { off, len, type } objects (a part's close-up level lives in a file of its own and is
 *  left out), each marked near when it belongs to the finest of a part's several levels (a part with one level keeps it
 *  in the far file: everyone must be drawable from it). */
function entries(man) {
  const out = [];
  const walk = (o, near) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x, near); return; }
    if (typeof o.off === 'number' && typeof o.len === 'number' && typeof o.type === 'string') { out.push({ e: o, near }); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'close') continue;   // (crowd-pack's close-up level: <sex>-close.bin)
      if (k === 'lods' && Array.isArray(v)) v.forEach((L, i) => walk(L, i === 0 && v.length > 1));
      else walk(v, near);
    }
  };
  walk(man.anim, false);
  walk(man.parts, false);
  return out;
}

/**
 * The two files' layout for manifest `man`: far (the animation and every level but the finest) and near (each part's
 * level 0), every section in the library's order, 4-byte aligned.
 * → { far: { size, list: [{ src, off, len }] }, near: { size, list }, at: Map(src offset → { near: bool, off }) }
 */
export function crowdSplit(man) {
  const far = { size: 0, list: [] }, near = { size: 0, list: [] }, at = new Map();
  for (const { e, near: n } of entries(man)) {
    if (at.has(e.off)) continue;   // (one section named twice: placed once)
    const F = n ? near : far, off = F.size;
    F.list.push({ src: e.off, off, len: e.len });
    F.size = off + e.len + ((4 - ((off + e.len) % 4)) % 4);
    at.set(e.off, { near: F === near, off });
  }
  return { far, near, at };
}
