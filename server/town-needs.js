// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What each town needs (2026-10-23, the product owner: "cities/towns have needs like (enough workplaces, enough homes,
// enough public services like parks, transit...etc)" — "like the latest sim city" — shown to everyone "under the
// economy because the economy should be overall the world economy, but then have layers, like town/cities ... from macro
// to micro"). Measured only (the first version): for the world and for each town (shared/towns.js), from where its
// people live and work, its homes and workplaces, its venues, parks and stations, and how its businesses did yesterday:
// a score of 0–100 for each need (null where it doesn't apply), what it needs most, and its issues in plain words.
//
//   homes       free beds for the people who need one (the homeless who work there, a little room to move in)
//   jobs        open workplaces for its residents out of work (and how many must commute out)
//   shops       cafés, restaurants and shops for the number living there
//   fun         homes within a short walk of a park or a gym
//   transit     homes within a walk of a subway station (where the world has any)
//   prosperity  its businesses that made a profit and paid every wage yesterday
//   overall     the mean of those that apply
import { MAIN_TOWN } from '../shared/towns.js';

const VENUES = new Set(['cafe', 'restaurant', 'shop', 'gym']);
const NEAR_FUN = 400, NEAR_STATION = 600;   // m
const SHOPS_PER_100 = 2.5;                  // venues to eat and shop at per 100 residents for a full score
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const seeking = j => j && j.kind === 'free' && (j.lost || j.seek || j.title === 'Between jobs');
const blank = () => ({ residents: 0, homeless: 0, beds: 0, occupied: 0, jobs: 0, filled: 0, unemployed: 0, employed: 0, commutersIn: 0, out: new Map(),
  venues: 0, fun: 0, nearFun: 0, nearStation: 0, businesses: 0, bizOk: 0, bizOwed: 0 });

/**
 * { world, index (server/sim/windex.js), people, townOf: b → town id, names: town id → name, books: [{ b, profit, owed }]
 * (yesterday's, or null with the economy off) } → { world: needs, towns: [{ id, name, ...needs }] }.
 */
export function townNeeds({ world, index, people, townOf, names, books = null }) {
  const S = new Map(), at = t => { let s = S.get(t); if (!s) S.set(t, s = blank()); return s; }, W = at('*');
  const both = (t, fn) => { fn(W); fn(at(t)); };
  const tOf = b => (Number.isInteger(b) && b >= 0 ? townOf(b) || MAIN_TOWN : MAIN_TOWN);
  // homes, workplaces, venues, parks
  const homes = [], funAt = [], stations = (world.stations || []).filter(s => Number.isFinite(s.x));
  for (const B of world.buildings || []) {
    if (!B || B.gone) continue;
    const t = tOf(B.idx), company = B.type === 'office' || B.type === 'hq';
    if (B.type === 'park') { both(t, s => s.fun++); funAt.push(B); }
    for (let f = 0; f < (B.floors || 0); f++) {
      const lv = B.lv?.[f], L = world.levels[lv]; if (!L) continue;
      if (L.venue && VENUES.has(L.venue)) { if (L.venue === 'gym') { both(t, s => s.fun++); funAt.push(B); } else both(t, s => s.venues++); }
      let beds = 0, jobs = 0;
      for (const [, e] of index.slots(lv)) for (const sl of e.slots) {
        if (sl.use === 'sleep' && B.type === 'apartment' && f > 0) beds++;
        else if ((sl.use === 'work' && company && f > 0) || (sl.use === 'staff' && (VENUES.has(L.venue) || company))) jobs++;
      }
      if (beds) both(t, s => { s.beds += beds; });
      if (jobs) both(t, s => { s.jobs += jobs; });
    }
    if (B.type === 'apartment') homes.push(B);
  }
  // each home: a park or a gym near it, a station near it
  const near = new Map();
  for (const B of homes) {
    near.set(B.idx, { fun: funAt.some(F => Math.hypot(F.x - B.x, F.z - B.z) <= NEAR_FUN), station: stations.some(st => Math.hypot(st.x - B.x, st.z - B.z) <= NEAR_STATION) });
  }
  // where people live and work
  for (const p of people) {
    if (!p || p.retired) continue;
    const j = p.job || {}, jt = j.b !== undefined && j.b >= 0 ? tOf(j.b) : null;
    if (j.b !== undefined && j.id !== undefined) both(jt, s => s.filled++);
    if (p.post) both(tOf(p.post.b), s => s.filled++);
    if (!p.home) { both(jt ?? MAIN_TOWN, s => s.homeless++); continue; }
    const ht = tOf(p.home.b), nb = near.get(p.home.b);
    both(ht, s => {
      s.residents++; s.occupied++;
      if (seeking(j)) s.unemployed++; else if (j.kind && j.kind !== 'free') s.employed++;
      if (nb?.fun) s.nearFun++;
      if (nb?.station) s.nearStation++;
    });
    if (jt !== null && jt !== ht) { const o = at(ht).out; o.set(jt, (o.get(jt) || 0) + 1); at(jt).commutersIn++; }
  }
  // its businesses yesterday
  for (const r of books || []) {
    if (!Number.isInteger(r.b) || r.b < 0) continue;
    both(tOf(r.b), s => { s.businesses++; if ((r.profit ?? 0) >= 0 && !(r.owed > 0)) s.bizOk++; if (r.owed > 0) s.bizOwed++; });
  }
  const anyStations = stations.length > 0;
  const name = id => names.get(id) || id;
  const out = (id, s) => {
    const freeBeds = Math.max(0, s.beds - s.occupied), freeJobs = Math.max(0, s.jobs - s.filled);
    const outN = [...s.out.values()].reduce((a, b) => a + b, 0), top = [...s.out].sort((a, b) => b[1] - a[1])[0] || null;
    const scores = {
      homes: s.residents + s.homeless === 0 && s.beds === 0 ? null : (() => { const want = s.homeless + Math.max(2, Math.ceil(s.residents * 0.03)); let v = clamp(100 * freeBeds / want); if (s.homeless) v = Math.min(v, clamp(100 - s.homeless * 8)); return v; })(),
      jobs: s.residents === 0 && s.jobs === 0 ? null : (() => { let v = s.unemployed ? clamp(100 * freeJobs / s.unemployed) : 100; if (s.employed && outN / s.employed > 0.4) v = Math.min(v, 70); return v; })(),
      shops: s.residents ? clamp(100 * (s.venues * 100 / s.residents) / SHOPS_PER_100) : null,
      fun: s.residents ? clamp(100 * s.nearFun / s.residents) : null,
      transit: anyStations && s.residents ? clamp(100 * s.nearStation / s.residents) : null,
      prosperity: s.businesses ? clamp(100 * s.bizOk / s.businesses) : null,
    };
    const vals = Object.values(scores).filter(v => v !== null);
    scores.overall = vals.length ? clamp(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    // its issues, the worst first
    const issues = [];
    const add = (sev, icon, text) => issues.push({ sev, icon, text });
    if (s.homeless) add(90, '🏠', `${plural(s.homeless, 'person has', 'people have')} no home${id === '*' ? '' : ' here'}`);
    else if (s.residents && !freeBeds && s.beds) add(55, '🏠', 'No free homes: nobody new can move in');
    if (s.unemployed > freeJobs) add(80, '💼', `${plural(s.unemployed, 'resident is', 'residents are')} out of work and ${freeJobs ? `only ${plural(freeJobs, 'job is', 'jobs are')}` : 'no jobs are'} open${id === '*' ? '' : ' here'}`);
    if (id !== '*' && top && top[1] >= 5 && s.employed && outN / s.employed >= 0.25) add(60, '🚇', `${plural(outN, 'resident commutes', 'residents commute')} out for work, ${top[1]} to ${name(top[0])}`);
    if (id !== '*' && s.commutersIn >= 10 && freeBeds < s.commutersIn / 4) add(45, '🏗️', `${s.commutersIn} people come here to work but live elsewhere: more homes would let them move in`);
    if (s.residents >= 20 && scores.shops !== null && scores.shops < 40) add(50, '🏪', 'Few cafés, restaurants and shops for the people living here');
    if (s.residents >= 10 && scores.fun !== null && scores.fun < 60) add(40 + (60 - scores.fun) / 3, '🌳', `${100 - scores.fun}% of homes have no park or gym within a short walk`);
    if (s.residents >= 10 && scores.transit !== null && scores.transit < 50) add(35 + (50 - scores.transit) / 3, '🚇', `${100 - scores.transit}% of homes are far from a station`);
    if (s.bizOwed) add(70, '💰', `${plural(s.bizOwed, 'business', 'businesses')} couldn't pay all ${s.bizOwed === 1 ? 'its' : 'their'} wages yesterday`);
    issues.sort((a, b) => b.sev - a.sev);
    const need = scores => Object.fromEntries(['homes', 'jobs', 'shops', 'fun'].map(k => [k, scores[k] === null ? 0 : 100 - scores[k]]));
    return {
      residents: s.residents, homeless: s.homeless, beds: s.beds, freeBeds, jobs: s.jobs, freeJobs, unemployed: s.unemployed, employed: s.employed,
      commutersIn: s.commutersIn, commutersOut: outN, topOut: top ? { town: top[0], name: name(top[0]), n: top[1] } : null,
      venues: s.venues, funPlaces: s.fun, businesses: s.businesses, scores, demand: need(scores), issues: issues.slice(0, 6).map(({ icon, text }) => ({ icon, text })),
    };
  };
  const towns = [...names.keys()].map(id => ({ id, name: name(id), ...out(id, at(id)) }));
  return { world: out('*', W), towns };
}

/**
 * GET /api/towns/needs for everyone (the economy window's town layer, client/js/ui/econ-city.js), read at most every 20
 * seconds. d: { world: () => world, index: () => index, people: () => people, towns: server/towns.js, books: () =>
 * yesterday's [{ b, profit, owed }] or null, moves: () => town → { in, out } today (server/sim/migration.js) }.
 * → the getter (people moving between towns read it too).
 */
export function addTownNeedsRoutes(router, d) {
  let cache = null;
  const get = () => {
    if (!cache || Date.now() - cache.at > 20000) {
      const bt = d.towns.buildingTowns(), r = townNeeds({ world: d.world(), index: d.index(), people: d.people(), townOf: b => bt.get(b), names: new Map(d.towns.list().map(t => [t.id, t.name])), books: d.books() });
      const mv = d.moves?.() || new Map();
      for (const t of r.towns) t.moved = mv.get(t.id) || { in: 0, out: 0 };
      cache = { at: Date.now(), json: { at: Date.now(), ...r } };
    }
    return cache.json;
  };
  router.add({ method: 'GET', path: '/api/towns/needs', cap: 'world.view', handler: () => ({ status: 200, json: get() }) });
  return get;
}
