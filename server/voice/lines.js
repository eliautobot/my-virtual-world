// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Spoken lines (docs/features/companions.md §6; 2026-11-15, the product owner: "make sure they all have voices so users can
// hear and see them talking"): what an AI agent says out loud in the city — a line its brain wrote and the moderation let
// through (server/mind/ speak), a companion's remark — is spoken in that agent's own voice (server/voice/ speaker: its
// voice, else its owner's, else the installation's), once, on the server; every page near it hears the same audio
// (client/js/audio/voices.js: louder the nearer, by the Voices volume). The audio is kept a few minutes under an id nobody
// can guess, served to pages of this world (GET /api/voice/line).
// - Voice minutes are its owner's (the voice service meters it as the owner's request); a service that fails, a browser
//   voice (no audio to share) or a line too long: the bubble alone.
// - At most MAX_AT_ONCE lines are being made at once (the rest: the bubble alone), so a crowd can't queue up voice work.
import crypto from 'node:crypto';

export const KEEP_MS = 5 * 60000;      // how long a line's audio stays to be fetched
export const MAX_KEPT = 300;           // lines kept at most (the oldest go first)
export const MAX_AT_ONCE = 4;          // lines being made at once
export const MAX_CHARS = 280;          // a longer line is shown, not spoken
export const WAIT_MS = 7000;           // a line waits at most this long for its voice before it is shown without it

export class SpokenLines {
  /**
   * @param {object} o
   * @param {object} o.voice                 server/voice/voice.js Voice
   * @param {object} o.agents                server/agents.js Agents
   * @param {(accountId|null) => object|null} o.principalFor  the principal an agent's owner acts as
   * @param {() => boolean} o.enabled        voices in the city switched on (settings voice.cityLines)
   */
  constructor({ voice, agents, principalFor, enabled = () => true, defaultAudience = () => 'public', log = null, now = () => Date.now() }) {
    Object.assign(this, { voice, agents, principalFor, enabled, defaultAudience, log, now });
    this.kept = new Map();   // id → { audio, mime, seconds, at }
    this.making = 0;
    this.stats = { spoken: 0, skipped: 0, failed: 0, served: 0 };
  }
  /**
   * The audio for a line agent `rec` says: { id, seconds, mime } — or null (no voice for it now: the bubble alone).
   * Never rejects.
   */
  /** Who hears agent rec's voice: null (anyone near) or the account ids that may (its owner, and those it is shared with to
   *  manage) — its own choice (its Studio's Voice), else the world's (voice.cityAudience). */
  audienceOf(rec) {
    const own = rec?.voice?.audience, mode = own === 'public' || own === 'owner' ? own : this.defaultAudience();
    if (mode !== 'owner') return null;
    const ids = new Set();
    if (rec.ownerId !== null && rec.ownerId !== undefined) ids.add(Number(rec.ownerId)); else { const P = this.principalFor(null); if (P?.account) ids.add(Number(P.account.id)); }
    try { for (const s of this.agents.shares(rec.id)) if (s.kind === 'account' && s.level === 'manage') ids.add(Number(s.who)); } catch { /* its owner, at least */ }
    return ids;
  }
  async speak(rec, text) {
    try {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      if (!rec || !t || t.length > MAX_CHARS || !this.voice || !this.enabled()) { this.stats.skipped++; return null; }
      if (this.making >= MAX_AT_ONCE) { this.stats.skipped++; return null; }
      const P = this.principalFor(rec.ownerId ?? null);
      if (!P) { this.stats.skipped++; return null; }
      this.making++;
      try {
        const r = await Promise.race([this.voice.speak(P, { agent: rec.id, text: t, plain: true }), new Promise(res => setTimeout(() => res(null), WAIT_MS).unref?.())]);
        if (!r || !r.audio?.length) { this.stats.skipped++; return null; }
        const id = crypto.randomBytes(12).toString('base64url'), allow = this.audienceOf(rec);
        this.kept.set(id, { audio: r.audio, mime: r.mime, seconds: r.seconds, at: this.now(), allow });
        this.trim();
        this.stats.spoken++;
        return { id, seconds: r.seconds, mime: r.mime, allow };
      } finally { this.making--; }
    } catch (e) {
      // (use_browser: its owner's voice is the browser's — nothing to share; a failing service: the bubble alone)
      if (e?.code !== 'use_browser') { this.stats.failed++; this.log?.warn?.('[voice] a spoken line failed:', e.code || e.message); } else this.stats.skipped++;
      return null;
    }
  }
  trim() {
    const t = this.now();
    for (const [id, v] of this.kept) { if (t - v.at > KEEP_MS || this.kept.size > MAX_KEPT) this.kept.delete(id); else break; }
  }
  /** The audio of line id for principal P, or null (unknown, too old, or not one its audience includes). */
  get(id, P = null) {
    const v = this.kept.get(String(id || ''));
    if (!v || this.now() - v.at > KEEP_MS) return null;
    if (v.allow && !(P?.account && v.allow.has(Number(P.account.id)))) return null;
    this.stats.served++;
    return v;
  }
}

/** GET /api/voice/line?id= — a public line's audio (the 'say' event names it): any page of this world may play it, for
 *  a few minutes. lines: () => SpokenLines|null. */
export function addLineRoute(router, lines) {
  router.add({ method: 'GET', path: '/api/voice/line', cap: 'world.view', handler: ({ url, P }) => {
    const v = lines()?.get(url.searchParams.get('id'), P);   // (an owner-only voice: its owner and managers alone)
    if (!v) return { status: 404, json: { error: 'That line is no longer here', code: 'not_found' } };
    return { status: 200, pre: { body: v.audio }, headers: { 'content-type': v.mime, 'cache-control': 'private, max-age=300' } };
  } });
}
