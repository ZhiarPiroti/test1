// ============================================================
// Keyboard + mouse + touch state
// ============================================================

import { TouchControls } from './touch.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false };
    this.justPressed = new Set();
    this.touch = new TouchControls();

    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys[k]) this.justPressed.add(k);
      this.keys[k] = true;
    });

    addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    canvas.addEventListener('mousemove', (e) => this.updateMouse(e));
    canvas.addEventListener('mousedown', (e) => {
      this.updateMouse(e);
      if (e.button === 0) this.mouse.down = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = (e.clientX - r.left) / r.width * this.canvas.width;
    this.mouse.y = (e.clientY - r.top) / r.height * this.canvas.height;
  }

  // ============================================================
  // ★★★ فقط وقتی یه joystick واقعاً فعاله، keys رو override کن ★★★
  // ============================================================
  applyTouchInput() {
    if (!this.touch || !this.touch.enabled || !this.touch.active) return false;

    const hasMoveStick = !!this.touch.moveStick;
    const hasAimStick = !!this.touch.aimStick;

    // ★ اگه هیچ لمسی رخ نداده، کیبورد و ماوس رو دست نزن
    if (!hasMoveStick && !hasAimStick) return false;

    const m = this.touch.getMoveVec();
    const dz = 0.2;

    // ★ فقط اگه move stick فعاله، keys رو ست کن
    if (hasMoveStick) {
      this.keys['a'] = this.keys['arrowleft'] = m.x < -dz;
      this.keys['d'] = this.keys['arrowright'] = m.x > dz;
      this.keys['w'] = this.keys['arrowup'] = m.y < -dz;
      this.keys['s'] = this.keys['arrowdown'] = m.y > dz;
    }

    // ★ فقط اگه aim stick فعاله، mouse.down رو ست کن
    if (hasAimStick) {
      const shooting = this.touch.isShooting();
      this.mouse.down = shooting;
    }

    return true;
  }

  getTouchAimAngle() {
    if (!this.touch || !this.touch.enabled || !this.touch.active) return null;
    if (!this.touch.aimStick) return null;   // ★ فقط اگه انگشت روی صفحه‌ست
    return this.touch.getAimAngle();
  }

  // ★★★ تشخیص واقعی موبایل — coarse pointer ★★★
  isMobile() {
    if (!this.touch || !this.touch.enabled) return false;
    // اگه یه لمس واقعی اتفاق افتاده، موبایله
    if (this.touch.aimStick || this.touch.moveStick) return true;
    // وگرنه، از media query استفاده کن (فقط برای دستگاه‌های لمسی واقعی)
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        return window.matchMedia('(pointer: coarse)').matches;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  wasPressed(key) {
    return this.justPressed.has(key);
  }

  clearFrame() {
    this.justPressed.clear();
  }
}