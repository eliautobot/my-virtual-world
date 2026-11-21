#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The companions' voice dock in a real browser (docs/features/companions.md §9): it is there without any chat window, the
// four ways to talk are offered (a menu) and one is kept; it is there only with a companion out with you, beside the
// Companions bar — never over it, nor over the top bar — and under the chat windows.
// Usage: node tools/companion-voice-ui-check.mjs [--out DIR] [desktop] [phone]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(ROOT, 'checks', 'companion-voice');
const which = new Set(argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--out'));
if (!which.size) { which.add('desktop'); which.add('phone'); }
fs.mkdirSync(OUT, { recursive: true });
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); return ok; };

const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
    const j = b ? JSON.parse(b) : {};
    const content = 'Here with you.';
    if (!j.stream) { res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] }) + '\n\n');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\ndata: [DONE]\n\n');
  });
}).listen(0, '127.0.0.1');
await new Promise(r => fake.on('listening', r));

const s = await startServer({ population: 120, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
let browser = null;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: 'http://127.0.0.1:' + fake.address().port + '/v1', model: 'fake' }, secrets: { apiKey: 'sk-test' } })).json.id;
  const agents = (await owner.get('/api/agents')).json.agents;
  const agents0Name = () => agents[0].name;
  for (const a of agents) {
    await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' });
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' });
  }
  browser = await launch();
  for (const [name, vp] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    if (!which.has(name)) continue;
    console.log('— ' + name);
    const ctx = await browser.newContext(vp), page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(s.url + '/?q=low', { waitUntil: 'load' });
    await page.evaluate(async pw => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }), owner.password);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 180000, polling: 500 });
    await sleep(1200);
    const api = (url, body) => page.evaluate(async ([u, b]) => { const n = await import('/js/core/net.js'); try { return await n.post(u, b); } catch (e) { return { error: e.message }; } }, [url, body]);
    const dock = await page.waitForFunction(() => document.querySelector('#cv-dock'), null, { timeout: 20000 }).catch(() => null);
    check(!!dock, 'the voice row is on the page without any chat window');
    if (!dock) console.log('    errors: ' + errors.join(' | ').slice(0, 1200));
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#cv-dock')).display === 'none'), 'with nobody out with you it is not there');
    const fol = await api('/api/companions', { agent: agents[0].id, action: 'follow', target: 'me' });
    check(fol && fol.ok === true, 'a companion taken along (' + ((fol && (fol.text || fol.error)) || '') + ')');
    await page.waitForFunction(() => { const d = document.querySelector('#cv-dock'); return d && getComputedStyle(d).display !== 'none' && !d.querySelector('.cv-mic').disabled; }, null, { timeout: 15000 }).catch(() => {});
    check((await page.evaluate(() => document.querySelector('#cv-dock .cv-mic').disabled)) === false, 'with a companion: there, and the button is ready');
    const who = await page.evaluate(() => document.querySelector('#cv-dock .cv-who').textContent || '');
    check(who === agents0Name(), 'it names who is listening: ' + who);
    // (beside the Companions bar, never over it, nor over the top bar; under the chat windows)
    const geo = await page.evaluate(() => {
      const r = el => { const b = el && el.getBoundingClientRect(); return b ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      const top = document.querySelector('#topbar, .topbar, header');
      return { dock: r(document.querySelector('#cv-dock')), party: r(document.querySelector('#party')), top: r(top), z: Number(getComputedStyle(document.querySelector('#cv-dock')).zIndex), vh: innerHeight, vw: innerWidth };
    });
    const over = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    check(!over(geo.dock, geo.party), 'not over the Companions bar: ' + JSON.stringify([geo.dock, geo.party]));
    check(!geo.top || geo.dock.t >= geo.top.b - 1, 'not over the top bar');
    check(geo.dock.b <= geo.vh && geo.dock.r <= geo.vw + 1 && geo.dock.l >= 0, 'on the screen');
    check(geo.z < 7, 'under the chat windows (z ' + geo.z + ')');
    for (const m of ['hold', 'wake', 'live', 'off']) {
      await page.evaluate(() => document.querySelector('#cv-dock .cv-way').click());
      await sleep(200);
      const offered = await page.evaluate(() => [...document.querySelectorAll('.cv-menu [data-mode]')].map(b => b.dataset.mode).join());
      if (m === 'hold') check(offered === 'off,hold,wake,live', 'the four ways, in a menu: ' + offered);
      await page.evaluate(id => document.querySelector('.cv-menu [data-mode="' + id + '"]').click(), m);
      await sleep(350);
      const st = await page.evaluate(() => ({ way: document.querySelector('#cv-dock .cv-way').textContent, saved: localStorage.getItem('mvw.cv.mode'), menu: !!document.querySelector('.cv-menu') }));
      check(st.saved === m && st.way.toLowerCase().startsWith(m) && !st.menu, 'way ' + m + ' chosen and kept (' + st.way + ')');
    }
    await page.screenshot({ path: path.join(OUT, name + '-row.png') });
    // (let it go: the next pass starts with nobody out with you)
    const off = await api('/api/companions', { agent: agents[0].id, action: 'dismiss' });
    check(off && off.ok === true, 'the companion let go');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#cv-dock')).display === 'none', null, { timeout: 15000 }).catch(() => {});
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#cv-dock')).display === 'none'), 'nobody out with you again: it is gone');
    check(errors.length === 0, errors.length ? 'page errors: ' + errors.slice(0, 2).join(' | ') : 'no page or console errors');
    await ctx.close();
  }
} finally {
  try { await browser?.close(); } catch { }
  await s?.stop(); fake.close();
}
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall checks passed');
