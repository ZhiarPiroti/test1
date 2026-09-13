import math
import random
import time

WORLD_W = 900
WORLD_H = 700
TICK_RATE = 30
TICK_DT = 1.0 / TICK_RATE

# ============ CONSTANTS (mirror از JS) ============
SKINS = {
    'rookie': {'hp': 100, 'speed': 95,  'damage_mult': 1.0},
    'medic':  {'hp': 90,  'speed': 100, 'damage_mult': 0.9, 'regen': 1.2},
    'heavy':  {'hp': 150, 'speed': 78,  'damage_mult': 1.15},
    'scout':  {'hp': 75,  'speed': 120, 'damage_mult': 0.95},
}

ZOMBIE_DEFS = {
    'walker': {'hp': 3,  'speed': 62,  'radius': 6,  'damage': 8,  'accel': 400,  'score': 100, 'attack_rate': 0.85},
    'runner': {'hp': 2,  'speed': 112, 'radius': 5,  'damage': 6,  'accel': 900,  'score': 150, 'attack_rate': 0.55},
    'brute':  {'hp': 14, 'speed': 52,  'radius': 10, 'damage': 20, 'accel': 350,  'score': 400, 'attack_rate': 1.3},
}

WEAPONS = {
    'pistol':  {'mag': 12,  'damage': 1.3, 'rate': 0.16, 'reload': 1.0, 'spread': 0.04, 'speed': 400, 'bullets': 1, 'auto': False},
    'shotgun': {'mag': 6,   'damage': 1.0, 'rate': 0.7,  'reload': 1.6, 'spread': 0.28, 'speed': 340, 'bullets': 8, 'auto': False},
    'smg':     {'mag': 30,  'damage': 0.75,'rate': 0.075,'reload': 1.4, 'spread': 0.09, 'speed': 420, 'bullets': 1, 'auto': True},
    'rifle':   {'mag': 8,   'damage': 3.2, 'rate': 0.5,  'reload': 1.8, 'spread': 0.01, 'speed': 550, 'bullets': 1, 'auto': False, 'pierce': 2},
    'lmg':     {'mag': 80,  'damage': 1.1, 'rate': 0.075,'reload': 2.6, 'spread': 0.14, 'speed': 400, 'bullets': 1, 'auto': True},
}


class Entity:
    __slots__ = ('x', 'y', 'vx', 'vy', 'radius', 'def_data', 'hp', 'max_hp',
                 'angle', 'walk_phase', 'attack_cd', 'hit_flash', 'dead', 'dead_time',
                 'type', 'score', 'damage', 'accel', 'speed', 'attack_rate')


class Player:
    __slots__ = ('sid', 'name', 'skin', 'x', 'y', 'vx', 'vy', 'angle', 'hp', 'max_hp',
                 'speed', 'damage_mult', 'regen', 'regen_timer', 'alive',
                 'weapons', 'current_slot', 'reloading', 'shoot_cd',
                 'walk_phase', 'muzzle_flash', 'hit_flash', 'kick',
                 'input_x', 'input_y', 'input_angle', 'input_shoot', 'input_reload',
                 'input_swap', 'last_shoot_state', 'respawn_timer')

    def __init__(self, sid, name, skin):
        s = SKINS.get(skin, SKINS['rookie'])
        self.sid = sid
        self.name = name[:12]
        self.skin = skin
        self.x = WORLD_W / 2 + random.uniform(-60, 60)
        self.y = WORLD_H / 2 + random.uniform(-60, 60)
        self.vx = 0; self.vy = 0
        self.angle = 0
        self.hp = s['hp']
        self.max_hp = s['hp']
        self.speed = s['speed']
        self.damage_mult = s.get('damage_mult', 1.0)
        self.regen = s.get('regen', 0)
        self.regen_timer = 0
        self.alive = True
        self.weapons = [{'type': 'pistol', 'mag': 12}]
        self.current_slot = 0
        self.reloading = 0
        self.shoot_cd = 0
        self.walk_phase = 0
        self.muzzle_flash = 0
        self.hit_flash = 0
        self.kick = 0
        self.input_x = 0; self.input_y = 0; self.input_angle = 0
        self.input_shoot = False; self.input_reload = False; self.input_swap = False
        self.last_shoot_state = False
        self.respawn_timer = 0

    def get_weapon(self):
        return self.weapons[self.current_slot]


class Bullet:
    __slots__ = ('x', 'y', 'vx', 'vy', 'damage', 'pierce', 'life', 'owner', 'hits')
    def __init__(self, x, y, vx, vy, damage, pierce, owner):
        self.x = x; self.y = y
        self.vx = vx; self.vy = vy
        self.damage = damage; self.pierce = pierce
        self.life = 0.8
        self.owner = owner
        self.hits = set()


class Drop:
    __slots__ = ('x', 'y', 'kind', 'payload', 'landed', 't', 'start_y', 'target_y', 'life')
    def __init__(self, x, y, payload, kind):
        self.x = x; self.y = y
        self.target_y = y
        self.start_y = y - 400
        self.y = self.start_y
        self.kind = kind; self.payload = payload
        self.landed = False; self.t = 0
        self.life = 30


class GameState:
    def __init__(self):
        self.players = {}       # sid -> Player
        self.zombies = []
        self.bullets = []
        self.drops = []
        self.events = []        # برای ارسال به کلاینت‌ها (kill, pickup, ...)
        self.wave = 1
        self.wave_state = 'intro'
        self.wave_timer = 1.5
        self.spawns_left = 0
        self.spawn_cd = 0
        self.score = 0
        self.kills = 0
        self.game_over = False
        self.drop_timer = 12
        self._zombie_id = 0

    # ============ PUBLIC API ============
    def add_player(self, sid, name, skin):
        self.players[sid] = Player(sid, name, skin)

    def remove_player(self, sid):
        self.players.pop(sid, None)

    def set_input(self, sid, data):
        p = self.players.get(sid)
        if not p or not p.alive:
            return
        p.input_x = float(data.get('ix', 0))
        p.input_y = float(data.get('iy', 0))
        p.input_angle = float(data.get('a', 0))
        p.input_shoot = bool(data.get('sh', False))
        if data.get('rl'):
            p.input_reload = True
        if data.get('sw'):
            p.input_swap = True

    def update(self, dt):
        if self.game_over:
            return

        self._update_players(dt)
        self._update_zombies(dt)
        self._update_bullets(dt)
        self._update_drops(dt)
        self._update_waves(dt)

    # ============ PLAYERS ============
    def _update_players(self, dt):
        for p in self.players.values():
            if not p.alive:
                p.respawn_timer -= dt
                if p.respawn_timer <= 0:
                    self._respawn_player(p)
                continue

            # Speed cap
            speed_mul = 1.0
            w = p.get_weapon()
            if w and w['type'] == 'lmg':
                speed_mul = 0.55
            max_speed = p.speed * speed_mul

            p.vx += p.input_x * max_speed * 9 * dt
            p.vy += p.input_y * max_speed * 9 * dt
            friction = 0.0008 ** dt
            p.vx *= friction
            p.vy *= friction

            sp = math.hypot(p.vx, p.vy)
            if sp > max_speed:
                p.vx = p.vx / sp * max_speed
                p.vy = p.vy / sp * max_speed

            p.x = max(8, min(WORLD_W - 8, p.x + p.vx * dt))
            p.y = max(8, min(WORLD_H - 8, p.y + p.vy * dt))
            p.walk_phase += math.hypot(p.vx, p.vy) * dt * 0.15
            p.angle = p.input_angle

            # Weapon
            if p.shoot_cd > 0: p.shoot_cd -= dt
            if p.muzzle_flash > 0: p.muzzle_flash -= dt
            if p.hit_flash > 0: p.hit_flash -= dt * 3
            if p.kick > 0: p.kick -= dt * 6

            # Reload
            if p.input_reload:
                p.input_reload = False
                w = p.get_weapon()
                if w and p.reloading <= 0 and w['mag'] < WEAPONS[w['type']]['mag']:
                    p.reloading = WEAPONS[w['type']]['reload']

            if p.reloading > 0:
                p.reloading -= dt
                if p.reloading <= 0:
                    w = p.get_weapon()
                    if w:
                        w['mag'] = WEAPONS[w['type']]['mag']

            # Swap
            if p.input_swap:
                p.input_swap = False
                if len(p.weapons) > 1:
                    p.current_slot = (p.current_slot + 1) % len(p.weapons)
                    p.reloading = 0

            # Shoot
            w = p.get_weapon()
            if w:
                auto = WEAPONS[w['type']]['auto']
                wants = p.input_shoot if auto else (p.input_shoot and not p.last_shoot_state)
                if wants and p.reloading <= 0 and p.shoot_cd <= 0:
                    if w['mag'] > 0:
                        self._fire(p, w)
                    else:
                        p.shoot_cd = 0.3
                p.last_shoot_state = p.input_shoot

            # Regen
            if p.regen > 0:
                p.regen_timer += dt
                if p.regen_timer >= 1:
                    p.regen_timer = 0
                    p.hp = min(p.max_hp, p.hp + p.regen)

    def _fire(self, p, w):
        wdef = WEAPONS[w['type']]
        w['mag'] -= 1
        p.shoot_cd = wdef['rate']
        p.muzzle_flash = 0.06
        p.kick = 1

        gx = p.x + math.cos(p.angle) * 8
        gy = p.y + math.sin(p.angle) * 8

        for _ in range(wdef['bullets']):
            spread = random.uniform(-wdef['spread'], wdef['spread'])
            a = p.angle + spread
            spd = wdef['speed'] * random.uniform(0.92, 1.08)
            self.bullets.append(Bullet(
                gx, gy,
                math.cos(a) * spd, math.sin(a) * spd,
                wdef['damage'] * p.damage_mult,
                wdef.get('pierce', 0),
                p.sid,
            ))

        # recoil
        p.vx -= math.cos(p.angle) * 20
        p.vy -= math.sin(p.angle) * 20

    def _respawn_player(self, p):
        p.alive = True
        p.hp = p.max_hp
        p.x = WORLD_W / 2 + random.uniform(-100, 100)
        p.y = WORLD_H / 2 + random.uniform(-100, 100)
        p.vx = 0; p.vy = 0
        p.reloading = 0
        p.weapons = [{'type': 'pistol', 'mag': 12}]
        p.current_slot = 0

    def _damage_player(self, p, amount):
        if not p.alive:
            return
        p.hp -= amount
        p.hit_flash = 0.3
        if p.hp <= 0:
            p.hp = 0
            p.alive = False
            p.respawn_timer = 4.0
            self.events.append({'type': 'player_died', 'name': p.name})

    # ============ ZOMBIES ============
    def _update_zombies(self, dt):
        # فقط زامبی‌ها به نزدیک‌ترین بازیکن زنده حمله می‌کنن
        alive_players = [p for p in self.players.values() if p.alive]

        for z in self.zombies:
            if z.dead:
                z.dead_time -= dt
                continue

            # نزدیک‌ترین بازیکن
            if not alive_players:
                continue
            target = min(alive_players, key=lambda p: (p.x - z.x) ** 2 + (p.y - z.y) ** 2)

            dx = target.x - z.x
            dy = target.y - z.y
            d = math.hypot(dx, dy) or 1

            z.vx += dx / d * z.accel * dt
            z.vy += dy / d * z.accel * dt

            # Separation
            for o in self.zombies:
                if o is z or o.dead:
                    continue
                ox = z.x - o.x
                oy = z.y - o.y
                od2 = ox * ox + oy * oy
                min_d = z.radius + o.radius
                if 0.01 < od2 < min_d * min_d:
                    od = math.sqrt(od2)
                    f = (min_d - od) / min_d * 150
                    z.vx += ox / od * f * dt
                    z.vy += oy / od * f * dt

            friction = 0.15 ** dt
            z.vx *= friction
            z.vy *= friction

            zs = math.hypot(z.vx, z.vy)
            if zs > z.speed:
                z.vx = z.vx / zs * z.speed
                z.vy = z.vy / zs * z.speed

            z.x = max(0, min(WORLD_W, z.x + z.vx * dt))
            z.y = max(0, min(WORLD_H, z.y + z.vy * dt))
            z.angle = math.atan2(dy, dx)
            z.walk_phase += zs * dt * 0.2

            if z.hit_flash > 0:
                z.hit_flash -= dt * 5

            # Attack
            if z.attack_cd > 0:
                z.attack_cd -= dt
            hit_dist = z.radius + 7
            if d < hit_dist and z.attack_cd <= 0:
                self._damage_player(target, z.damage)
                z.attack_cd = z.attack_rate
                z.vx -= dx / d * 40
                z.vy -= dy / d * 40

        # Cleanup dead
        self.zombies = [z for z in self.zombies if not (z.dead and z.dead_time <= 0)]

    def _spawn_zombie(self, ztype):
        d = ZOMBIE_DEFS[ztype]
        # نزدیک‌ترین بازیکن زنده
        alive = [p for p in self.players.values() if p.alive]
        if not alive:
            return
        base = random.choice(alive)

        angle = random.uniform(0, math.pi * 2)
        dist = random.uniform(240, 400)
        x = max(20, min(WORLD_W - 20, base.x + math.cos(angle) * dist))
        y = max(20, min(WORLD_H - 20, base.y + math.sin(angle) * dist))

        z = Entity()
        z.x = x; z.y = y
        z.vx = 0; z.vy = 0
        z.radius = d['radius']
        z.hp = d['hp']; z.max_hp = d['hp']
        z.type = ztype
        z.angle = 0
        z.walk_phase = random.uniform(0, 10)
        z.attack_cd = 0
        z.hit_flash = 0
        z.dead = False
        z.dead_time = 0
        z.score = d['score']
        z.damage = d['damage']
        z.accel = d['accel']
        z.speed = d['speed']
        z.attack_rate = d['attack_rate']
        self.zombies.append(z)

    def _pick_zombie_type(self):
        r = random.random()
        w = self.wave
        if w >= 5:
            if r < 0.15: return 'brute'
            if r < 0.45: return 'runner'
            return 'walker'
        if w >= 3:
            if r < 0.10: return 'brute'
            if r < 0.40: return 'runner'
            return 'walker'
        if w >= 2:
            if r < 0.35: return 'runner'
            return 'walker'
        return 'walker'

    # ============ BULLETS ============
    def _update_bullets(self, dt):
        for i in range(len(self.bullets) - 1, -1, -1):
            b = self.bullets[i]
            b.x += b.vx * dt
            b.y += b.vy * dt
            b.life -= dt

            hit = False
            for z in self.zombies:
                if z.dead or id(z) in b.hits:
                    continue
                rr = z.radius + 2
                if (b.x - z.x) ** 2 + (b.y - z.y) ** 2 < rr * rr:
                    z.hp -= b.damage
                    z.hit_flash = 1
                    b.hits.add(id(z))
                    if z.hp <= 0:
                        self._kill_zombie(z, b.owner)
                    if b.pierce <= 0:
                        hit = True
                        break
                    b.pierce -= 1

            if b.x < 0 or b.x > WORLD_W or b.y < 0 or b.y > WORLD_H:
                hit = True
            if b.life <= 0:
                hit = True
            if hit:
                self.bullets.pop(i)

    def _kill_zombie(self, z, owner_sid):
        z.dead = True
        z.dead_time = 0.35
        self.kills += 1
        self.score += z.score
        self.events.append({'type': 'kill', 'score': z.score, 'ztype': z.type, 'x': z.x, 'y': z.y})

    # ============ DROPS ============
    def _update_drops(self, dt):
        self.drop_timer -= dt
        if self.drop_timer <= 0:
            self.drop_timer = random.uniform(18, 26)
            self._spawn_drop()

        for i in range(len(self.drops) - 1, -1, -1):
            d = self.drops[i]
            if not d.landed:
                d.t += dt
                t = min(1, d.t / 2.2)
                e = 1 - (1 - t) ** 3
                d.y = d.start_y + (d.target_y - d.start_y) * e
                if t >= 1:
                    d.landed = True
                    d.y = d.target_y
                    self.events.append({'type': 'drop_land', 'x': d.x, 'y': d.y})
            else:
                d.life -= dt
                # pickup by nearest player
                for p in self.players.values():
                    if not p.alive:
                        continue
                    if (p.x - d.x) ** 2 + (p.y - d.y) ** 2 < 14 * 14:
                        self._pickup(p, d)
                        self.drops.pop(i)
                        break
                else:
                    if d.life <= 0:
                        self.drops.pop(i)

    def _spawn_drop(self):
        alive = [p for p in self.players.values() if p.alive]
        if not alive:
            return
        base = random.choice(alive)
        for _ in range(20):
            x = random.uniform(80, WORLD_W - 80)
            y = random.uniform(80, WORLD_H - 80)
            if math.hypot(x - base.x, y - base.y) > 180:
                break

        r = random.random()
        if r < 0.6:
            kind = 'weapon'
            payload = random.choice(['shotgun', 'smg', 'rifle', 'lmg'])
        elif r < 0.85:
            kind = 'ammo'
            payload = 30
        else:
            kind = 'health'
            payload = 40
        self.drops.append(Drop(x, y, payload, kind))

    def _pickup(self, p, d):
        if d.kind == 'weapon':
            new_w = {'type': d.payload, 'mag': WEAPONS[d.payload]['mag']}
            if len(p.weapons) < 2:
                p.weapons.append(new_w)
                p.current_slot = len(p.weapons) - 1
            else:
                p.weapons[p.current_slot] = new_w
            self.events.append({'type': 'pickup', 'name': p.name, 'label': d.payload.upper()})
        elif d.kind == 'ammo':
            for w in p.weapons:
                w['mag'] = WEAPONS[w['type']]['mag']
            self.events.append({'type': 'pickup', 'name': p.name, 'label': '+AMMO'})
        elif d.kind == 'health':
            p.hp = min(p.max_hp, p.hp + d.payload)
            self.events.append({'type': 'pickup', 'name': p.name, 'label': '+HEALTH'})

    # ============ WAVES ============
    def _update_waves(self, dt):
        if self.wave_state == 'intro':
            self.wave_timer -= dt
            if self.wave_timer <= 0:
                self._start_wave(self.wave)
        elif self.wave_state == 'spawning':
            self.spawn_cd -= dt
            if self.spawn_cd <= 0 and self.spawns_left > 0:
                self._spawn_zombie(self._pick_zombie_type())
                self.spawns_left -= 1
                self.spawn_cd = max(0.15, 0.7 - self.wave * 0.03)
            if self.spawns_left <= 0:
                self.wave_state = 'fighting'
        elif self.wave_state == 'fighting':
            alive = sum(1 for z in self.zombies if not z.dead)
            if alive == 0:
                self.wave_state = 'break'
                self.wave_timer = 3.0
                for p in self.players.values():
                    if p.alive:
                        p.hp = min(p.max_hp, p.hp + 20)
        elif self.wave_state == 'break':
            self.wave_timer -= dt
            if self.wave_timer <= 0:
                self._start_wave(self.wave + 1)

    def _start_wave(self, n):
        self.wave = n
        self.wave_state = 'spawning'
        count = int(6 + n * 1.8 + n ** 1.3)
        self.spawns_left = count
        self.spawn_cd = 0
        self.events.append({'type': 'wave_start', 'wave': n})

    # ============ SERIALIZATION ============
    def snapshot(self):
        return {
            't': time.time(),
            'players': [
                {
                    'sid': p.sid, 'n': p.name, 'sk': p.skin,
                    'x': round(p.x, 1), 'y': round(p.y, 1),
                    'a': round(p.angle, 2),
                    'hp': round(p.hp, 1), 'mhp': p.max_hp,
                    'alive': p.alive,
                    'wp': p.get_weapon()['type'] if p.get_weapon() else 'pistol',
                    'mag': p.get_weapon()['mag'] if p.get_weapon() else 0,
                    'rl': round(p.reloading, 2),
                    'mf': round(p.muzzle_flash, 3),
                    'hf': round(p.hit_flash, 2),
                    'wp2': p.walk_phase,
                }
                for p in self.players.values()
            ],
            'zombies': [
                {
                    'id': id(z),
                    'x': round(z.x, 1), 'y': round(z.y, 1),
                    't': z.type,
                    'hp': z.hp, 'mhp': z.max_hp,
                    'a': round(z.angle, 2),
                    'hf': round(z.hit_flash, 2),
                    'dead': z.dead, 'dt': round(z.dead_time, 2),
                    'wp': z.walk_phase,
                }
                for z in self.zombies
            ],
            'bullets': [
                {'x': round(b.x, 1), 'y': round(b.y, 1), 'vx': round(b.vx, 0), 'vy': round(b.vy, 0)}
                for b in self.bullets
            ],
            'drops': [
                {
                    'x': round(d.x, 1), 'y': round(d.y, 1),
                    'k': d.kind, 'p': d.payload,
                    'l': d.landed, 't': round(d.t, 2),
                }
                for d in self.drops
            ],
            'wave': self.wave,
            'ws': self.wave_state,
            'score': self.score,
            'kills': self.kills,
        }