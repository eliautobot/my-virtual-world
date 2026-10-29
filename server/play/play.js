// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The play core (docs/features/play-modules.md): everything round a play module (shared/play.js), the same for every
// module — starting a run (is the course open to this player; the module lays it out), finishing it (the module checks
// what the browser reports and works the score out), experience and levels (per module and the player's own), ranks,
// best results and leaderboards, badges, and the player's profile. Runs live in memory between start and finish (a
// restart forgets a run in flight; nothing else); results are written in one transaction.
import crypto from 'node:crypto';
import {
  plays, playOf, courseOf, publicPlay, publicBadge, badgeOf, allBadges, PLATFORM_BADGES, better, starsFor, unlocked,
  moduleLevel, playerLevel, levelProgress, rankOf, prizeFor, prizeTop,
} from '../../shared/play.js';
import '../../shared/airport.js';   // the built-in modules register themselves
import '../../shared/fishing.js';
import '../../shared/arcade.js';
import '../../shared/orderup/module.js';

const RUN_TTL_MS = 2 * 3600e3;    // a run not finished within two hours is forgotten
const START_GAP_MS = 1500;        // one start every 1.5 s per account
const BIO_MAX = 280, SHOWCASE_MAX = 3, BOARD_MAX = 50;
const AUTO_XP = 0.5;              // an unattended run (an agent's shift: server/play/kitchen-shifts.js) earns half the experience
// (a player is an account, its id; an agent plays as minus its id, 2026-10-28: the same tables, boards and profile, named
// from the agents' table)
const WHO = (t, col) => `LEFT JOIN accounts a ON ${col} > 0 AND a.id = ${col} AND a.status = 'active'
  LEFT JOIN agents g ON ${col} < 0 AND g.id = -${col} AND g.world_id = ${t}.world_id AND g.deleted IS NULL`;
const WHO_OK = '(a.id IS NOT NULL OR g.id IS NOT NULL)', WHO_NAME = 'COALESCE(a.display_name, g.name)';
export class PlayError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }
const fail = (status, code, msg) => { throw new PlayError(status, code, msg); };

export class PlayCore {
  /**
   * @param o { dbs, now?, log?, contextFor?(moduleId, where, account) → the module's prepare() context, whereIs?(account)
   *   → { x, z } where the account's player is (a module's in-run actions may check it: the fishing ground),
   *   prizes?: { rules() → the economy's play policy or null (no economy: no prizes), pay(accountId, amount, memo, idem) → { paid } } }
   */
  constructor({ dbs, now = () => Date.now(), log = null, contextFor = () => ({}), prizes = null, whereIs = () => null }) {
    this.db = dbs.db; this.w = dbs.worldId; this.now = now; this.log = log; this.contextFor = contextFor; this.prizes = prizes; this.whereIs = whereIs;
    this.runs = new Map();          // run id → { id, account, module, course, at, data }
    this.lastStart = new Map();     // account id → time of its last start
    const db = this.db;
    this.q = {
      prog: db.prepare('SELECT module, xp, runs FROM play_progress WHERE world_id = ? AND account_id = ?'),
      progPut: db.prepare(`INSERT INTO play_progress (world_id, account_id, module, xp, runs, updated) VALUES ($w, $a, $m, $xp, 1, $t)
        ON CONFLICT (world_id, account_id, module) DO UPDATE SET xp = xp + $xp, runs = runs + 1, updated = $t`),
      best: db.prepare('SELECT course, score, ms, stars, at FROM play_best WHERE world_id = ? AND account_id = ? AND module = ?'),
      bestAll: db.prepare('SELECT module, course, score, ms, stars, at FROM play_best WHERE world_id = ? AND account_id = ?'),
      bestPut: db.prepare(`INSERT INTO play_best (world_id, module, course, account_id, score, ms, stars, at) VALUES ($w, $m, $c, $a, $s, $ms, $st, $t)
        ON CONFLICT (world_id, module, course, account_id) DO UPDATE SET score = $s, ms = $ms, stars = $st, at = $t`),
      runPut: db.prepare('INSERT INTO play_runs (world_id, account_id, module, course, version, score, stars, xp, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      runVc: db.prepare('UPDATE play_runs SET vc = ? WHERE id = ?'),
      vcSince: db.prepare('SELECT COALESCE(SUM(vc), 0) AS s FROM play_runs WHERE world_id = ? AND account_id = ? AND at > ?'),
      vcAll: db.prepare('SELECT COALESCE(SUM(vc), 0) AS s FROM play_runs WHERE world_id = ? AND account_id = ?'),
      recent: db.prepare('SELECT module, course, score, stars, xp, vc, at FROM play_runs WHERE world_id = ? AND account_id = ? ORDER BY at DESC, id DESC LIMIT ?'),
      badges: db.prepare('SELECT badge, at FROM play_badges WHERE world_id = ? AND account_id = ? ORDER BY at'),
      badgePut: db.prepare('INSERT OR IGNORE INTO play_badges (world_id, account_id, badge, at) VALUES (?, ?, ?, ?)'),
      profile: db.prepare('SELECT bio, showcase FROM player_profiles WHERE world_id = ? AND account_id = ?'),
      profilePut: db.prepare(`INSERT INTO player_profiles (world_id, account_id, bio, showcase, updated) VALUES ($w, $a, $bio, $sc, $t)
        ON CONFLICT (world_id, account_id) DO UPDATE SET bio = $bio, showcase = $sc, updated = $t`),
      account: db.prepare("SELECT id, display_name AS name, role, created FROM accounts WHERE world_id = ? AND id = ? AND status = 'active'"),
      agent: db.prepare("SELECT id, name, emoji, owner_id AS owner, created FROM agents WHERE world_id = ? AND id = ? AND deleted IS NULL"),
      boardLow: db.prepare(`SELECT b.account_id AS id, ${WHO_NAME} AS name, b.score, b.stars, b.at FROM play_best b ${WHO('b', 'b.account_id')}
        WHERE b.world_id = ? AND b.module = ? AND b.course = ? AND ${WHO_OK} ORDER BY b.score ASC, b.at ASC LIMIT ?`),
      boardHigh: db.prepare(`SELECT b.account_id AS id, ${WHO_NAME} AS name, b.score, b.stars, b.at FROM play_best b ${WHO('b', 'b.account_id')}
        WHERE b.world_id = ? AND b.module = ? AND b.course = ? AND ${WHO_OK} ORDER BY b.score DESC, b.at ASC LIMIT ?`),
      aheadLow: db.prepare(`SELECT COUNT(*) AS n FROM play_best b ${WHO('b', 'b.account_id')}
        WHERE b.world_id = ? AND b.module = ? AND b.course = ? AND ${WHO_OK} AND (b.score < ? OR (b.score = ? AND b.at < ?))`),
      aheadHigh: db.prepare(`SELECT COUNT(*) AS n FROM play_best b ${WHO('b', 'b.account_id')}
        WHERE b.world_id = ? AND b.module = ? AND b.course = ? AND ${WHO_OK} AND (b.score > ? OR (b.score = ? AND b.at < ?))`),
      // one player's experience (the primary key's prefix: an index lookup, never a scan)
      xpOf: db.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM play_progress WHERE world_id = ? AND account_id = ?'),
      // the top players in SQL (sorted and cut there, names joined): one query, whatever the number of players
      top: db.prepare(`SELECT p.account_id AS id, ${WHO_NAME} AS name, SUM(p.xp) AS xp FROM play_progress p ${WHO('p', 'p.account_id')}
        WHERE p.world_id = ? AND ${WHO_OK} GROUP BY p.account_id ORDER BY xp DESC, p.account_id LIMIT ?`),
    };
  }

  // ---------------------------------------------------------------- reading
  modules() {
    const rules = this.prizeRules();
    return plays().map(m => { const v = publicPlay(m); v.prizes = rules ? Object.fromEntries(m.courses.map(c => [c.id, prizeTop(m, c, rules)])) : null; return v; });
  }
  /** The economy's prize rules, or null when there are none (no economy, switched off, or prizes off). */
  prizeRules() { try { const r = this.prizes?.rules?.(); return r && r.on ? r : null; } catch { return null; } }
  /** What an account has won today (the last 24 hours) and in all, in hundredths of a VC, and today's cap. */
  winnings(accountId) {
    const r = this.prizeRules();
    return { today: this.q.vcSince.get(this.w, accountId, this.now() - 86400e3).s, total: this.q.vcAll.get(this.w, accountId).s, cap: r ? r.dailyCap : 0, on: !!r };
  }
  /** Everything about an account's play: per module (xp, runs, level, best per course with its place), overall, badges. */
  progress(accountId) {
    const mods = {};
    for (const m of plays()) mods[m.id] = { xp: 0, runs: 0, level: 1, best: {} };
    for (const r of this.q.prog.all(this.w, accountId)) if (mods[r.module]) Object.assign(mods[r.module], { xp: r.xp, runs: r.runs, level: moduleLevel(r.xp) });
    let stars = 0;
    for (const b of this.q.bestAll.all(this.w, accountId)) {
      const M = mods[b.module]; if (!M) continue;
      M.best[b.course] = { score: b.score, ms: b.ms, stars: b.stars, at: b.at, place: this.placeOf(b.module, b.course, b.score, b.at) };
      stars += b.stars;
    }
    for (const [id, M] of Object.entries(mods)) { M.unlocked = unlocked(playOf(id), M.best); M.progress = levelProgress(M.xp, 60); }
    const xp = Object.values(mods).reduce((s, M) => s + M.xp, 0), runs = Object.values(mods).reduce((s, M) => s + M.runs, 0);
    const level = playerLevel(xp);
    return { modules: mods, xp, runs, level, stars, progress: levelProgress(xp, 100), rank: rankOf(level), badges: this.q.badges.all(this.w, accountId).map(b => ({ id: b.badge, at: b.at })) };
  }
  placeOf(moduleId, course, score, at) {
    const m = playOf(moduleId);
    const r = m.score.better === 'lower' ? this.q.aheadLow.get(this.w, moduleId, course, score, score, at) : this.q.aheadHigh.get(this.w, moduleId, course, score, score, at);
    return (r?.n || 0) + 1;
  }
  /** A course's leaderboard: the best result of each player, best first, with the viewer's own place when it is lower. */
  leaderboard(moduleId, courseId, { limit = 20, viewer = null } = {}) {
    const m = playOf(moduleId), c = m && courseOf(m, courseId);
    if (!c) fail(404, 'not_found', 'No such course');
    const n = Math.max(1, Math.min(BOARD_MAX, Math.floor(Number(limit)) || 20));
    const rows = (m.score.better === 'lower' ? this.q.boardLow : this.q.boardHigh).all(this.w, m.id, c.id, n);
    const levels = this.levels(rows.map(r => r.id).concat(viewer ? [viewer] : []));
    const row = (r, place) => ({ place, id: r.id, name: r.name, score: r.score, stars: r.stars, at: r.at, level: levels.get(r.id) || 1, rank: rankOf(levels.get(r.id) || 1).id, ...(r.id < 0 ? { agent: true } : {}) });
    const out = { module: m.id, course: c.id, rows: rows.map((r, k) => row(r, k + 1)), you: null };
    if (viewer) {
      const mine = this.q.best.all(this.w, viewer, m.id).find(b => b.course === c.id);
      if (mine) { const a = viewer < 0 ? this.q.agent.get(this.w, -viewer) : this.q.account.get(this.w, viewer); out.you = row({ id: viewer, name: a?.name || '', ...mine }, this.placeOf(m.id, c.id, mine.score, mine.at)); }
    }
    return out;
  }
  /** Player levels for some accounts (one query for all of them). */
  levels(ids) {
    const want = new Set(ids), out = new Map();
    if (!want.size) return out;
    for (const id of want) out.set(id, playerLevel(this.q.xpOf.get(this.w, id).xp));
    return out;
  }
  /** The overall leaderboard: players by level (all modules' experience together). */
  topPlayers(limit = 20) {
    const n = Math.max(1, Math.min(BOARD_MAX, Math.floor(limit) || 20)), t = this.now();
    if (this.topCache && this.topCache.n === n && t - this.topCache.at < 10000) return this.topCache.rows;   // a public page: at most one query every 10 s
    const rows = this.q.top.all(this.w, n).map((r, k) => ({ place: k + 1, id: r.id, name: r.name, xp: Math.round(r.xp), level: playerLevel(r.xp), rank: rankOf(playerLevel(r.xp)).id, ...(r.id < 0 ? { agent: true } : {}) }));
    this.topCache = { n, at: t, rows };
    return rows;
  }
  /** A player's profile, as anyone signed in sees it (own: also what can be edited). */
  profile(accountId, viewerId = null) {
    const g = accountId < 0 ? this.q.agent.get(this.w, -accountId) : null;   // (an agent's: minus its id)
    const a = g ? { id: accountId, name: g.name, created: g.created, agent: { id: g.id, emoji: g.emoji, owner: g.owner } } : this.q.account.get(this.w, accountId);
    if (!a) fail(404, 'not_found', 'No such player');
    const p = this.q.profile.get(this.w, accountId) || {}, pr = this.progress(accountId);
    let showcase = []; try { showcase = JSON.parse(p.showcase || '[]'); } catch { showcase = []; }
    const earned = new Set(pr.badges.map(b => b.id));
    return {
      id: a.id, name: a.name, own: viewerId === a.id, since: a.created, bio: p.bio || '', ...(a.agent ? { agent: a.agent } : {}),
      showcase: showcase.filter(id => earned.has(id)).slice(0, SHOWCASE_MAX),
      level: pr.level, xp: Math.round(pr.xp), progress: pr.progress, rank: pr.rank, runs: pr.runs, stars: pr.stars,
      badges: pr.badges, modules: pr.modules, vc: this.winnings(accountId).total,
      recent: this.q.recent.all(this.w, accountId, 10),
    };
  }
  /** Changes the own profile: { bio, showcase: [up to 3 earned badge ids] }. */
  setProfile(accountId, { bio, showcase } = {}) {
    const cur = this.q.profile.get(this.w, accountId) || {};
    const earned = new Set(this.q.badges.all(this.w, accountId).map(b => b.badge));
    const clean = bio === undefined ? cur.bio || '' : String(bio ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, BIO_MAX);
    let sc = cur.showcase || '[]';
    if (showcase !== undefined) {
      if (!Array.isArray(showcase)) fail(400, 'bad_request', 'showcase is a list of badges');
      const ids = [...new Set(showcase.map(String))];
      if (ids.some(id => !earned.has(id))) fail(400, 'not_earned', 'You can only show badges you have earned');
      if (ids.length > SHOWCASE_MAX) fail(400, 'too_many', `Pin at most ${SHOWCASE_MAX} badges`);
      sc = JSON.stringify(ids);
    }
    this.q.profilePut.run({ w: this.w, a: accountId, bio: clean, sc, t: this.now() });
    return this.profile(accountId, accountId);
  }

  // ---------------------------------------------------------------- playing
  /** Starts a run of a course. where: the module's own idea of where (the airport's building). */
  start(account, moduleId, courseId, where = null, o = {}) {   // (o.auto: an unattended run, an agent's shift)
    const m = playOf(moduleId); if (!m) fail(404, 'not_found', 'No such module');
    const c = courseOf(m, courseId); if (!c) fail(404, 'not_found', 'No such course');
    const t = this.now();
    if (t - (this.lastStart.get(account.id) || 0) < START_GAP_MS) fail(429, 'too_fast', 'Wait a moment before starting again');
    const best = this.progress(account.id).modules[m.id].best;
    if (!unlocked(m, best).includes(c.id)) fail(403, 'locked', `Finish ${courseOf(m, c.after)?.label || 'the course before'} first`);
    let data = null;
    if (m.prepare) {
      data = m.prepare(c, this.contextFor(m.id, where, account) || {});
      if (!data) fail(409, 'not_here', `Start this at ${m.venue ? `an ${m.venue}` : 'its place'}`);
    }
    this.gc(t);
    for (const [id, r] of this.runs) if (r.account === account.id) this.runs.delete(id);   // one run at a time
    const run = { id: crypto.randomBytes(12).toString('hex'), account: account.id, module: m.id, course: c.id, version: m.version, at: t, data, auto: !!o.auto };
    // a module that plays out over a while keeps its own state with the run (never sent to the browser), with a secret
    // for its own dice (the fishing module: what bites)
    if (m.init) { run.secret = crypto.randomBytes(16).toString('hex'); run.state = m.init(c, data, this.contextFor(m.id, where, account) || {}); }
    this.runs.set(run.id, run);
    this.lastStart.set(account.id, t);
    return { run: run.id, module: m.id, course: c.id, data, limit: c.limit || null, stars: c.stars, best: best[c.id] || null };
  }
  /**
   * A move inside a run, for a module that answers them (m.act: the fishing module's hook, land, keep, release). The
   * module works on the run's own state; it answers { error, status } to refuse.
   */
  act(account, runId, name, body = {}) {
    const run = this.runs.get(runId);
    if (!run || run.account !== account.id) fail(404, 'no_run', 'That run has ended');
    const m = playOf(run.module);
    if (!m?.act) fail(400, 'no_acts', 'This module has no moves');
    let pos = null; try { pos = this.whereIs(account) || null; } catch { pos = null; }
    const t = this.now(), r = m.act(String(name || '').slice(0, 24), body && typeof body === 'object' ? body : {}, { course: courseOf(m, run.course), data: run.data, state: run.state, secret: run.secret, serverMs: t - run.at, pos });
    if (r?.error) fail(r.status || 400, 'refused', r.error);
    return r;
  }
  /** Gives up a run (nothing is recorded). */
  abandon(account, runId) { const r = this.runs.get(runId); if (r && r.account === account.id) this.runs.delete(runId); return { ok: true }; }
  /**
   * Finishes a run with the browser's report. Returns { ok, score, stars, newBest, prevBest, xp, place, levelUp, badges,
   * unlocked } or { ok: false, why } (a run that failed the check, or ran out of time: nothing is recorded).
   */
  finish(account, runId, report) {
    const run = this.runs.get(runId);
    if (!run || run.account !== account.id) fail(404, 'no_run', 'That run has ended — start the course again');
    this.runs.delete(runId);
    const m = playOf(run.module), c = courseOf(m, run.course), t = this.now();
    let res, runRow = null;
    try { res = m.verify(c, report || {}, { serverMs: t - run.at, data: run.data, state: run.state }); }
    catch (e) { this.log?.warn?.('[play] verify failed', m.id, e.message); res = { ok: false, why: 'That run could not be checked' }; }
    if (!res?.ok) return { ok: false, why: res?.why || 'That run did not count', detail: res };
    const before = this.progress(account.id), prevBest = before.modules[m.id].best[c.id] || null;
    const stars = Number.isInteger(res.stars) ? Math.max(0, Math.min(3, res.stars)) : starsFor(m, c, res.score), newBest = better(m, res.score, prevBest?.score);   // (a module may give its own: a Rush's)
    const xp = Math.max(1, Math.round((m.xp({ ...res, stars, newBest }, c) || 0) * (stars ? 1 : 0.25) * (run.auto ? AUTO_XP : 1)));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.q.progPut.run({ w: this.w, a: account.id, m: m.id, xp, t });
      if (newBest) this.q.bestPut.run({ w: this.w, m: m.id, c: c.id, a: account.id, s: res.score, ms: res.ms ?? null, st: Math.max(stars, prevBest?.stars || 0), t });
      // (the detail as a whole or not at all: a cut-off string isn't JSON any more)
      const dj = res.detail ? JSON.stringify(res.detail) : null;
      runRow = this.q.runPut.run(this.w, account.id, m.id, c.id, run.version, res.score, stars, xp, dj && dj.length <= 6000 ? dj : dj ? '{"cut":true}' : null, t).lastInsertRowid;
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this.topCache = null;
    const after = this.progress(account.id), mine = after.modules[m.id].best[c.id];
    const runCtx = { ...res, stars, newBest, place: mine?.place ?? null, module: m.id, course: c.id };
    const badges = this.award(account.id, after, m.id, runCtx);
    const vc = run.auto || account.id < 0 ? { amount: 0, parts: [], paid: 0, why: 'An agent\'s shift: paid by its post' } : this.payPrize(account, run, m, c, { stars, newBest, prevStars: prevBest?.stars || 0, place: mine?.place ?? null, prevPlace: prevBest?.place ?? null }, runRow);
    return {
      ok: true, score: res.score, ms: res.ms ?? null, stars, newBest, prevBest, best: mine || null, xp, place: mine?.place ?? null, row: Number(runRow) || null, detail: res.detail || null,
      game: { id: m.id, name: m.name || m.id, course: c.id, courseName: c.name || c.id },   // (what was played: MVW Radio's news, server/radio/)
      module: { level: after.modules[m.id].level, was: before.modules[m.id].level, progress: after.modules[m.id].progress },
      player: { level: after.level, was: before.level, rank: after.rank, rankUp: after.rank.id !== before.rank.id, progress: after.progress },
      badges: badges.map(id => publicBadge(badgeOf(id))), vc,
      unlocked: after.modules[m.id].unlocked.filter(id => !before.modules[m.id].unlocked.includes(id)),
    };
  }
  /**
   * Pays a run's prize from the economy's Game prizes (once per run: the run's id is the payment's key), within the daily
   * cap. Returns { amount, parts, paid, capped, why }: amount is what the run earned, paid what reached the wallet.
   */
  payPrize(account, run, m, c, info, runRow) {
    const rules = this.prizeRules();
    if (!rules) return { amount: 0, parts: [], paid: 0, why: this.prizes ? 'Prizes are off here' : null };
    const { amount, parts } = prizeFor(m, c, info, rules);
    if (!amount) return { amount: 0, parts, paid: 0 };
    const today = this.q.vcSince.get(this.w, account.id, this.now() - 86400e3).s, room = Math.max(0, rules.dailyCap - today);
    const want = Math.min(amount, room);
    if (!want) return { amount, parts, paid: 0, capped: true, why: 'You have reached today\'s prize limit — the next prizes pay tomorrow' };
    try {
      const r = this.prizes.pay(account.id, want, `${m.label}: ${c.label}`, `play:${run.id}`) || {};
      const paid = r.paid ?? want;
      if (paid > 0 && runRow != null) this.q.runVc.run(paid, runRow);
      return { amount, parts, paid, capped: want < amount, why: want < amount ? 'Part of this prize is over today\'s limit' : null };
    } catch (e) {
      this.log?.warn?.('[play] prize not paid', e.message);
      return { amount, parts, paid: 0, why: e.message || 'The prize could not be paid' };
    }
  }
  /**
   * Gives a module's badges that its own records earned (the fishing angler's Fishdex and world records): those of
   * `ids` the module has and the account doesn't hold yet. → the badges given (as the browser shows them).
   */
  grant(accountId, moduleId, ids) {
    const mine = new Set((playOf(moduleId)?.badges || []).map(b => b.id)), have = new Set(this.q.badges.all(this.w, accountId).map(b => b.badge)), t = this.now();
    const got = [...new Set(ids)].filter(id => mine.has(id) && !have.has(id));
    for (const id of got) this.q.badgePut.run(this.w, accountId, id, t);
    return got.map(id => publicBadge(badgeOf(id)));
  }
  /** Gives the badges now earned and not held yet; returns their ids. */
  award(accountId, pr, moduleId, run) {
    const have = new Set(pr.badges.map(b => b.id)), got = [], t = this.now();
    const M = pr.modules[moduleId], mstats = { ...M, stars: Object.values(M.best).reduce((s, b) => s + b.stars, 0) };
    const check = (b, s) => { if (have.has(b.id)) return; let ok = false; try { ok = !!b.when(s, run); } catch { ok = false; } if (ok) got.push(b.id); };
    for (const b of playOf(moduleId)?.badges || []) check(b, mstats);
    for (const b of PLATFORM_BADGES) check(b, pr);
    for (const id of got) this.q.badgePut.run(this.w, accountId, id, t);
    return got;
  }
  gc(t = this.now()) { for (const [id, r] of this.runs) if (t - r.at > RUN_TTL_MS) this.runs.delete(id); }
  /** A deleted account's play goes with it. */
  forgetAccount(id) {
    this.topCache = null;
    for (const tb of ['play_progress', 'play_best', 'play_runs', 'play_badges', 'player_profiles']) this.db.prepare(`DELETE FROM ${tb} WHERE world_id = ? AND account_id = ?`).run(this.w, id);
    for (const [k, r] of this.runs) if (r.account === id) this.runs.delete(k);
  }
  /** Every badge there is (the profile shows the ones still to earn, greyed). */
  catalog() { return allBadges().map(publicBadge); }
}
