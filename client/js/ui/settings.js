// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One compact tabbed Settings dialog (PLAN WP1.7; DECISIONS C112, CHECKLIST I3.5): General, Display, Sound, Player, Account,
// Connections, Voice (ui/voice-settings.js), Data, Residents, Promotions, Users, Invites, Permissions, Audit and About. Admin tabs appear only to accounts with the
// matching capability, and the dialog never covers the middle of the world view. The tab bodies live in admin.js
// (Users, Invites, Audit, General, Permissions) and account.js (Account); Display, Player, Connections, Voice, Data and
// About are here. The owner may change a capability's minimum role (permissions.manage) with a confirmed password.
import { FPS_MODES } from '../core/framepace.js';
import { RENDER_FLAGS, setRenderFlag, storedRenderFlag } from '../core/render-flags.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';
import { S, bus } from '../core/state.js';
import { post } from '../core/net.js';
import { pref, setPref, previewPref } from '../core/prefs.js';
import { soundOn, setSoundOn } from '../audio/mixer.js';
import { THEMES, apply, AGENT_EMOJI, applyAgentEmoji, TRANSPARENCY_MAX, TRANSPARENCY_STEP, transparencyOf } from '../core/theme.js';
import { authDialog } from './account.js';
import { accountPanel } from './account.js';
import { usersTab, invitesTab, auditTab, generalTab, permissionsTab, useApp } from './admin.js';
import { licenceTab, aboutLine } from './licence.js';
import { connectionsTab } from './connections.js';
import { agentSlotsTab } from './agent-slots.js';
import { DRIVE_PHYSICS_KEY, drivePhysicsMode } from '../player/drive-physics.js';
import { PERF_HUD_KEY } from './perfhud.js';
import { residentsTab } from './residents-admin.js';
import { agentLimitsTab } from './agent-limits.js';
import { econAdminTab, useEconAdmin } from './econ-admin.js';
import { freeWillAdminTab, useFreeWillAdmin } from './free-will.js';
import { mindAdmin, useMindAdmin } from './mind.js';
import { voiceTab as voiceSettings } from './voice-settings.js';

const say = (a, m) => { if (a && a.toast) a.toast(m); };

let app = null;
const TABS = [
  ['display', '🖥️ Display', 'Display', () => true],
  ['sound', '🔊 Sound', 'Sound', () => true],
  ['player', '🎮 Player', 'Player', () => true],
  ['account', '👤 Account', 'Account', () => !!auth.account && auth.can('account.self')],
  ['settings', '⚙️ General', 'General', () => auth.can('settings.view')],
  ['users', '👥 Users', 'Users', () => auth.can('users.manage')],
  ['invites', '✉️ Invites', 'Invites', () => auth.can('invites.manage')],
  ['permissions', '🔑 Permissions', 'Permissions', () => auth.can('permissions.manage')],
  ['audit', '📜 Audit log', 'Audit log', () => auth.can('audit.read')],
  ['connections', '🔌 Connections', 'Connections', () => auth.can('connections.use')],
  ['agents', '🤖 Third-party agents', 'Third-party agents', () => auth.can('agents.connect')],
  ['voice', '🎙️ Voice', 'Voice', () => !!auth.account && auth.can('chat.use')],
  ['data', '💾 Data', 'Data', () => auth.can('world.backup') || auth.can('world.manage') || auth.can('settings.infrastructure')],
  ['residents', '🧑 Residents', 'Residents', () => auth.can('world.edit')],
  ['promo', '✈️ Promotions', 'Promotions', () => auth.can('promo.manage')],
  ['economy', '🪙 Economy', 'Economy', () => auth.can('economy.admin')],
  ['freewill', '🧠 Free Will & Mind', 'Free Will and the Mind', () => auth.can('freewill.admin')],
  ['limits', '🛡️ Agent limits', 'Agent limits', () => auth.can('freewill.admin')],
  // (everyone sees it: it says why things are locked in demo mode)
  ['licence', '🔑 License', 'License', () => true],
  ['about', 'ℹ️ About', 'About', () => true],
];
export const labels = Object.fromEntries(TABS.map(([k, , l]) => [k, l]));

/** Opens Settings at the first tab the account may see (or at `want`). */
export function open(a, want = 'display') {
  app = a || app;
  useApp(app); useEconAdmin(app); useFreeWillAdmin(app); useMindAdmin(app);
  const shown = TABS.filter(t => t[3]());
  if (!shown.length) return;
  const at = shown.some(t => t[0] === want) ? want : shown[0][0];
  const d = authDialog('settings', 'Settings', `
    <div class="st">
      <div class="adm-tabs st-tabs" role="tablist">${shown.map(([k, , l]) => `<button type="button" class="btn tab" data-tab="${k}" role="tab">${esc(l)}</button>`).join('')}</div>
      <div class="adm st-body"><div class="aform atab"></div><div class="err hidden" role="alert"></div></div>
      <div class="st-foot"><span class="dim st-note">Changes take effect at once.</span><button type="button" class="btn cancel">Close</button></div>
    </div>`, { settings: true });
  const body = d.q('.atab');
  const show = k => {
    for (const b of d.el.querySelectorAll('.st-tabs .tab')) b.classList.toggle('on', b.dataset.tab === k);
    d.q('.err').classList.add('hidden');
    body.innerHTML = '';
    ({
      display: displayTab, sound: soundTab, player: playerTab, account: accountTab, settings: generalTab,
      users: usersTab, invites: invitesTab, permissions: permissionsTab, audit: auditTab,
      connections: connectionsTab, agents: (d2, b) => agentSlotsTab(d2, b, app), voice: voiceTab, data: dataTab, residents: residentsTab(app), promo: promoTab, economy: econAdminTab, freewill: freeWillAndMindTab, limits: agentLimitsTab, licence: licenceTab, about: aboutTab,
    })[k](d, body);
  };
  d.q('.st-tabs').onclick = e => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); };
  show(at);
  return d.done;
}

// ------------------------------------------------------------------ Sound (audio/mixer.js): on/off for this device, volumes that follow the account
const SOUNDS = [
  ['volMaster', 'Master volume', 'Everything below, together.'],
  ['volWorld', 'World', 'Wind, rain, waves, birds, the city and thunder.'],
  ['volAircraft', 'Aircraft and games', 'Engines and wind while you fly, the ring game\'s chimes.'],
  ['volVoices', 'Agents\' voices', 'Voice conversations and 🔊 read aloud.'],
  ['volMedia', 'Videos and recordings', 'Voicemail, and audio and video in chats and on the PC.'],
  ['volMusic', 'Live music', 'The lounge\'s band and the club\'s DJ, when you are on their floor.'],
];
function soundTab(d, body) {
  const paint = () => {
    const on = soundOn();
    body.innerHTML = `
    <label class="check snd-on"><input type="checkbox" class="snd-all"${on ? ' checked' : ''}> Sound on</label>
    <p class="hint">All sound on or off on this device — the same as the 🔊 button on the top bar.</p>
    <div class="snd-list${on ? '' : ' off'}">${SOUNDS.map(([k, label, about]) => `<label class="snd-l">${esc(label)}<span class="row snd-row"><input type="range" class="snd" data-k="${k}" min="0" max="100" step="5" value="${pref(k)}" aria-describedby="snd-${k}">
      <output class="snd-v">${pref(k)}%</output></span></label>
      <p class="hint" id="snd-${k}">${esc(about)}</p>`).join('')}</div>
    <p class="hint">The volumes follow your account; sound on or off stays with this device. Sound starts after your first click or key (the browser's rule), and a voice conversation turns the world down while you talk.</p>`;
    body.querySelector('.snd-all').onchange = e => { setSoundOn(e.target.checked); say(app, e.target.checked ? 'Sound on' : 'Sound off'); paint(); };
    for (const r of body.querySelectorAll('.snd')) {
      const out = r.parentElement.querySelector('.snd-v');
      r.oninput = () => { out.textContent = `${r.value}%`; previewPref(r.dataset.k, Number(r.value)); };
      r.onchange = () => { setPref(r.dataset.k, Number(r.value)); say(app, `${SOUNDS.find(x => x[0] === r.dataset.k)[1]}: ${r.value}%`); };
    }
  };
  paint();
}

// ------------------------------------------------------------------ Display (tier 0 preferences; they follow the account)
function displayTab(d, body) {
  const qual = (app && app.stage && app.stage.q.name) || S.quality;
  body.innerHTML = `
    <label>Theme<span class="row"><select class="input theme">
      ${THEMES.map(([v, t]) => `<option value="${v}"${pref('theme') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <p class="hint">Dark is the default. The choice follows your account; a guest's stays in this browser.</p>
    <label class="tr-l">Transparency<span class="row tr-row"><input type="range" class="tr" min="0" max="${TRANSPARENCY_MAX}" step="${TRANSPARENCY_STEP}" value="${transparencyOf(pref('transparency'))}" aria-describedby="tr-hint">
      <output class="tr-v">${transparencyOf(pref('transparency'))}%</output></span></label>
    <p class="hint" id="tr-hint">See the world through windows, panels and buttons — 0% is solid. High contrast stays solid.</p>
    <label>Agents' emoji<span class="row"><select class="input agemo">
      ${AGENT_EMOJI.map(([v, t]) => `<option value="${v}"${pref('agentEmoji') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <p class="hint">How agents and residents show their own emoji: as the emoji they chose (Normal), or drawn in the theme's icon style (Stylized). It follows your account.</p>
    <label class="check"><input type="checkbox" class="labels"${S.labels ? ' checked' : ''}> Name tags over residents</label>
    <label class="check"><input type="checkbox" class="autores"${localStorage.getItem('mvw.autoRes') !== '0' ? ' checked' : ''}> Automatic resolution (lowers detail briefly to keep motion smooth)</label>
    <label class="check"><input type="checkbox" class="perfhud"${localStorage.getItem(PERF_HUD_KEY) === '1' ? ' checked' : ''}> Show performance (frame rate, slow frames, loading)</label>
    <p class="hint">Also the <kbd>L</kbd> key.</p>
    <label>Interior walls<span class="row"><select class="input walls">
      ${[['cut', 'Cutaway'], ['up', 'Full'], ['down', 'Low']].map(([v, t]) => `<option value="${v}"${S.walls === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <p class="hint">While inside a building; also the <kbd>V</kbd> key.</p>
    ${[['wildlife', 'Wildlife', [['off', 'Off'], ['fewer', 'Fewer'], ['normal', 'Normal']]], ['weatherFx', 'Rain and lightning', [['off', 'Off'], ['on', 'On']]], ['promoAircraft', 'Promotional aircraft', [['off', 'Off'], ['on', 'On']]],
      ['traffic', 'Traffic', [['off', 'Off'], ['light', 'Light'], ['normal', 'Normal']]], ['vehicleDetail', 'Vehicle detail', [['simple', 'Simple'], ['normal', 'Normal']]]]
      .map(([k, label, opts]) => `<label>${label}<span class="row"><select class="input dp" data-k="${k}">${opts.map(([v, t]) => `<option value="${v}"${pref(k) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>`).join('')}
    <p class="hint">For slower devices: these change only what this screen draws, not the world.</p>
    <label>Graphics quality<span class="row"><select class="input qual">
      ${[['high', 'High — all effects'], ['medium', 'Medium'], ['low', 'Low — fastest']].map(([v, t]) => `<option value="${v}"${qual === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <p class="hint">Quality stays with this device; the other settings follow your account. Changing it reloads the page.</p>
    <label>Frame rate<span class="row"><select class="input fps">
      ${FPS_MODES.map(([v, t]) => `<option value="${v}"${(app?.pace?.mode || 'auto') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <p class="hint">Phones and tablets run cooler and longer on Auto: full speed while you move around, half once the view is still. Stays with this device.</p>
    <label>Renderer</label>
    ${RENDER_FLAGS.map(([k, label, note]) => `<label class="check" title="${esc(note)}"><input type="checkbox" class="rf" data-k="${k}"${storedRenderFlag(k) ? ' checked' : ''}> ${esc(label)}</label>`).join('')}
    <p class="hint">Lighter ways of drawing the same picture. Turn one off to compare; the page reloads. Stays with this device.</p>`;
  for (const sel of body.querySelectorAll('.dp')) sel.onchange = e => { setPref(e.target.dataset.k, e.target.value); say(app, `${e.target.closest('label').firstChild.textContent}: ${e.target.selectedOptions[0].textContent}`); };
  // transparency: shown while the slider moves, saved when it is let go
  const tr = body.querySelector('.tr'), trV = body.querySelector('.tr-v');
  const trOff = () => { const off = (pref('theme') || 'dark') === 'contrast'; tr.disabled = off; tr.closest('label').classList.toggle('off', off); };
  tr.oninput = () => { trV.textContent = `${tr.value}%`; previewPref('transparency', Number(tr.value)); };
  tr.onchange = () => { setPref('transparency', Number(tr.value)); say(app, `Transparency: ${tr.value}%`); };
  trOff();
  body.querySelector('.theme').onchange = e => {
    setPref('theme', e.target.value);
    apply(e.target.value);
    trOff();
    say(app, e.target.value === 'dark' ? 'Theme: Dark' : e.target.value === 'light' ? 'Theme: Light' : 'Theme: High contrast');
  };
  body.querySelector('.agemo').onchange = e => {
    setPref('agentEmoji', e.target.value);
    applyAgentEmoji();
    say(app, `Agents' emoji: ${e.target.selectedOptions[0].textContent}`);
  };
  body.querySelector('.labels').onchange = e => { setPref('labels', e.target.checked); say(app, e.target.checked ? 'Name tags on' : 'Name tags off'); };
  body.querySelector('.autores').onchange = e => { if (e.target.checked) localStorage.removeItem('mvw.autoRes'); else localStorage.setItem('mvw.autoRes', '0'); app.autoRes?.enable(e.target.checked); };
  body.querySelector('.perfhud').onchange = e => { if (e.target.checked) localStorage.setItem(PERF_HUD_KEY, '1'); else localStorage.removeItem(PERF_HUD_KEY); bus.emit('perfhud', e.target.checked); };
  body.querySelector('.walls').onchange = e => { setPref('walls', e.target.value); if (app) app.applyFocus(); };
  for (const cb of body.querySelectorAll('.rf')) cb.onchange = e => {
    setRenderFlag(e.target.dataset.k, e.target.checked);
    app.toast(`${e.target.parentElement.textContent.trim()}: ${e.target.checked ? 'on' : 'off'} — reloading…`);
    setTimeout(() => { const u = new URL(location.href); u.searchParams.delete('rf'); location.href = u.toString(); }, 700);
  };
  body.querySelector('.fps').onchange = e => { app?.pace?.setMode(e.target.value); say(app, `Frame rate: ${e.target.selectedOptions[0].textContent}`); };
  body.querySelector('.qual').onchange = e => {
    localStorage.setItem('mvw.quality', e.target.value);
    app.toast(`Graphics: ${e.target.value} — reloading…`);
    setTimeout(() => { const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); }, 700);
  };
}

// ------------------------------------------------------------------ Player
function playerTab(d, body) {
  body.innerHTML = `
    <p class="hint">In Play mode you walk the city as your own character. Its look is kept in this browser.</p>
    <div class="dpad"><button type="button" class="btn primary look">🎨 My look</button></div>
    <div class="sep"></div>
    <label>Driving physics<span class="row"><select class="input drive">
      ${[['auto', `Automatic (now: ${drivePhysicsMode() === 'browser' ? 'this browser' : 'the server'})`], ['browser', 'This browser — instant controls'], ['server', 'The server — for phones and slow devices']]
        .map(([v, t]) => `<option value="${v}"${(localStorage.getItem(DRIVE_PHYSICS_KEY) || 'auto') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <p class="hint">In this browser your car reacts the moment you press a key and the server checks and shares its position. Automatic uses this browser on every device. Takes effect the next time you get in a car; kept on this device.</p>`;
  body.querySelector('.look').onclick = () => { if (app.openCustomizer) app.openCustomizer({ kind: 'player' }); };
  body.querySelector('.drive').onchange = e => {
    if (e.target.value === 'auto') localStorage.removeItem(DRIVE_PHYSICS_KEY); else localStorage.setItem(DRIVE_PHYSICS_KEY, e.target.value);
    app.toast('Driving physics changes the next time you get in a car');
  };
}

// ------------------------------------------------------------------ Account (the same panel as the account menu)
function accountTab(d, body) {
  if (!auth.account) { body.innerHTML = '<p class="hint">Sign in to see your account.</p>'; return; }
  accountPanel(d, body);
}

// ------------------------------------------------------------------ Voice
/** Settings → Voice (ui/voice-settings.js): the account's listening and speaking, its own voice service; for
 *  administrators the world's voice. */
const voiceTab = (d, body) => voiceSettings(d, body, app);

// ------------------------------------------------------------------ Promotions (WP4.11): banner planes, blimps, balloons
// The aircraft are managed with the other ad assets in 📣 Marketing (the edit panel; ui/marketing.js), one by one.
function promoTab(d, body) {
  body.innerHTML = `<p class="hint">The banner planes, blimps and balloons are managed with the billboards, the street signs and the metro panels in <b>📣 Marketing</b>, in the edit panel: add or take away each one, give it its own banner, and set each kind's banner and the hours they fly.</p>
    <div class="dpad"><button type="button" class="btn primary pgo">📣 Open Marketing</button></div>`;
  body.querySelector('.pgo').onclick = () => { d.close?.(); const D = window.__mvw?.docks; if (D) { D.show('l:marketing'); D.open('left', true); } };
}

// ------------------------------------------------------------------ Data (WP4.10): world backups, restores, resetting residents
function dataTab(d, body) {
  const canB = auth.can('world.backup'), canM = auth.can('world.manage');
  body.innerHTML = `
    <h4>🗄️ World backup</h4>
    <p class="hint">Everything built and lived in — buildings and their floors, roads, the land and its changes, the islands, stations, decorations and residents — in one file. Lots and who holds them are listed for reference but never restored: a restore never changes property.</p>
    <div class="dpad"><button type="button" class="btn primary dl"${canB ? '' : ' disabled'}>⬇️ Download a backup</button></div>
    <div class="sep"></div>
    <h4>♻️ Restore a backup</h4>
    <p class="hint">Puts this world back as it was in the backup. The world as it is now is backed up on the server first. The server restarts to load it (a few seconds); everyone reconnects by themselves. Asks for your password.</p>
    <div class="dpad"><input type="file" class="rf" accept="application/json,.json"${canM ? '' : ' disabled'}> <button type="button" class="btn danger rs"${canM ? '' : ' disabled'}>Restore</button></div>
    <div class="sep"></div>
    <h4>👥 Reset the residents</h4>
    <p class="hint">Everyone except the agents' residents starts afresh: new people, homes and jobs given again. Players and accounts are untouched. The server restarts.</p>
    <div class="dpad"><label>Residents <input type="number" class="input pn" min="0" max="12000" step="50" value="${S.people?.length || 0}" style="width:96px"${canM ? '' : ' disabled'}></label> <button type="button" class="btn danger rp"${canM ? '' : ' disabled'}>Reset residents</button></div>
    <p class="hint dstat"></p>`;
  const stat = t => { body.querySelector('.dstat').textContent = t; };
  body.querySelector('.dl').onclick = async () => {
    stat('Preparing the backup…');
    try {
      const r = await fetch('/api/world/backup');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'world-backup.json';
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      stat(`Saved ${name} (${(blob.size / 1048576).toFixed(1)} MB).`);
    } catch (e) { stat(e.message); }
  };
  body.querySelector('.rs').onclick = async () => {
    const f = body.querySelector('.rf').files?.[0];
    if (!f) { stat('Choose a backup file first.'); return; }
    let b; try { b = JSON.parse(await f.text()); } catch { stat('That file is not a backup.'); return; }
    if (!confirm(`Restore the world from ${b.exportedAt ? new Date(b.exportedAt).toLocaleString() : 'this backup'}? The world as it is now is backed up first, and the server restarts.`)) return;
    stat('Restoring…');
    try { const r = await post('/api/world/restore', b); stat(`Restoring — the server restarts now (the world before is kept in ${r.backup}).`); }
    catch (e) { stat(e.message); }
  };
  body.querySelector('.rp').onclick = async () => {
    const n = +body.querySelector('.pn').value;
    if (!confirm(`Reset the residents to ${n.toLocaleString()} new people? The agents' residents stay. The server restarts.`)) return;
    stat('Resetting…');
    try { const r = await post('/api/world/reset-population', { population: n }); stat(`${r.people.toLocaleString()} residents — the server restarts now.`); }
    catch (e) { stat(e.message); }
  };
}

// ------------------------------------------------------------------ About
async function aboutTab(d, body) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  let h1 = null;
  try { const r = await fetch('/api/health', { cache: 'no-store' }); h1 = await r.json(); } catch { /* shown below */ }
  const rel = h1 && h1.release ? (h1.release.tag || h1.release.channel) : '—';
  const libs = (h1 && h1.libs) || [];
  body.innerHTML = `
    <h4>My Virtual World</h4>
    <div class="kv2"><span>Version</span><b>${esc((h1 && h1.version) || '—')}</b></div>
    <div class="kv2"><span>Release</span><b>${esc(rel)}</b></div>
    <div class="kv2"><span>World</span><b>${esc((h1 && h1.worldVersion) || '—')}</b></div>
    ${aboutLine()}
    <div class="kv2"><span>Residents</span><b>${(S.people.length || 0).toLocaleString()}</b></div>
    <div class="kv2"><span>Buildings</span><b>${esc(String((h1 && h1.buildings) ?? '—'))}</b></div>
    <div class="sep"></div>
    <h5>This release ships</h5>
    <ul class="notice-list">${libs.length
      ? libs.map(l => `<li><b>${esc(l.name)}</b>${l.version ? ` ${esc(l.version)}` : ''} — ${esc(l.license)}</li>`).join('')
      : '<li class="dim">No libraries listed.</li>'}</ul>
    <p class="hint">Each library is vendored in this installation; the licence above is the one the package declares, and its licence file sits beside it where the package ships one. City, residents and buildings are generated from a seeded world file; AI agents are connected over the settings.</p>
    <h5>License</h5>
    <p class="hint">My Virtual World — © 2026 My Virtual World. Source-available under the PolyForm Noncommercial License 1.0.0 (noncommercial use, modification and sharing; commercial use needs a separate written license); creative assets under CC BY-NC-SA 4.0. A License Key unlocks the product's features; it does not change these licenses. The libraries above keep their own licences; the brand is reserved.</p>`;
}

/** Settings → Free Will & Mind: Free Will's part, then the Mind's (ui/free-will.js, ui/mind.js). */
function freeWillAndMindTab(d, body) {
  const fw = body.appendChild(document.createElement('div')), mi = body.appendChild(document.createElement('div'));
  return Promise.all([freeWillAdminTab(d, fw), mindAdmin(d, mi)]);
}
