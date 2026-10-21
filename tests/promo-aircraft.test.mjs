// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.11 promotional aircraft (rebuilt for the design review 2026-10-03): Next's own flight plans keep every aircraft well
// above every roof and hill near its path, never turn tighter than a wide banked arc, and keep each aircraft apart from
// the rest of the fleet; the configuration a world already stores still loads; it is saved by administrators only;
// pictures are checked and kept in the data folder, served at /promo/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ownerSession, userSession } from '../tools/lib/testserver.mjs';
import { PROMO_AIRCRAFT_TYPES, PROMO_TYPE, MIN_TURN, normalizePromoAircraftConfig, resolvePromoAircraftFleet, planFleet, sampleFlight, lapAt, tightestTurn } from '../shared/promo.js';
import { normalizeSchedule } from '../server/promo-routes.js';

// a city of 1 × 0.8 km with a block of towers, the tallest 260 m, and a hill to the north
const city = { x0: -500, z0: -400, x1: 500, z1: 400 };
const buildings = [];
for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) buildings.push({ x0: i * 110 - 30, z0: j * 110 - 30, x1: i * 110 + 30, z1: j * 110 + 30, top: 40 + ((i * 7 + j * 13) % 9 + 9) % 9 * 25 });
buildings.push({ x0: -20, z0: -20, x1: 20, z1: 20, top: 260 });
const ground = (x, z) => Math.max(0, 120 - Math.hypot(x, z + 1400) / 4);
const fleetOf = counts => {
  const entries = resolvePromoAircraftFleet({ types: Object.fromEntries(PROMO_AIRCRAFT_TYPES.map(T => [T.id, { count: counts[T.id] }])) });
  return planFleet(entries, { city, buildings, ground, seaLevel: 0, wind: 0.6, seed: 5 }).map(plan => ({ T: PROMO_TYPE[plan.type], plan }));
};

test('flight plans: well above every roof and hill round the whole lap, wide turns only', () => {
  for (const { T, plan } of fleetOf({ bannerPlane: 6, blimp: 4, hotAirBalloon: 6 })) {
    for (let k = 0; k < 400; k++) {
      const p = sampleFlight(plan, k / 400), low = p.y - T.drop;
      for (const B of buildings) { const dx = Math.max(B.x0 - p.x, 0, p.x - B.x1), dz = Math.max(B.z0 - p.z, 0, p.z - B.z1); if (Math.hypot(dx, dz) < T.berth) assert.ok(low - B.top >= T.clearance - 1e-6, `${T.id} ${(low - B.top).toFixed(0)} m over a roof`); }
      assert.ok(low - ground(p.x, p.z) >= T.clearance - 1e-6, `${T.id} over the hill`);
    }
    assert.ok(tightestTurn(plan) >= T.minTurn * 0.95, `${T.id} never turns tighter than ${T.minTurn} m (tightest ${tightestTurn(plan).toFixed(0)} m)`);
  }
  assert.ok(MIN_TURN >= 200, 'no aircraft turns on the spot');
});

test('the fleet keeps apart: every pair at least 45 m apart all the time, and no higher than it needs', () => {
  const F = fleetOf({ bannerPlane: 6, blimp: 4, hotAirBalloon: 6 });
  let worst = Infinity;
  for (let t = 0; t < 1800; t += 1.5) {
    const at = F.map(({ T, plan }) => sampleFlight(plan, lapAt(plan, T, t)));
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) worst = Math.min(worst, Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y, at[i].z - at[j].z));
  }
  assert.ok(worst >= 45, `closest approach ${worst.toFixed(0)} m`);
  const top = Math.max(...F.map(({ plan }) => plan.alt)); assert.ok(top < 900, `the stack tops out at ${top.toFixed(0)} m`);
});

test('configuration: the promotions a world saved still load; counts kept to each kind\u2019s limit', () => {
  const old = { version: 1, enabled: true, types: { bannerPlane: { enabled: true, count: 10, text: 'Fly with us', websiteUrl: 'example.com', imageSrc: '/promo/abc.png' }, blimp: { enabled: false, count: 3 }, hotAirBalloon: { count: 2, imageSrc: 'https://evil.example/x.png' } } };
  const c = normalizePromoAircraftConfig(old);
  assert.equal(c.types.bannerPlane.count, PROMO_TYPE.bannerPlane.maxCount); assert.equal(c.types.bannerPlane.text, 'Fly with us');
  assert.equal(c.types.bannerPlane.websiteUrl, 'https://example.com/'); assert.equal(c.types.bannerPlane.imageSrc, '/promo/abc.png');
  assert.equal(c.types.hotAirBalloon.imageSrc, '', 'only pictures uploaded into the world');
  assert.equal(resolvePromoAircraftFleet(c).filter(e => e.typeId === 'blimp').length, 0, 'a kind switched off does not fly');
  assert.deepEqual(normalizeSchedule({ from: 25, to: -3 }), { from: 24, to: 0 });
  assert.deepEqual(normalizeSchedule(null), { from: 7, to: 21 });
});

test('promotions over the API', async () => {
  const s = await startServer({ population: 60 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const g = await alice.get('/api/promo-aircraft');
    assert.equal(g.status, 200); assert.ok(g.json.config.types.blimp);
    const body = { config: { enabled: true, types: { blimp: { enabled: true, count: 3, text: 'Visit Sunny Key', websiteUrl: 'example.com' } } }, schedule: { from: 6, to: 22 } };
    assert.equal((await alice.post('/api/promo-aircraft', body)).status, 403, 'members do not run the promotions');
    const r = await owner.post('/api/promo-aircraft', body);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.config.types.blimp.count, 3); assert.equal(r.json.config.types.blimp.websiteUrl, 'https://example.com/'); assert.deepEqual(r.json.schedule, { from: 6, to: 22 });
    assert.equal((await alice.get('/api/promo-aircraft')).json.config.types.blimp.text, 'Visit Sunny Key', 'everyone sees it');
    // pictures: checked by their bytes, kept in the data folder, served back
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d40000000049454e44ae426082', 'hex');
    const up = await fetch(`${s.url}/api/promo-aircraft/image`, { method: 'POST', headers: { 'content-type': 'image/png', cookie: owner.cookie, 'x-csrf-token': owner.csrf }, body: png });
    const uj = await up.json();
    assert.equal(up.status, 200, JSON.stringify(uj)); assert.match(uj.imageSrc, /^\/promo\/[0-9a-f]+\.png$/);
    const back = await fetch(`${s.url}${uj.imageSrc}`);
    assert.equal(back.status, 200); assert.equal(back.headers.get('content-type'), 'image/png');
    const fake = await fetch(`${s.url}/api/promo-aircraft/image`, { method: 'POST', headers: { 'content-type': 'image/png', cookie: owner.cookie, 'x-csrf-token': owner.csrf }, body: Buffer.from('<svg onload=alert(1)>') });
    assert.equal(fake.status, 400, 'a file that is not a picture is refused');
    const svg = await fetch(`${s.url}/api/promo-aircraft/image`, { method: 'POST', headers: { 'content-type': 'image/svg+xml', cookie: owner.cookie, 'x-csrf-token': owner.csrf }, body: '<svg/>' });
    assert.equal(svg.status, 415);
  } finally { await s.stop(); }
});
