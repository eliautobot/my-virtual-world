// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character customizer: live 3D preview (render/char-preview.js: its own small renderer running the same instanced
// character shader and rig), every appearance option and random looks. Edits residents (person.set), creates new ones (person.add) and
// styles the player character (saved in this browser).
import { S, bus, select } from '../core/state.js';
import { studioAgentAt } from '../core/agent-view.js';
import { post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import {
  SKIN, HAIR_COLORS, HAIR_STYLES, TOP_STYLES, BOTTOM_STYLES, ACCESSORIES, FACIAL, TOP_COLORS, BOTTOM_COLORS,
  SHOE_COLORS, ACCENT_COLORS, EYE_COLORS, CHARACTERS, randomAppearance, sanitizeAppearance, arrToApp,
} from '/shared/appearance.js';
import { RNG } from '/shared/rng.js';
import { CharPreview } from '../render/char-preview.js';

const LS = 'mvw.player';
const ROWS = [
  ['Skin', 'color', 'skin', SKIN],
  ['Hair', 'chips', 'hairStyle', HAIR_STYLES],
  ['Hair color', 'color', 'hair', HAIR_COLORS],
  ['Top', 'chips', 'topStyle', TOP_STYLES],
  ['Top color', 'color', 'top', TOP_COLORS],
  ['Bottom', 'chips', 'bottomStyle', BOTTOM_STYLES],
  ['Bottom color', 'color', 'bottom', BOTTOM_COLORS],
  ['Shoes', 'color', 'shoes', SHOE_COLORS],
  ['Accent', 'color', 'accent', ACCENT_COLORS],
  ['Accessory', 'chips', 'acc', ACCESSORIES],
  ['Facial hair', 'chips', 'facial', FACIAL],
  ['Eyes', 'color', 'eyes', EYE_COLORS],
  ['Height', 'range', 'height', [0.85, 1.12, 0.01]],
  ['Build', 'range', 'build', [0.85, 1.2, 0.01]],
];
const PV_ANIMS = [['idle', 'Idle'], ['walk', 'Walk'], ['wave', 'Wave'], ['dance', 'Dance'], ['cheer', 'Cheer']];

/** The player's own look (stored in this browser). */
export function loadLook() {
  try {
    const j = JSON.parse(localStorage.getItem(LS) || 'null');
    if (j && j.app) return { name: String(j.name || 'You').slice(0, 32), app: sanitizeAppearance(j.app) };
  } catch { /* corrupt entry: make a new one */ }
  const look = { name: 'You', app: sanitizeAppearance(randomAppearance(new RNG('player:' + Math.floor(Math.random() * 1e9)))) };
  saveLook(look);
  return look;
}
export function saveLook(look) {
  try { localStorage.setItem(LS, JSON.stringify({ name: look.name, app: look.app })); } catch { /* storage full / blocked */ }
}

let app, M = null, pv = null;

export function init(a) {
  app = a;
  app.openCustomizer = open;
  app.closeCustomizer = close;
  app.hooks.key.unshift(e => {
    if (!M) return false;
    if (e.key === 'Escape') close();
    return true;          // swallow world shortcuts while the dialog is open
  });
  window.addEventListener('resize', () => { if (M && pv) pv.resize(); });
}

const charLabel = c => (c[0] === 'm' ? 'Male ' : 'Female ') + Number(c.slice(1));
function charHtml() {
  const grp = (t, list) => `<div class="cgroup"><span class="cgt">${t}</span><div class="chars" data-k="char">${list.map(c => `<span class="chip cchip" data-v="${c}">${charLabel(c).replace(/^\w+ /, '')}</span>`).join('')}</div></div>`;
  return `<div class="field wide"><label>Character</label>
    ${grp('Male', CHARACTERS.filter(c => c[0] === 'm'))}${grp('Female', CHARACTERS.filter(c => c[0] === 'f'))}</div>`;
}
function rowHtml([label, kind, key, list]) {
  if (kind === 'chips') return `<div class="field"><label>${label}</label><div class="chips" data-k="${key}">${list.map((n, v) => `<span class="chip" data-v="${v}">${esc(n)}</span>`).join('')}</div></div>`;
  if (kind === 'range') return `<div class="field"><label>${label} <b data-out="${key}"></b></label><input type="range" data-k="${key}" min="${list[0]}" max="${list[1]}" step="${list[2]}"></div>`;
  return `<div class="field"><label>${label}</label><div class="swatches" data-k="${key}">${list.map(c => `<span class="sw" data-v="${c}" style="background:${c}" title="${c}"></span>`).join('')}<input type="color" data-k="${key}" title="Custom color"></div></div>`;
}

function open(o = {}) {
  // an AI agent this account manages is dressed in its Agent Studio (2026-10-07: everything about it in one place)
  if (o.kind === 'person' && S.people[o.i]?.v && app.studio) {
    const rec = studioAgentAt(S.agentList, o.i);
    if (rec) { app.studio.open(rec.id, 'look'); return; }
  }
  if (M) close();
  const kind = o.kind === 'person' || o.kind === 'new' ? o.kind : 'player';
  let name = '', look;
  if (kind === 'person') {
    const p = S.people[o.i]; if (!p) return;
    name = p.n; look = sanitizeAppearance(arrToApp(p.a));
  } else if (kind === 'new') {
    look = sanitizeAppearance(randomAppearance(new RNG('new:' + Date.now())));
    const c = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]; look.char = c; look.body = c[0] === 'f' ? 1 : 0;
  }
  else { const L = loadLook(); name = L.name; look = L.app; }
  const title = kind === 'person' ? `Customize ${name}` : kind === 'new' ? 'New resident' : 'Your character';
  // an AI agent's name is its record's (the Agent Studio renames it, and its body follows): here only its look changes
  const agentBody = kind === 'person' && !!S.people[o.i]?.v;
  const el = document.getElementById('ui').appendChild(h(`<div class="modal-back"><div class="modal panel" role="dialog" aria-label="${esc(title)}">
    <div class="preview"><div class="chips pv-anims">${PV_ANIMS.map(([k, t]) => `<span class="chip${k === 'idle' ? ' on' : ''}" data-anim="${k}">${t}</span>`).join('')}</div>
      <div class="pv-hint">Drag to turn</div><div class="pname"></div></div>
    <div class="form scroll"><h3>${esc(title)}</h3>
      <div class="field"><label>Name</label><input class="input cname" maxlength="32" spellcheck="false" placeholder="${kind === 'new' ? 'Random name' : 'Name'}" value="${esc(name)}"${agentBody ? ' disabled title="An agent is renamed in its Agent Studio"' : ''}></div>
      ${charHtml()}
      <div class="soon-box"><div class="soon-h">Appearance options <span class="soon-badge">Coming soon</span></div>
        <div class="hint">Skin, hair, clothes, colours, accessories and body shape will be editable again for the new characters. They are switched off for now.</div>
        <div class="soon" inert aria-disabled="true">${ROWS.map(rowHtml).join('')}</div></div>
      ${kind === 'new' ? '<div class="hint">New residents move into a free apartment and look for a job on their own.</div>' : ''}
      ${kind === 'player' ? '<div class="hint">This is you in Play mode. It is saved in this browser.</div>' : ''}
      <div class="row actions"><button class="btn rand">🎲 Random</button><span class="spacer"></span><button class="btn cancel">Cancel</button><button class="btn primary save">${kind === 'new' ? 'Create' : 'Save'}</button></div>
    </div></div></div>`));
  M = { kind, i: o.i, agentBody, look, el, name: el.querySelector('.cname'), pname: el.querySelector('.pname'), busy: false, keys: app.cam.keysEnabled };
  app.custOpen = true; app.cam.keysEnabled = false;
  if (!pv) pv = new CharPreview();
  pv.spin = true; pv.setClip('idle');
  pv.mount(el.querySelector('.preview'));
  sync(); pv.start();
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('pointerdown', e => { if (e.target === el) M.downOut = true; });
  el.addEventListener('pointerup', e => { if (e.target === el && M && M.downOut) close(); if (M) M.downOut = false; });
  M.name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') close(); });
  setTimeout(() => { if (M) { pv.resize(); if (kind !== 'player' && !agentBody) M.name.focus(); } }, 30);
}

function sync() {
  const L = M.look;
  for (const box of M.el.querySelectorAll('.swatches[data-k]')) {
    const k = box.dataset.k, v = String(L[k]).toLowerCase();
    for (const s of box.querySelectorAll('.sw')) s.classList.toggle('on', s.dataset.v.toLowerCase() === v);
    box.querySelector('input[type=color]').value = v;
  }
  for (const c of M.el.querySelectorAll('.cchip')) c.classList.toggle('on', c.dataset.v === (L.char || ''));
  for (const box of M.el.querySelectorAll('.chips[data-k]')) for (const c of box.children) c.classList.toggle('on', +c.dataset.v === L[box.dataset.k]);
  for (const r of M.el.querySelectorAll('input[type=range][data-k]')) {
    r.value = String(L[r.dataset.k]);
    const out = M.el.querySelector(`[data-out="${r.dataset.k}"]`);
    if (out) out.textContent = Math.round(L[r.dataset.k] * 100) + '%';
  }
  M.pname.textContent = M.name.value.trim() || (M.kind === 'new' ? 'New resident' : '');
  pv.setLook(M.look);
}

function onClick(e) {
  if (!M) return;
  const t = e.target;
  const an = t.closest('[data-anim]');
  if (an) { for (const c of an.parentElement.children) c.classList.toggle('on', c === an); pv.setClip(an.dataset.anim); return; }
  const cc = t.closest('.cchip');
  if (cc) { M.look.char = cc.dataset.v; if (cc.dataset.v) M.look.body = cc.dataset.v[0] === 'f' ? 1 : 0; sync(); return; }
  if (t.closest('.soon')) return;
  const sw = t.closest('.sw');
  if (sw) { M.look[sw.parentElement.dataset.k] = sw.dataset.v; sync(); return; }
  const chip = t.closest('.chips[data-k] > .chip');
  if (chip) { M.look[chip.parentElement.dataset.k] = +chip.dataset.v; sync(); return; }
  if (t.closest('.rand')) {
    const c = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    M.look = sanitizeAppearance({ ...M.look, char: c, body: c[0] === 'f' ? 1 : 0 }); sync(); return;
  }
  if (t.closest('.cancel')) { close(); return; }
  if (t.closest('.save')) save();
}
function onInput(e) {
  if (!M) return;
  const t = e.target;
  if (t === M.name) { M.pname.textContent = t.value.trim() || (M.kind === 'new' ? 'New resident' : ''); return; }
  const k = t.dataset.k; if (!k) return;
  M.look[k] = t.type === 'range' ? +t.value : t.value;
  sync();
}

async function save() {
  if (!M || M.busy) return;
  const look = sanitizeAppearance(M.look), name = M.name.value.trim(), kind = M.kind;
  if (kind === 'player') {
    const L = { name: name || 'You', app: look };
    saveLook(L);
    app.player?.setLook?.(L);
    app.toast('Looking good!', 'good', 1800);
    close();
    return;
  }
  M.busy = true;
  M.el.querySelector('.save').disabled = true;
  try {
    if (kind === 'person') {
      const op = { op: 'person.set', i: M.i, app: look };
      if (name && !M.agentBody) op.name = name;
      await post('/api/edit', { ops: [op], who: 'web' });
      app.toast(`Saved ${name || S.people[M.i]?.n || ''}`, 'good', 1800);
      close();
    } else {
      const r = await post('/api/edit', { ops: [{ op: 'person.add', name, app: look }], who: 'web' });
      const nm = r && r.results && r.results[0] && r.results[0].name;
      app.toast(`👋 Welcome to the city, ${nm || 'neighbour'}! They will find a home and a job.`, 'good', 3200);
      if (nm) {
        // the WebSocket patch often lands before this HTTP response: look first, then wait for it
        const find = () => [...S.people].reverse().find(q => q && q.n === nm);
        const got = find();
        if (got) setTimeout(() => select(got.i, { fly: true }), 400);
        else {
          let tm = 0;
          const off = bus.on('people', () => {
            const p = find();
            if (p) { off(); clearTimeout(tm); setTimeout(() => select(p.i, { fly: true }), 400); }
          });
          tm = setTimeout(off, 10000);
        }
      }
      close();
    }
  } catch (err) {
    app.toast(err.message || String(err), 'bad', 2600);
    if (M) { M.busy = false; M.el.querySelector('.save').disabled = false; }
  }
}

function close() {
  if (!M) return;
  pv && pv.stop();
  M.el.remove();
  app.cam.keysEnabled = M.keys;
  M = null;
  app.custOpen = false;
}
