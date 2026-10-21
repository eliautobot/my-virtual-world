// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Stable, allocation-bounded vehicle presentation. This never writes authoritative physics poses.
import * as THREE from 'three';
const qa=new THREE.Quaternion(),qb=new THREE.Quaternion(),UP=new THREE.Vector3(0,1,0),qe=new THREE.Quaternion(),QI=new THREE.Quaternion(),v3=new THREE.Vector3();
const angle=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
const lerp=(a,b,u)=>a+(b-a)*u;
export function makeVehicleDraw(c){return{...c,rotation:{...c.rotation},wheels:c.wheels.map(w=>({...w,point:w.point?{...w.point}:null,normal:w.normal?{...w.normal}:null}))};}
/** maxLag: how long (s) a car keeps moving past its newest sample when no newer one has arrived. Beyond the newest
 *  sample it follows its current turn (yaw rate from the last two samples, at most 3 rad/s) on the road plane, so a
 *  turning car keeps turning through a data gap instead of drifting straight; pitch and roll hold. */
export function interpolateVehicle(list,time,out,radius,maxLag=.05){
 let a=list.at(-2)||list[0],b=list.at(-1);for(let i=1;i<list.length;i++)if(list[i].time>=time){a=list[i-1];b=list[i];break;}if(!a||!b)return out;
 const duration=(b.time-a.time)/1000,u=duration>0?Math.max(0,Math.min(1,(time-a.time)/(duration*1000))):1,lag=Math.max(0,Math.min(maxLag,(time-b.time)/1000));
 out.v=b.v;out.steering=lerp(a.steering,b.steering,u);out.mode=b.mode;out.driver=b.driver;out.col=b.col;out.k=b.k;
 if(lag){
  const rate=duration>.004?Math.max(-3,Math.min(3,angle(a.yaw,b.yaw)/duration)):0,turn=rate*lag,c=Math.cos(turn),s=Math.sin(turn);
  const S=Math.abs(rate)>1e-6?s/rate:lag,C=Math.abs(rate)>1e-6?(1-c)/rate:0,dx=b.vx*S+b.vz*C,dz=-b.vx*C+b.vz*S;
  out.x=b.x+dx;out.y=b.y+b.vy*lag;out.z=b.z+dz;out.vx=b.vx*c+b.vz*s;out.vy=b.vy;out.vz=-b.vx*s+b.vz*c;out.yaw=b.yaw+turn;
  qb.set(b.rotation.x,b.rotation.y,b.rotation.z,b.rotation.w).premultiply(qa.setFromAxisAngle(UP,turn));Object.assign(out.rotation,{x:qb.x,y:qb.y,z:qb.z,w:qb.w});
  for(let i=0;i<4;i++){const bw=b.wheels[i],w=out.wheels[i];w.spin=bw.spin+b.v/radius*lag;w.suspensionLength=bw.suspensionLength;w.contact=bw.contact;w.slip=bw.slip||0;
   if(bw.point&&bw.normal){w.point??={x:0,y:0,z:0};w.normal??={x:0,y:1,z:0};const ox=bw.point.x-b.x,oz=bw.point.z-b.z,n=Math.hypot(bw.normal.x,bw.normal.y,bw.normal.z)||1;
    w.point.x=out.x+ox*c+oz*s;w.point.y=bw.point.y+b.vy*lag;w.point.z=out.z-ox*s+oz*c;w.normal.x=(bw.normal.x*c+bw.normal.z*s)/n;w.normal.y=bw.normal.y/n;w.normal.z=(-bw.normal.x*s+bw.normal.z*c)/n;
   }else{w.point=null;w.normal=null;}
  }return out;
 }
 const u2=u*u,u3=u2*u,h0=2*u3-3*u2+1,h1=u3-2*u2+u,h2=-2*u3+3*u2,h3=u3-u2;
 for(const [axis,velocity]of [['x','vx'],['y','vy'],['z','vz']]){out[axis]=duration>0?a[axis]*h0+a[velocity]*duration*h1+b[axis]*h2+b[velocity]*duration*h3:b[axis];out[velocity]=lerp(a[velocity]||0,b[velocity]||0,u);}
 out.yaw=a.yaw+angle(a.yaw,b.yaw)*u;
 qa.set(a.rotation.x,a.rotation.y,a.rotation.z,a.rotation.w);qb.set(b.rotation.x,b.rotation.y,b.rotation.z,b.rotation.w);qa.slerp(qb,u);Object.assign(out.rotation,{x:qa.x,y:qa.y,z:qa.z,w:qa.w});
 for(let i=0;i<4;i++){const aw=a.wheels[i],bw=b.wheels[i],w=out.wheels[i];w.spin=lerp(aw.spin,bw.spin,u);w.suspensionLength=lerp(aw.suspensionLength,bw.suspensionLength,u);w.contact=bw.contact;w.slip=lerp(aw.slip||0,bw.slip||0,u);
  if(bw.point&&bw.normal){w.point??={x:0,y:0,z:0};w.normal??={x:0,y:1,z:0};for(const k of ['x','y','z']){w.point[k]=aw.point?lerp(aw.point[k],bw.point[k],u):bw.point[k];w.normal[k]=aw.normal?lerp(aw.normal[k],bw.normal[k],u):bw.normal[k];}const n=Math.hypot(w.normal.x,w.normal.y,w.normal.z)||1;for(const k of ['x','y','z'])w.normal[k]/=n;
  }else{w.point=null;w.normal=null;}
 }return out;
}
// Own-car interpolation delay (ms): measured once per drawn frame as how far the clock is past the newest own-car
// sample, so a slow link interpolates instead of extrapolating. Frames that themselves took over 50ms are main-thread
// stalls a delay cannot hide and are not measured. Never below the original 35ms; rises at most 0.5ms, falls 0.1ms/frame.
// Other cars use the same rule with a 100-250ms range over a longer window (every: re-rank only every Nth sample;
// fall: ms per frame it may shrink).
export class OwnCarDelay{
 constructor({min=35,max=150,margin=6,window=120,every=1,fall=.1}={}){Object.assign(this,{min,max,margin,window,every,fall});this.reset();}
 reset(){this.value=this.min;this.goal=this.min;this.needs=[];this.n=0;}
 frame(need,gap=0){if(Number.isFinite(need)&&!(gap>50)){this.needs.push(need);if(this.needs.length>this.window)this.needs.shift();
   if(this.needs.length>=30&&++this.n%this.every===0){const sorted=[...this.needs].sort((x,y)=>x-y);this.goal=Math.max(this.min,Math.min(this.max,sorted[Math.floor(sorted.length*.95)]+this.margin));}}
  this.value+=Math.max(-this.fall,Math.min(.5,this.goal-this.value));return this.value;}
}
/** Keeps a drawn car continuous when its data jumps (fresh samples after dead reckoning through a gap): the jump in
 *  position and heading becomes an offset that fades with a 0.15 s time constant, so the car glides to its true spot
 *  instead of snapping. Ordinary frame-to-frame motion is not touched; moves over 8 m (a respawn) still snap.
 *  st is per-car state ({} to start); now in ms. */
export function smoothJumps(st,out,now){
 const r=out.rotation;
 if(st.t!=null&&now-st.t<=250){   // after a longer pause (hidden tab) just start fresh
  const dt=Math.max(0,(now-st.t)/1000),k=Math.exp(-dt/.15);
  const jx=st.px+st.vx*dt-out.x,jy=st.py+st.vy*dt-out.y,jz=st.pz+st.vz*dt-out.z,jump=Math.hypot(jx,jy,jz);
  qa.set(r.x,r.y,r.z,r.w);qb.set(st.qx,st.qy,st.qz,st.qw);const turn=2*Math.acos(Math.min(1,Math.abs(qa.dot(qb))));
  st.ex*=k;st.ey*=k;st.ez*=k;qe.set(st.ex2,st.ey2,st.ez2,st.ew2).slerp(QI,1-k);
  if(jump>8){st.ex=st.ey=st.ez=0;qe.identity();}
  else if(jump>Math.max(.05,.25*Math.hypot(st.vx,st.vz)*dt)||turn>.15){st.ex+=jx;st.ey+=jy;st.ez+=jz;qe.multiply(qb.multiply(qa.invert()));}
  const sg=qe.w<0?-1:1;st.ex2=qe.x*sg;st.ey2=qe.y*sg;st.ez2=qe.z*sg;st.ew2=qe.w*sg;
 }else{st.ex=st.ey=st.ez=st.ex2=st.ey2=st.ez2=0;st.ew2=1;}
 st.px=out.x;st.py=out.y;st.pz=out.z;st.vx=out.vx||0;st.vy=out.vy||0;st.vz=out.vz||0;st.qx=r.x;st.qy=r.y;st.qz=r.z;st.qw=r.w;st.t=now;
 const offset=Math.abs(st.ex)+Math.abs(st.ey)+Math.abs(st.ez)>=1e-3,tilt=st.ew2<.99999;
 if(!offset){st.ex=st.ey=st.ez=0;}
 if(!tilt){st.ex2=st.ey2=st.ez2=0;st.ew2=1;}
 if(!offset&&!tilt)return out;
 qe.set(st.ex2,st.ey2,st.ez2,st.ew2);
 for(const w of out.wheels||[])if(w.point){
  // wheels follow the body: rotate their offset from the car's centre by the heading correction, then shift
  v3.set(w.point.x-out.x,w.point.y-out.y,w.point.z-out.z).applyQuaternion(qe);w.point.x=out.x+v3.x+st.ex;w.point.y=out.y+v3.y+st.ey;w.point.z=out.z+v3.z+st.ez;
  if(w.normal){v3.set(w.normal.x,w.normal.y,w.normal.z).applyQuaternion(qe);w.normal.x=v3.x;w.normal.y=v3.y;w.normal.z=v3.z;}
 }
 out.x+=st.ex;out.y+=st.ey;out.z+=st.ez;
 if(tilt){qa.set(r.x,r.y,r.z,r.w).premultiply(qe);r.x=qa.x;r.y=qa.y;r.z=qa.z;r.w=qa.w;out.yaw+=2*Math.atan2(qe.y,qe.w);}
 return out;
}
// Align the actual tire cylinder's support plane, not a guessed global road height.
export function groundVehicleWheel(matrix,state,radius,halfWidth,clearance=.002){
 if(!state?.contact||!state.point||!state.normal)return matrix;const e=matrix.elements,n=state.normal,p=state.point,length=Math.hypot(n.x,n.y,n.z);if(length<.5)return matrix;
 const x=n.x/length,y=n.y/length,z=n.z/length,nx=x*e[0]+y*e[1]+z*e[2],ny=x*e[4]+y*e[5]+z*e[6],nz=x*e[8]+y*e[9]+z*e[10];
 const support=halfWidth*Math.abs(nx)+radius*Math.hypot(ny,nz),delta=x*p.x+y*p.y+z*p.z+support+clearance-(x*e[12]+y*e[13]+z*e[14]);
 e[12]+=x*delta;e[13]+=y*delta;e[14]+=z*delta;return matrix;
}
