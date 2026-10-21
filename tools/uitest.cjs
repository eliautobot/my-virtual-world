// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Real-GPU end-to-end UI test: drives the app with the mouse and keyboard through explore, name tags, inspector, follow,
// customizer, furnish, build, new resident, play mode (walk, doors, elevator, sit, jump), night, low quality and the
// phone layout, and prints PASS / FAIL / SKIP lines. Accounts: the guest view, sign-in with a forced password change,
// a session revoked while in use, and requiring sign-in to watch. Settings (WP1.5): tiers, owner-only settings,
// display preferences that follow the account to a second device, and no secret in any answer, frame or log.
// It EDITS THE WORLD and moves the server clock to a weekday afternoon, so by default it starts its own throwaway
// server (free port, temporary data folder) and stops it afterwards. A server that reports a production release
// (live) is refused unless ALLOW_LIVE=1.
// Usage: node tools/uitest.cjs [--url <base>] [--data <data folder to copy>] [--root <code folder>]
//                              [--population <n>] [--out <screenshot dir>] [--report <results.json>]
// Browser: tools/lib/browser.cjs (Chrome channel or MVW_TEST_BROWSER; sandbox on; no security-weakening flags).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { launch, gpuInfo, isSoftware } = require('./lib/browser.cjs');
const { probeFacadeSeeds } = require('./lib/facadecheck.cjs');

(async () => {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' }, data: { type: 'string' }, root: { type: 'string' },
      population: { type: 'string', default: '4000' }, out: { type: 'string' }, report: { type: 'string' },
      'redistribute-population': { type: 'boolean', default: false },
    },
  });
  let base = o.url || positionals[0] || null;
  const out = o.out || positionals[1] || path.join(os.tmpdir(), 'mvw-uitest');
  fs.mkdirSync(out, { recursive: true });
  let server = null;
  if (o['redistribute-population'] && (base || !o.data)) throw new Error('population rehearsal requires a disposable copy from --data, never --url');
  if (!base) {
    const { startServer, tempDir, copyData } = await import('./lib/testserver.mjs');
    let copyFrom = o.data ? path.resolve(o.data) : null;
    let rehearsal = null;
    try {
      if (copyFrom) {
        rehearsal = o['redistribute-population'] ? tempDir('mvw-population-rehearsal-') : tempDir('mvw-ui-world-rehearsal-');
        copyData(copyFrom, rehearsal);
        const { detachWorldOnlyConnectedMarkers } = await import('./lib/ui-world-rehearsal.mjs');
        const importedResidents = JSON.parse(fs.readFileSync(path.join(rehearsal, 'people.json'), 'utf8'));
        const detached = detachWorldOnlyConnectedMarkers(importedResidents);
        const residents = detached.people;
        if (detached.detached) {
          fs.writeFileSync(path.join(rehearsal, 'people.json'), JSON.stringify(detached.people));
          console.log(`world-only rehearsal: ${detached.detached} connected markers detached from copied residents; no residents or unrelated fields dropped, no slot/account credentials copied`);
        }
        if (o['redistribute-population']) {
          const { redistributePopulation } = await import('./population-roster.mjs');
          const rerolled = redistributePopulation(residents);
          fs.writeFileSync(path.join(rehearsal, 'people.json'), JSON.stringify(rerolled.people));
          console.log(`population rehearsal: ${rerolled.counts.after.active} residents across ${Object.values(rerolled.counts.after.byCharacter).filter(n => n > 0).length} models; preserved fields ${rerolled.proof.onlyAllowedFieldsChanged}`);
        }
        copyFrom = rehearsal;
      }
      server = await startServer({
        root: o.root ? path.resolve(o.root) : undefined, copyFrom,
        population: +o.population || 4000, timeoutMs: 60000,
      });
    } finally { if (rehearsal) fs.rmSync(rehearsal, { recursive: true, force: true }); }
    base = server.url;
    console.log(`throwaway server ${base} (data ${server.data}; ${o.data ? 'copied from ' + o.data : 'new city'})`);
  } else {
    const h = await (await fetch(new URL('/api/health', base))).json();
    if (h.release && h.release.channel === 'release' && !process.env.ALLOW_LIVE) {
      console.error(`Refusing to run edit tests against a production release (${h.release.tag}). Use staging or a throwaway server, or set ALLOW_LIVE=1.`);
      process.exit(2);
    }
  }
  // Accounts. On a throwaway server the owner (signed in here, outside the browser) creates an admin with a temporary
  // password; the browser signs in with it and replaces it in the dialog. With --url, MVW_UITEST_LOGIN and
  // MVW_UITEST_PASSWORD name an admin or owner account (never printed), used by the browser and by these helpers.
  const T = await import('./lib/testserver.mjs');
  const { closeAccountTestPage } = await import('./lib/ui-account-cleanup.mjs');
  let api, ui;
  if (server) {
    api = await T.ownerSession(server);
    const u = await api.post('/api/users', { login: 'uitest', displayName: 'UI Test', role: 'admin' });
    if (u.status !== 201) throw new Error(`creating the test admin failed: ${u.status} ${u.text}`);
    ui = { login: 'uitest', password: u.json.temporaryPassword, temporary: true, next: T.strongPassword() };
  } else {
    if (!process.env.MVW_UITEST_LOGIN || !process.env.MVW_UITEST_PASSWORD) {
      console.error('With --url, set MVW_UITEST_LOGIN and MVW_UITEST_PASSWORD to an admin or owner account of that server.');
      process.exit(2);
    }
    ui = { login: process.env.MVW_UITEST_LOGIN, password: process.env.MVW_UITEST_PASSWORD, temporary: false };
    api = T.httpClient(base);
    await api.signIn(ui.login, ui.password);
  }

  const browser = await launch();
  const results = [], errors = [], documentChanges = [];
  let gpu = '';
  const check = (name, ok, info) => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' - ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`);
  };
  const skip = (name, why) => { results.push({ name, ok: true, skipped: true }); console.log(`SKIP ${name} - ${why}`); };
  // API answers of 400 and above count as errors unless the current step expects them (allowHttp); the browser's own
  // "Failed to load resource" console lines for 4xx answers are left to this check.
  let allowHttp = [];
  let curStep = '(setup)';   // named in [http] errors, so an unexpected answer can be traced to its step
  const net = [];
  let capturing = false;
  const newPage = async (vp, extra = {}) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, ...extra });
    const pg = await ctx.newPage();
    pg.on('framenavigated', frame => {
      if (frame === pg.mainFrame()) {
        try { documentChanges.push({ step: curStep, path: new URL(frame.url()).pathname }); } catch { /* initial blank */ }
      }
    });
    pg.on('console', m => { if (m.type() === 'error' && !/favicon|^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    pg.on('response', r => {
      let u;
      try { u = new URL(r.url()); } catch { return; }
      if (!u.pathname.startsWith('/api/') || r.status() < 400) return;
      const m = r.request().method();
      if (!allowHttp.some(a => a.method === m && (a.path === u.pathname || a.path === '*') && a.status === r.status())) errors.push(`[http] ${m} ${u.pathname} answered ${r.status()} (step: ${curStep}${pg === p ? '' : ', a second page'})`);
    });
    // Network capture for the secret checks (I14.16): /api answers and live-stream text frames, once capturing is on.
    pg.on('response', r => {
      if (!capturing) return;
      let u;
      try { u = new URL(r.url()); } catch { return; }
      if (!u.pathname.startsWith('/api/')) return;
      const entry = { method: r.request().method(), path: u.pathname, t: '' };
      net.push(entry);
      r.text().then(t => { entry.t = t; }, () => {});
    });
    pg.on('websocket', ws => ws.on('framereceived', f => { if (capturing && typeof f.payload === 'string') net.push({ method: 'WS', path: '/ws', t: f.payload }); }));
    pg.on('pageerror', e => errors.push('[pageerror] ' + (e.stack || e.message).slice(0, 500)));
    return pg;
  };
  const clockTo = async hour => {      // the next weekday at `hour` on the server under test
    let c = null;
    for (let k = 0; k < 4; k++) {
      const r = await api.post('/api/clock', { skip: hour });
      if (r.status !== 200) throw new Error(`setting the clock failed: ${r.status} ${r.text}`);
      c = r.json;
      if (!['Sat', 'Sun'].includes(c.weekday)) break;
    }
    return c;
  };
  let p = await newPage({ width: 1400, height: 860 });
  const wait = ms => p.waitForTimeout(ms);
  const ev = (fn, arg) => p.evaluate(fn, arg);
  const shot = n => p.screenshot({ path: `${out}/${n}.png` });
  const until = async (fn, arg, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch { /* navigating */ } await wait(120); } return false; };
  const helpers = () => {
    const A = window.__mvw;
    window.__t = {
      proj(x, y, z) {
        const v = new A.THREE.Vector3(x, y, z).project(A.stage.camera), r = A.stage.renderer.domElement.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z };
      },
      free(pt) { return pt.z < 1 && pt.x > 300 && pt.x < 1060 && pt.y > 90 && pt.y < 540; },
    };
    return true;
  };
  const step = async (name, fn) => {
    curStep = name;
    try {
      if (name === 'furnish' || name === 'build') {
        if (!await until(() => window.__mvw?.ready && window.__mvw?.stage)) throw new Error('current document not app-ready');
        if (!await ev(() => typeof window.__t?.proj === 'function')) {
          await ev(helpers);
          console.log(`Recovered projection helper in current document before ${name}; document changes: ${documentChanges.length}`);
        }
      }
      await fn();
    } catch (e) {
      // Playwright's message carries a call log (what it waited for, what covered the target): keep it, and a picture.
      check(name + ' (threw)', false, e.message.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 14).join(' | ').slice(0, 1400));
      await p.screenshot({ path: `${out}/fail-${name.replace(/[^a-z0-9]+/gi, '-')}.png` }).catch(() => {});
    }
  };
  /** Runs a browser action and names it when it fails. */
  const act = async (label, promise) => { try { return await promise; } catch (e) { throw new Error(`${label}: ${e.message.split('\n')[0]}`); } };

  try {
    // -------------------------------------------------------------- boot
    await step('boot', async () => {
      const c = await clockTo(14);
      console.log(`server clock: ${c.weekday} ${c.hour.toFixed(2)}`);
      await p.goto(`${base}/?hour=14&cam=78,1.5,60,0.55,0.95`, { waitUntil: 'load', timeout: 30000 });
      gpu = await gpuInfo(p);
      console.log(`GPU: ${gpu}${isSoftware(gpu) ? '  (software rendering: fps results are not meaningful)' : ''}`);
      check('app ready', await until(() => window.__mvw && window.__mvw.ready && document.querySelector('#topbar') && window.__mvw.player, null, 25000));
      await ev(helpers);
      await wait(2500);
      const s = await ev(() => ({
        rows: document.querySelectorAll('#roster .agent-row').length, agents: __mvw.S.people.filter(q => q && q.v).length,
        people: __mvw.S.people.length, plans: __mvw.net.plans.filter(Boolean).length, fps: Math.round(__mvw.fps),
        cars: __mvw.traffic.count(), clock: document.querySelector('#clock .t').textContent,
      }));
      check('roster lists every connected agent', s.rows === s.agents, { rows: s.rows, agents: s.agents });
      const { activePlanCoverage } = await import('./lib/ui-world-rehearsal.mjs');
      const coverage = await p.evaluate(activePlanCoverage);
      check('plans received for every active resident', coverage.active > 0 && coverage.missing.length === 0, coverage);
      check('traffic running', s.cars > 20, s.cars);
      check('clock shown', /\d:\d\d [AP]M/.test(s.clock), s.clock);
      await shot('01-boot');
    });

    // The exact per-face metadata must keep each procedural window uniform on the GPU, not just in source.
    await step('facade seeds (high)', async () => {
      const s = await probeFacadeSeeds(p);
      check('High: facade window seeds are uniform across each pane', s.quality === 'high' && s.cases === 96 && s.failed.length === 0 && s.badPrograms === 0, s);
    });

    // -------------------------------------------------------------- accounts: guest view, sign-in, forced password change
    await step('guest view', async () => {
      const s = await ev(() => ({
        signin: !!document.querySelector('#acct .signin'), role: __mvw.auth.me && __mvw.auth.me.role,
        left: !!document.querySelector('#dockL .dsec[data-sec="buildings"]'), leftHidden: document.querySelector('#dockL')?.classList.contains('hidden'),
        rightHidden: document.querySelector('#dockR').classList.contains('hidden'), sections: document.querySelectorAll('#dockR .dsec').length,
        speed: +getComputedStyle(document.querySelector('#speed')).opacity,
      }));
      check('a guest sees the Sign in button', s.signin && s.role === 'guest', s);
      check('a guest sees no edit dock, but the whole info dock (I3.3)', s.left === true && s.leftHidden === true && s.rightHidden === false && s.sections === 7, s);
      check('a guest cannot change the clock', s.speed < 1, s);
      await p.keyboard.press('Digit3');
      await wait(200);
      check('the build shortcut does nothing for a guest', await ev(() => __mvw.S.mode === 'explore'));
    });
    await step('sign in', async () => {
      allowHttp = [{ method: 'POST', path: '/api/auth/signin', status: 401 }];   // the deliberate wrong password
      // Open the dialog and go straight to the password box, as a fast typist does: the dialog's own delayed focus of
      // the first field must not pull the password into the username (the WP1.10 rehearsal's failure).
      await ev(() => { document.querySelector('#acct .signin').click(); document.querySelector('.auth-back .pw').focus(); });
      check('Sign in opens the dialog', await until(() => !!document.querySelector('.auth-back .modal.auth .login')));
      await wait(150);
      check('a field the person is already in keeps the focus (the dialog does not steal it)', await ev(() => document.activeElement === document.querySelector('.auth-back .pw')),
        await ev(() => document.activeElement && document.activeElement.className));
      await p.fill('.auth-back .login', ui.login);
      await p.fill('.auth-back .pw', 'Wrong-Password-00');
      await p.click('.auth-back .go');
      check('a wrong password is refused in the dialog', await until(() => { const e = document.querySelector('.auth-back .err'); return e && !e.classList.contains('hidden') && /Wrong/.test(e.textContent); }),
        await ev(() => document.querySelector('.auth-back .err')?.textContent));
      await p.fill('.auth-back .pw', ui.password);
      await p.click('.auth-back .go');
      if (ui.temporary) {
        check('a temporary password leads to choosing a new one', await until(() => /Choose your password/.test(document.querySelector('.auth-back h3')?.textContent || '')));
        await shot('01b-choose-password');
        check('the temporary password is not asked for twice', !(await p.isVisible('.auth-back .cur')));
        if (await p.isVisible('.auth-back .cur')) await p.fill('.auth-back .cur', ui.password);
        await p.fill('.auth-back .npw', ui.next);
        await p.fill('.auth-back .npw2', ui.next);
        await p.click('.auth-back .go');
        ui.password = ui.next;
      }
      check('signed in: the account chip shows the display name', await until(() => !document.querySelector('.auth-back') && !!document.querySelector('#acct .me .nm')),
        await ev(() => document.querySelector('#acct')?.textContent));
      const s = await ev(() => ({ edit: __mvw.auth.can('world.edit'), dock: !!document.querySelector('#dockL') && !document.querySelector('#dockL').classList.contains('hidden'), sections: document.querySelectorAll('#dockL .dsec').length }));
      check('the edit dock appears for an admin (I3.3)', s.edit && s.dock && s.sections === 5, s);
      await shot('01c-signed-in');
      allowHttp = [];
    });

    // -------------------------------------------------------------- inspector, follow, customizer (person)
    let sel = -1;
    await step('inspector', async () => {
      if (!(await ev(() => document.querySelectorAll('#roster .agent-row').length))) {
        skip('inspector and customizer', 'no connected agents in this world, so the roster is empty');
        return;
      }
      await p.click('#roster .agent-row');
      await wait(1800);
      const s = await ev(() => ({ sel: __mvw.S.sel, follow: __mvw.S.follow, name: document.querySelector('.insp .name')?.textContent, needs: document.querySelectorAll('.insp .needs .bar').length, kv: document.querySelector('.insp .kv')?.textContent || '' }));
      sel = s.sel;
      check('roster click selects + follows', s.sel >= 0 && s.follow, s);
      check('inspector shows needs + home/work', s.needs === 5 && /Home/.test(s.kv), { needs: s.needs, kv: s.kv.slice(0, 80) });
      await shot('02-inspector');
      await p.click('.insp .cust');
      check('customizer opens', await until(() => !!document.querySelector('.modal-back .modal')));
      await wait(700);
      await shot('03-customizer');
      const before = await ev(i => JSON.stringify(__mvw.S.people[i].a), sel);
      const originalChoice = await ev(() => document.querySelector('.modal .cchip.on')?.dataset.v);
      await p.click('.modal .rand');
      await wait(200);
      // Random may choose the same static model. Guarantee a changed selection
      // for the save assertion, while still exercising the Random action.
      const different = await ev(c => [...document.querySelectorAll('.modal .cchip')].find(e => e.dataset.v !== c)?.dataset.v, originalChoice);
      if (!different) throw new Error('No alternate character choice in the picker');
      if (!originalChoice) throw new Error('Original character selection missing');
      await p.click(`.modal .cchip[data-v="${different}"]`);
      check('alternate model is selected before Save', await ev(c => document.querySelector('.modal .cchip.on')?.dataset.v === c, different));
      const saved = p.waitForResponse(r => new URL(r.url()).pathname === '/api/edit' && r.request().method() === 'POST');
      await p.click('.modal .save');
      const editResponse = await saved;
      check('customizer edit is accepted by the server', editResponse.status() === 200, { status: editResponse.status(), resident: sel, char: different });
      check('customizer saves (person.set patch)', await until((a) => JSON.stringify(__mvw.S.people[a.i].a) !== a.before && __mvw.S.people[a.i].a[15] === a.char && !document.querySelector('.modal-back'), { i: sel, before, char: different }), await ev(i => ({ resident: i, char: __mvw.S.people[i].a[15], connected: __mvw.net.connected, version: __mvw.S.version, modalOpen: !!document.querySelector('.modal-back') }), sel));
      // Escape unwinds one layer per press: follow, then the floor view that following an indoor resident opened,
      // then the selection.
      await p.keyboard.press('Escape');
      check('Esc stops following first (selection stays)', await until(() => !__mvw.S.follow && __mvw.S.sel >= 0), await ev(() => ({ follow: __mvw.S.follow, sel: __mvw.S.sel })));
      for (let k = 0; k < 3 && await ev(() => __mvw.S.sel >= 0 || __mvw.S.focus.b >= 0); k++) { await p.keyboard.press('Escape'); await wait(150); }
      check('further Esc presses close the floor view, then deselect', await until(() => !__mvw.S.follow && __mvw.S.sel < 0 && __mvw.S.focus.b < 0), await ev(() => ({ sel: __mvw.S.sel, focus: __mvw.S.focus })));
    });

    const HQ = await ev(() => { const B = __mvw.S.world.buildings.find(b => b && !b.gone && b.type === 'hq'); return { b: B.idx, x: B.x, z: B.z, w: B.w, d: B.d, floors: B.floors, rot: B.rot }; });


    // -------------------------------------------------------------- WP1.7: the shell (top bar, docks, settings)
    await step('shell layout', async () => {
      const bar = await ev(() => {
        const t = document.querySelector('#topbar'), r = t.getBoundingClientRect();
        const u = document.querySelector('#topbar .undo');
        return { h: Math.round(r.height), top: Math.round(r.top), w: Math.round(r.width), undo: !!u, redo: !!document.querySelector('#topbar .redo'),   // since WP1.8 they work, so earlier edits may have lit them
          chip: !!document.querySelector('#acct .me'), toolbar: !!document.querySelector('#toolbar'), mini: !!document.querySelector('#minimap'),
          zoom: !!document.querySelector('#zoomctl'), player: !!document.querySelector('#floatbtns .player'), chat: !!document.querySelector('#floatbtns .chat'),
          logo: !!document.querySelector('#topbar .brand .logo'), select: !!document.querySelector('#topbar .mode'), settings: !!document.querySelector('#topbar .setb') };
      });
      // the select/explore button went (2026-10-06: Esc, closing the Buildings section and Leave all do it); the logo came
      check('the top bar is a 56 px strip with the logo, undo/redo, settings and the account chip, no select button (I3.1)',
        bar.h === 56 && bar.top === 0 && bar.w > 1000 && bar.undo && bar.redo && bar.chip && bar.logo && !bar.select && bar.settings, bar);
      check('the bottom toolbar is gone and the floating controls are there (I3.1)',
        bar.toolbar === false && bar.mini && bar.zoom && bar.player && bar.chat, bar);
      const time = await ev(() => {
        const top = document.querySelector('#topbar'), strip = document.querySelector('#dockR .dock-strip');
        return { inBar: !!top.querySelector('#stats'), inDock: !!strip && !!strip.querySelector('#stats'),
          stripInsideDock: strip ? strip.closest('#dockR') !== null : false,
          pause: !!top.querySelector('#speed .pause'), speeds: top.querySelectorAll('#speed .btn').length,
          skipForGuestOrAdmin: !!top.querySelector('#speed .skip') };
      });
      check('the city counts sit in the info dock, not the top bar (I3.9)',
        time.inDock && !time.inBar && time.stripInsideDock, time);
      check('one pause button and one speed button, so the time controls take two places (I3.9)',
        time.pause && time.speeds === 2 && time.skipForGuestOrAdmin, time);
      const grey = await ev(() => {
        const rgb = el => getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number).slice(0, 3);
        const panel = rgb(document.querySelector('#topbar')), btn = rgb(document.querySelector('#topbar .setb'));
        const spread = c => Math.max(...c) - Math.min(...c);
        const act = document.querySelector('#topbar .mode.on');
        return { panel, btn, panelSpread: spread(panel), btnSpread: spread(btn), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
      });
      check('the panels and buttons are one grey family (I3.10)', grey.panelSpread <= 6 && grey.btnSpread <= 6, grey);
      const arrows = await ev(() => document.querySelector('#dockR .dock-toggle .ca') ? getComputedStyle(document.querySelector('#dockR .dock-toggle .ca')).transform : null);
      const before = await ev(() => ({ open: !document.querySelector('#dockL').classList.contains('closed'), t: document.querySelector('#dockL .dock-toggle').title, exp: document.querySelector('#dockL .dock-toggle').getAttribute('aria-expanded') }));
      await p.keyboard.press('b');
      await until(() => !document.querySelector('#dockL').classList.contains('closed'));
      await wait(500);   // the arrow turns in 0.25 s
      const after = await ev(() => ({ t: document.querySelector('#dockL .dock-toggle').title, exp: document.querySelector('#dockL .dock-toggle').getAttribute('aria-expanded'), tf: getComputedStyle(document.querySelector('#dockL .dock-toggle .ca')).transform }));
      check('the dock arrow turns to show the way it will move (I3.12)', after.tf !== 'none' && after.tf !== 'matrix(1, 0, 0, 1, 0, 0)', { arrows, after });
      check('the dock button says what a click will do, for people and for assistive tech (I3.12)',
        /Hide the edit dock/.test(after.t) && after.exp === 'true' && /Show the edit dock/.test(before.t) && before.exp === 'false', { before, after });
      await p.keyboard.press('b');
      await until(() => document.querySelector('#dockL').classList.contains('closed'));
      const home = await ev(() => { __mvw.cam.flyTo(0, 0, 0, 250); return true; });
      await wait(400);
      await p.keyboard.press('Home');
      check('Home brings the camera back to the city (I3.13)', await until(() => { const h = __mvw.hq; return Math.abs(__mvw.cam.goal.x - h.x) < 3 && Math.abs(__mvw.cam.goal.z - (h.z + 8)) < 3; }));
      await p.keyboard.press('z');
      check('Z zooms to fit, with nothing selected fitting the whole city (I3.13)', await until(() => __mvw.cam.goalDist > 200));
      check('the edit dock starts closed and the info dock open (I3.2)',
        await ev(() => document.querySelector('#dockL').classList.contains('closed') && !document.querySelector('#dockR').classList.contains('closed')));
      await p.keyboard.press('b');
      check('B opens the edit dock (C112)', await until(() => !document.querySelector('#dockL').classList.contains('closed')));
      const left = await ev(() => [...document.querySelectorAll('#dockL .dsec .tt')].map(e => e.textContent));
      check('the edit dock has its five sections (I3.3)',
        left.length === 5 && /Terrain/.test(left[0]) && /Roads/.test(left[1]) && /Buildings/.test(left[2]) && /Outside/.test(left[3]) && /Agents/.test(left[4]), left);
      await p.click('#dockL .dsec[data-sec="buildings"] .dsec-h', { noWaitAfter: true });
      check('a section opens (I3.3)', await until(() => document.querySelector('#dockL .dsec[data-sec="buildings"]').classList.contains('open')));
      await p.click('#dockL .dsec[data-sec="buildings"] .dtab[data-tab="furnish"]');
      check('the Furniture tab turns the furniture tool on (C112)', await until(() => __mvw.S.mode === 'furnish'));
      check('and shows the furniture panel, not the building one', await ev(() => !document.querySelector('#furnp').classList.contains('hidden') && document.querySelector('#buildp').classList.contains('hidden')));
      await p.click('#dockL .dsec[data-sec="buildings"] .dtab[data-tab="build"]');
      check('the Building tab turns the building tool on (C112)', await until(() => __mvw.S.mode === 'build'));
      const inDock = await ev(() => {
        const r = document.querySelector('#dockL #buildp').getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), mid: Math.round(innerWidth / 2), width: Math.round(r.width) };
      });
      check('the editor sits inside the dock, over no part of the middle of the world (I3.5)',
        inDock.left >= 0 && inDock.right <= 340 && inDock.mid > inDock.right, inDock);
      await shot('14-edit-dock');
      await p.click('#dockL .dsec[data-sec="buildings"] .dsec-h', { noWaitAfter: true });
      check('closing the section returns to exploring (I3.3)', await until(() => __mvw.S.mode === 'explore'));
      await p.keyboard.press('b');
      await until(() => document.querySelector('#dockL').classList.contains('closed'));
      check('the dock state is saved with the account (I3.2)', await until(async () => {
        const r = await fetch('/api/account/settings', { cache: 'no-store' });
        const j = await r.json();
        const v = j.settings.find(x => x.path === 'display.docks');
        return !!v && /"l":false/.test(String(v.value || ''));
      }));
      await p.keyboard.press('i');
      check('I closes the info dock (I3.2)', await until(() => document.querySelector('#dockR').classList.contains('closed')));
      // A closed dock's sections are off screen: nothing inside it is clicked until it is open again. (Before WP1.8 this
      // step clicked the Team header of the closing dock, which only worked while it was still sliding out.)
      await wait(400);
      await p.click('#dockR .dock-toggle');
      check('its edge button opens it again', await until(() => !document.querySelector('#dockR').classList.contains('closed')));
      await wait(400);   // it slides back in (0.18 s)
      await p.click('#dockR .dsec[data-sec="team"] .dsec-h');   // fold the Team away so the lists below are in view (unfolded again below)
      const right = await ev(() => [...document.querySelectorAll('#dockR .dsec .tt')].map(e => e.textContent));
      check('the info dock has its seven sections (I3.4)',
        right.length === 7 && /Selection/.test(right[0]) && /Team/.test(right[1]) && /Buildings/.test(right[2]) && /Outside/.test(right[3])
        && /Home view/.test(right[4]) && /Activity/.test(right[5]) && /Online/.test(right[6]), right);
      await p.click('#dockR .dsec[data-sec="buildings"] .dsec-h');
      await wait(400);
      const entries = await ev(() => document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .ditem').length);
      check('the Buildings list is filled (I3.4)', entries > 50, { entries });
      await p.click('#dockR .dsec[data-sec="buildings"] .ditem');
      check('clicking an entry flies to it and selects it (I3.4)', await until(() => __mvw.S.selB >= 0));
      await p.click('#dockR .dsec[data-sec="team"] .dsec-h');
      await p.click('#dockR .dsec[data-sec="buildings"] .dsec-h');
      for (let k = 0; k < 2 && await ev(() => __mvw.S.selB >= 0); k++) { await p.keyboard.press('Escape'); await wait(200); }
      check('and Escape deselects it', await ev(() => __mvw.S.selB < 0));
    });

    // -------------------------------------------------------------- name tags (declutter fix of 2026-09-26)
    // -------------------------------------------------------------- the panels (favourites, links, sorting)
    await step('panels', async () => {
      await p.click('#dockR .dsec[data-sec="buildings"] .dsec-h');
      await wait(600);
      const list = await ev(() => ({
        rows: document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .ditem').length,
        stars: document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .fbtn').length,
        staronly: !!document.querySelector('#dockR .dsec[data-sec="buildings"] .staronly'),
        closed: document.querySelector('#dockR').classList.contains('closed'),
      }));
      check('the Buildings list fills when it opens, with a star on every entry (I3.14)',
        list.closed === false && list.rows > 200 && list.stars === list.rows && list.staronly, list);
      await p.click('#dockR .dsec[data-sec="buildings"] .fbtn');
      await wait(800);
      const starred = await ev(() => ({
        kept: __mvw.fav.list().length,
        on: document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .fbtn.on').length,
        pressed: document.querySelector('#dockR .dsec[data-sec="buildings"] .fbtn').getAttribute('aria-pressed'),
      }));
      check('starring a place keeps it and marks the row (I3.14)', starred.kept === 1 && starred.on === 1 && starred.pressed === 'true', starred);
      await p.click('#dockR .dsec[data-sec="buildings"] .staronly');
      await wait(500);
      check('the ★ only filter shows just the favourites (I3.14)',
        await ev(() => document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .ditem').length) === 1,
        await ev(() => document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .ditem').length));
      await p.click('#dockR .dsec[data-sec="buildings"] .staronly');
      await wait(500);
      check('and clearing it shows them all again', await ev(() => document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .ditem').length) > 200);

      await p.click('#dockR .dsec[data-sec="buildings"] .ditem');
      await wait(1400);
      const sel = await ev(() => {
        const i = document.querySelector('.insp'), f = i.querySelector('.fbtn'), s = document.querySelector('#dockR .dsec[data-sec="details"]');
        const b = s.querySelector('.dsec-b'), body = document.querySelector('#dockR .dock-body');
        return { name: (i.querySelector('.name') || {}).textContent, star: !!f, on: f ? f.classList.contains('on') : null,
          clipped: b.scrollHeight > b.clientHeight + 4, dockScrolls: body.scrollHeight > body.clientHeight + 4,
          sectionFits: s.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 4 };
      });
      check('the selected place shows the same star in its own panel (I3.14)', sel.star === true && sel.on === true, sel);
      check('the Selection panel is shown whole, with the dock scrolling instead of clipping it (I3.15)',
        sel.clipped === false && sel.dockScrolls === true, sel);
      await shot('07b-selection-panel');
      await p.click('.insp .fbtn');
      await wait(700);
      check('and unstarring it there works too (I3.14)',
        await ev(() => __mvw.fav.list().length) === 0 && await ev(() => document.querySelectorAll('#dockR .dsec[data-sec="buildings"] .fbtn.on').length) === 0);

      await p.click('#dockR .agent-row');
      await wait(1600);
      const links = await ev(() => [...document.querySelectorAll('.insp a[data-b]')].map(a => ({ b: +a.dataset.b, t: a.textContent.trim() })));
      check('a resident\'s home and work are links that say where they are (I3.15)', links.length >= 1 && links.every(l => l.b >= 0 && l.t), links);
      // The live inspector refreshes its DOM while simulation updates arrive.
      // Use a real mouse click at the visible link instead of waiting for two
      // stable animation frames; the building-selection assertion stays below.
      const point = await ev(() => {
        const link = document.querySelector('.insp a[data-b]');
        if (!link) throw new Error('Home/work link missing');
        link.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const r = link.getBoundingClientRect(), st = getComputedStyle(link);
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y)?.closest('a[data-b]');
        if (!r.width || !r.height || st.visibility !== 'visible' || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || hit?.dataset.b !== link.dataset.b)
          throw new Error('Home/work link is not visibly hit-testable');
        return { x, y, b: +link.dataset.b };
      });
      if (point.b !== links[0]?.b) throw new Error('Home/work link changed its target');
      await p.mouse.click(point.x, point.y);
      await wait(1500);
      const after = await ev(() => ({ selB: __mvw.S.selB, name: (document.querySelector('.insp .name') || {}).textContent }));
      check('clicking one selects that building (I3.15)', links[0] && after.selB === links[0].b, { link: links[0], after });

      const opts = await ev(() => [...document.querySelectorAll('#roster .sortsel option')].map(o => o.value));
      check('the panel offers name, work building and home building sorting (I3.16)', ['name', 'work', 'home'].every(v => opts.includes(v)), opts);
      await p.selectOption('#roster .sortsel', 'name');
      await wait(700);
      const byName = await ev(() => [...document.querySelectorAll('#roster .agent-row .nm')].map(e => e.textContent));
      check('by name sorts the list (I3.16)', byName.length > 3 && byName.join('|') === [...byName].sort((a, b) => a.localeCompare(b)).join('|'), byName.slice(0, 4));
      await p.selectOption('#roster .sortsel', 'work');
      await wait(700);
      const byWork = await ev(() => ({ groups: [...document.querySelectorAll('#roster .tgroup')].map(e => e.textContent), rows: document.querySelectorAll('#roster .agent-row').length }));
      check('by work building groups the list under headings (I3.16)', byWork.groups.length >= 1 && byWork.rows > 3, byWork);
      await p.selectOption('#roster .sortsel', 'home');
      await wait(700);
      const byHome = await ev(() => ({ groups: [...document.querySelectorAll('#roster .tgroup')].map(e => e.textContent), rows: document.querySelectorAll('#roster .agent-row').length }));
      check('by home building too (I3.16)', byHome.groups.length >= 1 && byHome.rows > 3, byHome);
      check('and the choice is kept for this account (I3.16)', await ev(() => localStorage.getItem('mvw.teamSort')) === 'home');
      await shot('07c-team-sorted');
      await p.selectOption('#roster .sortsel', 'world');
      await wait(500);
      check('the default order is the world order (I3.16)',
        await ev(() => document.querySelectorAll('#roster .tgroup').length) === 0 && await ev(() => document.querySelectorAll('#roster .agent-row').length) > 3);
      await p.click('#dockR .dsec[data-sec="buildings"] .dsec-h');
      await wait(400);
      for (let k = 0; k < 4 && await ev(() => __mvw.S.selB >= 0 || __mvw.S.sel >= 0 || __mvw.S.focus.b >= 0); k++) {
        await p.keyboard.press('Escape');
        await wait(250);
      }
    });

    // -------------------------------------------------------------- themes, the home view and About (WP1.9)
    await step('themes', async () => {
      // the shell's font and the browser-drawn parts (scrollbars) follow the theme; lost once in alpha.5 unnoticed
      const look = await ev(() => ({ font: getComputedStyle(document.body).fontFamily, scheme: getComputedStyle(document.documentElement).colorScheme,
        thumb: getComputedStyle(document.documentElement).scrollbarColor }));
      check('the interface uses the shell font, not the browser\'s default serif', /^Inter\b/.test(look.font) && !/Times/.test(look.font), look);
      check('scrollbars and native controls are dark in the Dark theme', look.scheme === 'dark' && /rgba\(255, 255, 255, 0\.18\)/.test(look.thumb), look);
      const read = () => ev(() => ({
        theme: document.documentElement.dataset.theme || 'dark',
        page: getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),
        top: getComputedStyle(document.querySelector('#topbar')).color,
        bg: getComputedStyle(document.querySelector('#topbar')).backgroundColor,
        stored: (() => { try { return localStorage.getItem('mw.theme') || '(none)'; } catch { return 'unreadable'; } })(),
      }));
      const openDisplay = async tab => {
        if (!await ev(() => !!document.querySelector('.st-tabs'))) { await act('open Settings', p.click('#topbar .setb', { timeout: 8000, noWaitAfter: true })); }
        await p.click(`.st-tabs .tab[data-tab="${tab}"]`);
        await wait(350);
      };
      await openDisplay('display');
      const opts = await ev(() => { const s = document.querySelector('.theme'); return s ? [...s.options].map(o => o.value) : null; });
      check('Display offers the three themes (I13.4)', !!opts && opts.join(',') === 'dark,light,contrast', opts);
      const before = await read();
      check('the default look is dark (I13.4)', before.theme === 'dark' && before.page === '#111111', before);
      await p.selectOption('.theme', 'light');
      await wait(500);
      const light = await read();
      check('choosing Light applies it at once (I13.4)', light.theme === 'light' && light.page !== before.page && light.top !== before.top, { before: before.page, light: light.page, top: light.top });
      await shot('15a-theme-light');
      check('and the choice is saved with the account (I13.4)', await until(async () => {
        const r = await fetch('/api/account/settings', { cache: 'no-store' });
        const j = await r.json();
        return j.settings.find(x => x.path === 'display.theme').value === 'light';
      }));
      check('the docks and panels follow the theme too (I13.4)', await ev(() => {
        const dock = getComputedStyle(document.querySelector('#dockR'));
        const text = getComputedStyle(document.querySelector('#dockR')).color;
        return dock.backgroundColor !== 'rgba(0, 0, 0, 0)' && text === 'rgb(23, 24, 26)';
      }));
      await p.selectOption('.theme', 'contrast');
      await wait(500);
      const contrast = await read();
      check('High contrast is a theme of its own (I13.4)', contrast.theme === 'contrast' && contrast.page === '#000000' && contrast.page !== light.page, contrast);
      await shot('15b-theme-contrast');
      // another device of the same account takes it at sign-in; a guest keeps its own in the browser
      const q = await newPage({ width: 1200, height: 800 });
      try {
        await q.bringToFront();
        await q.goto(`${base}/?hour=12`, { waitUntil: 'load' });
        await q.waitForFunction(() => window.__mvw?.ready && __mvw.agents.chars.loaded, null, { timeout: 25000 });
        const guestFirst = await q.evaluate(() => document.documentElement.dataset.theme || 'dark');
        await act('second device: Sign in', q.click('#acct .signin', { timeout: 8000 }));
        await q.fill('.auth-back .login', ui.login);
        await q.fill('.auth-back .pw', ui.password);
        await q.click('.auth-back .go');
        check('another device takes the account\'s theme at sign-in (I13.4)',
          await q.waitForFunction(() => (document.documentElement.dataset.theme || 'dark') === 'contrast', null, { timeout: 12000 }).then(() => true, () => false), { guestFirst });
        check('and the guest look on that device was the default (I13.4)', guestFirst === 'dark', guestFirst);
      } finally { await closeAccountTestPage(q, base, T.httpClient); }
      await p.selectOption('.theme', 'dark');
      await wait(400);
      const back = await read();
      check('Dark comes back (I13.4)', back.theme === 'dark' && back.page === before.page && back.top === before.top, back);
      check('a guest\'s choice stays in the browser, not with an account (I13.4)', await ev(() => {
        try { return localStorage.getItem('mw.theme') === null; } catch { return true; }
      }));
    });

    await step('home view', async () => {
      await ev(() => { const b = document.querySelector('.auth-back .cancel'); if (b) b.click(); });
      await until(() => !document.querySelector('.auth-back'));
      const sec = '#dockR .dsec[data-sec="home"]';
      check('the info dock has a Home view panel (I13.5)', await until(s => !!document.querySelector(`${s} .go`) && !!document.querySelector(`${s} .set`), sec));
      // a dock section starts folded: open it before using what is inside
      if (!await ev(s => { const b = document.querySelector(`${s} .dsec-b`); return !!b && b.offsetParent !== null; }, sec)) {
        await p.click(`${sec} .dsec-h`);
        await wait(400);
      }
      check('the panel is open to use (I13.5)', await ev(s => { const b = document.querySelector(`${s} .dsec-b`); return !!b && b.offsetParent !== null; }, sec));
      const frame = () => ev(() => ({ x: __mvw.cam.goal.x, y: __mvw.cam.goal.y, z: __mvw.cam.goal.z, d: __mvw.cam.goalDist, yaw: __mvw.cam.goalYaw, pitch: __mvw.cam.goalPitch }));
      const fly = async (x, z, d, yaw, pitch) => {
        await ev(a => { __mvw.cam.goalYaw = a.yaw; __mvw.cam.goalPitch = a.pitch; __mvw.cam.jumpTo(a.x, 0, a.z, a.d); __mvw.cam.yaw = a.yaw; __mvw.cam.pitch = a.pitch; }, { x, z, d, yaw, pitch });
        await wait(500);
      };
      // the reused module keeps a distance between 4.5 and 120, so a home is saved inside that range
      await fly(96, -64, 950, 2.1, 0.7);
      await p.click(`${sec} .set`, { noWaitAfter: true });
      check('Set home to current view keeps the frame with the account (I13.5)', await until(async () => {
        const r = await fetch('/api/account/settings', { cache: 'no-store' });
        const j = await r.json();
        const raw = j.settings.find(x => x.path === 'display.home').value;
        if (!raw) return false;
        const home = JSON.parse(raw).frame;
        return Math.abs(home.x - 96) < 0.05 && Math.abs(home.z + 64) < 0.05 && Math.abs(home.distance - 120) < 0.5;   // 950 clamped to the module's ceiling
      }));
      check('the panel says where the home is (I13.5)', await until(s => /Your home: 96, -64/.test(document.querySelector(`${s} .status`).textContent || ''), sec));
      await fly(0, 0, 300, 0.7, 1.1);
      await p.click(`${sec} .go`);
      check('Go to home view returns to the saved frame (I13.5)', await until(a => {
        const c = __mvw.cam.goal, d = __mvw.cam.goalDist;
        return Math.abs(c.x - a.x) < 3 && Math.abs(c.z - a.z) < 3 && Math.abs(d - a.d) < 12;
      }, { x: 96, z: -64, d: 120 }, 9000));
      const saved = await ev(() => ({
        x: Math.round(__mvw.cam.goal.x), z: Math.round(__mvw.cam.goal.z), d: Math.round(__mvw.cam.goalDist),
        pitch: +__mvw.cam.goalPitch.toFixed(2),
      }));
      if (!server) return skip('the world default home view', 'only on a throwaway server (it needs the owner)');
      // an admin sets the installation's default; a guest's Go to home view lands there
      await fly(-120, 90, 100, 1.2, 0.9);
      await p.click(`${sec} .def`);
      // an installation-wide setting: the server asks for the password again (C117, C65)
      if (await until(() => /Confirm your password/.test(document.querySelector('.auth-back h3')?.textContent || ''), null, 4000)) {
        await p.fill('.auth-back .pw', ui.password);
        await p.click('.auth-back .go');
        check('world-default change answers the password challenge', await until(() => !document.querySelector('.auth-back')));
      }
      let savedDefault = null;   // read from Node: the api client does not exist inside the page
      for (let k = 0; k < 40 && !savedDefault; k++) {
        const r = await api.get('/api/settings');
        const row = r.status === 200 ? r.json.settings.find(x => x.path === 'world.home') : null;
        if (row && row.value) savedDefault = JSON.parse(String(row.value));
        else await wait(250);
      }
      check('an admin can set the installation\'s default home view (I13.5)',
        !!savedDefault && Math.abs(savedDefault.x + 120) < 0.05 && Math.abs(savedDefault.z - 90) < 0.05, savedDefault);
      const g = await newPage({ width: 1200, height: 800 });
      try {
        await g.goto(`${base}/?hour=12`, { waitUntil: 'load' });
        await g.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 25000 });
        const guestHome = await g.evaluate(() => {
          const w = __mvw.S.world.home;
          return w ? { x: w.x, z: w.z, d: w.distance } : null;
        });
        check('the world default reaches a guest with the world (I13.5)', !!guestHome && Math.abs(guestHome.x + 120) < 0.05, guestHome);
        check('a guest has no home of its own to set (C117)', await g.evaluate(() => !document.querySelector('#dockR .dsec[data-sec="home"] .set') || document.querySelector('#dockR .dsec[data-sec="home"] .set').classList.contains('hidden')));
        await g.click('#dockR .dsec[data-sec="home"] .dsec-h');
        await wait(400);
        await g.click('#dockR .dsec[data-sec="home"] .go');
        check('and Go to home view takes the guest there (I13.5)', await g.waitForFunction(() => {
          const c = __mvw.cam.goal, d = __mvw.cam.goalDist;
          return Math.abs(c.x + 120) < 4 && Math.abs(c.z - 90) < 4 && Math.abs(d - 100) < 14;
        }, null, { timeout: 9000 }).then(() => true, () => false));
      } finally { await g.context().close(); }
      // undoing an edit that resets the world default is not possible: the owner resets it to empty
      if (server) {
        const r = await api.post('/api/settings', { values: { 'world.home': null } });   // back to the empty default
        const row = r.status === 200 ? r.json.settings.find(x => x.path === 'world.home') : null;
        check('the world default can be cleared again (I13.5)', r.status === 200 && !!row && !row.value, { status: r.status, value: row && row.value });
      }
      check('the account\'s own home survived all of it (I13.5)', await until(async () => {
        const r = await fetch('/api/account/settings', { cache: 'no-store' });
        const raw = (await r.json()).settings.find(x => x.path === 'display.home').value;
        if (!raw) return false;
        const f = JSON.parse(raw).frame;
        return Math.abs(f.x - 96) < 0.05 && Math.abs(f.z + 64) < 0.05 && Math.abs(f.distance - 120) < 0.5;
      }), { was: saved });
    });

    await step('about', async () => {
      await p.click('#topbar .setb').catch(() => {});
      await until(() => !!document.querySelector('.st-tabs'));
      await p.click('.st-tabs .tab[data-tab="about"]');
      check('About opens (I13.9)', await until(() => /My Virtual World/.test(document.querySelector('.atab')?.textContent || '')));
      const info = await ev(() => {
        const t = document.querySelector('.atab');
        return { text: (t.textContent || '').replace(/\s+/g, ' ').trim(), libs: [...t.querySelectorAll('.notice-list li')].map(x => x.textContent.trim()) };
      });
      check('About names the version and the release (I13.9)', /Version/.test(info.text) && /Release/.test(info.text) && /\d+\.\d+\.\d+/.test(info.text), info.text.slice(0, 120));
      check('About lists this release\'s libraries with their licences (I13.9)',
        info.libs.length >= 3 && info.libs.some(l => /^three /.test(l) && /MIT/.test(l)) && info.libs.some(l => /^ws /.test(l) && /MIT/.test(l)), info.libs);
      check('About names the product\'s terms: proprietary, not open source (I13.9)',
        /proprietary/.test(info.text) && /not open source/.test(info.text), info.text.slice(-320));
      check('and shows the licence status (I13.9, WP1.11)',
        /Licence\s*(Early Bird|Full License|Licensed|Demo mode)/.test(info.text) && !/arrives with the next package/.test(info.text), info.text.slice(0, 220));
      await shot('15c-about');
      await p.click('.auth-back .cancel');
      await until(() => !document.querySelector('.auth-back'));
    });

    await step('labels', async () => {
      const f = await ev(h => {
        const A = __mvw.agents, cnt = {};
        for (const q of __mvw.S.people) {
          if (!q || !q.v) continue;
          const c = A.ctx[q.i];
          if (c >= 0 && (c >> 6) === h.b) cnt[c & 63] = (cnt[c & 63] || 0) + 1;
        }
        let best = 1, n = -1;
        for (const k of Object.keys(cnt)) if (cnt[k] > n) { n = cnt[k]; best = +k; }
        return best;
      }, HQ);
      await ev(a => __mvw.lookInside(a.b, a.f), { b: HQ.b, f });
      await wait(2800);
      const r = await ev(() => {
        const boxes = [...document.querySelectorAll('#labels .lbl')]
          .filter(e => e.style.display !== 'none')
          .map(e => e.querySelector('.tagname'))
          .filter(t => t && !t.classList.contains('sel'))
          .map(t => t.getBoundingClientRect());
        let over = 0;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 6 && oy > 6) over++;
          }
        }
        return { shown: boxes.length, overlapping: over, focus: __mvw.S.focus };
      });
      check('name tags are shown and none overlap (declutter)', r.shown >= 3 && r.overlapping === 0, r);
      await shot('02b-labels');
      await ev(() => __mvw.exitFocus());
      await wait(600);
    });

    // -------------------------------------------------------------- furnish
    await step('furnish', async () => {
      await ev(h => __mvw.lookInside(h.b, 1), HQ);
      await wait(1600);
      await p.keyboard.press('Digit2');
      const onBuilding = await ev(() => {
        const f = document.querySelector('#floorw'), B = __mvw.S.world.buildings[__mvw.S.focus.b];
        const r = f.getBoundingClientRect(), c = __mvw.stage.camera;
        const parts = { walls: !!f.querySelector('.walls'), leave: !!f.querySelector('.exit'), up: !!f.querySelector('.up'), dn: !!f.querySelector('.dn'),
          floor: f.querySelector('.fl b').textContent, total: f.querySelector('.fl small').textContent };
        const p = new __mvw.THREE.Vector3(B.x, 0, B.z).project(c);
        const sx = (p.x + 1) * 0.5 * innerWidth;
        return { ...parts, top: Math.round(r.top), onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          nearBuilding: Math.abs((r.left + r.width / 2) - sx) < Math.max(400, B.w * 8), visible: !f.classList.contains('hidden') };
      });
      check('the floor control is on the building, at the floor shown, with walls and Leave (I3.11)',
        onBuilding.visible && onBuilding.onScreen && onBuilding.walls && onBuilding.leave && onBuilding.up && onBuilding.dn && onBuilding.floor === '2' && onBuilding.total === '/10', onBuilding);
      await shot('14b-floor-control-on-building');
      // It follows the floor: its anchor is at the height of the floor shown, on the building's right-hand corner. The
      // camera rides up with the floor, so its position on the screen is nearly unchanged - the world height it tracks is
      // what moves, so that is what the check measures.
      const where = () => ev(async () => {
        const G = await import('/shared/geom.js'), C = await import('/shared/constants.js');
        const B = __mvw.S.world.buildings[__mvw.S.focus.b], cam = __mvw.stage.camera, y = C.floorY(__mvw.S.focus.f) + C.FLOOR_H * 0.5;
        let bx = -Infinity, by = 0;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p = G.toWorld(B, sx * B.w / 2, sz * B.d / 2), v = new __mvw.THREE.Vector3(p.x, y, p.z).project(cam);
          if (v.z > 1) continue;
          const px = (v.x + 1) * 0.5 * innerWidth;
          if (px > bx) { bx = px; by = (1 - v.y) * 0.5 * innerHeight; }
        }
        const r = document.querySelector('#floorw').getBoundingClientRect();
        return { floor: __mvw.S.focus.f, worldY: Math.round(y * 10) / 10, dx: Math.round((r.left + r.width / 2) - bx), dy: Math.round((r.top + r.height / 2) - by) };
      });
      const low = await where();
      check('its anchor is at the floor shown, on the building (I3.11)', Math.abs(low.dy) < 45 && Math.abs(low.dx) < 200 && low.floor === 1, low);
      await ev(() => { __mvw.changeFloor(1); return true; });
      await wait(1200);
      const high = await where();
      check('and it rises with the floor: same corner, one storey higher (I3.11)',
        high.floor === 2 && high.worldY > low.worldY + 2 && Math.abs(high.dy) < 45, { low, high });
      await ev(() => __mvw.changeFloor(-1));
      await wait(900);
      check('furnish panel opens on the focused floor', await until(() => !document.querySelector('#furnp').classList.contains('hidden') && /floor 2/.test(document.querySelector('#furnp .where').textContent)));
      await p.click('#furnp .cats [data-c="Decor"]');
      await p.click('#furnp .items [data-t="plant"]');
      const spot = await ev(async (h) => {
        const E = await import('/shared/edit.js'), G = await import('/shared/geom.js'), C = await import('/shared/constants.js');
        const S = __mvw.S, B = S.world.buildings[h.b], L = S.world.levels[B.lv[1]], y = C.floorY(1), res = [];
        for (let z = -B.d / 2 + 1.5; z < B.d / 2 - 1.5; z += 0.5) for (let x = -B.w / 2 + 1.5; x < B.w / 2 - 1.5; x += 0.5) {
          const it = { t: 'plant', x, z, r: 0 };
          if (E.checkItem(B, 1, L, it) || E.checkItem(B, 1, L, { ...it, x: x + 2 })) continue;
          const w = G.toWorld(B, x, z), s = __t.proj(w.x, y, w.z), w2 = G.toWorld(B, x + 2, z), s2 = __t.proj(w2.x, y, w2.z);
          if (__t.free(s) && __t.free(s2)) res.push({ x, z, sx: s.x, sy: s.y, sx2: s2.x, sy2: s2.y });
        }
        return res.length ? res[Math.floor(res.length / 2)] : null;
      }, HQ);
      check('found a free floor spot on screen', !!spot, spot);
      if (!spot) return;
      const count = () => ev(h => { const B = __mvw.S.world.buildings[h.b]; return __mvw.S.world.levels[B.lv[1]].items.length; }, HQ);
      const n0 = await count();
      await p.mouse.move(spot.sx, spot.sy, { steps: 4 }); await wait(400);
      const g = await ev(() => ({ ok: __mvw.editors.F.ok, reason: __mvw.editors.F.reason, it: __mvw.editors.F.it }));
      check('placement preview is valid', g.ok, g);
      await shot('04-furnish-ghost');
      await p.mouse.click(spot.sx, spot.sy);
      check('click places the item (item.add)', await until((a) => { const B = __mvw.S.world.buildings[a.b]; return __mvw.S.world.levels[B.lv[1]].items.length === a.n0 + 1; }, { b: HQ.b, n0 }));
      const placed = await ev((a) => { const B = __mvw.S.world.buildings[a.b], L = __mvw.S.world.levels[B.lv[1]]; const it = L.items[L.items.length - 1]; return { id: it.id, t: it.t, x: it.x, z: it.z, r: it.r || 0 }; }, HQ);
      check('placed at the previewed spot', placed.t === 'plant' && Math.abs(placed.x - spot.x) < 0.3 && Math.abs(placed.z - spot.z) < 0.3, placed);
      await p.keyboard.press('Escape'); await wait(300);
      await p.mouse.click(spot.sx, spot.sy); await wait(300);
      check('click selects the placed item', await until(id => __mvw.editors.F.sel && __mvw.editors.F.sel.id === id, placed.id, 3000));
      await p.keyboard.press('KeyR');
      check('R rotates it (item.move)', await until((a) => { const B = __mvw.S.world.buildings[a.b], it = __mvw.S.world.levels[B.lv[1]].items.find(i => i.id === a.id); return it && Math.abs((it.r || 0) - a.r) > 0.1; }, { b: HQ.b, id: placed.id, r: placed.r }));
      await wait(400);
      await p.mouse.move(spot.sx, spot.sy); await p.mouse.down();
      await p.mouse.move(spot.sx2, spot.sy2, { steps: 12 }); await wait(250);
      await shot('05-furnish-drag');
      await p.mouse.up();
      check('drag moves it (item.move)', await until((a) => { const B = __mvw.S.world.buildings[a.b], it = __mvw.S.world.levels[B.lv[1]].items.find(i => i.id === a.id); return it && Math.abs(it.x - (a.x + 2)) < 0.3; }, { b: HQ.b, id: placed.id, x: placed.x }));
      await wait(400);
      await p.keyboard.press('Delete');
      check('Delete removes it (item.del)', await until((a) => { const B = __mvw.S.world.buildings[a.b]; return !__mvw.S.world.levels[B.lv[1]].items.some(i => i.id === a.id); }, { b: HQ.b, id: placed.id }));
    });

    // -------------------------------------------------------------- build
    await step('build', async () => {
      await p.keyboard.press('Digit3');
      check('build panel opens', await until(() => !document.querySelector('#buildp').classList.contains('hidden')));
      await ev(() => __mvw.exitFocus());
      await p.click('#buildp .tabs [data-tab="new"]');
      await p.click('#buildp .ntype [data-v="cafe"]');
      const spot = await ev(async () => {
        const E = await import('/shared/edit.js'), S = __mvw.S, g = S.grid;
        for (let z = g.minZ + 10; z < g.maxZ - 10; z += 2) for (let x = g.minX + 10; x < g.maxX - 10; x += 2) {
          const s = E.normalizeSpec({ type: 'cafe', w: 12, d: 14, floors: 1, style: 'modern', rot: 0, x, z });
          if (E.checkBuilding(S.world, s)) continue;
          if (E.checkBuilding(S.world, { ...s, x: s.x + 0.5 }) || E.checkBuilding(S.world, { ...s, z: s.z + 0.5 }) || E.checkBuilding(S.world, { ...s, x: s.x - 0.5 }) || E.checkBuilding(S.world, { ...s, z: s.z - 0.5 })) continue;
          return { x: s.x, z: s.z };
        }
        return null;
      });
      check('found an empty lot', !!spot, spot);
      if (!spot) return;
      await ev(s => { __mvw.cam.jumpTo(s.x, 0, s.z, 70); }, spot);
      await wait(700);
      const sp = await ev(s => __t.proj(s.x, 0.15, s.z), spot);
      await p.mouse.move(sp.x - 3, sp.y - 3); await p.mouse.move(sp.x, sp.y, { steps: 3 }); await wait(400);
      const bs = await ev(() => ({ ok: __mvw.editors.BS.ok, reason: __mvw.editors.BS.reason, spec: __mvw.editors.BS.spec }));
      check('building preview fits', bs.ok, bs);
      await shot('06-build-ghost');
      const nb = await ev(() => __mvw.S.world.buildings.length);
      await p.mouse.click(sp.x, sp.y);
      check('click builds it (bld.add) and selects it', await until(n => __mvw.S.world.buildings.length > n && __mvw.S.selB >= n, nb, 10000));
      const b = await ev(() => __mvw.S.selB);
      await wait(900);
      await shot('07-built');
      await p.fill('#buildp .bname', 'Test Café');
      await p.press('#buildp .bname', 'Enter');
      check('rename (bld.set)', await until(i => __mvw.S.world.buildings[i].name === 'Test Café', b));
      await p.click('#buildp [data-a="fl+"]');
      check('add a floor (bld.floors)', await until(i => __mvw.S.world.buildings[i].floors === 2, b));
      await wait(300);
      await p.click('#buildp [data-a="style"][data-v="brick"]');
      check('change style', await until(i => __mvw.S.world.buildings[i].style === 'brick', b));
      await wait(300);
      await p.click('#buildp [data-a="del"]'); await wait(200); await p.click('#buildp [data-a="del"]');
      check('demolish (bld.del)', await until(i => __mvw.S.world.buildings[i].gone, b));
      await p.click('#buildp .addp');
      check('new-resident dialog opens', await until(() => !!document.querySelector('.modal-back')));
      const np = await ev(() => __mvw.S.people.length);
      await p.fill('.modal .cname', 'Testy McTest');
      await p.click('.modal .save');
      check('new resident created (person.add)', await until(n => __mvw.S.people.length > n && __mvw.S.people[__mvw.S.people.length - 1].n === 'Testy McTest', np, 10000));
      check('new resident gets selected (fix of 2026-09-26)', await until(() => __mvw.S.sel >= 0 && __mvw.S.people[__mvw.S.sel].n === 'Testy McTest', null, 6000));
      await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
      await p.keyboard.press('Digit1');
    });

    // -------------------------------------------------------------- undo, redo and the activity log (WP1.8, I3.8)
    await step('undo and redo', async () => {
      const B0 = await ev(() => {
        const L = __mvw.S.world.buildings.filter(b => b && !b.gone && b.type !== 'hq' && b.type !== 'park' && b.idx > 20);
        const B = L.find(b => b.type === 'restaurant') || L[0];
        return B ? { b: B.idx, name: B.name } : null;
      });
      check('found a building to change', !!B0, B0);
      if (!B0) return;
      const nameOf = b => ev(i => __mvw.S.world.buildings[i].name, b);
      const nameIs = (v, ms = 8000) => until(a => __mvw.S.world.buildings[a.b].name === a.v, { b: B0.b, v }, ms);
      const toast = re => until(src => [...document.querySelectorAll('#toasts .toast')].some(t => new RegExp(src).test(t.textContent)), re.source, 8000);
      const mine = async name => ev(async a => {   // an edit made by the page's own session
        const r = await fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': __mvw.auth.csrf },
          body: JSON.stringify({ ops: [{ op: 'bld.set', b: a.b, name: a.name }] }) });
        return r.status;
      }, { b: B0.b, name });
      await ev(() => { if (document.activeElement) document.activeElement.blur(); });
      check('an edit of this account answers 200', await mine('Undo Test Hall') === 200);
      check('the top bar\'s undo lights up and names the change (I3.8)', await until(() => {
        const u = document.querySelector('#topbar .undo');
        return !u.disabled && /Undo: Renamed .* to Undo Test Hall/.test(u.title);
      }), await ev(() => document.querySelector('#topbar .undo').title));
      await p.keyboard.press('Control+z');
      check('Ctrl+Z undoes it for everyone (I3.8)', await nameIs(B0.name), await nameOf(B0.b));
      check('with a short message naming the change', await toast(/^Undone: Renamed .* to Undo Test Hall/));
      check('and redo lights up', await until(() => !document.querySelector('#topbar .redo').disabled));
      await p.click('#topbar .redo');
      check('the redo button puts it back (I3.8)', await nameIs('Undo Test Hall'));
      if (!server) return skip('undo with two accounts', 'only on a throwaway server (it needs a second account)');
      // a second account (the owner) changes the same thing: this account's undo is refused with the reason
      check('another account renames it', (await api.post('/api/edit', { ops: [{ op: 'bld.set', b: B0.b, name: 'Owner Hall' }] })).status === 200);
      check('and this page sees it live', await nameIs('Owner Hall'));
      allowHttp = [{ method: 'POST', path: '/api/undo', status: 409 }];   // the deliberate refusal
      await p.keyboard.press('Control+z');
      check('an undo whose target someone else changed later is refused, naming who (I3.8)', await toast(/Cannot undo “Renamed .* to Undo Test Hall”: .+ changed it later \(renamed Undo Test Hall to Owner Hall\)/));
      check('and nothing changes', (await nameOf(B0.b)) === 'Owner Hall');
      allowHttp = [];
      check('the other account undoes its own change', (await api.post('/api/undo')).status === 200);
      check('which reaches this page live', await nameIs('Undo Test Hall'));
      await p.keyboard.press('Control+z');
      check('now this account\'s undo goes through', await nameIs(B0.name));
      await p.keyboard.press('Control+y');
      check('and Ctrl+Y redoes it', await nameIs('Undo Test Hall'));
      // the activity log: the other account's edit arrives live; an admin reverts it and undoes the revert
      await ev(() => __mvw.docks.show('r:activity'));
      check('another account renames it again', (await api.post('/api/edit', { ops: [{ op: 'bld.set', b: B0.b, name: 'Owner Hall 2' }] })).status === 200);
      const rowSel = 'Renamed Undo Test Hall to Owner Hall 2';
      check('the activity log shows the edit live, with who made it (I3.4)', await until(t => [...document.querySelectorAll('#dockR .al-item')].some(r => r.querySelector('.al-text')?.textContent === t && /Owner|owner/i.test(r.querySelector('.al-meta')?.textContent || '')), rowSel));
      check('an undone edit is marked in the log', await ev(() => [...document.querySelectorAll('#dockR .al-item')].some(r => /Renamed Undo Test Hall to Owner Hall$/.test(r.querySelector('.al-text')?.textContent || '') && /undone/.test(r.textContent))));
      await shot('07d-activity-log');
      const clicked = await ev(t => {
        const r = [...document.querySelectorAll('#dockR .al-item')].find(x => x.querySelector('.al-text')?.textContent === t);
        const b = r && r.querySelector('.act-revert');
        if (!b) return false;
        b.click();
        return true;
      }, rowSel);
      check('an admin has a Revert button on anyone\'s edit (I3.8)', clicked);
      check('Revert puts back what it replaced (I3.8)', await nameIs('Undo Test Hall'));
      check('and the line says who reverted it', await until(t => [...document.querySelectorAll('#dockR .al-item')].some(r => r.querySelector('.al-text')?.textContent === t && /reverted by/.test(r.textContent)), rowSel));
      await ev(() => { if (document.activeElement) document.activeElement.blur(); });
      await p.keyboard.press('Control+z');
      check('the admin undoes the revert like any own edit', await nameIs('Owner Hall 2'));
      check('and the line is in effect again', await until(t => [...document.querySelectorAll('#dockR .al-item')].some(r => r.querySelector('.al-text')?.textContent === t && !/reverted|undone/.test(r.querySelector('.al-meta')?.textContent || '')), rowSel));
    });

    // -------------------------------------------------------------- play mode
    await step('play', async () => {
      const door = await ev(async (h) => { const G = await import('/shared/geom.js'), B = __mvw.S.world.buildings[h.b]; return G.toWorld(B, B.door.x, B.d / 2 + 3); }, HQ);
      await ev(d => { __mvw.cam.jumpTo(d.x, 0, d.z + 2, 30); __mvw.cam.yaw = __mvw.cam.goalYaw = 0; }, door);
      await wait(500);
      await p.keyboard.press('Digit4');
      check('play mode starts', await until(() => __mvw.player.active && __mvw.S.mode === 'play'));
      check('in play mode both docks and their buttons step aside (I3.12)', await ev(() => {
        const l = document.querySelector('#dockL'), r = document.querySelector('#dockR');
        const gone = el => !el || getComputedStyle(el).display === 'none';
        return gone(l) && gone(r);
      }), await ev(() => ({ l: getComputedStyle(document.querySelector('#dockL')).display, r: getComputedStyle(document.querySelector('#dockR')).display })));
      await ev(d => { __mvw.player.warp(d.x, d.z + 3, -1); __mvw.cam.yaw = __mvw.cam.goalYaw = 0; }, door);   // an admin warp: the server refuses teleports (I14.10)
      await wait(300);
      const p0 = await ev(() => ({ x: __mvw.player.x, z: __mvw.player.z }));
      await p.keyboard.down('KeyW'); await wait(1200);
      await shot('08-play-walk');
      const p1 = await ev(() => ({ x: __mvw.player.x, z: __mvw.player.z, clip: __mvw.player.clip }));
      check('W walks forward', p0.z - p1.z > 1.0, { p0, p1 });
      await wait(3500);
      await p.keyboard.up('KeyW');
      const inside = await ev(() => ({ ctx: __mvw.player.ctx, focus: __mvw.S.focus, z: __mvw.player.z }));
      check('walks in through the front door', inside.ctx === HQ.b * 64 && inside.focus.b === HQ.b, inside);
      await wait(400);
      await shot('09-play-inside');
      const st = await ev(async (h) => { const G = await import('/shared/geom.js'), Bl = await import('/shared/building.js'), B = __mvw.S.world.buildings[h.b]; const s = Bl.elevatorStops(B)[0]; return G.toWorld(B, s.x, s.z); }, HQ);
      await ev(s => { const P = __mvw.player; P.warp(s.x, s.z, P.ctx); }, st);
      await wait(500);
      await p.keyboard.press('KeyE');
      check('E at the elevator opens the floor picker', await until(() => !document.querySelector('#elev').classList.contains('hidden')), await ev(() => document.querySelector('#phud .prompt').textContent));
      await p.click('#elev .grid [data-f="3"]');
      check('elevator rides to floor 4', await until(() => (__mvw.player.ctx & 63) === 3 && __mvw.S.focus.f === 3));
      await wait(900);
      const seat = await ev(async () => {
        const A = __mvw, P = A.player, { CATALOG } = await import('/shared/catalog.js');
        for (const e of A.inter.foc.entries) {
          const d = CATALOG[e.t]; if (!d.slots || !d.slots.length || e.t === 'desk_l') continue;
          const sl = d.slots[0]; if (!/^sit/.test(sl.anim)) continue;
          const c = Math.cos(e.yaw), s = Math.sin(e.yaw), ax = e.x + (sl.ax ?? sl.x) * c + (sl.az ?? sl.z) * s, az = e.z - (sl.ax ?? sl.x) * s + (sl.az ?? sl.z) * c;
          const sx = e.x + sl.x * c + sl.z * s, sz = e.z - sl.x * s + sl.z * c;
          let taken = false;
          for (let n = 0; n < A.agents.nDrawn; n++) { const i = A.agents.drawn[n]; if (Math.hypot(A.agents.rx[i] - sx, A.agents.rz[i] - sz) < 0.8) taken = true; }
          if (taken) continue;
          P.warp(ax, az, P.ctx); return { t: e.t };
        }
        return null;
      });
      check('found a free seat', !!seat, seat);
      await wait(500);
      await p.keyboard.press('KeyE');
      check('E sits down', await until(() => __mvw.player.state === 'use'), await ev(() => document.querySelector('#phud .prompt').textContent));
      await wait(900);
      await shot('10-play-sit');
      await p.keyboard.press('KeyE');
      check('E stands up', await until(() => __mvw.player.state === 'walk'));
      await wait(500);
      await p.keyboard.press('Space');
      check('Space jumps', await ev(() => performance.now() / 1000 - __mvw.player.jumpT < 1.5));
      await p.keyboard.press('Escape');
      check('Esc leaves play mode', await until(() => !__mvw.player.active && __mvw.S.mode === 'explore'));
      check('and the docks come back (I3.12)', await ev(() => getComputedStyle(document.querySelector('#dockR')).display !== 'none'));
    });

    // -------------------------------------------------------------- multiplayer, friends, status, proximity chat (WP1.10)
    await step('multiplayer', async () => {
      if (!server) return skip('multiplayer with two accounts', 'only on a throwaway server (it needs a second account)');
      const fresh = await api.post('/api/auth/reauth', { password: api.password });
      if (fresh.status !== 200) throw new Error(`temporary owner reauthentication failed: ${fresh.status}`);
      const mia = await T.userSession(server, api, { login: 'mia', displayName: 'Mia', role: 'member' });
      const q = await newPage({ width: 1200, height: 800 });
      try {
        await q.goto(`${base}/?hour=12`, { waitUntil: 'load' });
        await q.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 25000 });
        check('a guest page sees no online list (C118)', await q.evaluate(() => !document.querySelector('#dockR .dsec[data-sec="players"] .soc-guest').classList.contains('hidden')));
        await act('Mia: Sign in', q.click('#acct .signin', { timeout: 8000 }));
        await q.fill('.auth-back .login', 'mia');
        await q.fill('.auth-back .pw', mia.password);
        await q.click('.auth-back .go');
        const miaMe = await q.waitForFunction(() => __mvw.remote && __mvw.remote.me && __mvw.remote.me, null, { timeout: 15000 }).then(h => h.jsonValue(), () => null);
        check('a signed-in account gets its player in the shared world (I14.9)', !!miaMe, miaMe);
        if (!miaMe) return;
        // this page (UI Test) plays right next to Mia's player; Mia looks at the spot
        await ev(() => { if (document.activeElement) document.activeElement.blur(); });
        await p.keyboard.press('Digit4');
        check('play mode starts for the second test', await until(() => __mvw.player.active));
        const spot = await ev(async m => {
          const { PlayerNav } = await import('/shared/playernav.js');
          const nav = new PlayerNav(__mvw.S.world);
          for (let a = 0; a < 6.3; a += 0.3) { const x = m.x + Math.cos(a) * 3, z = m.z + Math.sin(a) * 3; if (nav.ok(x, z, -1)) return { x, z }; }
          return null;
        }, miaMe);
        check('a free spot next to Mia', !!spot, spot);
        await ev(sp => __mvw.player.warp(sp.x, sp.z, -1, 0), spot);
        await q.evaluate(m => __mvw.cam.jumpTo(m.x, 0, m.z, 40), miaMe);
        check('each page sees the other player with its display-name tag (I14.9)', await until(() =>
          [...document.querySelectorAll('#labels .tagname.player')].some(e => /Mia/.test(e.textContent)), null, 9000));
        check('Mia, not playing, stays in place with an "observing" marker (I14.9)', await ev(() =>
          [...document.querySelectorAll('#labels .tagname.player')].some(e => /Mia/.test(e.textContent) && e.classList.contains('obs') && /observing/.test(e.textContent))));
        check('and Mia sees UI Test walking the city (I14.9)', await q.waitForFunction(() =>
          [...document.querySelectorAll('#labels .tagname.player')].some(e => /UI Test/.test(e.textContent) && !e.classList.contains('obs')), null, { timeout: 9000 }).then(() => true, () => false));
        // walk along a line the nav says is free (face it, then hold W), and compare what Mia's page shows
        const line = await ev(async () => {
          const { PlayerNav } = await import('/shared/playernav.js');
          const nav = new PlayerNav(__mvw.S.world), P = __mvw.player;
          for (let a = 0; a < 6.3; a += 0.4) {
            let ok = true;
            for (let d = 0.5; d <= 4; d += 0.5) if (!nav.ok(P.x + Math.sin(a) * d, P.z + Math.cos(a) * d, -1)) { ok = false; break; }
            if (ok) return { yaw: a, x: P.x, z: P.z };
          }
          return null;
        });
        check('a free line to walk along', !!line, line);
        // the camera faces the line: W walks along camera-forward, so turn the camera to look along it
        await ev(l => { __mvw.cam.yaw = __mvw.cam.goalYaw = l.yaw + Math.PI; }, line);
        await wait(300);
        const own0 = await ev(() => ({ x: __mvw.player.x, z: __mvw.player.z }));
        const seen0 = await q.evaluate(() => { const r = [...__mvw.remote.byPid.values()].find(r => r.name === 'UI Test'); return r ? { x: r.extra.x, z: r.extra.z } : null; });
        await p.keyboard.down('KeyW'); await wait(1400); await p.keyboard.up('KeyW');
        const own1 = await ev(() => ({ x: __mvw.player.x, z: __mvw.player.z }));
        const walked = Math.hypot(own1.x - own0.x, own1.z - own0.z);
        check('the player walks on its own page at once (I14.10)', walked > 1, { walked: +walked.toFixed(2) });
        await wait(700);
        const seen1 = await q.evaluate(() => { const r = [...__mvw.remote.byPid.values()].find(r => r.name === 'UI Test'); return r ? { x: r.extra.x, z: r.extra.z } : null; });
        const gap = seen1 ? Math.hypot(seen1.x - own1.x, seen1.z - own1.z) : null;
        check('movement reaches the other page smoothly, where it really is (I14.10)', !!seen0 && !!seen1 && gap < 0.6 && Math.hypot(seen1.x - seen0.x, seen1.z - seen0.z) > walked * 0.7,
          { walked: +walked.toFixed(2), seenMoved: seen0 && seen1 ? +Math.hypot(seen1.x - seen0.x, seen1.z - seen0.z).toFixed(2) : null, gap: gap && +gap.toFixed(2) });
        check('an honest walk is never corrected (I14.10)', await ev(() => true) && (await api.get('/api/health')).json.players.corrections === 0, (await api.get('/api/health')).json.players);
        await shot('16a-multiplayer');
        // proximity chat: Enter opens the box in play mode
        await p.keyboard.press('Enter');
        check('Enter opens the proximity chat in play mode (C118)', await until(() => document.activeElement && document.activeElement.classList.contains('pc-in')));
        await p.keyboard.type('Hi Mia, nice day');
        await p.keyboard.press('Enter');
        check('a player within 20 m hears it as a bubble (C118)', await q.waitForFunction(() =>
          [...document.querySelectorAll('#labels .bubble')].some(b => /Hi Mia, nice day/.test(b.textContent)), null, { timeout: 6000 }).then(() => true, () => false));
        check('and in the chat log', await q.evaluate(() => __mvw.social.state.log.some(l => l.text === 'Hi Mia, nice day' && l.name === 'UI Test')));
        check('the speaker sees its own bubble', await until(() => [...document.querySelectorAll('#labels .bubble')].some(b => /You/.test(b.textContent) && /Hi Mia/.test(b.textContent))));
        await q.screenshot({ path: `${out}/16b-proximity-chat.png` });
        // the online list, friends
        await q.evaluate(() => __mvw.docks.show('r:players'));
        check('the online list shows who is here and where (C118)', await q.waitForFunction(() =>
          [...document.querySelectorAll('#dockR .soc-p')].some(e => /UI Test/.test(e.textContent) && /outside/.test(e.textContent)), null, { timeout: 6000 }).then(() => true, () => false));
        await q.fill('#dockR .soc-add .name', 'UI Test');
        await q.click('#dockR .soc-add button');
        await ev(() => __mvw.docks.show('r:players'));
        await p.keyboard.press('Escape');   // out of play mode: the docks come back
        await until(() => !__mvw.player.active);
        await ev(() => __mvw.docks.show('r:players'));
        check('a friend request arrives, to accept or decline (C118)', await until(() => [...document.querySelectorAll('#dockR .soc-r')].some(e => /Mia/.test(e.textContent) && e.querySelector('.acc'))));
        await ev(() => [...document.querySelectorAll('#dockR .soc-r')].find(e => /Mia/.test(e.textContent)).querySelector('.acc').click());
        check('accepted, they are friends on both sides (C118)', await until(() => [...document.querySelectorAll('#dockR .soc-f')].some(e => /Mia/.test(e.textContent) && /online/.test(e.textContent)))
          && await q.waitForFunction(() => [...document.querySelectorAll('#dockR .soc-f')].some(e => /UI Test/.test(e.textContent)), null, { timeout: 6000 }).then(() => true, () => false));
        check('friends come first in the online list, marked (C118)', await until(() => { const r = [...document.querySelectorAll('#dockR .soc-p')]; return r.length >= 2 && /\(you\)/.test(r[0].textContent) && /Mia/.test(r[1].textContent) && /⭐/.test(r[1].textContent); }));
        check('and the friend\'s tag in the world has a star', await until(() => [...document.querySelectorAll('#labels .tagname.player.friend')].some(e => /Mia/.test(e.textContent))));
        await ev(() => { const r = [...document.querySelectorAll('#labels .tagname.player')].find(e => /Mia/.test(e.textContent)); return !!r; });
        await shot('16c-friends-online');
        // Appear offline: an admin still sees her, marked
        await q.selectOption('#dockR .soc-status .status', 'invisible');
        check('Mia can appear offline (C118)', await q.waitForFunction(() => __mvw.social.state.status === 'invisible', null, { timeout: 6000 }).then(() => true, () => false));
        check('an admin still sees her, marked as appearing offline (C118)', await until(() => [...document.querySelectorAll('#dockR .soc-p')].some(e => /Mia/.test(e.textContent) && /appears offline/.test(e.textContent))));
        await q.selectOption('#dockR .soc-status .status', 'online');
        check('and back online', await q.waitForFunction(() => __mvw.social.state.status === 'online', null, { timeout: 6000 }).then(() => true, () => false));
        await q.waitForTimeout(800);   // its preference and log requests finish before it signs out (a request in flight at sign-out answers 401)
        await q.evaluate(() => __mvw.auth.signOut(false));
      } finally { await q.context().close(); }
      check('a player fades out when its person leaves (I14.9)', await until(() => ![...document.querySelectorAll('#dockR .soc-p')].some(e => /Mia/.test(e.textContent))
        && !(__mvw.remote && [...__mvw.remote.byPid.values()].some(r => r.name === 'Mia' && !r.gone)), null, 12000));
      await api.post('/api/friends/remove', { name: 'Mia' }).catch(() => {});   // the owner is not her friend: harmless
    });

    // -------------------------------------------------------------- Account settings (I14.2)
    // -------------------------------------------------------------- licence keys and demo mode (WP1.11)
    await step('licence', async () => {
      // this installation is licensed (the owner imported release 1's receipt): nothing is locked, admins see no key
      check('the installation is licensed: no watermark, editing unlocked (I15.1)', await ev(() =>
        __mvw.auth.me.licence && __mvw.auth.me.licence.active && document.getElementById('demo-mark').classList.contains('hidden') && !document.body.classList.contains('demo-locked')));
      await ev(() => __mvw.licence.open());
      check('Settings → License says licensed (I15.1)', await until(() => /Licensed/.test(document.querySelector('.st-body h4')?.textContent || '')));
      check('an admin who is not the owner sees neither the key nor the controls', await ev(() => !document.querySelector('.st-body .mono') && !document.querySelector('.deact') && !document.querySelector('.lic-act')));
      await shot('17a-licence-licensed');
      await p.keyboard.press('Escape');
      if (!server) return skip('demo mode on a second server', 'only with throwaway servers');
      // a second throwaway server in demo mode: the locks, visible but unusable (E19), and refused by the server
      const ds = await T.startServer({ population: 300, agents: 5, demo: true, timeoutMs: 60000 });
      const q = await newPage({ width: 1300, height: 820 });
      try {
        const o = await T.ownerSession(ds);
        allowHttp.push({ method: 'POST', path: '/api/undo', status: 403 });
        await q.goto(`${ds.url}/?hour=12`, { waitUntil: 'load' });
        await q.evaluate(async pw => { await fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }); }, o.password);
        await q.goto(`${ds.url}/?hour=12`, { waitUntil: 'load' });
        await q.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 60000 });
        const d = await q.evaluate(async () => {
          __mvw.docks.show('l:buildings');
          await new Promise(r => setTimeout(r, 300));
          const b = document.querySelector('#dockL .dsec[data-sec="buildings"] .dsec-b'), c = b && b.firstElementChild;
          const res = await fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': __mvw.auth.csrf }, body: '{}' });
          return { mark: !document.getElementById('demo-mark').classList.contains('hidden'), open: !!b && getComputedStyle(b).display !== 'none',
            usable: c ? getComputedStyle(c).pointerEvents !== 'none' : null, undo: (await res.json()).code, agents: __mvw.S.people.filter(x => x.v).length };
        });
        check('demo mode shows the watermark (I15.2)', d.mark, d);
        check('the edit panels open but are greyed out and unusable (E19)', d.open && d.usable === false, d);
        check('the server refuses an edit with the licence message (I15.2)', d.undo === 'licence_required', d);
        check('only 3 of the 5 agents are agents in demo mode (E19)', d.agents === 3, d);
        await q.evaluate(() => __mvw.licence.open());
        check('Settings → License offers the owner a key and a release 1 import', await q.waitForFunction(() => !!document.querySelector('.lic-act') && !!document.querySelector('.lic-file'), null, { timeout: 8000 }).then(() => true, () => false));
        await q.screenshot({ path: `${out}/17b-licence-demo.png` });
      } finally { await q.context().close(); await ds.stop(); }
    });

    // -------------------------------------------------------------- AI agents in the left dock (WP2.1)
    await step('agents', async () => {
      await ev(() => __mvw.docks.show('l:agents'));
      check('the Agents section lists the agents that live here (I8.8)', await until(() => document.querySelectorAll('.agrow').length >= 1));
      const n0 = await ev(() => document.querySelectorAll('.agrow').length);
      await p.click('.newagent');
      await p.fill('.agname', 'Uitest Agent'); await p.fill('.agrole', 'Tester');
      await p.click('.agok');
      check('a new agent appears in the list with its body (I8.8)', await until(() => [...document.querySelectorAll('.agrow .dn')].some(x => x.textContent === 'Uitest Agent')));
      const made = await ev(() => { const r = [...document.querySelectorAll('.agrow')].find(x => /Uitest Agent/.test(x.textContent)); return { i: +r.dataset.i, mine: !!r.querySelector('.agdel') }; });
      check('it has a body in the city and its owner can share and remove it', made.i >= 0 && made.mine, made);
      await shot('18a-agents-dock');
      p.once('dialog', d => d.accept());
      await ev(() => [...document.querySelectorAll('.agrow')].find(x => /Uitest Agent/.test(x.textContent)).querySelector('.agdel').click());
      check('removing it takes it off the list (its body is retired, its record kept)', await until(() => ![...document.querySelectorAll('.agrow .dn')].some(x => x.textContent === 'Uitest Agent')) && (await ev(() => document.querySelectorAll('.agrow').length)) === n0);
    });

    // -------------------------------------------------------------- Settings → Connections (WP2.2)
    await step('connections', async () => {
      await ev(() => __mvw.licence.open());
      await p.click('.st-tabs .tab[data-tab="connections"]');
      check('Settings → Connections lists every kind, drawn from the server (I8.1)', await until(() => document.querySelectorAll('.c-kind option').length >= 8));
      const kinds = await ev(() => [...document.querySelectorAll('.c-kind option')].map(o => o.textContent));
      check('a kind whose adapter is not built says which package brings it', kinds.some(k => /OpenClaw \(arrives in WP2\.4\)/.test(k)) && kinds.some(k => /Codex \(arrives in WP2\.6\)/.test(k)), kinds);
      await p.selectOption('.c-kind', 'openclaw');
      await p.fill('.c-label', 'Uitest gateway');
      await p.fill('#cf-token', 'tok-UITESTSECRET-1234');
      await p.click('.c-form button[type=submit]');
      check('the new connection is listed, and its credential shows only as set (I8.7)', await until(() => /Uitest gateway/.test(document.querySelector('.conn')?.innerText || '') && /token:\s*set/.test(document.querySelector('.conn').innerText)));
      const leaked = await ev(() => document.body.innerHTML.includes('UITESTSECRET') || [...document.querySelectorAll('input')].some(i => i.value.includes('UITESTSECRET')));
      check('the credential is nowhere on the page after saving', !leaked);
      await p.click('.c-test');
      check('Test says what to do while the adapter is not built', await until(() => /arrives in WP2\.4/.test(document.querySelector('.conn .c-out')?.textContent || '')));
      await shot('19a-connections');
      p.once('dialog', d => d.accept());
      await p.click('.c-del');
      check('removing it takes it off the list', await until(() => document.querySelectorAll('.conn').length === 0));
      await p.click('.st-foot .cancel');
    });

    // -------------------------------------------------------------- Settings → Connect your agent (WP2.14)
    await step('connect your agent', async () => {
      await ev(() => __mvw.licence.open());
      check('the Connect your agent tab is offered to a signed-in account (I8.14)', await until(() => !!document.querySelector('.st-tabs .tab[data-tab="agents"]')));
      await p.click('.st-tabs .tab[data-tab="agents"]');
      check('with no agents yet it says how to start', await until(() => /No agents yet/.test(document.querySelector('.st-body')?.innerText || '')));
      await p.fill('.a-name', 'Uitest agent');
      await p.click('.a-new button[type=submit]');
      check('a new agent shows its one-time code once', await until(() => /^mvwe_/.test(document.querySelector('[data-testid=agent-code]')?.textContent || '')));
      const code = await ev(() => document.querySelector('[data-testid=agent-code]').textContent);
      check('it starts hidden, owner only, waiting for the agent', await ev(() => document.querySelector('.a-vis').value === 'hidden' && document.querySelector('.a-aud').value === 'owner' && /Waiting for the agent to enrol/.test(document.querySelector('.agent-slot').innerText)));
      // copy the instructions straight from the page (2026-09-29): the clipboard is stubbed so the text can be read back
      await ev(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); });
      await p.click('[data-testid=copy-instructions]');
      check('the top button copies instructions with this world\'s address and the whole contract, and no code', await until(() => !!window.__copied) && await ev(() => window.__copied.includes(location.origin) && window.__copied.includes('Agent API v1') && window.__copied.includes('/api/agent-api/enroll') && !/mvwe_[A-Za-z0-9_-]{20,}/.test(window.__copied) && /Ask your owner/.test(window.__copied)));
      await ev(() => { window.__copied = null; });
      await p.click('.a-copy-prompt[data-with-code="1"]');
      check('the button beside the code copies the same instructions with that one-time code', await until(() => !!window.__copied) && await ev(c => window.__copied.includes(c) && window.__copied.includes('/api/agent-api/session') && window.__copied.split(c).length === 2 && window.__copied.includes('Uitest agent'), code));
      await ev(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true }); });
      await p.click('.a-copy-prompt[data-with-code="1"]');
      check('when the browser refuses the clipboard the text is shown selected to copy by hand', await until(() => { const t = document.querySelector('[data-testid=agent-prompt-text]'); return !!t && t.readOnly && t.value.includes('Agent API v1') && t.value.includes(location.origin); }));
      await ev(() => { const t = document.querySelector('[data-testid=agent-prompt-text]'); t.value = ''; });
      await p.selectOption('.a-vis', 'friends');
      await p.selectOption('.a-aud', 'friends');
      await p.click('.st-foot .cancel');
      await ev(() => __mvw.licence.open());
      await p.click('.st-tabs .tab[data-tab="agents"]');
      check('the choices are kept after reopening, and the code is not shown again (I8.15)', await until(() => document.querySelector('.a-vis')?.value === 'friends' && document.querySelector('.a-aud')?.value === 'friends') && !(await ev(c => document.body.innerHTML.includes(c), code)));
      const hidden = await ev(() => !document.querySelector('.c-kind') );
      await p.click('.st-tabs .tab[data-tab="connections"]');
      check('the connections page does not offer the connected-agent kind to add by hand', await until(() => document.querySelectorAll('.c-kind option').length >= 8) && !(await ev(() => [...document.querySelectorAll('.c-kind option')].some(o => /Connected agent/.test(o.textContent)))) && hidden);
      await p.click('.st-tabs .tab[data-tab="agents"]');
      await until(() => !!document.querySelector('.a-howto'));   // the tab has drawn before the picture is taken
      await shot('19b-connect-your-agent');
      p.once('dialog', d => d.accept());
      allowHttp = [{ method: 'POST', path: '/api/agent-slots/revoke', status: 403 }];
      const revokeResponse = p.waitForResponse(r => new URL(r.url()).pathname === '/api/agent-slots/revoke' && r.request().method() === 'POST');
      await p.click('.a-revoke');
      const firstRevoke = await revokeResponse;
      if (firstRevoke.status() === 403) {
        const refusal = await firstRevoke.json();
        check('disconnect requires real password freshness', refusal.code === 'reauth_required');
      } else check('fresh disconnect is accepted', firstRevoke.status() === 200);
      if (await until(() => /Confirm your password/.test(document.querySelector('.auth-back h3')?.textContent || ''), null, 2000)) {
        await p.fill('.auth-back .pw', ui.password);
        await p.click('.auth-back .go');
        check('disconnect answers the password challenge', await until(() => !document.querySelector('.auth-back')));
      }
      check('disconnecting shows the agent as disconnected', await until(() => /Disconnected \(key revoked\)/.test(document.querySelector('.agent-slot')?.innerText || '')));
      allowHttp = [];
      await p.click('.st-foot .cancel');
    });

    // -------------------------------------------------------------- a connected agent is listed and can be chatted with (2026-09-29)
    await step('chat with a connected agent', async () => {
      const crypto = require('node:crypto');
      const jn = async (method, path, body, tok) => { const r = await fetch(new URL(path, base), { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
      const made = await ev(() => import('/js/core/net.js').then(m => m.post('/api/agent-slots', { name: 'Chat agent' })));
      check('a new connected agent is not in the team list before it has enrolled', await ev(() => !/Chat agent/.test(document.querySelector('#roster')?.innerText || '')));
      const teamBefore = await ev(() => { const t = document.querySelector('#roster .cnt').textContent; return /working/.test(t) ? null : Number((/(\d+)/.exec(t) || [])[1]); });
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
      const en = await jn('POST', '/api/agent-api/enroll', { code: made.code, publicKey: pub, signature: crypto.sign(null, Buffer.from(`v1|enrol|${made.code}|${pub}`), privateKey).toString('base64url') });
      check('the agent enrols with its own key', en.status === 200, en.status);
      const slot = en.json.slot.id;
      check('once enrolled its resident shows in the team list as an agent, without reloading the page, and the count grew by one (WP2.10, the product owner 20:45)', await until(b => { const r = [...document.querySelectorAll('#roster .agent-row')].find(x => /Chat agent/.test(x.textContent)); if (!r) return false; const t = document.querySelector('#roster .cnt').textContent; return b === null || /working/.test(t) || Number((/(\d+)/.exec(t) || [])[1]) === b + 1; }, teamBefore), { teamBefore });
      check('a connected agent has a body in the city, so it is not listed as a bodiless one', await ev(() => !document.querySelector('#roster [data-ext]')));
      const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(12).toString('base64url');
      const ses = await jn('POST', '/api/agent-api/session', { slot, timestamp: ts, nonce, signature: crypto.sign(null, Buffer.from(`v1|session|${slot}|${ts}|${nonce}`), privateKey).toString('base64url') });
      const tok = ses.json.token;
      await shot('19c-connected-agent-team');
      await p.click('#roster .agent-row:has-text("Chat agent")');
      check('selecting it shows an AI agent with a Chat button', await until(() => /AI agent/.test(document.querySelector('.insp .ht')?.textContent || '') && !!document.querySelector('.insp .agchat:not(.hidden)')));
      await p.click('.insp .agchat');
      check('the Chat button opens its chat', await until(() => !!document.querySelector('#agentchat:not(.hidden)') && /Chat agent/.test(document.querySelector('#agentchat .ac-name')?.textContent || '')));
      check('the chat shows the agent Online once it has signed in', await until(() => /Online/.test(document.querySelector('#agentchat .ac-pill')?.textContent || '')));
      check('the chat opens ready for a first message', await until(() => /Say hello/.test(document.querySelector('#agentchat .ac-msgs')?.innerText || '')));
      await p.fill('#agentchat .ac-in', 'Please summarise the repo');
      const sent = p.waitForResponse(r => new URL(r.url()).pathname === '/api/providers/runs' && r.request().method() === 'POST');
      await p.click('#agentchat .ac-send');
      const sendResponse = await sent, sendBody = await sendResponse.json().catch(() => null);
      let got = { json: { messages: [] } };
      for (let i = 0; i < 15 && !got.json.messages.length; i++) got = await jn('GET', '/api/agent-api/inbox?wait=2', null, tok);
      const m = got.json.messages[0];
      check('the message reaches the agent, from its owner, not as a visitor', !!m && typeof m.runId === 'string' && m.text === 'Please summarise the repo' && m.sender?.visitor === false, m ? m.sender : { sendStatus: sendResponse.status(), code: sendBody?.code, error: sendBody?.error, inboxStatus: got.status });
      if (!m || typeof m.runId !== 'string') return; // Keep the failed delivery assertion; never hide it behind an unrelated runId TypeError.
      await jn('POST', '/api/agent-api/events', { type: 'run.progress', runId: m.runId, text: 'Reading files', pct: 30 }, tok);
      await jn('POST', '/api/agent-api/events', { type: 'approval.requested', runId: m.runId, approvalId: 'p1', tool: 'shell', summary: 'rm -rf build' }, tok);
      check('what the agent is doing and what it asks shows in the chat', await until(() => /Reading files|approval/i.test(document.querySelector('#agentchat .ac-msgs')?.innerText || '') && !!document.querySelector('#agentchat [data-appr]')));
      await shot('19d-connected-agent-chat');
      await p.click('#agentchat [data-appr][data-yes="1"]');
      const back = await jn('GET', '/api/agent-api/inbox?wait=3', null, tok);
      check('approving in the chat reaches the agent', JSON.stringify(back.json.approvals) === JSON.stringify([{ runId: m.runId, approvalId: 'p1', approved: true }]), back.json.approvals);
      await jn('POST', '/api/agent-api/events', { type: 'run.end', runId: m.runId, status: 'ok', text: 'The repo is a Node server with a browser client.' }, tok);
      check('the answer appears in the chat', await until(() => /Node server with a browser client/.test(document.querySelector('#agentchat .ac-msgs')?.innerText || '')));
      // an agent that ends a run 'interrupted' without a reason (the product owner 18:58): the chat says so plainly and does not blame a provider restart
      await p.fill('#agentchat .ac-in', 'Second question');
      await p.click('#agentchat .ac-send');
      let got2 = { json: { messages: [] } };
      for (let i = 0; i < 15 && !got2.json.messages.length; i++) got2 = await jn('GET', '/api/agent-api/inbox?wait=2', null, tok);
      await jn('POST', '/api/agent-api/events', { type: 'run.end', runId: got2.json.messages[0].runId, status: 'interrupted' }, tok);
      check('a run the agent ends without a reason says so in the chat, not "the provider restarted"', await until(() => { const t = document.querySelector('#agentchat .ac-msgs')?.innerText || ''; return /ended the run and gave no reason/.test(t) && !/provider restarted/.test(t); }));
      check('the panel is ready for the next message after a failed run', await until(() => !document.querySelector('#agentchat .ac-send.hidden') && document.querySelector('#agentchat .ac-stop.hidden') !== null));
      // a listener that sends its own answer and ends the run 'interrupted' (the product owner 19:27): the person reads the answer
      await p.fill('#agentchat .ac-in', 'Third question');
      await p.click('#agentchat .ac-send');
      let got3 = { json: { messages: [] } };
      for (let i = 0; i < 15 && !got3.json.messages.length; i++) got3 = await jn('GET', '/api/agent-api/inbox?wait=2', null, tok);
      await jn('POST', '/api/agent-api/events', { type: 'run.end', runId: got3.json.messages[0].runId, status: 'interrupted', text: 'Saved. Automatic replies are off.' }, tok);
      check('an answer the agent sends is shown even when it ended the run as interrupted', await until(() => /Saved\. Automatic replies are off\./.test(document.querySelector('#agentchat .ac-msgs')?.innerText || '') && !/provider restarted/.test(document.querySelector('#agentchat .ac-msgs')?.innerText || '')));
      await p.click('#agentchat .ac-set');
      check('the gear in the chat opens Settings on Connect your agent', await until(() => !!document.querySelector('.a-howto')));
      await p.click('.st-foot .cancel');
      await ev(async s => { const m = await import('/js/core/net.js'); await m.post('/api/agent-slots/revoke', { id: s }); }, slot);
      check('the resident of a disconnected agent is deselected instead of being polled for', await until(() => window.__mvw.S.sel < 0 && !document.querySelector('.insp:not(.hidden) .agchat:not(.hidden)')));
      check('disconnecting the agent takes its resident off the team list and closes its chat', await until(() => ![...document.querySelectorAll('#roster .agent-row')].some(x => /Chat agent/.test(x.textContent)) && !!document.querySelector('#agentchat.hidden')));
    });

    await step('account settings', async () => {
      await p.click('#acct .me');
      await p.click('#acctmenu .settings');
      check('Account settings open from the account menu', await until(() => /Account settings/.test(document.querySelector('.auth-back h3')?.textContent || '')));
      check('the devices list shows this browser', await until(() => [...document.querySelectorAll('.auth-back .devices .dev')].some(d => /this device/.test(d.textContent))),
        await ev(() => document.querySelector('.auth-back .devices')?.textContent));
      await p.fill('.auth-back .dn', 'UI Tester');
      await p.click('.auth-back .savename');
      check('the display name changes', await until(() => (document.querySelector('#acct .me .nm')?.textContent || '') === 'UI Tester'));
      await shot('10a-account-settings');
      await p.click('.auth-back .pwbtn');
      check('Change password asks for the current password', await until(() => /Change password/.test(document.querySelector('.auth-back h3')?.textContent || '') && !!document.querySelector('.auth-back .cur:not([hidden])')));
      const next = T.strongPassword();
      await p.fill('.auth-back .cur', ui.password);
      await p.fill('.auth-back .npw', next);
      await p.fill('.auth-back .npw2', next);
      await p.click('.auth-back .go');
      check('the password changes', await until(() => !document.querySelector('.auth-back') && [...document.querySelectorAll('#toasts .toast')].some(t => /Password saved/.test(t.textContent))));
      ui.password = next;
    });

    // -------------------------------------------------------------- WP1.4: Admin → Users, invites, settings, audit, two-factor, data rights, ownership
    const TOTP = await import('../server/auth/totp.js');
    let invited = null, tf = null;
    const hasToast = re => ev(r => [...document.querySelectorAll('#toasts .toast')].some(t => new RegExp(r).test(t.textContent)), re.source);
    const openAdminTab = async tab => {
      if (!(await ev(() => !!document.querySelector('.auth-back .adm')))) {
        await p.click('#acct .me');
        await p.click('#acctmenu .adminbtn');
        await until(() => !!document.querySelector('.auth-back .adm'));
      }
      await p.click(`.adm-tabs [data-tab="${tab}"]`);
      await wait(500);
    };
    const userRow = login => `.adm-table.users tbody tr:has(code:text-is("${login}"))`;
    await step('admin users', async () => {
      await openAdminTab('users');
      check('Admin → Users lists the accounts', await until(() => document.querySelectorAll('.adm-table.users tbody tr').length >= 2));
      await p.fill('.adm .create .login', 'uitmember');
      await p.fill('.adm .create .name', 'UIT Member');
      await p.click('.adm .create button[type=submit]');
      check('creating an account shows its temporary password once', await until(() => /Temporary password for uitmember/.test(document.querySelector('.adm-note')?.textContent || '')));
      await p.click(`${userRow('uitmember')} button[data-a="reset"]`);
      check('resetting shows a new temporary password', await until(() => /New temporary password for uitmember/.test(document.querySelector('.adm-note')?.textContent || '')));
      await p.click(`${userRow('uitmember')} button[data-a="disable"]`);
      check('an account can be disabled', await until(() => [...document.querySelectorAll('.adm-table.users tbody tr')].some(tr => /uitmember/.test(tr.textContent) && /disabled/.test(tr.textContent))));
      await p.click(`${userRow('uitmember')} button[data-a="enable"]`);
      check('and enabled again', await until(() => [...document.querySelectorAll('.adm-table.users tbody tr')].some(tr => /uitmember/.test(tr.textContent) && !/disabled/.test(tr.textContent))));
      await p.fill('.adm .search', 'uitm');
      check('search filters the list', await until(() => document.querySelectorAll('.adm-table.users tbody tr').length === 1));
      await p.fill('.adm .search', '');
      await shot('10d-admin-users');
      await p.click(`${userRow('uitmember')} button[data-a="delete"]`);
      await p.click('.adm-note .godel');
      check('an account can be deleted', await until(() => ![...document.querySelectorAll('.adm-table.users tbody tr')].some(tr => /uitmember/.test(tr.textContent))));
    });
    await step('invites', async () => {
      await openAdminTab('invites');
      await p.fill('.adm .create .note', 'uitest invite');
      await p.click('.adm .create button[type=submit]');
      check('creating an invite shows its link once', await until(() => /#invite=/.test(document.querySelector('.adm-note code.val')?.textContent || '')));
      const link = await ev(() => document.querySelector('.adm-note code.val').textContent);
      const p2 = await newPage({ width: 1200, height: 800 });
      try {
        await p2.goto(link, { waitUntil: 'load' });
        await p2.waitForSelector('.auth-back .login', { timeout: 20000 });
        check('the invite link opens "You are invited"', /invited/i.test(await p2.textContent('.auth-back h3')));
        const box = await p2.evaluate(() => { const r = document.querySelector('#acct').getBoundingClientRect(); return { right: r.right, width: innerWidth }; });
        check('the account area stays on screen at 1200 px', box.right > 0 && box.right <= box.width, box);
        const ipw = T.strongPassword();
        await p2.fill('.auth-back .login', 'uitinvited');
        await p2.fill('.auth-back .dn', 'UIT Invited');
        await p2.fill('.auth-back .npw', ipw);
        await p2.fill('.auth-back .npw2', ipw);
        await p2.click('.auth-back .go');
        check('accepting the invite creates the account and signs it in', await p2.waitForFunction(() => (document.querySelector('#acct .me .nm')?.textContent || '') === 'UIT Invited', null, { timeout: 10000 }).then(() => true, () => false));
        check('the invite leaves the address bar', !(await p2.evaluate(() => location.href.includes('invite'))));
        invited = { page: p2, password: ipw };
      } catch (e) { await p2.context().close(); throw e; }
      await openAdminTab('invites');
      check('the invite shows as used', await until(() => [...document.querySelectorAll('.adm-table tbody tr')].some(tr => /used by uitinvited/.test(tr.textContent))));
    });
    await step('settings', async () => {
      await openAdminTab('settings');
      const geo = await ev(() => {
        const m = document.querySelector('.modal.auth.settings'), r = m.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), tabs: document.querySelectorAll('.st-tabs .tab').length,
          inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      });
      check('Settings is one compact dialog, tabs at the side, inside the screen (I3.5)', geo.w <= 780 && geo.h <= 580 && geo.tabs >= 6 && geo.inside, geo);
      check('open self-registration is off by default', !(await p.isChecked('.adm .reg')));
      await p.check('.adm .reg');
      check('an admin can switch it on', await until(r => [...document.querySelectorAll('#toasts .toast')].some(t => /Open registration is on/.test(t.textContent))));
      const g = await newPage({ width: 1000, height: 700 });
      try {
        await g.goto(`${base}/?hour=12`, { waitUntil: 'load' });
        await g.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 25000 });
        await g.click('#acct .signin');
        check('then sign-in offers "Create an account"', await g.waitForSelector('.auth-back .register', { timeout: 5000 }).then(() => true, () => false));
      } finally { await g.context().close(); }
      await p.uncheck('.adm .reg');
      check('and switch it off again', await until(() => [...document.querySelectorAll('#toasts .toast')].some(t => /Open registration is off/.test(t.textContent))));
      const view = await ev(() => {
        const heads = [...document.querySelectorAll('.adm .tier-head')].map(e => e.textContent);
        const keep = document.querySelector('.adm select.keep');
        const why = keep && keep.closest('label') && keep.closest('label').nextElementSibling;
        return { heads, keepDisabled: !!(keep && keep.disabled), why: why ? why.textContent : null, key: document.querySelector('.adm .keyinfo')?.textContent || '' };
      });
      check('settings are grouped by tier (WP1.5)', view.heads.some(h => /How this installation runs/.test(h)), view.heads);
      check('owner-only settings show to admins, disabled, saying why', view.keepDisabled && /Only the owner can change this/.test(view.why || ''), view);
      check('the key for stored secrets is named only by its fingerprint', /encrypted with key [0-9a-f]{12}\b/.test(view.key), view.key.slice(0, 140));
      await shot('10g-settings');
    });

    await step('tab capabilities', async () => {
      await openAdminTab('users');
      check('an admin sees the tabs their role allows (I3.5)', await until(() => document.querySelectorAll('.st-tabs .tab').length >= 4));
      const tabs = await ev(() => [...document.querySelectorAll('.st-tabs .tab')].map(b => b.dataset.tab));
      check('and the owner-only tabs stay hidden (I14.3)', !tabs.includes('permissions') && !tabs.includes('data') && tabs.includes('users') && tabs.includes('settings'), tabs);
    });
    await step('preferences follow the account', async () => {
      await act('close Admin', p.click('.auth-back .cancel', { timeout: 8000 }));
      await until(() => !document.querySelector('.auth-back'));
      const before = await ev(() => __mvw.S.labels);
      await p.keyboard.press('l');
      check('L switches name labels', await until(v => __mvw.S.labels === !v, before));
      check('the choice is saved with the account', await until(async v => {
        const r = await fetch('/api/account/settings', { cache: 'no-store' });
        const j = await r.json();
        return j.settings.find(x => x.path === 'display.labels').value === !v;
      }, before));
      const q = await newPage({ width: 1200, height: 800 });
      try {
        await q.bringToFront();
        await q.goto(`${base}/?hour=12`, { waitUntil: 'load' });
        await q.waitForFunction(() => window.__mvw?.ready && __mvw.agents.chars.loaded, null, { timeout: 25000 });
        const guest = await q.evaluate(() => __mvw.S.labels);
        await act('second device: Sign in', q.click('#acct .signin', { timeout: 8000 }));
        await q.fill('.auth-back .login', ui.login);
        await q.fill('.auth-back .pw', ui.password);
        await q.click('.auth-back .go');
        check('another device takes the account\'s choice at sign-in', await q.waitForFunction(v => __mvw.S.labels === v, !before, { timeout: 10000 }).then(() => true, () => false), { guest });
        check('and the second device shows it', await q.evaluate(v => __mvw.S.labels === v, !before));
      } finally { await closeAccountTestPage(q, base, T.httpClient); }
      await p.keyboard.press('l');
      check('and L switches them back', await until(v => __mvw.S.labels === v, before));
    });
    await step('audit log', async () => {
      await openAdminTab('audit');
      check('the audit log shows events', await until(() => document.querySelectorAll('.adm-table.audit tbody tr').length > 5));
      await shot('10f-audit');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('.adm .csv')]);
      const text = fs.readFileSync(await dl.path(), 'utf8');
      check('Export downloads the events as CSV', /^id,time,actor_id,actor,action/.test(text) && text.includes('invite.accept'), text.slice(0, 60));
      await p.click('.auth-back .cancel');
    });
    await step('two-factor sign-in', async () => {
      await p.click('#acct .me');
      await p.click('#acctmenu .settings');
      await until(() => !!document.querySelector('.auth-back .tfaon'));
      capturing = true;   // from here on, every answer and live-stream frame is kept for the secret checks
      await p.click('.auth-back .tfaon');
      check('setup shows a QR code and the key', await until(() => !!document.querySelector('.auth-back .qr svg') && !!document.querySelector('.auth-back code.key')));
      await shot('10e-twofa-setup');
      const spaced = await ev(() => document.querySelector('.auth-back code.key').textContent.trim());
      tf = { spaced, secret: spaced.replace(/\s/g, ''), codes: [] };
      const key = TOTP.base32Decode(tf.secret);
      await p.fill('.auth-back .code', TOTP.totp(key, Date.now()));
      await p.click('.auth-back .go');
      check('turning it on shows ten recovery codes', await until(() => document.querySelectorAll('.auth-back .codes code').length === 10));
      tf.codes = await ev(() => [...document.querySelectorAll('.auth-back .codes code')].map(c => c.textContent.trim()));
      await p.click('.auth-back .done');
      await p.click('#acct .me');
      await p.click('#acctmenu .out');
      await until(() => !!document.querySelector('#acct .signin'));
      await p.click('#acct .signin');
      await p.fill('.auth-back .login', ui.login);
      await p.fill('.auth-back .pw', ui.password);
      await p.click('.auth-back .go');
      check('signing in then asks for the code', await until(() => !!document.querySelector('.auth-back .code')));
      await p.fill('.auth-back .code', TOTP.totp(key, Date.now() + 30000));
      await p.click('.auth-back .go');
      check('the code signs in', await until(() => !document.querySelector('.auth-back') && !!document.querySelector('#acct .me .nm')));
      await p.click('#acct .me');
      await p.click('#acctmenu .settings');
      await until(() => !!document.querySelector('.auth-back .tfaoff'));
      await p.click('.auth-back .tfaoff');
      check('two-factor can be turned off again', await until(() => !!document.querySelector('.auth-back .tfaon')));
      await p.click('.auth-back .cancel');
    });
    await step('data rights', async () => {
      await p.click('#acct .me');
      await p.click('#acctmenu .settings');
      await until(() => !!document.querySelector('.auth-back .export'));
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('.auth-back .export')]);
      const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      check('Download my data gives the account, its devices and its audit events', data.account && data.account.login === ui.login && Array.isArray(data.devices) && data.auditEvents.length > 0, Object.keys(data));
      await act('close Account settings', p.click('.auth-back .cancel', { timeout: 8000 }));
    });
    await step('delete my account', async () => {
      if (!invited) return skip('delete my account', 'no invited account');
      const q = invited.page;
      try {
        await act('invited: account chip', q.click('#acct .me', { timeout: 8000 }));
        await act('invited: Account settings', q.click('#acctmenu .settings', { timeout: 8000 }));
        await act('invited: Delete my account', q.click('.auth-back .delacct', { timeout: 8000 }));
        await act('invited: password', q.fill('.auth-back .delpw', invited.password, { timeout: 8000 }));
        await act('invited: Delete', q.click('.auth-back .godel', { timeout: 8000 }));
        check('Delete my account signs out', await q.waitForSelector('#acct .signin', { timeout: 10000 }).then(() => true, () => false));
        check('and the account is gone', (await T.httpClient(base).post('/api/auth/signin', { login: 'uitinvited', password: invited.password })).status === 401);
      } catch (e) {
        await q.screenshot({ path: `${out}/fail-delete-account.png` }).catch(() => {});
        throw e;
      } finally { await q.context().close(); invited = null; }
    });
    await step('ownership transfer', async () => {
      if (!server) return skip('ownership transfer', 'only on a throwaway server (it needs the owner)');
      const o = await newPage({ width: 1300, height: 820 });
      try {
        await o.goto(`${base}/?hour=12`, { waitUntil: 'load' });
        await o.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 25000 });
        await o.click('#acct .signin');
        await o.fill('.auth-back .login', 'owner');
        await o.fill('.auth-back .pw', api.password);
        await o.click('.auth-back .go');
        await o.waitForSelector('#acct .me', { timeout: 10000 });
        await o.click('#acct .me');
        await o.click('#acctmenu .adminbtn');
        await o.waitForSelector(`${userRow(ui.login)} button[data-a="transfer"]`, { timeout: 10000 });
        await o.click(`${userRow(ui.login)} button[data-a="transfer"]`);
        await o.click('.adm-note .gotr');
        check('the owner hands ownership to an admin in Admin → Users', await o.waitForFunction(() => (document.querySelector('#acct .me .rl')?.textContent || '') === 'Admin', null, { timeout: 10000 }).then(() => true, () => false));
        check('the new owner\'s page shows it', await until(() => (document.querySelector('#acct .me .rl')?.textContent || '') === 'Owner', null, 8000));
      } finally { await o.context().close(); }
    });

    await step('permissions as the owner', async () => {
      allowHttp = [{ method: 'POST', path: '/api/permissions', status: 403 }];   // the confirmed password the change asks for
      await openAdminTab('permissions');
      check('the owner sees the Permissions tab (I14.3)', await until(() => document.querySelectorAll('.adm-table.perms tbody tr').length >= 10));
      const view = await ev(() => ({
        rows: document.querySelectorAll('.adm-table.perms tbody tr').length,
        selects: document.querySelectorAll('.adm-table.perms select.min').length,
        noSelect: [...document.querySelectorAll('.adm-table.perms tbody tr')].filter(r => !r.querySelector('select')).length,
        guestDisabled: [...document.querySelectorAll('.adm-table.perms select.min option[value="guest"]')].filter(o => o.disabled).length,
      }));
      check('every capability shows a minimum role; fixed ones are read-only and identity ones cannot drop to guest (I14.3)',
        view.rows >= 10 && view.selects >= 5 && view.noSelect >= 2 && view.guestDisabled >= 1, view);
      const before = await ev(() => { const s = document.querySelector('.adm-table.perms select.min[data-cap="world.clock"]'); return s ? s.value : null; });
      if (before) {
        await p.selectOption('.adm-table.perms select.min[data-cap="world.clock"]', 'owner');
        if (await until(() => !!document.querySelector('.auth-back .cur'), null, 3000)) {
          await p.fill('.auth-back .cur', ui.password);
          await p.click('.auth-back .go');
        }
        check('changing a minimum role asks for the password and is saved',
          await until(() => [...document.querySelectorAll('#toasts .toast')].some(t => /world\.clock: owner and above/.test(t.textContent))));
        await p.selectOption('.adm-table.perms select.min[data-cap="world.clock"]', before);
        if (await until(() => !!document.querySelector('.auth-back .cur'), null, 3000)) {
          await p.fill('.auth-back .cur', ui.password);
          await p.click('.auth-back .go');
        }
        await wait(600);
      } else check('the world clock capability is listed', false);
      await shot('15-permissions');
      allowHttp = [];
    });

    // -------------------------------------------------------------- a session revoked while in use; require sign-in to watch
    let other = null;
    await step('session revoked', async () => {
      await ev(() => { window.__noReload = 1; });
      other = T.httpClient(base);
      await other.signIn(ui.login, ui.password);
      const devs = (await other.get('/api/account/devices')).json.devices;
      const target = devs.find(d => !d.current && /HeadlessChrome/.test(d.userAgent || ''));
      if (!target) return skip('session revoked', 'could not tell the browser session apart from others');
      await other.post('/api/account/devices/revoke', { id: target.id });
      check('a revoked session tells the page', await until(() => [...document.querySelectorAll('#toasts .toast')].some(t => /signed out/i.test(t.textContent)), null, 8000));
      await wait(2500);
      const s = await ev(() => ({ same: window.__noReload === 1, signin: !!document.querySelector('#acct .signin'), edit: __mvw.auth.can('world.edit'), connected: __mvw.net.connected }));
      check('the page continues as a guest, without reloading or reconnect loops', s.same && s.signin && !s.edit && s.connected, s);
      await shot('10b-signed-out');
    });
    await step('require sign-in to watch', async () => {
      if (!other) return skip('require sign-in to watch', 'no signed-in helper');
      const r = await other.post('/api/settings/world', { requireSignIn: true });
      if (r.status !== 200) return skip('require sign-in to watch', `the test account may not change world settings (${r.status})`);
      allowHttp = [{ method: 'GET', path: '*', status: 401 }];   // a guest page may be polling when watching starts to need sign-in
      try {
        check('an open guest page asks for sign-in when watching needs it', await until(() => /Sign in to watch/.test(document.querySelector('.auth-back .why')?.textContent || ''), null, 8000));
        check('and does not reconnect in a loop', await ev(() => __mvw.net.needsSignIn === true && !__mvw.net.connected));
        await p.reload({ waitUntil: 'load' });
        await p.waitForSelector('.auth-back .login', { timeout: 15000 });
        check('opening the page asks for sign-in before the world', await ev(() => !(window.__mvw && window.__mvw.ready)));
        await shot('10c-signin-to-watch');
        await p.fill('.auth-back .login', ui.login);
        await p.fill('.auth-back .pw', ui.password);
        await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 20000 }), p.click('.auth-back .go')]);
        check('after signing in the world loads', await until(() => window.__mvw && window.__mvw.ready, null, 25000));
      } finally {
        await other.post('/api/settings/world', { requireSignIn: false });
        allowHttp = [];
      }
    });
    await step('sign out everywhere', async () => {
      if (!(await ev(() => !!document.querySelector('#acct .me')))) return skip('sign out everywhere', 'the page is not signed in');
      await p.click('#acct .me');
      await p.click('#acctmenu .settings');
      await until(() => !!document.querySelector('.auth-back .outall'));
      await p.click('.auth-back .outall');
      check('Sign out everywhere signs this page out', await until(() => !!document.querySelector('#acct .signin') && !__mvw.auth.account));
      check('and every other device of the account', other ? (await other.get('/api/account/devices')).status === 401 : true);
    });

    // -------------------------------------------------------------- night, low quality, phone layout
    await step('night', async () => {
      await p.goto(`${base}/?hour=21.5&cam=40,-20,160,0.8,0.8`, { waitUntil: 'load' });
      await until(() => window.__mvw && window.__mvw.ready, null, 25000); await wait(3500);
      await shot('11-night');
      check('night view renders', await ev(() => __mvw.stage.state.night > 0.8), await ev(() => __mvw.stage.state.night));
    });
    await step('low quality', async () => {
      await p.goto(`${base}/?q=low&hour=10`, { waitUntil: 'load' });
      await until(() => window.__mvw && window.__mvw.ready, null, 25000); await wait(3500);
      const s = await ev(() => ({ fps: Math.round(__mvw.fps), q: __mvw.stage.q.name, calls: __mvw.stage.renderer.info.render.calls }));
      check('low quality runs', s.q === 'low' && s.fps > 30, s);
      await shot('12-low');
    });
    await step('phone', async () => {
      await p.context().close();
      p = await newPage({ width: 390, height: 844 }, { isMobile: true, hasTouch: true });
      await p.goto(`${base}/?hour=12`, { waitUntil: 'load' });
      check('phone boots', await until(() => window.__mvw && window.__mvw.ready, null, 25000));
      await wait(3500);
      const s = await ev(() => {
        const dr = document.querySelector('#dockR'), t = document.querySelector('#dockR .dock-toggle'), r = t.getBoundingClientRect();
        return { fps: Math.round(__mvw.fps), closed: dr.classList.contains('closed'), q: __mvw.stage.q.name, sections: document.querySelectorAll('#dockR .dsec').length,
          toggle: { w: Math.round(r.width), h: Math.round(r.height), on: r.left >= 0 && r.right <= innerWidth + 1 } };
      });
      check('phone layout starts with the info drawer closed (I3.6)', s.closed === true && s.sections === 7, s);
      check('on a phone undo and redo leave the top bar for the edit drawer (I3.6, I3.8)', await ev(() =>
        getComputedStyle(document.querySelector('#topbar .undo')).display === 'none' && document.querySelectorAll('#dockL .dock-undo .btn').length === 2));
      check('and its edge button is on screen with a 48x48 tap target (I3.6)', s.toggle.on && s.toggle.w >= 48 && s.toggle.h >= 48, s.toggle);
      await p.click('#dockR .dock-toggle');
      check('tapping the edge opens the drawer', await until(() => !document.querySelector('#dockR').classList.contains('closed')));
      await shot('13b-phone-drawer');
      await wait(500);   // the drawer slides in 0.18 s
      const strip = await ev(() => ({ left: Math.round(document.querySelector('#dockR').getBoundingClientRect().left), scrim: !!document.querySelector('.dock-scrim:not(.hidden)'), other: getComputedStyle(document.querySelector('#dockL .dock-toggle')).display }));
      check('an open drawer is the only thing on screen on a phone (I3.6)', strip.scrim && strip.other === 'none' && strip.left > 30, strip);
      check('the counts and the time controls are in the drawer, not the bar',
        await ev(() => !!document.querySelector('#dockR .dock-strip #stats') && document.querySelectorAll('#topbar #speed .btn').length === 2));
      await p.click('.dock-scrim', { position: { x: 20, y: 700 } });
      check('a tap beside the drawer closes it (I3.6)', await until(() => document.querySelector('#dockR').classList.contains('closed')));
      await p.click('#topbar .helpb');
      check('the help sheet opens on a phone and its Close button is on screen (I3.6)', await until(() => {
        const h = document.querySelector('#help');
        if (!h || h.classList.contains('hidden')) return false;
        const b = h.querySelector('h3 button').getBoundingClientRect();
        return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0;
      }));
      await shot('13c-phone-help');
      await p.click('#help h3 button');
      await wait(300);
      check('phone defaults to medium quality (fix of 2026-09-26)', s.q === 'medium', s);
      const facade = await probeFacadeSeeds(p);
      check('Medium: facade window seeds are uniform across each pane', facade.quality === 'medium' && facade.cases === 96 && facade.failed.length === 0 && facade.badPrograms === 0, facade);
      const chip = await ev(() => { const b = document.querySelector('#acct .signin'); if (!b) return null; const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, visible: r.width > 0 && getComputedStyle(b).visibility !== 'hidden' }; });
      check('the Sign in button stays on screen on a phone', chip && chip.visible && chip.left >= 0 && chip.right <= chip.width, chip);
      await shot('13-phone');
    });

    // -------------------------------------------------------------- no secret in answers, live-stream frames or logs (I14.16)
    await step('no secret leaks', async () => {
      if (!tf || !tf.secret) return skip('no secret leaks', 'the two-factor step did not run');
      if (server) {   // what the owner can fetch afterwards
        for (const url of ['/api/audit?format=jsonl&limit=5000', '/api/audit?format=csv&limit=5000', '/api/users', '/api/settings', '/api/health']) {
          const r = await api.get(url);
          net.push({ method: 'GET', path: `${url.split('?')[0]} (owner)`, t: r.text });
        }
      }
      await wait(500);
      const where = s => [...new Set(net.filter(x => x.t && x.t.includes(s)).map(x => `${x.method} ${x.path}`))];
      check('answers and frames were captured', net.filter(x => x.t).length > 20, net.length);
      const sHits = [...new Set([...where(tf.secret), ...where(tf.spaced)])];
      check('the two-factor secret reached only its one-time setup answer', sHits.length === 1 && sHits[0] === 'POST /api/account/2fa/setup', sHits);
      const cHits = [...new Set(tf.codes.flatMap(where))];
      check('the recovery codes reached only the answer that created them', tf.codes.length === 10 && cHits.length === 1 && cHits[0] === 'POST /api/account/2fa/enable', cHits);
      if (server) {
        const log = server.log();
        check('the server log holds neither', !log.includes(tf.secret) && !log.includes(tf.spaced) && !tf.codes.some(c => log.includes(c)));
        const k = server.keyFile && fs.existsSync(server.keyFile) ? fs.readFileSync(server.keyFile, 'utf8').trim() : null;
        check('the key for stored secrets appears in no answer and not in the log', !!k && !net.some(x => x.t && x.t.includes(k)) && !log.includes(k));
      }
    });
  } finally {
    await browser.close();
    if (server) await server.stop();
  }

  const bad = results.filter(r => !r.ok), skipped = results.filter(r => r.skipped);
  const errs = [...new Set(errors)];
  console.log(`\n${results.length - bad.length - skipped.length}/${results.length - skipped.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
  console.log(errs.length ? 'Console errors:\n' + errs.slice(0, 20).join('\n') : 'No console errors');
  console.log(`screenshots: ${out}`);
  if (o.report) {
    fs.writeFileSync(o.report, JSON.stringify({
      at: new Date().toISOString(), url: server ? 'throwaway server' : base, data: o.data || null, gpu, software: isSoftware(gpu),
      passed: results.length - bad.length - skipped.length, failed: bad.length, skipped: skipped.length, consoleErrors: errs, results,
    }, null, 2) + '\n');
  }
  process.exit(bad.length || errs.length ? 1 : 0);
})().catch(e => { console.error('UITEST ERR', e.stack || e.message); process.exit(1); });
