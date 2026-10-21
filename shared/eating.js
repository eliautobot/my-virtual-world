// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Eating (2026-10-07, "proper eating animations depending on the meal"): which clip each way of eating plays
// (shared/food.js EAT_WAYS) and where what is eaten sits in the hands — shared by the clips (tools/chars/extra-clips.mjs
// poses the hands so these points reach the dish and the mouth) and the drawing (client/js/render/char-props.js draws
// the food and the cutlery at them). Points are in a hand's grip frame (tools/chars/extra-clips.mjs gripsOf: origin on
// the palm, y along the fingers, z out of the palm, x = y × z — the right hand's index finger's side, the left's little
// finger's), metres.

/** The clip of each way of eating (a fork alone, a spoon and chopsticks share one: the hand dips and lifts the same). */
export const EAT_CLIP = Object.freeze({ hands: 'eat_hands', hand: 'eat_hand', knife: 'eat_knife', fork: 'eat_spoon', spoon: 'eat_spoon', sticks: 'eat_spoon' });
export const EAT_CLIPS = Object.freeze(['eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon']);

/** Held in both hands (a burger, a sandwich): its middle this far out of either palm, the palms facing across it, the
 *  fingers BOTH_LIFT (radians) up from level over its top — it stands upright between them, seen from the front. */
export const BOTH_R = 0.06, BOTH_LIFT = 0.75;
/** The held foods are drawn this much larger than life (the characters' hands are; render/char-props.js). */
export const HELD_SCALE = 1.2;
/** Held in one hand between the thumb and the curled fingers (a slice, a fry, a cookie), pointing out past the index
 *  finger: the end that is bitten. */
export const BITE_TIP = Object.freeze([0.06, 0.11, 0.022]);
/**
 * Cutlery and chopsticks: the handle across the palm from its heel and out past the index finger's knuckle, inside the
 * curled fingers (TOOL_Z out of the palm), and tipped TOOL_TILT toward the palm's side the way a fork or a spoon sits in
 * the fingers — so the working end (the knife's point, the fork's tines, the spoon's bowl, the sticks' ends; TOOL_LEN
 * along it) reaches down into a dish with the wrist near straight (2026-10-07: dipping into the food looked like a
 * broken wrist). The right hand's direction; the left's x is the other way (its x is the little finger's side).
 */
export const TOOL_TILT = 0.5;
export const TOOL_DIR = Object.freeze([0.57 * Math.cos(TOOL_TILT), 0.82 * Math.cos(TOOL_TILT), Math.sin(TOOL_TILT)]);
export const TOOL_Z = 0.014, TOOL_LEN = 0.15;
/** The working end of a tool held in a hand. */
export const toolTip = (left = false) => [TOOL_DIR[0] * TOOL_LEN * (left ? -1 : 1), TOOL_DIR[1] * TOOL_LEN, TOOL_Z + TOOL_DIR[2] * TOOL_LEN];
/** A tool's direction in a hand's grip frame. */
export const toolDir = (left = false) => [TOOL_DIR[0] * (left ? -1 : 1), TOOL_DIR[1], TOOL_DIR[2]];
/** The most a hand turns from its forearm while eating (radians): the clips keep the wrist within it. */
export const WRIST_MAX = 0.7;

/** Where render/food-table.js puts a dish before someone seated at a table (root space: its top, how far ahead). */
export const TABLE_TOP = 0.762, DISH_AHEAD = 0.46;
/**
 * The kitchen (2026-10-08: cooking needs a stove): where the pan stands, seen from the stove's cook slot — the kitchen
 * unit's front right burner (render/furniture.js D.kitchen; root space: x to the left, y up, z ahead) — and where
 * something cold is made, on the board of a counter seen from its prep slot (D.counter). Both clips (act_cook, act_prep)
 * and render/food-table.js use them.
 */
export const STOVE_PAN = Object.freeze([-0.17, 0.94, 0.37]), PREP_BOARD = Object.freeze([0.06, 0.96, 0.41]);
