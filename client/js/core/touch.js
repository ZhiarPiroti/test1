// ============================================================
// Touch controls — dual virtual joysticks for mobile
// ============================================================

export class TouchControls {
    constructor() {
      this.enabled = this._detectTouch();
      this.active = false;
      this.moveStick = null;
      this.aimStick = null;
      this.moveVec = { x: 0, y: 0 };
      this.aimVec = { x: 0, y: 0 };
      this.aiming = false;
      this.MAX = 60;
  
      if (!this.enabled) return;
  
      this._createDom();
      this._bind();
    }
  
    _detectTouch() {
      return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    }
  
    _createDom() {
      const wrap = document.createElement('div');
      wrap.className = 'touch-controls';
      wrap.style.display = 'none';  // ★ اول پنهون
  
      const mkStick = () => {
        const s = document.createElement('div');
        s.className = 'stick';
        const inner = document.createElement('div');
        inner.className = 'stick-inner';
        s.appendChild(inner);
        return s;
      };
  
      this.moveEl = mkStick();
      this.aimEl = mkStick();
      this.moveInner = this.moveEl.firstChild;
      this.aimInner = this.aimEl.firstChild;
  
      wrap.appendChild(this.moveEl);
      wrap.appendChild(this.aimEl);
      document.body.appendChild(wrap);
      this.wrap = wrap;
    }
  
    _bind() {
      // ★ از passive:true استفاده می‌کنیم که preventDefault رو غیرفعال کنه
      // و دکمه‌های HTML کار کنن
      document.addEventListener('touchstart', (e) => this._onStart(e), { passive: false });
      document.addEventListener('touchmove', (e) => this._onMove(e), { passive: false });
      document.addEventListener('touchend', (e) => this._onEnd(e), { passive: false });
      document.addEventListener('touchcancel', (e) => this._onEnd(e), { passive: false });
    }
  
    // ★★★ فعال/غیرفعال ★★★
    activate() {
      if (!this.enabled) return;
      this.active = true;
      if (this.wrap) this.wrap.style.display = 'block';
    }
  
    deactivate() {
      if (!this.enabled) return;
      this.active = false;
      if (this.wrap) this.wrap.style.display = 'none';
      this.moveStick = null;
      this.aimStick = null;
      this.moveVec = { x: 0, y: 0 };
      this.aimVec = { x: 0, y: 0 };
      this.aiming = false;
      if (this.moveEl) this.moveEl.classList.remove('active');
      if (this.aimEl) this.aimEl.classList.remove('active');
    }
  
    _onStart(e) {
      // ★★★ اگه غیرفعالیم، اصلاً کاری نکن — دکمه‌های منو کار می‌کنن ★★★
      if (!this.active) return;
  
      // ★ چک اضافه: اگه روی دکمه‌ی HTML بود، رد کن
      const t = e.target;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' ||
          t.tagName === 'A' || t.closest('button, input, a'))) {
        return;
      }
  
      for (const touch of e.changedTouches) {
        const isLeft = touch.clientX < window.innerWidth / 2;
  
        if (isLeft && !this.moveStick) {
          this.moveStick = {
            id: touch.identifier,
            startX: touch.clientX, startY: touch.clientY,
            curX: touch.clientX, curY: touch.clientY,
          };
          this.moveEl.style.left = touch.clientX + 'px';
          this.moveEl.style.top = touch.clientY + 'px';
          this.moveEl.classList.add('active');
        } else if (!isLeft && !this.aimStick) {
          this.aimStick = {
            id: touch.identifier,
            startX: touch.clientX, startY: touch.clientY,
            curX: touch.clientX, curY: touch.clientY,
          };
          this.aimEl.style.left = touch.clientX + 'px';
          this.aimEl.style.top = touch.clientY + 'px';
          this.aimEl.classList.add('active');
          this.aiming = true;
        }
      }
      this._updateSticks();
      e.preventDefault();
    }
  
    _onMove(e) {
      if (!this.active) return;
      if (!this.moveStick && !this.aimStick) return;
  
      for (const touch of e.changedTouches) {
        if (this.moveStick && touch.identifier === this.moveStick.id) {
          this.moveStick.curX = touch.clientX;
          this.moveStick.curY = touch.clientY;
        }
        if (this.aimStick && touch.identifier === this.aimStick.id) {
          this.aimStick.curX = touch.clientX;
          this.aimStick.curY = touch.clientY;
        }
      }
      this._updateSticks();
      e.preventDefault();
    }
  
    _onEnd(e) {
      if (!this.active) return;
  
      for (const touch of e.changedTouches) {
        if (this.moveStick && touch.identifier === this.moveStick.id) {
          this.moveStick = null;
          this.moveVec = { x: 0, y: 0 };
          this.moveEl.classList.remove('active');
        }
        if (this.aimStick && touch.identifier === this.aimStick.id) {
          this.aimStick = null;
          this.aimVec = { x: 0, y: 0 };
          this.aiming = false;
          this.aimEl.classList.remove('active');
        }
      }
      this._updateSticks();
      e.preventDefault();
    }
  
    _updateSticks() {
      // MOVE
      if (this.moveStick) {
        const dx = this.moveStick.curX - this.moveStick.startX;
        const dy = this.moveStick.curY - this.moveStick.startY;
        const len = Math.hypot(dx, dy);
        const cl = Math.min(len, this.MAX);
        if (len > 0.5) {
          const nx = dx / len;
          const ny = dy / len;
          this.moveVec.x = nx * (cl / this.MAX);
          this.moveVec.y = ny * (cl / this.MAX);
          this.moveInner.style.transform = `translate(calc(-50% + ${nx * cl}px), calc(-50% + ${ny * cl}px))`;
        } else {
          this.moveVec = { x: 0, y: 0 };
          this.moveInner.style.transform = 'translate(-50%, -50%)';
        }
      } else {
        this.moveVec = { x: 0, y: 0 };
        if (this.moveInner) this.moveInner.style.transform = 'translate(-50%, -50%)';
      }
  
      // AIM
      if (this.aimStick) {
        const dx = this.aimStick.curX - this.aimStick.startX;
        const dy = this.aimStick.curY - this.aimStick.startY;
        const len = Math.hypot(dx, dy);
        const cl = Math.min(len, this.MAX);
        if (len > 0.5) {
          const nx = dx / len;
          const ny = dy / len;
          this.aimVec.x = nx * (cl / this.MAX);
          this.aimVec.y = ny * (cl / this.MAX);
          this.aimInner.style.transform = `translate(calc(-50% + ${nx * cl}px), calc(-50% + ${ny * cl}px))`;
        } else {
          this.aimVec = { x: 0, y: 0 };
          this.aimInner.style.transform = 'translate(-50%, -50%)';
        }
      } else {
        this.aimVec = { x: 0, y: 0 };
        if (this.aimInner) this.aimInner.style.transform = 'translate(-50%, -50%)';
      }
    }
  
    getMoveVec() { return this.moveVec; }
    getAimVec() { return this.aimVec; }
  
    isShooting() {
      if (!this.aiming) return false;
      return Math.hypot(this.aimVec.x, this.aimVec.y) > 0.25;
    }
  
    getAimAngle() {
      if (!this.aiming) return null;
      if (Math.hypot(this.aimVec.x, this.aimVec.y) < 0.25) return null;
      return Math.atan2(this.aimVec.y, this.aimVec.x);
    }
  }