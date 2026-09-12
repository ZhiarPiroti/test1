// ============================================================
// Network layer — Socket.IO client
// ============================================================

export class Net {
    constructor() {
      this.socket = null;
      this.connected = false;
      this.handlers = {};
      this.roomCode = null;
      this.mySid = null;
      this.isHost = false;
      this.playerNames = {};
    }
  
    connect() {
      return new Promise((resolve) => {
        // اگه socket.io client توی HTML نیست، خودت اضافه کن:
        // <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
        this.socket = io();
  
        this.socket.on('connect', () => {
          this.connected = true;
          this.mySid = this.socket.id;
          console.log('[Net] Connected as', this.mySid);
          resolve();
        });
  
        // Proxy همه event ها به handlers
        const events = [
          'room_created', 'room_joined', 'player_joined', 'player_left',
          'game_started', 'join_error', 'error_msg', 'state',
        ];
        for (const ev of events) {
          this.socket.on(ev, (data) => {
            if (ev === 'room_created' || ev === 'room_joined') {
              this.roomCode = data.code;
              this.isHost = data.host === this.mySid;
              this.playerNames = data.players || {};
            }
            if (ev === 'game_started') {
              this.gameStarted = true;
            }
            this._emit(ev, data);
          });
        }
      });
    }
  
    on(event, fn) {
      (this.handlers[event] = this.handlers[event] || []).push(fn);
    }
  
    _emit(event, data) {
      (this.handlers[event] || []).forEach(fn => fn(data));
    }
  
    createRoom(name, skin) {
      this.socket.emit('create_room', { name, skin });
    }
  
    joinRoom(code, name, skin) {
      this.socket.emit('join_room', { code, name, skin });
    }
  
    startGame() {
      this.socket.emit('start_game', { code: this.roomCode });
    }
  
    leaveRoom() {
      if (this.roomCode) {
        this.socket.emit('leave_room', { code: this.roomCode });
        this.roomCode = null;
      }
    }
  
    sendInput(ix, iy, angle, shoot, reload, swap) {
      if (!this.connected) return;
      this.socket.emit('input', {
        ix, iy, a: angle,
        sh: shoot,
        rl: reload || false,
        sw: swap || false,
      });
    }
  }
