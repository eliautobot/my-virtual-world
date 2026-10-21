// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The admin and installation tabs (WP1.4; moved into the tabbed Settings dialog in WP1.7): Users, Invites, Audit log,
// General (the installation settings) and Permissions. ui/settings.js hosts them; every action is checked by the
// server again, and the UI only offers what the signed-in account's role allows (always below the own role).
import { auth } from '../core/auth.js';
import { esc } from '../core/util.js';
import { authDialog, downloadFile } from './account.js';
import { AGENT_LIMIT_PATHS } from './agent-limit-groups.js';

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const RANK = { guest: 0, member: 1, admin: 2, owner: 3 };
let app = null;

const getJ = async url => {
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, code: j && j.code });
  return j;
};
const when = t => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-');

/** The app handle for toasts (ui/settings.js calls this when it opens). */
export function useApp(a) { app = a; }

/** A value shown once (temporary password, invite link) with a copy button. */
export function once(label, value) {
  return `<div class="once"><div>${esc(label)}</div><code class="val">${esc(value)}</code>
    <button type="button" class="btn small copy" data-v="${esc(value)}">Copy</button><small>Shown only now.</small></div>`;
}
export function wireCopy(root) {
  root.addEventListener('click', async e => {
    const b = e.target.closest('.copy');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.v); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
  });
}

// ------------------------------------------------------------------ Users (I14.5)
export async function usersTab(d, body) {
  const me = auth.account;
  body.innerHTML = `
    <div class="row"><input class="input search" placeholder="Search by name or username" aria-label="Search accounts"></div>
    <div class="adm-note"></div>
    <table class="adm-table users"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>2FA</th><th>Last seen</th><th></th></tr></thead><tbody></tbody></table>
    <form class="create row wrap">
      <b>New account</b>
      <input class="input login" placeholder="Username" required autocapitalize="none" spellcheck="false">
      <input class="input name" placeholder="Display name" required>
      <select class="input role">${me.role === 'owner' ? '<option value="member">Member</option><option value="admin">Admin</option>' : '<option value="member">Member</option>'}</select>
      <button type="submit" class="btn primary">Create</button>
    </form>`;
  wireCopy(body);
  const note = body.querySelector('.adm-note'), tbody = body.querySelector('tbody');
  let users = [];
  const render = () => {
    const q = body.querySelector('.search').value.trim().toLowerCase();
    const list = users.filter(u => !q || u.login.includes(q) || u.displayName.toLowerCase().includes(q));
    tbody.innerHTML = list.map(u => {
      const below = RANK[u.role] < RANK[me.role] && u.id !== me.id;
      const actions = [];
      if (below) {
        if (me.role === 'owner') actions.push(`<select class="input small setrole" data-id="${u.id}" aria-label="Role of ${esc(u.login)}">${['member', 'admin'].map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${ROLE[r]}</option>`).join('')}</select>`);
        actions.push(`<button type="button" class="btn small" data-a="${u.status === 'active' ? 'disable' : 'enable'}" data-id="${u.id}">${u.status === 'active' ? 'Disable' : 'Enable'}</button>`);
        actions.push(`<button type="button" class="btn small" data-a="reset" data-id="${u.id}">Reset password</button>`);
        if (u.twofa) actions.push(`<button type="button" class="btn small" data-a="reset2fa" data-id="${u.id}">Reset 2FA</button>`);
        actions.push(`<button type="button" class="btn small danger" data-a="delete" data-id="${u.id}">Delete…</button>`);
      }
      if (me.role === 'owner' && u.role === 'admin' && u.status === 'active') actions.push(`<button type="button" class="btn small" data-a="transfer" data-id="${u.id}">Make owner…</button>`);
      return `<tr data-id="${u.id}"><td>${esc(u.displayName)}${u.id === me.id ? ' <small>(you)</small>' : ''}</td><td><code>${esc(u.login)}</code></td>
        <td>${ROLE[u.role]}</td><td>${u.status === 'active' ? (u.mustChange ? 'temporary password' : 'active') : 'disabled'}</td><td>${u.twofa ? '✓' : ''}</td>
        <td>${when(u.lastSeen)}</td><td class="acts">${actions.join(' ')}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="hint">No accounts match</td></tr>';
  };
  const load = async () => { users = (await getJ('/api/users')).users; render(); };
  const run = async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) app.toast(okMsg, 'good'); await load(); return r; } catch (err) { if (err.code !== 'reauth_required') d.error(err); return null; }
  };
  body.querySelector('.search').oninput = render;
  body.querySelector('.create').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const r = await run(() => auth.call('/api/users', { login: f.querySelector('.login').value, displayName: f.querySelector('.name').value, role: f.querySelector('.role').value }), 'Account created');
    if (r) { note.innerHTML = once(`Temporary password for ${r.user.login} (they choose their own at the first sign-in; it expires in 72 hours):`, r.temporaryPassword); f.reset(); }
  };
  tbody.addEventListener('change', e => {
    const s = e.target.closest('.setrole');
    if (s) run(() => auth.call('/api/users/update', { id: +s.dataset.id, role: s.value }), 'Role changed');
  });
  tbody.addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const id = +b.dataset.id, u = users.find(x => x.id === id), a = b.dataset.a;
    if (a === 'disable' || a === 'enable') return run(() => auth.call('/api/users/update', { id, status: a === 'disable' ? 'disabled' : 'active' }), a === 'disable' ? `${u.login} is disabled and signed out` : `${u.login} is enabled`);
    if (a === 'reset2fa') return run(() => auth.call('/api/users/update', { id, resetTwofa: true }), `Two-factor sign-in of ${u.login} was reset`);
    if (a === 'reset') {
      const r = await run(() => auth.call('/api/users/update', { id, resetPassword: true }), `${u.login} was signed out`);
      if (r) note.innerHTML = once(`New temporary password for ${u.login} (they must choose their own at the next sign-in):`, r.temporaryPassword);
      return;
    }
    if (a === 'delete') {
      const others = users.filter(x => x.id !== id && x.status === 'active');
      note.innerHTML = `<div class="confirm-row"><b>Delete ${esc(u.displayName)} (${esc(u.login)})?</b> Their data:
        <label><input type="radio" name="data" value="delete" checked> delete it</label>
        <label><input type="radio" name="data" value="reassign"> give it to <select class="input small to">${others.map(x => `<option value="${x.id}">${esc(x.displayName)}</option>`).join('')}</select></label>
        <button type="button" class="btn small danger godel">Delete account</button> <button type="button" class="btn small nodel">Cancel</button></div>`;
      note.querySelector('.nodel').onclick = () => { note.innerHTML = ''; };
      note.querySelector('.godel').onclick = async () => {
        const data = note.querySelector('input[name="data"]:checked').value;
        const ok = await run(() => auth.call('/api/users/delete', { id, data, to: data === 'reassign' ? +note.querySelector('.to').value : null }), `${u.login} was deleted`);
        if (ok) note.innerHTML = '';
      };
      return;
    }
    if (a === 'transfer') {
      note.innerHTML = `<div class="confirm-row"><b>Make ${esc(u.displayName)} the owner?</b> You become an admin, and only they can make you the owner again.
        <button type="button" class="btn small danger gotr">Hand over ownership</button> <button type="button" class="btn small notr">Cancel</button></div>`;
      note.querySelector('.notr').onclick = () => { note.innerHTML = ''; };
      note.querySelector('.gotr').onclick = async () => {
        const ok = await run(() => auth.call('/api/owner/transfer', { id }), `${u.displayName} is now the owner`);
        if (ok) { note.innerHTML = ''; d.close(true); }
      };
    }
  });
  try { await load(); } catch (err) { d.error(err); }
}

// ------------------------------------------------------------------ Invites (I14.4)
export async function invitesTab(d, body) {
  const me = auth.account;
  body.innerHTML = `
    <form class="create row wrap">
      <b>New invite</b>
      <select class="input role">${me.role === 'owner' ? '<option value="member">Member</option><option value="admin">Admin</option>' : '<option value="member">Member</option>'}</select>
      <label class="inline">valid for <input class="input days" type="number" min="1" max="30" value="7"> days</label>
      <input class="input note" placeholder="Note (who it is for)" maxlength="80">
      <button type="submit" class="btn primary">Create link</button>
    </form>
    <div class="adm-note"></div>
    <table class="adm-table"><thead><tr><th>Role</th><th>Note</th><th>Created by</th><th>Expires</th><th>State</th><th></th></tr></thead><tbody></tbody></table>`;
  wireCopy(body);
  const note = body.querySelector('.adm-note'), tbody = body.querySelector('tbody');
  const render = invites => {
    tbody.innerHTML = invites.map(i => `<tr><td>${ROLE[i.role]}</td><td>${esc(i.note || '')}</td><td>${esc(i.createdBy || '-')}</td><td>${when(i.expires)}</td>
      <td>${i.state}${i.usedBy ? ` by ${esc(i.usedBy)}` : ''}</td>
      <td>${i.state === 'open' && RANK[i.role] < RANK[me.role] ? `<button type="button" class="btn small revoke" data-id="${i.id}">Revoke</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="hint">No invites yet</td></tr>';
  };
  const load = async () => render((await getJ('/api/invites')).invites);
  body.querySelector('.create').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await auth.call('/api/invites', { role: f.querySelector('.role').value, days: +f.querySelector('.days').value, note: f.querySelector('.note').value });
      note.innerHTML = once(`Invite link (${ROLE[r.invite.role]}, single use, until ${when(r.invite.expires)}):`, r.link);
      f.querySelector('.note').value = '';
      await load();
    } catch (err) { if (err.code !== 'reauth_required') d.error(err); }
  };
  tbody.addEventListener('click', async e => {
    const b = e.target.closest('.revoke');
    if (!b) return;
    try { render((await auth.call('/api/invites/revoke', { id: +b.dataset.id })).invites); app.toast('Invite revoked', 'good'); } catch (err) { d.error(err); }
  });
  try { await load(); } catch (err) { d.error(err); }
}

// ------------------------------------------------------------------ Audit log (I14.6)
export async function auditTab(d, body) {
  let groups = [], users = [];
  try { users = auth.can('users.manage') ? (await getJ('/api/users')).users : []; } catch { /* filter by account unavailable */ }
  body.innerHTML = `
    <form class="filters row wrap">
      <select class="input group" aria-label="What"><option value="">Everything</option></select>
      <select class="input account" aria-label="Account"><option value="">Any account</option>${users.map(u => `<option value="${u.id}">${esc(u.displayName)} (${esc(u.login)})</option>`).join('')}</select>
      <label class="inline">from <input class="input from" type="date"></label>
      <label class="inline">to <input class="input to" type="date"></label>
      <button type="submit" class="btn">Show</button>
      <span class="spacer"></span>
      <button type="button" class="btn csv">Export CSV</button><button type="button" class="btn jsonl">Export JSON</button>
    </form>
    <table class="adm-table audit"><thead><tr><th>Time</th><th>By</th><th>What</th><th>About</th><th>Address</th><th>Details</th></tr></thead><tbody></tbody></table>
    <div class="row"><button type="button" class="btn more hidden">Older events</button></div>
    <p class="hint">Nobody can change or delete events here; the owner can set how long they are kept.</p>`;
  const f = body.querySelector('.filters'), tbody = body.querySelector('tbody'), more = body.querySelector('.more');
  let last = null;
  const query = () => {
    const p = new URLSearchParams();
    const g = f.querySelector('.group').value, a = f.querySelector('.account').value, from = f.querySelector('.from').value, to = f.querySelector('.to').value;
    if (g) p.set('group', g);
    if (a) p.set('account', a);
    if (from) p.set('from', String(new Date(`${from}T00:00`).getTime()));
    if (to) p.set('to', String(new Date(`${to}T00:00`).getTime() + 86400000));
    return p;
  };
  const row = e => `<tr><td>${when(e.at)}</td><td>${esc(e.actor_login || (e.action.startsWith('host.') ? 'host tool' : '-'))}</td><td><code>${esc(e.action)}</code></td>
    <td>${esc(e.target_login || '')}</td><td>${esc(e.ip || '')}</td><td class="det">${e.detail ? esc(JSON.stringify(e.detail)) : ''}</td></tr>`;
  const load = async (append = false) => {
    const p = query();
    p.set('limit', '100');
    if (append && last) p.set('before', String(last));
    const r = await getJ(`/api/audit?${p}`);
    if (!groups.length) {
      groups = r.groups;
      f.querySelector('.group').insertAdjacentHTML('beforeend', groups.map(g => `<option value="${g}">${esc(g[0].toUpperCase() + g.slice(1))}</option>`).join(''));
    }
    const html = r.events.map(row).join('');
    if (append) tbody.insertAdjacentHTML('beforeend', html);
    else tbody.innerHTML = html || '<tr><td colspan="6" class="hint">No events match</td></tr>';
    last = r.events.length ? r.events[r.events.length - 1].id : last;
    more.classList.toggle('hidden', r.events.length < 100);
  };
  f.onsubmit = e => { e.preventDefault(); last = null; load().catch(err => d.error(err)); };
  more.onclick = () => load(true).catch(err => d.error(err));
  for (const fmt of ['csv', 'jsonl']) {
    body.querySelector(`.${fmt}`).onclick = () => { const p = query(); p.set('format', fmt); downloadFile(`/api/audit?${p}`, `audit.${fmt}`).catch(err => d.error(err)); };
  }
  try { await load(); } catch (err) { d.error(err); }
}

// ------------------------------------------------------------------ Settings (DECISIONS C85, C90, C96, C98)
// Every installation setting from GET /api/settings, grouped by tier, with who may change it. Secrets show only as
// set / not set, and a blank field keeps the stored value. The key that encrypts stored secrets is named by its
// fingerprint, with any problem the server has with its key file.
const TIER_HEAD = {
  preferences: 'Preferences',
  secrets: 'Secrets: shown only as set / not set; changes ask for your password',
  infrastructure: 'How this installation runs and who may do what; changes ask for your password',
};
const SETTING_CLASS = { 'world.requireSignIn': 'rsi', 'registration.open': 'reg', 'security.require2fa': 'r2fa', 'audit.retentionDays': 'keep' };
export async function generalTab(d, body) {
  return settingsForm(d, body, {
    // (the limits on agents live on their own page, Agent limits: each setting is changed in one place)
    pick: v => ['preferences', 'secrets', 'infrastructure'].map(t => [TIER_HEAD[t], '', v.settings.filter(s => s.tierName === t && !AGENT_LIMIT_PATHS.has(s.path))]),
    extra: v => {
      const k = v.key;
      return k ? `<div class="sep"></div><div class="keyinfo${k.problem ? ' bad' : ''}"><b>Stored secrets</b> are encrypted with key <code>${esc(k.fingerprints[0] || '\u2014')}</code>${
        k.fingerprints[1] ? ` (the previous key <code>${esc(k.fingerprints[1])}</code> is kept for older backups)` : ''} from ${k.source === 'env' ? 'MVW_SECRET_KEY' : 'the key file'}.
        The owner rotates it on the server with <code>node tools/admin.mjs rotate-key</code>.${k.problem ? `<p class="warn">${esc(k.problem)}</p>` : ''}</div>` : '';
    },
  });
}
/**
 * A form of installation settings from GET /api/settings: the groups pick(v) chooses - [[heading, hint, settings,
 * advanced?]] (advanced: more settings, folded under "Advanced") - each
 * row as its type wants (a switch, a choice, a number, a secret, text), saved as it changes, with who may change it.
 * extra(v): more HTML below (General: the key that encrypts stored secrets). Used by General and Agent limits.
 */
export async function settingsForm(d, body, { pick, extra = () => '' }) {
  const byPath = {};
  const row = s => {
    const off = !s.canChange, dis = off ? ' disabled' : '', cls = SETTING_CLASS[s.path] || '', dp = `data-path="${esc(s.path)}"`;
    const why = off ? `<small class="why">${esc(s.why || 'You cannot change this')}</small>` : '';
    const help = s.help ? `<p class="hint">${esc(s.help)}</p>` : '';
    let field;
    if (s.type === 'boolean') {
      field = `<label class="check${off ? ' off' : ''}"><input type="checkbox" class="${cls}" ${dp}${s.value ? ' checked' : ''}${dis}> ${esc(s.label)}</label>`;
    } else if (s.type === 'days' || s.type === 'enum') {
      const opts = s.type === 'days' ? [...(s.choices || [null])] : [...s.values];
      if (s.value !== null && s.value !== undefined && !opts.includes(s.value)) opts.push(s.value);
      const text = o => (s.type === 'days' ? (o ? `${o} days` : 'forever') : s.valueLabels?.[o] ?? String(o));
      field = `<label${off ? ' class="off"' : ''}>${esc(s.label)}<span class="row"><select class="input ${cls}" ${dp}${dis}>${
        opts.map(o => `<option value="${esc(String(o ?? ''))}"${(o ?? null) === (s.value ?? null) ? ' selected' : ''}>${esc(text(o))}</option>`).join('')}</select></span></label>`;
    } else if (s.type === 'number') {
      field = `<label${off ? ' class="off"' : ''}>${esc(s.label)}<span class="row"><input class="input ${cls}" type="number" ${dp} min="${s.min}" max="${s.max}" step="${s.step || 1}" value="${esc(String(s.value ?? ''))}"${dis}></span></label>`;
    } else if (s.type === 'secret') {
      field = `<label${off ? ' class="off"' : ''}>${esc(s.label)} <span class="tag${s.set ? ' set' : ''}">${s.set ? 'set' : 'not set'}</span><span class="row">
        <input class="input" type="password" autocomplete="new-password" ${dp} placeholder="${s.set ? 'Leave blank to keep the stored value' : 'Not set'}"${dis}>
        <button type="button" class="btn small save" ${dp}${dis}>Save</button>${s.set ? `<button type="button" class="btn small clear" ${dp}${dis}>Clear</button>` : ''}</span></label>`;
    } else {
      field = `<label${off ? ' class="off"' : ''}>${esc(s.label)}<span class="row"><input class="input" ${dp} value="${esc(s.value ?? '')}"${dis}>
        <button type="button" class="btn small save" ${dp}${dis}>Save</button></span></label>`;
    }
    return field + why + help;
  };
  const toastFor = (s, value) => {
    if (s.type === 'secret') return value === null ? `${s.label} cleared` : `${s.label} saved`;
    if (s.type === 'boolean') return (value ? s.on : s.off) || `${s.label}: ${value ? 'on' : 'off'}`;
    return s.saved || `${s.label} saved`;
  };
  const load = async () => { try { render(await getJ('/api/settings')); } catch (err) { d.error(err); } };
  const save = async (path, value, rerender) => {
    const s = byPath[path];
    try {
      const v = await auth.call('/api/settings', { values: { [path]: value } });
      if (!(s.type === 'secret' && value === '')) app.toast(toastFor(s, value), 'good');
      if (rerender) render(v); else for (const x of v.settings) byPath[x.path] = { ...x, label: byPath[x.path]?.label ?? x.label };
    } catch (err) {
      if (err.code !== 'reauth_required') d.error(err);
      load();   // show what is stored
    }
  };
  function render(v) {
    for (const s of v.settings) byPath[s.path] = s;
    const groups = pick(v).filter(([, , l, adv]) => l.length || adv?.length);
    for (const [, , l, adv] of groups) for (const s of [...l, ...(adv || [])]) byPath[s.path] = s;   // (the page's own labels)
    body.innerHTML = `<div class="aform settings">
      ${groups.map(([t, hint, list, adv]) => `<div class="tier-head">${esc(t)}</div>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${list.map(row).join('')}${
        adv?.length ? `<details class="adv"><summary>Advanced</summary>${adv.map(row).join('')}</details>` : ''}`).join('<div class="sep"></div>')}
      ${extra(v)}
    </div>`;
    const form = body.querySelector('.aform.settings');
    form.addEventListener('change', e => {
      const el = e.target.closest('input[type="checkbox"][data-path], input[type="number"][data-path], select[data-path]');
      if (!el) return;
      const s = byPath[el.dataset.path];
      const value = el.type === 'checkbox' ? el.checked : s.type === 'days' || s.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
      save(el.dataset.path, value, false);
    });
    form.addEventListener('click', e => {
      const b = e.target.closest('button.save, button.clear');
      if (!b) return;
      const input = form.querySelector(`input[data-path="${CSS.escape(b.dataset.path)}"]`);
      save(b.dataset.path, b.classList.contains('clear') ? null : input.value, true);
    });
  }
  body.innerHTML = '<div class="hint">Loading\u2026</div>';
  await load();
}

// ------------------------------------------------------------------ Permissions (I14.3, C112)
// The least role that may use each capability; the owner changes one with a confirmed password. The server checks every
// change again, and refuses to lower a capability that needs an identity below member.
const ROLE_LIST = ['guest', 'member', 'admin', 'owner'];
export async function permissionsTab(d, body) {
  body.innerHTML = `
    <p class="hint">The least role that may use each capability. Capabilities that need an identity can never drop to guest. Changing one asks for your password.</p>
    <table class="adm-table perms"><thead><tr><th>Capability</th><th>What it allows</th><th>Minimum role</th></tr></thead><tbody></tbody></table>`;
  const row = c => {
    const id = c.cap || c.id || c.key || '';
    const min = c.min || c.role || 'guest';
    // A fixed capability is always its own role; one that needs an identity may rise but never fall to guest (I14.3).
    const opts = ROLE_LIST.map(r => `<option value="${r}"${r === min ? ' selected' : ''}${c.identity && r === 'guest' ? ' disabled' : ''}>${r}</option>`).join('');
    return `<tr data-cap="${esc(id)}"><td><code>${esc(id)}</code>${c.identity ? ' <span class="tag">account</span>' : ''}</td><td>${esc(c.desc || c.label || c.help || '')}</td>
      <td>${c.fixed ? esc(min) : `<select class="input small min" data-cap="${esc(id)}" aria-label="Minimum role of ${esc(id)}">${opts}</select>`}</td></tr>`;
  };
  const load = async () => {
    const v = await getJ('/api/permissions');
    const caps = Array.isArray(v.caps) ? v.caps : Object.entries(v.caps || {}).map(([cap, x]) => ({ cap, ...(x && typeof x === 'object' ? x : { min: x }) }));
    body.querySelector('tbody').innerHTML = caps.map(row).join('') || '<tr><td colspan="3" class="hint">Nothing to show</td></tr>';
  };
  body.querySelector('tbody').addEventListener('change', async e => {
    const sel = e.target.closest('.min');
    if (!sel) return;
    try {
      await auth.call('/api/permissions', { cap: sel.dataset.cap, min: sel.value });
      app.toast(`${sel.dataset.cap}: ${sel.value} and above`, 'good');
    } catch (err) { if (err.code !== 'reauth_required') d.error(err); }
    load().catch(err => d.error(err));
  });
  try { await load(); } catch (err) { d.error(err); }
}
