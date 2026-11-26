// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Uploading an album or a folder (2026-11-25, the product owner: "upload songs like in a folder and organize them as an
// album"; "the cover art can be taken from ... the folder that gets uploaded"): choose several songs or a whole folder
// (or drop them here); each song's own tags are read (core/id3.js: title, artist, album, its number, year, genre, its
// picture) and the folder's cover image found (cover / folder / front / album / artwork, else its one image, else a
// song's own picture). Everything is shown first — the album's name, its artist, year, genre and cover, each song's
// title and number, which to leave out — then sent one song at a time with a count; then the cover. An administrator's
// go straight into the library (and may go onto a station at once); a player's wait for review, cover and all.
import { esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { GENRES, UPLOAD_GENRES, MUSIC, albumKey } from '/shared/music.js';
import { readTags, coverJpeg } from '../core/id3.js';
import { sendSong } from './music-panel.js';

const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i, IMAGE = /\.(jpe?g|png|webp)$/i, COVER = /^(cover|folder|front|album|artwork|art)\b/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mostOf = list => { const n = new Map(); for (const v of list) if (v) n.set(v, (n.get(v) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
/** A tag's genre as one of the city's (its words: "Hip-Hop", "R&B", "Electronic"…), else ''. */
export function genreOf(words) {
  const w = String(words || '').toLowerCase();
  if (!w) return '';
  for (const [id, G] of Object.entries(GENRES)) if (!G.internal && (w === id || w === G.name.toLowerCase())) return id;
  const pairs = [[/hip.?hop|rap|trap/, 'hiphop'], [/r&b|rnb|soul|funk/, 'soul'], [/bossa/, 'bossa'], [/jazz|swing|blues/, 'jazz'], [/piano|classical|ambient/, 'piano'], [/lounge|chill|downtempo/, 'lounge'],
    [/house/, 'house'], [/techno/, 'techno'], [/trance/, 'trance'], [/dubstep|bass/, 'dubstep'], [/reggaeton|latin|dembow/, 'reggaeton'], [/edm|dance|electro/, 'dance'], [/rock|metal|punk|indie|alternative/, 'rock'], [/pop/, 'pop']];
  for (const [re, g] of pairs) if (re.test(w)) return g;
  return 'other';
}

/** The box in `el`, its state U (kept between paints); ctx { admin, stations, add(stationId, ids), say, done(), close(), repaint() }. */
export function albumUploadBox(el, U, ctx) {
  if (!U.rows) return pickFiles(el, U, ctx);
  const n = U.rows.filter(r => r.on).length;
  el.innerHTML = `<form class="rs-box au" autocomplete="off"><div class="rs-boxh"><b>Upload an album</b><span class="hint">${ctx.admin ? 'It goes straight into the library.' : 'An administrator listens first; its cover is looked at with it.'} Check its details: they come from the songs' own tags.</span></div>
    <div class="au-top"><div class="au-cov">${U.coverUrl ? `<img src="${esc(U.coverUrl)}" alt="Its cover">` : '<span class="ml-cover ml-noc big" aria-hidden="true">♪</span>'}
        <label class="btn small">🖼 ${U.coverUrl ? 'Another cover' : 'Add a cover'}<input type="file" accept="image/*" class="au-cf" hidden></label>${U.coverFrom ? `<small class="hint">${esc(U.coverFrom)}</small>` : ''}</div>
      <div class="au-meta">
        <label class="snd-l">Album<input class="input" name="album" maxlength="${MUSIC.albumMax || 80}" required value="${esc(U.album || '')}"></label>
        <div class="rs-two"><label class="snd-l">Album artist<input class="input" name="albumArtist" maxlength="${MUSIC.artistMax}" value="${esc(U.albumArtist || '')}"></label>
          <label class="snd-l">Year<input class="input" name="year" inputmode="numeric" value="${esc(U.year || '')}" style="max-width:100px"></label></div>
        <div class="rs-two"><label class="snd-l">Genre<select class="input" name="genre">${UPLOAD_GENRES.map(g => `<option value="${g}"${U.genre === g ? ' selected' : ''}>${esc(GENRES[g].name)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="explicit"${U.explicit ? ' checked' : ''}> Explicit lyrics</label></div>
        ${ctx.admin ? '' : `<label class="check"><input type="checkbox" name="rights"${U.rights ? ' checked' : ''} required> These are my songs, or I have the rights to share them in My Virtual World</label>`}</div></div>
    <ol class="au-rows">${U.rows.map((r, k) => `<li class="au-row${r.on ? '' : ' off'}${r.state ? ` ${r.state}` : ''}" data-k="${k}"><input type="checkbox" class="au-on"${r.on ? ' checked' : ''} aria-label="Upload this one"${U.busy ? ' disabled' : ''}>
      <input class="input au-n" value="${esc(r.track || '')}" inputmode="numeric" aria-label="Its number"><input class="input au-t" value="${esc(r.title)}" maxlength="${MUSIC.titleMax}" aria-label="Title"><input class="input au-a" value="${esc(r.artist || '')}" placeholder="${esc(U.albumArtist || 'Artist')}" maxlength="${MUSIC.artistMax}" aria-label="Artist">
      <small class="au-f">${esc(r.file.name)}${r.note ? ` · <span class="${r.state === 'bad' ? 'bad' : 'good'}">${esc(r.note)}</span>` : ''}</small></li>`).join('')}</ol>
    ${U.skipped ? `<p class="hint">${U.skipped} file${U.skipped === 1 ? '' : 's'} left out (not a song or an image).</p>` : ''}
    <div class="row rs-boxf"><button type="submit" class="btn primary"${U.busy || !n ? ' disabled' : ''}>${U.busy ? `Uploading ${U.at || 0} of ${n}…` : U.doneN != null ? 'Upload the rest' : `Upload ${n} song${n === 1 ? '' : 's'}`}</button>
      <button type="button" class="btn" data-c="aux"${U.busy ? ' disabled' : ''}>${U.doneN != null ? 'Done' : 'Cancel'}</button>
      ${U.doneIds?.length && ctx.admin && ctx.stations.length ? `<span class="row au-st">Add it to <select class="input au-to">${ctx.stations.map(x => `<option value="${esc(x.id)}">${esc(`${x.freq} ${x.band} · ${x.name}`)}</option>`).join('')}</select><button type="button" class="btn small primary" data-c="aust">＋ Add</button></span>` : ''}</div>
    ${U.msg ? `<p class="hint ${U.bad ? 'bad' : 'good'}">${esc(U.msg)}</p>` : ''}</form>`;
  const f = el.querySelector('form');
  const keep = () => {
    const e = f.elements;
    Object.assign(U, { album: e.album.value.trim(), albumArtist: e.albumArtist.value.trim(), year: e.year.value.trim(), genre: e.genre.value, explicit: e.explicit.checked, rights: e.rights?.checked });
    f.querySelectorAll('.au-row').forEach(li => { const r = U.rows[Number(li.dataset.k)]; r.on = li.querySelector('.au-on').checked; r.track = Number(li.querySelector('.au-n').value) || null; r.title = li.querySelector('.au-t').value.trim(); r.artist = li.querySelector('.au-a').value.trim(); });
  };
  f.addEventListener('change', () => { if (!U.busy) { keep(); } });
  f.querySelectorAll('.au-on').forEach(c => { c.onchange = () => { keep(); ctx.repaint(); }; });
  f.querySelector('.au-cf').onchange = async ev => { const file = ev.target.files?.[0]; if (!file) return; keep(); await setCover(U, file, 'your choice'); ctx.repaint(); };
  f.querySelector('[data-c="aux"]').onclick = () => { if (U.coverUrl) URL.revokeObjectURL(U.coverUrl); ctx.close(); };
  f.querySelector('[data-c="aust"]')?.addEventListener('click', async () => { if (await ctx.add(f.querySelector('.au-to').value, U.doneIds)) { U.msg = 'The album is on the station.'; U.bad = false; ctx.repaint(); } });
  f.onsubmit = async ev => {
    ev.preventDefault(); keep();
    if (!U.album) { ctx.say('Give the album a name', true); return; }
    if (!ctx.admin && !U.rights) { ctx.say('Confirm the songs are yours or you have the rights to share them', true); return; }
    const todo = U.rows.filter(r => r.on && r.state !== 'good');
    if (!todo.length) return;
    U.busy = true; U.at = 0; U.msg = ''; U.doneIds ||= []; ctx.repaint();
    let ok = 0, bad = 0;
    for (const r of todo) {
      U.at++; ctx.repaint();
      if (!r.title) { r.state = 'bad'; r.note = 'needs a title'; bad++; continue; }
      if (r.file.size > MUSIC.maxUploadMB * 1024 * 1024) { r.state = 'bad'; r.note = `over ${MUSIC.maxUploadMB} MB`; bad++; continue; }
      for (let tries = 0; ; tries++) {
        try {
          const j = await sendSong(r.file, { title: r.title, artist: r.artist || U.albumArtist, genre: U.genre, explicit: U.explicit, rights: U.rights || ctx.admin, album: U.album, albumArtist: U.albumArtist || r.artist, track: r.track, year: Number(U.year) || null });
          r.state = 'good'; r.note = j.track?.status === 'approved' ? 'in the library' : 'waiting for review'; r.on = false; ok++;
          if (j.track?.status === 'approved') U.doneIds.push(j.track.id);
          break;
        } catch (e) {
          if (/too many songs at once/i.test(e.message) && tries < 8) { r.note = 'waiting a moment…'; ctx.repaint(); await sleep(16000); continue; }   // (a player's: twenty at once, then a few a minute)
          r.state = 'bad'; r.note = String(e.message || e).slice(0, 90); bad++; break;
        }
      }
    }
    // its cover, once its songs are there (an album of the uploader's own songs, for a player)
    if (ok && U.cover) {
      try {
        const res = await fetch(`/api/music/cover?key=${encodeURIComponent(albumKey(U.albumArtist || U.rows.find(r => r.artist)?.artist || '', U.album))}`, { method: 'POST', headers: { 'content-type': 'image/jpeg', ...(auth.csrf ? { 'x-csrf-token': auth.csrf } : {}) }, body: U.cover });
        if (!res.ok) { const j = await res.json().catch(() => ({})); U.coverNote = j.error || 'its cover was not saved'; }
      } catch { U.coverNote = 'its cover was not saved'; }
    }
    U.busy = false; U.doneN = (U.doneN || 0) + ok;
    U.msg = `${ok} song${ok === 1 ? '' : 's'} ${ctx.admin ? 'in the library' : 'sent for review'}${bad ? `, ${bad} not sent (see each)` : ''}${U.coverNote ? `; ${U.coverNote}` : ''}.`; U.bad = !!bad;
    await ctx.done();
    ctx.repaint();
  };
}

/** The first step: choose songs, a folder, or drop them. */
function pickFiles(el, U, ctx) {
  el.innerHTML = `<div class="rs-box au au-drop"><div class="rs-boxh"><b>Upload an album or a folder</b><span class="hint">Choose its songs or its whole folder, or drop them here. Their own tags give the titles, artist, album and numbers; a cover image in the folder (or the songs' own picture) becomes its cover. You see it all before anything is sent.</span></div>
    <div class="row wrap"><label class="btn primary">🎵 Choose songs<input type="file" class="au-files" accept="audio/*,image/*,.mp3,.m4a,.ogg,.wav,.flac" multiple hidden></label>
      <label class="btn">📁 Choose a folder<input type="file" class="au-dir" webkitdirectory directory multiple hidden></label><button type="button" class="btn" data-c="aux">Cancel</button></div>
    ${U.reading ? '<p class="hint">Reading their tags…</p>' : ''}</div>`;
  const box = el.querySelector('.au-drop');
  const take = async files => { U.reading = true; ctx.repaint(); await readAll(U, [...files], ctx); U.reading = false; ctx.repaint(); };
  el.querySelector('.au-files').onchange = e => take(e.target.files);
  el.querySelector('.au-dir').onchange = e => take(e.target.files);
  el.querySelector('[data-c="aux"]').onclick = () => ctx.close();
  box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('over'); if (e.dataTransfer?.files?.length) take(e.dataTransfer.files); });
}
async function setCover(U, blob, from) {
  const jpg = await coverJpeg(blob);
  if (!jpg) return false;
  if (U.coverUrl) URL.revokeObjectURL(U.coverUrl);
  Object.assign(U, { cover: jpg, coverUrl: URL.createObjectURL(jpg), coverFrom: from });
  return true;
}
/** Reads the files chosen: the songs' tags, the album's details from them, its cover. */
async function readAll(U, files, ctx) {
  const songs = files.filter(f => AUDIO.test(f.name) || /^audio\//.test(f.type)), images = files.filter(f => IMAGE.test(f.name) || /^image\//.test(f.type));
  U.skipped = files.length - songs.length - images.length;
  if (!songs.length) { ctx.say('Those are not songs: choose MP3s (or M4A, OGG, WAV, FLAC files)', true); return; }
  const tags = [];
  for (const f of songs) tags.push(/\.mp3$/i.test(f.name) || f.type === 'audio/mpeg' ? await readTags(f) : {});
  const folder = (songs[0].webkitRelativePath || '').split('/').slice(-2, -1)[0] || '';
  U.album = mostOf(tags.map(t => t.album)) || folder.replace(/[_-]+/g, ' ').trim();
  U.albumArtist = mostOf(tags.map(t => t.albumArtist)) || mostOf(tags.map(t => t.artist)) || auth.account?.displayName || '';
  U.year = mostOf(tags.map(t => t.year)) || '';
  U.genre = genreOf(mostOf(tags.map(t => t.genre))) || 'pop';
  U.rows = songs.map((file, k) => ({ file, on: true, title: tags[k].title || file.name.replace(/\.[a-z0-9]+$/i, '').replace(/^\d{1,3}[\s._-]+/, '').replace(/[_]+/g, ' ').trim(),
    artist: tags[k].artist && tags[k].artist !== U.albumArtist ? tags[k].artist : '', track: tags[k].track || Number((file.name.match(/^(\d{1,3})[\s._-]/) || [])[1]) || null }))
    .sort((a, b) => (a.track || 999) - (b.track || 999) || a.file.name.localeCompare(b.file.name));
  U.rows.forEach((r, k) => { if (!r.track) r.track = k + 1; });
  // its cover: the folder's (by its name, else its one image, else the largest), else a song's own picture
  const named = images.find(f => COVER.test(f.name)), pick = named || (images.length === 1 ? images[0] : images.sort((a, b) => b.size - a.size)[0]);
  if (pick) await setCover(U, pick, `from the folder: ${pick.name}`);
  else { const p = tags.find(t => t.picture)?.picture; if (p) await setCover(U, p, 'from the songs\' own picture'); }
}
