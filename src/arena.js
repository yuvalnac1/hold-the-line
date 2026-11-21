// Arena layout in tile units. x: 0..W (left→right), y: 0..H (top→bottom).
// Side 0 = player (left half), side 1 = computer (right half, mirror of the left).

export const W = 38;
export const H = 18;
export const HALF = 16;          // width of each battlefield
export const GRAVE_L = HALF;     // graveyard strip x from 16..22
export const GRAVE_R = W - HALF;

// Five arenas. Each has its own lane layout for the left half (mirrored for the right), plus
// "blocked" rectangles (water / lava) where nothing can be built — so tactics differ per arena.
// Lanes run from the gate (graveyard edge, x≈16.6) to the bunker.
export const ARENAS = [
  { id: 'graveyard', name: 'Haunted Fields', unlock: 1, desc: 'Classic battlefield. One long, one short, one medium lane.',
    lanes: [
      [[16.6, 2.5], [12.5, 2.5], [12.5, 6], [9, 6], [9, 1.5], [5, 1.5], [5, 5], [2, 5], [2, 7.6]],
      [[16.6, 9], [12.5, 9], [12.5, 11], [7.5, 11], [7.5, 9], [3.1, 9]],
      [[16.6, 15.5], [14, 15.5], [14, 13.5], [9.5, 13.5], [9.5, 16.3], [4.5, 16.3], [4.5, 13], [2, 13], [2, 10.4]],
    ], blocked: [] },
  { id: 'winter', name: 'Frozen Front', unlock: 3, desc: 'Icy switchbacks — long lanes reward splash and range.',
    lanes: [
      [[16.6, 3], [13, 3], [13, 1.4], [6, 1.4], [6, 4.5], [2, 4.5], [2, 7.6]],
      [[16.6, 9], [14, 9], [14, 6.6], [9.5, 6.6], [9.5, 9], [3.1, 9]],
      [[16.6, 14], [11, 14], [11, 16.4], [6.5, 16.4], [6.5, 12], [2, 12], [2, 10.4]],
    ], blocked: [{ x: 2.6, y: 13.6, w: 2.6, h: 2.6 }] },
  { id: 'desert', name: 'Dune Outpost', unlock: 5, desc: 'Long straight runs — fast undead, few corners to cover.',
    lanes: [
      [[16.6, 1.8], [8, 1.8], [8, 5.5], [2, 5.5], [2, 7.6]],
      [[16.6, 8.5], [13, 8.5], [13, 11.6], [9.5, 11.6], [9.5, 7.5], [5.5, 7.5], [5.5, 9], [3.1, 9]],
      [[16.6, 16], [4.5, 16], [4.5, 12.5], [2, 12.5], [2, 10.4]],
    ], blocked: [{ x: 10, y: 13.2, w: 3.5, h: 1.6 }] },
  { id: 'naval', name: 'Harbour Siege', unlock: 7, desc: 'Docks over open water — fewer build spots, plan every one.',
    lanes: [
      [[16.6, 4], [11, 4], [11, 1.5], [4, 1.5], [4, 6], [2, 6], [2, 7.6]],
      [[16.6, 9], [12, 9], [12, 7], [7, 7], [7, 9], [3.1, 9]],
      [[16.6, 13], [13, 13], [13, 16.3], [8, 16.3], [8, 12.5], [2, 12.5], [2, 10.4]],
    ], blocked: [{ x: 5.4, y: 2.9, w: 4.1, h: 2.6 }, { x: 9, y: 10.4, w: 3, h: 3.2 }, { x: 13.6, y: 5.3, w: 2.4, h: 2.4 }] },
  { id: 'volcano', name: 'Ember Peaks', unlock: 9, desc: 'Lava pools split the field — the middle lane twists toward your bunker.',
    lanes: [
      [[16.6, 2.5], [10, 2.5], [10, 5], [6.5, 5], [6.5, 2], [2, 2], [2, 7.6]],
      [[16.6, 10], [12, 10], [12, 7.5], [8.5, 7.5], [8.5, 10.5], [5, 10.5], [5, 9], [3.1, 9]],
      [[16.6, 15], [13, 15], [13, 13], [9.5, 13], [9.5, 16.3], [4, 16.3], [4, 13], [2, 13], [2, 10.4]],
    ], blocked: [{ x: 13.2, y: 4, w: 2.6, h: 3.2 }, { x: 5.4, y: 12, w: 3, h: 3 }] },
];
export let ARENA = ARENAS[0];

export const LANE_NAMES = ['Top', 'Middle', 'Bottom'];

export const BUNKER = [
  { x: 1.65, y: 9, w: 2.7, h: 3.2 },
  { x: W - 1.65, y: 9, w: 2.7, h: 3.2 },
];

function mirror(pts) { return pts.map(([x, y]) => [W - x, y]); }

function buildLane(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, len, start: total, dx: (bx - ax) / len, dy: (by - ay) / len });
    total += len;
  }
  return { pts, segs, length: total };
}

// lanes[side][laneIdx] — the lane on `side`'s half (walked by the OTHER side's undead).
// These arrays are filled in place by setArena() so every importer sees the current arena.
export const LANES = [[], []];
export const BLOCKED = [[], []];   // per side: rects {x, y, w, h} (x/y = top-left corner, tiles)

export function lanePoint(lane, d, out = {}) {
  if (d <= 0) { const s = lane.segs[0]; out.x = s.ax; out.y = s.ay; out.dx = s.dx; out.dy = s.dy; return out; }
  for (const s of lane.segs) {
    if (d <= s.start + s.len) {
      const t = d - s.start;
      out.x = s.ax + s.dx * t; out.y = s.ay + s.dy * t; out.dx = s.dx; out.dy = s.dy;
      return out;
    }
  }
  const s = lane.segs[lane.segs.length - 1];
  out.x = s.bx; out.y = s.by; out.dx = s.dx; out.dy = s.dy;
  return out;
}

export function distToLane(lane, x, y) {
  let best = Infinity;
  for (const s of lane.segs) {
    const px = x - s.ax, py = y - s.ay;
    let t = px * s.dx + py * s.dy;
    t = Math.max(0, Math.min(s.len, t));
    const qx = s.ax + s.dx * t - x, qy = s.ay + s.dy * t - y;
    const d = Math.hypot(qx, qy);
    if (d < best) best = d;
  }
  return best;
}

// Gates: start of each lane. gates[side] are on `side`'s half and are where
// the OTHER player drops undead ("their" crypt gates).
export const GATES = [[], []];

export function sideOfX(x) { return x < W / 2 ? 0 : 1; }

export const inBlocked = (side, x, y, pad = 0) => BLOCKED[side].some(r => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad);

// Buildable tiles for each side.
export const BUILD_TILES = [[], []];
function computeTiles() {
  for (let side = 0; side < 2; side++) {
    BUILD_TILES[side].length = 0;
    const x0 = side === 0 ? 0 : W - HALF;
    for (let i = 0; i < HALF; i++) {
      for (let j = 0; j < H; j++) {
        const cx = x0 + i + 0.5, cy = j + 0.5;
        let ok = true;
        for (const lane of LANES[side]) if (distToLane(lane, cx, cy) < 0.95) { ok = false; break; }
        const b = BUNKER[side];
        if (Math.abs(cx - b.x) < b.w / 2 + 0.6 && Math.abs(cy - b.y) < b.h / 2 + 0.6) ok = false;
        if (cy < 0.6 || cy > H - 0.6) ok = false;
        if (ok && inBlocked(side, cx, cy, 0.15)) ok = false;
        if (ok) BUILD_TILES[side].push({ i: x0 + i, j, x: cx, y: cy });
      }
    }
  }
}

const tileKey = (i, j) => i * 100 + j;
const BUILD_SET = [new Set(), new Set()];

export function tileAt(x, y) { return { i: Math.floor(x), j: Math.floor(y) }; }
export function isBuildable(side, i, j) { return BUILD_SET[side].has(tileKey(i, j)); }
export { tileKey };

// Path samples per lane, used for coverage calculations by the AI.
export const LANE_SAMPLES = [[], []];

// Lane length words for tooltips (short / medium / long) — relative within the arena.
export const LANE_LEN_WORD = ['', '', ''];

export function setArena(id) {
  ARENA = ARENAS.find(a => a.id === id) || ARENAS[0];
  for (let side = 0; side < 2; side++) {
    const pts = side === 0 ? ARENA.lanes : ARENA.lanes.map(mirror);
    LANES[side].length = 0; LANES[side].push(...pts.map(buildLane));
    BLOCKED[side].length = 0;
    BLOCKED[side].push(...ARENA.blocked.map(r => side === 0 ? { ...r } : { ...r, x: W - r.x - r.w }));
    GATES[side].length = 0; GATES[side].push(...LANES[side].map(l => ({ x: l.pts[0][0], y: l.pts[0][1] })));
    LANE_SAMPLES[side].length = 0;
    LANE_SAMPLES[side].push(...LANES[side].map(l => {
      const out = [];
      for (let d = 0.5; d < l.length; d += 0.75) { const p = lanePoint(l, d); out.push({ x: p.x, y: p.y, d }); }
      return out;
    }));
  }
  computeTiles();
  for (let side = 0; side < 2; side++) { BUILD_SET[side].clear(); for (const t of BUILD_TILES[side]) BUILD_SET[side].add(tileKey(t.i, t.j)); }
  const order = LANES[0].map((l, i) => [l.length, i]).sort((a, b) => a[0] - b[0]);
  order.forEach(([, i], rank) => { LANE_LEN_WORD[i] = ['short', 'medium', 'long'][rank]; });
  return ARENA;
}
setArena('graveyard');
