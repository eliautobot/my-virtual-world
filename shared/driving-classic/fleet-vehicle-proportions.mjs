// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Each entry is introduced only when that vehicle's new asset is complete.
// Physical world units, not visual-only scaling; metadata is shared by the
// browser geometry and authoritative traffic collision/rolling calculations.
const FLEET = Object.freeze({
  bus: Object.freeze({
    type:'bus',revision:'bus-r1',bodyStyle:'bus',length:8.381,bodyLength:8.381,
    bodyShellHalfLength:4.04,bodyWidth:2.24,mirrorWidth:2.462,bodyHeight:2.882,totalHeight:3.085,
    wheelDiameter:.84,tireWidth:.28,track:1.84,frontAxle:2.47,rearAxle:-2.25,wheelbase:4.72,
    halfLength:4.21,halfWidth:1.24,paint:0xd5d8cd,detailDistance:100,
    cabinFrontBaseX:4.04,cabinFrontBaseY:1.46,cabinFrontRoofX:3.88,cabinFrontRoof:2.58,
    cabinRearBaseX:-4.04,cabinRearBaseY:1.46,cabinRearRoofX:-3.97,cabinRearRoof:2.60,
  }),
  ambulance: Object.freeze({
    type:'ambulance',revision:'ambulance-r1',bodyStyle:'ambulance',length:6.284,bodyLength:6.284,
    bodyShellHalfLength:2.96,bodyWidth:2.22,mirrorWidth:2.429,bodyHeight:2.59,totalHeight:2.740,
    wheelDiameter:.80,tireWidth:.27,track:1.76,frontAxle:2.04,rearAxle:-1.68,wheelbase:3.72,
    halfLength:3.16,halfWidth:1.23,paint:0xebeeeb,detailDistance:88,
    cabinFrontBaseX:2.19,cabinFrontBaseY:1.26,cabinFrontRoofX:1.49,cabinFrontRoof:1.98,
    cabinRearBaseX:.38,cabinRearBaseY:1.13,cabinRearRoofX:.40,cabinRearRoof:1.96,
  }),
  truck: Object.freeze({
    type:'truck',revision:'truck-r1',bodyStyle:'pickup',length:5.483,bodyLength:5.483,
    bodyShellHalfLength:2.55,bodyWidth:1.94,mirrorWidth:2.217,bodyHeight:1.83,totalHeight:1.944,
    wheelDiameter:.75,tireWidth:.25,track:1.63,frontAxle:1.60,rearAxle:-1.58,wheelbase:3.18,
    halfLength:2.76,halfWidth:1.12,detailDistance:80,
    cabinFrontBaseX:1.10,cabinFrontBaseY:1.13,cabinFrontRoofX:.58,cabinFrontRoof:1.77,
    cabinRearBaseX:-.62,cabinRearBaseY:1.125,cabinRearRoofX:-.60,cabinRearRoof:1.75,
  }),
  van: Object.freeze({
    type:'van',revision:'van-r1',bodyStyle:'van',length:5.442,bodyLength:5.442,
    bodyShellHalfLength:2.58,bodyWidth:1.96,mirrorWidth:2.362,bodyHeight:2.20,totalHeight:2.285,
    wheelDiameter:.70,tireWidth:.22,track:1.66,frontAxle:1.60,rearAxle:-1.58,wheelbase:3.18,
    halfLength:2.745,halfWidth:1.195,detailDistance:80,
    cabinFrontBaseX:2.16,cabinFrontBaseY:1.17,cabinFrontRoofX:1.16,cabinFrontRoof:2.08,
    cabinRearBaseX:-2.60,cabinRearBaseY:2.11,cabinRearRoofX:-2.58,cabinRearRoof:2.11,
  }),
  suv: Object.freeze({
    type:'suv',revision:'suv-r1',bodyStyle:'suv',length:5.007,bodyLength:4.778,
    bodyShellHalfLength:2.24,bodyWidth:1.90,mirrorWidth:2.131,
    bodyHeight:1.86,totalHeight:1.942,wheelDiameter:.74,tireWidth:.25,track:1.57,
    frontAxle:1.26,rearAxle:-1.39,wheelbase:2.65,halfLength:2.64,halfWidth:1.08,
    detailDistance:78,cabinFrontBaseX:.98,cabinFrontBaseY:1.09,cabinFrontRoofX:.42,cabinFrontRoof:1.79,
    cabinRearBaseX:-2.24,cabinRearBaseY:1.074,cabinRearRoofX:-2.17,cabinRearRoof:1.785,
  }),
  police: Object.freeze({
    type:'police',revision:'police-r1',length:5.316,bodyLength:5.156,bodyWidth:1.94,mirrorWidth:2.09,
    bodyHeight:1.50,totalHeight:1.655,wheelDiameter:.69,tireWidth:.235,track:1.68,
    frontAxle:1.43,rearAxle:-1.48,wheelbase:2.91,halfLength:2.76,halfWidth:1.055,
    paint:0xe6eaed,detailDistance:80,cabinFrontRoof:1.43,cabinRearRoof:1.40,
  }),
  taxi: Object.freeze({
    type: 'taxi', revision: 'taxi-r1',
    length: 5.156, bodyWidth: 1.94, mirrorWidth: 2.09,
    bodyHeight: 1.54, totalHeight: 1.80,
    wheelDiameter: .67, tireWidth: .22, track: 1.66,
    frontAxle: 1.46, rearAxle: -1.48, wheelbase: 2.94,
    halfLength: 2.59, halfWidth: 1.055,
    paint: 0xe8b92e, detailDistance: 76,
  }),
});
export const REALISTIC_FLEET_TYPES = Object.freeze(Object.keys(FLEET));
export const isRealisticFleetType = type => Object.hasOwn(FLEET, type);
export function getFleetVehicleProportions(type) {
  const d = FLEET[type];
  if (!d) throw new Error(`No rebuilt fleet geometry for ${type}`);
  return d;
}
export function createFleetVehicleModelMetadata(type) {
  const d = getFleetVehicleProportions(type);
  return {
    shell: [], details: [], accessories: [],
    wheels: {
      radius: d.wheelDiameter / 4, width: d.tireWidth / 2,
      centerY: -.18, bodyHalfWidth: d.bodyWidth / 4,
      positions: [d.frontAxle, d.rearAxle].flatMap(x => [[x/2,d.track/4],[x/2,-d.track/4]]),
    },
  };
}
export function createFleetTrafficSpec(type, speedMult) {
  const d = getFleetVehicleProportions(type);
  return Object.freeze({ speedMult, wheelRadius: d.wheelDiameter/4,
    collisionRadius: Math.hypot(d.halfLength,d.halfWidth),
    halfLength:d.halfLength,halfWidth:d.halfWidth,detailDistance:d.detailDistance });
}
