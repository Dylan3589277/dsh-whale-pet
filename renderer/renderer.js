'use strict';
// 首选 Live2D（live2d.js：PIXI + pixi-live2d-display 画女仆鲸鱼娘模型）；它起不来（缺 Cubism Core / 没 WebGL / 模型加载失败）
// 才走下面这套网格渲染，原因打到 console。气泡、点缀特效、粒子、穿透/戳/拖/右键两种模式共用。
// 网格渲染：把当前这张贴纸当成一块能弯的布（WebGL 三角网格），每帧按时间算形变 → 呼吸/摆动/头发尾巴飘/眨眼/
// 各状态的小动作/换图淡入淡出都是连续的，不再整张图上下蹦。WebGL 起不来就回落到 <img> + 轻量 CSS 动画。
// <img id="pet"> 一直留在原位当鼠标命中区（GL 模式下透明），穿透/戳/拖/右键逻辑和以前一模一样。
const img = document.getElementById('pet');
const sprite = document.getElementById('sprite');
const bubble = document.getElementById('bubble');
const canvas = document.getElementById('gl');
const particles = document.getElementById('particles');
const l2dCanvas = document.getElementById('l2d');
const notice = document.getElementById('notice');
let L2D = null; // Live2D 跑起来后是 live2d.js 返回的接口；null = 网格/图片模式
let noticeMode = false; // Live2D 起不来、又没有自备贴纸（assets/sprites.json）时只显示提示框；提示框当鼠标命中区
// 状态 -> 点缀小特效，只在对应状态显示
const fx = {
  done: document.getElementById('sparkle'),
  sleepy: document.getElementById('zzz'),
  waiting: document.getElementById('ask'),
  working: document.getElementById('dots'),
  error: document.getElementById('sweat'),
};

const POKE_MS = 1500;
const DRAG_PX = 4;
const POKE_LINES = ['哈！别戳！', '再戳要咬你了！', '痒…', '干嘛啦～', '哼，不理你了！'];
// 状态没变也隔一阵换张图当小动作：[最短, 最长] 毫秒
const SWAP_MS = { idle: [25000, 45000], working: [20000, 30000] };
const FADE_MS = 400; // 换图交叉淡化
const POKE_FADE_MS = 150; // 戳一下要马上变脸
const STAGE_BOTTOM = 6; // 与 style.css #stage 的 bottom 一致
const MAX_W = 300; // 与 #pet 的 max-width / max-height 一致
const MAX_H = 240;
const FRAME_MS = 31; // ≈30fps 封顶
const RIG = window.PET_RIG || {};
const TAU = Math.PI * 2;

let sprites = null;
let view = { state: 'idle', text: '' };
let shownFile = null;
let shownKey = null;
let pokeLine = POKE_LINES[0];
let poking = false;
let pokeTimer = null;
let swapTimer = null;
const preloaded = [];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const clock = () => performance.now() / 1000;

// 一个状态的图池；兼容旧格式 {file}，未知状态回落到 idle
function poolOf(key) {
  const s = sprites[key] || sprites.idle;
  return { files: s.files || [s.file], anim: s.anim };
}

function pickOther(list, avoid) {
  const rest = list.filter((x) => x !== avoid);
  const from = rest.length ? rest : list;
  return from[Math.floor(Math.random() * from.length)];
}

function show(file, fadeMs) {
  shownFile = file;
  img.src = `../assets/${file}`; // GL 模式下它只当命中区；回落模式下它就是人物
  if (gl) return glShow(file, fadeMs);
  if (fadeMs > POKE_FADE_MS) {
    sprite.classList.remove('swap');
    void sprite.offsetWidth; // 重启淡入动画
    sprite.classList.add('swap');
  }
}

function scheduleSwap(key) {
  clearTimeout(swapTimer);
  const range = SWAP_MS[key];
  if (!range) return;
  swapTimer = setTimeout(() => {
    show(pickOther(poolOf(key).files, shownFile), FADE_MS);
    scheduleSwap(key);
  }, rand(range[0], range[1]));
}

function render(forceNew) {
  if (!sprites && !L2D && !noticeMode) return;
  const key = poking ? 'angry' : view.state;
  const changed = key !== shownKey;
  shownKey = key;
  if (L2D) {
    if (forceNew || changed) L2D.setState(key);
    if (changed) setMotionState(key);
  } else if (sprites) {
    const { files, anim } = poolOf(key);
    if (forceNew || changed || !files.includes(shownFile)) show(pickOther(files, shownFile), poking ? POKE_FADE_MS : FADE_MS);
    if (changed) {
      scheduleSwap(sprites[key] ? key : 'idle');
      setMotionState(key);
    }
    img.className = `anim-${anim}`;
  }
  const text = poking ? pokeLine : view.text;
  bubble.textContent = text;
  bubble.dataset.state = key;
  bubble.hidden = !text;
  for (const k in fx) fx[k].hidden = noticeMode || key !== k;
}

// where: { head: 戳在图的上半截？, side: -1..1 戳在左/右 }
function poke(where) {
  poking = true;
  pokeLine = pickOther(POKE_LINES, pokeLine);
  clearTimeout(pokeTimer);
  pokeTimer = setTimeout(() => { poking = false; render(); }, POKE_MS);
  render(true);
  if (!gl) return;
  startAction('shake', { amp: 2 });
  if (where && where.head) startAction('pokeHead', { side: where.side || (Math.random() < 0.5 ? -1 : 1) });
  else startAction('pokeBody');
}

// ======================= 动作参数 =======================
// 每个状态的持续动作；切状态时各参数用 ~300ms 平滑过渡（相位单独累加，改周期不会跳）
//   breath: 呼吸纵向伸缩比例  sway: 身体左右摆（头顶处 px）  flex: 头发/裙摆/尾巴的二次飘动 px
//   nod: 上身往前点头 px（干活像在打字）  tilt: 歪头弧度  droop: 上身下垂 px   *T: 周期秒
const STATE_PARAMS = {
  idle:     { breath: 0.010, breathT: 3.6, sway: 2.5, swayT: 5.2, flex: 1.6, nod: 0,   nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 0 },
  received: { breath: 0.012, breathT: 2.6, sway: 1.5, swayT: 5.0, flex: 1.2, nod: 1.6, nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 0 },
  working:  { breath: 0.012, breathT: 2.6, sway: 1.5, swayT: 5.0, flex: 1.2, nod: 1.6, nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 0 },
  done:     { breath: 0.012, breathT: 2.8, sway: 6.0, swayT: 2.4, flex: 2.6, nod: 0,   nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 0 },
  waiting:  { breath: 0.010, breathT: 3.4, sway: 1.5, swayT: 5.0, flex: 1.4, nod: 0,   nodT: 0.9, tilt: 0.045, tiltT: 3.4, droop: 0 },
  sleepy:   { breath: 0.022, breathT: 6.0, sway: 1.0, swayT: 8.0, flex: 0.8, nod: 0,   nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 5 },
  angry:    { breath: 0.012, breathT: 2.4, sway: 1.0, swayT: 4.0, flex: 1.2, nod: 0,   nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 0 },
  error:    { breath: 0.010, breathT: 3.2, sway: 1.0, swayT: 5.0, flex: 1.0, nod: 0,   nodT: 0.9, tilt: 0,     tiltT: 3.4, droop: 3 },
};
let target = STATE_PARAMS.idle;
const P = { ...target };
const ph = { breath: 0, sway: 0, flex: 0, nod: 0, tilt: 0 };
let stateT0 = 0;

// 一次性动作：u = 开始后的秒数，往 o 上叠加形变
function impulse(u) { // 被推一下：0.15s 到顶（换图淡化正好走完），之后衰减着弹回
  return u < 0.15 ? Math.sin((u / 0.15) * Math.PI / 2) : Math.exp(-4.5 * (u - 0.15)) * Math.cos(TAU * 1.4 * (u - 0.15));
}
const ACTIONS = {
  // 收到任务：挺一下腰再回弹
  perk: { dur: 1.4, fn: (u, o) => { o.sy += 0.035 * Math.exp(-4 * u) * Math.sin(TAU * 1.4 * u); } },
  // 闲置：伸懒腰（慢慢拉长 → 停一下 → 落回带一点回弹）
  stretch: { dur: 2.5, fn: (u, o) => {
    const up = smooth(0, 0.9, u) * (1 - smooth(1.4, 2.0, u));
    const rb = u > 2.0 ? -0.3 * Math.sin(Math.PI * Math.min((u - 2.0) / 0.45, 1)) : 0;
    o.sy += 0.035 * (up + rb);
    o.sx -= 0.012 * up;
  } },
  // 闲置：左右张望
  look: { dur: 2.8, fn: (u, o) => {
    const w = smooth(0, 0.15, u / 2.8) * (1 - smooth(0.85, 1, u / 2.8));
    const s = Math.sin(TAU * u / 2.8);
    o.hx += 3.5 * s * w;
    o.hr -= 0.025 * s * w;
  } },
  // 闲置：甩一下尾巴
  tail: { dur: 1.6, fn: (u, o) => { o.tail += 8 * Math.exp(-3.2 * u) * Math.sin(TAU * 1.7 * u); } },
  // 犯困：打哈欠（上身慢慢抬起、头微仰 → 再沉下去）
  yawn: { dur: 4.2, fn: (u, o) => {
    const up = smooth(0, 1.4, u) * (1 - smooth(2.0, 3.2, u));
    o.sy += 0.03 * up;
    o.hr += 0.02 * up;
    o.hy += 1.5 * up;
    o.droop += 2.5 * smooth(2.6, 3.4, u) * (1 - smooth(3.5, 4.2, u));
  } },
  // 戳头：头往后仰（往戳的反方向歪）再回来
  pokeHead: { dur: 1.3, fn: (u, o, a) => { const f = impulse(u); o.hy += 4 * f; o.hr += 0.09 * f * Math.sign(a.side); } },
  // 戳身子：压扁再弹回
  pokeBody: { dur: 1.3, fn: (u, o) => { const f = impulse(u); o.sy -= 0.06 * f; o.sx += 0.04 * f; } },
  // 小抖一下，0.5 秒内衰减停住
  shake: { dur: 0.5, fn: (u, o, a) => { o.shake += a.amp * Math.exp(-7 * u) * Math.sin(TAU * 13 * u); } },
};
let actions = [];
function startAction(name, opts) {
  actions = actions.filter((a) => a.name !== name);
  actions.push({ name, t0: clock(), ...ACTIONS[name], ...opts });
}
const busyAction = () => actions.some((a) => a.name !== 'shake');

// 拖动惯性：外缘（头发/裙摆/尾巴）挂在弹簧-阻尼上，往拖动反方向甩，松手后晃 2~3 下停
const drag = { vx: 0, vy: 0, lastX: 0, lastY: 0, lastT: 0, px: 0, py: 0, pvx: 0, pvy: 0 };
const SPRING_W = 9; // rad/s
const SPRING_Z = 0.15;
// 看鼠标：鼠标在窗口里动，头/上身轻轻朝鼠标偏；鼠标走了慢慢回正
const look = { x: 0, y: 0, tx: 0, ty: 0, active: false, lastMove: 0 };

// 眨眼（只对 rig.js 标了眼睛的图）
let blinkAt = clock() + rand(3, 6);
let blinkT0 = -1;
let blinkDouble = false;
function blinkCurve(u) { // 40ms 闭上、停 30ms、70ms 睁开
  if (u < 0) return 0;
  if (u < 0.04) return smooth(0, 0.04, u);
  if (u < 0.07) return 1;
  return 1 - smooth(0.07, 0.14, u);
}

// 闲置小动作 / 泡泡 / 水花
let idleTimer = null;
let lastIdleAct = '';
let bubbleTimer = null;
let spoutTimer = null;

function setMotionState(key) {
  target = STATE_PARAMS[key] || STATE_PARAMS.idle;
  stateT0 = clock();
  if (gl && key === 'received') startAction('perk');
  if (gl && key === 'error') startAction('shake', { amp: 4 });
  scheduleIdleAct();
  clearTimeout(bubbleTimer);
  if (key === 'idle') scheduleBubbles();
  clearInterval(spoutTimer);
  if (key === 'done') {
    spout();
    spoutTimer = setInterval(spout, 2800);
  }
}

function scheduleIdleAct() {
  clearTimeout(idleTimer);
  const key = shownKey;
  if (key !== 'idle' && key !== 'sleepy') return;
  const [a, b] = key === 'sleepy' ? [20000, 45000] : [15000, 40000];
  idleTimer = setTimeout(() => {
    if (!pressed && !busyAction() && gl) {
      if (key === 'sleepy') startAction('yawn');
      else startAction(lastIdleAct = pickOther(['stretch', 'look', 'tail'], lastIdleAct)); // 不连着做同一个
    }
    scheduleIdleAct();
  }, rand(a, b));
}

function scheduleBubbles() {
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (shownKey === 'idle') emitBubbles(3 + Math.floor(Math.random() * 3));
    if (shownKey === 'idle') scheduleBubbles();
  }, rand(20000, 40000));
}

// 头顶在窗口里的位置（CSS 像素）
function headTop() {
  if (L2D) return L2D.headTop();
  const h = cur ? cur.h : MAX_H;
  return { x: window.innerWidth / 2 + U.hx + U.sway, y: window.innerHeight - STAGE_BOTTOM - h * U.sy + h * 0.07 + U.droop };
}

function particle(cls, x, y, delay, vars) {
  const el = document.createElement('span');
  el.className = cls;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.animationDelay = `${delay}s`;
  for (const k in vars) el.style.setProperty(k, vars[k]);
  el.addEventListener('animationend', () => el.remove());
  particles.appendChild(el);
}

function emitBubbles(n) {
  const top = headTop();
  for (let i = 0; i < n; i++) {
    const s = rand(6, 12);
    particle('bubble', top.x + rand(-22, 22), top.y + rand(-4, 6), i * 0.35 + rand(0, 0.2), {
      '--s': `${s.toFixed(1)}px`, '--dx': `${rand(-14, 14).toFixed(1)}px`, '--up': `${rand(40, 70).toFixed(1)}px`,
    });
  }
}

function spout() {
  if (shownKey !== 'done') return;
  const top = headTop();
  for (let i = 0; i < 10; i++) {
    const dx = (i / 9 - 0.5) * 46 + rand(-4, 4);
    particle('drop', top.x + rand(-3, 3), top.y + 2, rand(0, 0.12), {
      '--dx': `${dx.toFixed(1)}px`, '--up': `${(46 - Math.abs(dx) * 0.5 + rand(-6, 6)).toFixed(1)}px`,
    });
  }
}

// 每帧算出来的形变量（也给粒子定位用）
const U = { sx: 0, sy: 1, sway: 0, droop: 0, shake: 0, tail: 0, fx: 0, fy: 0, hx: 0, hy: 0, hr: 0, blink: 0 };

function step(dt, t) {
  const k = 1 - Math.exp(-dt / 0.1); // ~300ms 走完 95%
  for (const n in target) P[n] += (target[n] - P[n]) * k;
  ph.breath += (dt * TAU) / P.breathT;
  ph.sway += (dt * TAU) / P.swayT;
  ph.flex += (dt * TAU) / 1.7;
  ph.nod += (dt * TAU) / P.nodT;
  ph.tilt += (dt * TAU) / P.tiltT;

  const breath = 0.5 - 0.5 * Math.cos(ph.breath);
  const nod = 0.5 - 0.5 * Math.cos(ph.nod);
  const droopGate = shownKey === 'error' ? smooth(0.4, 0.9, t - stateT0) : 1; // 出错：先抖完再耷拉
  const o = {
    sx: 0,
    sy: 1 + P.breath * breath,
    sway: P.sway * Math.sin(ph.sway),
    droop: P.droop * droopGate * (1 + 0.15 * Math.sin(ph.breath)) + 0.4 * P.nod * nod,
    shake: 0,
    tail: 0,
    fx: P.flex * (Math.sin(ph.sway - 0.9) + 0.35 * Math.sin(ph.flex)),
    fy: 0,
    hx: 0,
    hy: -P.nod * nod,
    hr: P.tilt * Math.sin(ph.tilt),
  };

  actions = actions.filter((a) => t - a.t0 <= a.dur);
  for (const a of actions) a.fn(t - a.t0, o, a);

  // 拖动惯性
  if (!pressed || performance.now() - drag.lastT > 80) { drag.vx *= Math.exp(-dt / 0.05); drag.vy *= Math.exp(-dt / 0.05); }
  const tx = clamp(-drag.vx * 0.01, -8, 8);
  const ty = clamp(drag.vy * 0.006, -4, 4); // 屏幕 y 向下，静止坐标 y 向上：往下拖 → 头发往上飘
  for (let i = 0; i < 2; i++) { // 半步积分两次，稳一点
    const h = dt / 2;
    drag.pvx += (SPRING_W * SPRING_W * (tx - drag.px) - 2 * SPRING_Z * SPRING_W * drag.pvx) * h;
    drag.pvy += (SPRING_W * SPRING_W * (ty - drag.py) - 2 * SPRING_Z * SPRING_W * drag.pvy) * h;
    drag.px += drag.pvx * h;
    drag.py += drag.pvy * h;
  }
  o.fx += drag.px;
  o.fy += drag.py;
  o.hx += drag.px * 0.25;

  // 看鼠标
  const lookOn = look.active && !pressed && performance.now() - look.lastMove < 8000;
  const lk = 1 - Math.exp(-dt / (lookOn ? 0.35 : 1.0));
  look.x += ((lookOn ? look.tx : 0) - look.x) * lk;
  look.y += ((lookOn ? look.ty : 0) - look.y) * lk;
  o.hx += 3.5 * look.x;
  o.hy += 1.2 * look.y;
  o.hr -= 0.035 * look.x;

  // 眨眼
  let blink = 0;
  if (cur && cur.eyes.length && !prev) {
    if (blinkT0 < 0 && t >= blinkAt) { blinkT0 = t; blinkDouble = Math.random() < 0.18; }
    if (blinkT0 >= 0) {
      const u = t - blinkT0;
      blink = Math.max(blinkCurve(u), blinkDouble ? blinkCurve(u - 0.24) : 0);
      if (u > (blinkDouble ? 0.4 : 0.16)) { blinkT0 = -1; blinkAt = t + rand(3, 6); }
    }
  } else if (blinkT0 >= 0) { blinkT0 = -1; blinkAt = t + rand(1, 3); }
  o.blink = blink;

  Object.assign(U, o);

  // 交叉淡化进度
  if (prev) {
    fade += dt / fadeDur;
    if (fade >= 1) { prev = null; fade = 1; }
  }
}

// ======================= WebGL =======================
const VS = `
attribute vec2 aPos;    // 静止坐标：脚底中点为原点，y 向上，CSS 像素
uniform vec2 uCanvas;   // 画布 CSS 尺寸
uniform vec2 uOrigin;   // 原点在画布上的 CSS 坐标（y 向下）
uniform vec2 uSize;     // 当前图的显示宽高
uniform vec2 uScale;    // x: 横向胀缩（随高度加权）  y: 纵向伸缩（脚底锚定）
uniform vec4 uBody;     // x: 身体摆动(头顶处 px)  y: 上身下垂 px  z: 抖动 px  w: 甩尾 px
uniform vec2 uFlex;     // 外缘（头发/裙摆/尾巴）二次飘动 + 拖动惯性
uniform vec3 uHead;     // 头部偏移 x, y 与旋转（弧度）
uniform vec4 uTailBox;  // 尾巴框中心 xy、半宽高 zw（静止坐标）；z<=0 = 没标
varying vec2 vRest;
void main() {
  vRest = aPos;
  float h = max(uSize.y, 1.0);
  float v = clamp(aPos.y / h, 0.0, 1.2);
  float u = aPos.x / max(uSize.x * 0.5, 1.0);
  vec2 p = aPos;
  p.y *= uScale.y;
  p.x *= 1.0 + uScale.x * v;
  p.y -= uBody.y * smoothstep(0.2, 1.0, v);
  float wh = smoothstep(0.42, 0.88, v);
  vec2 piv = vec2(0.0, 0.45 * h * uScale.y);
  float a = uHead.z * wh;
  vec2 d = p - piv;
  p = piv + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
  p += uHead.xy * wh;
  p.x += uBody.x * v * v + uBody.z * pow(v, 0.8);
  float wf = max(smoothstep(0.35, 0.95, abs(u)) * smoothstep(0.04, 0.3, v), 0.3 * v * v);
  p += uFlex * wf;
  if (uTailBox.z > 0.0) {
    vec2 q = abs(aPos - uTailBox.xy) / uTailBox.zw;
    float wt = (1.0 - smoothstep(0.7, 1.4, q.x)) * (1.0 - smoothstep(0.7, 1.4, q.y));
    float tip = smoothstep(-1.0, 1.0, sign(uTailBox.x) * (aPos.x - uTailBox.x) / uTailBox.z);
    p.x += uBody.w * wt * (0.3 + 0.7 * tip);
    p.y += uBody.w * wt * tip * 0.3;
  } else {
    p.x += uBody.w * wf;
  }
  vec2 c = vec2(uOrigin.x + p.x, uOrigin.y - p.y);
  gl_Position = vec4(c.x / uCanvas.x * 2.0 - 1.0, 1.0 - c.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

// 眨眼：眼框内按超椭圆，上睫毛线整条往下滑到 lid 处，滑过的地方用肤色补上（预乘 alpha）
const FS = `
precision highp float;
uniform sampler2D uTex0;  // 淡出中的旧图
uniform sampler2D uTex1;  // 当前图
uniform sampler2D uLid;   // 当前图的「闭眼」底：眼睛框里已按周围肤色平滑填好（inpaintEyes）
uniform vec4 uMap0;       // 静止坐标 -> 纹理坐标：u = x + px*y, v = z + py*w
uniform vec4 uMap1;
uniform float uMix;       // 1 = 只有当前图
uniform float uBlink;     // 0 睁 .. 1 闭
uniform vec4 uEyeA[2];    // 眼框中心(y 向下的静止坐标) xy、半宽高 zw
uniform vec4 uEyeB[2];    // cos, sin, lid, lash
uniform vec4 uEyeC[2];    // z 上沿羽化、w 启用（xy 不用）
uniform vec4 uEyeD[2];    // 头发遮挡线：法线 xy、偏移 z（y 向下的静止坐标），线外侧保持原样；w=0 表示没有
uniform vec4 uEyeE[2];    // z 侧边/下沿羽化、w 超椭圆指数（xy 不用）
varying vec2 vRest;
vec4 tex0(vec2 p) { return texture2D(uTex0, vec2(uMap0.x + p.x * uMap0.y, uMap0.z + p.y * uMap0.w)); }
vec4 tex1(vec2 p) { return texture2D(uTex1, vec2(uMap1.x + p.x * uMap1.y, uMap1.z + p.y * uMap1.w)); }
vec4 lid1(vec2 p) { return texture2D(uLid, vec2(uMap1.x + p.x * uMap1.y, uMap1.z + p.y * uMap1.w)); }
vec4 withBlink(vec2 p) {
  vec4 col = tex1(p);
  if (uBlink <= 0.0) return col;
  for (int i = 0; i < 2; i++) {
    vec4 A = uEyeA[i];
    vec4 B = uEyeB[i];
    vec4 C = uEyeC[i];
    vec4 E = uEyeE[i];
    if (C.w < 0.5) continue;
    vec4 before = col;
    vec2 d = vec2(p.x, -p.y) - A.xy;
    float lx = d.x * B.x + d.y * B.y;
    float ly = -d.x * B.y + d.y * B.x;
    float ex = lx / A.z;
    float ey = ly / A.w;
    if (abs(ex) >= 1.0) continue;
    float k = pow(max(1.0 - pow(abs(ex), E.w), 0.0), 1.0 / E.w);
    float top = -k;
    float bot = k;
    if (ey < top || ey > bot) continue;
    float L = top + (bot - top) * B.z;
    float T = 2.0 * B.w;
    float dd = uBlink * max(L - top - T * 0.5, 0.0);
    float q = bot - uBlink * max(bot - (L + T * 0.5), 0.0);
    float aa = 1.0 / A.w;
    float sy = (ey - dd) * A.w;
    vec2 s = A.xy + vec2(lx * B.x - sy * B.y, lx * B.y + sy * B.x);
    vec4 lash = tex1(vec2(s.x, -s.y));
    vec4 fill = lid1(p);
    float rr = pow(pow(abs(ex), E.w) + pow(max(ey, 0.0), E.w), 1.0 / E.w);
    float edge = 1.0 - smoothstep(1.0 - E.z, 1.0, rr); // 侧边和下沿羽化，不留硬边
    float wu = dd > 0.0 ? smoothstep(top, top + C.z, ey) * (1.0 - smoothstep(top + dd - aa, top + dd, ey)) : 0.0;
    float wl = smoothstep(top + dd - aa, top + dd, ey) * (1.0 - smoothstep(top + dd + T - aa, top + dd + T, ey));
    float wd = smoothstep(q - aa, q, ey) * (1.0 - smoothstep(bot - aa, bot, ey)); // 和睫毛带下沿对齐，接缝处不漏出原图的虹膜
    col = mix(col, fill, clamp(wu + wl + wd, 0.0, 1.0) * edge);
    float dk = (1.0 - smoothstep(0.12, 0.30, dot(lash.rgb, vec3(0.3, 0.59, 0.11)))) * lash.a; // 睫毛带只搬深色睫毛，眼白/虹膜不跟下来
    dk *= 1.0 - smoothstep(0.06, 0.14, lash.b - max(lash.r, lash.g)); // 偏蓝的深色是虹膜描边，也不要
    col = mix(col, lash, wl * dk * edge);
    vec4 D = uEyeD[i];
    if (D.w > 0.5) col = mix(col, before, smoothstep(-0.6, 0.6, dot(D.xy, vec2(p.x, -p.y)) - D.z)); // 压在眼睛上的头发不动
  }
  return col;
}
void main() {
  vec4 b = withBlink(vRest);
  gl_FragColor = uMix >= 1.0 ? b : mix(tex0(vRest), b, uMix);
}`;

let gl = null;
let prog = null;
const L = {}; // uniform locations
let meshCount = 0;
let dpr = window.devicePixelRatio || 1;
const PAD = 2; // 纹理四周留 2px 透明边，夹边采样不出黑白边
const texCache = new Map(); // file -> Promise<纹理信息>
let cur = null; // 当前图
let prev = null; // 淡出中的旧图
let fade = 1;
let fadeDur = FADE_MS / 1000;
let showToken = 0;

function fail(where, err) {
  console.error(`[dsh-pet] WebGL ${where}失败，回落到 <img> + CSS：`, err);
  gl = null;
  document.body.classList.remove('gl');
  canvas.hidden = true;
}

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function initGL() {
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('getContext("webgl") 返回 null');
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    for (const n of ['uCanvas', 'uOrigin', 'uSize', 'uScale', 'uBody', 'uFlex', 'uHead', 'uTailBox', 'uTex0', 'uTex1', 'uLid',
      'uMap0', 'uMap1', 'uMix', 'uBlink', 'uEyeA', 'uEyeB', 'uEyeC', 'uEyeD', 'uEyeE']) L[n] = gl.getUniformLocation(prog, n);
    // 网格：覆盖最大显示框 300x240（四周多 2px 给透明边），20 x 24 格
    const COLS = 20;
    const ROWS = 24;
    const x0 = -MAX_W / 2 - PAD;
    const y0 = -PAD;
    const cw = (MAX_W + 2 * PAD) / COLS;
    const ch = (MAX_H + 2 * PAD) / ROWS;
    const pos = [];
    for (let r = 0; r <= ROWS; r++) for (let c = 0; c <= COLS; c++) pos.push(x0 + c * cw, y0 + r * ch);
    const idx = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        idx.push(a, a + 1, a + COLS + 1, a + 1, a + COLS + 2, a + COLS + 1);
      }
    }
    meshCount = idx.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(L.uTex0, 0);
    gl.uniform1i(L.uTex1, 1);
    gl.uniform1i(L.uLid, 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 预乘 alpha
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail('上下文丢失，', e); show(shownFile, 0); });
    document.body.classList.add('gl');
  } catch (err) {
    fail('初始化', err);
  }
}

// 原图像素 -> 静止坐标（y 向上），fit = 显示尺寸
function rigFor(file, nw, nh, w, h) {
  const r = RIG[file] || {};
  const s = w / nw;
  const eyes = (r.eyes || []).slice(0, 2).map((e) => {
    const rot = ((e.rot || 0) * Math.PI) / 180;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const ry = e.h / 2;
    let D = [0, 0, 0, 0];
    if (e.hair) { // 箭头 (x0,y0)->(x1,y1) 右手边是头发
      const [x0, y0, x1, y1] = e.hair;
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      D = [nx, ny, nx * (x0 * s - w / 2) + ny * (y0 * s - h), 1];
    }
    return {
      A: [cx * s - w / 2, cy * s - h, (e.w / 2) * s, ry * s],
      B: [cs, sn, e.lid ?? 0.6, e.lash ?? 0.22],
      C: [0, 0, (e.feather ?? 2) / ry, 1],
      D,
      E: [0, 0, Math.max(e.edge ?? 2, 0.5) / Math.min(e.w / 2, ry), e.round ?? 2.6],
    };
  });
  const t = r.tail;
  const tail = t ? [(t.x + t.w / 2) * s - w / 2, h - (t.y + t.h / 2) * s, (t.w / 2) * s, (t.h / 2) * s] : [0, 0, 0, 0];
  return { eyes, tail };
}

// 闭眼用的底图：把标注的眼睛框（含眼线）从框外的肤色往里平滑填充（调和插值，SOR 迭代），
// 头发/眼线/眼白这些非肤色像素不当边界，于是盖上去的眼皮和周围的脸、腮红连成一片，不出色块
function inpaintEyes(cx, W, H, eyes, kx, ky) {
  const img = cx.getImageData(0, 0, W, H);
  const d = img.data;
  const skinLike = (i) => d[i + 3] > 200 && d[i] >= 236 && d[i + 1] >= 180 && d[i + 2] >= 165 && d[i] - d[i + 2] >= 4 && d[i] - d[i + 1] >= 2; // 眼线/头发的抗锯齿灰边不算肤色
  for (const e of eyes.slice(0, 2)) {
    const rot = ((e.rot || 0) * Math.PI) / 180;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const n = e.round ?? 2.6;
    const ex = PAD + (e.x + e.w / 2) * kx;
    const ey = PAD + (e.y + e.h / 2) * ky;
    const rx = (e.w / 2) * kx + 1; // 比 shader 的框大 1px，边上采样不露原图
    const ry = (e.h / 2) * ky + 1;
    let hair = null;
    if (e.hair) {
      const [hx0, hy0, hx1, hy1] = e.hair;
      const ax = PAD + hx0 * kx;
      const ay = PAD + hy0 * ky;
      hair = [-(PAD + hy1 * ky - ay), PAD + hx1 * kx - ax, ax, ay];
    }
    const R = Math.ceil(Math.hypot(rx, ry)) + 2;
    const x0 = Math.max(0, Math.floor(ex - R));
    const x1 = Math.min(W - 1, Math.ceil(ex + R));
    const y0 = Math.max(0, Math.floor(ey - R));
    const y1 = Math.min(H - 1, Math.ceil(ey + R));
    const bw = x1 - x0 + 1;
    const M = new Uint8Array(bw * (y1 - y0 + 1)); // 0 不参与，1 肤色边界（固定），2 待填
    const F = new Float32Array(M.length * 3);
    const todo = [];
    let sr = 0, sg = 0, sb = 0, sc = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = (y - y0) * bw + (x - x0);
        const i = (y * W + x) * 4;
        const dx = x + 0.5 - ex;
        const dy = y + 0.5 - ey;
        const lx = dx * cs + dy * sn;
        const ly = -dx * sn + dy * cs;
        const inEye = Math.abs(lx / rx) ** n + Math.abs(ly / ry) ** n <= 1
          && !(hair && (x + 0.5 - hair[2]) * hair[0] + (y + 0.5 - hair[3]) * hair[1] > 0);
        if (inEye && x > x0 && x < x1 && y > y0 && y < y1) { M[j] = 2; todo.push(j); }
        else if (skinLike(i)) {
          M[j] = 1;
          F[j * 3] = d[i]; F[j * 3 + 1] = d[i + 1]; F[j * 3 + 2] = d[i + 2];
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sc++;
        }
      }
    }
    if (!sc) continue;
    for (const j of todo) { F[j * 3] = sr / sc; F[j * 3 + 1] = sg / sc; F[j * 3 + 2] = sb / sc; }
    for (let it = 0; it < 300; it++) {
      for (const j of todo) {
        let c = 0, r = 0, g = 0, b = 0;
        for (const k of [j - 1, j + 1, j - bw, j + bw]) {
          if (M[k]) { r += F[k * 3]; g += F[k * 3 + 1]; b += F[k * 3 + 2]; c++; }
        }
        if (!c) continue;
        F[j * 3] += 1.85 * (r / c - F[j * 3]);
        F[j * 3 + 1] += 1.85 * (g / c - F[j * 3 + 1]);
        F[j * 3 + 2] += 1.85 * (b / c - F[j * 3 + 2]);
      }
    }
    for (const j of todo) {
      const i = ((y0 + Math.floor(j / bw)) * W + x0 + (j % bw)) * 4;
      d[i] = F[j * 3]; d[i + 1] = F[j * 3 + 1]; d[i + 2] = F[j * 3 + 2];
    }
  }
  cx.putImageData(img, 0, 0);
}

function loadTex(file) {
  if (!texCache.has(file)) {
    texCache.set(file, (async () => {
      const im = new Image();
      im.src = `../assets/${file}`;
      await im.decode();
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      const s = Math.min(1, MAX_W / nw, MAX_H / nh);
      const tw = Math.max(1, Math.round(nw * s * dpr)); // 纹理按屏幕像素预缩好：静止时一个纹素对一个屏幕像素
      const th = Math.max(1, Math.round(nh * s * dpr));
      const cv = document.createElement('canvas');
      cv.width = tw + 2 * PAD;
      cv.height = th + 2 * PAD;
      const cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(im, PAD, PAD, tw, th);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); // file:// 被判跨源时这里抛 SecurityError
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      let lid = null;
      const eyes = (RIG[file] || {}).eyes;
      if (eyes && eyes.length) { // 标了眼睛的图再做一张「闭眼底」（同尺寸），眨眼时眼皮从这张取色
        inpaintEyes(cx, cv.width, cv.height, eyes, tw / nw, th / nh);
        lid = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, lid);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      const w = tw / dpr;
      const h = th / dpr;
      const TW = cv.width;
      const TH = cv.height;
      return {
        file, tex, lid, w, h, tw,
        map: [(PAD + tw / 2) / TW, dpr / TW, (PAD + th) / TH, -dpr / TH],
        ...rigFor(file, nw, nh, w, h),
      };
    })());
  }
  return texCache.get(file);
}

function glShow(file, fadeMs) {
  const token = ++showToken;
  loadTex(file).then((t) => {
    if (token !== showToken || !gl) return;
    if (!cur || fadeMs <= 0) { cur = t; prev = null; fade = 1; return; }
    if (t === cur) return;
    if (!(prev && fade < 0.5)) prev = cur; // 正在淡化时：留下更显眼的那张当旧图
    cur = t;
    fade = 0;
    fadeDur = fadeMs / 1000;
  }).catch((err) => { if (gl) { fail('贴图', err); show(shownFile, 0); } });
}

function resizeIfNeeded() {
  const d = window.devicePixelRatio || 1;
  if (d !== dpr) { // 挪到别的缩放比例的屏幕：按新比例重建纹理
    dpr = d;
    for (const p of texCache.values()) p.then((t) => { if (gl) { gl.deleteTexture(t.tex); if (t.lid) gl.deleteTexture(t.lid); } }).catch(() => {});
    texCache.clear();
    cur = null;
    prev = null;
    if (shownFile) glShow(shownFile, 0);
  }
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function draw() {
  resizeIfNeeded();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!cur) return;
  const old = prev || cur;
  const m = prev ? smooth(0, 1, fade) : 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  // 原点对齐到整屏幕像素：静止时贴图不糊
  const ox = (Math.round((canvas.width - cur.tw) / 2) + cur.tw / 2) / dpr;
  const oy = (canvas.height - Math.round(STAGE_BOTTOM * dpr)) / dpr;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, old.tex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, cur.tex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, cur.lid || cur.tex);
  gl.uniform2f(L.uCanvas, cssW, cssH);
  gl.uniform2f(L.uOrigin, ox, oy);
  gl.uniform2f(L.uSize, old.w + (cur.w - old.w) * m, old.h + (cur.h - old.h) * m);
  gl.uniform2f(L.uScale, U.sx, U.sy);
  gl.uniform4f(L.uBody, U.sway, U.droop, U.shake, U.tail);
  gl.uniform2f(L.uFlex, U.fx, U.fy);
  gl.uniform3f(L.uHead, U.hx, U.hy, U.hr);
  gl.uniform4fv(L.uTailBox, cur.tail);
  gl.uniform4fv(L.uMap0, old.map);
  gl.uniform4fv(L.uMap1, cur.map);
  gl.uniform1f(L.uMix, m);
  gl.uniform1f(L.uBlink, U.blink);
  const A = new Float32Array(8);
  const B = new Float32Array(8);
  const C = new Float32Array(8);
  const D = new Float32Array(8);
  const E = new Float32Array(8).fill(2.6); // 空槽也给个正指数，免得 pow(…, 1/0)
  cur.eyes.forEach((e, i) => { A.set(e.A, i * 4); B.set(e.B, i * 4); C.set(e.C, i * 4); D.set(e.D, i * 4); E.set(e.E, i * 4); });
  gl.uniform4fv(L.uEyeA, A);
  gl.uniform4fv(L.uEyeB, B);
  gl.uniform4fv(L.uEyeC, C);
  gl.uniform4fv(L.uEyeD, D);
  gl.uniform4fv(L.uEyeE, E);
  gl.drawElements(gl.TRIANGLES, meshCount, gl.UNSIGNED_SHORT, 0);
}

// 帧循环：≈30fps 封顶，窗口不可见就停。
// 画完一帧先 setTimeout 睡到下一帧前再要 rAF：中间不挂 rAF，合成器能真歇着（每个刷新周期都挂 rAF 再跳过，CPU 白烧）
let rafId = 0;
let sleepId = 0;
let lastFrame = 0;
function frame(now) {
  rafId = 0;
  if (!gl || document.hidden) return;
  const dt = Math.min(Math.max(now - lastFrame, 0) / 1000, 0.1);
  lastFrame = now;
  step(dt, now / 1000);
  draw();
  sleepId = setTimeout(() => {
    sleepId = 0;
    if (!rafId && gl && !document.hidden) rafId = requestAnimationFrame(frame);
  }, Math.max(0, FRAME_MS - 4 - (performance.now() - now)));
}
function startLoop() {
  if (!rafId && !sleepId && gl && !document.hidden) { lastFrame = performance.now(); rafId = requestAnimationFrame(frame); }
}
document.addEventListener('visibilitychange', startLoop);

// ======================= 鼠标 =======================
// 透明区域鼠标穿透：进入人物时关掉穿透，离开再打开（拖动中不打开）
let hovering = false;
let pressed = false;
img.addEventListener('mouseenter', () => { hovering = true; window.pet.setIgnore(false); });
img.addEventListener('mouseleave', () => {
  hovering = false;
  if (!pressed) window.pet.setIgnore(true);
});

let downAt = null;
let moved = false;
img.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  pressed = true;
  moved = false;
  downAt = { x: e.screenX, y: e.screenY, cx: e.clientX, cy: e.clientY };
  Object.assign(drag, { vx: 0, vy: 0, lastX: e.screenX, lastY: e.screenY, lastT: performance.now() });
  window.pet.dragStart();
});
// Live2D 模式：命中由 live2d.js 每帧按像素 alpha 判（onHover），按下/右键挂在 window 上、只在点中人时生效
// 提示框模式（noticeMode）：命中区是提示框本身（下面 notice 的 mouseenter/mouseleave），按下/右键走同一套 window 处理
function l2dHover(h) {
  hovering = h;
  if (h) window.pet.setIgnore(false);
  else if (!pressed) window.pet.setIgnore(true);
}
notice.addEventListener('mouseenter', () => l2dHover(true));
notice.addEventListener('mouseleave', () => l2dHover(false));
window.addEventListener('mousedown', (e) => {
  if (!(L2D || noticeMode) || !hovering || e.button !== 0) return;
  pressed = true;
  moved = false;
  downAt = { x: e.screenX, y: e.screenY, cx: e.clientX, cy: e.clientY };
  window.pet.dragStart();
});
window.addEventListener('contextmenu', (e) => {
  if (!(L2D || noticeMode) || !hovering) return;
  e.preventDefault();
  window.pet.showMenu();
});
window.addEventListener('mousemove', (e) => {
  if (L2D) L2D.setPointer(e.clientX, e.clientY);
  if (!pressed) { if (!L2D) lookAt(e.clientX, e.clientY); return; }
  // 拖动速度（屏幕坐标差），喂给头发/尾巴的弹簧
  const now = performance.now();
  const dts = (now - drag.lastT) / 1000;
  if (dts > 0.004) {
    drag.vx = drag.vx * 0.5 + ((e.screenX - drag.lastX) / dts) * 0.5;
    drag.vy = drag.vy * 0.5 + ((e.screenY - drag.lastY) / dts) * 0.5;
    drag.lastX = e.screenX;
    drag.lastY = e.screenY;
    drag.lastT = now;
  }
  if (!moved && Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y) < DRAG_PX) return;
  moved = true;
  window.pet.dragMove();
});
window.addEventListener('mouseup', (e) => {
  if (!pressed || e.button !== 0) return;
  pressed = false;
  window.pet.dragEnd();
  if (!moved && L2D) poke(L2D.where(downAt.cx, downAt.cy));
  else if (!moved && noticeMode) poke(null);
  else if (!moved) {
    const r = img.getBoundingClientRect();
    poke({ head: downAt.cy - r.top < r.height / 2, side: clamp((downAt.cx - (r.left + r.width / 2)) / (r.width / 2), -1, 1) });
  }
  if (!hovering) window.pet.setIgnore(true);
});
img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.showMenu();
});
// 鼠标离开窗口：慢慢回正
document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) look.active = false; });

function lookAt(x, y) {
  const h = cur ? cur.h : MAX_H;
  const headX = window.innerWidth / 2;
  const headY = window.innerHeight - STAGE_BOTTOM - h * 0.7;
  look.tx = clamp((x - headX) / 110, -1, 1);
  look.ty = clamp((headY - y) / 140, -1, 1);
  look.active = true;
  look.lastMove = performance.now();
}

window.pet.onView((v) => { view = v; render(); });
const l2dStart = window.PetL2D ? window.PetL2D.start(l2dCanvas) : Promise.reject(new Error('live2d.js 或依赖脚本没加载'));
l2dStart.then((api) => {
  L2D = api;
  L2D.onHover = l2dHover;
  const ht = L2D.headTop(); // 气泡/特效对齐新头顶（style.css 里 body.l2d 那几条用）
  document.body.style.setProperty('--hx', `${ht.x.toFixed(1)}px`);
  document.body.style.setProperty('--hy', `${ht.y.toFixed(1)}px`);
  document.body.classList.add('l2d');
  render();
}).catch((err) => {
  console.error('[dsh-pet] Live2D 起不来，回落到网格渲染：', err);
  l2dCanvas.hidden = true;
  startMesh(err);
});

// 没有 Live2D 也没有自备贴纸：只显示一个提示框（也是鼠标命中区，拖动/戳/右键退出照常）
function showNotice(reason) {
  const msg = String((reason && reason.message) || reason || '未知原因').replace(/\s+/g, ' ');
  const line1 = document.createElement('div');
  line1.textContent = `Live2D 模型没加载起来：${msg.length > 90 ? `${msg.slice(0, 90)}…` : msg}`;
  const line2 = document.createElement('div');
  line2.className = 'hint';
  line2.textContent = '重新运行 install.ps1 可以修复';
  notice.replaceChildren(line1, line2);
  notice.hidden = false;
  noticeMode = true;
  document.body.classList.add('notice');
  render();
}

function startMesh(reason) {
  window.pet.sprites().then((s) => {
    if (!s) return showNotice(reason);
    initGL();
    sprites = s;
    // 先把所有池里的图拉进缓存，换图时不闪
    for (const f of new Set(Object.values(s).flatMap((e) => e.files || [e.file]))) {
      const im = new Image();
      im.src = `../assets/${f}`;
      preloaded.push(im);
    }
    render();
    startLoop();
  }, showNotice); // sprites.json 读不出来（坏 JSON 等）也走提示框，别静默白屏
}
