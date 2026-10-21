// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice (docs/features/CHAT.md §9.2): who hears and who speaks with which voice service, for whom, at whose cost. The
// calls themselves are the provider helper's (server/providers/voice.js); this decides and keeps count:
// - Speaking (read aloud, voice mode) in an agent's voice: the agent's own choice (a voice service and a voice, set by
//   whoever manages it), else its owner's default, else the installation's (Settings: voice.speakConnection), else the
//   browser's own voice. Whichever service speaks for it, an agent has a voice of its own on it (2026-10-08: "every
//   agent a unique voice, not just the default"): the one chosen for it in its Agent Studio, else one picked for it the
//   first time it speaks there — of its character's gender and its owner's language, the least used by the other agents
//   on that service — and kept (agents.voice_json voices/auto). An owner may turn that off (Settings → Voice: every
//   agent its own voice) to have them all speak with the owner's voice. Listening (dictation, voice mode) for a person: their own choice, else the installation's
//   (voice.listenConnection), else the browser's recognition. "browser" may also be chosen outright.
// - A service is someone's own (an account connection: its owner pays the provider) or the installation's (an
//   installation connection): metered against a daily safety limit for the whole installation (voice.dailyUsd). When the
//   installation's voice can't be used (the day's limit, switched off) the answer says to use the browser's voice instead, with the text to read: a conversation is never cut off.
// - Bounded: requests a minute per account (voice.perMinute), 32 calls at once for the whole server (others wait in line
//   up to 20 s), 4,000 characters a call (a long answer is read in parts), recordings of at most 25 MB and 5 minutes.
// - A spoken text is made pronounceable from the Markdown first (server/voice/text.js); the same audio asked again (a
//   replay) comes from a small cache and is not paid twice.
import crypto from 'node:crypto';
import { VOICE_PROVIDERS } from '../providers/manifest.js';
import { speakable } from './text.js';
import { sniff, seconds as audioSeconds } from './audio.js';
import { pieces } from '../providers/voice.js';

export class VoiceError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}

export const MAX_CHARS = 4000;              // characters spoken a call
export const MAX_AUDIO_BYTES = 25 * 1048576; // a recording
export const MAX_AUDIO_SECONDS = 300;        // … and its length
const MAX_AT_ONCE = 32;
const WAIT_MS = 20000;
const CACHE_ITEMS = 128, CACHE_BYTES = 64 * 1048576;
const VOICES_TTL = 10 * 60 * 1000;
const CHARS_PER_SECOND = 15;                 // (≈ 900 characters a minute spoken, when the audio's length can't be read)
/** The most bytes a second of a recording takes: uncompressed 48 kHz stereo 32-bit; compressed 384 kbit/s (a browser
 *  records speech at 48–128). */
const MAX_BYTES_PER_SECOND = { wav: 384000, flac: 384000, compressed: 48000 };
const LANG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/;
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const dayOf = t => new Date(t).toISOString().slice(0, 10);

/** Checks a voice choice { connection, voice, model, speed, instructions, browserVoice, language } — a partial patch. */
function checkChoice(b, { listen = false } = {}) {
  const out = {};
  if (b.connection !== undefined) {
    if (b.connection === null || b.connection === '' || b.connection === 'auto') out.connection = null;
    else if (b.connection === 'browser') out.connection = 'browser';
    else if (Number.isInteger(Number(b.connection)) && Number(b.connection) > 0) out.connection = Number(b.connection);
    else throw new VoiceError(400, 'bad_connection', 'Choose a voice service, automatic, or the browser\'s voice');
  }
  for (const [k, n] of [['voice', 200], ['model', 200], ['browserVoice', 120]]) {
    if (b[k] === undefined) continue;
    const v = cleanText(b[k], n);
    if (k === 'model' && v && /[\s\\]/.test(v)) throw new VoiceError(400, 'bad_model', 'That is not a model name');
    if (k === 'voice' && v && /[/?#\\]/.test(v)) throw new VoiceError(400, 'bad_voice', 'That is not a voice name');
    out[k] = v;
  }
  if (b.speed !== undefined) {
    const s = Number(b.speed);
    if (!Number.isFinite(s) || s < 0.5 || s > 2) throw new VoiceError(400, 'bad_speed', 'The speed is from 0.5 to 2');
    out.speed = Math.round(s * 100) / 100;
  }
  if (b.instructions !== undefined && !listen) out.instructions = cleanText(b.instructions, 500);
  if (b.unique !== undefined && !listen) out.unique = b.unique !== false;
  if (b.language !== undefined) {
    const l = String(b.language || '').trim();
    if (l && !LANG.test(l)) throw new VoiceError(400, 'bad_language', 'A language is a code like en or en-US');
    out.language = l;
  }
  return out;
}

export class Voice {
  /**
   * @param {object} o
   * @param {{ db, worldId }} o.dbs
   * @param {object} o.agents, o.connections, o.registry
   * @param {{ call: Function }} o.host               the provider helper
   * @param {object|null} o.chat                      the chat contract (a message to read aloud: need, transcripts)
   * @param {(ownerId) => object|null} o.principalFor an agent's owner as a principal (its connections' rights)
   * @param {() => object} o.config                   { enabled, listenConnection, speakConnection, perMinute, dailyUsd }
   */
  constructor({ dbs, agents, connections, registry, host, chat = null, principalFor, config, bodyOf = () => null, log = null, now = () => Date.now() }) {
    Object.assign(this, { dbs, agents, connections, registry, host, chat, principalFor, configFn: config, bodyOf, log, now });
    this.w = dbs.worldId;
    const db = dbs.db;
    this.q = {
      prefs: db.prepare('SELECT prefs_json FROM voice_prefs WHERE world_id = ? AND account_id = ?'),
      putPrefs: db.prepare(`INSERT INTO voice_prefs (world_id, account_id, prefs_json, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT (world_id, account_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated = excluded.updated`),
    };
    this.minute = new Map();       // accountId → timestamps of its requests in the last minute
    this.inFlight = 0; this.line = [];
    this.cache = new Map(); this.cacheBytes = 0;
    this.making = new Map();       // the same audio's key → the call making it (a second request waits for it)
    this.voiceLists = new Map();   // `${connection}:${updated}:${lang}` → { at, value }
    this.picking = new Map();      // connection → the voice being picked for an agent there (one at a time per service)
    this.day = { day: dayOf(this.now()), micro: 0, calls: 0, seconds: 0, cached: 0, failed: 0, browser: 0, bySource: {} };
  }
  config() {
    const c = this.configFn() || {};
    return { enabled: c.enabled !== false, listenConnection: c.listenConnection || '', speakConnection: c.speakConnection || '',
      perMinute: Number(c.perMinute) || 60, dailyUsd: Number(c.dailyUsd) || 20 };
  }

  // ------------------------------------------------------------------------------------------- preferences
  /** An account's own voice choices: { listen: { connection, model, language }, speak: { connection, voice, model, speed, instructions }, browserVoice }. */
  prefs(accountId) {
    let p = {};
    try { p = JSON.parse(this.q.prefs.get(this.w, Number(accountId))?.prefs_json || '{}') || {}; } catch { p = {}; }
    return { listen: { connection: null, model: '', language: '', ...(p.listen || {}) }, speak: { connection: null, voice: '', model: '', speed: 1, instructions: '', unique: true, ...(p.speak || {}) }, browserVoice: p.browserVoice || '' };
  }
  setPrefs(P, body = {}) {
    const me = this.me(P), cur = this.prefs(me);
    const next = { listen: { ...cur.listen }, speak: { ...cur.speak }, browserVoice: cur.browserVoice };
    if (body.listen && typeof body.listen === 'object') {
      const x = checkChoice(body.listen, { listen: true });
      if (typeof x.connection === 'number') this.usable(P, x.connection, 'listen');
      Object.assign(next.listen, x);
    }
    if (body.speak && typeof body.speak === 'object') {
      const x = checkChoice(body.speak);
      if (typeof x.connection === 'number') this.usable(P, x.connection, 'speak');
      Object.assign(next.speak, x);
    }
    if (body.browserVoice !== undefined) next.browserVoice = checkChoice({ browserVoice: body.browserVoice }).browserVoice;
    this.q.putPrefs.run(this.w, me, JSON.stringify(next), this.now());
    return this.prefs(me);
  }
  /** An agent's own voice (kept with the agent): { connection, voice, model, speed, instructions, browserVoice, voices,
   *  auto } — voices: its voice on each service by its id (chosen in the Studio, or picked for it: auto, with the gender
   *  it was picked for). */
  agentVoice(a) {
    const v = a && a.voice && typeof a.voice === 'object' ? a.voice : {};
    const map = o => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k, x]) => /^\d{1,9}$/.test(k) && typeof x === 'string' && x).slice(0, 50)) : {});
    return { connection: v.connection ?? null, voice: v.voice || '', model: v.model || '', speed: Number(v.speed) || 1, instructions: v.instructions || '', browserVoice: v.browserVoice || '',
      voices: map(v.voices), auto: map(v.auto) };
  }
  /** The voice chosen for an agent on this service (in its Studio), or '' (none chosen: one is picked for it). */
  chosenVoice(av, c) {
    const k = String(c.id);
    if (av.voices[k] && !av.auto[k]) return av.voices[k];
    return av.connection === c.id ? av.voice : '';
  }
  /** Changes an agent's voice (whoever manages it); the service must be one its owner may use. */
  setAgentVoice(P, agentId, body = {}, actor = null) {
    const a = this.managed(P, agentId);
    const x = checkChoice(body);
    if (typeof x.connection === 'number') {
      const owner = this.ownerPrincipal(a);
      const c = this.connections.get(x.connection);
      if (!c || !owner || !this.canUse(owner, c, 'speak') || !this.canUse(P, c, 'speak')) throw new VoiceError(404, 'not_found', 'No such voice service');
      this.check(c, 'speak');
    }
    const cur = this.agentVoice(a), next = { ...cur, ...x };
    delete next.unique;
    if (body.for !== undefined && body.for !== null && body.for !== '') {
      // its voice on one service — whichever speaks for it (its own, its owner's or the installation's); '' lets one be
      // picked for it again
      const fid = Number(body.for), c = Number.isInteger(fid) && fid > 0 ? this.connections.get(fid) : null, owner = this.ownerPrincipal(a);
      if (!c || !owner || !this.canUse(owner, c, 'speak') || !this.canUse(P, c, 'speak')) throw new VoiceError(404, 'not_found', 'No such voice service');
      this.check(c, 'speak');
      const voices = { ...cur.voices }, auto = { ...cur.auto };
      if (x.voice) voices[fid] = x.voice; else delete voices[fid];
      delete auto[fid];
      Object.assign(next, { voices, auto, voice: cur.connection === fid ? (x.voice || '') : cur.voice });
    }
    this.agents.update(a.id, { voice: next }, actor);
    return this.agentVoice(this.agents.get(a.id));
  }
  /** Which voices an agent's character suits: 'female', 'male' or null (no body, or not known). */
  genderOf(agent) { try { const b = this.bodyOf(agent); return b && typeof b.fem === 'boolean' ? (b.fem ? 'female' : 'male') : null; } catch { return null; } }
  /** A service's voices for the server's own use (the pickers' list, kept a few minutes; [] when it can't say). */
  async voiceList(c) {
    const k = `${c.id}:${c.updated}:`, hit = this.voiceLists.get(k);
    if (hit && this.now() - hit.at < VOICES_TTL) return hit.value.voices;
    const r = await this.call(c, 'voices', {}, 20000);
    const value = { connection: c.id, voices: Array.isArray(r.voices) ? r.voices : [], ...(Array.isArray(r.models) ? { models: r.models } : {}) };
    this.voiceLists.set(k, { at: this.now(), value });
    if (this.voiceLists.size > 200) this.voiceLists.delete(this.voiceLists.keys().next().value);
    return value.voices;
  }
  /** The voice an agent speaks with on this service when none was chosen for it: the one picked for it before (while its
   *  character's gender is the same), else one picked now — one at a time per service, so two agents heard first
   *  together don't get the same one. '' when the service can't list its voices (its usual voice, then). */
  async autoVoice(agent, c) {
    const kept = this.keptAuto(this.agentVoice(agent), c, this.genderOf(agent));
    if (kept) return kept;
    const run = (this.picking.get(c.id) || Promise.resolve()).then(() => this.pickVoice(agent.id, c)).catch(e => { this.log?.warn?.(`[voice] picking a voice: ${e.message}`); return ''; });
    this.picking.set(c.id, run);
    try { return await run; } finally { if (this.picking.get(c.id) === run) this.picking.delete(c.id); }
  }
  keptAuto(av, c, gender) { const k = String(c.id); return av.voices[k] && av.auto[k] && av.auto[k] === (gender || 'any') ? av.voices[k] : ''; }
  async pickVoice(agentId, c) {
    const agent = this.agents.get(agentId);
    if (!agent) return '';
    const av = this.agentVoice(agent), gender = this.genderOf(agent), k = String(c.id);
    const chosen = this.chosenVoice(av, c) || this.keptAuto(av, c, gender);
    if (chosen) return chosen;
    const all = (await this.voiceList(c)).filter(v => v && v.id), list = all.some(v => !v.novelty) ? all.filter(v => !v.novelty) : all;   // (a novelty voice only when chosen)
    if (!list.length) return '';
    // in its owner's language (else English), of its character's gender where the service says
    const owner = this.ownerPrincipal(agent), lang = ((owner?.account ? this.prefs(owner.account.id).listen.language : '') || 'en').slice(0, 2).toLowerCase();
    const inLang = list.filter(v => !v.lang || String(v.lang).toLowerCase().startsWith(lang)), base = inLang.length ? inLang : list;
    const ofGender = gender ? base.filter(v => v.gender === gender) : [];
    const pool = ofGender.length ? ofGender : base.filter(v => !gender || !v.gender || v.gender === gender).length ? base.filter(v => !gender || !v.gender || v.gender === gender) : base;
    // the least used by the other agents on this service; among those, one by the agent's own number (spread, stable)
    const used = new Map();
    for (const o of this.agents.list()) {
      if (o.id === agent.id) continue;
      const ov = this.agentVoice(o), v = ov.voices[k] || (ov.connection === c.id ? ov.voice : '');
      if (v) used.set(v, (used.get(v) || 0) + 1);
    }
    const least = Math.min(...pool.map(v => used.get(v.id) || 0)), free = pool.filter(v => (used.get(v.id) || 0) === least);
    const h = crypto.createHash('sha256').update(String(agent.key || agent.id)).digest().readUInt32BE(0);
    const voice = free[h % free.length].id;
    this.agents.update(agent.id, { voice: { ...av, voices: { ...av.voices, [k]: voice }, auto: { ...av.auto, [k]: gender || 'any' } } }, null);
    return voice;
  }

  // ------------------------------------------------------------------------------------------- who
  me(P) { if (!P || !P.account) throw new VoiceError(401, 'signin_required', 'Sign in first'); return Number(P.account.id); }
  agentFor(P, id) {
    const a = this.agents.get(Number(id));
    if (!a || !a.enabled || !this.agents.canUse(P, a)) throw new VoiceError(404, 'not_found', 'No such agent');
    return a;
  }
  managed(P, id) {
    const a = this.agents.get(Number(id));
    if (!a || !a.enabled || !(this.agents.isOwner(P, a) || this.agents.canManage(P, a))) throw new VoiceError(404, 'not_found', 'No such agent');
    return a;
  }
  ownerPrincipal(a) { return this.principalFor(a.ownerId ?? null); }
  /** Whether a connection is a working voice service that can do this ('speak' | 'listen'); throws why not. */
  check(c, what) {
    if (!c || c.kind !== 'voice') throw new VoiceError(400, 'not_voice', 'That connection is not a voice service');
    const def = VOICE_PROVIDERS[c.config.provider || 'openai'];
    if (!def || !def[what]) throw new VoiceError(400, 'cannot', `${def ? def.label : 'That service'} can't ${what === 'speak' ? 'speak' : 'listen'}`);
    if (!c.enabled) throw new VoiceError(409, 'disabled', 'That voice service is switched off');
    if (!this.registry.implemented('voice')) throw new VoiceError(503, 'unavailable', 'Voice services are not available right now');
    return def;
  }
  /** Whether a principal may use a voice service for this: its own or shared with it — or the installation's service for
   *  it (Settings: voice.listenConnection / voice.speakConnection), which is everyone's (metered on the platform). */
  canUse(P, c, what) {
    if (!c || c.kind !== 'voice' || !P || !P.account) return false;
    if (this.connections.canUse(P, c)) return true;
    const inst = this.installation(what);
    return !!inst && inst.id === c.id;
  }
  /** A voice service this principal may use for this; else a 404 that confirms nothing. */
  usable(P, id, what) {
    const c = this.connections.get(id);
    if (!this.canUse(P, c, what)) throw new VoiceError(404, 'not_found', 'No such voice service');
    this.check(c, what);
    return c;
  }
  /** A connection, if it works for this now (no throw). */
  works(c, what) { try { this.check(c, what); return true; } catch { return false; } }
  installation(what) {
    const cfg = this.config(), id = what === 'speak' ? cfg.speakConnection : cfg.listenConnection;
    if (!cfg.enabled || !id) return null;
    const c = this.connections.get(Number(id));
    return c && c.scope === 'installation' && this.works(c, what) ? c : null;
  }
  /** Why the installation's voice can't be used for this account now (null: it can). */
  gate(accountId) {
    this.roll();
    if (this.day.micro >= this.config().dailyUsd * 1e6) return 'voice_daily';
    return null;
  }
  /** The browser instead, and why. */
  browser(reason, extra = {}) { return { source: 'browser', connection: null, reason, ...extra }; }
  /**
   * Who speaks: { source: 'agent'|'owner'|'installation'|'choice'|'browser', connection, voice, model, speed, instructions,
   * browserVoice, metered, reason? }. agent: the voice of that agent (P may use it); choice: a service and voice named
   * outright (a preview in the Studio or Settings; P must be able to use it).
   */
  speaker(P, { agent = null, choice = null } = {}) {
    const me = this.me(P);
    const av = agent ? this.agentVoice(agent) : null, mine = this.prefs(agent ? (agent.ownerId ?? this.ownerPrincipal(agent)?.account?.id ?? me) : me);
    const browserVoice = (av && av.browserVoice) || mine.browserVoice || '';
    const speed = (av && Number(av.speed) && Number(av.speed) !== 1 ? Number(av.speed) : Number(mine.speak.speed)) || 1;   // (its own, else its owner's)
    const pick = (source, c, o) => ({ source, connection: c, voice: o.voice || '', model: o.model || '', speed: Number(o.speed) || 1, instructions: o.instructions || '', browserVoice,
      metered: c.scope === 'installation' });
    const tryIt = (source, o, who) => {
      if (o.connection === 'browser') return this.browser('choice', { browserVoice, speed });
      if (typeof o.connection !== 'number') return null;
      const c = this.connections.get(o.connection);
      if (!c || !who || !this.canUse(who, c, 'speak') || !this.works(c, 'speak')) return null;   // (gone or no longer shared: the next step)
      return pick(source, c, o);
    };
    let r = null;
    if (choice) {
      const c = this.usable(P, choice.connection, 'speak');
      r = pick('choice', c, choice);
    } else if (agent) {
      const owner = this.ownerPrincipal(agent);
      r = tryIt('agent', av, owner) || tryIt('owner', mine.speak, owner);
    } else r = tryIt('owner', mine.speak, P);
    if (!r) {
      const c = this.installation('speak');
      if (!c) return this.browser('none', { browserVoice, speed });
      r = pick('installation', c, { ...(av || {}), speed, connection: c.id, ...(av && av.connection === c.id ? {} : { voice: '', model: '' }) });
    }
    if (agent && r.source !== 'browser') {
      // its own voice on this service: chosen for it, else picked for it (speak, options: autoVoice) unless its owner has
      // them all speak with the owner's voice
      const own = this.chosenVoice(av, r.connection);
      if (own) { r.voice = own; r.chosen = true; } else if (mine.speak.unique !== false) { r.auto = true; r.voice = this.keptAuto(av, r.connection, this.genderOf(agent)) || r.voice; }
    }
    if (r.source !== 'browser' && r.metered) { const why = this.gate(me); if (why) return this.browser(why, { browserVoice, speed }); }
    return r;
  }
  /** Who listens to this account: { source: 'own'|'installation'|'browser', connection, model, language, metered, reason? }. */
  listener(P) {
    const me = this.me(P), mine = this.prefs(me).listen;
    const language = mine.language || '';
    let r = null;
    if (mine.connection === 'browser') return this.browser('choice', { language });
    if (typeof mine.connection === 'number') {
      const c = this.connections.get(mine.connection);
      if (c && this.canUse(P, c, 'listen') && this.works(c, 'listen')) r = { source: 'own', connection: c, model: mine.model || '', language, metered: c.scope === 'installation' };
    }
    if (!r) {
      const c = this.installation('listen');
      if (!c) return this.browser('none', { language });
      r = { source: 'installation', connection: c, model: '', language, metered: true };
    }
    if (r.metered) { const why = this.gate(me); if (why) return this.browser(why, { language }); }
    return r;
  }

  // ------------------------------------------------------------------------------------------- limits
  roll() { const d = dayOf(this.now()); if (this.day.day !== d) this.day = { day: d, micro: 0, calls: 0, seconds: 0, cached: 0, failed: 0, browser: 0, bySource: {} }; }
  /** One more request this minute for an account, or a 429. */
  count(accountId) {
    const t = this.now(), list = (this.minute.get(accountId) || []).filter(x => t - x < 60000);
    if (list.length >= this.config().perMinute) {
      this.minute.set(accountId, list);
      throw new VoiceError(429, 'rate_limited', 'Too many voice requests this minute; wait a moment', { retryAfterMs: Math.max(500, 60000 - (t - list[0])) });
    }
    list.push(t); this.minute.set(accountId, list);
    if (this.minute.size > 5000) for (const [k, v] of this.minute) if (!v.length || t - v[v.length - 1] > 60000) this.minute.delete(k);
  }
  /** A place among the calls in flight (first come, first served), or a 503 after waiting WAIT_MS. */
  async slot() {
    if (this.inFlight < MAX_AT_ONCE && !this.line.length) { this.inFlight++; return; }
    await new Promise((resolve, reject) => {
      const w = { resolve, timer: setTimeout(() => { this.line = this.line.filter(x => x !== w); reject(new VoiceError(503, 'busy', 'The voice services are busy; try again in a moment', { fallback: 'browser' })); }, WAIT_MS) };
      w.timer.unref?.();
      this.line.push(w);
    });
  }
  free() {
    const w = this.line.shift();
    if (w) { clearTimeout(w.timer); w.resolve(); } else this.inFlight = Math.max(0, this.inFlight - 1);
  }
  /** One call to the helper, inside a slot; its failure in our words, with the browser as the way on. */
  async call(c, method, params, timeoutMs) {
    await this.slot();
    try {
      return await this.host.call('voice', method, { connectionId: String(c.id), config: c.config, secrets: this.connections.secretsFor(c.id), allowPrivate: c.scope === 'installation', ...params },
        { timeoutMs: timeoutMs + 5000 });
    } catch (e) {
      this.day.failed++;
      const status = { auth: 502, quota: 502, rate_limited: 429, bad_request: 502, unsupported: 415, timeout: 504, network: 502, blocked: 403, host_down: 503 }[e.code] || 502;
      throw new VoiceError(status, e.code || 'provider_error', String(e.message || 'The voice service failed').slice(0, 300), { fallback: 'browser', service: c.label });
    } finally { this.free(); }
  }
  meter(source, accountId, c, seconds, micro) {
    this.roll();
    this.day.calls++; this.day.seconds += seconds || 0; this.day.bySource[source] = (this.day.bySource[source] || 0) + 1;
    if (c && c.scope === 'installation') this.day.micro += micro || 0;
  }

  // ------------------------------------------------------------------------------------------- speak
  /**
   * Speaks for P: { agent?, text? | session+message (one of the account's answers), part?, connection?+voice? (a
   * preview), speed? }. Resolves { audio: Buffer, mime, seconds, source, part, parts, cached } — or throws a VoiceError
   * 409 use_browser { text, browserVoice, reason } when the browser's own voice is to read it.
   */
  async speak(P, b = {}) {
    const me = this.me(P);
    let agent = b.agent !== undefined && b.agent !== null ? this.agentFor(P, b.agent) : null;
    const spd = b.speed !== undefined && b.speed !== null ? checkChoice({ speed: b.speed }).speed : null;
    let raw;
    if (b.message !== undefined && b.message !== null) {
      // one of the account's own answers, in one of its own chats (its agent speaks it)
      if (!this.chat) throw new VoiceError(400, 'bad_request', 'No chats here');
      let m = null;
      try {
        const s = this.chat.sessions.get(me, Number(b.session));
        if (s && (!agent || s.agentId === agent.id)) {
          const found = this.chat.need(P, s.agentId, s.id);
          m = this.chat.transcripts.get(me, s.id, b.message);
          agent = found.a;
        }
      } catch { m = null; }
      if (!m || m.role !== 'assistant') throw new VoiceError(404, 'not_found', 'No such message');
      raw = m.text;
    } else raw = String(b.text ?? '');
    if (raw.length > 200000) throw new VoiceError(400, 'too_long', 'That text is too long to read');
    const text = b.plain === true ? raw.replace(/\s+/g, ' ').trim() : speakable(raw, Infinity);
    if (!text) throw new VoiceError(400, 'nothing', 'Nothing to say');
    // a long answer is read in parts of at most MAX_CHARS, cut at sentences; text sent directly is one part
    const parts = b.message !== undefined && b.message !== null ? pieces(text, MAX_CHARS) : [text];
    if (parts[0].length > MAX_CHARS) throw new VoiceError(400, 'too_long', `At most ${MAX_CHARS} characters at a time; send it in parts`);
    const part = Math.max(0, Math.min(parts.length - 1, Number.isInteger(Number(b.part)) ? Number(b.part) : 0));
    const say = parts[part];
    const choice = b.connection !== undefined && b.connection !== null && b.connection !== '' ? { connection: Number(b.connection), ...checkChoice({ voice: b.voice ?? '', model: b.model ?? '' }), speed: spd ?? 1 } : null;
    const who = this.speaker(P, { agent, choice });
    if (who.auto && agent) { const v = await this.autoVoice(agent, who.connection); if (v) who.voice = v; }
    if (who.source === 'browser') {
      this.roll(); this.day.browser++;
      throw new VoiceError(409, 'use_browser', who.reason === 'choice' ? 'Read with the browser\'s voice' : this.why(who.reason), { fallback: 'browser', reason: who.reason, text: say, part, parts: parts.length, browserVoice: who.browserVoice, speed: spd ?? who.speed ?? 1 });
    }
    const speed = spd ?? who.speed;
    const c = who.connection, key = crypto.createHash('sha256').update(JSON.stringify([c.id, c.updated, who.voice, who.model, speed, who.instructions, say])).digest('base64url');
    const reused = hit => {
      this.roll(); this.day.cached++;
      return { ...hit, source: who.source, part, parts: parts.length, cached: true };
    };
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); this.cache.set(key, hit);   // (most recently used last)
      return reused(hit);
    }
    // the same audio already being made (a double tap, a replay while it is fetched): wait for it, not paid twice
    const making = this.making.get(key);
    if (making) return reused(await making);
    this.count(me);
    const p = (async () => {
      const r = await this.call(c, 'speak', { text: say, voice: who.voice || undefined, model: who.model || undefined, speed, instructions: who.instructions || undefined, language: this.prefs(me).listen.language || undefined, timeoutMs: 120000 }, 120000);
      const audio = Buffer.from(String(r.audio || ''), 'base64');
      const kind = sniff(audio);
      if (!kind) throw new VoiceError(502, 'provider_error', 'The voice service sent something that isn\'t audio', { fallback: 'browser' });
      const secs = Number.isFinite(r.seconds) && r.seconds > 0 ? r.seconds : (audioSeconds(audio, kind.format) ?? say.length / CHARS_PER_SECOND);
      const price = Number(c.config.speakPricePerMChars) > 0 ? Number(c.config.speakPricePerMChars) : (VOICE_PROVIDERS[c.config.provider || 'openai']?.speakPrice || 0);
      this.meter(who.source, me, c, secs, Math.round(say.length * price));   // (US$ per million characters = millionths of a US$ per character)
      const out = { audio, mime: kind.mime, seconds: Math.round(secs * 100) / 100, voice: r.voice || who.voice, service: c.label };
      this.remember(key, out);
      return out;
    })();
    this.making.set(key, p);
    try { return { ...(await p), source: who.source, part, parts: parts.length, cached: false }; }
    finally { this.making.delete(key); }
  }
  /** Keeps an audio for a replay (the oldest out first, within CACHE_ITEMS and CACHE_BYTES). */
  remember(key, v) {
    if (v.audio.length > CACHE_BYTES / 4) return;
    const old = this.cache.get(key);
    if (old) { this.cache.delete(key); this.cacheBytes -= old.audio.length; }   // (counted once, however often it is kept)
    this.cache.set(key, v); this.cacheBytes += v.audio.length;
    while (this.cache.size && (this.cache.size > CACHE_ITEMS || this.cacheBytes > CACHE_BYTES)) {
      const [k, first] = this.cache.entries().next().value;
      this.cache.delete(k); this.cacheBytes -= first.audio.length;
    }
  }
  why(reason) {
    return { none: 'No voice service is set up: the browser\'s own voice reads it', plan_voice: 'Your plan has no voice minutes: the browser\'s own voice reads it',
      plan_voice_allowance: 'This month\'s voice minutes are used: the browser\'s own voice reads it until the 1st (or a top-up)',
      voice_daily: 'The voice services have reached today\'s limit: the browser\'s own voice reads it', choice: 'The browser\'s own voice' }[reason] || 'The browser\'s own voice reads it';
  }

  // ------------------------------------------------------------------------------------------- transcribe
  /** Hears a recording for P: { audio: Buffer, language?, seconds? (the page's own count, only a hint) } → { text, language, seconds, source }. */
  async transcribe(P, { audio, language = null, seconds: hint = null } = {}) {
    const me = this.me(P);
    if (!Buffer.isBuffer(audio) || audio.length < 64) throw new VoiceError(400, 'nothing', 'Nothing to hear');
    if (audio.length > MAX_AUDIO_BYTES) throw new VoiceError(413, 'too_large', 'A recording may be at most 25 MB');
    const kind = sniff(audio);
    if (!kind) throw new VoiceError(415, 'unsupported', 'That recording\'s format isn\'t one a voice service takes (WebM, Ogg, MP4, WAV, MP3 or FLAC)');
    // how long it is: read from the file — never less than its size allows at the highest rate a recording of its kind
    // has (a header may say less than the file holds, to pay less); where its container doesn't say, the page's count
    // within what the size allows
    const read = audioSeconds(audio, kind.format);
    const measured = read === null ? null : Math.max(read, audio.length / (MAX_BYTES_PER_SECOND[kind.format] || MAX_BYTES_PER_SECOND.compressed));
    const h = Number(hint);
    const est = measured ?? (Number.isFinite(h) && h > 0 ? Math.min(Math.max(h, audio.length / 48000), audio.length / 1000) : audio.length / 4000);
    if (est > MAX_AUDIO_SECONDS + 1) throw new VoiceError(413, 'too_long', 'A recording may be at most 5 minutes');
    const lang = language !== null && language !== undefined && String(language).trim() ? String(language).trim() : null;
    if (lang && !LANG.test(lang)) throw new VoiceError(400, 'bad_language', 'A language is a code like en or en-US');
    const who = this.listener(P);
    if (who.source === 'browser') {
      this.roll(); this.day.browser++;
      throw new VoiceError(409, 'use_browser', who.reason === 'choice' ? 'Listen with the browser' : this.why(who.reason).replace('reads it', 'listens'), { fallback: 'browser', reason: who.reason, language: who.language });
    }
    this.count(me);
    const c = who.connection;
    const r = await this.call(c, 'transcribe', { audio: audio.toString('base64'), language: lang || who.language || undefined, model: who.model || undefined, timeoutMs: 90000 }, 90000);
    const secs = Number.isFinite(r.seconds) && r.seconds > 0 ? r.seconds : est;
    const price = Number(c.config.listenPricePerMinute) > 0 ? Number(c.config.listenPricePerMinute) : (VOICE_PROVIDERS[c.config.provider || 'openai']?.listenPrice || 0);
    const micro = Number.isFinite(r.costUsd) && r.costUsd >= 0 ? Math.round(r.costUsd * 1e6) : Math.round(secs / 60 * price * 1e6);
    this.meter(who.source, me, c, secs, micro);
    return { text: String(r.text || ''), language: r.language || lang || who.language || null, seconds: Math.round(secs * 100) / 100, source: who.source, service: c.label };
  }

  // ------------------------------------------------------------------------------------------- what an account sees
  /** A voice service's voices (for the pickers), kept a few minutes. */
  async voices(P, connectionId, language = '') {
    const c = this.usable(P, Number(connectionId), 'speak');
    const lang = LANG.test(String(language || '')) ? String(language) : '';
    const k = `${c.id}:${c.updated}:${lang}`, hit = this.voiceLists.get(k);
    if (hit && this.now() - hit.at < VOICES_TTL) return hit.value;
    this.count(this.me(P));
    const r = await this.call(c, 'voices', { language: lang || undefined }, 20000);
    const value = { connection: c.id, voices: Array.isArray(r.voices) ? r.voices : [], ...(Array.isArray(r.models) ? { models: r.models } : {}) };
    this.voiceLists.set(k, { at: this.now(), value });
    if (this.voiceLists.size > 200) this.voiceLists.delete(this.voiceLists.keys().next().value);
    return value;
  }
  service(c) {
    const def = VOICE_PROVIDERS[c.config.provider || 'openai'] || {};
    return { id: c.id, label: c.label, scope: c.scope, mine: c.scope === 'account', provider: c.config.provider || 'openai', service: def.label || '', speak: !!def.speak, listen: !!def.listen,
      voice: c.config.voice || def.voice || '' };
  }
  describe(r) {
    if (r.source === 'browser') return { source: 'browser', reason: r.reason, ...(r.browserVoice !== undefined ? { browserVoice: r.browserVoice } : {}), ...(r.speed !== undefined ? { speed: r.speed } : {}), ...(r.language !== undefined ? { language: r.language } : {}) };
    const s = this.service(r.connection);
    // (a voice is said only for one who speaks: who listens has none)
    return { source: r.source, service: { id: s.id, label: s.label, provider: s.provider, name: s.service, mine: s.mine }, voice: 'voice' in r ? r.voice || s.voice || undefined : undefined,
      ...(r.auto ? { auto: true } : {}), ...(r.chosen ? { chosen: true } : {}),
      ...(r.speed !== undefined ? { speed: r.speed } : {}), ...(r.language !== undefined ? { language: r.language } : {}), ...(r.browserVoice !== undefined ? { browserVoice: r.browserVoice } : {}), metered: !!r.metered };
  }
  /** What this account can use: who listens to it, who speaks for the agent (or its own default), its services, its
   *  voice minutes and the limits — the window, the Studio and Settings draw from this. */
  async options(P, agentId = null) {
    const me = this.me(P);
    const agent = agentId !== null && agentId !== undefined && agentId !== '' ? this.agentFor(P, agentId) : null;
    const speaks = this.speaker(P, { agent });
    if (speaks.auto && agent) { const v = await this.autoVoice(agent, speaks.connection); if (v) speaks.voice = v; }   // (the voice it will speak with: picked now if it had none)
    const cfg = this.config();
    const inst = { listen: this.installation('listen'), speak: this.installation('speak') };
    const seen = new Set(), services = [];
    for (const c of [...this.connections.visible(P).filter(x => x.kind === 'voice' && x.enabled), inst.speak, inst.listen]) {
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      services.push({ ...this.service(c), installation: c.id === inst.speak?.id || c.id === inst.listen?.id });
    }
    const manage = agent ? (this.agents.isOwner(P, agent) || this.agents.canManage(P, agent)) : false;
    return {
      enabled: cfg.enabled,
      listen: this.describe(this.listener(P)),
      speak: this.describe(speaks),
      ...(agent ? { agent: { id: agent.id, name: agent.name, manage, ...(manage ? { voice: this.agentVoice(this.agents.get(agent.id) || agent) } : {}) } } : {}),
      prefs: this.prefs(me),
      services,
      // (the platform's service for each by its id: a service that can do both may be the one for only one of them)
      installation: { listen: inst.listen ? this.service(inst.listen).service : null, speak: inst.speak ? this.service(inst.speak).service : null,
        listenId: inst.listen?.id ?? null, speakId: inst.speak?.id ?? null },
      limits: { maxChars: MAX_CHARS, maxSeconds: MAX_AUDIO_SECONDS, maxBytes: MAX_AUDIO_BYTES, perMinute: cfg.perMinute },
      browser: { listen: true, speak: true },
    };
  }
  /** Today's use of voice for the installation's administrators. */
  overview() {
    this.roll();
    const d = this.day, cfg = this.config();
    return { day: d.day, calls: d.calls, cached: d.cached, failed: d.failed, browser: d.browser, seconds: Math.round(d.seconds), micro: d.micro, dailyLimitMicro: cfg.dailyUsd * 1e6,
      bySource: { ...d.bySource }, inFlight: this.inFlight, waiting: this.line.length,
      installation: { listen: this.installation('listen')?.label || null, speak: this.installation('speak')?.label || null } };
  }
}
