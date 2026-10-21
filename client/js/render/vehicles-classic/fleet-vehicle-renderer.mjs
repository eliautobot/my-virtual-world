// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import { buildBusTemplates } from './fleet-bus-renderer.mjs';
import { buildAmbulanceTemplates } from './fleet-ambulance-renderer.mjs';
import { buildTruckTemplates } from './fleet-truck-renderer.mjs';
import { buildVanTemplates } from './fleet-van-renderer.mjs';
import { buildSuvTemplates } from './fleet-suv-renderer.mjs';
import { isRealisticFleetType, getFleetVehicleProportions } from './fleet-vehicle-proportions.mjs';
import { buildPoliceTemplates } from './fleet-police-renderer.mjs';
import { buildTaxiTemplates } from './fleet-taxi-renderer.mjs';

const caches=new WeakMap();
export const FLEET_VEHICLE_BUDGET=Object.freeze({drawCalls:12,triangles:30000,templatesPerType:8});
export const usesRealisticFleetRenderer=definition=>isRealisticFleetType(definition.type);

export function buildRealisticFleetVehicle(group,definition,color,details,{THREE,getMat,mergeStaticGroupMeshes}) {
  if(!usesRealisticFleetRenderer(definition))throw new Error('No rebuilt geometry for this vehicle type');
  const dims=getFleetVehicleProportions(definition.type);
  let cache=caches.get(THREE);if(!cache){cache=new Map();caches.set(THREE,cache);}
  let templates=cache.get(definition.type);
  if(!templates){
    if(definition.type==='taxi')templates=buildTaxiTemplates(THREE,dims);
    else if(definition.type==='police')templates=buildPoliceTemplates(THREE,dims);
    else if(definition.type==='suv')templates=buildSuvTemplates(THREE,dims);
    else if(definition.type==='bus')templates=buildBusTemplates(THREE,dims);
    else if(definition.type==='ambulance')templates=buildAmbulanceTemplates(THREE,dims);
    else if(definition.type==='truck')templates=buildTruckTemplates(THREE,dims);
    else if(definition.type==='van')templates=buildVanTemplates(THREE,dims);
    else throw new Error('Missing fleet geometry builder');
    cache.set(definition.type,templates);
  }
  const shell=new THREE.Group();shell.name='vehicleShell';group.add(shell);
  const add=(parent,geometry,name,material)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;
    mesh.userData.fleetSharedGeometry=true;parent.add(mesh);return mesh;
  };
  const vehiclePaint=dims.paint??color;
  add(shell,templates.paint,'fleetPaint',new THREE.MeshPhongMaterial({color:vehiclePaint,shininess:42,specular:0x42474b,flatShading:false}));
  add(shell,templates.structure,'fleetStructure',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  add(shell,templates.interior,'fleetInterior',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  const glazing=new THREE.MeshPhongMaterial({color:0x8ea5b0,transparent:true,opacity:.47,depthWrite:false,side:THREE.DoubleSide,shininess:85,specular:0x9aabb3});
  glazing.forceSinglePass=true;
  add(shell,templates.glass,'fleetGlass',glazing);
  add(details,templates.details,'fleetDetails',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  add(shell,templates.equipment,'fleetEquipment',getMat(0xffffff,{vertexColors:true,flatShading:false}));
  if(templates.lamps)add(shell,templates.lamps,'fleetLamps',new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false}));
  for(const [x,z] of definition.wheels.positions){
    const wheel=add(group,templates.wheel,'wheel',getMat(0xffffff,{vertexColors:true,flatShading:false}));
    wheel.position.set(x,definition.wheels.centerY,z);wheel.rotation.x=Math.PI/2;wheel.userData.vehicleWheelAxle='z';
  }
  mergeStaticGroupMeshes(shell);
  group.scale.setScalar(definition.scale);group.name=`trafficVehicle:${definition.type}`;
  group.userData.vehicleType=definition.type;group.userData.proceduralVoxelModel=true;
  group.userData.realisticFleetModel=true;group.userData.fleetRevision=dims.revision;group.userData.fleetDimensions=dims;
  return definition;
}

// Explicit whole-cache teardown; never dispose shared templates for one car.
export function disposeFleetVehicleGeometry(THREE) {
  const cache=caches.get(THREE);if(!cache)return;
  for(const templates of cache.values())for(const geometry of Object.values(templates))geometry.dispose();
  caches.delete(THREE);
}
