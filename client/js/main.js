// ============================================================
// DEADLINE — entry point
// ============================================================

import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { World } from './game/world.js';
import { Renderer } from './game/renderer.js';
import { Screens } from './ui/screens.js';
import { HUD } from './ui/hud.js';
import { Net } from './net.js';
import { RemoteWorld } from './game/remote_world.js';

const app = {
  input: null, audio: null, world: null, renderer: null,
  screens: null, hud: null, canvas: null,
  net: null, remoteWorld: null, mode: 'solo',
  lastTime: 0, running: false, paused: false,
  onStartSolo: null, onHostMulti: null, onJoinMulti: null,
  _multiHandlersSet: false,
};

function boot() {
  console.log('[Boot] Starting...');

  app.canvas = document.getElementById('game');
  if (!app.canvas) return;

  app.input = new Input(app.canvas);
  app.audio = new Audio();
  app.world = new World();
  app.renderer = new Renderer(app.canvas, app.world);
  app.hud = new HUD(app.world);
  app.screens = new Screens(app);
  app.net = new Net();

  // ============ SOLO ============
  app.onStartSolo = (config) => {
    console.log('[Boot] onStartSolo', config);
    app.mode = 'solo';
    try { app.audio.init(); app.audio.startMusic(); } catch (e) {}
    app.world.reset(config);
    app.hud.world = app.world;
    app.renderer.world = app.world;
    app.running = true;
    app.paused = false;
    app.lastTime = performance.now();
    requestAnimationFrame(loop);
  };

  // ============ MULTI ============
  function setupMultiHandlers() {
    if (app._multiHandlersSet) return;
    app._multiHandlersSet = true;

    app.net.on('game_started', () => {
      // ★ mySid رو از socket.id بگیر (همیشه مطمئن‌تره)
      const mySid = (app.net.socket && app.net.socket.id) || app.net.mySid;
      console.log('[Boot] game_started, mySid =', mySid);

      app.mode = 'multi';
      app.remoteWorld = new RemoteWorld(app.net, mySid);

      // ★ username و skin رو از config بگیر
      app.remoteWorld.username = app._pendingName || 'YOU';
      app.remoteWorld.skinKey = app._pendingSkin || 'rookie';

      app.hud.world = app.remoteWorld;
      app.renderer.world = app.remoteWorld;

      app.net.on('state', (data) => {
        try { app.remoteWorld.onSnapshot(data); }
        catch (e) { console.error('[Boot] onSnapshot err', e); }
      });

      try { app.audio.init(); app.audio.startMusic(); } catch (e) {}

      app.running = true;
      app.paused = false;
      app.lastTime = performance.now();
      requestAnimationFrame(loop);
    });
  }

  app.onHostMulti = async (name, skin) => {
    console.log('[Boot] onHostMulti', name, skin);
    app._pendingName = name;
    app._pendingSkin = skin;
    try {
      if (!app.net.connected) await app.net.connect();
    } catch (e) {
      alert('Cannot connect to server.');
      return;
    }
    setupMultiHandlers();
    app.net.createRoom(name, skin);
  };

  app.onJoinMulti = async (name, skin, presetCode) => {
    console.log('[Boot] onJoinMulti', name, skin, presetCode);
    app._pendingName = name;
    app._pendingSkin = skin;
    try {
      if (!app.net.connected) await app.net.connect();
    } catch (e) {
      alert('Cannot connect to server.');
      return;
    }
    let clean = presetCode;
    if (!clean) {
      const input = document.getElementById('join-code');
      clean = input ? input.value.toUpperCase().trim() : '';
    }
    if (!clean || clean.length !== 4) {
      alert('ROOM CODE MUST BE 4 LETTERS');
      return;
    }
    setupMultiHandlers();
    app.net.joinRoom(clean, name, skin);
  };

  app.screens.show('lobby');
  app.screens.populateSkins();
  app.screens.initNet(app.net);

  console.log('[Boot] Ready');
  const params = new URLSearchParams(location.search);
  const autoRoom = params.get('room');
  if (autoRoom && autoRoom.length === 4) {
    setTimeout(() => {
      const name = app.screens._getUsername();
      app.onJoinMulti(name, app.screens.selectedSkin, autoRoom.toUpperCase());
    }, 400);
  }
}

function loop(now) {
  const dt = Math.min(0.05, (now - app.lastTime) / 1000);
  app.lastTime = now;

  if (app.running && !app.paused) {
    const w = app.mode === 'solo' ? app.world : app.remoteWorld;
    if (w) {
      try { w.update(dt, app.input, app.audio); }
      catch (e) { console.error('[Loop] update err', e); }
      try { app.hud.update(); } catch (e) {}
      if (app.mode === 'solo' && w.gameOver && app.running) {
        app.running = false;
        app.audio.suspendMusic();
        app.screens.showGameOver(w);
      }
      let intensity = 0;
      if (w.waveState === 'fighting' || w.waveState === 'spawning') {
        intensity = (w.player && w.player.health < 30) ? 1 : 0.55;
      }
      app.audio.setIntensity(intensity);
    }
  }

  try { app.renderer.render(); }
  catch (e) { console.error('[Loop] render err', e); }

  if (app.running) requestAnimationFrame(loop);
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && app.running && app.screens.currentScreen === 'game') {
    app.paused = !app.paused;
    if (app.paused) app.audio.suspendMusic();
    else {
      app.audio.resumeMusic();
      app.lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }
});

boot();
window.app = app;
