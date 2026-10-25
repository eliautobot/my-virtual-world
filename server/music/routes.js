// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The music's routes (server/music/music.js, docs/features/music.md): anyone watching hears and sees what plays; players
// ask for songs and add their own (an administrator approves them before they play); administrators run every stage
// and the library (for now: floor owners later).
import fs from 'node:fs';
import path from 'node:path';
import { MusicError } from './music.js';
import { hasFfmpeg, convert, mp3Seconds } from './audio.js';
import { GENRES, MUSIC } from '../../shared/music.js';

const TYPES = /^(audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|opus|wav|x-wav|wave|flac|x-flac|webm)|video\/(mp4|webm|ogg)|application\/octet-stream)$/;

/** @param router @param d { music, perms, readStream(req, limit), audit? } */
export function addMusicRoutes(router, d) {
  const M = d.music, can = (P, c) => d.perms.allowed(P, c), me = P => (P.account ? Number(P.account.id) : null);
  const wrap = fn => async ctx => {
    try { return await fn(ctx); } catch (e) { if (e instanceof MusicError) return { status: e.status, json: { error: e.message, code: e.code } }; throw e; }
  };
  const buckets = new Map();
  const brake = (id, per = 6000, burst = 6) => {
    const now = Date.now(), b = buckets.get(id) || { t: now, n: 0 };
    b.n = Math.max(0, b.n - (now - b.t) / per); b.t = now; b.n += 1; buckets.set(id, b);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.t > 600e3) buckets.delete(k);
    return b.n > burst;
  };
  const who = P => ({ request: can(P, 'music.request'), upload: can(P, 'music.upload'), manage: can(P, 'music.manage'), convert: hasFfmpeg() });

  // ------------------------------------------------------------ hearing and seeing
  router.add({ method: 'GET', path: '/api/music/state', cap: 'world.view', handler: wrap(async ({ P }) => ({ json: { library: M.list(me(P), can(P, 'music.manage')), decks: M.decksAll(), can: who(P) } })) });
  router.add({ method: 'GET', path: '/api/music/library', cap: 'world.view', handler: wrap(async ({ P }) => ({ json: M.list(me(P), can(P, 'music.manage')) })) });
  router.add({ method: 'GET', path: '/api/music/deck', cap: 'world.view', handler: wrap(async ({ url }) => {
    const deck = M.deckOf(url.searchParams.get('place'));
    if (!deck) return { status: 404, json: { error: 'There is no stage there', code: 'no_stage' } };
    return { json: { deck: M.pubDeck(deck) } };
  }) });
  router.add({ method: 'GET', prefix: '/api/music/file/', cap: 'world.view', handler: wrap(async ({ P, param }) => {
    const f = M.fileOf(String(param || '').replace(/\.mp3$/, ''), me(P), can(P, 'music.manage'));
    if (!f) return { status: 404, json: { error: 'No such song', code: 'not_found' } };
    return { file: f, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=604800, immutable' } };
  }) });

  // ------------------------------------------------------------ requests
  router.add({ method: 'POST', path: '/api/music/request', cap: 'music.request', handler: wrap(async ({ P, body }) => {
    if (brake(`r${P.account.id}`)) return { status: 429, json: { error: 'Slow down a little', code: 'slow_down' } };
    return { json: M.request(me(P), P.account.displayName, body?.place, body?.track) };
  }) });
  router.add({ method: 'POST', path: '/api/music/request/cancel', cap: 'music.request', handler: wrap(async ({ P, body }) => {
    const admin = can(P, 'music.manage');
    M.cancel(me(P), body?.place, admin, admin && body?.index != null ? body.index : null);
    return { json: { ok: true } };
  }) });

  // ------------------------------------------------------------ running a stage (administrators)
  router.add({ method: 'POST', path: '/api/music/deck', cap: 'music.manage', handler: wrap(async ({ body }) => {
    const s = {};
    if (typeof body?.requests === 'boolean') s.requests = body.requests;
    if (body && 'genre' in body) s.genre = body.genre || null;
    if (body && 'playlist' in body) s.playlist = body.playlist;
    return { json: { deck: M.configure(body?.place, s) } };
  }) });
  router.add({ method: 'POST', path: '/api/music/skip', cap: 'music.manage', handler: wrap(async ({ body }) => { M.skip(body?.place); return { json: { ok: true } }; }) });
  router.add({ method: 'POST', path: '/api/music/clear', cap: 'music.manage', handler: wrap(async ({ body }) => { M.clear(body?.place); return { json: { ok: true } }; }) });

  // ------------------------------------------------------------ the library
  // A song: its file as the body (any common audio type with ffmpeg on the server, else MP3), its details in the query:
  // title, artist, genre, explicit (1), rights (1: "it's mine or I have the rights"), seconds and gain (as the
  // uploader's browser measured them: used only without ffmpeg). An administrator's goes straight into the library;
  // a player's waits for an administrator's review.
  router.add({ method: 'POST', path: '/api/music/upload', cap: 'music.upload', raw: true, handler: wrap(async ({ P, req, url }) => {
    const admin = can(P, 'music.manage'), q = url.searchParams, uid = me(P);
    if (!admin && brake(`u${uid}`, 60000, 5)) return { status: 429, json: { error: 'Too many songs at once; wait a minute', code: 'slow_down' } };
    if (!admin && M.pendingOf(uid) >= 10) return { status: 409, json: { error: 'You have 10 songs waiting for review; wait until they are looked at', code: 'too_many_pending' } };
    if (!admin && q.get('rights') !== '1') return { status: 400, json: { error: 'Confirm the song is yours or you have the rights to share it', code: 'rights_required' } };
    const genre = q.get('genre');
    if (!GENRES[genre] || (GENRES[genre].internal && !admin)) return { status: 400, json: { error: 'Pick one of the genres', code: 'bad_genre' } };
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const conv = hasFfmpeg();
    if (!TYPES.test(type) || (!conv && !/^audio\/(mpeg|mp3)$/.test(type))) return { status: 415, json: { error: conv ? 'Upload an audio file (MP3, M4A, OGG, WAV, FLAC)' : 'Upload an MP3 file', code: 'unsupported_media_type' } };
    let buf;
    try { buf = await d.readStream(req, MUSIC.maxUploadMB * 1024 * 1024); } catch (e) { return { status: e.status || 400, json: { error: e.status === 413 ? `A song is at most ${MUSIC.maxUploadMB} MB` : 'The upload failed', code: 'bad_audio' } }; }
    if (buf.length < 4096) return { status: 400, json: { error: 'That file is too small to be a song', code: 'bad_audio' } };
    const file = M.newFileName('mp3'), dst = path.join(M.dir, file), tmp = path.join(M.dir, `.up-${file}`);
    let seconds, gain = 0;
    try {
      if (conv) {
        fs.writeFileSync(tmp, buf);
        ({ seconds, gain } = await convert(tmp, dst));
        gain = 0;   // (applied to the file)
      } else {
        seconds = mp3Seconds(buf);
        if (!seconds) return { status: 400, json: { error: 'That file is not an MP3', code: 'bad_audio' } };
        const told = Number(q.get('seconds'));
        if (Number.isFinite(told) && told > 0 && Math.abs(told - seconds) / seconds < 0.2) seconds = told;   // (the browser's exact decode, when it agrees)
        gain = Math.max(-20, Math.min(10, Number(q.get('gain')) || 0));
        fs.writeFileSync(dst, buf, { mode: 0o644 });
      }
      const t = M.add({ file, seconds, gain, title: q.get('title'), artist: q.get('artist') || P.account.displayName, genre, explicit: q.get('explicit') === '1',
        uploader: uid, rights: admin ? (q.get('rights') === '1' ? 'Added by an administrator' : '') : 'The uploader confirmed the song is theirs or they have the rights to share it',
        source: admin ? 'library' : 'upload', status: admin ? 'approved' : 'pending' });
      d.audit?.log('music.upload', { actor: { id: uid, login: P.account.login }, detail: { id: t.id, title: t.title, status: t.status } });
      return { json: { track: M.pub(t, admin, uid) } };
    } catch (e) {
      try { fs.unlinkSync(dst); } catch { /* none */ }
      if (e instanceof MusicError) throw e;
      if (e.status) return { status: e.status, json: { error: e.message, code: e.code || 'bad_audio' } };
      throw e;
    } finally { try { fs.unlinkSync(tmp); } catch { /* none */ } }
  }) });
  router.add({ method: 'POST', path: '/api/music/track', cap: 'music.manage', handler: wrap(async ({ body }) => {
    const patch = {};
    for (const k of ['title', 'artist', 'genre', 'explicit']) if (body && k in body) patch[k] = body[k];
    return { json: { track: M.pub(M.edit(body?.id, patch), true) } };
  }) });
  router.add({ method: 'POST', path: '/api/music/review', cap: 'music.manage', handler: wrap(async ({ P, body }) => {
    const t = M.review(body?.id, body?.approve === true, body?.reason);
    d.audit?.log('music.review', { actor: { id: me(P), login: P.account.login }, detail: { id: t.id, title: t.title, status: t.status } });
    return { json: { track: M.pub(t, true) } };
  }) });
  router.add({ method: 'POST', path: '/api/music/delete', cap: 'music.upload', handler: wrap(async ({ P, body }) => {
    const t = M.track(body?.id), admin = can(P, 'music.manage');
    if (!admin && !(t.uploader === me(P) && t.status !== 'approved')) return { status: 403, json: { error: 'Only an administrator removes a song from the library', code: 'forbidden' } };
    M.remove(t.id);
    d.audit?.log('music.delete', { actor: { id: me(P), login: P.account.login }, detail: { id: t.id, title: t.title } });
    return { json: { ok: true } };
  }) });
}
