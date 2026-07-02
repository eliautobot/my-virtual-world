#!/usr/bin/env node
// Targeted unit test: server route stepper carries residual per-tick distance
// through intermediate waypoints so corner ticks keep near-constant speed
// (M1.5a, 8590 parity). Pattern-matches scripts/verify-route-watchdog.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServerRuntimeStep } from '../src/realtime/agent-runtime-room.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'vw-corner-'));
const TICK_MS = 250;
const SPEED = 18; // units/sec -> 4.5 units per tick
const ARRIVAL = 5;

// L-shaped exterior pathfinder route: (0,0) -> (0,30) -> (30,30)
const finalTarget = { x: 30, y: 30, floor: 1, buildingId: '' };
const routePoints = [
  { x: 0, y: 0, floor: 1 },
  { x: 0, y: 30, floor: 1 },
  { x: 30, y: 30, floor: 1 },
];

let agent = {
  x: 0,
  y: 0,
  floor: 1,
  buildingId: '',
  heading: 0,
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-exterior-routing.js',
      reason: 'exterior-route',
      routeIndex: 1,
      route: routePoints,
      routePoints,
      finalPoint: { ...finalTarget },
      effectiveTarget: { ...routePoints[1] },
    },
  },
};

const displacements = [];
const headings = [];
let arrivedAtTick = -1;
for (let tick = 0; tick < 40; tick += 1) {
  const step = makeServerRuntimeStep(dataDir, 'permi', agent, finalTarget, TICK_MS, {
    speedUnitsPerSec: SPEED,
    arrivalRadius: ARRIVAL,
    crowdAgents: [],
  });
  const moved = Math.hypot(step.x - agent.x, step.y - agent.y);
  displacements.push(moved);
  headings.push(step.heading);
  agent = {
    ...agent,
    x: step.x,
    y: step.y,
    heading: step.heading,
    visualState: {
      runtimeRoute: step.route && step.route.active
        ? { ...agent.visualState.runtimeRoute, ...step.route }
        : agent.visualState.runtimeRoute,
    },
  };
  if (step.arrived) {
    arrivedAtTick = tick;
    break;
  }
}

assert.ok(arrivedAtTick > 0, `agent should arrive within 40 ticks (got ${arrivedAtTick}; last pos ${agent.x},${agent.y})`);

// Total path length is 60 units; 4.5/tick means the corner at (0,30) falls
// mid-tick around tick 6. Every pre-arrival tick displacement must stay within
// 20% of the nominal tick step (no corner stall).
const nominal = SPEED * (TICK_MS / 1000);
for (let index = 0; index < displacements.length - 1; index += 1) {
  const moved = displacements[index];
  assert.ok(
    Math.abs(moved - nominal) <= nominal * 0.2,
    `tick ${index} displacement ${moved.toFixed(3)} deviates >20% from nominal ${nominal} (corner stall)`,
  );
}

// M1.5b: heading deltas through the corner must be gradual (< ~60 deg/tick).
const angleDelta = (a, b) => {
  let delta = Math.abs(a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return delta;
};
for (let index = 1; index < headings.length - 1; index += 1) {
  const delta = angleDelta(headings[index], headings[index - 1]);
  assert.ok(
    delta <= (Math.PI / 2) + 0.001,
    `tick ${index} heading delta ${(delta * 180 / Math.PI).toFixed(1)}deg exceeds max turn rate`,
  );
}

console.log(`route-corner-smoothness OK: arrived tick ${arrivedAtTick}, displacements [${displacements.map(d => d.toFixed(2)).join(', ')}]`);
