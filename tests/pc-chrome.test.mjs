// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The built-in browser itself (server/pc/chrome.js), with the real Chrome of this machine (skipped without one): it
// starts by itself, every page goes through its egress proxy (this machine's own pages refused, its loopback included),
// each agent's context keeps its cookies to itself, and it stops cleanly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LocalChrome, findChrome } from '../server/pc/chrome.js';
import { CdpPage } from '../server/pc/browser.js';
import { resolvePublic } from '../server/pc/egress-proxy.js';

const exe = findChrome();
test('the built-in Chrome: the proxy for everything, an agent\'s cookies its own', { skip: !exe && 'no Chrome on this machine' }, async () => {
  // (a site that sets a cookie and says which it got; "site.test" stands for a public site and lives on this machine)
  const site = http.createServer((q, r) => { if (q.url === '/set') r.setHeader('set-cookie', 'who=agent1; Path=/'); r.setHeader('content-type', 'text/html'); r.end(`<title>t</title><p id=c>cookie:${q.headers.cookie || 'none'}</p>`); });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const port = site.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-chrome-'));
  const lc = new LocalChrome({ dir, exe, resolve: async h => (h === 'site.test' ? { address: '127.0.0.1', family: 4 } : resolvePublic(h)) });
  const pages = [];
  try {
    const endpoint = await lc.ensure();
    assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);
    const open = async agent => { const p = await new CdpPage(endpoint, { allowPrivate: true, context: await lc.contextFor(agent), ua: lc.ua }).open(); pages.push(p); return p; };
    const a = await open(1), b = await open(2);
    assert.notEqual(lc.contexts.get(1), lc.contexts.get(2));
    await a.navigate(`http://site.test:${port}/set`);
    await a.navigate(`http://site.test:${port}/`);
    assert.equal(await a.eval('document.getElementById("c").textContent'), 'cookie:who=agent1', 'agent 1 keeps its cookie');
    await b.navigate(`http://site.test:${port}/`);
    assert.equal(await b.eval('document.getElementById("c").textContent'), 'cookie:none', 'agent 2 never sees it');
    // this machine by its own number: refused by the proxy (the page is the proxy's refusal, never the site)
    await b.navigate(`http://127.0.0.1:${port}/`).catch(() => {});
    assert.equal(await b.eval('document.body.innerText.includes("cookie:")'), false);
    assert.ok(lc.proxy.refused >= 1);
    assert.ok(!/HeadlessChrome/.test(await a.eval('navigator.userAgent')), 'it says it is Chrome');
    // its live picture: frames while watched
    const f = await a.nextFrame(0, 5000);
    assert.ok(f && f.jpeg[0] === 0xff && f.w === 1280, 'a live picture comes');
  } finally {
    for (const p of pages) p.close();
    await lc.close(); site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
