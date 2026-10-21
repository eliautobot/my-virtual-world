// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import { createFleetVehicleModelMetadata } from './fleet-vehicle-proportions.mjs';
import { createSedanModelMetadata } from './sedan-proportions.mjs';

const COLORS = Object.freeze({
  tire: 0x20252b,
  hub: 0xc4cbd0,
  glass: 0x263b4a,
  glassLight: 0x39586c,
  grille: 0x1f2930,
  bumper: 0x4f5960,
  headlight: 0xffe082,
  tailLight: 0xef5350,
  plate: 0xf5f1dc,
  yellow: 0xf5c518,
  policeBlue: 0x164f9c,
  emergencyRed: 0xd32f2f,
  white: 0xf2f4f3,
});

export const TRAFFIC_VEHICLE_WHEEL_CENTER_Y = -0.18;
export const TRAFFIC_VEHICLE_WHEEL_WELL_CLEARANCE = 0.0005;
export const TRAFFIC_VEHICLE_WHEEL_WELL_CURVE_SEGMENTS = 32;
export const TRAFFIC_VEHICLE_WHEEL_RADIAL_SEGMENTS = 64;
export const TRAFFIC_VEHICLE_TIRE_EXPOSED_FRACTION = 0.4;

export const TRAFFIC_VEHICLE_MODEL_TYPES = Object.freeze([
  'car',
  'sedan',
  'taxi',
  'truck',
  'suv',
  'van',
  'police',
  'ambulance',
  'bus',
]);

function normalizeColor(value, fallback = 0x3f7cac) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(0xffffff, Math.floor(number))) : fallback;
}

function shade(color, multiplier) {
  const value = normalizeColor(color);
  const channel = shift => Math.max(0, Math.min(255, Math.round(((value >> shift) & 0xff) * multiplier)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function box(x, y, z, width, height, depth, color) {
  return Object.freeze({ x, y, z, width, height, depth, color: normalizeColor(color) });
}

function addPair(parts, x, y, z, width, height, depth, color) {
  parts.push(box(x, y, z, width, height, depth, color));
  parts.push(box(x, y, -z, width, height, depth, color));
}

function addFourLights(parts, frontX, rearX, y, z, size = 0.11) {
  addPair(parts, frontX, y, z, 0.045, size, size, COLORS.headlight);
  addPair(parts, rearX, y, z, 0.045, size, size, COLORS.tailLight);
}

function addBumpersAndPlates(parts, frontX, rearX, width) {
  parts.push(box(frontX, -0.16, 0, 0.045, 0.09, width, COLORS.bumper));
  parts.push(box(rearX, -0.16, 0, 0.045, 0.09, width, COLORS.bumper));
  parts.push(box(frontX + 0.041, -0.105, 0, 0.018, 0.065, 0.22, COLORS.plate));
  parts.push(box(rearX - 0.041, -0.105, 0, 0.018, 0.065, 0.22, COLORS.plate));
}

function addMirrors(parts, x, y, z, color) {
  addPair(parts, x, y, z, 0.12, 0.08, 0.09, color);
}

function addSideTrim(parts, x, y, z, width, color) {
  addPair(parts, x, y, z, width, 0.055, 0.025, color);
}

function wheelSpec(radius, width, axleXs, bodyHalfWidth) {
  // Seat most of each tire inside the body-side wheel well while leaving
  // enough tread visible beyond the outer panel to read clearly in profile.
  const wheelZ = bodyHalfWidth
    - width * (0.5 - TRAFFIC_VEHICLE_TIRE_EXPOSED_FRACTION);
  const positions = axleXs.flatMap(wheelX => [
    [wheelX, wheelZ],
    [wheelX, -wheelZ],
  ]);
  return Object.freeze({
    radius,
    width,
    bodyHalfWidth,
    centerY: TRAFFIC_VEHICLE_WHEEL_CENTER_Y,
    positions: Object.freeze(positions.map(position => Object.freeze([...position]))),
  });
}

function circularWheelWellPanel({ x, y, z, width, height, depth, color }, wheels) {
  return [Object.freeze({
    kind: 'circularWheelWellPanel',
    x,
    y,
    z,
    width,
    height,
    depth,
    color: normalizeColor(color),
    wheelCenterY: wheels.centerY,
    wheelWellRadius: wheels.radius + TRAFFIC_VEHICLE_WHEEL_WELL_CLEARANCE,
    curveSegments: TRAFFIC_VEHICLE_WHEEL_WELL_CURVE_SEGMENTS,
    wheelXs: Object.freeze([...new Set(wheels.positions.map(([wheelX]) => wheelX))]),
  })];
}

/**
 * Builds a solid center chassis plus curved outer side panels. Each panel is
 * rendered as one extruded mesh with circular tire-radius cutouts.
 */
function wheelWellBody({ x, y, z = 0, width, height, depth, color }, wheels) {
  const halfDepth = depth / 2;
  const nearestTireInnerEdge = Math.min(...wheels.positions.map(([, wheelZ]) => (
    Math.abs(wheelZ) - wheels.width / 2
  )));
  const coreHalfDepth = Math.max(0.05, Math.min(
    halfDepth,
    nearestTireInnerEdge - TRAFFIC_VEHICLE_WHEEL_WELL_CLEARANCE,
  ));
  const parts = [box(x, y, z, width, height, coreHalfDepth * 2, color)];
  const sideDepth = halfDepth - coreHalfDepth;
  if (sideDepth <= 1e-6) return parts;
  for (const side of [-1, 1]) {
    parts.push(...circularWheelWellPanel({
      x,
      y,
      z: z + side * (coreHalfDepth + sideDepth / 2),
      width,
      height,
      depth: sideDepth,
      color,
    }, wheels));
  }
  return parts;
}

function addWheelAwareSideTrim(parts, wheels, x, y, z, width, color) {
  for (const side of [-1, 1]) {
    parts.push(...circularWheelWellPanel({
      x,
      y,
      z: side * z,
      width,
      height: 0.055,
      depth: 0.025,
      color,
    }, wheels));
  }
}

function carDefinition(color, { taxi = false, police = false } = {}) {
  const body = taxi ? COLORS.yellow : police ? COLORS.white : normalizeColor(color);
  const roof = shade(body, 0.78);
  const wheels = wheelSpec(
    police ? 0.23 : 0.22,
    police ? 0.14 : 0.135,
    [0.39, -0.39],
    0.32,
  );
  const shell = [
    ...wheelWellBody({ x: 0, y: -0.01, width: 1.18, height: 0.32, depth: 0.64, color: body }, wheels),
    ...wheelWellBody({ x: 0, y: -0.17, width: 1.08, height: 0.1, depth: 0.62, color: shade(body, 0.62) }, wheels),
    box(0.38, 0.18, 0, 0.38, 0.18, 0.59, body),
    box(-0.04, 0.37, 0, 0.58, 0.36, 0.54, roof),
    ...wheelWellBody({ x: -0.47, y: 0.15, width: 0.24, height: 0.18, depth: 0.58, color: body }, wheels),
    box(0.265, 0.4, 0, 0.04, 0.25, 0.46, COLORS.glass),
    box(-0.345, 0.4, 0, 0.04, 0.22, 0.43, COLORS.glassLight),
  ];
  const details = [];
  for (const side of [-1, 1]) {
    details.push(box(0.11, 0.4, side * 0.282, 0.24, 0.22, 0.025, COLORS.glass));
    details.push(box(-0.17, 0.4, side * 0.282, 0.22, 0.22, 0.025, COLORS.glassLight));
    details.push(box(-0.02, 0.09, side * 0.326, 0.025, 0.24, 0.022, shade(body, 0.58)));
    details.push(box(-0.19, 0.11, side * 0.332, 0.12, 0.025, 0.018, COLORS.hub));
  }
  details.push(box(0.606, -0.02, 0, 0.025, 0.12, 0.27, COLORS.grille));
  addFourLights(details, 0.61, -0.61, police ? 0.005 : -0.015, 0.235, 0.105);
  addBumpersAndPlates(details, police ? 0.645 : 0.64, police ? -0.645 : -0.64, 0.6);
  addMirrors(details, 0.24, 0.35, 0.35, roof);
  addWheelAwareSideTrim(details, wheels, 0, -0.08, 0.327, 0.84, shade(body, 0.6));

  if (taxi) {
    details.push(box(-0.03, 0.59, 0, 0.24, 0.11, 0.24, COLORS.white));
    details.push(box(-0.03, 0.592, 0, 0.15, 0.115, 0.25, COLORS.grille));
    for (const side of [-1, 1]) {
      for (let index = 0; index < 6; index++) {
        details.push(box(-0.38 + index * 0.15, 0.08, side * 0.334, 0.075, 0.065, 0.018, index % 2 ? COLORS.white : COLORS.grille));
      }
    }
  }
  if (police) {
    addWheelAwareSideTrim(details, wheels, 0, 0.04, 0.335, 0.92, COLORS.policeBlue);
    details.push(box(-0.04, 0.59, 0, 0.38, 0.055, 0.12, COLORS.grille));
    details.push(box(-0.04, 0.625, 0.07, 0.16, 0.08, 0.1, 0xe53935));
    details.push(box(-0.04, 0.625, -0.07, 0.16, 0.08, 0.1, 0x1e88e5));
  }
  return { shell, details, wheels };
}

function sedanDefinition(color) {
  const body = normalizeColor(color);
  const roof = shade(body, 0.8);
  const wheels = wheelSpec(0.23, 0.135, [0.46, -0.46], 0.31);
  const shell = [
    ...wheelWellBody({ x: 0, y: -0.025, width: 1.34, height: 0.3, depth: 0.62, color: body }, wheels),
    ...wheelWellBody({ x: 0.02, y: -0.17, width: 1.22, height: 0.09, depth: 0.61, color: shade(body, 0.6) }, wheels),
    box(0.47, 0.16, 0, 0.36, 0.15, 0.58, body),
    box(0.02, 0.35, 0, 0.66, 0.34, 0.53, roof),
    ...wheelWellBody({ x: -0.52, y: 0.14, width: 0.29, height: 0.16, depth: 0.57, color: body }, wheels),
    box(0.36, 0.37, 0, 0.04, 0.23, 0.45, COLORS.glass),
    box(-0.33, 0.37, 0, 0.04, 0.21, 0.42, COLORS.glassLight),
  ];
  const details = [];
  for (const side of [-1, 1]) {
    details.push(box(0.18, 0.38, side * 0.278, 0.28, 0.2, 0.025, COLORS.glass));
    details.push(box(-0.16, 0.38, side * 0.278, 0.27, 0.2, 0.025, COLORS.glassLight));
    details.push(box(0, 0.08, side * 0.318, 0.025, 0.22, 0.022, shade(body, 0.55)));
    details.push(box(-0.25, 0.11, side * 0.324, 0.12, 0.024, 0.018, COLORS.hub));
  }
  details.push(box(0.692, -0.03, 0, 0.025, 0.1, 0.28, COLORS.grille));
  addFourLights(details, 0.69, -0.69, -0.02, 0.23, 0.095);
  addBumpersAndPlates(details, 0.72, -0.72, 0.58);
  addMirrors(details, 0.31, 0.34, 0.34, roof);
  addWheelAwareSideTrim(details, wheels, 0, -0.09, 0.32, 1.02, shade(body, 0.6));
  return { shell, details, wheels };
}

function truckDefinition(color) {
  const body = normalizeColor(color);
  const dark = shade(body, 0.65);
  const wheels = wheelSpec(0.29, 0.165, [0.49, -0.51], 0.36);
  const shell = [
    ...wheelWellBody({ x: 0, y: -0.08, width: 1.46, height: 0.25, depth: 0.72, color: dark }, wheels),
    ...wheelWellBody({ x: 0.49, y: 0.13, width: 0.48, height: 0.25, depth: 0.67, color: body }, wheels),
    box(0.12, 0.4, 0, 0.52, 0.4, 0.62, body),
    box(0.4, 0.42, 0, 0.045, 0.26, 0.52, COLORS.glass),
    box(-0.18, 0.42, 0, 0.04, 0.24, 0.49, COLORS.glassLight),
    ...wheelWellBody({ x: -0.46, y: 0.08, width: 0.68, height: 0.16, depth: 0.6, color: dark }, wheels),
    box(-0.46, 0.28, 0.315, 0.68, 0.22, 0.09, body),
    box(-0.46, 0.28, -0.315, 0.68, 0.22, 0.09, body),
    box(-0.79, 0.28, 0, 0.09, 0.22, 0.72, body),
  ];
  const details = [
    box(-0.46, 0.18, 0, 0.58, 0.035, 0.53, COLORS.grille),
    box(0.745, 0.08, 0, 0.03, 0.17, 0.42, COLORS.grille),
  ];
  addFourLights(details, 0.75, -0.82, 0.05, 0.27, 0.12);
  addBumpersAndPlates(details, 0.81, -0.85, 0.67);
  addMirrors(details, 0.34, 0.4, 0.4, dark);
  addWheelAwareSideTrim(details, wheels, 0.06, -0.04, 0.365, 1.25, dark);
  for (const side of [-1, 1]) {
    details.push(box(0.12, 0.43, side * 0.322, 0.38, 0.25, 0.025, COLORS.glass));
    details.push(box(0.12, 0.12, side * 0.368, 0.025, 0.22, 0.02, dark));
  }
  return { shell, details, wheels };
}

function suvDefinition(color) {
  const body = normalizeColor(color);
  const dark = shade(body, 0.62);
  const wheels = wheelSpec(0.28, 0.16, [0.43, -0.43], 0.36);
  const shell = [
    ...wheelWellBody({ x: 0, y: -0.03, width: 1.36, height: 0.34, depth: 0.72, color: body }, wheels),
    ...wheelWellBody({ x: 0, y: -0.2, width: 1.22, height: 0.1, depth: 0.7, color: dark }, wheels),
    ...wheelWellBody({ x: 0.39, y: 0.2, width: 0.42, height: 0.2, depth: 0.67, color: body }, wheels),
    box(-0.08, 0.44, 0, 0.78, 0.42, 0.64, body),
    box(0.33, 0.46, 0, 0.045, 0.28, 0.54, COLORS.glass),
    box(-0.5, 0.46, 0, 0.04, 0.25, 0.5, COLORS.glassLight),
  ];
  const details = [box(0.7, 0.02, 0, 0.025, 0.17, 0.36, COLORS.grille)];
  for (const side of [-1, 1]) {
    details.push(box(0.13, 0.47, side * 0.333, 0.32, 0.25, 0.025, COLORS.glass));
    details.push(box(-0.28, 0.47, side * 0.333, 0.34, 0.25, 0.025, COLORS.glassLight));
    details.push(box(0, 0.08, side * 0.365, 0.025, 0.28, 0.02, dark));
    details.push(box(-0.28, 0.12, side * 0.37, 0.13, 0.025, 0.018, COLORS.hub));
  }
  addFourLights(details, 0.71, -0.71, 0.02, 0.27, 0.12);
  addBumpersAndPlates(details, 0.75, -0.75, 0.68);
  addMirrors(details, 0.3, 0.45, 0.4, dark);
  details.push(box(-0.12, 0.7, 0.26, 0.72, 0.055, 0.055, COLORS.grille));
  details.push(box(-0.12, 0.7, -0.26, 0.72, 0.055, 0.055, COLORS.grille));
  details.push(box(-0.735, 0.14, 0, 0.13, 0.34, 0.34, COLORS.tire));
  details.push(box(-0.81, 0.14, 0, 0.025, 0.15, 0.15, COLORS.hub));
  return { shell, details, wheels };
}

function vanDefinition(color, { ambulance = false } = {}) {
  const body = ambulance ? COLORS.white : normalizeColor(color);
  const accent = ambulance ? COLORS.emergencyRed : shade(body, 0.62);
  const wheels = wheelSpec(
    ambulance ? 0.28 : 0.26,
    ambulance ? 0.165 : 0.155,
    [0.45, -0.46],
    0.34,
  );
  const shell = [
    ...wheelWellBody({ x: 0, y: -0.03, width: 1.42, height: 0.34, depth: 0.68, color: body }, wheels),
    box(-0.12, 0.41, 0, 1.08, 0.55, 0.64, body),
    box(0.5, 0.34, 0, 0.3, 0.43, 0.64, body),
    box(0.665, 0.39, 0, 0.04, 0.32, 0.53, COLORS.glass),
    box(-0.68, 0.39, 0, 0.035, 0.38, 0.5, ambulance ? COLORS.white : shade(body, 0.85)),
  ];
  const details = [box(0.72, 0.01, 0, 0.025, 0.15, 0.34, COLORS.grille)];
  for (const side of [-1, 1]) {
    details.push(box(0.42, 0.43, side * 0.333, 0.32, 0.3, 0.025, COLORS.glass));
    details.push(box(-0.15, 0.33, side * 0.337, 0.035, 0.48, 0.02, accent));
    details.push(box(-0.3, 0.19, side * 0.34, 0.14, 0.03, 0.018, COLORS.hub));
  }
  addWheelAwareSideTrim(details, wheels, 0, -0.07, 0.35, 1.12, accent);
  addFourLights(details, 0.73, -0.73, ambulance ? 0.035 : 0.01, 0.26, 0.115);
  addBumpersAndPlates(details, 0.77, -0.77, 0.65);
  addMirrors(details, 0.59, 0.42, 0.4, COLORS.grille);
  details.push(box(-0.705, 0.4, 0, 0.02, 0.4, 0.025, accent));
  if (ambulance) {
    addSideTrim(details, -0.1, 0.24, 0.345, 1.12, COLORS.emergencyRed);
    details.push(box(-0.18, 0.45, 0.348, 0.08, 0.34, 0.02, COLORS.emergencyRed));
    details.push(box(-0.18, 0.45, -0.348, 0.08, 0.34, 0.02, COLORS.emergencyRed));
    details.push(box(-0.18, 0.45, 0.348, 0.34, 0.08, 0.02, COLORS.emergencyRed));
    details.push(box(-0.18, 0.45, -0.348, 0.34, 0.08, 0.02, COLORS.emergencyRed));
    details.push(box(-0.12, 0.72, 0, 0.45, 0.055, 0.13, COLORS.grille));
    details.push(box(-0.12, 0.755, 0.075, 0.18, 0.08, 0.1, COLORS.emergencyRed));
    details.push(box(-0.12, 0.755, -0.075, 0.18, 0.08, 0.1, 0x1e88e5));
  }
  return { shell, details, wheels };
}

function busDefinition() {
  const body = COLORS.yellow;
  const wheels = wheelSpec(0.34, 0.185, [0.66, -0.67], 0.37);
  const shell = [
    ...wheelWellBody({ x: 0, y: -0.02, width: 2.02, height: 0.38, depth: 0.74, color: body }, wheels),
    ...wheelWellBody({ x: -0.08, y: 0.43, width: 1.82, height: 0.6, depth: 0.7, color: body }, wheels),
    ...wheelWellBody({ x: 0.94, y: 0.18, width: 0.25, height: 0.3, depth: 0.7, color: body }, wheels),
    box(0.985, 0.49, 0, 0.04, 0.35, 0.58, COLORS.glass),
    box(-1.005, 0.46, 0, 0.035, 0.3, 0.54, COLORS.glassLight),
  ];
  const details = [
    box(1.04, 0.02, 0, 0.025, 0.17, 0.44, COLORS.grille),
    box(0, 0.77, 0, 1.65, 0.08, 0.6, shade(body, 0.88)),
  ];
  for (const side of [-1, 1]) {
    for (let index = 0; index < 7; index++) {
      details.push(box(0.65 - index * 0.245, 0.5, side * 0.363, 0.19, 0.3, 0.025, index === 0 ? COLORS.glass : COLORS.glassLight));
    }
    details.push(box(0, 0.21, side * 0.375, 1.92, 0.075, 0.025, COLORS.grille));
    details.push(...circularWheelWellPanel({
      x: 0.7,
      y: 0.17,
      z: side * 0.378,
      width: 0.28,
      height: 0.46,
      depth: 0.025,
      color: COLORS.grille,
    }, wheels));
  }
  addFourLights(details, 1.05, -1.05, 0.02, 0.29, 0.12);
  addBumpersAndPlates(details, 1.09, -1.09, 0.7);
  addMirrors(details, 0.91, 0.57, 0.43, COLORS.grille);
  return {
    shell,
    details,
    accessories: Object.freeze(['routeSign']),
    wheels,
  };
}

export function createTrafficVehicleModelDefinition(type, color) {
  const normalizedType = TRAFFIC_VEHICLE_MODEL_TYPES.includes(String(type || '').toLowerCase())
    ? String(type).toLowerCase()
    : 'car';
  let definition;
  switch (normalizedType) {
    case 'sedan': definition = createSedanModelMetadata('sedan'); break;
    case 'taxi': definition = createFleetVehicleModelMetadata('taxi'); break;
    case 'truck': definition = createFleetVehicleModelMetadata('truck'); break;
    case 'suv': definition = createFleetVehicleModelMetadata('suv'); break;
    case 'van': definition = createFleetVehicleModelMetadata('van'); break;
    case 'police': definition = createFleetVehicleModelMetadata('police'); break;
    case 'ambulance': definition = createFleetVehicleModelMetadata('ambulance'); break;
    case 'bus': definition = createFleetVehicleModelMetadata('bus'); break;
    default: definition = createSedanModelMetadata('car'); break;
  }
  return Object.freeze({
    type: normalizedType,
    scale: 2,
    shell: Object.freeze(definition.shell),
    details: Object.freeze(definition.details),
    accessories: Object.freeze(definition.accessories || []),
    wheels: Object.freeze({
      radius: definition.wheels.radius,
      width: definition.wheels.width,
      bodyHalfWidth: definition.wheels.bodyHalfWidth,
      centerY: definition.wheels.centerY,
      positions: definition.wheels.positions,
    }),
  });
}

export { COLORS as TRAFFIC_VEHICLE_MODEL_COLORS };
