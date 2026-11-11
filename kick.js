/**
 * Kick It Live — full-screen pitch with heavy canvas animation.
 */
(() => {
  'use strict';

  const world = document.getElementById('world');
  const canvas = document.getElementById('pitch');
  const ctx = canvas.getContext('2d');
  const callEl = document.getElementById('ui-call');
  const kickNEl = document.getElementById('kick-n');
  const goalEl = document.getElementById('ui-goal');
  const bootFlash = document.getElementById('boot-flash');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const NODES = [
    { id: 'roll', label: 'Roll', hue: 30 },
    { id: 'ingest', label: 'Ingest', hue: 28 },
    { id: 'clean', label: 'Clean', hue: 175 },
    { id: 'transform', label: 'Transform', hue: 270 },
    { id: 'load', label: 'Load', hue: 140 },
    { id: 'goal', label: 'Goal', hue: 48 },
  ];

  const CALLS = [
    'Watch the data ball roll in…',
    'Kick 1 — hit INGEST',
    'Kick 2 — hit CLEAN',
    'Kick 3 — hit TRANSFORM',
    'Kick 4 — hit LOAD',
    'Kick 5 — score GOAL',
    'Pipeline built. You are live.',
  ];

  const STAGE_TINT = [
    [8, 10, 18],
    [32, 18, 8],
    [8, 28, 28],
    [18, 10, 32],
    [8, 22, 14],
    [148, 142, 109],
  ];

  let W = 0;
  let H = 0;
  let dpr = 1;
  let stage = 0;
  let kicks = 0;
  let introRolling = true;
  let inFlight = false;
  let flightTimer = null;
  let mouse = { x: 0, y: 0 };
  let lights = 0;
  let particles = [];
  let bootAnim = null;
  let shockwaves = [];
  let ballTrail = [];
  let stars = [];
  let t0 = performance.now();
  let camShake = 0;

  const ball = {
    x: 0, y: 0, vx: 0, vy: 0, r: 26, rot: 0, glow: 0,
  };

  function nowT() {
    return (performance.now() - t0) * 0.001;
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (introRolling) {
      ball.x = W * 0.08;
      ball.y = floorY() - ball.r;
    }
    initStars();
  }

  function initStars() {
    stars = Array.from({ length: Math.min(160, Math.floor(W * 0.12)) }, () => ({
      x: Math.random(),
      y: Math.random() * 0.55,
      z: 0.3 + Math.random(),
      s: 0.4 + Math.random() * 1.2,
    }));
  }

  function floorY() {
    return H * 0.82;
  }

  function nodeX(i) {
    const pad = W * 0.08;
    return pad + (i / (NODES.length - 1)) * (W - pad * 2);
  }

  function targetIndex() {
    return Math.min(kicks + 1, NODES.length - 1);
  }

  function setUI() {
    world.dataset.stage = String(stage);
    if (callEl) callEl.textContent = CALLS[Math.min(kicks, CALLS.length - 1)];
    if (kickNEl) kickNEl.textContent = String(kicks);
    if (goalEl) goalEl.hidden = kicks < 5;
    lights = kicks;
  }

  function hsl(h, s, l, a = 1) {
    return `hsla(${h},${s}%,${l}%,${a})`;
  }

  function spawnBurst(x, y, n = 40, hue = 40) {
    for (let i = 0; i < n; i++) {
      const hex = Math.random() < 0.35;
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.85) * 14,
        life: 1,
        hue: hue + Math.random() * 30,
        sz: Math.random() * 4 + 1,
        hex,
      });
    }
  }

  function pushShockwave(x, y, hue, maxR = 120) {
    if (reduced) return;
    shockwaves.push({ x, y, r: 8, hue, maxR, a: 1 });
  }

  function flashBoot(x, y) {
    if (!bootFlash) return;
    bootFlash.style.setProperty('--bx', `${(x / W) * 100}%`);
    bootFlash.style.setProperty('--by', `${(y / H) * 100}%`);
    bootFlash.classList.add('is-on');
    setTimeout(() => bootFlash.classList.remove('is-on'), 100);
  }

  function drawBackground(t) {
    const [r, g, b] = STAGE_TINT[Math.min(stage, STAGE_TINT.length - 1)];
    const drift = Math.sin(t * 0.25) * 0.03;
    const gx = 0.35 + drift;
    const gy = 0.2 - drift * 0.5;

    const grd = ctx.createRadialGradient(W * gx, H * gy, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.85);
    grd.addColorStop(0, `rgb(${r + 24},${g + 8},${b + 20})`);
    grd.addColorStop(0.4, `rgb(${Math.floor(r * 0.45)},${Math.floor(g * 0.45)},${Math.floor(b * 0.55)})`);
    grd.addColorStop(1, '#020307');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    if (!reduced) {
      const au = ctx.createLinearGradient(0, 0, W, H * 0.6);
      au.addColorStop(0, hsl(NODES[Math.min(stage, 5)].hue, 70, 55, 0.08 + 0.04 * Math.sin(t * 0.8)));
      au.addColorStop(0.5, 'transparent');
      au.addColorStop(1, hsl(NODES[Math.min(stage + 1, 5)].hue, 60, 45, 0.06 + 0.03 * Math.cos(t * 0.6)));
      ctx.fillStyle = au;
      ctx.fillRect(0, 0, W, H * 0.5);
    }

    if (!reduced) {
      for (const st of stars) {
        const sx = (st.x + t * 0.012 * st.z) % 1;
        const sy = st.y;
        const tw = 0.4 + Math.sin(t * 3 + st.x * 50) * 0.35;
        ctx.fillStyle = `rgba(255, 240, 220, ${st.z * 0.45 * tw})`;
        ctx.beginPath();
        ctx.arc(sx * W, sy * H, st.s * st.z, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = 0; i < lights; i++) {
      const y = H * (0.1 + i * 0.052);
      const pulse = 0.55 + Math.sin(t * 2 + i) * 0.25;
      ctx.strokeStyle = hsl(38, 95, 58, 0.2 * pulse);
      ctx.lineWidth = 3;
      ctx.shadowColor = hsl(40, 100, 60, 0.6);
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(W * 0.04, y);
      ctx.lineTo(W * 0.96, y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const bx = W * (0.12 + (i * 0.17) % 0.76);
      const g2 = ctx.createRadialGradient(bx, y, 2, bx, H * 0.85, H * 0.55);
      g2.addColorStop(0, hsl(38, 100, 70, 0.12 * pulse));
      g2.addColorStop(1, 'transparent');
      ctx.fillStyle = g2;
      ctx.fillRect(0, y, W, H - y);
    }
  }

  function drawField(t) {
    const fy = floorY();
    const vx = W * 0.5;
    const vy = fy;

    ctx.strokeStyle = 'rgba(255, 210, 160, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, fy);
    ctx.lineTo(W, fy);
    ctx.stroke();

    const scroll = (t * 40) % 48;
    for (let i = -2; i < 14; i++) {
      const px = (i * 48 + scroll) / W;
      const x1 = vx + (px - 0.5) * W * 0.9;
      const x2 = vx + (px - 0.5) * W * 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, fy);
      ctx.lineTo(x2, H + 20);
      ctx.strokeStyle = `rgba(255, 200, 150, ${0.04 + (i % 3) * 0.02})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const horizon = fy - H * 0.55;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI - Math.PI / 2;
      const wx = vx + Math.cos(ang + t * 0.08) * W * 0.4;
      ctx.beginPath();
      ctx.moveTo(vx + Math.cos(ang) * 40, horizon + 20);
      ctx.lineTo(wx, fy);
      ctx.strokeStyle = 'rgba(94, 234, 212, 0.06)';
      ctx.stroke();
    }

    ctx.strokeStyle = `rgba(255, 179, 71, ${0.12 + 0.04 * Math.sin(t * 2)})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -t * 28;
    ctx.beginPath();
    ctx.arc(vx, fy + 4, W * 0.28, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPipelineEnergy(t) {
    const fy = floorY() - 6;
    for (let i = 0; i < NODES.length - 1; i++) {
      if (i >= stage) continue;
      const x0 = nodeX(i);
      const x1 = nodeX(i + 1);
      const hue = NODES[i + 1].hue;
      const len = x1 - x0 - 44;
      const dash = 16;
      const offset = (t * 80) % dash;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -offset;
      ctx.strokeStyle = hsl(hue, 90, 62, 0.75);
      ctx.lineWidth = 4;
      ctx.shadowColor = hsl(hue, 100, 55, 0.9);
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(x0 + 24, fy);
      ctx.lineTo(x1 - 24, fy);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
    }
  }

  function drawAim(fy) {
    if (kicks >= 5 || introRolling || inFlight) return;
    const ti = targetIndex();
    const tx = nodeX(ti);
    const pulse = 0.4 + Math.sin(nowT() * 5) * 0.25;
    ctx.strokeStyle = hsl(NODES[ti].hue, 85, 62, 0.35 + pulse * 0.25);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(tx, fy - 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawNodes(t) {
    const fy = floorY();
    NODES.forEach((node, i) => {
      const x = nodeX(i);
      const lit = i <= stage;
      const isTarget = i === targetIndex() && kicks < 5 && !introRolling;
      const baseR = isTarget ? 36 : lit ? 28 : 22;

      if (isTarget && !reduced) {
        for (let ring = 0; ring < 3; ring++) {
          const rr = baseR + 18 + ring * 12 + (t * 40 + ring * 20) % 28;
          const alpha = Math.max(0, 0.35 - ring * 0.1 - (rr - baseR) / 120);
          ctx.beginPath();
          ctx.arc(x, fy - 6, rr, 0, Math.PI * 2);
          ctx.strokeStyle = hsl(node.hue, 90, 60, alpha * 0.8);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(x, fy - 6, baseR, 0, Math.PI * 2);
      const ng = ctx.createRadialGradient(x - 8, fy - 14, 2, x, fy - 6, baseR);
      ng.addColorStop(0, lit ? hsl(node.hue, 95, 55, 1) : 'rgba(35,38,48,0.95)');
      ng.addColorStop(1, lit ? hsl(node.hue, 70, 35, 1) : 'rgba(20,22,30,1)');
      ctx.fillStyle = ng;
      ctx.fill();
      ctx.strokeStyle = lit ? hsl(node.hue, 100, 75, 0.95) : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = isTarget ? 3 : 2;
      ctx.stroke();

      ctx.fillStyle = lit ? '#fffdf5' : 'rgba(255,255,255,0.35)';
      ctx.font = `700 ${isTarget ? 12 : 9}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(node.label.toUpperCase(), x, fy - 6 + 5);

      if (i > 0 && i > stage) {
        const x0 = nodeX(i - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 + baseR * 0.6, fy - 6);
        ctx.lineTo(x - baseR * 0.6, fy - 6);
        ctx.stroke();
      }
    });

    if (kicks >= 5) {
      const x = nodeX(NODES.length - 1);
      const pulse = 0.5 + Math.sin(t * 4) * 0.5;
      ctx.strokeStyle = `rgba(255, 230, 180, ${0.45 + pulse * 0.35})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, fy - 90, 58, Math.PI, 0);
      ctx.stroke();
    }
  }

  function drawBallTrail() {
    ballTrail.push({ x: ball.x, y: ball.y, a: 1 });
    if (ballTrail.length > 14) ballTrail.shift();
    for (let i = 0; i < ballTrail.length - 1; i++) {
      const tr = ballTrail[i];
      tr.a *= 0.88;
      ctx.strokeStyle = hsl(38, 100, 65, tr.a * 0.35);
      ctx.lineWidth = 8 - i * 0.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tr.x, tr.y);
      const n = ballTrail[i + 1];
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }
  }

  function drawBall() {
    ctx.save();
    ctx.translate(ball.x + (Math.random() - 0.5) * camShake, ball.y + (Math.random() - 0.5) * camShake);
    ctx.rotate(ball.rot);
    if (ball.glow > 0) {
      ctx.shadowColor = hsl(38, 100, 58, ball.glow);
      ctx.shadowBlur = 36;
    }
    const g = ctx.createRadialGradient(-10, -10, 1, 0, 0, ball.r * 1.2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, '#ffe4b5');
    g.addColorStop(0.7, '#f59e0b');
    g.addColorStop(1, '#92400e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * ball.r * 0.9, Math.sin(a) * ball.r * 0.9);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(12,10,6,0.85)';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DATA', 0, 4);
    ctx.restore();
    ball.glow *= 0.93;
    camShake *= 0.85;
  }

  function drawBoot() {
    if (!bootAnim) return;
    const t = bootAnim.t;
    const { bx, by, mx, my } = bootAnim;
    const k = Math.min(1, t / 0.14);
    ctx.strokeStyle = hsl(38, 90, 72, 0.85 * (1 - k));
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(bx + (mx - bx) * (0.15 + k * 0.5), by + (my - by) * (0.15 + k * 0.5));
    ctx.stroke();
    ctx.fillStyle = hsl(40, 95, 65, 0.5 * (1 - k));
    ctx.beginPath();
    ctx.arc(mx, my, 18 * (1 - k * 0.7), 0, Math.PI * 2);
    ctx.fill();
    bootAnim.t += 0.02;
    if (bootAnim.t > 0.22) bootAnim = null;
  }

  function drawShockwaves() {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const s = shockwaves[i];
      s.r += 7;
      s.a *= 0.94;
      if (s.r > s.maxR || s.a < 0.05) {
        shockwaves.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.strokeStyle = hsl(s.hue, 100, 60, s.a * 0.5);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.life -= 0.022;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (p.hex) {
        ctx.strokeStyle = hsl(p.hue, 80, 65, p.life);
        ctx.lineWidth = 1.2;
        ctx.strokeRect(p.x - p.sz, p.y - p.sz, p.sz * 2, p.sz * 2);
      } else {
        ctx.fillStyle = hsl(p.hue, 90, 62, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.sz * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function physics() {
    const fy = floorY() - ball.r;

    if (introRolling) {
      ball.x += 2.6;
      ball.rot += 0.075;
      if (ball.x > W * 0.22) {
        introRolling = false;
        if (callEl) callEl.textContent = CALLS[1];
      }
      return;
    }

    ball.vy += 0.62;
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= 0.992;
    ball.rot += ball.vx * 0.019;

    if (ball.y >= fy) {
      ball.y = fy;
      ball.vy *= -0.65;
      ball.vx *= 0.82;
      if (Math.abs(ball.vy) < 1.5) ball.vy = 0;
    }
    if (ball.x < ball.r) { ball.x = ball.r; ball.vx *= -0.5; }
    if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx *= -0.5; }

    if (Math.abs(ball.vx) + Math.abs(ball.vy) > 2) {
      checkNodeHit();
    }
  }

  function checkNodeHit() {
    if (!inFlight) return;
    const ti = targetIndex();
    const tx = nodeX(ti);
    const fy = floorY() - 6;
    if (Math.hypot(ball.x - tx, ball.y - fy) < 54) {
      arriveNode(ti);
    }
  }

  function arriveNode(i) {
    if (flightTimer) clearTimeout(flightTimer);
    flightTimer = null;
    inFlight = false;
    ball.vx = ball.vy = 0;
    ball.x = nodeX(i);
    ball.y = floorY() - ball.r;
    ball.glow = 1.2;
    camShake = 8;
    spawnBurst(ball.x, ball.y - 22, 56, NODES[i].hue);
    pushShockwave(ball.x, ball.y - 6, NODES[i].hue, 140);
    stage = i;
    kicks = Math.max(kicks, i);
    setUI();
    if (kicks < 5) {
      setTimeout(() => {
        ball.x = nodeX(i) - 52;
      }, 380);
    }
  }

  function kick(e) {
    if (inFlight || introRolling) return;
    if (kicks >= 5) return;

    const mx = e.clientX ?? mouse.x;
    const my = e.clientY ?? mouse.y;
    const ti = targetIndex();
    const fy = floorY() - ball.r;

    bootAnim = { t: 0, bx: ball.x, by: ball.y, mx, my };
    flashBoot(mx, my);

    let dx = nodeX(ti) - ball.x;
    let dy = fy - 120 - ball.y;
    const cursorDx = mx - ball.x;
    const cursorDy = my - ball.y;
    dx = dx * 0.65 + cursorDx * 0.35;
    dy = dy * 0.5 + cursorDy * 0.35;
    const len = Math.hypot(dx, dy) || 1;
    ball.vx = (dx / len) * 18;
    ball.vy = (dy / len) * 18 - 11;
    ball.glow = 1.15;
    camShake = 5;
    pushShockwave(ball.x, ball.y, NODES[ti].hue, 90);
    spawnBurst(ball.x, ball.y, 16, NODES[ti].hue);

    inFlight = true;
    if (!reduced) world.classList.add('is-orbit');
    setTimeout(() => world.classList.remove('is-orbit'), reduced ? 0 : 1050);

    if (flightTimer) clearTimeout(flightTimer);
    flightTimer = setTimeout(() => {
      if (inFlight) arriveNode(targetIndex());
    }, 1400);
  }

  function frame() {
    const t = nowT();
    const fy = floorY();
    const sx = (Math.random() - 0.5) * camShake * 0.5;
    const sy = (Math.random() - 0.5) * camShake * 0.5;
    ctx.save();
    ctx.translate(sx, sy);

    drawBackground(t);
    drawField(t);
    drawPipelineEnergy(t);
    drawShockwaves();
    drawAim(fy);
    drawNodes(t);
    if (!reduced) drawBallTrail();
    drawBoot();
    drawParticles();
    drawBall();
    ctx.restore();

    physics();
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('click', (e) => kick(e));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      kick({ clientX: mouse.x, clientY: mouse.y });
    }
  });
  document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('resize', resize);

  resize();
  setUI();
  frame();
})();
