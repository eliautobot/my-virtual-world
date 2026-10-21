// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import * as THREE from 'three';

/** Fixed-capacity GPU ring: one draw call, no per-frame mesh allocation.
 * Each ribbon follows actual tire contact points and fades after 90 seconds.
 */
export class VehicleSkidMarks {
 constructor(scene,{capacity=2048,lifetime=90}={}){
  this.capacity=Math.max(16,Math.min(8192,Math.floor(capacity)));this.lifetime=lifetime;this.cursor=0;this.count=0;this.previous=new Map();
  const geometry=new THREE.BufferGeometry();
  this.positions=new Float32Array(this.capacity*18);this.uvs=new Float32Array(this.capacity*12);this.data=new Float32Array(this.capacity*12);this.data.fill(-10000);
  geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('uv',new THREE.BufferAttribute(this.uvs,2));geometry.setAttribute('markData',new THREE.BufferAttribute(this.data,2).setUsage(THREE.DynamicDrawUsage));
  for(let i=0;i<this.capacity;i++)this.uvs.set([0,0,1,0,1,1,0,0,1,1,0,1],i*12);
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,
   uniforms:{now:{value:0},lifetime:{value:lifetime}},
   vertexShader:'attribute vec2 markData; varying vec2 vUv; varying vec2 vData; void main(){vUv=uv;vData=markData;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
   fragmentShader:'uniform float now;uniform float lifetime;varying vec2 vUv;varying vec2 vData;void main(){float age=now-vData.x;float fade=1.0-smoothstep(lifetime*.65,lifetime,age);float edge=smoothstep(0.0,.13,vUv.x)*smoothstep(0.0,.13,1.0-vUv.x);float grooves=.60+.40*step(.18,fract(vUv.x*4.0));float tread=.82+.18*step(.22,fract(vUv.y*6.0+vUv.x*.6));float alpha=vData.y*fade*edge*grooves*tread*.62;if(alpha<.005||age<0.0)discard;gl_FragColor=vec4(.055,.050,.045,alpha);}' });
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.name='vehicleTireMarks';this.mesh.frustumCulled=false;this.mesh.renderOrder=2;scene.add(this.mesh);
 }
 updateVehicle(id,wheels,now,heading=0,width=.20){
  for(let i=0;i<wheels.length;i++){
   const w=wheels[i],key=`${id}:${i}`,point=w.point;
   if(!w.contact||w.slip<.16||!point||!Object.values(point).every(Number.isFinite)){this.previous.delete(key);continue;}
   const current=new THREE.Vector3(point.x,point.y+.015,point.z),previous=this.previous.get(key);
   if(!previous){const back=current.clone().add(new THREE.Vector3(-Math.cos(heading)*.12,0,Math.sin(heading)*.12));this.add(back,current,w.normal,width,w.slip,now);this.previous.set(key,{point:current,now});continue;}
   const distance=current.distanceTo(previous.point);
   if(distance>2||now-previous.now>.5){this.previous.delete(key);continue;}
   if(distance<.035)continue;
   this.add(previous.point,current,w.normal,width,w.slip,now);this.previous.set(key,{point:current,now});
  }
 }
 add(a,b,normal,width,intensity,now){
  const scratch=this._addScratch||(this._addScratch={direction:new THREE.Vector3(),normal:new THREE.Vector3(),side:new THREE.Vector3(),corners:Array.from({length:4},()=>new THREE.Vector3())});
  const direction=scratch.direction.copy(b).sub(a);if(direction.lengthSq()<1e-8)return;
  const n=normal?scratch.normal.set(normal.x,normal.y,normal.z):scratch.normal.set(0,1,0);
  const side=scratch.side.crossVectors(direction,n).normalize().multiplyScalar(width*.5);
  const corners=scratch.corners;corners[0].copy(a).sub(side);corners[1].copy(a).add(side);corners[2].copy(b).add(side);corners[3].copy(b).sub(side);
  const base=this.cursor*18,db=this.cursor*12;
  for(let j=0;j<6;j++){const corner=corners[j===0||j===3?0:j===1?1:j===5?3:2],p=base+j*3,d=db+j*2;this.positions[p]=corner.x;this.positions[p+1]=corner.y;this.positions[p+2]=corner.z;this.data[d]=now;this.data[d+1]=intensity;}
  this.cursor=(this.cursor+1)%this.capacity;this.count=Math.min(this.capacity,this.count+1);
  this.mesh.geometry.attributes.position.needsUpdate=true;this.mesh.geometry.attributes.markData.needsUpdate=true;
 }
 update(now){this.mesh.material.uniforms.now.value=now;for(const [key,p]of this.previous)if(now-p.now>1)this.previous.delete(key);}
 removeVehicle(id){for(const key of this.previous.keys())if(key.startsWith(`${id}:`))this.previous.delete(key);}
 dispose(){this.previous.clear();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
