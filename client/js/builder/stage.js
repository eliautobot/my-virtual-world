// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
export function makeStage(host) {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(29, 1, 0.005, 30),
    renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.99;
  // A broad luminous room reflected in curved locks and cloth prevents a
  // plastic point-light highlight and gives the shaded profile a soft fill.
  const generator = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.045);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.42;
  generator.dispose();
  room.dispose();
  host.append(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Interactive 3D character");
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.minDistance = 0.19;
  orbit.maxDistance = 4.7;
  orbit.maxPolarAngle = Math.PI * 0.68;
  orbit.panSpeed = 0.55;
  orbit.rotateSpeed = 0.65;
  scene.add(new T.HemisphereLight(0xfff4e7, 0xb4aaa2, 0.86));
  const light = (x, y, z, color, amp) => {
    const l = new T.DirectionalLight(color, amp);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };
  const key = light(-1.5, 2.2, 2.4, 0xffeddc, 2.04);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -.65,
    right: .65,
    top: 1.30,
    bottom: -.58,
    near: 0.1,
    far: 7,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = 0.00035;
  key.shadow.bias = -0.00012;
  light(1.5, 1.8, -1.4, 0xffe2c6, 1.46);
  light(1, 0.7, 1, 0xe8f2ff, 0.38);
  const disk = new T.Mesh(
    new T.CylinderGeometry(0.48, 0.48, 0.016, 112),
    new T.MeshStandardMaterial({ color: 0xc4cebb, roughness: 0.95 }),
  );
  disk.position.y = -0.0105;
  disk.receiveShadow = true;
  scene.add(disk);
  const ring = new T.Mesh(
    new T.RingGeometry(0.445, 0.446, 128),
    new T.MeshBasicMaterial({ color: 0xa1b19f }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.0023;
  scene.add(ring);
  let body,
    helper,
    mode = "body",
    measure = 1;
  const target = new T.Vector3();
  const marker = new T.Mesh(
    new T.SphereGeometry(0.006, 12, 8),
    new T.MeshBasicMaterial({ color: 0xffb94b, depthTest: false }),
  );
  marker.visible = false;
  marker.renderOrder = 15;
  scene.add(marker);
  function view(v = mode) {
    mode = v;
    const face = v === "face", bust = v === "bust",
      height = measure;
    let y = 0.56;
    if (face && body) {
      body.root.updateMatrixWorld(true);
      const head = body.boneMap.get("Head");
      if (head) {
        head.getWorldPosition(target);
        y = target.y + (height - target.y) * 0.48;
      }
    }
    if (bust) y = height * .835;
    camera.fov = face || bust ? 18 : 29;
    camera.updateProjectionMatrix();
    const span = face ? 0.235 * height : bust ? 0.423 * height : 1.34,
      aspect = camera.aspect;
    const dist =
      (span / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)))) *
      Math.max(1, (face ? 0.82 : bust ? .78 : 0.53) / aspect);
    orbit.target.set(0, y, 0);
    camera.position.set(
      (v === "back" ? -0.04 : face || bust ? 0 : 0.085) * dist,
      y + dist * (face || bust ? 0 : 0.055),
      dist * (v === "back" ? -1 : 1),
    );
    orbit.update();
  }
  function resize() {
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    view();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  function setBody(b) {
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      helper = null;
    }
    marker.visible = false;
    body = b;
    if (b) {
      scene.add(b.root);
      helper = new T.SkeletonHelper(b.root);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.8;
      helper.renderOrder = 12;
      helper.visible = false;
      scene.add(helper);
    }
  }
  function pickJoint(event) {
    if (!helper?.visible || !body) return null;
    const rect = renderer.domElement.getBoundingClientRect(),
      cursor = [event.clientX - rect.left, event.clientY - rect.top];
    let nearest = 13 * 13,
      selection = null,
      depth = Infinity;
    for (const [name, joint] of body.boneMap) {
      joint.getWorldPosition(target).project(camera);
      if (target.z < -1 || target.z > 1) continue;
      const dx = (target.x * 0.5 + 0.5) * rect.width - cursor[0],
        dy = (-target.y * 0.5 + 0.5) * rect.height - cursor[1],
        d = dx * dx + dy * dy;
      if (
        d < nearest - 0.2 ||
        (Math.abs(d - nearest) < 0.2 && target.z < depth)
      ) {
        nearest = d;
        depth = target.z;
        selection = name;
      }
    }
    return selection;
  }
  let last = performance.now();
  return {
    spin(value) {
      orbit.autoRotate=value;
      orbit.autoRotateSpeed=-2.8;
    },
    pickJoint,
    scene,
    view,
    setBody,
    measure(x) {
      measure = x;
    },
    bones(v) {
      if (helper) helper.visible = v;
      marker.visible = v;
    },
    frame(name) {
      if (marker.visible && body?.boneMap.has(name))
        body.boneMap.get(name).getWorldPosition(marker.position);
      const now=performance.now();
      orbit.update(Math.min(.1,(now-last)/1000));
      last=now;
      renderer.render(scene, camera);
    },
    loop(fn) {
      renderer.setAnimationLoop(fn);
    },
    // (MVW: the Agent Studio's Customize tab mounts the stage while building and frees it after)
    renderer,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      orbit.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
}
