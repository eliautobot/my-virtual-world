// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Driving collision world and pose wire format, shared by the server and by a driver's browser (decision A20:
// the driver's browser simulates its own car; the server validates and relays).
import { moduleBoxes } from './world-modules.js';
import {makeGrid,blockRect,lampPositions} from './city.js';
import {GROUND_Y,baseOf} from './constants.js';
import {apronRects} from './city-edge.js';
import {PHYSICS_GROUPS} from './driving-classic/physics-collision-groups.mjs';

/** Fixed colliders for ground, kerbed blocks, buildings, city walls, lamps, trees and stations. `solid` holds the
 *  handles a car may never overlap (everything except the ground and the blocks it drives up onto). */
export function buildVehicleStatics(RAPIER,physics,world){
 const g=makeGrid(world.grid),bodies=[],solid=new Set();
 const box=(x,y,z,hw,hh,hd,yaw=0,isSolid=true)=>{const body=physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z).setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}));const collider=physics.createCollider(RAPIER.ColliderDesc.cuboid(hw,hh,hd).setFriction(.9).setCollisionGroups(PHYSICS_GROUPS.ground),body);bodies.push(body);if(isSolid)solid.add(collider.handle);};
 // On an island (WP4.2/4.3) the city's slab ends at its apron and the terrain's heightfields (shared/terrain-physics.js) take over.
 const pad=world.terrain?12:100;
 if(!g.empty)box(0,-.15,0,Math.max(Math.abs(g.minX),Math.abs(g.maxX))+pad,.15,Math.max(Math.abs(g.minZ),Math.abs(g.maxZ))+pad,0,false);   // (no city: the terrain's heightfields only)
 for(let j=0;j<g.nz;j++)for(let i=0;i<g.nx;i++){const r=blockRect(g,i,j);box((r.x0+r.x1)/2,GROUND_Y/2,(r.z0+r.z1)/2,(r.x1-r.x0)/2,GROUND_Y/2,(r.z1-r.z0)/2,0,false);}
 // On an island the apron around the city, open where its roads leave (shared/city-edge.js, as drawn and walked).
 if(world.terrain&&!g.empty)for(const r of apronRects(g,world.roads))box((r.x0+r.x1)/2,GROUND_Y/2,(r.z0+r.z1)/2,(r.x1-r.x0)/2,GROUND_Y/2,(r.z1-r.z0)/2,0,false);
 for(const B of world.buildings||[]){if(!B||B.gone||B.type==='park')continue;const rot=(B.rot||0)*Math.PI/180;box(B.x,GROUND_Y+baseOf(B)+1.5,B.z,B.w/2,1.5,B.d/2,rot);}
 // The fence around the city: only on a world without an island (on an island the roads lead on).
 if(!world.terrain&&!g.empty){const x0=g.minX-35,x1=g.maxX+35,z0=g.minZ-35,z1=g.maxZ+35;
 box(x0,2,(z0+z1)/2,.3,2,(z1-z0)/2);box(x1,2,(z0+z1)/2,.3,2,(z1-z0)/2);box((x0+x1)/2,2,z0,(x1-x0)/2,2,.3);box((x0+x1)/2,2,z1,(x1-x0)/2,2,.3);}
 for(const p of lampPositions(g))box(p.x,2.4,p.z,.12,2.4,.12);
 for(const t of world.trees||[])box(t[0],1.8,t[1],.2,1.8,.2);
 for(const st of world.stations||[])box(st.x,(Number.isFinite(st.y)?st.y:0)+1.1,st.z,.66,1.1,1.92,st.rot||0);   // kiosks (beyond the city: on their pad)
 for(const b of moduleBoxes(world))box(b.x,(b.y0+b.y1)/2,b.z,b.hw,(b.y1-b.y0)/2,b.hd,b.rot);   // world modules' buildings (an airport's terminal, tower, hangar)
 return{g,bodies,solid};
}

/** The physics body sits `lift` up the chassis' own up axis from the render root. */
export function bodyOffset(q,lift){return{x:2*(q.x*q.y-q.w*q.z)*lift,y:(1-2*(q.x*q.x+q.z*q.z))*lift,z:2*(q.y*q.z+q.w*q.x)*lift};}

const r4=n=>Math.round(n*1e4)/1e4,r6=n=>Math.round(n*1e6)/1e6;
/** Compact pose: p = root x,y,z, rotation x,y,z,w, yaw, speed, root velocity x,y,z, angular velocity x,y,z, steering;
 *  w = per wheel spin, suspension, contact, contact point x,y,z, normal x,y,z, slip. */
export function packPose(s){
 const q=s.rotation,a=s.angular||{x:0,y:0,z:0};
 return{p:[r4(s.x),r4(s.y),r4(s.z),r6(q.x),r6(q.y),r6(q.z),r6(q.w),r6(s.yaw),r4(s.v),r4(s.vx),r4(s.vy),r4(s.vz),r4(a.x),r4(a.y),r4(a.z),r6(s.steering||0)],
  w:Array.from({length:4},(_,i)=>s.wheels?.[i]||{}).flatMap(w=>{const hit=!!(w.contact&&w.point&&w.normal);return[r4(w.spin||0),r4(w.suspensionLength??.24),hit?1:0,...(hit?[r4(w.point.x),r4(w.point.y),r4(w.point.z),r6(w.normal.x),r6(w.normal.y),r6(w.normal.z)]:[0,0,0,0,1,0]),r4(w.slip||0)];})};
}
export function unpackPose(m){
 if(!m||!Array.isArray(m.p)||m.p.length!==16||!Array.isArray(m.w)||m.w.length!==40)return null;
 if(!m.p.every(Number.isFinite)||!m.w.every(Number.isFinite))return null;
 const [x,y,z,qx,qy,qz,qw,yaw,v,vx,vy,vz,ax,ay,az,steering]=m.p,len=Math.hypot(qx,qy,qz,qw);
 if(Math.abs(len-1)>.02)return null;
 const wheels=[];for(let i=0;i<4;i++){const o=i*10,[spin,susp,hit,px,py,pz,nx,ny,nz,slip]=m.w.slice(o,o+10);
  wheels.push({spin,suspensionLength:susp,contact:hit===1,point:hit===1?{x:px,y:py,z:pz}:null,normal:hit===1?{x:nx,y:ny,z:nz}:null,slip:Math.max(0,Math.min(1,slip))});}
 return{x,y,z,rotation:{x:qx/len,y:qy/len,z:qz/len,w:qw/len},yaw,v,vx,vy,vz,angular:{x:ax,y:ay,z:az},steering,wheels};
}
