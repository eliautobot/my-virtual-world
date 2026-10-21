// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Building exteriors. Shells for a 2x2-block chunk are merged into one mesh with a procedural facade shader
// (6 styles, window grids, storefronts, lobby doors, night lighting by hour + building type, distance-filtered).
// Details (entrances, awnings, roofs, balconies) share one merged mesh per chunk; signs use the shared text atlas.
// The focused building is cut away above the focused floor (uFocusB / uCutY); occluders fade (uFade).
import * as THREE from 'three';
import { FLOOR_H, GROUND_Y, baseOf, floorAt } from '/shared/constants.js';
import { footprint, bRot, toWorld, toLocal, square } from '/shared/geom.js';
import { blockIJ, blockAt } from '/shared/city.js';
import { commonUniforms, FRAG_PARS, WP_VERT, makeFurnMat, makeBDepthMat } from './mats.js';
import { FB, lin, FURN_DEF, treeRound } from './furniture.js';
import { roofSignFrame, bulkheadAt } from '/shared/signs.js';
import { QB, hsh } from './qb.js';
import { MASK_COL } from './outline.js';
import { GU } from './scene.js';

export const STY = { glass: 0, brick: 1, concrete: 2, modern: 3, classic: 4, stucco: 5 };
const TYPE = { office: 0, hq: 0, apartment: 1, cafe: 2, restaurant: 2, shop: 2, gym: 2 };
// per style: column width, window width, sill, head (metres within a storey)
export const FACADE = [[1.5, 1.44, 0.14, 3.26], [2.8, 1.25, 0.95, 2.55], [3.0, 2.6, 0.95, 2.45], [3.2, 2.3, 0.6, 2.85], [2.6, 1.15, 0.9, 2.7], [3.0, 1.1, 1.0, 2.45]];
export function facadeCols(sty, W) { const cw = FACADE[sty][0], n = Math.max(1, Math.floor((W - 1) / cw)); return { n, cw, off: (W - n * cw) / 2 }; }
const _inL = {};
export const isStore = B => B.type === 'cafe' || B.type === 'restaurant' || B.type === 'shop' || B.type === 'gym' || !!B.mixed;
export const buildingTop = B => GROUND_Y + baseOf(B) + B.floors * FLOOR_H;
// The street front, building-local heights. A store's awning stays below its sign; the sign over the entrance sits just
// above the ground floor, unless the brick or classic top cornice (shellAt) would cross it on a one-storey building:
// then it goes up onto the parapet, over the cornice.
const AWNING_TOP = 2.9;
const CORNICE = [0, 0.12, 0, 0, 0.24, 0];   // per style: how far the top cornice stands out (0: none)
const streetSignY = (B, y0, h) => {
  const H = B.floors * FLOOR_H;
  return CORNICE[STY[B.style] ?? 3] && y0 + h + 0.06 > H - 0.5 && y0 - 0.06 < H - 0.12 ? H + 0.1 : y0;
};
const SIGN_STYLE = {
  cafe: { bg: '#3b2a20', fg: '#f6e7c8', border: 'rgba(246,231,200,.5)' },
  restaurant: { bg: '#7a1f1f', fg: '#fff3d6', border: 'rgba(255,243,214,.5)' },
  shop: { bg: '#23395b', fg: '#ffffff' },
  gym: { bg: '#141414', fg: '#ffd23f', border: 'rgba(255,210,63,.6)' },
  office: { bg: '#1f2a44', fg: '#e8eef8' },
};

// Face metadata is identical at all four corners, but perspective interpolation can still add tiny per-pixel
// rounding errors. The window hashes amplify those into different lights/blinds within one pane. WebGL2's flat
// varyings carry the exact face values; only facade coordinates and world position should be interpolated.
const FAC_VERT = `attribute float aB; attribute float aK; attribute vec4 aS; attribute vec4 aF; attribute vec3 aDoor; attribute vec3 aWC; attribute vec3 aGC; attribute vec3 aTC;
flat varying float vB; flat varying float vK; flat varying vec4 vS; flat varying vec2 vSize;
flat varying vec3 vDoor; flat varying vec3 vWC; flat varying vec3 vGC; flat varying vec3 vTC;
varying vec2 vF; varying vec3 vWP;`;
const FAC_FRAG = `uniform float uHoverB, uSelB; uniform sampler2D uDoorTex;   // uDoorTex: how far each building's entrance stands open (doorsTick)
uniform vec4 uFloorSel, uFloorHov;   // a picked floor (building, from y, to y, on) and the one under the pointer
flat varying float vB; flat varying float vK; flat varying vec4 vS; flat varying vec2 vSize;
flat varying vec3 vDoor; flat varying vec3 vWC; flat varying vec3 vGC; flat varying vec3 vTC;
varying vec2 vF;`;
const FAC_OCC = `
float occ(float ty, float h) {
  if (ty < 0.5) return h < 6.0 ? 0.05 : h < 8.0 ? mix(0.05, 0.8, (h - 6.0) * 0.5) : h < 18.0 ? 0.8 : h < 22.0 ? mix(0.8, 0.1, (h - 18.0) * 0.25) : 0.06;
  if (ty < 1.5) return h < 5.5 ? 0.04 : h < 8.5 ? 0.45 : h < 17.0 ? 0.14 : h < 23.0 ? 0.72 : mix(0.72, 0.1, h - 23.0);
  return (h >= 6.5 && h < 22.0) ? 0.95 : 0.05;
}`;
const FAC_COLOR = `
int sty = int(vS.x + 0.5); int kind = int(vS.y + 0.5);
vec3 col = vWC; float rough = 0.85; float metal = 0.0; vec3 emis = vec3(0.0);
// Reduce window emission, not the shared bloom pass: streets, signs and other lights keep their intensity.
float glow = mix(0.04, 1.45, uNight) * 0.6;
if (kind == 1) {
  vec2 p = vWP.xz;
  col = vWC * (0.86 + 0.12 * vnoise(p * 1.7) + 0.05 * vnoise(p * 9.0));
  vec2 g = fract(p / 2.0); float e = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.02 + fwidth(p.x) * 1.5, e));
  rough = 0.95;
} else if (kind == 2) {
  col = vTC * (0.9 + 0.08 * vnoise(vWP.xz * 3.0 + vWP.y)); rough = 0.7;
} else {
  float u = vF.x, y = vF.y - 0.15, W = vSize.x;
  float fl = floor(y / 3.4), fy = y - fl * 3.4;
  float fwu = fwidth(u), fwy = fwidth(y), fw = max(fwu, fwy);
  float cw = 3.0, ww = 1.1, sill = 1.0, head = 2.45;
  if (sty == 0) { cw = 1.5; ww = 1.44; sill = 0.14; head = 3.26; }
  else if (sty == 1) { cw = 2.8; ww = 1.25; sill = 0.95; head = 2.55; }
  else if (sty == 2) { cw = 3.0; ww = 2.6; sill = 0.95; head = 2.45; }
  else if (sty == 3) { cw = 3.2; ww = 2.3; sill = 0.6; head = 2.85; }
  else if (sty == 4) { cw = 2.6; ww = 1.15; sill = 0.9; head = 2.7; }
  float n = max(1.0, floor((W - 1.0) / cw)), off = (W - n * cw) * 0.5;
  float cu = (u - off) / cw, ci = floor(cu), cx = (fract(cu) - 0.5) * cw;
  bool inCols = ci >= 0.0 && ci < n;
  float aaD = 1.0 - smoothstep(0.006, 0.03, fw);
  // ---- wall surface per style
  vec3 wall = vWC;
  if (sty == 1) {
    vec2 bp = vec2(u, y) / vec2(0.23, 0.077); float row = floor(bp.y); bp.x += mod(row, 2.0) * 0.5;
    vec2 bf = fract(bp), bi = floor(bp);
    float mort = max(1.0 - smoothstep(0.1, 0.17, bf.y), 1.0 - smoothstep(0.03, 0.07, bf.x));
    wall = mix(vWC * 0.95, vWC * (0.82 + 0.3 * h21(bi + vec2(row * 1.7, vB))), aaD);
    wall = mix(wall, vec3(0.62, 0.6, 0.56), mort * 0.7 * aaD);
  } else if (sty == 2) {
    vec2 pp = vec2(u, y) / vec2(1.5, 0.75), pf = fract(pp);
    float j = max(1.0 - smoothstep(0.0, 0.02 + fwy / 0.75, pf.y), 1.0 - smoothstep(0.0, 0.012 + fwu / 1.5, pf.x));
    float tie = 1.0 - smoothstep(0.018, 0.03, length((pf - vec2(0.2, 0.5)) * vec2(1.5, 0.75)));
    tie = max(tie, 1.0 - smoothstep(0.018, 0.03, length((pf - vec2(0.8, 0.5)) * vec2(1.5, 0.75))));
    wall = vWC * (0.9 + 0.12 * vnoise(vec2(u, y) * 0.8) + 0.05 * h21(floor(pp) + vB)) * (1.0 - (0.2 * j + 0.3 * tie) * aaD);
  } else if (sty == 4) {
    float rh = fl < 0.5 ? 0.56 : 0.42;
    vec2 pp = vec2(u, y) / vec2(1.1, rh); float row = floor(pp.y); pp.x += mod(row, 2.0) * 0.5;
    vec2 pf = fract(pp);
    float j = max(1.0 - smoothstep(0.0, (fl < 0.5 ? 0.06 : 0.025) + fwy / rh, pf.y), 1.0 - smoothstep(0.0, 0.015 + fwu / 1.1, pf.x));
    wall = vWC * (0.92 + 0.1 * h21(floor(pp) + vec2(row, vB)) + 0.05 * vnoise(vec2(u, y) * 2.0)) * (1.0 - 0.22 * j * aaD);
  } else if (sty == 5) {
    wall = vWC * (0.93 + 0.08 * vnoise(vec2(u, y) * 1.3) + 0.05 * vnoise(vec2(u, y) * 7.0) * aaD);
  } else if (sty == 3) {
    vec2 pf = fract(vec2(u, y) / vec2(1.6, 3.4));
    float j = max(1.0 - smoothstep(0.0, 0.008 + fwy / 3.4, pf.y), 1.0 - smoothstep(0.0, 0.006 + fwu / 1.6, pf.x));
    wall = vWC * (0.97 + 0.03 * vnoise(vec2(u, y) * 0.5)) * (1.0 - 0.14 * j * aaD);
  } else {
    wall = mix(vTC, vGC, 0.35) * 0.8;
  }
  wall *= 0.8 + 0.2 * smoothstep(0.0, 2.5, y);
  // ---- openings
  bool isDoor = false, isStore = false;
  if (fl < 0.5 && vDoor.x > -50.0) {
    if (abs(u - vDoor.x) < vDoor.y * 0.5 + 0.1 && fy < 2.5) isDoor = true;
    else if (vDoor.z > 0.5 && u > 0.5 && u < W - 0.5 && fy > 0.3 && fy < 2.85) isStore = true;
  }
  float inWin = 0.0, frameM = 0.0, wid = 0.0, blind = 0.0, lit = 0.0;
  float o = occ(vS.w, uHour);
  vec3 lc = mix(vec3(1.0, 0.76, 0.48), vec3(0.8, 0.88, 1.0), step(0.62, h21(vec2(vB * 0.37, fl * 0.71))));
  vec3 gl = vGC * (0.5 + 0.28 * smoothstep(sill, head, fy));
  if (isDoor) {
    inWin = 1.0;
    float e = min(vDoor.y * 0.5 + 0.1 - abs(u - vDoor.x), 2.5 - fy);
    frameM = 1.0 - smoothstep(0.05, 0.09, e);
    frameM = max(frameM, 1.0 - smoothstep(0.02, 0.035, abs(u - vDoor.x)));
    gl = vGC * 0.45; lit = vS.w > 1.5 ? step(0.5, o) : 1.0; lc = vec3(1.0, 0.82, 0.58);
    float dOpen = texelFetch(uDoorTex, ivec2(int(mod(vB, 256.0)), int(vB / 256.0)), 0).r;   // the doors part from the middle
    if (dOpen > 0.01 && abs(u - vDoor.x) < vDoor.y * 0.5 * dOpen && fy < 2.4) { gl = vec3(0.11, 0.1, 0.09); lit = 0.0; frameM = 0.0; }
  } else if (isStore) {
    float pc = mod(u - 0.5, 3.3);
    if (pc > 0.24) {
      inWin = 1.0;
      float e = min(min(pc - 0.24, 3.3 - pc), min(fy - 0.3, 2.85 - fy));
      frameM = 1.0 - smoothstep(0.03, 0.06, e);
      lit = step(0.5, occ(2.0, uHour)); lc = vec3(1.0, 0.84, 0.62);
      gl = vGC * 0.5 + vec3(0.02, 0.02, 0.018);
    } else wall = vTC * 0.85;
  } else if (inCols) {
    float aw = max(fwu, 1e-4), ah = max(fwy, 1e-4);
    float mx = clamp((ww * 0.5 - abs(cx)) / aw + 0.5, 0.0, 1.0);
    float my = clamp((fy - sill) / ah + 0.5, 0.0, 1.0) * clamp((head - fy) / ah + 0.5, 0.0, 1.0);
    inWin = mx * my;
    if (inWin > 0.0) {
      float e = min(ww * 0.5 - abs(cx), min(fy - sill, head - fy));
      float fwid = sty == 0 ? 0.03 : 0.055;
      frameM = 1.0 - smoothstep(fwid - fw * 0.7, fwid + fw * 0.7, e);
      if (ww > 1.7) frameM = max(frameM, 1.0 - smoothstep(0.022 - fw * 0.7, 0.022 + fw * 0.7, abs(cx)));
      wid = h21(vec2(vB * 1.37 + vK * 5.1 + ci * 0.73, fl * 1.91 + 0.5));
      float fh = h21(vec2(vB * 3.1 + vK * 0.3, fl + 11.0));
      lit = step(mix(wid, fh, 0.45), o);
      blind = step(0.64, h21(vec2(wid * 91.0, 3.0))) * step(head - (head - sill) * (0.2 + 0.55 * h21(vec2(wid * 17.0, 5.0))), fy);
    }
  }
  // bands: plinth, slab lines, cornices
  if (!isDoor && !isStore && fl < 0.5 && fy < 0.45) wall = vTC * 0.62;
  if (sty == 1 || sty == 4 || sty == 5) { if (fl > 0.5 && fy < 0.14) wall = vTC * 0.95; }
  if (sty == 4 && fy > 3.18 && fl < vSize.y - 0.5) wall = vTC;
  if (sty == 4 && inCols && abs(cx) < ww * 0.5 + 0.12 && fy > head && fy < head + 0.16) wall = vTC * 1.02;
  if ((sty == 1 || sty == 5) && inCols && abs(cx) < ww * 0.5 + 0.08 && fy > sill - 0.08 && fy < sill) wall = vTC;
  vec3 nearCol = wall; float nearRough = 0.85, nearMetal = 0.0; vec3 nearEmis = vec3(0.0);
  if (inWin > 0.0) {
    vec3 paneCol = gl; float paneR = 0.1, paneM = 0.55;
    vec3 paneE = lc * lit * glow * (0.75 + 0.5 * h21(vec2(wid * 13.0, 1.0)));
    if (blind > 0.5) { paneCol = vec3(0.8, 0.76, 0.68); paneR = 0.6; paneM = 0.0; paneE = lc * lit * glow * 0.55; }
    frameM = clamp(frameM, 0.0, 1.0);
    nearCol = mix(nearCol, mix(paneCol, vTC * 0.85, frameM), inWin);
    nearRough = mix(nearRough, mix(paneR, 0.45, frameM), inWin);
    nearMetal = paneM * (1.0 - frameM) * inWin;
    nearEmis = paneE * (1.0 - frameM) * inWin;
  }
  float cov = (ww / cw) * ((head - sill) / 3.4);
  vec3 farWall = sty == 0 ? mix(vTC, vGC, 0.35) * 0.8 : vWC * 0.93;
  vec3 farCol = mix(farWall, vGC * 0.6, cov);
  vec3 farEmis = vec3(1.0, 0.82, 0.6) * o * cov * glow * 0.9;
  float farK = smoothstep(0.45, 1.1, fw) * (isDoor || isStore ? 0.0 : 1.0);
  col = mix(nearCol, farCol, farK); rough = mix(nearRough, 0.55, farK); metal = mix(nearMetal, 0.3 * cov, farK); emis = mix(nearEmis, farEmis, farK);
  emis += col * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * 0.7 * (1.0 - smoothstep(2.0, 9.0, y));
}
// a floor picked from outside (2026-10-04): it glows as a warm band round the building, brightest at its edges
if (abs(vB - uFloorSel.x) < 0.5 && vWP.y >= uFloorSel.y && vWP.y < uFloorSel.z) {
  float fe = min(vWP.y - uFloorSel.y, uFloorSel.z - vWP.y);
  float fp = 0.8 + 0.2 * sin(uTime * 4.0), edge = 1.0 - smoothstep(0.0, 0.28, fe);
  col = mix(col, vec3(1.0, 0.78, 0.28), (0.5 + 0.4 * edge) * uFloorSel.w);
  emis += vec3(1.0, 0.64, 0.16) * (0.45 + 1.2 * edge) * uFloorSel.w * fp;
} else if (abs(vB - uFloorHov.x) < 0.5 && vWP.y >= uFloorHov.y && vWP.y < uFloorHov.z) { col = mix(col, vec3(1.0, 0.85, 0.5), 0.22); emis += vec3(0.7, 0.5, 0.2) * 0.14; }
diffuseColor.rgb *= col;`;

const _box = new THREE.Box3(), _hit = new THREE.Vector3(), _lray = new THREE.Ray();

/** A mask material for merged building geometry (render/outline.js): only building uB's triangles, cut above uCutY when
 *  it is the one looked into. */
function maskMatB() {
  return new THREE.ShaderMaterial({
    uniforms: { uB: { value: -1 }, uMaskCol: MASK_COL, uFocusB: GU.uFocusB, uCutY: GU.uCutY },
    vertexShader: `attribute float aB; uniform float uB; varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y;
  gl_Position = abs(aB - uB) < 0.5 ? projectionMatrix * viewMatrix * w : vec4(2.0, 2.0, 2.0, 1.0);
}`,
    fragmentShader: `uniform vec3 uMaskCol; uniform float uB, uFocusB, uCutY; varying float vY;
void main() { if (abs(uB - uFocusB) < 0.5 && vY > uCutY + 0.01) discard; gl_FragColor = vec4(uMaskCol, 1.0); }`,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
}

export class Buildings {
  constructor(world, grid, atlas) {
    this.world = world; this.g = grid; this.atlas = atlas;
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false;
    // how far each building's entrance stands open (0…255), for the facade's painted doors (doorsTick)
    this.doorOpen = new Uint8Array(256 * 8); this.doorTex = new THREE.DataTexture(this.doorOpen, 256, 8, THREE.RedFormat, THREE.UnsignedByteType);
    this.doorTex.needsUpdate = true; this.doorT = new Float32Array(256 * 8); this.doorFrame = 0; this.doorWant = new Uint8Array(256 * 8);
    this.uni = { uHoverB: { value: -1 }, uSelB: { value: -1 }, uFloorSel: { value: new THREE.Vector4(-1, 0, 0, 0) }, uFloorHov: { value: new THREE.Vector4(-1, 0, 0, 0) }, uDoorTex: { value: this.doorTex } };
    this.shellMat = this.makeShellMat();
    this.depthMat = makeBDepthMat('cut');
    this.detMat = makeFurnMat({ withB: true, fade: true, lit: true, doorTex: this.doorTex });
    this.detGlass = makeFurnMat({ glass: true, withB: true, fade: true, doorTex: this.doorTex });
    this.signMat = this.makeSignMat();
    this.chunks = new Map();
    this.rebuildAll();
  }
  makeShellMat() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      commonUniforms(sh); Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + FAC_VERT)
        .replace('#include <project_vertex>', `#include <project_vertex>
vB = aB; vK = aK; vS = aS; vF = aF.xy; vSize = aF.zw; vDoor = aDoor; vWC = aWC; vGC = aGC; vTC = aTC; ${WP_VERT}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FAC_FRAG + '\n' + FRAG_PARS + FAC_OCC)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (abs(vB - uFocusB) < 0.5 && vWP.y > uCutY + 0.01) discard;
if (fadeOut(vWP, vB)) discard;`)
        .replace('#include <color_fragment>', FAC_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = metal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += emis;');
    };
    m.customProgramCacheKey = () => 'mvw-facade';
    return m;
  }
  makeSignMat() {
    const m = this.atlas.mat.clone();
    m.onBeforeCompile = (sh) => {
      commonUniforms(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aB; varying float vBi; varying vec3 vWP;')
        .replace('#include <project_vertex>', `#include <project_vertex>\nvBi = aB; ${WP_VERT}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBi;\n' + FRAG_PARS)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (abs(vBi - uFocusB) < 0.5 && vWP.y > uCutY + 0.01) discard;
if (fadeOut(vWP, vBi)) discard;`);
    };
    m.customProgramCacheKey = () => 'mvw-bsign';
    return m;
  }
  chunkKey(B) {
    if (B.base !== undefined) return `i${Math.floor(B.x / 256)},${Math.floor(B.z / 256)}`;   // beyond the city: 256 m cells
    let bi = B.block;
    if (bi === undefined || bi === null) { const r = blockAt(this.g, B.x, B.z); bi = r ? r.bi : 0; }
    const { i, j } = blockIJ(this.g, bi);
    return (i >> 1) + (j >> 1) * 64;
  }
  rebuildAll() {
    for (const k of [...this.chunks.keys()]) this.disposeChunk(k);
    const by = new Map();
    this.world.buildings.forEach((B, idx) => { if (!B || B.gone || B.type === 'park') return; const k = this.chunkKey(B); if (!by.has(k)) by.set(k, []); by.get(k).push(idx); });
    for (const [k, list] of by) this.buildChunk(k, list);
  }
  /** Rebuild the chunk(s) containing building idx (call after an edit). */
  rebuildFor(idx) {
    const B = this.world.buildings[idx]; if (!B) return;
    const k = this.chunkKey(B), list = [];
    this.world.buildings.forEach((C, n) => { if (C && !C.gone && C.type !== 'park' && this.chunkKey(C) === k) list.push(n); });
    this.disposeChunk(k);
    if (list.length) this.buildChunk(k, list);
  }
  disposeChunk(k) {
    const c = this.chunks.get(k); if (!c) return;
    for (const m of c) { this.group.remove(m); m.geometry.dispose(); }
    this.chunks.delete(k);
  }
  buildChunk(k, list) {
    const q = new QB({ aB: 1, aK: 1, aS: 4, aF: 4, aDoor: 3, aWC: 3, aGC: 3, aTC: 3 });
    const f = new FB(), sq = new QB({ uv: 2, aB: 1 });
    for (const idx of list) { const B = this.world.buildings[idx]; this.shell(q, B, idx); this.details(f, B, idx); this.signs(sq, f, B, idx); }
    const out = [];
    const add = (geo, mat, cast, depth) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.castShadow = cast; m.receiveShadow = true;
      if (depth) m.customDepthMaterial = depth;
      this.group.add(m); out.push(m);
    };
    add(q.build(), this.shellMat, true, this.depthMat);
    const G = f.build();
    add(G.geo, this.detMat, true, this.depthMat);
    add(G.glass, this.detGlass, false, null);
    add(sq.build(), this.signMat, false, null);
    this.chunks.set(k, out);
  }
  // ------------------------------------------------------------ shell (world-space AABB when rot is a multiple of 90;
  // a building turned to face a road beyond the city is built square at the origin and turned into place)
  // The facade's own coordinates (aF) always count from the city's ground; a building on a raised pad is lifted after.
  shell(q, B, bi) {
    const base = baseOf(B);
    if (square(B) && !base) { this.shellAt(q, B, bi); return; }
    const n0 = q.count, turned = !square(B), r = bRot(B), c = Math.cos(r), s = Math.sin(r);
    this.shellAt(q, turned ? { ...B, x: 0, z: 0, rot: 0, base: undefined } : { ...B, base: undefined }, bi);
    for (let v = n0 * 3; v < q.P.length; v += 3) {
      q.P[v + 1] += base;
      if (!turned) continue;
      const x = q.P[v], z = q.P[v + 2], nx = q.N[v], nz = q.N[v + 2];
      q.P[v] = B.x + x * c + z * s; q.P[v + 2] = B.z - x * s + z * c;
      q.N[v] = nx * c + nz * s; q.N[v + 2] = -nx * s + nz * c;
    }
  }
  shellAt(q, B, bi) {
    const fp = footprint(B), x0 = fp.x0, x1 = fp.x1, z0 = fp.z0, z1 = fp.z1;
    const y0 = GROUND_Y, y1 = buildingTop(B);
    const C = B.colors || {}, WC = lin(C.wall || '#cccccc'), GC = lin(C.glass || '#334455'), TC = lin(C.trim || '#eeeeee'), RC = lin(C.roof || '#666666');
    const sty = STY[B.style] ?? 3, ty = TYPE[B.type] ?? 0, seed = hsh(B.seed | 0, 1);
    const frontK = ((Math.round((B.rot || 0) / 90) % 4) + 4) % 4, store = isStore(B) ? 1 : 0;
    const faces = [[[x0, z1], [x1, z1], [0, 0, 1], x1 - x0], [[x1, z1], [x1, z0], [1, 0, 0], z1 - z0], [[x1, z0], [x0, z0], [0, 0, -1], x1 - x0], [[x0, z0], [x0, z1], [-1, 0, 0], z1 - z0]];
    faces.forEach(([a, c, n, W], k) => {
      const door = k === frontK && B.door ? [B.door.x + W / 2, B.door.w, store] : [-99, 0, 0];
      const base = { aB: bi, aK: k, aS: [sty, 0, seed, ty], aDoor: door, aWC: WC, aGC: GC, aTC: TC };
      q.quad([[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]], n, null, v => ({ ...base, aF: [v === 1 || v === 2 ? W : 0, v < 2 ? y0 : y1, W, B.floors] }));
    });
    const trim = { aB: bi, aK: 0, aS: [sty, 2, seed, ty], aF: [0, 0, 0, 0], aDoor: [-99, 0, 0], aWC: WC, aGC: GC, aTC: TC };
    q.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], { ...trim, aS: [sty, 1, seed, ty], aWC: RC });
    const ph = sty === 0 ? 0.55 : 0.95, t = 0.3;
    q.box(x0, y1, z0, x1, y1 + ph, z0 + t, trim, 'b'); q.box(x0, y1, z1 - t, x1, y1 + ph, z1, trim, 'b');
    q.box(x0, y1, z0 + t, x0 + t, y1 + ph, z1 - t, trim, 'bns'); q.box(x1 - t, y1, z0 + t, x1, y1 + ph, z1 - t, trim, 'bns');
    if (CORNICE[sty]) {
      const o = CORNICE[sty];
      q.box(x0 - o, y1 - 0.5, z0 - o, x1 + o, y1 - 0.12, z1 + o, trim, '');
    }
  }
  // ------------------------------------------------------------ details (building-local frame)
  details(f, B, bi) {
    const C = B.colors || {}, H = B.floors * FLOOR_H, hw = B.w / 2, hd = B.d / 2, sty = STY[B.style] ?? 3;
    const r = mulberry(B.seed | 0);
    f.ext = { aB: [bi], aH: [0, 0] };   // aH: how far a piece slides (world x, z) when the entrance is fully open
    f.push(B.x, GROUND_Y + baseOf(B), B.z, bRot(B));
    const dx = B.door ? B.door.x : 0, dw = B.door ? B.door.w : 2.4, rc = Math.cos(bRot(B)), rs = Math.sin(bRot(B));
    // entrance frame
    f.col('#2b2e33');
    f.box(dx - dw / 2 - 0.12, 0, hd - 0.02, dx - dw / 2, 2.5, hd + 0.08); f.box(dx + dw / 2, 0, hd - 0.02, dx + dw / 2 + 0.12, 2.5, hd + 0.08);
    f.box(dx - dw / 2 - 0.12, 2.4, hd - 0.02, dx + dw / 2 + 0.12, 2.52, hd + 0.08);
    // the handles go with the doors as they part (the facade's door opens from the middle, buildings.js doorsTick)
    f.col('#c9ced4');
    f.ext.aH = [-dw / 2 * rc, dw / 2 * rs]; f.box(dx - 0.12, 0.95, hd + 0.02, dx - 0.08, 1.35, hd + 0.07);
    f.ext.aH = [dw / 2 * rc, -dw / 2 * rs]; f.box(dx + 0.08, 0.95, hd + 0.02, dx + 0.12, 1.35, hd + 0.07);
    f.ext.aH = [0, 0];
    if (isStore(B)) {
      const ac = C.accent || '#2a9d8f', L = 1.25, th = Math.atan2(0.42, 1.15);
      const W = B.w - 1.1, ns = Math.max(2, Math.round(W / 0.6)), sw = W / ns;
      for (let k = 0; k < ns; k++) {
        const xc = -W / 2 + (k + 0.5) * sw;
        if (k % 2) f.col('#f3efe6'); else f.col(ac);
        f.push(xc, AWNING_TOP, hd, 0); f.m.multiply(new THREE.Matrix4().makeRotationX(th));
        f.box(-sw / 2, -0.035, 0, sw / 2, 0, L); f.pop();
        f.box(xc - sw / 2, AWNING_TOP - 0.66, hd + 1.13, xc + sw / 2, AWNING_TOP - 0.4, hd + 1.16);
      }
      f.col('#2b2e33'); f.box(-W / 2 - 0.04, AWNING_TOP - 0.05, hd, W / 2 + 0.04, AWNING_TOP + 0.02, hd + 0.08);
      for (const s of [-1, 1]) {
        const px = dx + s * (dw / 2 + 0.55);
        if (Math.abs(px) > hw - 0.4) continue;
        f.col('#3b3f45'); f.cyl(px, hd + 0.35, 0.2, 0, 0.42, 10, 0.24);
        f.col('#4d8f3f'); f.sph(px, 0.62, hd + 0.35, 0.26, 0.24, 0.26, 8, 5);
      }
    } else {
      f.col('#34383e'); f.box(dx - dw / 2 - 0.9, 2.78, hd, dx + dw / 2 + 0.9, 2.9, hd + 1.55);
      f.col('#ffe2a8', 0, 2); f.box(dx - dw / 2 - 0.5, 2.765, hd + 0.35, dx + dw / 2 + 0.5, 2.78, hd + 1.25);
      f.col('#8d949c'); f.box(dx - 0.9, 0, hd + 0.02, dx + 0.9, 0.05, hd + 1.2);
    }
    // balconies (apartments, front face, checkerboard) from the 3rd floor up: the 2nd floor's front is the street
    // sign's (2026-10-06: they covered shop signs)
    if (B.type === 'apartment' && B.floors > 2 && sty !== 0) {
      const { n, cw, off } = facadeCols(sty, B.w), ww = FACADE[sty][1];
      const bw = Math.min(cw - 0.25, Math.max(1.7, ww + 0.6)) / 2;
      for (let fl = 2; fl < B.floors; fl++) for (let c = 0; c < n; c++) {
        if ((c + fl) % 2) continue;
        const lx = off + (c + 0.5) * cw - hw, y = fl * FLOOR_H;
        f.col('#d9d6cf'); f.box(lx - bw, y - 0.02, hd, lx + bw, y + 0.12, hd + 1.0);
        f.col('#2f3237'); f.box(lx - bw, y + 1.0, hd + 0.95, lx + bw, y + 1.05, hd + 1.0);
        f.box(lx - bw, y + 1.0, hd, lx - bw + 0.05, y + 1.05, hd + 1.0); f.box(lx + bw - 0.05, y + 1.0, hd, lx + bw, y + 1.05, hd + 1.0);
        f.glass('#a9c9d9'); f.box(lx - bw + 0.03, y + 0.12, hd + 0.965, lx + bw - 0.03, y + 1.0, hd + 0.985);
        f.box(lx - bw + 0.01, y + 0.12, hd, lx - bw + 0.03, y + 1.0, hd + 0.96); f.box(lx + bw - 0.03, y + 0.12, hd, lx + bw - 0.01, y + 1.0, hd + 0.96);
        if (r() < 0.35) { f.col('#4d8f3f'); f.sph(lx + bw - 0.35, y + 0.4, hd + 0.6, 0.2, 0.26, 0.2, 7, 4); }
      }
    }
    this.roof(f, B, H, hw, hd, r);
    f.pop();
    f.ext = {};
  }
  roof(f, B, H, hw, hd, r) {
    const kind = B.roofKind || 'hvac', taken = [];
    const free = (x, z, rx, rz) => {
      if (Math.abs(x) + rx > hw - 0.6 || Math.abs(z) + rz > hd - 0.6) return false;
      for (const t of taken) if (Math.abs(x - t[0]) < rx + t[2] + 0.5 && Math.abs(z - t[1]) < rz + t[3] + 0.5) return false;
      return true;
    };
    const spot = (rx, rz, tries = 24) => {
      for (let k = 0; k < tries; k++) {
        const x = (r() * 2 - 1) * (hw - rx - 0.7), z = (r() * 2 - 1) * (hd - rz - 0.7);
        if (free(x, z, rx, rz)) { taken.push([x, z, rx, rz]); return [x, z]; }
      }
      return null;
    };
    let bulkTop = H;
    const boards = (B.roofSigns || []).map(sg => ({ sg, F: roofSignFrame(B, sg) }));
    if (B.core && B.floors > 1) {
      const big = B.core.t === 'elevator', rx = big ? 2.7 : 1.45, rz = big ? 1.65 : 1.45;
      const { x: cx, z: cz } = bulkheadAt(B.core, rx, rz, hw, hd, boards);
      taken.push([cx, cz, rx, rz]);
      f.col('#b7b3aa'); f.box(cx - rx, H, cz - rz, cx + rx, H + 2.6, cz + rz);
      f.col('#8f8b83'); f.box(cx - rx - 0.08, H + 2.6, cz - rz - 0.08, cx + rx + 0.08, H + 2.75, cz + rz + 0.08);
      f.col('#5b6068'); f.box(cx - 0.45, H, cz + rz, cx + 0.45, H + 2.1, cz + rz + 0.04);
      bulkTop = H + 2.75;
      if (B.floors >= 16) {
        const h = 5 + B.floors * 0.18;
        f.col('#9aa0a8'); f.cyl(cx, cz, 0.09, bulkTop, bulkTop + h, 6, 0.04);
        for (let k = 1; k < 4; k++) f.cyl(cx, cz, 0.3 - k * 0.06, bulkTop + h * k / 4, bulkTop + h * k / 4 + 0.08, 8);
        f.col('#ff3b30', 0, 3); f.sph(cx, bulkTop + h + 0.12, cz, 0.13, 0.13, 0.13, 6, 4);
      }
    }
    // the owner's rooftop billboards (shared/signs.js; render/signs.js draws their faces): legs and braces, the frame
    // behind the face, lamps on arms over it; the roof's other things keep clear of them
    boards.forEach(({ sg, F }) => {
      const hw2 = F.w / 2, front = sg.edge === 'front' || sg.edge === 'back';
      taken.push(front ? [F.lx, F.lz, hw2 + 0.4, 1.4] : [F.lx, F.lz, 1.4, hw2 + 0.4]);
      f.push(F.lx, H, F.lz, F.yaw);
      const legs = Math.max(2, Math.round(F.w / 4) + 1);
      f.col('#4a4f55');
      for (let k = 0; k < legs; k++) {
        const x = -hw2 + 0.3 + k * (F.w - 0.6) / (legs - 1);
        f.box(x - 0.07, 0, -0.2, x + 0.07, F.legs + F.h, -0.06);
        f.rod([x, 0, -1.1], [x, F.legs + F.h * 0.6, -0.14], 0.04, 5);
        f.box(x - 0.12, 0, -1.2, x + 0.12, 0.08, -0.06);
      }
      f.col('#24272b'); f.box(-hw2 - 0.08, F.legs - 0.08, -0.06, hw2 + 0.08, F.legs + F.h + 0.08, 0);
      f.col('#d6d7da'); f.box(-hw2 - 0.1, F.legs + F.h + 0.08, -0.08, hw2 + 0.1, F.legs + F.h + 0.14, 0.02); f.box(-hw2 - 0.1, F.legs - 0.14, -0.08, hw2 + 0.1, F.legs - 0.08, 0.02);
      const n = Math.max(2, Math.round(F.w / 5));
      for (let k = 0; k < n; k++) {
        const x = -hw2 + (k + 0.5) * F.w / n, top = F.legs + F.h + 0.14;
        f.col('#4a4f55'); f.rod([x, top, -0.05], [x, top + 0.3, 0.55], 0.03, 5);
        f.col('#2a2e35'); f.box(x - 0.17, top + 0.22, 0.42, x + 0.17, top + 0.38, 0.66);
        f.col('#ffe2a8', 0, 2); f.box(x - 0.14, top + 0.2, 0.45, x + 0.14, top + 0.22, 0.63);
      }
      f.pop();
    });
    if (kind === 'hvac') {
      const n = Math.max(1, Math.min(5, Math.round(B.w * B.d / 170)));
      for (let k = 0; k < n; k++) {
        const s = spot(1.0, 0.65); if (!s) break;
        const [x, z] = s;
        f.col('#c8cbcf'); f.box(x - 0.95, H, z - 0.6, x + 0.95, H + 1.15, z + 0.6);
        f.col('#34373c'); f.cyl(x - 0.45, z, 0.36, H + 1.15, H + 1.19, 12); f.cyl(x + 0.45, z, 0.36, H + 1.15, H + 1.19, 12);
        f.col('#9a9ea4'); for (let v = 0; v < 5; v++) f.box(x - 0.9, H + 0.2 + v * 0.17, z + 0.6, x + 0.9, H + 0.24 + v * 0.17, z + 0.63);
      }
      for (let k = 0; k < 3; k++) { const s = spot(0.2, 0.2); if (!s) break; f.col('#a3a7ad'); f.cyl(s[0], s[1], 0.14, H, H + 0.9, 8); f.col('#6b6f75'); f.cyl(s[0], s[1], 0.2, H + 0.9, H + 1.0, 8); }
      if (B.type === 'apartment' && r() < 0.45) {
        const s = spot(2.2, 1.4);
        if (s) for (let row = 0; row < 3; row++) {
          f.push(s[0], H + 0.35, s[1] - 1.0 + row * 1.0, 0); f.m.multiply(new THREE.Matrix4().makeRotationX(-0.45));
          f.col('#1d3557'); f.box(-2.1, 0, -0.4, 2.1, 0.05, 0.4); f.col('#a8b2bc'); f.box(-2.12, -0.02, -0.42, 2.12, 0.0, 0.42); f.pop();
          f.col('#6b6f75'); f.box(s[0] - 1.9, H, s[1] - 1.05 + row, s[0] - 1.85, H + 0.4, s[1] - 0.95 + row);
        }
      }
    } else if (kind === 'water_tower') {
      const s = spot(1.7, 1.7) || [0, 0];
      const [x, z] = s;
      f.col('#4a4d52');
      for (const [a, b] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) f.rod([x + a, H, z + b], [x + a * 0.9, H + 2.7, z + b * 0.9], 0.08, 6);
      f.box(x - 1.5, H + 2.6, z - 1.5, x + 1.5, H + 2.72, z + 1.5);
      f.col('#7b5a3c'); f.cyl(x, z, 1.45, H + 2.72, H + 5.5, 16);
      f.col('#3a3d42'); for (const y of [3.3, 4.2, 5.1]) f.cyl(x, z, 1.47, H + y, H + y + 0.06, 16);
      f.col('#5b4330'); f.lathe(x, z, [[1.55, H + 5.5], [0.12, H + 6.4], [0, H + 6.45]], 16);
      const s2 = spot(0.95, 0.6); if (s2) { f.col('#c8cbcf'); f.box(s2[0] - 0.9, H, s2[1] - 0.55, s2[0] + 0.9, H + 1.1, s2[1] + 0.55); f.col('#34373c'); f.cyl(s2[0], s2[1], 0.38, H + 1.1, H + 1.14, 12); }
    } else if (kind === 'helipad') {
      const R = Math.min(6.5, Math.min(hw, hd) - 1.2);
      if (R > 3) {
        taken.push([0, 0, R, R]);
        f.col('#3a3d42'); f.box(-R, H, -R, R, H + 0.1, R);
        f.col('#f4c430'); f.lathe(0, 0, [[R * 0.78, H + 0.11], [R * 0.9, H + 0.11]], 32);
        f.col('#f2f2f2'); f.box(-R * 0.3, H + 0.1, -R * 0.36, -R * 0.18, H + 0.12, R * 0.36); f.box(R * 0.18, H + 0.1, -R * 0.36, R * 0.3, H + 0.12, R * 0.36); f.box(-R * 0.18, H + 0.1, -0.06 * R, R * 0.18, H + 0.12, 0.06 * R);
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; f.col('#9bff9b', 0, 3); f.box(Math.cos(a) * R * 0.95 - 0.08, H + 0.1, Math.sin(a) * R * 0.95 - 0.08, Math.cos(a) * R * 0.95 + 0.08, H + 0.18, Math.sin(a) * R * 0.95 + 0.08); }
      }
    } else if (kind === 'garden') {
      const iw = hw - 0.7, id = hd - 0.7;
      f.col('#8a6a48');
      f.box(-iw, H, id - 0.8, iw, H + 0.5, id); f.box(-iw, H, -id, iw, H + 0.5, -id + 0.8);
      f.col('#4a3a2a'); f.box(-iw + 0.05, H + 0.5, id - 0.75, iw - 0.05, H + 0.52, id - 0.05); f.box(-iw + 0.05, H + 0.5, -id + 0.05, iw - 0.05, H + 0.52, -id + 0.75);
      for (const zz of [id - 0.4, -id + 0.4]) for (let x = -iw + 0.6; x < iw - 0.4; x += 1.25) { f.col(r() < 0.5 ? '#4f8a3c' : '#5e9a45'); f.sph(x, H + 0.72, zz, 0.36, 0.3, 0.32, 7, 5); }
      taken.push([0, id - 0.4, iw, 0.4], [0, -id + 0.4, iw, 0.4]);
      for (let k = 0; k < 3; k++) { const s = spot(1.6, 1.1); if (!s) break; f.col('#6d9a4c'); f.box(s[0] - 1.6, H, s[1] - 1.1, s[0] + 1.6, H + 0.06, s[1] + 1.1); }
      for (let k = 0; k < 2; k++) { const s = spot(1.0, 0.35); if (!s) break; f.push(s[0], H, s[1], r() < 0.5 ? 0 : Math.PI); FURN_DEF.bench(f); f.pop(); }
      for (let k = 0; k < 2; k++) { const s = spot(0.8, 0.8); if (!s) break; f.push(s[0], H, s[1], r() * 6); treeRound(f, 3.2, 0.45, k, '#5a9447'); f.pop(); }
    }
    void bulkTop;
  }
  // ------------------------------------------------------------ signs
  signs(sq, f, B, bi) {
    let text = null, style = null, big = false;
    if (B.tackle && B.module) return;   // (a dock's store: its name is on the dock's own porch board — render/docks.js dockSigns)
    if (B.type === 'hq') { text = B.sign || B.name; style = { bg: '#e8453c', fg: '#ffffff', logo: '◆', logoBg: '#1c2226', span: 2 }; big = true; }
    else if (isStore(B)) { text = B.sign || B.shopName || B.name; style = SIGN_STYLE[B.mixed || B.type] || SIGN_STYLE.shop; if (style === SIGN_STYLE.shop) style = { ...style, bg: B.colors?.accent || '#23395b' }; }
    else if (B.sign) { text = B.sign; style = SIGN_STYLE.office; }
    if (!text) return;
    const s = this.atlas.sign('b:' + bi, text, style);
    const hd = B.d / 2, H = B.floors * FLOOR_H;
    const quad = (cx, y0, h, maxW, z) => {
      const w = Math.min(maxW, h * s.aspect * 0.95);
      f.ext = { aB: [bi], aH: [0, 0] };
      f.push(B.x, GROUND_Y + baseOf(B), B.z, bRot(B)); f.col('#1b1d21'); f.box(cx - w / 2 - 0.06, y0 - 0.06, hd, cx + w / 2 + 0.06, y0 + h + 0.06, z - 0.004); f.pop();
      f.ext = {};
      const P = [[cx - w / 2, y0], [cx + w / 2, y0], [cx + w / 2, y0 + h], [cx - w / 2, y0 + h]].map(([lx, y]) => { const p = toWorld(B, lx, z); return [p.x, GROUND_Y + baseOf(B) + y, p.z]; });
      const rot = bRot(B), n = [Math.sin(rot), 0, Math.cos(rot)], uv = s.uv;
      sq.quad(P, n, null, k => ({ uv: [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]][k], aB: bi }));
    };
    if (big) quad(0, H - 2.9, 2.2, B.w - 2, hd + 0.14);
    else if (isStore(B)) quad(0, streetSignY(B, 3.06, 0.62), 0.62, B.w - 1.4, hd + 0.1);
    else quad(B.door ? B.door.x : 0, streetSignY(B, 3.0, 0.55), 0.55, Math.min(B.w - 1.4, 6), hd + 0.1);
  }
  // ------------------------------------------------------------ the camera inside a building
  /** The building the camera is in (or within the near plane's reach of its walls: near × 1.8, so a first-person camera
   *  beside a wall keeps the building), or -1. Its walls are drawn from outside only, so from in there they vanish;
   *  everything else of it (balconies, awnings, signs, the roof's things, rooftop billboards) then goes too instead of
   *  floating in the air (GU.uInB, mats.js fadeOut; 2026-10-06). */
  cameraIn(p, near = 0.4) {
    const L = this.world.buildings, m = Math.min(3, Math.max(0.12, near * 1.8));
    const inside = B => {
      if (!B || B.gone || B.type === 'park') return false;
      const y0 = GROUND_Y + baseOf(B);
      if (p.y < y0 - 1 || p.y > y0 + B.floors * FLOOR_H + 1.1) return false;
      const l = toLocal(B, p.x, p.z, _inL);
      return Math.abs(l.x) < B.w / 2 + m && Math.abs(l.z) < B.d / 2 + m;
    };
    if (this.inB >= 0 && inside(L[this.inB])) return this.inB;
    for (let i = 0; i < L.length; i++) if (inside(L[i])) return (this.inB = i);
    return (this.inB = -1);
  }
  // ------------------------------------------------------------ interaction
  /** Opens a building's entrance on its facade when someone is at it (outside, or just inside on the street floor) or it
   *  is held open (the world doc doors), and closes it after (people bucketed in 6 m cells every 8th frame). */
  doorsTick(app, dt) {
    const W = app.S.world, A = app.agents, P = app.player;
    if (!W || !A) return;
    if (this.doorFrame++ % 8 === 0) {
      const cell = new Map(), key = (x, z) => `${Math.floor(x / 6)},${Math.floor(z / 6)}`;
      const add = (x, z) => { const k = key(x, z); (cell.get(k) || cell.set(k, []).get(k)).push(x, z); };
      for (let i = 0; i < A.n; i++) { const c = A.ctx[i]; if (c === -1 || (c >= 0 && (c & 63) === 0)) add(A.rx[i], A.rz[i]); }
      if (P && P.active) add(P.x, P.z);
      this.doorWant.fill(0);
      for (const B of W.buildings) {
        if (!B || B.gone || !B.door || B.idx >= this.doorWant.length) continue;
        const r = (B.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), lz = B.d / 2;
        const x = B.x + B.door.x * c + lz * sn, z = B.z - B.door.x * sn + lz * c;
        if (W.doors?.[`${B.idx}:0:entrance`]) { this.doorWant[B.idx] = 1; continue; }
        for (let gx = -1; gx <= 1 && !this.doorWant[B.idx]; gx++) for (let gz = -1; gz <= 1; gz++) {
          const list = cell.get(`${Math.floor(x / 6) + gx},${Math.floor(z / 6) + gz}`);
          if (list) for (let k = 0; k < list.length; k += 2) { const ex = list[k] - x, ez = list[k + 1] - z; if (ex * ex + ez * ez < 3.2) { this.doorWant[B.idx] = 1; break; } }
          if (this.doorWant[B.idx]) break;
        }
      }
    }
    let changed = false;
    for (let b = 0; b < this.doorT.length; b++) {
      const want = this.doorWant[b], t = this.doorT[b];
      if (t === want) continue;
      this.doorT[b] = want > t ? Math.min(1, t + dt * 2.4) : Math.max(0, t - dt * 1.8);
      const v = Math.round(this.doorT[b] * 255);
      if (v !== this.doorOpen[b]) { this.doorOpen[b] = v; changed = true; }
    }
    if (changed) this.doorTex.needsUpdate = true;
  }
  pick(ray, focusB = -1, cutY = 1e9) {
    let best = null;
    const W = this.world.buildings;
    for (let idx = 0; idx < W.length; idx++) {
      const B = W[idx];
      if (!B || B.gone || B.type === 'park') continue;
      let r = ray, hw, hd;
      if (square(B)) { const fp = footprint(B); hw = (fp.x1 - fp.x0) / 2; hd = (fp.z1 - fp.z0) / 2; }
      else {   // turned: test the ray in the building's own frame
        const o = toLocal(B, ray.origin.x, ray.origin.z), a = bRot(B), c = Math.cos(a), s = Math.sin(a), d = ray.direction;
        r = _lray; r.origin.set(o.x + B.x, ray.origin.y, o.z + B.z); r.direction.set(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
        hw = B.w / 2; hd = B.d / 2;
      }
      _box.min.set(B.x - hw, baseOf(B) - 0.5, B.z - hd); _box.max.set(B.x + hw, idx === focusB ? cutY : buildingTop(B) + 0.9, B.z + hd);
      let hit = r.intersectBox(_box, _hit);
      if (!hit) continue;
      if (r !== ray) { const w = toWorld(B, hit.x - B.x, hit.z - B.z); hit = _hit.set(w.x, hit.y, w.z); }
      const d = hit.distanceTo(ray.origin);
      if (!best || d < best.d) best = { b: idx, d, point: hit.clone() };
    }
    return best;
  }
  setHover(b) { this.uni.uHoverB.value = b; }
  setSel(b) { this.uni.uSelB.value = b; }
  /** The selected and the hovered building drawn alone, for their outline (render/outline.js): its chunk's meshes
   *  through a mask material that keeps only its own triangles (aB), cut where it is looked into as the facade is. */
  outlineDraw(draw) {
    // (the building looked into is open already — its floor controls say so: never outlined, picked or hovered)
    const open = GU.uFocusB.value, sel = this.uni.uSelB.value === open ? -1 : this.uni.uSelB.value, hov = this.uni.uHoverB.value === open ? -1 : this.uni.uHoverB.value;
    this.masks ??= { sel: { mat: maskMatB(), list: [] }, hov: { mat: maskMatB(), list: [] } };
    for (const [b, M] of [[sel, this.masks.sel], [hov === sel ? -1 : hov, this.masks.hov]]) {
      const B = b >= 0 ? this.world.buildings[b] : null, c = B && !B.gone && B.type !== 'park' ? this.chunks.get(this.chunkKey(B)) : null;
      if (!c) continue;
      M.mat.uniforms.uB.value = b;
      // (round it: its footprint turned any way, awnings and signs out from it, from its ground to over its roof)
      const r = Math.hypot(B.w || 20, B.d || 20) / 2 + 4, y0 = floorAt(B, 0) - 1;
      (M.box ??= new THREE.Box3()).min.set(B.x - r, y0, B.z - r); M.box.max.set(B.x + r, floorAt(B, B.floors || 1) + 12, B.z + r);
      c.forEach((src, n) => {
        let m = M.list[n];
        if (!m) { m = M.list[n] = new THREE.Mesh(src.geometry, M.mat); m.frustumCulled = false; m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; }
        m.geometry = src.geometry; m.matrixWorld.copy(src.matrixWorld);
        draw(m, M === this.masks.sel, M.box);
      });
    }
  }
  /** The floor of building B that height y (m, world) is on: a tap on its outside picks that floor. */
  floorOf(B, y) { return Math.max(0, Math.min(B.floors - 1, Math.floor((y - floorAt(B, 0)) / FLOOR_H))); }
  /** Lights floor f of building b (null or -1: none) as picked, or as the one under the pointer (hover). */
  setFloor(b, f, hover = false) {
    const v = this.uni[hover ? 'uFloorHov' : 'uFloorSel'].value, B = b >= 0 ? this.world.buildings[b] : null;
    if (!B || f === null || f === undefined || f < 0 || B.type === 'park') { v.set(-1, 0, 0, 0); return; }
    v.set(b, floorAt(B, f) + (f === 0 ? -0.6 : 0.02), floorAt(B, f + 1) - 0.02, 1);
  }
  update(night) {
    const e = 0.12 + 1.15 * night;
    this.atlas.mat.emissiveIntensity = e; this.signMat.emissiveIntensity = e;
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
