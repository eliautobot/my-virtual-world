// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Read-only browser check of a Next address in real Chrome.
// Reports: HTTP status, secure context, whether the microphone API exists, WebSocket traffic, console errors,
// failed requests; optional screenshot. It only views the world and never sends edits.
// Usage: node tools/securecheck.cjs <url> [screenshot.png]
// Browser: tools/lib/browser.cjs (Chrome channel or MVW_TEST_BROWSER; sandbox on; no security-weakening flags).
'use strict';
const { launch } = require('./lib/browser.cjs');

(async () => {
  const [url, shot] = process.argv.slice(2);
  if (!url) { console.error('usage: node tools/securecheck.cjs <url> [screenshot.png]'); process.exit(2); }
  const browser = await launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
    const errors = [], failed = [], sockets = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    page.on('requestfailed', r => failed.push(`${r.url().slice(0, 120)} ${r.failure()?.errorText || ''}`));
    page.on('websocket', ws => {
      const s = { url: ws.url(), framesIn: 0, closed: false };
      sockets.push(s);
      ws.on('framereceived', () => { s.framesIn++; });
      ws.on('close', () => { s.closed = true; });
    });
    let status = null;
    try {
      const res = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      status = res ? res.status() : null;
    } catch (e) {
      status = `ERROR ${e.message.split('\n')[0]}`;
    }
    let info = null;
    if (typeof status === 'number') {
      await page.waitForTimeout(5000);
      info = await page.evaluate(() => ({
        protocol: location.protocol,
        isSecureContext: window.isSecureContext,
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        canvas: !!document.querySelector('canvas'),
      }));
      if (shot) await page.screenshot({ path: shot });
    }
    console.log(JSON.stringify({ url, status, info, sockets, errors: errors.slice(0, 8), failed: failed.slice(0, 8) }));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('securecheck failed:', e.message); process.exit(1); });
