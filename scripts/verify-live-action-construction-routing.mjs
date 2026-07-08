#!/usr/bin/env node
// Regression test: live-mode construction world-points route to a reachable
// street-side approach point, not the raw empty-lot/foundation coordinate.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIVE_ACTION_API_TILE,
  resolveActionTargetPoint,
} from '../src/realtime/agent-runtime-room.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'vw-construction-route-'));
writeFileSync(join(dataDir, 'world-meta.json'), JSON.stringify({
  streets: [
    { x1: -7, z1: 20, x2: -7, z2: 159, type: null, rotation: 0, openEdges: null },
    { x1: -7, z1: -133, x2: -7, z2: -45, type: null, rotation: 0, openEdges: null },
    { x1: -7, z1: -35, x2: -7, z2: 10, type: null, rotation: 0, openEdges: null },
    { x1: -104, z1: 15, x2: -12, z2: 15, type: null, rotation: 0, openEdges: null },
    { x1: -104, z1: -40, x2: -12, z2: -40, type: null, rotation: 0, openEdges: null },
    { x1: -2, z1: 15, x2: 111, z2: 15, type: null, rotation: 0, openEdges: null },
    { x1: -2, z1: -40, x2: 111, z2: -40, type: null, rotation: 0, openEdges: null },
    { x1: 116, z1: 10, x2: 116, z2: -35, type: null, rotation: 0, openEdges: null },
    { x1: -7, z1: 15, x2: -7, z2: 15, type: 'x-int', rotation: 0, openEdges: { n: true, s: true, e: true, w: true } },
    { x1: -7, z1: -40, x2: -7, z2: -40, type: 'x-int', rotation: 0, openEdges: { n: true, s: true, e: true, w: true } },
  ],
}, null, 2));

const failedBuildSite = {
  schemaVersion: 'agent-live-mode-build-site/v1',
  siteKind: 'agent-home',
  buildingId: 'live-home-adam',
  buildingName: "Resident Home",
  type: 'home',
  worldX: 34,
  worldY: -30,
  widthTiles: 10,
  heightTiles: 8,
  ownerAgentId: 'adam',
  liveModeHomeForAgentId: 'adam',
};

const oldCancelledAction = {
  id: 'wa-old-adam-build',
  agentId: 'adam',
  actionType: 'world.buildStructure',
  target: {
    kind: 'world-point',
    x: 1560,
    y: -800,
    z: -800,
    floor: 1,
    siteKind: 'agent-home',
    buildSite: failedBuildSite,
  },
  route: {
    target: {
      kind: 'world-point',
      x: 1560,
      y: -800,
      floor: 1,
      targetKind: 'world-point',
    },
  },
  params: { buildSite: failedBuildSite },
};

const oldResolved = resolveActionTargetPoint(dataDir, oldCancelledAction, { agents: new Map() });
assert.equal(oldResolved.x, 39 * LIVE_ACTION_API_TILE, 'old construction site should keep its street-side x alignment');
assert.equal(oldResolved.y, -37 * LIVE_ACTION_API_TILE, 'old construction site should route to the nearest sidewalk, not the raw foundation point');
assert.equal(oldResolved.constructionApproachSource, 'nearest-sidewalk-construction-route');
assert.equal(oldResolved.routeKind, 'construction-site-build');

const streetApproachAction = {
  id: 'wa-new-adam-build',
  agentId: 'adam',
  actionType: 'world.buildStructure',
  target: {
    kind: 'world-point',
    x: -440,
    y: 5480,
    z: 5480,
    floor: 1,
    siteKind: 'agent-home',
    buildSite: {
      ...failedBuildSite,
      worldX: -20,
      worldY: 132,
      streetApproach: {
        schemaVersion: 'agent-live-mode-build-site-approach/v1',
        source: 'street-adjacent-build-site',
        approachTile: { x: -11, y: 137 },
      },
    },
  },
};
const streetResolved = resolveActionTargetPoint(dataDir, streetApproachAction, { agents: new Map() });
assert.equal(streetResolved.x, -11 * LIVE_ACTION_API_TILE, 'streetApproach x must be authoritative');
assert.equal(streetResolved.y, 137 * LIVE_ACTION_API_TILE, 'streetApproach y must be authoritative');
assert.equal(streetResolved.constructionApproachSource, 'street-adjacent-build-site');

const genericWorldPoint = resolveActionTargetPoint(dataDir, {
  actionType: 'life.strollOutdoors',
  target: { kind: 'world-point', x: 1560, y: -800, floor: 1 },
}, { agents: new Map() });
assert.equal(genericWorldPoint.x, 1560, 'non-construction world-points must keep their raw target');
assert.equal(genericWorldPoint.y, -800, 'non-construction world-points must keep their raw target');

console.log('verify-live-action-construction-routing: OK');
