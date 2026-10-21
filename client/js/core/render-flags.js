// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Renderer improvements that can be switched off one by one (2026-10-03: "make all the changes, in a way that's easy
// to reverse in case I don't like it"), learnt from a reference renderer (Hollowmere): each on by default; Settings →
// Display → Renderer lists them, kept per device. ?rf=-noise,-bake in the address turns some off for one visit (A/B).
// Changing one reloads the page (they choose shaders and render targets at start).
export const RENDER_FLAGS = [
  ['noise', 'Noise from a texture', 'The ground\'s fine detail looks up its randomness in a small texture instead of working it out per pixel.'],
  ['bake', 'Baked ground materials', 'Rock, cliffs, stones, sand and river banks are drawn once at start into textures, then sampled.'],
  ['sharpen', 'Sharp upscaling', 'When automatic resolution lowers detail, the picture is sharpened as it is scaled up to the screen.'],
  ['shadows', 'Adaptive shadows', 'Zoomed out, the sun\'s shadows update every third frame and leave out things too small to see.'],
];
const KEY = k => `mvw.rf.${k}`;
const off = new Set();
try {
  for (const [k] of RENDER_FLAGS) if (localStorage.getItem(KEY(k)) === '0') off.add(k);
  const q = new URLSearchParams(location.search).get('rf');
  if (q) for (const t of q.split(',')) { const k = t.replace(/^[-+]/, ''); if (t.startsWith('-')) off.add(k); else if (t.startsWith('+')) off.delete(k); }
} catch { /* no storage (tests) */ }
/** Is this improvement on? */
export const rf = k => !off.has(k);
/** Remember a choice for this device (the page reloads to apply it). */
export function setRenderFlag(k, on) { if (on) localStorage.removeItem(KEY(k)); else localStorage.setItem(KEY(k), '0'); }
/** Stored choice (ignores a one-visit ?rf= override). */
export const storedRenderFlag = k => { try { return localStorage.getItem(KEY(k)) !== '0'; } catch { return true; } };
