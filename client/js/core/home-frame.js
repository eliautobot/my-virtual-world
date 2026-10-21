// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Next's side of the home view (PLAN WP1.9, DECISIONS C44, C117): the reused classic module fixes the frame as position,
// distance and angle, and this envelope adds the one thing Next's camera has that the module does not - the tilt - so
// "Set home to current view" and "Go to home view" restore the exact view. The envelope is what the account preference
// holds (a small JSON string, like the docks): { frame, pitch }.
import { HOME_DEFAULTS, isHomeConfigured, normalizeHome } from '../vendor-classic/g8-extras/home-location.mjs';

export const FRAME_VERSION = 1;
const round = v => Math.round(v * 1e4) / 1e4;

/** The camera's current view as an envelope: the module's frame, plus the tilt and the true distance it does not carry
 *  (the module holds a frame's distance between 4.5 and 120 m; a view over the whole city is farther - `dist`). */
export function frameFromCamera(cam) {
  return {
    v: FRAME_VERSION,
    frame: normalizeHome({ x: cam.goal.x, y: cam.goal.y, z: cam.goal.z, distance: cam.goalDist, angle: cam.goalYaw }),
    pitch: round(cam.goalPitch),
    dist: round(cam.goalDist),
  };
}

/** Sends the camera to an envelope's view (the module's frame, with the tilt and the true distance when saved); jump: at
 *  once instead of flying there (where the camera starts). */
export function applyFrame(cam, env, { jump = false } = {}) {
  const f = env && env.frame;
  if (!f) return null;
  cam.flyTo(f.x, f.y ?? 0, f.z, Number.isFinite(env.dist) ? env.dist : f.distance, f.angle, Number.isFinite(env.pitch) ? env.pitch : null);
  if (jump) { cam.target.copy(cam.goal); cam.dist = cam.goalDist; cam.yaw = cam.goalYaw; cam.pitch = cam.goalPitch; cam.apply(); }
  return f;
}

/** The installation's default home (the world.home setting, sent with the world) as an envelope, or null when none is set. */
export function worldEnvelope(home) {
  if (!home || typeof home !== 'object' || Array.isArray(home) || !isHomeConfigured(home)) return null;
  const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? round(Number(v)) : undefined);
  return { v: FRAME_VERSION, frame: normalizeHome(home), pitch: num(home.pitch), dist: num(home.dist) };
}
/** What the world default stores: the module's frame with the tilt and the true distance beside it. */
export const worldValue = env => ({ ...normalizeHome(env.frame), pitch: env.pitch, dist: env.dist });

/** A view over the whole city from a little way off: where an account with no home view of its own starts, and where ⌂
 *  takes it (2026-10-09: "start it further away showing more of the city", not at the headquarters). */
export function overviewEnvelope(grid, cam) {
  if (!grid) return null;
  const x = (grid.minX + grid.maxX) / 2, z = (grid.minZ + grid.maxZ) / 2, ext = Math.max(grid.maxX - grid.minX, grid.maxZ - grid.minZ);
  const dist = Math.max(250, Math.min(cam?.maxDist ?? 950, ext * 0.8));
  return { v: FRAME_VERSION, frame: normalizeHome({ x, y: 0, z, distance: dist, angle: 0.7 }), pitch: 0.8, dist: round(dist) };
}
/** The view in force: this account's own home view, else the installation's default, else the overview. */
export const homeEnvelope = ({ own, world, grid, cam }) => own || worldEnvelope(world) || overviewEnvelope(grid, cam);

/** An envelope as the preference's string. */
export function writeEnvelope(env) { return JSON.stringify(env); }

/** The preference's string as an envelope, or null when it holds no usable home. */
export function readEnvelope(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let j = null;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !isHomeConfigured(j.frame)) return null;
  return { v: FRAME_VERSION, frame: normalizeHome(j.frame), pitch: Number.isFinite(Number(j.pitch)) ? round(Number(j.pitch)) : undefined,
    dist: Number.isFinite(Number(j.dist)) && Number(j.dist) > 0 ? round(Number(j.dist)) : undefined };
}

/** The home a camera frame's numbers would make, for tests and for the world default. */
export const frameOf = home => normalizeHome(home || HOME_DEFAULTS);
