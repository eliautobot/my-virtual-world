// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Source chase-camera framing (+X physics forward), constrained before smoothing.
import {footprint,square,toLocal,bRot} from './geom.js';
import {floorAt,baseOf} from './constants.js';
export function vehicleChaseCamera(car,halfLength,world){
 const c=Math.cos(car.yaw),s=Math.sin(car.yaw),focus={x:car.x+2*c,y:car.y+.65,z:car.z-2*s};
 const desired={x:car.x-(6.2+halfLength)*c,y:car.y+3.3,z:car.z+(6.2+halfLength)*s};
 const d={x:desired.x-focus.x,y:desired.y-focus.y,z:desired.z-focus.z};let factor=1;
 for(const B of world.buildings){if(!B||B.gone||B.type==='park')continue;let f=focus,dd=d,bounds;const y=[baseOf(B),floorAt(B,B.floors)+.5];
  if(square(B)){const r=footprint(B,.2);bounds={x:[r.x0,r.x1],y,z:[r.z0,r.z1]};}
  else{const l=toLocal(B,focus.x,focus.z),a=bRot(B),ca=Math.cos(a),sa=Math.sin(a);f={x:l.x,y:focus.y,z:l.z};dd={x:d.x*ca-d.z*sa,y:d.y,z:d.x*sa+d.z*ca};bounds={x:[-B.w/2-.2,B.w/2+.2],y,z:[-B.d/2-.2,B.d/2+.2]};}   // a turned building, in its own frame
  let near=0,far=1;
  for(const k of ['x','y','z']){if(Math.abs(dd[k])<1e-8){if(f[k]<bounds[k][0]||f[k]>bounds[k][1]){far=-1;break;}}else{let a=(bounds[k][0]-f[k])/dd[k],b=(bounds[k][1]-f[k])/dd[k];if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);}}
  if(near<=far&&far>=0&&near>0)factor=Math.min(factor,Math.max(0,near-.03));
 }
 const length=Math.hypot(d.x,d.y,d.z),dist=Math.max(1.5,length*factor);
 return{focus,dist,pitch:Math.atan2(d.y,Math.hypot(d.x,d.z)),yaw:car.yaw+Math.PI*1.5,fov:62};
}
