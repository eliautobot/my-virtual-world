import {
  getCommercialRoofLayout,
  getResidentialRoofLayout,
} from './building-roofs.mjs';

export const BIRD_STATES = Object.freeze({
  HIDDEN: 'hidden',
  PERCHED: 'perched',
  WALKING: 'walking',
  TAKEOFF: 'takeoff',
  FLYING: 'flying',
  LANDING: 'landing',
});

export const BIRD_SURFACE_KINDS = Object.freeze({
  PARK_GRASS: 'park-grass',
  TERRAIN_GRASS: 'terrain-grass',
  COMMERCIAL_ROOF_LEDGE: 'commercial-roof-ledge',
  RESIDENTIAL_ROOF_RIDGE: 'residential-roof-ridge',
});

const GROUND_SURFACE_KINDS = new Set([
  BIRD_SURFACE_KINDS.PARK_GRASS,
  BIRD_SURFACE_KINDS.TERRAIN_GRASS,
]);

const ROOF_SURFACE_KINDS = new Set([
  BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE,
  BIRD_SURFACE_KINDS.RESIDENTIAL_ROOF_RIDGE,
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedRotation(building) {
  return ((finite(building?._rotation ?? building?.rotation) % 360) + 360) % 360;
}

function buildingDimensions(building, tileSize = 1) {
  return {
    width: Math.max(tileSize, finite(building?.widthTiles ?? building?.width, 1) * tileSize),
    depth: Math.max(tileSize, finite(building?.heightTiles ?? building?.depth, 1) * tileSize),
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || 'bird')) {
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

export function getBirdPerchRefKey(ref) {
  if (!ref) return '';
  if (ref.id) return String(ref.id);
  const x = Number.isFinite(Number(ref.x)) ? Number(ref.x).toFixed(3) : '';
  const z = Number.isFinite(Number(ref.z)) ? Number(ref.z).toFixed(3) : '';
  return `${String(ref.kind || 'perch')}:${String(ref.buildingId || '')}:${String(ref.edge || '')}:${x}:${z}`;
}

export function selectOpenBirdPerchRef(perches, {
  occupiedKeys = new Set(),
  startIndex = 0,
} = {}) {
  const available = Array.isArray(perches) ? perches.filter(Boolean) : [];
  if (!available.length) return null;
  const occupied = occupiedKeys instanceof Set ? occupiedKeys : new Set(occupiedKeys || []);
  const start = ((Math.floor(finite(startIndex)) % available.length) + available.length) % available.length;
  for (let offset = 0; offset < available.length; offset++) {
    const ref = available[(start + offset) % available.length];
    if (!occupied.has(getBirdPerchRefKey(ref))) return ref;
  }
  return null;
}

export function selectBalancedBirdHabitatZone(zones, {
  occupancyByZone = new Map(),
  x = 0,
  z = 0,
  excludeZoneId = null,
} = {}) {
  const occupancy = occupancyByZone instanceof Map
    ? occupancyByZone
    : new Map(Object.entries(occupancyByZone || {}));
  const available = (zones || [])
    .filter(zone => zone && Array.isArray(zone.perches) && zone.perches.length > 0)
    .map(zone => {
      const population = Math.max(0, finite(occupancy.get(zone.id)));
      return {
        zone,
        population,
        fillRatio: population / zone.perches.length,
        distance: Math.hypot(finite(zone.centerX) - finite(x), finite(zone.centerZ) - finite(z)),
      };
    })
    .filter(entry => entry.population < entry.zone.perches.length);
  if (!available.length) return null;
  const outsideCurrent = available.filter(entry => entry.zone.id !== excludeZoneId);
  const pool = outsideCurrent.length ? outsideCurrent : available;
  const minimumFill = Math.min(...pool.map(entry => entry.fillRatio));
  const balanced = pool.filter(entry => entry.fillRatio <= minimumFill + 0.16);
  balanced.sort((a, b) => (
    b.distance - a.distance
    || finite(b.zone.priority) - finite(a.zone.priority)
    || String(a.zone.id).localeCompare(String(b.zone.id))
  ));
  return balanced[0]?.zone || null;
}

export function isBirdGroundSurfaceKind(kind) {
  return GROUND_SURFACE_KINDS.has(String(kind || ''));
}

export function isBirdRoofSurfaceKind(kind) {
  return ROOF_SURFACE_KINDS.has(String(kind || ''));
}

export function getBirdBuildingFloorCount(building) {
  return Math.max(1, Math.floor(finite(building?.floorCount ?? building?.floors?.length, 1)));
}

export function getBirdBuildingWorldPoint(building, localX, localZ, tileSize = 1) {
  const baseX = finite(building?.worldX ?? building?.x) * tileSize;
  const baseZ = finite(building?.worldY ?? building?.z) * tileSize;
  const { width, depth } = buildingDimensions(building, tileSize);
  const rotation = normalizedRotation(building);
  let x = baseX + finite(localX);
  let z = baseZ + finite(localZ);

  if (rotation === 90) {
    x = baseX + depth - finite(localZ);
    z = baseZ + finite(localX);
  } else if (rotation === 180) {
    x = baseX + width - finite(localX);
    z = baseZ + depth - finite(localZ);
  } else if (rotation === 270) {
    x = baseX + finite(localZ);
    z = baseZ + width - finite(localX);
  }

  return Object.freeze({ x, z });
}

export function getBirdBuildingLocalPoint(building, worldX, worldZ, tileSize = 1) {
  const baseX = finite(building?.worldX ?? building?.x) * tileSize;
  const baseZ = finite(building?.worldY ?? building?.z) * tileSize;
  const { width, depth } = buildingDimensions(building, tileSize);
  const rotation = normalizedRotation(building);
  const relX = finite(worldX) - baseX;
  const relZ = finite(worldZ) - baseZ;

  if (rotation === 90) return Object.freeze({ x: relZ, z: depth - relX });
  if (rotation === 180) return Object.freeze({ x: width - relX, z: depth - relZ });
  if (rotation === 270) return Object.freeze({ x: width - relZ, z: relX });
  return Object.freeze({ x: relX, z: relZ });
}

function findContainingBuilding(buildings, x, z, tileSize = 1) {
  for (const building of buildings || []) {
    if (!building) continue;
    const { width, depth } = buildingDimensions(building, tileSize);
    const local = getBirdBuildingLocalPoint(building, x, z, tileSize);
    if (local.x >= 0 && local.x <= width && local.z >= 0 && local.z <= depth) {
      return { building, local, width, depth };
    }
  }
  return null;
}

export function getBirdGroundSurfaceAt({
  x,
  z,
  buildings = [],
  terrainAt = null,
  terrainSurfaceYAt = null,
  grassTerrain = 0,
  tileSize = 1,
  parkSurfaceY = 0.16,
  terrainSurfaceY = 0.2,
} = {}) {
  const worldX = finite(x, NaN);
  const worldZ = finite(z, NaN);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;

  const containing = findContainingBuilding(buildings, worldX, worldZ, tileSize);
  if (containing) {
    if (String(containing.building?.type || '').toLowerCase() !== 'park') return null;
    return Object.freeze({
      kind: BIRD_SURFACE_KINDS.PARK_GRASS,
      x: worldX,
      y: finite(containing.building?._elevationY) + finite(parkSurfaceY, 0.16),
      z: worldZ,
      buildingId: containing.building.id || null,
      localX: containing.local.x,
      localZ: containing.local.z,
      surfaceKey: `park:${containing.building.id || 'park'}`,
    });
  }

  const tileX = Math.floor(worldX / tileSize);
  const tileZ = Math.floor(worldZ / tileSize);
  const terrain = typeof terrainAt === 'function' ? terrainAt(tileX, tileZ) : null;
  if (terrain !== grassTerrain) return null;
  const resolvedY = typeof terrainSurfaceYAt === 'function'
    ? terrainSurfaceYAt(tileX, tileZ, terrain)
    : terrainSurfaceY;
  return Object.freeze({
    kind: BIRD_SURFACE_KINDS.TERRAIN_GRASS,
    x: worldX,
    y: finite(resolvedY, terrainSurfaceY),
    z: worldZ,
    tileX,
    tileZ,
    surfaceKey: `terrain-grass:${tileX}:${tileZ}`,
  });
}

export function createParkBirdPerchRefs(building, count = 12) {
  if (!building?.id || String(building.type || '').toLowerCase() !== 'park') return Object.freeze([]);
  const safeCount = Math.max(1, Math.floor(finite(count, 12)));
  const seed = hashString(`${building.id}:park-birds`);
  const columns = Math.max(2, Math.ceil(Math.sqrt(safeCount * 1.3)));
  const rows = Math.max(2, Math.ceil(safeCount / columns));
  const refs = [];
  for (let index = 0; index < safeCount; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const u = clamp(0.16 + ((column + 0.5) / columns) * 0.68 + (seededUnit(seed, index * 2) - 0.5) * 0.055, 0.14, 0.86);
    const v = clamp(0.16 + ((row + 0.5) / rows) * 0.68 + (seededUnit(seed, index * 2 + 1) - 0.5) * 0.055, 0.14, 0.86);
    refs.push(Object.freeze({
      id: `park:${building.id}:${index + 1}`,
      kind: BIRD_SURFACE_KINDS.PARK_GRASS,
      buildingId: building.id,
      u,
      v,
    }));
  }
  return Object.freeze(refs);
}

export function createRoofBirdPerchRefs(building) {
  if (!building?.id || String(building.type || '').toLowerCase() === 'park') return Object.freeze([]);
  const type = String(building.type || 'office').toLowerCase();
  if (type === 'home') {
    return Object.freeze([0.16, 0.33, 0.5, 0.67, 0.84].map((v, index) => Object.freeze({
      id: `roof-ridge:${building.id}:${index + 1}`,
      kind: BIRD_SURFACE_KINDS.RESIDENTIAL_ROOF_RIDGE,
      buildingId: building.id,
      edge: 'ridge',
      u: 0.5,
      v,
    })));
  }

  const refs = [];
  for (const edge of ['north', 'south', 'west', 'east']) {
    for (const fraction of [0.18, 0.5, 0.82]) {
      refs.push(Object.freeze({
        id: `roof-ledge:${building.id}:${edge}:${fraction}`,
        kind: BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE,
        buildingId: building.id,
        edge,
        u: edge === 'north' || edge === 'south' ? fraction : (edge === 'west' ? 0 : 1),
        v: edge === 'west' || edge === 'east' ? fraction : (edge === 'north' ? 0 : 1),
      }));
    }
  }
  return Object.freeze(refs);
}

function getBuildingFromContext(buildingId, context) {
  const source = context?.buildingById;
  if (typeof source === 'function') return source(buildingId) || null;
  if (source?.get) return source.get(buildingId) || null;
  if (source && typeof source === 'object') return source[buildingId] || null;
  return null;
}

export function resolveBirdPerchRef(ref, {
  buildingById = null,
  floorHeight = 2.98,
  wallHeight = 3,
  tileSize = 1,
  parkSurfaceY = 0.16,
  wallThickness = 0.25,
} = {}) {
  if (!ref?.buildingId) return null;
  const building = getBuildingFromContext(ref.buildingId, { buildingById });
  if (!building) return null;
  const { width, depth } = buildingDimensions(building, tileSize);
  const floors = getBirdBuildingFloorCount(building);
  const elevation = finite(building?._elevationY);

  if (ref.kind === BIRD_SURFACE_KINDS.PARK_GRASS) {
    if (String(building.type || '').toLowerCase() !== 'park') return null;
    const localX = clamp(finite(ref.u, 0.5), 0.08, 0.92) * width;
    const localZ = clamp(finite(ref.v, 0.5), 0.08, 0.92) * depth;
    const world = getBirdBuildingWorldPoint(building, localX, localZ, tileSize);
    return Object.freeze({
      kind: ref.kind,
      x: world.x,
      y: elevation + finite(parkSurfaceY, 0.16),
      z: world.z,
      buildingId: building.id,
      localX,
      localZ,
      surfaceKey: `park:${building.id}`,
      refId: ref.id || null,
    });
  }

  if (ref.kind === BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE) {
    const type = String(building.type || 'office').toLowerCase();
    const layout = getCommercialRoofLayout({
      type,
      width,
      depth,
      floorCount: floors,
      seed: building.id || building.name || 'building',
    });
    if (!layout.supported || !layout.edge.enabled) return null;
    const localX = clamp(finite(ref.u, 0.5), 0, 1) * width;
    const localZ = clamp(finite(ref.v, 0.5), 0, 1) * depth;
    const world = getBirdBuildingWorldPoint(building, localX, localZ, tileSize);
    return Object.freeze({
      kind: ref.kind,
      x: world.x,
      y: elevation
        + (floors - 1) * finite(floorHeight, 2.98)
        + finite(wallHeight, 3)
        + 0.15
        + finite(layout.edge.height)
        + finite(layout.edge.copingHeight),
      z: world.z,
      buildingId: building.id,
      floorCount: floors,
      edge: ref.edge || null,
      surfaceKey: `roof-ledge:${building.id}:${ref.edge || 'edge'}`,
      refId: ref.id || null,
    });
  }

  if (ref.kind === BIRD_SURFACE_KINDS.RESIDENTIAL_ROOF_RIDGE) {
    if (String(building.type || '').toLowerCase() !== 'home') return null;
    const layout = getResidentialRoofLayout({
      width,
      depth,
      wallThickness,
      wallHeight,
      ridgeHeight: 1.4,
      seed: building.id || building.name || 'home',
    });
    if (!layout.supported) return null;
    const localX = width / 2;
    const localZ = clamp(finite(ref.v, 0.5), 0.08, 0.92) * depth;
    const world = getBirdBuildingWorldPoint(building, localX, localZ, tileSize);
    return Object.freeze({
      kind: ref.kind,
      x: world.x,
      y: elevation
        + (floors - 1) * finite(floorHeight, 2.98)
        + finite(layout.wallHeight, wallHeight)
        + finite(layout.ridgeHeight)
        + 0.19,
      z: world.z,
      buildingId: building.id,
      floorCount: floors,
      edge: 'ridge',
      surfaceKey: `roof-ridge:${building.id}`,
      refId: ref.id || null,
    });
  }

  return null;
}

export function selectSpreadBirdHabitatZones(zones, maximum = 8) {
  const available = (zones || []).filter((zone) => (
    zone
    && Number.isFinite(finite(zone.centerX, NaN))
    && Number.isFinite(finite(zone.centerZ, NaN))
    && Array.isArray(zone.perches)
    && zone.perches.length > 0
  ));
  const limit = Math.max(0, Math.min(available.length, Math.floor(finite(maximum, 8))));
  if (!limit) return Object.freeze([]);

  const chosen = [];
  const remaining = [...available];
  remaining.sort((a, b) => finite(b.priority) - finite(a.priority) || String(a.id).localeCompare(String(b.id)));
  chosen.push(remaining.shift());
  while (chosen.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const nearestDistance = Math.min(...chosen.map((selected) => Math.hypot(
        finite(candidate.centerX) - finite(selected.centerX),
        finite(candidate.centerZ) - finite(selected.centerZ),
      )));
      const score = nearestDistance + finite(candidate.priority) * 3.5;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    chosen.push(remaining.splice(bestIndex, 1)[0]);
  }
  return Object.freeze(chosen);
}

export function shouldScareGroundBird({
  birdX,
  birdY,
  birdZ,
  surfaceKind,
  agentX,
  agentY,
  agentZ,
  radius = 3.4,
  verticalTolerance = 1.65,
} = {}) {
  if (!isBirdGroundSurfaceKind(surfaceKind)) return false;
  const values = [birdX, birdY, birdZ, agentX, agentY, agentZ].map((value) => finite(value, NaN));
  if (!values.every(Number.isFinite)) return false;
  if (Math.abs(values[1] - values[4]) > Math.max(0, finite(verticalTolerance, 1.65))) return false;
  return Math.hypot(values[0] - values[3], values[2] - values[5]) <= Math.max(0, finite(radius, 3.4));
}
