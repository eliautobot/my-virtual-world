// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import RAPIER from '@dimforge/rapier3d-compat';
import {PHYSICS_GROUPS} from './physics-collision-groups.mjs';
import {vehicleControls} from './vehicle-gameplay.mjs';
import {vehicleSweepRadius} from './vehicle-pedestrian-sweep.mjs';
export {vehicleControls} from './vehicle-gameplay.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
const vec = (p = {}) => ({ x: finite(p.x), y: finite(p.y), z: finite(p.z) });
export const VEHICLE_PHYSICS_STEP = 1 / 60;
export const VEHICLE_HANDLING = Object.freeze({
  car: { mass: 1280, acceleration: 5.8, maxSpeed: 33 },
  sedan: { mass: 1450, acceleration: 5.5, maxSpeed: 34 },
  taxi: { mass: 1550, acceleration: 5.2, maxSpeed: 32 },
  police: { mass: 1650, acceleration: 7.2, maxSpeed: 39 },
  suv: { mass: 2100, acceleration: 4.8, maxSpeed: 30 },
  van: { mass: 2450, acceleration: 4.2, maxSpeed: 28 },
  truck: { mass: 4100, acceleration: 3.2, maxSpeed: 25 },
  ambulance: { mass: 4300, acceleration: 3.6, maxSpeed: 28 },
  bus: { mass: 7800, acceleration: 2.7, maxSpeed: 24 },
});

export function vehicleYaw(q, fallback=0) {
  const x=1-2*(q.y*q.y+q.z*q.z),z=2*(q.x*q.z-q.w*q.y);
  return Number.isFinite(x+z)&&Math.hypot(x,z)>.001?Math.atan2(-z,x):fallback;
}


/** Rapier's four-wheel impulse solver in the existing world, not a second simulation.
 * Local chassis axes: +X forward, +Y up, +Z right. Positions are the render root.
 * Wheels, suspension, tire traction and collisions act on one dynamic rigid body.
 */
export class VehicleDynamics {
  constructor(world) {
    this.world = world;
    this.vehicles = new Map();
    this.colliderIds = new Map();
  }

  add(id, options = {}) {
    if (!id || this.vehicles.has(id)) throw new Error('Vehicle id must be unique');
    const handling = VEHICLE_HANDLING[options.type] || VEHICLE_HANDLING.car;
    const mass = clamp(finite(options.mass, handling.mass), 500, 14000);
    const halfLength = clamp(finite(options.halfLength, 2.34), .5, 7);
    const halfWidth = clamp(finite(options.halfWidth, .96), .3, 2);
    const radius = clamp(finite(options.wheelRadius, .31), .18, .7);
    const restLength = .24;
    const position = vec(options.position);
    const yaw = finite(options.rotationY);
    const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z).setRotation(rotation)
      .setLinearDamping(.06).setAngularDamping(.65).setCcdEnabled(true)
      .setAdditionalSolverIterations(4));
    // Low centre of mass gives stable normal cornering without locking roll/pitch.
    // The body shell remains collision geometry; wheels are suspension rays.
    const hull = options.hullVertices instanceof Float32Array && options.hullVertices.length >= 12
      ? RAPIER.ColliderDesc.convexHull(options.hullVertices) : null;
    const shape = hull || RAPIER.ColliderDesc.cuboid(halfLength, .36, halfWidth * .94).setTranslation(0,.05,0);
    const collider = this.world.createCollider(shape
      .setMassProperties(mass,{x:0,y:hull?0:-.05,z:0},{x:mass*(halfWidth**2+.38**2)/3,y:mass*(halfLength**2+halfWidth**2)/3,z:mass*(halfLength**2+.38**2)/3},{x:0,y:0,z:0,w:1})
      .setFriction(.35).setRestitution(.08)
      .setCollisionGroups(PHYSICS_GROUPS.vehicle)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(mass * 1.5), body);
    const controller = this.world.createVehicleController(body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 0;
    const wheels = Array.isArray(options.wheels) && options.wheels.length === 4
      ? options.wheels.map(p => ({ x: finite(p.x), z: finite(p.z) }))
      : [1, -1].flatMap(front => [1, -1].map(side => ({ x: front * halfLength * .58, z: side * halfWidth * .8 })));
    for (const wheel of wheels) {
      controller.addWheel({ x: wheel.x, y: -.12, z: wheel.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, restLength, radius);
      const i = controller.numWheels() - 1;
      controller.setWheelSuspensionStiffness(i, 38);
      controller.setWheelSuspensionCompression(i, 4.8);
      controller.setWheelSuspensionRelaxation(i, 5.6);
      controller.setWheelMaxSuspensionTravel(i, .18);
      controller.setWheelMaxSuspensionForce(i, mass * 9.81 * .8);
      controller.setWheelFrictionSlip(i, 1.6);
      controller.setWheelSideFrictionStiffness(i, 1.1);
    }
    if (options.velocity) body.setLinvel(vec(options.velocity), true); // initial authority transfer only
    const vehicle = { id, body, collider, controller, mass, halfLength, halfWidth, radius, handling, wheels,
      sweepRadius: vehicleSweepRadius(hull ? options.hullVertices : null, halfLength, halfWidth),
      controls: vehicleControls(), steering: 0, throttle: 0, speed: 0, wheelState: [],
      position: body.translation(), rotation: body.rotation(), yaw, elapsed: 0, skidIntensity: 0 };
    this.vehicles.set(id, vehicle);
    this.colliderIds.set(collider.handle, id);
    return vehicle;
  }

  get(id) { return this.vehicles.get(id) || null; }
  setControls(id, input) { const v = this.get(id); if (v) v.controls = vehicleControls(input); }

  beforeStep(dt) {
    dt = clamp(finite(dt), 0, 1 / 30);
    if (!dt) return;
    for (const v of this.vehicles.values()) {
      const { body, controller: c, mass, controls: input, handling } = v;
      const q = body.rotation(), velocity = body.linvel();
      const yaw = vehicleYaw(q,v.yaw);
      const speed = velocity.x * Math.cos(yaw) - velocity.z * Math.sin(yaw);
      v.speed = speed;
      const targetSteer = input.steer * (.52 / (1 + Math.abs(speed) / 13));
      v.steering += clamp(targetSteer - v.steering, -1.8 * dt, 1.8 * dt);
      v.throttle += clamp(input.throttle - v.throttle, -4 * dt, 4 * dt);
      const reversingAgainstMotion = v.throttle * speed < -.7;
      const throttle = reversingAgainstMotion ? 0 : v.throttle;
      const brake = Math.max(input.brake, reversingAgainstMotion ? Math.abs(v.throttle) : 0);
      const topSpeed = throttle < 0 ? 9 : handling.maxSpeed;
      const powerCurve = clamp(1 - (Math.abs(speed) / topSpeed) ** 2, 0, 1);
      const burnout = input.brake > .7 && throttle > .65 && Math.abs(speed) < 6;
      for (let i = 0; i < 4; i++) {
        const front = v.wheels[i].x > 0;
        c.setWheelSteering(i, front ? v.steering : 0);
        // Rear-drive power; burnout holds the front brakes while the driven
        // rear tires exceed their reduced traction envelope.
        c.setWheelEngineForce(i, front ? 0 : throttle * mass * handling.acceleration * .5 * powerCurve);
        c.setWheelBrake(i, (burnout && !front ? 0 : brake * mass * 9 * dt / 4)
          + (input.handbrake && !front ? mass * 12 * dt / 2 : 0)
          + (Math.abs(throttle) < .03 ? mass * .18 * dt / 4 : 0));
        c.setWheelFrictionSlip(i, !front && (input.handbrake || burnout) ? .52 : 1.6);
        c.setWheelSideFrictionStiffness(i, !front && input.handbrake ? .38 : 1.1);
      }
      if (Math.abs(throttle) > .01 || brake || input.handbrake) body.wakeUp();
      // Exclude characters, own chassis and query-only triangle sensors. The
      // solver itself calculates load, traction and collision impulses.
      // Rapier holds mutable body borrows during updateVehicle: never call
      // collider.parent()/body accessors from its WASM query callback.
      c.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0x00020003,
        collider => (typeof collider === 'number' ? collider : collider.handle) !== v.collider.handle);
      const drag = Math.hypot(velocity.x, velocity.z);
      body.applyImpulse({ x: -velocity.x * drag * .38 * dt, y: 0, z: -velocity.z * drag * .38 * dt }, false);
      v.burnout = burnout;
      v.braking = brake;
      v.elapsed += dt;
    }
  }

  afterStep(dt) {
    dt = clamp(finite(dt), 0, 1 / 30);
    for (const v of this.vehicles.values()) {
      const c = v.controller, q = v.body.rotation(), velocity = v.body.linvel();
      v.position = v.body.translation(); v.rotation = q;
      v.yaw = vehicleYaw(q,v.yaw);
      v.speed = velocity.x * Math.cos(v.yaw) - velocity.z * Math.sin(v.yaw);
      v.skidIntensity = 0;
      v.wheelState = v.wheels.map((wheel, i) => {
        const contact = c.wheelIsInContact(i), point = c.wheelContactPoint(i), normal = c.wheelContactNormal(i);
        const front = wheel.x > 0, angle = v.yaw + (front ? v.steering : 0);
        const lateral = Math.abs(velocity.x * Math.sin(angle) + velocity.z * Math.cos(angle));
        const load = Math.max(1, finite(c.wheelSuspensionForce(i)) * dt);
        const saturation = Math.hypot(finite(c.wheelForwardImpulse(i)), finite(c.wheelSideImpulse(i))) / load;
        // A mark needs actual ground contact AND slip: no marks just because a
        // button is held on a stationary parked car or while airborne.
        const slip = !contact ? 0 : clamp(Math.max(lateral / 5,
          !front && v.burnout ? .85 : 0,
          !front && v.controls.handbrake && Math.abs(v.speed) > 1 ? .8 : 0,
          v.braking > .75 && Math.abs(v.speed) > 4 ? saturation * .9 : 0) - .12, 0, 1);
        const previous = v.wheelState[i];
        const spin = (previous?.spin || 0) + (v.burnout && !front ? 23 : v.speed / v.radius) * dt;
        v.skidIntensity = Math.max(v.skidIntensity, slip);
        return { contact, point: point && vec(point), normal: normal && vec(normal), slip, spin,
          steering: front ? v.steering : 0, suspensionLength: finite(c.wheelSuspensionLength(i), .24) };
      });
    }
  }

  remove(id) {
    const v = this.get(id); if (!v) return false;
    this.colliderIds.delete(v.collider.handle);
    this.world.removeVehicleController(v.controller);
    this.world.removeRigidBody(v.body);
    this.vehicles.delete(id);
    return true;
  }
  dispose() { for (const id of [...this.vehicles.keys()]) this.remove(id); }
}
