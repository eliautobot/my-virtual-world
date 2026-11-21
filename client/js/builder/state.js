// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { shapeDefaults, shapeBounds } from "./body.js";
import { faceSettings, migratePupilSpacing } from "./face-settings.js";
import { eyeSettings } from "./eye-motion.js";
import { garmentDesign, wardrobeOptions } from "./wardrobe-catalog.js";
import { faceOptions, resolveStyle, defaultDetailColor } from "./face-catalog.js";
export const categories = [
  "hair",
  "eyes",
  "brows",
  "nose",
  "mouth",
  "ears",
  "detail",
  "top",
  "bottom",
  "shoes",
];
export function categoriesFor(gender) {
  return [...categories, gender === "female" ? "lashes" : "beard"];
}
export function isJawDetail(index) {
  return [
    "Jaw stubble",
    "Chin patch",
    "Boxed beard",
    "Chin strap",
    "Sideburns",
  ].includes(faceOptions.male.detail[index]);
}
export const modes = ["studio", "bind", "idle", "walk", "wave"];
export const labels = {
  height: "Height",
  build: "Build",
  shoulders: "Shoulder span",
  chest: "Chest volume",
  waist: "Waist girth",
  hips: "Hip width",
  arms: "Arm girth",
  legs: "Leg girth",
  legLength: "Leg length",
  head: "Head size",
  hands: "Hand size",
  feet: "Foot size",
  hair: "Hair",
  eyes: "Eyes",
  brows: "Eyebrows",
  structure: "Face structure",
  nose: "Nose",
  mouth: "Lips & mouth",
  ears: "Ears",
  detail: "Facial detail",
  lashes: "Eyelashes",
  beard: "Beards",
  facialHair: "Facial Hair",
  top: "Tops",
  bottom: "Bottoms",
  shoes: "Shoes",
};
export function fresh(gender) {
  const f = gender === "female";
  return {
    format: "mvw-character",
    version: 2,
    gender,
    shape: { ...shapeDefaults },
    selections: Object.fromEntries(
      categoriesFor(gender).map((k) => [
        k,
        ["detail", "lashes", "beard"].includes(k) ? -1 : 0,
      ]),
    ),
    faceFit: faceSettings(),
    eyeMotion: eyeSettings(),
    sourceHead: false,
    colors: {
      skin: f ? "#ebb189" : "#e3aa78",
      hair: f ? "#694431" : "#3e302c",
      eyes: "#29252a",
      brows: null,
      nose: null,
      mouth: f ? "#d98772" : "#bd8363",
      ears: null,
      detail: "#623e32",
      ...(f ? { lashes: "#34252a" } : { beard: null }),
      top: f ? "#8dc4e3" : "#245ca6",
      bottom: f ? "#5f6944" : "#a8835a",
      shoes: "#ece8e0",
    },
    pose: "studio",
    overrides: {},
    keys: [],
  };
}
export function validate(raw, withKeys = true) {
  if (
    !raw ||
    raw.format !== "mvw-character" ||
    ![1, 2].includes(raw.version) ||
    !["male", "female"].includes(raw.gender)
  )
    throw Error("Not a character preset (version 1 or 2).");
  const s = fresh(raw.gender);
  s.faceFit = faceSettings(raw.faceFit);
  if (raw.version === 1 && Number.isFinite(raw.faceFit?.pupils?.spacing)) {
    // Preserve the original rest angle wherever it fits inside the new stops.
    s.faceFit.pupils.spacing = migratePupilSpacing(s.faceFit.pupils.spacing);
  }
  s.eyeMotion = eyeSettings(raw.eyeMotion);
  s.sourceHead = raw.sourceHead === true;
  for (const [k, [a, b]] of Object.entries(shapeBounds)) {
    if (Number.isFinite(raw.shape?.[k]))
      s.shape[k] = Math.max(a, Math.min(b, raw.shape[k]));
  }
  for (const k of categoriesFor(s.gender)) {
    const x = raw.selections?.[k];
    const count = (wardrobeOptions[s.gender][k] ?? faceOptions[s.gender][k])
      .length;
    if (Number.isInteger(x) && x >= -1 && x < count)
      s.selections[k] = resolveStyle(s.gender, k, x);
  }
  if (garmentDesign(s.gender, "top", s.selections.top)?.dress)
    s.selections.bottom = -1;
  if (
    s.gender === "male" &&
    s.selections.beard >= 0 &&
    isJawDetail(s.selections.detail)
  )
    s.selections.detail = -1;
  // Older presets stored the brow style in the eye selection.
  if (raw.selections && !Object.hasOwn(raw.selections, "brows"))
    s.selections.brows = s.selections.eyes;
  for (const k in s.colors) {
    const c = raw.colors?.[k];
    if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
      s.colors[k] = c.toLowerCase();
  }
  if (raw.version === 1 && s.colors.detail === "#623e32")
    s.colors.detail = defaultDetailColor(faceOptions[s.gender].detail[s.selections.detail]);
  if (modes.includes(raw.pose)) s.pose = raw.pose;
  for (const [key, v] of Object.entries(raw.overrides || {})) {
    if (
      !/^(Hips|Spine[012]?|Neck|Head(?:Top_End)?|(?:Left|Right)[A-Za-z0-9_]{2,25})$/.test(
        key,
      ) ||
      !v
    )
      continue;
    const edit = {};
    for (const [p, a, b] of [
      ["rotation", -180, 180],
      ["position", -0.2, 0.2],
      ["scale", 0.25, 2],
    ])
      if (
        Array.isArray(v[p]) &&
        v[p].length === 3 &&
        v[p].every(Number.isFinite)
      )
        edit[p] = v[p].map((x) => Math.max(a, Math.min(b, x)));
    if (Object.keys(edit).length) s.overrides[key] = edit;
  }
  if (withKeys && Array.isArray(raw.keys)) {
    const seen = new Map();
    for (const k of raw.keys.slice(0, 81)) {
      if (!k || !Number.isFinite(k.t) || k.t < 0 || k.t > 4) continue;
      const t = Math.round(k.t * 20) / 20;
      seen.set(t, {
        t,
        joints: validate(
          { ...raw, keys: undefined, overrides: k.joints },
          false,
        ).overrides,
      });
    }
    s.keys = [...seen.values()].sort((a, b) => a.t - b.t);
  }
  return s;
}
export const palette = {
  skin: [
    "#f6d1b0",
    "#e8b48e",
    "#ce906d",
    "#b67959",
    "#985b43",
    "#734633",
    "#513328",
    "#35261f",
  ],
  hair: [
    "#201c1c",
    "#402a24",
    "#623a2a",
    "#8f5640",
    "#d4aa66",
    "#e3d5bf",
    "#8d777f",
    "#40556b",
  ],
  eyes: [
    "#29252a",
    "#342722",
    "#674536",
    "#996b42",
    "#647952",
    "#748eae",
    "#554269",
    "#8d9995",
  ],
  mouth: ["#81514d", "#9d6158", "#ac6359", "#bf7772", "#a64358", "#784454"],
  cloth: [
    "#ebe8df",
    "#393f42",
    "#a8835a",
    "#5f6944",
    "#8fbce0",
    "#3b6fa3",
    "#a95648",
    "#80586e",
  ],
};
