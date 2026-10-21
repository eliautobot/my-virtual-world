// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A driver's own car, simulated where the driver is (decision A20) with the same Rapier vehicle code and static
// collision world as the server. The caller supplies RAPIER and VehicleDynamics, the world data and nearby obstacles.
import {buildVehicleStatics,bodyOffset} from './vehicle-world.js';
import {TerrainColliders} from './terrain-physics.js';
import {applyWater} from './vehicle-water.js';
import {PHYSICS_GROUPS} from './driving-classic/physics-collision-groups.mjs';
import {setBoost,boostBefore,boostAfter} from './vehicle-boost.js';
export const LOCAL_STEP=1/60;
const ID={x:0,y:0,z:0,w:1};
const cross=(w,o)=>({x:w.y*o.z-w.z*o.y,y:w.z*o.x-w.x*o.z,z:w.x*o.y-w.y*o.x});
const angle=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};

export class LocalVehicleSim{
 constructor({RAPIER,VehicleDynamics,world,rig=null,id=null,island=null}){
  Object.assign(this,{R:RAPIER,rig,id:id==null?null:String(id),acc:0,steps:0,prev:null,cur:null,obstacles:new Map()});
  this.physics=new RAPIER.World({x:0,y:-9.81,z:0});this.physics.timestep=LOCAL_STEP;
  this.statics=buildVehicleStatics(RAPIER,this.physics,world);
  // On an island the ground beyond the city comes from the terrain, kept around the car (WP4.3).
  if(island){const g=this.statics.g;this.island=island;this.terrain=new TerrainColliders(RAPIER,this.physics,island,{cityRect:g.empty?null:{x0:g.minX,z0:g.minZ,x1:g.maxX,z1:g.maxZ}});}
  this.dynamics=new VehicleDynamics(this.physics);
 }
 /** Put the car exactly in an authoritative state (render root pose, root velocity, angular velocity, steering). */
 place(s,rig=this.rig,id=this.id){
  if(this.terrain)this.terrain.update([{x:s.x,z:s.z}]);
  if(this.id&&this.dynamics.get(this.id))this.dynamics.remove(this.id);
  this.rig=rig;this.id=String(id);
  const r=this.rig,o=bodyOffset(s.rotation,r.rootLift),w=s.angular||{x:0,y:0,z:0},spin=cross(w,o);
  const v=this.dynamics.add(this.id,{type:r.type,position:{x:s.x+o.x,y:s.y+o.y,z:s.z+o.z},rotationY:s.yaw,halfLength:r.halfLength,halfWidth:r.halfWidth,wheelRadius:r.wheelRadius,wheels:r.wheels,hullVertices:new Float32Array(r.hull),
   velocity:{x:(s.vx||0)+spin.x,y:(s.vy||0)+spin.y,z:(s.vz||0)+spin.z}});
  const wheels=(s.wheels||[]).map(x=>({...x,point:x.point&&{...x.point},normal:x.normal&&{...x.normal}}));
  v.body.setRotation(s.rotation,true);v.body.setAngvel(w,true);v.steering=s.steering||0;v.position=v.body.translation();v.rotation=v.body.rotation();v.wheelState=wheels;
  this.acc=0;this.cur={...s,rotation:{...s.rotation},angular:{...w},steering:s.steering||0,wheels};this.prev=this.cur;
 }
 /** Advance real time with fixed steps. `sync` updates obstacles before each step. Returns the number of steps. */
 advance(dt,input,sync=null){
  if(this.terrain&&this.cur)this.terrain.update([{x:this.cur.x,z:this.cur.z}]);
  this.acc+=Math.max(0,Math.min(dt,.25));let n=0;
  while(this.acc>=LOCAL_STEP&&n<8){sync?.(this);this.dynamics.setControls(this.id,input);setBoost(this.dynamics,this.id,input?.boost===true);if(this.island)applyWater(this.dynamics,this.island,LOCAL_STEP);boostBefore(this.dynamics,LOCAL_STEP);this.dynamics.beforeStep(LOCAL_STEP);boostAfter(this.dynamics,LOCAL_STEP);this.physics.step();this.dynamics.afterStep(LOCAL_STEP);
   this.acc-=LOCAL_STEP;n++;this.steps++;this.prev=this.cur;this.cur=this.snapshot();}
  if(this.acc>=LOCAL_STEP)this.acc=0;// a long stall drops time instead of fast-forwarding the car
  return n;
 }
 snapshot(){
  const v=this.dynamics.get(this.id),r=this.rig,p=v.position,q=v.rotation,vel=v.body.linvel(),w=v.body.angvel(),o=bodyOffset(q,r.rootLift),spin=cross(w,o);
  return{x:p.x-o.x,y:p.y-o.y,z:p.z-o.z,rotation:{x:q.x,y:q.y,z:q.z,w:q.w},yaw:v.yaw,v:v.speed,vx:vel.x-spin.x,vy:vel.y-spin.y,vz:vel.z-spin.z,angular:{x:w.x,y:w.y,z:w.z},steering:v.steering,
   wheels:(v.wheelState||[]).map(x=>({...x,point:x.point&&{...x.point},normal:x.normal&&{...x.normal}}))};
 }
 /** Write the pose between the last two steps (by the unstepped remainder) into a draw object. */
 draw(out){
  const a=this.prev,b=this.cur,u=Math.min(1,this.acc/LOCAL_STEP),l=(x,y)=>x+(y-x)*u;
  out.x=l(a.x,b.x);out.y=l(a.y,b.y);out.z=l(a.z,b.z);out.yaw=a.yaw+angle(a.yaw,b.yaw)*u;
  let qa=a.rotation,qb=b.rotation;const dot=qa.x*qb.x+qa.y*qb.y+qa.z*qb.z+qa.w*qb.w,sg=dot<0?-1:1;
  const q={x:l(qa.x,sg*qb.x),y:l(qa.y,sg*qb.y),z:l(qa.z,sg*qb.z),w:l(qa.w,sg*qb.w)},n=Math.hypot(q.x,q.y,q.z,q.w)||1;
  out.rotation??={};Object.assign(out.rotation,{x:q.x/n,y:q.y/n,z:q.z/n,w:q.w/n});
  Object.assign(out,{v:b.v,vx:b.vx,vy:b.vy,vz:b.vz,steering:l(a.steering,b.steering)});
  out.wheels??=[];for(let i=0;i<b.wheels.length;i++){const wa=a.wheels[i]||b.wheels[i],wb=b.wheels[i],w=out.wheels[i]??={};
   Object.assign(w,{spin:l(wa.spin,wb.spin),suspensionLength:l(wa.suspensionLength,wb.suspensionLength),contact:wb.contact,slip:wb.slip,
    point:wb.point&&{x:l((wa.point||wb.point).x,wb.point.x),y:l((wa.point||wb.point).y,wb.point.y),z:l((wa.point||wb.point).z,wb.point.z)},normal:wb.normal&&{...wb.normal}});}
  return out;
 }
 /** Nearby cars ({key,kind:'car',x,y,z,rotation,hl,hh,hw}) and people ({key,kind:'person',x,y,z}) as moving obstacles. */
 setObstacles(list){
  const seen=new Set();
  for(const o of list){seen.add(o.key);const e=this.obstacles.get(o.key),rot=o.rotation||ID,pos={x:o.x,y:o.kind==='person'?o.y+.7:o.y,z:o.z};
   if(!e){const body=this.physics.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x,pos.y,pos.z).setRotation(rot));
    this.physics.createCollider(o.kind==='person'?this.R.ColliderDesc.capsule(.35,.25).setCollisionGroups(PHYSICS_GROUPS.pedestrian):this.R.ColliderDesc.cuboid(o.hl,o.hh,o.hw).setFriction(.35).setCollisionGroups(PHYSICS_GROUPS.vehicle),body);
    this.obstacles.set(o.key,{body});}
   else{e.body.setNextKinematicTranslation(pos);e.body.setNextKinematicRotation(rot);}
  }
  for(const [k,e]of this.obstacles)if(!seen.has(k)){this.physics.removeRigidBody(e.body);this.obstacles.delete(k);}
 }
 /** Take the car out and forget obstacles, keeping the world for the next drive. */
 clearCar(){if(this.id&&this.dynamics.get(this.id))this.dynamics.remove(this.id);this.setObstacles([]);this.id=null;this.rig=null;this.prev=this.cur=null;this.acc=0;}
 rebuildStatics(world){for(const b of this.statics.bodies)this.physics.removeRigidBody(b);this.statics=buildVehicleStatics(this.R,this.physics,world);}
 dispose(){this.dynamics.dispose();this.physics.free();}
}
