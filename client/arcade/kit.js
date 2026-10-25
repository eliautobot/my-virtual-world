// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade kit inside the sealed game box (client/arcade/box.html; docs/features/arcade.md "The box protocol"). It
// runs one built-in game: its sim 60 steps a second with the buttons the cabinet sends, every step's buttons recorded
// for the server's replay, its screen drawn every display frame. Messages are { mvwArcade: 1, t, … }:
//   cabinet → box   init { seed, best, practice }   in { v: input value }   pause   resume
//   box → cabinet   ready { id }   sfx { l: [[name, param], …] }   buzz { ms }   over { score, ticks, log, detail }
//                   error { msg }
// The box never reaches the page, the account or the network (a sandboxed frame with its own origin; the server's CSP).
import { InputLog, inputBits, TICK_HZ } from '/shared/arcade/core.js';
import { gameOf } from '/shared/arcade/catalog.js';

const id = new URLSearchParams(location.hash.slice(1)).get('g') || '';
const meta = gameOf(id);
const cv = document.getElementById('screen');
const send = m => parent.postMessage({ mvwArcade: 1, ...m }, '*');
const DT = 1 / TICK_HZ;
let mod = null, view = null, sim = null, s = null, log = null, input = 0, running = false, paused = false, acc = 0, last = performance.now(), eng = '-', engM = null, engAt = 0;

function layout() {
  if (!meta) return;
  const [aw, ah] = meta.aspect, k = Math.min(innerWidth / aw, innerHeight / ah);
  cv.style.width = `${Math.floor(aw * k)}px`; cv.style.height = `${Math.floor(ah * k)}px`;
  view?.resize();
}
addEventListener('resize', layout);
// (the lab's checks look at the game's state through this; it lives only in the sealed box)
globalThis.__box = { state: () => s };
addEventListener('message', e => {
  if (e.source !== parent) return;
  const m = e.data;
  if (!m || m.mvwArcade !== 1) return;
  if (m.t === 'in') input = m.v >>> 0;
  else if (m.t === 'init') start(m);
  else if (m.t === 'pause') { paused = true; view?.pause?.(true); }
  else if (m.t === 'resume') { paused = false; acc = 0; last = performance.now(); view?.pause?.(false); }
});

function start(m) {
  if (!sim) return;
  s = sim.init(m.seed >>> 0);
  log = new InputLog();
  input = 0; acc = 0; last = performance.now(); paused = false; running = true;
  view.reset(s, { best: m.best || 0, practice: !!m.practice });
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (!view) return;
  const sfx = [];
  let buzz = 0;
  if (running && !paused) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 6) {
      log.push(input);
      s.ev.length = 0;
      sim.step(s, inputBits(input));
      for (const ev of s.ev) { view.event(ev); const f = view.sfx(ev); if (f) { if (Array.isArray(f[0])) sfx.push(...f); else sfx.push(f); } buzz = Math.max(buzz, view.buzz?.(ev) || 0); }
      acc -= DT; n++;
      if (sim.over(s)) {
        running = false;
        send({ t: 'over', score: sim.score(s), ticks: log.ticks, log: log.encode(), detail: sim.detail ? sim.detail(s) : null });
        break;
      }
    }
    if (n >= 6) acc = 0;   // (a stall: the game waits rather than racing to catch up)
  }
  if (sfx.length) send({ t: 'sfx', l: sfx });
  // a game with an engine (a racer): its note, ten times a second at most; silent when paused or over
  // (view.engine gives the speed 0 … 1, or { v, rpm, boost, skid } for a fuller engine: revs in the gear, the boost on,
  // tyres squealing; twenty times a second at most)
  if (view.engine) {
    const raw = running && !paused && s ? view.engine(s) : -1, o = typeof raw === 'number' ? { v: raw } : raw || { v: -1 };
    const c = x => Math.max(0, Math.min(1, Number(x) || 0)), e = o.v < 0 ? -1 : c(o.v);
    const m = e < 0 ? { t: 'engine', v: -1 } : { t: 'engine', v: e, rpm: o.rpm == null ? e : c(o.rpm), boost: o.boost ? 1 : 0, skid: c(o.skid) };
    const key = e < 0 ? '-' : `${m.boost}`, diff = e < 0 || !engM ? 1 : Math.max(Math.abs(m.v - engM.v), Math.abs(m.rpm - engM.rpm), Math.abs(m.skid - engM.skid));
    if (key !== eng || (e >= 0 && diff > 0.02 && now - engAt > 50)) { send(m); eng = key; engM = e < 0 ? null : m; engAt = now; }
  }
  if (buzz) send({ t: 'buzz', ms: buzz });
  try { view.draw(dt, s, paused); } catch (err) { console.error(err); }
}

(async () => {
  try {
    if (!meta || meta.kind !== 'builtin') throw new Error('No such game');
    mod = await import(`/arcade/games/${id}.js`);
    sim = mod.sim;
    view = mod.createView(cv, meta);
    layout();
    requestAnimationFrame(frame);
    send({ t: 'ready', id });
  } catch (err) { send({ t: 'error', msg: String(err?.message || err) }); }
})();
