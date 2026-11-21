// Pure game simulation — no DOM, no rendering. Runs in the browser and in Node (balance tests).
import { CONFIG, MACHINES, cardKind, BUNKER_LEVELS, BOSS_TIMELINE, BOSS_CYCLE } from './config.js';
import { LANES, lanePoint, isBuildable, BUILD_TILES, LANE_SAMPLES, BUNKER, tileKey } from './arena.js';

const TARGET_MODES = ['first', 'last', 'strongest', 'closest'];
export { TARGET_MODES };

let NEXT_ID = 1;
const tmp = {};

export function defStats(def) {
  const c = CONFIG.defenders[def.type];
  return c.levels[def.level];
}

export class Game {
  // mods[i] = { cardLevels: {id: 1..5}, incomeMult } — card upgrades bought in the shop and the CPU's handicap
  constructor({ hands, difficulty = 'medium', headless = false, mods = [] } = {}) {
    const g = CONFIG.global;
    this.headless = headless;
    this.difficulty = difficulty;
    this.t = 0;
    this.over = false;
    this.winner = null;
    this.endReason = '';
    this.players = [0, 1].map(i => ({
      energy: g.startEnergy,
      eco: 0,
      bunkerHp: g.bunkerHealth + (BUNKER_LEVELS[(mods[i]?.bunkerLevel || 1) - 1]?.hp || 0),
      bunkerMax: g.bunkerHealth + (BUNKER_LEVELS[(mods[i]?.bunkerLevel || 1) - 1]?.hp || 0),
      bunkerLevel: mods[i]?.bunkerLevel || 1,
      turretCd: 0,
      hand: hands ? hands[i].slice() : [],
      cooldowns: {},
      raiseCharges: 0,
      shieldHp: 0, shieldUntil: 0,
      airstrikeUsed: false,
      damageDealt: 0,
      sent: 0,
      kills: 0,
      counts: {},
      spent: { attack: 0, defence: 0 },
      cardLevels: mods[i]?.cardLevels || {},
      incomeMult: mods[i]?.incomeMult ?? 1,
    }));
    this.waveTimer = 0;
    this.waveNo = 0;
    this.units = [];
    this.defenders = [];
    this.projectiles = [];
    this.grounds = [];
    this.strikes = [];
    this.events = [];
    this.fogUntil = [[0, 0, 0], [0, 0, 0]];
    this.empUntil = [0, 0];
    this.warcryUntil = [0, 0];
    this.flareUntil = [0, 0];
    this.freezeUntil = [[0, 0, 0], [0, 0, 0]];
    this.incomeTimer = 0;
    this.bossIdx = 0;
    this.lateOffset = (Math.random() * 2 - 1) * g.lateJitter;   // late pressure starts at a different time each match
    this.pace = 1 + (Math.random() * 2 - 1) * (g.paceJitter || 0); // and the dead grow stronger at a different pace
    this.occupied = [new Map(), new Map()];
    this.paused = false;
    this.aiPaused = false;
  }

  emit(e) { if (!this.headless) this.events.push(e); }

  // ----- multipliers over time -----
  escalationStacks(t = this.t) {
    const g = CONFIG.global;
    return t >= g.escalationStart ? Math.floor((t - g.escalationStart) / g.escalationEvery) + 1 : 0;
  }
  lateStacks(t = this.t) {
    const g = CONFIG.global;
    const start = g.lateStart + this.lateOffset;
    return t >= start ? Math.floor((t - start) / g.lateEvery) + 1 : 0;
  }
  hpMult() {
    const g = CONFIG.global;
    return (1 + g.escalationHealth * this.pace * this.escalationStacks()) * (1 + g.lateHealth * this.pace * this.lateStacks());
  }
  speedMult() { return 1 + CONFIG.global.lateSpeed * this.pace * this.lateStacks(); }
  bunkerMult() { return 1 + CONFIG.global.lateBunkerDmg * this.pace * this.lateStacks(); }
  incomePerTick(side) {
    const g = CONFIG.global;
    const p = this.players[side];
    let eco = p.eco * g.ecoPerTick;
    if (eco > g.ecoSoftCap) eco = g.ecoSoftCap + (eco - g.ecoSoftCap) * g.ecoOverCap;   // diminishing returns
    return (g.baseIncome * (1 + g.incomeGrowthPerMin * this.t / 60) + eco) * p.incomeMult;
  }

  // ----- costs -----
  defenderCost(side, type) {
    const c = CONFIG.defenders[type];
    const n = this.players[side].counts[type] || 0;
    return Math.round(c.levels[0].cost * Math.pow(1 + CONFIG.global.duplicateCostIncrease, n));
  }
  cardCost(side, id) {
    const k = cardKind(id);
    if (k === 'undead') return CONFIG.undead[id].cost;
    if (k === 'defender') return this.defenderCost(side, id);
    if (k === 'sabotage') return CONFIG.sabotage[id].cost;
    return 0;
  }
  cooldownLeft(side, id) { return Math.max(0, (this.players[side].cooldowns[id] || 0) - this.t); }

  // ----- actions -----
  sendUndead(owner, type, lane, free = false, stagger = 0) {
    if (this.over) return false;
    const p = this.players[owner];
    const c = CONFIG.undead[type];
    if (!c) return false;
    if (!free) {
      if (!p.hand.includes(type) || p.energy < c.cost) return false;
      p.energy -= c.cost;
      p.eco += c.income * CONFIG.global.ecoMult;
      p.sent++;
      p.spent.attack += c.cost;
    }
    const side = 1 - owner;
    const count = c.swarmCount || 1;
    for (let i = 0; i < count; i++) {
      this.spawnUnit(type, side, lane, -stagger - i * 0.35, null);
    }
    this.emit({ type: 'send', owner, side, lane, unit: type });
    return true;
  }

  // shop upgrades: each card level above 1 = +10% undead health / +8% defender damage
  cardLevel(side, id) { return this.players[side].cardLevels[id] || 1; }
  undeadPower(owner, type) { return 1 + 0.10 * (this.cardLevel(owner, type) - 1); }
  defenderPower(side, type) { return 1 + 0.08 * (this.cardLevel(side, type) - 1); }

  spawnUnit(type, side, lane, d = 0, parent = null, hpOverride = null, neutral = false) {
    const c = CONFIG.undead[type];
    const mult = parent ? parent.hpMult : this.hpMult() * (neutral ? 1 : this.undeadPower(1 - side, type));
    const maxHp = (hpOverride ?? c.health) * mult;
    const u = {
      id: NEXT_ID++, type, side, owner: 1 - side, lane, d,
      offset: (Math.random() - 0.5) * 0.5,
      hp: maxHp, maxHp, hpMult: mult, neutral: parent ? parent.neutral : neutral,
      shield: c.shieldHits || 0,
      burnT: 0, burnDps: 0,
      armoured: !!c.armoured, invisible: !!c.invisible, flying: !!c.flying,
      regen: c.regen || 0,
      revived: parent ? parent.revived : false,
      revealed: false,
      alive: true, x: 0, y: 0, dx: 1, dy: 0,
      born: this.t,
      bob: Math.random() * 10,
    };
    this.positionUnit(u);
    this.units.push(u);
    this.emit({ type: 'spawn', unit: u });
    return u;
  }

  positionUnit(u) {
    const lane = LANES[u.side][u.lane];
    lanePoint(lane, u.d, tmp);
    u.x = tmp.x - tmp.dy * u.offset;
    u.y = tmp.y + tmp.dx * u.offset;
    u.dx = tmp.dx; u.dy = tmp.dy;
  }

  canPlace(side, type, i, j) {
    const p = this.players[side];
    if (!isBuildable(side, i, j)) return 'invalid';
    if (this.occupied[side].has(tileKey(i, j))) return 'occupied';
    const mine = this.defenders.filter(d => d.side === side).length;
    if (mine >= CONFIG.global.buildSpotsPerSide) return 'full';
    const c = CONFIG.defenders[type];
    if ((p.counts[type] || 0) >= c.max) return 'max';
    return 'ok';
  }

  placeDefender(side, type, i, j, free = false) {
    if (this.over) return null;
    const p = this.players[side];
    if (!free && !p.hand.includes(type)) return null;
    if (this.canPlace(side, type, i, j) !== 'ok') return null;
    const cost = this.defenderCost(side, type);
    if (!free) {
      if (p.energy < cost) return null;
      p.energy -= cost;
      p.spent.defence += cost;
    }
    p.counts[type] = (p.counts[type] || 0) + 1;
    const def = {
      id: NEXT_ID++, type, side, level: 0, i, j, x: i + 0.5, y: j + 0.5,
      cooldown: 0.3, target: 'first', paid: free ? 0 : cost,
      aimX: side === 0 ? 1 : -1, aimY: 0, firing: 0,
      burstLeft: 0, burstTimer: 0, burstTarget: null,
      ramTimer: 4, bombTimer: 2, groundTimer: 0,
      drone: type === 'drone' ? { x: i + 0.5, y: j + 0.5, vx: 0, vy: 0 } : null,
      lunge: 0, built: this.t,
    };
    this.defenders.push(def);
    this.occupied[side].set(tileKey(i, j), def);
    this.emit({ type: 'place', def });
    return def;
  }

  upgradeCost(def) {
    if (def.level >= 2) return null;
    return CONFIG.defenders[def.type].levels[def.level + 1].cost;
  }
  upgrade(def, free = false) {
    const cost = this.upgradeCost(def);
    if (cost == null || this.over) return false;
    const p = this.players[def.side];
    if (!free) {
      if (p.energy < cost) return false;
      p.energy -= cost;
      p.spent.defence += cost;
      def.paid += cost;
    }
    def.level++;
    this.emit({ type: 'upgrade', def });
    return true;
  }
  sellValue(def) { return Math.round(def.paid * CONFIG.global.sellRefund); }
  sell(def) {
    const p = this.players[def.side];
    p.energy += this.sellValue(def);
    p.counts[def.type] = Math.max(0, (p.counts[def.type] || 1) - 1);
    this.defenders = this.defenders.filter(d => d !== def);
    this.occupied[def.side].delete(tileKey(def.i, def.j));
    this.emit({ type: 'sell', def });
  }
  setTargetMode(def, mode) { if (TARGET_MODES.includes(mode)) def.target = mode; }

  airstrike(def, lane) {
    const s = defStats(def);
    const p = this.players[def.side];
    if (!s.airstrike || p.airstrikeUsed || this.over) return false;
    p.airstrikeUsed = true;
    this.strikes.push({ side: def.side, lane, d: 0, hit: new Set(), dmg: s.airstrikeDamage || 10, timer: 0 });
    this.emit({ type: 'airstrike', side: def.side, lane });
    return true;
  }

  playSabotage(side, id, lane = 0) {
    if (this.over) return false;
    const p = this.players[side];
    const c = CONFIG.sabotage[id];
    if (!c || !p.hand.includes(id)) return false;
    if (p.energy < c.cost || this.cooldownLeft(side, id) > 0) return false;
    p.energy -= c.cost;
    p.spent.attack += c.cost;
    p.cooldowns[id] = this.t + c.cooldown;
    const enemy = 1 - side;
    // magic card levels (shop): +15% strength and duration per level
    const lv = 1 + 0.15 * (this.cardLevel(side, id) - 1);
    const dur = c.duration * lv, str = c.strength * lv;
    if (id === 'fog') this.fogUntil[enemy][lane] = this.t + dur;
    if (id === 'emp') this.empUntil[enemy] = this.t + dur;
    if (id === 'raise') p.raiseCharges += Math.round(str);
    if (id === 'vigor') for (const u of this.units) if (u.alive && !u.neutral && u.owner === side) { u.maxHp *= 1 + str; u.hp *= 1 + str; u.vigor = true; }
    if (id === 'warcry') this.warcryUntil[side] = this.t + dur;
    if (id === 'shield') { p.shieldHp = Math.round(str); p.shieldUntil = this.t + dur; }
    if (id === 'freeze') this.freezeUntil[side][lane] = this.t + dur;
    if (id === 'flare') {
      this.flareUntil[side] = this.t + dur;                       // reveal ghosts on my side
      this.fogUntil[side] = [0, 0, 0];                             // lift enemy fog from my lanes
      this.empUntil[side] = 0;                                     // reboot my machines
      this.freezeUntil[enemy] = [0, 0, 0];                         // thaw my undead frozen on their side
    }
    this.emit({ type: 'sabotage', id, side, enemy, lane });
    return true;
  }

  // ----- dev helpers -----
  devEnergy(side, n) { this.players[side].energy += n; }
  devHeal(side) { this.players[side].bunkerHp = this.players[side].bunkerMax; }
  devBoss() { this.spawnBoss(this.nextBoss(true)); }
  devSkipToEnd() { this.players[1].bunkerHp = 1; }

  // ----- coverage (AI + final wave) -----
  laneCoverage(side, laneIdx) {
    const samples = LANE_SAMPLES[side][laneIdx];
    let cov = 0;
    for (const def of this.defenders) {
      if (def.side !== side) continue;
      const s = defStats(def);
      if (def.type === 'commander') continue;
      const dps = def.type === 'drone' ? s.damage * s.fireRate * 0.6 : s.damage * Math.max(1, s.fireRate) * (s.splash ? 1.6 : 1) * (s.burst || 1);
      let inRange = 0;
      if (def.type === 'drone') inRange = samples.length * 0.35;
      else for (const p of samples) if (Math.hypot(p.x - def.x, p.y - def.y) <= s.range) inRange++;
      cov += dps * inRange * 0.75 / (CONFIG.global.tileSpeed);
    }
    return cov;
  }
  weakestLane(side) {
    let best = 0, bv = Infinity;
    for (let l = 0; l < 3; l++) {
      const v = this.laneCoverage(side, l) / Math.sqrt(LANES[side][l].length / 17);
      if (v < bv) { bv = v; best = l; }
    }
    return best;
  }

  // ----- simulation step -----
  update(dt) {
    if (this.over || this.paused) return;
    const g = CONFIG.global;
    this.t += dt;

    // income
    this.incomeTimer += dt;
    while (this.incomeTimer >= g.incomeInterval) {
      this.incomeTimer -= g.incomeInterval;
      for (let s = 0; s < 2; s++) this.players[s].energy += this.incomePerTick(s);
      this.emit({ type: 'income' });
    }

    // boss timeline
    const nb = this.nextBoss(false);
    if (nb && this.t >= nb.t) { this.spawnBoss(nb); this.bossIdx++; }
    this.updateWaves(dt);

    this.updateReveal();
    this.updateUnits(dt);
    if (this.over) return;
    this.updateDefenders(dt);
    this.updateBunkerTurrets(dt);
    this.updateProjectiles(dt);
    this.updateGrounds(dt);
    this.updateStrikes(dt);
    if (this.units.some(u => !u.alive)) this.units = this.units.filter(u => u.alive);

    if (!this.over && g.timeLimit > 0 && this.t >= g.timeLimit) {
      const a = this.players[0].bunkerHp, b = this.players[1].bunkerHp;
      this.finish(a > b ? 0 : b > a ? 1 : -1, 'time');
    }
    if (this.headless) this.events.length = 0;
  }

  // Automatic undead waves that attack BOTH bunkers (same wave mirrored), growing with time.
  // They belong to nobody: no soul energy for bunker hits, but defenders still earn kill rewards.
  waveComposition(n, t) {
    const g = CONFIG.global;
    const size = Math.round(g.waveSize + g.waveGrowthPerMin * t / 60);
    const pool = [['skeleton', 0], ['zombie', 50], ['bats', 90], ['pumpkin', 130], ['mummy', 170], ['gargoyle', 200]].filter(([, at]) => t >= at).map(([id]) => id);
    const out = [];
    let left = size;
    while (left > 0) {
      // mostly skeletons; tougher units become likelier later
      const id = Math.random() < 0.55 ? 'skeleton' : pool[Math.floor(Math.random() * pool.length)];
      out.push(id);
      left -= id === 'bats' ? 3 : id === 'skeleton' || id === 'zombie' ? 1 : 2;
    }
    return out;
  }
  updateWaves(dt) {
    const g = CONFIG.global;
    if (!g.wavesOn || this.tutorial || this.t < g.waveStart) return;
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.waveTimer = g.waveEvery;
    this.waveNo++;
    const lane = Math.floor(Math.random() * 3);
    const comp = this.waveComposition(this.waveNo, this.t);
    for (let side = 0; side < 2; side++) {
      comp.forEach((type, k) => {
        const c = CONFIG.undead[type];
        for (let i = 0; i < (c.swarmCount || 1); i++) this.spawnUnit(type, side, lane, -k * 0.6 - i * 0.3, null, null, true);
      });
    }
    this.emit({ type: 'wave', lane, n: this.waveNo, size: comp.length });
  }

  updateBunkerTurrets(dt) {
    for (let side = 0; side < 2; side++) {
      const p = this.players[side];
      const tur = BUNKER_LEVELS[p.bunkerLevel - 1]?.turret;
      if (!tur) continue;
      p.turretCd -= dt;
      if (p.turretCd > 0) continue;
      const b = BUNKER[side];
      let best = null, bd = Infinity;
      for (const u of this.units) {
        if (!u.alive || u.side !== side || (u.invisible && !u.revealed)) continue;
        const dd = Math.hypot(u.x - b.x, u.y - b.y);
        const score = dd - (u.invisible ? 3 : 0);   // shoot spotted ghosts first
        if (dd <= tur.range && score < bd) { bd = score; best = u; }
      }
      if (!best) continue;
      p.turretCd = 1 / tur.fireRate;
      this.emit({ type: 'bunkerShot', side, x: b.x, y: b.y, tx: best.x, ty: best.y });
      this.applyHit(best, tur.damage, !!tur.heavy, side);
    }
  }

  // next scheduled boss group: the fixed timeline, then a repeating cycle
  nextBoss(any) {
    if (this.tutorial && !any) return null;
    // every boss gets its own random offset per match, so they don't always land at the same second
    this.bossOffsets ??= [];
    const off = this.bossOffsets[this.bossIdx] ??= (Math.random() * 2 - 1) * (CONFIG.global.bossJitter || 0);
    if (this.bossIdx < BOSS_TIMELINE.length) { const b = BOSS_TIMELINE[this.bossIdx]; return { t: b.t + (b.t > 60 ? off : 0), units: b.units }; }
    const k = this.bossIdx - BOSS_TIMELINE.length;
    return { t: BOSS_CYCLE.start + k * BOSS_CYCLE.every + off, units: BOSS_CYCLE.units[k % BOSS_CYCLE.units.length] };
  }
  spawnBoss(b) {
    const lane = Math.floor(Math.random() * 3);
    for (let side = 0; side < 2; side++) {
      let k = 0;
      for (const [type, n] of b.units) for (let i = 0; i < n; i++) {
        const c = CONFIG.undead[type];
        for (let s = 0; s < (c.swarmCount || 1); s++) this.spawnUnit(type, side, lane, -k * 0.7 - s * 0.3, null, null, true);
        k++;
      }
    }
    this.emit({ type: 'boss', lane, units: b.units });
  }

  finish(winner, reason) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.endReason = reason;
    this.emit({ type: 'gameover', winner, reason });
  }

  // Ghosts are seen by: drones with thermal cameras, every bunker's searchlight, a Flare, or being
  // hit by an explosion. Once spotted they stay visible to all defenders for revealLinger seconds.
  updateReveal() {
    const g = CONFIG.global;
    const revealers = [[], []];
    for (const d of this.defenders) {
      if (d.type === 'drone') {
        const s = defStats(d);
        if (s.detect && !(this.empUntil[d.side] > this.t)) revealers[d.side].push({ x: d.drone.x, y: d.drone.y, r: s.range + 0.6 });
      }
    }
    // every defender senses ghosts that pass right next to it
    if (g.ghostSenseRadius > 0) for (const d of this.defenders) if (!(MACHINES.includes(d.type) && this.empUntil[d.side] > this.t)) revealers[d.side].push({ x: d.x, y: d.y, r: g.ghostSenseRadius });
    // bunker searchlight (bunker level 2+)
    for (let side = 0; side < 2; side++) { const r = BUNKER_LEVELS[this.players[side].bunkerLevel - 1]?.reveal || 0; if (r > 0) revealers[side].push({ x: BUNKER[side].x, y: BUNKER[side].y, r }); }
    for (const u of this.units) {
      if (!u.invisible) continue;
      let seen = this.flareUntil[u.side] > this.t;
      if (!seen) for (const r of revealers[u.side]) if (Math.hypot(u.x - r.x, u.y - r.y) <= r.r) { seen = true; break; }
      if (seen) u.revealedUntil = this.t + g.revealLinger;
      u.revealed = (u.revealedUntil || 0) > this.t;
    }
  }

  updateUnits(dt) {
    const g = CONFIG.global;
    const sm = this.speedMult();
    for (const u of this.units) {
      if (!u.alive) continue;
      const c = CONFIG.undead[u.type];
      if (u.burnT > 0) {
        u.burnT -= dt;
        if (!u.armoured && u.shield <= 0) this.damage(u, u.burnDps * dt, false, true);
        if (!u.alive) continue;
      } else if (u.regen > 0 && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + u.regen * dt);
      }
      if (c.summon && u.d > 0.5) {
        u.summonT = (u.summonT ?? c.summonEvery) - dt;
        if (u.summonT <= 0) {
          u.summonT = c.summonEvery;
          for (let k = 0; k < 2; k++) { const m = this.spawnUnit(c.summon, u.side, u.lane, Math.max(0.2, u.d - 0.4 - k * 0.3), null, null, true); this.emit({ type: 'summon', x: m.x, y: m.y }); }
        }
      }
      if (this.freezeUntil[u.side][u.lane] > this.t) { u.frozen = true; this.positionUnit(u); continue; }
      u.frozen = false;
      u.d += c.speed * sm * g.tileSpeed * dt;
      const lane = LANES[u.side][u.lane];
      if (u.d >= lane.length) {
        u.alive = false;
        let dmg = c.bunkerDamage * this.bunkerMult();
        const p = this.players[u.side];
        if (p.shieldHp > 0 && p.shieldUntil > this.t) {
          const absorbed = Math.min(p.shieldHp, dmg); p.shieldHp -= absorbed; dmg -= absorbed;
          this.emit({ type: 'shieldBlock', side: u.side, amt: absorbed });
          if (dmg <= 0) continue;
        }
        p.bunkerHp = Math.max(0, p.bunkerHp - dmg);
        const reward = u.neutral ? 0 : dmg * g.bunkerDamageReward;
        if (!u.neutral) { const atk = this.players[u.owner]; atk.energy += reward; atk.damageDealt += dmg; }
        this.emit({ type: 'bunkerHit', side: u.side, dmg, unit: u, reward });
        if (p.bunkerHp <= 0) { this.finish(u.owner, 'bunker'); return; }
        continue;
      }
      this.positionUnit(u);
    }
  }

  // Is unit targetable by this defender?
  canTarget(def, s, u) {
    if (!u.alive || u.side !== def.side || u.d < 0.2) return false;
    if (this.fogUntil[u.side][u.lane] > this.t) return false;
    if (u.invisible && !u.revealed && !s.detect) return false;
    return true;
  }

  findTarget(def, s, range, ox = def.x, oy = def.y, mode = def.target) {
    let best = null, bv = -Infinity;
    for (const u of this.units) {
      if (!this.canTarget(def, s, u)) continue;
      const dist = Math.hypot(u.x - ox, u.y - oy);
      if (dist > range) continue;
      let v;
      const remaining = LANES[u.side][u.lane].length - u.d;
      if (mode === 'first') v = -remaining;
      else if (mode === 'last') v = remaining;
      else if (mode === 'strongest') v = u.hp * 1000 - remaining;
      else v = -dist;
      if (v > bv) { bv = v; best = u; }
    }
    return best;
  }

  // strongest commander aura covering this defender: { rate, dmg } multipliers (auras don't stack)
  aura(def) {
    let rate = 0, dmg = 0;
    for (const c of this.defenders) {
      if (c.type !== 'commander' || c.side !== def.side || c === def) continue;
      if (MACHINES.includes('commander') && this.empUntil[c.side] > this.t) continue;
      const s = CONFIG.defenders.commander.levels[c.level];
      if (Math.hypot(c.x - def.x, c.y - def.y) <= s.range) { rate = Math.max(rate, s.auraBoost || 0); dmg = Math.max(dmg, s.auraDamage || 0); }
    }
    return { rate: 1 + rate, dmg: 1 + dmg };
  }
  auraMult(def) { return this.aura(def).rate; }


  // level stats with the owner's shop card-level bonus applied to damage
  liveStats(def) {
    const base = CONFIG.defenders[def.type].levels[def.level];
    const pw = this.defenderPower(def.side, def.type) * (def.type === 'commander' ? 1 : this.aura(def).dmg) * (this.warcryUntil[def.side] > this.t ? 1 + CONFIG.sabotage.warcry.strength * (1 + 0.15 * (this.cardLevel(def.side, 'warcry') - 1)) : 1);
    if (pw === 1) return base;
    const key = def.side + def.type + def.level + '|' + pw.toFixed(3);
    this._stats ??= {};
    const hit = this._stats[key];
    if (hit && hit.base === base && hit.pw === pw && hit.dmg0 === base.damage) return hit.s;
    const s = { ...base, damage: base.damage * pw, burnDamage: base.burnDamage != null ? base.burnDamage * pw : base.burnDamage };
    this._stats[key] = { base, pw, dmg0: base.damage, s };
    return s;
  }

  updateDefenders(dt) {
    for (const def of this.defenders) {
      def.firing = Math.max(0, def.firing - dt);
      def.lunge = Math.max(0, def.lunge - dt);
      const s = this.liveStats(def);
      def.emped = MACHINES.includes(def.type) && this.empUntil[def.side] > this.t;
      if (def.emped) continue;
      if (def.type === 'commander') continue;
      const aura = this.auraMult(def);
      def.cooldown -= dt;

      if (def.type === 'drone') { this.updateDrone(def, s, dt, aura); continue; }

      // rifleman burst continuation
      if (def.burstLeft > 0) {
        def.burstTimer -= dt;
        if (def.burstTimer <= 0) {
          let t = def.burstTarget && this.canTarget(def, s, def.burstTarget) ? def.burstTarget : this.findTarget(def, s, s.range);
          if (t) this.hitscan(def, s, t, 'rifle');
          def.burstLeft--; def.burstTimer = 0.09;
        }
      }

      if (def.type === 'tank' && s.ram) {
        def.ramTimer -= dt;
      }

      if (def.cooldown > 0) continue;
      const target = this.findTarget(def, s, s.range);
      if (!target) { def.cooldown = 0; continue; }
      def.aimX = target.x - def.x; def.aimY = target.y - def.y;
      def.cooldown = 1 / (s.fireRate * aura);
      def.firing = 0.12;

      switch (def.type) {
        case 'rifleman':
          this.hitscan(def, s, target, 'rifle');
          if (s.burst > 1) { def.burstLeft = s.burst - 1; def.burstTimer = 0.09; def.burstTarget = target; }
          break;
        case 'mgnest':
          this.hitscan(def, s, target, 'mg');
          break;
        case 'sniper': {
          if (s.pierce > 1) {
            const len = Math.hypot(def.aimX, def.aimY) || 1;
            const nx = def.aimX / len, ny = def.aimY / len;
            const hits = [];
            for (const u of this.units) {
              if (!this.canTarget(def, s, u)) continue;
              const px = u.x - def.x, py = u.y - def.y;
              const along = px * nx + py * ny;
              if (along < 0 || along > s.range + 1) continue;
              const perp = Math.abs(px * ny - py * nx);
              if (perp < 0.45) hits.push({ u, along });
            }
            hits.sort((a, b) => a.along - b.along);
            const list = hits.slice(0, s.pierce).map(h => h.u);
            if (!list.includes(target)) list[list.length ? list.length - 1 : 0] = target;
            const last = list[list.length - 1];
            this.emit({ type: 'shot', weapon: 'sniper', def, x0: def.x, y0: def.y, x1: last.x, y1: last.y });
            for (const u of list) this.applyHit(u, s.damage, s.heavy, def.side);
          } else this.hitscan(def, s, target, 'sniper');
          break;
        }
        case 'samurai': {
          const victims = s.whirlwind ? this.units.filter(u => this.canTarget(def, s, u) && Math.hypot(u.x - def.x, u.y - def.y) <= s.range) : [target];
          this.emit({ type: 'slash', def, whirl: s.whirlwind, x: target.x, y: target.y });
          for (const u of victims) for (let h = 0; h < s.hits; h++) this.applyHit(u, s.damage, s.heavy, def.side);
          break;
        }
        case 'flamethrower': {
          const ang = Math.atan2(def.aimY, def.aimX);
          for (const u of this.units) {
            if (!this.canTarget(def, s, u)) continue;
            const dx = u.x - def.x, dy = u.y - def.y;
            const dist = Math.hypot(dx, dy);
            if (dist > s.range + 0.2) continue;
            let da = Math.abs(Math.atan2(dy, dx) - ang); if (da > Math.PI) da = 2 * Math.PI - da;
            if (da > 0.5 && dist > 0.6) continue;
            this.applyHit(u, s.damage, s.heavy, def.side);
            if (u.alive && !u.armoured) { u.burnT = s.burnDuration; u.burnDps = s.burnDamage; }
          }
          if (s.burningGround) {
            def.groundTimer -= 1 / s.fireRate;
            if (def.groundTimer <= 0) {
              def.groundTimer = 0.8;
              this.grounds.push({ side: def.side, x: target.x, y: target.y, r: 0.75, until: this.t + s.groundDuration, burnDps: s.burnDamage, burnDur: s.burnDuration, def });
              this.emit({ type: 'ground', x: target.x, y: target.y, until: this.t + s.groundDuration });
            }
          }
          this.emit({ type: 'flame', def, x: target.x, y: target.y, range: s.range });
          break;
        }
        case 'grenadier':
          this.projectiles.push({ kind: 'grenade', side: def.side, x0: def.x, y0: def.y, x: def.x, y: def.y, tx: target.x + target.dx * 0.5, ty: target.y + target.dy * 0.5, t: 0, dur: 0.55, dmg: s.damage, heavy: s.heavy, splash: s.splash, cluster: s.cluster, def, id: NEXT_ID++ });
          this.emit({ type: 'shot', weapon: 'grenade', def, x0: def.x, y0: def.y, x1: target.x, y1: target.y });
          break;
        case 'missile': {
          for (let m = 0; m < s.missiles; m++) {
            let t = target;
            if (m > 0) {
              const alt = this.units.find(u => u !== target && this.canTarget(def, s, u) && Math.hypot(u.x - def.x, u.y - def.y) <= s.range);
              if (alt) t = alt;
            }
            this.projectiles.push({ kind: 'missile', side: def.side, x: def.x, y: def.y, vx: 0, vy: 0, target: s.homing ? t : null, tx: t.x, ty: t.y, speed: 7, delay: m * 0.18, dmg: s.damage, heavy: s.heavy, splash: s.splash, def, id: NEXT_ID++, age: 0, launched: false });
          }
          break;
        }
        case 'tank': {
          if (s.ram && def.ramTimer <= 0) {
            def.ramTimer = s.ramCooldown;
            def.lunge = 1.0;
            const ax = def.x, ay = def.y, bx = target.x, by = target.y;
            const L = Math.hypot(bx - ax, by - ay) || 1;
            const nx = (bx - ax) / L, ny = (by - ay) / L;
            for (const u of this.units) {
              if (!this.canTarget(def, s, u)) continue;
              const px = u.x - ax, py = u.y - ay;
              const along = px * nx + py * ny;
              if (along < -0.3 || along > L + 0.8) continue;
              if (Math.abs(px * ny - py * nx) < 1.1) this.applyHit(u, s.ramDamage, true, def.side);
            }
            this.emit({ type: 'ram', def, x: bx, y: by });
          } else {
            this.projectiles.push({ kind: 'shell', side: def.side, x: def.x, y: def.y, target, tx: target.x, ty: target.y, speed: 16, dmg: s.damage, heavy: s.heavy, splash: 0, def, id: NEXT_ID++, age: 0, launched: true, delay: 0 });
            this.emit({ type: 'shot', weapon: 'tank', def, x0: def.x, y0: def.y, x1: target.x, y1: target.y });
          }
          break;
        }
      }
    }
  }

  updateDrone(def, s, dt, aura) {
    const dr = def.drone;
    // goal: the most advanced visible undead on our side that no other drone of ours has claimed
    // this tick (so several drones spread out instead of stacking on one target)
    this._droneClaims ??= new Set();
    if (this._droneClaimT !== this.t) { this._droneClaims.clear(); this._droneClaimT = this.t; }
    let goal = null, bv = -Infinity, any = null, av = -Infinity;
    for (const u of this.units) {
      if (!this.canTarget(def, s, u)) continue;
      const v = u.d / LANES[u.side][u.lane].length;
      if (v > av) { av = v; any = u; }
      if (!this._droneClaims.has(u.id) && v > bv) { bv = v; goal = u; }
    }
    goal ??= any;
    let gx, gy;
    if (goal) {
      this._droneClaims.add(goal.id);
      const a = def.id * 2.4;   // each drone hovers on its own side of the target
      gx = goal.x + Math.cos(a) * 0.7; gy = goal.y + Math.sin(a) * 0.7;
    } else { const a = this.t * 0.8 + def.id; gx = def.x + Math.cos(a) * 1.2; gy = def.y + Math.sin(a) * 1.2; }
    // keep a little distance from our other drones
    for (const o of this.defenders) {
      if (o === def || o.type !== 'drone' || o.side !== def.side || !o.drone) continue;
      const ox = dr.x - o.drone.x, oy = dr.y - o.drone.y, od = Math.hypot(ox, oy);
      if (od < 1.1) { const push = (1.1 - od) / 1.1; gx += (od > 1e-3 ? ox / od : Math.cos(def.id)) * push * 1.2; gy += (od > 1e-3 ? oy / od : Math.sin(def.id)) * push * 1.2; }
    }
    const dx = gx - dr.x, dy = gy - dr.y, dist = Math.hypot(dx, dy);
    const sp = s.droneSpeed;
    if (dist > 0.1) { dr.x += dx / dist * Math.min(dist, sp * dt); dr.y += dy / dist * Math.min(dist, sp * dt); }
    def.aimX = dr.x - def.x; def.aimY = dr.y - def.y;
    if (def.cooldown <= 0) {
      const t = this.findTarget(def, s, s.range, dr.x, dr.y, 'closest');
      if (t) {
        def.cooldown = 1 / (s.fireRate * aura);
        this.emit({ type: 'shot', weapon: 'drone', def, x0: dr.x, y0: dr.y, x1: t.x, y1: t.y, drone: true });
        this.applyHit(t, s.damage, s.heavy, def.side);
      } else def.cooldown = 0;
    }
    if (s.bomb) {
      def.bombTimer -= dt;
      if (def.bombTimer <= 0) {
        const near = this.units.some(u => this.canTarget(def, s, u) && Math.hypot(u.x - dr.x, u.y - dr.y) <= s.splash);
        if (near) {
          def.bombTimer = s.bombInterval;
          this.projectiles.push({ kind: 'bomb', side: def.side, x: dr.x, y: dr.y, t: 0, dur: 0.45, dmg: s.bombDamage, heavy: false, splash: s.splash, def, id: NEXT_ID++ });
        } else def.bombTimer = 0.3;
      }
    }
  }

  hitscan(def, s, target, weapon) {
    this.emit({ type: 'shot', weapon, def, x0: def.x, y0: def.y, x1: target.x, y1: target.y });
    this.applyHit(target, s.damage, s.heavy, def.side);
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      if (p.kind === 'grenade' || p.kind === 'bomb') {
        p.t += dt;
        if (p.kind === 'grenade') {
          const k = Math.min(1, p.t / p.dur);
          p.x = p.x0 + (p.tx - p.x0) * k; p.y = p.y0 + (p.ty - p.y0) * k; p.h = Math.sin(k * Math.PI) * 1.6;
        } else { p.h = 1.6 * (1 - p.t / p.dur); }
        if (p.t >= p.dur) {
          const x = p.kind === 'grenade' ? p.tx : p.x, y = p.kind === 'grenade' ? p.ty : p.y;
          this.explode(p.side, x, y, p.splash, p.dmg, p.heavy, p.kind);
          if (p.cluster) {
            for (let k = 0; k < p.cluster; k++) {
              const a = k / p.cluster * Math.PI * 2 + Math.random();
              this.projectiles.push({ kind: 'cluster', side: p.side, x0: x, y0: y, x, y, tx: x + Math.cos(a) * 1.1, ty: y + Math.sin(a) * 1.1, t: 0, dur: 0.3, dmg: 1, heavy: false, splash: 0.7, id: NEXT_ID++ });
            }
          }
          continue;
        }
        keep.push(p);
      } else if (p.kind === 'cluster') {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.x = p.x0 + (p.tx - p.x0) * k; p.y = p.y0 + (p.ty - p.y0) * k; p.h = Math.sin(k * Math.PI) * 0.7;
        if (p.t >= p.dur) { this.explode(p.side, p.tx, p.ty, p.splash, p.dmg, p.heavy, 'cluster'); continue; }
        keep.push(p);
      } else {
        // missile / shell
        if (p.delay > 0) { p.delay -= dt; keep.push(p); continue; }
        if (!p.launched) { p.launched = true; this.emit({ type: 'shot', weapon: 'missile', def: p.def, x0: p.x, y0: p.y, x1: p.tx, y1: p.ty }); }
        p.age += dt;
        if (p.target) {
          if (p.target.alive) { p.tx = p.target.x; p.ty = p.target.y; }
          else if (p.kind === 'missile') {
            // homing: pick a new target
            const s = defStats(p.def);
            const nt = this.findTarget(p.def, s, 99, p.x, p.y, 'closest');
            if (nt) { p.target = nt; p.tx = nt.x; p.ty = nt.y; } else p.target = null;
          }
        }
        const dx = p.tx - p.x, dy = p.ty - p.y, dist = Math.hypot(dx, dy);
        const step = p.speed * dt;
        p.h = p.kind === 'missile' ? 0.9 + Math.min(1, p.age * 2) * 0.6 * Math.min(1, dist / 2) : 0.6;
        if (dist <= step) {
          if (p.kind === 'shell') {
            if (p.target && p.target.alive) this.applyHit(p.target, p.dmg, p.heavy, p.side);
            this.emit({ type: 'explosion', x: p.tx, y: p.ty, r: 0.45, kind: 'shell' });
          } else this.explode(p.side, p.tx, p.ty, p.splash, p.dmg, p.heavy, 'missile');
          continue;
        }
        p.vx = dx / dist; p.vy = dy / dist;
        p.x += p.vx * step; p.y += p.vy * step;
        keep.push(p);
      }
    }
    this.projectiles = keep;
  }

  explode(side, x, y, r, dmg, heavy, kind) {
    this.emit({ type: 'explosion', x, y, r, kind });
    for (const u of this.units) {
      if (!u.alive || u.side !== side || u.d < 0.2) continue;
      if (this.fogUntil[u.side][u.lane] > this.t) continue;
      // explosions hit everything in the blast — including invisible ghosts, which get exposed
      if (Math.hypot(u.x - x, u.y - y) <= r + 0.25) { if (u.invisible) u.revealedUntil = this.t + CONFIG.global.revealLinger; this.applyHit(u, dmg, heavy, side); }
    }
  }

  updateGrounds(dt) {
    if (!this.grounds.length) return;
    this.grounds = this.grounds.filter(gr => gr.until > this.t);
    for (const gr of this.grounds) {
      for (const u of this.units) {
        if (!u.alive || u.side !== gr.side || u.armoured || u.flying) continue;
        if (Math.hypot(u.x - gr.x, u.y - gr.y) <= gr.r) { u.burnT = Math.max(u.burnT, gr.burnDur * 0.5); u.burnDps = Math.max(u.burnDps, gr.burnDps); }
      }
    }
  }

  updateStrikes(dt) {
    if (!this.strikes.length) return;
    const keep = [];
    for (const st of this.strikes) {
      const lane = LANES[st.side][st.lane];
      st.timer -= dt;
      if (st.timer <= 0) {
        st.timer = 0.12;
        st.d += 1.3;
        lanePoint(lane, st.d, tmp);
        this.emit({ type: 'explosion', x: tmp.x, y: tmp.y, r: 1.3, kind: 'airstrike' });
        for (const u of this.units) {
          if (!u.alive || u.side !== st.side || u.lane !== st.lane || st.hit.has(u.id)) continue;
          if (Math.hypot(u.x - tmp.x, u.y - tmp.y) <= 1.6) { st.hit.add(u.id); this.applyHit(u, st.dmg, true, st.side, true); }
        }
      }
      if (st.d < lane.length) keep.push(st);
    }
    this.strikes = keep;
  }

  applyHit(u, dmg, heavy, bySide, ignoreShield = false) {
    if (!u.alive) return;
    if (u.armoured && !heavy) { this.emit({ type: 'blocked', x: u.x, y: u.y, unit: u }); return; }
    if (u.shield > 0 && !ignoreShield) { u.shield--; this.emit({ type: 'shieldHit', x: u.x, y: u.y, unit: u }); return; }
    this.damage(u, dmg, heavy, false);
  }

  damage(u, amt, heavy, isBurn) {
    if (!u.alive) return;
    u.hp -= amt;
    if (!isBurn) this.emit({ type: 'dmg', x: u.x, y: u.y, amt, unit: u });
    if (u.hp <= 0.0001) this.kill(u);
  }

  kill(u) {
    u.alive = false;
    const c = CONFIG.undead[u.type];
    const defender = this.players[u.side];
    const reward = c.killReward * CONFIG.global.killRewardMult;
    defender.energy += reward;
    defender.kills++;
    this.emit({ type: 'kill', unit: u, reward, x: u.x, y: u.y });
    if (c.splitType) {
      for (let k = 0; k < c.splitCount; k++) {
        const ch = this.spawnUnit(c.splitType, u.side, u.lane, Math.max(0.25, u.d - k * 0.3), u, c.splitHealth);
        ch.offset = (k - (c.splitCount - 1) / 2) * 0.35;
        this.positionUnit(ch);
      }
      this.emit({ type: 'split', unit: u });
    }
    const atk = this.players[u.owner];
    if (!u.neutral && atk.raiseCharges > 0 && !u.revived) {
      atk.raiseCharges--;
      const r = this.spawnUnit(u.type, u.side, u.lane, u.d, null);
      r.revived = true;
      this.emit({ type: 'raise', unit: r, x: u.x, y: u.y });
    }
  }
}
