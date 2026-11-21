// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const shapeDefaults = Object.freeze({
  height: 1,
  build: 1,
  shoulders: 1,
  chest: 1,
  waist: 1,
  hips: 1,
  arms: 1,
  legs: 1,
  legLength: 1,
  head: 1,
  hands: 1,
  feet: 1,
});

export const shapeBounds = Object.freeze({
  height: [0.82, 1.18],
  build: [0.78, 1.24],
  shoulders: [0.82, 1.2],
  chest: [0.78, 1.25],
  waist: [0.75, 1.3],
  hips: [0.8, 1.25],
  arms: [0.75, 1.3],
  legs: [0.78, 1.28],
  legLength: [0.84, 1.16],
  head: [0.88, 1.12],
  hands: [0.8, 1.2],
  feet: [0.7, 1.05],
});

export const shortName = (object) =>
  (typeof object === "string" ? object : object.name).replace(
    /^mixamorig[:_]?/i,
    "",
  );
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (low, high, value) => {
  const factor = clamp((value - low) / (high - low), 0, 1);
  return factor * factor * (3 - 2 * factor);
};
const matrix = () => new THREE.Matrix4();
const vector = () => new THREE.Vector3();
const quaternion = () => new THREE.Quaternion();
const rad = THREE.MathUtils.degToRad;
const partNames = [
  "leftLeg",
  "torso",
  "rightArm",
  "head",
  "rightLeg",
  "leftArm",
];
const sourceCache = new Map();

function sourcePart(gender, mesh) {
  const match = /tripo_part_(\d+)/.exec(mesh.name);
  if (!match) throw new Error("Unrecognized foundation mesh: " + mesh.name);
  const index = Number(match[1]);
  return gender === "male" && (index === 2 || index === 5)
    ? index === 2
      ? "leftArm"
      : "rightArm"
    : partNames[index];
}

function bonePart(name) {
  const side = name.startsWith("Left") ? "left" : "right";
  if (/Leg|Foot|Toe/.test(name)) return side + "Leg";
  if (/Arm|Hand/.test(name)) return side + "Arm";
  if (/Head/.test(name)) return "head";
  return "torso";
}

function makeTree(entries, depth = 0) {
  if (!entries.length) return null;
  const axis = depth % 3;
  entries.sort((first, second) => first.xyz[axis] - second.xyz[axis]);
  const pivot = Math.floor(entries.length / 2);
  return {
    point: entries[pivot],
    axis,
    low: makeTree(entries.slice(0, pivot), depth + 1),
    high: makeTree(entries.slice(pivot + 1), depth + 1),
  };
}

function nearest(tree, coords, current) {
  if (!tree) return;
  const item = tree.point;
  const squared =
    (coords[0] - item.xyz[0]) ** 2 +
    (coords[1] - item.xyz[1]) ** 2 +
    (coords[2] - item.xyz[2]) ** 2;
  if (squared < current.distance) {
    current.distance = squared;
    current.point = item;
  }
  const delta = coords[tree.axis] - item.xyz[tree.axis];
  nearest(delta < 0 ? tree.low : tree.high, coords, current);
  if (delta * delta < current.distance)
    nearest(delta < 0 ? tree.high : tree.low, coords, current);
}

function triad(value, fallback, low, high) {
  return [0, 1, 2].map((axis) =>
    clamp(Number.isFinite(value?.[axis]) ? value[axis] : fallback, low, high),
  );
}

function motion(mode, time, name) {
  const wave = Math.sin(time * Math.PI * 2);
  const side = name.startsWith("Left") ? 1 : -1;
  if (mode === "idle") {
    if (name === "Spine1") return [Math.sin(time * Math.PI * 0.5) * 1.6, 0, 0];
    if (name === "Head") return [0, Math.sin(time * Math.PI * 0.5) * 3.5, 0];
    if (/^(Left|Right)Arm$/.test(name))
      return [0, 0, side * (1 + Math.sin(time * Math.PI * 0.5))];
  } else if (mode === "walk") {
    const thigh = side * wave * 20;
    const knee = 3 + Math.max(0, -side * Math.cos(time * Math.PI * 2)) * 34;
    if (/UpLeg$/.test(name)) return [thigh, 0, 0];
    if (/^(Left|Right)Leg$/.test(name)) return [knee, 0, 0];
    if (/Foot$/.test(name)) return [-thigh * 0.72 - knee * 0.85, 0, 0];
    if (/^(Left|Right)Arm$/.test(name)) return [-side * wave * 13, 0, side * 2];
    if (/ForeArm$/.test(name))
      return [-6 - Math.max(0, side * wave) * 10, 0, 0];
    if (name === "Spine1") return [-1.5, -wave * 3, 0];
  } else if (mode === "wave") {
    if (name === "RightShoulder") return [0, 0, -8];
    if (name === "RightArm") return [-12, 0, -65];
    if (name === "RightForeArm") return [-17, 0, -85];
    if (name === "RightHand") return [0, -67, -7 + wave * 12];
    if (name === "Head") return [0, -4, 3];
  } else if (mode === "studio" || mode === "relaxed") {
    if (/^(Left|Right)ForeArm$/.test(name)) return [-2, 0, 0];
  } else if (mode === "tpose") {
    if (/^(Left|Right)Arm$/.test(name)) return [0, 0, side * 72];
  }
  return null;
}

export async function loadBody(gender, onProgress) {
  if (gender !== "male" && gender !== "female")
    throw new Error("Unknown body foundation");
  if (!sourceCache.has(gender)) {
    sourceCache.set(
      gender,
      fetch("/assets/builder/" + gender + ".glb")
        .then((response) => {
          if (!response.ok)
            throw new Error(
              "Failed to load " + gender + " foundation: " + response.status,
            );
          return response.arrayBuffer();
        })
        .catch((error) => {
          sourceCache.delete(gender);
          throw error;
        }),
    );
  }
  const gltf = await new GLTFLoader().parseAsync(
    await sourceCache.get(gender),
    "",
  );
  if (typeof onProgress === "function") onProgress(1);
  return prepareBody(gender, gltf);
}

export function prepareBody(gender, gltf) {
  const root = gltf.scene;
  root.name = gender === "female" ? "FemaleFoundation" : "MaleFoundation";
  root.updateMatrixWorld(true);
  const meshes = [],
    records = new Map(),
    parts = {},
    source = {},
    trees = {},
    allSources = [];
  root.traverse((node) => {
    if (node.isSkinnedMesh) meshes.push(node);
  });
  if (meshes.length !== 6) throw new Error("Expected six authored body pieces");
  const skeleton = meshes[0].skeleton,
    bones = skeleton.bones;
  const boneMap = new Map(bones.map((bone) => [shortName(bone), bone]));
  const boneRecords = new Map(),
    authoredMaterials = new Set(),
    workingMaterials = new Map();
  for (const bone of bones) {
    const name = shortName(bone);
    boneRecords.set(name, {
      bone,
      name,
      part: bonePart(name),
      originalWorld: bone.matrixWorld.clone(),
      worldPosition: vector().setFromMatrixPosition(bone.matrixWorld),
      orientation: bone.getWorldQuaternion(quaternion()),
      localRotation: bone.quaternion.clone(),
      localScale: bone.scale.clone(),
      localPosition: bone.position.clone(),
      shapedLocal: bone.position.clone(),
      shapedWorld: vector(),
    });
  }
  const shape = { ...shapeDefaults };
  const overridesByPart = new Map();
  let headMaterial, sourceHeadMaterial;
  const hip = boneRecords.get("Hips").worldPosition.y,
    neck = boneRecords.get("Neck").worldPosition.y;
  let activePose = { mode: "bind", time: 0, overrides: {} };
  let neutralShape = true;
  const anchors = {};
  for (const prefix of ["Left", "Right"]) {
    anchors[prefix] = Object.fromEntries(
      ["UpLeg", "Leg", "Foot", "Shoulder", "Arm", "ForeArm", "Hand"].map(
        (key) => [key, boneRecords.get(prefix + key).worldPosition],
      ),
    );
  }
  for (const mesh of meshes) {
    const part = sourcePart(gender, mesh);
    const geometry = mesh.geometry;
    parts[part] = mesh;
    source[part] = geometry;
    mesh.geometry = geometry.clone();
    if (!workingMaterials.has(mesh.material)) {
      authoredMaterials.add(mesh.material);
      const material = mesh.material.clone();
      material.normalScale.multiplyScalar(0.65);
      workingMaterials.set(mesh.material, material);
    }
    mesh.material = workingMaterials.get(mesh.material);
    if (part === "head") {
      sourceHeadMaterial = mesh.material;
      mesh.material = headMaterial = sourceHeadMaterial.clone();
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.foundationPart = part;
    records.set(mesh, { geometry, part, body: true });
    const positions = geometry.attributes.position;
    const vertices = Array.from({ length: positions.count }, (_, index) => ({
      xyz: [
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      ],
      index,
      part,
    }));
    allSources.push(...vertices);
    trees[part] = makeTree(vertices);
  }
  const tree = makeTree(allSources);
  const skull = source.head;
  skull.computeBoundingBox();
  const crown = skull.boundingBox.max.y;
  // Redistribute length between the legs and rib cage. The shoulders carry
  // the arms, and the neck carries the head as a unit.
  function proportionOffset(y) {
    const legGain = Math.min(y, hip) * (shape.legLength - 1);
    const torso = smooth(hip, neck, y);
    return legGain * (1 - torso) - torso * (crown - neck) * (shape.head - 1);
  }
  const solePoints = [];
  for (const leg of ["leftLeg", "rightLeg"]) {
    const mesh = parts[leg],
      position = mesh.geometry.attributes.position;
    const lowestByCell = new Map();
    for (let index = 0; index < position.count; index++) {
      const y = position.getY(index);
      if (y > 0.036) continue;
      const cell =
        Math.floor(position.getX(index) * 85) +
        "/" +
        Math.floor(position.getZ(index) * 85);
      if (!lowestByCell.has(cell) || y < position.getY(lowestByCell.get(cell)))
        lowestByCell.set(cell, index);
    }
    for (const index of lowestByCell.values()) solePoints.push({ mesh, index });
  }
  const sample = (coords, part) => {
    const current = { distance: Infinity, point: null };
    nearest(trees[part] || tree, coords, current);
    return current.point;
  };
  function deformCoordinates(x, y, z, part, target, structure = null) {
    if (structure) {
      structure(x, y, z, target);
      ({ x, y, z } = target);
    }
    if (neutralShape) return target.set(x, y, z);
    const side =
      anchors[
        part.startsWith("left")
          ? "Left"
          : part.startsWith("right")
            ? "Right"
            : x >= 0
              ? "Left"
              : "Right"
      ];
    const sign = side.Arm.x > 0 ? 1 : -1;
    const limb = part.endsWith("Arm"),
      shoe = part === "shoe",
      leg = part.endsWith("Leg") || shoe;
    const headBlend = smooth(neck - 0.015, neck + 0.05, y);
    const hipInfluence = 1 - smooth(hip - 0.015, hip + 0.12, y);
    const shoulderBlend = smooth(neck - 0.075, neck - 0.006, y);
    const chestBlend = smooth(hip + 0.045, hip + 0.143, y);
    const widthBody = lerp(
      lerp(shape.waist, shape.chest, chestBlend),
      shape.hips,
      hipInfluence,
    );
    const width = lerp(widthBody, shape.shoulders, shoulderBlend);
    const build = Math.sqrt(shape.build);
    let dx = x * (lerp(width * build, shape.head, headBlend) - 1);
    let dz = z * (lerp(widthBody * build, shape.head, headBlend) - 1);
    let dy =
      proportionOffset(y) +
      (y - neck) * (shape.head - 1) * headBlend;
    if (limb || leg) {
      const start = limb ? side.Arm : side.UpLeg,
        middle = limb ? side.ForeArm : side.Leg,
        end = limb ? side.Hand : side.Foot;
      const high = y > middle.y ? start : middle,
        low = y > middle.y ? middle : end;
      const along = clamp((high.y - y) / (high.y - low.y), 0, 1);
      // The boot follows calf sizing at the shaft. Keep the vamp and the
      // front lace bed sized to the foot as they pass under the ankle.
      const lowerLeg = leg ? smooth(end.y - 0.013, end.y + 0.032, y) : 0;
      const overInstep = shoe
        ? smooth(0.015, 0.068, z - end.z) * (1 - smooth(end.y + 0.006, end.y + 0.032, y))
        : 0;
      const shaft = shoe ? lowerLeg * (1 - overInstep) : 1;
      const centerX = lerp(end.x, lerp(high.x, low.x, along), shaft),
        centerZ = lerp(end.z, lerp(high.z, low.z, along), shaft);
      const distal = limb
        ? 1 - smooth(end.y - 0.022, end.y + 0.035, y)
        : 1 - (shoe ? shaft : lowerLeg);
      const size = lerp(
        (limb ? shape.arms : shape.legs) * build,
        limb ? shape.hands : shape.feet,
        distal,
      );
      let shift = limb
        ? start.x * (shape.shoulders * build - 1)
        : start.x * (shape.hips * build - 1);
      if (limb) {
        const clearance = Math.max(
          0,
          (shape.hips * build - 1) * 0.064,
          (shape.waist * build - 1) * 0.045,
          (shape.chest * build - 1) * 0.035,
          (shape.legs * build - 1) * 0.025,
        );
        shift += sign * clearance * (1 - smooth(side.Hand.y, side.Arm.y, y));
      }
      // One connected trouser pattern crosses both thigh anchors. Ease their
      // opposing offsets through the center so girth edits keep the rise smooth.
      const lateralShift = shift - centerX * (size - 1);
      const medialBlend = part === "trouserLeg"
        ? smooth(0, Math.max(0.03, 3.8 * Math.abs(lateralShift) * smooth(hip - 0.21, hip - 0.13, y)), Math.abs(x))
        : 1;
      const limbX = x * (size - 1) + lateralShift * medialBlend,
        limbZ = (z - centerZ) * (size - 1);
      const seam = limb
        ? 1 - smooth(start.y - 0.036, start.y + 0.03, y)
        : 1 - smooth(hip - 0.071, hip - 0.008, y);
      dx = lerp(dx, limbX, seam);
      dz = lerp(dz, limbZ, seam);
      if (limb)
        dy =
          lerp(proportionOffset(y), proportionOffset(start.y), seam) +
          (y - end.y) * (shape.hands - 1) * distal;
      else dy += y * (shape.feet - 1) * distal;
    }
    return target.set(x + dx, (y + dy) * shape.height, z + dz);
  }
  function deformPoint(point, part) {
    const coord = Array.isArray(point) ? point : [point.x, point.y, point.z];
    return deformCoordinates(
      coord[0],
      coord[1],
      coord[2],
      part || sample(coord).part,
      vector(),
    );
  }
  const placed = vector(),
    fittedSleeve = vector(),
    derivativeX = vector(),
    derivativeY = vector(),
    derivativeZ = vector(),
    tangentX = vector(),
    tangentY = vector(),
    tangentZ = vector();
  const sourceSurfaceNormal = vector(),
    shapedSurfaceNormal = vector(),
    authoredNormal = vector(),
    normalRotation = quaternion();
  function updateSculptedNormals(record, geometry) {
    if (!record.referenceNormals) {
      const reference = record.geometry.clone();
      reference.computeVertexNormals();
      record.referenceNormals = reference.attributes.normal.clone();
      reference.dispose();
    }
    geometry.computeVertexNormals();
    const output = geometry.attributes.normal,
      original = record.geometry.attributes.normal;
    for (let index = 0; index < original.count; index++) {
      sourceSurfaceNormal.fromBufferAttribute(record.referenceNormals, index);
      shapedSurfaceNormal.fromBufferAttribute(output, index);
      authoredNormal.fromBufferAttribute(original, index);
      if (
        sourceSurfaceNormal.lengthSq() > 0.9 &&
        shapedSurfaceNormal.lengthSq() > 0.9
      ) {
        normalRotation.setFromUnitVectors(
          sourceSurfaceNormal,
          shapedSurfaceNormal,
        );
        authoredNormal.applyQuaternion(normalRotation).normalize();
      }
      output.setXYZ(
        index,
        authoredNormal.x,
        authoredNormal.y,
        authoredNormal.z,
      );
    }
  }
  // Transform the tangent plane with the local shape deformation. Blinked lids
  // and gaze targets can sit at different points on that deformation field.
  function fitNormal(x, y, z, part, point, nx, ny, nz, structure = null) {
    const e = 0.00005;
    deformCoordinates(x + e, y, z, part, derivativeX, structure).sub(point);
    deformCoordinates(x, y + e, z, part, derivativeY, structure).sub(point);
    deformCoordinates(x, y, z + e, part, derivativeZ, structure).sub(point);
    tangentX.crossVectors(derivativeY, derivativeZ).multiplyScalar(nx);
    tangentY.crossVectors(derivativeZ, derivativeX).multiplyScalar(ny);
    tangentZ.crossVectors(derivativeX, derivativeY).multiplyScalar(nz);
    return tangentX.add(tangentY).add(tangentZ).normalize();
  }
  function fitMorphTargets(mesh, record) {
    const geometry = mesh.geometry,
      source = record.geometry;
    const targets = source.morphAttributes.position;
    if (!targets?.length) return;
    // Three uploads morph targets as a texture on first draw. Invalidate that
    // texture when refitting the GPU geometry after a proportion edit.
    if (record.fittedMorphs) geometry.dispose();
    record.fittedMorphs = true;
    const relative = source.morphTargetsRelative;
    const base = source.attributes.position,
      baseN = source.attributes.normal;
    const fitted = geometry.attributes.position,
      fittedN = geometry.attributes.normal;
    for (let k = 0; k < targets.length; k++) {
      const input = targets[k],
        output = geometry.morphAttributes.position[k];
      const inputN = source.morphAttributes.normal?.[k],
        outputN = geometry.morphAttributes.normal?.[k];
      if (neutralShape && !record.structure) {
        output.copy(input);
        if (inputN) outputN.copy(inputN);
        continue;
      }
      for (let i = 0; i < input.count; i++) {
        const x = input.getX(i) + (relative ? base.getX(i) : 0);
        const y = input.getY(i) + (relative ? base.getY(i) : 0);
        const z = input.getZ(i) + (relative ? base.getZ(i) : 0);
        const part = record.part || record.vertexParts[i];
        deformCoordinates(x, y, z, part, placed, record.structure);
        output.setXYZ(
          i,
          placed.x - (relative ? fitted.getX(i) : 0),
          placed.y - (relative ? fitted.getY(i) : 0),
          placed.z - (relative ? fitted.getZ(i) : 0),
        );
        if (inputN) {
          const n = fitNormal(
            x,
            y,
            z,
            part,
            placed,
            inputN.getX(i) + (relative ? baseN.getX(i) : 0),
            inputN.getY(i) + (relative ? baseN.getY(i) : 0),
            inputN.getZ(i) + (relative ? baseN.getZ(i) : 0),
            record.structure,
          );
          outputN.setXYZ(
            i,
            n.x - (relative ? fittedN.getX(i) : 0),
            n.y - (relative ? fittedN.getY(i) : 0),
            n.z - (relative ? fittedN.getZ(i) : 0),
          );
        }
      }
    }
  }
  function fitRecord(mesh) {
    const record = records.get(mesh),
      materialGeometry = mesh.geometry;
    const position = materialGeometry.attributes.position,
      original = record.geometry.attributes.position;
    const originalNormal =
        record.sculptNormals || record.geometry.attributes.normal,
      normal = materialGeometry.attributes.normal;
    const offsets = record.body ? overridesByPart.get(record.part) : null;
    if (neutralShape && !offsets && !record.structure) {
      position.copy(original);
      if (normal && originalNormal) normal.copy(originalNormal);
    } else {
      for (let index = 0; index < original.count; index++) {
        const start = index * 3,
          x = original.getX(index) + (offsets?.[start] || 0),
          y = original.getY(index) + (offsets?.[start + 1] || 0),
          z = original.getZ(index) + (offsets?.[start + 2] || 0);
        const part = record.part || record.vertexParts[index];
        if (record.armBlend && (part === "torso" || part.endsWith("Arm"))) {
          // The shoulder follows a continuous mix of torso and arm girth
          // on both sides of the sewn armhole.
          const sleeve = record.armBlend[index] / 255;
          deformCoordinates(x, y, z, "torso", placed);
          if (sleeve) {
            deformCoordinates(x, y, z, x >= 0 ? "leftArm" : "rightArm", fittedSleeve);
            placed.lerp(fittedSleeve, sleeve);
          }
          position.setXYZ(index, placed.x, placed.y, placed.z);
          continue;
        }
        deformCoordinates(x, y, z, part, placed, record.structure);
        position.setXYZ(index, placed.x, placed.y, placed.z);
        if (
          (!offsets || record.sculptNormals) &&
          normal &&
          originalNormal &&
          (!neutralShape || record.structure)
        ) {
          const n = fitNormal(
            x,
            y,
            z,
            part,
            placed,
            originalNormal.getX(index),
            originalNormal.getY(index),
            originalNormal.getZ(index),
            record.structure,
          );
          normal.setXYZ(index, n.x, n.y, n.z);
        }
      }
      if (record.armBlend) materialGeometry.computeVertexNormals();
      else if (record.sculptNormals && neutralShape)
        normal.copy(record.sculptNormals);
      else if (offsets && originalNormal && !record.sculptNormals)
        updateSculptedNormals(record, materialGeometry);
    }
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
    fitMorphTargets(mesh, record);
    materialGeometry.computeBoundingBox();
    materialGeometry.computeBoundingSphere();
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
  }
  function setPartOffsets(part, offsets, sculptNormals = null) {
    if (!parts[part]) throw new Error("Unknown foundation part: " + part);
    if (
      offsets &&
      offsets.length !== source[part].attributes.position.count * 3
    )
      throw new Error("Invalid " + part + " offset array");
    if (
      sculptNormals &&
      (sculptNormals.itemSize !== 3 ||
        sculptNormals.count !== source[part].attributes.position.count)
    )
      throw new Error("Invalid " + part + " sculpt normals");
    records.get(parts[part]).sculptNormals = sculptNormals;
    if (part === "head")
      headMaterial.normalScale
        .copy(sourceHeadMaterial.normalScale)
        .multiplyScalar(sculptNormals ? 0.08 : 1);
    if (offsets?.some((value) => value !== 0))
      overridesByPart.set(part, offsets);
    else overridesByPart.delete(part);
    fitRecord(parts[part]);
  }
  function skinGeometry(geometry, name, material, fixedPart, structure = null) {
    if (fixedPart && !source[fixedPart])
      throw new Error("Unknown attachment body part: " + fixedPart);
    const original = geometry.clone(),
      position = original.attributes.position,
      indices = new Uint16Array(position.count * 4),
      weights = new Float32Array(position.count * 4),
      vertexParts = [];
    const known =
      original.hasAttribute("skinIndex") && original.hasAttribute("skinWeight");
    for (let index = 0; index < position.count; index++) {
      const part = fixedPart || geometry.userData.fitParts?.[index];
      const near =
        !part || !known
          ? sample(
              [
                position.getX(index),
                position.getY(index),
                position.getZ(index),
              ],
              part,
            )
          : null;
      vertexParts.push(part || near.part);
      if (!known) {
        const sourceGeometry = source[near.part],
          sourceIndices = sourceGeometry.attributes.skinIndex,
          sourceWeights = sourceGeometry.attributes.skinWeight;
        for (let lane = 0; lane < 4; lane++) {
          indices[index * 4 + lane] = sourceIndices.getComponent(
            near.index,
            lane,
          );
          weights[index * 4 + lane] = sourceWeights.getComponent(
            near.index,
            lane,
          );
        }
      }
    }
    if (!known) {
      geometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(indices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(weights, 4),
      );
    }
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.bind(skeleton, matrix());
    root.add(mesh);
    records.set(mesh, {
      geometry: original,
      body: false,
      part: fixedPart,
      structure,
      vertexParts,
      armBlend: geometry.userData.armBlend,
    });
    fitRecord(mesh);
    return mesh;
  }
  function fitFaceStructure(meshes, structure) {
    for (const mesh of meshes) {
      records.get(mesh).structure = structure;
      fitRecord(mesh);
    }
  }
  const poseEuler = new THREE.Euler(),
    poseQ = quaternion(),
    worldDelta = quaternion(),
    inverse = quaternion();
  function setPose(mode = "bind", time = 0, overrides = {}) {
    activePose = { mode, time, overrides };
    for (const record of boneRecords.values()) {
      const { bone, name } = record;
      bone.position.copy(record.shapedLocal);
      bone.scale.copy(record.localScale);
      bone.quaternion.copy(record.localRotation);
      const angles = motion(mode, time, name);
      if (angles) {
        worldDelta.setFromEuler(
          poseEuler.set(rad(angles[0]), rad(angles[1]), rad(angles[2]), "XYZ"),
        );
        poseQ
          .copy(inverse.copy(record.orientation).invert())
          .multiply(worldDelta)
          .multiply(record.orientation);
        bone.quaternion.multiply(poseQ);
      }
      const override = overrides?.[name] || overrides?.[bone.name];
      if (!override) continue;
      const input = Array.isArray(override) ? { rotation: override } : override;
      if (input.rotation) {
        const values = triad(input.rotation, 0, -360, 360);
        bone.quaternion.multiply(
          poseQ.setFromEuler(
            poseEuler.set(
              rad(values[0]),
              rad(values[1]),
              rad(values[2]),
              "XYZ",
            ),
          ),
        );
      }
      if (input.position || input.translation)
        bone.position.add(
          placed.fromArray(
            triad(input.position || input.translation, 0, -1, 1),
          ),
        );
      if (input.scale)
        bone.scale.multiply(placed.fromArray(triad(input.scale, 1, 0.1, 4)));
    }
    root.updateMatrixWorld(true);
    skeleton.update();
    if (
      mode === "walk" &&
      !Object.keys(overrides || {}).some((name) =>
        /Hips|Leg|Foot|Toe/.test(name),
      )
    ) {
      let contactHeight = Infinity;
      for (const { mesh, index } of solePoints) {
        placed.fromBufferAttribute(mesh.geometry.attributes.position, index);
        contactHeight = Math.min(
          contactHeight,
          mesh.applyBoneTransform(index, placed).y,
        );
      }
      boneMap.get("Hips").position.y -= contactHeight;
      root.updateMatrixWorld(true);
      skeleton.update();
    }
  }
  function setShape(patch = {}) {
    for (const key of Object.keys(shapeDefaults))
      if (Number.isFinite(patch[key]))
        shape[key] = clamp(patch[key], ...shapeBounds[key]);
    neutralShape = Object.keys(shapeDefaults).every((key) => shape[key] === 1);
    for (const record of boneRecords.values()) {
      const position = record.worldPosition;
      deformCoordinates(
        position.x,
        position.y,
        position.z,
        record.part,
        record.shapedWorld,
      );
    }
    for (const record of boneRecords.values()) {
      const parent = record.bone.parent?.isBone
        ? boneRecords.get(shortName(record.bone.parent))
        : null;
      if (neutralShape) record.shapedLocal.copy(record.localPosition);
      else if (parent) {
        const parentRest = matrix()
          .copy(parent.originalWorld)
          .setPosition(parent.shapedWorld)
          .invert();
        record.shapedLocal.copy(record.shapedWorld).applyMatrix4(parentRest);
      } else record.shapedLocal.copy(record.shapedWorld);
      record.bone.position.copy(record.shapedLocal);
      record.bone.quaternion.copy(record.localRotation);
      record.bone.scale.copy(record.localScale);
    }
    root.updateWorldMatrix(true, true);
    const inverseRoot = matrix().copy(root.matrixWorld).invert();
    for (let index = 0; index < bones.length; index++)
      skeleton.boneInverses[index]
        .multiplyMatrices(inverseRoot, bones[index].matrixWorld)
        .invert();
    for (const mesh of records.keys()) fitRecord(mesh);
    setPose(activePose.mode, activePose.time, activePose.overrides);
    return shape;
  }
  function setSkinColor(hex) {
    for (const [original, material] of workingMaterials) {
      if (hex === null || hex === undefined)
        material.color.copy(original.color);
      else material.color.set(hex);
    }
    headMaterial.color.copy(sourceHeadMaterial.color);
  }
  function releaseMesh(mesh) {
    const record = records.get(mesh);
    if (!record || record.body) return;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    record.geometry.dispose();
    records.delete(mesh);
  }
  function animationClips() {
    const previous = activePose,
      clips = [];
    for (const [mode, duration] of [
      ["idle", 4],
      ["walk", 1],
      ["wave", 2],
    ]) {
      const times = Array.from(
          { length: Math.round(duration * 24) + 1 },
          (_, index) => index / 24,
        ),
        animated = bones.filter(
          (bone) => motion(mode, 0, shortName(bone)) !== null,
        );
      const series = animated.map(() => []),
        hipPositions = [];
      for (const time of times) {
        setPose(mode, time);
        animated.forEach((bone, index) =>
          series[index].push(...bone.quaternion.toArray()),
        );
        if (mode === "walk")
          hipPositions.push(...boneMap.get("Hips").position.toArray());
      }
      const tracks = animated.map(
        (bone, index) =>
          new THREE.QuaternionKeyframeTrack(
            bone.name + ".quaternion",
            times,
            series[index],
          ),
      );
      if (mode === "walk")
        tracks.push(
          new THREE.VectorKeyframeTrack(
            boneMap.get("Hips").name + ".position",
            times,
            hipPositions,
          ),
        );
      clips.push(new THREE.AnimationClip(mode, duration, tracks));
    }
    setPose(previous.mode, previous.time, previous.overrides);
    return clips;
  }
  function dispose() {
    const textures = new Set();
    for (const mesh of [...records.keys()]) {
      const record = records.get(mesh);
      if (record.body) {
        mesh.geometry.dispose();
        record.geometry.dispose();
      } else releaseMesh(mesh);
    }
    for (const material of [
      ...authoredMaterials,
      ...workingMaterials.values(),
      headMaterial,
    ]) {
      for (const item of Object.values(material))
        if (item?.isTexture) textures.add(item);
      material.dispose();
    }
    for (const texture of textures) {
      texture.dispose();
      texture.source?.data?.close?.();
    }
    skeleton.dispose();
    records.clear();
    root.removeFromParent();
  }
  return {
    gender,
    sex: gender,
    root,
    meshes,
    parts,
    skeleton,
    bones,
    boneMap,
    shape,
    setShape,
    setPose,
    setSkinColor,
    setPartOffsets,
    skinGeometry,
    fitFaceStructure,
    releaseMesh,
    deformPoint,
    restGeometry: (part) => source[part],
    restJointPosition: (name) => boneRecords.get(name).worldPosition.clone(),
    animationClips,
    dispose,
  };
}
