// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The part of the screen a phone's keyboard leaves (Chrome on Android lays the keyboard over the page): --kb is how
// much of the bottom it covers and --vvh the height still visible, so sheets and bars fixed to the bottom (the lot card,
// the building bar, the merge bar) sit above it and the field being typed in stays in view.
let on = false;
export function watchKeyboard() {
  if (on || !window.visualViewport) return;
  on = true;
  const vv = window.visualViewport, root = document.documentElement;
  const upd = () => { root.style.setProperty('--kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`); root.style.setProperty('--vvh', `${Math.round(vv.height)}px`); };
  vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); upd();
  document.addEventListener('focusin', e => { const t = e.target; if (t && t.matches?.('input, textarea, select') && t.closest('#lotcard, #placebar, #mergebar')) setTimeout(() => t.scrollIntoView({ block: 'nearest' }), 350); });
}
