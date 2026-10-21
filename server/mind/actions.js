// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a thought may do (docs/features/FREE-WILL.md §3): the model's answer is one JSON object; this reads it, keeps only
// what is allowed for that kind of thought and that agent, and carries it out through the agent's life
// (server/agent-life/life.js) as the Mind — the same checks as the owner's own changes (plan and memory limits, traits
// the owner locked stay as they are). Anything unknown, too long or out of range is left out, never guessed at; an answer
// that is not a JSON object does nothing.
//   plan:    plans for today (2–4), plans dropped, a thought
//   reflect: memories of the day (≤3 short, ≤1 long), plans done or dropped, notes on people it knows (≤2), one trait
//            nudged a little (not a locked one), rarely a new hope, a thought
//   chat:    the reply; from its owner also plans (≤2, written as its owner's: it asked); short memories (≤2)
//   problem: plans for today that deal with it (≤2), a short memory (≤1), a word to its owner, a thought (its money
//            actions were taken by its tools, ./tools.js, before this answer)
//   speech:  one line to say out loud, nothing else (./speech.js checks it, then the moderation service)
// A plan its owner asked for (by hand or in a chat) may be marked done, never dropped by the agent.
import { TRAIT_KEYS } from '../agent-life/traits.js';

export const LIMITS = Object.freeze({
  plan: { plans: 4, short: 0, long: 0, people: 0 },
  reflect: { plans: 0, short: 3, long: 1, people: 2 },
  chat: { plans: 2, short: 2, long: 0, people: 0 },
  problem: { plans: 2, short: 1, long: 0, people: 0 },
  speech: { plans: 0, short: 0, long: 0, people: 0 },
  friend: { plans: 0, short: 1, long: 0, people: 0 },   // (a friend's message: a reply, or none to end the conversation)
});
export const NUDGE = 0.05;              // how far one reflection moves a trait
const MAX_ASPIRATIONS = 5;

// (the quote marks the prompt puts round names are the prompt's, not part of a plan: dropped)
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const text = (v, min, max) => (typeof v === 'string' && clean(v, max).length >= min ? clean(v, max) : null);

/** The JSON object in a model's answer (a code fence or words around it are tolerated), or null. */
export function parseAnswer(raw) {
  let s = String(raw || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(s.slice(a, b + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

/**
 * The actions an answer asks for, checked: { plans, done, drop, memories, people, trait, aspiration, thought, reply }.
 * ctx = { plans: [{ id, text }] open plans, people: [{ name, kind, id }] the people it knows, traits, locked,
 * aspirations, isOwner } (chat: plans only from the owner).
 */
export function readActions(kind, o, ctx) {
  const lim = LIMITS[kind];
  const out = { plans: [], done: [], drop: [], memories: [], people: [], trait: null, aspiration: null, thought: null, reply: null, tellOwner: null, say: null, unfriend: null, start: null };
  if (!o || !lim) return out;
  const open = new Map((ctx.plans || []).map(p => [p.id, p]));
  const have = new Set((ctx.plans || []).map(p => p.text.toLowerCase()));
  const maxPlans = kind === 'chat' && !ctx.isOwner ? 0 : lim.plans;
  for (const p of Array.isArray(o.plans) ? o.plans : []) {
    if (out.plans.length >= maxPlans) break;
    const t = p && text(p.text, 3, 140);
    if (!t || have.has(t.toLowerCase())) continue;
    have.add(t.toLowerCase());
    out.plans.push({ kind: p.kind === 'must' ? 'must' : 'want', text: t });
  }
  const ids = v => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && open.has(n)))];
  // (what its owner asked for is done or stays open: the agent never drops it by itself)
  if (kind === 'plan' || kind === 'reflect') { out.done = kind === 'reflect' ? ids(o.done) : []; out.drop = ids(o.drop).filter(n => !out.done.includes(n) && !open.get(n).asked); }
  let short = 0, long = 0;
  for (const m of Array.isArray(o.memories) ? o.memories : []) {
    const t = m && text(m.text, 3, 240);
    if (!t) continue;
    const term = m.term === 'long' && kind === 'reflect' ? 'long' : 'short';
    if (term === 'long' ? long >= lim.long : short >= lim.short) continue;
    if (term === 'long') long++; else short++;
    const imp = Number.isInteger(m.importance) && m.importance >= 1 && m.importance <= 5 ? m.importance : term === 'long' ? 4 : 2;
    out.memories.push({ term, text: t, importance: imp });
  }
  if (lim.people) {
    const byName = new Map((ctx.people || []).map(p => [p.name.toLowerCase(), p]));
    for (const p of Array.isArray(o.people) ? o.people : []) {
      if (out.people.length >= lim.people) break;
      const who = p && typeof p.name === 'string' ? byName.get(clean(p.name, 60).toLowerCase()) : null;
      const note = p && text(p.note, 3, 140);
      if (who && note && !out.people.some(x => x.id === who.id && x.kind === who.kind)) out.people.push({ kind: who.kind, id: who.id, name: who.name, note });
    }
  }
  if (kind === 'reflect' && o.character && typeof o.character === 'object' && !Array.isArray(o.character)) {
    const [k, v] = Object.entries(o.character)[0] || [];
    if (k && TRAIT_KEYS.includes(k) && !(ctx.locked || []).includes(k) && (v === 'up' || v === 'down')) out.trait = { key: k, dir: v === 'up' ? 1 : -1 };
  }
  if (kind === 'reflect' && !(ctx.locked || []).includes('aspirations') && (ctx.aspirations || []).length < MAX_ASPIRATIONS) {
    const t = text(o.aspiration, 3, 140);
    if (t && !(ctx.aspirations || []).some(x => x.toLowerCase() === t.toLowerCase())) out.aspiration = t;
  }
  out.thought = text(o.thought, 2, 200);
  if (kind === 'chat') out.reply = text(o.reply, 1, 1500);
  // (its checks — length, links, moderation — are the friends' messages', server/agent-social/: a longer one is refused there)
  // its morning plan may start one message and one invitation with a friend it can reach (server/agent-social/ checks
  // and counts them); only names and places it was given count
  if (kind === 'plan' && ctx.reach) {
    const friend = n => (typeof n === 'string' ? ctx.reach.friends.find(f => f.name.toLowerCase() === clean(n, 60).toLowerCase()) : null);
    const m = o.message && typeof o.message === 'object' ? o.message : null, iv = o.invite && typeof o.invite === 'object' ? o.invite : null;
    const start = {};
    if (ctx.reach.messages > 0 && m && friend(m.to) && text(m.text, 2, 1000)) start.message = { to: friend(m.to).name, text: String(m.text).slice(0, 1000) };
    const place = iv && typeof iv.place === 'string' ? (ctx.places || []).find(p => p.name.toLowerCase() === clean(iv.place, 80).toLowerCase()) : null;
    if (ctx.reach.invites > 0 && iv && friend(iv.to) && place && typeof iv.at === 'string') {
      start.invite = { to: friend(iv.to).name, place: place.name, at: clean(iv.at, 20), minutes: Number.isFinite(Number(iv.minutes)) ? Math.round(Number(iv.minutes)) : null };
    }
    if (start.message || start.invite) out.start = start;
  }
  if (kind === 'friend') out.reply = typeof o.reply === 'string' && o.reply.trim() ? String(o.reply).slice(0, (ctx.maxReply || 280) * 2) : null;
  // an evening's reflection may end one friendship with an agent it knows (by name, from PEOPLE I KNOW)
  if (kind === 'reflect' && typeof o.unfriend === 'string' && o.unfriend.trim()) {
    const who = (ctx.people || []).find(p => p.kind === 'agent' && p.name.toLowerCase() === clean(o.unfriend, 60).toLowerCase());
    if (who) out.unfriend = who.name;
  }
  if (kind === 'problem') out.tellOwner = text(o.tell_owner, 3, 300);
  if (kind === 'speech') out.say = typeof o.say === 'string' ? String(o.say).slice(0, 400) : null;   // (its checks are the voice's)
  return out;
}

/**
 * Carries the actions out for agent `agentId` through its life; returns what was done (for the record of thoughts and
 * the chat's tool lines): { plans, done, dropped, memories, people, trait, aspiration, thought, skipped }.
 */
export function applyActions(life, agentId, act, ctx) {
  const done = { plans: [], done: [], dropped: [], memories: [], people: [], trait: null, aspiration: null, thought: act.thought || null, skipped: [] };
  const byId = new Map((ctx.plans || []).map(p => [p.id, p]));
  const step = (what, fn) => { try { fn(); return true; } catch (e) { done.skipped.push(`${what}: ${e.code || e.message}`); return false; } };
  for (const id of act.done) if (step('done', () => life.setIntention(agentId, id, 'done'))) done.done.push(byId.get(id).text);
  for (const id of act.drop) if (step('drop', () => life.setIntention(agentId, id, 'dropped'))) done.dropped.push(byId.get(id).text);
  for (const p of act.plans) if (step('plan', () => life.addIntention(agentId, { kind: p.kind, text: p.text, today: true }, ctx.source || 'mind'))) done.plans.push(`${p.kind === 'must' ? 'must' : 'want'}: ${p.text}`);
  for (const m of act.memories) if (step('memory', () => life.addMemory(agentId, { term: m.term, kind: m.term === 'long' ? 'lesson' : 'event', text: m.text, importance: m.importance }, ctx.memorySource || 'mind'))) done.memories.push(`${m.term}: ${m.text}`);
  for (const p of act.people) if (step('person', () => life.noteRelation(agentId, p.kind, p.id, p.note))) done.people.push(`${p.name}: ${p.note}`);
  const actor = { id: null, name: 'Mind' };
  if (act.trait) {
    const cur = Number(ctx.traits?.[act.trait.key]);
    if (Number.isFinite(cur)) {
      const v = Math.max(0, Math.min(1, Math.round((cur + act.trait.dir * NUDGE) * 100) / 100));
      if (v !== cur && step('trait', () => life.setProfile(agentId, { traits: { [act.trait.key]: v } }, actor))) done.trait = `${act.trait.key} ${act.trait.dir > 0 ? 'up' : 'down'} to ${v.toFixed(2)}`;
    }
  }
  if (act.aspiration && step('aspiration', () => life.setProfile(agentId, { aspirations: [...(ctx.aspirations || []), act.aspiration] }, actor))) done.aspiration = act.aspiration;
  return done;
}
