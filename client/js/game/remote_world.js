// ============================================================
// Remote world — receives state from server, interpolates for render
// ============================================================

import { SKINS, ZOMBIE_TYPES } from './entities.js';
import { WEAPONS } from './weapons.js';
import { rand, clamp } from '../core/utils.js';

const INTERP_DELAY = 0.1;
const RESPAWN_TIME = 4.0;

export class RemoteWorld {
  constructor(net, mySid) {
    this.net = net;
    this.mySid = mySid;

    this.snapshots = [];
    this.audio = null;

    this.player = null;
    this.players = [];

    this.zombies = [];
    this.bullets = [];
    this.drops = [];
    this.boss = null;
    this.wave = 1;
    this.waveState = 'intro';
    this.score = 0;
    this.kills = 0;
    this.username = 'YOU';
    this.skinKey = 'rookie';

    this.particles = [];
    this.casings = [];
    this.decals = [];
    this.cam = { x: 0, y: 0, shake: 0, shakeX: 0, shakeY: 0 };
    this.damageFlash = 0;
    this.gameOver = false;
    this.events = [];

    this._lastMouseDown = false;
    this._lastMoanTime = 0;

    // مرگ و ریسپاون
    this.deathAnim = 0;
    this.respawnTimer = 0;
    this.wasDead = false;
    this.reloadSent = false;

    this._initPlayerStub();
  }

  _initPlayerStub() {
    this.player = {
      sid: this.mySid,
      name: 'YOU',
      x: 450, y: 350, vx: 0, vy: 0,
      angle: 0, health: 100, maxHealth: 100,
      skin: SKINS.rookie, skinKey: 'rookie',
      weapon: { type: 'pistol', def: WEAPONS.pistol, mag: 12, reserve: Infinity },
      reloading: 0, walkPhase: 0,
      muzzleFlash: 0, hitFlash: 0, kick: 0,
      dead: false, weapons: [], isSelf: true,
    };
    this.players = [this.player];
  }

  onSnapshot(data) {
    this.snapshots.push({ time: performance.now() / 1000, data });
    if (this.snapshots.length > 15) this.snapshots.shift();
    for (const e of (data.events || [])) {
      this.events.push(e);
      this._handleEvent(e);
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  _handleEvent(e) {
    if (e.type === 'kill') {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(20, 80);
        this.particles.push({
          x: e.x, y: e.y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          color: ['#8a1010', '#c02020', '#5a0808'][(Math.random() * 3) | 0],
          size: rand(1, 2.2), life: rand(0.4, 1.0), maxLife: 1.0,
          blood: true, drag: 0.88,
        });
      }
    } else if (e.type === 'drop_land') {
      this.cam.shake = Math.min(6, this.cam.shake + 2);
      if (this.audio) this.audio.dropLand();
    } else if (e.type === 'wave_start') {
      this.cam.shake = Math.min(6, this.cam.shake + 1);
    } else if (e.type === 'pickup') {
      if (this.audio) this.audio.pickup();
    } else if (e.type === 'player_died') {
      if (e.name === this.username) {
        this.deathAnim = 1.0;
        this.respawnTimer = RESPAWN_TIME;
        this.cam.shake = 8;
        if (this.audio) {
          try { this.audio.playerHurt(); } catch (ex) {}
        }
      }
    }
  }

  update(dt, input, audio) {
    this.audio = audio;

    // ============ TOUCH INPUT ============
    input.applyTouchInput();
    const isMobile = input.isMobile();

    const isDead = this.player && this.player.dead;
    const now = performance.now() / 1000;
    const renderTime = now - INTERP_DELAY;

    // ---- تشخیص تغییر وضعیت مرگ ----
    if (isDead && !this.wasDead) {
      this.deathAnim = 1.0;
      if (this.respawnTimer <= 0) this.respawnTimer = RESPAWN_TIME;
      this.cam.shake = 8;
    }
    if (!isDead && this.wasDead) {
      this.deathAnim = 0;
      this.respawnTimer = 0;
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(40, 120);
        this.particles.push({
          x: this.player.x, y: this.player.y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          color: ['#4ade80', '#86efac', '#ffffff'][(Math.random() * 3) | 0],
          size: rand(1, 3), life: rand(0.4, 0.9), maxLife: 0.9,
          blood: false, drag: 0.85,
        });
      }
    }
    this.wasDead = isDead;

    if (isDead && this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer < 0) this.respawnTimer = 0;
    }

    if (this.deathAnim > 0 && !isDead) {
      this.deathAnim -= dt * 2;
      if (this.deathAnim < 0) this.deathAnim = 0;
    }

    // پاک کردن snapshot های قدیمی
    while (this.snapshots.length > 2 && this.snapshots[1].time < renderTime) {
      this.snapshots.shift();
    }

    if (this.snapshots.length >= 2) {
      let s0 = this.snapshots[0];
      let s1 = this.snapshots[1];
      for (let i = 0; i < this.snapshots.length - 1; i++) {
        if (this.snapshots[i].time <= renderTime && this.snapshots[i + 1].time >= renderTime) {
          s0 = this.snapshots[i];
          s1 = this.snapshots[i + 1];
          break;
        }
      }
      const span = s1.time - s0.time || 0.001;
      const t = clamp((renderTime - s0.time) / span, 0, 1);
      this._reconstruct(s0.data, s1.data, t, now);
    }

    // ============ INPUT ============
    const p = this.player;
    let ix = 0, iy = 0;
    let shooting = false;
    let reload = false, swap = false;

    if (!isDead) {
      if (input.keys['a'] || input.keys['arrowleft'])  ix -= 1;
      if (input.keys['d'] || input.keys['arrowright']) ix += 1;
      if (input.keys['w'] || input.keys['arrowup'])    iy -= 1;
      if (input.keys['s'] || input.keys['arrowdown'])  iy += 1;

      // ★ زاویه: اول touch aim، بعد mouse
      const touchAngle = input.getTouchAimAngle();
      let angle;
      if (touchAngle !== null && touchAngle !== undefined) {
        angle = touchAngle;
      } else {
        const worldMouseX = input.mouse.x + this.cam.x;
        const worldMouseY = input.mouse.y + this.cam.y;
        angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
      }

      shooting = input.mouse.down;
      if (input.wasPressed('r')) reload = true;
      if (input.wasPressed('f')) swap = true;

      p.angle = angle;

      // ---- ریلود اتوماتیک ----
      const curWeapon = p.weapon;
      if (curWeapon && curWeapon.mag <= 0 && p.reloading <= 0 && !reload && !this.reloadSent) {
        reload = true;
        this.reloadSent = true;
      }
      if (p.reloading > 0 || (curWeapon && curWeapon.mag > 0)) {
        this.reloadSent = false;
      }

      // ---- local visual feedback ----
      if (curWeapon) {
        // ★ در موبایل، همه‌ی اسلحه‌ها auto هستن
        const auto = curWeapon.def.auto || isMobile;
        const wantsShoot = auto ? shooting : (shooting && !this._lastMouseDown);
        if (wantsShoot && p.reloading <= 0 && curWeapon.mag > 0) {
          p.muzzleFlash = 0.06;
          p.kick = 1;
          if (audio) audio.shoot(curWeapon.type);

          const gx = p.x + Math.cos(angle) * 8;
          const gy = p.y + Math.sin(angle) * 8;
          const back = angle + Math.PI + rand(-0.3, 0.3);
          this.casings.push({
            x: gx, y: gy,
            vx: Math.cos(back) * rand(60, 100),
            vy: Math.sin(back) * rand(60, 100),
            rot: Math.random() * 6.28,
            rotSpd: rand(-15, 15),
            life: 2.2,
          });
          for (let i = 0; i < 4; i++) {
            const a = angle + rand(-0.4, 0.4);
            const s = rand(50, 110);
            this.particles.push({
              x: gx, y: gy,
              vx: Math.cos(a) * s, vy: Math.sin(a) * s,
              color: '#ffd070', size: rand(0.5, 1.2),
              life: 0.15, maxLife: 0.15, drag: 0.9,
            });
          }
        }
        this._lastMouseDown = shooting;
      }
    } else {
      this._lastMouseDown = false;
      this.reloadSent = false;
    }

    this.net.sendInput(ix, iy, p.angle || 0, shooting, reload, swap);

    // ---- Camera ----
    if (this.player) {
      const camTargetX = clamp(this.player.x - 480 / 2, 0, 900 - 480);
      const camTargetY = clamp(this.player.y - 270 / 2, 0, 700 - 270);
      this.cam.x += (camTargetX - this.cam.x) * Math.min(1, dt * 12);
      this.cam.y += (camTargetY - this.cam.y) * Math.min(1, dt * 12);
    }

    this.cam.shake *= Math.pow(0.001, dt);
    if (this.cam.shake < 0.05) this.cam.shake = 0;
    this.cam.shakeX = rand(-this.cam.shake, this.cam.shake);
    this.cam.shakeY = rand(-this.cam.shake, this.cam.shake);

    if (this.damageFlash > 0) this.damageFlash -= dt * 2;

    this._updateZombieSounds(now);

    // ---- Particles ----
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.pow(pt.drag, dt * 60);
      pt.vy *= Math.pow(pt.drag, dt * 60);
      pt.life -= dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }

    // ---- Casings ----
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx *= Math.pow(0.01, dt);
      c.vy *= Math.pow(0.01, dt);
      c.rot += c.rotSpd * dt;
      c.rotSpd *= Math.pow(0.1, dt);
      c.life -= dt;
      if (c.life <= 0) this.casings.splice(i, 1);
    }

    input.clearFrame();
  }

  _updateZombieSounds(now) {
    if (!this.audio) return;
    if (now - this._lastMoanTime < 0.5) return;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const dx = z.x - this.player.x;
      const dy = z.y - this.player.y;
      if (dx * dx + dy * dy < 280 * 280 && Math.random() < 0.08) {
        this._lastMoanTime = now;
        this.audio.zombieMoan(z.type);
        break;
      }
    }
  }

  _reconstruct(prev, next, t, now) {
    const myId = (this.net.socket && this.net.socket.id) || this.mySid;
    this.mySid = myId;

    // ---- PLAYERS ----
    const prevPlayersMap = new Map(prev.players.map(p => [p.sid, p]));
    this.players = next.players.map(pNext => {
      const pPrev = prevPlayersMap.get(pNext.sid) || pNext;
      const x = pPrev.x + (pNext.x - pPrev.x) * t;
      const y = pPrev.y + (pNext.y - pPrev.y) * t;
      const isSelf = pNext.sid === myId;
      return {
        sid: pNext.sid,
        name: pNext.n,
        x, y,
        angle: pNext.a,
        health: pNext.hp,
        maxHealth: pNext.mhp,
        alive: pNext.alive,
        dead: !pNext.alive,
        skinKey: pNext.sk,
        skin: SKINS[pNext.sk] || SKINS.rookie,
        walkPhase: pNext.wp,
        muzzleFlash: pNext.mf,
        hitFlash: pNext.hf,
        kick: 0,
        isSelf,
      };
    });

    // پیدا کردن self
    let selfEntry = this.players.find(p => p.sid === myId);
    if (!selfEntry && this.username) {
      selfEntry = this.players.find(p => p.name === this.username);
    }
    if (!selfEntry && this.players.length > 0) {
      selfEntry = this.players[0];
    }

    if (selfEntry) {
      selfEntry.isSelf = true;
      const p = this.player;
      p.sid = selfEntry.sid;
      p.name = selfEntry.name;
      p.x = selfEntry.x;
      p.y = selfEntry.y;
      p.health = selfEntry.health;
      p.maxHealth = selfEntry.maxHealth;
      p.dead = selfEntry.dead;
      p.alive = selfEntry.alive;
      p.skinKey = selfEntry.skinKey;
      p.skin = selfEntry.skin;
      p.walkPhase = selfEntry.walkPhase;
      p.angle = selfEntry.angle;
      p.isSelf = true;

      if (!p.dead) {
        const serverP = next.players.find(pp => pp.sid === selfEntry.sid);
        if (serverP) {
          p.reloading = serverP.rl;
          const wdef = WEAPONS[serverP.wp] || WEAPONS.pistol;
          p.weapon = { type: serverP.wp, def: wdef, mag: serverP.mag, reserve: Infinity };
          if (serverP.mf > 0) p.muzzleFlash = serverP.mf;
          if (serverP.hf > 0) p.hitFlash = serverP.hf;
        }
      }
    }

    // ---- ZOMBIES ----
    const prevZ = new Map(prev.zombies.map(z => [z.id, z]));
    this.zombies = next.zombies.map(zNext => {
      const zPrev = prevZ.get(zNext.id) || zNext;
      const x = zPrev.x + (zNext.x - zPrev.x) * t;
      const y = zPrev.y + (zNext.y - zPrev.y) * t;
      const def = ZOMBIE_TYPES[zNext.t] || ZOMBIE_TYPES.walker;
      return {
        id: zNext.id, x, y,
        type: zNext.t, def,
        radius: def.radius,
        angle: zNext.a,
        hp: zNext.hp, maxHp: zNext.mhp,
        hitFlash: zNext.hf,
        dead: zNext.dead, deadTime: zNext.dt,
        walkPhase: zNext.wp, wobble: 0,
      };
    });

    // ---- BULLETS ----
    const latestSnap = this.snapshots[this.snapshots.length - 1];
    const latestTime = latestSnap.time;
    const extrapolateTime = Math.max(0, Math.min(0.2, now - latestTime));

    this.bullets = latestSnap.data.bullets.map(b => ({
      x: b.x, y: b.y,
      vx: b.vx, vy: b.vy,
      renderX: b.x + b.vx * extrapolateTime,
      renderY: b.y + b.vy * extrapolateTime,
    }));

    // ---- DROPS ----
    const prevDrops = prev.drops || [];
    this.drops = (next.drops || []).map(dNext => {
      const dPrev = prevDrops.find(dp => Math.abs(dp.x - dNext.x) < 3);
      let y = dNext.y;
      if (dPrev && !dNext.l) y = dPrev.y + (dNext.y - dPrev.y) * t;
      return {
        x: dNext.x, y,
        kind: dNext.k, payload: dNext.p,
        landed: dNext.l, t: dNext.t,
        startY: y - 400, targetY: y,
        beacon: dNext.t * 3, life: 30,
      };
    });

    this.wave = next.wave;
    this.waveState = next.ws;
    this.score = next.score;
    this.kills = next.kills;
  }
}