// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Self-contained so Playwright can evaluate this exact function against the public client state.
// Public person.x is a retained retired-body tombstone, not hidden-agent visibility. Active anonymous bodies still need plans.
export function activePlanCoverage(state = globalThis.__mvw) {
  const people = state.S.people, plans = state.net.plans; let active = 0, retired = 0; const missing = [];
  people.forEach((person, i) => { if (!person) return; if (person.x) retired++; else { active++; if (!plans[i]) missing.push(i); } });
  return { people: people.length, active, retired, plans: plans.filter(Boolean).length, missing };
}

// A UI world rehearsal copies only world/people/clock JSON, never accounts, slots, keys or connection credentials.
// Connected-agent identity belongs to the omitted slot ledger. Imported ext-* markers cannot become fresh slot authority.
export function detachWorldOnlyConnectedMarkers(people) {
  if (!Array.isArray(people)) throw new TypeError('World rehearsal requires a resident array');
  let detached = 0;
  const residents = people.map(p => {
    if (!p || typeof p !== 'object' || !p.vip || !/^ext-[1-9]\d*$/.test(String(p.agentId || ''))) return p;
    const next = { ...p, vip: false }; delete next.agentId; detached++;
    return next;
  });
  return { people: residents, detached };
}
