// dsh 钩子 -> 宠物。只转发 4 个字段；永远 exit 0、stdout 不输出任何东西。
const http = require('http');

const PORT = Number(process.env.DSH_PET_PORT) || 47824; // 与 main.js 一致
const MAX_BYTES = 1024 * 1024;
const MAX_WAIT_MS = 1000;
const POST_TIMEOUT_MS = 800;

const chunks = [];
let size = 0;
let sent = false;

const quit = () => process.exit(0);

function send() {
  if (sent) return;
  sent = true;
  try {
    const src = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '')); // PowerShell 管道会带 BOM
    const body = JSON.stringify({
      hook_event_name: src.hook_event_name,
      session_id: src.session_id,
      tool_name: src.tool_name,
      cwd: src.cwd,
    });
    setTimeout(quit, POST_TIMEOUT_MS);
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: '/event',
      method: 'POST',
      timeout: POST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); res.on('end', quit); });
    req.on('timeout', () => req.destroy());
    req.on('error', quit);
    req.end(body);
  } catch {
    quit();
  }
}

setTimeout(send, MAX_WAIT_MS);
process.stdin.on('data', (c) => {
  size += c.length;
  if (size > MAX_BYTES) return send();
  chunks.push(c);
});
process.stdin.on('end', send);
process.stdin.on('error', send);
