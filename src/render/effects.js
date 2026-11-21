// Particles, tracers, shockwave rings, debris and floating text.
import * as THREE from 'three';

const PVERT = `
attribute float size; attribute vec4 pcolor; attribute float spin;
varying vec4 vColor; varying float vSpin;
uniform float uScale;
void main(){
  vColor = pcolor; vSpin = spin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG_GLOW = `
varying vec4 vColor;
void main(){
  vec2 p = gl_PointCoord - 0.5; float r = length(p);
  float a = smoothstep(0.5, 0.0, r); a = a * a;
  gl_FragColor = vec4(vColor.rgb * (1.0 + a), vColor.a * a);
}`;
const PFRAG_SMOKE = `
varying vec4 vColor; varying float vSpin;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin); p = mat2(c,-s,s,c) * p;
  float r = length(p);
  float n = sin(p.x * 13.0 + vSpin * 3.0) * sin(p.y * 11.0 - vSpin) * 0.06;
  float a = smoothstep(0.5, 0.15, r + n);
  gl_FragColor = vec4(vColor.rgb * (0.85 + 0.25 * (0.5 - p.y)), vColor.a * a);
}`;

class ParticleSystem {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.p = [];
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.spin = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('spin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    this.uScale = { value: 800 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.uScale },
      vertexShader: PVERT, fragmentShader: additive ? PFRAG_GLOW : PFRAG_SMOKE,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life || 1, age: 0, s0: o.size || 0.3, s1: o.size1 ?? (o.size || 0.3),
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 1, a1: o.a1 ?? 0,
      grav: o.grav || 0, drag: o.drag ?? 1, spin: o.spin ?? Math.random() * 6, spinV: o.spinV ?? (Math.random() - 0.5),
      floor: o.floor ?? -9,
    });
  }
  update(dt) {
    const arr = this.p;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      const k = Math.pow(q.drag, dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      q.vy -= q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < q.floor) { q.y = q.floor; q.vy = 0; }
      q.spin += q.spinV * dt;
      arr[w++] = q;
    }
    arr.length = w;
    for (let i = 0; i < w; i++) {
      const q = arr[i], t = q.age / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.col[i * 4] = q.r; this.col[i * 4 + 1] = q.g; this.col[i * 4 + 2] = q.b;
      this.col[i * 4 + 3] = q.a + (q.a1 - q.a) * t;
      this.size[i] = q.s0 + (q.s1 - q.s0) * t;
      this.spin[i] = q.spin;
    }
    this.geo.setDrawRange(0, w);
    for (const k of ['position', 'pcolor', 'size', 'spin']) this.geo.attributes[k].needsUpdate = true;
  }
}

export class Effects {
  constructor(stage, overlay) {
    this.stage = stage;
    const scene = stage.scene;
    this.glow = new ParticleSystem(scene, 4000, true);
    this.smoke = new ParticleSystem(scene, 2500, false);
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
    this.tracerGeo = tg;
    // rings
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48); this.ringGeo.rotateX(-Math.PI / 2);
    // debris
    this.debris = [];
    const boneGeo = new THREE.CapsuleGeometry(0.03, 0.12, 3, 6);
    const chunkGeo = new THREE.DodecahedronGeometry(0.06, 0);
    this.boneMesh = new THREE.InstancedMesh(boneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), 400);
    this.chunkMesh = new THREE.InstancedMesh(chunkGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), 400);
    for (const m of [this.boneMesh, this.chunkMesh]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); m.setColorAt(0, new THREE.Color()); }
    this.dummy = new THREE.Object3D();
    // floating text
    this.overlay = overlay;
    this.texts = [];
    this.textPool = [];
    this.v = new THREE.Vector3();
  }

  setScale(s) { this.glow.uScale.value = s; this.smoke.uScale.value = s; }

  // ---- presets ----
  muzzle(p, color = [1, 0.75, 0.35], size = 0.35) {
    this.glow.spawn({ x: p.x, y: p.y, z: p.z, life: 0.07, size, size1: size * 0.6, r: color[0] * 2, g: color[1] * 2, b: color[2] * 2, a: 1, a1: 0 });
    for (let k = 0; k < 2; k++) this.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 2, life: 0.15, size: 0.06, r: 1.5, g: 1.1, b: 0.5, a: 1, grav: 4 });
  }
  tracer(a, b, color = 0xffd27a, width = 0.018, life = 0.07) {
    let t = this.tracers.find(t => !t.active);
    if (!t) {
      if (this.tracers.length > 80) t = this.tracers[0];
      else {
        const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.stage.scene.add(m); t = { mesh: m }; this.tracers.push(t);
      }
    }
    t.active = true; t.age = 0; t.life = life;
    t.mesh.visible = true;
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 1;
    t.mesh.position.copy(a);
    const len = a.distanceTo(b);
    t.mesh.scale.set(width, width, len);
    t.mesh.lookAt(b);
    t.width = width;
  }
  ring(p, r0, r1, color = 0xffaa55, life = 0.4, opacity = 0.9) {
    let rg = this.rings.find(x => !x.active);
    if (!rg) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      this.stage.scene.add(m); rg = { mesh: m }; this.rings.push(rg);
    }
    Object.assign(rg, { active: true, age: 0, life, r0, r1, op: opacity });
    rg.mesh.visible = true; rg.mesh.material.color.setHex(color);
    rg.mesh.position.set(p.x, p.y + 0.05, p.z);
  }
  explosion(p, r = 1, big = false) {
    const n = big ? 26 : 14;
    this.glow.spawn({ x: p.x, y: p.y + 0.3, z: p.z, life: 0.18, size: r * 3.2, size1: r * 4, r: 2.5, g: 1.6, b: 0.7, a: 1, a1: 0 });
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, sp = (1 + Math.random() * 3) * r;
      this.glow.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, size: 0.4 * r + Math.random() * 0.3, size1: 0.1, r: 2.2, g: 1.0 + Math.random() * 0.5, b: 0.3, a: 1, a1: 0, drag: 0.1, grav: 3 });
    }
    for (let k = 0; k < n * 0.7; k++) {
      const a = Math.random() * 6.28, sp = Math.random() * 1.2 * r;
      this.smoke.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 0.8, vz: Math.sin(a) * sp, life: 1 + Math.random() * 0.8, size: 0.6 * r, size1: 1.6 * r, r: 0.22, g: 0.2, b: 0.22, a: 0.75, a1: 0, drag: 0.3 });
    }
    for (let k = 0; k < (big ? 10 : 5); k++) this.chunk(p, 0x4a3b2c, 3 * r);
    this.ring(p, 0.2, r * 1.4, 0xffb060, 0.35);
  }
  greenPuff(p, scale = 1) {
    for (let k = 0; k < 12 * scale; k++) {
      const a = Math.random() * 6.28, sp = Math.random() * 1.4;
      this.smoke.spawn({ x: p.x + Math.cos(a) * 0.1, y: p.y + 0.3, z: p.z + Math.sin(a) * 0.1, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 1.2, vz: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.6, size: 0.35 * scale, size1: 0.9 * scale, r: 0.35, g: 0.9, b: 0.45, a: 0.7, a1: 0, drag: 0.15 });
    }
    for (let k = 0; k < 8 * scale; k++) this.glow.spawn({ x: p.x, y: p.y + 0.4, z: p.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.6, size: 0.12, size1: 0, r: 0.4, g: 1.6, b: 0.6, a: 1, drag: 0.3 });
  }
  bones(p, n = 6, color = 0xeee4c8) { for (let k = 0; k < n; k++) this.debrisPiece(this.boneMesh, p, color, 3); }
  chunk(p, color, sp = 3) { this.debrisPiece(this.chunkMesh, p, color, sp); }
  debrisPiece(mesh, p, color, sp) {
    if (this.debris.length > 700) this.debris.shift();
    const a = Math.random() * 6.28;
    this.debris.push({ mesh, x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * sp * Math.random(), vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp * Math.random(), rx: Math.random() * 6, ry: Math.random() * 6, vr: (Math.random() - 0.5) * 20, age: 0, life: 2.2 + Math.random(), color: new THREE.Color(color), ground: p.y });
  }
  fire(p, size = 0.3) {
    this.glow.spawn({ x: p.x + (Math.random() - 0.5) * 0.15, y: p.y, z: p.z + (Math.random() - 0.5) * 0.15, vy: 1.2 + Math.random(), vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3, life: 0.35 + Math.random() * 0.2, size, size1: size * 0.2, r: 2.2, g: 0.9 + Math.random() * 0.4, b: 0.2, a: 0.9, a1: 0 });
    if (Math.random() < 0.2) this.smoke.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vy: 0.8, life: 0.9, size: size * 0.8, size1: size * 2, r: 0.15, g: 0.13, b: 0.13, a: 0.4, a1: 0 });
  }
  flameStream(a, b, range) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const n = 4;
    for (let k = 0; k < n; k++) {
      const sp = range * (2.2 + Math.random());
      const spread = 0.35;
      const vx = dx / len * sp + (Math.random() - 0.5) * spread * sp, vz = dz / len * sp + (Math.random() - 0.5) * spread * sp;
      this.glow.spawn({ x: a.x, y: a.y, z: a.z, vx, vy: (Math.random() - 0.3) * 0.6, vz, life: 0.32 + Math.random() * 0.1, size: 0.12, size1: 0.75, r: 2.4, g: 1.0 + Math.random() * 0.4, b: 0.25, a: 0.9, a1: 0, drag: 0.08 });
    }
  }
  sparks(p, color = [1.6, 1.4, 0.8], n = 5) {
    for (let k = 0; k < n; k++) this.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.25, size: 0.08, size1: 0, r: color[0], g: color[1], b: color[2], a: 1, grav: 6 });
  }
  dust(p, color = [0.55, 0.5, 0.45], n = 10, s = 1) {
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.28, sp = Math.random() * 1.5 * s; this.smoke.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * sp, vy: Math.random() * 0.8, vz: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.5, size: 0.3 * s, size1: 0.9 * s, r: color[0], g: color[1], b: color[2], a: 0.7, a1: 0, drag: 0.2 }); }
  }
  electric(p, n = 3) {
    for (let k = 0; k < n; k++) this.glow.spawn({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + Math.random() * 0.8, z: p.z + (Math.random() - 0.5) * 0.6, life: 0.12, size: 0.18, size1: 0.02, r: 0.6, g: 1.4, b: 2.4, a: 1 });
  }

  // ---- floating text (DOM) ----
  text(world, str, cls) {
    if (this.texts.length > 70) { const old = this.texts.shift(); old.el.style.display = 'none'; this.textPool.push(old); }
    let t = this.textPool.pop();
    if (!t) { const el = document.createElement('div'); this.overlay.appendChild(el); t = { el }; }
    t.el.className = 'ftext ' + (cls || '');
    t.el.textContent = str;
    t.el.style.display = 'block';
    t.pos = world.clone(); t.age = 0; t.life = cls === 'bounty' ? 1.1 : 0.75; t.dx = (Math.random() - 0.5) * 18;
    this.texts.push(t);
  }

  update(dt, camera) {
    this.glow.update(dt); this.smoke.update(dt);
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.life) { t.active = false; t.mesh.visible = false; continue; }
      const k = 1 - t.age / t.life;
      t.mesh.material.opacity = k;
      t.mesh.scale.x = t.mesh.scale.y = t.width * (0.5 + k * 0.5);
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= r.life) { r.active = false; r.mesh.visible = false; continue; }
      const k = r.age / r.life, e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mesh.material.opacity = r.op * (1 - k);
    }
    // debris
    const d = this.dummy;
    const counts = new Map([[this.boneMesh, 0], [this.chunkMesh, 0]]);
    let w = 0;
    for (const q of this.debris) {
      q.age += dt;
      if (q.age > q.life) continue;
      q.vy -= 14 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < q.ground + 0.03) { q.y = q.ground + 0.03; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; q.vr *= 0.6; }
      q.rx += q.vr * dt;
      this.debris[w++] = q;
      const i = counts.get(q.mesh);
      if (i >= 400) continue;
      const fade = Math.min(1, (q.life - q.age) * 2);
      d.position.set(q.x, q.y - (1 - fade) * 0.1, q.z); d.rotation.set(q.rx, q.ry, q.rx * 0.5); d.scale.setScalar(fade);
      d.updateMatrix(); q.mesh.setMatrixAt(i, d.matrix); q.mesh.setColorAt(i, q.color);
      counts.set(q.mesh, i + 1);
    }
    this.debris.length = w;
    for (const [m, c] of counts) { m.count = c; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // text
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    let tw = 0;
    for (const t of this.texts) {
      t.age += dt;
      if (t.age >= t.life) { t.el.style.display = 'none'; this.textPool.push(t); continue; }
      this.texts[tw++] = t;
      this.v.copy(t.pos); this.v.y += 0.9 + t.age * 1.2;
      this.v.project(camera);
      const k = t.age / t.life;
      const sc = k < 0.15 ? 0.6 + k / 0.15 * 0.6 : 1.2 - (k - 0.15) * 0.3;
      t.el.style.transform = `translate(${(this.v.x * hw + hw + t.dx * k).toFixed(1)}px, ${(-this.v.y * hh + hh).toFixed(1)}px) translate(-50%,-50%) scale(${sc.toFixed(2)})`;
      t.el.style.opacity = k > 0.7 ? (1 - (k - 0.7) / 0.3).toFixed(2) : '1';
    }
    this.texts.length = tw;
  }
}
