// Exact world-space serving positions for consumables. Heights match the
// highest usable tabletop mesh in main3d.js; offsets are measured from a
// seated agent toward the surface in the agent's local facing direction.
export const CONSUMABLE_SURFACE_SPECS = Object.freeze({
  desk: Object.freeze({ surfaceHeight: 0.735, forwardOffset: 0.74, sideOffset: 0.19 }),
  diningTable: Object.freeze({ surfaceHeight: 0.84, forwardOffset: 0.74, sideOffset: 0.16 }),
  smallCafeTable: Object.freeze({ surfaceHeight: 0.744, forwardOffset: 0.70, sideOffset: 0.16 }),
  outdoorCafeTable: Object.freeze({ surfaceHeight: 0.7875, forwardOffset: 0.74, sideOffset: 0.16 }),
  picnicTable: Object.freeze({ surfaceHeight: 0.8375, forwardOffset: 0.50, sideOffset: 0 }),
  smallRoundMeetingTable: Object.freeze({ surfaceHeight: 0.766, forwardOffset: 0.70, sideOffset: 0.16 }),
});

const NORMALIZED_TYPE_LOOKUP = Object.freeze(Object.fromEntries(
  Object.entries(CONSUMABLE_SURFACE_SPECS).map(([type, spec]) => [type.toLowerCase().replace(/[^a-z0-9]/g, ''), spec]),
));

export function getConsumableSurfaceSpec(type = '') {
  return CONSUMABLE_SURFACE_SPECS[type] || NORMALIZED_TYPE_LOOKUP[String(type || '').toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
}

export function withConsumableSurfaceSpec(target = {}, type = '') {
  const spec = getConsumableSurfaceSpec(type);
  if (!spec) return target;
  return {
    ...target,
    consumeSurfaceHeight: spec.surfaceHeight,
    consumeSurfaceForwardOffset: spec.forwardOffset,
    consumeSurfaceSideOffset: spec.sideOffset,
  };
}
