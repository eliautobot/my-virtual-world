// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A sign's panel (both editions; render/signs.js opens it when someone taps a sign that shows its own design rather
// than an ad): the design as it stands, its message and "Open link" (a new tab). The sign's owner can design it from
// here (ui/sign-design.js).
// A building's own signs — its rooftop billboards and the signs inside — open its place card too (docs/features/places.md,
// server/places/), the way a map's place does: its stars and reviews, a review of your own (1–5 stars, words if you
// like), and a private message to its owner. Its owner (the city's administrators for the city's own buildings) reads
// those messages here, on its own tab, and nobody else does.
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { bus } from '../core/state.js';
import { AD_ASPECTS, aspectOf } from '/shared/ads.js';
import { hostOf } from '../render/ad-paint.js';
import { getJSON, post } from '../core/net.js';
import { paintPreviews } from './designer.js';

const ASPECT = { asset: AD_ASPECTS.wide, roof: AD_ASPECTS.wide, metro: AD_ASPECTS.portrait };
const STAR_D = 'M12 2.7l2.8 5.95 6.5.72-4.86 4.42 1.35 6.42L12 16.97l-5.79 3.24 1.35-6.42L2.7 9.37l6.5-.72z';
const WORD = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
const svgStar = cls => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_D}"/></svg>`;
/** Five stars filled to v (0–5, fractions too). */
export const starsHtml = (v, cls = '') => `<span class="pl-stars ${cls}" role="img" aria-label="${(+v).toFixed(1)} out of 5" data-noicon><span class="pl-s0">${svgStar('').repeat(5)}</span><span class="pl-s1" style="width:${Math.max(0, Math.min(100, (v / 5) * 100)).toFixed(1)}%">${svgStar('').repeat(5)}</span></span>`;
const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : s < 86400 * 30 ? `${Math.floor(s / 86400)} d ago` : new Date(ms).toLocaleDateString(); };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A name's round initial, its colour from the name (the same name, the same colour). */
const avatar = name => { let x = 0; for (const c of String(name)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return `<span class="pl-av" style="--hue:${x % 360}" aria-hidden="true">${esc((String(name).trim()[0] || '?').toUpperCase())}</span>`; };

let current = null;   // the open panel ({ b, refresh(), close() }): live frames and "open this place" reach it

/**
 * o: { cr (the design, or null), title, mine (the viewer owns it), kind ('asset' | 'metro' | 'roof' | 'indoor' | 'place'),
 *      shape, edit(), hide, b (the building's index: its place card), tab ('overview' | 'reviews' | 'messages' | 'write') }.
 */
export function openSignPanel(app, o) {
  current?.close();
  const el = document.body.appendChild(h('<div class="modal-back lib-back shop-back"><div class="panel libdlg shopdlg addlg pl-dlg" role="dialog" aria-modal="true" aria-label="Sign"></div></div>'));
  const box = el.querySelector('.addlg'), cr = o.cr, host = hostOf(cr?.website), asp = o.shape ? aspectOf(o.shape) : ASPECT[o.kind] || AD_ASPECTS.landscape;
  const placeOn = Number.isInteger(o.b) && o.b >= 0;
  const V = { tab: placeOn && ['reviews', 'messages', 'write', 'message'].includes(o.tab) ? o.tab : 'overview', place: null, loading: placeOn, sort: 'new', more: [], inbox: null, draft: { stars: 0, text: '' }, msg: '', busy: false, err: null };
  const offs = [];
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); offs.forEach(f => f?.()); if (current?.el === el) current = null; };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); if (V.tab === 'write' || V.tab === 'message') { V.tab = V.tab === 'write' ? 'reviews' : 'overview'; paint(); } else close(); } };
  document.addEventListener('keydown', onKey, true);

  // ------------------------------------------------------------------------------------------------ the place's data
  async function load({ keepMore = false } = {}) {
    if (!placeOn) return;
    try {
      const p = await getJSON(`/api/places/place/${o.b}?sort=${V.sort}`);
      V.place = p; V.err = null;
      if (!keepMore) V.more = [];
      if (p.myReview && !p.myReview.hidden && V.tab !== 'write') V.draft = { stars: p.myReview.stars, text: p.myReview.text };
      if (V.tab === 'messages' && p.mine) await loadInbox();
      if ((V.tab === 'messages' && !p.mine) || ((V.tab === 'write' || V.tab === 'message') && !p.signedIn)) V.tab = 'overview';
    } catch (e) { V.err = e.message; }
    V.loading = false;
    paint();
  }
  async function loadInbox() {
    try {
      const r = await getJSON(`/api/places/messages?b=${o.b}`);
      V.inbox = r.messages || [];
      if (r.unread) { post('/api/places/messages/read', { b: o.b }).then(() => { if (V.place?.inbox) V.place.inbox.unread = 0; paintTabs(); }).catch(() => {}); }
    } catch (e) { V.inbox = []; app.toast?.(e.message, 'bad', 3000); }
  }
  const P = () => V.place;

  // ------------------------------------------------------------------------------------------------ painting
  const ratingLine = () => {
    const p = P(); if (!p) return V.loading ? '<div class="pl-rate dim">Loading reviews…</div>' : '';
    const r = p.rating;
    return `<button type="button" class="pl-rate" data-tab="reviews" title="See the reviews">${r.n ? `<b>${r.avg.toFixed(1)}</b>${starsHtml(r.avg)}<span class="dim">(${r.n})</span>` : `${starsHtml(0)}<span class="dim">No reviews yet</span>`}</button>
      <span class="pl-owner dim">${p.owner.kind === 'account' ? `Owned by ${esc(p.owner.name)}` : esc(p.owner.name)}</span>`;
  };
  const tabsHtml = () => {
    if (!placeOn) return '';
    const p = P(), n = p?.rating.n || 0, unread = p?.inbox?.unread || 0, t = V.tab === 'write' ? 'reviews' : V.tab === 'message' ? 'overview' : V.tab;
    return `<div class="pl-tabs" role="tablist">
      <button type="button" role="tab" class="pl-tab${t === 'overview' ? ' on' : ''}" aria-selected="${t === 'overview'}" data-tab="overview">Overview</button>
      <button type="button" role="tab" class="pl-tab${t === 'reviews' ? ' on' : ''}" aria-selected="${t === 'reviews'}" data-tab="reviews">Reviews${n ? ` <span class="pl-n">${n}</span>` : ''}</button>
      ${p?.mine ? `<button type="button" role="tab" class="pl-tab${t === 'messages' ? ' on' : ''}" aria-selected="${t === 'messages'}" data-tab="messages">Messages${unread ? ` <span class="pl-n hot">${unread}</span>` : p.inbox?.total ? ` <span class="pl-n">${p.inbox.total}</span>` : ''}</button>` : ''}
    </div>`;
  };
  const actionsHtml = () => {
    const p = P(); if (!p) return '';
    if (p.mine) return `<div class="pl-acts"><button type="button" class="pl-act" data-tab="messages"><span class="pl-ai">✉</span><span>Messages${p.inbox?.unread ? ` · ${p.inbox.unread} new` : ''}</span></button><button type="button" class="pl-act" data-tab="reviews"><span class="pl-ai">★</span><span>Reviews</span></button></div>
      <p class="hint pl-own">This is your place: visitors rate it here and leave you messages only you can read.</p>`;
    const mine = p.myReview;
    return `<div class="pl-acts">
      <button type="button" class="pl-act" data-a="write"><span class="pl-ai">${mine ? '✏️' : '★'}</span><span>${mine ? 'Your review' : 'Leave a review'}</span></button>
      ${p.owner.kind !== 'none' ? '<button type="button" class="pl-act" data-a="message"><span class="pl-ai">✉</span><span>Message the owner</span></button>' : ''}
    </div>`;
  };
  const overviewHtml = () => `
    ${cr ? `<canvas class="ad-big${asp < 1 ? ' tall' : ''}" data-ad="0" data-aspect="${asp}"${asp < 1 ? ` style="width:min(300px, 70%, ${Math.round(440 * asp)}px)"` : ''}></canvas>` : o.kind === 'place' ? '' : `<p class="hint">${o.mine ? 'Nothing on it yet: design it.' : 'Nothing on this sign yet.'}</p>`}
    ${cr?.message ? `<p class="ad-msg">${esc(cr.message)}</p>` : ''}
    ${cr?.website ? `<button type="button" class="btn primary ad-visit" data-a="visit">🌐 Open link · ${esc(host)} ↗</button>` : ''}
    ${placeOn ? actionsHtml() : `<p class="hint">${esc(o.title || '')}</p>`}
    ${o.hide ? `<div class="shop-note">${o.hide.blocked ? `<span>Hidden by an administrator: ${esc(o.hide.blocked)}</span><div class="row"><button type="button" class="btn small" data-a="unhide">Show it again</button></div>` : '<span>Administrators: a sign that breaks the rules can be hidden (its owner reads the reason).</span><div class="row wrap"><input class="input sp-why" maxlength="200" placeholder="Why it is hidden"><button type="button" class="btn small danger" data-a="hide">Hide it</button></div>'}</div>` : ''}`;
  const reviewHtml = (r, p) => `<div class="pl-rev${r.hidden ? ' gone' : ''}" data-id="${r.id}">
      <div class="pl-rh">${avatar(r.author.name)}<div class="pl-rn"><b data-noicon>${esc(r.author.name)}${r.mine ? ' <span class="pl-you">You</span>' : ''}</b><span class="pl-rm">${starsHtml(r.stars, 'sm')}<span class="dim">${ago(r.updated)}${r.edited ? ' · edited' : ''}</span></span></div>
      ${p.can.moderate && !r.mine ? (r.hidden ? `<button type="button" class="btn small" data-a="unhide-rev" data-id="${r.id}">Show again</button>` : `<button type="button" class="btn small pl-mod" data-a="hide-rev" data-id="${r.id}" title="Take this review down (its author reads why)">Take down</button>`) : ''}</div>
      ${r.text ? `<p class="pl-rt" data-noicon>${esc(r.text)}</p>` : ''}
      ${r.hidden ? `<p class="pl-hid">Taken down by an administrator: ${esc(r.hidden)}</p>` : ''}
    </div>`;
  const reviewsHtml = () => {
    const p = P(); if (!p) return V.err ? `<p class="hint bad">${esc(V.err)}</p>` : '<p class="hint">Loading…</p>';
    const r = p.rating, max = Math.max(1, ...r.dist);
    const summary = r.n ? `<div class="pl-sum"><div class="pl-big"><b>${r.avg.toFixed(1)}</b>${starsHtml(r.avg)}<span class="dim">${plural(r.n, 'review')}</span></div>
      <div class="pl-bars">${[5, 4, 3, 2, 1].map(k => `<div class="pl-bar"><span>${k}</span><i><em style="width:${Math.round((r.dist[k - 1] / max) * 100)}%"></em></i><span class="dim">${r.dist[k - 1]}</span></div>`).join('')}</div></div>`
      : '<div class="pl-empty"><span class="pl-ai big">★</span><b>No reviews yet</b><span class="dim">Be the first to say what you think of it.</span></div>';
    const mine = p.myReview;
    const me = p.mine ? '' : !p.signedIn ? '<div class="pl-cta"><span>Been here? Sign in to rate it.</span><button type="button" class="btn small primary" data-a="signin">Sign in</button></div>'
      : mine ? `<div class="pl-mine"><div class="pl-mh"><b>Your review</b>${mine.hidden ? '' : '<span class="grow"></span><button type="button" class="btn small" data-a="write">✏️ Edit</button><button type="button" class="btn small" data-a="unreview">Delete</button>'}</div>${reviewHtml(mine, { can: {} })}</div>`
      : p.can.review ? '<div class="pl-cta"><span>Been here? Share what you think.</span><button type="button" class="btn small primary" data-a="write">★ Leave a review</button></div>' : '';
    const list = [...p.reviews, ...V.more].filter(x => !x.mine);
    const sort = r.n > 1 ? `<div class="pl-sort" role="radiogroup" aria-label="Sort reviews">${[['new', 'Newest'], ['high', 'Highest'], ['low', 'Lowest']].map(([k, t]) => `<button type="button" class="btn small${V.sort === k ? ' on' : ''}" role="radio" aria-checked="${V.sort === k}" data-sort="${k}">${t}</button>`).join('')}</div>` : '';
    return `${summary}${me}${sort}<div class="pl-list">${list.map(x => reviewHtml(x, p)).join('')}</div>
      ${p.more || (V.more.length && V.moreLeft) ? '<button type="button" class="btn small pl-morebtn" data-a="more">Show more reviews</button>' : ''}
      ${p.hidden?.length ? `<details class="pl-hidden"><summary>${plural(p.hidden.length, 'review')} taken down</summary>${p.hidden.map(x => reviewHtml(x, p)).join('')}</details>` : ''}`;
  };
  const writeHtml = () => {
    const p = P(), d = V.draft, mine = p?.myReview;
    return `<div class="pl-write">
      <div class="pl-wh">${avatar(auth.account?.displayName || auth.account?.login || '?')}<div><b data-noicon>${esc(auth.account?.displayName || auth.account?.login || '')}</b><span class="dim">Reviews are public: everyone in the city can read them.</span></div></div>
      <div class="pl-pick" role="radiogroup" aria-label="Your rating" data-noicon>${[1, 2, 3, 4, 5].map(k => `<button type="button" class="pl-pk${k <= d.stars ? ' on' : ''}" role="radio" aria-checked="${k === d.stars}" aria-label="${k} star${k > 1 ? 's' : ''}: ${WORD[k]}" data-star="${k}">${svgStar('')}</button>`).join('')}<span class="pl-word">${d.stars ? WORD[d.stars] : 'Tap a star'}</span></div>
      <textarea class="input pl-ta" maxlength="1000" rows="4" placeholder="What was it like? (optional)">${esc(d.text)}</textarea>
      <div class="pl-wf"><span class="dim pl-count">${d.text.length}/1000</span><span class="grow"></span><button type="button" class="btn" data-a="cancel">Cancel</button><button type="button" class="btn primary" data-a="post"${d.stars ? '' : ' disabled'}>${mine ? 'Save' : 'Post'}</button></div>
    </div>`;
  };
  const messageHtml = () => {
    const p = P();
    return `<div class="pl-write">
      <div class="pl-wh"><span class="pl-ai big">✉</span><div><b>Message ${p?.owner.kind === 'account' ? esc(p.owner.name) : 'the owner'}</b><span class="dim">Private: only ${p?.owner.kind === 'city' ? 'the city\'s administrators' : 'the owner of this place'} can read it. They see your name.</span></div></div>
      <textarea class="input pl-ta" maxlength="1000" rows="5" placeholder="Write your message…">${esc(V.msg)}</textarea>
      <div class="pl-wf"><span class="dim pl-count">${V.msg.length}/1000</span><span class="grow"></span><button type="button" class="btn" data-a="cancel">Cancel</button><button type="button" class="btn primary" data-a="send"${V.msg.trim() ? '' : ' disabled'}>Send</button></div>
    </div>`;
  };
  const messagesHtml = () => {
    if (!V.inbox) return '<p class="hint">Loading…</p>';
    if (!V.inbox.length) return '<div class="pl-empty"><span class="pl-ai big">✉</span><b>No messages</b><span class="dim">When visitors write to you about this place, it shows here. Only you can read them.</span></div>';
    return `<p class="hint pl-own">Only you can read these. Visitors wrote them from this place's billboard.</p><div class="pl-list">${V.inbox.map(m => `<div class="pl-rev pl-msg${m.read ? '' : ' new'}" data-id="${m.id}">
      <div class="pl-rh">${avatar(m.from.name)}<div class="pl-rn"><b data-noicon>${esc(m.from.name)}</b><span class="dim">${ago(m.created)}${m.read ? '' : ' · new'}</span></div><button type="button" class="btn small" data-a="del-msg" data-id="${m.id}" title="Delete this message">Delete</button></div>
      <p class="pl-rt" data-noicon>${esc(m.text)}</p></div>`).join('')}</div>`;
  };
  function paintTabs() { const t = box.querySelector('.pl-tabs'); if (t) t.outerHTML = tabsHtml(); }
  function paint() {
    const title = cr?.title || (P()?.name) || o.title || 'Sign';
    const body = V.tab === 'reviews' ? reviewsHtml() : V.tab === 'messages' ? messagesHtml() : V.tab === 'write' ? writeHtml() : V.tab === 'message' ? messageHtml() : overviewHtml();
    box.setAttribute('aria-label', title);
    box.innerHTML = `<h3><span>🪧 ${esc(title)}</span><button type="button" class="btn small" data-c="close" aria-label="Close">✕</button></h3>
      ${placeOn ? `<div class="pl-head">${ratingLine()}</div>${tabsHtml()}` : ''}
      <div class="pl-body">${body}</div>
      <div class="lib-btns"><button type="button" class="btn" data-c="close">Close</button>${o.mine && o.edit ? '<button type="button" class="btn" data-a="edit">✏️ Design this sign</button>' : ''}</div>`;
    if (cr && V.tab === 'overview') paintPreviews(box, [cr]);
    const ta = box.querySelector('.pl-ta');
    if (ta) {
      ta.addEventListener('input', () => {
        if (V.tab === 'write') V.draft.text = ta.value; else V.msg = ta.value;
        const c = box.querySelector('.pl-count'); if (c) c.textContent = `${ta.value.length}/1000`;
        const send = box.querySelector('[data-a="send"]'); if (send) send.disabled = !ta.value.trim();
      });
    }
  }
  function go(tab) {
    if ((tab === 'write' || tab === 'message') && !auth.account) { auth.ui?.signIn?.(tab === 'write' ? 'Sign in to leave a review' : 'Sign in to message the owner'); return; }
    V.tab = tab;
    if (tab === 'write') { const m = P()?.myReview; V.draft = m && !m.hidden ? { stars: m.stars, text: m.text } : { stars: V.draft.stars || 0, text: V.draft.text || '' }; }
    if (tab === 'messages') { V.inbox = null; loadInbox().then(paint); }
    paint();
    const ta = box.querySelector('.pl-ta'); if (ta && (tab === 'message' || tab === 'write')) ta.focus();
  }
  // (hovering over the stars lights them up to where the pointer is)
  box.addEventListener('pointerover', e => {
    const k = +e.target.closest?.('[data-star]')?.dataset.star || 0; if (!k) return;
    box.querySelectorAll('.pl-pk').forEach(x => x.classList.toggle('hov', +x.dataset.star <= k));
    const w = box.querySelector('.pl-word'); if (w) w.textContent = WORD[k];
  });
  box.addEventListener('pointerout', e => {
    if (!e.target.closest?.('.pl-pick') || e.relatedTarget?.closest?.('.pl-pick')) return;
    box.querySelectorAll('.pl-pk').forEach(x => x.classList.remove('hov'));
    const w = box.querySelector('.pl-word'); if (w) w.textContent = V.draft.stars ? WORD[V.draft.stars] : 'Tap a star';
  });

  el.addEventListener('click', async e => {
    if (e.target === el || e.target.closest('[data-c="close"]')) { close(); return; }
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) { go(tab); return; }
    const star = +e.target.closest('[data-star]')?.dataset.star || 0;
    if (star) { V.draft.stars = star; V.draft.text = box.querySelector('.pl-ta')?.value ?? V.draft.text; paint(); return; }
    const sort = e.target.closest('[data-sort]')?.dataset.sort;
    if (sort && sort !== V.sort) { V.sort = sort; await load(); return; }
    const btn = e.target.closest('[data-a]'), a = btn?.dataset.a;
    if (!a || V.busy) return;
    if (a === 'visit') window.open(cr.website, '_blank', 'noopener,noreferrer');
    else if (a === 'edit') { close(); o.edit(); }
    else if (a === 'signin') auth.ui?.signIn?.('Sign in to leave a review');
    else if (a === 'write' || a === 'message') go(a);
    else if (a === 'cancel') { V.tab = V.tab === 'write' ? 'reviews' : 'overview'; paint(); }
    else if (a === 'post') {
      V.draft.text = box.querySelector('.pl-ta')?.value ?? V.draft.text;
      await act(() => post('/api/places/review', { b: o.b, stars: V.draft.stars, text: V.draft.text }), r => { app.toast?.(P()?.myReview ? 'Your review is updated.' : 'Thanks — your review is posted.', 'good', 2600); V.tab = 'reviews'; return load(); });
    } else if (a === 'unreview') {
      if (!confirm('Delete your review of this place?')) return;
      await act(() => post('/api/places/review/delete', { b: o.b }), () => { app.toast?.('Your review is deleted.', 'good', 2200); V.draft = { stars: 0, text: '' }; return load(); });
    } else if (a === 'send') {
      const text = box.querySelector('.pl-ta')?.value ?? V.msg;
      await act(() => post('/api/places/message', { b: o.b, text }), () => { app.toast?.('Sent — only the owner can read it.', 'good', 2800); V.msg = ''; V.tab = 'overview'; paint(); });
    } else if (a === 'del-msg') {
      const id = +btn.dataset.id;
      await act(() => post('/api/places/messages/delete', { id }), () => { V.inbox = (V.inbox || []).filter(m => m.id !== id); if (V.place?.inbox) V.place.inbox.total = Math.max(0, V.place.inbox.total - 1); paint(); });
    } else if (a === 'hide-rev') {
      const why = prompt('Why is this review taken down? Its author reads this.');
      if (!why?.trim()) return;
      await act(() => post('/api/places/review/hide', { id: +btn.dataset.id, reason: why.trim() }), () => { app.toast?.('Taken down.', 'good', 2000); return load(); });
    } else if (a === 'unhide-rev') await act(() => post('/api/places/review/hide', { id: +btn.dataset.id, show: true }), () => { app.toast?.('Shown again.', 'good', 2000); return load(); });
    else if (a === 'more') {
      const p = P(); if (!p) return;
      await act(() => getJSON(`/api/places/place/${o.b}?sort=${V.sort}&offset=${p.reviews.length + V.more.length}`), r => { V.more.push(...r.reviews); V.moreLeft = r.more; p.more = false; paint(); });
    } else if (a === 'hide' || a === 'unhide') {
      const why = a === 'hide' ? box.querySelector('.sp-why').value.trim() : '';
      if (a === 'hide' && !why) { app.toast('Say why it is hidden; its owner reads it.', 'bad', 3000); return; }
      post('/api/edit', { ops: [{ ...o.hide.op, blocked: why }] }).then(r => { if (r?.ok === false) throw new Error(r.error); app.toast(why ? 'Hidden.' : 'Shown again.', 'good', 2200); close(); }).catch(x => app.toast(x.message, 'bad', 3000));
    }
  });
  async function act(call, then) {
    V.busy = true;
    try { const r = await call(); await then(r); } catch (err) { if (!err.quiet) app.toast?.(err.message || 'That didn\'t work', 'bad', 3600); } finally { V.busy = false; }
  }

  // live: the rating changes while it is open; a new message for the owner
  offs.push(bus.on('msg:place_rating', m => { if (m.b === o.b && V.place && V.tab !== 'write' && V.tab !== 'message') load({ keepMore: false }); }));
  offs.push(bus.on('msg:place_inbox', m => { if (m.b === o.b && V.place?.mine) { if (V.tab === 'messages') loadInbox().then(paint); else load(); } }));
  current = { el, b: placeOn ? o.b : null, close, go };
  paint();
  if (placeOn) load();
  else if (V.tab !== 'overview') go(V.tab);
  return current;
}
/** The panel open on building b, if any: a notification's link turns its tab instead of opening another. */
export function openPanelOn(b) { return current && current.b === b ? current : null; }
