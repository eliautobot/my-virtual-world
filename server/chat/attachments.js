// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Chat attachments (PLAN WP2.2; DECISIONS C121, X11): files an account sends to an agent. Stored once per account by content hash
// (sha256) in <data>/attachments/<accountId>/<sha256>; the type comes from the file name's extension, never from what the
// client claims, and only images, PDF, office documents, plain-text or code files, video and audio are accepted (video and
// audio go only to an agent whose provider takes any file: server/chat/chat.js, capability `files`). The limits are settings
// (default 25 MB per file, 2 GB per account). An upload is streamed to a temporary file with a running size limit, so a
// large or endless body never fills memory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', xml: 'application/xml', yaml: 'text/plain', yml: 'text/plain', log: 'text/plain',
  js: 'text/plain', mjs: 'text/plain', ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain', py: 'text/plain', rb: 'text/plain', go: 'text/plain', rs: 'text/plain', java: 'text/plain',
  c: 'text/plain', h: 'text/plain', cpp: 'text/plain', cs: 'text/plain', php: 'text/plain', sh: 'text/plain', sql: 'text/plain', html: 'text/plain', css: 'text/plain', toml: 'text/plain', ini: 'text/plain',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', aac: 'audio/aac',
});
/** Video and audio: kept like any file, sent only where the provider takes any file. */
export const isAv = mime => /^(video|audio)\//.test(String(mime || ''));

const DRAIN_MAX = 64 * 1048576;   // what is read and discarded after a refusal, at most

export class AttachmentError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const safeName = n => String(n ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120);
export function typeOf(name) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name || '');
  const ext = m ? m[1].toLowerCase() : '';
  return Object.hasOwn(TYPES, ext) ? TYPES[ext] : null;
}

export class Attachments {
  /** limits() → { maxBytes, quotaBytes }, read on every upload so an admin's change applies at once. */
  constructor(dbs, root, { limits, now = () => Date.now() } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.root = root; this.limits = limits; this.now = now;
    this.q = {
      byHash: this.db.prepare('SELECT * FROM attachments WHERE world_id = ? AND account_id = ? AND sha256 = ?'),
      byId: this.db.prepare('SELECT * FROM attachments WHERE world_id = ? AND account_id = ? AND id = ?'),
      ins: this.db.prepare('INSERT INTO attachments (world_id, account_id, sha256, name, mime, size, created) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      used: this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE world_id = ? AND account_id = ?'),
      list: this.db.prepare('SELECT * FROM attachments WHERE world_id = ? AND account_id = ? ORDER BY id DESC LIMIT 200'),
      del: this.db.prepare('DELETE FROM attachments WHERE world_id = ? AND account_id = ? AND id = ?'),
    };
  }
  view(r) { return r ? { id: r.id, name: r.name, mime: r.mime, size: r.size, created: r.created } : null; }
  used(accountId) { return this.q.used.get(this.w, accountId).n; }
  get(accountId, id) { return this.view(this.q.byId.get(this.w, accountId, Number(id))); }
  list(accountId) { return this.q.list.all(this.w, accountId).map(r => this.view(r)); }
  /** The file's path for a provider call, or null. Only the owner's attachment resolves. */
  pathOf(accountId, id) {
    const r = this.q.byId.get(this.w, accountId, Number(id));
    return r ? { path: path.join(this.root, String(accountId), r.sha256), name: r.name, mime: r.mime, size: r.size, id: r.id } : null;
  }
  /** Removes one of the account's files (the Library's Delete): its space is free again; the chats it was sent in show
   *  it as gone, and their earlier messages are sent to the agent without it. Null when it is not the account's. */
  remove(accountId, id) {
    const r = this.q.byId.get(this.w, accountId, Number(id));
    if (!r) return null;
    this.q.del.run(this.w, accountId, r.id);
    try { fs.rmSync(path.join(this.root, String(accountId), r.sha256), { force: true }); } catch { /* already gone */ }
    return this.view(r);
  }
  /** Checks a name and declared size before any bytes are read. */
  precheck(accountId, name, declared = null) {
    const n = safeName(name);
    if (!n) throw new AttachmentError(400, 'bad_name', 'The file needs a name');
    const mime = typeOf(n);
    if (!mime) throw new AttachmentError(415, 'type_not_allowed', 'Only images, video, audio, PDF, office documents and text or code files can be attached');
    const { maxBytes, quotaBytes } = this.limits();
    if (declared !== null && declared > maxBytes) throw new AttachmentError(413, 'file_too_large', `A file may be at most ${Math.round(maxBytes / 1048576)} MB`);
    if (declared !== null && this.used(accountId) + declared > quotaBytes) throw new AttachmentError(413, 'quota_exceeded', `Your attachments may take at most ${Math.round(quotaBytes / 1048576)} MB in total; remove some first`);
    return { name: n, mime, maxBytes, quotaBytes };
  }
  /** Streams a request body to a temp file with a running limit, hashes it, and stores it once per account. */
  async store(accountId, name, stream, declared = null) {
    const { name: n, mime, maxBytes, quotaBytes } = this.precheck(accountId, name, declared);
    const dir = path.join(this.root, String(accountId));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.up-${crypto.randomBytes(6).toString('hex')}`);
    const out = fs.createWriteStream(tmp, { mode: 0o600 }), hash = crypto.createHash('sha256');
    let size = 0, over = false, drained = 0;
    // createWriteStream opens its file asynchronously: removing the temp file before the stream has closed can leave it behind,
    // so every cleanup waits for the close first
    const drop = async () => {
      await new Promise(resolve => { if (out.closed) resolve(); else { out.once('close', resolve); out.destroy(); } });
      try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ }
    };
    try {
      await new Promise((resolve, reject) => {
        stream.on('data', chunk => {
          // past the limit nothing more is kept; the rest of the body is read and thrown away (so the client still receives
          // the answer), up to a ceiling, then the connection is dropped
          if (over) { drained += chunk.length; if (drained > DRAIN_MAX) stream.destroy?.(); return; }
          size += chunk.length;
          if (size > maxBytes) { over = true; reject(new AttachmentError(413, 'file_too_large', `A file may be at most ${Math.round(maxBytes / 1048576)} MB`)); stream.resume?.(); return; }
          hash.update(chunk);
          if (!out.write(chunk)) { stream.pause(); out.once('drain', () => stream.resume()); }
        });
        stream.on('end', () => out.end(resolve));
        stream.on('error', reject); stream.on('aborted', () => reject(new AttachmentError(400, 'aborted', 'The upload was cut off')));
        out.on('error', reject);
      });
    } catch (e) { await drop(); stream.resume?.(); throw e; }
    if (!size) { await drop(); throw new AttachmentError(400, 'empty', 'The file is empty'); }
    const sha = hash.digest('hex');
    const have = this.q.byHash.get(this.w, accountId, sha);
    if (have) { await drop(); return { ...this.view(have), duplicate: true }; }
    if (this.used(accountId) + size > quotaBytes) { await drop(); throw new AttachmentError(413, 'quota_exceeded', `Your attachments may take at most ${Math.round(quotaBytes / 1048576)} MB in total; remove some first`); }
    fs.renameSync(tmp, path.join(dir, sha));
    const r = this.q.ins.run(this.w, accountId, sha, n, mime, size, this.now());
    return this.get(accountId, Number(r.lastInsertRowid));
  }
}
