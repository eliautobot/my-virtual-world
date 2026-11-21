#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A phone's chat window is not only full screen (docs/features/CHAT.md §12): it floats, it is sized from its edges and
// corners, full screen is one press away, and the size it was given comes back with the page.
// Usage: node tools/chat-window-size-check.mjs [--out DIR]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(ROOT, 'checks', 'chat-size');
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
  for (const a of agents) {
    await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' });
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' });
  }
  browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(s.url + '/?q=low', { waitUntil: 'load' });
  await page.evaluate(async pw => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }), owner.password);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 180000, polling: 500 });
  await sleep(1200);
  await page.evaluate(id => window.__mvw.chat.open(id), agents[0].id);
  const win = await page.waitForFunction(() => document.querySelector('.chat-back.floating .chatwin'), null, { timeout: 20000 }).catch(() => null);
  check(!!win, 'a chat on a phone opens as a floating window, not the whole screen');
  const settle = () => page.waitForFunction(() => { const w = document.querySelector('.chat-back.front .chatwin') || document.querySelector('.chatwin'); return w && !w.getAnimations().length; }, null, { timeout: 10000, polling: 100 }).catch(() => {});
  const box = async () => { await settle(); return page.evaluate(() => { const back = document.querySelector('.chat-back.front') || [...document.querySelectorAll('.chat-back')].filter(b => b.offsetParent).at(-1); const w = back ? back.querySelector('.chatwin') : null; const r = w.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, floats: back.classList.contains('floating'), modal: back.classList.contains('modal-back'), n: document.querySelectorAll('.chat-back').length }; }); };
  const b0 = await box();
  check(b0.floats && !b0.modal, 'floating (not full screen)');
  check(b0.h < b0.vh - 120 && b0.w >= b0.vw - 16 && b0.w <= b0.vw + 1 && b0.y > 40, 'the whole width, and the world and the top bar still in view: ' + Math.round(b0.w) + '×' + Math.round(b0.h) + ' at y ' + Math.round(b0.y));
  check(await page.evaluate(() => !document.querySelector('.cw-max').classList.contains('hidden')), 'the full-screen button is offered');
  await page.evaluate(() => document.querySelector('.cw-max').click());
  await sleep(400);
  const b1 = await box();
  check(b1.modal && b1.h > b1.vh - 120 && b1.w >= b1.vw - 2, 'one press: full screen');
  await page.evaluate(() => document.querySelector('.cw-max').click());
  await sleep(400);
  const b2 = await box();
  const why = await page.evaluate(() => { const el = document.querySelector('.chatwin'); return { inline: el.getAttribute('style'), place: localStorage.getItem('mvw.chat.place'), choice: localStorage.getItem('mvw.chat.mode') }; });
  check(b2.floats && b2.h < b2.vh - 120, 'and back to a window: ' + JSON.stringify(b2) + ' ' + JSON.stringify(why));
  // sized from its corner: the south-east grip, dragged in and up
  const g = await page.evaluate(() => { const r = document.querySelector('.cw-grip.se').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x - 60, g.y - 90, { steps: 8 });
  await page.mouse.up();
  await sleep(350);
  const b3 = await box();
  check(b3.w <= Math.max(340, b2.w - 60) + 2 && b3.w < b2.w - 20 && b3.h <= Math.max(380, b2.h - 90) + 2 && b3.h < b2.h - 20, 'dragged from its corner: smaller, down to the least size (' + Math.round(b3.w) + '×' + Math.round(b3.h) + ')');
  await page.screenshot({ path: path.join(OUT, 'phone-window.png') });
  // the size is kept for next time
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 180000, polling: 500 });
  await sleep(1500);
  await page.evaluate(id => window.__mvw.chat.open(id), agents[0].id);
  await page.waitForFunction(() => document.querySelector('.chat-back.floating .chatwin'), null, { timeout: 20000 }).catch(() => {});
  await sleep(500);
  const b4 = await box();
  check(b4.floats && Math.abs(b4.w - b3.w) < 24 && Math.abs(b4.h - b3.h) < 24, 'the size it was given comes back: ' + Math.round(b4.w) + '×' + Math.round(b4.h));
  await page.screenshot({ path: path.join(OUT, 'phone-window-kept.png') });
  check(errors.length === 0, errors.length ? 'page errors: ' + errors.slice(0, 2).join(' | ') : 'no page or console errors');
  await ctx.close();
} finally {
  try { await browser?.close(); } catch { }
  await s?.stop(); fake.close();
}
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall checks passed');
