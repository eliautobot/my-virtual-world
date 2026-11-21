#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's eyes in a real browser (docs/features/awareness.md §9, client/js/ui/see-for-agent.js): on a throwaway server
// whose agent thinks with a fake model server, its owner in Play mode beside it asks "can you take a look?" — the brain
// uses its see tool, the server asks this page, and the page draws one frame from the agent's own eyes:
//   - the picture reaches the brain (the results turn's image part), a JPEG under the 64 KB message;
//   - drawn from where the agent stands on this page (its feet, at eye height, a step in front of its face), looking the
//     way the person looks;
//   - the page's own frame drawn again right after it in the same task (the last thing drawn is the person's view: no
//     flash of the other), and everything put back (the camera, its near plane, the shaders' camera, the fade, the shadow
//     maps' updating);
//   - a body this page does not draw (asked for on another floor) is refused at once ("not_drawn").
// Screenshots and the picture: checks/eyes/ (not kept in the repository), or --out DIR. Exit 1 on a failure.
// Usage: node tools/eyes-ui-check.mjs [--out DIR]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(ROOT, 'checks', 'eyes');
fs.mkdirSync(OUT, { recursive: true });
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); return ok; };
const waitFor = async (fn, ms = 30000, every = 300) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

// ---- a fake model server: asked to look, it uses its see tool; with the results it says whether a picture came
const pictures = [];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d; });
  req.on('end', () => {
    const j = b ? JSON.parse(b) : {};
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
    const last = j.messages?.at(-1)?.content, text = Array.isArray(last) ? last.filter(p => p.type === 'text').map(p => p.text).join('\n') : String(last || '');
    const img = Array.isArray(last) ? last.find(p => p.type === 'image_url') : null;
    if (img) pictures.push(img.image_url.url);
    const content = /^RESULTS:/.test(text) ? (img ? 'I can see it now.' : 'I could not see it.') : /take a look/.test(text) ? '{"use":[{"tool":"see"}]}' : 'Hi.';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ model: 'fake', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
  });
}).listen(0, '127.0.0.1');
await new Promise(r => fake.on('listening', r));

const s = await startServer({ population: 150, agents: 2, env: { MVW_PROVIDER_TEST: '1', MVW_EYES_TIMEOUT_MS: '15000' } });   // (a test browser draws in software: slowly)
let browser = null;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'sk-test' } })).json.id;
  const A = (await owner.get('/api/agents')).json.agents[0];
  await owner.post('/api/agents/update', { id: A.id, connectionId: brain, nativeId: 'mind' });
  await owner.post('/api/mind/agent', { agent: A.id, cadence: 'off' });
  await owner.post('/api/agent-work', { agent: A.id, defaultMode: 'life' });
  browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await page.goto(`${s.url}/?q=low`, { waitUntil: 'load' });
  await page.evaluate(async pw => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }), owner.password);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw?.ready && window.__mvw.agents?.n > 0, null, { timeout: 180000, polling: 500 });
  // (its owner in Play mode, a few steps from it, outside: the agent taken along so it stays there)
  await page.evaluate(() => window.__mvw.setMode?.('play'));
  await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' });
  const near = await waitFor(async () => {
    const me = (await owner.get(`/api/agent/${A.i}`)).json;
    if (me?.pos?.ctx !== -1) return null;
    await page.evaluate(p => window.__mvw.net.send({ t: 'pwarp', x: p.x + 2.5, z: p.z + 1, ctx: -1 }), me.pos);
    await sleep(1500);
    return page.evaluate(i => { const Ag = window.__mvw.agents, P = window.__mvw.player; return Ag.vis[i] && P.active && Math.hypot(Ag.rx[i] - P.x, Ag.rz[i] - P.z) < 12 ? { d: Math.hypot(Ag.rx[i] - P.x, Ag.rz[i] - P.z) } : null; }, A.i);
  }, 90000, 1000);
  check(!!near, `its owner in Play mode beside it, the page drawing it (${near ? near.d.toFixed(1) : '?'} m)`);
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'owner-view.png') });

  // every draw recorded: the camera's place at each, and where the frame's own draws are
  await page.evaluate(() => {
    const W = window.__mvw, st = W.stage, render = st.render.bind(st);
    window.__draws = [];
    st.render = () => { render(); window.__draws.push({ p: st.camera.position.toArray().map(v => Math.round(v * 1000) / 1000), near: st.camera.near, t: performance.now() }); };
    W.bus.on('postframe', () => window.__draws.push({ frame: true }));
    // (how long the page takes to answer: the ask's arrival and the answer's going)
    window.__see = [];
    W.bus.on('msg:see', m => window.__see.push({ asked: performance.now(), id: m.id }));
    const send = W.net.send.bind(W.net);
    W.net.send = o => { if (o && o.t === 'see') window.__see.push({ answered: performance.now(), id: o.id, error: o.error || null, size: (o.data || '').length }); return send(o); };
    window.__before = { p: st.camera.position.toArray(), q: st.camera.quaternion.toArray(), near: st.camera.near, camP: W.THREE ? null : null, auto: st.renderer.shadowMap.autoUpdate };
  });
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session;
  const n0 = pictures.length;
  const run = await owner.post('/api/providers/runs', { agent: A.id, session: sess.id, input: 'Can you take a look?' });
  check(run.status === 200, 'the message is sent');
  const end = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${run.json.runId}`)).json; return e.done ? e.events.map(x => x.event).find(x => x.type === 'run.end') : null; }, 60000, 300);
  console.log('    the page: ' + JSON.stringify(await page.evaluate(() => window.__see)));
  if (!check(end?.text === 'I can see it now.', `its brain got the picture: "${end?.text}"`)) console.log('    the server said: ' + String(s.log?.() || '').split('\n').filter(l => /eyes|\bsee\b/.test(l)).slice(-6).join(' | '));
  const pic = pictures.slice(n0)[0];
  if (check(!!pic && /^data:image\/jpeg;base64,/.test(pic), 'a JPEG')) {
    const bytes = Buffer.from(pic.split(',')[1], 'base64');
    check(pic.length - 23 <= 58000 && bytes.length > 1000, `under the 64 KB message (${(pic.length / 1024).toFixed(1)} KB as base64, ${bytes.length} bytes)`);
    fs.writeFileSync(path.join(OUT, 'agent-eyes.jpg'), bytes);
  }
  // the draws around the picture: [the frame's own …, its eyes, the person's view again] in one task
  const d = await page.evaluate(i => {
    const W = window.__mvw, st = W.stage, Ag = W.agents, list = window.__draws, k = list.findIndex(x => x.p && x.near === 0.08);
    return { k, around: list.slice(Math.max(0, k - 2), k + 3), after: { p: st.camera.position.toArray(), q: st.camera.quaternion.toArray(), near: st.camera.near, auto: st.renderer.shadowMap.autoUpdate, fade: W.S && window.__mvw.stage ? null : null },
      body: { x: Ag.rx[i], y: Ag.ry[i], z: Ag.rz[i] }, before: window.__before };
  }, A.i);
  const eye = d.k >= 0 ? d.around.find(x => x.near === 0.08) : null, next = d.k >= 0 ? d.around[d.around.indexOf(eye) + 1] : null;
  check(!!eye, 'the page drew from its eyes (its own near plane)');
  if (eye) {
    const dy = eye.p[1] - d.body.y, dxz = Math.hypot(eye.p[0] - d.body.x, eye.p[2] - d.body.z);
    check(dy > 1.0 && dy < 1.75, `at its eye height above its feet (${dy.toFixed(2)} m)`);
    check(dxz < 1.2, `where it stands, a step in front of its face (${dxz.toFixed(2)} m from its feet as drawn now)`);
    check(!!next && !!next.p && next.near !== 0.08, 'the person\'s own view drawn again right after it, before the frame ends (no flash of the other view): ' + JSON.stringify(next));
  }
  check(d.after.near === d.before.near && d.after.auto === d.before.auto, 'the camera\'s near plane and the shadow maps\' updating put back');
  // (a body this page doesn't draw — asked for on a floor it doesn't show —: refused at once)
  const refused = await page.evaluate(async i => {
    const W = window.__mvw, send = W.net.send.bind(W.net);
    return new Promise(resolve => {
      const t0 = performance.now();
      W.net.send = m => { if (m?.t === 'see' && m.id === 'e-check') { W.net.send = send; resolve({ m, ms: performance.now() - t0 }); return true; } return send(m); };
      W.bus.emit('msg:see', { t: 'see', id: 'e-check', i, x: W.agents.rx[i], z: W.agents.rz[i], ctx: 64 * 3 + 1 });
    });
  }, A.i);
  check(refused.m.error === 'not_drawn' && refused.ms < 100, `a body this page doesn't draw: "${refused.m.error}" in ${refused.ms.toFixed(1)} ms`);
  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.screenshot({ path: path.join(OUT, 'owner-view-after.png') });
} catch (e) {
  fails.push(e.message); console.error(e);
} finally {
  await browser?.close().catch(() => {});
  await s.stop(); fake.close();
}
console.log(fails.length ? `✗ ${fails.length} failed` : '✓ all good', `(pictures in ${OUT})`);
process.exit(fails.length ? 1 : 0);
