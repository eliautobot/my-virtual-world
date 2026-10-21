// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Things the characters hold or set down: a phone, a mug, a coffee to go, a book (closed, or open to read), a ping-pong
// paddle, a dumbbell, a shopping bag, a briefcase, and a laptop on the table in front of someone typing (2026-10-07: the
// server gave people these all along — shared/anims.js PROPS — but no character drew them).
//
// Each character model gets one instanced mesh holding every shape; an instance draws only its own shape. A held shape is
// moved by the hand's bone from the same baked clips as the body (render/characters.js SKIN_GLSL), in that hand's grip
// frame (tools/chars/extra-clips.mjs: bind space, y along the fingers, z out of the palm, x = y × z, origin on the palm),
// so it stays in the palm through every clip and cross-fade, on every body; one set down is placed from the character's
// own root at its desk point (where its fingertips rest typing). Both take the body's height and build and the rig's
// arm calibration, so they meet the hands the body draws.
//
// Which shape: what the server says the person holds (prop) and what they are doing (the clip) — a coffee is in the hand
// while walking or sipping, on the table while typing or talking; a book is open while reading; a laptop only on a table.
//
// Eating (2026-10-07, "proper eating animations depending on the meal"): someone at a table with a dish eats it the
// dish's way (shared/food.js eat): a burger or a sandwich in both hands, a slice or a pastry in one, knife and fork, a
// fork, a spoon or chopsticks — the clip (eatClip; tools/chars/extra-clips.mjs) and what is in the hands (the held food:
// BITE below, the cutlery), at the points of shared/eating.js that the clips bring to the dish and the mouth. Held food
// and drinks take their own colour from a table of every item (TINT, by item number).
import * as THREE from 'three';
import { FB } from './furniture.js';
import { CLIP } from './anim.js';
import { PROP } from '/shared/anims.js';
import { SKIN_GLSL, APP_GLSL } from './char-glsl.js';
import { FOOD, FOOD_BY_N } from '/shared/food.js';
import { EAT_CLIP, BOTH_R, BOTH_LIFT, HELD_SCALE, BITE_TIP, TOOL_Z, TOOL_LEN, toolDir } from '/shared/eating.js';
import { lin } from './furniture.js';

const HAND_R = 0, HAND_L = 1, DESK = 2, HANG = 3;
const SCREEN = '#8cc6ff';
const basis = (x, y, z, o) => new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)).setPosition(...o);
/** Draws fn in a frame m (inside FB's current one). */
function within(f, m, fn) { f.stack.push(f.m.clone()); f.m.multiply(m); fn(); f.pop(); }
// a vertical thing (FB's lathe runs up y) held round its middle in a right hand: its axis along the grip's x (the index
// finger's side: up while the palm faces in), against the palm
const upright = (r, h, y = 0.012) => basis([0, -1, 0], [1, 0, 0], [0, 0, 1], [-h * 0.48, y, r + 0.003]);

function mug(f, x, z, y0 = 0) {
  f.col('#eeeae2'); f.cyl(x, z, 0.04, y0, y0 + 0.095, 14);
  f.col('#4a2c1a'); f.cyl(x, z, 0.036, y0 + 0.078, y0 + 0.086, 14);
  f.col('#e2ddd3'); f.rod([x, y0 + 0.022, z + 0.039], [x, y0 + 0.022, z + 0.07], 0.007, 5); f.rod([x, y0 + 0.022, z + 0.07], [x, y0 + 0.074, z + 0.07], 0.007, 5); f.rod([x, y0 + 0.074, z + 0.07], [x, y0 + 0.074, z + 0.039], 0.007, 5);
}
function coffee(f, x, z, y0 = 0) {
  f.col('#f4f1ea'); f.cyl(x, z, 0.029, y0, y0 + 0.118, 14, 0.037);
  f.col('#b88752'); f.cyl(x, z, 0.0335, y0 + 0.04, y0 + 0.085, 14, 0.0358);
  f.col('#2a2a2c'); f.cyl(x, z, 0.0385, y0 + 0.116, y0 + 0.127, 14, 0.035);
}
function phone(f) {
  f.col('#15161a'); f.box(-0.036, -0.055, 0, 0.036, 0.095, 0.0085);
  f.col(SCREEN, 0, 1); f.box(-0.032, -0.049, 0.0085, 0.032, 0.089, 0.0094);
}
function bookClosed(f) {
  f.col('#8c2f2f'); f.box(-0.066, -0.05, 0, 0.066, 0.13, 0.026);
  f.col('#f1ece0'); f.box(-0.06, -0.044, 0.003, 0.069, 0.124, 0.023);
}
// open, lying across both palms (the right hand's grip frame with the palm up: x outward, toward the body's right): the
// spine between the hands, a little lower, each page rising to its edge; the left page reaches the other hand
function bookOpen(f) {
  const SPINE = -0.115;
  const page = w => within(f, new THREE.Matrix4().makeRotationY(w > 0 ? -0.12 : 0.12).setPosition(SPINE, 0, -0.01), () => {
    const a = Math.min(0, w), b = Math.max(0, w), pa = w > 0 ? 0 : w + 0.004, pb = w > 0 ? w - 0.004 : 0;
    f.col('#2d4a6b'); f.box(a, -0.06, 0, b, 0.15, 0.004);
    f.col('#f3eee2'); f.box(pa, -0.055, 0.004, pb, 0.145, 0.016);
    f.col('#b9b3a6');
    for (let k = 0; k < 7; k++) { const y = -0.035 + k * 0.024; f.box(pa + 0.014, y, 0.0162, pb - 0.014, y + 0.006, 0.0166); }
  });
  page(0.135); page(-0.135);
}
function paddle(f) {
  f.col('#b58a5a'); f.rod([-0.045, 0.018, 0.016], [0.07, 0.018, 0.016], 0.014, 8);
  within(f, basis([1, 0, 0], [0, 0, 1], [0, -1, 0], [0.145, 0.018, 0.016]), () => { f.col('#c0202a'); f.cyl(0, 0, 0.078, -0.006, 0.006, 18); f.col('#1b1b1d'); f.cyl(0, 0, 0.0765, 0.0062, 0.0068, 18); });
}
function dumbbell(f) {
  f.col('#3a3d44'); f.rod([-0.085, 0.02, 0.018], [0.085, 0.02, 0.018], 0.0135, 8);
  for (const x of [-0.072, 0.072]) within(f, basis([0, -1, 0], [1, 0, 0], [0, 0, 1], [x, 0.02, 0.018]), () => { f.col('#22252b'); f.cyl(0, 0, 0.045, -0.018, 0.018, 12); });
}
// hanging from the right hand, straight down whatever the wrist does (root frame from the grip: x the person's left, y
// up, z ahead): the handles up into the fist, the broad sides facing out to the side
// fishing (2026-10-14, the fishing game): a spinning rod and a landing net, held in the right fist along its grip's x
// (the index finger's side: toward the tip) as tools/chars/extra-clips.mjs rodPose turns the hand; the rod's axis 13 mm out
// of the palm, the reel hanging below in the fingers (+y), its handle out the palm's side (the body's left). Along x, a
// thing drawn up y (FB's cylinders) is turned by ALONG_X.
const ALONG_X = (z = 0.013) => basis([0, 1, 0], [1, 0, 0], [0, 0, -1], [0, 0, z]);
function rod(f) {
  within(f, ALONG_X(), () => {
    f.col('#1c1d20'); f.cyl(0, 0, 0.0145, -0.3, -0.285, 8);                          // the butt cap
    f.col('#b98c5c'); f.cyl(0, 0, 0.0135, -0.285, -0.075, 8, 0.012);                 // cork: the rear grip
    f.col('#3b3f47'); f.cyl(0, 0, 0.011, -0.075, 0.06, 8);                           // the reel seat
    f.col('#b98c5c'); f.cyl(0, 0, 0.0125, 0.06, 0.16, 8, 0.0095);                    // the fore grip
    f.col('#22303f'); f.cyl(0, 0, 0.0068, 0.16, 1.96, 6, 0.0018, false);             // the blank, tapering to the tip
    f.col('#c8a64a'); f.cyl(0, 0, 0.0076, 0.16, 0.19, 6);                            // its winding check
  });
  // the guides, down the rod on the reel's side, smaller toward the tip; the tip top
  f.col('#c9ced6');
  for (const [x, h] of [[0.5, 0.03], [0.86, 0.022], [1.18, 0.017], [1.46, 0.013], [1.7, 0.01], [1.88, 0.008]]) f.rod([x, 0, 0.013], [x, h, 0.013], 0.0016, 3);
  f.cyl(1.96, 0.013, 0.0028, -0.002, 0.004, 5);
  // the reel: its stem down through the fingers, the body and spool along the rod, the bail, the handle to the left
  f.col('#2a2d33'); f.rod([0.0, 0.012, 0.013], [0.0, 0.07, 0.013], 0.0045, 4);
  within(f, basis([0, 1, 0], [1, 0, 0], [0, 0, -1], [0, 0.088, 0.013]), () => {
    f.col('#31353c'); f.cyl(0, 0, 0.024, -0.035, 0.012, 10);                         // the body
    f.col('#c8ccd2'); f.cyl(0, 0, 0.021, 0.012, 0.05, 10);                           // the spool
    f.col('#9fa6ae'); f.cyl(0, 0, 0.0235, 0.046, 0.054, 10);
  });
  f.col('#c8ccd2'); f.rod([0.05, 0.065, 0.013], [0.06, 0.088, 0.04], 0.0018, 3); f.rod([0.06, 0.088, 0.04], [0.05, 0.11, 0.013], 0.0018, 3);   // the bail
  f.col('#2a2d33'); f.rod([-0.02, 0.088, 0.013], [-0.02, 0.088, 0.075], 0.003, 4);  // the handle's arm
  f.col('#e9e4d8'); f.rod([-0.02, 0.088, 0.075], [-0.02, 0.118, 0.075], 0.006, 6);  // its knob
}
function net(f) {
  within(f, ALONG_X(0.014), () => {
    f.col('#2a2d33'); f.cyl(0, 0, 0.0135, -0.2, 0.25, 8);                            // the grip
    f.col('#8c949e'); f.cyl(0, 0, 0.011, 0.25, 1.0, 6);                              // the handle
  });
  // the hoop and its bag at the handle's end: the ring square to the fingers (open upward while the hand holds the handle
  // ahead and down), the mesh hanging below it
  within(f, basis([1, 0, 0], [0, -1, 0], [0, 0, -1], [1.235, 0, 0.014]), () => {
    f.col('#8c949e'); f.lathe(0, 0, [[0.22, -0.008], [0.235, -0.008], [0.235, 0.008], [0.22, 0.008]], 14);
    f.col('#4f5a52', 0.0); f.lathe(0, 0, [[0.225, 0], [0.19, -0.12], [0.11, -0.24], [0.02, -0.3], [0, -0.3]], 12);
  });
}
function bag(f) {
  f.col('#8a6238'); f.rod([0.004, 0.01, -0.05], [0.006, -0.11, -0.062], 0.004, 4); f.rod([0.004, 0.01, 0.05], [0.006, -0.11, 0.062], 0.004, 4);
  f.col('#c79a62'); f.box(-0.055, -0.36, -0.13, 0.065, -0.11, 0.13);
  f.col('#b78a52'); f.box(-0.056, -0.13, -0.131, 0.066, -0.11, 0.131);
}
function briefcase(f) {
  f.col('#1c1512'); f.box(-0.014, -0.006, -0.05, 0.022, 0.012, 0.05); f.box(-0.014, -0.035, -0.05, 0.022, 0.012, -0.038); f.box(-0.014, -0.035, 0.038, 0.022, 0.012, 0.05);
  f.col('#5a3d2b'); f.box(-0.038, -0.31, -0.19, 0.046, -0.035, 0.19);
  f.col('#c9b27a'); f.box(0.046, -0.06, -0.11, 0.05, -0.04, -0.08); f.box(0.046, -0.06, 0.08, 0.05, -0.04, 0.11);
}
// on the table at the desk point (root frame: x the person's left, y up, z ahead; origin where the fingertips rest, on
// the laptop's keys). Things on the table stand on the table's top, whoever sits there (2026-10-19, the product owner: laptops sank into
// some tables, or stood at a café table's far edge): the desk point is taken at DESK_TOP above the feet, never more than
// DESK_FWD ahead of them, and nothing set down grows with the body (deskPoint below; the shader's PLACE does the same).
// (DESK_FWD keeps the whole laptop on every table people work at — its base reaches 0.17 back from the desk point, its
// lid DESK_LID on: the dining table's near edge is 0.33 ahead of its chair; a bar's bottles are kept clear of by
// render/interiors.js tableTopAt)
const TABLE = -0.004, LAP_H = 0.014, ON = TABLE - LAP_H;   // ON: the table's top in this frame
export const DESK_TOP = 0.76, DESK_FWD = [0.52, 0.62], DESK_LID = 0.133;
/** Where the desk point of a character of desk point `desk` ({ x, y, z }, its model's), height H and build Bd lies in
 *  its root frame (before its turn): its fingertips' reach, on the table's top. */
export function deskPoint(desk, H, Bd) {
  const k = H * Bd;
  return [desk.x * k, DESK_TOP - ON, Math.min(DESK_FWD[1], Math.max(DESK_FWD[0], desk.z * k))];
}
function laptop(f) {
  f.col('#9ba1a8'); f.box(-0.165, TABLE - 0.014, -0.17, 0.165, TABLE, 0.075);
  f.col('#2b2e33'); f.box(-0.145, TABLE, -0.035, 0.145, TABLE + 0.0012, 0.06);
  f.col('#b6bcc3'); f.box(-0.052, TABLE, -0.15, 0.052, TABLE + 0.0008, -0.075);
  within(f, new THREE.Matrix4().makeRotationX(0.26).setPosition(0, TABLE, 0.075), () => {
    f.col('#9ba1a8'); f.box(-0.165, 0, 0, 0.165, 0.225, 0.008);
    f.col(SCREEN, 0, 1); f.box(-0.152, 0.012, -0.0008, 0.152, 0.214, 0);
  });
}
// a drink in the hand (shared/food.js: what was ordered), in one of a few glasses, the drink in its own colour: the
// liquid is drawn white with the tint flag and coloured by the shader from TINT (the item number rides in the shape
// number's fraction). Kept simple: every held shape is drawn for every holder, the unused ones collapsed (vertex cost).
const SOLID = '#d3dee6';
const liquid = f => f.col('#ffffff', 1);
function hMug(f) { f.col('#eeeae2'); f.cyl(0, 0, 0.04, 0, 0.095, 10); liquid(f); f.cyl(0, 0, 0.036, 0.078, 0.0955, 10); f.col('#e2ddd3'); f.rod([0, 0.022, 0.039], [0, 0.022, 0.07], 0.007, 4); f.rod([0, 0.022, 0.07], [0, 0.074, 0.07], 0.007, 4); f.rod([0, 0.074, 0.07], [0, 0.074, 0.039], 0.007, 4); }
function hCup(f) { f.col('#f4f2ed'); f.cyl(0, 0, 0.026, 0, 0.05, 10, 0.044); liquid(f); f.cyl(0, 0, 0.04, 0.044, 0.0505, 10); f.col('#f4f2ed'); f.rod([0, 0.015, 0.035], [0, 0.04, 0.052], 0.005, 4); }
function hGlass(f, r = 0.034, h = 0.13, fill = 0.85) { liquid(f); f.cyl(0, 0, r * 0.9, 0.006, h * fill, 10); f.col(SOLID); f.cyl(0, 0, r, 0, 0.006, 10); f.lathe(0, 0, [[r * 0.94, h * fill], [r, h * fill], [r, h], [r * 0.94, h]], 10); }
function hPint(f) { hGlass(f, 0.04, 0.155, 0.84); f.col('#f6efdc'); f.cyl(0, 0, 0.038, 0.13, 0.145, 10); }
function hStem(f) { f.col(SOLID); f.cyl(0, 0, 0.032, 0, 0.004, 10); f.cyl(0, 0, 0.004, 0.004, 0.09, 5); liquid(f); f.lathe(0, 0, [[0, 0.09], [0.026, 0.104], [0.032, 0.13], [0, 0.13]], 10); f.col(SOLID); f.lathe(0, 0, [[0.032, 0.13], [0.034, 0.15], [0.031, 0.175], [0.029, 0.175]], 10); }
function hBottle(f) { liquid(f); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.031, 0.13], [0.014, 0.17], [0.012, 0.215], [0, 0.215]], 10); f.col('#e9d8a6'); f.cyl(0, 0, 0.0318, 0.04, 0.095, 10); }
function hCan(f) { f.col('#c9ced4'); f.cyl(0, 0, 0.027, 0, 0.008, 10, 0.033); f.cyl(0, 0, 0.033, 0.112, 0.122, 10, 0.027); liquid(f); f.cyl(0, 0, 0.0332, 0.008, 0.112, 10); }
function hShake(f) { hGlass(f, 0.036, 0.14, 0.86); f.col('#fbf7ef'); f.sph(0, 0.122, 0, 0.034, 0.03, 0.034, 10, 5, { cut: 0 }); f.col('#e94b6a'); f.rod([0.01, 0.1, 0], [0.02, 0.2, 0], 0.0035, 4); }
const HELD = { 'h-mug': [hMug, 0.04, 0.095], 'h-cup': [hCup, 0.044, 0.05], 'h-glass': [hGlass, 0.034, 0.13], 'h-pint': [hPint, 0.04, 0.155], 'h-stem': [hStem, 0.032, 0.15],
  'h-bottle': [hBottle, 0.03, 0.17], 'h-can': [hCan, 0.033, 0.122], 'h-shake': [hShake, 0.036, 0.14] };
/** The held glass of each kind of glass (render/food-models.js VESSELS); a coffee to go is the 'coffee' shape. */
const HELD_OF = { mug: 'h-mug', latte: 'h-glass', cup: 'h-cup', espresso: 'h-cup', teacup: 'h-cup', takeaway: 'coffee', tall: 'h-glass', soda: 'h-glass', juice: 'h-glass',
  tumbler: 'h-glass', highball: 'h-glass', rocks: 'h-glass', frappe: 'h-shake', shake: 'h-shake', smoothie: 'h-shake', boba: 'h-shake', pint: 'h-pint',
  beer_bottle: 'h-bottle', bottle_water: 'h-bottle', sake: 'h-bottle', can: 'h-can', wine: 'h-stem', wine_big: 'h-stem', flute: 'h-stem', coupe: 'h-stem', martini: 'h-stem', hurricane: 'h-stem' };

// ------------------------------------------------------------------ eating: the food in the hand, the cutlery
// (frames from shared/eating.js — the clips bring these points to the dish and the mouth)
// both hands (the right's grip frame): the food's middle BOTH_R out of the palm (and a little toward the wrist), upright
// when the fingers rise BOTH_LIFT over its top; its front (away from the mouth) ahead, its sides toward the palms
const BOTH = basis([0, 0, 1], [Math.cos(BOTH_LIFT), Math.sin(BOTH_LIFT), 0], [-Math.sin(BOTH_LIFT), Math.cos(BOTH_LIFT), 0], [0, -0.012, BOTH_R]).scale(new THREE.Vector3(HELD_SCALE, HELD_SCALE, HELD_SCALE));
// one hand: the bitten end at BITE_TIP, the food lying along its way out of the hand (z here), its top off the palm (y)
const biteF = (() => { const k = new THREE.Vector3(BITE_TIP[0], BITE_TIP[1], 0).normalize(), y = new THREE.Vector3(0, 0, 1), x = y.clone().cross(k); return basis(x.toArray(), y.toArray(), k.toArray(), BITE_TIP).scale(new THREE.Vector3(HELD_SCALE, HELD_SCALE, HELD_SCALE)); })();
// a tool: along it (z) from where the palm holds it (tipped toward the palm's side), the palm's side square to it (y: down
// on the plate for a knife, a fork's tines bend that way), its working end at z = TOOL_LEN
const toolF = left => {
  const k = new THREE.Vector3(...toolDir(left)).normalize(), y = new THREE.Vector3(0, 0, 1).addScaledVector(k, -k.z).normalize(), x = y.clone().cross(k);
  return basis(x.toArray(), y.toArray(), k.toArray(), [0, 0, TOOL_Z]);
};
const T = TOOL_LEN, STEEL = '#c9ced4';
const morsel = (f, x, y, z, r = 0.011) => { f.col('#ffffff', 1); f.sph(x, y, z, r, r * 0.8, r * 1.1, 7, 4); };
function knife(f) {
  f.col('#2e3136'); f.box(-0.0075, -0.005, -0.05, 0.0075, 0.005, 0.045);
  f.col(STEEL); f.box(-0.0012, -0.004, 0.045, 0.0012, 0.009, T - 0.03); f.box(-0.0012, -0.002, T - 0.03, 0.0012, 0.008, T - 0.012); f.box(-0.0012, 0.001, T - 0.012, 0.0012, 0.006, T);
}
// a fork: tines bent toward +y (down, eating Continental-style in the left hand) or −y (up, a fork alone, scooping)
function fork(f, dn) {
  f.col(STEEL); f.box(-0.0045, -0.0015, -0.05, 0.0045, 0.0015, T - 0.05); f.box(-0.007, -0.0015, T - 0.05, 0.007, 0.0015, T - 0.04);
  for (let k = 0; k < 4; k++) { const x = -0.0065 + k * 0.0043; f.rod([x, 0, T - 0.04], [x, dn * 0.004, T], 0.0011, 3); }
  morsel(f, 0, dn * 0.007, T - 0.017);
}
function spoon(f) {
  f.col(STEEL); f.box(-0.004, -0.0015, -0.05, 0.004, 0.0015, T - 0.04);
  f.sph(0, -0.002, T - 0.02, 0.016, 0.006, 0.022, 9, 4, { cut: 0 });   // the bowl's back below, open upward (−y)
  f.col('#ffffff', 1); f.sph(0, -0.0035, T - 0.02, 0.013, 0.003, 0.018, 9, 3);
}
function sticks(f) {
  f.col('#3b2618'); f.rod([-0.007, 0, -0.06], [-0.0022, -0.002, T], 0.0028, 4); f.rod([0.007, 0, -0.06], [0.0022, -0.004, T], 0.0028, 4);
  morsel(f, 0, -0.008, T - 0.008, 0.009);
}
// the held foods (shared/food.js eat 'hands' | 'hand'); the tint flag takes the dish's own colour (BITE)
const BUN = '#c98a3f', BREAD = '#e9cf9a', CRUST = '#a8662c';
function burger(f) {
  f.col(BUN); f.cyl(0, 0, 0.048, -0.034, -0.016, 12, 0.05);
  f.col('#7cbf4a'); f.cyl(0, 0, 0.054, -0.016, -0.011, 12);
  f.col('#ffffff', 1); f.cyl(0, 0, 0.051, -0.011, 0.007, 12);
  f.col('#f2b53a'); f.box(-0.042, 0.007, -0.042, 0.042, 0.011, 0.042);
  f.col(BUN); f.sph(0, 0.011, 0, 0.051, 0.03, 0.051, 12, 5, { cut: 0 });
}
function sandwich(f) {   // a half, cut across: the cut side toward the mouth (−z)
  const tri = (y0, y1) => { f.box(-0.05, y0, -0.045, 0.05, y1, -0.03); f.box(-0.035, y0, -0.03, 0.035, y1, 0.0); f.box(-0.02, y0, 0.0, 0.02, y1, 0.03); };
  f.col(BREAD); tri(-0.03, -0.018); f.col('#ffffff', 1); tri(-0.018, 0.006); f.col('#7cbf4a'); f.box(-0.049, 0.006, -0.046, 0.049, 0.01, -0.03); f.col(BREAD); tri(0.01, 0.022);
  f.col(CRUST); f.box(-0.0505, -0.031, -0.031, -0.035, 0.023, -0.029); f.box(0.035, -0.031, -0.031, 0.0505, 0.023, -0.029);
}
function wrapH(f) {   // a wrap or a burrito, its open end toward the mouth, foil round the far half
  f.col('#e9d29a'); f.rod([0, 0, -0.05], [0, 0, 0.03], 0.03, 10);
  f.col('#c9ced4'); f.rod([0, 0, 0.03], [0, 0, 0.1], 0.031, 10); f.sph(0, 0, 0.1, 0.031, 0.031, 0.02, 10, 4);
  f.col('#ffffff', 1); f.cyl(0, 0, 0.026, -0.0505, -0.05, 10);
  within(f, new THREE.Matrix4().makeRotationX(Math.PI / 2), () => { f.col('#ffffff', 1); f.cyl(0, 0, 0.026, 0.049, 0.051, 10); });
}
function hotdog(f) {
  f.col(BUN); f.rod([-0.016, -0.004, -0.05], [-0.016, -0.004, 0.1], 0.017, 8); f.rod([0.016, -0.004, -0.05], [0.016, -0.004, 0.1], 0.017, 8);
  f.col('#ffffff', 1); f.rod([0, 0.008, -0.058], [0, 0.008, 0.108], 0.012, 8);
  f.col('#e9c23a'); f.rod([0, 0.02, -0.04], [0, 0.02, 0.09], 0.0028, 3);
}
function sub(f) {
  f.col(BREAD); f.rod([0, -0.012, -0.05], [0, -0.012, 0.11], 0.024, 9);
  f.col('#ffffff', 1); f.box(-0.025, -0.002, -0.05, 0.025, 0.01, 0.11);
  f.col('#7cbf4a'); f.box(-0.027, 0.01, -0.05, 0.027, 0.014, 0.11);
  f.col(BREAD); f.box(-0.024, 0.014, -0.05, 0.024, 0.03, 0.11);
}
function taco(f) {   // a shell standing on its back, open upward, along z
  f.col('#e9c77a'); f.lathe(0, 0, [[0.0, -0.06], [0.04, -0.06], [0.04, 0.06], [0.0, 0.06]].map(([r, y]) => [r, y]), 10, Math.PI * 0.55, Math.PI * 1.45);
  f.col('#ffffff', 1); f.box(-0.022, -0.012, -0.055, 0.022, 0.01, 0.055);
  f.col('#7cbf4a'); f.box(-0.025, 0.01, -0.05, 0.025, 0.016, 0.05);
}
function bar(f) {   // corn on the cob, a rib: across between the palms (x), its near side at the lips
  f.col('#ffffff', 1); f.rod([-0.06, 0, -0.026], [0.06, 0, -0.026], 0.022, 10);
  f.col('#f1ead8'); f.rod([-0.075, 0, -0.026], [-0.06, 0, -0.026], 0.008, 6); f.rod([0.06, 0, -0.026], [0.075, 0, -0.026], 0.008, 6);
}
// one hand: the bitten end at z 0, the food back along −z, lying on the fingers (y up off the palm)
/** A convex outline [[x, z] …] extruded from y0 to y1 (the top, the bottom and the sides). */
function prism(f, poly, y0, y1) {
  const n = poly.length, top = poly.map(([x, z]) => f.vert(x, y1, z, 0, 1, 0)), bot = poly.map(([x, z]) => f.vert(x, y0, z, 0, -1, 0));
  for (let i = 1; i < n - 1; i++) { f.tri(top[0], top[i], top[i + 1]); f.tri(bot[0], bot[i + 1], bot[i]); }
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n], nx = bz - az, nz = -(bx - ax), l = Math.hypot(nx, nz) || 1;
    f.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx / l, 0, nz / l]);
  }
}
function slice(f) {   // a pizza slice (or a quesadilla wedge): the point bitten, the crust in the fingers
  const w = 0.045, L = 0.12;
  f.col('#e9b870'); prism(f, [[0, 0], [w, -L], [-w, -L]], -0.004, 0.003);
  f.col('#f2c76a'); prism(f, [[0, -0.01], [w * 0.88, -L + 0.008], [-w * 0.88, -L + 0.008]], 0.003, 0.006);
  f.col('#d99a4e'); f.rod([-w, 0.002, -L], [w, 0.002, -L], 0.008, 6);
  f.col('#ffffff', 1); for (const [x, z] of [[0, -0.035], [-0.016, -0.07], [0.017, -0.075], [0, -0.1]]) f.cyl(x, z, 0.008, 0.006, 0.0075, 6);
}
const stick = (r, L) => f => { f.col('#ffffff', 1); f.rod([0, 0, -r], [0, 0, -L + r], r, 6); f.sph(0, 0, -r, r, r, r, 6, 3); };
function bite(f) { f.col('#ffffff', 1); f.sph(0, 0.002, -0.022, 0.02, 0.014, 0.022, 9, 5); }
function drum(f) { f.col('#ffffff', 1); f.sph(0, 0.004, -0.025, 0.02, 0.018, 0.028, 9, 5); f.col('#efe3cc'); f.rod([0, 0.004, -0.05], [0, 0.004, -0.08], 0.005, 5); f.sph(0, 0.004, -0.082, 0.008, 0.008, 0.008, 6, 3); }
function disc(f) { f.col('#ffffff', 1); f.cyl(0, -0.034, 0.034, -0.002, 0.008, 12); }
function toast(f) { f.col(CRUST); f.box(-0.032, -0.004, -0.07, 0.032, 0.008, 0); f.col('#ffffff', 1); f.box(-0.03, 0.008, -0.068, 0.03, 0.011, -0.002); }
function donut(f) {
  for (const [y, r, c] of [[0, 0.013, null], [0.006, 0.0105, 1]]) { if (c) f.col('#ffffff', 1); else f.col('#c98a42');
    within(f, new THREE.Matrix4().makeTranslation(0, y, -0.036), () => f.lathe(0, 0, Array.from({ length: 7 }, (_, k) => { const a = k / 6 * Math.PI * 2; return [0.024 + Math.cos(a) * r, Math.sin(a) * r * 0.75]; }), 12)); }
}
function pastry(f) { f.col('#ffffff', 1); f.sph(0, 0.008, -0.034, 0.03, 0.024, 0.036, 10, 5, { cut: 0 }); f.col('#a8662c'); f.cyl(0, -0.034, 0.028, -0.006, 0.008, 10, 0.03); }
function chip(f) { f.col('#e9c25a'); prism(f, [[0, 0], [0.024, -0.05], [-0.024, -0.05]], -0.0015, 0.0015); f.col('#ffffff', 1); f.sph(0, 0.002, -0.012, 0.012, 0.004, 0.012, 6, 3); }
const HELD_FOOD = {
  'f-burger': [BOTH, burger], 'f-sandwich': [BOTH, sandwich], 'f-wrap': [BOTH, wrapH], 'f-hotdog': [BOTH, hotdog], 'f-sub': [BOTH, sub],
  'f-taco': [BOTH, taco], 'f-bar': [BOTH, bar],
  'f-slice': [biteF, slice], 'f-fry': [biteF, stick(0.0055, 0.075)], 'f-roll': [biteF, stick(0.012, 0.11)], 'f-bite': [biteF, bite], 'f-drum': [biteF, drum],
  'f-disc': [biteF, disc], 'f-toast': [biteF, toast], 'f-donut': [biteF, donut], 'f-pastry': [biteF, pastry], 'f-chip': [biteF, chip],
};
/**
 * Every dish: what is held eating it by hand (a shape above) and its colour — the patty, the filling, the topping; for
 * the cutlery ways the colour of a forkful (a spoonful, what the chopsticks hold). Keep with shared/food.js (a test
 * checks every dish has one).
 */
export const BITE = {
  // both hands
  breakfast_burrito: 'f-wrap #e8b23a', club_sandwich: 'f-sandwich #e9b38c', blt: 'f-sandwich #c2583d', grilled_cheese: 'f-sandwich #f2b53a',
  panini: 'f-sandwich #c9783e', sub: 'f-sub #d8907a', wrap: 'f-wrap #d9a35b', reuben: 'f-sandwich #c2585a', tuna_melt: 'f-sandwich #e8d6a8',
  cheeseburger: 'f-burger #5b3420', bacon_burger: 'f-burger #5b3420', double_burger: 'f-burger #4a2a18', chicken_burger: 'f-burger #c9853a',
  veggie_burger: 'f-burger #7a6a3a', burger_fries: 'f-burger #5b3420', hot_dog: 'f-hotdog #a8412a', tacos: 'f-taco #7a4b2a', burrito: 'f-wrap #c46a3a',
  fajitas: 'f-wrap #c46a3a', shawarma: 'f-wrap #c46a3a', gyro: 'f-wrap #8a4a2a', fish_tacos: 'f-taco #f2e3c8', bbq_ribs: 'f-bar #6a2412',
  corn: 'f-bar #f2c84a', pbj: 'f-sandwich #7a1f4a', tacos_home: 'f-taco #7a4b2a', pulled_pork: 'f-burger #8a4a2a',
  // one hand
  avocado_toast: 'f-toast #8db84a', bagel_lox: 'f-disc #f2875a', croissant: 'f-pastry #d99a4a', pain_au_chocolat: 'f-pastry #cf8a3a',
  muffin: 'f-pastry #b0702e', cinnamon_roll: 'f-pastry #c98a42', donut: 'f-donut #f3d3b0', bagel: 'f-donut #c88a3e', scone: 'f-pastry #d9a85e',
  danish: 'f-pastry #d39444', banana_bread: 'f-toast #7a4a22', cookie: 'f-disc #c98f4c', brownie: 'f-toast #3d2214', pretzel: 'f-donut #8a4a1e',
  nuggets: 'f-bite #d49a4a', fries: 'f-fry #f2c14e', sweet_potato_fries: 'f-fry #e3843a', onion_rings: 'f-donut #d9a04a',
  margherita: 'f-slice #f7f4ea', pepperoni: 'f-slice #a8321f', hawaiian: 'f-slice #f6d64b', veggie_pizza: 'f-slice #3f8a3a',
  four_cheese: 'f-slice #fbf3d8', bbq_pizza: 'f-slice #6b2a14', pizza_slice: 'f-slice #a8321f', garlic_bread: 'f-toast #f3d27a',
  bruschetta: 'f-toast #d8412f', quesadilla: 'f-slice #f2b53a', nachos: 'f-chip #f2b53a', chips_guac: 'f-chip #7fa83a', churros: 'f-roll #c88a3e',
  bao: 'f-pastry #f6f1e4', peking_duck: 'f-roll #f2e3d0', edamame: 'f-bite #7fae3c', mochi: 'f-bite #f6c6d2', samosas: 'f-bite #d39a4a',
  naan: 'f-toast #e6c27f', tandoori: 'f-drum #c8401e', hummus: 'f-chip #e6d3a0', baklava: 'f-toast #d9a04a', macarons: 'f-disc #f2a8c0',
  oysters: 'f-bite #d9cfc0', calamari: 'f-donut #e9c58a', shrimp_cocktail: 'f-bite #f28a5a', wings: 'f-drum #c2401c', cupcake: 'f-pastry #f6c6d2',
  toast_jam: 'f-toast #a3182a', lunchbox: 'f-toast #e9b38c',
  // knife and fork
  pancakes: '#d49a52', waffles: '#d39a4a', french_toast: '#d9993f', eggs_bacon: '#f6b21b', full_breakfast: '#c2583d', omelette: '#f4cf5c',
  eggs_benedict: '#f3d27a', calzone: '#d99a4e', enchiladas: '#a8321f', kebab: '#7a3a1e', steak_frites: '#6a3a22', croque: '#d9a85e',
  coq_au_vin: '#6a2a2a', fish_chips: '#d9a04a', salmon: '#f08c5a', lobster: '#d8371e', ribeye: '#6a3a22', roast_chicken: '#c88a3a',
  brisket: '#5a2a18', chicken_veg: '#c88a3a',
  // a fork
  spaghetti: '#e8c070', carbonara: '#f2dc93', pasta_pomodoro: '#d8603a', lasagna: '#c9603a', alfredo: '#f2e2b0', risotto: '#efe3be',
  gnocchi: '#f0dca0', ravioli: '#f0d58a', caprese: '#f7f4ea', tiramisu: '#c7924e', burrito_bowl: '#d9a35b', falafel: '#8a5a2a',
  greek_salad: '#7cbf4a', moussaka: '#a8603a', quiche: '#f2d27a', ratatouille: '#c8402a', crepes: '#e9c47a', shrimp: '#f28a5a',
  paella: '#e9b84a', mussels: '#e98a4a', mac_cheese: '#f2c14e', mash: '#f3e6c4', coleslaw: '#e9e6c8',
  caesar: '#a3cf5c', garden_salad: '#7cbf4a', cobb: '#8ab84a', buddha_bowl: '#d9a35b', choc_cake: '#4a2a1a', cheesecake: '#f6ecd0',
  apple_pie: '#d9a85e', fruit_tart: '#e8505a', scrambled_eggs: '#f6d25c', stir_fry: '#d9a04a', home_pasta: '#e8b85a', rice_beans: '#6a2a1e',
  salmon_rice: '#f08c5a', leftovers: '#c46a3a',
  // a spoon
  yogurt_parfait: '#fbf8f2', oatmeal: '#e3cfa2', acai_bowl: '#5b2347', minestrone: '#c46a3a', gelato: '#a8d08a', green_curry: '#a9c46a',
  katsu_curry: '#a8641e', miso_soup: '#c9a46a', butter_chicken: '#e07a2c', tikka_masala: '#d8602a', biryani: '#f2c66a', dal: '#e9b84a',
  palak_paneer: '#4f8a2a', onion_soup: '#b07a3a', creme_brulee: '#f2d9a0', chowder: '#f3ead2', tomato_soup: '#d8412f', chicken_soup: '#e9c46a',
  sundae: '#f6e7c8', ice_cream: '#f2c6d2', lava_cake: '#3a1e12', banana_split: '#f6e7c8', pudding: '#c99a5a', cereal: '#e2a84a', veg_soup: '#c46a3a',
  // chopsticks
  fried_rice: '#f2d27a', chow_mein: '#d9a85a', kung_pao: '#c46a3a', sweet_sour: '#e2491f', dumplings: '#f3ecdc', spring_rolls: '#d9a04a',
  pad_thai: '#e9b35a', pho: '#f6f1e2', sushi_platter: '#f2875a', nigiri: '#f2875a', maki: '#2a3a2a', sashimi: '#e8505a', ramen: '#f2dc93',
  tempura: '#f0d38a', teriyaki: '#8a4a1a', gyoza: '#f1e6c8', poke: '#e8505a', instant_noodles: '#f2dc93',
};
// each item's colour (a drink's own; a dish's from BITE), linear, by item number: the shader reads it by the number that
// rides in the shape number's fraction
const TINT = new Float32Array(256 * 4).fill(1), BITE_SHAPE = new Array(256).fill(null);
for (const it of FOOD) {
  const b = it.v ? null : BITE[it.id], hex = it.v ? it.liq : b ? b.split(' ').pop() : '#ffffff';
  TINT.set([...lin(hex), 1], it.n * 4);
  if (b && b.includes(' ')) BITE_SHAPE[it.n] = b.split(' ')[0];
}
const TINT_STEP = 640;
const SHAPES = [
  null,
  { name: 'mug', at: HAND_R, build: f => within(f, upright(0.04, 0.095), () => mug(f, 0, 0)) },
  { name: 'coffee', at: HAND_R, build: f => within(f, upright(0.035, 0.12), () => coffee(f, 0, 0)) },
  { name: 'phone', at: HAND_R, build: phone },
  { name: 'book', at: HAND_R, build: bookClosed },
  { name: 'book-open', at: HAND_R, build: bookOpen },
  { name: 'paddle', at: HAND_R, build: paddle },
  { name: 'dumbbell', at: HAND_R, build: dumbbell },
  { name: 'bag', at: HANG, build: bag },
  { name: 'briefcase', at: HANG, build: briefcase },
  { name: 'laptop', at: DESK, build: laptop },
  { name: 'laptop+coffee', at: DESK, build: f => { laptop(f); coffee(f, -0.27, -0.07, ON); } },
  { name: 'mug-table', at: DESK, build: f => mug(f, -0.22, -0.1, ON) },
  ...Object.entries(HELD).map(([name, [fn, r, h]]) => ({ name, at: HAND_R, build: f => within(f, upright(r, h), () => fn(f)) })),
  // eating (a set of their own: drawn by a mesh of their own, so a phone or a cup costs no more than before): the cutlery
  // (knife and fork: the knife in the right hand, the fork in the left), the food held by hand
  { name: 'u-knife+fork', set: 1, parts: [[HAND_R, f => within(f, toolF(false), () => knife(f))], [HAND_L, f => within(f, toolF(true), () => fork(f, 1))]] },
  { name: 'u-fork', set: 1, at: HAND_R, build: f => within(f, toolF(false), () => fork(f, -1)) },
  { name: 'u-spoon', set: 1, at: HAND_R, build: f => within(f, toolF(false), () => spoon(f)) },
  { name: 'u-sticks', set: 1, at: HAND_R, build: f => within(f, toolF(false), () => sticks(f)) },
  { name: 'u-knife', set: 1, at: HAND_R, build: f => within(f, toolF(false), () => knife(f)) },   // (chopping on a board)
  ...Object.entries(HELD_FOOD).map(([name, [m, fn]]) => ({ name, set: 1, at: HAND_R, build: f => within(f, m, () => fn(f)) })),
  // fishing (a set of its own: drawn only for someone out fishing)
  { name: 'rod', set: 2, at: HAND_R, build: rod },
  { name: 'net', set: 2, at: HAND_R, build: net },
];
// which mesh draws a shape: every instance runs every vertex of its mesh's shapes (the unused ones collapsed), so the
// things held all day and the food at meals are kept apart
const SETS = 3, SET_OF = Uint8Array.from(SHAPES, s => s?.set || 0);
export const SHAPE = Object.freeze(Object.fromEntries(SHAPES.map((s, i) => [s ? s.name : 'none', i])));
/** Is shape `sh` set down on the table in front of someone (a laptop, a mug) rather than held? */
export const onTable = sh => SHAPES[Math.floor(sh)]?.at === DESK;

// ------------------------------------------------------------------ which shape
const TYPING = new Set([CLIP.sit_type, CLIP.stand_work].filter(c => c !== undefined));
// hands busy or nothing held: talking at a table puts a drink down; lying, swimming, dancing hold nothing
const TALKING = new Set([CLIP.sit_talk, CLIP.talk].filter(c => c !== undefined));
const EMPTY = new Set(['lie', 'swim', 'swim_idle', 'swim_under', 'dance', 'cheer', 'clap', 'wave', 'yoga', 'jump', 'run', 'jog'].map(n => CLIP[n]).filter(c => c !== undefined));
const SEATED = new Set(['sit', 'sit_type', 'sit_talk', 'sit_eat', 'sit_relax', 'sit_high', 'sit_play', 'sit_phone', 'sit_read', 'sit_drink'].map(n => CLIP[n]).filter(c => c !== undefined));
const SHAPE_OF = new Uint8Array(256 * 16);
for (let c = 0; c < 256; c++) for (let p = 0; p < 16; p++) SHAPE_OF[c * 16 + p] = pick(c, p);
function pick(c, p) {
  if (!p || EMPTY.has(c)) return 0;
  const typing = TYPING.has(c), seated = SEATED.has(c), talking = TALKING.has(c);
  switch (p) {
    case PROP.laptop: return typing && c !== CLIP.stand_work ? SHAPE.laptop : 0;
    // (sitting down with a coffee — a café's table — it comes in a cup; walking, standing or by a laptop it is to go)
    case PROP.coffee: return typing ? (c === CLIP.stand_work ? 0 : SHAPE['laptop+coffee']) : talking ? (seated ? SHAPE['mug-table'] : 0) : seated ? SHAPE.mug : SHAPE.coffee;
    case PROP.cup: return typing || talking ? (seated && c !== CLIP.stand_work ? SHAPE['mug-table'] : 0) : SHAPE.mug;
    case PROP.phone: return typing || talking ? 0 : SHAPE.phone;
    case PROP.book: return c === CLIP.sit_read ? SHAPE['book-open'] : typing || talking ? 0 : SHAPE.book;
    case PROP.paddle: return seated ? 0 : SHAPE.paddle;
    case PROP.dumbbell: return seated ? 0 : SHAPE.dumbbell;
    case PROP.bag: return seated || typing ? 0 : SHAPE.bag;
    case PROP.briefcase: return seated || typing ? 0 : SHAPE.briefcase;
    default: return 0;
  }
}
const HAND_DRINK = new Set([SHAPE.mug, SHAPE.coffee]);
const ROD = new Set(['fish_idle', 'fish_cast', 'fish_reel', 'fish_fight'].map(n => CLIP[n]));
/** The clips that bring their own thing to hold, whatever the person carries (fishing: the rod, the net), by clip. */
export const GEAR_CLIP = new Uint8Array(256);
for (const c of [...ROD, CLIP.fish_net]) GEAR_CLIP[c] = 1;
/**
 * The shape drawn for someone in MVW clip c holding prop p (0: nothing); item: the food or drink their plan carries
 * (shared/food.js number) — a drink in the hand is its own glass and colour (a fraction on the shape number); a drink
 * set down on a table is drawn by render/food-table.js, not here.
 */
export function shapeFor(c, p, item = 0) {
  const it = item ? FOOD_BY_N[item] : null;
  if (EATING.has(c)) return it && !it.v ? SHAPE[TOOL_OF[it.eat] || BITE_SHAPE[item]] + item / TINT_STEP : 0;
  // cooking at a stove: a spoon stirring the pan (a spoonful of the dish's colour); making something cold: a knife
  if (c === CLIP.cook) return SHAPE['u-spoon'] + (it && !it.v ? item / TINT_STEP : 0);
  if (c === CLIP.prep) return SHAPE['u-knife'];
  if (ROD.has(c)) return SHAPE.rod;
  if (c === CLIP.fish_net) return SHAPE.net;
  const sh = c >= 0 && c < 256 && p > 0 && p < 16 ? SHAPE_OF[c * 16 + p] : 0;
  if (!sh || !it?.v) return sh;
  if (HAND_DRINK.has(sh)) return SHAPE[HELD_OF[it.v] || 'h-glass'] + item / TINT_STEP;
  if (sh === SHAPE['mug-table']) return 0;
  if (sh === SHAPE['laptop+coffee']) return SHAPE.laptop;
  return sh;
}

/**
 * The clip someone is drawn with, given what they hold: carrying a drink or a book walks and stands holding it, a phone
 * is looked at (some people make a call instead), a drink at a table is sipped, a book read. c: the MVW clip from the
 * plan; use: its use id; callUse: the use ids where a phone is always looked at (working on it); app: who (varies the
 * phone call).
 */
export function holdClip(c, p, use, app, lookUses) {
  if (!p) return c;
  const drink = p === PROP.cup || p === PROP.coffee;
  if (c === CLIP.walk) return p === PROP.phone ? CLIP.walk_phone : drink || p === PROP.book ? CLIP.walk_hold : c;
  if (c === CLIP.idle) return p === PROP.phone ? CLIP.phone_look : drink || p === PROP.book ? CLIP.idle_hold : c;
  if (c === CLIP.phone && p === PROP.phone) return lookUses.has(use) || app % 3 ? CLIP.phone_look : c;
  if (c === CLIP.sit_relax && p === PROP.book) return CLIP.sit_read;
  if (drink && (c === CLIP.sit || c === CLIP.sit_eat || c === CLIP.sit_relax || c === CLIP.sit_high)) return CLIP.sit_drink;
  return c;
}

// eating
const EATING = new Set(['eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon', 'eat_lap', 'eat_stand', 'eat_stand_hands'].map(n => CLIP[n]));
const TOOL_OF = { knife: 'u-knife+fork', fork: 'u-fork', spoon: 'u-spoon', sticks: 'u-sticks' };
// where someone eats at a table: the seated meal and its sips, sitting at a table or on a bar stool
const MEAL = new Set(['sit_eat', 'sit_high', 'sit', 'sit_drink'].map(n => CLIP[n]));
const EAT_OF = new Int16Array(256).fill(-1);
for (const it of FOOD) if (!it.v) EAT_OF[it.n] = CLIP[EAT_CLIP[it.eat]];
// with no table (2026-10-08, "if the agent has no table they can only eat handheld items"): on a seat (a sofa, an
// armchair), or standing in the kitchen — the food in the hands (shared/food.js homeMeal picks such a dish there; a café
// sofa's dessert is eaten the same way, its spoon in the hand)
const LAP = new Set(['sit_relax'].map(n => CLIP[n])), STAND = new Set(['idle', 'idle_hold'].map(n => CLIP[n]));
/**
 * The clip someone with item `item` on their plan is drawn with: at a table their dish eaten its way (shared/food.js
 * eat → shared/eating.js EAT_CLIP); on a seat with no table or standing, in the hands (both for a burger, one for the
 * rest); a drink is sipped as before (c). c: the clip so far (after holdClip).
 */
export function eatClip(c, item) {
  if (!(item > 0 && item < 256) || EAT_OF[item] < 0) return c;
  if (MEAL.has(c)) return EAT_OF[item];
  const both = FOOD_BY_N[item].eat === 'hands';
  if (LAP.has(c)) return both ? CLIP.eat_hands : CLIP.eat_lap;
  if (STAND.has(c)) return both ? CLIP.eat_stand_hands : CLIP.eat_stand;
  return c;
}
/** Is clip c one of eating (the dish's knife, fork, spoon or chopsticks are in the hands, not on the table)? */
export const isEating = c => EATING.has(c);

// ------------------------------------------------------------------ geometry (every shape, once)
const GEO = [];
/** The geometry of one set of shapes (each vertex: its shape's number and where it is held, aProp). */
function geometry(set) {
  if (GEO[set]) return GEO[set];
  const parts = [];
  SHAPES.forEach((s, id) => {
    if (!s || SET_OF[id] !== set) return;
    for (const [at, build] of s.parts || [[s.at, s.build]]) {   // (a shape may be in both hands: knife and fork)
      const f = new FB(); build(f);
      const g = f.build().geo;
      const n = g.attributes.position.count, a = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { a[i * 2] = id; a[i * 2 + 1] = at; }
      g.setAttribute('aProp', new THREE.BufferAttribute(a, 2));
      parts.push(g);
    }
  });
  const P = [], N = [], C = [], A = [], I = [];
  let base = 0;
  for (const g of parts) {
    P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); C.push(...g.attributes.aC.array); A.push(...g.attributes.aProp.array);
    for (const i of g.index.array) I.push(i + base);
    base += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(C, 4));
  g.setAttribute('aProp', new THREE.Float32BufferAttribute(A, 2));
  g.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  return (GEO[set] = g);
}

// ------------------------------------------------------------------ shaders
const VERT = /* glsl */`
attribute vec4 aC;
attribute vec2 aProp;
attribute vec4 iPos;
attribute vec4 iAnim;
attribute vec4 iMisc;
uniform vec3 uRig;
uniform mat4 uGrip[2];
uniform vec3 uDesk;
uniform vec3 uBones;   // right hand, left hand, chest (Spine2)
uniform sampler2D uTint;   // every item's colour (linear; a drink's, a held dish's), by the item number in the shape number's fraction
${APP_GLSL}
${SKIN_GLSL}
#ifndef CHAR_DEPTH
varying vec4 vC;
varying float vIn;
varying vec3 vLiq;
#endif
mat4 prM;
vec3 prOff;
float prHide;
float prDesk;   // set down on the table (deskPoint): placed, not grown with the body
mat4 prBone(int b) {
  mat4 m = chBoneAt(int(iAnim.x + 0.5), iAnim.y, b);
  if (iMisc.x > 0.003) m = m * (1.0 - iMisc.x) + chBoneAt(int(iAnim.z + 0.5), iAnim.w, b) * iMisc.x;
  return m;
}
void propCompute() {
  prHide = abs(aProp.x - iMisc.z) > 0.5 ? 1.0 : 0.0;
  prOff = vec3(0.0);
  prDesk = 0.0;
  if (prHide > 0.5) { prM = mat4(1.0); }
  else if (aProp.y < 1.5 || aProp.y > 2.5) {
    int side = aProp.y < 0.5 ? 0 : aProp.y < 1.5 ? 1 : 0;
    prM = prBone(int((side == 0 ? uBones.x : uBones.y) + 0.5)) * uGrip[side];
    // the rig's arm calibration (characters.js charCompute) moves a hand by its full amount
    float rigK = chRigK(int(iAnim.x + 0.5));
    if (iMisc.x > 0.003) rigK = mix(rigK, chRigK(int(iAnim.z + 0.5)), iMisc.x);
    if (rigK > 0.001 && dot(uRig, uRig) > 1e-9) { float sd = side == 0 ? -1.0 : 1.0; prOff = mat3(prBone(int(uBones.z + 0.5))) * vec3(sd * uRig.x, uRig.y, uRig.z) * rigK; }
    if (aProp.y > 2.5) { vec3 g = prM[3].xyz; prM = mat4(1.0); prM[3].xyz = g; }   // hanging: from the grip, upright
  } else { prM = mat4(1.0); prDesk = 1.0; }
#ifndef CHAR_DEPTH
  vC = aC;
  vIn = float((int(iMisc.w + 0.5) >> 2) & 1);
  vLiq = texture2D(uTint, vec2((floor(fract(iMisc.z) * ${TINT_STEP}.0 + 0.5) + 0.5) / 256.0, 0.5)).rgb;
#endif
}
`;
const PLACE = /* glsl */`
{
  int a = int(iMisc.y + 0.5);
  float H = 0.8 + chAppI(a, 0).a * 0.4, Bd = 0.8 + chAppI(a, 6).a * 0.45;
  if (prDesk > 0.5) {
    float k = H * Bd;
    transformed += vec3(uDesk.x * k, ${DESK_TOP - ON}, clamp(uDesk.z * k, ${DESK_FWD[0]}, ${DESK_FWD[1]}));
  } else {
    transformed = (prM * vec4(transformed, 1.0)).xyz + prOff;
    transformed.xz *= H * Bd; transformed.y *= H;
  }
  transformed = chRot(transformed) + iPos.xyz;
  if (prHide > 0.5) transformed = vec3(0.0, -1000.0, 0.0);
}`;
const FRAG_PARS = /* glsl */`
varying vec4 vC;
varying float vIn;
varying vec3 vLiq;
uniform float uIndoor;
uniform float uNight;
`;

const TINT_U = { value: (() => { const t = new THREE.DataTexture(TINT, 256, 1, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; })() };

// ------------------------------------------------------------------ renderer
export class CharProps {
  /** shared: the characters' uniforms (uApp, uIndoor, uNight). */
  constructor(group, shared, shadows) {
    this.group = group; this.shared = shared; this.shadows = shadows;
    this.kinds = [];   // per character model: { mats, sets: per set of shapes { mesh, g, iPos, iAnim, iMisc } } once it has loaded
    this.desks = [];   // per character model: where things on a table in front of it stand (its 'desk' point; render/pc-screens.js)
    this.stage = [];   // per character model and set of shapes (k * SETS + set): { P, An, M, n, cap }
  }
  /** A character model is ready: d = its loaded data (anim texture, clip table, manifest, grips), rigU its arm calibration. */
  initKind(k, d, rigU) {
    const gr = d.grips;
    if (!gr || !gr.R || !gr.L) return;   // (a model without grips: tools/chars/extra-clips.mjs not run for it) holds nothing
    const names = d.man.names.map(n => n.replace(/^mixamorig:/, '')), bone = n => names.indexOf(n);
    const m4 = r => new THREE.Matrix4().set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], 0, 0, 0, 1);
    const U = {
      uAnim: { value: d.tex }, uClip: { value: d.clip }, uRig: rigU,
      uGrip: { value: [m4(gr.R), m4(gr.L)] }, uDesk: { value: new THREE.Vector3(...(gr.desk || [0, 0.755, 0.55])) },
      uBones: { value: new THREE.Vector3(bone('RightHand'), bone('LeftHand'), bone('Spine2')) },
      uApp: this.shared.uApp, uIndoor: this.shared.uIndoor, uNight: this.shared.uNight, uTint: TINT_U,
    };
    this.desks[k] = U.uDesk.value;
    const mats = { color: this.material(U, false), depth: this.material(U, true) };
    this.kinds[k] = { mats, sets: [] };
    for (let set = 0; set < SETS; set++) this.build(k, set);
  }
  material(U, depth) {
    const m = depth ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }) : new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + (depth ? '#define CHAR_DEPTH\n' : '') + VERT)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\npropCompute();' + PLACE);
      if (!depth) {
        sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\npropCompute();\nobjectNormal = chRot(mat3(prM) * objectNormal);')
          .replace('#include <begin_vertex>\npropCompute();', '#include <begin_vertex>');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
          .replace('#include <color_fragment>', '#include <color_fragment>\nfloat prEmit = floor(vC.w * 0.5 + 0.01);\ndiffuseColor.rgb *= mod(vC.w + 0.01, 2.0) > 0.5 ? vLiq * vC.rgb : vC.rgb;')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (prEmit > 0.5) roughnessFactor = 0.3;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (prEmit > 0.5) totalEmissiveRadiance += vC.rgb * (0.5 + 0.55 * uNight);\ntotalEmissiveRadiance += diffuseColor.rgb * uIndoor * vIn * 0.45;');
      }
    };
    m.customProgramCacheKey = () => `mvw-char-props-${depth ? 'd' : 'c'}`;
    return m;
  }
  /** (Re)builds model k's mesh of a set of shapes round its staging buffers. */
  build(k, set) {
    const kd = this.kinds[k]; if (!kd) return;
    const st = this.stageOf(k, set), old = kd.sets[set];
    if (old) { this.group.remove(old.mesh); old.g.dispose(); }
    const base = geometry(set), g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index);
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    const mk = arr => { const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const iPos = mk(st.P), iAnim = mk(st.An), iMisc = mk(st.M);
    g.setAttribute('iPos', iPos); g.setAttribute('iAnim', iAnim); g.setAttribute('iMisc', iMisc);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, kd.mats.color);
    mesh.frustumCulled = false; mesh.castShadow = this.shadows; mesh.receiveShadow = true; mesh.userData.smallCaster = true;
    mesh.customDepthMaterial = kd.mats.depth; mesh.renderOrder = 1; mesh.visible = false;
    this.group.add(mesh);
    kd.sets[set] = { mesh, g, iPos, iAnim, iMisc };
  }
  stageOf(k, set) { return (this.stage[k * SETS + set] ??= { P: new Float32Array(16 * 4), An: new Float32Array(16 * 4), M: new Float32Array(16 * 4), n: 0, cap: 16 }); }
  begin() { for (const s of this.stage) if (s) s.n = 0; }
  /** Someone of model k holding shape `shape` (iPos/iAnim/iMisc as the body's; the shape in the misc's third slot). */
  push(k, x, y, z, yaw, a, pA, b, pB, w, app, shape, flags) {
    const set = SET_OF[Math.floor(shape)], s = this.stageOf(k, set);
    if (s.n >= s.cap) {
      const cap = s.cap * 2, more = v => { const n = new Float32Array(cap * 4); n.set(v); return n; };
      s.P = more(s.P); s.An = more(s.An); s.M = more(s.M); s.cap = cap;
      this.build(k, set);
    }
    const o = s.n * 4; s.n++;
    s.P[o] = x; s.P[o + 1] = y; s.P[o + 2] = z; s.P[o + 3] = yaw;
    s.An[o] = a; s.An[o + 1] = pA; s.An[o + 2] = b; s.An[o + 3] = pB;
    s.M[o] = w; s.M[o + 1] = app; s.M[o + 2] = shape; s.M[o + 3] = flags;
  }
  end() {
    this.kinds.forEach((kd, k) => {
      if (!kd) return;
      kd.sets.forEach((m, set) => {
        const n = this.stage[k * SETS + set]?.n || 0;
        m.g.instanceCount = n; m.mesh.visible = n > 0;
        if (!n) return;
        for (const a of [m.iPos, m.iAnim, m.iMisc]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
      });
    });
  }
  setShadows(on) { this.shadows = on; for (const kd of this.kinds) if (kd) for (const m of kd.sets) m.mesh.castShadow = on; }
  count() { return this.stage.reduce((t, s) => t + (s ? s.n : 0), 0); }
}
