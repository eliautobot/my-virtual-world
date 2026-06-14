/**
 * Virtual World — Rapier Physics Integration
 * 
 * Provides collision detection and response for all world objects.
 * Uses Rapier's KinematicCharacterController for agents (slide along walls).
 * Buildings, decorations = static colliders.
 * Vehicles = kinematic bodies.
 */

import RAPIER from '@dimforge/rapier3d-compat';

// ─── STATE ──────────────────────────────────────────────────
let world = null;
let initialized = false;
let _eventQueue = null;
let _charController = null; // Shared character controller for all agents

// Maps from game ID → Rapier rigid body handle
const bodyMap = new Map();      // id → RigidBody
const colliderMap = new Map();  // id → Collider

// ─── INIT ───────────────────────────────────────────────────
export async function initPhysics() {
  if (initialized) return;
  await RAPIER.init();
  
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  world = new RAPIER.World(gravity);
  _eventQueue = new RAPIER.EventQueue(true);
  
  // Ground plane
  const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const groundBody = world.createRigidBody(groundDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(500, 0.1, 500).setTranslation(0, -0.1, 0),
    groundBody
  );
  
  // Character controller for agents — handles wall sliding, step climbing
  _charController = world.createCharacterController(0.1); // 0.1 = offset distance from walls
  _charController.enableAutostep(0.3, 0.2, true);  // step up small ledges
  _charController.enableSnapToGround(0.5);           // stick to ground
  _charController.setSlideEnabled(true);              // slide along walls
  
  initialized = true;
  console.log('⚡ Rapier physics initialized');
}

export function stepPhysics(dt) {
  if (!world) return;
  world.timestep = Math.min(dt, 1 / 30);
  world.step(_eventQueue);
}

export function getPhysicsWorld() { return world; }
export function isPhysicsReady() { return initialized && world !== null; }

// ─── BUILDING COLLIDERS (static) ────────────────────────────
export function addBuildingCollider(id, wx, wz, widthTiles, heightTiles, wallH, rotation) {
  if (!world) return;
  removeBody(id);

  const T = 1;
  const rot = ((rotation || 0) % 360 + 360) % 360;
  const isSwapped = (rot === 90 || rot === 270);
  const bw = isSwapped ? heightTiles * T : widthTiles * T;
  const bd = isSwapped ? widthTiles * T : heightTiles * T;
  const bh = wallH || 3.0;
  const wt = 0.25;
  const doorWidth = 2.4;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(wx * T + bw / 2, bh / 2, wz * T + bd / 2);
  const body = world.createRigidBody(bodyDesc);

  const addHorizontalWall = (z, width, centerX) => {
    if (width <= 0.1) return;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, bh / 2, wt / 2)
        .setTranslation(centerX, 0, z),
      body
    );
  };
  const addVerticalWall = (x, depth, centerZ) => {
    if (depth <= 0.1) return;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(wt / 2, bh / 2, depth / 2)
        .setTranslation(x, 0, centerZ),
      body
    );
  };
  const addHorizontalFace = (faceZ, withDoorGap = false) => {
    if (!withDoorGap) {
      addHorizontalWall(faceZ, bw, 0);
      return;
    }
    const sideWidth = Math.max(0, (bw - doorWidth) / 2);
    addHorizontalWall(faceZ, sideWidth, -bw / 2 + sideWidth / 2);
    addHorizontalWall(faceZ, sideWidth, bw / 2 - sideWidth / 2);
  };
  const addVerticalFace = (faceX, withDoorGap = false) => {
    if (!withDoorGap) {
      addVerticalWall(faceX, bd, 0);
      return;
    }
    const sideDepth = Math.max(0, (bd - doorWidth) / 2);
    addVerticalWall(faceX, sideDepth, -bd / 2 + sideDepth / 2);
    addVerticalWall(faceX, sideDepth, bd / 2 - sideDepth / 2);
  };

  // Match the visual wall placement in main3d.js.
  // Visual walls sit just outside the floor footprint, not inset into it.
  addHorizontalFace(-bd / 2 - wt / 2, rot === 180);
  addHorizontalFace(bd / 2 + wt / 2, rot === 0);
  addVerticalFace(-bw / 2 - wt / 2, rot === 90);
  addVerticalFace(bw / 2 + wt / 2, rot === 270);

  bodyMap.set(id, body);
}

export function updateBuildingCollider(id, wx, wz, widthTiles, heightTiles, wallH, rotation) {
  removeBody(id);
  addBuildingCollider(id, wx, wz, widthTiles, heightTiles, wallH, rotation);
}

export function addInteriorWallCollider(id, x1, z1, x2, z2, wallH = 2.6, wallThickness = 0.2, centerY = null) {
  if (!world) return;
  removeBody(id);

  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;

  const midX = (x1 + x2) / 2;
  const midZ = (z1 + z2) / 2;
  const rotY = -Math.atan2(dz, dx);
  const halfAngle = rotY / 2;

  const y = centerY != null ? centerY : wallH / 2;
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(midX, y, midZ)
    .setRotation({ w: Math.cos(halfAngle), x: 0, y: Math.sin(halfAngle), z: 0 });
  const body = world.createRigidBody(bodyDesc);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(len / 2, wallH / 2, wallThickness / 2),
    body
  );

  bodyMap.set(id, body);
  colliderMap.set(id, collider);
}

// ─── AGENT COLLIDERS (dynamic + character controller) ───────
/**
 * Add a collider for an agent. Uses a simple dynamic body that we 
 * move via the character controller (not kinematic — CC needs a real collider).
 */
export function addAgentCollider(id, x, z) {
  if (!world) return;
  removeBody(id);
  
  // Kinematic position-based body — we move it via character controller
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(x, 0.7, z);
  const body = world.createRigidBody(bodyDesc);
  
  // Capsule collider for character controller
  // Collision groups: member=0x0004 (agent), filter=0x0007 (static|vehicle|agent)
  // Agents now collide with other agents too, so they don't walk through each other
  const colliderDesc = RAPIER.ColliderDesc.capsule(0.35, 0.25)
    .setCollisionGroups(0x00040007);
  const collider = world.createCollider(colliderDesc, body);
  
  bodyMap.set(id, body);
  colliderMap.set(id, collider);
}

/**
 * Move an agent using the character controller (slides along walls).
 * @param {string} id - Agent physics ID
 * @param {number} dx - Desired movement delta X (not absolute position!)
 * @param {number} dz - Desired movement delta Z
 * @param {number} groundY - Current ground height
 * @returns {{x: number, z: number}} - New absolute position after collision resolution
 */
export function moveAgentWithController(id, dx, dz, groundY) {
  const body = bodyMap.get(id);
  const collider = colliderMap.get(id);
  if (!body || !collider || !_charController) {
    // Fallback: just return current + delta
    const pos = body ? body.translation() : { x: 0, y: 0, z: 0 };
    return { x: pos.x + dx, z: pos.z + dz };
  }
  
  // Compute movement with character controller
  const desiredMovement = { x: dx, y: -0.1, z: dz }; // slight downward to stay grounded
  _charController.computeColliderMovement(collider, desiredMovement);
  
  // Get the corrected movement (after wall sliding)
  const corrected = _charController.computedMovement();
  
  // Apply to body
  const pos = body.translation();
  const newX = pos.x + corrected.x;
  const newZ = pos.z + corrected.z;
  const newY = groundY + 0.7; // capsule center height
  
  body.setNextKinematicTranslation({ x: newX, y: newY, z: newZ });
  
  return { x: newX, z: newZ };
}

/**
 * Teleport agent to a position (no collision, just set).
 */
export function teleportAgent(id, x, y, z) {
  const body = bodyMap.get(id);
  if (!body) return;
  const position = { x, y: y + 0.7, z };
  if (typeof body.setTranslation === 'function') body.setTranslation(position, true);
  body.setNextKinematicTranslation(position);
}

/**
 * Get current agent position.
 */
export function getAgentPosition(id) {
  const body = bodyMap.get(id);
  if (!body) return null;
  const pos = body.translation();
  return { x: pos.x, y: pos.y - 0.7, z: pos.z };
}

// ─── VEHICLE COLLIDERS ──────────────────────────────────────
export function addVehicleCollider(id, x, z, dir) {
  if (!world) return;
  removeBody(id);
  
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(x, 0.5, z);
  const body = world.createRigidBody(bodyDesc);
  
  // Vehicle cuboid collider — scaled to match visual car (2x scale applied to mesh)
  // Half-extents: length=2.0 (1.0*2), height=0.7 (0.35*2), width=1.1 (0.55*2)
  // Collision groups: member=0x0002 (vehicle), filter=0x0007 (static|vehicle|agent)
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(2.0, 0.7, 1.1)
      .setCollisionGroups(0x00020007)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  );
  
  bodyMap.set(id, body);
  colliderMap.set(id, collider);
}

/**
 * Get the collider handle for a vehicle (used for shape-cast exclusion).
 */
export function getColliderHandle(id) {
  const collider = colliderMap.get(id);
  return collider ? collider.handle : null;
}

export function getVehicleColliderHandle(id) {
  return getColliderHandle(id);
}

export function setVehiclePosition(id, x, y, z, rotY) {
  const body = bodyMap.get(id);
  if (!body) return { x, z };
  body.setNextKinematicTranslation({ x, y: y + 0.5, z });
  // Apply rotation if provided (Y-axis rotation for vehicle facing direction)
  if (rotY !== undefined) {
    const halfAngle = rotY / 2;
    body.setNextKinematicRotation({ w: Math.cos(halfAngle), x: 0, y: Math.sin(halfAngle), z: 0 });
  }
  const pos = body.translation();
  return { x: pos.x, z: pos.z };
}

// ─── DECORATION COLLIDERS ───────────────────────────────────
export function addDecorationCollider(id, type, x, z) {
  if (!world) return;
  removeBody(id);
  
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z);
  const body = world.createRigidBody(bodyDesc);
  
  let colliderDesc;
  switch (type) {
    case 'tree':
      colliderDesc = RAPIER.ColliderDesc.cylinder(1.5, 0.4).setTranslation(0, 1.5, 0);
      break;
    case 'lamppost':
      colliderDesc = RAPIER.ColliderDesc.cylinder(1.25, 0.15).setTranslation(0, 1.25, 0);
      break;
    case 'bench':
      colliderDesc = RAPIER.ColliderDesc.cuboid(0.75, 0.4, 0.3).setTranslation(0, 0.4, 0);
      break;
    case 'fountain':
      colliderDesc = RAPIER.ColliderDesc.cylinder(1.0, 2.5).setTranslation(0, 0.5, 0);
      break;
    case 'fence':
      colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.4, 0.03).setTranslation(0, 0.4, 0);
      break;
    default:
      colliderDesc = RAPIER.ColliderDesc.cylinder(0.5, 0.3).setTranslation(0, 0.5, 0);
  }
  
  const collider = world.createCollider(colliderDesc, body);
  bodyMap.set(id, body);
  colliderMap.set(id, collider);
}

export function addBoxCollider(id, x, z, halfW, halfD, height = 1.2, rotationDeg = 0, centerY = null) {
  if (!world) return;
  removeBody(id);

  const y = centerY != null ? centerY : height / 2;
  const rotY = (rotationDeg || 0) * Math.PI / 180;
  const halfAngle = rotY / 2;
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(x, y, z)
    .setRotation({ w: Math.cos(halfAngle), x: 0, y: Math.sin(halfAngle), z: 0 });
  const body = world.createRigidBody(bodyDesc);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(Math.max(0.05, halfW), height / 2, Math.max(0.05, halfD)),
    body
  );

  bodyMap.set(id, body);
  colliderMap.set(id, collider);
}

export function probeObstacleAt(x, z, radius = 0.35, options = {}) {
  if (!world) return { hit: false, count: 0, handles: [], centers: [] };

  const height = options.height ?? 1.4;
  const y = options.y ?? height / 2;
  const maxCenters = options.maxCenters ?? 4;
  const ignoreHandles = new Set((options.ignoreHandles || []).filter(handle => handle != null));
  const shape = new RAPIER.Cuboid(Math.max(0.05, radius), height / 2, Math.max(0.05, radius));
  const shapePos = { x, y, z };
  const shapeRot = { w: 1.0, x: 0.0, y: 0.0, z: 0.0 };

  let count = 0;
  const handles = [];
  const centers = [];
  world.intersectionsWithShape(shapePos, shapeRot, shape, (handle) => {
    if (ignoreHandles.has(handle)) return true;
    const collider = world.getCollider(handle);
    if (!collider) return true;
    count++;
    handles.push(handle);
    if (centers.length < maxCenters) {
      const center = collider.translation?.();
      if (center) centers.push({ x: center.x, y: center.y, z: center.z, handle });
    }
    return true;
  });

  return { hit: count > 0, count, handles, centers };
}

// ─── PLACEMENT TESTING ──────────────────────────────────────
export function testPlacementCollision(wx, wz, widthTiles, heightTiles, wallH) {
  if (!world) return false;
  
  const T = 1;
  const bw = widthTiles * T;
  const bd = heightTiles * T;
  const bh = wallH || 3.0;
  const cx = wx * T + bw / 2;
  const cz = wz * T + bd / 2;
  
  const shape = new RAPIER.Cuboid(bw / 2 - 0.1, bh / 2, bd / 2 - 0.1);
  const shapePos = { x: cx, y: bh / 2, z: cz };
  const shapeRot = { w: 1.0, x: 0.0, y: 0.0, z: 0.0 };
  
  let hasCollision = false;
  world.intersectionsWithShape(shapePos, shapeRot, shape, (handle) => {
    const collider = world.getCollider(handle);
    if (collider) {
      hasCollision = true;
      return false;
    }
    return true;
  });
  
  return hasCollision;
}

// ─── CLEANUP ────────────────────────────────────────────────
export function removeBody(id) {
  const body = bodyMap.get(id);
  if (body && world) {
    world.removeRigidBody(body);
    bodyMap.delete(id);
    colliderMap.delete(id);
  }
}

export function clearAll() {
  if (!world) return;
  for (const [id] of bodyMap) {
    removeBody(id);
  }
  bodyMap.clear();
  colliderMap.clear();
}

// ─── DEBUG ──────────────────────────────────────────────────
export function getPhysicsDebugInfo() {
  if (!world) return { bodies: 0, colliders: 0 };
  return {
    bodies: bodyMap.size,
    colliders: colliderMap.size,
  };
}

export { RAPIER };
