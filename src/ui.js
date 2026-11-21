import { CONFIG, cardKind, ALL_CARDS, BUNKER_LEVELS, DEV_MENU_ENABLED } from './config.js';
import { LANES, LANE_NAMES, distToLane, W, H, HALF, GATES, ARENAS, LANE_LEN_WORD } from './arena.js';
import { defStats, TARGET_MODES } from './sim.js';
import {
  progress, save, unlockedCards, xpIntoLevel, validHand, fillHand, isAttackCard, HAND_ATTACK, HAND_DEFENCE, GROUPS, GROUP_SIZE, cardGroup,
  cardPrice, cardLevel, upgradePrice, buyCard, upgradeCard, cardBonusText, MAX_CARD_LEVEL,
  bunkerUpgradePrice, upgradeBunker, arenaUnlocked,
} from './progress.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const GROUP_LABEL = { attack: 'Attack', defence: 'Defence', magic: 'Magic' };
const GROUP_CLS = { attack: 'atk', defence: 'def', magic: 'mag' };
const rowsHtml = (cls) => GROUPS.map(g => `<div class="deck-row"><div class="deck-label ${GROUP_CLS[g]}">${GROUP_LABEL[g]}</div><div class="${cls}" data-g="${g}"></div></div>`).join('');
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SPECIAL = {
  skeleton: 'Cheap and basic.', zombie: 'Fast runner.', bats: 'Comes as a swarm of 5.',
  pumpkin: 'Bursts into 3 Pumpkin Imps.', gargoyle: 'Stone skin blocks the first 3 hits.',
  ghost: 'Invisible — seen by Sniper L2, Drone L2, upgraded bunker searchlights, explosions and Flare.', mummy: 'Regenerates unless burning.',
  golem: 'Armoured: only heavy weapons hurt it.', horseman: 'When the horse falls, the rider keeps walking.',
  dragon: 'Boss. Breaks into 4 Stone Gargoyles.',
};
export function cardInfo(id) {
  const k = cardKind(id);
  if (k === 'undead') { const c = CONFIG.undead[id]; return `<b>${c.name}</b> · ${c.cost} soul · Health ${c.health}${c.swarmCount ? '×' + c.swarmCount : ''} · Speed ${c.speed} · Bunker dmg ${c.bunkerDamage} — ${SPECIAL[id] || ''}`; }
  if (k === 'defender') { const c = CONFIG.defenders[id], s = c.levels[0]; return `<b>${c.name}</b> · ${s.cost} soul · ${c.role}. Dmg ${s.damage} · Range ${s.range} · ${s.fireRate}/s${s.heavy ? ' · Heavy' : ''}${c.max === 1 ? ' · Max 1' : ''}`; }
  const c = CONFIG.sabotage[id]; return `<b>${c.name}</b> · ${c.cost} soul · ${c.desc}. Cooldown ${c.cooldown}s.`;
}
function escapeHtml(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cardName(id) { const k = cardKind(id); return (k === 'undead' ? CONFIG.undead : k === 'defender' ? CONFIG.defenders : CONFIG.sabotage)[id].name; }

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.portraits = {};
    this.drag = null;
    this.panel = null;
    this.hints = [];
  }
  clear() {
    this.root.innerHTML = ''; this.panel = null;
    // these live on <body>, not in the UI root, so remove them explicitly
    this.hideAimTip(); this.hideCardTip?.();
    document.querySelectorAll('body > .drag-tip, body > .drag-ghost, body > .hint').forEach(e => e.remove());
    this.drag = null; this.armed = null; this.squad = null;
    this.app.view?.clearPreview?.();
  }

  cardEl(id, cost = null, showLevel = true) {
    const k = cardKind(id);
    const src = this.portraits[id] || '';
    const lv = cardLevel(id);
    const el = $(`<div class="card ${k}" data-id="${id}">
      <img src="${src}" class="${src.startsWith('data:') ? '' : 'art'}" alt="">
      <div class="name">${cardName(id)}</div>
      <div class="cost"><span>${cost ?? this.baseCost(id)}</span></div>
      ${showLevel && unlockedCards().includes(id) ? `<div class="lvl-badge l${lv}">Lv ${lv}</div>` : ''}
      <div class="frame"></div></div>`);
    return el;
  }
  // Scale a menu screen's content so it always fits the window — no scrolling.
  // `layouts` (optional): functions that rearrange the content; the one giving the biggest fit wins.
  fitScreen(el, layouts = null) {
    const inner = el.querySelector('.fit'); if (!inner) return;
    const zoomFor = () => {
      inner.style.zoom = 1;
      const top = 64, availH = window.innerHeight - top - 14 - (el.classList.contains('with-tut') ? 185 : 0), availW = window.innerWidth - 150;
      return Math.min(1.2, availH / inner.scrollHeight, availW / inner.scrollWidth);
    };
    const doFit = () => {
      if (!inner.isConnected) { window.removeEventListener('resize', doFit); return; }
      let z;
      if (layouts) {
        let best = 0, bz = -1;
        layouts.forEach((apply, k) => { apply(); const zz = zoomFor(); if (zz > bz) { bz = zz; best = k; } });
        layouts[best](); z = zoomFor();
      } else z = zoomFor();
      inner.style.zoom = Math.max(0.45, z).toFixed(3);
    };
    doFit();
    requestAnimationFrame(doFit);
    window.addEventListener('resize', doFit);
    this.refit = doFit;
  }
  coinsChip() { return `<div class="chip coins stroke">🪙 <span>${progress.coins}</span></div>`; }
  topBar(back) {
    const { into, need } = xpIntoLevel();
    const el = $(`<div class="topbar">
      ${back ? '<button class="btn small grey" data-a="back">‹ Home</button>' : `<div class="profile-chip" data-a="chip"><div class="avatar"><img src="${this.portraits[progress.avatar] || ''}"><div class="badge stroke">${progress.level}</div></div><div><div class="pname">${escapeHtml(progress.name)}</div><div class="xpbar"><div style="width:${Math.round(into / need * 100)}%"></div></div></div></div>`}
      <div class="spacer"></div>${this.coinsChip()}</div>`);
    const b = el.querySelector('[data-a=back]'); if (b) b.onclick = () => { this.app.audio.play('click'); this.showHome(); };
    const pc = el.querySelector('[data-a=chip]'); if (pc) pc.onclick = () => { this.app.audio.play('click'); this.showProfile(); };
    return el;
  }
  baseCost(id) { const k = cardKind(id); return k === 'undead' ? CONFIG.undead[id].cost : k === 'defender' ? CONFIG.defenders[id].levels[0].cost : CONFIG.sabotage[id].cost; }

  // ================= TITLE =================
  showTitle() {
    this.clear();
    const el = $(`<div class="screen menu-screen title-screen${this.titleArt ? ' has-art' : ''}"${this.titleArt ? ` style="--title-art:url('${this.titleArt}')"` : ''}>
      <div class="title">HOLD THE LINE</div>
      <div class="subtitle">Undead vs. the last bunker</div>
      <button class="btn big" data-a="play">▶ Play</button>
    </div>`);
    el.querySelector('[data-a=play]').onclick = () => {
      this.app.audio.init(); this.app.audio.play('click');
      if (!progress.tutorialDone) { this.app.startTutorial(); return; }   // first launch: the tutorial comes first
      this.app.audio.startMenuMusic?.(); this.showHome();
    };
    this.root.appendChild(el);
    this.addCornerButtons();
    this.screen = 'title';
  }
  refreshArt() { if (this.screen === 'title') this.showTitle(); }

  // ================= HOME =================
  showHome() {
    this.clear();
    this.screen = 'home';
    const hand = fillHand(progress.hand);
    const el = $(`<div class="screen home">
      <div class="home-mid">
        <button class="btn big" data-a="battle">⚔ Battle!</button>
      </div>
      <div class="home-nav">
        <button class="navbtn" data-a="shop"><span>🛒</span>Shop</button>
        <button class="navbtn" data-a="deck"><span>🃏</span>Deck</button>
        <button class="navbtn" data-a="profile"><span>🎖</span>Profile</button>
        <button class="navbtn" data-a="tutorial"><span>❓</span>How to play</button>
      </div>
      <div class="deck-panel">${rowsHtml('deck-cards')}</div>
    </div>`);
    el.prepend(this.topBar(false));
    for (const id of hand) el.querySelector(`.deck-cards[data-g=${cardGroup(id)}]`).appendChild(this.cardEl(id));
    for (const g of GROUPS) { const row = el.querySelector(`.deck-cards[data-g=${g}]`); while (row.children.length < GROUP_SIZE[g]) row.appendChild($('<div class="empty"></div>')); }
    el.querySelectorAll('.deck-cards').forEach(r => r.onclick = () => { this.app.audio.play('click'); this.showDeck(); });
    el.querySelector('[data-a=battle]').onclick = () => {
      this.app.audio.init(); this.app.audio.play('click'); progress.hand = hand; save();
      if (!progress.tutorialDone) this.app.startTutorial(); else this.app.startMatch(hand);
    };
    const nav = el.querySelector('.home-nav');
    nav.querySelector('[data-a=tutorial]').onclick = () => { this.app.audio.play('click'); this.app.startTutorial(); };
    nav.querySelector('[data-a=shop]').onclick = () => { this.app.audio.play('click'); this.showShop(); };
    nav.querySelector('[data-a=deck]').onclick = () => { this.app.audio.play('click'); this.showDeck(); };
    nav.querySelector('[data-a=profile]').onclick = () => { this.app.audio.play('click'); this.showProfile(); };
    this.root.appendChild(el);
    this.addCornerButtons();
  }

  // ================= DECK (hand) =================
  showDeck() {
    this.clear();
    this.screen = 'deck';
    let hand = fillHand(progress.hand);
    const un = unlockedCards();
    const cols = g => Math.ceil(ALL_CARDS.filter(c => cardGroup(c) === g).length / 2);
    const el = $(`<div class="screen hand-screen fit-screen"><div class="fit">
      <h2>Your deck</h2>
      <div class="deck-line">${GROUPS.map(g => `<div class="deck-group"><div class="deck-label ${GROUP_CLS[g]}">${GROUP_LABEL[g]}</div><div class="hand-slots" data-g="${g}"></div></div>`).join('')}</div>
      <div class="card-info">Hover a card to see what it does.</div>
      <div class="pool-wrap">${GROUPS.map(g => `<div class="pool-col"><div class="pool-label ${GROUP_CLS[g]}">${GROUP_LABEL[g]} cards</div><div class="pool" data-p="${g}" style="grid-template-columns:repeat(${cols(g)}, 96px)"></div></div>`).join('')}</div>
    </div></div>`);
    el.prepend(this.topBar(true));
    const info = el.querySelector('.card-info');
    const persist = () => { progress.hand = hand; save(); };
    const render = () => {
      for (const g of GROUPS) {
        const slots = el.querySelector(`.hand-slots[data-g=${g}]`); slots.innerHTML = '';
        const cards = hand.filter(c => cardGroup(c) === g);
        for (let i = 0; i < GROUP_SIZE[g]; i++) {
          const id = cards[i];
          if (!id) { slots.appendChild($('<div class="empty"></div>')); continue; }
          const c = this.cardEl(id);
          c.onclick = () => { hand = hand.filter(h => h !== id); persist(); render(); this.app.audio.play('click'); };
          c.onmouseenter = () => info.innerHTML = cardInfo(id);
          slots.appendChild(c);
        }
        el.querySelector(`.pool[data-p=${g}]`).innerHTML = '';
      }
      for (const id of ALL_CARDS) {
        const g = cardGroup(id);
        const c = this.cardEl(id);
        const locked = !un.includes(id);
        if (locked) { c.classList.add('locked'); c.appendChild($(`<div class="lock">🔒<br>🪙 ${cardPrice(id)}</div>`)); }
        if (hand.includes(id)) c.classList.add('sel');
        c.onmouseenter = () => info.innerHTML = locked ? `Buy in the shop for 🪙 ${cardPrice(id)}. ` + cardInfo(id) : cardInfo(id);
        c.onclick = () => {
          if (locked) { this.app.audio.play('click'); this.showShop(); return; }
          if (hand.includes(id)) hand = hand.filter(h => h !== id);
          else if (hand.filter(h => cardGroup(h) === g).length < GROUP_SIZE[g]) hand.push(id);
          else { this.app.audio.play('deny'); info.innerHTML = `Your ${GROUP_LABEL[g].toLowerCase()} row is full — click a card in it first to remove it.`; return; }
          persist(); this.app.audio.play('click'); render();
        };
        el.querySelector(`.pool[data-p=${g}]`).appendChild(c);
      }
      this.refit?.();
    };
    render();
    this.root.appendChild(el);
    // try the card collections in 2 or 3 rows and keep whichever shows bigger cards
    const setRows = rows => () => el.querySelectorAll('.pool[data-p]').forEach(p => { p.style.gridTemplateColumns = `repeat(${Math.ceil(ALL_CARDS.filter(c => cardGroup(c) === p.dataset.p).length / rows)}, 96px)`; });
    this.fitScreen(el, [setRows(2), setRows(3)]);
    this.addCornerButtons();
  }

  // ================= SHOP =================
  showShop(tab = this.shopTab || 'cards') {
    this.clear();
    this.screen = 'shop';
    this.shopTab = tab;
    const un = unlockedCards();
    const el = $(`<div class="screen shop fit-screen"><div class="fit">
      <h2>Shop</h2>
      <div class="seg tabs">${[['cards', 'New cards'], ['upgrades', 'Card upgrades'], ['bunker', 'Bunker']].map(([k, n]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="shop-body"></div>
    </div></div>`);
    el.prepend(this.topBar(true));
    const body = el.querySelector('.shop-body');
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { this.app.audio.play('click'); this.showShop(b.dataset.t); });
    const item = (id, priceTxt, can, label, extra, onBuy) => {
      const w = $(`<div class="shop-item"></div>`);
      w.appendChild(this.cardEl(id));
      w.appendChild($(`<div class="shop-extra">${extra}</div>`));
      const b = $(`<button class="btn small ${can ? '' : 'grey'}" ${can ? '' : 'disabled'}>${label}<small>${priceTxt}</small></button>`);
      b.onclick = () => {
        if (!onBuy()) { this.app.audio.play('deny'); return; }
        this.app.audio.play('upgrade');
        if (this.shopTut === 'buy' && tab === 'cards') {   // tutorial: make sure the new card is in the deck
          this.shopTut = 'bought'; this.shopTutCard = id;
          let hand = fillHand(progress.hand);
          if (!hand.includes(id)) { const g = cardGroup(id); const i = hand.findIndex(c => cardGroup(c) === g); if (i >= 0) hand[i] = id; }
          progress.hand = validHand(hand); save();
        }
        this.showShop(tab);
      };
      w.appendChild(b);
      return w;
    };
    if (tab === 'cards') {
      const locked = ALL_CARDS.filter(c => !un.includes(c)).sort((a, b) => cardPrice(a) - cardPrice(b));
      if (!locked.length) body.appendChild($('<div class="empty-note">You own every card — upgrade them in Card upgrades.</div>'));
      for (const kind of GROUPS) {
        const ids = locked.filter(c => cardGroup(c) === kind);
        if (!ids.length) continue;
        body.appendChild($(`<div class="pool-label ${GROUP_CLS[kind]}">${GROUP_LABEL[kind]} cards</div>`));
        const grid = $('<div class="shop-grid"></div>');
        for (const id of ids) grid.appendChild(item(id, `🪙 ${cardPrice(id)}`, progress.coins >= cardPrice(id), 'Buy', cardInfo(id), () => buyCard(id)));
        body.appendChild(grid);
      }
    } else if (tab === 'upgrades') {
      for (const kind of GROUPS) {
        const ids = un.filter(c => cardGroup(c) === kind);
        body.appendChild($(`<div class="pool-label ${GROUP_CLS[kind]}">${GROUP_LABEL[kind]} cards · ${{ attack: '+10% health', defence: '+8% damage', magic: '+15% power & duration' }[kind]} per level</div>`));
        const grid = $('<div class="shop-grid"></div>');
        for (const id of ids) {
          const lv = cardLevel(id), price = upgradePrice(id), max = lv >= MAX_CARD_LEVEL;
          const pips = `<div class="pips">${Array.from({ length: MAX_CARD_LEVEL }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div>`;
          grid.appendChild(item(id, max ? 'Max level' : `🪙 ${price}`, !max && progress.coins >= price, max ? '★ Max' : `⬆ Level ${lv + 1}`,
            `${pips}${cardBonusText(id) || 'Base strength'}`, () => upgradeCard(id)));
        }
        body.appendChild(grid);
      }
    } else {
      const lv = progress.bunkerLevel, cur = BUNKER_LEVELS[lv - 1], next = BUNKER_LEVELS[lv];
      const desc = l => `${CONFIG.global.bunkerHealth + l.hp} health${l.reveal ? ` · searchlight reveals ghosts within ${l.reveal}` : ''}${l.turret ? ` · turret ${l.turret.damage} dmg, ${l.turret.fireRate}/s, range ${l.turret.range}${l.turret.heavy ? ', heavy' : ''}` : ''}`;
      const box = $(`<div class="bunker-shop">
        <div class="bunker-icon">🏰</div>
        <div><div class="arena-name stroke">Bunker level ${lv}</div>
        <div class="arena-desc">${desc(cur)}</div>
        <div class="pips">${BUNKER_LEVELS.map((_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div>
        ${next ? `<div class="arena-desc">Next: <b>${desc(next)}</b>${!cur.turret && next.turret ? ' — <b>your bunker starts shooting!</b>' : ''}</div>` : '<div class="arena-desc">★ Fully fortified</div>'}</div>
      </div>`);
      if (next) {
        const b = $(`<button class="btn ${progress.coins >= next.price ? '' : 'grey'}" ${progress.coins >= next.price ? '' : 'disabled'}>⬆ Upgrade<small>🪙 ${next.price}</small></button>`);
        b.onclick = () => { if (upgradeBunker()) { this.app.audio.play('upgrade'); this.showShop('bunker'); } else this.app.audio.play('deny'); };
        box.appendChild(b);
      }
      body.appendChild(box);
    }
    this.root.appendChild(el);
    // try a few grid widths (wide & short vs narrow & tall) and keep the one with the biggest cards
    if (this.shopTut) el.classList.add('with-tut');
    this.fitScreen(el);   // one row per card type; the whole screen scales to fit
    if (this.shopTut) this.shopTutorial(el);
    this.addCornerButtons();
  }

  // ================= PROFILE =================
  showProfile() {
    this.clear();
    this.screen = 'profile';
    const p = progress, losses = p.matches - p.wins;
    const { into, need } = xpIntoLevel();
    const fmtStreak = s => s > 0 ? `${s} win${s > 1 ? 's' : ''}` : s < 0 ? `${-s} loss${s < -1 ? 'es' : ''}` : '—';
    const el = $(`<div class="screen profile fit-screen"><div class="fit">
      <div class="profile-head">
        <div class="avatar big"><img src="${this.portraits[p.avatar] || ''}"><div class="badge stroke">${p.level}</div></div>
        <div>
          <input class="name-input" maxlength="16" value="${escapeHtml(p.name)}" spellcheck="false" title="Click to rename">
          <div class="sub">Rank ${p.level} · ${into} / ${need} XP to next rank</div>
        </div>
      </div>
      <div class="pool-label">Avatar</div>
      <div class="avatar-pick"></div>
      <div class="stats">
        <div><b>${p.matches}</b>Battles</div><div><b>${p.wins}</b>Wins</div><div><b>${losses}</b>Losses</div>
        <div><b>${p.matches ? Math.round(p.wins / p.matches * 100) : 0}%</b>Win rate</div>
        <div><b>${fmtStreak(p.streak)}</b>Current streak</div><div><b>${p.bestStreak}</b>Best win streak</div>
        <div><b>${p.totalDamage}</b>Bunker damage</div><div><b>${p.totalKills}</b>Undead destroyed</div>
        <div><b>${unlockedCards().length}/${ALL_CARDS.length}</b>Cards owned</div><div><b>${p.bunkerLevel}</b>Bunker level</div>
        <div><b>${new Set(p.log.map(m => m.arena).filter(Boolean)).size}/${ARENAS.length}</b>Arenas played</div><div><b>${p.coins}</b>Coins</div>
      </div>
      <div class="pool-label">Recent battles</div>
      <div class="log">${p.log.slice(0, 8).map(m => `<div class="${m.winner === 0 ? 'w' : m.winner === 1 ? 'l' : ''}"><b>${m.winner === 0 ? 'WIN' : m.winner === 1 ? 'LOSS' : 'DRAW'}</b> <span>${ARENAS.find(a => a.id === m.arena)?.name || 'Haunted Fields'}</span> <span>${fmtTime(m.t)}</span> <span>${m.date}</span></div>`).join('') || '<div>No battles yet.</div>'}</div>
    </div></div>`);
    el.prepend(this.topBar(true));
    const inp = el.querySelector('.name-input');
    inp.onchange = () => { p.name = inp.value.trim().slice(0, 16) || 'Commander'; inp.value = p.name; save(); this.app.audio.play('click'); };
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); };
    const pick = el.querySelector('.avatar-pick');
    for (const id of unlockedCards()) {
      const a = $(`<button class="avatar ${p.avatar === id ? 'on' : ''}" title="${cardName(id)}"><img src="${this.portraits[id] || ''}"></button>`);
      a.onclick = () => { p.avatar = id; save(); this.app.audio.play('click'); this.showProfile(); };
      pick.appendChild(a);
    }
    this.root.appendChild(el);
    this.fitScreen(el);
    this.addCornerButtons();
  }

  addCornerButtons() {
    if (DEV_MENU_ENABLED) {
      const gear = $(`<button class="gear" title="Developer menu">⚙</button>`);
      gear.onclick = () => this.app.dev.toggle();
      this.root.append(gear);
    }
    const mute = $(`<button class="gear mute${DEV_MENU_ENABLED ? '' : ' solo'}" title="Sound">${progress.muted ? '🔇' : '🔊'}</button>`);
    mute.onclick = () => { progress.muted = !progress.muted; save(); this.app.audio.setMuted(progress.muted); mute.textContent = progress.muted ? '🔇' : '🔊'; };
    this.root.append(mute);
    // in battle: pause button (Esc / P also pause)
    if (this.game && this.screen === 'battle') {
      const pb = $(`<button class="pause-btn" title="Pause (Esc)">⏸</button>`);
      pb.onclick = () => this.app.setPaused(true);
      this.root.append(pb);
    }
  }


  // ================= HUD =================
  showHUD(game) {
    this.clear();
    this.game = game;
    this.screen = 'battle';
    this.armed = null; this.squad = null; this.hideAimTip();
    const diff = 'CPU';
    const hud = $(`<div class="passthru" style="position:fixed;inset:0">
      <div class="hud-top">
        <div class="bunker-panel me"><div class="who stroke"><span>🛡 YOUR BUNKER</span><span class="n"></span></div><div class="hpbar"><b></b><i></i><span></span></div></div>
        <div class="timer-box"><div class="time stroke">0:00</div></div>
        <div class="bunker-panel enemy"><div class="who stroke"><span>${diff} ☠</span><span class="n"></span></div><div class="hpbar"><b></b><i></i><span></span></div></div>
      </div>
      <div class="sab-status"></div>
      <div class="hud-bottom">
        <div class="energy"><div class="orb stroke">100</div><div class="lbl">Soul energy</div><div class="inc">+5 / 2s</div></div>
        <div class="cards">${GROUPS.map(g => `<div class="card-group ${GROUP_CLS[g]}"><div class="group-label">${GROUP_LABEL[g]}</div><div class="group-cards"></div></div>`).join('')}</div>
      </div>
      <div class="vignette"></div>
    </div>`);
    this.root.appendChild(hud);
    this.hud = {
      me: hud.querySelector('.bunker-panel.me'), en: hud.querySelector('.bunker-panel.enemy'),
      time: hud.querySelector('.time'), timerBox: hud.querySelector('.timer-box'),
      orb: hud.querySelector('.orb'), inc: hud.querySelector('.inc'), cards: hud.querySelector('.cards'),
      vig: hud.querySelector('.vignette'), sab: hud.querySelector('.sab-status'),
    };
    this.cardEls = {};
    for (const id of game.players[0].hand) {
      const c = this.cardEl(id);
      if (cardKind(id) === 'sabotage') c.appendChild($('<div class="cd" style="display:none"></div>'));
      c.addEventListener('pointerdown', e => this.cardDown(e, id, c));
      c.addEventListener('contextmenu', e => { e.preventDefault(); this.disarm(); });
      c.addEventListener('mouseenter', () => this.showCardTip(c, id));
      c.addEventListener('mouseleave', () => this.hideCardTip());
      this.hud.cards.querySelector(`.${GROUP_CLS[cardGroup(id)]} .group-cards`).appendChild(c);
      this.cardEls[id] = c;
    }
    this.addCornerButtons();
    this.lastEnergy = 0;
    this.lastPhase = 'opening';
    this.lastEsc = 0;
  }

  showCardTip(c, id) {
    if (this.drag) return;
    this.hideCardTip();
    const r = c.getBoundingClientRect();
    const tip = $(`<div class="hint" style="left:${r.left + r.width / 2}px;top:${r.top - 10}px;font-size:13px;max-width:280px">${cardInfo(id)}</div>`);
    tip.style.pointerEvents = 'none';
    document.body.appendChild(tip); this.cardTip = tip;
  }
  hideCardTip() { if (this.cardTip) { this.cardTip.remove(); this.cardTip = null; } }

  updateHUD(game) {
    if (!this.hud) return;
    const me = game.players[0], en = game.players[1];
    const set = (panel, p) => {
      const f = Math.max(0, p.bunkerHp / p.bunkerMax) * 100;
      panel.querySelector('i').style.width = f + '%';
      panel.querySelector('b').style.width = f + '%';
      panel.querySelector('.hpbar span').textContent = `${Math.ceil(p.bunkerHp)} / ${p.bunkerMax}`;
    };
    set(this.hud.me, me); set(this.hud.en, en);
    this.hud.time.textContent = fmtTime(game.t);
    const e = Math.floor(me.energy);
    if (e !== this.lastEnergy) { this.hud.orb.textContent = e; if (e > this.lastEnergy) { this.hud.orb.classList.remove('bump'); void this.hud.orb.offsetWidth; this.hud.orb.classList.add('bump'); } this.lastEnergy = e; }
    this.hud.inc.textContent = `+${game.incomePerTick(0).toFixed(1)} / ${CONFIG.global.incomeInterval}s`;
    for (const [id, c] of Object.entries(this.cardEls)) {
      const cost = game.cardCost(0, id);
      c.querySelector('.cost span').textContent = cost;
      c.classList.toggle('poor', me.energy < cost);
      if (cardKind(id) === 'sabotage') {
        const cd = game.cooldownLeft(0, id), el = c.querySelector('.cd');
        if (cd > 0) { el.style.display = 'grid'; el.style.setProperty('--p', (cd / CONFIG.sabotage[id].cooldown * 100) + '%'); el.textContent = Math.ceil(cd); }
        else el.style.display = 'none';
      }
    }
    // status chips
    const chips = [];
    for (let l = 0; l < 3; l++) { if (game.fogUntil[1][l] > game.t) chips.push(`🌫 Enemy ${LANE_NAMES[l]} lane fogged`); if (game.fogUntil[0][l] > game.t) chips.push(`<span style="color:#ff8a8a">🌫 Your ${LANE_NAMES[l]} lane fogged!</span>`); }
    if (game.empUntil[1] > game.t) chips.push('⚡ Enemy machines down');
    if (game.empUntil[0] > game.t) chips.push('<span style="color:#ff8a8a">⚡ EMP: your machines are down!</span>');
    if (me.raiseCharges > 0) chips.push(`💀 Raise Dead ×${me.raiseCharges}`);
    if (game.warcryUntil[0] > game.t) chips.push(`📯 War Cry ${Math.ceil(game.warcryUntil[0] - game.t)}s`);
    if (me.shieldHp > 0 && me.shieldUntil > game.t) chips.push(`🛡 Shield ${Math.ceil(me.shieldHp)}`);
    for (let l = 0; l < 3; l++) if (game.freezeUntil[0][l] > game.t) chips.push(`❄ ${LANE_NAMES[l]} lane frozen`);
    if (game.warcryUntil[1] > game.t) chips.push('<span style="color:#ff8a8a">📯 Enemy War Cry!</span>');
    const html = chips.map(c => `<div>${c}</div>`).join('');
    if (html !== this.lastChips) { this.hud.sab.innerHTML = html; this.lastChips = html; }
    if (this.panel) this.refreshPanel();
    this.updateHints(game);
    if (this.tut) this.updateTutorial(game);
  }

  // ================= PAUSE =================
  showPause(on) {
    this.pauseEl?.remove(); this.pauseEl = null;
    if (!on) return;
    const el = $(`<div class="pause-screen"><div class="pause-box">
      <h2>Paused</h2>
      <button class="btn big" data-a="resume">▶ Resume</button>
      <button class="btn red" data-a="quit">Quit battle</button>
      <div class="pause-note">${this.game?.tutorial ? 'Quitting ends the tutorial.' : 'Quitting counts as a loss (no coins).'}</div>
    </div></div>`);
    el.querySelector('[data-a=resume]').onclick = () => this.app.setPaused(false);
    el.querySelector('[data-a=quit]').onclick = () => this.app.quitBattle();
    this.root.appendChild(el);
    this.pauseEl = el;
  }
  flashDamage() { const v = this.hud && this.hud.vig; if (!v) return; v.classList.add('on'); clearTimeout(this.vt); this.vt = setTimeout(() => v.classList.remove('on'), 120); }
  banner(text, small = '', cls = '') {
    const b = $(`<div class="banner ${cls}">${text}${small ? `<small>${small}</small>` : ''}</div>`);
    this.root.appendChild(b); setTimeout(() => b.remove(), 2700);
  }
  toast(text) { const t = $(`<div class="toast">${text}</div>`); this.root.appendChild(t); setTimeout(() => t.remove(), 1700); }

  // ================= CARD INPUT =================
  // • Drag a card onto the field to play it once.
  // • SQUAD: tap undead cards to select them — any mix, each as often as you like (3× bats, 1× pumpkin,
  //   2× zombie…). Then drag any of them (or click a gate) and the whole squad spawns in that lane.
  //   Right-click a card to take one off it; Esc clears the squad.
  // • Tap a defender or magic card to select it, then click a build spot / lane to play it (it deselects after).
  cardDown(e, id, el) {
    if (e.button === 2) { e.preventDefault(); this.untapCard(id); return; }
    if (e.button !== 0 || !this.game || this.game.over) return;
    e.preventDefault();
    this.app.audio.init();
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const move = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 7) { dragging = true; this.startDrag(ev, id, el); }
      if (dragging) this.moveDrag(ev);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (dragging) this.endDrag(ev); else this.tapCard(id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  squadSize() { return this.squad ? this.squad.length : 0; }
  squadCost() { return (this.squad || []).reduce((a, t) => a + this.game.cardCost(0, t), 0); }
  tapCard(id) {
    this.closePanel();
    if (cardKind(id) === 'undead') {
      this.armed = null;
      this.squad ??= [];
      if (this.squad.length >= 20) { this.app.audio.play('deny'); this.toast('A squad can hold up to 20 undead'); return; }
      this.squad.push(id);
      this.app.audio.play('click');
      this.onPlayerAction('squad');
    } else {
      this.squad = null;
      if (this.armed && this.armed.id === id) this.armed = null; else this.armed = { id, n: 1 };
      this.app.audio.play('click');
      this.onPlayerAction('arm');
    }
    this.app.view.clearPreview(); this.hideAimTip();
    this.refreshArmed();
  }
  untapCard(id) {
    if (this.squad && this.squad.includes(id)) {
      this.squad.splice(this.squad.lastIndexOf(id), 1);
      if (!this.squad.length) this.squad = null;
      this.app.audio.play('click');
    } else if (this.armed && this.armed.id === id) this.armed = null;
    else return this.disarm();
    this.refreshArmed();
  }
  disarm() {
    if (!this.armed && !this.squad) return;
    this.armed = null; this.squad = null; this.refreshArmed();
    this.app.view.clearPreview(); this.hideAimTip();
  }
  refreshArmed() {
    const counts = {};
    for (const t of this.squad || []) counts[t] = (counts[t] || 0) + 1;
    for (const [cid, c] of Object.entries(this.cardEls || {})) {
      const on = (this.armed && this.armed.id === cid) || counts[cid] > 0;
      c.classList.toggle('armed', !!on);
      let b = c.querySelector('.stack');
      if (counts[cid]) {
        if (!b) { b = $('<div class="stack stroke"></div>'); c.appendChild(b); }
        b.textContent = '×' + counts[cid];
      } else if (b) b.remove();
    }
    // squad summary above the card bar
    if (!this.hud) return;
    let bar = this.hud.squadBar;
    if (!this.squad) { if (bar) bar.style.display = 'none'; return; }
    if (!bar) { bar = this.hud.squadBar = $('<div class="squad-bar"></div>'); this.root.querySelector('.hud-bottom').appendChild(bar); }
    const order = [...new Set(this.squad)];
    bar.innerHTML = `<b>Squad</b> ${order.map(t => `<span class="sq"><img src="${this.portraits[t] || ''}">${counts[t]}× ${cardName(t)}</span>`).join('')}
      <span class="sq-cost">${this.squadCost()} soul</span><span class="sq-hint">drag to a lane or click a gate · right-click a card to remove · Esc clears</span>`;
    bar.style.display = '';
  }
  // what would happen if `id` were played at ground point p (shared by drag, armed hover and armed click)
  evalTarget(id, p, n = 1) {
    const g = this.game, view = this.app.view, kind = cardKind(id);
    view.clearPreview();
    const unit = g.cardCost(0, id), cost = kind === 'undead' ? unit * n : unit;
    const afford = g.players[0].energy >= (kind === 'undead' ? unit : cost);
    if (!p) return { tip: '', good: false };
    if (kind === 'undead') {
      let best = -1, bd = 3.2;
      GATES[1].forEach((gp, l) => { const dd = Math.hypot(p.x - gp.x, p.y - gp.y); if (dd < bd) { bd = dd; best = l; } });
      if (best < 0 && p.x > W - HALF - 1) { let bl = 99; for (let l = 0; l < 3; l++) { const dd = distToLane(LANES[1][l], p.x, p.y); if (dd < bl && dd < 1.4) { bl = dd; best = l; } } }
      if (best < 0) return { tip: 'Drop on one of your glowing gates →', good: false };
      view.highlightGate(best); view.highlightLane(best, 1);
      if (this.squad) {
        const total = this.squadCost(), have = g.players[0].energy;
        return { target: { lane: best }, good: have >= g.cardCost(0, this.squad[0]), tip: `Send squad of ${this.squad.length} to ${LANE_NAMES[best]} lane (${laneLen(best)})${have < total ? ` · ${Math.ceil(total - have)} soul short — sends what you can afford` : ''}` };
      }
      return { target: { lane: best }, good: afford, tip: !afford ? `Need ${unit} soul` : `Send to ${LANE_NAMES[best]} lane (${laneLen(best)})` };
    }
    if (kind === 'defender') {
      if (p.x >= HALF) return { tip: 'Place defenders on your side ←', good: false };
      const i = Math.floor(p.x), j = Math.floor(p.y);
      const st = g.canPlace(0, id, i, j), ok = st === 'ok' && afford;
      view.showPreview(id, p.x, p.y, ok, CONFIG.defenders[id].levels[0].range, g);
      return { target: { i, j, ok }, good: ok, hideGhost: true,
        tip: st === 'invalid' ? 'Not on the path — place beside it' : st === 'occupied' ? 'Spot taken' : st === 'full' ? `All ${CONFIG.global.buildSpotsPerSide} build spots used` : st === 'max' ? 'Only one allowed' : !afford ? `Need ${cost} soul` : `Place ${CONFIG.defenders[id].name}` };
    }
    // magic
    const c = CONFIG.sabotage[id], cd = g.cooldownLeft(0, id);
    let target = null, where = '';
    if (c.target === 'enemyLane' || c.target === 'myLane') {
      const side = c.target === 'enemyLane' ? 1 : 0;
      let best = -1, bl = 2.2;
      for (let l = 0; l < 3; l++) { const dd = distToLane(LANES[side][l], p.x, p.y); if (dd < bl) { bl = dd; best = l; } }
      if (best >= 0) { view.highlightLane(best, side); target = { lane: best }; }
      where = side ? 'Drop on an enemy lane →' : 'Drop on one of your lanes ←';
    } else if (c.target === 'enemyHalf') {
      if (p.x > W - HALF - 1) { view.highlightHalf(true); target = { lane: 0 }; }
      where = 'Play on the enemy side →';
    } else target = { lane: 0 };
    const good = !!target && afford && cd <= 0;
    return { target, good, tip: !target ? where : cd > 0 ? `Cooldown ${Math.ceil(cd)}s` : !afford ? `Need ${cost} soul` : c.name };
  }
  // play `id` at target; returns true if anything happened
  playAt(id, target, n = 1) {
    const g = this.game, kind = cardKind(id);
    if (!target || g.over) return false;
    let ok = false;
    if (kind === 'undead') {
      const list = this.squad && this.squad.length ? this.squad.slice() : [id];
      let sent = 0, gap = 0;
      for (const t of list) {
        if (!g.sendUndead(0, t, target.lane, false, gap)) continue;
        sent++; gap += (CONFIG.undead[t].swarmCount ? 1.4 : 0.55) * (CONFIG.undead[t].size || 1);
      }
      ok = sent > 0;
      if (ok && list.length > 1) { this.onPlayerAction('group'); if (sent < list.length) this.toast(`Sent ${sent} of ${list.length} — not enough soul for the rest`); }
      if (ok) { this.squad = null; this.refreshArmed(); this.hideAimTip(); }
    } else if (kind === 'defender') ok = target.ok && !!g.placeDefender(0, id, target.i, target.j);
    else ok = g.playSabotage(0, id, target.lane);
    if (!ok) { this.app.audio.play('deny'); const cost = g.cardCost(0, id); if (g.players[0].energy < cost) this.toast(`Not enough soul energy (${cost})`); }
    else this.onPlayerAction(kind === 'sabotage' ? 'magic' : kind);
    return ok;
  }

  startDrag(e, id, el) {
    this.hideCardTip();
    this.closePanel();
    this.hideAimTip();
    const n = 1;
    if (cardKind(id) === 'undead' && this.squad && !this.squad.includes(id)) { this.squad.push(id); this.refreshArmed(); }
    if (cardKind(id) !== 'undead' && this.squad) this.disarm();
    const ghost = el.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.classList.remove('poor', 'armed');
    document.body.appendChild(ghost);
    const tip = $(`<div class="drag-tip"></div>`); document.body.appendChild(tip);
    el.classList.add('dragging');
    this.drag = { id, kind: cardKind(id), el, ghost, tip, target: null, n };
  }
  moveDrag(e) {
    const d = this.drag; if (!d) return;
    d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px';
    d.tip.style.left = e.clientX + 'px'; d.tip.style.top = e.clientY + 'px';
    const overBar = e.clientY > window.innerHeight - 160;
    const r = overBar ? { tip: '', good: false } : this.evalTarget(d.id, this.app.view.pickGround(e.clientX, e.clientY), d.n);
    if (overBar) this.app.view.clearPreview();
    d.target = r.target || null;
    d.ghost.classList.toggle('hidden', !!r.hideGhost);
    d.tip.textContent = r.tip; d.tip.className = 'drag-tip ' + (r.good ? 'good' : 'bad');
    d.tip.style.display = r.tip ? 'block' : 'none';
  }
  endDrag() {
    const d = this.drag; if (!d) return;
    this.drag = null;
    d.ghost.remove(); d.tip.remove(); d.el.classList.remove('dragging');
    this.app.view.clearPreview();
    if (d.target && this.playAt(d.id, d.target, d.n)) this.disarm();
  }
  // armed card follows the mouse over the battlefield
  aimMove(e) {
    if ((!this.armed && !this.squad) || this.drag || !this.game || this.game.over) { this.hideAimTip(); return; }
    const overBar = e.clientY > window.innerHeight - 160;
    if (overBar) { this.app.view.clearPreview(); this.hideAimTip(); return; }
    const aid = this.squad ? this.squad[0] : this.armed.id;
    const r = this.evalTarget(aid, this.app.view.pickGround(e.clientX, e.clientY), 1);
    if (!this.aimTip) { this.aimTip = $('<div class="drag-tip"></div>'); document.body.appendChild(this.aimTip); }
    const t = this.aimTip;
    t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
    t.textContent = r.tip; t.className = 'drag-tip ' + (r.good ? 'good' : 'bad'); t.style.display = r.tip ? 'block' : 'none';
  }
  hideAimTip() { if (this.aimTip) { this.aimTip.remove(); this.aimTip = null; } }

  // ================= DEFENDER PANEL =================
  canvasClick(e) {
    if (!this.game || this.drag) return;
    const p = this.app.view.pickGround(e.clientX, e.clientY);
    if (!p) return this.closePanel();
    if (this.app.dev?.placeMode) { this.app.dev.placeAt(p); return; }
    if (this.squad || this.armed) {   // squad → send it here; armed defender/magic → play and stay armed
      const aid = this.squad ? this.squad[0] : this.armed.id;
      const r = this.evalTarget(aid, p, 1);
      if (r.target) { if (this.playAt(aid, r.target, 1)) this.disarm(); }   // played → deselect right away
      else { this.app.audio.play('deny'); }
      return;
    }
    const i = Math.floor(p.x), j = Math.floor(p.y);
    const def = this.game.occupied[0].get(i * 100 + j) || this.game.occupied[1].get(i * 100 + j);
    if (def && def.side === 0) this.openPanel(def);
    else if (def) this.toast(`Enemy ${CONFIG.defenders[def.type].name} · level ${def.level + 1}`);
    else this.closePanel();
  }
  openPanel(def) {
    this.closePanel();
    this.app.audio.play('click');
    const el = $(`<div class="dpanel"></div>`);
    this.root.appendChild(el);
    this.panel = { el, def };
    this.app.view.select(def);
    this.refreshPanel(true);
    this.onPlayerAction('panel');
  }
  closePanel() { if (this.panel) { this.panel.el.remove(); this.panel = null; this.app.view.select(null); } }
  refreshPanel(force) {
    const { el, def } = this.panel;
    const g = this.game;
    if (!g.defenders.includes(def)) return this.closePanel();
    const c = CONFIG.defenders[def.type], s = defStats(def);
    const upCost = g.upgradeCost(def);
    const energy = Math.floor(g.players[0].energy);
    const key = [def.level, def.target, energy >= (upCost ?? 1e9), g.players[0].airstrikeUsed, energy].join('|');
    if (!force && key === this.panel.key) return;
    this.panel.key = key;
    const next = def.level < 2 ? c.levels[def.level + 1] : null;
    const stats = def.type === 'commander' ? `Defenders in its circle: +${Math.round(s.auraDamage * 100)}% damage, +${Math.round(s.auraBoost * 100)}% fire rate · radius ${s.range}` : `Dmg ${s.damage} · Range ${s.range} · ${s.fireRate}/s${s.heavy ? ' · Heavy' : ''}${s.detect ? ' · Sees ghosts' : ''}`;
    el.innerHTML = `<button class="x">×</button>
      <h3 class="stroke"><span>${c.name}</span><span class="stars">${'★'.repeat(def.level + 1)}${'☆'.repeat(2 - def.level)}</span></h3>
      <div class="stats">${stats}</div>
      ${next ? `<div class="row"><button class="btn small up" data-a="up" ${energy < upCost ? 'disabled' : ''}>⬆ Level ${def.level + 2} · ${upCost}<small>${next.desc}</small></button></div>` : '<div class="stats" style="color:#ffcf4a">★ Max level</div>'}
      ${def.type !== 'commander' ? `<div class="lbl">Target</div><div class="row tg">${TARGET_MODES.map(m => `<button data-t="${m}" class="${def.target === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>` : ''}
      ${s.airstrike ? `<div class="lbl">Airstrike (once per match)</div><div class="row tg">${g.players[0].airstrikeUsed ? '<span class="stats">Used</span>' : LANE_NAMES.map((n, l) => `<button data-s="${l}">✈ ${n}</button>`).join('')}</div>` : ''}
      <div class="row"><button class="btn small red" data-a="sell" style="flex:1">Sell · +${g.sellValue(def)}</button></div>`;
    el.querySelector('.x').onclick = () => this.closePanel();
    const up = el.querySelector('[data-a=up]'); if (up) up.onclick = () => { if (!g.upgrade(def)) this.app.audio.play('deny'); else this.onPlayerAction('upgrade'); this.refreshPanel(true); };
    el.querySelector('[data-a=sell]').onclick = () => { g.sell(def); this.closePanel(); };
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { g.setTargetMode(def, b.dataset.t); this.app.audio.play('click'); this.refreshPanel(true); });
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { g.airstrike(def, +b.dataset.s); this.refreshPanel(true); });
    // position near the defender
    const sp = this.app.view.worldToScreen(def.x, def.y, 1);
    const x = Math.min(window.innerWidth - 275, Math.max(10, sp.x + 40)), y = Math.min(window.innerHeight - 330, Math.max(90, sp.y - 120));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  // ================= TUTORIAL (first launch, < 1 minute) =================
  startTutorial(game) {
    const v = this.app.view;
    const atkCard = () => this.cardEls[game.players[0].hand.find(c => cardKind(c) === 'undead')];
    const defCard = () => this.cardEls[game.players[0].hand.find(c => cardKind(c) === 'defender')];
    const at = (x, y, h = 0.5) => v.worldToScreen(x, y, h);
    const cardPt = c => { const r = c?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top - 8 } : { x: innerWidth / 2, y: innerHeight - 160 }; };
    this.tutSteps = [
      { text: '<b>Welcome, Commander!</b> Undead march along 3 lanes. <b>Destroy the enemy bunker</b> (right) before the undead destroy <b>yours</b> (left).',
        points: () => [[at(1.6, 9, 2.6), 'Your bunker'], [at(W - 1.6, 9, 2.6), 'Enemy bunker']] },
      { text: '<b>Attack:</b> drag a green <b>undead card</b> onto one of the glowing gates on the enemy side.', wait: 'undead',
        points: () => [[cardPt(atkCard()), 'Drag me…'], [at(GATES[1][1].x, GATES[1][1].y, 2.2), '…onto a gate']] },
      { text: '<b>Coordinated attack:</b> build a squad by <b>tapping</b> undead cards — mix them, tap each as often as you like (e.g. 2× one card, 1× another). Then <b>drag</b> one of them to a gate (or click a gate) and the whole squad charges that lane together.', wait: 'group',
        points: () => { const u = game.players[0].hand.filter(c => cardKind(c) === 'undead'); const n = this.squadSize();
          return [[cardPt(this.cardEls[u[0]]), n ? 'Tap more…' : 'Tap me twice'], [cardPt(this.cardEls[u[1]]), '…and me once'], [at(GATES[1][1].x, GATES[1][1].y, 2.2), n >= 2 ? `Send all ${n} here!` : '…then send them here']]; },
        onShow: () => { this.game.players[0].energy = Math.max(this.game.players[0].energy, 200); } },
      { text: '<b>Soul energy</b> pays for every card. It refills over time — and each undead you send <b>raises your income</b>. Bunker hits and kills pay extra.',
        points: () => { const r = this.hud.orb.getBoundingClientRect(); return [[{ x: r.left + r.width / 2, y: r.top - 8 }, 'Soul energy']]; } },
      { text: '<b>Defend:</b> drag a blue <b>defender card</b> onto a green spot <b>beside</b> one of your paths (never on it).', wait: 'defender',
        points: () => [[cardPt(defCard()), 'Drag me…'], [at(10, 7.5), '…beside a path']] },
      { text: 'Click your defender to <b>upgrade</b> it (stronger, longer range), sell it or change its target.', wait: ['panel', 'upgrade'],
        points: () => { const d = game.defenders.find(x => x.side === 0); return d ? [[at(d.x, d.y, 1.2), 'Click me']] : []; } },
      { text: '<b>Magic</b> cards (purple) are spells: boost your undead, power up your defenders, shield your bunker, freeze a lane or fog the enemy. Drag them onto the battlefield.',
        points: () => { const m = this.cardEls[game.players[0].hand.find(c => cardKind(c) === 'sabotage')]; return m ? [[cardPt(m), 'Magic']] : []; } },
      { text: 'Grey-ringed undead march on <b>both</b> bunkers, and bigger monsters join as the battle goes on. Win to earn <b>coins</b> for new cards and upgrades. Good luck!',
        last: true, points: () => [] },
    ];
    this.tut = { step: -1, game, actionsAt: 0 };
    this.actions = new Set();
    const el = $(`<div class="tut-panel"><div class="tut-step"></div><div class="tut-text"></div>
      <div class="tut-btns"><button class="btn small grey" data-a="skip">Skip tutorial</button><button class="btn small" data-a="next">Next ›</button></div></div>`);
    el.querySelector('[data-a=skip]').onclick = () => this.endTutorial(true);
    el.querySelector('[data-a=next]').onclick = () => { this.app.audio.play('click'); this.tutAdvance(); };
    this.root.appendChild(el);
    this.tut.el = el;
    this.tutAdvance();
  }
  tutAdvance() {
    const t = this.tut; if (!t) return;
    const prev = this.tutSteps[t.step];
    if (prev?.last) return this.endTutorial();
    t.step++;
    const st = this.tutSteps[t.step];
    t.el.querySelector('.tut-step').textContent = `Tutorial · ${t.step + 1} / ${this.tutSteps.length}`;
    t.el.querySelector('.tut-text').innerHTML = st.text;
    const next = t.el.querySelector('[data-a=next]');
    next.style.display = st.wait ? 'none' : '';
    next.textContent = st.last ? '⚔ Start the battle!' : 'Next ›';
    this.actions.clear();
    if (st.onShow) st.onShow();
    this.disarm();
    if (st.wait === 'defender') this.game.players[0].energy = Math.max(this.game.players[0].energy, 200);
    if (st.wait && st.wait.includes?.('upgrade')) this.game.players[0].energy = Math.max(this.game.players[0].energy, 200);
    t.shownAt = performance.now();
  }
  updateTutorial(game) {
    const t = this.tut; if (!t) return;
    const st = this.tutSteps[t.step];
    const waits = [].concat(st.wait || []);
    if (waits.length && waits.some(w => this.actions.has(w))) { setTimeout(() => this.tutAdvance(), 600); st.wait = null; t.el.querySelector('[data-a=next]').style.display = 'none'; }
    // pointers
    const pts = st.points();
    t.pts ??= [];
    while (t.pts.length < pts.length) { const e = $('<div class="hint tut-point"></div>'); this.root.appendChild(e); t.pts.push(e); }
    t.pts.forEach((e, k) => {
      if (!pts[k]) { e.style.display = 'none'; return; }
      const [p, label] = pts[k];
      e.style.display = ''; e.style.left = p.x + 'px'; e.style.top = p.y + 'px';
      if (e.textContent !== label) e.textContent = label;
    });
  }
  endTutorial(skipped = false) {
    const t = this.tut; if (!t) return;
    t.el.remove(); (t.pts || []).forEach(e => e.remove());
    this.tut = null;
    progress.tutorialDone = true; save();
    const un = unlockedCards();
    const canBuy = ALL_CARDS.some(c => !un.includes(c) && cardPrice(c) <= progress.coins);
    if (!skipped && canBuy) {          // last tutorial step: spend the starting coins in the shop
      this.app.toMenu();
      this.shopTut = 'buy';
      this.showShop('cards');
      return;
    }
    this.startFirstBattle();
  }
  startFirstBattle() {
    this.shopTut = null;
    this.app.audio.play('horn');
    this.app.startMatch(fillHand(progress.hand));
    this.banner('The battle begins!', 'Destroy the enemy bunker');
  }
  // tutorial guide on the shop screen
  shopTutorial(el) {
    const st = this.shopTut;
    const panel = $(`<div class="tut-panel shop-tut"><div class="tut-step">Tutorial · Shop</div><div class="tut-text"></div><div class="tut-btns"></div></div>`);
    const text = panel.querySelector('.tut-text'), btns = panel.querySelector('.tut-btns');
    if (st === 'buy') {
      text.innerHTML = `Here are your <b>🪙 ${progress.coins} starting coins</b>. Every battle earns more. <b>Buy a new card</b> — it goes straight into your deck.`;
      const skip = $('<button class="btn small grey">Skip</button>'); skip.onclick = () => this.startFirstBattle();
      btns.append(skip);
      // point at the first card you can afford
      const target = [...el.querySelectorAll('.shop-item .btn:not([disabled])')][0];
      if (target) requestAnimationFrame(() => {
        if (!target.isConnected) return;
        const r = target.getBoundingClientRect();
        const h = $(`<div class="hint tut-point" style="left:${r.left + r.width / 2}px;top:${r.top - 6}px">Buy one!</div>`);
        el.appendChild(h);
      });
    } else {
      text.innerHTML = `Nice — <b>${cardName(this.shopTutCard)}</b> is in your deck${cardKind(this.shopTutCard) === 'undead' ? ' (attack row)' : cardKind(this.shopTutCard) === 'defender' ? ' (defence row)' : ' (magic row)'}. You can upgrade cards here later, and change your deck from the home screen. Ready for your first real battle?`;
      const go = $('<button class="btn small">⚔ Battle!</button>'); go.onclick = () => this.startFirstBattle();
      const more = $('<button class="btn small grey">Keep shopping</button>'); more.onclick = () => { this.shopTut = null; this.showShop(); };
      btns.append(more, go);
    }
    el.appendChild(panel);
  }

  // ================= HINTS (first match) =================
  initHints(on) {
    this.hintsOn = on;
    this.hintStep = 0;
    this.hintEl = null;
    this.hintTimer = 0;
    this.actions = new Set();
  }
  onPlayerAction(kind) { if (this.actions) this.actions.add(kind); }
  showHint(text, x, y, below = false) {
    if (this.hintEl) this.hintEl.remove();
    this.hintEl = $(`<div class="hint ${below ? 'below' : ''}" style="left:${x}px;top:${y}px">${text}</div>`);
    this.root.appendChild(this.hintEl);
  }
  updateHints(game) {
    if (!this.hintsOn) return;
    const v = this.app.view;
    const steps = [
      { done: () => this.actions.has('undead'), show: () => { const s = v.worldToScreen(GATES[1][1].x, GATES[1][1].y, 2.2); this.showHint('Drag an undead card onto a glowing gate to attack', s.x, s.y - 10); } },
      { done: () => this.actions.has('defender'), show: () => { const s = v.worldToScreen(10, 7.5, 0.5); this.showHint('Now drag a defender beside your paths (never on them) to protect your bunker', s.x, s.y - 10); } },
      { done: () => this.actions.has('panel') || this.actions.has('upgrade'), show: () => { const s = v.worldToScreen(8, 4, 0.5); this.showHint('Click a placed defender to upgrade it, sell it or change its target', s.x, s.y); } },
      { done: () => game.t > 50, timed: 7, show: () => { const r = this.hud.orb.getBoundingClientRect(); this.showHint('Kills and bunker hits pay soul energy — and every undead you send raises your income', r.left + r.width / 2, r.top - 12); } },
      { done: () => game.t > 70, wait: () => game.t > 60, timed: 6, show: () => { const r = this.hud.timerBox.getBoundingClientRect(); this.showHint('Every 30 s the dead grow stronger. Save up for big mixed attacks!', r.left + r.width / 2, r.bottom + 14, true); } },
    ];
    const st = steps[this.hintStep];
    if (!st) { if (this.hintEl) { this.hintEl.remove(); this.hintEl = null; } this.hintsOn = false; return; }
    if (st.wait && !st.wait()) { if (this.hintEl) { this.hintEl.remove(); this.hintEl = null; } return; }
    if (!this.hintEl || this.hintEl.dataset.step != this.hintStep) { st.show(); this.hintEl.dataset.step = this.hintStep; this.hintTimer = 0; }
    this.hintTimer += 1 / 60;
    if (st.done() || (st.timed && this.hintTimer > st.timed)) { this.hintStep++; if (this.hintEl) { this.hintEl.remove(); this.hintEl = null; } }
  }

  // ================= RESULTS =================
  showResults(game, award) {
    this.closePanel();
    if (this.hintEl) this.hintEl.remove();
    this.screen = 'results';
    const won = game.winner === 0, draw = game.winner === -1;
    const me = game.players[0];
    const el = $(`<div class="screen results ${won ? 'win' : 'lose'}">
      <h1>${draw ? 'DRAW' : won ? 'VICTORY!' : 'DEFEAT'}</h1>

      <div class="stats">
        <div><b>${fmtTime(game.t)}</b>Match time</div>
        <div><b>${Math.round(me.damageDealt)}</b>Bunker damage</div>
        <div><b>${me.kills}</b>Undead killed</div>
        <div><b>${me.sent}</b>Undead sent</div>
      </div>
      <div class="reward" data-coins>
        ${award.breakdown.map(([n, v]) => `<div><span>${n}</span><b>+${v}</b></div>`).join('')}
        <div class="total"><span>Coins earned</span><b>🪙 +${award.coins}</b></div>
      </div>
      <div class="font" style="font-size:20px;color:#a8f07a">+${award.xpGained} XP${award.levelsGained ? ` · Rank up! → ${progress.level}` : ''}</div>
      ${award.newArenas.length ? `<div class="font" style="font-size:20px;color:#ffd84a">New arena unlocked: ${award.newArenas.map(a => a.name).join(', ')}!</div>` : ''}
      <div class="menu-row"><button class="btn" data-a="rematch">↻ Rematch</button><button class="btn blue" data-a="shop">🛒 Shop</button><button class="btn grey" data-a="menu">Home</button></div>
    </div>`);
    setTimeout(() => this.app.audio.play('coins'), 1400);
    el.querySelector('[data-a=rematch]').onclick = () => { this.app.audio.play('click'); this.app.startMatch(fillHand(progress.hand)); };
    el.querySelector('[data-a=shop]').onclick = () => { this.app.toMenu(); this.showShop(); };
    el.querySelector('[data-a=menu]').onclick = () => { this.app.toMenu(); };
    this.root.appendChild(el);
  }
}

function laneLen(l) { return LANE_LEN_WORD[l]; }
