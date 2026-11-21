// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents playing the arcade for real (server/play/arcade-crew.js), on a generated city with a virtual clock, the real
// economy and the play core: the registry's 'arcade' source offers each machine with its game (the furniture's plain
// 'play' at it is gone: one honest way), a companion beside its player plays one for real — its body at the machine,
// billed its tokens, the run the play core's, checked by the module's own verify and recorded as its own (half the
// experience, no prize) —, its bubble, its owner's toast, its diary, its Companions bar; an agent on its own walks to a
// machine and plays; walking off with its owner leaves the game unfinished (not recorded, said so); honest noes.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { generateWorld, freshLevel } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { setPlayerSpots } from '../../server/sim/agents.js';
import { PlayerNav } from '../../shared/playernav.js';
import { PF_USING } from '../../shared/playerproto.js';
import { ctxOf } from '../../shared/constants.js';
import { toWorld } from '../../shared/geom.js';
import { Companions } from '../../server/companions/companions.js';
import { createInteractions } from '../../server/interactions/index.js';
import { PlayCore } from '../../server/play/play.js';
import { ArcadeCrew, gameAt } from '../../server/play/arcade-crew.js';
import { economyModel } from '../helpers/econ-model.mjs';

afterEach(() => setPlayerSpots(null));

function setup() {
  const world = generateWorld({ seed: 'companions-unit', population: 300 });
  // an arcade (the Floor Themes' own: its cabinets and machines) on the second floor of the biggest office
  const AB = world.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  const AL = freshLevel(AB, 1, 1, 'arcade'); world.levels.push(AL); AB.lv[1] = world.levels.length - 1;
  const roster = [{ agentId: 'c-agent-1', name: 'Riley', emoji: '🤖', role: 'Tester' }, { agentId: 'c-agent-2', name: 'Max', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1.8e12;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 12 * 3600, dayScale: 16 };
  const model = economyModel({ city: { world, people } });
  model.econ.parts.businesses.sync();
  const H = model.econ.parts.households;
  sim.econ = H;
  sim.onAct = (a, act) => H.onAct(a, act);
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `c-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `c-agent-${k}`, name: k === 1 ? 'Riley' : 'Max', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= -1) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
  const P = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: null }), agents, life: () => life, world: () => null,
    setting: k => ({ 'companions.waitMinutes': 5 })[k], notify: () => {}, send: () => {}, principalFor: () => P, now: () => ms });
  comp.hookSim();
  comp.decides = () => true;
  const I = createInteractions({ sim: () => sim, companions: () => comp, life: () => life, players, principalFor: () => P, ownerOf: r => r.ownerId });
  const play = new PlayCore({ dbs: model.dbs, now: () => ms });
  const said = [], frames = [], notes = [];
  const crew = new ArcadeCrew({ play, sim: () => sim, agents, players, companions: () => comp, say: (i, text) => said.push({ i, text }), toAccount: (id, f) => frames.push({ id, ...f }),
    note: (id, kind, text) => notes.push({ id, kind, text }), thinkAll: 8000 });
  // (before the arcade's source: the furniture's own offers, for comparing)
  const plainBefore = rec => I.nearFor(rec, { limit: 40 }).filter(x => x.source === 'furniture');
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); crew.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, comp, players, nav, recs, run, until, at, idx, model, H, I, P, play, crew, said, frames, notes, plainBefore, close: () => model.close() };
}

/** An arcade machine that plays a game, on a public floor, a slot of it free with a walkable approach: { v, ctx, id, t,
 *  game, slot, ap }. */
function gamePiece(c, but = null) {
  const B = c.sim.brain;
  for (const v of c.sim.index.venues.arcade || []) {
    const Bd = c.world.buildings[v.b], m = c.sim.index.slots(Bd.lv[v.f]);
    for (const [id, e] of m) {
      if (id === but) continue;
      const game = gameAt(e.it.t, v.b, v.f, id, e.it.g);
      if (!game) continue;
      for (const s of e.slots) {
        if (B.taken(v.b, v.f, id, s.k, -1)) continue;
        const ap = toWorld(Bd, s.ax, s.az);
        if (c.nav.ok(ap.x, ap.z, ctxOf(v.b, v.f))) return { v, ctx: ctxOf(v.b, v.f), id, t: e.it.t, game, slot: s, ap };
      }
    }
  }
  return null;
}

test('a companion beside its player at the arcade: each machine offered with its game, played for real — verified, recorded as its own — then back at their side; bubble, toast, diary, Companions bar', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
  try {
    const pc = gamePiece(c);
    assert.ok(pc, 'an arcade with a machine that plays a game');
    const p = { id: 7, name: 'Kim', x: pc.ap.x, z: pc.ap.z, y: 0, ctx: pc.ctx, yaw: 0, flags: 0, vehicleId: null };
    c.players.byId.set(7, p);
    assert.equal(c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }).ok, true);
    assert.ok(c.until(() => { const e = c.at(i); return e.ctx === p.ctx && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }, 1500), 'it came to the player there');
    p.flags |= PF_USING; c.sim.brain.playerTook(p.x, p.z, p.ctx);
    c.run(2);
    // without the arcade's source the furniture offers a plain 'play' at the machines; with it, only the games
    assert.ok(c.plainBefore(rec).some(x => x.kind === 'play'), 'the furniture\'s plain play, before');
    c.I.add(c.crew.source()); c.comp.playing = c.crew;
    const list = c.I.nearFor(rec, { limit: 40 });
    const games = list.filter(x => x.source === 'arcade' && x.kind === 'play_game');
    assert.ok(games.length > 0, `games offered: ${list.map(x => x.label).join(' | ')}`);
    assert.ok(!list.some(x => x.source === 'furniture' && x.kind === 'play' && games.some(g => g.piece.id === x.piece.id)), 'no plain play at a machine that plays a game');
    for (const g of games) assert.match(g.label, /^Play .+ on the .+ (next to|near) Kim('s)? \((your best: [\d,]+|you have not played it yet)\)/, g.label);
    const pick = games.find(x => x.withLeader) || games[0];
    if (pick.withLeader) assert.match(pick.label, /next to Kim's/);
    const before = c.H.available(A.p);
    const r = c.I.doFor(rec, pick.id, { via: 'test', minutes: 4 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.text, /^Riley is stepping up to the .+ to play /);
    assert.match(r.brain, /You haven't played it yet/);
    assert.equal(A.order.kind, 'follow', 'still its companion');
    assert.equal(A.order.seat?.mode, 'use');
    // at the machine: its run starts (the server's seed), its body using that piece
    assert.ok(c.until(() => c.crew.view(1)?.phase === 'playing', 90), 'it started playing there');
    const v0 = c.crew.view(1), run = c.play.runOf(-1);
    assert.equal(run?.module, 'arcade'); assert.equal(run.course, pick.piece.game); assert.equal(run.auto, true);
    assert.equal(A.act.id, pick.piece.id, 'its body at that machine');
    assert.equal(v0.title, games.find(g => g.id === pick.id) && v0.title);
    c.run(6);
    const cb = c.comp.list(c.P).companions[0];
    assert.match(cb.doing, /^Playing .+ · [\d,]+$/, 'its Companions bar: playing what, its score');
    assert.equal(cb.arcade?.playing, true);
    assert.ok(c.I.nearFor(rec).some(x => x.source === 'arcade' && x.kind === 'stop_game'), 'stopping is offered while it plays');
    // its tokens: the economy's own bill, from its own money
    assert.ok(c.H.available(A.p) < before, 'tokens billed from its own money');
    // the game to its end (its minutes up after a minute: it lets the game run out)
    assert.ok(c.until(() => !c.crew.crew.has(1), 6 * 60), 'the game ended');
    const last = c.crew.view(1).last;
    assert.equal(last.ok, true, `recorded: ${JSON.stringify(last)}`);
    const pr = c.play.progress(-1).modules.arcade;
    assert.equal(pr.runs, 1, 'one run of the arcade module, its own');
    assert.equal(pr.best[pick.piece.game]?.score, last.score, 'its best on that game');
    const row = c.model.dbs.db.prepare('SELECT score, xp, vc FROM play_runs WHERE account_id = -1').get();
    assert.equal(row.score, last.score); assert.equal(row.vc, 0, 'no prize for an unattended run');
    // seen and said
    assert.ok(c.said.some(x => x.i === i && x.text.includes(`${last.score.toLocaleString('en-US')} on `)), `its bubble: ${JSON.stringify(c.said)}`);
    const toast = c.frames.find(f => f.t === 'crew_arcade');
    assert.ok(toast && toast.id === 7 && toast.text.startsWith(`Riley scored ${last.score.toLocaleString('en-US')} on `), 'its owner\'s toast');
    assert.ok(c.notes.some(n => n.id === 1 && /^You played .+ beside Kim/.test(n.text) && n.text.includes(`${last.score.toLocaleString('en-US')} points`)), `its diary: ${JSON.stringify(c.notes)}`);
    // the machine let go: back at its owner's side
    c.run(2);
    assert.ok(!A.order.seat || A.order.seat.id !== pick.piece.id, 'not at the machine any more');
    assert.equal(A.order.kind, 'follow');
  } finally { c.close(); }
});

test('its owner walks off mid-game: it stops and follows — the game unfinished, not recorded, and said so; stop_game; honest noes', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
  try {
    c.I.add(c.crew.source()); c.comp.playing = c.crew;
    const pc = gamePiece(c);
    const p = { id: 7, name: 'Kim', x: pc.ap.x, z: pc.ap.z, y: 0, ctx: pc.ctx, yaw: 0, flags: 0, vehicleId: null };
    c.players.byId.set(7, p);
    c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
    assert.ok(c.until(() => { const e = c.at(i); return e.ctx === p.ctx && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }, 1500));
    const pick = c.I.nearFor(rec, { limit: 40 }).find(x => x.source === 'arcade' && x.kind === 'play_game');
    assert.ok(pick);
    assert.equal(c.I.doFor(rec, pick.id).ok, true);
    // asked again while it is on its way: an honest no
    const again = c.crew.run(c.I.contextFor(rec), { kind: 'play_game', piece: pick.piece, mode: 'with' });
    assert.equal(again.ok, false); assert.match(again.brain, /already/);
    assert.ok(c.until(() => c.crew.view(1)?.phase === 'playing', 90));
    c.run(3);
    // the player leaves the building
    const Bd = c.world.buildings[pc.v.b];
    let out = null;
    for (let r = 14; r < 40 && !out; r += 2) for (let k = 0; k < 24 && !out; k++) { const x = Bd.x + Math.sin(k * 0.26) * r, z = Bd.z + Math.cos(k * 0.26) * r; if (c.nav.ok(x, z, -1)) out = { x, z }; }
    Object.assign(p, { x: out.x, z: out.z, ctx: -1 });
    assert.ok(c.until(() => !c.crew.crew.has(1), 30), 'it stopped playing');
    assert.equal(c.crew.view(1).last.why, 'followed');
    assert.equal(c.play.runOf(-1), null, 'its run let go');
    assert.equal(c.play.progress(-1).modules.arcade.runs, 0, 'nothing recorded');
    assert.ok(c.notes.some(n => /^You stopped playing .+ to go with Kim — a game left unfinished does not count/.test(n.text)), JSON.stringify(c.notes));
    assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 4; }, 300), 'and followed them out');
    // stop_game with nothing going on: an honest no
    const st = c.crew.run(c.I.contextFor(rec), { kind: 'stop_game' });
    assert.equal(st.ok, false); assert.match(st.brain, /not playing/);
  } finally { c.close(); }
});

test('an agent on its own: it walks to a machine, plays its game in one stay, and gets up when the game is over', () => {
  const c = setup(), i = c.idx(2), A = c.sim.agents[i], rec = c.recs[1];
  try {
    c.I.add(c.crew.source());
    const pc = gamePiece(c);
    // in the arcade first (a visit there: the routine's own order)
    const Bd = c.world.buildings[pc.v.b];
    assert.equal(c.sim.order(i, { kind: 'arcade', venue: { b: pc.v.b, f: pc.v.f, x: Bd.x, z: Bd.z }, minutes: 60 }).ok, true);
    assert.ok(c.until(() => c.at(i).ctx === pc.ctx, 900), 'it is in the arcade');
    const list = c.I.nearFor(rec, { limit: 40 }).filter(x => x.source === 'arcade');
    assert.ok(list.length > 0, 'machines near it');
    assert.ok(list.every(x => x.mode === 'own' && !/near Kim/.test(x.label)));
    const pick = list[0];
    const r = c.I.doFor(rec, pick.id, { via: 'test', minutes: 4 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.text, /^Max is off to the /);
    assert.equal(A.order.kind, 'use'); assert.equal(A.order.whole, true); assert.equal(A.order.piece, pick.piece.id);
    assert.ok(c.until(() => c.crew.view(2)?.phase === 'playing', 300), 'it got there and started');
    assert.ok(c.until(() => !c.crew.crew.has(2), 6 * 60), 'the game ended');
    assert.equal(c.crew.view(2).last.ok, true, JSON.stringify(c.crew.view(2).last));
    assert.equal(c.play.progress(-2).modules.arcade.runs, 1);
    c.run(3);
    assert.ok(A.order?.kind !== 'use', 'its order over: it got up');
    assert.ok(!c.frames.some(f => f.t === 'crew_arcade') || c.frames.every(f => f.id === 7), 'a toast only to its owner, only when near');
  } finally { c.close(); }
});
