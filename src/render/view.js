// Keeps the 3D scene in sync with the simulation and turns sim events into effects + sounds.
import * as THREE from 'three';
import { buildUndead, buildDefender, droneModel, mat, G, TEAM_COLORS } from './models.js';
import { Effects } from './effects.js';
import { toWorld, terrainHeight } from './scene.js';
import { CONFIG, MACHINES } from '../config.js';
import { LANES, BUILD_TILES, W, H, HALF, lanePoint } from '../arena.js';
import { defStats } from '../sim.js';

const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
const MUTE = { play() {}, voice() {}, setIntensity() {} };
const UNIT_SCALE = 1.45, DEF_SCALE = 1.3;
const lp = {};

export class View {
  constructor(stage, overlay, audio) {
    this.stage = stage;
    this.scene = stage.scene;
    this.audio = audio;
    this.fx = new Effects(stage, overlay);
    this.units = new Map();
    this.defs = new Map();
    this.projs = new Map();
    this.drones = new Map();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.textBudget = 0;
    this.buildHelpers();
  }

  reset() {
    for (const m of this.units.values()) this.scene.remove(m.root);
    for (const m of this.defs.values()) this.scene.remove(m.root);
    for (const m of this.projs.values()) this.scene.remove(m);
    for (const m of this.drones.values()) this.scene.remove(m.root);
    this.units.clear(); this.defs.clear(); this.projs.clear(); this.drones.clear();
    for (const b of this.stage.bunkers) {
      b.body.position.set(0, 0, 0); b.body.rotation.set(0, 0, 0); b.body.scale.set(1, 1, 1); b.cracks.forEach(c => c.visible = false); b.dead = false; b.group.visible = true;
      for (const f of b.flying || []) { const o = f.o.userData.orig; if (o) { f.o.position.copy(o.p); f.o.rotation.copy(o.r); f.o.visible = o.v; } }
      b.flying = null;
      if (b.rubble) { b.group.remove(b.rubble); b.rubble = null; }
    }
    for (const h of this.hitters || []) this.scene.remove(h.m.root);
    this.hitters = [];
    this.selected = null;
    this.clearPreview();
  }

  // ---------------- helpers: previews, highlights ----------------
  buildHelpers() {
    const s = this.scene;
    const rangeGeo = new THREE.CircleGeometry(1, 64); rangeGeo.rotateX(-Math.PI / 2);
    const edgeGeo = new THREE.RingGeometry(0.96, 1, 64); edgeGeo.rotateX(-Math.PI / 2);
    this.range = new THREE.Group();
    this.rangeFill = new THREE.Mesh(rangeGeo, new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.12, depthWrite: false }));
    this.rangeEdge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.8, depthWrite: false }));
    this.range.add(this.rangeFill, this.rangeEdge); this.range.visible = false; this.range.renderOrder = 3; s.add(this.range);
    this.selRange = this.range.clone(true);
    // selection circle: soft cyan, kept faint so it never washes the selected unit out
    this.selRange.children.forEach((c, k) => { c.material = c.material.clone(); c.material.color.setHex(0x8fd4ff); c.material.opacity = k === 0 ? 0.06 : 0.55; });
    s.add(this.selRange);
    this.tileHi = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.55, depthWrite: false }));
    this.tileHi.visible = false; s.add(this.tileHi);
    this.buildArenaHelpers();
    this._helpersRest();
  }
  // build-tile highlights and lane ribbons depend on the arena; rebuilt by rebuildArena()
  buildArenaHelpers() {
    const s = this.scene;
    if (this.tiles) { s.remove(this.tiles); this.tiles.dispose(); }
    if (this.laneRibbons) for (const r of this.laneRibbons.flat()) { s.remove(r); r.geometry.dispose(); }
    const tg = new THREE.PlaneGeometry(0.86, 0.86).rotateX(-Math.PI / 2);
    this.tiles = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.16, depthWrite: false }), BUILD_TILES[0].length);
    this.tiles.visible = false; s.add(this.tiles);
    this.tilesFor = null;
    this.laneRibbons = [[], []];
    for (let side = 0; side < 2; side++) for (let l = 0; l < 3; l++) {
      const lane = LANES[side][l];
      const path = new THREE.CurvePath();
      for (const sg of lane.segs) path.add(new THREE.LineCurve3(toWorld(sg.ax, sg.ay).setY(0.05), toWorld(sg.bx, sg.by).setY(0.05)));
      const geo = new THREE.TubeGeometry(path, Math.ceil(lane.length * 3), 0.42, 6, false);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: side === 1 ? 0x66aaff : 0xff6677, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.scale.y = 0.12; m.visible = false; s.add(m);
      this.laneRibbons[side][l] = m;
    }
  }
  _helpersRest() {
    const s = this.scene;
    // half highlight
    this.halfHi = new THREE.Mesh(new THREE.PlaneGeometry(HALF, H).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halfHi.position.copy(toWorld(W - HALF / 2, H / 2)).setY(0.3); this.halfHi.visible = false; s.add(this.halfHi);
    // all-ranges debug group
    this.debugRanges = new THREE.Group(); s.add(this.debugRanges);
    this.previewModel = null; this.previewType = null;
  }

  pickGround(cx, cy) {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
    return { x: p.x + W / 2, y: p.z + H / 2 };
  }
  worldToScreen(x, y, h = 0) {
    toWorld(x, y, v3); v3.y = h; v3.project(this.stage.camera);
    return { x: (v3.x + 1) / 2 * window.innerWidth, y: (1 - v3.y) / 2 * window.innerHeight };
  }

  showPreview(type, x, y, valid, range, game) {
    if (this.previewType !== type) {
      if (this.previewModel) this.scene.remove(this.previewModel);
      const m = buildDefender(type, 0, 0);
      m.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.65; o.castShadow = false; } });
      this.previewModel = m.root; this.previewType = type; m.root.scale.setScalar(DEF_SCALE);
      this.scene.add(m.root);
    }
    const gx = Math.floor(x) + 0.5, gy = Math.floor(y) + 0.5;
    toWorld(gx, gy, this.previewModel.position); this.previewModel.position.y = 0.05;
    this.previewModel.rotation.y = Math.PI / 2;
    this.previewModel.visible = true;
    const col = valid ? 0x55ff77 : 0xff4455;
    this.range.visible = true; toWorld(gx, gy, this.range.position); this.range.position.y = 0.06;
    this.range.scale.setScalar(Math.max(0.3, range));
    this.rangeFill.material.color.setHex(col); this.rangeEdge.material.color.setHex(col);
    this.tileHi.visible = true; toWorld(gx, gy, this.tileHi.position); this.tileHi.position.y = 0.07;
    this.tileHi.material.color.setHex(col);
    // free tiles
    const d = new THREE.Object3D(); let n = 0;
    for (const t of BUILD_TILES[0]) {
      if (game.occupied[0].has(t.i * 100 + t.j)) continue;
      toWorld(t.x, t.y, d.position); d.position.y = terrainHeight(t.x, t.y) + 0.04; d.updateMatrix(); this.tiles.setMatrixAt(n++, d.matrix);
    }
    this.tiles.count = n; this.tiles.instanceMatrix.needsUpdate = true; this.tiles.visible = true;
  }
  clearPreview() {
    if (this.previewModel) this.previewModel.visible = false;
    this.range.visible = false; this.tileHi.visible = false; this.tiles.visible = false;
    this.highlightGate(null); this.highlightLane(null); this.halfHi.visible = false;
  }
  highlightGate(lane) { this.hiGate = lane; }
  highlightLane(lane, side = 1) { for (let s = 0; s < 2; s++) this.laneRibbons[s].forEach((m, l) => m.visible = this.showPaths || (s === side && l === lane)); }
  highlightHalf(on) { this.halfHi.visible = on; }
  select(def) { this.selected = def; }
  setShowDebug(on, game) {
    this.showPaths = on;
    this.highlightLane(null);
    this.debugRanges.clear();
    this.debugRangesOn = on;
  }

  // ---------------- per frame ----------------
  // the menu's background demo battle is silent so only the menu music plays
  get sound() { return this.silent ? MUTE : this.audio; }
  update(game, dt, viewerSide = 0) {
    const t = performance.now() / 1000;
    this.fx.setScale(this.stage.pointScale);
    this.textBudget = Math.min(12, this.textBudget + dt * 25);
    this.processEvents(game);
    this.syncUnits(game, dt, t);
    this.syncDefenders(game, dt, t);
    this.syncProjectiles(game, dt);
    this.continuous(game, dt, t);
    // gates
    for (let side = 0; side < 2; side++) this.stage.gates[side].forEach((g, l) => {
      const target = side === 1 && this.hiGate === l ? 1 : 0;
      g.uHi.value += (target - g.uHi.value) * Math.min(1, dt * 10);
      g.light.intensity = g.baseIntensity * (1 + g.uHi.value * 1.5) * (0.9 + Math.sin(t * 3 + l) * 0.1);
    });
    // selection range
    if (this.selected && game.defenders.includes(this.selected)) {
      const s = defStats(this.selected);
      this.selRange.visible = true; toWorld(this.selected.x, this.selected.y, this.selRange.position); this.selRange.position.y = 0.06;
      this.selRange.scale.setScalar(Math.max(0.3, s.range));
    } else this.selRange.visible = false;
    if (this.debugRangesOn) {
      this.debugRanges.clear();
      for (const d of game.defenders) {
        const r = this.range.clone(true); r.visible = true; toWorld(d.x, d.y, r.position); r.position.y = 0.06; r.scale.setScalar(defStats(d).range || 0.5);
        this.debugRanges.add(r);
      }
    }
    this.fx.update(dt, this.stage.camera);
  }

  // ---------------- units ----------------
  syncUnits(game, dt, t) {
    const seen = new Set();
    for (const u of game.units) {
      if (!u.alive) continue;
      seen.add(u.id);
      let m = this.units.get(u.id);
      if (!m) {
        m = buildUndead(u.type);
        const c = CONFIG.undead[u.type];
        m.base = (c.size || 1) * (m.scale || 1) * UNIT_SCALE;
        m.root.scale.setScalar(0.01);
        m.age = 0;
        // team ring
        const rc = u.neutral ? 0xb8bcc8 : TEAM_COLORS[u.owner]; const ring = new THREE.Mesh(G.torus(0.3, 0.025, 4, 24), mat(rc, { emissive: rc, ei: u.neutral ? 0.5 : 1.6 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; ring.castShadow = false;
        m.root.add(ring);
        // health bar
        const hb = new THREE.Group();
        const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.07), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75, depthWrite: false }));
        const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.05), new THREE.MeshBasicMaterial({ color: u.owner === 0 ? 0x4da3ff : 0xff4d5e, depthWrite: false }));
        fg.position.z = 0.001; fg.geometry.translate(0.24, 0, 0); fg.position.x = -0.24;
        hb.add(bg, fg); hb.renderOrder = 10; hb.visible = false;
        this.scene.add(hb);
        m.hb = hb; m.hbFg = fg;
        // gargoyle shield rocks
        if (u.shield > 0) {
          m.shieldRocks = [];
          for (let k = 0; k < u.shield; k++) {
            const r = new THREE.Mesh(G.dodeca(0.07), mat(0x9aa0ad, { rough: 0.9, flat: true, emissive: 0x2a3a5a, ei: 0.6 }));
            m.root.add(r); m.shieldRocks.push(r);
          }
        }
        if (u.revived) m.root.traverse(o => { if (o.isMesh && o.material && o.material.emissive && !o.material.transparent) { o.material = o.material.clone(); o.material.emissive.setHex(0x1a7a30); o.material.emissiveIntensity = 0.5; } });
        this.scene.add(m.root);
        this.units.set(u.id, m);
        m.squash = 0;
      }
      m.age += dt;
      const c = CONFIG.undead[u.type];
      toWorld(u.x, u.y, m.root.position);
      let h = terrainHeight(u.x, u.y);
      if (u.d < 0) h -= 0.5; // still emerging
      m.root.position.y = h + Math.min(0, -0.6 + m.age * 2.2);
      const targetRot = Math.atan2(u.dx, u.dy);
      m.root.rotation.y = lerpAngle(m.root.rotation.y, targetRot, Math.min(1, dt * 8));
      m.squash = Math.max(0, m.squash - dt * 5);
      const grow = Math.min(1, m.age * 3);
      const sq = 1 + m.squash * 0.25;
      m.root.scale.set(m.base * grow * sq, m.base * grow / sq, m.base * grow * sq);
      this.animateUnit(m, u, t, dt);
      // ghosts
      if (m.parts.fadeMats) {
        let op;
        if (u.owner === 0) op = 0.6; else op = u.revealed ? 0.8 : 0.16 + Math.sin(t * 5 + u.id) * 0.05;
        m.op = m.op == null ? op : m.op + (op - m.op) * Math.min(1, dt * 6);
        m.parts.fadeMats[0].opacity = m.op; m.parts.fadeMats[1].opacity = Math.min(1, m.op * 1.2);
      }
      if (m.shieldRocks) m.shieldRocks.forEach((r, k) => {
        r.visible = k < u.shield;
        const a = t * 2 + k / m.shieldRocks.length * Math.PI * 2;
        r.position.set(Math.cos(a) * 0.42, 0.45 + Math.sin(t * 3 + k) * 0.05, Math.sin(a) * 0.42);
        r.rotation.set(t, t * 1.3, 0);
      });
      // health bar
      const frac = Math.max(0, u.hp / u.maxHp);
      if (frac < 0.999 && !(u.invisible && !u.revealed && u.owner === 1)) {
        m.hb.visible = true;
        m.hb.position.set(m.root.position.x, m.root.position.y + (m.height || 1) * m.base + 0.15, m.root.position.z);
        m.hb.quaternion.copy(this.stage.camera.quaternion);
        m.hbFg.scale.x = Math.max(0.001, frac);
      } else m.hb.visible = false;
    }
    for (const [id, m] of this.units) if (!seen.has(id)) { this.scene.remove(m.root); this.scene.remove(m.hb); this.units.delete(id); }
  }

  animateUnit(m, u, t, dt) {
    const p = m.parts, ph = u.d * 5.5 + u.bob;
    const sw = Math.sin(ph);
    switch (m.walk) {
      case 'biped': case 'run': case 'shamble': {
        const amp = m.walk === 'run' ? 0.9 : m.walk === 'shamble' ? 0.35 : 0.6;
        if (p.legL) { p.legL.rotation.x = sw * amp; p.legR.rotation.x = -sw * amp; }
        if (p.armL && !p.armsForward) { p.armL.rotation.x = -sw * amp * 0.8; p.armR.rotation.x = sw * amp * 0.8; }
        else if (p.armL) { p.armL.rotation.z = Math.sin(ph * 0.5) * 0.1; p.armR.rotation.z = -Math.sin(ph * 0.5) * 0.1; }
        p.body.position.y = (p.body.userData.y0 ??= p.body.position.y) + Math.abs(Math.cos(ph)) * (m.walk === 'run' ? 0.06 : 0.03);
        p.body.rotation.x = m.walk === 'run' ? 0.25 : m.walk === 'shamble' ? 0.12 : 0.04;
        p.body.rotation.z = m.walk === 'shamble' ? Math.sin(ph * 0.5) * 0.12 : 0;
        if (p.cape) p.cape.rotation.x = 0.25 + Math.sin(t * 6) * 0.1;
        break;
      }
      case 'stomp':
        if (p.legL) { p.legL.rotation.x = sw * 0.45; p.legR.rotation.x = -sw * 0.45; }
        if (p.armL) { p.armL.rotation.x = -sw * 0.4; p.armR.rotation.x = sw * 0.4; }
        p.body.rotation.z = Math.sin(ph) * 0.08;
        p.body.position.y = (p.body.userData.y0 ??= p.body.position.y) + Math.abs(Math.cos(ph)) * 0.03;
        if (p.wingL) { p.wingL.rotation.z = 0.3 + Math.sin(t * 2) * 0.1; p.wingR.rotation.z = -0.3 - Math.sin(t * 2) * 0.1; }
        break;
      case 'hop':
        p.body.position.y = (p.body.userData.y0 ??= p.body.position.y) + Math.abs(Math.sin(ph * 1.2)) * 0.12;
        break;
      case 'float':
        p.body.position.y = (p.body.userData.y0 ??= p.body.position.y) + Math.sin(t * 3 + u.bob) * 0.06 + 0.08;
        if (p.armL) { p.armL.rotation.z = -0.3 + Math.sin(t * 4) * 0.2; p.armR.rotation.z = 0.3 - Math.sin(t * 4) * 0.2; }
        break;
      case 'flap':
        p.wingL.rotation.z = Math.sin(t * 22 + u.bob) * 0.8; p.wingR.rotation.z = -Math.sin(t * 22 + u.bob) * 0.8;
        p.body.position.y = (p.body.userData.y0 ??= p.body.position.y) + Math.sin(t * 6 + u.bob) * 0.08;
        break;
      case 'gallop':
        p.legs4.forEach((l, k) => l.rotation.x = Math.sin(ph * 1.2 + (k < 2 ? 0 : Math.PI) + (k % 2) * 0.5) * 0.8);
        p.body.position.y = Math.abs(Math.sin(ph * 1.2)) * 0.06;
        p.body.rotation.x = Math.sin(ph * 1.2) * 0.06;
        if (p.cape) p.cape.rotation.x = 0.5 + Math.sin(t * 8) * 0.15;
        break;
      case 'flyheavy':
        p.wingL.rotation.z = Math.sin(t * 3) * 0.5; p.wingR.rotation.z = -Math.sin(t * 3) * 0.5;
        p.body.position.y = 0.95 + Math.sin(t * 3 - 1) * 0.08;
        if (p.tail) p.tail.rotation.y = Math.sin(t * 2) * 0.3;
        if (p.neck) p.neck.rotation.x = Math.sin(t * 1.5) * 0.08;
        p.legs4.forEach((l, k) => l.rotation.x = 0.4 + Math.sin(t * 2 + k) * 0.1);
        break;
    }
  }

  // ---------------- defenders ----------------
  syncDefenders(game, dt, t) {
    const seen = new Set();
    for (const d of game.defenders) {
      seen.add(d.id);
      let m = this.defs.get(d.id);
      if (!m || m.level !== d.level) {
        if (m) this.scene.remove(m.root);
        m = buildDefender(d.type, d.side, d.level);
        m.level = d.level;
        m.age = m.age || 0;
        toWorld(d.x, d.y, m.root.position); m.root.position.y = terrainHeight(d.x, d.y);
        const face = d.side === 0 ? Math.PI / 2 : -Math.PI / 2;
        if (m.parts.turret) m.parts.turret.rotation.y = face;
        if (m.parts.hull) m.parts.hull.rotation.y = face;
        // commander: always show its boost circle; others: a gold ring appears while boosted
        if (d.type === 'commander') {
          const r = CONFIG.defenders.commander.levels[d.level].range;
          const g = new THREE.Group();
          const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc640, transparent: true, opacity: 0.07, depthWrite: false }));
          const edge = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd860, transparent: true, opacity: 0.45, depthWrite: false }));
          g.add(fill, edge); g.position.y = 0.04; g.userData.r = r;
          m.root.add(g); m.auraRing = g;
        } else {
          const br = new THREE.Mesh(G.torus(0.42, 0.03, 4, 28), mat(0xffc640, { emissive: 0xffa020, ei: 1.2 }));
          br.rotation.x = Math.PI / 2; br.position.y = 0.12; br.visible = false;
          m.root.add(br); m.buffRing = br;
        }
        this.scene.add(m.root);
        this.defs.set(d.id, m);
        if (d.type === 'drone' && !this.drones.has(d.id)) { const dm = droneModel(d.side); dm.root.scale.setScalar(DEF_SCALE * 1.2); this.scene.add(dm.root); this.drones.set(d.id, dm); }
      }
      m.age += dt;
      const pop = Math.min(1, m.age * 4);
      m.root.scale.setScalar(DEF_SCALE * (0.6 + 0.4 * easeOutBack(pop)));
      if (m.auraRing) { m.auraRing.scale.setScalar(m.auraRing.userData.r / m.root.scale.x); m.auraRing.children[1].material.opacity = 0.35 + Math.sin(t * 3) * 0.1; }
      if (m.buffRing) { const on = game.aura(d).dmg > 1; m.buffRing.visible = on; if (on) m.buffRing.rotation.z = t * 1.5; }
      const aim = Math.atan2(d.aimX, d.aimY);
      const tur = m.parts.turret;
      if (tur && d.type !== 'commander' && d.type !== 'drone') {
        if (m.parts.hull && m.parts.turret.parent === m.parts.hull) {
          // tank: turret relative to hull
          m.parts.turret.rotation.y = lerpAngle(m.parts.turret.rotation.y, aim - m.parts.hull.rotation.y, Math.min(1, dt * 6));
        } else tur.rotation.y = lerpAngle(tur.rotation.y, aim, Math.min(1, dt * 10));
      }
      if (d.type === 'drone' && tur) tur.rotation.y = lerpAngle(tur.rotation.y, aim, Math.min(1, dt * 5));
      // recoil
      if (m.parts.recoil) {
        const r = m.parts.recoil;
        r.userData.z0 ??= r.position.z;
        r.position.z = r.userData.z0 - d.firing * (d.type === 'tank' ? 0.8 : 0.3);
      }
      // tank ram lunge
      if (m.parts.hull) {
        const k = d.lunge > 0 ? Math.sin((1 - d.lunge) * Math.PI) * 1.4 : 0;
        const a = Math.atan2(d.aimX, d.aimY);
        m.parts.hull.position.set(Math.sin(a) * k, 0, Math.cos(a) * k);
      }
      // samurai swing
      if (m.parts.swordArm) {
        m.swing = Math.max(0, (m.swing || 0) - dt * 5);
        const sw = m.swing;
        m.parts.swordArm.rotation.x = -0.9 - Math.sin(sw * Math.PI) * 1.4;
        m.parts.swordArm.rotation.z = Math.sin(sw * Math.PI) * 0.8;
        if (m.whirl > 0) { m.whirl = Math.max(0, m.whirl - dt * 3); tur.rotation.y += dt * 25 * m.whirl; }
      }
      // commander flag
      if (m.parts.flag) waveFlag(m.parts.flag, t);
      // idle breathing
      if (m.parts.soldier) m.parts.soldier.torso.position.y = 0.36 + Math.sin(t * 2 + d.id) * 0.008;
      // EMP dim
      if (d.emped && Math.random() < 0.3) { toWorld(d.x, d.y, v3); v3.y = 0.5; this.fx.electric(v3, 1); }
      // drone
      const dm = this.drones.get(d.id);
      if (dm) {
        toWorld(d.drone.x, d.drone.y, dm.root.position);
        dm.root.position.y = (d.emped ? 0.35 : 1.45) + Math.sin(t * 3 + d.id) * 0.06;
        dm.parts.rotors.forEach((r, k) => r.rotation.y += dt * (d.emped ? 0 : 40) * (k % 2 ? 1 : -1));
        dm.root.rotation.z = d.emped ? 0.4 : 0;
      }
    }
    for (const [id, m] of this.defs) if (!seen.has(id)) {
      this.scene.remove(m.root); this.defs.delete(id);
      const dm = this.drones.get(id); if (dm) { this.scene.remove(dm.root); this.drones.delete(id); }
      if (this.selected && this.selected.id === id) this.selected = null;
    }
    // stage animations: bunker flags
    for (const b of this.stage.bunkers) waveFlag(b.flag, t);
  }

  muzzleWorld(def, out) {
    const m = this.defs.get(def.id);
    if (def.type === 'drone') { const dm = this.drones.get(def.id); if (dm) return out.copy(dm.root.position); }
    if (m && m.parts.muzzle) { m.root.updateMatrixWorld(true); return m.parts.muzzle.getWorldPosition(out); }
    toWorld(def.x, def.y, out); out.y = 0.6; return out;
  }
  unitWorld(x, y, h, out) { toWorld(x, y, out); out.y = terrainHeight(x, y) + h; return out; }

  // ---------------- projectiles ----------------
  syncProjectiles(game, dt) {
    const seen = new Set();
    for (const p of game.projectiles) {
      seen.add(p.id);
      let m = this.projs.get(p.id);
      if (!m) {
        m = new THREE.Group();
        if (p.kind === 'missile') {
          const b = new THREE.Mesh(G.cyl(0.05, 0.05, 0.36, 10), mat(0xd8d8d0, { metal: 0.3 })); b.rotation.x = Math.PI / 2; m.add(b);
          const tip = new THREE.Mesh(G.cone(0.05, 0.12, 10), mat(0xd63a2a)); tip.rotation.x = Math.PI / 2; tip.position.z = 0.24; m.add(tip);
          for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(G.box(0.01, 0.12, 0.1), mat(0x555555)); f.rotation.z = k * Math.PI / 2; f.position.z = -0.16; m.add(f); }
        } else if (p.kind === 'shell') {
          m.add(new THREE.Mesh(G.sphere(0.07, 10, 8), mat(0xffe08a, { emissive: 0xffc040, ei: 4 })));
        } else if (p.kind === 'grenade' || p.kind === 'cluster') {
          m.add(new THREE.Mesh(G.sphere(p.kind === 'cluster' ? 0.05 : 0.08, 10, 8), mat(0x3d5226, { rough: 0.5 })));
        } else if (p.kind === 'bomb') {
          m.add(new THREE.Mesh(G.cap(0.05, 0.08, 8), mat(0x222222, { metal: 0.5 })));
        }
        m.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(m); this.projs.set(p.id, m);
      }
      if (p.kind === 'missile' && p.delay > 0) { m.visible = false; continue; }
      m.visible = true;
      const prev = v3b.copy(m.position);
      toWorld(p.x, p.y, m.position); m.position.y = (p.h || 0.5) + terrainHeight(p.x, p.y);
      if (p.kind === 'missile' || p.kind === 'shell') {
        const dir = v3.copy(m.position).sub(prev);
        if (dir.lengthSq() > 1e-6) m.lookAt(v3.copy(m.position).add(dir));
        if (p.kind === 'missile') {
          this.fx.glow.spawn({ x: prev.x, y: prev.y, z: prev.z, life: 0.15, size: 0.3, size1: 0.05, r: 2.4, g: 1.3, b: 0.4, a: 1 });
          this.fx.smoke.spawn({ x: prev.x, y: prev.y, z: prev.z, vy: 0.3, life: 0.8, size: 0.15, size1: 0.6, r: 0.55, g: 0.55, b: 0.58, a: 0.5, a1: 0 });
        }
      } else m.rotation.x += dt * 10;
    }
    for (const [id, m] of this.projs) if (!seen.has(id)) { this.scene.remove(m); this.projs.delete(id); }
  }

  // ---------------- continuous effects ----------------
  continuous(game, dt, t) {
    // attackers slamming into a bunker (0.35 s leap, then a puff)
    if (this.hitters?.length) {
      for (const h of this.hitters) {
        h.t += dt; const k = Math.min(1, h.t / 0.35);
        h.m.root.position.lerpVectors(h.from, h.to, k);
        h.m.root.position.y = h.from.y + Math.sin(k * Math.PI) * 0.7;
        h.m.root.rotation.x = k * 0.9;
        h.m.root.scale.setScalar(h.s0 * (k < 0.85 ? 1 : 1 - (k - 0.85) * 5));
        if (k >= 1 && !h.done) { h.done = true; this.scene.remove(h.m.root); this.fx.dust(h.to.clone().setY(0.6), [0.5, 0.46, 0.42], 8, 1); this.fx.sparks(h.to.clone().setY(0.8), [2, 1.4, 0.6], 6); }
      }
      this.hitters = this.hitters.filter(h => !h.done);
    }
    // bunker shield bubbles
    for (let s = 0; s < 2; s++) {
      const b = this.stage.bunkers[s], p = game.players[s];
      const on = p.shieldHp > 0 && p.shieldUntil > game.t;
      if (on && !b.bubble) {
        b.bubble = new THREE.Mesh(new THREE.SphereGeometry(2.0, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
        b.bubble.scale.set(1, 0.8, 1.15); b.group.add(b.bubble);
      }
      if (b.bubble) { b.bubble.visible = on; if (on) b.bubble.material.opacity = 0.12 + Math.sin(t * 4) * 0.04 + 0.06 * Math.min(1, p.shieldHp / 10); }
    }
    // frozen undead shed ice sparkles
    for (const u of game.units) if (u.frozen && Math.random() < 0.15) { toWorld(u.x, u.y, v3); v3.y = 0.5; this.fx.sparks(v3, [1.2, 1.8, 2.2], 1); }
    for (const u of game.units) {
      if (u.burnT > 0 && Math.random() < 0.6) { const m = this.units.get(u.id); if (m) { v3.copy(m.root.position); v3.y += 0.3 + Math.random() * 0.4; this.fx.fire(v3, 0.28); } }
      if (u.flying === false && u.type === 'dragon') { /* noop */ }
    }
    for (const gr of game.grounds) if (Math.random() < 0.8) { this.unitWorld(gr.x + (Math.random() - 0.5) * 1.2, gr.y + (Math.random() - 0.5) * 1.2, 0.05, v3); this.fx.fire(v3, 0.35); }
    for (let s = 0; s < 2; s++) for (let l = 0; l < 3; l++) {
      if (game.fogUntil[s][l] > game.t) {
        const lane = LANES[s][l];
        for (let k = 0; k < 3; k++) {
          lanePoint(lane, Math.random() * lane.length, lp);
          this.unitWorld(lp.x + (Math.random() - 0.5), lp.y + (Math.random() - 0.5), 0.3, v3);
          this.fx.smoke.spawn({ x: v3.x, y: v3.y, z: v3.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.1, life: 1.6, size: 1.2, size1: 2.2, r: 0.62, g: 0.66, b: 0.75, a: 0.0, a1: 0.0, spinV: 0.3 });
          const q = this.fx.smoke.p[this.fx.smoke.p.length - 1]; q.a = 0.55; q.a1 = 0;
        }
      }
    }
    // bunker damage visuals
    for (const b of this.stage.bunkers) {
      const p = game.players[b.side];
      const frac = p.bunkerHp / p.bunkerMax;
      const nCr = Math.ceil((1 - frac) * b.cracks.length);
      b.cracks.forEach((c, k) => c.visible = k < nCr);
      b.hitShake = Math.max(0, (b.hitShake || 0) - dt * 4);
      if (!b.dead) b.body.position.x = Math.sin(t * 60) * b.hitShake * 0.08;
      toWorld(b.x, b.y, v3); v3.y = 1.4;
      if (frac < 0.65 && Math.random() < (1 - frac) * 0.5) this.fx.smoke.spawn({ x: v3.x + (Math.random() - 0.5) * 1.6, y: v3.y, z: v3.z + (Math.random() - 0.5) * 2, vy: 0.8 + Math.random() * 0.5, vx: 0.2, life: 2.2, size: 0.5, size1: 1.8, r: 0.12, g: 0.12, b: 0.13, a: 0.55, a1: 0 });
      if (frac < 0.35 && Math.random() < 0.6) { v3.x += (Math.random() - 0.5) * 1.6; v3.z += (Math.random() - 0.5) * 2; v3.y = 1.1; this.fx.fire(v3, 0.5); }
      if (b.dead) {
        b.body.position.y = Math.max(-1.6, b.body.position.y - dt * 0.9); b.body.rotation.z += dt * 0.08 * (b.side ? 1 : -1);
        if (Math.random() < 0.5) this.fx.dust(v3, [0.4, 0.38, 0.36], 1, 1.6);
        if (Math.random() < 0.7) { const f = toWorld(b.x + (Math.random() - 0.5) * 2, b.y + (Math.random() - 0.5) * 2.4, v3b); f.y = 0.4; this.fx.fire(f, 0.55); }
        if (Math.random() < 0.5) this.fx.smoke.spawn({ x: v3.x + (Math.random() - 0.5) * 2, y: 0.8, z: v3.z + (Math.random() - 0.5) * 2, vy: 1.2, vx: 0.25, life: 3, size: 0.8, size1: 2.6, r: 0.1, g: 0.1, b: 0.1, a: 0.6, a1: 0 });
        for (const f of b.flying || []) {
          if (!f.o.visible) continue;
          f.v.y -= 14 * dt;
          f.o.position.addScaledVector(f.v, dt / 1.3);
          f.o.rotation.x += f.spin.x * dt; f.o.rotation.y += f.spin.y * dt; f.o.rotation.z += f.spin.z * dt;
          if (f.o.position.y < -0.5 && f.v.y < 0) { f.o.visible = false; const w = new THREE.Vector3(); f.o.getWorldPosition(w); w.y = 0.2; this.fx.dust(w, [0.45, 0.42, 0.4], 8, 1.2); }
        }
      }
    }
  }

  // ---------------- events ----------------
  processEvents(game) {
    const ev = game.events;
    const a = this.sound;
    for (const e of ev) {
      switch (e.type) {
        case 'send': {
          const g = this.stage.gates[e.side][e.lane];
          v3.copy(g.group.position); v3.y = 0.1;
          this.fx.ring(v3, 0.3, 1.6, e.owner === 0 ? 0x4dabff : 0xff4d6a, 0.5);
          this.fx.greenPuff(v3, 0.7);
          a.play('gate', { pan: panOf(g.x) });
          if (Math.random() < 0.6) a.play('groan', { pan: panOf(g.x), unit: e.unit });
          break;
        }
        case 'place': {
          toWorld(e.def.x, e.def.y, v3);
          this.fx.dust(v3, [0.5, 0.45, 0.4], 10, 0.8);
          this.fx.ring(v3, 0.2, 0.9, e.def.side === 0 ? 0x66aaff : 0xff6677, 0.4);
          a.play('place', { pan: panOf(e.def.x) });
          break;
        }
        case 'upgrade': {
          toWorld(e.def.x, e.def.y, v3); v3.y = 0.5;
          for (let k = 0; k < 20; k++) this.fx.glow.spawn({ x: v3.x + (Math.random() - 0.5) * 0.6, y: v3.y + Math.random() * 0.3, z: v3.z + (Math.random() - 0.5) * 0.6, vy: 1.5 + Math.random() * 2, life: 0.8, size: 0.12, size1: 0, r: 2, g: 1.6, b: 0.5, a: 1 });
          this.fx.ring(v3.setY(0.08), 0.3, 1.1, 0xffd23a, 0.5);
          const m = this.defs.get(e.def.id); if (m) m.age = 0.1;
          a.play('upgrade');
          break;
        }
        case 'sell': { toWorld(e.def.x, e.def.y, v3); this.fx.dust(v3, [0.5, 0.45, 0.4], 12, 1); a.play('sell'); break; }
        case 'shot': this.onShot(e, game); break;
        case 'slash': {
          const m = this.defs.get(e.def.id);
          if (m) { m.swing = 1; if (e.whirl) m.whirl = 1; }
          this.unitWorld(e.x, e.y, 0.5, v3);
          for (let k = 0; k < 6; k++) this.fx.glow.spawn({ x: v3.x, y: v3.y, z: v3.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 3, life: 0.18, size: 0.14, size1: 0.02, r: 1.6, g: 1.9, b: 2.2, a: 1 });
          if (e.whirl) { toWorld(e.def.x, e.def.y, v3b); v3b.y = 0.3; this.fx.ring(v3b, 0.3, 1.6, 0xbfe8ff, 0.25); }
          a.play('sword', { pan: panOf(e.def.x) });
          break;
        }
        case 'flame': {
          this.muzzleWorld(e.def, v3);
          this.unitWorld(e.x, e.y, 0.4, v3b);
          this.fx.flameStream(v3, v3b, e.range);
          a.play('flame', { pan: panOf(e.def.x) });
          break;
        }
        case 'explosion': {
          this.unitWorld(e.x, e.y, 0.05, v3);
          if (e.kind === 'missile' || e.kind === 'airstrike') { this.fx.explosion(v3, e.kind === 'airstrike' ? 1.0 : e.r * 0.8, e.kind === 'airstrike'); this.stage.addShake(e.kind === 'airstrike' ? 0.18 : 0.14); a.play('boom', { pan: panOf(e.x), big: true }); }
          else if (e.kind === 'shell') { this.fx.explosion(v3, 0.45); this.stage.addShake(0.08); a.play('boom', { pan: panOf(e.x) }); }
          else if (e.kind === 'grenade' || e.kind === 'bomb') { this.fx.explosion(v3, e.r * 0.6); this.stage.addShake(0.05); a.play('boom', { pan: panOf(e.x), small: true }); }
          else { this.fx.explosion(v3, 0.35); a.play('boom', { pan: panOf(e.x), small: true }); }
          break;
        }
        case 'dmg': {
          const m = this.units.get(e.unit.id);
          if (m) m.squash = 1;
          if (this.textBudget >= 1) { this.textBudget -= 1; this.unitWorld(e.x, e.y, 0.2, v3); this.fx.text(v3, '-' + fmt(e.amt), 'dmg'); }
          break;
        }
        case 'blocked': {
          this.unitWorld(e.x, e.y, 0.6, v3); this.fx.sparks(v3, [1.8, 1.8, 2.0], 4);
          if (this.textBudget >= 1) { this.textBudget -= 1; this.fx.text(v3, 'ARMOUR', 'blocked'); }
          a.play('clang', { pan: panOf(e.x) });
          break;
        }
        case 'shieldHit': {
          this.unitWorld(e.x, e.y, 0.5, v3); for (let k = 0; k < 3; k++) this.fx.chunk(v3, 0x9aa0ad, 2);
          this.fx.text(v3, 'SHIELD', 'blocked');
          a.play('clang', { pan: panOf(e.x), stone: true });
          break;
        }
        case 'kill': this.onKill(e); break;
        case 'raise': {
          this.unitWorld(e.x, e.y, 0.05, v3);
          this.fx.ring(v3, 0.2, 1.0, 0x5cff7a, 0.6);
          for (let k = 0; k < 20; k++) { const ang = k / 20 * Math.PI * 4; this.fx.glow.spawn({ x: v3.x + Math.cos(ang) * 0.4, y: v3.y + k * 0.04, z: v3.z + Math.sin(ang) * 0.4, vy: 1.2, life: 0.8, size: 0.14, size1: 0, r: 0.4, g: 2, b: 0.6, a: 1 }); }
          this.fx.text(v3, 'RISEN!', 'risen');
          a.play('raise', { pan: panOf(e.x) });
          break;
        }
        case 'bunkerHit': {
          const b = this.stage.bunkers[e.side];
          // the attacker leaps and slams into the bunker wall instead of just vanishing
          const um = e.unit && this.units.get(e.unit.id);
          if (um) {
            this.units.delete(e.unit.id); this.scene.remove(um.hb);
            const face = e.side === 0 ? 1 : -1;
            const to = toWorld(b.x + face * 1.15, b.y + (um.root.position.z - toWorld(b.x, b.y, v3b).z) * 0.4 / 1, new THREE.Vector3());
            to.z = THREE.MathUtils.clamp(um.root.position.z, toWorld(b.x, b.y, v3b).z - 1.2, v3b.z + 1.2);
            (this.hitters ??= []).push({ m: um, t: 0, from: um.root.position.clone(), to, s0: um.root.scale.x });
          }
          b.hitShake = 1;
          toWorld(b.x, b.y, v3); v3.y = 0.6;
          this.fx.explosion(v3.set(v3.x + (e.side === 0 ? 1 : -1), 0.4, v3.z + (Math.random() - 0.5) * 1.5), 0.6);
          this.fx.text(v3.setY(1.6), '-' + fmt(e.dmg), 'bunker');
          if (e.side === 0) { this.stage.addShake(0.25); this.onPlayerBunkerHit && this.onPlayerBunkerHit(e); }
          else { this.stage.addShake(0.06); this.fx.text(v3.setY(2.2), '+' + fmt(e.reward), 'bounty'); }
          a.play('bunker', { pan: panOf(b.x), mine: e.side === 0 });
          break;
        }
        case 'sabotage': {
          if (e.id === 'emp') {
            toWorld(e.enemy === 1 ? W - HALF / 2 : HALF / 2, H / 2, v3); v3.y = 0.2;
            this.fx.ring(v3, 0.5, 11, 0x66ccff, 0.9, 1);
            this.fx.ring(v3, 0.5, 8, 0xaaddff, 0.7, 1);
            this.stage.addShake(0.12);
          } else if (e.id === 'fog') {
            /* continuous */
          } else if (e.id === 'vigor') {
            for (const u of game.units) if (u.owner === e.side && !u.neutral && u.alive) { toWorld(u.x, u.y, v3); v3.y = 0.4; this.fx.greenPuff(v3, 0.5); }
          } else if (e.id === 'warcry') {
            for (const d of game.defenders) if (d.side === e.side) { toWorld(d.x, d.y, v3); v3.y = 0.1; this.fx.ring(v3, 0.2, 1.0, 0xffc040, 0.6); }
          } else if (e.id === 'freeze') {
            const lane = LANES[e.side][e.lane];
            for (let dd = 0; dd < lane.length; dd += 1.2) { const pt = lanePoint(lane, dd); toWorld(pt.x, pt.y, v3); v3.y = 0.1; this.fx.ring(v3, 0.1, 0.8, 0x9be8ff, 0.7); }
          } else if (e.id === 'flare') {
            for (let k = 0; k < 4; k++) { toWorld(e.side === 0 ? 3 + k * 3.5 : W - 3 - k * 3.5, 4 + (k % 2) * 10, v3); v3.y = 4; this.fx.ring(v3.setY(0.1), 0.5, 5, 0xfff2a0, 1.2); for (let j = 0; j < 12; j++) this.fx.glow.spawn({ x: v3.x, y: 3 + Math.random(), z: v3.z, vx: (Math.random() - 0.5) * 2, vy: -0.4, vz: (Math.random() - 0.5) * 2, life: 2.5, size: 0.35, size1: 0.1, r: 3, g: 2.6, b: 1.2, a: 1 }); }
          } else if (e.id === 'shield') {
            const b = this.stage.bunkers[e.side]; v3.copy(b.group.position); v3.y = 0.2; this.fx.ring(v3, 0.5, 2.6, 0x66ccff, 0.8);
          } else if (e.id === 'raise') {
            const g = this.stage.gates[e.enemy];
            for (const gg of g) { v3.copy(gg.group.position); this.fx.ring(v3.setY(0.1), 0.3, 1.8, 0x5cff7a, 0.8); }
          }
          a.play(e.id);
          break;
        }
        case 'airstrike': a.play('siren'); break;
        case 'shieldBlock': { const b = this.stage.bunkers[e.side]; v3.copy(b.group.position); v3.y = 1.2; this.fx.ring(v3, 1.2, 2.2, 0x66ccff, 0.5); a.play('clang', { pan: panOf(b.x) }); break; }
        case 'bunkerShot': {
          const from = toWorld(e.x + (e.side === 0 ? 1.1 : -1.1), e.y, new THREE.Vector3()); from.y = 1.5;
          const to = toWorld(e.tx, e.ty, new THREE.Vector3()); to.y = 0.4;
          const bk = this.stage.bunkers[e.side]; if (bk?.turretHead) bk.turretHead.rotation.y = -Math.atan2(e.ty - e.y, e.tx - e.x) + (e.side === 0 ? 0 : Math.PI);
          this.fx.muzzle(from, [1, 0.85, 0.5], 0.4); this.fx.tracer(from, to, 0xffe08a, 0.022, 0.08); this.fx.sparks(to, [1.6, 1.2, 0.6], 3);
          a.play('rifle', { pan: panOf(e.x) });
          break;
        }
        case 'wave': if (this.onWave) this.onWave(e); break;
        case 'boss': {
          const big = e.units.some(([t]) => ['dragon', 'abom', 'lich'].includes(t));
          a.play('horn');
          if (big) this.sound.setIntensity(2);
          if (this.onBoss) this.onBoss(e, big);
          break;
        }
        case 'summon': { toWorld(e.x, e.y, v3); v3.y = 0.2; this.fx.ring(v3, 0.1, 0.7, 0x5cff7a, 0.5); a.play('raise', { pan: panOf(e.x) }); break; }
        case 'gameover': this.onGameOver(e, game); break;
      }
    }
    ev.length = 0;
  }

  onShot(e, game) {
    const a = this.sound;
    const from = this.muzzleWorld(e.def, new THREE.Vector3());
    const to = this.unitWorld(e.x1, e.y1, 0.45, new THREE.Vector3());
    const pan = panOf(e.x0);
    switch (e.weapon) {
      case 'rifle': this.fx.muzzle(from); this.fx.tracer(from, to, 0xffd27a, 0.016); this.fx.sparks(to, [1.6, 1.2, 0.6], 2); a.play('rifle', { pan }); break;
      case 'mg': this.fx.muzzle(from, [1, 0.8, 0.4], 0.28); this.fx.tracer(from, to, 0xffc860, 0.014, 0.05); if (Math.random() < 0.5) this.fx.sparks(to, [1.6, 1.2, 0.6], 1); a.play('mg', { pan }); break;
      case 'sniper': this.fx.muzzle(from, [1, 0.9, 0.7], 0.6); this.fx.tracer(from, to, 0xbfe8ff, 0.03, 0.2); this.fx.sparks(to, [1.8, 1.8, 2], 6); a.play('sniper', { pan }); break;
      case 'drone': this.fx.tracer(from, to, 0xff6060, 0.014, 0.08); this.fx.muzzle(from, [1, 0.4, 0.4], 0.2); a.play('drone', { pan }); break;
      case 'grenade': this.fx.muzzle(from, [1, 0.8, 0.5], 0.4); this.fx.smoke.spawn({ x: from.x, y: from.y, z: from.z, vy: 0.5, life: 0.6, size: 0.2, size1: 0.6, r: 0.6, g: 0.6, b: 0.6, a: 0.5, a1: 0 }); a.play('thump', { pan }); break;
      case 'tank': this.fx.muzzle(from, [1, 0.8, 0.4], 0.9); for (let k = 0; k < 6; k++) this.fx.smoke.spawn({ x: from.x, y: from.y, z: from.z, vx: (Math.random() - 0.5), vy: 0.4, vz: (Math.random() - 0.5), life: 0.9, size: 0.3, size1: 0.9, r: 0.5, g: 0.5, b: 0.5, a: 0.6, a1: 0 }); this.stage.addShake(0.05); a.play('cannon', { pan }); break;
      case 'missile': this.fx.muzzle(from, [1, 0.7, 0.4], 0.6); a.play('missile', { pan }); break;
    }
  }

  onKill(e) {
    const u = e.unit;
    const m = this.units.get(u.id);
    const p = m ? m.root.position.clone() : this.unitWorld(u.x, u.y, 0, new THREE.Vector3());
    const c = CONFIG.undead[u.type];
    p.y = Math.max(p.y, 0) + (u.flying ? 0.7 : 0);
    switch (u.type) {
      case 'skeleton': this.fx.bones(p, 7); this.fx.greenPuff(p, 0.6); break;
      case 'dragon': for (let k = 0; k < 4; k++) this.fx.bones(p, 10); this.fx.greenPuff(p, 2.2); this.fx.ring(p.clone().setY(0.1), 0.5, 3, 0x5cff7a, 0.8); this.stage.addShake(0.3); break;
      case 'gargoyle': case 'golem': this.fx.dust(p, [0.55, 0.56, 0.6], 16, 1.2); for (let k = 0; k < 8; k++) this.fx.chunk(p, u.type === 'golem' ? 0x59606b : 0x8a8f9c, 3); this.fx.greenPuff(p, 0.5); break;
      case 'pumpkin': case 'imp': for (let k = 0; k < (u.type === 'imp' ? 4 : 10); k++) this.fx.chunk(p, 0xf0821e, 3); this.fx.greenPuff(p, u.type === 'imp' ? 0.4 : 0.8); break;
      case 'ghost': for (let k = 0; k < 16; k++) this.fx.glow.spawn({ x: p.x, y: p.y + 0.5, z: p.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2, life: 0.9, size: 0.3, size1: 0, r: 0.8, g: 1.6, b: 2.2, a: 0.9 }); break;
      case 'mummy': for (let k = 0; k < 6; k++) this.fx.chunk(p, 0xd8c79e, 2.5); this.fx.dust(p, [0.7, 0.62, 0.45], 10); this.fx.greenPuff(p, 0.6); break;
      case 'bats': this.fx.greenPuff(p, 0.35); for (let k = 0; k < 3; k++) this.fx.chunk(p, 0x40304f, 1.5); break;
      default: this.fx.greenPuff(p, 0.9); this.fx.bones(p, 4);
    }
    if (u.side === 0) { this.fx.text(p, '+' + fmt(e.reward), 'bounty'); }
    this.sound.play(u.type === 'gargoyle' || u.type === 'golem' ? 'crumble' : u.type === 'ghost' ? 'wail' : 'rattle', { pan: panOf(u.x) });
    void c;
  }

  onGameOver(e, game) {
    const loser = e.winner === 0 ? 1 : e.winner === 1 ? 0 : -1;
    if (loser < 0) return;
    const b = this.stage.bunkers[loser];
    b.dead = true;
    const c = toWorld(b.x, b.y, new THREE.Vector3());
    const P = (dx, dz, y = 0.6) => new THREE.Vector3(c.x + dx, y, c.z + dz);
    // 1) the big blast: fireball, flash, shockwaves, flying concrete
    this.fx.explosion(P(0, 0, 0.9), 2.8, true);
    this.fx.explosion(P(0.4, -0.5, 1.4), 1.8, true);
    for (const [r0, r1, col, life] of [[0.5, 7, 0xffd27a, 0.9], [0.3, 4.5, 0xff8a3a, 0.7], [0.8, 9, 0xffffff, 0.5]]) this.fx.ring(P(0, 0, 0.15), r0, r1, col, life);
    for (let k = 0; k < 46; k++) this.fx.chunk(P((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2.6, 1 + Math.random()), [0.55, 0.56, 0.52], 7);
    this.fx.dust(P(0, 0, 0.5), [0.45, 0.42, 0.4], 40, 3);
    this.stage.addShake(1.1);
    this.sound.play('boom', { big: true, pan: panOf(b.x) });
    this.sound.play('bunker', { pan: panOf(b.x) });
    // 2) roof, dome, flag and antenna get thrown into the air
    b.flying = [];
    for (const o of b.body.children) {
      if (o.position.y < 0.95 || o === b.turret) continue;
      o.userData.orig ??= { p: o.position.clone(), r: o.rotation.clone(), v: o.visible };
      const dir = new THREE.Vector3(o.position.x + (Math.random() - 0.5), 0, o.position.z + (Math.random() - 0.5)).normalize();
      b.flying.push({ o, v: new THREE.Vector3(dir.x * (2 + Math.random() * 3), 6 + Math.random() * 4, dir.z * (2 + Math.random() * 3)), spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3) });
    }
    if (b.turret?.visible) { b.turret.userData.orig ??= { p: b.turret.position.clone(), r: b.turret.rotation.clone(), v: true }; b.flying.push({ o: b.turret, v: new THREE.Vector3((Math.random() - 0.5) * 4, 8, (Math.random() - 0.5) * 4), spin: new THREE.Vector3(4, 2, 3) }); }
    // 3) chain explosions, then a burning rubble pile
    for (let k = 1; k <= 7; k++) setTimeout(() => {
      this.fx.explosion(P((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.8, 0.4 + Math.random() * 0.6), 0.9 + Math.random() * 0.8, true);
      this.stage.addShake(0.3);
      this.sound.play('boom', { big: k % 2 === 0, pan: panOf(b.x) });
    }, k * 190);
    setTimeout(() => this.buildRubble(b), 700);
  }
  buildRubble(b) {
    if (!b.dead || b.rubble) return;
    const g = new THREE.Group();
    const conc = [mat(0x7e817a, { rough: 0.95, flat: true }), mat(0x5e615b, { rough: 0.95, flat: true }), mat(0x3a3a38, { rough: 1, flat: true })];
    for (let k = 0; k < 26; k++) {
      const s = 0.18 + Math.random() * 0.4;
      const m = new THREE.Mesh(G.dodeca(1), conc[k % 3]);
      m.scale.set(s * (1 + Math.random()), s * 0.6, s * (1 + Math.random()));
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
      m.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r * 1.2);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    for (let k = 0; k < 5; k++) { const bar = new THREE.Mesh(G.cyl(0.02, 0.02, 0.9, 5), mat(0x5a3a2a, { metal: 0.6, rough: 0.5 })); bar.position.set((Math.random() - 0.5) * 2, 0.35, (Math.random() - 0.5) * 2); bar.rotation.set(Math.random() - 0.5, 0, Math.random() * 1.2 - 0.6); g.add(bar); }
    b.group.add(g); b.rubble = g;
  }
}

function waveFlag(flag, t) {
  const pos = flag.geometry.attributes.position, base = flag.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const w = (x + 0.4) * 1.2;
    pos.setZ(i, Math.sin(x * 9 - t * 6) * 0.05 * w);
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
}
function lerpAngle(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; }
function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
function panOf(x) { return Math.max(-0.9, Math.min(0.9, (x - W / 2) / (W / 2))); }
function fmt(n) { return n >= 10 ? Math.round(n) : (Math.round(n * 10) / 10).toString(); }
export { MACHINES };
