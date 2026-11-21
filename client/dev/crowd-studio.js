// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Crowd Studio (2026-11-19, the product owner: "create like a character studio for the animations, skeletal rig and
// clothing so that I can manually make adjustments … and see what works and what doesn't"): a resident of the crowd drawn
// by the city's own renderer (render/characters.js, its crowd of builder parts), dressed in any of the library's parts,
// playing any clip, at any level of detail; the crowd's tuning (shared/crowd-tuning.js) changed and shown at once — the
// parts the crowd wears, each garment's push out, the skin tucked under clothes, each body's posture — and saved for the
// city (server/crowd-tuning-routes.js; saving needs the right to edit the world).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Characters, studioTuning } from '/js/render/characters.js';
import { TRIPO_CLIPS, T } from '/js/render/charClips.js';
import { editorKit, editorModel, setDetail, detailFor, crowdTris } from '/dev/crowd-studio-detail.js';
import { sanitizeAppearance, SKIN, HAIR_COLORS, TOP_COLORS, BOTTOM_COLORS, SHOE_COLORS, EYE_COLORS } from '/shared/appearance.js';
import { normalizeTuning, RIG_GROUPS, RIG_AXES, RIG_LIMIT, PUSH_MAX, TUCK_MAX, FACE, BAKE_LEVELS, partOn, pushOf } from '/shared/crowd-tuning.js';
import { makeSkeleton, boneLabel, boneGroups, AXES, mirrorOf, mirrored, BONE_LIMIT } from '/dev/crowd-studio-skeleton.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const clone = o => JSON.parse(JSON.stringify(o));
const FPS = 30;
const CATS = { head: 'Face', hair: 'Hair', beard: 'Beard', top: 'Top', bottom: 'Bottoms', shoes: 'Shoes' };
const FIT_CATS = ['top', 'bottom', 'shoes', 'hair', 'beard'];
const LINEUP = [-2.2, -1.1, 1.1, 2.2];

// ------------------------------------------------------------------ what the server keeps, and who may change it
let csrf = null, canSave = false;
async function me() {
  try { const r = await (await fetch('/api/auth/me', { credentials: 'same-origin' })).json(); csrf = r.csrf || null; canSave = !!(r.caps && r.caps['world.edit']); }
  catch { canSave = false; }
}
const fetchTuning = () => fetch('/api/crowd/tuning', { credentials: 'same-origin', cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
let savedDoc = await fetchTuning();
let saved = normalizeTuning(savedDoc), tun = clone(saved);
await me();
studioTuning(tun);   // (before any character loads: the renderer keeps each animation as baked, to turn it again)

// the library's manifests (the same files the renderer reads: cached once)
const ver = await fetch('/assets/crowd/version.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).then(j => j.v || '').catch(() => '');
const MAN = {};
for (const [s, n] of [['f', 'female'], ['m', 'male']]) MAN[s] = await fetch(`/assets/crowd/${n}.json${ver ? `?v=${ver}` : ''}`).then(r => r.json());

// ------------------------------------------------------------------ the scene
const view = $('view');
const R = new THREE.WebGLRenderer({ antialias: true }); R.setPixelRatio(Math.min(2, devicePixelRatio));
R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping;
view.appendChild(R.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa5b1);
scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x5a5f6a, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2.2, 3.5, 3); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-3, 2, -2.5); scene.add(fill);
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb4bcc4, roughness: 0.95 }));
scene.add(floor);
const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
const orbit = new OrbitControls(cam, R.domElement); orbit.enableDamping = true; orbit.target.set(0, 0.9, 0);
const C = new Characters({ capacity: 16, lods: [0, 1, 2], shadows: false, warmAll: false, crowd: true });
scene.add(C.group);
// the skeleton over the resident (dev/crowd-studio-skeleton.js): shown, a joint clicked to turn it
const skel = makeSkeleton({ C, getState: () => state, cam, canvas: R.domElement });
scene.add(skel.group);
// the rings on the picked joint (Turn with the mouse): dragged, they turn its bone — the same values as its sliders
const handle = new THREE.Object3D(); scene.add(handle);
const rings = new TransformControls(cam, R.domElement); rings.setMode('rotate'); rings.setSpace('local'); rings.setSize(0.75);
scene.add(rings.getHelper());
function resize() { const w = view.clientWidth, h = view.clientHeight; R.setSize(w, h); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ the resident shown
const state = {
  sex: 'm', lod: 0, clip: 'idle', phase: 0, speed: 1, playing: true, lineup: false,
  look: { m: { head: 0, hair: 0, beard: 0, top: 0, bottom: 0, shoes: 0 }, f: { head: 0, hair: 0, beard: -1, top: 0, bottom: 0, shoes: 0 } },
  app: { m: null, f: null }, crowdApps: [],
};
const randApp = sex => sanitizeAppearance({ body: sex === 'f' ? 1 : 0, height: 1, build: 1, skin: pick(SKIN), hair: pick(HAIR_COLORS), top: pick(TOP_COLORS), bottom: pick(BOTTOM_COLORS), shoes: pick(SHOE_COLORS), eyes: pick(EYE_COLORS) });
const parts = (sex, cat) => MAN[sex].parts[cat] || [];
const isDress = (sex, top) => !!parts(sex, 'top')[top]?.dress;
function lookFor(sex) {
  const l = { ...state.look[sex] };
  if (sex === 'f') l.beard = -1;
  if (isDress(sex, l.top)) l.bottom = -1;
  else if (l.bottom < 0) l.bottom = 0;
  return { ...l, feet: 128 };
}
function dress() {
  const s = state.sex;
  state.app[s] ??= randApp(s);
  C.setAppearance(0, state.app[s], true);
  C.crowdLook(0, lookFor(s));
  for (let n = 0; n < LINEUP.length; n++) {
    state.crowdApps[n] = state.crowdApps[n]?.body === (s === 'f' ? 1 : 0) ? state.crowdApps[n] : randApp(s);
    C.setAppearance(1 + n, state.crowdApps[n], true);
  }
}
function randomLook() {
  const s = state.sex, l = state.look[s], on = (cat, i) => partOn(tun, s, cat, parts(s, cat)[i]?.name);
  for (const cat of Object.keys(CATS)) {
    const list = parts(s, cat).map((_, i) => i).filter(i => on(cat, i));
    if (list.length) l[cat] = pick(list);
  }
  if (s === 'm' && Math.random() < 0.45) l.beard = -1;
}

// ------------------------------------------------------------------ drawing
let last = performance.now(), shown = false;
const clipLen = () => { const d = C.kinds[C.kindOf[0]]?.d; return Math.max(1, Math.abs(d?.len?.[T[state.clip] ?? 0] || 30)); };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state.playing) { state.phase = (state.phase + dt * state.speed * FPS / clipLen()) % 1; $('phase').value = state.phase; $('phaseV').textContent = Math.round(state.phase * 100) + '%'; }
  const c = T[state.clip] ?? 0;
  C.begin();
  C.pushT(state.lod, 0, 0, 0, 0, c, state.phase, c, 0, 0, 0);
  if (state.lineup) LINEUP.forEach((x, n) => C.pushT(state.lod, x, 0, -0.4, 0, c, (state.phase + n * 0.19) % 1, c, 0, 0, 1 + n));
  C.end();
  skel.update();
  placeRings();
  if (!shown && C.stage[C.kindOf[0]]?.[state.lod]?.n > 0) { shown = true; $('loading').style.display = 'none'; buildBones(); }
  if (orig && origKey !== lookKey()) { scene.remove(orig); orig = null; $('detailBox').style.display = 'none'; $('orig').textContent = 'Show the editor\'s original'; setView(); }
  orbit.update();
  R.render(scene, cam);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ the camera
let yawView = 0, framing = 'body';
const FRAMES = { body: [0.9, 3.4], chest: [1.32, 1.15], neck: [1.43, 0.62], face: [1.6, 0.62], feet: [0.14, 1.05] };
function setView() {
  // (the face and the neck where this body has them: a woman's lower than a man's)
  const eye = MAN[state.sex]?.parts?.head?.[state.look[state.sex].head]?.eyes?.[0]?.[1], nk = MAN[state.sex]?.land?.neckY;
  const [h0, d] = FRAMES[framing], h = eye && framing === 'face' ? eye - 0.025 : nk && framing === 'neck' ? nk : h0, [x, z] = [Math.sin(yawView) * d, Math.cos(yawView) * d];
  const cx = orig ? -0.42 : 0, k = orig ? 1.45 : 1;   // (both, when the editor's original stands beside)
  orbit.target.set(cx, h, 0); cam.position.set(cx + x * k, h + (framing === 'feet' ? 0.25 : 0.08), z * k); orbit.update();
}
document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { yawView = { front: 0, three: 0.65, side: Math.PI / 2, back: Math.PI }[b.dataset.v]; setView(); });
document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { framing = b.dataset.f; setView(); });
document.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { state.lod = +b.dataset.l; document.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x === b)); shown = false; });

// ------------------------------------------------------------------ the tuning, applied (rig changes are the slow part)
let applyTimer = null, applying = false, again = false;
function changed() {
  const dirty = JSON.stringify(normalizeTuning(tun)) !== JSON.stringify(saved);
  $('dirty').classList.toggle('show', dirty);
  clearTimeout(applyTimer); applyTimer = setTimeout(apply, 60);
  commitSoon();
}
// ------------------------------------------------------------------ undo / redo (2026-11-20, the product owner: "ctrl+z")
// Every change to the tuning is a step: a slider dragged, a joint turned or moved with the mouse, a part worn or not — a
// burst of changes (a drag) one step, once it rests; Ctrl+Z steps back, Ctrl+Y, Ctrl+Shift+Z or Ctrl+R forward. The
// outfit shown, the clip and the view are not steps (they change nothing saved).
const undoStack = [], redoStack = [], HISTORY = 300;
let committed = JSON.stringify(tun), commitTimer = null, replaying = false;
function commitSoon() { if (replaying) return; clearTimeout(commitTimer); commitTimer = setTimeout(commit, 450); }
function commit() {
  clearTimeout(commitTimer); commitTimer = null;
  if (typeof rings !== 'undefined' && rings.dragging) { commitSoon(); return; }   // (a drag: one step, when it ends)
  const now = JSON.stringify(tun); if (now === committed) return;
  undoStack.push(committed); if (undoStack.length > HISTORY) undoStack.shift();
  redoStack.length = 0; committed = now; showHistory();
}
function restore(json) { replaying = true; try { tun = JSON.parse(json); buildAll(); changed(); } finally { replaying = false; } committed = json; showHistory(); }
function undo() { commit(); if (!undoStack.length) return; redoStack.push(committed); restore(undoStack.pop()); status(`Undone (${undoStack.length} more to undo).`); }
function redo() { commit(); if (!redoStack.length) return; undoStack.push(committed); restore(redoStack.pop()); status(`Redone (${redoStack.length} more to redo).`); }
function showHistory() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; }
$('undo').onclick = () => undo(); $('redo').onclick = () => redo();
addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target; if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|number|search|email|password)$/.test(t.type)))) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || k === 'r' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }   // (Ctrl+R: redo here, not reload)
}, true);
async function apply(t = tun) {
  if (applying) { again = true; return; }
  applying = true;
  try { await C.applyTuning(t); } catch (err) { status('Could not apply: ' + err.message, 'err'); }
  applying = false;
  C.crowdLook(0, lookFor(state.sex));
  if (again) { again = false; apply(); }
}
const status = (t, cls = '') => { $('status').textContent = t; $('status').className = 'note ' + cls; };

// ------------------------------------------------------------------ the panel
function slider({ label, min, max, step, value, fmt, ends, oninput }) {
  const v = el('b'), input = el('input', { type: 'range', min, max, step, value });
  const show = () => { v.textContent = fmt(+input.value); };
  input.oninput = () => { show(); oninput(+input.value); };
  show();
  return el('div', { className: 'sl' }, el('div', { className: 'lab' }, el('span', { textContent: label }), v), input, ...(ends ? [el('div', { className: 'ends' }, el('span', { textContent: ends[0] }), el('span', { textContent: ends[1] }))] : []));
}
const mm = x => `${x > 0 ? '+' : ''}${Math.round(x * 1000 * 10) / 10} mm`;
const offList = (s, cat) => (((tun.off[s] ??= {})[cat]) ??= []);
function setOn(s, cat, name, on) {
  const l = offList(s, cat), i = l.indexOf(name);
  if (on && i >= 0) l.splice(i, 1); else if (!on && i < 0) l.push(name);
  changed(); buildOutfit(); buildWardrobe(); buildFits();
}

function buildOutfit() {
  const s = state.sex, box = $('outfit'); box.innerHTML = '';
  for (const [cat, label] of Object.entries(CATS)) {
    if (cat === 'beard' && s === 'f') continue;
    const sel = el('select');
    if (cat === 'beard') sel.append(el('option', { value: -1, textContent: 'none' }));
    if (cat === 'bottom' && isDress(s, state.look[s].top)) { sel.append(el('option', { value: -1, textContent: '— (a dress)' })); sel.disabled = true; }
    else parts(s, cat).forEach((p, i) => sel.append(el('option', { value: i, textContent: p.name + (partOn(tun, s, cat, p.name) ? '' : '  (not in the crowd)') })));
    sel.value = String(cat === 'bottom' && isDress(s, state.look[s].top) ? -1 : state.look[s][cat]);
    sel.onchange = () => { state.look[s][cat] = +sel.value; C.crowdLook(0, lookFor(s)); buildOutfit(); buildFits(); };
    box.append(el('span', { className: 'note', textContent: label }), sel);
  }
}
function buildFits() {
  const s = state.sex, box = $('fits'); box.innerHTML = '';
  const l = lookFor(s);
  for (const cat of FIT_CATS) {
    const i = l[cat]; if (i == null || i < 0) continue;
    const p = parts(s, cat)[i]; if (!p) continue;
    const on = partOn(tun, s, cat, p.name), cb = el('input', { type: 'checkbox', checked: on });
    cb.onchange = () => setOn(s, cat, p.name, cb.checked);
    const key = `${cat}/${p.name}`;
    box.append(el('div', { className: 'fit' },
      el('div', { className: 'row' }, el('span', { className: 'name', textContent: `${CATS[cat]}: ${p.name}` })),
      el('label', { className: 'row' }, cb, el('span', { textContent: 'Worn by the crowd' })),
      slider({ label: 'Push out (this one)', min: -0.005, max: Math.min(PUSH_MAX, 0.025), step: 0.0005, value: tun.push[s]?.[key] || 0, fmt: mm, ends: ['pull in', 'push out'],
        oninput: v => { const m = (tun.push[s] ??= {}); if (v) m[key] = v; else delete m[key]; changed(); } })));
  }
}
function buildPushAll() {
  const s = state.sex, box = $('pushAll'); box.innerHTML = '';
  for (const cat of FIT_CATS) {
    if (cat === 'beard' && s === 'f') continue;
    const key = `${cat}/*`;
    box.append(slider({ label: `Every ${CATS[cat].toLowerCase()} pushed out`, min: -0.005, max: Math.min(PUSH_MAX, 0.02), step: 0.0005, value: tun.push[s]?.[key] || 0, fmt: mm,
      oninput: v => { const m = (tun.push[s] ??= {}); if (v) m[key] = v; else delete m[key]; changed(); } }));
  }
}
function buildWardrobe() {
  const s = state.sex, box = $('wardrobe'); box.innerHTML = '';
  for (const [cat, label] of Object.entries(CATS)) {
    if (cat === 'beard' && s === 'f') continue;
    const list = parts(s, cat), off = list.filter(p => !partOn(tun, s, cat, p.name)).length;
    const wear = el('div', { className: 'wear' });
    for (const p of list) {
      const on = partOn(tun, s, cat, p.name), cb = el('input', { type: 'checkbox', checked: on });
      cb.onchange = () => setOn(s, cat, p.name, cb.checked);
      wear.append(el('label', { className: on ? '' : 'off' }, cb, el('span', { textContent: p.name })));
    }
    box.append(el('details', {}, el('summary', { textContent: `${label} — ${list.length - off} of ${list.length} worn` }), wear));
  }
}
// the posture: the body's own (every clip: tun.rig) or one clip's, on top (tun.clips)
let rigScope = 'all';
const clipLabel = n => n.replace(/_/g, ' ');
/** The groups being edited: the body's, or the clip playing's (made when first set). */
function rigGroups(make = false) {
  const s = state.sex;
  if (rigScope === 'all') return make ? (tun.rig[s] ??= {}) : tun.rig[s];
  if (!make) return tun.clips?.[s]?.[state.clip];
  return (((tun.clips ??= {})[s] ??= {})[state.clip] ??= {});
}
function tidyClips(s) {   // (a clip's groups left empty: gone)
  const c = tun.clips?.[s]; if (!c) return;
  for (const [n, g] of Object.entries(c)) if (!Object.keys(g).length) delete c[n];
  if (!Object.keys(c).length) delete tun.clips[s];
}
function buildRig() {
  const s = state.sex, box = $('rig'); box.innerHTML = '';
  $('rigBody').textContent = s === 'f' ? 'women' : 'men';
  $('scopeAll').classList.toggle('on', rigScope === 'all'); $('scopeClip').classList.toggle('on', rigScope === 'clip');
  $('scopeClip').textContent = `Only this animation (${clipLabel(state.clip)})`;
  $('scopeNote').textContent = rigScope === 'all' ? 'Changing: every animation of this body.' : `Changing: only “${clipLabel(state.clip)}”, on top of the body's own posture. Pick another clip under Animation to adjust that one.`;
  const cur = rigGroups() || {};
  for (const g of RIG_GROUPS) {
    const vals = (cur[g.id] || [0, 0, 0]).slice(), axes = RIG_AXES[g.side ? 'side' : 'centre'];
    const d = el('details', { open: !!cur[g.id] }, el('summary', { textContent: g.label + (cur[g.id] ? '  •' : '') }));
    axes.forEach((ends, k) => d.append(slider({ label: `${ends[0]} / ${ends[1]}`, min: -RIG_LIMIT, max: RIG_LIMIT, step: 0.5, value: vals[k], fmt: x => `${x > 0 ? '+' : ''}${x}°`, ends,
      oninput: v => { vals[k] = v; const r = rigGroups(true); if (vals.some(x => x)) r[g.id] = vals.slice(); else delete r[g.id]; tidyClips(s); changed(); buildClipList(); } })));
    const reset = el('button', { textContent: 'Reset ' + g.label.toLowerCase() });
    reset.onclick = () => { delete rigGroups()?.[g.id]; tidyClips(s); changed(); buildRig(); };
    d.append(el('div', { className: 'row' }, reset));
    box.append(d);
  }
  buildClipList();
  buildBones();
}
// ------------------------------------------------------------------ the skeleton: any bone, turned (this scope's)
let bone = 'Spine';
/** The single bones being edited: the body's (every animation) or the clip playing's. */
function bonesOf(make = false) { const g = rigGroups(make); if (!g) return null; return make ? (g.bones ??= {}) : g.bones || null; }
function tidyBones() { const g = rigGroups(); if (g?.bones && !Object.keys(g.bones).length) delete g.bones; tidyClips(state.sex); }
function selectBone(n) { bone = n; $('boneSel').value = n; buildBones(); setGrip(grip); }
function buildBones() {
  const names = skel.names(), sel = $('boneSel');
  if (names.length && !sel.options.length) {
    for (const [label, list] of boneGroups(names)) { const og = el('optgroup', { label }); for (const n of list) og.append(el('option', { value: n, textContent: boneLabel(n) })); sel.append(og); }
  }
  if (names.length && !names.includes(bone)) bone = 'Spine';
  sel.value = bone;
  skel.setSelected($('skelShow').checked ? bone : null);
  const cur = bonesOf() || {}; skel.setEdited(Object.keys(cur));
  const box = $('boneSliders'); box.innerHTML = '';
  const vals = (cur[bone] || [0, 0, 0]).slice();
  AXES.forEach((ends, k) => box.append(slider({ label: `${ends[0]} / ${ends[1]}`, min: -BONE_LIMIT, max: BONE_LIMIT, step: 0.5, value: vals[k], fmt: x => `${x > 0 ? '+' : ''}${x}°`, ends,
    oninput: v => { vals[k] = v; setBone(bone, vals); } })));
  showBoneList();
}
/** Bone `name` turned to `vals` in the scope edited (its mirror too, if asked); the sliders and the joints' colours. */
function setBone(name, vals) {
  const b = bonesOf(true);
  if (vals.some(x => x)) b[name] = vals.slice(); else delete b[name];
  const o = $('skelMirror').checked ? mirrorOf(name) : null;
  if (o) { const mv = mirrored(vals); if (mv.some(x => x)) b[o] = mv; else delete b[o]; }
  tidyBones(); changed(); buildClipList(); skel.setEdited(Object.keys(bonesOf() || {})); showBoneList();
}
const DEG = 180 / Math.PI;
const turnMatrix = v => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(v[0] / DEG, v[1] / DEG, v[2] / DEG, 'ZYX'));   // (shared/crowd-tuning.js rot: Z·Y·X)
let drag = null, grip = 'rotate';   // (grip: turn the bone — rings — or move the joint — arrows)
/** The rings (or arrows) on the picked joint, where the frame shown has it (not while they are being dragged). */
function placeRings() {
  const on = $('skelShow').checked && $('skelRings').checked && !!bone;
  if (!on) { if (rings.object) rings.detach(); return; }
  if (drag) return;
  const f = skel.frameOf(bone); if (!f) return;
  handle.position.copy(f.pos); if (grip === 'rotate') handle.quaternion.copy(f.quat); else handle.quaternion.identity(); handle.updateMatrixWorld();
  if (rings.object !== handle) rings.attach(handle);
}
function setGrip(g) {
  grip = g; rings.setMode(g); rings.setSpace(g === 'rotate' ? 'local' : 'world');
  $('gripTurn').classList.toggle('on', g === 'rotate'); $('gripMove').classList.toggle('on', g === 'translate');
  $('gripNote').textContent = g === 'rotate' ? 'Drag a ring: the bone turns about its joint.' : bone === 'Hips' ? 'Drag an arrow: the whole body moves.' : `Drag an arrow: the joint moves, ${chainOf(bone).map(boneLabel).join(', ') || 'nothing above it'} turning to follow.`;
  placeRings();
}
/** The bones turned to bring joint `n` where it is dragged: its parent and up — two for a hand or a foot (the elbow and
 *  shoulder, the knee and hip), three for the head (neck, chest, middle back), one for any other — never the hips. */
function chainOf(n) {
  const k = /^(Left|Right)(Hand|Foot|ToeBase)$/.test(n) ? 2 : n === 'Head' ? 3 : n === 'Neck' ? 2 : 1, out = [];
  let p = skel.parentOf(n);
  while (p && p !== 'Hips' && out.length < k) { out.push(p); p = skel.parentOf(p); }
  return out;
}
/**
 * Joint `end` brought toward `target` (the animation's space) by turning the bones of `chain` (nearest first) — cyclic
 * coordinate descent from the pose `P` (poseOf) — → { name: world turn (Quaternion) } each bone takes on, its own and its
 * parents' in the chain together.
 */
function reach(end, chain, P, target) {
  const pos = {}; for (const n of [end, ...chain]) pos[n] = P.pos[n].clone();
  const T = {}; for (const n of chain) T[n] = new THREE.Quaternion();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < chain.length; i++) {
      const j = chain[i], pj = pos[j];
      v1.subVectors(pos[end], pj); v2.subVectors(target, pj);
      if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) continue;
      q.setFromUnitVectors(v1.normalize(), v2.normalize());
      // (what hangs from j — the chain's nearer bones and the end — turned with it about its joint)
      for (const n of [end, ...chain.slice(0, i)]) pos[n].sub(pj).applyQuaternion(q).add(pj);
      for (const n of chain.slice(0, i + 1)) T[n].premultiply(q);
    }
    if (pos[end].distanceToSquared(target) < 1e-7) break;
  }
  return T;
}
rings.addEventListener('dragging-changed', e => {
  orbit.enabled = !e.value;
  if (e.value) {
    // (held still while it is turned or moved: the moment shown)
    state.playing = false; $('play').textContent = 'Play';
    const chain = grip === 'translate' && bone !== 'Hips' ? chainOf(bone) : [];
    drag = { q0: handle.quaternion.clone(), R0: turnMatrix((bonesOf()?.[bone] || [0, 0, 0]).slice()), p0: handle.position.clone(), chain,
      P: chain.length ? skel.poseOf([bone, ...chain]) : null, R: Object.fromEntries(chain.map(n => [n, turnMatrix((bonesOf()?.[n] || [0, 0, 0]).slice())])),
      shift0: (rigGroups()?.shift || [0, 0, 0]).slice() };
  } else { drag = null; buildBones(); commit(); }
});
rings.addEventListener('objectChange', () => {
  if (!drag) return;
  if (grip === 'translate') return moveJoint();
  // the turn dragged, in the bone's own axes (as shown), on top of its turn when the drag began: R = R0 · (q0⁻¹ q)
  const L = new THREE.Matrix4().makeRotationFromQuaternion(drag.q0.clone().invert().multiply(handle.quaternion));
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(drag.R0, L), 'ZYX');
  const vals = [e.x, e.y, e.z].map(a => Math.max(-BONE_LIMIT, Math.min(BONE_LIMIT, Math.round(a * DEG * 2) / 2)));
  setBone(bone, vals);
  document.querySelectorAll('#boneSliders input[type=range]').forEach((r, k) => { r.value = vals[k]; r.dispatchEvent(new Event('show')); const b = r.closest('.sl')?.querySelector('b'); if (b) b.textContent = `${vals[k] > 0 ? '+' : ''}${vals[k]}°`; });
});
function showBoneList() {
  const cur = Object.keys(bonesOf() || {});
  $('boneList').textContent = cur.length ? `Turned here: ${cur.map(boneLabel).join(', ')}` : 'No bones turned here yet.';
}
$('boneSel').onchange = () => selectBone($('boneSel').value);
$('skelShow').onchange = () => { skel.group.visible = $('skelShow').checked; buildBones(); };
$('skelRings').onchange = () => placeRings();
$('gripTurn').onclick = () => setGrip('rotate');
$('gripMove').onclick = () => setGrip('translate');
/** A joint moved with the arrows: the hips move the whole body (shift); any other, the bones above it turned to reach. */
function moveJoint() {
  const P = drag.P, [H, Bd] = (P || skel.poseOf([bone]) || {}).scale || [1, 1];
  const d = handle.position.clone().sub(drag.p0); d.x /= H * Bd; d.y /= H; d.z /= H * Bd;   // (the screen's scale off: the animation's space)
  if (bone === 'Hips') {
    const g = rigGroups(true), v = drag.shift0.map((x, i) => Math.round((x + [d.x, d.y, d.z][i]) * 1000) / 1000);
    if (v.some(x => x)) g.shift = v; else delete g.shift;
    tidyClips(state.sex); changed(); buildClipList(); return;
  }
  if (!P || !drag.chain.length) return;
  const T = reach(bone, drag.chain, P, P.pos[bone].clone().add(d));
  // each bone's own turn, in its own axes as shown when the drag began: L = Q⁻¹ · T_parent⁻¹ · T · Q, on top of its turn then
  drag.chain.forEach((n, i) => {
    const Q = P.quat[n], Tp = i + 1 < drag.chain.length ? T[drag.chain[i + 1]] : new THREE.Quaternion();
    const L = Q.clone().invert().multiply(Tp.clone().invert()).multiply(T[n]).multiply(Q);
    const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(drag.R[n], new THREE.Matrix4().makeRotationFromQuaternion(L)), 'ZYX');
    setBone(n, [e.x, e.y, e.z].map(a => Math.max(-BONE_LIMIT, Math.min(BONE_LIMIT, Math.round(a * DEG * 2) / 2))));
  });
}
$('boneReset').onclick = () => { const b = bonesOf(); if (b) { delete b[bone]; const o = $('skelMirror').checked ? mirrorOf(bone) : null; if (o) delete b[o]; } tidyBones(); changed(); buildBones(); buildClipList(); };
$('bonesReset').onclick = () => { const g = rigGroups(); if (g) delete g.bones; tidyClips(state.sex); changed(); buildBones(); buildClipList(); };
// (a click on a joint picks it — not a drag to turn the view)
{ let down = null; R.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  R.domElement.addEventListener('pointerup', e => { if (!down || rings.dragging || rings.axis || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const n = skel.pickAt(e); if (n) selectBone(n); }); }
/** The clips of this body with a posture of their own: each to go to, or to reset. */
function buildClipList() {
  const s = state.sex, box = $('clipList'); box.innerHTML = '';
  const list = Object.entries(tun.clips?.[s] || {});
  if (!list.length) return;
  box.append(el('div', { className: 'note', textContent: 'Animations with their own posture:' }));
  for (const [n, g] of list) {
    const go = el('button', { textContent: `${clipLabel(n)} (${Object.keys(g).map(id => (id === 'bones' ? `${Object.keys(g.bones).length} bone${Object.keys(g.bones).length === 1 ? '' : 's'}` : RIG_GROUPS.find(x => x.id === id)?.label.toLowerCase() || id)).join(', ')})` });
    go.onclick = () => { state.clip = n; $('clip').value = n; state.phase = 0; rigScope = 'clip'; buildRig(); };
    const del = el('button', { textContent: 'Reset' });
    del.onclick = () => { delete tun.clips[s][n]; tidyClips(s); changed(); buildRig(); };
    box.append(el('div', { className: 'row' }, go, del));
  }
}
function buildTuck() {
  const t = $('tuck'); t.value = tun.tuck; $('tuckV').textContent = `${Math.round(tun.tuck * 1000 * 10) / 10} mm`;
  t.oninput = () => { tun.tuck = +t.value; $('tuckV').textContent = `${Math.round(tun.tuck * 1000 * 10) / 10} mm`; changed(); };
  const h = $('hideCov'); h.checked = tun.hide !== false;
  h.onchange = () => { tun.hide = h.checked; changed(); };
  const rm = $('readyMade'); rm.checked = tun.readyMade !== false;
  rm.onchange = () => { tun.readyMade = rm.checked; changed(); };
}
// the faces' motion (the tuning's face) and a preview of an expression (Characters.setFaceForce)
const FACE_UI = [
  ['glance', 'Eye glances', x => `${x}°`, 0.5], ['glanceEvery', '… about every', x => `${x} s`, 0.1],
  ['brow', 'Eyebrow raise', x => `${Math.round(x * 10000) / 10} mm`, 0.0001], ['browEvery', '… about every', x => `${x} s`, 0.5],
  ['smile', 'Smile (corners up)', x => `${Math.round(x * 10000) / 10} mm`, 0.0001], ['smileShare', 'Residents smiling at rest', x => `${Math.round(x * 100)}%`, 0.01],
  ['talk', 'Mouth opening when talking', x => `${Math.round(x * 10000) / 10} mm`, 0.0001], ['talkRate', 'Talking speed', x => `${x} a second`, 0.1],
  ['blinkEvery', 'Blink about every', x => (x ? `${x} s` : 'never'), 0.1],
];
function buildFace() {
  const box = $('face'); box.innerHTML = '';
  for (const [k, label, fmt, step] of FACE_UI) {
    const [, lo, hi] = FACE[k];
    box.append(slider({ label, min: lo, max: hi, step, value: tun.face?.[k] ?? FACE[k][0], fmt, oninput: v => { (tun.face ??= {})[k] = v; changed(); } }));
  }
  const reset = el('button', { textContent: 'Face motion back to the defaults' });
  reset.onclick = () => { tun.face = Object.fromEntries(Object.entries(FACE).map(([k, [d]]) => [k, d])); changed(); buildFace(); };
  box.append(el('div', { className: 'row' }, reset));
}
let expression = 'auto';
function preview(x) {
  expression = x;
  document.querySelectorAll('[data-x]').forEach(b => b.classList.toggle('on', b.dataset.x === x));
  const g = (tun.face?.glance ?? FACE.glance[0]) * Math.PI / 180;
  const P = { auto: null, left: { gx: g }, right: { gx: -g }, up: { gy: g * 0.6 }, brow: { brow: 1 }, smile: { smile: 1 }, talk: { talk: 1 }, smiletalk: { smile: 1, talk: 1 } }[x];
  C.setFaceForce(P);
  if (P && framing === 'body') { framing = 'face'; setView(); }
}
document.querySelectorAll('[data-x]').forEach(b => b.onclick = () => preview(b.dataset.x));
// ------------------------------------------------------------------ the bake's detail (crowd-studio-detail.js)
let orig = null, origKey = '', origTris = 0, tris = [0, 0, 0];
const lookKey = () => JSON.stringify([state.sex, lookFor(state.sex), state.app[state.sex]]);
// (the slider: how far the bake may change the shape — 0 at the right, the original; to 20 cm at the left; log)
const toErr = v => (v >= 0.999 ? 0 : 10 ** (-4 + 3.3 * (1 - v))), fromErr = e => (e <= 0 ? 1 : Math.max(0, Math.min(1, 1 - (Math.log10(e) + 4) / 3.3)));
const n = x => Math.round(x).toLocaleString();
let detailTimer = null;
async function applyDetail() {
  if (!orig) return;
  const e = toErr(+$('detail').value), t = await setDetail(orig, e), sh = t / origTris;
  $('detailV').textContent = e <= 0 ? '100% (original)' : `${(sh * 100).toFixed(sh < 0.1 ? 1 : 0)}% · shape within ${(e * 1000).toFixed(e < 0.001 ? 2 : 1)} mm`;
  $('detailInfo').textContent = `The editor's original: ${n(origTris)} triangles · shown now: ${n(t)} · the crowd's own, this outfit: ${tris.c ? `close-up ${n(tris.c)} (${(tris.c / origTris * 100).toFixed(1)}%), ` : ''}near ${n(tris[0])} (${(tris[0] / origTris * 100).toFixed(1)}%), middle ${n(tris[1])}, far ${n(tris[2])}.`;
}
$('orig').onclick = async () => {
  const s = state.sex, r = lookFor(s);
  $('orig').disabled = true;
  try {
    const parts = await editorKit(MAN[s], s, r, state.app[s], t => status(t));
    if (orig) scene.remove(orig);
    orig = editorModel(parts); orig.position.x = -0.85; orig.rotation.y = 0; scene.add(orig);
    origKey = lookKey(); origTris = orig.userData.tris; tris = crowdTris(MAN[s], r);
    orig.userData.mat.wireframe = $('wire').checked;
    $('detailBox').style.display = ''; $('orig').textContent = 'Make it again (this outfit)';
    setView(); await applyDetail(); status('The editor\'s original stands on the left.', 'ok');
  } catch (err) { status('Could not make the original: ' + err.message, 'err'); }
  $('orig').disabled = false;
};
$('detail').oninput = () => { clearTimeout(detailTimer); detailTimer = setTimeout(applyDetail, 80); };
document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
  const d = b.dataset.d;
  if (d === 'orig') $('detail').value = 1;
  else { const want = d === 'c' ? tris.c : tris[+d]; if (!want) { status('This crowd has no close-up level yet: set one below and rebuild.', 'warn'); return; } status('Finding that detail…'); const r = await detailFor(orig, want); $('detail').value = fromErr(r.err); status(''); }
  applyDetail();
});
$('wire').onchange = () => {
  const on = $('wire').checked;
  if (orig) orig.userData.mat.wireframe = on;
  C.kinds.forEach(kd => { if (kd?.mats) for (const m of [kd.mats.map, kd.mats.plain]) m.wireframe = on; });
};
// the crowd's own bake: each level's error (tun.bake), and rebuilding the library with it (server/crowd-bake.js)
const LEVEL = { close: 'Close-up', near: 'Near', middle: 'Middle', far: 'Far' };
const mmOf = e => `${(e * 1000).toFixed(e < 0.001 ? 2 : 1)} mm`;
function buildBake() {
  const box = $('bakeLevels'); box.innerHTML = '';
  for (const L of BAKE_LEVELS) {
    const e = tun.bake?.[L];
    const use = el('button', { textContent: 'Use the slider\'s' }), std = el('button', { textContent: 'Standard' });
    use.onclick = () => { if (!orig) { status('Show the editor\'s original first, then set the slider.', 'warn'); return; } const v = toErr(+$('detail').value); (tun.bake ??= {})[L] = Math.max(0.00005, v); changed(); buildBake(); };
    std.onclick = () => { if (tun.bake) { delete tun.bake[L]; if (!Object.keys(tun.bake).length) tun.bake = null; } changed(); buildBake(); };
    const what = e == null ? 'standard (its own size)' : `shapes within ${mmOf(e)}`;
    box.append(el('div', { className: 'row' }, el('b', { textContent: LEVEL[L] + ':' }), el('span', { className: 'note', textContent: what }), use, std));
  }
}
let bakePoll = null;
async function bakeStatus() {
  const r = await fetch('/api/crowd/bake', { credentials: 'same-origin', cache: 'no-cache' }).then(x => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) { $('bakeStatus').textContent = canSave ? '' : 'Sign in as the site\'s owner to rebuild the crowd.'; return; }
  const ago = t => t ? new Date(t).toLocaleTimeString() : '';
  let t = r.served === 'baked' ? `The city uses your bake (${ago(r.built?.at)}).` : r.stale ? 'Your bake was made for an older crowd: the standard one is used until it is rebuilt.' : 'The city uses the standard bake.';
  if (r.running) t = `Rebuilding since ${ago(r.startedAt)}… ${(r.lines.at(-1) || '').replace(/^\[[a-z]+ \d+s\] /, '')}`;
  else if (r.ok === false) t += ` The last rebuild failed: ${r.error}`;
  else if (r.ok) t += ' Reload the city (and this page) to see it.';
  $('bakeStatus').textContent = t; $('rebake').disabled = r.running;
  clearTimeout(bakePoll); if (r.running) bakePoll = setTimeout(bakeStatus, 3000);
}
const post = (url, body) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: JSON.stringify(body) });
$('rebake').onclick = async () => {
  if (!canSave) { status('Sign in as the site\'s owner to rebuild the crowd.', 'err'); return; }
  if ($('dirty').classList.contains('show')) { await $('save').onclick(); if ($('dirty').classList.contains('show')) return; }
  const r = await post('/api/crowd/bake', { action: 'start' }); if (!r.ok) status('Could not start: ' + ((await r.json().catch(() => ({}))).error || r.status), 'err');
  bakeStatus();
};
$('bakeStandard').onclick = async () => {
  if (!canSave) { status('Sign in as the site\'s owner to change the crowd.', 'err'); return; }
  if (tun.bake) { tun.bake = null; changed(); buildBake(); await $('save').onclick(); }
  const r = await post('/api/crowd/bake', { action: 'standard' }); if (!r.ok) status('Could not: ' + ((await r.json().catch(() => ({}))).error || r.status), 'err');
  bakeStatus();
};
$('bakeBox').addEventListener('toggle', () => { if ($('bakeBox').open) bakeStatus(); });
function buildAll() { buildBake(); buildFace(); buildOutfit(); buildFits(); buildPushAll(); buildWardrobe(); buildRig(); buildTuck(); $('sexM').classList.toggle('on', state.sex === 'm'); $('sexF').classList.toggle('on', state.sex === 'f'); }

// clips: those this library has
const have = new Set([...MAN.m.clips, ...MAN.f.clips].map(c => c.name));
for (const n of TRIPO_CLIPS) if (have.has(n)) $('clip').append(el('option', { value: n, textContent: n.replace(/_/g, ' ') }));
$('clip').value = 'idle';
$('clip').onchange = () => { state.clip = $('clip').value; state.phase = 0; if (rigScope === 'clip') buildRig(); else $('scopeClip').textContent = `Only this animation (${clipLabel(state.clip)})`; };
$('scopeAll').onclick = () => { rigScope = 'all'; buildRig(); };
$('scopeClip').onclick = () => { rigScope = 'clip'; buildRig(); };
$('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pause' : 'Play'; };
$('speed').oninput = () => { state.speed = +$('speed').value; $('speedV').textContent = state.speed + '×'; };
$('phase').oninput = () => { state.playing = false; $('play').textContent = 'Play'; state.phase = +$('phase').value; $('phaseV').textContent = Math.round(state.phase * 100) + '%'; };
$('sexM').onclick = () => { state.sex = 'm'; dress(); buildAll(); shown = false; };
$('sexF').onclick = () => { state.sex = 'f'; dress(); buildAll(); shown = false; };
$('lineup').onchange = () => { state.lineup = $('lineup').checked; if (state.lineup) { state.crowdApps = []; dress(); } };
$('randLook').onclick = () => { randomLook(); C.crowdLook(0, lookFor(state.sex)); buildOutfit(); buildFits(); };
$('randCol').onclick = () => { state.app[state.sex] = randApp(state.sex); state.crowdApps = []; dress(); };
const hold = $('hold');
const noRig = () => apply({ ...tun, rig: { ...tun.rig, [state.sex]: {} }, clips: { ...(tun.clips || {}), [state.sex]: {} } });
hold.onpointerdown = e => { e.preventDefault(); noRig(); hold.classList.add('on'); };
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, () => { if (hold.classList.contains('on')) { hold.classList.remove('on'); apply(); } });
$('rigReset').onclick = () => { if (rigScope === 'all') delete tun.rig[state.sex]; else { delete tun.clips?.[state.sex]?.[state.clip]; tidyClips(state.sex); } changed(); buildRig(); };
$('revert').onclick = async () => { savedDoc = await fetchTuning(); saved = normalizeTuning(savedDoc); tun = clone(saved); buildAll(); changed(); status('Back to what is saved.'); };
$('save').onclick = async () => {
  if (!canSave) { status('Sign in to this site as its owner (or an administrator) to save.', 'err'); return; }
  $('save').disabled = true; status('Saving…');
  try {
    const r = await fetch('/api/crowd/tuning', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: JSON.stringify(normalizeTuning(tun)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    savedDoc = j; saved = normalizeTuning(j); tun = clone(saved);
    status('Saved. The city uses it from the next time a page loads.', 'ok'); showSaved(); changed(); buildAll();
  } catch (err) { status('Not saved: ' + err.message, 'err'); }
  $('save').disabled = false;
};
function showSaved() { $('savedBy').textContent = savedDoc?.at ? `Last saved ${new Date(savedDoc.at).toLocaleString()}${savedDoc.by ? ' by ' + savedDoc.by : ''}.` : 'Nothing saved yet: the crowd as built.'; }
addEventListener('beforeunload', e => { if ($('dirty').classList.contains('show')) { e.preventDefault(); e.returnValue = ''; } });

if (!canSave) status('You can try everything here; sign in as the site\'s owner to save it.', 'warn');
showSaved();
// a first look: what the crowd may wear
randomLook(); state.look.f = { ...state.look.f }; { const s = state.sex; state.sex = 'f'; randomLook(); state.sex = s; }
dress(); buildAll(); setView();
requestAnimationFrame(frame);
// lab checks (tools-bin): the page's state and renderer
window.__studio = { C, state, skel, cam, rings, handle, undo, redo, history: () => ({ undo: undoStack.length, redo: redoStack.length }), preview, scope: x => { rigScope = x; buildRig(); }, detail: () => ({ shown: !!orig, origTris, tris, info: $('detailInfo').textContent }), original: () => orig, get tuning() { return tun; }, set tuning(t) { tun = clone(normalizeTuning(t)); buildAll(); changed(); }, apply, setView: (v, f) => { if (v != null) yawView = v; if (f) framing = f; setView(); }, dress, lookFor, MAN, shown: () => shown };
