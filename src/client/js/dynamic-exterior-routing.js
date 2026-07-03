import * as THREE from 'three';

export const DYNAMIC_EXTERIOR_ROUTING = {
  enabled: true,
  // PERF: debug route overlays default OFF (Settings → movement debug overlays).
  debug: false,
  gridCellSizeWorld: 0.58,
  gridMarginWorld: 10,
  maxGridCells: 24000,
  obstacleProbeRadiusWorld: 0.34,
  obstacleProbeHeightWorld: 1.6,
  staleRouteMs: 4500,
  replanCooldownMs: 350,
  poorProgressMs: 950,
  progressEpsilonApi: 4,
  progressSampleWindowMs: 280,
  progressSampleMinGainApi: 0.8,
  waypointReachApi: 5,
  lineOfSightStepWorld: 0.16,
  routeLookaheadWorld: 1.22,
  routeLookaheadMinTiles: 2,
  segmentAdvanceDotThreshold: 0.9,
  segmentAdvanceDistanceWorld: 0.18,
  cornerRoundRadiusWorld: 0.6,
  cornerRoundMinAngleDeg: 20,
  cornerRoundSegments: 3,
  corridorHalfWidthWorld: 0.5,
  centerBiasStrength: 0.36,
  maxStringPullSkip: 14,
  maxPreviewPoints: 48,
  maxPreviewTiles: 80,
  rerouteMarkerMs: 1400,
  rerouteRetryMs: 850,
  recoveryReplanSettleMs: 950,
  blockedReplanPersistMs: 420,
  rerouteAvoidStickMs: 1800,
  rerouteAvoidStickDistanceWorld: 0.85,
  minMotionReplanMs: 900,
  minMotionDistanceApi: 0.6,
  stuckAvoidRadiusWorld: 0.6,
  stuckAvoidRadiusGrowthWorld: 0.22,
  stuckAvoidMaxRadiusWorld: 1.5,
  dynamicAvoidMaxZones: 8,
  dynamicAvoidRadiusWorld: 0.7875,
  dynamicAvoidHardRadiusWorld: 0.39,
  dynamicAvoidCost: 7.5,
  vehicleYieldRadiusWorld: 4.5,
  vehicleYieldApproachDot: 0.12,
  roadEntryHoldApi: 4,
  roadsideSearchRadiusWorld: 10,
  routePriorityWeight: 0.32,
  routePriorityTargetWeight: 0.58,
  routePriorityScoreBoost: 6.5,
  routePriorityBacktrackPenalty: 7.5,
  routePriorityLookahead: 2,
  preferCenteredDoorApproach: true,
};

const _helpers = {
  scene: null,
  apiToWorldScale: 1 / 40,
  terrain: null,
  getWorldTile: null,
  findNearestSidewalk: null,
  pathfindSidewalk: null,
  isCrosswalk: null,
  getInteriorBuildingAt: null,
  getParkAt: null,
  getBuildingDoorSidewalkPos: null,
  getBuildingDoorPosAPI: null,
  getBuildingInteriorEntryPosAPI: null,
  getBuildingDoorwayPosAPI: null,
  getBuildingDoorwayReachApi: null,
  getVehicles: null,
  getSmartWaypoints: null,
  probeObstacleAtWorld: null,
  getAgentColliderHandle: null,
};

const _agentState = new Map();
const _debugGroups = new Map();
const _floorTileGeo = new THREE.PlaneGeometry(0.5, 0.5);
const _markerGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 18);
const _targetGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 24);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function apiToWorld(value) {
  return value * (_helpers.apiToWorldScale || 1 / 40);
}

function worldToApi(value) {
  return value / (_helpers.apiToWorldScale || 1 / 40);
}

function clonePoint2(point) {
  return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
}

function pointDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function normalizeVec2(x = 0, y = 0) {
  const len = Math.hypot(x, y);
  if (len <= 0.000001) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
}

function blendVec2(primary, secondary, primaryWeight = 0.8) {
  const w1 = clamp(primaryWeight, 0, 1);
  const w2 = 1 - w1;
  return normalizeVec2((primary?.x || 0) * w1 + (secondary?.x || 0) * w2, (primary?.y || 0) * w1 + (secondary?.y || 0) * w2);
}

function lerpPoint2(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    x: (a?.x || 0) + ((b?.x || 0) - (a?.x || 0)) * tt,
    y: (a?.y || 0) + ((b?.y || 0) - (a?.y || 0)) * tt,
  };
}

function quadraticBezierPoint(a, b, c, t) {
  const tt = clamp(t, 0, 1);
  const omt = 1 - tt;
  return {
    x: omt * omt * (a?.x || 0) + 2 * omt * tt * (b?.x || 0) + tt * tt * (c?.x || 0),
    y: omt * omt * (a?.y || 0) + 2 * omt * tt * (b?.y || 0) + tt * tt * (c?.y || 0),
  };
}

function dedupePoints(points, minDistance = 0.0001) {
  if (!Array.isArray(points) || !points.length) return [];
  const out = [clonePoint2(points[0])];
  for (let i = 1; i < points.length; i++) {
    if (pointDistance(points[i], out[out.length - 1]) > minDistance) out.push(clonePoint2(points[i]));
  }
  return out;
}

function getTerrainAtApi(apiX, apiY) {
  if (!_helpers.getWorldTile) return -1;
  return _helpers.getWorldTile(Math.round(apiToWorld(apiX)), Math.round(apiToWorld(apiY)));
}

function isSidewalkLikeKind(kind) {
  return kind === 'sidewalk' || kind === 'roadside-sidewalk' || kind === 'perimeter-sidewalk';
}

function findAdjacentBuildingForExteriorPoint(apiX, apiY) {
  if (!_helpers.getInteriorBuildingAt) return null;
  const sampleRadiiWorld = [0.55, 1.05, 1.55];
  const sampleDirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707],
  ];
  for (const radiusWorld of sampleRadiiWorld) {
    const radiusApi = worldToApi(radiusWorld);
    for (const [dx, dy] of sampleDirs) {
      const building = _helpers.getInteriorBuildingAt(apiX + dx * radiusApi, apiY + dy * radiusApi);
      if (building) return building;
    }
  }
  return null;
}

function getSurfaceKind(apiX, apiY) {
  const interior = _helpers.getInteriorBuildingAt?.(apiX, apiY) || null;
  if (interior) return { kind: 'interior', building: interior };
  const park = _helpers.getParkAt?.(apiX, apiY) || null;
  if (park) return { kind: 'park', building: park };
  const terrain = _helpers.terrain || {};
  const tile = getTerrainAtApi(apiX, apiY);
  if (tile === terrain.SIDEWALK) {
    const building = findAdjacentBuildingForExteriorPoint(apiX, apiY);
    if (building) return { kind: 'perimeter-sidewalk', building };
    if (isRoadAdjacentApi(apiX, apiY)) return { kind: 'roadside-sidewalk' };
    return { kind: 'sidewalk' };
  }
  if (tile === terrain.PARKING) return { kind: 'parking' };
  if (tile === terrain.ROAD) return { kind: _helpers.isCrosswalk?.(Math.round(apiToWorld(apiX)), Math.round(apiToWorld(apiY))) ? 'crosswalk' : 'road' };
  if (tile === terrain.GRASS) return { kind: 'grass' };
  if (tile === terrain.DIRT || tile === terrain.SAND) return { kind: 'soft-ground' };
  return { kind: 'other' };
}

function isOutdoorSurfacePassable(kind, allowRoadFallback = true, allowSoftFallback = false) {
  if (kind === 'park' || isSidewalkLikeKind(kind) || kind === 'crosswalk') return true;
  if (allowSoftFallback && (kind === 'grass' || kind === 'soft-ground' || kind === 'parking')) return true;
  if (allowRoadFallback && kind === 'road') return true;
  return false;
}

function getSurfaceTraversalCost(kind) {
  if (kind === 'perimeter-sidewalk') return 0.92;
  if (kind === 'roadside-sidewalk') return 1;
  if (kind === 'sidewalk') return 1.04;
  if (kind === 'crosswalk') return 1.35;
  if (kind === 'park') return 1.8;
  if (kind === 'grass') return 6.5;
  if (kind === 'soft-ground') return 7.5;
  if (kind === 'parking') return 8.5;
  if (kind === 'road') return 24;
  return Infinity;
}

function isOutdoorBlockedWorld(worldX, worldZ, cfg, options = {}) {
  const apiX = worldToApi(worldX);
  const apiY = worldToApi(worldZ);
  const allowRoadFallback = options.allowRoadFallback !== false;
  const allowSoftFallback = options.allowSoftFallback === true;
  const surface = getSurfaceKind(apiX, apiY);
  if (!isOutdoorSurfacePassable(surface.kind, allowRoadFallback, allowSoftFallback)) return true;

  const probe = _helpers.probeObstacleAtWorld?.(
    worldX,
    worldZ,
    Math.max(0.08, Number(cfg.obstacleProbeRadiusWorld) || 0.34),
    {
      height: Math.max(0.5, Number(cfg.obstacleProbeHeightWorld) || 1.6),
      ignoreHandles: Array.isArray(options.ignoreHandles) ? options.ignoreHandles : [],
      maxCenters: 0,
    }
  ) || null;
  return !!probe?.hit;
}

function worldPointToGridCell(grid, worldX, worldZ) {
  if (!grid) return null;
  const x = clamp(Math.floor((worldX - grid.minX) / grid.cellSize), 0, grid.cols - 1);
  const z = clamp(Math.floor((worldZ - grid.minZ) / grid.cellSize), 0, grid.rows - 1);
  return { x, z };
}

function normalizePlanDynamicAvoidZones(options = {}, cfg = DYNAMIC_EXTERIOR_ROUTING) {
  const rawZones = Array.isArray(options?.dynamicAvoidZones) ? options.dynamicAvoidZones : [];
  const maxZones = Math.max(0, Math.min(12, Math.round(Number(cfg.dynamicAvoidMaxZones) || 8)));
  if (!rawZones.length || maxZones <= 0) return [];
  return rawZones
    .map((zone) => {
      const apiX = Number(zone?.x);
      const apiY = Number(zone?.y ?? zone?.z);
      if (!Number.isFinite(apiX) || !Number.isFinite(apiY)) return null;
      return {
        x: apiToWorld(apiX),
        z: apiToWorld(apiY),
        radiusWorld: Math.max(
          Number(cfg.gridCellSizeWorld) || 0.58,
          Number(zone?.radiusWorld) || Number(cfg.dynamicAvoidRadiusWorld) || 0.7875,
        ),
        hardRadiusWorld: Math.max(0, Math.min(
          Number(zone?.radiusWorld) || Number(cfg.dynamicAvoidRadiusWorld) || 0.7875,
          Number(zone?.hardRadiusWorld) || Number(cfg.dynamicAvoidHardRadiusWorld) || 0.39,
        )),
        weight: Math.max(0, Number(zone?.weight) || Number(cfg.dynamicAvoidCost) || 7.5),
      };
    })
    .filter(Boolean)
    .slice(0, maxZones);
}

function buildOutdoorGrid(startApi, endApi, cfg, agentId = null, options = {}) {
  const startWorld = { x: apiToWorld(startApi.x), z: apiToWorld(startApi.y) };
  const endWorld = { x: apiToWorld(endApi.x), z: apiToWorld(endApi.y) };
  const avoidPointWorld = options.avoidPoint ? { x: apiToWorld(options.avoidPoint.x), z: apiToWorld(options.avoidPoint.y) } : null;
  const avoidRadiusWorld = Math.max(0, Number(options.avoidRadiusWorld) || 0);
  const dynamicAvoidZones = normalizePlanDynamicAvoidZones(options, cfg);
  const distWorld = Math.hypot(endWorld.x - startWorld.x, endWorld.z - startWorld.z);
  let cellSize = Math.max(0.45, Number(cfg.gridCellSizeWorld) || 0.75);
  const margin = Math.max(Number(cfg.gridMarginWorld) || 10, distWorld * 0.16);
  const minX = Math.min(startWorld.x, endWorld.x) - margin;
  const minZ = Math.min(startWorld.z, endWorld.z) - margin;
  const maxX = Math.max(startWorld.x, endWorld.x) + margin;
  const maxZ = Math.max(startWorld.z, endWorld.z) + margin;

  let cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  let rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
  const maxGridCells = Math.max(4000, Math.round(Number(cfg.maxGridCells) || 24000));
  if (cols * rows > maxGridCells) {
    const scaleUp = Math.sqrt((cols * rows) / maxGridCells);
    cellSize *= scaleUp;
    cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
  }

  const blocked = new Uint8Array(cols * rows);
  const surfaces = new Array(cols * rows);
  const selfHandle = _helpers.getAgentColliderHandle?.(agentId) ?? null;
  const ignoreHandles = selfHandle != null ? [selfHandle] : [];

  const grid = {
    minX,
    minZ,
    maxX,
    maxZ,
    cellSize,
    cols,
    rows,
    blocked,
    surfaces,
    index: (x, z) => z * cols + x,
    center: (x, z) => ({
      x: minX + (x + 0.5) * cellSize,
      z: minZ + (z + 0.5) * cellSize,
    }),
    ignoreHandles,
    allowRoadFallback: options.allowRoadFallback === true,
    allowSoftFallback: options.allowSoftFallback === true,
    hasDynamicAvoid: dynamicAvoidZones.length > 0,
    dynamicAvoidCost: (x, z) => {
      if (!dynamicAvoidZones.length) return 0;
      const center = grid.center(x, z);
      let penalty = 0;
      for (const zone of dynamicAvoidZones) {
        const nearStart = Math.hypot(center.x - startWorld.x, center.z - startWorld.z) <= Math.max(grid.cellSize * 1.1, zone.radiusWorld * 0.45);
        const nearEnd = Math.hypot(center.x - endWorld.x, center.z - endWorld.z) <= Math.max(grid.cellSize * 1.1, zone.radiusWorld * 0.45);
        if (nearStart || nearEnd) continue;
        const dist = Math.hypot(center.x - zone.x, center.z - zone.z);
        if (dist >= zone.radiusWorld) continue;
        const pressure = 1 - (dist / zone.radiusWorld);
        penalty += zone.weight * pressure * pressure;
      }
      return penalty;
    },
  };

  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const idx = grid.index(x, z);
      const center = grid.center(x, z);
      const surface = getSurfaceKind(worldToApi(center.x), worldToApi(center.z));
      surfaces[idx] = surface.kind;
      blocked[idx] = isOutdoorBlockedWorld(center.x, center.z, cfg, {
        allowRoadFallback: grid.allowRoadFallback,
        allowSoftFallback: grid.allowSoftFallback,
        ignoreHandles,
      }) ? 1 : 0;
      if (!blocked[idx] && avoidPointWorld && avoidRadiusWorld > 0) {
        const avoidDist = Math.hypot(center.x - avoidPointWorld.x, center.z - avoidPointWorld.z);
        const nearStart = Math.hypot(center.x - startWorld.x, center.z - startWorld.z) <= Math.max(grid.cellSize * 1.1, avoidRadiusWorld * 0.55);
        const nearEnd = Math.hypot(center.x - endWorld.x, center.z - endWorld.z) <= Math.max(grid.cellSize * 1.1, avoidRadiusWorld * 0.55);
        if (avoidDist < avoidRadiusWorld && !nearStart && !nearEnd) blocked[idx] = 1;
      }
      if (!blocked[idx] && dynamicAvoidZones.length) {
        for (const zone of dynamicAvoidZones) {
          if (zone.hardRadiusWorld <= 0) continue;
          const nearStart = Math.hypot(center.x - startWorld.x, center.z - startWorld.z) <= Math.max(grid.cellSize * 1.1, zone.hardRadiusWorld * 0.75);
          const nearEnd = Math.hypot(center.x - endWorld.x, center.z - endWorld.z) <= Math.max(grid.cellSize * 1.1, zone.hardRadiusWorld * 0.75);
          if (nearStart || nearEnd) continue;
          if (Math.hypot(center.x - zone.x, center.z - zone.z) < zone.hardRadiusWorld) {
            blocked[idx] = 1;
            break;
          }
        }
      }
    }
  }

  return grid;
}

function findNearestOpenOutdoorCell(grid, apiPoint) {
  if (!grid || !apiPoint) return null;
  const worldX = apiToWorld(apiPoint.x);
  const worldZ = apiToWorld(apiPoint.y);
  const start = worldPointToGridCell(grid, worldX, worldZ);
  if (!start) return null;
  if (!grid.blocked[grid.index(start.x, start.z)]) return start;

  const maxRadius = Math.max(grid.cols, grid.rows);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const x = start.x + dx;
        const z = start.z + dz;
        if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
        if (!grid.blocked[grid.index(x, z)]) return { x, z };
      }
    }
  }
  return null;
}

function isRoadAdjacentApi(apiX, apiY) {
  const wx = Math.round(apiToWorld(apiX));
  const wz = Math.round(apiToWorld(apiY));
  const terrain = _helpers.terrain || {};
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  return dirs.some(([dx, dz]) => _helpers.getWorldTile?.(wx + dx, wz + dz) === terrain.ROAD);
}

function isRoadsideSidewalkApi(apiX, apiY) {
  return getSurfaceKind(apiX, apiY).kind === 'roadside-sidewalk';
}

function findPreferredRoadsideSidewalkApi(point, cfg) {
  if (!point) return null;
  if (isRoadsideSidewalkApi(point.x, point.y)) return clonePoint2(point);
  const terrain = _helpers.terrain || {};
  const cx = Math.round(apiToWorld(point.x));
  const cz = Math.round(apiToWorld(point.y));
  const radius = Math.max(2, Math.round(Number(cfg?.roadsideSearchRadiusWorld) || 12));
  let best = null;
  let bestScore = Infinity;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const wx = cx + dx;
      const wz = cz + dz;
      if (_helpers.getWorldTile?.(wx, wz) !== terrain.SIDEWALK) continue;
      const apiPoint = { x: worldToApi(wx), y: worldToApi(wz) };
      if (!isRoadAdjacentApi(apiPoint.x, apiPoint.y)) continue;
      const score = pointDistance(point, apiPoint);
      if (!best || score < bestScore) {
        best = apiPoint;
        bestScore = score;
      }
    }
  }
  return best;
}

function isOutdoorWalkableApi(apiX, apiY, cfg, allowRoadFallback = true, options = {}) {
  return !isOutdoorBlockedWorld(apiToWorld(apiX), apiToWorld(apiY), cfg, {
    allowRoadFallback,
    allowSoftFallback: options.allowSoftFallback === true,
    ignoreHandles: options.ignoreHandles,
  });
}

function isOutdoorSurfaceWalkableApi(apiX, apiY, allowRoadFallback = true, options = {}) {
  const surface = getSurfaceKind(apiX, apiY);
  return isOutdoorSurfacePassable(surface.kind, allowRoadFallback, options.allowSoftFallback === true);
}

function hasOutdoorLineOfSight(a, b, cfg, allowRoadFallback = true, grid = null, options = {}) {
  const dist = pointDistance(a, b);
  if (dist <= 0.0001) return true;
  const stepApi = Math.max(0.75, worldToApi(Math.max(0.08, Number(cfg.lineOfSightStepWorld) || 0.18)));
  const steps = Math.max(2, Math.ceil(dist / stepApi));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = lerpPoint2(a, b, t);
    if (grid) {
      const cell = worldPointToGridCell(grid, apiToWorld(p.x), apiToWorld(p.y));
      if (!cell || grid.blocked[grid.index(cell.x, cell.z)]) return false;
      const kind = grid.surfaces[grid.index(cell.x, cell.z)];
      if (!isOutdoorSurfacePassable(kind, allowRoadFallback, grid.allowSoftFallback === true || options.allowSoftFallback === true)) return false;
    } else if (!isOutdoorWalkableApi(p.x, p.y, cfg, allowRoadFallback, options)) {
      return false;
    }
  }
  return true;
}

function hasOutdoorSurfaceLineOfSight(a, b, cfg, allowRoadFallback = true, options = {}) {
  const dist = pointDistance(a, b);
  if (dist <= 0.0001) return true;
  const stepApi = Math.max(0.75, worldToApi(Math.max(0.08, Number(cfg.lineOfSightStepWorld) || 0.18)));
  const steps = Math.max(2, Math.ceil(dist / stepApi));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = lerpPoint2(a, b, t);
    if (!isOutdoorSurfaceWalkableApi(p.x, p.y, allowRoadFallback, options)) return false;
  }
  return true;
}

export function isDynamicExteriorRouteSegmentClear(startApi, endApi, options = {}) {
  if (!startApi || !endApi) {
    return { clear: true, reason: 'missing-segment-context' };
  }
  const cfg = { ...DYNAMIC_EXTERIOR_ROUTING, ...(options.config || options || {}) };
  const allowRoadFallback = options.allowRoadFallback !== false;
  const allowSoftFallback = options.allowSoftFallback === true;
  try {
    const start = clonePoint2({ x: startApi.x, y: startApi.y ?? startApi.z });
    const end = clonePoint2({ x: endApi.x, y: endApi.y ?? endApi.z });
    const surfaceOptions = { allowSoftFallback };
    const startWalkable = isOutdoorWalkableApi(start.x, start.y, cfg, allowRoadFallback, surfaceOptions);
    const endWalkable = isOutdoorWalkableApi(end.x, end.y, cfg, allowRoadFallback, surfaceOptions);
    const segmentClear = hasOutdoorLineOfSight(start, end, cfg, allowRoadFallback, null, surfaceOptions);
    return {
      clear: startWalkable && endWalkable && segmentClear,
      startBlocked: !startWalkable,
      endBlocked: !endWalkable,
      segmentClear,
      reason: !startWalkable ? 'start-blocked' : !endWalkable ? 'end-blocked' : (segmentClear ? 'clear' : 'segment-blocked'),
      blockedPoint: { x: end.x, y: end.y },
    };
  } catch (error) {
    return { clear: true, reason: 'validator-error', error: error?.message || String(error) };
  }
}

function subdivideRoutePoints(points, maxStepApi) {
  if (!Array.isArray(points) || points.length <= 1) return points || [];
  const spacing = Math.max(1.5, Number(maxStepApi) || 4);
  const out = [clonePoint2(points[0])];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const dist = pointDistance(start, end);
    if (dist > spacing) {
      const segments = Math.max(2, Math.ceil(dist / spacing));
      for (let step = 1; step < segments; step++) out.push(lerpPoint2(start, end, step / segments));
    }
    out.push(clonePoint2(end));
  }
  return dedupePoints(out, 0.01);
}

function simplifyPointPath(path) {
  if (!Array.isArray(path) || path.length <= 2) return path || [];
  const simplified = [clonePoint2(path[0])];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    const dx1 = Math.sign((curr.x || 0) - (prev.x || 0));
    const dy1 = Math.sign((curr.y || 0) - (prev.y || 0));
    const dx2 = Math.sign((next.x || 0) - (curr.x || 0));
    const dy2 = Math.sign((next.y || 0) - (curr.y || 0));
    if (dx1 !== dx2 || dy1 !== dy2) simplified.push(clonePoint2(curr));
  }
  simplified.push(clonePoint2(path[path.length - 1]));
  return simplified;
}

function stringPullRoute(points, cfg, allowRoadFallback = true, grid = null, options = {}) {
  if (!Array.isArray(points) || points.length <= 2) return points || [];
  const out = [clonePoint2(points[0])];
  let idx = 0;
  const maxSkip = Math.max(2, Math.round(Number(cfg.maxStringPullSkip) || 18));
  while (idx < points.length - 1) {
    let furthest = idx + 1;
    const maxTarget = Math.min(points.length - 1, idx + maxSkip);
    for (let j = idx + 1; j <= maxTarget; j++) {
      if (!hasOutdoorLineOfSight(points[idx], points[j], cfg, allowRoadFallback, grid, options)) break;
      furthest = j;
    }
    out.push(clonePoint2(points[furthest]));
    if (furthest === idx) break;
    idx = furthest;
  }
  return dedupePoints(out, 0.01);
}

function roundRouteCorners(points, cfg, allowRoadFallback = false, grid = null, options = {}) {
  if (!Array.isArray(points) || points.length <= 2) return points || [];
  const radiusApi = worldToApi(Number(cfg.cornerRoundRadiusWorld) || 0.52);
  const minTurnDeg = Math.max(0, Number(cfg.cornerRoundMinAngleDeg) || 20);
  const roundSegments = Math.max(2, Math.round(Number(cfg.cornerRoundSegments) || 3));
  const out = [clonePoint2(points[0])];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inVec = normalizeVec2((curr.x || 0) - (prev.x || 0), (curr.y || 0) - (prev.y || 0));
    const outVec = normalizeVec2((next.x || 0) - (curr.x || 0), (next.y || 0) - (curr.y || 0));
    const dot = clamp(inVec.x * outVec.x + inVec.y * outVec.y, -1, 1);
    const turnDeg = Math.acos(dot) * 180 / Math.PI;
    const inLen = pointDistance(prev, curr);
    const outLen = pointDistance(curr, next);

    if (!inVec.len || !outVec.len || turnDeg < minTurnDeg) {
      out.push(clonePoint2(curr));
      continue;
    }

    const trim = Math.min(radiusApi, inLen * 0.35, outLen * 0.35);
    if (trim <= 0.08) {
      out.push(clonePoint2(curr));
      continue;
    }

    const entry = { x: curr.x - inVec.x * trim, y: curr.y - inVec.y * trim };
    const exit = { x: curr.x + outVec.x * trim, y: curr.y + outVec.y * trim };
    if (!hasOutdoorLineOfSight(out[out.length - 1], entry, cfg, allowRoadFallback, grid, options) || !hasOutdoorLineOfSight(entry, exit, cfg, allowRoadFallback, grid, options) || !hasOutdoorLineOfSight(exit, next, cfg, allowRoadFallback, grid, options)) {
      out.push(clonePoint2(curr));
      continue;
    }

    out.push(entry);
    for (let seg = 1; seg < roundSegments; seg++) out.push(quadraticBezierPoint(entry, curr, exit, seg / roundSegments));
    out.push(exit);
  }

  out.push(clonePoint2(points[points.length - 1]));
  return dedupePoints(out, 0.01);
}

function buildRouteSegments(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const segments = [];
  let cumulative = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const start = clonePoint2(points[i]);
    const end = clonePoint2(points[i + 1]);
    const dir = normalizeVec2(end.x - start.x, end.y - start.y);
    const length = pointDistance(start, end);
    if (length <= 0.0001) continue;
    segments.push({ index: segments.length, start, end, dir, length, startDistance: cumulative, endDistance: cumulative + length });
    cumulative += length;
  }
  return segments;
}

function projectPointToSegment(point, segA, segB) {
  const vx = (segB?.x || 0) - (segA?.x || 0);
  const vy = (segB?.y || 0) - (segA?.y || 0);
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.000001) return { t: 0, point: clonePoint2(segA), distance: pointDistance(point, segA) };
  const t = clamp((((point?.x || 0) - (segA?.x || 0)) * vx + ((point?.y || 0) - (segA?.y || 0)) * vy) / len2, 0, 1);
  const projected = { x: (segA?.x || 0) + vx * t, y: (segA?.y || 0) + vy * t };
  return { t, point: projected, distance: pointDistance(point, projected) };
}

function getClosestRouteProjection(agent, state) {
  const point = { x: Number(agent?.x) || 0, y: Number(agent?.y) || 0 };
  const segments = Array.isArray(state?.routeSegments) ? state.routeSegments : [];
  if (!segments.length) return null;
  const currentIdx = clamp(Number(state?.segmentIndex) || 0, 0, segments.length - 1);
  let best = null;
  let bestScore = Infinity;
  for (const seg of segments) {
    const proj = projectPointToSegment(point, seg.start, seg.end);
    const indexBias = Math.abs(seg.index - currentIdx) * 0.35;
    const score = proj.distance + indexBias;
    if (!best || score < bestScore) {
      best = { segmentIndex: seg.index, point: proj.point, distance: proj.distance, t: proj.t, distanceAlong: seg.startDistance + seg.length * proj.t, segment: seg };
      bestScore = score;
    }
  }
  return best;
}

function pointAtDistanceOnSegments(segments, distanceAlong) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const clamped = clamp(distanceAlong, 0, segments[segments.length - 1].endDistance);
  for (const seg of segments) {
    if (clamped <= seg.endDistance || seg === segments[segments.length - 1]) {
      const local = seg.length > 0.0001 ? (clamped - seg.startDistance) / seg.length : 0;
      return lerpPoint2(seg.start, seg.end, local);
    }
  }
  return clonePoint2(segments[segments.length - 1].end);
}

function findParkAccessPoint(park, refPoint) {
  if (!park) return clonePoint2(refPoint);
  const centerX = ((park.worldX || 0) + (park.widthTiles || 0) * 0.5);
  const centerZ = ((park.worldY || 0) + (park.heightTiles || 0) * 0.5);
  const refWorldX = apiToWorld(refPoint?.x || worldToApi(centerX));
  const refWorldZ = apiToWorld(refPoint?.y || worldToApi(centerZ));
  const edgeWorldX = clamp(refWorldX, park.worldX || 0, (park.worldX || 0) + (park.widthTiles || 0));
  const edgeWorldZ = clamp(refWorldZ, park.worldY || 0, (park.worldY || 0) + (park.heightTiles || 0));
  const sw = _helpers.findNearestSidewalk?.(Math.round(edgeWorldX), Math.round(edgeWorldZ), 8) || null;
  if (sw) return { x: worldToApi(sw.x), y: worldToApi(sw.z) };
  return { x: worldToApi(edgeWorldX), y: worldToApi(edgeWorldZ) };
}

function resolveEndpointTransition(point, role, refPoint, cfg) {
  const anchorsBefore = [];
  const anchorsAfter = [];
  let handoff = null;
  const interior = _helpers.getInteriorBuildingAt?.(point.x, point.y) || null;
  if (interior) {
    const doorway = _helpers.getBuildingDoorwayPosAPI?.(interior)
      || _helpers.getBuildingInteriorEntryPosAPI?.(interior)
      || _helpers.getBuildingDoorSidewalkPos?.(interior)
      || clonePoint2(point);
    const centeredExteriorAccess = _helpers.getBuildingDoorPosAPI?.(interior)
      || _helpers.getBuildingDoorSidewalkPos?.(interior)
      || clonePoint2(doorway);
    const reachApi = Math.max(Number(_helpers.getBuildingDoorwayReachApi?.(interior)) || 0, Number(cfg?.waypointReachApi) || 6);
    if (role === 'start') {
      anchorsBefore.push(doorway);
      return { routePoint: clonePoint2(doorway), anchorsBefore, anchorsAfter, handoff };
    }
    handoff = {
      kind: 'doorway',
      buildingId: interior.id,
      doorway: clonePoint2(doorway),
      reachApi,
      finalPoint: clonePoint2(point),
    };
    return {
      routePoint: clonePoint2(cfg?.preferCenteredDoorApproach ? centeredExteriorAccess : doorway),
      anchorsBefore,
      anchorsAfter,
      handoff,
    };
  }

  const park = _helpers.getParkAt?.(point.x, point.y) || null;
  if (park) {
    const access = findParkAccessPoint(park, refPoint || point);
    if (role === 'start') {
      anchorsBefore.push(access);
      return { routePoint: access, anchorsBefore, anchorsAfter, handoff };
    }
    anchorsAfter.push(point);
    return { routePoint: access, anchorsBefore, anchorsAfter, handoff };
  }

  return { routePoint: clonePoint2(point), anchorsBefore, anchorsAfter, handoff };
}

function networkPointForApi(point, cfg) {
  if (!point) return null;
  const surface = getSurfaceKind(point.x, point.y);
  if (isSidewalkLikeKind(surface.kind) || surface.kind === 'crosswalk') return clonePoint2(point);
  if (surface.kind === 'road') {
    const roadside = findPreferredRoadsideSidewalkApi(point, cfg);
    if (roadside) return roadside;
  }
  const sw = _helpers.findNearestSidewalk?.(Math.round(apiToWorld(point.x)), Math.round(apiToWorld(point.y)), 12) || null;
  if (sw) return { x: worldToApi(sw.x), y: worldToApi(sw.z) };
  return clonePoint2(point);
}

function buildOutdoorAnchorPath(grid, cells, startApi, startNetworkApi, endNetworkApi, endApi) {
  const points = [clonePoint2(startApi)];
  if (startNetworkApi && pointDistance(startApi, startNetworkApi) > 1) points.push(clonePoint2(startNetworkApi));
  const inner = Array.isArray(cells) ? cells.slice(1, -1) : [];
  for (const cell of inner) {
    const center = grid.center(cell.x, cell.z);
    points.push({ x: worldToApi(center.x), y: worldToApi(center.z) });
  }
  if (endNetworkApi && pointDistance(endNetworkApi, endApi) > 1) points.push(clonePoint2(endNetworkApi));
  points.push(clonePoint2(endApi));
  return dedupePoints(points, 0.01);
}

function buildFallbackPath(start, end) {
  if (_helpers.getSmartWaypoints) {
    const smart = _helpers.getSmartWaypoints(start.x, start.y, end.x, end.y) || [];
    if (Array.isArray(smart) && smart.length) return [clonePoint2(start), ...smart.map(clonePoint2), clonePoint2(end)];
  }
  return [clonePoint2(start), clonePoint2(end)];
}

function runOutdoorGridSearch(start, end, startNetwork, endNetwork, cfg, agentId, options = {}) {
  const grid = buildOutdoorGrid(startNetwork, endNetwork, cfg, agentId, options);
  const startCell = findNearestOpenOutdoorCell(grid, startNetwork);
  const goalCell = findNearestOpenOutdoorCell(grid, endNetwork);
  if (!startCell || !goalCell) return null;

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const open = new Map();
  const closed = new Set();
  const cameFrom = new Map();
  const startKey = `${startCell.x},${startCell.z}`;
  const goalKey = `${goalCell.x},${goalCell.z}`;
  const heuristic = (x, z) => Math.hypot(goalCell.x - x, goalCell.z - z);
  open.set(startKey, { x: startCell.x, z: startCell.z, g: 0, f: heuristic(startCell.x, startCell.z) });

  while (open.size > 0) {
    let bestKey = null;
    let bestNode = null;
    for (const [key, node] of open) {
      if (!bestNode || node.f < bestNode.f) {
        bestKey = key;
        bestNode = node;
      }
    }
    if (!bestNode) break;
    if (bestKey === goalKey) {
      const rawCells = [];
      let walkKey = goalKey;
      while (walkKey) {
        const [gx, gz] = walkKey.split(',').map(Number);
        rawCells.unshift({ x: gx, z: gz });
        walkKey = cameFrom.get(walkKey) || null;
      }
      return {
        points: buildOutdoorAnchorPath(grid, rawCells, start, startNetwork, endNetwork, end),
        rawCells: rawCells.map((cell) => ({ x: grid.center(cell.x, cell.z).x, z: grid.center(cell.x, cell.z).z })),
        grid,
      };
    }

    open.delete(bestKey);
    closed.add(bestKey);

    for (const [dx, dz] of dirs) {
      const nx = bestNode.x + dx;
      const nz = bestNode.z + dz;
      if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
      const nIdx = grid.index(nx, nz);
      if (grid.blocked[nIdx]) continue;
      const nKey = `${nx},${nz}`;
      if (closed.has(nKey)) continue;

      const currKind = grid.surfaces[grid.index(bestNode.x, bestNode.z)];
      const nextKind = grid.surfaces[nIdx];
      const currIsCrossing = currKind === 'road' || currKind === 'crosswalk';
      const nextIsCrossing = nextKind === 'road' || nextKind === 'crosswalk';
      const currIsSidewalk = isSidewalkLikeKind(currKind);
      const nextIsSidewalk = isSidewalkLikeKind(nextKind);

      if (dx !== 0 && dz !== 0) {
        const orthoAIdx = grid.index(bestNode.x + dx, bestNode.z);
        const orthoBIdx = grid.index(bestNode.x, bestNode.z + dz);
        if (grid.blocked[orthoAIdx] || grid.blocked[orthoBIdx]) continue;

        const orthoAKind = grid.surfaces[orthoAIdx];
        const orthoBKind = grid.surfaces[orthoBIdx];
        const anyCrossing = currIsCrossing || nextIsCrossing || orthoAKind === 'road' || orthoAKind === 'crosswalk' || orthoBKind === 'road' || orthoBKind === 'crosswalk';
        if (anyCrossing) continue;
      }

      let surfaceTransitionPenalty = 0;
      if (currIsSidewalk && nextIsSidewalk && currKind !== nextKind) surfaceTransitionPenalty += 0.08;
      if (currKind === 'perimeter-sidewalk' && nextKind === 'roadside-sidewalk') surfaceTransitionPenalty += 0.28;
      if (currKind === 'roadside-sidewalk' && nextKind === 'perimeter-sidewalk') surfaceTransitionPenalty += 0.18;
      if ((currIsSidewalk && nextKind === 'grass') || (currKind === 'grass' && nextIsSidewalk)) surfaceTransitionPenalty += 1.6;
      if ((currIsSidewalk && nextKind === 'parking') || (currKind === 'parking' && nextIsSidewalk)) surfaceTransitionPenalty += 1.8;

      const terrainCost = getSurfaceTraversalCost(nextKind);
      if (!Number.isFinite(terrainCost)) continue;
      const stepCost = (dx === 0 || dz === 0) ? 1 : Math.SQRT2;
      const avoidPenalty = typeof grid.dynamicAvoidCost === 'function' ? grid.dynamicAvoidCost(nx, nz) : 0;
      const tentativeG = bestNode.g + stepCost * terrainCost + surfaceTransitionPenalty + avoidPenalty;
      const existing = open.get(nKey);
      if (!existing || tentativeG < existing.g) {
        cameFrom.set(nKey, bestKey);
        open.set(nKey, { x: nx, z: nz, g: tentativeG, f: tentativeG + heuristic(nx, nz) });
      }
    }
  }

  return null;
}

function planOutdoorCorePath(start, end, cfg, agentId = null, planOptions = {}) {
  const startNetwork = networkPointForApi(start, cfg);
  const endNetwork = networkPointForApi(end, cfg);
  if (!startNetwork || !endNetwork) return { points: buildFallbackPath(start, end), rawCells: [], grid: null };

  const planningAttempts = [
    { allowRoadFallback: false, allowSoftFallback: false },
    { allowRoadFallback: false, allowSoftFallback: true },
    { allowRoadFallback: true, allowSoftFallback: true },
  ].map((attempt) => ({ ...attempt, ...planOptions }));
  for (const attempt of planningAttempts) {
    const planned = runOutdoorGridSearch(start, end, startNetwork, endNetwork, cfg, agentId, attempt);
    if (planned) return planned;
  }

  const canDirect = pointDistance(startNetwork, endNetwork) <= worldToApi(1.25)
    && hasOutdoorLineOfSight(startNetwork, endNetwork, cfg, false, null, { allowSoftFallback: false, ignoreHandles: [] })
    && isSidewalkLikeKind(getSurfaceKind(startNetwork.x, startNetwork.y).kind)
    && isSidewalkLikeKind(getSurfaceKind(endNetwork.x, endNetwork.y).kind);
  if (canDirect) {
    return { points: [clonePoint2(start), clonePoint2(startNetwork), clonePoint2(endNetwork), clonePoint2(end)], rawCells: [], grid: null };
  }

  const sx = Math.round(apiToWorld(startNetwork.x));
  const sz = Math.round(apiToWorld(startNetwork.y));
  const gx = Math.round(apiToWorld(endNetwork.x));
  const gz = Math.round(apiToWorld(endNetwork.y));
  const tilePath = _helpers.pathfindSidewalk?.(sx, sz, gx, gz) || null;
  if (!Array.isArray(tilePath) || !tilePath.length) return { points: buildFallbackPath(start, end), rawCells: [], grid: null };

  const points = [clonePoint2(start)];
  if (pointDistance(start, startNetwork) > 1) points.push(clonePoint2(startNetwork));
  tilePath.forEach((tile) => points.push({ x: worldToApi(tile.x), y: worldToApi(tile.z) }));
  if (pointDistance(endNetwork, end) > 1) points.push(clonePoint2(endNetwork));
  points.push(clonePoint2(end));
  return { points: dedupePoints(points, 0.5), rawCells: tilePath.map((tile) => ({ x: Math.round(apiToWorld(worldToApi(tile.x))), z: Math.round(apiToWorld(worldToApi(tile.z))) })), grid: null };
}

function planRoute(startApi, targetApi, cfg, agentId = null, planOptions = {}) {
  const startTransition = resolveEndpointTransition(startApi, 'start', targetApi, cfg);
  const endTransition = resolveEndpointTransition(targetApi, 'end', startApi, cfg);
  const points = [clonePoint2(startApi)];
  startTransition.anchorsBefore.forEach((pt) => points.push(clonePoint2(pt)));
  const core = planOutdoorCorePath(startTransition.routePoint, endTransition.routePoint, cfg, agentId, planOptions);
  (core?.points || []).slice(1).forEach((pt) => points.push(clonePoint2(pt)));
  endTransition.anchorsAfter.forEach((pt) => points.push(clonePoint2(pt)));
  const simplified = simplifyPointPath(points);
  const routeOptions = { ignoreHandles: core?.grid?.ignoreHandles || [] };
  const stringPulled = stringPullRoute(simplified, cfg, false, core?.grid || null, routeOptions);
  const rounded = roundRouteCorners(stringPulled, cfg, false, core?.grid || null, routeOptions);
  const routePoints = dedupePoints(subdivideRoutePoints(rounded, Math.max(4, Number(cfg.waypointReachApi) || 6)), 0.5);
  return {
    rawPoints: simplified,
    rawCells: Array.isArray(core?.rawCells) ? core.rawCells : [],
    points: routePoints,
    route: routePoints.slice(1),
    routeSegments: buildRouteSegments(routePoints),
    destinationHandoff: endTransition.handoff || null,
  };
}

function ensureAgentState(agentId) {
  if (!_agentState.has(agentId)) {
    _agentState.set(agentId, {
      route: null,
      routePoints: null,
      routeSegments: null,
      routeIndex: 0,
      segmentIndex: 0,
      targetKey: null,
      revision: 0,
      poorProgressMs: 0,
      progressWindowMs: 0,
      progressWindowStartDistance: null,
      lastGoalDistance: null,
      lastPlanAtMs: 0,
      lastPlanReason: null,
      lastRouteProgressAtMs: 0,
      rerouteFrom: null,
      rerouteUntilMs: 0,
      projectedPoint: null,
      projectedDistance: 0,
      projectedDistanceAlong: 0,
      lastProjectedDistanceAlong: 0,
      stalledRouteProgressMs: 0,
      pursuitTarget: null,
      lateralOffset: 0,
      corridorViolationMs: 0,
      waitingForTraffic: false,
      waitPoint: null,
      blockedPoint: null,
      blockedReason: null,
      blockedReasonKey: null,
      blockedReasonMs: 0,
      noMotionMs: 0,
      lastMotionSample: null,
      rerouteAttempts: 0,
      rerouteAvoidPoint: null,
      rerouteAvoidRadiusWorld: 0,
      lastRecoveryPlanAtMs: 0,
      replanSettleUntilMs: 0,
      rawPoints: null,
      rawCells: null,
      destinationHandoff: null,
      active: false,
    });
  }
  return _agentState.get(agentId);
}

function makeTargetKey(target) {
  return `${Number(target?.x || 0).toFixed(2)}:${Number(target?.y || 0).toFixed(2)}`;
}

function shouldReplan(state, nowMs, targetKey, currentDistance, cfg) {
  const corridorHalfWidthApi = Math.max(1, worldToApi(Number(cfg.corridorHalfWidthWorld) || 0.5));
  const replanRetryMs = Math.max(350, Number(cfg.rerouteRetryMs) || 850);
  const nearGoalThreshold = Math.max((Number(cfg.waypointReachApi) || 5) * 1.75, 10);
  if (!state.route || !state.route.length || !state.routeSegments?.length) return 'initial-route';
  if (state.targetKey !== targetKey) return 'target-changed';
  if ((nowMs - state.lastPlanAtMs) >= cfg.staleRouteMs && currentDistance > cfg.waypointReachApi * 1.5) return 'route-stale';

  const inRecoverySettle = nowMs < (Number(state.replanSettleUntilMs) || 0);
  if (inRecoverySettle) {
    if ((state.projectedDistance || 0) > corridorHalfWidthApi * 2.6 && (nowMs - state.lastPlanAtMs) >= Math.max(replanRetryMs, Number(cfg.replanCooldownMs) || 350)) {
      return 'route-abandoned';
    }
    return null;
  }

  if (state.noMotionMs >= Math.max(700, Number(cfg.minMotionReplanMs) || 900) && (nowMs - state.lastPlanAtMs) >= replanRetryMs) return 'no-motion-stuck';
  if (state.blockedReason && (state.blockedReasonMs || 0) >= Math.max(120, Number(cfg.blockedReplanPersistMs) || 420) && (nowMs - state.lastPlanAtMs) >= replanRetryMs) return state.blockedReason;
  if (state.poorProgressMs >= cfg.poorProgressMs && currentDistance > nearGoalThreshold && (nowMs - state.lastPlanAtMs) >= cfg.replanCooldownMs) return 'poor-progress';
  if (state.stalledRouteProgressMs >= Math.max(1400, cfg.poorProgressMs * 1.6) && currentDistance > nearGoalThreshold && (nowMs - state.lastPlanAtMs) >= replanRetryMs) return 'route-progress-stalled';
  if (state.corridorViolationMs >= Math.max(650, cfg.poorProgressMs * 0.9) && (nowMs - state.lastPlanAtMs) >= cfg.replanCooldownMs) return 'corridor-drift';
  if ((state.projectedDistance || 0) > corridorHalfWidthApi * 2.15) return 'route-abandoned';
  return null;
}

function advanceRouteProgress(state, agent, cfg) {
  const projection = getClosestRouteProjection(agent, state);
  if (!projection) return null;
  state.segmentIndex = projection.segmentIndex;
  state.projectedPoint = clonePoint2(projection.point);
  state.projectedDistance = projection.distance;
  state.projectedDistanceAlong = projection.distanceAlong;
  state.lateralOffset = projection.distance;

  const lastRouteIndex = Math.max(0, (state.route?.length || 1) - 1);
  const currentIdx = clamp(state.routeIndex || 0, 0, lastRouteIndex);
  const anchorIdx = clamp(projection.segmentIndex, 0, lastRouteIndex);
  const nextAnchor = state.route?.[anchorIdx] || null;
  const reachApi = Math.max(
    worldToApi(Number(cfg.segmentAdvanceDistanceWorld) || 0.18),
    Math.min(worldToApi(0.5), worldToApi((Number(cfg.gridCellSizeWorld) || 0.9) * 0.55)),
  );
  const nearSegmentEnd = projection.t >= (Number(cfg.segmentAdvanceDotThreshold) || 0.9);
  const nearNextAnchor = !!(nextAnchor && pointDistance(agent, nextAnchor) <= reachApi);
  const projectedAhead = projection.distanceAlong >= ((state.routeSegments?.[anchorIdx]?.endDistance || 0) - reachApi);
  let nextIdx = (nearSegmentEnd || nearNextAnchor || projectedAhead)
    ? clamp(anchorIdx + 1, 0, lastRouteIndex)
    : anchorIdx;

  // Exterior nearest-segment projection can bounce between adjacent road/surface segments near corners.
  // Keep the chosen waypoint monotonic unless the route is clearly abandoned and replan logic should take over.
  if (currentIdx > nextIdx && (state.projectedDistance || 0) <= worldToApi(Math.max(0.6, Number(cfg.corridorHalfWidthWorld) || 0.5) * 2.25)) {
    nextIdx = currentIdx;
  }

  state.routeIndex = nextIdx;
  return projection;
}

function getLookaheadPointOnRoute(state, cfg) {
  if (!state?.routeSegments?.length) return state?.route?.[state?.routeIndex || 0] || null;
  const lookaheadApi = Math.max(worldToApi(Number(cfg.routeLookaheadWorld) || 1.22), worldToApi((Number(cfg.routeLookaheadMinTiles) || 2) * 0.6));
  return pointAtDistanceOnSegments(state.routeSegments, state.projectedDistanceAlong + lookaheadApi);
}

function applyCorridorCenterBias(agent, pursuitPoint, state, cfg) {
  if (!pursuitPoint || !state?.projectedPoint) return pursuitPoint;
  const corridorHalfWidthApi = Math.max(1, worldToApi(Number(cfg.corridorHalfWidthWorld) || 0.5));
  const pressure = clamp(((state.projectedDistance || 0) - corridorHalfWidthApi * 0.1) / corridorHalfWidthApi, 0, 1);
  if (pressure <= 0.001) return pursuitPoint;
  const bias = clamp((Number(cfg.centerBiasStrength) || 0.36) * pressure, 0, 0.62);
  const centered = {
    x: state.projectedPoint.x + (pursuitPoint.x - state.projectedPoint.x) * (1 - bias),
    y: state.projectedPoint.y + (pursuitPoint.y - state.projectedPoint.y) * (1 - bias),
  };
  return pointDistance(agent, centered) <= 1.5 ? pursuitPoint : centered;
}

function buildRoutePriorityHint(agent, state, cfg) {
  if (!agent || !state?.routeSegments?.length) return null;
  const currentSeg = state.routeSegments[clamp(state.segmentIndex || 0, 0, state.routeSegments.length - 1)] || null;
  const futureSeg = state.routeSegments[Math.min(state.routeSegments.length - 1, (state.segmentIndex || 0) + Math.max(1, Math.round(Number(cfg.routePriorityLookahead) || 2)))] || currentSeg;
  const toPursuit = state.pursuitTarget
    ? normalizeVec2((state.pursuitTarget.x || 0) - agent.x, (state.pursuitTarget.y || 0) - agent.y)
    : normalizeVec2();
  const toProjection = state.projectedPoint
    ? normalizeVec2((state.projectedPoint.x || 0) - agent.x, (state.projectedPoint.y || 0) - agent.y)
    : normalizeVec2();

  let routeDir = currentSeg?.dir?.len
    ? normalizeVec2(currentSeg.dir.x, currentSeg.dir.y)
    : normalizeVec2();
  if (futureSeg?.dir?.len) routeDir = blendVec2(routeDir, futureSeg.dir, 0.8);
  if (toPursuit.len) routeDir = blendVec2(routeDir, toPursuit, 0.68);
  if (toProjection.len && (state.projectedDistance || 0) > worldToApi((Number(cfg.corridorHalfWidthWorld) || 0.5) * 0.2)) {
    routeDir = blendVec2(routeDir, toProjection, 0.88);
  }
  if (!routeDir.len) return null;

  return {
    dir: { x: routeDir.x, z: routeDir.y },
    weight: clamp(Number(cfg.routePriorityWeight) || 0.32, 0, 1),
    targetWeight: clamp(Number(cfg.routePriorityTargetWeight) || 0.58, 0, 1),
    scoreBoost: Math.max(0, Number(cfg.routePriorityScoreBoost) || 6.5),
    backtrackPenalty: Math.max(0, Number(cfg.routePriorityBacktrackPenalty) || 7.5),
    lookaheadSteps: Math.max(1, Math.round(Number(cfg.routePriorityLookahead) || 2)),
    waypointIndex: clamp(state.routeIndex || 0, 0, Math.max(0, (state.route?.length || 1) - 1)),
    corridorOffset: state.projectedDistance || 0,
    segmentIndex: state.segmentIndex || 0,
  };
}

function vehicleHeading(vehicle) {
  if (vehicle?.dir === 0) return { x: 1, y: 0 };
  if (vehicle?.dir === 1) return { x: -1, y: 0 };
  if (vehicle?.dir === 2) return { x: 0, y: 1 };
  if (vehicle?.dir === 3) return { x: 0, y: -1 };
  return { x: 0, y: 0 };
}

function findUpcomingRoadEntry(agent, pursuitTarget, cfg) {
  if (!agent || !pursuitTarget) return null;
  const start = { x: agent.x, y: agent.y };
  const dist = pointDistance(start, pursuitTarget);
  const steps = Math.max(3, Math.ceil(dist / worldToApi(Math.max(0.18, Number(cfg.lineOfSightStepWorld) || 0.18))));
  const startSurface = getSurfaceKind(start.x, start.y).kind;
  let prev = start;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = lerpPoint2(start, pursuitTarget, t);
    const surface = getSurfaceKind(p.x, p.y).kind;
    if ((surface === 'crosswalk' || surface === 'road') && startSurface !== 'crosswalk' && startSurface !== 'road') {
      return { entryPoint: clonePoint2(prev), crossingPoint: clonePoint2(p), surface };
    }
    prev = p;
  }
  return null;
}

function shouldYieldForTraffic(crossing, cfg) {
  const vehicles = _helpers.getVehicles?.() || [];
  if (!crossing || !vehicles.length) return false;
  const crossingWorld = { x: apiToWorld(crossing.crossingPoint.x), z: apiToWorld(crossing.crossingPoint.y) };
  const yieldRadius = Math.max(2.5, Number(cfg.vehicleYieldRadiusWorld) || 4.5);
  const approachDot = Number(cfg.vehicleYieldApproachDot) || 0.12;
  return vehicles.some((vehicle) => {
    const vx = Number(vehicle?.x) || 0;
    const vz = Number(vehicle?.z) || 0;
    const dx = crossingWorld.x - vx;
    const dz = crossingWorld.z - vz;
    const dist = Math.hypot(dx, dz);
    if (dist > yieldRadius) return false;
    const heading = vehicleHeading(vehicle);
    const toward = normalizeVec2(dx, dz);
    return toward.len > 0 && (heading.x * toward.x + heading.y * toward.y) >= approachDot;
  });
}

function getRouteProbeIgnoreHandles(agentId) {
  const selfHandle = _helpers.getAgentColliderHandle?.(agentId) ?? null;
  return selfHandle != null ? [selfHandle] : [];
}

function isUpcomingRouteBlocked(agent, state, cfg) {
  if (!agent || !state?.routeSegments?.length) return null;
  const start = state.projectedPoint || { x: agent.x, y: agent.y };
  const maxSeg = Math.min(state.routeSegments.length - 1, (state.segmentIndex || 0) + 2);
  let last = clonePoint2(start);
  for (let i = Math.max(0, state.segmentIndex || 0); i <= maxSeg; i++) {
    const seg = state.routeSegments[i];
    if (!seg?.end) continue;
    if (!hasOutdoorSurfaceLineOfSight(last, seg.end, cfg, true, { allowSoftFallback: true })) {
      return { reason: 'surface-line-of-sight-lost', point: clonePoint2(seg.end) };
    }
    if (!isOutdoorSurfaceWalkableApi(seg.end.x, seg.end.y, true, { allowSoftFallback: true })) {
      return { reason: 'surface-segment-blocked', point: clonePoint2(seg.end) };
    }
    last = clonePoint2(seg.end);
  }
  return null;
}

export function configureDynamicExteriorRouting(helpers = {}) {
  Object.assign(_helpers, helpers || {});
}

export function invalidateDynamicExteriorRouting(agentId = null) {
  if (agentId == null) {
    _agentState.clear();
    return;
  }
  _agentState.delete(agentId);
}

export function clearDynamicExteriorRoutingForAgent(agentId = null) {
  invalidateDynamicExteriorRouting(agentId);
}

export function getDynamicExteriorRoutingState(agentId) {
  return agentId != null ? (_agentState.get(agentId) || null) : null;
}

function cloneRuntimeRoutePoint(point = null) {
  if (!point || typeof point !== 'object') return null;
  const x = Number(point.x);
  const y = Number(point.y ?? point.z);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function cloneRuntimeRouteCell(cell = null) {
  if (!cell || typeof cell !== 'object') return null;
  const x = Number(cell.x);
  const z = Number(cell.z ?? cell.y);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

function buildRuntimeRoutePoints(agent, runtimeRoute) {
  const points = Array.isArray(runtimeRoute?.routePoints)
    ? runtimeRoute.routePoints.map(cloneRuntimeRoutePoint).filter(Boolean)
    : [];
  const currentPoint = cloneRuntimeRoutePoint(agent);
  const nextPoint = cloneRuntimeRoutePoint(runtimeRoute?.nextPoint || runtimeRoute?.effectiveTarget || runtimeRoute?.pursuitTarget);
  const finalPoint = cloneRuntimeRoutePoint(runtimeRoute?.finalPoint);
  if (points.length === 0 && currentPoint) points.push(currentPoint);
  if (points.length <= 1 && nextPoint) points.push(nextPoint);
  if (finalPoint && (!points.length || pointDistance(points[points.length - 1], finalPoint) > 0.001)) points.push(finalPoint);
  return dedupePoints(points, 0.001);
}

export function hydrateDynamicExteriorRoutingDebugFromRuntimeRoute(agent, runtimeRoute = null) {
  const agentId = agent?.id;
  if (agentId == null) return false;
  const active = runtimeRoute && runtimeRoute.active !== false;
  const routePoints = active ? buildRuntimeRoutePoints(agent, runtimeRoute) : [];
  const route = routePoints.slice(1);
  if (!active || routePoints.length < 2 || route.length < 1) {
    const existing = _agentState.get(agentId);
    if (existing?.runtimeDebugHydrated) {
      _agentState.delete(agentId);
      const group = _debugGroups.get(agentId);
      if (group) group.visible = false;
    }
    return false;
  }

  const state = ensureAgentState(agentId);
  const rawPoints = Array.isArray(runtimeRoute.rawPoints)
    ? runtimeRoute.rawPoints.map(cloneRuntimeRoutePoint).filter(Boolean)
    : [];
  const rawCells = Array.isArray(runtimeRoute.rawCells)
    ? runtimeRoute.rawCells.map(cloneRuntimeRouteCell).filter(Boolean)
    : [];
  const routeIndex = clamp(Math.floor(Number(runtimeRoute.routeIndex) || 0), 0, Math.max(0, route.length - 1));
  const nextPoint = cloneRuntimeRoutePoint(runtimeRoute.nextPoint || runtimeRoute.effectiveTarget || runtimeRoute.pursuitTarget) || route[routeIndex] || route[0] || routePoints[routePoints.length - 1];

  state.route = route;
  state.routePoints = routePoints;
  state.routeSegments = null;
  state.routeIndex = routeIndex;
  state.segmentIndex = Math.max(0, routeIndex);
  state.rawPoints = rawPoints.length ? rawPoints : routePoints;
  state.rawCells = rawCells;
  state.projectedPoint = cloneRuntimeRoutePoint(runtimeRoute.projectedPoint) || routePoints[Math.min(routeIndex, routePoints.length - 1)] || routePoints[0];
  state.pursuitTarget = nextPoint;
  state.rerouteFrom = cloneRuntimeRoutePoint(runtimeRoute.rerouteFrom);
  state.blockedPoint = cloneRuntimeRoutePoint(runtimeRoute.blockedPoint);
  state.waitPoint = cloneRuntimeRoutePoint(runtimeRoute.waitPoint);
  state.waitingForTraffic = runtimeRoute.waitingForTraffic === true;
  state.lastPlanReason = String(runtimeRoute.reason || runtimeRoute.source || 'server-runtime-route');
  state.active = true;
  state.runtimeDebugHydrated = true;
  state.revision = (Number(state.revision) || 0) + 1;
  return true;
}

export function updateDynamicExteriorRouting(agent, target, dtMs = 16, options = {}) {
  const cfg = { ...DYNAMIC_EXTERIOR_ROUTING, ...options };
  if (!cfg.enabled || !agent || !target) {
    clearDynamicExteriorRoutingForAgent(agent?.id);
    return { active: false, effectiveTarget: target, reason: 'disabled' };
  }

  const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
  const state = ensureAgentState(agent.id);
  const targetKey = makeTargetKey(target);
  const goalDistance = pointDistance(agent, target);
  const recoveryAvoidPoint = cloneRuntimeRoutePoint(options.recoveryAvoidPoint || options.blockedPoint || null);
  const dynamicAvoidZones = Array.isArray(options.dynamicAvoidZones) ? options.dynamicAvoidZones : [];
  const forcedRecoveryReason = options.forceRecoveryReplan === true && recoveryAvoidPoint
    ? String(options.recoveryReason || options.blockedReason || 'server-static-recovery')
    : null;
  if (recoveryAvoidPoint) {
    const blockageKey = `${forcedRecoveryReason || 'server-recovery'}:${Number(recoveryAvoidPoint.x || 0).toFixed(1)}:${Number(recoveryAvoidPoint.y || 0).toFixed(1)}`;
    state.blockedReasonMs = state.blockedReasonKey === blockageKey ? state.blockedReasonMs + dtMs : dtMs;
    state.blockedReasonKey = blockageKey;
    state.blockedPoint = clonePoint2(recoveryAvoidPoint);
    state.blockedReason = forcedRecoveryReason || String(options.blockedReason || 'server-static-recovery');
    if (forcedRecoveryReason) state.replanSettleUntilMs = 0;
  }
  const progressWindowMs = Math.max(120, Number(cfg.progressSampleWindowMs) || 280);
  const progressSampleMinGainApi = Math.max(0.15, Number(cfg.progressSampleMinGainApi) || 0.8);
  if (state.progressWindowStartDistance == null) {
    state.progressWindowStartDistance = goalDistance;
    state.progressWindowMs = 0;
    state.poorProgressMs = 0;
  } else {
    state.progressWindowMs += dtMs;
    if (state.progressWindowMs >= progressWindowMs) {
      const progress = state.progressWindowStartDistance - goalDistance;
      state.poorProgressMs = progress >= progressSampleMinGainApi ? 0 : (state.poorProgressMs + state.progressWindowMs);
      state.progressWindowStartDistance = goalDistance;
      state.progressWindowMs = 0;
    }
  }
  state.lastGoalDistance = goalDistance;

  const currentPos = { x: agent.x, y: agent.y };
  if (state.lastMotionSample) {
    const movedApi = pointDistance(currentPos, state.lastMotionSample);
    const motionThreshold = Math.max(0.2, Number(cfg.minMotionDistanceApi) || 0.6);
    if (!state.waitingForTraffic && goalDistance > Math.max(cfg.waypointReachApi * 1.25, 6) && movedApi < motionThreshold) {
      state.noMotionMs += dtMs;
    } else {
      state.noMotionMs = 0;
      if (movedApi >= motionThreshold * 0.9) {
        state.rerouteAttempts = 0;
        state.rerouteAvoidPoint = null;
        state.rerouteAvoidRadiusWorld = 0;
      }
    }
  } else {
    state.noMotionMs = 0;
  }
  state.lastMotionSample = currentPos;

  const replanReason = forcedRecoveryReason || shouldReplan(state, nowMs, targetKey, goalDistance, cfg);
  if (replanReason) {
    const isRecoveryReplan = replanReason !== 'initial-route' && replanReason !== 'target-changed' && replanReason !== 'route-stale';
    if (isRecoveryReplan) {
      state.rerouteAttempts = Math.max(1, (state.rerouteAttempts || 0) + 1);
      const candidateAvoidPoint = clonePoint2(state.blockedPoint || currentPos);
      const keepExistingAvoid = !!(
        state.rerouteAvoidPoint &&
        (nowMs - (Number(state.lastRecoveryPlanAtMs) || 0)) <= Math.max(250, Number(cfg.rerouteAvoidStickMs) || 1800) &&
        pointDistance(candidateAvoidPoint, state.rerouteAvoidPoint) <= worldToApi(Math.max(0.2, Number(cfg.rerouteAvoidStickDistanceWorld) || 0.85))
      );
      state.rerouteAvoidPoint = keepExistingAvoid ? clonePoint2(state.rerouteAvoidPoint) : candidateAvoidPoint;
      const baseRadius = Math.max(0.3, Number(cfg.stuckAvoidRadiusWorld) || 0.6);
      const growth = Math.max(0, Number(cfg.stuckAvoidRadiusGrowthWorld) || 0.22);
      const maxRadius = Math.max(baseRadius, Number(cfg.stuckAvoidMaxRadiusWorld) || 1.5);
      state.rerouteAvoidRadiusWorld = Math.min(maxRadius, baseRadius + growth * Math.max(0, state.rerouteAttempts - 1));
    } else {
      state.rerouteAttempts = 0;
      state.rerouteAvoidPoint = null;
      state.rerouteAvoidRadiusWorld = 0;
    }

    const planned = planRoute({ x: agent.x, y: agent.y }, target, cfg, agent.id, {
      avoidPoint: state.rerouteAvoidPoint,
      avoidRadiusWorld: state.rerouteAvoidRadiusWorld,
      dynamicAvoidZones,
    });
    if (!planned?.route?.length || !planned.routeSegments?.length) {
      state.lastPlanAtMs = nowMs;
      state.lastPlanReason = `${replanReason}-failed`;
      if (!state.route?.length || !state.routeSegments?.length) {
        state.active = false;
        return { active: false, effectiveTarget: target, reason: 'route-failed' };
      }
    } else {
    state.routePoints = planned.points;
    state.route = planned.route;
    state.routeSegments = planned.routeSegments;
    state.rawPoints = planned.rawPoints;
    state.rawCells = planned.rawCells || [];
    state.destinationHandoff = planned.destinationHandoff || null;
    state.routeIndex = 0;
    state.segmentIndex = 0;
    state.targetKey = targetKey;
    state.lastPlanAtMs = nowMs;
    state.lastPlanReason = replanReason;
    state.lastRouteProgressAtMs = nowMs;
    state.projectedPoint = clonePoint2(planned.points[0]);
    state.projectedDistance = 0;
    state.projectedDistanceAlong = 0;
    state.lastProjectedDistanceAlong = 0;
    state.stalledRouteProgressMs = 0;
    state.progressWindowMs = 0;
    state.progressWindowStartDistance = goalDistance;
    state.pursuitTarget = planned.route[0];
    state.lateralOffset = 0;
    state.corridorViolationMs = 0;
    state.noMotionMs = 0;
    state.waitingForTraffic = false;
    state.waitPoint = null;
    state.blockedPoint = null;
    state.blockedReason = null;
    state.blockedReasonKey = null;
    state.blockedReasonMs = 0;
    state.lastRecoveryPlanAtMs = isRecoveryReplan ? nowMs : 0;
    state.replanSettleUntilMs = isRecoveryReplan ? (nowMs + Math.max(250, Number(cfg.recoveryReplanSettleMs) || 950)) : 0;
    state.revision += 1;
    state.active = true;
    if (replanReason !== 'initial-route') {
      state.rerouteFrom = { x: agent.x, y: agent.y };
      state.rerouteUntilMs = nowMs + cfg.rerouteMarkerMs;
    } else {
      state.rerouteFrom = null;
      state.rerouteUntilMs = 0;
    }
  }
  }

  if (!state.route?.length || !state.routeSegments?.length) return { active: false, effectiveTarget: target, reason: 'no-route' };

  const previousDistanceAlong = Number(state.projectedDistanceAlong) || 0;
  const projection = advanceRouteProgress(state, agent, cfg);
  const routeAdvance = (state.projectedDistanceAlong || 0) - previousDistanceAlong;
  if (routeAdvance > Math.max(0.35, cfg.progressEpsilonApi * 0.08)) {
    state.lastRouteProgressAtMs = nowMs;
    state.stalledRouteProgressMs = 0;
    state.noMotionMs = 0;
    state.rerouteAttempts = 0;
    state.rerouteAvoidPoint = null;
    state.rerouteAvoidRadiusWorld = 0;
  } else {
    state.stalledRouteProgressMs += dtMs;
  }
  state.lastProjectedDistanceAlong = state.projectedDistanceAlong || 0;
  const corridorHalfWidthApi = Math.max(1, worldToApi(Number(cfg.corridorHalfWidthWorld) || 0.5));
  if ((state.projectedDistance || 0) > corridorHalfWidthApi * 1.12) {
    state.corridorViolationMs += dtMs;
  } else {
    state.corridorViolationMs = 0;
  }

  const blockage = isUpcomingRouteBlocked(agent, state, cfg);
  const blockageKey = blockage?.point
    ? `${blockage.reason || 'blocked'}:${Number(blockage.point.x || 0).toFixed(1)}:${Number(blockage.point.y || 0).toFixed(1)}`
    : null;
  if (blockageKey) {
    state.blockedReasonMs = state.blockedReasonKey === blockageKey ? (state.blockedReasonMs + dtMs) : dtMs;
    state.blockedReasonKey = blockageKey;
  } else {
    state.blockedReasonMs = 0;
    state.blockedReasonKey = null;
  }
  state.blockedPoint = blockage?.point ? clonePoint2(blockage.point) : null;
  state.blockedReason = blockage?.reason || null;

  const pursuitPoint = getLookaheadPointOnRoute(state, cfg) || state.route[state.routeIndex] || target;
  let effectiveTarget = applyCorridorCenterBias(agent, pursuitPoint, state, cfg);
  state.waitingForTraffic = false;
  state.waitPoint = null;

  const handoff = state.destinationHandoff || null;
  const insideHandoffBuilding = !!(
    handoff?.kind === 'doorway' &&
    handoff?.buildingId &&
    _helpers.getInteriorBuildingAt?.(agent.x, agent.y)?.id === handoff.buildingId
  );
  if (handoff?.kind === 'doorway' && !insideHandoffBuilding) {
    const lastRouteIdx = Math.max(0, (state.route?.length || 1) - 1);
    const doorwayReachApi = Math.max(Number(handoff.reachApi) || 0, Number(cfg.waypointReachApi) || 6);
    const distToDoorway = pointDistance(agent, handoff.doorway);
    const pursuitDoorDistance = pointDistance(pursuitPoint, handoff.doorway);
    const onFinalApproach =
      (state.routeIndex || 0) >= Math.max(0, lastRouteIdx - 1) ||
      distToDoorway <= Math.max(doorwayReachApi * 1.8, 18) ||
      pursuitDoorDistance <= Math.max(doorwayReachApi * 1.4, 12);

    if (onFinalApproach) {
      effectiveTarget = clonePoint2(handoff.doorway);
      state.routeIndex = lastRouteIdx;
      if (Array.isArray(state.routeSegments) && state.routeSegments.length) {
        state.segmentIndex = Math.max(0, state.routeSegments.length - 1);
        state.projectedDistanceAlong = Math.max(
          state.projectedDistanceAlong || 0,
          state.routeSegments[Math.max(0, state.routeSegments.length - 1)]?.startDistance || 0,
        );
      }
    }
  }

  const roadEntry = findUpcomingRoadEntry(agent, effectiveTarget, cfg);
  if (roadEntry && shouldYieldForTraffic(roadEntry, cfg)) {
    state.waitingForTraffic = true;
    state.waitPoint = pointDistance(agent, roadEntry.entryPoint) <= cfg.roadEntryHoldApi ? clonePoint2(agent) : roadEntry.entryPoint;
    effectiveTarget = state.waitPoint;
  }

  state.pursuitTarget = clonePoint2(effectiveTarget);
  const priorityHint = buildRoutePriorityHint(agent, state, cfg);

  return {
    active: true,
    effectiveTarget,
    priorityHint,
    reason: state.waitingForTraffic
      ? 'waiting-for-traffic'
      : (handoff?.kind === 'doorway' && !insideHandoffBuilding && pointDistance(effectiveTarget, handoff.doorway) <= Math.max((Number(handoff.reachApi) || 0) * 0.25, 0.5)
          ? 'door-approach'
          : (pointDistance(effectiveTarget, pursuitPoint) <= 0.001 ? (state.lastPlanReason || 'active-route') : 'door-handoff')),
    routeIndex: state.routeIndex,
    segmentIndex: state.segmentIndex,
    revision: state.revision,
    route: state.route,
    routePoints: state.routePoints,
    rawPoints: state.rawPoints,
    rawCells: state.rawCells,
    projectedPoint: state.projectedPoint,
    pursuitTarget: state.pursuitTarget,
    rerouteFrom: (state.rerouteUntilMs > nowMs) ? state.rerouteFrom : null,
    lateralOffset: state.lateralOffset,
    corridorViolationMs: state.corridorViolationMs,
    stalledRouteProgressMs: state.stalledRouteProgressMs,
    blockedPoint: state.blockedPoint,
    blockedReason: state.blockedReason,
    recoveryAvoidPoint: state.rerouteAvoidPoint,
    recoveryAvoidRadiusWorld: state.rerouteAvoidRadiusWorld,
    waitingForTraffic: state.waitingForTraffic,
    waitPoint: state.waitPoint,
    destinationHandoff: state.destinationHandoff,
    projection,
  };
}

function disposeGroupChildren(group) {
  if (!group) return;
  while (group.children.length) {
    const child = group.children.pop();
    if (!child) continue;
    child.parent?.remove(child);
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
}

function ensureDebugGroup(agentId) {
  if (!_helpers.scene) return null;
  let group = _debugGroups.get(agentId);
  if (group) return group;
  group = new THREE.Group();
  group.name = `dynamicExteriorRoute_${agentId}`;
  group.renderOrder = 995;
  _helpers.scene.add(group);
  _debugGroups.set(agentId, group);
  return group;
}

function buildPolyline(points, color, opacity, renderOrder = 996) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
  );
  line.renderOrder = renderOrder;
  return line;
}

function buildDebugRoute(group, agent, state, cfg) {
  disposeGroupChildren(group);
  if (!state?.routePoints?.length) return;
  const apiScale = _helpers.apiToWorldScale || 1 / 40;
  const rawPreview = Array.isArray(state.rawPoints) ? state.rawPoints.slice(0, cfg.maxPreviewTiles) : [];
  const rawCellsPreview = Array.isArray(state.rawCells) ? state.rawCells.slice(0, cfg.maxPreviewTiles) : [];
  const routePreview = Array.isArray(state.routePoints) ? state.routePoints.slice(0, cfg.maxPreviewPoints) : [];

  rawCellsPreview.forEach((cell, idx) => {
    const tile = new THREE.Mesh(
      _floorTileGeo.clone(),
      new THREE.MeshBasicMaterial({ color: 0x39485f, transparent: true, opacity: 0.09, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.scale.set(0.48, 0.48, 1);
    tile.position.set(cell.x + 0.5, 0.035 + idx * 0.00008, cell.z + 0.5);
    tile.renderOrder = 995;
    group.add(tile);
  });

  rawPreview.forEach((point, idx) => {
    const tile = new THREE.Mesh(
      _floorTileGeo.clone(),
      new THREE.MeshBasicMaterial({ color: 0x4b566a, transparent: true, opacity: 0.08, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.scale.set(0.46, 0.46, 1);
    tile.position.set(point.x * apiScale, 0.04 + idx * 0.0001, point.y * apiScale);
    tile.renderOrder = 995;
    group.add(tile);
  });

  const rawLine = buildPolyline(rawPreview.map((p, idx) => new THREE.Vector3(p.x * apiScale, 0.05 + idx * 0.0004, p.y * apiScale)), 0x7184a7, 0.45, 996);
  if (rawLine) group.add(rawLine);
  const routeLine = buildPolyline(routePreview.map((p, idx) => new THREE.Vector3(p.x * apiScale, 0.076 + idx * 0.0007, p.y * apiScale)), 0x7cc6ff, 0.92, 997);
  if (routeLine) group.add(routeLine);

  if (state.projectedPoint) {
    const projected = new THREE.Mesh(_markerGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff6d6d, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false }));
    projected.position.set(state.projectedPoint.x * apiScale, 0.08, state.projectedPoint.y * apiScale);
    projected.renderOrder = 998;
    group.add(projected);

    if (agent) {
      const centerLine = buildPolyline([
        new THREE.Vector3((agent.x || 0) * apiScale, 0.085, (agent.y || 0) * apiScale),
        new THREE.Vector3(state.projectedPoint.x * apiScale, 0.085, state.projectedPoint.y * apiScale),
      ], 0xff7a7a, 0.72, 998);
      if (centerLine) group.add(centerLine);
    }
  }

  if (state.pursuitTarget) {
    const pursuit = new THREE.Mesh(_targetGeo.clone(), new THREE.MeshBasicMaterial({ color: state.waitingForTraffic ? 0xff9800 : 0x66ff99, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }));
    pursuit.position.set(state.pursuitTarget.x * apiScale, 0.074, state.pursuitTarget.y * apiScale);
    pursuit.renderOrder = 998;
    group.add(pursuit);
  }

  if (state.rerouteFrom) {
    const reroute = new THREE.Mesh(_markerGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff5c8a, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
    reroute.position.set(state.rerouteFrom.x * apiScale, 0.082, state.rerouteFrom.y * apiScale);
    reroute.renderOrder = 998;
    group.add(reroute);
  }

  if (state.blockedPoint) {
    const blocked = new THREE.Mesh(_targetGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff3d00, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }));
    blocked.position.set(state.blockedPoint.x * apiScale, 0.078, state.blockedPoint.y * apiScale);
    blocked.renderOrder = 998;
    group.add(blocked);
  }

  if (state.waitPoint) {
    const wait = new THREE.Mesh(_markerGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.84, depthTest: false, depthWrite: false }));
    wait.position.set(state.waitPoint.x * apiScale, 0.081, state.waitPoint.y * apiScale);
    wait.renderOrder = 998;
    group.add(wait);
  }

  const nextPoint = state.route?.[Math.max(0, Math.min(state.routeIndex || 0, Math.max(0, (state.route?.length || 1) - 1)))] || null;
  if (nextPoint) {
    const nextMarker = new THREE.Mesh(_markerGeo.clone(), new THREE.MeshBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.84, depthTest: false, depthWrite: false }));
    nextMarker.position.set(nextPoint.x * apiScale, 0.079, nextPoint.y * apiScale);
    nextMarker.renderOrder = 998;
    group.add(nextMarker);
  }

  const finalPoint = state.route[state.route.length - 1] || null;
  if (finalPoint) {
    const targetMarker = new THREE.Mesh(_targetGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
    targetMarker.position.set(finalPoint.x * apiScale, 0.07, finalPoint.y * apiScale);
    targetMarker.renderOrder = 998;
    group.add(targetMarker);
  }
}

export function updateDynamicExteriorRoutingDebug(agent, options = {}) {
  const debugOn = options.debug !== undefined ? !!options.debug : !!DYNAMIC_EXTERIOR_ROUTING.debug;
  if (!debugOn) {
    // PERF: never create groups or allocate cfg objects when overlays are off.
    const existing = _debugGroups.get(agent?.id);
    if (existing) existing.visible = false;
    return;
  }
  const cfg = { ...DYNAMIC_EXTERIOR_ROUTING, ...options };
  const group = ensureDebugGroup(agent?.id);
  if (!group) return;
  const state = _agentState.get(agent?.id) || null;
  if (!state?.active || !state.routePoints?.length) {
    group.visible = false;
    return;
  }
  group.visible = true;
  buildDebugRoute(group, agent, state, cfg);
}

export function clearDynamicExteriorRoutingDebug(agentId = null) {
  if (agentId == null) {
    for (const group of _debugGroups.values()) {
      disposeGroupChildren(group);
      group.parent?.remove(group);
    }
    _debugGroups.clear();
    return;
  }
  const group = _debugGroups.get(agentId);
  if (!group) return;
  disposeGroupChildren(group);
  group.parent?.remove(group);
  _debugGroups.delete(agentId);
}
