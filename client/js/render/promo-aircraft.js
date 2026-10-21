// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Promotional aircraft in the browser (WP4.11; rebuilt from the ground up for the design review 2026-10-03): banner planes,
// blimps and hot-air balloons carrying the administrators' advertisement, on the flight plans every browser shares
// (shared/promo.js: each on its own circuit and height band, wide banked turns, well clear of every roof and hill),
// positions from the shared clock. The models are Next's own (render/promo-models.js). Each plane tows its banner on a
// rope: the cloth trails behind along the plane's own path through the turns, rippling, its text reading the right
// way round from either side. The blimp carries the advertisement along both sides of its hull (lit at night); the
// balloon round its envelope and on a banner below its basket, its burner flaring now and then. A click on one with a
// website offers to open it. Display → Promotional aircraft switches them off on this screen.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { makeFurnMat } from './mats.js';
import { GU } from './scene.js';
import { buildingTop } from './buildings.js';
import { footprint } from '/shared/geom.js';
import { viewRect } from '/shared/city.js';
import { PROMO_TYPE, resolvePromoAircraftFleet, promoAircraftGraphicIsVisible, planFleet, sampleFlight, bankFor, lapAt } from '/shared/promo.js';
import { bannerPlane, PROP_ROTOR, blimp, blimpPanels, BLIMP_PANEL_ASPECT, balloon, balloonBand, balloonBanner, balloonBannerRig, BALLOON_BANNER_ASPECT, BALLOON_BAND_ASPECT } from './promo-models.js';
import { rotorBlades, blurDisc, blurMaterial, blurOpacity } from './rotors.js';
import { drawGraphic } from './ad-paint.js';

const SIZE = { bannerPlane: 1.25, blimp: 1, hotAirBalloon: 1 };   // the models' scale in the world
const BANNER = { len: 30, h: 6, rope: 22, segs: 16 };                 // the plane's banner (m, before SIZE)
let app = null, P = { config: null, schedule: { from: 7, to: 21 } }, fleet = [], parts = null, group = null, on = true, dirty = true, withGround = false, shownVer = 0, builtVer = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m2 = new THREE.Matrix4(), _mr = new THREE.Matrix4();

export async function init(a) {
  app = a;
  on = localStorage.getItem('mvw.promoAircraft') !== 'off';
  group = new THREE.Group(); group.name = 'promo-aircraft'; a.stage.scene.add(group);
  try { const r = await fetch('/api/promo-aircraft'); if (r.ok) Object.assign(P, await r.json()); } catch { /* no fleet */ }
  bus.on('msg:promo', m => { P.config = m.config; P.schedule = m.schedule; dirty = true; });
  bus.on('world', ev => { if (ev?.blds?.size) dirty = true; });
  bus.on('terrain', () => { dirty = true; });
  bus.on('display', k => { if (k === 'promoAircraft') { on = localStorage.getItem('mvw.promoAircraft') !== 'off'; group.visible = on; } });
  app.hooks.click.push(onClick);
  (app.playerTargets ||= []).push(playerTarget);
  bus.on('frame', update);
  app.promoAircraft = { get count() { return fleet.length; }, fleet: () => fleet };
}

// ------------------------------------------------------------------ the advertisement
/** The administrators' advertisement painted onto a canvas of the surface's shape (render/ad-paint.js drawGraphic). */
function paint(g, aspect) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(64, Math.round(1024 / aspect));
  const x = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  drawGraphic(x, c.width, c.height, g, null); tex.needsUpdate = true;
  if (g.imageSrc) { const img = new Image(); img.onload = () => { drawGraphic(x, c.width, c.height, g, img); tex.needsUpdate = true; }; img.src = `${g.imageSrc}?v=${g.imageVersion || 0}`; }
  return tex;
}
function adMaterial(g, aspect, side = THREE.FrontSide) {
  const map = paint(g, aspect);
  const m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0, roughness: 0.78, metalness: 0, side, transparent: g.opacity < 1 });
  m.userData.shared = true;   // used by several meshes: given back once, with the fleet (parts.houseMats)
  return m;
}

// ------------------------------------------------------------------ the fleet
function dispose() {
  if (!parts) return;
  for (const o of parts.objects) { group.remove(o); o.geometry.dispose(); for (const m of [].concat(o.material)) { if (m.userData.shared) continue; m.map?.dispose(); m.dispose(); } }
  for (const m of parts.houseMats || []) { m.map?.dispose(); m.dispose(); }
  parts = null;
}
function build() {
  dirty = false; dispose(); fleet = [];
  if (!P.config) return;
  const g = app.city?.g; if (!g) return;
  const T = app.terrain, sea = T?.params?.seaLevel ?? -2.4;
  withGround = !!T?.ground;
  const ground = withGround ? (x, z) => Math.max(sea, T.pointHeight(x, z)) : null;   // (one point each: heightAt would build a terrain chunk per sample)
  const buildings = (S.world.buildings || []).filter(B => B && !B.gone && B.type !== 'park').map(B => { const f = footprint(B); return { x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, top: buildingTop(B) + (B.base || 0) }; });
  // the balloons drift along the world's own prevailing wind (the same on every screen)
  const seed = [...String(S.world.terrain?.seed || 'city')].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7) >>> 0, wind = (seed % 6283) / 1000;
  const list = resolvePromoAircraftFleet(P.config); if (!list.length) return;
  // the whole fleet planned together: each its own circuit and height, apart from all the others
  const plans = planFleet(list, { city: viewRect(S.world), buildings, ground, seaLevel: sea, wind, seed });
  const furn = makeFurnMat({ lit: true });
  parts = { objects: [], kinds: {}, houseMats: [] };
  const add = (geo, mat, n, shadow = false) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = shadow; group.add(im); parts.objects.push(im); return im; };
  for (const id of Object.keys(PROMO_TYPE)) {
    const mine = list.filter(e => e.typeId === id); if (!mine.length) continue;
    // no advertisement set yet: the world's own name, in each kind's own colours (an administrator's choice wins)
    const own = mine[0].settings, plain = !promoAircraftGraphicIsVisible(own), unset = own.backgroundColor === '#ffffff' && own.textColor === '#111827';
    const house = { bannerPlane: ['#ffd166', '#1d3557'], blimp: ['#1d3557', '#ffffff'], hotAirBalloon: ['#ffffff', '#c0392b'] }[id];
    const set = plain ? { ...own, text: S.world.name || document.title.replace(/\s*[—|-].*$/, '') || 'My Virtual World', opacity: 1, ...(unset ? { backgroundColor: house[0], textColor: house[1] } : {}) } : own;
    const ad = true, K = { id, set, ad, n: mine.length, size: SIZE[id], house: {}, surf: [] };
    // each aircraft's own ad surfaces (its own graphic, or its kind's)
    const own1 = (geo, surf, aspect) => { const m = new THREE.Mesh(geo, K.house[surf] || (K.house[surf] = adMaterial(set, aspect))); m.matrixAutoUpdate = false; m.frustumCulled = false; group.add(m); parts.objects.push(m); return m; };
    if (id === 'bannerPlane') {
      // the body, and its propeller turning on its nose under a faint blur (2026-10-14: it stood still under a disc)
      K.body = add(bannerPlane({ noProp: true }), furn, mine.length, true);
      K.blades = add(rotorBlades(PROP_ROTOR), furn, mine.length, true);
      K.prop = add(blurDisc(PROP_ROTOR.R * 1.02, PROP_ROTOR.axis), blurMaterial(PROP_ROTOR.tip), mine.length); K.prop.material.opacity = blurOpacity(0.85, PROP_ROTOR.blur);
      if (ad) {
        // each plane's banner (re-laid each frame along its path) and one set of lines for all the ropes
        const N = BANNER.segs, n = mine.length;
        K.banners = [];
        for (let a = 0; a < n; a++) {
          const pos = new Float32Array(2 * (N + 1) * 2 * 3), uv = [], idx = [];
          for (let face = 0; face < 2; face++) {
            const base = face * (N + 1) * 2;
            for (let k = 0; k <= N; k++) { const u = face ? 1 - k / N : k / N; uv.push(u, 1, u, 0); }
            // each face wound to face its own side (the left face to the plane's left, the right face to its right)
            for (let k = 0; k < N; k++) { const q = base + k * 2; if (face) idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); else idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
          }
          const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx);
          const m = new THREE.Mesh(bg, K.house.banner || (K.house.banner = adMaterial(set, BANNER.len / BANNER.h))); m.frustumCulled = false; m.castShadow = true; group.add(m); parts.objects.push(m);
          K.banners.push(m);
        }
        const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6 * 3), 3));
        K.rope = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x3a3d42 })); K.rope.frustumCulled = false; group.add(K.rope); parts.objects.push(K.rope);
      }
    } else if (id === 'blimp') {
      K.body = add(blimp(), furn, mine.length, true);
      if (ad) { const g = blimpPanels(); K.house.panels = adMaterial(set, BLIMP_PANEL_ASPECT); K.panels = mine.map(() => own1(g, 'panels', BLIMP_PANEL_ASPECT)); }
    } else {
      K.body = add(balloon(), furn, mine.length, true);
      K.rig = add(balloonBannerRig(), furn, mine.length);
      K.flame = add(new THREE.ConeGeometry(0.45, 2.2, 10).translate(0, 3.55, 0), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), mine.length);
      if (ad) { const gb = balloonBand(), gh = balloonBanner(); K.house.band = adMaterial(set, BALLOON_BAND_ASPECT); K.house.hang = adMaterial(set, BALLOON_BANNER_ASPECT); K.band = mine.map(() => own1(gb, 'band', BALLOON_BAND_ASPECT)); K.hang = mine.map(() => own1(gh, 'hang', BALLOON_BANNER_ASPECT)); }
      // each balloon its own colours
      const hues = ['#d9343a', '#f28c28', '#2a9d8f', '#3a6ea5', '#8e44ad', '#e9c46a'];
      mine.forEach((e, i) => K.body.setColorAt(i, new THREE.Color(hues[(i + seed) % hues.length])));
    }
    parts.kinds[id] = K;
    parts.houseMats.push(...Object.values(K.house));
    mine.forEach((e, k) => {
      // an aircraft with its own advertisement (Marketing) shows it in the house's turns; the others their kind's
      const ownSet = e.settings.own && promoAircraftGraphicIsVisible(e.settings) ? e.settings : null;
      const house = ownSet ? {} : null;
      if (house) { for (const [surf, asp] of [['banner', BANNER.len / BANNER.h], ['panels', BLIMP_PANEL_ASPECT], ['band', BALLOON_BAND_ASPECT], ['hang', BALLOON_BANNER_ASPECT]]) house[surf] = adMaterial(ownSet, asp); parts.houseMats.push(...Object.values(house)); }
      fleet.push({ id, K, k, i: e.index, plan: plans[list.indexOf(e)], def: PROMO_TYPE[id], url: (ownSet || own).websiteUrl, house, x: 0, y: 0, z: 0, slot: `aircraft:${e.id}`, label: `${PROMO_TYPE[id].label}`, c: null, next: 0 });
    });
    builtVer++;
  }
}
function flying() {
  if (!P.config?.enabled) return false;
  const h = S.hour ?? 12, { from, to } = P.schedule || { from: 7, to: 21 };
  return from <= to ? h >= from && h < to : h >= from || h < to;
}
function update() {
  if (!app.city?.g || !S.world) return;
  if (!withGround && app.terrain?.ground) dirty = true;   // plan again once the ground's heights are known
  if (dirty) build();
  const show = on && flying() && fleet.length > 0 && !!parts;
  group.visible = show;
  if (!show) return;
  const t = app.net?.realNow ? app.net.realNow() : performance.now() / 1000, night = GU.uNight.value;
  const n = {};
  for (const a of fleet) {
    const K = a.K, D = a.def, u = lapAt(a.plan, D, t), s = sampleFlight(a.plan, u), k = n[a.id] = (n[a.id] ?? -1) + 1, sc = K.size;
    a.x = s.x; a.y = s.y; a.z = s.z;
    if (a.id === 'hotAirBalloon') {
      // a balloon turns slowly as it drifts and sways a little; the burner flares now and then
      const yaw = t * 0.025 + a.plan.phase * 6.28, sway = Math.sin(t * 0.4 + a.i) * 0.025;
      _q.setFromEuler(_e.set(sway, yaw, Math.cos(t * 0.33 + a.i) * 0.025)); _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(sc, sc, sc));
      K.body.setMatrixAt(k, _m); K.rig.setMatrixAt(k, _m); K.band?.[a.k].matrix.copy(_m); K.hang?.[a.k].matrix.copy(_m);
      const cyc = (t + a.plan.phase * 37) % 23, burn = cyc < 3.2 ? 1 : 0, fl = burn ? 0.85 + 0.3 * Math.sin(t * 31 + a.i) : 0.001;
      K.flame.setMatrixAt(k, _m2.compose(_p, _q, _s.set(sc * fl, sc * fl, sc * fl)));
    } else {
      const bank = bankFor(D, s.turn);
      _q.setFromEuler(_e.set(0, s.heading, bank)); _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(sc, sc, sc));
      K.body.setMatrixAt(k, _m); K.panels?.[a.k].matrix.copy(_m);
      if (K.blades) {   // (a steady 40 rad/s on the shared clock: under the step at which it would seem to turn backwards)
        const at = PROP_ROTOR.at;
        K.blades.setMatrixAt(k, _m2.multiplyMatrices(_m, _mr.makeRotationZ((t * 40 + a.i * 1.7) % (Math.PI * 2)).setPosition(at[0], at[1], at[2])));
        K.prop.setMatrixAt(k, _m2.multiplyMatrices(_m, _mr.makeTranslation(at[0], at[1], at[2])));
      }
      if (K.banners) layBanner(a, k, u, s, t);
    }
  }
  for (const K of Object.values(parts.kinds)) {
    for (const im of [K.body, K.blades, K.prop, K.rig, K.flame]) if (im) { im.count = n[K.id] + 1; im.instanceMatrix.needsUpdate = true; }
    if (K.banners) { for (const m of K.banners) { m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); } K.rope.geometry.attributes.position.needsUpdate = true; }
    // the blimp's panels are lit at night; the cloth only glows a little where the city's lights catch it
    for (const list of [K.panels, K.band, K.hang, K.banners]) if (list) for (const m of list) m.material.emissiveIntensity = night * (K.id === 'blimp' ? 0.7 : 0.12);
  }
  showOwn();
}
/** Each aircraft shows its own graphic (or its kind's), laid on its surfaces once the fleet is (re)built. */
function showOwn() {
  if (shownVer === builtVer) return;
  shownVer = builtVer;
  for (const a of fleet) {
    const K = a.K, put = (mesh, surf) => { if (mesh) mesh.material = a.house?.[surf] || K.house[surf]; };
    put(K.banners?.[a.k], 'banner'); put(K.panels?.[a.k], 'panels'); put(K.band?.[a.k], 'band'); put(K.hang?.[a.k], 'hang');
  }
}
/** A plane's banner: the cloth trailing behind along the plane's own path, hanging below it, rippling toward its tail. */
function layBanner(a, k, u, s, t) {
  const K = a.K, sc = K.size, N = BANNER.segs, P = K.banners[a.k].geometry.attributes.position.array, R = K.rope.geometry.attributes.position.array;
  const tail = 4.21 * sc, rope = BANNER.rope * sc, L = BANNER.len * sc, H = BANNER.h * sc;   // (tail: the tow hook, under the rudder)
  const pts = [];
  for (let j = 0; j <= N; j++) {
    const d = tail + rope + L * j / N, q = sampleFlight(a.plan, u - d / a.plan.len), lx = Math.cos(q.heading), lz = -Math.sin(q.heading);
    // the ripple grows toward the free end; the cloth sags a little below the tow line
    const f = j / N, flap = Math.sin(t * 7.5 - j * 0.85 + a.i) * 0.5 * sc * f ** 1.3, top = s.y - 2.2 * sc - 1.2 * sc * Math.sin(Math.PI * Math.min(1, (d - tail) / (rope + L * 0.25))) * 0.4;
    pts.push({ x: q.x + lx * flap, z: q.z + lz * flap, y: top, lx, lz });
  }
  for (let face = 0; face < 2; face++) {
    const off = face ? -0.03 : 0.03, base = face * (N + 1) * 2 * 3;
    pts.forEach((p, j) => { const o = base + j * 6; P[o] = p.x + p.lx * off; P[o + 1] = p.y; P[o + 2] = p.z + p.lz * off; P[o + 3] = p.x + p.lx * off; P[o + 4] = p.y - H; P[o + 5] = p.z + p.lz * off; });
  }
  // the tow rope from the hook under the tail to the banner's leading pole, and the pole itself
  const hx = s.x - Math.sin(s.heading) * tail, hz = s.z - Math.cos(s.heading) * tail, hy = s.y + 0.31 * sc, p0 = pts[0], o = k * 18;
  R.set([hx, hy, hz, p0.x, p0.y, p0.z, hx, hy, hz, p0.x, p0.y - H, p0.z, p0.x, p0.y + 0.4, p0.z, p0.x, p0.y - H - 0.4, p0.z], o);
}
/** Player mode: the aircraft at the screen's centre (within 700 m) offers E: open its link (its ad's, or its own). */
function playerTarget() {
  if (!group?.visible || !fleet.length || !app.stage?.camera) return null;
  const cam = app.stage.camera, dir = _p.set(0, 0, -1).applyQuaternion(cam.quaternion).clone(), o = cam.position;
  let best = null, bd = Infinity;
  for (const a of fleet) {
    const r = { bannerPlane: 12, blimp: 28, hotAirBalloon: 18 }[a.id] * a.K.size, c = new THREE.Vector3(a.x, a.y + (a.id === 'hotAirBalloon' ? 14 : 0), a.z), v = c.clone().sub(o), along = v.dot(dir);
    if (along <= 0 || along > 700) continue;
    const off = v.sub(dir.clone().multiplyScalar(along)).length();
    if (off < r && along < bd) { bd = along; best = a; }
  }
  if (!best) return null;
  const url = best.url, host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
  if (!url) return null;
  return { d: 1.95, html: `Open link <span class="dim">· ${host}</span>`, act: () => { window.open(url, '_blank', 'noopener,noreferrer'); } };
}
/** A click near an aircraft with a website offers to open it (in a new tab, never automatically). */
function onClick(e) {
  if (!group?.visible || !fleet.length) return false;
  const ray = app.cam.rayAt(e.clientX, e.clientY);
  let best = null, bd = Infinity;
  for (const a of fleet) {
    const r = { bannerPlane: 9, blimp: 26, hotAirBalloon: 16 }[a.id] * a.K.size, c = _p.set(a.x, a.y + (a.id === 'hotAirBalloon' ? 14 : 0), a.z), d = ray.distanceSqToPoint(c);
    if (d < r * r && ray.origin.distanceTo(c) < bd) { bd = ray.origin.distanceTo(c); best = a; }
  }
  if (!best) return false;
  if (!best.url) return false;
  if (confirm(`Visit ${new URL(best.url).hostname}? It opens in a new tab.`)) window.open(best.url, '_blank', 'noopener,noreferrer');
  return true;
}
