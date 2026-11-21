// Procedural Web Audio: one distinct sound per weapon, undead groans, and a tense music loop.
export class Audio {
  constructor() {
    this.ctx = null;
    this.last = {};
    this.muted = false;
    this.intensity = 1;
    this.musicOn = false;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    setTimeout(() => { this.loadSamples(); this.preloadVoices(); this.loadTracks(); }, 0);
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb-ish
    this.verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3); }
    this.verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.25; this.verb.connect(vg); vg.connect(this.master);
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  setIntensity(i) {
    const was = this.intensity; this.intensity = i;
    if (i >= 2 && was < 2 && (this.wantTrack === 'battle')) this.music_('final');
  }

  // ---------- announcer (generated mp3 voice lines) ----------
  setVoices(urls) { this.voiceUrls = urls; this.voiceBufs = {}; }
  async loadVoice(id) {
    if (!this.ctx || !this.voiceUrls?.[id]) return null;
    if (!this.voiceBufs[id]) this.voiceBufs[id] = fetch(this.voiceUrls[id]).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).catch(() => null);
    return this.voiceBufs[id];
  }
  preloadVoices() { for (const id of Object.keys(this.voiceUrls || {})) this.loadVoice(id); }
  async voice(id) {
    if (!this.ctx || this.muted) return;
    // boss arrivals: a different line each time (never the same twice in a row)
    if (id === 'wave') {
      const opts = Object.keys(this.voiceUrls || {}).filter(k => /^wave\d*$/.test(k));
      const pool = opts.length > 1 ? opts.filter(k => k !== this.lastWave) : opts;
      id = pool[Math.floor(Math.random() * pool.length)] || 'wave';
      this.lastWave = id;
    }
    const buf = await this.loadVoice(id);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (this.voiceSrc) try { this.voiceSrc.stop(); } catch { /* already ended */ }
    const src = this.voiceSrc = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = 1.15;
    src.connect(g); g.connect(this.master);
    // duck the music under the announcer
    this.music.gain.cancelScheduledValues(now);
    this.music.gain.setTargetAtTime(0.12, now, 0.05);
    this.music.gain.setTargetAtTime(0.32, now + buf.duration, 0.4);
    src.start(now + 0.02);
  }

  // ---------- primitives ----------
  out(pan = 0, wet = 0.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(this.sfx);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(this.verb); }
    return g;
  }
  noiseHit(dest, t, dur, { type = 'bandpass', f = 1000, f2 = null, q = 1, vol = 1, attack = 0.002 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(dest, t, dur, { type = 'sine', f = 220, f2 = null, vol = 0.5, attack = 0.005, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- generated samples (public/assets/sfx) ----------
  setSamples(urls) { this.sampleUrls = urls || {}; this.samples = {}; if (this.ctx) this.loadSamples(); }
  loadSamples() {
    for (const [id, url] of Object.entries(this.sampleUrls || {})) {
      if (this.samples[id]) continue;
      this.samples[id] = 'loading';
      fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).then(buf => { this.samples[id] = trimSample(buf); }).catch(() => { delete this.samples[id]; });
    }
  }
  playSample(name, smp, t, pan, o) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = smp.buf;
    const vary = { mg: 0.12, rifle: 0.1, rattle: 0.15, groan: 0.15, sword: 0.12, clang: 0.15, boom: 0.08, click: 0.03 }[name] ?? 0.05;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * vary;
    const g = ctx.createGain();
    // per-sound mix: frequent sounds quieter so battles don't turn to mush
    g.gain.value = ({ mg: 0.35, rifle: 0.45, drone: 0.35, rattle: 0.5, groan: 0.55, flame: 0.5, clang: 0.4, crumble: 0.5, gate: 0.5, click: 0.6, bunker: 0.9, boom: 0.75, cannon: 0.8, horn: 0.8, win: 0.9, lose: 0.9 }[name] ?? 0.7) * (o.mine === false ? 0.7 : 1);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.gain.value *= smp.norm;
    // rapid-fire sounds only play their attack so they don't smear together
    const cap = { mg: 0.14, rifle: 0.45, drone: 0.35, sword: 0.5, clang: 0.45, rattle: 0.9, groan: 1.3, flame: 0.8, click: 0.25, deny: 0.5, place: 0.8, thump: 0.6, raise: 3, fog: 2.5, crumble: 1.2 }[name] ?? 4;
    const dur = Math.min(smp.dur, cap);
    g.gain.setTargetAtTime(0, t + dur / src.playbackRate.value - 0.04, 0.015);
    src.connect(g); g.connect(p); p.connect(this.sfx);
    if (['boom', 'cannon', 'sniper', 'bunker', 'horn', 'siren'].includes(name)) { const w = ctx.createGain(); w.gain.value = 0.25; g.connect(w); w.connect(this.verb); }
    src.start(t, smp.off, dur + 0.05);
  }

  play(name, o = {}) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const gap = { mg: 0.06, rifle: 0.05, flame: 0.12, dmg: 0.03, rattle: 0.05, boom: 0.05, clang: 0.06, drone: 0.08, groan: 0.4, sword: 0.06, wail: 0.2, crumble: 0.08, bunker: 0.1 }[name] ?? 0.03;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const t = now + 0.005, pan = o.pan || 0;
    const smp = this.samples?.[name];
    if (smp && smp !== 'loading') { this.playSample(name, smp, t, pan, o); return; }
    const d = this.out(pan, 0.15);
    switch (name) {
      case 'rifle': this.noiseHit(d, t, 0.12, { type: 'highpass', f: 1800, vol: 0.5 }); this.tone(d, t, 0.06, { type: 'square', f: 300, f2: 90, vol: 0.12 }); break;
      case 'mg': this.noiseHit(d, t, 0.07, { type: 'bandpass', f: 2400, q: 0.8, vol: 0.35 }); this.tone(d, t, 0.04, { type: 'square', f: 180, f2: 70, vol: 0.08 }); break;
      case 'sniper': { const d2 = this.out(pan, 0.6); this.noiseHit(d2, t, 0.5, { type: 'lowpass', f: 3000, f2: 300, vol: 0.8 }); this.tone(d2, t, 0.35, { type: 'sine', f: 120, f2: 40, vol: 0.6 }); break; }
      case 'drone': this.tone(d, t, 0.06, { type: 'sawtooth', f: 900, f2: 400, vol: 0.06 }); this.noiseHit(d, t, 0.05, { type: 'highpass', f: 3000, vol: 0.15 }); break;
      case 'sword': this.noiseHit(d, t, 0.18, { type: 'bandpass', f: 1200, f2: 5000, q: 2, vol: 0.4, attack: 0.03 }); this.tone(d, t + 0.05, 0.12, { type: 'triangle', f: 2400, f2: 1800, vol: 0.04 }); break;
      case 'flame': this.noiseHit(d, t, 0.3, { type: 'lowpass', f: 900, f2: 500, vol: 0.35, attack: 0.04 }); this.noiseHit(d, t, 0.25, { type: 'bandpass', f: 300, q: 0.7, vol: 0.25, attack: 0.03 }); break;
      case 'thump': this.tone(d, t, 0.15, { type: 'sine', f: 160, f2: 60, vol: 0.4 }); this.noiseHit(d, t, 0.1, { type: 'lowpass', f: 800, vol: 0.3 }); break;
      case 'cannon': { const d2 = this.out(pan, 0.5); this.tone(d2, t, 0.5, { type: 'sine', f: 90, f2: 30, vol: 0.9 }); this.noiseHit(d2, t, 0.45, { type: 'lowpass', f: 1500, f2: 150, vol: 0.8 }); break; }
      case 'missile': this.noiseHit(d, t, 0.8, { type: 'bandpass', f: 600, f2: 2600, q: 1.5, vol: 0.45, attack: 0.05 }); break;
      case 'boom': {
        const big = o.big, small = o.small;
        const d2 = this.out(pan, big ? 0.6 : 0.3);
        this.tone(d2, t, big ? 0.9 : 0.4, { type: 'sine', f: big ? 70 : 110, f2: 25, vol: big ? 1 : small ? 0.35 : 0.6 });
        this.noiseHit(d2, t, big ? 1.0 : 0.45, { type: 'lowpass', f: big ? 1800 : 2200, f2: 120, vol: big ? 0.9 : small ? 0.35 : 0.6 });
        break;
      }
      case 'clang': if (o.stone) this.noiseHit(d, t, 0.1, { type: 'bandpass', f: 1500, q: 3, vol: 0.4 }); else { this.tone(d, t, 0.25, { type: 'triangle', f: 1300, vol: 0.12 }); this.tone(d, t, 0.2, { type: 'triangle', f: 1950, vol: 0.08 }); } break;
      case 'rattle': for (let k = 0; k < 5; k++) this.noiseHit(d, t + k * 0.025 + Math.random() * 0.01, 0.03, { type: 'bandpass', f: 2500 + Math.random() * 2000, q: 6, vol: 0.4 }); this.tone(d, t, 0.25, { type: 'sine', f: 500, f2: 160, vol: 0.06 }); break;
      case 'crumble': this.noiseHit(d, t, 0.5, { type: 'lowpass', f: 1200, f2: 200, vol: 0.6 }); for (let k = 0; k < 4; k++) this.noiseHit(d, t + k * 0.06, 0.05, { type: 'bandpass', f: 900, q: 4, vol: 0.4 }); break;
      case 'wail': this.tone(this.out(pan, 0.7), t, 0.8, { type: 'sine', f: 700, f2: 300, vol: 0.12, attack: 0.1 }); break;
      case 'groan': {
        const ctx = this.ctx;
        const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
        const base = o.unit === 'golem' || o.unit === 'dragon' ? 55 : o.unit === 'bats' ? 600 : 95 + Math.random() * 40;
        o1.frequency.setValueAtTime(base, t); o1.frequency.linearRampToValueAtTime(base * 0.7, t + 0.7);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 5; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(350, t + 0.7);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 6; lfo.connect(lg); lg.connect(o1.frequency);
        o1.connect(f); f.connect(g); g.connect(this.out(pan, 0.4));
        o1.start(t); lfo.start(t); o1.stop(t + 0.85); lfo.stop(t + 0.85);
        break;
      }
      case 'gate': { const d2 = this.out(pan, 0.4); this.noiseHit(d2, t, 0.6, { type: 'lowpass', f: 220, vol: 0.7, attack: 0.05 }); this.tone(d2, t, 0.5, { type: 'sine', f: 50, f2: 38, vol: 0.5, attack: 0.04 }); break; }
      case 'place': this.noiseHit(d, t, 0.12, { type: 'lowpass', f: 600, vol: 0.5 }); this.tone(d, t, 0.1, { type: 'triangle', f: 520, f2: 780, vol: 0.12 }); break;
      case 'upgrade': [523, 659, 784, 1047].forEach((f, k) => this.tone(d, t + k * 0.06, 0.25, { type: 'triangle', f, vol: 0.15 })); break;
      case 'sell': [784, 523].forEach((f, k) => this.tone(d, t + k * 0.07, 0.2, { type: 'triangle', f, vol: 0.12 })); break;
      case 'bunker': { const d2 = this.out(pan, 0.5); this.tone(d2, t, 0.6, { type: 'sine', f: 80, f2: 35, vol: o.mine ? 1 : 0.5 }); this.noiseHit(d2, t, 0.5, { type: 'lowpass', f: 900, f2: 100, vol: o.mine ? 0.8 : 0.4 }); if (o.mine) this.tone(d2, t, 0.3, { type: 'square', f: 220, f2: 180, vol: 0.06 }); break; }
      case 'fog': this.noiseHit(this.out(0, 0.8), t, 1.4, { type: 'lowpass', f: 400, f2: 1500, vol: 0.4, attack: 0.4 }); break;
      case 'emp': { const d2 = this.out(0, 0.6); this.tone(d2, t, 0.9, { type: 'sawtooth', f: 1500, f2: 40, vol: 0.3 }); this.noiseHit(d2, t, 0.6, { type: 'highpass', f: 4000, vol: 0.3 }); break; }
      case 'raise': { const d2 = this.out(0, 0.8); [220, 277, 330, 440].forEach((f, k) => this.tone(d2, t + k * 0.08, 0.8, { type: 'sine', f, vol: 0.12, attack: 0.05 })); break; }
      case 'siren': { const d2 = this.out(0, 0.5); this.tone(d2, t, 1.2, { type: 'sawtooth', f: 400, f2: 800, vol: 0.12, attack: 0.1 }); this.tone(d2, t + 1.2, 0.8, { type: 'sawtooth', f: 800, f2: 400, vol: 0.12 }); break; }
      case 'horn': { const d2 = this.out(0, 0.8); [110, 165, 220].forEach(f => this.tone(d2, t, 1.8, { type: 'sawtooth', f, vol: 0.13, attack: 0.15 })); this.tone(d2, t, 1.8, { type: 'sine', f: 55, vol: 0.4, attack: 0.1 }); break; }
      case 'click': this.tone(d, t, 0.05, { type: 'triangle', f: 1200, vol: 0.1 }); break;
      case 'deny': this.tone(d, t, 0.15, { type: 'square', f: 180, f2: 140, vol: 0.08 }); break;
      case 'win': { const d2 = this.out(0, 0.6); [523, 659, 784, 1047, 784, 1047].forEach((f, k) => this.tone(d2, t + k * 0.14, 0.5, { type: 'triangle', f, vol: 0.22 })); [262, 392].forEach(f => this.tone(d2, t + 0.56, 1.2, { type: 'sawtooth', f, vol: 0.08 })); break; }
      case 'lose': { const d2 = this.out(0, 0.6); [392, 349, 311, 262].forEach((f, k) => this.tone(d2, t + k * 0.3, 0.6, { type: 'triangle', f, vol: 0.2 })); break; }
    }
  }

  // ---------- music: generated tracks (menu / battle / final), procedural fallback ----------
  setTracks(urls) {
    this.trackUrls = urls || {}; this.tracks = {};
    if (this.ctx) { this.loadTracks(); if (this.wantTrack) this.music_(this.wantTrack); }   // music asked for before the files were known
  }
  loadTracks() {
    this.tracks ??= {};
    for (const [id, url] of Object.entries(this.trackUrls || {})) {
      if (this.tracks[id]) continue;
      this.tracks[id] = fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).catch(() => null);
    }
  }
  async playTrack(id) {
    if (!this.ctx) return false;
    if (this.trackId === id && this.trackSrc) return true;
    if (!this.tracks?.[id] && this.trackUrls?.[id]) this.loadTracks();   // not loading yet → start now, then wait
    const buf = await this.tracks?.[id];
    if (!buf) return false;
    if (this.wantTrack !== id) return true;               // something else was requested meanwhile
    const now = this.ctx.currentTime;
    if (this.trackSrc) { const old = this.trackSrc, og = this.trackGain; og.gain.setTargetAtTime(0, now, 0.4); setTimeout(() => { try { old.stop(); } catch { /* */ } }, 2500); }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(id === 'menu' ? 1.6 : 0.85, now, 0.5);   // menu song sits forward; battle music under the action
    src.connect(g); g.connect(this.music); src.start(now + 0.05);
    this.trackSrc = src; this.trackGain = g; this.trackId = id;
    return true;
  }
  stopTrack() {
    if (!this.trackSrc) return;
    const s = this.trackSrc, g = this.trackGain; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => { try { s.stop(); } catch { /* */ } }, 1500);
    this.trackSrc = null; this.trackId = null;
  }
  async music_(id) {
    this.wantTrack = id;
    const ok = await this.playTrack(id);
    if (ok) { this.stopProcedural(); return; }
    if (id !== 'menu') this.startProcedural();
  }
  startMenuMusic() { if (this.ctx) this.music_('menu'); }
  startMusic() { this.music_(this.intensity >= 2 ? 'final' : 'battle'); }
  stopMusic() { this.wantTrack = null; this.stopTrack(); this.stopProcedural(); }

  startProcedural() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.schedule(), 50);
  }
  stopProcedural() { this.musicOn = false; clearInterval(this.musicTimer); }
  schedule() {
    const ctx = this.ctx;
    const bpm = this.intensity >= 3 ? 132 : this.intensity >= 2 ? 120 : 96;
    const spb = 60 / bpm / 2; // eighth notes
    const roots = [45, 45, 41, 43]; // A, A, F, G (minor-ish)
    while (this.nextT < ctx.currentTime + 0.25) {
      const t = this.nextT, s = this.step;
      const bar = Math.floor(s / 8) % 4, beat = s % 8;
      const root = roots[bar];
      const mf = n => 440 * Math.pow(2, (n - 69) / 12);
      // bass pulse
      if (beat % 2 === 0) this.tone(this.music, t, spb * 1.8, { type: 'sawtooth', f: mf(root - 12), vol: 0.22, attack: 0.01 });
      // ostinato
      const arp = [0, 3, 7, 3, 12, 7, 3, 7];
      if (this.intensity >= 1) this.tone(this.music, t, spb * 0.9, { type: 'triangle', f: mf(root + arp[beat]), vol: this.intensity >= 2 ? 0.07 : 0.045 });
      // drums
      if (beat === 0 || beat === 4 || (this.intensity >= 2 && beat === 6)) { this.tone(this.music, t, 0.25, { type: 'sine', f: 90, f2: 40, vol: 0.5 }); }
      if (this.intensity >= 2 && beat % 2 === 1) this.noiseHit(this.music, t, 0.05, { type: 'highpass', f: 6000, vol: 0.12 });
      if (beat === 4 && this.intensity >= 2) this.noiseHit(this.music, t, 0.18, { type: 'bandpass', f: 1800, q: 0.7, vol: 0.25 });
      // pad
      if (beat === 0) [0, 7, 15].forEach(iv => this.tone(this.music, t, spb * 8, { type: 'sine', f: mf(root + 12 + iv), vol: 0.035, attack: 0.4 }));
      if (this.intensity >= 3 && beat % 4 === 2) this.tone(this.music, t, spb * 2, { type: 'square', f: mf(root + 24 + (bar % 2 ? 1 : 0)), vol: 0.025 });
      this.nextT += spb; this.step++;
    }
  }
}

// Find where the sound actually starts/ends and how loud it is, so generated clips
// (which often have silence padding and uneven levels) play tight and even.
function trimSample(buf) {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  if (peak < 1e-4) return { buf, off: 0, dur: buf.duration, norm: 1 };
  let a = 0, b = d.length - 1;
  while (a < d.length && Math.abs(d[a]) < peak * 0.06) a++;
  while (b > a && Math.abs(d[b]) < peak * 0.015) b--;
  const sr = buf.sampleRate;
  const off = Math.max(0, a / sr - 0.005);
  return { buf, off, dur: Math.max(0.05, (b - a) / sr + 0.06), norm: Math.min(6, 0.8 / peak) };
}
