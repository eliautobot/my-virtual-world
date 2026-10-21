// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Driving: original classic Rapier handling, authenticated seats, safe exits and shared fleet poses. A driver's browser may
// simulate its own car (decision A20); the server then validates and relays its poses and takes the car back if they stop.
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import {VehicleDynamics,vehicleControls,VEHICLE_HANDLING} from '../../shared/driving-classic/vehicle-dynamics.mjs';
import {setBoost,boostBefore,boostAfter} from '../../shared/vehicle-boost.js';   // Shift: boost and burnout
import {VehicleUseLifecycle,VEHICLE_CLEANUP_MS} from '../../shared/driving-classic/vehicle-gameplay.mjs';
import {findVehicleExit,isVehicleExitClear} from '../../shared/driving-classic/vehicle-exit-safety.mjs';
import {PHYSICS_GROUPS} from '../../shared/driving-classic/physics-collision-groups.mjs';
import {VehicleTraffic} from '../../shared/vehicle-traffic.js';
import {VEHICLE_KINDS,VEHICLE_ENTRY_SPEED,VEHICLE_ENTRY_RANGE,VEHICLE_EXIT_SPEED,VEHICLE_INPUT_TTL,VEHICLE_DISCONNECT_GRACE,vehicleEnvelopeDistance} from '../../shared/vehicle-specs.js';
import {encodeVehicles} from '../../shared/vehicleproto.js';
import {blockAt} from '../../shared/city.js';
import {buildVehicleStatics,bodyOffset,packPose,unpackPose} from '../../shared/vehicle-world.js';
import {TerrainColliders} from '../../shared/terrain-physics.js';
import {applyWater,waterDepth,POSE_MAX_DEPTH} from '../../shared/vehicle-water.js';
import {Island} from '../../shared/terrain.js';
import {buildingPads} from '../../shared/island-build.js';
import {PF_OBSERVING,PF_USING,PF_DRIVING} from '../../shared/playerproto.js';
const RIGS=JSON.parse(fs.readFileSync(new URL('../../shared/vehicle-rigs.json',import.meta.url),'utf8')).rigs;
const BRAKE={throttle:0,steer:0,brake:1,handbrake:false};
const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
// A car left standing on a street or crossing is cleared much sooner than one parked on a block or sidewalk.
export const ROAD_CLEANUP_MS=60_000;
// Browser-simulated cars: poses must keep arriving (else the server brakes the car itself) and at a bounded rate. The wait
// covers a phone's stall or a mobile network's burst delay: at 0.5 s those handed the car to the server, which braked it
// to a stop before the browser took it back (2026-10-04: "the car looks stopped completely and then lags a lot").
export const POSE_TTL=2000,POSE_RATE=90;
export async function createVehicles(options){
  // The compat package emits one upstream wasm-init deprecation (its own init calls wasm-bindgen the old way; nothing an
  // operator can act on). Keep it visible as an information line of the application's structured/redacted logger, so a
  // start has no warnings; never silence other warnings.
  const original=console.warn,warnings=[];
  console.warn=(...args)=>{if(args[0]==='using deprecated parameters for the initialization function; pass a single object instead')warnings.push(args);else original(...args);};
  try{await RAPIER.init();}finally{console.warn=original;for(const args of warnings){if(options.log?.info)options.log.info('[physics] (the physics library says, harmlessly)',...args);else original(...args);}}
  return new Vehicles(options);
}
export class Vehicles {
 constructor({world,worldId,players,store,perms,clock,actors=()=>[],now=()=>Date.now(),log=null}){
  Object.assign(this,{world,worldId,players,store,perms,clock,actors,now,log});this.physics=new RAPIER.World({x:0,y:-9.81,z:0});this.dynamics=new VehicleDynamics(this.physics);
  const saved=store.load('vehicles');this.traffic=new VehicleTraffic(world,{seed:`${worldId}:traffic`,nextId:saved?.worldId===worldId?Math.max(saved.nextId||1,...(Array.isArray(saved.cars)?saved.cars.slice(0,128):[]).filter(c=>Number.isSafeInteger(c.id)).map(c=>c.id+1)):1});this.all=this.traffic.all;this.trafficRoads=world.roads;
  this.lifecycle=new VehicleUseLifecycle();this.owners=new Map();this.staticBodies=[];this.kinematic=new Map();this.pedestrians=new Map();this.tickN=0;this.at=now();this.dirty=false;
  this.stats={ticks:0,physicsMs:0,frames:0,bytes:0,entries:0,exits:0,refused:0};this.buildStatic();
  if(saved?.worldId===worldId&&Array.isArray(saved.cars))for(const c of saved.cars.slice(0,128))if(this.validSaved(c)){if(c.starter&&!c.used){this.dirty=true;continue;}delete c.starter;if(c.used&&!c.deadline)c.deadline=this.at+VEHICLE_CLEANUP_MS.outside;c.mode=2;c.driver=0;c.v=0;c.owner=null;this.all.set(c.id,c);const life=this.lifecycle.add(c.id);Object.assign(life,{used:!!c.used,lastUser:c.lastUser||null,deadline:c.deadline||null,region:c.region||'outside'});this.addKinematic(c);}
  this.traffic.fill(this.clock().hour);for(const c of this.all.values())if(c.mode===0){this.traffic.pose(c);this.addKinematic(c);}
 }
 validSaved(c){return c&&Number.isInteger(c.id)&&c.id>0&&Number.isInteger(c.k)&&RIGS[c.k]&&[c.x,c.y,c.z,c.yaw].every(finite)&&Math.abs(c.x)<10000&&Math.abs(c.z)<10000;}
 rig(c){return RIGS[c.k];}
 body(c){return this.dynamics.get(String(c.id));}
 buildStatic(){for(const b of this.staticBodies)this.physics.removeRigidBody(b);const st=buildVehicleStatics(RAPIER,this.physics,this.world);this.staticBodies=st.bodies;this.solid=st.solid;this.g=st.g;
  // On an island (WP4.3) server-simulated cars get the terrain's ground (roads graded in) around them.
  const pads=buildingPads(this.world),padsKey=JSON.stringify(pads);
  if(this.terrain&&(this.terrainFor!==this.world.terrain||this.roadsFor!==this.world.roads||this.padsKey!==padsKey)){this.terrain.clear();this.terrain=null;}
  if(this.world.terrain&&!this.terrain){const g=st.g;this.terrain=new TerrainColliders(RAPIER,this.physics,new Island(this.world.terrain,{roads:this.world.roads||null,pads}),{cityRect:g.empty?null:{x0:g.minX,z0:g.minZ,x1:g.maxX,z1:g.maxZ}});this.terrainFor=this.world.terrain;this.roadsFor=this.world.roads;this.padsKey=padsKey;}}
 addKinematic(c){if(this.kinematic.has(c.id)||this.body(c))return;const r=this.rig(c),body=this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x,(c.y||0)+r.height/2+.18,c.z).setRotation({x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)}));const collider=this.physics.createCollider(RAPIER.ColliderDesc.cuboid(r.halfLength,r.height/2,r.halfWidth).setFriction(.35).setCollisionGroups(PHYSICS_GROUPS.vehicle),body);this.kinematic.set(c.id,{body,collider});}
 removeKinematic(c){const p=this.kinematic.get(c.id);if(p){this.physics.removeRigidBody(p.body);this.kinematic.delete(c.id);}}
 attach(ws){this.stream(ws);const p=this.players.byId.get(ws.pid);if(!p)return;
  const owned=[...this.all.values()].find(c=>c.driver===p.id);if(owned&&owned.owner?.readyState!==1){owned.owner=ws;this.owners.set(ws,owned);owned.inputAt=0;owned.seq=0;this.sendDrive(ws,owned,'resumed');}
  else {
    if(!p.vehicleId){const overlap=[...this.all.values()].find(c=>Math.abs(p.y-(c.y||0))<1.6&&vehicleEnvelopeDistance(p,c,this.rig(c))<.26);if(overlap){const point=this.safeExit(overlap,p.id);if(point){Object.assign(p,point);p.ver++;p.dirty=true;this.players.toAccount(p.id,{t:'pmoved',...point,ctx:-1,yaw:p.yaw,text:'Restored beside your vehicle'});}}}
    this.sendDrive(ws,null,'none',{x:p.x,y:p.y,z:p.z});
  }
 }
 detach(ws){const c=this.owners.get(ws);if(c){c.owner=null;c.disconnectedAt=this.now();c.inputAt=0;this.dynamics.setControls(String(c.id),BRAKE);this.owners.delete(ws);}}
 reply(ws,m,ok,why,extra={}){this.players.send(ws,{t:'drive_result',req:m.req,ok,why,...extra});if(!ok)this.stats.refused++;}
 command(ws,m){
  if(!Number.isSafeInteger(m.req)||m.req<1||m.req>1e9)return;
  ws.vehicleCommands??=new Map();if(ws.vehicleCommands.has(m.req)){this.players.send(ws,ws.vehicleCommands.get(m.req));return;}
  const now=this.now();ws.vehicleCommandTimes=(ws.vehicleCommandTimes||[]).filter(t=>now-t<1000);if(ws.vehicleCommandTimes.length>=6)return this.reply(ws,m,false,'Too many vehicle actions; wait a moment');ws.vehicleCommandTimes.push(now);
  const before=this.owners.get(ws),capture=this.players.send;let response;this.players.send=(conn,obj)=>{if(conn===ws&&obj.t==='drive_result')response=obj;capture.call(this.players,conn,obj);};
  try{if(m.op==='enter')this.enter(ws,m);else if(m.op==='exit')this.exit(ws,m);else this.reply(ws,m,false,'Unknown vehicle action');}
  catch(e){this.log?.warn('[vehicles] command',m.op,e.message);const owned=this.owners.get(ws),p=this.players.byId.get(ws.pid);
    if(m.op==='enter'&&owned?.id===m.id){this.reply(ws,m,true,'Driving',{id:owned.id});this.sendDrive(ws,owned,'entered');}
    else if(m.op==='exit'&&before&&!owned&&!before.driver&&p&&!p.vehicleId)this.reply(ws,m,true,'Exited',{point:{x:p.x,y:p.y,z:p.z}});
    else this.reply(ws,m,false,'Vehicle action was not applied; the current seat is unchanged');}
  finally{this.players.send=capture;if(response){ws.vehicleCommands.set(m.req,response);while(ws.vehicleCommands.size>32)ws.vehicleCommands.delete(ws.vehicleCommands.keys().next().value);}}
 }
 enter(ws,m){
  const p=this.players.byId.get(ws.pid),c=this.all.get(m.id);
  if(!p||!this.players.canPlay(ws)||p.ctx!==-1||(p.flags&(PF_OBSERVING|PF_USING)))return this.reply(ws,m,false,'Enter Play mode outside before driving');
  if(!c||c.driver||[...this.all.values()].some(v=>v.driver===p.id))return this.reply(ws,m,false,'That driver seat is occupied');
  this.traffic.pose(c);const r=this.rig(c);
  if(Math.abs((c.v||0)*(c.mode===0?this.clock().rate:1))>VEHICLE_ENTRY_SPEED||vehicleEnvelopeDistance(p,c,r)>=VEHICLE_ENTRY_RANGE||Math.abs(p.y-(c.y||0))>1.6)return this.reply(ws,m,false,'Move beside a stopped vehicle');
  const existing=this.body(c);
  if(!existing&&this.dynamics.vehicles.size>=32)return this.reply(ws,m,false,'The driving simulation is full; try another time');
  this.traffic.detach(c);this.removeKinematic(c);
  const v=existing||this.dynamics.add(String(c.id),{type:r.type,position:{x:c.x,y:(c.y||0)+r.rootLift,z:c.z},rotationY:c.yaw,halfLength:r.halfLength,halfWidth:r.halfWidth,wheelRadius:r.wheelRadius,wheels:r.wheels,hullVertices:new Float32Array(r.hull),velocity:{x:Math.cos(c.yaw)*(c.v||0),y:0,z:-Math.sin(c.yaw)*(c.v||0)}});
  c.mode=1;c.physics='server';c.driver=p.id;c.owner=ws;c.inputAt=0;c.seq=0;c.deadline=null;c.disconnectedAt=0;this.owners.set(ws,c);this.dynamics.setControls(v.id,BRAKE);
  p.vehicleId=c.id;p.flags=(p.flags|PF_DRIVING)&~PF_USING;p.clip=0;p.ver++;p.dirty=true;
  this.lifecycle.add(c.id);this.lifecycle.enter(c.id,p.id,this.now());
  this.stats.entries++;this.dirty=true;this.reply(ws,m,true,'Driving',{id:c.id});this.sendDrive(ws,c,'entered');this.stream(ws);
 }
 sendDrive(ws,c,status,point=null){ws.driveVersion=(ws.driveVersion||0)+1;this.players.send(ws,{t:'drive_state',version:ws.driveVersion,id:c?.id||null,status,kind:c?VEHICLE_KINDS[c.k].n:null,point});}
 controls(ws,m){const c=this.owners.get(ws);if(!c||c.owner!==ws||c.driver!==ws.pid||c.physics==='client'||!this.players.canPlay(ws))return;
  if(!Number.isInteger(m.seq)||m.seq<0||m.seq>65535)return;const gap=(m.seq-(c.seq||0))&65535;if(!gap||gap>=32768)return;
  const now=this.now();c.inputTimes=(c.inputTimes||[]).filter(t=>now-t<1000);if(c.inputTimes.length>=90)return;c.inputTimes.push(now);c.seq=m.seq;c.inputAt=now;this.dynamics.setControls(String(c.id),vehicleControls(m));setBoost(this.dynamics,String(c.id),m.boost===true);
 }
 physicsMode(ws,m){const c=this.owners.get(ws);if(!c||c.owner!==ws||c.driver!==ws.pid||m.id!==c.id||!this.players.canPlay(ws))return;
  if(m.mode==='client'){if(c.physics!=='client')this.toClient(c);this.players.send(ws,{t:'vphysics',id:c.id,mode:'client',state:packPose(c)});}
  else if(m.mode==='server')this.toServer(c,'requested');
 }
 toClient(c){const v=this.body(c);if(v){this.updatePose(c,v);c.angular={...v.body.angvel()};this.dynamics.remove(String(c.id));}
  c.physics='client';c.poseAt=this.at;c.inputAt=this.now();c.poseSeq=null;c.violations=[];c.accepted=0;this.addKinematic(c);
 }
 toServer(c,why){if(c.physics!=='client')return;this.removeKinematic(c);c.physics='server';
  const r=this.rig(c),q=c.rotation||{x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)},o=bodyOffset(q,r.rootLift),w=c.angular||{x:0,y:0,z:0};
  const v=this.dynamics.add(String(c.id),{type:r.type,position:{x:c.x+o.x,y:(c.y||0)+o.y,z:c.z+o.z},rotationY:c.yaw,halfLength:r.halfLength,halfWidth:r.halfWidth,wheelRadius:r.wheelRadius,wheels:r.wheels,hullVertices:new Float32Array(r.hull),
   velocity:{x:(c.vx||0)+w.y*o.z-w.z*o.y,y:(c.vy||0)+w.z*o.x-w.x*o.z,z:(c.vz||0)+w.x*o.y-w.y*o.x}});
  v.body.setRotation(q,true);v.body.setAngvel(w,true);v.steering=c.steering||0;v.position=v.body.translation();v.rotation=v.body.rotation();v.wheelState=c.wheels||[];
  this.dynamics.setControls(v.id,BRAKE);c.inputAt=0;
  if(c.owner)this.players.send(c.owner,{t:'vphysics',id:c.id,mode:'server',why});
 }
 /** A pose from the driver's browser: applied when plausible, otherwise answered with the last accepted state. */
 pose(ws,m){const c=this.owners.get(ws);if(!c||c.owner!==ws||c.driver!==ws.pid||c.physics!=='client'||!this.players.canPlay(ws))return;
  if(!Number.isInteger(m.s)||m.s<0||m.s>65535)return;if(c.poseSeq!=null){const gap=(m.s-c.poseSeq)&65535;if(!gap||gap>=32768)return;}
  const now=this.now();c.poseTimes=(c.poseTimes||[]).filter(t=>now-t<1000);if(c.poseTimes.length>=POSE_RATE)return;c.poseTimes.push(now);c.poseSeq=m.s;
  const s=unpackPose(m),why=s?this.poseProblem(c,s,m.ts,now):'malformed';
  if(why){c.violations=(c.violations||[]).filter(t=>now-t<2000);c.violations.push(now);this.stats.poseRejects=(this.stats.poseRejects||0)+1;
   if(c.violations.length>=5)return this.toServer(c,'invalid');
   return this.players.send(ws,{t:'vcorrect',id:c.id,why,state:packPose(c)});}
  Object.assign(c,s);c.poseAt=Math.max(m.ts,c.poseAt-1000);c.inputAt=now;c.accepted++;this.syncDriver(c);
 }
 poseProblem(c,s,ts,now){
  if(!Number.isFinite(ts)||ts<=(c.accepted?c.poseAt:c.poseAt-1000)||ts>now+250)return 'time';
  const dt=Math.max((ts-c.poseAt)/1000,1/120),top=(VEHICLE_HANDLING[this.rig(c).type]||VEHICLE_HANDLING.car).maxSpeed*1.25+4;
  if(Math.abs(s.v)>top||Math.hypot(s.vx,s.vy,s.vz)>top)return 'speed';
  if(Math.hypot(s.x-c.x,s.y-(c.y||0),s.z-c.z)>top*dt+.75)return 'distance';
  const g=this.g,T=this.world.terrain;
  if(T){const r=T.radius*1.35;if(Math.abs(s.x-T.center.x)>r||Math.abs(s.z-T.center.z)>r)return 'bounds';const gy=this.players.groundY(s.x,s.z,-1);if(s.y<gy-2.5||s.y>gy+60)return 'bounds';if(this.terrain&&waterDepth(this.terrain.island,s.x,s.z)>POSE_MAX_DEPTH)return 'water';}
  else if(s.x<g.minX-34||s.x>g.maxX+34||s.z<g.minZ-34||s.z>g.maxZ+34||s.y<-3||s.y>40)return 'bounds';
  const r=this.rig(c),o=bodyOffset(s.rotation,r.rootLift),shape=new RAPIER.Cuboid(r.halfLength*.7,.22,r.halfWidth*.65);
  if(this.physics.intersectionWithShape({x:s.x+o.x,y:s.y+o.y+.05,z:s.z+o.z},s.rotation,shape,undefined,undefined,undefined,undefined,col=>this.solid.has(col.handle)))return 'collision';
  return null;
 }
 safeExit(c,pid=c.driver){const p=this.players.byId.get(pid),own=this.pedestrians.get(`p:${pid}`),v=this.body(c);if(v)this.updatePose(c,v);
  return findVehicleExit({type:this.rig(c).type,position:{x:c.x,y:c.y||0,z:c.z},yaw:c.yaw},(x,z)=>this.players.groundY(x,z,-1),point=>this.players.nav.ok(point.x,point.z,-1)&&isVehicleExitClear(this.physics,point,{ignoreHandles:[own?.collider.handle]}));
 }
 exit(ws,m,force=false){const c=this.owners.get(ws)||[...this.all.values()].find(v=>v.driver===ws.pid);
  if(!c||(!force&&c.owner!==ws))return this.reply(ws,m,false,'You are not the confirmed driver');
  const v=this.body(c);if(!force&&Math.abs(v?.speed??c.v)>VEHICLE_EXIT_SPEED)return this.reply(ws,m,false,'Stop the vehicle before exiting');
  this.toServer(c,'exit');const point=this.safeExit(c);if(!point)return this.reply(ws,m,false,'No clear exit beside the vehicle; move to an open area');
  this.release(c,point);this.reply(ws,m,true,'Exited',{point});this.sendDrive(ws,null,'exited',point);this.stream(ws);
 }
 release(c,point){const p=this.players.byId.get(c.driver);if(c.owner)this.owners.delete(c.owner);c.driver=0;c.owner=null;c.mode=2;c.used=true;c.deadline=this.now()+300000;c.inputAt=0;
  if(p){this.lifecycle.exit(c.id,p.id,this.now(),p.ctx>=0);c.deadline=this.lifecycle.records.get(c.id)?.deadline||c.deadline;}this.dynamics.setControls(String(c.id),BRAKE);
  if(p){p.vehicleId=null;p.x=point.x;p.y=point.y;p.z=point.z;p.ctx=-1;p.flags&=~PF_DRIVING;p.clip=0;p.ver++;p.dirty=true;p.lastAt=this.now();this.players.toAccount(p.id,{t:'pmoved',...point,ctx:-1,yaw:p.yaw,text:'Exited vehicle'});}
  this.stats.exits++;this.dirty=true;
 }
 // Physics advances in whole 1/60s steps but frames are stamped with the tick time, so a body's sent pose is carried
 // forward by the unstepped remainder; otherwise pose and timestamp disagree by up to one step and driving judders.
 present(c){const client=c.physics==='client',v=!client&&this.body(c),lead=client?Math.max(0,Math.min(.1,(this.at-(c.poseAt??this.at))/1000)):v?this.lead||0:0;if(!(lead>0))return c;let out=this.presented?.get(c.id);if(out)return out;
  const w=client?c.angular||{x:0,y:0,z:0}:v.body.angvel(),rate=Math.hypot(w.x,w.y,w.z),q=c.rotation||{x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)};let rotation=q;
  if(rate*lead>1e-9){const s=Math.sin(rate*lead/2)/rate,dx=w.x*s,dy=w.y*s,dz=w.z*s,dw=Math.cos(rate*lead/2);
   rotation={x:dw*q.x+dx*q.w+dy*q.z-dz*q.y,y:dw*q.y-dx*q.z+dy*q.w+dz*q.x,z:dw*q.z+dx*q.y-dy*q.x+dz*q.w,w:dw*q.w-dx*q.x-dy*q.y-dz*q.z};}
  const vx=c.vx||0,vy=c.vy||0,vz=c.vz||0,turn=(c.v||0)/this.rig(c).wheelRadius*lead;
  out={...c,x:c.x+vx*lead,y:(c.y||0)+vy*lead,z:c.z+vz*lead,yaw:c.yaw+w.y*lead,rotation,
   wheels:c.wheels?.map(x=>({...x,spin:(x.spin||0)+turn,point:x.point&&{x:x.point.x+vx*lead,y:x.point.y+vy*lead,z:x.point.z+vz*lead}}))};
  this.presented?.set(c.id,out);return out;
 }
 updatePose(c,v){const r=this.rig(c),p=v.position,q=v.rotation,vel=v.body.linvel(),angular=v.body.angvel();
  const ox=2*(q.x*q.y-q.w*q.z)*r.rootLift,oy=(1-2*(q.x*q.x+q.z*q.z))*r.rootLift,oz=2*(q.y*q.z+q.w*q.x)*r.rootLift;
  Object.assign(c,{x:p.x-ox,y:p.y-oy,z:p.z-oz,yaw:v.yaw,rotation:{...q},v:v.speed,
    vx:vel.x-(angular.y*oz-angular.z*oy),vy:vel.y-(angular.z*ox-angular.x*oz),vz:vel.z-(angular.x*oy-angular.y*ox),steering:v.steering,wheels:v.wheelState});
  this.syncDriver(c);
 }
 syncDriver(c){
  if(c.driver||c.used)this.dirty=true;
  const player=this.players.byId.get(c.driver);if(player){player.x=c.x;player.y=c.y;player.z=c.z;player.yaw=c.yaw+Math.PI/2;player.ctx=-1;player.flags=(player.flags|PF_DRIVING)&~PF_USING;player.ver++;player.dirty=true;player.lastAt=this.now();}
 }
 syncPeople(){
  const desired=new Map();for(const p of this.players.byId.values())if(!p.vehicleId&&p.ctx===-1)desired.set(`p:${p.id}`,{x:p.x,y:p.y,z:p.z});
  if(this.dynamics.vehicles.size){if(!this.actorCache||this.tickN%6===0)this.actorCache=this.actors();for(const a of this.actorCache){if(a.ctx!==-1)continue;for(const v of this.dynamics.vehicles.values())if(Math.abs(a.x-v.position.x)<25&&Math.abs(a.z-v.position.z)<25){desired.set(a.id,{x:a.x,y:a.y,z:a.z});break;}}}else this.actorCache=null;
  for(const [id,rec]of this.pedestrians)if(!desired.has(id)){this.physics.removeRigidBody(rec.body);this.pedestrians.delete(id);}
  for(const [id,p]of desired){let r=this.pedestrians.get(id);if(!r){const body=this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y+.7,p.z)),collider=this.physics.createCollider(RAPIER.ColliderDesc.capsule(.35,.25).setCollisionGroups(PHYSICS_GROUPS.pedestrian),body);r={body,collider};this.pedestrians.set(id,r);}r.body.setNextKinematicTranslation({x:p.x,y:p.y+.7,z:p.z});}
 }
 tick(){const start=performance.now(),now=this.now(),dt=Math.max(0,Math.min(.1,(now-this.at)/1000));this.at=now;const clock=this.clock();
  // Traffic stops for the cars people drive and for people on foot in its lane.
  const obstacles=[];for(const c of this.all.values())if(c.mode===1)obstacles.push({x:c.x,z:c.z,len:this.rig(c).halfLength*2});
  for(const p of this.players.byId.values())if(p.ctx===-1&&!p.vehicleId)obstacles.push({x:p.x,z:p.z,len:.8});
  const simDt=Math.min(dt*Math.max(0,clock.rate||0),.5),n=Math.ceil(simDt/.1);for(let i=0;i<n;i++)this.traffic.step(simDt/n,clock.time,clock.hour,obstacles);
  for(const [id,r]of this.kinematic){const c=this.all.get(id);if(!c){this.physics.removeRigidBody(r.body);this.kinematic.delete(id);continue;}
   if(c.physics==='client'){const q=c.rotation,o=bodyOffset(q,this.rig(c).height/2+.18);r.body.setNextKinematicTranslation({x:c.x+o.x,y:(c.y||0)+o.y,z:c.z+o.z});r.body.setNextKinematicRotation(q);continue;}
   this.traffic.pose(c);r.body.setNextKinematicTranslation({x:c.x,y:(c.y||0)+this.rig(c).height/2+.18,z:c.z});}
  for(const c of this.all.values())if(!this.kinematic.has(c.id)&&!this.body(c))this.addKinematic(c);
  for(const c of this.all.values())if(c.physics==='client'&&(!c.owner||now-(c.inputAt||0)>POSE_TTL))this.toServer(c,c.owner?'timeout':'disconnected');
  this.syncPeople();this.acc=(this.acc||0)+dt;let steps=0;
  if(this.terrain){const pts=[];for(const c of this.all.values())if(this.body(c))pts.push({x:c.x,z:c.z});if(pts.length)this.terrain.update(pts);}
  while(this.acc>=1/60&&steps++<6){for(const c of this.all.values())if(this.body(c)&&(c.mode!==1||!c.owner||now-(c.inputAt||0)>VEHICLE_INPUT_TTL)){this.dynamics.setControls(String(c.id),BRAKE);setBoost(this.dynamics,String(c.id),false);}if(this.terrain)applyWater(this.dynamics,this.terrain.island,1/60);boostBefore(this.dynamics,1/60);this.dynamics.beforeStep(1/60);boostAfter(this.dynamics,1/60);this.physics.timestep=1/60;this.physics.step();this.dynamics.afterStep(1/60);this.acc-=1/60;}
  for(const c of this.all.values()){const v=this.body(c);if(v)this.updatePose(c,v);else if(c.physics!=='client'){const radius=this.rig(c).wheelRadius;c.wheels=Array.from({length:4},()=>({spin:(c.s||0)/radius,suspensionLength:.06,contact:true}));}}
  this.lead=Math.min(this.acc,1/30);this.presented=new Map();
  for(const [ws,c]of this.owners)if(c.physics!=='client'&&ws.vehicleProtocol>=2&&ws.readyState===1&&ws.bufferedAmount<500000&&c.owner===ws&&this.players.canPlay(ws)){const packet=encodeVehicles([this.present(c)],now,{version:2,partial:true});ws.send(packet);this.stats.bytes+=packet.byteLength;}
  if(++this.tickN%30===0)for(const c of [...this.all.values()]){
   if(c.driver&&!c.owner&&now-(c.disconnectedAt||now)>VEHICLE_DISCONNECT_GRACE){const point=this.safeExit(c);if(point)this.release(c,point);}
   const life=this.lifecycle.records.get(c.id);
   if(c.driver||c.mode===0||!life?.used||life.deadline===null||blockAt(this.g,c.x,c.z))c.roadAt=null;else{c.roadAt??=now;life.deadline=Math.min(life.deadline,c.roadAt+ROAD_CLEANUP_MS);}
  }
  for(const id of this.lifecycle.update(now,pid=>(this.players.byId.get(pid)?.ctx??-1)>=0)){const c=this.all.get(id);if(c&&!c.driver){if(this.body(c))this.dynamics.remove(String(id));this.removeKinematic(c);this.all.delete(id);this.dirty=true;}}
  if(this.tickN%600===0&&this.dirty)this.save();this.stats.ticks++;this.stats.physicsMs=performance.now()-start;
 }
 stream(ws){if(ws.readyState!==1||!ws.P||!this.perms.allowed(ws.P,'world.view')||ws.bufferedAmount>500000)return;const p=this.players.byId.get(ws.pid),view=ws.view||p||{x:0,z:0},list=[];
  const radius=ws.vehicleRadius||400,v3=ws.vehicleProtocol===3;for(const c of this.all.values())if(c.driver===ws.pid||Math.hypot(c.x-view.x,c.z-view.z)<radius)list.push(c);const rate=this.clock().rate;
  // Traffic and resting parked cars need no tyre contacts: protocol 3 sends them compact (40 bytes instead of 216).
  const frame=encodeVehicles(list.slice(0,512).map(c=>c.mode===0?{...c,v:c.v*rate,vx:Math.cos(c.yaw)*c.v*rate,vz:-Math.sin(c.yaw)*c.v*rate,compact:v3}:v3&&c.mode===2&&!this.body(c)&&c.physics!=='client'?{...c,compact:true}:this.present(c)),this.at,{version:v3?3:ws.vehicleProtocol===2?2:1});ws.send(frame);this.stats.frames++;this.stats.bytes+=frame.byteLength;
 }
 resync(ws,m={}){if(m.protocol===2||m.protocol===3)ws.vehicleProtocol=m.protocol;if(Number.isFinite(m.radius))ws.vehicleRadius=Math.max(120,Math.min(400,m.radius));this.stream(ws);if(!Number.isSafeInteger(m.req)||m.req<1)return;const known=ws.vehicleCommands?.get(m.req);if(known)this.players.send(ws,known);
  const c=this.owners.get(ws),p=this.players.byId.get(ws.pid),entered=m.op==='enter'&&c?.id===m.id,exited=m.op==='exit'&&!c&&p&&!p.vehicleId;
  this.players.send(ws,{t:'drive_status',req:m.req,ok:!!(entered||exited),id:entered?c.id:null,point:exited?{x:p.x,y:p.y,z:p.z}:null,why:entered?'Driving':exited?'Exited':'The action was not applied; current seat is unchanged'});
 }
 broadcast(clients){for(const ws of clients)this.stream(ws);}
 save(){const cars=[...this.all.values()].filter(c=>c.mode!==0).map(c=>({id:c.id,k:c.k,x:c.x,y:c.y,z:c.z,yaw:c.yaw,col:c.col,mode:2,v:0,s:0,used:!!(c.used||c.driver),lastUser:this.lifecycle.records.get(c.id)?.lastUser||null,deadline:this.lifecycle.records.get(c.id)?.deadline||c.deadline||null,region:this.lifecycle.records.get(c.id)?.region||'outside'}));this.store.save('vehicles',{version:1,worldId:this.worldId,nextId:this.traffic.nextId,cars});this.dirty=false;}
 blockedMove(p,x,z){for(const c of this.all.values()){if(Math.abs(p.y-(c.y||0))>1.6)continue;const rig=this.rig(c),d=vehicleEnvelopeDistance({x,z},c,rig),before=vehicleEnvelopeDistance(p,c,rig);if(d<.26&&!(before<.26&&d>before+1e-5))return true;}return false;}
 closePlayer(p){const c=this.all.get(p.vehicleId);if(!c||c.driver!==p.id){p.vehicleId=null;return true;}const point=this.safeExit(c);if(!point)return false;this.release(c,point);return true;}
 requestStop(id,ws=null){const c=this.all.get(id);if(c&&(!ws||c.owner===ws)){c.inputAt=0;this.dynamics.setControls(String(id),BRAKE);}}
 forgetAccount(id){for(const c of this.all.values())if(c.driver===id){const point=this.safeExit(c)||{x:c.x,y:0,z:c.z};this.release(c,point);}}
 worldChanged(){this.buildStatic();if(this.trafficRoads!==this.world.roads){this.trafficRoads=this.world.roads;this.traffic.setRoads(this.world);this.dirty=true;}for(const c of this.all.values())if(this.body(c))this.dynamics.setControls(String(c.id),BRAKE);}
 dispose(){for(const c of this.all.values())if(c.driver){const point=this.safeExit(c);if(point)this.release(c,point);}this.save();this.dynamics.dispose();this.physics.free();}
}
