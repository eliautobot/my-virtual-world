#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  BIRD_STATES,
  BIRD_SURFACE_KINDS,
  createParkBirdPerchRefs,
  createRoofBirdPerchRefs,
  getBirdBuildingWorldPoint,
  getBirdGroundSurfaceAt,
  getBirdPerchRefKey,
  isBirdRoofSurfaceKind,
  resolveBirdPerchRef,
  selectBalancedBirdHabitatZone,
  selectOpenBirdPerchRef,
  selectSpreadBirdHabitatZones,
  shouldScareGroundBird,
} from '../src/client/js/ambient-birds.mjs';

assert.equal(BIRD_STATES.HIDDEN, 'hidden', 'off-screen birds must have an explicit pooled hidden state');

const park = {
  id: 'park-1',
  type: 'park',
  worldX: 10,
  worldY: 20,
  widthTiles: 20,
  heightTiles: 18,
  _elevationY: 0.4,
};
const office = {
  id: 'office-1',
  type: 'office',
  worldX: 40,
  worldY: 50,
  widthTiles: 25,
  heightTiles: 17,
  floorCount: 2,
  _elevationY: 0.2,
};
const home = {
  id: 'home-1',
  type: 'home',
  worldX: -30,
  worldY: 12,
  widthTiles: 10,
  heightTiles: 8,
  floorCount: 3,
  _rotation: 90,
};
const buildings = [park, office, home];
const buildingById = new Map(buildings.map(building => [building.id, building]));

const parkSurface = getBirdGroundSurfaceAt({
  x: 16,
  z: 27,
  buildings,
  terrainAt: () => 2,
  grassTerrain: 0,
  parkSurfaceY: 0.16,
});
assert.equal(parkSurface.kind, BIRD_SURFACE_KINDS.PARK_GRASS, 'park birds must stand on the dedicated park lawn surface');
assert.equal(parkSurface.y, 0.56, 'park perch height must include the park elevation and lawn top');
assert.equal(parkSurface.surfaceKey, 'park:park-1', 'park flock members must share a stable surface key');

assert.equal(getBirdGroundSurfaceAt({
  x: 45,
  z: 55,
  buildings,
  terrainAt: () => 0,
  grassTerrain: 0,
}), null, 'ground birds must never stand inside a non-park building footprint');

const grassSurface = getBirdGroundSurfaceAt({
  x: 2.4,
  z: 3.8,
  buildings,
  terrainAt: (tileX, tileZ) => (tileX === 2 && tileZ === 3 ? 0 : 3),
  terrainSurfaceYAt: () => 0.217,
  grassTerrain: 0,
});
assert.equal(grassSurface.kind, BIRD_SURFACE_KINDS.TERRAIN_GRASS, 'ordinary ground birds must require an actual grass terrain tile');
assert.equal(grassSurface.y, 0.217, 'terrain birds must use the rendered grass top rather than a generic ground height');
assert.equal(getBirdGroundSurfaceAt({
  x: 4.5,
  z: 3.5,
  buildings,
  terrainAt: () => 3,
  grassTerrain: 0,
}), null, 'sidewalk and road terrain must not be eligible as grass perches');

const parkRefs = createParkBirdPerchRefs(park, 16);
assert.equal(parkRefs.length, 16, 'parks must expose enough deterministic lawn positions for a visible flock');
assert.deepEqual(createParkBirdPerchRefs(park, 16), parkRefs, 'park flock positions must remain deterministic across rebuilds');
for (const ref of parkRefs) {
  assert(ref.u >= 0.14 && ref.u <= 0.86 && ref.v >= 0.14 && ref.v <= 0.86, 'park bird perches must remain inset from the sidewalk apron');
  assert(resolveBirdPerchRef(ref, { buildingById, parkSurfaceY: 0.16 }), 'every generated park perch must resolve against the live building');
}

const officeRefs = createRoofBirdPerchRefs(office);
assert.equal(officeRefs.length, 12, 'commercial buildings must expose several ledge positions on all four roof edges');
assert.equal(new Set(officeRefs.map(ref => ref.edge)).size, 4, 'commercial roof birds must distribute across every parapet side');
const officePerchTwoFloors = resolveBirdPerchRef(officeRefs[0], {
  buildingById,
  floorHeight: 2.98,
  wallHeight: 3,
});
office.floorCount = 6;
const officePerchSixFloors = resolveBirdPerchRef(officeRefs[0], {
  buildingById,
  floorHeight: 2.98,
  wallHeight: 3,
});
assert.equal(
  Number((officePerchSixFloors.y - officePerchTwoFloors.y).toFixed(6)),
  Number((4 * 2.98).toFixed(6)),
  'roof ledge perch height must follow live floor-count changes exactly',
);
office.floorCount = 2;

const homeRefs = createRoofBirdPerchRefs(home);
assert.equal(homeRefs.length, 5, 'homes must expose a small line of ridge perches');
const homePerch = resolveBirdPerchRef(homeRefs[2], {
  buildingById,
  floorHeight: 2.98,
  wallHeight: 3,
});
assert.equal(homePerch.kind, BIRD_SURFACE_KINDS.RESIDENTIAL_ROOF_RIDGE, 'home birds must land on the pitched-roof ridge');
assert.equal(homePerch.floorCount, 3, 'resolved ridge records must preserve the active building floor count');
assert.deepEqual(
  { x: homePerch.x, z: homePerch.z },
  getBirdBuildingWorldPoint(home, home.widthTiles / 2, home.heightTiles * 0.5),
  'rotated home ridge perches must use the same local-to-world transform as the building',
);

const zoneFixtures = [
  { id: 'center', centerX: 0, centerZ: 0, priority: 5, perches: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }] },
  { id: 'east', centerX: 100, centerZ: 0, priority: 1, perches: [{ id: 'e1' }, { id: 'e2' }] },
  { id: 'west', centerX: -100, centerZ: 0, priority: 1, perches: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }] },
  { id: 'near', centerX: 4, centerZ: 4, priority: 2, perches: [{ id: 'n1' }] },
];
assert.deepEqual(
  selectSpreadBirdHabitatZones(zoneFixtures, 3).map(zone => zone.id),
  ['center', 'east', 'west'],
  'habitat selection must favor map-wide spread instead of clustering around one neighborhood',
);

const perchFixtures = [
  { id: 'perch-a', kind: BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE },
  { id: 'perch-b', kind: BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE },
  { id: 'perch-c', kind: BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE },
];
assert.equal(getBirdPerchRefKey(perchFixtures[0]), 'perch-a', 'authored perch ids must be stable occupancy keys');
assert.equal(
  selectOpenBirdPerchRef(perchFixtures, { occupiedKeys: new Set(['perch-a', 'perch-b']), startIndex: 0 }).id,
  'perch-c',
  'perch selection must skip ledges already reserved by other birds',
);
assert.equal(
  selectOpenBirdPerchRef(perchFixtures, { occupiedKeys: new Set(perchFixtures.map(getBirdPerchRefKey)) }),
  null,
  'a full ledge must reject another overlapping bird',
);

assert.equal(
  selectBalancedBirdHabitatZone(zoneFixtures.slice(0, 3), {
    occupancyByZone: new Map([['center', 3], ['east', 0], ['west', 1]]),
    x: 0,
    z: 0,
    excludeZoneId: 'center',
  }).id,
  'east',
  'relocating birds must choose the least-filled distant habitat before crowding a roof',
);

assert.equal(shouldScareGroundBird({
  birdX: 0,
  birdY: 0.2,
  birdZ: 0,
  surfaceKind: BIRD_SURFACE_KINDS.PARK_GRASS,
  agentX: 2.5,
  agentY: 0.2,
  agentZ: 0,
  radius: 3.6,
}), true, 'nearby agents must scare birds standing on park grass');
assert.equal(shouldScareGroundBird({
  birdX: 0,
  birdY: 12,
  birdZ: 0,
  surfaceKind: BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE,
  agentX: 0,
  agentY: 12,
  agentZ: 0,
  radius: 3.6,
}), false, 'roof birds must not react to an agent merely sharing their horizontal coordinates');
assert.equal(shouldScareGroundBird({
  birdX: 0,
  birdY: 0.2,
  birdZ: 0,
  surfaceKind: BIRD_SURFACE_KINDS.TERRAIN_GRASS,
  agentX: 1,
  agentY: 5,
  agentZ: 1,
  radius: 3.6,
}), false, 'agents on another floor must not scare ground birds below them');

assert.equal(
  isBirdRoofSurfaceKind(BIRD_SURFACE_KINDS.COMMERCIAL_ROOF_LEDGE),
  true,
  'commercial ledges must be recognized as roof-only bird surfaces',
);
assert.equal(
  isBirdRoofSurfaceKind(BIRD_SURFACE_KINDS.RESIDENTIAL_ROOF_RIDGE),
  true,
  'residential ridges must be recognized as roof-only bird surfaces',
);
assert.equal(
  isBirdRoofSurfaceKind(BIRD_SURFACE_KINDS.PARK_GRASS),
  false,
  'park grass must remain visible independently from roof view modes',
);

console.log('Ambient bird checks passed');
