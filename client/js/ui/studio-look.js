// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Customize tab (ui/agent-studio.js; 2026-10-07: "everything about the agent in the Agent Studio"):
// its look, chosen on the stage itself. Every character as a portrait (client/assets/chars/portraits, made by
// tools/chars/portraits.mjs); pointing at one tries it on the stage, a click picks it; poses to see it move; a surprise;
// Save. Saving is the editor's person.set with only the look - allowed for the agent's owner and accounts that manage it
// (server/lot-rights.js). Skin, hair and clothes come back with the new characters (as in the Customizer).
import { S } from '../core/state.js';
import { esc } from '../core/util.js';
import { CHARACTERS, sanitizeAppearance, arrToApp } from '/shared/appearance.js';

const POSES = [['idle', 'Stand'], ['walk', 'Walk'], ['wave', 'Wave'], ['dance', 'Dance'], ['cheer', 'Cheer'], ['phone_look', 'Phone', 'phone'], ['idle_hold', 'Coffee', 'coffee']];
const num = c => String(Number(c.slice(1)));
const lookOf = i => sanitizeAppearance(arrToApp(S.people[i].a));

export async function lookTab(C, body, live) {
  if (!live()) return;
  if (C.i < 0) { body.innerHTML = '<p class="hint">It has no body in the city to dress.</p>'; return; }
  const saved = lookOf(C.i);
  const st = C.st.look = C.st.look && C.st.look.i === C.i ? C.st.look : { i: C.i, draft: { ...saved }, pose: 'idle' };
  const dirty = () => st.draft.char !== lookOf(C.i).char;
  const show = look => C.pv?.setLook(look);
  const may = C.manage;
  const group = (title, list) => `<div class="lk-group"><div class="lk-gh">${title}</div><div class="lk-grid">${list.map(c => `<button type="button" class="lk-char${c === st.draft.char ? ' on' : ''}${c === saved.char ? ' cur' : ''}" data-char="${c}" title="${title.replace(/s$/, '')} ${num(c)}"${may ? '' : ' disabled'}>
      <img src="/assets/chars/portraits/${c}.webp" alt="" loading="lazy" draggable="false"><span>${num(c)}</span>${c === saved.char ? '<i>now</i>' : ''}</button>`).join('')}</div></div>`;
  body.innerHTML = `<div class="lk">
    <div class="lk-top"><div><h3>🎨 How ${esc(C.name)} looks</h3><p class="hint">${may ? 'Point at a character to try it on, click to choose it, then save. The stage shows it as it will look in the city.' : 'Only its owner, or someone it is shared with to manage it, changes its look.'}</p></div>
      <div class="lk-poses" role="group" aria-label="Pose">${POSES.map(([k, t]) => `<button type="button" class="lk-pose${st.pose === k ? ' on' : ''}" data-pose="${k}">${t}</button>`).join('')}</div></div>
    ${group('Women', CHARACTERS.filter(c => c[0] === 'f'))}${group('Men', CHARACTERS.filter(c => c[0] === 'm'))}
    <p class="hint lk-soon">Skin, hair, clothes and colours come back with the new characters.</p>
    ${may ? `<div class="sp-save${dirty() ? ' dirty' : ''}"><span>${dirty() ? 'Unsaved: a new look' : 'Saved'}</span><button type="button" class="btn small" data-c="surprise">🎲 Surprise me</button><button type="button" class="btn small" data-c="undo"${dirty() ? '' : ' disabled'}>Undo</button><button type="button" class="btn primary" data-c="save"${dirty() ? '' : ' disabled'}>Save its look</button></div>` : ''}
  </div>`;
  show(st.draft);
  const pose = POSES.find(p => p[0] === st.pose);
  C.pose(pose[0], pose[2] || 'none');
  const grid = body.querySelector('.lk');
  grid.addEventListener('pointerover', e => { const b = e.target.closest('[data-char]'); if (b && may) show(withChar(st.draft, b.dataset.char)); });
  grid.addEventListener('pointerout', e => { const b = e.target.closest('[data-char]'); if (b && !b.contains(e.relatedTarget)) show(st.draft); });
  grid.addEventListener('click', async e => {
    const ch = e.target.closest('[data-char]'), ps = e.target.closest('[data-pose]'), cmd = e.target.closest('[data-c]')?.dataset.c;
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
/** Leaving the tab with a look not saved: the stage shows the saved one again (the draft waits for the way back). */
export function leaveLook(C) { if (C.i >= 0) C.pv?.setLook(lookOf(C.i)); }
const withChar = (look, c) => sanitizeAppearance({ ...look, char: c, body: c[0] === 'f' ? 1 : 0 });
