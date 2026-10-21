// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Authoritative ambient traffic using Next's existing straight lanes, following and signal rules; on an island world
// (WP4.5) also along the roads beyond the city (shared/lane-graph.js): city lanes that reach a road's start at the
// city edge carry on onto it, and cars come back in the same way; junctions are taken one conflicting move at a time.
import {makeGrid} from './city.js';
import {sigLight} from './constants.js';
import {signalFor,sectionOf} from './road-kit.js';
import {cityRoadSet} from './city-roads.js';
import {RNG} from './rng.js';
import {Island} from './terrain.js';
import {buildLaneGraph,connectorPoints,curveSpeed,PathLane} from './lane-graph.js';
import {DEFAULT_ROAD_PROFILES} from './roads.js';
import {VEHICLE_KINDS as K, VEHICLE_BODY_COLORS as BODY, VEHICLE_BUS_COLORS as BUS} from './vehicle-specs.js';
const STOP=11.7,GAP=2.4,OFFSETS=[1.85,5],SUM=K.reduce((n,k)=>n+k.p,0);
/** The city's lane centres and stop lines (m): the avenue's own lanes and the road kit's stop bars once the grid is widened
 *  to it (shared/city-roads.js), else today's 14 m street. */
export function cityLanes(grid){const set=cityRoadSet(grid);return set?{offsets:sectionOf(set.profiles['avenue-4']).lanes.map(l=>l.o),stop:set.stopAt}:{offsets:OFFSETS,stop:STOP};}
// Roads beyond the city: a car per this many metres of lane at full density, at most ISLAND_MAX; braking for junctions.
const ISLAND_SPACING=300,ISLAND_MAX=200,DECEL=2.5,PORTAL_NEAR=8,OBSTACLE_LOOK=45,OBSTACLE_HALF=1.1,CITY_LIMIT=DEFAULT_ROAD_PROFILES['avenue-4'].speedLimit;
export function trafficDensity(h){const day=h>6.5&&h<21.5?1:0,g=(c,w)=>Math.exp(-(((h-c)/w)**2));return Math.min(1,.14+.3*day+.42*g(8.4,1.3)+.48*g(17.7,1.6)+.1*g(12.5,1.5));}
export class VehicleTraffic {
 constructor(world,{seed='traffic',nextId=1,max=330}={}){
  this.g=makeGrid(world.grid);this.rng=new RNG(seed);this.nextId=nextId;this.max=max;this.lanes=[];this.all=new Map();
  this.city=cityLanes(world.grid);
  if(!this.g.empty){   // (no city: only the roads' lanes)
   for(let i=0;i<=this.g.nx;i++)for(const d of [1,-1])for(const o of this.city.offsets)this.addLane(0,d,i,o);
   for(let j=0;j<=this.g.nz;j++)for(const d of [1,-1])for(const o of this.city.offsets)this.addLane(1,d,j,o);}
  this.graphLanes=[];this.roadLanes=[];this.roadLen=0;this.islandCount=0;this.stamp=0;
  if(world.terrain&&world.roads?.length)this.addRoads(world);
  this.allLanes=[...this.lanes,...this.graphLanes];
 }
 random(){return this.rng.float();}
 addLane(axis,dir,k,off){const g=this.g,lo=axis===0?g.minZ:g.minX,hi=axis===0?g.maxZ:g.maxX,start=dir>0?lo:hi,stops=[];
  (axis===0?g.Z:g.X).forEach((c,m)=>{const s=dir>0?c-this.city.stop-start:start-c-this.city.stop;if(s>1)stops.push({s,ix:axis===0?m*(g.nx+1)+k:k*(g.nx+1)+m});});stops.sort((a,b)=>a.s-b.s);
  this.lanes.push({axis,dir,fixed:axis===0?g.X[k]-dir*off:g.Z[k]+dir*off,start,len:hi-lo,stops,cars:[],next:[],feeders:[],limit:CITY_LIMIT});
 }
 /** The roads beyond the city changed (an administrator's edit): the cars on them leave, the lanes are rebuilt and fill
  *  again from the city. Returns the ids of the cars that left. */
 setRoads(world){const gone=[];
  for(const l of this.graphLanes)for(const c of l.cars){this.all.delete(c.id);gone.push(c.id);}
  for(const l of this.lanes){l.next=[];l.feeders=[];for(const c of l.cars)c.nextLane=undefined;}
  this.graphLanes=[];this.roadLanes=[];this.roadLen=0;this.islandCount=0;
  if(world.terrain&&world.roads?.length)this.addRoads(world);
  this.allLanes=[...this.lanes,...this.graphLanes];return gone;}
 /** The roads beyond the city and the links between them and the city's lanes at its edge. */
 addRoads(world){
  const island=new Island(world.terrain,{roads:world.roads});if(!island.roads)return;
  // where a road joins the city: at its edge, or (a widened city, shared/city-roads.js) at the centre of the edge
  // street's junction it joins, its lanes starting at that junction's stop bar and obeying its lights
  const g=this.g,set=cityRoadSet(world.grid,world.roads),edge=(x,z,lo0,hi0,lo1,hi1)=>x>=lo0-1&&x<=hi0+1&&z>=lo1-1&&z<=hi1+1&&(Math.abs(x-lo0)<1||Math.abs(x-hi0)<1||Math.abs(z-lo1)<1||Math.abs(z-hi1)<1);
  const onEdge=set?(x,z)=>edge(x,z,g.X[0],g.X.at(-1),g.Z[0],g.Z.at(-1)):(x,z)=>edge(x,z,g.minX,g.maxX,g.minZ,g.maxZ);
  const G=buildLaneGraph(island.roads,{isPortal:onEdge,portalTrim:set?set.stopAt+0.4:undefined});
  if(set)for(const P of G.portals){const J=[...set.plans.values()].find(J=>Math.hypot(J.x-P.x,J.z-P.z)<1);if(!J?.signalized)continue;
   for(const A of P.in){const arm=J.arms.findIndex(a=>a.id===A.road);if(arm>=0)A.signal={plan:J,arm,portal:true};}}
  const near=set?PORTAL_NEAR+g.hr:PORTAL_NEAR;
  this.graphLanes=G.lanes;this.roadLanes=G.roadLanes;this.roadLen=G.roadLanes.reduce((n,l)=>n+l.len,0);
  const ends=l=>{const a=this.cityPose(l,0,{}),b=this.cityPose(l,l.len,{}),h={dx:Math.cos(a.yaw),dz:-Math.sin(a.yaw)};return{start:{x:a.x,y:0,z:a.z,...h},end:{x:b.x,y:0,z:b.z,...h}};};
  for(const P of G.portals){
   const made=[],link=(A,a,B,b,id)=>{const pts=connectorPoints(a,b),C=new PathLane({id,pts,limit:curveSpeed(pts,Math.min(A.limit,B.limit)),junction:`portal@${Math.round(P.x)},${Math.round(P.z)}`,from:A,to:B});A.next.push(C);B.feeders.push(C);made.push(C);this.graphLanes.push(C);};
   for(const l of this.lanes){const e=ends(l);
    // city lanes ending at the portal, heading out: on to each lane leaving it; lanes arriving there: into the city lanes starting at it
    if(Math.hypot(e.end.x-P.x,e.end.z-P.z)<near&&e.end.dx*P.ux+e.end.dz*P.uz>.9)for(const B of P.out)link(l,e.end,B,B.end(false),`${B.id}<city`);
    if(Math.hypot(e.start.x-P.x,e.start.z-P.z)<near&&e.start.dx*P.ux+e.start.dz*P.uz<-.9)for(const A of P.in)link(A,A.end(true),l,e.start,`${A.id}>city`);
   }
   for(let i=0;i<made.length;i++){made[i].conflicts.push(made[i]);for(let k=i+1;k<made.length;k++)if(made[i].to===made[k].to){made[i].conflicts.push(made[k]);made[k].conflicts.push(made[i]);}}
  }
 }
 car(l,s){let x=this.random()*SUM,k=K.length-1;for(let i=0;i<K.length;i++){x-=K[i].p;if(x<0){k=i;break;}}const p=k===5?BUS:BODY;
  const c={id:this.nextId++,k,s,len:K[k].L,v:K[k].v*.8,vmax:K[k].v*(.85+this.random()*.25),col:parseInt(p[(this.random()*p.length)|0].slice(1),16),mode:0,driver:0,lane:l};this.all.set(c.id,c);return c;
 }
 /** Cars wanted on the roads beyond the city at this hour. */
 islandTarget(hour){return Math.round(Math.min(ISLAND_MAX,this.roadLen/ISLAND_SPACING)*trafficDensity(hour));}
 fill(hour){const spacing=this.lanes.reduce((n,l)=>n+l.len,0)/Math.max(1,Math.round(this.max*trafficDensity(hour)));for(const l of this.lanes){let s=l.len-this.random()*spacing;while(s>0&&this.all.size<this.max){const c=this.car(l,s);l.cars.push(c);s-=c.len+GAP+spacing*(.3+this.random()*1.4);}}
  const want=this.islandTarget(hour);if(!want)return;const gap=this.roadLen/want;
  for(const l of this.roadLanes){let s=l.len-this.random()*gap;while(s>0&&this.islandCount<want){const c=this.car(l,s);l.cars.push(c);this.islandCount++;s-=c.len+GAP+gap*(.5+this.random());}}
 }
 /** Let go of a car's junction commitments (it leaves the road network or is taken over by a driver). */
 release(c){if(c.nextLane?.reserved)c.nextLane.reserved.delete(c.id);if(c.lane?.reserved)c.lane.reserved.delete(c.id);c.nextLane=undefined;}
 remove(c){if(c.lane){c.lane.cars=c.lane.cars.filter(x=>x!==c);if(c.lane.graph)this.islandCount--;}this.release(c);this.all.delete(c.id);}
 detach(c){if(c.lane){c.lane.cars=c.lane.cars.filter(x=>x!==c);if(c.lane.graph)this.islandCount--;}this.release(c);c.lane=null;}
 cityPose(l,s,c){const a=l.start+l.dir*s;c.x=l.axis===0?l.fixed:a;c.z=l.axis===0?a:l.fixed;c.y=0;c.yaw=l.axis===0?(l.dir>0?-Math.PI/2:Math.PI/2):(l.dir>0?0:Math.PI);return c;}
 pose(c){if(c.mode!==0)return c;const l=c.lane;return l.graph?l.at(c.s,c):this.cityPose(l,c.s,c);}
 /** Where a car goes at the end of its lane: a city lane at a portal carries on onto the roads beyond while they want
  *  more cars; on those roads, any of the moves the junction allows. Null: the car leaves at the city's edge. */
 choose(l,c,islandWant){const N=l.next;if(!N.length)return null;
  if(!l.graph&&(this.islandCount>=islandWant||this.random()>=.85))return null;
  return N[(this.random()*N.length)|0];}
 speed(c,l){return l.graph?Math.min(l.limit*(c.vmax/K[c.k].v)*(c.k===5?.8:1),l.limit*1.05):c.vmax;}
 /** One step. `obstacles`: what traffic must not drive into ({ x, z, len }: cars people drive, people on foot); a car
  *  slows and stops for one ahead of it in its own lane. */
 step(dt,t,hour,obstacles=[]){const stamp=++this.stamp,islandWant=this.graphLanes.length?this.islandTarget(hour):0;
  for(const l of this.allLanes){const C=l.cars;for(let n=0;n<C.length;n++){const c=C[n];if(c.stepped===stamp)continue;c.stepped=stamp;const front=c.s+c.len/2;let gap=1e9,cap=Infinity;
   if(n>0){const a=C[n-1];gap=a.s-a.len/2-front-GAP;}
   if(l.stops)for(const st of l.stops){if(st.s<front-.4)continue;const d=st.s-front;if(d>60)break;const lt=sigLight(st.ix,t,l.axis);if(lt===2)break;if(lt===1&&d<c.v*c.v/6+.5)break;gap=Math.min(gap,d-.1);break;}
   // the end of the lane: look into the next one; a junction is entered only when committed to (free when reached)
   if(n===0&&l.next.length){if(c.nextLane===undefined)c.nextLane=this.choose(l,c,islandWant);const N=c.nextLane;
    if(N){const toEnd=l.len-c.s;
     // a signalled junction (shared/road-kit.js): green any move, the arrow only left turns, amber only if it can't stop
     let go=true;if(l.signal&&N.kind==='path'&&!N.reserved.has(c.id)){const lt=signalFor(l.signal.plan,l.signal.arm,t);go=lt===2||(lt===3&&N.turn==='left')||(lt===1&&l.len-front<c.v*c.v/6+.5);}
     // a stop sign: stop at the bar (nearly still, within a few metres of the lane's end), then go when the way is free
     if(l.stopSign&&N.kind==='path'&&!N.reserved.has(c.id)&&c.stopped!==l.id){go=false;if(c.v<.35&&l.len-front<4)c.stopped=l.id;}
     if(go&&N.kind==='path'&&!N.reserved.has(c.id)&&toEnd<=c.v*c.v/(2*DECEL)+c.len/2+4&&N.free(c))N.reserved.add(c.id);
     if(N.kind==='path'&&!N.reserved.has(c.id))gap=Math.min(gap,l.len-front-.5);
     else{const r=N.cars.at(-1);if(r)gap=Math.min(gap,l.len-front+r.s-r.len/2-GAP);}
     cap=Math.sqrt(N.limit*N.limit+2*DECEL*Math.max(0,toEnd));}}
   if(obstacles.length&&c.x!==undefined){const fx=Math.cos(c.yaw),fz=-Math.sin(c.yaw);
    // An obstacle (as a circle of its half length) counts when all of it is ahead of this car's front and it reaches into
    // this car's lane; something already beside it (pushing in from the side at a junction) doesn't stop it there,
    // so the two never wait for each other.
    for(const o of obstacles){const dx=o.x-c.x,dz=o.z-c.z,along=dx*fx+dz*fz,r=o.len/2;if(along-r<c.len/2-.5||along>OBSTACLE_LOOK)continue;
     if(Math.abs(dz*fx-dx*fz)<OBSTACLE_HALF+r*.6)gap=Math.min(gap,along-r-c.len/2-1);}}
   const des=Math.min(this.speed(c,l),cap,Math.sqrt(Math.max(0,6.4*gap))),dv=des-c.v;c.v=Math.max(0,c.v+(dv>0?Math.min(dv,2.4*dt):Math.max(dv,-9*dt)));c.s+=c.v*dt;this.pose(c);
  }
  while(C.length&&(C[0].nextLane?C[0].s>l.len:C[0].s-C[0].len/2>l.len)){const c=C.shift();
   if(c.nextLane)this.moveTo(c,l,c.nextLane,c.s-l.len);else{if(l.graph)this.islandCount--;this.release(c);this.all.delete(c.id);}}}
  if(!this.lanes.length){   // no city to drive in from (a world without one): the roads' cars are topped up where their lanes start
   const want=this.islandTarget(hour);
   for(let tries=0;tries<6&&this.islandCount<want&&this.roadLanes.length;tries++){const l=this.roadLanes[(this.random()*this.roadLanes.length)|0],last=l.cars.at(-1);if((!last||last.s-last.len/2>14)&&(l.feeders||[]).every(f=>!f.cars.length&&!f.reserved?.size)){l.cars.push(this.car(l,0));this.pose(l.cars.at(-1));this.islandCount++;}}
   return;}
  let n=this.all.size-this.islandCount,want=Math.round(this.max*trafficDensity(hour));for(let tries=0;tries<6&&n<want;tries++){const l=this.lanes[(this.random()*this.lanes.length)|0],last=l.cars.at(-1);if((!last||last.s-last.len/2>14)&&l.feeders.every(f=>!f.cars.length&&!f.reserved.size)){l.cars.push(this.car(l,0));this.pose(l.cars.at(-1));n++;}}
 }
 moveTo(c,from,N,s){if(from.reserved)from.reserved.delete(c.id);if(!from.graph&&N.graph)this.islandCount++;else if(from.graph&&!N.graph)this.islandCount--;
  c.lane=N;c.s=s;c.nextLane=undefined;N.cars.push(c);this.pose(c);}
}
