// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Getting started (2026-10-09: "new users don't know how to use the interface and how to get things done"): what the
// in-world guide (client/js/ui/guide.js) needs for a signed-in account — whether it has been through the welcome tour,
// and which of the first things to do it has done, read from what the account actually holds (never from the browser):
//   land     it holds a lot          build   a building stands on one of its lots     agent   it owns an agent
//   talk     it has written to an agent in a chat                                     home    it set a home view
// A task this account cannot do here (no land for sale on this server, no right to add agents) is left out. The guide's
// own state (tour seen or skipped, the checklist hidden) is the account setting display.guide, written through
// /api/account/settings like every display preference — kept with the account, so it follows it to every device and a
// second account on the same browser starts its own tour.
export const GUIDE_TASKS = Object.freeze(['land', 'build', 'agent', 'talk', 'home']);

/** The account's guide state: { tour: 'done'|'skipped'|null, list: 'hidden'|null } from the stored JSON (bad JSON: none). */
export function parseGuide(raw) {
  let j = null;
  try { j = raw ? JSON.parse(raw) : null; } catch { j = null; }
  const o = j && typeof j === 'object' ? j : {};
  return { tour: o.tour === 'done' || o.tour === 'skipped' ? o.tour : null, list: o.list === 'hidden' ? 'hidden' : null };
}

export class Guide {
  /**
   * @param {{ dbs: object, world: () => object, settings: object, can: (P: object, cap: string) => boolean,
   *   landForSale?: () => boolean }} o  landForSale: whether players can buy land here (the economy's realty, for Virtual Coin)
   */
  constructor({ dbs, world, settings, can, landForSale = () => false }) {
    Object.assign(this, { world, settings, can, landForSale });
    const db = dbs.db;
    this.w = dbs.worldId;
    const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    this.q = {
      agent: db.prepare('SELECT 1 FROM agents WHERE world_id = ? AND owner_id = ? AND deleted IS NULL LIMIT 1'),
      talk: db.prepare("SELECT 1 FROM chat_messages WHERE world_id = ? AND account_id = ? AND role = 'user' AND agent_id IS NOT NULL LIMIT 1"),
    };
    if (has('lot_titles')) {
      this.q.lots = db.prepare(`SELECT t.lot_id AS id FROM lot_titles t JOIN lots l ON l.id = t.lot_id
        WHERE t.world_id = ? AND t.holder_kind = 'account' AND t.holder_id = ? AND l.lifecycle != 'retired'`);
    }
  }

  /** What the guide shows this principal: its state and its tasks ({ id, done }), in order. */
  view(P) {
    const id = P.account.id, W = this.w;
    const lots = this.q.lots ? this.q.lots.all(W, String(id)).map(r => r.id) : [];
    const mine = new Set(lots);
    const built = lots.length > 0 && (this.world()?.buildings || []).some(b => b && !b.gone && b.lot && mine.has(b.lot));
    const land = this.can(P, 'property.hold') && (lots.length > 0 || this.landForSale());
    const agents = this.can(P, 'agents.manage');
    const has = {
      land: lots.length > 0, build: built, agent: !!this.q.agent.get(W, id), talk: !!this.q.talk.get(W, id),
      home: !!String(this.settings.accountValue(id, 'display.home') || '').trim(),
    };
    const offered = { land, build: land, agent: agents, talk: agents || has.talk, home: true };
    return {
      guide: parseGuide(this.settings.accountValue(id, 'display.guide')),
      tasks: GUIDE_TASKS.filter(t => offered[t]).map(t => ({ id: t, done: has[t] })),
    };
  }
}

/** GET /api/guide: the signed-in account's own guide (account.self: a signed-in account, never a guest). */
export function addGuideRoutes(router, guide) {
  router.add({ method: 'GET', path: '/api/guide', cap: 'account.self', handler: ({ P }) => ({ status: 200, json: guide.view(P) }) });
}
