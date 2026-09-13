// ============================================================
// DOM HUD updates — synced each frame from world state
// ============================================================

export class HUD {
    constructor(world) {
      this.world = world;
      this.el = {
        hp:         document.getElementById('hp'),
        hptext:     document.getElementById('hptext'),
        wave:       document.getElementById('wave'),
        wavesub:    document.getElementById('wavesub'),
        score:      document.getElementById('score'),
        kills:      document.getElementById('kills'),
        hudname:    document.getElementById('hudname'),
        weaponName: document.getElementById('weaponName'),
        ammoMag:    document.getElementById('ammoMag'),
        ammoRes:    document.getElementById('ammoRes'),
        ammoHint:   document.getElementById('ammoHint'),
        dropHint:   document.getElementById('dropHint'),
        killfeed:   document.getElementById('killfeed'),
        banner:     document.getElementById('banner'),
        bannerTitle: document.getElementById('bannerTitle'),
        bannerSub:  document.getElementById('bannerSub'),
      };
      this.ammoWrap = this.el.ammoMag.parentElement;
  
      this.bannerTimer = 0;
      this.feedItems = [];
    }
  
    update() {
      const w = this.world;
      const p = w.player;
      const el = this.el;
  
      // HP
      const hpPct = (p.health / p.maxHealth) * 100;
      el.hp.style.width = hpPct + '%';
      el.hp.classList.toggle('low', hpPct < 30);
      el.hptext.textContent = Math.ceil(p.health) + ' / ' + p.maxHealth;
  
      // Wave
      el.wave.textContent = w.wave;
      el.wavesub.textContent =
        w.waveState === 'fighting' ? 'ENGAGED' :
        w.waveState === 'spawning' ? 'INCOMING' :
        w.waveState === 'break'    ? 'CLEAR' :
        'READY';
  
      // Score / kills
      el.score.textContent = w.score;
      el.kills.textContent = w.kills;
  
      // Name
      el.hudname.textContent = w.username;
  
      // Weapon + ammo
      const weapon = p.weapon;
      if (weapon) {
        el.weaponName.textContent = weapon.def.name;
        el.ammoMag.textContent = weapon.mag;
        el.ammoRes.textContent = weapon.reserve === Infinity ? '∞' : weapon.reserve;
  
        this.ammoWrap.classList.remove('empty', 'reloading');
        if (p.reloading > 0) {
          this.ammoWrap.classList.add('reloading');
          el.ammoHint.textContent = 'RELOADING';
        } else if (weapon.mag === 0) {
          this.ammoWrap.classList.add('empty');
          el.ammoHint.textContent = weapon.reserve > 0 || weapon.reserve === Infinity ? 'PRESS R' : 'NO AMMO';
        } else {
          el.ammoHint.textContent = 'R TO RELOAD · F SWAP';
        }
      }
  
      // Drop hint — show if any landed drop exists
      const landed = w.drops.filter(d => d.landed);
      if (landed.length > 0) {
        el.dropHint.textContent = `DROP DETECTED · ${landed.length}`;
        el.dropHint.classList.add('show');
      } else {
        el.dropHint.classList.remove('show');
      }
  
      // Banner
      if (this.bannerTimer > 0) {
        this.bannerTimer--;
        if (this.bannerTimer === 0) el.banner.classList.remove('show');
      }
  
      // Events
      for (const e of w.drainEvents()) {
        this._handleEvent(e);
      }
    }
  
    _handleEvent(e) {
      if (e.type === 'waveStart') {
        this.el.bannerTitle.textContent = 'WAVE ' + e.data.wave;
        this.el.bannerSub.textContent = e.data.wave % 5 === 0 ? 'BRUTE SQUAD' : 'INCOMING';
        this.el.banner.classList.remove('show');
        void this.el.banner.offsetWidth;
        this.el.banner.classList.add('show');
        this.bannerTimer = 110;
      } else if (e.type === 'kill') {
        this._addFeed(`+${e.data.score} · ${e.data.type.toUpperCase()}`);
      } else if (e.type === 'pickup') {
        this._addFeed(`PICKED · ${e.data.label}`);
      } else if (e.type === 'dropLand') {
        this._addFeed('SUPPLY DROP LANDED');
      }
    }
  
    _addFeed(text) {
      const div = document.createElement('div');
      div.className = 'feed-item';
      div.textContent = text;
      this.el.killfeed.appendChild(div);
      setTimeout(() => div.remove(), 3200);
      while (this.el.killfeed.children.length > 5) {
        this.el.killfeed.removeChild(this.el.killfeed.firstChild);
      }
    }
  }
