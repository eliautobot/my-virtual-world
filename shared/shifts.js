// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Work hours (2026-10-28, the product owner: "maybe theres a way to give posts hours of work, that way the agents can
// also do things they want to do and live out an experience. and if they are meant to be filled 24/7 thats an option
// too"). A job's hours are start..end in hours of the day its shift starts; an overnight shift ends past midnight
// (end > 24: 22 → 30 is 10 PM to 6 AM, its morning hours belonging to the night before). days: the days of the week
// its shifts start on, bit 0 = Monday (population.js daysMask).

export const MIN_SHIFT_H = 1, MAX_SHIFT_H = 16;
export const ALL_DAYS = 0b1111111, WEEKDAYS_MASK = 0b0011111;
const mod = (a, n) => ((a % n) + n) % n;

/** Whether job j works a shift starting on world day `day` (dflt: its days when it has none recorded). */
export function worksOn(j, day, dflt = 31) { return !!((j.days ?? dflt) & (1 << mod(day, 7))); }

/** Hour h of world day `day` in job j's own frame: in the morning tail of last night's overnight shift, h + 24 on the
 *  day before (that shift's day); otherwise as it is. → { h, day }. */
export function shiftClock(j, h, day, dflt = 31) {
  if (j && j.end > 24 && h < j.end - 24 && worksOn(j, day - 1, dflt)) return { h: h + 24, day: day - 1 };
  return { h, day };
}

/** Hours chosen for a job, checked: start 0 ≤ s < 24 and end on the quarter hour, the end on or before the start meaning
 *  the next morning (overnight); 1 to 16 hours long. days: a 7-bit mask with at least one day. → { start, end, days } or
 *  an Error saying why. */
export function checkHours(start, end, days = ALL_DAYS) {
  const q = v => Math.round(Number(v) * 4) / 4;
  let s = q(start), e = q(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || s >= 24 || e < 0 || e > 24) return new Error('Choose a start and an end time');
  if (e <= s) e += 24;   // (overnight: it ends the next morning)
  const len = e - s;
  if (len < MIN_SHIFT_H || len > MAX_SHIFT_H) return new Error(`A shift is ${MIN_SHIFT_H} to ${MAX_SHIFT_H} hours long; for around the clock choose 24/7`);
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > ALL_DAYS) return new Error('Choose at least one day');
  return { start: s, end: e, days: d };
}

/** Whether two jobs' hours ever meet in a week (each { start, end, days }: a 24/7 post is { all: true }). */
export function overlaps(a, b) {
  if (!a || !b || a.all || b.all) return true;
  const spans = j => { const out = []; for (let d = 0; d < 7; d++) if (worksOn(j, d)) { const s = d * 24 + j.start, e = d * 24 + j.end; out.push([s, e]); if (e > 168) out.push([s - 168, e - 168]); } return out; };
  const A = spans(a), B = spans(b);
  return A.some(([s1, e1]) => B.some(([s2, e2]) => s1 < e2 && s2 < e1));
}
/** Whether job j (a shift: start, end, days) is on at hour h of world day `day`. */
export function onHours(j, h, day) {
  const c = shiftClock(j, h, day);
  return worksOn(j, c.day) && c.h >= j.start && c.h < j.end;
}
