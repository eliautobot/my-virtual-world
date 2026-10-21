// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Boot + frame loop. Modules register here; everything else talks through core/state.js (S + bus).
import * as THREE from 'three';
import { S, bus, setWorld, setFocus, select, viewGrid } from './core/state.js';
import { AutoResolution } from './core/autores.js';
import { FramePace } from './core/framepace.js';
import { rf } from './core/render-flags.js';
import { Net, getJSON } from './core/net.js';
import { auth } from './core/auth.js';
import { pref } from './core/prefs.js';
import { readEnvelope, homeEnvelope, applyFrame } from './core/home-frame.js';
import { Stage, GU } from './render/scene.js';
import { CityCamera } from './render/camera.js';
import { UnderwaterFX } from './render/underwater-fx.js';
import { City } from './render/city.js';
import { Buildings } from './render/buildings.js';
import { Interiors } from './render/interiors.js';
import { Doors } from './render/doors.js';
import { Agents } from './render/agents.js';
import { SignAtlas } from './render/qb.js';
import { watchIcons } from './core/icons.js';
import { hourAt, dayAt, floorAt } from '/shared/constants.js';
import { installEyes } from './core/pw-eye.js';
installEyes();   // the show/hide eye on every password field, the sign-in dialog at boot included

const Q = new URLSearchParams(location.search);
/** The loading screen (js/loading.js): how far along, what is happening, and the step's figure. */
function progress(p, msg, phase) {
  if (window.__mvwLoading) window.__mvwLoading.set(p, msg, phase);
  else if (msg) { const m = document.getElementById('load-msg'); if (m) m.textContent = msg; }
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

export const app = { S, bus, Q, THREE, auth };
window.__mvw = app;
app.icons = watchIcons(document.body);   // the interface's emoji become the theme's line icons (core/icons.js)

/** Re-apply the interior view for S.focus (also used after edits / wall-mode changes). */
export function applyFocus() {
  const { b, f } = S.focus;
  const cutY = app.inter.setFocus(b, f, app.cam?.fp && app.player?.active ? 'fp' : S.walls);   // first person: full walls, a ceiling
  GU.uFocusB.value = b;
  GU.uCutY.value = cutY;
  const B = b >= 0 ? S.world.buildings[b] : null;
  if (B) GU.uFade.value.set(B.x, floorAt(B, f) + 1.2, B.z, Math.max(B.w, B.d) * 0.55 + 7);
  else GU.uFade.value.set(0, 0, 0, 0);
  bus.emit('focus:applied', S.focus);
}
app.applyFocus = applyFocus;

async function boot() {
  const canvas = document.getElementById('gl');
  if (!canvas.getContext('webgl2')) { progress(0, 'This browser does not support WebGL2.', 'error'); return; }
  progress(0.05, 'Checking your account…', 'account');
  await auth.refresh();
  // a website link (#register, #signin): its dialog at once, over the loading screen; the city keeps loading behind it
  // (when guests may not watch, signInToWatch below takes the link instead)
  if (/^#(?:.*&)?(?:register|signin)(?:[=&]|$)/.test(location.hash) && !auth.account && auth.me?.caps?.['world.view']) import('./ui/account.js').then(m => m.openEntryEarly()).catch(() => {});
  progress(0.08, 'Loading the city…', 'city');
  let wj, pj;
  try {
    if (auth.me && auth.me.caps && !auth.me.caps['world.view']) throw Object.assign(new Error('Sign in to watch'), { status: 401 });
    [wj, pj] = await Promise.all([getJSON('/api/world'), getJSON('/api/people')]);
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
    progress(0.05, 'Sign in to watch this world', 'signin');   // the owner or an admin requires sign-in to watch
    const m = await import('./ui/account.js');
    await m.signInToWatch();
    return;
  }
  setWorld(wj.world);
  S.people = pj.people; S.presence = pj.presence || {};
  progress(0.3, 'Building streets…', 'streets'); await nextFrame();
  const stage = app.stage = new Stage(canvas, Q.get('q') || S.quality);
  const cam = app.cam = new CityCamera(stage.camera, canvas);
  const uwfx = new UnderwaterFX(stage);   // under water: specks and the view's dark edge (render/underwater-fx.js)
  const g = viewGrid(S.world);   // (the city, or without one its island's plain)
  cam.bounds = { x0: g.minX - 60, x1: g.maxX + 60, z0: g.minZ - 60, z1: g.maxZ + 60 };
  // The headquarters is a normal building that admins may demolish (DECISIONS C103): app.hq is the standing one, else the
  // first standing building (the G key, the player's fallback spawn).
  Object.defineProperty(app, 'hq', {
    configurable: true,
    get: () => S.world.buildings.find(b => b && !b.gone && b.type === 'hq') || S.world.buildings.find(b => b && !b.gone) || S.world.buildings[0],
  });
  // The camera starts at this account's own home view (this device's copy of it; ui/home.js follows the account's stored
  // one when it differs), else the city's default, else a view over the whole city — not at the headquarters (2026-10-09).
  applyFrame(cam, homeEnvelope({ own: readEnvelope(pref('home')), world: S.world.home, grid: g, cam }), { jump: true });
  app.startView = { x: cam.goal.x, z: cam.goal.z, d: cam.goalDist };   // (still here: nobody has moved the camera yet)
  if (Q.get('cam')) {
    const [x, z, d, yaw, pitch] = Q.get('cam').split(',').map(Number);
    cam.jumpTo(x, 0, z, d || 120);
    if (Number.isFinite(yaw)) cam.yaw = cam.goalYaw = yaw;
    if (Number.isFinite(pitch)) cam.pitch = cam.goalPitch = pitch;
    cam.apply();
  }
  const atlas = app.atlas = new SignAtlas();
  const city = app.city = new City(S.world, atlas);
  stage.scene.add(city.group);
  // The island around the city (WP4.2): only when the world has terrain; older worlds keep their endless plain.
  if (S.world.terrain) {
    const { Terrain } = await import('./render/terrain.js');
    app.terrain = new Terrain(stage, S.world, { quality: stage.q.name });
    stage.scene.add(app.terrain.group);
    stage.bigWorld = true;
    cam.bounds = app.terrain.bounds();
    bus.on('terrain', () => { cam.bounds = app.terrain.bounds(); });   // islands of the chain widen the world (WP4.15)
    cam.maxDist = 9000; cam.farBase = 7000; cam.maxFar = 26000;
  }
  progress(0.45, 'Raising buildings…', 'buildings'); await nextFrame();
  const blds = app.blds = new Buildings(S.world, g, atlas);
  stage.scene.add(blds.group);
  progress(0.6, 'Furnishing…', 'furnish'); await nextFrame();
  const inter = app.inter = new Interiors(S.world, atlas);
  stage.scene.add(inter.group);
  const doors = app.doors = new Doors(stage.scene, app);   // the focused floor's doors, opening as people come near
  bus.on('focus:applied', () => doors.build());
  bus.on('doors', () => doors.sync());
  bus.on('frame', dt => app.blds?.doorsTick?.(app, Math.min(0.1, dt)));   // the facades' entrance doors
  bus.on('frame', dt => doors.update(Math.min(0.1, dt)));
  app.hooks = app.hooks || { key: [], click: [], hover: [] };
  app.hooks.click.push(e => {   // a click or tap on a door holds it open or lets it close (exploring or playing)
    if (S.mode !== 'explore' && S.mode !== 'play') return false;
    const d = doors.pick(app.cam.rayAt(e.clientX, e.clientY));
    if (!d) return false;
    if (!doors.toggle(d)) app.toast?.('🔒 This flat is locked', 'bad', 2200);
    return true;
  });
  progress(0.72, 'Meeting the residents…', 'residents'); await nextFrame();
  const net = app.net = new Net();
  const agents = app.agents = new Agents(net, stage);
  agents.refreshWorld(S.world);
  // walkers' feet on the drawn roads beyond the city (render/agents.js feet); the city's streets keep the city's levels
  agents.surfaceAt = (x, z) => { const T = app.terrain, H = T?.hole; if (H && x > H.x0 && x < H.x1 && z > H.z0 && z < H.z1) return null; return T?.ground?.island.roads?.top(x, z) ?? null; };
  S.people.forEach((p, i) => agents.setAppearance(i, p.a));
  stage.scene.add(agents.group);
  // what is picked or under the pointer, outlined (render/outline.js): people, buildings, the piece being edited
  for (const src of [agents.chars, blds, inter]) stage.outline.add(draw => src.outlineDraw(draw));
  agents.chars.tableTop = (x, z, highest, far) => inter.tableTopAt(x, z, highest, far);   // (a laptop on the table's own top)
  bus.on('focus', () => applyFocus());
  net.connect();
  await new Promise(res => { if (net.synced) res(); else { const off = bus.on('synced', () => { off(); res(); }); setTimeout(res, 5000); } });
  // optional UI / feature modules (loaded after the core so a failure there never blocks the world)
  progress(0.8, 'Waking the city…', 'waking');
  const MODS = ['./core/sync.js', './core/agents.js', './core/prefs.js', './core/theme.js', './render/traffic.js', './render/weather.js', './render/wildlife.js', './audio/mixer.js', './audio/ambience.js', './render/labels.js', './ui/docks.js', './ui/ui.js', './render/promo-aircraft.js', './render/ferries.js', './render/airport.js', './render/docks.js', './render/sea-probe.js', './render/resident-cars.js', './render/boats.js', './render/fountains.js', './ui/perfhud.js', './ui/chat.js', './ui/talk-bar.js', './ui/notify.js', './ui/account.js', './ui/editors.js', './ui/place-tool.js', './ui/world-menu.js', './ui/walls-tool.js', './ui/home.js', './ui/activity.js', './ui/customizer.js', './ui/profile.js', './ui/property.js', './ui/economy.js', './ui/inventory.js', './ui/free-will.js', './ui/mind.js', './ui/agent-studio.js', './ui/sel-feeds.js', './ui/work.js', './ui/roads.js', './ui/lot-tools.js', './ui/ferry-tools.js', './ui/world-modules.js', './ui/terrain-tools.js', './ui/coast-tools.js', './ui/decor-tools.js', './ui/marketing.js', './render/signs.js', './player/vehicles.js', './player/flight.js', './player/boating.js', './play/airport-game.js', './play/fishing-game.js', './audio/aircraft-sound.js', './player/player.js', './player/remote.js', './ui/worldmap.js', './ui/social.js', './ui/licence.js', './ui/agent-providers.js', './ui/guide.js', './render/pc-screens.js'];
  for (const [mi, mod] of MODS.entries()) {
    progress(0.8 + 0.12 * mi / MODS.length);
    try { const m = await import(mod); if (m.init) await m.init(app); }
    catch (err) { if (!/Failed to fetch|Importing a module script failed|error loading dynamically/i.test(String(err && err.message))) console.error('[mvw] module', mod, err); }
  }
  // The world and its people arrive with the live stream's first patches, which is before these modules load, so the
  // 'world' event has already fired by now. Emit both once here (after the modules exist) so the dock lists, the
  // minimap and the panels come up filled — found 2026-09-28: the Buildings list was empty at boot.
  bus.emit('world', { levels: new Set(), blds: new Set() });
  bus.emit('people');
  if (Q.get('focus')) { const [b, f] = Q.get('focus').split(',').map(Number); setFocus(b, f || 0); }
  if (Q.get('sel')) select(+Q.get('sel'), { fly: true });
  if (Q.get('mode') && app.setMode) app.setMode(Q.get('mode'));
  const hourOverride = Q.has('hour') ? +Q.get('hour') : null;
  let last = performance.now(), frames = 0, fpsT = last, cpuAcc = 0;
  app.fps = 0; app.cpuMs = 0;
  const step = (now) => {
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    const sim = net.simNow();
    S.simT = sim;
    S.hour = hourOverride ?? (net.clock ? hourAt(net.clock, sim) : 12);
    S.day = net.clock ? dayAt(net.clock, sim) : 0;
    bus.emit('preframe', dt, now);
    // The camera rides on the ground over the island's hills — except while looking inside a building, where it sits at
    // the floor being looked at (riding the ground pulled it back down to the street: broken since the island arrived).
    if (app.terrain && !app.player?.active && S.focus.b < 0) app.terrain.followGround(cam, dt);
    cam.update(dt);
    if (app.terrain) app.terrain.keepCameraAbove(stage.camera, cam);
    // the camera under water (diving, in first person — any other camera stays over the water): the water's look
    // (scene.js Stage.under, render/underwater-fx.js)
    { const cp = stage.camera.position, wq = cam.fpK > 0 && app.terrain?.ground ? app.terrain.ground.water(cp.x, cp.z) : null;
      stage.under = wq && cp.y < wq.level - 0.04 ? { kind: wq.kind, depth: wq.level - cp.y } : null; uwfx.update(cp, !!stage.under); }
    GU.uCamP.value.copy(stage.camera.position);
    const inB = app.blds ? app.blds.cameraIn(stage.camera.position, stage.camera.near) : -1;
    GU.uInB.value = inB === S.focus.b ? -1 : inB;   // a building looked inside keeps its own cut
    stage.update(S.hour, cam.target, cam.dist, now / 1000);
    if (stage.q.shadows) city.updateShadowSplit(stage.sun.target.position.x, stage.sun.target.position.z, stage.sun.shadow.camera.right);
    GU.uIndoor.value = 0.1 + 0.32 * stage.state.night;
    agents.chars.uniforms.uIndoor.value = GU.uIndoor.value; agents.chars.uniforms.uNight.value = GU.uNight.value;
    city.update(sim, net.realNow());
    if (app.terrain) app.terrain.update(stage.camera);
    blds.update(stage.state.night);
    agents.update(dt, now / 1000);
    bus.emit('frame', dt, now);
    stage.render();
    bus.emit('postframe', dt, now);
    cpuAcc += performance.now() - t0;
    frames++;
    if (now - fpsT > 1000) { app.fps = frames * 1000 / (now - fpsT); app.cpuMs = cpuAcc / frames; frames = 0; cpuAcc = 0; fpsT = now; }
  };
  // One frame per display refresh. tools/perf.cjs sets app.hold and calls app.step itself, so it can time frames
  // without the display's frame-rate cap.
  // Automatic resolution (Settings → General): fewer pixels while a device's GPU falls behind in a busy view.
  const AR = app.autoRes = new AutoResolution({ set: s => stage.setResScale(s), min: stage.q.name === 'high' ? 0.7 : 0.6, on: localStorage.getItem('mvw.autoRes') !== '0' });
  // Frame pacing (core/framepace.js): phones draw 30 a second once still and untouched, never more than 60
  const pace = app.pace = new FramePace({ battery: matchMedia('(pointer: coarse)').matches });
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, () => pace.input(performance.now()), { capture: true, passive: true });
  const camBusy = () => !!(cam.follow || app.player?.active || app.drive?.active || cam.drag || cam.pointers?.size
    || cam.goal.distanceToSquared(cam.target) > 0.01 || Math.abs(cam.goalDist - cam.dist) > 0.05 || Math.abs(cam.goalYaw - cam.yaw) > 0.002 || Math.abs(cam.goalPitch - cam.pitch) > 0.002);
  bus.on('postframe', (dt, now) => { if (pace.idle || pace.mode === '30' || pace.covered) AR.rest(now); else AR.frame(now); });   // (slowed on purpose: not a GPU falling behind)
  // Compile the scene's shaders and draw one frame while the loading screen still covers it, so the first visible frame
  // is not the long one. Bounded: a slow driver never holds the loading screen longer than 4 s. The sky's light (the
  // scene's environment map) is made first: a material compiled without it is a different shader from the one it draws with.
  stage.update(hourOverride ?? (net.clock ? hourAt(net.clock, net.simNow()) : 12), cam.target, cam.dist, performance.now() / 1000);
  progress(0.93, 'Lighting up the world…', 'lighting');
  const warm = app.terrain?.warmGroup?.(); if (warm) stage.scene.add(warm);   // tiles' shaders too (render/terrain.js)
  const chWarm = agents.chars.warmGroup?.(); if (chWarm) stage.scene.add(chWarm);   // and the characters', who arrive later
  // (compiled the way this quality draws them, render/scene.js; the phone needs ~5 s for them all, so up to 10 s here)
  await Promise.race([stage.compileForDrawing(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  if (warm) { stage.scene.remove(warm); warm.userData.dispose(); }
  if (chWarm) stage.scene.remove(chWarm);
  stage.warmPasses();
  step(performance.now());
  if (window.__mvwLoading) window.__mvwLoading.done('Welcome!');   // the art bursts, then the screen fades (class 'done')
  else setTimeout(() => document.getElementById('loading')?.classList.add('done'), 150);
  app.step = step;
  app.hold = false;
  // How often the sun's shadows are redrawn. Phones drawing 60 a second: every other frame (the sun barely moves; a
  // person's shadow a frame behind is not seen); at 30, every frame. Adaptive shadows (render flag 'shadows', from the
  // reference renderer's far cascade): zoomed out so far that a shadow texel is over 0.35 m, people, cars, lamps, bins,
  // signals and decor (userData.smallCaster) leave the shadow pass — their shadows would be a pixel's smudge — and what
  // is left (buildings, trees, bridges, rock) is redrawn every third frame.
  let shadowTick = 0, smallSeen = -1e9, smallOff = false;
  const smallDisabled = new Set();
  const adaptive = rf('shadows');
  if (stage.q.shadows && (pace.battery || adaptive)) bus.on('preframe', (dt, now) => {
    const r = stage.renderer, S = stage.sun.shadow.camera.right, far = adaptive && 2 * S / stage.q.shadowSize > 0.35;
    if (adaptive && (far !== smallOff || (far && now - smallSeen > 1000))) {
      smallSeen = now;
      if (far) stage.scene.traverse(o => { if (o.userData.smallCaster && o.castShadow) { o.castShadow = false; smallDisabled.add(o); } });
      else { for (const o of smallDisabled) o.castShadow = true; smallDisabled.clear(); shadowTick = 0; }
      smallOff = far;
    }
    const every = far ? 3 : pace.battery && !(pace.idle || pace.mode === '30') ? 2 : 1;
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = shadowTick++ % every === 0;
  });
  // (a window over the whole world: core/framepace.js cover — live lists, so the look every frame costs next to nothing)
  const modals = document.getElementsByClassName('modal-back'), chats = document.getElementsByClassName('chat-back');
  const covered = () => {
    for (const m of modals) if (!m.classList.contains('peek')) return true;   // (the Studio stepped aside shows the world)
    for (const c of chats) if (!c.classList.contains('floating') && !c.classList.contains('min')) return true;   // (a chat full screen; floating or put away, the world goes on)
    return false;   // (the Map draws on the world's frames — render/worldmap.js 'preframe' — and keeps them all)
  };
  const loop = (now) => { requestAnimationFrame(loop); pace.cover(covered(), now); if (!app.hold && pace.due(now, camBusy())) step(now); };
  requestAnimationFrame(loop);
  app.ready = true;
  bus.emit('ready');   // (a link from a notification opens what it is about: ui/notify.js)
}
boot().catch(err => { console.error('[mvw] boot failed', err); progress(0, 'Failed to start: ' + (err && err.message || err), 'error'); });
