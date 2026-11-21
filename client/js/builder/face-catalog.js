// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { beardNames } from "./beard-library.js";
import { lashNames } from "./lash-library.js";
import { newHairNames } from "./hair-styles.js";
import { tripoHair } from "./tripo-hair-catalog.js";
import { extendedPortraits } from "./portrait-library.js";
import { sourceNoseNames } from "./nose-library.js";

const original = {
  female: {
    hair: ["Ribbon pony", "French bob", "Twisted knot"],
    eyes: ["Velvet oval", "Round doe", "Lifted almond"],
    brows: ["Soft arch", "Straight", "Lifted"],
    nose: ["Soft button", "Fine bridge", "Round tip"],
    mouth: ["Petal smile", "Cupid bow", "Plush curve"],
    ears: ["Shell curve", "Tapered helix", "Soft lobe"],
    detail: ["Sun freckles", "Beauty marks", "Graphic liner"],
  },
  male: {
    hair: ["Side sweep", "Curtain part", "Cropped waves"],
    eyes: ["Classic oval", "Open gaze", "Soft almond"],
    brows: ["Straight block", "Soft arch", "Tapered"],
    nose: ["Straight bridge", "Round tip", "High bridge"],
    mouth: ["Quiet smile", "Defined bow", "Full curve"],
    ears: ["Shell curve", "High helix", "Broad lobe"],
    detail: ["Sun freckles", "Pencil moustache", "Jaw stubble"],
  },
};

export const faceOptions = Object.fromEntries(
  Object.entries(original).map(([gender, slots]) => [
    gender,
    Object.fromEntries(
      Object.entries(slots).map(([slot, originals]) => {
        const additions =
          slot === "hair"
            ? [
                ...newHairNames[gender],
                ...tripoHair[gender].map((cut) => cut.name),
              ]
            : extendedPortraits[gender][slot].map(
                (style) => style.name ?? style,
              );
        const styles = [...originals, ...additions];
        if (slot === "nose") styles.push(...sourceNoseNames[gender]);
        return [slot, styles];
      }),
    ),
  ]),
);

faceOptions.female.lashes = lashNames;
faceOptions.male.beard = beardNames;

// IDs belong to saved characters, original outfits and thumbnail files. Never
// renumber later options when a style leaves the selectable library.
const replacements = {
  female: {
    nose: {2: 0, 5: 18, 8: 16, 9: 28, 11: 29},
    mouth: {1: 0, 3: 2, 4: 7, 6: 8, 11: 5},
  },
  male: {
    nose: {1: 8, 3: 12, 5: 11, 7: 27, 14: 24, 16: 26, 19: 15, 20: 17, 21: 6, 28: 18},
    mouth: {3: 10, 7: 1, 11: 0},
    hair: {9: 22, 29: 14},
  },
};
export const resolveStyle = (gender, slot, id) => replacements[gender]?.[slot]?.[id] ?? id;
export function availableStyles(gender, slot, names = faceOptions[gender][slot]) {
  return [...names.entries()].filter(([id]) => resolveStyle(gender, slot, id) === id);
}

export function defaultDetailColor(name) {
  if (name === "Rosy nose") return "#b64f59";
  if (name === "Warm flush") return "#bd6662";
  return "#623e32";
}
