// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Modelled animals' clip timing (render/fauna-skinned.js), kept apart so it can be tested without a browser.

/**
 * Per-animal motion state that keeps an animal's clip continuous (2026-11-11, the owner: "the repetition of the
 * animations isn't smooth"): a new speed changes the rate without jumping to another frame (the cycle offset is moved so
 * the current frame stays), and a new clip cross-fades from the old one. motion(state, mode, rate, now, seed) -> the
 * values for put(): { off, rate, mode, prev }.
 */
export function motion(st, mode, rate, now, seed) {
  if (!st.init) { Object.assign(st, { init: true, mode, rate, off: seed % 1, prev: null }); return st; }
  if (mode !== st.mode) {
    st.prev = [st.off, st.rate, st.mode, now];
    st.mode = mode; st.rate = rate; st.off = (seed - now * rate) % 1;   // the new clip from a fresh start, the herd out of step
  } else if (Math.abs(rate - st.rate) > 1e-4) {
    const at = now * st.rate + st.off;                                   // where in the cycle it is now
    st.off = (at - now * rate) % 1; st.rate = rate;
  }
  if (st.prev && now - st.prev[3] > 1) st.prev = null;
  return st;
}

