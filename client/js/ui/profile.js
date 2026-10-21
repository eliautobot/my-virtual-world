// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The player's profile (docs/features/play-modules.md): the Agent Studio's idea for people — a page for a player. Its
// rank and level, the badges it has earned (three pinned to show off), its progress in every play module with its best
// results and places, the leaderboards, and its last runs. The own profile edits the bio and the pinned badges and opens
// the character's look. Opened from the account menu (My profile), the online list, friends and the leaderboards;
// app.profile.open(accountId?) and app.profile.board(module, course) open it from anywhere (the modules' own screens).
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { formatScore, TIERS, fmtVc } from '/shared/play.js';

let app = null, M = null, catalog = null;
const RANKS = { rookie: '🔰', bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💠', diamond: '💎', legend: '👑' };
const when = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const stars = n => `<span class="pf-stars" data-noicon title="${n} of 3 stars">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, 3 - n))}</i></span>`;

export function init(a) {
  app = a;
  app.profile = { open, board, refresh: () => M && M.reload() };
  app.hooks?.key?.unshift(e => { if (!M) return false; if (e.key === 'Escape') close(); return true; });   // the world's keys stay off while it is open
}
async function load() {
  if (!catalog) catalog = await getJSON('/api/play');
  return catalog;
}
function close() { if (!M) return; M.el.remove(); M = null; if (app.cam) app.cam.keysEnabled = true; }

/** Opens a player's profile (the own one without an id). */
export async function open(id = null, tab = 'badges') {
  if (!auth.can('play.use')) { auth.ui?.signIn?.('Sign in to see players\' profiles'); return; }
  close();
  const el = document.body.appendChild(h(`<div class="modal-back pf-scrim"><div class="panel pf" role="dialog" aria-modal="true" aria-label="Player profile">
    <button class="btn small pf-x" title="Close (Esc)">✕</button><div class="pf-body"><p class="hint">Loading…</p></div></div></div>`));
  M = { el, id, tab, view: 'profile', reload: () => render() };
  if (app.cam) app.cam.keysEnabled = false;
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
  el.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
  el.querySelector('.pf-x').onclick = close;
  el.querySelector('.pf').addEventListener('click', onClick);
  el.addEventListener('change', e => { if (e.target.closest('.pf-bsel') && M?.board) { M.board.course = e.target.value; render(); } });
  await render();
}
/** Opens a course's leaderboard. */
export async function board(module, course) { await open(null, 'modules'); if (M) { M.view = 'board'; M.board = { module, course }; render(); } }

async function render() {
  if (!M) return;
  const body = M.el.querySelector('.pf-body');
  try {
    const cat = await load();
    if (M.view === 'board') { body.innerHTML = await boardHtml(cat, M.board.module, M.board.course); return; }
    const p = M.p = await getJSON(`/api/play/profile${M.id ? `?id=${M.id}` : ''}`);
    body.innerHTML = profileHtml(cat, p);
  } catch (err) { body.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

function badgeById(cat, id) { return cat.badges.find(b => b.id === id); }
function profileHtml(cat, p) {
  const earned = new Map(p.badges.map(b => [b.id, b.at])), rank = p.rank, pg = p.progress;
  const show = p.showcase.map(id => badgeById(cat, id)).filter(Boolean);
  const tabs = [['badges', `🏅 Badges <small>${p.badges.length}/${cat.badges.length}</small>`], ['modules', '🎮 Modules'], ['recent', '🕒 Recent']];
  return `
  <div class="pf-head" style="--rank:${rank.color}">
    <div class="pf-av"><span>${esc((p.name || '?').slice(0, 1).toUpperCase())}</span><b class="pf-lv" title="Player level">${p.level}</b></div>
    <div class="pf-who">
      <h3>${esc(p.name)}${p.own ? ' <small class="dim">(you)</small>' : ''}</h3>
      <div class="pf-rank"><span class="pf-rk">${rank.icon} ${esc(rank.name)}</span> · Level ${p.level} · ${p.xp.toLocaleString()} XP</div>
      <div class="pf-xp" title="${Math.round(pg.xp - pg.from)} of ${pg.to - pg.from} XP to level ${p.level + 1}"><i style="width:${(pg.pct * 100).toFixed(1)}%"></i></div>
      <div class="pf-facts dim">${p.runs} run${p.runs === 1 ? '' : 's'} · ${p.stars} ★${p.vc ? ` · <b class="pf-vc">${fmtVc(p.vc)} won</b>` : ''} · playing since ${when(p.since)}</div>
    </div>
    ${p.own ? '<div class="pf-acts"><button class="btn small pf-look">🎨 Edit my look</button><button class="btn small pf-top">🏆 Top players</button></div>' : '<div class="pf-acts"><button class="btn small pf-mine">👤 My profile</button></div>'}
  </div>
  ${show.length ? `<div class="pf-show">${show.map(b => `<div class="pf-sb t-${b.tier}" title="${esc(b.desc)}"><span>${b.icon}</span><b>${esc(b.label)}</b></div>`).join('')}</div>` : ''}
  ${p.own ? `<div class="pf-bio own"><textarea maxlength="280" placeholder="Say something about yourself (280 characters)…">${esc(p.bio)}</textarea><button class="btn small primary pf-save">Save</button></div>`
    : p.bio ? `<p class="pf-bio">${esc(p.bio)}</p>` : ''}
  <div class="pf-tabs" role="tablist">${tabs.map(([k, t]) => `<button class="btn small pf-tab${M.tab === k ? ' on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
  <div class="pf-pane">${M.tab === 'modules' ? modulesHtml(cat, p) : M.tab === 'recent' ? recentHtml(cat, p) : badgesHtml(cat, p, earned)}</div>`;
}

function badgesHtml(cat, p, earned) {
  const groups = [[null, 'Everywhere'], ...cat.modules.map(m => [m.id, `${m.icon} ${m.label}`])];
  const order = b => TIERS.indexOf(b.tier);
  return `${p.own ? '<p class="hint">Click a badge you have earned to pin it to your profile (up to three).</p>' : ''}` + groups.map(([mod, title]) => {
    const list = cat.badges.filter(b => b.module === mod).sort((a, b) => (earned.has(b.id) ? 0 : 1) - (earned.has(a.id) ? 0 : 1) || order(a) - order(b));
    if (!list.length) return '';
    return `<h4>${esc(title)}</h4><div class="pf-badges">${list.map(b => {
      const at = earned.get(b.id), pinned = p.showcase.includes(b.id);
      return `<div class="pf-b t-${b.tier}${at ? ' got' : ''}${pinned ? ' pinned' : ''}${p.own && at ? ' pin' : ''}" data-badge="${b.id}" title="${esc(b.desc)}${at ? ` — earned ${when(at)}` : ''}">
        <span class="pf-bi">${at || !b.secret ? b.icon : '❔'}</span><b>${esc(b.label)}</b><small>${at ? `${pinned ? '📌 ' : ''}${when(at)}` : esc(b.desc)}</small></div>`;
    }).join('')}</div>`;
  }).join('');
}

function modulesHtml(cat, p) {
  return cat.modules.map(m => {
    const mp = p.modules[m.id] || { level: 1, runs: 0, best: {}, unlocked: [m.courses[0].id], progress: { pct: 0 } };
    return `<div class="pf-mod">
      <div class="pf-mh"><span class="pf-mi">${m.icon}</span><div><b>${esc(m.label)}</b> <span class="tag">Level ${mp.level}</span><div class="dim">${esc(m.blurb)}</div>
        <div class="pf-xp small"><i style="width:${(mp.progress.pct * 100).toFixed(1)}%"></i></div></div></div>
      <table class="pf-courses"><tbody>${m.courses.map((c, k) => {
        const b = mp.best[c.id], open = mp.unlocked.includes(c.id);
        return `<tr class="${open ? '' : 'locked'}"><td class="n">${k + 1}</td><td><b>${esc(c.label)}</b><small class="dim"> ${esc(c.tier)} · difficulty ${c.difficulty}</small></td>
          <td>${b ? stars(b.stars) : open ? '<span class="dim">not flown</span>' : '🔒'}</td><td class="sc">${b ? esc(formatScore(m, b.score)) : ''}</td>
          <td class="pl">${b ? `#${b.place}` : ''}</td><td class="pz">${m.prizes?.[c.id] ? `<span title="The most this course pays: a first three-star record run">up to ${fmtVc(m.prizes[c.id])}</span>` : ''}</td><td><button class="btn small pf-board" data-m="${m.id}" data-c="${c.id}" title="Leaderboard">🏆</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
  }).join('');
}

function recentHtml(cat, p) {
  if (!p.recent.length) return '<p class="hint">No runs yet.</p>';
  const mod = id => cat.modules.find(m => m.id === id);
  return `<table class="pf-courses"><tbody>${p.recent.map(r => { const m = mod(r.module), c = m?.courses.find(x => x.id === r.course);
    return `<tr><td>${m?.icon || '🎮'}</td><td><b>${esc(c?.label || r.course)}</b></td><td>${stars(r.stars)}</td><td class="sc">${m ? esc(formatScore(m, r.score)) : r.score}</td><td class="dim">+${Math.round(r.xp)} XP${r.vc ? ` · <b class="pf-vc">+${fmtVc(r.vc)}</b>` : ''}</td><td class="dim">${when(r.at)}</td></tr>`; }).join('')}</tbody></table>`;
}

async function boardHtml(cat, module, course) {
  const m = cat.modules.find(x => x.id === module), c = m?.courses.find(x => x.id === course);
  if (!c) return '<p class="err">No such course</p>';
  const b = await getJSON(`/api/play/leaderboard?module=${encodeURIComponent(module)}&course=${encodeURIComponent(course)}&limit=25`);
  const row = r => `<tr class="${r.id === b.you?.id ? 'you' : ''}"><td class="n">${r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : `#${r.place}`}</td>
    <td><a href="#" class="pf-who-l" data-id="${r.id}">${esc(r.name)}</a> <small title="${esc(r.rank)}">${RANKS[r.rank] || ''} ${r.level}</small></td><td>${stars(r.stars)}</td><td class="sc">${esc(formatScore(m, r.score))}</td></tr>`;
  const others = m.courses.map(x => `<option value="${x.id}"${x.id === c.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
  return `<div class="pf-bh"><button class="btn small pf-back">← Profile</button><h3>${m.icon} ${esc(m.label)} leaderboard</h3><select class="pf-bsel">${others}</select></div>
    <p class="dim">${esc(c.blurb || '')} Stars: ★ ${esc(formatScore(m, c.stars[0]))} · ★★ ${esc(formatScore(m, c.stars[1]))} · ★★★ ${esc(formatScore(m, c.stars[2]))}</p>
    ${b.rows.length ? `<table class="pf-courses board"><tbody>${b.rows.map(row).join('')}${b.you && !b.rows.some(r => r.id === b.you.id) ? `<tr class="gap"><td colspan="4">…</td></tr>${row(b.you)}` : ''}</tbody></table>` : '<p class="hint">Nobody has finished this course yet — be the first.</p>'}`;
}
async function topHtml() {
  const t = await getJSON('/api/play/top?limit=25');
  return `<div class="pf-bh"><button class="btn small pf-back">← Profile</button><h3>🏆 Top players</h3></div>
    ${t.rows.length ? `<table class="pf-courses board"><tbody>${t.rows.map(r => `<tr><td class="n">${r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : `#${r.place}`}</td>
      <td><a href="#" class="pf-who-l" data-id="${r.id}">${esc(r.name)}</a></td><td>${RANKS[r.rank] || ''} Level ${r.level}</td><td class="sc">${r.xp.toLocaleString()} XP</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Nobody has played yet.</p>'}`;
}

async function onClick(e) {
  const t = e.target;
  const tab = t.closest('.pf-tab'); if (tab) { M.tab = tab.dataset.tab; render(); return; }
  const bd = t.closest('.pf-board'); if (bd) { M.view = 'board'; M.board = { module: bd.dataset.m, course: bd.dataset.c }; render(); return; }
  if (t.closest('.pf-back')) { M.view = 'profile'; render(); return; }
  const who = t.closest('.pf-who-l'); if (who) { e.preventDefault(); M.id = +who.dataset.id; M.view = 'profile'; M.tab = 'badges'; render(); return; }
  if (t.closest('.pf-mine')) { M.id = null; render(); return; }
  if (t.closest('.pf-top')) { M.view = 'top'; M.el.querySelector('.pf-body').innerHTML = await topHtml(); return; }
  if (t.closest('.pf-look')) { close(); app.openCustomizer?.(); return; }
  if (t.closest('.pf-save')) { await save({ bio: M.el.querySelector('.pf-bio textarea').value }, 'Profile saved'); return; }
  const pin = t.closest('.pf-b.pin');
  if (pin && M.p?.own) {
    const id = pin.dataset.badge, cur = M.p.showcase;
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    if (next.length > 3) { app.toast('Pin at most three badges — unpin one first', 'warn', 3000); return; }
    await save({ showcase: next }, cur.includes(id) ? 'Badge unpinned' : 'Badge pinned to your profile');
  }
}
async function save(body, ok) {
  try { await post('/api/play/profile', body); app.toast(ok, 'good', 2200); render(); }
  catch (err) { if (!err.quiet) app.toast(err.message, 'bad', 4000); }
}
