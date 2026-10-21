// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The angler (docs/features/fishing.md §Gear, step 7): what a player fishes with. Rods, reels, lines, the leader and the
// bait and lures are things in their inventory (server/economy/inventory.js: bought at a dock store's counter, given,
// traded); which rod, reel and line they use, their boat's upgrades (theirs on every boat) and their skills (one point
// a fishing level) are kept here (fish_anglers, schema v51). A trip's kit (shared/fishing.js prepare) is built from both;
// what a trip used up — bait a fish took, lures lost to a snapped line — leaves the inventory when it ends. What the
// store sells is paid into the economy's Tackle sink. Without the economy (or its inventory) everyone fishes with the
// starter's kit, as before.
import { subj } from '../economy/economy.js';
import { moduleLevel } from '../../shared/play.js';
import { RODS, REELS, LINES, LEADER, LURES, LURE_BY_ID, BOAT_UPGRADES, UPGRADE_BY_ID, SKILLS, SKILL_MAX, RESPEC_PRICE, GEAR, STARTER, loadout } from '../../shared/fishing-gear.js';
import { FishError } from './fish-market.js';
import { SPECIES, speciesOf } from '../../shared/fish-species.js';

const fail = (status, code, msg) => { throw new FishError(status, code, msg); };
const SLOTS = { rod: RODS, reel: REELS, line: LINES };
const parse = s => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const MAX_PACKS = 20;

export class Angler {
  /** o: { dbs, economy() → the economy (or null), play: PlayCore (the fishing level), market: FishMarket (which store), now?, log? } */
  constructor({ dbs, economy, play, market, now = () => Date.now(), log = null }) {
    this.db = dbs.db; this.w = dbs.worldId; this.economy = economy; this.play = play; this.market = market; this.now = now; this.log = log;
    this.q = {
      get: this.db.prepare('SELECT kit, stats FROM fish_anglers WHERE world_id = ? AND account_id = ?'),
      put: this.db.prepare(`INSERT INTO fish_anglers (world_id, account_id, kit, stats, updated) VALUES ($w, $a, $kit, $stats, $t)
        ON CONFLICT (world_id, account_id) DO UPDATE SET kit = $kit, stats = $stats, updated = $t`),
      xp: this.db.prepare("SELECT xp FROM play_progress WHERE world_id = ? AND account_id = ? AND module = 'fishing'"),
      // the Fishdex (every species an angler has landed) and the world's records (the biggest of each species)
      dex: this.db.prepare('SELECT species, n, best_kg AS kg, best_cm AS cm, first_at AS first, best_at AS at FROM fish_dex WHERE world_id = ? AND account_id = ?'),
      dexPut: this.db.prepare(`INSERT INTO fish_dex (world_id, account_id, species, n, best_kg, best_cm, first_at, best_at) VALUES ($w, $a, $s, $n, $kg, $cm, $t, $t)
        ON CONFLICT (world_id, account_id, species) DO UPDATE SET n = n + $n,
          best_cm = CASE WHEN $kg > best_kg THEN $cm ELSE best_cm END, best_at = CASE WHEN $kg > best_kg THEN $t ELSE best_at END, best_kg = MAX(best_kg, $kg)`),
      dexCount: this.db.prepare('SELECT COUNT(*) AS n FROM fish_dex WHERE world_id = ? AND account_id = ? AND n > 0'),
      records: this.db.prepare(`SELECT r.species, r.account_id AS id, a.display_name AS name, r.kg, r.cm, r.at FROM fish_records r
        LEFT JOIN accounts a ON a.id = r.account_id AND a.world_id = r.world_id WHERE r.world_id = ?`),
      record: this.db.prepare('SELECT account_id AS id, kg FROM fish_records WHERE world_id = ? AND species = ?'),
      recordPut: this.db.prepare(`INSERT INTO fish_records (world_id, species, account_id, kg, cm, at) VALUES ($w, $s, $a, $kg, $cm, $t)
        ON CONFLICT (world_id, species) DO UPDATE SET account_id = $a, kg = $kg, cm = $cm, at = $t WHERE $kg > fish_records.kg`),
    };
  }
  get econ() { const E = this.economy()?.econ; return E?.enabled?.() ? E : null; }
  get inv() { return this.econ?.parts?.inventory || null; }
  row(id) { const r = this.q.get.get(this.w, id); return { kit: parse(r?.kit), stats: parse(r?.stats) }; }
  save(id, { kit, stats }) { this.q.put.run({ w: this.w, a: id, kit: JSON.stringify(kit || {}), stats: JSON.stringify(stats || {}), t: this.now() }); }
  level(id) { return moduleLevel(this.q.xp.get(this.w, id)?.xp || 0); }
  /** Skill points: one a fishing level after the first. */
  points(id, kit = this.row(id).kit) {
    const total = Math.max(0, this.level(id) - 1), spent = Object.values(kit.skills || {}).reduce((a, n) => a + (n || 0), 0);
    return { total, spent, free: Math.max(0, total - spent) };
  }
  /** What of the fishing gear the account holds: { gear: Set of gear ids, lures: { id: count } } (its welcome kit first). */
  holds(id) {
    const inv = this.inv, out = { gear: new Set(), lures: {} };
    if (!inv) return null;
    const who = subj('account', id);
    inv.welcome(who);
    for (const s of inv.list(who)) {
      if (s.item.startsWith('gear:')) out.gear.add(s.item.slice(5));
      else if (s.item.startsWith('lure:')) out.lures[s.item.slice(5)] = (out.lures[s.item.slice(5)] || 0) + s.qty - (s.held || 0);
    }
    return out;
  }
  /**
   * The kit a trip takes (shared/fishing.js prepare → the run's state): the rod, reel and line chosen (if still held —
   * else the best held, else the starter's the dock lends), the leader if held and on, the bait and lures held, the
   * boat's upgrades and the skills.
   */
  tripKit(id) {
    const H = this.holds(id);
    if (!H) return STARTER;
    const { kit } = this.row(id), pick = slot => {
      if (kit[slot] && H.gear.has(kit[slot])) return kit[slot];
      const best = SLOTS[slot].filter(g => H.gear.has(g.id)).sort((a, b) => b.tier - a.tier)[0];
      return best ? best.id : STARTER[slot];
    };
    return { rod: pick('rod'), reel: pick('reel'), line: pick('line'), leader: H.gear.has(LEADER.id) && kit.leader !== false, lures: H.lures, boat: { ...(kit.boat || {}) }, skills: { ...(kit.skills || {}) } };
  }
  /** The kit's numbers for the boat (shared/boat-model.js newBoat): its top speed (engine and seamanship) and the anchor's hold. */
  boatKit(id) { const L = loadout(this.tripKit(id)); return { speed: L.boatSpeed, anchor: L.boat.anchor }; }

  /** The counter's view: the gear (held, in use, its price and level), bait and lures, the boat, the skills. */
  view(account) {
    const id = account.id, { kit, stats } = this.row(id), lvl = this.level(id), H = this.holds(id), T = this.tripKit(id);
    const E = this.econ, store = this.market?.storeAt(id) || null;
    const gear = g => ({ id: g.id, name: g.name, tier: g.tier, price: g.price, level: g.level, blurb: g.blurb, have: !!H?.gear.has(g.id), using: T.rod === g.id || T.reel === g.id || T.line === g.id || (g.id === LEADER.id && T.leader), locked: lvl < g.level });
    let vc = null; try { vc = E ? E.walletView(E.walletFor(subj('account', id))).available : null; } catch { vc = null; }
    return {
      open: !!(E && this.inv), atStore: store ? { name: store.name || 'Dock Store' } : null, level: lvl, vc, points: this.points(id, kit),
      rods: RODS.map(gear), reels: REELS.map(gear), lines: LINES.map(gear), leader: gear(LEADER),
      lures: LURES.map(l => ({ id: l.id, name: l.name, icon: l.icon, water: l.water, kind: l.kind, pack: l.pack, price: l.price, level: l.level, blurb: l.blurb, have: H?.lures[l.id] || 0, locked: lvl < l.level })),
      boat: BOAT_UPGRADES.map(u => { const t = Math.max(0, Math.min(3, kit.boat?.[u.id] || 0)); return { id: u.id, name: u.name, icon: u.icon, unit: u.unit, blurb: u.blurb, tier: t, value: u.tiers[t], next: t < 3 ? { tier: t + 1, value: u.tiers[t + 1], price: u.price[t + 1], level: u.level[t + 1], locked: lvl < u.level[t + 1] } : null }; }),
      skills: SKILLS.map(s => ({ id: s.id, name: s.name, icon: s.icon, blurb: s.blurb, rank: Math.min(SKILL_MAX, kit.skills?.[s.id] || 0) })), skillMax: SKILL_MAX, respec: RESPEC_PRICE,
      kit: { rod: T.rod, reel: T.reel, line: T.line, leader: !!T.leader }, boatKit: this.boatKit(id), stats,
    };
  }

  // ---------------------------------------------------------------- buying (at a dock store)
  /** Pays the store (the Tackle sink) and does what was bought, together. what: a short label. */
  pay(account, vc, what, idem, fn) {
    const E = this.econ, inv = this.inv;
    if (!E || !inv || E.paused?.()) fail(409, 'closed', 'The dock store is closed (the economy is off)');
    const store = this.market?.storeAt(account.id);
    if (!store) fail(409, 'not_here', 'Walk into a dock store to buy tackle');
    const w = E.walletFor(subj('account', account.id));
    if (w.status === 'frozen') fail(409, 'frozen', 'Your wallet is frozen');
    return E.dbs.tx(() => {
      if (vc > 0) E.ledger.transfer(w.id, E.sink('tackle').id, Math.round(vc * 100), { kind: 'purchase', actor: `account:${account.id}`, memo: `${store.name || 'Dock Store'} — ${what}`, idem, ref: `store:${store.id ?? ''}` });
      return fn(store);
    });
  }
  /**
   * Buys at the counter: { kind: 'gear', id } (a rod, reel, line or the leader: into the inventory, and used from now
   * on), { kind: 'lure', id, packs } (bait or lures by the pack), { kind: 'boat', id } (the upgrade's next tier).
   */
  buy(account, { kind, id, packs = 1 } = {}) {
    const me = account.id, lvl = this.level(me), who = subj('account', me), stamp = this.now();
    if (kind === 'gear') {
      const g = GEAR[String(id)]; if (!g) fail(404, 'not_found', 'No such tackle');
      if (lvl < g.level) fail(403, 'locked', `${g.name} needs fishing level ${g.level}`);
      if (this.holds(me)?.gear.has(g.id)) fail(409, 'have', `You have a ${g.name} already`);
      this.pay(account, g.price, g.name, `tackle:${me}:${g.id}:${stamp}`, () => this.inv.add(who, `gear:${g.id}`, 1, null, { kind: 'buy', actor: `account:${me}`, memo: 'The dock store', idem: `tackle-in:${me}:${g.id}:${stamp}` }));
      const slot = Object.keys(SLOTS).find(k => SLOTS[k].includes(g)), r = this.row(me);
      if (slot) r.kit[slot] = g.id; else r.kit.leader = true;
      this.save(me, r);
      return { bought: g.name, view: this.view(account) };
    }
    if (kind === 'lure') {
      const l = LURE_BY_ID[String(id)]; if (!l) fail(404, 'not_found', 'No such bait');
      if (lvl < l.level) fail(403, 'locked', `${l.name} needs fishing level ${l.level}`);
      const n = Math.max(1, Math.min(MAX_PACKS, Math.floor(Number(packs) || 1)));
      this.pay(account, l.price * n, `${n} × ${l.name}`, `bait:${me}:${l.id}:${stamp}`, () => this.inv.add(who, `lure:${l.id}`, l.pack * n, null, { kind: 'buy', actor: `account:${me}`, memo: 'The dock store', idem: `bait-in:${me}:${l.id}:${stamp}` }));
      return { bought: `${l.pack * n} × ${l.name}`, view: this.view(account) };
    }
    if (kind === 'boat') {
      const u = UPGRADE_BY_ID[String(id)]; if (!u) fail(404, 'not_found', 'No such upgrade');
      const r = this.row(me), t = Math.max(0, Math.min(3, r.kit.boat?.[u.id] || 0));
      if (t >= 3) fail(409, 'top', `Your ${u.name.toLowerCase()} is the best there is`);
      if (lvl < u.level[t + 1]) fail(403, 'locked', `That needs fishing level ${u.level[t + 1]}`);
      this.pay(account, u.price[t + 1], `${u.name} ${t + 1}`, `boat:${me}:${u.id}:${t + 1}`, () => { r.kit.boat = { ...(r.kit.boat || {}), [u.id]: t + 1 }; this.save(me, r); });
      return { bought: `${u.name} ${'★'.repeat(t + 1)}`, view: this.view(account) };
    }
    fail(400, 'bad_request', 'Buy gear, bait or a boat upgrade');
  }
  /** Chooses what to fish with (anywhere): { rod | reel | line: id } you hold, or { leader: true | false }. */
  use(account, b = {}) {
    const me = account.id, H = this.holds(me), r = this.row(me);
    for (const slot of Object.keys(SLOTS)) {
      if (b[slot] === undefined) continue;
      const g = GEAR[String(b[slot])];
      if (!g || !SLOTS[slot].includes(g)) fail(400, 'bad_request', `That isn't a ${slot}`);
      if (g.id !== STARTER[slot] && !H?.gear.has(g.id)) fail(404, 'not_found', `You don't have a ${g.name}`);
      r.kit[slot] = g.id;
    }
    if (b.leader !== undefined) r.kit.leader = !!b.leader;
    this.save(me, r);
    return this.view(account);
  }
  /** Spends a skill point (anywhere): a rank in { id }. */
  skill(account, { id } = {}) {
    const me = account.id, s = SKILLS.find(x => x.id === String(id));
    if (!s) fail(404, 'not_found', 'No such skill');
    const r = this.row(me), rank = r.kit.skills?.[s.id] || 0;
    if (rank >= SKILL_MAX) fail(409, 'top', `${s.name} is at its top rank`);
    if (this.points(me, r.kit).free < 1) fail(409, 'no_points', 'No skill points left — each fishing level brings one');
    r.kit.skills = { ...(r.kit.skills || {}), [s.id]: rank + 1 };
    this.save(me, r);
    return this.view(account);
  }
  /** Takes every skill point back, for a price (at a dock store). */
  respec(account) {
    const me = account.id, r = this.row(me);
    if (!Object.values(r.kit.skills || {}).some(n => n > 0)) fail(409, 'nothing', 'No skill points spent yet');
    this.pay(account, RESPEC_PRICE, 'A fresh start (skills)', `respec:${me}:${this.now()}`, () => { r.kit.skills = {}; this.save(me, r); });
    return this.view(account);
  }

  // ---------------------------------------------------------------- after a trip
  /**
   * A trip ended (the play routes' onFinish): what it used up leaves the inventory — detail.used { lure: n } (bait a
   * fish took, lures lost to a snapped line), never more than is there; the running totals. Once per trip (its record).
   */
  afterTrip(account, result) {
    const run = result?.row ? this.market?.q.run.get(this.w, account.id, result.row) : null;
    if (!run || run.id <= (this.row(account.id).stats.lastRun || 0)) return null;   // (once per trip: its record's id only grows)
    const detail = parse(run.detail), row = run.id, inv = this.inv, who = subj('account', account.id), used = detail.used || {};
    if (inv && row) for (const [lure, n] of Object.entries(used)) {
      if (!LURE_BY_ID[lure] || !(n > 0)) continue;
      const stacks = inv.list(who).filter(s => s.item === `lure:${lure}`);
      let left = Math.floor(n);
      for (const s of stacks) {
        const q = Math.min(left, s.qty - (s.held || 0)); if (q <= 0) continue;
        try { inv.take(who, s.id, q, { kind: 'use', actor: 'system:fishing', memo: 'Used on a fishing trip', ref: `play_run:${row}`, idem: `fish-used:${row}:${lure}:${s.id}` }); left -= q; } catch (e) { this.log?.warn?.('[fishing] bait not taken', e.message); }
        if (left <= 0) break;
      }
    }
    const r = this.row(account.id), st = r.stats;
    st.trips = (st.trips || 0) + 1; st.fish = (st.fish || 0) + (detail.fish || 0); st.released = (st.released || 0) + (detail.released || 0);
    st.biggestKg = Math.max(st.biggestKg || 0, detail.maxKg || 0); st.lastRun = row;
    this.save(account.id, r);
    // the Fishdex and the world's records: every species landed on the trip, kept or let go
    const had = new Set(this.q.dex.all(this.w, account.id).map(d => d.species)), fresh = [], records = [], t = this.now();
    this.db.exec('SAVEPOINT fish_dex');
    try {
      for (const it of Array.isArray(detail.landed) ? detail.landed : []) {
        const [species, n, kg, cm] = it, sp = speciesOf(species);
        if (!sp || !(n > 0) || !(kg > 0)) continue;
        this.q.dexPut.run({ w: this.w, a: account.id, s: species, n: Math.floor(n), kg, cm, t });
        if (!had.has(species)) fresh.push(species);
        const was = this.q.record.get(this.w, species);
        if (!was || kg > was.kg) { this.q.recordPut.run({ w: this.w, s: species, a: account.id, kg, cm, t }); records.push({ species, kg, cm, was: was ? { kg: was.kg, mine: was.id === account.id } : null }); }
      }
      this.db.exec('RELEASE fish_dex');
    } catch (e) { this.db.exec('ROLLBACK TO fish_dex'); this.db.exec('RELEASE fish_dex'); throw e; }
    const count = this.q.dexCount.get(this.w, account.id).n, want = [];
    for (const [n, id] of [[10, 'fishdex_10'], [25, 'fishdex_25'], [50, 'fishdex_50'], [SPECIES.length, 'fishdex_all']]) if (count >= n) want.push(id);
    if (records.some(x => !x.was?.mine)) want.push('record_breaker');
    if ((st.released || 0) >= 25) want.push('gentle_hands');
    const badges = want.length && this.play?.grant ? this.play.grant(account.id, 'fishing', want) : [];
    return { used: Object.values(used).reduce((a, n) => a + n, 0), dex: { fresh, count, of: SPECIES.length }, records, badges };
  }
  /**
   * The Fishdex as an angler sees it: { mine: { species: { n, kg, cm, first, at } }, records: { species: { kg, cm, name,
   * at, mine } }, count, of }. The species themselves (where they live, what they take) are the shared list.
   */
  dex(account) {
    const mine = {}, records = {};
    for (const d of this.q.dex.all(this.w, account.id)) if (d.n > 0) mine[d.species] = { n: d.n, kg: d.kg, cm: d.cm, first: d.first, at: d.at };
    for (const r of this.q.records.all(this.w)) records[r.species] = { kg: r.kg, cm: r.cm, name: r.name || 'Someone', at: r.at, mine: r.id === account.id };
    return { mine, records, count: Object.keys(mine).length, of: SPECIES.length };
  }
  /** A deleted account's angler goes with it. */
  forgetAccount(id) { for (const t of ['fish_anglers', 'fish_dex', 'fish_records']) this.db.prepare(`DELETE FROM ${t} WHERE world_id = ? AND account_id = ?`).run(this.w, id); }
}
