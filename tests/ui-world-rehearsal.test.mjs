// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { activePlanCoverage, detachWorldOnlyConnectedMarkers } from '../tools/lib/ui-world-rehearsal.mjs';
test('world-only UI copies detach only connected authority markers, retaining every resident and all unrelated world/person fields',()=>{
 const original=[{id:'ordinary',vip:false,name:'Citizen',app:{char:'m13'},future:{a:1}},{id:'connected',vip:true,agentId:'ext-2',name:'Synthetic connected resident',app:{char:'f22',gender:'female'},home:{b:7},job:{b:9},desk:{opaque:'keep'},future:{a:2}},{id:'hosted',vip:true,agentId:'fixture-hosted',name:'Hosted fixture'}],before=structuredClone(original),out=detachWorldOnlyConnectedMarkers(original);
 assert.equal(out.detached,1);assert.equal(out.people.length,original.length);assert.deepEqual(original,before);const expected={...before[1],vip:false};delete expected.agentId;assert.deepEqual(out.people[1],expected);assert.strictEqual(out.people[0],original[0]);assert.strictEqual(out.people[2],original[2]);
});
test('plan coverage excludes only public retired tombstones; hidden-anonymous active residents and individual holes stay strict',()=>{
 const state={S:{people:[{v:0,x:0},{v:0,x:1},{v:0,x:0}]},net:{plans:[{id:0},null,{id:2}]}};assert.deepEqual(activePlanCoverage(state),{people:3,active:2,retired:1,plans:2,missing:[]});state.net.plans[2]=null;state.net.plans[1]={old:true};assert.deepEqual(activePlanCoverage(state).missing,[2],'an extra stale tombstone plan must not hide an active resident missing its own plan');
});
test('empty/no-connected copies are unchanged, malformed prefixes do not become authority, and non-array input is refused',()=>{
 for(const people of [[],[{vip:true,agentId:'external-2'}],[{vip:true,agentId:'ext-0'}],[{vip:false,agentId:'ext-2'}]]){const r=detachWorldOnlyConnectedMarkers(people);assert.equal(r.detached,0);assert.deepEqual(r.people,people);}assert.throws(()=>detachWorldOnlyConnectedMarkers(null),TypeError);
});
