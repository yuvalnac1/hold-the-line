// Measures how hard the CPU attacks over time (per 30 s window) across many simulated games.
// node tools/surge.mjs [matches]
import { Game } from '../src/sim.js';
import { AI, aiPickHand } from '../src/ai.js';
import { STARTER_UNLOCKS, UNLOCK_ORDER, applyTuning } from '../src/config.js';
import { readFileSync, existsSync } from 'node:fs';
const tf = new URL('../public/tuning.json', import.meta.url);
if (existsSync(tf)) applyTuning(JSON.parse(readFileSync(tf, 'utf8')));
import { CONFIG } from '../src/config.js';
// OLD=1 → approximate the behaviour before the anti-surge changes (for comparison)
if (process.env.OLD) Object.assign(CONFIG.global, { ecoSoftCap: 1e9, lateJitter: 0, bossJitter: 0, paceJitter: 0, aiPressureBase: 1e9, aiOffensiveFirst: 1e9 });
const N = +(process.argv[2] || 40);
const B = 30, maxB = 16;
const spend = Array(maxB).fill(0), dmgCpu = Array(maxB).fill(0), dmgNeutral = Array(maxB).fill(0), alive = Array(maxB).fill(0), push = Array(maxB).fill(0);
let endHist = Array(maxB).fill(0);
for (let m = 0; m < N; m++) {
  const pool = [...STARTER_UNLOCKS, ...UNLOCK_ORDER.slice(0, 6 + (m % 8))];
  const skill = [0.3, 0.5, 0.7][m % 3];
  const g = new Game({ hands: [aiPickHand(pool), aiPickHand([...pool, 'sniper', 'flare'])], headless: false,
    mods: [{ bunkerLevel: 2 }, { bunkerLevel: 2, incomeMult: 0.78 + 0.4 * skill }] });
  const me = new AI(g, 0, 0.5), cpu = new AI(g, 1, skill);
  let lastSpent = 0;
  while (!g.over && g.t < maxB * B) {
    me.update(1 / 30); cpu.update(1 / 30); g.update(1 / 30);
    const b = Math.min(maxB - 1, Math.floor(g.t / B));
    const s = g.players[1].spent.attack; spend[b] += s - lastSpent; lastSpent = s;
    for (const e of g.events) if (e.type === 'bunkerHit' && e.side === 0) (e.unit.neutral ? dmgNeutral : dmgCpu)[b] += e.dmg;
    g.events.length = 0;
  }
  const last = Math.min(maxB - 1, Math.floor(g.t / B));
  for (let b = 0; b <= last; b++) alive[b]++;
  endHist[last]++;
}
console.log(`matches ${N}. Per 30 s window, averaged over matches still running:`);
console.log('window   CPU attack spend   dmg to you: CPU units | bosses/waves   games running   games ending');
for (let b = 0; b < maxB; b++) {
  if (!alive[b]) break;
  const f = x => (x / alive[b]).toFixed(0).padStart(6);
  const t = `${Math.floor(b * B / 60)}:${String(b * B % 60).padStart(2, '0')}`;
  console.log(`${t.padStart(5)}    ${f(spend[b])} ${'#'.repeat(Math.round(spend[b] / alive[b] / 25))}`.padEnd(46) + `${f(dmgCpu[b])}  | ${f(dmgNeutral[b])}        ${String(alive[b]).padStart(3)}            ${endHist[b]}`);
}

// When does each game's heaviest 30 s of CPU damage land? (spread = good, one spike = predictable surge)
if (process.argv[3] === 'peaks') {
  const peaks = {}, ends = [];
  for (let m = 0; m < N; m++) {
    const pool = [...STARTER_UNLOCKS, ...UNLOCK_ORDER.slice(0, 6 + (m % 8))];
    const skill = [0.3, 0.5, 0.7][m % 3];
    const g = new Game({ hands: [aiPickHand(pool), aiPickHand([...pool, 'sniper', 'flare'])], headless: false, mods: [{ bunkerLevel: 2 }, { bunkerLevel: 2, incomeMult: 0.78 + 0.4 * skill }] });
    const me = new AI(g, 0, 0.5), cpu = new AI(g, 1, skill);
    const w = {};
    while (!g.over && g.t < 900) { me.update(1 / 30); cpu.update(1 / 30); g.update(1 / 30); for (const e of g.events) if (e.type === 'bunkerHit' && e.side === 0 && !e.unit.neutral) { const b = Math.floor(g.t / 30); w[b] = (w[b] || 0) + e.dmg; } g.events.length = 0; }
    const best = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
    if (best) { const k = `${Math.floor(best[0] * 30 / 60)}:${String(best[0] * 30 % 60).padStart(2, '0')}`; peaks[k] = (peaks[k] || 0) + 1; }
    ends.push(g.t);
  }
  console.log('\nheaviest CPU push per game:');
  for (const k of Object.keys(peaks).sort((a, b) => (+a.split(':')[0] * 60 + +a.split(':')[1]) - (+b.split(':')[0] * 60 + +b.split(':')[1]))) console.log(`  ${k.padStart(5)} ${'#'.repeat(peaks[k])}`);
  ends.sort((a, b) => a - b);
  console.log(`game length: shortest ${(ends[0] / 60).toFixed(1)} · median ${(ends[ends.length >> 1] / 60).toFixed(1)} · longest ${(ends[ends.length - 1] / 60).toFixed(1)} min`);
}
