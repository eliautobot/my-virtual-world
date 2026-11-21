// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The moments at work, said and remembered (2026-11-16, the product owner: agents "need to know their positions, posts,
// and co-workers and their role so that agents know when a co-worker is missing, late, or will be back soon"; "they can
// mention when an agent is out or late or there's a reason they aren't there (not hardcoded to me: any agent, any owner)").
// From who is at work (./presence.js): someone late, someone getting in (late), someone leaving during their shift,
// someone back. An AI agent it happened to remembers it (its life's memory) and may say a word about it out loud; one of
// its co-workers there with a brain of its own may say a word too (to them, or about them). Every word goes the way any
// line does (server/mind/ speak: its own brain, its limits, the moderation, its voice) — nothing here is a fixed line:
// the situation in plain words, the agent's own words.
// - Once a moment (presence.js tells each once), at most one co-worker speaks of it, and a workplace has a word at most
//   every GAP_MS — a busy café's late arrivals don't turn into a chorus.
// - Off: Settings → Agent limits → work.remarks (the memories are kept either way).

const GAP_MS = 60000;            // a workplace's co-workers say something about someone at most this often
const CO_DELAY_MS = 5000;        // a co-worker's word comes a moment after the one it is about speaks

/** The reason in the past tense, for "I was …" / "they were …" ('' when there is none to give). */
function past(reason) {
  const r = String(reason || '').trim();
  if (!r || r === 'on the way' || r === 'on the way back') return '';
  return r;
}

export class WorkRemarks {
  /** o: { presence, sim(), agents, mind(), life(), setting(path), now(), log, delay(ms, fn) } */
  constructor({ presence, sim, agents, mind = () => null, life = () => null, setting = () => undefined, now = () => Date.now(), log = null, delay = (ms, fn) => { const t = setTimeout(fn, ms); t.unref?.(); } }) {
    Object.assign(this, { presence, simOf: sim, agents, mindOf: mind, lifeOf: life, setting, now, log, delay });
    this.lastAt = new Map();   // workplace key → when its co-workers last said something about someone
    this.stats = { events: 0, said: 0, remembered: 0, skipped: 0 };
    this.off = presence.on(e => { try { this.onEvent(e); } catch (err) { this.log?.warn?.('[work] a moment could not be told:', err.message); } });
  }
  stop() { this.off?.(); }
  /** The agent record of person i (an AI agent with a body), or null (a resident). */
  recOf(i) { const p = this.simOf()?.people[i]; return p?.vip && p.agentId ? this.agents.byKey?.(p.agentId) || null : null; }
  onEvent(e) {
    this.stats.events++;
    const sim = this.simOf(), p = sim?.people[e.i];
    if (!p) return;
    const rec = this.recOf(e.i), place = e.status?.place || 'work', role = e.pos?.role || 'co-worker', name = p.name;
    const why = past(e.reason ?? e.status?.reason);
    const speak = this.setting('work.remarks') !== false, mind = this.mindOf();
    // its own: remembered, and maybe a word out loud
    if (rec) {
      const mine = e.type === 'arrived' && e.lateBy ? `Got to work at ${place} ${e.lateBy} minutes late${why ? ` (I was ${why})` : ''}`
        : e.type === 'left' ? `Left work at ${place} during my shift${why ? ` — ${why}` : ''}`
          : e.type === 'back' ? `Back at work at ${place} after ${e.awayMin || 'a few'} minutes away` : null;
      if (mine) this.remember(rec, mine, place);
      if (speak && mind?.remark && e.type === 'arrived' && e.lateBy) {
        mind.remark(rec, `I just got to work at ${place}, ${e.lateBy} minutes late${why ? ` — the reason: I was ${why}` : ' (no particular reason)'}. My co-workers are here. (If I say why, I say the real reason.)`).then(r => { if (r?.shown) { this.stats.said++; this.log?.(`[work] ${rec.name} got in late: ${String(r.text || '').slice(0, 120)}`); } }).catch(() => {});
      }
    }
    // a co-worker's word about it (one, there now, with a brain of its own) — about an AI agent: the city's residents
    // come and go late often enough that a word each time would drown the rest (their co-workers know it either way:
    // their minds see the staff list, server/mind/ workText)
    if (!speak || !mind?.remark || !rec) return;
    const situation = e.type === 'late' ? `${name}, my co-worker (the ${role} here), isn't in yet — their shift started at ${e.status?.shiftStart || 'a while ago'}${why ? ` and they are ${why}` : ''}.`
      : e.type === 'arrived' && e.lateBy ? `${name}, my co-worker (the ${role} here), just got in, ${e.lateBy} minutes late${why ? ` — they were ${why}` : ''}.`
        : e.type === 'left' ? `${name}, my co-worker (the ${role} here), just left in the middle of their shift${why ? ` — they are ${why}` : ''}.`
          : e.type === 'back' ? `${name}, my co-worker (the ${role} here), is back at work after ${e.awayMin || 'a few'} minutes away.` : null;
    if (!situation) return;
    const key = e.pos?.key, t = this.now();
    if (key && t - (this.lastAt.get(key) || -Infinity) < GAP_MS) { this.stats.skipped++; return; }
    const mates = this.presence.team(key, { exclude: e.i }).filter(x => x.state === 'on_duty' && x.agent).map(x => ({ x, rec: this.recOf(x.i) })).filter(m => m.rec);
    if (!mates.length) return;
    this.lastAt.set(key, t);
    // (the one who knows them best speaks — its life's relations; else the first there)
    const life = this.lifeOf(), known = m => { try { const r = life?.relations?.(m.rec.id, 60)?.find(x => x.name === name); return r ? r.interactions || 0 : 0; } catch { return 0; } };
    const who = mates.sort((a, b) => known(b) - known(a))[0].rec;
    const to = e.type === 'arrived' || e.type === 'back' ? name : null;   // (said to them, when they're there)
    this.delay(e.type === 'arrived' ? CO_DELAY_MS : 0, () => {
      mind.remark(who, situation, to).then(r => { if (r?.shown) { this.stats.said++; this.log?.(`[work] ${who.name} on ${name} (${e.type}): ${String(r.text || '').slice(0, 120)}`); } }).catch(() => {});
    });
  }
  remember(rec, text, place) {
    const life = this.lifeOf(), sim = this.simOf();
    if (!life?.remember) return;
    try {
      life.remember(rec.id, { term: 'short', kind: 'event', text, importance: 2, place, day: life.today?.() ?? 0, time: life.clockAt ? life.clockAt(sim.now()) : null });
      this.stats.remembered++;
    } catch (e) { this.log?.warn?.('[work] not remembered:', e.message); }
  }
}
