// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Dates and times as agents write them (docs/features/agent-pc.md §4), read in the agent's work time zone: "2026-10-20
// 14:00", "tomorrow 9am", "fri 5pm", "next monday", "oct 20 3:30pm", "in 2 hours", "+30m", "noon". Real time, never
// the world's clock. Also lengths ("30m", "1h30", "2 days") and the way times are shown back ("Tue Oct 20, 14:00").

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const UNIT = { m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000, h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000,
  d: 86400000, day: 86400000, days: 86400000, w: 604800000, week: 604800000, weeks: 604800000 };

// (a formatter is costly to make and holds memory outside the JavaScript heap: one per time zone and shape, kept)
const FORMATS = new Map();
function fmt(tz, kind, o) {
  const k = `${tz}|${kind}`;
  let f = FORMATS.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o });
    if (FORMATS.size > 2000) FORMATS.clear();
    FORMATS.set(k, f);
  }
  return f;
}

/** The wall clock in `tz` at instant `t`: { y, mo (0-11), d, h, mi, wd (0 = Sunday) }. */
export function wall(t, tz) {
  const parts = fmt(tz, 'wall', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(t));
  const g = k => parts.find(p => p.type === k)?.value;
  return { y: +g('year'), mo: +g('month') - 1, d: +g('day'), h: +g('hour') % 24, mi: +g('minute'), wd: DAYS.indexOf(g('weekday').toLowerCase().slice(0, 3)) };
}
/** The instant whose wall clock in `tz` is y-mo-d h:mi (DST gaps move forward, as clocks do). */
export function instant(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo, d, h, mi);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const w = wall(t, tz);
    const diff = Date.UTC(w.y, w.mo, w.d, w.h, w.mi) - guess;
    if (!diff) break;
    t -= diff;
  }
  return t;
}

/** A time of day: "9", "9am", "9:30pm", "14:00", "noon", "midnight" → [h, mi] or null. */
function timeOf(s) {
  if (s === 'noon') return [12, 0];
  if (s === 'midnight') return [0, 0];
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0, ap = m[3];
  if (mi > 59 || h > 23) return null;
  if (ap) { if (h > 12 || h === 0) return null; if (ap[0] === 'p' && h < 12) h += 12; if (ap[0] === 'a' && h === 12) h = 0; }
  else if (!m[2] && h < 7) return null;   // ("5" alone is not a time; "5pm" or "05:00" is)
  return [h, mi];
}

/** A length of time: "30m", "1h", "1h30", "90 minutes", "2 days" → ms, or null. */
export function parseLength(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  let m = /^(\d+)h(\d{1,2})$/.exec(s);
  if (m) return +m[1] * 3600000 + +m[2] * 60000;
  m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(s);
  if (m && UNIT[m[2]]) return Math.round(+m[1] * UNIT[m[2]]);
  return null;
}

/** When `raw` is, in `tz`, seen from `now`: { t, allDay, time } or null. A date alone means the start of that day
 *  (allDay). A time alone means the next one (today, or tomorrow when it has passed). */
export function parseWhen(raw, tz, now = Date.now()) {
  let s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/,/g, ' ').replace(/\bat\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s === 'now') return { t: now, allDay: false, time: true };
  let m = /^(?:in |\+)(\d+(?:\.\d+)?) ?([a-z]+)$/.exec(s);
  if (m && UNIT[m[2]]) return { t: now + Math.round(+m[1] * UNIT[m[2]]), allDay: false, time: true };
  const w = wall(now, tz);
  let y = w.y, mo = w.mo, d = w.d, date = false;
  // the date part
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:t| |$)(.*)$/.exec(s))) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; s = m[4].trim(); date = true; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?: |$)(.*)$/.exec(s))) { mo = +m[1] - 1; d = +m[2]; if (m[3]) y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; s = m[4].trim(); date = true; }
  else if ((m = /^(today|tonight|tomorrow|yesterday)(?: |$)(.*)$/.exec(s))) {
    const add = m[1] === 'tomorrow' ? 1 : m[1] === 'yesterday' ? -1 : 0;
    const dt = new Date(Date.UTC(y, mo, d + add)); y = dt.getUTCFullYear(); mo = dt.getUTCMonth(); d = dt.getUTCDate();
    s = m[2].trim(); date = true;
    if (m[1] === 'tonight' && !s) s = '8pm';
  } else if ((m = /^(next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?: |$)(.*)$/.exec(s))) {
    const want = DAYS.indexOf(m[2]);
    let add = (want - w.wd + 7) % 7;
    if (add === 0) add = 7;   // (today's name: the one a week on; "next fri" is the coming Friday)
    const dt = new Date(Date.UTC(y, mo, d + add)); y = dt.getUTCFullYear(); mo = dt.getUTCMonth(); d = dt.getUTCDate();
    s = m[3].trim(); date = true;
  } else if ((m = /^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?(?: |$)(.*)$/.exec(s)) && MONTHS.includes(m[1])) {
    mo = MONTHS.indexOf(m[1]); d = +m[2]; if (m[3]) y = +m[3]; s = m[4].trim(); date = true;
    if (!m[3] && Date.UTC(y, mo, d) < Date.UTC(w.y, w.mo, w.d)) y++;
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]*(?: (\d{4}))?(?: |$)(.*)$/.exec(s)) && MONTHS.includes(m[2])) {
    mo = MONTHS.indexOf(m[2]); d = +m[1]; if (m[3]) y = +m[3]; s = m[4].trim(); date = true;
    if (!m[3] && Date.UTC(y, mo, d) < Date.UTC(w.y, w.mo, w.d)) y++;
  }
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1970 || y > 9999) return null;
  const check = new Date(Date.UTC(y, mo, d));
  if (check.getUTCMonth() !== mo) return null;
  // the time part
  if (!s) return date ? { t: instant(y, mo, d, 0, 0, tz), allDay: true, time: false } : null;
  const tm = timeOf(s.replace(/\s+(am|pm)$/, '$1'));
  if (!tm) return null;
  let t = instant(y, mo, d, tm[0], tm[1], tz);
  if (!date && t <= now) t = instant(y, mo, d + 1, tm[0], tm[1], tz);   // (a time alone: the next one)
  return { t, allDay: false, time: true };
}

/** How a time is shown to an agent: "Tue Oct 20, 14:00" (the year when it is not this one; no time for a whole day). */
export function showWhen(t, tz, { allDay = false, now = Date.now() } = {}) {
  const year = wall(t, tz).y !== wall(now, tz).y;
  const date = fmt(tz, year ? 'dateY' : 'date', { weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }).format(new Date(t));
  if (allDay) return date;
  const time = fmt(tz, 'time', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
  return `${date}, ${time}`;
}
/** The start of the day `t` is in (in `tz`). */
export function dayStart(t, tz) { const w = wall(t, tz); return instant(w.y, w.mo, w.d, 0, 0, tz); }
export const lengthText = ms => (ms % 86400000 === 0 && ms >= 86400000 ? `${ms / 86400000} day${ms === 86400000 ? '' : 's'}`
  : ms % 3600000 === 0 ? `${ms / 3600000} h` : ms > 3600000 ? `${Math.floor(ms / 3600000)} h ${Math.round((ms % 3600000) / 60000)} min` : `${Math.round(ms / 60000)} min`);
