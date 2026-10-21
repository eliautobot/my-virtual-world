// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Promotional aircraft (WP4.11, PLAN WP4.11, DECISIONS C41): banner planes, blimps and hot-air balloons flying over
// and round the city with an administrator's advertisement. The configuration (shared/promo.js normalises it, here
// and in the browser) is kept with the world (world.promo), plus a schedule: the hours of the world's day they fly. Graphics are uploaded images kept in the data folder (served at /promo/), so the
// world stays self-contained. Every browser flies the same fleet on the shared clock.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizePromoAircraftConfig } from '../shared/promo.js';

const MAX_IMAGE = 3 * 1024 * 1024;
const TYPES = { 'image/png': ['png', [0x89, 0x50, 0x4e, 0x47]], 'image/jpeg': ['jpg', [0xff, 0xd8, 0xff]], 'image/webp': ['webp', [0x52, 0x49, 0x46, 0x46]], 'image/gif': ['gif', [0x47, 0x49, 0x46, 0x38]] };

/** The schedule: the hours of the world's day the fleet flies ({ from, to }, wrapping past midnight). */
export function normalizeSchedule(s) {
  const h = v => (Number.isFinite(+v) ? Math.max(0, Math.min(24, Math.round(+v * 2) / 2)) : null);
  const from = h(s?.from), to = h(s?.to);
  return { from: from ?? 7, to: to ?? 21 };
}
export const promoView = world => ({ config: normalizePromoAircraftConfig(world.promo?.config), schedule: normalizeSchedule(world.promo?.schedule) });

/** @param router @param d { world(), dataDir, audit, broadcast, worldChanged(), readStream(req, limit) } */
export function addPromoRoutes(router, d) {
  const dir = path.join(d.dataDir, 'promo');
  fs.mkdirSync(dir, { recursive: true });
  router.add({ method: 'GET', path: '/api/promo-aircraft', cap: 'world.view', handler: async () => ({ status: 200, json: promoView(d.world()) }) });
  router.add({ method: 'POST', path: '/api/promo-aircraft', cap: 'promo.manage', lock: 'edit', handler: async ({ P, body }) => {
    const W = d.world();
    W.promo = { config: normalizePromoAircraftConfig(body.config), schedule: normalizeSchedule(body.schedule) };
    d.worldChanged();
    const v = promoView(W);
    d.broadcast({ t: 'promo', ...v });
    d.audit?.log('promo.set', { actor: P.account ? { id: P.account.id, login: P.account.login } : null, detail: { enabled: v.config.enabled, schedule: v.schedule } });
    return { status: 200, json: v };
  } });
  router.add({ method: 'POST', path: '/api/promo-aircraft/image', cap: 'promo.manage', lock: 'edit', raw: true, handler: async ({ req }) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), t = TYPES[type];
    if (!t) return { status: 415, json: { error: 'Upload a PNG, JPEG, WebP or GIF picture', code: 'unsupported_media_type' } };
    let buf;
    try { buf = await d.readStream(req, MAX_IMAGE); } catch (e) { return { status: e.status || 400, json: { error: e.status === 413 ? 'Pictures are at most 3 MB' : 'The upload failed', code: 'bad_image' } }; }
    if (buf.length < 16 || !t[1].every((b, i) => buf[i] === b)) return { status: 400, json: { error: 'That file is not the picture it says it is', code: 'bad_image' } };
    const name = `${crypto.randomBytes(9).toString('hex')}.${t[0]}`;
    fs.writeFileSync(path.join(dir, name), buf, { mode: 0o644 });
    return { status: 200, json: { imageSrc: `/promo/${name}` } };
  } });
}
