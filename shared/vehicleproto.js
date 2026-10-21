// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Authoritative vehicle frame type 3. V1 remains compatible; V2 adds tire contact/normal/slip and delta frames.
// V3 mixes entries: traffic and resting parked cars travel as 40-byte compact entries (pose, speed, wheel spin), only
// cars with live physics carry the 216-byte detailed V2 entry. Same decoded shape for every version.
export const MSG_VEHICLES=3,VEHICLE_FRAME_HEADER=12,VEHICLE_FRAME_ENTRY=104,VEHICLE_FRAME_ENTRY_V2=216,VEHICLE_FRAME_COMPACT=40;
const yawQ=y=>({x:0,y:Math.sin(y/2),z:0,w:Math.cos(y/2)});
function writeDetailed(d,o,c,v2){const q=c.rotation||yawQ(c.yaw);
 d.setUint32(o,c.id,true);d.setUint32(o+4,c.driver||0,true);d.setUint32(o+8,c.col,true);d.setUint8(o+12,c.k);d.setUint8(o+13,c.mode);d.setUint16(o+14,c.seq||0,true);
 const vals=[c.x,c.y||0,c.z,q.x,q.y,q.z,q.w,c.yaw,c.v||0,c.vx||0,c.vy||0,c.vz||0,c.steering||0];for(let j=0;j<13;j++)d.setFloat32(o+16+j*4,vals[j],true);
 let contacts=0,points=0;for(let w=0;w<4;w++){const x=c.wheels?.[w];d.setFloat32(o+68+w*4,x?.spin||0,true);d.setFloat32(o+84+w*4,x?.suspensionLength??.06,true);if(x?.contact)contacts|=1<<w;
  if(v2){const p=x?.point,n=x?.normal;if(p&&n&&[p.x,p.y,p.z,n.x,n.y,n.z].every(Number.isFinite))points|=1<<w;
   const pv=[p?.x||0,p?.y||0,p?.z||0,n?.x||0,n?.y??1,n?.z||0,x?.slip||0];for(let j=0;j<7;j++)d.setFloat32(o+104+w*28+j*4,pv[j],true);}
 }d.setUint8(o+100,contacts);if(v2)d.setUint8(o+101,points);
}
function writeCompact(d,o,c){
 d.setUint32(o,c.id,true);d.setUint32(o+4,c.driver||0,true);d.setUint32(o+8,c.col,true);d.setUint8(o+12,c.k);d.setUint8(o+13,c.mode);d.setUint16(o+14,c.seq||0,true);
 d.setFloat32(o+16,c.x,true);d.setFloat32(o+20,c.y||0,true);d.setFloat32(o+24,c.z,true);d.setFloat32(o+28,c.yaw,true);d.setFloat32(o+32,c.v||0,true);d.setFloat32(o+36,c.wheels?.[0]?.spin||0,true);
}
/** cars: entries; for version 3 an entry with `compact: true` uses the compact layout. */
export function encodeVehicles(cars,time,{version=1,partial=false}={}){
 if(version===3){let size=12;for(const c of cars)size+=c.compact?1+VEHICLE_FRAME_COMPACT:1+VEHICLE_FRAME_ENTRY_V2;
  const b=new ArrayBuffer(size),d=new DataView(b);d.setUint8(0,3);d.setUint8(1,partial?5:4);d.setUint16(2,cars.length,true);d.setFloat64(4,time,true);
  let o=12;for(const c of cars){if(c.compact){d.setUint8(o,0);writeCompact(d,o+1,c);o+=1+VEHICLE_FRAME_COMPACT;}else{d.setUint8(o,1);writeDetailed(d,o+1,c,true);o+=1+VEHICLE_FRAME_ENTRY_V2;}}
  return b;}
 const v2=version===2,size=v2?216:104,b=new ArrayBuffer(12+cars.length*size),d=new DataView(b);d.setUint8(0,3);d.setUint8(1,v2?(partial?3:2):0);d.setUint16(2,cars.length,true);d.setFloat64(4,time,true);
 for(let i=0;i<cars.length;i++)writeDetailed(d,12+i*size,cars[i],v2);
 return b;
}
function readDetailed(d,o,v2){const k=d.getUint8(o+12),mode=d.getUint8(o+13);if(k>5||mode>2)return null;
 const f=j=>d.getFloat32(o+16+j*4,true),x=f(0),y=f(1),z=f(2),qx=f(3),qy=f(4),qz=f(5),qw=f(6),yaw=f(7),v=f(8),vx=f(9),vy=f(10),vz=f(11),steering=f(12);
 if(!Number.isFinite(x+y+z+qx+qy+qz+qw+yaw+v+vx+vy+vz+steering))return null;
 const wheels=[],contacts=d.getUint8(o+100),points=v2?d.getUint8(o+101):0;
 for(let w=0;w<4;w++){const spin=f(13+w),susp=f(17+w);if(!Number.isFinite(spin+susp))return null;const state={spin,suspensionLength:susp,contact:!!(contacts&(1<<w)),point:null,normal:null,slip:0};
  if(v2){const g=j=>d.getFloat32(o+104+w*28+j*4,true),px=g(0),py=g(1),pz=g(2),nx=g(3),ny=g(4),nz=g(5),slip=g(6);if(!Number.isFinite(px+py+pz+nx+ny+nz+slip))return null;
   if(points&(1<<w)){state.point={x:px,y:py,z:pz};state.normal={x:nx,y:ny,z:nz};}state.slip=Math.max(0,Math.min(1,slip));}
  wheels.push(state);}
 return{id:d.getUint32(o,true),driver:d.getUint32(o+4,true),col:d.getUint32(o+8,true),k,mode,seq:d.getUint16(o+14,true),x,y,z,rotation:{x:qx,y:qy,z:qz,w:qw},yaw,v,vx,vy,vz,steering,wheels};
}
function readCompact(d,o){const k=d.getUint8(o+12),mode=d.getUint8(o+13);if(k>5||mode>2)return null;
 const x=d.getFloat32(o+16,true),y=d.getFloat32(o+20,true),z=d.getFloat32(o+24,true),yaw=d.getFloat32(o+28,true),v=d.getFloat32(o+32,true),spin=d.getFloat32(o+36,true);
 if(!Number.isFinite(x+y+z+yaw+v+spin))return null;const wheels=[];for(let w=0;w<4;w++)wheels.push({spin,suspensionLength:.06,contact:true,point:null,normal:null,slip:0});
 return{id:d.getUint32(o,true),driver:d.getUint32(o+4,true),col:d.getUint32(o+8,true),k,mode,seq:d.getUint16(o+14,true),x,y,z,rotation:yawQ(yaw),yaw,v,vx:Math.cos(yaw)*v,vy:0,vz:-Math.sin(yaw)*v,steering:0,wheels};
}
export function decodeVehicles(buf){
 const d=buf instanceof DataView?buf:new DataView(buf);if(d.byteLength<12||d.getUint8(0)!==3)return null;
 const flag=d.getUint8(1);if(![0,2,3,4,5].includes(flag))return null;const count=d.getUint16(2,true),time=d.getFloat64(4,true);if(count>512||!Number.isFinite(time))return null;const cars=[];
 if(flag>=4){let o=12;for(let i=0;i<count;i++){if(o>=d.byteLength)return null;const tag=d.getUint8(o),len=tag===0?VEHICLE_FRAME_COMPACT:tag===1?VEHICLE_FRAME_ENTRY_V2:-1;if(len<0||o+1+len>d.byteLength)return null;
   const c=tag===0?readCompact(d,o+1):readDetailed(d,o+1,true);if(!c)return null;cars.push(c);o+=1+len;}
  if(o!==d.byteLength)return null;return{time,cars,version:3,partial:flag===5};}
 const version=flag>=2?2:1,size=version===2?216:104;if(d.byteLength!==12+count*size)return null;
 for(let i=0;i<count;i++){const c=readDetailed(d,12+i*size,version===2);if(!c)return null;cars.push(c);}
 return{time,cars,version,partial:flag===3};
}
