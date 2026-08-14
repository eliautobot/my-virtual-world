export const WORLD_HALF_SIZE = 1000;
export const WORLD_SIZE = WORLD_HALF_SIZE * 2;
export const NATURAL_DENSITY_MULTIPLIER = 1.3;

export const NATURAL_BASE_DENSITIES = Object.freeze({
  tree: 0.006,
  terrainDetail: 0.015,
  chunkDetail: 0.007,
});

export const NATURAL_DENSITIES = Object.freeze(Object.fromEntries(
  Object.entries(NATURAL_BASE_DENSITIES).map(([key, value]) => [
    key,
    Number((value * NATURAL_DENSITY_MULTIPLIER).toFixed(8)),
  ]),
));

export const TREE_STYLE_DEFS = Object.freeze([
  Object.freeze({ id: 'pine', label: 'Layered Pine' }),
  Object.freeze({ id: 'round', label: 'Round Shade Tree' }),
  Object.freeze({ id: 'broadleaf', label: 'Broadleaf Tree' }),
  Object.freeze({ id: 'cypress', label: 'Cypress' }),
  Object.freeze({ id: 'palm', label: 'Palm' }),
]);

// Pine and cypress are the two pointed silhouettes. Scaling their shared
// templates here keeps procedural and editor-placed trees visually identical.
export const TREE_STYLE_SCALE_MULTIPLIERS = Object.freeze({
  pine: 1.7,
  round: 1,
  broadleaf: 1,
  cypress: 1.7,
  palm: 1,
});

// Horizontal visual clearance around each natural asset. Trees use the
// widest possible pine canopy after its 1.7x style multiplier so neither the
// trunk nor foliage can hang over a roadway component.
export const NATURAL_ROADWAY_CLEARANCE_RADII = Object.freeze({
  terrainDetail: 0.45,
  tree: 2.3,
  grassPatch: 0.5,
  rock: 0.8,
});

export function getRoadwayComponentBounds(segment, roadwayHalfWidth, tileSize = 1) {
  const halfWidth = Math.max(0, Number(roadwayHalfWidth) || 0);
  const size = Math.max(0.0001, Number(tileSize) || 1);
  const x1 = Number(segment?.x1);
  const z1 = Number(segment?.z1);
  const x2 = Number(segment?.x2);
  const z2 = Number(segment?.z2);
  if (![x1, z1, x2, z2].every(Number.isFinite)) return null;

  if (segment?.type) {
    const centerX = x1 * size + size / 2;
    const centerZ = z1 * size + size / 2;
    return Object.freeze({
      minX: centerX - halfWidth,
      maxX: centerX + halfWidth,
      minZ: centerZ - halfWidth,
      maxZ: centerZ + halfWidth,
    });
  }

  const horizontal = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
  if (horizontal) {
    const centerZ = z1 * size + size / 2;
    return Object.freeze({
      minX: Math.min(x1, x2) * size,
      maxX: (Math.max(x1, x2) + 1) * size,
      minZ: centerZ - halfWidth,
      maxZ: centerZ + halfWidth,
    });
  }

  const centerX = x1 * size + size / 2;
  return Object.freeze({
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: Math.min(z1, z2) * size,
    maxZ: (Math.max(z1, z2) + 1) * size,
  });
}

export function circleIntersectsBounds(x, z, radius, bounds) {
  if (!bounds) return false;
  const centerX = Number(x);
  const centerZ = Number(z);
  const r = Math.max(0, Number(radius) || 0);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) return false;
  const nearestX = clamp(centerX, bounds.minX, bounds.maxX);
  const nearestZ = clamp(centerZ, bounds.minZ, bounds.maxZ);
  const dx = centerX - nearestX;
  const dz = centerZ - nearestZ;
  return dx * dx + dz * dz <= r * r;
}

export function doesNaturalAssetOverlapRoadway(
  x,
  z,
  radius,
  streetSegments,
  roadwayHalfWidth,
  tileSize = 1,
) {
  for (const segment of streetSegments || []) {
    const bounds = getRoadwayComponentBounds(segment, roadwayHalfWidth, tileSize);
    if (circleIntersectsBounds(x, z, radius, bounds)) return true;
  }
  return false;
}

export const NATURAL_FLOWER_VARIANTS = Object.freeze([
  'rounded',
  'five-petal',
  'six-petal',
  'cup',
]);

export const TERRAIN_DETAIL_MIX = Object.freeze([
  Object.freeze({ id: 'small-stone', weight: 0.42 }),
  Object.freeze({ id: 'wildflowers', weight: 0.26 }),
  Object.freeze({ id: 'grass-tuft', weight: 0.22 }),
  Object.freeze({ id: 'pebbles', weight: 0.10 }),
]);

export const CHUNK_DETAIL_MIX = Object.freeze([
  // The former bush and colorful flower-cluster shares intentionally stay
  // empty instead of being replaced with more geometry from remaining kinds.
  Object.freeze({ id: 'none', weight: 0.48 }),
  Object.freeze({ id: 'grass-patch', weight: 0.27 }),
  Object.freeze({ id: 'large-rock', weight: 0.25 }),
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isWorldPositionInBounds(x, z, padding = 0) {
  const inset = Math.max(0, Number(padding) || 0);
  const limit = Math.max(0, WORLD_HALF_SIZE - inset);
  return Number.isFinite(Number(x))
    && Number.isFinite(Number(z))
    && Number(x) >= -limit
    && Number(x) <= limit
    && Number(z) >= -limit
    && Number(z) <= limit;
}

export function isWorldTileInBounds(x, z, tileSize = 1) {
  const size = Math.max(0, Number(tileSize) || 0);
  const minX = Number(x);
  const minZ = Number(z);
  return Number.isFinite(minX)
    && Number.isFinite(minZ)
    && minX >= -WORLD_HALF_SIZE
    && minZ >= -WORLD_HALF_SIZE
    && minX + size <= WORLD_HALF_SIZE
    && minZ + size <= WORLD_HALF_SIZE;
}

export function chunkIntersectsWorldBounds(cx, cz, chunkWorldSize) {
  const size = Math.max(1, Number(chunkWorldSize) || 1);
  const minX = Number(cx) * size;
  const minZ = Number(cz) * size;
  const maxX = minX + size;
  const maxZ = minZ + size;
  return Number.isFinite(minX)
    && Number.isFinite(minZ)
    && maxX > -WORLD_HALF_SIZE
    && minX < WORLD_HALF_SIZE
    && maxZ > -WORLD_HALF_SIZE
    && minZ < WORLD_HALF_SIZE;
}

export function getCameraWorldLimit(cameraDistance = 40, minimumMargin = 32) {
  const distance = Math.max(0, Number(cameraDistance) || 0);
  const margin = clamp(
    Math.max(Number(minimumMargin) || 0, distance * 1.35),
    0,
    WORLD_HALF_SIZE - 1,
  );
  return WORLD_HALF_SIZE - margin;
}

export function clampWorldCameraTarget(x, z, cameraDistance = 40, minimumMargin = 32) {
  const limit = getCameraWorldLimit(cameraDistance, minimumMargin);
  return Object.freeze({
    x: clamp(Number(x) || 0, -limit, limit),
    z: clamp(Number(z) || 0, -limit, limit),
    limit,
  });
}

export function selectWeightedNaturalKind(unitValue, mix) {
  const entries = Array.isArray(mix) ? mix : [];
  if (!entries.length) return null;
  const total = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry?.weight) || 0), 0);
  if (!(total > 0)) return entries[0]?.id || null;
  let cursor = clamp(Number(unitValue) || 0, 0, 0.999999999) * total;
  for (const entry of entries) {
    cursor -= Math.max(0, Number(entry?.weight) || 0);
    if (cursor < 0) return entry.id;
  }
  return entries[entries.length - 1]?.id || null;
}

export function selectTreeStyle(unitValue) {
  const unit = clamp(Number(unitValue) || 0, 0, 0.999999999);
  return TREE_STYLE_DEFS[Math.floor(unit * TREE_STYLE_DEFS.length)];
}

export function getNaturalDensitySummary() {
  const baseTotal = Object.values(NATURAL_BASE_DENSITIES).reduce((sum, value) => sum + value, 0);
  const total = Object.values(NATURAL_DENSITIES).reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    multiplier: NATURAL_DENSITY_MULTIPLIER,
    baseTotal,
    total,
    increasePercent: Number((((total / baseTotal) - 1) * 100).toFixed(6)),
  });
}
