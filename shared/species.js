// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The wildlife catalogue (WP4.17, wp4-world-spec.md §6.3): one data file per species in shared/world-config/species/
// (listed in index.json), checked against this schema; adding a species needs no code as long as it uses a known model
// and behaviour. Fields:
//   id, name; tier 'ambient' (simulated in each browser from the seed and the clock) or 'shared' (on the server);
//   model: bird | duck | butterfly | firefly | deer | rabbit | fish | cow | sheep | horse | reeffish | turtle | otter |
//   alligator | beaver | dolphin | seagull | crab; behaviour: flock | circle | soar | swim (round a lake, or up and down a
//   river's slow stretch) | flutter | glow | graze | jump | school (under water, over its reef) | cruise (a slow glide near
//   the sea floor) | pod (dolphins: a long loop offshore, surfacing in arcs, now and then a leap) | scuttle (crabs: short
//   sideways dashes on the sand near the water);
//   habitats: forest, meadow, field, beach, shore, rock, lake, river (its slow, wide stretches: perKm2 per km² of its
//   water), reef (the shallow sea floor), sea (open water 7–60 m deep); hours [from, to] (may wrap past midnight);
//   weather: the kinds it is out in; group [min, max]; perKm2: groups per km² of its habitat; size (m);
//   colors: '#rrggbb' list; height [min, max] above ground (flyers); speed (m/s); run (m/s) and flee (m) for grazers
//   (flee 0: never runs off, as farm animals);
//   sound: an ambient sound cue (optional).
export const MODELS = ['bird', 'duck', 'butterfly', 'firefly', 'deer', 'rabbit', 'fish', 'cow', 'sheep', 'horse', 'reeffish', 'turtle', 'otter', 'alligator', 'beaver', 'dolphin', 'seagull', 'crab'];
export const BEHAVIOURS = ['flock', 'circle', 'soar', 'swim', 'flutter', 'glow', 'graze', 'jump', 'school', 'cruise', 'pod', 'scuttle'];
export const HABITATS = ['forest', 'meadow', 'field', 'beach', 'shore', 'rock', 'lake', 'river', 'reef', 'sea'];
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
  if (!num(s.speed, 0, 60)) out.push('speed (m/s)');
  if (s.behaviour === 'graze' && (!num(s.run, 0, 60) || !num(s.flee, 0, 500))) out.push('grazers need run and flee');
  return out;
}
/** Whether the hour is within [from, to] (wrapping past midnight). */
export const activeAt = (s, hour) => (s.hours[0] <= s.hours[1] ? hour >= s.hours[0] && hour < s.hours[1] : hour >= s.hours[0] || hour < s.hours[1]);
