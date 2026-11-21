// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A picture of the city its owner shares ("📷 Share my view", docs/features/awareness.md §2): the page says where its
// camera was and whose characters were on screen; the server checks that against the world (each one exists, was near
// that camera) and tells the agent what the picture shows — so a screenshot of it riding in its owner's car is never
// "someone else wearing my name".
import { evalPlan } from '../sim/plan.js';
import { clean, q, ctxB } from './where.js';

export const VIEW_MAX_AGE_MS = 15 * 60e3;   // a picture taken this long ago or less is described
export const VIEW_RANGE_M = 120;            // who was on screen: this close to the camera (they may have moved since)
export const VIEW_NAMES = 8;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * Checks a page's `view` ({ cam: { x, y, z, ctx, yaw }, visible: [{ kind: 'resident', i } | { kind: 'player', id }],
 * at }) — null when it isn't one.
 */
export function cleanView(v, now = Date.now()) {
  if (!v || typeof v !== 'object' || !v.cam || typeof v.cam !== 'object') return null;
  const cam = { x: num(v.cam.x), y: num(v.cam.y), z: num(v.cam.z), ctx: Number.isInteger(v.cam.ctx) ? v.cam.ctx : -1, yaw: num(v.cam.yaw) };
  if (!Number.isFinite(cam.x) || !Number.isFinite(cam.z) || Math.abs(cam.x) > 1e6 || Math.abs(cam.z) > 1e6) return null;
  const at = Number.isFinite(num(v.at)) ? Math.min(now, num(v.at)) : now;
  if (now - at > VIEW_MAX_AGE_MS) return null;
  const seen = new Set(), visible = [];
  for (const x of Array.isArray(v.visible) ? v.visible.slice(0, 40) : []) {
    if (x && x.kind === 'resident' && Number.isInteger(x.i) && x.i >= 0 && !seen.has(`r${x.i}`)) { seen.add(`r${x.i}`); visible.push({ kind: 'resident', i: x.i }); }
    else if (x && x.kind === 'player' && Number.isInteger(x.id) && x.id > 0 && !seen.has(`p${x.id}`)) { seen.add(`p${x.id}`); visible.push({ kind: 'player', id: x.id }); }
  }
  return { cam, visible, at };
}

/**
 * What the picture shows, for agent body `me` (−1: none): "This picture is Kim's own view of the city, taken just now
 * at «5th Ave & Elm St» (2:14 PM). In it: Lara (you), Juno, Theo (a player)." — or null.
 * env: { sim, players }; writer: the name of the one who shared it.
 */
export function viewCaption(env, view, { me = -1, writer = 'your owner', clock = '', ago = 'just now' } = {}) {
  const sim = env.sim;
  if (!sim || !view) return null;
  const { cam } = view, t = sim.now(), names = [];
  for (const x of view.visible) {
    if (names.length >= VIEW_NAMES) break;
    if (x.kind === 'resident') {
      const a = sim.agents[x.i], p = sim.people[x.i];
      if (!a?.plan || !p || p.retired) continue;
      const e = evalPlan(a.plan, t);
      if (Math.hypot(e.x - cam.x, e.z - cam.z) > VIEW_RANGE_M) continue;   // (not where that camera was: left out)
      names.push(x.i === me ? `${clean(p.name, 40)} (that's you)` : clean(p.name, 40));
    } else {
      const p = env.players?.byId?.get(x.id);
      if (!p || Math.hypot(p.x - cam.x, p.z - cam.z) > VIEW_RANGE_M) continue;
      names.push(`${clean(p.name, 40)}${p.name === writer ? '' : ' (a player)'}`);
    }
  }
  let where = '';
  try {
    if (cam.ctx >= 0) where = `in ${q(sim.brain.placeName(ctxB(cam.ctx), cam.ctx & 63), 60)}`;
    else { const a = sim.nav?.addressAt?.(cam.x, cam.z); if (a) where = `at ${q(a, 60)}`; }
  } catch { /* where it was is left out */ }
  return `This picture is ${writer}'s own view of the city, taken ${ago}${where ? ` ${where}` : ''}${clock ? ` (${clock})` : ''}: it shows the city as it really is.${names.length ? ` In it: ${names.join(', ')}.` : ''}`;
}
