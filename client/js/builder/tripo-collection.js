// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { tripoHair, tripoHairStart } from "./tripo-hair-catalog.js";
import { tripoClothes } from "./tripo-cloth-catalog.js";
import { tripoShoeCatalog } from "./tripo-shoe-catalog.js";
import { collectionStarts } from "./wardrobe-catalog.js";
import { resolveStyle } from "./face-catalog.js";

export function referencePiece(gender, slot, index) {
  if (slot === "hair") return tripoHair[gender][index - tripoHairStart];
  if (slot === "shoes")
    return tripoShoeCatalog[gender][index - collectionStarts.shoes];
  return tripoClothes[gender][slot]?.[index - collectionStarts[slot]];
}

export function referenceLook(gender, source) {
  const selections = {},
    colors = {};
  for (const [slot, records, start] of [
    ["hair", tripoHair[gender], tripoHairStart],
    ["top", tripoClothes[gender].top, collectionStarts.top],
    ["bottom", tripoClothes[gender].bottom, collectionStarts.bottom],
    ["shoes", tripoShoeCatalog[gender], collectionStarts.shoes],
  ]) {
    const i = records.findIndex((item) => item.source === source);
    if (i < 0 && slot !== "bottom")
      throw Error("Unknown original look: " + source);
    selections[slot] = i < 0 ? -1 : resolveStyle(gender, slot, start + i);
    if (i >= 0) colors[slot] = records[i].color || records[i].palette[0];
  }
  return { selections, colors };
}
