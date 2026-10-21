// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Phone tab (docs/features/phone.md): the agent's phone (./phone-app.js) — given a Twilio number here,
// then its texts, calls, voicemail, contacts and settings. The same phone shows in the chat window's side panel.
import { mountPhone } from './phone-app.js';

export async function phoneTab(C, body, live) {
  if (!live()) return;
  C.phone?.destroy();
  body.innerHTML = '<div class="st-phone"><div class="ph-host"></div></div>';
  C.phone = mountPhone(body.querySelector('.ph-host'), C.id, { toast: C.toast });
}
/** Leaving the tab (or closing the Studio): the phone stops following its frames. */
export function leavePhone(C) { C.phone?.destroy(); C.phone = null; }
