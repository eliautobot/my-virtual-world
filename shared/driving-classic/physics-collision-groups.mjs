// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
/** Internal Rapier layers; these are not runtime permissions or configuration. */
export const PHYSICS_GROUPS=Object.freeze({
  ground:0x0001000e,                 // authored ground → vehicle, pedestrian, ragdoll
  vehicle:0x0002000f,                // vehicle → world, vehicles, people, fallen bodies
  pedestrian:0x00040007,             // character controller → world, vehicles, people
  ragdoll:0x00080003,                // ragdoll → world and vehicles, not itself
  remoteFallback:0x0001000a,         // offscreen emergency floor; never pedestrian support
});
