// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island's picture from above (terrain, water, beaches, fields - no roads), shared by the minimap's island view
// (ui/ui.js) and the world map (ui/worldmap.js). The terrain worker paints it - slowly: several seconds, more while it
// is also building terrain tiles (2026-10-05: the minimap took too long to switch to the island) - so it is built
// once per land, as soon as the world is up, and kept in the browser (IndexedDB) under a key made from the land itself:
// the next visit shows it at once, and a changed land (a terrain stroke, a coast) gets a new one.
// A quick small picture comes first; the sharp one follows in thin strips, so the worker builds tiles in between.
import { S, bus } from '../core/state.js';

const QUICK = 320, ROWS = 48, DB = 'mvw-island-pictures', STORE = 'p';
let app = null, cur = null;   // { key, bounds, quick, sharp, done, listeners, loading }

/** FNV-1a of a string, as hex: the land's key. */
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }
function idb() {
  return new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(STORE); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function load(key) {
  try { const db = await idb(); return await new Promise(res => { const t = db.transaction(STORE).objectStore(STORE).get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); } catch { return null; }
}
async function save(key, blob) {
  try {
    const db = await idb(), st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    st.put(blob, key);
    // keep only the last few lands
    const keys = await new Promise(res => { const t = st.getAllKeys(); t.onsuccess = () => res(t.result || []); t.onerror = () => res([]); });
    for (const k of keys.filter(k => k !== key).slice(0, Math.max(0, keys.length - 3))) st.delete(k);
  } catch { /* private browsing: just not kept */ }
}
const toCanvas = r => { const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; c.getContext('2d').putImageData(new ImageData(r.px, r.w, r.h), 0, 0); return c; };

/** The best picture so far for the current land: { canvas, bounds, sharp } or null; onReady(fn) when it improves. */
export function islandPicture() {
  start();
  if (!cur) return null;
  const c = cur.sharp || cur.quick;
  return c ? { canvas: c, bounds: cur.bounds, sharp: !!cur.sharp && cur.done, partial: cur.partial || 0 } : null;
}
/** Calls fn() whenever the picture gets better (or the land changes); returns an unsubscribe. */
export function onIslandPicture(fn) { start(); const L = (cur ??= { listeners: new Set() }).listeners || (cur.listeners = new Set()); L.add(fn); return () => L.delete(fn); }
const tell = () => { for (const f of cur?.listeners || []) { try { f(); } catch { /* a listener's own problem */ } } };

/** Begins (or keeps) building the picture of the current land. */
export function start() {
  const T = app?.terrain;
  if (!T?.map || !S.world?.terrain) return;
  const N = matchMedia('(pointer: coarse)').matches ? 1024 : 1536;
  const key = `${hash(JSON.stringify(S.world.terrain))}:${N}`;
  if (cur?.key === key) return;
  const listeners = cur?.listeners || new Set();
  cur = { key, bounds: T.landBounds(), quick: null, sharp: null, done: false, listeners, partial: 0 };
  const me = cur;
  (async () => {
    const kept = await load(key);
    if (kept && me === cur) {
      const bmp = await createImageBitmap(kept), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      me.sharp = c; me.done = true; tell(); return;
    }
    const b = me.bounds;
    const r = await T.map(b, QUICK, QUICK); if (me !== cur) return;
    me.quick = toCanvas(r); tell();
    const hi = document.createElement('canvas'); hi.width = N; hi.height = N; const hc = hi.getContext('2d');
    for (let y = 0; y < N; y += ROWS) {
      const rows = Math.min(ROWS, N - y), z0 = b.z0 + (b.z1 - b.z0) * y / N, z1 = b.z0 + (b.z1 - b.z0) * (y + rows) / N;
      const s = await T.map({ x0: b.x0, x1: b.x1, z0, z1 }, N, rows); if (me !== cur) return;
      hc.putImageData(new ImageData(s.px, s.w, s.h), 0, y);
      me.partial = (y + rows) / N;
      if ((y / ROWS) % 6 === 5) { me.strips = hi; tell(); }
    }
    me.sharp = hi; me.done = true; tell();
    hi.toBlob(blob => { if (blob) save(key, blob); }, 'image/webp', 0.9);
  })().catch(e => console.warn('[island picture]', e.message));
}
export function initIslandPicture(a) {
  app = a;
  bus.on('terrain', () => setTimeout(start, 500));   // the land changed: a new picture (or the kept one for that land)
  start();
}
/** While the sharp picture arrives in strips: the strips so far and the share done (for drawing over the quick one). */
export function islandStrips() { return cur && !cur.done && cur.strips ? { canvas: cur.strips, rows: cur.partial } : null; }
