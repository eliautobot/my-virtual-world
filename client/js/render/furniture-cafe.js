// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The café's furniture (Floor Themes' café redone, 2026-10-26: "the current Cafe floor type/building layout needs to be
// redone from scratch ... highly detailed unique and distinct layouts that are nice to visit and have style"): five
// styles, each with its own counter (the order point: staff behind, a customer in front, as the old Café Counter) and
// pieces of its own, and a kit they share.
//   Parisian bistro      a zinc-topped counter, marble bistro tables with bentwood chairs, banquette booths, a gilt mirror
//   Nordic roastery      a pale oak counter, the coffee roaster, bean sacks, a long communal table, hanging plants
//   Industrial loft      a steel and concrete counter, a window ledge with stools, pipe shelving, Edison pendants
//   Bookshop café        a walnut counter with a banker's lamp, a wall of books with its ladder, wingback chairs, a hearth
//   Garden conservatory  a rattan counter, rattan tables with peacock chairs, a tiered fountain, palms, hanging ivy
//   shared               the pastry case, the chalkboard menu, the condiment bar
// Item-local frame as render/furniture.js: +z the front, y up; the sizes match shared/catalog.js. Light: col(hex, 0, 1) a
// soft glow, 2 a lamp at night, 4 a flicker (the hearth's fire).
const TAU = Math.PI * 2, P = Math.PI, H = Math.PI / 2;
const C = { zinc: '#9aa1a6', chrome: '#d7dbe0', brass: '#b8924a', black: '#1b1c1f', walnut: '#5b3a26', oak: '#c9a878', marble: '#ece8e1',
  steel: '#3e4246', copper: '#b8734a', rattan: '#c49a62', cream: '#f2ebde', leaf: '#3f7a3a', leaf2: '#5c9a4a', glow: '#ffd9a0' };

// ---------------------------------------------------------------- the counter's kit
/** An espresso machine on a counter top at y: two groups, a cup rail, steam wand; tone: its body. */
function espresso(f, x, y, z, tone = C.chrome) {
  f.col(tone); f.box(x - 0.36, y, z - 0.2, x + 0.36, y + 0.34, z + 0.18);
  f.col(C.black); f.box(x - 0.37, y + 0.34, z - 0.21, x + 0.37, y + 0.37, z + 0.19);
  for (const s of [-0.16, 0.16]) { f.col(C.chrome); f.cyl(x + s, z + 0.2, 0.035, y + 0.2, y + 0.26, 8); f.col(C.black); f.rod([x + s, y + 0.22, z + 0.23], [x + s, y + 0.2, z + 0.33], 0.012, 5); }
  f.col(C.chrome); f.rod([x + 0.33, y + 0.3, z + 0.18], [x + 0.36, y + 0.12, z + 0.26], 0.008, 5);
  for (let k = 0; k < 4; k++) { f.col(C.cream); f.cyl(x - 0.27 + k * 0.18, z - 0.05, 0.035, y + 0.37, y + 0.42, 8); }
}
function grinder(f, x, y, z, tone = C.black) {
  f.col(tone); f.box(x - 0.08, y, z - 0.1, x + 0.08, y + 0.3, z + 0.08);
  f.glass('#6b4a2f'); f.cyl(x, z, 0.07, y + 0.3, y + 0.48, 10, 0.09);
}
function cup(f, x, y, z, tone = C.cream) { f.col(tone); f.cyl(x, z, 0.04, y, y + 0.08, 8, 0.045); }
/** Pastries and cakes on a tray at y between x0 and x1. */
function pastries(f, x0, x1, y, z, seed = 1) {
  const cols = ['#c98b4a', '#e2b26a', '#7b4a2e', '#f3d9b0', '#d96a5a', '#f1c453'];
  for (let k = 0, x = x0; x < x1; k++, x += 0.13) {
    f.col(cols[(k + seed) % cols.length]);
    if ((k + seed) % 3 === 0) f.cyl(x, z, 0.055, y, y + 0.06, 10); else f.sph(x, y + 0.03, z, 0.055, 0.035, 0.04, 8, 5);
  }
}
/** A counter: body from x0..x1 (front at +z), its top, the espresso machine, grinder, cups, a pastry tray. */
function counterBody(f, o) {
  const { body, top, kick = C.black, mach = C.chrome, deco } = o;
  f.tint(body); f.box(-2.0, 0, -0.42, 2.0, 1.02, 0.4);
  f.col(top); f.box(-2.04, 1.02, -0.46, 2.04, 1.08, 0.45);
  f.col(kick); f.box(-1.95, 0, 0.38, 1.95, 0.09, 0.41);
  espresso(f, -0.95, 1.08, -0.18, mach); grinder(f, -0.35, 1.08, -0.22);
  f.glass('#eef6fa'); f.box(0.4, 1.08, -0.05, 1.75, 1.42, 0.36);
  f.col(C.glow, 0, 1); f.box(0.44, 1.08, 0.0, 1.71, 1.09, 0.32);
  pastries(f, 0.5, 1.7, 1.1, 0.16);
  cup(f, -1.75, 1.08, 0.25); cup(f, -1.62, 1.08, 0.3); f.col('#6b4a2f'); f.cyl(-0.05, 0.22, 0.06, 1.08, 1.17, 10);   // (cups and the tip jar)
  if (deco) deco(f);
}
// ---------------------------------------------------------------- seats
function bentwood(f, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  f.col('#3a2418'); for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) { const [a, b] = at(lx, lz); f.cyl(a, b, 0.018, 0, 0.46, 6); }
  f.col('#3a2418'); f.cyl(x, z, 0.21, 0.44, 0.48, 14);
  f.col('#c9a878'); f.cyl(x, z, 0.19, 0.48, 0.5, 14);
  const [bx, bz] = at(0, -0.2); f.col('#3a2418'); f.cyl(bx, bz, 0.02, 0.48, 0.92, 6);
  const [l, lz2] = at(-0.17, -0.18), [r, rz] = at(0.17, -0.18); f.rod([l, 0.48, lz2], [l, 0.88, lz2], 0.016, 5); f.rod([r, 0.48, rz], [r, 0.88, rz], 0.016, 5); f.rod([l, 0.88, lz2], [r, 0.88, rz], 0.02, 5);
}
function marbleTable(f, x, z, r = 0.36, top = C.marble) {
  f.col(C.black); f.cyl(x, z, 0.24, 0, 0.04, 12); f.cyl(x, z, 0.03, 0.04, 0.72, 8);
  f.col(top); f.cyl(x, z, r, 0.72, 0.75, 20);
}
function rattanChair(f, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), back = [x - 0.24 * s, z - 0.24 * c];
  f.col(C.rattan); f.cyl(x, z, 0.24, 0, 0.42, 14, 0.22);
  f.col('#eae2d2'); f.cyl(x, z, 0.21, 0.42, 0.48, 14);
  // the peacock back fanning up behind: an outer and an inner shell with a rim, so it shows from the front and the back
  // (one lathed surface faces one way only: from the front it was invisible, 2026-10-26)
  const fan = [[0.05, 0.45], [0.3, 0.6], [0.42, 0.95], [0.44, 1.18], [0.4, 1.2]], a0 = yaw + P - 1.1, a1 = yaw + P + 1.1;
  f.col(C.rattan); f.lathe(back[0], back[1], fan, 14, a0, a1);
  f.col('#b08550'); f.lathe(back[0], back[1], fan.map(([r, y]) => [Math.max(0.02, r - 0.035), y]).reverse(), 14, a0, a1);
  f.col('#a07a48'); for (let k = 0; k <= 14; k++) { const a = a0 + (a1 - a0) * k / 14; f.sph(back[0] + Math.sin(a) * 0.43, 1.19, back[1] + Math.cos(a) * 0.43, 0.035, 0.035, 0.035, 5, 3); }
}
function stool(f, x, z, seat, tone = C.black) { f.col(tone); f.cyl(x, z, 0.03, 0, seat, 6); f.cyl(x, z, 0.17, 0.25, 0.27, 10); f.col(C.walnut); f.cyl(x, z, 0.18, seat, seat + 0.05, 12); }
function wingback(f, x, z, yaw, tone) {
  const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  f.tint(tone); const [cx, cz] = at(0, 0); f.box(cx - 0.36, 0.12, cz - 0.36, cx + 0.36, 0.48, cz + 0.36);
  const [bx, bz] = at(0, -0.3); f.box(bx - 0.38, 0.12, bz - 0.09, bx + 0.38, 1.18, bz + 0.09);
  for (const sx of [-0.36, 0.36]) { const [ax, az] = at(sx, -0.05); f.box(ax - 0.07, 0.12, az - 0.3, ax + 0.07, 0.68, az + 0.3); }
  f.col(C.walnut); for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const [a, b] = at(lx, lz); f.cyl(a, b, 0.03, 0, 0.12, 6); }
}
/** A little vase of flowers on a table top at y. */
function vase(f, x, y, z) { f.glass('#dbe9ee'); f.cyl(x, z, 0.03, y, y + 0.12, 8, 0.02); for (let k = 0; k < 3; k++) { f.col(['#e24a5a', '#f1c453', '#f4f4f4'][k]); f.sph(x + (k - 1) * 0.025, y + 0.16 + (k % 2) * 0.02, z, 0.025, 0.025, 0.025, 6, 4); } }
// ---------------------------------------------------------------- greenery
function plant(f, x, y, z, s = 1, tone = C.leaf) {
  for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, r = 0.12 * s; f.col(k % 2 ? tone : C.leaf2); f.sph(x + Math.cos(a) * r, y + 0.12 * s + (k % 3) * 0.05 * s, z + Math.sin(a) * r, 0.13 * s, 0.09 * s, 0.13 * s, 7, 5); }
}
function palm(f, x, z, y0, h) {
  f.col('#7a5a3a'); f.cyl(x, z, 0.05, y0, y0 + h, 7, 0.035);
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; f.col(k % 2 ? C.leaf : C.leaf2); f.rod([x, y0 + h, z], [x + Math.cos(a) * 0.55, y0 + h - 0.25, z + Math.sin(a) * 0.55], 0.06, 4); }
}

export function addCafeFurniture(D) {
  // ---------------------------------------------------------------- the five counters (staff behind, the order in front)
  D.counter_bistro = f => counterBody(f, { body: '#4a2c1f', top: C.zinc, kick: C.brass, mach: C.chrome, deco: f => {
    f.col(C.brass); f.rod([-1.95, 0.22, 0.47], [1.95, 0.22, 0.47], 0.018, 6);   // (the brass foot rail)
    for (const x of [-1.6, 1.6]) { f.glass('#f4f4f4'); f.sph(x, 1.18, 0.15, 0.13, 0.12, 0.13, 10, 6); f.col('#d96a5a'); f.cyl(x, 0.15, 0.1, 1.08, 1.13, 10); }   // (cake domes)
  } });
  D.counter_nordic = f => counterBody(f, { body: C.oak, top: '#f4f2ee', kick: '#e0d6c4', mach: '#2b2b2d', deco: f => {
    plant(f, 1.85, 1.08, -0.3, 0.8); f.col('#efe8dc'); f.cyl(1.85, -0.3, 0.09, 1.08, 1.2, 10);
    for (let x = -1.9; x <= 1.9; x += 0.16) { f.col('#b8956a'); f.box(x - 0.025, 0.1, 0.4, x + 0.025, 1.0, 0.43); }   // (slatted front)
  } });
  D.counter_loft = f => counterBody(f, { body: '#6b6e70', top: '#8e8a84', kick: C.black, mach: C.copper, deco: f => {
    f.col(C.black); for (const x of [-1.5, -0.5, 0.5, 1.5]) f.rod([x, 0.12, 0.43], [x, 0.98, 0.43], 0.025, 6);
    f.col(C.black); f.rod([-1.95, 0.55, 0.44], [1.95, 0.55, 0.44], 0.02, 6);
  } });
  D.counter_library = f => counterBody(f, { body: '#3b2418', top: '#2a1a12', kick: C.brass, mach: C.brass, deco: f => {
    f.col(C.brass); f.cyl(1.85, -0.25, 0.07, 1.08, 1.11, 10); f.rod([1.85, 1.11, -0.25], [1.85, 1.38, -0.25], 0.012, 5);
    f.col('#1f5a3a', 0, 2); f.cyl(1.85, -0.17, 0.12, 1.36, 1.44, 12, 0.05);   // (the banker's lamp, lit after dark)
    for (let k = 0; k < 5; k++) { f.col(['#7a2a22', '#1f3a5a', '#2f4f2f', '#8a6a2a', '#4a2a4a'][k]); f.box(-1.95 + k * 0.07, 1.08, 0.12, -1.9 + k * 0.07, 1.3, 0.34); }
  } });
  D.counter_garden = f => counterBody(f, { body: C.rattan, top: '#f6f3ec', kick: '#8a6a40', mach: '#e8e4dc', deco: f => {
    for (let x = -1.9; x <= 1.9; x += 0.11) { f.col(x * 7 % 2 > 0 ? '#b88c58' : '#caa06c'); f.box(x - 0.04, 0.1, 0.4, x + 0.04, 1.0, 0.42); }   // (woven front)
    plant(f, 1.8, 1.08, -0.28, 0.9, '#4a8a3a'); plant(f, -1.75, 1.08, 0.25, 0.6, '#6aa04a');
  } });
  D.pastry_vitrine = f => {
    f.tint('#e9e2d6'); f.box(-0.75, 0, -0.35, 0.75, 0.62, 0.35);
    f.col(C.brass); f.box(-0.76, 0.62, -0.36, 0.76, 0.65, 0.36);
    f.glass('#eef6fa'); f.box(-0.73, 0.65, -0.33, 0.73, 1.28, 0.33);
    for (const [y, s] of [[0.66, 1], [0.92, 3]]) { f.col(C.glow, 0, 1); f.box(-0.7, y, -0.3, 0.7, y + 0.01, 0.3); pastries(f, -0.6, 0.62, y + 0.02, 0.05, s); pastries(f, -0.55, 0.6, y + 0.02, -0.15, s + 2); }
    f.col(C.brass); f.box(-0.76, 1.28, -0.36, 0.76, 1.3, 0.36);
  };
  // ---------------------------------------------------------------- seats
  D.bistro_set = f => { marbleTable(f, 0, 0); bentwood(f, -0.62, 0, H); bentwood(f, 0.62, 0, -H); vase(f, 0.05, 0.75, -0.08); };
  D.rattan_set = f => { f.col(C.rattan); f.cyl(0, 0, 0.3, 0, 0.68, 14, 0.18); f.glass('#e8f0ec'); f.cyl(0, 0, 0.4, 0.68, 0.71, 20); rattanChair(f, -0.66, 0, H); rattanChair(f, 0.66, 0, -H); };
  D.communal_table = f => {
    f.tint(C.oak); f.box(-1.65, 0.72, -0.48, 1.65, 0.78, 0.48);
    f.col('#2b2b2d'); for (const x of [-1.45, 1.45]) f.box(x - 0.04, 0, -0.4, x + 0.04, 0.72, 0.4);
    for (const z of [-0.72, 0.72]) { f.tint(C.oak); f.box(-1.6, 0.42, z - 0.16, 1.6, 0.47, z + 0.16); f.col('#2b2b2d'); for (const x of [-1.4, 1.4]) f.box(x - 0.03, 0, z - 0.12, x + 0.03, 0.42, z + 0.12); }
    for (const x of [-1.0, 0, 1.0]) { cup(f, x, 0.78, -0.2); cup(f, x + 0.25, 0.78, 0.2); }
    plant(f, 0.5, 0.78, 0, 0.5);
  };
  D.window_ledge = f => {
    f.col('#7a5a3a'); f.box(-1.3, 1.02, -0.45, 1.3, 1.07, -0.12);
    f.col(C.black); for (const x of [-1.2, 0, 1.2]) f.box(x - 0.03, 0, -0.4, x + 0.03, 1.02, -0.36);
    for (const x of [-0.95, -0.32, 0.32, 0.95]) stool(f, x, 0.15, 0.72);
    cup(f, -0.6, 1.07, -0.3); cup(f, 0.62, 1.07, -0.28);
  };
  D.cafe_booth = f => {
    for (const s of [-1, 1]) {
      const a = Math.min(s * 0.42, s * 0.92), b = Math.max(s * 0.42, s * 0.92), ba = Math.min(s * 0.86, s * 0.97), bb = Math.max(s * 0.86, s * 0.97);
      f.col(C.walnut); f.box(-0.98, 0, a, 0.98, 0.12, b); f.box(-0.98, 0, ba, 0.98, 1.2, bb);
      f.tint('#7a2a2a'); f.box(-0.95, 0.12, a, 0.95, 0.47, b); f.box(-0.95, 0.47, Math.min(s * 0.78, s * 0.87), 0.95, 1.12, Math.max(s * 0.78, s * 0.87));
    }
    marbleTable(f, 0, 0, 0.3); f.col(C.marble); f.box(-0.7, 0.72, -0.3, 0.7, 0.75, 0.3);
    cup(f, -0.3, 0.75, -0.15); cup(f, 0.32, 0.75, 0.15);
  };
  D.wingback_set = f => {
    wingback(f, -0.62, 0.05, 0.35, '#5a2a22'); wingback(f, 0.62, 0.05, -0.35, '#2f4a3a');
    f.col(C.walnut); f.cyl(0, -0.1, 0.22, 0, 0.55, 14); f.col(C.brass); f.cyl(0, -0.15, 0.06, 0.55, 0.58, 10); f.rod([0, 0.58, -0.15], [0, 0.95, -0.15], 0.012, 5);
    f.col('#e8d5a8', 0, 2); f.cyl(0, -0.15, 0.17, 0.92, 1.12, 14, 0.1);
    for (let k = 0; k < 3; k++) { f.col(['#7a2a22', '#1f3a5a', '#8a6a2a'][k]); f.box(0.05, 0.55 + k * 0.04, 0.0, 0.22, 0.59 + k * 0.04, 0.12); }
  };
  // ---------------------------------------------------------------- the styles' features
  D.coffee_roaster = f => {
    f.col('#2b2b2d'); f.box(-0.55, 0, -0.45, 0.55, 0.75, 0.45);
    f.col(C.copper); f.cyl(0, 0, 0.42, 0.75, 1.25, 20); f.lathe(0, 0, [[0.42, 1.25], [0.3, 1.42], [0.12, 1.5], [0, 1.52]], 18);
    f.col(C.copper); f.cyl(0.0, -0.1, 0.09, 1.5, 2.15, 10);   // (the chimney)
    f.col(C.chrome); f.lathe(0, 0.42, [[0, 0.95], [0.18, 0.95], [0.2, 1.05], [0.18, 1.12], [0, 1.12]], 14);   // (the drum's window)
    f.col('#2b2b2d'); f.cyl(0.55, 0.3, 0.5, 0.35, 0.45, 18); f.col('#5a3a24'); f.cyl(0.55, 0.3, 0.44, 0.45, 0.47, 18);   // (the cooling tray with beans)
    f.col(C.chrome); f.lathe(-0.62, 0.0, [[0, 1.4], [0.16, 1.4], [0.22, 1.7], [0, 1.72]], 12);   // (the hopper)
  };
  D.bean_sacks = f => {
    for (const [x, z, r] of [[-0.25, 0.0, 0.0], [0.24, 0.05, 0.3], [0.0, -0.12, 0.6]]) { f.col('#a08260'); f.sph(x, 0.28, z, 0.24, 0.3, 0.2, 10, 6); f.col('#5a3a24'); f.sph(x, 0.56, z, 0.13, 0.04, 0.1, 8, 4); }
    f.col('#3a2418'); f.box(-0.12, 0.3, 0.19, 0.12, 0.42, 0.21);
  };
  D.library_wall = f => {
    f.col(C.walnut); f.box(-1.5, 0, -0.22, 1.5, 2.6, -0.18); for (const x of [-1.5, -0.5, 0.5, 1.48]) f.box(x - 0.02, 0, -0.22, x + 0.02, 2.6, 0.2);
    const book = ['#7a2a22', '#1f3a5a', '#2f4f2f', '#8a6a2a', '#4a2a4a', '#c9b48a', '#3a3a3a', '#a04a2a'];
    for (let r = 0; r < 6; r++) {
      const y = 0.1 + r * 0.42; f.col(C.walnut); f.box(-1.5, y - 0.03, -0.18, 1.5, y, 0.2);
      for (let x = -1.46, k = r; x < 1.45; k++) { const w = 0.035 + ((k * 7) % 5) * 0.008, h = 0.28 + ((k * 3) % 4) * 0.025; if (Math.abs(x + 0.5) < 0.03 || Math.abs(x - 0.5) < 0.03) { x += 0.05; continue; } f.col(book[k % book.length]); f.box(x, y, -0.15, x + w, y + h, 0.15); x += w + 0.004; }
    }
    f.col(C.brass); f.rod([-1.5, 2.45, 0.32], [1.5, 2.45, 0.32], 0.012, 5);   // (the ladder's rail and the ladder)
    f.col('#3a2418'); for (const dx of [-0.2, 0.2]) f.rod([0.9 + dx, 2.45, 0.3], [0.9 + dx, 0, 0.42], 0.02, 5);
    for (let k = 1; k < 8; k++) { const t = k / 8; f.rod([0.7, 2.45 * (1 - t), 0.3 + 0.12 * t], [1.1, 2.45 * (1 - t), 0.3 + 0.12 * t], 0.012, 4); }
  };
  D.hearth = f => {
    f.col('#8a4a35'); f.box(-1.0, 0, -0.35, 1.0, 1.25, 0.2);
    for (let r = 0; r < 10; r++) { f.col(r % 2 ? '#7a3f2c' : '#93523b'); f.box(-1.01, r * 0.125, 0.2, 1.01, r * 0.125 + 0.012, 0.205); }
    f.col('#1a1412'); f.box(-0.55, 0.1, -0.2, 0.55, 0.85, 0.21);
    f.col('#ff8a3a', 0, 4); f.sph(-0.15, 0.25, 0.0, 0.18, 0.2, 0.1, 8, 6); f.sph(0.17, 0.22, 0.02, 0.15, 0.17, 0.09, 8, 6); f.col('#ffd06a', 0, 4); f.sph(0.0, 0.2, 0.05, 0.12, 0.13, 0.07, 8, 5);
    f.col('#4a2a1a'); f.rod([-0.35, 0.12, 0.05], [0.35, 0.16, -0.05], 0.05, 6);
    f.col(C.walnut); f.box(-1.15, 1.25, -0.4, 1.15, 1.33, 0.32);
    f.col(C.brass); f.cyl(-0.8, 0.0, 0.04, 1.33, 1.6, 8); f.cyl(0.8, 0.0, 0.04, 1.33, 1.6, 8);   // (candlesticks)
  };
  D.fountain_tiered = f => {
    f.col('#d8d2c4'); f.lathe(0, 0, [[0, 0], [0.78, 0], [0.8, 0.42], [0.7, 0.45], [0.66, 0.3], [0, 0.3]], 24);
    f.glass('#9fc8d8'); f.cyl(0, 0, 0.66, 0.36, 0.38, 24);
    f.col('#d8d2c4'); f.cyl(0, 0, 0.09, 0.3, 1.1, 10); f.lathe(0, 0, [[0, 0.95], [0.38, 1.0], [0.4, 1.08], [0, 1.03]], 18);
    f.glass('#9fc8d8'); f.cyl(0, 0, 0.34, 1.04, 1.06, 18); f.col('#d8d2c4'); f.cyl(0, 0, 0.05, 1.06, 1.45, 8); f.sph(0, 1.5, 0, 0.08, 0.08, 0.08, 8, 6);
    f.glass('#cfe8f0'); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; f.rod([Math.cos(a) * 0.38, 1.04, Math.sin(a) * 0.38], [Math.cos(a) * 0.58, 0.4, Math.sin(a) * 0.58], 0.012, 4); }
  };
  D.cafe_palm = f => { f.tint('#d9c7a8'); f.cyl(0, 0, 0.36, 0, 0.55, 14, 0.42); f.col('#4a3524'); f.cyl(0, 0, 0.38, 0.5, 0.53, 14); palm(f, 0, 0, 0.5, 1.4); palm(f, 0.12, 0.08, 0.5, 1.0); };
  D.gilt_mirror = f => {
    f.col(C.brass); f.box(-0.6, 0.6, -0.05, 0.6, 2.25, 0.0); f.lathe(0, 0.0, [[0, 2.25], [0.6, 2.25], [0.0, 2.45]], 3);
    f.glass('#d6e2ea'); f.box(-0.52, 0.68, 0.0, 0.52, 2.18, 0.012);
  };
  D.menu_board = f => {
    f.col('#3a2418'); f.box(-0.8, 1.2, -0.04, 0.8, 2.3, 0.0);
    f.col('#22262a'); f.box(-0.74, 1.26, 0.0, 0.74, 2.24, 0.01);
    f.col('#f2ebde', 0, 1); f.box(-0.55, 2.08, 0.01, 0.55, 2.13, 0.012);
    for (let k = 0; k < 6; k++) { const y = 1.95 - k * 0.12; f.col('#e8e2d6'); f.box(-0.62, y, 0.01, -0.62 + 0.55 + ((k * 5) % 3) * 0.1, y + 0.025, 0.012); f.col('#f1c453'); f.box(0.45, y, 0.01, 0.62, y + 0.025, 0.012); }
  };
  D.edison_pendants = f => {
    for (const [x, z, y] of [[-0.35, -0.2, 2.15], [0.05, 0.25, 2.3], [0.38, -0.15, 2.05], [-0.1, 0.0, 2.4], [0.25, 0.32, 2.2]]) {
      f.col(C.black); f.rod([x, 2.95, z], [x, y + 0.12, z], 0.006, 4); f.cyl(x, z, 0.045, 2.93, 2.96, 8); f.col(C.brass); f.cyl(x, z, 0.03, y + 0.08, y + 0.13, 8);
      f.glass('#fff1d0'); f.sph(x, y, z, 0.07, 0.09, 0.07, 10, 6); f.col('#ffb45a', 0, 2); f.sph(x, y, z, 0.025, 0.04, 0.025, 6, 4);
    }
  };
  D.pipe_shelf = f => {
    f.col(C.black); for (const x of [-0.85, 0.85]) f.rod([x, 0, 0.0], [x, 2.0, 0.0], 0.025, 6);
    for (const y of [0.45, 0.95, 1.45, 1.95]) {
      f.col('#7a5a3a'); f.box(-0.9, y, -0.18, 0.9, y + 0.04, 0.18);
      for (let k = 0; k < 5; k++) { const x = -0.7 + k * 0.35; if ((k + y * 10) % 3 < 1) { f.glass('#e8dcc4'); f.cyl(x, 0, 0.07, y + 0.04, y + 0.26, 10); f.col('#5a3a24'); f.cyl(x, 0, 0.065, y + 0.04, y + 0.15, 10); } else if ((k + y * 10) % 3 < 2) plant(f, x, y + 0.04, 0, 0.45); else { f.col(['#2f4f4f', '#7a2a22', '#c9b48a'][k % 3]); f.box(x - 0.08, y + 0.04, -0.1, x + 0.08, y + 0.3, 0.1); } }
    }
  };
  D.condiment_bar = f => {
    f.tint('#e8e0d0'); f.box(-0.55, 0, -0.28, 0.55, 0.92, 0.28);
    f.col(C.walnut); f.box(-0.57, 0.92, -0.3, 0.57, 0.96, 0.3);
    f.glass('#e9f2f6'); f.cyl(-0.35, 0, 0.08, 0.96, 1.26, 12); f.glass('#c9e3ee'); f.cyl(-0.35, 0, 0.07, 0.96, 1.12, 12);   // (the water carafe)
    for (let k = 0; k < 4; k++) cup(f, -0.15 + k * 0.1, 0.96, 0.15, '#f4f4f4');
    for (const x of [0.25, 0.4]) { f.glass('#f6f2ea'); f.cyl(x, -0.12, 0.05, 0.96, 1.1, 10); f.col(C.chrome); f.cyl(x, -0.12, 0.052, 1.1, 1.13, 10); }
    f.col('#f4f4f4'); f.box(0.12, 0.96, -0.2, 0.3, 1.0, -0.05);   // (napkins)
  };
  D.hanging_ivy = f => {
    f.col(C.black); f.rod([0, 2.95, 0], [0, 2.35, 0], 0.006, 4);
    f.col('#d9c7a8'); f.cyl(0, 0, 0.16, 2.2, 2.38, 12, 0.2);
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, len = 0.4 + (k % 3) * 0.25; f.col(k % 2 ? C.leaf : C.leaf2); f.rod([Math.cos(a) * 0.16, 2.3, Math.sin(a) * 0.16], [Math.cos(a) * 0.24, 2.3 - len, Math.sin(a) * 0.24], 0.04, 4); }
    plant(f, 0, 2.3, 0, 0.9);
  };

  // ---------------------------------------------------------------- phase 1b: the bistro's own pieces (classic Parisian)
  D.zinc_bar = f => {   // the long bar on a side wall: zinc top, panelled walnut front, brass rail, five high stools in front
    f.tint('#4a2c1f'); f.box(-2.4, 0, -0.42, 2.4, 1.06, 0.36);
    for (let x = -2.2; x < 2.25; x += 0.55) { f.col('#5e3826'); f.box(x - 0.2, 0.18, 0.36, x + 0.2, 0.92, 0.39); }
    f.col(C.zinc); f.box(-2.46, 1.06, -0.46, 2.46, 1.12, 0.44); f.col(C.brass); f.rod([-2.35, 0.2, 0.45], [2.35, 0.2, 0.45], 0.018, 6);
    espresso(f, -1.2, 1.12, -0.2); grinder(f, -0.55, 1.12, -0.25);
    f.glass('#f4f4f4'); f.sph(0.6, 1.25, -0.15, 0.14, 0.13, 0.14, 10, 6); f.col('#d96a5a'); f.cyl(0.6, -0.15, 0.11, 1.12, 1.17, 10);
    f.col('#c9a878'); f.cyl(1.4, -0.15, 0.14, 1.12, 1.14, 12); f.cyl(1.4, -0.15, 0.1, 1.24, 1.26, 12); f.col(C.brass); f.rod([1.4, 1.12, -0.15], [1.4, 1.4, -0.15], 0.01, 5); pastries(f, 1.3, 1.5, 1.14, -0.15); pastries(f, 1.33, 1.47, 1.26, -0.15, 3);   // (the tiered pastry stand)
    for (const x of [-1.9, -0.95, 0, 0.95, 1.9]) stool(f, x, 0.75, 0.74, '#3a2418');
  };
  D.banquette_long = f => {   // a window banquette: a red leather bench along the wall, three marble tables, three bentwood chairs facing it
    f.col(C.walnut); f.box(-2.1, 0, -0.62, 2.1, 0.12, -0.12); f.box(-2.1, 0, -0.62, 2.1, 1.05, -0.5);
    f.tint('#7a2a2a'); f.box(-2.05, 0.12, -0.6, 2.05, 0.46, -0.14); f.box(-2.05, 0.46, -0.56, 2.05, 1.0, -0.46);
    for (const x of [-1.4, 0, 1.4]) { marbleTable(f, x, 0.25, 0.3); bentwood(f, x, 0.85, P); vase(f, x + 0.05, 0.75, 0.2); }
  };
  D.cafe_sconce = f => { f.col(C.brass); f.box(-0.06, 1.85, -0.03, 0.06, 2.05, 0.0); f.rod([0, 1.95, 0], [0, 2.05, 0.18], 0.012, 5); f.glass('#fff4dc'); f.cyl(0, 0.18, 0.07, 2.05, 2.22, 10, 0.05); f.col('#ffd9a0', 0, 2); f.sph(0, 2.1, 0.18, 0.03, 0.04, 0.03, 6, 4); };
  D.poster_frame = f => {
    f.col('#1b1c1f'); f.box(-0.42, 1.25, -0.03, 0.42, 2.25, 0.0);
    f.col('#e9dcc0'); f.box(-0.38, 1.29, 0.0, 0.38, 2.21, 0.006);
    f.col('#c0392b'); f.box(-0.3, 1.75, 0.006, 0.3, 2.1, 0.008); f.col('#1f3a5a'); f.box(-0.3, 1.38, 0.006, 0.3, 1.7, 0.008);
    f.col('#f1c453'); f.sph(0.0, 1.92, 0.01, 0.12, 0.12, 0.004, 10, 3);
  };
  D.coat_stand = f => { f.col('#3a2418'); f.cyl(0, 0, 0.2, 0, 0.03, 10); f.cyl(0, 0, 0.025, 0, 1.75, 6); for (let k = 0; k < 4; k++) { const a = k * H; f.rod([0, 1.6, 0], [Math.cos(a) * 0.2, 1.7, Math.sin(a) * 0.2], 0.012, 4); } f.col('#2f3a4a'); f.sph(0.12, 1.45, 0.05, 0.12, 0.3, 0.08, 8, 5); f.col('#8a3a2a'); f.sph(-0.05, 1.78, 0.0, 0.13, 0.05, 0.13, 8, 4); };
  D.newspaper_rack = f => { f.col('#3a2418'); f.box(-0.32, 0, -0.18, 0.32, 1.2, -0.14); for (let k = 0; k < 3; k++) { const y = 0.35 + k * 0.32; f.col(C.brass); f.rod([-0.3, y, -0.05], [0.3, y, -0.05], 0.01, 4); f.col(['#ece6da', '#e8e2d0', '#f2ede0'][k]); f.box(-0.26, y - 0.22, -0.12, 0.26, y, -0.08); f.col('#1b1c1f'); f.box(-0.2, y - 0.06, -0.079, 0.2, y - 0.03, -0.078); } };
  // ---------------------------------------------------------------- phase 1b: the book café's own pieces (cozy)
  D.bookshelf_divider = f => {   // a free-standing shelf open both sides: books facing both ways, the rooms of the book café
    f.col(C.walnut); f.box(-1.2, 0, -0.2, -1.16, 2.2, 0.2); f.box(1.16, 0, -0.2, 1.2, 2.2, 0.2); f.box(-1.2, 2.16, -0.2, 1.2, 2.2, 0.2);
    const book = ['#7a2a22', '#1f3a5a', '#2f4f2f', '#8a6a2a', '#4a2a4a', '#c9b48a', '#3a3a3a', '#a04a2a'];
    for (let r = 0; r < 5; r++) { const y = 0.08 + r * 0.42; f.col(C.walnut); f.box(-1.16, y - 0.03, -0.2, 1.16, y, 0.2);
      for (const side of [-1, 1]) for (let x = -1.12, k = r + (side > 0 ? 3 : 0); x < 1.1; k++) { const w = 0.035 + ((k * 7) % 5) * 0.008, h = 0.26 + ((k * 3) % 4) * 0.025; if ((k * 13) % 11 === 0) { x += 0.12; continue; } f.col(book[k % book.length]); f.box(x, y, side > 0 ? 0.0 : -0.17, x + w, y + h, side > 0 ? 0.17 : 0.0); x += w + 0.004; } }
    plant(f, 0.6, 2.2, 0, 0.5);
  };
  D.library_table = f => {   // a long reading table with two green banker's lamps and four chairs
    f.col(C.walnut); f.box(-1.0, 0.72, -0.48, 1.0, 0.78, 0.48); for (const [x, z] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) f.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.72, z + 0.04);
    for (const x of [-0.45, 0.45]) { f.col(C.brass); f.cyl(x, 0, 0.06, 0.78, 0.8, 8); f.rod([x, 0.8, 0], [x, 1.05, 0], 0.01, 4); f.col('#1f5a3a', 0, 2); f.cyl(x, 0, 0.12, 1.02, 1.1, 12, 0.05); }
    for (const [x, z, yaw] of [[-0.45, -0.75, 0], [0.45, -0.75, 0], [-0.45, 0.75, P], [0.45, 0.75, P]]) bentwood(f, x, z, yaw);
    for (let k = 0; k < 3; k++) { f.col(['#7a2a22', '#1f3a5a', '#8a6a2a'][k]); f.box(0.1 + k * 0.05, 0.78, 0.1, 0.14 + k * 0.05, 0.96, 0.3); }
  };
  D.globe_stand = f => { f.col(C.walnut); for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; f.rod([0, 0.6, 0], [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25], 0.025, 5); } f.col(C.brass); f.lathe(0, 0, [[0.3, 0.92], [0.31, 0.96], [0.3, 1.0]], 20); f.col('#2f6a8a'); f.sph(0, 0.96, 0, 0.28, 0.28, 0.28, 16, 10); f.col('#c9b07a'); f.sph(0.08, 1.05, 0.15, 0.13, 0.1, 0.12, 8, 5); f.sph(-0.12, 0.88, -0.14, 0.12, 0.12, 0.1, 8, 5); };

  // ---------------------------------------------------------------- phase 1b part 3: the roastery's own pieces (Nordic modern)
  D.paper_pendant = f => {   // three paper lanterns at different heights, glowing at night
    for (const [x, z, y, r] of [[-0.28, -0.2, 2.25, 0.3], [0.32, 0.12, 2.42, 0.23], [-0.04, 0.36, 2.02, 0.19]]) {
      f.col(C.black); f.rod([x, 2.97, z], [x, y + r * 0.9, z], 0.005, 4);
      f.col('#f6efe2', 0, 2); f.sph(x, y, z, r, r * 0.88, r, 14, 8);
      f.col('#d8cdb8'); for (const k of [-0.45, 0, 0.45]) f.cyl(x, z, r * Math.sqrt(1 - k * k) + 0.004, y + k * r * 0.88 - 0.006, y + k * r * 0.88 + 0.006, 14);
    }
  };
  D.plant_wall = f => {   // a living wall: an oak frame of moss and ferns over a planter, lit from above
    f.col(C.oak); f.box(-1.25, 0, -0.04, 1.25, 0.34, 0.22); f.box(-1.25, 0.34, -0.04, 1.25, 2.7, 0.0); f.box(-1.25, 2.62, -0.04, 1.25, 2.7, 0.16);
    f.col('#2f5a2a'); f.box(-1.18, 0.38, 0.0, 1.18, 2.58, 0.04);
    const greens = ['#3f7a3a', '#5c9a4a', '#2e6a36', '#6aa85a', '#4a8a3f'];
    for (let j = 0; j < 9; j++) for (let i = 0; i < 10; i++) {
      const u = ((i * 7 + j * 13) % 5) / 5, x = -1.06 + i * 0.235 + (u - 0.5) * 0.08, y = 0.5 + j * 0.24 + (u - 0.5) * 0.06;
      if ((i * 3 + j * 5) % 17 === 0) { f.col(['#f2f2f2', '#f1c453', '#e57a9a'][(i + j) % 3]); f.sph(x, y, 0.08, 0.05, 0.05, 0.04, 6, 4); continue; }
      f.col(greens[(i + j * 2) % 5]); f.sph(x, y, 0.07, 0.1 + u * 0.04, 0.09 + u * 0.03, 0.06 + u * 0.03, 6, 4);
    }
    plant(f, -0.7, 0.34, 0.1, 0.55); plant(f, 0.1, 0.34, 0.1, 0.6); plant(f, 0.85, 0.34, 0.1, 0.5);
    f.col('#fff4dc', 0, 1); f.box(-1.2, 2.58, 0.02, 1.2, 2.62, 0.14);
  };
  D.slat_wall = f => {   // vertical oak slats on a dark backing, a warm light along the foot
    f.col('#3a2a1e'); f.box(-1.25, 0, -0.03, 1.25, 2.8, 0.0);
    for (let k = 0, x = -1.22; x < 1.2; k++, x += 0.1) { f.col(k % 2 ? '#c9a878' : '#bf9c6c'); f.box(x, 0.0, 0.0, x + 0.06, 2.8, 0.06); }
    f.col('#ffd9a0', 0, 1); f.box(-1.2, 0.02, 0.06, 1.2, 0.04, 0.07);
  };
  // ---------------------------------------------------------------- phase 1b part 3: the coffee lab's own pieces (industrial)
  D.mesh_partition = f => {   // a steel frame of mesh over a planter trough: a see-through wall
    f.col(C.steel); f.box(-1.05, 0, -0.22, 1.05, 0.45, 0.22);
    f.col('#4a3524'); f.box(-1.0, 0.45, -0.18, 1.0, 0.47, 0.18);
    for (const x of [-0.75, -0.2, 0.35, 0.8]) plant(f, x, 0.47, 0, 0.5, (x > 0 ? C.leaf2 : C.leaf));
    f.col(C.black); for (const x of [-1.0, 1.0]) f.box(x - 0.03, 0.45, -0.03, x + 0.03, 2.0, 0.03); f.box(-1.0, 1.96, -0.03, 1.0, 2.0, 0.03);
    for (let x = -0.9; x < 0.95; x += 0.12) f.rod([x, 0.47, 0], [x, 1.96, 0], 0.005, 3);
    for (let y = 0.6; y < 1.95; y += 0.12) f.rod([-0.97, y, 0], [0.97, y, 0], 0.005, 3);
  };
  D.neon_coffee = f => {   // the word COFFEE in warm neon tube on a clear backer
    f.glass('#cfd8dc'); f.box(-1.0, 1.82, -0.03, 1.0, 2.38, 0.0);
    const strokes = {
      C: [[...Array(8)].map((_, k) => { const a = (45 + k * 270 / 7) * Math.PI / 180; return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]; })],
      O: [[...Array(13)].map((_, k) => { const a = k / 12 * TAU; return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]; })],
      F: [[[0, 0], [0, 1], [1, 1]], [[0, 0.52], [0.75, 0.52]]],
      E: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.5], [0.8, 0.5]]],
    };
    f.col('#ff9a3a', 0, 1);
    [...'COFFEE'].forEach((ch, n) => { const x0 = -0.93 + n * 0.32, y0 = 1.9, w = 0.24, h = 0.4;
      for (const line of strokes[ch]) for (let k = 1; k < line.length; k++) f.rod([x0 + line[k - 1][0] * w, y0 + line[k - 1][1] * h, 0.025], [x0 + line[k][0] * w, y0 + line[k][1] * h, 0.025], 0.014, 5); });
  };
  D.chalk_wall = f => {   // a chalkboard wall: the day's brews in chalk, a drawn cup with its steam
    f.col(C.walnut); f.box(-1.25, 0.9, -0.03, 1.25, 2.6, 0.0);
    f.col('#26302b'); f.box(-1.2, 0.95, 0.0, 1.2, 2.55, 0.01);
    f.col('#f2f0ea'); f.box(-1.05, 2.3, 0.01, -0.25, 2.38, 0.013);
    for (let k = 0; k < 6; k++) { const y = 2.12 - k * 0.17; f.col('#e8e6df'); f.box(-1.05, y, 0.01, -1.05 + 0.4 + ((k * 7) % 4) * 0.08, y + 0.035, 0.013); f.col(['#f1c453', '#e57a6a', '#7fc4d8'][k % 3]); f.box(-0.32, y, 0.01, -0.2, y + 0.035, 0.013); }
    f.col('#f2f0ea'); f.box(0.25, 1.2, 0.01, 0.29, 1.65, 0.013); f.box(0.81, 1.2, 0.01, 0.85, 1.65, 0.013); f.box(0.25, 1.16, 0.01, 0.85, 1.2, 0.013);
    for (let k = 0; k < 6; k++) { const a = k / 5 * P - H; f.rod([0.85 + 0.1 * Math.cos(a) * 0.4, 1.42 + 0.1 * Math.sin(a), 0.012], [0.85 + 0.1 * Math.cos(a + P / 5) * 0.4 + 0.04, 1.42 + 0.1 * Math.sin(a + P / 5), 0.012], 0.01, 3); }
    f.col('#e8e6df'); for (const x of [0.42, 0.55, 0.68]) for (let k = 0; k < 4; k++) f.rod([x + (k % 2 ? 0.03 : -0.03), 1.72 + k * 0.08, 0.012], [x + (k % 2 ? -0.03 : 0.03), 1.8 + k * 0.08, 0.012], 0.008, 3);
    f.col('#f1c453'); f.box(0.2, 2.25, 0.01, 0.95, 2.4, 0.013);
  };
  D.cold_brew_tower = f => {   // a slow-drip cold brew tower: ice water drips through the coffee, down a glass coil, into the carafe
    f.col(C.walnut); f.box(-0.3, 0, -0.3, 0.3, 0.08, 0.3); for (const x of [-0.24, 0.24]) f.box(x - 0.03, 0.08, -0.03, x + 0.03, 1.92, 0.03); f.box(-0.27, 1.86, -0.05, 0.27, 1.92, 0.05);
    f.box(-0.24, 1.36, -0.05, 0.24, 1.4, 0.05); f.box(-0.24, 0.92, -0.05, 0.24, 0.96, 0.05);
    f.glass('#e3f0f5'); f.sph(0, 1.62, 0, 0.15, 0.2, 0.15, 12, 8); f.glass('#c9e3ee'); f.sph(0, 1.55, 0, 0.12, 0.1, 0.12, 10, 6);
    f.col(C.brass); f.cyl(0, 0, 0.016, 1.36, 1.43, 6);
    f.glass('#e3f0f5'); f.cyl(0, 0, 0.1, 1.1, 1.34, 12); f.col('#3a2418'); f.cyl(0, 0, 0.09, 1.1, 1.22, 12);
    f.glass('#d9eaf0'); for (let k = 0; k < 20; k++) { const a = k * 0.7, b = (k + 1) * 0.7; f.rod([Math.cos(a) * 0.07, 1.08 - k * 0.01, Math.sin(a) * 0.07], [Math.cos(b) * 0.07, 1.07 - k * 0.01, Math.sin(b) * 0.07], 0.01, 4); }
    f.glass('#e3f0f5'); f.sph(0, 0.42, 0, 0.15, 0.22, 0.15, 12, 8); f.col('#2a160c'); f.sph(0, 0.34, 0, 0.12, 0.11, 0.12, 10, 6);
  };
  // ---------------------------------------------------------------- phase 1b part 3: the garden's own pieces (romantic classic)
  D.hedge_planter = f => {   // a clipped boxwood hedge in a stone trough
    f.tint('#d9d2c4'); f.box(-1.0, 0, -0.3, 1.0, 0.45, 0.3); f.box(-1.03, 0.42, -0.33, 1.03, 0.48, 0.33);
    f.col('#2f5a2a'); f.box(-0.95, 0.48, -0.25, 0.95, 1.02, 0.25);
    for (let x = -0.8; x < 0.85; x += 0.32) { f.col('#3a6a32'); f.sph(x, 1.02, 0, 0.2, 0.11, 0.26, 8, 4); f.col('#467a3a'); f.sph(x + 0.1, 0.8, 0.24, 0.14, 0.16, 0.05, 6, 4); f.sph(x - 0.08, 0.72, -0.24, 0.14, 0.16, 0.05, 6, 4); }
  };
  D.flower_bed = f => {   // a raised bed of flowers
    f.tint('#b9a48a'); f.box(-0.9, 0, -0.4, 0.9, 0.4, 0.4);
    f.col('#4a3524'); f.box(-0.85, 0.4, -0.35, 0.85, 0.44, 0.35);
    const bloom = ['#e24a5a', '#f1c453', '#f2f2f2', '#c77dd8', '#ff8fb0', '#f08a3a'];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) { const x = -0.72 + i * 0.24 + (j % 2) * 0.1, z = -0.22 + j * 0.22, y = 0.58 + ((i * 5 + j * 3) % 4) * 0.04;
      f.col(C.leaf); f.sph(x, 0.5, z, 0.1, 0.07, 0.1, 6, 3); f.rod([x, 0.44, z], [x, y, z], 0.008, 3); f.col(bloom[(i * 2 + j) % bloom.length]); f.sph(x, y, z, 0.05, 0.04, 0.05, 6, 4); }
  };
  D.vine_trellis = f => {   // a timber trellis hung under the ceiling, grown with vines, strung with festoon lights
    f.col('#6a4a30'); for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) f.rod([x, 2.97, z], [x, 2.6, z], 0.012, 4);
    for (const z of [-1.4, -0.7, 0, 0.7, 1.4]) f.box(-1.45, 2.56, z - 0.03, 1.45, 2.62, z + 0.03);
    for (const x of [-1.4, 1.4]) f.box(x - 0.04, 2.5, -1.45, x + 0.04, 2.56, 1.45);
    for (let k = 0; k < 22; k++) { const x = -1.3 + ((k * 7) % 11) * 0.26, z = [-1.4, -0.7, 0, 0.7, 1.4][k % 5], len = 0.2 + ((k * 3) % 5) * 0.1;
      f.col(k % 2 ? C.leaf : C.leaf2); f.sph(x, 2.6, z, 0.16, 0.08, 0.12, 6, 3); f.rod([x, 2.56, z], [x + 0.03, 2.56 - len, z], 0.02, 3); if (k % 4 === 0) { f.col('#c77dd8'); f.sph(x + 0.03, 2.54 - len, z, 0.05, 0.07, 0.05, 6, 4); } }
    for (const z of [-0.35, 0.35]) { let last = null;
      for (let x = -1.4; x <= 1.41; x += 0.2) { const y = 2.5 - 0.2 * (1 - (x / 1.4) ** 2), p = [x, y, z];
        if (last) { f.col(C.black); f.rod(last, p, 0.004, 3); } f.col('#ffd9a0', 0, 2); f.sph(x, y - 0.04, z, 0.03, 0.04, 0.03, 6, 4); last = p; } }
  };
  D.birdcage = f => {   // a brass birdcage hung from the ceiling, a canary on its perch
    f.col(C.brass); f.rod([0, 2.97, 0], [0, 2.46, 0], 0.006, 4); f.sph(0, 2.44, 0, 0.03, 0.03, 0.03, 6, 4);
    f.cyl(0, 0, 0.21, 1.92, 1.96, 16); f.cyl(0, 0, 0.215, 2.22, 2.24, 16);
    for (let k = 0; k < 14; k++) { const a = k / 14 * TAU, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2; f.rod([x, 1.96, z], [x, 2.3, z], 0.005, 3); f.rod([x, 2.3, z], [x * 0.3, 2.42, z * 0.3], 0.005, 3); }
    f.rod([-0.15, 2.04, 0], [0.15, 2.04, 0], 0.008, 4);
    f.col('#f1c453'); f.sph(0, 2.1, 0, 0.045, 0.05, 0.075, 8, 5); f.sph(0, 2.15, 0.055, 0.032, 0.032, 0.032, 6, 4); f.col('#f08a3a'); f.sph(0, 2.15, 0.09, 0.01, 0.01, 0.02, 4, 3);
    plant(f, 0, 1.96, 0.12, 0.25);
  };
  D.stone_urn = f => {   // a classical stone urn on its plinth, spilling flowers and ivy
    f.tint('#d9d2c4'); f.box(-0.32, 0, -0.32, 0.32, 0.14, 0.32);
    f.lathe(0, 0, [[0.2, 0.14], [0.24, 0.2], [0.11, 0.32], [0.13, 0.46], [0.3, 0.7], [0.34, 0.96], [0.3, 1.04], [0.35, 1.1]], 18);
    f.col('#4a3524'); f.cyl(0, 0, 0.31, 1.06, 1.08, 16);
    plant(f, 0, 1.08, 0, 0.9);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; f.col(k % 2 ? C.leaf : C.leaf2); f.rod([Math.cos(a) * 0.3, 1.08, Math.sin(a) * 0.3], [Math.cos(a) * 0.38, 0.7 + (k % 3) * 0.08, Math.sin(a) * 0.38], 0.03, 3); f.col(['#e24a5a', '#f2f2f2', '#ff8fb0'][k % 3]); f.sph(Math.cos(a + 0.4) * 0.2, 1.22 + (k % 2) * 0.06, Math.sin(a + 0.4) * 0.2, 0.05, 0.04, 0.05, 6, 4); }
  };
  // ---------------------------------------------------------------- a rug for any style's sitting group
  D.cafe_rug = f => {
    f.tint('#8a3a2a'); f.box(-1.7, 0, -1.2, 1.7, 0.012, 1.2);
    f.col('#e8dcc4'); for (const [x0, z0, x1, z1] of [[-1.55, -1.08, 1.55, -1.0], [-1.55, 1.0, 1.55, 1.08], [-1.58, -1.05, -1.5, 1.05], [1.5, -1.05, 1.58, 1.05]]) f.box(x0, 0.012, z0, x1, 0.015, z1);
    f.col('#d9a441'); f.cyl(0, 0, 0.42, 0.012, 0.016, 18); f.col('#2f3a4a'); f.cyl(0, 0, 0.26, 0.012, 0.018, 14);
    for (const s of [-1, 1]) { f.col('#d9a441'); f.box(s * 1.1 - 0.12, 0.012, -0.12, s * 1.1 + 0.12, 0.016, 0.12); }
  };

  // ---------------------------------------------------------------- Order Up's kitchen stations (phase 2): stainless,
  // each with what it holds out on it; +z the cook's side (the pass: +z the dining room's, the cook behind it at -z)
  const base = (f, w, d, h = 0.88) => {   // a stainless counter: kick, doors, top
    f.col('#2a2c30'); f.box(-w + 0.03, 0, -d + 0.03, w - 0.03, 0.08, d - 0.02);
    f.col('#b9bfc4'); f.box(-w, 0.08, -d, w, h, d);
    f.col('#8e959b'); for (let x = -w + 0.5; x < w - 0.1; x += 0.5) f.box(x - 0.005, 0.12, d, x + 0.005, h - 0.06, d + 0.004);
    f.col(C.chrome); for (let x = -w + 0.25; x < w; x += 0.5) f.rod([x - 0.08, h - 0.12, d + 0.03], [x + 0.08, h - 0.12, d + 0.03], 0.008, 4);
    f.col('#dfe3e7'); f.box(-w - 0.01, h, -d - 0.01, w + 0.01, h + 0.04, d + 0.01);
    return h + 0.04;
  };
  D.ou_fridge = f => {   // a tall glass-door fridge of milk, cream and fruit, lit inside
    f.col('#c4cacf'); f.box(-0.42, 0, -0.36, 0.42, 2.0, 0.3); f.col('#2a2c30'); f.box(-0.4, 0, -0.34, 0.4, 0.08, 0.3);
    f.col('#eef2f4'); f.box(-0.36, 0.12, -0.3, 0.36, 1.86, 0.28); f.col('#eaf6ff', 0, 1); f.box(-0.34, 1.84, -0.28, 0.34, 1.86, 0.2);
    for (let r = 0; r < 4; r++) { const y = 0.3 + r * 0.42; f.col('#d7dbe0'); f.box(-0.35, y - 0.02, -0.28, 0.35, y, 0.26);
      for (let k = 0; k < 5; k++) { const x = -0.27 + k * 0.135;
        if (r < 2) { f.col(k % 2 ? '#f6f6f2' : '#f0e6c8'); f.cyl(x, 0.05, 0.045, y, y + 0.24, 10, 0.03); f.col(k % 2 ? '#3a7ad9' : '#d9a441'); f.cyl(x, 0.05, 0.03, y + 0.24, y + 0.28, 8); }
        else { f.col(['#f08a3a', '#e24a5a', '#7ab648', '#f1c453', '#e24a5a'][(k + r) % 5]); f.sph(x, y + 0.06, 0.02, 0.055, 0.055, 0.055, 8, 6); f.sph(x + 0.04, y + 0.06, -0.1, 0.05, 0.05, 0.05, 8, 6); } } }
    f.glass('#cfe4ee'); f.box(-0.38, 0.1, 0.3, 0.38, 1.9, 0.32); f.col(C.chrome); f.rod([0.32, 0.7, 0.36], [0.32, 1.4, 0.36], 0.014, 6);
  };
  D.ou_pantry = f => {   // open shelves of crates and sacks: beans, flour, sugar, bread, fruit
    f.col(C.walnut); for (const x of [-0.58, 0.58]) f.box(x - 0.03, 0, -0.28, x + 0.03, 1.7, 0.26);
    for (let r = 0; r < 4; r++) { const y = 0.06 + r * 0.42; f.col('#7a5a3a'); f.box(-0.58, y - 0.03, -0.28, 0.58, y, 0.26);
      for (const [x, k] of [[-0.3, r], [0.27, r + 2]]) { f.col(C.oak); f.box(x - 0.22, y, -0.2, x + 0.22, y + 0.2, 0.2);
        const fill = ['#4a2a18', '#f2ebde', '#e8dcc0', '#c98b4a', '#e24a5a', '#7ab648'][k % 6];
        if (k % 6 === 3) for (let b = 0; b < 3; b++) { f.col(fill); f.sph(x - 0.12 + b * 0.12, y + 0.24, 0, 0.05, 0.05, 0.16, 8, 5); }
        else if (k % 6 >= 4) for (let b = 0; b < 6; b++) { f.col(fill); f.sph(x - 0.12 + (b % 3) * 0.12, y + 0.22, -0.08 + Math.floor(b / 3) * 0.16, 0.055, 0.055, 0.055, 8, 6); }
        else { f.col(fill); f.box(x - 0.2, y + 0.18, -0.18, x + 0.2, y + 0.21, 0.18); } } }
    f.col('#e8dcc0'); f.sph(0.0, 1.85, 0.0, 0.2, 0.16, 0.16, 10, 6); f.col('#b88a5a'); f.box(-0.05, 1.86, 0.15, 0.05, 1.96, 0.16);
  };
  D.ou_prep = f => {   // the prep counter: a chopping board, a knife, the day's vegetables and bread
    const y = base(f, 0.6, 0.34);
    f.col(C.oak); f.box(-0.4, y, -0.2, 0.25, y + 0.03, 0.22);
    f.col(C.chrome); f.box(-0.05, y + 0.03, 0.02, 0.2, y + 0.035, 0.06); f.col(C.black); f.box(0.2, y + 0.03, 0.025, 0.32, y + 0.05, 0.055);
    f.col('#e24a5a'); f.sph(-0.28, y + 0.07, -0.05, 0.05, 0.045, 0.05, 8, 6); f.sph(-0.18, y + 0.06, 0.08, 0.04, 0.035, 0.04, 8, 6);
    f.col('#7ab648'); f.sph(-0.3, y + 0.09, 0.1, 0.08, 0.07, 0.08, 8, 6); f.col('#f2f2ea'); for (let k = 0; k < 4; k++) f.cyl(-0.05 + k * 0.035, -0.08, 0.025, y + 0.03, y + 0.04, 8);
    f.col('#c98b4a'); f.sph(0.45, y + 0.07, -0.12, 0.08, 0.06, 0.18, 10, 6);
    f.col('#e8e6df'); f.cyl(0.45, 0.15, 0.12, y, y + 0.08, 12, 0.09);
  };
  D.ou_grinder = f => {   // two commercial grinders: glass hoppers of beans, the dosing chute, the portafilter fork; the knock box
    const y = base(f, 0.4, 0.34);
    for (const [x, body] of [[-0.17, '#1b1c1f'], [0.12, '#b9bfc4']]) {
      f.col(body); f.box(x - 0.08, y, -0.2, x + 0.08, y + 0.05, 0.12);   // (its foot)
      f.box(x - 0.07, y + 0.05, -0.18, x + 0.07, y + 0.36, -0.02);   // (the motor body)
      f.col('#2a2c30'); f.box(x - 0.075, y + 0.22, -0.02, x + 0.075, y + 0.25, 0.04);   // (the chute's shroud)
      f.col(C.chrome); f.box(x - 0.012, y + 0.17, 0.02, x + 0.012, y + 0.23, 0.07);   // (the chute)
      f.rod([x - 0.03, y + 0.12, 0.02], [x - 0.03, y + 0.12, 0.1], 0.006, 4); f.rod([x + 0.03, y + 0.12, 0.02], [x + 0.03, y + 0.12, 0.1], 0.006, 4);   // (the fork)
      f.col('#ff3a2a', 0, 1); f.box(x - 0.015, y + 0.3, -0.02, x + 0.015, y + 0.315, -0.015);
      f.col(C.chrome); f.cyl(x, -0.1, 0.05, y + 0.36, y + 0.38, 14);
      f.glass('#d9e6ec'); f.cyl(x, -0.1, 0.045, y + 0.38, y + 0.6, 14, 0.1);   // (the hopper)
      f.col('#4a2a18'); f.cyl(x, -0.1, 0.04, y + 0.38, y + 0.52, 12, 0.085);   // (beans)
      f.col('#1b1c1f'); f.cyl(x, -0.1, 0.105, y + 0.6, y + 0.62, 14);   // (its lid)
    }
    f.col('#1b1c1f'); f.box(0.27, y, 0.04, 0.39, y + 0.12, 0.28); f.col(C.chrome); f.rod([0.27, y + 0.11, 0.16], [0.39, y + 0.11, 0.16], 0.008, 5); f.col('#3a2418'); f.box(0.28, y + 0.12, 0.05, 0.38, y + 0.125, 0.27);
  };
  D.ou_espresso = f => {   // a two-group café espresso machine: stainless, its red front, two group heads with their portafilters,
    // pressure gauges, the drip tray's grate, a steam wand and the hot-water spout, cups warming on the rail on top
    const y = base(f, 0.6, 0.34), x0 = -0.44, x1 = 0.44, zb = -0.3, zf = 0.1, h = 0.44, steel = '#cfd4d9';
    f.col(steel); f.box(x0, y + 0.06, zb, x1, y + h, zf);   // (the body)
    f.col('#8e1b1b'); f.box(x0 + 0.03, y + 0.17, zf, x1 - 0.03, y + h - 0.05, zf + 0.012);   // (the front)
    f.col(steel); f.box(x0 - 0.01, y + h - 0.05, zb - 0.01, x1 + 0.01, y + h, zf + 0.03);   // (its top lip)
    f.col('#9aa1a6'); for (const x of [x0 + 0.002, x1 - 0.002]) f.box(x - 0.004, y + 0.06, zb, x + 0.004, y + h, zf);
    // the cup warmer and its rail, cups upside down
    f.col('#aeb4ba'); f.box(x0 + 0.02, y + h, zb + 0.02, x1 - 0.02, y + h + 0.01, zf);
    f.col(C.chrome); for (const [ax, az, bx, bz] of [[x0 + 0.02, zb + 0.02, x1 - 0.02, zb + 0.02], [x0 + 0.02, zf, x1 - 0.02, zf], [x0 + 0.02, zb + 0.02, x0 + 0.02, zf], [x1 - 0.02, zb + 0.02, x1 - 0.02, zf]]) f.rod([ax, y + h + 0.06, az], [bx, y + h + 0.06, bz], 0.007, 4);
    for (const [x, z] of [[x0 + 0.02, zb + 0.02], [x1 - 0.02, zb + 0.02], [x0 + 0.02, zf], [x1 - 0.02, zf]]) f.rod([x, y + h, z], [x, y + h + 0.06, z], 0.007, 4);
    for (let k = 0; k < 6; k++) { const cx = -0.32 + k * 0.13, cz = -0.12 + (k % 2) * 0.1; f.col('#f6f4ef'); f.cyl(cx, cz, 0.036, y + h + 0.01, y + h + 0.06, 10, 0.03); }
    // two group heads, their portafilters' handles out to the front, the buttons over each
    for (const gx of [-0.2, 0.2]) {
      f.col(C.chrome); f.cyl(gx, 0.15, 0.06, y + 0.2, y + 0.26, 16); f.box(gx - 0.05, y + 0.22, zf, gx + 0.05, y + 0.26, 0.15);
      f.col('#9aa1a6'); f.cyl(gx, 0.15, 0.052, y + 0.16, y + 0.2, 16);   // (the basket)
      f.col(C.black); f.rod([gx, y + 0.18, 0.2], [gx + 0.03, y + 0.16, 0.38], 0.016, 8); f.sph(gx + 0.03, y + 0.16, 0.385, 0.022, 0.022, 0.022, 8, 5);
      f.col('#e8e6df'); for (let k = 0; k < 4; k++) f.box(gx - 0.075 + k * 0.05, y + 0.31, zf + 0.012, gx - 0.045 + k * 0.05, y + 0.34, zf + 0.022);
      f.col('#5a9a4a', 0, 1); f.box(gx - 0.075, y + 0.355, zf + 0.012, gx - 0.065, y + 0.365, zf + 0.018);
    }
    // two gauges between the groups
    for (const gx of [-0.06, 0.06]) { f.col(C.chrome); f.sph(gx, y + 0.3, zf + 0.012, 0.042, 0.042, 0.01, 16, 6); f.col('#fbfaf6'); f.sph(gx, y + 0.3, zf + 0.02, 0.034, 0.034, 0.006, 16, 6); f.col('#c0392b'); f.box(gx - 0.002, y + 0.3, zf + 0.026, gx + 0.022, y + 0.304, zf + 0.028); }
    f.col(C.brass); f.sph(0, y + 0.37, zf + 0.014, 0.07, 0.018, 0.006, 16, 4);   // (the maker's plate)
    // the drip tray and its grate
    f.col('#2a2c30'); f.box(x0 + 0.02, y, -0.02, x1 - 0.02, y + 0.03, 0.3);
    f.col(C.chrome); for (let x = x0 + 0.05; x < x1 - 0.03; x += 0.035) f.box(x, y + 0.03, 0.0, x + 0.012, y + 0.036, 0.28);
    // the steam wand (left) and the hot-water spout (right), their knobs
    f.col(C.black); f.sph(x0 + 0.05, y + h - 0.02, zf + 0.04, 0.03, 0.03, 0.03, 10, 6); f.sph(x1 - 0.05, y + h - 0.02, zf + 0.04, 0.03, 0.03, 0.03, 10, 6);
    f.col(C.chrome); f.sph(x0 - 0.01, y + 0.33, 0.04, 0.02, 0.02, 0.02, 8, 5); f.rod([x0 - 0.01, y + 0.33, 0.04], [x0 - 0.07, y + 0.3, 0.12], 0.009, 6); f.rod([x0 - 0.07, y + 0.3, 0.12], [x0 - 0.08, y + 0.08, 0.16], 0.008, 6);
    f.rod([x1 + 0.005, y + 0.32, 0.04], [x1 + 0.04, y + 0.3, 0.1], 0.01, 6); f.rod([x1 + 0.04, y + 0.3, 0.1], [x1 + 0.04, y + 0.2, 0.1], 0.01, 6);
    f.col(C.black); f.cyl(0.52, 0.12, 0.03, y, y + 0.07, 10); f.col(C.chrome); f.cyl(0.52, 0.12, 0.045, y + 0.07, y + 0.1, 12);   // (the tamper)
  };
  D.ou_steamer = f => {   // the milk station: a polished steam boiler with its gauge, two long steam wands over a drip tray, steel pitchers, the milk
    const y = base(f, 0.4, 0.34), bx = -0.13, bz = -0.13, r = 0.15;
    f.col('#2a2c30'); f.box(bx - 0.17, y, bz - 0.17, bx + 0.17, y + 0.04, bz + 0.17);   // (its base)
    f.col('#d7dbe0'); f.cyl(bx, bz, r, y + 0.04, y + 0.42, 24); f.sph(bx, y + 0.42, bz, r, 0.07, r, 24, 8);   // (the boiler, its dome)
    f.col('#aeb4ba'); for (const yy of [0.12, 0.34]) f.cyl(bx, bz, r + 0.005, y + yy, y + yy + 0.015, 24);   // (its bands)
    f.col(C.chrome); f.cyl(bx, bz, 0.02, y + 0.48, y + 0.53, 8); f.col(C.black); f.sph(bx, y + 0.545, bz, 0.025, 0.02, 0.025, 8, 5);   // (the relief valve)
    f.col(C.chrome); f.sph(bx, y + 0.27, bz + r, 0.055, 0.055, 0.012, 18, 6); f.col('#fbfaf6'); f.sph(bx, y + 0.27, bz + r + 0.008, 0.045, 0.045, 0.006, 18, 6);   // (the gauge)
    f.col('#c0392b'); f.box(bx - 0.002, y + 0.27, bz + r + 0.014, bx + 0.03, y + 0.274, bz + r + 0.016);
    // two wands, each from a ball joint by a valve knob, down over the tray
    for (const [jx, tx] of [[bx - 0.08, -0.16], [bx + 0.1, 0.06]]) {
      f.col(C.black); f.box(jx - 0.02, y + 0.4, bz + r - 0.02, jx + 0.02, y + 0.44, bz + r + 0.03); f.rod([jx, y + 0.44, bz + r + 0.01], [jx, y + 0.5, bz + r + 0.01], 0.008, 5);
      f.col(C.chrome); f.sph(jx, y + 0.36, bz + r + 0.02, 0.022, 0.022, 0.022, 8, 5);
      f.rod([jx, y + 0.36, bz + r + 0.02], [tx, y + 0.3, 0.12], 0.009, 6); f.rod([tx, y + 0.3, 0.12], [tx + 0.02, y + 0.07, 0.17], 0.008, 6);
      f.sph(tx + 0.02, y + 0.07, 0.17, 0.012, 0.016, 0.012, 6, 4);
    }
    f.col('#2a2c30'); f.box(-0.3, y, 0.04, 0.2, y + 0.03, 0.3); f.col(C.chrome); for (let x = -0.28; x < 0.18; x += 0.035) f.box(x, y + 0.03, 0.06, x + 0.012, y + 0.036, 0.28);
    // pitchers, a jug of milk
    for (const [x, z] of [[0.28, 0.14], [0.3, -0.04]]) { f.col(C.chrome); f.cyl(x, z, 0.05, y, y + 0.12, 14, 0.042); f.box(x - 0.07, y + 0.05, z - 0.008, x - 0.045, y + 0.1, z + 0.008); }
    f.col('#f6f6f2'); f.cyl(0.22, -0.2, 0.055, y, y + 0.2, 12, 0.04); f.col('#3a7ad9'); f.cyl(0.22, -0.2, 0.035, y + 0.2, y + 0.24, 8); f.box(0.165, y + 0.06, -0.21, 0.168, y + 0.14, -0.19);
  };
  D.ou_oven = f => {   // a two-deck oven on its stand, the decks glowing, a tray of loaves under it
    f.col('#2a2c30'); for (const [x, z] of [[-0.45, -0.32], [0.45, -0.32], [-0.45, 0.3], [0.45, 0.3]]) f.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.5, z + 0.03);
    f.col('#b9bfc4'); f.box(-0.48, 0.18, -0.34, 0.48, 0.2, 0.32);
    for (let k = 0; k < 3; k++) { f.col('#c98b4a'); f.sph(-0.25 + k * 0.25, 0.25, 0.0, 0.06, 0.05, 0.22, 8, 5); }
    f.col('#3e4246'); f.box(-0.5, 0.5, -0.38, 0.5, 1.62, 0.34);
    for (const y of [0.62, 1.1]) { f.col(C.chrome); f.box(-0.44, y, 0.34, 0.44, y + 0.4, 0.36); f.col('#ff9a3a', 0, 1); f.box(-0.32, y + 0.08, 0.36, 0.32, y + 0.3, 0.365); f.col(C.chrome); f.rod([-0.3, y + 0.36, 0.42], [0.3, y + 0.36, 0.42], 0.012, 5); }
    f.col(C.black); for (const x of [-0.36, -0.2]) f.cyl(x, 0.35, 0.03, 1.56, 1.58, 8); f.col('#ff3a2a', 0, 1); f.sph(0.38, 1.57, 0.35, 0.012, 0.012, 0.01, 4, 3);
  };
  D.ou_press = f => {   // the sandwich press: ridged plates, the lid a little open, its light on
    const y = base(f, 0.4, 0.34);
    f.col('#1b1c1f'); f.box(-0.25, y, -0.22, 0.25, y + 0.08, 0.2); f.col('#3e4246'); for (let x = -0.2; x < 0.21; x += 0.05) f.box(x - 0.008, y + 0.08, -0.18, x + 0.008, y + 0.09, 0.16);
    f.col('#c98b4a'); f.box(-0.12, y + 0.09, -0.08, 0.12, y + 0.13, 0.08);
    f.col('#1b1c1f'); f.box(-0.25, y + 0.16, -0.24, 0.25, y + 0.24, 0.16); f.col(C.chrome); f.rod([-0.18, y + 0.22, 0.2], [0.18, y + 0.22, 0.2], 0.012, 5);
    f.col('#ff3a2a', 0, 1); f.sph(0.22, y + 0.05, 0.205, 0.012, 0.012, 0.006, 4, 3);
  };
  D.ou_blender = f => {   // two countertop blenders on their bases (dials, a light), square jars, one of berries; a bowl of fruit
    const y = base(f, 0.4, 0.34);
    for (const [x, fill] of [[-0.17, '#e57a9a'], [0.07, null]]) {
      f.col('#1b1c1f'); f.box(x - 0.085, y, -0.17, x + 0.085, y + 0.13, -0.01); f.col('#2a2c30'); f.box(x - 0.06, y + 0.13, -0.15, x + 0.06, y + 0.15, -0.03);
      f.col(C.chrome); f.sph(x, y + 0.065, -0.008, 0.028, 0.028, 0.01, 12, 5); f.col('#5a9a4a', 0, 1); f.box(x + 0.045, y + 0.1, -0.009, x + 0.06, y + 0.11, -0.006);
      f.glass('#e3f0f5'); f.cyl(x, -0.09, 0.07, y + 0.15, y + 0.42, 4, 0.085);   // (the square jar)
      if (fill) { f.col(fill); f.cyl(x, -0.09, 0.064, y + 0.16, y + 0.32, 4, 0.072); }
      f.col('#1b1c1f'); f.cyl(x, -0.09, 0.088, y + 0.42, y + 0.45, 4); f.cyl(x, -0.09, 0.025, y + 0.45, y + 0.47, 8);
      f.box(x + 0.07, y + 0.22, -0.1, x + 0.1, y + 0.38, -0.08);   // (its handle)
    }
    f.col('#e8e6df'); f.cyl(0.28, 0.12, 0.1, y, y + 0.06, 14, 0.07);
    for (const [dx, dz, c] of [[0, 0, '#f1c453'], [0.05, 0.04, '#e24a5a'], [-0.04, 0.05, '#7ab648'], [0.03, -0.04, '#7a2a5a']]) { f.col(c); f.sph(0.28 + dx, y + 0.08, 0.12 + dz, 0.04, 0.04, 0.04, 8, 6); }
  };
  // ---- the appliances a menu calls for beyond the coffee bar's (shared/appliances.js; the product owner 2026-10-28: "to add
  // fries to the menu, you will need a fryer"): +z the cook's side, as the stations above
  D.ou_kettle = f => {   // the tea station: a steel hot-water urn with its tap over a drip tray, an electric kettle, tea tins, cups on saucers
    const y = base(f, 0.4, 0.34), ux = -0.2, uz = -0.14;
    f.col('#d7dbe0'); f.cyl(ux, uz, 0.12, y, y + 0.4, 20); f.sph(ux, y + 0.4, uz, 0.12, 0.05, 0.12, 20, 6);   // (the urn, its lid)
    f.col(C.black); f.cyl(ux, uz, 0.03, y + 0.44, y + 0.47, 8); f.col('#aeb4ba'); for (const yy of [0.1, 0.3]) f.cyl(ux, uz, 0.123, y + yy, y + yy + 0.012, 20);
    f.col(C.chrome); f.box(ux - 0.025, y + 0.08, uz + 0.11, ux + 0.025, y + 0.12, uz + 0.17); f.rod([ux, y + 0.1, uz + 0.17], [ux, y + 0.06, uz + 0.19], 0.008, 6);   // (its tap)
    f.col(C.black); f.box(ux - 0.015, y + 0.12, uz + 0.14, ux + 0.015, y + 0.17, uz + 0.155);
    f.col('#2a2c30'); f.box(ux - 0.08, y, uz + 0.14, ux + 0.08, y + 0.02, uz + 0.28); f.col(C.chrome); for (let x = ux - 0.07; x < ux + 0.07; x += 0.03) f.box(x, y + 0.02, uz + 0.15, x + 0.01, y + 0.025, uz + 0.27);
    // the electric kettle on its base, its handle and spout, the light on
    const kx = 0.2, kz = 0.1;
    f.col('#1b1c1f'); f.cyl(kx, kz, 0.085, y, y + 0.02, 18); f.col('#e9ecef'); f.cyl(kx, kz, 0.08, y + 0.02, y + 0.2, 18, 0.06); f.col('#1b1c1f'); f.cyl(kx, kz, 0.045, y + 0.2, y + 0.22, 12);
    f.box(kx + 0.06, y + 0.06, kz - 0.015, kx + 0.1, y + 0.2, kz + 0.015); f.col('#e9ecef'); f.rod([kx - 0.07, y + 0.12, kz], [kx - 0.13, y + 0.17, kz], 0.014, 6);
    f.col('#3a9ad9', 0, 1); f.sph(kx + 0.08, y + 0.035, kz + 0.02, 0.008, 0.008, 0.006, 4, 3);
    // tea tins, a glass teapot, cups on their saucers
    for (const [k, c] of ['#2e6b4a', '#8e1b1b', '#1b1c1f'].entries()) { f.col(c); f.cyl(0.04 + k * 0.1, -0.2, 0.038, y, y + 0.12, 12); f.col(C.brass); f.cyl(0.04 + k * 0.1, -0.2, 0.04, y + 0.12, y + 0.14, 12); }
    f.glass('#e9e3c8'); f.sph(0.02, y + 0.08, 0.12, 0.07, 0.07, 0.07, 12, 8); f.col('#b7853f'); f.sph(0.02, y + 0.06, 0.12, 0.055, 0.04, 0.055, 10, 6);
    for (const x of [-0.3, -0.16]) { f.col('#f6f4ef'); f.cyl(x, 0.2, 0.06, y, y + 0.01, 14); f.cyl(x, 0.2, 0.038, y + 0.01, y + 0.07, 12, 0.03); }
  };
  D.ou_toaster = f => {   // a conveyor toaster: its loading rack on top, the glowing mouth, the tray the toast slides out onto; a bread basket, jam
    const y = base(f, 0.4, 0.34), x0 = -0.24, x1 = 0.14, zb = -0.28, zf = 0.06, h = 0.3;
    f.col('#c7ccd1'); f.box(x0, y + 0.03, zb, x1, y + h, zf); f.col('#8e959b'); f.box(x0 - 0.01, y + h, zb - 0.01, x1 + 0.01, y + h + 0.015, zf + 0.01);
    for (const x of [x0 + 0.02, x1 - 0.02]) { f.col(C.black); f.box(x - 0.02, y, zb + 0.02, x + 0.02, y + 0.03, zb + 0.06); f.box(x - 0.02, y, zf - 0.06, x + 0.02, y + 0.03, zf - 0.02); }
    f.col('#1b1c1f'); f.box(x0 + 0.04, y + 0.1, zf, x1 - 0.04, y + 0.2, zf + 0.005); f.col('#ff6a2a', 0, 1); f.box(x0 + 0.06, y + 0.12, zf + 0.005, x1 - 0.06, y + 0.18, zf + 0.008);   // (its glowing mouth)
    f.col(C.chrome); for (let x = x0 + 0.03; x < x1 - 0.02; x += 0.035) f.rod([x, y + h + 0.02, zb + 0.02], [x, y + h + 0.1, zb - 0.06], 0.004, 4);   // (the loading rack)
    f.col('#e8d3a8'); f.box(x0 + 0.05, y + h + 0.03, zb - 0.02, x0 + 0.17, y + h + 0.045, zb + 0.08);
    f.col(C.chrome); f.box(x0 + 0.02, y + 0.04, zf, x1 - 0.02, y + 0.05, zf + 0.16);   // (the tray out front: Order Up's bread comes out onto it)
    f.col(C.black); for (const [k, c] of [['#c0392b', 0], ['#e8e6df', 1]].entries()) { f.col(c[0]); f.sph(x1 + 0.005, y + 0.22 - k * 0.07, zf - 0.08, 0.02, 0.02, 0.02, 8, 5); }
    // a bread basket and a jar of jam
    f.col('#a87a44'); f.box(0.2, y, -0.2, 0.36, y + 0.08, 0.02); f.col('#8a6034'); f.box(0.21, y + 0.01, -0.19, 0.35, y + 0.075, 0.01);
    for (const z of [-0.15, -0.09, -0.03]) { f.col('#e8d3a8'); f.box(0.23, y + 0.05, z - 0.02, 0.33, y + 0.14, z + 0.015); f.col('#c98b4a'); f.box(0.228, y + 0.135, z - 0.022, 0.332, y + 0.15, z + 0.017); }
    f.glass('#f0d7d7'); f.cyl(0.28, 0.18, 0.04, y, y + 0.09, 12); f.col('#9a1b3a'); f.cyl(0.28, 0.18, 0.034, y + 0.005, y + 0.07, 12); f.col('#e8e6df'); f.cyl(0.28, 0.18, 0.043, y + 0.09, y + 0.11, 12);
  };
  D.ou_juicer = f => {   // the juice station: a squeezer with oranges in its hopper, its spout over the drip tray, a citrus press, a pitcher, the fruit
    const y = base(f, 0.4, 0.34), jx = -0.18;
    f.col('#2a2c30'); f.box(jx - 0.14, y, -0.28, jx + 0.14, y + 0.3, 0.0); f.col('#e65a1e'); f.box(jx - 0.13, y + 0.18, 0.0, jx + 0.13, y + 0.27, 0.006);   // (the squeezer, its orange band)
    f.glass('#e3f0f5'); f.box(jx - 0.12, y + 0.3, -0.27, jx + 0.12, y + 0.48, -0.03);   // (its hopper, oranges in it)
    for (let k = 0; k < 7; k++) { f.col(k % 3 ? '#f28c1e' : '#f5a23a'); f.sph(jx - 0.08 + (k % 4) * 0.055, y + 0.35 + Math.floor(k / 4) * 0.06, -0.2 + (k % 2) * 0.08, 0.04, 0.04, 0.04, 10, 7); }
    f.col(C.chrome); f.box(jx - 0.02, y + 0.13, 0.0, jx + 0.02, y + 0.17, 0.07); f.rod([jx, y + 0.13, 0.06], [jx, y + 0.11, 0.07], 0.008, 6);
    f.col('#2a2c30'); f.box(jx - 0.08, y, 0.0, jx + 0.08, y + 0.01, 0.16);
    // the citrus press: its chrome cone, half oranges by it
    f.col('#3e4246'); f.cyl(0.18, -0.16, 0.09, y, y + 0.12, 16); f.col(C.chrome); f.cyl(0.18, -0.16, 0.075, y + 0.12, y + 0.14, 16); f.cyl(0.18, -0.16, 0.012, y + 0.14, y + 0.2, 10, 0.05);
    for (const [x, z] of [[0.3, -0.08], [0.32, 0.0]]) { f.col('#f28c1e'); f.sph(x, y + 0.03, z, 0.045, 0.03, 0.045, 10, 5); f.col('#f7c56a'); f.cyl(x, z, 0.04, y + 0.058, y + 0.062, 12); }
    f.glass('#eef6fa'); f.cyl(0.06, 0.12, 0.06, y, y + 0.22, 14, 0.055); f.col('#f29a1e'); f.cyl(0.06, 0.12, 0.054, y + 0.01, y + 0.17, 14, 0.05);   // (the pitcher)
    f.glass('#eef6fa'); f.box(0.115, y + 0.06, 0.11, 0.135, y + 0.18, 0.13);
    f.col('#e8e6df'); f.cyl(0.26, 0.16, 0.1, y, y + 0.06, 14, 0.075);   // (a bowl of oranges and lemons)
    for (const [dx, dz, c] of [[0, 0, '#f28c1e'], [0.05, 0.04, '#f4d03f'], [-0.04, 0.05, '#f28c1e'], [0.03, -0.04, '#f4d03f']]) { f.col(c); f.sph(0.26 + dx, y + 0.08, 0.16 + dz, 0.042, 0.04, 0.042, 8, 6); }
  };
  D.ou_griddle = f => {   // the flat-top griddle: a dark steel plate with its splash guards and grease trough, eggs and bacon on it, a spatula
    const y = base(f, 0.6, 0.36);
    f.col('#4a4d52'); f.box(-0.56, y, -0.32, 0.56, y + 0.05, 0.3); f.col('#2f3236'); f.box(-0.54, y + 0.05, -0.3, 0.54, y + 0.055, 0.24);   // (the plate)
    f.col('#c7ccd1'); f.box(-0.58, y, -0.36, 0.58, y + 0.22, -0.32); for (const x of [-0.58, 0.54]) f.box(x, y, -0.32, x + 0.04, y + 0.12, 0.2);   // (the splash guards)
    f.col('#1b1c1f'); f.box(-0.54, y + 0.03, 0.24, 0.54, y + 0.05, 0.3);   // (the grease trough)
    f.col('#c7ccd1'); f.box(-0.6, y - 0.12, 0.33, 0.6, y - 0.02, 0.37); f.col(C.black); for (const x of [-0.4, -0.13, 0.13, 0.4]) f.sph(x, y - 0.07, 0.38, 0.03, 0.03, 0.02, 10, 5);   // (the knobs)
    for (const [x, z] of [[0.02, -0.14], [0.14, -0.1]]) { f.col('#f8f6f0'); f.sph(x, y + 0.058, z, 0.06, 0.008, 0.05, 12, 4); f.col('#f2b31e'); f.sph(x + 0.005, y + 0.068, z, 0.022, 0.016, 0.022, 10, 6); }   // (eggs)
    for (let k = 0; k < 4; k++) { f.col(k % 2 ? '#a8443a' : '#8e3a2e'); f.box(0.24 + k * 0.05, y + 0.055, -0.2, 0.27 + k * 0.05, y + 0.066, 0.02); f.col('#e8b9a4'); f.box(0.245 + k * 0.05, y + 0.066, -0.18, 0.255 + k * 0.05, y + 0.067, 0.0); }   // (bacon)
    f.col(C.chrome); f.box(0.06, y + 0.056, 0.1, 0.18, y + 0.06, 0.2); f.col(C.black); f.rod([0.12, y + 0.06, 0.2], [0.12, y + 0.09, 0.34], 0.012, 6);   // (the spatula)
    f.col('#f1c453'); f.cyl(0.46, -0.24, 0.03, y + 0.05, y + 0.2, 8); f.col('#c0392b'); f.cyl(0.4, -0.24, 0.03, y + 0.05, y + 0.2, 8);   // (squeeze bottles on the plate's corner)
  };
  D.ou_grill = f => {   // the char grill: heavy grates over glowing coals, patties with their grill marks, a hood behind, tongs
    const y = base(f, 0.6, 0.36);
    f.col('#1b1c1f'); f.box(-0.56, y, -0.32, 0.56, y + 0.08, 0.3);   // (its firebox)
    f.col('#ff5a1e', 0, 1); f.box(-0.52, y + 0.02, -0.28, 0.52, y + 0.03, 0.26);   // (the coals' glow)
    for (let k = 0; k < 9; k++) { f.col(k % 2 ? '#ff8a2a' : '#c0391e', 0, 1); f.sph(-0.44 + k * 0.11, y + 0.04, -0.06 + (k % 3) * 0.1, 0.035, 0.02, 0.035, 6, 4); }
    f.col('#2b2b2e'); for (let x = -0.52; x <= 0.52; x += 0.045) f.box(x - 0.008, y + 0.08, -0.3, x + 0.008, y + 0.1, 0.28);   // (the grates)
    f.box(-0.54, y + 0.08, -0.3, 0.54, y + 0.1, -0.28); f.box(-0.54, y + 0.08, 0.26, 0.54, y + 0.1, 0.28);
    for (const [x, z] of [[-0.36, -0.16], [-0.16, -0.18]]) {   // (two patties at the back, their marks; the front free for Order Up's)
      f.col('#5a3220'); f.cyl(x, z, 0.075, y + 0.1, y + 0.13, 16); f.col('#2a1810'); for (let m = -1; m <= 1; m++) f.box(x - 0.06, y + 0.13, z + m * 0.03 - 0.006, x + 0.06, y + 0.132, z + m * 0.03 + 0.006);
    }
    f.col('#c7ccd1'); f.box(-0.6, y, -0.36, 0.6, y + 0.36, -0.32); f.box(-0.6, y + 0.36, -0.36, 0.6, y + 0.4, -0.2);   // (its hood)
    f.col('#8e959b'); for (let x = -0.5; x < 0.55; x += 0.1) f.box(x, y + 0.36, -0.205, x + 0.06, y + 0.37, -0.2);
    f.col(C.chrome); f.rod([0.38, y + 0.11, 0.24], [0.52, y + 0.12, 0.36], 0.008, 5); f.rod([0.4, y + 0.11, 0.22], [0.54, y + 0.12, 0.34], 0.008, 5);   // (tongs)
  };
  D.ou_fryer = f => {   // the deep fryer: a stainless cabinet, two wells of hot oil, a basket hung on its rack, one down in the oil, its controls
    f.col('#2a2c30'); f.box(-0.36, 0, -0.32, 0.36, 0.08, 0.3);
    f.col('#c7ccd1'); f.box(-0.38, 0.08, -0.34, 0.38, 0.9, 0.34); f.col('#8e959b'); f.box(-0.005, 0.12, 0.34, 0.005, 0.7, 0.344);
    f.col(C.chrome); for (const x of [-0.19, 0.19]) f.rod([x - 0.08, 0.6, 0.37], [x + 0.08, 0.6, 0.37], 0.008, 4);
    f.col('#3e4246'); f.box(-0.38, 0.72, 0.3, 0.38, 0.88, 0.36); f.col(C.black); for (const x of [-0.24, -0.1, 0.1, 0.24]) f.sph(x, 0.8, 0.365, 0.025, 0.025, 0.015, 10, 5);   // (its controls)
    f.col('#ff3a2a', 0, 1); f.sph(0.33, 0.83, 0.362, 0.01, 0.01, 0.006, 4, 3);
    f.col('#dfe3e7'); f.box(-0.39, 0.9, -0.35, 0.39, 0.93, 0.35);
    for (const x of [-0.19, 0.19]) { f.col('#1b1c1f'); f.box(x - 0.16, 0.929, -0.22, x + 0.16, 0.934, 0.24); f.col('#e0a92a', 0, 0.35); f.box(x - 0.145, 0.931, -0.205, x + 0.145, 0.937, 0.225); }   // (two wells of hot oil, their rims)
    f.col('#c7ccd1'); f.box(-0.38, 0.93, -0.36, 0.38, 1.24, -0.32);   // (the back, its basket rack)
    f.col(C.chrome); f.rod([-0.34, 1.12, -0.31], [0.34, 1.12, -0.31], 0.01, 5);
    // a basket hung up, one down in the oil
    f.col('#9aa1a6'); f.box(0.07, 0.95, -0.3, 0.31, 1.09, -0.16); f.col('#7a8186'); for (let x = 0.08; x < 0.31; x += 0.03) f.box(x, 0.95, -0.161, x + 0.006, 1.09, -0.158);
    f.col(C.black); f.rod([0.19, 1.08, -0.16], [0.19, 1.12, -0.31], 0.012, 5);
    f.col('#9aa1a6'); f.box(-0.31, 0.88, -0.14, -0.07, 0.99, 0.12); f.col(C.black); f.rod([-0.19, 0.99, 0.12], [-0.19, 1.05, 0.32], 0.014, 6);
  };
  D.ou_soda = f => {   // the soda fountain: its lit panel, six valves over the drip tray, the ice lid on top, cups stacked by it, one filled
    const y = base(f, 0.5, 0.34), x0 = -0.4, x1 = 0.22, zb = -0.3, zf = 0.0;
    f.col('#c7ccd1'); f.box(x0, y, zb, x1, y + 0.52, zf); f.col('#8e959b'); f.box(x0 - 0.01, y + 0.52, zb - 0.01, x1 + 0.01, y + 0.55, zf + 0.01);   // (its tower, the ice lid)
    f.col('#c0392b', 0, 0.6); f.box(x0 + 0.02, y + 0.3, zf, x1 - 0.02, y + 0.48, zf + 0.006);   // (the lit panel)
    f.col('#f6f4ef', 0, 0.6); f.box(x0 + 0.06, y + 0.37, zf + 0.006, x1 - 0.06, y + 0.41, zf + 0.008);
    for (let k = 0; k < 6; k++) {   // (the valves, each a lever and a nozzle, a coloured cap)
      const vx = x0 + 0.06 + k * 0.1;
      f.col('#1b1c1f'); f.box(vx - 0.03, y + 0.2, zf, vx + 0.03, y + 0.27, zf + 0.06); f.col(['#c0392b', '#2e7d32', '#f4d03f', '#5d3a1a', '#1565c0', '#f28c1e'][k]); f.box(vx - 0.03, y + 0.27, zf, vx + 0.03, y + 0.29, zf + 0.06);
      f.col(C.chrome); f.cyl(vx, zf + 0.03, 0.01, y + 0.17, y + 0.2, 6); f.col(C.black); f.rod([vx, y + 0.18, zf + 0.06], [vx, y + 0.12, zf + 0.08], 0.008, 4);
    }
    f.col('#2a2c30'); f.box(x0 + 0.02, y, zf, x1 - 0.02, y + 0.03, zf + 0.16); f.col(C.chrome); for (let x = x0 + 0.04; x < x1 - 0.03; x += 0.035) f.box(x, y + 0.03, zf + 0.02, x + 0.012, y + 0.035, zf + 0.15);
    f.col('#c0392b'); f.cyl(x0 + 0.26, zf + 0.08, 0.04, y + 0.03, y + 0.17, 12, 0.032); f.col('#f6f4ef'); f.cyl(x0 + 0.26, zf + 0.08, 0.042, y + 0.17, y + 0.18, 12);   // (a cup, filled, its lid)
    for (let k = 0; k < 2; k++) { const cx = 0.32 + k * 0.1; f.col('#c0392b'); f.cyl(cx, -0.12, 0.04, y, y + 0.3, 12, 0.032); f.col('#f6f4ef'); for (let r = 0; r < 6; r++) f.cyl(cx, -0.12, 0.0405, y + 0.02 + r * 0.05, y + 0.024 + r * 0.05, 12); }   // (cups stacked)
    f.col('#f6f4ef'); f.cyl(0.36, 0.14, 0.05, y, y + 0.08, 12); f.col('#e8e6df'); for (let r = 0; r < 4; r++) f.cyl(0.36, 0.14, 0.051, y + 0.01 + r * 0.02, y + 0.012 + r * 0.02, 12);   // (lids)
  };
  // the pizza oven, the stove and the wok (2026-10-28: an Italian's, a pizzeria's and an Asian kitchen's)
  D.ou_pizza_oven = f => {   // a wood-fired dome oven on its brick stand: the fire glowing in its mouth, logs stacked below, its flue, a peel
    f.col('#8a4a32'); f.box(-0.58, 0, -0.4, 0.58, 0.82, 0.38);   // (the stand)
    f.col('#6e3a26'); for (let y = 0.1; y < 0.8; y += 0.12) f.box(-0.585, y, 0.38, 0.585, y + 0.012, 0.385);   // (its courses)
    f.col('#1b1c1f'); f.box(-0.4, 0.08, 0.3, 0.4, 0.5, 0.39);   // (the log store)
    for (let k = 0; k < 7; k++) { f.col(k % 2 ? '#7a5a3a' : '#5e4128'); f.rod([-0.36 + (k % 4) * 0.02, 0.14 + Math.floor(k / 4) * 0.12 + (k % 2) * 0.05, 0.36], [0.36 - (k % 3) * 0.02, 0.14 + Math.floor(k / 4) * 0.12 + (k % 2) * 0.05, 0.36], 0.045, 8); }
    f.col('#d9cbb4'); f.box(-0.6, 0.82, -0.42, 0.6, 0.9, 0.42);   // (the hearth slab, the landing in front of the mouth)
    f.col('#c86a3a'); f.sph(0, 0.88, -0.06, 0.54, 0.56, 0.42, 22, 12);   // (the dome)
    f.col('#a85530'); f.sph(0, 0.88, -0.06, 0.545, 0.2, 0.425, 22, 6);
    f.col('#1b1c1f'); f.box(-0.2, 0.9, 0.28, 0.2, 1.16, 0.36);   // (its mouth, the fire in it)
    f.col('#ff7a2a', 0, 1); f.box(-0.17, 0.9, 0.36, 0.17, 1.02, 0.364); f.col('#ffc24a', 0, 1); f.sph(-0.06, 0.94, 0.364, 0.07, 0.05, 0.012, 8, 5); f.sph(0.07, 0.93, 0.364, 0.05, 0.04, 0.012, 8, 5);   // (the fire glowing in its mouth)
    f.col('#7a3a22'); f.box(-0.24, 1.14, 0.27, 0.24, 1.2, 0.4);   // (its arch)
    f.col('#3a3d42'); f.cyl(0, -0.2, 0.07, 1.3, 1.95, 12); f.col('#2a2c30'); f.cyl(0, -0.2, 0.09, 1.92, 1.97, 12);   // (the flue)
    f.col('#c9a878'); f.box(0.5, 0.9, 0.0, 0.58, 0.905, 0.36); f.rod([0.54, 0.905, 0.0], [0.54, 1.6, -0.3], 0.014, 6);   // (a peel leaning on it)
  };
  D.ou_stove = f => {   // a four-burner range: a stockpot and a saucepan at the back, a pot of water on the boil at the front, a burner free; the oven below
    const y = base(f, 0.5, 0.36);
    f.col('#1b1c1f'); f.box(-0.3, 0.16, 0.36, 0.3, 0.62, 0.365); f.glass('#3a3d42'); f.box(-0.24, 0.24, 0.365, 0.24, 0.52, 0.37);   // (the oven door, its window)
    f.col(C.chrome); f.rod([-0.26, 0.68, 0.39], [0.26, 0.68, 0.39], 0.012, 6);
    f.col('#2a2c30'); f.box(-0.5, y, -0.36, 0.5, y + 0.02, 0.36);   // (the top)
    for (const [x, z] of [[-0.24, -0.16], [0.24, -0.16], [-0.24, 0.16], [0.24, 0.16]]) {   // (the burners and their grates)
      f.col('#111214'); f.cyl(x, z, 0.12, y + 0.02, y + 0.03, 16); f.col('#3a5ad9', 0, 0.6); f.cyl(x, z, 0.05, y + 0.03, y + 0.035, 12);
      f.col('#1b1c1f'); f.box(x - 0.13, y + 0.035, z - 0.01, x + 0.13, y + 0.05, z + 0.01); f.box(x - 0.01, y + 0.035, z - 0.13, x + 0.01, y + 0.05, z + 0.13);
    }
    f.col('#c9ced3'); f.cyl(-0.24, -0.16, 0.13, y + 0.05, y + 0.32, 18); f.col('#aeb4ba'); f.cyl(-0.24, -0.16, 0.135, y + 0.32, y + 0.34, 18); f.col(C.black); f.cyl(-0.24, -0.16, 0.02, y + 0.34, y + 0.37, 8);   // (the stockpot, lidded)
    f.col('#c9ced3'); f.cyl(0.24, -0.16, 0.09, y + 0.05, y + 0.15, 16); f.col('#8a3a1a'); f.cyl(0.24, -0.16, 0.085, y + 0.15, y + 0.152, 16); f.col(C.black); f.rod([0.33, y + 0.13, -0.16], [0.48, y + 0.14, -0.16], 0.012, 6);   // (a saucepan of sauce)
    f.col('#c9ced3'); f.cyl(-0.24, 0.16, 0.12, y + 0.05, y + 0.2, 18); f.col('#cfe4ee', 0, 0.15); f.cyl(-0.24, 0.16, 0.112, y + 0.2, y + 0.204, 18);   // (a pot of water on the boil, its water on top)
    f.col(C.black); f.rod([-0.36, y + 0.18, 0.16], [-0.42, y + 0.18, 0.16], 0.012, 6); f.rod([-0.12, y + 0.18, 0.16], [-0.06, y + 0.18, 0.16], 0.012, 6);
    f.col('#2a2c30'); f.box(-0.5, y - 0.1, 0.36, 0.5, y - 0.02, 0.38); f.col(C.black); for (const x of [-0.36, -0.12, 0.12, 0.36]) f.sph(x, y - 0.06, 0.385, 0.025, 0.025, 0.015, 10, 5);   // (its knobs)
  };
  D.ou_wok = f => {   // the wok burner: a ring of flame under a black steel wok, its ladle, soy and oil, a bowl of scallions
    const y = base(f, 0.45, 0.36);
    f.col('#2a2c30'); f.box(-0.45, y, -0.36, 0.45, y + 0.02, 0.36);
    f.col('#111214'); f.cyl(-0.08, 0.0, 0.17, y + 0.02, y + 0.06, 18); f.col('#ff7a2a', 0, 1); f.cyl(-0.08, 0.0, 0.12, y + 0.06, y + 0.065, 16); f.col('#4a7ad9', 0, 0.8); f.cyl(-0.08, 0.0, 0.07, y + 0.065, y + 0.07, 12);   // (its ring of flame)
    f.col('#1b1c1f'); f.cyl(-0.08, 0.0, 0.07, y + 0.07, y + 0.16, 22, 0.22); f.col('#2e3034'); f.cyl(-0.08, 0.0, 0.215, y + 0.158, y + 0.162, 22);   // (the wok, its well)
    f.col('#1b1c1f'); f.rod([0.13, y + 0.15, 0.0], [0.36, y + 0.18, 0.06], 0.016, 6); f.col('#7a5a3a'); f.rod([0.26, y + 0.165, 0.035], [0.38, y + 0.185, 0.065], 0.02, 6);   // (its handle)
    f.col(C.chrome); f.rod([0.2, y + 0.02, -0.26], [0.3, y + 0.25, -0.26], 0.008, 5); f.sph(0.2, y + 0.03, -0.26, 0.04, 0.02, 0.04, 10, 5);   // (the ladle, resting)
    for (const [x, c] of [[0.3, '#2a1608'], [0.38, '#d9b84a']]) { f.col(c); f.cyl(x, -0.12, 0.028, y + 0.02, y + 0.2, 10); f.col(C.black); f.cyl(x, -0.12, 0.012, y + 0.2, y + 0.24, 8); }   // (soy and oil)
    f.col('#f6f4ef'); f.cyl(0.32, 0.2, 0.07, y + 0.02, y + 0.08, 14, 0.05); f.col('#6fb03a'); f.cyl(0.32, 0.2, 0.062, y + 0.075, y + 0.085, 14);   // (scallions)
  };
  D.ou_popcorn = f => {   // the arcade's popcorn machine: a red-framed glass cabinet on its counter, its kettle hung in the top, popcorn heaped below, its sign lit
    const y = base(f, 0.4, 0.34), x0 = -0.3, x1 = 0.3, z0 = -0.26, z1 = 0.22, top = y + 0.62;
    f.col('#c0241e'); f.box(x0, y, z0, x1, y + 0.05, z1); f.box(x0, top, z0, x1, top + 0.14, z1);   // (its base and its roof)
    for (const [x, z] of [[x0, z0], [x1 - 0.03, z0], [x0, z1 - 0.03], [x1 - 0.03, z1 - 0.03]]) f.box(x, y + 0.05, z, x + 0.03, top, z + 0.03);   // (its posts)
    f.col('#ffe7a8', 0, 0.9); f.box(x0 + 0.04, top + 0.03, z1, x1 - 0.04, top + 0.11, z1 + 0.006);   // (its lit sign)
    f.col('#c0241e'); for (let k = 0; k < 6; k++) f.box(x0 + 0.06 + k * 0.085, top + 0.05, z1 + 0.006, x0 + 0.1 + k * 0.085, top + 0.09, z1 + 0.008);
    f.col('#f6e7b0', 0, 0.3); f.box(x0 + 0.03, top - 0.012, z0 + 0.03, x1 - 0.03, top - 0.004, z1 - 0.03);   // (its lamp)
    f.col(C.chrome); f.cyl(0, -0.08, 0.1, top - 0.24, top - 0.12, 16, 0.11); f.rod([0, top - 0.12, -0.08], [0, top, -0.08], 0.01, 6);   // (the kettle, hung)
    f.col('#f6eecf'); for (let k = 0; k < 9; k++) f.sph(-0.08 + (k % 3) * 0.08, top - 0.25 - (k > 5 ? 0.02 : 0), -0.08 + (k % 2) * 0.03 + (k > 4 ? 0.04 : 0), 0.018, 0.016, 0.018, 6, 4);   // (spilling over its lip)
    for (let k = 0; k < 40; k++) { const a = k * 2.399, r = Math.sqrt(k / 40) * 0.24; f.col(k % 4 ? '#f6eecf' : '#f2d98a'); f.sph(Math.cos(a) * r, y + 0.07 + (1 - r / 0.24) * 0.06, -0.12 + Math.sin(a) * r * 0.45, 0.02, 0.018, 0.02, 6, 4); }   // (popcorn heaped at the back)
    f.glass('#e3f0f5'); f.box(x0 + 0.03, y + 0.05, z1 - 0.01, x1 - 0.03, top, z1); f.box(x0 + 0.03, y + 0.05, z0, x1 - 0.03, top, z0 + 0.01);
    f.box(x0, y + 0.05, z0 + 0.03, x0 + 0.01, top, z1 - 0.03); f.box(x1 - 0.01, y + 0.05, z0 + 0.03, x1, top, z1 - 0.03);   // (its glass)
    f.col('#f6f4ef'); for (const [x, z] of [[0.3, 0.26], [0.34, 0.28]]) { f.cyl(x, z, 0.03, y, y + 0.1, 10, 0.036); f.col('#c0241e'); f.cyl(x, z, 0.031, y + 0.03, y + 0.06, 10, 0.034); f.col('#f6f4ef'); }   // (bags at its side)
  };
  // the tandoor, the rice cooker, the bamboo steamer and the ice cream freezer (2026-10-28: an Indian's, a Japanese, a dim
  // sum kitchen's; a dessert counter's)
  D.ou_tandoor = f => {   // a clay tandoor set into its stainless counter: its mouth glowing, skewers resting, naan on a cloth
    const y = base(f, 0.45, 0.36);
    f.col('#b8653a'); f.cyl(-0.08, 0, 0.27, y, y + 0.08, 22, 0.24); f.col('#9a4e2a'); f.cyl(-0.08, 0, 0.245, y + 0.08, y + 0.095, 22);   // (its clay rim)
    f.col('#1b1210'); f.cyl(-0.08, 0, 0.17, y + 0.09, y + 0.1, 20); f.col('#ff6a1e', 0, 1); f.cyl(-0.08, 0, 0.1, y + 0.1, y + 0.103, 16);   // (its mouth, the coals deep in it)
    f.col('#7a4a2a'); f.rod([-0.24, y + 0.1, -0.08], [-0.33, y + 0.06, -0.22], 0.006, 5);
    f.col(C.chrome); for (const z of [-0.26, -0.2]) f.rod([0.16, y + 0.012, z], [0.42, y + 0.012, z], 0.005, 5);   // (skewers)
    f.col('#f2ead8'); f.box(0.2, y, 0.02, 0.42, y + 0.004, 0.28); f.col('#e0b46a'); f.sph(0.31, y + 0.012, 0.15, 0.09, 0.008, 0.06, 12, 4); f.col('#7a4a1a'); for (const [x, z] of [[0.28, 0.13], [0.33, 0.17], [0.3, 0.18]]) f.sph(x, y + 0.02, z, 0.01, 0.003, 0.01, 6, 3);   // (a naan on its cloth)
  };
  D.ou_rice = f => {   // the rice station: two rice cookers keeping it warm, one open on its rice, a paddle, a stack of bowls
    const y = base(f, 0.4, 0.34);
    for (const [k, x] of [-0.2, 0.12].entries()) {
      f.col('#f4f2ec'); f.cyl(x, -0.08, 0.13, y, y + 0.17, 20); f.col('#d8dadc'); f.cyl(x, -0.08, 0.132, y + 0.06, y + 0.07, 20);
      f.col('#2a2c30'); f.box(x - 0.04, y + 0.08, 0.045, x + 0.04, y + 0.12, 0.052); f.col('#ff7a2a', 0, 1); f.sph(x + 0.025, y + 0.1, 0.053, 0.006, 0.006, 0.004, 4, 3);   // (its panel, warm)
      if (k) { f.col('#f4f2ec'); f.sph(x, y + 0.17, -0.08, 0.13, 0.05, 0.13, 18, 6); f.col('#8e959b'); f.cyl(x, -0.08, 0.02, y + 0.21, y + 0.23, 8); }   // (closed)
      else { f.col('#fbfbf6'); f.cyl(x, -0.08, 0.115, y + 0.17, y + 0.175, 18); f.col('#f4f2ec'); f.box(x - 0.13, y + 0.17, -0.22, x + 0.13, y + 0.4, -0.2); }   // (open: its rice, the lid up behind)
    }
    f.col('#f6f4ef'); f.box(0.0, y + 0.18, 0.0, 0.03, y + 0.19, 0.16);   // (the paddle)
    for (let k = 0; k < 4; k++) { f.col('#f6f4ef'); f.cyl(0.32, 0.14, 0.07 - k * 0.002, y + k * 0.03, y + 0.028 + k * 0.03, 14, 0.05); }   // (bowls)
  };
  D.ou_bamboo = f => {   // the bamboo steamer: its baskets stacked over a pot on the boil, the top one open, its lid aside, dipping sauce
    const y = base(f, 0.45, 0.36), x = -0.1;
    f.col('#3a3d42'); f.cyl(x, 0, 0.17, y, y + 0.08, 18);   // (the pot under it)
    for (let k = 0; k < 3; k++) { f.col(k % 2 ? '#c9a46a' : '#d6b47a'); f.cyl(x, 0, 0.16, y + 0.08 + k * 0.06, y + 0.135 + k * 0.06, 20); f.col('#a8834a'); f.cyl(x, 0, 0.163, y + 0.13 + k * 0.06, y + 0.14 + k * 0.06, 20); }   // (its baskets)
    f.col('#d6b47a'); f.sph(0.24, y + 0.02, -0.18, 0.12, 0.05, 0.12, 16, 6); f.col('#a8834a'); f.cyl(0.24, -0.18, 0.02, y + 0.06, y + 0.08, 8);   // (its lid, aside)
    f.col('#f6f4ef'); f.cyl(0.26, 0.16, 0.05, y, y + 0.025, 14, 0.04); f.col('#3a1a0a'); f.cyl(0.26, 0.16, 0.042, y + 0.02, y + 0.024, 14);   // (soy to dip in)
  };
  D.ou_freezer = f => {   // the ice cream freezer: a white dipping cabinet, its tubs under a curved glass guard, scoops in their well, cones
    f.col('#2a2c30'); f.box(-0.48, 0, -0.32, 0.48, 0.08, 0.3);
    f.col('#f4f2ec'); f.box(-0.5, 0.08, -0.34, 0.5, 0.86, 0.34); f.col('#e0e3e6'); for (const x of [-0.25, 0.25]) f.box(x - 0.2, 0.16, 0.34, x + 0.2, 0.7, 0.345);
    f.col('#7ab6e0', 0, 0.4); f.box(-0.46, 0.74, 0.345, 0.46, 0.8, 0.35);   // (its lit band)
    f.col('#c9ced3'); f.box(-0.5, 0.86, -0.34, 0.5, 0.88, 0.34);
    const T = ['#f6eccf', '#5a3420', '#f2a8b8', '#a8dcb0', '#f2d06a', '#c8b4e8'];
    for (let k = 0; k < 6; k++) { const x = -0.3 + (k % 3) * 0.3, z = -0.14 + Math.floor(k / 3) * 0.2; f.col('#d8dadc'); f.box(x - 0.13, 0.84, z - 0.09, x + 0.13, 0.885, z + 0.09); f.col(T[k]); f.sph(x, 0.885, z, 0.11, 0.025, 0.075, 12, 5); }   // (its tubs)
    f.glass('#e3f0f5'); f.box(-0.48, 0.9, -0.34, 0.48, 0.905, 0.1); f.box(-0.48, 0.905, -0.34, 0.48, 1.12, -0.33);   // (its glass)
    f.col(C.chrome); f.box(0.36, 0.88, 0.16, 0.48, 0.95, 0.3); f.col('#cfe4ee', 0, 0.2); f.box(0.37, 0.94, 0.17, 0.47, 0.945, 0.29); f.rod([0.4, 0.95, 0.22], [0.44, 1.05, 0.26], 0.006, 5);   // (the scoops' well)
    for (let k = 0; k < 3; k++) { f.col('#d9a25e'); f.cyl(-0.42, 0.24, 0.025, 0.88 + k * 0.03, 0.92 + k * 0.03, 10, 0.004); }   // (cones, stacked)
  };
  // the bar's (2026-10-28: lounges and clubs, "Drinks and maybe drinking appetizers for lounges, bars, clubs")
  D.ou_taps = f => {   // the beer taps: a chrome font with four taps and their handles over a drip tray, pint glasses upside down, beer mats
    const y = base(f, 0.5, 0.34), fz = -0.06;
    f.col(C.chrome); f.cyl(-0.1, fz, 0.04, y, y + 0.36, 14); f.box(-0.44, y + 0.34, fz - 0.05, 0.24, y + 0.42, fz + 0.05);   // (its column and bar)
    f.col('#8e959b'); f.box(-0.46, y + 0.42, fz - 0.06, 0.26, y + 0.43, fz + 0.06);
    for (const [k, x] of [-0.38, -0.25, -0.1, 0.05].entries()) {
      f.col(C.chrome); f.rod([x, y + 0.36, fz + 0.04], [x, y + 0.33, fz + 0.12], 0.012, 8); f.rod([x, y + 0.33, fz + 0.12], [x, y + 0.27, fz + 0.12], 0.009, 6);   // (its spout)
      f.col(['#c99a2e', '#1b1c1f', '#b5482a', '#e8d9a8'][k]); f.box(x - 0.018, y + 0.42, fz - 0.018, x + 0.018, y + 0.6, fz + 0.018);   // (its handle)
      f.col(C.black); f.box(x - 0.022, y + 0.56, fz - 0.024, x + 0.022, y + 0.6, fz + 0.024);
    }
    f.col('#2a2c30'); f.box(-0.46, y, 0.0, 0.14, y + 0.025, 0.2); f.col(C.chrome); for (let x = -0.44; x < 0.13; x += 0.035) f.box(x, y + 0.025, 0.02, x + 0.012, y + 0.03, 0.18);   // (the drip tray)
    for (const [x, z] of [[0.3, -0.18], [0.4, -0.18], [0.3, -0.06], [0.4, -0.06]]) { f.glass('#e3f0f5'); f.cyl(x, z, 0.042, y, y + 0.15, 12, 0.036); }   // (pint glasses, upside down)
    f.col('#2a2c30'); f.box(0.24, y, -0.25, 0.46, y + 0.005, 0.01);
    for (const [x, z, c] of [[0.3, 0.14, '#b5482a'], [0.4, 0.16, '#2e6b4a']]) { f.col(c); f.cyl(x, z, 0.045, y, y + 0.004, 14); }   // (beer mats)
  };
  D.ou_wine = f => {   // the wine fridge: a lit glass door on its bottles laid in their racks, an ice bucket of champagne, two bottles open, a corkscrew
    f.col('#2a2c30'); f.box(-0.38, 0, -0.32, 0.38, 0.08, 0.3);
    f.col('#3a3d42'); f.box(-0.4, 0.08, -0.34, 0.4, 0.88, -0.3); for (const x of [-0.4, 0.36]) f.box(x, 0.08, -0.3, x + 0.04, 0.88, 0.3); f.box(-0.36, 0.08, -0.3, 0.36, 0.12, 0.3); f.box(-0.36, 0.84, -0.3, 0.36, 0.88, 0.3);   // (its cabinet, open behind the door)
    f.col('#24262a'); f.box(-0.4, 0.08, 0.3, -0.35, 0.88, 0.32); f.box(0.35, 0.08, 0.3, 0.4, 0.88, 0.32); f.box(-0.35, 0.84, 0.3, 0.35, 0.88, 0.32); f.box(-0.35, 0.08, 0.3, 0.35, 0.12, 0.32);   // (the door's frame)
    f.col('#4a3a2a', 0, 0.35); f.box(-0.35, 0.12, -0.3, 0.35, 0.84, -0.27);   // (its back, warm in the light)
    f.col('#ffe7c4', 0, 1); f.box(-0.34, 0.82, -0.27, 0.34, 0.83, 0.26);   // (lit inside)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) {   // (the bottles, laid, their necks to the door)
      const x = -0.27 + k * 0.135, yy = 0.2 + r * 0.16;
      f.col(['#3a0d16', '#2e3a1e', '#5a0d1e', '#c9b46a', '#2e3a1e'][(k + r) % 5]); f.rod([x, yy, -0.24], [x, yy, 0.12], 0.033, 10); f.rod([x, yy, 0.12], [x, yy, 0.22], 0.012, 8);
      f.col(r % 2 ? C.brass : '#7a1424'); f.rod([x, yy, 0.22], [x, yy, 0.25], 0.013, 8);
      f.col('#7a5a3a'); f.box(-0.35, yy - 0.045, -0.26, 0.35, yy - 0.035, 0.24);
    }
    f.glass('#dde8ec'); f.box(-0.35, 0.12, 0.305, 0.35, 0.84, 0.315); f.col(C.chrome); f.rod([0.3, 0.3, 0.36], [0.3, 0.7, 0.36], 0.012, 6);   // (its glass door and handle)
    f.col('#dfe3e7'); f.box(-0.41, 0.88, -0.35, 0.41, 0.92, 0.35);
    const y = 0.92;
    f.col(C.chrome); f.cyl(-0.24, -0.16, 0.09, y, y + 0.2, 16, 0.1); f.col('#eaf6fb', 0, 0.2); f.cyl(-0.24, -0.16, 0.088, y + 0.16, y + 0.19, 16);   // (the ice bucket)
    f.col('#2e3a1e'); f.rod([-0.24, y + 0.05, -0.16], [-0.2, y + 0.3, -0.12], 0.03, 10); f.col(C.brass); f.rod([-0.2, y + 0.3, -0.12], [-0.19, y + 0.36, -0.11], 0.014, 8);
    for (const [x, c, cap] of [[0.06, '#3a0d16', '#7a1424'], [0.16, '#c9b46a', C.brass]]) { f.col(c); f.cyl(x, -0.2, 0.034, y, y + 0.24, 12); f.cyl(x, -0.2, 0.012, y + 0.24, y + 0.32, 8); f.col(cap); f.cyl(x, -0.2, 0.013, y + 0.3, y + 0.33, 8); }
    f.col(C.chrome); f.box(0.24, y, 0.06, 0.34, y + 0.01, 0.08); f.rod([0.29, y + 0.01, 0.07], [0.29, y + 0.06, 0.07], 0.005, 5);   // (a corkscrew)
    f.col('#7a5a3a'); f.box(-0.1, y, 0.04, 0.1, y + 0.012, 0.22);   // (a board to pour on)
  };
  D.ou_cocktail = f => {   // the cocktail station: bottles on a step behind, a speed rail on its front, a board of limes, a jigger, a bar spoon, a shaker's place
    const y = base(f, 0.6, 0.34);
    f.col(C.walnut); f.box(-0.58, y, -0.33, 0.58, y + 0.08, -0.2); f.box(-0.58, y + 0.08, -0.33, 0.58, y + 0.16, -0.27);   // (the step)
    const B = ['#e8d9a8', '#5a3a1a', '#2e6b4a', '#c0392b', '#3a7ad9', '#d9a441', '#eef2f4', '#8e1b4a'];
    for (let k = 0; k < 8; k++) {   // (the bottles on it)
      const x = -0.52 + k * 0.145, z = k % 2 ? -0.235 : -0.3, y0 = y + (k % 2 ? 0.08 : 0.16), c = B[k];
      if (c === '#eef2f4') f.glass('#e9f2f5'); else f.col(c);
      f.cyl(x, z, 0.03, y0, y0 + 0.2, 10); f.cyl(x, z, 0.011, y0 + 0.2, y0 + 0.28, 8); f.col(k % 3 ? C.black : C.brass); f.cyl(x, z, 0.012, y0 + 0.27, y0 + 0.29, 8);
    }
    f.col(C.chrome); f.box(-0.5, 0.62, 0.35, 0.5, 0.64, 0.42); f.box(-0.5, 0.64, 0.4, 0.5, 0.7, 0.42);   // (the speed rail on its front)
    for (let k = 0; k < 6; k++) { const x = -0.42 + k * 0.17; f.col(B[(k + 3) % 8]); f.cyl(x, 0.385, 0.026, 0.64, 0.84, 10); f.col(C.chrome); f.cyl(x, 0.385, 0.008, 0.84, 0.9, 6); }   // (its pour spouts)
    f.col('#c9a878'); f.box(0.22, y, -0.12, 0.5, y + 0.018, 0.12);   // (the board, limes, a knife)
    for (const [x, z] of [[0.28, -0.06], [0.36, 0.0], [0.44, -0.07]]) { f.col('#5a9a2a'); f.sph(x, y + 0.04, z, 0.026, 0.024, 0.026, 10, 6); }
    for (const [x, z] of [[0.3, 0.07], [0.4, 0.08]]) { f.col('#9ccf4a'); f.cyl(x, z, 0.024, y + 0.018, y + 0.026, 12); }
    f.col(C.chrome); f.box(0.38, y + 0.02, -0.11, 0.48, y + 0.025, -0.1); f.col(C.black); f.box(0.48, y + 0.018, -0.115, 0.54, y + 0.028, -0.095);
    f.col(C.chrome); f.cyl(-0.3, 0.12, 0.018, y, y + 0.03, 10, 0.024); f.cyl(-0.3, 0.12, 0.024, y + 0.03, y + 0.06, 10, 0.016);   // (a jigger)
    f.rod([-0.42, y + 0.004, 0.02], [-0.18, y + 0.004, 0.16], 0.004, 4);   // (a bar spoon)
    f.col('#2a2c30'); f.box(-0.12, y, -0.04, 0.12, y + 0.008, 0.2);   // (the mat the shaker stands on)
  };
  D.ou_plating = f => {   // the plating counter: clean plates stacked, garnish trays, a squeeze bottle
    const y = base(f, 0.6, 0.34);
    for (const x of [-0.4, -0.15]) { f.col('#f6f6f2'); f.cyl(x, -0.1, 0.13, y, y + 0.14, 16); f.col('#e2e2dc'); for (let k = 1; k < 7; k++) f.cyl(x, -0.1, 0.132, y + k * 0.02 - 0.002, y + k * 0.02, 16); }
    for (let k = 0; k < 3; k++) { f.col(C.chrome); f.box(0.08 + k * 0.15, y, 0.0, 0.2 + k * 0.15, y + 0.04, 0.2); f.col(['#7ab648', '#e24a5a', '#f1c453'][k]); f.box(0.09 + k * 0.15, y + 0.04, 0.01, 0.19 + k * 0.15, y + 0.05, 0.19); }
    f.col('#c0392b'); f.cyl(0.45, -0.18, 0.03, y, y + 0.16, 8); f.col('#f1c453'); f.cyl(0.38, -0.18, 0.03, y, y + 0.16, 8);
    for (let k = 0; k < 4; k++) { f.glass('#dcebf1'); f.cyl(-0.52 + (k % 2) * 0.08, 0.2 - Math.floor(k / 2) * 0.08, 0.034, y, y + 0.14, 12, 0.03); }   // (glasses upside down, for the smoothies)
  };
  D.ou_pass = f => {   // the pass: the shelf between kitchen and floor, its heat lamps over it, the bell
    f.col('#b9bfc4'); f.box(-0.8, 0, -0.3, 0.8, 1.0, 0.3); f.col('#2a2c30'); f.box(-0.78, 0, -0.28, 0.78, 0.08, 0.28);
    f.col('#dfe3e7'); f.box(-0.82, 1.0, -0.32, 0.82, 1.05, 0.32);
    f.col(C.chrome); for (const x of [-0.78, 0.78]) f.box(x - 0.025, 1.05, -0.025, x + 0.025, 1.85, 0.025); f.box(-0.8, 1.82, -0.12, 0.8, 1.86, 0.12);
    for (const x of [-0.4, 0.4]) { f.col('#3e4246'); f.cyl(x, 0, 0.09, 1.66, 1.82, 12, 0.05); f.col('#ff5a2a', 0, 1); f.cyl(x, 0, 0.07, 1.65, 1.67, 12); }
    f.col(C.brass); f.sph(0.55, 1.07, 0.18, 0.06, 0.05, 0.06, 10, 6); f.cyl(0.55, 0.18, 0.012, 1.11, 1.14, 6);
    f.col('#f6f6f2'); f.cyl(-0.3, 0.0, 0.13, 1.05, 1.07, 14); f.col('#c98b4a'); f.sph(-0.3, 1.1, 0.0, 0.08, 0.04, 0.06, 8, 5);
  };
  D.ou_dishes = f => {   // the dish return: a rack of used plates and cups, a tub
    f.col(C.chrome); for (const [x, z] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) f.box(x - 0.02, 0, z - 0.02, x + 0.02, 1.4, z + 0.02);
    for (const y of [0.15, 0.6, 1.05, 1.38]) { f.col('#9aa1a6'); f.box(-0.44, y, -0.32, 0.44, y + 0.02, 0.32); }
    for (const y of [0.17, 0.62]) for (let k = 0; k < 6; k++) { f.col('#f2f0ea'); f.sph(-0.32 + k * 0.13, y + 0.12, 0, 0.012, 0.12, 0.12, 4, 10); f.col('#8a6a4a'); f.sph(-0.32 + k * 0.13 + 0.014, y + 0.12, 0.03, 0.002, 0.04, 0.03, 4, 4); }
    for (let k = 0; k < 5; k++) cup(f, -0.3 + k * 0.15, 1.07, 0.05, '#f4f4f4');
  };
  D.ou_sink = f => {   // a double sink, the tap, the drying rack of clean plates
    const y = base(f, 0.7, 0.34);
    f.col('#7e858b'); for (const x of [-0.42, -0.06]) f.box(x - 0.16, y - 0.005, -0.2, x + 0.16, y + 0.002, 0.16);
    f.col('#c9e3ee'); f.box(-0.57, y + 0.002, -0.19, -0.27, y + 0.004, 0.15);
    f.col(C.chrome); f.rod([-0.24, y, -0.26], [-0.24, y + 0.38, -0.26], 0.015, 6); f.rod([-0.24, y + 0.38, -0.26], [-0.24, y + 0.32, -0.05], 0.012, 6);
    f.col(C.chrome); f.box(0.18, y, -0.2, 0.66, y + 0.02, 0.18); for (let k = 0; k < 6; k++) { f.col('#f6f6f2'); f.sph(0.24 + k * 0.08, y + 0.14, 0.0, 0.01, 0.12, 0.12, 4, 10); }
  };
  D.ou_bin = f => { f.col(C.chrome); f.cyl(0, 0, 0.2, 0, 0.66, 14, 0.18); f.col('#3e4246'); f.cyl(0, 0, 0.21, 0.66, 0.72, 14); f.col(C.black); f.box(-0.08, 0, 0.17, 0.08, 0.03, 0.26); };
  D.ou_extinguisher = f => { f.col('#2a2c30'); f.box(-0.08, 0.5, -0.02, 0.08, 0.62, 0.0); f.col('#c0392b'); f.cyl(0, 0.1, 0.07, 0.4, 0.92, 10); f.sph(0, 0.92, 0.1, 0.07, 0.04, 0.07, 8, 5); f.col(C.black); f.box(-0.03, 0.96, 0.08, 0.03, 1.02, 0.12); f.rod([0.04, 1.0, 0.1], [0.1, 0.6, 0.16], 0.01, 4); f.col('#f2f2f2'); f.box(-0.1, 1.08, -0.005, 0.1, 1.24, 0.002); f.col('#c0392b'); f.box(-0.07, 1.11, 0.0, 0.07, 1.21, 0.004); };
  D.ou_rail = f => {   // the order rail: tickets clipped in a row over the pass
    f.col(C.chrome); f.box(-0.9, 1.92, -0.02, 0.9, 1.98, 0.06);
    for (let k = 0; k < 5; k++) { const x = -0.7 + k * 0.33; f.col('#fbfaf6'); f.box(x - 0.08, 1.68, 0.04, x + 0.08, 1.95, 0.045); f.col('#3a3a3a'); for (let l = 0; l < 4; l++) f.box(x - 0.06, 1.88 - l * 0.05, 0.045, x - 0.06 + 0.06 + ((k + l) % 3) * 0.03, 1.895 - l * 0.05, 0.047); f.col(['#e24a5a', '#f1c453', '#7ab648'][k % 3]); f.box(x - 0.08, 1.93, 0.045, x + 0.08, 1.95, 0.047); }
  };
}
