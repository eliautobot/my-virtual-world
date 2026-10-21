// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original midsize saloon dimensions in world units. Shared by rendering and
// authoritative traffic; uniform class scale preserves automotive proportions.
export function getSedanProportions(type) {
  const factor = type === 'car' ? 0.96 : 1;
  return Object.freeze({
    factor, length: 4.652 * factor, bodyWidth: 1.78 * factor,
    mirrorWidth: 1.906 * factor, height: 1.44 * factor,
    wheelDiameter: 0.62 * factor, tireWidth: 0.195 * factor,
    wheelbase: 2.66 * factor, frontAxle: 1.34 * factor,
    rearAxle: -1.32 * factor, track: 1.51 * factor,
    wheelRadius: 0.155 * factor, wheelCenterY: -0.18,
    halfLength: 2.34 * factor, halfWidth: 0.96 * factor,
    collisionRadius: Math.hypot(2.34, 0.96) * factor,
  });
}

export function createSedanModelMetadata(type) {
  const d = getSedanProportions(type);
  return {
    shell: [], details: [],
    wheels: {
      radius: d.wheelRadius, width: d.tireWidth / 2,
      centerY: d.wheelCenterY, bodyHalfWidth: d.bodyWidth / 4,
      positions: [d.frontAxle, d.rearAxle].flatMap(x => [
        [x / 2, d.track / 4], [x / 2, -d.track / 4],
      ]),
    },
  };
}
