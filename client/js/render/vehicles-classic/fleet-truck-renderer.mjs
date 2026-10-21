// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original full-size regular-cab pickup. A separate double-wall open bed,
// stamped floor and wheel tubs sit on a ladder frame behind a fitted cabin.
import {createVehicleMeshTools,authorRoadWheel} from './vehicle-mesh-tools.mjs';
import {authorVehicleLabel} from './vehicle-lettering.mjs';
export function buildTruckTemplates(T,dims) {
  const {Batch,wheelMap,frame}=createVehicleMeshTools(T,dims);
  const paint=new Batch(),structure=new Batch(),interior=new Batch(),glass=new Batch(),details=new Batch(),equipment=new Batch(),wheel=new Batch(wheelMap);
  const C={trim:0x283237,rubber:0x252b2d,steel:0xadb6ba,liner:0x515858,seat:0x596467,cabin:0x3c474c};
  const sections=[[-2.55,1.125,.905],[-2.43,1.13,.96],[-1.58,1.13,.97],[-.70,1.13,.96],[-.62,1.125,.95],[1.10,1.13,.95],[1.70,1.12,.965],[2.37,1.06,.94],[2.55,1.015,.88]];
  function at(x){for(let i=1;i<sections.length;i++)if(x<=sections[i][0]){const a=sections[i-1],b=sections[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}return sections.at(-1).slice(1);}
  const R=dims.wheelDiameter/2,arch=R+.045,sill=.32,axles=[dims.rearAxle,dims.frontAxle];
  const low=x=>Math.max(sill,...axles.map(cx=>Math.abs(x-cx)<=arch?R+Math.sqrt(Math.max(0,arch**2-(x-cx)**2)):sill));
  const sideZ=(x,y)=>{const[top,w]=at(x);return y>top-.06?w-.032+(top-y)/.06*.032:w-.04*Math.max(0,Math.min(1,(top-.21-y)/.55));};
  const stops=sections.map(p=>p[0]);for(const cx of axles){for(let i=0;i<=32;i++)stops.push(cx+arch*Math.cos(i*Math.PI/32));stops.push(cx-arch-.00001,cx+arch+.00001);}
  stops.sort((a,b)=>a-b);const xs=stops.filter((x,i)=>x>=-2.55&&x<=2.55&&(i===0||x-stops[i-1]>1e-7));
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i],[ya,wa]=at(a),[yb,wb]=at(b),mid=(a+b)/2;
    for(const s of [-1,1]){
      const row=(x,y,w)=>{const floor=low(x);return[[x,y,s*(w-.032)],[x,y-.06,s*w],[x,Math.max(floor,y-.23),s*sideZ(x,Math.max(floor,y-.23))],[x,floor,s*sideZ(x,floor)]];};
      const pa=row(a,ya,wa),pb=row(b,yb,wb);
      for(let j=0;j<3;j++)paint.face([pa[j],pb[j],pb[j+1],pa[j+1]],[0,0,s]);
      structure.face([pa[3],pb[3],[b,low(b),s*.625],[a,low(a),s*.625]],[0,-1,s*.1],C.rubber);
      if(mid>1.10)paint.face([[a,ya,s*(wa-.032)],[b,yb,s*(wb-.032)],[b,yb+.022,0],[a,ya+.022,0]],[0,1,0]);
      else {
        const inner=mid<-.62?.825:.83;
        paint.face([[a,ya,s*(wa-.032)],[b,yb,s*(wb-.032)],[b,yb,s*inner],[a,ya,s*inner]],[0,1,0]);
        const bottom=mid<-.62?.705:.49;
        interior.face([[a,ya,s*inner],[b,yb,s*inner],[b,bottom,s*inner],[a,bottom,s*inner]],[0,0,-s],mid<-.62?C.liner:C.cabin);
      }
    }
  }
  for(const end of [-1,1]){const x=end*2.55,[y,w]=at(x);paint.face([[x,sill,-w+.04],[x,sill,w-.04],[x,y-.06,w],[x,y,w-.032],[x,y,-w+.032],[x,y-.06,-w]],[end,0,0]);}
  // Full-length chassis deck and ladder frame; no see-through underbody.
  structure.box(0,.383,0,5.10,.105,1.25,C.rubber);
  for(const z of [-.43,.43])structure.box(-.05,.275,z,4.80,.14,.105,0x364144);
  for(const x of [-2.25,-.70,.60,2.14])structure.box(x,.29,0,.09,.09,.91,0x465354);
  for(const cx of axles){structure.bar([cx,.375,-.69],[cx,.375,.69],.051,0x4b5556,12);structure.box(cx,.376,0,.27,.18,.25,C.trim);}
  for(const cx of axles)for(const s of [-1,1])for(let i=0;i<32;i++){
    const a=i*Math.PI/32,b=(i+1)*Math.PI/32,p=(t,r,z)=>[cx+Math.cos(t)*r,R+Math.sin(t)*r,s*z];
    const za=sideZ(cx+Math.cos(a)*arch,R+Math.sin(a)*arch),zb=sideZ(cx+Math.cos(b)*arch,R+Math.sin(b)*arch);
    paint.face([p(a,arch,za+.001),p(b,arch,zb+.001),p(b,arch+.021,zb+.005),p(a,arch+.021,za+.005)],[0,0,s]);
    structure.face([p(a,arch,za),p(a,arch,.625),p(b,arch,.625),p(b,arch,zb)],[0,-1,0],C.rubber);
    const wall=[p(a,arch,.625),p(b,arch,.625),[cx,R,s*.625]];structure.face(wall,[0,0,s],C.rubber);structure.face(wall,[0,0,-s],C.rubber);
  }
  // Short, distinct cab: curved roof crown, two front windows and sliding rear glass.
  const roof=[[-.60,1.75,.76],[-.52,1.802,.79],[-.24,1.818,.798],[.28,1.818,.792],[.50,1.807,.77],[.58,1.77,.75]];
  const railY=x=>1.75+(x+.60)/1.18*.02,railZ=x=>.76-(x+.60)/1.18*.01;
  for(const s of [-1,1]){
    paint.grid(roof.map(([x,y,z])=>[[x,y,s*z],[x,Math.min(1.83,y+.012),0]]),[0,1,0]);
    for(let i=1;i<roof.length;i++){const a=roof[i-1],b=roof[i];paint.face([[a[0],a[1],s*a[2]],[b[0],b[1],s*b[2]],[b[0],railY(b[0]),s*railZ(b[0])],[a[0],railY(a[0]),s*railZ(a[0])]],[0,0,s]);}
  }
  interior.face([[-.58,1.732,-.75],[.56,1.749,-.74],[.56,1.749,.74],[-.58,1.732,.75]],[0,-1,0],0x88908c);
  frame(paint,structure,glass,interior,[[1.10,1.13,-.83],[1.10,1.13,.83],[.58,1.77,.75],[.58,1.77,-.75]],[1,1,0],.922);
  frame(paint,structure,glass,interior,[[-.62,1.125,.83],[-.62,1.125,-.83],[-.60,1.75,-.76],[-.60,1.75,.76]],[-1,.1,0],.83);
  for(const z of [-.24,.24])structure.bar([-.625,1.18,z],[-.605,1.693,z],.011,C.trim,6);
  paint.box(-.647,.80,0,.05,.59,1.66);interior.box(-.602,.805,0,.022,.60,1.61,C.cabin);
  for(const s of [-1,1]){
    const P=(x,y,z)=>[x,y,s*z];
    frame(paint,structure,glass,interior,[P(1.10,1.13,.83),P(.58,1.77,.75),P(-.60,1.75,.76),P(-.62,1.125,.83)],[0,.1,s],.90);
    structure.bar(P(.84,1.13,.836),P(.45,1.73,.758),.011,C.trim,6);
    const line=[[1.075,1.125],[.93,.94],[.89,.37],[-.54,.37],[-.575,1.123]];
    for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];details.bar(P(a[0],a[1],sideZ(a[0],a[1])+.003),P(b[0],b[1],sideZ(b[0],b[1])+.003),.003,0x37464b,4);}
    details.box(-.34,.982,s*(sideZ(-.34,.982)+.008),.17,.047,.013,C.trim);details.box(-.34,.988,s*(sideZ(-.34,.988)+.019),.145,.022,.014,C.steel);
    // Cab-to-bed split is a narrow real panel joint, not a full-body decal.
    details.bar(P(-.684,.34,.922),P(-.684,1.125,.930),.005,C.trim,4);
    structure.box(.19,.462,s*.947,1.35,.105,.027,C.trim);
    equipment.box(.14,.345,s*.982,1.53,.068,.125,C.steel);
    for(let i=0;i<9;i++)details.box(-.50+i*.15,.381,s*.994,.08,.008,.065,C.rubber);
    structure.bar(P(.88,1.178,.837),P(.82,1.238,.98),.021,C.trim);
    structure.box(.79,1.29,s*1.046,.25,.166,.105,C.trim,[0,s*.08,0]);
    details.box(.662,1.295,s*1.046,.009,.125,.08,0xa4b9bf,[0,s*.08,0]);
    authorVehicleLabel(details,'4X4',{center:[-2.16,.994,s*(sideZ(-2.16,.994)+.005)],height:.075,normal:'z',side:s,color:0xc1c8c8});
    details.box(1.38,1.02,s*(sideZ(1.38,1.02)+.006),.115,.043,.011,0xc89649);
  }
  // Fitted bench, two headrests, instrument panel, pedals and column wheel.
  interior.box(.14,.525,0,1.46,.07,1.62,C.cabin);interior.box(.15,.628,0,1.40,.16,.24,C.trim);
  interior.box(.035,.795,0,.62,.19,1.40,C.seat);
  interior.box(-.255,1.117,0,.155,.56,1.40,C.seat,[0,0,-.09]);
  for(const z of [-.43,.43])interior.box(-.27,1.49,z,.14,.20,.285,C.seat);
  for(const s of [-1,1]){interior.box(.11,.85,s*.804,1.25,.42,.037,C.cabin);interior.box(.22,1.012,s*.777,.34,.055,.067,C.trim);}
  // The driver sits on the left (-z: vehicle forward is +x), as in the US (2026-10-06).
  interior.box(.85,1.062,0,.32,.22,1.59,C.trim);interior.box(.678,1.104,-.43,.045,.115,.35,0x20353e);
  for(const z of [-.33,-.48]){const m=new T.Matrix4().makeRotationZ(Math.PI/2);m.setPosition(.652,1.116,z);interior.geometry(new T.CylinderGeometry(.037,.037,.006,16),0x91a3a8,m);}
  interior.bar([.79,1.04,-.43],[.57,1.22,-.43],.026,C.trim);
  const m=new T.Matrix4().makeRotationY(Math.PI/2);m.setPosition(.55,1.23,-.43);interior.geometry(new T.TorusGeometry(.144,.013,6,24),C.trim,m);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;interior.bar([.55,1.23,-.43],[.55,1.23+Math.cos(a)*.14,-.43+Math.sin(a)*.14],.011,C.trim);}
  interior.bar([.43,.66,0],[.36,1.0,0],.018,C.trim,8);
  // Open, deep cargo box with a ribbed floor and closed inner wheel housings.
  interior.box(-1.59,.688,0,1.80,.055,1.23,C.liner);
  for(let i=-5;i<=5;i++)details.box(-1.59,.723,i*.111,1.71,.018,.029,0x7b8280);
  for(const s of [-1,1]){
    for(const [a,b] of [[-2.49,dims.rearAxle-.472],[dims.rearAxle+.472,-.745]])interior.box((a+b)/2,.688,s*.722,(b-a),.055,.214,C.liner);
    for(let i=0;i<28;i++){
      const a=i*Math.PI/28,b=(i+1)*Math.PI/28,p=(t,z)=>[dims.rearAxle+Math.cos(t)*.472,Math.max(.716,R+Math.sin(t)*.472),s*z];
      const pa=p(a,.615),pb=p(b,.615),qa=p(a,.828),qb=p(b,.828);
      interior.face([pa,pb,qb,qa],[0,1,0],C.liner);
      interior.face([pa,[pa[0],.716,pa[2]],[pb[0],.716,pb[2]],pb],[0,0,-s],C.liner);
    }
    structure.box(-1.64,1.131,s*.875,1.73,.025,.088,C.trim);
    for(const x of [-2.32,-.91])equipment.bar([x,1.142,s*.883],[x,1.189,s*.883],.012,C.steel,8);
  }
  interior.box(-2.512,.909,0,.035,.397,1.65,C.liner);
  interior.box(-.727,.907,0,.035,.391,1.65,C.liner);
  for(const z of [-.81,.81])details.bar([-2.553,.39,z],[-2.553,1.113,z],.004,C.trim,4);
  details.box(-2.56,1.007,0,.018,.065,.285,C.trim);details.box(-2.571,1.012,0,.012,.023,.22,C.steel);
  authorVehicleLabel(details,'UTILITY',{center:[-2.558,.88,0],height:.092,normal:'x',side:-1,color:0xc1c8cb});
  // Modest chrome grille, stacked rectangular headlamps and wrap tail lamps.
  structure.box(2.56,.858,0,.025,.26,1.66,C.trim);
  for(const y of [.742,.983])details.box(2.58,y,0,.018,.020,1.66,C.steel);
  for(let i=0;i<5;i++)details.box(2.582,.769+i*.041,0,.016,.012,.80,C.steel);
  for(const s of [-1,1]){
    details.box(2.594,.872,s*.641,.032,.155,.322,0xcdd9d9);
    for(let i=-2;i<=2;i++)details.box(2.612,.872,s*.641+i*.052,.002,.141,.002,0x9bafb6);
    details.box(2.594,.760,s*.645,.032,.056,.318,0xbc8b3e);
    structure.box(-2.56,.855,s*.875,.030,.346,.12,C.trim);
    details.box(-2.582,.916,s*.875,.025,.20,.092,0x9d3539);
    details.box(-2.584,.770,s*.875,.025,.063,.092,0xc1caca);
    details.box(-2.50,.91,s*.934,.093,.175,.020,0x983439);
  }
  for(const end of [-1,1]){
    const ring=[[-.87,.40],[-.947,.44],[-.95,.585],[-.88,.64],[.88,.64],[.95,.585],[.947,.44],[.87,.40]];
    const a=ring.map(([z,y])=>[end*2.49,y,z]),b=ring.map(([z,y])=>[end*2.72,y,z]);
    structure.face(a,[-end,0,0],C.steel);structure.face(b,[end,0,0],C.steel);
    for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;structure.face([a[i],a[j],b[j],b[i]],[0,(ring[i][1]+ring[j][1])/2-.52,(ring[i][0]+ring[j][0])/2],C.steel);}
    structure.box(end*2.727,.52,0,.012,.052,1.72,C.rubber);
    details.box(end*2.736,.473,0,.011,.122,.38,0xcccec2);
  }
  equipment.box(-2.64,.655,0,.15,.022,1.70,C.rubber);
  equipment.box(-2.66,.285,0,.16,.11,.11,C.trim);
  equipment.bar([-2.68,.291,0],[-2.735,.291,0],.034,C.steel,12);
  structure.bar([-1.20,.268,-.53],[-2.41,.274,-.76],.029,0x738385,12);
  for(const s of [-1,1])details.bar([1.14,1.135,s*.80],[2.32,1.076,s*.80],.003,C.trim,4);
  structure.bar([1.002,1.151,-.64],[.86,1.314,-.13],.007,C.trim);
  structure.bar([1.006,1.151,.02],[.87,1.314,.57],.007,C.trim);
  // Thin cab radio aerial with an actual fixed mounting socket.
  equipment.box(1.15,1.117,-.78,.06,.025,.06,C.trim);
  equipment.bar([1.15,1.13,-.78],[1.12,1.94,-.78],.0035,0x768487,6);
  authorRoadWheel(T,wheel,{radius:R,width:dims.tireWidth,rimRatio:.62});
  return {paint:paint.finish(),structure:structure.finish(),interior:interior.finish(),glass:glass.finish(),details:details.finish(),equipment:equipment.finish(),wheel:wheel.finish()};
}
