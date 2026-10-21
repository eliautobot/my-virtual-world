// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original four-door utility wagon: upright hatch, three side windows, tall
// cabin, raised floor, load bay, roof rack and rear-mounted spare wheel.
import {createVehicleMeshTools,authorRoadWheel} from './vehicle-mesh-tools.mjs';
import {authorVehicleLabel} from './vehicle-lettering.mjs';

export function buildSuvTemplates(T,dims) {
  const {Batch,wheelMap,frame}=createVehicleMeshTools(T,dims);
  const paint=new Batch(),structure=new Batch(),interior=new Batch(),glass=new Batch(),details=new Batch(),equipment=new Batch(),wheel=new Batch(wheelMap);
  const C={rubber:0x222a2d,trim:0x29343a,steel:0xa7b1b7,seat:0x525c5d,cabin:0x354346};
  const sections=[[-2.24,1.074,.90],[-2.12,1.078,.94],[-1.55,1.082,.95],[-.45,1.086,.95],[.98,1.09,.95],[1.46,1.073,.945],[2.08,1.045,.925],[2.24,1.025,.87]];
  function at(x){for(let i=1;i<sections.length;i++)if(x<=sections[i][0]){const a=sections[i-1],b=sections[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}return sections.at(-1).slice(1);}
  const R=dims.wheelDiameter/2,arch=R+.045,sill=.30,axles=[dims.rearAxle,dims.frontAxle];
  const low=x=>Math.max(sill,...axles.map(cx=>Math.abs(x-cx)<=arch?R+Math.sqrt(Math.max(0,arch**2-(x-cx)**2)):sill));
  const sideZ=(x,y)=>{const[top,w]=at(x);return y>top-.05?w-.025+(top-y)/.05*.025:w-.035*Math.max(0,Math.min(1,(top-.23-y)/.55));};
  const stops=sections.map(p=>p[0]);for(const cx of axles){for(let i=0;i<=32;i++)stops.push(cx+arch*Math.cos(i*Math.PI/32));stops.push(cx-arch-.00001,cx+arch+.00001);}
  stops.sort((a,b)=>a-b);const xs=stops.filter((x,i)=>x>=-2.24&&x<=2.24&&(i===0||x-stops[i-1]>1e-7));
  for(let i=1;i<xs.length;i++) {
    const a=xs[i-1],b=xs[i],[ya,wa]=at(a),[yb,wb]=at(b),cabin=(a+b)/2<.98;
    for(const side of [-1,1]) {
      const row=(x,y,w)=>{const floor=low(x),middle=Math.max(floor,y-.22);return [[x,y,side*(w-.025)],[x,y-.05,side*w],[x,middle,side*sideZ(x,middle)],[x,floor,side*sideZ(x,floor)]];};
      const pa=row(a,ya,wa),pb=row(b,yb,wb);
      for(let j=0;j<3;j++)paint.face([pa[j],pb[j],pb[j+1],pa[j+1]],[0,0,side]);
      structure.face([pa[3],pb[3],[b,low(b),side*.620],[a,low(a),side*.620]],[0,-1,.1*side],C.rubber);
      if(cabin){
        paint.face([[a,ya,side*(wa-.025)],[b,yb,side*(wb-.025)],[b,yb,side*.825],[a,ya,side*.825]],[0,1,0]);
        interior.face([[a,ya,side*.825],[b,yb,side*.825],[b,.47,side*.802],[a,.47,side*.802]],[0,0,-side],C.cabin);
      }else paint.face([[a,ya,side*(wa-.025)],[b,yb,side*(wb-.025)],[b,yb+.012,0],[a,ya+.012,0]],[0,1,0]);
    }
  }
  for(const end of [-1,1]){const x=end*2.24,[y,w]=at(x);paint.face([[x,sill,-w+.03],[x,sill,w-.03],[x,y-.05,w],[x,y,w-.025],[x,y+.012,0],[x,y,-w+.025],[x,y-.05,-w]],[end,0,0]);}
  structure.box(0,.355,0,4.48,.11,1.27,C.rubber);
  // Frame rails, axle housings and guards are actual underbody geometry.
  for(const z of [-.43,.43])structure.box(-.05,.282,z,3.78,.105,.11,0x303b3e);
  for(const cx of axles)structure.bar([cx,.35,-.67],[cx,.35,.67],.048,0x475253,12);
  for(const cx of axles)for(const side of [-1,1])for(let i=0;i<32;i++){
    const a=i*Math.PI/32,b=(i+1)*Math.PI/32,p=(t,r,z)=>[cx+Math.cos(t)*r,R+Math.sin(t)*r,side*z];
    const za=sideZ(cx+Math.cos(a)*arch,R+Math.sin(a)*arch),zb=sideZ(cx+Math.cos(b)*arch,R+Math.sin(b)*arch);
    paint.face([p(a,arch,za+.002),p(b,arch,zb+.002),p(b,arch+.019,zb+.009),p(a,arch+.019,za+.009)],[0,0,side]);
    structure.face([p(a,arch,za),p(a,arch,.620),p(b,arch,.620),p(b,arch,zb)],[0,-1,0],C.rubber);
    const wall=[p(a,arch,.620),p(b,arch,.620),[cx,R,side*.620]];structure.face(wall,[0,0,side],C.rubber);structure.face(wall,[0,0,-side],C.rubber);
  }
  // A continuous wagon roof and fixed quarter glazing, not a sedan trunk.
  const roof=[[-2.17,1.785,.742],[-2.04,1.83,.77],[-1.70,1.841,.78],[-.90,1.847,.78],[.24,1.842,.768],[.42,1.79,.74]];
  const railY=x=>1.785+(x+2.17)/2.59*.005,railZ=x=>.742-(x+2.17)/2.59*.002;
  for(const side of [-1,1]){
    paint.grid(roof.map(([x,y,z])=>[[x,y,side*z],[x,Math.min(1.86,y+.013),0]]),[0,1,0]);
    for(let i=1;i<roof.length;i++){const a=roof[i-1],b=roof[i];paint.face([[a[0],a[1],side*a[2]],[b[0],b[1],side*b[2]],[b[0],railY(b[0]),side*railZ(b[0])],[a[0],railY(a[0]),side*railZ(a[0])]],[0,0,side]);}
  }
  interior.face([[-2.15,1.766,-.732],[.40,1.773,-.73],[.40,1.773,.73],[-2.15,1.766,.732]],[0,-1,0],0x697574);
  frame(paint,structure,glass,interior,[[.98,1.09,-.825],[.98,1.09,.825],[.42,1.79,.74],[.42,1.79,-.74]],[1,1,0],.925);
  frame(paint,structure,glass,interior,[[-2.24,1.074,.825],[-2.24,1.074,-.825],[-2.17,1.785,-.742],[-2.17,1.785,.742]],[-1,.1,0],.89);
  for(const side of [-1,1]){
    const P=(x,y,z)=>[x,y,side*z];const A=P(.98,1.09,.825),At=P(.42,1.79,.74),B=P(-.22,1.086,.825),Bt=P(-.18,railY(-.18),railZ(-.18)),C0=P(-1.31,1.084,.825),Ct=P(-1.26,railY(-1.26),railZ(-1.26)),D=P(-2.24,1.074,.825),Dt=P(-2.17,1.785,.742);
    frame(paint,structure,glass,interior,[A,At,Bt,B],[0,.1,side],.90);
    frame(paint,structure,glass,interior,[B,Bt,Ct,C0],[0,.1,side],.89);
    frame(paint,structure,glass,interior,[C0,Ct,Dt,D],[0,.1,side],.86);
    for(const [bottom,top] of [[B,Bt],[C0,Ct]]){
      structure.face([[bottom[0]-.022,bottom[1]+.002,bottom[2]+side*.002],[top[0]-.022,top[1]-.005,top[2]+side*.002],[top[0]+.022,top[1]-.005,top[2]+side*.002],[bottom[0]+.022,bottom[1]+.002,bottom[2]+side*.002]],[0,0,side],C.trim);
    }
    const seams=[[[.92,1.083],[.80,.89],[.78,.345],[-.22,.345],[-.22,1.08]],[[-.22,1.08],[-.22,.345],[-.82,.345],[-.95,.59],[-1.11,.80],[-1.28,1.076]]];
    for(const line of seams)for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];details.bar(P(a[0],a[1],sideZ(a[0],a[1])+.002),P(b[0],b[1],sideZ(b[0],b[1])+.002),.003,0x2e3c3d,4);}
    for(const x of [.04,-1.03]){details.box(x,.954,side*(sideZ(x,.954)+.008),.15,.042,.014,C.trim);details.box(x,.960,side*(sideZ(x,.960)+.019),.128,.019,.017,C.steel);}
    structure.box(-.15,.48,side*.945,1.72,.17,.030,C.trim);
    equipment.box(-.19,.315,side*.980,1.89,.065,.12,0x4f6063);
    for(let i=0;i<12;i++)details.box(-1.02+i*.15,.35,side*.995,.075,.008,.08,0x879496);
    // Substantial closed mirrors mounted at the windshield base.
    structure.bar(P(.77,1.15,.83),P(.70,1.21,.95),.022,C.trim);
    structure.box(.67,1.255,side*1.005,.23,.15,.10,C.trim,[0,side*.09,0]);
    details.box(.548,1.258,side*1.005,.009,.11,.075,0x9dafb5,[0,side*.09,0]);
    authorVehicleLabel(details,'4X4',{center:[-1.87,.935,side*(sideZ(-1.87,.935)+.007)],height:.07,normal:'z',side:side>0?1:-1,color:0xaebcbd});
  }
  interior.box(-.27,.51,0,2.05,.07,1.57,C.cabin);
  interior.box(-1.93,.57,0,.57,.08,1.25,C.cabin);
  interior.box(-.27,.61,0,1.76,.16,.23,C.trim);
  for(const side of [-1,1]){
    interior.box(-.12,.735,side*.40,.60,.18,.55,C.seat);
    interior.box(-.39,1.065,side*.40,.15,.63,.55,C.seat,[0,0,-.11]);
    interior.box(-.42,1.455,side*.40,.13,.18,.27,C.seat);
    interior.box(-.38,.77,side*.79,1.96,.46,.036,C.cabin);
    interior.box(.07,.97,side*.767,.28,.05,.055,C.trim);
  }
  interior.box(-1.19,.88,0,.63,.18,1.37,C.seat);
  interior.box(-1.47,1.20,0,.15,.55,1.37,C.seat,[0,0,-.09]);
  for(const z of [-.43,.43])interior.box(-1.48,1.565,z,.13,.16,.26,C.seat);
  interior.box(.70,1.03,0,.39,.22,1.55,C.trim);
  // The driver sits on the left (-z: vehicle forward is +x), as in the US (2026-10-06).
  interior.box(.51,1.073,-.40,.09,.12,.34,0x1c2c31);
  interior.bar([.60,.98,-.40],[.41,1.156,-.40],.026,C.trim);
  const steering=new T.Matrix4().makeRotationY(Math.PI/2);steering.setPosition(.41,1.173,-.40);interior.geometry(new T.TorusGeometry(.135,.013,6,24),C.trim,steering);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;interior.bar([.41,1.173,-.40],[.41,1.173+Math.cos(a)*.13,-.40+Math.sin(a)*.13],.010,C.trim);}
  interior.bar([.13,.64,0],[.12,.94,0],.017,C.trim,8);
  interior.bar([-.02,.65,-.08],[-.04,.83,-.08],.013,C.trim,8);
  // Upright nose, rectangular main lamps and round low fog lamps.
  structure.box(2.253,.875,0,.029,.24,1.66,C.trim);
  for(const y of [.765,.985])details.box(2.272,y,0,.012,.012,1.62,C.steel);
  for(let i=0;i<5;i++)details.box(2.276,.795+i*.036,0,.012,.009,.79,0x839494);
  for(const side of [-1,1]){
    details.box(2.281,.876,side*.625,.025,.171,.348,0xc8d4d5);
    for(let i=-2;i<=2;i++)details.box(2.296,.876,side*.625+i*.052,.002,.157,.002,0x97aeb4);
    details.box(2.280,.880,side*.810,.025,.17,.090,0xc19041);
    const fog=new T.Matrix4().makeRotationZ(-Math.PI/2);fog.setPosition(2.378,.563,side*.68);structure.geometry(new T.CylinderGeometry(.067,.067,.016,20),C.trim,fog);fog.setPosition(2.390,.563,side*.68);details.geometry(new T.CylinderGeometry(.058,.058,.013,20),0xb5c6c7,fog);
    structure.box(-2.255,.96,side*.773,.031,.34,.175,C.trim);
    details.box(-2.276,1.006,side*.773,.021,.20,.140,0x8b3034);
    details.box(-2.278,.852,side*.773,.021,.068,.140,0xb5bec0);
  }
  for(const end of [-1,1]){
    const ring=[[-.865,.405],[-.935,.449],[-.943,.610],[-.89,.655],[.89,.655],[.943,.610],[.935,.449],[.865,.405]];
    const a=ring.map(([z,y])=>[end*2.20,y,z]),b=ring.map(([z,y])=>[end*2.37,y,z]);
    structure.face(a,[-end,0,0],C.trim);structure.face(b,[end,0,0],C.trim);
    for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;structure.face([a[i],a[j],b[j],b[i]],[0,(ring[i][1]+ring[j][1])/2-.53,(ring[i][0]+ring[j][0])/2],C.trim);}
    details.box(end*2.377,.476,0,.012,.135,.37,C.rubber);details.box(end*2.386,.476,0,.006,.111,.34,0xc8c9bd);
  }
  structure.box(2.13,.31,0,.29,.048,1.00,0x647678,[0,0,-.13]);
  structure.bar([-2.13,.282,-.43],[-2.32,.282,-.43],.032,0x89989b,12);
  // A physical carrier links the rear-door metal to the spare hub.
  equipment.box(-2.33,.97,0,.20,.13,.28,C.trim);
  equipment.bar([-2.38,.99,0],[-2.50,1.09,0],.055,C.trim,12);
  equipment.box(-2.548,1.09,0,.135,.11,.11,C.trim);
  // Full-size externally mounted spare: closed profiled tire and steel hub.
  const profile=[[.205,-.11],[.295,-.12],[.353,-.082],[.37,-.043],[.37,.043],[.353,.082],[.295,.12],[.205,.11],[.205,-.11]];
  const spareMatrix=new T.Matrix4().makeRotationZ(Math.PI/2);spareMatrix.setPosition(-2.465,1.09,0);
  equipment.geometry(new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),40),C.rubber,spareMatrix);
  const hub=new T.Matrix4().makeRotationZ(Math.PI/2);hub.setPosition(-2.591,1.09,0);
  equipment.geometry(new T.CylinderGeometry(.223,.223,.020,32),0x839396,hub);
  const cap=hub.clone();cap.setPosition(-2.609,1.09,0);equipment.geometry(new T.CylinderGeometry(.11,.11,.018,20),C.trim,cap);
  details.box(-2.252,1.015,-.54,.027,.07,.23,C.trim);
  details.bar([-2.253,1.176,-.05],[-2.242,1.675,.36],.008,C.trim,8);
  // Low rack rails attached to the roof through four solid pads.
  for(const side of [-1,1]){
    for(const x of [-1.63,-.10]){equipment.box(x,1.843,side*.674,.18,.04,.11,C.trim);equipment.bar([x,1.86,side*.674],[x,1.919,side*.674],.017,C.trim,8);}
    equipment.bar([-1.72,1.925,side*.674],[.02,1.925,side*.674],.017,C.trim,10);
  }
  for(const x of [-1.48,-.25])equipment.bar([x,1.901,-.67],[x,1.901,.67],.014,0x738586,10);
  for(const side of [-1,1])for(const line of [[[1.01,1.095],[1.46,1.078],[2.11,1.048]],[[-2.222,1.079],[-2.176,1.772]]])for(let i=1;i<line.length;i++)details.bar([line[i-1][0],line[i-1][1],side*.80],[line[i][0],line[i][1],side*.80],.0025,C.trim,4);
  structure.bar([.85,1.109,-.62],[.67,1.276,-.12],.007,C.trim);
  structure.bar([.86,1.109,.01],[.68,1.276,.56],.007,C.trim);
  authorRoadWheel(T,wheel,{radius:R,width:dims.tireWidth,rimRatio:.62});
  return {paint:paint.finish(),structure:structure.finish(),interior:interior.finish(),glass:glass.finish(),details:details.finish(),equipment:equipment.finish(),wheel:wheel.finish()};
}
