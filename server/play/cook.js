// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A cook's record in Order Up (PLAN-RESTAURANT-GAME.md "Progression", 2026-10-28; schema v56): beyond what the play
// platform keeps for every module (experience, levels, best Rushes, badges: server/play/play.js), a cook's running totals
// and the COOKBOOK, every dish they have served (how many, their best grade), as the fishing game's Fishdex. After each
// Rush that counts, the record takes what was served (the Rush's detail, worked out by the server: shared/orderup/module.js
// rushDetail) and gives the badges that need the whole history (the Cookbook's counts, every dish of a cuisine, a hundred
// Supreme). A COOK is an account (its id) or an agent (minus its id): the same record, the same badges, the same rules.
import { BOOK_BADGES, CUISINES, COOKBOOK_ALL } from '../../shared/orderup/module.js';
import { FOOD_BY_ID } from '../../shared/food.js';
import { gradeOf } from '../../shared/orderup/rules.js';
import { SKILLS, SKILL_BY_ID, SKILL_MAX, RESPEC_PRICE, cleanSkills, pointsOf } from '../../shared/orderup/skills.js';
import { moduleLevel } from '../../shared/play.js';
import { PlayError } from './play.js';

const parse = s => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const fail = (status, code, msg) => { throw new PlayError(status, code, msg); };

export class CookRecord {
  /** o: { dbs, play: PlayCore (it gives the badges), pay?(cookId, vc, what, idem, fn) (a respec's price: none, free), now?, log? } */
  constructor({ dbs, play, pay = null, now = () => Date.now(), log = null }) {
    this.db = dbs.db; this.w = dbs.worldId; this.play = play; this.pay = pay; this.now = now; this.log = log;
    this.q = {
      get: this.db.prepare('SELECT stats, skills FROM ou_cooks WHERE world_id = ? AND cook_id = ?'),
      put: this.db.prepare(`INSERT INTO ou_cooks (world_id, cook_id, stats, skills, updated) VALUES ($w, $c, $stats, $skills, $t)
        ON CONFLICT (world_id, cook_id) DO UPDATE SET stats = $stats, skills = $skills, updated = $t`),
      xp: this.db.prepare("SELECT xp FROM play_progress WHERE world_id = ? AND account_id = ? AND module = 'orderup'"),
      book: this.db.prepare('SELECT item, n, best, first_at AS first, best_at AS at FROM ou_cookbook WHERE world_id = ? AND cook_id = ?'),
      bookPut: this.db.prepare(`INSERT INTO ou_cookbook (world_id, cook_id, item, n, best, first_at, best_at) VALUES ($w, $c, $i, $n, $b, $t, $t)
        ON CONFLICT (world_id, cook_id, item) DO UPDATE SET n = n + $n, best_at = CASE WHEN $b > best THEN $t ELSE best_at END, best = MAX(best, $b)`),
    };
  }
  row(id) { const r = this.q.get.get(this.w, id); return { stats: parse(r?.stats), skills: parse(r?.skills) }; }
  /** The Cookbook: { items: { id: { n, best, grade, first, at } }, count, all }. */
  book(id) {
    const items = {};
    for (const r of this.q.book.all(this.w, id)) items[r.item] = { n: r.n, best: r.best, grade: gradeOf(r.best), first: r.first, at: r.at };
    return { items, count: Object.keys(items).length, all: COOKBOOK_ALL };
  }
  /**
   * After a Rush that counted (r: the platform's finish result, its detail the server's own): the Cookbook and the totals
   * updated, the history's badges given. → { cookbook: { fresh: [items new to it], count, all }, badges: [given] } or null.
   */
  afterRush(cookId, r) {
    const d = r?.detail; if (!d || r.game?.id !== 'orderup') return null;
    const t = this.now(), before = this.book(cookId), fresh = [], count = d.counts || {};
    const { stats, skills } = this.row(cookId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [item, best] of Object.entries(d.items || {})) {
        if (!before.items[item]) fresh.push(item);
        this.q.bookPut.run({ w: this.w, c: cookId, i: item, n: count[item] || 1, b: best, t });
      }
      stats.rushes = (stats.rushes || 0) + 1; stats.served = (stats.served || 0) + (d.served || 0); stats.lost = (stats.lost || 0) + (d.lost || 0);
      stats.burns = (stats.burns || 0) + (d.burns || 0); stats.tips = +((stats.tips || 0) + (d.tips || 0)).toFixed(2);
      stats.supreme = (stats.supreme || 0) + (d.grades?.Supreme || 0);
      stats.cats = stats.cats || {}; for (const [c, n] of Object.entries(d.cats || {})) stats.cats[c] = (stats.cats[c] || 0) + n;
      this.q.put.run({ w: this.w, c: cookId, stats: JSON.stringify(stats), skills: JSON.stringify(skills), t });
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    const after = this.book(cookId), want = [];
    for (const [n, id] of BOOK_BADGES) if (after.count >= n) want.push(id);
    for (const [cat, ids] of Object.entries(CUISINES)) if (ids.length && ids.every(i => after.items[i])) want.push(`ou_c_${cat}`);
    if (stats.supreme >= 100) want.push('ou_supreme100');
    const badges = this.play.grant(cookId, 'orderup', want);
    return { cookbook: { fresh, count: after.count, all: after.all }, badges, stats };
  }
  /** What the page shows of a cook: the Cookbook (with every dish there is, the ones not served yet greyed) and the totals. */
  view(cookId) {
    const b = this.book(cookId), { stats } = this.row(cookId);
    const dishes = Object.values(FOOD_BY_ID).filter(f => f.cat !== 'home').map(f => ({ id: f.id, name: f.name, icon: f.icon, cat: f.cat, ...(b.items[f.id] || {}) }));
    return { count: b.count, all: b.all, dishes, stats, skills: this.skills(cookId) };
  }
  // ---------------------------------------------------------------- skills (shared/orderup/skills.js)
  level(id) { return moduleLevel(this.q.xp.get(this.w, id)?.xp || 0); }
  /** A cook's skills as a Rush uses them (what the server lays a Rush out with). */
  skillsOf(id) { return cleanSkills(this.row(id).skills); }
  /** The skills panel: every skill, the cook's rank in it, the points (one an Order Up level after the first). */
  skills(id) {
    const mine = this.skillsOf(id), level = this.level(id);
    return { level, points: pointsOf(level, mine), max: SKILL_MAX, respec: RESPEC_PRICE, list: SKILLS.map(s => ({ id: s.id, name: s.name, icon: s.icon, blurb: s.blurb, rank: mine[s.id] || 0 })) };
  }
  /** A point into a skill. */
  skill(id, skillId) {
    const s = SKILL_BY_ID[String(skillId)]; if (!s) fail(404, 'not_found', 'No such skill');
    const r = this.row(id), mine = cleanSkills(r.skills), rank = mine[s.id] || 0;
    if (rank >= SKILL_MAX) fail(409, 'top', `${s.name} is at its top rank`);
    if (pointsOf(this.level(id), mine).free < 1) fail(409, 'no_points', 'No skill points left: each Order Up level brings one');
    r.skills = { ...mine, [s.id]: rank + 1 };
    this.q.put.run({ w: this.w, c: id, stats: JSON.stringify(r.stats), skills: JSON.stringify(r.skills), t: this.now() });
    return this.skills(id);
  }
  /** Every point taken back to spend again (for its price, when there is an economy). */
  respec(id) {
    const r = this.row(id);
    if (!Object.keys(cleanSkills(r.skills)).length) fail(409, 'nothing', 'No skill points spent yet');
    const clear = () => this.q.put.run({ w: this.w, c: id, stats: JSON.stringify(r.stats), skills: '{}', t: this.now() });
    if (this.pay) this.pay(id, RESPEC_PRICE, 'Order Up: a fresh start (skills)', `ou-respec:${id}:${this.now()}`, clear); else clear();
    return this.skills(id);
  }
  /** Who spends an agent's skill points: 'self' (it chooses), 'owner' (its owner keeps the choice), or null (it chooses
   *  when it has Free Will: server/play/kitchen-shifts.js). */
  modeOf(id) { const m = this.row(id).stats.spend; return m === 'self' || m === 'owner' ? m : null; }
  setMode(id, mode) {
    if (![null, 'self', 'owner'].includes(mode)) fail(400, 'bad_request', 'mode is self, owner or none');
    const r = this.row(id); r.stats.spend = mode;
    this.q.put.run({ w: this.w, c: id, stats: JSON.stringify(r.stats), skills: JSON.stringify(cleanSkills(r.skills)), t: this.now() });
    return mode;
  }
  /** A deleted cook's record goes with it. */
  forget(cookId) { for (const tb of ['ou_cooks', 'ou_cookbook']) this.db.prepare(`DELETE FROM ${tb} WHERE world_id = ? AND cook_id = ?`).run(this.w, cookId); }
}
