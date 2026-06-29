import * as THREE from 'three';
import {
  buildCollisionRegistry,
  resolvePlacedCollisionBounds,
} from './agent-life-collision-registry.mjs?v=20260428-phase0_5-task4';

export const DYNAMIC_INTERIOR_ROUTING = {
  enabled: true,
  // PERF: debug route overlays default OFF (Settings → movement debug overlays).
  debug: false,
  gridCellSizeWorld: 0.55,
  wallClearanceWorld: 0.18,
  obstaclePaddingWorld: 0.18,
  waypointReachApi: 5,
  replanCooldownMs: 350,
  staleRouteMs: 5000,
  poorProgressMs: 900,
  progressEpsilonApi: 3,
  maxPreviewCells: 48,
  maxPreviewWaypoints: 24,
  rerouteMarkerMs: 1400,
  routePriorityLookahead: 2,
  routePriorityWeight: 0.32,
  routePriorityTargetWeight: 0.58,
  routePriorityScoreBoost: 6.5,
  routePriorityBacktrackPenalty: 7.5,
  lineOfSightStepWorld: 0.16,
  routeLookaheadWorld: 1.15,
  routeLookaheadMinPoints: 1,
  segmentAdvanceDotThreshold: 0.9,
  segmentAdvanceDistanceWorld: 0.18,
  cornerRoundRadiusWorld: 0.42,
  cornerRoundMinAngleDeg: 22,
  cornerRoundSegments: 3,
  corridorHalfWidthWorld: 0.42,
  centerBiasStrength: 0.28,
  maxStringPullSkip: 14,
};

const _helpers = {
  scene: null,
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: null,
};

const _buildingCache = new Map();
const _agentState = new Map();
const _debugGroups = new Map();

const _floorTileGeo = new THREE.PlaneGeometry(0.42, 0.42);
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

function pointDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function pointDistanceSq(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return dx * dx + dy * dy;
}

function normalizeRotationDeg(deg = 0) {
  return ((deg % 360) + 360) % 360;
}

function normalizeVec2(x = 0, y = 0) {
  const len = Math.hypot(x, y);
  if (len <= 0.000001) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
}

function blendVec2(primary, secondary, primaryWeight = 0.6) {
  const a = clamp(primaryWeight, 0, 1);
  const b = 1 - a;
  return normalizeVec2(
    (primary?.x || 0) * a + (secondary?.x || 0) * b,
    (primary?.y || 0) * a + (secondary?.y || 0) * b,
  );
}

function clonePoint2(point) {
  return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
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
    if (pointDistance(points[i], out[out.length - 1]) > minDistance) {
      out.push(clonePoint2(points[i]));
    }
  }
  return out;
}

function getBuildingLocalPoint(building, worldX, worldZ) {
  const baseX = (building?.worldX || 0);
  const baseZ = (building?.worldY || 0);
  const bw = (building?.widthTiles || 25);
  const bd = (building?.heightTiles || 17);
  const rot = normalizeRotationDeg(building?._rotation || 0);
  const relX = worldX - baseX;
  const relZ = worldZ - baseZ;

  if (rot === 90) return { x: relZ, z: bd - relX };
  if (rot === 180) return { x: bw - relX, z: bd - relZ };
  if (rot === 270) return { x: bw - relZ, z: relX };
  return { x: relX, z: relZ };
}

function getBuildingWorldPoint(building, localX, localZ) {
  const baseX = (building?.worldX || 0);
  const baseZ = (building?.worldY || 0);
  const bw = (building?.widthTiles || 25);
  const bd = (building?.heightTiles || 17);
  const rot = normalizeRotationDeg(building?._rotation || 0);
  let x = baseX + localX;
  let z = baseZ + localZ;

  if (rot === 90) {
    x = baseX + bd - localZ;
    z = baseZ + localX;
  } else if (rot === 180) {
    x = baseX + bw - localX;
    z = baseZ + bd - localZ;
  } else if (rot === 270) {
    x = baseX + localZ;
    z = baseZ + bw - localX;
  }
  return { x, z };
}

function makeRect(cx, cz, halfW, halfD, rotationDeg = 0, type = 'rect') {
  return { type, cx, cz, halfW, halfD, rotationDeg: normalizeRotationDeg(rotationDeg || 0) };
}

function makeWall(x1, z1, x2, z2, thickness = 0.2) {
  return { type: 'wall', x1, z1, x2, z2, thickness };
}

function makeObstacleLayoutSignature(building) {
  const payload = {
    id: building?.id,
    worldX: building?.worldX,
    worldY: building?.worldY,
    widthTiles: building?.widthTiles,
    heightTiles: building?.heightTiles,
    type: building?.type,
    routingFloor: Math.max(1, Number(building?._routingFloor || 1) || 1),
    rotation: normalizeRotationDeg(building?._rotation || 0),
    walls: (building?.interior?.walls || []).map((w) => ({
      x1: Number(w.x1 || 0),
      z1: Number(w.z1 || 0),
      x2: Number(w.x2 || 0),
      z2: Number(w.z2 || 0),
      type: w.type || 'wall',
    })),
    furniture: (building?.interior?.furniture || []).map((f) => ({
      type: f.type || 'unknown',
      x: Number(f.x || 0),
      z: Number(f.z || 0),
      rotation: normalizeRotationDeg(f.rotation || 0),
    })),
    elevator: building?.elevator ? {
      x: Number(building.elevator.x || 0),
      z: Number(building.elevator.z || 0),
      width: Number(building.elevator.width || 2.8),
      depth: Number(building.elevator.depth || 2.8),
    } : null,
  };
  return JSON.stringify(payload);
}

const DYNAMIC_INTERIOR_COLLISION_HALF_SIZES = Object.freeze({
  desk: [0.85, 0.45],
  chair: [0.22, 0.22],
  officeChair: [0.32, 0.36],
  conferenceChair: [0.34, 0.44],
  receptionDesk: [1.45, 0.82],
  printerCopier: [0.72, 0.58],
  couch: [1.55, 0.55],
  armchair: [0.58, 0.64],
  hallwayBench: [0.95, 0.42],
  barStool: [0.32, 0.32],
  diningChair: [0.36, 0.42],
  patioChair: [0.40, 0.46],
  bed: [1.25, 1.48],
  clinicBed: [0.82, 1.35],
  bookshelf: [0.7, 0.32],
  curtains: [0.9, 0.16],
  whiteboard: [0.78, 0.12],
  bulletinBoard: [0.86, 0.12],
  wallArt: [0.72, 0.08],
  menuBoard: [0.74, 0.14],
  teachingPodium: [0.62, 0.46],
  plant: [0.18, 0.18],
  counter: [1.0, 0.4],
  checkoutCounter: [1.45, 0.58],
  diningTable: [1.65, 1.25],
  smallCafeTable: [0.72, 0.72],
  outdoorCafeTable: [0.80, 0.80],
  picnicTable: [1.28, 0.82],
  patioTable: [0.92, 0.82],
  smallRoundMeetingTable: [0.9, 0.9],
  sink: [1.05, 0.48],
  stove: [0.55, 0.48],
  vending: [0.32, 0.28],
  tv: [0.35, 0.12],
  dartboard: [0.28, 0.08],
  pingpong: [1.35, 0.78],
  // Meeting Room Table uses the solid tabletop footprint only. Chairs/seats are
  // integrated visual/interaction details, so route targets around the table stay reachable.
  meetingTable: [2.15, 1.05],
  cooler: [0.25, 0.25],
});
const DYNAMIC_INTERIOR_COLLISION_REGISTRY = buildCollisionRegistry({
  halfSizes: DYNAMIC_INTERIOR_COLLISION_HALF_SIZES,
});

function getManualFurnitureCollisionRect(building, item, index) {
  const collision = resolvePlacedCollisionBounds({
    item,
    building,
    index,
    halfSizes: DYNAMIC_INTERIOR_COLLISION_HALF_SIZES,
    registry: DYNAMIC_INTERIOR_COLLISION_REGISTRY,
    coordinateSpace: 'building-local',
    includeBuildingRotation: false,
  });
  if (!collision.routing?.blocksPathfinding) return null;
  const bound = collision.bounds.find(candidate => candidate.shape === 'rect');
  if (!bound || bound.halfW <= 0 || bound.halfD <= 0) return null;
  return {
    halfW: bound.halfW,
    halfD: bound.halfD,
    x: bound.offset.x,
    z: bound.offset.z,
    rotation: bound.rotationDeg,
    type: collision.assetId || item?.type || 'manual',
  };
}

function collectFurnitureObstacles(building) {
  const out = [];
  const bw = (building?.widthTiles || 25);
  const bd = (building?.heightTiles || 17);
  const btype = building?.type || 'office';

  for (const [index, item] of (building?.interior?.furniture || []).entries()) {
    const rect = getManualFurnitureCollisionRect(building, item, index);
    if (!rect) continue;
    out.push(makeRect(rect.x, rect.z, rect.halfW, rect.halfD, rect.rotation, rect.type));
  }

  if (btype === 'office') {
    const deskSpacing = 5;
    const deskMargin = 3;
    const rows = Math.max(1, Math.floor((bd - deskMargin * 2) / deskSpacing));
    const cols = Math.max(1, Math.floor((bw - deskMargin * 2) / deskSpacing));
    const deskCap = Math.min(8, rows * cols);
    let count = 0;
    for (let r = 0; r < rows && count < deskCap; r++) {
      for (let c = 0; c < cols && count < deskCap; c++) {
        const dx = deskMargin + c * deskSpacing;
        const dz = deskMargin + r * deskSpacing;
        if (dx < bw - 2 && dz < bd - 3) {
          out.push(makeRect(dx, dz, 0.95, 0.5, 0, 'auto-desk'));
          count += 1;
        }
      }
    }
    if (bw > 12) out.push(makeRect(bw * 0.7, 1.5, 2.0, 1.0, 0, 'meeting-table'));
  } else if (btype === 'store') {
    const shelfSpacing = 4;
    const shelfRows = Math.min(2, Math.floor((bd - 6) / shelfSpacing));
    const shelfCols = Math.min(3, Math.floor((bw - 4) / 3.5));
    let count = 0;
    for (let r = 0; r < shelfRows; r++) {
      for (let c = 0; c < shelfCols && count < 6; c++) {
        const sx = 2 + c * 3.5;
        const sz = 3 + r * shelfSpacing;
        if (sx < bw - 2 && sz < bd - 4) {
          out.push(makeRect(sx, sz, 0.9, 0.35, 0, 'shelf'));
          count += 1;
        }
      }
    }
    out.push(makeRect(bw / 2, bd - 2, 1.8, 0.45, 0, 'counter'));
  } else if (btype === 'home') {
    out.push(makeRect(bw / 2, bd * 0.35, 1.55, 0.55, 0, 'couch'));
    out.push(makeRect(bw * 0.2, 1, 1.0, 0.75, 0, 'bed'));
  }

  return out;
}

function collectInteriorObstacles(building) {
  const obstacles = [];
  for (const wall of (building?.interior?.walls || [])) {
    obstacles.push(makeWall(Number(wall.x1 || 0), Number(wall.z1 || 0), Number(wall.x2 || 0), Number(wall.z2 || 0), 0.2));
  }
  const e = building?.elevator || null;
  if (e && Number(e.width) > 0 && Number(e.depth) > 0) {
    const x = Number(e.x || 0);
    const z = Number(e.z || 0);
    const hw = Number(e.width || 2.8) / 2;
    const hd = Number(e.depth || 2.8) / 2;
    // Elevator is a solid shaft with an open/front doorway. Route around back/side shaft walls.
    obstacles.push(makeWall(x - hw, z - hd, x + hw, z - hd, 0.22)); // back
    obstacles.push(makeWall(x - hw, z - hd, x - hw, z + hd, 0.22)); // left
    obstacles.push(makeWall(x + hw, z - hd, x + hw, z + hd, 0.22)); // right
  }
  obstacles.push(...collectFurnitureObstacles(building));
  return obstacles;
}

function pointSegDist(px, pz, x1, z1, x2, z2) {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const len2 = vx * vx + vz * vz;
  if (len2 <= 0.000001) return Math.hypot(px - x1, pz - z1);
  const t = clamp(((px - x1) * vx + (pz - z1) * vz) / len2, 0, 1);
  const projX = x1 + vx * t;
  const projZ = z1 + vz * t;
  return Math.hypot(px - projX, pz - projZ);
}

function pointInRotatedRect(px, pz, rect, padding = 0) {
  const dx = px - rect.cx;
  const dz = pz - rect.cz;
  const rad = -(rect.rotationDeg || 0) * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= (rect.halfW + padding) && Math.abs(lz) <= (rect.halfD + padding);
}

function isBlockedLocal(building, obstacles, localX, localZ, cfg) {
  const bw = (building?.widthTiles || 25);
  const bd = (building?.heightTiles || 17);
  const wallInset = (cfg.wallClearanceWorld || 0.18) + 0.03;
  if (localX <= wallInset || localX >= bw - wallInset || localZ <= wallInset || localZ >= bd - wallInset) return true;

  for (const obstacle of obstacles) {
    if (obstacle.type === 'wall') {
      if (pointSegDist(localX, localZ, obstacle.x1, obstacle.z1, obstacle.x2, obstacle.z2) <= ((obstacle.thickness || 0.2) * 0.5 + cfg.obstaclePaddingWorld)) {
        return true;
      }
    } else if (pointInRotatedRect(localX, localZ, obstacle, cfg.obstaclePaddingWorld)) {
      return true;
    }
  }
  return false;
}

function buildGrid(building, cfg) {
  const signature = makeObstacleLayoutSignature(building);
  const cached = _buildingCache.get(building.id);
  if (cached && cached.signature === signature) return cached;

  const cellSize = cfg.gridCellSizeWorld || 0.55;
  const bw = (building?.widthTiles || 25);
  const bd = (building?.heightTiles || 17);
  const cols = Math.max(1, Math.ceil(bw / cellSize));
  const rows = Math.max(1, Math.ceil(bd / cellSize));
  const blocked = new Uint8Array(cols * rows);
  const obstacles = collectInteriorObstacles(building);

  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const localX = Math.min(bw - cellSize * 0.5, (x + 0.5) * cellSize);
      const localZ = Math.min(bd - cellSize * 0.5, (z + 0.5) * cellSize);
      blocked[z * cols + x] = isBlockedLocal(building, obstacles, localX, localZ, cfg) ? 1 : 0;
    }
  }

  const payload = {
    signature,
    cellSize,
    cols,
    rows,
    blocked,
    obstacles,
    bw,
    bd,
    index: (x, z) => z * cols + x,
    center: (x, z) => ({
      x: Math.min(bw - cellSize * 0.5, (x + 0.5) * cellSize),
      z: Math.min(bd - cellSize * 0.5, (z + 0.5) * cellSize),
    }),
  };
  _buildingCache.set(building.id, payload);
  return payload;
}

function findNearestOpenCell(grid, localX, localZ) {
  const startX = clamp(Math.floor(localX / grid.cellSize), 0, grid.cols - 1);
  const startZ = clamp(Math.floor(localZ / grid.cellSize), 0, grid.rows - 1);
  if (!grid.blocked[grid.index(startX, startZ)]) return { x: startX, z: startZ };

  const maxRadius = Math.max(grid.cols, grid.rows);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const x = startX + dx;
        const z = startZ + dz;
        if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
        if (!grid.blocked[grid.index(x, z)]) return { x, z };
      }
    }
  }
  return null;
}

function simplifyCellPath(path) {
  if (!Array.isArray(path) || path.length <= 2) return path || [];
  const simplified = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    const dx1 = curr.x - prev.x;
    const dz1 = curr.z - prev.z;
    const dx2 = next.x - curr.x;
    const dz2 = next.z - curr.z;
    if (dx1 !== dx2 || dz1 !== dz2) simplified.push(curr);
  }
  simplified.push(path[path.length - 1]);
  return simplified;
}

function hasLineOfSightLocal(building, obstacles, ax, az, bx, bz, cfg) {
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist <= 0.0001) return true;
  const step = Math.max(0.05, Number(cfg.lineOfSightStepWorld) || 0.16);
  const steps = Math.max(2, Math.ceil(dist / step));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    if (isBlockedLocal(building, obstacles, px, pz, cfg)) return false;
  }
  return true;
}

function buildLocalAnchorPath(grid, cells, startLocal, targetLocal) {
  const anchors = [
    { x: Number(startLocal?.x) || 0, y: Number(startLocal?.z) || 0 },
  ];
  const inner = Array.isArray(cells) ? cells.slice(1, -1) : [];
  for (const cell of inner) {
    const center = grid.center(cell.x, cell.z);
    anchors.push({ x: center.x, y: center.z });
  }
  anchors.push({ x: Number(targetLocal?.x) || 0, y: Number(targetLocal?.z) || 0 });
  return dedupePoints(anchors, 0.001);
}

function stringPullRoute(building, grid, anchors, cfg) {
  if (!Array.isArray(anchors) || anchors.length <= 2) return anchors || [];
  const out = [clonePoint2(anchors[0])];
  let anchorIdx = 0;
  const maxSkip = Math.max(2, Math.round(Number(cfg.maxStringPullSkip) || 14));
  while (anchorIdx < anchors.length - 1) {
    let furthest = anchorIdx + 1;
    const maxTarget = Math.min(anchors.length - 1, anchorIdx + maxSkip);
    for (let j = anchorIdx + 1; j <= maxTarget; j++) {
      const visible = hasLineOfSightLocal(
        building,
        grid.obstacles,
        anchors[anchorIdx].x,
        anchors[anchorIdx].y,
        anchors[j].x,
        anchors[j].y,
        cfg,
      );
      if (!visible) break;
      furthest = j;
    }
    out.push(clonePoint2(anchors[furthest]));
    if (furthest === anchorIdx) break;
    anchorIdx = furthest;
  }
  return dedupePoints(out, 0.001);
}

function roundRouteCorners(building, grid, points, cfg) {
  if (!Array.isArray(points) || points.length <= 2) return points || [];
  const radius = Math.max(0, Number(cfg.cornerRoundRadiusWorld) || 0.42);
  const minTurnDeg = Math.max(0, Number(cfg.cornerRoundMinAngleDeg) || 22);
  const roundSegments = Math.max(2, Math.round(Number(cfg.cornerRoundSegments) || 3));
  const out = [clonePoint2(points[0])];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inVec = normalizeVec2((curr.x || 0) - (prev.x || 0), (curr.y || 0) - (prev.y || 0));
    const outVec = normalizeVec2((next.x || 0) - (curr.x || 0), (next.y || 0) - (curr.y || 0));
    const inLen = pointDistance(prev, curr);
    const outLen = pointDistance(curr, next);
    const dot = clamp(inVec.x * outVec.x + inVec.y * outVec.y, -1, 1);
    const turnDeg = Math.acos(dot) * 180 / Math.PI;

    if (!inVec.len || !outVec.len || turnDeg < minTurnDeg) {
      out.push(clonePoint2(curr));
      continue;
    }

    const trim = Math.min(radius, inLen * 0.35, outLen * 0.35);
    if (trim <= 0.06) {
      out.push(clonePoint2(curr));
      continue;
    }

    const entry = {
      x: curr.x - inVec.x * trim,
      y: curr.y - inVec.y * trim,
    };
    const exit = {
      x: curr.x + outVec.x * trim,
      y: curr.y + outVec.y * trim,
    };

    const validEntry = !isBlockedLocal(building, grid.obstacles, entry.x, entry.y, cfg);
    const validExit = !isBlockedLocal(building, grid.obstacles, exit.x, exit.y, cfg);
    const validJoin = validEntry && validExit &&
      hasLineOfSightLocal(building, grid.obstacles, out[out.length - 1].x, out[out.length - 1].y, entry.x, entry.y, cfg) &&
      hasLineOfSightLocal(building, grid.obstacles, entry.x, entry.y, exit.x, exit.y, cfg) &&
      hasLineOfSightLocal(building, grid.obstacles, exit.x, exit.y, next.x, next.y, cfg);

    if (!validJoin) {
      out.push(clonePoint2(curr));
      continue;
    }

    out.push(entry);
    for (let seg = 1; seg < roundSegments; seg++) {
      const t = seg / roundSegments;
      out.push(quadraticBezierPoint(entry, curr, exit, t));
    }
    out.push(exit);
  }

  out.push(clonePoint2(points[points.length - 1]));
  return dedupePoints(out, 0.01);
}

function convertLocalAnchorsToApiPoints(building, anchors) {
  if (!Array.isArray(anchors)) return [];
  return anchors.map((anchor) => {
    const world = getBuildingWorldPoint(building, anchor.x || 0, anchor.y || 0);
    return { x: worldToApi(world.x), y: worldToApi(world.z) };
  });
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
    segments.push({
      index: segments.length,
      start,
      end,
      dir,
      length,
      startDistance: cumulative,
      endDistance: cumulative + length,
    });
    cumulative += length;
  }
  return segments;
}

function isLocalPointCellBlocked(grid, localX, localZ) {
  if (!grid) return true;
  const x = clamp(Math.floor(localX / grid.cellSize), 0, grid.cols - 1);
  const z = clamp(Math.floor(localZ / grid.cellSize), 0, grid.rows - 1);
  return !!grid.blocked[grid.index(x, z)];
}

function planRoute(building, startApi, targetApi, cfg) {
  const grid = buildGrid(building, cfg);
  const startWorld = { x: apiToWorld(startApi.x), z: apiToWorld(startApi.y) };
  const targetWorld = { x: apiToWorld(targetApi.x), z: apiToWorld(targetApi.y) };
  const startLocal = getBuildingLocalPoint(building, startWorld.x, startWorld.z);
  const targetLocal = getBuildingLocalPoint(building, targetWorld.x, targetWorld.z);
  const targetCellBlocked = isLocalPointCellBlocked(grid, targetLocal.x, targetLocal.z);
  const start = findNearestOpenCell(grid, startLocal.x, startLocal.z);
  const goal = findNearestOpenCell(grid, targetLocal.x, targetLocal.z);
  if (!start || !goal) return null;
  const goalCenter = grid.center(goal.x, goal.z);
  const goalAnchorLocal = targetCellBlocked || !hasLineOfSightLocal(building, grid.obstacles, goalCenter.x, goalCenter.z, targetLocal.x, targetLocal.z, cfg)
    ? { x: goalCenter.x, z: goalCenter.z }
    : targetLocal;

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const open = new Map();
  const closed = new Set();
  const cameFrom = new Map();
  const startKey = `${start.x},${start.z}`;
  const goalKey = `${goal.x},${goal.z}`;
  const heuristic = (x, z) => Math.hypot(goal.x - x, goal.z - z);
  open.set(startKey, { x: start.x, z: start.z, g: 0, f: heuristic(start.x, start.z) });

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
      const simplifiedCells = simplifyCellPath(rawCells);
      const rawAnchorsLocal = buildLocalAnchorPath(grid, simplifiedCells, startLocal, goalAnchorLocal);
      const stringPulledLocal = stringPullRoute(building, grid, rawAnchorsLocal, cfg);
      const roundedLocal = roundRouteCorners(building, grid, stringPulledLocal, cfg);
      const rawPoints = convertLocalAnchorsToApiPoints(building, rawAnchorsLocal);
      const points = convertLocalAnchorsToApiPoints(building, roundedLocal);
      const segments = buildRouteSegments(points);
      return {
        rawCells,
        cells: simplifiedCells,
        rawPoints,
        points,
        segments,
        localAnchors: roundedLocal,
        targetAdjusted: targetCellBlocked || goalAnchorLocal.x !== targetLocal.x || goalAnchorLocal.z !== targetLocal.z,
        adjustedTargetLocal: goalAnchorLocal,
        grid,
      };
    }

    open.delete(bestKey);
    closed.add(bestKey);

    for (const [dx, dz] of dirs) {
      const nx = bestNode.x + dx;
      const nz = bestNode.z + dz;
      if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
      if (grid.blocked[grid.index(nx, nz)]) continue;
      const nKey = `${nx},${nz}`;
      if (closed.has(nKey)) continue;
      if (dx !== 0 && dz !== 0) {
        if (grid.blocked[grid.index(bestNode.x + dx, bestNode.z)] || grid.blocked[grid.index(bestNode.x, bestNode.z + dz)]) continue;
      }
      const stepCost = (dx === 0 || dz === 0) ? 1 : Math.SQRT2;
      const tentativeG = bestNode.g + stepCost;
      const existing = open.get(nKey);
      if (!existing || tentativeG < existing.g) {
        cameFrom.set(nKey, bestKey);
        open.set(nKey, { x: nx, z: nz, g: tentativeG, f: tentativeG + heuristic(nx, nz) });
      }
    }
  }
  return null;
}

export function isDynamicInteriorRouteSegmentClear(building, startApi, endApi, options = {}) {
  if (!building || !startApi || !endApi) {
    return { clear: true, reason: 'missing-segment-context' };
  }
  const cfg = { ...DYNAMIC_INTERIOR_ROUTING, ...(options.config || options || {}) };
  try {
    const grid = buildGrid(building, cfg);
    const startWorld = { x: apiToWorld(startApi.x), z: apiToWorld(startApi.y ?? startApi.z) };
    const endWorld = { x: apiToWorld(endApi.x), z: apiToWorld(endApi.y ?? endApi.z) };
    const startLocal = getBuildingLocalPoint(building, startWorld.x, startWorld.z);
    const endLocal = getBuildingLocalPoint(building, endWorld.x, endWorld.z);
    const startBlocked = isBlockedLocal(building, grid.obstacles, startLocal.x, startLocal.z, cfg);
    const endBlocked = isBlockedLocal(building, grid.obstacles, endLocal.x, endLocal.z, cfg);
    const segmentClear = hasLineOfSightLocal(building, grid.obstacles, startLocal.x, startLocal.z, endLocal.x, endLocal.z, cfg);
    const clear = !endBlocked && (startBlocked || segmentClear);
    return {
      clear,
      startBlocked,
      endBlocked,
      segmentClear,
      reason: startBlocked && clear ? 'start-blocked-recovery' : startBlocked ? 'start-blocked' : endBlocked ? 'end-blocked' : (segmentClear ? 'clear' : 'segment-blocked'),
      blockedPoint: endApi ? { x: Number(endApi.x) || 0, y: Number(endApi.y ?? endApi.z) || 0 } : null,
    };
  } catch (error) {
    return { clear: true, reason: 'validator-error', error: error?.message || String(error) };
  }
}

function ensureAgentState(agentId) {
  if (!_agentState.has(agentId)) {
    _agentState.set(agentId, {
      route: null,
      routePoints: null,
      routeSegments: null,
      routeIndex: 0,
      segmentIndex: 0,
      buildingId: null,
      targetKey: null,
      revision: 0,
      poorProgressMs: 0,
      lastGoalDistance: null,
      lastPlanAtMs: 0,
      lastPlanReason: null,
      lastRouteProgressAtMs: 0,
      rerouteFrom: null,
      rerouteUntilMs: 0,
      projectedPoint: null,
      projectedDistance: 0,
      projectedDistanceAlong: 0,
      pursuitTarget: null,
      lateralOffset: 0,
      corridorViolationMs: 0,
      rawCells: null,
      rawPoints: null,
      cells: null,
      active: false,
    });
  }
  return _agentState.get(agentId);
}

function makeBuildingRouteKey(building) {
  return `${building?.id || 'none'}:f${Math.max(1, Number(building?._routingFloor || 1) || 1)}`;
}

function makeTargetKey(building, target) {
  return `${makeBuildingRouteKey(building)}:${Number(target?.x || 0).toFixed(2)}:${Number(target?.y || 0).toFixed(2)}`;
}

function projectPointToSegment(point, segA, segB) {
  const vx = (segB?.x || 0) - (segA?.x || 0);
  const vy = (segB?.y || 0) - (segA?.y || 0);
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.000001) {
    return {
      t: 0,
      point: clonePoint2(segA),
      distance: pointDistance(point, segA),
    };
  }
  const t = clamp((((point?.x || 0) - (segA?.x || 0)) * vx + ((point?.y || 0) - (segA?.y || 0)) * vy) / len2, 0, 1);
  const projected = {
    x: (segA?.x || 0) + vx * t,
    y: (segA?.y || 0) + vy * t,
  };
  return {
    t,
    point: projected,
    distance: pointDistance(point, projected),
  };
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
    const indexBias = Math.abs(seg.index - currentIdx) * 0.45;
    const score = proj.distance + indexBias;
    if (!best || score < bestScore) {
      best = {
        segmentIndex: seg.index,
        point: proj.point,
        distance: proj.distance,
        t: proj.t,
        distanceAlong: seg.startDistance + seg.length * proj.t,
        segment: seg,
      };
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

function shouldReplan(state, nowMs, buildingRouteKey, targetKey, currentDistance, cfg) {
  const corridorHalfWidthApi = worldToApi(Number(cfg.corridorHalfWidthWorld) || 0.42);
  if (!state.route || !state.route.length || !state.routeSegments?.length) return 'initial-route';
  if (state.buildingId !== buildingRouteKey) return 'building-or-floor-changed';
  if (state.targetKey !== targetKey) return 'target-changed';
  if ((nowMs - state.lastPlanAtMs) >= cfg.staleRouteMs && currentDistance > cfg.waypointReachApi * 1.5) return 'route-stale';
  if (state.poorProgressMs >= cfg.poorProgressMs && (nowMs - state.lastPlanAtMs) >= cfg.replanCooldownMs) return 'poor-progress';
  if (state.corridorViolationMs >= Math.max(500, cfg.poorProgressMs * 0.8) && (nowMs - state.lastPlanAtMs) >= cfg.replanCooldownMs) return 'corridor-drift';
  if (state.projectedDistance > corridorHalfWidthApi * 2.35) return 'route-abandoned';
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
    Math.min(worldToApi(Number(cfg.gridCellSizeWorld) || 0.55) * 0.62, worldToApi(0.42)),
  );
  const nearSegmentEnd = projection.t >= (Number(cfg.segmentAdvanceDotThreshold) || 0.9);
  const nearNextAnchor = !!(nextAnchor && pointDistance(agent, nextAnchor) <= reachApi);
  const projectedAhead = projection.distanceAlong >= ((state.routeSegments?.[anchorIdx]?.endDistance || 0) - reachApi);
  let nextRouteIdx = (nearSegmentEnd || nearNextAnchor || projectedAhead)
    ? clamp(anchorIdx + 1, 0, lastRouteIndex)
    : anchorIdx;
  // Debug and steering should not flicker/backtrack to a previous waypoint just because nearest-segment projection jitters.
  if (currentIdx > nextRouteIdx && (state.projectedDistance || 0) <= worldToApi(Math.max(0.5, Number(cfg.corridorHalfWidthWorld) || 0.42) * 2.2)) {
    nextRouteIdx = currentIdx;
  }
  state.routeIndex = nextRouteIdx;
  return projection;
}

function getLookaheadPointOnRoute(state, cfg) {
  if (!state?.routeSegments?.length) return state?.route?.[state?.routeIndex || 0] || null;
  const lookaheadApi = Math.max(
    worldToApi(Number(cfg.routeLookaheadWorld) || 1.15),
    worldToApi((Number(cfg.routeLookaheadMinPoints) || 1) * (Number(cfg.gridCellSizeWorld) || 0.55) * 0.65),
  );
  const targetDistance = state.projectedDistanceAlong + lookaheadApi;
  return pointAtDistanceOnSegments(state.routeSegments, targetDistance);
}

function applyCorridorCenterBias(agent, pursuitPoint, state, cfg) {
  if (!pursuitPoint || !state?.projectedPoint) return pursuitPoint;
  const corridorHalfWidthApi = Math.max(1, worldToApi(Number(cfg.corridorHalfWidthWorld) || 0.42));
  const pressure = clamp((state.projectedDistance - corridorHalfWidthApi * 0.18) / corridorHalfWidthApi, 0, 1);
  if (pressure <= 0.001) return pursuitPoint;
  const bias = clamp((Number(cfg.centerBiasStrength) || 0.28) * pressure, 0, 0.55);
  const centered = {
    x: state.projectedPoint.x + (pursuitPoint.x - state.projectedPoint.x) * (1 - bias),
    y: state.projectedPoint.y + (pursuitPoint.y - state.projectedPoint.y) * (1 - bias),
  };
  const nearAgent = pointDistance(agent, centered) <= 1.5 ? pursuitPoint : centered;
  return nearAgent;
}

function buildRoutePriorityHint(agent, state, cfg) {
  if (!agent || !state?.routeSegments?.length) return null;
  const currentSeg = state.routeSegments[clamp(state.segmentIndex || 0, 0, state.routeSegments.length - 1)] || null;
  const futureSeg = state.routeSegments[Math.min(state.routeSegments.length - 1, (state.segmentIndex || 0) + Math.max(1, Math.round(Number(cfg.routePriorityLookahead) || 2)))] || currentSeg;
  const toPursuit = state.pursuitTarget
    ? normalizeVec2((state.pursuitTarget.x || 0) - agent.x, (state.pursuitTarget.y || 0) - agent.y)
    : normalizeVec2();
  const toCenter = state.projectedPoint
    ? normalizeVec2((state.projectedPoint.x || 0) - agent.x, (state.projectedPoint.y || 0) - agent.y)
    : normalizeVec2();

  let routeDir = currentSeg?.dir?.len
    ? normalizeVec2(currentSeg.dir.x, currentSeg.dir.y)
    : normalizeVec2();
  if (futureSeg?.dir?.len) routeDir = blendVec2(routeDir, futureSeg.dir, 0.72);
  if (toPursuit.len) routeDir = blendVec2(routeDir, toPursuit, 0.78);
  if (toCenter.len && state.projectedDistance > worldToApi((Number(cfg.corridorHalfWidthWorld) || 0.42) * 0.35)) {
    routeDir = blendVec2(routeDir, toCenter, 0.84);
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

export function resolveInteriorTargetReachability(building, targetApi, options = {}) {
  const cfg = { ...DYNAMIC_INTERIOR_ROUTING, ...(options || {}) };
  if (!building || !targetApi) return { adjusted: false, target: targetApi || null, reason: 'missing-building-or-target' };
  const grid = buildGrid(building, cfg);
  const targetWorld = { x: apiToWorld(targetApi.x), z: apiToWorld(targetApi.y) };
  const targetLocal = getBuildingLocalPoint(building, targetWorld.x, targetWorld.z);
  const targetBlocked = isLocalPointCellBlocked(grid, targetLocal.x, targetLocal.z);
  const goal = findNearestOpenCell(grid, targetLocal.x, targetLocal.z);
  if (!goal) return { adjusted: false, target: targetApi, reachable: false, reason: 'no-open-cell-near-target' };
  const goalCenter = grid.center(goal.x, goal.z);
  const losBlocked = !hasLineOfSightLocal(building, grid.obstacles, goalCenter.x, goalCenter.z, targetLocal.x, targetLocal.z, cfg);
  if (!targetBlocked && !losBlocked) return { adjusted: false, target: targetApi, reachable: true, reason: 'target-cell-open' };
  const adjustedWorld = getBuildingWorldPoint(building, goalCenter.x, goalCenter.z);
  const adjusted = {
    ...(targetApi || {}),
    x: worldToApi(adjustedWorld.x),
    y: worldToApi(adjustedWorld.z),
    adjustedFrom: targetApi ? { x: targetApi.x, y: targetApi.y } : null,
    targetAdjusted: true,
    targetAdjustedReason: targetBlocked ? 'target-cell-blocked' : 'target-line-of-sight-blocked',
  };
  return { adjusted: true, target: adjusted, reachable: true, reason: adjusted.targetAdjustedReason, originalTarget: targetApi };
}

export function configureDynamicInteriorRouting(helpers = {}) {
  Object.assign(_helpers, helpers || {});
}

export function invalidateDynamicInteriorRouting(buildingId = null) {
  if (!buildingId) {
    _buildingCache.clear();
    return;
  }
  _buildingCache.delete(buildingId);
  for (const state of _agentState.values()) {
    if (String(state.buildingId || '').startsWith(`${buildingId}:`)) state.lastPlanAtMs = 0;
  }
}

export function clearDynamicInteriorRoutingForAgent(agentId = null) {
  if (agentId == null) {
    _agentState.clear();
    return;
  }
  _agentState.delete(agentId);
}

export function getDynamicInteriorRoutingState(agentId) {
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

export function hydrateDynamicInteriorRoutingDebugFromRuntimeRoute(agent, runtimeRoute = null) {
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
  state.cells = rawCells;
  state.projectedPoint = cloneRuntimeRoutePoint(runtimeRoute.projectedPoint) || routePoints[Math.min(routeIndex, routePoints.length - 1)] || routePoints[0];
  state.pursuitTarget = nextPoint;
  state.rerouteFrom = cloneRuntimeRoutePoint(runtimeRoute.rerouteFrom);
  state.lastPlanReason = String(runtimeRoute.reason || runtimeRoute.source || 'server-runtime-route');
  state.targetAdjusted = runtimeRoute.targetAdjusted === true;
  state.adjustedTarget = cloneRuntimeRoutePoint(runtimeRoute.adjustedTarget || runtimeRoute.finalPoint);
  state.active = true;
  state.runtimeDebugHydrated = true;
  state.revision = (Number(state.revision) || 0) + 1;
  return true;
}

export function updateDynamicInteriorRouting(agent, target, dtMs = 16, options = {}) {
  const cfg = { ...DYNAMIC_INTERIOR_ROUTING, ...options };
  if (!cfg.enabled || !agent || !target || !_helpers.getInteriorBuildingAt) {
    clearDynamicInteriorRoutingForAgent(agent?.id);
    return { active: false, effectiveTarget: target, reason: 'disabled' };
  }

  const building = options.building || _helpers.getInteriorBuildingAt(agent.x, agent.y);
  const targetBuilding = _helpers.getInteriorBuildingAt(target.x, target.y);
  if (!building || !targetBuilding || building.id !== targetBuilding.id || building.type === 'park') {
    clearDynamicInteriorRoutingForAgent(agent.id);
    return { active: false, effectiveTarget: target, reason: 'not-same-building' };
  }

  const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
  const state = ensureAgentState(agent.id);
  const buildingRouteKey = makeBuildingRouteKey(building);
  const targetKey = makeTargetKey(building, target);
  const goalDistance = pointDistance(agent, target);

  if (state.lastGoalDistance != null) {
    const progress = state.lastGoalDistance - goalDistance;
    state.poorProgressMs = progress >= cfg.progressEpsilonApi ? 0 : (state.poorProgressMs + dtMs);
  } else {
    state.poorProgressMs = 0;
  }
  state.lastGoalDistance = goalDistance;

  const replanReason = shouldReplan(state, nowMs, buildingRouteKey, targetKey, goalDistance, cfg);
  if (replanReason) {
    const planned = planRoute(building, { x: agent.x, y: agent.y }, target, cfg);
    if (planned && Array.isArray(planned.points) && planned.points.length >= 2) {
      state.routePoints = planned.points;
      state.route = planned.points.slice(1);
      state.routeSegments = planned.segments || [];
      state.rawCells = planned.rawCells || [];
      state.cells = planned.cells || [];
      state.rawPoints = planned.rawPoints || [];
      state.targetAdjusted = !!planned.targetAdjusted;
      state.adjustedTarget = planned.points?.[planned.points.length - 1] || null;
      state.routeIndex = 0;
      state.segmentIndex = 0;
      state.buildingId = buildingRouteKey;
      state.targetKey = targetKey;
      state.lastPlanAtMs = nowMs;
      state.lastPlanReason = replanReason;
      state.lastRouteProgressAtMs = nowMs;
      state.projectedPoint = clonePoint2(planned.points[0]);
      state.projectedDistance = 0;
      state.projectedDistanceAlong = 0;
      state.pursuitTarget = planned.points[Math.min(1, planned.points.length - 1)] || clonePoint2(target);
      state.lateralOffset = 0;
      state.corridorViolationMs = 0;
      state.revision += 1;
      state.active = true;
      if (replanReason !== 'initial-route') {
        state.rerouteFrom = { x: agent.x, y: agent.y };
        state.rerouteUntilMs = nowMs + cfg.rerouteMarkerMs;
      } else {
        state.rerouteFrom = null;
        state.rerouteUntilMs = 0;
      }
    } else {
      state.route = null;
      state.routePoints = null;
      state.routeSegments = null;
      state.cells = null;
      state.rawCells = null;
      state.rawPoints = null;
      state.routeIndex = 0;
      state.segmentIndex = 0;
      state.active = false;
      return { active: false, effectiveTarget: target, reason: 'route-failed' };
    }
  }

  if (!state.route?.length || !state.routeSegments?.length) {
    return { active: false, effectiveTarget: target, reason: 'no-route' };
  }

  const projection = advanceRouteProgress(state, agent, cfg);
  const corridorHalfWidthApi = Math.max(1, worldToApi(Number(cfg.corridorHalfWidthWorld) || 0.42));
  if ((state.projectedDistance || 0) > corridorHalfWidthApi * 1.1) {
    state.corridorViolationMs += dtMs;
  } else {
    state.corridorViolationMs = 0;
  }

  const pursuitPoint = getLookaheadPointOnRoute(state, cfg) || state.route[state.routeIndex] || target;
  state.pursuitTarget = applyCorridorCenterBias(agent, pursuitPoint, state, cfg);
  const effectiveTarget = state.pursuitTarget || state.route[state.routeIndex] || target;
  const priorityHint = buildRoutePriorityHint(agent, state, cfg);

  return {
    active: true,
    effectiveTarget,
    priorityHint,
    reason: state.lastPlanReason || 'active-route',
    routeIndex: state.routeIndex,
    segmentIndex: state.segmentIndex,
    revision: state.revision,
    route: state.route,
    routePoints: state.routePoints,
    cells: state.cells,
    rawCells: state.rawCells,
    rawPoints: state.rawPoints,
    projectedPoint: state.projectedPoint,
    pursuitTarget: state.pursuitTarget,
    targetAdjusted: !!state.targetAdjusted,
    adjustedTarget: state.adjustedTarget || null,
    rerouteFrom: (state.rerouteUntilMs > nowMs) ? state.rerouteFrom : null,
    lateralOffset: state.lateralOffset,
    corridorViolationMs: state.corridorViolationMs,
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
  group.name = `dynamicInteriorRoute_${agentId}`;
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
  const previewRaw = Array.isArray(state.rawPoints) ? state.rawPoints.slice(0, cfg.maxPreviewCells) : [];
  const previewRoute = Array.isArray(state.routePoints) ? state.routePoints.slice(0, cfg.maxPreviewWaypoints + 1) : [];
  const cellSize = (cfg.gridCellSizeWorld || 0.55) * 0.82;

  previewRaw.forEach((point, idx) => {
    const tile = new THREE.Mesh(
      _floorTileGeo.clone(),
      new THREE.MeshBasicMaterial({
        color: 0x21455f,
        transparent: true,
        opacity: 0.11,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.scale.set(cellSize, cellSize, 1);
    tile.position.set(point.x * apiScale, 0.04 + idx * 0.0002, point.y * apiScale);
    tile.renderOrder = 995;
    group.add(tile);
  });

  const rawLinePoints = previewRaw.map((point, idx) => new THREE.Vector3(point.x * apiScale, 0.052 + idx * 0.0004, point.y * apiScale));
  const rawLine = buildPolyline(rawLinePoints, 0x335a80, 0.45, 996);
  if (rawLine) group.add(rawLine);

  const routeLinePoints = previewRoute.map((point, idx) => new THREE.Vector3(point.x * apiScale, 0.078 + idx * 0.0008, point.y * apiScale));
  const routeLine = buildPolyline(routeLinePoints, 0x00e5ff, 0.96, 997);
  if (routeLine) group.add(routeLine);

  if (state.projectedPoint) {
    const projected = new THREE.Mesh(_markerGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff4dd2, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
    projected.position.set(state.projectedPoint.x * apiScale, 0.081, state.projectedPoint.y * apiScale);
    projected.renderOrder = 998;
    group.add(projected);
  }

  if (state.projectedPoint) {
    const centerLine = buildPolyline([
      new THREE.Vector3(agent.x * apiScale, 0.075, agent.y * apiScale),
      new THREE.Vector3(state.projectedPoint.x * apiScale, 0.075, state.projectedPoint.y * apiScale),
    ], 0xc86bff, 0.45, 997);
    if (centerLine) group.add(centerLine);
  }

  const nextPoint = state.route[state.routeIndex] || null;
  if (nextPoint) {
    const nextMarker = new THREE.Mesh(_markerGeo.clone(), new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
    nextMarker.position.set(nextPoint.x * apiScale, 0.083, nextPoint.y * apiScale);
    nextMarker.renderOrder = 998;
    group.add(nextMarker);
  }

  if (state.pursuitTarget) {
    const pursuit = new THREE.Mesh(_targetGeo.clone(), new THREE.MeshBasicMaterial({ color: 0x6eff8c, transparent: true, opacity: 0.78, depthTest: false, depthWrite: false }));
    pursuit.scale.set(0.9, 1, 0.9);
    pursuit.position.set(state.pursuitTarget.x * apiScale, 0.073, state.pursuitTarget.y * apiScale);
    pursuit.renderOrder = 998;
    group.add(pursuit);
  }

  const finalPoint = state.route[state.route.length - 1] || null;
  if (finalPoint) {
    const targetMarker = new THREE.Mesh(_targetGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }));
    targetMarker.position.set(finalPoint.x * apiScale, 0.07, finalPoint.y * apiScale);
    targetMarker.renderOrder = 998;
    group.add(targetMarker);
  }

  if (state.rerouteFrom) {
    const rerouteMarker = new THREE.Mesh(_targetGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff7043, transparent: true, opacity: 0.72, depthTest: false, depthWrite: false }));
    rerouteMarker.scale.set(1.25, 1, 1.25);
    rerouteMarker.position.set(state.rerouteFrom.x * apiScale, 0.066, state.rerouteFrom.y * apiScale);
    rerouteMarker.renderOrder = 998;
    group.add(rerouteMarker);
  }
}

export function updateDynamicInteriorRoutingDebug(agent, options = {}) {
  const debugOn = options.debug !== undefined ? !!options.debug : !!DYNAMIC_INTERIOR_ROUTING.debug;
  if (!debugOn) {
    // PERF: never create groups or allocate cfg objects when overlays are off.
    const existing = _debugGroups.get(agent?.id);
    if (existing) existing.visible = false;
    return;
  }
  const cfg = { ...DYNAMIC_INTERIOR_ROUTING, ...options };
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

export function clearDynamicInteriorRoutingDebug(agentId = null) {
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
