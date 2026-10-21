// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Signs' faces (shared/signs.js; their frames are the decorations', the buildings' and the interiors' own geometry):
// - the Marketing tools' billboards and street signs, and a panel on every metro station: the sign's own content, else
//   the world's name;
// - owners' rooftop billboards: the owner's design;
// - signs inside buildings and parks (while their floor is drawn): the owner's design.
// Every face can be tapped: the sign's panel (ui/sign-panel.js) opens, with "Open link". In player mode the sign in reach
// (walking up to it, or looking at a big one) offers E: open its link.
import * as THREE from 'three';
import { S, bus, bld } from '../core/state.js';
import { auth } from '../core/auth.js';
import { GU } from './scene.js';
import { aspectOf } from '/shared/ads.js';
import { AD_ASSETS, adAssetFaces, assetSlot, METRO_PANEL, metroSlot, stationHasAds, roofSignFace, roofSlot, INDOOR_SIGNS, isIndoorSign, indoorSignFaces, indoorSlot, signShape } from '/shared/signs.js';
import { stationPoint, stationY } from '/shared/stations.js';
import { AdTextures, drawCreative, drawHouse, drawBlank, pictureFor, hostOf } from './ad-paint.js';
import { FB } from './furniture.js';
import { makeFurnMat } from './mats.js';

// textures by shape; signs inside come in any shape their owners give them ('x<aspect>'), painted 1024 px on the long side
const tex = { wide: new AdTextures({ width: 1024 }), portrait: new AdTextures({ width: 640 }), landscape: new AdTextures({ width: 768 }), sized: new AdTextures({ long: 1024 }) };
const texOf = shape => tex[shape] || tex.sized;
const mats = new Map();            // content key → material
const PLANE = new THREE.PlaneGeometry(1, 1);
const rc = new THREE.Raycaster(), _v = new THREE.Vector3(), _c = new THREE.Vector2();
let app = null, group = null, signs = [], dirty = { out: true, roof: true, indoor: true }, version = -1, frames = null, indoorRef = null;
const roofHidden = new Set();

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'signs'; a.stage.scene.add(group);
  frames = { mat: makeFurnMat({ lit: true }), meshes: [] };
  bus.on('decor', () => { dirty.out = true; });
  bus.on('stations', () => { dirty.out = true; });
  bus.on('terrain', () => { dirty.out = true; dirty.roof = true; });
  bus.on('world', ev => { if (!ev || ev.blds?.size) dirty.roof = true; if (!ev || ev.levels?.size) dirty.indoor = true; });
  bus.on('msg:lots', () => { dirty.roof = true; dirty.indoor = true; });
  bus.on('auth', () => { dirty.roof = true; dirty.indoor = true; });
  bus.on('frame', frame);
  app.hooks.click.unshift(onClick);
  (app.playerTargets ||= []).push(playerTarget);
  app.signs = { list: () => signs, open: openSign, preview };
}

// ------------------------------------------------------------------ what a face shows
const keyOf = cr => { let h = 2166136261; const s = JSON.stringify(cr); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
/** How much a face glows by day and how much more at night: lit panels (street and metro signs) most, printed
 *  billboards a little (their lamps light them at night), signs inside hardly (the rooms are lit). */
const GLOW = { lit: [0.26, 0.45], board: [0.07, 0.5], roof: [0.05, 0.45], inside: [0.02, 0.08] };
const glowOf = s => (s.kind === 'metro' || s.t === 'street_sign' ? 'lit' : s.kind === 'asset' ? 'board' : s.kind === 'roof' ? 'roof' : 'inside');
let G = 'board';   // the glow class of the sign being painted (contentOf sets it)
function material(key, shape, paint, src) {
  const k = `${key}|${shape}|${G}`;
  let m = mats.get(k);
  if (m) return m;
  const map = texOf(shape).get(`${key}|${shape}`, aspectOf(shape), paint, src);
  m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: GLOW[G][0], roughness: 0.88, metalness: 0 });
  m.userData.key = k; m.userData.tex = `${key}|${shape}`; m.userData.glow = GLOW[G];
  mats.set(k, m);
  return m;
}
const creativeMat = (prefix, cr, shape) => material(`${prefix}:${keyOf(cr)}`, shape, (x, W, H, img) => drawCreative(x, W, H, cr, img), pictureFor(cr, aspectOf(shape)) || null);
const houseMat = shape => material('house:own', shape, (x, W, H) => drawHouse(x, W, H, { title: S.world?.name || 'Welcome', line: '', world: '' }));
const blankMat = (shape, text) => material(`blank:${text}`, shape, (x, W, H) => drawBlank(x, W, H, text));
/** What sign s shows: { mat, cr (the design shown, for its panel) }. */
function contentOf(s) {
  G = glowOf(s);
  if (s.blocked) return { mat: blankMat(s.shape, 'Hidden by an administrator'), cr: null };
  if (s.cr) return { mat: creativeMat('cr', s.cr, s.shape), cr: s.cr };
  if (s.space) return { mat: houseMat(s.shape), cr: null };
  return { mat: blankMat(s.shape, s.mine ? 'Tap to design this sign' : ''), cr: null };
}

// ------------------------------------------------------------------ the signs in the world
function face(F, parent) { const m = new THREE.Mesh(PLANE, null); m.scale.set(F.w, F.h, 1); m.position.set(F.x, F.y, F.z); m.rotation.y = F.yaw; parent.add(m); return m; }
function clear(kinds) {
  signs = signs.filter(s => { if (!kinds.includes(s.kind)) return true; group.remove(s.g); return false; });
}
function buildOutdoor() {
  dirty.out = false;
  clear(['asset', 'metro']);
  for (const m of frames.meshes) { group.remove(m); m.geometry.dispose(); }
  frames.meshes = [];
  const W = S.world, yOf = (x, z) => (app.decor ? app.decor.y(x, z) : 0);
  for (const d of W.decorations || []) {
    const A = AD_ASSETS[d.t]; if (!A) continue;
    const g = new THREE.Group(); g.position.set(d.x, yOf(d.x, d.z), d.z); g.rotation.y = d.r || 0; group.add(g);
    const faces = adAssetFaces(d.t).map(F => face(F, g));
    signs.push({ key: `a:${d.id}`, kind: 'asset', t: d.t, id: d.id, g, faces, space: A.space, slot: assetSlot(d), shape: A.shape, cr: d.hc || null, reach: d.t === 'street_sign' ? 'walk' : 'aim', label: A.label, next: 0 });
  }
  // the metro stations' panels: a frame on the outside of the kiosk's back end, its face looking away from the steps
  const f = new FB();
  for (const st of W.stations || []) {
    if (!stationHasAds(st)) continue;
    const P = METRO_PANEL, y = stationY(st), p = stationPoint(st, P.lx, P.lz), rot = st.rot || 0;
    f.push(st.x, y, st.z, rot);
    f.col('#24533a'); f.box(-P.w / 2 - 0.08, P.y - P.h / 2 - 0.08, P.lz + 0.005, P.w / 2 + 0.08, P.y + P.h / 2 + 0.08, P.lz + 0.07);
    for (const x of [-P.w / 2 + 0.05, P.w / 2 - 0.05]) f.box(x - 0.04, 0, P.lz + 0.01, x + 0.04, P.y - P.h / 2 - 0.08, P.lz + 0.06);
    f.pop();
    const g = new THREE.Group(); g.position.set(p.x, y, p.z); g.rotation.y = rot + Math.PI; group.add(g);
    signs.push({ key: `m:${st.id}`, kind: 'metro', id: st.id, g, faces: [face({ x: 0, y: P.y, z: 0.002, w: P.w, h: P.h, yaw: 0 }, g)], space: 'street', slot: metroSlot(st), shape: 'portrait', cr: null, reach: 'walk', label: `${st.name} station`, next: 0 });
  }
  const G = f.build();
  if (G.geo) { const m = new THREE.Mesh(G.geo, frames.mat); m.castShadow = true; m.receiveShadow = true; group.add(m); frames.meshes.push(m); }
  version = -1;
}
function buildRoof() {
  dirty.roof = false;
  clear(['roof']);
  for (const B of S.world.buildings || []) {
    if (!B || B.gone || !B.roofSigns?.length) continue;
    B.roofSigns.forEach((sg, k) => {
      const F = roofSignFace(B, sg), g = new THREE.Group();
      g.position.set(F.x, F.y, F.z); g.rotation.y = F.yaw; group.add(g);
      signs.push({ key: `r:${B.idx}:${k}`, kind: 'roof', b: B.idx, k, g, faces: [face({ x: 0, y: 0, z: 0.012, w: F.w, h: F.h, yaw: 0 }, g)], space: null, slot: roofSlot(B, k), shape: 'wide', cr: sg.cr || null, blocked: !!sg.blocked, mine: mine(B), reach: 'aim', label: `${B.name}'s rooftop billboard`, next: 0 });
    });
  }
  version = -1;
}
function buildIndoor() {
  dirty.indoor = false;
  clear(['indoor']);
  const I = app.inter; if (!I) return;
  indoorRef = [I.foc.entries, I.park.entries];
  for (const e of [...I.foc.entries, ...I.park.entries]) {
    if (!isIndoorSign(e.t)) continue;
    const B = bld(e.b); if (!B) continue;
    const D = INDOOR_SIGNS[e.t], sg = e.it.sg || {}, g = new THREE.Group();
    g.position.set(e.x, e.y, e.z); g.rotation.y = e.yaw; group.add(g);
    const faces = indoorSignFaces(e.it).map(F => face(F, g));
    signs.push({ key: `i:${e.lv}:${e.id}`, kind: 'indoor', t: e.t, it: e.it, b: e.b, f: e.f, lv: e.lv, id: e.id, g, faces, space: null, slot: indoorSlot(B, e.lv, e.it), shape: signShape(e.it), cr: sg.cr || null, blocked: !!sg.blocked, mine: mine(B), reach: 'walk', label: D.label, next: 0 });
  }
  version = -1;
}
/** Whether the viewer holds the building's lot (their own signs say "Tap to design this sign"). */
function mine(B) { const L = B.lot && app.lots?.byId?.get(B.lot); return !!(auth.account && L?.holder?.kind === 'account' && String(L.holder.id) === String(auth.account.id)); }

function frame() {
  if (!S.world) return;
  if (dirty.out) buildOutdoor();
  if (dirty.roof) buildRoof();
  const I = app.inter;
  if (dirty.indoor || (I && (!indoorRef || indoorRef[0] !== I.foc.entries || indoorRef[1] !== I.park.entries))) buildIndoor();
  if (!signs.length) return;
  if (version !== 0) {
    version = 0;
    for (const s of signs) s.next = 0;
    // materials no sign can show any more are given back (the next frame makes the ones still needed)
    const keep = new Set(signs.flatMap(s => s.faces.map(m => m.material?.userData.key).filter(Boolean)));
    for (const [k, m] of mats) if (!keep.has(k)) { m.dispose(); mats.delete(k); }
    const keepTex = [...mats.values()].map(m => m.userData.tex);
    for (const T of Object.values(tex)) T.keep(keepTex);
  }
  const focusB = I?.focus?.b ?? -1;
  for (const s of signs) {
    if (s.kind === 'roof') s.g.visible = s.b !== focusB && s.b !== GU.uInB.value;
    if (s.next === Infinity) continue;
    s.next = Infinity;
    const C = contentOf(s);
    s.shown = C.cr;
    for (const m of s.faces) m.material = C.mat;
  }
  const night = GU.uNight.value;
  for (const m of mats.values()) m.emissiveIntensity = m.userData.glow[0] + night * m.userData.glow[1];
}

/**
 * While a sign inside is being resized by its handles (ui/editors.js): its faces at size { w, h } (null: as it is),
 * its design painted for that shape.
 */
function preview(lv, id, size) {
  const sg = signs.find(x => x.kind === 'indoor' && x.lv === lv && x.id === id); if (!sg) return;
  const it = size ? { ...sg.it, fw: size.w, fh: size.h } : sg.it, shape = signShape(it);
  indoorSignFaces(it).forEach((F, k) => { const m = sg.faces[k]; if (m) { m.position.set(F.x, F.y, F.z); m.scale.set(F.w, F.h, 1); } });
  if (shape !== sg.shape) { sg.shape = shape; sg.next = 0; }
}

// ------------------------------------------------------------------ tapping and reaching a sign
/** Opens the sign's own panel (its design and link). */
function openSign(s) {
  const edit = s.kind === 'roof' ? () => import('../ui/sign-design.js').then(m => m.editRoofSigns(app, s.b))
    : s.kind === 'indoor' ? () => import('../ui/sign-design.js').then(m => m.editIndoorSign(app, { b: s.b, f: s.f, id: s.id })) : null;
  // administrators may hide an owner's sign that breaks the rules (sign.hide), or show it again
  const hide = (s.kind === 'roof' || s.kind === 'indoor') && auth.can('world.edit') ? { blocked: s.blocked, op: s.kind === 'roof' ? { op: 'sign.hide', b: s.b, roof: s.k } : { op: 'sign.hide', b: s.b, f: s.f, id: s.id } } : null;
  import('../ui/sign-panel.js').then(m => m.openSignPanel(app, { cr: s.shown, title: s.label, mine: s.mine, kind: s.kind, shape: s.shape, edit, hide })).catch(() => {});
}
/** The link a sign leads to, opened in a new tab. */
function visit(s) {
  const url = s.shown?.website;
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
function onClick(e) {
  if (!signs.length) return false;
  if (app.hooks.hover.some(fn => { try { return fn({ x: e.clientX, y: e.clientY }); } catch { return false; } })) return false;   // a tool is in use
  if (S.mode !== 'play' && (app.docks?.isOpen?.('l:outside') || app.docks?.isOpen?.('l:marketing'))) return false;   // decorating: the tools select it
  if (S.mode === 'furnish') return false;   // furnishing: the sign is selected to edit it
  rc.ray.copy(app.cam.rayAt(e.clientX, e.clientY)); rc.far = 900;
  const hit = rc.intersectObjects(signs.filter(s => s.g.visible).flatMap(s => s.faces), false)[0];
  if (!hit) return false;
  const bh = app.blds?.pick?.(rc.ray, S.focus?.b, app.inter?.cutY);
  const s = signs.find(x => x.faces.includes(hit.object));
  if (!s || (s.kind !== 'roof' && bh && bh.d < hit.distance - 0.5)) return false;   // a building stands in front of it
  openSign(s);
  return true;
}
/**
 * Player mode (player/player.js asks every provider): the sign in reach - one walked up to (2.6 m, in front of a face)
 * or a big one looked at (the screen's centre, within 200 m). E opens its link (or its panel when it has none).
 */
function playerTarget(P) {
  if (!signs.length) return null;
  let best = null;
  for (const s of signs) {
    if (s.reach !== 'walk' || !s.g.visible) continue;
    for (const m of s.faces) {
      m.getWorldPosition(_v);
      const d = Math.hypot(_v.x - P.x, _v.z - P.z);
      if (d > 2.6 || Math.abs(_v.y - (P.y + 1.4)) > 2.2 || (best && d >= best.d)) continue;
      best = { d, s };
    }
  }
  if (!best) {
    const cam = app.stage?.camera; if (!cam) return null;
    rc.setFromCamera(_c.set(0, 0), cam); rc.far = 200;
    const hit = rc.intersectObjects(signs.filter(s => s.reach === 'aim' && s.g.visible).flatMap(s => s.faces), false)[0];
    const s = hit && signs.find(x => x.faces.includes(hit.object));
    if (s) best = { d: 1.9, s };
  }
  if (!best) return null;
  const s = best.s, host = hostOf(s.shown?.website);
  return { d: best.d, html: host ? `Open link <span class="dim">· ${host}</span>` : 'Look at the sign', act: () => (visit(s) || openSign(s)) };
}
