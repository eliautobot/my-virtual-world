// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's own screen, live: Hermes' Bot Desktop (docs/features/agent-pc.md §4.2) — the desktop on the machine Hermes
// runs on where its browser opens and its computer use acts, for whoever manages the provider. Shown as Hermes Desktop's
// Screen pane shows it: watched by default (nothing the person does reaches it), ✋ Take over to use it (a login, a
// CAPTCHA) and ↩ Hand back; ▶ Start when it is off. The picture is the screen itself (noVNC, /vendor/novnc/, over
// /api/providers/screen/ws — server/providers/screen-relay.js), not pictures of it. One piece, shown in the agent's PC
// (its Browser app, ./pc-more.js) and the chat window's side panel (./chat-dock.js).
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';

const POLL_MS = 5000;          // who has control, read again this often while it shows
const HIDDEN_MS = 20000;       // out of sight this long (and not being used): the stream closes until it shows again
const RETRY_MS = [1000, 3000, 8000];
const PASTE_MAX = 64 * 1024;
const C_TAKEN = 4000, C_GONE = 4001;
let rfbModule = null;
const loadRfb = () => (rfbModule ||= import('/vendor/novnc/core/rfb.js').then(m => m.default));

/**
 * The screen of one agent, in an element of its own: it streams while the element is on screen.
 * @returns {{ destroy: () => void }}
 */
export function mountProviderScreen(el, agentId, { toast = null } = {}) {
  el.classList.add('psc');
  el.innerHTML = `<div class="psc-bar"><span class="psc-st" aria-live="polite"></span><span class="psc-sp"></span>
      <button type="button" class="btn small" data-s="take" hidden>✋ Take over</button>
      <button type="button" class="btn small primary" data-s="release" hidden>↩ Hand back</button>
      <button type="button" class="btn small" data-s="start" hidden>▶ Start its screen</button>
      <button type="button" class="btn small" data-s="retry" hidden>↻ Reconnect</button>
      <button type="button" class="cw-ic" data-s="browser" hidden></button>
      <button type="button" class="cw-ic" data-s="stop" title="Turn its screen off" aria-label="Turn its screen off" hidden>⏹</button></div>
    <div class="psc-view"><div class="psc-cv"></div><div class="psc-wait">Opening its screen…</div></div>
    <div class="psc-note"></div>`;
  const $ = s => el.querySelector(s);
  const S = { st: null, rfb: null, ws: null, conn: 'idle', err: null, busy: false, seen: false, hiddenAt: 0, tries: 0, gen: 0, dead: false, poll: null, retry: null };
  const say = (m, kind = 'bad') => (toast ? toast(m, kind) : null);

  async function read() {
    try { S.st = await getJSON(`/api/providers/screen?agent=${agentId}`); S.err = null; }
    catch (e) { S.err = e.message || 'Could not reach its screen.'; }
    paint(); want();
  }
  /** Connect while it runs and shows; let go when it is out of sight a while and the person isn't using it. */
  function want() {
    if (S.dead) return;
    const on = S.seen && el.isConnected && !document.hidden;
    if (on) S.hiddenAt = 0; else if (!S.hiddenAt) S.hiddenAt = Date.now();
    const away = !on && Date.now() - S.hiddenAt > HIDDEN_MS && !S.st?.mine;
    if (S.st?.running && on && S.conn === 'idle') attach();
    else if ((away || !S.st?.running) && S.conn !== 'idle' && S.conn !== 'error') detach();
  }
  async function attach() {
    const g = ++S.gen;
    S.conn = 'attaching'; paint();
    let Rfb;
    try { Rfb = await loadRfb(); } catch { S.conn = 'error'; S.err = 'The screen viewer did not load.'; paint(); return; }
    if (g !== S.gen || S.dead) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/providers/screen/ws?agent=${agentId}`);
    ws.binaryType = 'arraybuffer';
    let code = 0;
    ws.addEventListener('close', e => { code = e.code; });
    S.ws = ws;
    // (the close code is known before noVNC says it disconnected: listened to first)
    const rfb = new Rfb($('.psc-cv'), ws, { shared: true });
    rfb.scaleViewport = true; rfb.resizeSession = false; rfb.focusOnClick = true; rfb.background = 'transparent'; rfb.qualityLevel = 7;
    rfb.viewOnly = !S.st?.mine;
    rfb.addEventListener('connect', () => { if (g === S.gen) { S.conn = 'live'; S.tries = 0; S.err = null; paint(); } });
    rfb.addEventListener('disconnect', e => {
      if (S.rfb === rfb) S.rfb = null;
      if (g !== S.gen || S.dead) return;
      S.conn = 'idle';
      if (code === C_TAKEN) { S.err = 'Someone else took control of this screen.'; S.tries = 0; }
      else if (code === C_GONE) S.err = null;
      else if (code === 4403) { S.conn = 'error'; S.err = 'You can no longer see this screen.'; }
      else if (!e.detail?.clean || code !== 1000) {
        // (lost: tried again a few times, then the person reconnects)
        if (S.tries < RETRY_MS.length) { S.conn = 'retry'; clearTimeout(S.retry); S.retry = setTimeout(() => { if (S.conn === 'retry') { S.conn = 'idle'; want(); } }, RETRY_MS[S.tries++]); }
        else { S.conn = 'error'; S.err = 'Lost the connection to its screen.'; }
      }
      paint(); read();
    });
    S.rfb = rfb;
  }
  function detach() {
    S.gen++;
    clearTimeout(S.retry);
    const r = S.rfb; S.rfb = null; S.ws = null;
    try { r?.disconnect(); } catch { /* already closed */ }
    S.conn = 'idle';
  }
  async function act(action, extra = {}) {
    if (S.busy) return;
    S.busy = true; paint();
    try {
      const r = await post('/api/providers/screen', { agent: agentId, action, ...extra });
      S.st = { ...S.st, ...r }; S.err = null;
      if (S.rfb) { S.rfb.viewOnly = !S.st.mine; if (S.st.mine) S.rfb.focus(); }
      if (action === 'start') S.tries = 0;
    } catch (e) { if (e.code !== 'reauth_required') say(e.message || 'Its screen did not do that.'); }
    finally { S.busy = false; paint(); want(); }
  }

  function paint() {
    if (S.dead) return;
    const st = S.st, view = $('.psc-view'), wait = $('.psc-wait'), note = $('.psc-note');
    const btn = (k, show) => { const b = el.querySelector(`[data-s="${k}"]`); b.hidden = !show; b.disabled = S.busy; return b; };
    let msg = '', state = '', hint = '';
    if (!st) msg = esc(S.err || 'Opening its screen…');
    else if (st.available === false) msg = esc(st.reason || 'This agent has no screen of its own.');
    else if (!st.supported) msg = 'Its screen runs on a Linux machine only (Hermes\' Bot Desktop).';
    else if (!st.installed) { msg = 'Hermes\' Bot Desktop isn\'t installed on its machine yet.'; hint = st.install ? `Whoever runs Hermes installs it there: <code>${esc(st.install)}</code>` : ''; }
    else if (!st.running) { msg = st.blocker ? esc(st.blocker) : 'Its screen is off.'; hint = st.blocker ? '' : 'It starts by itself when it opens its browser there, or start it now.'; }
    else if (S.conn === 'attaching') msg = 'Connecting to its screen…';
    else if (S.conn === 'retry') msg = 'Reconnecting to its screen…';
    else if (S.conn === 'error') msg = esc(S.err || 'Lost the connection to its screen.');
    else if (S.conn === 'idle' && !S.seen) msg = 'Its screen';
    const live = !!st?.running && S.conn === 'live';
    if (live) {
      state = st.mine ? '<b>You have control</b> — it waits until you hand it back' : st.holder === 'human' ? 'Watching — someone else has control' : 'Watching — the agent has control';
      hint = st.mine ? '' : S.err && /took control/.test(S.err) ? esc(S.err) : 'Take over to use it yourself (a sign-in, a CAPTCHA); the agent waits meanwhile.';
    }
    $('.psc-st').innerHTML = state;
    wait.innerHTML = msg; wait.hidden = live;
    view.classList.toggle('mine', !!st?.mine && live);
    note.innerHTML = hint;
    btn('take', live && !st.mine);
    btn('release', !!st?.mine);
    btn('start', !!st && st.available !== false && st.installed && st.supported && !st.running && !st.blocker);
    btn('retry', S.conn === 'error' && !!st?.running);
    btn('stop', !!st?.running && !st?.mine);
    const b = btn('browser', !!st && st.available !== false && st.browserOnScreen !== null && st.browserOnScreen !== undefined);
    b.textContent = st?.browserOnScreen ? '🌐 Browser here: on' : '🌐 Browser here: off';
    b.title = st?.browserOnScreen ? 'Its browser opens on this screen (Hermes\' settings browser.headed and bot_desktop.auto_start). Turn off: it browses unseen' : 'Its browser opens unseen. Turn on: it opens on this screen, where you watch it (Hermes\' settings browser.headed and bot_desktop.auto_start)';
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    const k = b.dataset.s;
    if (k === 'take') act('take');
    else if (k === 'release') act('release');
    else if (k === 'start') act('start');
    else if (k === 'retry') { S.conn = 'idle'; S.tries = 0; S.err = null; want(); paint(); }
    else if (k === 'stop') { if (confirm('Turn its screen off? Its browser on it closes too.')) act('stop'); }
    else if (k === 'browser') {
      const on = !S.st?.browserOnScreen;
      if (confirm(on ? 'Change Hermes\' settings for this agent so its browser opens on its screen (browser.headed and bot_desktop.auto_start on)?' : 'Change Hermes\' settings for this agent so its browser runs unseen again (browser.headed and bot_desktop.auto_start off)?')) act('browser', { on });
    }
  });
  // (keys on the screen are the screen's: never the world's or the window's)
  const keep = e => { if (e.target.closest('.psc-view')) e.stopPropagation(); };
  el.addEventListener('keydown', keep); el.addEventListener('keyup', keep);
  el.addEventListener('paste', e => {
    if (!e.target.closest('.psc-view') || !S.rfb || S.rfb.viewOnly) return;
    const t = e.clipboardData?.getData('text');
    if (t && t.length <= PASTE_MAX) { e.preventDefault(); S.rfb.clipboardPasteFrom(t); }
  });
  const io = new IntersectionObserver(es => { S.seen = es.some(x => x.isIntersecting); want(); paint(); });
  io.observe(el);
  const vis = () => want();
  document.addEventListener('visibilitychange', vis);
  S.poll = setInterval(() => { if (S.seen && !document.hidden) read(); else want(); }, POLL_MS);
  read();
  return {
    destroy() {
      if (S.dead) return;
      // (closed while in control: control goes back to the agent first, as closing Hermes' own viewer does)
      if (S.st?.mine) post('/api/providers/screen', { agent: agentId, action: 'release' }).catch(() => {});
      S.dead = true; detach();
      clearInterval(S.poll); io.disconnect(); document.removeEventListener('visibilitychange', vis);
      el.classList.remove('psc'); el.innerHTML = '';
    },
  };
}
