import { CONFIG, cardKind, applyTuning, DEV_MENU_ENABLED } from './config.js';
import { Game } from './sim.js';
import { AI, aiPickHand } from './ai.js';
import { Stage } from './render/scene.js';
import { View } from './render/view.js';
import { renderPortraits } from './render/portraits.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { DevMenu } from './devmenu.js';
import { loadAssets } from './assets.js';
import { progress, save, grantStartingCoins, unlockedCards, awardMatch, logMatch, fillHand, aiSkill, aiRating, aiCardLevels, aiBunkerLevel, randomArena } from './progress.js';
import { setArena, ARENA, ARENAS } from './arena.js';

class App {
  constructor() {
    grantStartingCoins();
    this.canvas = document.getElementById('game');
    this.audio = new Audio();
    this.audio.setMuted(progress.muted);
    this.stage = new Stage(this.canvas);
    this.view = new View(this.stage, document.getElementById('fx-layer'), this.audio);
    this.ui = new UI(this);
    this.dev = DEV_MENU_ENABLED ? new DevMenu(this) : null;
    this.paused = false;
    this.ui.portraits = renderPortraits();
    // generated card art / title art / announcer replace the fallbacks once loaded
    loadAssets().then(a => {
      Object.assign(this.ui.portraits, a.cards);
      this.ui.titleArt = a.ui.title;
      this.audio.setVoices(a.voice);
      this.audio.setSamples(a.sfx);
      this.audio.setTracks(a.music);
      if (this.demo) this.ui.refreshArt?.();
    });
    this.game = null;
    this.ai = null;
    this.acc = 0;
    this.last = performance.now();
    this.view.onPlayerBunkerHit = () => this.ui.flashDamage();
    this.view.onBoss = (e, big) => {
      if (this.demo) return;
      this.audio.voice('wave');
      const names = e.units.map(([t, n]) => `${n > 1 ? n + '× ' : ''}${CONFIG.undead[t].name}`).join(' + ');
      this.ui.toast(`☠ ${names} — on both sides!`);
      if (big) this.ui.flashDamage();
    };
    this.canvas.addEventListener('pointerdown', e => { if (e.button === 0) this.ui.canvasClick(e); });
    this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.ui.disarm(); });
    this.canvas.addEventListener('pointermove', e => this.ui.aimMove(e));
    window.addEventListener('keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const inBattle = this.game && !this.demo && !this.game.over;
      if (e.key === 'Escape') {
        if (this.paused) this.setPaused(false);
        else if (this.ui.armed || this.ui.squad) this.ui.disarm();
        else if (inBattle) this.setPaused(true);
      } else if ((e.key === 'p' || e.key === 'P') && inBattle) this.setPaused(!this.paused);
    });
    // browsers only allow sound after the first click / key press: start the menu song right then
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true);
      this.audio.init();
      if (this.demo) this.audio.startMenuMusic();
    };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
    // idle demo: a quiet AI-vs-AI skirmish behind the menus, in the selected arena
    this.selectArena(ARENAS[Math.floor(Math.random() * ARENAS.length)].id);   // menu backdrop
    this.ui.showTitle();
    const ld = document.getElementById('loading'); ld.style.opacity = 0; setTimeout(() => ld.remove(), 700);
    requestAnimationFrame(t => this.frame(t));
  }

  // switch the battlefield (rules + scene + view helpers)
  selectArena(id) {
    if (ARENA.id !== id || !this.game) {
      setArena(id);
      this.view.reset();
      this.stage.setArena(id);
      this.view.buildArenaHelpers();
    }
    this.startDemo();
  }

  startDemo() {
    this.view.reset();
    const pool = unlockedCards();
    this.demo = true;
    this.game = new Game({ hands: [aiPickHand(pool), aiPickHand(pool)] });
    this.game.headless = false;
    this.stage.bunkers.forEach(b => { b.turret.visible = false; });
    this.ais = [new AI(this.game, 0, 0.4), new AI(this.game, 1, 0.4)];
    this.ai = null;
  }

  // first launch: a guided practice round (no CPU, no waves), then the real battle
  startTutorial() { this.startMatch(fillHand(progress.hand), { tutorial: true }); }

  startMatch(hand, opts = {}) {
    hand = fillHand(hand);
    this.ui.clear();
    // a random unlocked arena every battle (the tutorial always uses the first one)
    const arena = opts.tutorial ? ARENAS[0] : randomArena();
    if (ARENA.id !== arena.id) { setArena(arena.id); this.stage.setArena(arena.id); this.view.buildArenaHelpers(); }
    this.view.reset();
    this.demo = false;
    // the CPU adapts on its own: gentle for new players, sharper with rank and win streaks
    const skill = this.aiSkill = aiSkill();
    const aiHand = aiPickHand([...new Set([...unlockedCards(), 'sniper', 'flare'])]);   // the CPU always has ghost detection
    this.game = new Game({
      hands: [hand, aiHand], difficulty: `Lv ${aiRating(skill)}`,
      mods: [
        { cardLevels: { ...progress.cardLevels }, bunkerLevel: progress.bunkerLevel },
        { cardLevels: aiCardLevels(skill), bunkerLevel: aiBunkerLevel(skill), incomeMult: 0.78 + 0.4 * skill },
      ],
    });
    this.stage.bunkers.forEach((b, i) => { b.turret.visible = this.game.players[i].bunkerLevel >= 3; });
    this.ai = new AI(this.game, 1, skill);
    this.ais = [this.ai];
    this.endShown = false;
    this.ui.showHUD(this.game);
    this.ui.initHints(false);
    if (opts.tutorial) {
      this.game.tutorial = true;
      this.ais = []; this.ai = null;
      this.game.players[0].energy = 300;
      this.ui.startTutorial(this.game);
    }
    this.audio.init();
    this.audio.setIntensity(1);
    this.audio.startMusic();
    this.audio.play('horn');
    this.audio.preloadVoices();
    this.audio.voice(opts.tutorial ? 'tutorial' : 'start');
    if (!opts.tutorial) this.ui.banner(arena.name);
    this.bunkerWarned = false;
  }

  toMenu() {
    this.paused = false; this.ui.showPause?.(false);
    this.audio.stopMusic();
    this.audio.startMenuMusic();
    this.startDemo();
    this.ui.showHome();
  }

  setPaused(on) {
    if (!this.game || this.demo || this.game.over) on = false;
    this.paused = on;
    this.ui.disarm?.();
    this.ui.showPause(on);
    if (this.audio.music) this.audio.music.gain.setTargetAtTime(on ? 0.1 : 0.32, this.audio.ctx?.currentTime || 0, 0.2);
  }
  // leave a battle early: counts as a loss with no rewards (the tutorial just ends)
  quitBattle() {
    const g = this.game;
    this.setPaused(false);
    if (g && !this.demo && !g.over) {
      if (g.tutorial) { progress.tutorialDone = true; save(); this.ui.tut?.el?.remove(); (this.ui.tut?.pts || []).forEach(e => e.remove()); this.ui.tut = null; }
      else {
        progress.matches++; progress.streak = Math.min(-1, progress.streak - 1); save();
        logMatch({ t: g.t, winner: 1, reason: 'quit', difficulty: g.difficulty, arena: ARENA.id, date: new Date().toLocaleString() });
      }
      g.over = true;
    }
    this.toMenu();
  }

  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    if (g && this.paused) { this.stage.render(0); return; }
    if (g) {
      const speed = this.demo ? 1 : CONFIG.global.gameSpeed;
      this.acc += dt * speed;
      const step = 1 / 60;
      let n = 0;
      while (this.acc >= step && n < 16) {
        for (const ai of this.ais) ai.update(step);
        g.update(step);
        this.acc -= step; n++;
      }
      if (this.acc > step * 4) this.acc = 0;
      this.view.silent = this.demo;
      this.view.update(g, dt);
      if (!this.demo) {
        this.ui.updateHUD(g);
        if (!this.bunkerWarned && !g.over && g.players[0].bunkerHp <= g.players[0].bunkerMax * 0.3) { this.bunkerWarned = true; this.audio.voice('bunkerlow'); }
        if (g.over && !this.endShown && !g.tutorial) {
          this.endShown = true;
          this.ui.disarm(); this.ui.hideAimTip(); this.ui.hideCardTip();
          const won = g.winner === 0;
          logMatch({ t: g.t, winner: g.winner, reason: g.endReason, difficulty: g.difficulty, arena: ARENA.id, date: new Date().toLocaleString() });
          const award = awardMatch(won, g.players[0]);
          // auto-add a newly unlocked card if hand has a duplicate kind surplus? keep player's hand; they can swap.
          setTimeout(() => { this.audio.play(won ? 'win' : 'lose'); this.audio.voice(won ? 'victory' : 'defeat'); this.audio.setIntensity(1); this.ui.showResults(g, award); }, 2600);
        }
      } else if (g.over || g.t > 150) {
        this.startDemo();
      }
    }
    this.stage.render(dt);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  // designer tuning from the dev menu overrides the code defaults
  try { const r = await fetch(import.meta.env.BASE_URL + 'tuning.json', { cache: 'no-store' }); if (r.ok) applyTuning(await r.json()); } catch { /* no tuning file */ }
  try { window.app = new App(); }
  catch (e) { console.error(e); document.getElementById('loading').querySelector('.ld-sub').textContent = 'Failed to start: ' + e.message; }
});
void cardKind;
