// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The message rail (docs/features/CHAT.md §12; 2026-10-08: "the lines on the side that represent every message the
// user sends, for going back to a previous one — the classic release has this working pretty well"): a short tick at the chat's right
// edge for each message the person sent (the newest 40), the one at the top of the view highlighted as it scrolls; hover
// (or tap, on a touch screen) shows them as a list of previews; a click glides back to that message. Behaviour after
// the classic release's chat-prompt-navigation (itself after Hermes Desktop's prompt rail); written for this window.
const MAX = 40, PREVIEW = 110, CLOSE_MS = 160, GLIDE_MS = 180;
const preview = t => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > PREVIEW ? `${s.slice(0, PREVIEW - 1).trimEnd()}…` : s; };

export class Rail {
  /** scroller: the element that scrolls; host: where the rail is placed (positioned); onJump: before a jump (stop
   *  following the newest). */
  constructor(scroller, host, { onJump = () => {} } = {}) {
    Object.assign(this, { scroller, onJump, entries: [], active: -1, closeT: null, frame: 0, glide: 0, pointing: false, wasOpen: false });
    this.nav = document.createElement('nav');
    this.nav.className = 'cw-rail'; this.nav.hidden = true; this.nav.setAttribute('aria-label', 'Your messages in this chat');
    this.pop = document.createElement('div'); this.pop.className = 'cw-rail-pop'; this.pop.setAttribute('role', 'list');
    this.ticks = document.createElement('div'); this.ticks.className = 'cw-rail-ticks';
    this.nav.append(this.pop, this.ticks);
    host.appendChild(this.nav);
    const coarse = () => matchMedia('(pointer: coarse)').matches;
    this.nav.addEventListener('mouseenter', () => { if (!coarse()) this.open(); });
    this.nav.addEventListener('mouseleave', () => { if (!coarse()) this.closeSoon(); });
    // (a tap also focuses the line: the list opens on focus from the keyboard only, or a tap would open it and jump at once)
    this.nav.addEventListener('pointerdown', () => { this.pointing = true; this.wasOpen = this.nav.classList.contains('open'); });
    this.nav.addEventListener('focusin', () => { if (!this.pointing) this.open(); });
    this.nav.addEventListener('focusout', e => { if (!this.nav.contains(e.relatedTarget)) this.closeSoon(); });
    this.nav.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    this.nav.addEventListener('click', e => {
      const b = e.target.closest('[data-k]'), was = this.pointing ? this.wasOpen : this.nav.classList.contains('open');
      this.pointing = false;
      if (!b) return;
      // on a touch screen the first tap on a tick opens the list; a row (or a tick while it is open) jumps
      if (coarse() && b.classList.contains('cw-rail-tick') && !was) { this.open(); return; }
      this.jump(Number(b.dataset.k));
    });
    this.nav.addEventListener('pointerover', e => { const b = e.target.closest('[data-k]'); if (b) this.hover(Number(b.dataset.k), true); });
    this.nav.addEventListener('pointerout', e => { const b = e.target.closest('[data-k]'); if (b) this.hover(Number(b.dataset.k), false); });
    this.onScroll = () => { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.track(); }); };
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.away = e => { if (this.nav.classList.contains('open') && !this.nav.contains(e.target)) this.close(); };
    document.addEventListener('pointerdown', this.away, true);
  }
  destroy() { cancelAnimationFrame(this.glide); cancelAnimationFrame(this.frame); clearTimeout(this.closeT); this.scroller.removeEventListener('scroll', this.onScroll); document.removeEventListener('pointerdown', this.away, true); this.nav.remove(); }
  /** The person's messages as drawn now: [{ el, text }] (oldest first). */
  set(list) {
    this.entries = list.filter(x => x.el && preview(x.text)).slice(-MAX).map(x => ({ el: x.el, text: preview(x.text) }));
    this.nav.hidden = !this.entries.length;
    this.ticks.innerHTML = this.entries.map((x, k) => `<button type="button" class="cw-rail-tick" data-k="${k}" aria-label="Go to your message: ${esc(x.text)}"><span></span></button>`).join('');
    if (this.nav.classList.contains('open')) this.rows();
    this.active = -1; this.track();
  }
  rows() { this.pop.innerHTML = this.entries.map((x, k) => `<button type="button" class="cw-rail-row" role="listitem" data-k="${k}" data-noicon><span>${esc(x.text)}</span></button>`).join(''); this.mark(); }
  open() {
    if (this.nav.hidden) return;
    clearTimeout(this.closeT);
    if (!this.nav.classList.contains('open')) { this.rows(); this.nav.classList.add('open'); }
    // the list opens to the side with room, as tall as the chat allows (inside it: never off its edges)
    const r = this.nav.getBoundingClientRect(), box = this.nav.offsetParent?.getBoundingClientRect() || { left: 0, height: innerHeight };
    this.pop.style.width = `${Math.max(170, Math.min(300, r.left - box.left - 16))}px`;
    this.pop.style.maxHeight = `${Math.max(96, Math.min(340, box.height - 24))}px`;
    this.pop.querySelector('.cw-rail-row.on')?.scrollIntoView({ block: 'nearest' });
  }
  closeSoon() { clearTimeout(this.closeT); this.closeT = setTimeout(() => this.close(), CLOSE_MS); }
  close() { clearTimeout(this.closeT); this.nav.classList.remove('open'); }
  hover(k, on) { this.ticks.children[k]?.classList.toggle('hov', on); this.pop.children[k]?.classList.toggle('hov', on); }
  /** The message at the top of the view (or the newest when the view is at the bottom). */
  track() {
    if (!this.entries.length) return;
    const s = this.scroller, top = s.getBoundingClientRect().top;
    let k = -1, first = -1;
    if (s.scrollHeight - s.scrollTop - s.clientHeight < 40) k = this.entries.length - 1;
    else this.entries.forEach((x, i) => { if (!x.el.isConnected) return; if (first < 0) first = i; if (x.el.getBoundingClientRect().top - top <= 12) k = i; });
    if (k < 0) k = Math.max(0, first);
    if (k !== this.active) { this.active = k; this.mark(); }
  }
  mark() {
    [...this.ticks.children].forEach((b, i) => { b.classList.toggle('on', i === this.active); if (i === this.active) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    [...this.pop.children].forEach((b, i) => b.classList.toggle('on', i === this.active));
  }
  jump(k) {
    const x = this.entries[k];
    if (!x || !x.el.isConnected) return;
    this.onJump();
    cancelAnimationFrame(this.glide);
    const s = this.scroller, from = s.scrollTop, to = Math.max(0, from + x.el.getBoundingClientRect().top - s.getBoundingClientRect().top - 10), t0 = performance.now();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || Math.abs(to - from) < 2) s.scrollTop = to;
    else { const step = now => { const p = Math.min(1, (now - t0) / GLIDE_MS); s.scrollTop = from + (to - from) * (1 - (1 - p) ** 3); if (p < 1) this.glide = requestAnimationFrame(step); }; this.glide = requestAnimationFrame(step); }
    x.el.classList.add('flash'); setTimeout(() => x.el.classList.remove('flash'), 1400);
    this.active = k; this.mark();
    this.closeSoon();
  }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }
