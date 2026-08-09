import assert from 'node:assert/strict';

import {
  ARMCHAIR_DEFAULT_COLORS,
  FURNITURE_PLACEMENT_SCHEMA_VERSION,
  normalizeFurniturePlacementDefaults,
} from '../src/client/js/furniture-placement-defaults.mjs';
import { CATALOG_REGISTRY } from '../src/client/js/agent-life-catalog-registry.mjs';
import {
  STARTER_MAP_VERSION,
  cloneStarterMapBuildings,
} from '../src/client/js/starter-map.mjs';

assert.equal(STARTER_MAP_VERSION, 'desktop-8590-2026-08-09-furniture-v2');

const office = cloneStarterMapBuildings().find(building => building.id === 'bld_1781275645157');
assert(office, 'starter Office must exist');
const armchairs = office.interior.furniture.filter(item => item.type === 'armchair');
assert.equal(armchairs.length, 2, 'starter Office must keep both armchairs');

const simulatedNewArmchair = normalizeFurniturePlacementDefaults({
  type: 'armchair',
  x: 12,
  z: 8,
  rotation: 0,
  floor: 1,
  buildingFloor: 1,
});

for (const armchair of armchairs) {
  for (const key of [
    'catalogId',
    'stationary',
    'carryable',
    'temporary',
    'persistsUntilDeleted',
    'assetClass',
    'furnitureSchemaVersion',
    'armchairColors',
    'lifecycle',
  ]) {
    assert.deepEqual(armchair[key], simulatedNewArmchair[key], `seeded armchair ${key} must match a newly placed armchair`);
  }
  assert.equal(armchair.furnitureSchemaVersion, FURNITURE_PLACEMENT_SCHEMA_VERSION);
  assert.deepEqual(armchair.armchairColors, ARMCHAIR_DEFAULT_COLORS);
}

const catalogArmchair = CATALOG_REGISTRY.get('armchair');
const approach = catalogArmchair.interactionSpots.find(spot => spot.id === 'approach-front');
const seat = catalogArmchair.interactionSpots.find(spot => spot.id === 'seat');
const stand = catalogArmchair.interactionSpots.find(spot => spot.id === 'stand-front');
assert.equal(approach.dz, simulatedNewArmchair.lifecycle.routing.approachOffsetTiles);
assert.equal(seat.dz, simulatedNewArmchair.lifecycle.routing.seatOffsetTiles);
assert.equal(simulatedNewArmchair.lifecycle.routing.seatSurfaceLift, 2.08);
assert.equal(seat.approachSpotId, approach.id);
assert.equal(stand.id, simulatedNewArmchair.lifecycle.routing.dismountSpotId);

const customized = normalizeFurniturePlacementDefaults({
  type: 'armchair',
  armchairColors: { body: '#123456' },
  lifecycle: { routing: { seatSurfaceLift: 2.5 } },
});
assert.equal(customized.armchairColors.body, '#123456', 'normalization must preserve custom colors');
assert.equal(customized.armchairColors.feet, ARMCHAIR_DEFAULT_COLORS.feet, 'normalization must fill missing color fields');
assert.equal(customized.lifecycle.routing.seatSurfaceLift, 2.5, 'normalization must preserve explicit routing overrides');

const normalizedStarterTypes = new Set([
  'desk',
  'meetingTable',
  'pingpong',
  'printerCopier',
  'whiteboard',
  'bulletinBoard',
  'bookshelf',
  'trashBin',
  'armchair',
  'vending',
  'waterCooler',
  'counter',
  'microwave',
  'countertopCoffeeMachine',
]);
for (const item of office.interior.furniture.filter(item => normalizedStarterTypes.has(item.type))) {
  assert.equal(item.catalogId, item.type, `${item.type} must have current catalog metadata`);
  assert.equal(item.lifecycle.stationary, true, `${item.type} must be stationary`);
  assert.equal(item.lifecycle.persistsUntilDeleted, true, `${item.type} must persist until deletion`);
  assert.equal(item.furnitureSchemaVersion, FURNITURE_PLACEMENT_SCHEMA_VERSION, `${item.type} must use the current placement schema`);
}

console.log('starter furniture parity ok');
