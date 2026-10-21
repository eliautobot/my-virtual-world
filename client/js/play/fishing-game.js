// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing game (docs/features/fishing.md §Fishing): out in a boat from a dock, at one of its fishing spots
// (player/boating.js), with a trip under way (🎣 Trips, T: the server lays the trip's grounds out round the dock -
// POST /api/play/start - and keeps its catch itself).
//   · Cast: hold (Space, or the big button) - the power swings, a ring shows where it lands on the water the way the
//     camera looks (out from the side you're fishing) - and let go: the rod comes over, the lure flies on its arc and
//     lands with a splash.
//   · Wait: a bobber rides the waves (bait), a lure is reeled slowly back (hold: reel; a tap: a twitch). Over a ground
//     the fish come sooner (shared/fishing-trip.js biteEvery). Nibbles - the bobber dips - then the strike: it goes
//     under, HOOK! Too soon and it spooks; too late and it steals the bait.
//   · The server rolls what took it (POST /api/play/act hook). The fight (shared/fishing-fight.js, stepped here): hold
//     to reel, steer against its runs (A/D, the stick), ease off in the red, bow to its jumps (S, or tap BOW), and land
//     it when it's beaten and close (E, LAND) - the net, then the server's check (act land) and the catch held up,
//     its card: name, size, weight, what it's worth; keep it or let it go.
//   · The trip: its clock to dusk, its bounties, the cooler. Back at the dock (stepping off), or 🏁 End: the server
//     works the trip out (POST /api/play/finish) - stars, the leaderboard, XP.
import * as THREE from 'three';
import { bus } from '../core/state.js';
import { h, esc, isTouch } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { formatScore, fmtVc } from '/shared/play.js';
import { CLIP } from '../render/anim.js';
import { PLAYER_APP } from '../render/agents.js';
import { bodyToWorld } from '../render/characters.js';
import { FishingFx } from '../render/fishing-fx.js';
import { TripNav } from './fishing-nav.js';
import { initStore } from './fish-store.js';
import { initFishdex } from './fishdex.js';
import { heights, waterUnder } from '../render/sea-probe.js';
import { kitFor, hourAt } from '/shared/fishing.js';
import { biteEvery, bountiesMet, TRIP_BY_ID } from '/shared/fishing-trip.js';
import { LURE_BY_ID, luresFor } from '/shared/fishing-gear.js';
import { speciesOf, findOf, RARITY, sizeOf, valueOf, toLb } from '/shared/fish-species.js';
import { fightSetup, fightStep, FIGHT_DT, botInput } from '/shared/fishing-fight.js';

const TIP = [1.96, 0, 0.013];          // the rod's tip in the right hand's grip frame (render/char-props.js rod)
const AIM_SWING = 1.3, CAST_MIN = 4, AIM_ARC = 1.3;
const TEST = new URLSearchParams(location.search).has('fishtest');   // (lab checks: quick bites, a steady hand)
let app = null, fx = null, nav = null, E = {}, cat = null, prog = null, trip = null, A = null, lastMs = 0;
const keys = new Set();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _tip = new THREE.Vector3(), _q = [0, 0, 0];

export function init(a) {
  app = a;
  if (!app.boating) return;
  build(document.getElementById('ui'));
  initStore(app); initFishdex(app);
  app.hooks.key.unshift(onKey);
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Space') up(); });
  window.addEventListener('blur', () => { keys.clear(); if (A?.held) up(); });
  bus.on('boating', ev => { E.btn.classList.toggle('hidden', !ev.on); if (!ev.on) { stand(); if (trip) finish('Back ashore'); closePick(); } });
  bus.on('boat-fish', ev => { if (ev.on) sitDown(); else stand(); });
  bus.on('frame', (dt, now) => frame(Math.min(0.1, dt), now / 1000));
  app.fishing = { get trip() { return trip; }, get state() { return A?.st || null; }, open: openPick, start, finish: () => finish(null), get nav() { return nav; }, debug: { auto: false, fast: false } };
  if (TEST) Object.assign(app.fishing.debug, { auto: true, fast: true });
}

// ------------------------------------------------------------------ the screen
function build(root) {
  E.btn = root.appendChild(h('<button type="button" class="btn fg-open hidden" title="Fishing trips (T)">🎣 Trips <kbd>T</kbd></button>'));
  E.btn.onclick = () => (E.pick.classList.contains('hidden') ? openPick() : closePick());
  E.hud = root.appendChild(h(`<div id="fishhud" class="hidden"><div class="fh-top"><b class="fh-name"></b><button type="button" class="btn small fh-chart" title="The chart: the grounds, set a course (C)">🗺️ <kbd>C</kbd></button><button type="button" class="btn small fh-end" title="End the trip: the catch is weighed in">🏁 End</button></div>
    <div class="fh-clock"></div><div class="fh-bounties"></div><div class="fh-cool"></div></div>`));
  E.hud.querySelector('.fh-end').onclick = () => finish(null);
  E.hud.querySelector('.fh-chart').onclick = () => nav?.toggleChart();
  E.ctl = root.appendChild(h(`<div id="fishctl" class="hidden">
    <button type="button" class="btn fc-lure" title="Change the lure (L)"></button>
    <button type="button" class="btn fc-in" title="Reel all the way in (R)">⤓ Reel in</button>
    <button type="button" class="fc-bow hidden">BOW!</button>
    <button type="button" class="fc-act"><svg viewBox="0 0 100 100"><circle class="fc-track" cx="50" cy="50" r="44"/><circle class="fc-ring" cx="50" cy="50" r="44"/></svg><b>CAST</b><small></small></button></div>`));
  E.act = E.ctl.querySelector('.fc-act'); E.actL = E.act.querySelector('b'); E.actS = E.act.querySelector('small'); E.ring = E.act.querySelector('.fc-ring');
  E.act.addEventListener('pointerdown', e => { e.preventDefault(); try { E.act.setPointerCapture?.(e.pointerId); } catch { /* gone */ } down(); });
  for (const ev of ['pointerup', 'pointercancel']) E.act.addEventListener(ev, () => up());
  E.lure = E.ctl.querySelector('.fc-lure'); E.lure.onclick = () => nextLure();
  E.ctl.querySelector('.fc-in').onclick = () => reelIn();
  E.bow = E.ctl.querySelector('.fc-bow'); E.bow.addEventListener('pointerdown', e => { e.preventDefault(); if (A) A.bowQ = true; });
  E.gauge = root.appendChild(h(`<div id="fishgauge" class="hidden"><div class="fg-row"><small>TENSION</small><span class="fg-bar fg-t"><i></i><em></em></span></div>
    <div class="fg-row"><small>FISH</small><span class="fg-bar fg-s"><i></i></span><b class="fg-line"></b></div><div class="fg-hint"></div></div>`));
  E.prompt = root.appendChild(h('<div id="fishprompt" class="hidden"></div>'));
  E.card = root.appendChild(h('<div id="fishcard" class="panel hidden" role="dialog" aria-label="Your catch"></div>'));
  E.card.addEventListener('click', onCardClick);
  E.pick = root.appendChild(h('<div id="fishpick" class="panel hidden" role="dialog" aria-label="Fishing trips"><div class="rp-head"><h3>🎣 Fishing trips</h3><button type="button" class="btn small rp-x">✕</button></div><div class="rp-body"></div></div>'));
  E.pick.querySelector('.rp-x').onclick = closePick;
  E.pick.addEventListener('click', e => { const s = e.target.closest('[data-start]'); if (s) start(s.dataset.start); const b = e.target.closest('[data-board]'); if (b) app.profile?.board('fishing', b.dataset.board); if (e.target.closest('[data-gear]')) { closePick(); app.fishStore?.open('tackle'); } if (e.target.closest('[data-dex]')) { closePick(); app.fishdex?.open(); } });
  E.res = root.appendChild(h('<div id="fishres" class="panel hidden" role="dialog" aria-label="Trip result"></div>'));
  E.res.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.again) { E.res.classList.add('hidden'); start(t.dataset.again); } else if (t.dataset.board) app.profile?.board('fishing', t.dataset.board); else if (t.dataset.dex !== undefined) { E.res.classList.add('hidden'); app.fishdex?.open(t.dataset.dex || null); } else E.res.classList.add('hidden'); });
}
function onKey(e) {
  if (!app.boating?.active) return false;
  const c = e.code, fishing = !!A;
  if (c === 'KeyT' && !e.repeat) { E.pick.classList.contains('hidden') ? openPick() : closePick(); return true; }
  if (c === 'Escape' && !E.pick.classList.contains('hidden')) { closePick(); return true; }
  if (c === 'Escape' && !E.res.classList.contains('hidden')) { E.res.classList.add('hidden'); return true; }
  if (c === 'KeyC' && !e.repeat && trip) { nav?.toggleChart(); return true; }
  if (c === 'Escape' && nav && !nav.E.chart.classList.contains('hidden')) { nav.closeChart(); return true; }
  if (!fishing) return false;
  keys.add(c);
  if (c === 'Space') { if (!e.repeat) down(); return true; }
  if (c === 'KeyS' && A.st === 'fight') { A.bowQ = true; return true; }
  if (c === 'KeyE' && (A.st === 'fight' || A.st === 'reelfind')) { A.landQ = true; return true; }
  if (c === 'KeyE' && busy()) return true;   // (a fish on, a cast going: E doesn't stand you up)
  if (c === 'KeyE' && A.st === 'reveal') { closeCard(); return true; }
  if (c === 'KeyL' && !e.repeat) { nextLure(); return true; }
  if (c === 'KeyR' && !e.repeat) { reelIn(); return true; }
  if ((c === 'KeyA' || c === 'KeyD' || c === 'ArrowLeft' || c === 'ArrowRight') && busy()) return true;
  return false;
}
const busy = () => A && ['aim', 'cast', 'strike', 'hooking', 'fight', 'land', 'reelfind'].includes(A.st);

// ------------------------------------------------------------------ trips
async function load() { [cat, prog] = await Promise.all([cat ? Promise.resolve(cat) : getJSON('/api/play'), getJSON('/api/play/profile').catch(() => null)]); }
const waterHere = () => (app.boating?.type === 'skiff' ? 'lake' : 'sea');
async function openPick() {
  if (!app.boating?.active) return;
  E.res.classList.add('hidden'); E.pick.classList.remove('hidden');
  const body = E.pick.querySelector('.rp-body');
  body.innerHTML = '<p class="hint">Loading…</p>';
  try { await load(); } catch (err) { body.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
  const m = cat.modules.find(x => x.id === 'fishing'), water = waterHere(), mine = prog?.modules?.fishing || { best: {}, unlocked: [] };
  const row = c0 => {
    const c = { ...TRIP_BY_ID[c0.id], ...c0 };   // (the catalog's course, with the trip's water, minutes and reach)
    const b = mine.best[c.id], open = mine.unlocked.includes(c.id) || !c.after, after = c.after ? m.courses.find(x => x.id === c.after) : null;
    const stars = b ? `<span class="pf-stars" data-noicon>${'★'.repeat(b.stars)}<i>${'★'.repeat(3 - b.stars)}</i></span>` : '';
    const now = trip?.course.id === c.id;
    return `<div class="rp-row${open ? '' : ' off'}">
      <div class="rp-l"><b>${esc(c.label)}</b> <span class="rp-dots" title="Difficulty ${c.difficulty} of 10">${'●'.repeat(Math.ceil(c.difficulty / 2))}<i>${'●'.repeat(5 - Math.ceil(c.difficulty / 2))}</i></span>
        <small class="dim">${esc(c.blurb || '')} · ${c.minutes} min to dusk${c.reach ? ` · ${(c.reach / 1000).toFixed(1)} km out` : ''}</small>
        <small>${b ? `Best ${esc(formatScore(m, b.score))} ${stars} · #${b.place}` : `★ ${esc(formatScore(m, c.stars[0]))} · ★★ ${esc(formatScore(m, c.stars[1]))} · ★★★ ${esc(formatScore(m, c.stars[2]))}`}</small></div>
      <div class="rp-r">${!open ? `<small class="dim">🔒 ${esc(after?.label || 'the one before')} first</small>` : now ? '<small class="dim">Under way</small>' : `<button type="button" class="btn primary small" data-start="${c.id}">Go</button>`}<button type="button" class="btn small" data-board="${c.id}" title="Leaderboard">🏆</button></div></div>`;
  };
  body.innerHTML = `<p class="hint">${water === 'lake' ? 'Lake trips from this dock.' : 'Sea trips from this marina.'} The trip runs until dusk; walk to a fishing spot (F, then a ring on the deck) and cast. Stepping off at the dock weighs your catch in.</p><div class="rr-acts"><button type="button" class="btn small" data-gear="1">🎣 Gear &amp; skills</button><button type="button" class="btn small" data-dex="1">📖 Fishdex</button></div>${m.courses.filter(c => TRIP_BY_ID[c.id]?.water === water).map(row).join('')}`;
}
function closePick() { E.pick.classList.add('hidden'); }
async function start(courseId) {
  if (!app.boating?.active) return;
  closePick();
  if (trip) await finish(null, true);
  let r;
  try { r = await post('/api/play/start', { module: 'fishing', course: courseId, where: app.boating.module }); }
  catch (err) { app.toast(err.message, 'bad', 4000); return; }
  if (!cat) await load().catch(() => {});
  const m = cat?.modules.find(x => x.id === 'fishing'), c = { ...TRIP_BY_ID[courseId], ...(m?.courses.find(x => x.id === courseId) || {}), minutes: r.data.plan.minutes };
  const water = r.data.plan.water, kit = r.data.kit || {};
  trip = { id: r.run, m, course: c, data: r.data, plan: r.data.plan, water, L: kitFor(kit, water), t0: performance.now(), caught: [], lures: { ...(kit.lures || {}) }, lure: null, best: r.best };
  trip.lure = luresFor(water).find(l => trip.lures[l.id] > 0)?.id || 'spinner';
  getJSON('/api/fishing/dex').then(d => { if (trip?.id === r.run) trip.dex = d; }).catch(() => {});   // (the catch card: new to your Fishdex, over the record)
  fx ||= new FishingFx(app.stage); nav ||= new TripNav(app, () => fx);
  nav.begin(trip);
  E.hud.classList.remove('hidden');
  E.hud.querySelector('.fh-name').textContent = `🎣 ${c.label}`;
  hudTrip(true); lureUi();
  const g = trip.plan.grounds.filter(x => !x.hidden).length;
  app.toast(`${c.label}: ${g} fishing ground${g === 1 ? '' : 's'} to find before dusk${app.boating.fishing ? ' - cast away!' : ' - walk to a fishing spot (F) and cast'}`, 'good', 4500);
  bus.emit('fish-trip', { on: true, course: c.id });
}
/** The trip's end: the server weighs the catch in (quiet: just end it, no card). */
async function finish(why, quiet = false) {
  if (!trip) return;
  const t = trip; trip = null;
  if (A && A.st !== 'ready') toReady();
  nav?.end();
  E.hud.classList.add('hidden');
  bus.emit('fish-trip', { on: false });
  let res;
  try { res = await post('/api/play/finish', { run: t.id, report: {} }); }
  catch (err) { if (!quiet) app.toast(err.message, 'bad', 4000); return; }
  prog = null; app.profile?.refresh?.(); app.inventory?.refresh?.(); app.fishdex?.refresh?.();
  if (!quiet) result(t, res, why);
}
function result(t, x, why) {
  const m = t.m, c = t.course, kept = t.caught.filter(k => k.kept), sum = kept.reduce((a, k) => a + (k.vc || 0), 0);
  const list = kept.length ? `<div class="fr-catch">${kept.slice(0, 24).map(k => `<span title="${esc(k.name)}">${k.find ? '📦' : '🐟'} ${esc(k.name)} <small>${k.find ? '' : `${k.cm} cm · ${k.kg.toFixed(k.kg < 10 ? 2 : 1)} kg`}</small></span>`).join('')}</div>` : '<p class="dim">Nothing in the cooler this time.</p>';
  if (!x.ok) { E.res.innerHTML = `<h3>🎣 ${esc(c.label)}</h3><p class="rr-bad">${esc(x.why || 'That trip did not count')}</p><div class="rr-acts"><button type="button" class="btn" data-close="1">Close</button></div>`; E.res.classList.remove('hidden'); return; }
  const vc = x.vc || {};
  E.res.innerHTML = `<h3>🎣 ${esc(c.label)}${why ? ` <small class="dim">· ${esc(why)}</small>` : ''}</h3>
    <div class="rr-stars" data-noicon>${[0, 1, 2].map(k => `<span class="${k < x.stars ? 'on' : ''}" style="animation-delay:${k * 0.25}s">★</span>`).join('')}</div>
    <div class="rr-time">${m ? esc(formatScore(m, x.score)) : x.score}${x.newBest ? ' <span class="rr-best">New best!</span>' : x.prevBest && m ? ` <small class="dim">best ${esc(formatScore(m, x.prevBest.score))}</small>` : ''}</div>
    ${list}
    <div class="rr-facts">
      <span>${kept.length} kept · worth about ${fmtVc(Math.round(sum * 100))}</span>
      ${x.place ? `<span>🏆 #${x.place} on the leaderboard</span>` : ''}
      <span>+${x.xp} XP${x.module.level > x.module.was ? ` · 🎣 Fishing level ${x.module.level}!` : ''}</span>
      ${vc.paid ? `<span class="pf-vc">+${fmtVc(vc.paid)}</span>` : ''}
      ${x.player.level > x.player.was ? `<span>⭐ Level ${x.player.level}${x.player.rankUp ? ` - ${esc(x.player.rank.icon)} ${esc(x.player.rank.name)} rank!` : ''}</span>` : ''}
    </div>
    ${x.badges?.length ? `<div class="rr-badges">${x.badges.map(b => `<div class="pf-sb t-${b.tier}"><span>${b.icon}</span><b>${esc(b.label)}</b></div>`).join('')}</div>` : ''}
    ${x.unlocked?.length && m ? `<p class="rr-open">🔓 ${x.unlocked.map(id => esc(m.courses.find(o => o.id === id)?.label || id)).join(', ')} opened</p>` : ''}
    ${x.dex?.fresh?.length ? `<p class="rr-open">📖 New to your Fishdex: ${x.dex.fresh.map(id => esc(speciesOf(id)?.name || id)).join(', ')} <small class="dim">(${x.dex.count} of ${x.dex.of})</small></p>` : ''}
    ${x.dex?.records?.length ? `<p class="rr-open">🥇 World record${x.dex.records.length > 1 ? 's' : ''}: ${x.dex.records.map(rc => `${esc(speciesOf(rc.species)?.name || rc.species)} ${rc.kg < 10 ? rc.kg.toFixed(2) : rc.kg.toFixed(1)} kg`).join(', ')}</p>` : ''}
    ${x.catch?.stowed ? `<p class="hint">🧊 ${x.catch.stowed} ${x.catch.stowed === 1 ? 'thing' : 'things'} into your inventory (I)${x.catch.bounty ? ` · bounties paid ${fmtVc(x.catch.bounty)}` : ''}${x.catch.full ? ' - your inventory was full: some had to go back' : ''}. Any dock store buys fish; or keep them to give or trade.</p>` : kept.length ? '<p class="hint">🐟 Any dock store buys your catch.</p>' : ''}
    <div class="rr-acts">${app.boating?.active ? `<button type="button" class="btn primary" data-again="${c.id}">↻ Go again</button>` : ''}<button type="button" class="btn" data-board="${c.id}">🏆 Leaderboard</button><button type="button" class="btn" data-dex="${esc(x.dex?.fresh?.[0] || '')}">📖 Fishdex</button><button type="button" class="btn" data-close="1">Close</button></div>`;
  E.res.classList.remove('hidden');
}
let hudAt = 0;
function hudTrip(force = false) {
  if (!trip) return;
  const now = performance.now();
  if (!force && now - hudAt < 250) return; hudAt = now;
  const min = (now - trip.t0) / 60000, hr = hourAt(trip.data, min), left = trip.course.minutes - min;
  const hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
  E.hud.querySelector('.fh-clock').innerHTML = left > 0 ? `⏱️ ${hh}:${String(mm).padStart(2, '0')} · dusk in ${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, '0')}` : '<span class="fh-late">🌙 Dusk - head back: the catch is spoiling</span>';
  const met = new Set(bountiesMet(trip.plan.bounties, trip.caught.filter(c => c.species).map(c => ({ ...c, kept: c.kept }))));
  E.hud.querySelector('.fh-bounties').innerHTML = trip.plan.bounties.map(b => `<div class="${met.has(b.id) ? 'done' : ''}">${met.has(b.id) ? '✅' : '○'} ${esc(b.label)} <small>+${b.reward}</small></div>`).join('');
  const used = trip.caught.filter(c => c.kept).reduce((a, c) => a + (c.slots || 1), 0);
  E.hud.querySelector('.fh-cool').textContent = `🧊 ${used}/${trip.L.boat.cooler} · ${trip.caught.filter(c => c.kept).length} kept`;
}

// ------------------------------------------------------------------ the lure
function lureUi() {
  if (!trip) { E.lure.textContent = '🎣 No trip'; return; }
  const l = LURE_BY_ID[trip.lure];
  E.lure.innerHTML = `${l.icon} ${esc(l.name)} <small>×${trip.lures[l.id] ?? '∞'}</small>`;
}
function nextLure() {
  if (!trip || (A && A.st !== 'ready')) return;
  const list = luresFor(trip.water).filter(l => (trip.lures[l.id] || 0) > 0), i = list.findIndex(l => l.id === trip.lure);
  if (list.length) trip.lure = list[(i + 1) % list.length].id;
  lureUi();
}

// ------------------------------------------------------------------ at the spot
function sitDown() {
  A = { st: 'ready', t: 0 };
  E.ctl.classList.remove('hidden'); document.body.classList.add('fishing');
  lureUi(); setAct();
  if (!trip) app.toast('Choose a trip first: 🎣 Trips (T)', '', 3000);
}
function stand() {
  if (!A) return;
  if (A.hook && A.st !== 'reveal') post('/api/play/act', { run: trip?.id, act: 'lose', body: { hook: A.hook, why: 'off' } }).catch(() => {});
  A = null; fx?.hideAll();
  E.ctl.classList.add('hidden'); E.gauge.classList.add('hidden'); E.prompt.classList.add('hidden'); E.card.classList.add('hidden');
  document.body.classList.remove('fishing');
  app.boating?.hold(false); app.boating?.pose(null);
}
function toReady(msg) {
  if (!A) return;
  if (msg) app.toast(msg, '', 2400);
  A = { st: 'ready', t: 0 };
  fx?.hideAll(); E.gauge.classList.add('hidden'); E.prompt.classList.add('hidden'); E.bow.classList.add('hidden'); E.ring.style.strokeDasharray = '0 276';
  app.boating?.hold(false); app.boating?.pose(null); setAct();
}
/** The big button's label: what pressing it does now. */
function setAct() {
  const L = { ready: trip ? 'CAST' : 'TRIPS', aim: 'LET GO', cast: '…', wait: 'REEL', strike: 'HOOK!', hooking: '…', fight: A?.ready ? 'LAND' : 'REEL', land: '…', reveal: 'OK', reelfind: A?.ready ? 'LAND' : 'REEL' }[A?.st] || '';
  if (E.actL.textContent !== L) E.actL.textContent = L;
  E.act.classList.toggle('hot', A?.st === 'strike' || !!A?.ready);
  const hint = isTouch() ? '' : { ready: 'hold Space', aim: 'release', wait: 'hold: reel · tap: twitch', strike: 'Space!', fight: A?.ready ? 'E' : 'hold Space' }[A?.st] || '';
  if (E.actS.textContent !== hint) E.actS.textContent = hint;
}
function down() {
  if (!A) return;
  A.held = true; A.downAt = performance.now();
  if (A.st === 'ready') {
    if (!trip) { openPick(); return; }
    if (!((trip.lures[trip.lure] ?? 1) > 0)) {   // (out of this one: the next it has, or none left at all)
      nextLure();
      if (!((trip.lures[trip.lure] ?? 1) > 0)) { app.toast('Out of bait and lures - the dock store sells more (🎣 Gear & skills)', 'bad', 3500); A.held = false; return; }
    }
    A.st = 'aim'; A.t0 = performance.now(); app.boating.hold(true);
  }
  else if (A.st === 'wait' && A.nib?.strike) strikeIt();
  else if (A.st === 'wait' && A.nib && !A.nib.strike) spook();
  else if (A.st === 'strike') strikeIt();
  else if ((A.st === 'fight' || A.st === 'reelfind') && A.ready) A.landQ = true;
  else if (A.st === 'reveal') closeCard();
  setAct();
}
function up() {
  if (!A || !A.held) return;
  A.held = false;
  const tap = performance.now() - (A.downAt || 0) < 220;
  if (A.st === 'aim') castGo();
  else if (A.st === 'wait' && tap) twitch();
  setAct();
}
function reelIn() {
  if (!A || !['wait', 'cast'].includes(A.st)) return;
  toReady();
}

// ------------------------------------------------------------------ where things are
/** The rod's tip now (the clip's hand on the CPU: render/characters.js gripPoint), else a guess off your shoulder. */
function rodTip() {
  const P = app.player, X = P?.extra, chars = app.agents?.chars, look = P?.look?.app || {};
  if (!X) return null;
  const q = chars?.gripPoint ? chars.gripPoint(PLAYER_APP, X.clip, X.ph, 'R', TIP, _q) : null;
  if (q) return bodyToWorld(q, look.height || 1, look.build || 1, X.yaw, X.x, X.y, X.z, _tip);
  return _tip.set(X.x + Math.sin(X.yaw) * 1.6, X.y + 2.2, X.z + Math.cos(X.yaw) * 1.6);
}
/** Where you stand and the way you face out (world). */
function spotNow() {
  const X = app.player?.extra; if (!X) return null;
  return { x: X.x, y: X.y, z: X.z, yaw: X.yaw };
}
/** The water's height at (x, z) as it is drawn (the waves), and its calm level. */
function surface(x, z) {
  const w = waterUnder(x, z); if (!w) return null;
  const y = heights('fish:lure', [{ x, z }], w.level, w.lake)[0];
  return { level: w.level, y: Number.isFinite(y) ? y : w.level };
}
const groundAt = (x, z) => nav?.groundAt(x, z) || null;

// ------------------------------------------------------------------ cast
function aimTarget(power) {
  const s = spotNow(), cam = app.cam; if (!s) return null;
  // the way the camera looks, kept within 75° of the way you face out
  let yaw = cam.yaw + Math.PI;
  const off = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw)), lim = 75 * Math.PI / 180;
  yaw = s.yaw + Math.max(-lim, Math.min(lim, off));
  const reach = trip.L.reach, dist = CAST_MIN + (reach - CAST_MIN) * power;
  // out along that way to the last water short of land
  let best = null;
  for (let d = 2; d <= dist; d += 1) {
    const x = s.x + Math.sin(yaw) * d, z = s.z + Math.cos(yaw) * d, w = waterUnder(x, z);
    if (!w) break;
    best = { x, z, y: w.level, d };
  }
  return best ? { ...best, yaw } : null;
}
function castGo() {
  const power = aimPower(), to = aimTarget(power);
  fx.aim(null);
  if (!to || to.d < 3) { toReady('No water to cast into that way'); return; }
  const from = rodTip()?.clone() || new THREE.Vector3();
  A = { st: 'cast', t0: performance.now(), from, to, dur: 0.55 + to.d / 32 };
}
const aimPower = () => { const u = ((performance.now() - (A?.t0 || 0)) / 1000 / AIM_SWING) % 2; return u < 1 ? u : 2 - u; };

// ------------------------------------------------------------------ wait, nibbles, the strike
function landed(to) {
  const L = LURE_BY_ID[trip.lure];
  fx.splash(to.x, to.y, to.z, 0.12);
  A = { st: 'wait', lure: { x: to.x, z: to.z, y: to.y }, kind: L.kind, bite: 0, need: -Math.log(Math.random() + 1e-6), moving: 0, nib: null, t: 0 };
  app.boating.hold(false);
}
function waitStep(dt, now) {
  const W = A, L = LURE_BY_ID[trip.lure], s = spotNow(); if (!s) return;
  // reeling: the lure comes back toward you (a cast lure swims); all the way in, out of the water
  const reel = W.held && performance.now() - W.downAt > 220;
  if (reel) {
    const dx = s.x - W.lure.x, dz = s.z - W.lure.z, d = Math.hypot(dx, dz), v = trip.L.speed * (L.kind === 'cast' ? 0.9 : 0.6) * dt;
    if (d < 2.6) { toReady(); return; }
    W.lure.x += dx / d * v; W.lure.z += dz / d * v; W.moving = 0.4;
  }
  W.moving = Math.max(0, W.moving - dt);
  const sf = surface(W.lure.x, W.lure.z); if (sf) W.lure.y = sf.y;
  // the bite: sooner over a ground, with a lure it likes, at its hour - a lure that swims only while it moves
  if (!W.nib) {
    const g = groundAt(W.lure.x, W.lure.z), hr = hourAt(trip.data, (performance.now() - trip.t0) / 60000);
    const every = app.fishing.debug.fast ? 1.5 : biteEvery(g, trip.lure, hr, trip.water, trip.L.vis);
    const rate = (L.kind === 'cast' ? (W.moving > 0 ? 1 : 0.35) : 1) / Math.max(1.5, every);
    W.bite += rate * dt; W.ground = g;
    if (W.bite >= W.need) W.nib = { left: app.fishing.debug.fast ? 1 : 1 + Math.floor(Math.random() * 3), at: now + 0.2, dip: 0, strike: false };
  } else nibbleStep(now);
}
function nibbleStep(now) {
  const N = A.nib, L = trip.L;
  if (!N.strike) {
    const u = now - N.at;
    N.dip = u >= 0 && u < 0.32 ? 0.05 * Math.sin(u / 0.32 * Math.PI) * (0.6 + L.feel) : 0;
    if (u >= 0 && u < 0.05 && !N.rippled) { N.rippled = true; fx.ripple(A.lure.x, A.lure.y, A.lure.z, 0.5, 0.8); }
    if (u >= 0.32) { N.left--; N.rippled = false; N.at = now + 0.55 + Math.random() * 0.8; if (N.left <= 0) { N.strike = true; N.at = now; fx.splash(A.lure.x, A.lure.y, A.lure.z, 0.25); A.st = 'strike'; prompt('HOOK!', 'hot'); } }
  }
}
function strikeStep(now) {
  const N = A.nib, u = now - N.at;
  N.dip = Math.min(0.35, u * 2.5);
  if (app.fishing.debug.auto && u > 0.15) { strikeIt(); return; }
  if (u > trip.L.win + 0.1) { prompt(null); A.nib = null; A.st = 'wait'; A.bite = 0; A.need = -Math.log(Math.random() + 1e-6) * 1.2; app.toast('Too late - it stole the bait', '', 1800); }
}
function spook() { A.nib = null; A.bite = 0; A.need = -Math.log(Math.random() + 1e-6) * 1.5; app.toast('Too soon - it spooked', '', 1600); }
function twitch() {
  if (!A?.lure) return;
  const s = spotNow(); if (!s) return;
  const dx = s.x - A.lure.x, dz = s.z - A.lure.z, d = Math.hypot(dx, dz);
  if (d > 3) { A.lure.x += dx / d * 0.35; A.lure.z += dz / d * 0.35; }
  A.moving = 1.2; fx.ripple(A.lure.x, A.lure.y, A.lure.z, 0.6, 0.9);
}
async function strikeIt() {
  if (!A || (A.st !== 'strike' && !A.nib?.strike)) return;
  prompt(null);
  const lure = A.lure, ground = A.nib && A.ground ? A.ground : groundAt(lure.x, lure.z), s = spotNow(), d0 = s ? Math.hypot(lure.x - s.x, lure.z - s.z) : 15;
  A.st = 'hooking'; app.boating.hold(true); setAct();
  let r;
  try { r = await post('/api/play/act', { run: trip.id, act: 'hook', body: { lure: trip.lure, ground: ground?.id || null, d0: Math.round(d0 * 10) / 10 } }); }
  catch (err) { if (A) toReady(err.status === 429 ? 'It shook loose' : err.message); return; }
  if (!A || A.st !== 'hooking') return;
  if (!r?.hook) { toReady(r?.why ? `${r.why}` : 'It got off'); return; }
  if (Number.isFinite(r.left)) { trip.lures[trip.lure] = r.left; lureUi(); }   // (the bait a fish took)
  const dir = Math.atan2(lure.x - s.x, lure.z - s.z);
  if (r.what.kind === 'find') {
    A = { st: 'reelfind', hook: r.hook, what: r.what, d: r.d0, dir, lure, t0: performance.now() };
    app.toast('Something heavy… reel it in', '', 2000);
  } else {
    const sp = speciesOf(r.what.species);
    A = { st: 'fight', hook: r.hook, what: r.what, sp, F: fightSetup(sp, { kg: r.what.kg }, trip.L, { d0: r.d0, seed: r.seed }), dir, fx: 0, acc: 0, lure, jump: null, hint: '', t0: performance.now() };
    const big = r.what.kg > Math.max(4, trip.L.maxKg * 0.6) ? 'Big one! ' : '';
    if (r.what.kg > trip.L.maxKg) { A.heavy = true; A.hint = `Too heavy for your rod (it lifts ${trip.L.maxKg} kg) - it'll likely win`; app.toast(`🐟 A monster! Too heavy for your rod - a stronger one lands these (the dock store)`, 'warn', 3200); }   // (shared/fishing-fight.js HEAVY_S)
    else app.toast(`🐟 ${big}Fish on!`, 'good', 1800);
    fx.lure(null);
    fx.splash(lure.x, lure.y, lure.z, 0.3);
  }
  E.gauge.classList.remove('hidden');
  app.boating.hold(true); setAct();
}

// ------------------------------------------------------------------ the fight
function fightFrame(dt, now) {
  const F = A.F, j = app.player?.joy, auto = app.fishing.debug.auto;
  A.acc = Math.min(A.acc + dt, TEST ? 2 : 0.3);
  while (A.acc >= FIGHT_DT && !F.out) {
    let inp;
    if (auto) inp = botInput(F, 0.95);
    else {
      const steer = Math.max(-1, Math.min(1, (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + (j?.on ? j.x : 0)));
      inp = { reel: !!A.held, steer, bow: !!A.bowQ, land: !!A.landQ };
    }
    A.bowQ = false; A.landQ = false;
    for (const ev of fightStep(F, inp, FIGHT_DT)) fightEvent(ev);
    A.acc -= FIGHT_DT;
    if (!A || A.st !== 'fight') return;
  }
  // where it is: out along the line, off to the side it runs
  const s = spotNow(); if (!s) return;
  if (F.mode === 'run' && F.dir) A.fx += F.dir * F.p.vs * 0.55 * dt; else A.fx *= 1 - Math.min(1, 0.5 * dt);
  A.fx = Math.max(-0.7 * F.d, Math.min(0.7 * F.d, A.fx));
  const rx = -Math.cos(A.dir), rz = Math.sin(A.dir), fxp = s.x + Math.sin(A.dir) * F.d + rx * A.fx, fzp = s.z + Math.cos(A.dir) * F.d + rz * A.fx;
  const sf = surface(fxp, fzp), wy = sf ? sf.y : s.y - 1;
  const len = Math.min(3.5, A.what.cm / 100), swim = Math.atan2(fxp - (A.px ?? fxp), fzp - (A.pz ?? fzp)), moved = Math.hypot(fxp - (A.px ?? fxp), fzp - (A.pz ?? fzp));
  if (moved > 0.01) A.swim = swim; A.px = fxp; A.pz = fzp;
  const yawF = A.swim ?? A.dir + Math.PI;
  if (A.jump) {
    const u = (performance.now() - A.jump.t0) / 1000 / A.jump.dur;
    if (u >= 1) { fx.splash(fxp, wy, fzp, len * 0.8); A.jump = null; }
    else { _a.set(fxp, wy + A.jump.h * 4 * u * (1 - u), fzp); fx.fish(A.what, 'air', _a, yawF, 1.0 - 2 * u, len, Math.sin(u * 9) * 0.4); }
  }
  if (!A.jump) { fx.fish(A.what, 'under', _a.set(fxp, wy + 0.01, fzp), yawF, 0, len); fx.stir(fxp, wy, fzp, len, F.mode, dt); }   // (and the water it stirs)
  const tip = rodTip();
  if (tip) fx.line(tip, _b.set(fxp, wy, fzp), F.T < 0.15 * F.p.P ? 0.35 : 0.03);
  app.boating.pose(F.mode === 'jump' ? CLIP.fish_fight : A.held || auto ? CLIP.fish_reel : CLIP.fish_fight);
  gauges();
}
function fightEvent(ev) {
  const F = A.F;
  if (ev === 'jump') { const len = Math.min(3.5, A.what.cm / 100); A.jump = { t0: performance.now(), dur: 0.85 + Math.min(0.5, len * 0.25), h: Math.min(2.6, 0.5 + len * 0.9) }; fx.splash(A.px ?? 0, surface(A.px ?? 0, A.pz ?? 0)?.y ?? 0, A.pz ?? 0, len * 0.7); prompt('BOW!', 'warn'); E.bow.classList.remove('hidden'); }
  else if (ev === 'bowed') { prompt(null); E.bow.classList.add('hidden'); A.hint = 'Bowed to it - it tires'; }
  else if (ev === 'spike') A.flash = performance.now();
  else if (ev === 'slack') A.hint = 'Slack line - reel!';
  else if (ev === 'ready') { A.ready = true; prompt(isTouch() ? 'LAND IT!' : 'LAND IT! (E)', 'hot'); setAct(); }
  else if (ev === 'landed') { prompt(null); netIt(); }
  else if (['snap', 'spat', 'spool', 'free', 'heavy'].includes(ev)) {
    const why = { snap: 'The line snapped', spat: 'It threw the hook', spool: 'It took all your line', free: 'It pulled free', heavy: 'Too strong for your rod - it pulled free. A stronger rod lands it (the dock store)' }[ev];
    if (ev === 'heavy') { post('/api/play/act', { run: trip?.id, act: 'lose', body: { hook: A.hook, why: 'free' } }).catch(() => {}); toReady(`❌ ${why}`); return; }
    post('/api/play/act', { run: trip?.id, act: 'lose', body: { hook: A.hook, why: ev } }).catch(() => {});
    if (ev === 'snap' && trip && !LURE_BY_ID[trip.lure]?.bait) { trip.lures[trip.lure] = Math.max(0, (trip.lures[trip.lure] || 1) - 1); lureUi(); if (!trip.lures[trip.lure]) nextLure(); }   // (a lure lost; bait went when the fish took it)
    toReady(`❌ ${why}${ev === 'snap' ? ' - the lure is gone' : ''}`);
  }
  if (ev !== 'jump' && F.mode !== 'jump' && A?.jump == null) E.bow.classList.add('hidden');
  if (ev === 'jump' && !A.ready) setTimeout(() => { if (A?.st === 'fight' && !A.ready) { prompt(null); E.bow.classList.add('hidden'); } }, 800);
}
function gauges() {
  const F = A.F, L = trip.L, t = F.T / L.kgf, d = F.T / L.drag, now = performance.now();
  const col = t > 0.85 || now - (A.flash || 0) < 220 ? '#ff4d3d' : d > 0.9 ? '#ffb02e' : '#4ad991';
  const tb = E.gauge.querySelector('.fg-t i'); tb.style.width = `${Math.min(100, t * 100).toFixed(1)}%`; tb.style.background = col;
  E.gauge.querySelector('.fg-t em').style.left = `${Math.min(100, L.drag / L.kgf * 100).toFixed(1)}%`;
  E.gauge.querySelector('.fg-s i').style.width = `${Math.max(0, F.S / F.p.S0 * 100).toFixed(1)}%`;
  E.gauge.querySelector('.fg-line').textContent = `${F.d.toFixed(0)} m`;
  const run = F.mode === 'run' && F.dir ? (F.dir > 0 ? (isTouch() ? '◀ It runs right - pull left' : '◀ It runs right - hold A') : (isTouch() ? 'It runs left - pull right ▶' : 'It runs left - hold D ▶')) : F.mode === 'dive' ? '⤓ It dives - hold on' : F.mode === 'toward' ? 'It comes at you - reel fast!' : '';
  const hint = A.ready ? 'Beaten - land it!' : F.T > L.drag * 0.98 ? 'Line running out - ease off' : run || A.hint;
  const q = E.gauge.querySelector('.fg-hint'); if (q.textContent !== hint) q.textContent = hint;
  E.ring.style.strokeDasharray = `${(Math.min(1, t) * 276).toFixed(1)} 276`; E.ring.style.stroke = col;
  if (A.hint && !A.heavy && Math.random() < 0.01) A.hint = '';
}
function reelFindFrame(dt) {
  const s = spotNow(); if (!s) return;
  const auto = app.fishing.debug.auto;
  if (A.held || auto) A.d = Math.max(3, A.d - trip.L.speed * 2.1 * dt);
  if (A.d <= 3 && !A.ready) { A.ready = true; prompt(isTouch() ? 'LAND IT!' : 'LAND IT! (E)', 'hot'); setAct(); }
  if (A.ready && (A.landQ || auto)) { prompt(null); netIt(); return; }
  A.landQ = false;
  const x = s.x + Math.sin(A.dir) * A.d, z = s.z + Math.cos(A.dir) * A.d, sf = surface(x, z);
  const tip = rodTip(); if (tip) fx.line(tip, _b.set(x, sf ? sf.y : s.y - 1, z), 0.05);
  app.boating.pose(A.held || auto ? CLIP.fish_reel : CLIP.fish_fight);
  E.gauge.querySelector('.fg-line').textContent = `${A.d.toFixed(0)} m`;
  E.gauge.querySelector('.fg-hint').textContent = A.ready ? 'Land it!' : 'Something heavy - reel it in';
}

// ------------------------------------------------------------------ landing it, the catch
async function netIt() {
  const what = A.what, hook = A.hook, sp = A.sp;
  A = { ...A, st: 'land', t0: performance.now() };
  app.boating.pose(CLIP.fish_net); E.gauge.classList.add('hidden'); E.bow.classList.add('hidden'); fx.line(null); E.ring.style.strokeDasharray = '0 276';
  const s = spotNow();
  if (s) { const x = s.x + Math.sin(s.yaw) * 1.4, z = s.z + Math.cos(s.yaw) * 1.4, sf = surface(x, z); if (sf) fx.splash(x, sf.y, z, Math.min(1.2, (what.cm || 40) / 100)); }
  await new Promise(r => setTimeout(r, 1100));
  let r;
  try { r = await post('/api/play/act', { run: trip.id, act: 'land', body: { hook } }); }
  catch (err) { if (A) toReady(err.message); return; }
  if (!A || A.st !== 'land') return;
  const c = r.caught, name = c.find ? findOf(c.find)?.name || c.find : sp?.name || c.species;
  if (r.reveal) nav?.reveal(r.reveal, 'note');
  const vc = c.find ? 0 : valueOf(speciesOf(c.species), c.kg, c.u);
  const entry = { ...c, name, vc };
  trip.caught.push(entry);
  A = { st: 'reveal', c: entry, sp, t0: performance.now(), full: r.full };
  app.boating.pose(CLIP.fish_show);
  card(entry, r);
  if (c.species && trip.dex) { trip.dex.mine[c.species] ||= { n: 0, kg: 0 }; trip.dex.mine[c.species].n++; const rec = trip.dex.records[c.species]; if (!rec || c.kg > rec.kg) trip.dex.records[c.species] = { kg: c.kg, cm: c.cm, mine: true }; }
  hudTrip(true);
  bus.emit('fish-caught', { species: c.species, find: c.find, kg: c.kg });
}
function card(c, r) {
  const sp = c.species ? speciesOf(c.species) : null, rar = sp ? RARITY[sp.rarity] : null, size = sp ? sizeOf(c.u) : null;
  const kgTxt = c.kg < 10 ? c.kg.toFixed(2) : c.kg.toFixed(1);
  E.card.innerHTML = `<div class="fk-top">${rar ? `<span class="fk-rar" style="background:${rar.color}">${esc(rar.label)}</span>` : '<span class="fk-rar">Found</span>'}${size ? `<span class="fk-size">${esc(size.label)} ${size.crown ? '👑' : '★'.repeat(size.stars)}</span>` : ''}</div>
    <h3>${esc(c.name)}</h3>
    ${sp ? `<div class="fk-facts"><b>${c.cm} cm</b> <small>(${(c.cm / 2.54).toFixed(1)} in)</small> · <b>${kgTxt} kg</b> <small>(${toLb(c.kg).toFixed(1)} lb)</small> · worth ~${fmtVc(Math.round(c.vc * 100))}</div>` : `<div class="fk-facts">${esc(findOf(c.find)?.blurb || 'Up from the bottom.')}</div>`}
    ${sp && trip?.dex && !trip.dex.mine[c.species] ? '<p class="fk-note good">📖 New to your Fishdex!</p>' : ''}
    ${sp && trip?.dex && c.kg > (trip.dex.records[c.species]?.kg || 0) ? `<p class="fk-note good">🥇 ${trip.dex.records[c.species] ? `Bigger than the world record (${trip.dex.records[c.species].kg} kg)` : 'The first ever landed'} - a world record when you weigh in!</p>` : ''}
    ${r.reveal ? '<p class="fk-note">🍾 There was a note inside - a hidden fishing ground is marked on your chart.</p>' : ''}
    ${r.full ? '<p class="fk-note warn">🧊 The cooler is full - let something go to keep this one.</p>' : ''}
    <div class="rr-acts">${c.kept ? `<button type="button" class="btn" data-release="${c.n}">🫶 Let it go</button>` : `<button type="button" class="btn primary" data-keep="${c.n}">🧊 Keep it</button>`}<button type="button" class="btn primary" data-ok="1">${c.kept ? '🧊 In the cooler' : 'OK'}</button></div>`;
  E.card.classList.remove('hidden');
}
async function onCardClick(e) {
  const t = e.target.closest('button'); if (!t || !A || A.st !== 'reveal') return;
  const n = +(t.dataset.release || t.dataset.keep);
  if (t.dataset.release || t.dataset.keep) {
    const act = t.dataset.release ? 'release' : 'keep';
    try { await post('/api/play/act', { run: trip.id, act, body: { n } }); }
    catch (err) { app.toast(err.message, 'bad', 3000); return; }
    const c = trip.caught.find(x => x.n === n); if (c) { c.kept = act === 'keep'; c.released = act === 'release'; }
    if (act === 'release' && A.c && !A.c.find) { const s = spotNow(); if (s) { const x = s.x + Math.sin(s.yaw) * 1.2, z = s.z + Math.cos(s.yaw) * 1.2, sf = surface(x, z); if (sf) fx.splash(x, sf.y, z, Math.min(1, A.c.cm / 100)); } app.toast('🫶 Back it goes', 'good', 1500); }
    hudTrip(true);
  }
  closeCard();
}
function closeCard() { E.card.classList.add('hidden'); if (A?.st === 'reveal') toReady(); }
/** The catch held up in both hands (fish_show): between the grips, lying across you. */
function holdFrame(now) {
  const X = app.player?.extra, chars = app.agents?.chars, look = app.player?.look?.app || {}; if (!X) return;
  const c = A.c, len = c.find ? 1 : Math.min(1.5, c.cm / 100);
  const qR = chars?.gripPoint?.(PLAYER_APP, X.clip, X.ph, 'R', [0, 0, 0.05]), qL = qR ? [...qR] : null, qL2 = chars?.gripPoint?.(PLAYER_APP, X.clip, X.ph, 'L', [0, 0, 0.05], [0, 0, 0]);
  if (qR && qL2) { qL[0] = (qR[0] + qL2[0]) / 2; qL[1] = (qR[1] + qL2[1]) / 2 + 0.05; qL[2] = (qR[2] + qL2[2]) / 2; bodyToWorld(qL, look.height || 1, look.build || 1, X.yaw, X.x, X.y, X.z, _a); }
  else _a.set(X.x + Math.sin(X.yaw) * 0.35, X.y + 1.25, X.z + Math.cos(X.yaw) * 0.35);
  fx.fish(c.find ? { find: c.find } : c, 'held', _a, X.yaw + Math.PI / 2, 0, len, 0.15 * Math.sin(now * 2));
  const age = (performance.now() - A.t0) / 1000;
  if (age > 9 || (app.fishing.debug.auto && age > 7)) closeCard();
}

// ------------------------------------------------------------------ every frame
function prompt(text, kind = '') {
  if (!text) { E.prompt.classList.add('hidden'); return; }
  E.prompt.textContent = text; E.prompt.className = kind; E.prompt.classList.remove('hidden');
}
function frame(dt0, now) {
  // by the time that really passed (as the boat): a slow frame doesn't slow the fish down
  const ms = performance.now(), dt = Math.min(TEST ? 2 : 0.25, lastMs ? (ms - lastMs) / 1000 : dt0); lastMs = ms;
  if (!app.boating?.active) return;
  if (trip) { hudTrip(); nav?.update(dt, performance.now() / 1000); }
  if (!A && !fx) return;
  fx ||= new FishingFx(app.stage);
  fx.update(dt);
  if (!A) return;
  const t = performance.now() / 1000;
  if (A.st === 'aim') {
    const p = aimPower(), to = aimTarget(p), tip = rodTip();
    app.boating.pose(CLIP.fish_cast, 0.3);
    fx.aim(tip, to, p);
  } else if (A.st === 'cast') {
    const u = (performance.now() - A.t0) / 1000;
    app.boating.pose(CLIP.fish_cast, Math.min(0.99, 0.32 + u / 0.7 * 0.68));
    const k = Math.min(1, Math.max(0, (u - 0.12) / A.dur)), H = 1.5 + A.to.d * 0.22;
    const tip = rodTip();
    if (k <= 0) { if (tip) fx.line(tip, tip, 0); }
    else {
      _a.set(A.from.x + (A.to.x - A.from.x) * k, A.from.y + (A.to.y - A.from.y) * k + H * 4 * k * (1 - k), A.from.z + (A.to.z - A.from.z) * k);
      fx.lure(_a, LURE_BY_ID[trip.lure].kind, LURE_BY_ID[trip.lure].colour);
      if (tip) fx.line(tip, _a, 0.1);
      if (k >= 1) landed(A.to);
    }
  } else if (A.st === 'wait' || A.st === 'strike') {
    if (A.st === 'wait') waitStep(dt, t); else strikeStep(t);
    if (!A || !A.lure) return;
    const L = LURE_BY_ID[trip.lure], dip = A.nib?.dip || 0;
    _a.set(A.lure.x, A.lure.y + (L.kind === 'float' ? 0.02 : -0.02), A.lure.z);
    fx.lure(_a, L.kind, L.colour, dip, Math.atan2(A.lure.x, A.lure.z));
    const tip = rodTip(); if (tip) fx.line(tip, _a, A.held ? 0.15 : 0.7, A.lure.y);
    app.boating.pose(A.held && t - (A.downAt || 0) / 1000 > 0.22 ? CLIP.fish_reel : CLIP.fish_idle);
  } else if (A.st === 'hooking') {
    const tip = rodTip(); if (tip && A.lure) fx.line(tip, _a.set(A.lure.x, A.lure.y, A.lure.z), 0.05);
  } else if (A.st === 'fight') fightFrame(dt, t);
  else if (A.st === 'reelfind') reelFindFrame(dt);
  else if (A.st === 'reveal') holdFrame(t);
  else if (A.st === 'ready') { app.boating.pose(null); }
  setAct();
}
