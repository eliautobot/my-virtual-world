// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent working a shift's orders the way a player does (2026-11-17, the product owner: "If the player can do it then AI agents
// should also be able to do it"): a work module's order (shared/work.js) is played from what the player's panel shows —
// the public order, never the server's answer — step by step at the pace and with the slips of the worker's level in
// that role: a timing bar stopped near the green (a beginner a little early or late), a meter let go near the band, a
// choice read from what the customer said (the memos the panel shows, this step's or an earlier one's: "a large latte",
// "table 5"), a sequence tapped in the order shown (now and then two swapped). Only raw inputs come out (the reports the
// panel sends: { t } | { ms } | { pick } | { picks }); the server scores them (server/economy/jobs.js act) and refuses an
// order faster than a person — the bot takes a person's time (ms). Deterministic from its own random numbers.
import { needleAt, minMsOf } from './work.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const words = s => String(s ?? '').toLowerCase();

/** How a worker of role level `level` works: { aim (0..1: how close to the mark), slip (a wrong pick or a swap), pace (x a
 *  person's expected time) }. */
export function workPace(level) {
  const L = clamp(level | 0, 1, 20);
  return { aim: clamp(0.55 + L * 0.04, 0.55, 0.95), slip: clamp(0.12 - L * 0.01, 0.02, 0.12), pace: clamp(1.25 - L * 0.03, 0.9, 1.25) };
}

/** The first moment (ms from the step's start, from `from`) the needle of a timing step is at its mark, to 5 ms. */
export function markTime(step, from = 700) {
  let best = from, bd = Infinity;
  for (let t = from; t <= from + 2 * step.period; t += 5) { const d = Math.abs(needleAt(step, t) - step.target); if (d < bd - 1e-9) { bd = d; best = t; } if (d < 0.004) break; }
  return best;
}

/** The option of a choice step the order's words point to (its memo, an earlier step's, the title), or -1 (not said). */
export function readChoice(order, k) {
  const st = order.steps[k], said = [st.memo, ...order.steps.slice(0, k).map(s => s.memo), order.title].filter(Boolean).map(words);
  const opts = (st.options || []).map(words);
  // the longest option said wins ("no bag" over "bag"); an option said as a whole word or number
  const hit = opts.map((o, j) => [o, j]).filter(([o]) => o && said.some(s => new RegExp(`(^|[^a-z0-9])${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(s))).sort((x, y) => y[0].length - x[0].length);
  return hit.length ? hit[0][1] : -1;
}

/**
 * One order worked by a worker of `level` (rng: shared/rng.js RNG): → { reports (one per step, as the panel sends), ms (how
 * long it takes them, never under a person's least: shared/work.js minMsOf) }.
 */
export function workOrder(order, { level = 1, rng }) {
  const p = workPace(level), reports = [];
  let ms = rng.int(1200, 2400);   // (reading the ticket)
  order.steps.forEach((st, k) => {
    if (st.kind === 'timing') {
      const mark = markTime(st, rng.int(600, 1100)), off = (1 - p.aim) * st.period * 0.35 * rng.float(-1, 1);
      const t = Math.round(clamp(mark + off, 150, 59000));
      reports.push({ t }); ms += t + rng.int(300, 700);
    } else if (st.kind === 'meter') {
      const m = Math.round(clamp(st.target * st.fill + (1 - p.aim) * st.fill * 0.2 * rng.float(-1, 1), 120, 59000));
      reports.push({ ms: m }); ms += m + rng.int(400, 800);
    } else if (st.kind === 'choice') {
      const n = (st.options || []).length, read = readChoice(order, k);
      let pick = read >= 0 ? read : rng.int(0, Math.max(0, n - 1));
      if (n > 1 && rng.chance(p.slip)) pick = (pick + rng.int(1, n - 1)) % n;
      reports.push({ pick }); ms += rng.int(900, 2200);
    } else if (st.kind === 'sequence') {
      const picks = [...(st.order || [])];
      if (picks.length > 1 && rng.chance(p.slip)) { const j = rng.int(0, picks.length - 2); [picks[j], picks[j + 1]] = [picks[j + 1], picks[j]]; }
      reports.push({ picks }); ms += picks.length * rng.int(450, 750);
    } else { reports.push({}); ms += 800; }
  });
  ms = Math.round(Math.max(ms * p.pace, minMsOf(order) + 400));
  return { reports, ms };
}
