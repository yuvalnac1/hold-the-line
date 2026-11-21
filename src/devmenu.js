// Hidden developer menu: live-edit every PRD value, test buttons, export JSON, match log.
import { CONFIG, DEFAULT_CONFIG, ALL_CARDS, applyTuning, tuningDiff } from './config.js';
import { progress, save, resetProgress, grantStartingCoins } from './progress.js';
import { BUILD_TILES } from './arena.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const LABELS = {
  ecoSoftCap: 'Eco income soft cap / tick', ecoOverCap: 'Eco share above cap', lateJitter: 'Late pressure start ± (s)', bossJitter: 'Boss arrival ± (s)', paceJitter: 'Match pace variation ±',
  aiPressureBase: 'CPU attack cap (base)', aiPressurePerSec: 'CPU attack cap / s', aiOffensiveFirst: 'CPU first offensive after (s)', aiOffensiveSpread: 'CPU first offensive spread (s)', aiOffensiveGap: 'CPU offensive gap min (s)', aiOffensiveGapRand: 'CPU offensive gap random (s)',
  revealLinger: 'Ghost stays revealed (s)', ghostSenseRadius: 'Defenders sense ghosts within', startingCoins: 'Starting coins (new players)', startEnergy: 'Starting soul energy', baseIncome: 'Base income (per tick)', incomeInterval: 'Income tick (s)', incomeGrowthPerMin: 'Income growth / min',
  killRewardMult: 'Kill reward ×', bunkerDamageReward: 'Bunker dmg reward / pt', ecoMult: 'Eco boost ×', ecoPerTick: 'Eco share paid per tick', bunkerHealth: 'Bunker health (next match)',
  escalationStart: 'Escalation start (s)', escalationEvery: 'Escalation every (s)', escalationHealth: 'Escalation +health',
  lateStart: 'Late pressure start (s)', lateEvery: 'Late pressure every (s)', lateHealth: 'Late +health / stack', lateSpeed: 'Late +speed / stack', lateBunkerDmg: 'Late +bunker dmg / stack',
  timeLimit: 'Time limit (s, 0 = none)', duplicateCostIncrease: 'Duplicate defender cost +', buildSpotsPerSide: 'Build spots per side', sellRefund: 'Sell refund',
  wavesOn: 'Automatic waves', waveStart: 'First wave (s)', waveEvery: 'Wave every (s)', waveSize: 'Wave size at start', waveGrowthPerMin: 'Wave size growth / min',
  gameSpeed: 'Game speed', aiDecisionSlow: 'CPU decision s (weakest)', aiDecisionFast: 'CPU decision s (strongest)', tileSpeed: 'Tiles/s at speed 1.0',
};

export class DevMenu {
  constructor(app) { this.app = app; this.el = null; this.tab = 'global'; this.unit = 'skeleton'; this.defType = 'rifleman'; this.placeMode = null; }
  toggle() { if (this.el) { this.el.remove(); this.el = null; } else this.open(); }
  open() {
    this.el = $(`<div class="dev"><div class="tabs">${['global', 'undead', 'defenders', 'sabotage', 'log'].map(t => `<button data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div class="body"></div><div class="foot"></div></div>`);
    this.el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.render(); });
    // every value change is saved to public/tuning.json (designer-owned, overrides the code defaults)
    const body = this.el.querySelector('.body');
    body.addEventListener('input', () => this.queueSave());
    body.addEventListener('change', () => this.queueSave());
    document.body.appendChild(this.el);
    this.render();
  }
  num(obj, key, step = 'any') {
    const v = obj[key];
    if (typeof v === 'boolean') { const i = $(`<input type="checkbox" ${v ? 'checked' : ''}>`); i.onchange = () => { obj[key] = i.checked; }; return i; }
    if (typeof v === 'string') { const i = $(`<input type="text" value="${v}">`); i.onchange = () => { obj[key] = i.value; }; return i; }
    const i = $(`<input type="number" step="${step}" value="${v}">`);
    i.oninput = () => { const n = parseFloat(i.value); if (!isNaN(n)) obj[key] = n; };
    return i;
  }
  row(label, input) { const l = $(`<label><span>${label}</span></label>`); l.appendChild(input); return l; }

  render() {
    const body = this.el.querySelector('.body'), foot = this.el.querySelector('.foot');
    this.el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === this.tab));
    body.innerHTML = '';
    const g = this.app.game;
    if (this.tab === 'global') {
      for (const k of Object.keys(CONFIG.global)) {
        if (k === 'gameSpeed') {
          const r = $(`<input type="range" min="0.5" max="4" step="0.25" value="${CONFIG.global.gameSpeed}">`);
          const out = $(`<b style="width:34px;text-align:right">${CONFIG.global.gameSpeed}×</b>`);
          r.oninput = () => { CONFIG.global.gameSpeed = +r.value; out.textContent = r.value + '×'; };
          const wrap = $('<span style="display:flex;gap:6px;align-items:center"></span>'); wrap.append(r, out);
          body.appendChild(this.row(LABELS[k], wrap)); continue;
        }
        body.appendChild(this.row(LABELS[k] || k, this.num(CONFIG.global, k)));
      }
    } else if (this.tab === 'undead') {
      const sel = $(`<select>${Object.keys(CONFIG.undead).map(k => `<option value="${k}" ${k === this.unit ? 'selected' : ''}>${CONFIG.undead[k].name}</option>`).join('')}</select>`);
      sel.onchange = () => { this.unit = sel.value; this.render(); };
      body.appendChild(this.row('Undead', sel));
      const u = CONFIG.undead[this.unit];
      for (const k of Object.keys(u)) { if (k === 'name' || k === 'hidden') continue; body.appendChild(this.row(k, this.num(u, k))); }
    } else if (this.tab === 'defenders') {
      const sel = $(`<select>${Object.keys(CONFIG.defenders).map(k => `<option value="${k}" ${k === this.defType ? 'selected' : ''}>${CONFIG.defenders[k].name}</option>`).join('')}</select>`);
      sel.onchange = () => { this.defType = sel.value; this.render(); };
      body.appendChild(this.row('Defender', sel));
      const d = CONFIG.defenders[this.defType];
      body.appendChild(this.row('Max per player', this.num(d, 'max')));
      body.appendChild(this.row('Unlocked', this.num(d, 'unlocked')));
      const keys = [...new Set(d.levels.flatMap(l => Object.keys(l)))].filter(k => k !== 'desc');
      const t = $(`<table><tr><th>Setting</th><th>Base</th><th>Level 2</th><th>Level 3</th></tr></table>`);
      for (const k of keys) {
        const tr = $(`<tr><td>${k === 'cost' ? 'cost (place / upgrade)' : k}</td></tr>`);
        for (const lv of d.levels) { const td = document.createElement('td'); if (k in lv) td.appendChild(this.num(lv, k)); tr.appendChild(td); }
        t.appendChild(tr);
      }
      body.appendChild(t);
    } else if (this.tab === 'sabotage') {
      const t = $(`<table><tr><th>Card</th><th>Cost</th><th>Cooldown</th><th>Duration</th><th>Strength</th><th>Unlocked</th></tr></table>`);
      for (const [id, c] of Object.entries(CONFIG.sabotage)) {
        const tr = $(`<tr><td>${c.name}</td></tr>`);
        for (const k of ['cost', 'cooldown', 'duration', 'strength', 'unlocked']) { const td = document.createElement('td'); td.appendChild(this.num(c, k)); tr.appendChild(td); }
        t.appendChild(tr);
      }
      body.appendChild(t);
    } else if (this.tab === 'log') {
      const log = progress.log;
      const inT = log.filter(m => m.reason === 'bunker' && m.t >= 180 && m.t <= 360).length;
      body.appendChild($(`<div><h4>Balance target</h4>${log.length ? `${inT} / ${log.length} matches (${Math.round(inT / log.length * 100)}%) ended with a bunker destroyed between 3:00 and 6:00.` : 'No matches logged yet.'}</div>`));
      body.appendChild($(`<h4>Match log</h4>`));
      body.appendChild($(`<div class="log">${log.map(m => `${m.date}  ${fmt(m.t)}  ${m.reason.padEnd(6)}  ${m.winner === 0 ? 'player won' : m.winner === 1 ? 'cpu won   ' : 'draw      '}  ${m.difficulty}`).join('\n') || '—'}</div>`));
    }

    // test buttons
    foot.innerHTML = '';
    const B = (label, fn, on) => { const b = $(`<button class="${on ? 'on' : ''}">${label}</button>`); b.onclick = () => { fn(); this.render(); }; foot.appendChild(b); };
    B('Export JSON', () => this.export());
    B('Reset values', () => { applyTuning({}); this.queueSave(0); });
    if (g && !g.over) {
      B('+500 soul', () => g.devEnergy(0, 500));
      B('Heal my bunker', () => g.devHeal(0));
      const spawnSel = $(`<select>${Object.keys(CONFIG.undead).map(k => `<option value="${k}">${CONFIG.undead[k].name}</option>`).join('')}</select>`);
      const sideSel = $(`<select><option value="1">→ enemy side</option><option value="0">→ my side</option></select>`);
      const laneSel = $(`<select><option value="0">Top</option><option value="1">Mid</option><option value="2">Bottom</option></select>`);
      const sp = $(`<button>Spawn</button>`);
      sp.onclick = () => g.sendUndead(sideSel.value === '1' ? 0 : 1, spawnSel.value, +laneSel.value, true);
      const wrap = $('<span style="display:flex;gap:3px;width:100%"></span>'); wrap.append(spawnSel, sideSel, laneSel, sp); foot.appendChild(wrap);
      const defSel = $(`<select>${Object.keys(CONFIG.defenders).map(k => `<option value="${k}">${CONFIG.defenders[k].name}</option>`).join('')}</select>`);
      if (this.placeMode) defSel.value = this.placeMode;
      const pd = $(`<button class="${this.placeMode ? 'on' : ''}">${this.placeMode ? 'Click map to place (free)…' : 'Place free'}</button>`);
      pd.onclick = () => { this.placeMode = this.placeMode ? null : defSel.value; this.render(); };
      defSel.onchange = () => { if (this.placeMode) this.placeMode = defSel.value; };
      const w2 = $('<span style="display:flex;gap:3px;width:100%"></span>'); w2.append(defSel, pd); foot.appendChild(w2);
      B('Spawn next boss', () => g.devBoss());
      B('Show ranges & paths', () => { this.debug = !this.debug; this.app.view.setShowDebug(this.debug, g); }, this.debug);
      B(g.aiPaused ? 'Resume CPU' : 'Pause CPU', () => { g.aiPaused = !g.aiPaused; }, g.aiPaused);
      B('Skip to end', () => g.devSkipToEnd());
    }
    B('Unlock all', () => { progress.owned = [...ALL_CARDS]; save(); });
    B('+1000 coins', () => { progress.coins += 1000; save(); });
    B('Reset unlocks', () => { resetProgress(); grantStartingCoins(); });
  }

  placeAt(p) {
    const g = this.app.game;
    const side = p.x < 19 ? 0 : 1;
    const i = Math.floor(p.x), j = Math.floor(p.y);
    if (!BUILD_TILES[side].some(t => t.i === i && t.j === j)) return this.app.ui.toast('Not a build spot');
    if (!g.placeDefender(side, this.placeMode, i, j, true)) this.app.ui.toast('Can’t place there');
  }

  queueSave(delay = 400) {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.saveTuning(), delay);
  }
  async saveTuning() {
    const data = { _note: 'Designer-owned values from the developer menu. They override src/config.js defaults. Code changes never edit this file.', ...(tuningDiff() || {}) };
    const n = Object.keys(data).length - 1;
    try {
      const r = await fetch('/__save-tuning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(await r.text());
      this.status(`✓ Saved to tuning.json${n ? '' : ' (no overrides — using code defaults)'}`);
    } catch (e) { this.status('⚠ Could not save (saving works with npm run dev only) — use Export JSON'); }
  }
  status(text) {
    if (!this.el) return;
    let s = this.el.querySelector('.save-status');
    if (!s) { s = $('<div class="save-status"></div>'); this.el.querySelector('.tabs').after(s); }
    s.textContent = text;
  }

  export() {
    const json = JSON.stringify(CONFIG, null, 2);
    navigator.clipboard?.writeText(json).then(() => this.app.ui.toast('Config JSON copied to clipboard'), () => {});
    const body = this.el.querySelector('.body');
    const ta = $(`<textarea readonly></textarea>`); ta.value = json;
    body.prepend(ta); ta.select();
  }
}
function fmt(t) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
