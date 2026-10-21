// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original high-roof panel van: short bonnet, forward cab, sliding side door,
// opaque load compartment, twin rear doors, bulkhead and a fitted cargo floor.
import {createVehicleMeshTools,authorRoadWheel} from './vehicle-mesh-tools.mjs';
import {authorVehicleLabel} from './vehicle-lettering.mjs';

export function buildVanTemplates(T,dims) {
  const {Batch,wheelMap,frame}=createVehicleMeshTools(T,dims);
  const paint=new Batch(),structure=new Batch(),interior=new Batch(),glass=new Batch(),details=new Batch(),equipment=new Batch(),wheel=new Batch(wheelMap);
  const C={trim:0x293237,rubber:0x22282d,steel:0xaab5b9,cabin:0x404a4e,seat:0x48565b};
  const sections=[[-2.58,1.15,.94],[-2.43,1.15,.98],[-1.65,1.15,.98],[.36,1.15,.98],[1.40,1.158,.975],[2.16,1.17,.94],[2.43,1.01,.89],[2.58,.94,.81]];
  function at(x){for(let i=1;i<sections.length;i++)if(x<=sections[i][0]){const a=sections[i-1],b=sections[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}return sections.at(-1).slice(1);}
  const R=dims.wheelDiameter/2,arch=R+.04,sill=.28,axles=[dims.rearAxle,dims.frontAxle];
  const floor=x=>Math.max(sill,...axles.map(cx=>Math.abs(x-cx)<=arch?R+Math.sqrt(Math.max(0,arch**2-(x-cx)**2)):sill));
  const sideZ=(x,y)=>{const[top,w]=at(x);return y>top-.055?w-.03+(top-y)/.055*.03:w-.045*Math.max(0,Math.min(1,(top-.24-y)/.6));};
  const stops=sections.map(p=>p[0]);for(const cx of axles){for(let i=0;i<=32;i++)stops.push(cx+arch*Math.cos(i*Math.PI/32));stops.push(cx-arch-.00001,cx+arch+.00001);}
  stops.sort((a,b)=>a-b);const xs=stops.filter((x,i)=>x>=-2.58&&x<=2.58&&(i===0||x-stops[i-1]>1e-7));
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i],[ya,wa]=at(a),[yb,wb]=at(b),bonnet=(a+b)/2>2.16;
    for(const side of [-1,1]){
      const row=(x,y,w)=>{const low=floor(x),mid=Math.max(low,y-.22);return[[x,y,side*(w-.03)],[x,y-.055,side*w],[x,mid,side*sideZ(x,mid)],[x,low,side*sideZ(x,low)]];};
      const pa=row(a,ya,wa),pb=row(b,yb,wb);for(let j=0;j<3;j++)paint.face([pa[j],pb[j],pb[j+1],pa[j+1]],[0,0,side]);
      structure.face([pa[3],pb[3],[b,floor(b),side*.66],[a,floor(a),side*.66]],[0,-1,.1*side],C.rubber);
      if(bonnet)paint.face([[a,ya,side*(wa-.03)],[b,yb,side*(wb-.03)],[b,yb+.014,0],[a,ya+.014,0]],[0,1,0]);
      else interior.face([[a,ya,side*(wa-.055)],[b,yb,side*(wb-.055)],[b,Math.max(.47,floor(b)+.02),side*.69],[a,Math.max(.47,floor(a)+.02),side*.69]],[0,0,-side],C.cabin);
    }
  }
  for(const end of [-1,1]){const x=end*2.58,[y,w]=at(x);paint.face([[x,sill,-w+.04],[x,sill,w-.04],[x,y-.055,w],[x,y,w-.03],[x,y+.014,0],[x,y,-w+.03],[x,y-.055,-w]],[end,0,0]);}
  structure.box(0,.335,0,5.16,.11,1.32,C.rubber);
  for(const z of [-.42,.42])structure.box(-.02,.277,z,4.45,.08,.09,0x39464b);
  for(const cx of axles)for(const side of [-1,1])for(let i=0;i<32;i++){
    const a=i*Math.PI/32,b=(i+1)*Math.PI/32,p=(t,r,z)=>[cx+Math.cos(t)*r,R+Math.sin(t)*r,side*z];
    const za=sideZ(cx+Math.cos(a)*arch,R+Math.sin(a)*arch),zb=sideZ(cx+Math.cos(b)*arch,R+Math.sin(b)*arch);
    paint.face([p(a,arch,za+.001),p(b,arch,zb+.001),p(b,arch+.014,zb+.003),p(a,arch+.014,za+.003)],[0,0,side]);
    structure.face([p(a,arch,za),p(a,arch,.665),p(b,arch,.665),p(b,arch,zb)],[0,-1,0],C.rubber);
    const wall=[p(a,arch,.665),p(b,arch,.665),[cx,R,side*.665]];structure.face(wall,[0,0,side],C.rubber);structure.face(wall,[0,0,-side],C.rubber);
  }
  // The full-height cargo shell joins the lower panels and roof along shared
  // coordinates. Interior skins follow the wheel cutouts rather than tires.
  const roof=[[-2.58,2.09,.87],[-2.40,2.17,.93],[-1.20,2.18,.94],[.36,2.17,.925],[.89,2.13,.89],[1.16,2.08,.86]];
  function roofAt(x){for(let i=1;i<roof.length;i++)if(x<=roof[i][0]){const a=roof[i-1],b=roof[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}return roof.at(-1).slice(1);}
  const upperZ=(x,y)=>{const[ry,rz]=roofAt(x),by=at(x)[0],bz=at(x)[1]-.03;return bz+(rz-bz)*(y-by)/(ry-by);};
  for(const side of [-1,1]){
    paint.grid(roof.map(([x,y,z])=>[[x,y,side*z],[x,Math.min(2.20,y+.02),0]]),[0,1,0]);
    for(let i=1;i<roof.length;i++){
      const a=roof[i-1],b=roof[i];
      if(b[0]<=.36){
        const wall=[[a[0],at(a[0])[0],side*(at(a[0])[1]-.03)],[b[0],at(b[0])[0],side*(at(b[0])[1]-.03)],[b[0],b[1],side*b[2]],[a[0],a[1],side*a[2]]];
        paint.face(wall,[0,0,side]);interior.face(wall,[0,0,-side],0x687276);
      }else{
        const lower=(x)=>[x,2.10-(x-.36)/.80*.02,side*(.90-(x-.36)/.80*.04)];
        paint.face([[a[0],a[1],side*a[2]],[b[0],b[1],side*b[2]],lower(b[0]),lower(a[0])],[0,0,side]);
      }
    }
  }
  const rear=[[-2.58,1.15,-.91],[-2.58,1.15,.91],[-2.58,2.09,.87],[-2.58,2.11,0],[-2.58,2.09,-.87]];
  paint.face(rear,[-1,0,0]);interior.face(rear,[1,0,0],0x737b7d);
  paint.face([[1.16,2.08,-.86],[1.16,2.10,0],[1.16,2.08,.86]],[1,0,0]);
  interior.face([[-2.55,2.065,-.85],[1.14,2.057,-.84],[1.14,2.057,.84],[-2.55,2.065,.85]],[0,-1,0],0x909493);
  frame(paint,structure,glass,interior,[[2.16,1.17,-.91],[2.16,1.17,.91],[1.16,2.08,.86],[1.16,2.08,-.86]],[1,1,0],.93);
  for(const side of [-1,1]){
    const P=(x,y,z)=>[x,y,side*z];
    frame(paint,structure,glass,interior,[P(2.16,1.17,.91),P(1.16,2.08,.86),P(.36,2.10,.90),P(.36,1.15,.95)],[0,.08,side],.905);
    const door=[[.36,1.14],[.36,.95],[.36,.70],[.36,.34],[.91,.34],[1.04,.63],[1.22,.91],[2.08,1.143]];
    for(let i=1;i<door.length;i++){const a=door[i-1],b=door[i];details.bar(P(a[0],a[1],sideZ(a[0],a[1])+.002),P(b[0],b[1],sideZ(b[0],b[1])+.002),.003,0x465054,4);}
    details.box(.57,1.046,side*(sideZ(.57,1.046)+.008),.175,.042,.014,C.trim);
    details.box(.57,1.054,side*(sideZ(.57,1.054)+.016),.150,.019,.014,C.steel);
    structure.bar(P(1.54,1.175,.94),P(1.56,1.39,1.09),.024,C.trim,8);
    structure.box(1.56,1.47,side*1.105,.25,.27,.13,C.trim,[0,side*.09,0]);
    details.box(1.427,1.47,side*1.105,.009,.216,.098,0x99adb5,[0,side*.09,0]);
    structure.box(-.05,.55,side*.96,2.08,.145,.035,C.trim);
    structure.box(-2.20,.55,side*.94,.38,.145,.035,C.trim);
    equipment.box(.80,.289,side*.955,.79,.06,.16,0x59696f);
    for(let i=0;i<6;i++)details.box(.48+i*.13,.322,side*.979,.066,.009,.10,0x909b9e);
    // Full sliding-door shut line and an external roller track.
    const slide=[[-1.50,2.055],[.18,2.055],[.18,1.80],[.18,1.45],[.18,1.15],[.18,.93],[.18,.70],[.18,.40],[-1.04,.40],[-1.05,.55],[-1.20,.75],[-1.50,.84],[-1.50,.95],[-1.50,1.15],[-1.50,1.45],[-1.50,1.80],[-1.50,2.055]];
    for(let i=1;i<slide.length;i++){
      const a=slide[i-1],b=slide[i],z=(x,y)=>y>1.15?upperZ(x,y)+.003:sideZ(x,y)+.003;
      details.bar(P(a[0],a[1],z(a[0],a[1])),P(b[0],b[1],z(b[0],b[1])),.003,0x485257,4);
    }
    structure.box(-.87,1.105,side*.974,2.02,.04,.016,C.trim);
    details.box(.02,1.19,side*(upperZ(.02,1.19)+.012),.065,.18,.018,C.trim);
    authorVehicleLabel(equipment,'DELIVERY',{center:[-.69,1.68,side*(upperZ(-.69,1.68)+.006)],height:.13,normal:'z',side:side>0?1:-1,color:0x35464d});
  }
  // Fitted cab, sealed bulkhead, narrow load floor clear of the wheel tubs.
  interior.box(.96,.49,0,1.62,.08,1.35,C.cabin);
  interior.box(-1.24,.47,0,2.62,.07,1.32,0x8e816b);
  interior.box(.13,1.27,0,.047,1.56,1.77,0x727e80);
  for(const z of [-.68,0,.68])interior.box(.105,1.27,z,.045,1.43,.035,0x515f63);
  for(const side of [-1,1]){
    interior.box(.80,.81,side*.44,.64,.19,.57,C.seat);
    interior.box(.50,1.17,side*.44,.16,.70,.57,C.seat,[0,0,-.10]);
    interior.box(.46,1.67,side*.44,.14,.20,.28,C.seat);
    interior.box(1.18,.97,side*.86,1.52,.30,.035,C.cabin);
  }
  interior.box(1.79,1.15,0,.48,.20,1.66,C.trim);
  // The driver sits on the left (-z: vehicle forward is +x), as in the US (2026-10-06).
  interior.box(1.53,1.208,-.44,.12,.11,.36,0x17252c);
  interior.bar([1.65,1.04,-.44],[1.41,1.27,-.44],.029,C.trim);
  const steer=new T.Matrix4().makeRotationY(Math.PI/2);steer.setPosition(1.41,1.30,-.44);interior.geometry(new T.TorusGeometry(.143,.014,6,24),C.trim,steer);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;interior.bar([1.41,1.30,-.44],[1.41,1.30+Math.cos(a)*.14,-.44+Math.sin(a)*.14],.010,C.trim);}
  interior.bar([1.05,.53,0],[1.02,.97,0],.019,C.trim,8);
  // Low cargo crates are inside the van, not painted on exterior panels.
  for(const [x,z,w,h] of [[-.62,-.32,.57,.58],[-1.55,.30,.60,.43],[-1.98,-.28,.48,.38]]){
    interior.box(x,.505+h/2,z,w,h,.55,0x9a8464);
    interior.box(x,.507+h,z,w+.005,.012,.56,0xb2a080);
    interior.box(x,.515+h/2,z,.046,h+.014,.555,0x776749);
  }
  // Functional-looking rear doors with hinges, locks and protected tail lamps.
  for(const side of [-1,1]){
    details.bar([-2.596,.365,side*.022],[-2.596,2.055,side*.022],.003,C.trim,4);
    for(const y of [.67,1.64])details.box(-2.601,y,side*.864,.048,.112,.056,C.steel);
    details.box(-2.602,1.108,side*.16,.027,.12,.054,C.trim);
    structure.box(-2.598,1.006,side*.848,.030,.448,.152,C.trim);
    details.box(-2.619,1.080,side*.848,.019,.265,.125,0x8e3036);
    details.box(-2.620,.882,side*.848,.019,.090,.125,0xb5c1c5);
    details.box(2.594,.810,side*.578,.026,.195,.356,0xc9d2d1);
    details.box(2.597,.805,side*.779,.026,.186,.088,0xc69642);
    for(let i=-2;i<=2;i++)details.box(2.610,.810,side*.578+i*.056,.002,.179,.002,0x95aab2);
  }
  structure.box(2.589,.801,0,.020,.22,1.70,C.trim);
  // Place lamp units ahead of their common housing.
  for(const y of [.70,.906])details.box(2.611,y,0,.008,.010,.79,C.steel);
  for(let i=0;i<6;i++)details.box(2.612,.728+i*.03,0,.009,.006,.76,0x7c8e94);
  for(const end of [-1,1]){
    const ring=[[-.84,.355],[-.94,.395],[-.951,.586],[-.87,.635],[.87,.635],[.951,.586],[.94,.395],[.84,.355]];
    const a=ring.map(([z,y])=>[end*2.52,y,z]),b=ring.map(([z,y])=>[end*2.70,y,z]);structure.face(a,[-end,0,0],C.trim);structure.face(b,[end,0,0],C.trim);
    for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;structure.face([a[i],a[j],b[j],b[i]],[0,(ring[i][1]+ring[j][1])/2-.49,(ring[i][0]+ring[j][0])/2],C.trim);}
    details.box(end*2.708,.46,0,.012,.139,.38,C.rubber);details.box(end*2.718,.46,0,.006,.116,.352,0xc7cbbf);
  }
  structure.bar([-2.35,.265,-.46],[-2.61,.265,-.46],.033,0x7f9096,12);
  // Closed low-profile roof ventilation units mounted through solid bases.
  for(const x of [-1.09,-.31]){
    equipment.geometry(new T.CylinderGeometry(.11,.11,.04,20),C.trim,new T.Matrix4().makeTranslation(x,2.205,0));
    equipment.geometry(new T.CylinderGeometry(.115,.13,.075,20),0x8c989b,new T.Matrix4().makeTranslation(x,2.2475,0));
  }
  structure.bar([1.97,1.346,-.65],[1.72,1.574,-.08],.007,C.trim);
  structure.bar([2.00,1.319,.03],[1.75,1.547,.65],.007,C.trim);
  authorRoadWheel(T,wheel,{radius:R,width:dims.tireWidth,rimRatio:.62});
  return {paint:paint.finish(),structure:structure.finish(),interior:interior.finish(),glass:glass.finish(),details:details.finish(),equipment:equipment.finish(),wheel:wheel.finish()};
}
