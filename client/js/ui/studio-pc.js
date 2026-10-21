// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's PC tab (docs/features/agent-pc.md): the agent's own PC (./pc-app.js) — its files, board, calendar,
// browser, teams, activity, terminal and settings — with a button for the PC in its own big window.
import { bus } from '../core/state.js';
import { mountPc, openPcWindow } from './pc-app.js';

export async function pcTab(C, body, live) {
  if (!live()) return;
  C.pc?.destroy();
  body.innerHTML = '<div class="st-pc"><div class="pc-full"><button class="pc-btn" data-desk="1" title="Its PC on its own screen in the world: its desk, or the laptop it is on">💻 Use at its desk</button> <button class="pc-btn" data-win="1" title="The PC in its own window">↗ Full screen</button></div><div class="pc-host"></div></div>';
  C.pc = mountPc(body.querySelector('.pc-host'), { agent: C.id, lock: true, toast: C.toast });
  body.querySelector('[data-win]').addEventListener('click', () => openPcWindow(C.id, { lock: false, toast: C.toast }));
  body.querySelector('[data-desk]').addEventListener('click', () => bus.emit('pc:use', C.id));
}
/** Leaving the tab (or closing the Studio): the PC stops following its frames. */
export function leavePc(C) { C.pc?.destroy(); C.pc = null; }
