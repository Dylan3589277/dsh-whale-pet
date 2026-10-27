const { app, BrowserWindow, Menu, screen, shell, ipcMain } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.DSH_PET_PORT) || 47824; // 与 hook/pet-hook.js 一致；环境变量仅用于避让占用
const WIN_W = 320;
const WIN_H = 380;
const DSH_URL = 'http://127.0.0.1:3080';

const RECEIVED_MS = 1500; // 收到 -> 干活
const DONE_MS = 8000; // 完成 -> 发呆
const ERROR_MS = 8000; // 出错 -> 无新事件则回 idle
const WAITING_STALE_MS = 2 * 60 * 60 * 1000; // 等批准/回答太久没动静视为 idle（防 Resume 丢失卡死）
const WORKING_STALE_MS = 15 * 60 * 1000; // 干活超时无事件视为 idle
const SLEEPY_MS = 30 * 60 * 1000; // 发呆多久后犯困
const FLASH_MS = 2500;
const FORGET_MS = 60 * 60 * 1000; // idle 会话记录保留时长

// 工具名 -> 类别。前半是 dsh 内置工具名；后半是 Claude Code 常见名。
const TOOL_CLASS = {
  command: ['bash', 'pwsh', 'job_output', 'job_list', 'job_kill', 'Bash', 'BashOutput', 'KillShell', 'PowerShell'],
  edit: ['write', 'edit', 'str_replace_editor', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  read: ['read', 'read_image', 'glob', 'grep', 'Read', 'Grep', 'Glob', 'LS'],
  web: ['web_search', 'web_fetch', 'WebFetch', 'WebSearch'],
  agent: ['subagent', 'send_message', 'interrupt_agent', 'list_subagent_models', 'workflow', 'ralph', 'Agent', 'Task'],
  plan: ['todo_write', 'get_goal', 'create_goal', 'update_goal', 'TodoWrite', 'ExitPlanMode'],
};
const CLASS_LABEL = {
  command: '在跑命令…',
  edit: '在改文件…',
  read: '在翻资料…',
  web: '在上网查…',
  agent: '在派分身…',
  plan: '在列计划…',
};
const toolLabel = (name) => {
  for (const [cls, names] of Object.entries(TOOL_CLASS)) if (names.includes(name)) return CLASS_LABEL[cls];
  return '干活中…';
};

// ---- 状态机 ----
const sessions = new Map(); // id -> { state, label, updatedAt }
let subagents = 0;
let lastBusy = Date.now();
let flash = { text: '', until: 0 };
let lastView = '';

function setSession(id, state, label) {
  sessions.set(id, { state, label, updatedAt: Date.now() });
}

function handleEvent(e) {
  const id = e.session_id || 'unknown';
  switch (e.hook_event_name) {
    case 'SessionStart':
      setSession(id, 'idle', '');
      flash = { text: '来啦~', until: Date.now() + FLASH_MS };
      break;
    case 'UserPromptSubmit':
      setSession(id, 'received', '收到！');
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      if (sessions.get(id)?.state === 'waiting') break; // 等答复期间，并行工具的事件不抢状态；靠 Resume 恢复
      setSession(id, 'working', toolLabel(e.tool_name));
      break;
    case 'WaitingApproval':
      setSession(id, 'waiting', '等你批准~');
      break;
    case 'WaitingAnswer':
      setSession(id, 'waiting', '有问题问你~');
      break;
    case 'Resume':
      if (sessions.get(id)?.state === 'waiting') setSession(id, 'working', '继续干活…');
      break;
    case 'Error':
      setSession(id, 'error', '出错啦！');
      break;
    case 'Stop':
      if (sessions.get(id)?.state !== 'error') setSession(id, 'done', '搞定啦！'); // 出错后紧跟的 Stop 不盖掉"出错啦"
      if (![...sessions.values()].some((s) => s.state === 'working')) subagents = 0; // 防 SubagentStop 丢失
      break;
    case 'SubagentStart':
      subagents++;
      break;
    case 'SubagentStop':
      subagents = Math.max(0, subagents - 1);
      break;
    default:
      return;
  }
  lastBusy = Date.now();
  tick();
}

function aggregate(now) {
  const by = (st) => [...sessions.values()].filter((s) => s.state === st);
  const newest = (list) => list.reduce((a, b) => (b.updatedAt >= a.updatedAt ? b : a));
  if (by('error').length) return { state: 'error', text: '出错啦！' };
  const waiting = by('waiting');
  if (waiting.length) return { state: 'waiting', text: (waiting.length >= 2 ? `×${waiting.length} ` : '') + newest(waiting).label };
  const working = by('working');
  if (working.length) {
    const top = newest(working);
    const prefix = working.length >= 2 ? `×${working.length} ` : '';
    const suffix = subagents > 0 ? ` (分身×${subagents})` : '';
    return { state: 'working', text: prefix + top.label + suffix };
  }
  if (by('received').length) return { state: 'received', text: '收到！' };
  if (by('done').length) return { state: 'done', text: '搞定啦！' };
  if (now - lastBusy >= SLEEPY_MS) return { state: 'sleepy', text: 'Zzz' };
  return { state: 'idle', text: now < flash.until ? flash.text : '' };
}

function tick() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const age = now - s.updatedAt;
    if (s.state === 'received' && age >= RECEIVED_MS) setSession(id, 'working', '想一想…');
    else if (s.state === 'done' && age >= DONE_MS) setSession(id, 'idle', '');
    else if (s.state === 'working' && age >= WORKING_STALE_MS) setSession(id, 'idle', '');
    else if (s.state === 'error' && age >= ERROR_MS) setSession(id, 'idle', '');
    else if (s.state === 'waiting' && age >= WAITING_STALE_MS) setSession(id, 'idle', '');
    else if (s.state === 'idle' && age >= FORGET_MS) sessions.delete(id);
  }
  const agg = aggregate(now);
  if (agg.state !== 'idle' && agg.state !== 'sleepy') lastBusy = now;
  const view = JSON.stringify(agg);
  if (view !== lastView) {
    lastView = view;
    if (win && !win.isDestroyed()) win.webContents.send('view', agg);
  }
}

function snapshot() {
  return {
    aggregate: aggregate(Date.now()),
    subagents,
    sessions: [...sessions].map(([id, s]) => ({ id, ...s })),
  };
}

// ---- HTTP ----
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function route(req, res) {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(snapshot()));
  }
  if (req.method === 'POST' && (url === '/event' || url === '/debug/snapshot')) {
    // 只收 JSON：浏览器跨站表单/脚本发不出 application/json 而不触发预检
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      res.writeHead(415);
      return res.end();
    }
    let data;
    try { data = JSON.parse(await readBody(req)); } catch { res.writeHead(400); return res.end(); }
    if (url === '/event') {
      handleEvent(data || {});
      res.writeHead(204);
      return res.end();
    }
    const file = data && data.path;
    if (typeof file !== 'string' || !path.isAbsolute(file) || !file.toLowerCase().endsWith('.png')) {
      res.writeHead(400);
      return res.end('path must be an absolute .png path');
    }
    const img = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, img.toPNG());
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(file);
  }
  res.writeHead(404);
  res.end();
}

function startServer() {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error('[dsh-pet] request failed:', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on('error', (err) => {
    console.error(`[dsh-pet] 事件服务无法监听 127.0.0.1:${PORT}：${err.code || ''} ${err.message}`);
    if (err.code === 'EADDRINUSE') console.error('[dsh-pet] 端口已被占用（可能已有另一只宠物或其它程序），退出。');
    app.exit(1);
  });
  server.listen(PORT, '127.0.0.1');
}

// ---- 窗口 ----
let win = null;
let drag = null;

// 位置记忆：每次拖完把 {x,y} 存进 userData/pet-position.json（不碰 ~/.dsh）；
// 启动读回，夹进那块屏的工作区保证整扇窗都在屏上；文件没有/坏了/那块屏已经拔了 -> 主屏右下角
const posFile = () => path.join(app.getPath('userData'), 'pet-position.json');

function startPos() {
  const wa0 = screen.getPrimaryDisplay().workArea;
  const fallback = { x: wa0.x + wa0.width - WIN_W - 16, y: wa0.y + wa0.height - WIN_H - 8 };
  let p = null;
  try { p = JSON.parse(fs.readFileSync(posFile(), 'utf8')); } catch (e) { return fallback; }
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return fallback;
  const cx = p.x + WIN_W / 2;
  const cy = p.y + WIN_H / 2;
  const d = screen.getAllDisplays().find(({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height);
  if (!d) return fallback;
  const wa = d.workArea;
  return {
    x: Math.round(Math.min(Math.max(p.x, wa.x), wa.x + wa.width - WIN_W)),
    y: Math.round(Math.min(Math.max(p.y, wa.y), wa.y + wa.height - WIN_H)),
  };
}

function createWindow() {
  const pos = startPos();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.send('view', aggregate(Date.now())));
}

function showMenu() {
  Menu.buildFromTemplate([
    { label: '打开 dsh', click: () => shell.openExternal(DSH_URL) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]).popup({ window: win });
}

// 贴纸精灵不随仓库发布；用户自己放了 assets/sprites.json 才走网格渲染，没有就返回 null（渲染层显示提示框）
ipcMain.handle('sprites', () => {
  const file = path.join(__dirname, 'assets', 'sprites.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
});
ipcMain.on('set-ignore', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(!!ignore, ignore ? { forward: true } : undefined);
});
ipcMain.on('drag-start', () => {
  drag = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
});
ipcMain.on('drag-move', () => {
  if (!drag) return;
  const c = screen.getCursorScreenPoint();
  // 用 setBounds 固定宽高，避免高 DPI 下 setPosition 让透明窗口逐步变大
  win.setBounds({
    x: drag.bounds.x + c.x - drag.cursor.x,
    y: drag.bounds.y + c.y - drag.cursor.y,
    width: WIN_W,
    height: WIN_H,
  });
});
ipcMain.on('drag-end', () => {
  const was = drag;
  drag = null;
  if (!was || !win) return;
  const { x, y } = win.getBounds();
  if (x === was.bounds.x && y === was.bounds.y) return; // 只是戳了一下，没挪
  try {
    fs.writeFileSync(posFile(), JSON.stringify({ x, y }));
  } catch (e) {
    console.error('[dsh-pet] 位置没存上：', e.message);
  }
});

// 视线跟随（Live2D 用）：每 50ms 取一次全屏鼠标位置，变了才发给渲染层；不动状态机/HTTP/已有 IPC
let lastCursor = null;
function pollCursor() {
  if (!win || win.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  if (lastCursor && c.x === lastCursor.x && c.y === lastCursor.y) return;
  lastCursor = c;
  win.webContents.send('cursor', c);
}
ipcMain.on('show-menu', showMenu);

// ---- 启动 ----
if (!app.requestSingleInstanceLock()) {
  console.error('[dsh-pet] 已有一只宠物在运行，退出。');
  app.exit(0);
} else {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    startServer();
    createWindow();
    setInterval(tick, 250);
    setInterval(pollCursor, 50);
  });
  app.on('window-all-closed', () => app.quit());
}
