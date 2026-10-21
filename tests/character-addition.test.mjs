// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CHARACTERS, LEGACY_CHARACTERS, ADDED_CHARACTERS, defaultChar, sanitizeAppearance, appToArr, arrToAppFull, randomAppearance } from '../shared/appearance.js';
import { RNG } from '../shared/rng.js';
import { TEXTURED } from '../client/assets/chars/index.js';
const assets=new URL('../client/assets/chars/',import.meta.url);
const legacy=[...Array.from({length:12},(_,i)=>'m'+String(i+1).padStart(2,'0')),...Array.from({length:12},(_,i)=>'f'+String(i+1).padStart(2,'0'))];
function originalDefault(a){const list=legacy.filter(c=>(c[0]==='f')===!!a.body);const s=[a.skin,a.hair,a.hairStyle,a.top,a.topStyle,a.bottom,a.bottomStyle,a.shoes,a.height,a.build].join('|');let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return list[(h>>>0)%list.length]}
test('20 models are appended to both rosters without changing24 existing identifiers/kind indices',()=>{
 assert.equal(CHARACTERS.length,44);assert.equal(new Set(CHARACTERS).size,44);assert.deepEqual([...LEGACY_CHARACTERS],legacy);assert.deepEqual(CHARACTERS.slice(0,24),legacy);assert.equal(ADDED_CHARACTERS.length,20);
 assert.equal(TEXTURED.length,44);assert.deepEqual(TEXTURED.slice(0,24),[...legacy.slice(12),...legacy.slice(0,12)]);assert.deepEqual(new Set(TEXTURED),new Set(CHARACTERS));for(const sex of ['m','f'])assert.equal(CHARACTERS.filter(n=>n[0]===sex).length,22);
});
test('existing deterministic defaults and explicit assignments remain stable',()=>{
 for(let i=0;i<2000;i++){const a=randomAppearance(new RNG('unchanged-look:'+i));assert.equal(defaultChar(a),originalDefault(a));assert.equal(a.char,originalDefault(a));for(const name of [legacy[i%24]])assert.equal(sanitizeAppearance({...a,char:name}).char,name);const old=appToArr(a).slice(0,15);assert.equal(arrToAppFull(old).char,originalDefault(a));}
});
test('new male/female selections roundtrip through existing shared appearance/network contracts',()=>{
 for(const char of ADDED_CHARACTERS){const a=sanitizeAppearance({char,body:char[0]==='m'?1:0});assert.equal(a.char,char);assert.equal(a.body,char[0]==='f'?1:0);assert.deepEqual(arrToAppFull(appToArr(a)),a);}
});
test('102 immutable original assets remain byte-exact and original rig calibrations remain exact',()=>{
 const hashes=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-character-assets.json',import.meta.url)));assert.equal(Object.keys(hashes).length,103);
 // rig.json is the explicitly authorized calibration edit, not a rebaked model.
 // Keep its historical hash in the fixture; protect both original profiles by value.
 for(const [file,hash]of Object.entries(hashes)){
  if(file==='rig.json'){
   const rig=JSON.parse(fs.readFileSync(new URL(file,assets)));
   assert.deepEqual(rig.male,{width:0.036,height:0.026,forward:-0.012});
   assert.deepEqual(rig.female,{width:0.02,height:0.026,forward:-0.02});
   continue;
  }
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(file,assets))).digest('hex'),hash,file);
 }
});
test('the added pack uses the compatible65-bone39-clip3LOD contract and valid manifest-declared maps',()=>{
 for(const name of ADDED_CHARACTERS){const m=JSON.parse(fs.readFileSync(new URL(name+'.json',assets)));const bytes=fs.readFileSync(new URL(name+'.bin',assets));assert.equal(m.kind,name);assert.equal(m.bones,65);assert.equal(m.names.length,65);assert.equal(m.clips.length,39);assert.equal(m.lods.length,3);for(const map of [m.baseColor,m.normalMap]){assert.equal(map.split('/').length,1);assert.ok(fs.statSync(new URL(map,assets)).size>0)}for(const l of m.lods){for(const k of ['pos','nrm','j','w','mask','limb','info','cov','idx','uv']){const d=l[k];assert.ok(Number.isInteger(d.off)&&Number.isInteger(d.len)&&d.off>=0&&d.off+d.len<=bytes.length,k)}const d=l.w;for(let i=d.off;i<d.off+d.len;i+=4)assert.equal(bytes[i]+bytes[i+1]+bytes[i+2]+bytes[i+3],255,name)}assert.ok(m.anim.data.off+m.anim.data.len<=bytes.length);}
});
