// Headless AI-vs-AI balance check: node tools/balance.mjs [matches] [pool:starter|all]
import { Game } from '../src/sim.js';
import { AI, aiPickHand } from '../src/ai.js';
import { ALL_CARDS, STARTER_UNLOCKS, UNLOCK_ORDER, applyTuning } from '../src/config.js';
import { readFileSync, existsSync } from 'node:fs';
const tf = new URL('../public/tuning.json', import.meta.url);
if (existsSync(tf)) applyTuning(JSON.parse(readFileSync(tf, 'utf8')));   // same values as the game

const N = +(process.argv[2] || 60);
const poolArg = process.argv[3] || 'mixed';
const diffs = [0.1, 0.45, 0.85];
const results = [];
for (let m = 0; m < N; m++) {
  let pool;
  if (poolArg === 'starter') pool = STARTER_UNLOCKS;
  else if (poolArg === 'all') pool = ALL_CARDS;
  else pool = [...STARTER_UNLOCKS, ...UNLOCK_ORDER.slice(0, Math.floor(Math.random() * (UNLOCK_ORDER.length + 1)))];
  const hands = [aiPickHand(pool), aiPickHand(pool)];
  const d0 = diffs[m % 3], d1 = diffs[Math.floor(m / 3) % 3];
  const g = new Game({ hands, headless: true });
  const ais = [new AI(g, 0, d0), new AI(g, 1, d1)];
  const dt = 1 / 30;
  while (!g.over && g.t < 900) { ais[0].update(dt); ais[1].update(dt); g.update(dt); }
  results.push({ t: g.t, winner: g.winner, reason: g.endReason, d0, d1, hp: g.players.map(p => Math.round(p.bunkerHp)), units: g.units.length, defs: g.defenders.length });
}
const inTarget = results.filter(r => r.reason === 'bunker' && r.t >= 180 && r.t <= 360).length;
const early = results.filter(r => r.t < 180).length;
const timeouts = results.filter(r => r.reason === 'time').length;
const avg = results.reduce((a, r) => a + r.t, 0) / results.length;
console.log(`matches ${N} pool=${poolArg}  avg end ${(avg / 60).toFixed(2)} min`);
console.log(`bunker destroyed 3:00–6:00: ${(100 * inTarget / N).toFixed(0)}%   before 3:00: ${(100 * early / N).toFixed(0)}%   timeouts: ${(100 * timeouts / N).toFixed(0)}%`);
const hist = {};
for (const r of results) { const b = Math.floor(r.t / 30) * 30; hist[b] = (hist[b] || 0) + 1; }
for (const k of Object.keys(hist).sort((a, b) => a - b)) console.log(`${String(Math.floor(k / 60)).padStart(1)}:${String(k % 60).padStart(2, '0')} ${'#'.repeat(hist[k])}`);
const wins = {};
for (const r of results) if (r.winner >= 0) { const w = r.winner === 0 ? r.d0 : r.d1, l = r.winner === 0 ? r.d1 : r.d0; if (w !== l) wins[`${w}>${l}`] = (wins[`${w}>${l}`] || 0) + 1; }
console.log('cross-difficulty wins', wins);
