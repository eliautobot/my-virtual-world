// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { expandedTopCatalog } from "./expanded-top-catalog.js";
import { expandedBottomCatalog } from "./expanded-bottom-catalog.js";
import { expandedShoeCatalog } from "./expanded-shoe-catalog.js";
import { tripoClothes } from "./tripo-cloth-catalog.js";
import { tripoShoeCatalog } from "./tripo-shoe-catalog.js";

export const collectionStarts = { top: 13, bottom: 13, shoes: 16 };
export function collectionDesign(gender, slot, style) {
  const list =
    slot === "shoes" ? tripoShoeCatalog[gender] : tripoClothes[gender][slot];
  return list?.[style - collectionStarts[slot]];
}

export function garmentDesign(gender, slot, style) {
  if (style >= collectionStarts[slot])
    return collectionDesign(gender, slot, style);
  if (slot === "top") return expandedTopCatalog[gender][style - 3];
  if (slot === "bottom") return expandedBottomCatalog[gender][style - 3];
  return expandedShoeCatalog[gender][style - 6];
}
const maleShoes = ["Court trainer", "Lace-up derby", "Trail boot"];
const femaleShoes = ["Court trainer", "Penny loafer", "Ankle boot"];
function withSmoothEditions(names) {
  return [...names, ...names.map((name) => "Smooth " + name.toLowerCase())];
}
// Both editions share the trainer, low shoe and boot fit/material profiles.
// Indices 0–2 are also the selections in version-one character presets.
export const originalShoeCount = maleShoes.length;
export const shoeProfile = (index) => index % originalShoeCount;
export const wardrobeOptions = {
  male: {
    top: [
      "Open-collar polo",
      "Ringer tee",
      "Track jacket",
      ...expandedTopCatalog.male.map((s) => s.name),
    ],
    bottom: [
      "Pleated chinos",
      "Field shorts",
      "Straight denim",
      ...expandedBottomCatalog.male.map((s) => s.name),
    ],
    shoes: [
      ...withSmoothEditions(maleShoes),
      ...expandedShoeCatalog.male.map((s) => s.name),
    ],
  },
  female: {
    top: [
      "Cotton crew tee",
      "Camp shirt",
      "Varsity jacket",
      ...expandedTopCatalog.female.map((s) => s.name),
    ],
    bottom: [
      "Panel skirt",
      "Wide trousers",
      "Cuffed shorts",
      ...expandedBottomCatalog.female.map((s) => s.name),
    ],
    shoes: [
      ...withSmoothEditions(femaleShoes),
      ...expandedShoeCatalog.female.map((s) => s.name),
    ],
  },
};
for (const gender of ["male", "female"]) {
  for (const slot of ["top", "bottom", "shoes"]) {
    const list =
      slot === "shoes" ? tripoShoeCatalog[gender] : tripoClothes[gender][slot];
    wardrobeOptions[gender][slot].push(...list.map((design) => design.name));
  }
}
