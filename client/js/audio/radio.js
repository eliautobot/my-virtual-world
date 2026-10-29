// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// MVW Radio in your car, boat or aircraft (2026-10-26, R1 of the sound effects plan; aircraft 2026-10-27): it comes on as
// you drive off, take a boat out or fly, on the station you last had (Sunday Drive the first time), and goes as you get out. Four stations
// (shared/radio.js): Velvet 88.3, Bass Island 99.9, Sunday Drive 94.7, The Grapevine 1040 AM. What a station plays is
// worked out from the library and the server's clock (onAir), so everyone on a station hears the same song at the same
// second: the song streams from the library (/api/music/file, from where the station is in it) and keeps to the clock
// (sought again when it drifts); between songs the station's ident (its voice over its jingle); the tuning static when
// you change station; talk radio sounds like AM (band-limited). R next station, Shift+R the one before; the panel at
// the top left (station, what plays, ◀ ⏻ ▶); on phones a 📻 button under the map slides it open, and it tucks away
// again after a few seconds untouched. Its volume is Radio (Settings → Sound); the background music
// makes way while it plays. The hosts' talk (R2): breaks over the next song; 2-3 hosts at a studio's desk (ST5) make it
// a conversation, line by line, each in its own voice, and the one speaking talks at the desk (S.radioTalk: render/agents.js).
import { S, bus } from '../core/state.js';
import { level } from './mixer.js';
import { STATIONS, stationById, stationTracks, onAir, RADIO, breakLines, talkingAt, LINE_GAP, talkOf } from '/shared/radio.js';
import { getJSON } from '../core/net.js';
import { auth } from '../core/auth.js';
import { toLocal, inRect } from '/shared/geom.js';

const KEY = 'mvw.radio';
let app = null, room = null, el = null, cur = null, lastT = 0, inside = false, identAt = '', bar = null, btn = null, shut = 0;
const OPEN_MS = 6000;   // (phones: how long the panel stays open after the last touch)
// the hosts (server/radio/): who hosts each station, the breaks written for the slots coming up; the break on air
const R = { stations: null, hosts: new Map(), breaks: new Map(), loadedAt: 0 }; let brk = null;
/** The world's stations (server/radio/: its administrators add, change and remove them); the first four until they load. */
const list = () => R.stations || STATIONS;
const setStations = arr => { R.stations = arr; R.hosts = new Map(arr.map(s => [s.id, s.hostNames?.length ? s.hostNames : null])); };
const DUCK = 0.22;   // (the song while the host talks over it)
const saved = () => { try { return localStorage.getItem(KEY) || 'sunday'; } catch { return 'sunday'; } };
const save = v => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

export function init(a) {
  app = a;
  bus.on('frame', () => { const now = performance.now(); if (now - lastT > 250) { lastT = now; tick(); talkers(); } });
  bus.on('sound', () => tick(true));
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyR' || e.repeat || !inside || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
    if (room) return;   // (a studio plays its own station)
    step(e.shiftKey ? -1 : 1);
  });
  setTimeout(loadHosts, 4000);   // (the hosts: the Radio Station's ON AIR sign shows them, render/radio-station.js)
  bus.on('msg:radio', m => {
    if (m.stations) setStations(m.stations);
    if (m.brk) R.breaks.set(m.brk.key, m.brk);
    paint();
  });
  a.radio = {
    get playing() { return !!cur && !cur.dead && inside && (room || saved() !== 'off') && level('radio') > 0; }, get room() { return room && { station: room.st.id, name: room.st.name, mod: room.m.id }; },
    get station() { return saved(); }, get now() { return cur && { kind: cur.kind, track: cur.track?.id || null, title: cur.track?.title || null, station: cur.st }; },
    get drift() { return cur?.el && cur.want != null ? +(cur.el.currentTime - cur.want).toFixed(2) : null; },
    tune: id => tune(id), step, off: () => tune('off'),
    get onAir() { return brk && { key: brk.b.key, host: (brk.line?.host || brk.b.host)?.name, line: brk.i, lines: breakLines(brk.b).length, voice: brk.line?.audio ? 'file' : 'free' }; }, get talking() { return [...(S.radioTalk || [])]; }, get breaks() { return [...R.breaks.keys()]; }, get hosts() { return Object.fromEntries(R.hosts); }, get stations() { return list().map(s => ({ id: s.id, name: s.name, freq: s.freq, band: s.band, talkEvery: talkOf(s).every, talkLength: talkOf(s).length })); }, get all() { return list(); },
  };
}

const vehicleOn = () => !!(app.driving?.id || app.boating?.active || app.flight?.active);   // (a car, a boat, an aircraft)
/** The radio studio the listener stands in (2026-10-27, the product owner: "when i walk in that particular station, i want
 *  that station to be playing inside its own module"): its room on the floor the listener is on, and its station. */
function studioHere() {
  const Ls = app.sfx?.listener, W = S.world;
  if (!Ls || Ls.space !== 'in' || !(Ls.b >= 0) || !W) return null;
  const B = W.buildings[Ls.b], L = B && W.levels[B.lv?.[Ls.f]];
  if (!L?.mods?.length) return null;
  const P = app.player?.active ? app.player : null, x = P ? P.x : Ls.x, z = P ? P.z : Ls.z, loc = toLocal(B, x, z);
  for (const m of L.mods) {
    if (m.kind !== 'studio' || !inRect(loc.x, loc.z, m, 0.15)) continue;
    const st = list().find(s => s.studio && s.studio.b === Ls.b && s.studio.f === Ls.f && s.studio.room === m.id);
    if (st) return { st, m, b: Ls.b, f: Ls.f };
  }
  return null;
}
/** The next (dir 1) or previous (-1) station; from off, the first. */
function step(dir) {
  const L = list(); if (!L.length) return;
  const i = L.findIndex(s => s.id === saved());
  const n = i < 0 ? (dir > 0 ? 0 : L.length - 1) : (i + dir + L.length) % L.length;
  tune(L[n].id);
}
function tune(id) {
  const was = saved(); save(id || 'off');
  if (id === was) return;
  stop(0.25); endBreak();
  const fx = app.sfx;
  if (fx?.ready && inside) fx.play(id === 'off' ? 'radio-click' : 'radio-tune', { kind: 'radio', space: 'any', gain: id === 'off' ? 0.7 : 0.45 });
  paint(); openPanel(true);
  setTimeout(() => tick(true), id === 'off' ? 0 : 450);
}

// ------------------------------------------------------------------ playing
function chainFor(st) {
  const ctx = app.sfx.ctx, g = ctx.createGain(); g.gain.value = 0;
  let head = g;
  if (st.talk) {   // AM: no lows, no highs
    const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 320; lp.type = 'lowpass'; lp.frequency.value = 3400;
    g.connect(hp); hp.connect(lp); head = lp;
  }
  head.connect(app.sfx.out('radio'));
  return g;
}
function stop(fade = 0.8) {
  const c = cur; cur = null;
  if (!c) return;
  c.dead = true;
  if (c.g) { const ctx = app.sfx.ctx; c.g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); }
  setTimeout(() => { try { c.el?.pause(); c.el?.removeAttribute('src'); c.el?.load(); } catch { /* gone */ } try { c.src?.disconnect(); c.g?.disconnect(); } catch { /* gone */ } }, fade * 1000 + 300);
}
function startSong(st, air) {
  const ctx = app.sfx.ctx, a = new Audio();
  a.preload = 'auto'; a.crossOrigin = 'anonymous';
  a.src = `/api/music/file/${encodeURIComponent(air.track.id)}`;
  const c = { kind: 'song', st: st.id, track: air.track, round: air.round, i: air.i, el: a, g: chainFor(st), dead: false, want: null, t0: null };
  c.src = ctx.createMediaElementSource(a); c.src.connect(c.g);
  a.addEventListener('loadedmetadata', () => {
    if (c.dead) return;
    const now = onAir(stationTracks(S.music.tracks.values(), st), st.id, app.net.realNow(), st.order, talkOf(st).every);
    a.currentTime = Math.max(0, now?.kind === 'song' && now.track.id === c.track.id ? now.at : air.at);
    a.play().then(() => { if (!c.dead) c.g.gain.setTargetAtTime(1, ctx.currentTime, RADIO.crossfade / 3); }).catch(() => { c.dead = true; });
  }, { once: true });
  a.addEventListener('error', () => { c.dead = true; }, { once: true });
  return c;
}
function tick() {
  const fx = app.sfx, was = inside;
  const wasRoom = room?.m.id;
  room = vehicleOn() ? null : studioHere();
  inside = vehicleOn() || !!room;
  if (was !== inside || wasRoom !== room?.m.id) paint();
  const id = saved(), st = room ? room.st : id === 'off' ? null : stationById(id, list()) || (R.stations && id !== 'off' ? list()[0] || null : null);
  if (!inside || !st || !fx?.ready || !S.music?.ready || level('radio') === 0 || document.hidden) { if (cur) stop(inside ? 0.6 : 1.2); endBreak(); return; }
  if (performance.now() - R.loadedAt > 60000) { R.loadedAt = performance.now(); loadHosts(); }
  const songs = stationTracks(S.music.tracks.values(), st), t = app.net.realNow(), air = onAir(songs, st.id, t, st.order, talkOf(st).every);
  if (!air) { if (cur) stop(); paint(); return; }
  if (air.kind === 'ident') {
    if (cur?.kind === 'song') stop(1.2);
    const k = `${st.id}:${air.round}:${air.i}`;
    if (identAt !== k && air.at < 2.5 && st.ident) { identAt = k; fx.play(`ident-${st.id}`, { kind: 'radio', space: 'any', gain: 0.9, vary: 0 }); }
    if (!cur || cur.kind !== 'ident') cur = { kind: 'ident', st: st.id, dead: false };
    paint(); return;
  }
  if (!cur || cur.dead || cur.kind !== 'song' || cur.st !== st.id || cur.track.id !== air.track.id || cur.round !== air.round || cur.i !== air.i) {
    if (cur) stop(RADIO.crossfade);
    cur = startSong(st, air); paint(); return;
  }
  // keep to the station's clock (a slow network, a busy page): seek when more than a second and a half out
  cur.want = air.at;
  hostBreak(st, t);
  if (cur.g) cur.g.gain.setTargetAtTime(brk ? DUCK : 1, app.sfx.ctx.currentTime, brk ? 0.25 : 0.8);
  const a = cur.el;
  if (a && !a.paused && a.readyState >= 2 && Math.abs(a.currentTime - air.at) > 1.5) a.currentTime = air.at;
  if (a?.paused && a.readyState >= 2 && !cur.dead) a.play().catch(() => {});
}

// ------------------------------------------------------------------ the host's breaks
async function loadHosts() {
  try {
    const j = await getJSON('/api/radio/state');
    if (Array.isArray(j.stations)) setStations(j.stations);
    for (const b of j.breaks || []) R.breaks.set(b.key, b);
    paint();
  } catch { /* the next minute */ }
}
const breakSeconds = b => { const L = breakLines(b); return L.length ? L.at(-1).t1 : 0; };
/** Who talks at their studio desk now (the agents' bodies: render/agents.js plays them talking): the line on air here as
 *  it is really heard, else every station's break by its clock. */
function talkers() {
  if (!app.net?.realNow) return;
  const t = app.net.realNow(); for (const [k, b] of R.breaks) if (t - b.at > 600) R.breaks.delete(k);
  const set = talkingAt([...R.breaks.values()].filter(b => b !== brk?.b), t), l = brk?.line;
  if (l?.host?.body >= 0) set.add(l.host.body);
  S.radioTalk = set;
}
/** The break due now on station st (its moment: the song after the slot starts; joined late, from the line under way;
 *  the free voice only within its line's first seconds), played once; done ones forgotten. */
function hostBreak(st, t) {
  for (const [k, b] of R.breaks) if (t - b.at > breakSeconds(b) + 60) R.breaks.delete(k);
  if (brk) return;
  for (const b of R.breaks.values()) {
    if (b.station !== st.id || b.played) continue;
    const into = t - b.at, L = breakLines(b);
    if (into < -0.2 || into > breakSeconds(b) - 1) continue;
    const i = L.findIndex(l => into < l.t1); if (i < 0) continue;
    b.played = true; startBreak(st, b, L, i, Math.max(0, into - L[i].t0)); paint(); return;
  }
}
/** A host's free voice: one of the browser's English voices kept for that host (by their id), a pitch of their own. */
function freeVoice(u, host, st) {
  // (the computer's own voices first: Chrome's online ones fail now and then, and a failure used to end the break)
  const all = window.speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)), local = all.filter(v => v.localService);
  const en = local.length ? local : all, h = Number(host?.id) || list().findIndex(s => s.id === st.id) + 1;
  if (en.length && !u.plain) try { u.voice = en[Math.abs(h * 7) % en.length]; } catch { /* the default voice */ }
  u.pitch = [1, 0.86, 1.14][Math.abs(h) % 3]; u.rate = 1.02;
}
/** Line i of break b on station st, from s seconds into it; then the next line after a breath, to the last. */
function startBreak(st, b, L, i, into) {
  const l = L[i], k = { b, line: l, i };
  const next = () => { if (brk !== k) return; teardown(k); if (i + 1 < L.length) { brk = { b, line: null, i }; setTimeout(() => { if (brk?.b === b && !brk.line) startBreak(st, b, L, i + 1, 0); }, LINE_GAP * 1000); } else brk = null; paint(); };
  brk = k;
  setTimeout(() => { if (brk === k) next(); }, ((l.t1 - l.t0) * (l.audio ? 1 : 1.6) - into + 6) * 1000);   // (a voice that never says it finished; the free voice reads slower than the estimate)
  if (l.audio) {
    const ctx = app.sfx.ctx, a = new Audio(); a.crossOrigin = 'anonymous'; a.src = l.audio;
    const g = chainFor(st), src = ctx.createMediaElementSource(a); src.connect(g); g.gain.value = 1;
    Object.assign(k, { el: a, g, src });
    a.addEventListener('loadedmetadata', () => { try { a.currentTime = into; } catch { /* the start */ } a.play().catch(() => a.dispatchEvent(new Event('error'))); }, { once: true });
    a.addEventListener('ended', next, { once: true });
    // (a recording that will not play: the line read by the free voice instead, never a silent break)
    a.addEventListener('error', () => { if (brk !== k) return; teardown(k); startBreak(st, b, L.map((x, j) => (j === i ? { ...x, audio: null } : x)), i, Math.min(into, 2.5)); }, { once: true });
    return;
  }
  const SS = window.speechSynthesis;
  if (!SS || into > 3) { setTimeout(next, Math.max(0, l.t1 - l.t0 - into) * 1000); return; }   // (joined mid-line: wait for the next)
  // the free voice (2026-10-27: the host was never heard): the line read sentence by sentence (Chrome stops one long
  // utterance after ~15 s), a sentence that fails is skipped (and read once more in the default voice), never the break
  const parts = sentences(l.text);
  let n = 0, retried = false;
  const say = plain => {
    if (brk !== k) return;
    if (n >= parts.length) return next();
    const u = new SpeechSynthesisUtterance(parts[n]); u.plain = plain;
    freeVoice(u, l.host, st); u.volume = Math.min(1, level('radio') * 1.2);
    u.onend = () => { n++; retried = false; say(false); };
    u.onerror = e => { if (brk !== k || e.error === 'interrupted' || e.error === 'canceled') return; if (!retried) { retried = true; say(true); } else { n++; retried = false; say(false); } };
    k.utter = u; SS.speak(u);
  };
  if (SS.speaking || SS.pending) SS.cancel();
  setTimeout(() => say(false), 80);   // (Chrome drops a speak() right after a cancel())
}
/** A host's line as sentences of at most ~180 characters. */
function sentences(text) {
  const out = [];
  for (const s of String(text).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [String(text)]) {
    let t = s.trim(); if (!t) continue;
    while (t.length > 180) { const i = t.lastIndexOf(' ', 180) > 60 ? t.lastIndexOf(' ', 180) : 180; out.push(t.slice(0, i)); t = t.slice(i).trim(); }
    if (t) out.push(t);
  }
  return out;
}
function teardown(k) {
  if (k.utter) window.speechSynthesis?.cancel();
  if (k.el) { try { k.el.pause(); k.src.disconnect(); k.g.disconnect(); } catch { /* gone */ } }
}
function endBreak() {
  const k = brk; brk = null;
  if (k) teardown(k);
}
function openPanel(on) {
  if (!bar) return;
  clearTimeout(shut);
  bar.classList.toggle('open', !!on); btn?.classList.toggle('open', !!on);
  if (on) shut = setTimeout(() => openPanel(false), OPEN_MS);
}
function paint() {
  if (!bar) {
    bar = document.createElement('div'); bar.className = 'radio-hud hidden'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Radio');
    bar.innerHTML = '<button class="rh-b" data-d="-1" title="Previous station (Shift+R)" aria-label="Previous station">◀</button><div class="rh-t"><b class="rh-s"></b><span class="rh-n"></span></div><button class="rh-b" data-d="1" title="Next station (R)" aria-label="Next station">▶</button><button class="rh-b rh-off" title="Radio on or off" aria-label="Radio on or off">⏻</button>';
    bar.insertAdjacentHTML('beforeend', '<button class="rh-b rh-set hidden" title="This station: what it plays, its hosts, its name" aria-label="Station settings">⚙</button>');
    bar.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.classList.contains('rh-set')) { if (room) import('../ui/station-panel.js').then(M => M.openStation(app, room.st.id)); return; } if (room) return; if (b.classList.contains('rh-off')) tune(saved() === 'off' ? (list()[0]?.id || 'sunday') : 'off'); else step(Number(b.dataset.d)); });
    (document.getElementById('ui') || document.body).appendChild(bar);
    // phones: a 📻 button under the map slides the panel open; it tucks away again after a few seconds untouched
    btn = document.createElement('button'); btn.className = 'radio-btn hidden'; btn.title = 'Radio'; btn.setAttribute('aria-label', 'Radio'); btn.textContent = '📻';
    btn.onclick = () => openPanel(!bar.classList.contains('open'));
    (document.getElementById('ui') || document.body).appendChild(btn);
    bar.addEventListener('pointerdown', () => openPanel(true));
  }
  bar.classList.toggle('hidden', !inside); btn.classList.toggle('hidden', !inside);
  if (!inside) openPanel(false);
  btn.classList.toggle('on', !!room || !!stationById(saved(), list()));
  if (!inside) return;
  const st = room ? room.st : stationById(saved(), list());
  bar.classList.toggle('rh-studio', !!room);   // (in its studio: the station is fixed, no ◀ ▶ ⏻; ⚙ its settings for administrators)
  bar.querySelector('.rh-set').classList.toggle('hidden', !room || !['owner', 'admin'].includes(auth.me?.role));
  bar.style.setProperty('--rh', st?.color || '#888');
  bar.classList.toggle('off', !st);
  bar.querySelector('.rh-s').textContent = st ? `${room ? '🎙️ In the studio · ' : ''}${st.freq} ${st.band} · ${st.name}` : 'Radio off';
  bar.querySelector('.rh-n').textContent = !st ? 'R to turn it on' : level('radio') === 0 ? 'Volume at 0 (Settings → Sound → Radio)'
    : brk ? `🎙 ${(brk.line?.host || brk.b.host)?.name || 'The host'}: ${brk.line?.text || '…'}` : cur?.kind === 'song' ? `${cur.track.title || 'Untitled'}${cur.track.artist ? ` · ${cur.track.artist}` : ''}` : cur?.kind === 'ident' ? (R.hosts.get(st.id) || st.dj ? `${st.line} · with ${[...(R.hosts.get(st.id) || []).map(h => h.name), ...(st.dj ? [`DJ ${st.dj.name}`] : [])].join(', ')}` : st.line) : 'Tuning…';
  bar.querySelector('.rh-off').classList.toggle('on', !!st);
  bar.classList.toggle('talk', !!brk && level('radio') > 0);   // (the host's words as a caption while they talk)
}
