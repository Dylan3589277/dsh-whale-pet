'use strict';
// Live2D 渲染：PIXI 6 + pixi-live2d-display（cubism4）画 assets/live2d 里的女仆鲸鱼娘（c_0120）。
// 待机动作 / 呼吸 / 眨眼 / 头发尾巴物理都是模型自带、交给库跑；这里只管：取景、≈30fps 手动出帧（窗口不可见就停）、
// 状态 → 表情/动作（带权重淡入淡出）、全屏视线跟随、按像素透明度判鼠标命中。
// 任何一步起不来就 reject，renderer.js 接住后回落到网格渲染（并把原因打到 console）。
(function () {
  const MODEL_URL = '../assets/live2d/c_0120.model3.json';
  const LOAD_TIMEOUT_MS = 12000;
  const FRAME_MS = 33; // ≈30fps 封顶
  const HIT_PROBE = 4; // 命中探针半径（设备像素）：读光标周围 9×9 的 alpha
  const HIT_ALPHA = 24; // 最大 alpha 超过它才算点在人身上，空气区直接穿透
  // 取景：人物实际占的范围（模型画布像素）。getLocalBounds() 只给整张 4068×4068 画布、人只占中间一块，所以用实测值：
  // 2026-10-27 按像素 alpha 量的并集（待机 + splash / selfie / selfieQuick 动作全程，含尾巴和呆毛）
  const BOX = { x0: 545, y0: 394, x1: 4212, y1: 3515 };
  const MARGIN = { side: 8, bottom: 6, top: 100 }; // top = 头顶上方至少留给气泡的高度
  // 头顶（粒子/特效对齐用）与「戳头 / 戳身子」分界线，都是模型画布坐标
  const HEAD = { x: 1800, top: 600, neck: 2250, halfW: 800 };
  const GAZE = { cx: 1800, cy: 1920, rx: 320, ry: 260 }; // 视线中心（模型坐标，两眼之间）与满偏转距离（窗口 px）

  // 表情 = 参数加量（模型里全是 Add 混合）。值取自 assets/live2d/expressions/*.exp3.json（manifest.json 有同一份）
  // 「喵喵手」原文件还引用了模型里不存在的 ParamCheek51/61（原作者遗留），这里去掉；启动时还会再按模型参数表过滤一遍
  // 「哭」原文件叠了 ParamCheek20（= 呆呆眼：两只空白圆眼，原仓库把它永久移除了），这里只留眼泪 + 波浪嘴 + 八字眉，像委屈哭
  const EXPR = {
    '开心兴奋': { ParamCheek76: 1, ParamBrowLX: -1, ParamBrowLY: -0.8, ParamBrowLAngle: -1, ParamBrowLForm: -0.6, ParamBrowRX: -1, ParamBrowRY: -0.8, ParamBrowRAngle: -1, ParamBrowRForm: -0.6, ParamMouthForm: 1.5 },
    '星星眼': { ParamCheek16: 1 },
    '爱心眼': { ParamCheek17: 1, Paramhh2: 1, ParamBrowLY: -0.3, ParamBrowLAngle: 0.2, ParamBrowLForm: -1, ParamBrowRY: -0.3, ParamBrowRAngle: 0.2, ParamBrowRForm: -1 },
    '问号': { ParamCheek74: 1 },
    '感叹号': { ParamCheek75: 1 },
    '生气': { ParamCheek80: 1, ParamCheek23: 1, ParamBrowLX: -1, ParamBrowLY: -0.5, ParamBrowLAngle: -1, ParamBrowLForm: -0.59, ParamBrowRX: -1, ParamBrowRY: -0.45, ParamBrowRAngle: -1, ParamBrowRForm: -0.7 },
    '哭': { ParamCheek27: 1, ParamCheek23: 1, ParamBrowLY: -0.3, ParamBrowLAngle: 0.25, ParamBrowLForm: -1, ParamBrowRY: -0.3, ParamBrowRAngle: 0.25, ParamBrowRForm: -1 },
    '悲伤': { ParamCheek15: 1, ParamBrowLAngle: 0.3, ParamBrowLForm: -1, ParamBrowRAngle: 0.3, ParamBrowRForm: -1, ParamMouthForm: -1.5 },
    '晕晕': { ParamCheek77: 1, ParamEyeLOpen: -0.5, ParamEyeROpen: -0.5, ParamBrowLForm: 1, ParamBrowRForm: 1 },
    '流汗': { ParamCheek19: 1 },
    '阴暗': { Paramhh3: 1 },
    '脸红': { Paramhh2: 1 },
    '心跳': { ParamCheek73: 1 },
    '调皮': { ParamCheek21: 1, ParamEyeROpen: -1, ParamMouthForm: 1.5 },
    '吐舌': { ParamCheek79: 1, ParamMouthForm: 0.97, ParamMouthOpenY: 0.76 },
    '闭眼口水': { ParamCheek22: 1 },
    '吐魂': { ParamCheek18: 1 },
    '喵喵手': { maoshou: 1 },
    'love': { love: 1 },
    '双手比耶': { phone7: 1 },
    '圆眼镜': { ParamCheek70: 1 },
    '方眼镜': { ParamCheek72: 1 },
    '椭圆眼镜': { ParamCheek10: 1 },
    '画笔': { bi: 1 },
    '点菜按下': { pointZ: 1 },
    '鲸鱼': { jingyu: 1 }, // 头顶趴一只小鲸鱼；splash 动作就是它喷水（不挂它，splash 什么也看不见）
    '呆呆眼': { ParamCheek20: 1 }, // 两眼变成空白圆圈，眼神放空（眨眼那一下是两道横线）
    '情绪花花': { ParamCheek26: 360 }, // 参数是花的旋转角：淡入时从 0 转到 360，正好是一圈花转着冒出来
    '撤回': { chehui: 1 }, // 桌面「撤回」图标亮起
    '橡皮': { pi: 1 }, // 桌面「橡皮」图标亮起
    '魔爪': { mozhua: 1 }, // 桌上一罐粉色魔爪
    '魔爪换色': { mozhua2: 1 }, // 只给魔爪罐换成白色，单挂看不见，要跟「魔爪」一起挂
    '墨镜': { ParamCheek71: 1, ParamEyeLOpen: -1, ParamEyeROpen: -1 }, // 像素墨镜（眼睛合上藏在镜片后）
    '头箍': { ParamCheek38: 3 }, // 头箍开关：3 = 摘掉女仆头箍（默认戴着）
    '单边马尾': { fx1: 1 },
    '兔兔贴纸': { ParamCheek82: 1 },
    '猫猫贴纸': { ParamCheek83: 1 },
    '蝴蝶结贴纸': { ParamCheek81: 1 },
    '巴菲': { baleite: 1 }, // 把桌上默认摆着的巴菲拿掉
    '蛋包饭': { point: -1, danbaofan: 1 }, // 点菜板收起、换成一盘蛋包饭 + 手里的番茄酱瓶
    '挤': { ji: 1 }, // 捏扁番茄酱瓶，单挂看不见，要配「蛋包饭」
    '手机换色': { shouji: 1 }, // 粉手机换成白手机，只有手机拿出来（自拍类动作）时看得见
    '深色桌布': { cc2: 1 },
    '鲸鱼放桌上': { fangzhuoshang: 1 },
  };

  // 一次性动作结束后会把参数停在最后一帧（比如自拍完手机一直举着），这些参数在动作结束后缓回默认值
  const MOTION_RESET = {
    selfie: ['phone', 'phone3', 'phone4', 'phone5', 'phone6', 'ParamMouthForm'],
    selfieQuick: ['phone', 'phone3'],
    splash: ['pengshui'],
    aidale: ['Param71', 'Param72', 'ParamMouthForm'], // 头上的包
    ketchup: ['point', 'danbaofan', 'danbaoX', 'danbaoY', 'danbaoz', 'aixing', 'ParamMouthForm', 'ParamMouthOpenY'], // 蛋包饭收回、点菜板放回
    openLid: ['phone', 'phone4', 'phone6'],
    bubble: ['chuipaopao', 'chuipaopao1', 'chuipaopao2', 'chuipaopao3', 'chuipaopao4', 'chuipaopao5', 'chuipaopao6', 'chuipaopao7'], // 泡泡和鼓着的腮帮
  };

  // 状态 → 表情/动作。每个状态有几套，切进来时随机挑一套、不连着重复同一套。
  //   face: 整个状态期间挂着的表情   pulse: 进来先闪一下的表情 [名字, 毫秒]   motion: 进来时播一次的动作（motionDelay 毫秒后）
  //   acts: 待在这个状态里时，每隔 actMs 随机做一个小动作（也不连着重复）；小动作里 then: [名字, 毫秒, 延迟] = 隔一会儿再闪一个
  const IDLE_ACTS = [
    { pulse: [['星星眼'], 2600] },
    { pulse: [['脸红'], 3000] },
    { pulse: [['心跳'], 3000] },
    { pulse: [['调皮'], 2200] },
    { pulse: [['爱心眼'], 2600] },
    { pulse: [['吐舌'], 2000] },
    { pulse: [['喵喵手'], 3200] },
    { motion: 'selfieQuick' },
    { pulse: [['鲸鱼'], 4200], motion: 'splash', motionDelay: 500 }, // 小鲸鱼先淡入再喷水
    // 道具 / 贴纸 / 装扮：挂几秒再摘掉
    { pulse: [['墨镜'], 3000] },
    { pulse: [['头箍'], 3600] }, // 摘下头箍透口气（淡入途中会一闪而过半透明的头箍，正常）
    { pulse: [['单边马尾'], 4000] },
    { pulse: [['兔兔贴纸'], 3200] },
    { pulse: [['猫猫贴纸'], 3200] },
    { pulse: [['蝴蝶结贴纸'], 3200] },
    { pulse: [['巴菲', '吐舌'], 3000] }, // 偷吃：桌上的巴菲不见了 + 吐舌头
    { pulse: [['蛋包饭'], 4200], then: [['挤'], 1300, 1300] }, // 端出蛋包饭，过一会儿捏一下番茄酱瓶
    { pulse: [['深色桌布'], 4000] },
    { pulse: [['鲸鱼放桌上'], 4200] }, // 小鲸鱼下来趴桌上
    // 模型自带的另外几段动作
    { pulse: [['手机换色'], 4300], motion: 'selfie' }, // 换白手机认真自拍（动作 3.3 秒 + 手机收回）
    { motion: 'openLid' }, // 翻开粉色翻盖手机看一眼
    { motion: 'ketchup' }, // 蛋包饭上挤番茄酱画爱心
    { motion: 'bubble' }, // 嚼泡泡糖、吹个泡泡
  ];
  const STATES = {
    idle: { variants: [{}], acts: IDLE_ACTS, actMs: [15000, 40000] }, // 小动作有 23 个，间隔放宽一点免得太闹
    received: {
      variants: [
        { pulse: [['感叹号'], 1600], face: ['星星眼'] },
        { pulse: [['感叹号'], 1600], face: ['开心兴奋'] },
      ],
    },
    working: {
      variants: [
        { face: ['画笔', '圆眼镜'] }, { face: ['画笔', '方眼镜'] }, { face: ['画笔', '椭圆眼镜'] },
        { face: ['画笔', '圆眼镜', '魔爪'] }, // 桌上摆一罐魔爪提神
      ],
      taps: true, // 手一下一下往点菜板上按，像在敲字
      acts: [{ pulse: [['撤回'], 1200] }, { pulse: [['橡皮'], 1600] }], // 干着活偶尔点一下撤回 / 橡皮
      actMs: [6000, 16000],
      gazeDown: 0.35,
    },
    waiting: { variants: [{ face: ['问号'] }, { face: ['问号', '流汗'] }, { face: ['问号', '呆呆眼'] }] }, // 呆呆眼：等你等到发呆
    done: {
      variants: [
        { face: ['开心兴奋', '双手比耶', '鲸鱼'], motion: 'splash', motionDelay: 500 },
        { face: ['开心兴奋', 'love'] },
        { face: ['爱心眼', 'love', '鲸鱼'], motion: 'splash', motionDelay: 500 },
        { face: ['开心兴奋', '双手比耶', 'love'] },
        { face: ['开心兴奋', '情绪花花'] }, // 开心到身边转出一圈花
      ],
    },
    sleepy: {
      variants: [{ face: ['闭眼口水'] }],
      acts: [{ pulse: [['吐魂'], 2600] }, { pulse: [['流汗'], 2000] }, { pulse: [['魔爪', '魔爪换色'], 4200] }], // 白魔爪：犯困了续一罐
      actMs: [20000, 45000],
    },
    error: { variants: [{ face: ['哭'] }, { face: ['悲伤'] }, { face: ['晕晕'] }, { face: ['阴暗', '流汗'] }] },
    angry: {
      variants: [
        { face: ['生气', '喵喵手'] }, { face: ['生气', '喵喵手', '感叹号'] },
        { face: ['感叹号'], motion: 'aidale' }, // 被戳 = 挨了一玩具锤：起包、晕眼（动作 4.8 秒，戳完回待机后接着播完）
      ],
      fade: 0.12,
    },
  };
  const FACE_FADE = 0.35; // 表情淡入淡出（秒）

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function pickIndex(n, avoid) {
    if (n <= 1) return 0;
    let i = Math.floor(Math.random() * (n - 1));
    if (i >= avoid && avoid >= 0) i++;
    return i;
  }
  function withTimeout(p, ms, what) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${what}超时（${ms}ms）`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  async function start(canvas) {
    if (!window.Live2DCubismCore) throw new Error('没有 Live2D Cubism Core（renderer/vendor/live2dcubismcore.min.js 缺失）');
    if (!window.PIXI || !PIXI.live2d || !PIXI.live2d.Live2DModel) throw new Error('PIXI / pixi-live2d-display 没加载上');
    const W = window.innerWidth;
    const H = window.innerHeight;
    let res = window.devicePixelRatio || 1;
    const renderer = new PIXI.Renderer({ view: canvas, width: W, height: H, resolution: res, autoDensity: true, backgroundAlpha: 0, antialias: true });
    const stage = new PIXI.Container();
    let model;
    try {
      model = await withTimeout(PIXI.live2d.Live2DModel.from(MODEL_URL, {
        autoInteract: false, autoUpdate: false, idleMotionGroup: 'idle', motionPreload: 'ALL',
      }), LOAD_TIMEOUT_MS, '模型加载');
    } catch (e) {
      renderer.destroy();
      throw e;
    }
    stage.addChild(model);
    // 整只放进窗口：左右各留 MARGIN.side，底边对齐（留 MARGIN.bottom），水平居中；模型画布点 FX,FY → 窗口 OX,OY，缩放 S
    const S = Math.min((W - 2 * MARGIN.side) / (BOX.x1 - BOX.x0), (H - MARGIN.bottom - MARGIN.top) / (BOX.y1 - BOX.y0));
    const LAYOUT = { FX: (BOX.x0 + BOX.x1) / 2, FY: BOX.y1, S, OX: W / 2, OY: H - MARGIN.bottom };
    model.scale.set(LAYOUT.S);
    model.position.set(LAYOUT.OX - LAYOUT.FX * LAYOUT.S, LAYOUT.OY - LAYOUT.FY * LAYOUT.S);
    const toWin = (mx, my) => ({ x: LAYOUT.OX + (mx - LAYOUT.FX) * LAYOUT.S, y: LAYOUT.OY + (my - LAYOUT.FY) * LAYOUT.S });

    const im = model.internalModel;
    const core = im.coreModel;
    const mm = im.motionManager;
    const paramIds = new Set(core.getModel().parameters.ids);
    const pIndex = new Map();
    for (const name in EXPR) {
      for (const id in EXPR[name]) {
        if (!paramIds.has(id)) {
          console.warn(`[dsh-pet] 表情「${name}」引用了模型里没有的参数 ${id}，已跳过`);
          delete EXPR[name][id];
        }
      }
    }
    const pdef = (id) => {
      if (!pIndex.has(id)) pIndex.set(id, core.getModel().parameters.ids.indexOf(id));
      const i = pIndex.get(id);
      return i < 0 ? 0 : core.getModel().parameters.defaultValues[i];
    };

    // ---------- 表情层：每个表情一个权重，朝目标值匀速淡入淡出 ----------
    const layers = new Map(); // name -> { w, target }
    let baseFace = new Set();
    const pulses = new Map(); // name -> 到期时间
    let fadeSec = FACE_FADE;
    function retarget(now) {
      for (const l of layers.values()) l.target = 0;
      const want = new Set(baseFace);
      for (const [n, until] of pulses) {
        if (until > now) want.add(n);
        else pulses.delete(n);
      }
      for (const n of want) {
        if (!EXPR[n]) continue;
        if (!layers.has(n)) layers.set(n, { w: 0, target: 0 });
        layers.get(n).target = 1;
      }
    }
    function fadeLayers(dt) {
      const k = dt / fadeSec;
      for (const [n, l] of layers) {
        l.w = l.w < l.target ? Math.min(l.target, l.w + k) : Math.max(l.target, l.w - k);
        if (l.w === 0 && l.target === 0) layers.delete(n);
      }
    }
    im.on('beforeModelUpdate', () => {
      for (const [n, l] of layers) {
        if (l.w <= 0) continue;
        const e = EXPR[n];
        for (const id in e) core.addParameterValueById(id, e[id] * l.w);
      }
    });

    // ---------- 一次性动作 + 收尾归位 ----------
    let oneShot = null; // 正在播的一次性动作组名
    const resetting = new Set();
    function playMotion(group, priority) {
      for (const id of MOTION_RESET[group] || []) resetting.delete(id);
      model.motion(group, 0, priority).then((ok) => {
        if (ok) oneShot = group;
      }, (e) => console.warn(`[dsh-pet] 动作 ${group} 播放失败：`, e));
    }
    // 库的规矩是「这一帧有动作在更新就不眨眼」，可待机动作永远在循环 → 一直不眨（实测 10 秒 ParamEyeLOpen 恒为 1）。
    // 待机动作只动呼吸/摆动参数、不碰眼睛，所以只在一次性动作播放时才告诉库「有动作」，待机时照常眨眼
    const mmUpdate = mm.update.bind(mm);
    mm.update = (m, now) => mmUpdate(m, now) && oneShot !== null;
    mm.on('motionFinish', () => {
      if (oneShot) for (const id of MOTION_RESET[oneShot] || []) resetting.add(id);
      oneShot = null;
    });
    let frameDt = 0;
    im.on('afterMotionUpdate', () => {
      if (!resetting.size) return;
      const k = Math.min(1, frameDt * 6);
      for (const id of resetting) {
        const d = pdef(id);
        const v = core.getParameterValueById(id);
        const nv = v + (d - v) * k;
        core.setParameterValueById(id, Math.abs(nv - d) < 1e-3 ? d : nv);
        if (Math.abs(nv - d) < 1e-3) resetting.delete(id);
      }
    });

    // ---------- 状态 ----------
    let stateKey = 'idle';
    let st = STATES.idle;
    const lastVariant = {};
    let lastAct = -1;
    let actTimer = 0;
    let tapTimer = 0;
    let motionTimer = 0;
    function playLater(group, delay) { // 延迟播；期间又换了状态就作废（下面 setState 会清掉）
      clearTimeout(motionTimer);
      motionTimer = setTimeout(() => playMotion(group, PIXI.live2d.MotionPriority.NORMAL), delay || 0);
    }
    let thenTimer = 0;
    function runAct(a) { // 小动作：闪表情 / 播动作 / 隔一会儿再闪一个（then）
      if (a.pulse) for (const n of a.pulse[0]) pulses.set(n, performance.now() + a.pulse[1]);
      if (a.motion) playLater(a.motion, a.motionDelay);
      clearTimeout(thenTimer);
      if (a.then) thenTimer = setTimeout(() => { for (const n of a.then[0]) pulses.set(n, performance.now() + a.then[1]); }, a.then[2]);
    }
    function scheduleAct() {
      clearTimeout(actTimer);
      if (!st.acts) return;
      actTimer = setTimeout(() => {
        if (!oneShot) {
          const i = pickIndex(st.acts.length, lastAct);
          lastAct = i;
          runAct(st.acts[i]);
        }
        scheduleAct();
      }, rand(st.actMs[0], st.actMs[1]));
    }
    function scheduleTap() {
      clearTimeout(tapTimer);
      if (!st.taps) return;
      tapTimer = setTimeout(() => {
        pulses.set('点菜按下', performance.now() + 140);
        scheduleTap();
      }, rand(350, 1100));
    }
    function setState(key) {
      stateKey = STATES[key] ? key : 'idle';
      st = STATES[stateKey];
      const vi = pickIndex(st.variants.length, lastVariant[stateKey] ?? -1);
      lastVariant[stateKey] = vi;
      const v = st.variants[vi];
      fadeSec = st.fade || FACE_FADE;
      baseFace = new Set(v.face || []);
      pulses.clear();
      clearTimeout(motionTimer);
      clearTimeout(thenTimer);
      if (v.pulse) for (const n of v.pulse[0]) pulses.set(n, performance.now() + v.pulse[1]);
      if (v.motion) playLater(v.motion, v.motionDelay);
      lastAct = -1;
      scheduleAct();
      scheduleTap();
    }

    // ---------- 视线 + 命中 ----------
    let ptr = null; // 光标在窗口里的位置（CSS px）
    window.pet.onCursor((p) => { ptr = { x: p.x - window.screenX, y: p.y - window.screenY }; });
    const gazeAt = toWin(GAZE.cx, GAZE.cy);
    function updateGaze() {
      if (!ptr) return;
      const nx = clamp((ptr.x - gazeAt.x) / GAZE.rx, -1, 1);
      const ny = clamp((gazeAt.y - ptr.y) / GAZE.ry - (st.gazeDown || 0), -1, 1);
      im.focusController.focus(nx, ny);
    }
    let hovering = false;
    const api = { onHover: null };
    const probe = new Uint8Array((2 * HIT_PROBE + 1) * (2 * HIT_PROBE + 1) * 4);
    function hitTest() {
      let hit = false;
      if (ptr && ptr.x >= 0 && ptr.y >= 0 && ptr.x < W && ptr.y < H) {
        const gl = renderer.gl;
        const n = 2 * HIT_PROBE + 1;
        const x = clamp(Math.round(ptr.x * res) - HIT_PROBE, 0, gl.drawingBufferWidth - n);
        const y = clamp(gl.drawingBufferHeight - Math.round(ptr.y * res) - HIT_PROBE - 1, 0, gl.drawingBufferHeight - n);
        gl.readPixels(x, y, n, n, gl.RGBA, gl.UNSIGNED_BYTE, probe);
        for (let i = 3; i < probe.length; i += 4) if (probe[i] > HIT_ALPHA) { hit = true; break; }
      }
      if (hit !== hovering) {
        hovering = hit;
        if (api.onHover) api.onHover(hit);
      }
    }

    // ---------- 出帧：≈30fps，窗口不可见就停 ----------
    let raf = 0;
    let sleep = 0;
    let last = 0;
    function frame(now) {
      raf = 0;
      if (document.hidden) return;
      const dtMs = Math.min(100, Math.max(0, now - last));
      last = now;
      frameDt = dtMs / 1000;
      if ((window.devicePixelRatio || 1) !== res) { // 拖到另一块缩放不同的屏上
        res = window.devicePixelRatio || 1;
        renderer.resolution = res;
        renderer.resize(W, H);
      }
      retarget(now);
      fadeLayers(frameDt);
      updateGaze();
      model.update(dtMs);
      renderer.render(stage);
      hitTest(); // 必须紧跟 render：绘制缓冲一交给合成器就读不到了
      sleep = setTimeout(() => {
        sleep = 0;
        if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
      }, Math.max(0, FRAME_MS - 4 - (performance.now() - now)));
    }
    function startLoop() {
      if (!raf && !sleep && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    document.addEventListener('visibilitychange', startLoop);
    canvas.addEventListener('webglcontextlost', (e) => console.error('[dsh-pet] Live2D 的 WebGL 上下文丢失：', e));

    setState('idle');
    startLoop();
    console.log(`[dsh-pet] Live2D 已加载：模型 ${im.originalWidth}×${im.originalHeight}，Cubism Core ${coreVersion()}，dpr ${res}`);

    return Object.assign(api, {
      setState,
      // 戳的位置：上半截算戳头；side -1..1 = 偏左/偏右
      where(x, y) {
        const h = toWin(HEAD.x, HEAD.neck);
        return { head: y < h.y, side: clamp((x - h.x) / (HEAD.halfW * LAYOUT.S), -1, 1) };
      },
      headTop() { return toWin(HEAD.x, HEAD.top); },
      setPointer(x, y) { ptr = { x, y }; },
    });
  }

  function coreVersion() {
    try {
      const v = Live2DCubismCore.Version.csmGetVersion();
      return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${v & 0xffff}`;
    } catch (e) {
      return '未知';
    }
  }

  window.PetL2D = { start };
})();
