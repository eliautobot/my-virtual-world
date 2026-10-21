// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Optional performance readout (Settings → General): frame rate, the slowest recent frame, slow frames, character
// loading, the driving physics in use, ping and the longest wait for car data (sent late by the server, or arrived
// late: held up on the way or by this device), so performance on a particular device can be seen and reported.
import { bus } from '../core/state.js';

export const PERF_HUD_KEY = 'mvw.perfHud';
const WINDOW_MS = 5000;

export function init(app) {
  let el = null, timer = null;
  const dts = [];
  bus.on('postframe', (dt, now) => { if (!el) return; dts.push([now, dt * 1000]); while (dts.length && now - dts[0][0] > WINDOW_MS) dts.shift(); });
  const render = () => {
    const worst = dts.reduce((m, d) => Math.max(m, d[1]), 0), slow = dts.filter(d => d[1] > 33).length;
    const ch = app.agents?.chars, loaded = ch?.kinds?.filter(Boolean).length || 0, queued = ch?.uploads?.length || 0;
    const d = app.driving, physics = !d?.id ? '-' : d.simState === 'on' ? 'this device' : d.simState === 'off' ? 'server' : 'starting…';
    const cg = d?.carGap?.(), cars = cg ? `\ncar data gap ${Math.round(cg.ms)} ms${cg.ms > 150 ? (cg.server ? ' (sent late)' : ' (arrived late)') : ''} · car buffer ${Math.round(d.otherDelay?.value || 0)} ms` : '';
    el.textContent = `${Math.round(app.fps || 0)} fps · slowest ${Math.round(worst)} ms · slow frames ${slow}/5 s\n`
      + `characters ${loaded}${queued ? ` (+${queued} uploading)` : ''} · driving ${physics} · ping ${Math.round((app.net?.rtt || 0) * 1000)} ms`
      + (app.autoRes ? ` · resolution ${Math.round(app.autoRes.scale * 100)}%${app.autoRes.on ? '' : ' (fixed)'}` : '') + cars;
  };
  const set = on => {
    if (on && !el) {
      el = document.createElement('div'); el.className = 'perf-hud';
      Object.assign(el.style, { position: 'fixed', left: '8px', bottom: '8px', zIndex: 60, pointerEvents: 'none', whiteSpace: 'pre', font: '11px/1.35 ui-monospace,monospace',
        color: '#fff', background: 'rgba(0,0,0,.6)', padding: '4px 7px', borderRadius: '6px' });
      document.body.appendChild(el); timer = setInterval(render, 500); render();
    } else if (!on && el) { clearInterval(timer); el.remove(); el = null; dts.length = 0; }
  };
  bus.on('perfhud', set);
  set(localStorage.getItem(PERF_HUD_KEY) === '1');
}
