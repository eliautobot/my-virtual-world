// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The designer (both editions): a design for an ad or a sign (shared/ads.js normalizeAdCreative) with live previews in
// every shape it will be shown in - a logo or picture beside a title on a colour, or a full picture (a wide one, and a
// tall one for tall signs), a message and a link for when someone taps it. The ad builder (ui/ads.js), owners' rooftop
// billboards and signs inside (ui/sign-design.js) and the Marketing tools' own content all use it, so what is designed
// is exactly what stands in the world (render/ad-paint.js paints both).
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { AD_LIMITS, AD_ASPECTS, aspectOf, normalizeAdCreative } from '/shared/ads.js';
import { drawCreative, drawHouse, loadImage, pictureFor } from '../render/ad-paint.js';

/** The shapes, their aspect, the preview's frame and its caption. */
const SHAPE = {
  wide: { a: AD_ASPECTS.wide, frame: 'bb', label: 'Billboard' },
  portrait: { a: AD_ASPECTS.portrait, frame: 'tall', label: 'Street sign' },
  landscape: { a: AD_ASPECTS.landscape, frame: 'plain', label: 'Wide sign' },
  banner: { a: AD_ASPECTS.banner, frame: 'cloth', label: 'Banner plane' },
  blimp: { a: AD_ASPECTS.blimp, frame: 'cloth', label: 'Blimp' },
};

/** A shape's preview: a named one's, or a sign's own shape ('x<aspect>': a plain panel, tall ones kept narrow). */
const shapeOf = sh => SHAPE[sh] || { a: aspectOf(sh), frame: 'plain', label: 'Your sign', own: true };
/** The size a picture for an aspect is best uploaded at (px). */
const bestPx = a => (a >= 1 ? `${1800} × ${Math.round(1800 / a)}` : `${Math.round(1500 * a)} × ${1500}`);

/** Paints every <canvas data-ad="i"> in root with list[i] (a design, or null for "Advertise here") at its shape. */
export function paintPreviews(root, list) {
  for (const c of root.querySelectorAll('canvas[data-ad]')) {
    const cr = list[+c.dataset.ad], aspect = +c.dataset.aspect || 3, W = c.width = aspect < 1 ? Math.max(96, Math.round(Math.min(480, 720 * aspect))) : 800, H = c.height = Math.round(W / aspect), x = c.getContext('2d'), hem = c.dataset.hem === '1';
    if (!cr) { drawHouse(x, W, H, {}); continue; }
    drawCreative(x, W, H, cr, null, { hem });
    const src = pictureFor(cr, aspect);
    if (src) loadImage(src).then(img => { if (img && c.isConnected) drawCreative(x, W, H, cr, img, { hem }); });
  }
}
/** A shape's preview: the canvas in its frame. */
export const previewHtml = (shape, i = 0, caption = null) => {   // caption: the place's name ('Billboard', 'Your sign'…)
  const S = SHAPE[shape] ? SHAPE[shape] : /^x/.test(String(shape)) ? shapeOf(shape) : SHAPE.wide;
  const narrow = S.own ? ` style="justify-self:center;width:min(100%, ${Math.round(330 * S.a) + 14}px)"` : '';   // a sign's own shape: about 330 px high at most
  return `<figure class="ab-fig ${S.frame}"${narrow}><canvas data-ad="${i}" data-aspect="${S.a}"${S.frame === 'cloth' ? ' data-hem="1"' : ''}></canvas><figcaption>${esc(caption ?? S.label)}</figcaption></figure>`;
};

/** Uploads a picture (a File) to `url`; resolves its address or throws. */
export async function uploadPicture(url, file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Pictures are at most 2 MB');
  const send = () => fetch(url, { method: 'POST', headers: { 'content-type': file.type, ...(auth.csrf ? { 'x-csrf-token': auth.csrf } : {}) }, body: file });
  let r = await send(), j = await r.json().catch(() => ({}));
  if (r.status === 403 && j.code === 'csrf') { await auth.refresh(); r = await send(); j = await r.json().catch(() => ({})); }
  if (!r.ok) throw new Error(j.error || 'The upload failed');
  return j.imageSrc;
}

/**
 * Builds the designer into `root`. o: { cr (a design to start from), shapes (where it shows), upload (the pictures'
 * address), images ('ads' | 'any'), placeholder (the title's), linkLabel, captions ({ shape: the place's name }),
 * onChange(design | Error) }. Returns { value() (a design or an Error), setShapes(shapes, captions?), refresh() }.
 * The picture is placed by hand on the previews: drag it to move it, drag its corner (or scroll) to resize it; the
 * picture bar fits it (fill, whole, stretch), zooms it, crops it (ui: a crop box with handles) and resets it.
 */
export function designer(root, o = {}) {
  const like = o.cr || {};
  const S = {
    format: like.format || 'logo', imageSrc: like.imageSrc || '', imageTallSrc: like.imageTallSrc || '', title: like.title || '', message: like.message || '', website: like.website || '',
    backgroundColor: like.backgroundColor || '#ffffff', textColor: like.textColor || '#111827', logoX: like.logoX ?? 4, logoY: like.logoY ?? 50, logoSize: like.logoSize ?? 74,
    pic: { ...(like.pic || {}) }, picTall: { ...(like.picTall || {}) }, active: 'pic',
  };
  let shapes = o.shapes || ['wide'], drag = null, raf = 0;
  root.innerHTML = '';
  const el = root.appendChild(h(`<div class="designer">
    <div class="ab-preview"></div>
    <div class="pic-tools hidden">
      <div class="row wrap pt-which hidden"><span class="dim">Picture:</span><span class="seg"><button type="button" class="btn small" data-which="pic">Wide</button><button type="button" class="btn small" data-which="picTall">Tall</button></span></div>
      <div class="row wrap"><span class="seg pt-fit"><button type="button" class="btn small" data-fit="cover" title="Fill the space (what overflows is cut)">Fill</button><button type="button" class="btn small" data-fit="contain" title="The whole picture shows">Whole</button><button type="button" class="btn small" data-fit="stretch" title="Stretch it to the space">Stretch</button></span>
        <label class="pt-zoom">🔍 <input type="range" class="pt-z" min="0.25" max="4" step="0.01"></label>
        <button type="button" class="btn small" data-a="crop">✂️ Crop</button><button type="button" class="btn small" data-a="reset">↺ Reset</button></div>
      <p class="hint pt-hint"></p></div>
    <div class="seg ab-format"><button type="button" class="btn small" data-format="logo">🔤 Logo &amp; title</button><button type="button" class="btn small" data-format="image">🖼️ Full picture</button></div>
    <div class="ab-pic" data-pic="imageSrc"><input type="file" class="ab-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button type="button" class="btn small" data-a="pick"></button><span class="dim ab-picname"></span><button type="button" class="btn small hidden" data-a="nopic">Remove</button></div>
    <div class="ab-pic" data-pic="imageTallSrc"><input type="file" class="ab-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button type="button" class="btn small" data-a="pick">📷 Upload the tall picture</button><span class="dim ab-picname"></span><button type="button" class="btn small hidden" data-a="nopic">Remove</button></div>
    <p class="hint ab-pichint"></p>
    <label class="fld">Title <input class="input ab-in" data-k="title" maxlength="${AD_LIMITS.title}" placeholder="${esc(o.placeholder || "e.g. Joe's Pizza - open late")}"></label>
    <label class="fld">Message <small class="dim">(shown when someone taps it)</small><textarea class="input ab-in" data-k="message" maxlength="${AD_LIMITS.message}" rows="2" placeholder="What people should know"></textarea></label>
    <label class="fld">${esc(o.linkLabel || 'Link')} <small class="dim">(optional: "Open link" takes people there in a new tab)</small><input class="input ab-in" data-k="website" inputmode="url" placeholder="yoursite.com"></label>
    <div class="ab-colors"><label>Background <input type="color" class="ab-in" data-k="backgroundColor"></label><label>Text <input type="color" class="ab-in" data-k="textColor"></label></div>
    <p class="hint bad ab-derr" role="alert"></p></div>`));
  const q = s2 => el.querySelector(s2);
  for (const i of el.querySelectorAll('.ab-in')) i.value = S[i.dataset.k];
  const value = () => normalizeAdCreative({ ...S, imageTallSrc: S.format === 'image' ? S.imageTallSrc : '', pic: S.pic, picTall: S.picTall }, { images: o.images || 'any' });
  const tall = () => shapes.some(s2 => aspectOf(s2) < 1), wide = () => shapes.some(s2 => aspectOf(s2) >= 1);
  const tallA = () => aspectOf(shapes.find(s2 => aspectOf(s2) < 1)), wideA = () => aspectOf(shapes.find(s2 => aspectOf(s2) >= 1) || 'wide');
  const isImg = () => S.format === 'image';
  /** The placement a preview of this aspect edits (the tall picture's in tall places when there is one). */
  const roleFor = aspect => (isImg() && aspect < 1 && S.imageTallSrc ? 'picTall' : isImg() && !S.imageSrc && S.imageTallSrc ? 'picTall' : 'pic');
  const srcOf = role => (role === 'picTall' ? S.imageTallSrc : S.imageSrc);
  const shown = () => { const v = value(); return v instanceof Error ? { format: 'logo', title: S.title || 'Your title here', backgroundColor: S.backgroundColor, textColor: S.textColor, imageSrc: '', website: '' } : v; };
  /** Paints the previews (and the box and handle round the picture on each). */
  const drawPreviews = () => {
    raf = 0;
    const cr = shown();
    for (const fig of el.querySelectorAll('.ab-preview figure')) {
      const c = fig.querySelector('canvas'), aspect = +c.dataset.aspect, W = c.width = aspect < 1 ? Math.max(96, Math.round(Math.min(480, 720 * aspect))) : 800, H = c.height = Math.round(W / aspect), x = c.getContext('2d'), hem = c.dataset.hem === '1';
      const src = pictureFor(cr, aspect), done = img => {
        const at = drawCreative(x, W, H, cr, img, { hem }), ov = fig.querySelector('.pv-box');
        if (!ov) return;
        if (!at || !src) { ov.classList.add('hidden'); return; }
        // the box shows the picture's edges, held near the preview (a picture zoomed far past it would put the box and
        // its handle over the other controls); its centre stays the picture's, for resizing round it
        const k = c.clientWidth / W || 1, top = c.offsetTop, left = c.offsetLeft, m = 14;
        const x0 = Math.max(-m, at.x * k), y0 = Math.max(-m, at.y * k), x1 = Math.min(c.clientWidth + m, (at.x + at.w) * k), y1 = Math.min(c.clientHeight + m, (at.y + at.h) * k);
        fig._pc = { x: (at.x + at.w / 2) * k, y: (at.y + at.h / 2) * k };
        Object.assign(ov.style, { left: `${left + x0}px`, top: `${top + y0}px`, width: `${Math.max(8, x1 - x0)}px`, height: `${Math.max(8, y1 - y0)}px` });
        ov.classList.remove('hidden');
        fig.dataset.role = roleFor(aspect);
      };
      if (src) loadImage(src).then(img => { if (c.isConnected) done(img); }); else done(null);
    }
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(drawPreviews); };
  const paint = (emit = true) => {
    for (const b of el.querySelectorAll('[data-format]')) b.classList.toggle('on', b.dataset.format === S.format);
    const img = isImg(), picW = q('[data-pic="imageSrc"]'), picT = q('[data-pic="imageTallSrc"]');
    picW.querySelector('[data-a="pick"]').textContent = img ? (tall() && wide() ? '📷 Upload the wide picture' : '📷 Upload the picture') : '📷 Upload a logo or picture';
    picW.classList.toggle('hidden', img && !wide());
    picT.classList.toggle('hidden', !(img && tall()));
    for (const [p2, k] of [[picW, 'imageSrc'], [picT, 'imageTallSrc']]) { p2.querySelector('.ab-picname').textContent = S[k] ? '✅ Uploaded' : ''; p2.querySelector('[data-a="nopic"]').classList.toggle('hidden', !S[k]); }
    q('.ab-colors').classList.toggle('hidden', img);
    q('.ab-pichint').textContent = img
      ? `A full picture fills the space${tall() && wide() ? `: the wide one best in its shape (e.g. ${bestPx(wideA())}), the tall one in its (e.g. ${bestPx(tallA())})` : `, best in its shape (e.g. ${bestPx(wide() ? wideA() : tallA())})`}; place it by hand on the preview. PNG, JPEG, WebP or GIF up to 2 MB.`
      : 'A logo (optional) stands beside your title (above it on tall signs). PNG, JPEG, WebP or GIF up to 2 MB.';
    // the picture bar: for whichever picture is being worked on
    const both = img && S.imageSrc && S.imageTallSrc && tall() && wide();
    if (!both) S.active = img && !S.imageSrc && S.imageTallSrc ? 'picTall' : 'pic';
    const has = !!srcOf(S.active), P = S[S.active];
    q('.pic-tools').classList.toggle('hidden', !has);
    q('.pt-which').classList.toggle('hidden', !both);
    for (const b of el.querySelectorAll('[data-which]')) b.classList.toggle('on', b.dataset.which === S.active);
    q('.pt-fit').classList.toggle('hidden', !img);
    for (const b of el.querySelectorAll('[data-fit]')) b.classList.toggle('on', (P.fit || 'cover') === b.dataset.fit);
    const z = q('.pt-z');
    if (img) { z.min = '0.25'; z.max = '4'; z.step = '0.01'; z.value = String(P.zoom || 1); } else { z.min = '20'; z.max = '100'; z.step = '1'; z.value = String(S.logoSize); }
    q('.pt-hint').textContent = img ? 'Drag the picture to move it; drag its corner or scroll on it to resize it.' : 'Drag the logo to move it (on wide signs); drag its corner or scroll on it to resize it.';
    const Pv = q('.ab-preview');
    Pv.classList.toggle('many', shapes.length > 1);
    Pv.innerHTML = shapes.map(sh => previewHtml(sh, 0, o.captions?.[sh] ?? null)).join('');
    for (const fig of Pv.querySelectorAll('figure')) fig.appendChild(h('<div class="pv-box hidden"><i class="pv-handle" title="Drag to resize"></i></div>'));
    drawPreviews();
    const cr = value(), ok = !(cr instanceof Error);
    q('.ab-derr').textContent = !ok && (S.title || S.imageSrc || S.website) ? cr.message : '';
    if (emit) o.onChange?.(cr);
  };
  const upload = async (file, k) => {
    if (!file) return;
    const p2 = q(`[data-pic="${k}"] .ab-picname`); p2.textContent = 'Uploading…';
    try { S[k] = await uploadPicture(o.upload || '/api/signs/image', file); S[k === 'imageTallSrc' ? 'picTall' : 'pic'] = {}; q('.ab-derr').textContent = ''; } catch (e) { p2.textContent = ''; q('.ab-derr').textContent = e.message; }
    paint();
  };
  // ---------------------------------------------------------------- placing the picture by hand on a preview
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  el.addEventListener('pointerdown', e => {
    const fig = e.target.closest('.ab-preview figure'); if (!fig || !fig.dataset.role) return;
    const c = fig.querySelector('canvas'), box = fig.querySelector('.pv-box'); if (box.classList.contains('hidden')) return;
    const role = fig.dataset.role, P = S[role], r = c.getBoundingClientRect(), b = box.getBoundingClientRect();
    const sizing = e.target.classList.contains('pv-handle');
    if (!sizing && !(e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) && !isImg()) return;
    e.preventDefault();
    S.active = role;
    drag = { sizing, role, x0: e.clientX, y0: e.clientY, W: r.width, H: r.height, tallLayout: !isImg() && r.width / r.height < 1.25,
      cx: r.left + (fig._pc?.x ?? r.width / 2), cy: r.top + (fig._pc?.y ?? r.height / 2), d0: Math.max(8, Math.hypot(e.clientX - (r.left + (fig._pc?.x ?? r.width / 2)), e.clientY - (r.top + (fig._pc?.y ?? r.height / 2)))),
      start: { x: P.x || 0, y: P.y || 0, zoom: P.zoom || 1, logoX: S.logoX, logoY: S.logoY, logoSize: S.logoSize } };
    fig.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const d = drag, P = S[d.role], dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (d.sizing) {
      const k = Math.hypot(e.clientX - d.cx, e.clientY - d.cy) / d.d0;
      if (isImg()) P.zoom = clamp(d.start.zoom * k, 0.25, 4); else S.logoSize = clamp(Math.round(d.start.logoSize * k), 20, 100);
    } else if (isImg()) { P.x = clamp(d.start.x + dx * 2 / d.W, -1, 1); P.y = clamp(d.start.y + dy * 2 / d.H, -1, 1); }
    else if (!d.tallLayout) { S.logoX = clamp(d.start.logoX + dx / d.W * 130, 0, 100); S.logoY = clamp(d.start.logoY + dy / d.H * 130, 0, 100); }
    const z = q('.pt-z'); z.value = String(isImg() ? P.zoom || 1 : S.logoSize);
    redraw();
  });
  const end = () => { if (!drag) return; drag = null; paint(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => {
    const fig = e.target.closest('.ab-preview figure'); if (!fig || !fig.dataset.role || fig.querySelector('.pv-box').classList.contains('hidden')) return;
    e.preventDefault();
    const role = fig.dataset.role, P = S[role], k = Math.exp(-e.deltaY * 0.0015);
    S.active = role;
    if (isImg()) P.zoom = clamp((P.zoom || 1) * k, 0.25, 4); else S.logoSize = clamp(Math.round(S.logoSize * k), 20, 100);
    redraw();
    clearTimeout(el._wt); el._wt = setTimeout(() => paint(), 250);
  }, { passive: false });
  // ---------------------------------------------------------------- the rest of the controls
  el.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (k) { S[k] = e.target.value; paint(); return; }
    if (e.target.classList.contains('pt-z')) { const v = +e.target.value; if (isImg()) S[S.active].zoom = v; else S.logoSize = v; redraw(); clearTimeout(el._zt); el._zt = setTimeout(() => paint(), 250); }
  });
  el.addEventListener('change', e => { if (e.target.classList.contains('ab-file')) upload(e.target.files[0], e.target.closest('[data-pic]').dataset.pic); });
  el.addEventListener('dragover', e => { if (e.target.closest('.ab-preview, .ab-pic')) e.preventDefault(); });
  el.addEventListener('drop', e => { if (!e.target.closest('.ab-preview, .ab-pic')) return; e.preventDefault(); upload(e.dataTransfer.files[0], e.target.closest('[data-pic]')?.dataset.pic || (isImg() && tall() && !wide() ? 'imageTallSrc' : 'imageSrc')); });
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-format],[data-a],[data-fit],[data-which]'); if (!t) return;
    if (t.dataset.format) { S.format = t.dataset.format; paint(); return; }
    if (t.dataset.which) { S.active = t.dataset.which; paint(false); return; }
    if (t.dataset.fit) { S[S.active].fit = t.dataset.fit; paint(); return; }
    if (t.dataset.a === 'reset') { S[S.active] = {}; if (!isImg()) { S.logoX = 4; S.logoY = 50; S.logoSize = 74; } paint(); return; }
    if (t.dataset.a === 'crop') {
      const role = S.active, src = srcOf(role); if (!src) return;
      const target = isImg() ? (role === 'picTall' && tall() ? tallA() : wide() ? wideA() : tallA()) : null;
      const crop = await cropPicture(src, S[role].crop || null, target);
      if (crop !== undefined) { if (crop) S[role].crop = crop; else delete S[role].crop; paint(); }
      return;
    }
    const k = t.closest('[data-pic]')?.dataset.pic;
    if (t.dataset.a === 'pick' && k) t.closest('[data-pic]').querySelector('.ab-file').click();
    if (t.dataset.a === 'nopic' && k) { S[k] = ''; S[k === 'imageTallSrc' ? 'picTall' : 'pic'] = {}; paint(); }
  });
  paint();
  return { value, setShapes: (s2, captions) => { shapes = s2 && s2.length ? s2 : ['wide']; if (captions) o.captions = { ...o.captions, ...captions }; paint(); }, refresh: paint };
}

/**
 * Crops a picture: the whole picture with a box over it, moved by dragging inside it and sized by its handles; "Fit
 * the sign" keeps the box in the sign's shape (aspect: width / height of the space, or null). Resolves the crop
 * [x0, y0, x1, y1] (0…1), null for none, or undefined when cancelled.
 */
export function cropPicture(src, crop, aspect = null) {
  return new Promise(resolve => {
    const back = document.body.appendChild(h(`<div class="crop-back"><div class="crop-box panel">
      <h3><span>✂️ Crop the picture</span></h3>
      <div class="crop-stage"><img alt=""><div class="crop-rect">${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(k => `<i data-h="${k}"></i>`).join('')}</div></div>
      <div class="row wrap"><span class="seg crop-lock"><button type="button" class="btn small" data-lock="0">Free</button>${aspect ? '<button type="button" class="btn small" data-lock="1">Fit the sign</button>' : ''}</span><span class="dim crop-size"></span></div>
      <div class="lib-btns"><button type="button" class="btn" data-c="none">No crop</button><button type="button" class="btn" data-c="cancel">Cancel</button><button type="button" class="btn primary" data-c="apply">Apply</button></div></div></div>`));
    const img = back.querySelector('img'), rect = back.querySelector('.crop-rect'), stage = back.querySelector('.crop-stage');
    let C = crop ? [...crop] : [0.05, 0.05, 0.95, 0.95], lock = !!aspect && !crop, iw = 1, ih = 1, d = null;
    // (Escape on the window, first: it closes the crop, not the dialog the designer is in)
    const finish = v => { back.remove(); window.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(undefined); } };
    window.addEventListener('keydown', onKey, true);
    const fixAspect = (anchor = 'c') => {
      if (!lock || !aspect) return;
      let w = C[2] - C[0], hgt = C[3] - C[1];
      const want = aspect * ih / iw;   // the box's width over height in 0…1 units
      if (w / hgt > want) w = hgt * want; else hgt = w / want;
      w = Math.min(w, 1); hgt = Math.min(hgt, 1);
      let x0 = anchor.includes('w') ? C[2] - w : anchor.includes('e') ? C[0] : (C[0] + C[2] - w) / 2;
      let y0 = anchor.includes('n') ? C[3] - hgt : anchor.includes('s') ? C[1] : (C[1] + C[3] - hgt) / 2;
      x0 = Math.max(0, Math.min(1 - w, x0)); y0 = Math.max(0, Math.min(1 - hgt, y0));
      C = [x0, y0, x0 + w, y0 + hgt];
    };
    const show = () => {
      Object.assign(rect.style, { left: `${C[0] * 100}%`, top: `${C[1] * 100}%`, width: `${(C[2] - C[0]) * 100}%`, height: `${(C[3] - C[1]) * 100}%` });
      for (const b of back.querySelectorAll('[data-lock]')) b.classList.toggle('on', (b.dataset.lock === '1') === lock);
      back.querySelector('.crop-size').textContent = `${Math.round((C[2] - C[0]) * iw)} × ${Math.round((C[3] - C[1]) * ih)} px`;
    };
    img.onload = () => { iw = img.naturalWidth; ih = img.naturalHeight; fixAspect(); show(); };
    img.src = src;
    stage.addEventListener('pointerdown', e => {
      const hdl = e.target.dataset?.h || (e.target === rect ? 'move' : null); if (!hdl) return;
      e.preventDefault(); stage.setPointerCapture?.(e.pointerId);
      d = { hdl, x0: e.clientX, y0: e.clientY, C0: [...C], r: img.getBoundingClientRect() };
    });
    stage.addEventListener('pointermove', e => {
      if (!d) return;
      const dx = (e.clientX - d.x0) / d.r.width, dy = (e.clientY - d.y0) / d.r.height, c0 = d.C0, min = 0.04;
      let [x0, y0, x1, y1] = c0;
      if (d.hdl === 'move') { const w = x1 - x0, hgt = y1 - y0; x0 = Math.max(0, Math.min(1 - w, x0 + dx)); y0 = Math.max(0, Math.min(1 - hgt, y0 + dy)); x1 = x0 + w; y1 = y0 + hgt; }
      else {
        if (d.hdl.includes('w')) x0 = Math.max(0, Math.min(x1 - min, x0 + dx));
        if (d.hdl.includes('e')) x1 = Math.min(1, Math.max(x0 + min, x1 + dx));
        if (d.hdl.includes('n')) y0 = Math.max(0, Math.min(y1 - min, y0 + dy));
        if (d.hdl.includes('s')) y1 = Math.min(1, Math.max(y0 + min, y1 + dy));
      }
      C = [x0, y0, x1, y1];
      if (d.hdl !== 'move') fixAspect(d.hdl);   // in shape: the sides across from the dragged handle stay put
      show();
    });
    const up = () => { d = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    back.addEventListener('click', e => {
      const l = e.target.closest('[data-lock]'); if (l) { lock = l.dataset.lock === '1'; fixAspect(); show(); return; }
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (c === 'cancel') finish(undefined);
      if (c === 'none') finish(null);
      if (c === 'apply') finish(C[0] <= 0.001 && C[1] <= 0.001 && C[2] >= 0.999 && C[3] >= 0.999 ? null : C.map(v => Math.round(v * 10000) / 10000));
    });
  });
}
