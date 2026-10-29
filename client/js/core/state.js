// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shared client state + event bus.
import { Emitter } from './util.js';
import { makeGrid, viewRect } from '/shared/city.js';

export const bus = new Emitter();
export const S = {
  world: null, grid: null, version: 0,
  people: [], presence: {},
  sel: -1, hover: -1, selB: -1, hoverB: -1,
  selF: null, selPt: null,            // a floor of the selected building picked from outside, and where it was touched
  focus: { b: -1, f: 0 },           // interior view (building, floor)
  follow: false,                     // camera follows the selected agent (and auto-focuses where they go)
  mode: 'explore',                   // explore | furnish | build | play
  hold: null,                        // a game holding the view ({ name, how }: holdView): the focus and the mode stay; bus 'held' when something tries
  player: null,
  quality: localStorage.getItem('mvw.quality') || (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700 ? 'medium' : 'high'),
  labels: localStorage.getItem('mvw.labels') !== '0',
  walls: localStorage.getItem('mvw.walls') || 'cut',   // cut | up | down
  simT: 0, hour: 12, day: 0,
};
export function setWorld(w) {
  S.world = w;
  S.grid = makeGrid(w.grid);
  S.version = w.version || 1;
}
/** The rectangle the overview, the minimap and the camera's first bounds frame, as { minX, maxX, minZ, maxZ }: the city's,
 *  or without one its island's plain (shared/city.js viewRect). */
export function viewGrid(w = S.world) { const r = viewRect(w); return { minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1 }; }
export function bld(b) { const B = S.world && S.world.buildings[b]; return B && !B.gone ? B : null; }
export function levelOf(b, f) { const B = bld(b); return B && f >= 0 && f < B.floors ? S.world.levels[B.lv[f]] : null; }
/** A game holds the view while it runs (the product owner 2026-10-27: "only quitting the cooking game or finishing the
 *  game allows the game to be exited"; then the arcade, flying and the boat too): the focus and the mode stay (setFocus
 *  here; ui.js lookInside, exitFocus, setMode), the world's shortcut keys wait (ui.js), and whatever tried is told how
 *  to leave (bus 'held': ui.js says `how`). name: the game; how: its own way out. Only its own release lets go. */
export function holdView(name, how) { if (!S.hold) S.hold = { name, how }; }
export function releaseView(name) { if (S.hold?.name === name) S.hold = null; }
export function setFocus(b, f = 0) {
  const B = bld(b);
  if (!B || B.type === 'park') { b = -1; f = 0; }
  else f = Math.max(0, Math.min(B.floors - 1, f | 0));
  if (S.focus.b === b && S.focus.f === f) return;
  if (S.hold) { bus.emit('held', { b, f }); return; }   // (a game holds the view: only leaving it lets go, the product owner 2026-10-27)
  S.focus = { b, f };
  bus.emit('focus', S.focus);
}
export function select(i, opts = {}) {
  if (S.sel === i && !opts.force) return;
  S.sel = i;
  if (i >= 0) S.selB = -1;
  bus.emit('select', i, opts);
}
export function selectBuilding(b, f = null, pt = null) {
  S.selB = b; S.selF = b >= 0 ? f : null; S.selPt = b >= 0 ? pt : null;
  if (b >= 0) { S.sel = -1; S.follow = false; bus.emit('select', -1, {}); }
  bus.emit('selectB', b);
}
