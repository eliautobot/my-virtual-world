// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Tripo character clips (character lab). The server and the rest of the client keep MVW's clip ids (shared/anims.js +
// anim.js CLIP_NAMES); each id is mapped to one baked Tripo clip here. Durations/strides are refreshed from the asset
// manifest once it loads (see characters.js), the defaults below match the current bake.
export const TRIPO_CLIPS = ['idle', 'walk', 'run', 'sit', 'lie', 'jump', 'dance_01', 'dance_02', 'dance_03', 'dance_04', 'dance_05',
  'dance_06', 'cheer', 'clap', 'bow', 'agree', 'greet_02', 'wave_goodbye_01', 'make_a_call_01', 'play_mobile_game', 'look_around',
  'wait', 'fold_arms', 'laugh_01', 'warm_up', 'scratch', 'sit_work', 'sit_idle', 'sit_talk',
  'call_stand', 'wave_stand', 'wave_sit', 'wait_02', 'clap_02', 'jump_02', 'idle_male', 'greet_male', 'stand_work', 'play_arcade',
  'swim_idle', 'swim', 'swim_under',   // swimming: tools/chars/extra-clips.mjs (<kind>.extra.bin)
  // holding things (tools/chars/extra-clips.mjs, posed from the walk, the idle and the seated idle)
  'hold_walk', 'hold_walk_phone', 'hold_idle', 'hold_phone', 'hold_drink', 'hold_sit_phone', 'hold_sit_drink', 'hold_sit_read',
  // doing things with the hands (tools/chars/extra-clips.mjs, on the idle's still stance)
  'act_cook', 'act_wash', 'act_browse', 'act_use', 'act_lift', 'act_pingpong',
  // eating at a table (tools/chars/extra-clips.mjs; which one: render/char-props.js eatClip, by the dish - shared/eating.js)
  'eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon',
  // with no table, and making something cold on a counter (2026-10-08)
  'eat_lap', 'eat_stand', 'eat_stand_hands', 'act_prep',
  // out in a boat (2026-10-14, the fishing game): at the wheel; the rod held, cast, reeled, a fish fought, netted, shown
  'helm', 'fish_idle', 'fish_cast', 'fish_reel', 'fish_fight', 'fish_net', 'fish_show'];
export const T = Object.freeze(Object.fromEntries(TRIPO_CLIPS.map((n, i) => [n, i])));
export const TRIPO_DUR = {
  idle: 12, walk: 2.3333, run: 1.25, sit: 7.1667, lie: 4, jump: 2.2083, cheer: 12, clap: 12, bow: 6, agree: 4, greet_02: 5.5833,
  wave_goodbye_01: 6.5833, make_a_call_01: 12, play_mobile_game: 12, look_around: 12, wait: 6, fold_arms: 12, laugh_01: 5.5833,
  warm_up: 12, scratch: 12, sit_work: 6.6667, sit_idle: 6.6667, sit_talk: 6.6667, call_stand: 6.6667, wave_stand: 4.75, wave_sit: 4.75, wait_02: 6.6667, clap_02: 2.5, jump_02: 2.5, idle_male: 6.6667, greet_male: 5.0833, stand_work: 6.6667, play_arcade: 6.6667, dance_01: 12, dance_02: 12, dance_03: 12, dance_04: 12, dance_05: 12, dance_06: 12,
  swim_idle: 2.4, swim: 1.5, swim_under: 1.9,
  hold_walk: 2.3333, hold_walk_phone: 2.3333, hold_idle: 12, hold_phone: 12, hold_drink: 12, hold_sit_phone: 6.6667, hold_sit_drink: 6.6667, hold_sit_read: 6.6667,
  act_cook: 2.4, act_wash: 2, act_browse: 6, act_use: 2, act_lift: 3, act_pingpong: 1.2,
  eat_hands: 6, eat_hand: 6, eat_knife: 8, eat_spoon: 7, eat_lap: 6, eat_stand: 6, eat_stand_hands: 6, act_prep: 2,
  helm: 3, fish_idle: 4, fish_cast: 1.3, fish_reel: 0.9, fish_fight: 1.8, fish_net: 1.6, fish_show: 3,
};
/** A clip a character may lack (its added frames missing): played as this one instead. */
export const TRIPO_FALLBACK = {
  swim_idle: 'idle', swim: 'walk', swim_under: 'walk', hold_walk: 'walk', hold_walk_phone: 'walk', hold_idle: 'idle', hold_phone: 'play_mobile_game',
  hold_drink: 'wait', hold_sit_phone: 'sit', hold_sit_drink: 'sit_idle', hold_sit_read: 'sit_idle',
  act_cook: 'look_around', act_wash: 'look_around', act_browse: 'look_around', act_use: 'look_around', act_lift: 'warm_up', act_pingpong: 'warm_up',
  eat_hands: 'sit', eat_hand: 'sit', eat_knife: 'sit', eat_spoon: 'sit', eat_lap: 'sit', eat_stand: 'idle', eat_stand_hands: 'idle', act_prep: 'look_around',
  helm: 'idle', fish_idle: 'idle', fish_cast: 'idle', fish_reel: 'idle', fish_fight: 'idle', fish_net: 'idle', fish_show: 'idle',
};
/**
 * Clips that put the hands against the body's own marks - a cup or a fork at the lips, a burger held between both hands
 * (tools/chars/extra-clips.mjs measures them on each character): the arm calibration (assets/chars/rig.json, which moves
 * the arms out from the body for the bake's own clips) is left off while they play, or it would push the cup off the
 * lips and the hands off the burger (2026-10-07).
 */
export const TRIPO_EXACT = new Set(['hold_drink', 'hold_sit_drink', 'eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon', 'eat_lap', 'eat_stand', 'eat_stand_hands',
  'act_cook', 'act_prep',   // (and the spoon in the pan on the hob, the knife on the board)
  'fish_idle', 'fish_cast', 'fish_reel', 'fish_fight', 'fish_net', 'fish_show']);   // (both hands on the one rod, the net's handle, the fish)
export const TRIPO_STRIDE = { walk: 2.708, run: 5.25, swim: 1.95, swim_under: 1.6, hold_walk: 2.708, hold_walk_phone: 2.708 };
/** MVW clip name -> Tripo clip name. */
export const OLD_TO_TRIPO = {
  idle: 'idle', walk: 'walk', run: 'run', jog: 'run', sit: 'sit', sit_type: 'sit_work', sit_talk: 'sit_talk', sit_eat: 'sit', sit_relax: 'sit_idle',
  sit_high: 'sit', sit_play: 'sit', sit_phone: 'hold_sit_phone', lie: 'lie', talk: 'agree', drink: 'hold_drink', use: 'act_use',
  cook: 'act_cook', wash: 'act_wash', browse: 'act_browse', phone: 'call_stand', wave: 'wave_stand',
  dance: 'dance_01', cheer: 'cheer', yoga: 'warm_up', lift: 'act_lift', pingpong: 'act_pingpong', play: 'play_arcade',
  present: 'fold_arms', wait: 'wait_02', staff: 'fold_arms', jump: 'jump_02', clap: 'clap_02', walk_hold: 'hold_walk', idle_hold: 'hold_idle',
  sit_read: 'hold_sit_read', stand_work: 'stand_work', swim_idle: 'swim_idle', swim: 'swim', swim_under: 'swim_under',
  walk_phone: 'hold_walk_phone', phone_look: 'hold_phone', sit_drink: 'hold_sit_drink',
  eat_hands: 'eat_hands', eat_hand: 'eat_hand', eat_knife: 'eat_knife', eat_spoon: 'eat_spoon',
  eat_lap: 'eat_lap', eat_stand: 'eat_stand', eat_stand_hands: 'eat_stand_hands', prep: 'act_prep',
  helm: 'helm', fish_idle: 'fish_idle', fish_cast: 'fish_cast', fish_reel: 'fish_reel', fish_fight: 'fish_fight', fish_net: 'fish_net', fish_show: 'fish_show',
};
/** Fill MVW's CLIP_DUR / CLIP_STRIDE tables from the Tripo timings (called by anim.js at import and after load). */
export function applyTripoTiming(names, dur, stride, tDur = TRIPO_DUR, tStride = TRIPO_STRIDE) {
  names.forEach((n, i) => {
    const t = OLD_TO_TRIPO[n] || 'idle';
    dur[i] = tDur[t] || 6;
    stride[i] = tStride[t] || 0;
  });
}
