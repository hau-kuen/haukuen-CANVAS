# Canvas Agent 桌面启动器

把 `canvas-agent`（本地 3210 服务）封装成双击即用的桌面应用：Windows 装 exe，macOS 装 dmg。

## 它做什么

启动器本身只是个壳，负责：

1. 用内置运行时起 `canvas-agent` 子进程（`127.0.0.1:3210`）
2. 显示状态 / PID / 运行时长、Endpoint、Token、可直接点开的连接链接
3. 托盘常驻，关窗口不杀服务
4. 可选开机自动启动服务

Agent 能力、生图、工具调用仍然全部在画布里，启动器不碰 API Key。

## 开发

```bash
cd launcher
npm install
npm start          # 直接起 Electron，加载 ../canvas-agent
```

开发模式读取的是 `../canvas-agent`（仓库内的源码 + 已装依赖），不打包。

## 打包

```bash
# Windows（本机即可）
npm run dist:win

# macOS（必须在 macOS 上，或走 CI）
npm run dist:mac-arm     # Apple Silicon
npm run dist:mac-x64     # Intel
```

产物在 `launcher/dist/`：

- `CanvasAgent-Setup-<version>.exe`
- `CanvasAgent-<version>-arm64.dmg` / `-x64.dmg`

### 为什么 dmg 不能在本机出

dmg 依赖 macOS 的 `hdiutil`、`.app` bundle 结构和 `codesign`，Windows 上无法交叉构建。
仓库根有 `.github/workflows/build-desktop.yml`，推到 tag 或手动触发即可在 GitHub Actions 的 macOS runner 上出包。

### macOS 未签名说明

当前配置 `identity: null`，产物未签名、未公证。用户首次打开需要：

- 右键 → 打开，或
- `xattr -dr com.apple.quarantine /Applications/Canvas\ Agent.app`

要消除这个提示必须有 Apple Developer ID 证书，并在 CI 里注入签名 + 公证凭据。

## 升级时配置不丢

设计上分成三块，互相独立：

| 内容 | 位置 | 升级时 |
| --- | --- | --- |
| 服务端代码 | 安装目录 `resources/server/` | 被新版本整块替换（本就该换） |
| Agent Token / 端口 / 来源 | `~/.infinite-canvas/codex-agent.json` | **不动**，不用重新配对 |
| 启动器设置（画布地址、自启、关窗行为） | `<userData>/launcher.json` | **不动**，NSIS 升级不删 appdata |
| 历史配置快照 | `<userData>/backups/<旧版本>_to_<新版本>_<时间戳>/` | 每次版本变化自动新增一份 |

`<userData>` 在 Windows 是 `%APPDATA%\Canvas Agent`，macOS 是 `~/Library/Application Support/Canvas Agent`。

具体保证：

- `nsis.deleteAppDataOnUninstall: false` —— 卸载都不删 appdata，升级更不会
- 启动时比对 `launcher.json` 里的 `lastVersion` 与当前版本，不一致就把 `launcher.json` + `codex-agent.json` 复制到 `backups/`
- 快照只增不删，随时可以翻回旧配置

所以升级步骤就是：装新包 → 打开 → 服务自动起、Token 还是原来那个、画布地址还在。

如果哪天配置真的乱了，去 `backups/` 里挑最近的快照，把 `launcher.json` / `codex-agent.json` 复制回原位即可。

## 脱敏

启动器只做一件事：把服务托管起来，绝不把凭证摊开在界面或日志里。

| 位置 | 处理 |
| --- | --- |
| 界面 Token 行 | 只显示掩码（前 6 位 + `…` + 后 4 位），不能展开明文 |
| 界面连接链接 | 同样只显示掩码版，`agentToken=` 后面的值被替换 |
| 复制 Token / 复制链接 | 走主进程 IPC 读盘写剪贴板，明文不进渲染进程 |
| 服务日志 | 入队前统一过 `redact()`：64 位 hex → 掩码，`sk-*` / `Bearer *` / `agentToken=*` / `apiKey` / `password` → `[REDACTED]` |
| 安装包内容 | `extraResources` 排除 `data/`、`.env*`、`*.pem`、`*.key`、`*.db`、`*.log`、`codex-agent.json`、调试截图 |

关键实现：`electron/redact.js` 独立导出 `maskToken` / `redactWith` / `createRedactor`，可以不依赖 Electron 单测。

**Token 明文只存在于两处**：`~/.infinite-canvas/codex-agent.json`（磁盘）和主进程内存。渲染进程、日志区、安装包里都拿不到完整值。

### 验收

```bash
node --check electron/main.js && node --check electron/redact.js
# 扫描安装产物，确认 0 命中
python scripts/scan-dist-secrets.py launcher/dist/win-unpacked
```

## 图标

```bash
python build/make-icon.py     # 生成 build/icon.png / icon.ico / icon.icns
```

改了图标要把三个文件一起提交，mac 构建需要 `icon.icns`。
