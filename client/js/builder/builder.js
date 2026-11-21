// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The character builder on a stage of its own: a body (male or female foundation on the city's 65-bone rig), its
// proportions, face, hair and clothes, edited live; then exported as a kit for the city to bake (./export.js). The
// controls are the caller's (ui/studio-build.js, the Agent Studio's Customize tab); this keeps the model and its undo.
// The studio's own animation previews, joint posing and takes are not part of it: in the city the character moves with
// the city's own clips, baked onto its skeleton (tools/chars/custom-kind.mjs).
import { loadBody, shapeBounds } from './body.js';
import { isJawDetail, fresh, validate, labels, palette } from './state.js';
import { buildFace, faceOptions } from './face.js';
import { faceDials, pupilDials, dialRange, structureGroups, structureSettings } from './face-settings.js';
import { availableStyles, defaultDetailColor } from './face-catalog.js';
import { setEyePose } from './eye-pose.js';
import { buildWardrobe, wardrobeOptions, wearLoaded, wearPacks, loadWear } from './wardrobe.js';
import { referenceLook, referencePiece } from './tripo-collection.js';
import { tripoClothes } from './tripo-cloth-catalog.js';
import { makeStage } from './stage.js';
import { exportKit } from './export.js';

export { labels, palette, faceDials, pupilDials, dialRange, shapeBounds, faceOptions, wardrobeOptions, structureGroups };
export const SHAPE_GROUPS = [['Silhouette', ['height', 'build', 'shoulders', 'chest', 'waist', 'hips']], ['Limbs & head', ['arms', 'legs', 'legLength', 'head', 'hands', 'feet']]];
/** The face's libraries for a sex, in the order they are offered: its structure (sliders, not a library) first; a man's
 *  facial hair (beards with moustaches, stubble and markings) as one. */
export const faceSlots = g => ['structure', 'eyes', ...(g === 'female' ? ['lashes'] : []), 'brows', 'nose', 'mouth', 'ears', g === 'male' ? 'facialHair' : 'detail'];
/** The libraries a face slot shows: facialHair is beards and then moustaches, stubble and markings. */
export const slotLibraries = k => (k === 'facialHair' ? [['beard', 'Beards'], ['detail', 'Moustaches, stubble & markings']] : [[k, null]]);
/** The lash line's thickness (upper, lower): its range. */
export const LASH_LINE = [['upper', 'Upper line thickness', 0.5, 2.5], ['lower', 'Lower line thickness', 0, 2.5]];
/** The collections' pattern files a look's clothes need and that aren't here yet (wardrobe.js loads them when first worn). */
const wearNeeds = (gender, sel) => wearPacks(gender, sel).filter(kind => !wearLoaded(kind));
export const OUTFIT_SLOTS = ['top', 'bottom', 'shoes'];
/** A preset as kept with a look: the builder's state without the studio's posing (its pose, joints, takes, eye motion). */
export function cleanPreset(s) {
  const v = validate(s, false);
  return { format: v.format, version: v.version, gender: v.gender, shape: v.shape, selections: v.selections, faceFit: v.faceFit, colors: v.colors };
}
/** A preset read back (from a saved look), or a fresh one of that sex when it is not one. */
export function readPreset(raw, gender = 'female') {
  try { const v = validate({ ...raw, sourceHead: false, pose: 'studio', overrides: {}, keys: [] }, false); return { ...v, sourceHead: false, pose: 'studio', overrides: {}, keys: [] }; }
  catch { return fresh(gender); }
}

/**
 * Opens the builder on host (an element it fills). o: { preset (a saved one, else fresh), gender, onChange(state),
 * onStatus(text|null) }. → the builder (async: its body loads first).
 */
export async function openBuilder(host, o = {}) {
  const memory = { female: fresh('female'), male: fresh('male') };
  let gender = o.preset?.gender === 'male' || o.gender === 'male' ? 'male' : 'female';
  if (o.preset) memory[gender] = readPreset(o.preset, gender);
  let body = null, face = null, wear = null, token = 0, disposed = false, view = 'body';
  const history = [], future = [];
  const stage = makeStage(host);
  const state = () => memory[gender];
  const copy = x => JSON.parse(JSON.stringify(x));
  const status = t => o.onStatus?.(t);
  const changed = () => o.onChange?.(state());
  function remove(g) {
    if (!g) return;
    if (typeof g.userData.dispose === 'function') g.userData.dispose();
    else {
      const meshes = [], mats = new Set();
      g.traverse(x => { if (x.isMesh) { meshes.push(x); for (const m of [].concat(x.material)) mats.add(m); } });
      for (const x of meshes) body.releaseMesh(x);
      for (const m of mats) m.dispose();
    }
    g.removeFromParent();
  }
  const restEyes = () => { if (face) setEyePose(face.children, 0, 0, 0); };
  function rebuild(kind) {
    const s = state(), colors = { ...s.colors, nose: s.colors.nose || s.colors.skin, ears: s.colors.ears || s.colors.skin };
    if (kind !== 'wear') { remove(face); face = buildFace(body, s.selections, colors, s.faceFit, s.sourceHead); body.root.add(face); }
    if (kind !== 'face') { remove(wear); wear = buildWardrobe(body, s.selections, colors, s.sourceHead); body.root.add(wear); }
    body.setPose('studio', 0, {});
    restEyes();
  }
  /** The Tripo patterns its clothes need, loaded first (once; a few seconds the first time). */
  async function ensureWear() {
    const need = wearNeeds(gender, state().selections);
    if (!need.length) return;
    status('Loading the clothes…');
    try { await loadWear(need); } finally { status(null); }
  }
  function changePart(k) {
    if (OUTFIT_SLOTS.includes(k)) return rebuild('wear');
    const s = state();
    if (face?.userData.update) { face.userData.update(k, s.selections, s.colors, s.faceFit); body.setPose('studio', 0, {}); restEyes(); }
    else rebuild('face');
  }
  const measured = () => { const top = body.parts.head.geometry.boundingBox?.max.y; return Number.isFinite(top) ? top : state().shape.height; };
  function applyAll() {
    body.setShape(state().shape);
    body.setSkinColor(state().colors.skin);
    rebuild();
    stage.measure(measured());
    stage.view(view);
  }
  async function foundation(next) {
    const id = ++token;
    gender = next;
    history.length = future.length = 0;
    if (body) { remove(face); remove(wear); stage.setBody(null); body.dispose(); body = face = wear = null; }
    status(`Loading the ${gender} body…`);
    const [b] = await Promise.all([loadBody(next), ensureWear()]);
    if (id !== token || disposed) { b.dispose(); return; }
    body = b; stage.setBody(b);
    applyAll();
    status(null);
    changed();
  }
  const mark = () => { history.push(copy(state())); if (history.length > 40) history.shift(); future.length = 0; };
  async function step(from, to) {
    if (!body || !from.length) return false;
    to.push(copy(state()));
    memory[gender] = from.pop();
    await ensureWear();
    applyAll(); changed();
    return true;
  }
  const loop = () => { if (!disposed) stage.frame('Hips'); };
  stage.loop(loop);
  await foundation(gender);
  const B = {
    get gender() { return gender; },
    get state() { return state(); },
    get ready() { return !!body; },
    canUndo: () => history.length > 0, canRedo: () => future.length > 0,
    undo: () => step(history, future), redo: () => step(future, history),
    catalog: () => ({ ...faceOptions[gender], ...wardrobeOptions[gender] }),
    /** A library's styles as offered: [[index, name], …] (some are kept only for older presets). */
    styles: k => availableStyles(gender, k, { ...faceOptions[gender], ...wardrobeOptions[gender] }[k] || []),
    /** A piece of the Tripo collection (its source look, its colours), or null. */
    piece: (k, i) => referencePiece(gender, k, i) || null,
    /** The original Tripo looks this body can wear whole: [[source, label], …]. */
    looks: () => tripoClothes[gender].top.map(d => [d.source, d.source.toUpperCase() + ' · ' + d.name]),
    /** Wears an original Tripo look: its hair, top or dress, bottoms and shoes (the face, skin and proportions stay). */
    async applyLook(source) {
      const look = referenceLook(gender, source);
      if (!look) return;
      mark();
      const s = state();
      Object.assign(s.selections, look.selections); Object.assign(s.colors, look.colors); s.sourceHead = false;
      await ensureWear(); rebuild(); changed();
    },
    async setGender(g) { if (g !== gender && (g === 'male' || g === 'female')) await foundation(g); },
    /** A proportion (body.js shapeBounds), live: mark before a drag starts (begin), not on every step. */
    begin: mark,
    setShape(k, v) { state().shape[k] = v; body.setShape({ [k]: v }); stage.measure(measured()); if (['height', 'legLength', 'head'].includes(k)) stage.view(view); changed(); },
    async choose(k, i) {
      const s = state();
      if (s.selections[k] === i) return;
      mark();
      // a full beard and a jaw detail (stubble, a chin patch…) don't go together
      if (gender === 'male' && k === 'beard' && i >= 0 && isJawDetail(s.selections.detail)) { s.selections.detail = -1; changePart('detail'); }
      else if (gender === 'male' && k === 'detail' && isJawDetail(i) && s.selections.beard >= 0) { s.selections.beard = -1; changePart('beard'); }
      const opts = faceOptions[gender];
      // a facial detail left at its own colour takes the next one's own colour (freckles, a beauty mark …)
      if (k === 'detail' && s.colors.detail === defaultDetailColor(opts.detail[s.selections.detail])) s.colors.detail = defaultDetailColor(opts.detail[i]);
      s.selections[k] = i;
      // a piece of the Tripo collection comes in its own colour; a dress is top and bottoms at once
      const piece = referencePiece(gender, k, i);
      if (piece) s.colors[k] = piece.color || piece.palette[0];
      if (k === 'top' && piece?.dress) s.selections.bottom = -1;
      if (k === 'bottom' && i >= 0 && referencePiece(gender, 'top', s.selections.top)?.dress) s.selections.top = -1;
      if (OUTFIT_SLOTS.includes(k)) await ensureWear();
      changePart(k); changed();
    },
    color(k) { const s = state(); return s.colors[k] || (['brows', 'beard'].includes(k) ? s.colors.hair : s.colors.skin); },
    /** The swatches offered for slot k (a woman's facial detail: its own colour first, then the lips'). */
    paletteFor(k) {
      const s = state(), own = k === 'detail' && gender === 'female' ? defaultDetailColor(faceOptions.female.detail[s.selections.detail]) : null;
      return (own && own !== '#623e32' ? [own, ...palette.mouth] : null) || palette[k] || (['nose', 'ears'].includes(k) ? palette.skin : ['detail', 'brows', 'beard', 'lashes'].includes(k) ? palette.hair : palette.cloth);
    },
    setColor(k, hex) { mark(); const s = state(); s.colors[k] = hex; if (k === 'skin') body.setSkinColor(hex); changePart(k); changed(); },
    setFit(k, dial, v) { const s = state(); s.faceFit[k][dial] = v; if (face?.userData.update) face.userData.update(k, s.selections, s.colors, s.faceFit); else rebuild('face'); restEyes(); changed(); },
    /** Facial structure (forehead, cheeks, jaw, chin, upper lip; nose protrusion): -1…1, 0 neutral. */
    setStructure(key, v) { const s = state(); s.faceFit.structure[key] = v; face?.userData.update?.('structure', s.selections, s.colors, s.faceFit); restEyes(); changed(); },
    resetStructure() { mark(); const s = state(); s.faceFit.structure = structureSettings(); face?.userData.update?.('structure', s.selections, s.colors, s.faceFit); restEyes(); changed(); },
    /** The base lash line's thickness (upper 0.5…2.5, lower 0…2.5). */
    setLashLine(edge, v) { const s = state(); s.faceFit.lashLine[edge] = v; changePart('eyes'); restEyes(); changed(); },
    setPupil(key, v) { const s = state(); s.faceFit.pupils[key] = v; face?.userData.update?.('pupils', s.selections, s.colors, s.faceFit); restEyes(); changed(); },
    reset() { mark(); memory[gender] = fresh(gender); applyAll(); changed(); },
    /** Opens a preset in place (the stage kept; its body changed only when the preset's sex differs). */
    async setPreset(p) {
      const g = p?.gender === 'male' ? 'male' : 'female';
      memory[g] = readPreset(p, g);
      if (g !== gender) await foundation(g);
      else { await ensureWear(); applyAll(); changed(); }
    },
    /** Its clothes' patterns loaded (before exporting a kit). */
    loadWear: () => ensureWear(),
    view(v) { view = v; stage.view(v); },
    /** The stage drawn now, as a picture (a data URL): drawn and read in the same task, so the canvas still holds it. */
    snapshot(type = 'image/jpeg', q = 0.85) { stage.frame('Hips'); return stage.renderer.domElement.toDataURL(type, q); },
    spin(on) { stage.spin(on); },
    /** Stops drawing while its stage is hidden (the Studio shows the baked character instead), and starts again. */
    pause(on) { stage.loop(on ? null : loop); },
    preset: () => cleanPreset(state()),
    /** The character as a kit to bake (./export.js): { bytes, stats }. */
    exportKit() { if (!body) throw new Error('The body is still loading'); return exportKit(body, cleanPreset(state())); },
    dispose() {
      disposed = true; token++;
      if (body) { remove(face); remove(wear); stage.setBody(null); body.dispose(); }
      body = face = wear = null;
      stage.dispose();
    },
  };
  return B;
}
