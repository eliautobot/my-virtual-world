// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { structureSettings } from "./face-settings.js";

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (x) => Math.exp(-x * x);

// Sample a common, symmetric displacement field in bind space. Skin, inserts,
// hair and animated eyelid targets can all evaluate it at the same point.
// A two-millimetre grid keeps dragging independent of the number of dials.
export function facialStructure(gender, raw) {
  const s = structureSettings(raw);
  if (!Object.values(s).some(Boolean)) return null;
  const female = gender === "female";
  const eye = female ? 903.7 : 921.9, mouth = female ? 863.5 : 879.1;
  const nose = female ? 883.5 : 897.7, crestY = eye - 19;
  const floor = female ? 823 : 837, step = 2, columns = 51, rows = 99;
  const field = new Float32Array(rows * columns * 3);
  for (let j = 0; j < rows; j++) {
    const y = floor + j * step;
    for (let i = 0; i < columns; i++) {
      const x = Math.abs(i - 1) * step, k = 3 * (j * columns + i);
      const f = bell((y - eye - 34) / 25) * smooth(eye + 8, eye + 29, y);
      const temple = bell((x - 43) / 19) * smooth(0, 30, x);
      const brow = bell((y - eye - 15) / 8) * bell((x - 23) / 20);
      const arch = bell((x - 34) / 17) * bell((y - crestY) / 15);
      // From the outer cheek the upper plane slopes down toward the ala.
      // Its inner end fades at the sidewall and above the upper lip.
      const inward = 1 - smooth(12, 34, x);
      const cheekY = crestY + inward * (nose - crestY);
      const innerArch = smooth(female ? 7 : 9, female ? 16 : 18, x) *
        bell((x - 34) / 26) * bell((y - cheekY) / 15);
      const innerLift = (innerArch - arch) * inward * smooth(mouth + 3, mouth + 14, y);
      const cheek = arch + innerLift;
      const lower = bell((x - 29) / 18) * bell((y - mouth - 5) / 17);
      const jaw = bell((x - 36) / 20) * bell((y - mouth + 7 - 0.28 * (x - 26)) / 16);
      const chin = bell(x / (female ? 17 : 22)) * bell((y - mouth + 20) / 12);
      const oral = bell(x / 17) * bell((y - mouth - 11) / 10);
      // Keep the spherical eye and its open/blinked margins together. The
      // cheek and ridge turn into the orbit above and below this strip.
      const orbit = 1 - (1 - smooth(8, 23, Math.abs(y - eye))) *
        (1 - smooth(32, 44, x));
      const anchor = orbit * smooth(floor + 1, floor + 13, y) *
        (1 - smooth(61, 88, x)) * (1 - smooth(988, 1007, y));
      const side = smooth(0, 29, x);
      field[k] = anchor * (5.6 * s.foreheadWidth * f * temple +
        side * (5.8 * s.cheekWidth * (arch + 0.35 * innerLift) + 2.8 * s.cheekFullness * lower +
          6.1 * s.jawWidth * jaw) + 4.8 * s.chinWidth * chin * Math.min(x / 12, 1));
      if (i === 0) field[k] *= -1;
      field[k + 1] = anchor * (4.8 * s.foreheadHeight * f * bell(x / 48) +
        4.5 * s.cheekHeight * cheek - 5.4 * s.jawAngle * jaw * side -
        5.2 * s.chinLength * chin);
      // Translate the optical area as a unit, including its blink and gaze
      // targets. The vertical offsets ease into adjacent facial landmarks.
      field[k + 1] += 3.0 * s.eyeLine * (1 - smooth(12, 33, Math.abs(y - eye))) *
        (1 - smooth(38, 57, x)) + anchor * (2.7 * s.nosePosition * bell(x / 16) *
        bell((y - nose) / 11) +
        3.0 * s.mouthPosition * bell(x / 22) * bell((y - mouth) / 11));
      field[k + 2] = anchor * (-5.8 * s.foreheadSlope * f * bell(x / 43) +
        3.0 * s.browDepth * brow + 4.2 * s.cheekDepth * cheek +
        3.1 * s.cheekFullness * lower + 4.9 * s.chinDepth * chin +
        3.8 * s.maxillaDepth * oral - 1.05 * s.philtrumDepth * oral * bell(x / 4.3));
      // Move the bridge, alar bed and inner midface together. The medial
      // surface can project between the eyes while the optical globes stay put.
      const nasalBed = (1 - smooth(8, 25, x)) *
        smooth(mouth + 3, nose - 3, y) * (1 - smooth(eye + 2, eye + 17, y));
      const innerOrbit = smooth(5, 12, x) * (1 - smooth(9, 21, Math.abs(y - eye)));
      field[k + 2] += 6.2 * s.nasalDepth * nasalBed * (1 - innerOrbit);
    }
  }
  return (x, y, z, out) => {
    out.set(x, y, z);
    const u = 1 + Math.abs(x) * 1000 / step, v = (1000 * y - floor) / step;
    const i = Math.round(u), j = Math.round(v);
    if (i >= columns - 1 || j < 1 || j >= rows - 1 || z <= -0.017) return out;
    // Quadratic B-splines have continuous surface tangents across cells,
    // including the mirrored midline. A linear grid leaves bands in side light.
    const a = u - i, b = v - j;
    const left = 0.5 * (0.5 - a) ** 2, center = 0.75 - a * a, right = 1 - left - center;
    const low = 0.5 * (0.5 - b) ** 2, mid = 0.75 - b * b;
    let dx = 0, dy = 0, dz = 0;
    for (let row = -1; row <= 1; row++) {
      const k = 3 * ((j + row) * columns + i);
      const weight = row === -1 ? low : row === 0 ? mid : 1 - low - mid;
      dx += weight * (left * field[k - 3] + center * field[k] + right * field[k + 3]);
      dy += weight * (left * field[k - 2] + center * field[k + 1] + right * field[k + 4]);
      dz += weight * (left * field[k - 1] + center * field[k + 2] + right * field[k + 5]);
    }
    const w = smooth(-0.017, 0.033, z) / 1000;
    return out.set(x + Math.sign(x) * w * dx, y + w * dy, z + w * dz);
  };
}
