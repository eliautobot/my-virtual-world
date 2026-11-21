#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Every clip of a built character beside a ready-made one, as contact sheets (client/dev/char-clips.html, the city's own
// character renderer in a browser): each clip at three moments, front and side.
// Usage: node tools/chars/clip-sheet.mjs --url http://<host>:<port> (a server of this tree, e.g. tools/devserve.mjs) --kinds c_…,m05 --out dir [--clips idle,walk] [--views front,side]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const require = createRequire(import.meta.url);
const { launch, gpuInfo } = require('../lib/browser.cjs');
const { values: o } = parseArgs({ options: { url: { type: 'string' }, kinds: { type: 'string' }, out: { type: 'string' }, clips: { type: 'string' }, views: { type: 'string' }, phases: { type: 'string' }, lod: { type: 'string' }, frame: { type: 'string' } } });
const out = path.resolve(o.out || 'clip-sheets'); fs.mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const views = (o.views || 'front,side').split(','), phases = (o.phases || '0.1,0.4,0.7').split(',').map(Number);
  const summary = {};
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    page.on('pageerror', e => console.error('page error:', e.message));
    page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
    await page.goto(`${o.url}/dev/char-clips.html?kinds=${o.kinds}&view=${view}&h=360&lod=${o.lod || 0}&frame=${o.frame || 'body'}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    if (view === views[0]) { console.log('renderer:', await gpuInfo(page)); console.log(JSON.stringify(await page.evaluate(() => window.__info()))); }
    const clips = o.clips ? o.clips.split(',') : await page.evaluate(() => window.__clips);
    for (const clip of clips) {
      const shots = [];
      for (const ph of phases) shots.push(await page.evaluate(([c, p]) => window.__show(c, p), [clip, ph]));
      fs.writeFileSync(path.join(out, `${view}-${clip}.json`), JSON.stringify(shots));
      (summary[view] ||= []).push(clip);
    }
    await page.close();
  }
  // the sheets: one HTML page per view, every clip a row (three moments)
  for (const view of views) {
    const rows = summary[view].map(c => { const s = JSON.parse(fs.readFileSync(path.join(out, `${view}-${c}.json`), 'utf8')); fs.rmSync(path.join(out, `${view}-${c}.json`)); return `<div class="r"><b>${c}</b>${s.map(u => `<img src="${u}">`).join('')}</div>`; }).join('\n');
    fs.writeFileSync(path.join(out, `${view}.html`), `<!doctype html><meta charset="utf-8"><style>body{background:#222;color:#eee;font:12px sans-serif;margin:6px}.r{display:flex;align-items:center;gap:4px;margin:2px 0}.r b{width:110px}img{height:180px}</style>${rows}`);
    // (and as pictures, a dozen clips each)
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto('file://' + path.join(out, `${view}.html`));
    const n = summary[view].length;
    for (let s = 0; s * 12 < n; s++) {
      await page.evaluate(([a, b]) => document.querySelectorAll('.r').forEach((r, i) => { r.style.display = i >= a && i < b ? 'flex' : 'none'; }), [s * 12, s * 12 + 12]);
      await page.screenshot({ path: path.join(out, `${view}-${String(s + 1).padStart(2, '0')}.jpg`), fullPage: true, quality: 80, type: 'jpeg' });
    }
    await page.close();
  }
  console.log('sheets in', out);
} finally { await browser.close(); }
