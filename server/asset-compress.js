// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The characters' files over the wire (2026-11-02, the product owner: "there's a big delay from loading the world to
// actually working smoothly ... characters don't show up initially"): every character is ~11 MB of mesh and baked
// animation (client/assets/chars/<kind>.bin, .extra.bin, .venue.bin), sent uncompressed and checked again on every
// visit, so a new visitor waited one to several minutes for the people to appear. Here:
// - each such file is compressed once, Brotli and gzip, in the background (zlib's thread pool, one file at a time, never
//   on a request), kept in the system's temporary folder (never the data folder: about half a gigabyte, rebuilt in a
//   minute after a restart; a hosted data disk has no room to spare) under a name from the file's size and time, and
//   only while that disk keeps 1 GB free; sent instead to a browser that takes it — about half the bytes (the venue clips a fifth); until it is ready the plain file goes;
// - the folder's version (from every file's name, size and time) is published at /assets/chars/version.json; a request
//   carrying that version (?v=) may be kept by the browser for a year, since its content can't change under that name.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const br = promisify(zlib.brotliCompress), gz = promisify(zlib.gzip);
/** The files worth compressing: baked meshes and clips (the maps are JPEG already, the JSON is gzipped as text). */
const PACK = /\.bin$/i;

/** The space left on the disk holding `dir` (bytes; Infinity when it can't be read). */
const freeOn = dir => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } };
export class AssetCompressor {
  /** dir: the folder served (client/assets/chars); cache: where the compressed copies are kept; log: { info, error };
   *  minFree: the space the cache's disk keeps (bytes). */
  constructor({ dir, cache, log = console, minFree = 1024 ** 3 }) {
    this.dir = dir; this.cache = cache; this.log = log; this.minFree = minFree;
    this.ready = new Map();   // file → { br, gz } paths of finished copies (each may be missing)
    this.version = '';
    fs.mkdirSync(cache, { recursive: true });
    this.scan();
  }
  /** The folder's version and its files to compress; copies of files that are gone or changed are removed. */
  scan() {
    const h = crypto.createHash('sha1'), keep = new Set(), todo = [];
    for (const name of fs.readdirSync(this.dir).sort()) {
      const file = path.join(this.dir, name);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      h.update(`${name}\0${st.size}\0${Math.round(st.mtimeMs)}\n`);
      if (!PACK.test(name)) continue;
      const key = crypto.createHash('sha1').update(`${name}\0${st.size}\0${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 20);
      const out = { br: path.join(this.cache, key + '.br'), gz: path.join(this.cache, key + '.gz') };
      keep.add(key + '.br'); keep.add(key + '.gz');
      const have = { br: fs.existsSync(out.br) ? out.br : null, gz: fs.existsSync(out.gz) ? out.gz : null };
      this.ready.set(file, have);
      if (!have.br || !have.gz) todo.push([file, out]);
    }
    this.version = h.digest('hex').slice(0, 12);
    for (const f of fs.readdirSync(this.cache)) if (!keep.has(f)) fs.rmSync(path.join(this.cache, f), { force: true });
    this.todo = todo;
  }
  /** Compresses what is missing, one file at a time; resolves when all are done (a failure leaves that file plain). */
  async warm() {
    const t0 = Date.now(); let n = 0;
    for (const [file, out] of this.todo) {
      if (freeOn(this.cache) < this.minFree) { this.log.info?.('[assets] not compressing the characters\' files: under 1 GB free where they would be kept'); break; }
      try {
        const buf = await fs.promises.readFile(file), have = this.ready.get(file);
        for (const [enc, fn, opts] of [['br', br, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 7, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }], ['gz', gz, { level: 6 }]]) {
          if (have[enc]) continue;
          const z = await fn(buf, opts), tmp = out[enc] + '.tmp';
          await fs.promises.writeFile(tmp, z); await fs.promises.rename(tmp, out[enc]);
          have[enc] = out[enc];
        }
        n++;
      } catch (e) { this.log.error?.('[assets] could not compress', path.basename(file), e.message); }
    }
    if (n) this.log.info?.(`[assets] ${n} character files compressed in ${Math.round((Date.now() - t0) / 1000)} s`);
    this.todo = [];
  }
  /** The compressed copy of `file` to send for this Accept-Encoding: { path, encoding } or null (send it plain). */
  pick(file, acceptEncoding = '') {
    const have = this.ready.get(file); if (!have) return null;
    if (have.br && /\bbr\b/.test(acceptEncoding)) return { path: have.br, encoding: 'br' };
    if (have.gz && /\bgzip\b/.test(acceptEncoding)) return { path: have.gz, encoding: 'gzip' };
    return null;
  }
}
