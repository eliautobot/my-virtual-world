// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original two-axle compact city bus. Continuous cabin, glazed folding doors,
// passenger seating/aisle, wheel housings, entrance steps and roof equipment.
import {createVehicleMeshTools,authorRoadWheel} from './vehicle-mesh-tools.mjs';
import {authorVehicleLabel} from './vehicle-lettering.mjs';
export function buildBusTemplates(T,dims){
  const {Batch,wheelMap,frame}=createVehicleMeshTools(T,dims);
  const paint=new Batch(),structure=new Batch(),interior=new Batch(),glass=new Batch(),details=new Batch(),equipment=new Batch(),wheel=new Batch(wheelMap);
  const C={trim:0x253036,rubber:0x252d30,steel:0xa2b2b7,cabin:0x788a8e,seat:0x376479,blue:0x356875,sign:0xd6c786};
  const R=dims.wheelDiameter/2,arch=R+.05,sill=.27,axles=[dims.rearAxle,dims.frontAxle];
  const sections=[[-4.04,1.46,1.045],[-3.92,1.48,1.12],[-3.40,1.48,1.12],[2.98,1.48,1.12],[3.44,1.48,1.12],[3.75,1.48,1.12],[3.90,1.47,1.09],[4.04,1.46,1.045]];
  function at(x){for(let i=1;i<sections.length;i++)if(x<=sections[i][0]){const a=sections[i-1],b=sections[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}return sections.at(-1).slice(1);}
  const low=x=>Math.max(sill,...axles.map(cx=>Math.abs(x-cx)<=arch?R+Math.sqrt(Math.max(0,arch**2-(x-cx)**2)):sill));
  const sideZ=(x,y)=>{const[top,w]=at(x);return y>top-.055?w-.022+(top-y)/.055*.022:w-.028*Math.max(0,Math.min(1,(top-.23-y)/.85));};
  const isDoor=x=>(x>-.48&&x<.44)||(x>2.98&&x<3.90);
  // As in the US (2026-10-06): the doors on the right (D, +z: vehicle forward is +x), the driver on the left (-D).
  const D=1;
  const stops=[...sections.map(p=>p[0]),-.48,-.02,.44];for(const cx of axles){for(let i=0;i<=32;i++)stops.push(cx+arch*Math.cos(i*Math.PI/32));stops.push(cx-arch-.00001,cx+arch+.00001);}
  stops.sort((a,b)=>a-b);const xs=stops.filter((x,i)=>x>=-4.04&&x<=4.04&&(i===0||x-stops[i-1]>1e-7));
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i],[ya,wa]=at(a),[yb,wb]=at(b),mid=(a+b)/2;
    for(const s of [-1,1]){
      if(s===D&&isDoor(mid)){
        frame(paint,structure,glass,interior,[[a,sill,s*sideZ(a,sill)],[b,sill,s*sideZ(b,sill)],[b,yb,s*(wb-.022)],[a,ya,s*(wa-.022)]],[0,0,s],.87);
      }else{
        const row=(x,y,w)=>{const f=low(x);return[[x,y,s*(w-.022)],[x,y-.055,s*w],[x,Math.max(f,y-.26),s*sideZ(x,Math.max(f,y-.26))],[x,f,s*sideZ(x,f)]];};
        const pa=row(a,ya,wa),pb=row(b,yb,wb);for(let j=0;j<3;j++)paint.face([pa[j],pb[j],pb[j+1],pa[j+1]],[0,0,s]);
        structure.face([pa[3],pb[3],[b,low(b),s*.625],[a,low(a),s*.625]],[0,-1,s*.1],C.rubber);
        interior.face([[a,ya,s*Math.min(1.064,wa-.04)],[b,yb,s*Math.min(1.064,wb-.04)],[b,.77,s*Math.min(1.064,wb-.04)],[a,.77,s*Math.min(1.064,wa-.04)]],[0,0,-s],C.cabin);
      }
      paint.face([[a,ya,s*(wa-.022)],[b,yb,s*(wb-.022)],[b,yb,s*(wb-.012)],[a,ya,s*(wa-.012)]],[0,1,0]);
    }
  }
  for(const end of [-1,1]){const x=end*4.04,[y,w]=at(x);paint.face([[x,sill,-w+.028],[x,sill,w-.028],[x,y-.055,w],[x,y,w-.022],[x,y,-w+.022],[x,y-.055,-w]],[end,0,0]);}
  structure.box(0,.344,0,8.08,.11,1.25,C.rubber);
  for(const z of [-.46,.46])structure.box(0,.235,z,7.84,.135,.12,0x3c4b50);
  for(const x of [-3.70,-1.3,.90,3.60])structure.box(x,.263,0,.10,.10,1.01,0x4f6065);
  for(const cx of axles){structure.bar([cx,.42,-.80],[cx,.42,.80],.06,0x4f5c61,12);structure.box(cx,.42,0,.29,.20,.29,C.trim);}
  for(const cx of axles)for(const s of [-1,1])for(let i=0;i<32;i++){
    const a=i*Math.PI/32,b=(i+1)*Math.PI/32,p=(t,r,z)=>[cx+Math.cos(t)*r,R+Math.sin(t)*r,s*z];
    const za=sideZ(cx+Math.cos(a)*arch,R+Math.sin(a)*arch),zb=sideZ(cx+Math.cos(b)*arch,R+Math.sin(b)*arch);
    paint.face([p(a,arch,za+.001),p(b,arch,zb+.001),p(b,arch+.019,zb+.004),p(a,arch+.019,za+.004)],[0,0,s]);
    structure.face([p(a,arch,za),p(a,arch,.625),p(b,arch,.625),p(b,arch,zb)],[0,-1,0],C.rubber);
    const wall=[p(a,arch,.625),p(b,arch,.625),[cx,R,s*.625]];structure.face(wall,[0,0,s],C.rubber);structure.face(wall,[0,0,-s],C.rubber);
  }
  // Long cambered roof, glazed side panels and continuous sealed fascia.
  const roof=[[-3.97,2.60,1.02],[-3.90,2.80,1.065],[-3.65,2.87,1.08],[3.53,2.867,1.07],[3.82,2.81,1.055],[3.88,2.58,1.02]];
  const railY=x=>2.60-(x+3.97)/7.85*.02;
  for(const s of [-1,1]){
    paint.grid(roof.map(([x,y,z])=>[[x,y,s*z],[x,y+.012,0]]),[0,1,0]);
    for(let i=1;i<roof.length;i++){const a=roof[i-1],b=roof[i];paint.face([[a[0],a[1],s*a[2]],[b[0],b[1],s*b[2]],[b[0],railY(b[0]),s*1.02],[a[0],railY(a[0]),s*1.02]],[0,0,s]);}
    const edges=s===-D?[-4.04,-2.97,-1.84,-.70,.44,1.58,2.72,4.04]:[-4.04,-2.97,-1.84,-.48,-.02,.44,1.58,2.98,3.44,3.90,4.04];
    const base=x=>{const[y,w]=at(x);return[x,y,s*(w-.012)];};
    const top=x=>{const xx=x===-4.04?-3.97:x>=3.90?3.88:x;return[xx,railY(xx),s*1.02];};
    for(let i=1;i<edges.length;i++){
      const a=edges[i-1],b=edges[i],quad=[base(a),base(b),top(b),top(a)];
      if(b-a<.2)paint.face(quad,[0,0,s]);else frame(paint,structure,glass,interior,quad,[0,.08,s],s===D&&isDoor((a+b)/2)?.87:.924);
      const p=base(a),q=top(a);if(i>1)structure.bar([p[0],p[1]+.01,p[2]+s*.003],[q[0],q[1]-.01,q[2]+s*.003],.016,C.trim,6);
      if(b-a>.8){const x0=a+.08,x1=b-.08,y=2.18,z=1.098-(y-1.48)/1.10*.078;details.bar([x0,y,s*(z+.003)],[x1,y,s*(z+.003)],.008,C.trim,6);}
    }
  }
  interior.face([[-3.86,2.557,-1.0],[3.79,2.54,-1.0],[3.79,2.54,1.0],[-3.86,2.557,1.0]],[0,-1,0],0xc5cfca);
  frame(paint,structure,glass,interior,[[4.04,1.46,-1.033],[4.04,1.46,1.033],[3.88,2.58,1.02],[3.88,2.58,-1.02]],[1,.15,0],.93);
  structure.bar([4.043,1.49,0],[3.884,2.557,0],.018,C.trim,8);
  frame(paint,structure,glass,interior,[[-4.04,1.46,1.033],[-4.04,1.46,-1.033],[-3.97,2.60,-1.02],[-3.97,2.60,1.02]],[-1,.1,0],.85);
  // The central aisle stays flat while side housings clear both axles.
  interior.box(0,.729,0,7.84,.082,1.25,0x637981);
  const fxs=[-3.92,3.92,-.48,.44,2.98,3.90];for(const cx of axles)for(let i=0;i<=32;i++)fxs.push(cx+(R+.07)*Math.cos(i*Math.PI/32));fxs.sort((a,b)=>a-b);
  const floor=x=>Math.max(.770,...axles.map(cx=>Math.abs(x-cx)<=R+.07?R+Math.sqrt(Math.max(0,(R+.07)**2-(x-cx)**2)):.770));
  for(let i=1;i<fxs.length;i++)for(const s of [-1,1]){
    const a=fxs[i-1],b=fxs[i];if(b-a<1e-7||(s===D&&isDoor((a+b)/2)))continue;const y0=floor(a),y1=floor(b);
    interior.face([[a,y0,s*.625],[b,y1,s*.625],[b,y1,s*1.064],[a,y0,s*1.064]],[0,1,0],0x637981);
    interior.face([[a,.770,s*.625],[b,.770,s*.625],[b,y1,s*.625],[a,y0,s*.625]],[0,0,-s],0x637981);
  }
  // Two door wells: three supported steps join the aisle without a floor across them.
  for(const x of [-.02,3.44])for(const [z,y,dep] of [[1.02,.388,.20],[.84,.556,.20],[.655,.72,.18]]){
    interior.box(x,y,D*z,.82,.10,dep,0x4e646e);details.box(x,y+.053,D*(z+.035),.80,.008,.034,0xcab456);
  }
  for(const x of [-.48,-.02,.44,2.98,3.44,3.90]){
    const[y,w]=at(x);structure.bar([x,.31,D*sideZ(x,.31)],[x,y,D*(w-.012)],.012,C.trim,6);
  }
  // Staggered paired seats leave a continuous center aisle and clear entrances.
  for(const x of [-3.34,-2.51,-1.68,-.83,.16,1.13,2.13])for(const s of [-1,1]){
    if(s===D&&isDoor(x))continue;
    interior.box(x,1.183,s*.70,.48,.14,.67,C.seat);
    interior.box(x-.246,1.566,s*.70,.085,.65,.67,C.seat,[0,0,-.045]);
    for(const z of [s*.48,s*.94])interior.bar([x-.04,.81,z],[x-.04,1.107,z],.016,C.steel,8);
    interior.bar([x-.249,1.909,s*.405],[x-.249,1.909,s*.98],.014,C.steel,8);
    details.box(x,1.255,s*.70,.436,.01,.018,0x243c4a);
  }
  interior.box(-3.61,.99,0,.65,.38,2.04,0x697e83);
  // Cab seat, separate dashboard, steering column, partition and fare machine.
  interior.box(3.10,1.205,-D*.67,.52,.16,.57,0x425762);interior.box(2.847,1.59,-D*.67,.10,.64,.57,0x425762,[0,0,-.06]);
  interior.box(2.83,1.974,-D*.67,.12,.16,.28,0x425762);
  interior.box(3.715,1.433,-D*.44,.42,.245,1.14,C.trim);
  interior.box(3.496,1.518,-D*.66,.031,.14,.39,0x2c414b);
  interior.bar([3.68,1.39,-D*.67],[3.39,1.686,-D*.67],.03,C.trim);
  const steer=new T.Matrix4().makeRotationY(Math.PI/2);steer.setPosition(3.36,1.707,-D*.67);interior.geometry(new T.TorusGeometry(.175,.016,6,24),C.trim,steer);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;interior.bar([3.36,1.707,-D*.67],[3.36,1.707+Math.cos(a)*.17,-D*.67+Math.sin(a)*.17],.012,C.trim);}
  interior.box(3.20,1.22,D*.38,.24,.86,.22,0x48636d);interior.box(3.20,1.669,D*.38,.27,.06,.25,0x6c8a91);
  interior.box(2.66,1.39,-D*.61,.038,1.23,.87,0xb2bfbc);
  // Uprights and longitudinal grab rails stop inside the glazing envelope.
  for(const s of [-1,1]){
    interior.bar([-3.60,2.27,s*.35],[2.49,2.27,s*.35],.017,0xb7a060,10);
    for(const x of [-2.80,-1.10,.75,2.5])interior.bar([x,.78,s*.35],[x,2.27,s*.35],.016,0xb7a060,8);
    for(const x of [-2.45,-1.65,-.88,.05,1.0,1.83]){interior.bar([x,2.27,s*.35],[x,2.10,s*.35],.011,C.trim,6);const m=new T.Matrix4().makeRotationY(Math.PI/2);m.setPosition(x,2.04,s*.35);interior.geometry(new T.TorusGeometry(.055,.009,5,12),0xc6c0a4,m);}
  }
  for(const x of [-3.0,-1.0,1.0,3.0])interior.box(x,2.526,0,.61,.02,.17,0xe1e4d0);
  // Permanent two-tone livery; stripes stop at glazed door openings.
  for(const s of [-1,1])for(const [a,b] of (s===-D?[[-3.92,3.74]]:[[-3.92,-.48],[.44,2.98]])){
    equipment.box((a+b)/2,1.163,s*1.122,b-a,.25,.006,C.blue);
    equipment.box((a+b)/2,1.343,s*1.122,b-a,.019,.007,0x929f9c);
  }
  for(const s of [-1,1]){
    authorVehicleLabel(equipment,'CITY TRANSIT',{center:[-1.1,1.172,s*1.130],height:.092,normal:'z',side:s,color:0xdde0d6});
    details.box(-3.36,.573,s*1.101,.81,.30,.014,C.trim);
    for(let i=0;i<7;i++)details.box(-3.36,.455+i*.040,s*1.114,.73,.014,.010,0x72868b);
    for(const x of [-3.86,.88,3.84])details.box(x,.52,s*(sideZ(x,.52)+.006),.083,.049,.012,0xbb914c);
    structure.bar([3.91,2.08,s*1.04],[3.77,2.05,s*1.17],.018,C.trim);
    structure.box(3.72,1.957,s*1.195,.125,.30,.07,C.trim,[0,s*.015,0]);details.box(3.65,1.957,s*1.195,.009,.253,.050,0xaac1c8,[0,s*.015,0]);
  }
  // Destination boards are individually modeled and retained at reduced detail.
  equipment.box(3.884,2.704,0,.145,.223,1.77,C.trim);
  authorVehicleLabel(equipment,'12 DOWNTOWN',{center:[3.961,2.710,0],height:.112,normal:'x',side:1,color:C.sign});
  equipment.box(-3.96,2.727,0,.042,.169,1.16,C.trim);
  authorVehicleLabel(equipment,'12 CENTRAL',{center:[-3.985,2.729,0],height:.092,normal:'x',side:-1,color:C.sign});
  equipment.box(2.18,2.681,D*1.060,.91,.157,.021,C.trim);
  authorVehicleLabel(equipment,'12 CITY',{center:[2.18,2.684,D*1.074],height:.085,normal:'z',side:D,color:C.sign});
  // Low-profile roof climate unit with bevels, grille and two emergency hatches.
  const ac0=[[-1.65,2.882,-.60],[.48,2.882,-.60],[.48,2.882,.60],[-1.65,2.882,.60]],ac1=[[-1.54,3.075,-.51],[.37,3.075,-.51],[.37,3.075,.51],[-1.54,3.075,.51]];
  equipment.face(ac0,[0,-1,0],0x9aaead);equipment.face(ac1,[0,1,0],0xa6b4b2);
  for(let i=0;i<4;i++){const j=(i+1)%4;equipment.face([ac0[i],ac0[j],ac1[j],ac1[i]],[i===1?1:i===3?-1:0,1,i===0?-1:i===2?1:0],0x9aaead);}
  for(let i=0;i<12;i++)details.box(-1.34+i*.13,3.08,0,.024,.009,.79,0x506a75);
  for(const x of [-2.75,2.42]){equipment.box(x,2.873,0,.63,.064,.64,C.trim);equipment.box(x,2.915,0,.55,.035,.56,0xa6b5b6);}
  for(const end of [-1,1]){
    const ring=[[-.94,.29],[-1.045,.34],[-1.051,.51],[-.98,.562],[.98,.562],[1.051,.51],[1.045,.34],[.94,.29]],a=ring.map(([z,y])=>[end*3.97,y,z]),b=ring.map(([z,y])=>[end*4.17,y,z]);
    structure.face(a,[-end,0,0],C.trim);structure.face(b,[end,0,0],C.trim);
    for(let i=0;i<8;i++){const j=(i+1)%8;structure.face([a[i],a[j],b[j],b[i]],[0,(ring[i][1]+ring[j][1])/2-.43,(ring[i][0]+ring[j][0])/2],C.trim);}
    details.box(end*4.185,.421,0,.011,.136,.414,0xd1d3c5);
  }
  structure.box(4.059,1.02,0,.028,.27,1.80,C.trim);
  for(const s of [-1,1]){
    for(const z of [s*.63,s*.83]){const m=new T.Matrix4().makeRotationZ(-Math.PI/2);m.setPosition(4.085,1.03,z);details.geometry(new T.CylinderGeometry(.078,.078,.019,24),0xd0dcd9,m);}
    details.box(4.081,.808,s*.74,.035,.064,.32,0xc79a4c);
    structure.box(-4.062,.997,s*.89,.031,.49,.126,C.trim);
    for(const [y,color] of [[.814,0xc0cfc9],[.987,0xa1393e],[1.159,0xb7924b]])details.box(-4.083,y,s*.89,.026,.122,.091,color);
    details.box(3.891,2.63,s*.92,.027,.045,.064,0xc49d55);
  }
  structure.box(-4.055,1.04,0,.020,.62,1.31,0x354850);
  for(let i=0;i<10;i++)details.box(-4.071,.79+i*.054,0,.014,.015,1.21,0x72858b);
  details.box(4.063,1.335,0,.018,.044,.41,C.steel);
  structure.bar([4.05,1.505,-.89],[3.988,1.94,-.13],.009,C.trim);structure.bar([4.05,1.505,.05],[3.988,1.94,.82],.009,C.trim);
  structure.bar([-3.26,.208,-.55],[-4.01,.212,-.77],.031,0x7a8e95,12);
  authorRoadWheel(T,wheel,{radius:R,width:dims.tireWidth,rimRatio:.62});
  return {paint:paint.finish(),structure:structure.finish(),interior:interior.finish(),glass:glass.finish(),details:details.finish(),equipment:equipment.finish(),wheel:wheel.finish()};
}
