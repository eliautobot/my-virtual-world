// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Nights out (shared/nightlife.js, 2026-10-23, the product owner: "make these themed floors actually be usable by agents
// and residents, meaning some work there, some go there spending money ... the lounge needs bartenders, several,
// musicians ... the night club needs bartenders, several, nightclub dancers as well as a DJ ... they have free will to go
// dance at a night club, sit at a lounge and socialize or play on the arcade"): a generated city with an arcade, a lounge
// and a club on office floors hires their people (bartenders, a DJ, dancers, musicians, an attendant) from residents
// without work, and run for a day they work there in their roles while the city comes: tokens and games at the arcade,
// cocktails at the lounge, the bar, the dance floor and VIP booths at the club, at their hours. The economy opens each
// as a business with its menu and charges a visit (the cover and a drink, a cocktail, tokens).
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWorld, freshLevel, themeVenues } from '../server/world/generate.js';
import { generatePopulation, reassign } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { Brain } from '../server/sim/agents.js';
import { RNG } from '../shared/rng.js';
import { NIGHTLIFE_OPEN } from '../shared/nightlife.js';
import { economyModel } from './helpers/econ-model.mjs';
import { buildOptions } from '../server/free-will/options.js';

function nightCity(seed, population) {
  const world = generateWorld({ seed, population });
  const offices = world.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3 && b.w >= 18).slice(0, 3);
  const themed = [];
  for (const [k, theme] of ['arcade', 'lounge', 'club'].entries()) {
    const B = offices[k], L = freshLevel(B, 1, 1, theme);
    world.levels.push(L); B.lv[1] = world.levels.length - 1;
    themed.push({ b: B.idx, f: 1, theme, venue: L.venue });
  }
  const index = new WorldIndex(world);
  const people = generatePopulation(world, index, { population, roster: [] });
  reassign(world, index, people, new RNG(`${seed}:boot`));
  return { world, index, people, themed };
}

test('themed floors are places of their own, staffed, and the city spends its evenings there', { timeout: 240000 }, () => {
  const { world, index, people, themed } = nightCity('night-city', 900);
  assert.deepEqual(themed.map(t => t.venue), ['arcade', 'lounge_bar', 'club']);
  for (const k of ['arcade', 'lounge_bar', 'club']) assert.equal(index.venues[k].length, 1, `${k}: a public place`);
  // an old themed floor (a staff lounge before) becomes its theme's place at boot
  const L0 = world.levels[world.buildings[themed[2].b].lv[1]]; L0.venue = 'lounge';
  assert.equal(themeVenues(world), 1); assert.equal(L0.venue, 'club');
  // their people, hired from residents without work: several bartenders, the DJ, dancers, the band, an attendant
  const staff = people.filter(p => p.job?.kind === 'staff' && themed.some(t => t.b === p.job.b && t.f === p.job.f));
  const titles = staff.map(p => p.job.title.split(' at ')[0]);
  const count = t => titles.filter(x => x === t).length;
  assert.ok(count('Bartender') >= 4 && count('DJ') === 1 && count('Dancer') >= 3 && count('Musician') === 3 && count('Attendant') >= 1, `staff: ${titles.join(', ')}`);
  for (const p of staff) assert.ok(p.job.start >= 10 && p.job.end <= 24, `${p.job.title}: a shift in the day (${p.job.start}-${p.job.end})`);
  // the DJ and the band play every night (with days off, some nights had no music); bartenders and dancers have days off
  for (const p of staff) if (/^(DJ|Musician) /.test(p.job.title)) assert.equal(p.job.days, 0b1111111, `${p.job.title}: every night`);
  assert.ok(staff.some(p => /^Bartender /.test(p.job.title) && p.job.days !== 0b1111111), 'bartenders have days off');

  const sim = new Sim(world, people, { budgetMs: 1e9 });
  const acts = [], act = Brain.prototype.act;
  Brain.prototype.act = function (a, kind, use, P, info) {
    const r = act.call(this, a, kind, use, P, info), t = themed.find(x => x.b === info.b && x.f === info.f);
    if (t) acts.push({ theme: t.theme, kind, use, h: this.hour(info.holdStart ?? P.t), order: info.order, who: a.i, key: `${info.id}:${info.k}`, t0: info.holdStart ?? P.t, t1: info.holdEnd ?? P.t });
    return r;
  };
  try {
    let T = 0;
    sim.now = () => T;
    sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 };
    sim.start();
    while (T < 26 * 3600 / 16) { T += 0.5; sim.tick(); sim.flush(); }
  } finally { Brain.prototype.act = act; }
  const n = (theme, kind, use) => acts.filter(e => e.theme === theme && e.kind === kind && (!use || e.use === use)).length;
  // at work, in their roles
  assert.ok(n('lounge', 'work', 'perform') > 0 && n('lounge', 'work', 'bartend') > 0, 'the band plays and the bartenders mix');
  assert.ok(n('club', 'work', 'dj') > 0 && n('club', 'work', 'gogo') > 0 && n('club', 'work', 'bartend') > 0, 'the DJ spins, the dancers dance, the bar serves');
  // the city comes, at the hours they're open
  assert.ok(n('arcade', 'arcade', 'play') > 50 && n('arcade', 'arcade', 'buy') > 20, `the arcade: ${n('arcade', 'arcade', 'play')} games, ${n('arcade', 'arcade', 'buy')} token buys`);
  assert.ok(n('lounge', 'lounge_bar', 'bar') > 50, `the lounge: ${n('lounge', 'lounge_bar', 'bar')} drinks`);
  assert.ok(n('club', 'club', 'dance') > 30 && n('club', 'club', 'bar') > 10, `the club: ${n('club', 'club', 'dance')} dances, ${n('club', 'club', 'bar')} at the bar`);
  assert.ok(acts.some(e => e.theme === 'club' && e.use === 'vip'), 'a VIP booth taken');
  // one person to a seat (2026-10-24, the product owner: "a lot of agents are sitting on the same seat": a club's bar
  // stool had a dozen at once — a plan of several stops held only its last): no two visitors in one place at once
  const stays = acts.filter(e => e.kind !== 'work' && e.t1 > e.t0), shared = [];
  for (const e of stays) for (const q of stays) if (q !== e && q.who !== e.who && q.theme === e.theme && q.key === e.key && q.t0 < e.t1 - 1e-6 && q.t1 > e.t0 + 1e-6) shared.push(`${e.theme} ${e.use} ${e.key}`);
  assert.deepEqual(shared, [], 'nobody in a seat or at a machine someone else is in');
  for (const e of acts.filter(x => x.kind !== 'work')) {
    const [o] = NIGHTLIFE_OPEN[{ arcade: 'arcade', lounge: 'lounge_bar', club: 'club' }[e.theme]];
    assert.ok(e.h >= o - 0.5 || e.h < 3, `${e.theme} visited at ${e.h.toFixed(2)}: after it opens`);
  }
  assert.ok(acts.filter(e => e.theme === 'lounge' && e.order?.length).every(e => ['martini', 'old_fashioned', 'gin_tonic', 'aperol', 'red_wine', 'white_wine', 'champagne', 'whiskey'].includes(e.order[0])), 'cocktails and wine at the lounge');
  // Free Will offers them: an evening's choices name the club and the lounge
  const brain = sim.brain, a = sim.agents.find(x => x && x.p && !x.p.retired && x.p.home);
  const opts = buildOptions(brain, a, { x: world.buildings[themed[2].b].x, z: world.buildings[themed[2].b].z, ctx: -1, h: 21, day: 5, needs: { ...a.needs, fun: 0.2, social: 0.2 }, atHome: false }, null);
  assert.ok(opts.some(o => o.kind === 'club' && /Go dancing/.test(o.label)) && opts.some(o => o.kind === 'lounge_bar'), `Free Will's evening: ${opts.map(o => o.label).join(' | ')}`);
});

test('the economy: each is a business with its menu; a night out is charged; its people are paid by their role', { timeout: 120000 }, () => {
  const { world, people, themed } = nightCity('night-econ', 500);
  const m = economyModel({ city: { world, people } });
  try {
    const e = m.econ, bz = e.parts.businesses, H = e.parts.households;
    bz.sync();
    const biz = themed.map(t => bz.at(t.b, t.f));
    assert.deepEqual(biz.map(b => b?.kind), ['arcade', 'lounge_bar', 'club']);
    assert.ok(bz.menu(biz[2]).some(i => i.id === 'cover') && bz.menu(biz[2]).some(i => i.id === 'bottle_service'), 'the club: a cover and bottle service');
    const p = people.find(x => x && !x.retired && x.home), a = { i: people.indexOf(p), p };
    const visit = (t, act) => { H.lastBuy.delete(p.id); H.onAct(a, { b: t.b, f: t.f, holdStart: 0.3, holdEnd: 0.31, ...act }); };
    visit(themed[2], { kind: 'club', use: 'dance' });
    visit(themed[1], { kind: 'lounge_bar', use: 'bar', order: ['martini'] });
    visit(themed[0], { kind: 'arcade', use: 'buy' });
    const rc = H.receipts.get(p.id);
    assert.deepEqual(rc.map(r => [r.kind, r.items]), [['club', ['cover', 'beer']], ['lounge_bar', ['martini']], ['arcade', ['game_tokens']]]);
    assert.equal(rc[0].total, bz.priceOf(biz[2], 'cover') + bz.priceOf(biz[2], 'beer'));
    const pol = e.policy();
    assert.ok(pol.wages.dj > pol.wages.bartender && pol.wages.musician > pol.wages.attendant, 'a DJ and a musician earn more');
  } finally { m.close(); }
});
