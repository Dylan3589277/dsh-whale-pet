// dsh-pet-bridge：把智能体状态以 Claude-Code 风格的事件 POST 给桌宠（127.0.0.1:47824/event）。
// 铁律：绝不影响智能体 —— POST 即发即忘（不 await、500ms 硬超时、异常全吞）；
// waterfall 监听器一律原样 `return next()`，serial 监听器一律返回 undefined，不改任何数据。
import http from 'node:http';

export const name = 'dsh-pet-bridge';
export const inject = ['agents'];

const DEFAULT_PORT = 47824; // 与 dsh-pet/main.js 一致；DSH_PET_PORT 环境变量或 config.port 可改
const TIMEOUT_MS = 500;
const FALLBACK_SESSION = 'dsh';

export function apply(ctx, config = {}) {
  const port = Number(config?.port) || Number(process.env.DSH_PET_PORT) || DEFAULT_PORT;
  const agents = ctx.agents;

  let lastWarnAt = 0;
  const warn = (what, error) => {
    // 监听器自身出错只写日志（限频），不向外抛
    const now = Date.now();
    if (now - lastWarnAt < 60_000) return;
    lastWarnAt = now;
    try { ctx.logger.warn(`dsh-pet-bridge: ${what}: ${error instanceof Error ? error.message : String(error)}`); } catch {}
  };

  // 即发即忘：不返回 Promise，连接失败（桌宠没开）/超时/任何异常都静默吞掉
  const post = (event) => {
    try {
      const body = JSON.stringify(event);
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/event',
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      });
      const timer = setTimeout(() => req.destroy(), TIMEOUT_MS);
      timer.unref?.();
      req.on('error', () => {});
      req.on('response', (res) => res.resume());
      req.on('close', () => clearTimeout(timer));
      req.end(body);
    } catch (error) {
      warn('post failed', error);
    }
  };

  const send = (hook_event_name, session_id, extra) => {
    post({ hook_event_name, session_id: session_id || FALLBACK_SESSION, ...extra });
  };

  // ---- 会话归属：子分身的事件并入根会话，宠物只认根会话 ----
  const isRoot = (agent) => {
    try { return agents.roots().includes(agent); } catch { return true; }
  };
  const rootOf = (agent) => {
    try {
      let cur = agent;
      for (let depth = 0; cur && depth < 8; depth++) {
        if (agents.roots().includes(cur)) return cur;
        const parent = agents.list().find((p) => p !== cur && agents.isOwnedBy(cur.id, p));
        if (!parent) return cur;
        cur = parent;
      }
      return cur;
    } catch {
      return agent;
    }
  };
  const sidOf = (agent) => (agent ? rootOf(agent)?.id : undefined) || FALLBACK_SESSION;

  // 包一层 try/catch：监听器自己出错只记日志
  const safe = (label, fn) => (...args) => {
    try { return fn(...args); } catch (error) { warn(label, error); }
  };

  const running = new Set(); // 正在跑的根会话（用来过滤回合中途的 user/message）
  const promptAt = new Map(); // 根会话 -> 上次发 UserPromptSubmit 的时间（去重）
  const pending = new Map(); // 根会话 -> 未答复的审批/提问个数（并行多个时算清楚再发 Resume）

  const prompt = (sid) => {
    const now = Date.now();
    if (now - (promptAt.get(sid) ?? 0) < 2000) return;
    promptAt.set(sid, now);
    send('UserPromptSubmit', sid);
  };

  // ---- 会话生命周期 ----
  ctx.on('agent/created', safe('agent/created', ({ agent }) => {
    if (isRoot(agent)) send('SessionStart', agent.id);
    // serial 事件：任何非空返回值都会截断后续监听器，所以这里必须返回 undefined
  }));

  ctx.on('session/event', safe('session/event', (session, event) => {
    if (event?.type !== 'user/message') return;
    const id = session?.id;
    if (!id || running.has(id)) return; // 回合中途的插话不重复报"收到"
    const agent = agents.get(id);
    if (agent && !isRoot(agent)) return; // 子分身收到的任务不算用户提问
    prompt(id);
  }));

  ctx.on('agent/status', safe('agent/status', ({ agent, status }) => {
    if (!isRoot(agent)) return;
    if (status === 'running') {
      running.add(agent.id);
      prompt(agent.id); // 没有 user/message 的自动唤醒也算回合开始（2 秒内去重）
    } else if (status === 'idle') {
      running.delete(agent.id);
      pending.delete(agent.id); // 取消等情况下答复 Promise 可能永不落地，回合结束就清零
      send('Stop', agent.id);
    }
  }));

  ctx.on('agent/error', safe('agent/error', ({ agent }) => {
    if (isRoot(agent)) send('Error', agent.id); // 只报最终失败；agent/request-error 是会重试的瞬时错，不报
  }));

  // ---- 工具前后（waterfall：先发事件，再原样 next()）----
  ctx.on('tools/pre-execute', (exec, next) => {
    try { send('PreToolUse', sidOf(exec?.agent), { tool_name: exec?.name }); } catch (error) { warn('pre-execute', error); }
    return next();
  }, true);

  ctx.on('tools/post-execute', (exec, result, next) => {
    try { send('PostToolUse', sidOf(exec?.agent), { tool_name: exec?.name }); } catch (error) { warn('post-execute', error); }
    return next();
  }, true);

  // ---- 等你批准 / 等你回答（waterfall：先发事件，答复落地后发 Resume，返回值原样不动）----
  const watchWaiting = (eventName, hookName) => {
    ctx.on(eventName, (request, next) => {
      let sid;
      try {
        sid = sidOf(request?.agent);
        pending.set(sid, (pending.get(sid) ?? 0) + 1);
        send(hookName, sid);
      } catch (error) {
        warn(eventName, error);
      }
      const settle = () => {
        try {
          const left = (pending.get(sid) ?? 0) - 1;
          if (left > 0) { pending.set(sid, left); return; }
          if (pending.delete(sid)) send('Resume', sid);
        } catch {}
      };
      let out;
      try {
        out = next();
      } catch (error) {
        settle();
        throw error; // next() 自己抛的原样往外抛，不吞
      }
      try { Promise.resolve(out).then(settle, settle); } catch {}
      return out;
    }, true); // prepend：浏览器端的应答器不会再调 next()，排在后面就看不到了
  };
  watchWaiting('approval/request', 'WaitingApproval');
  watchWaiting('user-questions/request', 'WaitingAnswer');

  // ---- 子分身 ----
  const subagent = (hook) => safe(hook, (info) => {
    const agent = info?.id ? agents.get(info.id) : undefined;
    send(hook, agent ? sidOf(agent) : undefined);
  });
  ctx.on('subagent/start', subagent('SubagentStart'));
  ctx.on('subagent/end', subagent('SubagentStop'));
}
