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
  staminaDrain: 0.75,    // gasto de energía por tick al esprintar
  staminaRegen: 0.45,    // recuperación por tick
  kickPower: 5.0,        // fuerza del chut
  kickRange: 29.5,
  ballDamping: 0.983,    // rozamiento de la pelota por tick: hace que se pare sola
  ballStopSpeed: 0.05,   // por debajo de esta velocidad la pelota se detiene del todo
  ballMaxSpeed: 8,
  ballBounce: 0.75,      // rebote contra las bandas
  playerRadius: 15,      // radio normal del jugador
  giantRadius: 22,       // radio con la ventaja "jugadores gigantes"
  goalHalf: 65,          // medio alto de la portería normal
  wideGoalHalf: 91,      // medio alto con la ventaja "portería rival ancha" (+40 %)
  smallGoalHalf: 40,     // medio alto con la ventaja "portería propia blindada" (-40 %)
  powerMult: 1.45,       // multiplicador con la ventaja "chute potente"
  speedMult: 1.30,       // multiplicador con la ventaja "velocidad turbo" (+30 %)
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

    .scoreboard-bar { display: flex; align-items: center; justify-content: space-between; width: 100%; background: #1e242b; border: 2px solid #2f3844; border-bottom: none; border-radius: 10px 10px 0 0; padding: 8px 14px; gap: 8px; }
    .score-group { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; }
    .badge { width: 20px; height: 20px; border-radius: 4px; border: 2px solid #fff; }
    .badge.red { background: #e56e56; }
    .badge.blue { background: #5689e5; }
    .clock-box { display: flex; align-items: baseline; font-family: monospace; font-size: 24px; font-weight: 700; background: #111519; padding: 4px 14px; border-radius: 6px; border: 1px solid #2e3743; }
    .mode-tag { margin-left: 10px; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11px; font-weight: 700; color: #94a3b8; }
    .mode-tag.gold { color: #fbbf24; }

    .right-controls { display: flex; align-items: center; gap: 10px; }
    .stamina-hud { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #cbd5e1; }
    .stamina-bar-bg { width: 64px; height: 10px; background: #0f141a; border-radius: 99px; border: 1px solid #334155; overflow: hidden; }
    .stamina-bar-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); }

    .net-status { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 5px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; }
    .dot.online { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .dot.off { background: #ef4444; }

    .top-btn { background: #283240; color: #f1f5f9; border: 1px solid #3e4c63; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
    .top-btn:hover { background: #364457; }
    .top-btn.spec-active { background: #475569; border-color: #fbbf24; color: #fde68a; }

    .stage { position: relative; width: 100%; aspect-ratio: 2 / 1; border: 2px solid #2f3844; border-radius: 0 0 10px 10px; overflow: hidden; box-shadow: 0 18px 45px rgba(0,0,0,0.65); contain: layout paint; }
    canvas#c { display: block; width: 100%; height: 100%; background: #0b0f14; }

    .adv-chip { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: none; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: 800; white-space: nowrap; background: rgba(10,14,20,0.85); border: 2px solid #fff; pointer-events: none; z-index: 4; }
    .adv-chip.show { display: block; }
    .adv-chip.red { border-color: #e56e56; }
    .adv-chip.blue { border-color: #5689e5; }

    .spec-pill { position: absolute; bottom: 10px; left: 12px; display: none; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: rgba(15,23,42,0.85); border: 1px solid #64748b; color: #e2e8f0; pointer-events: none; z-index: 4; }
    .spec-pill.show { display: block; }

    .goal-banner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; opacity: 0; transition: opacity 0.2s; background: radial-gradient(circle, rgba(0,0,0,0.45) 0%, transparent 70%); }
    .goal-banner.active { opacity: 1; }
    .goal-title { font-size: 52px; font-weight: 900; text-shadow: 0 4px 15px #000; }
    .goal-title.red { color: #e56e56; }
    .goal-title.blue { color: #5689e5; }
    .goal-sub { margin-top: 6px; font-size: 15px; font-weight: 600; background: rgba(15,23,42,0.85); padding: 6px 16px; border-radius: 999px; }
    .goal-adv { margin-top: 8px; font-size: 16px; font-weight: 800; color: #fde68a; text-shadow: 0 2px 8px #000; }

    .lobby { position: absolute; inset: 0; background: rgba(12,16,22,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10; overflow: auto; }
    .lobby.hidden { display: none; }
    .card { width: 370px; background: #181e26; border: 1px solid #334155; border-radius: 12px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
    .card.wide { width: min(660px, 96%); padding: 14px 18px; gap: 10px; }
    .card h1 { font-size: 20px; text-align: center; }
    .input { background: #0f141a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 15px; outline: none; }
    .teams { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .t-btn { padding: 8px 4px; border-radius: 7px; border: 1px solid #334155; background: #161d26; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; }
    .t-btn.active[data-team="auto"] { background: #475569; border-color: #fff; }
    .t-btn.active[data-team="red"] { background: #e56e56; border-color: #fff; }
    .t-btn.active[data-team="blue"] { background: #5689e5; border-color: #fff; }
    .t-btn.active[data-team="spec"] { background: #64748b; border-color: #fbbf24; color: #fde68a; }
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
        <div class="stamina-hud" id="staminaHud" title="Energía de Esprint (Shift)">
          <span>⚡</span>
          <div class="stamina-bar-bg"><div class="stamina-bar-fill" id="staminaFill"></div></div>
        </div>
        <button type="button" class="top-btn" id="specBtn" style="display:none">👁 Espectador</button>
        <div class="net-status"><div class="dot" id="dot"></div><span id="status">Conectando...</span></div>
        <button type="button" class="top-btn" id="fsBtn">⛶ Pantalla Completa</button>
      </div>
    </div>

    <div class="stage" id="stage">
      <canvas id="c" width="840" height="420"></canvas>
      <div class="adv-chip" id="advChip"></div>
      <div class="spec-pill" id="specPill">👁 Modo Espectador (pulsa "⚽ Entrar a Jugar" arriba para saltar al campo)</div>
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
            <button type="button" class="t-btn" data-team="spec">👁 Ver</button>
          </div>
          <button type="submit" class="join-btn">Entrar a la Sala</button>
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
      Esprintar: <kbd>Shift</kbd> &nbsp;|&nbsp;
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
    const BUFFER_TICKS = 2.0;

    // Constantes físicas sincronizadas con el servidor (sin reducción de velocidad al chutar)
    const WALK_SPEED = ${TUNE.walkSpeed};
    const SPRINT_SPEED = ${TUNE.sprintSpeed};
    const SPEED_MULT = ${TUNE.speedMult};
    const PLAYER_R = ${TUNE.playerRadius};
    const GIANT_R = ${TUNE.giantRadius};

    // 7 Ventajas
    const ADV = [
      { icon: '🥅', name: 'Portería rival más ancha' },
      { icon: '💥', name: 'Chute potente' },
      { icon: '⚡', name: 'Esprint infinito' },
      { icon: '✨', name: 'Gol doble' },
      { icon: '🛡️', name: 'Jugadores gigantes' },
      { icon: '🚀', name: 'Velocidad turbo' },
      { icon: '🧱', name: 'Portería propia blindada' }
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
      shieldPath(g, cx, y0, w, h);
      g.fillStyle = '#ffffff'; g.fill();
      g.save(); shieldPath(g, cx, y0, w, h); g.clip();
      g.fillStyle = '#d4202b'; g.fillRect(cx - w / 2, y0 + h * 0.68, w, h);
      g.restore();
      shieldPath(g, cx, y0, w, h);
      g.lineWidth = s * 0.07; g.lineJoin = 'round'; g.strokeStyle = '#d4202b'; g.stroke();
      g.fillStyle = '#d4202b'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'italic 900 ' + Math.round(s * 0.27) + 'px Georgia, serif';
      g.fillText('SFC', cx, y0 + h * 0.38);
      crown(g, cx, y0 - s * 0.17, w * 0.62, s * 0.2);
    }
    function crestBetis(g, cx, cy, s) {
      const r = s * 0.4, yy = cy + s * 0.06;
      g.beginPath(); g.arc(cx, yy, r, 0, TAU); g.fillStyle = '#ffffff'; g.fill();
      g.save(); g.beginPath(); g.arc(cx, yy, r, 0, TAU); g.clip();
      const sw = (2 * r) / 7; g.fillStyle = '#0b8a3c';
      for (let i = 0; i < 7; i += 2) g.fillRect(cx - r + i * sw, yy - r, sw, 2 * r);
      g.restore();
      g.lineWidth = s * 0.06; g.strokeStyle = '#0b6b2e'; g.beginPath(); g.arc(cx, yy, r, 0, TAU); g.stroke();
      g.lineWidth = s * 0.02; g.strokeStyle = '#d9b44a'; g.beginPath(); g.arc(cx, yy, r + s * 0.04, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.94)'; g.fillRect(cx - r * 0.7, yy - r * 0.26, r * 1.4, r * 0.52);
      g.fillStyle = '#0b6b2e'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 ' + Math.round(s * 0.2) + 'px Georgia, serif';
      g.fillText('RBB', cx, yy + 1);
      crown(g, cx, yy - r - s * 0.2, s * 0.34, s * 0.17);
    }
    function drawCrest(g, mi, cx, cy, s) {
      const img = crestImg[mi];
      g.save(); g.globalAlpha = 0.95;
      if (img) {
        const k = (s * 1.05) / Math.max(img.naturalWidth, img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      } else if (mi === 0) crestSevilla(g, cx, cy, s);
      else crestBetis(g, cx, cy, s);
      g.restore();
    }

    function paintLines(g, color, alpha) {
      g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = 3;
      g.strokeRect(L, T, R - L, B - T);
      g.beginPath(); g.moveTo(CX, T); g.lineTo(CX, B); g.stroke();
      g.beginPath(); g.arc(CX, CY, 55, 0, TAU); g.stroke();
      g.strokeRect(L, 100, 105, 220); g.strokeRect(R - 105, 100, 105, 220);
      g.strokeRect(L, 150, 42, 120); g.strokeRect(R - 42, 150, 42, 120);
      g.beginPath(); g.arc(CX, CY, 3.5, 0, TAU); g.fillStyle = color; g.fill();
      g.restore();
    }

    function paintBase(g, mi) {
      const th = THEMES[mi];
      g.fillStyle = th.margin; g.fillRect(0, 0, W, H);
      if (mi === 0) {
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 8; g.beginPath();
        for (let x = -H; x < W; x += 34) { g.moveTo(x, H); g.lineTo(x + H, 0); }
        g.stroke();
      } else if (mi === 1) {
        g.fillStyle = 'rgba(255,255,255,0.07)';
        for (let x = 0; x < W; x += 56) g.fillRect(x, 0, 28, H);
      } else {
        g.strokeStyle = 'rgba(34,230,255,0.09)'; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x < W; x += 14) { g.moveTo(x, 0); g.lineTo(x, H); }
        g.stroke();
      }

      if (mi === 2) {
        const gr = g.createLinearGradient(L, T, R, B);
        gr.addColorStop(0, '#0b1538'); gr.addColorStop(1, '#070d24');
        g.fillStyle = gr; g.fillRect(L, T, R - L, B - T);
        g.fillStyle = 'rgba(80,140,255,0.05)';
        for (let i = 0; i < 10; i += 2) g.fillRect(L + i * 70, T, 70, B - T);
        g.strokeStyle = 'rgba(34,230,255,0.08)'; g.lineWidth = 1; g.beginPath();
        for (let x = L; x <= R; x += 35) { g.moveTo(x, T); g.lineTo(x, B); }
        for (let y = T; y <= B; y += 35) { g.moveTo(L, y); g.lineTo(R, y); }
        g.stroke();
        const rg = g.createRadialGradient(CX, CY, 10, CX, CY, 290);
        rg.addColorStop(0, 'rgba(34,230,255,0.17)'); rg.addColorStop(1, 'rgba(34,230,255,0)');
        g.fillStyle = rg; g.fillRect(L, T, R - L, B - T);
      } else {
        for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? th.stripeB : th.stripeA; g.fillRect(L + i * 70, T, 70, B - T); }
        paintLines(g, th.line, 0.92);
        drawCrest(g, mi, CX, CY, 104);
      }
      g.lineWidth = 4; g.strokeStyle = th.trim; g.strokeRect(5, 5, W - 10, H - 10);
    }

    function paintNeon(g, k) {
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.shadowColor = '#22e6ff'; g.shadowBlur = 12 * k;
      paintLines(g, '#22e6ff', 1);
      g.shadowColor = '#ff2bd6'; g.strokeStyle = '#ff2bd6'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(CX, CY, 28, 0, TAU); g.stroke();
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + 0.5236, x = CX + Math.cos(a) * 16, y = CY + Math.sin(a) * 16;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
      const c = 24; g.lineWidth = 3;
      [[L, T, 1, 1], [R, T, -1, 1], [L, B, 1, -1], [R, B, -1, -1]].forEach((q) => {
        g.beginPath(); g.moveTo(q[0] + q[2] * c, q[1]); g.lineTo(q[0], q[1]); g.lineTo(q[0], q[1] + q[3] * c); g.stroke();
      });
      g.restore();
    }

    function makeNameBadge(text) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 22;
      const g = c.getContext('2d');
      g.font = '700 12px "Segoe UI", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.strokeText(text, 64, 11);
      g.fillStyle = '#ffffff';
      g.fillText(text, 64, 11);
      return c;
    }

    let myId = null, myTeam = 'auto', hostId = 0, team = 'auto', pingMs = 0, lastPingSent = 0, curSt = 2;
    const meta = { sr: 0, sb: 0, lt: null, ln: '', adv: null, gl: 65, gr: 65, map: 0, mode: 0, limit: 10, ot: 0, w: null };
    const roster = new Map();
    const snaps = [];
    const rps = new Map();
    const ball = { x: CX, y: CY };
    const trails = [], fx = [];
    let renderTick = null, frameNo = 0, goalL = 65, goalR = 65;
    let lastT = -1, lastStam = -1, lastSub = '';

    const me = { x: CX, y: CY, st: 100, epoch: -1, active: false };
    const predHist = [];

    const canvas = $('c');
    const ctx = canvas.getContext('2d', { alpha: false });
    const clockEl = $('clock'), modeTag = $('modeTag'), staminaFill = $('staminaFill');
    const statusEl = $('status'), dot = $('dot'), advChip = $('advChip'), nickEl = $('nick');
    const setupEl = $('setup'), startBtn = $('startBtn'), hostNote = $('hostNote'), chipsEl = $('chips'), optLabel = $('optLabel');
    const specBtn = $('specBtn'), specPill = $('specPill'), staminaHud = $('staminaHud');

    const fsBtn = $('fsBtn');
    function toggleFullscreen() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    }
    fsBtn.onclick = () => { toggleFullscreen(); fsBtn.blur(); };
    document.addEventListener('fullscreenchange', () => {
      fsBtn.textContent = document.fullscreenElement ? '✕ Salir' : '⛶ Pantalla Completa';
    });

    specBtn.onclick = () => {
      if (ws.readyState === 1 && myId !== null) {
        const nextTeam = myTeam === 'spec' ? 'auto' : 'spec';
        ws.send(JSON.stringify({ type: 'TEAM', team: nextTeam }));
      }
      specBtn.blur();
    };

    const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host);
    ws.onopen = () => {
      dot.classList.add('online');
      statusEl.textContent = 'Online';
      setInterval(() => {
        if (ws.readyState === 1) {
          lastPingSent = performance.now();
          ws.send('{"type":"PING","ct":' + Math.round(lastPingSent) + '}');
        }
      }, 1000);
    };
    ws.onclose = () => { dot.classList.remove('online'); dot.classList.add('off'); statusEl.textContent = 'Desconectado'; };

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.type) {
        case 'STATE': onState(m); break;
        case 'META':
          Object.assign(meta, m);
          $('sRed').textContent = meta.sr; $('sBlue').textContent = meta.sb;
          updateModeTag(); updateOverlays(); renderSetup();
          break;
        case 'ROSTER':
          roster.clear();
          for (const r of m.p) {
            roster.set(r[0], { name: r[1], team: r[2], badge: makeNameBadge(r[1]) });
            if (r[0] === myId) myTeam = r[2];
          }
          hostId = m.host;
          updateSpecUI();
          renderSetup();
          break;
        case 'JOINED':
          myId = m.playerId;
          myTeam = m.team;
          specBtn.style.display = '';
          updateSpecUI();
          updateOverlays();
          renderSetup();
          break;
        case 'KICK_FX': fx.push({ x: m.x, y: m.y, life: 260 }); break;
        case 'PONG':
          pingMs = Math.round(performance.now() - lastPingSent);
          statusEl.textContent = pingMs + ' ms';
          break;
      }
    };

    function updateSpecUI() {
      const isSpec = myTeam === 'spec';
      specBtn.textContent = isSpec ? '⚽ Entrar a Jugar' : '👁 Modo Espectador';
      specBtn.classList.toggle('spec-active', isSpec);
      specPill.classList.toggle('show', isSpec && curSt !== 2);
      staminaHud.style.display = isSpec ? 'none' : 'flex';
      if (isSpec) me.active = false;
    }

    function reconcileLocalPlayer(pb, epoch) {
      const srvX = pb[1], srvY = pb[2], ackCt = pb[5];
      me.st = pb[4];
      if (me.st !== lastStam) {
        lastStam = me.st;
        staminaFill.style.width = lastStam + '%';
      }

      if (!me.active || epoch !== me.epoch) {
        me.x = srvX; me.y = srvY;
        me.epoch = epoch; me.active = true;
        predHist.length = 0;
        return;
      }

      const targetTime = ackCt > 0 ? ackCt : (performance.now() - pingMs);
      let past = null;
      for (let i = predHist.length - 1; i >= 0; i--) {
        if (predHist[i].t <= targetTime) { past = predHist[i]; break; }
      }
      if (!past && predHist.length) past = predHist[0];
      if (!past) return;

      const errX = srvX - past.x;
      const errY = srvY - past.y;
      const errDist = Math.hypot(errX, errY);

      if (errDist > 75) {
        me.x = srvX; me.y = srvY;
        predHist.length = 0;
      } else if (errDist > 1.8) {
        const cx = errX * 0.28, cy = errY * 0.28;
        me.x += cx; me.y += cy;
        for (let i = 0; i < predHist.length; i++) {
          predHist[i].x += cx;
          predHist[i].y += cy;
        }
      }
    }

    function onState(m) {
      snaps.push({ n: m.n, z: m.z, b: m.b, p: m.p });
      if (snaps.length > 30) snaps.shift();

      if (m.st !== curSt) { curSt = m.st; updateOverlays(); updateSpecUI(); }
      if (m.t !== lastT) { lastT = m.t; clockEl.textContent = fmt(m.t); }
      if (curSt === 1) {
        const txt = 'Gol de ' + meta.ln + ' • Saque en ' + m.rc.toFixed(1) + 's';
        if (txt !== lastSub) { lastSub = txt; $('gSub').textContent = txt; }
      }
      for (let i = 0; i < m.p.length; i++) {
        if (m.p[i][0] === myId) {
          reconcileLocalPlayer(m.p[i], m.z);
          break;
        }
      }
    }

    function fmt(t) {
      return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    }

    function updateModeTag() {
      if (meta.ot) { modeTag.textContent = 'GOL DE ORO'; modeTag.classList.add('gold'); }
      else {
        modeTag.classList.remove('gold');
        modeTag.textContent = meta.mode === 0 ? '⏱ ' + meta.limit + ' min' : '⚽ a ' + meta.limit;
      }
    }

    function fillBanner() {
      const t = $('gTitle'), sub = $('gSub'), adv = $('gAdv');
      if (curSt === 3) {
        const red = meta.w === 'red';
        t.className = 'goal-title ' + (red ? 'red' : 'blue');
        t.textContent = '🏆 ¡GANA ' + (red ? 'ROJO' : 'AZUL') + '!';
        sub.textContent = 'Resultado final ' + meta.sr + ' - ' + meta.sb;
        adv.textContent = '';
      } else if (curSt === 1) {
        const red = meta.lt === 'red';
        t.className = 'goal-title ' + (red ? 'red' : 'blue');
        t.textContent = red ? '¡GOL ROJO!' : '¡GOL AZUL!';
        sub.textContent = 'Gol de ' + meta.ln;
        adv.textContent = meta.adv ? ADV[meta.adv[1]].icon + ' Ventaja ' + TEAM_NAME[meta.adv[0]] + ': ' + ADV[meta.adv[1]].name : '';
      }
    }

    function updateOverlays() {
      const joined = myId !== null;
      $('lobby').classList.toggle('hidden', joined);
      setupEl.classList.toggle('hidden', !(joined && curSt === 2));
      const banner = $('gBanner');
      if (curSt === 1 || curSt === 3) { fillBanner(); banner.classList.add('active'); }
      else banner.classList.remove('active');
      if (meta.adv && curSt === 0) {
        advChip.className = 'adv-chip show ' + (meta.adv[0] === 0 ? 'red' : 'blue');
        advChip.textContent = ADV[meta.adv[1]].icon + ' Ventaja ' + TEAM_NAME[meta.adv[0]] + ': ' + ADV[meta.adv[1]].name;
      } else advChip.className = 'adv-chip';
    }

    const cards = [], thumbs = [];
    THEMES.forEach((th, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'map-card';
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 160;
      const sp = document.createElement('span'); sp.textContent = th.name;
      b.appendChild(cv); b.appendChild(sp);
      b.onclick = (ev) => { meta.map = i; sendConfig(); renderSetup(); ev.currentTarget.blur(); };
      $('mapCards').appendChild(b); cards.push(b); thumbs.push(cv);
    });
    function paintThumbs() {
      thumbs.forEach((cv, i) => {
        const g = cv.getContext('2d');
        g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
        paintBase(g, i);
        if (i === 2) paintNeon(g, cv.width / W);
      });
    }
    paintThumbs();

    const segBtns = Array.from(document.querySelectorAll('#modeSeg button'));
    segBtns.forEach((b) => {
      b.onclick = (ev) => {
        meta.mode = Number(b.dataset.mode);
        meta.limit = meta.mode === 0 ? 10 : 7;
        sendConfig(); renderSetup(); ev.currentTarget.blur();
      };
    });
    startBtn.onclick = (ev) => { if (ws.readyState === 1) ws.send('{"type":"START"}'); ev.currentTarget.blur(); };

    function sendConfig() {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'CONFIG', map: meta.map, mode: meta.mode, limit: meta.limit }));
    }

    function renderSetup() {
      const isHost = myId !== null && myId === hostId;
      setupEl.classList.toggle('readonly', !isHost);
      startBtn.style.display = isHost ? '' : 'none';
      const h = roster.get(hostId);
      hostNote.textContent = isHost
        ? 'Eres el anfitrión: elige campo y duración, y pulsa Empezar.'
        : 'Esperando a que ' + (h ? h.name : 'el anfitrión') + ' empiece la partida…';
      cards.forEach((b, i) => b.classList.toggle('active', i === meta.map));
      segBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.mode) === meta.mode));
      optLabel.textContent = meta.mode === 0 ? 'Duración' : 'Primero en llegar a';
      chipsEl.textContent = '';
      const vals = meta.mode === 0 ? [5, 10, 15] : [5, 6, 7, 8, 9, 10];
      vals.forEach((v) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip' + (v === meta.limit ? ' active' : '');
        b.textContent = meta.mode === 0 ? v + ' min' : String(v);
        b.onclick = (ev) => { meta.limit = v; sendConfig(); renderSetup(); ev.currentTarget.blur(); };
        chipsEl.appendChild(b);
      });
    }

    document.querySelectorAll('.t-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.t-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        team = btn.dataset.team;
      };
    });
    $('form').onsubmit = (e) => {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'JOIN', name: nickEl.value, team }));
    };

    const NEG_X = ['KeyA', 'ArrowLeft'], POS_X = ['KeyD', 'ArrowRight'];
    const NEG_Y = ['KeyW', 'ArrowUp'], POS_Y = ['KeyS', 'ArrowDown'];
    const KICK = ['Space', 'KeyX'], SPRINT = ['ShiftLeft', 'ShiftRight'];
    const GAME_KEYS = new Set([].concat(NEG_X, POS_X, NEG_Y, POS_Y, KICK, SPRINT));
    const down = Object.create(null);
    let seq = 0;
    const cur = { x: 0, y: 0, k: 0, s: 0 };

    function newest(codes) {
      let v = 0;
      for (let i = 0; i < codes.length; i++) { const d = down[codes[i]] || 0; if (d > v) v = d; }
      return v;
    }
    function axis(neg, pos) {
      const a = newest(neg), b = newest(pos);
      return a === b ? 0 : (b > a ? 1 : -1);
    }
    function pushInput() {
      const x = axis(NEG_X, POS_X), y = axis(NEG_Y, POS_Y);
      const k = newest(KICK) ? 1 : 0, s = newest(SPRINT) ? 1 : 0;
      if (x === cur.x && y === cur.y && k === cur.k && s === cur.s) return;
      cur.x = x; cur.y = y; cur.k = k; cur.s = s;
      if (ws.readyState === 1) {
        ws.send('{"type":"INPUT","x":' + x + ',"y":' + y + ',"k":' + k + ',"s":' + s + ',"ct":' + Math.round(performance.now()) + '}');
      }
    }
    window.addEventListener('keydown', (e) => {
      if (document.activeElement === nickEl) return;
      if (e.code === 'KeyF') { if (!e.repeat) toggleFullscreen(); return; }
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (e.repeat || down[e.code]) return;
      down[e.code] = ++seq;
      pushInput();
    });
    window.addEventListener('keyup', (e) => {
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (down[e.code]) { delete down[e.code]; pushInput(); }
    });
    window.addEventListener('blur', () => { for (const k in down) delete down[k]; pushInput(); });

    function hasAdv(teamName, advIndex) {
      if (!meta.adv || curSt !== 0) return false;
      const tIdx = teamName === 'red' ? 0 : 1;
      return meta.adv[0] === tIdx && meta.adv[1] === advIndex;
    }

    function stepLocalPrediction(ts, dt) {
      if (!me.active || myTeam === 'spec') return;
      const dtTicks = dt / TICK_MS;
      const moving = cur.x !== 0 || cur.y !== 0;
      const infStam = hasAdv(myTeam, 2);
      const turbo = hasAdv(myTeam, 5);
      const isGiant = hasAdv(myTeam, 4);
      const rad = isGiant ? GIANT_R : PLAYER_R;

      // Sin reducción de velocidad al chutar (puedes caminar y esprintar mientras chutas)
      const sprinting = cur.s && moving && (me.st > 0 || infStam);
      let speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
      if (turbo) speed *= SPEED_MULT;

      if (moving) {
        const diag = (cur.x !== 0 && cur.y !== 0) ? 0.70710678 : 1;
        me.x += cur.x * speed * diag * dtTicks;
        me.y += cur.y * speed * diag * dtTicks;
      }

      const posts = [
        [L, CY - meta.gl], [L, CY + meta.gl],
        [R, CY - meta.gr], [R, CY + meta.gr]
      ];
      for (let i = 0; i < 4; i++) {
        const dx = me.x - posts[i][0], dy = me.y - posts[i][1];
        const dSq = dx * dx + dy * dy, min = rad + 8;
        if (dSq < min * min && dSq > 0) {
          const d = Math.sqrt(dSq);
          me.x = posts[i][0] + (dx / d) * min;
          me.y = posts[i][1] + (dy / d) * min;
        }
      }
      me.x = Math.max(rad, Math.min(W - rad, me.x));
      me.y = Math.max(rad, Math.min(H - rad, me.y));

      predHist.push({ t: ts, x: me.x, y: me.y });
      while (predHist.length > 90) predHist.shift();

      let rp = rps.get(myId);
      if (!rp) { rp = { id: myId, x: me.x, y: me.y, f: 0, st: me.st, ta: 0, mark: 0 }; rps.set(myId, rp); }
      rp.x = me.x;
      rp.y = me.y;
      rp.f = (cur.k ? 1 : 0) | (sprinting ? 2 : 0);
      rp.st = me.st;
      rp.mark = frameNo + 1;
    }

    function interpolate(ts, dt) {
      const n = snaps.length;
      if (!n) return;
      const last = snaps[n - 1];
      const targetTick = last.n - BUFFER_TICKS;

      if (renderTick === null || Math.abs(targetTick - renderTick) > 8) {
        renderTick = targetTick;
      } else {
        const drift = targetTick - renderTick;
        renderTick += (dt / TICK_MS) + drift * 0.03;
        if (renderTick > last.n) renderTick = last.n;
      }

      let a, b, k = 0;
      if (n === 1 || renderTick >= last.n) {
        a = b = last;
      } else if (renderTick <= snaps[0].n) {
        a = b = snaps[0];
      } else {
        let i = n - 1;
        while (i > 0 && snaps[i - 1].n > renderTick) i--;
        a = snaps[i - 1]; b = snaps[i];
        const span = b.n - a.n;
        k = span > 0 ? (renderTick - a.n) / span : 0;
      }
      if (a.z !== b.z) { a = b; k = 0; }

      ball.x = a.b[0] + (b.b[0] - a.b[0]) * k;
      ball.y = a.b[1] + (b.b[1] - a.b[1]) * k;

      stepLocalPrediction(ts, dt);

      frameNo++;
      for (let i = 0; i < b.p.length; i++) {
        const pb = b.p[i];
        const id = pb[0];
        if (id === myId && me.active && myTeam !== 'spec') {
          const myRp = rps.get(myId);
          if (myRp) myRp.mark = frameNo;
          continue;
        }
        let pa = pb;
        if (a !== b) for (let j = 0; j < a.p.length; j++) if (a.p[j][0] === id) { pa = a.p[j]; break; }
        let rp = rps.get(id);
        if (!rp) { rp = { id, x: pb[1], y: pb[2], f: 0, st: 100, ta: 0, mark: 0 }; rps.set(id, rp); }
        rp.x = pa[1] + (pb[1] - pa[1]) * k;
        rp.y = pa[2] + (pb[2] - pa[2]) * k;
        rp.f = pb[3]; rp.st = pb[4]; rp.mark = frameNo;
      }
      for (const entry of rps) if (entry[1].mark !== frameNo) rps.delete(entry[0]);
    }

    let fieldCv = null, glowCv = null, fMap = -1, fCrest = -1;

    function rebuildField(mi) {
      fieldCv = document.createElement('canvas'); fieldCv.width = W; fieldCv.height = H;
      const g = fieldCv.getContext('2d', { alpha: false });
      paintBase(g, mi);
      glowCv = null;
      if (mi === 2) {
        glowCv = document.createElement('canvas'); glowCv.width = W; glowCv.height = H;
        const g2 = glowCv.getContext('2d');
        paintNeon(g2, 1);
      }
      fMap = mi; fCrest = crestVer;
    }

    function drawGoal(left, half, th) {
      const x0 = left ? 28 : R, w = 42, y0 = CY - half, h = half * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = th.net; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = x0 + 7; x < x0 + w; x += 7) { ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); }
      for (let y = y0 + 8; y < y0 + h; y += 8) { ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); }
      ctx.stroke();
      ctx.strokeStyle = th.line; ctx.lineWidth = 3; ctx.strokeRect(x0, y0, w, h);
    }
    function drawPost(x, y, c) {
      ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU);
      ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
    }

    function draw(ts, dt) {
      const mi = meta.map;
      if (fMap !== mi || fCrest !== crestVer) rebuildField(mi);
      const th = THEMES[mi];

      ctx.drawImage(fieldCv, 0, 0);
      if (glowCv) { ctx.globalAlpha = 0.62 + 0.38 * Math.sin(ts / 650); ctx.drawImage(glowCv, 0, 0); ctx.globalAlpha = 1; }

      const kk = 1 - Math.exp(-dt / 110);
      goalL += (meta.gl - goalL) * kk; goalR += (meta.gr - goalR) * kk;
      drawGoal(true, goalL, th); drawGoal(false, goalR, th);
      drawPost(L, CY - goalL, '#ef4444'); drawPost(L, CY + goalL, '#ef4444');
      drawPost(R, CY - goalR, '#3b82f6'); drawPost(R, CY + goalR, '#3b82f6');

      ctx.fillStyle = '#fbbf24';
      for (let i = trails.length - 1; i >= 0; i--) {
        const s = trails[i];
        s.life -= dt;
        if (s.life <= 0) { trails[i] = trails[trails.length - 1]; trails.pop(); continue; }
        const f = s.life / 300;
        ctx.globalAlpha = 0.45 * f;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.55 + 0.45 * f), 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      for (let i = fx.length - 1; i >= 0; i--) {
        const s = fx[i];
        s.life -= dt;
        if (s.life <= 0) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }
        const f = s.life / 260;
        ctx.globalAlpha = f;
        ctx.beginPath(); ctx.arc(s.x, s.y, 12 + (1 - f) * 18, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const p of rps.values()) {
        const info = roster.get(p.id);
        if (!info || info.team === 'spec') continue;
        const kicking = p.f & 1, sprinting = p.f & 2;
        const isGiant = hasAdv(info.team, 4);
        const rad = isGiant ? GIANT_R : PLAYER_R;

        if (sprinting) {
          p.ta += dt;
          while (p.ta >= 28) { p.ta -= 28; if (trails.length < 160) trails.push({ x: p.x, y: p.y, r: rad - 2, life: 300 }); }
        } else p.ta = 0;

        if (p.id === myId) {
          ctx.beginPath(); ctx.arc(p.x, p.y, rad + 6, 0, TAU);
          ctx.strokeStyle = sprinting ? 'rgba(251,191,36,0.75)' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 2.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU);
        ctx.fillStyle = info.team === 'red' ? '#e56e56' : '#5689e5'; ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = kicking ? '#ffffff' : (sprinting ? '#fbbf24' : '#111111');
        ctx.stroke();

        ctx.drawImage(info.badge, p.x - 64, p.y + rad + 2);

        if (p.st < 100) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - 14, p.y + rad + 19, 28, 4);
          ctx.fillStyle = '#fbbf24'; ctx.fillRect(p.x - 14, p.y + rad + 19, (28 * p.st) / 100, 4);
        }
      }

      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(ball.x + 2, ball.y + 5, 9, 4, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ball.x, ball.y, 10, 0, TAU);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; ctx.stroke();
    }

    let lastTs = 0;
    function frame(ts) {
      requestAnimationFrame(frame);
      const dt = lastTs ? Math.min(50, ts - lastTs) : 16.666;
      lastTs = ts;
      interpolate(ts, dt);
      draw(ts, dt);
    }
    requestAnimationFrame(frame);
  })();
  </script>
</body>
</html>`;

// ───────────────────────── FÍSICAS DEL SERVIDOR ─────────────────────────
const CX = 420, CY = 210, L = 70, R = 770, T = 35, B = 385;
const ADV_IDS = ['wide', 'power', 'stamina', 'double', 'giant', 'speed', 'smallgoal'];
const TIMES = [5, 10, 15];

class Disc {
  constructor(x, y, radius, invMass, damping, restitution) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.radius = radius; this.invMass = invMass; this.damping = damping; this.restitution = restitution;
  }
  integrate() {
    if (!this.invMass) return;
    this.x += this.vx; this.y += this.vy;
    if (this.damping < 1) { this.vx *= this.damping; this.vy *= this.damping; }
  }
}

const players = new Map();
let allList = [];
let plist = [];
let nextId = 1;

function rebuildList() {
  allList = Array.from(players.values());
  plist = allList.filter((p) => p.team === 'red' || p.team === 'blue');
}
const hostId = () => (allList.length ? allList[0].id : 0);

const ball = new Disc(CX, CY, 10, 1.0, TUNE.ballDamping, 0.82);
const posts = [
  new Disc(L, CY - TUNE.goalHalf, 8, 0, 1, 0.85), new Disc(L, CY + TUNE.goalHalf, 8, 0, 1, 0.85),
  new Disc(R, CY - TUNE.goalHalf, 8, 0, 1, 0.85), new Disc(R, CY + TUNE.goalHalf, 8, 0, 1, 0.85)
];
const goals = { l: TUNE.goalHalf, r: TUNE.goalHalf };

const cfg = { map: 0, mode: 0, limit: 10 };
const match = {
  state: 2, // 0 jugando · 1 celebración de gol · 2 configuración · 3 fin de partida
  score: { red: 0, blue: 0 }, ticks: 0, resetTicks: 0, endTicks: 0, overtime: false,
  lastScorerTeam: null, lastScorerName: '', lastTouch: '', winner: null,
  adv: null, nextAdv: null, lastAdvId: null
};
let tick = 0, epoch = 0;

function collide(d1, d2) {
  const tm = d1.invMass + d2.invMass;
  if (!tm) return false;
  const dx = d2.x - d1.x, dy = d2.y - d1.y, dSq = dx * dx + dy * dy, min = d1.radius + d2.radius;
  if (dSq >= min * min) return false;
  const d = Math.sqrt(dSq);
  const nx = d === 0 ? 1 : dx / d, ny = d === 0 ? 0 : dy / d, ov = min - d;
  d1.x -= nx * ov * (d1.invMass / tm); d1.y -= ny * ov * (d1.invMass / tm);
  d2.x += nx * ov * (d2.invMass / tm); d2.y += ny * ov * (d2.invMass / tm);
  const vn = (d2.vx - d1.vx) * nx + (d2.vy - d1.vy) * ny;
  if (vn > 0) return true;
  const j = -(1 + Math.min(d1.restitution, d2.restitution)) * vn / tm;
  d1.vx -= j * nx * d1.invMass; d1.vy -= j * ny * d1.invMass;
  d2.vx += j * nx * d2.invMass; d2.vy += j * ny * d2.invMass;
  return true;
}

function slot(team, idx) {
  const offY = idx === 0 ? 0 : (idx % 2 === 1 ? -55 : 55) * Math.ceil(idx / 2);
  return [team === 'red' ? CX - 150 : CX + 150, CY + offY];
}

function syncPlayerSizes() {
  const a = match.adv;
  for (let i = 0; i < allList.length; i++) {
    const p = allList[i];
    const isGiant = a !== null && a.id === 'giant' && a.team === p.team;
    p.disc.radius = isGiant ? TUNE.giantRadius : TUNE.playerRadius;
  }
}

function resetPositions() {
  epoch++;
  ball.x = CX; ball.y = CY; ball.vx = 0; ball.vy = 0;
  let r = 0, b = 0;
  for (const p of plist) {
    const pos = slot(p.team, p.team === 'red' ? r++ : b++);
    p.disc.vx = 0; p.disc.vy = 0; p.disc.x = pos[0]; p.disc.y = pos[1];
    p.stamina = 100;
  }
}

function layoutGoals() {
  posts[0].y = CY - goals.l; posts[1].y = CY + goals.l;
  posts[2].y = CY - goals.r; posts[3].y = CY + goals.r;
}

function applyGoals() {
  goals.l = goals.r = TUNE.goalHalf;
  const a = match.adv;
  if (a) {
    if (a.id === 'wide') {
      if (a.team === 'red') goals.r = TUNE.wideGoalHalf; else goals.l = TUNE.wideGoalHalf;
    } else if (a.id === 'smallgoal') {
      if (a.team === 'red') goals.l = TUNE.smallGoalHalf; else goals.r = TUNE.smallGoalHalf;
    }
  }
  layoutGoals();
  syncPlayerSizes();
}

function pickAdvantage(team) {
  let i;
  do { i = (Math.random() * ADV_IDS.length) | 0; } while (ADV_IDS[i] === match.lastAdvId);
  match.lastAdvId = ADV_IDS[i];
  return { team, id: ADV_IDS[i] };
}

function clockSeconds() {
  if (cfg.mode === 0) return match.overtime ? 0 : Math.max(0, Math.ceil((cfg.limit * 3600 - match.ticks) / 60));
  return Math.floor(match.ticks / 60);
}

function metaJSON() {
  const a = match.adv || match.nextAdv;
  return JSON.stringify({
    type: 'META', sr: match.score.red, sb: match.score.blue,
    lt: match.lastScorerTeam, ln: match.lastScorerName,
    adv: a ? [a.team === 'red' ? 0 : 1, ADV_IDS.indexOf(a.id)] : null,
    gl: goals.l, gr: goals.r, map: cfg.map, mode: cfg.mode, limit: cfg.limit,
    ot: match.overtime ? 1 : 0, w: match.winner
  });
}
const rosterJSON = () => JSON.stringify({ type: 'ROSTER', host: hostId(), p: allList.map((p) => [p.id, p.name, p.team]) });
const sendMeta = () => broadcast(metaJSON());

function resetMatchData() {
  match.score.red = match.score.blue = 0;
  match.ticks = 0; match.overtime = false; match.winner = null;
  match.lastScorerTeam = null; match.lastScorerName = ''; match.lastTouch = '';
  match.adv = match.nextAdv = null; match.lastAdvId = null;
  applyGoals(); resetPositions();
}
function toSetup() { resetMatchData(); match.state = 2; sendMeta(); }
function startMatch() { resetMatchData(); match.state = 0; sendMeta(); }

function endMatch(winner) {
  match.state = 3; match.endTicks = TUNE.endTicks; match.winner = winner;
  match.adv = match.nextAdv = null;
  syncPlayerSizes();
  sendMeta();
}

function kickoff() {
  match.adv = match.nextAdv; match.nextAdv = null; match.lastTouch = '';
  applyGoals(); resetPositions();
  match.state = 0;
  sendMeta();
}

function goalScored(teamName) {
  const other = teamName === 'red' ? 'blue' : 'red';
  const a = match.adv;
  match.score[teamName] += (a && a.id === 'double' && a.team === teamName) ? 2 : 1;
  match.lastScorerTeam = teamName;
  match.lastScorerName = match.lastTouch || (teamName === 'red' ? 'Rojo' : 'Azul');
  match.adv = null;
  syncPlayerSizes();
  if (match.overtime || (cfg.mode === 1 && match.score[teamName] >= cfg.limit)) { endMatch(teamName); return; }
  match.state = 1; match.resetTicks = TUNE.celebrationTicks;
  match.nextAdv = pickAdvantage(other);
  sendMeta();
}

function timeUp() {
  if (match.score.red !== match.score.blue) endMatch(match.score.red > match.score.blue ? 'red' : 'blue');
  else { match.overtime = true; sendMeta(); }
}

function stepPhysics() {
  tick++;
  const adv = match.adv;

  for (let i = 0; i < plist.length; i++) {
    const p = plist[i], d = p.disc;
    if (!p.ik) { p.canKick = true; p.kicking = false; }
    else if (p.canKick) p.kicking = true;

    const moving = p.ix !== 0 || p.iy !== 0;
    const infStamina = adv !== null && adv.id === 'stamina' && adv.team === p.team;
    const hasTurbo = adv !== null && adv.id === 'speed' && adv.team === p.team;

    // Sin bloqueo de esprint ni reducción de velocidad al mantener pulsado chutar
    if (p.is && moving && (p.stamina > 0 || infStamina)) {
      p.sprinting = true;
      p.stamina = infStamina ? 100 : Math.max(0, p.stamina - TUNE.staminaDrain);
    } else {
      p.sprinting = false;
      if (!p.is) p.stamina = Math.min(100, p.stamina + TUNE.staminaRegen);
    }

    let speed = p.sprinting ? TUNE.sprintSpeed : TUNE.walkSpeed;
    if (hasTurbo) speed *= TUNE.speedMult;

    const k = (p.ix !== 0 && p.iy !== 0) ? 0.70710678 : 1;
    d.vx = p.ix * speed * k;
    d.vy = p.iy * speed * k;

    const maxKickDist = d.radius + ball.radius + 4.5;
    if (p.kicking && p.canKick) {
      const dx = ball.x - d.x, dy = ball.y - d.y, dist = Math.hypot(dx, dy);
      if (dist <= maxKickDist && dist > 0) {
        const power = TUNE.kickPower * (adv !== null && adv.id === 'power' && adv.team === p.team ? TUNE.powerMult : 1);
        ball.vx += (dx / dist) * power; ball.vy += (dy / dist) * power;
        p.canKick = false; p.kicking = false; match.lastTouch = p.name;
        broadcast('{"type":"KICK_FX","x":' + Math.round(ball.x) + ',"y":' + Math.round(ball.y) + '}');
      }
    }
    d.integrate();
  }
  ball.integrate();

  for (let i = 0; i < plist.length; i++) {
    const di = plist[i].disc;
    for (let j = i + 1; j < plist.length; j++) collide(di, plist[j].disc);
    if (collide(di, ball)) match.lastTouch = plist[i].name;
    for (let q = 0; q < 4; q++) collide(di, posts[q]);
    di.x = Math.max(di.radius, Math.min(840 - di.radius, di.x));
    di.y = Math.max(di.radius, Math.min(420 - di.radius, di.y));
  }
  for (let q = 0; q < 4; q++) collide(ball, posts[q]);

  const lt = CY - goals.l, lb = CY + goals.l, rt = CY - goals.r, rb = CY + goals.r;
  if (ball.x < L) {
    if (ball.y - 10 < lt) { ball.y = lt + 10; ball.vy *= -0.3; }
    if (ball.y + 10 > lb) { ball.y = lb - 10; ball.vy *= -0.3; }
    if (ball.x - 10 < 28) { ball.x = 38; ball.vx *= -0.3; }
  } else if (ball.x > R) {
    if (ball.y - 10 < rt) { ball.y = rt + 10; ball.vy *= -0.3; }
    if (ball.y + 10 > rb) { ball.y = rb - 10; ball.vy *= -0.3; }
    if (ball.x + 10 > 812) { ball.x = 802; ball.vx *= -0.3; }
  } else {
    if (ball.y - 10 < T) { ball.y = T + 10; ball.vy *= -TUNE.ballBounce; }
    if (ball.y + 10 > B) { ball.y = B - 10; ball.vy *= -TUNE.ballBounce; }
    if (!(ball.y > lt && ball.y < lb) && ball.x - 10 < L) { ball.x = L + 10; ball.vx *= -TUNE.ballBounce; }
    if (!(ball.y > rt && ball.y < rb) && ball.x + 10 > R) { ball.x = R - 10; ball.vx *= -TUNE.ballBounce; }
  }

  const sp2 = ball.vx * ball.vx + ball.vy * ball.vy;
  if (sp2 < TUNE.ballStopSpeed * TUNE.ballStopSpeed) { ball.vx = 0; ball.vy = 0; }
  else if (sp2 > TUNE.ballMaxSpeed * TUNE.ballMaxSpeed) {
    const s = TUNE.ballMaxSpeed / Math.sqrt(sp2); ball.vx *= s; ball.vy *= s;
  }

  switch (match.state) {
    case 0:
      if (plist.length) match.ticks++;
      if (ball.x + 10 < L) goalScored('blue');
      else if (ball.x - 10 > R) goalScored('red');
      else if (cfg.mode === 0 && !match.overtime && match.ticks >= cfg.limit * 3600) timeUp();
      break;
    case 1: if (--match.resetTicks <= 0) kickoff(); break;
    case 3: if (--match.endTicks <= 0) toSetup(); break;
  }
}

// ───────────────────────── RED ─────────────────────────
const HTML_BUF = Buffer.from(CLIENT_HTML, 'utf8');
const HTML_GZ = zlib.gzipSync(HTML_BUF, { level: 9 });
const CREST_NAMES = new Set(['sevilla.png', 'betis.png']);
const crestCache = new Map();

const httpServer = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/crest/')) {
    const name = url.slice(7);
    if (!CREST_NAMES.has(name)) { res.writeHead(404); res.end(); return; }
    const hit = crestCache.get(name);
    const send = (buf) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }); res.end(buf); };
    if (hit) { send(hit); return; }
    fs.readFile(path.join(__dirname, 'crests', name), (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      crestCache.set(name, buf); send(buf);
    });
    return;
  }
  const gz = (req.headers['accept-encoding'] || '').includes('gzip');
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  res.end(gz ? HTML_GZ : HTML_BUF);
});

httpServer.on('connection', (socket) => {
  socket.setNoDelay(true);
});

const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false, maxPayload: 2048 });

function broadcast(data, droppable) {
  for (const c of wss.clients) {
    if (c.readyState !== WebSocket.OPEN) continue;
    if (droppable && c.bufferedAmount > 65536) continue;
    c.send(data);
  }
}

function chooseTeam(pref) {
  if (pref === 'spec' || pref === 'red' || pref === 'blue') return pref;
  let red = 0, blue = 0;
  for (const pl of plist) pl.team === 'red' ? red++ : blue++;
  return red <= blue ? 'red' : 'blue';
}

const r1 = (v) => Math.round(v * 10) / 10;
function buildState() {
  let s = '{"type":"STATE","n":' + tick + ',"z":' + epoch + ',"st":' + match.state + ',"t":' + clockSeconds()
    + ',"rc":' + (match.state === 1 ? (match.resetTicks / 60).toFixed(1) : 0)
    + ',"b":[' + r1(ball.x) + ',' + r1(ball.y) + '],"p":[';
  for (let i = 0; i < plist.length; i++) {
    const p = plist[i];
    const ack = p.baseCt > 0 ? Math.round(p.baseCt + (tick - p.baseTick) * FIXED_DT) : 0;
    s += (i ? ',[' : '[') + p.id + ',' + r1(p.disc.x) + ',' + r1(p.disc.y) + ','
      + ((p.kicking ? 1 : 0) | (p.sprinting ? 2 : 0)) + ',' + Math.round(p.stamina) + ',' + ack + ']';
  }
  return s + ']}';
}

wss.on('connection', (ws, req) => {
  if (req && req.socket) req.socket.setNoDelay(true);
  const id = nextId++;
  let p = null;
  ws.send(metaJSON());
  ws.send(rosterJSON());

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'PING') {
        if (p && typeof m.ct === 'number') { p.baseCt = m.ct; p.baseTick = tick; }
        ws.send('{"type":"PONG"}');
      } else if (m.type === 'INPUT' && p) {
        p.ix = m.x > 0 ? 1 : (m.x < 0 ? -1 : 0);
        p.iy = m.y > 0 ? 1 : (m.y < 0 ? -1 : 0);
        p.ik = m.k ? 1 : 0;
        p.is = m.s ? 1 : 0;
        if (typeof m.ct === 'number') { p.baseCt = m.ct; p.baseTick = tick; }
      } else if (m.type === 'JOIN' && !p) {
        const team = chooseTeam(m.team);
        let red = 0, blue = 0;
        for (const pl of plist) pl.team === 'red' ? red++ : blue++;
        const pos = team === 'spec' ? [CX, CY] : slot(team, team === 'red' ? red : blue);
        p = {
          id,
          name: String(m.name || '').trim().slice(0, 14) || ('Player ' + id),
          team,
          disc: new Disc(pos[0], pos[1], TUNE.playerRadius, 0.5, 1.0, 0.5),
          ix: 0, iy: 0, ik: 0, is: 0,
          canKick: true, kicking: false, sprinting: false, stamina: 100,
          baseCt: 0, baseTick: tick
        };
        players.set(id, p); rebuildList(); syncPlayerSizes();
        ws.send(JSON.stringify({ type: 'JOINED', playerId: id, team }));
        broadcast(rosterJSON());
      } else if (m.type === 'TEAM' && p) {
        const newTeam = chooseTeam(m.team);
        if (newTeam !== p.team) {
          p.team = newTeam;
          p.ix = 0; p.iy = 0; p.ik = 0; p.is = 0;
          p.disc.vx = 0; p.disc.vy = 0;
          if (newTeam !== 'spec') {
            let count = 0;
            for (const pl of plist) if (pl.id !== p.id && pl.team === newTeam) count++;
            const pos = slot(newTeam, count);
            p.disc.x = pos[0]; p.disc.y = pos[1];
            p.stamina = 100;
          }
          rebuildList(); syncPlayerSizes();
          epoch++;
          ws.send(JSON.stringify({ type: 'JOINED', playerId: id, team: newTeam }));
          broadcast(rosterJSON());
        }
      } else if (m.type === 'CONFIG' && p && id === hostId() && match.state === 2) {
        if (Number.isInteger(m.map) && m.map >= 0 && m.map <= 2) cfg.map = m.map;
        const mode = m.mode === 1 ? 1 : 0;
        let limit = Number.isInteger(m.limit) ? m.limit : 0;
        if (mode === 0 && !TIMES.includes(limit)) limit = 10;
        if (mode === 1 && (limit < 5 || limit > 10)) limit = 7;
        cfg.mode = mode; cfg.limit = limit;
        sendMeta();
      } else if (m.type === 'START' && p && id === hostId() && match.state === 2) {
        startMatch();
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (!p) return;
    players.delete(id); rebuildList();
    broadcast(rosterJSON());
    if (!allList.length) toSetup();
  });
});

let nextTickTime = performance.now();
setInterval(() => {
  const now = performance.now();
  if (wss.clients.size === 0) {
    nextTickTime = now;
    return;
  }
  if (now - nextTickTime > 100) nextTickTime = now;
  while (now >= nextTickTime) {
    stepPhysics();
    broadcast(buildState(), true);
    nextTickTime += FIXED_DT;
  }
}, 2);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor HaxBall listo en puerto ' + PORT);
});
