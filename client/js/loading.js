// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
/* The loading screen (index.html #loading): starts its moving art (js/loading-art.js) on a worker when the browser can
   hand the canvas to one, so the art keeps moving while the page builds the world, else on the page; and gives main.js
   window.__mvwLoading:
     set(p, msg, phase)  progress 0..1, the status line, and the step's figure (account, city, streets, buildings,
                         furnish, residents, waking, lighting, signin, error); figures change by transforming into each other
     done()              the art bursts, then the screen fades out (class 'done' on #loading, as before)
   A classic script, loaded before main.js, so the screen is alive from the first moment. */
(function () {
  'use strict';
  const root = document.getElementById('loading');
  if (!root) return;
  let cv = root.querySelector('.ld-canvas');
  const msgEl = document.getElementById('load-msg');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Who draws the art, measured: on a phone the GPU is the bottleneck — a GPU-drawn canvas competed with the world for it
  // while it loads (start-up 1-3 s slower), drawn by the CPU start-up took as long as before. On a computer the CPU path is
  // the bottleneck — at 3440×1440 it managed 26-36 frames a second where the GPU-drawn one holds 60, and start-up is the
  // same either way. So: the CPU on touch devices, the GPU elsewhere. ?ldsoft=1 / ?ldsoft=0 force one.
  const force = /[?&]ldsoft=([01])/.exec(location.search);
  const soft = force ? force[1] === '1' : matchMedia('(pointer: coarse)').matches;
  let worker = null, art = null, ended = false, finished = false;
  const sent = [];   // every phase so far, replayed to the art if it has to start again on the page

  // A tip while the world loads (2026-10-09: "a random hint on the load screen that explains a use case and how to do
  // it"): one at random, then the next every few seconds. Kept short: one use case and how. ❓ Help has the full answers.
  const TIPS = [
    ['Want land of your own?', 'Open the data map (O), tap a lot marked For sale and buy it from its card.'],
    ['Build on your lot:', 'tap it and choose Build here. The first floors come with the building.'],
    ['Make your own AI agent:', 'Edit world → Agents → New agent. Its Studio sets its look, brain and job.'],
    ['Talk with your agent', 'from the chat button at the bottom right, or select it and press Chat.'],
    ['Let other players talk with your agent:', 'its Studio → Visitors.'],
    ['Set your home view', 'in Info → Home view. You start there on every device, and ⌂ brings you back.'],
    ['Walk around as yourself:', 'the Play button (or 4). W A S D walk, E talks, sits and drives.'],
    ['Look inside any building:', 'double-click it, then change floors with PageUp and PageDown.'],
    ['Say hello to other players:', 'walk up to them in Play and press E.'],
    ['Looking for someone or somewhere?', 'Press / and type a name.'],
    ['Selling a lot you own?', 'Open its card and list it for sale: the buyer pays you in Virtual Coin.'],
    ['Furnish inside:', 'look inside your building, then Edit world → Buildings → Furniture.'],
    ['Lost?', 'The ? button at the top answers “How do I…?” with a Show me button.'],
    ['Everyone in the city has a home, a job and a daily routine.', 'Follow one with a double-click.'],
    ['Made a mistake?', 'Ctrl+Z undoes your own changes, Ctrl+Y redoes them.'],
  ];
  const tipEl = root.querySelector('.ld-tip');
  let tipAt = Math.floor(Math.random() * TIPS.length), tipTimer = 0;
  function tip() {
    if (!tipEl) return;
    const [lead, how] = TIPS[tipAt % TIPS.length];
    tipEl.innerHTML = '';
    const b = document.createElement('b'); b.textContent = lead;
    tipEl.append(b, ' ' + how);
  }
  function nextTip() {
    if (!tipEl || ended) return;
    tipEl.classList.add('out');
    setTimeout(() => { tipAt++; tip(); tipEl.classList.remove('out'); }, reduced ? 0 : 450);
  }
  tip();
  if (tipEl) tipTimer = setInterval(nextTip, 7000);

  function rel(el) {
    if (!el) return null;
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }
  /** The canvas covers only the figure, the status line and the progress line (and room round them for the swirl and the
   *  burst): a small canvas is cheap to draw on every frame, even by the CPU on a busy phone. */
  function geometry() {
    const lay = { fig: rel(root.querySelector('.ld-fig')), text: rel(root.querySelector('.ld-text')), bar: rel(root.querySelector('.ld-bar')) };
    const R = root.getBoundingClientRect(), f = lay.fig, M = Math.max(36, f.w * 0.16);
    const x0 = Math.max(0, Math.min(f.x, lay.text.x, lay.bar.x) - M), y0 = Math.max(0, f.y - M);
    const x1 = Math.min(R.width, Math.max(f.x + f.w, lay.text.x + lay.text.w, lay.bar.x + lay.bar.w) + M), y1 = Math.min(R.height, lay.bar.y + lay.bar.h + M * 0.6);
    for (const k in lay) { lay[k].x -= x0; lay[k].y -= y0; }
    Object.assign(cv.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
    return { w: x1 - x0, h: y1 - y0, dpr: Math.min(window.devicePixelRatio || 1, 2), reduced, soft, layout: lay };
  }
  /** Sparks rising off the top of the logo: CSS animations (transform and opacity), which the compositor runs by itself. */
  function embers() {
    const box = root.querySelector('.ld-embers');
    if (!box || reduced) return;
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 26; i++) {
      const e = document.createElement('i');
      e.className = Math.random() < 0.3 ? 'm' : '';
      const s = rnd(2, 4.6);
      Object.assign(e.style, { left: rnd(3, 97) + '%', top: rnd(2, 26) + '%', width: s + 'px', height: s + 'px',
        animationName: 'ld-ember' + (i % 4), animationDuration: rnd(2.2, 4.2).toFixed(2) + 's', animationDelay: (-rnd(0, 4)).toFixed(2) + 's' });
      box.appendChild(e);
    }
  }
  embers();
  function send(m) {
    if (m.type !== 'resize') sent.push(m);
    if (worker) worker.postMessage(m);
    else if (art) art.message(m);
  }
  let statsWait = null;
  function onArt(m) {
    if (m && m.type === 'outro') finish();
    if (m && (m.type === 'stats' || m.type === 'trace') && statsWait) { statsWait(m); statsWait = null; }
  }

  function onPage() {   // no worker canvas: the same art on the page
    if (art) return;
    const go = () => {
      if (!window.MVWLoadingArt) return;
      art = window.MVWLoadingArt.create(cv, Object.assign(geometry(), { post: onArt }));
      for (const m of sent) art.message(m);
    };
    if (window.MVWLoadingArt) return go();
    const s = document.createElement('script');
    s.src = '/js/loading-art.js';
    s.onload = go;
    document.head.appendChild(s);
  }
  // Phones and tablets draw the art on the page. On Android Chrome (154, Adreno 660; found on a real phone 2026-10-08)
  // a worker's canvas makes the GPU process fail "Unable to create shared image" twice a second, and that breaks the
  // page's whole GPU channel: the world's WebGL context is lost at birth and the city never starts.
  const mobile = !!(navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  try {
    if (!mobile && cv && typeof cv.transferControlToOffscreen === 'function' && typeof Worker === 'function') {
      const off = cv.transferControlToOffscreen();
      worker = new Worker('/js/loading-art.js');
      worker.onmessage = e => onArt(e.data);
      worker.onerror = () => {   // the worker failed to start: a fresh canvas (the old one belongs to the worker) on the page
        try { worker.terminate(); } catch (e) { /* gone already */ }
        worker = null;
        const fresh = document.createElement('canvas');
        fresh.className = 'ld-canvas';
        cv.replaceWith(fresh); cv = fresh;
        onPage();
      };
      worker.postMessage(Object.assign({ type: 'init', canvas: off }, geometry()), [off]);
    } else onPage();
  } catch (e) { worker = null; onPage(); }

  let rs = 0;
  window.addEventListener('resize', () => {
    if (rs || finished) return;
    rs = requestAnimationFrame(() => { rs = 0; send(Object.assign({ type: 'resize' }, geometry())); });
  });
  // the images arrive after the first layout measured them; measure again once they have their size
  for (const img of root.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', () => send(Object.assign({ type: 'resize' }, geometry())), { once: true });

  function finish() {
    if (finished) return;
    finished = true;
    root.classList.add('done');
    setTimeout(() => {
      root.classList.add('gone');
      if (worker) { worker.terminate(); worker = null; }
      if (art) { art.stop(); art = null; }
      if (statsWait) { statsWait(null); statsWait = null; }
    }, 900);
  }

  window.__mvwLoading = {
    get mode() { return worker ? 'worker' : art ? 'page' : 'none'; },
    /** Frames the art drew since the last call, and the longest gap between two (ms): smoothness checks. */
    stats(type) {
      return new Promise(res => {
        const m = { type: type || 'stats' };
        if (!worker && !art) return res(null);
        statsWait = res;
        setTimeout(() => { if (statsWait === res) { statsWait = null; res(null); } }, 1000);   // never left waiting: the art may be gone
        if (worker) worker.postMessage(m); else art.message(m);
      });
    },
    set(p, msg, phase) {
      if (ended) return;
      if (msg && msgEl) msgEl.textContent = msg;
      send({ type: 'phase', p, msg, id: phase });
    },
    done(msg) {
      if (ended) return;
      ended = true;
      clearInterval(tipTimer);
      if (msgEl) msgEl.textContent = msg || 'Welcome!';
      send({ type: 'done', msg });
      setTimeout(finish, 1500);   // whatever happens to the art, the world is never kept behind this screen
    },
  };
  window.__mvwLoading.set(0.02, 'Starting…', 'account');
})();
