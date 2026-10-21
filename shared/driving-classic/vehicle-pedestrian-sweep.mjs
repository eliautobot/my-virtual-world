// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import RAPIER from '@dimforge/rapier3d-compat';

/** Bounding sphere about the same local origin as the existing chassis query.
 * Convex combinations of actual hull inputs cannot exceed their maximum radius.
 */
export function vehicleSweepRadius(vertices, halfLength, halfWidth) {
  if (vertices && vertices.length >= 12) {
    let squared = 0;
    for (let i = 0; i < vertices.length; i += 3) {
      const value = vertices[i] ** 2 + vertices[i + 1] ** 2 + vertices[i + 2] ** 2;
      if (!Number.isFinite(value)) return Infinity;
      squared = Math.max(squared, value);
    }
    return Math.sqrt(squared);
  }
  return Math.hypot(halfLength, .36, halfWidth * .94);
}

export function shapeBoundingRadius(shape) {
  if (!shape) return Infinity;
  switch (shape.type) {
    case RAPIER.ShapeType.Ball: return shape.radius;
    case RAPIER.ShapeType.Capsule: return shape.halfHeight + shape.radius;
    case RAPIER.ShapeType.Cuboid: return Math.hypot(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    default: return Infinity;
  }
}

/** Current collider center, never visual feet or next kinematic translation.
 * Captured once per beforeStep. Prediction may disable a capsule during that
 * synchronous step; that only makes this conservative candidate set larger.
 */
export function pedestrianSweepBound(collider) {
  if (!collider?.isValid()) return null;
  return {center: collider.translation(), radius: shapeBoundingRadius(collider.shape)};
}

/** true means keep the original Rapier query, not that an impact occurred.
 * This includes tangency, initial overlap, tilt, reverse and airborne motion.
 * Unknown or numerically unsafe inputs always retain the original query.
 */
export function maySweepSphere(start, velocity, dt, chassisRadius, target) {
  const point = target?.center, radius = target?.radius;
  if (!point || !start || !velocity) return true;
  const sx=start.x,sy=start.y,sz=start.z,vx=velocity.x,vy=velocity.y,vz=velocity.z;
  if (!Number.isFinite(sx)||!Number.isFinite(sy)||!Number.isFinite(sz)
      || !Number.isFinite(vx)||!Number.isFinite(vy)||!Number.isFinite(vz)
      || !Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.z)
      || !Number.isFinite(dt)||!Number.isFinite(chassisRadius)||!Number.isFinite(radius)
      || dt < 0 || chassisRadius < 0 || radius < 0) return true;
  const dx=vx*dt,dy=vy*dt,dz=vz*dt,px=point.x-sx,py=point.y-sy,pz=point.z-sz;
  const length2=dx*dx+dy*dy+dz*dz;
  if (!Number.isFinite(length2)) return true;
  const t=length2>1e-18?Math.max(0,Math.min(1,(px*dx+py*dy+pz*dz)/length2)):0;
  const distance2=(px-dx*t)**2+(py-dy*t)**2+(pz-dz*t)**2;
  // Outward Float32 margin, including remote world coordinates.
  const scale=Math.max(1,Math.abs(sx),Math.abs(sy),Math.abs(sz),Math.abs(point.x),Math.abs(point.y),Math.abs(point.z),Math.abs(dx),Math.abs(dy),Math.abs(dz));
  const reach=chassisRadius+radius+.01+scale*1e-6;
  return !Number.isFinite(distance2)||!Number.isFinite(reach*reach)||distance2<=reach*reach;
}
