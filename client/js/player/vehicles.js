// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Connection-bound driving presentation. With browser physics (decision A20) this browser simulates its own car and
// sends poses the server validates and relays; otherwise the server simulates it from this browser's controls.
import {bus,S} from '../core/state.js';
import {auth} from '../core/auth.js';
import {decodeVehicles} from '/shared/vehicleproto.js';
import {makeVehicleDraw,interpolateVehicle,OwnCarDelay,smoothJumps} from '/shared/vehicle-presentation.js';
import {VehicleSkidMarks} from '/shared/driving-classic/vehicle-skid-marks.mjs';
import {VEHICLE_ENTRY_SPEED,VEHICLE_ENTRY_RANGE,vehicleEnvelopeDistance} from '/shared/vehicle-specs.js';
import {bodyOffset,packPose,unpackPose} from '/shared/vehicle-world.js';
import {PF_DRIVING} from '/shared/playerproto.js';
import {getLocalSim,preloadDriving,worldChanged,drivePhysicsMode} from './drive-physics.js';
import {LOCAL_STEP} from '/shared/vehicle-local.js';
import {ROAD_TOP} from '../render/island-roads.js';
import {TyreSmoke} from '../render/tyre-smoke.js';
/** Tyre marks on the island's roads lie on the drawn surface, like the cars (render/traffic.js), not ROAD_TOP under it
 *  where the wheels' physics runs (2026-10-05: no marks on the 2-lane roads). The reference module stays as it is. */
function liftedMarks(marks,app){const smoke=new TyreSmoke(app.stage.scene),up=marks.updateVehicle.bind(marks),tick=marks.update.bind(marks);let last=null;
 marks.updateVehicle=(id,wheels,now,yaw)=>{const W=wheels.map(w=>{const p=w&&w.point,g=app.city?.g;if(!p||!app.terrain||!g||(p.x>=g.minX&&p.x<=g.maxX&&p.z>=g.minZ&&p.z<=g.maxZ))return w;return{...w,point:{x:p.x,y:p.y+ROAD_TOP,z:p.z}};});smoke.wheels(id,W,now,yaw);return up(id,W,now,yaw);};
 marks.update=now=>{const dt=last===null?0:Math.min(.1,Math.max(0,now-last));last=now;smoke.update(now,dt);return tick(now);};   // tyre smoke where the tyres spin or slide (render/tyre-smoke.js)
 return marks;}
// Cars streamed around the view: smaller on Medium (phones) and Low, where they are drawn small anyway.
const streamRadius=app=>({high:400,medium:250,low:180})[app.stage?.q?.name]||400;
// Other cars: drawn 100 ms behind the stream, up to 250 ms when frames keep arriving in bursts; through a longer gap
// they keep driving on their last motion for up to 0.5 s, then glide (smoothJumps) to where the fresh data puts them.
const OTHER_DELAY={min:100,max:250,margin:20,window:600,every:10,fall:.25},OTHER_COAST=.5,GAP_WINDOW=5000;
const BRAKE={throttle:0,steer:0,brake:1,handbrake:false},yawQ=y=>({x:0,y:Math.sin(y/2),z:0,w:Math.cos(y/2)});
export class VehicleClient {
 constructor(app){Object.assign(this,{app,byId:new Map(),id:null,pending:null,req:0,seq:0,lastInput:0,inputKey:'',ready:false,rigs:[],version:-1,presentationTime:null,lastWall:null,ownDelay:new OwnCarDelay(),otherDelay:new OwnCarDelay(OTHER_DELAY),fullAt:null,fullTime:null,gaps:[],sim:null,simFor:null,simState:'off',poseSeq:0,sentSteps:0,retryAt:0,people:null,stats:{frames:0,deltas:0,poses:0,corrections:0}});this.marks=liftedMarks(new VehicleSkidMarks(app.stage.scene),app);
  fetch('/shared/vehicle-rigs.json').then(r=>r.json()).then(j=>{this.rigs=j.rigs;}).catch(e=>app.toast('Vehicle data could not load: '+e.message,'bad'));
 }
 get driving(){return this.id?this.byId.get(this.id)?.draw||this.byId.get(this.id)?.latest||null:null;}
 get observedDriver(){const pid=this.app.remote?.me?.pid;if(!pid||this.id)return null;for(const r of this.byId.values())if(r.latest.driver===pid)return r.draw||r.latest;return null;}
 // Server time as the car stream shows it: the freshest frame time plus local time since it arrived (max over 3 s).
 // A busy page only delays frames, so this never runs ahead of the data, unlike a ping-based estimate under load.
 streamNow(){return this.streamOffset==null?this.app.net.realNow()*1000:performance.now()+this.streamOffset;}
 receive(buf){const f=decodeVehicles(buf);if(!f)return;{const now=performance.now(),q=this.clockQ??=[];q.push(now,f.time-now);while(q.length&&now-q[0]>3000)q.splice(0,2);let m=-Infinity;for(let i=1;i<q.length;i+=2)if(q[i]>m)m=q[i];this.streamOffset=m;}const seen=new Set();for(const c of f.cars){seen.add(c.id);let r=this.byId.get(c.id);if(!r){r={samples:[],draw:makeVehicleDraw(c)};this.byId.set(c.id,r);}const last=r.samples.at(-1);if(last&&f.time<last.time)continue;
   r.latest=c;const sample={...c,time:f.time};if(last?.time===f.time)r.samples[r.samples.length-1]=sample;else r.samples.push(sample);if(r.samples.length>10)r.samples.shift();
  }if(!f.partial){const now=performance.now(),g=this.gaps;if(this.fullAt!==null){g.push(now,now-this.fullAt,f.time-this.fullTime);while(g.length&&now-g[0]>GAP_WINDOW)g.splice(0,3);}this.fullAt=now;this.fullTime=f.time;}
  if(!f.partial)for(const id of this.byId.keys())if(!seen.has(id)&&id!==this.id){this.byId.delete(id);this.marks.removeVehicle(id);}this.ready=true;this.stats.frames++;if(f.partial)this.stats.deltas++;
 }
 state(m){if(Number.isInteger(m.version)&&m.version<=this.version)return;if(Number.isInteger(m.version))this.version=m.version;const old=this.id;this.id=m.id||null;
  if(old&&!this.id&&m.point){const r=this.byId.get(old);if(r){r.latest.driver=0;r.latest.mode=2;r.draw.driver=0;r.draw.mode=2;for(const sample of r.samples){sample.driver=0;sample.mode=2;}}} // confirmed release overrides older buffered occupancy, not the pose
  if(this.id!==old||m.status==='resumed'){this.seq=0;this.inputKey='';this.lastInput=0;this.ownDelay.reset();}
  if(this.id!==old||m.status==='resumed'){this.stopSim();if(this.id)this.startSim();}
  if(this.id!==old){if(this.id)this.app.player?.onVehicleEnter?.(this.id);else this.app.player?.onVehicleExit?.(m.point);}this.app.player?.refreshVehicleHud?.();
 }
 result(m){const p=this.pending;if(!p||p.req!==m.req)return;clearTimeout(p.timer);this.pending=null;
  if(m.ok){if(p.op==='enter')this.state({id:m.id});else this.state({id:null,point:m.point});p.resolve(m);}else p.reject(new Error(m.why||'Vehicle action refused'));
 }
 command(op,id){if(this.pending)return Promise.reject(new Error('Waiting for the previous vehicle action to be confirmed'));if(!auth.account||!this.app.net.connected)return Promise.reject(new Error('Sign in and connect before driving'));
  const req=++this.req;return new Promise((resolve,reject)=>{const p={req,op,id,resolve,reject};this.pending=p;p.timer=setTimeout(()=>{if(this.pending!==p)return;p.confirming=true;this.app.net.send({t:'vresync',protocol:3,radius:streamRadius(this.app),req,op,id});this.app.player?.refreshVehicleHud?.();p.timer=setTimeout(()=>{if(this.pending===p)p.reject(new Error('Connection interrupted; waiting for confirmed vehicle status'));},4000);},6000);
   if(!this.app.net.send({t:'vcommand',req,op,id})){clearTimeout(p.timer);this.pending=null;reject(new Error('The vehicle connection is unavailable'));}
  });
 }
 blocked(p,x,z){for(const r of this.byId.values()){const c=r.draw||r.latest,rig=this.rigs[c.k];if(!rig||Math.abs(p.y-c.y)>1.6)continue;const next=vehicleEnvelopeDistance({x,z},c,rig),before=vehicleEnvelopeDistance(p,c,rig);if(next<.26&&!(before<.26&&next>before+1e-5))return true;}return false;}
 enter(c){return this.command('enter',c.id);}
 exit(){return this.command('exit',this.id);}
 nearby(p){if(!this.ready||this.id||!p.active||p.ctx!==-1)return null;let best=null,d=1e9;for(const r of this.byId.values()){const c=r.draw||r.latest,rig=this.rigs[c.k];if(!rig||c.driver||Math.abs(c.v)>VEHICLE_ENTRY_SPEED||Math.abs(p.y-c.y)>1.6)continue;const n=vehicleEnvelopeDistance(p,c,rig);if(n<VEHICLE_ENTRY_RANGE&&n<d){d=n;best=c;}}return best;}
 sendInput(force=false){if(!this.id||!this.app.net.connected||this.simState==='on')return;const p=this.app.player,input=p?.active&&!document.hidden&&!this.pending?p.drivingInput?.():null,controls=input||{throttle:0,steer:0,brake:1,handbrake:false},key=`${controls.throttle},${controls.steer},${controls.brake},${controls.handbrake},${!!controls.boost}`,now=performance.now();if(!force&&key===this.inputKey&&now-this.lastInput<50)return;this.inputKey=key;this.lastInput=now;this.app.net.send({t:'vinput',seq:++this.seq&65535,...controls});}
 neutral(){if(this.id&&this.app.net.connected){this.inputKey='';this.app.net.send({t:'vinput',seq:++this.seq&65535,throttle:0,steer:0,brake:1,handbrake:false});}}
 /** Longest wait between full car frames over the last 5 s (including one still open), in ms, and whether the server
  *  itself sent late (its own timestamps show the gap) or the frames were held up on the way or on this device. */
 carGap(){const now=performance.now(),g=this.gaps;let ms=0,stamp=0;for(let i=0;i<g.length;i+=3)if(now-g[i]<=GAP_WINDOW&&g[i+1]>ms){ms=g[i+1];stamp=g[i+2];}
  if(this.fullAt!==null&&now-this.fullAt>ms){ms=now-this.fullAt;stamp=0;}return{ms,server:ms>0&&stamp>=ms*.8};}
 // frameNow: the frame's own time (requestAnimationFrame's), so the car moves by exactly the time between the frames the
 // screen shows. Timed by when this code happened to run instead, a busy phone moved it 0.7-1.5x the frame's time each
 // frame: the car shook (2026-10-04: "jittery when there's a lot of things in the scene").
 update(frameNow){const wall=Number.isFinite(frameNow)?frameNow:performance.now(),desired=this.streamNow(),gap=this.lastWall===null?0:wall-this.lastWall;this.lastWall=wall;
  if(this.presentationTime===null||gap>500)this.presentationTime=desired;else{const next=this.presentationTime+gap;this.presentationTime=Math.max(this.presentationTime,next+Math.max(-1,Math.min(1,desired-next)));}
  const local=this.stepSim(gap);
  const newest=this.id?this.byId.get(this.id)?.samples.at(-1)?.time:undefined,own=this.ownDelay.frame(newest===undefined?NaN:this.presentationTime-newest,gap),others=this.otherDelay.frame(this.fullTime===null?NaN:this.presentationTime-this.fullTime,gap);const ct=this.app.cam?.target,far=Math.max(120,(this.app.cam?.dist||0)*1.5),fr=this.frameN=(this.frameN||0)+1;for(const r of this.byId.values()){if(local&&r.latest.id===this.id){this.marks.updateVehicle(r.draw.id,r.draw.wheels,wall/1000,r.draw.yaw);continue;}
   if(ct&&r.latest.id!==this.id&&(Math.abs(r.draw.x-ct.x)>far||Math.abs(r.draw.z-ct.z)>far)&&(fr+r.latest.id)%3)continue;   // far cars (a few pixels) every 3rd frame
   const mine=r.latest.id===this.id,t=this.presentationTime-(mine?own:others);interpolateVehicle(r.samples,t,r.draw,this.rigs[r.draw.k]?.wheelRadius||.3,mine?.05:OTHER_COAST);if(!mine)smoothJumps(r.smooth??={},r.draw,wall);if(r.draw.mode!==0)this.marks.updateVehicle(r.draw.id,r.draw.wheels,wall/1000,r.draw.yaw);}
  this.marks.update(wall/1000);this.sendInput();
 }
 list(){return [...this.byId.values()].map(r=>r.draw||r.latest);}
 startSim(){const id=this.id,r=this.byId.get(id),rig=r&&this.rigs[r.latest.k];if(!id||!rig||!S.world||drivePhysicsMode()!=='browser')return;
  this.simState='loading';getLocalSim(S.world).then(sim=>{if(this.id!==id||this.simState!=='loading')return;sim.clearCar();sim.rig=rig;sim.id=String(id);this.sim=sim;this.simFor=id;this.requestSim();})
   .catch(err=>{if(this.simState==='loading')this.simState='off';console.warn('[driving] browser physics unavailable; the server keeps simulating',err);});}
 requestSim(){this.simState='requested';this.retryAt=performance.now()+3000;this.app.net.send({t:'vphysics',mode:'client',id:this.id});}
 stopSim(){this.sim?.clearCar();this.sim=null;this.simFor=null;this.simState='off';this.people=null;}
 physics(m){if(!this.sim||m.id!==this.id||this.simFor!==this.id)return;
  if(m.mode==='client'){const s=unpackPose(m.state);if(!s)return;this.sim.place(s);this.simState='on';this.sentSteps=this.sim.steps;this.inputKey='';this.poseBase=null;}
  // (taken back after a silence - a stall or a slow network - this browser asks again at once; after refused poses, soon)
  else{this.simState='off';this.retryAt=performance.now()+(m.why==='invalid'?3000:m.why==='timeout'?250:1500);this.inputKey='';}}
 correct(m){if(this.simState!=='on'||m.id!==this.id)return;const s=unpackPose(m.state);if(s){this.sim.place(s);this.stats.corrections++;}}
 /** Advance this browser's own car; true while it, not the server stream, is what gets drawn. */
 stepSim(gapMs){const now=performance.now();
  if(this.sim&&this.simFor===this.id&&this.app.net.connected&&!document.hidden&&this.app.player?.active&&!this.pending&&now>this.retryAt&&(this.simState==='off'||this.simState==='requested'))this.requestSim();
  if(this.simState!=='on'||!this.sim||this.simFor!==this.id)return false;
  const p=this.app.player,input=p?.active&&!document.hidden&&!this.blurred&&!this.pending?p.drivingInput?.():null;
  this.sim.advance(gapMs/1000,input||BRAKE,sim=>this.syncObstacles(sim));
  const r=this.byId.get(this.id);if(r)this.sim.draw(r.draw);
  if(this.sim.steps-this.sentSteps>=2&&this.app.net.connected){this.sentSteps=this.sim.steps;this.stats.poses++;
   this.app.net.send({t:'vpose',s:++this.poseSeq&65535,ts:this.poseTime(),...packPose(this.sim.cur)});}
  return true;}
 /** A pose's time: the server time of its simulated step - a start estimated from the car stream, then the steps simulated
  *  since, so it only moves on as the car does. Taken from the stream's clock estimate each time, it went back whenever
  *  that estimate's best sample aged out; the server refuses a pose older than the last, snapping the car back, and five
  *  in two seconds handed the car to the server (2026-10-04). Moved forward (never back) after long stalls. */
 poseTime(){const est=this.streamNow()-this.sim.acc*1000,steps=this.sim.steps*LOCAL_STEP*1000;
  if(this.poseBase==null||est-(this.poseBase+steps)>300)this.poseBase=est-steps;return this.poseBase+steps;}
 /** Other cars as drawn here, and people outside within 25 m, become obstacles in this browser's simulation. */
 syncObstacles(sim){const me=sim.cur,list=[];
  for(const r of this.byId.values()){const c=r.draw;if(c.id===this.id||Math.abs(c.x-me.x)>60||Math.abs(c.z-me.z)>60)continue;const rig=this.rigs[c.k];if(!rig)continue;
   const q=c.rotation||yawQ(c.yaw),o=bodyOffset(q,rig.height/2+.18);list.push({key:'c'+c.id,kind:'car',x:c.x+o.x,y:(c.y||0)+o.y,z:c.z+o.z,rotation:q,hl:rig.halfLength,hh:rig.height/2,hw:rig.halfWidth});}
  const A=this.app.agents;if(A){if(!this.people||sim.steps%6===0){this.people=[];for(let i=0;i<A.n;i++)if(A.ctx[i]===-1&&Math.abs(A.rx[i]-me.x)<25&&Math.abs(A.rz[i]-me.z)<25)this.people.push(i);}
   for(const i of this.people)list.push({key:'a'+i,kind:'person',x:A.rx[i],y:A.ry[i],z:A.rz[i]});}
  for(const r of this.app.remote?.byPid?.values()||[]){const e=r.extra;if(r.you||r.ctx!==-1||!e||(e.flags&PF_DRIVING)||Math.abs(e.x-me.x)>25||Math.abs(e.z-me.z)>25)continue;list.push({key:'p'+r.pid,kind:'person',x:e.x,y:e.y,z:e.z});}
  sim.setObstacles(list);}
 reset(){this.stopSim();this.clockQ=[];this.streamOffset=null;this.ready=false;this.version=-1;this.presentationTime=null;this.ownDelay.reset();this.otherDelay.reset();this.fullAt=this.fullTime=null;this.gaps=[];this.neutral();if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Vehicle connection changed; waiting for the server'));this.pending=null;}for(const id of this.byId.keys())this.marks.removeVehicle(id);this.byId.clear();}
}
export function init(app){const v=app.driving=new VehicleClient(app);if(app.net.vehicleFrame)v.receive(app.net.vehicleFrame);if(app.net.driveState)v.state(app.net.driveState);
 bus.on('vehicles:frame',b=>v.receive(b));bus.on('msg:vphysics',m=>v.physics(m));bus.on('msg:vcorrect',m=>v.correct(m));bus.on('world',()=>{if(S.world)worldChanged(S.world);});bus.on('mode',m=>{if(m==='play')preloadDriving(S.world);});if(app.player?.active)preloadDriving(S.world);bus.on('msg:drive_result',m=>v.result(m));bus.on('msg:drive_status',m=>v.result(m));bus.on('msg:drive_state',m=>v.state(m));bus.on('preframe',(dt,now)=>v.update(now));
 const sync=()=>app.net.send({t:'vresync',protocol:3,radius:streamRadius(app)});bus.on('net',up=>{if(!up)v.reset();else{v.version=-1;sync();}});if(app.net.connected)sync();
 window.addEventListener('blur',()=>{v.blurred=true;v.neutral();});for(const name of ['focus','keydown','pointerdown'])window.addEventListener(name,()=>{v.blurred=false;},true);document.addEventListener('visibilitychange',()=>{v.presentationTime=null;if(document.hidden)v.neutral();});
}
