// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Original low-level mesh authoring helpers. No app state, cache, resources,
// material globals, world APIs or timers. Approved sedan renderer is separate.
export function createVehicleMeshTools(T, dims) {
  const datum = .36 + dims.wheelDiameter/2;
  const bodyMap = p => [p[0]/2,(p[1]-datum)/2,p[2]/2];
  const wheelMap = p => p.map(v=>v/2);
  class Batch {
    constructor(map=bodyMap) {this.map=map;this.p=[];this.n=[];this.c=[];}
    triangle(a,b,c,color=0xffffff,normals=null) {
      const p=[a,b,c].map(this.map),v=p.map(q=>new T.Vector3(...q));
      const normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
      if(normal.lengthSq()<1e-16)return;normal.normalize();
      const col=new T.Color(color);
      for(let i=0;i<3;i++){this.p.push(...p[i]);this.n.push(...(normals?.[i]||normal.toArray()));this.c.push(col.r,col.g,col.b);}
    }
    face(points,outward,color=0xffffff) {
      let p=points;const [a,b,c]=p.slice(0,3).map(v=>new T.Vector3(...v));
      if(b.sub(a).cross(c.sub(a)).dot(new T.Vector3(...outward))<0)p=[...p].reverse();
      for(let i=1;i<p.length-1;i++)this.triangle(p[0],p[i],p[i+1],color);
    }
    geometry(source,color=0xffffff,matrix=new T.Matrix4()) {
      const g=source.index?source.toNonIndexed():source.clone();g.applyMatrix4(matrix);
      const p=g.attributes.position,n=g.attributes.normal;
      for(let i=0;i<p.count;i+=3){
        const ps=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]);
        const ns=n?[0,1,2].map(j=>[n.getX(i+j),n.getY(i+j),n.getZ(i+j)]):null;
        this.triangle(...ps,color,ns);
      }
      g.dispose();source.dispose();
    }
    box(x,y,z,w,h,d,color=0xffffff,rotation=null) {
      const q=rotation?new T.Quaternion().setFromEuler(new T.Euler(...rotation)):new T.Quaternion();
      this.geometry(new T.BoxGeometry(w,h,d),color,new T.Matrix4().compose(new T.Vector3(x,y,z),q,new T.Vector3(1,1,1)));
    }
    bar(a,b,r,color=0xffffff,segments=6) {
      const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);
      this.geometry(new T.CylinderGeometry(r,r,delta.length(),segments),color,new T.Matrix4().compose(start.add(end).multiplyScalar(.5),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()),new T.Vector3(1,1,1)));
    }
    // Smooth an individual sheet-metal patch while retaining panel boundaries.
    grid(rows,outward,color=0xffffff) {
      const width=rows[0].length,p=rows.flat(2),indices=[];
      for(let i=1;i<rows.length;i++)for(let j=1;j<width;j++){
        const a=(i-1)*width+j-1,b=i*width+j-1,c=i*width+j,d=(i-1)*width+j;
        const av=new T.Vector3(...rows[i-1][j-1]),bv=new T.Vector3(...rows[i][j-1]),cv=new T.Vector3(...rows[i][j]);
        if(bv.sub(av).cross(cv.sub(av)).dot(new T.Vector3(...outward))>=0)indices.push(a,b,c,a,c,d);
        else indices.push(a,c,b,a,d,c);
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(indices);g.computeVertexNormals();this.geometry(g,color);
    }
    finish(){
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));g.computeBoundingBox();g.computeBoundingSphere();g.userData.fleetSharedGeometry=true;return g;
    }
  }
  const inset=(points,scale)=>{
    const c=points[0].map((_,i)=>points.reduce((s,p)=>s+p[i],0)/points.length);
    return points.map(p=>p.map((v,i)=>c[i]+(v-c[i])*scale));
  };
  const frame=(paint,structure,glass,inside,outer,normal,scale=.92)=>{
    const seal=inset(outer,scale),pane=inset(seal,.973);
    for(let i=0;i<4;i++){const j=(i+1)%4;
      paint.face([outer[i],outer[j],seal[j],seal[i]],normal);
      structure.face([seal[i],seal[j],pane[j],pane[i]],normal,0x20272c);
      inside.face([outer[i],outer[j],seal[j],seal[i]],normal.map(v=>-v),0x41464a);
    }
    glass.face(pane,normal,0x8ca4ad);return pane;
  };
  return {Batch,bodyMap,wheelMap,inset,frame};
}

// A complete ordinary road wheel, with a smooth closed rubber annulus,
// recessed steel ventilation slots, rim flange, hub and wheel nuts.
export function authorRoadWheel(T,batch,{radius,width,rimRatio=.62,slots=10}) {
  const r=radius,half=width/2,rim=r*rimRatio;
  const profile=[[rim*.97,-half*.91],[r*.80,-half],[r*.925,-half*.81],[r*.989,-half*.53],[r,-half*.28],[r,half*.28],[r*.989,half*.53],[r*.925,half*.81],[r*.80,half],[rim*.97,half*.91],[rim*.97,-half*.91]];
  batch.geometry(new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),40),0x202529);
  batch.geometry(new T.CylinderGeometry(rim*.91,rim*.91,width*.80,32),0x3e454a);
  const segments=slots*8;
  for(const side of [-1,1]) {
    const y=side*half*.94;
    const polar=(rr,a,depth=0)=>[Math.cos(a)*rr,y+side*depth,Math.sin(a)*rr];
    for(let i=0;i<segments;i++) {
      const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments;
      for(const [r0,r1,depth,skip] of [[rim*.32,rim*.57,.010,false],[rim*.57,rim*.85,.004,i%8>=2&&i%8<=5],[rim*.85,rim,0,false],[rim,rim*1.045,-.004,false]]) {
        if(skip)continue;
        batch.face([polar(r0,a,depth),polar(r0,b,depth),polar(r1,b,depth),polar(r1,a,depth)],[0,side,0],0xadb4b9);
      }
    }
    batch.geometry(new T.CylinderGeometry(rim*.32,rim*.32,.025,24),0x6b747b,new T.Matrix4().makeTranslation(0,side*(half*.94+.009),0));
    for(let i=0;i<5;i++) {
      const a=i*Math.PI*2/5;
      batch.geometry(new T.CylinderGeometry(.011,.011,.012,6),0xc4c8cb,new T.Matrix4().makeTranslation(Math.cos(a)*rim*.44,side*(half*.94+.017),Math.sin(a)*rim*.44));
    }
  }
}

const GLYPHS={T:['111','010','010','010','010'],A:['010','101','111','101','101'],X:['101','101','010','101','101'],I:['111','010','010','010','111']};
export function authorTaxiLettering(batch,{center,height,normal,side=1,color=0x202629,slant=0}) {
  const unit=height/5,total=15*unit;
  for(const [letterIndex,ch] of [...'TAXI'].entries())for(let row=0;row<5;row++)for(let col=0;col<3;col++) {
    if(GLYPHS[ch][row][col]!=='1')continue;
    const u=(letterIndex*4+col+.5)*unit-total/2,v=(2-row)*unit;
    if(normal==='x')batch.box(center[0]+slant*v,center[1]+v,center[2]-side*u,.003,unit*.91,unit*.91,color);
    else batch.box(center[0]+side*u,center[1]+v,center[2],unit*.91,unit*.91,.003,color);
  }
}
