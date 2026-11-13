// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The wildlife catalogue (WP4.17, wp4-world-spec.md §6.3): one data file per species in shared/world-config/species/
// (listed in index.json), checked against this schema; adding a species needs no code as long as it uses a known model
// and behaviour. Fields:
//   id, name; tier 'ambient' (simulated in each browser from the seed and the clock) or 'shared' (on the server);
//   model: bird | duck | butterfly | firefly | deer | rabbit | fish | cow | sheep | horse | reeffish | turtle | otter |
//   alligator | beaver | dolphin | seagull | crab | goat | wolf | tiger | shark | whale | marlin | manta | jellyfish | boar |
//   bull | bear | moose (goat on: drawn from their modelled assets; their built stand-ins borrow a near relative's shape); behaviour: flock | circle | soar | swim (round a lake, or up and down a
//   river's slow stretch) | flutter | glow | graze | jump | school (under water, over its reef) | cruise (a slow glide near
//   the sea floor; breathe: up to the surface every minute or so for a few breaths, as sea turtles) | pod (dolphins: a long loop offshore, surfacing in arcs, now and then a leap) | scuttle (crabs: short
//   sideways dashes on the sand near the water) | patrol (sharks: alone on a wide, slow loop offshore a few metres
//   down, the fin now and then cutting the surface; swimDepth [min, max] m sets how deep, leaps: now and then clear of
//   the water, as a marlin) | roam (whales: a long slow loop, surfacing to breathe and sounding again) | drift
//   (jellyfish: a bloom drifting near the surface, pulsing) | wade (flamingos: a flock in the shallows off a beach, 10-45 cm
//   of sea, strolling and feeding);
//   habitats: forest, meadow, field, beach, shore, rock, snow (the snowfields of the high mountains), lake, river (its
//   slow, wide stretches: perKm2 per km² of its water), reef (the shallow sea floor), sea (open water 7–60 m deep);
//   altitude [min, max] (m above the sea; optional: only the parts of its habitats this high, as the white tigers near
//   the snowy peaks); depth [min, max] (m of water under it, for the sea and the reefs: whales and marlin keep to deep
//   water); nearWater (m: only within that distance of a lake or a river, as moose); hours [from, to] (may wrap past
//   midnight); joins (the id of a shared species whose groups it goes along with, one of it with a joinChance (0..1) of
//   theirs, as a rooster with the hens or an elder stag leading a herd of deer; its own perKm2, if any, adds lone ones);
//   weather: the kinds it is out in; group [min, max]; perKm2: groups per km² of its habitat; size (m);
//   habitatWeight { habitat: share } (shared tier, optional): how much of its perKm2 it has on each of its habitats (1
//   where not given: sheep { field: 1, meadow: 0.15 } keep mostly to the farms' pastures);
//   haunts [{ near: falls | river | lake | water, within (m from its edge), perKm2, on? [habitats] }] (shared tier,
//   optional): places found from the island's own water where it gathers — that many more groups per km² of its
//   habitats (and of the on kinds of ground) within that distance, the herd keeping to it and down to the water's edge
//   now and then (bears where the rivers fall, fishing); falls are the rivers' waterfalls and cascades, and their pools;
//   colors: '#rrggbb' list; height [min, max] above ground (flyers); speed (m/s); run (m/s) and flee (m) for grazers
//   (flee 0: never runs off, as farm animals);
//   sound: an ambient sound cue (optional);
//   asset: a modelled animal's manifest (/assets/fauna/<id>/<name>.json, render/fauna-skinned.js; optional — the built
//   model stands in when it can't load); coats: [{ name, body, hair, legs }] the colours it may wear (optional).
export const MODELS = ['bird', 'duck', 'butterfly', 'firefly', 'deer', 'rabbit', 'fish', 'cow', 'sheep', 'horse', 'reeffish', 'turtle', 'otter', 'alligator', 'beaver', 'dolphin', 'seagull', 'crab', 'goat', 'wolf', 'tiger', 'shark', 'whale', 'marlin', 'manta', 'jellyfish', 'boar', 'bull', 'bear', 'moose'];
export const BEHAVIOURS = ['flock', 'circle', 'soar', 'swim', 'flutter', 'glow', 'graze', 'jump', 'school', 'cruise', 'pod', 'scuttle', 'patrol', 'roam', 'drift', 'wade'];
export const HABITATS = ['forest', 'meadow', 'field', 'beach', 'shore', 'rock', 'snow', 'lake', 'river', 'reef', 'sea'];
export const HAUNTS = ['falls', 'river', 'lake', 'water'];
const WEATHER = ['clear', 'partly', 'overcast', 'rain', 'storm', 'fog'];
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const range = (v, lo, hi) => Array.isArray(v) && v.length === 2 && num(v[0], lo, hi) && num(v[1], lo, hi);

/** Problems with a species entry ([] when valid). */
export function validateSpecies(s) {
  const out = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(s.id || '')) out.push('id: lowercase letters, digits and dashes');
  if (typeof s.name !== 'string' || !s.name.trim()) out.push('name');
  if (!['ambient', 'shared'].includes(s.tier)) out.push('tier: ambient or shared');
  if (!MODELS.includes(s.model)) out.push(`model: one of ${MODELS.join(', ')}`);
  if (!BEHAVIOURS.includes(s.behaviour)) out.push(`behaviour: one of ${BEHAVIOURS.join(', ')}`);
  if (!Array.isArray(s.habitats) || !s.habitats.length || s.habitats.some(h => !HABITATS.includes(h))) out.push(`habitats: from ${HABITATS.join(', ')}`);
  if (!range(s.hours, 0, 24)) out.push('hours: [from, to] in 0..24');
  if (!Array.isArray(s.weather) || s.weather.some(w => !WEATHER.includes(w))) out.push('weather: kinds of weather');
  if (!range(s.group, 1, 60) || s.group[0] > s.group[1]) out.push('group: [min, max]');
  if (!num(s.perKm2, 0, 1000)) out.push('perKm2');
  if (!num(s.size, 0.01, 30)) out.push('size (m)');
  if (!Array.isArray(s.colors) || !s.colors.length || s.colors.some(c => !/^#[0-9a-f]{6}$/i.test(c))) out.push('colors');
  if (s.height !== undefined && !range(s.height, 0, 500)) out.push('height: [min, max] m');
  if (s.altitude !== undefined && (!range(s.altitude, -100, 5000) || s.altitude[0] > s.altitude[1])) out.push('altitude: [min, max] m above the sea');
  if (s.depth !== undefined && (!range(s.depth, 0, 500) || s.depth[0] > s.depth[1])) out.push('depth: [min, max] m of water');
  if (s.swimDepth !== undefined && (!range(s.swimDepth, 0, 100) || s.swimDepth[0] > s.swimDepth[1])) out.push('swimDepth: [min, max] m');
  if (s.nearWater !== undefined && !num(s.nearWater, 1, 5000)) out.push('nearWater (m)');
  if (s.habitatWeight !== undefined && (!s.habitatWeight || typeof s.habitatWeight !== 'object' || Array.isArray(s.habitatWeight)
    || Object.entries(s.habitatWeight).some(([k, v]) => !s.habitats?.includes(k) || !num(v, 0, 10)))) out.push('habitatWeight: { one of its habitats: 0..10 }');
  if (s.haunts !== undefined && (!Array.isArray(s.haunts) || s.haunts.length > 6 || s.haunts.some(h => !h || !HAUNTS.includes(h.near) || !num(h.within, 1, 2000)
    || !num(h.perKm2, 0, 1000) || (h.on !== undefined && (!Array.isArray(h.on) || h.on.some(k => !HABITATS.includes(k))))))) out.push(`haunts: [{ near (${HAUNTS.join(', ')}), within (m), perKm2, on? [habitats] }]`);
  if (s.leaps !== undefined && typeof s.leaps !== 'boolean') out.push('leaps: true or false');
  if (s.breathe !== undefined && typeof s.breathe !== 'boolean') out.push('breathe: true or false');
  if (s.joins !== undefined && (typeof s.joins !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(s.joins) || s.tier !== 'shared' || !num(s.joinChance, 0, 1))) out.push('joins: a shared species id, with joinChance 0..1');
  if (!num(s.speed, 0, 60)) out.push('speed (m/s)');
  if (s.behaviour === 'graze' && (!num(s.run, 0, 60) || !num(s.flee, 0, 500))) out.push('grazers need run and flee');
  // a modelled animal (render/fauna-skinned.js): its baked asset's manifest, and the coats it may wear
  if (s.asset !== undefined && (typeof s.asset !== 'string' || !/^\/assets\/fauna\/[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(s.asset))) out.push('asset: /assets/fauna/<id>/<name>.json');
  const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  if (s.coats !== undefined && (!Array.isArray(s.coats) || !s.coats.length || s.coats.some(c => !c || !hex(c.body) || !hex(c.hair) || !hex(c.legs)))) out.push('coats: [{ body, hair, legs } as #rrggbb]');
  return out;
}
/** Whether the hour is within [from, to] (wrapping past midnight). */
export const activeAt = (s, hour) => (s.hours[0] <= s.hours[1] ? hour >= s.hours[0] && hour < s.hours[1] : hour >= s.hours[0] || hour < s.hours[1]);
