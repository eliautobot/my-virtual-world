// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original full-size fleet taxi, authored independently of the approved
// compact/midsize sedan. Distinct body sections, cabin, lamps and equipment.
import { createVehicleMeshTools, authorRoadWheel, authorTaxiLettering } from './vehicle-mesh-tools.mjs';

export function buildTaxiTemplates(T,dims) {
  const {Batch,wheelMap,inset,frame}=createVehicleMeshTools(T,dims);
  const paint=new Batch(),structure=new Batch(),interior=new Batch(),glass=new Batch(),details=new Batch(),equipment=new Batch(),wheel=new Batch(wheelMap);
  const C={black:0x232b30,rubber:0x202529,steel:0xa9b1b6,chrome:0xc0c6c9,seat:0x42494d,cabin:0x353e43};
  const stations=[[-2.48,.90,.88],[-2.37,.934,.915],[-2.13,.979,.95],[-1.80,1.004,.965],[-1.56,1.01,.97],[-.70,1.015,.97],[.30,1.012,.97],[.91,1.005,.97],[1.42,.978,.965],[1.96,.943,.949],[2.28,.919,.915],[2.48,.915,.88]];
  const at=x=>{
    for(let i=1;i<stations.length;i++)if(x<=stations[i][0]){const a=stations[i-1],b=stations[i],t=(x-a[0])/(b[0]-a[0]);return[a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];}
    return stations.at(-1).slice(1);
  };
  const R=dims.wheelDiameter/2,arch=R+.039,sill=.225,axles=[dims.rearAxle,dims.frontAxle];
  const floor=x=>Math.max(sill,...axles.map(cx=>Math.abs(x-cx)<=arch?R+Math.sqrt(Math.max(0,arch**2-(x-cx)**2)):sill));
  const sideZ=(x,y)=>{const[top,w]=at(x);return y>top-.060?w-.035+(top-y)/.060*.035:w-.045*Math.max(0,Math.min(1,(top-.23-y)/.55));};
  const stops=stations.map(s=>s[0]);
  for(const x of axles){for(let i=0;i<=32;i++)stops.push(x+arch*Math.cos(i*Math.PI/32));stops.push(x-arch-.00001,x+arch+.00001);}
  stops.sort((a,b)=>a-b);const xs=stops.filter((x,i)=>x>=-2.48&&x<=2.48&&(i===0||x-stops[i-1]>1e-7));
  // Smooth long shoulder panels, deep closed sills and a real open cabin.
  for(let i=1;i<xs.length;i++) {
    const a=xs[i-1],b=xs[i],[ya,wa]=at(a),[yb,wb]=at(b),cabin=(a+b)/2>-1.56&&(a+b)/2<.91;
    for(const side of [-1,1]) {
      const rows=(x,y,w)=>{const low=floor(x),middle=Math.max(low,y-.21);return [[x,y,side*(w-.035)],[x,y-.060,side*w],[x,middle,side*sideZ(x,middle)],[x,low,side*sideZ(x,low)]];};
      const pa=rows(a,ya,wa),pb=rows(b,yb,wb);
      for(let j=0;j<3;j++)paint.face([pa[j],pb[j],pb[j+1],pa[j+1]],[0,0,side]);
      structure.face([pa[3],pb[3],[b,floor(b),side*.692],[a,floor(a),side*.692]],[0,-1,side*.1],C.rubber);
      if(cabin){
        paint.face([[a,ya,side*(wa-.035)],[b,yb,side*(wb-.035)],[b,yb,side*.831],[a,ya,side*.831]],[0,1,0]);
        interior.face([[a,ya,side*.831],[b,yb,side*.831],[b,.345,side*.803],[a,.345,side*.803]],[0,0,-side],C.cabin);
      } else {
        paint.grid([[[a,ya,side*(wa-.035)],[a,ya+.014,0]],[[b,yb,side*(wb-.035)],[b,yb+.014,0]]],[0,1,0]);
      }
    }
  }
  for(const end of [-1,1]) {
    const x=end*2.48,[y,w]=at(x);
    paint.face([[x,sill,-w+.045],[x,sill,w-.045],[x,y-.060,w],[x,y,w-.035],[x,y+.014,0],[x,y,-w+.035],[x,y-.060,-w]],[end,0,0]);
  }
  structure.box(0,.272,0,4.96,.094,1.384,C.rubber);
  interior.box(-.30,.385,0,2.41,.075,1.60,C.cabin);
  interior.box(-.31,.46,0,2.05,.14,.22,C.black);
  for(const cx of axles)for(const side of [-1,1])for(let i=0;i<32;i++) {
    const a=i*Math.PI/32,b=(i+1)*Math.PI/32,p=(theta,r,z)=>[cx+Math.cos(theta)*r,R+Math.sin(theta)*r,side*z];
    const za=sideZ(cx+Math.cos(a)*arch,R+Math.sin(a)*arch),zb=sideZ(cx+Math.cos(b)*arch,R+Math.sin(b)*arch);
    paint.face([p(a,arch,za+.001),p(b,arch,zb+.001),p(b,arch+.013,zb+.001),p(a,arch+.013,za+.001)],[0,0,side]);
    structure.face([p(a,arch,za),p(a,arch,.692),p(b,arch,.692),p(b,arch,zb)],[0,-1,0],C.rubber);
    const inner=[p(a,arch,.692),p(b,arch,.692),[cx,R,side*.692]];
    structure.face(inner,[0,0,side],C.rubber);structure.face(inner,[0,0,-side],C.rubber);
  }
  // Close the short return between the half-round wheel tub and floor pan.
  for(const cx of axles)for(const side of [-1,1])structure.box(cx,R-.040,side*.689,arch*2,.081,.010,C.rubber);

  // Rounded roof crown over an independently dimensioned, roomier cab.
  const roof=[[-.97,1.44,.708],[-.83,1.50,.735],[-.55,1.524,.746],[-.20,1.528,.748],[.16,1.515,.734],[.30,1.47,.72]];
  const railY=x=>1.44+(x+.97)/1.27*.03,railZ=x=>.708+(x+.97)/1.27*.012;
  for(const side of [-1,1]) {
    paint.grid(roof.map(([x,y,z])=>[[x,y,side*z],[x,Math.min(1.54,y+.012),0]]),[0,1,0]);
    for(let i=1;i<roof.length;i++) {
      const a=roof[i-1],b=roof[i];
      paint.face([[a[0],a[1],side*a[2]],[b[0],b[1],side*b[2]],[b[0],railY(b[0]),side*railZ(b[0])],[a[0],railY(a[0]),side*railZ(a[0])]],[0,0,side]);
    }
  }
  interior.face([[-.95,1.425,-.70],[.28,1.452,-.712],[.28,1.452,.712],[-.95,1.425,.70]],[0,-1,0],0x686d70);
  frame(paint,structure,glass,interior,[[.91,1.005,-.831],[.91,1.005,.831],[.30,1.47,.72],[.30,1.47,-.72]],[1,1,0],.945);
  frame(paint,structure,glass,interior,[[-1.56,1.01,.831],[-1.56,1.01,-.831],[-.97,1.44,-.708],[-.97,1.44,.708]],[-1,1,0],.925);
  for(const side of [-1,1]) {
    const P=(x,y,z)=>[x,y,side*z],A=P(.91,1.005,.831),At=P(.30,1.47,.72),B=P(-.29,1.012,.831),Bt=P(-.26,railY(-.26),railZ(-.26)),Ct=P(-.97,1.44,.708),C0=P(-1.56,1.01,.831);
    frame(paint,structure,glass,interior,[A,At,Bt,B],[0,.1,side],.915);
    frame(paint,structure,glass,interior,[B,Bt,Ct,C0],[0,.1,side],.89);
    structure.face([P(-.318,1.015,.833),P(-.288,1.448,.717),P(-.232,1.448,.717),P(-.262,1.015,.833)],[0,0,side],C.black);
    const seams=[[[.87,.999],[.77,.75],[.77,.267],[-.29,.267],[-.29,1.005]],
      [[-.29,1.005],[-.29,.267],[-1.00,.267],[-1.075,.49],[-1.29,.75],[-1.525,1.002]]];
    for(const line of seams)for(let i=1;i<line.length;i++) {
      const[a,b]=[line[i-1],line[i]];
      details.bar(P(a[0],a[1],sideZ(a[0],a[1])+.002),P(b[0],b[1],sideZ(b[0],b[1])+.002),.0028,0x4d4734,4);
    }
    for(const x of [-.03,-1.12]) {
      details.box(x,.879,side*(sideZ(x,.879)+.006),.178,.045,.008,C.black);
      details.box(x,.886,side*(sideZ(x,.886)+.014),.158,.022,.015,C.chrome);
    }
    // Slim impact molding and restrained checker stripe on the actual doors.
    for(let i=0;i<22;i++) {
      const x=-1.09+i*.080;
      if(i%2===0)details.box(x,.827,side*(sideZ(x,.827)+.006),.078,.024,.004,C.black);
    }
    details.box(-.18,.566,side*(sideZ(-.18,.566)+.007),1.72,.045,.013,C.black);
    authorTaxiLettering(details,{center:[.22,.704,side*(sideZ(.22,.704)+.008)],height:.105,normal:'z',side:side>0?1:-1});
    // Full mirror housings with reflective insets, no hovering slabs.
    structure.bar(P(.74,1.04,.84),P(.66,1.071,.925),.02,C.black);
    const front=[P(.78,1.019,.916),P(.77,1.116,.931),P(.75,1.108,1.036),P(.75,1.026,1.045)];
    const back=[P(.56,1.019,.916),P(.55,1.105,.931),P(.55,1.098,1.027),P(.54,1.026,1.035)];
    paint.face(front,[1,0,0]);structure.face(back,[-1,0,0],C.black);
    for(let i=0;i<4;i++){const j=(i+1)%4;paint.face([front[i],front[j],back[j],back[i]],[0,i===1?1:i===3?-1:0,i===0?-side:side]);}
    details.face(inset(back,.8).map(p=>[p[0]-.003,p[1],p[2]]),[-1,0,0],0x99aeb7);
  }
  // Occupied-volume cabin: front seats, rear bench, door cards and taxi meter.
  for(const side of [-1,1]) {
    interior.box(-.17,.595,side*.43,.62,.17,.57,C.seat);
    interior.box(-.42,.895,side*.43,.16,.55,.57,C.seat,[0,0,-.12]);
    interior.box(-.44,1.19,side*.43,.14,.17,.285,C.seat);
    interior.box(-.30,.62,side*.789,2.12,.42,.036,C.cabin);
    interior.box(-.03,.817,side*.763,.34,.05,.06,C.black);
  }
  interior.box(-1.11,.615,0,.57,.18,1.47,C.seat);
  interior.box(-1.27,.875,0,.15,.45,1.47,C.seat,[0,0,-.10]);
  for(const z of [-.45,.45])interior.box(-1.16,1.145,z,.12,.12,.25,C.seat);
  interior.box(.66,.915,0,.41,.19,1.56,C.black);
  // The driver sits on the left (-z: vehicle forward is +x), as in the US (2026-10-06).
  interior.box(.50,.951,-.43,.12,.10,.33,0x141e24);
  interior.bar([.56,.85,-.43],[.40,.994,-.43],.025,C.black);
  const steering=new T.Matrix4().makeRotationY(Math.PI/2);steering.setPosition(.40,1.005,-.43);
  interior.geometry(new T.TorusGeometry(.135,.012,6,24),C.black,steering);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;interior.bar([.40,1.005,-.43],[.40,1.005+Math.cos(a)*.13,-.43+Math.sin(a)*.13],.01,C.black);}
  interior.box(.65,1.047,.10,.16,.10,.25,0x232a30);
  interior.box(.563,1.06,.10,.009,.045,.20,0x92a896);
  interior.box(.23,.727,0,.08,.14,.075,C.black);
  // Passenger partition: solid lower panel plus framed transparent upper panel.
  interior.box(-.70,.704,0,.035,.48,1.45,C.cabin);
  glass.face([[-.70,.944,-.73],[-.70,.944,.73],[-.70,1.39,.71],[-.70,1.39,-.71]],[1,0,0],0xa6bbc3);
  for(const z of [-.73,.73])interior.bar([-.70,.93,z],[-.70,1.39,z*.973],.011,C.black);
  interior.bar([-.70,1.39,-.71],[-.70,1.39,.71],.011,C.black);
  structure.bar([.81,1.023,-.65],[.61,1.105,-.10],.006,C.black);
  structure.bar([.84,1.023,.01],[.64,1.105,.61],.006,C.black);

  // Broad rectangular fleet-saloon headlamps and chrome egg-crate grille.
  structure.box(2.492,.763,0,.025,.247,1.74,C.black);
  for(const y of [.648,.873])details.box(2.512,y,0,.012,.013,1.71,C.chrome);
  for(const z of [-.849,.849])details.box(2.512,.760,z,.012,.230,.013,C.chrome);
  for(let i=0;i<7;i++)details.box(2.517,.674+i*.027,0,.011,.006,.80,C.steel);
  for(let i=0;i<9;i++)details.box(2.518,.760,-.35+i*.0875,.010,.17,.006,C.steel);
  for(const side of [-1,1]) {
    details.box(2.518,.770,side*.626,.024,.175,.379,0xc3ced0);
    for(let i=0;i<7;i++)details.box(2.532,.770,side*.626+(-.15+i*.05),.002,.164,.002,0x98aeb4);
    details.box(2.519,.765,side*.815,.026,.166,.090,0xc88834);
    details.box(2.50,.578,side*.72,.025,.044,.145,0xb98d47);
    structure.box(-2.49,.794,side*.632,.028,.205,.410,C.black);
    details.box(-2.512,.803,side*.642,.020,.172,.335,0x902c31);
    details.box(-2.526,.803,side*.775,.013,.151,.054,0xb18540);
    details.box(-2.525,.766,side*.535,.013,.064,.082,0xc0c8c7);
    details.box(1.99,.739,side*(sideZ(1.99,.739)+.005),.088,.038,.01,0xb7833b);
  }
  for(const end of [-1,1]) {
    const shape=[[-.89,.36],[-.95,.402],[-.967,.51],[-.918,.563],[.918,.563],[.967,.51],[.95,.402],[.89,.36]];
    const a=shape.map(([z,y])=>[end*2.42,y,z]),b=shape.map(([z,y])=>[end*2.56,y,z]);
    structure.face(a,[-end,0,0],C.black);structure.face(b,[end,0,0],C.black);
    for(let i=0;i<shape.length;i++){const j=(i+1)%shape.length,n=[0,(shape[i][1]+shape[j][1])/2-.46,(shape[i][0]+shape[j][0])/2];structure.face([a[i],a[j],b[j],b[i]],n,C.black);}
    details.box(end*2.565,.543,0,.008,.018,1.79,C.chrome);
    details.box(end*2.568,.446,0,.010,.128,.365,0x151f25);
    details.box(end*2.575,.446,0,.006,.108,.342,0xd0ba7a);
  }
  for(const side of [-1,1])for(const [ends,z] of [[[.94,1.42,1.96,2.29],.80],[[-1.59,-1.80,-2.13,-2.36],.795]])for(let i=1;i<ends.length;i++) {
    const surface=x=>[x,at(x)[0]+.004,side*z];details.bar(surface(ends[i-1]),surface(ends[i]),.0025,0x777047,4);
  }
  structure.bar([-2.22,.24,-.48],[-2.53,.24,-.48],.034,0x717a80,12);

  // Taxi identity remains visible at far LOD. Sign is a fully enclosed lamp,
  // not a floating label or a copy of an existing game's asset/texture.
  equipment.box(-.19,1.558,0,.52,.055,.79,C.black);
  const sign=[[-.382,1.586,-.38],[-.382,1.586,.38],[-.358,1.785,.35],[-.358,1.785,-.35]];
  const front=sign.map(p=>[p[0]+.42,p[1],p[2]]);
  equipment.face(front,[1,0,0],0xeee8cf);equipment.face(sign,[-1,0,0],0xeee8cf);
  for(let i=0;i<4;i++){const j=(i+1)%4;equipment.face([sign[i],sign[j],front[j],front[i]],[0,i===0?-1:i===2?1:0,i===1?1:-1],0xeee8cf);}
  authorTaxiLettering(equipment,{center:[.053,1.690,0],height:.12,normal:'x',side:1,slant:.12});
  authorTaxiLettering(equipment,{center:[-.372,1.690,0],height:.12,normal:'x',side:-1,slant:.12});
  authorRoadWheel(T,wheel,{radius:R,width:dims.tireWidth,rimRatio:.62});
  return {paint:paint.finish(),structure:structure.finish(),interior:interior.finish(),glass:glass.finish(),details:details.finish(),equipment:equipment.finish(),wheel:wheel.finish()};
}
