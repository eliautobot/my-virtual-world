#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How the arcade's own player (shared/arcade/player.js) does on every built-in game (docs/features/arcade.md §Agents at
// the arcade): the average score per game per skill, every run checked by the module's own verify, and the CPU it took
// a second of play. For a new game: it should end, verify, and score something sensible for its stars.
//   node tools/arcade-agent-scores.mjs [games: id,id … | ''] [skills: 0,0.5,1] [runs each: 2] [minutes before winding up: 4]
import { GAMES } from '../shared/arcade/catalog.js';
import { SIMS } from '../shared/arcade/sims.js';
import { TICK_HZ } from '../shared/arcade/core.js';
import { verifyArcade } from '../shared/arcade.js';
import { playRun, controlsOf } from '../shared/arcade/player.js';

const only = process.argv[2] ? process.argv[2].split(',') : null;
const skills = (process.argv[3] || '0,0.5,1').split(',').map(Number);
const N = Number(process.argv[4] || 2), minutes = Number(process.argv[5] || 4);
const BTN = { 1: 'U', 2: 'D', 4: 'L', 8: 'R', 16: 'A', 32: 'B' };
const name = v => (v ? Object.entries(BTN).filter(([b]) => v & b).map(([, n]) => n).join('') : '·');
console.log(`game | stars | ${skills.map(k => `skill ${k}: avg [runs] · s · CPU ms/s`).join(' | ')} | controls`);
for (const g of GAMES.filter(x => x.kind === 'builtin' && (!only || only.includes(x.id)))) {
  const sim = SIMS[g.id], ctl = controlsOf(sim), cols = [];
  for (const k of skills) {
    const scores = [];
    let ticks = 0, ms = 0, bad = 0;
    for (let n = 0; n < N; n++) {
      const seed = 1000 + n * 77, t0 = performance.now();
      const r = playRun(sim, seed, { skill: k, stars: g.stars, maxTicks: minutes * 60 * TICK_HZ });
      ms += performance.now() - t0;
      const v = verifyArcade({ id: g.id }, { log: r.log, score: r.score }, { data: { seed }, serverMs: Math.ceil((r.ticks * 1000) / TICK_HZ) });
      if (!v.ok || v.score !== r.score) bad++;
      scores.push(r.score); ticks += r.ticks;
    }
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / N);
    cols.push(`${avg.toLocaleString('en-US')} [${scores.join(', ')}] · ${Math.round(ticks / N / TICK_HZ)} s · ${(ms / (ticks / TICK_HZ)).toFixed(1)}${bad ? ` · ${bad} NOT VERIFIED` : ''}`);
  }
  console.log(`${g.id} | ${g.stars.join('/')} | ${cols.join(' | ')} | ${ctl.inputs.map(name).join(' ')}${ctl.pointer ? ` + pointer ${ctl.pointer.x ? 'x' : ''}${ctl.pointer.y ? 'y' : ''}` : ''}`);
}
