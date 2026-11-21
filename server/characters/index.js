// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Characters made in the builder (client/js/builder/, the Agent Studio's Customize tab): the browser sends the kit
// (shared/char-kit.js) and gets back the character's id once the city has baked it into a model of its own
// (tools/chars/custom-kind.mjs, in a child process: ~10 s of work that never holds up the world). A character is named by
// its kit's content (c_ + 16 hex digits of its hash): the same character is baked once, and its files never change
// (<data>/chars/<id>.json|.bin, their compressed copies and its preset, served at /assets/chars/custom/). A look wears it
// like a ready-made one (shared/appearance.js isCustomChar); nothing here changes anyone's look.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { decodeKit, KIT_LIMITS } from '../../shared/char-kit.js';
import { isCustomChar } from '../../shared/appearance.js';

/** The bake's own version, part of a character's name: a better bake (2: the trunk keeps its own posture; 3: its face
 *  tagged for its motion — tools/chars/face-tags.mjs; 4: its light — ambient occlusion, each material's finish — 2026-11-19)
 *  makes the same kit a new character, baked again the next time it is saved — never the old files changed under a
 *  browser that keeps them for good. */
const BAKE = 'bake:4';
export class CharacterError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }

export class BuiltCharacters {
  /** minFreeBytes: no new character once the data folder's disk has less room than this (each is ~20 MB, kept for good).
   *  @param {{ data: string, root: string, log?: { info, error }, timeoutMs?: number, maxQueue?: number, minFreeBytes?: number }} o */
  constructor({ data, root, log = console, timeoutMs = 180000, maxQueue = 6, minFreeBytes = 512 * 1024 * 1024 }) {
    this.dir = path.join(data, 'chars');
    this.tool = path.join(root, 'tools/chars/custom-kind.mjs');
    this.root = root; this.log = log; this.timeoutMs = timeoutMs; this.maxQueue = maxQueue; this.minFreeBytes = minFreeBytes;
    this.today = new Map();   // account → { day (UTC), n }: new characters baked for it today (the daily limit; not kept across restarts)
    this.pending = new Map();   // id → promise of its bake
    this.queue = []; this.running = 0;
    fs.mkdirSync(this.dir, { recursive: true });
  }
  /** Whether character id has been baked (its manifest is written last). */
  has(id) { return isCustomChar(id) && fs.existsSync(path.join(this.dir, id + '.json')); }
  /** Its preset (to open it in the builder again), or null. */
  preset(id) { try { return isCustomChar(id) ? JSON.parse(fs.readFileSync(path.join(this.dir, id + '.preset.json'), 'utf8')) : null; } catch { return null; } }
  /** How many new characters `account` had baked today (UTC). */
  bakedToday(account) { const t = this.today.get(String(account)); return t && t.day === new Date().toISOString().slice(0, 10) ? t.n : 0; }
  /** Room left on the data folder's disk (bytes), or Infinity when it can't be told. */
  freeBytes() { try { const f = fs.statfsSync(this.dir); return f.bavail * f.bsize; } catch { return Infinity; } }
  /**
   * Bakes a kit (bytes) unless that character exists already. → { id, baked: boolean (now), ms }. Throws CharacterError:
   * 400 (not a kit), 429 (the account's new characters for today used up: limit.account, limit.perDay — 0 or none: no
   * limit), 503 (too many waiting), 507 (no room left on the server's disk), 500 (the bake failed). A character already
   * built (the same look) is never counted or refused.
   */
  async bake(buf, who = '', limit = null) {
    if (!buf?.length || buf.length > KIT_LIMITS.bytes) throw new CharacterError(413, 'too_large', 'That character is too big to bake');
    try { decodeKit(buf); } catch (e) { throw new CharacterError(400, 'bad_kit', `Not a character kit (${e.message})`); }
    const id = 'c_' + crypto.createHash('sha256').update(buf).update(BAKE).digest('hex').slice(0, 16);
    if (this.has(id)) return { id, baked: false, ms: 0 };
    if (this.pending.has(id)) return this.pending.get(id);
    const perDay = Math.max(0, Math.floor(Number(limit?.perDay) || 0)), account = limit?.account != null ? String(limit.account) : null;
    if (perDay && account && this.bakedToday(account) >= perDay) throw new CharacterError(429, 'daily_limit', `You have built ${perDay} new character${perDay === 1 ? '' : 's'} today, the most this world allows in a day — try again tomorrow (characters you already built can be worn any time)`);
    if (this.freeBytes() < this.minFreeBytes) { this.log.error?.(`character ${id} refused: the data disk is nearly full`); throw new CharacterError(507, 'no_room', 'The server has no room for new characters right now — tell the world\'s administrator'); }
    if (this.queue.length >= this.maxQueue) throw new CharacterError(503, 'busy', 'Characters are being baked for others — try again in a minute');
    if (perDay && account) { const day = new Date().toISOString().slice(0, 10); this.today.set(account, { day, n: this.bakedToday(account) + 1 }); }
    const job = new Promise((resolve, reject) => this.queue.push({ id, buf, who, resolve, reject }));
    this.pending.set(id, job);
    job.catch(() => {}).finally(() => this.pending.delete(id));
    this.pump();
    return job;
  }
  pump() {
    // one at a time: a bake is a few seconds of one core (a second one waits rather than slowing the world twice over)
    if (this.running || !this.queue.length) return;
    const j = this.queue.shift();
    this.running++;
    this.run(j).then(j.resolve, j.reject).finally(() => { this.running--; this.pump(); });
  }
  run({ id, buf, who }) {
    const t0 = Date.now(), tmp = path.join(os.tmpdir(), `mvw-kit-${id}-${process.pid}.bin`);
    fs.writeFileSync(tmp, buf);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.tool, '--kit', tmp, '--out', this.dir, '--id', id], { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', c => { out = (out + c).slice(-4000); });
      child.stderr.on('data', c => { err = (err + c).slice(-4000); });
      const timer = setTimeout(() => child.kill('SIGKILL'), this.timeoutMs);
      child.on('close', code => {
        clearTimeout(timer);
        fs.rmSync(tmp, { force: true });
        const ms = Date.now() - t0;
        if (code === 0 && this.has(id)) {
          this.log.info?.(`character ${id} baked in ${ms} ms${who ? ` for ${who}` : ''}: ${out.trim().split('\n').filter(l => /^(kit|baked)/.test(l)).join('; ')}`);
          resolve({ id, baked: true, ms });
        } else {
          this.log.error?.(`character ${id} bake failed (${code}): ${(err || out).trim().split('\n').slice(-3).join(' | ')}`);
          reject(new CharacterError(500, 'bake_failed', 'The character could not be baked'));
        }
      });
    });
  }
}

/** Its routes: POST /api/characters/bake (the kit as the body) → { id, baked, ms }; GET /api/characters/preset?id= → its preset.
 *  perDay(): new characters one person may have baked a day (the setting characters.bakesPerDay; 0: no limit);
 *  unlimited(P): whether P is not held to it (an administrator). */
export function addCharacterRoutes(router, chars, { readRaw, perDay = () => 0, unlimited = () => false }) {
  const fail = e => (e instanceof CharacterError ? { status: e.status, json: { error: e.message, code: e.code } } : (() => { throw e; })());
  router.add({ method: 'POST', path: '/api/characters/bake', cap: 'agents.profile', lock: 'edit', raw: true, handler: async ({ P, req }) => {
    let buf;
    try { buf = await readRaw(req, (await import('../../shared/char-kit.js')).KIT_LIMITS.bytes); }
    catch (e) { return { status: e.status || 400, json: { error: e.status === 413 ? 'That character is too big to bake' : 'Bad request', code: e.status === 413 ? 'too_large' : 'bad_request' } }; }
    const limit = unlimited(P) ? null : { account: P?.account?.id ?? null, perDay: perDay() };
    try { return { status: 200, json: await chars.bake(buf, P?.account?.id ? `account ${P.account.id}` : '', limit) }; }
    catch (e) { return fail(e); }
  } });
  router.add({ method: 'GET', path: '/api/characters/preset', cap: 'agents.profile', handler: ({ url }) => {
    const id = url.searchParams.get('id') || '';
    const preset = chars.preset(id);
    return preset ? { status: 200, json: { id, preset } } : { status: 404, json: { error: 'No such character', code: 'not_found' } };
  } });
}
