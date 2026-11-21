// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Moments (docs/features/awareness.md §5, POST /api/play/moment): a play page says where its run stands now and then, so
// the AI agents with the player know what they are doing together (the Rush, the score, the rings). At most one every
// EVERY_MS; after something notable (a dish served, a ring flown through) within SOON_MS; the same again only as a
// heartbeat (BEAT_MS: the run is still being played). Fire and forget: a refusal is dropped, a run that ended stops it.
// Never for the score: the server's verify() decides that from the run's own report.
import { post } from '../core/net.js';

export const EVERY_MS = 5000, SOON_MS = 2000, BEAT_MS = 30000;

/** A sender for one page: start(runId) with each run, say(live, { now }) as it goes, stop() when it ends. */
export function moments() {
  let run = null, last = -Infinity, sent = '', want = null, timer = 0, timerAt = 0, dead = false;
  const flush = () => {
    clearTimeout(timer); timer = 0;
    if (!run || dead || !want) return;
    const key = JSON.stringify(want), t = performance.now();
    if (key === sent && t - last < BEAT_MS) return;
    last = t; sent = key;
    const id = run;
    post('/api/play/moment', { run: id, live: want }).catch(e => { if (e?.status === 404 && run === id) dead = true; });
  };
  return {
    start(id) { clearTimeout(timer); run = id || null; last = -Infinity; sent = ''; want = null; timer = 0; dead = false; },
    stop() { clearTimeout(timer); run = null; want = null; timer = 0; },
    /** Where the run stands now (a small plain object); now: something notable just happened. */
    say(live, { now = false } = {}) {
      if (!run || dead || !live) return;
      want = live;
      const t = performance.now(), key = JSON.stringify(live);
      if (key === sent && t - last < BEAT_MS) return;
      const due = last + (now ? SOON_MS : EVERY_MS);
      if (t >= due) flush();
      else if (!timer || due < timerAt) { clearTimeout(timer); timerAt = due; timer = setTimeout(flush, due - t); }
    },
  };
}
