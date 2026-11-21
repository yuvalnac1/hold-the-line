// Renderer, camera, lighting, post-processing and the static battlefield.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { W, H, LANES, BUNKER, GATES, distToLane, lanePoint, GRAVE_L, GRAVE_R, ARENA, BLOCKED } from '../arena.js';
import { mat, G, TEAM_COLORS } from './models.js';

export const toWorld = (x, y, out = new THREE.Vector3()) => out.set(x - W / 2, 0, y - H / 2);

// Per-arena look. Colours are hex; sky = top/middle/bottom gradient.
export const THEMES = {
  graveyard: { grass: [0x3a5f30, 0x5c8238, 0x467048], dirt: [0x9a7448, 0x77573a], soil: [0x3a3230, 0x2a2626], hill: 0x1f2d24,
    tuft: [0.24, 0.45, 0.25], sky: ['#05060f', '#141a35', '#2a2346'], fog: 0x1a1d33, hemi: [0xaabbff, 0x3a3028, 1.7], key: [0xdde4ff, 3.0], warm: [0xffb070, 0.7],
    tree: 'dead', blocked: 'water', rock: [0.08, 0.08], fogTint: 0x8a98c0, celestial: 'moon' },
  winter: { grass: [0xb4c2d2, 0xc6d2de, 0xa9b8ca], dirt: [0x7d8ea6, 0x63738c], soil: [0x5b6576, 0x4a5262], hill: 0x8a99ad,
    tuft: [0.58, 0.15, 0.62], sky: ['#0a1428', '#24395e', '#5a6f96'], fog: 0x3a4a68, hemi: [0xcfe0ff, 0x56607a, 1.45], key: [0xe6f0ff, 2.4], warm: [0x9fc4ff, 0.5],
    tree: 'pine', blocked: 'ice', rock: [0.6, 0.06], fogTint: 0xdfe8ff, celestial: 'moon', bag: 0xa9a48e, tuftDensity: 0.18 },
  desert: { grass: [0xc29a5e, 0xd2ab6c, 0xb48c52], dirt: [0x8e6a44, 0x7a5a3a], soil: [0x8c6e4c, 0x76593c], hill: 0x9c7348,
    tuft: [0.13, 0.45, 0.42], sky: ['#1b1030', '#6a3150', '#e0835a'], fog: 0x6a4040, hemi: [0xffd2a8, 0x5a4030, 1.6], key: [0xffd9a0, 3.2], warm: [0xff8040, 1.0],
    tree: 'cactus', blocked: 'oasis', rock: [0.06, 0.35], fogTint: 0xffc49a, celestial: 'sun', tuftDensity: 0.1 },
  naval: { grass: [0xc8b585, 0xd6c495, 0xb9a676], dirt: [0x7a5634, 0x664628], soil: [0x5d6f78, 0x4c5c66], hill: 0x1d4660,
    tuft: [0.2, 0.35, 0.4], sky: ['#040a18', '#0f2846', '#2c5878'], fog: 0x14304a, hemi: [0xa8d4ff, 0x30404a, 1.7], key: [0xdcecff, 2.9], warm: [0xffc080, 0.6],
    tree: 'palm', blocked: 'water', rock: [0.55, 0.08], fogTint: 0x9ac4e8, celestial: 'none', sea: true, plankPaths: true, tuftDensity: 0.08 },
  volcano: { grass: [0x2e2626, 0x3a2e2a, 0x262022], dirt: [0x5a3a2c, 0x4a2e24], soil: [0x1e1a1a, 0x161313], hill: 0x1a1414,
    tuft: [0.04, 0.3, 0.16], sky: ['#0a0204', '#2a0a08', '#5a1a0c'], fog: 0x2a0e08, hemi: [0xffb08a, 0x2a1810, 1.5], key: [0xffc8a0, 2.4], warm: [0xff5020, 1.4],
    tree: 'dead', blocked: 'lava', rock: [0.02, 0.1], fogTint: 0x8a4a3a, celestial: 'none', tuftDensity: 0.2, charred: true },
};
let THEME = THEMES.graveyard;

// ---------- noise ----------
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function allLanes() { return [...LANES[0], ...LANES[1]]; }
function pathDist(x, y) { let d = Infinity; for (const l of allLanes()) d = Math.min(d, distToLane(l, x, y)); return d; }

export function terrainHeight(x, y) {
  const pd = pathDist(x, y);
  let h = -0.16 * (1 - smooth(0.5, 0.78, pd));
  // frame hills outside the arena (or a sea shelf for the harbour)
  const ox = Math.max(0, -x, x - W), oy = Math.max(0, -y, y - H);
  const out = Math.hypot(ox, oy);
  if (THEME.sea) h -= out > 0 ? Math.min(0.9, out * 0.5) : 0;
  else h += out > 0 ? Math.min(3.2, out * out * 0.12 + out * 0.25) * (0.7 + fbm(x * 0.3, y * 0.3) * 0.6) : 0;
  // pools (water / lava / ice) sink a little
  const bd = blockedDepth(x, y);
  if (bd > 0) h -= bd * 0.32;
  // grave mounds
  if (x > GRAVE_L + 0.3 && x < GRAVE_R - 0.3) h += Math.max(0, fbm(x * 1.3, y * 1.3) - 0.55) * 0.35;
  return h;
}

// 0 outside pools, 1 well inside (soft edges)
function blockedDepth(x, y) {
  let best = 0;
  for (const side of BLOCKED) for (const r of side) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w)), dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    const inside = Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
    const v = dx > 0 || dy > 0 ? 1 - smooth(0, 0.35, Math.hypot(dx, dy)) : 0.6 + 0.4 * smooth(0, 0.6, inside);
    best = Math.max(best, v * (dx > 0 || dy > 0 ? 0.5 : 1));
  }
  return best;
}

function noiseTexture(size = 512, tint = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x / 9, y / 9) * 0.55 + hash(x, y) * 0.45;
    const v = Math.floor((0.72 + n * 0.28 * tint) * 255);
    const i = (y * size + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function softTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let k = 0; k < 14; k++) {
    const x = size * (0.25 + Math.random() * 0.5), y = size * (0.25 + Math.random() * 0.5), r = size * (0.15 + Math.random() * 0.25);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function skyTexture(stops = THEME.sky) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, stops[0]); g.addColorStop(0.5, stops[1]); g.addColorStop(1, stops[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Stage {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.35;
    r.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1d33, 38, 75);

    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 200);
    this.camTarget = new THREE.Vector3(0, 0, 1.4);
    this.shake = 0;

    // lights
    const hemi = this.hemi = new THREE.HemisphereLight(0xaabbff, 0x3a3028, 1.7);
    scene.add(hemi);
    const moon = this.moon = new THREE.DirectionalLight(0xdde4ff, 3.0);
    moon.position.set(-14, 30, -16);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 16; sc.bottom = -16; sc.near = 5; sc.far = 80;
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.03;
    scene.add(moon);
    const warm = this.warm = new THREE.DirectionalLight(0xffb070, 0.7);
    warm.position.set(10, 8, 18);
    scene.add(warm);

    this.world = null;
    this.setArena(ARENA.id);

    // post
    const size = new THREE.Vector2(); r.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.75, 0.55, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const cam = this.camera;
    cam.aspect = w / h;
    // fit the arena (plus a margin) into view with a ~56° tilt; leave room for HUD top/bottom
    const tilt = THREE.MathUtils.degToRad(56);
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const needW = W + 3.2, needD = H + 2;
    const dW = (needW / 2) / Math.tan(hfov / 2) + 2;
    const dH = (needD * Math.sin(tilt) / 2) / Math.tan(vfov / 2) * 1.25 + 2;
    const dist = Math.max(dW, dH);
    this.camBase = new THREE.Vector3(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist).add(this.camTarget);
    cam.position.copy(this.camBase);
    cam.lookAt(this.camTarget);
    cam.updateProjectionMatrix();
    this.pointScale = h * Math.min(window.devicePixelRatio, 1.5) / (2 * Math.tan(vfov / 2));
  }

  addShake(a) { this.shake = Math.min(0.6, this.shake + a); }

  render(dt) {
    const cam = this.camera;
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
      cam.position.copy(this.camBase).add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    } else cam.position.copy(this.camBase);
    cam.lookAt(this.camTarget);
    this.time = (this.time || 0) + dt;
    for (const u of this.animUniforms) u.value = this.time;
    if (this.fogPlanes) for (const f of this.fogPlanes) { f.material.map.offset.x = (this.time * f.userData.sp) % 1; f.position.y = f.userData.y + Math.sin(this.time * 0.3 + f.userData.ph) * 0.05; }
    this.composer.render(dt);
  }

  // ---------- ground ----------
  // Rebuild everything arena-specific (call after arena.setArena()).
  setArena(id) {
    THEME = THEMES[id] || THEMES.graveyard;
    this.theme = THEME;
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.userData.own) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
    }
    this.world = new THREE.Group();
    this.scene.add(this.world);
    const T = THEME, sc = this.scene;
    sc.background?.dispose?.(); sc.background = skyTexture(T.sky);
    sc.fog.color.setHex(T.fog);
    this.hemi.color.setHex(T.hemi[0]); this.hemi.groundColor.setHex(T.hemi[1]); this.hemi.intensity = T.hemi[2];
    this.moon.color.setHex(T.key[0]); this.moon.intensity = T.key[1];
    this.warm.color.setHex(T.warm[0]); this.warm.intensity = T.warm[1];
    this.buildGround();
    this.buildBlocked();
    this.buildPathDressing();
    this.buildGraveyard();
    this.buildGates();
    this.buildBunkers();
    this.buildFog();
    if (T.celestial !== 'none') this.buildMoon(T.celestial === 'sun');
  }

  // water / lava / ice / oasis pools where nothing can be built
  buildBlocked() {
    const kind = THEME.blocked;
    const look = {
      water: { color: 0x1d6a9a, emissive: 0x0a2a44, ei: 0.6, rough: 0.45, metal: 0, opacity: 0.88 },
      oasis: { color: 0x2a8c8a, emissive: 0x0a3a3a, ei: 0.5, rough: 0.45, metal: 0, opacity: 0.9 },
      ice: { color: 0x6f9fc4, emissive: 0x10263a, ei: 0.2, rough: 0.35, metal: 0, opacity: 0.95 },
      lava: { color: 0xb8300a, emissive: 0xff3a00, ei: 0.75, rough: 0.7, metal: 0, opacity: 1 },
    }[kind];
    for (const side of BLOCKED) for (const r of side) {
      const geo = new THREE.PlaneGeometry(r.w + 0.3, r.h + 0.3, 1, 1); geo.rotateX(-Math.PI / 2);
      const m = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.emissive, emissiveIntensity: look.ei, roughness: look.rough, metalness: look.metal, transparent: look.opacity < 1, opacity: look.opacity });
      const mesh = new THREE.Mesh(geo, m); mesh.userData.own = true;
      mesh.position.copy(toWorld(r.x + r.w / 2, r.y + r.h / 2)); mesh.position.y = -0.2;
      mesh.receiveShadow = true;
      this.world.add(mesh);
      if (kind === 'lava') { const l = new THREE.PointLight(0xff5a20, 4, 5, 1.6); l.position.copy(mesh.position); l.position.y = 0.8; this.world.add(l); }
      // a few props around the edge
      for (let k = 0; k < Math.round((r.w + r.h) * 1.2); k++) {
        const t = k / Math.round((r.w + r.h) * 1.2) * Math.PI * 2;
        const x = r.x + r.w / 2 + Math.cos(t) * (r.w / 2 + 0.15), y = r.y + r.h / 2 + Math.sin(t) * (r.h / 2 + 0.15);
        const rk = new THREE.Mesh(G.dodeca(0.12 + Math.random() * 0.1), mat(kind === 'lava' ? 0x1a1414 : kind === 'ice' ? 0xdfe9f5 : 0x7a7466, { rough: 0.95, flat: true }));
        rk.position.copy(toWorld(x, y)); rk.position.y = terrainHeight(x, y) + 0.04; rk.rotation.set(Math.random() * 3, Math.random() * 3, 0); rk.castShadow = true;
        this.world.add(rk);
      }
      if (kind === 'oasis') { this.palm(r.x - 0.3, r.y + 0.3, 0.9); this.palm(r.x + r.w + 0.2, r.y + r.h - 0.2, 0.8); }
      if (THEME.plankPaths) { // little pier posts
        for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
          const post = new THREE.Mesh(G.cyl(0.06, 0.07, 0.7, 7), mat(0x5a3d24, { rough: 0.9 })); post.position.copy(toWorld(x, y)); post.position.y = 0.05; post.castShadow = true; this.world.add(post);
        }
      }
    }
    if (THEME.sea) {
      const geo = new THREE.PlaneGeometry(W + 60, H + 50); geo.rotateX(-Math.PI / 2);
      const sea = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x174a6a, emissive: 0x06182a, roughness: 0.6, metalness: 0 }));
      sea.userData.own = true; sea.position.y = -0.35; sea.receiveShadow = true;
      this.world.add(sea);
    }
  }

  buildGround() {
    const mx = 12, my = 10;
    const gw = W + mx * 2, gh = H + my * 2;
    const seg = 4; // per tile
    const geo = new THREE.PlaneGeometry(gw, gh, gw * seg, gh * seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const T = THEME;
    const grassA = new THREE.Color(T.grass[0]), grassB = new THREE.Color(T.grass[1]), grassC = new THREE.Color(T.grass[2]);
    const dirtA = new THREE.Color(T.dirt[0]), dirtB = new THREE.Color(T.dirt[1]);
    const soil = new THREE.Color(T.soil[0]), soil2 = new THREE.Color(T.soil[1]);
    const hill = new THREE.Color(T.hill);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + W / 2, y = pos.getZ(i) + H / 2;
      const h = terrainHeight(x, y);
      pos.setY(i, h);
      const n = fbm(x * 0.6, y * 0.6), n2 = fbm(x * 2.3 + 10, y * 2.3);
      col.copy(grassA).lerp(grassB, n).lerp(grassC, n2 * 0.5);
      const pd = pathDist(x, y);
      const inGrave = x > GRAVE_L && x < GRAVE_R;
      if (inGrave) { const t = smooth(GRAVE_L - 0.4, GRAVE_L + 0.6, x) * (1 - smooth(GRAVE_R - 0.6, GRAVE_R + 0.4, x)); col.lerp(new THREE.Color().copy(soil).lerp(soil2, n2), t * 0.85); }
      const pathT = 1 - smooth(0.52, 0.8, pd);
      if (pathT > 0) {
        let pc = new THREE.Color().copy(dirtA).lerp(dirtB, n2 * 0.8 + (pd < 0.6 ? 0.1 : 0.4));
        if (T.plankPaths) pc.multiplyScalar(0.85 + 0.25 * ((Math.floor((x + y) * 3.2) % 2)));   // boardwalk planks
        if (T.blocked === 'lava' && pd < 0.1 && n > 0.55) pc = new THREE.Color(0x7a2410).multiplyScalar(0.7 + n2 * 0.4); // faint ember cracks
        col.lerp(pc, pathT);
      }
      // trench rim darkening
      const rim = Math.exp(-((pd - 0.72) ** 2) / 0.006);
      col.multiplyScalar(1 - rim * 0.35);
      const out = Math.max(0, -x, x - W, -y, y - H);
      if (out > 0) col.lerp(hill, Math.min(1, out * 0.3));
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const tex = noiseTexture(512);
    tex.repeat.set(gw / 3, gh / 3);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(geo, m);
    ground.userData.own = true;
    ground.receiveShadow = true;
    this.world.add(ground);
    this.ground = ground;

    // grass tufts (instanced)
    const tuftGeo = new THREE.ConeGeometry(0.05, 0.22, 4);
    tuftGeo.translate(0, 0.11, 0);
    const tm = new THREE.MeshStandardMaterial({ color: 0x5b7f3c, roughness: 0.9 });
    const tufts = new THREE.InstancedMesh(tuftGeo, tm, 2600);
    const dummy = new THREE.Object3D();
    let n = 0;
    const tc = new THREE.Color();
    const density = THEME.tuftDensity ?? 1;
    for (let k = 0; k < 9000 * density && n < 2600; k++) {
      const x = Math.random() * W, y = Math.random() * H;
      if (blockedDepth(x, y) > 0) continue;
      if (x > GRAVE_L - 0.2 && x < GRAVE_R + 0.2 && Math.random() < 0.8) continue;
      if (pathDist(x, y) < 0.85) continue;
      dummy.position.copy(toWorld(x, y)); dummy.position.y = terrainHeight(x, y);
      dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 3, (Math.random() - 0.5) * 0.5);
      dummy.scale.setScalar(0.6 + Math.random() * 0.9);
      dummy.updateMatrix(); tufts.setMatrixAt(n, dummy.matrix);
      tc.setHSL(THEME.tuft[0] + Math.random() * 0.05, THEME.tuft[1], THEME.tuft[2] + Math.random() * 0.12); tufts.setColorAt(n, tc);
      n++;
    }
    tufts.count = n; tufts.receiveShadow = true;
    this.world.add(tufts);
  }

  // ---------- sandbags, wire, rocks along paths ----------
  buildPathDressing() {
    const bagGeo = G.rbox(0.36, 0.14, 0.22, 0.06);
    const bagMat = new THREE.MeshStandardMaterial({ color: THEME.bag ?? 0xb8a174, roughness: 0.95 });
    const bags = new THREE.InstancedMesh(bagGeo, bagMat, 1800);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let n = 0;
    const postGeo = G.cyl(0.025, 0.03, 0.42, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
    const posts = new THREE.InstancedMesh(postGeo, postMat, 400);
    const coilGeo = new THREE.TorusGeometry(0.14, 0.008, 4, 10);
    const coilMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.8, roughness: 0.4 });
    const coils = new THREE.InstancedMesh(coilGeo, coilMat, 2400);
    let np = 0, nc = 0;
    const p = {};
    for (const lane of allLanes()) {
      for (let d = 0.6; d < lane.length - 0.6; d += 0.38) {
        lanePoint(lane, d, p);
        for (const side of [-1, 1]) {
          const ox = -p.dy * side * 0.78, oy = p.dx * side * 0.78;
          const x = p.x + ox, y = p.y + oy;
          if (pathDist(x, y) < 0.7) continue;
          const segSeed = Math.floor(d / 2.6) * 7 + side * 3 + lane.length;
          const kind = hash(segSeed, 1.7);
          if (kind < 0.55) {
            if (n >= 1800) continue;
            for (let row = 0; row < 2; row++) {
              dummy.position.copy(toWorld(x, y)); dummy.position.y = terrainHeight(x, y) + 0.06 + row * 0.12;
              dummy.rotation.set(0, Math.atan2(p.dx, p.dy) + Math.PI / 2 + (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.1);
              dummy.scale.set(1, 1, 1);
              if (row) dummy.position.x += p.dx * 0.18, dummy.position.z += p.dy * 0.18;
              dummy.updateMatrix(); bags.setMatrixAt(n, dummy.matrix);
              col.setHSL(0.1, 0.3, 0.45 + Math.random() * 0.12); bags.setColorAt(n, col);
              n++;
            }
          } else if (kind < 0.78) {
            if (Math.floor(d / 0.38) % 3 === 0 && np < 400) {
              dummy.position.copy(toWorld(x, y)); dummy.position.y = terrainHeight(x, y) + 0.2;
              dummy.rotation.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2); dummy.scale.set(1, 1, 1);
              dummy.updateMatrix(); posts.setMatrixAt(np++, dummy.matrix);
            }
            for (let k = 0; k < 3 && nc < 2400; k++) {
              dummy.position.copy(toWorld(x + p.dx * k * 0.12, y + p.dy * k * 0.12)); dummy.position.y = terrainHeight(x, y) + 0.16;
              dummy.rotation.set(0, Math.atan2(p.dx, p.dy) + Math.PI / 2 + 0.3, 0); dummy.scale.set(1, 1, 1);
              dummy.updateMatrix(); coils.setMatrixAt(nc++, dummy.matrix);
            }
          }
        }
      }
    }
    bags.count = n; posts.count = np; coils.count = nc;
    for (const m of [bags, posts, coils]) { m.castShadow = true; m.receiveShadow = true; this.world.add(m); }

    // scattered rocks & craters & crates
    const rockGeo = new THREE.DodecahedronGeometry(0.2, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.95, flatShading: true }), 160);
    let nr = 0;
    for (let k = 0; k < 1500 && nr < 160; k++) {
      const x = Math.random() * (W + 8) - 4, y = Math.random() * (H + 6) - 3;
      const inside = x > 0 && x < W && y > 0 && y < H;
      if (inside && (pathDist(x, y) < 1.0 || Math.random() < 0.93 || blockedDepth(x, y) > 0)) continue;
      if (THEME.sea && !inside) continue;
      dummy.position.copy(toWorld(x, y)); dummy.position.y = terrainHeight(x, y) + 0.05;
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      dummy.scale.set(0.6 + Math.random() * 1.6, 0.4 + Math.random() * 0.8, 0.6 + Math.random() * 1.6);
      dummy.updateMatrix(); rocks.setMatrixAt(nr, dummy.matrix);
      col.setHSL(THEME.rock[0], THEME.rock[1], 0.32 + Math.random() * 0.15); rocks.setColorAt(nr, col); nr++;
    }
    rocks.count = nr; rocks.castShadow = rocks.receiveShadow = true;
    this.world.add(rocks);

    // dead trees around the frame
    for (let k = 0; k < 26; k++) {
      let x, y;
      const edge = k % 4;
      if (edge === 0) { x = Math.random() * W; y = -1.2 - Math.random() * 3; }
      else if (edge === 1) { x = Math.random() * W; y = H + 1.0 + Math.random() * 2.5; }
      else if (edge === 2) { x = -1.2 - Math.random() * 3; y = Math.random() * H; }
      else { x = W + 1.2 + Math.random() * 3; y = Math.random() * H; }
      const sz = 0.8 + Math.random() * 0.8;
      const tree = THEME.tree;
      if (THEME.sea) { if (Math.random() < 0.35) this.palm(Math.max(-0.6, Math.min(W + 0.6, x)), Math.max(-0.6, Math.min(H + 0.6, y)), sz); }
      else if (tree === 'pine') this.pine(x, y, sz);
      else if (tree === 'cactus') this.cactus(x, y, sz);
      else this.deadTree(x, y, sz);
    }
  }

  pine(x, y, s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(G.cyl(0.07, 0.1, 0.5, 6), mat(0x4a3424, { rough: 1 })); trunk.position.y = 0.25; g.add(trunk);
    const leaf = mat(0x2f5a46, { rough: 0.9, flat: true }), snow = mat(0xe8f0f8, { rough: 0.8 });
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(G.cone(0.55 - k * 0.14, 0.7, 7), leaf); c.position.y = 0.6 + k * 0.42; g.add(c);
      const sn = new THREE.Mesh(G.cone(0.42 - k * 0.12, 0.3, 7), snow); sn.position.y = 0.82 + k * 0.42; g.add(sn);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.copy(toWorld(x, y)); g.position.y = terrainHeight(x, y) - 0.05; g.scale.setScalar(s); g.rotation.y = Math.random() * 6;
    this.world.add(g);
  }
  cactus(x, y, s) {
    const g = new THREE.Group(), cm = mat(0x4f7a3a, { rough: 0.8 });
    const body = new THREE.Mesh(G.cap(0.14, 0.9, 8), cm); body.position.y = 0.6; g.add(body);
    for (const sd of [-1, 1]) {
      if (Math.random() < 0.3) continue;
      const h = 0.35 + Math.random() * 0.3;
      const arm = new THREE.Mesh(G.cap(0.09, 0.25, 8), cm); arm.position.set(sd * 0.22, h, 0); arm.rotation.z = sd * 1.5708; g.add(arm);
      const up = new THREE.Mesh(G.cap(0.09, 0.3, 8), cm); up.position.set(sd * 0.36, h + 0.2, 0); g.add(up);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.copy(toWorld(x, y)); g.position.y = terrainHeight(x, y) - 0.05; g.scale.setScalar(s); g.rotation.y = Math.random() * 6;
    this.world.add(g);
  }
  palm(x, y, s) {
    const g = new THREE.Group();
    const bark = mat(0x8a6a44, { rough: 0.9 });
    let px = 0, py = 0;
    for (let k = 0; k < 6; k++) { const seg = new THREE.Mesh(G.cyl(0.07 - k * 0.006, 0.08 - k * 0.006, 0.3, 6), bark); px += 0.03; py = 0.15 + k * 0.28; seg.position.set(px, py, 0); seg.rotation.z = -0.12; g.add(seg); }
    const leafM = mat(0x3f8a3a, { rough: 0.8, double: true });
    for (let k = 0; k < 7; k++) {
      const leaf = new THREE.Mesh(G.box(0.9, 0.02, 0.16), leafM);
      const a = k / 7 * Math.PI * 2;
      leaf.position.set(px + Math.cos(a) * 0.4, py + 0.12, Math.sin(a) * 0.4); leaf.rotation.set(0, -a, -0.45); g.add(leaf);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.copy(toWorld(x, y)); g.position.y = Math.max(-0.3, terrainHeight(x, y)) - 0.05; g.scale.setScalar(s); g.rotation.y = Math.random() * 6;
    this.world.add(g);
  }

  deadTree(x, y, s) {
    const g = new THREE.Group();
    const bark = mat(THEME.charred ? 0x1c1716 : 0x3a2c24, { rough: 1 });
    const trunk = new THREE.Mesh(G.cyl(0.08, 0.16, 1.6, 7), bark); trunk.position.y = 0.8; trunk.castShadow = true; g.add(trunk);
    const branch = (parent, len, rad, depth, y0, rz, ry) => {
      const b = new THREE.Group(); b.position.y = y0; b.rotation.set(0, ry, rz); parent.add(b);
      const m = new THREE.Mesh(G.cyl(rad * 0.5, rad, len, 5), bark); m.position.y = len / 2; m.castShadow = true; b.add(m);
      if (depth > 0) for (let k = 0; k < 2; k++) branch(b, len * 0.65, rad * 0.6, depth - 1, len * (0.6 + k * 0.3), (k ? 1 : -1) * (0.5 + Math.random() * 0.4), Math.random() * 3);
    };
    for (let k = 0; k < 3; k++) branch(trunk, 0.7, 0.06, 2, 0.1 + k * 0.25, (k - 1) * 0.7 + 0.2, k * 2.1);
    g.position.copy(toWorld(x, y)); g.position.y = terrainHeight(x, y) - 0.05;
    g.scale.setScalar(s); g.rotation.y = Math.random() * 6;
    this.world.add(g);
  }

  // ---------- graveyard strip ----------
  buildGraveyard() {
    const stone = mat(0x7c7f88, { rough: 0.95 }), stoneD = mat(0x5a5d66, { rough: 0.95 }), moss = mat(0x4a5e3a, { rough: 1 });
    const cx0 = GRAVE_L, cx1 = GRAVE_R;
    const placed = [];
    const free = (x, y, r) => placed.every(p => Math.hypot(p[0] - x, p[1] - y) > r + p[2]) && pathDist(x, y) > 0.9;
    const addAt = (obj, x, y, r) => { obj.position.copy(toWorld(x, y)); obj.position.y += terrainHeight(x, y); this.world.add(obj); placed.push([x, y, r]); obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); };
    for (let k = 0; k < 400 && placed.length < 46; k++) {
      const x = cx0 + 0.6 + Math.random() * (cx1 - cx0 - 1.2), y = 0.6 + Math.random() * (H - 1.2);
      if (!free(x, y, 0.45)) continue;
      const g = new THREE.Group();
      const t = Math.random();
      if (t < 0.5) {
        const w = 0.32 + Math.random() * 0.12, h = 0.42 + Math.random() * 0.2;
        const s = new THREE.Mesh(G.rbox(w, h, 0.09, 0.03), Math.random() < 0.5 ? stone : stoneD); s.position.y = h / 2; g.add(s);
        const top = new THREE.Mesh(G.cyl(w / 2, w / 2, 0.09, 14, 1), s.material); top.rotation.x = Math.PI / 2; top.position.y = h; g.add(top);
        if (Math.random() < 0.5) { const m = new THREE.Mesh(G.sphere(0.08, 8, 6), moss); m.position.set(w * 0.3, 0.06, 0.04); m.scale.set(1, 0.5, 0.6); g.add(m); }
        const mound = new THREE.Mesh(G.sphere(0.3, 12, 8), mat(0x3a302a, { rough: 1 })); mound.scale.set(0.8, 0.18, 1.4); mound.position.set(0, 0, 0.42); g.add(mound);
      } else if (t < 0.75) {
        const v = new THREE.Mesh(G.box(0.07, 0.55, 0.07), stoneD); v.position.y = 0.27; g.add(v);
        const hb = new THREE.Mesh(G.box(0.32, 0.07, 0.07), stoneD); hb.position.y = 0.4; g.add(hb);
      } else if (t < 0.88) {
        // skull pile
        for (let s = 0; s < 4; s++) { const sk = new THREE.Mesh(G.sphere(0.08, 10, 8), mat(0xddd3b8)); sk.position.set((s % 2 - 0.5) * 0.14, 0.07 + (s > 1 ? 0.1 : 0), (s > 1 ? 0 : (s - 0.5) * 0.1)); g.add(sk); }
      } else {
        const tomb = new THREE.Mesh(G.rbox(0.7, 0.3, 0.42, 0.05), stone); tomb.position.y = 0.15; g.add(tomb);
        const lid = new THREE.Mesh(G.rbox(0.76, 0.06, 0.48, 0.03), stoneD); lid.position.y = 0.32; lid.rotation.y = 0.15; g.add(lid);
      }
      g.rotation.y = (Math.random() - 0.5) * 0.6 + (Math.random() < 0.5 ? 0 : Math.PI / 2) * 0;
      g.rotation.z = (Math.random() - 0.5) * 0.15;
      addAt(g, x, y, 0.35);
    }
    // iron fences along both graveyard edges
    const fm = mat(0x1d1f24, { metal: 0.7, rough: 0.4 });
    for (const fx of [cx0 + 0.15, cx1 - 0.15]) {
      for (let y = 0.3; y < H - 0.2; y += 0.32) {
        if (pathDist(fx, y) < 1.0) continue;
        const bar = new THREE.Mesh(G.cyl(0.014, 0.014, 0.55, 5), fm); bar.position.copy(toWorld(fx, y)); bar.position.y = terrainHeight(fx, y) + 0.27; bar.castShadow = true; this.world.add(bar);
        const tip = new THREE.Mesh(G.cone(0.03, 0.08, 4), fm); tip.position.copy(bar.position); tip.position.y += 0.31; this.world.add(tip);
      }
      for (const yy of [0.45, 0.15]) {
        let start = null;
        for (let y = 0.3; y < H; y += 0.1) {
          const ok = pathDist(fx, y) >= 1.0 && y < H - 0.2;
          if (ok && start == null) start = y;
          if ((!ok || y + 0.1 >= H) && start != null) {
            const len = y - start;
            if (len > 0.3) { const rail = new THREE.Mesh(G.box(0.02, 0.02, 1), fm); rail.scale.z = len; rail.position.copy(toWorld(fx, start + len / 2)); rail.position.y = yy + 0.02; this.world.add(rail); }
            start = null;
          }
        }
      }
    }
    // lanterns with green necro flames
    this.animUniforms = [];
    for (const [x, y] of [[(cx0 + cx1) / 2, 5.6], [(cx0 + cx1) / 2, 12.4], [(cx0 + cx1) / 2 - 1.6, 0.8], [(cx0 + cx1) / 2 + 1.6, 17.2]]) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(G.cyl(0.04, 0.05, 1.1, 6), fm); post.position.y = 0.55; g.add(post);
      const cage = new THREE.Mesh(G.cyl(0.1, 0.08, 0.2, 6, 1), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.4, wireframe: true })); cage.position.y = 1.18; g.add(cage);
      const fl = new THREE.Mesh(G.sphere(0.07, 10, 8), mat(0x6bff8a, { emissive: 0x4cff6a, ei: 4 })); fl.position.y = 1.18; fl.scale.y = 1.4; g.add(fl);
      addAt(g, x, y, 0.3);
    }
    // central obelisk
    const ob = new THREE.Group();
    const base = new THREE.Mesh(G.rbox(0.9, 0.25, 0.9, 0.05), stoneD); base.position.y = 0.12; ob.add(base);
    const pillar = new THREE.Mesh(G.cyl(0.18, 0.28, 1.5, 4), stone); pillar.position.y = 1.0; pillar.rotation.y = Math.PI / 4; ob.add(pillar);
    const rune = new THREE.Mesh(G.cyl(0.29, 0.29, 0.06, 4), mat(0x6bff8a, { emissive: 0x2bd458, ei: 2.6 })); rune.position.y = 0.8; rune.rotation.y = Math.PI / 4; ob.add(rune);
    const top = new THREE.Mesh(G.cone(0.2, 0.3, 4), stone); top.position.y = 1.9; top.rotation.y = Math.PI / 4; ob.add(top);
    addAt(ob, (cx0 + cx1) / 2, 9, 0.8);
  }

  // ---------- crypt gates ----------
  buildGates() {
    this.gates = [[], []];
    const stone = mat(0x6e6a72, { rough: 0.9 }), dark = mat(0x3b3842, { rough: 0.9 });
    for (let side = 0; side < 2; side++) {
      GATES[side].forEach((gp, lane) => {
        const owner = 1 - side; // the player who sends undead through this gate
        const color = new THREE.Color(owner === 0 ? 0x3da5ff : 0xff3d5a);
        const g = new THREE.Group();
        const dir = side === 0 ? -1 : 1; // facing into its half
        for (const sz of [-1, 1]) {
          const p = new THREE.Mesh(G.rbox(0.32, 1.25, 0.32, 0.05), stone); p.position.set(0, 0.62, sz * 0.62); g.add(p);
          const cap = new THREE.Mesh(G.rbox(0.42, 0.14, 0.42, 0.04), dark); cap.position.set(0, 1.3, sz * 0.62); g.add(cap);
          const orb = new THREE.Mesh(G.sphere(0.09, 12, 10), mat(color.getHex(), { emissive: color.getHex(), ei: 3 })); orb.position.set(0, 1.45, sz * 0.62); g.add(orb);
        }
        const arch = new THREE.Mesh(G.torus(0.62, 0.11, 8, 20, Math.PI), stone); arch.position.y = 1.2; arch.rotation.y = Math.PI / 2; g.add(arch);
        const skull = new THREE.Mesh(G.sphere(0.13, 12, 10), mat(0xddd3b8)); skull.position.set(dir * 0.08, 1.82, 0); g.add(skull);
        for (const sz of [-1, 1]) { const e = new THREE.Mesh(G.sphere(0.03, 6, 5), mat(0x6bff8a, { emissive: 0x6bff8a, ei: 4 })); e.position.set(dir * 0.19, 1.84, sz * 0.045); g.add(e); }
        // portal (animated shader)
        const uTime = { value: 0 }, uHi = { value: 0 };
        this.animUniforms.push(uTime);
        const pm = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { uTime, uHi, uColor: { value: color } },
          vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
          fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uHi; uniform vec3 uColor;
            void main(){ vec2 p=vUv-vec2(.5,.42); p.y*=.85; float r=length(p); float a=atan(p.y,p.x);
              float sw=sin(a*5.+r*18.-uTime*4.)*.5+.5; float edge=smoothstep(.5,.2,r);
              vec3 c=mix(uColor, vec3(.35,1.,.5), sw*.45); float al=edge*(.35+sw*.35)*(1.+uHi*1.6);
              gl_FragColor=vec4(c*(1.2+uHi*1.5), al); }`,
        });
        const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.55), pm);
        portal.position.y = 0.78; portal.rotation.y = Math.PI / 2; g.add(portal);
        const light = new THREE.PointLight(color.getHex(), 3, 4.5, 1.6); light.position.set(dir * 0.6, 1.0, 0); g.add(light);
        // base slab
        const slab = new THREE.Mesh(G.rbox(1.0, 0.1, 1.8, 0.03), dark); slab.position.y = 0.0; g.add(slab);
        const gx = side === 0 ? gp.x + 0.5 : gp.x - 0.5;
        g.position.copy(toWorld(gx, gp.y)); g.position.y = terrainHeight(gx, gp.y) + 0.02;
        g.traverse(o => { if (o.isMesh && o !== portal) { o.castShadow = true; o.receiveShadow = true; } });
        this.world.add(g);
        this.gates[side][lane] = { group: g, uHi, light, baseIntensity: 3, owner, x: gx, y: gp.y };
      });
    }
  }

  // ---------- bunkers ----------
  buildBunkers() {
    this.bunkers = [];
    for (let side = 0; side < 2; side++) {
      const b = BUNKER[side];
      const g = new THREE.Group();
      const body = new THREE.Group(); g.add(body);
      const conc = mat(0x8e918a, { rough: 0.9 }), concD = mat(0x6a6d67, { rough: 0.9 });
      const face = side === 0 ? 1 : -1; // faces the arena
      const main = new THREE.Mesh(G.rbox(2.2, 1.0, 2.8, 0.18), conc); main.position.y = 0.5; body.add(main);
      const roof = new THREE.Mesh(G.rbox(2.4, 0.26, 3.0, 0.1), concD); roof.position.y = 1.1; body.add(roof);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), conc); dome.position.set(-face * 0.3, 1.2, 0); body.add(dome);
      const slitM = mat(0xffa040, { emissive: 0xff8a20, ei: 2.5 });
      for (const z of [-0.75, 0, 0.75]) { const s = new THREE.Mesh(G.box(0.08, 0.12, 0.5), slitM); s.position.set(face * 1.1, 0.72, z); body.add(s); }
      // stripes in team colour
      const stripe = new THREE.Mesh(G.box(2.42, 0.08, 3.02), mat(TEAM_COLORS[side], { emissive: TEAM_COLORS[side], ei: 0.7 })); stripe.position.y = 0.98; body.add(stripe);
      // sandbag wall around
      const bag = mat(0xb8a174, { rough: 0.95 });
      for (let k = 0; k < 26; k++) {
        const a = k / 26 * Math.PI * 2;
        const x = Math.cos(a) * 1.55, z = Math.sin(a) * 1.85;
        if (Math.abs(z) < 0.5 && Math.sign(x) === face) continue;
        const sb = new THREE.Mesh(G.rbox(0.42, 0.18, 0.26, 0.07), bag); sb.position.set(x, 0.1, z); sb.rotation.y = -a + Math.PI / 2; body.add(sb);
      }
      // flag
      const pole = new THREE.Mesh(G.cyl(0.03, 0.035, 2.0, 8), mat(0x777f88, { metal: 0.8, rough: 0.3 })); pole.position.set(-face * 0.75, 2.1, 1.05); body.add(pole);
      const flagGeo = new THREE.PlaneGeometry(0.8, 0.5, 12, 4);
      const flag = new THREE.Mesh(flagGeo, mat(TEAM_COLORS[side], { emissive: TEAM_COLORS[side], ei: 0.4, double: true, rough: 0.7 }));
      flag.position.set(-face * 0.75 + face * 0.4, 2.85, 1.05); body.add(flag);
      flag.userData.base = flagGeo.attributes.position.array.slice();
      // antenna
      const ant = new THREE.Mesh(G.cyl(0.012, 0.012, 1.0, 4), mat(0x222222)); ant.position.set(-face * 0.6, 1.7, -0.9); body.add(ant);
      const al = new THREE.Mesh(G.sphere(0.04, 8, 6), mat(0xff3030, { emissive: 0xff2020, ei: 4 })); al.position.set(-face * 0.6, 2.2, -0.9); body.add(al);
      // crates
      for (const [x, z] of [[face * 0.9, 1.55], [face * 0.7, -1.6]]) { const c = new THREE.Mesh(G.rbox(0.35, 0.3, 0.35, 0.03), mat(0x6b4f2e)); c.position.set(x, 0.15, z); c.rotation.y = 0.4; body.add(c); }
      // cracks (shown as hp drops)
      const cracks = [];
      const crackM = mat(0x1a1a1a, { rough: 1 });
      for (let k = 0; k < 10; k++) {
        const c = new THREE.Mesh(G.box(0.03, 0.4 + Math.random() * 0.35, 0.05), crackM);
        const onFace = k % 2;
        if (onFace) c.position.set(face * 1.105, 0.5, -1.1 + Math.random() * 2.2); else c.position.set(-0.9 + Math.random() * 1.8, 0.5, (Math.random() < 0.5 ? -1 : 1) * 1.405);
        if (!onFace) c.rotation.y = Math.PI / 2;
        c.rotation.x = (Math.random() - 0.5) * 1.2;
        c.visible = false; body.add(c); cracks.push(c);
      }
      // roof turret (shown when the bunker is upgraded to level 3+)
      const turret = new THREE.Group(); turret.position.set(face * 0.35, 1.25, -0.55); body.add(turret);
      const tb = new THREE.Mesh(G.cyl(0.3, 0.36, 0.22, 14), concD); tb.position.y = 0.11; turret.add(tb);
      const head = new THREE.Group(); head.position.y = 0.3; turret.add(head);
      head.add(new THREE.Mesh(G.rbox(0.42, 0.24, 0.36, 0.06), mat(0x5a6448, { rough: 0.6, metal: 0.3 })));
      for (const z of [-0.07, 0.07]) { const br = new THREE.Mesh(G.cyl(0.035, 0.035, 0.55, 8), mat(0x2a2c2a, { metal: 0.6, rough: 0.4 })); br.rotation.z = Math.PI / 2; br.position.set(face * 0.38, 0.02, z); head.add(br); }
      turret.visible = false;
      const light = new THREE.PointLight(0xffa040, 2.5, 5, 1.6); light.position.set(face * 1.6, 0.9, 0); g.add(light);
      g.position.copy(toWorld(b.x, b.y)); g.position.y = terrainHeight(b.x, b.y);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.world.add(g);
      this.bunkers.push({ group: g, body, cracks, flag, light, side, x: b.x, y: b.y, turret, turretHead: head });
    }
  }

  // ---------- drifting fog ----------
  buildFog() {
    this.fogPlanes = [];
    const tex = softTexture(256);
    tex.wrapS = THREE.RepeatWrapping;
    for (let k = 0; k < 7; k++) {
      const t = tex.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; t.repeat.set(1.5, 1);
      const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: k < 4 ? 0.16 : 0.07, depthWrite: false, color: THEME.fogTint, fog: false });
      const inGrave = k < 4;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(inGrave ? 7.5 : 18, inGrave ? 6 : 8), m);
      p.rotation.x = -Math.PI / 2;
      const x = inGrave ? W / 2 : (k % 2 ? 8 : W - 8), y = inGrave ? 2.5 + k * 4.3 : 4 + (k - 4) * 5;
      p.position.copy(toWorld(x, y)); p.position.y = 0.35 + k * 0.08;
      p.userData = { sp: 0.008 + Math.random() * 0.01 * (k % 2 ? 1 : -1), y: p.position.y, ph: Math.random() * 6 };
      p.renderOrder = 2;
      p.userData.own = true;
      this.world.add(p); this.fogPlanes.push(p);
    }
  }

  buildMoon(sun = false) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
    if (sun) { g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.3, 'rgba(255,190,120,0.95)'); g.addColorStop(0.38, 'rgba(255,120,60,0.4)'); g.addColorStop(1, 'rgba(255,80,40,0)'); }
    else { g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.32, 'rgba(240,240,255,0.9)'); g.addColorStop(0.36, 'rgba(180,200,255,0.35)'); g.addColorStop(1, 'rgba(120,140,255,0)'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(200,200,210,0.35)';
    if (!sun) for (const [x, y, r] of [[110, 110, 10], [145, 135, 14], [120, 150, 7], [150, 105, 6]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
    s.position.set(sun ? 16 : -20, sun ? 6 : 14, -48); s.scale.setScalar(sun ? 24 : 18);
    this.world.add(s);
  }
}
