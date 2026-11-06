// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The light on things indoors and on people at night: what the furniture, the Amazon
// models, the goods and the characters share. No lights more: a few lines of shader each.
// - The room's fill: the light inside a floor looked into (GU.uIndoor, more after dark) was the same from every side, so
//   it brightened things and took their shape away; now it comes from above (roomFill): tops lit, sides less, undersides
//   dark, and less near the floor.
// - The room's light map (render/room-light.js): its lamps' warm pools after dark, its windows' daylight, read by all of
//   the floor looked into (roomLight); the street lamps no longer shine into it (roomIn).
// - People out of doors after dark: the street lamps' light map (render/city.js) as the ground has it, from above, and a
//   faint cool edge against the dark (streetLight, nightRim; people were lit by the moon and the sky only).
// LIGHT.on false draws them with the old light (to compare before and after: ?light=0 in the address).

export const LIGHT = { on: typeof location === 'undefined' || new URLSearchParams(location.search).get('light') !== '0' };

/** GLSL for a fragment shader (after the normal is known; a world position wp). */
export const ROOM_PARS = /* glsl */`
uniform vec4 uRoom;   // the floor looked into: its height, its ceiling's light after dark, how much of it is in pools
uniform sampler2D uRoomMap;   // (render/room-light.js) r: the lamps after dark, g: low down shade, b: window daylight
uniform vec4 uRoomXf, uRoomBox;   // the building: x, z, cos, sin of its turn; its box (local): x0, z0, 1 / w, 1 / d
// The light inside a room comes from its ceiling more than its walls and hardly from its floor: a surface facing up gets
// the most, one facing sideways less, one facing down little (a little wraps round), and down near the floor less again
// (what stands round a thing's foot hides some of it). n: the view-space normal; wp: the world position.
float roomFill(vec3 n, vec3 wp) {
  float ny = dot(n, viewMatrix[1].xyz);
  float h = wp.y - uRoom.x;
  float low = h > -0.5 && h < 4.5 ? mix(0.72, 1.0, smoothstep(0.0, 1.4, h)) : 1.0;
  return (0.95 + 0.5 * ny - 0.08 * ny * ny) * low;   // up 1.37, sideways 0.95, down 0.37 (as bright as the flat fill was, seen from above)
}
vec2 roomLocal(vec3 wp) { vec2 d = wp.xz - uRoomXf.xy; return vec2(d.x * uRoomXf.z - d.y * uRoomXf.w, d.x * uRoomXf.w + d.y * uRoomXf.z); }
vec2 roomUV(vec3 wp) { return (roomLocal(wp) - uRoomBox.xy) * uRoomBox.zw; }
// 1 on the floor looked into (inside its walls, under its ceiling), else 0 (a park's furniture, another floor)
float roomIn(vec3 wp) {
  vec2 q = roomUV(wp); float h = wp.y - uRoom.x;
  return q.x > -0.01 && q.y > -0.01 && q.x < 1.01 && q.y < 1.01 && h > -0.4 && h < 4.2 ? 1.0 : 0.0;
}
// The light inside: by day a little, more near the windows; after dark its lamps and ceiling lights (warm where a lamp is
// near, dimmer in the corners), all from above (roomFill). night: 0..1 (uNight).
vec3 roomMap(vec3 wp) { return texture2D(uRoomMap, clamp(roomUV(wp), 0.0, 1.0)).rgb; }
// the shade down low (g: under furniture, at the walls' feet), gone 0.5 m above the floor (a table's top keeps its light)
float roomLow(vec3 m, vec3 wp) { return 1.0 - 0.6 * m.g * (1.0 - smoothstep(0.02, 0.5, wp.y - uRoom.x)); }
vec3 roomLight(vec3 n, vec3 wp, float night) {
  vec3 m = roomMap(wp);
  // the ceiling's lights (an office's, a shop's in soft pools 3.6 m apart; a home's dim) and the lamps' (warm)
  vec2 g = fract((roomLocal(wp) - uRoomBox.xy) / 3.6) - 0.5;
  float top = uRoom.y * (1.0 + uRoom.z * (0.6 - smoothstep(0.05, 0.5, length(g))));
  vec3 art = night * ((0.06 + 0.8 * top) * vec3(1.0, 0.96, 0.9) + 0.85 * m.r * vec3(1.0, 0.74, 0.46));
  return (vec3(0.1 * (0.6 + 0.8 * m.b)) + art) * roomLow(m, wp) * roomFill(n, wp);
}
// What the sky's and the moon's light (three.js's indirect light: the hemisphere, the sky's map) keeps on the floor looked
// into: less away from the windows by day, much less after dark (its own lights light it then), less down low (g).
float roomShade(vec3 wp, float night) {
  vec3 m = roomMap(wp);
  return mix(1.0, roomLow(m, wp) * mix(0.86 + 0.14 * m.b, 0.5, night), roomIn(wp));
}
`;
/** GLSL for people's fragment shaders (characters.js, char-props.js): the street lamps' light where they stand. */
export const STREET_PARS = /* glsl */`
uniform sampler2D uLightMap, uLightMap2; uniform vec4 uLightRect, uLightRect2;
float stLamp(sampler2D m, vec4 r, vec2 p) { vec2 q = (p - r.xy) / r.zw; if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) return 0.; return texture2D(m, q).r; }
// Out of doors after dark: the street lamps' light (the map the ground reads: render/mats.js lampLight), from above: the
// head and shoulders catch it most, faces and fronts some, what faces down little.
vec3 streetLight(vec3 n, vec3 wp, float night) {
  float l = (stLamp(uLightMap, uLightRect, wp.xz) + stLamp(uLightMap2, uLightRect2, wp.xz)) * night;
  float ny = dot(n, viewMatrix[1].xyz);
  return vec3(1.0, 0.8, 0.55) * l * (0.62 + 0.55 * ny) * 1.6;
}
// and a faint cool edge (the night sky behind them), so a person between two lamps still reads against the dark
vec3 nightRim(vec3 n, float night) { float r = 1.0 - abs(dot(n, normalize(vViewPosition))); return vec3(0.3, 0.4, 0.62) * (r * r * r * 0.16 * night); }
`;
/** The indoor light's line for an indoor material's emissive (it was uIndoor, the same from every side, everywhere). */
export function indoorFill() {
  return LIGHT.on ? 'totalEmissiveRadiance += diffuseColor.rgb * roomLight(normal, vWP, uNight) * roomIn(vWP);'
    : 'totalEmissiveRadiance += diffuseColor.rgb * uIndoor;';
}
/** The sky's light kept indoors (replaces three.js's ambient occlusion step: reflectedLight known). */
export function indoorShade() {
  return LIGHT.on ? '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= roomShade(vWP, uNight);' : '#include <aomap_fragment>';
}
/** The street lamps' light line (render/mats.js lampLight) for a material that may be indoors: not on the floor looked into. */
export function streetLit(k, indoor = true) {
  return `totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * ${k}${indoor && LIGHT.on ? ' * (1.0 - roomIn(vWP))' : ''};`;
}
/** Before and after compared: LIGHT.on false is the old light; every material drawn now is compiled again for it. */
export function setLight(on, app) {
  LIGHT.on = !!on;
  app.stage.scene.traverse(o => { const m = o.material; if (!m) return; for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true; });
  app.applyFocus?.();
  return LIGHT.on;
}
