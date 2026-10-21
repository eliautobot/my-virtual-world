// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Charts for the economy (ui/economy.js, ui/econ-city.js): line charts with a crosshair and tooltip, bar lists with the
// value at the tip, sparklines, SimCity-style demand bars and stat tiles. Plain SVG and HTML, coloured by role through
// CSS variables (css/economy.css: --ec-1 … --ec-4 are the validated categorical slots for the dark and light themes,
// --ec-pos/--ec-neg the diverging pair), so the themes recolour them; text always wears the text colours.
import { esc } from '../core/util.js';

export const SERIES = ['var(--ec-1)', 'var(--ec-2)', 'var(--ec-3)', 'var(--ec-4)'];

/** Rounded, readable ticks for a range: about n of them. */
function ticks(lo, hi, n = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
/** Short numbers: 1,284 · 12.9K · 4.2M. */
export function compact(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${s}${Math.round(a).toLocaleString('en-US')}`;
}

/** How a chart writes its numbers: axis ticks short, values in full. */
export const FORMATS = {
  vc: v => (v / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }),
  vcAxis: v => compact(v / 100),
  num: v => compact(v),
  idx: v => Number(v).toFixed(1),
};
/**
 * A line chart. series: [{ label, points: [[x, y] …], color? }] (x: an economic day). o: { fmt ('vc' | 'num' | 'idx'),
 * zero (start the axis at 0), h (px), area (wash under the first series), title }. Returns a placeholder; paint(root)
 * draws it at its real width once it is on the page (and again when the window is resized), so text never stretches.
 */
export function lineChart(series, o = {}) {
  if (!series.some(s => s.points?.length)) return '<p class="hint ec-empty">No history yet — it grows with each world day.</p>';
  const spec = { series: series.map((s, k) => ({ label: s.label, color: s.color || SERIES[k % SERIES.length], points: s.points })), o: { fmt: o.fmt || 'num', zero: o.zero !== false, h: o.h || 170, area: !!o.area, title: o.title || '' } };
  const legend = series.length > 1 ? `<div class="ec-legend">${spec.series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
  return `${legend}<div class="ec-chart" data-spec='${esc(JSON.stringify(spec))}'></div>`;
}
/** Draws every chart placeholder inside root at its width in pixels. */
export function paint(root) {
  for (const c of root.querySelectorAll('.ec-chart[data-spec]')) {
    const W = Math.max(240, Math.round(c.clientWidth || 560));
    if (Number(c.dataset.w) === W) continue;
    let spec; try { spec = JSON.parse(c.dataset.spec); } catch { continue; }
    c.dataset.w = W;
    c.innerHTML = draw(spec, W);
  }
}
function draw({ series, o }, W) {
  const H = o.h, L = 52, R = 76, T = 12, B = 22, fmt = FORMATS[o.fmt] || FORMATS.num, axis = o.fmt === 'vc' ? FORMATS.vcAxis : fmt;
  const all = series.flatMap(s => s.points), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= 1; x1 += 1; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (o.zero && y0 > 0) y0 = 0;
  if (y1 === y0) y1 = y0 + 1;
  const tk = ticks(y0, y1); y0 = Math.min(y0, tk[0]); y1 = Math.max(y1, tk[tk.length - 1]);
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const grid = tk.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ec-grid"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="ec-ax" text-anchor="end">${esc(axis(v))}</text>`).join('');
  const days = [...new Set(xs)].sort((a, b) => a - b);
  const xt = [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].filter((v, k, a) => a.indexOf(v) === k).map(v => `<text x="${X(v).toFixed(1)}" y="${H - 6}" class="ec-ax" text-anchor="middle">Day ${v + 1}</text>`).join('');
  let marks = '';
  series.forEach((s, k) => {
    const pts = [...s.points].sort((a, b) => a[0] - b[0]);
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const base = Y(Math.max(y0, 0)).toFixed(1);
    if (o.area && k === 0 && pts.length > 1) marks += `<path d="${d}L${X(pts[pts.length - 1][0]).toFixed(1)},${base}L${X(pts[0][0]).toFixed(1)},${base}Z" fill="${s.color}" opacity=".1"/>`;
    marks += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const e = pts[pts.length - 1];
    marks += `<circle cx="${X(e[0]).toFixed(1)}" cy="${Y(e[1]).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--ec-surface)" stroke-width="2"/>`;
    marks += `<text x="${(X(e[0]) + 8).toFixed(1)}" y="${(Y(e[1]) + 4).toFixed(1)}" class="ec-end">${esc(axis(e[1]))}</text>`;
  });
  const data = { days, series: series.map(s => ({ label: s.label, color: s.color, v: Object.fromEntries(s.points) })), L, R, W, x0, x1, fmt: o.fmt };
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.title || series.map(s => s.label).join(', '))}" data-chart='${esc(JSON.stringify(data))}'>${grid}${xt}${marks}<line class="ec-cross hidden" y1="${T}" y2="${H - B}"/></svg><div class="ec-tip hidden"></div>`;
}
/** Brings every chart inside root to life: a crosshair and a tooltip with each series' value at the nearest day. */
export function hover(root) {
  if (root.dataset.ecHover) return;
  root.dataset.ecHover = '1';
  root.addEventListener('pointermove', e => {
    const c = e.target.closest?.('.ec-chart'), svg = c?.querySelector('svg[data-chart]'); if (!svg) return;
    let d; try { d = JSON.parse(svg.dataset.chart); } catch { return; }
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * d.W;
    if (sx < d.L - 10 || sx > d.W - d.R + 10) return hide(c);
    const x = d.x0 + Math.max(0, Math.min(1, (sx - d.L) / (d.W - d.L - d.R))) * (d.x1 - d.x0);
    const day = d.days.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b), d.days[0]);
    const px = d.L + (day - d.x0) / ((d.x1 - d.x0) || 1) * (d.W - d.L - d.R), fmt = FORMATS[d.fmt] || FORMATS.num;
    const line = svg.querySelector('.ec-cross'); line.setAttribute('x1', px); line.setAttribute('x2', px); line.classList.remove('hidden');
    const tip = c.querySelector('.ec-tip');
    tip.innerHTML = `<b>Day ${day + 1}</b>${d.series.map(s => (s.v[day] !== undefined ? `<span><i style="background:${s.color}"></i>${esc(s.label)}<em>${esc(fmt(s.v[day]))}</em></span>` : '')).join('')}`;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, px / d.W * r.width + 12))}px`;
  });
  root.addEventListener('pointerleave', () => root.querySelectorAll('.ec-chart').forEach(hide), true);
  function hide(c) { c.querySelector('.ec-cross')?.classList.add('hidden'); c.querySelector('.ec-tip')?.classList.add('hidden'); }
}
/** Horizontal bars, one per item: [{ label, icon?, value, note? }], the value at the tip; color: a role variable. */
export function barList(items, { fmt = compact, color = 'var(--ec-1)', max = null } = {}) {
  const top = max ?? Math.max(1, ...items.map(i => Math.abs(i.value)));
  return `<div class="ec-bars">${items.map(i => `<div class="ec-bar" title="${esc(i.note || '')}"><span class="ec-bl">${i.icon ? `${i.icon} ` : ''}${esc(i.label)}</span><span class="ec-bt"><i style="width:${Math.max(0, Math.min(100, Math.abs(i.value) / top * 100)).toFixed(1)}%;background:${color}"></i></span><b>${esc(fmt(i.value))}</b></div>`).join('')}</div>`;
}
/** A sparkline: the trend in the quiet colour, the latest point in the accent. */
export function sparkline(values, { w = 90, h = 26 } = {}) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), d = hi - lo || 1;
  const pts = v.map((y, i) => [i / (v.length - 1) * (w - 6) + 3, h - 3 - (y - lo) / d * (h - 6)]);
  const e = pts[pts.length - 1];
  return `<svg class="ec-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="3" fill="var(--ec-1)"/></svg>`;
}
/** SimCity's demand bars: −100 (oversupplied) … +100 (in demand), from the centre. */
export function demandBars(items) {
  return `<div class="ec-demand">${items.map(i => {
    const v = Math.max(-100, Math.min(100, i.value)), pos = v >= 0;
    return `<div class="ec-dem" title="${esc(i.note || '')}"><span class="ec-dl">${i.icon} ${esc(i.label)}</span><span class="ec-dt"><i class="${pos ? 'pos' : 'neg'}" style="${pos ? 'left:50%' : `left:${50 + v / 2}%`};width:${Math.abs(v) / 2}%"></i><s></s></span><b>${pos ? '▲' : '▼'} ${Math.abs(Math.round(v))}</b></div>`;
  }).join('')}<p class="hint">▲ wanted (more would fill up) · ▼ more than enough</p></div>`;
}
/** A stat tile: label, value, an optional signed change and sparkline. */
export function tile(label, value, { delta = null, deltaGood = true, spark = null, note = '' } = {}) {
  const dir = delta === null ? '' : delta > 0 ? 'up' : delta < 0 ? 'down' : '';
  const good = delta === null || delta === 0 ? '' : (delta > 0) === deltaGood ? 'good' : 'bad';
  return `<div class="ec-tile" title="${esc(note)}"><span class="ec-tl">${esc(label)}</span><b class="ec-tv">${value}</b>${delta !== null ? `<span class="ec-td ${good}">${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} ${esc(String(Math.abs(delta)))}${typeof delta === 'number' && !String(delta).includes('%') ? '%' : ''}</span>` : ''}${spark ? sparkline(spark) : ''}</div>`;
}
