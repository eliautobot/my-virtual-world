// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A stage's music panel (2026-10-23, the product owner: "some kind of way to add to the playlist, so we can easily add in
// the future and other players can add their own some how. So maybe like a UI that can be interacted with when a player
// or user interacts with the jazz stage or the dj booth ... admin should have full control for now").
// Over every Lounge Stage and DJ Stage on the floor being looked into, a 🎵 (its bars moving while music plays); a click
// on it or on the stage, or E next to it when walking, opens the panel, the same on a phone (a sheet from the bottom):
//   now playing   the song, its artist, how far in, who asked for it; the band or the DJ on stage or on a break
//   Up next       the requests (one each; yours you can take back), then the playlist's next songs
//   Request       the stage's songs from the library (search, its genres): ask for one
//   Your songs    add your own (a file, its title, artist, genre, explicit or not, that it's yours to share): it waits
//                 for an administrator, then plays; what became of the ones you added
//   Run           (administrators) requests on or off, the genre for the night, all of the stage's music or its own
//                 playlist (add, reorder, remove), skip, clear the requests
//   Review        (administrators) the songs waiting (listen, approve, reject with a reason) and the whole library
// Everything follows the server's deck (core/music.js): everyone in the room sees and hears the same.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { esc, h } from '../core/util.js';
import { post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { CATALOG } from '/shared/catalog.js';
import { GENRES, UPLOAD_GENRES, STAGES, MUSIC, placeKey, fmtTime, familyOf } from '/shared/music.js';
import { NIGHTLIFE_OPEN } from '/shared/nightlife.js';
import { floorLabel } from '/shared/floor-themes.js';

const LIFT = 0.55, _v = new THREE.Vector3();
const ICON = { lounge: '🎹', club: '🎧' };
const hh = x => { const m = Math.round(((x % 24) + 24) % 24 * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
let app = null, layer = null, panel = null;
const st = { place: null, tab: 'next', q: '', genre: '', pick: false, up: null, busy: false, reject: null, pins: new Map() };

// ----------------------------------------------------------------------------------------------- the stages here
/** The stages on the floor looked into: [{ place, e (interiors entry), family }]. */
function stagesHere() {
  if (S.focus.b < 0 || !S.world) return [];
  const B = S.world.buildings[S.focus.b], L = B && S.world.levels[B.lv?.[S.focus.f]];
  const out = [];
  for (const it of L?.items || []) {
    const sd = STAGES[it.t]; if (!sd) continue;
    const e = app.inter?.findEntry(S.focus.b, S.focus.f, it.id);
    if (e) out.push({ place: placeKey(S.focus.b, S.focus.f, it.id), e, family: sd.family, t: it.t });
  }
  return out;
}
function pinOf(place) {
  let el = st.pins.get(place);
  if (el) return el;
  el = h(`<button type="button" class="mp-pin" aria-label="Music"><span class="mp-bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="mp-note" aria-hidden="true">🎵</span></button>`);
  el.addEventListener('pointerdown', ev => ev.stopPropagation());
  el.addEventListener('click', ev => { ev.stopPropagation(); if (st.place === place) close(); else open(place); });
  layer.appendChild(el); st.pins.set(place, el);
  return el;
}
function frame() {
  const show = S.mode === 'explore' && !app.arcade?.playing, cam = app.stage.camera, seen = new Set();
  if (show) for (const s of stagesHere()) {
    _v.set(s.e.x, s.e.y + (CATALOG[s.t]?.h || 1) + LIFT, s.e.z).project(cam);
    if (!(_v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05)) continue;
    seen.add(s.place);
    const pin = pinOf(s.place), d = S.music?.decks?.get(s.place), playing = !!(d?.live && d.now);
    const t = `translate(${((_v.x + 1) * 0.5 * innerWidth).toFixed(1)}px,${((1 - _v.y) * 0.5 * innerHeight).toFixed(1)}px) translate(-50%,-50%)`;
    if (pin._t !== t) { pin.style.transform = t; pin._t = t; }
    const cls = `mp-pin${playing ? ' playing' : ''}${st.place === s.place ? ' on' : ''}`;
    if (pin.className !== cls) pin.className = cls;
    if (pin.hidden) pin.hidden = false;
  }
  for (const [p, el] of st.pins) if (!seen.has(p) && !el.hidden) el.hidden = true;
  if (panel) tickNow();
}

// ----------------------------------------------------------------------------------------------- the panel
const deck = () => (st.place ? S.music?.decks?.get(st.place) || null : null);
const track = id => S.music?.tracks?.get(id) || null;
const can = k => !!S.music?.can?.[k] && !!auth.account;
const me = () => auth.account?.id ?? null;
async function open(place) {
  close();
  st.place = place; st.tab = 'next'; st.q = ''; st.genre = ''; st.pick = false; st.reject = null;
  panel = h('<div class="mp panel" role="dialog" aria-label="Music"></div>');
  panel.addEventListener('pointerdown', ev => ev.stopPropagation());
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  panel.addEventListener('change', onChange);
  panel.addEventListener('submit', onSubmit);
  document.body.appendChild(panel);
  paint();
  if (!S.music?.decks?.has(place)) { try { await app.music.fetchDeck(place); } catch (e) { app.toast(String(e.message || e), 'bad', 2600); } }
}
function close() { panel?.remove(); panel = null; st.place = null; st.up = null; }

function where(d) {
  const B = S.world?.buildings?.[d?.b ?? -1], L = B && S.world.levels[B.lv?.[d.f]];
  const fl = L ? floorLabel(L) : '';
  return [B?.name, fl || (B && B.floors > 1 ? (d.f === 0 ? 'Ground floor' : `Floor ${d.f + 1}`) : '')].filter(Boolean).join(' · ');
}
function statusLine(d) {
  const sd = Object.values(STAGES).find(x => x.family === d.family), venue = S.world?.levels?.[S.world.buildings[d.b]?.lv?.[d.f]]?.venue;
  if (d.live) return d.now ? `Live: ${sd.who} ${d.family === 'club' ? 'is at the decks' : 'is playing'}` : `${sd.who[0].toUpperCase() + sd.who.slice(1)} is about to start`;
  const hrs = NIGHTLIFE_OPEN[venue];
  return `${sd.who[0].toUpperCase() + sd.who.slice(1)} ${d.family === 'club' ? 'is not at the decks' : 'is on a break'}${hrs ? ` · open ${hh(hrs[0])} to ${hh(hrs[1])}` : ''}`;
}
function nowCard(d) {
  const n = d.now, t = n && track(n.id);
  if (!t) return `<div class="mp-now idle"><span class="mp-dim">${esc(d.music ? statusLine(d) : `No songs in the library for this stage yet: ${d.family === 'club' ? 'the DJ plays its own mixes' : 'the band plays its own tunes'}`)}</span></div>`;
  return `<div class="mp-now"><div class="mp-np"><b>${esc(t.title)}</b><small>${esc(t.artist)} · ${esc(GENRES[t.genre]?.name || t.genre)}${t.explicit ? ' · <span class="mp-e">E</span>' : ''}</small>
      ${n.name ? `<small class="mp-by">Asked for by ${esc(n.name)}</small>` : ''}</div>
    <div class="mp-prog"><span class="mp-t0">0:00</span><div class="mp-bar"><i></i></div><span class="mp-t1">${fmtTime(t.seconds)}</span></div>
    <div class="mp-live">${esc(statusLine(d))}${can('manage') ? ' <button type="button" class="btn small" data-a="skip">⏭ Skip</button>' : ''}</div></div>`;
}
function tickNow() {
  const d = deck(), n = d?.now, t = n && track(n.id), bar = panel?.querySelector('.mp-bar i');
  if (!bar || !t) return;
  const pos = Math.max(0, Math.min(t.seconds, app.net.realNow() - n.at / 1000)), w = `${(100 * pos / t.seconds).toFixed(2)}%`;
  if (bar.style.width !== w) bar.style.width = w;
  const t0 = panel.querySelector('.mp-t0'), s = fmtTime(pos);
  if (t0.textContent !== s) t0.textContent = s;
}
const row = (t, right = '', extra = '') => t ? `<div class="mp-row${extra}"><div class="mp-ti"><b>${esc(t.title)}</b><small>${esc(t.artist)} · ${esc(GENRES[t.genre]?.name || t.genre)} · ${fmtTime(t.seconds)}${t.explicit ? ' · <span class="mp-e">E</span>' : ''}</small></div>${right}</div>` : '';
function tabNext(d) {
  const reqs = d.queue.map((q, k) => {
    const mine = q.by === me(), t = track(q.id);
    const right = mine ? `<button type="button" class="btn small" data-a="cancel">Take back</button>` : can('manage') ? `<button type="button" class="btn small icon" data-a="unq" data-k="${k}" aria-label="Remove">✕</button>` : '';
    return row(t, `<small class="mp-who">${esc(mine ? 'You' : q.name)}</small>${right}`, mine ? ' mine' : '');
  }).join('');
  const next = d.upcoming.map(id => row(track(id))).join('');
  return `${d.queue.length ? `<h4>Requests</h4>${reqs}${can('manage') ? '<button type="button" class="btn small" data-a="clear">Clear the requests</button>' : ''}` : ''}
    <h4>${d.queue.length ? 'Then' : 'Up next'}</h4>${next || '<p class="mp-dim">Nothing yet.</p>'}`;
}
function stageSongs(d) {
  const all = [...(S.music?.tracks?.values() || [])].filter(t => !t.status || t.status === 'approved');
  return all.filter(t => familyOf(t.genre) === d.family || d.settings.playlist?.includes(t.id));
}
function filtered(list) {
  const q = st.q.trim().toLowerCase();
  return list.filter(t => (!st.genre || t.genre === st.genre) && (!q || `${t.title} ${t.artist}`.toLowerCase().includes(q)));
}
function chips(d, list) {
  const gs = [...new Set(list.map(t => t.genre))].sort();
  return `<div class="mp-find"><input type="search" class="mp-q" placeholder="Search songs" value="${esc(st.q)}" aria-label="Search songs">
    <div class="mp-chips" role="radiogroup" aria-label="Genre">${['', ...gs].map(g => `<button type="button" role="radio" aria-checked="${st.genre === g}" class="mp-chip${st.genre === g ? ' on' : ''}" data-a="genre" data-g="${g}">${esc(g ? GENRES[g]?.name || g : 'All')}</button>`).join('')}</div></div>`;
}
function tabRequest(d) {
  const list = stageSongs(d);
  let note = '';
  if (!auth.account) note = '<p class="mp-note">Sign in to ask for a song.</p>';
  else if (!can('request')) note = '<p class="mp-note">Your account may not ask for songs here.</p>';
  else if (!d.settings.requests) note = '<p class="mp-note">Requests are off here right now.</p>';
  const mineQ = d.queue.find(q => q.by === me());
  const ok = auth.account && can('request') && d.settings.requests;
  const items = filtered(list).map(t => row(t, ok ? `<button type="button" class="btn small${mineQ?.id === t.id ? ' on' : ''}" data-a="ask" data-id="${t.id}" ${d.now?.id === t.id || mineQ?.id === t.id ? 'disabled' : ''}>${mineQ?.id === t.id ? 'Asked' : 'Ask for it'}</button>` : '')).join('');
  return `${note}${mineQ ? `<p class="mp-note">Your request: <b>${esc(track(mineQ.id)?.title || '')}</b>, number ${d.queue.indexOf(mineQ) + 1} in line. Asking for another replaces it.</p>` : ''}
    ${chips(d, list)}<div class="mp-list">${items || '<p class="mp-dim">No songs match.</p>'}</div>`;
}
function tabMine() {
  if (!auth.account) return '<p class="mp-note">Sign in to add your own songs to the city.</p>';
  if (!can('upload')) return '<p class="mp-note">Your account may not add songs.</p>';
  const mine = [...(S.music?.tracks?.values() || [])].filter(t => t.mine).sort((a, b) => (b.added || 0) - (a.added || 0));
  const word = { approved: 'Playing in the city', pending: 'Waiting for review', rejected: 'Not accepted' };
  const admin = can('manage'), conv = !!S.music?.can?.convert, d = deck(), fam = d?.family;
  const genres = UPLOAD_GENRES.slice().sort((a, b) => (familyOf(b) === fam) - (familyOf(a) === fam));
  const busy = !!st.up?.busy;
  return `<form class="mp-up" autocomplete="off">
      <h4>Add your song</h4>
      <label class="mp-file"><input type="file" name="file" accept="${conv ? 'audio/*' : 'audio/mpeg,.mp3'}" required ${busy ? 'disabled' : ''}><span>${esc(st.up?.name || (conv ? 'Choose an audio file (MP3, M4A, OGG, WAV, FLAC)' : 'Choose an MP3 file'))}</span></label>
      <input name="title" placeholder="Title" maxlength="${MUSIC.titleMax}" required value="${esc(st.up?.title || '')}" ${busy ? 'disabled' : ''}>
      <input name="artist" placeholder="Artist" maxlength="${MUSIC.artistMax}" value="${esc(st.up?.artist ?? auth.account.displayName ?? '')}" ${busy ? 'disabled' : ''}>
      <select name="genre" aria-label="Genre" ${busy ? 'disabled' : ''}>${genres.map(g => `<option value="${g}"${(st.up?.genre || (fam === 'club' ? 'house' : 'jazz')) === g ? ' selected' : ''}>${esc(GENRES[g].name)}</option>`).join('')}</select>
      <label class="mp-chk"><input type="checkbox" name="explicit" ${st.up?.explicit ? 'checked' : ''} ${busy ? 'disabled' : ''}> Explicit lyrics</label>
      <label class="mp-chk"><input type="checkbox" name="rights" ${st.up?.rights ? 'checked' : ''} ${admin ? '' : 'required'} ${busy ? 'disabled' : ''}> It's my song, or I have the rights to share it in My Virtual World</label>
      <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>${busy ? 'Uploading…' : admin ? 'Add to the library' : 'Send for review'}</button>
      <p class="mp-dim">${admin ? 'As an administrator, your songs go straight into the library.' : 'An administrator listens first; once approved it plays at the stages of its genre, and anyone may ask for it.'} ${MUSIC.minSeconds} s to ${MUSIC.maxSeconds / 60} min, up to ${MUSIC.maxUploadMB} MB.</p>
    </form>
    <h4>Your songs</h4>${mine.map(t => row(t, `<small class="mp-st ${t.status}">${esc(word[t.status] || t.status)}${t.reason ? `: ${esc(t.reason)}` : ''}</small>${t.status !== 'approved' || admin ? `<button type="button" class="btn small icon" data-a="del" data-id="${t.id}" aria-label="Delete">🗑</button>` : ''}`)).join('') || '<p class="mp-dim">None yet.</p>'}`;
}
function tabRun(d) {
  const fam = Object.keys(GENRES).filter(g => familyOf(g) === d.family), own = d.settings.playlist;
  const list = own ? own.map((id, k) => row(track(id), `<span class="mp-ord"><button type="button" class="btn small icon" data-a="up" data-k="${k}" aria-label="Move up" ${k ? '' : 'disabled'}>↑</button><button type="button" class="btn small icon" data-a="down" data-k="${k}" aria-label="Move down" ${k < own.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn small icon" data-a="rm" data-k="${k}" aria-label="Remove">✕</button></span>`)).join('') : '';
  const addable = own && st.pick ? filtered([...(S.music?.tracks?.values() || [])].filter(t => t.status === 'approved' && familyOf(t.genre) !== 'score' && !own.includes(t.id))) : [];
  return `<div class="mp-set">
      <label class="mp-chk"><input type="checkbox" data-a="requests" ${d.settings.requests ? 'checked' : ''}> Players may ask for songs</label>
      <label class="mp-line">Genre tonight <select data-a="night">${['', ...fam].map(g => `<option value="${g}"${(d.settings.genre || '') === g ? ' selected' : ''}>${esc(g ? GENRES[g].name : 'All of them')}</option>`).join('')}</select></label>
      <div class="mp-modes" role="radiogroup" aria-label="What it plays">
        <button type="button" role="radio" aria-checked="${!own}" class="mp-chip${!own ? ' on' : ''}" data-a="auto">All ${d.family === 'club' ? 'club' : 'lounge'} music, shuffled</button>
        <button type="button" role="radio" aria-checked="${!!own}" class="mp-chip${own ? ' on' : ''}" data-a="own">Its own playlist, in order</button>
      </div>
      ${d.now ? '<button type="button" class="btn small" data-a="skip">⏭ Skip this song</button>' : ''}
      ${d.queue.length ? '<button type="button" class="btn small" data-a="clear">Clear the requests</button>' : ''}
    </div>
    ${own ? `<h4>The playlist (${own.length})</h4>${list || '<p class="mp-dim">Empty: add songs below.</p>'}
      <button type="button" class="btn small" data-a="pick">${st.pick ? 'Done adding' : '＋ Add songs'}</button>
      ${st.pick ? `${chips(d, [...(S.music?.tracks?.values() || [])].filter(t => t.status === 'approved' && familyOf(t.genre) !== 'score'))}<div class="mp-list">${addable.map(t => row(t, `<button type="button" class="btn small" data-a="add" data-id="${t.id}">＋ Add</button>`)).join('') || '<p class="mp-dim">No more songs.</p>'}</div>` : ''}` : ''}`;
}
function tabReview() {
  const all = [...(S.music?.tracks?.values() || [])];
  const wait = all.filter(t => t.status === 'pending').sort((a, b) => (a.added || 0) - (b.added || 0));
  const lib = filtered(all.filter(t => t.status === 'approved'));
  const rev = wait.map(t => `<div class="mp-rev">${row(t, `<small class="mp-who">${esc(t.by || '')}</small>`)}
      <audio controls preload="none" src="/api/music/file/${t.id}"></audio>
      ${st.reject === t.id ? `<form class="mp-rej" data-id="${t.id}"><input name="reason" maxlength="${MUSIC.reasonMax}" placeholder="Why (the player reads this)" required><button type="submit" class="btn small danger">Reject</button><button type="button" class="btn small" data-a="norej">Cancel</button></form>`
        : `<div class="row"><button type="button" class="btn small primary" data-a="approve" data-id="${t.id}">✓ Approve</button><button type="button" class="btn small" data-a="reject" data-id="${t.id}">Reject…</button></div>`}</div>`).join('');
  return `<h4>Waiting for review (${wait.length})</h4>${rev || '<p class="mp-dim">Nothing waits.</p>'}
    <h4>The library (${all.filter(t => t.status === 'approved').length})</h4>${chips(null, all.filter(t => t.status === 'approved'))}
    <div class="mp-list">${lib.map(t => row(t, `<small class="mp-who">${t.plays || 0} plays</small><button type="button" class="btn small icon" data-a="del" data-id="${t.id}" aria-label="Delete">🗑</button>`)).join('')}</div>`;
}
function paint() {
  if (!panel) return;
  const d = deck();
  const fam = d?.family || 'lounge', sd = Object.values(STAGES).find(x => x.family === fam);
  const admin = can('manage'), waiting = admin ? [...(S.music?.tracks?.values() || [])].filter(t => t.status === 'pending').length : 0;
  const tabs = [['next', 'Up next'], ['request', 'Request'], ['mine', 'Your songs'], ...(admin ? [['run', 'Run'], ['review', `Review${waiting ? ` (${waiting})` : ''}`]] : [])];
  if (!tabs.some(([k]) => k === st.tab)) st.tab = 'next';
  const body = !d ? '<p class="mp-dim">Loading…</p>' : st.tab === 'request' ? tabRequest(d) : st.tab === 'mine' ? tabMine() : st.tab === 'run' ? tabRun(d) : st.tab === 'review' ? tabReview() : tabNext(d);
  const html = `<div class="mp-h"><span class="mp-ic" aria-hidden="true">${ICON[fam]}</span><div><b>${esc(sd.name)}</b><small>${esc(d ? where(d) : '')}</small></div><button type="button" class="mp-x" data-a="close" aria-label="Close">✕</button></div>
    ${d ? nowCard(d) : ''}
    <div class="mp-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" aria-selected="${st.tab === k}" class="mp-tab${st.tab === k ? ' on' : ''}" data-a="tab" data-t="${k}">${esc(t)}</button>`).join('')}</div>
    <div class="mp-body">${body}</div>`;
  if (panel._h === html) return;
  // keep what's being typed and where the list is scrolled
  const focus = document.activeElement && panel.contains(document.activeElement) ? document.activeElement : null;
  const fsel = focus?.classList.contains('mp-q') ? { s: focus.selectionStart, e: focus.selectionEnd } : null;
  const scroll = panel.querySelector('.mp-body')?.scrollTop || 0;
  if (panel.querySelector('form.mp-up')) keepForm();
  panel._h = html; panel.innerHTML = html;
  panel.querySelector('.mp-body').scrollTop = scroll;
  if (fsel) { const q = panel.querySelector('.mp-q'); q?.focus(); q?.setSelectionRange(fsel.s, fsel.e); }
  if (st.up?.file) { /* (a chosen file can't be put back into an input: the form keeps it in st.up) */ }
  tickNow();
}
function keepForm() {
  const f = panel.querySelector('form.mp-up'); if (!f) return;
  const el = f.elements;
  st.up = { ...(st.up || {}), title: el.title.value, artist: el.artist.value, genre: el.genre.value, explicit: el.explicit.checked, rights: el.rights.checked };
}

// ----------------------------------------------------------------------------------------------- doing things
async function act(fn, okText) {
  if (st.busy) return;
  st.busy = true;
  try { const r = await fn(); if (okText) app.toast(typeof okText === 'function' ? okText(r) : okText, 'good', 2600); }
  catch (e) { if (!e.quiet) app.toast(String(e.message || e), 'bad', 3200); }
  finally { st.busy = false; paint(); }
}
function setPlaylist(list) { return act(() => post('/api/music/deck', { place: st.place, playlist: list })); }
function onClick(ev) {
  const b = ev.target.closest('[data-a]'); if (!b || b.disabled || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
  const a = b.dataset.a, d = deck(), place = st.place;
  if (a === 'close') return close();
  if (a === 'tab') { st.tab = b.dataset.t; st.pick = false; return paint(); }
  if (a === 'genre') { st.genre = b.dataset.g; return paint(); }
  if (!d) return;
  if (a === 'ask') return act(() => post('/api/music/request', { place, track: b.dataset.id }), r => `🎵 Asked for ${track(b.dataset.id)?.title || 'it'}: number ${r?.position || 1} in line${r?.replaced ? ' (it replaces your last request)' : ''}`);
  if (a === 'cancel') return act(() => post('/api/music/request/cancel', { place }), 'Request taken back');
  if (a === 'unq') return act(() => post('/api/music/request/cancel', { place, index: +b.dataset.k }));
  if (a === 'clear') return act(() => post('/api/music/clear', { place }), 'Requests cleared');
  if (a === 'skip') return act(() => post('/api/music/skip', { place }));
  if (a === 'auto') return d.settings.playlist ? setPlaylist(null) : null;
  if (a === 'own') return d.settings.playlist ? null : setPlaylist(stageSongs(d).filter(t => familyOf(t.genre) === d.family).map(t => t.id));
  if (a === 'pick') { st.pick = !st.pick; return paint(); }
  const own = d.settings.playlist ? d.settings.playlist.slice() : null, k = +b.dataset.k;
  if (own && (a === 'up' || a === 'down')) { const j = a === 'up' ? k - 1 : k + 1; [own[k], own[j]] = [own[j], own[k]]; return setPlaylist(own); }
  if (own && a === 'rm') { own.splice(k, 1); return setPlaylist(own); }
  if (own && a === 'add') { own.push(b.dataset.id); return setPlaylist(own); }
  if (a === 'approve') return act(() => post('/api/music/review', { id: b.dataset.id, approve: true }), 'Approved: it plays in the city now');
  if (a === 'reject') { st.reject = b.dataset.id; return paint(); }
  if (a === 'norej') { st.reject = null; return paint(); }
  if (a === 'del') {
    const t = track(b.dataset.id);
    if (!confirm(`Delete "${t?.title || 'this song'}" from the library? This can't be undone.`)) return;
    return act(() => post('/api/music/delete', { id: b.dataset.id }), 'Deleted');
  }
}
function onInput(ev) {
  if (ev.target.classList.contains('mp-q')) { st.q = ev.target.value; paint(); }
}
function onChange(ev) {
  const t = ev.target, a = t.dataset.a, place = st.place;
  if (a === 'requests') return act(() => post('/api/music/deck', { place, requests: t.checked }));
  if (a === 'night') return act(() => post('/api/music/deck', { place, genre: t.value || null }));
  if (t.name === 'file' && t.files?.[0]) {
    keepForm();
    const f = t.files[0];
    st.up = { ...(st.up || {}), file: f, name: f.name, title: st.up?.title || f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() };
    paint();
  }
}
async function onSubmit(ev) {
  ev.preventDefault();
  const f = ev.target;
  if (f.classList.contains('mp-rej')) { const id = f.dataset.id, reason = f.elements.reason.value; st.reject = null; return act(() => post('/api/music/review', { id, approve: false, reason }), 'Rejected: the player is told why'); }
  if (!f.classList.contains('mp-up')) return;
  keepForm();
  const file = st.up?.file;
  if (!file) { app.toast('Choose a song file first', 'bad', 2400); return; }
  if (file.size > MUSIC.maxUploadMB * 1024 * 1024) { app.toast(`A song is at most ${MUSIC.maxUploadMB} MB`, 'bad', 3000); return; }
  st.up.busy = true; paint();
  try {
    const q = new URLSearchParams({ title: st.up.title || '', artist: st.up.artist || '', genre: st.up.genre || 'jazz', explicit: st.up.explicit ? '1' : '0', rights: st.up.rights ? '1' : '0' });
    if (!S.music?.can?.convert) {   // (the server keeps MP3s as they are: their length and loudness as this browser hears them)
      const m = await measure(file).catch(() => null);
      if (m) { q.set('seconds', m.seconds.toFixed(2)); q.set('gain', m.gain.toFixed(1)); }
    }
    const r = await fetch(`/api/music/upload?${q}`, { method: 'POST', headers: { 'content-type': file.type || 'audio/mpeg', ...(auth.csrf ? { 'x-csrf-token': auth.csrf } : {}) }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `The upload failed (${r.status})`);
    app.toast(j.track?.status === 'approved' ? `🎵 ${j.track.title} is in the library` : `🎵 Thanks! ${j.track?.title || 'Your song'} waits for an administrator's review`, 'good', 3600);
    st.up = null;
    app.music.loadLibrary();
  } catch (e) {
    app.toast(String(e.message || e), 'bad', 3600);
    if (st.up) st.up.busy = false;
  }
  paint();
}
/** A file's length and how much to turn it up or down to the library's loudness (a plain loudness measure). */
async function measure(file) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!AC) return null;
  const buf = await new AC(2, 48000, 48000).decodeAudioData(await file.arrayBuffer());
  let sum = 0, n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < x.length; i += 4) { sum += x[i] * x[i]; n++; } }
  const lufs = -0.691 + 10 * Math.log10(Math.max(1e-10, sum / Math.max(1, n)) * 2);
  return { seconds: buf.duration, gain: Math.max(-20, Math.min(10, MUSIC.lufs - lufs)) };
}

// ----------------------------------------------------------------------------------------------- opening it
/** Looking inside: a click on a stage opens its panel (unless someone stands in front of it: a click on them is theirs). */
function onWorldClick(ev) {
  if (S.mode !== 'explore' || S.focus.b < 0 || app.arcade?.playing) return false;
  const hit = app.inter.pickItem(app.cam.rayAt(ev.clientX, ev.clientY), false);
  if (!hit || hit.e.b !== S.focus.b || hit.e.f !== S.focus.f || !STAGES[hit.e.t]) return false;
  const i = app.agents.pick(ev.clientX, ev.clientY);
  if (i >= 0 && app.agents.camDist(i) < hit.d + 0.4) return false;
  open(placeKey(hit.e.b, hit.e.f, hit.e.id));
  return true;
}
/** Walking: E next to a stage. */
function playerTarget(P) {
  if (P.ctx < 0 || !app.inter?.foc) return null;
  let best = null;
  for (const e of app.inter.foc.entries) {
    if (!STAGES[e.t] || e.b !== (P.ctx >> 6) || e.f !== (P.ctx & 63)) continue;
    const d = Math.hypot(e.x - P.x, e.z - P.z) - 1.6;
    if (d < 1.2 && (!best || d < best.d)) best = { d: Math.max(0.3, d), html: `🎵 Music <span class="dim">· ${esc(STAGES[e.t].name)}</span>`, act: () => open(placeKey(e.b, e.f, e.id)) };
  }
  return best;
}

export function init(a) {
  app = a;
  layer = document.body.appendChild(h('<div id="musicpins" aria-label="Stages"></div>'));
  app.musicPanel = { open, close, get place() { return st.place; } };
  app.hooks = app.hooks || { key: [], click: [], hover: [] };
  app.hooks.click.push(onWorldClick);
  (app.playerTargets = app.playerTargets || []).push(playerTarget);
  bus.on('frame', frame);
  bus.on('music', ev => { if (panel && (!ev || ev.all || ev.library || ev.place === st.place)) paint(); });
  bus.on('auth', () => paint());
  bus.on('focus', () => { if (st.place && !st.place.startsWith(`${S.focus.b}:${S.focus.f}:`)) close(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && panel && !ev.target.closest?.('input, select, textarea')) { ev.stopPropagation(); close(); } }, true);
}
