// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Which of this person's Agent Providers' agents' screens are watched now - a PC window open (./pc-app.js), a live screen
// in the world (render/pc-screens.js) - told to the server (POST /api/pc/watch: server/pc/screen-watch.js), so the work
// those agents do elsewhere (another channel, a schedule) is followed onto their screens while someone looks, and not
// otherwise. Each place says its own agents; the server hears all of them together, at once for one newly watched, then
// once a minute while any is.
import { post } from '../core/net.js';

const EVERY_MS = 60000;
const by = new Map();   // the place watching → its agents' ids
let sent = new Set(), at = 0, timer = null;

function all() { const s = new Set(); for (const ids of by.values()) for (const id of ids) s.add(id); return s; }
function send() {
  const ids = all();
  clearTimeout(timer); timer = null;
  if (!ids.size || document.hidden) { sent = new Set(); return; }
  sent = ids; at = Date.now();
  post('/api/pc/watch', { agents: [...ids] }).catch(() => {});
  timer = setTimeout(send, EVERY_MS);
}
/** The agents `place` watches now (none: it stopped). */
export function watchScreens(place, ids) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (list.length) by.set(place, list); else by.delete(place);
  const now = all();
  if ([...now].some(id => !sent.has(id))) send();
  else if (!now.size) { clearTimeout(timer); timer = null; sent = new Set(); }
  else if (!timer) timer = setTimeout(send, Math.max(0, EVERY_MS - (Date.now() - at)));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && all().size) send(); });
