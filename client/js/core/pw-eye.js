// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The eye on password fields (the product owner, 2026-10-09: "add the little eye thing on the password to see/hide the
// password as you are typing it"). Every password field the app shows — signing in, creating an account, changing or
// resetting a password, the keys of stored secrets — gets a button at its right end that shows what was typed and hides
// it again; the field keeps its focus and caret. One observer covers the fields that dialogs and panels add later.
const ICON = {
  show: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  hide: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.1"/><path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>',
};
const SEL = 'input[type="password"]';

/** Gives one password field its eye (once). */
export function addEye(input) {
  if (!input || input.dataset.eye || !input.isConnected) return;
  input.dataset.eye = '1';
  const wrap = document.createElement('span');
  wrap.className = 'pw-eye';
  input.replaceWith(wrap);
  wrap.append(input);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pw-eye-btn';
  const set = shown => {
    input.type = shown ? 'text' : 'password';
    b.innerHTML = shown ? ICON.hide : ICON.show;
    b.setAttribute('aria-label', shown ? 'Hide password' : 'Show password'); b.title = shown ? 'Hide' : 'Show';
    b.setAttribute('aria-pressed', String(shown));
  };
  set(false);
  b.addEventListener('pointerdown', e => e.preventDefault());   // the field keeps its focus (and the phone its keyboard)
  b.addEventListener('click', () => {
    const focused = document.activeElement === input, s = input.selectionStart, e = input.selectionEnd;
    set(input.type === 'password');
    if (focused) { input.focus(); try { input.setSelectionRange(s, e); } catch { /* not every field type keeps a caret */ } }
  });
  // sent hidden, so browsers offer to save it as a password
  input.form?.addEventListener('submit', () => set(false));
  wrap.append(b);
}

let installed = false;
/** Gives every password field, now and later, its eye. */
export function installEyes() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  for (const i of document.querySelectorAll(SEL)) addEye(i);
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches(SEL)) addEye(n); else if (n.firstElementChild) for (const i of n.querySelectorAll(SEL)) addEye(i);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
