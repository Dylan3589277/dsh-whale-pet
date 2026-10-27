# dsh-whale-pet

**dsh 鲸鱼娘桌宠**：一只蓝发、穿女仆装、拖着大大鲸鱼尾巴的 Live2D 小姑娘，浮在你的 Windows 桌面上。dsh 智能体收到消息、干活、等你批准、出错、做完的时候，她会换表情、做动作、冒气泡。

> **English (short).** A Windows desktop pet for the "dsh" DeepSeek agent (DSH Desktop): a blue-haired maid with a whale tail, rendered with Live2D. A native dsh plugin pushes agent state (received / working / waiting for approval / waiting for your answer / error / done) to the pet over a loopback HTTP endpoint (`127.0.0.1:47824`), and she reacts with expressions, motions and speech bubbles. Windows only for now. Install with the one-liner below (needs Node.js >= 18); the Live2D model and Cubism Core are downloaded at install time and are **non-commercial** (CC BY-NC-SA 4.0 / Live2D proprietary license) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Uninstall: `irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/uninstall.ps1 | iex`.

[![一图看懂 dsh-whale-pet](docs/intro/hero.png)](docs/intro/intro.png)

👉 **[一图看懂：她有哪些动作、怎么玩、怎么装](docs/intro/intro.png)**（介绍图含模型截图与衍生插画，按 CC BY-NC-SA 4.0 授权，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）

## 一键安装

前置条件：Windows、Node.js 18 或更高（带 npm）、已经装过并打开过一次 DSH Desktop（`~\.dsh\profiles\web` 目录存在）。没有 Node.js 的话：`winget install OpenJS.NodeJS.LTS`，装完重开一个 PowerShell 窗口。

在 Windows PowerShell 里运行：

```powershell
irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/install.ps1 | iex
```

想同时装上可爱人设（见下面「可选人设」）：

```powershell
$env:DSH_PET_PERSONA='1'; irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/install.ps1 | iex
```

安装脚本会按 `[n/N]` 打印每一步，任何一步失败都会明确报错并停下。重复运行是安全的（幂等）。它依次做：

1. 预检：Windows、`node` 和 `npm` 在 PATH 里、dsh 的 profile 目录存在
2. 下载本仓库 zip，复制到安装目录 `%LOCALAPPDATA%\dsh-whale-pet`
3. `npm install`（Electron 45.0.0，会下载约 100 MB 的二进制）
4. 从 Live2D 官方地址下载 Cubism Core（`live2dcubismcore.min.js`）
5. 从 [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d) 的固定提交 `f977bef508690e75ba6535cd8f4ce18e7f6ba9b0` 下载 64 个模型文件（约 4.2 MB），逐个按 `assets/model-files.json` 核对 sha256
6. 备份后，把插件配置追加到 `~\.dsh\profiles\web\cordis.patch.yml` 末尾
7. （可选）把人设写进 `~\.dsh\AGENTS.md`
8. 生成 `hook\dsh-hooks.json`（给想用 hook 的人，见「工作原理」）
9. 在开始菜单建快捷方式「DSH Whale Pet」
10. 启动桌宠

所有被改动的已有文件都会先备份为 `<原文件名>.bak-dsh-whale-pet-<yyyyMMdd-HHmmss>`。网络不好（国内）的话看下面「常见问题」里的镜像设置。

## 让你的 dsh 帮你装

不想自己敲命令？把下面这两句直接发给 dsh：

```
https://github.com/Dylan3589277/dsh-whale-pet
帮我装这个
```

dsh 会读仓库里的 [INSTALL.md](INSTALL.md)（它是写给 AI 智能体看的安装说明），先告诉你要下载和改动什么、问你要不要可爱人设，然后替你执行安装并检查结果。

## 使用

- **拖动**：左键按住拖。松手后位置会记住（保存在 `%APPDATA%\dsh-whale-pet\pet-position.json`），下次启动还在原处；第一次默认在主屏右下角。
- **戳她**：单击 = 戳她一下，她会生气 1.5 秒，然后回到原来的状态。
- **右键菜单**：「打开 dsh」（用浏览器打开 `http://127.0.0.1:3080`）/「退出」。
- **点穿**：窗口透明的地方鼠标直接穿透，不会挡住后面的程序；只有鼠标在她身上时才响应。
- **视线**：她的眼睛会跟着鼠标转，鼠标在屏幕任何地方都行。
- **只会有一只**：重复启动会直接退出。
- 开始菜单搜「DSH Whale Pet」可以随时重新启动她。

## 她会对什么有反应

dsh 的插件把运行时事件翻译成"宠物事件"发给她。下面是 dsh 事件和宠物事件的对应关系（按 dsh 0.2.1 的运行时事件整理）：

| 宠物事件 | dsh 事件 |
|---|---|
| `SessionStart` | `agent/created`（根智能体） |
| `UserPromptSubmit` | `session/event` 里的 `user/message`；没有用户消息的自动唤醒用 `agent/status running` 补 |
| `PreToolUse` / `PostToolUse` | `tools/pre-execute` / `tools/post-execute`（带 `tool_name`；子分身的工具并入根会话） |
| `Stop` | `agent/status idle`（根智能体） |
| `SubagentStart` / `SubagentStop` | `subagent/start` / `subagent/end` |
| `WaitingApproval` | `approval/request`（等你批准） |
| `WaitingAnswer` | `user-questions/request`（等你回答） |
| `Resume` | 上面两种请求被答复后（并行多个时全部答完才发） |
| `Error` | `agent/error`（重试用尽后的最终失败；会自动重试的 `agent/request-error` 不报） |

### 状态机

按会话（`session_id`）分别记状态，多个会话合并时的优先级是：error > waiting > working > received > done > sleepy / idle。

- 收到你的消息 → **received**（「收到！」，问号表情），1.5 秒内没有工具事件就转 **working**（「想一想…」）
- 工具执行前后 → **working**，气泡按工具类别：命令「在跑命令…」/ 改文件「在改文件…」/ 读搜「在翻资料…」/ 上网「在上网查…」/ 分身类「在派分身…」/ 计划「在列计划…」/ 其它「干活中…」
- 一轮结束 → **done**（「搞定啦！」，跳两下 + ✨），8 秒后回 **idle**
- 干活超过 15 分钟没有任何事件 → idle；idle 满 30 分钟 → **sleepy**（Zzz）
- 等你批准 → **waiting**（「等你批准~」），等你回答 → **waiting**（「有问题问你~」），气泡变黄，轻晃加小跳；等待期间并行工具的事件不会抢走状态；答复后回 working（「继续干活…」）；2 小时没动静 → idle
- 出错 → **error**（「出错啦！」，抖 1.6 秒，气泡变红）；紧跟着的 Stop 不会盖掉它；8 秒没有新事件 → idle，来了新的工作事件 → working
- 两个及以上会话同时干活（或同时在等），气泡前面加 `×N `；有子分身在跑，气泡后面加 `(分身×N)`

### 状态 → 表情 / 动作

每个状态有几套表现，切进来时随机挑一套，不会连着两次挑同一套。表情是模型表情参数的叠加，0.35 秒淡入淡出。

| 状态 | 表现 |
|---|---|
| idle | 只有待机动作（呼吸、眨眼、头发裙摆尾巴的物理摆动）。每 12–30 秒随机来一个小动作：星星眼 / 脸红 / 心跳 / 调皮 / 爱心眼 / 吐舌 / 喵喵手、快速自拍、头上小鲸鱼冒出来喷水 |
| received | 闪感叹号 + 星星眼，或闪感叹号 + 开心兴奋 |
| working | 拿起画笔，戴圆 / 方 / 椭圆眼镜之一，隔一会儿点一下笔，视线往下看 |
| waiting | 问号，或问号 + 流汗 |
| done | 开心兴奋 + 比耶 / 冒爱心 / 小鲸鱼喷水 的几种组合 |
| sleepy | 闭眼流口水，偶尔吐魂或流汗 |
| error | 哭 / 悲伤 / 晕晕 / 阴暗 + 流汗 四选一 |
| angry（被戳） | 生气 + 喵喵手（有时加感叹号），1.5 秒后回到原状态 |

## 工作原理

```
dsh 运行时 ──(dsh-plugin：原生 cordis 插件)──▶ POST http://127.0.0.1:47824/event
                                                      │
                                         桌宠主进程（Electron：状态机 + 窗口）
                                                      │
                                         渲染进程（Live2D 画面 + 气泡）
```

安装脚本把 `dsh-plugin/` 登记到 dsh 的 web profile，dsh 在运行时事件（智能体创建、工具执行、批准请求、提问、出错……）发生时，由插件把它们 POST 给桌宠。web profile 是 `patchReload: live`，保存配置即热加载，通常不用重启 DSH Desktop；如果装完后她没反应，重启一次 DSH Desktop。

桌宠主进程只监听 `127.0.0.1`（不对外网开放），提供三个接口：

| 接口 | 作用 |
|---|---|
| `POST /event` | 接收事件（JSON，Claude Code hooks 风格：`hook_event_name`、`session_id`、可选 `tool_name`），返回 204。只收 `Content-Type: application/json` |
| `GET /state` | 当前聚合状态和各会话状态，调试用 |
| `POST /debug/snapshot` | body 形如 `{"path":"<绝对路径>\\x.png"}`，把桌宠窗口截成透明 PNG，调试用 |

默认端口 `47824`。被占用时不会自动换端口：桌宠打印原因并以退出码 1 退出。要换端口，宠物、插件（和 hook）两边都设同名环境变量 `DSH_PET_PORT`（插件也可以在 `cordis.patch.yml` 里的 config 写 `port`）。

**对 dsh 智能体的影响**：插件的 POST 是即发即忘（不等待、500 ms 硬超时、异常全部吞掉）；监听器先发事件再原样 `return next()`，不改动任何数据，批准和提问的返回值保持原样；插件自身出错只写 dsh 日志（限频）。

### 想用 hook 而不是插件？

`hook/pet-hook.js` 是 Claude Code hooks 风格的命令行 hook，注册 7 个事件（SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SubagentStart / SubagentStop）。用 `@deepseek-ai/dsh-hooks-claude-code`（或 Claude Code）的人，可以把它的 `configPath` 指向安装后渲染出来的 `%LOCALAPPDATA%\dsh-whale-pet\hook\dsh-hooks.json`。hook 拿不到「等你批准 / 等你回答 / 出错」三种状态，所以默认走插件。**插件和 hook 不要同时启用**，否则事件会重复。hook 脚本自己 800 ms 超时、永远 `exit 0`、不往 stdout 输出任何东西。

### 渲染（Live2D）

- 画面：PIXI.js 6.5.10 + pixi-live2d-display 0.4.0（只含 Cubism 4 运行时）+ Live2D 官方 Cubism Core。约 30 fps 封顶，窗口不可见时整条渲染循环停掉。
- 点穿：窗口默认鼠标穿透；每帧渲染后读取光标周围 9×9 像素，透明度超过阈值才算"在她身上"，才响应鼠标。按住左键拖动期间保持响应，松手后再按位置判断。
- 视线：主进程每 50 ms 读一次全局光标位置，传给页面做头部和眼睛跟随。
- CSP：`default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'`。`'unsafe-eval'` 是因为 PIXI 6 编译着色器会用 `new Function`；`connect-src 'self'` 是因为 pixi-live2d-display 要用 fetch / XHR 读本地的模型文件。脚本来源仍然只有 `'self'`，不加载任何外部地址。开发模式下 Electron 会因此打一条「Insecure Content-Security-Policy」警告，属正常现象。
- 如果 Live2D 起不来（缺 Cubism Core、没有 WebGL、模型 12 秒没加载完），她会弹出一个简短的纯文字提示（窗口仍可拖动，右键 → 退出），建议重新运行 `install.ps1`。

## 可选人设

装的时候加 `DSH_PET_PERSONA=1`，安装脚本会把 [persona/persona.md](persona/persona.md) 的内容写进 `~\.dsh\AGENTS.md`（dsh 会把 `~/.dsh/AGENTS.md` 当作用户全局指令加载）。**这会改变智能体的说话方式**：变成同款蓝发女仆鲸尾娘的元气口吻，会用语气词、颜文字和少量网络用语。

- 只改语气，不改内容：事实、命令、代码、报错原文、坏消息一律照实说；代码块和文件内容里不加任何语气装饰。
- 人设写在带标记的块里（`<!-- >>> dsh-whale-pet persona -->` … `<!-- <<< dsh-whale-pet persona -->`），卸载脚本只会删这个块，不碰你自己写的内容。
- 在**新的对话**里生效，已经开着的对话不受影响。
- 如果装了 dsh-meme 贴纸插件（有 `send_meme` 工具），人设会按规则偶尔配一张表情包；没装就用颜文字。
- 不想要了：删掉 `AGENTS.md` 里这个标记块，或运行卸载脚本。你也可以直接编辑块里的内容改成自己喜欢的风格。

## 环境变量

安装脚本（`install.ps1`）读取：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DSH_HOME` | `~\.dsh` | dsh 的数据目录（与 dsh 自己认的是同一个变量） |
| `DSH_PET_PROFILE` | `web` | 要接入的 dsh profile 名 |
| `DSH_PET_HOME` | `%LOCALAPPDATA%\dsh-whale-pet` | 桌宠安装目录 |
| `DSH_PET_SRC` | （空） | 本地文件夹或 zip，用于离线安装，不再从 GitHub 下载本仓库 |
| `DSH_PET_ZIP_URL` | GitHub 上本仓库的 zip | 换成镜像地址 |
| `DSH_PET_MODEL_BASE` | 上游仓库的 raw 地址 | 模型文件的 raw 基础 URL，用于镜像 |
| `DSH_PET_CORE_URL` | Live2D 官方地址 | Cubism Core 的下载地址 |
| `DSH_PET_PERSONA` | （空） | 设为 `1` 同时安装可爱人设 |
| `DSH_PET_SKIP_PLUGIN` | （空） | 设为 `1` 不修改 `cordis.patch.yml`（例如你想改用 hook） |
| `DSH_PET_SHORTCUT_DIR` | 开始菜单程序目录 | 快捷方式放在哪 |
| `DSH_PET_NO_START` | （空） | 设为 `1` 装完不自动启动桌宠 |

运行时读取：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DSH_PET_PORT` | `47824` | 桌宠、插件、hook 共用的事件端口，三处必须一致 |

## 卸载

```powershell
irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/uninstall.ps1 | iex
```

或者用已安装的那份：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\dsh-whale-pet\uninstall.ps1"
```

卸载会：停掉桌宠；移除安装脚本写入的带标记的配置块（`cordis.patch.yml` 里的插件块、`AGENTS.md` 里的人设块，改之前同样先备份），你自己的其它内容不动；删除开始菜单快捷方式、安装目录（只在它确实是 dsh-whale-pet 时才删）和 Electron 用户数据目录 `%APPDATA%\dsh-whale-pet`（记住的窗口位置）。重复运行是安全的。

## 常见问题

**装完她没反应。** 先确认桌宠在跑：`Invoke-RestMethod http://127.0.0.1:47824/state` 能返回内容。然后检查 `~\.dsh\profiles\web\cordis.patch.yml` 里有一段 `id: dsh-pet-bridge`。再给 dsh 发一条消息试试；仍然没反应就重启 DSH Desktop。

**提示端口被占用，桌宠退出了。** 可能已经有另一只在跑，或者别的程序占了 47824。换一个端口，并在 dsh 和桌宠两边都设置同样的值（先 `setx DSH_PET_PORT 47900`，再重启 DSH Desktop 和桌宠）。

**屏幕上出现一个提示框，说 Live2D 起不来。** Cubism Core 或模型文件没下载成功。重新运行 `install.ps1`（幂等，会补齐缺的文件）。

**`npm install` 或 Electron 下载很慢 / 失败。** 国内网络可以先换镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm config set registry https://registry.npmmirror.com
```

GitHub 访问不顺的话，可以用 `DSH_PET_ZIP_URL`、`DSH_PET_MODEL_BASE` 指向你自己的镜像。

**提示"禁止运行脚本"。** 用文档里的 `irm ... | iex` 不受执行策略影响；如果是运行 `.ps1` 文件，用 `powershell -ExecutionPolicy Bypass -File ...`。

**DSH Desktop 升级后她不动了。** 先检查 `cordis.patch.yml` 里的 `dsh-pet-bridge` 块还在不在（它在 `~\.dsh` 里，正常不受升级影响）；人设同理看 `AGENTS.md`。不在就重新运行安装脚本。

**她会拖慢电脑吗？** 画面约 30 fps 封顶，窗口不可见时停止渲染。因为透明窗口要每帧回读像素来判断点穿，所以会有一点 CPU / GPU 占用；不放心可以随时右键退出。

## 平台

目前只支持 **Windows**（安装脚本是 PowerShell）。macOS / Linux 没有测试过；桌宠本体是 Electron，理论上可以移植，欢迎 PR。

## 不随仓库提供的东西

- **Live2D Cubism Core**：Live2D Inc. 的专有软件，安装时从官方地址下载，不再分发。
- **Live2D 模型文件**：安装时从上游仓库的固定提交下载。
- **早期的网格动画回落用的贴纸图**：没有再分发许可，不包含。高级用法：自己在 `assets/sprites.json` 里放图（格式 `{ "<状态名>": {"files": ["sprites/x.png"], "anim": "..."} }`，文件路径相对 `assets/`），并在 `assets/` 下放对应图片，在 Live2D 起不来时会回落到 WebGL 网格动画。

## 许可与署名

- 本仓库的代码与文档：[MIT](LICENSE)。
- Live2D 模型（DS 鲸鱼娘 `c_0120`）：**CC BY-NC-SA 4.0，仅限非商业**。角色原作 上善无形（原创「溟月」）、女仆鲸鱼娘二次设计 ZipZipPipe、Live2D 模型制作 氵六青。安装时从 [Andersen216/dsh-whale-girl-live2d](https://github.com/Andersen216/dsh-whale-girl-live2d) 下载，本仓库不含、不改动模型文件。
- Live2D Cubism Core：© Live2D Inc.，专有许可，使用者自行遵守其条款。
- PIXI.js 6.5.10、pixi-live2d-display 0.4.0、Electron：MIT。

完整说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。**请勿将这只桌宠（含模型）用于商业用途。**
