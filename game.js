(() => {
  "use strict";

  const WORLD = { width: 960, height: 600 };
  const GAME_LENGTH = 85;
  const TOTAL_CARGO = 10;
  const MAX_CARRY = 5;

  const canvas = document.getElementById("game");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: true });
  const ui = {
    intro: document.getElementById("intro"),
    result: document.getElementById("result"),
    hud: document.getElementById("hud"),
    start: document.getElementById("start-button"),
    restart: document.getElementById("restart-button"),
    delivered: document.getElementById("delivered"),
    time: document.getElementById("time"),
    slots: document.getElementById("cargo-slots"),
    touchControls: document.getElementById("touch-controls"),
    message: document.getElementById("message"),
    resultLabel: document.getElementById("result-label"),
    resultTitle: document.getElementById("result-title"),
    resultText: document.getElementById("result-text"),
    stats: document.getElementById("stats")
  };

  for (let i = 0; i < MAX_CARRY; i += 1) {
    const slot = document.createElement("span");
    slot.className = "cargo-slot";
    ui.slots.appendChild(slot);
  }

  if (!gl) {
    ui.intro.querySelector("p:not(.course-label)").textContent = "This prototype needs a browser with WebGL 2 enabled.";
    ui.start.disabled = true;
    return;
  }

  const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    in vec4 a_color;
    uniform vec2 u_resolution;
    out vec4 v_color;
    void main() {
      vec2 normalized = a_position / u_resolution;
      vec2 clip = normalized * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      v_color = a_color;
    }
  `;

  const fragmentShaderSource = `#version 300 es
    precision mediump float;
    in vec4 v_color;
    out vec4 outColor;
    void main() { outColor = v_color; }
  `;

  function makeShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, makeShader(gl.VERTEX_SHADER, vertexShaderSource));
  gl.attachShader(program, makeShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const colorLocation = gl.getAttribLocation(program, "a_color");
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const positions = [];
  const colors = [];
  const keys = Object.create(null);
  const dock = { x: 36, y: 220, w: 116, h: 160 };
  const walls = [
    { x: 0, y: 0, w: 960, h: 20 },
    { x: 0, y: 580, w: 960, h: 20 },
    { x: 0, y: 0, w: 20, h: 600 },
    { x: 940, y: 0, w: 20, h: 600 },
    { x: 205, y: 88, w: 245, h: 54 },
    { x: 530, y: 88, w: 255, h: 54 },
    { x: 285, y: 260, w: 220, h: 54 },
    { x: 605, y: 260, w: 235, h: 54 },
    { x: 205, y: 438, w: 235, h: 54 },
    { x: 520, y: 438, w: 255, h: 54 }
  ];

  const cargoStart = [
    [230, 188], [405, 205], [555, 186], [750, 194], [885, 122],
    [235, 370], [455, 382], [575, 370], [805, 382], [865, 520]
  ];

  const forkliftPaths = [
    [[175, 190], [885, 190]],
    [[885, 380], [175, 380]],
    [[555, 170], [555, 410]]
  ];

  let player;
  let cargo;
  let forklifts;
  let particles;
  let state = "intro";
  let previousTime = performance.now();
  let elapsed = 0;
  let delivered = 0;
  let deposits = 0;
  let depositedCargo = 0;
  let maxLoad = 0;
  let collisions = 0;
  let dropped = 0;
  let heavyTime = 0;
  let messageTime = 0;
  let screenShake = 0;
  let audioContext = null;

  function resetGame() {
    player = {
      x: 95, y: 300, r: 12,
      vx: 0, vy: 0,
      angle: 0,
      carry: 0,
      invulnerable: 0
    };
    cargo = cargoStart.map(([x, y], index) => ({
      x, y, index, active: true, bob: index * 0.7, pickupDelay: 0
    }));
    forklifts = forkliftPaths.map((path, index) => ({
      path,
      segment: 0,
      x: path[0][0],
      y: path[0][1],
      speed: 86 + index * 10,
      angle: 0
    }));
    particles = [];
    elapsed = 0;
    delivered = 0;
    deposits = 0;
    depositedCargo = 0;
    maxLoad = 0;
    collisions = 0;
    dropped = 0;
    heavyTime = 0;
    messageTime = 0;
    screenShake = 0;
    updateHud();
  }

  function startGame() {
    resetGame();
    ensureAudio();
    state = "playing";
    ui.intro.classList.add("hidden");
    ui.result.classList.add("hidden");
    ui.hud.classList.remove("hidden");
    ui.touchControls.classList.remove("hidden");
    showMessage("Yellow boxes go to the striped loading area.", 3.2);
    previousTime = performance.now();
  }

  function vertex(x, y, color) {
    positions.push(x, y);
    colors.push(color[0], color[1], color[2], color[3] ?? 1);
  }

  function rect(x, y, width, height, color) {
    vertex(x, y, color); vertex(x + width, y, color); vertex(x, y + height, color);
    vertex(x, y + height, color); vertex(x + width, y, color); vertex(x + width, y + height, color);
  }

  function triangle(ax, ay, bx, by, cx, cy, color) {
    vertex(ax, ay, color); vertex(bx, by, color); vertex(cx, cy, color);
  }

  function circle(x, y, radius, color, segments = 24) {
    for (let i = 0; i < segments; i += 1) {
      const a = i / segments * Math.PI * 2;
      const b = (i + 1) / segments * Math.PI * 2;
      triangle(x, y, x + Math.cos(a) * radius, y + Math.sin(a) * radius,
        x + Math.cos(b) * radius, y + Math.sin(b) * radius, color);
    }
  }

  function rotatedRect(cx, cy, width, height, angle, color) {
    const hw = width / 2;
    const hh = height / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (x, y) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
    const a = point(-hw, -hh);
    const b = point(hw, -hh);
    const c = point(hw, hh);
    const d = point(-hw, hh);
    vertex(a.x, a.y, color); vertex(b.x, b.y, color); vertex(c.x, c.y, color);
    vertex(a.x, a.y, color); vertex(c.x, c.y, color); vertex(d.x, d.y, color);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pointInRect(x, y, rectangle) {
    return x >= rectangle.x && x <= rectangle.x + rectangle.w && y >= rectangle.y && y <= rectangle.y + rectangle.h;
  }

  function circleRectCollision(entity, rectangle) {
    const nearestX = clamp(entity.x, rectangle.x, rectangle.x + rectangle.w);
    const nearestY = clamp(entity.y, rectangle.y, rectangle.y + rectangle.h);
    const dx = entity.x - nearestX;
    const dy = entity.y - nearestY;
    return dx * dx + dy * dy < entity.r * entity.r;
  }

  function blocked(entity) {
    return walls.some((wall) => circleRectCollision(entity, wall));
  }

  function movePlayer(dx, dy) {
    player.x += dx;
    if (blocked(player)) {
      player.x -= dx;
      player.vx = 0;
    }
    player.y += dy;
    if (blocked(player)) {
      player.y -= dy;
      player.vy = 0;
    }
  }

  function update(dt) {
    updateParticles(dt);
    if (state !== "playing") return;

    elapsed += dt;
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    messageTime = Math.max(0, messageTime - dt);
    screenShake = Math.max(0, screenShake - dt * 20);
    if (messageTime <= 0) ui.message.classList.add("hidden");
    if (player.carry >= 4) heavyTime += dt;

    let inputX = 0;
    let inputY = 0;
    if (keys.KeyA || keys.ArrowLeft) inputX -= 1;
    if (keys.KeyD || keys.ArrowRight) inputX += 1;
    if (keys.KeyW || keys.ArrowUp) inputY -= 1;
    if (keys.KeyS || keys.ArrowDown) inputY += 1;

    const weight = 1 - player.carry * 0.095;
    const maximumSpeed = 225 * weight;
    const acceleration = 980 * (0.9 + weight * 0.1);
    if (inputX || inputY) {
      const length = Math.hypot(inputX, inputY);
      inputX /= length;
      inputY /= length;
      player.vx += inputX * acceleration * dt;
      player.vy += inputY * acceleration * dt;
      player.angle = Math.atan2(inputY, inputX);
    } else {
      const drag = Math.pow(0.00045, dt);
      player.vx *= drag;
      player.vy *= drag;
    }

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > maximumSpeed) {
      player.vx = player.vx / speed * maximumSpeed;
      player.vy = player.vy / speed * maximumSpeed;
    }
    movePlayer(player.vx * dt, player.vy * dt);

    cargo.forEach((box) => {
      box.bob += dt * 2.2;
      box.pickupDelay = Math.max(0, box.pickupDelay - dt);
      if (!box.active || box.pickupDelay > 0 || player.carry >= MAX_CARRY) return;
      if (Math.hypot(player.x - box.x, player.y - box.y) < player.r + 14) {
        box.active = false;
        player.carry += 1;
        maxLoad = Math.max(maxLoad, player.carry);
        burst(box.x, box.y, [0.96, 0.73, 0.24, 1], 16);
        playPickup();
        showMessage(player.carry === MAX_CARRY ? "Cart is full." : `${player.carry} box${player.carry === 1 ? "" : "es"} on the cart.`, 1.6);
      }
    });

    if (player.carry > 0 && pointInRect(player.x, player.y, dock)) {
      const load = player.carry;
      delivered += load;
      deposits += 1;
      depositedCargo += load;
      player.carry = 0;
      burst(player.x, player.y, [0.35, 0.78, 0.47, 1], 28);
      playDeposit();
      showMessage(`Delivered ${load}. ${TOTAL_CARGO - delivered} left.`, 2.4);
      if (delivered >= TOTAL_CARGO) finish(true);
    }

    forklifts.forEach((forklift) => updateForklift(forklift, dt));
    if (elapsed >= GAME_LENGTH) finish(false);
    updateHud();
  }

  function updateForklift(forklift, dt) {
    const targetIndex = (forklift.segment + 1) % forklift.path.length;
    const target = forklift.path[targetIndex];
    const dx = target[0] - forklift.x;
    const dy = target[1] - forklift.y;
    const length = Math.hypot(dx, dy) || 1;
    forklift.angle = Math.atan2(dy, dx);
    forklift.x += dx / length * forklift.speed * dt;
    forklift.y += dy / length * forklift.speed * dt;
    if (length < 5) forklift.segment = targetIndex;

    if (player.invulnerable <= 0 && Math.hypot(player.x - forklift.x, player.y - forklift.y) < player.r + 22) {
      player.invulnerable = 1.8;
      collisions += 1;
      screenShake = 9;
      const awayX = player.x - forklift.x;
      const awayY = player.y - forklift.y;
      const awayLength = Math.hypot(awayX, awayY) || 1;
      player.vx = awayX / awayLength * 260;
      player.vy = awayY / awayLength * 260;
      if (player.carry > 0) {
        player.carry -= 1;
        dropped += 1;
        cargo.push({
          x: clamp(player.x + awayX / awayLength * 24, 35, 925),
          y: clamp(player.y + awayY / awayLength * 24, 35, 565),
          index: cargo.length,
          active: true,
          bob: 0,
          pickupDelay: 0.7
        });
        showMessage("A box fell off the cart.", 2.2);
      } else {
        showMessage("Watch the forklift lanes.", 2.2);
      }
      burst(player.x, player.y, [0.9, 0.34, 0.24, 1], 24);
      playCollision();
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.94, dt * 60);
      particle.vy *= Math.pow(0.94, dt * 60);
      if (particle.life <= 0) particles.splice(i, 1);
    }
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 25 + Math.random() * 95;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.45,
        maxLife: 0.8,
        color
      });
    }
  }

  function updateHud() {
    ui.delivered.textContent = String(delivered);
    ui.time.textContent = formatTime(Math.max(0, GAME_LENGTH - elapsed));
    Array.from(ui.slots.children).forEach((slot, index) => {
      slot.classList.toggle("filled", index < (player?.carry ?? 0));
    });
  }

  function showMessage(text, duration) {
    ui.message.textContent = text;
    ui.message.classList.remove("hidden");
    messageTime = duration;
  }

  function finish(won) {
    if (state !== "playing") return;
    state = won ? "won" : "lost";
    ui.hud.classList.add("hidden");
    ui.touchControls.classList.add("hidden");
    ui.message.classList.add("hidden");
    ui.result.classList.remove("hidden");
    ui.resultLabel.textContent = won ? "Shift complete" : "Time is up";
    ui.resultTitle.textContent = won ? "All boxes delivered" : `${delivered} of ${TOTAL_CARGO} delivered`;
    ui.resultText.textContent = won
      ? "The run data shows how much you chose to carry between deliveries."
      : "The unfinished run still shows how you balanced load size against movement.";
    const averageLoad = deposits ? (depositedCargo / deposits).toFixed(1) : "0";
    const stats = [
      [String(deposits), "Trips to loading area"],
      [averageLoad, "Average boxes per trip"],
      [String(maxLoad), "Largest load"],
      [String(collisions), "Forklift collisions"],
      [String(dropped), "Boxes knocked loose"],
      [`${heavyTime.toFixed(1)}s`, "Time carrying 4 or 5"]
    ];
    ui.stats.innerHTML = stats.map(([value, label]) =>
      `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`
    ).join("");
    if (won) playWin();
  }

  function formatTime(seconds) {
    const whole = Math.ceil(seconds);
    const minutes = Math.floor(whole / 60);
    const remainder = String(whole % 60).padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function draw() {
    const width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.17, 0.19, 0.21, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    positions.length = 0;
    colors.length = 0;

    drawWarehouse();

    const scale = Math.min(width / WORLD.width, height / WORLD.height);
    const viewWidth = width / scale;
    const viewHeight = height / scale;
    const offsetX = (viewWidth - WORLD.width) / 2;
    const offsetY = (viewHeight - WORLD.height) / 2;
    const shakeX = screenShake ? (Math.random() - 0.5) * screenShake : 0;
    const shakeY = screenShake ? (Math.random() - 0.5) * screenShake : 0;

    for (let i = 0; i < positions.length; i += 2) {
      positions[i] = (positions[i] + offsetX + shakeX) * scale;
      positions[i + 1] = (positions[i + 1] + offsetY + shakeY) * scale;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    gl.uniform2f(resolutionLocation, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2);
  }

  function drawWarehouse() {
    rect(0, 0, WORLD.width, WORLD.height, [0.24, 0.26, 0.27, 1]);

    for (let x = 20; x < WORLD.width; x += 40) {
      rect(x, 20, 1, WORLD.height - 40, [0.36, 0.38, 0.38, 0.25]);
    }
    for (let y = 20; y < WORLD.height; y += 40) {
      rect(20, y, WORLD.width - 40, 1, [0.36, 0.38, 0.38, 0.25]);
    }

    rect(dock.x, dock.y, dock.w, dock.h, [0.18, 0.31, 0.22, 1]);
    for (let y = dock.y - 20; y < dock.y + dock.h + 20; y += 24) {
      rect(dock.x + dock.w - 10, y, 14, 12, [0.95, 0.72, 0.18, 0.9]);
      rect(dock.x + dock.w - 10, y + 12, 14, 12, [0.12, 0.13, 0.13, 0.9]);
    }
    rect(dock.x + 20, dock.y + 24, 60, 8, [0.36, 0.55, 0.39, 1]);
    rect(dock.x + 20, dock.y + dock.h - 32, 60, 8, [0.36, 0.55, 0.39, 1]);

    walls.forEach((wall, index) => {
      if (index < 4) {
        rect(wall.x, wall.y, wall.w, wall.h, [0.11, 0.12, 0.13, 1]);
        return;
      }
      rect(wall.x, wall.y, wall.w, wall.h, [0.16, 0.20, 0.23, 1]);
    });

    cargo.forEach((box) => {
      if (!box.active) return;
      const bob = Math.sin(box.bob) * 1.5;
      rect(box.x - 11, box.y - 10 + bob, 22, 20, [0.92, 0.66, 0.18, 1]);
      rect(box.x - 11, box.y - 10 + bob, 22, 3, [1, 0.82, 0.37, 1]);
      rect(box.x - 2, box.y - 10 + bob, 4, 20, [0.55, 0.36, 0.1, 0.7]);
    });

    forklifts.forEach((forklift) => {
      rotatedRect(forklift.x, forklift.y, 40, 26, forklift.angle, [0.9, 0.38, 0.12, 1]);
      const frontX = forklift.x + Math.cos(forklift.angle) * 26;
      const frontY = forklift.y + Math.sin(forklift.angle) * 26;
      rotatedRect(frontX, frontY - Math.cos(forklift.angle) * 7, 24, 4, forklift.angle, [0.12, 0.13, 0.13, 1]);
      rotatedRect(frontX, frontY + Math.cos(forklift.angle) * 7, 24, 4, forklift.angle, [0.12, 0.13, 0.13, 1]);
      circle(forklift.x - Math.cos(forklift.angle) * 12, forklift.y - Math.sin(forklift.angle) * 12, 6, [0.08, 0.09, 0.09, 1]);
    });

    particles.forEach((particle) => {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      circle(particle.x, particle.y, 2.2, [particle.color[0], particle.color[1], particle.color[2], alpha], 8);
    });

    if (player) {
      const blink = player.invulnerable > 0 && Math.floor(player.invulnerable * 10) % 2 === 0;
      const playerAlpha = blink ? 0.35 : 1;
      circle(player.x, player.y, 16, [0.07, 0.29, 0.45, playerAlpha]);
      circle(player.x, player.y, 13, [0.12, 0.48, 0.72, playerAlpha]);
      circle(
        player.x + Math.cos(player.angle) * 7,
        player.y + Math.sin(player.angle) * 7,
        3.2,
        [0.76, 0.91, 0.98, playerAlpha],
        14
      );
      for (let i = 0; i < player.carry; i += 1) {
        const row = Math.floor(i / 3);
        const column = i % 3;
        rect(player.x - 12 + column * 9, player.y + 16 + row * 8, 7, 7, [0.95, 0.72, 0.22, blink ? 0.35 : 1]);
      }
    }
  }

  function ensureAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
  }

  function tone(frequency, duration, type = "square", volume = 0.025, delay = 0) {
    if (!audioContext) return;
    const start = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playPickup() {
    tone(330, 0.11, "square", 0.025);
    tone(440, 0.12, "square", 0.02, 0.07);
  }

  function playDeposit() {
    tone(220, 0.12, "triangle", 0.03);
    tone(330, 0.16, "triangle", 0.03, 0.08);
    tone(495, 0.2, "triangle", 0.025, 0.16);
  }

  function playCollision() {
    tone(80, 0.25, "sawtooth", 0.035);
    tone(55, 0.28, "square", 0.02, 0.04);
  }

  function playWin() {
    [262, 330, 392, 523].forEach((frequency, index) => tone(frequency, 0.35, "triangle", 0.026, index * 0.1));
  }

  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - previousTime) / 1000));
    previousTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
    keys[event.code] = true;
    if (event.code === "KeyR" && !event.repeat) startGame();
    if ((event.code === "Enter" || event.code === "Space") && state === "intro" && !event.repeat) startGame();
  });

  window.addEventListener("keyup", (event) => { keys[event.code] = false; });
  window.addEventListener("blur", () => {
    Object.keys(keys).forEach((key) => { keys[key] = false; });
  });

  document.querySelectorAll(".touch-controls button").forEach((button) => {
    const code = button.dataset.key;
    const down = (event) => { event.preventDefault(); keys[code] = true; };
    const up = (event) => { event.preventDefault(); keys[code] = false; };
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
  });

  ui.start.addEventListener("click", startGame);
  ui.restart.addEventListener("click", startGame);
  resetGame();
  requestAnimationFrame(frame);
})();
