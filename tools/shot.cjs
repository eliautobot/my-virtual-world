// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Real-GPU screenshot of a page: node tools/shot.cjs <url> <out.png> [waitMs] [width] [height] [evalJS]
// It only views the page, unless evalJS changes something.
// Browser: tools/lib/browser.cjs (Chrome channel or MVW_TEST_BROWSER; sandbox on; no security-weakening flags).
'use strict';
const { launch, gpuInfo } = require('./lib/browser.cjs');

(async () => {
  const [url, out, wait = '4000', w = '1400', h = '860', js = ''] = process.argv.slice(2);
  if (!url || !out) {
    console.error('usage: node tools/shot.cjs <url> <out.png> [waitMs] [width] [height] [evalJS]');
    process.exit(2);
  }
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const logs = [];
    p.on('console', m => { if (['error', 'warning'].includes(m.type()) || /\[mvw\]/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)); });
    p.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message).slice(0, 600)));
    await p.goto(url, { waitUntil: 'load', timeout: 30000 });
    await p.waitForTimeout(+wait);
    if (js) {
      try {
        const r = await p.evaluate(js);
        if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
      } catch (e) { console.log('eval error', e.message); }
      await p.waitForTimeout(800);
    }
    await p.screenshot({ path: out });
    console.log(`GPU: ${await gpuInfo(p)}`);
    console.log(logs.slice(0, 30).join('\n') || '(no console errors)');
  } finally {
    await b.close();
  }
})().catch(e => { console.error('SHOT ERR', e.message); process.exit(1); });
