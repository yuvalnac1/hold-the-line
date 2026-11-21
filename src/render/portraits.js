// Renders each card's 3D model once into a portrait image for the card UI.
import * as THREE from 'three';
import { buildUndead, buildDefender, buildSabotageIcon } from './models.js';
import { cardKind, ALL_CARDS } from '../config.js';

export function renderPortraits() {
  const Wd = 200, Ht = 240;
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1.5);
  r.setSize(Wd, Ht, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x3a3030, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(2, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x88ffaa, 1.6); rim.position.set(-3, 2, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, Wd / Ht, 0.1, 50);
  const out = {};
  for (const id of [...ALL_CARDS, 'dragon']) {
    if (out[id]) continue;
    const kind = cardKind(id);
    const m = kind === 'undead' ? buildUndead(id) : kind === 'defender' ? buildDefender(id, 0, 0) : buildSabotageIcon(id);
    const root = m.root;
    if (kind === 'undead') {
      // remove ground offset for flyers
      root.rotation.y = 0.5;
    } else if (kind === 'defender') root.rotation.y = 0.6;
    scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const dim = Math.max(size.y * 1.0, size.x * 0.95, size.z * 0.8);
    const dist = dim / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.12;
    cam.position.set(c.x + dist * 0.25, c.y + dist * 0.32, c.z + dist * 0.92);
    cam.lookAt(c.x, c.y - size.y * 0.02, c.z);
    r.render(scene, cam);
    out[id] = canvas.toDataURL('image/png');
    scene.remove(root);
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}
