#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The characters' portraits (the Agent Studio's Customize tab): every character's head and shoulders, 160×200, on a
// transparent background, from client/dev/portrait.html in a headless browser → client/assets/chars/portraits/<id>.webp.
// Run again after a character's model or textures change:  node tools/chars/portraits.mjs [ids…]
// (needs the browser the browser checks use: MVW_TEST_BROWSER)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, startServer } from '../lib/testserver.mjs';
import { CHARACTERS } from '../../shared/appearance.js';

const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const OUT = path.join(ROOT, 'client/assets/chars/portraits');
fs.mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : CHARACTERS;
const s = await startServer({ population: 20, agents: 0, demo: true });
let browser = null, bytes = 0;
try {
  browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 160, height: 200 }, deviceScaleFactor: 1 })).newPage();
  for (const id of ids) {
    await page.goto(`${s.url}/dev/portrait.html?char=${encodeURIComponent(id)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__portrait === true, null, { timeout: 120000, polling: 200 });
    const url = await page.evaluate(() => window.__shoot('image/webp', 0.88));
    const buf = Buffer.from(url.split(',')[1], 'base64');
    if (buf.length < 1500) throw new Error(`${id}: the portrait came out empty (${buf.length} bytes)`);
    fs.writeFileSync(path.join(OUT, `${id}.webp`), buf);
    bytes += buf.length;
    process.stdout.write(`${id} ${buf.length} B\n`);
  }
} finally { await browser?.close(); await s.stop(); }
console.log(`${ids.length} portraits, ${Math.round(bytes / 1024)} KB → ${path.relative(ROOT, OUT)}`);
