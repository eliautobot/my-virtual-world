#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A fingerprint of the simulation: runs a generated city on a virtual clock and hashes every plan it sends, so a refactor
// of the residents' brain can be proven not to change anyone's behaviour (same digest before and after).
// Usage: node tools/sim-digest.mjs [population=1500] [worldHours=30] [seed=next-city] [--no-food]
// --no-food: no orders on the plans (shared/food.js): must print the digest of before food (every routine unchanged).
import crypto from 'node:crypto';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';

const noFood = process.argv.includes('--no-food'), args = process.argv.slice(2).filter(a => a !== '--no-food');
const pop = +(args[0] || 1500), hours = +(args[1] || 30), seed = args[2] || 'next-city';
const world = generateWorld({ seed, population: pop });
const roster = Array.from({ length: 12 }, (_, k) => ({ agentId: `digest-agent-${k + 1}`, name: `Digest Agent ${k + 1}`, emoji: '🤖', role: 'Agent' }));
const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
const sim = new Sim(world, people, { budgetMs: 1e9 });
if (noFood) sim.food = false;
let T = 0;
sim.now = () => T;
sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 };
const h = crypto.createHash('sha256');
let plans = 0;
sim.listeners.add(b => { h.update(Buffer.from(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength)); });
sim.start();
const end = hours * 3600 / 16;
while (T < end) { T += 0.5; sim.tick(); const before = sim.stats.plansSent; sim.flush(); plans += sim.stats.plansSent - before; }
console.log(JSON.stringify({ pop, hours, seed, food: !noFood, decisions: sim.stats.decisions, plans, errors: sim.errorCount, digest: h.digest('hex') }));
