#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The menus' pictures of every food and drink item (shared/food.js): one sheet of 16 × 16 cells, cell n = item number n,
// 96 px each, transparent - drawn by client/dev/food.html?atlas=1 in a headless browser → client/assets/food/thumbs.webp.
// Run again after an item is added or its model (client/js/render/food-models.js) changes:  node tools/food/thumbs.mjs
// (needs the browser the browser checks use: MVW_TEST_BROWSER)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, startServer } from '../lib/testserver.mjs';

const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const OUT = path.join(ROOT, 'client/assets/food/thumbs.webp');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const s = await startServer({ population: 20, agents: 0, demo: true });
let browser = null;
try {
  browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`${s.url}/dev/food.html?atlas=1&cell=96`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000, polling: 250 });
  const url = await page.evaluate(() => window.__atlas('image/webp', 0.86));
  const buf = Buffer.from(url.split(',')[1], 'base64');
  if (buf.length < 50000) throw new Error(`the sheet came out empty (${buf.length} bytes)`);
  fs.writeFileSync(OUT, buf);
  console.log(`${path.relative(ROOT, OUT)}: ${Math.round(buf.length / 1024)} KB`);
} finally { await browser?.close(); await s.stop(); }
