// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's real browser, live: an agent provider's own (Agent Providers, docs/features/agent-providers.md §4 - the one
// its agents browse with; for whoever manages the provider: /api/providers/browser) or a built-in agent's (its PC's
// real browser, docs/features/agent-pc.md §5 - for its owner: /api/pc/browser). Its tabs, the page live, and the
// person's clicks, scrolling and typing on it (a browser shared with the agent). One piece, shown in the chat window's
// side panel (./chat-dock.js) and the agent's PC (its Browser app, ./pc-more.js - mountProviderBrowser).
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { icon } from '../core/icons.js';

const BROWSER_POLL_MS = 5000;   // the tabs (titles, addresses) read again this often while the browser shows
const FRAME_GAP_MS = 80;        // the live picture at most ~12 frames a second
const TYPE_MS = 150;            // letters typed this close together go to the page as one piece of text
const WHEEL_MS = 120;           // a wheel's turns this close together scroll the page once
/** The keys sent to the page by name (the server takes the same set); any other single character is typed. */
const PAGE_KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * The browser of one agent's provider, painted into whatever element its host gives it.
 * @param {{ showing: () => boolean, repaint: () => void }} o  showing: whether it is on screen now (the live picture
 *   runs only then); repaint: draw it again (the host calls paint(body) and live())
 */
export function providerBrowser(o) {
  const base = o.base || '/api/providers/browser';   // (the provider's browser, or a built-in agent's: /api/pc/browser)
  // its state (tabs), the tab shown, the live picture's last frame, what is being typed
  // (error: the browser or its picture out of reach, until it answers again; notice: what refused the person's last action,
  // until their next one)
  const B = { agent: null, body: null, state: null, loading: false, error: null, notice: null, tab: null, seq: 0, view: null, img: null, loop: 0, live: -1, poll: null, typed: '', typeTimer: null, wheel: null, editing: false };
  const bq = () => `agent=${B.agent}`;
  const showing = () => !!B.agent && o.showing();
  const repaint = () => o.repaint();
  /** Another agent's browser (or none): everything of the last one is dropped. */
  function reset(agent = null) {
    B.loop++; clearInterval(B.poll); B.poll = null;
    if (B.img) URL.revokeObjectURL(B.img);
    Object.assign(B, { agent: agent == null ? null : Number(agent), state: null, loading: false, error: null, notice: null, tab: null, seq: 0, view: null, img: null, typed: '' });
  }
  /** The browser's tabs, read again (the shown one kept while it is still there). */
  function loadBrowser() {
    if (!B.agent) return Promise.resolve();
    if (!B.loadP) B.loadP = readBrowser().finally(() => { B.loadP = null; });
    return B.loadP;   // (one reading at a time: a second ask waits for it)
  }
  async function readBrowser() {
    const agent = B.agent;
    B.loading = true;
    try {
      const r = await getJSON(`${base}?${bq()}${B.tab ? `&tab=${encodeURIComponent(B.tab)}` : ''}`);
      if (agent !== B.agent) return;
      B.state = r; B.error = null;
      const ids = (r.tabs || []).map(t => t.id);
      if (!ids.includes(B.tab)) switchTab(ids[0] || null);
    } catch (e) { if (agent === B.agent) B.error = e.message || 'Could not reach the browser.'; }
    finally { if (agent === B.agent) { B.loading = false; repaint(); } }
  }
  function switchTab(id) {
    if (B.tab === id) return;
    B.tab = id; B.seq = 0; B.view = null; B.typed = ''; B.notice = null;
    if (B.img) { URL.revokeObjectURL(B.img); B.img = null; }
    B.loop++;
  }
  function pickTab(id) { switchTab(id); repaint(); act('focus').catch(() => {}); }
  /** Keeps the live picture and the tabs coming while the browser shows; stops them when it doesn't. */
  function browserLive() {
    const on = showing();
    if (!on) { if (B.poll) { clearInterval(B.poll); B.poll = null; } if (B.live === B.loop) B.loop++; return; }
    if (!B.poll) { B.poll = setInterval(() => { if (showing()) loadBrowser(); }, BROWSER_POLL_MS); if (!B.state) loadBrowser(); }
    if (B.tab && B.live !== B.loop) frames();   // (none following the shown tab now: one starts)
  }
  /** The live picture: each next frame of the shown tab (the server waits a few seconds for one; none: asks again). */
  async function frames() {
    const my = ++B.loop, tab = B.tab;
    B.live = my;
    while (my === B.loop && showing() && B.tab === tab) {
      let r;
      try { r = await fetch(`${base}/frame?${bq()}&tab=${encodeURIComponent(tab)}&after=${B.seq}`, { credentials: 'same-origin', cache: 'no-store' }); }
      catch { await sleep(2000); continue; }
      if (my !== B.loop || B.tab !== tab) return;
      if (r.status === 200) {
        const blob = await r.blob();
        if (my !== B.loop || B.tab !== tab) return;
        B.seq = Number(r.headers.get('x-frame-seq')) || B.seq;
        B.view = { w: Number(r.headers.get('x-page-width')) || 0, h: Number(r.headers.get('x-page-height')) || 0, url: decodeURIComponent(r.headers.get('x-page-url') || '') };
        const old = B.img; B.img = URL.createObjectURL(blob);
        const img = B.body?.querySelector('.cw-bw-img');
        if (img) img.src = B.img;
        if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
        B.error = null; repaint();
      } else if (r.status === 404) { loadBrowser(); return; }   // (the tab was closed: the tabs again)
      else if (r.status !== 204) {
        let msg = ''; try { msg = (await r.json()).error; } catch { /* not JSON */ }
        B.error = msg || `The live picture stopped (${r.status})`; repaint();
        await sleep(3000);
      }
      await sleep(FRAME_GAP_MS);
    }
    if (B.live === my && B.loop === my) B.loop++;   // (it stopped by itself - hidden: the next showing starts another)
  }
  /** One of the browser's actions on the shown tab; its refusal is said in the panel. */
  async function act(action, extra = {}) {
    const agent = B.agent;
    if (B.notice) { B.notice = null; repaint(); }
    try { return await post(base, { agent, action, ...(B.tab && !extra.noTab ? { tab: B.tab } : {}), ...extra, noTab: undefined }); }
    catch (e) { if (agent === B.agent) { B.notice = e.message || 'The browser did not do that.'; repaint(); } throw e; }
  }
  async function onBrowserClick(a) {
    const what = a.dataset.a;
    try {
      if (what === 'bw-start') { a.disabled = true; await act('start', { noTab: true }); await loadBrowser(); }
      else if (what === 'bw-new') { const r = await act('open', { noTab: true }); if (r.tab) switchTab(r.tab.id); await loadBrowser(); B.body?.querySelector('.cw-bw-url')?.focus(); }
      else if (what === 'bw-close') { const id = a.closest('[data-btab]')?.dataset.btab || a.dataset.tab; await act('close', { tab: id }); if (id === B.tab) switchTab(null); await loadBrowser(); }
      else if (what === 'bw-back') await act('back');
      else if (what === 'bw-fwd') await act('forward');
      else if (what === 'bw-reload') await act('reload', B.view?.url ? { url: B.view.url } : {});
    } catch { /* said in the panel */ }
  }
  function onUrlKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.target.value = B.view?.url || currentTab()?.url || ''; e.target.blur(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const url = e.target.value.trim();
    if (!url) return;
    e.target.blur();
    (B.tab ? act('navigate', { url }) : act('open', { url, noTab: true }).then(r => { if (r.tab) switchTab(r.tab.id); })).then(() => loadBrowser(), () => {});
  }
  // what the person does on the page: a click where they clicked on the picture (fractions of it), the wheel, keys, text
  /** Where the picture is drawn in its box: it keeps its shape, at the top, centred across (css: object-fit contain,
   *  object-position top center). */
  function drawn(img) {
    const r = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight;
    if (!r.width || !r.height || !nw || !nh) return null;
    const k = Math.min(r.width / nw, r.height / nh), w = nw * k, h = nh * k;
    return { x: r.left + (r.width - w) / 2, y: r.top, w, h };
  }
  function onPageClick(e) {
    const img = e.target.closest('.cw-bw-img'), d = img && B.view && drawn(img);
    if (!d) return;
    const fx = (e.clientX - d.x) / d.w, fy = (e.clientY - d.y) / d.h;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;   // (on a bar, not the page)
    img.closest('.cw-bw-view').focus({ preventScroll: true });   // (what is typed next goes to the page)
    flushTyped();
    act('click', { fx, fy, ...(e.detail === 2 ? { double: true } : {}) }).catch(() => {});
  }
  function onPageWheel(e) {
    const view = e.target.closest?.('.cw-bw-view');
    if (!view || !B.tab) return;
    e.preventDefault();
    const d = drawn(view.querySelector('.cw-bw-img')), scale = B.view && d ? B.view.w / d.w : 1;   // (the page's own pixels)
    const w = B.wheel || (B.wheel = { dx: 0, dy: 0, timer: null });
    w.dx += e.deltaX * scale; w.dy += e.deltaY * scale;
    if (!w.timer) w.timer = setTimeout(() => { const { dx, dy } = w; B.wheel = null; act('scroll', { dx: Math.round(dx), dy: Math.round(dy) }).catch(() => {}); }, WHEEL_MS);
  }
  function onPageKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // (the browser's own shortcuts - copy, paste - stay the page's here)
    if (PAGE_KEYS.has(e.key)) { e.preventDefault(); flushTyped(); act('key', { key: e.key }).catch(() => {}); return; }
    if (e.key.length === 1) { e.preventDefault(); typeText(e.key); }
  }
  function typeText(t) {
    B.typed += t;
    clearTimeout(B.typeTimer);
    B.typeTimer = setTimeout(flushTyped, TYPE_MS);
  }
  function flushTyped() {
    clearTimeout(B.typeTimer);
    const t = B.typed; B.typed = '';
    if (t) act('text', { text: t }).catch(() => {});
  }
  const currentTab = () => (B.state?.tabs || []).find(t => t.id === B.tab) || null;
  const BROWSER = `<div class="cw-bw-msg"></div><div class="cw-bw-tabs" role="tablist" aria-label="Browser tabs"></div>
    <div class="cw-bw-bar"><button type="button" class="cw-ic" data-a="bw-back" title="Back" aria-label="Back">⟨</button><button type="button" class="cw-ic" data-a="bw-fwd" title="Forward" aria-label="Forward">⟩</button>
      <button type="button" class="cw-ic" data-a="bw-reload" title="Reload" aria-label="Reload">↻</button>
      <input class="cw-bw-url" type="text" spellcheck="false" autocomplete="off" placeholder="Enter a URL and press Enter" aria-label="Address">
      <a class="cw-ic cw-bw-ext" target="_blank" rel="noopener noreferrer" title="Open in your browser" aria-label="Open in your browser">${icon('external')}</a></div>
    <div class="cw-bw-view" tabindex="0" aria-label="The page: click, scroll and type on it"><img class="cw-bw-img" alt="" draggable="false"><div class="cw-bw-wait">Loading page…</div></div>
    <div class="cw-bw-note">A browser shared with the agent: what you do here, it sees.</div>`;
  function paintBrowser(body) {
    B.body = body;
    if (body._view !== 'browser') {
      body.innerHTML = BROWSER; body._view = 'browser'; body._h = '';
      body.querySelector('.cw-bw-img').addEventListener('click', onPageClick);
      body.querySelector('.cw-bw-img').addEventListener('dblclick', e => e.preventDefault());
    }
    const st = B.state, ready = !!(st && st.available && st.running);
    const say = B.notice || B.error, msg = say ? `<div class="cw-tk-err" role="alert" data-noicon>${esc(say)}</div>` : '';
    const top = !st ? '<div class="cw-tk-empty">Opening the browser…</div>'
      : !st.available ? `<div class="cw-tk-empty" data-noicon>${esc(st.reason || 'This provider\'s browser is not available here.')}</div>`
      : !st.running ? `<div class="cw-tk-empty"><b>${esc(o.idle || 'The agents\' browser is not running.')}</b><br><button type="button" class="btn small primary" data-a="bw-start">Start browser</button></div>`
      : !st.tabs.length ? '<div class="cw-tk-empty">No tabs open. <button type="button" class="btn small" data-a="bw-new">New tab</button></div>' : '';
    const m = body.querySelector('.cw-bw-msg'), mh = msg + top;
    if (m._h !== mh) { m._h = mh; m.innerHTML = mh; }
    // the tabs, kept in place
    const strip = body.querySelector('.cw-bw-tabs'), tabs = ready ? st.tabs : [];
    const sh = tabs.map(t => `<div class="cw-bw-tab${t.id === B.tab ? ' on' : ''}" data-btab="${esc(t.id)}" role="tab" aria-selected="${t.id === B.tab}" title="${esc(t.url)}"><span data-noicon>${esc(t.title || 'New tab')}</span><button type="button" class="cw-bw-tx" data-a="bw-close" title="Close tab" aria-label="Close tab">✕</button></div>`).join('')
      + (ready ? '<button type="button" class="cw-ic cw-bw-new" data-a="bw-new" title="New tab" aria-label="New tab">＋</button>' : '');
    if (strip._h !== sh) { strip._h = sh; strip.innerHTML = sh; }
    strip.hidden = !ready;
    const show = ready && !!B.tab;
    body.querySelector('.cw-bw-bar').hidden = !show;
    body.querySelector('.cw-bw-view').hidden = !show;
    body.querySelector('.cw-bw-note').hidden = !show;
    if (!show) return;
    const t = currentTab(), url = B.view?.url || t?.url || '';
    const input = body.querySelector('.cw-bw-url');
    if (!B.editing && input.value !== url) input.value = url;
    const ext = body.querySelector('.cw-bw-ext');
    if (/^https?:/i.test(url)) { if (ext.getAttribute('href') !== url) ext.setAttribute('href', url); ext.hidden = false; } else ext.hidden = true;
    const img = body.querySelector('.cw-bw-img'), view = body.querySelector('.cw-bw-view');
    // (the box takes the page's own shape: no empty band under it; shorter when the panel is)
    const ratio = B.view && B.view.w > 0 && B.view.h > 0 ? `${B.view.w} / ${B.view.h}` : '';
    if (view.style.aspectRatio !== ratio) view.style.aspectRatio = ratio;
    if (B.img && img.getAttribute('src') !== B.img) img.src = B.img;
    img.hidden = !B.img;
    const w = body.querySelector('.cw-bw-wait'), why = t?.blocked === 'navigation_blocked' ? 'The browser\'s navigation rules block this address. Choose another tab or enter an allowed address.'
      : t?.blocked ? 'The provider could not check this tab\'s address.' : 'Loading page…';
    if (w.textContent !== why) w.textContent = why;
    w.hidden = !!B.img && !t?.blocked;
  }

  return {
    get agent() { return B.agent; },
    reset, load: loadBrowser, paint: paintBrowser, live: browserLive,
    /** A click in the host's element: true when it was the browser's. */
    click(e) {
      const a = e.target.closest('[data-a]');
      if (a && a.dataset.a.startsWith('bw-')) { onBrowserClick(a); return true; }
      const tab = e.target.closest('[data-btab]');
      if (tab) { pickTab(tab.dataset.btab); return true; }
      return false;
    },
    /** A key in the host's element: true when it was the browser's (on the page, or its address). */
    key(e) {
      if (e.target.closest('.cw-bw-view')) { onPageKey(e); return true; }
      if (e.target.classList?.contains('cw-bw-url')) { onUrlKey(e); return true; }
      return false;
    },
    wheel: onPageWheel,
    paste(e) { if (!e.target.closest('.cw-bw-view')) return; const t = e.clipboardData?.getData('text/plain'); if (t) { e.preventDefault(); typeText(t.slice(0, 2000)); } },
    focusin(e) { if (e.target.classList?.contains('cw-bw-url')) { B.editing = true; e.target.select(); } },
    focusout(e) { if (e.target.classList?.contains('cw-bw-url')) B.editing = false; },
    /** Shows one of the browser's tabs (a browser card's Open); false when it is no longer open. */
    async openTab(id) {
      await loadBrowser();
      if ((B.state?.tabs || []).some(t => t.id === id)) { switchTab(id); repaint(); act('focus').catch(() => {}); return true; }
      B.notice = 'That tab is no longer open in the agents\' browser.'; repaint();
      return false;
    },
    close() { B.loop++; clearInterval(B.poll); B.poll = null; clearTimeout(B.typeTimer); if (B.img) URL.revokeObjectURL(B.img); B.img = null; B.body = null; },
  };
}

/**
 * The browser by itself in an element of its own (the agent's PC): it runs while the element is on screen - an
 * element hidden (its window minimised, the page in the background) stops the live picture until it shows again.
 * @returns {{ destroy: () => void }}
 */
export function mountProviderBrowser(el, agentId, { base = undefined, idle = undefined } = {}) {
  el.classList.add('pbw');
  const box = document.createElement('div');
  box.className = 'pbw-body';
  el.append(box);
  let seen = false;
  const bw = providerBrowser({ base, idle, showing: () => seen && el.isConnected && !document.hidden, repaint: () => { if (el.isConnected) { bw.paint(box); bw.live(); } } });
  bw.reset(agentId);
  const io = new IntersectionObserver(es => { seen = es.some(x => x.isIntersecting); bw.live(); });
  io.observe(el);
  const vis = () => bw.live();
  document.addEventListener('visibilitychange', vis);
  el.addEventListener('click', e => bw.click(e));
  el.addEventListener('keydown', e => { if (bw.key(e)) e.stopPropagation(); });
  el.addEventListener('wheel', bw.wheel, { passive: false });
  el.addEventListener('paste', bw.paste);
  el.addEventListener('focusin', bw.focusin);
  el.addEventListener('focusout', bw.focusout);
  bw.paint(box); bw.load();
  return { destroy() { io.disconnect(); document.removeEventListener('visibilitychange', vis); bw.close(); el.classList.remove('pbw'); box.remove(); } };
}
