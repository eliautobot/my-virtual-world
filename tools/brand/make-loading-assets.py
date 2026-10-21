#!/usr/bin/env python3
# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
"""The loading screen's logo layers, from the brand originals in tools/brand/src (Pillow + numpy).

  mvw-base.webp   the MVW mark with its orange/magenta light turned down (the letters as if unlit)
  mvw-glow.webp   only the light: added on top (plus-lighter), base + glow = the original logo
  mvw-halo.webp   the light blurred wide, for the bloom round the letters
  mvw-mask.png    where the light is (alpha), the mask the flowing light runs through
  mvw-word.webp   the "MY VIRTUAL WORLD" wordmark lifted off its grey ground, lettering made light for a dark screen
  mvw-mark.webp   the mark for the top bar
  favicon-*.png   the V of the mark: the tab icon (transparent) and the home-screen one (180, on white)

Run: python3 tools/brand/make-loading-assets.py   (writes client/img/brand/)"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'client', 'img', 'brand')
os.makedirs(OUT, exist_ok=True)

def save(arr, name, **kw):
    im = Image.fromarray(np.ascontiguousarray(np.clip(arr, 0, 255).astype(np.uint8)), 'RGBA')
    p = os.path.join(OUT, name)
    if name.endswith('.webp'): im.save(p, 'WEBP', quality=kw.get('q', 90), method=6)
    else: im.save(p, optimize=True)
    print(name, im.size, os.path.getsize(p), 'bytes')
    return im

# ---- the mark
src = Image.open(os.path.join(HERE, 'src', 'mvw-logo.png')).convert('RGBA')
a = np.array(src).astype(np.float32)
ys, xs = np.where(a[..., 3] > 6)
pad = 40
x0, x1, y0, y1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad), max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
crop = src.crop((x0, y0, x1, y1))
W = 1200
crop = crop.resize((W, round(crop.height * W / crop.width)), Image.LANCZOS)
a = np.array(crop).astype(np.float32)
rgb, al = a[..., :3], a[..., 3:4] / 255
mx, mn = rgb.max(-1), rgb.min(-1)
# how much of a pixel is the orange/magenta light: saturated and bright (the letter faces are near-black greys)
g = np.clip((mx - mn - 30) / 110, 0, 1) * np.clip((mx - 45) / 130, 0, 1)
g = g[..., None]
DIM = 0.78                                   # the share of the light the base leaves out
base = rgb * (1 - DIM * g)
glow = rgb * DIM * g                         # base + glow = the original
save(np.concatenate([base, al * 255], -1), 'mvw-base.webp')
# the light layer as colour with alpha (premultiplied back out), so it can be added with plus-lighter
ga = np.clip(glow.max(-1, keepdims=True) / 255, 0, 1) * al
gc = np.where(ga > 1e-3, glow * al / np.maximum(ga, 1e-3), 0)
save(np.concatenate([gc, ga * 255], -1), 'mvw-glow.webp', q=92)
# halo: the light spread out, on a canvas with room for it
HP = 120
big = np.zeros((a.shape[0] + 2 * HP, a.shape[1] + 2 * HP, 4), np.float32)
big[HP:-HP, HP:-HP, :3] = glow * al
big[HP:-HP, HP:-HP, 3] = 255
hal = Image.fromarray(np.clip(big, 0, 255).astype(np.uint8), 'RGBA').convert('RGB')
small = hal.resize((hal.width // 3, hal.height // 3), Image.BILINEAR).filter(ImageFilter.GaussianBlur(14))
hal = np.array(small.resize((hal.width // 2, hal.height // 2), Image.BILINEAR)).astype(np.float32) * 1.6
ha = np.clip(hal.max(-1, keepdims=True) / 255, 0, 1)
hc = np.where(ha > 1e-3, hal / np.maximum(ha, 1e-3), 0)
save(np.concatenate([hc, ha * 255], -1), 'mvw-halo.webp', q=85)
m = np.clip(g * al * 1.25, 0, 1)
mask = np.concatenate([np.full_like(rgb, 255), m * 255], -1)
Image.fromarray(mask.astype(np.uint8), 'RGBA').resize((W // 2, a.shape[0] // 2), Image.LANCZOS).save(os.path.join(OUT, 'mvw-mask.png'), optimize=True)
print('mvw-mask.png', os.path.getsize(os.path.join(OUT, 'mvw-mask.png')))
print('mark aspect', W, a.shape[0], 'halo pad', HP, '(halo is drawn at half size)')

# ---- the wordmark: un-mix each pixel from the grey ground it sits on
w = np.array(Image.open(os.path.join(HERE, 'src', 'mvw-wordmark.png')).convert('RGB')).astype(np.float32)
B = np.median(np.concatenate([w[0], w[-1], w[:, 0], w[:, -1]]), 0)
# alpha: the least opacity that explains the pixel with a foreground inside 0..255
need = np.maximum(np.where(w < B, (B - w) / np.maximum(B, 1), (w - B) / np.maximum(255 - B, 1)), 0).max(-1, keepdims=True)
alpha = np.clip(need, 0, 1)
F = np.where(alpha > 1e-3, (w - B * (1 - alpha)) / np.maximum(alpha, 1e-3), 0)
F = np.clip(F, 0, 255)
sat = F.max(-1, keepdims=True) - F.min(-1, keepdims=True)
LIGHT = np.array([242, 238, 234], np.float32)
colour = np.clip((sat - 40) / 60, 0, 1)           # the gradient rules keep their colour; the grey letters turn light
F = F * colour + LIGHT * (1 - colour)
alpha = np.clip((alpha - 0.08) / 0.92, 0, 1)            # the grey ground's speckle (up to ~6%) goes fully clear
ys, xs = np.where(alpha[..., 0] > 0.05)
cy0, cy1, cx0, cx1 = max(0, ys.min() - 2), ys.max() + 3, max(0, xs.min() - 2), xs.max() + 3
F, alpha = F[cy0:cy1, cx0:cx1], alpha[cy0:cy1, cx0:cx1]
save(np.concatenate([F, alpha * 255], -1), 'mvw-word.webp', q=92)

# ---- the top bar's logo: the whole mark, tight, 84 px tall (shown 26 px; 20 on phones)
whole = Image.open(os.path.join(HERE, 'src', 'mvw-logo.png')).convert('RGBA')
wa = np.array(whole); wy, wx = np.where(wa[..., 3] > 40)
tight = whole.crop((wx.min() - 4, wy.min() - 4, wx.max() + 5, wy.max() + 5))
tight.resize((round(tight.width * 84 / tight.height), 84), Image.LANCZOS).save(os.path.join(OUT, 'mvw-mark.webp'), 'WEBP', quality=92, method=6)
print('mvw-mark.webp', os.path.getsize(os.path.join(OUT, 'mvw-mark.webp')))

# ---- favicons (2026-10-06): the V of the mark, on its own — a browser draws the tab icon in a 16 px square, where the
# whole 3.4:1 mark is ~5 px tall; one square letter fills it. Transparent; the home-screen icon (apple-touch, 180) on a white
# square (phones put transparent ones on black). The V is cut at the thinnest columns between the letters, then only its
# own shape is kept (flood fill from its middle), so no sliver of the M or the W comes along.
from PIL import ImageDraw, ImageFilter
mark = Image.open(os.path.join(HERE, 'src', 'mvw-logo.png')).convert('RGBA')
ma = np.array(mark); my, mx = np.where(ma[..., 3] > 60)
mark = mark.crop((mx.min(), my.min(), mx.max() + 1, my.max() + 1))
dens = (np.array(mark)[..., 3] > 200).sum(0); MW = mark.width
c1 = int(MW * .25) + int(np.argmin(dens[int(MW * .25):int(MW * .40)]))
c2 = int(MW * .55) + int(np.argmin(dens[int(MW * .55):int(MW * .72)]))
V = mark.crop((c1, 0, c2, mark.height))
solid = Image.fromarray(((np.array(V)[..., 3] > 90) * 255).astype(np.uint8)).copy()   # (a copy: fromarray's image can't be painted)
sa = np.array(solid); sy, sx = np.where(sa > 0)
k0 = int(np.argmin((sx - V.width / 2) ** 2 + (sy - V.height * 0.6) ** 2)); seed = (int(sx[k0]), int(sy[k0]))   # the V's own pixel nearest its middle
ImageDraw.floodfill(solid, seed, 128)
keep = Image.fromarray(((np.array(solid) == 128) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2))
va = np.array(V).astype(np.float32); va[..., 3] *= np.array(keep, np.float32) / 255
V = Image.fromarray(va.astype(np.uint8), 'RGBA')
vy, vx = np.where(np.array(V)[..., 3] > 40); V = V.crop((vx.min(), vy.min(), vx.max() + 1, vy.max() + 1))
for S in (32, 64, 180):
    tile = Image.new('RGBA', (S * 4, S * 4), (0, 0, 0, 0))
    home = S == 180
    if home: ImageDraw.Draw(tile).rounded_rectangle((0, 0, S * 4 - 1, S * 4 - 1), radius=S * 4 // 5, fill=(255, 255, 255, 255))
    room = S * 4 * (0.74 if home else 1.0)
    k = min(room / V.width, room / V.height); w, h = round(V.width * k), round(V.height * k)
    tile.alpha_composite(V.resize((w, h), Image.LANCZOS), ((S * 4 - w) // 2, (S * 4 - h) // 2))
    tile = tile.resize((S, S), Image.LANCZOS)
    p = os.path.join(OUT, f'favicon-{S}.png'); tile.save(p, optimize=True); print(os.path.basename(p), os.path.getsize(p))
