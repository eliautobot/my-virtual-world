// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Settings → Agent limits (the product owner, 2026-10-10: "admin controls so that I have control to modify
// these limits at any time"): every limit on agents talking, acting and spending in one place, laid out by direction
// (2026-10-11: switches; people → agents; agents → agents; the world → an agent; an agent → the world; what thinking may
// cost - ./agent-limit-groups.js), the finer ones under "Advanced". Each is an installation setting, saved as it changes
// and read by the server at its next use. The server keeps every value within its range whatever is sent.
import { settingsForm } from './admin.js';
import { AGENT_LIMIT_SECTIONS } from './agent-limit-groups.js';

export async function agentLimitsTab(d, body) {
  const top = body.appendChild(document.createElement('div'));
  await settingsForm(d, top, {
    // (each section: its own short labels; settings the server doesn't have are left out)
    pick: v => {
      const list = rows => (rows || []).map(([p, label]) => { const s = v.settings.find(x => x.path === p); return s && { ...s, label: label || s.label }; }).filter(Boolean);
      return AGENT_LIMIT_SECTIONS.map(sec => [sec.title, sec.hint, list(sec.main), list(sec.advanced)]);
    },
    extra: () => '<p class="hint">Changes apply at once, to every agent. Each value stays within its range whatever is typed.</p>',
  });
}
