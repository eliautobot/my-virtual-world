// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Work hours chosen by an agent's owner (2026-10-28, the product owner: "give posts job hours ... and have a 24/7 option
// aswell"): a few usual shifts, or any from and to (an end at or before the start is the next morning: overnight) and
// days; what it comes to in words. One chooser for a counter's or a desk's ⋯ menu (ui/post-menu.js) and the Agent
// Studio's Home & Work (ui/studio-world.js); its look is css/post-menu.css (pp-hrs). The server checks the same rules
// (shared/shifts.js checkHours).
import { esc } from '../core/util.js';
import { formatClock, WEEKDAYS } from '/shared/constants.js';

export const PRESETS = [['day', 'Day', 9, 17, 0b0011111], ['morning', 'Morning', 6.5, 14.5, 0b1111111], ['evening', 'Evening', 14.5, 22.5, 0b1111111], ['night', 'Night', 22, 6, 0b1111111]];
export const hours = h => formatClock(h);
export const daysText = d => (d === 127 ? 'every day' : d === 31 ? 'Mon–Fri' : d === 96 ? 'weekends' : WEEKDAYS.filter((_, k) => d & (1 << k)).join(' '));
/** "9:00 AM–5:00 PM · Mon–Fri", or around the clock (a post). */
export const spanText = x => (x.all ? 'around the clock' : `${hours(x.start)}–${hours(x.end)} · ${daysText(x.days ?? 31)}`);
export const lenOf = (a, b) => { const e = b <= a ? b + 24 : b; return e - a; };
export const hoursOk = hr => { const len = lenOf(hr.start, hr.end % 24); return len >= 1 && len <= 16 && hr.days > 0; };
/** What the server is sent: { start, end (0 ≤ end < 24: at or before the start is overnight), days }. */
export const hoursBody = hr => ({ start: hr.start, end: hr.end % 24, days: hr.days });
export const presetHours = k => { const p = PRESETS.find(x => x[0] === k) || PRESETS[0]; return { start: p[2], end: p[3], days: p[4] }; };

/** The chooser for hours hr ({ start, end, days }); its buttons are data-pp="pre-…" / "day-k", its selects data-hr. */
export function hoursHtml(hr) {
  const opts = sel => Array.from({ length: 48 }, (_, k) => k / 2).map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${hours(v)}</option>`).join('');
  const end = hr.end % 24, len = lenOf(hr.start, end), pre = PRESETS.find(p => p[2] === hr.start && p[3] === end && p[4] === hr.days);
  return `<div class="pp-hrs">
    <div class="pp-presets" role="group" aria-label="Usual shifts">${PRESETS.map(p => `<button type="button" class="pp-pre${pre === p ? ' on' : ''}" data-pp="pre-${p[0]}">${p[1]}<small>${hours(p[2])}–${hours(p[3])}</small></button>`).join('')}</div>
    <div class="pp-times"><label>From <select data-hr="start" aria-label="From">${opts(hr.start % 24)}</select></label><label>To <select data-hr="end" aria-label="To">${opts(end)}</select></label></div>
    <div class="pp-days" role="group" aria-label="Days">${WEEKDAYS.map((d, k) => `<button type="button" class="pp-day${hr.days & (1 << k) ? ' on' : ''}" data-pp="day-${k}" aria-pressed="${!!(hr.days & (1 << k))}" title="${d}">${d[0]}</button>`).join('')}</div>
    <small class="pp-sum${len < 1 || len > 16 || !hr.days ? ' bad' : ''}">${len < 1 || len > 16 ? 'A shift is 1 to 16 hours: for around the clock, choose 24/7' : !hr.days ? 'Choose at least one day' : `${hours(hr.start)} to ${hours(end)}${end <= hr.start ? ' (next morning)' : ''}, ${esc(daysText(hr.days))} · ${len} h`}</small></div>`;
}
/** A chooser's click (data-pp pre-… / day-k) or change (data-hr) applied to hr; true when it was one. */
export function hoursInput(hr, el) {
  const a = el?.dataset?.pp;
  if (a?.startsWith('pre-')) { Object.assign(hr, presetHours(a.slice(4))); return true; }
  if (a?.startsWith('day-')) { hr.days ^= 1 << Number(a.slice(4)); return true; }
  if (el?.dataset?.hr) { hr[el.dataset.hr] = Number(el.value); return true; }
  return false;
}
