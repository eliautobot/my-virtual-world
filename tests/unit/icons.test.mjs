// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The interface's icons (client/js/core/icons.js): every emoji the interface writes - in client/, and the data shared/
// and server/ send to it (what residents are doing, terrain tools, goods) - has a drawn icon, so nothing shows as an emoji
// in the middle of the theme's line icons; every icon's path is well formed. Adding an emoji? Draw its icon in icons.js,
// map the emoji to it in EMOJI (or, for typography such as arrows in prose, list it in KEEP).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { ICONS, EMOJI, KEEP, icon, iconFor } from '../../client/js/core/icons.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const SYMBOL = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2900}-\u{297F}\u{2100}-\u{214F}\u{27F0}-\u{27FF}\u{FF0B}\u{FF0D}]/gu;
// Pinned copies of other releases' code (hash-checked elsewhere) and the loading screen's art (no emoji, a canvas).
const SKIP = [/client\/js\/vendor-classic\//, /shared\/driving-classic\//, /node_modules\//];

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.some(r => r.test(p))) continue;
    if (e.isDirectory()) yield* files(p);
    else if (/\.(m?js|html)$/.test(e.name)) yield p;
  }
}
/** Each line's code, without // and block comments (good enough for this source: no emoji inside regex literals). */
function codeLines(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    let line = raw;
    if (inBlock) { const k = line.indexOf('*/'); if (k < 0) continue; line = line.slice(k + 2); inBlock = false; }
    line = line.replace(/\/\*.*?\*\//g, '');
    const b = line.indexOf('/*'); if (b >= 0) { line = line.slice(0, b); inBlock = true; }
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('*')) continue;
    const c = line.search(/(^|[^:'"`\\])\/\/(?![^'"`]*['"`])/);   // a trailing // comment (not in a URL or string)
    out.push(c >= 0 ? line.slice(0, c + 1) : line);
  }
  return out;
}

test('every mapped emoji points at a drawn icon, and the lookups agree', () => {
  for (const [e, v] of Object.entries(EMOJI)) {
    const name = Array.isArray(v) ? v[0] : v;
    assert.ok(ICONS[name], `${e} → ${name}: no such icon`);
    assert.equal(iconFor(e), name);
    assert.equal(iconFor(e + '️'), name, `${e} with its variation selector`);
  }
  assert.match(icon('lock'), /^<svg class="mvi" viewBox="0 0 24 24" aria-hidden="true"/);
  assert.match(icon('warn', 'gold', '⚠️'), /class="mvi t-gold".*<desc>⚠️<\/desc>/);
  assert.equal(icon('no-such-icon'), '');
});

test('every icon path is well formed (commands with whole sets of numbers, inside the 24 grid)', () => {
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  for (const [name, parts] of Object.entries(ICONS)) {
    assert.ok(parts[0] || parts[1], `${name} draws nothing`);
    for (const d of parts.filter(Boolean)) {
      assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, `${name}: stray characters`);
      const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
      assert.match(tokens[0], /^[Mm]$/, `${name}: starts with a move`);
      let cmd = null, k = 0, x = 0, y = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      const flush = () => { if (cmd && ARGS[cmd.toUpperCase()]) assert.equal(k % ARGS[cmd.toUpperCase()], 0, `${name}: ${cmd} with ${k} numbers in "${d.slice(0, 60)}…"`); };
      for (const t of tokens) {
        if (/[A-Za-z]/.test(t)) { flush(); cmd = t; k = 0; continue; }
        k++;
        if (cmd === 'M' || cmd === 'L') { if (k % 2) x = +t; else { y = +t; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
      }
      flush();
      if (minX < 1e9) assert.ok(minX >= 0 && maxX <= 24 && minY >= 0 && maxY <= 24, `${name}: absolute points outside the 24 grid (${minX}..${maxX}, ${minY}..${maxY})`);
    }
  }
});

test('every emoji the interface or its data writes has an icon (or is typography kept as text)', () => {
  const keep = new Set(KEEP), missing = new Map();
  for (const dir of ['client', 'shared', 'server']) for (const f of files(path.join(ROOT, dir))) {
    if (f.endsWith('core/icons.js')) continue;
    const lines = codeLines(fs.readFileSync(f, 'utf8'));
    lines.forEach((line, i) => {
      for (const m of line.matchAll(SYMBOL)) {
        const e = m[0];
        if (keep.has(e) || EMOJI[e]) continue;
        if (!missing.has(e)) missing.set(e, `${path.relative(ROOT, f)}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual([...missing].map(([e, w]) => `${e} (U+${e.codePointAt(0).toString(16).toUpperCase()}) in ${w}`), [],
    'emoji without an icon: draw one in client/js/core/icons.js and map it in EMOJI (or add typography to KEEP)');
});
