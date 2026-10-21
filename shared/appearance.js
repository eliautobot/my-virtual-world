// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character appearance schema (shared). The client packs appearances into an RGBA8 texture (8 texels/agent).
export const SKIN = ['#fbe0cf', '#f5cdb3', '#eab896', '#dca47c', '#c98c62', '#b17550', '#955c3d', '#77462d', '#5c3421'];
export const HAIR_COLORS = ['#1b1512', '#2d211b', '#4a3222', '#6b4830', '#8f6a45', '#b48a58', '#d8b77a', '#e9d3a3', '#a1402b', '#c2552e', '#8e8c8a', '#d9d6d2', '#3b4c8f', '#c24d86', '#2f7d6a'];
export const HAIR_STYLES = ['Bald', 'Short', 'Side part', 'Buzz', 'Long', 'Bob', 'Ponytail', 'Bun', 'Curly', 'Spiky', 'Afro', 'Pixie'];
export const TOP_STYLES = ['T-shirt', 'Long sleeve', 'Button shirt', 'Blazer', 'Hoodie', 'Tank top', 'Dress', 'Sweater'];
export const BOTTOM_STYLES = ['Trousers', 'Shorts', 'Skirt', 'Jeans'];
export const ACCESSORIES = ['None', 'Glasses', 'Sunglasses', 'Cap', 'Beanie', 'Headphones', 'Round glasses'];
export const FACIAL = ['None', 'Beard', 'Mustache', 'Stubble', 'Goatee'];
export const TOP_COLORS = ['#f4f4f2', '#1f2a44', '#3b6ea5', '#6fa8dc', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#8e44ad', '#2c3e50', '#95a5a6', '#e84393', '#fd79a8', '#81ecec', '#fab1a0', '#6c5ce7', '#2d3436', '#dfe6e9', '#b8860b', '#556b2f', '#8b0000', '#ffeaa7', '#74b9ff'];
export const BOTTOM_COLORS = ['#1e272e', '#2f3640', '#34495e', '#3d4f7a', '#5d6d7e', '#7f8c8d', '#a67c52', '#c8b98c', '#2c3e50', '#4a69bd', '#6a89cc', '#1b1b2f', '#5b3a29', '#e0d5c1', '#4b5320'];
export const SHOE_COLORS = ['#1b1b1b', '#3a2a1f', '#5c4033', '#f5f5f5', '#c0392b', '#2c3e50', '#7f8c8d', '#e0c9a6', '#27ae60'];
export const ACCENT_COLORS = ['#f5f5f5', '#c0392b', '#2980b9', '#f1c40f', '#1abc9c', '#2d3436', '#e84393', '#e67e22', '#8e44ad'];
// Ready-made characters (textured Tripo models in /assets/chars). '' = the built-in generic body.
// Preserve the original default pool: extending its modulo would silently
// reassign residents/accounts/player looks that do not store an explicit char.
export const LEGACY_CHARACTERS = Object.freeze(['m01','m02','m03','m04','m05','m06','m07','m08','m09','m10','m11','m12','f01','f02','f03','f04','f05','f06','f07','f08','f09','f10','f11','f12']);
export const ADDED_CHARACTERS = Object.freeze(['m13','m14','m15','m16','m17','m18','m19','m20','m21','m22','f13','f14','f15','f16','f17','f18','f19','f20','f21','f22']);
export const CHARACTERS = Object.freeze([...LEGACY_CHARACTERS, ...ADDED_CHARACTERS]);
/** Stable character for a look that has none: hash of its fixed fields, picked from the male or female list by body. */
export function defaultChar(a) {
  const fem = a && a.body ? 1 : 0;
  const list = LEGACY_CHARACTERS.filter(c => (c[0] === 'f') === !!fem);
  const str = [a?.skin, a?.hair, a?.hairStyle, a?.top, a?.topStyle, a?.bottom, a?.bottomStyle, a?.shoes, a?.height, a?.build].join('|');
  let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[(h >>> 0) % list.length];
}
export const EYE_COLORS = ['#2b1d14', '#4a3222', '#3b6a8f', '#4e7a3a', '#6b6b6b', '#1c1c1c'];

export function hexToRgb(h) { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r, g, b) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
function jitter(rng, hex, amt) {
  const [r, g, b] = hexToRgb(hex); const k = 1 + (rng.next() - 0.5) * amt;
  const c = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return rgbToHex(c(r), c(g), c(b));
}

export function randomAppearance(rng, o = {}) {
  const fem = o.fem ?? rng.chance(0.5);
  const older = rng.chance(0.15);
  let hairStyle = fem ? rng.weighted([[4, 22], [5, 14], [6, 16], [7, 12], [8, 10], [10, 6], [11, 8], [1, 5], [2, 4]])
    : rng.weighted([[1, 26], [2, 22], [3, 16], [0, 7], [8, 10], [9, 6], [10, 7], [6, 3], [4, 3]]);
  let hair = rng.weighted(HAIR_COLORS.map((c, i) => [c, i < 8 ? 10 : i < 10 ? 3 : i < 12 ? (older ? 30 : 1) : 1]));
  if (older && rng.chance(0.5)) hair = rng.pick(['#8e8c8a', '#d9d6d2', '#b9b6b1']);
  const topStyle = fem ? rng.weighted([[0, 16], [1, 12], [2, 12], [3, 10], [4, 8], [5, 5], [6, 16], [7, 10]])
    : rng.weighted([[0, 22], [1, 12], [2, 20], [3, 14], [4, 12], [5, 3], [7, 12]]);
  const bottomStyle = topStyle === 6 ? 2 : fem ? rng.weighted([[0, 30], [1, 8], [2, 26], [3, 30]]) : rng.weighted([[0, 45], [1, 12], [3, 43]]);
  const look = {
    skin: jitter(rng, rng.pick(SKIN), 0.06),
    hair: jitter(rng, hair, 0.12), hairStyle,
    top: jitter(rng, rng.pick(TOP_COLORS), 0.1), topStyle,
    bottom: jitter(rng, rng.pick(BOTTOM_COLORS), 0.1), bottomStyle,
    shoes: rng.pick(SHOE_COLORS),
    accent: rng.pick(ACCENT_COLORS),
    acc: rng.weighted([[0, 60], [1, 14], [2, 4], [3, 6], [4, 4], [5, 5], [6, 7]]),
    facial: fem ? 0 : rng.weighted([[0, 55], [1, 16], [2, 7], [3, 14], [4, 8]]),
    eyes: rng.pick(EYE_COLORS),
    height: Math.round((fem ? rng.float(0.92, 1.02) : rng.float(0.97, 1.07)) * 100) / 100,
    body: fem ? 1 : 0,
    build: Math.round(rng.float(0.9, 1.12) * 100) / 100,
  };
  look.char = defaultChar(look);
  return look;
}
/** Validates a look. A missing or invalid field keeps its value from base (the look being edited), else a default. */
export function sanitizeAppearance(a, base) {
  const src = a && typeof a === 'object' ? a : {};
  const fb = base && base !== a ? sanitizeAppearance(base) : null;
  const dflt = (k, d) => (fb ? fb[k] : d);
  const numOf = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const hex = (k, d) => { const v = src[k]; return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : dflt(k, d); };
  const int = (k, n, d) => { const v = Math.round(numOf(src[k])); return Number.isFinite(v) && v >= 0 && v < n ? v : dflt(k, d); };
  const num = (k, lo, hi, d) => { const v = numOf(src[k]); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt(k, d); };
  const out = {
    skin: hex('skin', SKIN[2]), hair: hex('hair', HAIR_COLORS[1]), hairStyle: int('hairStyle', HAIR_STYLES.length, 1),
    top: hex('top', TOP_COLORS[2]), topStyle: int('topStyle', TOP_STYLES.length, 0),
    bottom: hex('bottom', BOTTOM_COLORS[0]), bottomStyle: int('bottomStyle', BOTTOM_STYLES.length, 0),
    shoes: hex('shoes', SHOE_COLORS[0]), accent: hex('accent', ACCENT_COLORS[0]),
    acc: int('acc', ACCESSORIES.length, 0), facial: int('facial', FACIAL.length, 0), eyes: hex('eyes', EYE_COLORS[0]),
    height: num('height', 0.85, 1.12, 1), build: num('build', 0.85, 1.2, 1), body: int('body', 2, 0),
  };
  out.char = typeof src.char === 'string' && CHARACTERS.includes(src.char) ? src.char : (fb ? fb.char : defaultChar(out));
  out.body = out.char[0] === 'f' ? 1 : 0;
  return out;
}
/** Pack into 32 bytes (8 RGBA texels). */
export function packAppearance(a, out = new Uint8Array(32), o = 0) {
  const put = (k, hex, w) => { const c = hexToRgb(hex); out[o + k * 4] = c[0]; out[o + k * 4 + 1] = c[1]; out[o + k * 4 + 2] = c[2]; out[o + k * 4 + 3] = w; };
  const byte = (v, lo, hi) => Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo) * 255)));
  put(0, a.skin, byte(a.height, 0.8, 1.2));
  put(1, a.hair, a.hairStyle);
  put(2, a.top, a.topStyle);
  put(3, a.bottom, a.bottomStyle);
  put(4, a.shoes, a.acc);
  put(5, a.accent, a.facial);
  put(6, a.eyes, byte(a.build, 0.8, 1.25));
  put(7, '#000000', a.body ? 1 : 0);
  return out;
}
/** Compact array form for network: [skin,hair,hs,top,ts,bottom,bs,shoes,accent,acc,facial,eyes,height,build]. */
export function appToArr(a) { return [a.skin, a.hair, a.hairStyle, a.top, a.topStyle, a.bottom, a.bottomStyle, a.shoes, a.accent, a.acc, a.facial, a.eyes, a.height, a.build, a.body ? 1 : 0, a.char || defaultChar(a)]; }
export function arrToApp(r) {
  return { skin: r[0], hair: r[1], hairStyle: r[2], top: r[3], topStyle: r[4], bottom: r[5], bottomStyle: r[6], shoes: r[7], accent: r[8], acc: r[9], facial: r[10], eyes: r[11], height: r[12], build: r[13], body: r[14] ? 1 : 0, char: CHARACTERS.includes(r[15]) ? r[15] : '' };
}
export function arrToAppFull(r) {
  const a = arrToApp(r); if (!a.char) a.char = defaultChar(a); a.body = a.char[0] === 'f' ? 1 : 0; return a;
}
