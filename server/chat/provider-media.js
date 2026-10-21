// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The media of a provider's answers (Agent Providers, docs/features/agent-providers.md §4): the images, video and audio an
// agent attached, shown in the chat window. A page never names a file. Each medium of a message the server sends carries
// an address signed for that agent and session (the provider's own reference to it - an artifact id, a path the agent
// wrote - stays here); only a person who may read that session is served it. It is fetched once through the provider
// (its adapter's media call: OpenClaw's own routes and its own rules on which files a session may show) and kept in a
// cache on disk, the least recently used dropped first.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { media as cleanMedia } from '../providers/bus.js';
import { SECRET_PREFIX, aadInstall } from '../secret-holders.js';

/** The signing key's name among the installation's sealed settings (server/secret-holders.js). */
export const MEDIA_KEY = 'chat.mediaKey';
/** How much fetched media the cache keeps by default (server/config.js: MVW_PROVIDER_MEDIA_CACHE_MB). */
export const CACHE_MAX_BYTES = 1024 * 1024 * 1024;
/** The types shown in the page as what they are; anything else is offered as a download. */
export const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac|flac|opus))$/;

export class ProviderMedia {
  /** @param {{ dbs: { db: object, worldId: string }, box: object, dir: string, cacheMax?: number, log?: object }} o */
  constructor({ dbs, box, dir, cacheMax = CACHE_MAX_BYTES, log = null }) {
    Object.assign(this, { db: dbs.db, w: dbs.worldId, box, dir, cacheMax, log });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.pending = new Map();   // cache id → the fetch under way (one per medium, however many pages ask)
    this._key = null;
  }
  /** The signing key: random, sealed with the installation key in the settings (made the first time it is needed). */
  key() {
    if (this._key) return this._key;
    const name = SECRET_PREFIX + MEDIA_KEY, aad = aadInstall(this.w, MEDIA_KEY);
    const row = this.db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?').get(this.w, name);
    if (row) { this._key = Buffer.from(this.box.open(row.value, aad), 'base64'); return this._key; }
    const k = crypto.randomBytes(32);
    this.db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT(world_id, key) DO UPDATE SET value = excluded.value').run(this.w, name, this.box.seal(k.toString('base64'), aad));
    this._key = k;
    return k;
  }
  sign(text) { return crypto.createHmac('sha256', this.key()).update(text).digest('base64url').slice(0, 43); }

  /** A message's media as a page gets them: kind, name, type, size and the signed address - never the reference. */
  view(agentId, sessionId, list) {
    let clean = [];
    try { clean = cleanMedia('media', Array.isArray(list) ? list : []); } catch { return []; }
    return clean.map(({ ref, ...m }) => ({ ...m, src: this.url(agentId, sessionId, ref) }));
  }
  url(agentId, sessionId, ref) {
    const r = Buffer.from(JSON.stringify(ref)).toString('base64url');
    return `/api/providers/media?agent=${Number(agentId)}&session=${Number(sessionId)}&r=${r}&s=${this.sign(`${Number(agentId)}|${Number(sessionId)}|${r}`)}`;
  }
  /** The reference an address names when its signature holds for that agent and session; otherwise null. */
  open(agentId, sessionId, r, sig) {
    if (typeof r !== 'string' || typeof sig !== 'string' || r.length > 4096 || !/^[\w-]+$/.test(r)) return null;
    const want = Buffer.from(this.sign(`${Number(agentId)}|${Number(sessionId)}|${r}`)), got = Buffer.from(sig);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    try {
      const ref = JSON.parse(Buffer.from(r, 'base64url').toString('utf8'));
      if (ref && typeof ref.artifactId === 'string') return { artifactId: ref.artifactId };
      if (ref && typeof ref.source === 'string') return { source: ref.source };
    } catch { /* not ours */ }
    return null;
  }

  /**
   * The medium's file here - { file, mime, size } - from the cache, or fetched once through `fetch` (→ { mime, data }
   * base64; the provider's own error when it can't). `id` names it: the connection, the provider's session, its reference.
   */
  async get(id, fetch) {
    const h = crypto.createHash('sha256').update(id).digest('hex'), file = path.join(this.dir, h), metaFile = `${file}.json`;
    const kept = this.read(file, metaFile);
    if (kept) return kept;
    let p = this.pending.get(h);
    if (!p) {
      p = (async () => {
        const r = await fetch();
        const body = Buffer.from(String((r && r.data) || ''), 'base64');
        const mime = String((r && r.mime) || 'application/octet-stream').toLowerCase();
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body, { mode: 0o600 });
        fs.renameSync(tmp, file);
        fs.writeFileSync(metaFile, JSON.stringify({ mime, size: body.length }), { mode: 0o600 });
        this.prune();
        return { file, mime, size: body.length };
      })().finally(() => this.pending.delete(h));
      this.pending.set(h, p);
    }
    return p;
  }
  read(file, metaFile) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')), st = fs.statSync(file);
      const now = new Date(); fs.utimesSync(metaFile, now, now);   // (recently used)
      return { file, mime: String(meta.mime || 'application/octet-stream'), size: st.size };
    } catch { return null; }
  }
  /** Keeps the cache within its size: the least recently used go first. */
  prune() {
    try {
      const list = fs.readdirSync(this.dir).filter(n => n.endsWith('.json')).map(n => {
        const metaFile = path.join(this.dir, n), file = metaFile.slice(0, -5);
        try { return { file, metaFile, at: fs.statSync(metaFile).mtimeMs, size: fs.statSync(file).size }; } catch { return { file, metaFile, at: 0, size: 0 }; }
      }).sort((a, b) => a.at - b.at);
      let total = list.reduce((t, x) => t + x.size, 0);
      for (const x of list) {
        if (total <= this.cacheMax) break;
        for (const f of [x.file, x.metaFile]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
        total -= x.size;
      }
    } catch (e) { this.log?.warn?.('[chat] could not trim the media cache:', e.message); }
  }
}
