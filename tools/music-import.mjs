#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Adds a set of songs to a world's music library (docs/features/music.md) from a list: the owner's own music, a
// soundtrack. Run it while the server is stopped (a running server reads the library when it starts).
//   node tools/music-import.mjs <list.json> [--data <data folder>] [--as-is] [--dry]
//   data: --data, else $MVW_DATA, else ./data.
//   --as-is   MP3 files already at the library's loudness are copied as they are (loop points stay exact); otherwise
//             every file is converted with ffmpeg (needed for anything but MP3)
// list.json: { "tracks": [ { "file": "lounge/velvet-hour.mp3", "title": "Velvet Hour", "artist": "…", "genre": "jazz",
//   "mood": "…", "bpm": 112, "explicit": false, "loop": [0.5, 70.9], "key": "a stable id of yours", "meta": { … } } ] }
// (file: relative to the list; genre: shared/music.js GENRES; key: a song already imported under the same key is skipped).
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { Music } from '../server/music/music.js';
import { hasFfmpeg, convert, probe, mp3Seconds } from '../server/music/audio.js';
import { GENRES } from '../shared/music.js';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const listFile = args.find(a => a.endsWith('.json'));
if (!listFile) { console.error('Usage: node tools/music-import.mjs <list.json> [--data <data folder>] [--as-is] [--dry]'); process.exit(2); }
const data = path.resolve(opt('--data') || process.env.MVW_DATA || 'data'), asIs = args.includes('--as-is'), dry = args.includes('--dry');
const list = JSON.parse(fs.readFileSync(listFile, 'utf8')), base = path.dirname(path.resolve(listFile));
if (!fs.existsSync(path.join(data, 'next.db'))) { console.error(`No world in ${data} (no next.db)`); process.exit(2); }

const dbs = openDb(data);
const music = new Music({ dbs, dataDir: data, sim: () => null, world: () => null, log: console });
const have = new Set([...music.tracks.values()].map(t => t.meta?.key).filter(Boolean));
let added = 0, skipped = 0, failed = 0;
for (const e of list.tracks || []) {
  const src = path.resolve(base, e.file || '');
  if (e.key && have.has(e.key)) { skipped++; continue; }
  if (!GENRES[e.genre] || !e.title || !fs.existsSync(src)) { console.log(`✗ ${e.title || e.file}: ${!GENRES[e.genre] ? `unknown genre "${e.genre}"` : !e.title ? 'no title' : 'no such file'}`); failed++; continue; }
  if (dry) { console.log(`would add "${e.title}" (${e.genre}) from ${e.file}`); continue; }
  const file = music.newFileName('mp3'), dst = path.join(music.dir, file);
  try {
    let seconds;
    if (asIs && /\.mp3$/i.test(src)) {
      fs.copyFileSync(src, dst);
      seconds = hasFfmpeg() ? (await probe(dst))?.seconds : mp3Seconds(fs.readFileSync(dst));
    } else {
      if (!hasFfmpeg()) throw new Error('converting needs ffmpeg (or --as-is for MP3 files)');
      ({ seconds } = await convert(src, dst));
    }
    music.add({ file, seconds, title: e.title, artist: e.artist || 'Unknown artist', genre: e.genre, mood: e.mood || null, bpm: e.bpm || null, explicit: !!e.explicit,
      source: 'import', status: 'approved', loop: Array.isArray(e.loop) && e.loop.length === 2 ? e.loop.map(Number) : null, meta: { ...(e.meta || {}), key: e.key || null } });
    if (e.key) have.add(e.key);
    added++;
    console.log(`✓ ${e.title} (${e.genre}, ${Math.round(seconds)} s)`);
  } catch (err) {
    try { fs.unlinkSync(dst); } catch { /* none */ }
    console.log(`✗ ${e.title}: ${err.message}`); failed++;
  }
}
dbs.db.close();
console.log(`${added} added, ${skipped} already there, ${failed} failed`);
process.exit(failed ? 1 : 0);
