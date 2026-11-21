// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as T from 'three';
import turntableHair from '/assets/builder/turntable-hair.js';
import {addFittedRoots} from './hair-roots.js';
import {addStudioHair} from './hair-styles.js';
import {tripoHair, tripoHairStart} from './tripo-hair-catalog.js';
import {addTripoHair} from './tripo-hair.js';

// Guides use the bind space of the supplied GLBs. The surfaces are closed
// sculptural clumps, with progressively narrower cross sections at the ends.
// Coordinates in the guide tables are millimetres on the one-unit character.
const pi=Math.PI, tau=2*pi, lerp=T.MathUtils.lerp;
const sat=t=>Math.max(0,Math.min(1,t));
const smooth=(a,b,t)=>{const v=sat((t-a)/(b-a));return v*v*(3-2*v)};
const v=(x,y,z)=>new T.Vector3(x,y,z);
const hairCache = new Map();
function referenceHair(female, color, material, add, scalp, bareCranium) {
  const sex = female ? 'female' : 'male';
  let saved = hairCache.get(sex);
  if (!saved) {
    const packet=turntableHair[sex];
    const bytes = (s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
    const xyz=new Uint16Array(bytes(packet.xyz).buffer), ns=new Int8Array(bytes(packet.n).buffer), ao=bytes(packet.ao);
    const p=new Float32Array(xyz.length), n=new Float32Array(xyz.length), colors=new Float32Array(xyz.length);
    const angles=female?-.052:0, co=Math.cos(angles),si=Math.sin(angles);
    const move=female?[-.0023,.026,-.0155]:[-.0002,.0365,.011];
    for(let i=0;i<xyz.length;i+=3){
      const q=[0,1,2].map(k=>packet.min[k]+xyz[i+k]/65535*(packet.max[k]-packet.min[k]));
      // Move just the hanging braid toward the nape centre line. The turntable
      // shows the tail behind the neck; its tie and scalp remain on the sculpt.
      if(female) {
        const fall=(1-smooth(.790,.928,q[1]))*(1-smooth(-.043,-.014,q[2]));
        const tail=(1-smooth(.840,.935,q[1]))*(1-smooth(-.043,-.014,q[2]));
        q[0]+=.023*fall; q[2]-=.013*fall; q[1]-=.034*tail;
      }
      p[i]=co*q[0]+si*q[2]+move[0];p[i+1]=q[1]+move[1];p[i+2]=-si*q[0]+co*q[2]+move[2];
      n[i]=(co*ns[i]+si*ns[i+2])/127;n[i+1]=ns[i+1]/127;n[i+2]=(-si*ns[i]+co*ns[i+2])/127;
      const shade=.48+.52*Math.pow(ao[i/3]/255,1.22);
      colors[i]=shade;colors[i+1]=shade*.992;colors[i+2]=shade*.985;
    }
    saved={p,n,colors,indices:new Uint16Array(bytes(packet.tri).buffer)};hairCache.set(sex,saved);
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(saved.p.slice(),3));
  g.setAttribute('normal',new T.BufferAttribute(saved.n.slice(),3));
  g.normalizeNormals();
  g.setAttribute('color',new T.BufferAttribute(saved.colors,3));g.setIndex(new T.BufferAttribute(saved.indices,1));
  if(bareCranium){
    // The bare foundation has a different cranium from the corresponding
    // portrait sculpt. Give its crown a fitted backplate using actual scalp
    // samples, and move only the covered upper sections of the detailed groom.
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const crown=smooth(.929,.987,y), side=smooth(.038,.065,Math.abs(x))*smooth(.901,.925,y);
      const lift=(female?.009:.0025)*crown;
      p.setXYZ(i,x*(1+.026*crown+.015*side),y+lift,z-.0005*crown);
    }
    const cap=surface(38,112,(t,u)=>{
      const a=tau*(u-.5),ca=Math.cos(a),front=(ca+1)*.5;
      const end=lerp(2.49,1.30,front)-.10*Math.sin(a)**2;
      const p=.00001+t*end, cp=Math.cos(p),sp=Math.sin(p),s=scalp(a,p),rim=smooth(.96,1,t);
      const offset=.0017-.0038*rim;
      return [v(s[0]+Math.sin(a)*sp*offset,s[1]+cp*offset,s[2]+ca*sp*offset),color.clone().multiplyScalar(.76)];
    },true);
    add('Fitted scalp underlay',cap,material('white',true,{roughness:.66}));
  }
  const m=material(color,true,{roughness:female?.54:.49,metalness:0});
  m.name=female?'Chestnut sculpt • satin':'Swept sculpt • satin';
  add(female?'Tied crown and tapered ponytail':'Swept forelock and layered nape',g,m);
  if(!female) featherNape(saved.p, color, material, add);
}

// The static reference sculpt has a nearly continuous nape. The video has
// overlapping, pointed courses, so fit those onto its *actual* outer surface.
let napePack;
function featherNape(points,color,material,add) {
  if(!napePack) {
    const positions=[],normals=[],indices=[],values=[];
    const vertices=[];
    for(let j=0;j<points.length;j+=3) {
      const x=points[j]+.0002,y=points[j+1]-.0365,z=points[j+2]-.011;
      vertices.push([Math.atan2(x,z),y,Math.hypot(x,z)]);
    }
    const cells = new Map(), key=(a,y)=>((a%128+128)%128)+128*y;
    for(const point of vertices){
      const ai=Math.floor((point[0]+pi)/tau*128),yi=Math.floor(point[1]/.005),k=key(ai,yi);
      if(!cells.has(k)) cells.set(k,[]);
      cells.get(k).push(point);
    }
    function radius(a,y) {
      let max=-1;
      const ai=Math.floor((a+pi)/tau*128),yi=Math.floor(y/.005);
      for(let da=-6;da<=6;da++)for(let dy=-5;dy<=5;dy++){
        for (const [b,h,r] of cells.get(key(ai+da,yi+dy))??[]) {
          let delta=b-a;if(delta < -pi)delta+=tau;if(delta>pi)delta-=tau;
          const dist=Math.hypot(delta*.064,(y-h)*.82);
          if(dist<.023)max=Math.max(max,r-.90*dist);
        }
      }
      return max>0 ? max : .050;
    }
    for(let band=0;band<2;band++)for(let k=0;k<(band?8:9);k++){
      const a0=band ? 2.00+k*.326 : 2.02+k*.279;
      const back=(1-Math.cos(a0))*.5, offset=.0022*Math.sin(3.6*k+.8*band);
      const top=band?.952+offset:.911+offset,bottom=(band?.891:.840)+.029*(1-back)+offset;
      const spine=[];
      for(let i=0;i<19;i++){
        const t=i/18,a=a0-.135*(1-t)+.075*Math.sin(t*pi)+.034*t*Math.sin(k*2.0),y=lerp(top,bottom,t);
        const r=radius(a,y);
        spine.push(v(Math.sin(a)*r-.0002,y+.0365,Math.cos(a)*r+.011));
      }
      for(let pass=0;pass<3;pass++){const s=spine.map(p=>p.clone());for(let i=1;i<s.length-1;i++)spine[i].copy(s[i-1]).addScaledVector(s[i],2).add(s[i+1]).multiplyScalar(.25)}
      const curve=new T.CatmullRomCurve3(spine);
      const geo=surface(24,20,(t,u)=>{
        const p=curve.getPoint(t),d=curve.getTangent(t).normalize();
        const rad=v(p.x+.0002,(p.y-.936)*.6,p.z-.011).normalize(),widthAxis=v().crossVectors(rad,d).normalize(),out=v().crossVectors(d,widthAxis).normalize();
        const env=smooth(0,.31,t)**.55*(1-smooth(.48,1,t))**.71,
          width=(band?.0145:.0128)*env,thick=(band?.0078:.0060)*env;
        const angle=tau*u, valley=Math.cos(angle*2+.17*t);
        p.addScaledVector(out,-.0018+thick*Math.sin(angle)-.0048*(1-smooth(.02,.42,t))+.0019*smooth(.82,1,t));
        p.addScaledVector(widthAxis,width*Math.cos(angle));
        return [p,new T.Color().setScalar(.96+.075*Math.sin(angle)+.026*valley+.035*Math.sin(k*1.37))];
      });
      const base=positions.length/3;
      positions.push(...geo.attributes.position.array);normals.push(...geo.attributes.normal.array);values.push(...geo.attributes.color.array);
      for(const index of geo.index.array)indices.push(base+index);
      geo.dispose();
    }
    napePack={positions,normals,values,indices};
  }
  const g=new T.BufferGeometry();
  for(const [k,arr] of [['position',napePack.positions],['normal',napePack.normals],['color',napePack.values]])g.setAttribute(k,new T.Float32BufferAttribute(arr,3));
  g.setIndex(napePack.indices);
  add('Overlapping nape locks',g,material(color,true,{roughness:.54}));
}
function surface(rings,sides,sample,invert=false){
  const p=[],c=[],index=[];
  for(let i=0;i<=rings;i++)for(let j=0;j<sides;j++){
    const [q,s]=sample(i/rings,j/sides);
    p.push(q.x,q.y,q.z);c.push(s.r,s.g,s.b);
    if(i){const a=(i-1)*sides+j,b=(i-1)*sides+(j+1)%sides,aa=a+sides,bb=b+sides;
      if(!invert) index.push(a,b,bb,a,bb,aa);else index.push(a,bb,b,a,aa,bb);}
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('color',new T.Float32BufferAttribute(c,3));
  g.setIndex(index);g.computeVertexNormals();return g;
}

export function sculptHair(style,female,color,scalp,material,add,bareCranium=false,skin) {
  const reference=tripoHair[female?'female':'male'][style-tripoHairStart];
  if(!bareCranium)addFittedRoots(female,style>=3?0:style,color,material,add,reference?.fade?skin:null);
  if(reference)return addTripoHair(female,style-tripoHairStart,color,material,add,skin);
  if(style>=3)return addStudioHair(female,style-3,color,material,add,skin);
  if (style===0) return referenceHair(female,color,material,add,scalp,bareCranium);
  const m=material('white',true,{roughness:.48}),isBob=female&&style===1,isPony=female&&style===0,isKnot=female&&style===2;
  const crop=!female&&style===2;
  // With a stable outward guide the wide axis travels *across* a lock. This
  // preserves its ribbon-like silhouette even through a curved forelock.
  function lock(name,points,width,thick,opts={}){
    const curve=new T.CatmullRomCurve3(points.map(p=>v(...p).multiplyScalar(.001)),false,'centripetal');
    const ns=opts.steps??36, rings=[];
    const attached=opts.front&&!name.includes('Long temple');
    const origin=v(0,.941,.003);
    function guide(t){
      const q=curve.getPoint(t);
      if(!attached)return q;
      const d=q.clone().sub(origin),radius=d.length();
      const a=Math.atan2(d.x,d.z),p=Math.atan2(Math.hypot(d.x,d.z),d.y);
      const skull=v(...scalp(a,p)).sub(origin).length();
      const rise=.0016+(isBob?.0053:isKnot?.0061:crop?.0042:.0072)
        *smooth(.05,.34,t)*(1-.51*smooth(.68,1,t));
      const length=T.MathUtils.clamp(radius,skull+rise-.0011,skull+rise+.0011);
      return d.multiplyScalar(length/radius).add(origin);
    }
    for(let i=0;i<=ns;i++){
      const t=i/ns,center=guide(t);
      const d=guide(Math.min(1,t+.003)).sub(guide(Math.max(0,t-.003))).normalize();
      let outside;
      if(attached)outside=v(center.x/.055**2,(center.y-.941)/.063**2,(center.z-.003)/.068**2).normalize();
      else if(opts.front)outside=v(center.x*5.5,Math.max(0,center.y-.968)*10,1).normalize();
      else if(opts.axis)outside=v(...opts.axis);
      else outside=v(center.x/(.055**2),(center.y-.944)/(.068**2),(center.z+.002)/(.070**2)).normalize();
      let across=v().crossVectors(outside,d);
      if(across.lengthSq()<.0001) across.crossVectors(v(1,0,0),d);
      across.normalize();const normal=v().crossVectors(d,across).normalize();
      rings.push({center,d,across,normal});
    }
    const tint=color.clone().multiplyScalar(opts.value??1);
    const g=surface(ns,24,(t,u)=>{
      const {center,across,normal}=rings[Math.round(t*ns)],a=tau*u;
      const root=.015+.985*smooth(0,opts.root??.24,t)**.60;
      const tip=.006+.994*(1-smooth(opts.tip??.51,1,t))**.67;
      const env=root*tip,flow=Math.cos((opts.ribs??2)*a+.45*t);
      const w=width*.001*env*(1+.045*flow),h=thick*.001*env*(1+.045*flow);
      const co=Math.cos(a),si=Math.sin(a),q=center.clone().addScaledVector(across,co*w).addScaledVector(normal,si*h);
      // Fill the underside through the crown on the actual GLB. This is
      // essential at the part: a curve laid out only in the portrait plane
      // can look attached from the front and lift clear of the head in profile.
      if(opts.front && !name.includes('Long temple') && si<0){
        const d=q.clone().sub(v(0,.941,.003)),rad=d.length(),angle=Math.atan2(d.x,d.z),polar=Math.atan2(Math.hypot(d.x,d.z),d.y);
        const bind=scalp(angle,polar),surfaceRadius=v(...bind).sub(v(0,.941,.003)).length();
        const fill=Math.min(.034,Math.max(0,rad-surfaceRadius+.0013));
        q.addScaledVector(d,-fill/rad*(-si)**.68*(1-.62*smooth(.91,1,t)));
      }
      return [q,tint.clone().multiplyScalar(.95+.052*flow+.045*si-.07*(1-env))];
    });add(name,g,m);
  }
  const fringe=(name,points,width,thick,opts={})=>lock(name,points,width,thick,{front:true,...opts});

  if(isPony||isKnot){
    if(isPony){
      // An offset pony reads from the front and falls down the back to the
      // shoulder. Its smaller companion clumps break up the outer contour.
      const swing=[[-16,986,-29],[-26,995,-56],[-37,986,-69],[-45,960,-70],[-47,929,-63],[-53,898,-52],[-58,871,-43],[-54,849,-37],[-63,823,-31],[-70,806,-25]];
      lock('High pony • central fall',swing,23.5,16,{axis:[0,0,-1],root:.21,tip:.70,ribs:3});
      lock('High pony • outside lock',[[-22,990,-43],[-39,982,-65],[-48,945,-63],[-52,914,-53],[-63,885,-43],[-71,866,-38],[-77,858,-33]],13.5,10,{axis:[0,0,-1],tip:.54,value:.91});
      lock('High pony • inner curl',[[-26,986,-47],[-30,952,-75],[-34,912,-72],[-39,885,-62],[-38,860,-48],[-42,831,-35],[-50,815,-26]],15,12,{axis:[0,0,-1],tip:.64,value:1.05});
    }else{
      lock('Coiled chignon',[[1,977,-33],[0,994,-39],[-3,1009,-42],[-3,1023,-37],[5,1027,-31]],25,21,{axis:[0,0,-1],root:.38,tip:.46,ribs:5});
      lock('Chignon fold',[[-15,990,-35],[-22,1001,-36],[-16,1014,-29],[0,1019,-26],[12,1014,-28],[17,1005,-35]],7,5,{axis:[0,0,-1],value:1.06});
    }
    const lift=isKnot?4:0;
    for(const sign of [-1,1]){
      const path=[[37,974,31],[46,955,35],[50,933,38],[49,910,37],[49,886,36],[48,860,32],[47,842,29]].map(([x,y,z],i)=>[sign*x,y+(isKnot?Math.max(0,i-2)*8:0),z]);
      fringe('Long temple taper '+sign,path,isKnot?4.0:5.5,3.8,{root:.15,tip:.46,value:.90});
    }
    fringe('Parted fringe • broad sweep',[[8,1004,9],[5,999,26],[-3,989,44],[-17,974,59],[-31,958+lift,62],[-43,941+lift,53],[-50,925+lift,40]],14.8,6.4,{root:.16,tip:.49});
    fringe('Fringe • foundation fold',[[1,995,17],[-15,983,39],[-30,965,53],[-42,947+lift,54],[-47,936+lift,45]],10.2,5.6,{value:.90});
    fringe('Parted fringe • inside fold',[[11,999,18],[10,990,40],[5,979,58],[-4,965,70],[-16,950+lift,72],[-29,941+lift,65]],8.7,4.8,{root:.18,tip:.43,value:1.04});
    fringe('Parted fringe • opposite sweep',[[6,1002,12],[16,998,28],[29,982,44],[39,967,53],[46,949+lift,51],[49,933+lift,42],[48,917+lift,38]],12,5.8,{root:.19,tip:.58,value:.97});
    fringe('Side part • temple roll',[[-8,1004,-6],[-25,998,8],[-43,982,22],[-53,963,32],[-56,945,31],[-52,926,30]],10.5,5.5,{value:.92});
  }else if(isBob){
    // Overlapping, softly curved panels build a blunt bob from the occipital
    // bone into the curved hem; the cheek-facing panels angle inwards.
    for(let i=0;i<15;i++){
      const a=.88+i*(tau-1.76)/14,s=Math.sin(a),c=Math.cos(a),hem=3*Math.cos(a*3)+3.5*c;
      lock('Bob • turned panel '+i,[[s*26,993,c*28],[s*48,975,c*54],[s*58,945,c*64],[s*61,917,c*65],[s*60,895,c*62],[s*53,878+hem,c*57],[s*46,875+hem,c*51]],14.3,5.9,{root:.12,tip:.75,axis:[s,0,c],value:.98+.026*Math.cos(a*2)});
    }
    fringe('Bob • diagonal fringe',[[24,995,15],[13,995,40],[-6,979,59],[-23,961,69],[-37,948,60],[-49,936,44]],17,6,{root:.18,tip:.53});
    fringe('Bob • diagonal underside',[[20,991,30],[15,980,56],[1,963,71],[-24,946,65]],9.5,4.5,{value:1.05});
    fringe('Bob • tucked temple',[[18,994,27],[32,982,45],[43,963,53],[49,943,47],[51,923,33]],13,6,{value:.96});
  }else{
    if(style===0){
      fringe('Brush sweep • outer curve',[[26,1000,-12],[22,1012,2],[7,1014,12],[-12,1009,21],[-31,997,32],[-45,980,40],[-56,970,36],[-63,971,32]],12,7,{tip:.6,value:.98});
      fringe('Brush sweep • raised crest',[[31,995,6],[28,1004,23],[14,1004,39],[-4,994,54],[-22,978,64],[-39,963,59],[-52,956,47],[-62,959,39]],13,7.6,{tip:.55,value:1.05});
      fringe('Brush sweep • front wave',[[33,989,17],[30,996,37],[17,990,54],[0,977,68],[-14,962,73],[-29,951,68],[-43,950,55]],11.2,7.2,{tip:.48,value:.99});
      fringe('Brush sweep • small forelock',[[31,983,32],[26,981,53],[16,969,68],[3,957,75],[-4,950,75]],7.4,5,{tip:.39,value:1.06});
      fringe('Part • right return',[[25,990,19],[38,984,35],[47,971,46],[51,956,42],[55,947,33],[59,946,27]],10.8,6.6,{value:.95,tip:.49});
      fringe('Part • right temple',[[29,979,33],[40,966,50],[44,950,53],[49,936,45],[53,930,35]],8.7,4.9,{value:.88,tip:.57});
      fringe('Sweep • left temple',[[-26,979,48],[-43,970,49],[-52,955,43],[-55,944,34],[-60,938,25]],8.3,4.9,{value:.91,tip:.58});
    }else if(style===1){
      for(const sign of [-1,1]){
        const flip=p=>p.map(([x,y,z])=>[x*sign,y+(sign<0?2:0),z]);
        fringe('Curtain wave '+sign,flip([[2,998,9],[9,1002,27],[21,994,44],[33,978,54],[40,959,56],[49,943,44],[56,941,33]]),13,7,{root:.14,tip:.50});
        fringe('Curtain • underfold '+sign,flip([[4,994,20],[11,983,44],[23,969,62],[36,951,58],[42,944,52]]),10.2,6.6,{value:.89});
        fringe('Curtain forelock '+sign,flip([[4,995,23],[7,988,44],[16,975,65],[22,957,71],[31,945,64],[38,940,56]]),9,5.5,{tip:.48,value:1.06});
      }
    }else{
      const guides=[[-2,6,27],[-17,-6,12],[-30,-21,-1],[18,23,33],[32,39,44]];
      for(const [end,mid,root] of guides) fringe('Cropped wave '+root,[[root*.62,994,0],[root*.8,1000,20],[mid,989,44],[end-2,977,60],[end,961-(Math.abs(end)*.15),68-Math.abs(end)*.45]],8.8,3.8,{root:.13,tip:.53,value:.99+Math.cos(root)*.045});
    }
  }
}

