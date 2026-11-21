// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// Measurements use the normalized bind space of each supplied foundation.
const design = (name, hem, waist, skirt = false, tuckShoe = false) =>
  ({ name, hem, waist, skirt, tuckShoe });

export const expandedBottomCatalog = {
  male: [
    design("Selvedge jeans", .071, .591, false, true),
    design("Double-pleat trousers", .073, .598, false, true),
    design("Rib-cuff joggers", .093, .589, false, true),
    design("Bellows cargo pants", .077, .592, false, true),
    design("Club Bermudas", .324, .596),
    design("Sailor deck trousers", .062, .598, false, true),
    design("Hammer-loop carpenter jeans", .081, .591, false, true),
    design("Piped track pants", .088, .584, false, true),
    design("Drawstring surf shorts", .363, .585),
    design("Button-knee breeches", .249, .595),
  ],
  female: [
    design("Kick-flare jeans", .069, .611, false, true),
    design("Knife-pleat midi skirt", .260, .610, true),
    design("Belted paperbag pants", .121, .617, false, true),
    design("Utility cargo skirt", .361, .603, true),
    design("Sailor culottes", .212, .615),
    design("Wrap tennis skirt", .377, .601, true),
    design("Barrel carpenter jeans", .099, .610, false, true),
    design("Satin track joggers", .094, .598, false, true),
    design("Button-front denim skirt", .312, .608, true),
    design("Pleat-front walking shorts", .379, .612),
  ],
};
