#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agent awareness in a real browser (docs/features/awareness.md): on a throwaway server whose agents think with a fake
// model server, on a desktop (1440×900) and a phone (390×844):
//   Studio → Awareness — each of the four choices chosen (and saved: the server says so), what it would be told right
//                        now for each, "Use the default", the keyboard (arrow keys through the choices), its diary;
//   Settings → Agent limits — the 👁 Awareness group (the switch, the default in words);
//   the chat — 📷 Share my view: the button where the world shows, the picture attached like any other, and the run
//              request carrying what it shows (the camera, whose characters are on screen); an answer's
//              "👁 What it knew" opened (and its exact text), in the dark and the light theme, with the cached tokens.
// An answer carries meta.aware once the server's chat keeps it (server/chat/chat.js); on a server without that yet, the
// check says so and draws the panel from a record added to the history this page reads (marked "injected").
// Screenshots: checks/awareness/ (not kept in the repository), or --out DIR. Exit 1 on a failure.
// Usage: node tools/awareness-ui-check.mjs [--out DIR] [desktop] [phone]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(ROOT, 'checks', 'awareness');
const which = new Set(argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--out'));
if (!which.size) { which.add('desktop'); which.add('phone'); }
fs.mkdirSync(OUT, { recursive: true });
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const step = what => console.log(`  · ${what}`);
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); return ok; };
const waitFor = async (fn, ms = 30000, every = 300) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

// ---- a fake model server: answers every chat, says it read a picture when it got one, reports cached tokens
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d; });
  req.on('end', () => {
    const j = b ? JSON.parse(b) : {};
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
    const last = j.messages?.at(-1)?.content, img = Array.isArray(last) && last.some(p => p.type === 'image_url');
    const content = img ? 'I can see your view of the city — the street and the people on it.' : 'Here with you!';
    const usage = { prompt_tokens: 3140, completion_tokens: 87, prompt_tokens_details: { cached_tokens: 2816 } };
    if (!j.stream) { res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ model: 'fake', choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`);
  });
}).listen(0, '127.0.0.1');
await new Promise(r => fake.on('listening', r));

// what an answer's record looks like (docs/features/awareness.md §3) — used only where the server keeps none yet
const SAMPLE_AWARE = {
  mode: 'together', together: 'riding in your car', told: 'full', tokens: 96,
  text: 'You and Owner are together right now: riding in your car.\nWhere: in the passenger seat of a blue hatchback on Harbour Road, heading north at 38 km/h.\nAround you: Owner (driving, beside you).\nThe radio plays City Pop FM.\nIt is 14:20, sunny.',
  looked: [{ tool: 'look', text: 'In the passenger seat of a blue hatchback on Harbour Road, heading north. Owner drives.' }, { tool: 'recent', text: 'Lately: 14:02 got into Owner\'s car; 14:10 heard Owner say "let\'s get coffee".' }],
};

const s = await startServer({ population: 200, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
let browser = null;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'sk-test' } })).json.id;
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) {
    await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' });
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' });
  }
  await owner.post('/api/clock', { rate: 20 });   // (the city moves: its diary fills)
  browser = await launch();

  for (const [name, vp] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    if (!which.has(name)) continue;
    console.log(`— ${name}`);
    const A = name === 'desktop' ? agents[0] : agents[1];
    const ctx = await browser.newContext(vp), page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    // (software WebGL starves the page's main thread: poll on a timer, not on frames — as chat-ui-check does)
    const wff = page.waitForFunction.bind(page);
    page.waitForFunction = (fn, arg, o = {}) => wff(fn, arg, { polling: 150, ...o });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
    const runs = [];
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/providers/runs')) { try { runs.push(JSON.parse(r.postData() || '{}')); } catch { /* not JSON */ } } });
    await page.goto(`${s.url}/?q=low`, { waitUntil: 'load' });
    await page.evaluate(async pw => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }), owner.password);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mvw?.ready, null, { timeout: 180000, polling: 500 });
    await sleep(1500);
    const shot = async (what, sel = null) => {
      if (sel) await page.evaluate(q => document.querySelector(q)?.scrollIntoView({ block: 'start' }), sel);
      await sleep(250);
      await page.screenshot({ path: path.join(OUT, `${name}-${what}.png`) });
    };
    const api = (url, body) => page.evaluate(async ([u, b]) => { const n = await import('/js/core/net.js'); try { return await n.post(u, b); } catch (e) { return { error: e.message }; } }, [url, body]);

    // its owner takes it along: together ("with you")
    const fol = await api('/api/companions', { agent: A.id, action: 'follow', target: 'me' });
    check(fol.ok === true, `${A.name} is taken along (${fol.text || fol.error})`);

    // ---- Studio → Awareness
    step('Studio → Awareness');
    await page.evaluate(id => window.__mvw.studio.open(id, 'awareness'), A.id);
    check(!!(await page.waitForFunction(() => document.querySelector('.studio .sa-modes input'), null, { timeout: 20000 }).catch(() => null)), 'the Studio opens on Awareness');
    const modes = await page.evaluate(() => [...document.querySelectorAll('.sa-mode')].map(l => ({ id: l.querySelector('input').value, text: l.innerText.replace(/\s+/g, ' ').trim() })));
    check(modes.map(m => m.id).join() === 'off,ask,together,always', `the four choices: ${modes.map(m => m.id).join(', ')}`);
    check(modes.filter(m => /\(default\)/.test(m.text)).length === 1 && /\(default\)/.test(modes.find(m => m.id === 'together')?.text || ''), 'the installation default is marked "(default)"');
    check(modes.every(m => m.text.length > m.id.length + 30), 'each choice has its one-line help');
    const WORDS = { off: /Nothing about its surroundings/, ask: /Only the time/, together: /The full picture|One short line/, always: /The full picture/ };
    for (const m of ['off', 'ask', 'together', 'always']) {
      await page.evaluate(id => document.querySelector(`.sa-modes input[value="${id}"]`).click(), m);
      const saved = await waitFor(async () => (await owner.get(`/api/awareness?agent=${A.id}`)).json.own === m, 8000, 200);
      await page.waitForFunction(id => document.querySelector(`.sa-mode.on input[value="${id}"]`) && /You chose this/.test(document.querySelector('.sa-whose')?.textContent || ''), m, { timeout: 8000 }).catch(() => {});
      const st = await page.evaluate(() => ({ words: document.querySelector('.sa-words')?.textContent || '', text: document.querySelector('.sa-text')?.textContent || '', cost: document.querySelector('.sa-cost')?.textContent || '', tog: document.querySelector('.sa-tog')?.textContent || '', def: !!document.querySelector('[data-c="default"]') }));
      check(saved && st.def, `"${m}" is saved, and "Use the default" offered`);
      check(WORDS[m].test(st.words), `${m}: it would be told — ${st.words.slice(0, 70)}`);
      check(m === 'off' || m === 'ask' ? !st.text : st.text.length > 20, `${m}: ${m === 'off' || m === 'ask' ? 'no text with each message' : `the exact text shows (${st.text.length} characters)`}`);
      if (m === 'together') check(/together/i.test(st.tog) || /apart/i.test(st.tog), `together or apart said: ${st.tog}`);
      if (m === 'together') check(/≈ \d+ tokens? a message apart · ≈ \d+ tokens? together/.test(st.cost), `the tokens: ${st.cost}`);
      await shot(`studio-${m}`, name === 'phone' ? '.sa-now' : null);
    }
    // the keyboard: an arrow key moves the choice, and it is saved
    if (name === 'desktop') {
      await page.evaluate(() => document.querySelector('.sa-modes input:checked').focus());
      await page.keyboard.press('ArrowUp');
      const k = await waitFor(async () => (await owner.get(`/api/awareness?agent=${A.id}`)).json.own === 'together', 8000, 200);
      check(!!k && await page.evaluate(() => document.activeElement?.value === 'together'), 'arrow keys move through the choices, saved, the focus kept');
    }
    // back to the default
    await page.evaluate(() => document.querySelector('[data-c="default"]').click());
    const back = await waitFor(async () => (await owner.get(`/api/awareness?agent=${A.id}`)).json.own === null, 8000, 200);
    await page.waitForFunction(() => !document.querySelector('[data-c="default"]'), null, { timeout: 8000 }).catch(() => {});
    check(!!back && /follows this world's default/.test(await page.evaluate(() => document.querySelector('.sa-whose')?.textContent || '')), '"Use the default": back to the default, and said so');
    await shot('studio-default');
    // its diary: lines come as it lives
    const lines = await waitFor(async () => { await page.evaluate(() => document.querySelector('[data-c="diary"]')?.click()); await sleep(600); const n = await page.evaluate(() => document.querySelectorAll('.sa-list li').length); return n > 0 ? n : null; }, 45000, 1500);
    check(!!lines, `its diary lists what it lived (${lines || 0} lines)`);
    const first = await page.evaluate(() => document.querySelector('.sa-list li')?.innerText.replace(/\s+/g, ' ') || '');
    check(!lines || /\d/.test(first), `a diary line has its time: ${first.slice(0, 80)}`);
    await shot('studio-diary', '.sa-diary');
    // a server with awareness switched off: said so
    await owner.post('/api/settings', { values: { 'awareness.enabled': false } });
    await page.evaluate(() => document.querySelector('[data-c="now"]').click());
    const off = await page.waitForFunction(() => /switched off on this server/.test(document.querySelector('.sa-off')?.textContent || ''), null, { timeout: 8000 }).catch(() => null);
    check(!!off, 'switched off on the server: a clear note');
    await page.evaluate(() => { document.querySelector('.studio .st-content').scrollTop = 0; });
    await shot('studio-switched-off');
    await owner.post('/api/settings', { values: { 'awareness.enabled': true } });
    await page.keyboard.press('Escape');
    await sleep(500);

    // ---- Settings → Agent limits: the Awareness group
    step('Settings → Agent limits');
    await page.evaluate(() => { import('/js/ui/settings.js').then(m => m.open(window.__mvw, 'limits')); });
    const grp = await page.waitForFunction(() => document.querySelector('[data-path="awareness.defaultMode"]'), null, { timeout: 20000 }).catch(() => null);
    check(!!grp, 'Settings → Agent limits has the awareness settings');
    const g = await page.evaluate(() => {
      const sel = document.querySelector('select[data-path="awareness.defaultMode"]'), sw = document.querySelector('input[data-path="awareness.enabled"]');
      const head = [...document.querySelectorAll('.tier-head')].map(e => e.textContent).find(t => /Awareness/.test(t)) || '';
      return { head, opts: sel ? [...sel.options].map(o => o.textContent) : [], value: sel?.value, on: sw?.checked };
    });
    check(/👁 Awareness/.test(g.head), `its group: ${g.head.trim()}`);
    check(g.opts.join('|') === 'Off|Only when it asks|When its owner is with it|Always' && g.value === 'together' && g.on === true, `the default in words (${g.opts.join(' / ')}), the switch on`);
    await page.evaluate(() => document.querySelector('[data-path="awareness.enabled"]')?.closest('label, .row, div')?.scrollIntoView({ block: 'center' }));
    await shot('settings-awareness');
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.evaluate(() => document.querySelector('.modal-back .close, .modal-back [aria-label="Close"]')?.click());
    await sleep(300);

    // ---- the chat: 📷 Share my view — playing, the companion beside the person's own character
    step('the chat: Share my view');
    await page.evaluate(() => window.__mvw.setMode?.('play'));
    const me = await waitFor(() => page.evaluate(() => window.__mvw.remote?.me?.pid ?? null), 15000, 300);
    const near = await waitFor(async () => { const c = (await owner.get('/api/companions')).json.companions?.find(x => x.agent === A.id); return c?.state === 'following' ? c : null; }, 45000, 1000);
    console.log(`  · in Play mode it ${near ? 'follows the person\'s character' : 'is not following yet'}`);
    await sleep(4000);
    await page.evaluate(id => window.__mvw.chat.open(id), A.id);
    await page.waitForFunction(() => { const w = document.querySelector('.chatwin'); return w && w.querySelector('.cw-in') && !w.querySelector('.cw-foot.hidden'); }, null, { timeout: 20000 });
    await sleep(600);
    const shotBtn = await page.evaluate(() => { const b = document.querySelector('.chatwin .cw-shot'); return b ? { shown: !b.classList.contains('hidden') && b.getClientRects().length > 0, label: b.getAttribute('aria-label') } : null; });
    check(!!shotBtn?.shown && shotBtn.label === 'Share my view', `📷 Share my view shows in the composer (${JSON.stringify(shotBtn)})`);
    await shot('chat-composer');
    await page.evaluate(() => document.querySelector('.chatwin .cw-shot').click());
    const chip = await page.waitForFunction(() => { const c = document.querySelector('.chatwin .cw-file-chip'); return c && c.querySelector('img') && !c.querySelector('.cw-file-p') ? c.textContent.trim() : null; }, null, { timeout: 20000 }).catch(() => null);
    const chipName = chip ? await chip.jsonValue() : '';
    check(/^my-view-\d{8}-\d{6}\.jpg/.test(chipName), `the picture is attached like any other (${chipName})`);
    const picOk = await page.evaluate(async () => {
      const img = document.querySelector('.chatwin .cw-file-chip img'); if (!img) return null;
      const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data; let lit = 0; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 30) lit++;
      return { w: img.naturalWidth, h: img.naturalHeight, lit };
    });
    check(!!picOk && picOk.w > 300 && picOk.lit > 40, `the picture shows the world (${JSON.stringify(picOk)})`);
    await shot('chat-view-attached');
    await page.fill('.chatwin .cw-in', 'What do you see in my view?');
    await page.evaluate(() => document.querySelector('.chatwin .cw-send').click());
    const sent = await waitFor(() => runs.find(r => r.view), 10000, 200);
    const v = sent?.view;
    check(!!v && ['x', 'y', 'z', 'ctx', 'yaw'].every(k => Number.isFinite(v.cam?.[k])) && Array.isArray(v.visible), `the run request carries what the picture shows (cam ${v ? JSON.stringify(v.cam) : '—'})`);
    check(!!v && v.visible.every(x => (x.kind === 'resident' && Number.isInteger(x.i)) || (x.kind === 'player' && Number.isInteger(x.id))), `whose characters are on screen: ${v ? JSON.stringify(v.visible.slice(0, 6)) : '—'}${v?.visible.length > 6 ? ` … (${v.visible.length})` : ''}`);
    check(!!v && v.visible.some(x => x.kind === 'player' && x.id === me), `the person's own character is among them (player ${me})`);
    console.log(`  · its companion (resident ${A.i}) ${v?.visible.some(x => x.kind === 'resident' && x.i === A.i) ? 'is' : 'is not'} in the frame`);
    check(!!sent && sent.attachments?.length === 1, 'the picture went with that message');
    await page.waitForFunction(() => !document.querySelector('.chatwin .cw-msg.live') && document.querySelector('.chatwin .cw-msg.assistant'), null, { timeout: 30000 }).catch(() => {});
    await sleep(600);
    // a message without a picture carries no view
    await page.fill('.chatwin .cw-in', 'And now?');
    await page.evaluate(() => document.querySelector('.chatwin .cw-send').click());
    await waitFor(() => runs.length >= 2, 8000, 200);
    check(runs.length >= 2 && !runs.at(-1).view, 'a message without a picture carries no view');
    await page.waitForFunction(() => !document.querySelector('.chatwin .cw-msg.live') && document.querySelectorAll('.chatwin .cw-msg.assistant').length >= 2, null, { timeout: 30000 }).catch(() => {});
    await sleep(600);

    // ---- 👁 What it knew (from the history: the answer's own record)
    step('What it knew');
    let real = await page.evaluate(() => !!document.querySelector('.chatwin .cw-aw-b'));
    if (!real) {
      console.log('  · this server keeps no meta.aware yet (server/chat/chat.js): the panel is checked with a record added to the history — injected');
      await page.route('**/api/providers/history?*', async route => {
        const r = await route.fetch(), j = await r.json();
        const as = (j.messages || []).filter(m => m.role === 'assistant');
        for (const m of as) m.meta = { ...(m.meta || {}), aware: m.meta?.aware || SAMPLE_AWARE, cachedIn: Number.isFinite(m.meta?.cachedIn) ? m.meta.cachedIn : 2816 };
        if (as[0]) as[0].meta.aware = { mode: 'off', together: null, told: 'none', text: '', tokens: 0, looked: [] };
        await route.fulfill({ response: r, json: j });
      });
      const sid = await page.evaluate(() => document.querySelector('.chatwin .cw-side .on[data-sid], .chatwin [data-sid].on')?.dataset.sid || null);
      void sid;
      await page.evaluate(id => { window.__mvw.chat.close?.(); return id; }, A.id);
      await sleep(400);
      await page.evaluate(id => window.__mvw.chat.open(id), A.id);
      await page.waitForFunction(() => document.querySelector('.chatwin .cw-aw-b'), null, { timeout: 15000 }).catch(() => {});
    }
    const chips = await page.evaluate(() => [...document.querySelectorAll('.chatwin .cw-aw-b')].map(b => ({ text: b.textContent.trim(), exp: b.getAttribute('aria-expanded'), ctl: !!document.getElementById(b.getAttribute('aria-controls')) })));
    check(chips.length >= 1 && chips.every(c => /What it knew/.test(c.text) && c.exp === 'false' && c.ctl), `${real ? '' : '(injected) '}"👁 What it knew" beside the answers (${chips.length}), closed, each with its panel`);
    // the last answer's, opened from the keyboard
    await page.evaluate(() => {
      // (who cancels the key, said when it fails)
      const pd = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function () { if (this.type === 'keydown' && this.key === 'Enter') window.__pd = new Error().stack.split('\n').slice(1, 4).join(' | '); return pd.call(this); };
      const b = [...document.querySelectorAll('.chatwin .cw-aw-b')].at(-1); b.scrollIntoView({ block: 'center' }); b.focus();
    });
    await page.keyboard.press('Enter');
    await sleep(300);
    const panel = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.chatwin .cw-aw-b')].at(-1), p = document.getElementById(b.getAttribute('aria-controls'));
      return { exp: b.getAttribute('aria-expanded'), shown: !!p && !p.hidden && p.getClientRects().length > 0, text: p?.innerText.replace(/\s+/g, ' ') || '' };
    });
    if (!check(panel.exp === 'true' && panel.shown, 'Enter on the chip opens its panel (aria-expanded true)')) {
      console.log(`    focus: ${await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)}; cancelled by: ${await page.evaluate(() => window.__pd || 'nothing')}`);
      await page.evaluate(() => [...document.querySelectorAll('.chatwin .cw-aw-b')].at(-1).click());   // (opened by a click, for what follows)
    }
    check(/Awareness: (Off|Only when it asks|When it's with me|Always)/.test(panel.text) && /It was told: /.test(panel.text) && /It looked up:/.test(panel.text), `in plain words: ${panel.text.slice(0, 160)}`);
    check(/You were (together: |apart)/.test(panel.text), 'together or apart said');
    await page.evaluate(() => { const p = [...document.querySelectorAll('.chatwin .cw-aw')].at(-1); const d = p?.querySelector('.cw-aw-text'); if (d) d.open = true; p?.scrollIntoView({ block: 'center' }); });
    const pre = await page.evaluate(() => { const e = [...document.querySelectorAll('.chatwin .cw-aw')].at(-1)?.querySelector('.cw-aw-text pre'); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { w: Math.round(r.width), wrap: cs.whiteSpace, mono: /mono/i.test(cs.fontFamily), tok: /≈ \d+ tokens?/.test(e.closest('details').querySelector('summary').textContent) }; });
    check(!pre || (pre.wrap === 'pre-wrap' && pre.mono && pre.tok), `its exact text: monospace, wrapping, with its tokens (${JSON.stringify(pre)})`);
    const meta = await page.evaluate(() => [...document.querySelectorAll('.chatwin .cw-meta')].at(-1)?.textContent || '');
    check(/in \(\d+(\.\d)?k? cached\) · \d+ out/.test(meta), `the cached tokens in what it took: ${meta}`);
    const fit = await page.evaluate(() => { const p = [...document.querySelectorAll('.chatwin .cw-aw')].at(-1), t = document.querySelector('.chatwin .cw-thread'); if (!p) return null; const a = p.getBoundingClientRect(), b = t.getBoundingClientRect(); return { inside: a.left >= b.left - 1 && a.right <= b.right + 1, w: Math.round(a.width) }; });
    check(!!fit?.inside, `the panel fits the chat (${JSON.stringify(fit)})`);
    await shot('chat-what-it-knew');
    // the light theme
    await page.evaluate(() => { import('/js/core/theme.js').then(m => m.apply('light')); });
    await sleep(400);
    await shot('chat-what-it-knew-light');
    await page.evaluate(() => { import('/js/core/theme.js').then(m => m.apply('dark')); });
    // closed again
    await page.evaluate(() => [...document.querySelectorAll('.chatwin .cw-aw-b')].at(-1).click());
    check(await page.evaluate(() => { const b = [...document.querySelectorAll('.chatwin .cw-aw-b')].at(-1); return b.getAttribute('aria-expanded') === 'false' && document.getElementById(b.getAttribute('aria-controls')).hidden; }), 'pressed again, it closes');
    if (!real) await page.unroute('**/api/providers/history?*');

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await ctx.close();
  }
} finally {
  await browser?.close().catch(() => {});
  await s.stop();
  fake.close();
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall good');
console.log(`screenshots: ${OUT}`);
process.exit(fails.length ? 1 : 0);
