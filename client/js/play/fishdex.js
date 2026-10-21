// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Fishdex (docs/features/fishing.md §Fish, step 7b): every species there is — its picture (drawn from the game's
// own fish model: render/fish-models.js, a dark shape until you've landed one), how many you've landed and your
// biggest, the world record (the biggest anyone has landed, and who: server/play/angler.js), and where to find it (the
// grounds it holds on, its hours, what it takes, the trips that go there). Filters: sea, lake, legends; landed or not
// yet. Opened from the trips panel, the dock store and a trip's result (app.fishdex.open(species?)).
import * as THREE from 'three';
import { h, esc } from '../core/util.js';
import { getJSON } from '../core/net.js';
import { SPECIES, RARITY, speciesOf, toLb } from '/shared/fish-species.js';
import { TRIPS, GROUNDS, OPEN } from '/shared/fishing-trip.js';
import { LURE_BY_ID } from '/shared/fishing-gear.js';
import { catchModel } from '../render/fish-models.js';

let app = null, E = {}, data = null, sel = null, filter = 'all', only = 'all', loading = false;
const pics = new Map();   // species → a picture (data URL), drawn once
const FILTERS = [['all', 'All'], ['sea', '🌊 Sea'], ['lake', '🛶 Lake'], ['legend', '🐉 Legends']];
const kgTxt = kg => (kg < 10 ? kg.toFixed(2) : kg.toFixed(1));

export function initFishdex(a) {
  app = a;
  E.panel = document.getElementById('ui').appendChild(h('<div id="fishdex" class="panel hidden" role="dialog" aria-label="Fishdex"><div class="rp-head"><h3>📖 Fishdex</h3><button type="button" class="btn small rp-x">✕</button></div><div class="fd-bar"></div><div class="fd-main"><div class="fd-grid"></div><div class="fd-card hidden"></div></div></div>'));
  E.bar = E.panel.querySelector('.fd-bar'); E.grid = E.panel.querySelector('.fd-grid'); E.card = E.panel.querySelector('.fd-card');
  E.panel.querySelector('.rp-x').onclick = close;
  E.panel.addEventListener('click', onClick);
  app.fishdex = { open, close, refresh: () => { data = null; } };
}
async function open(species = null) {
  E.panel.classList.remove('hidden');
  sel = species && speciesOf(species) ? species : null;
  render();
  if (!data && !loading) {
    loading = true;
    try { data = await getJSON('/api/fishing/dex'); } catch (err) { data = { mine: {}, records: {}, count: 0, of: SPECIES.length, error: err.message }; }
    loading = false; render();
  }
  drawPics();
}
function close() { E.panel.classList.add('hidden'); dropRenderer(); }

// ------------------------------------------------------------------ what it shows
const listed = () => SPECIES.filter(s => (filter === 'all' || (filter === 'legend' ? s.legend : s.water === filter && !s.legend))
  && (only === 'all' || (only === 'got' ? data?.mine[s.id] : !data?.mine[s.id])));
function render() {
  const D = data, got = id => D?.mine?.[id];
  E.bar.innerHTML = `<div class="fd-count">${D ? `<b>${D.count}</b> of ${D.of} species landed` : 'Loading…'}${D ? `<span class="fd-prog"><i style="width:${(D.count / D.of * 100).toFixed(1)}%"></i></span>` : ''}</div>
    <div class="seg">${FILTERS.map(([k, t]) => `<button type="button" class="btn small${filter === k ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div class="seg">${[['all', 'Every one'], ['got', 'Landed'], ['not', 'Not yet']].map(([k, t]) => `<button type="button" class="btn small${only === k ? ' on' : ''}" data-o="${k}">${t}</button>`).join('')}</div>`;
  E.grid.innerHTML = listed().map(s => {
    const m = got(s.id), rec = D?.records?.[s.id];
    return `<button type="button" class="fd-tile${m ? ' got' : ''}${sel === s.id ? ' on' : ''}" data-s="${s.id}" style="--rc:${RARITY[s.rarity].color}" title="${esc(s.name)}">
      <span class="fd-pic">${pics.has(s.id) ? `<img src="${pics.get(s.id)}" alt="">` : ''}</span><b>${esc(s.name)}</b>
      <small>${m ? `×${m.n} · ${kgTxt(m.kg)} kg${rec?.mine ? ' 🥇' : ''}` : '<span class="dim">Not landed yet</span>'}</small></button>`;
  }).join('') || '<p class="hint">None like that.</p>';
  if (sel) { E.card.innerHTML = card(speciesOf(sel)); E.card.classList.remove('hidden'); } else E.card.classList.add('hidden');
}
/** Where a species is found: the grounds it holds on, the hours it feeds, the baits it takes, the trips that go there. */
function whereOf(s) {
  const grounds = Object.values(GROUNDS).filter(g => (g.water === 'both' || g.water === s.water) && g.hab.some(h => s.hab.includes(h)));
  const open = OPEN[s.water]?.some(h => s.hab.includes(h));
  const kinds = Object.entries(GROUNDS).filter(([, g]) => grounds.includes(g)).map(([k]) => k);
  const trips = TRIPS.filter(t => t.water === s.water && t.kinds.some(k => kinds.includes(k)) && (!s.legend || t.legend > 0));
  const when = ['dawn', 'the day', 'dusk', 'night'].filter((_, k) => s.act[k] >= 0.8);
  return { grounds, open, trips, when, lures: s.lures.map(id => LURE_BY_ID[id]).filter(Boolean) };
}
function card(s) {
  const m = data?.mine?.[s.id], rec = data?.records?.[s.id], r = RARITY[s.rarity], W = whereOf(s);
  return `<div class="fd-big">${pics.has(s.id) ? `<img class="${m ? '' : 'dark'}" src="${pics.get(s.id)}" alt="">` : ''}</div>
    <h4>${esc(s.name)}</h4>
    <div class="dim"><b style="color:${r.color}">${esc(r.label)}</b> · ${s.water === 'sea' ? '🌊 Sea' : '🛶 Lake'} · ${s.len[0]}–${s.len[1]} cm${s.legend ? ' · one of a kind' : ''}</div>
    <div class="fd-facts">
      <div><span>You</span>${m ? `<b>${m.n} landed</b> · biggest ${kgTxt(m.kg)} kg (${toLb(m.kg).toFixed(1)} lb), ${m.cm} cm` : '<span class="dim">Not landed yet</span>'}</div>
      <div><span>World record</span>${rec ? `<b>${kgTxt(rec.kg)} kg</b> (${rec.cm} cm) — ${rec.mine ? '🥇 yours!' : esc(rec.name)}` : '<span class="dim">Nobody yet — be the first</span>'}</div>
    </div>
    <h5>Where to find it</h5>
    <p>${W.grounds.map(g => `${g.icon} ${esc(g.label)}`).join(' · ')}${W.open ? `${W.grounds.length ? ' · ' : ''}open water` : ''}</p>
    <p>${W.when.length ? `Feeds best at ${W.when.length > 1 ? `${W.when.slice(0, -1).join(', ')} and ${W.when.at(-1)}` : W.when[0]}` : 'Feeds any time'} · ${s.depth[0]}–${s.depth[1]} m down</p>
    <p>Takes ${W.lures.map(l => `${l.icon} ${esc(l.name)}`).join(', ')}</p>
    ${W.trips.length ? `<p class="dim">Trips: ${W.trips.map(t => esc(t.label)).join(', ')}${s.legend ? ' — at its own ground, in its hour' : ''}</p>` : ''}`;
}
function onClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.f) { filter = t.dataset.f; render(); drawPics(); }
  else if (t.dataset.o) { only = t.dataset.o; render(); drawPics(); }
  else if (t.dataset.s) { sel = sel === t.dataset.s ? null : t.dataset.s; render(); if (sel && innerWidth < 760) E.panel.scrollTo({ top: 0, behavior: 'smooth' }); }   // (on a phone the card sits above the grid)
}

// ------------------------------------------------------------------ the pictures: each fish model drawn once, side on
let R = null, scene = null, cam = null, drawing = false;
function renderer() {
  if (R) return R;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setPixelRatio(1); R.setSize(192, 96); R.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a58, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 3, 1.5); scene.add(sun);
  cam = new THREE.OrthographicCamera(-0.6, 0.6, 0.3, -0.3, 0.01, 10);
  return R;
}
function dropRenderer() { if (!R || drawing) return; R.dispose(); R.forceContextLoss?.(); R = null; scene = null; cam = null; }
/** Draws the pictures not drawn yet (the listed ones first), a few a frame, then shows them. */
async function drawPics() {
  if (drawing) return;
  const want = [...listed(), ...SPECIES].filter((s, i, a) => !pics.has(s.id) && a.indexOf(s) === i);
  if (!want.length) return;
  drawing = true;
  try {
    const r = renderer();
    for (let k = 0; k < want.length; k++) {
      if (E.panel.classList.contains('hidden')) break;
      const s = want[k], o = catchModel({ species: s.id }, false);
      // side on, a little from above; a ray or a squid from higher up (their shape is in their top)
      const flat = s.body?.shape === 'ray' || s.body?.mark === 'ray' || s.body?.shape === 'squid';
      cam.position.set(flat ? 1.2 : 3, flat ? 2.6 : 0.6, 0); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
      scene.add(o); r.render(scene, cam); scene.remove(o);
      pics.set(s.id, r.domElement.toDataURL('image/png'));
      if (k % 6 === 5) { render(); await new Promise(res => requestAnimationFrame(res)); }
    }
  } catch { /* no pictures: the names still show */ }
  drawing = false;
  render();
  if (E.panel.classList.contains('hidden')) dropRenderer();
}
