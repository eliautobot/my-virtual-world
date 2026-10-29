// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A radio studio's station window (2026-10-27, the product owner: "all the settings for that radio station to be through
// the Station module not on the settings ... a button for settings and it brings up all the station and all its
// settings but as a separate window"). Over each studio's broadcast desk on the floor being looked into, a 📻 in the
// station's colour; a click on it (or ⚙ on the radio panel while you are in the studio: audio/radio.js) opens the window:
//   the station    its frequency, name and line, on the air now (the song, or its host talking), its hosts
//   its settings   (administrators) name, frequency, band, colour, line, talk radio, what it plays (genres or its own
//                  playlist, in order or shuffled), ads: Settings → Radio's own editor (ui/radio-admin.js, one station)
// The same on a phone (a sheet from the bottom, as the stage's music panel).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { esc, h } from '../core/util.js';
import { auth } from '../core/auth.js';
import { CATALOG } from '/shared/catalog.js';
import { stationTracks, onAir, talkOf } from '/shared/radio.js';
import { radioTab } from './radio-admin.js';
import { getJSON } from '../core/net.js';

const LIFT = 1.3, _v = new THREE.Vector3();   // (above the seats' ⋯: ui/post-menu.js)
let app = null, layer = null, panel = null, openId = null, nowT = 0;
const pins = new Map();
const isAdmin = () => ['owner', 'admin'].includes(auth.me?.role);
const stations = () => app.radio?.all || [];

/** The studios on the floor looked into: [{ st (its station), e (its broadcast desk's interiors entry), key }]. */
function studiosHere() {
  if (S.focus.b < 0 || !S.world) return [];
  const B = S.world.buildings[S.focus.b], L = B && S.world.levels[B.lv?.[S.focus.f]];
  const out = [];
  for (const it of L?.items || []) {
    if (it.t !== 'broadcast_desk' || !it.mod) continue;
    const st = stations().find(s => s.studio && s.studio.b === S.focus.b && s.studio.f === S.focus.f && s.studio.room === it.mod);
    const e = st && app.inter?.findEntry(S.focus.b, S.focus.f, it.id);
    if (e) out.push({ st, e, key: `${S.focus.b}:${S.focus.f}:${it.mod}` });
  }
  return out;
}
function pinOf(key, st) {
  let el = pins.get(key);
  if (!el) {
    el = h('<button type="button" class="mp-pin sp-pin" aria-label="Radio station">📻</button>');
    el.addEventListener('pointerdown', ev => ev.stopPropagation());
    el.addEventListener('click', ev => { ev.stopPropagation(); if (openId === el._st) close(); else openStation(app, el._st); });
    layer.appendChild(el); pins.set(key, el);
  }
  el._st = st.id; el.title = `${st.freq} ${st.band} · ${st.name}`;
  if (el.style.borderColor !== st.color) el.style.borderColor = st.color || '';
  return el;
}
function frame() {
  const show = S.mode === 'explore' && !app.arcade?.playing, cam = app.stage.camera, seen = new Set();
  if (show) for (const s of studiosHere()) {
    _v.set(s.e.x, s.e.y + (CATALOG.broadcast_desk?.h || 1.3) + LIFT, s.e.z).project(cam);
    if (!(_v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05)) continue;
    seen.add(s.key);
    const pin = pinOf(s.key, s.st), t = `translate(${((_v.x + 1) * 0.5 * innerWidth).toFixed(1)}px,${((1 - _v.y) * 0.5 * innerHeight).toFixed(1)}px) translate(-50%,-50%)`;
    if (pin._t !== t) { pin.style.transform = t; pin._t = t; }
    pin.classList.toggle('on', openId === s.st.id);
    if (pin.hidden) pin.hidden = false;
  }
  for (const [k, el] of pins) if (!seen.has(k) && !el.hidden) el.hidden = true;
  if (panel && performance.now() - nowT > 1000) { nowT = performance.now(); paintNow(); paintShows(); }
}

// ----------------------------------------------------------------------------------------------- the window
/** Opens station id's window (a studio's station). */
export function openStation(a, id) {
  app = app || a;
  close();
  const st = stations().find(s => s.id === id); if (!st) return;
  openId = id;
  panel = h(`<div class="mp panel sp" role="dialog" aria-label="Radio station">
    <div class="mp-h"><span class="mp-ic" aria-hidden="true">📻</span><div><b class="sp-name"></b><small class="sp-line"></small></div><button type="button" class="mp-x" data-a="close" aria-label="Close">✕</button></div>
    <div class="sp-now"></div>
    <div class="sp-shows"></div>
    <div class="sp-body"></div></div>`);
  panel.addEventListener('pointerdown', ev => ev.stopPropagation());
  panel.querySelector('[data-a="close"]').onclick = close;
  document.body.appendChild(panel);
  paintHead(); paintNow(); paintShows();
  const body = panel.querySelector('.sp-body');
  if (isAdmin()) radioTab(null, body, { only: id }).then(() => paintHead());
  else body.innerHTML = '<p class="hint">Walk into the studio to hear it, or tune to it on the radio in a car, a boat or an aircraft (R).</p>';
}
function close() { panel?.remove(); panel = null; openId = null; }
function paintHead() {
  const st = stations().find(s => s.id === openId); if (!st || !panel) return;
  panel.style.setProperty('--sp', st.color || '#4aa3ff');
  panel.querySelector('.sp-name').textContent = `${st.freq} ${st.band} · ${st.name}`;
  panel.querySelector('.sp-line').textContent = [st.line, st.hostNames?.length ? `Hosts: ${st.hostNames.map(x => x.name).join(', ')}` : st.dj ? '' : 'No hosts yet: post agents at its broadcast desk (⋯)', st.dj ? `DJ: ${st.dj.name}` : ''].filter(Boolean).join(' · ');
}
/** Its recent shows (server/radio/ aired, 2026-10-28): when, who was on, what about; one opened: what each of them said
 *  (it went out on the air: anyone may read it). */
let shownShow = null;
const showLines = new Map();   // show id → its lines, or { error }
function paintShows() {
  const st = stations().find(s => s.id === openId), el = panel?.querySelector('.sp-shows'); if (!st || !el) return;
  if (!el._wired) {
    el._wired = true;
    el.addEventListener('click', async ev => {
      const li = ev.target.closest('[data-show]'); if (!li) return;
      const id = li.dataset.show;
      shownShow = shownShow === id ? null : id; el._h = null; paintShows();
      if (shownShow && !showLines.has(id)) {
        try { showLines.set(id, (await getJSON(`/api/radio/show?id=${encodeURIComponent(id)}`)).show.lines); } catch (e) { showLines.set(id, { error: e.message }); }
        el._h = null; paintShows();
      }
    });
  }
  const list = st.recent || [];
  const said = id => { const L = showLines.get(id); return !L ? '<div class="sp-said"><small>…</small></div>' : L.error ? `<div class="sp-said"><small>${esc(L.error)}</small></div>` : `<div class="sp-said">${L.map(l => `<p><b>${esc(l.host)}:</b> ${esc(l.text)}</p>`).join('')}</div>`; };
  const html = list.length ? `<h4 class="sp-sh">Recent shows</h4><ul class="sp-list">${list.map(x => `<li${x.id ? ` data-show="${esc(x.id)}" class="sp-show${shownShow === x.id ? ' on' : ''}" title="What was said"` : ''}><small>${esc(new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</small> <b>${esc((x.hosts || []).join(' & '))}</b>${x.topics ? ` · ${esc(x.topics)}` : ''}${x.id && shownShow === x.id ? said(x.id) : ''}</li>`).join('')}</ul>` : '';
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
function paintNow() {
  const st = stations().find(s => s.id === openId), el = panel?.querySelector('.sp-now'); if (!st || !el) return;
  const air = S.music?.ready ? onAir(stationTracks(S.music.tracks.values(), st), st.id, app.net.realNow(), st.order, talkOf(st).every) : null;
  const talk = app.radio?.onAir && app.radio?.room?.station === st.id ? app.radio.onAir : null;
  const txt = talk ? `🎙 ${talk.host || 'The host'} is talking` : air?.kind === 'song' ? `♪ ${air.track.title || 'Untitled'}${air.track.artist ? ` · ${air.track.artist}` : ''}` : air ? 'Station ident' : 'Nothing to play yet: give it songs below';
  if (el.textContent !== txt) el.textContent = txt;
}

export function init(a) {
  app = a;
  layer = document.body.appendChild(h('<div id="stationpins" aria-label="Radio studios"></div>'));
  app.stationPanel = { open: id => openStation(app, id), close, get open_() { return openId; } };
  bus.on('frame', frame);
  bus.on('msg:radio', m => { if (m.stations && panel) paintHead(); });
  bus.on('focus', () => { if (panel && !app.radio?.room) close(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && panel && !ev.target.closest?.('input, select, textarea')) { ev.stopPropagation(); close(); } }, true);
}
