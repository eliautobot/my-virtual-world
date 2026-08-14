const COMMERCIAL_ROOF_TYPES = new Set(['office', 'store']);

const ROOF_COMPONENT_SPECS = Object.freeze({
  'ac-unit': Object.freeze({ width: 2.1, depth: 1.45, height: 0.78 }),
  'roof-vent': Object.freeze({ width: 0.7, depth: 0.7, height: 0.82 }),
  'exhaust-fan': Object.freeze({ width: 1.05, depth: 1.05, height: 0.72 }),
  skylight: Object.freeze({ width: 1.8, depth: 1.2, height: 0.22 }),
  'access-hatch': Object.freeze({ width: 1.25, depth: 1.0, height: 0.28 }),
});

const AUXILIARY_COMPONENT_TYPES = Object.freeze(['exhaust-fan', 'skylight', 'access-hatch', 'roof-vent']);
const ROOF_SLOT_SPACING = 3.2;
const ROOF_SLOT_AREA = ROOF_SLOT_SPACING ** 2;
const ROOF_COMPONENT_CLEARANCE = 0.42;
const RESIDENTIAL_ROOF_OVERHANG = Object.freeze({ eave: 0.58, gable: 0.48 });
const RESIDENTIAL_SHINGLE_LIMITS = Object.freeze({ courses: 28, columns: 42 });
const EPSILON = 1e-6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeType(type) {
  return String(type || '').trim().toLowerCase();
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || 'roof')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed, salt = 0) {
  let value = (seed + Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function rotatedFootprint(component) {
  const quarterTurn = Math.abs(Math.sin(finite(component?.rotation))) > 0.5;
  return quarterTurn
    ? { width: finite(component?.depth), depth: finite(component?.width) }
    : { width: finite(component?.width), depth: finite(component?.depth) };
}

function frozenEmptyLayout(type, width, depth, floorCount) {
  return Object.freeze({
    supported: false,
    type,
    width,
    depth,
    floorCount,
    roofArea: width * depth,
    areaCapacity: 0,
    slotCapacity: 0,
    maxCount: 0,
    requestedAcUnits: floorCount,
    acUnitCapacity: 0,
    acUnitCount: 0,
    unplacedAcUnits: floorCount,
    requestedAuxiliaryCount: 0,
    auxiliaryCount: 0,
    desiredCount: 0,
    componentCount: 0,
    edge: Object.freeze({ enabled: false, height: 0, thickness: 0, copingHeight: 0 }),
    components: Object.freeze([]),
  });
}

export function getCommercialRoofLayout({
  type = 'office',
  width = 0,
  depth = 0,
  floorCount = 1,
  seed = 'building',
} = {}) {
  const safeType = normalizeType(type);
  const safeWidth = Math.max(0, finite(width));
  const safeDepth = Math.max(0, finite(depth));
  const safeFloorCount = Math.max(1, Math.floor(finite(floorCount, 1)));
  if (!COMMERCIAL_ROOF_TYPES.has(safeType)) {
    return frozenEmptyLayout(safeType, safeWidth, safeDepth, safeFloorCount);
  }

  const roofArea = safeWidth * safeDepth;
  const edge = Object.freeze({
    enabled: true,
    height: safeType === 'store' ? 0.34 : 0.42,
    thickness: 0.26,
    copingHeight: 0.065,
  });
  const perimeterInset = 1.35;
  const usableWidth = Math.max(0, safeWidth - perimeterInset * 2);
  const usableDepth = Math.max(0, safeDepth - perimeterInset * 2);
  const columns = Math.max(0, Math.floor(usableWidth / ROOF_SLOT_SPACING));
  const rows = Math.max(0, Math.floor(usableDepth / ROOF_SLOT_SPACING));
  const slotCapacity = columns * rows;
  const usableArea = usableWidth * usableDepth;
  const areaCapacity = Math.max(0, Math.floor(usableArea / ROOF_SLOT_AREA));
  const maxCount = Math.min(areaCapacity, slotCapacity);

  // Each floor requests its own AC unit. The roof's collision-free packing
  // capacity is the hard limit, so taller buildings fill a small roof without
  // overlapping while a later footprint resize can unlock every requested unit.
  const requestedAcUnits = safeFloorCount;
  const acUnitCapacity = maxCount;
  const acUnitCount = Math.min(requestedAcUnits, acUnitCapacity);
  const unplacedAcUnits = requestedAcUnits - acUnitCount;

  // Vents, fans, skylights, and access hatches also grow procedurally, but only
  // use slots left after the floor-driven AC demand has been satisfied.
  const footprintAuxiliaryBonus = Math.floor(usableArea / 120);
  const floorAuxiliaryBonus = Math.floor((safeFloorCount - 1) / 2);
  const requestedAuxiliaryCount = maxCount > 0
    ? 1 + footprintAuxiliaryBonus + floorAuxiliaryBonus
    : 0;
  const auxiliaryCount = Math.min(
    Math.max(0, maxCount - acUnitCount),
    requestedAuxiliaryCount,
  );
  const desiredCount = requestedAcUnits + requestedAuxiliaryCount;
  const componentCount = acUnitCount + auxiliaryCount;
  const seedHash = hashString(`${seed}:${safeType}:${safeWidth.toFixed(3)}:${safeDepth.toFixed(3)}`);

  const candidates = [];
  if (columns > 0 && rows > 0) {
    const spacingX = usableWidth / columns;
    const spacingZ = usableDepth / rows;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        candidates.push({
          x: perimeterInset + spacingX * (column + 0.5),
          z: perimeterInset + spacingZ * (row + 0.5),
          score: seededUnit(seedHash, index),
          index,
        });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.index - b.index);

  const auxiliaryOffset = Math.floor(seededUnit(seedHash, 1001) * AUXILIARY_COMPONENT_TYPES.length);
  const components = Array.from({ length: componentCount }, (_, index) => {
    const auxiliaryIndex = index - acUnitCount;
    const kind = index < acUnitCount
      ? 'ac-unit'
      : auxiliaryIndex === 0
        ? 'roof-vent'
        : AUXILIARY_COMPONENT_TYPES[(auxiliaryOffset + auxiliaryIndex - 1) % AUXILIARY_COMPONENT_TYPES.length];
    const spec = ROOF_COMPONENT_SPECS[kind];
    const candidate = candidates[index];
    const rotation = seededUnit(seedHash, 2000 + index) < 0.5 ? 0 : Math.PI / 2;
    return Object.freeze({
      id: `roof-${kind}-${index + 1}`,
      kind,
      x: candidate.x,
      z: candidate.z,
      width: spec.width,
      depth: spec.depth,
      height: spec.height,
      rotation,
      variant: Math.floor(seededUnit(seedHash, 3000 + index) * 4),
    });
  });

  return Object.freeze({
    supported: true,
    type: safeType,
    width: safeWidth,
    depth: safeDepth,
    floorCount: safeFloorCount,
    roofArea,
    usableArea,
    areaCapacity,
    slotCapacity,
    maxCount,
    requestedAcUnits,
    acUnitCapacity,
    acUnitCount,
    unplacedAcUnits,
    requestedAuxiliaryCount,
    auxiliaryCount,
    desiredCount,
    componentCount,
    perimeterInset,
    edge,
    components: Object.freeze(components),
  });
}

export function validateCommercialRoofLayout(layout, { width, depth } = {}) {
  const safeWidth = Math.max(0, finite(width, layout?.width));
  const safeDepth = Math.max(0, finite(depth, layout?.depth));
  const components = Array.isArray(layout?.components) ? layout.components : [];
  const errors = [];
  if (components.length > Math.max(0, finite(layout?.maxCount))) errors.push('component-count-exceeds-cap');
  if (components.length > Math.max(0, finite(layout?.areaCapacity))) errors.push('component-count-exceeds-area-cap');
  if (components.length > Math.max(0, finite(layout?.slotCapacity))) errors.push('component-count-exceeds-slot-cap');
  const acUnitCount = components.filter((component) => component?.kind === 'ac-unit').length;
  const expectedAcUnitCount = Math.min(
    Math.max(0, finite(layout?.requestedAcUnits)),
    Math.max(0, finite(layout?.acUnitCapacity)),
  );
  if (acUnitCount !== expectedAcUnitCount) errors.push('ac-unit-count-does-not-match-floor-demand');
  if (acUnitCount !== Math.max(0, finite(layout?.acUnitCount))) errors.push('ac-unit-count-summary-mismatch');

  for (const component of components) {
    const footprint = rotatedFootprint(component);
    if (
      component.x - footprint.width / 2 < -EPSILON
      || component.x + footprint.width / 2 > safeWidth + EPSILON
      || component.z - footprint.depth / 2 < -EPSILON
      || component.z + footprint.depth / 2 > safeDepth + EPSILON
    ) {
      errors.push(`out-of-bounds:${component.id}`);
    }
  }

  for (let index = 0; index < components.length; index++) {
    const first = components[index];
    const firstFootprint = rotatedFootprint(first);
    for (let otherIndex = index + 1; otherIndex < components.length; otherIndex++) {
      const second = components[otherIndex];
      const secondFootprint = rotatedFootprint(second);
      const overlapsX = Math.abs(first.x - second.x)
        < (firstFootprint.width + secondFootprint.width) / 2 + ROOF_COMPONENT_CLEARANCE - EPSILON;
      const overlapsZ = Math.abs(first.z - second.z)
        < (firstFootprint.depth + secondFootprint.depth) / 2 + ROOF_COMPONENT_CLEARANCE - EPSILON;
      if (overlapsX && overlapsZ) errors.push(`overlap:${first.id}:${second.id}`);
    }
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function getResidentialRoofLayout({
  width = 0,
  depth = 0,
  wallThickness = 0.25,
  wallHeight = 3,
  ridgeHeight = 1.4,
  seed = 'home',
} = {}) {
  const safeWidth = Math.max(0, finite(width));
  const safeDepth = Math.max(0, finite(depth));
  const safeWallThickness = Math.max(0, finite(wallThickness, 0.25));
  const safeWallHeight = Math.max(0, finite(wallHeight, 3));
  const safeRidgeHeight = Math.max(0.4, finite(ridgeHeight, 1.4));
  const outerWidth = safeWidth + safeWallThickness * 2;
  const outerDepth = safeDepth + safeWallThickness * 2;
  const roofWidth = outerWidth + RESIDENTIAL_ROOF_OVERHANG.eave * 2;
  const roofDepth = outerDepth + RESIDENTIAL_ROOF_OVERHANG.gable * 2;
  if (safeWidth <= EPSILON || safeDepth <= EPSILON) {
    return Object.freeze({
      supported: false,
      width: safeWidth,
      depth: safeDepth,
      wallThickness: safeWallThickness,
      wallHeight: safeWallHeight,
      ridgeHeight: safeRidgeHeight,
      outerWidth,
      outerDepth,
      roofWidth,
      roofDepth,
      shingleCount: 0,
      shingles: Object.freeze([]),
    });
  }

  const halfRun = roofWidth / 2;
  const slopeLength = Math.hypot(halfRun, safeRidgeHeight);
  const roofAngle = Math.atan2(safeRidgeHeight, halfRun);
  const courseCount = clamp(Math.ceil(slopeLength / 0.52), 5, RESIDENTIAL_SHINGLE_LIMITS.courses);
  const columnCount = clamp(Math.ceil(roofDepth / 0.72), 5, RESIDENTIAL_SHINGLE_LIMITS.columns);
  const courseSpan = slopeLength / courseCount;
  const columnSpan = roofDepth / columnCount;
  const seedHash = hashString(`${seed}:${safeWidth.toFixed(3)}:${safeDepth.toFixed(3)}`);
  const shingles = [];

  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex === 0 ? 'left' : 'right';
    for (let row = 0; row < courseCount; row++) {
      const progress = (row + 0.5) / courseCount;
      const x = side === 'left'
        ? -roofWidth / 2 + halfRun * progress
        : roofWidth / 2 - halfRun * progress;
      const y = safeWallHeight + safeRidgeHeight * progress;
      const rotationZ = side === 'left' ? roofAngle : -roofAngle;
      const stagger = row % 2 ? columnSpan / 2 : 0;
      const gridStart = -roofDepth / 2 - stagger;
      for (let column = 0; column <= columnCount; column++) {
        const cellStart = gridStart + column * columnSpan;
        const cellEnd = cellStart + columnSpan;
        const clippedStart = Math.max(-roofDepth / 2, cellStart);
        const clippedEnd = Math.min(roofDepth / 2, cellEnd);
        const clippedDepth = clippedEnd - clippedStart;
        if (clippedDepth <= 0.08) continue;
        const variant = Math.floor(seededUnit(seedHash, sideIndex * 10000 + row * 100 + column) * 5);
        shingles.push(Object.freeze({
          id: `shingle-${side}-${row + 1}-${column + 1}`,
          side,
          row,
          column,
          x,
          y,
          z: (clippedStart + clippedEnd) / 2,
          width: courseSpan * 1.075,
          height: 0.045,
          depth: Math.max(0.04, clippedDepth - 0.035),
          rotationZ,
          variant,
        }));
      }
    }
  }

  return Object.freeze({
    supported: true,
    width: safeWidth,
    depth: safeDepth,
    wallThickness: safeWallThickness,
    wallHeight: safeWallHeight,
    ridgeHeight: safeRidgeHeight,
    outerWidth,
    outerDepth,
    roofWidth,
    roofDepth,
    halfRun,
    slopeLength,
    roofAngle,
    courseCount,
    columnCount,
    courseSpan,
    columnSpan,
    overhang: RESIDENTIAL_ROOF_OVERHANG,
    panelThickness: 0.16,
    edgeThickness: 0.16,
    shingleCount: shingles.length,
    shingles: Object.freeze(shingles),
  });
}

export function validateResidentialRoofLayout(layout) {
  const errors = [];
  if (!layout?.supported) errors.push('residential-roof-not-supported');
  if (!(finite(layout?.roofWidth) > finite(layout?.outerWidth))) errors.push('missing-eave-overhang');
  if (!(finite(layout?.roofDepth) > finite(layout?.outerDepth))) errors.push('missing-gable-overhang');
  const shingles = Array.isArray(layout?.shingles) ? layout.shingles : [];
  if (shingles.length !== Math.max(0, finite(layout?.shingleCount))) errors.push('shingle-count-summary-mismatch');
  if (!shingles.length) errors.push('missing-shingles');
  for (const shingle of shingles) {
    const halfWidth = finite(shingle?.width) * Math.cos(Math.abs(finite(shingle?.rotationZ))) / 2;
    if (Math.abs(finite(shingle?.x)) + halfWidth > finite(layout?.roofWidth) / 2 + 0.12) {
      errors.push(`shingle-outside-slope:${shingle?.id}`);
    }
    if (Math.abs(finite(shingle?.z)) + finite(shingle?.depth) / 2 > finite(layout?.roofDepth) / 2 + EPSILON) {
      errors.push(`shingle-outside-gable-edge:${shingle?.id}`);
    }
    const expectedY = finite(layout?.wallHeight)
      + finite(layout?.ridgeHeight) * (1 - Math.abs(finite(shingle?.x)) / Math.max(EPSILON, finite(layout?.halfRun)));
    if (Math.abs(finite(shingle?.y) - expectedY) > 0.08) errors.push(`shingle-off-slope:${shingle?.id}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export {
  RESIDENTIAL_ROOF_OVERHANG,
  RESIDENTIAL_SHINGLE_LIMITS,
  ROOF_COMPONENT_SPECS,
  ROOF_SLOT_SPACING,
};
