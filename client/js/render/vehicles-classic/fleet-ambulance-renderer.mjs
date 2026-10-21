// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original cutaway ambulance: short sloped cab and a separate beveled patient
// module, with real window openings, cabinets, cot, oxygen and fitted seats.
import {createVehicleMeshTools,authorRoadWheel} from './vehicle-mesh-tools.mjs';
import {authorVehicleLabel} from './vehicle-lettering.mjs';
export function buildAmbulanceTemplates(T,dims){
  const {Batch,wheelMap,frame}=createVehicleMeshTools(T,dims);
  const paint=new Batch(),structure=new Batch(),interior=new Batch(),glass=new Batch(),details=new Batch(),equipment=new Batch(),lamps=new Batch(),wheel=new Batch(wheelMap);
  const C={trim:0x283138,rubber:0x252c2e,steel:0xacb7bb,cabin:0x535f63,seat:0x63777c,medical:0xc6cfc9,red:0xa9393b,blue:0x285780};
  const R=dims.wheelDiameter/2,arch=R+.05,axles=[dims.rearAxle,dims.frontAxle],sill=.32;
  const sections=[[-2.96,1.13,1.065],[-2.85,1.13,1.11],[-.70,1.13,1.11],[.38,1.13,1.11],[.44,1.225,1.00],[2.19,1.26,1.00],[2.65,1.19,.98],[2.98,1.10,.93]];
  function at(x){for(let i=1;i<sections.length;i++)if(x<=sections[i][0]){const a=sections[i-1],b=sections[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}return sections.at(-1).slice(1);}
  const low=x=>Math.max(sill,...axles.map(cx=>Math.abs(x-cx)<=arch?R+Math.sqrt(Math.max(0,arch**2-(x-cx)**2)):sill));
  const sideZ=(x,y)=>{const[top,w]=at(x);return y>top-.05?w-.022+(top-y)/.05*.022:w-.027*Math.max(0,Math.min(1,(top-.2-y)/.6));};
  const stops=sections.map(p=>p[0]);for(const cx of axles){for(let i=0;i<=32;i++)stops.push(cx+arch*Math.cos(i*Math.PI/32));stops.push(cx-arch-.00001,cx+arch+.00001);}
  stops.sort((a,b)=>a-b);const xs=stops.filter((x,i)=>x>=-2.96&&x<=2.98&&(i===0||x-stops[i-1]>1e-7));
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i],[ya,wa]=at(a),[yb,wb]=at(b),mid=(a+b)/2;
    for(const s of [-1,1]){
      const row=(x,y,w)=>{const f=low(x);return[[x,y,s*(w-.022)],[x,y-.05,s*w],[x,Math.max(f,y-.20),s*sideZ(x,Math.max(f,y-.20))],[x,f,s*sideZ(x,f)]];};
      const pa=row(a,ya,wa),pb=row(b,yb,wb);
      for(let j=0;j<3;j++)paint.face([pa[j],pb[j],pb[j+1],pa[j+1]],[0,0,s]);
      structure.face([pa[3],pb[3],[b,low(b),s*.635],[a,low(a),s*.635]],[0,-1,s*.1],C.rubber);
      if(mid>2.19)paint.face([[a,ya,s*(wa-.022)],[b,yb,s*(wb-.022)],[b,yb+.020,0],[a,ya+.020,0]],[0,1,0]);
      else if(mid<=.38)paint.face([[a,ya,s*(wa-.022)],[b,yb,s*(wb-.022)],[b,yb,s*1.11],[a,ya,s*1.11]],[0,1,0]);
      else if(mid>.38){paint.face([[a,ya,s*(wa-.022)],[b,yb,s*(wb-.022)],[b,yb,s*.86],[a,ya,s*.86]],[0,1,0]);interior.face([[a,ya,s*.86],[b,yb,s*.86],[b,.56,s*.84],[a,.56,s*.84]],[0,0,-s],C.cabin);}
    }
  }
  for(const [x,sign] of [[-2.96,-1],[2.98,1]]){const[y,w]=at(x);paint.face([[x,sill,-w+.027],[x,sill,w-.027],[x,y-.05,w],[x,y,w-.022],[x,y,-w+.022],[x,y-.05,-w]],[sign,0,0]);}
  structure.box(.01,.38,0,5.94,.11,1.27,C.rubber);
  for(const z of [-.45,.45])structure.box(-.05,.27,z,5.65,.145,.12,0x344145);
  for(const x of [-2.6,-.6,1.1,2.6])structure.box(x,.30,0,.11,.10,1.02,0x536167);
  for(const cx of axles){structure.bar([cx,.40,-.75],[cx,.40,.75],.057,0x4a585e,12);structure.box(cx,.4,0,.30,.20,.28,C.trim);}
  for(const cx of axles)for(const s of [-1,1])for(let i=0;i<32;i++){
    const a=i*Math.PI/32,b=(i+1)*Math.PI/32,p=(t,r,z)=>[cx+Math.cos(t)*r,R+Math.sin(t)*r,s*z];
    const za=sideZ(cx+Math.cos(a)*arch,R+Math.sin(a)*arch),zb=sideZ(cx+Math.cos(b)*arch,R+Math.sin(b)*arch);
    paint.face([p(a,arch,za+.001),p(b,arch,zb+.001),p(b,arch+.02,zb+.004),p(a,arch+.02,za+.004)],[0,0,s]);
    structure.face([p(a,arch,za),p(a,arch,.635),p(b,arch,.635),p(b,arch,zb)],[0,-1,0],C.rubber);
    const wall=[p(a,arch,.635),p(b,arch,.635),[cx,R,s*.635]];structure.face(wall,[0,0,s],C.rubber);structure.face(wall,[0,0,-s],C.rubber);
  }
  // Upper patient module has open apertures rather than glass over solid boxes.
  const bx=[-2.96,-2.35,-1.60,-.65,.14,.38],by=[1.13,1.68,2.11,2.52];
  for(const s of [-1,1])for(let i=1;i<bx.length;i++)for(let j=1;j<by.length;j++){
    const x0=bx[i-1],x1=bx[i],y0=by[j-1],y1=by[j],points=[[x0,y0,s*1.11],[x1,y0,s*1.11],[x1,y1,s*1.11],[x0,y1,s*1.11]];
    if(j===2&&(i===2||i===4))frame(paint,structure,glass,interior,points,[0,0,s],.84);
    else {paint.face(points,[0,0,s]);interior.face(points.map(p=>[p[0],p[1],p[2]-s*.028]),[0,0,-s],C.medical);}
  }
  const roofBottom=[[-2.96,2.52,-1.11],[.38,2.52,-1.11],[.38,2.52,1.11],[-2.96,2.52,1.11]],roofTop=[[-2.89,2.59,-1.04],[.31,2.59,-1.04],[.31,2.59,1.04],[-2.89,2.59,1.04]];
  paint.face(roofTop,[0,1,0]);for(let i=0;i<4;i++){const j=(i+1)%4;paint.face([roofBottom[i],roofBottom[j],roofTop[j],roofTop[i]],[i===1?1:i===3?-1:0,1,i===0?-1:i===2?1:0]);}
  interior.face([[-2.92,2.49,-1.07],[.35,2.49,-1.07],[.35,2.49,1.07],[-2.92,2.49,1.07]],[0,-1,0],0xdce1db);
  paint.face([[.38,1.13,-1.11],[.38,1.13,1.11],[.38,2.52,1.11],[.38,2.52,-1.11]],[1,0,0]);
  interior.box(.339,1.55,0,.05,1.84,2.13,C.medical);
  // Twin rear patient doors include framed windows and visible central seal.
  for(const s of [-1,1]){
    const z0=s<0?-1.11:0,z1=s<0?0:1.11;
    const points=[[-2.96,1.13,z0],[-2.96,1.13,z1],[-2.96,2.52,z1],[-2.96,2.52,z0]];
    // Solid door lower/upper panels surround a dedicated high glass aperture.
    paint.face([points[0],points[1],[-2.96,1.72,z1],[-2.96,1.72,z0]],[-1,0,0]);
    paint.face([[-2.96,2.14,z0],[-2.96,2.14,z1],points[2],points[3]],[-1,0,0]);
    frame(paint,structure,glass,interior,[[-2.96,1.72,z0],[-2.96,1.72,z1],[-2.96,2.14,z1],[-2.96,2.14,z0]],[-1,0,0],.80);
    interior.box(-2.922,1.19,s*.55,.04,1.02,1.04,C.medical);
    for(const y of [1.02,1.56,2.30])details.box(-2.981,y,s*1.02,.035,.10,.052,C.steel);
    details.box(-2.983,1.41,s*.12,.03,.19,.038,C.trim);
  }
  structure.box(-2.968,1.53,0,.016,1.93,.017,C.trim);
  // Separate cab roof and glazing, terminating before the patient box.
  const roof=[[.40,1.96,.78],[.50,2.012,.80],[.94,2.032,.812],[1.36,2.025,.805],[1.49,1.98,.78]];
  const railY=x=>1.96+(x-.40)/1.09*.02;
  for(const s of [-1,1]){
    paint.grid(roof.map(([x,y,z])=>[[x,y,s*z],[x,y+.013,0]]),[0,1,0]);
    for(let i=1;i<roof.length;i++){const a=roof[i-1],b=roof[i];paint.face([[a[0],a[1],s*a[2]],[b[0],b[1],s*b[2]],[b[0],railY(b[0]),s*.78],[a[0],railY(a[0]),s*.78]],[0,0,s]);}
  }
  interior.face([[.43,1.94,-.76],[1.46,1.958,-.76],[1.46,1.958,.76],[.43,1.94,.76]],[0,-1,0],0x929e9e);
  frame(paint,structure,glass,interior,[[2.19,1.26,-.86],[2.19,1.26,.86],[1.49,1.98,.78],[1.49,1.98,-.78]],[1,1,0],.924);
  for(const s of [-1,1]){
    frame(paint,structure,glass,interior,[[2.19,1.26,s*.86],[1.49,1.98,s*.78],[.40,1.96,s*.78],[.44,1.225,s*.86]],[0,.1,s],.88);
    const line=[[2.15,1.254],[1.92,.98],[1.91,.39],[.49,.39],[.47,1.221]];
    for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];details.bar([a[0],a[1],s*(sideZ(a[0],a[1])+.003)],[b[0],b[1],s*(sideZ(b[0],b[1])+.003)],.003,C.trim,4);}
    details.box(.76,1.08,s*1.005,.18,.047,.02,C.trim);details.box(.76,1.088,s*1.019,.15,.024,.015,C.steel);
    equipment.box(1.19,.35,s*1.02,1.53,.07,.15,C.steel);
    structure.bar([2.0,1.32,s*.87],[1.94,1.43,s*1.09],.022,C.trim);
    structure.box(1.89,1.51,s*1.15,.27,.205,.115,C.trim,[0,s*.05,0]);details.box(1.749,1.514,s*1.15,.01,.164,.088,0xa4bbc4,[0,s*.05,0]);
  }
  interior.box(1.16,.59,0,1.46,.08,1.68,C.cabin);
  for(const s of [-1,1]){
    interior.box(1.05,.85,s*.44,.60,.18,.56,C.seat);interior.box(.78,1.21,s*.44,.15,.63,.56,C.seat,[0,0,-.09]);interior.box(.77,1.63,s*.44,.15,.20,.29,C.seat);
    interior.box(1.18,.88,s*.829,1.28,.45,.031,C.cabin);
  }
  // The driver sits on the left (-z: vehicle forward is +x), as in the US (2026-10-06).
  interior.box(1.91,1.20,0,.38,.22,1.66,C.trim);interior.box(1.701,1.25,-.44,.054,.13,.35,0x223843);
  interior.bar([1.85,1.17,-.44],[1.60,1.39,-.44],.026,C.trim);const steering=new T.Matrix4().makeRotationY(Math.PI/2);steering.setPosition(1.57,1.405,-.44);interior.geometry(new T.TorusGeometry(.146,.014,6,24),C.trim,steering);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;interior.bar([1.57,1.405,-.44],[1.57,1.405+Math.cos(a)*.14,-.44+Math.sin(a)*.14],.012,C.trim);}
  // Patient floor is raised above rear tires; full fitted clinical interior.
  interior.box(-1.31,.922,0,3.21,.09,2.10,0x647b82);
  interior.box(-1.20,1.37,-.78,2.39,.71,.43,C.medical);
  for(const x of [-2.04,-1.45,-.85,-.30]){interior.box(x,1.374,-.553,.48,.61,.014,0xa6b9b8);interior.box(x,1.53,-.54,.17,.027,.014,0x738b90);}
  interior.box(-1.44,1.20,.79,1.98,.25,.48,C.seat);interior.box(-1.44,1.48,.99,1.98,.42,.12,C.seat);
  interior.box(-.10,1.2,.45,.42,.27,.53,C.seat);interior.box(.06,1.52,.45,.15,.48,.53,C.seat);
  // Cot: frame and folding legs physically support the mattress.
  for(const z of [-.28,.28])interior.bar([-2.39,1.29,z],[-.58,1.29,z],.021,C.steel,8);
  for(const x of [-2.15,-.78])for(const s of [-1,1]){interior.bar([x,1.27,s*.25],[x+.12,.987,s*.28],.018,C.steel,8);const m=new T.Matrix4().makeRotationX(Math.PI/2);m.setPosition(x+.12,1.0,s*.28);interior.geometry(new T.CylinderGeometry(.046,.046,.035,12),C.trim,m);}
  interior.box(-1.50,1.325,0,1.81,.09,.61,0x516e7b);interior.box(-.76,1.393,0,.34,.105,.48,0xd9e0d9);
  for(const x of [-2.11,-1.07])interior.box(x,1.378,0,.057,.014,.615,0x3e535e);
  for(const z of [-.90,-.69]){interior.geometry(new T.CylinderGeometry(.07,.07,.55,14),0x739294,new T.Matrix4().makeTranslation(.06,1.28,z));interior.bar([.06,1.57,z],[.06,1.67,z],.015,C.steel,8);}
  interior.box(-.27,1.89,-.79,.27,.30,.21,0x476572);interior.box(-.27,1.90,-.675,.21,.21,.02,0x88b6ae);
  for(const x of [-2.10,-.40])interior.box(x,2.464,0,.48,.025,.23,0xe6e9d5);
  // Permanent livery and a six-arm blue medical emblem survive detail LOD.
  for(const s of [-1,1]){
    equipment.box(-1.29,1.32,s*1.114,3.29,.205,.006,C.red);
    equipment.box(-1.29,1.465,s*1.114,3.29,.018,.007,0x536d7c);
    for(const a of [0,Math.PI/3,-Math.PI/3])equipment.box(-1.04,1.96,s*1.116,.115,.49,.006,C.blue,[0,0,a]);
    authorVehicleLabel(equipment,'AMBULANCE',{center:[-1.29,2.336,s*1.116],height:.126,normal:'z',side:s,color:C.blue});
    authorVehicleLabel(details,'EMS',{center:[1.05,.996,s*1.012],height:.081,normal:'z',side:s,color:C.red});
    // Side compartment seams, recessed latch and lower storage closures.
    for(const x of [-2.47,-.77,.23])details.bar([x,.92,s*1.117],[x,2.31,s*1.117],.0035,C.trim,4);
    details.bar([-.77,2.31,s*1.117],[.23,2.31,s*1.117],.0035,C.trim,4);
    details.box(-.60,1.525,s*1.124,.039,.14,.016,C.trim);
    equipment.box(-.23,.72,s*1.04,.93,.20,.10,C.steel);
    for(const x of [-2.60,-.30]){
      structure.box(x,2.424,s*1.119,.28,.108,.021,C.trim);
      lamps.box(x,2.424,s*1.137,.232,.071,.02,0xe45450);
    }
    for(const y of [1.56,2.31]){structure.box(-2.974,y,s*.89,.027,.14,.18,C.trim);lamps.box(-2.995,y,s*.89,.022,.103,.139,y>2?0xe9504b:0xf0e4c7);}
  }
  equipment.box(-2.974,1.32,0,.014,.20,2.10,C.red);
  authorVehicleLabel(equipment,'AMBULANCE',{center:[-2.979,2.359,0],height:.123,normal:'x',side:-1,color:C.blue});
  // Roof bar and corner lenses, with a closed pedestal rather than floating lights.
  equipment.box(.15,2.61,0,.27,.052,1.64,C.trim);equipment.box(.15,2.673,0,.245,.077,1.79,C.steel);
  for(const s of [-1,1])lamps.box(.15,2.707,s*.56,.254,.065,.60,0xea4e48);
  lamps.box(.15,2.707,0,.252,.065,.28,0xf4e9d2);
  equipment.box(-1.30,2.62,0,.83,.08,.64,0xa5b4b4);
  for(const z of [-.24,.24])details.box(-1.30,2.662,z,.63,.013,.045,0x536771);
  structure.box(2.994,.94,0,.023,.23,1.69,C.trim);
  for(let i=0;i<5;i++)details.box(3.012,.849+i*.044,0,.018,.012,.84,C.steel);
  for(const s of [-1,1]){details.box(3.025,.954,s*.653,.032,.158,.339,0xd5dedd);details.box(3.023,.834,s*.653,.03,.055,.334,0xbb9046);structure.box(-2.976,.646,s*.91,.025,.23,.12,C.trim);details.box(-2.994,.69,s*.91,.026,.14,.09,0xa33539);}
  for(const end of [-1,1]){
    const ring=[[-.94,.41],[-1.02,.46],[-1.02,.625],[-.95,.673],[.95,.673],[1.02,.625],[1.02,.46],[.94,.41]],a=ring.map(([z,y])=>[end*2.90,y,z]),b=ring.map(([z,y])=>[end*3.125,y,z]);
    structure.face(a,[-end,0,0],C.steel);structure.face(b,[end,0,0],C.steel);for(let i=0;i<8;i++){const j=(i+1)%8;structure.face([a[i],a[j],b[j],b[i]],[0,(ring[i][1]+ring[j][1])/2-.54,(ring[i][0]+ring[j][0])/2],C.steel);}
    details.box(end*3.137,.513,0,.010,.137,.395,0xd1d5c8);
  }
  equipment.box(-3.013,.69,0,.20,.025,1.90,C.rubber);
  structure.bar([2.1,1.28,-.66],[1.95,1.48,-.12],.008,C.trim);structure.bar([2.10,1.28,.01],[1.95,1.48,.59],.008,C.trim);
  authorRoadWheel(T,wheel,{radius:R,width:dims.tireWidth,rimRatio:.62});
  return {paint:paint.finish(),structure:structure.finish(),interior:interior.finish(),glass:glass.finish(),details:details.finish(),equipment:equipment.finish(),lamps:lamps.finish(),wheel:wheel.finish()};
}
