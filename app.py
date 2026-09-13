from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import random
import string
import time
import threading

from game import GameState, TICK_DT

# ============================================================
# APP
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_DIR = os.path.abspath(os.path.join(BASE_DIR, 'client'))

app = Flask(__name__, static_folder=CLIENT_DIR, static_url_path='')
app.config['SECRET_KEY'] = 'deadline-secret-2024'
# async_mode رو مشخص نمی‌کنیم — خودش threading رو انتخاب می‌کنه
socketio = SocketIO(
    app,
    cors_allowed_origins='*',
    async_mode='threading',
    ping_timeout=20,
    ping_interval=10,
    logger=False,
    engineio_logger=False,
)


# ============================================================
# ROOMS
# ============================================================
class Room:
    def __init__(self, code):
        self.code = code
        self.game = GameState()
        self.started = False
        self.running = False
        self.host_sid = None
        self.player_names = {}
        self.skins = {}          # sid -> skin
        self.lock = threading.Lock()

    def add_player(self, sid, name, skin):
        self.player_names[sid] = name
        self.skins[sid] = skin
        if self.host_sid is None:
            self.host_sid = sid
        if self.started:
            self.game.add_player(sid, name, skin)

    def remove_player(self, sid):
        self.player_names.pop(sid, None)
        self.skins.pop(sid, None)
        self.game.remove_player(sid)
        if self.host_sid == sid and self.player_names:
            self.host_sid = next(iter(self.player_names))


rooms = {}
rooms_lock = threading.Lock()


def gen_code():
    with rooms_lock:
        while True:
            code = ''.join(random.choices(string.ascii_uppercase, k=4))
            if code not in rooms:
                return code


def find_room_by_sid(sid):
    for code, room in list(rooms.items()):
        if sid in room.player_names:
            return code, room
    return None, None


# ============================================================
# ROUTES
# ============================================================
@app.route('/')
def index():
    return send_from_directory(CLIENT_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    full = os.path.join(CLIENT_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(CLIENT_DIR, path)
    # SPA fallback
    return send_from_directory(CLIENT_DIR, 'index.html')


# ============================================================
# SOCKET EVENTS
# ============================================================
@socketio.on('connect')
def on_connect():
    print(f'[+] Connected: {request.sid}')


@socketio.on('create_room')
def on_create(data):
    sid = request.sid
    name = (data.get('name') or 'ANON')[:12].upper()
    skin = data.get('skin', 'rookie')

    code = gen_code()
    room = Room(code)
    with rooms_lock:
        rooms[code] = room
    room.add_player(sid, name, skin)
    join_room(code)

    emit('room_created', {
        'code': code,
        'host': sid,
        'players': room.player_names,
        'skins': room.skins,
    })
    print(f'[Room] {code} created by {name}')


@socketio.on('join_room')
def on_join(data):
    sid = request.sid
    name = (data.get('name') or 'ANON')[:12].upper()
    skin = data.get('skin', 'rookie')
    code = (data.get('code') or '').upper().strip()

    room = rooms.get(code)
    if not room:
        emit('join_error', {'msg': 'ROOM NOT FOUND'})
        return
    if len(room.player_names) >= 4:
        emit('join_error', {'msg': 'ROOM FULL'})
        return
    if room.started:
        emit('join_error', {'msg': 'GAME ALREADY STARTED'})
        return

    room.add_player(sid, name, skin)
    join_room(code)

    emit('room_joined', {
        'code': code,
        'host': room.host_sid,
        'players': room.player_names,
        'skins': room.skins,
    }, to=sid)

    emit('player_joined', {
        'sid': sid,
        'name': name,
        'players': room.player_names,
        'skins': room.skins,
    }, to=code, include_self=False)

    print(f'[Room] {code} joined by {name}')


@socketio.on('leave_room')
def on_leave(data):
    sid = request.sid
    code, room = find_room_by_sid(sid)
    if not room:
        return
    room.remove_player(sid)
    leave_room(code)

    if room.player_names:
        emit('player_left', {
            'sid': sid,
            'players': room.player_names,
        }, to=code)
    else:
        with rooms_lock:
            rooms.pop(code, None)
        print(f'[Room] {code} closed (empty)')


@socketio.on('start_game')
def on_start(data):
    sid = request.sid
    code, room = find_room_by_sid(sid)
    if not room:
        return
    if room.host_sid != sid:
        emit('error_msg', {'msg': 'ONLY HOST CAN START'})
        return
    if room.started:
        return

    # همه بازیکن‌ها رو اضافه کن
    for p_sid, name in room.player_names.items():
        room.game.add_player(p_sid, name, room.skins.get(p_sid, 'rookie'))

    room.started = True
    room.running = True

    emit('game_started', {}, to=code)
    print(f'[Room] {code} game started with {len(room.player_names)} players')

    # شروع game loop در thread جدا
    t = threading.Thread(target=game_loop, args=(code,), daemon=True)
    t.start()


@socketio.on('input')
def on_input(data):
    sid = request.sid
    _, room = find_room_by_sid(sid)
    if room and room.started:
        room.game.set_input(sid, data)


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    code, room = find_room_by_sid(sid)
    if not room:
        print(f'[-] Disconnected: {sid}')
        return

    was_started = room.started
    room.remove_player(sid)

    if room.player_names:
        emit('player_left', {
            'sid': sid,
            'players': room.player_names,
        }, to=code)
    else:
        room.running = False
        with rooms_lock:
            rooms.pop(code, None)
        print(f'[Room] {code} closed')

    print(f'[-] Disconnected: {sid} from {code}')


# ============================================================
# GAME LOOP
# ============================================================
def game_loop(code):
    room = rooms.get(code)
    if not room:
        return

    last = time.time()
    print(f'[Loop] Started for room {code}')

    while room.running and code in rooms:
        now = time.time()
        dt = min(0.1, now - last)
        last = now

        try:
            room.game.update(dt)
            snap = room.game.snapshot()
            snap['events'] = room.game.events
            room.game.events = []

            socketio.emit('state', snap, to=code)
        except Exception as e:
            print(f'[Loop] Error in {code}: {e}')

        # Sleep مکمل — threading mode از time.sleep استفاده می‌کنه
        elapsed = time.time() - now
        sleep_time = max(0, TICK_DT - elapsed)
        time.sleep(sleep_time)

    print(f'[Loop] Stopped for room {code}')


# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    
    print('=' * 50)
    print('  DEADLINE SERVER')
    print('=' * 50)
    print(f'  Client dir: {CLIENT_DIR}')
    print(f'  Port: {port}')
    print('=' * 50)
    
    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        debug=False,
        allow_unsafe_werkzeug=True,
    )
