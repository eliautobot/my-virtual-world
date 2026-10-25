// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The game's own soundtrack (2026-10-25, the product owner: "the music is game world music"): the songs in
// server/music/soundtrack/ (listed in its soundtrack.json, licensed by its LICENSE.md: for playing inside My Virtual
// World only) go into a world's music library when the server starts, each once, approved, as they are (the files are
// already at the library's loudness, so their loop points stay exact).
//
// What a world has taken is kept in its settings ('music.soundtrack': the songs' keys): a song an administrator deletes
// stays deleted, and a song the library already has under the same key (imported by tools/music-import.mjs) counts as
// taken. A later version's new songs are added by the next start. MVW_SOUNDTRACK=off leaves the library alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mp3Seconds } from './audio.js';
import { GENRES } from '../../shared/music.js';

export const SOUNDTRACK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'soundtrack');
const KEY = 'music.soundtrack';
const RIGHTS = 'My Virtual World soundtrack: for playing inside My Virtual World only (server/music/soundtrack/LICENSE.md)';

/** Adds the soundtrack's songs the world has not taken yet: { added, taken, failed }. */
export function seedSoundtrack(music, { dir = SOUNDTRACK_DIR, log = console } = {}) {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(dir, 'soundtrack.json'), 'utf8')); } catch { return { added: 0, taken: 0, failed: 0 }; }
  const db = music.dbs.db, W = music.dbs.worldId;
  let taken = [];
  try { taken = JSON.parse(db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?').get(W, KEY)?.value || '[]'); } catch { /* none yet */ }
  const done = new Set(Array.isArray(taken) ? taken : []), before = done.size;
  const have = new Set([...music.tracks.values()].map(t => t.meta?.key).filter(Boolean));
  let added = 0, failed = 0;
  for (const e of list.tracks || []) {
    if (!e.key || done.has(e.key)) continue;
    if (have.has(e.key)) { done.add(e.key); continue; }
    const src = path.join(dir, e.file || ''), file = music.newFileName('mp3'), dst = path.join(music.dir, file);
    try {
      if (!GENRES[e.genre]) throw new Error(`unknown genre "${e.genre}"`);
      fs.copyFileSync(src, dst);
      const seconds = mp3Seconds(fs.readFileSync(dst));
      if (!seconds) throw new Error('not an MP3');
      music.add({ file, seconds, title: e.title, artist: e.artist || 'My Virtual World', genre: e.genre, mood: e.mood || null, bpm: e.bpm || null, explicit: !!e.explicit,
        rights: RIGHTS, source: 'import', status: 'approved', loop: Array.isArray(e.loop) && e.loop.length === 2 ? e.loop.map(Number) : null, meta: { ...(e.meta || {}), key: e.key, soundtrack: true } });
      done.add(e.key); added++;
    } catch (err) {
      try { fs.unlinkSync(dst); } catch { /* none */ }
      failed++; log.warn('[music]', `the soundtrack's "${e.title || e.file}" not added: ${err.message}`);
    }
  }
  if (done.size !== before) db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value').run(W, KEY, JSON.stringify([...done]));
  if (added) log.info('[music]', `the soundtrack: ${added} song${added === 1 ? '' : 's'} added to the music library`);
  return { added, taken: done.size, failed };
}
