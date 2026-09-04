/* ==========================================================================
   VOIDBREAKER — a low-poly 3D arcade survival shooter.
   Pure vanilla JS + Three.js (UMD global THREE). No build step, no assets.
   ========================================================================== */
(function () {
'use strict';

/* --------------------------------------------------------------------------
   0. Boot guard
   -------------------------------------------------------------------------- */
var loadMsg = document.getElementById('load-msg');
if (typeof THREE === 'undefined') {
  loadMsg.className = 'error';
  loadMsg.innerHTML = 'Three.js failed to load.<br>Check your connection, then reload.<br>' +
                      '(Offline? Drop three.min.js next to index.html and point the script tag at it.)';
  document.querySelector('.loader').style.display = 'none';
  return;
}

/* --------------------------------------------------------------------------
   1. Tuning
   -------------------------------------------------------------------------- */
const CFG = {
  arena: 66,                 // full width of the square arena
  wallH: 3.2,

  player: {
    radius: 0.85,
    speed: 19,
    accel: 120,
    friction: 12,
    maxHp: 100,
    fireRate: 0.15,          // seconds between shots
    bulletSpeed: 62,
    bulletDmg: 11,
    dashSpeed: 62,
    dashTime: 0.16,
    dashCd: 1.15,
    iFrames: 0.7
  },

  orb: { value: 40, magnet: 7.5, pickup: 1.5, life: 15 },

  combo: { window: 3.2, perTier: 4, maxMult: 8 },

  camera: { height: 44, back: 29, fov: 52, lag: 6, aimLead: 0.14, halfSpanX: 16 },

  maxParticles: 900
};

// Enemy archetypes. `cost` feeds the wave budget; `w` is spawn weight.
const ENEMY = {
  grunt:    { hp: 22,  speed: 6.2,  dmg: 12, score: 100, radius: 0.95, cost: 1,   color: 0xff1f3d, accent: 0xff7a88 },
  sprinter: { hp: 13,  speed: 13.5, dmg: 10, score: 160, radius: 0.75, cost: 1.5, color: 0xffcf4d, accent: 0xfff0b8 },
  tank:     { hp: 78,  speed: 3.6,  dmg: 24, score: 320, radius: 1.7,  cost: 4,   color: 0xb14dff, accent: 0xe0b8ff },
  shooter:  { hp: 28,  speed: 5.4,  dmg: 10, score: 240, radius: 0.95, cost: 3,   color: 0x4dff9e, accent: 0xc4ffe2 },
  warden:   { hp: 620, speed: 4.1,  dmg: 32, score: 4000, radius: 3.1, cost: 0,   color: 0xff2fb3, accent: 0xffb3e6 }
};

const POWERUPS = {
  RAPID:  { time: 10, color: 0xffcf4d, label: 'RAPID FIRE' },
  TRIPLE: { time: 12, color: 0x00e5ff, label: 'TRIPLE SHOT' },
  SHIELD: { time: 14, color: 0x4dff9e, label: 'SHIELD' }
};

const HS_KEY = 'voidbreaker.highscore.v1';
const MUTE_KEY = 'voidbreaker.muted.v1';

/* --------------------------------------------------------------------------
   2. Small helpers
   -------------------------------------------------------------------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Framerate-independent exponential smoothing.
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

/**
 * Squared distance from point (cx,cz) to the segment (ax,az)->(bx,bz).
 * Bullets cover more ground per frame than their own radius, so hits are tested
 * against the swept segment rather than the end point — otherwise fast shots
 * tunnel straight through targets whenever a frame runs long.
 */
function segDistSq(ax, az, bx, bz, cx, cz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const px = ax + dx * t - cx, pz = az + dz * t - cz;
  return px * px + pz * pz;
}

/* --------------------------------------------------------------------------
   3. Audio — everything synthesized with the Web Audio API
   -------------------------------------------------------------------------- */
const Sound = (function () {
  let ctx = null, master = null, muted = false;

  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* private mode */ }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    // A little compression keeps dense waves from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 8;
    master.connect(comp);
    comp.connect(ctx.destination);
  }

  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function ok() { return ctx && !muted; }

  /** One shaped oscillator voice. */
  function tone(o) {
    if (!ok()) return;
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.vol), t + (o.atk || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.filter) {
      const flt = ctx.createBiquadFilter();
      flt.type = o.filter;
      flt.frequency.value = o.fc || 1200;
      node.connect(flt); node = flt;
    }
    node.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  }

  /** Filtered noise burst — used for impacts and explosions. */
  function noise(o) {
    if (!ok()) return;
    const t = ctx.currentTime + (o.delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = o.filter || 'lowpass';
    flt.frequency.setValueAtTime(o.fc || 900, t);
    if (o.fc1) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.fc1), t + o.dur);
    flt.Q.value = o.q || 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(flt); flt.connect(gain); gain.connect(master);
    src.start(t);
  }

  return {
    resume: resume,
    isMuted: () => muted,
    toggleMute: function () {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      return muted;
    },

    shoot: function () {
      tone({ type: 'square', f0: 880, f1: 240, dur: 0.09, vol: 0.055, filter: 'lowpass', fc: 2600 });
      noise({ dur: 0.05, vol: 0.03, fc: 3200, fc1: 800 });
    },
    enemyShoot: function () {
      tone({ type: 'sawtooth', f0: 300, f1: 120, dur: 0.14, vol: 0.05, filter: 'lowpass', fc: 1400 });
    },
    hit: function () {
      noise({ dur: 0.07, vol: 0.09, fc: 2400, fc1: 500, filter: 'bandpass', q: 1.2 });
    },
    explode: function (big) {
      noise({ dur: big ? 0.75 : 0.34, vol: big ? 0.5 : 0.26, fc: big ? 1400 : 1000, fc1: 60 });
      tone({ type: 'sine', f0: big ? 150 : 220, f1: big ? 28 : 45, dur: big ? 0.6 : 0.3, vol: big ? 0.32 : 0.16 });
    },
    pickup: function (n) {
      const base = 660 * Math.pow(1.06, Math.min(n || 0, 14));
      tone({ type: 'triangle', f0: base, f1: base * 1.5, dur: 0.1, vol: 0.1 });
      tone({ type: 'sine', f0: base * 2, f1: base * 3, dur: 0.09, vol: 0.05, delay: 0.03 });
    },
    power: function () {
      [523, 659, 784, 1046].forEach((f, i) =>
        tone({ type: 'triangle', f0: f, f1: f, dur: 0.16, vol: 0.11, delay: i * 0.06 }));
    },
    heal: function () {
      tone({ type: 'sine', f0: 420, f1: 880, dur: 0.28, vol: 0.12 });
    },
    hurt: function () {
      tone({ type: 'sawtooth', f0: 260, f1: 60, dur: 0.34, vol: 0.22, filter: 'lowpass', fc: 900 });
      noise({ dur: 0.22, vol: 0.16, fc: 700, fc1: 90 });
    },
    dash: function () {
      tone({ type: 'sine', f0: 200, f1: 1100, dur: 0.16, vol: 0.09 });
      noise({ dur: 0.16, vol: 0.06, fc: 400, fc1: 4000, filter: 'highpass' });
    },
    wave: function () {
      [392, 523, 659].forEach((f, i) =>
        tone({ type: 'square', f0: f, f1: f, dur: 0.22, vol: 0.09, delay: i * 0.1, filter: 'lowpass', fc: 2200 }));
    },
    boss: function () {
      [110, 82, 110, 147].forEach((f, i) =>
        tone({ type: 'sawtooth', f0: f, f1: f * 0.98, dur: 0.42, vol: 0.16, delay: i * 0.18, filter: 'lowpass', fc: 700 }));
    },
    gameOver: function () {
      [523, 415, 330, 220, 147].forEach((f, i) =>
        tone({ type: 'triangle', f0: f, f1: f * 0.97, dur: 0.5, vol: 0.15, delay: i * 0.17 }));
      noise({ dur: 1.4, vol: 0.14, fc: 800, fc1: 40, delay: 0.1 });
    }
  };
})();

/* --------------------------------------------------------------------------
   4. Input — keyboard, mouse and dual virtual sticks
   -------------------------------------------------------------------------- */
const Input = (function () {
  const keys = Object.create(null);
  const mouse = { x: 0, y: 0, ndc: new THREE.Vector2(), down: false, moved: false };
  const move = { x: 0, y: 0 };     // touch move stick, -1..1
  const aim = { x: 0, y: 0, active: false };
  let dashRequest = false;
  const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches ||
                  ('ontouchstart' in window && navigator.maxTouchPoints > 1);

  addEventListener('keydown', function (e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    keys[k] = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) e.preventDefault();
    if (k === 'shift') dashRequest = true;
    Game.onKey(k);
  });
  addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });

  const view = document.getElementById('viewport');
  addEventListener('mousemove', function (e) {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.moved = true;
    mouse.ndc.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  });
  view.addEventListener('mousedown', function (e) {
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) dashRequest = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
  view.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---- virtual sticks ---- */
  function bindStick(zoneId, state, onRelease) {
    const zone = document.getElementById(zoneId);
    const base = zone.querySelector('.stick-base');
    const knob = zone.querySelector('.stick-knob');
    let id = null, ox = 0, oy = 0;
    const R = 52;

    function start(t) {
      id = t.identifier; ox = t.clientX; oy = t.clientY;
      base.style.left = ox + 'px'; base.style.top = oy + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%,-50%)';
      state.active = true;
    }
    function move2(t) {
      let dx = t.clientX - ox, dy = t.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px))';
      state.x = dx / R; state.y = dy / R;
    }
    function end() {
      id = null; state.x = 0; state.y = 0; state.active = false;
      base.classList.remove('active');
      knob.style.transform = 'translate(-50%,-50%)';
      if (onRelease) onRelease();
    }

    zone.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (id === null) { start(e.changedTouches[0]); move2(e.changedTouches[0]); }
    }, { passive: false });
    zone.addEventListener('touchmove', function (e) {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move2(t);
    }, { passive: false });
    const stop = function (e) {
      for (const t of e.changedTouches) if (t.identifier === id) end();
    };
    zone.addEventListener('touchend', stop);
    zone.addEventListener('touchcancel', stop);
  }

  bindStick('stick-move', move);
  bindStick('stick-aim', aim);
  const dashBtn = document.getElementById('btn-dash');
  dashBtn.addEventListener('touchstart', function (e) { e.preventDefault(); dashRequest = true; }, { passive: false });

  return {
    isTouch: isTouch,
    keys: keys,
    mouse: mouse,
    aimStick: aim,

    /** Movement intent in screen space, magnitude <= 1. */
    moveVector: function (out) {
      let x = 0, y = 0;
      if (keys['a'] || keys['arrowleft']) x -= 1;
      if (keys['d'] || keys['arrowright']) x += 1;
      if (keys['w'] || keys['arrowup']) y -= 1;
      if (keys['s'] || keys['arrowdown']) y += 1;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      x += move.x; y += move.y;
      const m2 = Math.hypot(x, y);
      if (m2 > 1) { x /= m2; y /= m2; }
      out.set(x, y);
      return out;
    },

    firing: function () {
      return mouse.down || !!keys[' '] || aim.active;
    },

    consumeDash: function () {
      const d = dashRequest; dashRequest = false; return d;
    }
  };
})();

/* --------------------------------------------------------------------------
   5. Renderer, scene, arena
   -------------------------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Input.isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
// ACES desaturates saturated emissives toward white, which flattens the neon
// palette; linear keeps the arcade colours intact.
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('viewport').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060f);
scene.fog = new THREE.Fog(0x05060f, 60, 155);

const camera = new THREE.PerspectiveCamera(CFG.camera.fov, innerWidth / innerHeight, 0.5, 400);
camera.position.set(0, CFG.camera.height, CFG.camera.back);
camera.lookAt(0, 0, 0);

// A 16:9 window already sees the whole arena width. Narrow windows (a phone in
// portrait) don't, so the rig backs off until at least `halfSpanX` world units are
// visible either side of the player — capped, so the pod never shrinks to a speck.
let frameScale = 1;
function reframe() {
  const vfov = camera.fov * Math.PI / 360;
  const base = Math.hypot(CFG.camera.height, CFG.camera.back);
  const needed = CFG.camera.halfSpanX / (Math.tan(vfov) * camera.aspect);
  frameScale = clamp(needed / base, 1, 1.5);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  reframe();
}
addEventListener('resize', onResize);
reframe();

/* ---- lighting ---- */
scene.add(new THREE.HemisphereLight(0x35507f, 0x08080f, 0.24));

const keyLight = new THREE.DirectionalLight(0xbfd8ff, 0.75);
keyLight.position.set(28, 54, 20);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 10;
keyLight.shadow.camera.far = 140;
const S = CFG.arena * 0.62;
keyLight.shadow.camera.left = -S;
keyLight.shadow.camera.right = S;
keyLight.shadow.camera.top = S;
keyLight.shadow.camera.bottom = -S;
keyLight.shadow.bias = -0.0012;
scene.add(keyLight);
scene.add(keyLight.target);

const rimLight = new THREE.DirectionalLight(0xff2fb3, 0.35);
rimLight.position.set(-30, 18, -28);
scene.add(rimLight);

// Travels with the player so the pod always reads against the dark floor.
const playerLight = new THREE.PointLight(0x00e5ff, 1.9, 28, 2);
playerLight.position.set(0, 4, 0);
scene.add(playerLight);

/* ---- floor: procedural grid texture, no external assets ---- */
function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#070c18';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,229,255,0.22)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  g.strokeStyle = 'rgba(0,229,255,0.07)';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = i * 64;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(CFG.arena / 6, CFG.arena / 6);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(CFG.arena, CFG.arena),
  new THREE.MeshStandardMaterial({ map: makeGridTexture(), roughness: 0.85, metalness: 0.15 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Dim skirt so the arena doesn't float on nothing when the camera swings.
const skirt = new THREE.Mesh(
  new THREE.PlaneGeometry(CFG.arena * 5, CFG.arena * 5),
  new THREE.MeshBasicMaterial({ color: 0x070912 })
);
skirt.rotation.x = -Math.PI / 2;
skirt.position.y = -0.35;
scene.add(skirt);

/* ---- arena walls: emissive pillars + energy fence ---- */
(function buildWalls() {
  const H = CFG.arena / 2;
  const pillarGeo = new THREE.BoxGeometry(1.5, CFG.wallH, 1.5);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x0a1526, emissive: 0x00b8d4, emissiveIntensity: 0.22,
    roughness: 0.6, metalness: 0.3, flatShading: true
  });
  const step = 6;
  const count = Math.floor(CFG.arena / step);
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, count * 4 + 4);
  pillars.castShadow = true;
  const d = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i <= count; i++) {
    const p = -H + i * step;
    const spots = [[p, -H], [p, H], [-H, p], [H, p]];
    for (const s of spots) {
      d.position.set(s[0], CFG.wallH / 2, s[1]);
      d.rotation.y = (i % 2) * 0.2;
      d.updateMatrix();
      if (n < pillars.count) pillars.setMatrixAt(n++, d.matrix);
    }
  }
  pillars.count = n;
  scene.add(pillars);

  // Translucent containment field.
  const fenceMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false
  });
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(CFG.arena, CFG.wallH * 1.5), fenceMat);
    w.position.y = CFG.wallH * 0.75;
    if (i === 0) { w.position.z = -H; }
    else if (i === 1) { w.position.z = H; }
    else if (i === 2) { w.position.x = -H; w.rotation.y = Math.PI / 2; }
    else { w.position.x = H; w.rotation.y = Math.PI / 2; }
    scene.add(w);
  }
})();

/* ---- starfield backdrop ---- */
(function buildStars() {
  const N = 900, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = rand(120, 260);
    const th = rand(0, TAU), ph = Math.acos(rand(-0.25, 1));
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.6 + 20;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    c.setHSL(rand(0.5, 0.85), rand(0.3, 0.9), rand(0.5, 0.9));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({
    size: 1.5, vertexColors: true, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9
  }));
  stars.name = 'stars';
  scene.add(stars);
})();

/* --------------------------------------------------------------------------
   6. Particles — one InstancedMesh of cubes, pooled
   -------------------------------------------------------------------------- */
const Particles = (function () {
  const MAX = CFG.maxParticles;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    MAX
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const P = [];
  for (let i = 0; i < MAX; i++) {
    P.push({
      idx: i,
      alive: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      life: 0, maxLife: 1, size: 1, spin: new THREE.Vector3(),
      rot: new THREE.Euler(), grav: -34, drag: 1.4, fade: true
    });
  }
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  let cursor = 0;

  function alloc() {
    for (let i = 0; i < MAX; i++) {
      const p = P[cursor];
      cursor = (cursor + 1) % MAX;
      if (!p.alive) return p;
    }
    return P[cursor]; // all busy: steal the oldest slot
  }

  function emit(o) {
    const n = o.count || 10;
    for (let i = 0; i < n; i++) {
      const p = alloc();
      p.alive = true;
      p.pos.copy(o.pos);
      if (o.spread) {
        p.pos.x += rand(-o.spread, o.spread);
        p.pos.y += rand(-o.spread, o.spread);
        p.pos.z += rand(-o.spread, o.spread);
      }
      const sp = rand(o.speed0 || 4, o.speed1 || 14);
      if (o.dir) {
        // cone around a direction
        p.vel.copy(o.dir).normalize()
          .add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(o.cone === undefined ? 0.5 : o.cone))
          .normalize().multiplyScalar(sp);
      } else {
        const th = rand(0, TAU), ph = Math.acos(rand(-1, 1));
        p.vel.set(Math.sin(ph) * Math.cos(th), Math.abs(Math.cos(ph)) * 0.9 + 0.15, Math.sin(ph) * Math.sin(th))
          .multiplyScalar(sp);
      }
      p.maxLife = p.life = rand(o.life0 || 0.35, o.life1 || 0.9);
      p.size = rand(o.size0 || 0.18, o.size1 || 0.5);
      p.grav = o.grav === undefined ? -34 : o.grav;
      p.drag = o.drag === undefined ? 1.4 : o.drag;
      p.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      p.rot.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      color.set(Array.isArray(o.color) ? pick(o.color) : o.color);
      if (o.jitter) color.offsetHSL(rand(-o.jitter, o.jitter), 0, rand(-0.1, 0.15));
      mesh.setColorAt(p.idx, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    for (let i = 0; i < MAX; i++) {
      const p = P[i];
      if (!p.alive) { dummy.scale.setScalar(0); dummy.position.set(0, -999, 0); }
      else {
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          dummy.scale.setScalar(0); dummy.position.set(0, -999, 0);
        } else {
          const k = Math.exp(-p.drag * dt);
          p.vel.multiplyScalar(k);
          p.vel.y += p.grav * dt;
          p.pos.addScaledVector(p.vel, dt);
          if (p.pos.y < 0.08) { p.pos.y = 0.08; p.vel.y *= -0.42; p.vel.x *= 0.7; p.vel.z *= 0.7; }
          p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
          const t = p.life / p.maxLife;
          dummy.position.copy(p.pos);
          dummy.rotation.copy(p.rot);
          dummy.scale.setScalar(p.size * (p.fade ? (0.25 + 0.75 * t) : 1));
        }
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < MAX; i++) P[i].alive = false;
    update(0.016);
  }

  return { emit: emit, update: update, clear: clear, mesh: mesh };
})();

/* --------------------------------------------------------------------------
   7. Generic object pool
   -------------------------------------------------------------------------- */
function Pool(factory) {
  this.factory = factory;
  this.free = [];
  this.active = [];
}
Pool.prototype.get = function () {
  const o = this.free.length ? this.free.pop() : this.factory();
  o.alive = true;
  o.mesh.visible = true;
  this.active.push(o);
  return o;
};
Pool.prototype.release = function (o) {
  o.alive = false;
  o.mesh.visible = false;
  const i = this.active.indexOf(o);
  if (i >= 0) this.active.splice(i, 1);
  this.free.push(o);
};
Pool.prototype.releaseAll = function () {
  while (this.active.length) this.release(this.active[this.active.length - 1]);
};

/* --------------------------------------------------------------------------
   8. Entity construction
   -------------------------------------------------------------------------- */
const HALF = CFG.arena / 2;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

/* ---- player pod ---- */
const player = {
  mesh: new THREE.Group(),
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  aim: new THREE.Vector3(0, 0, -1),
  hp: CFG.player.maxHp,
  alive: true,
  fireCd: 0,
  dashCd: 0,
  dashT: 0,
  invuln: 0,
  shield: 0,
  radius: CFG.player.radius
};

(function buildPlayer() {
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x092434, emissive: 0x00e5ff, emissiveIntensity: 0.7,
    roughness: 0.4, metalness: 0.5, flatShading: true
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x9bfaff, toneMapped: false });

  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.2, 5), bodyMat);
  hull.rotation.x = -Math.PI / 2;   // point down -Z
  hull.position.y = 0.85;
  hull.castShadow = true;
  player.mesh.add(hull);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glowMat);
  core.position.set(0, 0.95, 0.25);
  player.mesh.add(core);
  player.core = core;

  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 1.15), bodyMat);
    fin.position.set(sx * 0.72, 0.62, 0.5);
    fin.rotation.z = sx * 0.28;
    fin.castShadow = true;
    player.mesh.add(fin);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.4, 6),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  player.mesh.add(ring);
  player.ring = ring;

  // Shield bubble, shown only while the SHIELD power-up is up.
  const bubble = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.9, 1),
    new THREE.MeshBasicMaterial({ color: 0x4dff9e, wireframe: true, transparent: true, opacity: 0.55, toneMapped: false })
  );
  bubble.position.y = 1;
  bubble.visible = false;
  player.mesh.add(bubble);
  player.bubble = bubble;

  scene.add(player.mesh);
})();

/* ---- aim reticle on the ground ---- */
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.8, 4),
  new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, toneMapped: false })
);
reticle.rotation.x = -Math.PI / 2;
reticle.position.y = 0.05;
scene.add(reticle);

/* ---- bullets ---- */
const bulletGeo = new THREE.BoxGeometry(0.24, 0.24, 1.5);
function makeBullet(color) {
  const mesh = new THREE.Mesh(bulletGeo, new THREE.MeshBasicMaterial({ color: color, toneMapped: false }));
  mesh.visible = false;
  scene.add(mesh);
  return { mesh: mesh, vel: new THREE.Vector3(), life: 0, dmg: 0, radius: 0.35, alive: false };
}
const playerBullets = new Pool(() => makeBullet(0x9bfaff));
const enemyBullets = new Pool(() => {
  const b = makeBullet(0xff6b3d);
  b.mesh.scale.set(1.5, 1.5, 0.9);
  return b;
});

/* ---- enemies ---- */
function buildEnemyMesh(type) {
  const S = ENEMY[type];
  const g = new THREE.Group();
  // A bright albedo washes out to near-white under ACES tone mapping, so the body
  // is kept dark and the colour comes from the emissive channel instead.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(S.color).multiplyScalar(0.22),
    emissive: S.color, emissiveIntensity: 0.75,
    roughness: 0.55, metalness: 0.2, flatShading: true
  });
  let body;
  if (type === 'grunt') {
    body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat);
    body.position.y = 0.85;
  } else if (type === 'sprinter') {
    body = new THREE.Mesh(new THREE.TetrahedronGeometry(1.1, 0), mat);
    body.position.y = 0.85;
  } else if (type === 'tank') {
    body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.75, 0), mat);
    body.position.y = 1.5;
  } else if (type === 'shooter') {
    body = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), mat);
    body.position.y = 1.2;
  } else { // warden
    body = new THREE.Mesh(new THREE.IcosahedronGeometry(3.0, 0), mat);
    body.position.y = 3.2;
  }
  body.castShadow = true;
  g.add(body);

  const accent = new THREE.Mesh(
    body.geometry,
    new THREE.MeshBasicMaterial({ color: S.accent, wireframe: true, transparent: true, opacity: 0.42, toneMapped: false })
  );
  accent.position.copy(body.position);
  accent.scale.setScalar(1.06);
  g.add(accent);

  g.visible = false;
  scene.add(g);
  return { group: g, body: body, mat: mat, accent: accent };
}

const enemyPools = {};
for (const type in ENEMY) {
  enemyPools[type] = new Pool((function (t) {
    return function () {
      const built = buildEnemyMesh(t);
      return {
        type: t, mesh: built.group, body: built.body, mat: built.mat, accent: built.accent,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        hp: 1, maxHp: 1, radius: 1, speed: 1, dmg: 1, score: 1,
        flash: 0, t: rand(0, 10), fireCd: 0, state: 0, stateT: 0, alive: false, boss: t === 'warden'
      };
    };
  })(type));
}
const enemies = [];

/* ---- pickups: score orbs, health, power-ups ---- */
const orbGeo = new THREE.OctahedronGeometry(0.44, 0);
const pickups = new Pool(function () {
  const g = new THREE.Group();
  const core = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({
    color: 0xffcf4d, emissive: 0xffcf4d, emissiveIntensity: 1.1, roughness: 0.3, flatShading: true
  }));
  core.position.y = 0.8;
  g.add(core);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.78, 8),
    new THREE.MeshBasicMaterial({ color: 0xffcf4d, transparent: true, opacity: 0.4, side: THREE.DoubleSide, toneMapped: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.06;
  g.add(halo);
  g.visible = false;
  scene.add(g);
  return {
    mesh: g, core: core, halo: halo, kind: 'orb', key: null,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    life: 0, t: 0, value: 0, alive: false
  };
});

function spawnPickup(kind, pos, key) {
  const p = pickups.get();
  p.kind = kind;
  p.key = key || null;
  p.pos.copy(pos);
  p.pos.y = 0;
  p.vel.set(rand(-5, 5), rand(7, 12), rand(-5, 5));
  p.life = kind === 'orb' ? CFG.orb.life : CFG.orb.life * 1.6;
  p.t = rand(0, 6);
  p.value = CFG.orb.value;

  let col = 0xffcf4d, scale = 1;
  if (kind === 'health') { col = 0x4dff9e; scale = 1.25; }
  else if (kind === 'power') { col = POWERUPS[key].color; scale = 1.35; }
  p.core.material.color.setHex(col);
  p.core.material.emissive.setHex(col);
  p.halo.material.color.setHex(col);
  p.core.scale.setScalar(scale);
  p.mesh.position.copy(p.pos);
  return p;
}

/* ---- spawn telegraph rings ---- */
const spawnMarks = new Pool(function () {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.5, 20),
    new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.07;
  m.visible = false;
  scene.add(m);
  return { mesh: m, pos: new THREE.Vector3(), t: 0, dur: 1, type: 'grunt', alive: false };
});

/* --------------------------------------------------------------------------
   9. UI references
   -------------------------------------------------------------------------- */
const UI = {
  hud: document.getElementById('hud'),
  score: document.getElementById('hud-score'),
  best: document.getElementById('hud-best'),
  wave: document.getElementById('hud-wave'),
  remaining: document.getElementById('hud-remaining'),
  mult: document.getElementById('hud-mult'),
  comboFill: document.getElementById('hud-combo-fill'),
  hpFill: document.getElementById('hud-hp-fill'),
  hpGhost: document.getElementById('hud-hp-ghost'),
  hpText: document.getElementById('hud-hp-text'),
  dashFill: document.getElementById('hud-dash-fill'),
  powerups: document.getElementById('hud-powerups'),
  banner: document.getElementById('wave-banner'),
  bannerText: document.getElementById('wave-banner-text'),
  toasts: document.getElementById('toasts'),
  vignette: document.getElementById('damage-vignette'),
  bossBar: document.getElementById('boss-bar'),
  bossFill: document.getElementById('boss-fill'),
  touch: document.getElementById('touch-ui'),
  screens: {
    load: document.getElementById('screen-load'),
    start: document.getElementById('screen-start'),
    pause: document.getElementById('screen-pause'),
    over: document.getElementById('screen-over')
  },
  startBest: document.getElementById('start-best'),
  pauseScore: document.getElementById('pause-score'),
  pauseWave: document.getElementById('pause-wave'),
  overScore: document.getElementById('over-score'),
  overWaves: document.getElementById('over-waves'),
  overKills: document.getElementById('over-kills'),
  overMult: document.getElementById('over-mult'),
  overTime: document.getElementById('over-time'),
  overBest: document.getElementById('over-best'),
  record: document.getElementById('new-record'),
  btnMute: document.getElementById('btn-mute')
};

function showScreen(name) {
  for (const k in UI.screens) UI.screens[k].classList.toggle('hidden', k !== name);
  if (name === null) for (const k in UI.screens) UI.screens[k].classList.add('hidden');
}

function toast(text, color) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  if (color) { el.style.color = color; el.style.borderColor = color; }
  UI.toasts.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/* --------------------------------------------------------------------------
   10. Game state machine
   -------------------------------------------------------------------------- */
const Game = {
  state: 'menu',          // menu | playing | paused | over
  score: 0,
  best: 0,
  kills: 0,
  wave: 0,
  wavesCleared: 0,
  combo: 0,
  comboT: 0,
  bestMult: 1,
  time: 0,
  shake: 0,
  spawnQueue: [],
  spawnTimer: 0,
  intermission: 0,
  boss: null,
  powers: {},             // key -> remaining seconds
  hudCache: {}
};

try { Game.best = parseInt(localStorage.getItem(HS_KEY) || '0', 10) || 0; } catch (e) { Game.best = 0; }
UI.startBest.textContent = Game.best.toLocaleString();
UI.best.textContent = Game.best.toLocaleString();
UI.btnMute.classList.toggle('off', Sound.isMuted());

function multiplier() {
  return clamp(1 + Math.floor(Game.combo / CFG.combo.perTier), 1, CFG.combo.maxMult);
}

function addScore(n) {
  Game.score += Math.round(n);
}

function addCombo() {
  Game.combo++;
  Game.comboT = CFG.combo.window;
  const m = multiplier();
  if (m > Game.bestMult) Game.bestMult = m;
}

/* --------------------------------------------------------------------------
   11. Wave director
   -------------------------------------------------------------------------- */
function waveBudget(w) { return 5 + w * 3.2; }

function availableTypes(w) {
  const t = ['grunt'];
  if (w >= 2) t.push('sprinter');
  if (w >= 4) t.push('shooter');
  if (w >= 6) t.push('tank');
  return t;
}

function buildWave(w) {
  const q = [];
  const isBoss = w % 5 === 0;
  let budget = waveBudget(w) * (isBoss ? 0.45 : 1);
  const types = availableTypes(w);
  let guard = 0;
  while (budget > 0.9 && guard++ < 200) {
    const t = pick(types);
    if (ENEMY[t].cost > budget + 0.5) continue;
    q.push(t);
    budget -= ENEMY[t].cost;
  }
  // Shuffle so the mix arrives interleaved rather than in runs.
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = q[i]; q[i] = q[j]; q[j] = tmp;
  }
  if (isBoss) q.unshift('warden');
  return q;
}

function startWave(w) {
  Game.wave = w;
  Game.spawnQueue = buildWave(w);
  Game.spawnTimer = 0.35;
  const isBoss = w % 5 === 0;
  UI.bannerText.textContent = isBoss ? 'WAVE ' + w + ' — WARDEN' : 'WAVE ' + w;
  UI.banner.style.color = isBoss ? '#ff2fb3' : '#00e5ff';
  UI.banner.classList.remove('hidden', 'show');
  void UI.banner.offsetWidth;
  UI.banner.classList.add('show');
  if (isBoss) Sound.boss(); else Sound.wave();
}

/** Picks a spawn point away from the player, biased toward arena edges. */
function spawnPoint(out) {
  // Ring around the player: far enough to be fair, near enough to stay on screen.
  for (let i = 0; i < 30; i++) {
    const a = rand(0, TAU);
    const r = rand(19, 29);
    const x = player.pos.x + Math.cos(a) * r;
    const z = player.pos.z + Math.sin(a) * r;
    if (x > -HALF + 3 && x < HALF - 3 && z > -HALF + 3 && z < HALF - 3) {
      out.set(x, 0, z);
      return out;
    }
  }
  // Cornered: fall back to the far side of the arena.
  out.set(clamp(-player.pos.x * 1.4, -HALF + 4, HALF - 4), 0,
          clamp(-player.pos.z * 1.4, -HALF + 4, HALF - 4));
  return out;
}

function queueSpawn(type) {
  const m = spawnMarks.get();
  spawnPoint(m.pos);
  m.type = type;
  m.dur = type === 'warden' ? 1.8 : 0.85;
  m.t = 0;
  m.mesh.position.copy(m.pos);
  m.mesh.position.y = 0.07;
  m.mesh.material.color.setHex(ENEMY[type].color);
  const s = ENEMY[type].radius;
  m.mesh.scale.setScalar(s);
}

function spawnEnemy(type, pos) {
  const S = ENEMY[type];
  const e = enemyPools[type].get();
  const w = Game.wave;
  const hpScale = type === 'warden'
    ? 1 + 0.55 * Math.floor((w - 1) / 5)
    : 1 + 0.07 * (w - 1);
  const spScale = Math.min(1.45, 1 + 0.018 * (w - 1));

  e.maxHp = e.hp = S.hp * hpScale;
  e.speed = S.speed * spScale;
  e.dmg = S.dmg;
  e.score = S.score;
  e.radius = S.radius;
  e.pos.copy(pos);
  e.pos.y = 0;
  e.vel.set(0, 0, 0);
  e.flash = 0;
  e.fireCd = rand(1.2, 2.6);
  e.state = 0;
  e.stateT = 0;
  e.t = rand(0, 10);
  e.mat.emissiveIntensity = 0.75;
  e.mesh.position.copy(e.pos);
  e.mesh.scale.setScalar(0.01);
  enemies.push(e);
  if (type === 'warden') {
    Game.boss = e;
    UI.bossBar.classList.remove('hidden');
  }
  Particles.emit({
    pos: new THREE.Vector3(pos.x, 1, pos.z), count: type === 'warden' ? 40 : 14,
    color: S.color, speed0: 6, speed1: 18, life0: 0.3, life1: 0.7, size0: 0.15, size1: 0.4
  });
  return e;
}

/* --------------------------------------------------------------------------
   12. Combat
   -------------------------------------------------------------------------- */
function firePlayerBullet(dir, spreadAngle) {
  const b = playerBullets.get();
  const d = tmpV.copy(dir);
  if (spreadAngle) d.applyAxisAngle(THREE.Object3D.DefaultUp, spreadAngle);
  b.vel.copy(d).normalize().multiplyScalar(CFG.player.bulletSpeed);
  b.dmg = CFG.player.bulletDmg;
  b.life = 1.5;
  b.mesh.position.set(player.pos.x + d.x * 1.2, 1.0, player.pos.z + d.z * 1.2);
  b.mesh.lookAt(b.mesh.position.x + b.vel.x, 1.0, b.mesh.position.z + b.vel.z);
}

function playerShoot() {
  const dir = tmpV2.copy(player.aim).setY(0).normalize();
  if (Game.powers.TRIPLE) {
    firePlayerBullet(dir, 0);
    firePlayerBullet(dir, 0.17);
    firePlayerBullet(dir, -0.17);
  } else {
    firePlayerBullet(dir, 0);
  }
  Sound.shoot();
  Particles.emit({
    pos: new THREE.Vector3(player.pos.x + dir.x * 1.4, 1.0, player.pos.z + dir.z * 1.4),
    count: 3, color: 0x9bfaff, dir: dir, cone: 0.4,
    speed0: 5, speed1: 12, life0: 0.1, life1: 0.22, size0: 0.1, size1: 0.22, grav: 0
  });
  Game.shake = Math.min(Game.shake + 0.05, 0.5);
}

function fireEnemyBullet(from, dir, speed, scale) {
  const b = enemyBullets.get();
  b.vel.copy(dir).normalize().multiplyScalar(speed);
  b.life = 4;
  b.dmg = 0;
  b.mesh.position.copy(from);
  b.mesh.scale.setScalar(scale || 1.4);
  b.radius = 0.45 * (scale || 1.4);
  b.mesh.lookAt(from.x + b.vel.x, from.y, from.z + b.vel.z);
  Sound.enemyShoot();
}

function damageEnemy(e, dmg, hitPos) {
  e.hp -= dmg;
  e.flash = 0.12;
  Particles.emit({
    pos: hitPos, count: 5, color: [ENEMY[e.type].color, ENEMY[e.type].accent, 0xffffff],
    speed0: 4, speed1: 12, life0: 0.15, life1: 0.4, size0: 0.1, size1: 0.28
  });
  if (e.hp <= 0) killEnemy(e);
  else Sound.hit();
}

function killEnemy(e) {
  const S = ENEMY[e.type];
  const boss = e.boss;
  addCombo();
  Game.kills++;
  addScore(e.score * multiplier());

  const at = new THREE.Vector3(e.pos.x, e.radius, e.pos.z);
  Particles.emit({
    pos: at, count: boss ? 120 : Math.round(14 + e.radius * 12),
    color: [S.color, S.accent, 0xffffff], jitter: 0.04,
    speed0: boss ? 10 : 6, speed1: boss ? 34 : 20,
    life0: 0.4, life1: boss ? 1.6 : 0.95,
    size0: 0.15, size1: boss ? 0.9 : 0.5, spread: e.radius * 0.6
  });
  Sound.explode(boss || e.type === 'tank');
  Game.shake = Math.min(Game.shake + (boss ? 1.6 : 0.28 + e.radius * 0.1), 2);

  // Loot
  const orbs = boss ? 14 : (e.type === 'tank' ? 4 : (e.type === 'shooter' ? 3 : randInt(1, 2)));
  for (let i = 0; i < orbs; i++) spawnPickup('orb', e.pos);
  if (!boss && Math.random() < (e.type === 'tank' ? 0.34 : 0.09)) spawnPickup('health', e.pos);
  const powerChance = boss ? 1 : (e.type === 'shooter' ? 0.12 : 0.05);
  if (Math.random() < powerChance) {
    spawnPickup('power', e.pos, pick(Object.keys(POWERUPS)));
  }

  // Tanks fracture into two grunts.
  if (e.type === 'tank') {
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Vector3(
        clamp(e.pos.x + rand(-2.5, 2.5), -HALF + 2, HALF - 2), 0,
        clamp(e.pos.z + rand(-2.5, 2.5), -HALF + 2, HALF - 2));
      const g = spawnEnemy('grunt', p);
      g.hp = g.maxHp = ENEMY.grunt.hp * 0.6;
    }
  }

  if (boss) {
    Game.boss = null;
    UI.bossBar.classList.add('hidden');
    toast('WARDEN DESTROYED  +' + (e.score * multiplier()).toLocaleString(), '#ff2fb3');
  }

  removeEnemy(e);
}

function removeEnemy(e) {
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
  enemyPools[e.type].release(e);
}

function damagePlayer(amount, fromPos) {
  if (!player.alive || player.invuln > 0 || player.dashT > 0) return;

  if (Game.powers.SHIELD) {
    delete Game.powers.SHIELD;
    player.invuln = 0.8;
    player.bubble.visible = false;
    Sound.hit();
    Game.shake = Math.min(Game.shake + 0.5, 2);
    Particles.emit({
      pos: new THREE.Vector3(player.pos.x, 1.2, player.pos.z), count: 30, color: 0x4dff9e,
      speed0: 8, speed1: 20, life0: 0.3, life1: 0.7, size0: 0.15, size1: 0.4
    });
    toast('SHIELD BROKEN', '#4dff9e');
    return;
  }

  player.hp -= amount;
  player.invuln = CFG.player.iFrames;
  Game.combo = 0;
  Game.comboT = 0;
  Sound.hurt();
  Game.shake = Math.min(Game.shake + 0.6 + amount * 0.02, 2.2);
  UI.vignette.classList.add('hit');
  setTimeout(() => UI.vignette.classList.remove('hit'), 60);

  const dir = fromPos
    ? tmpV.set(player.pos.x - fromPos.x, 0.4, player.pos.z - fromPos.z).normalize()
    : tmpV.set(0, 1, 0);
  Particles.emit({
    pos: new THREE.Vector3(player.pos.x, 1.1, player.pos.z), count: 18, color: [0xff4d5e, 0xffcf4d],
    dir: dir, cone: 0.7, speed0: 6, speed1: 16, life0: 0.25, life1: 0.6, size0: 0.12, size1: 0.35
  });
  player.vel.addScaledVector(dir.setY(0).normalize(), 14);

  if (player.hp <= 0) {
    player.hp = 0;
    gameOver();
  }
}

function healPlayer(n) {
  player.hp = Math.min(CFG.player.maxHp, player.hp + n);
  Sound.heal();
  Particles.emit({
    pos: new THREE.Vector3(player.pos.x, 1.1, player.pos.z), count: 20, color: 0x4dff9e,
    speed0: 3, speed1: 9, life0: 0.4, life1: 0.9, size0: 0.1, size1: 0.3, grav: 6
  });
  toast('+' + n + ' INTEGRITY', '#4dff9e');
}

/* --------------------------------------------------------------------------
   13. Per-frame updates
   -------------------------------------------------------------------------- */
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
const raycaster = new THREE.Raycaster();
const aimPoint = new THREE.Vector3(0, 1, -10);
const moveIntent = new THREE.Vector2();

function updateAim() {
  const stick = Input.aimStick;
  if (stick.active && (Math.abs(stick.x) > 0.15 || Math.abs(stick.y) > 0.15)) {
    player.aim.set(stick.x, 0, stick.y).normalize();
    aimPoint.set(player.pos.x + player.aim.x * 12, 1, player.pos.z + player.aim.z * 12);
    return;
  }
  if (Input.isTouch && !Input.mouse.moved) {
    // Touch with no aim input: track the closest hostile so tapping dash still reads well.
    let best = null, bd = Infinity;
    for (const e of enemies) {
      const d = (e.pos.x - player.pos.x) ** 2 + (e.pos.z - player.pos.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      player.aim.set(best.pos.x - player.pos.x, 0, best.pos.z - player.pos.z).normalize();
      aimPoint.set(best.pos.x, 1, best.pos.z);
    }
    return;
  }
  raycaster.setFromCamera(Input.mouse.ndc, camera);
  if (raycaster.ray.intersectPlane(groundPlane, tmpV)) {
    aimPoint.copy(tmpV);
    const dx = aimPoint.x - player.pos.x, dz = aimPoint.z - player.pos.z;
    if (dx * dx + dz * dz > 0.5) player.aim.set(dx, 0, dz).normalize();
  }
}

function updatePlayer(dt) {
  if (!player.alive) return;

  Input.moveVector(moveIntent);
  const P = CFG.player;

  // dash
  player.dashCd = Math.max(0, player.dashCd - dt);
  if (player.dashT > 0) {
    player.dashT -= dt;
    Particles.emit({
      pos: new THREE.Vector3(player.pos.x, 0.7, player.pos.z), count: 2, color: 0x00e5ff,
      speed0: 0.5, speed1: 3, life0: 0.2, life1: 0.45, size0: 0.15, size1: 0.4, grav: 2, spread: 0.5
    });
  } else if (Input.consumeDash() && player.dashCd <= 0) {
    let dx = moveIntent.x, dz = moveIntent.y;
    if (Math.hypot(dx, dz) < 0.2) { dx = player.aim.x; dz = player.aim.z; }
    const m = Math.hypot(dx, dz) || 1;
    player.vel.set(dx / m * P.dashSpeed, 0, dz / m * P.dashSpeed);
    player.dashT = P.dashTime;
    player.dashCd = P.dashCd;
    Sound.dash();
    Particles.emit({
      pos: new THREE.Vector3(player.pos.x, 0.9, player.pos.z), count: 22, color: [0x00e5ff, 0x9bfaff],
      speed0: 4, speed1: 14, life0: 0.25, life1: 0.6, size0: 0.12, size1: 0.35
    });
  }

  // acceleration / friction
  if (player.dashT <= 0) {
    const want = tmpV.set(moveIntent.x, 0, moveIntent.y).multiplyScalar(P.speed);
    player.vel.x = damp(player.vel.x, want.x, moveIntent.lengthSq() > 0.01 ? 11 : P.friction, dt);
    player.vel.z = damp(player.vel.z, want.z, moveIntent.lengthSq() > 0.01 ? 11 : P.friction, dt);
  }

  player.pos.addScaledVector(player.vel, dt);
  const lim = HALF - P.radius - 0.6;
  if (player.pos.x < -lim) { player.pos.x = -lim; player.vel.x *= -0.35; }
  if (player.pos.x > lim) { player.pos.x = lim; player.vel.x *= -0.35; }
  if (player.pos.z < -lim) { player.pos.z = -lim; player.vel.z *= -0.35; }
  if (player.pos.z > lim) { player.pos.z = lim; player.vel.z *= -0.35; }

  // firing
  player.fireCd -= dt;
  const rate = P.fireRate * (Game.powers.RAPID ? 0.5 : 1);
  if (Input.firing() && player.fireCd <= 0) {
    playerShoot();
    player.fireCd = rate;
  }

  player.invuln = Math.max(0, player.invuln - dt);

  // visuals
  player.mesh.position.set(player.pos.x, 0, player.pos.z);
  const targetYaw = Math.atan2(player.aim.x, player.aim.z) + Math.PI;
  let d = targetYaw - player.mesh.rotation.y;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  player.mesh.rotation.y += d * Math.min(1, dt * 18);

  player.core.rotation.y += dt * 2.4;
  player.core.rotation.x += dt * 1.6;
  player.ring.rotation.z += dt * 1.1;
  const blink = player.invuln > 0 ? (Math.sin(Game.time * 40) * 0.5 + 0.5) : 1;
  player.mesh.visible = player.invuln > 0 ? blink > 0.35 : true;
  player.bubble.visible = !!Game.powers.SHIELD;
  if (player.bubble.visible) {
    player.bubble.rotation.y += dt * 0.9;
    player.bubble.rotation.x += dt * 0.5;
    const s = 1 + Math.sin(Game.time * 6) * 0.04;
    player.bubble.scale.setScalar(s);
  }

  playerLight.position.set(player.pos.x, 4.5, player.pos.z);

  reticle.position.set(aimPoint.x, 0.05, aimPoint.z);
  reticle.rotation.z += dt * 1.6;
  reticle.visible = player.alive && !Input.isTouch;
}

function updateBullets(dt) {
  // player bullets
  for (let i = playerBullets.active.length - 1; i >= 0; i--) {
    const b = playerBullets.active[i];
    b.life -= dt;
    const p = b.mesh.position;
    const ax = p.x, az = p.z;
    p.addScaledVector(b.vel, dt);
    let dead = b.life <= 0 ||
      p.x < -HALF || p.x > HALF || p.z < -HALF || p.z > HALF;

    if (!dead) {
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        const r = e.radius + b.radius;
        if (segDistSq(ax, az, p.x, p.z, e.pos.x, e.pos.z) < r * r) {
          damageEnemy(e, b.dmg, new THREE.Vector3(
            clamp(p.x, e.pos.x - e.radius, e.pos.x + e.radius), p.y,
            clamp(p.z, e.pos.z - e.radius, e.pos.z + e.radius)));
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      if (b.life <= 0 || p.x <= -HALF || p.x >= HALF || p.z <= -HALF || p.z >= HALF) {
        Particles.emit({
          pos: new THREE.Vector3(p.x, p.y, p.z), count: 3, color: 0x9bfaff,
          speed0: 2, speed1: 7, life0: 0.1, life1: 0.25, size0: 0.08, size1: 0.18
        });
      }
      playerBullets.release(b);
    }
  }

  // enemy bullets
  for (let i = enemyBullets.active.length - 1; i >= 0; i--) {
    const b = enemyBullets.active[i];
    b.life -= dt;
    const p = b.mesh.position;
    const ax = p.x, az = p.z;
    p.addScaledVector(b.vel, dt);
    b.mesh.rotation.z += dt * 6;
    let dead = b.life <= 0 || p.x < -HALF - 2 || p.x > HALF + 2 || p.z < -HALF - 2 || p.z > HALF + 2;

    if (!dead && player.alive) {
      const r = player.radius + b.radius;
      if (segDistSq(ax, az, p.x, p.z, player.pos.x, player.pos.z) < r * r) {
        damagePlayer(b.dmg || 9, p);
        Particles.emit({
          pos: new THREE.Vector3(p.x, p.y, p.z), count: 8, color: 0xff6b3d,
          speed0: 3, speed1: 10, life0: 0.15, life1: 0.4, size0: 0.1, size1: 0.25
        });
        dead = true;
      }
    }
    if (dead) enemyBullets.release(b);
  }
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;

    const toPx = player.pos.x - e.pos.x;
    const toPz = player.pos.z - e.pos.z;
    const dist = Math.hypot(toPx, toPz) || 0.0001;
    const nx = toPx / dist, nz = toPz / dist;

    let ax = 0, az = 0, speed = e.speed;

    if (e.type === 'grunt') {
      // Slight orbit so a pack doesn't collapse into a single line.
      const orb = Math.sin(e.t * 0.9) * 0.35;
      ax = nx + -nz * orb;
      az = nz + nx * orb;

    } else if (e.type === 'sprinter') {
      // Wind up, then lunge.
      e.stateT -= dt;
      if (e.state === 0) {
        speed = e.speed * 0.35;
        ax = nx; az = nz;
        if (e.stateT <= 0 && dist < 26) { e.state = 1; e.stateT = 0.5; e.lungeX = nx; e.lungeZ = nz; }
      } else {
        speed = e.speed * 1.7;
        ax = e.lungeX; az = e.lungeZ;
        if (e.stateT <= 0) { e.state = 0; e.stateT = rand(0.5, 1.1); }
      }

    } else if (e.type === 'shooter') {
      // Kite: hold a ring around the player and fire aimed shots.
      const ideal = 15;
      const err = dist - ideal;
      const strafe = Math.sin(e.t * 0.6 + e.radius) * 1.0;
      ax = nx * clamp(err / 6, -1, 1) + -nz * strafe;
      az = nz * clamp(err / 6, -1, 1) + nx * strafe;
      e.fireCd -= dt;
      if (e.fireCd <= 0 && dist < 34 && player.alive) {
        e.fireCd = rand(1.5, 2.6) * Math.max(0.55, 1 - Game.wave * 0.02);
        const speedB = 26;
        // Lead the target a little.
        const lead = tmpV.set(
          player.pos.x + player.vel.x * (dist / speedB) * 0.55 - e.pos.x, 0,
          player.pos.z + player.vel.z * (dist / speedB) * 0.55 - e.pos.z);
        fireEnemyBullet(new THREE.Vector3(e.pos.x, 1.2, e.pos.z), lead, speedB, 1.2);
      }

    } else if (e.type === 'tank') {
      ax = nx; az = nz;

    } else if (e.type === 'warden') {
      // Phase 1: approach and radial burst. Phase 2 (<50% hp): faster, spiral fire + adds.
      const phase2 = e.hp < e.maxHp * 0.5;
      const ideal = phase2 ? 10 : 14;
      const err = dist - ideal;
      const strafe = Math.sin(e.t * 0.35) * 1.2;
      ax = nx * clamp(err / 8, -1, 1) + -nz * strafe;
      az = nz * clamp(err / 8, -1, 1) + nx * strafe;
      speed = e.speed * (phase2 ? 1.35 : 1);

      e.fireCd -= dt;
      if (e.fireCd <= 0 && player.alive) {
        e.fireCd = phase2 ? 1.5 : 2.4;
        const shots = phase2 ? 14 : 9;
        const base = e.t * 1.3;
        for (let s = 0; s < shots; s++) {
          const a = base + (s / shots) * TAU;
          fireEnemyBullet(new THREE.Vector3(e.pos.x, 2.4, e.pos.z),
            tmpV.set(Math.cos(a), 0, Math.sin(a)), 20, 1.5);
        }
        Game.shake = Math.min(Game.shake + 0.3, 2);
        if (phase2 && enemies.length < 26) {
          for (let s = 0; s < 2; s++) {
            const a = rand(0, TAU);
            spawnEnemy('sprinter', new THREE.Vector3(
              clamp(e.pos.x + Math.cos(a) * 5, -HALF + 2, HALF - 2), 0,
              clamp(e.pos.z + Math.sin(a) * 5, -HALF + 2, HALF - 2)));
          }
        }
      }
    }

    // separation from other enemies
    for (let j = 0; j < enemies.length; j++) {
      if (j === i) continue;
      const o = enemies[j];
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
      const rr = e.radius + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / rr * (o.boss ? 2.6 : 1.3);
        ax += (dx / d) * push;
        az += (dz / d) * push;
      }
    }

    const am = Math.hypot(ax, az) || 1;
    e.vel.x = damp(e.vel.x, ax / am * speed, 7, dt);
    e.vel.z = damp(e.vel.z, az / am * speed, 7, dt);
    e.pos.x = clamp(e.pos.x + e.vel.x * dt, -HALF + e.radius, HALF - e.radius);
    e.pos.z = clamp(e.pos.z + e.vel.z * dt, -HALF + e.radius, HALF - e.radius);

    // contact damage
    if (player.alive) {
      const rr = e.radius + player.radius;
      if (dist < rr) {
        damagePlayer(e.dmg, e.pos);
        // knock the attacker back so it can't grind through i-frames
        e.vel.x -= nx * 12;
        e.vel.z -= nz * 12;
      }
    }

    // visuals
    e.mesh.position.set(e.pos.x, 0, e.pos.z);
    const s = damp(e.mesh.scale.x, 1, 9, dt);
    e.mesh.scale.setScalar(s);
    e.mesh.rotation.y = Math.atan2(e.vel.x, e.vel.z);
    if (e.type === 'sprinter') e.body.rotation.y += dt * 6;
    else if (e.type === 'tank') { e.body.rotation.y += dt * 0.8; e.body.rotation.x += dt * 0.5; }
    else if (e.type === 'shooter') e.body.rotation.y += dt * 1.6;
    else if (e.type === 'warden') {
      e.body.rotation.y += dt * 0.55;
      e.body.rotation.x = Math.sin(e.t * 0.6) * 0.2;
      e.body.position.y = 3.2 + Math.sin(e.t * 1.5) * 0.35;
    }
    e.accent.rotation.copy(e.body.rotation);
    e.accent.position.y = e.body.position.y;
    e.mat.emissiveIntensity = e.flash > 0 ? 3.4 : (0.72 + 0.12 * Math.sin(e.t * 3));
  }
}

function updatePickups(dt) {
  for (let i = pickups.active.length - 1; i >= 0; i--) {
    const p = pickups.active[i];
    p.life -= dt;
    p.t += dt;

    // pop out, then settle and magnet toward the player
    p.vel.y -= 40 * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y < 0) { p.pos.y = 0; p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
    p.pos.x = clamp(p.pos.x, -HALF + 1, HALF - 1);
    p.pos.z = clamp(p.pos.z, -HALF + 1, HALF - 1);

    if (player.alive) {
      const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const magnet = p.kind === 'orb' ? CFG.orb.magnet : CFG.orb.magnet * 0.8;
      if (d < magnet) {
        const pull = (1 - d / magnet) * 90 * dt;
        p.vel.x += (dx / (d || 1)) * pull;
        p.vel.z += (dz / (d || 1)) * pull;
        p.vel.x *= 0.94; p.vel.z *= 0.94;
      }
      if (d < CFG.orb.pickup + player.radius) {
        collect(p);
        continue;
      }
    }

    if (p.life <= 0) { pickups.release(p); continue; }

    p.mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
    p.core.rotation.y += dt * 2.2;
    p.core.rotation.x += dt * 1.3;
    p.core.position.y = 0.8 + Math.sin(p.t * 3) * 0.16;
    p.halo.rotation.z += dt * 1.5;
    const blink = p.life < 3 ? (Math.sin(p.life * 18) * 0.5 + 0.5) > 0.4 : true;
    p.mesh.visible = blink;
  }
}

function collect(p) {
  const at = new THREE.Vector3(p.pos.x, 1, p.pos.z);
  if (p.kind === 'orb') {
    addScore(p.value * multiplier());
    Sound.pickup(Game.combo);
    Particles.emit({
      pos: at, count: 6, color: 0xffcf4d,
      speed0: 3, speed1: 9, life0: 0.2, life1: 0.5, size0: 0.08, size1: 0.22
    });
  } else if (p.kind === 'health') {
    healPlayer(22);
  } else {
    const def = POWERUPS[p.key];
    Game.powers[p.key] = def.time;
    Sound.power();
    toast(def.label, '#' + def.color.toString(16).padStart(6, '0'));
    Particles.emit({
      pos: at, count: 24, color: def.color,
      speed0: 4, speed1: 14, life0: 0.3, life1: 0.8, size0: 0.12, size1: 0.32
    });
  }
  pickups.release(p);
}

function updateSpawnMarks(dt) {
  for (let i = spawnMarks.active.length - 1; i >= 0; i--) {
    const m = spawnMarks.active[i];
    m.t += dt;
    const k = m.t / m.dur;
    m.mesh.material.opacity = 0.35 + 0.5 * Math.abs(Math.sin(m.t * 12));
    m.mesh.rotation.z += dt * 3;
    m.mesh.scale.setScalar(ENEMY[m.type].radius * (1 + (1 - k) * 0.5));
    if (m.t >= m.dur) {
      spawnEnemy(m.type, m.pos);
      spawnMarks.release(m);
    }
  }
}

function updateWaves(dt) {
  if (Game.intermission > 0) {
    Game.intermission -= dt;
    if (Game.intermission <= 0) startWave(Game.wave + 1);
    return;
  }

  if (Game.spawnQueue.length) {
    Game.spawnTimer -= dt;
    if (Game.spawnTimer <= 0) {
      // Trickle spawns in so the arena never gets instantly swamped.
      const batch = Math.min(Game.spawnQueue.length, 1 + Math.floor(Game.wave / 6));
      for (let i = 0; i < batch; i++) queueSpawn(Game.spawnQueue.shift());
      Game.spawnTimer = Math.max(0.35, 1.25 - Game.wave * 0.03);
    }
    return;
  }

  if (enemies.length === 0 && spawnMarks.active.length === 0) {
    Game.wavesCleared = Game.wave;
    const bonus = 250 * Game.wave * multiplier();
    addScore(bonus);
    toast('WAVE ' + Game.wave + ' CLEAR  +' + bonus.toLocaleString(), '#4dff9e');
    // Top up a little between waves so long runs stay possible.
    if (player.hp < CFG.player.maxHp) {
      player.hp = Math.min(CFG.player.maxHp, player.hp + 8);
    }
    Game.intermission = 2.6;
  }
}

function updatePowers(dt) {
  for (const k in Game.powers) {
    Game.powers[k] -= dt;
    if (Game.powers[k] <= 0) {
      delete Game.powers[k];
      toast(POWERUPS[k].label + ' EXPIRED', '#7f93ad');
    }
  }
}

/* ---- camera ---- */
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const C = CFG.camera;
  // Bias the framing slightly toward where the player is aiming.
  camTarget.set(
    player.pos.x + (aimPoint.x - player.pos.x) * C.aimLead,
    0,
    player.pos.z + (aimPoint.z - player.pos.z) * C.aimLead
  );
  const wantX = camTarget.x;
  const wantZ = camTarget.z + C.back * frameScale;
  camera.position.x = damp(camera.position.x, wantX, C.lag, dt);
  camera.position.z = damp(camera.position.z, wantZ, C.lag, dt);
  camera.position.y = damp(camera.position.y, C.height * frameScale, C.lag, dt);

  Game.shake = Math.max(0, Game.shake - dt * 3.2);
  const sh = Game.shake * Game.shake * 0.55;
  camera.position.x += rand(-sh, sh);
  camera.position.y += rand(-sh, sh);
  camera.position.z += rand(-sh, sh);

  camera.lookAt(camTarget.x, 1.0, camTarget.z);

  keyLight.position.set(player.pos.x + 28, 54, player.pos.z + 20);
  keyLight.target.position.set(player.pos.x, 0, player.pos.z);
  keyLight.target.updateMatrixWorld();
}

/* --------------------------------------------------------------------------
   14. HUD sync (DOM writes only when a value actually changes)
   -------------------------------------------------------------------------- */
function setText(el, key, val) {
  if (Game.hudCache[key] === val) return false;
  Game.hudCache[key] = val;
  el.textContent = val;
  return true;
}

function updateHUD() {
  const score = Math.round(Game.score);
  if (setText(UI.score, 'score', score.toLocaleString())) bump(UI.score);
  setText(UI.best, 'best', Math.max(Game.best, score).toLocaleString());
  if (setText(UI.wave, 'wave', String(Game.wave))) bump(UI.wave);

  const left = enemies.length + Game.spawnQueue.length + spawnMarks.active.length;
  setText(UI.remaining, 'left', String(left));

  const m = multiplier();
  if (setText(UI.mult, 'mult', 'x' + m)) bump(UI.mult);
  UI.comboFill.style.width = (Game.comboT / CFG.combo.window * 100) + '%';

  const hpPct = clamp(player.hp / CFG.player.maxHp, 0, 1) * 100;
  UI.hpFill.style.width = hpPct + '%';
  UI.hpGhost.style.width = hpPct + '%';
  UI.hpFill.classList.toggle('low', hpPct <= 30);
  setText(UI.hpText, 'hp', String(Math.ceil(player.hp)));

  UI.dashFill.style.width = (player.dashCd > 0 ? (1 - player.dashCd / CFG.player.dashCd) * 100 : 100) + '%';

  // power-up chips
  const keys = Object.keys(Game.powers);
  const sig = keys.map(k => k + Math.ceil(Game.powers[k])).join(',');
  if (Game.hudCache.pw !== sig) {
    Game.hudCache.pw = sig;
    UI.powerups.innerHTML = '';
    for (const k of keys) {
      const el = document.createElement('div');
      el.className = 'pw';
      el.setAttribute('data-k', k);
      el.innerHTML = '<i>' + k + '</i><span class="t">' + Math.ceil(Game.powers[k]) + 's</span>';
      UI.powerups.appendChild(el);
    }
  }

  if (Game.boss) {
    UI.bossFill.style.width = clamp(Game.boss.hp / Game.boss.maxHp, 0, 1) * 100 + '%';
  }
}

/* --------------------------------------------------------------------------
   15. State transitions
   -------------------------------------------------------------------------- */
function resetRun() {
  playerBullets.releaseAll();
  enemyBullets.releaseAll();
  pickups.releaseAll();
  spawnMarks.releaseAll();
  while (enemies.length) removeEnemy(enemies[enemies.length - 1]);
  Particles.clear();

  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  player.aim.set(0, 0, -1);
  player.hp = CFG.player.maxHp;
  player.alive = true;
  player.fireCd = 0;
  player.dashCd = 0;
  player.dashT = 0;
  player.invuln = 1.0;
  player.mesh.visible = true;
  player.mesh.position.set(0, 0, 0);
  player.mesh.rotation.y = 0;
  player.bubble.visible = false;

  Game.score = 0;
  Game.kills = 0;
  Game.wave = 0;
  Game.wavesCleared = 0;
  Game.combo = 0;
  Game.comboT = 0;
  Game.bestMult = 1;
  Game.time = 0;
  Game.shake = 0;
  Game.spawnQueue = [];
  Game.spawnTimer = 0;
  Game.intermission = 0;
  Game.boss = null;
  Game.powers = {};
  Game.hudCache = {};

  UI.bossBar.classList.add('hidden');
  UI.powerups.innerHTML = '';
  UI.toasts.innerHTML = '';

  camera.position.set(0, CFG.camera.height, CFG.camera.back);
  aimPoint.set(0, 1, -10);
  updateHUD();
}

function startGame() {
  Sound.resume();
  resetRun();
  Game.state = 'playing';
  showScreen(null);
  UI.hud.classList.remove('hidden');
  UI.hud.setAttribute('aria-hidden', 'false');
  UI.touch.classList.toggle('hidden', !Input.isTouch);
  startWave(1);
  updateHUD();
}

function pauseGame() {
  if (Game.state !== 'playing') return;
  Game.state = 'paused';
  UI.pauseScore.textContent = Math.round(Game.score).toLocaleString();
  UI.pauseWave.textContent = String(Game.wave);
  showScreen('pause');
}

function resumeGame() {
  if (Game.state !== 'paused') return;
  Sound.resume();
  Game.state = 'playing';
  showScreen(null);
}

function toMenu() {
  Game.state = 'menu';
  UI.hud.classList.add('hidden');
  UI.touch.classList.add('hidden');
  UI.startBest.textContent = Game.best.toLocaleString();
  showScreen('start');
}

function gameOver() {
  if (Game.state === 'over') return;
  Game.state = 'over';
  player.alive = false;
  Sound.gameOver();
  Game.shake = 2.2;

  Particles.emit({
    pos: new THREE.Vector3(player.pos.x, 1.2, player.pos.z), count: 90,
    color: [0x00e5ff, 0x9bfaff, 0xffffff, 0xff4d5e], jitter: 0.03,
    speed0: 8, speed1: 30, life0: 0.6, life1: 1.8, size0: 0.15, size1: 0.7
  });
  player.mesh.visible = false;
  reticle.visible = false;

  const score = Math.round(Game.score);
  const record = score > Game.best;
  if (record) {
    Game.best = score;
    try { localStorage.setItem(HS_KEY, String(score)); } catch (e) { /* storage blocked */ }
  }

  UI.overScore.textContent = score.toLocaleString();
  UI.overWaves.textContent = String(Math.max(Game.wave, Game.wavesCleared));
  UI.overKills.textContent = String(Game.kills);
  UI.overMult.textContent = 'x' + Game.bestMult;
  UI.overTime.textContent = fmtTime(Game.time);
  UI.overBest.textContent = Game.best.toLocaleString();
  UI.record.classList.toggle('hidden', !record);
  UI.startBest.textContent = Game.best.toLocaleString();

  // Let the death explosion breathe before the panel drops in.
  setTimeout(function () {
    if (Game.state === 'over') showScreen('over');
  }, 900);
}

Game.onKey = function (k) {
  if (k === 'm') {
    UI.btnMute.classList.toggle('off', Sound.toggleMute());
    return;
  }
  if (Game.state === 'playing' && (k === 'p' || k === 'escape')) pauseGame();
  else if (Game.state === 'paused' && (k === 'p' || k === 'escape')) resumeGame();
  else if (Game.state === 'over' && (k === 'r' || k === ' ' || k === 'enter')) startGame();
  else if (Game.state === 'menu' && (k === ' ' || k === 'enter')) startGame();
};

/* ---- button wiring ---- */
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-quit').addEventListener('click', toMenu);
document.getElementById('btn-menu').addEventListener('click', toMenu);
document.getElementById('btn-pause').addEventListener('click', pauseGame);
UI.btnMute.addEventListener('click', function () {
  Sound.resume();
  UI.btnMute.classList.toggle('off', Sound.toggleMute());
});

document.addEventListener('visibilitychange', function () {
  if (document.hidden && Game.state === 'playing') pauseGame();
});

/* --------------------------------------------------------------------------
   16. Main loop
   -------------------------------------------------------------------------- */
let last = performance.now();
let fpsAccum = 0, fpsFrames = 0, qualityDropped = false;
const stars = scene.getObjectByName('stars');

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;          // clamp after tab switches / hitches
  if (dt <= 0) return;

  // Adaptive quality: if the machine can't hold ~40fps, drop shadows once.
  if (!qualityDropped && Game.state === 'playing') {
    fpsAccum += dt; fpsFrames++;
    if (fpsAccum > 3) {
      if (fpsFrames / fpsAccum < 40) {
        renderer.shadowMap.enabled = false;
        keyLight.castShadow = false;
        scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
        qualityDropped = true;
      }
      fpsAccum = 0; fpsFrames = 0;
    }
  }

  if (Game.state === 'playing') {
    Game.time += dt;
    if (Game.comboT > 0) {
      Game.comboT -= dt;
      if (Game.comboT <= 0) Game.combo = 0;
    }
    updateAim();
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updatePickups(dt);
    updateSpawnMarks(dt);
    updateWaves(dt);
    updatePowers(dt);
    updateHUD();
  } else if (Game.state === 'over') {
    // Keep the world alive behind the panel.
    updateBullets(dt);
    updatePickups(dt);
    updateEnemies(dt);
  } else if (Game.state === 'menu') {
    // Slow idle orbit behind the menu.
    const a = now * 0.00008;
    camera.position.set(Math.sin(a) * 34, 26, Math.cos(a) * 34);
    camera.lookAt(0, 1, 0);
  }

  if (Game.state === 'playing' || Game.state === 'over') {
    Particles.update(dt);
    updateCamera(dt);
  } else if (Game.state === 'menu') {
    Particles.update(dt);
  }

  if (stars) stars.rotation.y += dt * 0.005;

  renderer.render(scene, camera);
}

/* --------------------------------------------------------------------------
   17. Go
   -------------------------------------------------------------------------- */
// Warm the shader cache with one render so the first frame of play isn't a hitch.
renderer.compile(scene, camera);
renderer.render(scene, camera);
showScreen('start');
requestAnimationFrame(frame);

// Any first interaction unlocks the audio context (browser autoplay policy).
['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
  addEventListener(ev, function once() {
    Sound.resume();
    removeEventListener(ev, once);
  }, { once: true });
});

})();
