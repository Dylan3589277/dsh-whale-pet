# 第三方许可与署名 / Third-party notices

本仓库自己的代码以 [MIT](LICENSE) 发布，**仅适用于本仓库内的代码与文档**。下面这些第三方材料各自保留自己的许可；其中模型与 Cubism Core **不在本仓库里**，由安装脚本在安装时从原始来源下载到你本机。

This repository's own code is MIT-licensed (see [LICENSE](LICENSE)) and that license covers only the code and docs in this repo. The materials below keep their own licenses. The Live2D model and the Cubism Core are **not distributed in this repository**; the installer downloads them from their original sources onto your machine.

---

## 1. Live2D 模型 c_0120（DS 鲸鱼娘）

| 项 | 内容 |
|---|---|
| 来源 | <https://github.com/Andersen216/dsh-whale-girl-live2d> 的 `assets/model/` |
| 钉住的提交 | `f977bef508690e75ba6535cd8f4ce18e7f6ba9b0` |
| 许可 | **CC BY-NC-SA 4.0**（署名-非商业性使用-相同方式共享）<https://creativecommons.org/licenses/by-nc-sa/4.0/> |
| 署名 | 角色原作：**上善无形**（原创「溟月」）<br>女仆鲸鱼娘二次设计：**ZipZipPipe**<br>Live2D 模型制作：**氵六青**（B 站） |
| 本仓库里有没有 | **没有**。安装时由 `install.ps1` 按 `assets/model-files.json` 下载 64 个文件（约 4.2 MB，含上游的 `NOTICE.md` / `AUTHORS.md` / `PROVENANCE.md` / `LICENSE`），逐个核对 sha256，放到安装目录的 `assets/live2d/` |
| 是否修改 | **未修改**模型文件本身。本项目只是在运行时选择要叠加哪些表情参数（`renderer/live2d.js`），并在启动时跳过模型里不存在的参数 |

要点：

- **仅限非商业使用**。不得把这只桌宠或这个模型用于商业目的。
- **相同方式共享**：如果你修改了模型并再分发，需要用同样的 CC BY-NC-SA 4.0 许可发布，并保留上面的署名与上游的 `NOTICE.md` / `AUTHORS.md` / `PROVENANCE.md`。
- 具体条款以上游仓库与 CC BY-NC-SA 4.0 许可原文为准。

## 2. Live2D Cubism Core

- 版权：© Live2D Inc.
- 许可：Live2D Proprietary Software License Agreement，<https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html>
- 本仓库**不包含也不再分发**该文件。安装脚本在安装时从 Live2D 官方地址 `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` 下载它，保存为安装目录下的 `renderer/vendor/live2dcubismcore.min.js`。
- 使用条件（包括个人与小规模使用的免费范围、对企业或商用规模的限制）以上面链接的协议原文为准，请你自行阅读并遵守；是否满足条件由使用者负责。

## 3. 随仓库提供的前端库（`renderer/vendor/`）

| 库 | 版本 | 许可 | 许可原文 |
|---|---|---|---|
| PIXI.js | 6.5.10 | MIT | `renderer/vendor/pixi.js.LICENSE.txt` |
| pixi-live2d-display（`cubism4.min.js`，只含 Cubism 4 运行时） | 0.4.0 | MIT | `renderer/vendor/pixi-live2d-display.LICENSE.txt` |

## 4. Electron

[Electron](https://www.electronjs.org/)（MIT）通过 `npm install` 在安装时下载（`package.json` 里固定为 `45.0.0`），不随仓库分发。其自带的 Chromium 等组件各有自己的许可，随 Electron 一并发布，见 Electron 安装目录里的 `LICENSE` 与 `LICENSES.chromium.html`。

## 5. 其它说明

- 早期版本使用过的静态贴纸（网格动画回落用）**未获再分发许可，本仓库不包含**。如果你自己放入 `assets/sprites.json` 与图片启用回落动画，请自行确认这些图片的许可。
- `docs/intro/` 里的介绍图（`intro.png`、`hero.png`、`snaps/*.png`）含有上述 Live2D 模型的运行截图，以及据该模型 AI 生成的插画，属于模型的衍生作品，**按 CC BY-NC-SA 4.0 授权（非商业、相同方式共享）**，不适用本仓库代码的 MIT 许可。介绍图的版式与文字（`intro.html`）为 MIT。
- 若发现遗漏或署名有误，请开 issue，会尽快更正。

---

*English summary:* Live2D model "c_0120" is by 上善无形 (original character 溟月), ZipZipPipe (maid whale-girl redesign) and 氵六青 (Live2D rigging), licensed CC BY-NC-SA 4.0 (non-commercial, share-alike); it is downloaded at install time from the upstream repository at the pinned commit above and is not redistributed or modified here. The intro images under `docs/intro/` (screenshots of the model and AI artwork derived from it) are derivative works and are licensed CC BY-NC-SA 4.0, not MIT. Live2D Cubism Core is © Live2D Inc. under its proprietary license, downloaded from the official URL and never redistributed — you are responsible for complying with Live2D's terms. PIXI.js 6.5.10, pixi-live2d-display 0.4.0 and Electron are MIT-licensed.
