// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// This browser simulates its own car while driving (decision A20); the server validates and relays. The official Rapier
// build loads only on the first drive. Automatic uses this browser on every device (measured affordable on phone-class
// CPUs, and instant controls matter most on mobile networks); server physics stays selectable.
import { buildingPads } from '/shared/island-build.js';
import { LocalVehicleSim } from '/shared/vehicle-local.js';

let engine = null;
export function loadDriveEngine() {
  engine ??= (async () => {
    const R = (await import('@dimforge/rapier3d-compat')).default;
    await R.init();
    const { VehicleDynamics } = await import('/shared/driving-classic/vehicle-dynamics.mjs');
    return { R, VehicleDynamics };
  })();
  engine.catch(() => { engine = null; });
  return engine;
}
// One local physics world per loaded city, built ahead of the first drive and reused for every drive.
let shared = null;
export async function getLocalSim(world) {
  const { R, VehicleDynamics } = await loadDriveEngine();
  // On an island (WP4.3) the sim gets the terrain (with its roads) for the ground beyond the city.
  const pads = buildingPads(world), padsKey = JSON.stringify(pads);
  if (shared?.world !== world || shared.terrain !== world.terrain || shared.roads !== world.roads || shared.padsKey !== padsKey) {
    shared?.sim.dispose();
    const island = world.terrain ? new (await import('/shared/terrain.js')).Island(world.terrain, { roads: world.roads || null, pads }) : null;
    shared = { world, terrain: world.terrain, roads: world.roads, padsKey, sim: new LocalVehicleSim({ RAPIER: R, VehicleDynamics, world, island }) };
  }
  return shared.sim;
}
/** Load the engine and build the collision world in idle time, so getting in a car is instant. */
export function preloadDriving(world) {
  if (!world || drivePhysicsMode() !== 'browser' || shared?.world === world) return;
  const go = () => getLocalSim(world).catch(err => console.warn('[driving] preload failed; it will retry when you drive', err));
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}
export function worldChanged(world) { if (shared && shared.world === world) shared.sim.rebuildStatics(world); }
export const DRIVE_PHYSICS_KEY = 'mvw.drivePhysics';
/** 'browser' or 'server': the saved choice, else automatic (this browser). */
export function drivePhysicsMode() {
  const saved = localStorage.getItem(DRIVE_PHYSICS_KEY);
  return saved === 'server' ? 'server' : 'browser';
}
