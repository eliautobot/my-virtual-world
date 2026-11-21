// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// Hem, cuff and safe upper coverage heights in normalized foundation space.
const top = (name, hem, sleeve, coveredTop) => ({
  name,
  hem,
  sleeve,
  coveredTop,
});
export const expandedTopCatalog = {
  male: [
    top("Waffle henley", 0.57, 0.527, 0.753),
    top("Rugby pullover", 0.564, 0.51, 0.751),
    top("Western snap shirt", 0.558, 0.519, 0.749),
    top("Fisherman rollneck", 0.569, 0.506, 0.772),
    top("Workshop overshirt", 0.551, 0.54, 0.749),
    top("Baseball jersey", 0.565, 0.679, 0.741),
    top("Sailing anorak", 0.552, 0.516, 0.759),
    top("Cable V-neck", 0.573, 0.521, 0.74),
    top("Breton boatneck", 0.571, 0.581, 0.753),
    top("Band-collar linen shirt", 0.557, 0.624, 0.753),
  ],
  female: [
    top("Ballet wrap", 0.583, 0.563, 0.724),
    top("Puff-sleeve blouse", 0.586, 0.664, 0.734),
    top("Scallop-collar cardigan", 0.58, 0.526, 0.742),
    top("Funnel-neck knit", 0.581, 0.526, 0.757),
    top("Sailor blouse", 0.574, 0.674, 0.735),
    top("Peplum jacket", 0.552, 0.556, 0.746),
    top("Gathered poet blouse", 0.57, 0.521, 0.74),
    top("Bow-neck blouse", 0.578, 0.62, 0.744),
    top("Breton marinière", 0.58, 0.573, 0.745),
    top("Cropped flight jacket", 0.603, 0.521, 0.752),
  ],
};
