// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents go on post only on their owner's own property (server/agent-posts/posts.js, 2026-10-23: "even admins"): a test
// that posts one first gives the account a building, the city's lot it stands on transferred by an administrator.

/**
 * Transfers to account `login` the city's lot of the first building that `pick(B, world)` (may be async) accepts:
 * → { b, lot }. admin: an administrator's session (the owner's).
 */
export async function giveBuilding(admin, login, pick = () => true) {
  const w = (await admin.get('/api/world')).json.world;
  const lots = new Map((await admin.get('/api/property/lots')).json.lots.map(l => [l.id, l]));
  for (const B of w.buildings) {
    if (!B || B.gone || !B.lot) continue;
    const L = lots.get(B.lot);
    if (!L || L.holder?.kind !== 'municipality' || L.lifecycle === 'retired') continue;
    if (!(await pick(B, w))) continue;
    const r = await admin.post('/api/property/transfer', { id: L.id, login, reason: 'A test of agents on post' });
    if (r.status !== 200) throw new Error(`the lot's transfer failed: ${r.status} ${r.text}`);
    return { b: B.idx, lot: L.id };
  }
  throw new Error('no building of the city to give');
}
/** An office tower (desks on its upper floors): the usual building to post an agent in. */
export const office = B => B.type === 'office' && B.floors > 1;
