// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// "New version available" on the page (server/updates.js): for those who see the installation's settings, the session
// says whether a newer version of My Virtual World is out (auth.me.update). It is said once per version on this browser
// (a note with "What's new"); the bell has it too (a notification for those who run the server), and Settings → About
// shows it with the release notes and how to update.
import { bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { esc } from '../core/util.js';

let app = null, waiting = false;
const SEEN = 'mvw.updateSeen';
/** Where updating is explained (the install guide's Updating section). */
export const UPDATE_DOCS = 'https://github.com/eliautobot/my-virtual-world/blob/main/docs/INSTALL.md#updating';

export function status() { return (auth.me && auth.me.update) || null; }

export function init(a) {
  app = a;
  bus.on('auth', tell);
  tell();
}
function openAbout() { import('./settings.js').then(m => m.open(app, 'about')); }
/** Once per version, on this browser: a note that a newer version is out (once the world is up, not under the loader). */
function tell() {
  const u = status();
  if (!app || !u || !u.available || !u.latest) return;
  if (!app.ready) { if (!waiting) { waiting = true; const off = bus.on('ready', () => { off?.(); waiting = false; tell(); }); } return; }
  let seen = null;
  try { seen = localStorage.getItem(SEEN); } catch { /* private mode: said each time */ }
  if (seen === u.latest.version) return;
  try { localStorage.setItem(SEEN, u.latest.version); } catch { /* private mode */ }
  setTimeout(() => app.toast(`⬆️ New version available: My Virtual World ${u.latest.version} (this server runs ${u.current}).`, '', 15000, '', '',
    { label: 'What\'s new', run: openAbout }), 2500);
}

const day = t => { try { return new Date(t).toLocaleDateString(); } catch { return ''; } };
const when = t => { try { return new Date(t).toLocaleString(); } catch { return ''; } };

/** Settings → About's part: whether this is the newest version, and if not, what's new and how to update. */
export function aboutBlock() {
  const u = status();
  if (!u) return '';
  if (!u.enabled) return '<div class="kv2"><span>Updates</span><b>Not checked (Settings → General)</b></div>';
  if (!u.available || !u.latest) {
    return `<div class="kv2"><span>Updates</span><b>${u.checkedAt ? `Up to date <span class="dim">· checked ${esc(when(u.checkedAt))}</span>` : 'Not checked yet'}</b></div>`;
  }
  const L = u.latest;
  return `<div class="upd-box" role="status">
    <h5>⬆️ New version available: ${esc(L.version)}${L.publishedAt ? ` <span class="dim">· ${esc(day(L.publishedAt))}</span>` : ''}</h5>
    <p class="hint">This server runs ${esc(u.current)}. <a href="${esc(L.url)}" target="_blank" rel="noopener noreferrer">Release notes on GitHub</a></p>
    ${L.notes ? `<details class="upd-notes"><summary>What's new</summary><div class="upd-text">${esc(L.notes)}</div></details>` : ''}
    <details class="upd-how"><summary>How to update</summary>
      <p class="hint">Back up first, then update in the folder that holds <code>compose.yaml</code>:</p>
      <pre class="upd-cmd">docker compose exec -T app node tools/admin.mjs backup &gt; world-backup.tar.gz
docker compose exec -T app cat /keys/secret.key &gt; secret.key
git pull
docker compose pull
docker compose up -d</pre>
      <p class="hint">Your world, accounts and licence stay in the Docker volumes. Running from source instead: <code>git pull</code>, <code>npm ci --omit=dev</code>, then restart the server.
        <a href="${esc(UPDATE_DOCS)}" target="_blank" rel="noopener noreferrer">The install guide</a> has the details.</p>
    </details></div>`;
}
