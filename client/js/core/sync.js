// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// World sync: applies server patches (levels, buildings, people), presence + speech events, and reloads when the
// world changed while this client was disconnected.
import { S, bus, setFocus, selectBuilding } from './state.js';
import { overlayAt } from './agents.js';

let app;
/** A removed agent's body is retired, never deleted (indices are shared); the page stops drawing it (WP2.1). */
function retiredBody(i, person) {
  if (!person || !person.x || !app.net) return;
  app.net.plans[i] = null;
  app.net.ensure(i + 1);
  app.net.planVer[i]++;
}
export function init(a) {
  app = a;
  S.says = new Map();
  bus.on('msg:patch', m => applyPatches(m.patches || [], m.version));
  bus.on('msg:person', m => { if (m.person) { S.people[m.i] = m.person; overlayAt(m.i); app.agents.setAppearance(m.i, m.person.a); retiredBody(m.i, m.person); bus.emit('people'); } });
  bus.on('msg:presence', m => { if (m.id) { S.presence[m.id] = m.info; bus.emit('presence'); } });
  bus.on('msg:say', m => { S.says.set(m.i, { text: m.text, until: m.until }); bus.emit('say', m); });
  bus.on('hello', m => {
    if (S.version && m.version && m.version !== S.version) {
      app.toast?.('The city changed while you were away — reloading…');
      setTimeout(() => location.reload(), 1500);
    }
  });
}

export function applyPatches(patches, version) {
  const W = S.world, lv = new Set(), bl = new Set();
  let people = false, roads = null, terrain = null, decor = false, stations = false, ferries = false, wmods = false;
  for (const p of patches) {
    if (p.k === 'level' && p.level) { W.levels[p.lv] = p.level; lv.add(p.lv); }
    else if (p.k === 'bld' && p.building) { p.building.idx = p.b; W.buildings[p.b] = p.building; bl.add(p.b); }
    else if (p.k === 'person' && p.person) { S.people[p.i] = p.person; overlayAt(p.i); app.agents.setAppearance(p.i, p.person.a); retiredBody(p.i, p.person); people = true; }
    else if (p.k === 'people-add') { for (const q of p.list || []) { S.people[q.i] = q; overlayAt(q.i); app.agents.setAppearance(q.i, q.a); } people = true; }
    else if (p.k === 'note' && p.text) app.toast?.(p.text);
    else if (p.k === 'roads' && Array.isArray(p.roads)) roads = p.roads;
    else if (p.k === 'terrain' && p.terrain) terrain = p.terrain;
    else if (p.k === 'decor' && Array.isArray(p.decorations)) { W.decorations = p.decorations; decor = true; }
    else if (p.k === 'stations' && Array.isArray(p.stations)) { W.stations = p.stations; stations = true; }
    else if (p.k === 'ferries' && Array.isArray(p.ferries)) { W.ferries = p.ferries; ferries = true; }
    else if (p.k === 'wmods' && Array.isArray(p.wmods)) { W.worldModules = p.wmods; wmods = true; }
    else if (p.k === 'flats' && p.flats) { W.flats = p.flats; bus.emit('flats', p.flats); }
    else if (p.k === 'doors' && p.doors) { W.doors = p.doors; bus.emit('doors', p.doors); }
  }
  // The land beyond the city reshaped (WP4.7): the terrain rebuilds the ground around each stroke.
  if (terrain) {
    if (app.terrain) app.terrain.setGround(roads || W.roads, terrain);
    W.terrain = terrain;
    bus.emit('terrain', terrain);
  }
  // Roads beyond the city (WP4.4): the terrain regrades and redraws them (it compares old and new, so it goes first),
  // the city's apron opens where they leave it, and everything listening to 'roads' follows.
  if (roads) {
    if (app.terrain && !terrain) app.terrain.setGround(roads); else if (!app.terrain) W.roads = roads;
    W.roads = roads;
    app.city?.rebuildApron?.();
    bus.emit('roads', roads);
  }
  if (decor) bus.emit('decor');
  if (ferries) bus.emit('ferries');   // a ferry line opened, changed or closed (WP4.15)
  if (wmods) {   // a world module (an airport) placed, moved or removed: the ground under it levels, render/airport.js redraws
    if (app.terrain && !terrain && !roads && !stations) app.terrain.setGround(W.roads);
    bus.emit('wmods');
  }
  if (stations) {   // a station beyond the city opened or closed (WP4.5): kiosks, and the ground under them
    app.city.buildStations();
    if (app.terrain && !terrain && !roads) app.terrain.setGround(W.roads);
    bus.emit('stations');
  }
  if (version) S.version = version;
  let parks = false;
  for (const b of bl) {
    const B = W.buildings[b];
    app.blds.rebuildFor(b);
    if (B.type === 'park') parks = true;
    if (B.gone && S.selB === b) selectBuilding(-1);
  }
  if (bl.size) { app.city.buildPaths(); app.agents.refreshWorld(W); }
  // a building beyond the city changed: the ground under its pad follows (WP4.6)
  if (bl.size && !roads && app.terrain && [...bl].some(b => W.buildings[b]?.base !== undefined)) app.terrain.setGround(W.roads);
  if (parks) app.inter.rebuildParks();
  for (const l of lv) app.inter.onLevel(l);
  const fb = S.focus.b;
  if (fb >= 0 && bl.has(fb)) {
    const B = W.buildings[fb];
    if (!B || B.gone) setFocus(-1);
    else if (S.focus.f >= B.floors) setFocus(fb, B.floors - 1);
    else app.applyFocus();
  }
  if (people) bus.emit('people');
  bus.emit('world', { levels: lv, blds: bl });
}
