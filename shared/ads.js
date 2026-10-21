// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a sign's or an aircraft's content is made of (a design: picture, title, message, link - the designer,
// client/js/ui/designer.js), the shapes it is shown in, and the helpers that pick an item from a list on the shared
// clock, the same on every screen. Where signs stand: shared/signs.js.

/**
 * Where ads run (2026-10-05): the billboards and the street and metro signs the administrators put up (Marketing),
 * the promotional aircraft, and signs inside buildings whose owners show ads on them. Owners' rooftop billboards and
 * private signs never carry ads.
 */
export const AD_SPACES = Object.freeze({
  billboard: Object.freeze({ id: 'billboard', label: 'Billboards', blurb: 'Your ad on the big billboards standing round the city, seen from the streets.' }),
  street: Object.freeze({ id: 'street', label: 'Street & metro signs', blurb: 'Your ad on the lit signs along the sidewalks, in the parks and at the metro stations.' }),
  aircraft: Object.freeze({ id: 'aircraft', label: 'Airplanes & balloons', blurb: 'Your banner trails behind the planes, along the blimps and round the balloons over the city.' }),
  indoor: Object.freeze({ id: 'indoor', label: 'Inside buildings', blurb: 'Your ad on the signs in shops, offices, lobbies and parks whose owners show ads.' }),
});
/** The shapes an ad is painted in (width / height). */
export const AD_ASPECTS = Object.freeze({ wide: 3, billboard: 3, portrait: 2 / 3, landscape: 1.5, banner: 5, blimp: 3.6, band: 6 });
/** A shape's aspect: a named one's, or 'x<width ÷ height>' (a sign sized by its owner: shared/signs.js signShape). */
export function aspectOf(shape) {
  if (Object.hasOwn(AD_ASPECTS, shape || '')) return AD_ASPECTS[shape];
  const m = /^x(\d{1,2}(?:\.\d{1,3})?)$/.exec(String(shape || '')), a = m ? +m[1] : 0;
  return a >= 0.05 && a <= 20 ? a : AD_ASPECTS.landscape;
}
/** The shapes each space shows an ad in (for the builder's previews and the pictures it needs). */
export const SPACE_SHAPES = Object.freeze({ billboard: ['wide'], street: ['portrait'], aircraft: ['banner', 'blimp'], indoor: ['landscape', 'portrait'] });
/** Whether a space has tall (portrait) places: a full-picture ad there needs a tall picture too. */
export const needsTall = space => (SPACE_SHAPES[space] || []).includes('portrait');
/** An uploaded picture: an ad's (/ads/a<account>-…) or a sign's (/signs/s<account>-…), named by its owner's account. */
export const AD_IMAGE_RE = /^\/ads\/a(\d{1,12})-[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
export const SIGN_IMAGE_RE = /^\/signs\/s(\d{1,12})-[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
export const AD_LIMITS = Object.freeze({ title: 48, message: 300 });

const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : d);
const clamp = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const text = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** A website: a bare domain becomes https; anything not an http(s) address with a real host is refused. */
export function adWebsite(v) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (t.length > 500) return null;
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') && !u.username && !u.password ? u.toString() : null; } catch { return null; }
}
/**
 * A checked design (or an Error saying what is wrong): an ad's, or a sign's own content. format 'logo': a picture (a
 * logo, optional) beside the title on a background colour; 'image': a full picture filling the space (imageTallSrc: the
 * picture for tall places). title (48), message (300: shown when someone taps it), website (https: "Open link"), the
 * picture's place and size for 'logo' (percent). o.images 'ads': only ads' uploads (paid ads); 'any': signs' too.
 */
export function normalizeAdCreative(raw, { images = 'ads' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ok = s => typeof s === 'string' && (AD_IMAGE_RE.test(s) || (images === 'any' && SIGN_IMAGE_RE.test(s)));
  const format = r.format === 'image' ? 'image' : 'logo';
  const imageSrc = ok(r.imageSrc) ? r.imageSrc : '', imageTallSrc = ok(r.imageTallSrc) ? r.imageTallSrc : '';
  if ((r.imageSrc && !imageSrc) || (r.imageTallSrc && !imageTallSrc)) return new Error('Upload the picture again');
  const website = adWebsite(r.website);
  if (website === null) return new Error('The website must be an https:// address');
  const c = {
    format, title: text(r.title, AD_LIMITS.title), message: text(r.message, AD_LIMITS.message), website, imageSrc, imageTallSrc,
    backgroundColor: color(r.backgroundColor, '#ffffff'), textColor: color(r.textColor, '#111827'),
    logoX: clamp(r.logoX, 0, 100, 4), logoY: clamp(r.logoY, 0, 100, 50), logoSize: clamp(r.logoSize, 20, 100, 74),
  };
  // how each picture sits: its crop, and for a full picture how it fills the space, its zoom and where it is moved to
  const pic = picture(r.pic), picTall = picture(r.picTall);
  if (pic && imageSrc) c.pic = pic;
  if (picTall && imageTallSrc) c.picTall = picTall;
  if (format === 'image' && !c.imageSrc && !c.imageTallSrc) return new Error('A full-picture design needs a picture');
  if (format === 'logo' && !c.title && !c.imageSrc) return new Error('Give it a title or a picture');
  if (format === 'logo') c.imageTallSrc = '';
  return c;
}
/** The fits a full picture takes: fill the space (cut what overflows), show it whole, or stretch it to the space. */
export const PIC_FITS = Object.freeze(['cover', 'contain', 'stretch']);
/**
 * How a picture is placed (null when it is left as it comes): crop [x0, z0, x1, z1] of the picture (0…1), fit, zoom
 * (0.25…4) and the move (x, y: −1…1 of the space). Absent fields are the defaults (no crop, fill, 1, centred).
 */
export function picture(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = {};
  if (Array.isArray(raw.crop) && raw.crop.length === 4) {
    let [x0, y0, x1, y1] = raw.crop.map(v => clamp(v, 0, 1, 0));
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 - x0 >= 0.02 && y1 - y0 >= 0.02 && (x0 > 0 || y0 > 0 || x1 < 1 || y1 < 1)) o.crop = [x0, y0, x1, y1].map(v => Math.round(v * 10000) / 10000);
  }
  if (PIC_FITS.includes(raw.fit) && raw.fit !== 'cover') o.fit = raw.fit;
  const zoom = clamp(raw.zoom, 0.25, 4, 1); if (Math.abs(zoom - 1) > 1e-3) o.zoom = Math.round(zoom * 1000) / 1000;
  for (const k of ['x', 'y']) { const v = clamp(raw[k], -1, 1, 0); if (Math.abs(v) > 1e-3) o[k] = Math.round(v * 1000) / 1000; }
  return Object.keys(o).length ? o : null;
}
/** The account an uploaded picture belongs to, or null. */
export const adImageOwner = src => { const m = AD_IMAGE_RE.exec(String(src || '')) || SIGN_IMAGE_RE.exec(String(src || '')); return m ? Number(m[1]) : null; };

/** A small, well-mixed hash of a string (32 bits). */
export function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
/**
 * The ad a place shows at time t (s, the shared clock): slot names the place ('billboard:<id>', 'street:<id>',
 * 'metro:<station>', 'aircraft:<id>', 'in:<building>:<level>:<item>'), campaigns are the running ones for its space
 * ({ id, weight }), every `seconds` the next one by a draw from the slot and the period, so every screen agrees.
 * Returns a campaign, or null for the house's turn.
 */
export function adFor(slot, t, campaigns, seconds = 60, houseWeight = 1) {
  const list = (campaigns || []).filter(c => c && c.weight > 0);
  const total = list.reduce((n, c) => n + c.weight, 0) + Math.max(0, houseWeight);
  if (!list.length || total <= 0) return null;
  const period = Math.floor(t / Math.max(1, seconds));
  let r = (hash32(`${slot}#${period}`) / 4294967296) * total;
  for (const c of list) { if (r < c.weight) return c; r -= c.weight; }
  return null;
}
/** When the place's current ad changes next (s), for screens that repaint only then. */
export const adNextChange = (t, seconds = 60) => (Math.floor(t / Math.max(1, seconds)) + 1) * Math.max(1, seconds);
