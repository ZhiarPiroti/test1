// ============================================================
// All drawing — pixel-art rendering
// ============================================================

import { WORLD_W, WORLD_H } from './world.js';

const VW = 480;
const VH = 270;
const RESPAWN_TIME = 4.0;

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;

    canvas.width = VW;
    canvas.height = VH;
    this.ctx.imageSmoothingEnabled = false;

    this._fit();
    addEventListener('resize', () => this._fit());
  }

  _fit() {
    const s = Math.min(innerWidth / VW, innerHeight / VH);
    this.canvas.style.width = (VW * s) + 'px';
    this.canvas.style.height = (VH * s) + 'px';
  }

  render() {
    const w = this.world;
    const ctx = this.ctx;

    ctx.fillStyle = '#0a0806';
    ctx.fillRect(0, 0, VW, VH);

    ctx.save();
    ctx.translate(Math.round(w.cam.shakeX), Math.round(w.cam.shakeY));

    this._drawGround(w);
    this._drawDecals(w);
    this._drawCasings(w);

    // Sort by y for depth
    const zs = w.zombies.slice().sort((a, b) => a.y - b.y);
    for (const z of zs) this._drawZombie(z, w);

    for (const b of w.bullets) this._drawBullet(b, w);

    this._drawDrops(w);
    this._drawPlayer(w);
    this._drawParticles(w);

    ctx.restore();

    // ============ SCREEN-SPACE EFFECTS ============
    this._drawVignette(w);
    this._drawDamageOverlay(w);
    this._drawLowHealthPulse(w);
    this._drawDeathOverlay(w);
    this._drawScanlines();
  }

  _drawGround(w) {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1208';
    ctx.fillRect(0, 0, VW, VH);

    const tile = 16;
    const sx = Math.floor(w.cam.x / tile) * tile;
    const sy = Math.floor(w.cam.y / tile) * tile;

    for (let tx = sx; tx < w.cam.x + VW + tile; tx += tile) {
      for (let ty = sy; ty < w.cam.y + VH + tile; ty += tile) {
        const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        const px = Math.round(tx - w.cam.x);
        const py = Math.round(ty - w.cam.y);
        const v = n % 100;
        if (v < 8) { ctx.fillStyle = '#241a10'; ctx.fillRect(px + (n % 12), py + ((n >> 4) % 12), 2, 2); }
        else if (v < 20) { ctx.fillStyle = '#140e06'; ctx.fillRect(px + (n % 14), py + ((n >> 4) % 14), 1, 1); }
        else if (v < 24) { ctx.fillStyle = '#2a1e10'; ctx.fillRect(px + (n % 10), py + ((n >> 4) % 10), 1, 2); }
      }
    }

    ctx.fillStyle = '#0a0806';
    if (w.cam.x < 8) ctx.fillRect(-w.cam.x, 0, 8, VH);
    if (w.cam.y < 8) ctx.fillRect(0, -w.cam.y, VW, 8);
    if (w.cam.x + VW > WORLD_W - 8) ctx.fillRect(WORLD_W - 8 - w.cam.x, 0, 8, VH);
    if (w.cam.y + VH > WORLD_H - 8) ctx.fillRect(0, WORLD_H - 8 - w.cam.y, VW, 8);
  }

  _drawDecals(w) {
    const ctx = this.ctx;
    for (const d of w.decals) {
      const x = Math.round(d.x - w.cam.x);
      const y = Math.round(d.y - w.cam.y);
      if (x < -8 || x > VW + 8 || y < -8 || y > VH + 8) continue;
      ctx.fillStyle = d.color;
      ctx.fillRect(x, y, Math.max(1, Math.round(d.size)), Math.max(1, Math.round(d.size)));
    }
  }

  _drawCasings(w) {
    const ctx = this.ctx;
    for (const c of w.casings) {
      const x = Math.round(c.x - w.cam.x);
      const y = Math.round(c.y - w.cam.y);
      if (x < -4 || x > VW + 4 || y < -4 || y > VH + 4) continue;
      ctx.fillStyle = c.life < 0.5 ? '#5a4020' : '#c8a030';
      ctx.fillRect(x, y, 2, 1);
    }
  }

  _drawZombie(z, w) {
    const ctx = this.ctx;
    const px = Math.round(z.x - w.cam.x);
    const py = Math.round(z.y - w.cam.y);
    if (px < -20 || px > VW + 20 || py < -20 || py > VH + 20) return;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(px, py + z.radius - 1, z.radius * 0.9, z.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    let alpha = 1, scale = 1;
    if (z.dead) {
      const t = 1 - z.deadTime / 0.35;
      alpha = 1 - t;
      scale = 1 - t * 0.4;
    }
    const r = z.radius * scale;
    const flash = z.hitFlash > 0;

    const wp = (typeof z.walkPhase === 'number' && isFinite(z.walkPhase)) ? z.walkPhase : 0;
    const zAng = (typeof z.angle === 'number' && isFinite(z.angle)) ? z.angle : 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);

    const bobY = Math.cos(wp * 0.5) * 0.4;
    ctx.rotate(zAng);

    const darkCol = flash ? '#ffffff' : z.def.dark;
    const bodyCol = flash ? '#ffffff' : z.def.body;

    // outline
    ctx.fillStyle = '#000';
    ctx.fillRect(-r - 1, -r + bobY - 1, r * 2 + 2, r * 2 + 2);

    // body
    ctx.fillStyle = darkCol;
    ctx.fillRect(-r, -r + bobY, r * 2, r * 2);

    ctx.fillStyle = bodyCol;
    ctx.fillRect(-r + 1, -r + 1 + bobY, r * 2 - 2, r * 2 - 2);

    // arms
    const armReach = Math.round(r * 0.8 + Math.sin(wp * 2) * 0.5);
    ctx.fillStyle = flash ? '#ffffff' : z.def.dark;
    ctx.fillRect(r - 1, -r + 2 + bobY, armReach, 2);
    ctx.fillRect(r - 1, r - 4 + bobY, armReach, 2);

    // head
    const headSize = Math.max(3, Math.round(r * 1.1));
    const headX = r - headSize - 1;

    ctx.fillStyle = '#000';
    ctx.fillRect(headX - 1, -headSize / 2 + bobY - 1, headSize + 2, headSize + 2);

    ctx.fillStyle = flash ? '#ffffff' : '#d8b088';
    ctx.fillRect(headX, -headSize / 2 + bobY, headSize, headSize);

    ctx.fillStyle = flash ? '#ffffff' : z.def.dark;
    ctx.fillRect(headX, -headSize / 2 + bobY, headSize, 1);

    if (!flash && !z.dead) {
      ctx.fillStyle = z.def.eye;
      ctx.fillRect(headX + headSize - 2, -1 + bobY, 1, 1);
      ctx.fillRect(headX + headSize - 2, 1 + bobY, 1, 1);
    }

    if (z.type === 'brute' && !flash) {
      ctx.fillStyle = '#7a0a0a';
      ctx.fillRect(-r + 2, 0 + bobY, 3, 2);
      ctx.fillRect(-r + 3, 4 + bobY, 2, 1);
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    if (z.type === 'brute' && z.hp < z.maxHp && !z.dead) {
      const bw = Math.round(z.radius * 2.2);
      const hx = px - bw / 2;
      const hy = py - z.radius - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(hx - 1, hy - 1, bw + 2, 4);
      ctx.fillStyle = '#c02020';
      ctx.fillRect(hx, hy, Math.round(bw * (z.hp / z.maxHp)), 2);
    }
  }

  _drawBullet(b, w) {
    const ctx = this.ctx;
    const bx = (b.renderX !== undefined) ? b.renderX : b.x;
    const by = (b.renderY !== undefined) ? b.renderY : b.y;
    const x = Math.round(bx - w.cam.x);
    const y = Math.round(by - w.cam.y);
    const tx = Math.round(x - b.vx * 0.008);
    const ty = Math.round(y - b.vy * 0.008);

    ctx.fillStyle = 'rgba(255, 220, 120, 0.5)';
    ctx.fillRect(tx - 1, ty - 1, 3, 3);
    ctx.fillStyle = 'rgba(255, 240, 180, 0.8)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 1, 1);
  }

  _drawParticles(w) {
    const ctx = this.ctx;
    for (const p of w.particles) {
      const x = Math.round(p.x - w.cam.x);
      const y = Math.round(p.y - w.cam.y);
      if (x < -4 || x > VW + 4 || y < -4 || y > VH + 4) continue;
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.5));
      ctx.fillStyle = p.color;
      const s = Math.max(1, Math.round(p.size));
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // PLAYER
  // ============================================================
  _drawPlayer(w) {
    if (Array.isArray(w.players) && w.players.length > 0) {
      const sorted = w.players.slice().sort((a, b) => {
        if (a.isSelf) return 1;
        if (b.isSelf) return -1;
        return (a.y || 0) - (b.y || 0);
      });
      for (const p of sorted) this._drawPlayerSprite(p, w);
    } else if (w.player) {
      w.player.isSelf = true;
      this._drawPlayerSprite(w.player, w);
    }
  }

  _drawPlayerSprite(p, w) {
    const ctx = this.ctx;
    const px = Math.round(p.x - w.cam.x);
    const py = Math.round(p.y - w.cam.y);
    if (!isFinite(px) || !isFinite(py)) return;

    const isSelf = !!p.isSelf;

    const walkPhase = (typeof p.walkPhase === 'number' && isFinite(p.walkPhase)) ? p.walkPhase : 0;
    const angle = (typeof p.angle === 'number' && isFinite(p.angle)) ? p.angle : 0;
    const muzzleFlash = (typeof p.muzzleFlash === 'number' && isFinite(p.muzzleFlash)) ? p.muzzleFlash : 0;
    const hitFlash = (typeof p.hitFlash === 'number' && isFinite(p.hitFlash)) ? p.hitFlash : 0;

    // ============================================================
    // ★★★ بازیکن مرده — به جای sprite، فقط لکه‌ی خون ★★★
    // ============================================================
    if (p.dead) {
      // blood pool
      ctx.fillStyle = 'rgba(100, 15, 15, 0.7)';
      ctx.beginPath();
      ctx.ellipse(px, py + 4, 13, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(160, 25, 25, 0.6)';
      ctx.beginPath();
      ctx.ellipse(px, py + 3, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200, 40, 40, 0.5)';
      ctx.beginPath();
      ctx.ellipse(px, py + 2, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // cross sign یا علامت
      ctx.fillStyle = 'rgba(60, 5, 5, 0.8)';
      ctx.fillRect(px - 1, py - 3, 2, 10);
      ctx.fillRect(px - 4, py, 8, 2);

      // اگه خودمون هستیم، دور corpse یه رینگ قرمز پالس‌دار
      if (isSelf) {
        const t = performance.now() * 0.005;
        const pulse = 0.4 + Math.sin(t) * 0.3;
        ctx.strokeStyle = `rgba(255, 40, 20, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py + 3, 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // name tag برای بازیکن مرده‌ی دیگه
      if (!isSelf && p.name) {
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(p.name).width;
        ctx.fillStyle = 'rgba(60, 0, 0, 0.85)';
        ctx.fillRect(px - tw / 2 - 3, py - 22, tw + 6, 10);
        ctx.fillStyle = '#ff4444';
        ctx.fillText(p.name + ' ☠', px, py - 14);
      }

      return;
    }

    // ============================================================
    // ★ بازیکن زنده — sprite عادی ★
    // ============================================================
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(px, py + 5, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    const bob = Math.sin(walkPhase * 2) * 0.7;
    const py2 = py + Math.round(bob);

    // هاله‌ی خودمون (پالس‌دار)
    if (isSelf) {
      const t = performance.now() * 0.003;
      const pulse = 0.18 + Math.sin(t) * 0.06;
      const aura = ctx.createRadialGradient(px, py2, 3, px, py2, 20);
      aura.addColorStop(0, `rgba(255, 220, 100, ${pulse})`);
      aura.addColorStop(0.6, `rgba(255, 180, 60, ${pulse * 0.4})`);
      aura.addColorStop(1, 'rgba(255, 180, 60, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(px, py2, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    // Muzzle flash
    if (muzzleFlash > 0) {
      const gx = px + Math.cos(angle) * 10;
      const gy = py2 + Math.sin(angle) * 10;
      const a = Math.min(1, muzzleFlash / 0.06);

      ctx.fillStyle = `rgba(255, 200, 80, ${a * 0.5})`;
      ctx.beginPath(); ctx.arc(gx, gy, 8 * a, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255, 220, 100, ${a})`;
      ctx.beginPath(); ctx.arc(gx, gy, 5 * a, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      ctx.beginPath(); ctx.arc(gx, gy, 2.5 * a, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = `rgba(255, 220, 100, ${a * 0.8})`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const spikeAngle = angle + (i - 1.5) * 0.35;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + Math.cos(spikeAngle) * 10, gy + Math.sin(spikeAngle) * 10);
        ctx.stroke();
      }
    }

    // ============ BODY ============
    const sk = p.skin || { body: '#2a3a2a', bodyLight: '#3a4a3a', skin: '#e0b080', hair: '#3a2010' };

    ctx.save();
    ctx.translate(px, py2);
    ctx.rotate(angle + Math.PI / 2);

    // Arms
    ctx.fillStyle = sk.skin;
    ctx.fillRect(-5, -3, 2, 4);
    ctx.fillRect(3, -3, 2, 4);

    // Body
    ctx.fillStyle = sk.body;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = sk.bodyLight;
    ctx.fillRect(-1, -3, 2, 6);

    // Shoulders
    ctx.fillStyle = sk.bodyLight;
    ctx.fillRect(-5, -2, 1, 4);
    ctx.fillRect(4, -2, 1, 4);

    // Head
    ctx.fillStyle = sk.skin;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.fillStyle = sk.hair;
    ctx.fillRect(-2, -3, 4, 1);
    ctx.fillRect(-2, -2, 1, 1);
    ctx.fillRect(1, -2, 1, 1);

    // Gun
    const kick = Math.max(0, p.kick || 0) * 1.5;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-1, -10 + kick, 2, 8);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(-1, -10 + kick, 2, 1);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(-1, -4, 2, 3);

    ctx.restore();

    // HIT FLASH
    if (hitFlash > 0) {
      const a = hitFlash * 0.9;
      ctx.fillStyle = `rgba(255, 40, 20, ${a * 0.5})`;
      ctx.beginPath(); ctx.arc(px, py2, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py2, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(255, 40, 20, ${a * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py2, 15, 0, Math.PI * 2); ctx.stroke();
    }

    // name tag
    if (!isSelf && p.name) {
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(p.name).width;
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(px - tw / 2 - 3, py2 - 22, tw + 6, 10);
      ctx.fillStyle = '#ffcc66';
      ctx.fillText(p.name, px, py2 - 14);
    }
  }

  _drawDrops(w) {
    const ctx = this.ctx;
    for (const d of w.drops) {
      const x = Math.round(d.x - w.cam.x);
      const y = Math.round(d.y - w.cam.y);
      if (x < -50 || x > VW + 50 || y < -50 || y > VH + 50) continue;

      if (!d.landed) {
        ctx.fillStyle = '#d04030';
        ctx.beginPath();
        ctx.arc(x, y - 18, 12, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#a02818';
        ctx.beginPath();
        ctx.arc(x, y - 18, 12, Math.PI * 0.85, Math.PI * 1.15);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 18); ctx.lineTo(x - 3, y - 4);
        ctx.moveTo(x + 10, y - 18); ctx.lineTo(x + 3, y - 4);
        ctx.stroke();
      }

      const crateColor = d.kind === 'weapon' ? '#c8a030' : d.kind === 'ammo' ? '#8090a0' : '#40a040';
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 5, y - 4, 10, 9);
      ctx.fillStyle = crateColor;
      ctx.fillRect(x - 4, y - 3, 8, 7);
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 4, y, 8, 1);

      const pulse = Math.sin(d.beacon * 6) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 200, 60, ${0.4 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(x, y - 20, 3 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();

      if (d.landed) {
        const ring = Math.sin(d.beacon * 3) * 4 + 12;
        ctx.strokeStyle = `rgba(255, 200, 60, ${0.3 + pulse * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, ring, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ============================================================
  // SCREEN-SPACE EFFECTS
  // ============================================================

  _drawVignette(w) {
    const ctx = this.ctx;
    const px = w.player.x - w.cam.x;
    const py = w.player.y - w.cam.y;
    const g = ctx.createRadialGradient(px, py, 30, px, py, 220);
    g.addColorStop(0, 'rgba(255, 200, 120, 0.06)');
    g.addColorStop(0.4, 'rgba(0, 0, 0, 0)');
    g.addColorStop(0.75, 'rgba(0, 0, 0, 0.35)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }

  // ★★★ DAMAGE OVERLAY — قوی و چند لایه ★★★
  _drawDamageOverlay(w) {
    const f = w.damageFlash;
    if (f <= 0) return;

    const ctx = this.ctx;
    const a = Math.min(1, f * 1.4);

    // ۱: پر شدن کامل با قرمز
    ctx.fillStyle = `rgba(180, 0, 0, ${a * 0.55})`;
    ctx.fillRect(0, 0, VW, VH);

    // ۲: گرادیان قرمز از لبه
    const grad = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.15, VW / 2, VH / 2, VH * 0.85);
    grad.addColorStop(0, 'rgba(255, 0, 0, 0)');
    grad.addColorStop(0.5, `rgba(220, 20, 20, ${a * 0.5})`);
    grad.addColorStop(1, `rgba(255, 30, 30, ${a * 0.9})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VW, VH);

    // ۳: رینگ قرمز ضخیم
    ctx.strokeStyle = `rgba(255, 40, 20, ${a})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, VW - 10, VH - 10);

    ctx.strokeStyle = `rgba(255, 100, 80, ${a * 0.7})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(11, 11, VW - 22, VH - 22);

    // ۴: اسکن‌لاین قرمز متحرک
    ctx.fillStyle = `rgba(255, 40, 20, ${a * 0.15})`;
    for (let y = 0; y < VH; y += 4) {
      if ((y + Math.floor(performance.now() * 0.1)) % 8 < 2) {
        ctx.fillRect(0, y, VW, 1);
      }
    }

    // ۵: فلش سفید لحظه‌ی اول
    if (f > 0.7) {
      const whiteA = (f - 0.7) / 0.3;
      ctx.fillStyle = `rgba(255, 255, 255, ${whiteA * 0.4})`;
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  _drawLowHealthPulse(w) {
    if (!w.player) return;
    const hpPct = w.player.health / w.player.maxHealth;
    if (hpPct < 0.3 && hpPct > 0 && !w.player.dead) {
      const t = performance.now() * 0.004;
      const pulse = 0.15 + Math.sin(t) * 0.1;

      const ctx = this.ctx;
      const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.25, VW / 2, VH / 2, VH * 0.9);
      g.addColorStop(0, 'rgba(255, 0, 0, 0)');
      g.addColorStop(1, `rgba(180, 0, 0, ${pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, VH);

      ctx.strokeStyle = `rgba(255, 40, 20, ${pulse * 0.6})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, VW - 4, VH - 4);
    }
  }

  // ★★★ DEATH OVERLAY — انیمیشن مرگ و ریسپاون ★★★
  _drawDeathOverlay(w) {
    if (!w.player) return;

    const isDead = w.player.dead;
    const anim = w.deathAnim || 0;
    const respawnT = w.respawnTimer || 0;

    // اگه نه مرده‌ایم و نه انیمیشن داریم
    if (!isDead && anim <= 0) return;

    const ctx = this.ctx;

    // ============ انیمیشن مرگ ============
    if (isDead) {
      // ۱: تیرگی
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, VW, VH);

      // ۲: گرادیان قرمز از پایین
      const grad = ctx.createRadialGradient(VW / 2, VH, 20, VW / 2, VH, VH);
      grad.addColorStop(0, 'rgba(180, 0, 0, 0.6)');
      grad.addColorStop(1, 'rgba(80, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, VW, VH);

      // ۳: خطوط افقی قرمز (خطای سیگنال)
      const t = performance.now() * 0.002;
      ctx.fillStyle = 'rgba(255, 40, 20, 0.15)';
      for (let y = 0; y < VH; y += 6) {
        const offset = Math.floor(Math.sin(t + y * 0.1) * 2);
        ctx.fillRect(0, y + offset, VW, 2);
      }

      // ۴: متن "YOU DIED"
      const appear = Math.min(1, (RESPAWN_TIME - respawnT) / 0.5);
      const scale = 0.6 + appear * 0.4;
      ctx.save();
      ctx.translate(VW / 2, VH / 2 - 20);
      ctx.scale(scale, scale);
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // سایه
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillText('YOU DIED', 2, 2);

      // رنگ قرمز پالس‌دار
      const pulse = 0.8 + Math.sin(performance.now() * 0.01) * 0.2;
      ctx.fillStyle = `rgba(220, 30, 30, ${pulse})`;
      ctx.fillText('YOU DIED', 0, 0);
      ctx.restore();

      // ۵: شمارش معکوس
      const sec = Math.ceil(respawnT);
      if (sec > 0) {
        ctx.strokeStyle = 'rgba(255, 40, 20, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(VW / 2 - 80, VH / 2 + 5);
        ctx.lineTo(VW / 2 + 80, VH / 2 + 5);
        ctx.stroke();

        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 200, 100, 0.9)';
        ctx.fillText(`RESPAWNING IN ${sec}...`, VW / 2, VH / 2 + 22);

        // نوار پیشرفت
        const barW = 160;
        const barH = 4;
        const barX = VW / 2 - barW / 2;
        const barY = VH / 2 + 38;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(barX, barY, barW, barH);

        const progress = 1 - (respawnT / RESPAWN_TIME);
        ctx.fillStyle = 'rgba(255, 60, 30, 0.9)';
        ctx.fillRect(barX, barY, barW * progress, barH);

        ctx.strokeStyle = 'rgba(255, 40, 20, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
      }

      // ۶: رینگ قرمز کنار
      ctx.strokeStyle = `rgba(180, 0, 0, ${0.6 + Math.sin(performance.now() * 0.005) * 0.2})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, VW - 6, VH - 6);
    }

    // ============ ظاهر شدن بعد از ریسپاون ============
    if (!isDead && anim > 0) {
      const a = anim * 0.5;
      const px = w.player.x - w.cam.x;
      const py = w.player.y - w.cam.y;

      const grad = ctx.createRadialGradient(px, py, 5, px, py, 80);
      grad.addColorStop(0, `rgba(120, 240, 120, ${a})`);
      grad.addColorStop(0.5, `rgba(60, 200, 60, ${a * 0.5})`);
      grad.addColorStop(1, 'rgba(60, 200, 60, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, VW, VH);

      ctx.strokeStyle = `rgba(120, 240, 120, ${a})`;
      ctx.lineWidth = 2;
      const r = 20 + (1 - anim) * 60;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawScanlines() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
    for (let y = 0; y < VH; y += 3) {
      ctx.fillRect(0, y, VW, 1);
    }
  }
}