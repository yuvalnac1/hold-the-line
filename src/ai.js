// Computer opponent. Works through the same Game API the player uses.
import { CONFIG, cardKind, MACHINES, BUNKER_LEVELS } from './config.js';
import { BUILD_TILES, LANES } from './arena.js';
import { defStats } from './sim.js';

const DEF_PRIORITY = ['rifleman', 'grenadier', 'samurai', 'mgnest', 'flamethrower', 'sniper', 'missile', 'tank', 'drone', 'commander'];
const ATTACK_VALUE = { skeleton: 1, zombie: 1.2, bats: 1.4, pumpkin: 1.6, gargoyle: 1.7, ghost: 2.0, mummy: 1.8, golem: 2.0, horseman: 2.2, dragon: 2.5 };

export function aiPickHand(pool) {
  // 4 attack cards (undead, ≤1 sabotage) + 4 defenders — same slot rules as the player
  const undead = pool.filter(c => cardKind(c) === 'undead').sort((a, b) => CONFIG.undead[b].cost - CONFIG.undead[a].cost);
  const defs = pool.filter(c => cardKind(c) === 'defender');
  const sab = pool.filter(c => cardKind(c) === 'sabotage');
  const attack = [];
  const cheap = undead.slice().reverse();
  if (cheap[0]) attack.push(cheap[0]);              // one cheap undead for steady eco
  for (const u of undead) if (attack.length < 4 && !attack.includes(u)) attack.push(u);
  const magic = sab.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  if (sab.includes('flare') && !magic.includes('flare') && Math.random() < 0.5) magic[magic.length - 1] = 'flare';
  const want = ['rifleman', 'mgnest', 'grenadier', 'sniper', 'missile', 'flamethrower', 'tank', 'samurai', 'drone', 'commander'];
  const heavy = defs.find(d => ['sniper', 'missile', 'tank'].includes(d));
  const defence = [];
  if (defs.includes('rifleman')) defence.push('rifleman');
  // always carry a ghost detector
  const det = ['sniper', 'drone'].find(d => defs.includes(d));
  if (det) defence.push(det);
  if (heavy && !defence.includes(heavy)) defence.push(heavy);
  for (const w of want) if (defs.includes(w) && !defence.includes(w)) defence.push(w);
  return [...attack.slice(0, 4), ...defence.slice(0, 4), ...magic];
}

export class AI {
  // skill 0..1 (see progress.aiSkill): lower = slower decisions; the match also starts gently
  constructor(game, side, skill = 0.4) {
    this.g = game;
    this.side = side;
    this.skill = skill;
    // behaviour tier follows strength: random & slow → targeted → saves for big pushes + sabotage
    this.diff = skill < 0.3 ? 'easy' : skill < 0.6 ? 'medium' : 'hard';
    this.timer = 1.5;
    this.saving = false;
    this.pushLane = Math.floor(Math.random() * 3);
    this.saveTarget = 0;
    this.lastThreat = [0, 0, 0];
  }

  decisionInterval() {
    const g = CONFIG.global;
    return g.aiDecisionSlow + (g.aiDecisionFast - g.aiDecisionSlow) * this.skill;
  }

  update(dt) {
    if (this.g.over || this.g.aiPaused) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.decisionInterval() * (0.8 + Math.random() * 0.4);
    this.think();
  }

  get me() { return this.g.players[this.side]; }
  hand(kind) { return this.me.hand.filter(c => cardKind(c) === kind); }

  // incoming threat on my lanes (hp of enemies on my side per lane)
  threat() {
    const th = [0, 0, 0];
    for (const u of this.g.units) if (u.side === this.side) th[u.lane] += u.hp + (u.shield || 0) + (u.armoured ? 6 : 0);
    return th;
  }

  think() {
    const g = this.g, me = this.me;
    const th = this.threat();
    const cov = [0, 1, 2].map(l => g.laneCoverage(this.side, l));
    const myDefs = g.defenders.filter(d => d.side === this.side);
    const t = g.t;

    // Defence budget: more early, less later (attack must outgrow defence).
    const defShare = t < 60 ? 0.55 : t < 150 ? 0.45 : 0.32;
    const totalSpent = me.spent.attack + me.spent.defence + 1;
    const wantDefence = me.spent.defence / totalSpent < defShare || th.some((v, l) => v > cov[l] * 0.35 + 2);

    // ghosts unseen? try to get detection
    const ghostTrouble = g.units.some(u => u.side === this.side && u.invisible && !u.revealed);

    let acted = false;
    if (wantDefence || myDefs.length < 2) acted = this.defend(th, cov, ghostTrouble);
    if (!acted || this.diff !== 'easy') this.attack();
    if (this.diff !== 'easy' || Math.random() < 0.3) this.sabotage();
  }

  bestSpot(type, laneIdx) {
    const g = this.g;
    const s = CONFIG.defenders[type].levels[0];
    const lanes = LANES[this.side];
    let best = null, bv = -Infinity;
    for (const tile of BUILD_TILES[this.side]) {
      if (g.canPlace(this.side, type, tile.i, tile.j) !== 'ok') continue;
      let v = 0;
      if (type === 'commander') {
        for (const d of g.defenders) if (d.side === this.side && Math.hypot(d.x - tile.x, d.y - tile.y) <= s.range) v += 1;
      } else {
        const r = type === 'drone' ? 3 : s.range;
        for (let l = 0; l < 3; l++) {
          const lane = lanes[l];
          let n = 0;
          for (let d = 0.5; d < lane.length; d += 0.75) {
            const seg = pointOn(lane, d);
            if (Math.hypot(seg.x - tile.x, seg.y - tile.y) <= r) n += 1 + d / lane.length; // favour near bunker
          }
          v += n * (l === laneIdx ? 1.0 : 0.35);
        }
      }
      v += Math.random() * 0.8;
      if (v > bv) { bv = v; best = tile; }
    }
    return best && bv > 0.5 ? best : null;
  }

  defend(th, cov, ghostTrouble) {
    const g = this.g, me = this.me;
    const defs = this.hand('defender');
    if (!defs.length) return false;
    // weakest lane relative to threat
    let lane = 0, worst = -Infinity;
    for (let l = 0; l < 3; l++) {
      const v = (th[l] + 1.5) / (cov[l] + 1) / Math.sqrt(LANES[this.side][l].length / 17);
      if (v > worst) { worst = v; lane = l; }
    }
    if (this.diff === 'easy') lane = Math.floor(Math.random() * 3);

    // upgrades first if they directly solve a problem
    const myDefs = g.defenders.filter(d => d.side === this.side);
    if (ghostTrouble) {
      // 1) upgrade a detector we already have, 2) otherwise build one where the ghosts are, 3) flare
      const seeing = myDefs.some(d => (d.type === 'sniper' || d.type === 'drone') && d.level >= 1);
      if (!seeing) {
        const det = myDefs.find(d => (d.type === 'sniper' || d.type === 'drone') && d.level === 0);
        if (det) { if (g.upgrade(det)) return true; }
        else {
          const type = defs.find(d => d === 'sniper') || defs.find(d => d === 'drone');
          const ghostLane = g.units.find(u => u.side === this.side && u.invisible)?.lane ?? lane;
          if (type && g.defenderCost(this.side, type) <= me.energy) { const spot = this.bestSpot(type, ghostLane); if (spot && g.placeDefender(this.side, type, spot.i, spot.j)) return true; }
        }
      }
      if (this.hand('sabotage').includes('flare') && g.cooldownLeft(this.side, 'flare') <= 0 && me.energy >= CONFIG.sabotage.flare.cost) g.playSabotage(this.side, 'flare');
    }
    const armour = g.units.some(u => u.side === this.side && u.armoured);
    // choose type
    let options = defs.filter(d => !(d === 'commander' && (me.counts.commander || 0) >= 2));
    if (armour) options.sort((a, b) => (isHeavy(b) ? 1 : 0) - (isHeavy(a) ? 1 : 0));
    else if (this.diff !== 'easy') options.sort((a, b) => valueFor(b, g, this.side) - valueFor(a, g, this.side));
    else options.sort(() => Math.random() - 0.5);

    // build if we have spots left, else upgrade
    const nDefs = myDefs.length;
    if (nDefs < CONFIG.global.buildSpotsPerSide && (nDefs < 6 || Math.random() < 0.6)) {
      for (const type of options) {
        if (type === 'commander' && nDefs < 5) continue;
        const cost = g.defenderCost(this.side, type);
        if (cost > me.energy) continue;
        const spot = this.bestSpot(type, lane);
        if (spot && g.placeDefender(this.side, type, spot.i, spot.j)) return true;
      }
    }
    // upgrade cheapest useful
    const ups = myDefs.filter(d => d.level < 2).sort((a, b) => g.upgradeCost(a) - g.upgradeCost(b));
    for (const d of ups) {
      if (g.upgradeCost(d) <= me.energy * (this.diff === 'hard' ? 0.8 : 1)) {
        if (d.type === 'commander' && d.level === 1) { if (g.upgrade(d)) return true; continue; }
        if (g.upgrade(d)) return true;
      }
    }
    return false;
  }

  attack() {
    const g = this.g, me = this.me;
    const undead = this.hand('undead');
    if (!undead.length) return;
    const enemy = 1 - this.side;
    let lane;
    if (this.diff === 'easy') lane = Math.floor(Math.random() * 3);
    else lane = g.weakestLane(enemy);

    const c = CONFIG.global, t = g.t;
    // Big offensives happen at random times (a few per match), not at a fixed moment.
    this.nextOffensive ??= c.aiOffensiveFirst + Math.random() * c.aiOffensiveSpread;
    if (this.diff !== 'easy' && t >= this.nextOffensive) {
      if (me.energy >= 100 + t * 0.35) {
        this.push(undead, lane, me.energy * (0.55 + Math.random() * 0.3));
        this.nextOffensive = t + c.aiOffensiveGap + Math.random() * c.aiOffensiveGapRand;
        return;
      }
    }
    // Between offensives: steady pressure with a capped budget (the rest is saved for the next offensive).
    const cap = c.aiPressureBase + t * c.aiPressurePerSec;
    const budget = Math.min(cap, me.energy * (this.diff === 'easy' ? 0.5 : 0.65));
    this.push(undead, lane, budget);
  }

  trickle(undead, lane, frac) {
    const cheap = undead.slice().sort((a, b) => CONFIG.undead[a].cost - CONFIG.undead[b].cost)[0];
    if (Math.random() < frac && this.me.energy > CONFIG.undead[cheap].cost * 3) this.g.sendUndead(this.side, cheap, lane);
  }

  push(undead, lane, budget) {
    const g = this.g, me = this.me;
    const enemy = 1 - this.side;
    const enemyDefs = g.defenders.filter(d => d.side === enemy);
    const hasDetect = enemyDefs.some(d => defStats(d).detect);
    const searchlight = BUNKER_LEVELS[g.players[enemy].bunkerLevel - 1]?.reveal || 0;
    const hasHeavy = enemyDefs.some(d => defStats(d).heavy);
    let spent = 0, guard = 0;
    // prefer units that exploit gaps
    const scored = undead.map(u => {
      let v = ATTACK_VALUE[u] || 1;
      if (u === 'ghost' && !hasDetect) v *= searchlight >= 5 ? 1.1 : searchlight > 0 ? 1.4 : 1.8;
      if (u === 'ghost') { const mine = g.units.filter(x => x.type === 'ghost' && x.owner === this.side && !x.neutral).length; if (mine >= 4) v *= 0.35; }   // keep the army mixed
      if (u === 'golem' && !hasHeavy) v *= 2.5;
      if (u === 'ghost' && hasDetect) v *= 0.6;
      v += Math.random() * 0.8;
      return { u, v };
    }).sort((a, b) => b.v - a.v);
    while (spent < budget && guard++ < 12) {
      let sent = false;
      for (const { u } of scored) {
        const c = CONFIG.undead[u].cost;
        if (c <= me.energy && spent + c <= budget + 5) {
          if (g.sendUndead(this.side, u, lane)) { spent += c; sent = true; break; }
        }
      }
      if (!sent) break;
      if (this.diff === 'medium' && Math.random() < 0.25) lane = Math.floor(Math.random() * 3);
    }
  }

  sabotage() {
    const g = this.g, me = this.me;
    const enemy = 1 - this.side;
    const myOnEnemy = g.units.filter(u => u.side === enemy && !u.neutral && u.owner === this.side);
    const th = this.threat();
    for (const id of this.hand('sabotage')) {
      if (g.cooldownLeft(this.side, id) > 0 || me.energy < CONFIG.sabotage[id].cost + 20) continue;
      if (id === 'fog') {
        const per = [0, 0, 0];
        for (const u of myOnEnemy) per[u.lane] += u.hp;
        const l = per.indexOf(Math.max(...per));
        if (per[l] > 8) g.playSabotage(this.side, id, l);
      } else if (id === 'emp') {
        const machines = g.defenders.filter(d => d.side === enemy && MACHINES.includes(d.type)).length;
        if (machines >= 2 && myOnEnemy.length > 4) g.playSabotage(this.side, id);
      } else if (id === 'raise' || id === 'vigor') {
        if (myOnEnemy.length > 6) g.playSabotage(this.side, id);
      } else if (id === 'warcry') {
        if (th.reduce((a, b) => a + b, 0) > 25) g.playSabotage(this.side, id);
      } else if (id === 'shield') {
        if (me.bunkerHp < me.bunkerMax * 0.6 && th.some(v => v > 10)) g.playSabotage(this.side, id);
      } else if (id === 'flare') {
        // cleanse when the enemy's magic is hurting us (ghost use is handled in defend())
        const hurt = g.fogUntil[this.side].some(v => v > g.t) || g.empUntil[this.side] > g.t || g.freezeUntil[enemy].some(v => v > g.t);
        if (hurt) g.playSabotage(this.side, id);
      } else if (id === 'freeze') {
        const l = th.indexOf(Math.max(...th));
        if (th[l] > 18) g.playSabotage(this.side, id, l);
      }
    }
  }
}

function isHeavy(t) { return CONFIG.defenders[t].levels[0].heavy; }
function valueFor(type, g, side) {
  const s = CONFIG.defenders[type].levels[0];
  const dps = s.damage * s.fireRate * (s.splash ? 1.8 : 1);
  const enemyUnits = g.units.filter(u => u.side === side);
  const swarm = enemyUnits.filter(u => u.maxHp <= 1.5).length;
  let v = dps / s.cost * 100;
  if (swarm > 5 && (type === 'mgnest' || type === 'grenadier' || type === 'flamethrower')) v *= 1.6;
  if (enemyUnits.some(u => u.shield > 0) && (type === 'flamethrower' || type === 'mgnest')) v *= 1.5;
  if (type === 'commander') v = 0.5;
  return v + Math.random();
}

const _p = {};
function pointOn(lane, d) {
  for (const s of lane.segs) if (d <= s.start + s.len) { const t = d - s.start; _p.x = s.ax + s.dx * t; _p.y = s.ay + s.dy * t; return _p; }
  const s = lane.segs[lane.segs.length - 1]; _p.x = s.bx; _p.y = s.by; return _p;
}
