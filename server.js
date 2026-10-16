const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;
const FIXED_DT = 1000 / TICK_RATE;

const CLIENT_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HaxBall Online</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; font-family: 'Segoe UI', system-ui, sans-serif; }
    body { background: #14181d; color: #f1f5f9; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
    .scoreboard-bar { display: flex; align-items: center; justify-content: space-between; width: 840px; background: #1e242b; border: 2px solid #2f3844; border-bottom: none; border-radius: 10px 10px 0 0; padding: 8px 18px; }
    .score-group { display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 800; }
    .badge { width: 20px; height: 20px; border-radius: 4px; border: 2px solid #fff; }
    .badge.red { background: #e56e56; }
    .badge.blue { background: #5689e5; }
    .clock-box { font-family: monospace; font-size: 24px; font-weight: 700; background: #111519; padding: 4px 16px; border-radius: 6px; border: 1px solid #2e3743; }
    .net-status { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 8px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; }
    .dot.online { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .stage { position: relative; width: 840px; height: 420px; border: 2px solid #2f3844; border-radius: 0 0 10px 10px; overflow: hidden; box-shadow: 0 18px 45px rgba(0,0,0,0.65); }
    canvas { display: block; background: #718c5a; }
    .goal-banner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; opacity: 0; transition: opacity 0.2s; background: radial-gradient(circle, rgba(0,0,0,0.45) 0%, transparent 70%); }
    .goal-banner.active { opacity: 1; }
    .goal-title { font-size: 52px; font-weight: 900; text-shadow: 0 4px 15px #000; }
    .goal-title.red { color: #e56e56; }
    .goal-title.blue { color: #5689e5; }
    .goal-sub { margin-top: 6px; font-size: 15px; font-weight: 600; background: rgba(15,23,42,0.85); padding: 6px 16px; border-radius: 999px; }
    .lobby { position: absolute; inset: 0; background: rgba(12,16,22,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10; }
    .lobby.hidden { display: none; }
    .card { width: 340px; background: #181e26; border: 1px solid #334155; border-radius: 12px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
    .card h1 { font-size: 20px; text-align: center; }
    .input { background: #0f141a; border: 1px solid #334155; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 15px; outline: none; }
    .teams { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .t-btn { padding: 8px; border-radius: 7px; border: 1px solid #334155; background: #161d26; color: #fff; font-weight: 700; cursor: pointer; }
    .t-btn.active[data-team="auto"] { background: #475569; border-color: #fff; }
    .t-btn.active[data-team="red"] { background: #e56e56; border-color: #fff; }
    .t-btn.active[data-team="blue"] { background: #5689e5; border-color: #fff; }
    .join-btn { background: #2ecc71; color: #09130c; font-weight: 800; font-size: 15px; padding: 11px; border: none; border-radius: 8px; cursor: pointer; }
    .footer { margin-top: 10px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="scoreboard-bar">
    <div class="score-group">
      <div class="badge red"></div><span id="sRed">0</span><span>-</span><span id="sBlue">0</span><div class="badge blue"></div>
    </div>
    <div class="clock-box" id="clock">00:00</div>
    <div class="net-status"><div class="dot" id="dot"></div><span id="status">Conectando...</span></div>
  </div>
  <div class="stage">
    <canvas id="c" width="840" height="420"></canvas>
    <div class="goal-banner" id="gBanner">
      <div class="goal-title" id="gTitle">¡GOL!</div>
      <div class="goal-sub" id="gSub"></div>
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
  </div>
  <div class="footer">Moverse: WASD o Flechas | Chutar: Espacio o X</div>

  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    let myId = null, team = 'auto', pingMs = 0, lastPingSent = 0;

    // Posiciones suavizadas en el cliente (Predicción + Interpolación)
    const renderBall = { x: 420, y: 210, tx: 420, ty: 210, vx: 0, vy: 0 };
    const renderPlayers = new Map();
    const fx = [];
    const keys = { up: false, down: false, left: false, right: false, kick: false };

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = () => {
      document.getElementById('dot').classList.add('online');
      document.getElementById('status').textContent = 'Online';
      setInterval(() => {
        if (ws.readyState === 1) {
          lastPingSent = performance.now();
          ws.send(JSON.stringify({ type: 'PING' }));
        }
      }, 2000);
    };

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'PONG') {
        pingMs = Math.round(performance.now() - lastPingSent);
        document.getElementById('status').textContent = 'Ping: ' + pingMs + ' ms';
      } else if (m.type === 'JOINED') {
        myId = m.playerId;
        document.getElementById('lobby').classList.add('hidden');
      } else if (m.type === 'STATE') {
        // Actualizar objetivo del balón
        renderBall.tx = m.b[0]; renderBall.ty = m.b[1];
        renderBall.vx = m.b[2]; renderBall.vy = m.b[3];
        if (Math.hypot(renderBall.tx - renderBall.x, renderBall.ty - renderBall.y) > 80) {
          renderBall.x = renderBall.tx; renderBall.y = renderBall.ty;
        }

        // Actualizar jugadores
        const activeIds = new Set();
        for (const p of m.p) {
          const id = p[0];
          activeIds.add(id);
          if (!renderPlayers.has(id)) {
            renderPlayers.set(id, { id, name: p[1], team: p[2], x: p[3], y: p[4], tx: p[3], ty: p[4], vx: p[5], vy: p[6], kicking: p[7] });
          } else {
            const rp = renderPlayers.get(id);
            rp.tx = p[3]; rp.ty = p[4]; rp.vx = p[5]; rp.vy = p[6]; rp.kicking = p[7];
            if (Math.hypot(rp.tx - rp.x, rp.ty - rp.y) > 90) { rp.x = rp.tx; rp.y = rp.ty; }
          }
        }
        for (const id of renderPlayers.keys()) {
          if (!activeIds.has(id)) renderPlayers.delete(id);
        }

        // HUD
        document.getElementById('sRed').textContent = m.m.sr;
        document.getElementById('sBlue').textContent = m.m.sb;
        const mins = String(Math.floor(m.m.t / 60)).padStart(2, '0');
        const secs = String(m.m.t % 60).padStart(2, '0');
        document.getElementById('clock').textContent = mins + ':' + secs;
        const b = document.getElementById('gBanner');
        if (m.m.st === 1) {
          b.classList.add('active');
          const isRed = m.m.lt === 'red';
          const t = document.getElementById('gTitle');
          t.className = 'goal-title ' + (isRed ? 'red' : 'blue');
          t.textContent = isRed ? '¡GOL ROJO!' : '¡GOL AZUL!';
          document.getElementById('gSub').textContent = 'Gol de ' + m.m.ln + ' • Saque en ' + m.m.rc.toFixed(1) + 's';
        } else {
          b.classList.remove('active');
        }
      } else if (m.type === 'KICK_FX') {
        fx.push({ x: m.x, y: m.y, r: 12, a: 1 });
      }
    };

    document.querySelectorAll('.t-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        team = btn.dataset.team;
      };
    });

    document.getElementById('form').onsubmit = (e) => {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'JOIN', name: document.getElementById('nick').value, team }));
    };

    const map = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'kick', KeyX: 'kick' };
    function onKey(e, v) {
      if (document.activeElement === document.getElementById('nick')) return;
      const k = map[e.code];
      if (k && keys[k] !== v) {
        keys[k] = v;
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'INPUT', inputs: keys }));
      }
    }
    window.onkeydown = (e) => onKey(e, true);
    window.onkeyup = (e) => onKey(e, false);

    function smoothStep() {
      // Predicción local inmediata para tu propio jugador + interpolación suave
      for (const rp of renderPlayers.values()) {
        if (rp.id === myId) {
          const ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
          const ay = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
          if (ax || ay) {
            const len = Math.hypot(ax, ay);
            const acc = keys.kick ? 0.084 : 0.12;
            rp.vx += (ax / len) * acc;
            rp.vy += (ay / len) * acc;
          }
          rp.x
