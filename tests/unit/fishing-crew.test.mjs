// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions fishing with their owner (server/play/fishing-crew.js): the agent angler on a seeded trip along on its
// owner's (the same grounds and clock; only species that live there, sizes and values by the module's rules; never a hook
// sooner than a person's cast cycle; its own kit, the starter's lent), the trip weighed in as its own (experience, the
// catch into its own inventory) and sold at a dock store into its own wallet, the interaction registry's source (near,
// run, honest refusals: no trip, the boat full, too far), the dock's way down to the slip, and getting on and off its
// owner's boat in a living city (hidden at its spot, carried along, off again beside them).
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayCore } from '../../server/play/play.js';
import { FishMarket } from '../../server/play/fish-market.js';
import { Angler } from '../../server/play/angler.js';
import { FishingCrew, MIN_CYCLE_MS, kgWords, ALONG } from '../../server/play/fishing-crew.js';
import { Interactions } from '../../server/interactions/registry.js';
import { Inventory } from '../../server/economy/inventory.js';
import { subj } from '../../server/economy/economy.js';
import { Plan } from '../../server/sim/plan.js';
import { economyModel } from '../helpers/econ-model.mjs';
import { groundSites, population, OPEN, groundPos, tripValue } from '../../shared/fishing-trip.js';
import { speciesOf, sizeOf, lengthAt, weightAt } from '../../shared/fish-species.js';
import { STARTER } from '../../shared/fishing-gear.js';
import { BOATS } from '../../shared/boat-model.js';
import { DOCKS, dockDecks, deckTop } from '../../shared/dock-layout.js';
import { toWorldAt } from '../../shared/airport-layout.js';
import { TRIP_BY_ID } from '../../shared/fishing.js';
import { whereOf } from '../../server/senses/where.js';

// a coast: land west of x = 0, the bed falling east (as tests/fishing.test.mjs)
const seaDepth = (x, z) => (x <= 0 ? 0 : x < 1500 ? 0.4 + x * 0.016 + (x > 400 ? 3 * Math.sin(z / 70) : 0) : x < 1700 ? 25 + (x - 1500) * 0.4 : 105 + (x - 1700) * 0.05);
const SITES = groundSites({ water: 'sea', depthAt: seaDepth, dock: { x: 10, z: 0 }, reach: 700 });
const OWNER = 1, AGENT = 3, BODY = 5;

/** A play core, the economy (with its inventory), the fish market and the angler on one throwaway database; a boat out
 *  with the owner at its helm; a fishing crew over a stand-in simulation (one agent body, index BODY). */
function rig({ economy = true } = {}) {
  const E = economyModel({ population: 60, seed: 'fishing-crew' });
  const econ = E.econ; econ.parts.inventory = new Inventory(econ);
  E.account(OWNER);
  const T = { ms: 1.8e12 }, dbs = E.dbs;
  const b = { id: 'wm1:b1', type: 'coastal', module: 'wm1', home: { x: 30, y: 0, z: 0, yaw: Math.PI / 2, deck: { x: 28, y: 0.45, z: 0 } }, mode: 'out', skipper: OWNER, skipperName: 'Kim', pose: { x: 30, y: 0, z: 0, h: Math.PI / 2, p: 0, r: 0, v: 0 }, at: 1 };
  const H = { all: new Map([[b.id, b]]), bySkipper: new Map([[OWNER, b]]), ver: 0, place: x => x.pose, besideSlip: x => x.home.deck };
  const players = { byId: new Map([[OWNER, { id: OWNER, name: 'Kim', x: 30, y: 0.4, z: 0, ctx: -1, boatId: b.id }]]), nav: null };
  const rec = { id: AGENT, key: 'k-lara', name: 'Lara', enabled: true, ownerId: OWNER };
  const agents = { get: id => (Number(id) === AGENT ? rec : null), byKey: k => (k === rec.key ? rec : null) };
  const said = [], frames = [], notes = [];
  const a = { i: BODY, plan: new Plan(T.ms / 1000, { x: 30, y: 0, z: 0, ctx: -1 }), ride: null, order: { kind: 'follow', lead: { kind: 'player', id: OWNER } } };
  const sim = { agents: [], people: [], now: () => T.ms / 1000, clock: { rate: 1 }, brain: { reorder: () => true, alight: x => { x.ride = null; return true; } }, commit() {} };
  sim.agents[BODY] = a; sim.people[BODY] = { vip: true, agentId: rec.key, name: 'Lara' };
  let crew = null, angler = null;
  const market = new FishMarket({ dbs, economy: () => (economy ? { econ } : null), world: () => null, players, now: () => T.ms });
  const play = new PlayCore({ dbs, now: () => T.ms,
    contextFor: (id, where, account) => (id === 'fishing' ? { dock: { id: 'wm1', kind: 'marina', x: 10, z: 0 }, water: 'sea', sites: SITES, kit: angler.tripKit(account.id),
      seed: (account.id < 0 || where?.[ALONG] === true) && where && typeof where === 'object' ? where.seed : 11 } : {}),
    whereIs: acct => (acct.id < 0 ? crew.whereIs(-acct.id) : { x: b.pose.x, z: b.pose.z }) });
  angler = new Angler({ dbs, economy: () => (economy ? { econ } : null), play, market, now: () => T.ms });
  crew = new FishingCrew({ play, harbour: () => H, players, sim: () => sim, agents, companions: () => null, world: () => ({ worldModules: [], buildings: [] }), angler, market,
    say: (i, text) => said.push({ i, text }), toAccount: (id, f) => frames.push({ id, ...f }), note: (id, kind, text) => notes.push({ id, kind, text }), now: () => T.ms });
  /** Runs the crew for `secs` real seconds, twice a second. */
  const run = secs => { const end = T.ms + secs * 1000; while (T.ms < end) { T.ms += 500; crew.tick(); } };
  return { E, econ, T, b, H, players, rec, a, sim, play, market, angler, crew, said, frames, notes, run, owner: { id: OWNER, displayName: 'Kim' }, ctx: () => ({ rec, i: BODY, a, sim, leader: { account: OWNER, name: 'Kim' } }) };
}
/** A ground of the trip that stays put, with the boat moved on to it (its middle), facing so the casts land in it. */
function onGround(R, plan) {
  const g = plan.grounds.find(x => !['birds', 'boil'].includes(x.kind)) || plan.grounds[0], p = groundPos(g, 0, plan.water);
  Object.assign(R.b.pose, { x: p.x, z: p.z });
  return g;
}

test('the agent angler: its own trip along on its owner\'s — same grounds and clock, real bites and catches by the module\'s rules, a person\'s pace, weighed in and stowed as its own', () => {
  const R = rig();
  try {
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1'), ownRun = R.play.runs.get(own.run);
    const g = onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    assert.equal(R.a.ride?.boat, R.b.id, 'aboard its owner\'s boat');
    const hooks = [], lands = [];
    R.play.on(ev => { if (ev.account !== -AGENT || ev.type !== 'act') return; if (ev.name === 'hook') hooks.push(R.T.ms); if (ev.name === 'land' && ev.result?.caught) lands.push(ev.result.caught); });
    R.run(10 * 60);   // ten minutes of the trip
    const m = R.crew.crew.get(AGENT), mine = R.play.runOf(-AGENT);
    assert.ok(mine, 'its own run of the fishing module');
    assert.equal(mine.along, ownRun.id); assert.equal(mine.at, ownRun.at, 'the trip\'s clock: its owner\'s');
    assert.deepEqual(mine.data.plan.grounds.map(x => [x.id, x.kind, x.x, x.z]), ownRun.data.plan.grounds.map(x => [x.id, x.kind, x.x, x.z]), 'the same grounds');
    assert.equal(mine.auto, true, 'an unattended run: half the experience');
    assert.deepEqual(mine.state.kit.lures, STARTER.lures, 'no bait of its own: the dock lends the starter\'s');
    assert.equal(mine.state.kit.rod, 'rod_starter');
    assert.ok(m.fishing && R.notes.some(n => n.id === AGENT && /Started fishing from the/.test(n.text)), 'without Free Will it joined in, and its diary says so');
    assert.ok(hooks.length >= 5, `it got bites (${hooks.length} hooks)`);
    for (let k = 1; k < hooks.length; k++) assert.ok(hooks[k] - hooks[k - 1] >= MIN_CYCLE_MS, `never two hooks closer than a cast cycle (${hooks[k] - hooks[k - 1]} ms)`);
    assert.ok(hooks.length <= Math.ceil(10 * 60e3 / MIN_CYCLE_MS) + 1);
    assert.ok(lands.length >= 2, `it landed fish (${lands.length})`);
    const water = new Set(population(OPEN.sea, 'sea', 1).map(e => e[0]));
    for (const c of lands) {
      if (c.find) continue;
      // (a ground fished out bites as open water does: shared/fishing.js act hook)
      const sp = speciesOf(c.species), live = c.ground ? new Set([...mine.data.plan.grounds.find(x => x.id === c.ground).pop.map(e => e[0]), ...water]) : water;
      assert.equal(sp.water, 'sea', `${c.species} lives in the sea`);
      assert.ok(live.has(c.species), `${c.species} lives on ${c.ground || 'open water'}`);
      assert.ok(Math.abs(lengthAt(sp, c.u) - c.cm) < 0.11 && c.kg === Math.round(weightAt(sp, c.cm) * 1000) / 1000, `${c.species}: its length and weight by the species' own rule (${c.cm} cm, ${c.kg} kg)`);
      assert.equal(c.size, sizeOf(c.u).id);
    }
    assert.ok(lands.some(c => c.ground === g.id), 'casting over the ground it lies on');
    // seen and said: its owner's page hears each catch, a bubble over its head
    const toasts = R.frames.filter(f => f.t === 'crew_catch' && f.id === OWNER);
    assert.equal(toasts.length, lands.length);
    const fish = lands.find(c => c.species);
    if (fish) assert.ok(toasts.some(f => f.text === `Lara landed ${/^[aeiou]/i.test(kgWords(fish.kg)) ? 'an' : 'a'} ${kgWords(fish.kg)} ${speciesOf(fish.species).name}!`), 'the module\'s own words for the catch');
    assert.ok(R.said.filter(s => s.i === BODY && /^🎣/.test(s.text)).length >= lands.length, 'said out loud');
    assert.ok(R.crew.rows().some(r => r[0] === R.b.id && r[1] === BODY), 'drawn on the boat at its spot');
    // the trip ends with its owner's: weighed in as its own (score from the server's own catch), into its inventory
    const caught = mine.state.caught.map(c => ({ ...c }));
    const res = R.play.finish(R.owner, own.run, {});
    assert.equal(res.ok, true);
    R.run(1);
    assert.equal(R.play.runOf(-AGENT), null, 'its run ended with its owner\'s');
    assert.equal(m.fishing, false, 'the rod put away');
    const v = tripValue(TRIP_BY_ID['harbour-morning'], mine.data.plan, caught, { lateMin: 0, boat: {}, trader: 0 });
    assert.equal(m.lastTrip.score, v.score, 'its score: the module\'s value of its own catch');
    assert.ok(m.lastTrip.xp >= 1 && R.play.progress(-AGENT).modules.fishing.xp === m.lastTrip.xp, 'fishing experience of its own');
    const held = R.econ.parts.inventory.list(subj('agent', AGENT)).filter(s => /^(fish|find):/.test(s.item));
    assert.equal(held.length, caught.filter(c => c.kept).length, 'its kept catch is in its own inventory');
    // sold at a dock store: paid into its own wallet from the Fish market
    const wallet = () => R.econ.walletView(R.econ.walletFor(subj('agent', AGENT))).balance, before = wallet();
    const s = R.crew.sell(AGENT, { idx: 7, name: 'Harbour Dock Store', tackle: true, x: 0, z: 0, w: 10, d: 10 });
    assert.equal(s.ok, true, s.text);
    assert.ok(s.paid > 0 && s.n === held.length, `sold ${s.n} for ${s.paid}`);
    assert.equal(wallet() - before, s.paid, 'into its own wallet');
    assert.equal(R.econ.parts.inventory.list(subj('agent', AGENT)).filter(x => /^(fish|find):/.test(x.item)).length, 0, 'the fish are gone from its inventory');
    assert.ok(R.notes.some(n => n.id === AGENT && /^Sold your catch at Harbour Dock Store/.test(n.text)), 'its diary says so');
    const again = R.crew.sell(AGENT, { idx: 7, name: 'Harbour Dock Store', tackle: true });
    assert.equal(again.ok, false, 'nothing left to sell: refused, honestly');
  } finally { R.E.close(); }
});

test('the registry source: what it can do aboard (fish, stop), getting on, honest refusals', async () => {
  const R = rig();
  try {
    const I = new Interactions(); I.add(R.crew.source());
    // its owner on the boat, it on the dock: getting on is offered; too far, refused with why
    R.a.plan = new Plan(R.T.ms / 1000, { x: R.b.pose.x - 60, y: 0, z: 0, ctx: -1 });
    let near = I.near(R.ctx());
    const board = near.find(x => x.kind === 'board');
    assert.ok(board && board.withLeader && /Get on Kim's Coastal Fisher 26/.test(board.label), JSON.stringify(near));
    let r = await I.do(R.ctx(), board.id);
    assert.equal(r.ok, false); assert.match(r.text, /too far from Kim's boat/);
    // beside it: aboard
    R.a.plan = new Plan(R.T.ms / 1000, { x: R.b.pose.x - 3, y: 0, z: 0, ctx: -1 });
    r = await I.do(R.ctx(), board.id);
    assert.equal(r.ok, true, r.text); assert.equal(R.a.ride?.boat, R.b.id);
    // aboard, no trip: nothing to fish; asked anyway (the reflex), it says why not
    near = I.near(R.ctx());
    assert.ok(!near.some(x => x.kind === 'fish'), 'no trip: no fishing offered');
    r = R.crew.run(R.ctx(), { kind: 'fish' });
    assert.equal(r.ok, false); assert.match(r.text, /no fishing trip under way.+Lara will fish once it begins/i); assert.match(r.brain, /you'll fish as soon as Kim starts one/);
    assert.equal((await I.do(R.ctx(), 'fishing:fish')).ok, false, 'an affordance not there: refused');
    // a trip: asked before it began, it fishes (its Free Will on or not); the rod away when asked
    R.crew.decides = () => true;   // (Free Will decides for it: it doesn't join in by itself)
    R.T.ms += 2000;
    let own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    R.run(6);
    assert.equal(R.crew.crew.get(AGENT).fishing, true, 'asked before the trip: it fishes once it begins');
    let stop = I.near(R.ctx()).find(x => x.kind === 'stop');
    assert.ok(stop && /Put the rod away/.test(stop.label));
    r = await I.do(R.ctx(), stop.id);
    assert.equal(r.ok, true); assert.equal(R.crew.crew.get(AGENT).fishing, false);
    assert.equal(R.crew.run(R.ctx(), { kind: 'stop' }).ok, false, 'not fishing: nothing to put away');
    // the next trip: one session — everyone aboard is in it and fishes, its Free Will on or not (2026-11-19, the product owner: "all
    // companions in the boat are also accounted for"); asked to stop, it stops for that trip; the registry offers fishing
    // again, and its choice is done
    R.T.ms += 2000; R.play.finish(R.owner, own.run, {}); R.T.ms += 2000;
    own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    R.run(8);
    assert.equal(R.crew.crew.get(AGENT).fishing, true, 'in the session: fishing');
    assert.equal(R.crew.crew.get(AGENT).run.along, own.run);
    r = await I.do(R.ctx(), I.near(R.ctx()).find(x => x.kind === 'stop').id);
    assert.equal(r.ok, true); R.run(8);
    assert.equal(R.crew.crew.get(AGENT).fishing, false, 'asked to stop: it stays stopped this trip');
    near = I.near(R.ctx());
    const fish = near.find(x => x.kind === 'fish');
    assert.ok(fish && fish.id === 'fishing:fish' && fish.withLeader && fish.effects.fun > 0 && /^Fish from the .+ of Kim's boat with them \(Harbour Morning\)$/.test(fish.label), JSON.stringify(near));
    r = await I.do({ ...R.ctx(), via: 'own' }, fish.id);
    assert.equal(r.ok, true); assert.equal(r.kind, 'fish'); assert.match(r.brain, /you are fishing from the .+ of Kim's boat .+ yours/);
    assert.equal(R.crew.crew.get(AGENT).fishing, true);
    assert.ok(R.crew.crew.get(AGENT).run.along === own.run, 'on this trip');
    // the boat full (the coastal boat: four anglers, its skipper one): a fourth companion stays ashore, told why
    for (const k of [11, 12]) R.crew.crew.set(k, { agent: k, boat: R.b.id, spot: k - 10, owner: OWNER });
    const other = { id: 9, name: 'Max' }, ob = { i: 6, plan: new Plan(R.T.ms / 1000, { x: R.b.pose.x - 2, y: 0, z: 0, ctx: -1 }), ride: null };
    const full = R.crew.run({ rec: other, i: 6, a: ob, sim: R.sim, leader: { account: OWNER } }, { kind: 'board' });
    assert.equal(full.ok, false); assert.match(full.text, /full: it takes 4 anglers/);
    assert.equal(R.crew.freePlaces(R.b), 0);
  } finally { R.E.close(); }
});

test('the dock\'s way down to a slip and back up: on the decks all the way', () => {
  for (const kind of ['marina', 'lakedock']) {
    const m = { id: 'wmX', kind, x: 100, z: -40, rot: 0.6, y: 1.5, wy: 0 }, decks = dockDecks(m), K = DOCKS[kind];
    for (const sl of K.slips) {
      const route = FishingCrew.route(kind, sl.f);
      route.slice(1).forEach(([s, f]) => { const p = toWorldAt(m, s, f); assert.ok(decks.some(D => deckTop(D, p.x, p.z, 0.05) !== null), `${kind} ${sl.id}: (${s}, ${f}) is on a deck`); });
      const last = toWorldAt(m, ...route.at(-1)), boat = toWorldAt(m, sl.s, sl.f);
      assert.ok(Math.hypot(last.x - boat.x, last.z - boat.z) < 8.5, `${kind} ${sl.id}: beside the boat`);
      const up = FishingCrew.routeUp(m, last.x, last.z);
      assert.deepEqual(up.at(-1)[0], 1.5, 'back up to the quay');
    }
  }
});

test('in a living city: aboard its owner\'s boat with them, hidden at its spot and carried along, off again beside them', async () => {
  const { generateWorld } = await import('../../server/world/generate.js');
  const { generatePopulation } = await import('../../server/sim/population.js');
  const { WorldIndex } = await import('../../server/sim/windex.js');
  const { Sim } = await import('../../server/sim/sim.js');
  const { evalPlan } = await import('../../server/sim/plan.js');
  const { PlayerNav } = await import('../../shared/playernav.js');
  const { F_HIDDEN } = await import('../../shared/proto.js');
  const { Companions } = await import('../../server/companions/companions.js');
  const { CarSeats } = await import('../../server/world/car-seats.js');
  const world = generateWorld({ seed: 'fishing-crew-city', population: 200 });
  const people = generatePopulation(world, new WorldIndex(world), { population: 200, roster: [{ agentId: 'f-agent-1', name: 'Lara', emoji: '🎣', role: 'Angler' }] });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T; sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 }; sim.start();
  const i = people.findIndex(p => p && p.agentId === 'f-agent-1'), rec = { id: 1, key: 'f-agent-1', name: 'Lara', emoji: '🎣', enabled: true, ownerId: 7 };
  const agents = { get: id => (Number(id) === 1 ? rec : null), byKey: k => (k === rec.key ? rec : null), enabled: () => [rec], isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const nav = new PlayerNav(world), players = { byId: new Map(), nav }, seats = new CarSeats({ places: () => 0 });
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats }), agents, life: () => ({ byAgent: new Map([[1, i]]) }), world: () => null, setting: () => undefined, now: () => ms });
  comp.hookSim();
  // a boat lying off open ground near the agent (the harbour stood in for: its pose, its skipper)
  const e0 = evalPlan(sim.agents[i].plan, T);
  let spot = null; for (let r = 8; r < 90 && !spot; r += 2) for (let k = 0; k < 12; k++) { const x = e0.x + Math.sin(k) * r, z = e0.z + Math.cos(k) * r; if (nav.ok(x, z, -1) && !nav.wet(x, z)) { spot = { x, z }; break; } }
  assert.ok(spot, 'open ground near it');
  const b = { id: 'wm9:b2', type: 'skiff', module: 'none', home: { x: spot.x, y: 0, z: spot.z, yaw: 0, deck: { x: spot.x, y: 0, z: spot.z } }, mode: 'slip', skipper: null, skipperName: '', pose: { x: spot.x + 2, y: 0.2, z: spot.z, h: 0, p: 0, r: 0, v: 0 }, at: 1 };
  const H = { all: new Map([[b.id, b]]), bySkipper: new Map(), ver: 0, place: x => x.pose, besideSlip: x => x.home.deck };
  const play = new PlayCore({ dbs: { db: { prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }) }, worldId: 1 } });
  const crew = new FishingCrew({ play, harbour: () => H, players, sim: () => sim, agents, companions: () => comp, world: () => ({ worldModules: [], buildings: [] }), now: () => ms });
  comp.aboard = crew;
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); crew.tick(); } };
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null, boatId: null };
  players.byId.set(7, p);
  assert.equal(comp.command({ account: { id: 7, displayName: 'Kim', login: 'kim' } }, { agent: 1, action: 'follow', target: 'me' }).ok, true);
  const at = () => evalPlan(sim.agents[i].plan, T);
  for (let k = 0; k < 400 && Math.hypot(at().x - p.x, at().z - p.z) > 4; k++) run(1);
  assert.ok(Math.hypot(at().x - p.x, at().z - p.z) <= 4, 'it came over to its owner');
  // its owner takes the boat (stands at the helm): it gets on too — hidden at its fishing spot on the deck
  Object.assign(b, { skipper: 7, skipperName: 'Kim', mode: 'out' }); H.bySkipper.set(7, b); p.boatId = b.id; p.x = b.pose.x; p.z = b.pose.z - 1.6;
  run(3);
  const A = sim.agents[i];
  assert.equal(A.ride?.boat, b.id, 'aboard');
  const sp = crew.spotAt(b, crew.crew.get(1).spot), e1 = at();
  assert.ok(e1.s.flags & F_HIDDEN, 'hidden in the simulation (drawn on the boat by the pages)');
  assert.ok(Math.hypot(e1.x - sp.x, e1.z - sp.z) < 0.5, 'at its spot on the deck');
  assert.equal(BOATS.skiff.deck.spots[crew.crew.get(1).spot].name, 'bow', 'the skiff\'s free spot (its skipper at the stern\'s wheel)');
  assert.equal(comp.view(A).state, 'riding');
  assert.ok(crew.rows().some(r => r[0] === b.id && r[1] === i), 'its crew row for the pages');
  // its owner's plain words (the reflex, server/companions/intent.js → the registry's source): no trip yet — said so, kept
  comp.ctxOf = r => ({ rec: r, i, a: sim.agents[i], sim, leader: { account: 7, name: 'Kim' } });
  const said = comp.heard({ account: { id: 7, displayName: 'Kim', login: 'kim' } }, rec, 'Lara, let\'s fish');
  assert.equal(said?.action, 'fish'); assert.equal(said.ok, false); assert.match(said.text, /no fishing trip under way/);
  assert.equal(crew.crew.get(1).wants, true, 'it will fish once the trip begins');
  // the boat goes out 40 m: carried along
  b.pose.x += 40; p.x += 40; run(3);
  const e2 = at(), sp2 = crew.spotAt(b, crew.crew.get(1).spot);
  assert.ok(Math.hypot(e2.x - sp2.x, e2.z - sp2.z) < 1, `carried along (${Math.hypot(e2.x - sp2.x, e2.z - sp2.z).toFixed(2)} m from its spot)`);
  // where it says it is: aboard, on the deck — never "in the water" (2026-11-20: Lara aboard, "I'm in the water, Kim")
  const w = whereOf({ sim, harbour: H, players: { byId: new Map([[7, p]]) } }, i);
  assert.match(w.text, /^on Kim's boat \(the Lake Skiff 16\), (stopped out on the water|tied up at the dock) — on the deck, dry$/, w.text);
  assert.doesNotMatch(w.text, /swimming|wading/);
  assert.equal(w.short, 'aboard Kim\'s boat');
  assert.equal(A.ride?.boat, b.id, 'no car seat took it out (the seats are cars\')');
  // back, and its owner steps ashore: off beside them, following again
  b.pose.x -= 40; Object.assign(b, { skipper: null, skipperName: '', mode: 'slip' }); H.bySkipper.delete(7); p.boatId = null; p.x = spot.x; p.z = spot.z;
  run(3);
  assert.equal(A.ride, null, 'off the boat');
  assert.equal(crew.crew.size, 0);
  run(8);
  const e3 = at();
  assert.ok(!(e3.s?.flags & F_HIDDEN) && Math.hypot(e3.x - p.x, e3.z - p.z) < 6, 'beside its owner again, seen');
});

test('the reflex: plain words for fishing with them, and what is not a command', async () => {
  const { parseCommand } = await import('../../server/companions/intent.js');
  const p = t => parseCommand(t, { name: 'Lara' })?.action ?? null;
  for (const t of ['let\'s fish', 'Lara, fish with me', 'cast a line', 'grab a rod', 'go fishing with me', 'let\'s go fishing']) assert.equal(p(t), 'fish', t);
  for (const t of ['stop fishing', 'put the rod away', 'pack your rod away', 'that\'s enough fishing']) assert.equal(p(t), 'unfish', t);
  for (const t of ['get on the boat', 'come aboard', 'hop in the boat with me']) assert.equal(p(t), 'board', t);
  for (const t of ['I went fishing yesterday', 'fishing?', 'fish', 'reel it in', 'what did you catch?']) assert.equal(p(t), null, t);
  assert.equal(p('get in'), 'ride', 'the car\'s words unchanged');
});

test('under way it doesn\'t cast: the line reeled in, the rod held ready until the boat slows', () => {
  const R = rig();
  try {
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    R.run(30);
    const m = R.crew.crew.get(AGENT);
    assert.equal(m.fishing, true);
    const hooks = [];
    R.play.on(ev => { if (ev.account === -AGENT && ev.type === 'act' && ev.name === 'hook') hooks.push(R.T.ms); });
    R.b.pose.v = 9;   // (its owner drives off at 17 knots)
    R.run(15);
    const t0 = R.T.ms, n0 = hooks.length;
    R.run(120);
    assert.equal(hooks.length, n0, 'no bite taken while under way');
    assert.ok(['ready', 'reel', 'fight', 'net', 'show'].includes(m.phase), m.phase);
    R.b.pose.v = 0.3;   // (stopped again: it casts)
    R.run(150);
    assert.ok(hooks.length > n0 && hooks.every(h => h < t0 || h > t0 + 120000), 'fishing again once it slowed');
  } finally { R.E.close(); }
});

test('"let\'s go fishing" on the shore, its owner on no boat yet: a yes, kept — aboard later, it fishes once the trip is on', () => {
  const R = rig();
  try {
    R.H.bySkipper.delete(OWNER);   // (its owner on the beach: no boat out)
    const r = R.crew.command({ account: { id: OWNER } }, R.rec, 'fish', 'chat', () => R.ctx());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.text, /is up for fishing/);
    assert.match(r.brain, /not on a boat yet, so don't say you are/);
    // its owner takes the boat: it gets on — and wants to fish
    R.H.bySkipper.set(OWNER, R.b);
    R.a.plan = new Plan(R.T.ms / 1000, { x: R.b.pose.x - 3, y: 0, z: 0, ctx: -1 });
    const b = R.crew.run(R.ctx(), { kind: 'board' });
    assert.equal(b.ok, true, b.text);
    assert.equal(R.crew.crew.get(AGENT)?.wants, true, 'the yes is kept: it fishes once the trip is on');
  } finally { R.E.close(); }
});

test('after a restart, its owner back at the helm: back aboard at its own spot at once (not left in the sea), quietly; let go meanwhile: not', async () => {
  const { generateWorld } = await import('../../server/world/generate.js');
  const { generatePopulation } = await import('../../server/sim/population.js');
  const { WorldIndex } = await import('../../server/sim/windex.js');
  const { Sim } = await import('../../server/sim/sim.js');
  const { evalPlan } = await import('../../server/sim/plan.js');
  const { PlayerNav } = await import('../../shared/playernav.js');
  const { F_HIDDEN } = await import('../../shared/proto.js');
  const { Companions } = await import('../../server/companions/companions.js');
  const { CarSeats } = await import('../../server/world/car-seats.js');
  const world = generateWorld({ seed: 'fishing-crew-city', population: 200 });
  const people = generatePopulation(world, new WorldIndex(world), { population: 200, roster: [{ agentId: 'f-agent-1', name: 'Lara', emoji: '🎣', role: 'Angler' }] });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T; sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 }; sim.start();
  const i = people.findIndex(p => p && p.agentId === 'f-agent-1'), rec = { id: 1, key: 'f-agent-1', name: 'Lara', emoji: '🎣', enabled: true, ownerId: 7 };
  const agents = { get: id => (Number(id) === 1 ? rec : null), byKey: k => (k === rec.key ? rec : null), enabled: () => [rec], isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const nav = new PlayerNav(world), players = { byId: new Map(), nav }, seats = new CarSeats({ places: () => 0 });
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats }), agents, life: () => ({ byAgent: new Map([[1, i]]) }), world: () => null, setting: () => undefined, now: () => ms });
  comp.hookSim();
  // a boat lying off open ground near the agent (the harbour stood in for: its pose, its skipper)
  const e0 = evalPlan(sim.agents[i].plan, T);
  let spot = null; for (let r = 8; r < 90 && !spot; r += 2) for (let k = 0; k < 12; k++) { const x = e0.x + Math.sin(k) * r, z = e0.z + Math.cos(k) * r; if (nav.ok(x, z, -1) && !nav.wet(x, z)) { spot = { x, z }; break; } }
  assert.ok(spot, 'open ground near it');
  const b = { id: 'wm9:b2', type: 'skiff', module: 'none', home: { x: spot.x, y: 0, z: spot.z, yaw: 0, deck: { x: spot.x, y: 0, z: spot.z } }, mode: 'slip', skipper: null, skipperName: '', pose: { x: spot.x + 2, y: 0.2, z: spot.z, h: 0, p: 0, r: 0, v: 0 }, at: 1 };
  const H = { all: new Map([[b.id, b]]), bySkipper: new Map(), ver: 0, place: x => x.pose, besideSlip: x => x.home.deck };
  const play = new PlayCore({ dbs: { db: { prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }) }, worldId: 1 } });
  const crew = new FishingCrew({ play, harbour: () => H, players, sim: () => sim, agents, companions: () => comp, world: () => ({ worldModules: [], buildings: [] }), now: () => ms });
  comp.aboard = crew;
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); crew.tick(); } };
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null, boatId: null };
  players.byId.set(7, p);
  assert.equal(comp.command({ account: { id: 7, displayName: 'Kim', login: 'kim' } }, { agent: 1, action: 'follow', target: 'me' }).ok, true);
  const at = () => evalPlan(sim.agents[i].plan, T);
  for (let k = 0; k < 400 && Math.hypot(at().x - p.x, at().z - p.z) > 4; k++) run(1);
  assert.ok(Math.hypot(at().x - p.x, at().z - p.z) <= 4, 'it came over to its owner');
  // its owner out on the boat with it aboard, as when the server stopped
  Object.assign(b, { skipper: 7, skipperName: 'Kim', mode: 'out' }); H.bySkipper.set(7, b); p.boatId = b.id; p.x = b.pose.x; p.z = b.pose.z - 1.6;
  run(3);
  const A = sim.agents[i], had = crew.crew.get(1).spot;
  assert.equal(A.ride?.boat, b.id, 'aboard');
  assert.deepEqual(crew.crewOn(b.id), [{ agent: 1, spot: had, owner: 7 }], 'what is saved with the boat (whose companion it is: the skipper, or one of the crew of players)');
  // the server restarts: nothing aboard any more (the crew and the ride were in its memory), the body wherever it started
  // (its skipper not back yet: the harbour keeps the boat for them — no boat of theirs to get on meanwhile)
  crew.crew.clear(); A.ride = null; H.bySkipper.delete(7); sim.brain.reorder(A, true); run(1);
  assert.equal(A.ride, null, 'not aboard while its owner is away');
  H.bySkipper.set(7, b);
  assert.equal(crew.resumeCrew(b, [{ agent: 1, spot: had }]), 1, 'its owner back at the helm: it is handed back');
  run(2);
  const e = at(), sp = crew.spotAt(b, had);
  assert.equal(A.ride?.boat, b.id, 'aboard again');
  assert.equal(crew.crew.get(1).spot, had, 'at its own spot');
  assert.ok(Math.hypot(e.x - sp.x, e.z - sp.z) < 1, 'there, carried along');
  // a second hand-back changes nothing; one let go meanwhile is not put aboard
  assert.equal(crew.resumeCrew(b, [{ agent: 1, spot: had }]), 0);
  crew.crew.clear(); A.ride = null;
  comp.command({ account: { id: 7, displayName: 'Kim', login: 'kim' } }, { agent: 1, action: 'dismiss' });
  assert.equal(crew.resumeCrew(b, [{ agent: 1, spot: had }]), 0, 'not its owner\'s companion any more');
});


test('one session: everyone aboard counted from the trip\'s start (its Free Will on or not), the crew\'s tallies live, their results in the trip\'s; one player with companions only chooses whose catch it is', () => {
  const R = rig();
  try {
    R.crew.decides = () => true;   // (its Free Will decides how it fishes: it is in the session all the same)
    R.crew.agents.isOwner = (P, rec) => P?.account?.id === rec.ownerId;
    R.play.on(ev => R.crew.onPlay(ev));
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    R.run(2);
    assert.equal(R.play.runOf(-AGENT)?.along, own.run, 'in the trip from its start: its own run along on its owner\'s');
    R.run(10 * 60);
    assert.ok(R.crew.crew.get(AGENT).fishing, 'fishing');
    const told = R.frames.filter(f => f.t === 'fish_crew' && f.id === OWNER);
    assert.ok(told.length >= 2, 'the skipper\'s page told the crew\'s tallies as they changed');
    const last = told.at(-1);
    assert.equal(last.run, own.run); assert.equal(last.crew[0].name, 'Lara'); assert.equal(last.crew[0].agent, AGENT);
    assert.ok(last.crew[0].fish >= 1, `fish landed (${last.crew[0].fish})`);
    if (last.crew[0].kept) assert.ok(last.crew[0].value > 0 && last.crew[0].kg > 0, 'their weight and worth counted, as the player\'s own');
    // the trip finished: the crew's with it, now — their results in its result
    const res = R.play.finish(R.owner, own.run, {});
    assert.equal(R.play.runOf(-AGENT), null, 'its trip ended with its owner\'s at once');
    const S = res.session;
    assert.ok(S && S.crew.length === 1, 'the session\'s results');
    const c = S.crew[0];
    assert.equal(c.name, 'Lara'); assert.ok(c.xp >= 1 && Number.isInteger(c.stars) && c.score >= 0);
    const inv = R.econ.parts.inventory, theirs = () => inv.list(subj('agent', AGENT)).filter(s => /^(fish|find):/.test(s.item)), mine = () => inv.list(subj('account', OWNER)).filter(s => /^(fish|find):/.test(s.item));
    const n = theirs().length;
    assert.ok(n >= 1, `its catch stowed in its own inventory (${n})`);
    assert.equal(c.items, n);
    assert.deepEqual(S.choice, ['keep', 'take'], 'one player and their companions: the choice');
    assert.equal(R.crew.claim({ account: { id: 99 } }, own.run, true).ok, false, 'not their trip: refused');
    const before = mine().length, r = R.crew.claim({ account: { id: OWNER } }, own.run, true);
    assert.equal(r.ok, true, r.text);
    assert.equal(r.moved, n);
    assert.equal(theirs().length, 0, 'none left with the companion');
    assert.equal(mine().length - before, n, 'all of it the player\'s');
    assert.equal(R.crew.claim({ account: { id: OWNER } }, own.run, false).ok, false, 'once');
  } finally { R.E.close(); }
});

test('the session\'s other choice: the companions keep their catch', () => {
  const R = rig();
  try {
    R.crew.agents.isOwner = (P, rec) => P?.account?.id === rec.ownerId;
    R.play.on(ev => R.crew.onPlay(ev));
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    R.run(10 * 60);
    const res = R.play.finish(R.owner, own.run, {});
    const n = R.econ.parts.inventory.list(subj('agent', AGENT)).filter(s => /^(fish|find):/.test(s.item)).length;
    const r = R.crew.claim({ account: { id: OWNER } }, own.run, false);
    assert.equal(r.ok, true); assert.equal(r.decided, 'keep'); assert.equal(r.moved, 0);
    assert.equal(R.econ.parts.inventory.list(subj('agent', AGENT)).filter(s => /^(fish|find):/.test(s.item)).length, n, 'still its own');
    void res;
  } finally { R.E.close(); }
});

/** A stand-in decision service (Free Will's decideNow): the requests it was asked, answered by `answer` (after a tick). */
function deciding(R, answer) {
  const asked = [], remarks = [];
  R.crew.decides = () => true;
  R.crew.freeWillOf = () => ({ decideNow: (id, req, o) => { asked.push({ id, req, o, at: R.T.ms }); return new Promise(res => setImmediate(() => res(answer(req, asked.length)))); } });
  R.crew.companionsOf = () => ({ remark: (i, text) => remarks.push({ i, text }) });
  /** The crew run for `secs`, its decision service answering in between. */
  const run = async secs => { const end = R.T.ms + secs * 1000; while (R.T.ms < end) { R.T.ms += 500; R.crew.tick(); await new Promise(res => setImmediate(res)); } };
  return { asked, remarks, run };
}
const choose = (name, value, p = 0.9) => ({ type: 'choice', name, choice: value, confidence: p, probabilities: [{ value, probability: p }] });

test('its decision model fishes: the lure, the cast, the hand, what it keeps — asked at its first cast and again when it matters; its brain says a word about it', async () => {
  const R = rig();
  try {
    const plan = { lure: 'soft', cast: 'far', fight: 'hard', keep: 'better' };
    const D = deciding(R, () => ({ answers: [choose('lure', plan.lure), choose('cast', plan.cast), choose('fight', plan.fight), choose('keep', plan.keep), choose('speak', 'say')] }));
    const hooks = [], released = [];
    R.play.on(ev => { if (ev.account !== -AGENT || ev.type !== 'act') return; if (ev.name === 'hook') hooks.push(ev.body); if (ev.name === 'release') released.push(ev.body.n); });
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    await D.run(8);
    assert.equal(D.asked.length, 1, 'asked once, at its first cast');
    const q = D.asked[0].req;
    assert.deepEqual(q.questions.map(x => x.name), ['lure', 'cast', 'fight', 'keep', 'speak']);
    assert.deepEqual(q.questions[0].choices.map(c => c.value).sort(), ['shrimp', 'soft', 'spinner'], 'only the lures it has that suit the sea (the starter kit)');
    assert.match(q.input, /on Kim's boat/); assert.match(q.input, /Harbour Morning/); assert.match(q.input, /The trip has begun/);
    assert.equal(D.asked[0].o.type, 'fishing', 'its why-log: a fishing choice');
    await D.run(10 * 60);
    const m = R.crew.crew.get(AGENT), L = R.play.runOf(-AGENT);
    assert.equal(m.plan.by, 'model'); assert.equal(m.plan.lure, 'soft'); assert.equal(m.plan.reach, 'far');
    assert.ok(hooks.length >= 4, `it fished (${hooks.length} hooks)`);
    assert.ok(hooks.every(h => h.lure === 'soft'), 'every cast with the lure it chose');
    const reach = (await import('../../shared/fishing.js')).kitFor(L.state.kit, 'sea').reach;
    assert.ok(hooks.every(h => h.d0 >= Math.max(4, reach * 0.82) - 1e-6), 'cast far, as it chose');
    const smalls = L.state.caught.filter(c => c.species && c.size === 'small');
    assert.ok(smalls.every(c => !c.kept && c.released), 'the small ones let go, as it chose');
    assert.equal(released.length >= smalls.length, true);
    assert.ok(D.asked.length >= 2 && D.asked.length <= 14, `thought over again now and then, not every cast (${D.asked.length} times)`);
    assert.ok(D.asked.slice(1).every((x, k) => x.at - D.asked[k].at >= 20e3), 'never twice within moments');
    assert.ok(R.notes.some(n => n.id === AGENT && n.text === 'Fishing: Soft Plastic, a far cast, playing them hard, letting the small ones go'), 'its diary: how it fishes (what it says when asked)');
    const told = D.remarks.filter(r => r.i === BODY && /^Fishing from/.test(r.text));
    assert.equal(told.length, 1, 'a word about it in its own voice when it chose it — not again for the same plan');
    assert.match(told[0].text, /^Fishing from Kim's boat: I fish with Soft Plastic, a far cast, playing them hard, letting the small ones go\.$/);
    // the fight as it chose to play it: the pages' rows carry it
    const fought = hooks.length && R.crew.detail({ ...m, fishing: true, phase: 'fight', vis: { d0: 10, kind: 1, fish: { id: 'x', kg: 1, seed: 1, secs: 5, out: 1, skill: 0.7, cm: 30, push: 1 } } });
    assert.equal(fought.at(-1), 1, 'its hand (hard) in the fight row');
  } finally { R.E.close(); }
});

test('no answer from its decision model (a limit, a timeout), or no Free Will: its habit — it fishes on, and says nothing about a plan', async () => {
  const R = rig();
  try {
    const D = deciding(R, () => null);
    const hooks = [];
    R.play.on(ev => { if (ev.account === -AGENT && ev.type === 'act' && ev.name === 'hook') hooks.push(ev.body); });
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    await D.run(5 * 60);
    assert.ok(D.asked.length >= 1, 'asked');
    assert.equal(R.crew.crew.get(AGENT).plan.by, 'habit');
    assert.ok(hooks.length >= 3, `it fished all the same (${hooks.length} hooks)`);
    assert.equal(D.remarks.filter(r => /^Fishing from/.test(r.text)).length, 0, 'no words about a plan it didn\'t make');
    // Free Will off for it: never asked
    R.crew.decides = () => false;
    const n = D.asked.length;
    await D.run(6 * 60);
    assert.equal(D.asked.length, n, 'not asked');
    assert.ok(hooks.length >= 6);
  } finally { R.E.close(); }
});

test('fishing together: a crew member joins the skipper\'s trip (asked to), one session — everyone\'s tallies to every player, the skipper\'s end ends everyone\'s, everyone\'s results to each; no taking the companions\' catch with other players', () => {
  const R = rig(), GUEST = 2;
  try {
    R.E.account(GUEST);
    R.players.byId.set(GUEST, { id: GUEST, name: 'Ann', x: 30, y: 0.4, z: 0, ctx: -1, boatId: R.b.id });
    // the harbour: Kim at the helm, Ann aboard as crew
    Object.assign(R.H, { byGuest: new Map([[GUEST, R.b]]), boatOf: id => (id === OWNER || id === GUEST ? R.b : null), playersOn: () => [OWNER, GUEST] });
    R.crew.agents.isOwner = (P, rec) => P?.account?.id === rec.ownerId;
    R.play.on(ev => R.crew.onPlay(ev));
    const ended = [];
    R.crew.afterFinish = (account, res) => { ended.push({ account, row: res.row }); return { catch: { stowed: 0 } }; };
    const own = R.play.start(R.owner, 'fishing', 'harbour-morning', 'wm1');
    onGround(R, own.data.plan);
    R.crew.board(R.a, R.rec, R.b, 'Kim');
    R.run(1);
    const asked = R.frames.filter(f => f.t === 'fish_join' && f.id === GUEST);
    assert.equal(asked.length, 1, 'Ann\'s page asked to join the trip');
    assert.equal(asked[0].run, own.run); assert.equal(asked[0].skipper, 'Kim');
    assert.equal(R.crew.joinTrip({ account: { id: 9 } }, own.run).ok, false, 'not aboard: refused');
    const j = R.crew.joinTrip({ account: { id: GUEST } }, own.run);
    assert.equal(j.ok, true, j.text);
    const mine = R.play.runOf(GUEST), top = R.play.runs.get(own.run);
    assert.equal(mine.along, own.run); assert.equal(mine.at, top.at, 'the skipper\'s clock');
    assert.deepEqual(mine.data.plan.grounds.map(g => [g.id, g.x, g.z]), top.data.plan.grounds.map(g => [g.id, g.x, g.z]), 'the same grounds');
    assert.equal(R.crew.joinTrip({ account: { id: GUEST } }, own.run).why, 'already');
    assert.equal(R.crew.joinTrip({ account: { id: GUEST } }, mine.id).ok, false, 'only the skipper\'s trip is joined');
    R.run(6 * 60);
    assert.equal(R.frames.filter(f => f.t === 'fish_join' && f.id === GUEST).length, 1, 'asked once');
    const toAnn = R.frames.filter(f => f.t === 'fish_crew' && f.id === GUEST).at(-1), toEli = R.frames.filter(f => f.t === 'fish_crew' && f.id === OWNER).at(-1);
    assert.ok(toAnn && toEli, 'everyone\'s tallies to both players');
    assert.deepEqual(toAnn.players.map(p => p.name), ['Kim', 'Ann']); assert.equal(toAnn.crew[0].name, 'Lara'); assert.equal(toAnn.run, own.run);
    // Kim ends the trip: everyone's ends with it
    const res = R.play.finish(R.owner, own.run, {});
    assert.equal(R.play.runOf(GUEST), null, 'Ann\'s trip ended with the skipper\'s');
    assert.equal(R.play.runOf(-AGENT), null, 'and Lara\'s');
    assert.deepEqual(ended.map(x => x.account), [GUEST], 'Ann\'s weighed in and stowed by the server');
    const told = R.frames.find(f => f.t === 'fish_end' && f.id === GUEST);
    assert.ok(told?.result?.ok, 'Ann\'s page told, with her result');
    assert.equal(told.by, 'Kim');
    assert.deepEqual(told.result.session.people.map(p => p.name), ['Kim'], 'her results show Kim\'s');
    assert.deepEqual(told.result.session.crew.map(c => c.name), ['Lara'], '…and Lara\'s');
    assert.equal(told.result.session.choice, null);
    const S = res.session;
    assert.equal(S.players, 2); assert.deepEqual(S.people.map(p => p.name), ['Ann']); assert.equal(S.crew[0].mine, true);
    assert.equal(S.choice, null, 'players with players: no taking the companions\' catch');
    assert.equal(R.crew.claim({ account: { id: OWNER } }, own.run, true).why, 'not_solo');
  } finally { R.E.close(); }
});

test('bait of its own: at a dock store it buys bait with its own money (its owner\'s rules), says what it holds, fishes with it — asked away from a store, it buys at the next', () => {
  const R = rig();
  try {
    const E = R.econ, wallet = () => E.walletView(E.walletFor(subj('agent', AGENT))).balance;
    E.ledger.transfer(E.faucet('grants').id, E.walletFor(subj('agent', AGENT)).id, 5000, { kind: 'grant', actor: 'system:test', memo: 'pocket money' });
    const store = { idx: 7, name: 'Harbour Dock Store', tackle: true, x: 30, z: 0, w: 10, d: 10 };
    // no bait of its own: the dock lends the starter's, and it says so
    assert.match(R.angler.kitWords(-AGENT), /none of my own — the dock lends the starter's for each trip \(10 Nightcrawlers|none of my own — the dock lends the starter's/);
    // at the store: what it may buy, honestly
    R.crew.storeNear = () => ({ b: store, d: 0 });
    const ctx = R.ctx(), aff = R.crew.near(ctx).filter(x => x.kind === 'buy');
    assert.ok(aff.length >= 2 && aff.some(x => x.key === 'buy:shrimp'), JSON.stringify(aff.map(x => x.key)));
    assert.match(aff.find(x => x.key === 'buy:shrimp').label, /^Buy 10 Live Shrimp at Harbour Dock Store for 5 VC \(I have none of my own\)$/);
    const before = wallet(), r = R.crew.run(ctx, aff.find(x => x.key === 'buy:shrimp'));
    assert.equal(r.ok, true, r.text);
    assert.equal(before - wallet(), 500, 'paid from its own wallet');
    assert.equal(R.angler.holds(-AGENT).lures.shrimp, 10, 'in its own inventory');
    assert.ok(R.notes.some(n => n.id === AGENT && /^Bought 10 × Live Shrimp at Harbour Dock Store for 5\.00 VC — your own bait now/.test(n.text)), 'its diary says so');
    assert.deepEqual(R.angler.tripKit(-AGENT).lures, { shrimp: 10 }, 'it fishes with its own now — no starter lent');
    assert.match(R.angler.kitWords(-AGENT), /my own — 10 Live Shrimp/);
    assert.match(R.crew.near(ctx).find(x => x.key === 'buy:shrimp').label, /\(I have 10\)$/);
    // its owner's line: above it, the owner agrees first — not bought, said plainly
    // (its owner, as the economy knows agents: the registry's own in a city)
    E.d.agents = { ...(E.d.agents || {}), byId: id => (Number(id) === AGENT ? R.rec : null) };
    const ownerOf = E.agentOwner.bind(E); E.agentOwner = id => (Number(id) === AGENT ? OWNER : ownerOf(id));
    E.parts.agents.setLimits({ id: OWNER, admin: true }, AGENT, { approveAbove: 100 });
    const no = R.crew.run(ctx, { kind: 'buy', key: 'buy:shrimp' });
    assert.equal(no.ok, false); assert.match(no.text, /owner must agree/);
    E.parts.agents.setLimits({ id: OWNER, admin: true }, AGENT, { approveAbove: 100000 });
    // asked away from a store: "buy some bait" — kept; at the next store, bought
    R.crew.storeNear = () => null;
    const P = { account: { id: OWNER, displayName: 'Kim' } };
    const c = R.crew.command(P, R.rec, 'buybait', 'chat', () => R.ctx());
    assert.equal(c.ok, true); assert.match(c.text, /will buy bait at the next dock store/);
    R.crew.companionsOf = () => ({ bodyOf: () => ({ i: BODY }) });
    R.crew.baitErrands(R.T.ms);
    assert.equal(R.angler.holds(-AGENT).lures.shrimp, 10, 'not at a store: nothing yet');
    R.crew.storeNear = () => ({ b: store, d: 0 });
    R.crew.baitErrands(R.T.ms);
    assert.ok(R.angler.holds(-AGENT).lures.shrimp > 10, `bought at the store it came to (${JSON.stringify(R.notes.slice(-2).map(n => n.text))})`);
    assert.equal(R.crew.wantBait.size, 0);
  } finally { R.E.close(); }
});
