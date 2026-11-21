// Procedural, chunky "toy" 3D models (Clash-style proportions: big heads, rounded forms).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TEAM_COLORS = [0x3d8bff, 0xff3b3b];

// ---------- caches ----------
const matCache = new Map();
export function mat(color, o = {}) {
  const key = JSON.stringify([color, o]);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.62, metalness: o.metal ?? 0.0,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    transparent: !!o.transparent, opacity: o.opacity ?? 1,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: !!o.flat, depthWrite: o.depthWrite ?? true,
  });
  matCache.set(key, m);
  return m;
}
const geoCache = new Map();
function cached(key, fn) { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); }
export const G = {
  sphere: (r = 1, w = 20, h = 14) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  box: (x, y, z) => cached(`b${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z)),
  rbox: (x, y, z, r = 0.04) => cached(`rb${x},${y},${z},${r}`, () => new RoundedBoxGeometry(x, y, z, 3, r)),
  cyl: (rt, rb, h, s = 16) => cached(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  cap: (r, l, s = 10) => cached(`cp${r},${l},${s}`, () => new THREE.CapsuleGeometry(r, l, 6, s)),
  cone: (r, h, s = 12) => cached(`cn${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  torus: (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => cached(`t${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  dodeca: (r) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
};

function add(parent, geo, material, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(p[0], p[1], p[2]);
  if (Array.isArray(r)) m.rotation.set(r[0], r[1], r[2]);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function group(parent, p = [0, 0, 0]) { const g = new THREE.Group(); g.position.set(...p); if (parent) parent.add(g); return g; }

// limb: pivot group at shoulder/hip with a capsule hanging down
function limb(parent, p, r, len, material, handMat) {
  const pivot = group(parent, p);
  add(pivot, G.cap(r, len), material, [0, -len / 2 - r * 0.3, 0]);
  if (handMat) add(pivot, G.sphere(r * 1.25, 10, 8), handMat, [0, -len - r * 0.6, 0]);
  return pivot;
}

// ---------- shared palettes ----------
const C = {
  bone: 0xeee4c8, boneDark: 0xb9ad8c, necro: 0x5cff7a, necroDim: 0x2bd458,
  skinZ: 0x8fb36a, shirtZ: 0x5f6f8a, pantsZ: 0x3b3550,
  pumpkin: 0xf0821e, pumpkinDark: 0xc35e12, vine: 0x4f8a2b,
  stone: 0x8a8f9c, stoneDark: 0x5f6470,
  wrap: 0xd8c79e, wrapDark: 0x9c8a62,
  iron: 0x59606b, ironDark: 0x343941,
  olive: 0x5f7038, oliveDark: 0x414d26, khaki: 0xb59f6c, skin: 0xf0be94, boot: 0x2a2520,
  steel: 0x9aa3ad, black: 0x1e1f22, gold: 0xf2c14e, red: 0xb32424,
};
const glow = (c, i = 2.2) => mat(c, { emissive: c, ei: i, rough: 0.4 });

// ============================================================
// UNDEAD
// ============================================================
function skeleton() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.42, 0]);
  const bm = mat(C.bone, { rough: 0.55 });
  const parts = { body };
  // pelvis + spine
  add(body, G.rbox(0.2, 0.08, 0.12, 0.03), bm, [0, -0.06, 0]);
  add(body, G.cyl(0.03, 0.03, 0.22, 8), bm, [0, 0.06, 0]);
  for (let i = 0; i < 3; i++) add(body, G.torus(0.1 - i * 0.012, 0.022, 6, 16), bm, [0, 0.06 + i * 0.055, 0], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
  // skull
  const head = group(body, [0, 0.34, 0]);
  parts.head = head;
  add(head, G.sphere(0.17), bm, [0, 0.02, 0], [0, 0, 0], [1, 0.95, 0.95]);
  add(head, G.rbox(0.18, 0.08, 0.14, 0.03), bm, [0, -0.11, 0.03]);
  for (const sx of [-1, 1]) {
    add(head, G.sphere(0.055, 10, 8), mat(0x161015), [sx * 0.065, 0.02, 0.13]);
    add(head, G.sphere(0.03, 8, 6), glow(C.necro, 3), [sx * 0.065, 0.02, 0.165]);
  }
  add(head, G.cone(0.025, 0.05, 3), mat(0x161015), [0, -0.04, 0.16], [Math.PI, 0, 0]);
  // limbs
  parts.legL = limb(body, [-0.07, -0.08, 0], 0.028, 0.26, bm, bm);
  parts.legR = limb(body, [0.07, -0.08, 0], 0.028, 0.26, bm, bm);
  parts.armL = limb(body, [-0.14, 0.18, 0], 0.025, 0.22, bm, bm);
  parts.armR = limb(body, [0.14, 0.18, 0], 0.025, 0.22, bm, bm);
  // rusty sword
  const sw = add(parts.armR, G.box(0.04, 0.34, 0.015), mat(0x8a7a6a, { metal: 0.6, rough: 0.5 }), [0, -0.4, 0.12], [Math.PI / 2.4, 0, 0]);
  add(parts.armR, G.box(0.12, 0.025, 0.03), mat(0x5a3d28), [0, -0.3, 0.04]);
  void sw;
  return { root, parts, height: 0.95, walk: 'biped' };
}

function zombie() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.4, 0]);
  const parts = { body };
  const skin = mat(C.skinZ), shirt = mat(C.shirtZ), pants = mat(C.pantsZ);
  add(body, G.rbox(0.3, 0.3, 0.2, 0.06), shirt, [0, 0.12, 0], [0.2, 0, 0]);
  add(body, G.rbox(0.28, 0.1, 0.19, 0.04), pants, [0, -0.04, 0]);
  // torn shirt flap
  add(body, G.box(0.1, 0.12, 0.02), mat(0x4a5670), [0.08, 0.0, 0.1], [0.2, 0, 0.3]);
  const head = group(body, [0, 0.4, 0.06]);
  parts.head = head;
  add(head, G.sphere(0.19), skin, [0, 0, 0], [0, 0, 0], [1, 1.05, 1]);
  add(head, G.sphere(0.06, 10, 8), mat(0xffffff), [-0.07, 0.03, 0.15]);
  add(head, G.sphere(0.06, 10, 8), mat(0xffffff), [0.07, 0.05, 0.15], 0, 0.8);
  add(head, G.sphere(0.028, 8, 6), glow(0xd8ff3a, 2), [-0.07, 0.03, 0.2]);
  add(head, G.sphere(0.024, 8, 6), glow(0xd8ff3a, 2), [0.07, 0.05, 0.195]);
  add(head, G.rbox(0.12, 0.04, 0.04, 0.015), mat(0x2a1a1a), [0, -0.08, 0.16]);
  add(head, G.sphere(0.07, 10, 8), mat(0x6f8f4f), [0.1, 0.12, -0.02]);
  parts.legL = limb(body, [-0.08, -0.08, 0], 0.055, 0.2, pants, mat(C.boot));
  parts.legR = limb(body, [0.08, -0.08, 0], 0.055, 0.2, pants, mat(C.boot));
  parts.armL = limb(body, [-0.19, 0.22, 0.04], 0.045, 0.22, skin, skin);
  parts.armR = limb(body, [0.19, 0.22, 0.04], 0.045, 0.22, skin, skin);
  parts.armL.rotation.x = -1.35; parts.armR.rotation.x = -1.2;
  parts.armsForward = true;
  return { root, parts, height: 0.95, walk: 'run' };
}

let batWingGeo = null;
function batWing() {
  if (batWingGeo) return batWingGeo;
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.12, 0.08); s.lineTo(0.3, 0.06); s.quadraticCurveTo(0.26, 0.0, 0.3, -0.06);
  s.quadraticCurveTo(0.22, -0.03, 0.2, -0.08); s.quadraticCurveTo(0.14, -0.04, 0.1, -0.08); s.quadraticCurveTo(0.06, -0.03, 0, -0.04);
  batWingGeo = new THREE.ShapeGeometry(s);
  batWingGeo.rotateX(-Math.PI / 2);
  return batWingGeo;
}
function bat() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.95, 0]);
  const parts = { body };
  const fur = mat(0x40304f, { rough: 0.8 }), wingM = mat(0x5a3f6a, { double: true, rough: 0.7 });
  add(body, G.sphere(0.09), fur, [0, 0, 0], 0, [1, 0.9, 1.2]);
  add(body, G.sphere(0.07), fur, [0, 0.05, 0.08]);
  for (const sx of [-1, 1]) {
    add(body, G.cone(0.03, 0.08, 5), fur, [sx * 0.04, 0.12, 0.08]);
    add(body, G.sphere(0.018, 6, 5), glow(0xff3344, 3), [sx * 0.03, 0.06, 0.145]);
  }
  parts.wingL = group(body, [-0.05, 0.02, 0]);
  parts.wingR = group(body, [0.05, 0.02, 0]);
  const wl = new THREE.Mesh(batWing(), wingM); wl.scale.x = -1; wl.castShadow = true; parts.wingL.add(wl);
  const wr = new THREE.Mesh(batWing(), wingM); wr.castShadow = true; parts.wingR.add(wr);
  return { root, parts, height: 1.2, walk: 'flap', scale: 1.4 };
}

function pumpkinBody(parent, r, faceGlow = true) {
  const pm = mat(C.pumpkin, { rough: 0.5 }), pd = mat(C.pumpkinDark, { rough: 0.55 });
  const g = group(parent);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    add(g, G.sphere(r * 0.62), k % 2 ? pm : pd, [Math.cos(a) * r * 0.42, 0, Math.sin(a) * r * 0.42], [0, -a, 0], [0.75, 0.95, 1.1]);
  }
  add(g, G.sphere(r * 0.8), pm, [0, 0, 0], 0, [1, 0.85, 1]);
  add(g, G.cyl(r * 0.08, r * 0.12, r * 0.35, 8), mat(0x4d6b22), [0.02, r * 0.8, 0], [0, 0, 0.3]);
  if (faceGlow) {
    const gm = glow(0xffd23a, 3.2);
    for (const sx of [-1, 1]) add(g, G.cone(r * 0.16, r * 0.2, 3), gm, [sx * r * 0.32, r * 0.18, r * 0.86], [Math.PI / 2, 0, 0], [1, 1, 0.4]);
    add(g, G.box(r * 0.62, r * 0.13, r * 0.1), gm, [0, -r * 0.22, r * 0.86]);
    for (const sx of [-0.18, 0.18]) add(g, G.box(r * 0.1, r * 0.1, r * 0.12), pm, [sx * r, -r * 0.17, r * 0.9]);
  }
  return g;
}
function pumpkin() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.46, 0]);
  const parts = { body };
  pumpkinBody(body, 0.34);
  const vm = mat(C.vine);
  parts.legL = limb(body, [-0.13, -0.22, 0], 0.06, 0.12, vm, mat(0x355d1c));
  parts.legR = limb(body, [0.13, -0.22, 0], 0.06, 0.12, vm, mat(0x355d1c));
  parts.armL = limb(body, [-0.33, 0.05, 0], 0.05, 0.25, vm, mat(0x355d1c));
  parts.armR = limb(body, [0.33, 0.05, 0], 0.05, 0.25, vm, mat(0x355d1c));
  parts.armL.rotation.z = -0.4; parts.armR.rotation.z = 0.4;
  return { root, parts, height: 1.1, walk: 'stomp' };
}
function imp() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.2, 0]);
  const parts = { body };
  pumpkinBody(body, 0.17);
  const vm = mat(C.vine);
  parts.legL = limb(body, [-0.06, -0.12, 0], 0.03, 0.06, vm);
  parts.legR = limb(body, [0.06, -0.12, 0], 0.03, 0.06, vm);
  return { root, parts, height: 0.55, walk: 'hop' };
}

let wingGeo = null;
function stoneWingGeo() {
  if (wingGeo) return wingGeo;
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.18, 0.22); s.lineTo(0.42, 0.3); s.lineTo(0.36, 0.12); s.lineTo(0.42, 0.02); s.lineTo(0.28, 0.0); s.lineTo(0.3, -0.12); s.lineTo(0.12, -0.04); s.lineTo(0, -0.08);
  wingGeo = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 });
  return wingGeo;
}
function gargoyle() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.4, 0]);
  const parts = { body };
  const sm = mat(C.stone, { rough: 0.95, flat: true }), sd = mat(C.stoneDark, { rough: 0.95, flat: true });
  add(body, G.dodeca(0.24), sm, [0, 0.06, -0.02], [0.3, 0.2, 0], [1, 1.05, 0.95]);
  add(body, G.dodeca(0.14), sd, [0, -0.08, 0.1]);
  const head = group(body, [0, 0.32, 0.1]);
  parts.head = head;
  add(head, G.dodeca(0.15), sm, [0, 0, 0], [0.2, 0.4, 0]);
  add(head, G.rbox(0.16, 0.08, 0.12, 0.02), sd, [0, -0.06, 0.1]);
  for (const sx of [-1, 1]) {
    add(head, G.cone(0.04, 0.18, 6), sd, [sx * 0.09, 0.14, -0.02], [-0.4, 0, sx * -0.5]);
    add(head, G.sphere(0.03, 8, 6), glow(C.necro, 3.5), [sx * 0.055, 0.02, 0.13]);
  }
  parts.wingL = group(body, [-0.12, 0.2, -0.14]);
  parts.wingR = group(body, [0.12, 0.2, -0.14]);
  const wl = new THREE.Mesh(stoneWingGeo(), sd); wl.castShadow = true; wl.scale.x = -1; wl.rotation.y = 0.5; parts.wingL.add(wl);
  const wr = new THREE.Mesh(stoneWingGeo(), sd); wr.castShadow = true; wr.rotation.y = -0.5; parts.wingR.add(wr);
  parts.legL = limb(body, [-0.12, -0.15, 0], 0.06, 0.1, sd, sm);
  parts.legR = limb(body, [0.12, -0.15, 0], 0.06, 0.1, sd, sm);
  parts.armL = limb(body, [-0.22, 0.1, 0.05], 0.05, 0.18, sd, sm);
  parts.armR = limb(body, [0.22, 0.1, 0.05], 0.05, 0.18, sd, sm);
  add(body, G.cone(0.04, 0.3, 6), sd, [0, -0.1, -0.26], [-1.1, 0, 0]);
  return { root, parts, height: 0.95, walk: 'stomp' };
}

let ghostGeo = null;
function ghostBodyGeo() {
  if (ghostGeo) return ghostGeo;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const y = t * 0.62;
    const r = t < 0.15 ? 0.2 + t * 0.4 : t < 0.7 ? 0.26 - (t - 0.15) * 0.1 : Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2)) * 0.205;
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  ghostGeo = new THREE.LatheGeometry(pts, 24);
  // wavy hem
  const pos = ghostGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.05) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); pos.setY(i, y - 0.05 * (1 + Math.sin(a * 6))); }
  }
  ghostGeo.computeVertexNormals();
  return ghostGeo;
}
function ghost() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.35, 0]);
  const parts = { body };
  const gm = new THREE.MeshStandardMaterial({ color: 0xcdeeff, emissive: 0x7fd8ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.75, roughness: 0.3, depthWrite: false });
  const b = new THREE.Mesh(ghostBodyGeo(), gm); body.add(b);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x0c1830, transparent: true, opacity: 0.9 });
  const e1 = new THREE.Mesh(G.sphere(0.05, 10, 8), eyeM); e1.position.set(-0.08, 0.45, 0.2); e1.scale.set(0.8, 1.3, 0.5); body.add(e1);
  const e2 = e1.clone(); e2.position.x = 0.08; body.add(e2);
  const mo = new THREE.Mesh(G.sphere(0.04, 10, 8), eyeM); mo.position.set(0, 0.32, 0.22); mo.scale.set(1, 1.4, 0.5); body.add(mo);
  parts.armL = group(body, [-0.24, 0.32, 0.05]);
  parts.armR = group(body, [0.24, 0.32, 0.05]);
  const am = new THREE.Mesh(G.cap(0.045, 0.16), gm); am.position.y = -0.1; parts.armL.add(am);
  const am2 = am.clone(); parts.armR.add(am2);
  parts.armL.rotation.set(-1.1, 0, -0.3); parts.armR.rotation.set(-1.1, 0, 0.3);
  parts.fadeMats = [gm, eyeM];
  return { root, parts, height: 1.05, walk: 'float' };
}

function mummy() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.42, 0]);
  const parts = { body };
  const wm = mat(C.wrap, { rough: 0.9 }), wd = mat(C.wrapDark, { rough: 0.9 });
  add(body, G.cap(0.15, 0.22), wm, [0, 0.12, 0]);
  for (let i = 0; i < 5; i++) add(body, G.torus(0.155, 0.018, 5, 20), wd, [0, -0.02 + i * 0.07, 0], [Math.PI / 2 + (i % 2 ? 0.25 : -0.2), 0, 0]);
  const head = group(body, [0, 0.43, 0]);
  parts.head = head;
  add(head, G.sphere(0.15), wm);
  for (let i = 0; i < 3; i++) add(head, G.torus(0.148, 0.016, 5, 20), wd, [0, -0.06 + i * 0.06, 0], [Math.PI / 2 + (i - 1) * 0.35, 0.2 * i, 0]);
  add(head, G.sphere(0.035, 8, 6), glow(C.necro, 4), [0.055, 0.03, 0.13]);
  add(head, G.sphere(0.03, 8, 6), mat(0x1a1410), [-0.055, 0.03, 0.13]);
  parts.legL = limb(body, [-0.07, -0.08, 0], 0.055, 0.2, wm, wd);
  parts.legR = limb(body, [0.07, -0.08, 0], 0.055, 0.2, wm, wd);
  parts.armL = limb(body, [-0.19, 0.26, 0], 0.045, 0.22, wm, wd);
  parts.armR = limb(body, [0.19, 0.26, 0], 0.045, 0.22, wm, wd);
  parts.armL.rotation.x = -1.4; parts.armR.rotation.x = -1.4;
  parts.armsForward = true;
  // trailing bandage
  add(body, G.box(0.05, 0.25, 0.01), wm, [0.12, 0.0, -0.14], [0.4, 0, 0.2]);
  return { root, parts, height: 1.05, walk: 'shamble' };
}

function golem() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.42, 0]);
  const parts = { body };
  const im = mat(C.iron, { metal: 0.75, rough: 0.38 }), idk = mat(C.ironDark, { metal: 0.7, rough: 0.45 });
  add(body, G.rbox(0.46, 0.38, 0.32, 0.07), im, [0, 0.16, 0]);
  add(body, G.rbox(0.34, 0.14, 0.26, 0.05), idk, [0, -0.08, 0]);
  add(body, G.cyl(0.07, 0.07, 0.04, 16), glow(C.necro, 3.5), [0, 0.18, 0.165], [Math.PI / 2, 0, 0]);
  add(body, G.torus(0.08, 0.018, 6, 18), idk, [0, 0.18, 0.165]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(body, G.sphere(0.022, 6, 5), mat(C.steel, { metal: 0.9, rough: 0.3 }), [sx * 0.18, 0.16 + sy * 0.13, 0.165]);
  // shoulders
  for (const sx of [-1, 1]) add(body, G.rbox(0.18, 0.14, 0.2, 0.05), idk, [sx * 0.3, 0.3, 0]);
  const head = group(body, [0, 0.42, 0.02]);
  parts.head = head;
  add(head, G.rbox(0.2, 0.15, 0.18, 0.04), im);
  add(head, G.box(0.15, 0.03, 0.02), glow(C.necro, 4), [0, 0.0, 0.092]);
  parts.legL = limb(body, [-0.12, -0.12, 0], 0.08, 0.14, idk, im);
  parts.legR = limb(body, [0.12, -0.12, 0], 0.08, 0.14, idk, im);
  parts.armL = limb(body, [-0.32, 0.26, 0], 0.07, 0.2, idk);
  parts.armR = limb(body, [0.32, 0.26, 0], 0.07, 0.2, idk);
  add(parts.armL, G.rbox(0.18, 0.18, 0.18, 0.05), im, [0, -0.36, 0]);
  add(parts.armR, G.rbox(0.18, 0.18, 0.18, 0.05), im, [0, -0.36, 0]);
  return { root, parts, height: 1.25, walk: 'stomp' };
}

function riderParts(parent, withHorse) {
  const coat = mat(0x2b2333, { rough: 0.7 }), cape = mat(0x5a1622, { double: true, rough: 0.7 });
  const torso = group(parent, [0, withHorse ? 0.66 : 0.4, withHorse ? -0.02 : 0]);
  add(torso, G.rbox(0.26, 0.3, 0.18, 0.06), coat, [0, 0.14, 0]);
  add(torso, G.box(0.28, 0.035, 0.19), mat(0x6b4a2a), [0, 0.02, 0]);
  add(torso, G.cyl(0.05, 0.06, 0.06, 10), mat(0x3a1a1a), [0, 0.32, 0]);
  // neck flame
  add(torso, G.cone(0.06, 0.2, 8), glow(C.necro, 3), [0, 0.43, 0]);
  add(torso, G.cone(0.035, 0.14, 8), glow(0xd8ffb0, 3), [0, 0.42, 0]);
  const cp = add(torso, G.box(0.3, 0.42, 0.015), cape, [0, 0.06, -0.11], [0.25, 0, 0]);
  const armL = limb(torso, [-0.16, 0.26, 0], 0.04, 0.2, coat, mat(0x1a1a1a));
  const armR = limb(torso, [0.16, 0.26, 0], 0.04, 0.2, coat, mat(0x1a1a1a));
  armR.rotation.x = -1.0;
  const lantern = group(armR, [0, -0.3, 0.02]);
  pumpkinBody(lantern, 0.08);
  armL.rotation.x = -0.6;
  add(armL, G.box(0.03, 0.03, 0.5), mat(0x777f88, { metal: 0.8, rough: 0.3 }), [0, -0.28, 0.2]);
  return { torso, cape: cp, armL, armR };
}
function horseman() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.0, 0]);
  const parts = { body };
  const hm = new THREE.MeshStandardMaterial({ color: 0x262b45, emissive: 0x3a4fff, emissiveIntensity: 0.25, roughness: 0.45, transparent: true, opacity: 0.9 });
  const horse = group(body, [0, 0.42, 0]);
  add(horse, G.cap(0.15, 0.38), hm, [0, 0, 0], [Math.PI / 2, 0, 0]);
  const neck = group(horse, [0, 0.08, 0.26]);
  add(neck, G.cap(0.08, 0.2), hm, [0, 0.1, 0.04], [0.6, 0, 0]);
  add(neck, G.rbox(0.12, 0.12, 0.26, 0.05), hm, [0, 0.24, 0.14], [0.35, 0, 0]);
  for (const sx of [-1, 1]) add(neck, G.sphere(0.022, 6, 5), glow(C.necro, 4), [sx * 0.055, 0.28, 0.2]);
  // mane of green fire
  for (let i = 0; i < 4; i++) add(neck, G.cone(0.04, 0.14, 6), glow(C.necro, 2.5), [0, 0.2 + i * 0.03, -0.04 - i * 0.05], [-0.8, 0, 0]);
  add(horse, G.cone(0.05, 0.25, 6), glow(C.necro, 2.2), [0, 0.06, -0.3], [-2.2, 0, 0]);
  parts.legs4 = [];
  for (const [x, z] of [[-0.09, 0.2], [0.09, 0.2], [-0.09, -0.2], [0.09, -0.2]]) {
    const l = limb(horse, [x, -0.06, z], 0.04, 0.24, hm, mat(0x14161f));
    parts.legs4.push(l);
  }
  const r = riderParts(body, true);
  parts.cape = r.cape;
  parts.horse = horse;
  return { root, parts, height: 1.3, walk: 'gallop', scale: 1.0 };
}
function rider() {
  const root = new THREE.Group();
  const body = group(root, [0, 0, 0]);
  const parts = { body };
  const r = riderParts(body, false);
  const coat = mat(0x2b2333, { rough: 0.7 });
  parts.legL = limb(r.torso, [-0.07, 0.0, 0], 0.045, 0.24, coat, mat(0x1a1a1a));
  parts.legR = limb(r.torso, [0.07, 0.0, 0], 0.045, 0.24, coat, mat(0x1a1a1a));
  parts.cape = r.cape;
  return { root, parts, height: 1.0, walk: 'biped' };
}

function dragon() {
  const root = new THREE.Group();
  const body = group(root, [0, 0.95, 0]);
  const parts = { body };
  const bm = mat(C.bone, { rough: 0.55 }), bd = mat(C.boneDark, { rough: 0.6 });
  // ribcage
  for (let i = 0; i < 5; i++) add(body, G.torus(0.2 - Math.abs(i - 2) * 0.025, 0.025, 6, 18), bm, [0, 0, 0.18 - i * 0.09], [0, 0, 0], [1, 1.1, 1]);
  add(body, G.cyl(0.035, 0.035, 0.6, 8), bd, [0, 0.18, -0.02], [Math.PI / 2, 0, 0]);
  // neck chain + skull
  const neck = group(body, [0, 0.15, 0.28]);
  parts.neck = neck;
  for (let i = 0; i < 4; i++) add(neck, G.sphere(0.055 - i * 0.004, 10, 8), bm, [0, i * 0.06, i * 0.07]);
  const head = group(neck, [0, 0.27, 0.33]);
  parts.head = head;
  add(head, G.rbox(0.2, 0.14, 0.3, 0.05), bm, [0, 0, 0]);
  add(head, G.rbox(0.14, 0.05, 0.24, 0.02), bd, [0, -0.1, 0.03], [0.2, 0, 0]);
  for (const sx of [-1, 1]) {
    add(head, G.cone(0.035, 0.24, 6), bd, [sx * 0.07, 0.1, -0.14], [-1.2, 0, sx * -0.2]);
    add(head, G.sphere(0.035, 8, 6), glow(C.necro, 4), [sx * 0.06, 0.04, 0.1]);
  }
  for (let k = 0; k < 4; k++) add(head, G.cone(0.012, 0.05, 4), mat(0xffffff), [-0.045 + k * 0.03, -0.075, 0.13], [Math.PI, 0, 0]);
  // tail
  const tail = group(body, [0, 0.05, -0.3]);
  parts.tail = tail;
  for (let i = 0; i < 6; i++) add(tail, G.sphere(0.05 - i * 0.006, 8, 6), bm, [0, -i * 0.02, -i * 0.08]);
  add(tail, G.cone(0.05, 0.12, 4), bd, [0, -0.13, -0.52], [-1.6, 0, 0]);
  // wings
  const memb = new THREE.MeshStandardMaterial({ color: 0x1e3a26, emissive: 0x2bd458, emissiveIntensity: 0.35, transparent: true, opacity: 0.72, side: THREE.DoubleSide, roughness: 0.6, depthWrite: false });
  for (const sx of [-1, 1]) {
    const w = group(body, [sx * 0.15, 0.16, 0.05]);
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0.35, 0.25); s.lineTo(0.85, 0.15); s.lineTo(0.75, -0.08); s.lineTo(0.6, -0.04); s.lineTo(0.5, -0.2); s.lineTo(0.35, -0.08); s.lineTo(0.2, -0.22); s.lineTo(0, -0.1);
    const geo = new THREE.ShapeGeometry(s); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, memb); m.scale.x = sx; w.add(m);
    for (const [x, z, len, rot] of [[0.18, -0.12, 0.45, 0.6], [0.45, -0.1, 0.45, 0.15], [0.6, 0, 0.45, -0.3]]) {
      add(w, G.cyl(0.015, 0.015, len, 6), bm, [sx * x, 0.01, z], [Math.PI / 2, 0, sx * rot + Math.PI / 2]);
    }
    if (sx < 0) parts.wingL = w; else parts.wingR = w;
  }
  // legs
  parts.legs4 = [];
  for (const [x, z] of [[-0.14, 0.12], [0.14, 0.12], [-0.14, -0.2], [0.14, -0.2]]) parts.legs4.push(limb(body, [x, -0.12, z], 0.035, 0.2, bm, bd));
  return { root, parts, height: 2.0, walk: 'flyheavy' };
}

// ============================================================
// DEFENDERS
// ============================================================
function baseDisc(parent, team, level) {
  const rim = level === 2 ? mat(0xd99a1e, { metal: 0.6, rough: 0.4 }) : level === 1 ? mat(0x8f9aa8, { metal: 0.5, rough: 0.4 }) : mat(0x6d6a64, { rough: 0.9 });
  add(parent, G.cyl(0.43, 0.46, 0.08, 28), rim, [0, 0.04, 0]);
  const top = add(parent, G.cyl(0.39, 0.39, 0.03, 28), mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.15, rough: 0.6 }), [0, 0.09, 0]);
  top.castShadow = false;
}
function soldier(parent, team, o = {}) {
  const uni = mat(o.uniform ?? C.olive), dark = mat(o.dark ?? C.oliveDark), skin = mat(C.skin), boot = mat(C.boot);
  const root = group(parent, [0, 0.1, 0]);
  const torso = group(root, [0, 0.36, 0]);
  add(torso, G.rbox(0.28, 0.26, 0.19, 0.06), uni, [0, 0.08, 0]);
  add(torso, G.box(0.3, 0.04, 0.2), mat(0x3a2e1e), [0, -0.04, 0]);
  add(torso, G.box(0.06, 0.06, 0.02), mat(C.gold, { metal: 0.8, rough: 0.3 }), [0, -0.04, 0.105]);
  // team armband
  const legs = [];
  for (const sx of [-1, 1]) legs.push(limb(torso, [sx * 0.075, -0.05, 0], 0.055, 0.15, dark, boot));
  const armL = limb(torso, [-0.18, 0.17, 0], 0.045, 0.17, uni, skin);
  const armR = limb(torso, [0.18, 0.17, 0], 0.045, 0.17, uni, skin);
  add(armL, G.cyl(0.05, 0.05, 0.04, 10), mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.4 }), [0, -0.04, 0]);
  const head = group(torso, [0, 0.36, 0]);
  add(head, G.sphere(0.16), skin, [0, 0, 0]);
  for (const sx of [-1, 1]) add(head, G.sphere(0.022, 8, 6), mat(0x1a1410), [sx * 0.055, 0.0, 0.145]);
  add(head, G.box(0.06, 0.012, 0.01), mat(0x8a4f3a), [0, -0.065, 0.15]);
  if (o.hat === 'helmet' || !o.hat) {
    add(head, G.sphere(0.18, 18, 10), mat(o.helmet ?? 0x4b5a2c, { rough: 0.55 }), [0, 0.04, -0.005], 0, [1, 0.72, 1.04]);
    add(head, G.torus(0.175, 0.02, 6, 22), mat(o.helmet ?? 0x4b5a2c), [0, 0.02, 0], [Math.PI / 2, 0, 0]);
    add(head, G.box(0.36, 0.025, 0.04), mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.5 }), [0, 0.08, 0], [0, 0, 0], [0.01, 1, 1]);
  }
  return { root, torso, head, armL, armR, legs };
}
function rifle(parent, long = false) {
  const g = group(parent);
  const len = long ? 0.62 : 0.42;
  add(g, G.box(0.04, 0.06, len), mat(0x2a2a2e, { metal: 0.6, rough: 0.4 }), [0, 0, len / 2 - 0.08]);
  add(g, G.box(0.05, 0.08, 0.16), mat(0x6b4a2a), [0, -0.02, -0.1]);
  if (long) { add(g, G.cyl(0.025, 0.025, 0.16, 10), mat(0x111111, { metal: 0.6 }), [0, 0.06, 0.12], [Math.PI / 2, 0, 0]); add(g, G.cyl(0.02, 0.02, 0.01, 10), glow(0x66ccff, 2), [0, 0.06, 0.2], [Math.PI / 2, 0, 0]); }
  const muzzle = group(g, [0, 0, len - 0.06]);
  return { g, muzzle };
}

function riflemanModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team);
  s.armR.rotation.x = -1.4; s.armL.rotation.set(-1.4, 0, 0.5);
  const r = rifle(s.torso); r.g.position.set(0.08, 0.14, 0.12);
  if (level === 2) add(s.torso, G.box(0.3, 0.05, 0.05), mat(0x3a2e1e), [0, 0.12, 0.08], [0, 0, 0.6]);
  return { root, parts: { turret, muzzle: r.muzzle, recoil: r.g, soldier: s }, height: 1 };
}
function sniperModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team, { hat: 'hood' });
  const gh = mat(0x4a5e2e, { rough: 1, flat: true }), gh2 = mat(0x6b7a3a, { rough: 1, flat: true });
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; add(s.head, G.dodeca(0.07), k % 2 ? gh : gh2, [Math.cos(a) * 0.14, 0.08 + Math.sin(k) * 0.03, Math.sin(a) * 0.14]); }
  add(s.head, G.dodeca(0.12), gh, [0, 0.14, -0.02]);
  for (let k = 0; k < 6; k++) add(s.torso, G.dodeca(0.08), k % 2 ? gh : gh2, [(k % 3 - 1) * 0.12, 0.2 - Math.floor(k / 3) * 0.14, -0.08]);
  if (level >= 1) add(s.head, G.rbox(0.16, 0.05, 0.05, 0.02), glow(0xff5533, 2), [0, 0.02, 0.16]);
  s.armR.rotation.x = -1.45; s.armL.rotation.set(-1.45, 0, 0.45);
  const r = rifle(s.torso, true); r.g.position.set(0.06, 0.15, 0.14);
  return { root, parts: { turret, muzzle: r.muzzle, recoil: r.g, soldier: s }, height: 1 };
}
function samuraiModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team, { uniform: 0xa32020, dark: 0x2a1a1a, hat: 'none' });
  const lac = mat(0xb02525, { rough: 0.35, metal: 0.2 }), trim = mat(C.gold, { metal: 0.8, rough: 0.3 });
  for (const sx of [-1, 1]) add(s.torso, G.rbox(0.13, 0.08, 0.2, 0.02), lac, [sx * 0.2, 0.22, 0], [0, 0, sx * -0.4]);
  for (let i = 0; i < 3; i++) add(s.torso, G.box(0.3, 0.03, 0.205), i % 2 ? trim : lac, [0, -0.08 - i * 0.04, 0]);
  add(s.head, G.sphere(0.18, 18, 10), mat(0x1c1c22, { metal: 0.5, rough: 0.3 }), [0, 0.04, 0], 0, [1.05, 0.7, 1.05]);
  add(s.head, G.cyl(0.24, 0.26, 0.03, 20), mat(0x1c1c22, { metal: 0.5, rough: 0.3 }), [0, -0.0, -0.02], [0.15, 0, 0]);
  add(s.head, G.torus(0.09, 0.015, 6, 16, Math.PI), trim, [0, 0.16, 0.12], [0, 0, 0]);
  const blade = mat(0xe8f0ff, { metal: 1, rough: 0.15, emissive: level === 2 ? 0x2a8cff : 0x000000, ei: level === 2 ? 0.35 : 0 });
  s.armR.rotation.x = -0.9;
  const sword = group(s.armR, [0, -0.33, 0.02]);
  add(sword, G.box(0.03, 0.03, 0.12), mat(0x111111), [0, 0, 0.0]);
  add(sword, G.cyl(0.05, 0.05, 0.01, 12), trim, [0, 0, 0.07], [Math.PI / 2, 0, 0]);
  add(sword, G.box(0.02, 0.05, 0.55), blade, [0, 0, 0.35]);
  s.armL.rotation.set(-0.8, 0, 0.4);
  return { root, parts: { turret, sword, swordArm: s.armR, soldier: s }, height: 1 };
}
function flameModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team, { helmet: 0x3a3f2a });
  add(s.head, G.sphere(0.12, 12, 10), mat(0x2a2a2a, { rough: 0.6 }), [0, -0.03, 0.08], 0, [1, 0.9, 0.8]);
  for (const sx of [-1, 1]) add(s.head, G.cyl(0.035, 0.035, 0.02, 12), glow(0xff9a3a, 1.2), [sx * 0.05, 0.0, 0.17], [Math.PI / 2, 0, 0]);
  add(s.head, G.cyl(0.04, 0.05, 0.06, 10), mat(0x444444), [0, -0.08, 0.17], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) add(s.torso, G.cap(0.06, 0.2), mat(0xc0392b, { metal: 0.5, rough: 0.35 }), [sx * 0.065, 0.1, -0.16]);
  s.armR.rotation.x = -1.3; s.armL.rotation.set(-1.3, 0, 0.5);
  const g = group(s.torso, [0.07, 0.12, 0.15]);
  add(g, G.cyl(0.035, 0.045, 0.38, 10), mat(0x3a3a3a, { metal: 0.6, rough: 0.4 }), [0, 0, 0.14], [Math.PI / 2, 0, 0]);
  add(g, G.cyl(0.05, 0.04, 0.06, 10), mat(0x777777, { metal: 0.7 }), [0, 0, 0.34], [Math.PI / 2, 0, 0]);
  add(g, G.sphere(0.025, 8, 6), glow(0xffaa33, 4), [0, -0.01, 0.38]);
  const muzzle = group(g, [0, 0, 0.38]);
  return { root, parts: { turret, muzzle, recoil: g, soldier: s }, height: 1 };
}
function grenadierModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team);
  const gm = mat(0x3d5226, { rough: 0.5 });
  for (let k = 0; k < 5; k++) add(s.torso, G.sphere(0.035, 8, 6), gm, [-0.12 + k * 0.06, 0.18 - k * 0.04, 0.105]);
  add(s.torso, G.box(0.36, 0.03, 0.02), mat(0x3a2e1e), [0, 0.1, 0.1], [0, 0, -0.6]);
  s.armR.rotation.x = -1.3; s.armL.rotation.set(-1.3, 0, 0.5);
  const g = group(s.torso, [0.07, 0.12, 0.12]);
  add(g, G.cyl(0.06, 0.06, 0.28, 12), mat(0x2b2b2f, { metal: 0.6, rough: 0.4 }), [0, 0, 0.12], [Math.PI / 2, 0, 0]);
  add(g, G.cyl(0.075, 0.075, 0.1, 6), mat(0x4a4a4f, { metal: 0.6, rough: 0.4 }), [0, 0, 0.0], [Math.PI / 2, 0, 0]);
  add(g, G.cyl(0.045, 0.045, 0.02, 12), mat(0x050505), [0, 0, 0.265], [Math.PI / 2, 0, 0]);
  const muzzle = group(g, [0, 0, 0.27]);
  return { root, parts: { turret, muzzle, recoil: g, soldier: s }, height: 1 };
}
function sandbagRing(parent, r, n, h = 1) {
  const bag = mat(C.khaki, { rough: 0.95 });
  for (let row = 0; row < h; row++) for (let k = 0; k < n; k++) {
    const a = (k + row * 0.5) / n * Math.PI * 2;
    add(parent, G.rbox(0.26, 0.11, 0.16, 0.05), bag, [Math.cos(a) * r, 0.17 + row * 0.1, Math.sin(a) * r], [0, -a + Math.PI / 2, 0]);
  }
}
function mgModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  sandbagRing(root, 0.38, 10, 2);
  const turret = group(root, [0, 0.1, 0]);
  const gun = group(turret, [0, 0.36, 0.05]);
  add(turret, G.cyl(0.015, 0.03, 0.3, 6), mat(0x222222), [0, 0.2, 0.05]);
  add(gun, G.rbox(0.1, 0.1, 0.26, 0.02), mat(0x26282c, { metal: 0.7, rough: 0.35 }), [0, 0, 0]);
  add(gun, G.cyl(0.04, 0.04, 0.32, 12), mat(0x3a3d42, { metal: 0.7, rough: 0.35 }), [0, 0.01, 0.26], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) add(gun, G.torus(0.042, 0.008, 4, 14), mat(0x111111), [0, 0.01, 0.16 + k * 0.06]);
  add(gun, G.box(0.12, 0.06, 0.1), mat(0x5a6a3a), [-0.1, -0.02, -0.02]);
  if (level === 2) add(gun, G.box(0.05, 0.04, 0.08), glow(0xffd23a, 1.5), [0.08, 0, 0]);
  const muzzle = group(gun, [0, 0.01, 0.43]);
  const s = soldier(turret, team);
  s.root.position.set(0, -0.08, -0.28); s.root.scale.setScalar(0.85);
  s.armR.rotation.x = -1.3; s.armL.rotation.x = -1.3;
  return { root, parts: { turret, muzzle, recoil: gun }, height: 0.8 };
}
function missileModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  add(root, G.rbox(0.62, 0.14, 0.62, 0.05), mat(C.oliveDark, { rough: 0.6 }), [0, 0.16, 0]);
  const turret = group(root, [0, 0.24, 0]);
  add(turret, G.cyl(0.12, 0.16, 0.14, 12), mat(0x3d4628, { metal: 0.3 }), [0, 0.06, 0]);
  const pod = group(turret, [0, 0.3, 0]);
  pod.rotation.x = -0.35;
  add(pod, G.rbox(0.5, 0.28, 0.46, 0.04), mat(C.olive, { rough: 0.5 }), [0, 0, 0]);
  const tipM = mat(0xd63a2a, { rough: 0.4 });
  const n = level >= 1 ? 8 : 4;
  for (let k = 0; k < n; k++) {
    const cx = level >= 1 ? -0.18 + (k % 4) * 0.12 : -0.09 + (k % 2) * 0.18;
    const cy = level >= 1 ? (k < 4 ? 0.065 : -0.065) : (k < 2 ? 0.065 : -0.065);
    add(pod, G.cyl(0.045, 0.045, 0.02, 12), mat(0x111111), [cx, cy, 0.232], [Math.PI / 2, 0, 0]);
    add(pod, G.cone(0.035, 0.05, 10), tipM, [cx, cy, 0.24], [Math.PI / 2, 0, 0]);
  }
  add(pod, G.box(0.06, 0.04, 0.2), mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.6 }), [0.27, 0.06, 0]);
  if (level === 2) add(pod, G.cyl(0.03, 0.03, 0.18, 8), mat(0x999999, { metal: 0.8 }), [-0.22, 0.2, -0.1]), add(pod, G.sphere(0.03, 8, 6), glow(0xff3030, 3), [-0.22, 0.3, -0.1]);
  const muzzle = group(pod, [0, 0, 0.26]);
  return { root, parts: { turret, muzzle, recoil: pod }, height: 0.9 };
}
function tankModel(team, level) {
  const root = new THREE.Group();
  const hull = group(root, [0, 0, 0]);
  const tm = mat(level === 2 ? 0x4f5f2a : 0x5a6b33, { rough: 0.55, metal: 0.2 }), dark = mat(0x26281f, { rough: 0.8 });
  // treads
  for (const sx of [-1, 1]) {
    add(hull, G.rbox(0.18, 0.18, 0.78, 0.06), dark, [sx * 0.3, 0.13, 0]);
    for (let k = 0; k < 4; k++) add(hull, G.cyl(0.07, 0.07, 0.19, 12), mat(0x45473c, { metal: 0.5 }), [sx * 0.3, 0.12, -0.27 + k * 0.18], [0, 0, Math.PI / 2]);
  }
  add(hull, G.rbox(0.48, 0.16, 0.72, 0.05), tm, [0, 0.26, 0]);
  add(hull, G.rbox(0.4, 0.06, 0.2, 0.03), tm, [0, 0.3, 0.32], [0.5, 0, 0]);
  const turret = group(hull, [0, 0.36, -0.04]);
  add(turret, G.rbox(0.36, 0.16, 0.38, 0.07), tm, [0, 0.06, 0]);
  add(turret, G.cyl(0.06, 0.06, 0.06, 12), dark, [0.1, 0.17, -0.06]);
  const star = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2; const r = k % 2 ? 0.03 : 0.07; k ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  for (const sx of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.ShapeGeometry(star), mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.6, double: true }));
    st.position.set(sx * 0.182, 0.06, 0); st.rotation.y = sx * Math.PI / 2; turret.add(st);
  }
  const barrel = group(turret, [0, 0.07, 0.18]);
  add(barrel, G.cyl(level >= 1 ? 0.045 : 0.038, 0.045, 0.5, 12), mat(0x3a4224, { metal: 0.4, rough: 0.4 }), [0, 0, 0.24], [Math.PI / 2, 0, 0]);
  add(barrel, G.cyl(0.06, 0.06, 0.08, 12), dark, [0, 0, 0.48], [Math.PI / 2, 0, 0]);
  if (level === 2) add(hull, G.rbox(0.5, 0.12, 0.08, 0.02), mat(0x777f88, { metal: 0.85, rough: 0.3 }), [0, 0.16, 0.42]);
  const muzzle = group(barrel, [0, 0, 0.53]);
  // team plate under tank instead of disc
  const plate = add(root, G.cyl(0.5, 0.5, 0.02, 28), mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.35, transparent: true, opacity: 0.6 }), [0, 0.01, 0]);
  plate.castShadow = false;
  return { root, parts: { turret, hull, muzzle, recoil: barrel, bodyTurns: true }, height: 0.8 };
}
export function droneModel(team) {
  const root = new THREE.Group();
  const body = group(root);
  const dm = mat(0x30343a, { metal: 0.6, rough: 0.35 });
  add(body, G.rbox(0.2, 0.07, 0.2, 0.03), dm);
  add(body, G.sphere(0.04, 10, 8), glow(0xff3333, 2.5), [0, -0.04, 0.08]);
  const rotors = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    add(body, G.box(0.2, 0.025, 0.025), dm, [x * 0.09, 0, z * 0.09], [0, Math.atan2(z, x) * -1, 0]);
    const r = group(body, [x * 0.15, 0.04, z * 0.15]);
    const disc = new THREE.Mesh(G.cyl(0.08, 0.08, 0.005, 16), new THREE.MeshBasicMaterial({ color: 0x5a6878, transparent: true, opacity: 0.22, depthWrite: false }));
    r.add(disc);
    add(r, G.box(0.16, 0.008, 0.02), mat(0x111111));
    rotors.push(r);
    add(body, G.sphere(0.015, 6, 5), glow(z > 0 ? 0x33ff55 : TEAM_COLORS[team], 3), [x * 0.15, -0.01, z * 0.15]);
  }
  return { root, parts: { body, rotors }, height: 0.3 };
}
function droneOpModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team, { hat: 'cap' });
  add(s.head, new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2f3a22), [0, 0.03, 0]);
  add(s.head, G.box(0.2, 0.02, 0.1), mat(0x2f3a22), [0, 0.04, 0.16]);
  add(s.head, G.torus(0.17, 0.02, 6, 20, Math.PI), mat(0x222222), [0, 0.04, 0], [0, 0, 0]);
  s.armR.rotation.x = -1.0; s.armL.rotation.set(-1.0, 0, 0.3);
  const tab = group(s.torso, [0, 0.1, 0.2]);
  add(tab, G.rbox(0.22, 0.15, 0.02, 0.01), mat(0x222222), [0, 0, 0], [-0.6, 0, 0]);
  add(tab, G.box(0.18, 0.11, 0.005), glow(level >= 1 ? 0xff7744 : 0x55ddff, 0.8), [0, 0.005, 0.012], [-0.6, 0, 0]);
  add(s.torso, G.cyl(0.006, 0.006, 0.3, 4), mat(0x111111), [-0.1, 0.35, -0.1]);
  add(s.torso, G.rbox(0.18, 0.2, 0.1, 0.02), mat(0x3a4428), [0, 0.1, -0.14]);
  return { root, parts: { turret, soldier: s }, height: 1 };
}
function commanderModel(team, level) {
  const root = new THREE.Group(); baseDisc(root, team, level);
  const turret = group(root);
  const s = soldier(turret, team, { uniform: 0x3d4a2a, dark: 0x2a3020, hat: 'cap' });
  const gold = mat(C.gold, { metal: 0.85, rough: 0.25 });
  add(s.head, G.cyl(0.17, 0.15, 0.1, 18), mat(0x2f3a22), [0, 0.14, -0.01]);
  add(s.head, G.cyl(0.2, 0.2, 0.02, 18), mat(0x2f3a22), [0, 0.1, 0.03]);
  add(s.head, G.box(0.18, 0.02, 0.12), mat(0x111111), [0, 0.09, 0.13]);
  add(s.head, G.sphere(0.03, 8, 6), gold, [0, 0.15, 0.16]);
  for (const sx of [-1, 1]) add(s.torso, G.rbox(0.1, 0.03, 0.12, 0.01), gold, [sx * 0.15, 0.22, 0]);
  for (let k = 0; k < 3; k++) add(s.torso, G.box(0.04, 0.02, 0.01), [gold, mat(0xc0392b), mat(0x3d8bff)][k], [-0.07 + k * 0.045, 0.17, 0.1]);
  add(s.head, G.box(0.1, 0.03, 0.03), mat(0x5a3a22), [0, -0.07, 0.13]);
  s.armR.rotation.set(-2.6, 0, 0.2);
  const pole = group(turret, [-0.3, 0.1, -0.1]);
  add(pole, G.cyl(0.015, 0.015, 1.0, 8), mat(0x6b4a2a), [0, 0.5, 0]);
  add(pole, G.sphere(0.03, 8, 6), gold, [0, 1.0, 0]);
  const flagGeo = new THREE.PlaneGeometry(0.4, 0.26, 10, 4);
  const flag = new THREE.Mesh(flagGeo, mat(TEAM_COLORS[team], { emissive: TEAM_COLORS[team], ei: 0.35, double: true, rough: 0.7 }));
  flag.position.set(0.2, 0.84, 0); flag.castShadow = true; pole.add(flag);
  flag.userData.base = flagGeo.attributes.position.array.slice();
  return { root, parts: { turret, flag, soldier: s }, height: 1.2 };
}

// ---------- bosses ----------
function abom() {
  // hulking stitched flesh giant with a hook and a cleaver
  const root = new THREE.Group();
  const body = group(root, [0, 0.42, 0]);
  const parts = { body };
  const flesh = mat(0x8fa67a, { rough: 0.7 }), fleshD = mat(0x6b7f58, { rough: 0.8 }), stitch = mat(0x2a1a14, { rough: 1 });
  add(body, G.sphere(0.3, 18, 14), flesh, [0, 0.12, 0], null).scale.set(1.15, 1, 1);
  add(body, G.sphere(0.22, 16, 12), fleshD, [0, -0.02, 0.12]).scale.set(1.1, 0.9, 0.9); // belly
  for (let k = 0; k < 5; k++) add(body, G.box(0.02, 0.06, 0.02), stitch, [-0.08 + k * 0.04, 0.0, 0.31]);
  add(body, G.box(0.2, 0.015, 0.02), stitch, [0, 0.0, 0.305]);
  for (let k = 0; k < 4; k++) add(body, G.box(0.015, 0.05, 0.02), stitch, [0.16, 0.2 - k * 0.05, 0.22], [0, 0.6, 0]);
  const head = group(body, [0, 0.42, 0.05]); parts.head = head;
  add(head, G.sphere(0.1, 14, 10), flesh);
  for (const sx of [-1, 1]) add(head, G.sphere(0.022, 8, 6), glow(0xffe23a, 3), [sx * 0.04, 0.02, 0.085]);
  add(head, G.box(0.08, 0.015, 0.02), stitch, [0, -0.04, 0.09]);
  parts.legL = limb(body, [-0.15, -0.14, 0], 0.09, 0.14, fleshD, flesh);
  parts.legR = limb(body, [0.15, -0.14, 0], 0.09, 0.14, fleshD, flesh);
  parts.armL = limb(body, [-0.36, 0.25, 0], 0.08, 0.24, flesh);
  parts.armR = limb(body, [0.36, 0.25, 0], 0.08, 0.24, flesh);
  const steel = mat(0x9aa2ab, { metal: 0.85, rough: 0.3 });
  add(parts.armL, G.torus(0.07, 0.015, 6, 14, Math.PI * 1.4), steel, [0, -0.45, 0.04], [0, Math.PI / 2, 0]);
  add(parts.armR, G.box(0.04, 0.24, 0.14), steel, [0, -0.5, 0.06]);
  add(parts.armR, G.cyl(0.02, 0.02, 0.12, 6), mat(0x4a3020), [0, -0.36, 0]);
  return { root, parts, height: 1.3, walk: 'stomp' };
}
function lich() {
  // floating robed skeleton king with a crown and a necromantic staff
  const root = new THREE.Group();
  const body = group(root, [0, 0.5, 0]);
  const parts = { body };
  const robe = mat(0x3a1f5c, { rough: 0.8 }), robeD = mat(0x24123a, { rough: 0.9 }), bone = mat(C.bone ?? 0xe8dfc8, { rough: 0.6 });
  const gold = mat(C.gold, { metal: 0.85, rough: 0.25 });
  add(body, G.cone(0.32, 0.75, 16), robe, [0, -0.05, 0]);
  add(body, G.cone(0.34, 0.2, 16), robeD, [0, -0.35, 0]);
  add(body, G.torus(0.2, 0.03, 6, 18), gold, [0, 0.24, 0], [Math.PI / 2, 0, 0]);
  const head = group(body, [0, 0.42, 0]); parts.head = head;
  add(head, G.sphere(0.13, 14, 12), bone);
  for (const sx of [-1, 1]) add(head, G.sphere(0.03, 8, 6), glow(C.necro, 5), [sx * 0.05, 0.01, 0.11]);
  add(head, G.box(0.08, 0.025, 0.03), mat(0x1a1a1a), [0, -0.06, 0.11]);
  add(head, G.cyl(0.13, 0.12, 0.07, 10, 1), gold, [0, 0.11, 0]);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; add(head, G.cone(0.025, 0.08, 4), gold, [Math.cos(a) * 0.12, 0.18, Math.sin(a) * 0.12]); }
  add(head, G.sphere(0.025, 8, 6), glow(0xff3a5a, 3), [0, 0.12, 0.13]);
  parts.armL = group(body, [-0.24, 0.22, 0]); parts.armR = group(body, [0.24, 0.22, 0]);
  add(parts.armL, G.cap(0.05, 0.2, 6), robe, [0, -0.12, 0]);
  add(parts.armR, G.cap(0.05, 0.2, 6), robe, [0, -0.12, 0]);
  const staff = group(parts.armR, [0.04, -0.25, 0.06]);
  add(staff, G.cyl(0.015, 0.015, 0.9, 6), mat(0x2a1a10), [0, 0.2, 0]);
  add(staff, G.sphere(0.07, 12, 10), glow(C.necro, 4), [0, 0.68, 0]);
  add(staff, G.torus(0.08, 0.012, 6, 14), gold, [0, 0.68, 0], [Math.PI / 2, 0, 0]);
  return { root, parts, height: 1.35, walk: 'float' };
}

// ============================================================
export const UNDEAD_MODELS = { skeleton, zombie, bats: bat, pumpkin, gargoyle, ghost, mummy, golem, horseman, dragon, imp, rider, abom, lich };
export const DEFENDER_MODELS = { rifleman: riflemanModel, sniper: sniperModel, samurai: samuraiModel, flamethrower: flameModel, grenadier: grenadierModel, mgnest: mgModel, missile: missileModel, tank: tankModel, drone: droneOpModel, commander: commanderModel };

export function buildUndead(type) {
  const m = UNDEAD_MODELS[type]();
  m.root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return m;
}
export function buildDefender(type, team, level) {
  const m = DEFENDER_MODELS[type](team, level);
  // level chevrons floating above
  if (level > 0) {
    const ch = group(m.root, [0, m.height + 0.25, 0]);
    const cm = level === 2 ? mat(0xffb21e, { emissive: 0xff8a00, ei: 0.45, metal: 0.6, rough: 0.35 }) : mat(0x5aa8ff, { emissive: 0x2a6fff, ei: 0.4, metal: 0.5, rough: 0.35 });
    for (let k = 0; k < level; k++) {
      const a = add(ch, G.box(0.11, 0.03, 0.03), cm, [-0.04, k * 0.06, 0], [0, 0, -0.6]);
      const b = add(ch, G.box(0.11, 0.03, 0.03), cm, [0.04, k * 0.06, 0], [0, 0, 0.6]);
      a.castShadow = b.castShadow = false;
    }
    m.parts.chevrons = ch;
  }
  return m;
}

// ---------- sabotage icon models (for cards) ----------
export function buildSabotageIcon(id) {
  const root = new THREE.Group();
  if (id === 'fog') {
    const fm = mat(0xb8c4d8, { rough: 1 });
    for (const [x, y, z, r] of [[0, 0.5, 0, 0.32], [-0.3, 0.42, 0.05, 0.24], [0.3, 0.42, 0.05, 0.25], [0.15, 0.68, -0.05, 0.22], [-0.15, 0.66, 0, 0.2]]) add(root, G.sphere(r), fm, [x, y, z]);
    add(root, G.torus(0.12, 0.03, 8, 20), mat(0x6a7690), [0, 0.5, 0.35]);
  } else if (id === 'emp') {
    add(root, G.sphere(0.25), glow(0x48b8ff, 1.8), [0, 0.55, 0]);
    add(root, G.torus(0.38, 0.025, 8, 32), glow(0x9ad8ff, 2.5), [0, 0.55, 0], [1.2, 0.3, 0]);
    add(root, G.torus(0.42, 0.02, 8, 32), glow(0x9ad8ff, 2.5), [0, 0.55, 0], [0.3, 1.1, 0]);
    const bolt = new THREE.Shape(); bolt.moveTo(0.02, 0.2); bolt.lineTo(-0.1, -0.02); bolt.lineTo(0.0, -0.02); bolt.lineTo(-0.04, -0.2); bolt.lineTo(0.1, 0.04); bolt.lineTo(0.0, 0.04); bolt.lineTo(0.06, 0.2);
    const b = new THREE.Mesh(new THREE.ExtrudeGeometry(bolt, { depth: 0.04, bevelEnabled: false }), glow(0xffee55, 2.5));
    b.position.set(0, 0.55, 0.26); root.add(b);
  } else if (id === 'raise') {
    const sk = skeleton(); sk.root.scale.setScalar(1.1); sk.root.position.y = -0.1; root.add(sk.root);
    add(root, G.torus(0.35, 0.03, 8, 32), glow(C.necro, 3), [0, 0.05, 0], [Math.PI / 2, 0, 0]);
    add(root, G.torus(0.25, 0.02, 8, 32), glow(C.necro, 3), [0, 0.3, 0], [Math.PI / 2, 0, 0]);
  }
  return { root, parts: {}, height: 1 };
}
