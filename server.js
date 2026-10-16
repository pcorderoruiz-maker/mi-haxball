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
    let myId = null, team = 'auto';
    let state = { match: { state: 'PLAYING', score: { red: 0, blue: 0 }, timeSeconds: 0, resetCountdown: 0 }, ball: { x: 420, y: 210 }, players: [] };
    const fx = [];

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = () => {
      document.getElementById('dot').classList.add('online');
      document.getElementById('status').textContent = 'Online (60 Hz)';
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'JOINED') {
        myId = m.playerId;
        document.getElementById('lobby').classList.add('hidden');
      } else if (m.type === 'STATE') {
        state = m;
        document.getElementById('sRed').textContent = m.match.score.red;
        document.getElementById('sBlue').textContent = m.match.score.blue;
        const mins = String(Math.floor(m.match.timeSeconds / 60)).padStart(2, '0');
        const secs = String(m.match.timeSeconds % 60).padStart(2, '0');
        document.getElementById('clock').textContent = mins + ':' + secs;
        const b = document.getElementById('gBanner');
        if (m.match.state === 'GOAL_SCORED') {
          b.classList.add('active');
          const isRed = m.match.lastScorerTeam === 'red';
          const t = document.getElementById('gTitle');
          t.className = 'goal-title ' + (isRed ? 'red' : 'blue');
          t.textContent = isRed ? '¡GOL ROJO!' : '¡GOL AZUL!';
          document.getElementById('gSub').textContent = 'Gol de ' + m.match.lastScorerName + ' • Saque en ' + m.match.resetCountdown.toFixed(1) + 's';
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

    const keys = { up: false, down: false, left: false, right: false, kick: false };
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

    function draw() {
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

      for (let i = fx.length - 1; i >= 0; i--) {
        ctx.beginPath(); ctx.arc(fx[i].x, fx[i].y, fx[i].r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,' + fx[i].a + ')'; ctx.stroke();
        fx[i].r += 1.2; fx[i].a -= 0.08;
        if (fx[i].a <= 0) fx.splice(i, 1);
      }

      for (const p of state.players) {
        if (p.id === myId) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 21, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = p.team === 'red' ? '#e56e56' : '#5689e5'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = p.kicking ? '#fff' : '#111'; ctx.stroke();
        ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#fff'; ctx.fillText(p.name, p.x, p.y + 29);
      }

      ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, 10, 0, Math.PI * 2);
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
    this.vx *= this.damping; this.vy *= this.damping;
  }
}

const players = new Map();
let nextId = 1;
const ball = new Disc(centerX, centerY, 10, 1.0, 0.988, 0.82);
const posts = [
  new Disc(70, 145, 8, 0, 1, 0.85), new Disc(70, 275, 8, 0, 1, 0.85),
  new Disc(770, 145, 8, 0, 1, 0.85), new Disc(770, 275, 8, 0, 1, 0.85)
];

const match = { state: 'PLAYING', score: { red: 0, blue: 0 }, ticks: 0, resetTicks: 0, lastScorerTeam: null, lastScorerName: '', lastTouch: '' };

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
    if (ax || ay) {
      const len = Math.hypot(ax, ay), acc = p.kicking ? 0.084 : 0.12;
      p.disc.vx += (ax / len) * acc; p.disc.vy += (ay / len) * acc;
    }
    if (p.kicking && p.canKick) {
      const dx = ball.x - p.disc.x, dy = ball.y - p.disc.y, dist = Math.hypot(dx, dy);
      if (dist <= 29.5 && dist > 0) {
        ball.vx += (dx / dist) * 5.6; ball.vy += (dy / dist) * 5.6;
        p.canKick = false; p.kicking = false; match.lastTouch = p.name;
        broadcast({ type: 'KICK_FX', x: ball.x, y: ball.y });
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

  if (match.state === 'PLAYING') {
    if (players.size > 0) match.ticks++;
    if (inGoalY && (ball.x + 10 < 70 || ball.x - 10 > 770)) {
      const team = ball.x + 10 < 70 ? 'blue' : 'red';
      match.state = 'GOAL_SCORED';
      match.score[team]++;
      match.resetTicks = 180;
      match.lastScorerTeam = team;
      match.lastScorerName = match.lastTouch || (team === 'red' ? 'Rojo' : 'Azul');
    }
  } else if (--match.resetTicks <= 0) {
    resetPositions();
    match.state = 'PLAYING';
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
      if (m.type === 'JOIN' && !p) {
        let red = 0, blue = 0;
        for (const pl of players.values()) pl.team === 'red' ? red++ : blue++;
        const team = (m.team === 'red' || m.team === 'blue') ? m.team : (red <= blue ? 'red' : 'blue');
        p = {
          id,
          name: String(m.name || '').trim().slice(0, 14) || ('Player ' + id),
          team,
          disc: new Disc(team === 'red' ? 270 : 570, 210, 15, 0.5, 0.96, 0.5),
          inputs: { up: false, down: false, left: false, right: false, kick: false },
          canKick: true,
          kicking: false
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

let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last; last = now;
  while (acc >= FIXED_DT) {
    stepPhysics();
    broadcast({
      type: 'STATE',
      match: { state: match.state, score: match.score, timeSeconds: Math.floor(match.ticks / 60), resetCountdown: match.resetTicks / 60, lastScorerTeam: match.lastScorerTeam, lastScorerName: match.lastScorerName },
      ball: { x: Number(ball.x.toFixed(1)), y: Number(ball.y.toFixed(1)) },
      players: Array.from(players.values()).map(pl => ({ id: pl.id, name: pl.name, team: pl.team, x: Number(pl.disc.x.toFixed(1)), y: Number(pl.disc.y.toFixed(1)), kicking: pl.kicking }))
    });
    acc -= FIXED_DT;
  }
}, 4);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor HaxBall listo en puerto ' + PORT);
});
