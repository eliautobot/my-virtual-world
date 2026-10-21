// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Next traffic dimensions/distribution. Shared by authoritative vehicles and their instanced renderer.
export const VEHICLE_KINDS = Object.freeze([
 { n:'sedan',L:4.5,W:1.82,H:1.44,p:34,v:12.5 }, { n:'compact',L:3.9,W:1.74,H:1.5,p:22,v:12 },
 { n:'suv',L:4.8,W:1.95,H:1.78,p:20,v:12.5 }, { n:'van',L:5.4,W:2,H:2.25,p:9,v:11 },
 { n:'taxi',L:4.6,W:1.82,H:1.46,p:10,v:12.5 }, { n:'bus',L:11.6,W:2.55,H:3.15,p:5,v:9.5 },
]);
export const VEHICLE_BODY_COLORS = ['#f2f1ee','#1b1d21','#9aa0a8','#b3202a','#1f4e8c','#2f6b4f','#c7a24a','#dedad0','#5b6068','#7a2e3b','#27465e','#3b3f45','#e8e8e8','#2a2d33'];
export const VEHICLE_BUS_COLORS = ['#e8e8e8','#2a6fb0','#c0392b'];
export const VEHICLE_ENTRY_SPEED = 2.5, VEHICLE_ENTRY_RANGE = 1.6, VEHICLE_EXIT_SPEED = 1;
export const VEHICLE_INPUT_TTL = 350, VEHICLE_DISCONNECT_GRACE = 5000;
export const sourceVehicleType = kind => kind === 'compact' ? 'car' : kind;
export function vehicleEnvelopeDistance(p, v, spec) {
 const dx=p.x-v.x,dz=p.z-v.z,c=Math.cos(v.yaw),s=Math.sin(v.yaw);
 const x=dx*c-dz*s,z=dx*s+dz*c;
 return Math.hypot(Math.max(0,Math.abs(x)-spec.halfLength),Math.max(0,Math.abs(z)-spec.halfWidth));
}
