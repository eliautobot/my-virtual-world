// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Working a shift (docs/features/ECONOMY.md §8; shared/work.js, server/economy/jobs.js): the mini-game panel at the foot
// of the screen while a player works a role at a venue - barista, chef, server, cashier, trainer. Each order's steps are
// played here (a timing bar to stop in the green, a meter to hold until the band, a choice remembered from what the
// customer said, a sequence tapped in the order shown); only the raw inputs go to the server, which scores them and
// pays at the end of the shift. Space or Enter stops a needle; the panel never covers the middle of the world.
//
// A work module with its own screen (docs/features/WORK-MODULES.md: a 3D kitchen, a cinema's box office) registers a
// game: app.work.registerGame(ui, { open(el, session, api) → { close() } }); api.submit(reports) serves the current order
// (resolves { result, session }), api.end() ends the shift. Sessions whose module's ui has no game use the step panel.
import { h, esc } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { needleAt, meterAt } from '/shared/work.js';

let app = null, W = null;
const GAMES = new Map();   // a module's ui → its game
const vc = n => app?.econ?.vc ? app.econ.vc(n) : `${(n / 100).toFixed(2)} VC`;
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

export function init(a) {
  app = a;
  app.work = { start, resume, board: () => getJSON('/api/economy/jobs/board'), active: () => W?.session || null,
    registerGame(ui, game) { if (typeof ui === 'string' && typeof game?.open === 'function') GAMES.set(ui, game); } };
  // a shift left open (a reload) carries on
  setTimeout(() => resume().catch(() => {}), 1500);
}
/** Starts a shift: role at business (the player must be there; the server says where to go if not). */
async function start(business, role) {
  if (W) { app.toast?.('You are already working a shift.'); return null; }
  try {
    const r = await post('/api/economy/work/start', { business, role });
    open(r.session);
    return r.session;
  } catch (x) {
    if (x.code === 'not_here') {
      app.toast?.(x.message, '', 4200);
      const biz = await getJSON(`/api/economy/business/${encodeURIComponent(business)}`).then(j => j.business).catch(() => null), B = biz && app.S?.world?.buildings?.[biz.b];
      if (B && app.worldmap?.setWaypoint) app.worldmap.setWaypoint(B.x, B.z, `Your shift at ${biz.name}`);
    }
    else if (!x.quiet) app.toast?.(x.message, 'bad', 4200);
    return null;
  }
}
async function resume() {
  if (W || !app.econ?.status()?.enabled) return;
  const me = await getJSON('/api/economy/jobs/me').catch(() => null);
  if (me?.active?.mode === 'play') open(me.active);
}

// ------------------------------------------------------------------ the panel
function open(session) {
  close();
  const el = document.getElementById('ui').appendChild(h(`<div id="workpanel" class="panel" role="region" aria-label="Your shift"></div>`));
  const game = session.ui && session.ui !== 'steps' ? GAMES.get(session.ui) : null;
  if (game) {   // the module's own screen: it plays the orders and hands the raw reports to the server through the api
    W = { el, session, game: null, custom: true };
    const api = {
      submit: async reports => { const r = await post('/api/economy/work/act', { session: W.session.id, n: W.session.n, reports }); W.session = r.session; return r; },
      end: () => end(),
    };
    W.game = game.open(el, session, api) || null;
    return;
  }
  W = { el, session, step: 0, reports: [], t0: 0, raf: 0, busy: false, holdAt: 0, seqPicks: [], phase: 'order' };
  el.addEventListener('click', onClick);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  app.hooks?.key.unshift(onKey);
  renderOrder();
}
function close() {
  if (!W) return;
  if (W.custom) { try { W.game?.close?.(); } catch { /* its own */ } W.el.remove(); W = null; return; }
  cancelAnimationFrame(W.raf);
  W.el.remove();
  const i = app.hooks?.key.indexOf(onKey); if (i >= 0) app.hooks.key.splice(i, 1);
  W = null;
}
function head() {
  const s = W.session;
  return `<div class="wk-head"><b>${esc(s.roleLabel)} · ${esc(s.business?.name || '')}</b><span class="dim">${s.served} ${esc(s.served === 1 ? s.unit : s.units)}${s.avgStars ? ` · ${s.avgStars} ★` : ''}${s.tips ? ` · tips ${vc(s.tips)}` : ''}${s.waiting ? ` · ${s.waiting} waiting` : ''}</span><button type="button" class="btn small" data-w="end">End shift</button></div>`;
}
function renderOrder() {
  const o = W.session.order;
  if (!o) { W.el.innerHTML = `${head()}<p class="hint">No order right now.</p>`; return; }
  const st = o.steps[W.step];
  W.el.innerHTML = `${head()}
    <div class="wk-order"><span class="wk-n">#${W.session.n + 1}</span><b>${esc(o.title)}</b><span class="dim">${W.session.ticket ? `🧾 ${esc(o.customer)} ordered this` : `for ${esc(o.customer)}, a walk-in`}</span></div>
    <div class="wk-steps">${o.steps.map((s, k) => `<i class="${k < W.step ? 'done' : k === W.step ? 'now' : ''}" title="${esc(s.label)}"></i>`).join('')}</div>
    <div class="wk-step"><div class="wk-label">${esc(st.label)}<span class="dim">${esc(st.hint || '')}</span></div><div class="wk-play"></div></div>`;
  W.t0 = performance.now();
  const play = W.el.querySelector('.wk-play');
  cancelAnimationFrame(W.raf);
  if (st.kind === 'timing') {
    play.innerHTML = `<div class="wk-track"><span class="wk-band" style="left:${(st.target - st.band) * 100}%;width:${st.band * 200}%"></span><span class="wk-needle"></span></div><button type="button" class="btn primary wk-go" data-w="stop">Stop <kbd>Space</kbd></button>`;
    const nd = play.querySelector('.wk-needle');
    const loop = () => { nd.style.left = `${needleAt(st, performance.now() - W.t0) * 100}%`; W.raf = requestAnimationFrame(loop); };
    loop();
  } else if (st.kind === 'meter') {
    play.innerHTML = `<div class="wk-track wk-meter"><span class="wk-band" style="left:${(st.target - st.band) / 1.2 * 100}%;width:${st.band * 2 / 1.2 * 100}%"></span><span class="wk-fill"></span></div><button type="button" class="btn primary wk-go wk-hold" data-w="hold">Hold <kbd>Space</kbd></button>`;
  } else if (st.kind === 'choice') {
    const opts = `<div class="wk-opts">${st.options.map((x, k) => `<button type="button" class="btn wk-opt" data-pick="${k}">${esc(x)}</button>`).join('')}</div>`;
    if (st.memo) {
      play.innerHTML = `<div class="wk-memo">💬 ${esc(st.memo)}</div>`;
      setTimeout(() => { if (W && W.session.order === o && W.step === o.steps.indexOf(st)) { play.innerHTML = opts; W.t0 = performance.now(); } }, 1800);
    } else play.innerHTML = opts;
  } else if (st.kind === 'sequence') {
    W.seqPicks = [];
    play.innerHTML = `<div class="wk-seq">${st.items.map((x, k) => `<button type="button" class="btn wk-it" data-seq="${k}" disabled>${esc(x)}<small></small></button>`).join('')}</div>`;
    const btns = [...play.querySelectorAll('.wk-it')];
    st.order.forEach((k, i) => setTimeout(() => { if (!W || W.session.order !== o) return; btns[k].classList.add('lit'); btns[k].querySelector('small').textContent = i + 1; setTimeout(() => btns[k]?.classList.remove('lit'), 450); }, 300 + i * 650));
    setTimeout(() => { if (!W || W.session.order !== o) return; for (const b of btns) { b.disabled = false; b.querySelector('small').textContent = ''; } W.t0 = performance.now(); }, 300 + st.order.length * 650 + 250);
  }
}
function report(r) {
  const o = W.session.order;
  W.reports[W.step] = r;
  W.step++;
  if (W.step < o.steps.length) { renderOrder(); return; }
  serve();
}
async function serve() {
  if (W.busy) return;
  W.busy = true;
  const s = W.session, reports = W.reports.slice();
  cancelAnimationFrame(W.raf);
  for (;;) {
    try {
      const r = await post('/api/economy/work/act', { session: s.id, n: s.n, reports });
      if (!W) return;
      W.session = r.session; W.step = 0; W.reports = []; W.busy = false;
      feedback(r.result);
      return;
    } catch (x) {
      if (x.code === 'too_fast' && W) { W.el.querySelector('.wk-play').innerHTML = '<p class="hint">Serving… take a breath.</p>'; await new Promise(res => setTimeout(res, 1200)); continue; }
      if (W) { W.busy = false; app.toast?.(x.message, 'bad'); if (x.status === 404) { close(); } else renderOrder(); }
      return;
    }
  }
}
function feedback(r) {
  const play = W.el.querySelector('.wk-step');
  play.innerHTML = `<div class="wk-res s${r.stars}"><b>${stars(r.stars)}</b><span>${esc(r.title)} for ${esc(r.customer)}${r.tip ? ` · tip ${vc(r.tip)}` : ''}</span>${r.review ? `<em>“${esc(r.review.text)}” - ${esc(r.review.by)}</em>` : ''}</div>`;
  W.el.querySelector('.wk-head').outerHTML = head();
  setTimeout(() => { if (W) renderOrder(); }, r.review ? 1800 : 1100);
}
async function end() {
  const s = W.session;
  W.el.innerHTML = `${head()}<p class="hint">Ending your shift…</p>`;
  try {
    const r = await post('/api/economy/work/end', { session: s.id });
    W.el.innerHTML = `<div class="wk-head"><b>Shift over · ${esc(s.roleLabel)} at ${esc(s.business?.name || '')}</b><button type="button" class="btn small" data-w="close">Close</button></div>
      <div class="wk-sum"><div><span>Served</span><b>${r.session.served}</b></div><div><span>Stars</span><b>${r.avgStars || '-'}</b></div><div><span>Time</span><b>${r.hours} world h</b></div><div><span>Paid</span><b>${vc(r.pay)}</b></div></div>
      <p class="hint">Wages ${vc(r.gross)}${r.tips ? ` + tips ${vc(r.tips)}` : ''}, income tax withheld.${r.owed ? ` ${esc(s.business?.name || 'The venue')} couldn't pay ${vc(r.owed)} yet: it owes you and pays when it can.` : ''}</p>
      <div class="row"><button type="button" class="btn primary" data-w="again">Work another shift here</button></div>`;
    app.econ?.refresh?.();
  } catch (x) { if (!x.quiet) app.toast?.(x.message, 'bad'); close(); }
}

// ------------------------------------------------------------------ input
function onClick(e) {
  const b = e.target.closest('[data-w],[data-pick],[data-seq]'); if (!b || !W) return;
  if (b.dataset.w === 'end') { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to end'; return; } end(); return; }
  if (b.dataset.w === 'close') { close(); return; }
  if (b.dataset.w === 'again') { const s = W.session; close(); start(s.business.id, s.role); return; }
  if (W.busy || W.phase !== 'order') return;
  const st = W.session.order?.steps[W.step]; if (!st) return;
  if (b.dataset.w === 'stop' && st.kind === 'timing') report({ t: Math.round(performance.now() - W.t0) });
  if (b.dataset.pick !== undefined && st.kind === 'choice') report({ pick: +b.dataset.pick });
  if (b.dataset.seq !== undefined && st.kind === 'sequence') {
    W.seqPicks.push(+b.dataset.seq); b.disabled = true; b.querySelector('small').textContent = W.seqPicks.length;
    if (W.seqPicks.length === st.order.length) report({ picks: W.seqPicks.slice() });
  }
}
function holdStart() {
  const st = W?.session.order?.steps[W.step];
  if (!st || st.kind !== 'meter' || W.holdAt || W.busy) return;
  W.holdAt = performance.now();
  const fill = W.el.querySelector('.wk-fill');
  const loop = () => { if (!W?.holdAt) return; fill.style.width = `${Math.min(1.2, meterAt(st, performance.now() - W.holdAt)) / 1.2 * 100}%`; W.raf = requestAnimationFrame(loop); };
  loop();
}
function holdEnd() {
  if (!W?.holdAt) return;
  const ms = Math.round(performance.now() - W.holdAt); W.holdAt = 0;
  cancelAnimationFrame(W.raf);
  report({ ms });
}
function onDown(e) { if (e.target.closest('[data-w="hold"]')) { e.preventDefault(); holdStart(); } }
function onUp() { holdEnd(); }
function onKey(e) {
  if (!W || W.busy || (e.target && /input|textarea|select/i.test(e.target.tagName))) return false;
  const st = W.session.order?.steps[W.step];
  if (!st || (e.code !== 'Space' && e.code !== 'Enter')) return false;
  if (st.kind === 'timing' && e.type !== 'keyup') { if (!e.repeat) report({ t: Math.round(performance.now() - W.t0) }); return true; }
  if (st.kind === 'meter') { if (!e.repeat) holdStart(); if (!W.keyUpBound) { W.keyUpBound = true; window.addEventListener('keyup', function up(ev) { if (ev.code === e.code) { window.removeEventListener('keyup', up); if (W) W.keyUpBound = false; holdEnd(); } }); } return true; }
  return false;
}
