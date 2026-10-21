// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How close one agent feels to someone it knows (2026-10-10): one scale for the server (its life's memories,
// the Mind's words, the friends' rules) and the pages (the Studio's People tab). Closeness is the relation's affinity, -1 to 1:
// it grows with time spent together, fades with time apart and drops with bad experiences (server/agent-social/).
// Each agent's feeling is its own: Lena may still like Milo after Milo has moved on.
export const LEVELS = Object.freeze([
  { key: 'close_friend', at: 0.75, label: 'Close friend' },
  { key: 'friend', at: 0.5, label: 'Friend' },
  { key: 'getting_to_know', at: 0.25, label: 'Getting to know' },
  { key: 'acquaintance', at: 0.0001, label: 'Acquaintance' },
  { key: 'met', at: -0.3 + 1e-9, label: 'Met' },
  { key: 'dont_get_on', at: -Infinity, label: 'Don\'t get on' },
]);

/**
 * The level of a closeness: { key, label }. ended: a friendship it ended and can't start again yet. friendAt / knownAt: the
 * admin's levels (Settings → Agent limits: a friend, a stranger below) — "Friend" is what counts as a friend in this world;
 * "Close friend" halfway from there to the top. The defaults are the scale above.
 */
export function closenessLevel(affinity, { ended = false, friendAt = 0.5, knownAt = 0.25 } = {}) {
  if (ended) return { key: 'ended', label: 'Friendship ended' };
  const a = Number(affinity) || 0, close = friendAt + (1 - friendAt) / 2;
  const key = a >= close ? 'close_friend' : a >= friendAt ? 'friend' : a >= knownAt ? 'getting_to_know' : a > 0 ? 'acquaintance' : a > -0.3 ? 'met' : 'dont_get_on';
  return { key, label: LEVELS.find(l => l.key === key).label };
}

/** The words the Mind thinks with about someone ("good friends", "we don't get on"). */
export function closenessWords(affinity, { ended = false } = {}) {
  if (ended) return 'we stopped being friends';
  const a = Number(affinity) || 0;
  return a >= 0.75 ? 'close friends' : a >= 0.5 ? 'good friends' : a >= 0.25 ? 'getting to know each other' : a <= -0.3 ? 'we don\'t get on' : 'we\'ve met';
}
