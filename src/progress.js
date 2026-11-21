// Player progress saved in localStorage: coins, owned cards, card levels, rank (XP), hand.
// Cards are bought and upgraded in the shop with coins earned from battles.
import { STARTER_UNLOCKS, UNLOCK_ORDER, CONFIG, DEFAULT_CONFIG, cardKind, ALL_CARDS, BUNKER_LEVELS } from './config.js';
import { ARENAS } from './arena.js';

const KEY = 'holdTheLine.progress.v1';
export const XP_PER_LEVEL = 100;
export const MAX_CARD_LEVEL = 5;
export const HAND_ATTACK = 4;   // undead slots
export const HAND_DEFENCE = 4;  // defender slots
export const HAND_MAGIC = 3;    // magic (spell) slots
export const GROUPS = ['attack', 'defence', 'magic'];
export const GROUP_SIZE = { attack: HAND_ATTACK, defence: HAND_DEFENCE, magic: HAND_MAGIC };

function fresh() {
  return {
    xp: 0, level: 1, matches: 0, wins: 0, streak: 0, coins: 0,
    owned: STARTER_UNLOCKS.slice(), cardLevels: {}, bunkerLevel: 1, arena: 'graveyard', name: 'Commander', avatar: 'rifleman',
    bestStreak: 0, totalDamage: 0, totalKills: 0, tutorialDone: false, startCoinsGiven: false,
    hand: STARTER_UNLOCKS.slice(), difficulty: 'medium', firstMatchDone: false, log: [], muted: false,
  };
}

export const progress = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      // older saves unlocked a card per level: keep those cards
      if (!p.owned) p.owned = [...STARTER_UNLOCKS, ...UNLOCK_ORDER.slice(0, (p.level || 1) - 1)];
      for (const c of STARTER_UNLOCKS) if (!p.owned.includes(c)) p.owned.push(c);   // new starter spells
      if (p.startCoinsGiven === undefined && (p.matches || 0) > 0) p.startCoinsGiven = true;   // existing players already have coins
      return Object.assign(fresh(), p);
    }
  } catch { /* ignore */ }
  return fresh();
}
// New players get CONFIG.global.startingCoins once (called after the tuning file is loaded).
export function grantStartingCoins() {
  if (progress.startCoinsGiven) return;
  progress.coins += CONFIG.global.startingCoins;
  progress.startCoinsGiven = true;
  save();
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* ignore */ } }
export function resetProgress() { Object.assign(progress, fresh()); save(); }

export const cardGroup = id => { const k = cardKind(id); return k === 'undead' ? 'attack' : k === 'defender' ? 'defence' : 'magic'; };
export const isAttackCard = id => cardGroup(id) === 'attack';

export function unlockedCards() {
  const set = new Set(progress.owned);
  // dev-menu overrides
  for (const [k, v] of Object.entries(CONFIG.undead)) if (v.unlocked && !v.hidden) set.add(k);
  for (const [k, v] of Object.entries(CONFIG.defenders)) if (v.unlocked) set.add(k);
  for (const [k, v] of Object.entries(CONFIG.sabotage)) if (v.unlocked) set.add(k);
  return ALL_CARDS.filter(c => set.has(c));
}

// ---------- shop ----------
export function cardPrice(id) {
  const k = cardKind(id);
  if (k === 'undead') return 60 + DEFAULT_CONFIG.undead[id].cost * 3;          // pumpkin 150 … dragon 660
  if (k === 'defender') return 80 + Math.round(DEFAULT_CONFIG.defenders[id].levels[0].cost * 2.2);
  return 220;                                                                     // sabotage
}
export const cardLevel = id => progress.cardLevels[id] || 1;
export const upgradePrice = id => [0, 60, 120, 220, 380][cardLevel(id)] ?? null;  // to reach level 2..5
export function buyCard(id) {
  if (progress.owned.includes(id) || progress.coins < cardPrice(id)) return false;
  progress.coins -= cardPrice(id);
  progress.owned.push(id);
  save();
  return true;
}
export function upgradeCard(id) {
  const lv = cardLevel(id), price = upgradePrice(id);
  if (!unlockedCards().includes(id) || lv >= MAX_CARD_LEVEL || progress.coins < price) return false;
  progress.coins -= price;
  progress.cardLevels[id] = lv + 1;
  save();
  return true;
}
export const cardBonusText = id => {
  const lv = cardLevel(id);
  if (lv <= 1) return '';
  const g = cardGroup(id);
  return g === 'attack' ? `+${(lv - 1) * 10}% health` : g === 'defence' ? `+${(lv - 1) * 8}% damage` : `+${(lv - 1) * 15}% power & duration`;
};

// ---------- bunker ----------
export const bunkerUpgradePrice = () => BUNKER_LEVELS[progress.bunkerLevel]?.price ?? null;
export function upgradeBunker() {
  const price = bunkerUpgradePrice();
  if (price == null || progress.coins < price) return false;
  progress.coins -= price; progress.bunkerLevel++; save(); return true;
}

// ---------- arenas (unlock by rank) ----------
export const arenaUnlocked = () => true;   // all arenas are in the random rotation
// Every battle picks a random arena from all five, never the same one twice in a row
// (the last arena is saved, so this holds across reloads too).
export function randomArena() {
  const pool = ARENAS.filter(a => a.id !== progress.lastArena);
  const a = pool[Math.floor(Math.random() * pool.length)];
  progress.lastArena = a.id; save();
  return a;
}

// ---------- adaptive CPU ----------
// 0 (gentle) … 1 (sharp). Starts easy for new players and rises with rank and win streaks;
// a losing streak brings it back down. The menu difficulty shifts the whole range.
export function aiSkill() {
  const base = 0.18;
  const rank = Math.min(0.55, (progress.level - 1) * 0.045);
  const streak = Math.max(-0.2, Math.min(0.15, progress.streak * 0.05));
  return Math.max(0, Math.min(1, base + rank + streak));
}
export const aiRating = s => Math.max(1, Math.round(1 + s * 9)); // shown as "Lv 1–10"
// Card levels the CPU plays with, so its units keep pace with the player's upgrades.
export function aiBunkerLevel(skill) { return Math.max(1, Math.min(5, Math.round(progress.bunkerLevel * (0.7 + skill * 0.5)))); }
export function aiCardLevels(skill) {
  const avg = Object.values(progress.cardLevels).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(progress.cardLevels).length) || 1;
  const lv = Math.max(1, Math.min(MAX_CARD_LEVEL, Math.round(avg * (0.6 + skill * 0.6))));
  return Object.fromEntries(ALL_CARDS.map(c => [c, lv]));
}

// ---------- after a match ----------
// returns { xpGained, levelsGained, coins, breakdown }
export function awardMatch(won, stats) {
  const xpGained = (won ? 120 : 70) + Math.min(30, Math.round(stats.damageDealt / 3));
  const breakdown = [
    [won ? 'Victory' : 'Battle fought', won ? 100 : 40],
    ['Bunker damage', Math.round(stats.damageDealt * 1.5)],
    ['Undead destroyed', Math.round(stats.kills * 0.4)],
  ];
  const coins = breakdown.reduce((a, [, v]) => a + v, 0);
  progress.coins += coins;
  progress.xp += xpGained;
  progress.matches++;
  if (won) progress.wins++;
  progress.streak = won ? Math.max(1, progress.streak + 1) : Math.min(-1, progress.streak - 1);
  progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
  progress.totalDamage += Math.round(stats.damageDealt); progress.totalKills += stats.kills;
  const arenasBefore = ARENAS.filter(arenaUnlocked).length;
  let levels = 0;
  while (progress.xp >= progress.level * XP_PER_LEVEL) { progress.level++; levels++; }
  progress.firstMatchDone = true;
  const newArenas = [];
  save();
  return { xpGained, levelsGained: levels, coins, breakdown, newArenas };
}
export function xpIntoLevel() {
  const prev = (progress.level - 1) * XP_PER_LEVEL;
  return { into: progress.xp - prev, need: XP_PER_LEVEL * progress.level - prev };
}
export function logMatch(entry) {
  progress.log.unshift(entry);
  progress.log = progress.log.slice(0, 50);
  save();
}
// Hand = up to 4 attack (undead) + 4 defence + 3 magic cards, all owned.
export function validHand(hand) {
  const un = unlockedCards();
  const h = [...new Set((hand || []).filter(c => un.includes(c) && cardKind(c)))];
  return GROUPS.flatMap(g => h.filter(c => cardGroup(c) === g).slice(0, GROUP_SIZE[g]));
}
// Fill empty slots with owned cards so a match never starts short-handed.
export function fillHand(hand) {
  const h = validHand(hand);
  for (const c of unlockedCards()) {
    if (h.includes(c)) continue;
    if (h.filter(x => cardGroup(x) === cardGroup(c)).length < GROUP_SIZE[cardGroup(c)]) h.push(c);
  }
  return validHand(h);
}
