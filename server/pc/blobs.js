// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC's file contents, stored once by fingerprint (docs/features/agent-pc.md §3). Two agents, a team or a file's own
// versions holding the same bytes share one copy: `refs` counts who points at it, and a copy nobody points at is swept.
// Small contents (up to INLINE_MAX) live in pc.db; bigger ones in <data>/pc/blobs/<aa>/<sha256>. Text-like contents are
// compressed (zstd) when that saves at least a tenth; pictures, video, archives and PDFs are kept as they are (already
// packed). The file store is only ever reached by a fingerprint checked to be 64 hex digits: nothing an agent or a
// person typed ever becomes a path on disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const INLINE_MAX = 64 * 1024;
const SHA = /^[0-9a-f]{64}$/;
const PACKED = /^(image\/(?!svg)|video\/|audio\/|font\/)|^application\/(pdf|zip|gzip|x-7z|x-rar|x-bzip|zstd|x-xz|octet-stream|vnd\.openxmlformats|vnd\.oasis|epub|x-tar)/;
const ZSTD_LEVEL = 3;

export const shaOf = buf => crypto.createHash('sha256').update(buf).digest('hex');
const isSha = s => typeof s === 'string' && SHA.test(s);

export class BlobStore {
  /** pc: openPcDb()'s handle; dir: the file store's folder. */
  constructor(pc, dir) {
    this.pc = pc; this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const db = pc.db;
    this.q = {
      get: db.prepare('SELECT sha, size, stored, codec, data, refs FROM blobs WHERE sha = ?'),
      ins: db.prepare('INSERT INTO blobs (sha, size, stored, codec, data, refs, created) VALUES (?, ?, ?, ?, ?, 1, ?)'),
      inc: db.prepare('UPDATE blobs SET refs = refs + 1 WHERE sha = ?'),
      dec: db.prepare('UPDATE blobs SET refs = refs - 1 WHERE sha = ?'),
      unused: db.prepare('SELECT sha, size, stored FROM blobs WHERE refs <= 0 LIMIT ?'),
      del: db.prepare('DELETE FROM blobs WHERE sha = ? AND refs <= 0'),
      has: db.prepare('SELECT 1 AS x FROM blobs WHERE sha = ?'),
      totals: db.prepare("SELECT stored, COUNT(*) AS n, SUM(size) AS size, SUM(CASE WHEN data IS NULL THEN 0 ELSE LENGTH(data) END) AS kept FROM blobs GROUP BY stored"),
    };
  }
  fileOf(sha) {
    if (!isSha(sha)) throw new Error('bad fingerprint');
    return path.join(this.dir, sha.slice(0, 2), sha);
  }

  /**
   * Prepares `buf` for storing (outside any transaction: the file store is written before the database row, so a
   * rolled-back write leaves at most a stray file that sweepFiles() removes). Returns { sha, size, put } - call put()
   * inside the transaction that points a node or a version at it.
   */
  prepare(buf, mime = '') {
    const sha = shaOf(buf), size = buf.length;
    let packed = null;
    if (!PACKED.test(mime || '') && size >= 512 && size <= 16 * 1048576) {
      const z = zlib.zstdCompressSync(buf, { params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } });
      if (z.length <= size * 0.9) packed = z;
    }
    const codec = packed ? 'zstd' : 'none', body = packed || buf;
    const inline = size <= INLINE_MAX;
    // (no row yet: the file is written again even if one is there - a stray left by a rolled-back write may have been
    // packed differently, and the row about to be made must describe the bytes on disk)
    if (!inline && !this.q.has.get(sha)) {
      const file = this.fileOf(sha);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, body, { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
    return {
      sha, size,
      put: () => {
        const row = this.q.get.get(sha);
        if (row) { this.q.inc.run(sha); return sha; }
        this.q.ins.run(sha, size, inline ? 'db' : 'disk', codec, inline ? body : null, Date.now());
        return sha;
      },
    };
  }

  /** One more reference to a content already stored (a copy of a file, a version kept). */
  addRef(sha) { if (isSha(sha)) this.q.inc.run(sha); }
  /** One reference fewer (a file deleted, a version dropped); swept when none is left. */
  unref(sha) { if (isSha(sha)) this.q.dec.run(sha); }

  /** The bytes of `sha` (null: not stored). */
  read(sha) {
    if (!isSha(sha)) return null;
    const r = this.q.get.get(sha);
    if (!r) return null;
    let body;
    if (r.stored === 'db') body = Buffer.from(r.data);
    else { try { body = fs.readFileSync(this.fileOf(sha)); } catch { return null; } }
    return r.codec === 'zstd' ? zlib.zstdDecompressSync(body, { maxOutputLength: r.size + 1 }) : body;
  }

  /** Removes contents nobody points at (in batches). { n, bytes } */
  sweep(batch = 500) {
    let n = 0, bytes = 0;
    for (;;) {
      const rows = this.q.unused.all(batch);
      if (!rows.length) break;
      const files = [];
      this.pc.tx(() => { for (const r of rows) { if (this.q.del.run(r.sha).changes) { n++; bytes += r.size; if (r.stored === 'disk') files.push(r.sha); } } });
      for (const sha of files) { try { fs.rmSync(this.fileOf(sha), { force: true }); } catch { /* gone already */ } }
      if (rows.length < batch) break;
    }
    return { n, bytes };
  }
  /** Removes files in the store that no row names (left by a write that was rolled back, or a crash). */
  sweepFiles({ olderThanMs = 3600000 } = {}) {
    let n = 0;
    const now = Date.now();
    let dirs = [];
    try { dirs = fs.readdirSync(this.dir, { withFileTypes: true }).filter(e => e.isDirectory() && /^[0-9a-f]{2}$/.test(e.name)); } catch { return 0; }
    for (const d of dirs) {
      const sub = path.join(this.dir, d.name);
      for (const name of fs.readdirSync(sub)) {
        const file = path.join(sub, name);
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (now - st.mtimeMs < olderThanMs) continue;   // (one being written right now)
        const sha = name.replace(/\..*$/, '');
        if (name.endsWith('.tmp') || !isSha(sha) || !this.q.has.get(sha)) { try { fs.rmSync(file, { force: true }); n++; } catch { /* busy */ } }
      }
    }
    return n;
  }
  /** What the store holds: { files, bytes (logical), kept (bytes taken: compressed, in the database and on disk) }. */
  totals() {
    let files = 0, bytes = 0, kept = 0;
    for (const r of this.q.totals.all()) {
      files += r.n; bytes += r.size || 0;
      kept += r.stored === 'db' ? (r.kept || 0) : 0;
    }
    kept += dirBytes(this.dir);
    return { files, bytes, kept };
  }
}

function dirBytes(dir) {
  let n = 0;
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(dir, d.name))) { try { n += fs.statSync(path.join(dir, d.name, f)).size; } catch { /* gone */ } }
    }
  } catch { /* no store yet */ }
  return n;
}
