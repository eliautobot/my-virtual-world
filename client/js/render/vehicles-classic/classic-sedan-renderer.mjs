// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original, realistically proportioned four-door saloon. Geometry is authored
// in world-sized automotive dimensions, then uniformly converted to the
// traffic model's +X-forward, scale=2, wheel-center-Y=-0.18 convention.
import { getSedanProportions } from './sedan-proportions.mjs';

const caches = new WeakMap();
export const CLASSIC_SEDAN_BUDGET = Object.freeze({ drawCalls: 10, triangles: 30000, templatesPerClass: 6 });
export function usesClassicSedanRenderer(definition) {
  return definition.type === 'car' || definition.type === 'sedan';
}

function buildTemplates(T, definition) {
  const dims = getSedanProportions(definition.type);
  const factor = dims.factor;
  const datum = 0.36 + dims.wheelDiameter / 2;
  const bodyMap = p => [p[0] * factor / 2, (p[1] * factor - datum) / 2, p[2] * factor / 2];
  const wheelMap = p => p.map(v => v * factor / 2);
  const C = { rubber: 0x202327, trim: 0x252c31, seal: 0x171d20, steel: 0xadb4b9, darkSteel: 0x646d73, cabin: 0x3c4144, seat: 0x555859, glass: 0x79939e };
  class Batch {
    constructor(map = bodyMap) { this.map = map; this.p = []; this.n = []; this.c = []; }
    triangle(a, b, c, color = 0xffffff, normals = null) {
      const pts = [a, b, c].map(this.map);
      const ab = new T.Vector3().subVectors(new T.Vector3(...pts[1]), new T.Vector3(...pts[0]));
      const ac = new T.Vector3().subVectors(new T.Vector3(...pts[2]), new T.Vector3(...pts[0]));
      const normal = ab.cross(ac);
      if (normal.lengthSq() < 1e-16) return;
      normal.normalize();
      const col = new T.Color(color);
      for (let i = 0; i < 3; i++) {
        this.p.push(...pts[i]); this.n.push(...(normals?.[i] || normal.toArray()));
        this.c.push(col.r, col.g, col.b);
      }
    }
    face(points, outward, color = 0xffffff) {
      let pts = points;
      const a = new T.Vector3(...pts[0]), b = new T.Vector3(...pts[1]), c = new T.Vector3(...pts[2]);
      if (b.sub(a).cross(c.sub(a)).dot(new T.Vector3(...outward)) < 0) pts = [...pts].reverse();
      for (let i = 1; i < pts.length - 1; i++) this.triangle(pts[0], pts[i], pts[i + 1], color);
    }
    geometry(geometry, color = 0xffffff, matrix = new T.Matrix4()) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.applyMatrix4(matrix);
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i += 3) {
        const points = [0, 1, 2].map(j => [p.getX(i+j), p.getY(i+j), p.getZ(i+j)]);
        const normals = n ? [0, 1, 2].map(j => [n.getX(i+j), n.getY(i+j), n.getZ(i+j)]) : null;
        this.triangle(...points, color, normals);
      }
      g.dispose(); geometry.dispose();
    }
    box(x, y, z, width, height, depth, color = 0xffffff, rotation = null) {
      const q = rotation ? new T.Quaternion().setFromEuler(new T.Euler(...rotation)) : new T.Quaternion();
      this.geometry(new T.BoxGeometry(width, height, depth), color,
        new T.Matrix4().compose(new T.Vector3(x,y,z), q, new T.Vector3(1,1,1)));
    }
    bar(a, b, radius, color = 0xffffff, segments = 6) {
      const start = new T.Vector3(...a), end = new T.Vector3(...b), delta = end.clone().sub(start);
      this.geometry(new T.CylinderGeometry(radius, radius, delta.length(), segments), color,
        new T.Matrix4().compose(start.add(end).multiplyScalar(.5),
          new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0), delta.normalize()), new T.Vector3(1,1,1)));
    }
    finish() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      g.userData.classicSedanShared = true;
      return g;
    }
  }
  const paint = new Batch(), structure = new Batch(), details = new Batch(), interior = new Batch(), glass = new Batch(), wheel = new Batch(wheelMap);

  // Joined body sections: a closed sill/floor and inset wheel housings support
  // continuous shoulder panels. The cabin opening is NOT covered by a hood box.
  const stations = [
    [-2.23,.825,.79], [-2.08,.88,.85], [-1.58,.925,.88],
    [-1.40,.94,.89], [-.60,.945,.89], [.80,.945,.89],
    [1.44,.885,.88], [2.09,.847,.845], [2.23,.835,.79],
  ];
  function sectionAt(x) {
    for (let i = 1; i < stations.length; i++) if (x <= stations[i][0]) {
      const a = stations[i-1], b = stations[i], t = (x-a[0])/(b[0]-a[0]);
      return [a[1]+t*(b[1]-a[1]), a[2]+t*(b[2]-a[2])];
    }
    return stations.at(-1).slice(1);
  }
  const axles = [-1.32, 1.34], radius = .31, aperture = .35, sill = .20;
  const stops = [...stations.map(s=>s[0]), -1.40, .80];
  for (const x of axles) {
    for (let i = 0; i <= 28; i++) stops.push(x+aperture*Math.cos(i*Math.PI/28));
    stops.push(x-aperture-.00001, x+aperture+.00001);
  }
  stops.sort((a,b)=>a-b);
  const xs = stops.filter((x,i)=>x>=-2.23&&x<=2.23&&(i===0||x-stops[i-1]>1e-7));
  const bottom = x => Math.max(sill, ...axles.map(cx=>Math.abs(x-cx)<=aperture
    ? radius+Math.sqrt(Math.max(0,aperture**2-(x-cx)**2)) : sill));
  const bodyZ = (x,y) => {
    const [top,w] = sectionAt(x);
    if (y >= top-.045) return w-.035+(top-y)/.045*.035;
    return w-.035*Math.max(0,Math.min(1,(top-.23-y)/.5));
  };
  for (let i = 1; i < xs.length; i++) {
    const x0=xs[i-1], x1=xs[i], [y0,w0]=sectionAt(x0), [y1,w1]=sectionAt(x1);
    const cabin = (x0+x1)/2 > -1.40 && (x0+x1)/2 < .80;
    for (const side of [-1,1]) {
      const rows = (x,y,w) => {
        const lo=bottom(x), mid=Math.max(lo,y-.22);
        return [[x,y,side*(w-.035)],[x,y-.045,side*w],[x,mid,side*bodyZ(x,mid)],[x,lo,side*bodyZ(x,lo)]];
      };
      const a=rows(x0,y0,w0), b=rows(x1,y1,w1);
      for(let j=0;j<3;j++) paint.face([a[j],b[j],b[j+1],a[j+1]],[0,0,side]);
      // Thickness, floor return and inward wheel housings eliminate the hollow
      // shell visible from low road cameras or across a wheel arch.
      structure.face([a[3],b[3],[x1,bottom(x1),side*.605],[x0,bottom(x0),side*.605]],[0,-1,side*.2],C.rubber);
      if(cabin) {
        paint.face([[x0,y0,side*(w0-.035)],[x1,y1,side*(w1-.035)],[x1,y1,side*.77],[x0,y0,side*.77]],[0,1,0]);
        interior.face([[x0,y0,side*.77],[x1,y1,side*.77],[x1,.32,side*.745],[x0,.32,side*.745]],[0,0,-side],C.cabin);
      } else {
        paint.face([[x0,y0,side*(w0-.035)],[x1,y1,side*(w1-.035)],[x1,y1+.012,0],[x0,y0+.012,0]],[0,1,0]);
      }
    }
  }
  for(const end of [-1,1]) {
    const x=end*2.23,[y,w]=sectionAt(x);
    paint.face([[x,sill,-w+.035],[x,sill,w-.035],[x,y-.045,w],[x,y,w-.035],[x,y+.012,0],[x,y,-w+.035],[x,y-.045,-w]],[end,0,0]);
  }
  structure.box(0,.245,0,4.40,.09,1.21,C.rubber);
  interior.box(-.30,.355,0,2.19,.07,1.49,C.cabin);
  interior.box(-.28,.425,0,1.90,.13,.20,C.trim);
  for(const cx of axles) for(const side of [-1,1]) {
    for(let i=0;i<28;i++) {
      const a=i*Math.PI/28,b=(i+1)*Math.PI/28;
      const p=(angle,r,z)=>[cx+r*Math.cos(angle),radius+r*Math.sin(angle),side*z];
      // Flush 12 mm rolled lip follows the panel, not a detached curved strip.
      const za=bodyZ(cx+aperture*Math.cos(a),radius+aperture*Math.sin(a));
      const zb=bodyZ(cx+aperture*Math.cos(b),radius+aperture*Math.sin(b));
      paint.face([p(a,aperture,za+.001),p(b,aperture,zb+.001),p(b,aperture+.012,zb+.001),p(a,aperture+.012,za+.001)],[0,0,side]);
      structure.face([p(a,aperture,za),p(a,aperture,.606),p(b,aperture,.606),p(b,aperture,zb)],[0,-1,0],C.rubber);
      // The far wall of each wheel tub is opaque in both viewing directions.
      const tub=[p(a,aperture,.606),p(b,aperture,.606),[cx,radius,side*.606]];
      structure.face(tub,[0,0,side],C.rubber);
      structure.face(tub,[0,0,-side],C.rubber);
    }
  }

  // Roof and pillars are closed sheet-metal surfaces. Window surrounds meet
  // the same exact outer vertices; no cylinder skeleton or open roof seams.
  const roofSections=[[-.82,1.38,.635],[-.72,1.421,.662],[-.25,1.429,.668],[.18,1.420,.660],[.30,1.39,.650]];
  const roofLower=x=>1.38+(x+.82)/1.12*.01;
  for(let i=1;i<roofSections.length;i++) {
    const a=roofSections[i-1],b=roofSections[i];
    for(const side of [-1,1]) {
      paint.face([[a[0],a[1],side*a[2]],[b[0],b[1],side*b[2]],[b[0],Math.min(1.44,b[1]+.012),0],[a[0],Math.min(1.44,a[1]+.012),0]],[0,1,0]);
      paint.face([[a[0],a[1],side*a[2]],[b[0],b[1],side*b[2]],[b[0],roofLower(b[0]),side*(.635+(b[0]+.82)/1.12*.015)],[a[0],roofLower(a[0]),side*(.635+(a[0]+.82)/1.12*.015)]],[0,0,side]);
    }
  }
  interior.face([[-.80,1.365,-.63],[.28,1.375,-.645],[.28,1.375,.645],[-.80,1.365,.63]],[0,-1,0],0x757675);
  function inset(points, scale) {
    const center=points[0].map((_,i)=>points.reduce((s,p)=>s+p[i],0)/points.length);
    return points.map(p=>p.map((v,i)=>center[i]+(v-center[i])*scale));
  }
  function surround(outer, normal, insetScale=.92) {
    const sealOuter=inset(outer,insetScale), glazing=inset(sealOuter,.965);
    for(let i=0;i<4;i++) {
      const j=(i+1)%4;
      paint.face([outer[i],outer[j],sealOuter[j],sealOuter[i]],normal);
      structure.face([sealOuter[i],sealOuter[j],glazing[j],glazing[i]],normal,C.seal);
      // Interior face closes the thickness behind every painted window frame.
      interior.face([outer[i],outer[j],sealOuter[j],sealOuter[i]],normal.map(v=>-v),C.trim);
    }
    glass.face(glazing,normal,C.glass);
    return glazing;
  }
  surround([[.80,.945,-.77],[.80,.945,.77],[.30,1.39,.65],[.30,1.39,-.65]],[1,1,0],.925);
  surround([[-1.40,.94,.77],[-1.40,.94,-.77],[-.82,1.38,-.635],[-.82,1.38,.635]],[-1,1,0],.91);
  for(const side of [-1,1]) {
    const P=(x,y,z)=>[x,y,side*z];
    const A=P(.80,.945,.77),At=P(.30,1.39,.65),C0=P(-1.40,.94,.77),Ct=P(-.82,1.38,.635);
    const B=P(-.20,.944,.77),Bt=P(-.17,roofLower(-.17),.6437);
    surround([A,At,Bt,B],[0,.12,side],.90);
    surround([B,Bt,Ct,C0],[0,.12,side],.86);
    structure.face([P(-.228,.948,.772),P(-.198,1.383,.647),P(-.142,1.383,.647),P(-.172,.948,.772)],[0,0,side],C.trim);
    // Very shallow pressed door shut lines lie on the actual body skin.
    const seams=[[[.76,.935],[.65,.70],[.65,.245],[-.20,.245],[-.20,.937]],
      [[-.20,.937],[-.20,.245],[-.79,.245],[-.84,.48],[-1.05,.70],[-1.37,.932]]];
    for(const line of seams) for(let i=1;i<line.length;i++) {
      const a=line[i-1],b=line[i];
      details.bar(P(a[0],a[1],bodyZ(a[0],a[1])+.001),P(b[0],b[1],bodyZ(b[0],b[1])+.001),.0028,0x333c42,4);
    }
    for(const x of [-.03,-.93]) {
      details.box(x,.818,side*(bodyZ(x,.818)+.006),.145,.043,.008,C.seal);
      details.box(x,.826,side*(bodyZ(x,.826)+.013),.128,.021,.012,C.steel);
    }
    // Enclosed modest mirror housing, steel reflective back and a short stem.
    structure.bar(P(.66,.985,.785),P(.59,1.005,.863),.018,C.trim);
    const front=[P(.69,.968,.855),P(.69,1.064,.863),P(.66,1.054,.942),P(.66,.970,.953)];
    const back=[P(.50,.968,.855),P(.49,1.054,.863),P(.49,1.045,.934),P(.49,.970,.945)];
    paint.face(front,[1,0,0]); structure.face(back,[-1,0,0],C.seal);
    for(let i=0;i<4;i++) {
      const j=(i+1)%4;
      paint.face([front[i],front[j],back[j],back[i]],[0,i===1?1:i===3?-1:0,i===0?-side:side]);
    }
    details.face(inset(back,.80).map(p=>[p[0]-.003,p[1],p[2]]),[-1,0,0],0xa2b4bb);
    details.box(1.75,.665,side*(bodyZ(1.75,.665)+.006),.075,.034,.011,0xc88632);
  }

  // Full cabin, kept visible when cosmetic LOD is hidden. Four places, two
  // front seats, rear bench, dash, steering wheel, door panels and floor.
  for(const side of [-1,1]) {
    interior.box(-.18,.535,side*.40,.56,.16,.52,C.seat);
    interior.box(-.40,.842,side*.40,.15,.54,.52,C.seat,[0,0,-.13]);
    interior.box(-.43,1.139,side*.40,.14,.17,.26,C.seat);
    interior.box(-.36,.54,side*.735,1.85,.33,.035,C.cabin);
    interior.box(-.08,.72,side*.706,.32,.04,.05,C.trim);
  }
  interior.box(-.94,.55,0,.49,.17,1.34,C.seat);
  interior.box(-1.09,.81,0,.14,.46,1.34,C.seat,[0,0,-.12]);
  for(const z of [-.42,.42]) interior.box(-1.04,1.10,z,.12,.12,.24,C.seat);
  interior.box(.60,.86,0,.36,.18,1.43,C.trim);
  // The driver sits on the left (-z: vehicle forward is +x), as in the US (2026-10-06).
  interior.box(.46,.90,-.40,.10,.11,.32,0x182025);
  interior.bar([.51,.80,-.40],[.35,.926,-.40],.025,C.trim);
  const steeringMatrix=new T.Matrix4().makeRotationY(Math.PI/2);steeringMatrix.setPosition(.35,.948,-.40);
  interior.geometry(new T.TorusGeometry(.125,.012,6,24),C.trim,steeringMatrix);
  for(let i=0;i<3;i++) {
    const a=i*Math.PI*2/3;
    interior.bar([.35,.948,-.40],[.35,.948+Math.cos(a)*.12,-.40+Math.sin(a)*.12],.009,C.trim);
  }
  interior.box(.12,.70,0,.10,.12,.08,C.trim);
  structure.bar([.70,.963,-.61],[.54,1.027,-.16],.006,C.trim);
  structure.bar([.71,.963,.02],[.55,1.027,.56],.006,C.trim);

  // Restrained end details, shaped full-width bumpers and inset lamp units.
  for(const end of [-1,1]) {
    const section=[[-.80,.36],[-.86,.405],[-.86,.51],[-.82,.535],[.82,.535],[.86,.51],[.86,.405],[.80,.36]];
    const a=section.map(([z,y])=>[end*2.19,y,z]),b=section.map(([z,y])=>[end*2.30,y,z]);
    structure.face(b,[end,0,0],C.trim); structure.face(a,[-end,0,0],C.trim);
    for(let i=0;i<section.length;i++) {
      const j=(i+1)%section.length;
      const n=[0,(section[i][1]+section[j][1])/2-.45,(section[i][0]+section[j][0])/2];
      structure.face([a[i],a[j],b[j],b[i]],n,C.trim);
    }
    details.box(end*2.307,.52,0,.008,.014,1.56,C.darkSteel);
    details.box(end*2.313,.44,0,.012,.128,.355,C.seal);
    details.box(end*2.321,.44,0,.010,.105,.327,0xd4d4c8);
  }
  structure.box(2.236,.699,0,.021,.255,1.60,C.seal);
  for(const y of [.579,.822]) details.box(2.253,y,0,.012,.012,1.58,C.steel);
  for(const z of [-.788,.788]) details.box(2.253,.70,z,.012,.25,.012,C.steel);
  for(let i=0;i<8;i++) details.box(2.258,.607+i*.027,0,.012,.008,.86,C.darkSteel);
  for(const side of [-1,1]) {
    const lamp=new T.Matrix4().makeRotationZ(-Math.PI/2);lamp.setPosition(2.260,.708,side*.609);
    details.geometry(new T.CylinderGeometry(.111,.111,.016,32),C.steel,lamp);
    const lens=lamp.clone();lens.setPosition(2.273,.708,side*.609);
    details.geometry(new T.CylinderGeometry(.100,.100,.022,32),0xd8ddd6,lens);
    for(let j=-3;j<=3;j++) {
      const z=j*.021,h=2*Math.sqrt(.095**2-z*z);
      details.box(2.285,.708,side*.609+z,.0018,h,.002,0xaab8b8);
    }
    details.box(2.256,.696,side*.771,.025,.18,.102,0xc9832d);
    details.box(-2.242,.713,side*.613,.026,.172,.365,C.seal);
    details.box(-2.260,.714,side*.578,.018,.143,.25,0x85252b);
    details.box(-2.262,.746,side*.735,.018,.076,.086,0xbf8036);
    details.box(-2.263,.670,side*.735,.018,.052,.086,0xb4b9b2);
    // Narrow bonnet/deck shut lines, not deep black structural gaps.
    for (const [stops,z] of [[[.82,1.44,2.09,2.17],.73],[[-1.43,-1.58,-2.02,-2.10],.72]]) {
      for(let i=1;i<stops.length;i++) {
        const surface=x=>[x,sectionAt(x)[0]+.004,side*z];
        details.bar(surface(stops[i-1]),surface(stops[i]),.0027,0x444e52,4);
      }
    }
  }
  structure.bar([-2.0,.215,-.42],[-2.26,.215,-.42],.032,C.darkSteel,12);

  // 15-inch steel wheels and ordinary road tires. Smooth revolved sidewalls,
  // real vent slots, recessed backing, rim lip, hub cap and five wheel nuts.
  const tireProfile=[[.183,-.096],[.250,-.099],[.285,-.086],[.306,-.057],[.31,-.035],[.31,.035],[.306,.057],[.285,.086],[.250,.099],[.183,.096],[.183,-.096]];
  wheel.geometry(new T.LatheGeometry(tireProfile.map(p=>new T.Vector2(...p)),40),C.rubber);
  wheel.geometry(new T.CylinderGeometry(.178,.178,.172,32),0x383f44);
  for(const side of [-1,1]) {
    const y=side*.099;
    const polar=(r,a,h=y)=>[Math.cos(a)*r,h,Math.sin(a)*r];
    const segments=80;
    for(let i=0;i<segments;i++) {
      const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;
      // Ventilation openings in ten repeated sectors of the pressed steel face.
      for(const [r0,r1,depth,skip] of [[.061,.115,.009,false],[.115,.163,.003,i%8>=2&&i%8<=5],[.163,.187,0,false],[.187,.195,-.004,false]]) {
        if(skip) continue;
        wheel.face([polar(r0,a,y+side*depth),polar(r0,b,y+side*depth),polar(r1,b,y+side*depth),polar(r1,a,y+side*depth)],[0,side,0],C.steel);
      }
    }
    const hub=new T.Matrix4().makeTranslation(0,side*.105,0);
    wheel.geometry(new T.CylinderGeometry(.060,.060,.025,24),C.darkSteel,hub);
    for(let i=0;i<5;i++) {
      const a=i*2*Math.PI/5;
      wheel.geometry(new T.CylinderGeometry(.010,.010,.012,6),C.steel,new T.Matrix4().makeTranslation(Math.cos(a)*.088,side*.115,Math.sin(a)*.088));
    }
  }
  return {paint:paint.finish(),structure:structure.finish(),details:details.finish(),glass:glass.finish(),interior:interior.finish(),wheel:wheel.finish()};
}

export function buildClassicSedan(group, definition, color, details, { THREE, getMat, mergeStaticGroupMeshes }) {
  if(!usesClassicSedanRenderer(definition)) throw new Error('Sedan renderer only supports standard passenger cars');
  let cache=caches.get(THREE);if(!cache){cache=new Map();caches.set(THREE,cache);}
  let templates=cache.get(definition.type);
  if(!templates){templates=buildTemplates(THREE,definition);cache.set(definition.type,templates);}
  const shell=new THREE.Group();shell.name='vehicleShell';group.add(shell);
  const add=(parent,geometry,name,material)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;
    mesh.castShadow=false;mesh.receiveShadow=true;mesh.userData.classicSedanSharedGeometry=true;
    parent.add(mesh);return mesh;
  };
  // Paint highlights and opaque structural surfaces use isolated materials.
  add(shell,templates.paint,'classicSedanPaint',new THREE.MeshPhongMaterial({color,shininess:48,specular:0x454545,flatShading:false}));
  add(shell,templates.structure,'classicSedanStructure',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  add(shell,templates.interior,'classicSedanInterior',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  add(shell,templates.glass,'classicSedanGlass',new THREE.MeshPhongMaterial({color:0x91a7b0,transparent:true,opacity:.52,depthWrite:false,side:THREE.DoubleSide,shininess:85,specular:0x8fabb7}));
  add(details,templates.details,'classicSedanDetails',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  for(const [x,z] of definition.wheels.positions) {
    const mesh=add(group,templates.wheel,'wheel',getMat(0xffffff,{vertexColors:true,flatShading:false}));
    mesh.position.set(x,definition.wheels.centerY,z);mesh.rotation.x=Math.PI/2;
    mesh.userData.vehicleWheelAxle='z';
  }
  mergeStaticGroupMeshes(shell);
  group.scale.setScalar(definition.scale);group.name=`trafficVehicle:${definition.type}`;
  group.userData.vehicleType=definition.type;group.userData.proceduralVoxelModel=true;
  group.userData.classicSedanModel=true;group.userData.sedanRevision='realistic-r2';
  group.userData.sedanDimensions=getSedanProportions(definition.type);
  return definition;
}

// Whole-cache teardown only, not disposal of one deleted traffic-car instance.
export function disposeClassicSedanGeometry(THREE) {
  const cache=caches.get(THREE);if(!cache)return;
  for(const templates of cache.values())for(const geometry of Object.values(templates))geometry.dispose();
  caches.delete(THREE);
}
