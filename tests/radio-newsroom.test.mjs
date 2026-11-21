// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio's newsroom (server/radio/newsroom.js, 2026-11-16) with stand-ins for the city: what stands when it first looks
// is not news; a building put up is (what it is, what is inside, where — never who owns it; players' first), its
// billboards, signs and website go with it (a later one: its own story; paid ads never), its website read once and said
// in a sentence; a story is offered until a line names it, then reminded at most twice, hours apart, and gone after a few
// days; the sponsor goes round; the city's numbers only when there is something new; City Pulse's top-10 moves that hold
// half an hour, with what brought them, the week's winners, the top 10 as background; kept across a restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Newsroom, names, siteWords, REMIND_GAP, STORY_DAYS, PULSE_HOLD_MS, SITE_WAIT_MS } from '../server/radio/newsroom.js';

const H = 3600e3;
function city(o = {}) {
  let T = 1e12;
  const W = { name: 'Next City', levels: [{ venue: 'cafe', name: 'Bean There', items: [] }, { name: 'Lobby', items: [] }], buildings: [
    { id: 'b0', idx: 0, seed: 1, type: 'cafe', name: 'Bean There', floors: 1, lv: [0], lot: 'L0', x: 0, z: 0 },
    { id: 'b1', idx: 1, seed: 2, type: 'office', name: 'Willow Exchange', floors: 1, lv: [1], lot: 'L1', x: 10, z: 0 },
  ] };
  const holders = { L0: { kind: 'municipality', id: 'city' }, L1: { kind: 'municipality', id: 'city' }, L9: { kind: 'account', id: '7' } };
  const biz = [{ id: 'z1', name: 'Bean There', kind: 'cafe', b: 0, f: 0, owner_kind: 'municipality', created: T - 30 * 86400e3 }, { id: 'z2', name: 'Iron Works', kind: 'gym', b: 5, f: 0, owner_kind: 'municipality', created: T - 30 * 86400e3 }];
  const econ = { econDay: () => o.day?.() ?? 5, parts: { businesses: { open: () => biz, get: id => biz.find(b => b.id === id), at: (b, f) => biz.find(x => x.b === b && x.f === f), menu: b => (b?.id === 'z9' ? [{ name: 'Pipe repair' }] : b?.kind === 'cafe' ? [{ name: 'Flat white' }] : []), table: () => [{ b: 'z2', sales: 900 }] },
    stats: { dayValues: d => (d % 2 ? { sales: 1200, customers: 300, cpi: 101 } : { sales: 1000, customers: 260, cpi: 100 }) } } };
  const fetched = [];
  const dir = o.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-newsroom-'));
  const make = () => new Newsroom({ dir, now: () => T, world: () => W, property: { get: id => ({ id, region: id === 'L9' ? 'Harbour Town' : null, holder: holders[id] || null }) }, econ: () => econ,
    weather: () => ({ now: () => ({ kind: o.weather?.() || 'clear', wind: { speed: 2 }, rain: 0 }) }), pulse: () => o.pulse || null,
    where: B => `${B.x === 0 ? '1st Ave' : '2nd Ave'} & Elm St`,
    fetchSite: async url => { fetched.push(url); if (/broken/.test(url)) throw Object.assign(new Error('nope'), { code: 'not_found' }); return { title: 'Fine Line Services', description: 'Licensed plumbing in Washington DC. 24/7 emergency service.', text: 'Home About Services Contact' }; },
    summarize: o.summarize === undefined ? async s => `Licensed plumbing across Washington DC, with emergency repairs any time (${s.title}).` : o.summarize });
  return { W, biz, holders, fetched, dir, make, tick: ms => { T += ms; }, get T() { return T; } };
}
const st = { id: 'velvet', name: 'Velvet' };
const say = (N, text, by = 'Rosa') => N.told(st, [{ host: { name: by }, text }], N.last);
const brief = N => { const b = N.briefing(st); N.last = b.offered; return b.lines.join('\n'); };
const build = (c, b) => { c.W.levels.push(...(b.levels || [])); c.W.buildings.push({ id: `b${c.W.buildings.length}`, idx: c.W.buildings.length, seed: 99, floors: (b.levels || []).length, lv: (b.levels || []).map((_, k) => c.W.levels.length - (b.levels.length - k)), x: 5, z: 5, ...b, levels: undefined }); return c.W.buildings.at(-1); };

test('what stands when it first looks is not news; a building put up is — what it is, inside, where; never who owns it', async () => {
  const c = city(), N = c.make();
  await N.scan({ force: true });
  assert.doesNotMatch(brief(N), /NEWS/, 'the city as it was: no news');
  const B = build(c, { type: 'office', name: 'PQ Tower', lot: 'L9', levels: [{ name: 'Lobby', items: [] }, { venue: 'cafe', name: 'Pipe Dream Café', items: [], mods: [{ kind: 'studio', name: 'PQ Radio' }] }] });
  c.tick(61e3); c.biz.push({ id: 'z9', name: 'Pipe Dream Café', kind: 'cafe', b: B.idx, f: 1, owner_kind: 'account', created: c.T });
  await N.scan();
  const L = brief(N);
  assert.match(L, /NEWS \(not on this station yet\): Just built: PQ Tower, a new office building at 2nd Ave & Elm St \(one of the city's players built it\)\. Inside: "Pipe Dream Café", a café on the 2nd floor \(it sells Pipe repair\); a radio studio \("PQ Radio"\) on the 2nd floor\./);
  assert.doesNotMatch(L, /account|owner|holder/i, 'never who owns it');
  assert.match(L, /Sponsor of this break \(read it as a short ad\): Pipe Dream Café/, 'a player\'s new business first in the sponsor\'s turn');
  // not named on the air: offered again; named: told, and not news any more
  say(N, 'Sales are up and it is raining.');
  assert.match(brief(N), /NEWS \(not on this station yet\): Just built: PQ Tower/);
  say(N, 'Big news: PQ Tower just opened on 2nd Ave, with a café upstairs!', 'Sara');
  const after = brief(N);
  assert.doesNotMatch(after, /NEWS.*PQ Tower/); assert.match(after, /Already told on this station \(don't repeat these\): .*PQ Tower \(just now, by Sara\)/);
  // a reminder or two, hours apart; then no more; gone after a few days
  c.tick(REMIND_GAP + 1000); await N.scan({ force: true });
  assert.match(brief(N), /Worth a reminder \(told here 6 h ago; only if it fits, briefly\): Just built: PQ Tower/);
  say(N, 'Still loving the PQ Tower café.');
  assert.doesNotMatch(brief(N), /Worth a reminder/);
  c.tick(REMIND_GAP + 1000); await N.scan({ force: true }); brief(N); say(N, 'PQ Tower, again!');
  c.tick(REMIND_GAP + 1000); await N.scan({ force: true });
  assert.doesNotMatch(brief(N), /Just built: PQ Tower/, 'told three times: no more');
  c.tick(STORY_DAYS * 86400e3); await N.scan({ force: true });
  assert.equal(N.s.stories.length, 0, 'gone after a few days');
  // another station hears it too (each station's own listeners)
});

test('its billboard and signs: with it before it is on the air, a story of their own after; its website read once; never paid ads', async () => {
  const c = city(), N = c.make();
  await N.scan({ force: true });
  const B = build(c, { type: 'shop', name: 'PQ Services', lot: 'L9', levels: [{ venue: 'shop', name: 'PQ Services', items: [{ t: 'sign_stand', sg: { mode: 'ads', cr: { title: 'Someone else\'s ad', website: 'https://ads.example' } } }] }] });
  c.tick(61e3); await N.scan();
  assert.doesNotMatch(brief(N), /Someone else|ads\.example/, 'a paid ad on its sign is not the building\'s');
  // a few minutes later, before it is on the air: its billboard joins its story
  B.roofSigns = [{ edge: 'front', cr: { title: 'PQ Services', message: 'Plumbing done right', website: 'https://pqservices.example/' } }];
  c.tick(61e3); await N.scan(); await N.readSites();
  const L = brief(N);
  assert.match(L, /Just built: PQ Services, a new shop .*On show: a billboard on its roof reads "PQ Services", "Plumbing done right", with its website pqservices\.example \(its site says: Licensed plumbing across Washington DC, with emergency repairs any time \(Fine Line Services\)\.\)/);
  assert.equal(N.s.stories.filter(s => s.key?.startsWith('b2:')).length, 1, 'one story');
  say(N, 'PQ Services is open, plumbing done right!');
  // days later: a sign inside with another website — a story of its own; the first site isn't read again
  B.levels = undefined; c.W.levels[B.lv[0]].items.push({ t: 'sign_stand_wide', sg: { mode: 'private', cr: { title: 'Book a plumber', website: 'https://pqservices.example/book' } } });
  c.tick(61e3); await N.scan({ force: true }); await N.readSites();
  const L2 = brief(N);
  assert.match(L2, /NEWS \(not on this station yet\): PQ Services, a shop at 2nd Ave & Elm St, has something new to show: a sign inside reads "Book a plumber", with its website pqservices\.example/);
  assert.deepEqual(c.fetched, ['https://pqservices.example/', 'https://pqservices.example/book'], 'each website read once');
  // a building the city had all along puts up its first website: news too
  c.W.buildings[1].roofSigns = [{ cr: { title: 'Willow Exchange', website: 'https://broken.example' } }];
  c.tick(61e3); await N.scan({ force: true }); await N.readSites();
  const willow = brief(N);
  assert.match(willow, /Willow Exchange, an office building at 2nd Ave & Elm St, has something new to show: a billboard on its roof reads "Willow Exchange", with its website broken\.example\./, 'a site that can\'t be read: told without it');
  delete c.W.buildings[1].roofSigns;   // (taken down again before it was told: nothing to tell)
  assert.doesNotMatch(brief(N), /Willow Exchange/);
});

test('a website that answers slowly: the story goes out without it after a while', async () => {
  const c = city({ summarize: null }), N = c.make();
  await N.scan({ force: true });
  build(c, { type: 'cafe', name: 'Slow Joe', lot: 'L9', roofSigns: [{ cr: { title: 'Slow Joe', website: 'https://slow.example' } }], levels: [{ venue: 'cafe', name: 'Slow Joe', items: [] }] });
  N.reading = true;   // (still reading)
  c.tick(61e3); await N.scan();
  assert.doesNotMatch(brief(N), /Slow Joe, a new/);
  c.tick(SITE_WAIT_MS + 1000);
  assert.match(brief(N), /Just built: Slow Joe, a new café.*with its website slow\.example\./);
  N.reading = false; await N.readSites();
  assert.match(brief(N), /its site says: Licensed plumbing in Washington DC\. 24\/7 emergency service\./, 'no brain: the page\'s own description');
});

test('the sponsor goes round; the city\'s numbers only when there is something new to say', async () => {
  let day = 5, weather = 'clear';
  const c = city({ day: () => day, weather: () => weather }), N = c.make();
  await N.scan({ force: true });
  const sponsor = () => brief(N).match(/Sponsor of this break \(read it as a short ad\): ([^,]+)/)[1];
  const a = sponsor(); say(N, 'Nice weather.');
  const b = sponsor(); assert.notEqual(a, b, 'the next one in turn'); say(N, 'hm');
  assert.equal(sponsor(), a, 'then round again');
  // sales: offered until said; then not again for hours, even on a new day
  assert.match(brief(N), /Sales across the city fell/); say(N, 'Sales are down, folks!');
  assert.doesNotMatch(brief(N), /Sales across the city/); assert.match(brief(N), /Already told .*the city's sales \(just now, by Rosa\)/);
  day = 6; c.tick(H); assert.doesNotMatch(brief(N), /Sales across the city/, 'a new day, but said an hour ago');
  c.tick(4 * H); assert.match(brief(N), /Sales across the city rose/, 'hours later, the new numbers');
  // the weather: said, then only when it changes (and not within the next couple of hours)
  say(N, 'Clear skies out there.'); assert.doesNotMatch(brief(N), /The weather now/);
  weather = 'rain'; c.tick(3 * H); assert.match(brief(N), /The weather now: rain/);
});

test('City Pulse: a top-10 move that holds half an hour is news, with what brought it; the week\'s winners; the top 10 as background', async () => {
  let top = [['L1', 'Nova Point'], ['L2', 'Harbour Café'], ['L3', 'Sky Gym'], ['L4', 'Taco Loco'], ['L5', 'Book Nook'], ['L6', 'Lume'], ['L7', 'Ritz'], ['L8', 'Dock 9'], ['L9', 'PQ Services Lot'], ['L10', 'Tenth']].map(([lot, name]) => ({ lot, name }));
  let awards = [{ week: '2026-11-09', place: 1, name: 'Nova Point' }];
  const pulse = { config: () => ({ on: true, weights: { visits: 10, clicks: 25, agents: 4 } }), placeOf: () => null,
    board: () => ({ top: top.map((r, i) => ({ ...r, rank: i + 1, delta: 5, counts: { visits: 3, clicks: r.name === 'PQ Services Lot' ? 4 : 0, agents: 1 }, owner: { name: 'Kim' }, tagline: r.name === 'PQ Services Lot' ? 'Plumbing done right' : '' })), awards }) };
  const c = city({ pulse }), N = c.make();
  await N.scan({ force: true });
  let L = brief(N);
  assert.doesNotMatch(L, /NEWS/, 'the board as it was: no news');
  assert.match(L, /Background — City Pulse's top 10 now \(players' places by the attention they get\): 1\. Nova Point, 2\. Harbour Café, .*10\. Tenth\./);
  // PQ climbs from 9 to 4; a swap that goes back within the half hour is nothing
  const move = (lot, to) => { const r = top.find(x => x.lot === lot); top = top.filter(x => x !== r); top.splice(to - 1, 0, r); };
  move('L9', 4); move('L2', 1);
  c.tick(61e3); await N.scan({ force: true });
  assert.doesNotMatch(brief(N), /NEWS/, 'not yet: it has to hold');
  move('L2', 2);   // (Harbour Café back to 2: its move never held)
  c.tick(PULSE_HOLD_MS); await N.scan({ force: true });
  L = brief(N);
  assert.match(L, /NEWS \(not on this station yet\): PQ Services Lot climbed from number 9 to number 4 on City Pulse\. What brought it: visits to its website and people walking in\. It describes itself as "Plumbing done right"\./);
  assert.doesNotMatch(L, /Harbour Café (climbed|is the new)/); assert.doesNotMatch(L, /Kim/, 'never its owner');
  say(N, 'PQ Services Lot is now number four on City Pulse, good for them!');
  assert.doesNotMatch(brief(N), /NEWS/, 'told once');
  // a newcomer pushes the 10th out (not news), a new number one is; the week's winners
  top.splice(9, 1, { lot: 'L11', name: 'Fresh Bakes' }); move('L4', 1);
  awards = [{ week: '2026-11-16', place: 1, name: 'Taco Loco' }, { week: '2026-11-16', place: 2, name: 'Nova Point' }];
  c.tick(61e3); await N.scan({ force: true }); c.tick(PULSE_HOLD_MS); await N.scan({ force: true });
  L = brief(N);
  assert.match(L, /Taco Loco is the new number one on City Pulse/); assert.match(L, /Fresh Bakes just made City Pulse's top 10, at number 10/);
  assert.match(L, /City Pulse: the week's winners are Taco Loco, Nova Point \(first place Taco Loco\)\./);
  assert.doesNotMatch(L, /Tenth dropped out/, 'the 10th making way is no news');
});

test('kept across a restart; names() and siteWords()', async () => {
  const c = city(), N = c.make();
  await N.scan({ force: true });
  build(c, { type: 'gym', name: 'Iron Paradise', lot: 'L9', levels: [{ venue: 'gym', name: 'Iron Paradise', items: [] }] });
  c.tick(61e3); await N.scan();
  const N2 = c.make(); await N2.scan({ force: true });
  assert.match(brief(N2), /Just built: Iron Paradise, a new gym/, 'still news, and the city still known');
  assert.equal(names('Have you seen the new Iron Paradise gym?', 'Iron Paradise'), true);
  assert.equal(names('Try Café Nord today', 'Café Nord'), true);
  assert.equal(names('Iron prices are up', 'Iron Paradise'), false);
  const w = siteWords('<html><head><title>PQ &amp; Sons</title><meta name="description" content="Plumbing in DC"></head><body><main><h1>Welcome</h1><p>We fix pipes.</p></main></body></html>', 'https://pq.example/');
  assert.equal(w.title, 'PQ & Sons'); assert.equal(w.description, 'Plumbing in DC'); assert.match(w.text, /We fix pipes/);
});

test('on the air (server/radio/radio.js): the hosts are briefed by the newsroom, and what a break names is told', async () => {
  const { Radio } = await import('../server/radio/radio.js');
  const { stationById, stationTracks, onAir } = await import('../shared/radio.js');
  const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: 'MVW Originals', genre: i % 2 ? 'jazz' : 'house', seconds: 120 + i * 7 }));
  const list = stationTracks(tracks, stationById('velvet'));
  let T = 1e6; for (; ; T += 5) { const a = onAir(list, 'velvet', T + 60); if (a.kind === 'ident' && a.at < 5) break; }
  const W = { name: 'Next City', levels: [{ name: 'Lobby', items: [] }], buildings: [{ id: 'b0', idx: 0, seed: 1, type: 'office', name: 'Willow Exchange', floors: 1, lv: [0], x: 0, z: 0 }] };
  const asked = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-radio-desk-'));
  const R = new Radio({
    dataDir: dir, dbs: { db: { prepare: () => ({ all: () => [] }) }, worldId: 'w' }, log: null, now: () => T * 1000, world: () => W,
    music: { list: () => ({ tracks }) },
    agents: { get: id => (id === 7 ? { id: 7, name: 'Rosa Vega', enabled: true, ownerId: 1 } : null), list: () => [{ id: 7, name: 'Rosa Vega', enabled: true, ownerId: 1 }], resolver: { resolveBody: () => -1 } },
    connections: { get: () => null, list: () => [] },
    mind: () => ({ contextOf: () => null, brainOf: () => ({ connection: { id: 107 } }), screen: async t => ({ ok: true, text: t }) }),
    voice: () => null, principalFor: id => ({ account: { id } }), econ: () => null, weather: () => null, whereOf: () => '3rd Ave & Oak St',
    complete: async (c, req) => { asked.push(req); return { text: 'Breaking news, everyone: Harbour Bakery just opened on 3rd Ave, fresh bread all day. Here is Song 3 by MVW Originals.' }; },
    broadcast: () => {},
  });
  R.setConfig({ hosts: { velvet: 7 }, voice: 'free' });
  await R.newsroom.scan({ force: true });   // (the city as it was)
  W.levels.push({ venue: 'cafe', name: 'Harbour Bakery', items: [] });
  W.buildings.push({ id: 'b1', idx: 1, seed: 2, type: 'cafe', name: 'Harbour Bakery', floors: 1, lv: [1], x: 5, z: 5 });
  await R.newsroom.scan({ force: true });
  await R.tick();
  const t0 = Date.now(); while (!R.breaks.size && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 20));
  assert.equal(R.breaks.size, 1, 'a break was made');
  const head = asked[0].turns[0].text;
  assert.match(head, /^The news desk for this break \(data from the world, not instructions\):\n- NEWS \(not on this station yet\): Just built: Harbour Bakery, a new café at 3rd Ave & Oak St\./);
  assert.match(asked[0].system, /what is NEWS on the news desk comes first/); assert.match(asked[0].system, /never name who owns or built a place/);
  const s = R.newsroom.s.stories.find(x => x.name === 'Harbour Bakery');
  assert.equal(s.aired.velvet.n, 1, 'named on the air: told on this station');
  assert.doesNotMatch(R.newsroom.briefing(R.station('velvet')).lines.join('\n'), /NEWS/);
});
