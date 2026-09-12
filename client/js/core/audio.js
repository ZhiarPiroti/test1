// ============================================================
// Audio — file-based with dynamic layering + synth fallback
// ============================================================

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.musicBuffers = { combat: null };
    this.currentMusic = null;
    this.musicPlaying = false;
    this.targetIntensity = 0;
    this.musicIntensity = 0;
    this.zombieVariants = [];
    this.lastZombieSoundTime = 0;

    this._currentMusicSrc = null;
    this._currentMusicGain = null;
    this._musicRequested = false;
    this._masterGain = null;
    this._noiseBuffer = null;
  }

  async init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } catch (e) {
      console.error('[Audio] Failed to create context:', e);
      return;
    }
  
    this._masterGain = this.ctx.createGain();
    this._masterGain.gain.value = 0.7;
    this._masterGain.connect(this.ctx.destination);
  
    this._noiseBuffer = this._makeNoiseBuffer();
    console.log('[Audio] Context ready, sample rate:', this.ctx.sampleRate);
    await this._loadAll();
  }

  async _loadAll() {
    console.log('[Audio] Loading files...');

    const sfxList = [
      'zombie_growl_1', 'zombie_growl_2', 'zombie_pain', 'zombie_death',
      'shoot_pistol', 'shoot_shotgun', 'shoot_rifle', 'shoot_lmg',
      'reload', 'pickup', 'drop_land', 'empty_click', 'player_hurt',
    ];

    const sfxPromises = sfxList.map(name => this._loadOne(`audio/sfx/${name}.wav`, name));
    const results = await Promise.all(sfxPromises);

    let loadedCount = 0;
    results.forEach((buf, i) => {
      if (buf) {
        this.buffers[sfxList[i]] = buf;
        loadedCount++;
      } else {
        console.warn(`[Audio] Missing SFX: ${sfxList[i]}.wav`);
      }
    });
    console.log(`[Audio] SFX loaded: ${loadedCount}/${sfxList.length}`);

    const musicBuf = await this._loadOne('audio/music/combat.mp3', 'combat');
    if (musicBuf) {
      this.musicBuffers.combat = musicBuf;
      console.log(`[Audio] combat.mp3 loaded — ${musicBuf.duration.toFixed(1)}s`);
    } else {
      console.warn('[Audio] combat.mp3 NOT FOUND');
    }

    this.zombieVariants = ['zombie_growl_1', 'zombie_growl_2'].filter(k => this.buffers[k]);
    console.log(`[Audio] Zombie growl variants: ${this.zombieVariants.length} (fallback synth active if 0)`);

    if (this._musicRequested && this.musicBuffers.combat) {
      this._playMusicTrack('combat');
    }
  }

  async _loadOne(url, name) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      if (ab.byteLength === 0) return null;
      const buf = await this.ctx.decodeAudioData(ab);
      return buf;
    } catch (e) {
      return null;
    }
  }

  // ============ SFX PLAYER ============
  _play(name, volume = 1, pitch = 1) {
    if (!this.ctx || !this._masterGain) return null;
    const buf = this.buffers[name];
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this._masterGain);
    src.start();
    return src;
  }

  // ============ ZOMBIE MOAN (with fallback) ============
  zombieMoan(type = 'walker') {
    if (!this.ctx || !this._masterGain) return;
    const now = this.ctx.currentTime;
    if (now - this.lastZombieSoundTime < 0.15) return;
    this.lastZombieSoundTime = now;

    const basePitch = type === 'brute' ? 0.55 : type === 'runner' ? 1.35 : 0.9;
    const pitch = basePitch * (0.88 + Math.random() * 0.25);
    const vol = type === 'brute' ? 0.35 : 0.22;

    // اگه فایل هست، از فایل استفاده کن
    if (this.zombieVariants.length > 0) {
      const name = this.zombieVariants[(Math.random() * this.zombieVariants.length) | 0];
      this._play(name, vol, pitch);
      return;
    }

    // در غیر این صورت، سنتز کن
    this._synthMoan(type, vol, pitch);
  }

  _synthMoan(type, vol, pitch) {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const dur = type === 'brute' ? 1.4 : type === 'runner' ? 0.6 : 1.0;
    const baseFreq = (type === 'brute' ? 70 : type === 'runner' ? 160 : 100) * pitch;

    // لایه ۱: sawtooth
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.55, t + dur);

    // vibrato
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 3;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t); lfo.stop(t + dur);

    // distortion
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._makeDistortionCurve(40);

    // filter
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = type === 'brute' ? 350 : 700;
    lp.Q.value = 3;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.1);
    g.gain.setValueAtTime(vol, t + dur * 0.65);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);

    osc.connect(shaper).connect(lp).connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + dur + 0.05);

    // لایه نویز
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 200 + Math.random() * 200;
    nf.Q.value = 6;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(vol * 0.4, t + 0.15);
    ng.gain.linearRampToValueAtTime(0.0001, t + dur);
    noise.connect(nf).connect(ng).connect(this._masterGain);
    noise.start(t); noise.stop(t + dur);
  }

  zombieHit() {
    if (this._play('zombie_pain', 0.5, 1.1 + Math.random() * 0.2)) return;
    this._playSynthHit();
  }

  _playSynthHit() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.08);
    f.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    noise.connect(f).connect(g).connect(this._masterGain);
    noise.start(t); noise.stop(t + 0.12);
  }

  zombieDeath() {
    if (this._play('zombie_death', 0.7, 0.9 + Math.random() * 0.2)) return;
    this._playSynthDeath();
  }

  _playSynthDeath() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const dur = 0.6;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(120, t + dur);
    f.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(f).connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  shoot(type = 'pistol') {
    const map = {
      pistol: 'shoot_pistol',
      shotgun: 'shoot_shotgun',
      smg: 'shoot_pistol',
      rifle: 'shoot_rifle',
      lmg: 'shoot_lmg',
    };
    if (this._play(map[type] || 'shoot_pistol', 0.8, 0.95 + Math.random() * 0.1)) return;
    this._playSynthShot(type);
  }

  _playSynthShot(type) {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const cfg = {
      pistol:  { freq: 900,  dur: 0.14, vol: 0.5 },
      shotgun: { freq: 600,  dur: 0.28, vol: 0.7 },
      smg:     { freq: 1200, dur: 0.08, vol: 0.4 },
      rifle:   { freq: 500,  dur: 0.18, vol: 0.6 },
      lmg:     { freq: 800,  dur: 0.10, vol: 0.5 },
    }[type] || { freq: 800, dur: 0.12, vol: 0.5 };

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(cfg.freq, t);
    osc.frequency.exponentialRampToValueAtTime(cfg.freq * 0.3, t + cfg.dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(cfg.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + cfg.dur);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + cfg.dur + 0.02);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 2500;
    nf.Q.value = 0.7;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(cfg.vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + cfg.dur * 0.6);
    noise.connect(nf).connect(ng).connect(this._masterGain);
    noise.start(t); noise.stop(t + cfg.dur);
  }

  reload() { if (!this._play('reload', 0.6)) this._playSynthClick(400, 0.15); }
  emptyClick() { if (!this._play('empty_click', 0.4)) this._playSynthClick(2000, 0.1); }
  pickup() { if (!this._play('pickup', 0.7)) this._playSynthPickup(); }
  dropLand() { if (!this._play('drop_land', 0.8)) this._playSynthThud(); }
  playerHurt() { if (!this._play('player_hurt', 0.9)) this._playSynthHurt(); }
  swapWeapon() { if (!this._play('pickup', 0.4, 1.5)) this._playSynthClick(600, 0.08); }

  _playSynthClick(freq, dur) {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  _playSynthPickup() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      const tt = t + i * 0.06;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.12, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.15);
      osc.connect(g).connect(this._masterGain);
      osc.start(tt); osc.stop(tt + 0.2);
    });
  }

  _playSynthThud() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + 0.4);
  }

  _playSynthHurt() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + 0.3);
  }

  // ============ BOSS SFX ============
  bossRoar(type = 'butcher') {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const cfg = {
      butcher:  { baseFreq: 70,  duration: 1.6, growl: 0.9, volume: 0.5 },
      mother:   { baseFreq: 95,  duration: 1.4, growl: 0.6, volume: 0.45 },
      stalker:  { baseFreq: 180, duration: 1.0, growl: 0.4, volume: 0.4 },
      colossus: { baseFreq: 45,  duration: 2.4, growl: 1.0, volume: 0.6 },
    }[type] || { baseFreq: 80, duration: 1.5, growl: 0.8, volume: 0.5 };

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(cfg.baseFreq, t);
    osc.frequency.linearRampToValueAtTime(cfg.baseFreq * 0.5, t + cfg.duration);

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 4 + Math.random() * 2;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 10;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t); lfo.stop(t + cfg.duration);

    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._makeDistortionCurve(60);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.Q.value = 4;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(cfg.volume, t + 0.15);
    g.gain.setValueAtTime(cfg.volume, t + cfg.duration * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + cfg.duration);

    osc.connect(shaper).connect(lp).connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + cfg.duration + 0.05);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 250;
    nf.Q.value = 5;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(cfg.growl * 0.3, t + 0.2);
    ng.gain.linearRampToValueAtTime(0.0001, t + cfg.duration);
    noise.connect(nf).connect(ng).connect(this._masterGain);
    noise.start(t); noise.stop(t + cfg.duration + 0.05);
  }

  bossSpawn() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + 1.5);
  }

  bossSlam() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + 0.5);
  }

  bossTeleport() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + 0.3);
  }

  bossDeath() {
    if (!this.ctx || !this._masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.linearRampToValueAtTime(30, t + 2.0);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._makeDistortionCurve(80);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.linearRampToValueAtTime(0.3, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    osc.connect(shaper).connect(g).connect(this._masterGain);
    osc.start(t); osc.stop(t + 2.3);
  }

  // ============ HELPERS ============
  _makeNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const len = sr * 1.5;
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeDistortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // ============ MUSIC ============
  startMusic() {
    if (!this.ctx) return;
    this.musicPlaying = true;
    if (this.musicBuffers.combat) {
      this._playMusicTrack('combat');
    } else {
      this._musicRequested = true;
    }
  }

  _playMusicTrack(track) {
    if (!this.musicBuffers[track]) return;
    if (this.currentMusic === track && this._currentMusicSrc) return;

    if (this._currentMusicSrc) {
      const old = this._currentMusicSrc;
      const oldGain = this._currentMusicGain;
      const t = this.ctx.currentTime;
      try {
        oldGain.gain.cancelScheduledValues(t);
        oldGain.gain.setValueAtTime(oldGain.gain.value, t);
        oldGain.gain.linearRampToValueAtTime(0, t + 0.5);
      } catch (e) {}
      setTimeout(() => { try { old.stop(); } catch (e) {} }, 600);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.musicBuffers[track];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this._masterGain);
    src.start();

    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 1.2);

    this.currentMusic = track;
    this._currentMusicSrc = src;
    this._currentMusicGain = g;
  }

  setIntensity(target) { this.targetIntensity = target; }

  suspendMusic() {
    if (!this._currentMusicGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._currentMusicGain.gain.cancelScheduledValues(t);
    this._currentMusicGain.gain.setValueAtTime(this._currentMusicGain.gain.value, t);
    this._currentMusicGain.gain.linearRampToValueAtTime(0, t + 0.3);
  }

  resumeMusic() {
    if (!this._currentMusicGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._currentMusicGain.gain.cancelScheduledValues(t);
    this._currentMusicGain.gain.setValueAtTime(this._currentMusicGain.gain.value, t);
    this._currentMusicGain.gain.linearRampToValueAtTime(0.35, t + 0.4);
  }
}
