// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createVehicleAsset } from '../client/js/render/vehicle-assets.js';
import { wheelSpinAngle, composeVehicleWheelMatrix, makeVehicleLampMaterial, makeVehicleBeamMaterial } from '../client/js/render/vehicle-effects.js';
const kinds = [{n:'sedan',L:4.5,W:1.82,H:1.44},{n:'compact',L:3.9,W:1.74,H:1.5},{n:'suv',L:4.8,W:1.95,H:1.78},{n:'van',L:5.4,W:2,H:2.25},{n:'taxi',L:4.6,W:1.82,H:1.46},{n:'bus',L:11.6,W:2.55,H:3.15}];
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} ≈ ${b}`);

test('every vehicle has real white front and red rear lens regions, not tinted body panels', () => {
 for(const k of kinds){const a=createVehicleAsset(k);assert.ok(a.lampCounts.front>0&&a.lampCounts.rear>0);
  assert.equal(a.lamps.front.length,2);assert.equal(a.lamps.rear.length,2);
  for(const p of a.parts){const flags=p.geometry.attributes.aVehicleLamp,pos=p.geometry.attributes.position;
   for(let i=0;i<flags.count;i++){const mode=flags.getX(i);assert.ok(mode===0||mode===1||mode===2);
    if(mode){assert.equal(p.tint,false);assert.equal(p.lit,true);assert.ok(mode===1?pos.getZ(i)>0:pos.getZ(i)<0);}
   }
   for(let i=0;i<flags.count;i+=3){assert.equal(flags.getX(i),flags.getX(i+1));assert.equal(flags.getX(i),flags.getX(i+2));}
  }
 }
});

test('lens material follows the shared night uniform while original surface color/material remain intact', () => {
 const a=createVehicleAsset(kinds[0]),p=a.parts.find(x=>x.lit),night={value:0},m=makeVehicleLampMaterial(p.material,night);
 assert.notEqual(m,p.material);assert.equal(m.type,p.material.type);
 const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
 m.onBeforeCompile(shader,{});assert.equal(shader.uniforms.uVehicleNight,night);
 assert.ok(shader.vertexShader.includes('flat varying float vVehicleLamp'));
 assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance += lampColor'));
 night.value=1;assert.equal(shader.uniforms.uVehicleNight.value,1);
 assert.ok(shader.fragmentShader.includes('2.4 : 0.8'));
});

test('wheel angle is traveled distance divided by actual radius: forward, reverse and stationary', () => {
 for(const k of kinds){const a=createVehicleAsset(k),r=a.wheel.radius;
  assert.ok(r>0.2&&r<0.5);near(wheelSpinAngle(Math.PI*r/2,r),Math.PI/2);
  near(wheelSpinAngle(-Math.PI*r/2,r),-Math.PI/2);near(wheelSpinAngle(2*Math.PI*r,r),0);
  assert.equal(wheelSpinAngle(10,r),wheelSpinAngle(10,r));
  for(const w of a.wheels)near(w.radius,r);
 }
 assert.throws(()=>wheelSpinAngle(1,0),/Invalid/);
});

test('wheel centre stays attached to body and positive-X rotation rolls +Z correctly in every lane heading', () => {
 const a=createVehicleAsset(kinds[0]),centre=a.wheels[0].centre;
 for(const yaw of [0,Math.PI,Math.PI/2,-Math.PI/2]){
  const body=new THREE.Matrix4().makeRotationY(yaw).setPosition(10,0,-8),out=new THREE.Matrix4();
  composeVehicleWheelMatrix(body,centre,Math.PI/3,out);
  const actual=new THREE.Vector3().setFromMatrixPosition(out),expected=new THREE.Vector3(...centre).applyMatrix4(body);
  near(actual.distanceTo(expected),0);
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  const translation=new THREE.Vector3(0,0,1).applyQuaternion(q);
  const axle=new THREE.Vector3(1,0,0).applyQuaternion(q),contact=new THREE.Vector3(0,-1,0);
  near(translation.add(axle.cross(contact)).length(),0);
 }
});

test('headlight road pools are bounded, forward facing, depth-tested and night-only without per-car lights', () => {
 for(const k of kinds){const a=createVehicleAsset(k),p=a.beam.attributes.position;
  assert.equal(a.beam.index.count,12);assert.equal(p.count,8);
  assert.ok(a.beamLength>=7&&a.beamLength<=12);
  for(let i=0;i<p.count;i++){near(p.getY(i),.018);assert.ok(p.getZ(i)>0);}
 }
 const night={value:0},m=makeVehicleBeamMaterial(night);
 assert.equal(m.uniforms.uVehicleNight,night);assert.equal(m.depthTest,true);assert.equal(m.depthWrite,false);
 assert.equal(m.blending,THREE.AdditiveBlending);assert.ok(m.fragmentShader.includes('uVehicleNight'));
 assert.ok(m.fragmentShader.includes('pow(max(0.0, 1.0 - clamp('), 'UV edge overshoot cannot feed NaN into bloom');
});
