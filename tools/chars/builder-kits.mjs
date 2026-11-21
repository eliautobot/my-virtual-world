#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Kits from the builder in a browser (client/dev/builder-kit.html), for checks: each preset dressed and exported, the
// kit written to <out>/<name>.kit (bake it: tools/chars/custom-kind.mjs), with the builder's own picture of it.
// Usage: node tools/chars/builder-kits.mjs --url http://<host>:<port> (a server of this tree, e.g. tools/devserve.mjs) --presets presets.json --out dir
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const require = createRequire(import.meta.url);
const { launch } = require('../lib/browser.cjs');
const { values: o } = parseArgs({ options: { url: { type: 'string' }, presets: { type: 'string' }, out: { type: 'string' } } });
const presets = JSON.parse(fs.readFileSync(o.presets, 'utf8')), out = path.resolve(o.out || 'kits');
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(`${o.url}/dev/builder-kit.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  for (const [name, preset] of Object.entries(presets)) {
    const t0 = Date.now();
    const r = await page.evaluate(p => window.__kit(p), { format: 'mvw-character', version: 2, ...preset });
    fs.writeFileSync(path.join(out, name + '.kit'), Buffer.from(r.b64, 'base64'));
    fs.writeFileSync(path.join(out, name + '.preset.json'), JSON.stringify(r.preset));
    const shot = await page.evaluate(() => window.__shot('body'));
    fs.writeFileSync(path.join(out, name + '.jpg'), Buffer.from(shot.split(',')[1], 'base64'));
    console.log(`${name}: ${r.stats.parts} parts, ${r.stats.verts} verts, ${r.stats.tris} tris, export ${Math.round(r.ms)} ms, ${(r.b64.length * 0.75 / 1e6).toFixed(2)} MB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
} finally { await browser.close(); }
