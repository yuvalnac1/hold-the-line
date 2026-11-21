// All tunable values from the PRD. The developer menu edits this object live;
// "Export" copies it as JSON so values can be pasted back here.

export const DEFAULT_CONFIG = {
  global: {
    startingCoins: 400,       // coins a brand-new player starts with (spent in the tutorial's shop step)
    startEnergy: 170,
    baseIncome: 6,            // paid every incomeInterval seconds
    incomeInterval: 2,
    incomeGrowthPerMin: 0.10, // +10% per minute
    killRewardMult: 1.0,
    bunkerDamageReward: 3,    // soul energy per point of bunker damage
    ecoMult: 1.0,             // multiplier on each undead's income boost
    ecoPerTick: 0.32,         // share of an undead's income boost paid each income tick
    ecoSoftCap: 40,           // income boost per tick above this grows more slowly…
    ecoOverCap: 0.35,         // …only this share of the extra counts (stops runaway late economies)
    bunkerHealth: 100,
    revealLinger: 2.5,        // a spotted ghost stays visible to all defenders this long (s)
    ghostSenseRadius: 1.05,    // any defender senses (reveals) a ghost passing this close (tiles)
    escalationStart: 45,
    escalationEvery: 30,
    escalationHealth: 0.15,
    // late-game pressure (never announced): from lateStart, every lateEvery seconds undead get a bit
    // tougher, faster and hit bunkers harder, so a match always ends — there is no time limit.
    lateStart: 240,
    lateJitter: 60,           // each match starts the late pressure up to ±this many seconds from lateStart
    bossJitter: 25,           // each boss arrives up to ±this many seconds from its scheduled time
    paceJitter: 0.25,         // each match's escalation / late pressure runs this much slower or faster (±)
    lateEvery: 30,
    lateHealth: 0.15,
    lateSpeed: 0.04,
    lateBunkerDmg: 0.2,
    timeLimit: 0,             // 0 = no time limit (dev option)
    duplicateCostIncrease: 0.15,
    buildSpotsPerSide: 18,
    sellRefund: 0.70,
    gameSpeed: 1,
    aiDecisionSlow: 4.2,      // CPU seconds between decisions at the lowest strength…
    aiDecisionFast: 1.9,      // …and at the highest (strength adapts to the player)
    aiPressureBase: 60,       // CPU attack spend cap per decision between offensives…
    aiPressurePerSec: 0.6,    // …growing this much per second of match time
    aiOffensiveFirst: 100,    // first big CPU offensive: somewhere between this…
    aiOffensiveSpread: 140,   // …and this many seconds later (random each match)
    aiOffensiveGap: 50,       // next offensive: at least this many seconds later…
    aiOffensiveGapRand: 110,  // …plus up to this many more (random)
    tileSpeed: 1.15,          // tiles per second at speed 1.0
    wavesOn: true,            // automatic undead waves attack both bunkers
    waveStart: 6,             // first wave (s)
    waveEvery: 15,            // seconds between waves
    waveSize: 3,              // wave size at the start (skeleton = 1)
    waveGrowthPerMin: 1.5,    // extra wave size per minute
  },
  undead: {
    skeleton:  { name: 'Skeleton',          health: 1,  speed: 1.0, bunkerDamage: 1,  cost: 10,  killReward: 1,  income: 1,  size: 1.0, unlocked: true },
    zombie:    { name: 'Zombie Runner',     health: 1,  speed: 1.8, bunkerDamage: 1,  cost: 15,  killReward: 2,  income: 1.5, size: 1.0, unlocked: true },
    bats:      { name: 'Bat Swarm',         health: 1,  speed: 1.6, bunkerDamage: 1,  cost: 25,  killReward: 1,  income: 2,  size: 1.0, swarmCount: 5, flying: true, unlocked: true },
    pumpkin:   { name: 'Pumpkin Brute',     health: 3,  speed: 0.9, bunkerDamage: 3,  cost: 30,  killReward: 3,  income: 3,  size: 1.15, splitType: 'imp', splitCount: 3, splitHealth: 1, unlocked: false },
    gargoyle:  { name: 'Stone Gargoyle',    health: 4,  speed: 0.7, bunkerDamage: 3,  cost: 40,  killReward: 4,  income: 4,  size: 1.1, shieldHits: 3, unlocked: false },
    ghost:     { name: 'Ghost',             health: 3,  speed: 1.0, bunkerDamage: 3,  cost: 50,  killReward: 5,  income: 5,  size: 1.0, invisible: true, unlocked: false },   // countered by: Sniper L2, Drone L2, bunker searchlight, explosions, Flare
    mummy:     { name: 'Mummy',             health: 6,  speed: 0.7, bunkerDamage: 5,  cost: 60,  killReward: 6,  income: 6,  size: 1.1, regen: 1, unlocked: false },
    golem:     { name: 'Iron Golem',        health: 8,  speed: 0.6, bunkerDamage: 6,  cost: 75,  killReward: 8,  income: 7,  size: 1.35, armoured: true, unlocked: false },
    horseman:  { name: 'Headless Horseman', health: 12, speed: 1.3, bunkerDamage: 8,  cost: 100, killReward: 10, income: 8,  size: 1.3, splitType: 'rider', splitCount: 1, splitHealth: 4, unlocked: false },
    dragon:    { name: 'Bone Dragon',       health: 40, speed: 0.4, bunkerDamage: 20, cost: 200, killReward: 25, income: 10, size: 2.0, splitType: 'gargoyle', splitCount: 4, splitHealth: 4, flying: true, unlocked: false },
    // spawned only by splits
    // bosses — never in a deck, they arrive on the boss timeline for both sides
    abom:      { name: 'Abomination',       health: 70, speed: 0.33, bunkerDamage: 25, cost: 0,   killReward: 30, income: 0,  size: 2.3, splitType: 'zombie', splitCount: 6, splitHealth: 2, hidden: true },
    lich:      { name: 'Lich King',         health: 90, speed: 0.36, bunkerDamage: 35, cost: 0,   killReward: 40, income: 0,  size: 1.9, regen: 1.5, shieldHits: 6, summon: 'skeleton', summonEvery: 5, hidden: true },
    imp:       { name: 'Pumpkin Imp',       health: 1,  speed: 1.2, bunkerDamage: 1,  cost: 0,   killReward: 1,  income: 0,  size: 0.6, hidden: true },
    rider:     { name: 'Headless Rider',    health: 4,  speed: 1.0, bunkerDamage: 4,  cost: 0,   killReward: 4,  income: 0,  size: 1.0, hidden: true },
  },
  // levels[0] = base, [1] = level 2, [2] = level 3. `cost` on L2/L3 is the upgrade cost.
  defenders: {
    rifleman: { name: 'Rifleman', role: 'Cheap, steady fire', max: 99, machine: false, unlocked: true, levels: [
      { damage: 1, range: 3, fireRate: 1.0, cost: 40, heavy: false, detect: false, burst: 1, desc: 'Cheap, steady fire' },
      { damage: 1, range: 3, fireRate: 1.6, cost: 30, heavy: false, detect: false, burst: 1, desc: 'Faster reload: 1.6 shots/s' },
      { damage: 1, range: 3, fireRate: 1.6, cost: 60, heavy: false, detect: false, burst: 3, desc: 'Burst fire: 3 shots per burst' },
    ]},
    sniper: { name: 'Sniper', role: 'Very long range, slow', max: 99, machine: false, unlocked: false, levels: [
      { damage: 4, range: 9, fireRate: 0.4, cost: 80, heavy: true, detect: false, pierce: 1, desc: 'Very long range, heavy' },
      { damage: 4, range: 9, fireRate: 0.4, cost: 50, heavy: true, detect: true, pierce: 1, desc: 'Thermal scope: sees ghosts' },
      { damage: 4, range: 9, fireRate: 0.4, cost: 100, heavy: true, detect: true, pierce: 3, desc: 'Bullets pierce 3 targets' },
    ]},
    samurai: { name: 'Samurai', role: 'Melee sword', max: 99, machine: false, unlocked: true, levels: [
      { damage: 2, range: 1.2, fireRate: 1.5, cost: 60, heavy: false, detect: false, hits: 1, whirlwind: false, desc: 'Melee sword' },
      { damage: 2, range: 1.2, fireRate: 1.5, cost: 40, heavy: false, detect: false, hits: 2, whirlwind: false, desc: 'Double slash: 2 hits per swing' },
      { damage: 2, range: 1.4, fireRate: 1.5, cost: 90, heavy: true, detect: false, hits: 2, whirlwind: true, desc: 'Whirlwind: hits all around, heavy' },
    ]},
    flamethrower: { name: 'Flamethrower', role: 'Short cone, sets on fire', max: 99, machine: false, unlocked: false, levels: [
      { damage: 1, range: 2, fireRate: 4, cost: 70, heavy: false, detect: false, burnDamage: 1, burnDuration: 3, burningGround: false, desc: 'Cone of fire, burns 1/s for 3 s' },
      { damage: 1, range: 3, fireRate: 4, cost: 40, heavy: false, detect: false, burnDamage: 1, burnDuration: 3, burningGround: false, desc: 'Range 3' },
      { damage: 1, range: 3, fireRate: 4, cost: 80, heavy: false, detect: false, burnDamage: 1, burnDuration: 3, burningGround: true, groundDuration: 3, desc: 'Burning ground lingers 3 s' },
    ]},
    grenadier: { name: 'Grenadier', role: 'Area blast', max: 99, machine: false, unlocked: true, levels: [
      { damage: 2, range: 4, fireRate: 0.6, cost: 70, heavy: false, detect: false, splash: 1.0, cluster: 0, desc: 'Area blast' },
      { damage: 2, range: 4, fireRate: 0.6, cost: 40, heavy: false, detect: false, splash: 1.6, cluster: 0, desc: 'Blast radius 1.6' },
      { damage: 2, range: 4, fireRate: 0.6, cost: 90, heavy: false, detect: false, splash: 1.6, cluster: 3, desc: 'Cluster grenades: 3 extra blasts' },
    ]},
    mgnest: { name: 'Machine-Gun Nest', role: 'Very rapid fire', max: 99, machine: true, unlocked: false, levels: [
      { damage: 1, range: 4, fireRate: 6, cost: 90, heavy: false, detect: false, desc: 'Very rapid fire' },
      { damage: 1, range: 5, fireRate: 6, cost: 50, heavy: false, detect: false, desc: 'Wider arc: range 5' },
      { damage: 1, range: 5, fireRate: 6, cost: 110, heavy: true, detect: false, desc: 'Armour-piercing rounds: heavy' },
    ]},
    missile: { name: 'Missile Launcher', role: 'Long range, heavy splash', max: 99, machine: true, unlocked: false, levels: [
      { damage: 5, range: 7, fireRate: 0.3, cost: 120, heavy: true, detect: false, splash: 1.5, missiles: 1, homing: false, desc: 'Long range heavy splash' },
      { damage: 5, range: 7, fireRate: 0.3, cost: 80, heavy: true, detect: false, splash: 1.5, missiles: 2, homing: false, desc: 'Two missiles per shot' },
      { damage: 5, range: 7, fireRate: 0.3, cost: 140, heavy: true, detect: false, splash: 1.5, missiles: 2, homing: true, desc: 'Homing missiles never miss' },
    ]},
    tank: { name: 'Tank', role: 'Heavy cannon', max: 99, machine: true, unlocked: false, levels: [
      { damage: 6, range: 3, fireRate: 0.5, cost: 150, heavy: true, detect: false, ram: false, desc: 'Heavy cannon' },
      { damage: 9, range: 3, fireRate: 0.7, cost: 90, heavy: true, detect: false, ram: false, desc: 'Damage 9, fire rate 0.7' },
      { damage: 9, range: 3, fireRate: 0.7, cost: 160, heavy: true, detect: false, ram: true, ramDamage: 15, ramCooldown: 20, desc: 'Ram: charges for 15 damage' },
    ]},
    drone: { name: 'Drone Operator', role: 'Drone patrols your side', max: 99, machine: true, unlocked: false, levels: [
      { damage: 1, range: 2, fireRate: 1, cost: 90, heavy: false, detect: false, droneSpeed: 3, bomb: false, desc: 'Drone hunts anywhere on your side' },
      { damage: 1, range: 2, fireRate: 1, cost: 50, heavy: false, detect: true, droneSpeed: 3, bomb: false, desc: 'Thermal camera reveals ghosts' },
      { damage: 1, range: 2, fireRate: 1, cost: 100, heavy: false, detect: true, droneSpeed: 3, bomb: true, bombInterval: 5, bombDamage: 3, splash: 1, desc: 'Drops a bomb every 5 s' },
    ]},
    // Support: every defender inside the commander's circle deals more damage and fires faster.
    // Several commanders are allowed; overlapping circles don't stack (the strongest one counts).
    commander: { name: 'Commander', role: 'Boosts damage & fire rate of defenders in its circle', max: 99, machine: false, unlocked: false, levels: [
      { damage: 0, range: 3.0, fireRate: 0, cost: 110, heavy: false, detect: false, auraDamage: 0.20, auraBoost: 0.15, desc: 'Defenders in the circle: +20% damage, +15% fire rate' },
      { damage: 0, range: 3.6, fireRate: 0, cost: 80,  heavy: false, detect: false, auraDamage: 0.30, auraBoost: 0.20, desc: 'Bigger circle · +30% damage, +20% fire rate' },
      { damage: 0, range: 4.2, fireRate: 0, cost: 140, heavy: false, detect: false, auraDamage: 0.40, auraBoost: 0.25, desc: 'Biggest circle · +40% damage, +25% fire rate' },
    ]},
  },
  sabotage: {
    // Magic cards. target: enemyLane | enemyHalf | myLane | self (drop anywhere)
    fog:    { name: 'Fog of War', cost: 40, cooldown: 30, duration: 5, strength: 1, target: 'enemyLane', unlocked: false, desc: 'Hides one enemy lane from their defenders for 5 s' },
    emp:    { name: 'EMP',        cost: 60, cooldown: 45, duration: 4, strength: 1, target: 'enemyHalf', unlocked: false, desc: 'Shuts down enemy machines for 4 s' },
    raise:  { name: 'Raise Dead', cost: 50, cooldown: 40, duration: 0, strength: 5, target: 'self', unlocked: false, desc: 'Your next 5 undead killed come back once' },
    vigor:  { name: 'Dark Vigor', cost: 45, cooldown: 35, duration: 0, strength: 0.5, target: 'self', unlocked: true, desc: 'All your undead on the field get +50% health' },
    warcry: { name: 'War Cry',    cost: 50, cooldown: 40, duration: 8, strength: 0.5, target: 'self', unlocked: true, desc: 'Your defenders deal +50% damage for 8 s' },
    shield: { name: 'Bunker Shield', cost: 55, cooldown: 45, duration: 25, strength: 15, target: 'self', unlocked: false, desc: 'Your bunker blocks the next 15 damage (25 s)' },
    flare:  { name: 'Flare',      cost: 40, cooldown: 30, duration: 10, strength: 1, target: 'self', unlocked: false, desc: 'Cancels enemy Fog, EMP & Freeze on you and reveals every ghost on your side for 10 s' },
    freeze: { name: 'Freeze',     cost: 45, cooldown: 35, duration: 4, strength: 1, target: 'myLane', unlocked: false, desc: 'Freezes all undead in one of your lanes for 4 s' },
  },
};

export const STARTER_UNLOCKS = ['skeleton', 'zombie', 'bats', 'rifleman', 'samurai', 'grenadier', 'vigor', 'warcry'];

// One new card per level (about every 1–2 matches).
export const UNLOCK_ORDER = [
  'pumpkin', 'sniper', 'gargoyle', 'flamethrower', 'fog', 'ghost', 'mgnest', 'mummy',
  'emp', 'golem', 'missile', 'horseman', 'tank', 'raise', 'drone', 'dragon', 'commander',
];

export function cardKind(id) {
  if (DEFAULT_CONFIG.undead[id]) return 'undead';
  if (DEFAULT_CONFIG.defenders[id]) return 'defender';
  if (DEFAULT_CONFIG.sabotage[id]) return 'sabotage';
  return null;
}

export const ALL_CARDS = [
  ...Object.keys(DEFAULT_CONFIG.undead).filter(k => !DEFAULT_CONFIG.undead[k].hidden),
  ...Object.keys(DEFAULT_CONFIG.defenders),
  ...Object.keys(DEFAULT_CONFIG.sabotage),
];

export const CONFIG = structuredClone(DEFAULT_CONFIG);

// ---------- designer tuning (public/tuning.json) ----------
// Values changed in the dev menu are saved as overrides and win over the defaults above.
export let TUNING = {};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function mergeInto(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_')) continue;
    if (Array.isArray(v) && Array.isArray(dst[k])) v.forEach((x, i) => { if (isObj(x) && isObj(dst[k][i])) mergeInto(dst[k][i], x); else if (x !== null) dst[k][i] = x; });
    else if (isObj(v) && isObj(dst[k])) mergeInto(dst[k], v);
    else if (k in dst) dst[k] = v;
  }
}
export function applyTuning(t) {
  TUNING = t || {};
  resetConfig();
}
// only the values that differ from the code defaults (what gets saved)
export function tuningDiff(cur = CONFIG, base = DEFAULT_CONFIG) {
  if (Array.isArray(cur)) { let any = false; const out = cur.map((x, i) => { const d = tuningDiff(x, base?.[i]); if (d !== undefined) any = true; return d === undefined ? null : d; }); return any ? out : undefined; }
  if (isObj(cur)) { const out = {}; for (const k of Object.keys(cur)) { const d = tuningDiff(cur[k], base?.[k]); if (d !== undefined) out[k] = d; } return Object.keys(out).length ? out : undefined; }
  return cur === base ? undefined : cur;
}
export function resetConfig() {
  const fresh = structuredClone(DEFAULT_CONFIG);
  mergeInto(fresh, TUNING);
  for (const k of Object.keys(fresh)) {
    if (isObj(CONFIG[k]) && isObj(fresh[k])) { for (const kk of Object.keys(CONFIG[k])) if (!(kk in fresh[k])) delete CONFIG[k][kk]; Object.assign(CONFIG[k], fresh[k]); }
    else CONFIG[k] = fresh[k];
  }
}

export const MACHINES = ['tank', 'missile', 'mgnest', 'drone'];

// Developer menu (gear button). Off for players; values saved in public/tuning.json still apply.
export const DEV_MENU_ENABLED = false;

// Special attackers that march on BOTH bunkers at set times (same lane each side).
// Smaller threats before the Bone Dragon, bigger ones after; then it keeps cycling.
export const BOSS_TIMELINE = [
  { t: 40,  units: [['bats', 2]] },
  { t: 70,  units: [['pumpkin', 2]] },
  { t: 100, units: [['gargoyle', 2]] },
  { t: 130, units: [['golem', 1], ['skeleton', 3]] },
  { t: 160, units: [['horseman', 1]] },
  { t: 190, units: [['dragon', 1]] },
  { t: 250, units: [['abom', 1]] },
  { t: 310, units: [['lich', 1]] },
];
export const BOSS_CYCLE = { start: 370, every: 60, units: [[['dragon', 1]], [['abom', 1], ['mummy', 2]], [['lich', 1], ['golem', 1]]] };

// Bunker upgrades bought in the shop. Level 3+ adds a turret on the bunker.
// Level 2+ adds a searchlight that reveals ghosts near the bunker (radius in tiles).
export const BUNKER_LEVELS = [
  { hp: 0,  turret: null, reveal: 0,   price: 0 },
  { hp: 15, turret: null, reveal: 3.5, price: 150 },
  { hp: 30, turret: { damage: 1.5, range: 4.2, fireRate: 1.5 }, reveal: 5, price: 300 },
  { hp: 45, turret: { damage: 2,   range: 4.8, fireRate: 1.8 }, reveal: 6, price: 500 },
  { hp: 60, turret: { damage: 3,   range: 5.4, fireRate: 2.2, heavy: true }, reveal: 7, price: 800 },
];
