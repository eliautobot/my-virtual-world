// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// Ratios are applied in the feature's local surface frame. A single part can
// change without changing the dimensions of its attachment bed in the skull.
export const faceDials = {
  eyes: { width: "Width", height: "Opening height", spacing: "Spacing" },
  brows: { width: "Width", height: "Brow lift", spacing: "Spacing" },
  nose: {
    width: "Width",
    height: "Length",
    projection: "Projection",
    bridge: "Bridge width",
    wings: "Wing width",
    turn: "Tip lift",
  },
  mouth: {
    width: "Width",
    height: "Overall fullness",
    projection: "Projection",
    upper: "Upper lip fullness",
    lower: "Lower lip fullness",
    bow: "Cupid's bow",
    corners: "Corner lift",
  },
  ears: { width: "Width", height: "Height", projection: "Projection" },
};
const lipRanges = {
  width: [0.78, 1.24],
  height: [0.72, 1.4],
  projection: [0.65, 1.5],
  upper: [0.58, 1.6],
  lower: [0.58, 1.6],
  bow: [0.35, 1.75],
  corners: [0.4, 1.6],
};
export const dialRange = (slot, key) =>
  (slot === "mouth"
    ? lipRanges[key]
    : slot === "nose"
      ? noseRanges[key]
      : null) ?? [0.85, 1.15];
const noseRanges = {
  width: [0.8, 1.22],
  height: [0.85, 1.16],
  projection: [0.76, 1.25],
  bridge: [0.72, 1.28],
  wings: [0.78, 1.24],
  turn: [0.64, 1.36],
};
export const pupilDials = {
  size: { label: "Pupil size", min: 0.55, max: 1.18, neutral: 1 },
  height: { label: "Pupil height", min: -1, max: 1, neutral: 0 },
  spacing: { label: "Pupil spacing", min: -1, max: 1, neutral: 0 },
};
// The former inward 57% becomes the origin. Equal angular excursions in
// either direction keep the two eyes on their globes through gaze and blink.
const pupilCenter = -0.57, pupilTravel = 0.57;
export const pupilRestYaw = (spacing) => 0.22 * (pupilCenter + spacing * pupilTravel);
export const migratePupilSpacing = (spacing) =>
  Math.max(-1, Math.min(1, (spacing - pupilCenter) / pupilTravel));
export const structureGroups = {
  Forehead: {
    foreheadWidth: "Temple width",
    foreheadHeight: "Forehead height",
    foreheadSlope: "Forehead slope",
    browDepth: "Brow ridge depth",
  },
  Cheeks: {
    cheekWidth: "Cheekbone width",
    cheekHeight: "Cheekbone height",
    cheekDepth: "Cheekbone projection",
    cheekFullness: "Lower cheek fullness",
  },
  "Jaw & chin": {
    jawWidth: "Jaw width",
    jawAngle: "Jaw angle",
    chinWidth: "Chin width",
    chinLength: "Chin length",
    chinDepth: "Chin projection",
  },
  "Upper lip area": {
    maxillaDepth: "Upper jaw projection",
    philtrumDepth: "Philtrum depth",
  },
  "Feature placement": {
    eyeLine: "Eye line height",
    nosePosition: "Nose vertical position",
    nasalDepth: "Nose protrusion",
    mouthPosition: "Mouth vertical position",
  },
};
export function structureSettings(raw) {
  const fit = {};
  for (const group of Object.values(structureGroups))
    for (const key of Object.keys(group))
      fit[key] = Number.isFinite(raw?.[key]) ? Math.max(-1, Math.min(1, raw[key])) : 0;
  return fit;
}
export function pupilSettings(raw) {
  return Object.fromEntries(
    Object.entries(pupilDials).map(([key, { min, max, neutral }]) => [
      key,
      Number.isFinite(raw?.[key])
        ? Math.max(min, Math.min(max, raw[key]))
        : neutral,
    ]),
  );
}
export function faceSettings(raw = {}) {
  const fit = Object.fromEntries(
    Object.entries(faceDials).map(([slot, dials]) => [
      slot,
      Object.fromEntries(
        Object.keys(dials).map((key) => {
          const v = raw?.[slot]?.[key];
          const [min, max] = dialRange(slot, key);
          return [
            key,
            Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : 1,
          ];
        }),
      ),
    ]),
  );
  fit.pupils = pupilSettings(raw?.pupils);
  fit.lashLine = Object.fromEntries([["upper", 0.5, 1], ["lower", 0, 0]].map(
    ([edge, min, initial]) => [edge, Number.isFinite(raw?.lashLine?.[edge])
      ? Math.max(min, Math.min(2.5, raw.lashLine[edge])) : initial]));
  fit.structure = structureSettings(raw?.structure);
  return fit;
}
