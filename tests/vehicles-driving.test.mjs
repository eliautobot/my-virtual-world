// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createVehicles} from '../server/world/vehicles.js';import {generateWorld} from '../server/world/generate.js';import {PlayerNav} from '../shared/playernav.js';import {Store} from '../server/store.js';import {decodeVehicles,encodeVehicles} from '../shared/vehicleproto.js';import {blockAt,makeGrid} from '../shared/city.js';import {GROUND_Y} from '../shared/constants.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {vehicleExitCandidates} from '../shared/driving-classic/vehicle-exit-geometry.mjs';
import {vehicleChaseCamera} from '../shared/vehicle-camera.js';
import crypto from 'node:crypto';
import {trafficDensity} from '../shared/vehicle-traffic.js';
import * as THREE from 'three';
import {makeVehicleDraw,interpolateVehicle,groundVehicleWheel,OwnCarDelay,smoothJumps} from '../shared/vehicle-presentation.js';
import {VehicleSkidMarks} from '../shared/driving-classic/vehicle-skid-marks.mjs';
const parked=(g,extra={})=>({id:900,k:0,x:g.X[1],y:0,z:g.Z[1],yaw:0,col:0xad2737,mode:2,v:0,s:0,used:false,lastUser:null,deadline:null,region:'outside',...extra});
const make=async({arena=false,cars=null}={})=>{
 const world=generateWorld({seed:'driving-test',nx:3,nz:3}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mvw-drive-')),nav=new PlayerNav(world),messages=[];
 let now=100000;
 const players={byId:new Map(),nav,spawnPoint:()=>nav.defaultSpawn(),groundY:(x,z)=>blockAt(nav.g,x,z)?GROUND_Y:0,canPlay:ws=>!!ws.P.account,send:(ws,m)=>messages.push({ws,m}),toAccount:(id,m)=>messages.push({id,m})};
 const perms={allowed:(P,cap)=>cap==='world.view'||!!P.account},store=new Store(dir),g=makeGrid(world.grid);store.save('vehicles',{version:1,worldId:'test-world',nextId:1000,cars:cars||[parked(g)]});
 const manager=await createVehicles({world,worldId:'test-world',players,store,perms,clock:()=>({rate:arena?0:1,time:now/1000,hour:12}),now:()=>now});
 const ws={P:{account:{id:1}},pid:1,readyState:1,bufferedAmount:0,send:()=>{}};
 const car=manager.all.get(900)||[...manager.all.values()].find(c=>c.mode===2),rig=manager.rig(car),p={id:1,x:car.x,y:0,z:car.z+rig.halfWidth+.5,ctx:-1,flags:0,ver:0,conns:new Set([ws]),dirty:false};players.byId.set(1,p);
 if(arena){for(const c of [...manager.all.values()])if(c!==car){manager.removeKinematic(c);manager.traffic.remove(c);}for(const b of manager.staticBodies.slice(1))manager.physics.removeRigidBody(b);manager.staticBodies=manager.staticBodies.slice(0,1);manager.removeKinematic(car);car.x=manager.g.X[1];car.z=manager.g.Z[1];car.y=0;car.yaw=0;p.x=car.x;p.z=car.z+rig.halfWidth+.5;manager.addKinematic(car);}
 return{manager,world,players,ws,p,car,rig,messages,clock:{get now(){return now;},set now(v){now=v;}},advance:(count,input,step=1000/60)=>{for(let i=0;i<count;i++){now+=step;if(input&&i%3===0)manager.controls(ws,{seq:(car.seq||0)+1,...input});manager.tick();}},close:()=>{manager.dispose();fs.rmSync(dir,{recursive:true,force:true});},dir};
};
test('authenticated single-seat enter is confirmed before driver poses, and replay does not duplicate bodies',async()=>{const f=await make();try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});assert.equal(f.car.driver,1);assert.equal(f.p.vehicleId,f.car.id);assert.ok(f.manager.body(f.car));
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});assert.equal(f.manager.dynamics.vehicles.size,1);
 const other={...f.ws,pid:2,P:{account:{id:2}}};f.players.byId.set(2,{...f.p,id:2,vehicleId:null});f.manager.command(other,{req:2,op:'enter',id:f.car.id});assert.equal(f.car.driver,1);assert.equal(f.messages.at(-1).m.ok,false);
}finally{f.close();}});
test('the real classic Rapier controller accelerates, steers, brakes and reverses in an unobstructed test arena',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{throttle:0,brake:1});const start={x:f.car.x,z:f.car.z};
 f.advance(180,{throttle:1,steer:0,brake:0});assert.ok(Math.abs(f.car.v)>2,`speed ${f.car.v}`);assert.ok(Math.hypot(f.car.x-start.x,f.car.z-start.z)>2);
 const yaw=f.car.yaw;f.advance(60,{throttle:.5,steer:.7,brake:0});assert.ok(Math.abs(f.car.steering)>.05);assert.ok(Math.abs(f.car.yaw-yaw)>.02);
 f.advance(200,{throttle:0,steer:0,brake:1});assert.ok(Math.abs(f.car.v)<1,`braked speed ${f.car.v}`);
 let reverseSpeed=0;for(let i=0;i<6;i++){f.advance(30,{throttle:-1,steer:0,brake:0});reverseSpeed=Math.min(reverseSpeed,f.car.v);}assert.ok(reverseSpeed<-.5,`reverse speed ${reverseSpeed}`);
}finally{f.close();}});
test('exit while moving is refused; a confirmed stopped exit is outside the coachwork and clears ownership',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(180,{throttle:1});f.manager.command(f.ws,{req:2,op:'exit'});assert.equal(f.messages.findLast(x=>x.m.t==='drive_result').m.ok,false);assert.equal(f.car.driver,1);
 f.advance(240,{brake:1});f.manager.command(f.ws,{req:3,op:'exit'});const reply=f.messages.findLast(x=>x.m.t==='drive_result');assert.equal(reply.m.ok,true,reply.m.why);assert.equal(f.car.driver,0);assert.equal(f.p.vehicleId,null);assert.ok(Math.hypot(f.p.x-f.car.x,f.p.z-f.car.z)>f.rig.halfWidth);
}finally{f.close();}});
test('missing/stale controls brake the car and foreign sockets cannot drive it',async()=>{const f=await make();try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(180,{throttle:1});const before=f.car.v;
 f.manager.controls({...f.ws},{seq:500,throttle:1});f.advance(240);assert.ok(Math.abs(f.car.v)<Math.abs(before));assert.equal(f.car.owner,f.ws);
}finally{f.close();}});
test('shared vehicle frames carry finite pose, wheels and stable ids and reject malformed data',()=>{
 const c={id:4,k:2,col:0x2468ac,mode:1,driver:9,x:3,y:.1,z:8,yaw:.3,v:4,wheels:Array.from({length:4},(_,i)=>({spin:i,suspensionLength:.06,contact:true}))};
 const b=encodeVehicles([c],1234),d=decodeVehicles(b);assert.equal(d.cars[0].id,4);assert.equal(d.cars[0].driver,9);assert.equal(d.cars[0].wheels[3].spin,3);assert.equal(decodeVehicles(b.slice(0,b.byteLength-1)),null);
});

test('a fully blocked exit retains the confirmed seat and does not teleport the player',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(120,{brake:1});
 const points=vehicleExitCandidates({type:f.rig.type,position:{x:f.car.x,y:f.car.y,z:f.car.z},yaw:f.car.yaw},()=>0);
 for(const p of points){const body=f.manager.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x,.7,p.z));f.manager.physics.createCollider(RAPIER.ColliderDesc.cuboid(.5,.7,.5),body);}
 const before={x:f.p.x,z:f.p.z};f.manager.command(f.ws,{req:2,op:'exit'});
 const r=f.messages.findLast(x=>x.m.t==='drive_result');assert.equal(r.m.ok,false);assert.equal(f.car.driver,1);assert.equal(f.p.x,before.x);assert.equal(f.p.z,before.z);
}finally{f.close();}});

test('disconnect brakes immediately; the same account resumes with fresh input sequence and saves an exited position',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{throttle:1});f.manager.detach(f.ws);assert.equal(f.car.owner,null);
 const resumed={...f.ws,send:()=>{}};f.manager.attach(resumed);assert.equal(f.car.owner,resumed);assert.equal(f.car.seq,0);
 f.advance(240,{brake:1});assert.equal(f.manager.closePlayer(f.p),true);assert.equal(f.p.vehicleId,null);assert.equal(f.car.driver,0);
 f.manager.save();const saved=JSON.parse(fs.readFileSync(path.join(f.dir,'vehicles.json'),'utf8'));const car=saved.cars.find(c=>c.id===f.car.id);assert.ok(car);assert.equal(car.mode,2);assert.equal(car.used,true);assert.equal(car.lastUser,1);
}finally{f.close();}});

test('source chase framing looks ahead and clips the rear camera against buildings',()=>{
 const car={x:0,y:0,z:0,yaw:0},open=vehicleChaseCamera(car,2.3,{buildings:[]});assert.deepEqual(open.focus,{x:2,y:.65,z:0});assert.equal(open.fov,62);
 const blocked=vehicleChaseCamera(car,2.3,{buildings:[{x:-4,z:0,w:2,d:8,rot:0,floors:3}]});assert.ok(blocked.dist<open.dist);assert.ok(blocked.dist>=1.5);
});

test('all six preserved models have grounded, powered four-wheel reference physics',async()=>{
 for(let k=0;k<6;k++){const f=await make({arena:true});try{
  f.manager.removeKinematic(f.car);f.car.k=k;const r=f.manager.rig(f.car);f.p.z=f.car.z+r.halfWidth+.5;f.manager.addKinematic(f.car);
  f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{brake:1});f.advance(90,{throttle:1});
  const v=f.manager.body(f.car);assert.equal(v.wheelState.length,4);assert.ok(v.wheelState.some(w=>w.contact));assert.ok(v.speed>.5,`${r.type} speed ${v.speed}`);
 }finally{f.close();}}
});

test('reference driving modules retain their verified source hashes and original software license',()=>{
 const dir=new URL('../shared/driving-classic/',import.meta.url),p=JSON.parse(fs.readFileSync(new URL('PROVENANCE.json',dir)));
 assert.equal(p.modules.length,10);for(const m of p.modules)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(m.file,dir))).digest('hex'),m.adaptedSHA256);
 assert.ok(fs.readFileSync(new URL('LICENSE',dir),'utf8').includes('PolyForm Noncommercial License 1.0.0'));
});

test('authoritative ambient density preserves the existing Next day/commute curve',()=>{
 for(let h=0;h<24;h+=.25){const day=h>6.5&&h<21.5?1:0,g=(c,w)=>Math.exp(-(((h-c)/w)**2)),expected=Math.min(1,.14+.3*day+.42*g(8.4,1.3)+.48*g(17.7,1.6)+.1*g(12.5,1.5));assert.equal(trafficDensity(h),expected);}
});

test('three enter-exit-re-enter cycles reuse one physical body and never leave confirmation pending',async()=>{const f=await make({arena:true});try{
 let body;for(let cycle=0;cycle<3;cycle++){f.manager.command(f.ws,{req:cycle*2+1,op:'enter',id:f.car.id});assert.equal(f.messages.findLast(x=>x.m.t==='drive_result').m.ok,true);assert.equal(f.car.driver,1);const current=f.manager.body(f.car).body;if(body)assert.equal(current,body);body=current;f.advance(90,{brake:1});f.manager.command(f.ws,{req:cycle*2+2,op:'exit'});assert.equal(f.messages.findLast(x=>x.m.t==='drive_result').m.ok,true);assert.equal(f.car.driver,0);}assert.equal(f.manager.dynamics.vehicles.size,1);
}finally{f.close();}});

test('render root offset rotates with the chassis and does not move wheels into the road',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{brake:1});const v=f.manager.body(f.car),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.3);v.body.setRotation(q,true);v.rotation=v.body.rotation();v.position=v.body.translation();f.manager.updatePose(f.car,v);
 const qq=new THREE.Quaternion(v.rotation.x,v.rotation.y,v.rotation.z,v.rotation.w),w=f.rig.wheels[0],expected=new THREE.Vector3(w.x,-.3,w.z).applyQuaternion(qq).add(new THREE.Vector3(v.position.x,v.position.y,v.position.z)),drawn=new THREE.Vector3(w.x,f.rig.rootLift-.3,w.z).applyQuaternion(qq).add(new THREE.Vector3(f.car.x,f.car.y,f.car.z));assert.ok(expected.distanceTo(drawn)<1e-6);
}finally{f.close();}});

test('V2 contact/normal/slip deltas round-trip while V1 frames remain accepted',()=>{
 const c={id:7,k:0,col:1,mode:1,driver:1,x:1,y:0,z:2,yaw:0,wheels:Array.from({length:4},()=>({spin:1,suspensionLength:.1,contact:true,point:{x:1,y:.16,z:2},normal:{x:0,y:1,z:0},slip:.8}))};
 const v1=decodeVehicles(encodeVehicles([c],1000));assert.equal(v1.version,1);assert.equal(v1.partial,false);const v2=decodeVehicles(encodeVehicles([c],1000,{version:2,partial:true}));assert.equal(v2.version,2);assert.equal(v2.partial,true);assert.ok(Math.abs(v2.cars[0].wheels[0].slip-.8)<1e-6);assert.ok(Math.abs(v2.cars[0].wheels[0].point.y-.16)<1e-6);
});

test('tire support follows actual contact surfaces for flat road, raised curb and body tilt',()=>{
 for(const height of [0,.16])for(const tilt of [0,.3,-.3]){const m=new THREE.Matrix4().makeRotationZ(tilt).setPosition(1,-.1,2),n={x:0,y:1,z:0};groundVehicleWheel(m,{contact:true,point:{x:1,y:height,z:2},normal:n},.3,.1);const e=m.elements,support=.1*Math.abs(e[1])+.3*Math.hypot(e[5],e[9]);assert.ok(Math.abs(e[13]-support-height-.002)<1e-6);}
});

test('contact-based classic tread marks use one bounded draw call and require real slip',()=>{
 const scene=new THREE.Scene(),marks=new VehicleSkidMarks(scene,{capacity:32});const w={contact:true,point:{x:0,y:0,z:0},normal:{x:0,y:1,z:0},slip:0};marks.updateVehicle('test',[w],1);assert.equal(marks.count,0);marks.updateVehicle('test',[{...w,slip:.8}],1);marks.updateVehicle('test',[{...w,slip:.8,point:{x:.2,y:0,z:0}}],1.1);assert.ok(marks.count>0);assert.equal(scene.children.length,1);assert.equal(marks.positions.length,32*18);assert.ok([...marks.positions].every(Number.isFinite));marks.dispose();
});

test('Hermite presentation keeps constant-speed motion continuous through packet boundaries',()=>{
 const c={id:1,k:0,col:1,mode:1,driver:1,x:0,y:0,z:0,yaw:0,v:10,vx:10,vy:0,vz:0,steering:0,rotation:{x:0,y:0,z:0,w:1},wheels:Array.from({length:4},()=>({spin:0,suspensionLength:.06,contact:false,slip:0,point:null,normal:null}))},a={...c,time:0},b={...c,x:.5,time:50},d=makeVehicleDraw(c);
 for(let t=0;t<=80;t+=5){interpolateVehicle([a,b],t,d,.3);assert.ok(Math.abs(d.x-t/100)<1e-6);}
});

test('a failed entry returns a definitive result and status resync never replays the mutation',async()=>{const f=await make({arena:true});const original=f.manager.dynamics.add;try{
 f.manager.dynamics.add=()=>{throw new Error('injected pre-seat failure');};f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});assert.equal(f.messages.findLast(x=>x.m.t==='drive_result').m.ok,false);assert.equal(f.car.driver,0);
 f.manager.resync(f.ws,{protocol:2,req:1,op:'enter',id:f.car.id});assert.equal(f.messages.findLast(x=>x.m.t==='drive_status').m.ok,false);assert.equal(f.car.driver,0);assert.equal(f.ws.vehicleProtocol,2);
}finally{f.manager.dynamics.add=original;f.close();}});

test('negotiated owner deltas contain only the owned car; legacy connections receive no delta stream',async()=>{const f=await make({arena:true});try{
 const packets=[];f.ws.send=b=>packets.push(decodeVehicles(b));f.manager.resync(f.ws,{protocol:2});f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{brake:1});const deltas=packets.filter(p=>p?.partial);assert.ok(deltas.length>60);assert.ok(deltas.every(p=>p.cars.length===1&&p.cars[0].id===f.car.id));
 f.ws.vehicleProtocol=1;packets.length=0;f.advance(30,{brake:1});assert.equal(packets.filter(p=>p?.partial).length,0);
}finally{f.close();}});

test('owned-car frames stay time-consistent under the real 16ms timer rhythm (no half-speed holes)',async()=>{const f=await make({arena:true});try{
 const packets=[];f.ws.send=b=>packets.push(decodeVehicles(b));f.manager.resync(f.ws,{protocol:2});f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{brake:1},16);f.advance(150,{throttle:1},16);
 packets.length=0;for(let i=0;i<180;i++){f.clock.now+=16;if(i%3===0)f.manager.controls(f.ws,{seq:(f.car.seq||0)+1,throttle:1});f.manager.tick();if(f.manager.tickN%3===0){f.clock.now+=3;f.manager.broadcast([f.ws]);f.clock.now-=3;}}
 const own=packets.flatMap(p=>p?p.cars.filter(c=>c.id===f.car.id).map(c=>({...c,time:p.time,partial:p.partial})):[]),deltas=own.filter(c=>c.partial),full=own.filter(c=>!c.partial);
 assert.ok(deltas.length>=170,`steady owner cadence ${deltas.length}`);assert.ok(full.length>=50);
 for(let i=1;i<deltas.length;i++){const a=deltas[i-1],b=deltas[i],dt=(b.time-a.time)/1000;assert.ok(dt>0,'monotonic stamps');const moved=Math.hypot(b.x-a.x,b.z-a.z),speed=(Math.hypot(a.vx,a.vz)+Math.hypot(b.vx,b.vz))/2;assert.ok(speed>3,`speed ${speed}`);const ratio=moved/dt/speed;assert.ok(ratio>.9&&ratio<1.1,`pose/time ratio ${ratio.toFixed(3)} at ${b.time}`);}
 for(const c of full){const d=deltas.find(x=>x.time===c.time);assert.ok(d,`full frame stamped at a delta time ${c.time}`);assert.ok(Math.abs(d.x-c.x)<1e-4&&Math.abs(d.z-c.z)<1e-4,'full frame and delta agree');}
}finally{f.close();}});

test('extrapolation past the newest sample keeps turning instead of freezing the heading',()=>{
 const base={id:1,k:0,col:1,mode:1,driver:1,y:0,v:10,vy:0,steering:0,wheels:Array.from({length:4},()=>({spin:0,suspensionLength:.06,contact:false,slip:0,point:null,normal:null}))};
 const q=yaw=>({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}),old={...base,x:-1,z:0,vx:10,vz:0,yaw:-.1,rotation:q(-.1),time:-100},a={...base,x:0,z:0,vx:10,vz:0,yaw:0,rotation:q(0),time:0},b={...base,x:.5,z:0,vx:10,vz:0,yaw:.1,rotation:q(.1),time:50},d=makeVehicleDraw(a);
 interpolateVehicle([old,a,b],80,d,.3);assert.ok(Math.abs(d.yaw-.16)<1e-6,`yaw ${d.yaw}`);assert.ok(Math.abs(2*Math.atan2(d.rotation.y,d.rotation.w)-.16)<1e-6);assert.ok(Math.abs(d.x-.8)<1e-3,'follows the turn, close to the straight line over 30 ms');
 interpolateVehicle([old,a,b],25,d,.3);assert.ok(Math.abs(d.yaw-.05)<1e-6,'interpolation unchanged');
});

test('own-car presentation delay stays at 35ms on a fast link, ignores main-thread stalls and grows smoothly for a slow link',()=>{
 const run=(latency,stallAt=-1)=>{const d=new OwnCarDelay();let last=d.value,maxStep=0;for(let f=0;f<600;f++){const now=f*16.7+5,newest=Math.floor((now-latency)/16.7)*16.7,v=f>=stallAt&&f<stallAt+8?d.frame(now+200-newest,216.7):d.frame(now-newest,16.7);maxStep=Math.max(maxStep,Math.abs(v-last));last=v;}return{d,maxStep};};
 const fast=run(4);assert.equal(fast.d.value,35);const stalled=run(4,300);assert.equal(stalled.d.value,35);
 const slow=run(60);assert.ok(slow.d.value>75&&slow.d.value<=150,`slow ${slow.d.value}`);assert.ok(slow.maxStep<=.5+1e-9,`slew ${slow.maxStep}`);
 slow.d.reset();assert.equal(slow.d.value,35);assert.equal(slow.d.frame(NaN),35);
});

test('no starter cars are placed; saved unused starters are dropped and used cars always get a cleanup deadline',async()=>{
 const world=generateWorld({seed:'driving-test',nx:3,nz:3}),g=makeGrid(world.grid);
 const f=await make({cars:[parked(g,{id:901,starter:true}),parked(g,{id:902,starter:true,used:true,x:g.X[2]}),parked(g,{id:903,x:g.X[0]}),parked(g,{id:904,used:true,x:g.X[1]+8})]});try{
  const kept=[...f.manager.all.values()].filter(c=>c.mode!==0).map(c=>c.id).sort();assert.deepEqual(kept,[902,903,904]);
  assert.ok([...f.manager.all.values()].every(c=>!c.starter));
  for(const id of [902,904])assert.ok(Number.isFinite(f.manager.lifecycle.records.get(id).deadline),`car ${id} expires`);
  f.manager.save();const saved=f.manager.store.load('vehicles');assert.deepEqual(saved.cars.map(c=>c.id).sort(),[902,903,904]);assert.ok(saved.cars.every(c=>!('starter' in c)));
 }finally{f.close();}
});

test('a car left standing on the road is cleared after a minute instead of five',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(90,{brake:1});f.manager.command(f.ws,{req:2,op:'exit'});
 assert.equal(f.messages.findLast(x=>x.m.t==='drive_result').m.ok,true);assert.equal(blockAt(f.manager.g,f.car.x,f.car.z),null,'test car stands on the street');
 f.advance(550,null,100);assert.ok(f.manager.all.has(f.car.id),'still there after 55 s');
 f.advance(110,null,100);assert.ok(!f.manager.all.has(f.car.id),'cleared within about a minute');
}finally{f.close();}});

test('a car saved while being driven reloads as used, so it expires instead of staying forever',async()=>{const f=await make({arena:true});try{
 f.manager.command(f.ws,{req:1,op:'enter',id:f.car.id});f.advance(30,{brake:1});f.manager.save();const saved=f.manager.store.load('vehicles').cars.find(c=>c.id===f.car.id);assert.equal(saved.used,true);
}finally{f.close();}});

test('protocol 3 frames mix 40-byte compact traffic entries with detailed driven cars and decode to the same shape',()=>{
 const wheels=Array.from({length:4},()=>({spin:2.5,suspensionLength:.06,contact:true,point:{x:1,y:.1,z:2},normal:{x:0,y:1,z:0},slip:.4}));
 const traffic={id:3,driver:0,col:5,k:1,mode:0,seq:0,x:10,y:0,z:-4,yaw:.5,v:7,wheels,compact:true},driven={id:9,driver:2,col:6,k:0,mode:1,seq:4,x:1,y:.1,z:2,yaw:-.3,rotation:{x:0,y:Math.sin(-.15),z:0,w:Math.cos(-.15)},v:5,vx:4.8,vy:0,vz:1.4,steering:.2,wheels};
 const buf=encodeVehicles([traffic,driven],1234,{version:3});assert.equal(buf.byteLength,12+41+217);
 const f=decodeVehicles(buf);assert.equal(f.version,3);assert.equal(f.partial,false);const [a,b]=f.cars;
 assert.equal(a.id,3);assert.ok(Math.abs(a.vx-Math.cos(.5)*7)<1e-5&&Math.abs(a.vz+Math.sin(.5)*7)<1e-5);assert.ok(Math.abs(2*Math.atan2(a.rotation.y,a.rotation.w)-.5)<1e-6);assert.equal(a.wheels.length,4);assert.ok(Math.abs(a.wheels[2].spin-2.5)<1e-6);assert.equal(a.wheels[0].point,null);
 assert.equal(b.driver,2);assert.ok(Math.abs(b.wheels[1].slip-.4)<1e-6&&b.wheels[1].point);
 assert.equal(decodeVehicles(buf.slice(0,buf.byteLength-1)),null,'truncated frame refused');
 const bad=new Uint8Array(buf.slice(0));bad[12]=7;assert.equal(decodeVehicles(bad.buffer),null,'unknown entry tag refused');
 assert.equal(decodeVehicles(encodeVehicles([traffic],1,{version:3,partial:true})).partial,true);
});

test('a protocol 3 viewer gets compact traffic within its requested radius; protocol 2 viewers keep detailed frames',async()=>{const f=await make();try{
 const frames=[];f.ws.send=b=>frames.push(decodeVehicles(b));
 f.manager.resync(f.ws,{protocol:2});const v2=frames.at(-1);assert.equal(v2.version,2);
 f.ws.view={x:f.car.x,z:f.car.z};f.manager.resync(f.ws,{protocol:3,radius:150});const v3=frames.at(-1);assert.equal(v3.version,3);
 assert.ok(v3.cars.every(c=>Math.hypot(c.x-f.car.x,c.z-f.car.z)<150),'radius respected');assert.ok(v3.cars.length<=v2.cars.length);
 f.manager.resync(f.ws,{protocol:3,radius:5000});assert.ok(frames.at(-1).cars.length>0);
 const raw=[];f.ws.send=b=>raw.push(b);f.manager.resync(f.ws,{protocol:3,radius:400});const cars=decodeVehicles(raw.at(-1)).cars;const n=cars.length,traf=cars.filter(c=>c.mode===0).length;
 assert.ok(traf>0);assert.ok(raw.at(-1).byteLength<12+traf*41+(n-traf)*217+1,'traffic sent compact');
}finally{f.close();}});

// A car turning steadily: 10 m/s, yaw rate 0.4 rad/s, samples every 50 ms; position/velocity/yaw exact on the circle.
const arcCar=(t,{rate=.4,speed=10}={})=>{const yaw=rate*t/1000,R=speed/rate,q={x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)};
 return{id:7,k:0,col:1,mode:0,driver:0,time:t,x:R*Math.sin(yaw),y:0,z:-R*(1-Math.cos(yaw)),yaw,v:speed,vx:speed*Math.cos(yaw),vy:0,vz:-speed*Math.sin(yaw),steering:.1,rotation:q,
  wheels:Array.from({length:4},(_,i)=>({spin:0,suspensionLength:.06,contact:true,slip:0,point:{x:R*Math.sin(yaw)+(i<2?1.3:-1.3),y:0,z:-R*(1-Math.cos(yaw))},normal:{x:0,y:1,z:0}}))};};

test('through a data gap other cars keep following their turn for up to 0.5 s, then hold',()=>{
 const samples=[0,50,100].map(t=>arcCar(t)),d=makeVehicleDraw(samples[0]);
 for(const t of [150,250,400,600]){interpolateVehicle(samples,t,d,.3,.5);const truth=arcCar(t);const err=Math.hypot(d.x-truth.x,d.z-truth.z);
  assert.ok(err<.02,`at ${t} ms the coasting car is ${err.toFixed(3)} m off its true path`);assert.ok(Math.abs(d.yaw-truth.yaw)<1e-3,`yaw at ${t}`);}
 interpolateVehicle(samples,900,d,.3,.5);const held=arcCar(600);assert.ok(Math.hypot(d.x-held.x,d.z-held.z)<.02,'stops coasting 0.5 s past the newest sample');
 assert.ok(d.wheels.every(w=>Number.isFinite(w.point.x)&&Math.abs(w.normal.y-1)<1e-9),'wheel contacts move with the car');
 interpolateVehicle(samples,150,d,.3);const short=arcCar(150);assert.ok(Math.hypot(d.x-short.x,d.z-short.z)<.01,'default horizon (own car) still 50 ms');
});

test('when data resumes after coasting, the car glides to its true spot instead of jumping, and respawns still snap',()=>{
 // Coast 300 ms on a slightly wrong yaw rate (the true car turned harder), then the real samples arrive.
 const truth=t=>arcCar(t,{rate:.9}),seen=[0,50,100].map(t=>arcCar(t)),d=makeVehicleDraw(seen[0]),st={};let last=null,maxStep=0;
 const draw=(list,t)=>{interpolateVehicle(list,t,d,.3,.5);smoothJumps(st,d,t);if(last){maxStep=Math.max(maxStep,Math.hypot(d.x-last.x,d.z-last.z));}last={x:d.x,z:d.z};};
 for(let t=100;t<=388;t+=16)draw(seen,t);
 const fresh=[...seen,...[150,200,250,300,350,400,450].map(t=>truth(t))],raw=makeVehicleDraw(fresh[0]);interpolateVehicle(fresh,404,raw,.3,.5);
 const coasted={x:d.x,z:d.z},jump=Math.hypot(raw.x-coasted.x,raw.z-coasted.z);assert.ok(jump>.3,`the scenario produces a visible correction (${jump.toFixed(2)} m)`);
 maxStep=0;for(let t=404;t<=1100;t+=16)draw(fresh.concat([500,550,600,650,700,750,800,850,900,950,1000,1050,1100].map(t=>truth(t))),t);
 assert.ok(maxStep<.16+jump*.11,`each frame moves its normal 16 ms of travel plus at most ~10% of the ${jump.toFixed(2)} m correction (max ${maxStep.toFixed(3)} m), not the whole jump`);
 const end=truth(1100);const endT=404+16*Math.floor((1100-404)/16),endP=truth(endT);assert.ok(Math.hypot(d.x-endP.x,d.z-endP.z)<.02,'fully converged after ~0.7 s');assert.ok(Math.abs(d.yaw-endP.yaw)<.01,'heading converged');
 const far={...truth(1116),x:end.x+30};interpolateVehicle([far],1116,d,.3,.5);smoothJumps(st,d,1116);assert.ok(Math.abs(d.x-far.x)<1e-9,'a respawn 30 m away snaps');
});

test('steady driving is drawn exactly as interpolated (no smoothing lag)',()=>{
 const list=Array.from({length:10},(_,i)=>arcCar(i*50)),d=makeVehicleDraw(list[0]),st={};
 for(let t=200;t<=440;t+=16){interpolateVehicle(list,t,d,.3,.5);const x=d.x,z=d.z,yaw=d.yaw;smoothJumps(st,d,t);assert.equal(d.x,x);assert.equal(d.z,z);assert.equal(d.yaw,yaw);}
 // hard braking (8 m/s²) and far cars refreshed only every 3rd frame (50 ms) are also left untouched
 const brake=t=>{const s=t/1000,v=Math.max(0,20-8*s),x=20*s-4*s*s;return{...arcCar(0),time:t,x,vx:v,v,yaw:0,z:0,vz:0};};
 for(const step of [16,50]){const L=Array.from({length:10},(_,i)=>brake(i*50)),e=makeVehicleDraw(L[0]),s2={};
  for(let t=200;t<=440;t+=step){interpolateVehicle(L,t,e,.3,.5);const x=e.x;smoothJumps(s2,e,t);assert.equal(e.x,x,`braking, ${step} ms frames`);}}
});

test('the other-car buffer stays at 100 ms on a steady stream, grows only for recurring bursts and never past 250 ms',()=>{
 const run=(arrive,frames=1800,tail=0)=>{const d=new OwnCarDelay({min:100,max:250,margin:20,window:600,every:10,fall:.25});let newest=null,i=0,max=0;
  for(let f=0;f<frames;f++){const now=f*16.7;while(arrive(i)<=now){newest=i*50;i++;}const v=d.frame(newest===null?NaN:now-newest,16.7);max=Math.max(max,v);}return{d,max};};
 assert.equal(run(i=>i*50).max,100,'steady 20 Hz');
 const once=run(i=>i>=200&&i<=205?10300:i*50);assert.ok(once.max<=101,`a single 300 ms hold-up is left to coasting (${once.max.toFixed(1)} ms)`);
 const bursty=run(i=>Math.ceil((i*50+1)/250)*250);                 // frames arrive in clumps every 250 ms
 assert.ok(bursty.d.value>200&&bursty.max<=250,`recurring 250 ms clumps raise the buffer (${bursty.d.value.toFixed(0)} ms)`);
 const settled=run(i=>i<240?Math.ceil((i*50+1)/250)*250:i*50,2400);   // 12 s of clumps, then 28 s of a steady stream
 assert.ok(settled.max>200&&settled.d.value<=101,`back to 100 ms within ~20 s of the stream steadying (${settled.d.value.toFixed(0)} ms)`);
});

test('Shift boosts: a burnout from a standstill, then harder acceleration and a higher top speed (shared/vehicle-boost.js)', async () => {
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default; await RAPIER.init({});
  const { VehicleDynamics } = await import('../shared/driving-classic/vehicle-dynamics.mjs');
  const B = await import('../shared/vehicle-boost.js');
  const run = boost => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0));
    const d = new VehicleDynamics(world); d.add('a', { type: 'car', position: { x: 0, y: 0.6, z: 0 } });
    let burn = 0; const at = [];
    for (let k = 0; k < 12 * 60; k++) {
      d.setControls('a', { throttle: 1, steer: 0, brake: 0, handbrake: false }); B.setBoost(d, 'a', boost);
      B.boostBefore(d, 1 / 60); if (d.get('a').burnout) burn++;
      d.beforeStep(1 / 60); B.boostAfter(d, 1 / 60); world.timestep = 1 / 60; world.step(); d.afterStep(1 / 60);
      if (k % 60 === 59) at.push(d.get('a').speed);
    }
    return { burn, at };
  };
  const n = run(false), b = run(true);
  assert.equal(n.burn, 0, 'no burnout without the boost');
  assert.ok(b.burn > 30 && b.burn < 90, `a burnout of about a second (${b.burn} frames)`);
  assert.ok(b.at[4] > n.at[4] + 4, 'pulls away harder');
  assert.ok(b.at.at(-1) > n.at.at(-1) + 3 && b.at.at(-1) < 33 * 1.25 + 4, 'a higher top speed, inside the server\'s pose check');
});
