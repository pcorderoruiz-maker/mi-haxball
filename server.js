'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { performance } = require('perf_hooks');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIXED_DT = 1000 / TICK_RATE;

// ───────────────────────── AJUSTES DE JUEGO (toca aquí para afinar) ─────────────────────────
const TUNE = {
  walkSpeed: 2.0,        // velocidad normal
  sprintSpeed: 3.4,      // velocidad con Shift
  kickingSpeed: 1.3,     // velocidad mientras mantienes el chut
  staminaDrain: 0.75,    // gasto de energía por tick al esprintar
  staminaRegen: 0.45,    // recuperación por tick
  kickPower: 5.0,        // fuerza del chut
  kickRange: 29.5,
  ballDamping: 0.983,    // rozamiento de la pelota por tick: es lo que hace que SE PARE sola
  ballStopSpeed: 0.05,   // por debajo de esta velocidad la pelota se detiene del todo
  ballMaxSpeed: 8,
  ballBounce: 0.75,      // rebote contra las bandas
  goalHalf: 65,          // medio alto de la portería
  wideGoalHalf: 91,      // medio alto con la ventaja "portería ancha" (+40 %)
  powerMult: 1.45,       // multiplicador del chut con la ventaja "chute potente"
  celebrationTicks: 180, // 3 s tras un gol
  endTicks: 420          // 7 s mostrando el ganador
};

// ───────────────────────── CLIENTE (se sirve embebido) ─────────────────────────
const CLIENT_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HaxBall Online</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; font-family: 'Segoe UI', system-ui, sans-serif; }
    body { background: #14181d; color: #f1f5f9; height: 100vh; width: 100vw; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }

    .game-wrapper { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 840px; max-width: 96vw; }
    :fullscreen .game-wrapper,
    :-webkit-full-screen .game-wrapper { width: min(94vw, calc((100vh - 90px) * 2)); max-width: 1600px; }

    .scoreboard-bar { display: flex; align-items: center; justify-content: space-between; width: 100%; background: #1e242b; border: 2px solid #2f3844; border-bottom: none; border-radius: 10px 10px 0 0; padding: 8px 18px; }
    .score-group { display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 800; }
    .badge { width: 20px; height: 20px; border-radius: 4px; border: 2px solid #fff; }
    .badge.red { background: #e56e56; }
    .badge.blue { background: #5689e5; }
    .clock-box { display: flex; align-items: baseline; font-family: monospace; font-size: 24px; font-weight: 700; background: #111519; padding: 4px 16px; border-radius: 6px; border: 1px solid #2e3743; }
    .mode-tag { margin-left: 10px; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11px; font-weight: 700; color: #94a3b8; }
    .mode-tag.gold { color: #fbbf24; }

    .right-controls { display: flex; align-items: center; gap: 14px; }
    .stamina-hud { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #cbd5e1; }
    .stamina-bar-bg { width: 70px; height: 10px; background: #0f141a; border-radius: 99px; border: 1px solid #334155; overflow: hidden; }
    .stamina-bar-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); }

    .net-status { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; }
    .dot.online { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .dot.off { background: #ef4444; }

    .fs-btn { background: #283240; color: #f1f5f9; border: 1px solid #3e4c63; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 0.15s; }
    .fs-btn:hover { background: #364457; }

    .stage { position: relative; width: 100%; aspect-ratio: 2 / 1; border: 2px solid #2f3844; border-radius: 0 0 10px 10px; overflow: hidden; box-shadow: 0 18px 45px rgba(0,0,0,0.65); contain: layout paint; }
    canvas#c { display: block; width: 100%; height: 100%; background: #0b0f14; }

    .adv-chip { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: none; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: 800; white-space: nowrap; background: rgba(10,14,20,0.8); border: 2px solid #fff; pointer-events: none; }
    .adv-chip.show { display: block; }
    .adv-chip.red { border-color: #e56e56; }
    .adv-chip.blue { border-color: #5689e5; }

    .goal-banner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; opacity: 0; transition: opacity 0.2s; background: radial-gradient(circle, rgba(0,0,0,0.45) 0%, transparent 70%); }
    .goal-banner.active { opacity: 1; }
    .goal-title { font-size: 52px; font-weight: 900; text-shadow: 0 4px 15px #000; }
    .goal-title.red { color: #e56e56; }
    .goal-title.blue { color: #5689e5; }
    .goal-sub { margin-top: 6px; font-size: 15px; font-weight: 600; background: rgba(15,23,42,0.85); padding: 6px 16px; border-radius: 999px; }
    .goal-adv { margin-top: 8px; font-size: 16px; font-weight: 800; color: #fde68a; text-shadow: 0 2px 8px #000; }

    .lobby { position: absolute; inset: 0; background: rgba(12,16,22,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10; overflow: auto; }
    .lobby.hidden { display: none; }
    .card { width: 340px; background: #181e26; border: 1px solid #334155; border-radius: 12px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
    .card.wide { width: min(660px, 96%); padding: 14px 18px; gap: 10px; }
    .card h1 { font-size: 20px; text-align: center; }
    .input { background: #0f141a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 15px; outline: none; }
    .teams { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .t-btn { padding: 8px; border-radius: 7px; border: 1px solid #334155; background: #161d26; color: #fff; font-weight: 700; cursor: pointer; }
    .t-btn.active[data-team="auto"] { background: #475569; border-color: #fff; }
    .t-btn.active[data-team="red"] { background: #e56e56; border-color: #fff; }
    .t-btn.active[data-team="blue"] { background: #5689e5; border-color: #fff; }
    .join-btn { background: #2ecc71; color: #09130c; font-weight: 800; font-size: 15px; padding: 11px; border: none; border-radius: 8px; cursor: pointer; }
    .footer { margin-top: 10px; font-size: 12px; color: #94a3b8; text-align: center; }
    kbd { background: #262f3d; padding: 2px 6px; border-radius: 4px; border: 1px solid #3e4c63; font-size: 11px; color: #e2e8f0; }

    .setup-note { text-align: center; font-size: 12px; color: #94a3b8; min-height: 15px; }
    .maps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .map-card { display: flex; flex-direction: column; gap: 6px; padding: 6px; background: #161d26; border: 2px solid #334155; border-radius: 10px; cursor: pointer; color: #fff; font-size: 12px; font-weight: 700; transition: border-color 0.12s, background 0.12s; }
    .map-card canvas { display: block; width: 100%; aspect-ratio: 2 / 1; border-radius: 6px; }
    .map-card:hover { border-color: #64748b; }
    .map-card.active { border-color: #fbbf24; background: #222b38; }
    .opts { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .seg { display: flex; border: 1px solid #334155; border-radius: 8px; overflow: hidden; }
    .seg button { padding: 7px 12px; background: #161d26; color: #cbd5e1; border: none; font-size: 13px; font-weight: 700; cursor: pointer; }
    .seg button.active { background: #fbbf24; color: #1a1305; }
    .opt-group { display: flex; align-items: center; gap: 8px; }
    .opt-label { font-size: 12px; color: #94a3b8; font-weight: 600; }
    .chips { display: flex; gap: 6px; }
    .chip { min-width: 38px; padding: 6px 10px; border-radius: 7px; border: 1px solid #334155; background: #161d26; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
    .chip.active { background: #fbbf24; color: #1a1305; border-color: #fbbf24; }
    .readonly .interactive { pointer-events: none; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="game-wrapper" id="gameWrapper">
    <div class="scoreboard-bar">
      <div class="score-group">
        <div class="badge red"></div><span id="sRed">0</span><span>-</span><span id="sBlue">0</span><div class="badge blue"></div>
      </div>

      <div class="clock-box"><span id="clock">00:00</span><span class="mode-tag" id="modeTag"></span></div>

      <div class="right-controls">
        <div class="stamina-hud" title="Energía de Esprint (Shift)">
          <span>⚡</span>
          <div class="stamina-bar-bg"><div class="stamina-bar-fill" id="staminaFill"></div></div>
        </div>
        <div class="net-status"><div class="dot" id="dot"></div><span id="status">Conectando...</span></div>
        <button type="button" class="fs-btn" id="fsBtn">⛶ Pantalla Completa</button>
      </div>
    </div>

    <div class="stage" id="stage">
      <canvas id="c" width="840" height="420"></canvas>
      <div class="adv-chip" id="advChip"></div>
      <div class="goal-banner" id="gBanner">
        <div class="goal-title" id="gTitle"></div>
        <div class="goal-sub" id="gSub"></div>
        <div class="goal-adv" id="gAdv"></div>
      </div>

      <div class="lobby" id="lobby">
        <form class="card" id="form">
          <h1>⚽ HaxBall Online</h1>
          <input type="text" id="nick" class="input" placeholder="Tu nombre..." maxlength="14" required autocomplete="off" />
          <div class="teams">
            <button type="button" class="t-btn active" data-team="auto">Auto</button>
            <button type="button" class="t-btn" data-team="red">Rojo</button>
            <button type="button" class="t-btn" data-team="blue">Azul</button>
          </div>
          <button type="submit" class="join-btn">Entrar a la Cancha</button>
        </form>
      </div>

      <div class="lobby hidden" id="setup">
        <div class="card wide">
          <h1>⚙️ Configurar partida</h1>
          <div class="setup-note" id="hostNote"></div>
          <div class="maps interactive" id="mapCards"></div>
          <div class="opts interactive">
            <div class="seg" id="modeSeg">
              <button type="button" data-mode="0">⏱ Por tiempo</button>
              <button type="button" data-mode="1">⚽ Por goles</button>
            </div>
            <div class="opt-group"><span class="opt-label" id="optLabel"></span><div class="chips" id="chips"></div></div>
          </div>
          <button type="button" class="join-btn" id="startBtn">▶ Empezar partida</button>
        </div>
      </div>
    </div>

    <div class="footer">
      Moverse: <kbd>WASD</kbd> o <kbd>Flechas</kbd> &nbsp;|&nbsp;
      Esprintar (más velocidad): <kbd>Shift</kbd> &nbsp;|&nbsp;
      Chutar: <kbd>Espacio</kbd> o <kbd>X</kbd> &nbsp;|&nbsp;
      Pantalla Completa: <kbd>F</kbd>
    </div>
  </div>

  <script>
  (function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const W = 840, H = 420, L = 70, R = 770, T = 35, B = 385, CX = 420, CY = 210, TAU = Math.PI * 2;
    const TICK_MS = 1000 / 60;
    const BUFFER_TICKS = 3.0; // 50 ms de colchón constante: absorbe cualquier variación de red

    const ADV = [
      { icon: '🥅', name: 'Portería rival más ancha' },
      { icon: '💥', name: 'Chute potente' },
      { icon: '⚡', name: 'Esprint infinito' },
      { icon: '✨', name: 'Gol doble' }
    ];
    const TEAM_NAME = ['ROJO', 'AZUL'];

    const THEMES = [
      { name: 'Sevilla FC', margin: '#7d1319', stripeA: '#4ba857', stripeB: '#42994f', line: '#ffffff', trim: '#e4202c', net: 'rgba(255,255,255,0.32)' },
      { name: 'Real Betis', margin: '#08401f', stripeA: '#168a4a', stripeB: '#49b57d', line: '#ffffff', trim: '#d9b44a', net: 'rgba(255,255,255,0.32)' },
      { name: 'Futurista', margin: '#04060f', stripeA: '#0a1230', stripeB: '#0c1638', line: '#22e6ff', trim: '#ff2bd6', net: 'rgba(34,230,255,0.30)' }
    ];

    const crestImg = [null, null, null];
    let crestVer = 0;
    ['sevilla', 'betis'].forEach((n, i) => {
      const img = new Image();
      img.onload = () => { crestImg[i] = img; crestVer++; paintThumbs(); };
      img.src = '/crest/' + n + '.png';
    });

    function shieldPath(g, cx, y0, w, h) {
      const x0 = cx - w / 2, x1 = cx + w / 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + h * 0.5);
      g.quadraticCurveTo(x1, y0 + h * 0.85, cx, y0 + h);
      g.quadraticCurveTo(x0, y0 + h * 0.85, x0, y0 + h * 0.5);
      g.closePath();
    }
    function crown(g, cx, y, w, h) {
      g.beginPath();
      g.moveTo(cx - w / 2, y + h); g.lineTo(cx - w / 2, y + h * 0.35); g.lineTo(cx - w * 0.25, y + h * 0.65);
      g.lineTo(cx, y); g.lineTo(cx + w * 0.25, y + h * 0.65); g.lineTo(cx + w / 2, y + h * 0.35);
      g.lineTo(cx + w / 2, y + h); g.closePath();
      g.fillStyle = '#f4c542'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#8a6a10'; g.stroke();
    }
    function crestSevilla(g, cx, cy, s) {
      const w = s * 0.76, h = s * 0.86, y0 = cy - h / 2 + s * 0.06;
      shield
