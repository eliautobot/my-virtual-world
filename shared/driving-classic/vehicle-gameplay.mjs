// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
export const RECOVERY_ROUTE=Symbol.for('vw.traffic.existingRecoveryRoute');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback = 0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
export const VEHICLE_CLEANUP_MS = Object.freeze({ inside: 60_000, outside: 300_000 });

export function vehicleControls(input = {}) {
  return {
    throttle: clamp(finite(input.throttle), -1, 1),
    steer: clamp(finite(input.steer), -1, 1),
    brake: clamp(finite(input.brake), 0, 1),
    handbrake: input.handbrake === true,
  };
}

/** Single logical occupant per driver seat; timer starts only after exit.
 * Pure state used by the authority and tested with a monotonic fake clock.
 */
export class VehicleUseLifecycle {
  constructor() { this.records = new Map(); this.drivers = new Map(); }
  add(id) {
    if (this.records.has(id)) return this.records.get(id);
    const record = { id, driver: null, lastUser: null, used: false, region: null, deadline: null, expired: false };
    this.records.set(id, record); return record;
  }
  enter(id, userId, now) {
    const r = this.records.get(id);
    if (!r || r.expired || !userId || r.driver || this.drivers.has(userId) || !Number.isFinite(now)) return false;
    r.driver = userId; r.lastUser = userId; r.used = true; r.deadline = null; r.region = null;
    this.drivers.set(userId, id); return true;
  }
  exit(id, userId, now, inside = false) {
    const r = this.records.get(id);
    if (!r || r.driver !== userId || !Number.isFinite(now)) return false;
    r.driver = null; this.drivers.delete(userId); r.region = inside ? 'inside' : 'outside';
    r.deadline = now + VEHICLE_CLEANUP_MS[r.region]; return true;
  }
  update(now, userInside = () => false) {
    if (!Number.isFinite(now)) return [];
    const expired = [];
    for (const r of this.records.values()) {
      if (!r.used || r.expired || r.driver || r.deadline === null) continue;
      const region = userInside(r.lastUser) ? 'inside' : 'outside';
      if (region !== r.region) { r.region = region; r.deadline = now + VEHICLE_CLEANUP_MS[region]; }
      if (now >= r.deadline) { r.expired = true; expired.push(r.id); }
    }
    return expired;
  }
  remove(id) { const r = this.records.get(id); if (r?.driver) this.drivers.delete(r.driver); return this.records.delete(id); }
}

/** Find the nearest *segment*, preserving forward lane direction on closed routes.
 * The returned target is ahead on that path, never a teleported car position.
 */
export function trafficRecoveryTarget(path, position, lookAhead = 3, preferredIndex = 1, retainForwardDirection = false) {
  if (!Array.isArray(path) || path.length < 2 || ![position?.x, position?.z].every(Number.isFinite)) return null;
  let best = null;
  // Ordinary pursuit must not snap across a corner to the adjacent opposing
  // lane. Geometric rejoin searches remain unrestricted by default; two-point
  // passing paths are also unchanged. This selects direction, not arrival.
  const reference=retainForwardDirection&&path.length>2&&Number.isInteger(preferredIndex)&&preferredIndex>0&&preferredIndex<path.length?{x:path[preferredIndex].x-path[preferredIndex-1].x,z:path[preferredIndex].z-path[preferredIndex-1].z}:null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i];
    if (![a?.x,a?.z,b?.x,b?.z].every(Number.isFinite)) continue;
    const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
    if(len2<1e-10)continue;
    if(reference&&dx*reference.x+dz*reference.z<0)continue;
    const t=clamp(((position.x-a.x)*dx+(position.z-a.z)*dz)/len2,0,1);
    const point={x:a.x+dx*t,z:a.z+dz*t},distance=Math.hypot(position.x-point.x,position.z-point.z);
    const continuity = Math.min(Math.abs(i-preferredIndex),Math.abs(i-preferredIndex+path.length-1),Math.abs(i-preferredIndex-path.length+1));
    const score=distance+Math.min(.15,continuity*.002);
    if(!best||score<best.score)best={point,distance,index:i,score,heading:Math.atan2(-dz,dx)};
  }
  if(!best)return null;
  let point={...best.point},index=best.index,remaining=clamp(lookAhead,.5,18),targetHeading=best.heading;
  for(let count=0;count<path.length+1&&remaining>0;count++){
    const end=path[index],dx=end.x-point.x,dz=end.z-point.z,len=Math.hypot(dx,dz);
    if(len>1e-10)targetHeading=Math.atan2(-dz,dx);
    if(len>remaining){point={x:point.x+dx/len*remaining,z:point.z+dz/len*remaining};remaining=0;}
    else{remaining-=len;point={...end};index=index+1>=path.length?1:index+1; if(index===1)point={...path[0]};}
  }
  return{point,projection:{...best.point},pathIdx:best.index,distance:best.distance,heading:best.heading,targetHeading};
}

/** Distance to the first meaningful upcoming corner, from a real projection.
 * This controls braking anticipation only; it never advances route progress. */
export function routeCornerAhead(path, projection, horizon=18) {
  if(!projection||!Array.isArray(path)||path.length<3)return null;
  let index=projection.pathIdx,point=projection.projection,total=0;
  for(let count=0;count<path.length&&total<=horizon;count++){
    const a=path[index-1],end=path[index],next=path[index+1<path.length?index+1:1];
    if(!a||!end||!next)return null;
    total+=Math.hypot(end.x-point.x,end.z-point.z);
    if(total>horizon)return null;
    const incoming=Math.atan2(end.z-a.z,end.x-a.x),outgoing=Math.atan2(next.z-end.z,next.x-end.x);
    const turn=Math.abs(angle(outgoing-incoming));
    if(Math.hypot(next.x-end.x,next.z-end.z)>1e-8&&turn>.12)return{distance:total,angle:turn};
    index=index+1>=path.length?1:index+1;point=path[index-1];
  }
  return null;
}

export function trafficDrivingControls(vehicle, path, { stop = false, cruiseSpeed = 7, blockedSeconds = 0 } = {}) {
  const speed = Number.isFinite(vehicle?.speed) ? vehicle.speed : 0;
  const target=trafficRecoveryTarget(path,vehicle?.position,2.8+Math.abs(speed)*.6,vehicle?.pathIdx||1,true);
  if(!target)return{throttle:0,brake:1,steer:0,handbrake:false,recovering:true,pathIdx:1};
  const dx=target.point.x-vehicle.position.x,dz=target.point.z-vehicle.position.z;
  const error=angle(Math.atan2(-dz,dx)-(vehicle.yaw||0));
  const recovering=target.distance>1.1 || Math.abs(angle(target.heading-(vehicle.yaw||0)))>.65;
  // Pure pursuit plus bounded three-point recovery if struck into a wall.
  // Reverse is slow and time-bounded; actual obstacle clearance must be checked by caller.
  const reverse=false; // Corrective reverse is admitted only by TrafficCorrective exact sweeps.
  // Track the front bumper with one steering-actuator response of preview.
  // This changes only requested controls, not chassis geometry or physics.
  let requiredSteering=0,cornerSpeed=Infinity,steer=clamp(error*(reverse?-1.6:1.6),-1,1);
  // Keep the proven straight passing/queue-relief controller unchanged.
  // Front-preview tracking is only for multi-segment road navigation.
  if(path.length>2&&Number.isFinite(vehicle.halfLength)&&vehicle.halfLength>0&&vehicle.wheels?.length===4&&vehicle.wheels.every(w=>Number.isFinite(w.x))){
    const offset=vehicle.halfLength+Math.min(2,Math.abs(speed)*0.3),yaw=vehicle.yaw||0,front={x:vehicle.position.x+offset*Math.cos(yaw),z:vehicle.position.z-offset*Math.sin(yaw)};
    const reference=trafficRecoveryTarget(path,front,.5,target.pathIdx,true);
    const corner=routeCornerAhead(path,reference,Math.max(18,speed*speed/5+Math.abs(speed)*.5+5));
    // Start braking while still aligned, rather than after the bumper has
    // reached the bend. 2.5m/s² is below the unchanged 9m/s² brake budget.
    if(corner)cornerSpeed=Math.sqrt(1.6**2+5*Math.max(0,corner.distance-Math.abs(speed)*.35-1));
    // The lookahead can be on the NEXT segment. Pair its position with that
    // segment's tangent; the nearest old tangent drives straight past corners.
    if(reference){const tangent=reference.targetHeading,heading=angle(tangent-yaw),cross=(front.x-reference.point.x)*Math.sin(tangent)+(front.z-reference.point.z)*Math.cos(tangent),delta=heading+Math.atan2(cross,1+Math.abs(speed));requiredSteering=Math.abs(delta);steer=clamp(delta*(1+Math.abs(speed)/13)/.52,-1,1);}
  }
  let forwardSpeed=recovering?Math.max(1.6,Math.min(cruiseSpeed,3.5)/(1+Math.abs(error)*1.25)):cruiseSpeed/(1+Math.abs(error)*2);
  // Match the existing speed-dependent steering envelope; do not demand a
  // high-speed corner that the unchanged steering actuator cannot deliver.
  if(requiredSteering>1e-6)forwardSpeed=Math.min(forwardSpeed,Math.max(1.6,13*(.52/requiredSteering-1)));
  if(path.length>2){
    forwardSpeed=Math.min(forwardSpeed,cornerSpeed);
    // Do not accelerate/squat a rear overhang toward a curb before the body
    // is back on its lane after the turn. Passing's two-point path is unchanged.
    if(target.distance>.25||Math.abs(angle(target.heading-(vehicle.yaw||0)))>.15)forwardSpeed=Math.min(forwardSpeed,1.6);
  }
  const wanted=stop?0:reverse?-2:forwardSpeed;
  let brake=stop?clamp(Math.abs(speed)*.3+.12,0,1):speed>wanted+.5&&!reverse?clamp((speed-wanted)/4,0,1):0;
  if(!stop&&path.length>2&&speed>wanted+.05)brake=Math.max(brake,clamp(.28+(speed-wanted)*.4,0,1));
  const throttle=brake?0:clamp((wanted-speed)/3,-.55,1);
  return{throttle,brake,steer,handbrake:false,recovering,pathIdx:target.pathIdx,laneDistance:target.distance,[RECOVERY_ROUTE]:path};
}

export class RagdollRecoveryClock {
  constructor() { this.stillSeconds=0; this.ready=false; }
  update(dt, { linearSpeed, angularSpeed, grounded, hit = false } = {}) {
    const valid=[dt,linearSpeed,angularSpeed].every(Number.isFinite);
    const still=valid&&!hit&&grounded&&linearSpeed<.12&&angularSpeed<.22;
    this.stillSeconds=still?this.stillSeconds+clamp(dt,0,1/30):0;
    this.ready=this.stillSeconds>=1-1e-9;
    return this.ready;
  }
  reset() { this.stillSeconds=0; this.ready=false; }
}
