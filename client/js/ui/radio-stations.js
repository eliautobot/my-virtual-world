// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Radio Stations window (2026-11-25, the product owner: "we have two places to create radio stations, and they don't
// seem organized ... under the world modules ... a button that says radio stations ... from placing a radio station,
// adding the songs, and all the settings"; "each radio station is like a playlist ... a music library, so the user or the
// agents can move, delete or apply songs to a playlist for a specific radio station"). One home for MVW Radio:
//   the stations   every station (administrators), or those one of whose hosts you own; ＋ New station places a studio
//                  in a Radio Station building (the studio is the station: placing stays the administrators');
//   a station      Overview (on the air now, its crew, its changes — each undoable), Playlist (its songs: add from the
//                  library, upload straight to it, order, take off), Hosts (its desk's agents; a city station's chosen
//                  here; whether hosts may change its songs), On air (how often and how long its hosts talk, ads, the
//                  genres it plays without a playlist), Details (name, frequency, colour, line; remove it);
//   the library    every song of the city: search, genres, who uses each (stations), preview, add to a station, upload;
//                  administrators review players' songs and delete songs;
//   settings       which voice reads the breaks.
// Opened from Edit → World modules (📻 Radio Stations), Settings → MVW Radio, a studio's 📻 in the world, and a studio
// selected in Furnish. The server decides who may do what (server/radio/radio.js playlistRight); this only asks and shows.
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { GENRES, UPLOAD_GENRES, MUSIC, fmtTime } from '/shared/music.js';
import { onAir, stationTracks, talkOf, talkPace, TALK_MAX, MAX_HOSTS } from '/shared/radio.js';
import { sendSong } from './music-panel.js';
import { libraryView, stopPreview } from './music-library.js';
import { readTags } from '../core/id3.js';

let app = null, W = null, pending = null, refreshT = 0;
const TABS = [['overview', 'Overview'], ['playlist', 'Playlist'], ['hosts', 'Hosts'], ['air', 'On air'], ['details', 'Details']];
const OWNER_TABS = new Set(['overview', 'playlist']);
const LENGTHS = [['short', 'Short (about 30 s)'], ['normal', 'Normal (about a minute)'], ['long', 'Long (about a minute and a half)']];
const RIGHT = { admin: 'administrator', owner: 'host\'s owner', host: 'host' };
const track = id => S.music?.tracks?.get(id) || null;
const songsAll = () => [...(S.music?.tracks?.values() || [])];
const approved = t => t && (t.status == null || t.status === 'approved');
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const long = secs => { const m = Math.round(secs / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const radioBuildings = () => (S.world?.buildings || []).filter(B => B && !B.gone && B.radio);

export function init(a) {
  app = a;
  app.radioStations = { open, close, get isOpen() { return !!W; } };
  bus.on('msg:radio', m => { if (m?.stations) { newStudio(m.stations); if (W) refreshSoon(); } });
  bus.on('music', () => { if (W && (W.sel === 'library' || W.tab === 'playlist') && !W.typing) paintMain(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && W && !ev.target.closest?.('input, select, textarea')) { ev.stopPropagation(); close(); } }, true);
}

// ------------------------------------------------------------------------------------------------- the window
/** Opens the window: o { station (its id), tab, library: true }. */
export async function open(o = {}) {
  if (!auth.account) { app.toast?.('Sign in to run a radio station', 'bad'); return; }
  close();
  const el = (document.getElementById('ui') || document.body).appendChild(h(`<div class="modal-back rs-back"><div class="rs panel" role="dialog" aria-modal="true" aria-label="Radio Stations">
    <header class="rs-head"><span class="rs-logo" aria-hidden="true">📻</span><div class="rs-title"><span class="rs-kicker">MVW Radio</span><h2>Radio Stations</h2></div><button type="button" class="btn small icon rs-x" aria-label="Close">✕</button></header>
    <div class="rs-main"><aside class="rs-side" aria-label="Stations"></aside><section class="rs-body"><div class="rs-content"><div class="st-loading"><span></span><span></span><span></span></div></div><p class="rs-say" role="status" aria-live="polite"></p></section></div></div></div>`));
  W = { el, view: null, sel: o.library ? 'library' : o.station || null, tab: o.tab || 'overview', lib: { q: '', genre: '', picked: new Set() }, add: null, up: null, busy: false, typing: false, audio: null, playing: null };
  el.querySelector('.rs-x').onclick = close;
  el.addEventListener('focusin', e => { if (W && e.target.matches?.('input:not([type=checkbox]):not([type=file]):not([type=radio]), textarea, select')) W.typing = true; });
  el.addEventListener('focusout', () => { if (W) W.typing = false; });
  el.addEventListener('pointerdown', e => { if (e.target === el) W.downOut = true; });
  el.addEventListener('pointerup', e => { if (e.target === el && W?.downOut) close(); if (W) W.downOut = false; });
  el.querySelector('.rs-side').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (!b) return; W.sel = b.dataset.sel; W.add = null; W.up = null; if (!OWNER_TABS.has(W.tab) && !W.view.admin) W.tab = 'overview'; paint(); });
  if (!S.music?.ready) app.music?.load?.();
  try { await load(); } catch (e) { el.querySelector('.rs-content').innerHTML = `<p class="hint bad">${esc(e.message || 'Could not load')}</p>`; return; }
  if (!W) return;
  if (!W.view.admin && !W.view.stations.length) { close(); app.toast?.('You don\'t run a radio station: an administrator places stations, and their hosts\' owners look after the songs', 'bad', 4200); return; }
  if (!W.sel || (W.sel !== 'library' && W.sel !== 'settings' && W.sel !== 'new' && !stationOf(W.sel))) W.sel = W.view.stations[0]?.id || 'library';
  paint();
}
export function close() { if (!W) return; W.audio?.pause(); stopPreview(); W.el.remove(); W = null; }
async function load() { W.view = await getJSON('/api/radio/manage'); }
function refreshSoon() { clearTimeout(refreshT); refreshT = setTimeout(async () => { if (!W || W.busy) return; try { await load(); if (W && !W.typing) paint(); } catch { /* the next change */ } }, 350); }
const stationOf = id => W?.view?.stations.find(s => s.id === id) || null;
function say(t, bad = false) { const s = W?.el.querySelector('.rs-say'); if (s) { s.textContent = t || ''; s.classList.toggle('bad', !!bad); } }
async function call(url, body, ok) {
  if (W.busy) return null;
  W.busy = true; say('');
  try { const r = await post(url, body); if (ok) app.toast?.(typeof ok === 'function' ? ok(r) : ok, 'good', 2600); return r || {}; }
  catch (e) { say(e.message || 'Not done', true); return null; }
  finally { if (W) W.busy = false; }
}
/** A change to a station's songs, then the window again. */
async function change(st, body, ok) {
  const r = await call('/api/radio/playlist', { station: st.id, ...body }, ok);
  if (r && W) { await load(); paint(); }
  return r;
}
async function adminSave(patch, ok = 'Saved') { const r = await call('/api/radio/admin', patch, ok); if (r && W) { await load(); paint(); } return r; }

function paint() { if (!W) return; paintSide(); paintMain(); }
function paintSide() {
  const V = W.view, side = W.el.querySelector('.rs-side');
  const item = st => `<button type="button" class="rs-st${W.sel === st.id ? ' on' : ''}" data-sel="${esc(st.id)}" style="--rc:${esc(st.color || '#4aa3ff')}">
    <span class="rs-dot" aria-hidden="true"></span><span class="rs-stn"><b>${esc(st.name)}</b><small>${esc(st.freq)} ${esc(st.band)} · ${st.studio ? (st.hostNames?.length ? `🎙 ${esc(st.hostNames.map(x => x.name).join(', '))}` : 'studio') : 'city station'}</small></span></button>`;
  const studios = V.stations.filter(s => s.studio), city = V.stations.filter(s => !s.studio);
  side.innerHTML = `<div class="rs-sh">Stations</div>${studios.map(item).join('')}
    ${V.admin ? `<button type="button" class="rs-st rs-new${W.sel === 'new' ? ' on' : ''}" data-sel="new"><span class="rs-plus" aria-hidden="true">＋</span><span class="rs-stn"><b>New station</b><small>a studio in a Radio Station</small></span></button>` : ''}
    ${city.length ? `<div class="rs-sh">City stations</div>${city.map(item).join('')}` : ''}
    <div class="rs-sh">Music</div><button type="button" class="rs-st${W.sel === 'library' ? ' on' : ''}" data-sel="library"><span class="rs-plus" aria-hidden="true">🎵</span><span class="rs-stn"><b>Music Library</b><small>${S.music?.tracks?.size || 0} songs</small></span></button>
    ${V.admin ? `<button type="button" class="rs-st${W.sel === 'settings' ? ' on' : ''}" data-sel="settings"><span class="rs-plus" aria-hidden="true">⚙</span><span class="rs-stn"><b>Radio settings</b><small>the voice of the breaks</small></span></button>` : ''}`;
}
function paintMain() {
  if (!W) return;
  const body = W.el.querySelector('.rs-content');
  const keepScroll = body.scrollTop;
  if (W.sel === 'library') libraryPage(body);
  else if (W.sel === 'settings') settingsPage(body);
  else if (W.sel === 'new') newPage(body);
  else { const st = stationOf(W.sel); if (st) stationPage(body, st); else body.innerHTML = '<p class="hint">Choose a station.</p>'; }
  body.scrollTop = keepScroll;
}

// ------------------------------------------------------------------------------------------------- a station
function stationPage(body, st) {
  const admin = W.view.admin, tabs = TABS.filter(([k]) => admin || OWNER_TABS.has(k));
  if (!tabs.some(([k]) => k === W.tab)) W.tab = 'overview';
  body.innerHTML = `<div class="rs-sthead" style="--rc:${esc(st.color || '#4aa3ff')}"><div class="rs-big"><span class="rs-freq">${esc(st.freq)}<small>${esc(st.band)}</small></span>
      <div><h3>${esc(st.name)}</h3><p class="hint">${esc(st.line || '')}${st.talk ? ' · talk radio' : ''} · ${st.studio ? '🎙️ broadcast from its studio' : 'a city station (no studio)'} · you: ${esc(RIGHT[st.right] || '')}</p></div></div>
    <nav class="rs-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="rs-tab${W.tab === k ? ' on' : ''}" aria-selected="${W.tab === k}" data-tab="${k}">${t}</button>`).join('')}</nav></div>
    <div class="rs-tabbody"></div>`;
  body.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { W.tab = b.dataset.tab; W.add = null; W.up = null; paintMain(); }; });
  const tb = body.querySelector('.rs-tabbody');
  ({ overview: overviewTab, playlist: playlistTab, hosts: hostsTab, air: airTab, details: detailsTab })[W.tab](tb, st);
}
function nowText(st) {
  const air = S.music?.ready ? onAir(stationTracks(S.music.tracks.values(), st), st.id, app.net.realNow(), st.order, talkOf(st).every) : null;
  const talk = app.radio?.onAir && app.radio?.room?.station === st.id ? app.radio.onAir : null;
  return talk ? `🎙 ${talk.host || 'The host'} is talking` : air?.kind === 'song' ? `♪ ${air.track.title || 'Untitled'}${air.track.artist ? ` · ${air.track.artist}` : ''}` : air ? 'Station ident' : 'Nothing to play yet: give it songs';
}
function changeText(e) {
  const t = e.titles || [], one = t[0] ? `«${t[0]}»` : 'a song', more = t.length > 1 ? ` and ${t.length - 1} more` : '';
  switch (e.op) {
    case 'add': return `added ${one}${more}`;
    case 'remove': return `took ${one} off`;
    case 'move': return `moved ${one} to number ${(e.to ?? 0) + 1}`;
    case 'set': return `put its ${e.count} songs in a new order`;
    case 'mode': return e.mode === 'genres' ? 'went back to its genres' : 'gave it its own playlist';
    case 'undo': return `undid a change (${e.what === 'add' ? `adding ${one}` : e.what === 'remove' ? `taking ${one} off` : e.what === 'move' ? `moving ${one}` : e.what})`;
    default: return e.op;
  }
}
function overviewTab(tb, st) {
  const ids = st.songs || [], secs = ids.reduce((a, id) => a + (track(id)?.seconds || 0), 0);
  const mayUndo = st.right === 'admin' || st.right === 'owner';
  const log = (st.log || []).map(e => `<li class="rs-log${e.undone ? ' undone' : ''}"><span class="rs-who rs-${esc(e.by.kind)}">${e.by.kind === 'host' ? '🤖' : e.by.kind === 'admin' ? '🛡' : '🧍'} ${esc(e.by.name)}</span>
    <span>${esc(changeText(e))}</span><small>${ago(e.at)}${e.undone ? ' · undone' : ''}</small>${mayUndo && !e.undone && e.op !== 'undo' ? `<button type="button" class="btn small" data-undo="${esc(e.id)}">↶ Undo</button>` : ''}</li>`).join('');
  tb.innerHTML = `<div class="rs-cards">
      <div class="rs-card rs-now"><small>On the air now</small><b>${esc(nowText(st))}</b></div>
      <div class="rs-card"><small>Songs</small><b>${ids.length}</b><span class="hint">${secs ? long(secs) : '—'} · ${st.mode === 'own' ? `its own playlist${st.order === 'order' ? ', in order' : ', shuffled'}` : 'its genres from the library'}</span></div>
      <div class="rs-card"><small>${st.studio ? 'Hosts and DJ' : 'Hosts'}</small><b>${st.crew?.length || 0}</b><span class="hint">${st.crew?.length ? esc(st.crew.map(a => a.name).join(', ')) : 'none yet'}</span></div></div>
    <div class="st-sec"><div class="st-sec-h"><h4>On the air</h4></div>
      <p class="hint">${st.hostNames?.length ? `In the studio now: ${esc(st.hostNames.map(x => x.name).join(', '))}.` : 'No host on the air right now: music and idents.'}${st.away?.length ? ` Not in: ${esc(st.away.map(x => `${x.name} (${x.text})`).join(', '))}.` : ''}</p></div>
    <div class="st-sec"><div class="st-sec-h"><h4>Changes to its songs</h4><span class="st-pill">${st.log?.length || 0}</span></div>
      <p class="hint">Who changed its playlist and what — its administrators, its hosts' owners and ${st.hostsEdit === false ? 'not its hosts (they may not, Hosts tab)' : 'its hosts themselves'}. ${mayUndo ? 'Undo puts a change back.' : ''}</p>
      ${log ? `<ul class="rs-logs">${log}</ul>` : '<p class="hint dim">No changes yet.</p>'}</div>`;
  tb.querySelectorAll('[data-undo]').forEach(b => { b.onclick = async () => { const r = await call('/api/radio/playlist/undo', { station: st.id, change: b.dataset.undo }, 'Undone'); if (r && W) { await load(); paint(); } }; });
}

// ---- its songs
function playlistTab(tb, st) {
  const ids = st.songs || [], admin = W.view.admin, own = st.mode === 'own';
  const rows = ids.map((id, k) => {
    const t = track(id);
    return `<li class="rs-song" data-id="${esc(id)}"><span class="rs-n">${k + 1}</span><span class="rs-ti"><b>${esc(t?.title || 'A song (gone)')}</b><small>${esc(t?.artist || '')}${t?.album ? ` · ${esc(t.album)}` : ''}${t ? ` · ${esc(GENRES[t.genre]?.name || t.genre)}` : ''}</small></span>
      <span class="rs-len">${t ? fmtTime(t.seconds) : ''}</span><span class="rs-acts">${k ? `<button type="button" class="btn small icon" data-top="${k}" title="To the top" aria-label="To the top">⤒</button><button type="button" class="btn small icon" data-up="${k}" title="Earlier" aria-label="Earlier">↑</button>` : ''}${k < ids.length - 1 ? `<button type="button" class="btn small icon" data-down="${k}" title="Later" aria-label="Later">↓</button>` : ''}<button type="button" class="btn small icon" data-out="${k}" title="Take it off" aria-label="Take it off">✕</button></span></li>`;
  }).join('');
  tb.innerHTML = `<div class="rs-plbar">
      <span class="hint">${own ? `Its own playlist: <b>${ids.length}</b> songs` : `It plays its genres from the library: <b>${ids.length}</b> songs. Your first change gives it its own playlist made of these, so nothing it plays goes missing.`}</span>
      ${admin ? `<label class="rs-inl">Order <select class="rs-order"><option value="shuffle"${st.order !== 'order' ? ' selected' : ''}>Shuffled each round</option><option value="order"${st.order === 'order' ? ' selected' : ''}>In this order</option></select></label>` : ''}
      ${admin && own && (st.genres?.length || st.families?.length) ? '<button type="button" class="btn small" data-mode="genres" title="Its playlist goes: it plays the genres chosen in On air">Use its genres again</button>' : ''}</div>
    <div class="row wrap rs-plbtns"><button type="button" class="btn primary" data-c="add">＋ Add from the library</button><button type="button" class="btn" data-c="up">⬆ Upload a song to it</button>
      ${ids.length && st.right !== 'host' ? '<button type="button" class="btn danger rs-clear" data-c="clear" title="Every song off: start fresh (Undo in Overview puts them back)">Clear all songs</button>' : ''}</div>
    ${W.add ? addBox(st) : ''}${W.up ? upBox(st) : ''}
    ${rows ? `<ol class="rs-pl">${rows}</ol>` : `<p class="hint dim">${own ? 'No songs: it plays nothing until you add some — from the library, or upload one.' : 'No songs yet: add some from the library, or upload one.'}</p>`}`;
  const at = i => ids[Number(i)];
  tb.querySelector('[data-c="add"]').onclick = () => { W.add = W.add ? null : { q: '', genre: '', picked: new Set(), view: 'songs', sort: 'title' }; W.up = null; paintMain(); };
  tb.querySelector('[data-c="clear"]')?.addEventListener('click', () => { if (!confirm(`Take all ${ids.length} songs off ${st.name}? It plays nothing until you add some. (Undo in Overview puts them back.)`)) return; change(st, { op: 'clear' }, `${st.name} has no songs now: it plays nothing until you add some (Undo in Overview)`); });
  tb.querySelector('[data-c="up"]').onclick = () => { W.up = W.up ? null : { genre: st.genres?.[0] && UPLOAD_GENRES.includes(st.genres[0]) ? st.genres[0] : 'pop' }; W.add = null; paintMain(); };
  tb.querySelectorAll('[data-top]').forEach(b => { b.onclick = () => change(st, { op: 'move', song: at(b.dataset.top), to: 0 }); });
  tb.querySelectorAll('[data-up]').forEach(b => { b.onclick = () => change(st, { op: 'move', song: at(b.dataset.up), to: Number(b.dataset.up) - 1 }); });
  tb.querySelectorAll('[data-down]').forEach(b => { b.onclick = () => change(st, { op: 'move', song: at(b.dataset.down), to: Number(b.dataset.down) + 1 }); });
  tb.querySelectorAll('[data-out]').forEach(b => { b.onclick = () => change(st, { op: 'remove', song: at(b.dataset.out) }, `«${track(at(b.dataset.out))?.title || 'The song'}» is off ${st.name}`); });
  tb.querySelector('.rs-order')?.addEventListener('change', e => adminSave({ station: { id: st.id, order: e.target.value } }));
  tb.querySelector('[data-mode]')?.addEventListener('click', () => { if (confirm(`Take ${st.name}'s own playlist away? It plays the genres chosen in On air again (Undo puts the playlist back).`)) change(st, { op: 'mode', mode: 'genres' }, `${st.name} plays its genres again`); });
  if (W.add) wireAdd(tb, st);
  if (W.up) wireUp(tb, st);
}
/** Adding from the library (2026-11-25, the product owner: "sorted by artist and also by album, not just the genre"):
 *  Songs (search; sorted by title, artist, album or genre; a genre's), Albums (each with its cover: add it whole) and
 *  Artists (add all of theirs) — only what is not on the station yet. */
function addBox(st) {
  const on = new Set(st.songs || []), A = W.add;
  const all = [...(S.music?.tracks?.values() || [])].filter(t => approved(t) && !on.has(t.id));
  const tabs = [['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists']];
  let body = '';
  if (A.view === 'albums') {
    const by = new Map();
    for (const t of all) if (t.albumKey) { if (!by.has(t.albumKey)) by.set(t.albumKey, { key: t.albumKey, name: t.album, artist: t.albumArtist, list: [] }); by.get(t.albumKey).list.push(t); }
    const albums = [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
    body = albums.length ? `<ul class="rs-pick rs-picka">${albums.map(x => { const rec = S.music?.albums?.get(x.key); return `<li data-find="${esc(`${x.name} ${x.artist}`.toLowerCase())}"><span class="rs-pa">${rec?.cover ? `<img class="ml-cover mid" src="${esc(rec.cover)}" alt="">` : '<span class="ml-cover mid ml-noc" aria-hidden="true">♪</span>'}
      <span class="rs-ti"><b>${esc(x.name)}</b><small>${esc(x.artist)} · ${x.list.length} song${x.list.length === 1 ? '' : 's'} not on it</small></span></span><button type="button" class="btn small primary" data-addids="${esc(x.list.map(t => t.id).join(','))}">＋ Add the album</button></li>`; }).join('')}</ul>`
      : '<p class="hint dim">No album has songs left to add.</p>';
  } else if (A.view === 'artists') {
    const by = new Map();
    for (const t of all) { const n = t.artist || 'Unknown artist'; if (!by.has(n)) by.set(n, []); by.get(n).push(t); }
    body = `<ul class="rs-pick rs-picka">${[...by].sort((a, b) => a[0].localeCompare(b[0])).map(([n, list]) => `<li data-find="${esc(n.toLowerCase())}"><span class="rs-ti"><b>${esc(n)}</b><small>${list.length} song${list.length === 1 ? '' : 's'} not on it${[...new Set(list.map(t => t.album).filter(Boolean))].length ? ` · ${esc([...new Set(list.map(t => t.album).filter(Boolean))].slice(0, 3).join(', '))}` : ''}</small></span>
      <button type="button" class="btn small primary" data-addids="${esc(list.map(t => t.id).join(','))}">＋ Add all</button></li>`).join('')}</ul>`;
  } else {
    const key = { title: t => t.title, artist: t => `${t.artist} ${t.album || ''} ${String(t.track || 0).padStart(3, '0')} ${t.title}`, album: t => `${t.album || '￿'} ${String(t.track || 0).padStart(3, '0')} ${t.title}`, genre: t => `${GENRES[t.genre]?.name || t.genre} ${t.title}` }[A.sort] || (t => t.title);
    const list = all.slice().sort((a, b) => key(a).localeCompare(key(b)));
    const gs = [...new Set(all.map(t => t.genre))].sort();
    body = `<div class="row wrap rs-sortby"><label class="rs-inl">Sort by <select class="input rs-sort">${[['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['genre', 'Genre']].map(([k, l]) => `<option value="${k}"${A.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="rs-chips">${['', ...gs].map(g => `<button type="button" class="rs-chip${A.genre === g ? ' on' : ''}" data-genre="${g}">${esc(g ? GENRES[g]?.name || g : 'All')}</button>`).join('')}</div>
      <ul class="rs-pick">${list.map(t => `<li data-find="${esc(`${t.title} ${t.artist} ${t.album || ''} ${GENRES[t.genre]?.name || t.genre}`.toLowerCase())}" data-g="${esc(t.genre)}"><label><input type="checkbox" value="${esc(t.id)}"${A.picked.has(t.id) ? ' checked' : ''}>
        <span class="rs-ti"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}${t.album ? ` · ${esc(t.album)}` : ''} · ${esc(GENRES[t.genre]?.name || t.genre)} · ${fmtTime(t.seconds)}</small></span></label></li>`).join('') || '<li class="hint">Every song is on it already.</li>'}</ul>`;
  }
  return `<div class="rs-box rs-add"><div class="rs-boxh"><b>Add from the library</b><span class="hint">${all.length} songs not on ${esc(st.name)}</span></div>
    <nav class="rs-tabs rs-addtabs">${tabs.map(([k, l]) => `<button type="button" class="rs-tab${A.view === k ? ' on' : ''}" data-aview="${k}">${l}</button>`).join('')}</nav>
    <input type="search" class="input rs-q" placeholder="${A.view === 'albums' ? 'Search albums or artists' : A.view === 'artists' ? 'Search artists' : 'Search title, artist, album or genre'}" value="${esc(A.q)}" aria-label="Search the library">
    ${body}
    <div class="row rs-boxf">${A.view === 'songs' ? `<button type="button" class="btn primary" data-c="addgo"${A.picked.size ? '' : ' disabled'}>Add ${A.picked.size || ''} song${A.picked.size === 1 ? '' : 's'}</button>` : ''}<button type="button" class="btn" data-c="addx">Close</button></div></div>`;
}
function wireAdd(tb, st) {
  const A = W.add, box = tb.querySelector('.rs-add');
  const filter = () => { const w = A.q.trim().toLowerCase(); box.querySelectorAll('.rs-pick li[data-find]').forEach(li => { li.hidden = !((!w || li.dataset.find.includes(w)) && (!A.genre || !li.dataset.g || li.dataset.g === A.genre)); }); };
  const q = box.querySelector('.rs-q');
  q.oninput = () => { A.q = q.value; filter(); };
  box.querySelectorAll('[data-aview]').forEach(b => { b.onclick = () => { A.view = b.dataset.aview; A.q = ''; paintMain(); }; });
  box.querySelector('.rs-sort')?.addEventListener('change', e => { A.sort = e.target.value; paintMain(); });
  box.querySelectorAll('[data-genre]').forEach(b => { b.onclick = () => { A.genre = b.dataset.genre; box.querySelectorAll('[data-genre]').forEach(x => x.classList.toggle('on', x === b)); filter(); }; });
  const go = box.querySelector('[data-c="addgo"]');
  box.querySelectorAll('.rs-pick input').forEach(c => { c.onchange = () => { if (c.checked) A.picked.add(c.value); else A.picked.delete(c.value); if (go) { go.disabled = !A.picked.size; go.textContent = `Add ${A.picked.size || ''} song${A.picked.size === 1 ? '' : 's'}`; } }; });
  go?.addEventListener('click', async () => { const n = A.picked.size; const r = await change(st, { op: 'add', songs: [...A.picked] }, `${n} song${n === 1 ? '' : 's'} added to ${st.name}`); if (r && W) { A.picked.clear(); paintMain(); } });
  box.querySelectorAll('[data-addids]').forEach(b => { b.onclick = async () => { const ids = b.dataset.addids.split(',').filter(Boolean); await change(st, { op: 'add', songs: ids }, `${ids.length} song${ids.length === 1 ? '' : 's'} added to ${st.name}`); }; });
  box.querySelector('[data-c="addx"]').onclick = () => { W.add = null; paintMain(); };
  filter();
}
function upBox(st) {
  const U = W.up, admin = W.view.admin, conv = !!S.music?.can?.convert;
  return `<form class="rs-box rs-up" autocomplete="off"><div class="rs-boxh"><b>Upload a song to ${esc(st.name)}</b><span class="hint">${admin ? 'It goes into the library and onto this station at once.' : 'It goes into the library for an administrator\'s review; add it here once it is approved.'}</span></div>
    <label class="mp-file"><input type="file" name="file" accept="${conv ? 'audio/*' : 'audio/mpeg,.mp3'}"${U.busy ? ' disabled' : ''}><span>${esc(U.name || (conv ? 'Choose an audio file (MP3, M4A, OGG, WAV, FLAC)' : 'Choose an MP3 file'))}</span></label>
    <div class="rs-two"><input class="input" name="title" placeholder="Title" maxlength="${MUSIC.titleMax}" required value="${esc(U.title || '')}"><input class="input" name="artist" placeholder="Artist" maxlength="${MUSIC.artistMax}" value="${esc(U.artist ?? auth.account?.displayName ?? '')}"></div>
    <div class="rs-two"><select class="input" name="genre" aria-label="Genre">${UPLOAD_GENRES.map(g => `<option value="${g}"${U.genre === g ? ' selected' : ''}>${esc(GENRES[g].name)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="explicit"${U.explicit ? ' checked' : ''}> Explicit lyrics</label></div>
    ${admin ? '' : `<label class="check"><input type="checkbox" name="rights" required${U.rights ? ' checked' : ''}> It's my song, or I have the rights to share it in My Virtual World</label>`}
    <div class="row rs-boxf"><button type="submit" class="btn primary"${U.busy ? ' disabled' : ''}>${U.busy ? 'Uploading…' : admin ? 'Upload and add' : 'Send for review'}</button><button type="button" class="btn" data-c="upx">Close</button></div>
    <p class="hint">${MUSIC.minSeconds} s to ${MUSIC.maxSeconds / 60} min, up to ${MUSIC.maxUploadMB} MB.</p></form>`;
}
function wireUp(tb, st) {
  const U = W.up, f = tb.querySelector('.rs-up');
  const keep = () => { const e = f.elements; Object.assign(U, { title: e.title.value, artist: e.artist.value, genre: e.genre.value, explicit: e.explicit.checked, rights: e.rights?.checked }); };
  f.elements.file.onchange = () => {
    const file = f.elements.file.files?.[0]; if (!file) return;
    keep();
    const auto = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(), typed = U.title && U.title !== U.autoTitle;
    Object.assign(U, { file, name: file.name, autoTitle: auto, title: typed ? U.title : auto });
    W.typing = false; paintMain();
  };
  f.addEventListener('focusin', () => { W.typing = true; }); f.addEventListener('focusout', () => { W.typing = false; });
  tb.querySelector('[data-c="upx"]').onclick = () => { W.up = null; W.typing = false; paintMain(); };
  f.onsubmit = async ev => {
    ev.preventDefault(); keep();
    if (!U.file) { say('Choose a song file first', true); return; }
    if (U.file.size > MUSIC.maxUploadMB * 1024 * 1024) { say(`A song is at most ${MUSIC.maxUploadMB} MB`, true); return; }
    U.busy = true; W.typing = false; paintMain();
    try {
      const j = await sendSong(U.file, U);
      await app.music?.loadLibrary?.();
      if (!W) return;
      if (j.track?.status === 'approved') {
        W.up = null;
        await change(st, { op: 'add', song: j.track.id }, `🎵 «${j.track.title}» is in the library and on ${st.name}`);
      } else { W.up = null; app.toast?.(`🎵 Thanks! «${j.track?.title || 'Your song'}» waits for an administrator's review`, 'good', 3600); paintMain(); }
    } catch (e) { if (W?.up) { U.busy = false; paintMain(); } say(String(e.message || e), true); }
  };
}

// ---- its hosts
function hostsTab(tb, st) {
  const A = W.view.agents || [], crew = st.crew || [];
  const pick = k => `<select class="input rs-h" data-k="${k}"><option value="">—</option>${A.map(a => `<option value="${a.id}"${st.hosts?.[k] === a.id ? ' selected' : ''}>${esc(`${a.emoji ? `${a.emoji} ` : ''}${a.name}`)}</option>`).join('')}</select>`;
  tb.innerHTML = `<div class="st-sec"><div class="st-sec-h"><h4>${st.studio ? 'At its desk' : 'Its hosts'}</h4><span class="st-pill">${crew.length}</span></div>
      ${crew.length ? `<ul class="rs-crew">${crew.map(a => `<li><span>${esc(a.emoji || '🤖')} <b>${esc(a.name)}</b></span>${st.hostNames?.some(x => x.id === a.id) ? '<small class="good">on the air now</small>' : '<small class="dim">off the air</small>'}</li>`).join('')}</ul>` : '<p class="hint dim">Nobody yet.</p>'}
      ${st.studio ? `<p class="hint">A studio's hosts (up to ${MAX_HOSTS}) and its DJ are the agents posted at its broadcast desk and DJ booth: open its floor and use the ⋯ on a seat, as for any post. Hosting the station is running it.</p>
        <button type="button" class="btn" data-c="go">🎙️ Go to its studio</button>`
        : `<p class="hint">A city station has no studio: its hosts (up to ${MAX_HOSTS}, taking turns) talk from wherever they are.</p><div class="row wrap rs-hosts">${Array.from({ length: MAX_HOSTS }, (_, k) => pick(k)).join('')}</div>
        <button type="button" class="btn primary" data-c="hosts">Save its hosts</button>`}</div>
    <div class="st-sec"><div class="st-sec-h"><h4>Its songs</h4></div>
      <label class="check"><input type="checkbox" class="rs-he"${st.hostsEdit !== false ? ' checked' : ''}> Its hosts may change its songs</label>
      <p class="hint">Hosts add songs from the music library, take some off and change their order (in their chats, by their own choice), at most ${W.view.limits?.agentPerDay || 40} changes a day each. Every change shows in Overview, where you can undo it. Its hosts' owners may change them too. Hosts never place or remove a station.</p></div>`;
  tb.querySelector('[data-c="go"]')?.addEventListener('click', () => { close(); app.lookInside?.(st.studio.b, st.studio.f); });
  tb.querySelector('[data-c="hosts"]')?.addEventListener('click', () => adminSave({ station: { id: st.id, hosts: [...tb.querySelectorAll('.rs-h')].map(x => Number(x.value)).filter(Boolean) } }, 'Its hosts are saved'));
  tb.querySelector('.rs-he').onchange = e => adminSave({ station: { id: st.id, hostsEdit: e.target.checked } }, e.target.checked ? 'Its hosts may change its songs' : 'Only you and its hosts\' owners change its songs now');
}

// ---- on the air
function airTab(tb, st) {
  const fams = new Set(st.families || []), genres = new Set(st.genres || []);
  for (const [g, G] of Object.entries(GENRES)) if (fams.has(G.family) && !G.internal) genres.add(g);
  const pace = s => {
    const p = talkPace(stationTracks(S.music?.tracks?.values() || [], s), s), { max } = talkOf(s), min = m => (m < 1.5 ? 'minute' : `${Math.round(m)} minutes`);
    if (max === 0) return 'No talk: music and idents only.';
    if (!p) return 'It has no songs to play yet.';
    return p.capped ? `At most ${max} a day: about one break every ${min(p.minutesApart)}, spread over the day.` : `Its hosts talk about every ${min(p.slotMinutes)}: about ${p.slotsADay} breaks a day.`;
  };
  tb.innerHTML = `<form class="rs-form" autocomplete="off">
    <label class="check"><input type="checkbox" name="talk"${st.talk ? ' checked' : ''}> Talk radio (news, the economy, gossip; an AM sound)</label>
    <div class="rs-two"><label class="snd-l">Hosts talk every<select class="input" name="every">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}"${talkOf(st).every === n ? ' selected' : ''}>${n} song${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
      <label class="snd-l">Talk length<select class="input" name="len">${LENGTHS.map(([k, t]) => `<option value="${k}"${talkOf(st).length === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <label class="snd-l">At most<span class="row" style="gap:6px;align-items:center"><input class="input" type="number" name="max" min="0" max="${TALK_MAX}" step="1" style="width:110px" placeholder="no limit" value="${st.talkMax ?? ''}"> breaks a day <span class="hint">(empty: as often as set; 0: no talk)</span></span></label>
    <p class="hint rs-pace">${esc(pace(st))}</p>
    <div class="rs-two"><label class="check"><input type="checkbox" name="ads"${st.ads?.on !== false ? ' checked' : ''}> Ads in the breaks</label>
      <label class="snd-l">every<select class="input" name="adsEvery">${[1, 2, 3, 4, 6].map(n => `<option${(st.ads?.every || 2) === n ? ' selected' : ''}>${n}</option>`).join('')}</select> breaks</label></div>
    <div class="snd-l">The genres it plays when it has no playlist of its own<div class="rs-genres">${Object.entries(GENRES).map(([g, G]) => `<label class="check"><input type="checkbox" name="genre" value="${g}"${genres.has(g) ? ' checked' : ''}> ${esc(G.name)}</label>`).join('')}</div>
      <p class="hint">${st.mode === 'own' ? 'It plays its own playlist now (Playlist tab); these are for when it goes back to its genres.' : 'It plays these now; its first change in Playlist gives it a playlist of its own.'}</p></div>
    <div class="row"><button type="submit" class="btn primary">Save</button></div></form>`;
  const f = tb.querySelector('form');
  const read = () => { const e = f.elements; return { id: st.id, talk: e.talk.checked, talkEvery: Number(e.every.value), talkLength: e.len.value, talkMax: e.max.value.trim() === '' ? null : Number(e.max.value), ads: { on: e.ads.checked, every: Number(e.adsEvery.value) }, genres: [...f.querySelectorAll('input[name="genre"]:checked')].map(x => x.value), families: [] }; };
  f.addEventListener('input', () => { f.querySelector('.rs-pace').textContent = pace({ ...st, ...read() }); });
  f.onsubmit = ev => { ev.preventDefault(); adminSave({ station: read() }); };
}

// ---- its details
function detailsTab(tb, st) {
  tb.innerHTML = `<form class="rs-form" autocomplete="off">
    <label class="snd-l">Name<input class="input" name="name" maxlength="40" value="${esc(st.name || '')}"></label>
    <div class="rs-two"><label class="snd-l">Frequency<input class="input" name="freq" value="${esc(st.freq || '')}" placeholder="101.5"></label>
      <label class="snd-l">Band<select class="input" name="band"><option${st.band !== 'AM' ? ' selected' : ''}>FM</option><option${st.band === 'AM' ? ' selected' : ''}>AM</option></select></label>
      <label class="snd-l">Colour<input type="color" name="color" value="${esc(st.color || '#4aa3ff')}"></label></div>
    <label class="snd-l">Its line<input class="input" name="line" maxlength="80" value="${esc(st.line || '')}" placeholder="Smooth jazz all night"></label>
    <div class="row"><button type="submit" class="btn primary">Save</button></div></form>
    <div class="st-sec rs-danger"><div class="st-sec-h"><h4>Remove the station</h4></div>
      <p class="hint">${st.studio ? 'Its studio room goes too (its walls and pieces); Ctrl+Z in the world puts it back with its settings and songs.' : 'It goes off the air in every car, boat and aircraft. Its songs stay in the library.'}</p>
      <button type="button" class="btn danger" data-c="del">Remove ${esc(st.name)}</button></div>`;
  const f = tb.querySelector('form');
  f.onsubmit = ev => { ev.preventDefault(); const e = f.elements; adminSave({ station: { id: st.id, name: e.name.value, freq: e.freq.value, band: e.band.value, color: e.color.value, line: e.line.value } }); };
  tb.querySelector('[data-c="del"]').onclick = async () => {
    if (!confirm(`Remove ${st.name}?${st.studio ? ' Its studio room goes with it.' : ''}`)) return;
    if (st.studio) {
      const r = await call('/api/edit', { ops: [{ op: 'imod.del', b: st.studio.b, f: st.studio.f, id: st.studio.room }] }, `${st.name} is off the air (Ctrl+Z puts its studio back)`);
      if (r && W) { W.sel = null; setTimeout(async () => { if (!W) return; await load(); W.sel = W.view.stations[0]?.id || 'library'; paint(); }, 600); }
    } else {
      const r = await adminSave({ remove: st.id }, `${st.name} is off the air`);
      if (r && W) { W.sel = W.view.stations[0]?.id || 'library'; paint(); }
    }
  };
}

// ------------------------------------------------------------------------------------------------- a new station
function newPage(body) {
  const Bs = radioBuildings();
  const studiosOn = (B, f) => (S.world.levels[B.lv?.[f]]?.mods || []).filter(m => m.kind === 'studio').length;
  body.innerHTML = `<div class="rs-sthead"><h3>A new station</h3><p class="hint">Each station is a studio inside a Radio Station building: placing the studio puts it on the air. Choose where, then click where it goes on that floor (R turns its door). It opens here when it is on the air, to name it and give it songs.</p></div>
    ${Bs.length ? `<div class="rs-where">${Bs.map(B => `<div class="rs-card"><b>📻 ${esc(B.name || 'MVW Radio')}</b><div class="row wrap">${Array.from({ length: B.floors }, (_, f) => `<button type="button" class="btn" data-b="${B.idx}" data-f="${f}">Floor ${f + 1} <span class="dim">· ${studiosOn(B, f)} studio${studiosOn(B, f) === 1 ? '' : 's'}</span></button>`).join('')}</div></div>`).join('')}</div>`
      : '<div class="rs-card"><b>No Radio Station yet</b><p class="hint">Place one first: Edit → World modules → Radio Station (on open land beyond the city). Its studios are the stations.</p></div>'}`;
  body.querySelectorAll('[data-b]').forEach(b => { b.onclick = () => placeStudio(Number(b.dataset.b), Number(b.dataset.f)); });
}
function placeStudio(b, f) {
  pending = { b, f, ids: new Set((W?.view?.stations || []).map(s => s.id)), until: Date.now() + 15 * 60e3 };
  close();
  app.lookInside?.(b, f);
  setTimeout(() => { app.setMode?.('furnish'); setTimeout(() => { app.modulesTool?.place?.('studio'); app.toast?.('Click where the studio goes (R turns its door). It goes on the air as a new station.', 'good', 5200); }, 450); }, 450);
}
/** A studio just placed from the window: its station opens there when it is on the air. */
function newStudio(list) {
  if (!pending || Date.now() > pending.until) { pending = null; return; }
  const st = list.find(s => s.studio && s.studio.b === pending.b && s.studio.f === pending.f && !pending.ids.has(s.id));
  if (!st) return;
  pending = null;
  app.modulesTool?.place?.(null);
  app.toast?.(`📻 ${st.name} is on the air: name it and give it songs`, 'good', 4200);
  open({ station: st.id, tab: 'details' });
}

// ------------------------------------------------------------------------------------------------- the library
/** The Music Library (ui/music-library.js: songs, albums, artists, genres, review) with this window's stations. */
function libraryPage(body) {
  libraryView(body, {
    state: W.lib, admin: W.view.admin, stations: W.view.stations.filter(x => x.right), allStations: W.view.stations,
    add: async (id, ids) => {
      const st = stationOf(id); if (!st) return false;
      const on = new Set(st.songs || []), add = ids.filter(x => !on.has(x));
      if (!add.length) { say(`Those songs are on ${st.name} already`, true); return false; }
      return !!(await change(st, { op: 'add', songs: add }, `${add.length} song${add.length === 1 ? '' : 's'} added to ${st.name}`));
    },
    call: (url, b, ok) => call(url, b, ok), say,
    reload: async () => { await app.music?.loadLibrary?.(); if (!W) return; await load(); paint(); },
    repaint: () => paintMain(),
    single: (el, U) => singleUpload(el, U),
  });
}
/** One song to the library (the Upload a song box). */
function singleUpload(el, U) {
  const admin = W.view.admin, conv = !!S.music?.can?.convert;
  U.genre ||= 'pop';
  el.innerHTML = `<form class="rs-box rs-up" autocomplete="off"><div class="rs-boxh"><b>Upload a song</b><span class="hint">${admin ? 'It goes straight into the library.' : 'An administrator listens first.'}</span></div>
    <label class="mp-file"><input type="file" name="file" accept="${conv ? 'audio/*' : 'audio/mpeg,.mp3'}"${U.busy ? ' disabled' : ''}><span>${esc(U.name || (conv ? 'Choose an audio file (MP3, M4A, OGG, WAV, FLAC)' : 'Choose an MP3 file'))}</span></label>
    <div class="rs-two"><input class="input" name="title" placeholder="Title" maxlength="${MUSIC.titleMax}" required value="${esc(U.title || '')}"><input class="input" name="artist" placeholder="Artist" maxlength="${MUSIC.artistMax}" value="${esc(U.artist ?? auth.account?.displayName ?? '')}"></div>
    <div class="rs-two"><input class="input" name="album" placeholder="Album (none: a single)" maxlength="80" value="${esc(U.album || '')}"><input class="input" name="track" placeholder="No." inputmode="numeric" value="${esc(U.track || '')}" style="max-width:80px"></div>
    <div class="rs-two"><select class="input" name="genre" aria-label="Genre">${UPLOAD_GENRES.map(g => `<option value="${g}"${U.genre === g ? ' selected' : ''}>${esc(GENRES[g].name)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="explicit"${U.explicit ? ' checked' : ''}> Explicit lyrics</label></div>
    ${admin ? '' : `<label class="check"><input type="checkbox" name="rights" required${U.rights ? ' checked' : ''}> It's my song, or I have the rights to share it in My Virtual World</label>`}
    <div class="row rs-boxf"><button type="submit" class="btn primary"${U.busy ? ' disabled' : ''}>${U.busy ? 'Uploading…' : admin ? 'Upload' : 'Send for review'}</button><button type="button" class="btn" data-c="upx">Close</button></div></form>`;
  const f = el.querySelector('form');
  const keep = () => { const e = f.elements; Object.assign(U, { title: e.title.value, artist: e.artist.value, album: e.album.value, track: e.track.value, genre: e.genre.value, explicit: e.explicit.checked, rights: e.rights?.checked }); };
  f.elements.file.onchange = async () => {
    const file = f.elements.file.files?.[0]; if (!file) return; keep();
    const tags = /\.mp3$/i.test(file.name) || file.type === 'audio/mpeg' ? await readTags(file) : {};
    const auto = tags.title || file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(), typed = U.title && U.title !== U.autoTitle;
    Object.assign(U, { file, name: file.name, autoTitle: auto, title: typed ? U.title : auto, ...(tags.artist && !U.artist ? { artist: tags.artist } : {}), ...(tags.album && !U.album ? { album: tags.album, albumArtist: tags.albumArtist, year: tags.year } : {}), ...(tags.track && !U.track ? { track: tags.track } : {}) });
    W.typing = false; paintMain();
  };
  f.querySelector('[data-c="upx"]').onclick = () => { W.lib.one = null; W.typing = false; paintMain(); };
  f.onsubmit = async ev => {
    ev.preventDefault(); keep();
    if (!U.file) { say('Choose a song file first', true); return; }
    if (U.file.size > MUSIC.maxUploadMB * 1024 * 1024) { say(`A song is at most ${MUSIC.maxUploadMB} MB`, true); return; }
    U.busy = true; W.typing = false; paintMain();
    try {
      const j = await sendSong(U.file, { ...U, album: U.album?.trim() || null, albumArtist: U.album?.trim() ? (U.albumArtist || U.artist) : null, track: Number(U.track) || null, year: Number(U.year) || null });
      app.toast?.(j.track?.status === 'approved' ? `🎵 «${j.track.title}» is in the library` : `🎵 Thanks! «${j.track?.title || 'Your song'}» waits for an administrator's review`, 'good', 3600);
      await app.music?.loadLibrary?.();
      if (W) { W.lib.one = null; paintMain(); }
    } catch (e) { if (W?.lib.one) { U.busy = false; paintMain(); } say(String(e.message || e), true); }
  };
}

// ------------------------------------------------------------------------------------------------- settings
function settingsPage(body) {
  const V = W.view, C = V.config || {};
  body.innerHTML = `<div class="rs-sthead"><h3>⚙ Radio settings</h3><p class="hint">For every station.</p></div>
    <label class="snd-l">The voice of the breaks<select class="input rs-voice"><option value="host"${C.voice === 'host' ? ' selected' : ''}>Each host's own voice (their Agent Studio voice; the free voice if they have none)</option><option value="free"${C.voice === 'free' ? ' selected' : ''}>The free voice for every host (each listener's browser reads it)</option>${(V.voices || []).map(c => `<option value="${c.id}"${String(C.voice) === String(c.id) ? ' selected' : ''}>${esc(c.label)} for every host</option>`).join('')}</select></label>
    <p class="hint">A voice service (ElevenLabs, OpenAI…) is added in Settings → Connections; when it can't speak a break, the free voice does.</p>`;
  body.querySelector('.rs-voice').onchange = e => adminSave({ voice: e.target.value });
}
