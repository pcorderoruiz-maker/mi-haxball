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
    body { background: #14181d; color: #f1f5f9; height: 100vh; width: 100vw; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
    
    .game-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 840px;
      max-width: 96vw;
    }

    :fullscreen .game-wrapper,
    :-webkit-full-screen .game-wrapper {
      width: min(94vw, calc((100vh - 90px) * 2));
      max-width: 1600px;
    }

    .scoreboard-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      background: #1e242b;
      border: 2px solid #2f3844;
      border-bottom: none;
      border-radius: 10px 10px 0 0;
      padding: 8px 18px;
    }

    .score-group { display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 800; }
    .badge { width: 20px; height: 20px; border-radius: 4px; border: 2px solid #fff; }
    .badge.red { background: #e56e56; }
    .badge.blue { background: #5689e5; }
    .clock-box { font-family: monospace; font-size: 24px; font-weight: 700; background: #111519; padding: 4px 16px; border-radius: 6px; border: 1px solid #2e3743; }
    
    .right-controls { display: flex; align-items: center; gap: 14px; }
    .stamina-hud { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #cbd5e1; }
    .stamina-bar-bg { width: 70px; height: 10px; background: #0f141a; border-radius: 99px; border: 1px solid #334155; overflow: hidden; }
    .stamina-bar-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); transition: width 0.08s linear; }

    .net-status { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; }
    .dot.online { background: #10b981; box-shadow: 0 0 8px #10b981; }

    .fs-btn {
      background: #283240;
      color: #f1f5f9;
      border: 1px solid #3e4c63;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }
    .fs-btn:hover { background: #364457; }

    .stage {
      position: relative;
      width: 100%;
      aspect-ratio: 2 / 1;
      border: 2px solid #2f3844;
      border-radius: 0 0 10px 10px;
      overflow: hidden;
      box-shadow: 0 18px 45px rgba(0,0,0,0.65);
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: #718c5a;
    }

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
    .footer { margin-top: 10px; font-size: 12px; color: #94a3b8; text-align: center; }
    kbd { background: #262f3d; padding: 2px 6px; border-radius: 4px; border: 1px solid #3e4c63; font-size: 11px; color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="game-wrapper" id="gameWrapper">
    <div class="scoreboard-bar">
      <div class="score-group">
        <div class="badge red"></div><span id="sRed">0</span><span>-</span><span id="sBlue">0</span><div class="badge blue"></div>
      </div>

      <div class="clock-box" id="clock">00:00</div>

      <div class="right-controls">
        <div class="stamina-hud" title="Energía de Esprint (Shift)">
          <span>⚡</span>
          <div class="stamina-bar-bg"><div class="stamina-bar-fill" id="staminaFill"></div></div>
        </div>
        <div class="net-status"><div class="dot" id="dot"></div><span id="status">Conectando...</span></div>
        <button type="button" class="fs-btn" id="fsBtn">⛶ Pantalla Completa</button>
      </div>
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

    <div class="footer">
      Moverse: <kbd>WASD</kbd> o <kbd>Flechas</kbd> &nbsp;|&nbsp;
      Esprintar: <kbd>Shift</kbd> &nbsp;|&nbsp;
      Chutar: <kbd>Espacio</kbd> o <kbd>X</kbd> &nbsp;|&nbsp;
      Pantalla Completa: <kbd>F</kbd>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    let myId = null, team = 'auto', pingMs = 0, lastPingSent = 0;

    const renderBall = { x: 420, y: 210, tx: 420, ty: 210, vx: 0, vy: 0 };
    const renderPlayers = new Map();
    const fx = [];
    const sprintTrails = [];
    const keys = { up: false, down: false, left: false, right: false, kick: false, sprint: false };

    const fsBtn = document.getElementById('fsBtn');
    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
    fsBtn.onclick = () => { toggleFullscreen(); fsBtn.blur(); };
    document.addEventListener('fullscreenchange', () => {
      fsBtn.textContent = document.fullscreenElement ? '✕ Salir Pantalla Completa' : '⛶ Pantalla Completa';
    });

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
        document.getElementById('status').textContent = pingMs + ' ms';
      } else if (m.type === 'JOINED') {
        myId = m.playerId;
        document.getElementById('lobby').classList.add('hidden');
      } else if (m.type === 'STATE') {
        renderBall.tx = m.b[0]; renderBall.ty = m.b[1];
        renderBall.vx = m.b[2]; renderBall.vy = m.b[3];
        if (Math.hypot(renderBall.tx - renderBall.x, renderBall.ty - renderBall.y) > 80) {
          renderBall.x = renderBall.tx; renderBall.y = renderBall.ty;
        }

        const activeIds = new Set();
        for (const p of m.p) {
          const id = p[0];
          activeIds.add(id);
          if (!renderPlayers.has(id)) {
            renderPlayers.set(id, {
              id, name: p[1], team: p[2],
              x: p[3], y: p[4], tx: p[3], ty: p[4],
              kicking: p[5], sprinting: p[6], stamina: p[7]
            });
          } else {
            const rp = renderPlayers.get(id);
            rp.tx = p[3]; rp.ty = p[4];
            rp.kicking = p[5]; rp.sprinting = p[6]; rp.stamina = p[7];
            if (Math.hypot(rp.tx - rp.x, rp.ty - rp.y) > 90) { rp.x = rp.tx; rp.y = rp.ty; }
          }
          if (id === myId) {
            document.getElementById('staminaFill').style.width = p[7] + '%';
          }
        }
        for (const id of renderPlayers.keys()) {
          if (!activeIds.has(id)) renderPlayers.delete(id);
        }

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

    const map = {
      KeyW: 'up', ArrowUp: 'up',
      KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'kick', KeyX: 'kick',
      ShiftLeft: 'sprint', ShiftRight: 'sprint'
    };

    function onKey(e, v) {
      if (document.activeElement === document.getElementById('nick')) return;
      if (v && e.code === 'KeyF') { toggleFullscreen(); return; }
      const k = map[e.code];
      if (k && keys[k] !== v) {
        keys[k] = v;
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'INPUT', inputs: keys }));
      }
    }
    window.onkeydown = (e) => onKey(e, true);
    window.onkeyup = (e) => onKey(e, false);

    function smoothStep() {
      for (const rp of renderPlayers.values()) {
        if (rp.id === myId) {
          const ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
          const ay = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
          rp.x += (rp.tx - rp.x) * 0.45;
          rp.y += (rp.ty - rp.y) * 0.45;
          rp.kicking = keys.kick;
          rp.sprinting = keys.sprint && (ax || ay) && rp.stamina > 0;
        } else {
          rp.x += (rp.tx - rp.x) * 0.4;
          rp.y += (rp.ty - rp.y) * 0.4;
        }

        if (rp.sprinting && Math.random() < 0.6) {
          sprintTrails.push({ x: rp.x, y: rp.y, r: 13, a: 0.45 });
        }
      }
      renderBall.x += (renderBall.tx - renderBall.x) * 0.4;
      renderBall.y += (renderBall.ty - renderBall.y) * 0.4;
    }

    function draw() {
      smoothStep();
      ctx.fillStyle = '#5a7047'; ctx.fillRect(0, 0, 840, 420);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#74915c' : '#698553';
        ctx.fillRect(70 + i * 70, 35, 70, 350);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(28, 145, 42, 130); ctx.fillRect(770, 145, 42, 130);
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 3;
      ctx.strokeRect(28, 145, 42, 130); ctx.strokeRect(770, 145, 42, 130);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeRect(70, 35, 700, 350);
      ctx.beginPath(); ctx.moveTo(420, 35); ctx.lineTo(420, 385); ctx.stroke();
      ctx.beginPath(); ctx.arc(420, 210, 55, 0, Math.PI * 2); ctx.stroke();

      [[70,145,'#ef4444'],[70,275,'#ef4444'],[770,145,'#3b82f6'],[770,275,'#3b82f6']].forEach(([x,y,c]) => {
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
      });

      for (let i = sprintTrails.length - 1; i >= 0; i--) {
        const st = sprintTrails[i];
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, ' + st.a + ')';
        ctx.fill();
        st.r *= 0.92; st.a -= 0.04;
        if (st.a <= 0) sprintTrails.splice(i, 1);
      }

      for (let i = fx.length - 1; i >= 0; i--) {
        ctx.beginPath(); ctx.arc(fx[i].x, fx[i].y, fx[i].r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,' + fx[i].a + ')'; ctx.lineWidth = 2.5; ctx.stroke();
        fx[i].r += 1.2; fx[i].a -= 0.08;
        if (fx[i].a <= 0) fx.splice(i, 1);
      }

      for (const p of renderPlayers.values()) {
        if (p.id === myId) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 21, 0, Math.PI * 2);
          ctx.strokeStyle = p.sprinting ? 'rgba(251, 191, 36, 0.75)' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 2.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = p.team === 'red' ? '#e56e56' : '#5689e5'; ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = p.kicking ? '#ffffff' : (p.sprinting ? '#fbbf24' : '#111111');
        ctx.stroke();

        ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#fff'; ctx.fillText(p.name, p.x, p.y + 29);

        if (p.stamina < 100) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(p.x - 14, p.y + 33, 28, 4);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(p.x - 14, p.y + 33, (28 * p.stamina) / 100, 4);
        }
      }

      ctx.beginPath(); ctx.arc(renderBall.x, renderBall.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; ctx.stroke();
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  </script>
</body>
</html>`;

const centerX = 420, centerY = 210, goalTop = 145, goalBottom = 275;

class Disc {
  constructor(x, y, radius, invMass, damping, restitution) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.radius = radius; this.invMass = invMass; this.damping = damping; this.restitution = restitution;
  }
  integrate() {
    if (!this.invMass) return;
    this.x += this.vx; this.y += this.vy;
  }
}

const players = new Map();
let nextId = 1;
const ball = new Disc(centerX, centerY, 10, 1.0, 0.988, 0.82);
const posts = [
  new Disc(70, 145, 8, 0, 1, 0.85), new Disc(70, 275, 8, 0, 1, 0.85),
  new Disc(770, 145, 8, 0, 1, 0.85), new Disc(770, 275, 8, 0, 1, 0.85)
];

const match = { state: 0, score: { red: 0, blue: 0 }, ticks: 0, resetTicks: 0, lastScorerTeam: null, lastScorerName: '', lastTouch: '' };

function collide(d1, d2) {
  const tm = d1.invMass + d2.invMass;
  if (!tm) return false;
  const dx = d2.x - d1.x, dy = d2.y - d1.y, dSq = dx * dx + dy * dy, min = d1.radius + d2.radius;
  if (dSq >= min * min || dSq === 0) return false;
  const d = Math.sqrt(dSq), nx = dx / d, ny = dy / d, ov = min - d;
  d1.x -= nx * ov * (d1.invMass / tm); d1.y -= ny * ov * (d1.invMass / tm);
  d2.x += nx * ov * (d2.invMass / tm); d2.y += ny * ov * (d2.invMass / tm);
  const vn = (d2.vx - d1.vx) * nx + (d2.vy - d1.vy) * ny;
  if (vn > 0) return true;
  const j = -(1 + Math.min(d1.restitution, d2.restitution)) * vn / tm;
  d1.vx -= j * nx * d1.invMass; d1.vy -= j * ny * d1.invMass;
  d2.vx += j * nx * d2.invMass; d2.vy += j * ny * d2.invMass;
  return true;
}

function resetPositions() {
  ball.x = centerX; ball.y = centerY; ball.vx = 0; ball.vy = 0;
  let r = 0, b = 0;
  for (const p of players.values()) {
    p.disc.vx = 0; p.disc.vy = 0;
    p.stamina = 100;
    const idx = p.team === 'red' ? r++ : b++;
    const offY = idx === 0 ? 0 : (idx % 2 === 1 ? -55 : 55) * Math.ceil(idx / 2);
    p.disc.x = p.team === 'red' ? centerX - 150 : centerX + 150;
    p.disc.y = centerY + offY;
  }
}

function stepPhysics() {
  const list = Array.from(players.values());
  for (const p of list) {
    if (!p.inputs.kick) { p.canKick = true; p.kicking = false; }
    else if (p.canKick) p.kicking = true;

    const ax = (p.inputs.right ? 1 : 0) - (p.inputs.left ? 1 : 0);
    const ay = (p.inputs.down ? 1 : 0) - (p.inputs.up ? 1 : 0);
    const wantsSprint = Boolean(p.inputs.sprint) && (ax !== 0 || ay !== 0) && !p.kicking;

    if (wantsSprint && p.stamina > 0) {
      p.sprinting = true;
      p.stamina = Math.max(0, p.stamina - 0.75);
    } else {
      p.sprinting = false;
      if (!p.inputs.sprint) {
        p.stamina = Math.min(100, p.stamina + 0.45);
      }
    }

    // Sin inercia: velocidad directa instantánea según teclas pulsadas
    const speed = p.kicking ? 1.6 : (p.sprinting ? 4.2 : 2.8);
    if (ax !== 0 && ay !== 0) {
      p.disc.vx = (ax / Math.hypot(ax, ay)) * speed;
      p.disc.vy = (ay / Math.hypot(ax, ay)) * speed;
    } else if (ax !== 0) {
      p.disc.vx = ax * speed;
      p.disc.vy = 0;
    } else if (ay !== 0) {
      p.disc.vx = 0;
      p.disc.vy = ay * speed;
    } else {
      p.disc.vx = 0;
      p.disc.vy = 0; // Se detiene en seco al soltar
    }

    if (p.kicking && p.canKick) {
      const dx = ball.x - p.disc.x, dy = ball.y - p.disc.y, dist = Math.hypot(dx, dy);
      if (dist <= 29.5 && dist > 0) {
        ball.vx += (dx / dist) * 5.6; ball.vy += (dy / dist) * 5.6;
        p.canKick = false; p.kicking = false; match.lastTouch = p.name;
        broadcast({ type: 'KICK_FX', x: Math.round(ball.x), y: Math.round(ball.y) });
      }
    }
    p.disc.integrate();
  }
  ball.integrate();

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) collide(list[i].disc, list[j].disc);
    if (collide(list[i].disc, ball)) match.lastTouch = list[i].name;
    for (const post of posts) collide(list[i].disc, post);
    list[i].disc.x = Math.max(15, Math.min(825, list[i].disc.x));
    list[i].disc.y = Math.max(15, Math.min(405, list[i].disc.y));
  }
  for (const post of posts) collide(ball, post);

  const inGoalY = ball.y > goalTop && ball.y < goalBottom;
  if (ball.x < 70 || ball.x > 770) {
    if (ball.y - 10 < goalTop) { ball.y = goalTop + 10; ball.vy *= -0.3; }
    if (ball.y + 10 > goalBottom) { ball.y = goalBottom - 10; ball.vy *= -0.3; }
    if (ball.x - 10 < 28) { ball.x = 38; ball.vx *= -0.3; }
    if (ball.x + 10 > 812) { ball.x = 802; ball.vx *= -0.3; }
  } else {
    if (ball.y - 10 < 35) { ball.y = 45; ball.vy *= -0.82; }
    if (ball.y + 10 > 385) { ball.y = 375; ball.vy *= -0.82; }
    if (!inGoalY) {
      if (ball.x - 10 < 70) { ball.x = 80; ball.vx *= -0.82; }
      if (ball.x + 10 > 770) { ball.x = 760; ball.vx *= -0.82; }
    }
  }

  if (match.state === 0) {
    if (players.size > 0) match.ticks++;
    if (inGoalY && (ball.x + 10 < 70 || ball.x - 10 > 770)) {
      const team = ball.x + 10 < 70 ? 'blue' : 'red';
      match.state = 1;
      match.score[team]++;
      match.resetTicks = 180;
      match.lastScorerTeam = team;
      match.lastScorerName = match.lastTouch || (team === 'red' ? 'Rojo' : 'Azul');
    }
  } else if (--match.resetTicks <= 0) {
    resetPositions();
    match.state = 0;
  }
}

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(CLIENT_HTML);
});

const wss = new WebSocketServer({ server: httpServer });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

wss.on('connection', (ws) => {
  const id = nextId++;
  let p = null;

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'PING') {
        ws.send('{"type":"PONG"}');
      } else if (m.type === 'JOIN' && !p) {
        let red = 0, blue = 0;
        for (const pl of players.values()) pl.team === 'red' ? red++ : blue++;
        const team = (m.team === 'red' || m.team === 'blue') ? m.team : (red <= blue ? 'red' : 'blue');
        p = {
          id,
          name: String(m.name || '').trim().slice(0, 14) || ('Player ' + id),
          team,
          disc: new Disc(team === 'red' ? 270 : 570, 210, 15, 0.5, 1.0, 0.5),
          inputs: { up: false, down: false, left: false, right: false, kick: false, sprint: false },
          canKick: true,
          kicking: false,
          sprinting: false,
          stamina: 100
        };
        players.set(id, p);
        ws.send(JSON.stringify({ type: 'JOINED', playerId: id, team }));
      } else if (m.type === 'INPUT' && p && m.inputs) {
        p.inputs = m.inputs;
      }
    } catch (e) {}
  });

  ws.on('close', () => { if (p) players.delete(id); });
});

let tickCount = 0;
setInterval(() => {
  if (wss.clients.size === 0) return;
  stepPhysics();
  tickCount++;
  if (tickCount % 2 === 0) {
    broadcast({
      type: 'STATE',
      m: { st: match.state, sr: match.score.red, sb: match.score.blue, t: Math.floor(match.ticks / 60), rc: match.resetTicks / 60, lt: match.lastScorerTeam, ln: match.lastScorerName },
      b: [Number(ball.x.toFixed(1)), Number(ball.y.toFixed(1)), Number(ball.vx.toFixed(2)), Number(ball.vy.toFixed(2))],
      p: Array.from(players.values()).map(pl => [
        pl.id, pl.name, pl.team,
        Number(pl.disc.x.toFixed(1)), Number(pl.disc.y.toFixed(1)),
        pl.kicking ? 1 : 0, pl.sprinting ? 1 : 0, Math.round(pl.stamina)
      ])
    });
  }
}, 16);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor HaxBall listo en puerto ' + PORT);
});
