// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio host's job (2026-11-16, the product owner: what radio hosts know on the air "needs to be part of the module so
// that the right context is provided regardless of what agent is the host, its more like 'job role and job duties' so its
// what the radio host job entails, so that any other agent that is assigned as a radio host still does all the right
// things"). Whoever is on the air — a host at a studio's broadcast desk, its DJ, or a station's host from Settings → Radio
// — gets the same with each turn it has in a break (server/radio/radio.js turn()), nothing set up per agent:
// - Its duties (DUTIES): what the job is.
// - Its owner's direction for its work: the instructions in its Work brief (server/agent-work/, its Studio's Work), how its
//   owner wants it to do its work — followed where they fit a live radio show, never read out.
// - Its own tasks (the product owner: "the agent just needs to have access to its tasks so that it can decide what to do
//   ... agents are meant to feel autonomous not scripted"): its open plans — the same ones its Studio's Plans, its Mind
//   and its chat have (server/agent-life/), the ones its owner asked for marked; held ones too (on duty round the clock its
//   errands wait, but what can be done from the mic can be). Given as its own, to act on as it chooses: one it does on the
//   air it marks done itself — a line "DONE: #id" that is not read on the air, kept only if its line carries the task
//   (one of its words at least) and only once the break is made; one it doesn't do stays as it is. There is nothing
//   radio-only to keep: what its owner wants said on the air ("apologize on the air for being late") is a task like any.
const TASKS_MAX = 12;   // its open tasks, as many as its Mind is given

/** What the job is (the same for whoever holds it). */
export const DUTIES = Object.freeze({
  host: Object.freeze([
    'keep the listeners company between songs, live, as yourself',
    'bring them the city\'s news from your news desk, with your own take: what is new first (new buildings and businesses, what they show and their websites, City Pulse\'s moves), and never what was already told on your station',
    'read the sponsor as a short ad when the news desk gives one',
    'do your work the way your owner wants it done (their direction), where that fits a live radio show',
    'your own tasks are yours to act on as you choose: one that can be done on the air, you may do in your line',
    'the station\'s songs are yours to look after too: off the air, in your chats, you may add songs from the city\'s music library to its playlist, take some off or change their order (your playlist tools) — keep it right for your station and its listeners',
  ]),
  dj: Object.freeze([
    'look after the music: hand over to the songs with a word about them',
    'keep the listeners company with a word between songs, as yourself',
    'do your work the way your owner wants it done (their direction), where that fits a live radio show',
    'your own tasks are yours to act on as you choose: one that can be done on the air, you may do in your line',
    'the station\'s songs are yours to look after: off the air, in your chats, you may add songs from the city\'s music library to its playlist, take some off or change their order (your playlist tools)',
  ]),
});
const DIRECTION_MAX = 1500;   // the owner's direction, as much as goes with every turn on the air

const clean = (t, n = 300) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const STOP = new Set('about after again also because been before being from have here into just like listeners more make only over said same says should some than that their them then there these they this those very what when where which while will with would your yours tell telling mention announce shout give everyone folks today tonight radio show break air must want'.split(' '));
/** The words of a task that its line should carry (4 letters or more, not the usual ones), as stems. */
const keyWords = t => [...new Set(String(t).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])].filter(w => !STOP.has(w)).map(w => w.slice(0, 5));
/** Whether a line said on the air carries a task: one of its own words at least (none to check: it does). */
export function covers(line, text) {
  const want = keyWords(text); if (!want.length) return true;
  const have = new Set((String(line).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).map(w => w.slice(0, 5)));
  return want.some(w => have.has(w));
}
/** The task numbers a host marked done after its line ("DONE: #12, #14"), taken out of what is aired: → { raw, done: [n] }.
 *  A row of its own anywhere, or at the end of its line's last row. */
export function doneOf(raw) {
  const done = new Set(), add = s => { for (const m of String(s).matchAll(/\d+/g)) done.add(Number(m[0])); };
  const rows = [];
  for (const row of String(raw ?? '').replace(/\r/g, '').split('\n')) {
    const m = row.match(/^\s*[*_]*\s*done\s*[*_]*\s*:\s*[*_]*\s*([#\d,;\s]*(?:and[#\d,;\s]*)*)[.*_\s]*$/i);
    if (m) { add(m[1]); continue; }
    rows.push(row);
  }
  for (let k = rows.length - 1; k >= 0; k--) {
    if (!rows[k].trim()) continue;
    const m = rows[k].match(/^(.*?)[\s(]*\bdone\s*:\s*([#\d,;\s]+(?:and[#\d,;\s]+)*)\)?[.\s]*$/i);
    if (m && /\d/.test(m[2])) { add(m[2]); rows[k] = m[1]; }
    break;
  }
  return { raw: rows.join('\n').trim(), done: [...done] };
}

export class HostJob {
  /**
   * @param {{ work?: () => object|null, life?: () => object|null, ownerName?: (agent) => string, log?: Function }} o
   *   work: the agents' Work briefs (server/agent-work/); life: the agents' lives, their plans (server/agent-life/)
   */
  constructor({ work = () => null, life = () => null, ownerName = () => '', log = null } = {}) {
    Object.assign(this, { work, life, ownerNameOf: ownerName, log });
  }
  /** What the job is for agent a in this break: its part's duties, and its owner's direction for its work. */
  onAirLines(a, { dj = false } = {}) {
    const L = [`YOUR JOB — ${dj ? 'the station\'s DJ' : 'a radio host'} (whoever holds it does all of it): ${(dj ? DUTIES.dj : DUTIES.host).join('; ')}.`];
    const dir = this.direction(a.id);
    if (dir) L.push(`YOUR OWNER'S DIRECTION for your work (how ${this.owner(a)} wants you to work; follow it where it fits a live radio show, and never read it out or talk about it): ${dir}`);
    return L;
  }
  /** Agent a's open tasks (skip: ids it did already in this break), for its turn: → { lines, byId } — none: no lines. */
  taskLines(a, skip = new Set()) {
    const byId = new Map();
    let list = [];
    try { list = (this.life?.()?.intentions?.(a.id) || []).filter(p => (p.status === 'open' || p.status === 'held') && !skip.has(p.id)).slice(0, TASKS_MAX); } catch { list = []; }
    if (!list.length) return { lines: [], byId };
    for (const p of list) byId.set(p.id, p);
    const who = this.owner(a);
    return {
      byId,
      lines: [`YOUR TASKS (your own open plans; yours to act on as you choose, now, later or not at all — bring one up on the air only if you want to, and never read this list out):`,
        ...list.map(p => `[#${p.id}] ${p.kind === 'must' ? 'must' : 'want to'}: ${JSON.stringify(clean(p.text, 160))}${p.source === 'owner' ? ` (${who} asked)` : ''}`),
        'If your line itself just did one of them (something done by saying it on the air; going somewhere or doing something off the air is not done from the mic), after your line, on a line of its own that is not read on the air: "DONE:" and its number (e.g. DONE: #12). Your line may run a little longer for it.'],
    };
  }
  /** The tasks agent a's line did (the numbers it marked, if they were its tasks this turn and its line carries them). */
  didTasks(a, marked, line, byId) {
    const out = [];
    for (const n of marked) {
      const p = byId.get(n); if (!p || out.includes(p.id)) continue;
      if (covers(line, p.text)) out.push(p.id); else this.log?.(`[radio] ${a.name} marked a task done on the air (#${p.id}) its line doesn't carry: left as it is`);
    }
    return out;
  }
  /** Done on the air: agent agentId's tasks ids (its plans: done, as its Studio shows them). */
  markDone(agentId, ids) {
    const life = this.life?.(); let n = 0;
    // (a task its body does — shopping, a meal out — isn't done by saying so on the air: it stays open, life.setIntention check)
    for (const id of ids) { try { life?.setIntention?.(agentId, id, 'done', { check: true }); n++; } catch (e) { this.log?.warn?.(`[radio] a task done on the air could not be marked (#${id}): ${e.message}`); } }
    if (n) this.log?.(`[radio] agent ${agentId} did ${n} task${n > 1 ? 's' : ''} on the air`);
    return n;
  }
  direction(id) {
    try { const b = this.work?.()?.brief?.(id); return b?.instructions ? clean(String(b.instructions).replace(/\s*\n\s*/g, ' '), DIRECTION_MAX) : ''; } catch { return ''; }
  }
  owner(a) { try { return clean(this.ownerNameOf(a), 40) || 'your owner'; } catch { return 'your owner'; } }
}
