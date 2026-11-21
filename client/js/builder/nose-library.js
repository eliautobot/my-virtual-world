// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// F12 and M12 wear closed helmets. Each remaining number identifies a face
// on which the bridge, tip and wings could be observed.
const ids = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
];
const descriptions = {
  female: [
    "Soft button",
    "Rounded wings",
    "Slender bulb",
    "Full rounded tip",
    "Defined wing rims",
    "Low rounded bridge",
    "Lifted alar rim",
    "Petite lifted tip",
    "Straight full bridge",
    "Small tapered tip",
    "Soft wedge",
    "Low rounded tip",
    "Narrow lifted bridge",
    "Long soft bridge",
    "Short angled tip",
    "Broad alar base",
    "Shallow scoop",
    "Straight sloping bridge",
    "Full oval tip",
    "Petite straight bridge",
    "Soft broad tip",
  ],
  male: [
    "Straight tapered bridge",
    "Broad rounded tip",
    "Level nasal base",
    "Long descending tip",
    "Long full bridge",
    "Low rounded wings",
    "Wide level base",
    "Full straight bridge",
    "Long projected tip",
    "Tapered angular tip",
    "Faceted wedge",
    "Short rounded bulb",
    "Slender rounded tip",
    "Long blunt tip",
    "Wide square base",
    "Low flared base",
    "Short angular bridge",
    "Defined columella",
    "Full downturned tip",
    "Narrow winged bridge",
    "Broad faceted bridge",
  ],
};

export const noseSourceIds = {};
export const sourceNoseNames = {};
for (const [gender, names] of Object.entries(descriptions)) {
  const sources = ids.map(
    (number) => gender[0] + String(number).padStart(2, "0"),
  );
  noseSourceIds[gender] = sources;
  sourceNoseNames[gender] = names.map(
    (name, i) => sources[i].toUpperCase() + " · " + name,
  );
}

// Source shapes for the existing studio selections, in saved-preset order.
// Their individual bridge, tip, wing and proportion edits are applied on top.
export const studioNoseSources = {
  female: [
    "f01",
    "f03",
    "f04",
    "f08",
    "f09",
    "f17",
    "f19",
    "f18",
    "f04",
    "f07",
    "f21",
    "f06",
    "f11",
  ],
  male: [
    "m01",
    "m02",
    "m10",
    "m09",
    "m13",
    "m17",
    "m04",
    "m07",
    "m14",
    "m03",
    "m19",
    "m11",
    "m20",
  ],
};
