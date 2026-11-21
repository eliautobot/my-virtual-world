// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { AnimationClip, NumberKeyframeTrack } from "three";
import { eyeMorphWeights } from "./eye-pose.js";

const loopLength = 12;
// Each fixation holds until the next saccade. Both eyes share one target.
const fixations = [
  [0, 0, 0],
  [0.75, 0.53, 0.12],
  [2.15, 0.16, -0.18],
  [3.65, -0.64, 0.15],
  [5.3, -0.17, 0.34],
  [6.85, 0, 0],
  [8.35, 0.59, -0.22],
  [9.8, 0.22, 0.06],
  [10.7, -0.35, -0.08],
  [11.55, 0, 0],
];
const blinkStarts = [2.62, 6.58, 10.82];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const smooth = (t) => t * t * (3 - 2 * t);
export function eyeSettings(raw = {}) {
  const number = (key, min, max) =>
    Number.isFinite(raw?.[key]) ? clamp(raw[key], min, max) : 0;
  return {
    mode: raw?.mode === "manual" ? "manual" : "natural",
    x: number("x", -1, 1),
    y: number("y", -1, 1),
    closure: number("closure", 0, 1),
    autoBlink: raw?.autoBlink !== false,
  };
}
export function blinkAmount(elapsed) {
  if (elapsed < 0 || elapsed >= 0.24) return 0;
  if (elapsed < 0.075) return smooth(elapsed / 0.075);
  if (elapsed < 0.095) return 1;
  return 1 - smooth((elapsed - 0.095) / 0.145);
}
export function sampleEyeMotion(settings, seconds, blinkElapsed = Infinity) {
  const t = ((seconds % loopLength) + loopLength) % loopLength;
  let x = settings.x,
    y = settings.y;
  if (settings.mode === "natural") {
    let index = fixations.length - 1;
    while (index > 0 && fixations[index][0] > t) index--;
    const [start, tx, ty] = fixations[index],
      previous = fixations[Math.max(0, index - 1)];
    const amount = smooth(clamp((t - start) / 0.125, 0, 1));
    x = previous[1] + (tx - previous[1]) * amount;
    y = previous[2] + (ty - previous[2]) * amount;
  }
  let blink = blinkAmount(blinkElapsed);
  if (settings.autoBlink)
    for (const start of blinkStarts)
      blink = Math.max(blink, blinkAmount(t - start));
  const rest = settings.mode === "manual" ? settings.closure : 0;
  return [x, y, rest + (1 - rest) * blink];
}
export function makeEyeClip(face, settings) {
  if (!face || (settings.mode === "manual" && !settings.autoBlink)) return null;
  const channels = eyeMorphWeights(0, 0, 0);
  const meshes = face.children.filter(
    (mesh) =>
      mesh.morphTargetDictionary &&
      Object.keys(mesh.morphTargetDictionary).some((name) =>
        Object.hasOwn(channels, name),
      ),
  );
  if (!meshes.length) return null;
  const times = Array.from({ length: loopLength * 60 + 1 }, (_, i) => i / 60);
  const sampled = times.map((t) =>
    eyeMorphWeights(...sampleEyeMotion(settings, t)),
  );
  const tracks = meshes.map((mesh) => {
    const targets = Object.entries(mesh.morphTargetDictionary).sort(
      (a, b) => a[1] - b[1],
    );
    const values = sampled.flatMap((weights) =>
      targets.map(([name]) => weights[name] ?? 0),
    );
    return new NumberKeyframeTrack(
      mesh.uuid + ".morphTargetInfluences",
      times,
      values,
    ).optimize();
  });
  return new AnimationClip("Eye motion", loopLength, tracks);
}
