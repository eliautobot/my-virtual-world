/**
 * agent-characters.js — Cute Voxel Agent Characters
 * Crossy Road / Animal Crossing style chibi characters for Virtual World
 *
 * Exported API:
 *   createAgentCharacter(agent)        → THREE.Group
 *   updateAgentAnimation(agent, dt, isMoving, isSocializing) → void
 *   getAgentAppearance(agentId, gender) → appearance object
 */
import * as THREE from 'three';
import {
  resolveAgentAnimationState,
} from './agent-life-animation-registry.mjs?v=20260428-bar-stool-asset';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const T = 1;
const API_TILE = 40;
const COFFEE_CUP_ASSET_VERSION = 'drink-cup-handheld-v10-fuller-water';

// ═══════════════════════════════════════════════════════════════
// SHARED GEOMETRY CACHE
// ═══════════════════════════════════════════════════════════════
const _boxGeo    = new THREE.BoxGeometry(1, 1, 1);
const _sphereGeo = new THREE.SphereGeometry(0.5, 8, 6);
const _cylGeo    = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const _coneGeo   = new THREE.ConeGeometry(0.5, 1, 6);
const _matCache  = {};
const _agentPartVertexColorMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function getMat(color, opts) {
  const key = String(color) + (opts ? JSON.stringify(opts) : '');
  if (_matCache[key]) return _matCache[key];
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...(opts || {}) });
  _matCache[key] = m;
  return m;
}

function vox(w, h, d, color) {
  const m = new THREE.Mesh(_boxGeo, getMat(color));
  m.scale.set(w, h, d);
  m.castShadow = true;
  return m;
}

function box(x, y, z, w, h, d, color) {
  const m = vox(w, h, d, color);
  m.position.set(x, y, z);
  return m;
}

// Phase 2 render optimization: merge static voxel boxes inside each animated
// character part. Parts still animate as groups; only their internal box meshes
// are baked together by material.
const AGENT_PART_VOXEL_MERGE = true;

function makeAnchorFromMesh(mesh, name) {
  const anchor = new THREE.Object3D();
  anchor.name = name;
  if (mesh) {
    anchor.position.copy(mesh.position);
    anchor.rotation.copy(mesh.rotation);
    anchor.scale.copy(mesh.scale);
  }
  anchor.userData.agentPartAnchor = true;
  return anchor;
}

function isAgentPartVoxelMergeCandidate(child) {
  if (!child?.isMesh || !child.geometry?.getAttribute?.('position')) return false;
  const mat = child.material;
  if (!mat || Array.isArray(mat) || !mat.isMeshLambertMaterial || mat.map) return false;
  if (mat.transparent || mat.opacity !== 1) return false;
  if (mat.emissive?.getHex?.()) return false;
  if (!child.visible) return false;
  if (child.userData && Object.keys(child.userData).length > 0) return false;
  return true;
}

function mergeAgentPartVoxels(partGroup) {
  if (!AGENT_PART_VOXEL_MERGE || !partGroup?.isObject3D || partGroup.userData?.agentPartVoxelsMerged) return partGroup;
  const candidates = partGroup.children.filter(isAgentPartVoxelMergeCandidate);
  if (candidates.length < 2) return partGroup;

  const positionArrays = [];
  const normalArrays = [];
  const colorArrays = [];
  let vertexCount = 0;
  let castShadow = false;
  let receiveShadow = false;
  const color = new THREE.Color();
  for (const mesh of candidates) {
    mesh.updateMatrix();
    const geo = mesh.geometry.toNonIndexed();
    geo.deleteAttribute('uv');
    geo.applyMatrix4(mesh.matrix);
    const pos = geo.getAttribute('position');
    const normal = geo.getAttribute('normal');
    if (!pos || !normal) continue;
    color.set(mesh.material.color?.getHex?.() ?? 0xffffff);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) color.toArray(colors, i * 3);
    positionArrays.push(pos.array);
    normalArrays.push(normal.array);
    colorArrays.push(colors);
    vertexCount += pos.count;
    castShadow = castShadow || mesh.castShadow;
    receiveShadow = receiveShadow || mesh.receiveShadow;
  }
  if (vertexCount <= 0) return partGroup;
  const posArr = new Float32Array(vertexCount * 3);
  const normArr = new Float32Array(vertexCount * 3);
  const colorArr = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (let i = 0; i < positionArrays.length; i++) {
    posArr.set(positionArrays[i], offset);
    normArr.set(normalArrays[i], offset);
    colorArr.set(colorArrays[i], offset);
    offset += positionArrays[i].length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  const mergedMesh = new THREE.Mesh(geometry, _agentPartVertexColorMat);
  mergedMesh.castShadow = castShadow;
  mergedMesh.receiveShadow = receiveShadow;
  mergedMesh.userData.mergedAgentPartVoxels = candidates.length;
  mergedMesh.name = `${partGroup.name || 'agentPart'}MergedVoxels`;
  for (const mesh of candidates) partGroup.remove(mesh);
  partGroup.add(mergedMesh);
  partGroup.userData.agentPartVoxelsMerged = true;
  partGroup.userData.agentPartVoxelsMergedCount = candidates.length;
  partGroup.userData.agentPartMergedMeshCount = 1;
  return partGroup;
}

function mergeAgentCharacterVoxelParts(rootGroup) {
  if (!AGENT_PART_VOXEL_MERGE || !rootGroup?.isObject3D || rootGroup.userData?.agentVoxelPartsMerged) return rootGroup;
  rootGroup.traverse(child => {
    if (!child?.isGroup) return;
    if (['agentRoot', 'leftEye', 'rightEye', 'mouth', 'speechBubble', 'nameLabel'].includes(child.name)) return;
    mergeAgentPartVoxels(child);
  });
  let mergedSourceVoxels = 0;
  let mergedOutputMeshes = 0;
  rootGroup.traverse(child => {
    if (!child?.isMesh || !child.userData?.mergedAgentPartVoxels) return;
    mergedSourceVoxels += child.userData.mergedAgentPartVoxels;
    mergedOutputMeshes++;
  });
  rootGroup.userData.agentVoxelPartsMerged = true;
  rootGroup.userData.agentVoxelPartsMergedSourceVoxels = mergedSourceVoxels;
  rootGroup.userData.agentVoxelPartsMergedOutputMeshes = mergedOutputMeshes;
  return rootGroup;
}

function disposeCarryVisual(group) {
  group?.traverse?.(child => { child.geometry?.dispose?.(); });
  group?.parent?.remove?.(group);
}

function buildCoffeeCupAsset(name = 'rightHandCoffeeDrink', options = {}) {
  const drinkKind = options.drinkKind === 'water' ? 'water' : 'coffee';
  const isWater = drinkKind === 'water';
  const cup = new THREE.Group();
  cup.name = name;
  cup.userData.assetVersion = COFFEE_CUP_ASSET_VERSION;
  cup.userData.drinkKind = drinkKind;
  cup.userData.visualKind = drinkKind;
  cup.userData.carryItem = drinkKind;
  cup.userData.catalogId = 'temporaryFood';
  cup.userData.itemLabel = isWater ? 'Water Cup' : 'Coffee Drink';
  cup.userData.attachPoint = 'right-hand';

  if (isWater) {
    // Handle-free cup for water cooler pickups. Keep it centered on the hand
    // so it reads as a tumbler instead of the side-gripped coffee mug.
    const wallH = 0.25;
    const wallT = 0.032;
    const halfW = 0.105;
    const halfD = 0.105;
    const glassMat = getMat(0xcffafe, { transparent: true, opacity: 0.34 });
    const waterMat = getMat(0x38bdf8, { transparent: true, opacity: 0.62 });
    const addGlass = mesh => {
      mesh.material = glassMat;
      cup.add(mesh);
    };
    const addWater = mesh => {
      mesh.material = waterMat;
      cup.add(mesh);
    };
    addGlass(box(-halfW + wallT / 2, 0, 0, wallT, wallH, halfD * 2, 0xcffafe));
    addGlass(box(halfW - wallT / 2, 0, 0, wallT, wallH, halfD * 2, 0xcffafe));
    addGlass(box(0, 0, -halfD + wallT / 2, halfW * 2, wallH, wallT, 0xcffafe));
    addGlass(box(0, 0, halfD - wallT / 2, halfW * 2, wallH, wallT, 0xcffafe));
    addGlass(box(0, -0.125, 0, halfW * 2, wallT, halfD * 2, 0xcffafe));
    addWater(box(0, -0.014, 0, 0.158, 0.16, 0.158, 0x38bdf8));
    addWater(box(0, 0.078, 0, 0.16, 0.024, 0.16, 0x38bdf8));
    cup.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return cup;
  }

  // Simple readable voxel mug authored around the handle. The group origin is
  // the grip point, so the character's hand holds the handle instead of the cup.
  const cx = -0.16;
  const wallH = 0.25;
  const wallT = 0.035;
  const halfW = 0.12;
  const halfD = 0.12;
  cup.add(box(cx - halfW + wallT / 2, 0, 0, wallT, wallH, halfD * 2, 0xffffff));
  cup.add(box(cx + halfW - wallT / 2, 0, 0, wallT, wallH, halfD * 2, 0xffffff));
  cup.add(box(cx, 0, -halfD + wallT / 2, halfW * 2, wallH, wallT, 0xffffff));
  cup.add(box(cx, 0, halfD - wallT / 2, halfW * 2, wallH, wallT, 0xffffff));
  cup.add(box(cx, -0.125, 0, halfW * 2, wallT, halfD * 2, 0xffffff));
  cup.add(box(cx, 0.082, 0, 0.15, 0.024, 0.15, isWater ? 0x3b82f6 : 0x4e342e));
  if (!isWater) {
    cup.add(box(0, 0.02, 0, 0.05, 0.17, 0.085, 0xffffff));
    cup.add(box(0.045, 0.02, 0, 0.035, 0.11, 0.06, 0xffffff));
  }
  cup.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return cup;
}

function getCoffeeDeskSipState(agent) {
  const activityKind = String(agent?._idleActivity?.kind || '');
  if (!(activityKind.startsWith('coffee-desk-') || activityKind.startsWith('water-desk-') || activityKind.startsWith('vending-desk-') || activityKind.startsWith('microwave-desk-')) || agent?._idleActivity?.phase !== 'active') {
    return { isDeskConsume: false, handActive: false, lift: 0, phase: 0, localSipPhase: 0 };
  }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const startedAt = Number(agent?._idleActivity?.activeStartedAt || agent?._idleActivity?.startedAt || now);
  const elapsedMs = Math.max(0, now - startedAt);
  const stayMs = Math.max(12000, Number(agent?._idleActivity?.stayMs || 15000));
  const phase = Math.min(0.999, elapsedMs / stayMs);
  const localSipPhase = (phase * 3) - Math.min(2, Math.floor(phase * 3));
  const tableReachStart = 0.10;
  const handWindowStart = 0.30;
  const handWindowEnd = 0.82;
  const handProgress = (localSipPhase - handWindowStart) / Math.max(0.001, handWindowEnd - handWindowStart);
  const handActive = handProgress > 0 && handProgress < 1;
  const lift = handActive ? Math.sin(Math.max(0, Math.min(1, handProgress)) * Math.PI) : 0;
  const reachToTable = localSipPhase > tableReachStart && localSipPhase < handWindowStart
    ? Math.sin(((localSipPhase - tableReachStart) / (handWindowStart - tableReachStart)) * Math.PI)
    : 0;
  const setDownToTable = localSipPhase > 0.68 && localSipPhase < handWindowEnd
    ? Math.sin(((localSipPhase - 0.68) / (handWindowEnd - 0.68)) * Math.PI)
    : 0;
  return { isDeskConsume: true, handActive, lift, reachToTable, setDownToTable, phase, localSipPhase };
}

function placeRightHandCoffeeCupAsset(cup, agent) {
  const activityKind = String(agent?._idleActivity?.kind || '');
  const isMachineUse = (activityKind.startsWith('coffee-machine-') || activityKind.startsWith('water-cooler-')) && agent?._idleActivity?.phase === 'active';
  const deskSipState = getCoffeeDeskSipState(agent);

  if (isMachineUse) {
    cup.position.set(0.10, -0.46, 0.40);
    cup.rotation.set(0.08, 0.03, 0.02);
    cup.scale.setScalar(1.02);
  } else if (deskSipState.isDeskConsume) {
    cup.position.set(0.10, -0.46, 0.38);
    cup.rotation.set(-0.04 + deskSipState.lift * -0.28, 0.02, 0.02);
    cup.scale.setScalar(1);
  } else {
    cup.position.set(0.08, -0.50, 0.44);
    cup.rotation.set(1.08, 0.03, 0.02);
    cup.scale.setScalar(1.02);
  }
}

function placeDeskCoffeeCupAsset(cup, agent) {
  const deskSipState = getCoffeeDeskSipState(agent);
  cup.position.set(0.24, 1.03, 0.92);
  cup.rotation.set(0, 0, 0);
  cup.scale.setScalar(1);
  cup.visible = deskSipState.isDeskConsume && !deskSipState.handActive;
}

function syncDeskCoffeeCupVisual(parts, agent, shouldShow) {
  const root = agent?._group3d || parts?.bodyGroup?.parent || null;
  if (!root) return;
  const carried = agent?._carriedItem || agent?._carrying || (agent?.carryItem ? { label: agent.carryItem } : null);
  const carryKey = [carried?.visualKind, carried?.label, carried?.sourceFurnitureType, agent?.carryItem].filter(Boolean).join(' ').toLowerCase();
  const drinkKind = carryKey.includes('water') ? 'water' : 'coffee';
  let deskCup = root.getObjectByName('deskCoffeeDrink');
  if (!shouldShow) {
    if (deskCup) disposeCarryVisual(deskCup);
    return;
  }
  if (deskCup && (deskCup.userData?.assetVersion !== COFFEE_CUP_ASSET_VERSION || deskCup.userData?.drinkKind !== drinkKind)) {
    disposeCarryVisual(deskCup);
    deskCup = null;
  }
  if (!deskCup) {
    deskCup = buildCoffeeCupAsset('deskCoffeeDrink', { drinkKind });
    deskCup.userData.attachPoint = 'desk-surface';
    root.add(deskCup);
  }
  placeDeskCoffeeCupAsset(deskCup, agent);
}

function getVendingItemVisualMeta(carried = {}) {
  const variant = [
    carried?.vendingItemId,
    carried?.microwaveFoodId,
    carried?.visualKind,
    carried?.label,
    carried?.id,
  ].filter(Boolean).join(' ').toLowerCase() || 'snack';
  return {
    variant,
    packageColor: Number(carried?.packageColor) || (variant.includes('blue') ? 0x2563eb : (variant.includes('red') ? 0xdc2626 : (variant.includes('chocolate') ? 0x4a2c18 : 0xf97316))),
    accentColor: Number(carried?.accentColor) || (variant.includes('blue') ? 0xdbeafe : (variant.includes('red') ? 0xfee2e2 : 0xfbbf24)),
    label: carried?.label || 'Snack',
  };
}

const VENDING_ITEM_ASSET_VERSION = 'vending-item-v3-microwave-food';
const MICROWAVE_FOOD_VISUAL_KINDS = Object.freeze(['microwave-popcorn', 'microwave-pizza-slice', 'microwave-sandwich']);

function buildVendingItemAsset(name, carried = {}) {
  const meta = getVendingItemVisualMeta(carried);
  const item = new THREE.Group();
  item.name = name;
  item.userData.snackVariant = meta.variant;
  item.userData.itemLabel = meta.label;
  item.userData.packageColor = meta.packageColor;
  item.userData.accentColor = meta.accentColor;
  item.userData.assetVersion = VENDING_ITEM_ASSET_VERSION;
  item.userData.microwaveFoodVisualKinds = MICROWAVE_FOOD_VISUAL_KINDS;
  if (meta.variant.includes('popcorn')) {
    // Microwave popcorn: striped red bowl with visible popped kernels.
    const bowl = cyl(0.145, 0.12, 0xe53935);
    bowl.position.y = -0.02;
    item.add(bowl);
    const stripe = cyl(0.148, 0.035, 0xffffff);
    stripe.position.y = 0.02;
    item.add(stripe);
    const rim = cyl(0.152, 0.025, 0xef5350);
    rim.position.y = 0.055;
    item.add(rim);
    const puffs = [
      [-0.08, 0.09, -0.03], [-0.035, 0.125, 0.02], [0.03, 0.118, -0.015],
      [0.085, 0.095, 0.035], [-0.005, 0.15, 0.055], [0.055, 0.145, -0.055],
    ];
    puffs.forEach(([px, py, pz], index) => {
      const puff = sph(index % 2 ? 0.04 : 0.035, index % 3 === 0 ? 0xfff7d6 : 0xfffce8);
      puff.position.set(px, py, pz);
      item.add(puff);
    });
    item.userData.deskRotation = [0, -0.18, 0];
    item.userData.handTilt = -0.08;
  } else if (meta.variant.includes('pizza')) {
    // Pizza slice: triangular cheese wedge with crust and pepperoni dots.
    const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 3), getMat(0xffc107));
    slice.rotation.y = Math.PI / 6;
    slice.castShadow = true;
    slice.receiveShadow = true;
    item.add(slice);
    const sauce = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.038, 3), getMat(0xff7043));
    sauce.position.y = 0.022;
    sauce.rotation.y = Math.PI / 6;
    sauce.castShadow = true;
    sauce.receiveShadow = true;
    item.add(sauce);
    const crust = box(0, 0.045, -0.122, 0.22, 0.045, 0.045, 0xc8792f);
    crust.rotation.y = 0;
    item.add(crust);
    [[-0.045, 0.055, 0.02], [0.045, 0.055, 0.035], [0.005, 0.058, -0.045]].forEach(([px, py, pz]) => {
      const pepperoni = cyl(0.025, 0.012, 0xb91c1c);
      pepperoni.position.set(px, py, pz);
      item.add(pepperoni);
    });
    item.userData.deskRotation = [0, 0.42, 0];
    item.userData.handTilt = -0.14;
  } else if (meta.variant.includes('sandwich')) {
    // Sandwich: stacked bread, greens, filling, and cheese on a small plate.
    const plate = cyl(0.17, 0.018, 0xe5e7eb);
    plate.position.y = -0.055;
    item.add(plate);
    item.add(box(0, -0.018, 0, 0.25, 0.045, 0.16, 0xd9a05b));
    item.add(box(0, 0.018, 0.002, 0.22, 0.022, 0.15, 0x65a30d));
    item.add(box(0, 0.042, 0.004, 0.21, 0.026, 0.14, 0xe87979));
    item.add(box(0, 0.068, 0.004, 0.20, 0.018, 0.13, 0xfacc15));
    item.add(box(0, 0.102, 0, 0.24, 0.046, 0.15, 0xc68c3c));
    [[-0.065, 0.13, -0.035], [0.01, 0.132, 0.02], [0.075, 0.13, -0.002]].forEach(([px, py, pz]) => {
      item.add(box(px, py, pz, 0.016, 0.008, 0.016, 0xfff7ed));
    });
    item.userData.deskRotation = [0, 0.28, 0];
    item.userData.handTilt = -0.12;
  } else if (meta.variant.includes('soft-drink') || meta.variant.includes('soft drink')) {
    // Upright soda can, sized to read clearly next to the coffee mug (~0.25 tall).
    const body = cyl(0.085, 0.30, meta.packageColor);
    item.add(body);
    const topRim = cyl(0.082, 0.022, 0xd1d5db);
    topRim.position.y = 0.16;
    item.add(topRim);
    const bottomRim = cyl(0.082, 0.018, 0xd1d5db);
    bottomRim.position.y = -0.155;
    item.add(bottomRim);
    const label = cyl(0.088, 0.11, meta.accentColor);
    label.position.y = 0.012;
    item.add(label);
    const tab = box(0, 0.176, 0.012, 0.05, 0.012, 0.08, 0xe5e7eb);
    item.add(tab);
    item.userData.deskRotation = [0, 0, 0]; // cans stand upright on the desk
    item.userData.handTilt = -0.16;        // slight tip toward mouth while sipping
  } else if (meta.variant.includes('cookie')) {
    // Big chocolate chip cookie: golden-tan disc with scattered dark chips.
    const base = cyl(0.155, 0.05, 0xd9a05b);
    item.add(base);
    const edge = cyl(0.158, 0.03, 0xc8893f);
    edge.position.y = -0.008;
    item.add(edge);
    const chipColor = 0x3a2415;
    const chips = [
      [0.06, 0.05], [-0.07, 0.03], [0.015, -0.075], [-0.045, -0.055],
      [0.085, -0.025], [-0.005, 0.085], [-0.095, -0.01], [0.045, 0.105],
    ];
    for (const [cxp, czp] of chips) {
      item.add(box(cxp, 0.028, czp, 0.035, 0.022, 0.035, chipColor));
    }
    item.userData.deskRotation = [0, 0, 0]; // cookie lies flat on the desk
    item.userData.handTilt = -0.10;
  } else {
    // Wrapped snack bar (granola / chocolate bar), centered on the group origin.
    item.add(box(0, 0, 0, 0.26, 0.07, 0.15, meta.packageColor));
    item.add(box(0, 0.042, 0, 0.27, 0.022, 0.16, meta.accentColor));
    item.add(box(0.105, 0.02, 0, 0.05, 0.02, 0.04, 0xfef3c7));
    item.add(box(-0.105, 0.02, 0, 0.05, 0.02, 0.04, 0xfef3c7));
    item.userData.deskRotation = [0, 0.35, 0];
    item.userData.handTilt = -0.12;
  }
  item.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return item;
}

function placeRightHandVendingItemAsset(item, agent) {
  // Parented to the right ARM group (full scale, follows the sip/lift arm
  // motion) — same attachment pattern as the coffee mug / water cup.
  const deskSipState = getCoffeeDeskSipState(agent);
  item.position.set(0.08, -0.46, 0.38);
  const tilt = Number(item.userData?.handTilt) || -0.12;
  item.rotation.set(tilt + deskSipState.lift * -0.34, 0, 0);
  item.scale.setScalar(1);
}

function placeDeskVendingItemAsset(item, agent) {
  const deskSipState = getCoffeeDeskSipState(agent);
  const deskRot = item.userData?.deskRotation || [0, 0, 0];
  item.position.set(0.24, 1.05, 0.92);
  item.rotation.set(deskRot[0], deskRot[1], deskRot[2]);
  item.scale.setScalar(1);
  item.visible = deskSipState.isDeskConsume && !deskSipState.handActive;
}

function syncDeskVendingItemVisual(parts, agent, shouldShow) {
  const root = agent?._group3d || parts?.bodyGroup?.parent || null;
  if (!root) return;
  const carried = agent?._carriedItem || agent?._carrying || (agent?.carryItem ? { label: agent.carryItem } : null);
  const meta = getVendingItemVisualMeta(carried || {});
  let deskItem = root.getObjectByName('deskVendingItem');
  if (!shouldShow) {
    if (deskItem) disposeCarryVisual(deskItem);
    return;
  }
  if (deskItem && (deskItem.userData?.assetVersion !== VENDING_ITEM_ASSET_VERSION || deskItem.userData?.snackVariant !== meta.variant)) {
    disposeCarryVisual(deskItem);
    deskItem = null;
  }
  if (!deskItem) {
    deskItem = buildVendingItemAsset('deskVendingItem', carried || {});
    deskItem.userData.attachPoint = 'desk-surface';
    root.add(deskItem);
  }
  placeDeskVendingItemAsset(deskItem, agent);
}

function sph(r, color) {
  const m = new THREE.Mesh(_sphereGeo, getMat(color));
  m.scale.setScalar(r * 2);
  m.castShadow = true;
  return m;
}

function cyl(r, h, color) {
  const m = new THREE.Mesh(_cylGeo, getMat(color));
  m.scale.set(r * 2, h, r * 2);
  m.castShadow = true;
  return m;
}

function cone(r, h, color) {
  const m = new THREE.Mesh(_coneGeo, getMat(color));
  m.scale.set(r * 2, h, r * 2);
  m.castShadow = true;
  return m;
}

function parseColor(hex) {
  if (typeof hex === 'number') return hex;
  return parseInt((hex || '#888888').replace('#', ''), 16);
}

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC RNG
// ═══════════════════════════════════════════════════════════════
function pseudoRandom(s) {
  const x = Math.sin(s + 1) * 43758.5453123;
  return x - Math.floor(x);
}

function hashId(id) {
  return String(id).split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1), 0);
}

// ═══════════════════════════════════════════════════════════════
// APPEARANCE PALETTE
// ═══════════════════════════════════════════════════════════════
const SKIN_TONES = [
  '#fde0c0', // very light
  '#f5c5a0', // light
  '#e8ad80', // light-medium
  '#d4906a', // medium
  '#c07850', // medium-dark
  '#a06040', // dark
  '#7a4428', // very dark
  '#5c2e10', // deep dark
];

const HAIR_COLORS = [
  '#1a1a1a', // black
  '#5c3317', // dark brown
  '#8b5e3c', // brown
  '#c8a060', // dirty blonde
  '#f0d080', // blonde
  '#c04040', // red
  '#b0b0b0', // gray
  '#3060c0', // blue
  '#e070a0', // pink
  '#8040c0', // purple
];

const SHIRT_COLORS = [
  '#1565c0', // blue
  '#c62828', // red
  '#2e7d32', // green
  '#f57f17', // amber
  '#6a1b9a', // purple
  '#00695c', // teal
  '#4e342e', // brown
  '#37474f', // slate
  '#e91e63', // pink
  '#ff6f00', // orange
  '#263238', // dark
  '#ffffff', // white
];

const PANTS_COLORS = [
  '#263238', // dark charcoal
  '#37474f', // slate
  '#1a237e', // dark blue
  '#212121', // black
  '#4e342e', // dark brown
  '#1b5e20', // dark green
  '#880e4f', // dark pink
  '#e3f2fd', // light blue (jeans-ish)
  '#607d8b', // blue-gray
  '#bf360c', // dark orange
];

const SHOE_COLORS = [
  '#1a1a1a', // black
  '#5d4037', // dark brown
  '#ffffff', // white
  '#b71c1c', // red
  '#1565c0', // blue
  '#827717', // olive
  '#880e4f', // dark pink
  '#e65100', // orange
];

const EYE_COLORS = [
  0x6b3f2a, // brown
  0x1e6ba8, // blue
  0x2d7a4a, // green
  0x8b6914, // hazel
  0x607d8b, // gray
];

const HAT_COLORS = [
  0xe53935, 0x8e24aa, 0x1e88e5, 0x43a047,
  0xfb8c00, 0x00acc1, 0xf06292, 0x5d4037,
];

// Lipstick shades (female only)
const LIPSTICK_COLORS = [
  0xc62828, // classic red
  0xe91e63, // hot pink
  0xff8a65, // coral
  0xad1457, // deep rose
  0xf06292, // light pink
];


export const APPEARANCE_CATALOG = {
  eyebrowStyles: [
    { value: 'soft', label: 'Soft Natural' },
    { value: 'straight', label: 'Straight' },
    { value: 'arched', label: 'Arched' },
    { value: 'thick', label: 'Thick' },
    { value: 'sharp', label: 'Sharp Angle' },
    { value: 'short', label: 'Short Taper' },
  ],
  eyeSizes: [
    { value: 'small', label: 'Small', scale: 0.82 },
    { value: 'normal', label: 'Normal', scale: 1.00 },
    { value: 'large', label: 'Large', scale: 1.18 },
    { value: 'wide', label: 'Wide Cute', scale: 1.32 },
  ],
  maleHairStyles: [
    { value: 'buzz', label: 'Buzz Cut' },
    { value: 'short', label: 'Short Crop' },
    { value: 'fade', label: 'Clean Fade' },
    { value: 'sidepart', label: 'Side Part' },
    { value: 'medium', label: 'Medium Layered' },
    { value: 'spiky', label: 'Spiky' },
    { value: 'wavy', label: 'Wavy' },
    { value: 'curly', label: 'Curly' },
    { value: 'afro', label: 'Afro Puff' },
  ],
  femaleHairStyles: [
    { value: 'short', label: 'Short Pixie' },
    { value: 'bob', label: 'Bob Cut' },
    { value: 'medium', label: 'Medium Layered' },
    { value: 'long', label: 'Long Curtain' },
    { value: 'wavy', label: 'Long Wavy' },
    { value: 'curly', label: 'Curly Volume' },
    { value: 'ponytail', label: 'Ponytail' },
    { value: 'bun', label: 'High Bun' },
    { value: 'braids', label: 'Twin Braids' },
    { value: 'afro', label: 'Afro Puff' },
  ],
  shirtStyles: [
    { value: 'tee', label: 'T-Shirt' },
    { value: 'polo', label: 'Polo' },
    { value: 'hoodie', label: 'Hoodie' },
    { value: 'jacket', label: 'Open Jacket' },
    { value: 'dressShirt', label: 'Dress Shirt' },
    { value: 'tank', label: 'Tank Top' },
  ],
  pantsStyles: [
    { value: 'jeans', label: 'Jeans' },
    { value: 'slacks', label: 'Slacks' },
    { value: 'joggers', label: 'Joggers' },
    { value: 'shorts', label: 'Shorts' },
    { value: 'skirt', label: 'Skirt' },
  ],
  shoeStyles: [
    { value: 'sneakers', label: 'Sneakers' },
    { value: 'boots', label: 'Boots' },
    { value: 'loafers', label: 'Loafers' },
    { value: 'highTops', label: 'High Tops' },
    { value: 'sandals', label: 'Sandals' },
  ],
  clothingAccessories: [
    { value: 'none', label: 'None' },
    { value: 'necklace', label: 'Silver Necklace' },
    { value: 'goldChain', label: 'Gold Chain' },
    { value: 'watch', label: 'Watch' },
    { value: 'bracelet', label: 'Bracelet' },
    { value: 'tie', label: 'Tie' },
    { value: 'scarf', label: 'Scarf' },
  ],
  accessories: [
    { value: 'none', label: 'None' },
    { value: 'glasses', label: 'Eyeglasses' },
    { value: 'sunglasses', label: 'Sunglasses' },
    { value: 'cap', label: 'Baseball Cap' },
    { value: 'beanie', label: 'Beanie' },
    { value: 'fedora', label: 'Fedora' },
    { value: 'visor', label: 'Sport Visor' },
  ],
};

const EYE_SIZE_SCALE = Object.fromEntries(APPEARANCE_CATALOG.eyeSizes.map(o => [o.value, o.scale]));

// ═══════════════════════════════════════════════════════════════
// EXPRESSION SYSTEM
// ═══════════════════════════════════════════════════════════════
const EXPRESSIONS = {
  neutral:   { eyebrowY: 0,     mouthType: 'line',    eyeScale: 1.0 },
  happy:     { eyebrowY: 0.012, mouthType: 'smile',   eyeScale: 1.0 },
  working:   { eyebrowY: -0.008,mouthType: 'line',    eyeScale: 0.88 },
  talking:   { eyebrowY: 0.008, mouthType: 'open',    eyeScale: 1.0 },
  laughing:  { eyebrowY: 0.018, mouthType: 'wide',    eyeScale: 0.65 },
  sleeping:  { eyebrowY: 0,     mouthType: 'line',    eyeScale: 0.0 },
  surprised: { eyebrowY: 0.025, mouthType: 'o',       eyeScale: 1.35 },
};

const WORKLIKE_AGENT_STATUSES = new Set([
  'working',
  'finishing',
  'busy',
  'thinking',
  'processing',
  'responding',
  'running',
  'reading',
  'reading_file',
  'reading-file',
  'analyzing',
  'planning',
  'reasoning',
  'inference',
  'inferencing',
  'generating',
  'streaming',
  'executing',
  'command',
  'command_output',
  'tool',
  'tool_start',
  'running_command',
]);

function normalizeAgentAnimationStatus(statusValue) {
  const normalized = String(statusValue || '').trim().toLowerCase();
  if (!normalized) return 'offline';
  return WORKLIKE_AGENT_STATUSES.has(normalized) ? 'working' : normalized;
}

function getAgentPresenceDotColor(statusValue) {
  const normalized = normalizeAgentAnimationStatus(statusValue);
  if (normalized === 'working') return 0xef4444;
  if (normalized === 'idle' || normalized === 'available' || normalized === 'ready' || normalized === 'standby') return 0x22c55e;
  if (normalized === 'meeting') return 0x38bdf8;
  if (normalized === 'break' || normalized === 'away') return 0xf59e0b;
  return 0x94a3b8;
}

// ═══════════════════════════════════════════════════════════════
// SPRITE HELPERS (canvas-based, no DOM dependency beyond canvas)
// ═══════════════════════════════════════════════════════════════
function makeNameLabel(text, fillColor = '#ffd600') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 18px "Press Start 2P", monospace, sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 5;
  ctx.strokeText(text, 256, 36);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, 256, 36);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(4.0, 0.45, 1);
  return sprite;
}

function makeTaskBubble(text) {
  const cw = 256, ch = 80;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.93)';
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(cw - r, 0);
  ctx.quadraticCurveTo(cw, 0, cw, r);
  ctx.lineTo(cw, ch - r - 12);
  ctx.quadraticCurveTo(cw, ch - 12, cw - r, ch - 12);
  ctx.lineTo(26, ch - 12);
  ctx.lineTo(12, ch);
  ctx.lineTo(36, ch - 12);
  ctx.lineTo(r, ch - 12);
  ctx.quadraticCurveTo(0, ch - 12, 0, ch - r - 12);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text || '', cw / 2, 38);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.2, 0.75, 1);
  return sprite;
}

// ═══════════════════════════════════════════════════════════════
// HAIR BUILDERS (attached to head group)
// ═══════════════════════════════════════════════════════════════
// Head half-size: 0.28 wide, 0.28 tall, 0.26 deep (before scale)
// Head sits centered at (0, 0, 0) of headGroup; top of head ≈ y=0.28

function buildHair(style, hairColor, isFemale) {
  const g = new THREE.Group();
  const c = hairColor;
  const addScalp = (topH = 0.14, w = 0.58, d = 0.56) => {
    // Every hairstyle gets a rear scalp patch. This fixes the visible missing
    // back-of-head gap when the camera rotates behind agents. Keep the back
    // cap slightly wider than the head and add rear-corner pieces so hair wraps
    // around the sides instead of stopping short at the back face.
    g.add(box(0, 0.30, -0.015, Math.max(0.62, w), topH, Math.max(0.58, d), c));
    g.add(box(0, 0.15, -0.282, Math.max(0.60, w + 0.08), 0.30, 0.085, c));
    // Rear corner connectors tie the back patch into the side hair as one shell.
    g.add(box(-0.330, 0.14, -0.225, 0.125, 0.31, 0.24, c));
    g.add(box(0.330, 0.14, -0.225, 0.125, 0.31, 0.24, c));
  };
  const addSides = (height = 0.28, y = 0.10, z = 0, depth = 0.50) => {
    // Side hair is biased slightly backward so it meets the rear scalp instead
    // of floating forward and exposing a back-side seam during rotation.
    g.add(box(-0.315, y, z - 0.070, 0.115, height, depth + 0.12, c));
    g.add(box(0.315, y, z - 0.070, 0.115, height, depth + 0.12, c));
  };
  const addFemaleFullCoverage = () => {
    // Female cuts should read as full wigs/caps from every camera angle, not
    // isolated tufts. These thin fitted panels cover the front hairline,
    // temples, sides, crown, and lower back of the head without changing the
    // animated head/body rig.
    g.add(box(0, 0.245, 0.18, 0.54, isFemale ? 0.245 : 0.16, 0.10, c));       // front hairline/bangs base
    g.add(box(-0.305, 0.04, 0.015, 0.125, 0.42, 0.48, c)); // left temple + side/rear hair
    g.add(box(0.305, 0.04, 0.015, 0.125, 0.42, 0.48, c));  // right temple + side/rear hair
    g.add(box(0, 0.06, -0.292, 0.64, 0.42, 0.095, c));    // lower rear scalp, side-to-side
    g.add(box(-0.33, 0.06, -0.22, 0.13, 0.40, 0.22, c));  // lower rear-left connector
    g.add(box(0.33, 0.06, -0.22, 0.13, 0.40, 0.22, c));   // lower rear-right connector
    g.add(box(0, 0.335, -0.09, 0.64, 0.10, 0.44, c));     // crown/rear crown bridge
  };

  switch (style) {
    case 'buzz':
      addScalp(0.075, 0.55, 0.54);
      g.add(box(0, 0.19, -0.27, 0.48, 0.10, 0.055, c));
      break;
    case 'fade':
      addScalp(0.12, 0.54, 0.54);
      addSides(0.20, 0.13, 0, 0.46);
      g.add(box(0.10, 0.40, 0.03, 0.38, 0.08, 0.34, c));
      break;
    case 'sidepart':
      addScalp(0.15, 0.58, 0.55);
      addSides(0.25, 0.12, 0, 0.48);
      g.add(box(-0.09, 0.405, 0.05, 0.08, 0.035, 0.42, 0xf6e6c9));
      g.add(box(0.12, 0.40, 0.02, 0.36, 0.10, 0.40, c));
      break;
    case 'short':
      addScalp(0.14, 0.56, 0.54);
      addSides(0.22, 0.18, 0, 0.50);
      break;
    case 'medium':
      addScalp(0.16, 0.58, 0.56);
      addSides(0.34, 0.10, 0, 0.52);
      g.add(box(0, -0.04, -0.27, 0.50, 0.20, 0.075, c));
      break;
    case 'long':
      addScalp(0.16, 0.58, 0.56);
      addSides(0.58, -0.05, 0, 0.52);
      g.add(box(0, -0.14, -0.27, 0.52, 0.46, 0.09, c));
      break;
    case 'bob':
      addScalp(0.16, 0.60, 0.57);
      addSides(0.46, -0.01, 0.03, 0.48);
      g.add(box(0, -0.07, -0.27, 0.54, 0.34, 0.08, c));
      g.add(box(0, -0.28, 0.06, 0.50, 0.08, 0.30, c));
      break;
    case 'curly':
      addScalp(0.20, 0.62, 0.60);
      addSides(0.36, 0.20, 0, 0.52);
      [[-0.22,0.40,0.20],[0,0.46,0.16],[0.22,0.40,0.20],[-0.26,0.24,0.16],[0.26,0.24,0.16],[0,0.18,-0.29]].forEach(([x,y,r])=>{
        const curl=sph(r,c); curl.position.set(x,y,x===0?-0.02:0.02); g.add(curl);
      });
      break;
    case 'afro':
      addScalp(0.18, 0.64, 0.62);
      [[-0.24,0.30,0.22],[0,0.38,0.25],[0.24,0.30,0.22],[-0.18,0.12,0.18],[0.18,0.12,0.18],[0,0.18,-0.26]].forEach(([x,y,r])=>{
        const puff=sph(r,c); puff.position.set(x,y,x===0?-0.03:0); g.add(puff);
      });
      break;
    case 'spiky':
      addScalp(0.12, 0.52, 0.50);
      [-0.18, 0, 0.18].forEach((sx, i) => {
        const m = new THREE.Mesh(_coneGeo, getMat(c));
        m.scale.set(0.12, 0.28, 0.12);
        m.position.set(sx, 0.48 + i * 0.04, -0.04);
        m.castShadow = true;
        g.add(m);
      });
      [-0.27, 0.27].forEach(sx => {
        const m = new THREE.Mesh(_coneGeo, getMat(c));
        m.scale.set(0.10, 0.22, 0.10);
        m.position.set(sx, 0.38, 0);
        m.rotation.z = sx < 0 ? 0.5 : -0.5;
        m.castShadow = true;
        g.add(m);
      });
      break;
    case 'wavy':
      addScalp(0.15, 0.58, 0.54);
      addSides(0.48, 0.04, 0.04, 0.46);
      g.add(box(0, -0.16, -0.27, 0.52, 0.34, 0.09, c));
      g.add(box(-0.22, -0.30, 0, 0.14, 0.14, 0.14, c));
      g.add(box(0.22, -0.30, 0, 0.14, 0.14, 0.14, c));
      break;
    case 'ponytail':
      addScalp(0.16, 0.58, 0.56);
      addSides(0.28, 0.14, 0, 0.52);
      g.add(box(0, 0.06, -0.30, 0.18, 0.10, 0.10, 0xffd700));
      g.add(box(0, -0.03, -0.42, 0.16, 0.38, 0.15, c));
      g.add(box(0, -0.25, -0.43, 0.20, 0.16, 0.18, c));
      break;
    case 'bun': {
      addScalp(0.15, 0.58, 0.56);
      addSides(0.28, 0.12, 0, 0.50);
      const bun = sph(0.19, c); bun.position.set(0, 0.24, -0.42); g.add(bun);
      g.add(box(0, 0.18, -0.29, 0.18, 0.12, 0.08, c));
      break;
    }
    case 'braids':
      addScalp(0.15, 0.58, 0.56);
      addSides(0.26, 0.14, 0, 0.48);
      [-0.31, 0.31].forEach(sx => {
        g.add(box(sx, -0.10, -0.05, 0.10, 0.36, 0.10, c));
        g.add(box(sx, -0.35, -0.05, 0.12, 0.16, 0.12, c));
        g.add(box(sx, -0.48, -0.05, 0.08, 0.07, 0.08, 0xffd700));
      });
      break;
    default:
      addScalp(0.14, 0.56, 0.54);
      addSides(0.22, 0.18, 0, 0.50);
  }
  if (isFemale) addFemaleFullCoverage();
  return g;
}

// ═══════════════════════════════════════════════════════════════
// ACCESSORY BUILDERS
// ═══════════════════════════════════════════════════════════════
function buildHat(hatColor, style = 'cap') {
  const g = new THREE.Group();
  const bandColor = hatColor === 0x1a1a1a ? 0xffd700 : 0x1a1a1a;
  switch (style) {
    case 'beanie':
      g.add(box(0, 0.22, 0, 0.58, 0.34, 0.54, hatColor));
      g.add(box(0, 0.02, 0, 0.62, 0.08, 0.56, bandColor));
      break;
    case 'fedora':
      g.add(box(0, 0, 0, 0.78, 0.07, 0.72, hatColor));
      g.add(box(0, 0.21, 0, 0.50, 0.34, 0.48, hatColor));
      g.add(box(0, 0.06, 0, 0.54, 0.06, 0.52, bandColor));
      break;
    case 'visor':
      g.add(box(0, 0.06, 0.15, 0.62, 0.08, 0.24, hatColor));
      g.add(box(0, 0.10, 0.31, 0.70, 0.05, 0.28, hatColor));
      g.add(box(0, 0.08, -0.14, 0.52, 0.05, 0.18, bandColor));
      break;
    case 'cap':
    default:
      g.add(box(0, 0.16, 0, 0.56, 0.28, 0.52, hatColor));
      g.add(box(0, 0.02, 0.33, 0.54, 0.06, 0.28, hatColor));
      g.add(box(0, 0.02, 0, 0.58, 0.05, 0.52, bandColor));
      break;
  }
  return g;
}

function buildGlasses(glassColor, style = 'glasses') {
  const g = new THREE.Group();
  const gc = glassColor || (style === 'sunglasses' ? 0x111111 : 0x1a237e);
  const frame = style === 'sunglasses' ? 0x050505 : 0x212121;
  // Sit glasses clearly in front of the eye stack so iris/pupil/shine do not z-fight or peek through.
  // Bridge spans lens-to-lens; keep it slightly in front so it visibly connects to both lenses.
  g.add(box(0, 0, 0.372, 0.205, 0.05, 0.032, frame));
  g.add(box(-0.175, 0, 0.36, 0.18, style === 'sunglasses' ? 0.15 : 0.14, 0.035, gc));
  g.add(box(0.175, 0, 0.36, 0.18, style === 'sunglasses' ? 0.15 : 0.14, 0.035, gc));
  g.add(box(-0.30, 0, 0.28, 0.07, 0.04, 0.16, frame));
  g.add(box(0.30, 0, 0.28, 0.07, 0.04, 0.16, frame));
  return g;
}

function addShoeDetailsToLeg(legGroup, shoeStyle = 'sneakers', shoeColor = 0x111111, side = 'left') {
  // Shoe details are attached to each leg group, not bodyGroup, so they keep
  // the existing walking animation/pivots perfectly intact.
  const shoe = shoeColor;
  if (shoeStyle === 'boots') {
    legGroup.add(box(0, -0.31, 0.02, 0.18, 0.18, 0.17, shoe));
    legGroup.add(box(0, -0.23, 0.02, 0.19, 0.05, 0.18, shoe ^ 0x202020));
  } else if (shoeStyle === 'highTops') {
    legGroup.add(box(0, -0.36, 0.03, 0.18, 0.12, 0.17, shoe));
    legGroup.add(box(0, -0.34, 0.105, 0.11, 0.025, 0.025, 0xffffff));
  } else if (shoeStyle === 'sandals') {
    legGroup.add(box(0, -0.43, 0.15, 0.18, 0.035, 0.035, shoe));
    legGroup.add(box(0, -0.405, 0.04, 0.035, 0.035, 0.16, shoe));
  } else if (shoeStyle === 'loafers') {
    legGroup.add(box(0, -0.43, 0.16, 0.17, 0.04, 0.07, shoe ^ 0x151515));
  } else {
    legGroup.add(box(0, -0.415, 0.165, 0.13, 0.035, 0.035, 0xffffff));
  }
}

function addPantsDetailsToLeg(legGroup, pantsStyle = 'jeans', accentColor = 0xffd54f) {
  // Lower-leg pant details must live on the leg group. If they are added to
  // bodyGroup they stay static while shoes/legs walk, which looks like a
  // floating colored line around the shoe.
  if (pantsStyle === 'joggers') {
    legGroup.add(box(0, -0.34, 0.105, 0.18, 0.05, 0.05, accentColor));
  }
}

function clothingCoverageFor(a) {
  const shirtStyle = a.shirtStyle || 'tee';
  const pantsStyle = a.pantsStyle || 'jeans';
  const shoeStyle = a.shoeStyle || 'sneakers';
  return {
    torso: 'shirt',
    belly: 'shirt',
    upperArm: shirtStyle === 'tank' ? 'skin' : 'shirt',
    forearm: ['hoodie', 'jacket'].includes(shirtStyle) ? 'shirt' : 'skin',
    hand: 'skin',
    hips: ['skirt', 'shorts', 'jeans', 'slacks', 'joggers', 'cargo'].includes(pantsStyle) ? 'pants' : 'skin',
    upperLeg: ['shorts', 'jeans', 'slacks', 'joggers', 'cargo'].includes(pantsStyle) ? 'pants' : 'skin',
    lowerLeg: ['jeans', 'slacks', 'joggers', 'cargo'].includes(pantsStyle) ? 'pants' : 'skin',
    shoe: shoeStyle === 'sandals' ? 'skin' : 'shoe',
  };
}

function materialColor(slot, colors) {
  return colors[slot] ?? colors.skin;
}

function getTorsoProfile(a, isFemale) {
  const shirtStyle = a.shirtStyle || 'tee';
  const baseW = isFemale ? 0.38 : 0.44;
  const baseD = 0.26;
  const profile = {
    torsoW: baseW,
    torsoH: 0.40,
    torsoD: baseD,
    torsoY: 0.68,
    bellyW: baseW * 0.70,
    bellyH: 0.14,
    bellyD: 0.24,
    bellyY: 0.56,
    bellyZ: 0.01,
    hipW: isFemale ? 0.46 : 0.42,
    hipH: 0.10,
    hipD: 0.28,
    hipY: 0.47,
  };

  // Clothing changes the torso volume itself instead of adding a loose front
  // decal. Rotating the character now shows a real garment-shaped body piece.
  if (shirtStyle === 'hoodie') {
    profile.torsoW += 0.06;
    profile.torsoH = 0.42;
    profile.torsoD = 0.31;
    profile.torsoY = 0.665;
    profile.bellyW = profile.torsoW * 0.78;
    profile.bellyD = 0.29;
  } else if (shirtStyle === 'jacket') {
    profile.torsoW += 0.05;
    profile.torsoD = 0.30;
    profile.bellyW = profile.torsoW * 0.76;
    profile.bellyD = 0.28;
  } else if (shirtStyle === 'tank') {
    profile.torsoW -= 0.02;
    profile.torsoD = 0.25;
    profile.bellyW = profile.torsoW * 0.68;
  }

  profile.frontZ = profile.torsoD / 2 + 0.018;
  return profile;
}

function buildTorsoShapeDetails(a, isFemale, torsoColor, skinColor) {
  const g = new THREE.Group();
  if (!isFemale) return g;
  const shirtStyle = a.shirtStyle || 'tee';
  const torsoProfile = getTorsoProfile(a, isFemale);
  const frontZ = torsoProfile.frontZ + 0.012;
  const chestColor = torsoColor;
  const shade = chestColor ^ 0x101010;

  // Soft chibi female torso volume. Keep it subtle and blended into the torso:
  // gently taller vertical forms plus broad filler panels, with no small point/detail.
  const addChestForm = (x) => {
    const form = sph(0.082, chestColor);
    form.name = x < 0 ? 'leftChestForm' : 'rightChestForm';
    form.position.set(x, 0.685, frontZ - 0.038);
    form.scale.set(0.200, 0.118, 0.058);
    g.add(form);
    // Blend the rounded form back into the flat torso so it tapers gradually.
    g.add(box(x * 0.72, 0.665, frontZ - 0.055, 0.145, 0.095, 0.030, chestColor));
  };
  addChestForm(-0.098);
  addChestForm(0.098);
  g.add(box(0, 0.675, frontZ - 0.058, 0.305, 0.125, 0.030, chestColor));
  g.add(box(0, 0.635, frontZ - 0.045, 0.250, 0.035, 0.018, shade));

  // Necklines/garment trim sit in front of the fitted torso volume so female
  // tops adhere to the lower, broader shape instead of hovering near the neck.
  if (shirtStyle === 'tank') {
    // Tank tops are clothing attached to the torso. Avoid skin-colored floating
    // cutout blocks near the neck/head; shoulder exposure comes from arm coverage.
    g.add(box(-0.145, 0.755, frontZ, 0.055, 0.18, 0.026, chestColor));
    g.add(box(0.145, 0.755, frontZ, 0.055, 0.18, 0.026, chestColor));
    g.add(box(0, 0.695, frontZ, 0.25, 0.18, 0.026, chestColor));
  } else if (shirtStyle === 'dressShirt' || shirtStyle === 'polo') {
    g.add(box(0, 0.735, frontZ, 0.030, 0.18, 0.026, 0xffffff));
  } else if (shirtStyle === 'hoodie') {
    g.add(box(0, 0.735, frontZ, 0.055, 0.17, 0.026, 0xffffff));
  } else if (shirtStyle === 'jacket') {
    g.add(box(-0.16, 0.68, frontZ, 0.08, 0.22, 0.026, shade));
    g.add(box(0.16, 0.68, frontZ, 0.08, 0.22, 0.026, shade));
  }
  return g;
}

function buildClothingDetails(a, skin, shirt, pants, shoe, isFemale = false, torsoProfile = getTorsoProfile(a, isFemale)) {
  const g = new THREE.Group();
  const shirtStyle = a.shirtStyle || 'tee';
  const pantsStyle = a.pantsStyle || 'jeans';
  const shoeStyle = a.shoeStyle || 'sneakers';
  const accent = parseColor(a.accentColor || '#ffd54f');
  const frontZ = torsoProfile.frontZ;
  if (shirtStyle === 'polo' || shirtStyle === 'dressShirt') {
    // Collar/placket are detail on the shirt body, below the head/chin.
    g.add(box(0, 0.785, frontZ, 0.16, 0.055, 0.025, 0xffffff));
    g.add(box(0, 0.655, frontZ + 0.002, 0.028, 0.23, 0.025, 0xffffff));
  }
  if (shirtStyle === 'hoodie') {
    g.add(box(0, 0.805, -0.015, torsoProfile.torsoW * 0.78, 0.10, torsoProfile.torsoD * 0.72, shirt ^ 0x101010));
    g.add(box(0, 0.665, frontZ + 0.002, 0.06, 0.23, 0.025, 0xffffff));
  }
  if (shirtStyle === 'jacket') {
    g.add(box(-torsoProfile.torsoW * 0.23, 0.665, frontZ, torsoProfile.torsoW * 0.24, 0.32, 0.026, shirt ^ 0x303030));
    g.add(box(torsoProfile.torsoW * 0.23, 0.665, frontZ, torsoProfile.torsoW * 0.24, 0.32, 0.026, shirt ^ 0x303030));
    g.add(box(0, 0.665, frontZ + 0.004, torsoProfile.torsoW * 0.22, 0.29, 0.026, 0xf5f5f5));
  }
  if (shirtStyle === 'tank') {
    // No skin-colored torso overlays here: the tank is integrated into torso material.
    g.add(box(0, 0.775, frontZ, 0.17, 0.035, 0.026, shirt));
  }
  if (pantsStyle === 'shorts') {
    // Shorts are not a front-only illusion anymore: upper legs are recolored
    // as shorts and lower legs remain skin by clothingCoverageFor(). Add only
    // small cuffs that wrap the leg tops.
    g.add(box(-0.13, 0.30, 0, 0.22, 0.055, 0.22, pants ^ 0x202020));
    g.add(box(0.13, 0.30, 0, 0.22, 0.055, 0.22, pants ^ 0x202020));
  } else if (pantsStyle === 'skirt') {
    // Full wrap skirt shell around the hips/upper legs; legs underneath stay skin.
    g.add(box(0, 0.39, 0.02, 0.54, 0.18, 0.34, pants));
    g.add(box(0, 0.29, 0.02, 0.60, 0.08, 0.38, pants ^ 0x101010));
  }
  return g;
}

function buildClothingAccessory(style, accessoryColor = 0xffd700, isFemale = false, torsoProfile = getTorsoProfile({}, isFemale)) {
  const g = new THREE.Group();
  const c = parseColor(accessoryColor);
  const chestZ = torsoProfile.frontZ + 0.006;
  switch (style) {
    case 'necklace':
      g.add(box(0, 0.90, chestZ, 0.22, 0.035, 0.026, 0xd7dde8));
      g.add(box(0, 0.84, chestZ + 0.003, 0.06, 0.07, 0.026, 0xd7dde8));
      break;
    case 'goldChain':
      g.add(box(0, 0.88, chestZ, 0.25, 0.045, 0.026, 0xffd700));
      g.add(box(0, 0.81, chestZ + 0.003, 0.07, 0.08, 0.026, 0xffd700));
      break;
    case 'watch':
    case 'bracelet':
      // Wrist accessories are attached directly to arm groups in createAgentCharacter
      // so they follow arm animation instead of floating from the static body group.
      break;
    case 'tie':
      g.add(box(0, 0.76, chestZ + 0.002, 0.07, 0.25, 0.026, c));
      g.add(box(0, 0.91, chestZ + 0.003, 0.10, 0.08, 0.026, c));
      break;
    case 'scarf':
      g.add(box(0, 0.845, 0.02, 0.48, 0.09, Math.max(0.30, torsoProfile.torsoD + 0.04), c));
      g.add(box(0.16, 0.69, chestZ, 0.10, 0.28, 0.04, c));
      break;
  }
  return g;
}

function addArmAccessoryToArm(armGroup, style = 'none', accessoryColor = 0xffd700, side = 'right') {
  if (!armGroup) return;
  const c = parseColor(accessoryColor);
  const sx = side === 'left' ? -1 : 1;
  if (style === 'watch' && side === 'right') {
    armGroup.add(box(0.02 * sx, -0.42, 0.02, 0.06, 0.07, 0.08, c));
  } else if (style === 'bracelet' && side === 'left') {
    armGroup.add(box(0.02 * sx, -0.42, 0.02, 0.065, 0.05, 0.08, c));
  }
}

function buildEyebrow(style, side, color) {
  const sx = side === 'left' ? -1 : 1;
  const g = new THREE.Group();
  const width = style === 'thick' ? 0.17 : style === 'short' ? 0.10 : 0.14;
  const height = style === 'thick' ? 0.06 : 0.04;
  const brow = box(0, 0, 0, width, height, 0.025, color);
  if (style === 'arched') brow.rotation.z = -0.18 * sx;
  else if (style === 'sharp') brow.rotation.z = -0.34 * sx;
  else if (style === 'straight') brow.rotation.z = 0;
  else brow.rotation.z = -0.08 * sx;
  g.add(brow);
  if (style === 'sharp') g.add(box(0.055 * sx, -0.028, 0, 0.055, height, 0.025, color));
  return g;
}

// ═══════════════════════════════════════════════════════════════
// EYE BUILDER — big cute eyes with iris, pupil, shine
// ═══════════════════════════════════════════════════════════════
function buildEye(side, eyeColor, isFemale, eyeSize = 'normal') {
  const g = new THREE.Group();
  const sx = side === 'left' ? -1 : 1;

  const eyeScale = EYE_SIZE_SCALE[eyeSize] || Number(eyeSize) || 1;
  // Sclera (white part) — slightly rounded look with overlapping boxes
  const sclera = box(0, 0, 0, 0.14 * eyeScale, 0.16 * eyeScale, 0.04, 0xffffff);
  sclera.name = 'sclera';
  g.add(sclera);

  // Iris (colored)
  const iris = box(0, 0, 0.021, 0.09 * eyeScale, 0.11 * eyeScale, 0.03, eyeColor);
  iris.name = 'iris';
  g.add(iris);

  // Pupil (black)
  const pupil = box(0.01 * sx, -0.01, 0.042, 0.05 * eyeScale, 0.06 * eyeScale, 0.02, 0x0a0a0a);
  pupil.name = 'pupil';
  g.add(pupil);

  // Shine dot (white highlight). Both eyes use the same top-left placement;
  // do not mirror this or one eye reads as lit from the wrong direction.
  const shine = box(-0.025 * eyeScale, 0.025 * eyeScale, 0.052, 0.025 * eyeScale, 0.025 * eyeScale, 0.015, 0xffffff);
  shine.name = 'shine';
  g.add(shine);

  // Eyelid (for blinking — starts invisible)
  const eyelid = box(0, 0.03 * eyeScale, 0.015, 0.16 * eyeScale, 0.06 * eyeScale, 0.045, 0xffffff); // skin color applied later
  eyelid.name = 'eyelid';
  eyelid.visible = false;
  g.add(eyelid);

  g.name = side + 'Eye';
  return g;
}

// ═══════════════════════════════════════════════════════════════
// MOUTH BUILDER
// ═══════════════════════════════════════════════════════════════
function buildMouth(mouthType, lipColor) {
  const g = new THREE.Group();

  // We'll use a canvas-on-plane approach for crisp expressions
  // but keep it voxel-style with box meshes

  switch (mouthType) {
    case 'smile': {
      // Two corner pixels turned down make it look like a smile from above
      g.add(box(-0.05, 0, 0, 0.10, 0.04, 0.03, lipColor || 0xc62828));
      g.add(box(-0.09, 0.02, 0, 0.04, 0.04, 0.03, lipColor || 0xc62828));
      g.add(box(0.09, 0.02, 0, 0.04, 0.04, 0.03, lipColor || 0xc62828));
      break;
    }
    case 'open': {
      // Open mouth (talking)
      g.add(box(0, 0, 0, 0.16, 0.05, 0.03, lipColor || 0xc62828));
      g.add(box(0, -0.035, 0, 0.10, 0.03, 0.03, 0x2a0a0a)); // inside dark
      break;
    }
    case 'wide': {
      // Big laugh
      g.add(box(0, 0, 0, 0.20, 0.06, 0.03, lipColor || 0xc62828));
      g.add(box(0, -0.04, 0, 0.14, 0.04, 0.03, 0x2a0a0a));
      g.add(box(-0.08, 0.02, 0, 0.04, 0.04, 0.03, lipColor || 0xc62828)); // corners up
      g.add(box(0.08, 0.02, 0, 0.04, 0.04, 0.03, lipColor || 0xc62828));
      break;
    }
    case 'o': {
      // Surprised O
      g.add(box(0, 0, 0, 0.12, 0.12, 0.03, lipColor || 0xc62828));
      g.add(box(0, 0, 0.015, 0.07, 0.07, 0.02, 0x2a0a0a));
      break;
    }
    case 'line':
    default: {
      // Neutral line
      g.add(box(0, 0, 0, 0.14, 0.035, 0.03, lipColor || 0x8b3a3a));
      break;
    }
  }
  g.name = 'mouth';
  return g;
}

// ═══════════════════════════════════════════════════════════════
// EYELASH BUILDER (female only)
// ═══════════════════════════════════════════════════════════════
function buildEyelashes(side) {
  const g = new THREE.Group();
  const lashColor = 0x1a1a1a;

  // Three small lash strokes above the eye
  [-0.05, 0, 0.05].forEach((ox, i) => {
    const lash = box(ox, 0.09, 0, 0.025, 0.06 + i * 0.01, 0.025, lashColor);
    lash.rotation.z = (ox < 0 ? -0.3 : ox > 0 ? 0.3 : 0);
    g.add(lash);
  });
  return g;
}

// ═══════════════════════════════════════════════════════════════
// GETAPPEARANCE — deterministic from agent ID
// ═══════════════════════════════════════════════════════════════
export function getAgentAppearance(agentId, gender) {
  const seed = hashId(agentId);
  const rng = (offset) => pseudoRandom(seed + offset);

  const isFemale = gender === 'F' || (!gender && rng(0) < 0.5);
  const hairStyles = (isFemale ? APPEARANCE_CATALOG.femaleHairStyles : APPEARANCE_CATALOG.maleHairStyles).map(o => o.value);
  const pick = (arr, offset) => arr[Math.floor(rng(offset) * arr.length)];

  const skinTone   = pick(SKIN_TONES, 1);
  const hairColor  = pick(HAIR_COLORS, 2);
  const hairStyle  = pick(hairStyles, 3);
  const shirtColor = pick(SHIRT_COLORS, 4);
  const pantsColor = pick(PANTS_COLORS, 5);
  const shoeColor  = pick(SHO_COLORS_SAFE, 6);
  const eyeColor   = pick(EYE_COLORS, 7);
  const lipColor   = isFemale ? pick(LIPSTICK_COLORS, 8) : null;
  const accessoryStyle = pick(APPEARANCE_CATALOG.accessories.map(o => o.value), 9);
  const clothingAccessory = pick(APPEARANCE_CATALOG.clothingAccessories.map(o => o.value), 10);
  const hatColor   = pick(HAT_COLORS, 11);
  const glassColor = pick([0x90caf9, 0x212121, 0xb71c1c, 0x1b5e20, 0x880e4f], 12);
  const heightScale = 0.85 + rng(13) * 0.25; // 0.85 → 1.10
  const bodyScale = 0.90 + rng(14) * 0.22;
  const shirtStyle = pick(APPEARANCE_CATALOG.shirtStyles.map(o => o.value), 15);
  const pantsStyle = pick(APPEARANCE_CATALOG.pantsStyles.map(o => o.value), 16);
  const shoeStyle = pick(APPEARANCE_CATALOG.shoeStyles.map(o => o.value), 17);
  const eyebrowStyle = pick(APPEARANCE_CATALOG.eyebrowStyles.map(o => o.value), 18);
  const eyeSize = pick(APPEARANCE_CATALOG.eyeSizes.map(o => o.value), 19);
  const accessoryColor = pick(['#ffd700', '#cfd8dc', '#8d6e63', '#ef5350', '#42a5f5', '#ab47bc'], 20);
  const hasHat = ['cap', 'beanie', 'fedora', 'visor'].includes(accessoryStyle);
  const hasGlasses = ['glasses', 'sunglasses'].includes(accessoryStyle);

  return {
    gender: isFemale ? 'F' : 'M',
    skinTone,
    hairColor,
    hairStyle,
    eyebrowStyle,
    eyeSize,
    shirtColor,
    shirtStyle,
    pantsColor,
    pantsStyle,
    shoeColor,
    shoeStyle,
    eyeColor,
    lipColor,
    accessoryStyle,
    clothingAccessory,
    accessoryColor,
    hasHat,
    hasGlasses,
    hatColor,
    glassColor,
    heightScale,
    bodyScale,
  };
}

const SHO_COLORS_SAFE = SHOE_COLORS;

// ═══════════════════════════════════════════════════════════════
// CREATE CHARACTER — main factory function
// ═══════════════════════════════════════════════════════════════
export function createAgentCharacter(agent) {
  // Merge stored appearance with deterministic fallback
  const stored = agent._appearance || {};
  const det = getAgentAppearance(agent.id || agent.name || 'x', stored.gender || agent.gender);
  const a = { ...det, ...stored };

  const skin   = parseColor(a.skinTone);
  const hair   = parseColor(a.hairColor);
  const shirt  = parseColor(a.shirtColor);
  const pants  = parseColor(a.pantsColor);
  const shoe   = parseColor(a.shoeColor);
  const accent = parseColor(a.accentColor || '#ffd54f');
  const eye    = a.eyeColor || EYE_COLORS[0];
  const lip    = a.lipColor || (a.gender === 'F' ? LIPSTICK_COLORS[0] : parseColor('#8b3a3a'));
  const isFem  = a.gender === 'F';
  const clothingCoverage = clothingCoverageFor(a);
  const clothingColors = { skin, shirt, pants, shoe };
  const partColor = (part) => materialColor(clothingCoverage[part], clothingColors);

  // ── Root group ──────────────────────────────────────────────
  const agentGroup = new THREE.Group();
  agentGroup.name = 'agentRoot';

  // ── BODY GROUP ─────────────────────────────────────────────
  // Offset slightly up so breathing animation looks natural
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'body';
  bodyGroup.position.y = 0;

  // Torso — chibi proportions: wider, shorter, puffier
  // Female slightly narrower torso, wider hips
  const torsoProfile = getTorsoProfile(a, isFem);
  const { torsoW } = torsoProfile;
  const hipW = torsoProfile.hipW;
  const torso = box(0, torsoProfile.torsoY, 0, torsoW, torsoProfile.torsoH, torsoProfile.torsoD, partColor('torso'));
  torso.name = 'torsoMesh';
  bodyGroup.add(torso);

  // Belly / tummy area
  const bellyMesh = box(0, torsoProfile.bellyY, torsoProfile.bellyZ, torsoProfile.bellyW, torsoProfile.bellyH, torsoProfile.bellyD, partColor('belly'));
  bellyMesh.name = 'bellyMesh';
  bodyGroup.add(bellyMesh);

  // Hips
  const hipsMesh = box(0, torsoProfile.hipY, 0, hipW, torsoProfile.hipH, torsoProfile.hipD, partColor('hips'));
  hipsMesh.name = 'hipsMesh';
  bodyGroup.add(hipsMesh);

  // ── Arms ─────────────────────────────────────────────────
  // Arm groups pivot at shoulder
  // Left arm (character's left, our +X in right-hand scene coords)
  const leftArmGroup = new THREE.Group();
  leftArmGroup.name = 'leftArm';
  leftArmGroup.position.set(-(torsoW / 2 + 0.10), 0.80, 0);
  // Arm mesh — chunky upper arm
  const leftArmMesh = box(0, -0.14, 0, 0.14, 0.32, 0.14, partColor('upperArm'));
  leftArmMesh.name = 'leftUpperArmMesh';
  leftArmGroup.add(leftArmMesh);
  // Forearm
  const leftForearmMesh = box(0, -0.33, 0, 0.12, 0.16, 0.12, partColor('forearm'));
  leftForearmMesh.name = 'leftForearmMesh';
  leftArmGroup.add(leftForearmMesh);
  // Hand
  const leftHandMesh = box(0, -0.46, 0.01, 0.13, 0.13, 0.13, partColor('hand'));
  leftHandMesh.name = 'leftHandVoxel';
  leftArmGroup.add(leftHandMesh);
  const leftHandAnchor = makeAnchorFromMesh(leftHandMesh, 'leftHandMesh');
  leftArmGroup.add(leftHandAnchor);
  bodyGroup.add(leftArmGroup);

  const rightArmGroup = new THREE.Group();
  rightArmGroup.name = 'rightArm';
  rightArmGroup.position.set(torsoW / 2 + 0.10, 0.80, 0);
  const rightArmMesh = box(0, -0.14, 0, 0.14, 0.32, 0.14, partColor('upperArm'));
  rightArmMesh.name = 'rightUpperArmMesh';
  rightArmGroup.add(rightArmMesh);
  const rightForearmMesh = box(0, -0.33, 0, 0.12, 0.16, 0.12, partColor('forearm'));
  rightForearmMesh.name = 'rightForearmMesh';
  rightArmGroup.add(rightForearmMesh);
  const rightHandMesh = box(0, -0.46, 0.01, 0.13, 0.13, 0.13, partColor('hand'));
  rightHandMesh.name = 'rightHandVoxel';
  rightArmGroup.add(rightHandMesh);
  const rightHandAnchor = makeAnchorFromMesh(rightHandMesh, 'rightHandMesh');
  rightArmGroup.add(rightHandAnchor);
  addArmAccessoryToArm(leftArmGroup, a.clothingAccessory || 'none', a.accessoryColor || '#ffd700', 'left');
  addArmAccessoryToArm(rightArmGroup, a.clothingAccessory || 'none', a.accessoryColor || '#ffd700', 'right');
  bodyGroup.add(rightArmGroup);

  // ── Legs ──────────────────────────────────────────────────
  // Leg groups pivot at hip joint
  const leftLegGroup = new THREE.Group();
  leftLegGroup.name = 'leftLeg';
  leftLegGroup.position.set(-0.13, 0.44, 0);
  // Upper leg
  const leftUpperLegMesh = box(0, -0.12, 0, 0.18, 0.24, 0.18, partColor('upperLeg'));
  leftUpperLegMesh.name = 'leftUpperLegMesh';
  leftLegGroup.add(leftUpperLegMesh);
  // Lower leg
  const leftLowerLegMesh = box(0, -0.30, 0, 0.16, 0.18, 0.16, partColor('lowerLeg'));
  leftLowerLegMesh.name = 'leftLowerLegMesh';
  leftLegGroup.add(leftLowerLegMesh);
  // Shoe
  const leftShoe = box(0, -0.43, 0.04, 0.20, 0.10, 0.24, partColor('shoe'));
  leftShoe.name = 'shoeMesh';
  leftLegGroup.add(leftShoe);
  addPantsDetailsToLeg(leftLegGroup, a.pantsStyle || 'jeans', accent);
  addShoeDetailsToLeg(leftLegGroup, a.shoeStyle || 'sneakers', shoe, 'left');
  bodyGroup.add(leftLegGroup);

  const rightLegGroup = new THREE.Group();
  rightLegGroup.name = 'rightLeg';
  rightLegGroup.position.set(0.13, 0.44, 0);
  const rightUpperLegMesh = box(0, -0.12, 0, 0.18, 0.24, 0.18, partColor('upperLeg'));
  rightUpperLegMesh.name = 'rightUpperLegMesh';
  rightLegGroup.add(rightUpperLegMesh);
  const rightLowerLegMesh = box(0, -0.30, 0, 0.16, 0.18, 0.16, partColor('lowerLeg'));
  rightLowerLegMesh.name = 'rightLowerLegMesh';
  rightLegGroup.add(rightLowerLegMesh);
  const rightShoe = box(0, -0.43, 0.04, 0.20, 0.10, 0.24, partColor('shoe'));
  rightShoe.name = 'shoeMesh';
  rightLegGroup.add(rightShoe);
  addPantsDetailsToLeg(rightLegGroup, a.pantsStyle || 'jeans', accent);
  addShoeDetailsToLeg(rightLegGroup, a.shoeStyle || 'sneakers', shoe, 'right');
  bodyGroup.add(rightLegGroup);

  bodyGroup.add(buildTorsoShapeDetails(a, isFem, partColor('torso'), skin));
  bodyGroup.add(buildClothingDetails(a, skin, shirt, pants, shoe, isFem, torsoProfile));
  bodyGroup.add(buildClothingAccessory(a.clothingAccessory || 'none', a.accessoryColor || '#ffd700', isFem, torsoProfile));

  agentGroup.add(bodyGroup);

  // ── HEAD GROUP ────────────────────────────────────────────
  // Big chibi head — the star of the show
  const headGroup = new THREE.Group();
  headGroup.name = 'head';
  headGroup.position.set(0, 1.18, 0); // sits on top of torso

  // Head mesh — big and round-ish
  const headMesh = box(0, 0, 0, 0.56, 0.58, 0.52, skin);
  headMesh.name = 'headMesh';
  headGroup.add(headMesh);

  // Cheek blush (cute! slightly rosy), user-toggleable in the appearance editor.
  if (a.showCheeks !== false) {
    const blushColor = a.cheekColor ? parseColor(a.cheekColor) : (isFem ? 0xffb0a0 : 0xffbfb0);
    headGroup.add(box(-0.22, -0.08, 0.26, 0.10, 0.07, 0.02, blushColor));
    headGroup.add(box(0.22, -0.08, 0.26, 0.10, 0.07, 0.02, blushColor));
  }

  // ── Eyes ──
  const leftEyeGroup = buildEye('left', eye, isFem, a.eyeSize);
  leftEyeGroup.position.set(-0.15, 0.06, 0.27);
  // Apply skin color to eyelid
  leftEyeGroup.traverse(c => { if (c.name === 'eyelid') c.material = getMat(skin); });
  headGroup.add(leftEyeGroup);

  const rightEyeGroup = buildEye('right', eye, isFem, a.eyeSize);
  rightEyeGroup.position.set(0.15, 0.06, 0.27);
  rightEyeGroup.traverse(c => { if (c.name === 'eyelid') c.material = getMat(skin); });
  headGroup.add(rightEyeGroup);

  // ── Eyebrows ──
  const browColor = parseColor(a.hairColor);
  const leftBrow = buildEyebrow(a.eyebrowStyle || 'soft', 'left', browColor);
  leftBrow.name = 'leftEyebrow';
  leftBrow.position.set(-0.15, 0.18, 0.265);
  headGroup.add(leftBrow);

  const rightBrow = buildEyebrow(a.eyebrowStyle || 'soft', 'right', browColor);
  rightBrow.name = 'rightEyebrow';
  rightBrow.position.set(0.15, 0.18, 0.265);
  headGroup.add(rightBrow);

  // ── Nose ──
  const noseColor = parseColor(a.skinTone) - 0x0a0505; // slightly darker
  const nose = box(0, -0.02, 0.27, 0.07, 0.07, 0.04, Math.max(0, noseColor));
  nose.name = 'nose';
  headGroup.add(nose);

  // ── Mouth ──
  const mouthGroup = buildMouth('smile', lip);
  mouthGroup.position.set(0, -0.14, 0.268);
  mouthGroup.userData._mouthType = 'smile';
  headGroup.add(mouthGroup);

  // ── Eyelashes (female only) ──
  if (isFem) {
    const leftLashes = buildEyelashes('left');
    leftLashes.name = 'leftEyelashes';
    leftLashes.position.set(-0.15, 0.08, 0.268);
    headGroup.add(leftLashes);

    const rightLashes = buildEyelashes('right');
    rightLashes.name = 'rightEyelashes';
    rightLashes.position.set(0.15, 0.08, 0.268);
    headGroup.add(rightLashes);
  }

  // ── Hair ──
  const hairGroup = buildHair(a.hairStyle, hair, isFem);
  hairGroup.name = 'hair';
  hairGroup.position.set(0, 0, 0); // buildHair is authored in head-local coords; keep it flush to the scalp
  headGroup.add(hairGroup);

  // ── Accessories ──
  const accessoryStyle = a.accessoryStyle || (a.hasHat ? 'cap' : a.hasGlasses ? 'glasses' : 'none');
  if (a.hasHat || ['cap', 'beanie', 'fedora', 'visor'].includes(accessoryStyle)) {
    const hatGroup = buildHat(a.hatColor, accessoryStyle);
    hatGroup.name = 'hat';
    hatGroup.position.set(0, accessoryStyle === 'beanie' ? 0.34 : 0.38, 0);
    headGroup.add(hatGroup);
  }
  if (a.hasGlasses || ['glasses', 'sunglasses'].includes(accessoryStyle)) {
    const glassGroup = buildGlasses(a.glassColor, accessoryStyle);
    glassGroup.name = 'glasses';
    glassGroup.position.set(0, 0.06, 0);
    headGroup.add(glassGroup);
  }

  // ── Ears (small subtle side bumps) ──
  headGroup.add(box(-0.29, 0.02, 0, 0.06, 0.10, 0.10, skin));
  headGroup.add(box(0.29, 0.02, 0, 0.06, 0.10, 0.10, skin));

  agentGroup.add(headGroup);

  mergeAgentCharacterVoxelParts(agentGroup);

  // ── PRESENCE STATUS DOT ───────────────────────────────────
  const dotGeo = new THREE.SphereGeometry(0.055, 6, 6);
  const dotMat = new THREE.MeshBasicMaterial({ color: getAgentPresenceDotColor(agent?.status || 'idle'), transparent: true, opacity: 0.92 });
  const statusDot = new THREE.Mesh(dotGeo, dotMat);
  statusDot.position.set(0.42, 1.98, 0);
  statusDot.name = 'statusDot';
  statusDot.userData.presenceStatusIndicator = true;
  statusDot.userData.baseScale = 1;
  agentGroup.add(statusDot);

  // ── SPEECH BUBBLE ─────────────────────────────────────────
  const speechCanvas = document.createElement('canvas');
  speechCanvas.width = 64; speechCanvas.height = 64;
  const sCtx = speechCanvas.getContext('2d');
  sCtx.font = '40px serif';
  sCtx.textAlign = 'center'; sCtx.textBaseline = 'middle';
  sCtx.fillText('💬', 32, 34);
  const speechTex = new THREE.CanvasTexture(speechCanvas);
  const speechSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: speechTex, transparent: true, depthTest: false }));
  speechSprite.scale.set(0.65, 0.65, 1);
  speechSprite.position.set(-0.55, 2.20, 0);
  speechSprite.name = 'speechBubble';
  speechSprite.visible = false;
  agentGroup.add(speechSprite);

  // ── NAME LABEL ────────────────────────────────────────────
  const label = makeNameLabel((agent.emoji || '🤖') + ' ' + (agent.name || agent.id), a.shirtColor || '#ffd600');
  label.position.set(0, 2.35, 0);
  label.name = 'nameLabel';
  agentGroup.add(label);

  // ── STORE ANIMATION STATE ─────────────────────────────────
  agentGroup.userData.charState = {
    expression: 'neutral',
    blinkTimer: 0,
    blinkState: false,
    blinkDuration: 0,
    nextBlinkIn: 120 + Math.random() * 180, // ~3-5 seconds at 60fps
    headTiltTimer: 0,
    breathPhase: Math.random() * Math.PI * 2,
    walkPhase: Math.random() * Math.PI * 2,
    talkPhase: Math.random() * Math.PI * 2,
    sleepPhase: Math.random() * Math.PI * 2,
    zParticles: [],
    idleAction: 'stand',
    idleTimer: 0,
    idleActionDuration: 3 + Math.random() * 5,
  };

  // Store references for fast access during animation
  agentGroup.userData.parts = {
    bodyGroup,
    headGroup,
    headBaseY: headGroup.position.y,
    headBaseZ: headGroup.position.z,
    leftArm: leftArmGroup,
    rightArm: rightArmGroup,
    leftLeg: leftLegGroup,
    rightLeg: rightLegGroup,
    leftEye: leftEyeGroup,
    rightEye: rightEyeGroup,
    leftBrow,
    rightBrow,
    mouthGroup,
    statusDot,
    isFemale: isFem,
    skin,
    visualParts: {
      torso, bellyMesh, hipsMesh,
      leftArmMesh, rightArmMesh, leftForearmMesh, rightForearmMesh, leftHandMesh: leftHandAnchor, rightHandMesh: rightHandAnchor,
      leftUpperLegMesh, rightUpperLegMesh, leftLowerLegMesh, rightLowerLegMesh,
      leftShoe, rightShoe,
    },
    clothingCoverage,
  };

  // Scale the whole character — 0.8 base × height variation
  const totalScale = 0.8 * (a.heightScale || 1.0);
  const bodyScale = a.bodyScale || 1.0;
  bodyGroup.scale.x *= bodyScale;
  bodyGroup.scale.z *= bodyScale;
  agentGroup.scale.set(totalScale, totalScale, totalScale);

  return agentGroup;
}

// ═══════════════════════════════════════════════════════════════
// UPDATE ANIMATION — called every frame
// ═══════════════════════════════════════════════════════════════
export function updateAgentAnimation(agent, dt, isMoving, isSocializing) {
  const g = agent._group3d;
  if (!g) return;

  const tick = agent._tick || 0;
  const cs = g.userData.charState;
  const parts = g.userData.parts;
  if (!cs || !parts) return;

  const status = normalizeAgentAnimationStatus(agent.status);
  const bedActivityKind = String(agent._idleActivity?.kind || '');
  const isClinicService = bedActivityKind === 'bed-clinic-service' && agent._idleActivity?.phase === 'active';
  const isExamChairPatient = bedActivityKind === 'exam-chair-patient' && agent._idleActivity?.phase === 'active';
  const isExamChairService = bedActivityKind === 'exam-chair-service' && agent._idleActivity?.phase === 'active';
  const isCafeCounterUse = bedActivityKind.startsWith('cafe-counter-') && agent._idleActivity?.phase === 'active';
  const isCafeCounterService = isCafeCounterUse && bedActivityKind === 'cafe-counter-serve';
  const isFoodTruckCounterUse = bedActivityKind.startsWith('food-truck-counter-') && agent._idleActivity?.phase === 'active';
  const isFoodTruckCounterService = isFoodTruckCounterUse && bedActivityKind === 'food-truck-counter-serve';
  const isSmallCafeTableUse = bedActivityKind.startsWith('small-cafe-table-') && agent._idleActivity?.phase === 'active';
  const isSmallCafeTableSocial = isSmallCafeTableUse && bedActivityKind === 'small-cafe-table-talk';
  const isSmallCafeTableSetDown = isSmallCafeTableUse && bedActivityKind === 'small-cafe-table-setdown';
  const isOutdoorCafeTableUse = (bedActivityKind.startsWith('outdoor-cafe-table-') || bedActivityKind.startsWith('picnic-table-')) && agent._idleActivity?.phase === 'active';
  const isOutdoorCafeTableSocial = isOutdoorCafeTableUse && (bedActivityKind === 'outdoor-cafe-table-socialize' || bedActivityKind === 'picnic-table-socialize');
  const isOutdoorCafeTableSetDown = isOutdoorCafeTableUse && (bedActivityKind === 'outdoor-cafe-table-setdown' || bedActivityKind === 'picnic-table-setdown');
  const isOutdoorCafeTableEatDrink = isOutdoorCafeTableUse && (bedActivityKind === 'outdoor-cafe-table-eat' || bedActivityKind === 'outdoor-cafe-table-drink' || bedActivityKind === 'picnic-table-eat' || bedActivityKind === 'picnic-table-drink');
  const isPatioTableUse = bedActivityKind.startsWith('patio-table-') && agent._idleActivity?.phase === 'active';
  const isPatioTableSocial = isPatioTableUse && bedActivityKind === 'patio-table-talk';
  const isPatioTableSetDown = isPatioTableUse && bedActivityKind === 'patio-table-setdown';
  const isCheckoutCounterUse = bedActivityKind.startsWith('checkout-counter-') && agent._idleActivity?.phase === 'active';
  const isCheckoutCounterCashier = isCheckoutCounterUse && bedActivityKind === 'checkout-counter-cashier';
  const isCheckoutRegisterUse = bedActivityKind.startsWith('checkout-register-') && agent._idleActivity?.phase === 'active';
  const isCheckoutRegisterCashier = isCheckoutRegisterUse && bedActivityKind === 'checkout-register-cashier';
  const isTrashBinDispose = (bedActivityKind.startsWith('trash-bin-') || bedActivityKind.startsWith('outdoor-trash-can-')) && agent._idleActivity?.phase === 'active';
  const isCoffeeMachineUse = bedActivityKind.startsWith('coffee-machine-') && agent._idleActivity?.phase === 'active';
  const isWaterCoolerUse = bedActivityKind.startsWith('water-cooler-') && agent._idleActivity?.phase === 'active';
  const isCoffeeDeskConsume = (bedActivityKind.startsWith('coffee-desk-') || bedActivityKind.startsWith('water-desk-') || bedActivityKind.startsWith('vending-desk-') || bedActivityKind.startsWith('microwave-desk-')) && agent._idleActivity?.phase === 'active';
  const isVendingMachineUse = bedActivityKind.startsWith('vending-machine-') && agent._idleActivity?.phase === 'active';
  const isFridgeUse = bedActivityKind.startsWith('fridge-') && agent._idleActivity?.phase === 'active';
  const isKitchenIslandUse = bedActivityKind.startsWith('kitchen-island-') && agent._idleActivity?.phase === 'active';
  const isKitchenIslandEat = isKitchenIslandUse && bedActivityKind === 'kitchen-island-eat';
  const isGrillUse = bedActivityKind.startsWith('grill-') && agent._idleActivity?.phase === 'active';
  const isParkBenchSeated = bedActivityKind.startsWith('park-bench-') && agent._idleActivity?.phase === 'active';
  const isParkBenchReading = isParkBenchSeated && bedActivityKind === 'park-bench-read';
  const isParkBenchSocializing = isParkBenchSeated && bedActivityKind === 'park-bench-socialize';
  const isParkBenchStandingUp = agent._schedPhase === 'park-bench-stand-up';
  const isBusStopWaiting = (bedActivityKind.startsWith('bus-stop-') || (bedActivityKind === 'outdoor-node-sit' && agent._idleActivity?.outdoorNodeType === 'wait')) && agent._idleActivity?.phase === 'active';
  const isCrosswalkCrossing = (bedActivityKind.startsWith('crosswalk-node-') || agent._idleActivity?.outdoorNodeType === 'crossing') && agent._idleActivity?.phase === 'active';
  const isPathNodeStroll = (bedActivityKind.startsWith('path-node-') || agent._idleActivity?.outdoorNodeType === 'stroll') && agent._idleActivity?.phase === 'active';
  const isOutdoorPlanterUse = bedActivityKind.startsWith('outdoor-planter-') && agent._idleActivity?.phase === 'active';
  const isFlowerBedUse = bedActivityKind.startsWith('flower-bed-') && agent._idleActivity?.phase === 'active';
  const isFountainUse = bedActivityKind.startsWith('fountain-') && agent._idleActivity?.phase === 'active';
  const isShadeTreeUse = bedActivityKind.startsWith('shade-tree-') && agent._idleActivity?.phase === 'active';
  const isShadeTreeGather = isShadeTreeUse && bedActivityKind === 'shade-tree-gather';
  const isShadeTreeRead = isShadeTreeUse && bedActivityKind === 'shade-tree-read';
  const isGazeboPavilionUse = bedActivityKind.startsWith('gazebo-pavilion-') && agent._idleActivity?.phase === 'active';
  const isPlaygroundSlideUse = bedActivityKind.startsWith('playground-slide-') && agent._idleActivity?.phase === 'active';
  const isPlaygroundSwingUse = bedActivityKind.startsWith('playground-swing-') && agent._idleActivity?.phase === 'active';
  const isPlaygroundSwingWaiting = isPlaygroundSwingUse && bedActivityKind === 'playground-swing-wait-turn';
  const isPondDockUse = bedActivityKind.startsWith('pond-dock-') && agent._idleActivity?.phase === 'active';
  const isOutdoorStageUse = bedActivityKind.startsWith('outdoor-stage-') && agent._idleActivity?.phase === 'active';
  const isMicrowaveUse = bedActivityKind.startsWith('microwave-') && !bedActivityKind.startsWith('microwave-desk-') && agent._idleActivity?.phase === 'active';
  const isCoffeePickupShelfUse = bedActivityKind.startsWith('coffee-pickup-shelf-') && agent._idleActivity?.phase === 'active';
  const isArcadeMachinePlay = bedActivityKind.startsWith('arcade-machine-') && agent._idleActivity?.phase === 'active';
  const isGamingStationPlay = bedActivityKind.startsWith('gaming-station-') && agent._idleActivity?.phase === 'active';
  const isPingPongPlay = bedActivityKind.startsWith('pingpong-') && agent._idleActivity?.phase === 'active';
  const isPoolTablePlay = bedActivityKind.startsWith('pool-table-') && agent._idleActivity?.phase === 'active';
  const isPoolTableWatch = isPoolTablePlay && bedActivityKind === 'pool-table-watch';
  const isMeetingTable = bedActivityKind.startsWith('meeting-table') && agent._idleActivity?.phase === 'active';
  const isSmallRoundMeetingTable = bedActivityKind.startsWith('small-round-meeting-table-') && agent._idleActivity?.phase === 'active';
  const isPrinterScannerUse = bedActivityKind.startsWith('printer-scanner-') && agent._idleActivity?.phase === 'active';
  const isToolCartUse = bedActivityKind.startsWith('tool-cart-') && agent._idleActivity?.phase === 'active';
  const isToolCartPrep = isToolCartUse && bedActivityKind === 'tool-cart-prep-build';
  const isWorkbenchUse = bedActivityKind.startsWith('workbench-') && agent._idleActivity?.phase === 'active';
  const isWorkbenchBuild = isWorkbenchUse && bedActivityKind === 'workbench-build-repair';
  const isStorageBoxesUse = bedActivityKind.startsWith('storage-boxes-') && agent._idleActivity?.phase === 'active';
  const isStorageBoxesOpen = isStorageBoxesUse && bedActivityKind === 'storage-boxes-open-check';
  const isServerRackUse = bedActivityKind.startsWith('server-rack-') && agent._idleActivity?.phase === 'active';
  const isDiagnosticStationUse = bedActivityKind.startsWith('diagnostic-station-') && agent._idleActivity?.phase === 'active';
  const isMedicalSupplyCabinetBrowse = bedActivityKind.startsWith('medical-supply-cabinet-') && agent._idleActivity?.phase === 'active';
  const isSupplyCabinetBrowse = bedActivityKind.startsWith('supply-cabinet-') && agent._idleActivity?.phase === 'active';
  const isStandingDeskWork = bedActivityKind.startsWith('standing-desk-') && agent._idleActivity?.phase === 'active';
  const isLaptopMonitorWork = bedActivityKind.startsWith('laptop-monitor-') && agent._idleActivity?.phase === 'active';
  const isStandingDeskAdjust = isStandingDeskWork && bedActivityKind.includes('adjust');
  const isDraftingTableWork = bedActivityKind.startsWith('drafting-table-') && agent._idleActivity?.phase === 'active';
  const isWhiteboardUse = bedActivityKind.startsWith('whiteboard-') && agent._idleActivity?.phase === 'active';
  const isTrainingMatTraining = bedActivityKind.startsWith('training-mat-') && agent._idleActivity?.phase === 'active';
  const isOutdoorExerciseStationTraining = bedActivityKind.startsWith('outdoor-exercise-station-') && agent._idleActivity?.phase === 'active';
  const isTreadmillTraining = (bedActivityKind.startsWith('treadmill-') || isTrainingMatTraining || isOutdoorExerciseStationTraining) && agent._idleActivity?.phase === 'active';
  const isTreadmillPractice = isTreadmillTraining && (bedActivityKind === 'treadmill-practice' || bedActivityKind === 'training-mat-practice');
  const isDumbbellRackUse = bedActivityKind.startsWith('dumbbell-rack-') && agent._idleActivity?.phase === 'active';
  const isGymBenchExercise = bedActivityKind.startsWith('gym-bench-') && agent._idleActivity?.phase === 'active';
  const isGymBenchStandingUp = agent._schedPhase === 'gym-bench-stand-up';
  const isBookshelfBrowse = bedActivityKind.startsWith('bookshelf-') && agent._idleActivity?.phase === 'active';
  const isCurtainsAdjust = bedActivityKind.startsWith('curtains-') && agent._idleActivity?.phase === 'active';
  const isCurtainsOpenClose = isCurtainsAdjust && (bedActivityKind === 'curtains-open' || bedActivityKind === 'curtains-close');
  const isBulletinBoardRead = bedActivityKind.startsWith('bulletin-board-') && agent._idleActivity?.phase === 'active';
  const isOutdoorNoticeBoardRead = bedActivityKind.startsWith('outdoor-notice-board-') && agent._idleActivity?.phase === 'active';
  const isWallArtInspect = bedActivityKind.startsWith('wall-art-') && agent._idleActivity?.phase === 'active';
  const isMenuBoardRead = bedActivityKind.startsWith('menu-board-') && agent._idleActivity?.phase === 'active';
  const isTeachingPodiumUse = bedActivityKind.startsWith('teaching-podium-') && agent._idleActivity?.phase === 'active';
  const isTeachingPodiumBrief = isTeachingPodiumUse && bedActivityKind === 'teaching-podium-brief';
  const isDresserBrowse = bedActivityKind.startsWith('dresser-') && agent._idleActivity?.phase === 'active';
  const isWardrobeBrowse = bedActivityKind.startsWith('wardrobe-') && agent._idleActivity?.phase === 'active';
  const isNightstandInspect = bedActivityKind.startsWith('nightstand-') && agent._idleActivity?.phase === 'active';
  const isSideTableInspect = bedActivityKind.startsWith('side-table-') && agent._idleActivity?.phase === 'active';
  const isTvStandUse = bedActivityKind.startsWith('tv-stand-') && agent._idleActivity?.phase === 'active';
  const isMirrorInspect = bedActivityKind.startsWith('mirror-') && agent._idleActivity?.phase === 'active';
  const isClothingRackBrowse = bedActivityKind.startsWith('clothing-rack-') && agent._idleActivity?.phase === 'active';
  const isDisplayMannequinPreview = bedActivityKind.startsWith('display-mannequin-') && agent._idleActivity?.phase === 'active';
  const isAccessoryDisplayStandBrowse = bedActivityKind.startsWith('accessory-display-stand-') && agent._idleActivity?.phase === 'active';
  const isDisplayCaseBrowse = bedActivityKind.startsWith('display-case-') && agent._idleActivity?.phase === 'active';
  const isShopShelfBrowse = bedActivityKind.startsWith('shop-shelf-') && agent._idleActivity?.phase === 'active';
  const isPantryShelfBrowse = bedActivityKind.startsWith('pantry-shelf-') && agent._idleActivity?.phase === 'active';
  const isSalonMirrorStationUse = bedActivityKind.startsWith('salon-mirror-station-') && agent._idleActivity?.phase === 'active';
  const isSalonMirrorStationService = isSalonMirrorStationUse && agent._idleActivity?.mirrorRole === 'stylist';
  const isPlainChairSitting = (bedActivityKind.startsWith('chair-') || bedActivityKind.startsWith('office-chair-')) && agent._idleActivity?.phase === 'active';
  const isOfficeChairWork = bedActivityKind === 'office-chair-work' && agent._idleActivity?.phase === 'active';
  const isSectionalSofaLounging = bedActivityKind.startsWith('sectional-sofa-') && agent._idleActivity?.phase === 'active';
  const isCouchLounging = (bedActivityKind.startsWith('couch-') && agent._idleActivity?.phase === 'active') || isSectionalSofaLounging;
  const isCouchSocializing = isCouchLounging && (bedActivityKind === 'couch-socialize' || bedActivityKind === 'sectional-sofa-socialize');
  const isCouchStandingUp = agent._schedPhase === 'couch-stand-up' || agent._schedPhase === 'sectional-sofa-stand-up';
  const isLoveseatLounging = bedActivityKind.startsWith('loveseat-') && agent._idleActivity?.phase === 'active';
  const isLoveseatSocializing = isLoveseatLounging && bedActivityKind === 'loveseat-talk';
  const isLoveseatStandingUp = agent._schedPhase === 'loveseat-stand-up';
  const isArmchairLounging = bedActivityKind.startsWith('armchair-') && agent._idleActivity?.phase === 'active';
  const isArmchairSocializing = isArmchairLounging && bedActivityKind === 'armchair-talk';
  const isArmchairStandingUp = agent._schedPhase === 'armchair-stand-up';
  const isHallwayBenchWaiting = bedActivityKind.startsWith('hallway-bench-') && agent._idleActivity?.phase === 'active';
  const isHallwayBenchStandingUp = agent._schedPhase === 'hallway-bench-stand-up';
  const isBarStoolSitting = bedActivityKind.startsWith('bar-stool-') && agent._idleActivity?.phase === 'active';
  const isBarStoolChatting = isBarStoolSitting && bedActivityKind === 'bar-stool-chat';
  const isBarStoolStandingUp = agent._schedPhase === 'bar-stool-stand-up';
  const isDiningChairSitting = bedActivityKind.startsWith('dining-chair-') && agent._idleActivity?.phase === 'active';
  const isDiningChairEating = isDiningChairSitting && bedActivityKind === 'dining-chair-eat';
  const isDiningChairTalking = isDiningChairSitting && bedActivityKind === 'dining-chair-talk';
  const isDiningChairStandingUp = agent._schedPhase === 'dining-chair-stand-up';
  const isPatioChairSitting = bedActivityKind.startsWith('patio-chair-') && agent._idleActivity?.phase === 'active';
  const isPatioChairTalking = isPatioChairSitting && bedActivityKind === 'patio-chair-talk';
  const isPatioChairStandingUp = agent._schedPhase === 'patio-chair-stand-up';
  const isConferenceChairSitting = bedActivityKind.startsWith('conference-chair-') && agent._idleActivity?.phase === 'active';
  const isConferenceChairMeeting = isConferenceChairSitting && (bedActivityKind === 'conference-chair-meeting' || bedActivityKind === 'conference-chair-listen');
  const isConferenceChairStandingUp = agent._schedPhase === 'conference-chair-stand-up';
  const isBarberChairSitting = bedActivityKind.startsWith('barber-chair-') && agent._idleActivity?.phase === 'active' && agent._idleActivity?.barberRole !== 'stylist';
  const isBarberChairService = bedActivityKind.startsWith('barber-chair-') && agent._idleActivity?.phase === 'active' && agent._idleActivity?.barberRole === 'stylist';
  const isBarberChairStandingUp = agent._schedPhase === 'barber-chair-stand-up';
  const isBedResting = bedActivityKind.startsWith('bed-') && agent._idleActivity?.phase === 'active' && !isClinicService;
  const isDreaming = isBedResting && bedActivityKind === 'bed-dream';
  const isWaking = agent._schedPhase === 'wake-stand';
  const isSleeping = (agent._schedPhase === 'sleep') || isBedResting;
  const workSpot = agent._activeWorkSpot || null;
  const atRealWorkSpot = !!(
    workSpot &&
    workSpot.kind !== 'legacy-grid' &&
    Number.isFinite(workSpot.apiX) &&
    Number.isFinite(workSpot.apiZ) &&
    Math.hypot((agent.x || 0) - workSpot.apiX, (agent.y || 0) - workSpot.apiZ) <= 24
  );
  const isDeskSeated = !!(agent._atDesk || atRealWorkSpot);
  const isWorking = isDeskSeated && status === 'working';
  const isDeskIdleSeated = isDeskSeated && !isWorking;
  const isTalking = isSocializing;

  // ── DETERMINE EXPRESSION ───────────────────────────────────
  let targetExpr = 'neutral';
  if (isSleeping)      targetExpr = 'sleeping';
  else if (isWaking)   targetExpr = 'neutral';
  else if (isMoving)   targetExpr = 'happy';
  else if (isCafeCounterService || isFoodTruckCounterService || isCheckoutCounterCashier || isCheckoutRegisterCashier) targetExpr = 'working';
  else if (isCafeCounterUse || isFoodTruckCounterUse || isCheckoutCounterUse || isCheckoutRegisterUse) targetExpr = 'talking';
  else if (isTrashBinDispose) targetExpr = 'working';
  else if (isSmallCafeTableUse || isOutdoorCafeTableUse || isPatioTableUse) targetExpr = (isSmallCafeTableSocial || isOutdoorCafeTableSocial || isPatioTableSocial) ? 'talking' : 'happy';
  else if (isCoffeeMachineUse || isVendingMachineUse || isFridgeUse || isKitchenIslandUse || isGrillUse || isOutdoorPlanterUse || isFlowerBedUse || isFountainUse || isShadeTreeUse || isGazeboPavilionUse || isPondDockUse || isOutdoorStageUse || isMicrowaveUse || isCoffeePickupShelfUse) targetExpr = isShadeTreeRead ? 'focused' : ((isShadeTreeGather || (isGazeboPavilionUse && bedActivityKind === 'gazebo-pavilion-gather') || (isOutdoorStageUse && bedActivityKind !== 'outdoor-stage-watch')) ? 'talking' : 'happy');
  else if (isArcadeMachinePlay || isGamingStationPlay) targetExpr = tick % 180 < 120 ? 'happy' : 'working';
  else if (isPingPongPlay || isPoolTablePlay) targetExpr = tick % 180 < 120 ? 'happy' : 'working';
  else if (isMeetingTable || isSmallRoundMeetingTable) targetExpr = tick % 220 < 110 ? 'talking' : 'working';
  else if (isPrinterScannerUse || isToolCartUse || isWorkbenchUse || isStorageBoxesUse || isServerRackUse || isDiagnosticStationUse || isMedicalSupplyCabinetBrowse || isSupplyCabinetBrowse) targetExpr = 'working';
  else if (isOfficeChairWork || isStandingDeskWork || isLaptopMonitorWork || isDraftingTableWork || isWhiteboardUse) targetExpr = isWhiteboardUse && bedActivityKind === 'whiteboard-teach' ? 'talking' : 'working';
  else if (isDresserBrowse || isWardrobeBrowse || isNightstandInspect || isTvStandUse || isMirrorInspect || isAccessoryDisplayStandBrowse || isDisplayCaseBrowse || isShopShelfBrowse || isPantryShelfBrowse || isDisplayMannequinPreview || isSalonMirrorStationUse) targetExpr = 'happy';
  else if (isBookshelfBrowse) targetExpr = bedActivityKind === 'bookshelf-read' ? 'working' : 'happy';
  else if (isCurtainsAdjust) targetExpr = isCurtainsOpenClose ? 'working' : 'happy';
  else if (isBulletinBoardRead || isOutdoorNoticeBoardRead) targetExpr = (bedActivityKind === 'bulletin-board-point' || bedActivityKind === 'outdoor-notice-board-inspect') ? 'talking' : 'working';
  else if (isMenuBoardRead) targetExpr = bedActivityKind === 'menu-board-point' ? 'talking' : 'working';
  else if (isTeachingPodiumUse) targetExpr = tick % 180 < 105 ? 'talking' : 'working';
  else if (isTreadmillTraining) targetExpr = tick % 180 < 120 ? 'happy' : 'neutral';
  else if (isGymBenchExercise) targetExpr = tick % 180 < 120 ? 'working' : 'happy';
  else if (isCouchSocializing || isLoveseatSocializing || isArmchairSocializing || isBarStoolChatting || isDiningChairTalking || isDiningChairEating || isPatioChairTalking || isConferenceChairMeeting) targetExpr = tick % 220 < 110 ? 'talking' : 'happy';
  else if (isExamChairService || isBarberChairService) targetExpr = 'working';
  else if (isPlainChairSitting || isCouchLounging || isLoveseatLounging || isArmchairLounging || isParkBenchSeated || isHallwayBenchWaiting || isBusStopWaiting || isBarStoolSitting || isDiningChairSitting || isPatioChairSitting || isConferenceChairSitting || isBarberChairSitting || isExamChairPatient) targetExpr = isParkBenchReading ? 'focused' : (isParkBenchSocializing ? 'talking' : 'happy');
  else if (isWorking)  targetExpr = 'working';
  else if (isDeskIdleSeated) targetExpr = 'happy';
  else if (isTalking)  targetExpr = tick % 240 < 120 ? 'talking' : 'happy'; // slower cycle (4s instead of 1.5s)
  else                 targetExpr = 'neutral';

  // Occasional random happy/surprised — less frequent
  if (!isSleeping && !isWaking && !isWorking && tick % 600 === 0) {
    targetExpr = Math.random() < 0.3 ? 'surprised' : 'happy';
  }

  // Apply expression with cooldown — don't rebuild mouth geometry too often
  // Minimum 30 frames (~0.5s) between expression changes to prevent twitchiness
  if (!cs._exprCooldown) cs._exprCooldown = 0;
  if (cs._exprCooldown > 0) cs._exprCooldown--;
  
  if (cs.expression !== targetExpr && cs._exprCooldown <= 0) {
    cs.expression = targetExpr;
    cs._exprCooldown = 30; // wait at least 30 frames before next change
    _applyExpression(parts, EXPRESSIONS[targetExpr] || EXPRESSIONS.neutral, agent._appearance?.lipColor || 0x8b3a3a);
  }

  // ── BLINKING ──────────────────────────────────────────────
  if (!isSleeping) {
    cs.blinkTimer++;
    if (!cs.blinkState && cs.blinkTimer >= cs.nextBlinkIn) {
      cs.blinkState = true;
      cs.blinkTimer = 0;
      cs.blinkDuration = 0;
      cs.nextBlinkIn = 180 + Math.random() * 240; // 3-5 sec
    }
    if (cs.blinkState) {
      cs.blinkDuration++;
      const eyeScale = cs.blinkDuration < 2 ? 0.5 :
                       cs.blinkDuration < 4 ? 0.0 :
                       cs.blinkDuration < 6 ? 0.5 : 1.0;
      _setEyelids(parts, eyeScale < 0.5);
      if (cs.blinkDuration >= 6) {
        cs.blinkState = false;
        _setEyelids(parts, false);
      }
    }
  } else {
    // Sleeping — eyes always closed
    _setEyelids(parts, true);
  }

  // ── BREATHING (always) ────────────────────────────────────
  cs.breathPhase += dt * 0.8;
  const breathY = Math.sin(cs.breathPhase) * 0.012;
  parts.bodyGroup.position.y = breathY;

  // ── WALKING / RUNNING ANIMATION ─────────────────────────────
  const isRunning = agent._isRunning || false;
  let requestedAnimationId = agent._idleActivity?.animationId;
  if (isArcadeMachinePlay || isGamingStationPlay) requestedAnimationId = 'play-game';
  else if (isPingPongPlay) requestedAnimationId = 'play-pingpong';
  else if (isPoolTablePlay) requestedAnimationId = isPoolTableWatch ? 'gather-talk' : 'pool-table-play';
  else if (isOfficeChairWork) requestedAnimationId = 'office-chair-work';
  else if (isMeetingTable || isSmallRoundMeetingTable || isConferenceChairMeeting) requestedAnimationId = 'meeting-sit-talk';
  else if (isDiagnosticStationUse) requestedAnimationId = 'diagnostic-station-use';
  else if (isToolCartUse) requestedAnimationId = 'tool-cart-select';
  else if (isWorkbenchUse) requestedAnimationId = 'workbench-tool-use';
  else if (isStorageBoxesUse) requestedAnimationId = 'storage-boxes-inspect-open';
  else if (isPrinterScannerUse) requestedAnimationId = 'printer-scanner-use';
  else if (isLaptopMonitorWork) requestedAnimationId = 'laptop-monitor-work';
  else if (isStandingDeskWork) requestedAnimationId = 'standing-desk-work';
  else if (isDraftingTableWork) requestedAnimationId = 'plan-draw';
  else if (isWhiteboardUse) requestedAnimationId = 'write-teach';
  else if (isTeachingPodiumUse) requestedAnimationId = 'stand-teach-point';
  else if (isTvStandUse) requestedAnimationId = 'tv-stand-remote-inspect';
  else if (isTreadmillTraining) requestedAnimationId = 'train-practice';
  else if (isGymBenchExercise) requestedAnimationId = 'gym-bench-exercise';
  else if (isGazeboPavilionUse) requestedAnimationId = 'gazebo-pavilion-social-rest';
  else if (isShadeTreeUse) requestedAnimationId = 'shade-tree-relax-read-gather';
  else if (isPondDockUse) requestedAnimationId = 'pond-dock-view-relax';
  else if (isOutdoorStageUse) requestedAnimationId = 'outdoor-stage-perform-watch-gather';
  else if (isOutdoorPlanterUse || isFlowerBedUse || isFountainUse || isServerRackUse || isMedicalSupplyCabinetBrowse || isSupplyCabinetBrowse || isDresserBrowse || isWardrobeBrowse || isNightstandInspect || isTvStandUse || isMirrorInspect || isAccessoryDisplayStandBrowse || isDisplayCaseBrowse || isShopShelfBrowse || isPantryShelfBrowse || isDisplayMannequinPreview || (isSalonMirrorStationUse && !isSalonMirrorStationService) || isClothingRackBrowse || isBookshelfBrowse || isBulletinBoardRead || isOutdoorNoticeBoardRead || isMenuBoardRead) requestedAnimationId = 'inspect-browse';
  else if (isCheckoutCounterUse || isCheckoutRegisterUse) requestedAnimationId = 'checkout-service';
  else if (isFoodTruckCounterUse) requestedAnimationId = isFoodTruckCounterService ? 'service-checkup' : 'order-food-drink';
  else if (isCoffeeDeskConsume) requestedAnimationId = agent._idleActivity?.animationId || 'coffee-desk-sip';
  else if (isFridgeUse) requestedAnimationId = 'fridge-use';
  else if (isKitchenIslandUse) requestedAnimationId = isKitchenIslandEat ? 'order-food-drink' : 'kitchen-island-prep';
  else if (isGrillUse) requestedAnimationId = 'grill-cook';
  else if (isParkBenchSeated) requestedAnimationId = 'park-bench-sit-rest-read-talk';
  else if (isPlaygroundSwingUse) requestedAnimationId = isPlaygroundSwingWaiting ? 'bus-stop-wait' : 'playground-swing-sit-swing';
  else if (isBusStopWaiting) requestedAnimationId = 'bus-stop-wait';
  else if (isCrosswalkCrossing) requestedAnimationId = 'crosswalk-cross';
  else if (isPathNodeStroll) requestedAnimationId = 'path-node-stroll';
  else if (isMicrowaveUse) requestedAnimationId = 'microwave-use';
  else if (isCoffeePickupShelfUse || isSmallCafeTableSetDown || isOutdoorCafeTableSetDown || isPatioTableSetDown) requestedAnimationId = 'stand-pickup-setdown';
  else if (isExamChairService || isBarberChairService || isSalonMirrorStationService || isCafeCounterService || isFoodTruckCounterService) requestedAnimationId = 'service-checkup';
  else if (isPlainChairSitting || isCouchLounging || isLoveseatLounging || isArmchairLounging || isParkBenchSeated || isHallwayBenchWaiting || isBusStopWaiting || isBarStoolSitting || isDiningChairSitting || isPatioChairSitting || isConferenceChairSitting || isBarberChairSitting || isExamChairPatient || isSmallCafeTableUse || isOutdoorCafeTableUse || isPatioTableUse) {
    requestedAnimationId = isParkBenchSeated ? 'park-bench-sit-rest-read-talk' : (isOutdoorCafeTableUse ? (agent._idleActivity?.animationId || 'outdoor-cafe-table-sit-eat-drink-talk') : (isPatioTableUse ? (agent._idleActivity?.animationId || (isPatioTableSocial ? 'gather-talk' : 'stand-use')) : (isBusStopWaiting ? 'bus-stop-wait' : (isHallwayBenchWaiting ? 'hallway-bench-wait' : ((isCouchSocializing || isLoveseatSocializing || isArmchairSocializing || isBarStoolChatting || isDiningChairTalking || isPatioChairTalking || isConferenceChairMeeting || isSmallCafeTableSocial) ? 'gather-talk' : (isDiningChairEating ? 'drink-eat' : (agent._idleActivity?.animationId || 'sit')))))));
  }
  const resolvedAnimation = resolveAgentAnimationState({
    agent,
    isMoving,
    isRunning,
    isSocializing,
    isWorking,
    isSleeping,
    isBedResting,
    isClinicService: isClinicService || isExamChairService,
    isCouchLounging: isPlainChairSitting || isCouchLounging || isLoveseatLounging || isArmchairLounging || isParkBenchSeated || (isPlaygroundSwingUse && !isPlaygroundSwingWaiting) || isHallwayBenchWaiting || isBusStopWaiting || isBarStoolSitting || isDiningChairSitting || isPatioChairSitting || isConferenceChairSitting || isBarberChairSitting || isExamChairPatient || isMeetingTable || isSmallRoundMeetingTable || (isSmallCafeTableUse && !isSmallCafeTableSetDown) || (isOutdoorCafeTableUse && !isOutdoorCafeTableSetDown),
    isCouchSocializing: isCouchSocializing || isLoveseatSocializing || isArmchairSocializing || isParkBenchSocializing || isBarStoolChatting || isDiningChairTalking || isPatioChairTalking || isConferenceChairMeeting || isMeetingTable || isSmallRoundMeetingTable || isSmallCafeTableSocial || isOutdoorCafeTableSocial || isPatioTableSocial,
    isCarrying: !!(agent._carrying || agent._carriedItem || agent.carryItem),
    animationId: requestedAnimationId,
  });
  agent._resolvedAnimationId = resolvedAnimation.animationId;
  g.userData.animationId = resolvedAnimation.animationId;
  g.userData.animationEntry = resolvedAnimation.entry;

  syncRightHandCarryVisual(parts, agent);

  // Reset head translation unless a pose intentionally pushes it with the body.
  parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY, 0.18);
  parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ, 0.18);

  const applySeatedBasePose = ({ lift = 0.72, lean = 0.18, headForward = 0.12, talk = 0, bob = 0 } = {}) => {
    // Shared chair/couch/barstool seated pose: hips rise onto the seat, torso
    // stays connected to the head, legs form an L over the front of the seat.
    parts.bodyGroup.position.y = _lerp(parts.bodyGroup.position.y, lift, 0.22);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.16);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, talk * 0.025, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY + lift * 0.42, 0.16);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + headForward + Math.sin(lean) * parts.headBaseY * 0.18, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, -1.18, 0.20);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -1.18, 0.20);
    parts.leftLeg.rotation.z  = _lerp(parts.leftLeg.rotation.z || 0, 0.03, 0.16);
    parts.rightLeg.rotation.z = _lerp(parts.rightLeg.rotation.z || 0, -0.03, 0.16);
    g.position.y = (g.userData._groundY || 0) + bob;
  };
  
  if (agent._manualPlacementPreview) {
    // Manual pickup preview: keep the character lower/closer to the drop point.
    // Keep this calm: no full-body spasm, just a gentle back-and-forth arm wiggle.
    const wiggle = Math.sin(tick * 0.16);
    const softBob = Math.sin(tick * 0.08);
    g.position.y = (g.userData._groundY || 0) + 0.03 + Math.abs(softBob) * 0.006;
    parts.bodyGroup.position.y = _lerp(parts.bodyGroup.position.y, 0.04, 0.18);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, -0.04, 0.14);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, 0, 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.28, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.16);
    parts.headGroup.rotation.z = _lerp(parts.headGroup.rotation.z, 0, 0.16);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.18 + wiggle * 0.18, 0.20);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.18 - wiggle * 0.18, 0.20);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.42, 0.18);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.42, 0.18);
    const footWiggle = Math.sin(tick * 0.14 + Math.PI / 3);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.10 + footWiggle * 0.10, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.10 - footWiggle * 0.10, 0.16);
    parts.leftLeg.rotation.z  = _lerp(parts.leftLeg.rotation.z || 0, 0.08 + footWiggle * 0.035, 0.14);
    parts.rightLeg.rotation.z = _lerp(parts.rightLeg.rotation.z || 0, -0.08 + footWiggle * 0.035, 0.14);

  } else if (isMoving) {
    const walkSpeed = isRunning ? 18.0 : 12.0; // running = much faster cycle
    cs.walkPhase += dt * walkSpeed;

    // Hop bounce — subtle walk, bouncy run
    const hopHeight = isRunning ? 0.14 : 0.04;
    const hop = Math.abs(Math.sin(cs.walkPhase)) * hopHeight;
    g.position.y = (g.userData._groundY || 0) + hop;

    // Leg swing — tight for walking, wide for running
    const legAmplitude = isRunning ? 0.75 : 0.30;
    const legSwing = Math.sin(cs.walkPhase) * legAmplitude;
    parts.leftLeg.rotation.x  =  legSwing;
    parts.rightLeg.rotation.x = -legSwing;

    // Arm counter-swing — subtle for walking, vigorous for running
    const armAmplitude = isRunning ? 0.65 : 0.22;
    const armSwing = Math.sin(cs.walkPhase) * armAmplitude;
    const carried = agent._carriedItem || agent._carrying || agent.carryItem;
    const carriedKey = typeof carried === 'string'
      ? carried
      : [carried?.kind, carried?.visualKind, carried?.label, carried?.id, carried?.catalogId, carried?.sourceFurnitureType, agent?.carryItem].filter(Boolean).join(' ');
    const isCarryingCoffee = String(carriedKey || '').toLowerCase().includes('coffee');
    parts.leftArm.rotation.x = -armSwing;
    if (isCarryingCoffee) {
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.08, 0.50);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.30, 0.42);
      parts.rightArm.rotation.y = _lerp(parts.rightArm.rotation.y || 0, -0.04, 0.36);
    } else if (carried) {
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.64, 0.34);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.38, 0.26);
      parts.rightArm.rotation.y = _lerp(parts.rightArm.rotation.y || 0, -0.08, 0.20);
    } else {
      parts.rightArm.rotation.x = armSwing;
    }

    // Forward lean when running
    const leanAngle = isRunning ? 0.12 : 0;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, leanAngle, 0.1);

    // Head bob — faster and more pronounced when running
    const headBobAmp = isRunning ? 0.04 : 0.02;
    parts.headGroup.rotation.x = Math.sin(cs.walkPhase * 2) * headBobAmp;
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.15);
    parts.headGroup.rotation.z = _lerp(parts.headGroup.rotation.z, 0, 0.15);

  } else if (isCoffeeDeskConsume) {
    // Three deliberate desk cycles: cup rests on desk, hand lifts it for a sip,
    // then places it back before the next sip.
    if (Number.isFinite(agent._idleActivity?.faceAngle)) g.rotation.y = agent._idleActivity.faceAngle;
    const deskSipState = getCoffeeDeskSipState(agent);
    const tableReach = Math.max(deskSipState.reachToTable || 0, deskSipState.setDownToTable || 0, deskSipState.handActive ? 0.35 : 0);
    const sip = deskSipState.lift;
    const setDownReach = deskSipState.setDownToTable || 0;
    applySeatedBasePose({ lift: 1.12, lean: 0.10 + sip * 0.035 + setDownReach * 0.02, headForward: 0.12, bob: Math.abs(sip) * 0.006 });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.05 + sip * 0.07, 0.18);
    parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, -0.26, 0.18);
    parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z || 0, 0.18, 0.16);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.28 - tableReach * 0.44 - sip * 0.90, 0.26);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.16 + sip * 0.05 - setDownReach * 0.08, 0.18);
    parts.rightArm.rotation.y = _lerp(parts.rightArm.rotation.y || 0, -sip * 0.06, 0.18);

  } else if (isWorking) {
    // ── SEATED DESK WORKING ANIMATION ───────────────────────
    // Sit in the built-in office chair, lean only slightly toward the larger
    // desk, and keep both hands tapping over the raised keyboard location.
    // The hips are lifted onto the top surface of the chair seat and the legs form an L:
    // upright torso, thighs extending forward over the chair seat.
    const forcedDeskFacing = Number.isFinite(agent._deskFacingAngle) ? agent._deskFacingAngle : agent._activeWorkSpot?.faceAngle;
    if (Number.isFinite(forcedDeskFacing)) g.rotation.y = forcedDeskFacing;

    const keyTap = Math.sin(tick * 0.32);
    const wristTap = Math.sin(tick * 0.68);
    const shoulderRoll = Math.sin(tick * 0.15) * 0.018;
    const seatedBob = Math.abs(Math.sin(tick * 0.12)) * 0.006;

    const workLean = 0.08 + Math.abs(keyTap) * 0.018;
    const chairSeatLift = 1.20;
    parts.bodyGroup.position.y = _lerp(parts.bodyGroup.position.y, chairSeatLift, 0.22);
    // Head is a sibling of bodyGroup, so it needs a seated offset too, but
    // not the full hip lift or it floats above the torso. Keep it seated on
    // the raised torso/neck line.
    const neckFollowY = parts.headBaseY + chairSeatLift * 0.42;
    const neckFollowZ = parts.headBaseZ + 0.16 + Math.sin(workLean) * parts.headBaseY * 0.22;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, workLean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, shoulderRoll, 0.14);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, neckFollowY, 0.16);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, neckFollowZ, 0.16);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + Math.abs(wristTap) * 0.02, 0.16);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.12);
    parts.headGroup.rotation.z = _lerp(parts.headGroup.rotation.z, 0, 0.12);

    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.60 + keyTap * 0.07, 0.36);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.60 - keyTap * 0.07, 0.36);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.34 + wristTap * 0.055, 0.24);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.34 - wristTap * 0.055, 0.24);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, -1.28, 0.22);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -1.28, 0.22);
    parts.leftLeg.rotation.z  = _lerp(parts.leftLeg.rotation.z || 0, 0.03, 0.18);
    parts.rightLeg.rotation.z = _lerp(parts.rightLeg.rotation.z || 0, -0.03, 0.18);
    g.position.y = (g.userData._groundY || 0) + seatedBob;

  } else if (isDeskIdleSeated) {
    // ── DESK IDLE SEATED ANIMATION ─────────────────────────
    // When an agent is at their own desk but not in working status, keep them
    // seated in the desk chair without the keyboard typing arm motion.
    const forcedDeskFacing = Number.isFinite(agent._deskFacingAngle) ? agent._deskFacingAngle : agent._activeWorkSpot?.faceAngle;
    if (Number.isFinite(forcedDeskFacing)) g.rotation.y = forcedDeskFacing;
    const idleSway = Math.sin(tick * 0.035);
    applySeatedBasePose({ lift: 1.20, lean: 0.10, headForward: 0.16, talk: idleSway * 0.18, bob: Math.abs(idleSway) * 0.004 });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.04, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, idleSway * 0.10, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.18, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.18, 0.18);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.22, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.22, 0.16);

  } else if (isTalking) {
    // ── TALKING ANIMATION ───────────────────────────────────
    // Gentle bounce
    const bouncePeriod = 90;
    const bTick = tick % bouncePeriod;
    const bounce = bTick < 10 ? Math.sin((bTick / 10) * Math.PI) * 0.08 : 0;
    g.position.y = (g.userData._groundY || 0) + bounce;

    // Gestural arm wave (one arm)
    parts.leftArm.rotation.x  = -Math.sin(tick * 0.08) * 0.40;
    parts.rightArm.rotation.x =  0;
    parts.leftLeg.rotation.x  = 0;
    parts.rightLeg.rotation.x = 0;
    parts.bodyGroup.rotation.x = 0;
    parts.headGroup.rotation.x = 0;

    // Head nod during talking
    parts.headGroup.rotation.x = Math.sin(tick * 0.07) * 0.06;

  } else if (isClinicService || isExamChairService) {
    // ── CLINIC BED / EXAM CHAIR BEDSIDE SERVICE / CHECKUP ────────────────
    cs.workPhase = (cs.workPhase || 0) + dt * 2.2;
    const scanPulse = Math.sin(cs.workPhase * 2.4);
    const lean = 0.42 + Math.abs(scanPulse) * 0.05;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.16);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, -0.05 + scanPulse * 0.025, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY * Math.cos(lean), 0.14);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + Math.sin(lean) * parts.headBaseY * 0.82, 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.28 + Math.abs(scanPulse) * 0.03, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.95 + scanPulse * 0.12, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.25 - scanPulse * 0.16, 0.24);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.22, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.38, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(scanPulse) * 0.012;

  } else if (isCheckoutCounterUse || isCheckoutRegisterUse) {
    // ── CHECKOUT COUNTER / REGISTER CUSTOMER / CASHIER ──────
    // Cashier scans/keys payments; customer waits, pays, and gestures.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.5;
    const scan = Math.max(0, Math.sin(cs.workPhase * 1.8));
    const talk = Math.sin(cs.workPhase * 1.2);
    const isCheckoutCashier = isCheckoutCounterCashier || isCheckoutRegisterCashier;
    const lean = isCheckoutCashier ? 0.20 + scan * 0.10 : 0.08 + Math.max(0, talk) * 0.04;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, (isCheckoutCashier ? -0.02 : 0.02) + talk * 0.02, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.06 + scan * 0.04, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, isCheckoutCashier ? -0.55 - scan * 0.45 : -0.18 - Math.max(0, talk) * 0.20, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, isCheckoutCashier ? -0.95 - scan * 0.55 : -0.42 - Math.max(0, -talk) * 0.22, 0.24);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, isCheckoutCashier ? 0.22 : 0.14, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, isCheckoutCashier ? -0.34 : -0.18, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(talk) * 0.01;

  } else if (isTrashBinDispose) {
    // ── TRASH / RECYCLING BIN DISPOSAL / OUTDOOR TRASH CAN ─
    // Stand facing the cleanup node, lean slightly, and make a repeatable
    // right-hand drop motion suitable for clearing temporary consumables or clutter.
    cs.workPhase = (cs.workPhase || 0) + dt * 3.0;
    const drop = Math.max(0, Math.sin(cs.workPhase * 2.2));
    const recover = Math.sin(cs.workPhase * 1.1);
    const lean = 0.16 + drop * 0.18;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, recover * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + drop * 0.06, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.18 - recover * 0.08, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.55 - drop * 0.95, 0.28);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.18 - drop * 0.22, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(recover) * 0.008;

  } else if (isFridgeUse) {
    // ── FRIDGE OPEN / REACH / CLOSE ───────────────────────────────
    // Stand facing the fridge at the door-swing clearance waypoint, pull the
    // handle, reach into the cabinet, then close the door with the snack in hand.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.4;
    const phase = (cs.workPhase % (Math.PI * 2)) / (Math.PI * 2);
    const open = phase < 0.25 ? Math.sin((phase / 0.25) * Math.PI) : 0;
    const reach = phase > 0.20 && phase < 0.62 ? Math.sin(((phase - 0.20) / 0.42) * Math.PI) : 0;
    const close = phase >= 0.62 ? Math.sin(((phase - 0.62) / 0.38) * Math.PI) : 0;
    const check = bedActivityKind === 'fridge-check-stock' ? 0.35 : 0;
    const lean = 0.10 + open * 0.10 + reach * 0.18 + check * 0.08;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, (open - close) * 0.035, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.07 + reach * 0.07 + check * 0.04, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.20 - check * 0.26, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.74 - open * 0.34 - reach * 0.82 - close * 0.28, 0.24);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.24 - open * 0.16 + reach * 0.10 + close * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(reach) * 0.006;

  } else if (isKitchenIslandUse) {
    // ── KITCHEN ISLAND PREP / COOK / EAT ─────────────────────
    // Stand at one of the island's safe side waypoints, lean over the solid
    // prep surface, and alternate hands for chopping, mixing, cooking, or eating.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.6;
    const phase = (cs.workPhase % (Math.PI * 2)) / (Math.PI * 2);
    const chop = phase < 0.36 ? Math.sin((phase / 0.36) * Math.PI) : 0;
    const mix = phase > 0.28 && phase < 0.72 ? Math.sin(((phase - 0.28) / 0.44) * Math.PI) : 0;
    const taste = isKitchenIslandEat ? Math.max(0, Math.sin(cs.workPhase * 2.2)) : 0;
    const lean = 0.14 + chop * 0.11 + mix * 0.08 + taste * 0.05;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, (chop - mix) * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + Math.max(chop, mix, taste) * 0.05, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.42 - mix * 0.48 - taste * 0.18, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.68 - chop * 0.74 - taste * 0.52, 0.26);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.20 + mix * 0.12, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.22 - chop * 0.16 + taste * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(mix) * 0.007;

  } else if (isOutdoorPlanterUse || isFlowerBedUse) {
    // ── OUTDOOR PLANTER / FLOWER BED WATER / INSPECT / SMELL ─────
    // Stand just outside the solid greenery footprint, lean toward the plants,
    // and make a gentle water/inspect/smell reach without spawning a prop.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.2;
    const reach = Math.max(0, Math.sin(cs.workPhase * 1.8));
    const inspect = bedActivityKind === 'outdoor-planter-inspect' || bedActivityKind === 'flower-bed-inspect' ? 0.35 : 0;
    const smell = bedActivityKind === 'flower-bed-smell' ? 0.32 : 0;
    const lean = 0.10 + reach * 0.16 + inspect * 0.08 + smell * 0.10;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, Math.sin(cs.workPhase * 0.9) * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + reach * 0.05 + inspect * 0.04 + smell * 0.08, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.16 - inspect * 0.20 + smell * 0.08, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.48 - reach * 0.72 - inspect * 0.20 + smell * 0.14, 0.24);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.18 - reach * 0.18, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(Math.sin(cs.workPhase)) * 0.006;

  } else if (isShadeTreeUse) {
    // ── SHADE TREE / TREE CLUSTER REST / READ / GATHER ─────────
    // Agent stays at a canopy-edge action spot, outside trunk colliders. Rest
    // uses a relaxed sit/stand lean; read focuses down; gather adds calm talk
    // gestures and an occasional look-up into the canopy.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.25;
    const sway = Math.sin(cs.workPhase * 0.75);
    const talk = isShadeTreeGather ? Math.max(0, Math.sin(cs.workPhase * 1.65)) : 0;
    const read = isShadeTreeRead ? 1 : 0;
    const lookUp = !isShadeTreeRead && Math.max(0, Math.sin(cs.workPhase * 0.42)) > 0.92 ? 0.16 : 0;
    const lean = read ? 0.18 : 0.08 + lookUp * 0.35;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.13);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, sway * 0.030 + talk * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, read ? 0.22 : (-lookUp + 0.04), 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, sway * 0.10, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, read ? -0.74 : (-0.18 - talk * 0.22), 0.20);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, read ? -0.68 : (-0.32 - talk * 0.46), 0.22);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, read ? 0.18 : 0.12 + talk * 0.18, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, read ? -0.18 : -0.16 - talk * 0.24, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, -0.08, 0.12);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, 0.04, 0.12);
    g.position.y = (g.userData._groundY || 0) + Math.abs(sway) * 0.006;

  } else if (isFountainUse) {
    // ── FOUNTAIN WATCH / RELAX / GROUP GATHER ─────────────────
    // Agents stay on dry perimeter action spots around the solid basin, face
    // the water/spray, and use a calm stand/watch/relax pose with optional
    // group-talk gestures. No extra outdoor objects are spawned.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.35;
    const talk = bedActivityKind === 'fountain-gather' ? Math.max(0, Math.sin(cs.workPhase * 1.7)) : 0;
    const relax = bedActivityKind === 'fountain-watch' ? 0.10 : 0.04;
    const sway = Math.sin(cs.workPhase * 0.75);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.035 + relax, 0.12);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, sway * 0.028, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.03 + relax * 0.35, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, sway * 0.18 + talk * 0.12, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.14 - talk * 0.18, 0.16);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.18 - talk * 0.34, 0.18);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.18 + talk * 0.10, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.18 - talk * 0.12, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(sway) * 0.004;

  } else if (isPondDockUse) {
    // ── POND DOCK VIEW / RELAX / FISH-LIKE IDLE ───────────────
    // Agents stand on dock-safe/land-safe targets, face the water edge, and
    // use calm viewing or fishing-like idle gestures. No fishing rod/inventory
    // props are created and routing remains owned by setAgentTarget/dynamic routing.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.15;
    const relax = bedActivityKind === 'pond-dock-relax' ? 0.12 : 0.06;
    const fishLike = bedActivityKind === 'pond-dock-relax' ? Math.max(0, Math.sin(cs.workPhase * 1.25)) : 0;
    const sway = Math.sin(cs.workPhase * 0.65);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.04 + relax + fishLike * 0.045, 0.12);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, sway * 0.022, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.05 + relax * 0.25, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, sway * 0.16, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.16 - fishLike * 0.16, 0.16);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.20 - fishLike * 0.42, 0.18);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.14 + fishLike * 0.08, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.16 - fishLike * 0.18, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.015, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.015, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(sway) * 0.003;

  } else if (isGazeboPavilionUse) {
    // ── GAZEBO / PAVILION GATHER-REST-SIT UNDER COVER ─────────
    // Agents use the open entrance and reachable interior spots, then settle
    // into a relaxed covered-outdoor talk/wait pose or integrated bench sit.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.45;
    const talk = bedActivityKind === 'gazebo-pavilion-gather' ? Math.max(0, Math.sin(cs.workPhase * 1.6)) : 0;
    const seated = bedActivityKind === 'gazebo-pavilion-sit';
    const sway = Math.sin(cs.workPhase * 0.72);
    if (seated) {
      applySeatedBasePose({ lift: 0.66, lean: 0.12, headForward: 0.08, talk: talk * 0.5, bob: Math.abs(sway) * 0.003 });
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.20 - talk * 0.12, 0.16);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.22 - talk * 0.24, 0.18);
      parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, sway * 0.10 + talk * 0.10, 0.12);
    } else {
      parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.04 + (bedActivityKind === 'gazebo-pavilion-rest' ? 0.08 : 0.02), 0.12);
      parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, sway * 0.026, 0.12);
      parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.025, 0.12);
      parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, sway * 0.16 + talk * 0.16, 0.12);
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.16 - talk * 0.20, 0.16);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.18 - talk * 0.36, 0.18);
      parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.16 + talk * 0.08, 0.16);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.16 - talk * 0.10, 0.16);
      parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
      parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
      g.position.y = (g.userData._groundY || 0) + Math.abs(sway) * 0.004;
    }

  } else if (isPlaygroundSlideUse) {
    // ── PLAYGROUND SLIDE CLIMB / SLIDE / PLAY ──────────────────
    // Agents use the clear ladder approach, then a playful climb/slide pose
    // loop; the solid ladder/platform/chute stays blocked and the exit spot
    // remains clear, so this animation does not fork routing or spawn props.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.15;
    const phase = (cs.workPhase % (Math.PI * 2)) / (Math.PI * 2);
    const climb = phase < 0.42 ? Math.sin((phase / 0.42) * Math.PI) : 0;
    const slide = phase >= 0.42 && phase < 0.82 ? Math.sin(((phase - 0.42) / 0.40) * Math.PI) : 0;
    const finish = phase >= 0.82 ? Math.sin(((phase - 0.82) / 0.18) * Math.PI) : 0;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.10 + climb * 0.20 - slide * 0.08, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, Math.sin(cs.workPhase * 1.4) * (0.03 + slide * 0.04), 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.06 + climb * 0.06 + finish * 0.04, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.52 - climb * 0.68 - slide * 0.18, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.62 - climb * 0.78 - finish * 0.32, 0.24);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.22 + climb * 0.16 + slide * 0.08, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.22 - climb * 0.18 - slide * 0.08, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.12 + climb * 0.34 + slide * 0.28, 0.18);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.10 - climb * 0.28 + slide * 0.32, 0.18);
    g.position.y = (g.userData._groundY || 0) + climb * 0.035 + slide * 0.020 + finish * 0.012;

  } else if (isPlaygroundSwingUse) {
    // ── PLAYGROUND SWING SIT / SWING / WAIT ───────────────────
    // The seat target is reached through setAgentTarget/dynamic exterior
    // routing. This pose is seated and playful (no desk typing arms), while
    // the swing clearance remains a reserved soft zone around the stationary
    // solid A-frame asset.
    cs.workPhase = (cs.workPhase || 0) + dt * (isPlaygroundSwingWaiting ? 0.9 : 2.35);
    const arc = Math.sin(cs.workPhase);
    const arcAbs = Math.abs(arc);
    if (isPlaygroundSwingWaiting) {
      const sway = Math.sin(cs.workPhase * 0.8);
      parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.04, 0.12);
      parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, sway * 0.018, 0.12);
      parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, sway * 0.10, 0.12);
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.18, 0.16);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.18, 0.16);
      parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
      parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
      g.position.y = (g.userData._groundY || 0) + Math.abs(sway) * 0.004;
    } else {
      applySeatedBasePose({ lift: 0.70 + arcAbs * 0.035, lean: 0.10 + arc * 0.12, headForward: 0.10 + arcAbs * 0.04, bob: arcAbs * 0.018 });
      parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, Math.sin(cs.workPhase * 0.5) * 0.035, 0.12);
      parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.03 + arc * 0.035, 0.14);
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.10 - arcAbs * 0.12, 0.22);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.10 - arcAbs * 0.12, 0.22);
      parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.42 + arc * 0.08, 0.16);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.42 - arc * 0.08, 0.16);
      parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, -1.00 + arcAbs * 0.12, 0.18);
      parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -1.00 + arcAbs * 0.12, 0.18);
      g.position.y = (g.userData._groundY || 0) + arcAbs * 0.026;
    }

  } else if (isOutdoorStageUse) {
    // ── OUTDOOR STAGE PERFORM / WATCH / AUDIENCE GATHER ───────
    // Performer uses an expressive standing pose on the stepped platform;
    // audience/gather spots stay in front of the solid stage footprint and use
    // existing social talk/watch motion without spawning chairs or props.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.75;
    const performing = bedActivityKind === 'outdoor-stage-perform';
    const watching = bedActivityKind === 'outdoor-stage-watch';
    const wave = Math.sin(cs.workPhase * (performing ? 2.0 : 1.2));
    const applause = watching ? Math.max(0, Math.sin(cs.workPhase * 3.4)) : 0;
    const talk = !watching ? Math.max(0, Math.sin(cs.workPhase * 1.4)) : 0;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.04 + (performing ? 0.06 : 0.02), 0.14);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, wave * (performing ? 0.055 : 0.022), 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, performing ? 0.035 : 0.02, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, wave * (performing ? 0.20 : 0.10), 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.32 - talk * 0.48 - applause * 0.26, 0.20);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.48 - (performing ? Math.max(0, wave) * 0.86 : applause * 0.32) - talk * 0.30, 0.22);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.22 + (performing ? wave * 0.16 : applause * 0.10), 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.24 - (performing ? wave * 0.18 : applause * 0.10), 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, performing ? 0.04 : 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, performing ? -0.04 : -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + (performing ? Math.abs(wave) * 0.018 : Math.abs(applause) * 0.006);

  } else if (isOutdoorCafeTableUse) {
    // ── OUTDOOR CAFE / PICNIC TABLE SIT / EAT / DRINK / TALK ────
    // Seated exterior table pose reused from chair/cafe-table patterns: no desk
    // typing motion, with small hand-to-table gestures for eat/drink/talk and
    // a short right-hand set-down reach for tabletop temporary items.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.9;
    const talk = isOutdoorCafeTableSocial ? Math.max(0, Math.sin(cs.workPhase * 1.5)) : 0;
    const biteSip = isOutdoorCafeTableEatDrink ? Math.max(0, Math.sin(cs.workPhase * 2.4)) : 0;
    const setdown = isOutdoorCafeTableSetDown ? Math.max(0, Math.sin(cs.workPhase * 2.2)) : 0;
    applySeatedBasePose({ lift: 0.76, lean: 0.14 + biteSip * 0.04 + setdown * 0.08, headForward: 0.12, talk, bob: Math.abs(Math.sin(cs.workPhase)) * 0.004 });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.04 + biteSip * 0.05, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, talk * 0.14, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.22 - talk * 0.18 - biteSip * 0.22, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.28 - biteSip * 0.70 - setdown * 0.72 - talk * 0.20, 0.22);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.20 + talk * 0.10, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.20 - setdown * 0.16, 0.18);

  } else if (isGrillUse) {
    // ── GRILL COOK / FLIP / WAIT ───────────────────────────────
    // Stand facing the grill at the safe front cook spot, reach to flip food,
    // pause through heat/wait beats, and keep feet outside the solid firebox.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.7;
    const phase = (cs.workPhase % (Math.PI * 2)) / (Math.PI * 2);
    const flip = phase < 0.28 ? Math.sin((phase / 0.28) * Math.PI) : 0;
    const wait = phase > 0.28 && phase < 0.68 ? Math.sin(((phase - 0.28) / 0.40) * Math.PI) : 0;
    const closeCheck = phase >= 0.68 ? Math.sin(((phase - 0.68) / 0.32) * Math.PI) : 0;
    const lean = 0.14 + flip * 0.20 + closeCheck * 0.10;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, (flip - closeCheck) * 0.035, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + flip * 0.06 + wait * 0.03, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.28 - wait * 0.10, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.72 - flip * 0.90 - closeCheck * 0.48, 0.26);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.20 - flip * 0.18 + closeCheck * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(wait) * 0.008;

  } else if (isMicrowaveUse) {
    // ── MICROWAVE OPEN / PLACE / PRESS / WAIT / REMOVE ───────────────
    // Stand facing the microwave, lean toward the door-clearance spot, open
    // and place food, press controls, wait, then remove a temporary snack.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.6;
    const phase = (cs.workPhase % (Math.PI * 2)) / (Math.PI * 2);
    const doorReach = phase < 0.22 ? Math.sin((phase / 0.22) * Math.PI) : 0;
    const press = phase > 0.22 && phase < 0.42 ? Math.sin(((phase - 0.22) / 0.20) * Math.PI) : 0;
    const wait = phase > 0.42 && phase < 0.78 ? Math.sin(((phase - 0.42) / 0.36) * Math.PI) : 0;
    const remove = phase >= 0.78 ? Math.sin(((phase - 0.78) / 0.22) * Math.PI) : 0;
    const lean = 0.12 + (doorReach + press + remove) * 0.12;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, (doorReach - remove) * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + (press + wait) * 0.04, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.18 - wait * 0.12, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.82 - doorReach * 0.46 - press * 0.62 - remove * 0.52, 0.24);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.22 - doorReach * 0.10 + remove * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(wait) * 0.008;

  } else if (isCoffeeMachineUse || isWaterCoolerUse || isVendingMachineUse || isCoffeePickupShelfUse) {
    // ── COFFEE MACHINE PRESS / BREW / PICKUP, VENDING, SHELF ──────────
    // Stand facing the machine/shelf, press controls, then reach down/front
    // to retrieve or set down the temporary right-hand snack/drink item.
    cs.workPhase = (cs.workPhase || 0) + dt * (isVendingMachineUse ? 3.0 : 2.8);
    const press = Math.max(0, Math.sin(cs.workPhase * 1.6));
    const vendRetrieve = isVendingMachineUse ? Math.max(0, Math.sin(cs.workPhase * 0.9 - 0.8)) : 0;
    const brew = Math.sin(cs.workPhase * 3.3);
    const pickup = agent._carriedItem || agent._carrying || agent.carryItem === 'coffee' || agent.carryItem === 'water' || agent.carryItem === 'snack' ? 1 : 0;
    const isShelfDropoff = bedActivityKind === 'coffee-pickup-shelf-dropoff';
    const lean = 0.12 + press * 0.14 + vendRetrieve * 0.10;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, brew * 0.018, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.08 + press * 0.04 + vendRetrieve * 0.04, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.25 - vendRetrieve * 0.10, 0.18);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.92 - press * (isCoffeePickupShelfUse ? 0.42 : 0.68) - vendRetrieve * 0.45 - pickup * 0.22, 0.24);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, (isShelfDropoff ? -0.08 : -0.28) - pickup * 0.10 + vendRetrieve * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(brew) * 0.01;

  } else if (isMeetingTable || isSmallRoundMeetingTable) {
    // ── MEETING TABLE SEATED DISCUSSION ─────────────────────
    cs.workPhase = (cs.workPhase || 0) + dt * 1.9;
    const talk = Math.sin(cs.workPhase * 2.8);
    const listen = Math.max(0, Math.sin(cs.workPhase * 0.9));
    applySeatedBasePose({ lift: 0.76, lean: 0.20 + listen * 0.04, headForward: 0.12, talk, bob: 0.02 });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.05 + listen * 0.04, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, talk * 0.18, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.26 - Math.max(0, talk) * 0.24, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.22 + Math.min(0, talk) * 0.18, 0.22);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.30 + talk * 0.10, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.28 + talk * 0.08, 0.16);
    // Lower-body seated pose is handled by applySeatedBasePose above.

  } else if (isPingPongPlay) {
    // ── PING-PONG MATCH ─────────────────────────────────────
    // Track the live table ball: feet slide along the table edge in main3d,
    // while the right-hand paddle follows the ball height/side and snaps on hit.
    cs.workPhase = (cs.workPhase || 0) + dt * 4.8;
    const side = bedActivityKind.endsWith('right') ? -1 : 1;
    const track = Math.max(-1, Math.min(1, Number(agent?._pingPongTrackZ || 0) / 0.42));
    const ballTrack = Math.max(-1, Math.min(1, Number(agent?._pingPongBallZ || 0) / 0.48));
    const pulseAge = Math.max(0, (performance.now?.() || Date.now()) - Number(agent?._pingPongSwingPulse || 0));
    const hitSwing = pulseAge < 360 ? Math.sin((1 - pulseAge / 360) * Math.PI) : 0;
    const rally = Math.sin(cs.workPhase * 1.8);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.07 + hitSwing * 0.12, 0.20);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, side * track * 0.075, 0.20);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.05 + Math.abs(ballTrack) * 0.025, 0.16);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, side * ballTrack * 0.22, 0.16);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.32 - Math.max(0, -track) * 0.16, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.82 - hitSwing * 0.95 - Math.abs(ballTrack) * 0.18, 0.36);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.18 + side * track * 0.12, 0.20);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.44 - side * ballTrack * 0.30 - side * hitSwing * 0.20, 0.28);
    parts.rightArm.rotation.y = _lerp(parts.rightArm.rotation.y || 0, side * (ballTrack * 0.22 + hitSwing * 0.16), 0.22);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, rally * 0.08 + track * 0.08, 0.20);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -rally * 0.08 - track * 0.08, 0.20);
    g.position.y = (g.userData._groundY || 0) + Math.abs(rally) * 0.008;

  } else if (isPoolTablePlay && !isPoolTableWatch) {
    // ── POOL TABLE AIM / SHOT ───────────────────────────────
    // Stand at a rail action spot, lean into the shot, and use both arms as an
    // imaginary cue stroke. The pool table remains the only persistent asset.
    cs.workPhase = (cs.workPhase || 0) + dt * 3.4;
    const aimSettle = Math.max(0, Math.sin(cs.workPhase * 1.2));
    const stroke = Math.max(0, Math.sin(cs.workPhase * 2.8));
    const side = bedActivityKind.endsWith('left') ? 1 : (bedActivityKind.endsWith('right') ? -1 : 0);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.22 + stroke * 0.10, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, side * 0.035, 0.16);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.14 + aimSettle * 0.04, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, side * 0.10, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.72 - aimSettle * 0.18, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.12 - stroke * 0.72, 0.32);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.26 + side * 0.08, 0.18);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.46 - side * 0.08, 0.22);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.03 + stroke * 0.03, 0.18);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.08 - stroke * 0.04, 0.18);
    g.position.y = (g.userData._groundY || 0) + Math.abs(Math.sin(cs.workPhase * 1.1)) * 0.006;

  } else if (isGamingStationPlay) {
    // ── GAMING STATION SEATED KEYBOARD / CONTROLLER PLAY ────
    // Sit at the integrated station seat, lean toward the screen, and alternate
    // controller/keyboard hand taps while standing up/away is handled on exit.
    cs.workPhase = (cs.workPhase || 0) + dt * 3.0;
    const tap = Math.max(0, Math.sin(cs.workPhase * 4.1));
    const aim = Math.sin(cs.workPhase * 1.9);
    const focusBob = Math.abs(Math.sin(cs.workPhase * 1.2)) * 0.01;
    applySeatedBasePose({ lift: 0.78, lean: 0.24 + tap * 0.04, headForward: 0.16, talk: aim * 0.35, bob: focusBob });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.10 + tap * 0.03, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, aim * 0.10, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.25 + aim * 0.10, 0.28);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.18 - tap * 0.32, 0.30);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.30 + aim * 0.10, 0.18);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.32 - tap * 0.10, 0.18);
    // Lower-body seated pose is handled by applySeatedBasePose above.

  } else if (isArcadeMachinePlay) {
    // ── ARCADE MACHINE JOYSTICK / BUTTON PLAY ───────────────
    // Stand facing the cabinet, lean toward the controls, hold one hand on
    // the joystick, and tap buttons with the other hand in a quick game loop.
    cs.workPhase = (cs.workPhase || 0) + dt * 3.2;
    const buttonTap = Math.max(0, Math.sin(cs.workPhase * 4.4));
    const joystick = Math.sin(cs.workPhase * 2.1);
    const excitedBounce = Math.abs(Math.sin(cs.workPhase * 1.7));
    const lean = 0.20 + buttonTap * 0.08;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, joystick * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.12 + buttonTap * 0.03, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, joystick * 0.10, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.82 + joystick * 0.18, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.10 - buttonTap * 0.52, 0.28);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.20 + joystick * 0.10, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.30 - buttonTap * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + excitedBounce * 0.012;

  } else if (isToolCartUse) {
    // ── TOOL CART / UTILITY CART STAND, REACH, SELECT TOOL ─────────────
    // Stand at the front waypoint, lean over the top tray, reach into the
    // persistent cart, and select/prep tools without spawning loose assets.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.6;
    const reach = Math.max(0, Math.sin(cs.workPhase * 1.9));
    const rummage = Math.sin(cs.workPhase * 4.2);
    const prepBeat = isToolCartPrep ? Math.max(0, Math.sin(cs.workPhase * 0.9)) : 0;
    const lean = 0.18 + reach * 0.15 + prepBeat * 0.04;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, rummage * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.10 + reach * 0.06, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, rummage * 0.08, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.42 - prepBeat * 0.28, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.92 - reach * 0.70, 0.28);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.18 + prepBeat * 0.12, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.32 - reach * 0.12, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(rummage) * 0.008;

  } else if (isWorkbenchUse) {
    // ── WORKBENCH STAND, TOOL USE, BUILD/REPAIR ──────────────────────
    // Stand at the front work spot, lean over the persistent bench surface,
    // alternate hand-tool/build gestures, and do not spawn loose tool assets.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.8;
    const toolStroke = Math.max(0, Math.sin(cs.workPhase * 2.4));
    const buildTap = isWorkbenchBuild ? Math.max(0, Math.sin(cs.workPhase * 4.8)) : 0;
    const checkMeasure = Math.sin(cs.workPhase * 1.3);
    const lean = 0.20 + toolStroke * 0.14 + buildTap * 0.05;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, checkMeasure * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.12 + toolStroke * 0.05, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, checkMeasure * 0.08, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.56 - buildTap * 0.22, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.98 - toolStroke * 0.76 - buildTap * 0.24, 0.30);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.20 + buildTap * 0.12, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.34 - toolStroke * 0.16, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(checkMeasure) * 0.007;

  } else if (isStorageBoxesUse) {
    // ── STORAGE BOXES STAND, INSPECT, OPEN BOX ────────────────────────
    // Stand at the front waypoint, lean toward the stacked persistent boxes,
    // inspect labels, and open/check a flap without spawning loose supplies.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.35;
    const inspect = Math.max(0, Math.sin(cs.workPhase * 1.6));
    const openFlap = isStorageBoxesOpen ? Math.max(0, Math.sin(cs.workPhase * 2.2)) : 0;
    const rummage = Math.sin(cs.workPhase * 3.6);
    const lean = 0.16 + inspect * 0.11 + openFlap * 0.08;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, rummage * 0.018, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.10 + inspect * 0.05, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, rummage * 0.06, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.40 - inspect * 0.20, 0.20);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.78 - inspect * 0.34 - openFlap * 0.30, 0.26);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.12 + openFlap * 0.10, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.24 - openFlap * 0.16, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(rummage) * 0.006;

  } else if (isPrinterScannerUse || isDiagnosticStationUse) {
    // ── ALL-IN-ONE PRINTER SCANNER / DIAGNOSTIC STATION PRESS / REVIEW ────
    // Stand facing the device, press side/front controls, wait through the
    // print/copy/scan loop, then reach toward the output tray.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.5;
    const pressButtons = Math.max(0, Math.sin(cs.workPhase * 1.8));
    const waitLoop = Math.sin(cs.workPhase * 3.6);
    const collectReach = bedActivityKind.includes('collect') ? 1 : Math.max(0, Math.sin(cs.workPhase * 0.9));
    const lean = 0.16 + pressButtons * 0.12 + collectReach * 0.05;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, waitLoop * 0.02, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.10 + pressButtons * 0.04, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, waitLoop * 0.08, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.35 - collectReach * 0.28, 0.20);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.95 - pressButtons * 0.58 - collectReach * 0.18, 0.26);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.16 + collectReach * 0.12, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.30 - pressButtons * 0.08, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(waitLoop) * 0.008;

  } else if (isStandingDeskWork || isLaptopMonitorWork) {
    // ── STANDING DESK / LAPTOP MONITOR WORK GLANCE TYPE ─────
    // Stand at the monitor-facing side, type in place for focus work, and
    // optionally reach to the integrated raise/lower control buttons.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.4;
    const keyTap = Math.sin(cs.workPhase * 3.2);
    const wristTap = Math.sin(cs.workPhase * 5.2);
    const screenGlance = isLaptopMonitorWork ? Math.max(0, Math.sin(cs.workPhase * 1.2)) : 0;
    const controlPress = isStandingDeskAdjust ? Math.max(0, Math.sin(cs.workPhase * 1.8)) : 0;
    const lean = 0.18 + Math.abs(keyTap) * 0.035 + controlPress * 0.04;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, keyTap * 0.018, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY * Math.cos(lean), 0.14);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + Math.sin(lean) * parts.headBaseY * 0.56, 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.10 + Math.abs(wristTap) * 0.025, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, keyTap * 0.04 + screenGlance * 0.08, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.12 + keyTap * 0.08, 0.30);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.18 - keyTap * 0.08 - controlPress * 0.35 - screenGlance * 0.08, 0.32);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.24 + wristTap * 0.045, 0.18);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.30 - wristTap * 0.045 - controlPress * 0.10, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.03, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.03, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(keyTap) * 0.006;

  } else if (isDraftingTableWork) {
    // ── DRAFTING TABLE PLAN / DRAW / REVIEW ─────────────────
    // Stand at the persistent planning table, lean over the angled surface,
    // draw with alternating hands, then pause/review in a complete loop.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.1;
    const drawStroke = Math.sin(cs.workPhase * 3.0);
    const reviewBeat = Math.max(0, Math.sin(cs.workPhase * 0.9));
    const lean = 0.34 + Math.abs(drawStroke) * 0.06;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, drawStroke * 0.028, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY * Math.cos(lean), 0.14);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + Math.sin(lean) * parts.headBaseY * 0.86, 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.22 + reviewBeat * 0.04, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, drawStroke * 0.10, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.05 + drawStroke * 0.18 - reviewBeat * 0.12, 0.28);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.28 - drawStroke * 0.34, 0.32);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.25 + drawStroke * 0.08, 0.18);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.32 - drawStroke * 0.12, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(reviewBeat) * 0.008;

  } else if (isWhiteboardUse) {
    // ── WHITEBOARD WRITING / POINTING / TEACHING LOOP ───────
    // Stand facing the persistent non-carryable Whiteboard presenter spot,
    // write with the right hand, point while teaching, and optionally pause in
    // a listener/meeting stance for review sessions.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.35;
    const writeStroke = Math.sin(cs.workPhase * 3.8);
    const teachPoint = bedActivityKind === 'whiteboard-teach' ? Math.max(0, Math.sin(cs.workPhase * 1.45)) : Math.max(0, Math.sin(cs.workPhase * 0.95)) * 0.55;
    const reviewPause = Math.max(0, Math.sin(cs.workPhase * 0.72));
    const lean = 0.12 + Math.abs(writeStroke) * 0.025 + teachPoint * 0.035;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, writeStroke * 0.022, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.06 + reviewPause * 0.035, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, writeStroke * 0.10 + teachPoint * 0.10, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.46 - reviewPause * 0.14, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.95 - Math.abs(writeStroke) * 0.35 - teachPoint * 0.42, 0.30);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.18 + teachPoint * 0.12, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.42 - writeStroke * 0.18 - teachPoint * 0.24, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(writeStroke) * 0.006;

  } else if (isTeachingPodiumUse) {
    // ── TEACHING PODIUM STAND / TEACH / POINT / SPEAK ───────
    // Stand at the behind/front podium routing spot, speak to the room, and
    // alternate between one-hand pointing and two-hand teaching gestures.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.2;
    const talk = Math.sin(cs.workPhase * 2.8);
    const point = isTeachingPodiumBrief ? Math.max(0, Math.sin(cs.workPhase * 1.7)) : Math.max(0, Math.sin(cs.workPhase * 1.25));
    const emphasis = Math.abs(Math.sin(cs.workPhase * 0.85));
    const lean = 0.10 + emphasis * 0.06;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, talk * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.04 + emphasis * 0.04, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, talk * 0.18, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.42 - emphasis * 0.24, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.62 - point * 0.78, 0.28);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.24 + talk * 0.12, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.26 - point * 0.34, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + emphasis * 0.01;

  } else if (isTreadmillTraining) {
    // ── TREADMILL / TRAINING MAT INTERACTION ────────────────
    // Stationary exercise loop: treadmill mode walks/runs in place; mat mode
    // keeps feet planted lower with stretch/practice arm and torso drills;
    // outdoor exercise station reuses this safe training branch with a taller
    // pull-up/stretch upper-body rhythm, without touching treadmill behavior.
    cs.walkPhase += dt * (isOutdoorExerciseStationTraining ? 7.2 : (isTrainingMatTraining ? 9.5 : (isTreadmillPractice ? 15.5 : 18.0)));
    cs.workPhase = (cs.workPhase || 0) + dt * (isOutdoorExerciseStationTraining ? 4.2 : (isTrainingMatTraining ? 3.4 : (isTreadmillPractice ? 2.8 : 2.2)));
    const step = Math.sin(cs.walkPhase);
    const stride = Math.abs(Math.sin(cs.walkPhase));
    const exert = Math.sin(cs.workPhase);
    const cooldown = Math.max(0, Math.sin(cs.workPhase * 0.55));
    const lean = isOutdoorExerciseStationTraining ? 0.10 + cooldown * 0.04 : (isTrainingMatTraining ? 0.22 + cooldown * 0.10 : (isTreadmillPractice ? 0.08 + cooldown * 0.06 : 0.16 + stride * 0.035));
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.18);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, isOutdoorExerciseStationTraining ? exert * 0.035 : (isTrainingMatTraining ? exert * 0.10 : (isTreadmillPractice ? exert * 0.045 : exert * 0.018)), 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, isOutdoorExerciseStationTraining ? -0.03 + cooldown * 0.05 : (0.06 + stride * (isTrainingMatTraining ? 0.02 : 0.04)), 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, (isTreadmillPractice || isTrainingMatTraining || isOutdoorExerciseStationTraining) ? exert * 0.16 : 0, 0.12);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, isOutdoorExerciseStationTraining ? -0.08 + step * 0.10 : (isTrainingMatTraining ? -0.18 + step * 0.18 : step * (isTreadmillPractice ? 0.48 : 0.72)), 0.34);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, isOutdoorExerciseStationTraining ? 0.08 - step * 0.10 : (isTrainingMatTraining ? 0.18 - step * 0.18 : -step * (isTreadmillPractice ? 0.48 : 0.72)), 0.34);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, isOutdoorExerciseStationTraining ? -2.35 + cooldown * 0.30 : (isTrainingMatTraining ? -0.85 + exert * 0.28 : -step * (isTreadmillPractice ? 0.38 : 0.62) - (isTreadmillPractice ? 0.20 : 0)), 0.30);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, isOutdoorExerciseStationTraining ? -2.25 - cooldown * 0.28 : (isTrainingMatTraining ? -0.65 - exert * 0.26 : step * (isTreadmillPractice ? 0.38 : 0.62) - (isTreadmillPractice ? 0.20 : 0)), 0.30);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, isOutdoorExerciseStationTraining ? 0.48 + exert * 0.10 : (isTrainingMatTraining ? 0.34 + exert * 0.18 : (isTreadmillPractice ? 0.22 + exert * 0.12 : 0.08)), 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, isOutdoorExerciseStationTraining ? -0.48 - exert * 0.10 : (isTrainingMatTraining ? -0.34 - exert * 0.18 : (isTreadmillPractice ? -0.22 - exert * 0.12 : -0.08)), 0.16);
    g.position.y = (g.userData._groundY || 0) + stride * (isOutdoorExerciseStationTraining ? 0.035 : (isTrainingMatTraining ? 0.025 : (isTreadmillPractice ? 0.055 : 0.075)));

  } else if (isServerRackUse || isMedicalSupplyCabinetBrowse || isDresserBrowse || isWardrobeBrowse || isNightstandInspect || isSideTableInspect || isAccessoryDisplayStandBrowse || isDisplayCaseBrowse || isShopShelfBrowse || isPantryShelfBrowse || isDisplayMannequinPreview || isDumbbellRackUse || (isSalonMirrorStationUse && !isSalonMirrorStationService) || isClothingRackBrowse || isBookshelfBrowse || isCurtainsAdjust || isBulletinBoardRead || isOutdoorNoticeBoardRead || isWallArtInspect || isMenuBoardRead) {
    // ── SERVER RACK / MEDICAL SUPPLY CABINET / DRESSER / WARDROBE / NIGHTSTAND / DISPLAY CASE / SHOP SHELF / PANTRY SHELF / DISPLAY / MIRROR / RACK / SHELF / CURTAINS / BOARD / WALL ART / MENU BOARD BROWSE & READ ─
    // DRESSER OPEN DRAWER / BROWSE / CHANGE and WARDROBE / CLOSET OPEN DOOR / BROWSE / CHANGE compatibility marker for asset tests.
    // NIGHTSTAND stand/lean inspect and optional place/take small item gesture compatibility marker for asset tests.
    // SIDE TABLE stand/inspect and set-down surface gesture compatibility marker for asset tests.
    // ACCESSORY DISPLAY STAND, DISPLAY CASE, SHOP SHELF browse/reach/select, PANTRY SHELF browse/reach/inspect, and DUMBBELL RACK browse/select reach/select compatibility marker for asset tests.
    // CLOTHING RACK BROWSE / SELECT stand/reach/select compatibility marker for rack outfit/accessory browse tests.
    // DISPLAY MANNEQUIN preview/reach/select compatibility marker for mannequin inspect/preview pose tests.
    // MENU BOARD stand/read/point pose compatibility marker for cafe/shop menu display tests.
    // WALL ART / PICTURE FRAMES stand/inspect look pose compatibility marker for asset tests.
    // Stand in front of the cabinet/dresser/wardrobe/nightstand/side table/mannequin/display/rack/shelf/curtains/corkboard/wall art/menu board, lean slightly,
    // scan side-to-side, then open/reach/browse/select or point at posted information.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.4;
    const browse = Math.sin(cs.workPhase);
    const reach = Math.max(0, Math.sin(cs.workPhase * 1.7));
    const pointPose = ((isBulletinBoardRead && bedActivityKind === 'bulletin-board-point') || (isOutdoorNoticeBoardRead && bedActivityKind === 'outdoor-notice-board-inspect') || (isMenuBoardRead && bedActivityKind === 'menu-board-point')) ? 1 : 0;
    const wallArtPose = isWallArtInspect ? 1 : 0;
    const menuBoardPose = isMenuBoardRead ? 1 : 0;
    const curtainReach = isCurtainsOpenClose ? 1 : 0;
    const retailBrowseReach = (isClothingRackBrowse || isDisplayMannequinPreview) ? Math.max(0.42, reach) : reach;
    const weightSelectReach = isDumbbellRackUse ? Math.max(0.35, retailBrowseReach) : retailBrowseReach;
    const lean = 0.065 + weightSelectReach * 0.040 + pointPose * 0.018 + wallArtPose * 0.010 + curtainReach * 0.018;
    const headPitch = 0.050 + weightSelectReach * 0.018 + pointPose * 0.018 + wallArtPose * 0.012 + curtainReach * 0.010;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.16);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, browse * 0.035, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY * Math.cos(lean), 0.14);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + Math.sin(lean) * parts.headBaseY * 0.55, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, browse * ((isBulletinBoardRead || isOutdoorNoticeBoardRead || isWallArtInspect || isMenuBoardRead) ? 0.18 : 0.32), 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, headPitch, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.55 - weightSelectReach * 0.45 - pointPose * 0.10, 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.85 - weightSelectReach * 0.75 - pointPose * 0.35 - curtainReach * 0.22, 0.24);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, (isDumbbellRackUse ? 0.28 : (isClothingRackBrowse || isDisplayMannequinPreview ? 0.24 : 0.18)) + browse * 0.08, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, (isDumbbellRackUse ? -0.44 : (isClothingRackBrowse || isDisplayMannequinPreview ? -0.40 : -0.34)) - browse * 0.08 - pointPose * 0.22 - curtainReach * 0.12 - menuBoardPose * 0.04, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(browse) * 0.01;

  } else if (isOfficeChairWork) {
    // ── OFFICE CHAIR SEATED WORK INTERACTION ───────────────
    // Agent sits through the office-chair approach/seat waypoints, then uses a
    // compact typing/focus loop while the persistent chair remains in place.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.4;
    const keyTap = Math.sin(cs.workPhase * 4.2);
    const wristTap = Math.sin(cs.workPhase * 6.6);
    const idleBob = Math.abs(Math.sin(cs.workPhase * 1.1)) * 0.006;
    applySeatedBasePose({ lift: 0.78, lean: 0.13 + Math.abs(keyTap) * 0.018, headForward: 0.17, talk: keyTap * 0.08, bob: idleBob });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.07 + Math.abs(wristTap) * 0.018, 0.16);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, keyTap * 0.035, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -1.25 + keyTap * 0.10, 0.30);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.25 - keyTap * 0.10, 0.30);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.30 + wristTap * 0.08, 0.20);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.30 - wristTap * 0.08, 0.20);

  } else if (isPlainChairSitting || isCouchLounging || isArmchairLounging || isHallwayBenchWaiting || isBarStoolSitting || isDiningChairSitting || isPatioChairSitting || isConferenceChairSitting || isBarberChairSitting || isExamChairPatient || isSmallRoundMeetingTable || (isSmallCafeTableUse && !isSmallCafeTableSetDown)) {
    // ── COUCH / LOUNGE SEAT INTERACTION; ARMCHAIR / BAR STOOL / OFFICE CHAIR / DINING CHAIR / CONFERENCE CHAIR / BARBER CHAIR / EXAM CHAIR SEATED INTERACTION ──
    // BARBER CHAIR SEATED INTERACTION compatibility marker for asset tests.
    // BAR STOOL SEATED INTERACTION compatibility marker for asset tests.
    // DINING CHAIR SEATED EATING/TALKING INTERACTION compatibility marker for asset tests.
    // Relaxed seated/lounge pose with a sit/rest/listen loop; bar-stool,
    // dining-chair, patio-chair, conference-chair, and barber chair modes stay more upright. Meeting/social modes add small gestures.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.8;
    const talkingFromSeat = isCouchSocializing || isArmchairSocializing || isBarStoolChatting || isDiningChairTalking || isPatioChairTalking || isConferenceChairMeeting || isSmallCafeTableSocial;
    const serviceLoop = (isBarberChairSitting || isExamChairPatient) ? Math.sin(cs.workPhase * 2.2) : 0;
    const eatingLoop = isDiningChairEating ? Math.sin(cs.workPhase * 4.1) : 0;
    const talk = talkingFromSeat ? Math.sin(cs.workPhase * 3.2) : (isDiningChairEating ? eatingLoop * 0.35 : serviceLoop * 0.28);
    const loungeBreath = Math.sin(cs.workPhase * 1.4) * 0.012;
    const recline = isExamChairPatient ? 0.30 : (isBarberChairSitting ? 0.18 : (talkingFromSeat ? 0.14 : 0.10));
    const normalReferenceScale = 0.8;
    const currentScale = Number.isFinite(g.scale?.y) && g.scale.y > 0 ? g.scale.y : normalReferenceScale;
    const liftForAgentScale = (referenceLift) => referenceLift * (normalReferenceScale / currentScale);
    const softSeatLift = isArmchairLounging ? 1.84 : ((isCouchLounging || isLoveseatLounging) ? 1.52 : null);
    const benchSeatLift = (isHallwayBenchWaiting || isParkBenchSeated || isSmallCafeTableUse || isOutdoorCafeTableUse || isSmallRoundMeetingTable) ? 1.34 : null;
    const referenceSeatLift = Number.isFinite(agent._idleActivity?.seatSurfaceLift)
      ? agent._idleActivity.seatSurfaceLift
      : (isBarStoolSitting ? 4.2 : (softSeatLift ?? benchSeatLift ?? 1.20));
    const seatedLift = liftForAgentScale(referenceSeatLift);
    applySeatedBasePose({ lift: seatedLift, lean: recline, headForward: 0.16, talk, bob: 0.006 + loungeBreath * 0.18 });
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, talkingFromSeat ? 0.04 : -0.02, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, talk * 0.22, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, (isBarberChairSitting || isExamChairPatient) ? -0.05 + serviceLoop * 0.04 : (talkingFromSeat ? -0.25 - Math.max(0, talk) * 0.28 : 0.16), 0.22);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, (isBarberChairSitting || isExamChairPatient) ? -0.08 - serviceLoop * 0.04 : (talkingFromSeat ? -0.18 + Math.min(0, talk) * 0.22 : 0.22), 0.22);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, (isBarberChairSitting || isExamChairPatient) ? 0.18 : (talkingFromSeat ? 0.35 + talk * 0.12 : 0.28), 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, (isBarberChairSitting || isExamChairPatient) ? -0.18 : (talkingFromSeat ? -0.30 + talk * 0.10 : -0.28), 0.16);
    // Lower-body seated pose is handled by applySeatedBasePose above.

  } else if (isBarberChairService || isSalonMirrorStationService) {
    // ── BARBER CHAIR / SALON MIRROR STANDING SERVICE LOOP ───
    // BARBER CHAIR STANDING SERVICE LOOP compatibility marker for asset tests.
    // Optional service-agent pose: stand at the stylist spot, lean toward the
    // seated customer/mirror, and alternate hands as if trimming/styling hair.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.6;
    const snip = Math.sin(cs.workPhase * 3.4);
    const lean = 0.30 + Math.abs(snip) * 0.06;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lean, 0.16);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, snip * 0.025, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY * Math.cos(lean), 0.14);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + Math.sin(lean) * parts.headBaseY * 0.74, 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.18 + Math.abs(snip) * 0.04, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.72 + snip * 0.18, 0.24);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.12 - snip * 0.22, 0.26);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.22 + snip * 0.08, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.34 - snip * 0.08, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
    g.position.y = (g.userData._groundY || 0) + Math.abs(snip) * 0.008;

  } else if (isParkBenchSeated || isParkBenchStandingUp) {
    // ── PARK BENCH SIT / REST / READ / SOCIALIZE ────────────
    // Shared seated outdoor pose without desk typing arms. Agents route through
    // setAgentTarget/dynamic exterior routing to a seat spot, transition down,
    // idle/rest/talk/read on the solid bench, then stand when the reservation ends.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.55;
    const forcedFacing = Number.isFinite(agent._idleActivity?.faceAngle) ? agent._idleActivity.faceAngle : null;
    if (forcedFacing != null) g.rotation.y = forcedFacing;
    const talk = isParkBenchSocializing ? Math.sin(cs.workPhase * 3.2) : 0;
    const readLean = isParkBenchReading ? 0.08 : 0;
    const standT = isParkBenchStandingUp ? Math.min(1, (cs.workPhase % 1.2) / 1.2) : 0;
    applySeatedBasePose({ lift: 0.46 + standT * 0.22, lean: 0.08 + readLean - standT * 0.08, headForward: 0.08 + readLean, talk, bob: Math.abs(Math.sin(cs.workPhase * 1.6)) * 0.006 });
    if (isParkBenchReading) {
      parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, -0.78, 0.18);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.76, 0.18);
      parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z, 0.20, 0.14);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z, -0.20, 0.14);
    } else if (isParkBenchSocializing) {
      parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, -0.22 + Math.max(0, talk) * 0.16, 0.16);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.26 + Math.max(0, -talk) * 0.14, 0.16);
      parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z, 0.12 + talk * 0.08, 0.14);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z, -0.12 + talk * 0.08, 0.14);
    } else {
      parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, -0.18, 0.14);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.18, 0.14);
      parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z, 0.08, 0.14);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z, -0.08, 0.14);
    }

  } else if (isBusStopWaiting) {
    // ── BUS STOP / WAITING SHELTER SIT-WAIT-STAND-CHECK ─────
    // Uses the existing routed outdoor node target: agents either relax in the
    // shelter seat or stand at the sidewalk-facing wait spot and occasionally
    // check down the road. No desk typing or carried transit prop is involved.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.45;
    const check = Math.max(0, Math.sin(cs.workPhase * 1.15));
    const seated = bedActivityKind === 'outdoor-node-sit' || agent._idleActivity?.roles?.includes?.('seat');
    if (seated) {
      applySeatedBasePose({ lift: 0.76, lean: 0.12 + check * 0.02, headForward: 0.10, talk: 0, bob: Math.abs(Math.sin(cs.workPhase)) * 0.004 });
      parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.03, 0.12);
      parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, Math.sin(cs.workPhase * 0.65) * 0.16, 0.10);
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.12, 0.16);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.16 - check * 0.16, 0.16);
      parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.22, 0.14);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.20 - check * 0.06, 0.14);
    } else {
      parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.04 + check * 0.04, 0.12);
      parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, Math.sin(cs.workPhase * 0.8) * 0.025, 0.12);
      parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.02 + check * 0.03, 0.12);
      parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, Math.sin(cs.workPhase * 0.75) * 0.24, 0.12);
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.12, 0.16);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.20 - check * 0.36, 0.20);
      parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.16 - check * 0.10, 0.16);
      parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.02, 0.16);
      parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.02, 0.16);
      g.position.y = (g.userData._groundY || 0) + Math.abs(Math.sin(cs.workPhase * 0.8)) * 0.006;
    }

  } else if (isPathNodeStroll) {
    // ── WALKING PATH NODE STROLL / OPTIONAL PAUSE ───────────
    // Non-solid marker-only outdoor activity: use normal walking/standing
    // proportions with a brief look-around pause. No seated pose or prop is
    // introduced; main3d's existing setAgentTarget/dynamic routing owns motion.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.55;
    const look = Math.sin(cs.workPhase * 0.95) * 0.30;
    const step = Math.sin(cs.workPhase * 2.0);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.035, 0.12);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, Math.sin(cs.workPhase * 0.6) * 0.018, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.015, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, look, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.14 - step * 0.08, 0.16);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.14 + step * 0.08, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, step * 0.06, 0.14);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -step * 0.06, 0.14);
    g.position.y = (g.userData._groundY || 0) + Math.abs(step) * 0.004;

  } else if (isCrosswalkCrossing) {
    // ── CROSSWALK / CROSSING NODE WALK-LOOK PAUSE ───────────
    // Marker-only outdoor activity: keep normal standing/walking proportions,
    // add a small look-left-right pause while the existing route handoff owns
    // movement. No seated, service, or prop animation is used.
    cs.workPhase = (cs.workPhase || 0) + dt * 1.85;
    const look = Math.sin(cs.workPhase * 1.25) * 0.42;
    const step = Math.sin(cs.workPhase * 2.3);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0.045, 0.12);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, Math.sin(cs.workPhase * 0.7) * 0.025, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.02, 0.12);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, look, 0.14);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.18 - step * 0.10, 0.16);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.18 + step * 0.10, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, step * 0.08, 0.14);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -step * 0.08, 0.14);
    g.position.y = (g.userData._groundY || 0) + Math.abs(step) * 0.006;

  } else if (isBedResting) {
    // ── BED / SLEEP POD INTERACTION ─────────────────────────
    // Lie down on the pod, keep a slow breathing loop, and add a tiny dream sway.
    cs.sleepPhase += dt * (isDreaming ? 0.9 : 0.55);
    const breath = Math.sin(cs.sleepPhase * 2.2) * 0.018;
    const dreamSway = isDreaming ? Math.sin(cs.sleepPhase * 3.0) * 0.05 : 0;
    const lieAngle = Math.PI / 2;
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, lieAngle, 0.16);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, dreamSway, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY * 0.35, 0.12);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + 0.46, 0.12);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0.05, 0.12);
    parts.headGroup.rotation.z = _lerp(parts.headGroup.rotation.z, dreamSway * 1.4, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, 0.65, 0.2);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0.65, 0.2);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, 0.18, 0.16);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.18, 0.16);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0.08, 0.16);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.08, 0.16);
    g.position.y = (g.userData._groundY || 0) + 0.18 + breath;

  } else if (isGymBenchExercise) {
    // ── GYM BENCH SIT/LIE EXERCISE POSE ─────────────────────
    // Agent docks to the bench-use spot after routing through the approach
    // waypoint, then alternates a flat bench press/rest pose without any
    // separate barbell/weight asset.
    cs.workPhase = (cs.workPhase || 0) + dt * 2.4;
    const press = Math.max(0, Math.sin(cs.workPhase * 1.9));
    const brace = Math.sin(cs.workPhase * 0.9);
    const isRest = bedActivityKind === 'gym-bench-rest';
    const recline = isRest ? 1.02 : 1.24;
    parts.bodyGroup.position.y = _lerp(parts.bodyGroup.position.y, 0.44, 0.18);
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, recline, 0.16);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, brace * 0.035, 0.12);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY - 0.18, 0.14);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ + 0.32, 0.14);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, isRest ? 0.05 : 0.16, 0.14);
    parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, brace * 0.08, 0.12);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, isRest ? -0.18 : -1.15 - press * 0.78, 0.28);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, isRest ? -0.18 : -1.15 - press * 0.78, 0.28);
    parts.leftArm.rotation.z  = _lerp(parts.leftArm.rotation.z || 0, isRest ? 0.22 : 0.46 + press * 0.16, 0.18);
    parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, isRest ? -0.22 : -0.46 - press * 0.16, 0.18);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, -0.72 + press * 0.10, 0.20);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, -0.72 - press * 0.10, 0.20);
    parts.leftLeg.rotation.z  = _lerp(parts.leftLeg.rotation.z || 0, 0.10, 0.16);
    parts.rightLeg.rotation.z = _lerp(parts.rightLeg.rotation.z || 0, -0.10, 0.16);
    g.position.y = (g.userData._groundY || 0) + 0.24 + (isRest ? Math.abs(brace) * 0.006 : press * 0.018);

  } else if (isWaking || isCouchStandingUp || isLoveseatStandingUp || isArmchairStandingUp || isHallwayBenchStandingUp || isBarStoolStandingUp || isDiningChairStandingUp || isPatioChairStandingUp || isConferenceChairStandingUp || agent._schedPhase === 'office-chair-stand-up' || isBarberChairStandingUp || isGymBenchStandingUp) {
    // Wake / stand transition out of a sleep-pod rest or couch/loveseat/armchair/bar-stool/dining-chair/patio-chair/conference-chair seat.
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0, 0.08);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, 0, 0.08);
    parts.headGroup.position.y = _lerp(parts.headGroup.position.y, parts.headBaseY, 0.08);
    parts.headGroup.position.z = _lerp(parts.headGroup.position.z, parts.headBaseZ, 0.08);
    parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, -0.08, 0.1);
    parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, -0.25, 0.12);
    parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -0.25, 0.12);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0, 0.12);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, 0, 0.12);
    g.position.y = g.userData._groundY || 0;

  } else if (isSleeping) {
    // ── SCHEDULED SLEEPING ANIMATION ─────────────────────────
    cs.sleepPhase += dt * 0.5;
    const sway = Math.sin(cs.sleepPhase) * 0.05;
    parts.bodyGroup.rotation.z = sway;
    parts.headGroup.rotation.z = sway * 1.5;
    parts.headGroup.rotation.x = 0.15; // drooped forward
    parts.leftArm.rotation.x  = 0.3;
    parts.rightArm.rotation.x = 0.3;
    parts.leftLeg.rotation.x  = 0;
    parts.rightLeg.rotation.x = 0;
    g.position.y = g.userData._groundY || 0;

  } else {
    // ── IDLE ANIMATION — cute micro-actions ─────────────────
    // Smoothly return to neutral pose
    parts.bodyGroup.rotation.x = _lerp(parts.bodyGroup.rotation.x, 0, 0.12);
    parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, 0, 0.12);
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0, 0.15);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, 0, 0.15);
    g.position.y = g.userData._groundY || 0;

    // Idle action system — cycle through cute animations
    if (!cs.idleAction) cs.idleAction = 'stand';
    if (!cs.idleTimer) cs.idleTimer = 0;
    cs.idleTimer += dt;

    // Pick new idle action every 3-8 seconds
    if (cs.idleTimer > cs.idleActionDuration) {
      cs.idleTimer = 0;
      const actions = ['stand', 'stand', 'lookAround', 'scratchHead', 'yawn', 'stretch', 'shiftWeight'];
      cs.idleAction = actions[Math.floor(Math.random() * actions.length)];
      cs.idleActionDuration = 3 + Math.random() * 5;
    }

    const t = cs.idleTimer;
    switch (cs.idleAction) {
      case 'lookAround':
        // Look left, then right, then center — curious
        const lookPhase = (t * 0.8) % 6;
        if (lookPhase < 2) {
          parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0.35, 0.06);
        } else if (lookPhase < 4) {
          parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, -0.35, 0.06);
        } else {
          parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.08);
        }
        parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, 0, 0.1);
        parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0, 0.1);
        break;
        
      case 'scratchHead':
        // Right arm reaches up to scratch head
        parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -1.8, 0.08);
        parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z || 0, -0.3, 0.08);
        parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, 0, 0.1);
        // Tiny head tilt toward scratch
        parts.headGroup.rotation.z = _lerp(parts.headGroup.rotation.z, 0.08, 0.06);
        parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.08);
        break;
        
      case 'yawn':
        // Stretch arms up briefly, then settle
        if (t < 1.5) {
          parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, -2.5, 0.06);
          parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, -2.5, 0.06);
          parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, -0.15, 0.06);
        } else {
          parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, 0, 0.08);
          parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0, 0.08);
          parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0, 0.08);
        }
        parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.08);
        break;
        
      case 'stretch':
        // One arm stretch to the side
        if (t < 2) {
          parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, -1.2, 0.06);
          parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z || 0, 0.8, 0.06);
          parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, -0.05, 0.06);
        } else {
          parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, 0, 0.08);
          parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z || 0, 0, 0.08);
          parts.bodyGroup.rotation.z = _lerp(parts.bodyGroup.rotation.z, 0, 0.08);
        }
        parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0, 0.1);
        parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.08);
        break;
        
      case 'shiftWeight':
        // Subtle weight shift side to side
        const shift = Math.sin(t * 1.5) * 0.04;
        parts.bodyGroup.rotation.z = shift;
        parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, 0, 0.1);
        parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0, 0.1);
        parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.08);
        break;
        
      default: // 'stand' — simple calm stand
        parts.leftArm.rotation.x = _lerp(parts.leftArm.rotation.x, 0, 0.1);
        parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0, 0.1);
        parts.headGroup.rotation.y = _lerp(parts.headGroup.rotation.y, 0, 0.08);
        parts.headGroup.rotation.z = _lerp(parts.headGroup.rotation.z, 0, 0.08);
        break;
    }
  }

  // ── RESET: clean up rotations from idle actions ────────────
  // Always reset z-rotation on arms (scratch/stretch set these)
  if (parts.leftArm.rotation.z) parts.leftArm.rotation.z = _lerp(parts.leftArm.rotation.z, 0, 0.12);
  if (parts.rightArm.rotation.z) parts.rightArm.rotation.z = _lerp(parts.rightArm.rotation.z, 0, 0.12);
  
  if (!isMoving) {
    parts.leftLeg.rotation.x  = _lerp(parts.leftLeg.rotation.x, 0, 0.12);
    parts.rightLeg.rotation.x = _lerp(parts.rightLeg.rotation.x, 0, 0.12);
    if (!isWorking && !isTalking && !isClinicService && !isExamChairService && !isCoffeeMachineUse && !isCoffeeDeskConsume && !isVendingMachineUse && !isMicrowaveUse && !isPingPongPlay && !isPoolTablePlay && !isMeetingTable && !isSmallRoundMeetingTable && !isPrinterScannerUse && !isToolCartUse && !isWorkbenchUse && !isStorageBoxesUse && !isLaptopMonitorWork && !isStandingDeskWork && !isDraftingTableWork && !isWhiteboardUse && !isTeachingPodiumUse && !isDisplayMannequinPreview && !isDresserBrowse && !isWardrobeBrowse && !isNightstandInspect && !isClothingRackBrowse && !isBulletinBoardRead && !isOutdoorNoticeBoardRead && !isMenuBoardRead) {
      parts.leftArm.rotation.x  = _lerp(parts.leftArm.rotation.x, 0, 0.10);
      parts.rightArm.rotation.x = _lerp(parts.rightArm.rotation.x, 0, 0.10);
    }
    if (!isSleeping) {
      parts.headGroup.rotation.x = _lerp(parts.headGroup.rotation.x, 0, 0.08);
    }
  }

  // ── PRESENCE STATUS DOT ───────────────────────────────────
  if (parts.statusDot) {
    const normalizedStatus = normalizeAgentAnimationStatus(agent?.status);
    const isActiveWork = normalizedStatus === 'working';
    const pulse = isActiveWork ? 1 + Math.sin(Date.now() / 260) * 0.28 : 1;
    parts.statusDot.material.color.setHex(getAgentPresenceDotColor(normalizedStatus));
    parts.statusDot.material.opacity = normalizedStatus === 'offline' || normalizedStatus === 'unknown' ? 0.68 : 0.96;
    parts.statusDot.scale.setScalar(pulse);
    parts.statusDot.visible = true;
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════
function _lerp(a, b, t) {
  return a + (b - a) * t;
}

function syncRightHandCarryVisual(parts, agent) {
  const rightHand = parts?.visualParts?.rightHandMesh;
  const rightArm = parts?.rightArm || rightHand?.parent || null;
  if (!rightHand || !rightArm) return;
  const isPingPongActivity = String(agent?._idleActivity?.kind || '').startsWith('pingpong-');
  const carried = agent?._carriedItem || agent?._carrying || (agent?.carryItem ? { label: agent.carryItem } : null);
  const carryKey = [
    carried?.kind,
    carried?.visualKind,
    carried?.label,
    carried?.id,
    carried?.catalogId,
    carried?.sourceFurnitureType,
    agent?.carryItem,
  ].filter(Boolean).join(' ').toLowerCase();
  const isCoffee = carried && carryKey.includes('coffee');
  const isWater = carried && (carryKey.includes('water') || carryKey.includes('water cup'));
  const isDrinkCup = isCoffee || isWater;
  const isHeatedSnack = carried && (
    carryKey.includes('heated snack') ||
    carryKey.includes('snack') ||
    carryKey.includes('microwave') ||
    carryKey.includes('popcorn') ||
    carryKey.includes('pizza') ||
    carryKey.includes('sandwich') ||
    carryKey.includes('cookie') ||
    carryKey.includes('granola') ||
    carryKey.includes('chocolate') ||
    carryKey.includes('soft drink') ||
    carryKey.includes('vending')
  );
  const isPongRacket = isPingPongActivity || (carried && carryKey.includes('pingpong'));
  const deskSipState = getCoffeeDeskSipState(agent);
  const showDrinkInHand = isDrinkCup && (!deskSipState.isDeskConsume || deskSipState.handActive);
  const showDrinkOnDesk = isDrinkCup && deskSipState.isDeskConsume && !deskSipState.handActive;
  const showSnackInHand = isHeatedSnack && (!deskSipState.isDeskConsume || deskSipState.handActive);
  const showSnackOnDesk = isHeatedSnack && deskSipState.isDeskConsume && !deskSipState.handActive;
  let cup = rightArm.getObjectByName('rightHandCoffeeDrink') || rightHand.getObjectByName('rightHandCoffeeDrink');
  let snack = rightArm.getObjectByName('rightHandHeatedSnack') || rightHand.getObjectByName('rightHandHeatedSnack');
  let racket = rightArm.getObjectByName('rightHandPingPongRacket') || rightHand.getObjectByName('rightHandPingPongRacket');
  syncDeskCoffeeCupVisual(parts, agent, showDrinkOnDesk);
  syncDeskVendingItemVisual(parts, agent, showSnackOnDesk);
  if (!showDrinkInHand && cup) {
    disposeCarryVisual(cup);
    cup = null;
  }
  if (!showSnackInHand && snack) {
    disposeCarryVisual(snack);
    snack = null;
  }
  if (!isPongRacket && racket) {
    disposeCarryVisual(racket);
    racket = null;
  }
  if (isPongRacket) {
    const color = Number(carried?.color || agent?._pingPongPaddleColor) || (agent?._pingPongSide === 'right' ? 0x2196f3 : 0xf44336);
    if (racket && (racket.parent !== rightArm || racket.userData?.paddleColor !== color)) {
      racket.parent?.remove(racket);
      racket.traverse?.(child => { child.geometry?.dispose?.(); });
      racket = null;
    }
    if (!racket) {
      racket = new THREE.Group();
      racket.name = 'rightHandPingPongRacket';
      racket.userData.paddleColor = color;
      // True hand-held paddle: the handle begins at the right hand center and
      // the large colored blade extends forward/down from that handle. This is
      // parented to the arm (not floating in world space), so it moves with the
      // hand while agents walk to the table and while they swing.
      racket.add(box(0, -0.08, 0.03, 0.08, 0.34, 0.08, 0x5d4037));
      racket.add(box(0, -0.36, 0.14, 0.62, 0.48, 0.12, 0x2b1b12));
      racket.add(box(0, -0.36, 0.205, 0.54, 0.40, 0.13, color));
      racket.add(box(0, -0.36, 0.285, 0.34, 0.24, 0.04, 0xfff7ed));
      racket.position.set(0.00, -0.46, 0.03);
      racket.rotation.x = -0.34;
      racket.rotation.y = agent?._pingPongSide === 'right' ? -0.45 : 0.45;
      racket.rotation.z = agent?._pingPongSide === 'right' ? 0.18 : -0.18;
      rightArm.add(racket);
    }
    racket.visible = true;
  }

  if (showSnackInHand) {
    const snackVariant = getVendingItemVisualMeta(carried || {}).variant;
    if (snack && (snack.userData?.snackVariant !== snackVariant || snack.userData?.assetVersion !== VENDING_ITEM_ASSET_VERSION)) {
      disposeCarryVisual(snack);
      snack = null;
    }
    if (!snack) {
      // Attach to the arm group (not the scaled hand mesh) so the item renders
      // at full size and rides the arm's sip/lift animation like the coffee cup.
      snack = buildVendingItemAsset('rightHandHeatedSnack', carried || {});
      rightArm.add(snack);
    } else if (snack.parent !== rightArm) {
      snack.parent?.remove(snack);
      rightArm.add(snack);
    }
    placeRightHandVendingItemAsset(snack, agent);
    snack.visible = true;
  }
  if (!showDrinkInHand) return;
  if (cup && (cup.userData?.assetVersion !== COFFEE_CUP_ASSET_VERSION || cup.userData?.drinkKind !== (isWater ? 'water' : 'coffee'))) {
    disposeCarryVisual(cup);
    cup = null;
  }
  if (!cup) {
    cup = buildCoffeeCupAsset('rightHandCoffeeDrink', { drinkKind: isWater ? 'water' : 'coffee' });
  }
  if (cup.parent !== rightArm) {
    cup.parent?.remove(cup);
    rightArm.add(cup);
  }
  placeRightHandCoffeeCupAsset(cup, agent);
  cup.visible = true;
}

function _applyExpression(parts, expr, lipColor) {
  if (!expr) return;

  // Eyebrow Y offset — smooth lerp instead of instant snap
  if (parts.leftBrow) {
    const targetBrowY = 0.18 + expr.eyebrowY;
    parts.leftBrow.position.y = _lerp(parts.leftBrow.position.y, targetBrowY, 0.15);
    parts.rightBrow.position.y = _lerp(parts.rightBrow.position.y, targetBrowY, 0.15);
  }

  // Eye scale (squint or widen) — smooth transition
  if (parts.leftEye && parts.rightEye) {
    const es = expr.eyeScale;
    parts.leftEye.scale.y  = _lerp(parts.leftEye.scale.y, es, 0.15);
    parts.rightEye.scale.y = _lerp(parts.rightEye.scale.y, es, 0.15);
  }

  // Mouth swap — only rebuild if mouth type actually changed
  if (parts.mouthGroup) {
    const currentMouthType = parts.mouthGroup.userData._mouthType || 'line';
    if (currentMouthType !== expr.mouthType) {
      const parent = parts.mouthGroup.parent;
      if (parent) {
        const pos = parts.mouthGroup.position.clone();
        parent.remove(parts.mouthGroup);
        const newMouth = buildMouth(expr.mouthType, lipColor);
        newMouth.position.copy(pos);
        newMouth.userData._mouthType = expr.mouthType;
        parent.add(newMouth);
        parts.mouthGroup = newMouth;
      }
    }
  }
}

function _setEyelids(parts, closed) {
  if (parts.leftEye) {
    parts.leftEye.traverse(c => {
      if (c.name === 'eyelid') c.visible = closed;
      if (c.name === 'iris' || c.name === 'pupil' || c.name === 'shine') {
        c.visible = !closed;
      }
    });
  }
  if (parts.rightEye) {
    parts.rightEye.traverse(c => {
      if (c.name === 'eyelid') c.visible = closed;
      if (c.name === 'iris' || c.name === 'pupil' || c.name === 'shine') {
        c.visible = !closed;
      }
    });
  }
}
