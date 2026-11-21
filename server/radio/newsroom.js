// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio's newsroom (2026-11-16, the product owner: "the whole point of the radio station is to announce any new
// buildings around the world, especially the ones from users ... like a live radio station that promotes businesses and
// news around the world"; "they don't have to keep mentioning the same coffee shop over and over again"; City Pulse "the
// radio station module should keep track of the top ten ... anytime there's a move in the top ten, the radio host can
// announce it"; "this is what the radio station module should have ... so that when agents are working in the radio
// station they can already have that information available to them"). What every host and DJ on the air is briefed with
// before each turn (server/radio/radio.js turn()), whoever holds the job:
// - What is really new, noticed by the newsroom itself (it keeps the city's buildings: the first time it runs everything
//   standing is known, so a city is never announced as new): a building put up, a business or a notable floor opened in
//   one, a website or a billboard put up on one (rooftop billboards, its own signs inside — never the paid ads others
//   show on them — and on the online platform its City Pulse listing). A building's links that come before its story is
//   on the air go into it; later ones are a story of their own. The building as it is: its name, kind, what is inside
//   (businesses and what they sell, notable floors), where; never who owns or built it. Players' buildings first.
// - Its website, read once (the PC's reader: the public internet only, bounded in size and time, no scripts) and said in
//   a sentence or two by a brain (else the page's own title and description), kept a week; what a site says is data.
// - City Pulse (the online platform; pulse: () => the Pulse or null): its top 10, kept as the newsroom last confirmed it;
//   a move that holds PULSE_HOLD_MS is a story (into or out of the top 10, a new number one, two places or more), with
//   what brought the attention (from its counts); a week's winners; the top 10 as background.
// - What has been on the air, by station: a story is offered until a line names it, then told; told again at most
//   REMINDERS more times, at least REMIND_GAP apart, until it is STORY_DAYS old (City Pulse moves: once, PULSE_KEEP_MS);
//   the sponsor goes round (players' new businesses first, then the one read longest ago); the city's numbers (sales,
//   prices, the weather, yesterday's busiest) only until they have been said, then again when they change or a while on.
// Kept in data/radio/newsroom.json.
import fs from 'node:fs';
import path from 'node:path';
import { fetchPublic, readable, decode } from '../pc/browser.js';

export const SCAN_MS = 60e3;                  // how often the newsroom looks at the city
export const STORY_DAYS = 3;                  // a building's story is news this long
export const REMINDERS = 2;                   // told again at most this many times after the first
export const REMIND_GAP = 6 * 3600e3;         // ... at least this long after the last time
export const SITE_WAIT_MS = 10 * 60e3;        // a new story waits at most this long for its website's summary
export const SITE_KEEP_MS = 7 * 86400e3;      // a website read is kept this long
export const SITES_PER_HOUR = 20;             // websites read at most
export const PULSE_HOLD_MS = 30 * 60e3;       // a City Pulse move counts once it has held this long
export const PULSE_KEEP_MS = 6 * 3600e3;      // a City Pulse story is news this long
export const PULSE_PLACE_GAP = 4 * 3600e3;    // one City Pulse story a place in this long
const NUMBERS_GAP = 4 * 3600e3;               // the city's numbers, once said, not again for this long (unless they change)
const FRESH_MAX = 4, REMIND_MAX = 2, TOLD_MAX = 6;

const KIND_WORD = { cafe: 'café', restaurant: 'restaurant', shop: 'shop', gym: 'gym', office: 'office building', hq: 'headquarters', apartment: 'apartment building',
  park: 'park', terminal: 'terminal', hotel: 'hotel', arcade: 'arcade', lounge_bar: 'lounge bar', club: 'night club', bar: 'bar', lounge: 'lounge' };
const MOD_WORD = { studio: 'a radio studio', arcade: 'an arcade' };
const PULSE_WHY = { visits: 'people walking in', peeks: 'people looking inside', agents: 'AI agents dropping by', clicks: 'visits to its website',
  seen: 'its signs being seen', adSeen: 'its ads being seen', adOpened: 'people opening its ads', adClicks: 'clicks on its ads', locals: 'residents dropping by' };
const an = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
const ORD = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const clean = (t, n = 200) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = t => ` ${String(t ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const ago = ms => (ms < 90e3 ? 'just now' : ms < 3600e3 ? `${Math.round(ms / 60e3)} min ago` : ms < 48 * 3600e3 ? `${Math.round(ms / 3600e3)} h ago` : `${Math.round(ms / 86400e3)} days ago`);

/** Whether a line said on the air names `name` (a place's name: all of it, or most of its own words for a long one). */
export function names(text, name) {
  const t = norm(text), n = norm(name).trim();
  if (!n) return false;
  if (t.includes(` ${n} `)) return true;
  const words = n.split(' ').filter(w => w.length >= 3 && !['the', 'and', 'cafe', 'shop', 'bar'].includes(w));
  return words.length >= 2 && words.filter(w => t.includes(` ${w} `)).length / words.length >= 0.6;
}
/** A page's own words about itself: { title, description, text } (the start of its readable text). */
export function siteWords(html, base) {
  const meta = re => decode((re.exec(String(html)) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const description = meta(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']{1,600})["']/i)
    || meta(/<meta[^>]+content=["']([^"']{1,600})["'][^>]*(?:name|property)=["'](?:og:)?description["']/i);
  const r = readable(html, base);
  return { title: clean(r.title, 160), description: clean(description, 400), text: clean(r.text.replace(/\[\d+\]/g, ''), 1500) };
}

export class Newsroom {
  /**
   * @param {{ dir: string, world?: () => object|null, property?: object|null, econ?: () => object|null, pulse?: () => object|null,
   *   weather?: () => object|null, where?: (B) => string, summarize?: (site: { url, title, description, text }) => Promise<string>, fetchSite?: (url) => Promise<object>,
   *   now?: () => number, log?: Function }} o
   *   where: a building's address and town; summarize: a sentence or two about a business from its site (a brain), or
   *   null; fetchSite: reads a page (default: the PC's reader).
   */
  constructor(o) {
    Object.assign(this, { world: () => null, property: null, econ: () => null, weather: () => null, pulse: () => null, where: () => '', summarize: null, log: null, ...o });
    this.now ||= () => Date.now();
    this.fetchSite ||= async url => { const r = await fetchPublic(url, { maxBytes: 1048576, timeoutMs: 12000 }); if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}`), { code: 'http' }); return siteWords(r.buf.toString(/8859|latin/i.test(r.charset || '') ? 'latin1' : 'utf8'), r.url); };
    this.file = path.join(o.dir, 'newsroom.json');
    let s = {};
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* a new newsroom */ }
    this.s = { seeded: !!s.seeded, seq: Number(s.seq) || 0, bld: s.bld || {}, stories: Array.isArray(s.stories) ? s.stories : [], sites: s.sites || {},
      sponsor: s.sponsor || {}, numbers: s.numbers || {}, told: s.told || {}, pulse: s.pulse || { ranks: null, pending: {}, week: null, last: {} } };
    this.reading = false; this.readTimes = []; this.lastScan = 0;
  }
  save() { try { fs.writeFileSync(this.file, JSON.stringify(this.s)); } catch (e) { this.log?.warn?.('[radio] the newsroom could not be kept:', e.message); } }

  // ------------------------------------------------------------------ what the city has
  /** Building B as it is now: { key, name, kind, player, venues: [{ f, kind, name }], notable: [words], links: [{ where, website, title, message }] }. */
  look(B, W) {
    const lot = B.lot && this.property ? (() => { try { return this.property.get(B.lot); } catch { return null; } })() : null;
    const player = !!(lot?.holder && lot.holder.kind !== 'municipality');
    const venues = [], notable = [], links = [];
    const add = (where, cr) => { if (!cr) return; const website = /^https:\/\//.test(cr.website || '') ? cr.website.slice(0, 300) : ''; const title = clean(cr.title, 80), message = clean(cr.message, 160);
      if (website || title || message) links.push({ where, website, title, message }); };
    for (const s of B.roofSigns || []) add('a billboard on its roof', s.cr);
    for (let f = 0; f < (B.floors || 0); f++) {
      const L = W.levels?.[B.lv?.[f]]; if (!L) continue;
      if (L.venue && L.venue !== 'park') venues.push({ f, kind: L.venue, name: clean(L.name || B.name, 60) });
      for (const m of L.mods || []) if (MOD_WORD[m.kind]) notable.push(`${MOD_WORD[m.kind]}${m.name ? ` ("${clean(m.name, 40)}")` : ''} on the ${ORD(f + 1)} floor`);
      for (const it of L.items || []) if (it.sg?.cr && it.sg.mode !== 'ads' && !it.sg.blocked) add('a sign inside', it.sg.cr);   // (its own signs: never the paid ads others show on them)
    }
    try { const P = B.lot ? this.pulse?.()?.placeOf?.(B.lot) : null; if (P?.listing && !P.listing.hidden) add('its City Pulse listing', { website: P.listing.website, title: '', message: P.listing.tagline }); } catch { /* no Pulse */ }
    return { key: `${B.id || `b${B.idx}`}:${B.seed ?? ''}`, b: B.idx, name: clean(B.name, 60) || 'A new building', kind: B.type, player, venues, notable: notable.slice(0, 3), links: links.slice(0, 6) };
  }
  sig(x) { return { name: x.name, venues: x.venues.map(v => `${v.kind}:${v.name}`), links: x.links.map(l => l.website || `${l.title}|${l.message}`) }; }

  /** Looks at the city (at most every SCAN_MS): what is new becomes a story; City Pulse's moves too. */
  async scan({ force = false } = {}) {
    const t = this.now();
    if (!force && t - this.lastScan < SCAN_MS) return;
    this.lastScan = t;
    try { this.scanBuildings(t); } catch (e) { this.log?.warn?.('[radio] the newsroom could not look at the city:', e.message); }
    try { this.scanPulse(t); } catch (e) { this.log?.warn?.('[radio] the newsroom could not read City Pulse:', e.message); }
    this.prune(t);
    this.save();
    this.readSites().catch(() => {});
  }
  scanBuildings(t) {
    const W = this.world?.(); if (!W?.buildings) return;
    const seen = new Set(), seeding = !this.s.seeded;
    for (const B of W.buildings) {
      if (!B || B.gone) continue;
      const x = this.look(B, W), now = this.sig(x), was = this.s.bld[x.key];
      seen.add(x.key);
      this.s.bld[x.key] = { b: x.b, at: was?.at ?? t, ...now };
      if (seeding) continue;
      if (!was) { this.story({ kind: 'building', key: x.key, b: x.b, name: x.name, player: x.player, links: now.links }, t); continue; }
      const open = this.s.stories.find(s => s.key === x.key && s.kind === 'building' && !this.toldAnywhere(s));
      const newVenues = now.venues.filter(v => !was.venues.includes(v));
      const newLinks = now.links.filter(l => !was.links.includes(l));
      if (open) { open.links = now.links; continue; }   // (not on the air yet: it tells the building as it is)
      if (newVenues.length) this.story({ kind: 'opening', key: x.key, b: x.b, name: x.name, player: x.player, venues: newVenues }, t);
      if (newLinks.length) this.story({ kind: 'links', key: x.key, b: x.b, name: x.name, player: x.player, links: newLinks }, t);
    }
    if (seeding) { this.s.seeded = true; this.s.seededAt = t; this.log?.(`[radio] the newsroom knows the city: ${seen.size} buildings, none of them news`); }
    for (const k of Object.keys(this.s.bld)) if (!seen.has(k)) delete this.s.bld[k];
    this.s.stories = this.s.stories.filter(s => !s.key || seen.has(s.key));   // (a building gone: its stories too)
  }
  story(o, t) {
    // (one story of a kind a building at a time: a newer one replaces one not told yet)
    const old = this.s.stories.find(s => s.kind === o.kind && (o.kind === 'pulse' ? s.lot === o.lot : s.key === o.key) && !this.toldAnywhere(s));
    if (old) { Object.assign(old, o, { at: t }); return old; }
    const s = { id: ++this.s.seq, at: t, aired: {}, ...o };
    this.s.stories.push(s);
    this.log?.(`[radio] news: ${o.kind} (${o.key || o.lot || ''})`);
    return s;
  }
  toldAnywhere(s) { return Object.values(s.aired || {}).some(a => a.n > 0); }

  // ------------------------------------------------------------------ City Pulse
  scanPulse(t) {
    const P = this.pulse?.(); if (!P?.board || P.config?.().on === false) return;
    const b = P.board(); if (!b?.top) return;
    const S = this.s.pulse, top = b.top.slice(0, 10), now = new Map(top.map(r => [String(r.lot), r]));
    const weights = P.config?.()?.weights || {};
    this.pulseTop = top.map(r => ({ rank: r.rank, name: clean(r.name, 50) }));
    if (!S.ranks) { S.ranks = Object.fromEntries(top.map(r => [String(r.lot), r.rank])); S.week = b.awards?.[0]?.week || null; return; }   // (the first look: the board as it is, no news)
    const lots = new Set([...Object.keys(S.ranks), ...now.keys()]);
    for (const lot of lots) {
      const was = S.ranks[lot] ?? null, r = now.get(lot), rank = r?.rank ?? null;
      if (rank === was) { delete S.pending[lot]; continue; }
      const p = S.pending[lot];
      if (!p || p.rank !== rank) { S.pending[lot] = { rank, since: t, name: r?.name || p?.name || '' }; continue; }
      if (t - p.since < PULSE_HOLD_MS) continue;
      // held: the move counts
      delete S.pending[lot];
      if (rank === null) delete S.ranks[lot]; else S.ranks[lot] = rank;
      // (dropping out of the top 10 is news only from its top half: the 10th making way for a newcomer isn't)
      const move = rank === 1 && was !== 1 ? 'top' : was === null ? 'in' : rank === null ? (was <= 5 ? 'out' : null) : Math.abs(rank - was) >= 2 ? (rank < was ? 'up' : 'down') : null;
      if (!move || t - (S.last[lot] || 0) < PULSE_PLACE_GAP) continue;
      S.last[lot] = t;
      const why = r ? Object.entries(r.counts || {}).map(([k, n]) => [k, n * (weights[k] ?? 1)]).filter(([k, v]) => v > 0 && PULSE_WHY[k]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => PULSE_WHY[k]) : [];
      this.story({ kind: 'pulse', key: null, lot, move, rank, was, name: clean(r?.name || p.name, 60), why, rising: (r?.delta ?? 0) > 0, tagline: clean(r?.tagline, 120), host: r?.host || '' }, t);
    }
    const aw = b.awards || [];
    if (aw[0]?.week && aw[0].week !== S.week) {
      S.week = aw[0].week;
      const w = aw.filter(a => a.week === S.week && a.place > 0).sort((a, c) => a.place - c.place).map(a => clean(a.name, 60)).filter(Boolean);
      if (w.length) this.story({ kind: 'pulse', key: null, lot: `week:${S.week}`, move: 'award', names: w, name: w[0] }, t);
    }
  }

  // ------------------------------------------------------------------ websites
  sitesOf(s) {
    const L = s.kind === 'building' || s.kind === 'links' ? (s.links || []) : [];
    return [...new Set(L.filter(l => /^https:\/\//.test(l)))];
  }
  /** Reads the websites stories name (one at a time, at most SITES_PER_HOUR an hour), each once a week. */
  async readSites() {
    if (this.reading) return;
    this.reading = true;
    try {
      const t = this.now();
      const want = [...new Set(this.s.stories.flatMap(s => this.sitesOf(s)))].filter(u => !this.s.sites[u] || t - this.s.sites[u].at > SITE_KEEP_MS);
      for (const url of want) {
        this.readTimes = this.readTimes.filter(x => t - x < 3600e3);
        if (this.readTimes.length >= SITES_PER_HOUR) break;
        this.readTimes.push(this.now());
        let site;
        try {
          const w = await this.fetchSite(url);
          let summary = '';
          if (this.summarize) { try { summary = clean(await this.summarize({ url, ...w }), 300); } catch (e) { this.log?.warn?.(`[radio] a website could not be summed up (${hostOf(url)}): ${e.message}`); } }
          site = { at: this.now(), ok: true, title: w.title, summary: summary || clean(w.description || w.text, 260) };
        } catch (e) { site = { at: this.now(), ok: false, err: e.code || 'failed' }; this.log?.(`[radio] a website could not be read (${hostOf(url)}): ${e.code || e.message}`); }
        this.s.sites[url] = site; this.save();
      }
    } finally { this.reading = false; }
  }
  /** A story's websites have been read (or failed), or it has waited long enough. */
  ready(s, t) { const u = this.sitesOf(s); return !u.length || u.every(x => this.s.sites[x]) || t - s.at > SITE_WAIT_MS; }

  // ------------------------------------------------------------------ the briefing
  /** What a story says, as the building or the board is now (null: nothing to say any more). */
  text(s) {
    if (s.kind === 'pulse') {
      if (s.move === 'award') return `City Pulse: the week's winners are ${s.names.join(', ')} (first place ${s.names[0]}).`;
      const why = s.why?.length ? ` What brought it: ${s.why.join(' and ')}.` : '';
      const about = s.tagline ? ` It describes itself as "${s.tagline}".` : '';
      const what = { top: `${s.name} is the new number one on City Pulse, the city's ranking of players' places by the attention they get`, in: `${s.name} just made City Pulse's top 10, at number ${s.rank}`,
        out: `${s.name} dropped out of City Pulse's top 10`, up: `${s.name} climbed from number ${s.was} to number ${s.rank} on City Pulse`, down: `${s.name} slipped from number ${s.was} to number ${s.rank} on City Pulse` }[s.move];
      return `${what}.${s.move === 'out' ? '' : why}${about}`;
    }
    const W = this.world?.(), B = W?.buildings?.[s.b];
    if (!B || B.gone) return null;
    const x = this.look(B, W), where = (() => { try { return clean(this.where(B), 80); } catch { return ''; } })();
    s.name = x.name;   // (its name as it is now: told() looks for it in what was said)
    const kind = KIND_WORD[x.kind] || clean(x.kind, 30) || 'building', biz = this.econ?.()?.parts?.businesses;
    const venue = v => {
      let items = [];
      try { const b = biz?.at?.(x.b, v.f); items = (biz?.menu?.(b) || []).slice(0, 3).map(m => clean(m.name || m.label || '', 30)).filter(Boolean); } catch { /* no economy */ }
      return `${v.name === x.name ? an(KIND_WORD[v.kind] || clean(v.kind, 20)) : `"${v.name}", ${an(KIND_WORD[v.kind] || clean(v.kind, 20))}`} on the ${ORD(v.f + 1)} floor${items.length ? ` (it sells ${items.join(', ')})` : ''}`;
    };
    const links = (s.kind === 'links' ? x.links.filter(l => s.links?.includes(l.website || `${l.title}|${l.message}`)) : x.links).map(l => {
      const site = l.website ? this.s.sites[l.website] : null;
      return `${l.where}${l.title ? ` reads "${l.title}"` : ''}${l.message ? `${l.title ? ',' : ' says'} "${l.message}"` : ''}${l.website ? `, with its website ${hostOf(l.website)}${site?.ok && site.summary ? ` (its site says: ${site.summary})` : ''}` : ''}`;
    });
    const by = x.player ? ' (one of the city\'s players built it)' : '';
    if (s.kind === 'opening' && !(s.venues || []).some(sig => x.venues.some(v => `${v.kind}:${v.name}` === sig))) return null;   // (closed again before it was told)
    if (s.kind === 'links' && !links.length) return null;   // (taken down again before it was told)
    if (s.kind === 'opening') return `New at ${x.name}${where ? ` (${where})` : ''}: ${(s.venues || []).map(sig => { const [k, ...n] = sig.split(':'); const v = x.venues.find(y => y.kind === k && y.name === n.join(':')); return v ? venue(v) : null; }).filter(Boolean).join('; ') || 'a new business inside'}.`;
    if (s.kind === 'links') return `${x.name}, ${an(kind)}${where ? ` at ${where}` : ''}, has something new to show: ${links.join('; ')}.`;
    const inside = [...x.venues.slice(0, 4).map(venue), ...x.notable];
    return `Just built: ${x.name}, a new ${kind}${where ? ` at ${where}` : ''}${by}.${inside.length ? ` Inside: ${inside.join('; ')}.` : ''}${links.length ? ` On show: ${links.join('; ')}.` : ''}`;
  }
  /**
   * What station st's hosts are briefed with for a break: { lines (data for its hosts), offered (what was given, for
   * told()) } — fresh stories, a reminder or two, the sponsor in turn, the city's numbers when there is something new to
   * say, the background, and what was already told on this station lately.
   */
  briefing(st) {
    const t = this.now(), id = st.id, lines = [], offered = { stories: [], sponsor: null, numbers: [] };
    const ok = this.s.stories.map(s => ({ s, a: s.aired?.[id] || { n: 0, last: 0 } })).filter(({ s }) => this.ready(s, t));
    const pri = s => (s.kind === 'pulse' ? 2 : s.player ? 3 : 1);
    const fresh = ok.filter(({ a }) => a.n === 0).sort((x, y) => pri(y.s) - pri(x.s) || y.s.at - x.s.at).slice(0, FRESH_MAX);
    const remind = ok.filter(({ s, a }) => s.kind !== 'pulse' && a.n > 0 && a.n <= REMINDERS && t - a.last >= REMIND_GAP).sort((x, y) => x.a.last - y.a.last).slice(0, REMIND_MAX);
    const said = (s, words) => { const x = this.text(s); if (x) { lines.push(`${words}${x}`); offered.stories.push(s.id); } };
    for (const { s } of fresh) said(s, 'NEWS (not on this station yet): ');
    for (const { s, a } of remind) said(s, `Worth a reminder (told here ${ago(t - a.last)}; only if it fits, briefly): `);
    // the sponsor, in turn: players' new businesses first, then the one read longest ago
    try {
      const B = this.econ?.()?.parts?.businesses, open = B?.open?.() || [];
      if (open.length) {
        const last = this.s.sponsor[id] || {}, seenAt = this.s.seededAt || 0;
        const isNew = b => b.owner_kind !== 'municipality' && Number(b.created) > seenAt && !last[b.id];
        const pick = open.slice().sort((a, b) => (isNew(b) - isNew(a)) || ((last[a.id] || 0) - (last[b.id] || 0)) || (a.id < b.id ? -1 : 1))[0];
        const items = (B.menu?.(pick) || []).slice(0, 3).map(m => clean(m.name || m.label || '', 30)).filter(Boolean);
        lines.push(`Sponsor of this break (read it as a short ad): ${clean(pick.name, 60)}, ${an(KIND_WORD[pick.kind] || clean(pick.kind, 20))}${items.length ? ` (it sells ${items.join(', ')})` : ''}.`);
        offered.sponsor = { id: pick.id, name: pick.name };
      }
    } catch { /* the economy off */ }
    // the city's numbers: only when there is something new to say
    for (const n of this.numbers()) {
      const k = this.s.numbers[id]?.[n.topic];
      if (k && k.key === n.key) continue;   // (said already, and nothing changed)
      if (k && t - k.at < NUMBERS_GAP && n.topic !== 'weather') continue;
      if (k && n.topic === 'weather' && t - k.at < NUMBERS_GAP / 2) continue;
      lines.push(n.text); offered.numbers.push(n);
    }
    // background: what is so, to mention only when it fits
    if (this.pulseTop?.length) lines.push(`Background — City Pulse's top 10 now (players' places by the attention they get): ${this.pulseTop.map(r => `${r.rank}. ${r.name}`).join(', ')}.`);
    const told = Object.entries(this.s.told[id] || {}).filter(([, v]) => t - v.at < 12 * 3600e3).sort((a, b) => b[1].at - a[1].at).slice(0, TOLD_MAX);
    if (told.length) lines.push(`Already told on this station (don't repeat these): ${told.map(([name, v]) => `${name} (${ago(t - v.at)}${v.by ? `, by ${v.by}` : ''})`).join('; ')}.`);
    if (!fresh.length && !remind.length && !offered.numbers.length) lines.push('Nothing new on the news desk right now: talk about the music, the station, the sponsor or the background — never repeat what was already told.');
    return { lines, offered };
  }
  /** The city's numbers as they are: [{ topic, key (what they are), text }]. */
  numbers() {
    const out = [], E = this.econ?.(), B = E?.parts?.businesses;
    try {
      const prev = E?.econDay?.() - 1, S = E?.parts?.stats;
      const d1 = S?.dayValues?.(prev), d0 = S?.dayValues?.(prev - 1);
      if (d1?.sales && d0?.sales) { const pct = Math.round((d1.sales / d0.sales - 1) * 100); out.push({ topic: 'sales', key: `${prev}`, text: `Sales across the city ${pct >= 0 ? 'rose' : 'fell'} ${Math.abs(pct)}% yesterday compared with the day before (${d1.customers ?? '?'} customers).` }); }
      if (d1?.cpi && d0?.cpi) { const pct = Math.round((d1.cpi / d0.cpi - 1) * 1000) / 10; if (Math.abs(pct) >= 0.5) out.push({ topic: 'prices', key: `${prev}`, text: `Prices ${pct > 0 ? 'went up' : 'came down'} about ${Math.abs(pct)}% on the day.` }); }
      const table = prev >= 0 ? B?.table?.(prev) : null;
      if (Array.isArray(table) && table.length) { const top = table.slice().sort((a, b) => (b.sales ?? b.profit ?? 0) - (a.sales ?? a.profit ?? 0))[0], tb = B.get?.(top.b); if (tb) out.push({ topic: 'busiest', key: `${prev}:${tb.id}`, name: tb.name, text: `Yesterday's busiest business: ${clean(tb.name, 60)}, ${an(KIND_WORD[tb.kind] || clean(tb.kind, 20))}.` }); }
    } catch { /* the economy off */ }
    try { const w = this.weather?.()?.now?.(); if (w) out.push({ topic: 'weather', key: `${w.kind}:${w.rain > 0.3}`, text: `The weather now: ${clean(w.kind || 'clear', 30)}${Number.isFinite(w.wind?.speed) ? `, wind ${Math.round(w.wind.speed * 3.6)} km/h` : ''}${w.rain > 0.3 ? ', rain' : ''}.` }); } catch { /* no weather */ }
    return out;
  }
  /**
   * A break was made on station st (lines: [{ host: { name }, text }]): what it named is told — a story, the sponsor, the
   * city's numbers (sales, prices, the weather by their words; yesterday's busiest by name) — and the sponsor goes round
   * (offered, said or not).
   */
  told(st, lines, offered) {
    if (!offered) return;
    const t = this.now(), id = st.id, said = (lines || []).map(l => ({ by: l.host?.name || '', text: String(l.text || '') }));
    const who = test => said.find(l => test(l.text))?.by;
    const log = (name, by) => { (this.s.told[id] ||= {})[clean(name, 60)] = { at: t, by }; };
    for (const sid of offered.stories) {
      const s = this.s.stories.find(x => x.id === sid); if (!s) continue;
      const name = s.name, by = name ? who(x => names(x, name)) : undefined;
      if (by === undefined) continue;
      const a = s.aired[id] ||= { n: 0, last: 0 };
      a.n++; a.last = t;
      log(s.kind === 'pulse' ? `${name} on City Pulse` : name, by);
    }
    if (offered.sponsor) {
      (this.s.sponsor[id] ||= {})[offered.sponsor.id] = t;
      const by = who(x => names(x, offered.sponsor.name)); if (by !== undefined) log(`${offered.sponsor.name} (sponsor)`, by);
    }
    const WORDS = { sales: /\b(sales|spending|spent|shoppers|customers)\b/i, prices: /\bprices?\b/i, weather: /\b(weather|rain|wind|windy|sun|sunny|fog|foggy|cloud|clouds|cloudy|clear skies|storm|snow)\b/i };
    for (const n of offered.numbers) {
      const by = who(x => (n.topic === 'busiest' ? names(x, n.name) : WORDS[n.topic]?.test(x)));
      if (by === undefined) continue;
      (this.s.numbers[id] ||= {})[n.topic] = { key: n.key, at: t };
      log(n.topic === 'busiest' ? `${n.name} (yesterday's busiest)` : `the ${n.topic === 'weather' ? 'weather' : `city's ${n.topic}`}`, by);
    }
    this.save();
  }
  /** Stories past their time go: a building's after STORY_DAYS, City Pulse's after PULSE_KEEP_MS (each station tells one
   *  at most 1 + REMINDERS times meanwhile: briefing()); websites read long ago, and old "already told" notes. */
  prune(t) {
    this.s.stories = this.s.stories.filter(s => t - s.at < (s.kind === 'pulse' ? PULSE_KEEP_MS : STORY_DAYS * 86400e3));
    for (const [u, x] of Object.entries(this.s.sites)) if (t - x.at > SITE_KEEP_MS * 2) delete this.s.sites[u];
    for (const m of Object.values(this.s.told)) for (const [k, v] of Object.entries(m)) if (t - v.at > 86400e3) delete m[k];
  }
}
