# INSTALL.md — 给 AI 智能体（dsh）看的安装说明

> 你是 dsh（或其它能执行 PowerShell 的智能体）。用户给了你本仓库的链接 `https://github.com/Dylan3589277/dsh-whale-pet`，并说了「帮我装这个」。按下面的步骤做。每一步都有要执行的命令和判断成功的检查；**检查没过就停下来，把报错原文告诉用户，不要硬往下走**。
>
> 约定：所有命令用 Windows PowerShell 执行。如果你的工具只能跑单条命令，用 `powershell -NoProfile -ExecutionPolicy Bypass -Command "<命令>"` 包一层。

仓库是什么：Windows 桌宠「DSH Whale Pet」，一只会按 dsh 智能体状态（收到消息 / 干活 / 等批准 / 出错 / 做完）换表情和气泡的 Live2D 蓝发女仆鲸尾娘。运行方式：dsh 的原生插件把事件 POST 给本机的桌宠（`127.0.0.1:47824`）。

---

## 步骤 0：先跟用户说清楚，只问一个问题

在做任何事之前，用 3–4 行话告诉用户：

1. 会**下载**：本仓库的代码；Node 依赖（Electron 45.0.0，约 100 MB）；Live2D 官方的 Cubism Core（Live2D Inc. 专有许可）；一套 Live2D 模型文件（64 个，约 4.2 MB，来自 `Andersen216/dsh-whale-girl-live2d`，CC BY-NC-SA 4.0）。
2. 会**修改**：`~\.dsh\profiles\web\cordis.patch.yml`（末尾追加一段插件配置，改之前先备份）；如果选了人设，还有 `~\.dsh\AGENTS.md`（追加一段，同样先备份）。装在 `%LOCALAPPDATA%\dsh-whale-pet`，会在开始菜单建一个快捷方式。
3. 模型和 Cubism Core 都是**仅限非商业 / 个人小规模使用**，不能商用。详见仓库里的 `THIRD_PARTY_NOTICES.md`。
4. 只问用户这一个问题：**要不要装可选的"可爱人设"？** 它会写进 `~\.dsh\AGENTS.md`，让你（智能体）之后的说话方式变成元气的蓝发女仆口吻（带语气词、颜文字，事实和命令照实说）；在新对话里生效，随时可以卸载。默认不装。

用户答「要」→ 记 `$persona = $true`；其它回答（包括没回答）→ `$persona = $false`。**不要再问别的问题**，也不要因为别的不确定的事停下来问；遇到真正的阻塞（缺 Node、没有 dsh profile）按下面各步的说明处理。

---

## 步骤 1：检查前置条件

```powershell
node -v
npm -v
Test-Path "$env:USERPROFILE\.dsh\profiles\web"
```

成功标准：

- `node -v` 输出 `v18.x.x` 或更高；
- `npm -v` 有版本号输出；
- 第三条输出 `True`。

如果设置了 `DSH_HOME` 环境变量（`$env:DSH_HOME` 非空），dsh 数据目录是它而不是 `~\.dsh`，第三条改查 `Test-Path "$env:DSH_HOME\profiles\web"`。

失败时：

- **没有 node / npm，或 node 低于 18**：**不要擅自安装 Node.js**。告诉用户需要 Node.js 18+，给出命令 `winget install OpenJS.NodeJS.LTS`，问他是否同意你来运行；同意再运行，装完需要开一个**新的** PowerShell 窗口才能在 PATH 里找到 `node`，然后重新做步骤 1。
- **`profiles\web` 不存在**：说明 DSH Desktop 还没装或没启动过。让用户先打开一次 DSH Desktop，然后重新检查。如果用户用的是别的 profile，可以设置 `DSH_PET_PROFILE`（见步骤 2），但这时请先跟用户确认 profile 名。

---

## 步骤 2：运行安装脚本

不带人设（`$persona = $false`）：

```powershell
irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/install.ps1 | iex
```

带人设（`$persona = $true`）：

```powershell
$env:DSH_PET_PERSONA='1'; irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/install.ps1 | iex
```

安装脚本会打印 `[1/N]`、`[2/N]` … 的进度，幂等（重复运行安全），任何一步失败都会报错并停下。它做的事：预检 → 下载仓库 → 复制到安装目录 → `npm install` → 下载 Cubism Core → 下载并校验 64 个模型文件（逐个 sha256）→ 备份并追加 `cordis.patch.yml` → （可选）写人设 → 生成 hook 配置 → 建开始菜单快捷方式 → 启动桌宠。

注意：`npm install` 会下载 Electron 二进制，可能要几分钟，请耐心等，不要中途打断。

可调的环境变量（需要时在命令前先设置）：

| 变量 | 作用 |
|---|---|
| `DSH_HOME` | dsh 数据目录，默认 `~\.dsh` |
| `DSH_PET_PROFILE` | 接入哪个 profile，默认 `web` |
| `DSH_PET_HOME` | 安装目录，默认 `%LOCALAPPDATA%\dsh-whale-pet` |
| `DSH_PET_SRC` | 本地文件夹或 zip，离线安装 |
| `DSH_PET_ZIP_URL` | 仓库 zip 的下载地址（镜像） |
| `DSH_PET_MODEL_BASE` | 模型文件的 raw 基础 URL（镜像） |
| `DSH_PET_CORE_URL` | Cubism Core 下载地址 |
| `DSH_PET_PERSONA=1` | 同时装人设 |
| `DSH_PET_SKIP_PLUGIN=1` | 不改 `cordis.patch.yml` |
| `DSH_PET_SHORTCUT_DIR` | 快捷方式目录 |
| `DSH_PET_NO_START=1` | 装完不自动启动 |
| `DSH_PET_PORT` | 运行时事件端口，默认 47824 |

成功标准：脚本跑到最后一步（启动桌宠）并且全程没有红色报错。失败 → 把报错原文给用户，按步骤 5 的表排查，**不要**改用手动路径掩盖问题，除非是 `iex` 不可用（见步骤 7）。

---

## 步骤 3：验证

逐条执行，全部通过才算装好。

**3.1 桌宠在跑，事件端口通：**

```powershell
Invoke-RestMethod http://127.0.0.1:47824/state
```

成功标准：返回一个 JSON 对象（有聚合状态字段），没有连接被拒绝的错误。若设置了自定义 `DSH_PET_PORT`，把端口换成它。

**3.2 插件登记在 patch 文件里，且恰好一条：**

```powershell
$dsh = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
(Select-String -Path (Join-Path $dsh 'profiles\web\cordis.patch.yml') -Pattern 'id: dsh-pet-bridge' -SimpleMatch).Count
```

成功标准：输出 `1`。输出 `0` = 没写进去（或安装时因已有未托管的 `dsh-pet-bridge` 条目被跳过，此时安装脚本会有警告，告诉用户）；输出 `2` 或更多 = 重复，把情况告诉用户，**不要自己删**。

**3.3 桌宠可见：** 桌面（默认主屏右下角）应该出现一只蓝发女仆鲸尾娘。你无法看屏幕时，让用户确认「看到她了吗」。如果出现的是一个文字提示框而不是她，是 Live2D 没起来，转步骤 5。

---

## 步骤 4：让用户试一下

插件靠 dsh 的 web profile **热加载**（`patchReload: live`），保存 `cordis.patch.yml` 后一般不用重启。

- 请用户**随便发一条新消息**，然后看桌宠：收到消息时她会冒「收到！」，干活时会拿起画笔，做完会开心跳两下并说「搞定啦！」。
- 如果用户说她**一点反应都没有**：请**用户自己**重启 DSH Desktop，然后再发一条消息。
- **你自己不要重启 DSH / DSH Desktop**——那会杀掉你当前所在的会话。
- 选了人设的话，告诉用户：人设在**新的对话**里才生效，当前对话的说话方式不会变。

---

## 步骤 5：常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动时提示端口被占用，桌宠退出（退出码 1） | 已经有一只在跑，或别的程序占了 47824 | 先 `Get-NetTCPConnection -LocalPort 47824` 看是谁；确认是别的程序后，换端口：`setx DSH_PET_PORT 47900`，**用户自己**重启 DSH Desktop，再重新运行 `install.ps1`（或手动启动桌宠）。桌宠和插件两边必须同一个值 |
| 屏幕上弹出提示框说 Live2D 起不来 | Cubism Core 或模型文件缺失 / 下载不完整 | 重新运行 `install.ps1`（幂等，补齐缺失文件）；网络问题见下面两行的镜像设置 |
| `npm install` 或 Electron 下载很慢 / 超时 | 国内网络 | 先 `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`，再 `npm config set registry https://registry.npmmirror.com`，然后重跑 `install.ps1` |
| GitHub raw / zip 下载失败 | 网络 | 用 `DSH_PET_ZIP_URL`（仓库 zip）、`DSH_PET_MODEL_BASE`（模型 raw 基础 URL）指向镜像，或把仓库下载到本地后设 `DSH_PET_SRC` 离线安装 |
| 模型文件 sha256 校验失败 | 下载被截断或被镜像改动 | 删除安装目录下 `assets\live2d` 后重跑安装脚本；仍失败就换下载源，**不要**跳过校验 |
| `iex` / 脚本被"执行策略"拦截 | PowerShell 执行策略 | 对 `.ps1` 文件用 `powershell -NoProfile -ExecutionPolicy Bypass -File <路径>`；对 `irm ... \| iex` 一般不受影响 |
| 3.2 输出 0，且安装日志有"已存在 dsh-pet-bridge"警告 | patch 文件里已有一条不是本安装脚本管理的同名条目 | 告诉用户，由用户决定保留哪一条；**不要自己改** |
| 装好了但她不对 dsh 的事件反应 | 插件没加载 | 先确认 3.1、3.2 都通过；请用户重启 DSH Desktop（你不要自己重启）；仍不行看 dsh 日志里 `dsh-pet-bridge` 相关输出 |
| 同时启用了 hook 和插件，事件重复 | 两种接入方式只能选一种 | 默认是插件；用户另外配了 `dsh-hooks-claude-code` 指向 hook 配置的话，让用户去掉其中一个 |

---

## 步骤 6：卸载

用户说要卸载时：

```powershell
irm https://raw.githubusercontent.com/Dylan3589277/dsh-whale-pet/main/uninstall.ps1 | iex
```

或者用已安装的那份：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\dsh-whale-pet\uninstall.ps1"
```

卸载会移除安装脚本写入的带标记配置块（`cordis.patch.yml` 里的 `# >>> dsh-whale-pet` … `# <<< dsh-whale-pet`；`AGENTS.md` 里的 `<!-- >>> dsh-whale-pet persona -->` … `<!-- <<< dsh-whale-pet persona -->`），用户自己的其它内容不动；同时停掉桌宠，删除开始菜单快捷方式、安装目录（仅当其 `package.json` 的 name 是 `dsh-whale-pet`）和 Electron 用户数据目录 `%APPDATA%\dsh-whale-pet`。检查：再跑一次 3.2 的命令应输出 `0`，`Test-Path "$env:LOCALAPPDATA\dsh-whale-pet"` 应为 `False`。

---

## 步骤 7：手动路径（`iex` 不能用 / 被安全策略拦截时）

只有在 `irm ... | iex` 因为环境限制无法运行时才用这一节。它按同样的顺序复现安装脚本做的事。**每一小步都要检查**。下面所有命令在同一个 PowerShell 会话里按顺序执行（变量要沿用）。

**7.1 变量与目录：**

```powershell
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dst = if ($env:DSH_PET_HOME) { $env:DSH_PET_HOME } else { Join-Path $env:LOCALAPPDATA 'dsh-whale-pet' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$dshHome; $dst
```

**7.2 下载仓库并复制到安装目录：**

```powershell
$tmp = Join-Path $env:TEMP 'dsh-whale-pet-src'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest -UseBasicParsing 'https://github.com/Dylan3589277/dsh-whale-pet/archive/refs/heads/main.zip' -OutFile "$tmp\src.zip"
Expand-Archive "$tmp\src.zip" -DestinationPath $tmp
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$tmp\dsh-whale-pet-main\*" $dst -Recurse -Force
Test-Path "$dst\main.js"
```

检查：最后一行输出 `True`。

**7.3 安装依赖（下载 Electron 45.0.0，约 100 MB）：**

```powershell
Push-Location $dst; npm install; node node_modules\electron\install.js; Pop-Location
Test-Path "$dst\node_modules\electron\dist\electron.exe"
```

检查：输出 `True`。

**7.4 下载 Live2D Cubism Core（Live2D Inc. 专有文件，只从官方地址下载）：**

```powershell
Invoke-WebRequest -UseBasicParsing 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js' -OutFile "$dst\renderer\vendor\live2dcubismcore.min.js"
(Get-Item "$dst\renderer\vendor\live2dcubismcore.min.js").Length
```

检查：长度明显大于 50000 字节（一个 HTML 错误页会小得多）。

**7.5 下载并校验 64 个模型文件（固定提交，逐个 sha256）：**

```powershell
$m = Get-Content "$dst\assets\model-files.json" -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($f in $m.files) {
  $enc = ($f.src -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
  $url = "https://raw.githubusercontent.com/$($m.repo)/$($m.commit)/$enc"
  $out = Join-Path "$dst\assets\live2d" $f.path
  New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  Invoke-WebRequest -UseBasicParsing $url -OutFile $out
  $h = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $f.sha256) { throw "sha256 mismatch: $($f.path)" }
}
(Get-ChildItem "$dst\assets\live2d" -Recurse -File).Count
```

检查：没有抛出 `sha256 mismatch`，最后一行输出 `64`。想用镜像时把 `https://raw.githubusercontent.com` 换成镜像的 raw 基础地址。

**7.6 备份并追加插件配置：**

```powershell
$patch = Join-Path $dshHome 'profiles\web\cordis.patch.yml'
if (Select-String -Path $patch -Pattern 'id: dsh-pet-bridge' -SimpleMatch -Quiet) { throw 'cordis.patch.yml 里已经有 dsh-pet-bridge，停下来问用户' }
Copy-Item $patch "$patch.bak-dsh-whale-pet-$ts"
$entry = ($dst -replace '\\', '/') + '/dsh-plugin/lib/index.js'
$block = @"

# >>> dsh-whale-pet (managed by install.ps1; uninstall.ps1 removes this block)
- insert:
    - id: dsh-pet-bridge
      name: '$entry'
# <<< dsh-whale-pet

"@
[System.IO.File]::AppendAllText($patch, $block, $utf8)
(Select-String -Path $patch -Pattern 'id: dsh-pet-bridge' -SimpleMatch).Count
```

检查：最后一行输出 `1`。（这里的 here-string 结束标记 `"@` 必须顶格。）

**7.7 （仅当用户要人设）写入人设：**

```powershell
$agents = Join-Path $dshHome 'AGENTS.md'
if (Test-Path $agents) { Copy-Item $agents "$agents.bak-dsh-whale-pet-$ts" }
$p = [System.IO.File]::ReadAllText("$dst\persona\persona.md", $utf8)
$pblock = "`r`n<!-- >>> dsh-whale-pet persona -->`r`n" + $p.TrimEnd() + "`r`n<!-- <<< dsh-whale-pet persona -->`r`n"
[System.IO.File]::AppendAllText($agents, $pblock, $utf8)
(Select-String -Path $agents -Pattern 'dsh-whale-pet persona' -SimpleMatch).Count
```

检查：输出 `2`（开始和结束两个标记）。如果之前已经有这个块，先停下来问用户。

**7.8 hook 配置：** 手动路径默认走插件，不生成 hook 配置。需要 hook 的话，改为正常运行 `install.ps1`。

**7.9 （可选）开始菜单快捷方式：**

```powershell
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'DSH Whale Pet.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = Join-Path $dst 'node_modules\electron\dist\electron.exe'
$sc.Arguments = '"' + $dst + '"'
$sc.WorkingDirectory = $dst
$sc.Save()
Test-Path $lnk
```

**7.10 启动桌宠并做步骤 3 的验证：**

```powershell
Start-Process -FilePath (Join-Path $dst 'node_modules\electron\dist\electron.exe') -ArgumentList ('"' + $dst + '"') -WorkingDirectory $dst
Start-Sleep -Seconds 4
Invoke-RestMethod http://127.0.0.1:47824/state
```

检查：返回 JSON。然后回到步骤 3 / 步骤 4。

---

## 完成后怎么汇报

用 2–3 行告诉用户：装好了没有（附 3.1 / 3.2 的检查结果）、改了哪两个文件及备份文件名（形如 `cordis.patch.yml.bak-dsh-whale-pet-<时间>`）、如果她没反应要不要重启 DSH Desktop（由用户自己重启）、怎么卸载。**不要夸大**：没验证的不说"已验证"。
