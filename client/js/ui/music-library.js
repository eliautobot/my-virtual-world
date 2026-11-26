// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Music Library as a music player (2026-11-25, the product owner: "organize them by artist, album ... multiple ways to
// organize it ... almost like Spotify, YouTube Music ... the music library is like a music player and the stations are
// the playlists"). Shown in the Radio Stations window (ui/radio-stations.js), and as a picker wherever songs are chosen:
//   Songs     every song: title, artist, album, genre, length, plays, the stations it is on — sorted by any of them
//   Albums    their covers; an album: its songs in order, its artist, year, length — add it to a station
//   Artists   each artist: their albums, their singles (songs on no album), their most played
//   Genres    each genre and how many songs
//   Review    (administrators) players' songs waiting, by album: approve or reject an album at once
// One search finds albums, artists and songs. Pick songs (or a whole album or artist) and add them to a station;
// administrators edit several songs' details at once, rename an album, change its cover, delete songs. Uploading one song
// or a whole album / folder: ui/album-upload.js. The server decides; this only asks and shows.
import { S } from '../core/state.js';
import { auth } from '../core/auth.js';
import { esc } from '../core/util.js';
import { GENRES, UPLOAD_GENRES, fmtTime, albumKey } from '/shared/music.js';
import { coverJpeg } from '../core/id3.js';
import { albumUploadBox } from './album-upload.js';

const TABS = [['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['genres', 'Genres']];
const long = secs => { const m = Math.round(secs / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = s => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
let audio = null, playing = null;

/** The library's songs and how they group: { tracks, albums (key → its record and songs), artists (name → { albums, songs }) }. */
function catalog() {
  const tracks = [...(S.music?.tracks?.values() || [])];
  const albums = new Map(), artists = new Map();
  const artistOf = n => { const k = n.trim().toLowerCase(); let a = artists.get(k); if (!a) artists.set(k, a = { name: n.trim(), songs: [], albums: new Set() }); return a; };
  for (const t of tracks) {
    if (t.albumKey) {
      let A = albums.get(t.albumKey);
      if (!A) { const rec = S.music.albums?.get(t.albumKey); albums.set(t.albumKey, A = { key: t.albumKey, name: rec?.name || t.album, artist: rec?.artist || t.albumArtist, year: rec?.year || t.year || null, cover: rec?.cover || null, coverPending: !!rec?.coverPending, songs: [] }); }
      A.songs.push(t);
      artistOf(A.artist).albums.add(t.albumKey);
    }
    artistOf(t.artist || 'Unknown artist').songs.push(t);
  }
  for (const A of albums.values()) A.songs.sort((a, b) => (a.track || 999) - (b.track || 999) || a.title.localeCompare(b.title));
  return { tracks, albums, artists };
}
const coverHtml = (A, size = '') => A?.cover ? `<img class="ml-cover${size}" src="${esc(A.cover)}" alt="" loading="lazy">`
  : `<span class="ml-cover${size} ml-noc" style="--h:${hue(A?.key || A?.name || '')}" aria-hidden="true">${esc(initials(A?.name))}</span>`;

/**
 * The library in `body`. L: { state (kept between paints), admin, stations ([{ id, name, freq, band, color, songs, right }]
 * — those its viewer may add to), add(stationId, ids) → Promise<boolean>, call(url, body, okText) → Promise, say(text, bad),
 * reload() → Promise (the library and the stations again), repaint() }.
 */
export function libraryView(body, L) {
  const st = L.state;
  st.tab ||= 'songs'; st.q ??= ''; st.genre ??= ''; st.sort ||= { k: 'title', dir: 1 }; st.picked ||= new Set();
  const C = catalog(), waiting = C.tracks.filter(t => t.status === 'pending').length;
  const tabs = [...TABS, ...(L.admin ? [['review', `Review${waiting ? ` (${waiting})` : ''}`]] : [])];
  body.innerHTML = `<div class="rs-sthead ml-head"><h3>🎵 Music Library</h3><p class="hint">Every song of the city, by album, artist and genre. Each station is a playlist of these: pick songs, an album or an artist and add them to one.</p></div>
    <div class="ml-bar"><input type="search" class="input ml-q" placeholder="Search songs, albums and artists" value="${esc(st.q)}" aria-label="Search the library">
      <button type="button" class="btn" data-c="up1">⬆ Upload a song</button><button type="button" class="btn primary" data-c="upal">⬆ Upload an album or folder</button></div>
    <nav class="rs-tabs ml-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="rs-tab${st.tab === k && !st.view ? ' on' : ''}" data-mtab="${k}">${t}</button>`).join('')}</nav>
    <div class="ml-ups"></div><div class="ml-pickbar"></div><div class="ml-content"></div>`;
  const q = s => body.querySelector(s), content = q('.ml-content');
  const used = id => L.stations.filter(x => (x.songs || []).includes(id));
  const usedAll = id => (L.allStations || L.stations).filter(x => (x.songs || []).includes(id));

  // ---- the pieces
  const songRow = (t, { num = null, showAlbum = true } = {}) => {
    const u = usedAll(t.id);
    return `<li class="ml-row${t.status === 'pending' ? ' pending' : ''}" data-id="${esc(t.id)}">
      ${t.status == null || t.status === 'approved' ? `<input type="checkbox" class="ml-pick" value="${esc(t.id)}"${st.picked.has(t.id) ? ' checked' : ''} aria-label="Pick ${esc(t.title)}">` : '<span></span>'}
      <button type="button" class="btn small icon ml-play" data-play="${esc(t.id)}" aria-label="Listen">${playing === t.id ? '⏸' : num != null ? num : '▶'}</button>
      <span class="ml-ti"><b>${esc(t.title)}</b><small><a href="#" data-artist="${esc(t.artist || '')}">${esc(t.artist || 'Unknown artist')}</a>${t.explicit ? ' · <span class="mp-e">E</span>' : ''}</small></span>
      ${showAlbum ? `<span class="ml-al">${t.albumKey ? `<a href="#" data-album="${esc(t.albumKey)}">${esc(t.album)}</a>` : '<span class="dim">Single</span>'}</span>` : ''}
      <span class="ml-g">${esc(GENRES[t.genre]?.name || t.genre)}</span><span class="ml-len">${fmtTime(t.seconds)}</span><span class="ml-pl">${t.plays || 0}</span>
      <span class="ml-used">${u.map(x => `<span class="rs-tag" style="--rc:${esc(x.color || '#4aa3ff')}">${esc(x.name)}</span>`).join('')}</span>
      <span class="ml-acts">${t.status === 'pending' ? (L.admin ? `<button type="button" class="btn small primary" data-ok="${esc(t.id)}">✓</button><button type="button" class="btn small" data-no="${esc(t.id)}">✕</button>` : '<small class="warn">waiting for review</small>') : t.status === 'rejected' ? '<small class="bad">not accepted</small>' : ''}${L.admin ? `<button type="button" class="btn small icon" data-del="${esc(t.id)}" title="Delete from the library" aria-label="Delete">🗑</button>` : ''}</span></li>`;
  };
  const songList = (list, o = {}) => list.length ? `<ul class="ml-list">${list.map((t, k) => songRow(t, { ...o, num: o.numbers ? (t.track || k + 1) : null })).join('')}</ul>` : '<p class="hint dim">No songs.</p>';
  const albumCard = A => `<button type="button" class="ml-card" data-album="${esc(A.key)}">${coverHtml(A)}<b>${esc(A.name)}</b><small>${esc(A.artist)}${A.year ? ` · ${A.year}` : ''} · ${A.songs.length} song${A.songs.length === 1 ? '' : 's'}</small></button>`;
  const addBar = (ids, label) => L.stations.length ? `<div class="row ml-addto"><select class="input ml-to" aria-label="A station">${L.stations.map(x => `<option value="${esc(x.id)}">${esc(`${x.freq} ${x.band} · ${x.name}`)}</option>`).join('')}</select>
    <button type="button" class="btn primary small" data-addall="${esc(ids.join(','))}">＋ Add ${esc(label)} to the station</button></div>` : '';
  const sorted = list => {
    const { k, dir } = st.sort, val = t => (k === 'title' ? t.title : k === 'artist' ? t.artist : k === 'album' ? `${t.album || '￿'} ${String(t.track || 0).padStart(3, '0')}` : k === 'genre' ? GENRES[t.genre]?.name || t.genre : k === 'len' ? t.seconds : k === 'plays' ? t.plays || 0 : t.title);
    return list.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir || a.title.localeCompare(b.title); });
  };
  const head = () => `<div class="ml-row ml-th"><span></span><span></span>${[['title', 'Title'], ['album', 'Album'], ['genre', 'Genre'], ['len', 'Length'], ['plays', 'Plays']].map(([k, t]) => `<button type="button" class="ml-sort${st.sort.k === k ? ' on' : ''}" data-sort="${k}">${t}${st.sort.k === k ? (st.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button>`).join('')}<span>On</span><span></span></div>`;

  // ---- each view
  const paintContent = () => {
    const w = st.q.trim().toLowerCase();
    if (st.view?.kind === 'album') return albumPage(C.albums.get(st.view.key));
    if (st.view?.kind === 'artist') return artistPage(C.artists.get(st.view.name.toLowerCase()));
    if (w) {
      const has = s => String(s || '').toLowerCase().includes(w);
      const al = [...C.albums.values()].filter(A => has(A.name) || has(A.artist)).slice(0, 12);
      const ar = [...C.artists.values()].filter(a => has(a.name)).slice(0, 12);
      const so = C.tracks.filter(t => has(t.title) || has(t.artist) || has(t.album) || has(GENRES[t.genre]?.name) || usedAll(t.id).some(x => has(x.name)));
      content.innerHTML = `${al.length ? `<h4 class="ml-h">Albums</h4><div class="ml-grid">${al.map(albumCard).join('')}</div>` : ''}
        ${ar.length ? `<h4 class="ml-h">Artists</h4><div class="ml-artists">${ar.map(artistChip).join('')}</div>` : ''}
        <h4 class="ml-h">Songs <span class="st-pill">${so.length}</span></h4>${head()}${songList(sorted(so))}`;
      return;
    }
    if (st.tab === 'albums') {
      const list = [...C.albums.values()].sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
      content.innerHTML = list.length ? `<div class="ml-grid">${list.map(albumCard).join('')}</div>` : '<p class="hint dim">No albums yet: upload an album or a folder, or give songs an album (pick them, ✎ Edit details).</p>';
      return;
    }
    if (st.tab === 'artists') { content.innerHTML = `<div class="ml-artists">${[...C.artists.values()].sort((a, b) => a.name.localeCompare(b.name)).map(artistChip).join('')}</div>`; return; }
    if (st.tab === 'genres') {
      const by = new Map(); for (const t of C.tracks) by.set(t.genre, (by.get(t.genre) || 0) + 1);
      content.innerHTML = `<div class="ml-genres">${[...by].sort((a, b) => b[1] - a[1]).map(([g, n]) => `<button type="button" class="ml-genre" data-genre="${esc(g)}" style="--h:${hue(g)}"><b>${esc(GENRES[g]?.name || g)}</b><small>${n} song${n === 1 ? '' : 's'}</small></button>`).join('')}</div>`;
      return;
    }
    if (st.tab === 'review') return reviewPage();
    const list = C.tracks.filter(t => !st.genre || t.genre === st.genre);
    content.innerHTML = `${st.genre ? `<p class="hint">Genre: <b>${esc(GENRES[st.genre]?.name || st.genre)}</b> · <a href="#" data-c="nogenre">all genres</a></p>` : ''}${head()}${songList(sorted(list))}`;
  };
  const artistChip = a => `<button type="button" class="ml-artist" data-artist="${esc(a.name)}"><span class="ml-av" style="--h:${hue(a.name)}">${esc(initials(a.name))}</span><span><b>${esc(a.name)}</b><small>${a.albums.size} album${a.albums.size === 1 ? '' : 's'} · ${a.songs.length} song${a.songs.length === 1 ? '' : 's'}</small></span></button>`;
  const albumPage = A => {
    if (!A) { st.view = null; return paintContent(); }
    const secs = A.songs.reduce((n, t) => n + t.seconds, 0), ids = A.songs.filter(t => t.status == null || t.status === 'approved').map(t => t.id);
    content.innerHTML = `<a href="#" class="ml-back" data-c="back">‹ Back</a>
      <div class="ml-hero">${coverHtml(A, ' big')}<div><span class="rs-kicker">Album</span><h2>${esc(A.name)}</h2>
        <p><a href="#" data-artist="${esc(A.artist)}"><b>${esc(A.artist)}</b></a>${A.year ? ` · ${A.year}` : ''} · ${A.songs.length} song${A.songs.length === 1 ? '' : 's'}, ${long(secs)}${A.coverPending ? ' · <span class="warn">its cover waits for review</span>' : ''}</p>
        ${addBar(ids, 'the album')}
        ${L.admin ? `<div class="row wrap ml-adm"><button type="button" class="btn small" data-c="aledit">✎ Edit the album</button><label class="btn small">🖼 Change its cover<input type="file" accept="image/*" class="ml-coverfile" hidden></label></div>` : ''}</div></div>
      ${st.alEdit ? `<form class="rs-box ml-aledit"><div class="rs-two"><input class="input" name="name" value="${esc(A.name)}" placeholder="Album" required><input class="input" name="artist" value="${esc(A.artist)}" placeholder="Album artist"><input class="input" name="year" value="${esc(A.year || '')}" placeholder="Year" inputmode="numeric"></div><div class="row"><button type="submit" class="btn primary small">Save</button><button type="button" class="btn small" data-c="alx">Cancel</button></div></form>` : ''}
      ${songList(A.songs, { numbers: true, showAlbum: false })}`;
    content.querySelector('.ml-aledit')?.addEventListener('submit', async ev => {
      ev.preventDefault(); const e = ev.target.elements;
      if (await L.call('/api/music/album', { key: A.key, name: e.name.value, artist: e.artist.value, year: e.year.value ? Number(e.year.value) : null }, 'The album is saved')) { st.alEdit = false; st.view = { kind: 'album', key: albumKey(e.artist.value || A.artist, e.name.value) }; await L.reload(); }
    });
    content.querySelector('[data-c="alx"]')?.addEventListener('click', () => { st.alEdit = false; paintContent(); wire(); });
    content.querySelector('[data-c="aledit"]')?.addEventListener('click', () => { st.alEdit = true; paintContent(); wire(); });
    content.querySelector('.ml-coverfile')?.addEventListener('change', async ev => {
      const f = ev.target.files?.[0]; if (!f) return;
      const jpg = await coverJpeg(f); if (!jpg) { L.say('That is not an image', true); return; }
      const r = await fetch(`/api/music/cover?key=${encodeURIComponent(A.key)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg', ...(auth.csrf ? { 'x-csrf-token': auth.csrf } : {}) }, body: jpg }).then(x => x.json().then(j => ({ ok: x.ok, j })));
      if (!r.ok) { L.say(r.j.error || 'The cover was not saved', true); return; }
      await L.reload();
    });
  };
  const artistPage = a => {
    if (!a) { st.view = null; return paintContent(); }
    const albums = [...a.albums].map(k => C.albums.get(k)).filter(Boolean).sort((x, y) => (y.year || 0) - (x.year || 0) || x.name.localeCompare(y.name));
    const singles = a.songs.filter(t => !t.albumKey), top = a.songs.slice().sort((x, y) => (y.plays || 0) - (x.plays || 0)).slice(0, 5);
    const ids = [...new Set([...a.songs, ...albums.flatMap(A => A.songs)].filter(t => t.status == null || t.status === 'approved').map(t => t.id))];
    content.innerHTML = `<a href="#" class="ml-back" data-c="back">‹ Back</a>
      <div class="ml-hero"><span class="ml-av big" style="--h:${hue(a.name)}">${esc(initials(a.name))}</span><div><span class="rs-kicker">Artist</span><h2>${esc(a.name)}</h2>
        <p>${albums.length} album${albums.length === 1 ? '' : 's'} · ${a.songs.length} song${a.songs.length === 1 ? '' : 's'}</p>${addBar(ids, 'all their songs')}</div></div>
      ${top.length ? `<h4 class="ml-h">Most played</h4>${songList(top)}` : ''}
      ${albums.length ? `<h4 class="ml-h">Albums</h4><div class="ml-grid">${albums.map(albumCard).join('')}</div>` : ''}
      ${singles.length ? `<h4 class="ml-h">Singles</h4>${songList(singles, { showAlbum: false })}` : ''}`;
  };
  const reviewPage = () => {
    const wait = C.tracks.filter(t => t.status === 'pending'), groups = new Map();
    for (const t of wait) { const k = t.albumKey || `single:${t.by || ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    content.innerHTML = wait.length ? [...groups].map(([k, list]) => { const A = C.albums.get(k); return `<div class="rs-box ml-rev">
        <div class="ml-revh">${A ? coverHtml(A, ' mid') : ''}<div><b>${esc(A ? `${A.name} — ${A.artist}` : 'Single songs')}</b><small>from ${esc(list[0].by || 'a player')} · ${list.length} song${list.length === 1 ? '' : 's'}${A?.coverPending ? ' · with its cover' : ''}</small></div>
        <span class="row"><button type="button" class="btn small primary" data-okall="${esc(list.map(t => t.id).join(','))}">✓ Approve all</button><button type="button" class="btn small" data-noall="${esc(list.map(t => t.id).join(','))}">Reject all…</button></span></div>
        ${songList(list, { showAlbum: false })}</div>`; }).join('') : '<p class="hint dim">Nothing waits for review.</p>';
  };

  // ---- wiring
  const pickbar = () => {
    const bar = q('.ml-pickbar');
    bar.className = `ml-pickbar rs-pickbar${st.picked.size ? '' : ' hidden'}`;
    bar.innerHTML = st.picked.size ? `<b>${st.picked.size} picked</b>${L.stations.length ? ` · Add to <select class="input ml-pto">${L.stations.map(x => `<option value="${esc(x.id)}">${esc(`${x.freq} ${x.band} · ${x.name}`)}</option>`).join('')}</select><button type="button" class="btn small primary" data-c="padd">Add</button>` : ''}
      ${L.admin ? '<button type="button" class="btn small" data-c="pedit">✎ Edit details</button>' : ''}<button type="button" class="btn small" data-c="pclear">Clear</button>
      ${st.edit ? `<form class="ml-bulk"><input class="input" name="album" placeholder="Album (unchanged)"><input class="input" name="albumArtist" placeholder="Album artist"><input class="input" name="artist" placeholder="Artist (unchanged)">
        <select class="input" name="genre"><option value="">Genre (unchanged)</option>${UPLOAD_GENRES.map(g => `<option value="${g}">${esc(GENRES[g].name)}</option>`).join('')}</select><input class="input" name="year" placeholder="Year" inputmode="numeric" style="width:80px">
        <button type="submit" class="btn small primary">Save for ${st.picked.size}</button><label class="check"><input type="checkbox" name="noalbum"> take them off their album</label></form>` : ''}` : '';
    bar.querySelector('[data-c="pclear"]')?.addEventListener('click', () => { st.picked.clear(); st.edit = false; L.repaint(); });
    bar.querySelector('[data-c="pedit"]')?.addEventListener('click', () => { st.edit = !st.edit; pickbar(); });
    bar.querySelector('[data-c="padd"]')?.addEventListener('click', async () => { if (await L.add(bar.querySelector('.ml-pto').value, [...st.picked])) { st.picked.clear(); L.repaint(); } });
    bar.querySelector('.ml-bulk')?.addEventListener('submit', async ev => {
      ev.preventDefault(); const e = ev.target.elements, patch = {};
      if (e.noalbum.checked) patch.album = '';
      else { if (e.album.value.trim()) patch.album = e.album.value.trim(); if (e.albumArtist.value.trim()) patch.albumArtist = e.albumArtist.value.trim(); }
      if (e.artist.value.trim()) patch.artist = e.artist.value.trim(); if (e.genre.value) patch.genre = e.genre.value; if (e.year.value.trim()) patch.year = Number(e.year.value);
      if (!Object.keys(patch).length) { L.say('Nothing to change', true); return; }
      if (await L.call('/api/music/tracks', { ids: [...st.picked], patch }, `${st.picked.size} songs saved`)) { st.edit = false; st.picked.clear(); await L.reload(); }
    });
  };
  const wire = () => {
    content.querySelectorAll('.ml-pick').forEach(c => { c.onchange = () => { if (c.checked) st.picked.add(c.value); else st.picked.delete(c.value); pickbar(); }; });
    content.querySelectorAll('[data-play]').forEach(b => { b.onclick = () => preview(b.dataset.play, content); });
    content.querySelectorAll('[data-album]').forEach(a => { a.onclick = ev => { ev.preventDefault(); st.view = { kind: 'album', key: a.dataset.album }; st.alEdit = false; L.repaint(); }; });
    content.querySelectorAll('[data-artist]').forEach(a => { a.onclick = ev => { ev.preventDefault(); st.view = { kind: 'artist', name: a.dataset.artist }; L.repaint(); }; });
    content.querySelectorAll('[data-genre]').forEach(b => { b.onclick = () => { st.tab = 'songs'; st.genre = b.dataset.genre; st.view = null; L.repaint(); }; });
    content.querySelector('[data-c="nogenre"]')?.addEventListener('click', ev => { ev.preventDefault(); st.genre = ''; L.repaint(); });
    content.querySelector('[data-c="back"]')?.addEventListener('click', ev => { ev.preventDefault(); st.view = null; st.alEdit = false; L.repaint(); });
    content.querySelectorAll('[data-sort]').forEach(b => { b.onclick = () => { st.sort = { k: b.dataset.sort, dir: st.sort.k === b.dataset.sort ? -st.sort.dir : 1 }; paintContent(); wire(); }; });
    content.querySelectorAll('[data-addall]').forEach(b => { b.onclick = async () => { const ids = b.dataset.addall.split(',').filter(Boolean), sel = b.parentElement.querySelector('.ml-to'); await L.add(sel.value, ids); }; });
    const ok = async (ids, approve, reason) => { for (const id of ids) await L.call('/api/music/review', { id, approve, ...(reason ? { reason } : {}) }); await L.reload(); };
    content.querySelectorAll('[data-ok]').forEach(b => { b.onclick = () => ok([b.dataset.ok], true); });
    content.querySelectorAll('[data-no]').forEach(b => { b.onclick = () => { const r = prompt('Why (the player reads this)'); if (r) ok([b.dataset.no], false, r); }; });
    content.querySelectorAll('[data-okall]').forEach(b => { b.onclick = () => ok(b.dataset.okall.split(','), true); });
    content.querySelectorAll('[data-noall]').forEach(b => { b.onclick = () => { const r = prompt('Why (the player reads this)'); if (r) ok(b.dataset.noall.split(','), false, r); }; });
    content.querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => {
      const t = S.music.tracks.get(b.dataset.del), on = usedAll(b.dataset.del);
      if (!confirm(`Delete «${t?.title || 'this song'}» from the library?${on.length ? `\n\nIt comes off ${on.map(x => x.name).join(', ')}.` : ''}`)) return;
      if (await L.call('/api/music/delete', { id: b.dataset.del }, 'Deleted from the library')) { st.picked.delete(b.dataset.del); await L.reload(); }
    }; });
  };
  const search = q('.ml-q');
  search.oninput = () => { st.q = search.value; st.view = null; paintContent(); wire(); };
  body.querySelectorAll('[data-mtab]').forEach(b => { b.onclick = () => { st.tab = b.dataset.mtab; st.view = null; st.q = ''; st.genre = b.dataset.mtab === 'songs' ? st.genre : ''; L.repaint(); }; });
  // uploading: one song (the old form) or an album / a folder (ui/album-upload.js)
  const ups = q('.ml-ups');
  q('[data-c="up1"]').onclick = () => { st.alb = null; st.one = st.one ? null : {}; L.repaint(); };
  q('[data-c="upal"]').onclick = () => { st.one = null; st.alb = st.alb ? null : {}; L.repaint(); };
  if (st.alb) albumUploadBox(ups, st.alb, { admin: L.admin, stations: L.stations, add: L.add, say: L.say, done: async () => { await L.reload(); }, close: () => { st.alb = null; L.repaint(); }, repaint: () => L.repaint() });
  else if (st.one && L.single) L.single(ups, st.one);
  paintContent(); wire(); pickbar();
}

function preview(id, root) {
  if (!audio) { audio = new Audio(); audio.onended = () => { playing = null; document.querySelectorAll('[data-play]').forEach(b => { if (b.textContent === '⏸') b.textContent = '▶'; }); }; }
  if (playing === id) { audio.pause(); playing = null; }
  else { audio.src = `/api/music/file/${encodeURIComponent(id)}`; audio.play().catch(() => {}); playing = id; }
  root.querySelectorAll('[data-play]').forEach(b => { if (b.dataset.play === playing) b.textContent = '⏸'; else if (b.textContent === '⏸') b.textContent = '▶'; });
}
export function stopPreview() { audio?.pause(); playing = null; }
