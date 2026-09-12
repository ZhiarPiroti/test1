// ============================================================
// World state + main game loop logic
// ============================================================

import { rand, randInt, clamp, dist, dist2, pick } from '../core/utils.js';
import {
  Player, Zombie, Bullet, Particle, Casing, Decal, Drop,
  Boss, ZOMBIE_TYPES, SKINS, BOSS_TYPES, bossForWave,
} from './entities.js';
import { WEAPONS, createWeaponInstance } from './weapons.js';

export const WORLD_W = 900;
export const WORLD_H = 700;

export class World {
  constructor() {
    this.reset({ username: 'ROOKIE', skin: 'rookie' });
  }

  reset(config) {
    this.username = config.username || 'ROOKIE';
    this.skinKey = config.skin || 'rookie';

    this.player = new Player(WORLD_W / 2, WORLD_H / 2, this.skinKey);
    this.player.addWeapon(createWeaponInstance('pistol'));

    this.players = [this.player];

    this.zombies = [];
    this.bullets = [];
    this.particles = [];
    this.casings = [];
    this.decals = [];
    this.drops = [];
    this.boss = null;
    this.bossActive = false;
    this.bossBar = { show: false, hp: 0, maxHp: 0, name: '' };

    this.cam = { x: 0, y: 0, shake: 0, shakeX: 0, shakeY: 0 };

    this.wave = 1;
    this.waveState = 'intro';
    this.waveTimer = 1.5;
    this.spawnsLeft = 0;
    this.spawnCd = 0;
    this.score = 0;
    this.kills = 0;
    this.gameTime = 0;
    this.damageFlash = 0;
    this.hitstop = 0;
    this.gameOver = false;

    this.dropTimer = rand(12, 18);
    this.zombieMoanTimer = 0;

    this.events = [];
    this.reloadSent = false;
  }

  // ============ EVENTS ============
  emit(type, data) { this.events.push({ type, data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ============ UPDATE ============
  update(dt, input, audio) {
    if (this.gameOver) {
      input.clearFrame();
      return;
    }
    if (this.hitstop > 0) { this.hitstop -= dt; input.clearFrame(); return; }

    this.gameTime += dt;

    // ============ TOUCH INPUT ============
    input.applyTouchInput();
    const isMobile = input.isMobile();

    this._updateCamera(dt);

    const p = this.player;
    const worldMouseX = input.mouse.x + this.cam.x;
    const worldMouseY = input.mouse.y + this.cam.y;

    // ---- Input movement ----
    let ix = 0, iy = 0;
    if (input.keys['a'] || input.keys['arrowleft'])  ix -= 1;
    if (input.keys['d'] || input.keys['arrowright']) ix += 1;
    if (input.keys['w'] || input.keys['arrowup'])    iy -= 1;
    if (input.keys['s'] || input.keys['arrowdown'])  iy += 1;
    const il = Math.hypot(ix, iy);
    if (il > 0) { ix /= il; iy /= il; }

    let speedMul = 1;
    const curWeapon = p.weapon;
    if (curWeapon && curWeapon.def.slowMove) speedMul *= curWeapon.def.slowMove;

    const maxSpeed = p.speed * speedMul;
    p.vx += ix * maxSpeed * 9 * dt;
    p.vy += iy * maxSpeed * 9 * dt;
    p.vx *= Math.pow(0.0008, dt);
    p.vy *= Math.pow(0.0008, dt);

    const ps = Math.hypot(p.vx, p.vy);
    if (ps > maxSpeed) {
      p.vx = p.vx / ps * maxSpeed;
      p.vy = p.vy / ps * maxSpeed;
    }
    p.x = clamp(p.x + p.vx * dt, 8, WORLD_W - 8);
    p.y = clamp(p.y + p.vy * dt, 8, WORLD_H - 8);
    p.walkPhase += Math.hypot(p.vx, p.vy) * dt * 0.15;

    // ★ زاویه: اول touch aim، بعد mouse
    const touchAngle = input.getTouchAimAngle();
    if (touchAngle !== null && touchAngle !== undefined) {
      p.angle = touchAngle;
    } else {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    }

    // ---- Weapon input ----
    if (curWeapon) {
      // ★ در موبایل، همه‌ی اسلحه‌ها auto هستن
      const auto = curWeapon.def.auto || isMobile;
      const wantsShoot = auto ? input.mouse.down : (input.mouse.down && !p._lastMouse);
      if (wantsShoot) this._tryShoot(audio);
      p._lastMouse = input.mouse.down;
    }

    // Reload
    if (input.wasPressed('r')) {
      p.startReload();
      if (p.reloading > 0) audio.reload();
    }

    // ★ ریلود اتوماتیک
    if (curWeapon && curWeapon.mag <= 0 && p.reloading <= 0 && !this.reloadSent) {
      p.startReload();
      if (p.reloading > 0) audio.reload();
      this.reloadSent = true;
    }
    if (p.reloading > 0 || (curWeapon && curWeapon.mag > 0)) {
      this.reloadSent = false;
    }

    // Swap weapon
    if (input.wasPressed('f')) {
      if (p.swapWeapon()) audio.swapWeapon();
    }

    // Pickup
    if (input.wasPressed('e')) this._tryPickupNearest(audio);

    // ---- Timers ----
    if (p.shootCd > 0) p.shootCd -= dt;
    if (p.muzzleFlash > 0) p.muzzleFlash -= dt;
    if (p.recoil > 0) p.recoil -= dt * 8;
    if (p.kick > 0) p.kick -= dt * 6;
    if (p.hitFlash > 0) p.hitFlash -= dt * 3;

    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) {
        const w = p.weapon;
        if (w && w.reserve > 0) {
          const need = w.def.magSize - w.mag;
          const take = w.reserve === Infinity ? need : Math.min(need, w.reserve);
          w.mag += take;
          if (w.reserve !== Infinity) w.reserve -= take;
        }
      }
    }

    // Medic regen
    if (p.skin.regen && !p.dead) {
      p.regenTimer += dt;
      if (p.regenTimer > 1) {
        p.regenTimer = 0;
        p.health = Math.min(p.maxHealth, p.health + p.skin.regen);
      }
    }

    // ---- Boss ----
    this._updateBoss(dt, audio);

    // ---- Zombies ----
    this._updateZombies(dt, audio);

    // ---- Bullets ----
    this._updateBullets(dt, audio);

    // ---- Particles / casings / decals ----
    this._updateParticles(dt);

    // ---- Drops ----
    this._updateDrops(dt, audio);

    // ---- Waves ----
    this._updateWaves(dt, audio);

    // ---- Shake decay ----
    this.cam.shake *= Math.pow(0.001, dt);
    if (this.cam.shake < 0.05) this.cam.shake = 0;
    this.cam.shakeX = rand(-this.cam.shake, this.cam.shake);
    this.cam.shakeY = rand(-this.cam.shake, this.cam.shake);

    if (this.damageFlash > 0) this.damageFlash -= dt * 2;

    input.clearFrame();
  }

  // ============ CAMERA ============
  _updateCamera(dt) {
    const cx = clamp(this.player.x - 480 / 2, 0, WORLD_W - 480);
    const cy = clamp(this.player.y - 270 / 2, 0, WORLD_H - 270);
    this.cam.x += (cx - this.cam.x) * Math.min(1, dt * 12);
    this.cam.y += (cy - this.cam.y) * Math.min(1, dt * 12);
  }

  // ============ SHOOTING ============
  _tryShoot(audio) {
    const p = this.player;
    const w = p.weapon;
    if (!w) return;

    if (p.reloading > 0) return;
    if (p.shootCd > 0) return;

    if (w.mag <= 0) {
      if (w.reserve > 0 || w.reserve === Infinity) {
        p.startReload();
        audio.reload();
      } else {
        audio.emptyClick();
        p.shootCd = 0.3;
      }
      return;
    }

    w.mag--;
    p.shootCd = w.def.fireRate;
    p.muzzleFlash = 0.06;
    p.recoil = 1.5;
    p.kick = 1;

    const dmgMult = p.skin.damageMult || 1;
    const gx = p.x + Math.cos(p.angle) * 8;
    const gy = p.y + Math.sin(p.angle) * 8;

    const numBullets = w.def.bullets || 1;
    for (let i = 0; i < numBullets; i++) {
      const spread = rand(-w.def.spread, w.def.spread);
      const a = p.angle + spread;
      const spd = w.def.bulletSpeed * rand(0.92, 1.08);
      this.bullets.push(new Bullet(
        gx, gy,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        w.def.damage * dmgMult,
        w.def.pierce || 0,
      ));
    }

    const back = p.angle + Math.PI + rand(-0.3, 0.3);
    this.casings.push(new Casing(gx, gy, Math.cos(back) * rand(60, 100), Math.sin(back) * rand(60, 100)));

    for (let i = 0; i < 4; i++) {
      const a = p.angle + rand(-0.4, 0.4);
      const s = rand(50, 110);
      this.particles.push(new Particle(gx, gy, Math.cos(a) * s, Math.sin(a) * s, '#ffd070', rand(0.5, 1.2), 0.15));
    }

    this._addShake(0.9 + (w.def.recoil || 0) * 0.01);

    p.vx -= Math.cos(p.angle) * (w.def.recoil || 10) * 0.7;
    p.vy -= Math.sin(p.angle) * (w.def.recoil || 10) * 0.7;

    audio.shoot(w.def.sound);
  }

  _addShake(amount) {
    this.cam.shake = Math.min(6, this.cam.shake + amount);
  }

  // ============ BOSS ============
  _spawnBoss(type) {
    const def = BOSS_TYPES[type];
    const angle = Math.random() * Math.PI * 2;
    const d = 260;
    let x = this.player.x + Math.cos(angle) * d;
    let y = this.player.y + Math.sin(angle) * d;
    x = clamp(x, 40, WORLD_W - 40);
    y = clamp(y, 40, WORLD_H - 40);

    this.boss = new Boss(x, y, type);
    this.bossActive = true;

    this.bossBar.show = true;
    this.bossBar.hp = def.hp;
    this.bossBar.maxHp = def.hp;
    this.bossBar.name = def.name;

    this.emit('bossSpawn', { type, name: def.name });
    this._addShake(8);

    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(60, 200);
      this.particles.push(new Particle(
        x, y,
        Math.cos(a) * s, Math.sin(a) * s,
        '#8a2010', rand(1.5, 3.5), rand(0.6, 1.4),
      ));
    }
  }

  _updateBoss(dt, audio) {
    const b = this.boss;
    if (!b) return;

    if (b.dead) {
      b.deadTime -= dt;
      if (b.deadTime <= 0) {
        this.boss = null;
        this.bossActive = false;
        this.bossBar.show = false;
      }
      return;
    }

    const p = this.player;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    b.angle = Math.atan2(dy, dx);

    if (b.type === 'butcher') {
      this._updateButcher(b, d, dt, audio);
    } else if (b.type === 'mother') {
      this._updateMother(b, d, dt, audio);
    } else if (b.type === 'stalker') {
      this._updateStalker(b, d, dt, audio);
    } else if (b.type === 'colossus') {
      this._updateColossus(b, d, dt, audio);
    }

    b.vx += dx / d * b.def.accel * dt;
    b.vy += dy / d * b.def.accel * dt;

    const maxSpeed = (b.enraged && b.def.enragedSpeed) ? b.def.enragedSpeed : b.def.speed;
    b.vx *= Math.pow(0.15, dt);
    b.vy *= Math.pow(0.15, dt);

    const bs = Math.hypot(b.vx, b.vy);
    if (bs > maxSpeed) {
      b.vx = b.vx / bs * maxSpeed;
      b.vy = b.vy / bs * maxSpeed;
    }

    b.x = clamp(b.x + b.vx * dt, 20, WORLD_W - 20);
    b.y = clamp(b.y + b.vy * dt, 20, WORLD_H - 20);
    b.walkPhase += bs * dt * 0.15;
    b.wobble += dt * 3;

    if (b.hitFlash > 0) b.hitFlash -= dt * 4;
    if (b.slamAnim > 0) b.slamAnim -= dt * 2;

    if (b.attackCd > 0) b.attackCd -= dt;
    const hitDist = b.radius + 10;
    if (d < hitDist && b.attackCd <= 0 && !p.dead) {
      this._damagePlayer(b.def.damage, audio);
      b.attackCd = b.def.attackRate;
      p.vx += dx / d * 200;
      p.vy += dy / d * 200;
      b.vx -= dx / d * 60;
      b.vy -= dy / d * 60;
    }

    this.bossBar.hp = Math.max(0, b.hp);
  }

  _updateButcher(b, d, dt, audio) {
    if (!b.enraged && b.hp <= b.maxHp * b.def.enrageAt) {
      b.enraged = true;
      this._addShake(6);
      audio.bossRoar('butcher');
      this.emit('bossEnrage', { name: b.def.name });
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(80, 160);
        this.particles.push(new Particle(
          b.x, b.y, Math.cos(a) * s, Math.sin(a) * s,
          '#ff3010', rand(1.5, 3), rand(0.6, 1.2),
        ));
      }
    }
  }

  _updateMother(b, d, dt, audio) {
    b.spawnCd -= dt;
    if (b.spawnCd <= 0) {
      b.spawnCd = b.def.spawnInterval;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const sx = b.x + Math.cos(a) * (b.radius + 6);
        const sy = b.y + Math.sin(a) * (b.radius + 6);
        const z = new Zombie(sx, sy, 'runner');
        this.zombies.push(z);
        for (let j = 0; j < 8; j++) {
          const pa = Math.random() * Math.PI * 2;
          const ps = rand(40, 100);
          this.particles.push(new Particle(
            sx, sy, Math.cos(pa) * ps, Math.sin(pa) * ps,
            '#a060c0', rand(1, 2.5), rand(0.4, 0.8),
          ));
        }
      }
      audio.zombieMoan('runner');
    }
  }

  _updateStalker(b, d, dt, audio) {
    b.teleportCd -= dt;
    if (b.teleportCd <= 0) {
      b.teleportCd = b.def.teleportInterval;
      const a = Math.random() * Math.PI * 2;
      const dd = 140 + Math.random() * 100;
      let nx = this.player.x + Math.cos(a) * dd;
      let ny = this.player.y + Math.sin(a) * dd;
      nx = clamp(nx, 30, WORLD_W - 30);
      ny = clamp(ny, 30, WORLD_H - 30);

      for (let i = 0; i < 16; i++) {
        const pa = Math.random() * Math.PI * 2;
        const ps = rand(50, 120);
        this.particles.push(new Particle(
          b.x, b.y, Math.cos(pa) * ps, Math.sin(pa) * ps,
          '#ffdd00', rand(1.5, 3), rand(0.3, 0.7),
        ));
      }

      b.x = nx;
      b.y = ny;
      b.vx = 0;
      b.vy = 0;

      for (let i = 0; i < 16; i++) {
        const pa = Math.random() * Math.PI * 2;
        const ps = rand(50, 120);
        this.particles.push(new Particle(
          b.x, b.y, Math.cos(pa) * ps, Math.sin(pa) * ps,
          '#ffdd00', rand(1.5, 3), rand(0.3, 0.7),
        ));
      }
      audio.bossTeleport();
    }

    if (!b.spawnedClones && b.hp <= b.maxHp * b.def.cloneAt) {
      b.spawnedClones = true;
      audio.bossRoar('stalker');
      this.emit('bossEnrage', { name: b.def.name });
      for (let i = 0; i < 2; i++) {
        const a = (i / 2) * Math.PI * 2 + Math.random();
        const sx = b.x + Math.cos(a) * 60;
        const sy = b.y + Math.sin(a) * 60;
        const clone = new Zombie(sx, sy, 'runner');
        clone.hp = 30;
        clone.maxHp = 30;
        clone.radius = 10;
        clone.def = { ...clone.def, speed: 130, body: '#3a3a3a', dark: '#1a1a1a', eye: '#ffdd00' };
        this.zombies.push(clone);
      }
    }
  }

  _updateColossus(b, d, dt, audio) {
    const hpPct = b.hp / b.maxHp;
    if (b.phase === 1 && hpPct <= 0.5) {
      b.phase = 2;
      b.def = { ...b.def, speed: 60, attackRate: 1.4 };
      this._addShake(8);
      audio.bossRoar('colossus');
      this.emit('bossEnrage', { name: b.def.name + ' · PHASE 2' });
    }
    if (b.phase === 2 && hpPct <= 0.2) {
      b.phase = 3;
      b.def = { ...b.def, speed: 90, attackRate: 0.9 };
      this._addShake(10);
      audio.bossRoar('colossus');
      this.emit('bossEnrage', { name: b.def.name + ' · PHASE 3' });
    }

    b.slamCd -= dt;
    if (b.slamCd <= 0 && d < b.def.slamRange) {
      b.slamCd = 5.0 / b.phase;
      b.slamAnim = 1;
      this._addShake(10);
      audio.bossSlam();
      const slamR = 130;
      if (d < slamR && !this.player.dead) {
        this._damagePlayer(b.def.damage * 0.5, audio);
      }
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const s = rand(180, 320);
        this.particles.push(new Particle(
          b.x, b.y, Math.cos(a) * s, Math.sin(a) * s,
          '#ffaa40', rand(2, 4), rand(0.5, 1.0),
        ));
      }
    }
  }

  _killBoss(b, audio) {
    b.dead = true;
    b.deadTime = 1.2;
    this.kills++;
    this.score += b.def.score;
    this.emit('bossKilled', { name: b.def.name, score: b.def.score });

    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(100, 400);
      this.particles.push(new Particle(
        b.x, b.y, Math.cos(a) * s, Math.sin(a) * s,
        i % 3 === 0 ? '#ffffff' : (i % 3 === 1 ? '#ff5040' : '#8a2010'),
        rand(2, 5), rand(0.8, 1.8), i % 4 === 0,
      ));
    }
    for (let i = 0; i < 12; i++) {
      this.decals.push(new Decal(
        b.x + rand(-30, 30),
        b.y + rand(-30, 30),
        rand(3, 8),
        '#3a0808',
      ));
    }

    this._addShake(15);
    this.hitstop = 0.15;
    audio.bossDeath();

    this.drops.push(new Drop(b.x, b.y, 'shotgun', 'weapon'));
    this.drops.push(new Drop(b.x + 30, b.y, 'health', 'health'));
    this.drops.push(new Drop(b.x - 30, b.y, 'ammo', 'ammo'));

    if (b.type === 'mother') {
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2;
        const dd = 30 + Math.random() * 60;
        const zx = b.x + Math.cos(a) * dd;
        const zy = b.y + Math.sin(a) * dd;
        const z = new Zombie(zx, zy, 'walker');
        this.zombies.push(z);
      }
    }
  }

  // ============ ZOMBIES ============
  _updateZombies(dt, audio) {
    const p = this.player;
    const zs = this.zombies;

    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];

      if (z.dead) {
        z.deadTime -= dt;
        if (z.deadTime <= 0) zs.splice(i, 1);
        continue;
      }

      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.hypot(dx, dy) || 1;

      z.vx += dx / d * z.def.accel * dt;
      z.vy += dy / d * z.def.accel * dt;

      for (let j = 0; j < zs.length; j++) {
        if (i === j) continue;
        const o = zs[j];
        if (o.dead) continue;
        const ox = z.x - o.x;
        const oy = z.y - o.y;
        const od2 = ox * ox + oy * oy;
        const minD = z.radius + o.radius;
        if (od2 < minD * minD && od2 > 0.01) {
          const od = Math.sqrt(od2);
          const f = (minD - od) / minD * 80;
          z.vx += ox / od * f * dt;
          z.vy += oy / od * f * dt;
        }
      }

      z.vx *= Math.pow(0.15, dt);
      z.vy *= Math.pow(0.15, dt);
      const zs2 = Math.hypot(z.vx, z.vy);
      if (zs2 > z.def.speed) {
        z.vx = z.vx / zs2 * z.def.speed;
        z.vy = z.vy / zs2 * z.def.speed;
      }

      z.x += z.vx * dt;
      z.y += z.vy * dt;
      z.angle = Math.atan2(dy, dx);
      z.walkPhase += zs2 * dt * 0.2;
      z.wobble += dt * 4;

      if (z.hitFlash > 0) z.hitFlash -= dt * 5;

      if (Math.random() < z.def.moanChance * dt * 60) {
        audio.zombieMoan(z.def.moanType);
      }

      if (z.attackCd > 0) z.attackCd -= dt;
      const hitDist = z.radius + 7;
      if (d < hitDist && z.attackCd <= 0 && !p.dead) {
        this._damagePlayer(z.def.damage, audio);
        z.attackCd = z.def.attackRate;
        z.vx -= dx / d * 40;
        z.vy -= dy / d * 40;
        this._spawnBlood(p.x, p.y, 5);
      }
    }
  }

  _damagePlayer(amount, audio) {
    const p = this.player;
    p.health -= amount;
    p.hitFlash = 0.3;
    this.damageFlash = 0.5;
    this._addShake(3.5);
    audio.playerHurt();
    if (p.health <= 0) {
      p.health = 0;
      this._die();
    }
  }

  _die() {
    this.player.dead = true;
    this.gameOver = true;
    this._addShake(8);
  }

  // ============ BULLETS ============
  _updateBullets(dt, audio) {
    const bullets = this.bullets;
    const zs = this.zombies;
    const boss = this.boss;

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let hit = false;

      if (boss && !boss.dead) {
        const rr = boss.radius + 3;
        if (dist2(b.x, b.y, boss.x, boss.y) < rr * rr) {
          boss.hp -= b.damage;
          boss.hitFlash = 1;
          this._spawnBlood(b.x, b.y, 4);
          this._addShake(0.8);
          audio.zombieHit();
          if (boss.hp <= 0) this._killBoss(boss, audio);
          hit = true;
        }
      }

      if (!hit) {
        for (let j = 0; j < zs.length; j++) {
          const z = zs[j];
          if (z.dead) continue;
          if (b.hitList.has(z)) continue;

          const rr = z.radius + 2;
          if (dist2(b.x, b.y, z.x, z.y) < rr * rr) {
            z.hp -= b.damage;
            z.hitFlash = 1;
            this._spawnBlood(b.x, b.y, 3);
            this._addShake(0.5);
            audio.zombieHit();

            if (z.hp <= 0) this._killZombie(z, audio);

            b.hitList.add(z);
            if (b.pierce <= 0) { hit = true; break; }
            b.pierce--;
          }
        }
      }

      if (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) hit = true;
      if (b.life <= 0) hit = true;

      if (hit) bullets.splice(i, 1);
    }
  }

  _killZombie(z, audio) {
    z.dead = true;
    z.deadTime = 0.35;
    this.kills++;
    this.score += z.def.score;
    this.emit('kill', { type: z.type, score: z.def.score });

    this._spawnBlood(z.x, z.y, z.type === 'brute' ? 24 : 12);
    this.decals.push(new Decal(z.x + rand(-4, 4), z.y + rand(-4, 4), z.radius * 1.4, '#3a0808'));
    this.decals.push(new Decal(z.x + rand(-8, 8), z.y + rand(-8, 8), z.radius * 0.9, '#5a0a0a'));

    if (z.type === 'brute') {
      this._addShake(4);
      this.hitstop = 0.05;
    } else {
      this._addShake(1.4);
      this.hitstop = 0.015;
    }
    audio.zombieDeath();
  }

  _spawnBlood(x, y, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(20, 80);
      const col = ['#8a1010', '#c02020', '#5a0808'][randInt(0, 2)];
      this.particles.push(new Particle(
        x, y, Math.cos(a) * s, Math.sin(a) * s,
        col, rand(1, 2.2), rand(0.4, 1.0), true,
      ));
    }
  }

  // ============ PARTICLES ============
  _updateParticles(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.life -= dt;
      if (p.life <= 0) {
        if (p.blood && Math.random() < 0.25) {
          this.decals.push(new Decal(p.x, p.y, rand(0.8, 1.8), '#4a0808'));
          if (this.decals.length > 260) this.decals.shift();
        }
        ps.splice(i, 1);
      }
    }

    const cs = this.casings;
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx *= Math.pow(0.01, dt);
      c.vy *= Math.pow(0.01, dt);
      c.rot += c.rotSpd * dt;
      c.rotSpd *= Math.pow(0.1, dt);
      c.life -= dt;
      if (c.life <= 0) cs.splice(i, 1);
    }
  }

  // ============ DROPS ============
  _updateDrops(dt, audio) {
    const p = this.player;
    const ds = this.drops;

    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = rand(18, 26);
      this._spawnDrop();
    }

    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i];

      if (!d.landed) {
        d.t += dt;
        const t = Math.min(1, d.t / d.fallDuration);
        const e = 1 - Math.pow(1 - t, 3);
        d.y = d.startY + (d.targetY - d.startY) * e;
        if (t >= 1) {
          d.landed = true;
          d.y = d.targetY;
          audio.dropLand();
          this._addShake(2);
          this.emit('dropLand', { x: d.x, y: d.y });
        }
      } else {
        d.beacon += dt;
        d.life -= dt;

        const dd = dist(p.x, p.y, d.x, d.y);
        if (dd < 14) this._pickupDrop(d, audio, i);
        else if (d.life <= 0) ds.splice(i, 1);
      }
    }
  }

  _spawnDrop() {
    let x, y;
    for (let tries = 0; tries < 20; tries++) {
      x = rand(80, WORLD_W - 80);
      y = rand(80, WORLD_H - 80);
      if (dist(x, y, this.player.x, this.player.y) > 180) break;
    }

    const r = Math.random();
    let kind, payload;
    if (r < 0.6) {
      kind = 'weapon';
      const choices = ['shotgun', 'smg', 'rifle', 'lmg'];
      const held = this.player.weapons.map(w => w.type);
      const fresh = choices.filter(c => !held.includes(c));
      const type = fresh.length && Math.random() < 0.7 ? pick(fresh) : pick(choices);
      payload = type;
    } else if (r < 0.85) {
      kind = 'ammo';
      payload = { amount: 30 };
    } else {
      kind = 'health';
      payload = { amount: 40 };
    }

    this.drops.push(new Drop(x, y, payload, kind));
  }

  _pickupDrop(d, audio, index) {
    const p = this.player;
    if (d.kind === 'weapon') {
      p.addWeapon(createWeaponInstance(d.payload));
      this.emit('pickup', { label: WEAPONS[d.payload].name });
    } else if (d.kind === 'ammo') {
      for (const w of p.weapons) {
        w.mag = w.def.magSize;
      }
      this.emit('pickup', { label: '+AMMO' });
    } else if (d.kind === 'health') {
      p.health = Math.min(p.maxHealth, p.health + d.payload.amount);
      this.emit('pickup', { label: '+HEALTH' });
    }
    audio.pickup();
    this._addShake(1);
    this.drops.splice(index, 1);
  }

  _tryPickupNearest(audio) {
    const p = this.player;
    let best = -1, bestD = 40 * 40;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (!d.landed) continue;
      const dd = dist2(p.x, p.y, d.x, d.y);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (best >= 0) this._pickupDrop(this.drops[best], audio, best);
  }

  // ============ WAVES ============
  _updateWaves(dt, audio) {
    if (this.waveState === 'intro') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this._startWave(this.wave);
    } else if (this.waveState === 'spawning') {
      this.spawnCd -= dt;
      if (this.spawnCd <= 0 && this.spawnsLeft > 0) {
        this._spawnZombie();
        this.spawnsLeft--;
        this.spawnCd = Math.max(0.10, 0.5 - this.wave * 0.04);
      }
      if (this.spawnsLeft <= 0) this.waveState = 'fighting';
    } else if (this.waveState === 'fighting') {
      let alive = 0;
      for (const z of this.zombies) if (!z.dead) alive++;
      if (alive === 0 && !this.bossActive) {
        this.waveState = 'break';
        this.waveTimer = 2.0;
        const healAmount = this.wave >= 5 ? 10 : 20;
        this.player.health = Math.min(this.player.maxHealth, this.player.health + healAmount);
      }
    } else if (this.waveState === 'break') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this._startWave(this.wave + 1);
    }
  }

  _startWave(n) {
    this.wave = n;
    this.waveState = 'spawning';
    const count = Math.floor(6 + n * 2.8 + Math.pow(n, 1.4));
    this.spawnsLeft = count;
    this.spawnCd = 0;
    this.emit('waveStart', { wave: n });

    const bossType = bossForWave(n);
    if (bossType) {
      this._spawnBoss(bossType);
    }
  }

  _pickZombieType() {
    const r = Math.random();
    const w = this.wave;

    if (w >= 5) {
      if (r < 0.15) return 'brute';
      if (r < 0.45) return 'runner';
      return 'walker';
    }
    if (w >= 3) {
      if (r < 0.10) return 'brute';
      if (r < 0.40) return 'runner';
      return 'walker';
    }
    if (w >= 2) {
      if (r < 0.35) return 'runner';
      return 'walker';
    }
    return 'walker';
  }

  _spawnZombie() {
    const type = this._pickZombieType();
    const angle = Math.random() * Math.PI * 2;
    const d = 200 + Math.random() * 150;
    let x = this.player.x + Math.cos(angle) * d;
    let y = this.player.y + Math.sin(angle) * d;
    x = clamp(x, 20, WORLD_W - 20);
    y = clamp(y, 20, WORLD_H - 20);

    const z = new Zombie(x, y, type);
    this.zombies.push(z);
  }
}
