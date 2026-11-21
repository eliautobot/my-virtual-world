// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// coverHeight is the upper limit of fully concealed skin in foundation space.
// Sandals and open insteps keep the foot intact beneath their separate straps.
const shoe = (name, materialProfile, coverHeight) => ({ name, materialProfile, coverHeight });

export const expandedShoeCatalog = {
  male: [
    shoe("Track runner", 0, 0.026),
    shoe("Canvas high-top", 0, 0.061),
    shoe("Wingtip Oxford", 1, 0.022),
    shoe("Workshop Chelsea", 1, 0.073),
    shoe("Apron boat shoe", 1, 0.008),
    shoe("Desert boot", 2, 0.044),
    shoe("Double monk shoe", 1, 0.024),
    shoe("Alpine hiker", 2, 0.067),
    shoe("Deck espadrille", 1, 0.015),
    shoe("River sandal", 2, 0),
  ],
  female: [
    shoe("Relay runner", 0, 0.025),
    shoe("Platform high-top", 0, 0.056),
    shoe("Two-tone saddle shoe", 1, 0.020),
    shoe("Equestrian Chelsea", 1, 0.098),
    shoe("Tassel moccasin", 1, 0.015),
    shoe("Suede chukka", 2, 0.048),
    shoe("Twin-strap Mary Jane", 1, 0),
    shoe("Ridge hiking boot", 2, 0.064),
    shoe("Ribbon espadrille", 1, 0.014),
    shoe("Fisherman sandal", 1, 0),
  ],
};
