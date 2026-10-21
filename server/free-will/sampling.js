// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Turning a decision service's answer into one pick (docs/features/FREE-WILL.md §11.1: the same question always got the
// same top answer, so always taking it makes an agent predictable). The service's probabilities are sharpened or
// flattened by the agent's spontaneity and one option is drawn: 0 is nearly always the service's favourite, 0.5 follows
// the service's own odds, 1 gives the less likely options a real chance. Options the world does not offer are ignored.

/** Temperature for a spontaneity 0..1. */
export const temperature = s => 0.25 + 1.75 * Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0.5));

/**
 * answer = { choice, probabilities: [{ value, probability }] } (a 'choice' answer); allowed = Set of option ids;
 * rand() in [0, 1). Returns { value, p } (p: the drawn option's share after the temperature) or null when nothing in the
 * answer is an allowed option.
 */
export function drawChoice(answer, allowed, spontaneity, rand) {
  const probs = Array.isArray(answer && answer.probabilities) ? answer.probabilities : [];
  const t = temperature(spontaneity);
  const w = [];
  for (const x of probs) {
    if (!x || !allowed.has(x.value)) continue;
    const p = Number(x.probability);
    if (!(p > 0)) continue;
    w.push([x.value, Math.pow(p, 1 / t)]);
  }
  if (!w.length) return answer && allowed.has(answer.choice) ? { value: answer.choice, p: 1 } : null;
  const sum = w.reduce((s, x) => s + x[1], 0);
  let r = rand() * sum;
  for (const [value, x] of w) { r -= x; if (r <= 0) return { value, p: x / sum }; }
  const last = w[w.length - 1];
  return { value: last[0], p: last[1] / sum };
}
