// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's Experience in its Studio (2026-10-28, the product owner: "instead of just a Cooking item on the agent studio, I
// think an Experience tab is better and that way we can bundle all 'games' in it that the world has to offer through
// modules, like fishing, flying and now cooking. That way we have a place for all the game Exp points/leveling/
// achievements/badges etc organized for agents"). Every play module of the world (shared/play.js: the airport, fishing,
// the arcade, Order Up, and any added later) the same way a player's profile has them, since an agent is scored as a
// player is (server/play/play.js: an agent plays as minus its id): its own level and rank over all the games, then each
// game, its level there, its best on each course (stars, score, place) and its badges, earned first; the platform's own
// badges last. Order Up adds the agent's shift (it cooks Rushes posted at a kitchen's pass: server/play/kitchen-shifts.js),
// its Cookbook and its cooking skills, the points spent by its owner (+) or by itself with Free Will.
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { formatScore } from '/shared/play.js';

const STARS = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
const TIERS = ['platinum', 'gold', 'silver', 'bronze'];
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const bar = pct => `<span class="xp-bar"><i style="width:${Math.round((pct || 0) * 100)}%"></i></span>`;
/** Badges as chips: those earned first (rarest first), then those still to earn, greyed (a secret one says so). */
function chips(list, have) {
  return list.slice().sort((a, b) => (have.has(b.id) - have.has(a.id)) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))
    .map(b => `<span class="xp-badge t-${b.tier}${have.has(b.id) ? '' : ' off'}" title="${esc(b.desc)}">${b.icon} ${esc(b.label)}</span>`).join('');
}

export async function experienceTab(C, body, live) {
  const id = C.id;
  let cat, prof, cook;
  try { [cat, prof, cook] = await Promise.all([getJSON('/api/play'), getJSON(`/api/play/profile?id=${-id}`), getJSON(`/api/orderup/agent?id=${id}`).catch(() => null)]); }
  catch (e) { if (live()) body.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  if (!live()) return;
  const name = esc(prof.name || C.rec()?.name || 'It'), have = new Set(prof.badges.map(b => b.id));
  const all = cat.badges, mods = cat.modules, platform = all.filter(b => !b.module);
  const played = mods.filter(m => prof.modules[m.id]?.runs > 0).length;
  // the agent over all the games: its rank, its level, its experience (a player's own, the same curve)
  let html = `<div class="xp">
    <div class="st-sec"><div class="st-sec-h"><h4>🏆 Experience</h4><span class="xp-rank" title="Rank by its level over all the games">${prof.rank.icon} ${esc(prof.rank.name)}</span></div>
      <div class="xp-lv">Level <b>${prof.level}</b>${bar(prof.progress?.pct)}<span class="dim">${Number(prof.xp).toLocaleString('en-US')} XP · ${prof.runs} run${prof.runs === 1 ? '' : 's'} · ${prof.stars} ★ · ${have.size} of ${all.length} badges · ${played} of ${mods.length} games played</span></div>
      <p class="hint">The world's games, scored exactly as players are: the same courses, rules and checks, its levels, ranks and badges comparable with anyone's.</p></div>`;
  // each game: its level, its courses, its badges (Order Up: its shift, its Cookbook, its skills)
  for (const m of mods) {
    const M = prof.modules[m.id] || { level: 1, runs: 0, best: {}, progress: { pct: 0 } }, mb = all.filter(b => b.module === m.id), got = mb.filter(b => have.has(b.id)).length;
    const best = m.courses.filter(c => M.best?.[c.id]), rest = m.courses.length - best.length;
    const courses = best.length ? `<div class="xp-courses">${best.map(c => { const b = M.best[c.id]; return `<span><b>${esc(c.label)}</b> <span class="xp-st">${STARS(b.stars)}</span> ${esc(formatScore(m, b.score))}${b.place ? ` · #${b.place}` : ''}</span>`; }).join('')}</div>${rest ? `<p class="dim xp-more">${rest} more ${rest === 1 ? 'course' : 'courses'} to try</p>` : ''}`
      : `<p class="dim xp-more">Not played yet${m.id === 'orderup' ? `: post ${name} at a kitchen's pass (its ⋯) and it cooks Rushes on its hours` : ''}.</p>`;
    const extra = m.id === 'orderup' && cook ? cooking(cook, name) : '';
    html += `<details class="st-sec xp-game"${M.runs > 0 || (m.id === 'orderup' && cook?.shift?.cooking) ? ' open' : ''}><summary class="st-sec-h"><h4>${m.icon} ${esc(m.label)}</h4>
        <span class="xp-gl">Level <b>${M.level}</b>${bar(M.progress?.pct)}<span class="dim">${M.runs} run${M.runs === 1 ? '' : 's'} · 🏅 ${got}/${mb.length}</span></span></summary>
      ${extra}${courses}<div class="xp-badges">${chips(mb, have)}</div></details>`;
  }
  html += `<details class="st-sec xp-game"${platform.some(b => have.has(b.id)) ? ' open' : ''}><summary class="st-sec-h"><h4>🌟 All-round</h4><span class="dim">🏅 ${platform.filter(b => have.has(b.id)).length}/${platform.length}</span></summary>
      <div class="xp-badges">${chips(platform, have)}</div></details>`;
  if (prof.recent?.length) html += `<div class="st-sec"><div class="st-sec-h"><h4>📜 Lately</h4></div><ul class="xp-recent">${prof.recent.slice(0, 6).map(r => { const m = mods.find(x => x.id === r.module), c = m?.courses.find(x => x.id === r.course);
    return `<li><span>${m?.icon || '🎮'} ${esc(c?.label || r.course)}</span><span class="xp-st">${STARS(r.stars)}</span><span>${m ? esc(formatScore(m, r.score)) : r.score}</span><span class="dim">+${r.xp} XP · ${ago(r.at)}</span></li>`; }).join('')}</ul></div>`;
  body.innerHTML = `${html}</div>`;
  const why = m => { const w = body.querySelector('.xp-why'); if (w) w.textContent = m || ''; };
  body.querySelectorAll('.xp-up').forEach(b => b.addEventListener('click', async e => { e.preventDefault(); try { await post('/api/orderup/agent-skill', { agent: id, id: b.dataset.s }); experienceTab(C, body, live); } catch (er) { why(er.message); } }));
  body.querySelector('.xp-who')?.addEventListener('change', async e => { try { await post('/api/orderup/agent-mode', { agent: id, mode: e.target.value }); experienceTab(C, body, live); } catch (er) { why(er.message); } });
}

/** Order Up's own part: the agent's shift now and its last Rush, its Cookbook, its cooking skills (+ for its owner) and who
 *  spends its points. */
function cooking(d, name) {
  const sh = d.shift || {}, last = sh.last, S = d.skills, free = d.own ? S.points.free : 0;
  const shift = sh.cooking ? `🔥 Cooking <b>${esc(sh.course || 'a Rush')}</b> now` : sh.today ? `Between Rushes · ${sh.today} of ${sh.cap} today` : '';
  const who = d.mode === 'owner' ? 'owner' : d.mode === 'self' ? 'self' : d.freeWill ? 'self' : 'owner';
  const skills = S.list.map(x => `<div class="xp-skill" title="${esc(x.blurb)}"><span>${x.icon} ${esc(x.name)}</span><span class="xp-pips">${'●'.repeat(x.rank)}${'○'.repeat(S.max - x.rank)}</span>${free && x.rank < S.max ? `<button type="button" class="xp-up" data-s="${x.id}" aria-label="A point into ${esc(x.name)}">+</button>` : '<span></span>'}</div>`).join('');
  return `<div class="xp-cook">
      ${shift ? `<p class="xp-shift">${shift}</p>` : ''}${last ? `<p class="dim xp-last">Last Rush: ${esc(last.label)} · ${last.score} pts · ${STARS(last.stars)} · +${last.xp} XP · ${ago(last.at)}</p>` : ''}
      <p class="xp-book">📖 Cookbook <b>${d.cookbook.count}</b> of ${d.cookbook.all} dishes${d.stats?.served ? ` · ${d.stats.served} served, ${d.stats.supreme || 0} Supreme` : ''}</p>
      <div class="xp-sk-h"><b>🎓 Cooking skills</b><span class="dim">${S.points.free} of ${S.points.total} point${S.points.total === 1 ? '' : 's'} to spend</span></div>
      ${d.own ? `<label class="xp-mode">Who spends its points <select class="input xp-who"><option value="self"${who === 'self' ? ' selected' : ''}>${name} chooses${d.freeWill ? '' : ' (when its Free Will is on)'}</option><option value="owner"${who === 'owner' ? ' selected' : ''}>I choose</option></select></label>` : ''}
      <div class="xp-skills">${skills}</div><div class="xp-why"></div>
      <p class="hint">Its shifts earn half the experience of playing, and no prizes: its post pays it.</p></div>`;
}
