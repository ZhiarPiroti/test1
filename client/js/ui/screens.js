// ============================================================
// Screen management: lobby ↔ room ↔ game ↔ gameover
// ============================================================

import { SKINS } from '../game/entities.js';

export class Screens {
  constructor(app) {
    this.app = app;
    this.currentScreen = 'lobby';
    this.net = null;
    this.isHost = false;
    this.roomCode = null;
    this.selectedSkin = 'rookie';

    const ids = [
      'screen-lobby', 'screen-room', 'screen-game', 'screen-gameover',
      'username', 'skins', 'join-code',
      'btn-solo', 'btn-create', 'btn-join',
      'roomCode', 'roomPlayers', 'btn-room-start', 'btn-room-leave',
      'btn-room-copy', 'roomHint',
      'btn-retry', 'btn-lobby',
      'goScore', 'goWave', 'goKills',
    ];
    this.el = {};
    for (const id of ids) {
      this.el[id] = document.getElementById(id);
      if (!this.el[id]) {
        console.warn('[Screens] Missing element:', id);
      }
    }

    this._bind();
  }

  _on(el, event, fn) {
    if (el) {
      el.addEventListener(event, fn);
    }
  }

  _bind() {
    // ---------- SOLO ----------
    this._on(this.el['btn-solo'], 'click', () => {
      const username = this._getUsername();
      this.startGame({ username, skin: this.selectedSkin });
    });

    // ---------- CREATE ROOM ----------
    this._on(this.el['btn-create'], 'click', () => {
      const username = this._getUsername();
      if (typeof this.app.onHostMulti !== 'function') {
        alert('Multiplayer not available');
        return;
      }
      this.app.onHostMulti(username, this.selectedSkin);
    });

    // ---------- JOIN ROOM ----------
    this._on(this.el['btn-join'], 'click', () => {
      const username = this._getUsername();
      if (typeof this.app.onJoinMulti !== 'function') {
        alert('Multiplayer not available');
        return;
      }
      const codeInput = document.getElementById('join-code');
      const code = codeInput ? codeInput.value.toUpperCase().trim() : '';

      if (code.length !== 4) {
        alert('ENTER A 4-LETTER ROOM CODE');
        if (codeInput) codeInput.focus();
        return;
      }

      this.app.onJoinMulti(username, this.selectedSkin, code);
    });

    // ---------- ROOM: LEAVE ----------
    this._on(this.el['btn-room-leave'], 'click', () => {
      if (this.net) this.net.leaveRoom();
      this.roomCode = null;
      this.isHost = false;
      this.show('lobby');
    });

    // ---------- ROOM: START ----------
    this._on(this.el['btn-room-start'], 'click', () => {
      if (this.net && this.isHost && this.roomCode) {
        this.net.startGame();
        if (this.el['btn-room-start']) {
          this.el['btn-room-start'].disabled = true;
          this.el['btn-room-start'].textContent = 'STARTING...';
        }
      }
    });

    // ---------- ROOM: COPY INVITE ----------
    this._on(this.el['btn-room-copy'], 'click', () => {
      if (!this.roomCode) return;
      const url = `${location.origin}${location.pathname}?room=${this.roomCode}`;

      const done = () => {
        const btn = this.el['btn-room-copy'];
        if (!btn) return;
        const old = btn.textContent;
        btn.textContent = '✓ COPIED!';
        setTimeout(() => { btn.textContent = old; }, 1500);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => {
          window.prompt('Copy this link:', url);
        });
      } else {
        window.prompt('Copy this link:', url);
      }
    });

    // ---------- GAME OVER: RETRY ----------
    this._on(this.el['btn-retry'], 'click', () => {
      const username = this._getUsername();
      this.startGame({ username, skin: this.selectedSkin });
    });

    // ---------- GAME OVER: LOBBY ----------
    this._on(this.el['btn-lobby'], 'click', () => {
      this.show('lobby');
    });

    // ---------- ESC: خروج از room ----------
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.currentScreen === 'room') {
        if (this.el['btn-room-leave']) this.el['btn-room-leave'].click();
      }
    });
  }

  _getUsername() {
    const v = (this.el['username'] && this.el['username'].value) || 'ROOKIE';
    return v.toUpperCase().slice(0, 12).trim() || 'ROOKIE';
  }

  populateSkins() {
    const container = this.el['skins'];
    if (!container) return;

    const html = Object.entries(SKINS).map(([key, skin]) => `
      <div class="skin ${key === this.selectedSkin ? 'active' : ''}" data-skin="${key}">
        <div class="skin-avatar" style="background:${skin.body};box-shadow:inset 0 0 0 2px ${skin.bodyLight}, 0 0 0 1px #000;"></div>
        <div class="skin-name">${skin.name}</div>
      </div>
    `).join('');
    container.innerHTML = html;

    container.querySelectorAll('.skin').forEach(el => {
      el.addEventListener('click', () => {
        container.querySelectorAll('.skin').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
        this.selectedSkin = el.dataset.skin;
      });
    });
  }

  startGame(config) {
    this.show('game');
    if (typeof this.app.onStartSolo === 'function') {
      this.app.onStartSolo(config);
    } else {
      console.error('[Screens] app.onStartSolo is not a function');
      alert('Cannot start game.');
    }
  }

  initNet(net) {
    this.net = net;

    net.on('room_created', (data) => {
      console.log('[Screens] room_created', data);
      this.roomCode = data.code;
      this.isHost = true;
      this._showRoom(data);
    });

    net.on('room_joined', (data) => {
      console.log('[Screens] room_joined', data);
      this.roomCode = data.code;
      this.isHost = (data.host === net.mySid);
      this._showRoom(data);
    });

    net.on('player_joined', (data) => {
      console.log('[Screens] player_joined', data);
      if (data.players) this._renderPlayers(data.players);
    });

    net.on('player_left', (data) => {
      console.log('[Screens] player_left', data);
      if (data.players) this._renderPlayers(data.players);
    });

    net.on('join_error', (data) => {
      console.warn('[Screens] join_error', data);
      this._showRoomError(data.msg || 'UNKNOWN ERROR');
    });

    net.on('error_msg', (data) => {
      console.warn('[Screens] error_msg', data);
      this._showRoomError(data.msg || 'ERROR');
    });

    net.on('game_started', () => {
      console.log('[Screens] game_started — switching screen');
      this.show('game');
    });
  }

  _showRoom(data) {
    this.show('room');

    if (this.el['roomCode']) {
      this.el['roomCode'].textContent = data.code;
    }

    if (this.el['roomHint']) {
      this.el['roomHint'].textContent = this.isHost
        ? 'YOU ARE HOST · PRESS START WHEN READY'
        : 'WAITING FOR HOST...';
      this.el['roomHint'].classList.remove('error');
    }

    const startBtn = this.el['btn-room-start'];
    if (startBtn) {
      startBtn.disabled = !this.isHost;
      startBtn.textContent = this.isHost ? 'START RAID' : 'WAITING...';
    }

    this._renderPlayers(data.players || {});
  }

  _renderPlayers(players) {
    const container = this.el['roomPlayers'];
    if (!container) return;

    const entries = Object.entries(players);
    const mySid = this.net && this.net.mySid;

    const html = entries.map(([sid, name]) => {
      const isMe = sid === mySid;
      const isHost = this.isHost && isMe;
      return `
        <div class="room-player ${isMe ? 'me' : ''}">
          <span class="room-player-dot"></span>
          <span class="room-player-name">${this._escape(name)}</span>
          ${isMe ? '<span class="room-player-tag">YOU</span>' : ''}
          ${isHost ? '<span class="room-player-tag host">HOST</span>' : ''}
        </div>
      `;
    }).join('');

    let emptyHtml = '';
    for (let i = entries.length; i < 4; i++) {
      emptyHtml += `<div class="room-player empty">
        <span class="room-player-dot"></span>
        <span class="room-player-name">—</span>
      </div>`;
    }

    container.innerHTML = html + emptyHtml;
  }

  _showRoomError(msg) {
    if (this.currentScreen === 'room' && this.el['roomHint']) {
      this.el['roomHint'].textContent = '⚠ ' + msg;
      this.el['roomHint'].classList.add('error');
      setTimeout(() => {
        if (this.el['roomHint']) this.el['roomHint'].classList.remove('error');
      }, 2500);
    } else {
      alert(msg);
    }
  }

  _escape(s) {
    return String(s).replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ============================================================
  // SCREEN SWITCHER
  // ============================================================
  show(name) {
    this.currentScreen = name;

    const map = {
      lobby:    this.el['screen-lobby'],
      room:     this.el['screen-room'],
      game:     this.el['screen-game'],
      gameover: this.el['screen-gameover'],
    };

    for (const [key, el] of Object.entries(map)) {
      if (el) el.classList.toggle('show', key === name);
    }

    // ★★★ فعال/غیرفعال کردن joystick های لمسی ★★★
    if (this.app.input && this.app.input.touch) {
      if (name === 'game') {
        this.app.input.touch.activate();
      } else {
        this.app.input.touch.deactivate();
      }
    }

    if (name === 'lobby') {
      this.roomCode = null;
      this.isHost = false;
    }
  }

  showGameOver(world) {
    if (this.el['goScore']) this.el['goScore'].textContent = world.score;
    if (this.el['goWave'])  this.el['goWave'].textContent  = world.wave;
    if (this.el['goKills']) this.el['goKills'].textContent = world.kills;
    setTimeout(() => this.show('gameover'), 600);
  }
}
