// ============================================================
// Entity classes — Player, Zombie, Bullet, Particle, Drop, Boss, ...
// ============================================================

import { rand, randInt, clamp, dist } from '../core/utils.js';

// ============ SKINS ============
export const SKINS = {
  rookie: {
    name: 'ROOKIE',
    body: '#2a3a2a', bodyLight: '#3a4a3a', skin: '#e0b080', hair: '#3a2010',
    hp: 100, speed: 95, damageMult: 1.0,
  },
  medic: {
    name: 'MEDIC',
    body: '#e8e8e8', bodyLight: '#ffffff', skin: '#e0b080', hair: '#8a2010',
    hp: 90, speed: 100, damageMult: 0.9, regen: 1.2,
  },
  heavy: {
    name: 'HEAVY',
    body: '#2a2a3a', bodyLight: '#3a3a4a', skin: '#d0a070', hair: '#1a1008',
    hp: 150, speed: 78, damageMult: 1.15,
  },
  scout: {
    name: 'SCOUT',
    body: '#3a2a1a', bodyLight: '#5a3a2a', skin: '#e8b888', hair: '#c0a040',
    hp: 75, speed: 120, damageMult: 0.95,
  },
};

// ============ PLAYER ============
export class Player {
  constructor(x, y, skinKey) {
    const skin = SKINS[skinKey] || SKINS.rookie;
    this.skinKey = skinKey;
    this.skin = skin;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.speed = skin.speed;
    this.health = skin.hp;
    this.maxHealth = skin.hp;
    this.angle = 0;
    this.walkPhase = 0;
    this.hitFlash = 0;
    this.muzzleFlash = 0;
    this.recoil = 0;
    this.kick = 0;
    this.dead = false;

    this.weapons = [];
    this.currentSlot = 0;
    this.reloading = 0;
    this.shootCd = 0;
    this.regenTimer = 0;
    this._lastMouse = false;
  }

  get weapon() { return this.weapons[this.currentSlot]; }

  addWeapon(weaponInst) {
    if (this.weapons.length < 2) {
      this.weapons.push(weaponInst);
      this.currentSlot = this.weapons.length - 1;
    } else {
      this.weapons[this.currentSlot] = weaponInst;
    }
  }

  swapWeapon() {
    if (this.weapons.length < 2) return false;
    this.currentSlot = (this.currentSlot + 1) % this.weapons.length;
    this.reloading = 0;
    return true;
  }

  startReload() {
    const w = this.weapon;
    if (!w) return;
    if (this.reloading > 0) return;
    if (w.mag >= w.def.magSize) return;
    this.reloading = w.def.reloadTime;
  }

  canShoot() {
    if (this.reloading > 0) return false;
    if (this.shootCd > 0) return false;
    const w = this.weapon;
    return w && w.mag > 0;
  }
}

// ============ ZOMBIES ============
export const ZOMBIE_TYPES = {
  walker: {
    hp: 3, speed: 62, radius: 6, damage: 8, accel: 400,
    score: 100, attackRate: 0.85,
    body: '#5a8a4a', dark: '#2a4a1a', eye: '#ff4030',
    moanChance: 0.006, moanType: 'walker',
  },
  runner: {
    hp: 2, speed: 100, radius: 5, damage: 6, accel: 900,
    score: 150, attackRate: 0.55,
    body: '#a86a3a', dark: '#4a2a10', eye: '#ff8020',
    moanChance: 0.012, moanType: 'runner',
  },
  brute: {
    hp: 14, speed: 45, radius: 10, damage: 20, accel: 350,
    score: 400, attackRate: 1.3,
    body: '#7a9a6a', dark: '#3a5a2a', eye: '#ff2040',
    moanChance: 0.009, moanType: 'brute',
  },
};

export class Zombie {
  constructor(x, y, type) {
    const def = ZOMBIE_TYPES[type];
    this.type = type;
    this.def = def;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.radius = def.radius;
    this.angle = 0;
    this.walkPhase = Math.random() * 10;
    this.attackCd = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.deadTime = 0;
    this.wobble = Math.random() * 6.28;
  }
}

// ============ BULLET ============
export class Bullet {
  constructor(x, y, vx, vy, damage, pierce = 0) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;
    this.life = 0.8;
    this.hitList = new Set();
  }
}

// ============ PARTICLE ============
export class Particle {
  constructor(x, y, vx, vy, color, size, life, blood = false) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.size = size;
    this.life = life;
    this.maxLife = life;
    this.blood = blood;
    this.drag = 0.9;
  }
}

// ============ CASING ============
export class Casing {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.rot = Math.random() * 6.28;
    this.rotSpd = rand(-15, 15);
    this.life = 2.2;
  }
}

// ============ DECAL ============
export class Decal {
  constructor(x, y, size, color) {
    this.x = x; this.y = y;
    this.size = size;
    this.color = color;
  }
}

// ============ DROP ============
export class Drop {
  constructor(x, y, payload, kind) {
    this.x = x; this.y = y;
    this.targetX = x; this.targetY = y;
    this.startY = y - 400;
    this.y = this.startY;
    this.t = 0;
    this.fallDuration = 2.2;
    this.landed = false;
    this.picked = false;
    this.kind = kind;
    this.payload = payload;
    this.beacon = 0;
    this.life = 30;
  }
}

// ============================================================
// BOSSES
// ============================================================

export const BOSS_TYPES = {
  butcher: {
    name: 'THE BUTCHER',
    hp: 200,
    speed: 70,
    enragedSpeed: 105,
    radius: 16,
    damage: 35,
    attackRate: 1.4,
    accel: 400,
    score: 2000,
    color: '#8a2010',
    dark: '#4a0808',
    eye: '#ffcc00',
    enrageAt: 0.5,
  },
  mother: {
    name: 'HORDE MOTHER',
    hp: 350,
    speed: 45,
    radius: 20,
    damage: 15,
    attackRate: 2.0,
    accel: 200,
    score: 4000,
    color: '#7a3a9a',
    dark: '#3a104a',
    eye: '#e0b0ff',
    spawnInterval: 3.0,
  },
  stalker: {
    name: 'THE STALKER',
    hp: 150,
    speed: 140,
    radius: 12,
    damage: 22,
    attackRate: 0.9,
    accel: 1200,
    score: 6000,
    color: '#3a3a3a',
    dark: '#1a1a1a',
    eye: '#ffdd00',
    teleportInterval: 4.0,
    cloneAt: 0.3,
  },
  colossus: {
    name: 'THE COLOSSUS',
    hp: 800,
    speed: 40,
    radius: 26,
    damage: 40,
    attackRate: 1.8,
    accel: 200,
    score: 10000,
    color: '#5a6a7a',
    dark: '#1a2a3a',
    eye: '#ff4020',
    slamRange: 110,
    slamCd: 5.0,
  },
};

// ترتیب boss بر اساس wave
export const BOSS_ORDER = ['butcher', 'mother', 'stalker', 'colossus'];

export function bossForWave(wave) {
  if (wave % 5 !== 0) return null;
  const idx = Math.floor(wave / 5) - 1;
  return BOSS_ORDER[idx % BOSS_ORDER.length];
}

export class Boss {
  constructor(x, y, type) {
    const def = BOSS_TYPES[type];
    this.type = type;
    this.def = def;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.radius = def.radius;
    this.angle = 0;
    this.walkPhase = 0;
    this.attackCd = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.deadTime = 0;
    this.phase = 1;
    this.enraged = false;
    this.spawnCd = def.spawnInterval || 0;
    this.teleportCd = def.teleportInterval || 0;
    this.slamCd = def.slamCd || 0;
    this.slamAnim = 0;
    this.spawnedClones = false;
    this.wobble = Math.random() * 6.28;
    this.eyes = [];
    this.alpha = 1;
    if (type === 'mother') {
      for (let i = 0; i < 6; i++) {
        this.eyes.push({
          angle: Math.random() * 6.28,
          dist: 4 + Math.random() * 10,
          blink: Math.random() * 3,
        });
      }
    }
  }
}