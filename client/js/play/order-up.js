// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up, practice (phase 3 of PLAN-RESTAURANT-GAME.md, 2026-10-26, the product owner: "Think of the game Over Cooked
// but for MVW ... i want the player to be able to play"): a Rush played alone in the kitchen of the café floor you look
// into, on this page (real Rushes with others, on the server, are phase 4). The rules are shared/orderup/rules.js; this
// is the playing of them:
//   the camera   pinned over the kitchen at Overcooked's angle, the dining room in front, the pass at the bottom
//   you          your own character as the chef (render/agents.js extra, your look), walking, carrying, cooking,
//                washing; moves with W A S D or the arrows (screen-relative), E or Space to take, put down, put
//                together and serve, hold F (or Shift) to grind, chop and wash; on a phone a stick and two buttons
//   the kitchen  what each station holds drawn on it (render/orderup-items.js), the one you face outlined, a bar over
//                each that cooks (red as it goes over, smoke when burnt), steam, flecks and a Supreme's sparkle
//                (render/kitchen-fx.js), the grade popping up over the pass
//   the HUD      the tickets with their patience, the clock, money and tips, a hint for what E or F does here;
//                at the end the stars, the grades, again or leave
//   the picker   (2026-10-27, "id prefer if the swapping visually has like a picture of the items im looking for"): E at
//                the fridge, the pantry or the plating counter opens a row of cards over it, each a picture of the item
//                (its own model, rendered once), the coach's choice ready: click or tap one, 1 2 3, or ← → and E;
//                Esc or walking off closes it
//   the coach    (2026-10-27, "we need some kind of indication of what to do"): before the Rush a card says how to play;
//                during it (on unless turned off with 🧭) a "Next" line says what to do now and an arrow bobs over the
//                station to go to (shared/orderup/guide.js, the same steps the computer cooks will take), and each
//                ticket shows its recipe in short, the one being worked on outlined
//   the sound    (2026-10-27, "start creating sound effects for everything, use Elevenlabs ... make the restaurant/cafe
//                game sound good": the ou-* sounds of client/assets/sfx, made with ElevenLabs, played in the kitchen's
//                place by the sound engine, the Sound effects slider): a clink, a rustle or a door for every take and
//                put by what it is and where, pours, the portafilter locking in, a ding when something is done, beeps
//                as it goes over, a sizzle when it burns, the service bell, a chime by the grade and coins for a tip,
//                the ticket printer, the machines running while they cook (the espresso pump, the steam wand, the
//                blender, the press, the oven's fan), grinding, chopping and washing while you work, the kitchen's own
//                room, the chef's steps on the tiles, the start bell, the last ten seconds ticking, the end bell
import * as THREE from 'three';
import { S as ST, bus, bld, levelOf, holdView, releaseView } from '../core/state.js';
import { kitchenFloor } from '/shared/edit.js';
import { modsAt } from '/shared/interior-kinds.js';
import { CATALOG } from '/shared/catalog.js';
import { FOOD_BY_ID } from '/shared/food.js';
import { newRush, interact, work, step, starsOf, stationView, AUTO, WORK, dishOf, choices, givesAt, itemName, chopsOf, takesItem, plateFor, intoWare } from '/shared/orderup/rules.js';
import { nextStep, focusTicket, RECIPES } from '/shared/orderup/guide.js';
import { itemMesh, lookKey, itemLight } from '../render/orderup-items.js';
import { GU } from '../render/scene.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { COURSES, courseParams } from '/shared/orderup/module.js';
import { fmtVc } from '/shared/play.js';
import { CLIP, CLIP_DUR, CLIP_STRIDE } from '../render/anim.js';
import { PLAYER_APP } from '../render/agents.js';

const STEP = 0.05, SPEED = 3.1, R = 0.27, PLAYS = new Set(['ou_fridge', 'ou_pantry', 'ou_prep', 'ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_oven', 'ou_press', 'ou_blender', 'ou_plating', 'ou_pass', 'ou_dishes', 'ou_sink', 'ou_bin', 'ou_kettle', 'ou_toaster', 'ou_juicer', 'ou_griddle', 'ou_grill', 'ou_fryer', 'ou_soda', 'ou_taps', 'ou_wine', 'ou_cocktail', 'ou_pizza_oven', 'ou_stove', 'ou_wok', 'ou_popcorn', 'ou_tandoor', 'ou_rice', 'ou_bamboo', 'ou_freezer']);
// where a station's item sits, in the station's own frame (x, y, z)
const TOP = { ou_oven: [0, 0.7, 0.22], ou_espresso: [-0.2, 0.955, 0.15], ou_steamer: [0.08, 0.955, 0.17], ou_blender: [0.07, 1.08, -0.09], ou_press: [0, 1.0, 0.02],
  ou_sink: [-0.42, 0.86, 0], ou_pass: [0, 1.05, 0.05], ou_grinder: [-0.17, 0.97, 0.07], ou_prep: [-0.12, 0.96, 0.04], ou_plating: [0.3, 0.93, 0.14], ou_dishes: [0, 1.07, 0.1],
  // (the new appliances, 2026-10-28: under the tea urn's tap, on the toaster's tray, under the juicer's spout, on the griddle's
  // plate and the grill's grates where nothing is drawn, in the fryer's other well, under the soda fountain's valve)
  ou_kettle: [-0.2, 0.945, 0.08], ou_toaster: [-0.05, 0.97, 0.14], ou_juicer: [-0.18, 0.93, 0.08], ou_griddle: [-0.25, 0.975, 0.0], ou_grill: [0.1, 1.02, 0.04],
  ou_fryer: [0.19, 0.94, 0.03], ou_soda: [-0.3, 0.955, 0.09],
  ou_taps: [-0.25, 0.95, 0.08], ou_wine: [0, 0.932, 0.13], ou_cocktail: [0, 0.928, 0.08],   // (the bar's: under a tap, the pouring board, the shaker's mat)
  ou_pizza_oven: [0, 0.905, 0.34], ou_stove: [-0.24, 1.127, 0.16], ou_wok: [-0.08, 1.082, 0],   // (at the oven's mouth, in the pot of water, in the wok)
  ou_popcorn: [0, 0.975, 0.08],   // (in the popcorn machine's cabinet, in front of its heap)
  ou_tandoor: [-0.08, 1.025, 0], ou_bamboo: [-0.1, 1.185, 0], ou_rice: [0, 0.95, 0.12], ou_freezer: [0, 0.95, 0.2] };   // (over the tandoor's mouth, on the top basket)
// where an item of a kind sits instead (the stove: the soup's saucepan on the free burner, the pasta in the pot of water)
const TOP_K = { ou_stove: { soup: [0.24, 0.97, 0.16] } };
// (on the stove the rest go in their saucepan on the free burner, as the soup: only these go in its pot of water)
const IN_WATER = new Set(['pasta', 'egg', 'lobster', 'shrimp_cocktail']);
const STAR = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let app = null, game = null, btn = null, seen = 0;
const PICKNAME = { milk: 'Milk', tomato: 'Tomato', berries: 'Berries', croissant: 'Croissant', bread: 'Bread', plate: 'Plate', cup: 'Cup', glass: 'Glass',
  fries: 'Fries', patty: 'Patty', batter: 'Batter', orange: 'Orange', avocado: 'Avocado', bun: 'Bun', wineglass: 'Wine glass', coupe: 'Cocktail glass', dough: 'Pizza dough', pasta: 'Pasta', noodles: 'Noodles', stock: 'Stock', pepper: 'Pepper', bowl: 'Bowl',
  kernels: 'Popcorn kernels', sausage: 'Sausage', tortilla: 'Tortilla', water: 'Water', curry: 'Curry', fish: 'Fish', chicken: 'Chicken', dumplings: 'Dumplings',
  red: 'Red', white: 'White', bubbly: 'Champagne' };
/** A thing's name on its card: its own, else the menu's (a dish's makings: "Lasagna"; a part: "Egg"). */
const pickName = (k, K = game?.S?.K) => PICKNAME[k] || (w => w.charAt(0).toUpperCase() + w.slice(1))(K?.dishes[k]?.name || K?.say?.[k] || k.replace(/_/g, ' '));
// what a choice looks like on its card: a wine poured is a wine glass of it
const LOOK = { red: { k: 'wineglass', st: 'red' }, white: { k: 'wineglass', st: 'white' }, bubbly: { k: 'wineglass', st: 'bubbly' }, sake: { k: 'cup', st: 'sake' }, sangria: { k: 'glass', st: 'sangria' } };
const THUMBS = new Map();
/** A picture of an item (its own model, lit, from above at an angle), rendered once into a 160 px image. */
function thumb(k) {
  if (THUMBS.has(k)) return THUMBS.get(k);
  let url = '';
  try {
    const R = app.stage.renderer, N = 160, rt = new THREE.WebGLRenderTarget(N, N), sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
    const it = itemMesh(LOOK[k] || { k, st: { milk: 'cold', tomato: 'whole', berries: 'whole', croissant: 'warm', bread: 'plain', plate: 'clean', cup: 'empty', glass: 'empty',
      fries: 'frozen', patty: 'raw', batter: 'raw', orange: 'whole', avocado: 'whole', bun: 'plain', wineglass: 'empty', coupe: 'empty',
      dough: 'raw', pasta: 'raw', noodles: 'raw', stock: 'raw', pepper: 'whole', bowl: 'clean', kernels: 'raw', sausage: 'raw', tortilla: 'raw', water: 'cold',
      curry: 'raw', fish: 'whole', chicken: 'raw', dumplings: 'raw' }[k] || game?.S?.K.fresh[k] || '' });   // (else as the store gives it: the egg, the bacon)
    sc.add(it, new THREE.AmbientLight(0xffffff, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(1, 2, 1.5); sc.add(sun);
    const box = new THREE.Box3().setFromObject(it), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
    cam.position.set(c.x, c.y + r * 1.7, c.z + r * 2.9); cam.lookAt(c);
    const was = R.getRenderTarget(), cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam);
    const px = new Uint8Array(N * N * 4); R.readRenderTargetPixels(rt, 0, 0, N, N, px);
    R.setRenderTarget(was); R.setClearColor(cc, ca); rt.dispose();
    const cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'), img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = ((N - 1 - y) * N + x) * 4, b = (y * N + x) * 4;   // (flipped, and from linear to the screen's colours)
      for (let ch = 0; ch < 3; ch++) img.data[b + ch] = 255 * Math.pow(px[a + ch] / 255, 1 / 2.2); img.data[b + 3] = px[a + 3]; }
    g.putImageData(img, 0, 0); url = cv.toDataURL();
  } catch { url = ''; }
  THUMBS.set(k, url); return url;
}

class Practice {
  constructor(ents, kitchen = null, menu = null, ranked = false) {
    this.ranked = ranked;   // (a kitchen with its record: its Rushes may count, shared/orderup/module.js)
    this.run = null; this.n = 0; this.course = 'practice';   // (a Rush that counts: its run, the beats played, its level)
    this.kitchen = kitchen;   // (its template: shared/orderup/kitchens.js)
    this.menu = menu;   // (what its place sells, item ids: its Rush orders only those)
    const pass = ents.find(e => e.t === 'ou_pass');
    this.o = { x: pass.x, z: pass.z, y: pass.y, c: Math.cos(pass.yaw), s: Math.sin(pass.yaw) }; this.yaw0 = pass.yaw;
    this.st = ents.filter(e => PLAYS.has(e.t)).map(e => ({ e, id: e.id, t: e.t, box: this.aabb(e) }));
    const all = ents.filter(e => e.t.startsWith('ou_')).map(e => this.aabb(e));
    this.room = { u0: Math.min(...all.map(b => b.u0)), u1: Math.max(...all.map(b => b.u1)), v0: Math.min(...all.map(b => b.v0)), v1: this.aabb(pass).v0 };
    // the chef starts just inside the hatch, the most open place of a kitchen however its stations stand (an island down
    // the middle of a big one, an arrangement by hand), else the free place nearest it
    const clear = (u, v) => u > this.room.u0 + R && u < this.room.u1 - R && v > this.room.v0 + R && v < this.room.v1 - R
      && !this.st.some(s => s.box.block && u > s.box.u0 - R - 0.03 && u < s.box.u1 + R + 0.03 && v > s.box.v0 - R - 0.03 && v < s.box.v1 + R + 0.03);
    let at = { u: 0, v: this.room.v1 - 0.6 };
    for (let r = 0.1; r < 8 && !clear(at.u, at.v); r += 0.1) for (let a = 0; a < 6.28; a += 0.2) { const u = Math.cos(a) * r, v = this.room.v1 - 0.6 + Math.sin(a) * r; if (clear(u, v)) { at = { u, v }; break; } }
    this.me = { u: at.u, v: at.v, fu: 0, fv: -1, dist: 0, workT: 0 };
    this.keys = new Set(); this.stick = { u: 0, v: 0 }; this.meshes = new Map(); this.smokeT = 0; this.acc = 0; this.paused = false;
  }
  // ---- the kitchen's frame: u along the pass, v from the pass towards the dining room (the kitchen is at v < 0)
  local(x, z) { const dx = x - this.o.x, dz = z - this.o.z; return { u: dx * this.o.c - dz * this.o.s, v: dx * this.o.s + dz * this.o.c }; }
  world(u, v) { return { x: this.o.x + u * this.o.c + v * this.o.s, z: this.o.z - u * this.o.s + v * this.o.c }; }
  aabb(e) {
    const r = CATALOG[e.t].rect, p = this.local(e.x, e.z), a = e.yaw - this.yaw0, c = Math.cos(a), s = Math.sin(a);
    const us = [], vs = [];
    for (const [lx, lz] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) { us.push(p.u + lx * c + lz * s); vs.push(p.v - lx * s + lz * c); }
    return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), block: CATALOG[e.t].block !== false };
  }
  open() {
    const pass = this.st.find(s => s.t === 'ou_pass').e;
    this.S = newRush(this.st.map(s => ({ id: s.id, t: s.t })), { seed: `${Date.now()}`, dur: 180, ...(this.kitchen ? { kitchen: this.kitchen } : {}), ...(this.menu ? { menu: this.menu } : {}) });
    this.byId = new Map(this.st.map(s => [s.id, s]));
    this.group = new THREE.Group(); this.group.name = 'order-up'; app.stage.scene.add(this.group);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffd34d }));
    this.outline.visible = false; this.group.add(this.outline);
    this.marker = new THREE.Group(); this.marker.visible = false; this.group.add(this.marker);   // (the coach's arrow over the next station)
    const mm = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95, depthTest: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 16), mm); cone.rotation.x = Math.PI; this.marker.add(cone);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), mm); stem.position.y = 0.26; this.marker.add(stem);
    this.marker.renderOrder = 10; this.marker.traverse(m => { m.renderOrder = 10; });
    this.coach = localStorage.getItem('ou.coach') !== 'off';
    this.extra = { x: 0, y: this.o.y, z: 0, yaw: 0, clip: CLIP.idle, ph: 0, pclip: CLIP.idle, pph: 0, w: 0, app: PLAYER_APP, prop: 0, flags: 4 };   // (4: indoors, lit by the room, as the player inside a building: player.js; 2026-10-27, "when its dark outside the character is dark even though they are inside")
    app.agents.extra.push(this.extra);
    this.aim(); this.onResize = () => this.aim(); addEventListener('resize', this.onResize);
    this.ui();
    this.onKey = e => this.key(e, true); this.onKeyUp = e => this.key(e, false);
    addEventListener('keydown', this.onKey, true); addEventListener('keyup', this.onKeyUp, true);
    document.body.classList.add('mp-playing', 'ou-playing');
    this.space = pass.b ?? ST.focus.b; this.heard = new Set(); this.loops = new Map(); this.warnAt = new Map(); this.stepAt = 0; this.started = false; this.tickAt = 99;
    this.startAt = Infinity; this.last = performance.now();
    this.intro();
  }
  /** How to play, before the Rush: the goal, the loop, the keys, the coach on or off; Start begins it. */
  intro() {
    const DISHES = this.S.K.dishes, also = d => { const its = (this.S.sells?.[d] || []).filter(i => i !== d && FOOD_BY_ID[i]); return its.length ? ` <small>(${its.map(i => esc(FOOD_BY_ID[i].name)).join(', ')})</small>` : ''; };
    const menu = this.S.menu.map(d => `<li><b>${DISHES[d].icon} ${esc(DISHES[d].name)}</b>${also(d)}: ${(RECIPES[d] || []).join(' → ')}</li>`).join('');
    this.E.menu.classList.remove('hidden');
    this.E.menu.innerHTML = `<div class="ou-card ou-intro"><h3>🍳 Order Up</h3><div class="ou-me"></div><div class="ou-courses"></div><div class="ou-board"></div><div class="ou-skillbox"></div>
      <p class="ou-goal">Orders come in at the top. Make each dish and serve it at <b>the pass</b> (the counter with the heat lamps) before the customer gives up. Better timing, better grade, bigger tips.</p>
      <ol class="ou-loop"><li>Read the next ticket</li><li>Get what it needs (fridge, pantry, plates, cups and glasses)</li><li>Cook it: the machines cook by themselves, take things out before they burn</li><li>Serve it at the pass</li></ol>
      <div class="ou-keys"><span><kbd>W A S D</kbd> move</span><span><kbd>E</kbd> take · put down · combine · serve</span><span><kbd>F</kbd> hold to grind · chop · wash</span><span><kbd>Esc</kbd> pause</span></div>
      <details class="ou-menulist"><summary>This kitchen's menu</summary><ul>${menu}</ul></details>
      <label class="ou-coachopt"><input type="checkbox" class="ou-coachbox" ${this.coach ? 'checked' : ''}> Coach: show me what to do next</label>
      <div class="ou-why"></div><button type="button" class="ou-big ou-go">${this.startWords()}</button><button type="button" class="ou-big ou-quit">Leave the kitchen</button></div>`;
    let going = false;
    const go = async () => {
      if (going) return; going = true;
      if (this.course === 'practice' && this.mySkills) this.S = newRush(this.st.map(s => ({ id: s.id, t: s.t })), { seed: `${Date.now()}`, dur: 180, ...(this.kitchen ? { kitchen: this.kitchen } : {}), ...(this.menu ? { menu: this.menu } : {}), skills: { you: this.mySkills } });   // (practice with the cook's skills)
      if (this.course !== 'practice') {   // (a Rush that counts: the server lays it out and plays it again at the end)
        const b = this.E.menu.querySelector('.ou-go'); b.disabled = true; b.textContent = 'Starting…';
        try { await this.begin(this.course); } catch (e) { b.disabled = false; b.textContent = this.startWords(); this.E.menu.querySelector('.ou-why').textContent = e.message || 'That Rush could not start'; going = false; return; }
      }
      const mins = (this.run?.course.dur ?? this.S.dur) / 60;
      this.E.menu.classList.add('hidden'); this.E.menu.innerHTML = ''; this.startAt = performance.now() + 1500; this.banner(`${this.run ? this.run.course.label : 'Rush'}! ${mins} minute${mins === 1 ? '' : 's'}`, 1400); removeEventListener('keydown', key, true);
    };
    const key = e => { if (e.code === 'Enter' && this.startAt === Infinity) { e.preventDefault(); e.stopPropagation(); go(); } };
    addEventListener('keydown', key, true);
    this.E.menu.querySelector('.ou-coachbox').addEventListener('change', e => this.setCoach(e.target.checked));
    this.E.menu.querySelector('.ou-go').addEventListener('click', go);
    this.E.menu.querySelector('.ou-quit').addEventListener('click', () => { removeEventListener('keydown', key, true); close(); });
    this.levels();
  }
  startWords() { const c = COURSES.find(x => x.id === this.course); return c ? `Start: ${c.label} (${c.dur / 60} minutes)` : 'Start a practice Rush (3 minutes)'; }
  /** The Rush levels on the card: practice, and those that count (open in turn: their stars and best), the cook's level. */
  async levels() {
    const box = this.E.menu.querySelector('.ou-courses'), me = this.E.menu.querySelector('.ou-me'); if (!box) return;
    const signed = auth.can('play.use') && this.ranked;
    let prof = null, cook = null;
    if (signed) { try { [prof, cook] = await Promise.all([getJSON('/api/play/profile'), getJSON('/api/orderup/cook').catch(() => null)]); } catch { prof = null; } }
    if (!box.isConnected) return;
    const M = prof?.modules?.orderup, open = new Set(M?.unlocked || []);
    const row = c => { const b = M?.best?.[c.id], lock = !open.has(c.id);
      return `<button type="button" class="ou-course${lock ? ' locked' : ''}" data-c="${c.id}"${lock ? ' disabled' : ''}><b>${lock ? '🔒 ' : ''}${esc(c.label)}</b><span class="ou-cstars">${STAR(b?.stars || 0)}</span><small>${lock ? `A star on ${esc(COURSES.find(x => x.id === c.after)?.label || '')} opens it` : esc(c.blurb)}${b ? ` · best ${Number(b.score).toLocaleString('en-US')} pts${b.place ? ` (#${b.place})` : ''}` : ''}</small></button>`; };
    box.innerHTML = `<button type="button" class="ou-course" data-c="practice"><b>Practice</b><small>Three minutes, nothing recorded</small></button>${prof ? COURSES.map(row).join('') : ''}`;
    if (prof && M) {
      const ou = prof.badges.filter(b => b.id.startsWith('ou_')).length;
      me.innerHTML = `<span>Order Up level <b>${M.level}</b></span><span class="ou-lvbar" title="${Math.round(M.progress.pct * 100)} % to level ${M.level + 1}"><i style="width:${Math.round(M.progress.pct * 100)}%"></i></span><span>${prof.rank.icon} ${esc(prof.rank.name)}</span><span>📖 Cookbook <b>${cook?.count ?? 0}</b>/${cook?.all ?? 212}</span><span>🏅 ${ou} badge${ou === 1 ? '' : 's'}</span>`;
      if (this.course === 'practice' && open.size) { this.course = [...open].pop(); }   // (the highest open level, chosen)
    } else if (!this.ranked) me.innerHTML = '<span class="dim">This kitchen\'s Rushes are practice only</span>';
    else if (!auth.can('play.use')) me.innerHTML = '<span class="dim">Sign in for Rushes that count: levels, badges, the Cookbook</span>';
    if (cook?.skills) this.skillsPanel(cook.skills);
    const pick = id => { this.course = id; box.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x.dataset.c === id)); const g = this.E.menu.querySelector('.ou-go'); if (g && !g.disabled) g.textContent = this.startWords(); if (prof) this.board(id); };
    box.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => pick(b.dataset.c)));
    pick(this.course);
  }
  /** A Rush level's leaderboard on the card: players and agents (🤖) side by side, the cook's own place. */
  async board(id) {
    const el = this.E.menu.querySelector('.ou-board'); if (!el) return;
    if (id === 'practice') { el.innerHTML = ''; return; }
    let b; try { b = await getJSON(`/api/play/leaderboard?module=orderup&course=${encodeURIComponent(id)}&limit=8`); } catch { el.innerHTML = ''; return; }
    if (!el.isConnected || this.course !== id) return;
    const row = r => `<li${r.id === auth.account?.id ? ' class="me"' : ''}><span class="ou-bp">#${r.place}</span><span class="ou-bn">${r.agent ? '🤖 ' : ''}${esc(r.name)}</span><span class="ou-bs">${STAR(r.stars)}</span><b>${Number(r.score).toLocaleString('en-US')}</b></li>`;
    el.innerHTML = b.rows.length ? `<details${this.boardOpen ? ' open' : ''}><summary>🏆 ${esc(COURSES.find(c => c.id === id)?.label || '')}: the best cooks, players and agents</summary><ol>${b.rows.map(row).join('')}${b.you && !b.rows.some(r => r.id === b.you.id) ? row(b.you) : ''}</ol></details>` : '';
    el.querySelector('details')?.addEventListener('toggle', e => { this.boardOpen = e.target.open; });
  }
  /** The cook's skills on the card: each skill's rank (its pips), a point into it while there are points, a fresh start. */
  skillsPanel(K) {
    const box = this.E.menu.querySelector('.ou-skillbox'); if (!box) return;
    this.mySkills = Object.fromEntries(K.list.filter(x => x.rank).map(x => [x.id, x.rank]));
    const free = K.points.free, open = box.querySelector('details')?.open || free > 0;
    box.innerHTML = `<details${open ? ' open' : ''}><summary>🎓 Skills · ${free ? `<b>${free} point${free === 1 ? '' : 's'} to spend</b>` : `${K.points.spent} point${K.points.spent === 1 ? '' : 's'} spent`} <span class="dim">(a point every Order Up level)</span></summary>
      <div class="ou-skills">${K.list.map(x => `<div class="ou-skill" title="${esc(x.blurb)}"><span class="ou-sk-n">${x.icon} ${esc(x.name)}</span><span class="ou-pips">${'●'.repeat(x.rank)}${'○'.repeat(K.max - x.rank)}</span>${free && x.rank < K.max ? `<button type="button" class="ou-sk-up" data-s="${x.id}">+</button>` : '<span></span>'}<small>${esc(x.blurb)}</small></div>`).join('')}</div>
      ${K.points.spent ? `<button type="button" class="ou-sk-reset">A fresh start: take every point back (${K.respec} VC)</button>` : ''}<div class="ou-sk-why"></div></details>`;
    const why = m => { const w = box.querySelector('.ou-sk-why'); if (w) w.textContent = m || ''; };
    box.querySelectorAll('.ou-sk-up').forEach(b => b.addEventListener('click', async () => { try { this.skillsPanel(await post('/api/orderup/skill', { id: b.dataset.s })); } catch (e) { why(e.message); } }));
    box.querySelector('.ou-sk-reset')?.addEventListener('click', async () => { try { this.skillsPanel(await post('/api/orderup/respec', {})); } catch (e) { why(e.message); } });
  }
  /** A Rush that counts: the server lays it out (its seed, the kitchen's stations in their order, the menu); played here,
   *  every press and every held beat noted for the server to play it again at the end. */
  async begin(id) {
    const C = COURSES.find(c => c.id === id);
    const r = await post('/api/play/start', { module: 'orderup', course: id, where: { b: this.space, f: ST.focus.f } });
    const d = r?.data, by = new Map(this.st.map(s => [s.id, s]));
    if (!d?.stations?.length || d.stations.some(x => !by.has(x.id))) { post('/api/play/abandon', { run: r?.run }).catch(() => {}); throw new Error('This kitchen has changed: leave it and come back in'); }
    this.st = d.stations.map(x => by.get(x.id)); this.byId = new Map(this.st.map(s => [s.id, s]));
    this.S = newRush(d.stations, { seed: d.seed, dur: C.dur, ...(d.kitchen ? { kitchen: d.kitchen } : {}), ...(d.menu ? { menu: d.menu } : {}), course: courseParams(C), ...(d.skills ? { skills: { you: d.skills } } : {}) });   // (with the skills the server has: it plays it again with them)
    this.run = { id: r.run, course: C, log: [], f: null }; this.n = 0;
  }
  setCoach(on) { this.coach = !!on; localStorage.setItem('ou.coach', on ? 'on' : 'off'); this.root.classList.toggle('coach', this.coach); this.root.querySelector('.ou-coachbtn')?.classList.toggle('on', this.coach); }
  /** The camera over the kitchen, the pass at the bottom, the whole kitchen in view on any screen. */
  aim() {
    const R0 = this.room, cu = (R0.u0 + R0.u1) / 2, cv = (R0.v0 + R0.v1) / 2 + 0.2, w = R0.u1 - R0.u0 + 1.6, d = R0.v1 - R0.v0 + 2;
    const C = app.stage.camera, aspect = innerWidth / Math.max(1, innerHeight), tan = Math.tan(C.fov * Math.PI / 360);
    const dist = Math.max(8, w / 2 / (tan * aspect) * 1.05, d / tan * 0.62);
    const at = this.world(cu, cv), back = this.world(cu, cv + dist * 0.5);
    app.cam.pinTo(new THREE.Vector3(back.x, this.o.y + dist * 0.86, back.z), new THREE.Vector3(at.x, this.o.y + 0.7, at.z));
  }
  ui() {
    const root = this.root = document.createElement('div');
    root.className = 'ou-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Order Up practice');
    root.innerHTML = `<div class="ou-top"><div class="ou-tickets"></div>
        <div class="ou-stats"><b class="ou-time">3:00</b><span class="ou-money">$0.00</span><span class="ou-pts">0 pts</span></div>
        <button type="button" class="ou-btn ou-coachbtn" title="Coach: show what to do next" aria-label="Coach on or off">🧭</button><button type="button" class="ou-btn ou-pause" title="Pause (Esc)" aria-label="Pause">⏸</button><button type="button" class="ou-btn ou-leave" title="Leave" aria-label="Leave the kitchen">✕</button></div>
      <div class="ou-bars"></div><div class="ou-pops"></div><div class="ou-banner"></div><div class="ou-next"><kbd></kbd><span></span></div><div class="ou-picker"></div><div class="ou-hint"></div>
      <div class="ou-pad"><div class="ou-stick"><i></i></div><button type="button" class="ou-act ou-grab">Grab</button><button type="button" class="ou-act ou-work">Work</button></div>
      <div class="ou-menu hidden"></div>`;
    document.body.appendChild(root);
    const q = s => root.querySelector(s);
    this.E = { tickets: q('.ou-tickets'), time: q('.ou-time'), money: q('.ou-money'), pts: q('.ou-pts'), bars: q('.ou-bars'), pops: q('.ou-pops'), banner: q('.ou-banner'), hint: q('.ou-hint'), menu: q('.ou-menu'), stick: q('.ou-stick'), next: q('.ou-next'), nextKey: q('.ou-next kbd'), nextText: q('.ou-next span'), picker: q('.ou-picker') };
    q('.ou-coachbtn').addEventListener('click', () => this.setCoach(!this.coach)); this.setCoach(this.coach);
    q('.ou-leave').addEventListener('click', () => close());
    q('.ou-pause').addEventListener('click', () => this.pause(!this.paused));
    const grab = q('.ou-grab'), wk = q('.ou-work');
    grab.addEventListener('pointerdown', e => { e.preventDefault(); this.press(); });
    wk.addEventListener('pointerdown', e => { e.preventDefault(); this.keys.add('Work'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) wk.addEventListener(ev, () => this.keys.delete('Work'));
    const stick = this.E.stick, knob = stick.querySelector('i');
    let sid = null, sx = 0, sy = 0;
    stick.addEventListener('pointerdown', e => { sid = e.pointerId; sx = e.clientX; sy = e.clientY; stick.setPointerCapture(e.pointerId); });
    stick.addEventListener('pointermove', e => { if (e.pointerId !== sid) return; const dx = e.clientX - sx, dy = e.clientY - sy, m = Math.hypot(dx, dy), k = Math.min(1, m / 45) / Math.max(1, m);
      this.stick = { u: dx * k, v: dy * k }; knob.style.transform = `translate(${dx * k * 30}px, ${dy * k * 30}px)`; });
    for (const ev of ['pointerup', 'pointercancel']) stick.addEventListener(ev, () => { sid = null; this.stick = { u: 0, v: 0 }; knob.style.transform = ''; });
    this.ticketEls = new Map(); this.barEls = new Map();
  }
  key(e, down) {
    const k = e.code, map = { KeyW: 'Up', ArrowUp: 'Up', KeyS: 'Down', ArrowDown: 'Down', KeyA: 'Left', ArrowLeft: 'Left', KeyD: 'Right', ArrowRight: 'Right', KeyF: 'Work', ShiftLeft: 'Work', ShiftRight: 'Work' };
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // (the browser's own: reload, copy, its tools)
    if (this.picker && down && !e.repeat && ['Escape', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(k)) {
      const pk = this.picker, n = pk.opts.length;
      if (k === 'Escape') this.closePicker();
      else if (/Digit|Numpad/.test(k)) { const i = Number(k.slice(-1)) - 1; if (i < n) this.choose(i); }
      else { const d = k === 'ArrowLeft' || k === 'KeyA' ? n - 1 : 1; for (let t = 0; t < n; t++) { pk.i = (pk.i + d) % n; if (pk.opts[pk.i].left > 0) break; } this.drawPicker(); }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === 'Escape') { if (down) this.pause(!this.paused); }
    else if (k === 'KeyE' || k === 'Space') { if (down && !e.repeat) this.press(); }
    else if (map[k]) { if (down) this.keys.add(map[k]); else this.keys.delete(map[k]); }
    else {   // (any other key is kept from the world while the Rush is on: G, Home, the floor keys … don't take you out; only
      // Leave or the end of the Rush does, the product owner 2026-10-27: "only quitting the cooking game or finishing the game")
      if (down) { e.stopPropagation(); e.stopImmediatePropagation(); }
      return;
    }
    e.preventDefault(); e.stopPropagation();   // (the kitchen's, not the world's: the avatar and the camera keep still)
  }
  pause(on) {
    if (this.S.over || this.startAt === Infinity) return;   // (not over the how-to-play card)
    this.paused = on; this.E.menu.classList.toggle('hidden', !on);
    if (on) { this.E.menu.innerHTML = `<div class="ou-card"><h3>Paused</h3><button type="button" class="ou-big ou-resume">Resume</button><button type="button" class="ou-big ou-quit">Leave the kitchen</button></div>`;
      this.E.menu.querySelector('.ou-resume').addEventListener('click', () => this.pause(false)); this.E.menu.querySelector('.ou-quit').addEventListener('click', () => close()); }
  }
  /** The station in front of you (its box near the point ahead), or null. */
  facing() {
    const m = this.me, pu = m.u + m.fu * 0.55, pv = m.v + m.fv * 0.55;
    let best = null, bd = 0.42;
    for (const s of this.st) { const b = s.box, du = Math.max(b.u0 - pu, 0, pu - b.u1), dv = Math.max(b.v0 - pv, 0, pv - b.v1), d = Math.hypot(du, dv); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  press(pick = null) {
    if (this.paused || this.S.over || performance.now() < this.startAt) return;
    if (this.picker && pick == null) { this.choose(this.picker.i); return; }
    const s = this.facing(); if (!s) return;
    const S = this.S, h = S.items[S.players.you.hold], on = S.items[S.st[s.id].slot], gives = givesAt(S, s.id), swap = gives && S.players.you.gave === s.id && S.t - S.st[s.id].gaveAt < 1.5;
    if (pick == null && !h && on == null && (gives?.length > 1 || s.t === 'ou_plating')) { this.openPicker(s); return; }   // (empty-handed at a dispenser: choose; one thing: straight into hand)
    const pour = S.K.stations[s.t]?.role === 'pour' ? S.K.stations[s.t] : null;
    if (pick == null && pour && h && h.st === S.K.ware[h.k]?.clean && !h.on && choices(S, s.id, 'you').length > 1) { this.openPicker(s); return; }   // (a glass held to the wine fridge: which wine)
    const r = interact(S, 'you', s.id, { pick });
    if (this.run) this.run.log.push(typeof pick === 'string' ? [this.n, 'E', s.id, pick] : [this.n, 'E', s.id]);   // (what the server plays again)
    if (r) this.sound(r, s, h, on, swap && pick == null);
  }
  // ---- the picker: a card for each thing a dispenser gives, its picture, its key
  openPicker(s) {
    const opts = choices(this.S, s.id, 'you'); if (!opts.some(o => o.left > 0)) { this.banner('None left: wash some at the sink', 1500); return; }
    const want = this.step?.t === s.t ? this.step.pick : null, i = Math.max(0, opts.findIndex(o => o.k === want && o.left > 0), opts.findIndex(o => o.left > 0));
    this.picker = { s, opts, i };
    const el = this.E.picker; el.innerHTML = '';
    opts.forEach((o, n) => {
      const c = document.createElement('button'); c.type = 'button'; c.className = 'ou-pick';
      const fin = Number.isFinite(o.left);   // (plates, cups, glasses: how many are left, big on the picture; none: greyed, wash some)
      c.innerHTML = `<img alt="" src="${thumb(o.k)}"><b>${esc(pickName(o.k))}</b><kbd>${n + 1}</kbd>${fin ? `<span class="ou-count${o.left <= 1 ? ' low' : ''}">×${o.left}</span>` : ''}${fin && !o.left ? '<small>Wash some</small>' : ''}`;
      if (fin && !o.left) c.classList.add('none');
      c.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (o.left > 0) this.choose(n); });
      el.appendChild(c);
    });
    el.classList.add('on'); this.drawPicker(); this.sfx('ou-swap', this.topOf(s), { gain: 0.5 });
  }
  drawPicker() {
    const pk = this.picker; if (!pk) return;
    [...this.E.picker.children].forEach((c, n) => c.classList.toggle('sel', n === pk.i));
    const p = this.topOf(pk.s, 0.9), v = new THREE.Vector3(p.x, p.y, p.z).project(app.stage.camera);
    const half = (this.E.picker.offsetWidth || 300) / 2 + 12; this.E.picker.style.left = `${Math.max(half, Math.min(innerWidth - half, (v.x + 1) / 2 * innerWidth))}px`; this.E.picker.style.top = `${Math.max(220, (1 - v.y) / 2 * innerHeight)}px`;   // (on screen, below the top bar)
  }
  choose(n) { const pk = this.picker; if (!pk || !(pk.opts[n]?.left > 0)) return; const k = pk.opts[n].k; this.closePicker(); this.press(k); }
  closePicker() { this.picker = null; this.E.picker.classList.remove('on'); this.E.picker.innerHTML = ''; }
  /** The picker's own API (a test cook, a phone): the item of kind k from the open picker. */
  pickItem(k) { const n = this.picker?.opts.findIndex(o => o.k === k) ?? -1; if (n >= 0) this.choose(n); return n >= 0; }
  /** One-shots for what E did at station s (h: what was in hand, on: what was on it). */
  sound(r, s, h, on, swap) {
    const S = this.S, now = S.items[S.players.you.hold] || S.items[S.st[s.id].slot], p = this.topOf(s);
    const drink = it => !!it && it.k !== 'plate' && !!S.K.ware[it.k];   // (a cup or any glass)
    const of = it => !it ? null : drink(it) || it.k === 'berries' && it.st !== 'whole' ? 'ou-put-cup' : it.k === 'plate' ? 'ou-put-plate' : it.k === 'milk' || it.k === 'grounds' || it.k === 'shaker' ? 'ou-put-metal' : 'ou-put-food';
    const door = { ou_oven: 'ou-oven-door', ou_press: 'ou-press-lid' }[s.t];
    if (r === 'give') this.sfx(swap ? 'ou-swap' : { ou_fridge: 'ou-fridge', ou_pantry: 'ou-pantry', ou_plating: 'ou-plates-take' }[s.t] || 'ou-put-food', p);
    else if (r === 'take') { if (door) this.sfx(door, p); this.sfx(drink(on) ? 'ou-take-cup' : on?.k === 'plate' ? 'ou-plates-take' : of(on), p, { gain: 0.8 }); }
    else if (r === 'put') {
      if (door) this.sfx(door, p);
      this.sfx({ ou_fryer: 'ou-basket', ou_grill: 'ou-patty', ou_pizza_oven: 'ou-peel', ou_wok: 'ou-patty', ou_popcorn: 'ou-kernels', ou_tandoor: 'ou-patty' }[s.t] || (s.t === 'ou_stove' && h?.k === 'pasta' ? 'ou-pot' : s.t === 'ou_sink' ? 'ou-put-plate' : of(h)), p);   // (fries into the oil, a patty on the grill, a pizza slid in, pasta into the water)
    }
    else if (r === 'mix') this.sfx(now?.k === 'coupe' ? 'ou-pour-cocktail' : now?.k === 'bowl' && (now.on === 'soup' || now.on === 'curry') ? 'ou-ladle' : now?.k === 'cup' ? 'ou-pour-milk' : now?.k === 'glass' ? 'ou-pour-smoothie' : now?.k === 'plate' ? 'ou-plate-food' : 'ou-put-food', p);
    else if (r === 'pour') this.sfx({ ou_rice: 'ou-rice', ou_freezer: 'ou-scoop' }[s.t] || (now?.st === 'bubbly' ? 'ou-pour-fizz' : 'ou-pour-wine'), p);   // (rice scooped, ice cream scooped, a wine poured)
    else if (r === 'load') this.sfx(s.t === 'ou_espresso' ? 'ou-load' : 'ou-put-food', p);   // (the portafilter's clunk; an orange into the juicer's hopper)
    else if (r === 'bin') this.sfx('ou-bin', p);
    else if (r === 'serve') this.sfx('ou-bell', p);
  }
  /** A sound in the kitchen (pos: where, null: the kitchen's own, as a game's sounds are). */
  sfx(name, pos = null, o = {}) { if (!name) return null; this.heard.add(name); return app.sfx?.play?.(name, { pos, space: this.space, kind: 'effects', ...o }) ?? null; }
  /** The loops that should sound now: the machines cooking, your hands working, the room; started and stopped as wanted. */
  loopSounds() {
    const S = this.S, want = new Map(), me = this.me, face = me.working ? this.facing() : null;
    if (!S.over) want.set('room', ['ou-kitchen-1', this.center(), 0.4]);
    for (const s of this.st) {
      const st = S.st[s.id], a = AUTO[s.t]; if (!a || st.slot == null || S.over) continue;
      const brewing = a.loaded ? (st.loaded || st.prog > 0) && st.prog < a.cook : a.k === 'cup' || a.k === 'glass' ? st.prog < a.cook : true;   // (a cup or glass: only while it fills)
      const name = { ou_espresso: 'ou-brew-1', ou_steamer: 'ou-steam-1', ou_blender: 'ou-blend-1', ou_press: 'ou-press-1', ou_oven: 'ou-oven-1', ou_fryer: 'ou-fry-1', ou_grill: 'ou-grill-1',
        ou_griddle: 'ou-griddle-1', ou_toaster: 'ou-toast-1', ou_kettle: 'ou-boil-1', ou_juicer: 'ou-juice-1', ou_soda: 'ou-fill-1', ou_taps: 'ou-tap-1',
        ou_pizza_oven: 'ou-fire-1', ou_stove: 'ou-simmer-1', ou_popcorn: 'ou-pop-1', ou_tandoor: 'ou-fire-1', ou_bamboo: 'ou-bamboo-1' }[s.t];   // (the wok: while it is tossed, below)
      if (name && brewing) want.set(s.id, [name, this.topOf(s, 0.1), s.t === 'ou_oven' ? 0.55 : s.t === 'ou_espresso' ? 1.4 : 0.85]);
    }
    if (face) { const name = { ou_grinder: 'ou-grind-1', ou_prep: 'ou-chop-1', ou_sink: 'ou-wash-1', ou_cocktail: 'ou-shake-1', ou_wok: 'ou-wok-1' }[face.t]; if (name) want.set('work', [name, this.topOf(face, 0.1), 0.9]); }
    for (const [k, l] of this.loops) if (!want.has(k) || want.get(k)[0] !== l.name) { l.h?.stop?.(0.25); this.loops.delete(k); }
    for (const [k, [name, pos, gain]] of want) if (!this.loops.has(k)) { this.heard.add(name); this.loops.set(k, { name, h: app.sfx?.loop?.(name, { pos, space: this.space, kind: 'effects', gain }) }); }
  }
  center() { const R0 = this.room, w = this.world((R0.u0 + R0.u1) / 2, (R0.v0 + R0.v1) / 2); return { x: w.x, y: this.o.y + 1.2, z: w.z }; }
  banner(text, ms) { const b = this.E.banner; b.textContent = text; b.classList.add('on'); clearTimeout(this.bT); this.bT = setTimeout(() => b.classList.remove('on'), ms); }

  move(dt) {
    let du = (this.keys.has('Right') ? 1 : 0) - (this.keys.has('Left') ? 1 : 0) + this.stick.u, dv = (this.keys.has('Down') ? 1 : 0) - (this.keys.has('Up') ? 1 : 0) + this.stick.v;
    const m = Math.hypot(du, dv), me = this.me;
    if (m < 0.08) { me.speed = 0; return; }
    du /= Math.max(1, m); dv /= Math.max(1, m);
    me.fu = du / Math.hypot(du, dv); me.fv = dv / Math.hypot(du, dv);
    const sp = SPEED * Math.min(1, m), R0 = this.room;
    let u = me.u + du * sp * dt, v = me.v + dv * sp * dt;
    for (const s of this.st) {   // (pushed out of the stations: you slide along them)
      const b = s.box; if (!b.block) continue;
      const cu = Math.max(b.u0, Math.min(u, b.u1)), cv = Math.max(b.v0, Math.min(v, b.v1)), d = Math.hypot(u - cu, v - cv);
      if (d < R) { if (d > 1e-6) { u = cu + (u - cu) / d * R; v = cv + (v - cv) / d * R; } else { v = b.v1 + R; } }
    }
    u = Math.max(R0.u0 + R, Math.min(R0.u1 - R, u)); v = Math.max(R0.v0 + R, Math.min(R0.v1 - R, v));
    me.dist += Math.hypot(u - me.u, v - me.v); me.speed = sp; me.u = u; me.v = v;
  }
  tick(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const run = !this.paused && !this.S.over && now >= this.startAt;
    if (!this.paused && !this.S.over) this.move(dt);
    const face = this.facing();
    if (this.picker && (face?.id !== this.picker.s.id || this.S.over)) this.closePicker(); else if (this.picker) this.drawPicker();
    let working = false;
    if (run) {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        if (this.keys.has('Work') && face && WORK[face.t]) {
          working = work(this.S, 'you', face.id, STEP) || working;
          if (this.run) { const f = this.run.f; if (f && f[2] === face.id && f[0] + f[3] === this.n) f[3]++; else this.run.log.push(this.run.f = [this.n, 'F', face.id, 1]); }   // (held: a run of beats)
        }
        step(this.S, STEP); this.n++;
      }
      this.events();
      if (this.S.over) this.end();
    }
    this.me.working = working || (this.keys.has('Work') && face && WORK[face.t] && this.me.working);
    itemLight(GU.uNight.value);   // (the dishes lit as the room is, not as the night outside)
    this.drawChef(now); this.drawItems(); this.drawFace(face); this.hud(face, now);
    this.smoke(dt); this.loopSounds(); this.cues(now);
  }
  events() {
    const fx = app.kitchenFx;
    for (const ev of this.S.ev.splice(0)) {
      const s = ev.s != null ? this.byId.get(ev.s) : null, p = s ? this.topOf(s, 0.15) : null;
      const snd = { cooked: 'ou-ding', burnt: 'ou-burnt', ground: 'ou-grind-done', washed: 'ou-rack', ticket: 'ou-ticket', lost: 'ou-lost', nobody: 'ou-bad', over: 'ou-end' }[ev.k];
      if (snd) this.sfx(snd, ev.k === 'ticket' || ev.k === 'lost' || ev.k === 'over' || ev.k === 'nobody' ? null : p, { gain: ev.k === 'nobody' ? 0.6 : 1 });
      if (ev.k === 'served') {
        const g = ev.grade, chime = g === 'Supreme' ? 'ou-supreme' : g === 'Great' || g === 'Good' ? 'ou-good' : g === 'Bad' || g === 'Poor' ? 'ou-bad' : null;
        setTimeout(() => chime && this.sfx(chime), 260); if (ev.tip > 0) setTimeout(() => this.sfx('ou-coins', p), 620);
      }
      if (ev.k === 'cooked' && p) fx?.burst('steam', p.x, p.y, p.z, 8, { spread: 0.15 });
      if (ev.k === 'burnt' && p) { fx?.burst('smoke', p.x, p.y, p.z, 14, { spread: 0.2 }); this.pop('Burnt!', p, 'bad'); }
      if (ev.k === 'chopped' && p) fx?.burst('fleck', p.x, p.y, p.z, 14, { spread: 0.1 });
      if (ev.k === 'ground' && p) fx?.burst('fleck', p.x, p.y, p.z, 6, { spread: 0.06 });
      if (ev.k === 'washed' && p) fx?.burst('foam', p.x, p.y + 0.1, p.z, 10, { spread: 0.12 });
      if (ev.k === 'art' && p) this.pop('Latte art!', p, 'good');
      if (ev.k === 'served' && p) {
        this.pop(`${ev.grade} ${ev.score}${ev.tip ? ` · +$${ev.tip.toFixed(2)}` : ''}`, p, ev.grade === 'Supreme' || ev.grade === 'Great' ? 'good' : ev.grade === 'Poor' || ev.grade === 'Bad' ? 'bad' : '');
        if (ev.grade === 'Supreme') fx?.burst('sparkle', p.x, p.y + 0.2, p.z, 26, { spread: 0.4 });
      }
      if (ev.k === 'lost') this.banner(`A ${this.S.K.dishes[ev.dish].name} order walked out`, 1600);
      if (ev.k === 'nobody') this.banner(`Nobody ordered a ${this.S.K.dishes[ev.dish].name}`, 1300);
    }
  }
  /** The start bell, the last ten seconds, warnings as a station goes over, the chef's steps. */
  cues(now) {
    const S = this.S;
    if (!this.started && now >= this.startAt) { this.started = true; this.sfx('ou-start'); }
    const left = Math.ceil(S.dur - S.t);
    if (!S.over && this.started && left <= 10 && left < this.tickAt) { this.tickAt = left; if (left > 0) this.sfx('ou-tick', null, { gain: 0.9 }); }
    for (const s of this.st) {
      const v = AUTO[s.t] && stationView(S, s.id), w = this.warnAt.get(s.id) ?? -1;
      if (v?.over > 0 && !v.burnt && !S.over) { if (S.t - w > 3) { this.warnAt.set(s.id, S.t); this.sfx('ou-warn', this.topOf(s), { gain: 0.6 }); } }
      else if (!v?.over) this.warnAt.delete(s.id);
    }
    if (this.me.dist - this.stepAt > 0.68) { this.stepAt = this.me.dist; const w = this.world(this.me.u, this.me.v); this.sfx('step-walk-tile', { x: w.x, y: this.o.y, z: w.z }, { gain: 0.55 }); }
  }
  topOf(s, up = 0, k = null) {
    const t = (k && TOP_K[s.t]?.[k]) || (s.t === 'ou_stove' && k && !IN_WATER.has(k) ? TOP_K.ou_stove.soup : null) || TOP[s.t] || [0, 0.95, 0], c = Math.cos(s.e.yaw), sn = Math.sin(s.e.yaw);
    return { x: s.e.x + t[0] * c + t[2] * sn, y: s.e.y + t[1] + up, z: s.e.z - t[0] * sn + t[2] * c, yaw: s.e.yaw };
  }
  smoke(dt) {
    this.smokeT -= dt; if (this.smokeT > 0) return; this.smokeT = 0.3;
    for (const s of this.st) { const v = AUTO[s.t] && stationView(this.S, s.id); if (v?.burnt) { const p = this.topOf(s, 0.2); app.kitchenFx?.burst('smoke', p.x, p.y, p.z, 2, { spread: 0.15 }); } }
  }
  drawChef(now) {
    const me = this.me, w = this.world(me.u, me.v), X = this.extra, held = this.S.players.you.hold != null;
    const fw = this.world(me.u + me.fu, me.v + me.fv);
    X.x = w.x; X.z = w.z; X.y = this.o.y; X.yaw = Math.atan2(fw.x - w.x, fw.z - w.z);
    let clip;
    if (me.working) clip = this.facing()?.t === 'ou_sink' ? CLIP.wash : CLIP.cook;
    else if (me.speed > 0.2) clip = held && CLIP.walk_hold !== undefined ? CLIP.walk_hold : CLIP.walk;
    else clip = held && CLIP.idle_hold !== undefined ? CLIP.idle_hold : CLIP.idle;
    const stride = CLIP_STRIDE[clip], t = now / 1000;
    X.pclip = X.clip; X.pph = X.ph; X.clip = clip;
    X.ph = stride > 0 && me.speed > 0.2 ? (me.dist / stride) % 1 : (t / Math.max(0.3, CLIP_DUR[clip])) % 1;
  }
  drawItems() {
    const want = new Map(), S = this.S;
    const put = (key, it, p, yaw) => want.set(key, { it, p, yaw });
    for (const s of this.st) {
      const st = S.st[s.id];
      if (st.slot != null) put(st.slot, S.items[st.slot], this.topOf(s, 0, S.items[st.slot]?.k), s.e.yaw);
      if (s.t === 'ou_espresso' && st.loaded) { const c = Math.cos(s.e.yaw), sn = Math.sin(s.e.yaw); put(`L${s.id}`, { k: 'grounds', st: 'fresh' }, { x: s.e.x + 0.25 * c + 0.16 * sn, y: s.e.y + 0.955, z: s.e.z - 0.25 * sn + 0.16 * c }, s.e.yaw); }   // (loaded: the portafilter ready on the tray)
      (st.dirty || []).slice(0, 3).forEach((id, k) => { const p = this.topOf(s, k * 0.04); put(id, S.items[id], p, s.e.yaw); });
      (st.sink || []).forEach((id, k) => { const p = this.topOf(s, k * 0.03); put(id, S.items[id], p, s.e.yaw); });
    }
    const h = S.players.you.hold;
    if (h != null && S.items[h]) { const me = this.me, w = this.world(me.u + me.fu * 0.36, me.v + me.fv * 0.36); put(h, S.items[h], { x: w.x, y: this.o.y + 0.98, z: w.z }, this.extra.yaw); }
    for (const [key, m] of this.meshes) if (!want.has(key)) { this.group.remove(m.g); this.meshes.delete(key); }
    for (const [key, { it, p, yaw }] of want) {
      if (!it) continue;
      let m = this.meshes.get(key); const lk = lookKey(it);
      if (!m || m.lk !== lk) { if (m) this.group.remove(m.g); m = { g: itemMesh(it), lk }; this.group.add(m.g); this.meshes.set(key, m); }
      m.g.position.set(p.x, p.y, p.z); m.g.rotation.y = yaw;
    }
  }
  /** The coach's arrow, bobbing over the station of the next step. */
  drawMarker(now) {
    const g = this.step, s = g?.t ? this.st.find(x => x.t === g.t) : null, m = this.marker;
    m.visible = !!s && this.coach;
    if (!m.visible) return;
    const b = s.box, w = this.world((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2), h = Math.min(2.0, CATALOG[s.t].h);
    m.position.set(w.x, this.o.y + h + 0.45 + Math.sin(now / 160) * 0.08, w.z); m.rotation.y = now / 600;
  }
  drawFace(s) {
    const o = this.outline; o.visible = !!s && !this.S.over;
    if (!s) return;
    const b = s.box, cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2, w = this.world(cu, cv), h = Math.min(1.25, CATALOG[s.t].h);
    o.position.set(w.x, this.o.y + h / 2, w.z); o.rotation.y = this.yaw0; o.scale.set(b.u1 - b.u0 + 0.06, h + 0.04, b.v1 - b.v0 + 0.06);
  }
  pop(text, p, cls = '') {
    const el = document.createElement('div'); el.className = `ou-pop ${cls}`; el.textContent = text;
    this.E.pops.appendChild(el); const at = new THREE.Vector3(p.x, p.y + 0.5, p.z), t0 = performance.now();
    const place = () => { if (!el.isConnected) return; const k = (performance.now() - t0) / 1400; if (k >= 1) { el.remove(); return; }
      const v = at.clone().project(app.stage.camera); el.style.left = `${(v.x + 1) / 2 * innerWidth}px`; el.style.top = `${(1 - v.y) / 2 * innerHeight - k * 50}px`; el.style.opacity = String(1 - k * k); requestAnimationFrame(place); };
    place();
  }
  hud(face, now) {
    const S = this.S, E = this.E, left = Math.max(0, S.dur - S.t);
    E.time.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`; E.time.classList.toggle('low', left < 30);
    E.money.textContent = `$${(S.money + S.tips).toFixed(2)}`; E.pts.textContent = `${S.points} pts`;
    // the tickets
    const live = new Set(S.tickets.map(t => t.id));
    for (const [id, el] of this.ticketEls) if (!live.has(id)) { el.remove(); this.ticketEls.delete(id); }
    for (const t of S.tickets) {
      let el = this.ticketEls.get(t.id);
      if (!el) { const d = S.K.dishes[t.dish], name = (t.item && t.item !== t.dish && FOOD_BY_ID[t.item]?.name) || d.name;   // (the menu item asked for: a cappuccino, a mojito)
        el = document.createElement('div'); el.className = 'ou-ticket'; el.innerHTML = `<span class="ou-ti">${d.icon}</span><b>${esc(name)}</b><small>${(RECIPES[t.dish] || []).map(esc).join(' › ')}</small><i><u></u></i>`; E.tickets.appendChild(el); this.ticketEls.set(t.id, el); }
      const k = Math.max(0, (t.until - S.t) / (t.until - t.at)); const u = el.querySelector('u'); u.style.width = `${k * 100}%`; el.classList.toggle('late', k < 0.3);
    }
    const fk = focusTicket(this.S)?.id; for (const [id, el] of this.ticketEls) el.classList.toggle('focus', this.coach && id === fk);
    // what is left on the plating counter, over it (red when out)
    const pl = this.st.find(x => x.t === 'ou_plating');
    if (pl) {
      const left = choices(S, pl.id), key = left.map(o => o.left).join('/');   // (the kinds this Rush uses: a café's plates, cups and glasses, a bar's glasses)
      if (!this.stockEl) { this.stockEl = document.createElement('div'); this.stockEl.className = 'ou-stock'; E.bars.appendChild(this.stockEl); }
      if (this.stockEl.dataset.k !== key) { this.stockEl.dataset.k = key; this.stockEl.innerHTML = left.map(({ k, left: n }) => `<span class="${n === 0 ? 'out' : n <= 1 ? 'low' : ''}"><img alt="${esc(pickName(k))}" src="${thumb(k)}">×${n}</span>`).join(''); }
      const p = this.topOf(pl, 0.75), pr = new THREE.Vector3(p.x, p.y, p.z).project(app.stage.camera);
      this.stockEl.style.left = `${(pr.x + 1) / 2 * innerWidth}px`; this.stockEl.style.top = `${(1 - pr.y) / 2 * innerHeight}px`; this.stockEl.style.display = this.picker?.s === pl ? 'none' : '';   // (the picker over it shows the same)
    }
    // the bars over the stations cooking or being worked
    for (const s of this.st) {
      const v = stationView(S, s.id); let el = this.barEls.get(s.id);
      if (!v) { if (el) el.style.display = 'none'; continue; }
      if (!el) { el = document.createElement('div'); el.className = 'ou-bar'; el.innerHTML = '<i></i><b>!</b>'; E.bars.appendChild(el); this.barEls.set(s.id, el); }
      const p = this.topOf(s, 0.55), pr = new THREE.Vector3(p.x, p.y, p.z).project(app.stage.camera);
      el.style.display = ''; el.style.left = `${(pr.x + 1) / 2 * innerWidth}px`; el.style.top = `${(1 - pr.y) / 2 * innerHeight}px`;
      el.firstChild.style.width = `${(v.over ? v.over : v.cook) * 100}%`; el.classList.toggle('over', v.over > 0); el.classList.toggle('done', v.cook >= 1 && !v.over); el.classList.toggle('burnt', v.burnt);
    }
    // what E and F do here
    if (now - seen > 120) {
      seen = now; E.hint.textContent = face ? this.hintFor(face) : (now < this.startAt ? 'Get ready…' : 'Walk up to a station');
      const g = this.coach && !S.over && now >= this.startAt ? nextStep(S) : null; this.step = g;
      E.next.classList.toggle('on', !!g);
      if (g) { const touch = matchMedia('(pointer: coarse)').matches; E.nextKey.textContent = g.act === 'wait' ? '⏳' : g.act === 'F' ? (touch ? 'Hold Work' : 'Hold F') : (touch ? 'Grab' : 'E'); E.nextText.textContent = g.text; E.next.classList.toggle('here', !!g.t && face?.t === g.t); }
    }
    this.drawMarker(now);
  }
  hintFor(s) {
    const S = this.S, K = S.K, st = S.st[s.id], h = S.items[S.players.you.hold], on = S.items[st.slot], nm = it => itemName(it, K), kind = k => K.say?.[k] || k;
    const name = CATALOG[s.t].name, a = AUTO[s.t] && K.stations[s.t], w = WORK[s.t] && K.stations[s.t], gives = givesAt(S, s.id), dish = it => dishOf(it, K);
    // what a machine takes: a cup or a glass under it (its oranges or grounds loaded first), else the thing it cooks
    const takes = () => (K.ware[a.k] ? `${a.loaded ? `${kind(a.loaded)}, then ` : ''}a ${a.k} under it` : `the ${[].concat(a.k).map(kind).join(' or the ')} in`);
    if (s.t === 'ou_bin') return h ? `E: throw the ${nm(h)} away` : name;
    if (s.t === 'ou_pass') return h ? (dish(h) ? `E: serve the ${K.dishes[dish(h)].name}` : `The pass takes finished dishes`) : 'The pass: serve finished dishes here';
    if (!h) {
      if (on) return `E: take the ${nm(on)}${w?.role === 'chop' && chopsOf(w).includes(on.k) && on.st === w.from ? ' · hold F: chop it' : w?.tend && on.st === w.from ? ' · hold F: toss it' : ''}`;
      if (s.t === 'ou_grinder') return 'Hold F: grind coffee';
      if (s.t === 'ou_cocktail') return 'Hold F: shake a cocktail';
      if (s.t === 'ou_sink') return st.sink.length ? 'Hold F: wash up' : 'Bring dirty plates, cups and glasses here';
      if (s.t === 'ou_dishes') return st.dirty?.length ? 'E: take a dirty one to the sink' : 'Dirty plates, cups and glasses come back here';
      if (gives) return `E: take ${gives.map(kind).join(' / ')} (E again to swap)`;
      if (s.t === 'ou_plating') { const n = o => `${o.left} ${kind(o.k)}${o.left === 1 ? '' : /ss$/.test(kind(o.k)) ? 'es' : 's'}`; return `E: take ${choices(S, s.id).map(o => `a ${kind(o.k)}`).join(', ').replace(/, ([^,]*)$/, ' or $1')} (${choices(S, s.id).map(n).join(', ')} left)`; }
      if (K.stations[s.t]?.role === 'pour') return `${name}: hold a ${kind(K.stations[s.t].into)} to it, E pours ${gives.map(kind).join(' / ')}`;
      if (a) return `${name}: put ${takes()}`;
      return name;
    }
    if (a && (a.loaded === h.k || (a.loads?.[h.k] && h.st === K.fresh[h.k]))) return st.loaded ? 'Already loaded' : `E: load the ${nm(h)}`;
    const P = K.stations[s.t]; if (P?.role === 'pour' && P.mix?.[h.k] && h.st === K.fresh[h.k]) return `E: a scoop of ice cream into the ${nm(h)}`;
    if (K.stations[s.t]?.role === 'pour') { const can = h.st === K.ware[h.k]?.clean && !h.on ? choices(S, s.id, 'you') : []; return can.length ? `E: ${K.stations[s.t].food ? 'scoop' : 'pour'} ${can.map(o => kind(o.k)).join(' / ')}` : `${name} serves into a clean ${[...new Set(gives.flatMap(g => [].concat(typeof K.stations[s.t].into === 'object' && !Array.isArray(K.stations[s.t].into) ? K.stations[s.t].into[g] : K.stations[s.t].into)))].map(kind).join(' or ')}`; }
    if (on) return `E: put the ${nm(h)} with the ${nm(on)}`;
    if (a) return takesItem(a, h) ? `E: put the ${nm(h)} ${K.ware[h.k] || K.ware[a.k] ? 'under it' : 'in'}` : `${name} takes ${K.ware[a.k] ? `an empty ${a.k}` : `the ${[...new Set([...[].concat(a.k), ...(a.cooks || []).flatMap(e => [].concat(e.k)).filter(k => S.uses?.includes(k))])].map(kind).join(' or the ')}`}`;   // (what this Rush's menu puts in it)
    if (s.t === 'ou_sink') return h.st === 'dirty' ? 'E: put it in the sink' : name;
    const ware = s.t === 'ou_plating' && plateFor(S, st, h); if (ware) return `E: the ${nm(h)} ${ware === 'bowl' ? 'into a bowl' : 'onto a plate'}`;
    const iw = s.t === 'ou_plating' && intoWare(S, st, h); if (iw) return `E: the ${nm(h)} into a ${kind(iw.w)}`;
    return `E: put the ${nm(h)} down`;
  }
  end() {
    if (this.ended) return; this.ended = true;
    if (this.run) { this.report(); return; }
    const S = this.S, stars = starsOf(S), by = {};
    for (const x of S.served) by[x.grade] = (by[x.grade] || 0) + 1;
    const grades = ['Supreme', 'Great', 'Good', 'Medium', 'Bad', 'Poor'].filter(g => by[g]).map(g => `<span class="g-${g.toLowerCase()}">${g} ×${by[g]}</span>`).join('');
    this.E.menu.classList.remove('hidden');
    this.E.menu.innerHTML = `<div class="ou-card"><h3>Rush over</h3><div class="ou-stars">${STAR(stars)}</div>
      <p><b>${S.served.length}</b> served · <b>${S.lost}</b> walked out · <b>$${S.money.toFixed(2)}</b> + <b>$${S.tips.toFixed(2)}</b> tips · ${S.points} pts</p>
      <div class="ou-grades">${grades || '<span>Nothing served</span>'}</div>
      <button type="button" class="ou-big ou-again">Again</button><button type="button" class="ou-big ou-quit">Leave the kitchen</button></div>`;
    this.E.menu.querySelector('.ou-again').addEventListener('click', () => { close(); start(app.inter?.foc?.entries); });
    this.E.menu.querySelector('.ou-quit').addEventListener('click', () => close());
  }
  /** A Rush that counted: the server plays it again and records it; the card is the shift report (how it went, then what it
   *  earned: experience, the Order Up level, rank, badges, new dishes in the Cookbook, a new best and its place, the prize). */
  async report() {
    const S = this.S, run = this.run, stars = starsOf(S), by = {};
    this.run = null;
    for (const x of S.served) by[x.grade] = (by[x.grade] || 0) + 1;
    const grades = ['Supreme', 'Great', 'Good', 'Medium', 'Bad', 'Poor'].filter(g => by[g]).map(g => `<span class="g-${g.toLowerCase()}">${g} ×${by[g]}</span>`).join('');
    this.E.menu.classList.remove('hidden');
    this.E.menu.innerHTML = `<div class="ou-card ou-report"><h3>${esc(run.course.label)}: shift report</h3><div class="ou-stars">${STAR(stars)}</div>
      <p><b>${S.served.length}</b> served · <b>${S.lost}</b> walked out · <b>${S.burns || 0}</b> burnt · <b>$${S.money.toFixed(2)}</b> + <b>$${S.tips.toFixed(2)}</b> tips</p>
      <div class="ou-grades">${grades || '<span>Nothing served</span>'}</div>
      <div class="ou-result"><span class="dim">Checking the Rush…</span></div>
      <button type="button" class="ou-big ou-again">Again</button><button type="button" class="ou-big ou-quit">Leave the kitchen</button></div>`;
    this.E.menu.querySelector('.ou-again').addEventListener('click', () => { close(); start(app.inter?.foc?.entries); });
    this.E.menu.querySelector('.ou-quit').addEventListener('click', () => close());
    let res; try { res = await post('/api/play/finish', { run: run.id, report: { log: run.log, score: S.score } }); } catch (e) { res = { ok: false, why: e.message }; }
    const box = this.E.menu.querySelector('.ou-result'); if (!box?.isConnected) return;
    if (!res?.ok) { box.innerHTML = `<span class="ou-bad">This Rush did not count: ${esc(res?.why || 'it could not be checked')}</span>`; return; }
    const lv = res.module, pct = Math.round((lv.progress?.pct || 0) * 100), names = ids => ids.map(i => FOOD_BY_ID[i]?.name || i);
    const fresh = res.cookbook?.fresh || [];
    box.innerHTML = `<div class="ou-score"><b>${Number(res.score).toLocaleString('en-US')} pts</b>${res.newBest ? ' <span class="ou-new">New best!</span>' : ''}${res.place ? ` · #${res.place} on ${esc(run.course.label)}` : ''}</div>
      <div class="ou-xp"><span>+${res.xp} XP</span><span>Order Up level <b>${lv.level}</b>${lv.level > lv.was ? ' <span class="ou-new">Level up!</span>' : ''}</span><span class="ou-lvbar"><i style="width:${pct}%"></i></span>${res.player?.rankUp ? `<span class="ou-new">${res.player.rank.icon} ${esc(res.player.rank.name)}!</span>` : ''}</div>
      ${res.badges?.length ? `<div class="ou-badges">${res.badges.map(b => `<span class="ou-badge t-${b.tier}" title="${esc(b.desc)}">${b.icon} ${esc(b.label)}</span>`).join('')}</div>` : ''}
      ${fresh.length ? `<div class="ou-book">📖 New in your Cookbook: ${esc(names(fresh).join(', '))} <span class="dim">(${res.cookbook.count}/${res.cookbook.all})</span></div>` : ''}
      ${res.unlocked?.length ? `<div class="ou-open">🔓 ${esc(res.unlocked.map(id => COURSES.find(c => c.id === id)?.label || id).join(', '))} is open</div>` : ''}
      ${res.vc?.paid ? `<div class="ou-prize">🪙 ${fmtVc(res.vc.paid)}</div>` : ''}`;
  }
  close() {
    if (this.run && !this.S.over) post('/api/play/abandon', { run: this.run.id }).catch(() => {});   // (left in the middle: nothing recorded)
    this.picker = null;
    for (const l of this.loops.values()) l.h?.stop?.(0.3); this.loops.clear();
    removeEventListener('keydown', this.onKey, true); removeEventListener('keyup', this.onKeyUp, true); removeEventListener('resize', this.onResize);
    const k = app.agents.extra.indexOf(this.extra); if (k >= 0) app.agents.extra.splice(k, 1);
    app.stage.scene.remove(this.group); this.root.remove();
    document.body.classList.remove('mp-playing', 'ou-playing');
    app.cam.unpin();
    releaseView('Order Up');
  }
}

/** The floor you look into serves food or drink (Order Up's kitchens go only there, shared/edit.js kitchenFloor). */
const foodHere = () => ST.focus?.b >= 0 && kitchenFloor(bld(ST.focus.b), ST.focus.f, levelOf(ST.focus.b, ST.focus.f));
/** The kitchen on the floor you look into: its interior module's pieces (shared/kitchen-module.js; a client asks the
 *  floor's modules what is played there), else, on a floor laid before kitchens were modules, the floor's own Order Up
 *  pieces. → { ents, kitchen: its template, menu: what its place sells (item ids, as its kitchen was laid for) } or null. */
function kitchenHere(ents) {
  if (!ents?.length || !foodHere()) return null;
  const L = levelOf(ST.focus.b, ST.focus.f), rec = modsAt(L).find(m => m.rec.kind === 'kitchen')?.rec;
  let mine = ents;
  if (rec) { const ids = new Set((L.items || []).filter(it => it.mod === rec.id).map(it => it.id)); mine = ents.filter(e => ids.has(e.id)); }
  return mine.some(e => e.t === 'ou_pass') ? { ents: mine, kitchen: rec?.data?.kitchen || null, menu: rec?.data?.menu || null, ranked: !!rec } : null;
}
function start(ents) {
  const k = game ? null : kitchenHere(ents);
  if (!k) return;
  game = new Practice(k.ents, k.kitchen, k.menu, k.ranked); game.open();
  holdView('Order Up', 'To leave the kitchen: Esc, then Leave the kitchen');   // (the view stays on the kitchen until you leave: core/state.js holdView)
  btn?.classList.add('hidden');
}
function close() { if (!game) return; game.close(); game = null; }

function frame() {
  if (game) { game.tick(performance.now()); return; }
  const now = performance.now(); if (now - seen < 500) return; seen = now;
  const ents = ST.focus?.b >= 0 ? app.inter?.foc?.entries : null, ok = !!kitchenHere(ents) && !app.machinePlay?.active && !app.arcade?.playing;
  btn.classList.toggle('hidden', !ok);
}

export function init(a) {
  app = a;
  btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ou-start hidden'; btn.innerHTML = '🍳 <b>Order Up</b> · practice';
  btn.title = 'Play a practice Rush in this café\'s kitchen';
  btn.addEventListener('click', () => start(app.inter?.foc?.entries));
  document.body.appendChild(btn);
  bus.on('frame', frame);
  app.orderUp = { start: () => start(app.inter?.foc?.entries), close, get game() { return game; } };
}
