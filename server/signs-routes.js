// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Pictures on signs (shared/signs.js; both editions): the designs of owners' rooftop billboards and signs inside, and
// the Marketing tools' own content for billboards, street signs and aircraft (the house's turns). Uploaded by the
// account that designs them, checked by their first bytes (PNG, JPEG, WebP, GIF up to 2 MB), kept in the data folder
// as /signs/s<account>-<random>.<ext> and served from there. Pictures no sign uses are deleted after a week.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX = 2 * 1024 * 1024;
const TYPES = { 'image/png': ['png', [0x89, 0x50, 0x4e, 0x47]], 'image/jpeg': ['jpg', [0xff, 0xd8, 0xff]], 'image/webp': ['webp', [0x52, 0x49, 0x46, 0x46]], 'image/gif': ['gif', [0x47, 0x49, 0x46, 0x38]] };
const NAME = /^s\d{1,12}-[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
const WEEK = 7 * 86400e3;

/** @param router @param d { dataDir, world(), readStream(req, limit), docs?() (other places that may name pictures: JSON strings) } */
export function addSignRoutes(router, d) {
  const dir = path.join(d.dataDir, 'signs');
  fs.mkdirSync(dir, { recursive: true });
  const buckets = new Map();
  const brake = id => {
    const now = Date.now(), b = buckets.get(id) || { t: now, n: 0 };
    b.n = Math.max(0, b.n - (now - b.t) / 6000); b.t = now; b.n += 1; buckets.set(id, b);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.t > 600e3) buckets.delete(k);
    return b.n > 20;
  };
  router.add({ method: 'POST', path: '/api/signs/image', cap: 'property.hold', lock: 'edit', raw: true, handler: async ({ P, req }) => {
    if (!P.account) return { status: 401, json: { error: 'Sign in to upload a picture', code: 'signin_required' } };
    if (brake(P.account.id)) return { status: 429, json: { error: 'Too many uploads; wait a moment.', code: 'slow_down' } };
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), t = TYPES[type];
    if (!t) return { status: 415, json: { error: 'Upload a PNG, JPEG, WebP or GIF picture', code: 'unsupported_media_type' } };
    let buf;
    try { buf = await d.readStream(req, MAX); } catch (e) { return { status: e.status || 400, json: { error: e.status === 413 ? 'Pictures are at most 2 MB' : 'The upload failed', code: 'bad_image' } }; }
    if (buf.length < 16 || !t[1].every((x, i) => buf[i] === x) || (t[0] === 'webp' && buf.subarray(8, 12).toString('latin1') !== 'WEBP')) return { status: 400, json: { error: 'That file is not the picture it says it is', code: 'bad_image' } };
    const name = `s${Number(P.account.id)}-${crypto.randomBytes(8).toString('hex')}.${t[0]}`;
    fs.writeFileSync(path.join(dir, name), buf, { mode: 0o644 });
    return { status: 200, json: { imageSrc: `/signs/${name}` } };
  } });
  // the week-old pictures nothing names any more
  const sweep = () => {
    try {
      const used = new Set(), text = JSON.stringify(d.world() || {}) + (d.docs ? d.docs() : '');
      for (const m of text.matchAll(/\/signs\/(s\d{1,12}-[a-f0-9]{16}\.(?:png|jpg|webp|gif))/g)) used.add(m[1]);
      for (const f of fs.readdirSync(dir)) {
        if (!NAME.test(f) || used.has(f)) continue;
        const st = fs.statSync(path.join(dir, f));
        if (Date.now() - st.mtimeMs > WEEK) fs.unlinkSync(path.join(dir, f));
      }
    } catch { /* tried again later */ }
  };
  setTimeout(sweep, 60e3).unref();
  setInterval(sweep, 6 * 3600e3).unref();
}
