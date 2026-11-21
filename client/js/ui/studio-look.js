// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Customize tab (ui/agent-studio.js; 2026-10-07: "everything about the agent in the Agent Studio"):
// its look, chosen on the stage itself. Two ways (2026-11-18: the character builder is the characters' new foundation):
// - Build its own (ui/studio-build.js, the builder in client/js/builder/): body, face, hair and clothes, saved as a
//   character of its own that moves with every clip of the city's (baked by the server, tools/chars/custom-kind.mjs);
//   "In the city" shows it as the city draws it, in its poses.
// - Ready-made: every original character as a portrait (client/assets/chars/portraits, made by tools/chars/portraits.mjs);
//   pointing at one tries it on the stage, a click picks it.
// Saving is the editor's person.set with only the look — allowed for the agent's owner and accounts that manage it
// (server/lot-rights.js).
import { S } from '../core/state.js';
import { esc } from '../core/util.js';
import { CHARACTERS, sanitizeAppearance, arrToApp, isCustomChar } from '/shared/appearance.js';
import { buildPanel, closeBuild, showCity } from './studio-build.js';

const POSES = [['idle', 'Stand'], ['walk', 'Walk'], ['wave', 'Wave'], ['dance', 'Dance'], ['cheer', 'Cheer'], ['sit_relax', 'Sit'], ['phone_look', 'Phone', 'phone'], ['idle_hold', 'Coffee', 'coffee']];
const num = c => String(Number(c.slice(1)));
const lookOf = i => sanitizeAppearance(arrToApp(S.people[i].a));

export async function lookTab(C, body, live) {
  if (!live()) return;
  if (C.i < 0) { body.innerHTML = '<p class="hint">It has no body in the city to dress.</p>'; return; }
  const saved = lookOf(C.i);
  const st = C.st.look = C.st.look && C.st.look.i === C.i ? C.st.look : { i: C.i, draft: { ...saved }, pose: 'idle', mode: 'build', city: false };
  const may = C.manage;
  const modes = `<div class="lk-modes" role="tablist" aria-label="How to choose its look">
      <button type="button" role="tab" class="lk-mode${st.mode === 'build' ? ' on' : ''}" data-mode="build" aria-selected="${st.mode === 'build'}">✨ Build its own</button>
      <button type="button" role="tab" class="lk-mode${st.mode === 'ready' ? ' on' : ''}" data-mode="ready" aria-selected="${st.mode === 'ready'}">🧍 Ready-made</button></div>`;
  const poses = `<div class="lk-poses" role="group" aria-label="Pose">${POSES.map(([k, t]) => `<button type="button" class="lk-pose${st.pose === k ? ' on' : ''}" data-pose="${k}">${t}</button>`).join('')}</div>`;
  const pose = POSES.find(p => p[0] === st.pose) || POSES[0];
  if (st.mode === 'build') {
    // the builder (its stage over the Studio's), or the character it built as the city draws it, moving
    body.innerHTML = `<div class="lk lk-build">${modes}
      <div class="lk-top"><div><h3>🎨 Build ${esc(C.name)}'s character</h3><p class="hint">${may ? 'Shape the body, then the face, hair and clothes. Saved, it becomes a character of its own that walks, sits, eats, swims and dances like everyone in the city.' : 'Only its owner, or someone it is shared with to manage it, changes its look.'}</p></div>
        <div class="lk-poses" role="group" aria-label="Stage"><button type="button" class="lk-pose${st.city ? '' : ' on'}" data-city="0">✏️ Builder</button><button type="button" class="lk-pose${st.city ? ' on' : ''}" data-city="1"${isCustomChar(saved.char) ? '' : ' disabled title="Save it first"'}>▶ In the city</button></div></div>
      ${st.city ? poses : ''}
      <div class="lk-builder"></div></div>`;
    const box = body.querySelector('.lk-builder');
    body.querySelector('.lk-build').addEventListener('click', e => {
      const m = e.target.closest('[data-mode]'), c = e.target.closest('[data-city]'), ps = e.target.closest('[data-pose]');
      if (m && m.dataset.mode !== st.mode) { st.mode = m.dataset.mode; closeBuild(C, st); st.city = false; C.repaint(); }
      else if (c && !c.disabled) { st.city = c.dataset.city === '1'; showCity(C, st, st.city); if (st.city) { C.pv?.setLook(lookOf(C.i)); C.pose(pose[0], pose[2] || 'none'); } C.repaint(); }
      else if (ps) { st.pose = ps.dataset.pose; const p = POSES.find(x => x[0] === st.pose); C.pose(p[0], p[2] || 'none'); C.repaint(); }
    });
    if (st.city) { C.pv?.setLook(lookOf(C.i)); C.pose(pose[0], pose[2] || 'none'); }
    await buildPanel(C, box, live, {
      look: saved, st,
      save: async look => {
        const r = await C.call('/api/edit', { ops: [{ op: 'person.set', i: C.i, app: look }], who: 'web' }, `${C.name}'s new character is saved`);
        if (r && r.ok === false) { C.say(r.error || 'It could not be saved', true); return false; }
        if (!r) return false;
        C.pv?.setLook(look);
        // shown at once as the city draws it, waving (then back to the builder's stage when the owner wants to edit)
        st.city = true; showCity(C, st, true); C.pose('wave'); setTimeout(() => C.tab === 'look' && C.pose(pose[0], pose[2] || 'none'), 2200);
        C.repaint();
        return true;
      },
    });
    if (st.city) showCity(C, st, true);
    return;
  }
  // ---- ready-made characters
  const dirty = () => st.draft.char !== lookOf(C.i).char;
  const show = look => C.pv?.setLook(look);
  const group = (title, list) => `<div class="lk-group"><div class="lk-gh">${title}</div><div class="lk-grid">${list.map(c => `<button type="button" class="lk-char${c === st.draft.char ? ' on' : ''}${c === saved.char ? ' cur' : ''}" data-char="${c}" title="${title.replace(/s$/, '')} ${num(c)}"${may ? '' : ' disabled'}>
      <img src="/assets/chars/portraits/${c}.webp" alt="" loading="lazy" draggable="false"><span>${num(c)}</span>${c === saved.char ? '<i>now</i>' : ''}</button>`).join('')}</div></div>`;
  if (isCustomChar(st.draft.char) && !isCustomChar(saved.char)) st.draft = { ...saved };
  body.innerHTML = `<div class="lk">${modes}
    <div class="lk-top"><div><h3>🎨 How ${esc(C.name)} looks</h3><p class="hint">${may ? 'Point at a character to try it on, click to choose it, then save. The stage shows it as it will look in the city.' : 'Only its owner, or someone it is shared with to manage it, changes its look.'}</p></div>
      ${poses}</div>
    ${isCustomChar(saved.char) ? '<p class="hint">It wears a character built for it now (✨ Build its own). Choosing one here replaces it; the built one can be opened again from Build.</p>' : ''}
    ${group('Women', CHARACTERS.filter(c => c[0] === 'f'))}${group('Men', CHARACTERS.filter(c => c[0] === 'm'))}
    ${may ? `<div class="sp-save${dirty() ? ' dirty' : ''}"><span>${dirty() ? 'Unsaved: a new look' : 'Saved'}</span><button type="button" class="btn small" data-c="surprise">🎲 Surprise me</button><button type="button" class="btn small" data-c="undo"${dirty() ? '' : ' disabled'}>Undo</button><button type="button" class="btn primary" data-c="save"${dirty() ? '' : ' disabled'}>Save its look</button></div>` : ''}
  </div>`;
  show(st.draft);
  C.pose(pose[0], pose[2] || 'none');
  const grid = body.querySelector('.lk');
  grid.addEventListener('pointerover', e => { const b = e.target.closest('[data-char]'); if (b && may) show(withChar(st.draft, b.dataset.char)); });
  grid.addEventListener('pointerout', e => { const b = e.target.closest('[data-char]'); if (b && !b.contains(e.relatedTarget)) show(st.draft); });
  grid.addEventListener('click', async e => {
    const m = e.target.closest('[data-mode]'), ch = e.target.closest('[data-char]'), ps = e.target.closest('[data-pose]'), cmd = e.target.closest('[data-c]')?.dataset.c;
    if (m) { if (m.dataset.mode !== st.mode) { st.mode = m.dataset.mode; show(lookOf(C.i)); C.repaint(); } return; }
    if (ch && may) { st.draft = withChar(st.draft, ch.dataset.char); C.pose('wave'); setTimeout(() => C.tab === 'look' && C.pose(pose[0], pose[2] || 'none'), 1800); C.repaint(); return; }
    if (ps) { st.pose = ps.dataset.pose; C.repaint(); return; }
    if (cmd === 'surprise') { const pool = CHARACTERS.filter(c => c !== st.draft.char); st.draft = withChar(st.draft, pool[Math.floor(Math.random() * pool.length)]); C.pose('cheer'); C.repaint(); return; }
    if (cmd === 'undo') { st.draft = { ...lookOf(C.i) }; C.repaint(); return; }
    if (cmd === 'save') {
      const r = await C.call('/api/edit', { ops: [{ op: 'person.set', i: C.i, app: sanitizeAppearance(st.draft) }], who: 'web' }, `${C.name}'s new look is saved`);
      if (r && r.ok !== false) { C.pose('cheer'); setTimeout(() => C.tab === 'look' && C.repaint(), 900); }
      else if (r && r.ok === false) C.say(r.error || 'It could not be saved', true);
    }
  });
}
/** Leaving the tab: the builder is closed and the stage shows the saved look again (a draft waits for the way back). */
export function leaveLook(C) {
  closeBuild(C, C.st.look);
  if (C.st.look) C.st.look.city = false;
  if (C.i >= 0) C.pv?.setLook(lookOf(C.i));
}
const withChar = (look, c) => sanitizeAppearance({ ...look, char: c, body: c[0] === 'f' ? 1 : 0 });
