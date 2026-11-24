"use strict";

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, clipboard, dialog } = require("electron");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const DEFAULT_PORT = 3210;
const DEFAULT_CANVAS_URL = "http://127.0.0.1:3000";
const MAX_LOG_LINES = 800;

// Chromium 缓存（GPUCache / Code Cache 等）默认落在 C 盘 Roaming，占用可达上百 MB。
// 把 sessionData 挪到 D 盘；launcher.json 这类几 KB 的配置仍留在标准 userData，
// 升级、卸载都不会动它。
if (IS_WIN) {
    try {
        const cacheRoot = "D:\\AI\\CanvasAgent-data";
        fs.mkdirSync(cacheRoot, { recursive: true });
        app.setPath("sessionData", cacheRoot);
    } catch {
        /* D 盘不可写时退回默认路径 */
    }
}

const state = {
    status: "stopped", // stopped | starting | running | stopping | error
    port: DEFAULT_PORT,
    pid: null,
    error: "",
    logs: [],
    startedAt: 0,
    connected: false,
};

let win = null;
let tray = null;
let serverProc = null;
let healthTimer = null;
let quitting = false;
let configPath = null;
let settingsPath = null;
let settings = { canvasUrl: DEFAULT_CANVAS_URL, autoStartService: true, closeToTray: true };

/* ---------- 路径 ---------- */

function serverDir() {
    if (app.isPackaged) return path.join(process.resourcesPath, "server");
    return path.resolve(__dirname, "../../canvas-agent");
}

function serverEntry() {
    return path.join(serverDir(), "index.mjs");
}

function agentConfigPath() {
    return path.join(os.homedir(), ".infinite-canvas", "codex-agent.json");
}

function readAgentConfig() {
    try {
        return JSON.parse(fs.readFileSync(agentConfigPath(), "utf8"));
    } catch {
        return null;
    }
}

/* ---------- 设置 ---------- */

function loadSettings() {
    settingsPath = path.join(app.getPath("userData"), "launcher.json");
    try {
        const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        settings = { ...settings, ...raw };
    } catch {
        /* 首次运行 */
    }
    if (!settings.canvasUrl) settings.canvasUrl = DEFAULT_CANVAS_URL;
}

function saveSettings() {
    try {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
        pushLog("[launcher] 保存设置失败：" + error.message);
    }
}

/* ---------- 日志 ---------- */

function logFile() {
    return path.join(app.getPath("userData"), "logs", "launcher.log");
}

// 日志必须落盘：装机环境出问题时，内存日志关掉就没了，等于没有取证。
function appendLogFile(row) {
    try {
        const file = logFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            if (fs.statSync(file).size > 1_000_000) fs.renameSync(file, file + ".1");
        } catch {
            /* 首次写入 */
        }
        fs.appendFileSync(file, row + "\n", "utf8");
    } catch {
        /* 落盘失败不影响运行 */
    }
}

function pushLog(line) {
    const text = redact(String(line)).replace(/\r/g, "").trimEnd();
    if (!text) return;
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    for (const single of text.split("\n")) {
        const row = `${stamp}  ${single}`;
        state.logs.push(row);
        appendLogFile(row);
    }
    if (state.logs.length > MAX_LOG_LINES) state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
    send("log", state.logs.slice(-40));
}

function send(channel, payload) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ---------- 脱敏 ---------- */

// 日志与状态里绝不出现完整 Token / API Key。UI 只拿掩码，明文只留在主进程。
const { maskToken, redactWith } = require("./redact");

let liveToken = "";
function redact(line) {
    return redactWith(line, liveToken);
}

/* ---------- 状态广播 ---------- */

function publicState() {
    const cfg = readAgentConfig();
    const token = cfg?.token || "";
    liveToken = token;
    const masked = maskToken(token);
    const base = (settings.canvasUrl || DEFAULT_CANVAS_URL).replace(/#.*$/, "");
    return {
        status: state.status,
        port: state.port,
        pid: state.pid,
        error: state.error,
        startedAt: state.startedAt,
        logPath: logFile(),
        endpoint: `http://127.0.0.1:${state.port}`,
        hasToken: Boolean(token),
        // 明文 token / link 不出主进程：复制走 IPC
        tokenMasked: masked,
        linkMasked: token ? `${base}#agentUrl=http://127.0.0.1:${state.port}&agentToken=${masked}` : "",
        canvasUrl: settings.canvasUrl,
        autoStartService: settings.autoStartService,
        closeToTray: settings.closeToTray,
        codexInstalled: fs.existsSync(serverEntry()),
    };
}

function broadcast() {
    send("state", publicState());
    updateTray();
}

function buildLink(token) {
    const base = (settings.canvasUrl || DEFAULT_CANVAS_URL).replace(/#.*$/, "");
    // 画布页从 hash 读取 agentUrl / agentToken
    const hash = new URLSearchParams({ agentUrl: `http://127.0.0.1:${state.port}`, agentToken: token });
    return `${base}#${hash.toString()}`;
}

/* ---------- 升级保护 ---------- */

// 升级（版本号变化）时把配置文件快照到 userData/backups/<时间戳>/，
// 保证旧版本的画布地址、Token 关联信息可回溯；纯增量，从不删除历史快照。
function ensureUpgradeBackup() {
    const current = app.getVersion();
    const previous = settings.lastVersion || "";
    if (previous === current) return;
    if (!previous) {
        settings.lastVersion = current;
        saveSettings();
        return;
    }
    try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const dir = path.join(app.getPath("userData"), "backups", `${previous}_to_${current}_${stamp}`);
        fs.mkdirSync(dir, { recursive: true });
        let saved = 0;
        for (const [src, name] of [
            [settingsPath, "launcher.json"],
            [agentConfigPath(), "codex-agent.json"],
        ]) {
            try {
                if (!src || !fs.existsSync(src)) continue;
                const raw = fs.readFileSync(src, "utf8");
                let body = raw;
                if (name === "codex-agent.json") {
                    // 备份只为回滚，不承担保管凭证的职责：token 打码后再落盘。
                    // 原配置在 ~/.infinite-canvas/codex-agent.json，安装升级不会覆盖它。
                    try {
                        const obj = JSON.parse(raw);
                        if (obj.token) obj.token = "[REDACTED]";
                        obj._note = "备份已脱敏：token 不落盘。原配置仍在 ~/.infinite-canvas/codex-agent.json，升级不覆盖。";
                        body = JSON.stringify(obj, null, 2) + "\n";
                    } catch {
                        body = redact(raw);
                    }
                }
                fs.writeFileSync(path.join(dir, name), body, "utf8");
                saved += 1;
            } catch {
                /* 单个文件失败不影响整体 */
            }
        }
        pushLog(`[launcher] 版本 ${previous} → ${current}，已备份 ${saved} 个配置文件：${dir}`);
    } catch (error) {
        pushLog("[launcher] 升级备份失败：" + error.message);
    }
    settings.lastVersion = current;
    saveSettings();
}

/* ---------- 服务进程 ---------- */

function startServer() {
    if (serverProc) return { ok: false, message: "服务已在运行" };
    const entry = serverEntry();
    if (!fs.existsSync(entry)) {
        state.status = "error";
        state.error = "找不到服务入口：" + entry;
        broadcast();
        return { ok: false, message: state.error };
    }

    const cfg = readAgentConfig();
    const port = Number(process.env.CANVAS_AGENT_PORT || cfg?.port || DEFAULT_PORT);
    state.port = port;
    state.status = "starting";
    state.error = "";
    broadcast();

    const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CANVAS_AGENT_PORT: String(port),
    };
    delete env.ELECTRON_NO_ATTACH_CONSOLE;

    pushLog(`[launcher] 启动服务：${entry}（端口 ${port}）`);
    serverProc = spawn(process.execPath, [entry], {
        cwd: serverDir(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    state.pid = serverProc.pid;

    serverProc.stdout.on("data", (chunk) => pushLog(chunk.toString()));
    let stderrBuf = "";
    serverProc.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderrBuf = (stderrBuf + text).slice(-8192);
        pushLog(text);
    });
    serverProc.on("error", (error) => {
        state.status = "error";
        state.error = error.message;
        pushLog("[launcher] 进程错误：" + error.message);
        serverProc = null;
        state.pid = null;
        broadcast();
    });
    serverProc.on("exit", (code, signal) => {
        pushLog(`[launcher] 服务退出 code=${code} signal=${signal ?? "-"}`);
        serverProc = null;
        state.pid = null;
        stopHealthCheck();
        // 端口被占用时服务会立刻退出，报错藏在 stderr 里，必须翻译成人话。
        const occupied = /EADDRINUSE|address already in use|已在使用|通常每个套接字地址/i.test(stderrBuf);
        if (state.status !== "stopping" && state.status !== "stopped") {
            state.status = code === 0 ? "stopped" : "error";
            if (occupied) {
                state.error = `端口 ${state.port} 已被其他程序占用，请关闭占用程序或改端口后重试`;
                pushLog("[launcher] " + state.error);
            } else if (code !== 0) {
                state.error = `服务异常退出（code ${code}），详情见日志：${logFile()}`;
            }
        } else {
            state.status = "stopped";
        }
        broadcast();
        if (tray && !quitting && code !== 0 && code !== null) {
            tray.displayBalloon?.({ title: "Canvas Agent", content: "服务异常退出，请查看日志" });
        }
    });

    startHealthCheck();
    return { ok: true };
}

function stopServer() {
    if (!serverProc) {
        state.status = "stopped";
        broadcast();
        return { ok: true };
    }
    state.status = "stopping";
    broadcast();
    const pid = serverProc.pid;
    pushLog("[launcher] 停止服务…");
    if (IS_WIN) {
        execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
        try {
            process.kill(-pid, "SIGTERM");
        } catch {
            try {
                serverProc.kill("SIGTERM");
            } catch {
                /* ignore */
            }
        }
        setTimeout(() => {
            if (serverProc) {
                try {
                    serverProc.kill("SIGKILL");
                } catch {
                    /* ignore */
                }
            }
        }, 3000);
    }
    return { ok: true };
}

function killServerSync() {
    if (!serverProc) return;
    try {
        if (IS_WIN) {
            require("child_process").execFileSync("taskkill", ["/PID", String(serverProc.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
            });
        } else {
            serverProc.kill("SIGKILL");
        }
    } catch {
        /* ignore */
    }
}

/* ---------- 健康检查 ---------- */

function probeHealth() {
    return new Promise((resolve) => {
        const req = http.get(
            { host: "127.0.0.1", port: state.port, path: "/config", timeout: 1500 },
            (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => {
                    // 服务带 token 鉴权：无凭证访问 /config 返回 401，这恰恰证明端口是通的。
                    // 用 200 当唯一存活标准会让界面永远卡在"未就绪"。
                    const alive = typeof res.statusCode === "number" && res.statusCode < 500;
                    let data = null;
                    try {
                        data = JSON.parse(body);
                    } catch {
                        /* 非 JSON 也说明端口通了 */
                    }
                    resolve({ ok: alive, data });
                });
            },
        );
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false });
        });
        req.on("error", () => resolve({ ok: false }));
    });
}

function startHealthCheck() {
    stopHealthCheck();
    healthTimer = setInterval(async () => {
        const { ok } = await probeHealth();
        if (ok && state.status !== "running") {
            state.status = "running";
            state.startedAt = Date.now();
            state.error = "";
            // 首次启动自动打开画布（仅在服务第一次就绪时）
            broadcast();
        } else if (!ok && state.status === "running") {
            state.status = serverProc ? "starting" : "stopped";
            broadcast();
        } else if (ok && !state.connected) {
            /* noop */
        }
    }, 1200);
    // 立即探一次
    setTimeout(async () => {
        const { ok } = await probeHealth();
        if (ok) {
            state.status = "running";
            state.startedAt = Date.now();
            broadcast();
        }
    }, 700);
}

function stopHealthCheck() {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
}

/* ---------- 窗口 ---------- */

function createWindow() {
    const isDark = true;
    win = new BrowserWindow({
        width: 470,
        height: 812,
        minWidth: 430,
        minHeight: 620,
        show: false,
        backgroundColor: "#0b0d10",
        title: "Canvas Agent",
        icon: path.join(__dirname, "../build/icon.png"),
        titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
        titleBarOverlay: IS_MAC
            ? undefined
            : { color: "#0b0d10", symbolColor: "#e6e9ef", height: 46 },
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    win.loadFile(path.join(__dirname, "../ui/index.html"));
    win.webContents.on("did-finish-load", () => pushLog("[win] loaded"));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => pushLog(`[win] did-fail-load ${code} ${desc} ${url}`));
    win.webContents.on("render-process-gone", (_e, d) => pushLog(`[win] render-gone ${JSON.stringify(d)}`));
    win.webContents.on("console-message", (_e, level, msg) => pushLog(`[render:${level}] ${msg}`));
    win.once("ready-to-show", () => {
        pushLog("[win] ready-to-show, showing");
        win.center();
        win.show();
        win.focus();
    });
    win.on("close", (event) => {
        if (!quitting && settings.closeToTray) {
            event.preventDefault();
            win.hide();
        }
    });
    win.on("closed", () => {
        win = null;
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });
}

function showWindow() {
    if (!win) {
        createWindow();
        return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

/* ---------- 托盘 ---------- */

function trayIcon() {
    const candidates = [
        path.join(__dirname, "../build/tray.png"),
        path.join(__dirname, "../build/icon.png"),
        path.join(process.resourcesPath || "", "build/tray.png"),
    ];
    for (const file of candidates) {
        if (file && fs.existsSync(file)) {
            const img = nativeImage.createFromPath(file);
            if (!img.isEmpty()) return img.resize(IS_MAC ? { width: 18, height: 18 } : { width: 16, height: 16 });
        }
    }
    return nativeImage.createEmpty();
}

function updateTray() {
    if (!tray) return;
    const label = {
        stopped: "未启动",
        starting: "启动中",
        running: "运行中",
        stopping: "停止中",
        error: "异常",
    }[state.status];
    tray.setToolTip(`Canvas Agent v${app.getVersion()} · ${label}`);
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: `Canvas Agent v${app.getVersion()}`, enabled: false },
            { label: `状态：${label}`, enabled: false },
            { type: "separator" },
            { label: "打开面板", click: showWindow },
            {
                label: "打开画布",
                click: () => openCanvas(),
            },
            { type: "separator" },
            state.status === "running" || state.status === "starting"
                ? { label: "停止服务", click: () => stopServer() }
                : { label: "启动服务", click: () => startServer() },
            { label: "重启服务", click: () => restart() },
            { type: "separator" },
            {
                label: "退出",
                click: () => {
                    quitting = true;
                    stopServer();
                    setTimeout(() => app.quit(), 400);
                },
            },
        ]),
    );
}

function createTray() {
    tray = new Tray(trayIcon());
    updateTray();
    tray.on("click", showWindow);
    tray.on("double-click", showWindow);
}

/* ---------- 动作 ---------- */

function restart() {
    stopServer();
    setTimeout(() => startServer(), 900);
    return { ok: true };
}

function openCanvas() {
    const cfg = readAgentConfig();
    if (!cfg?.token) {
        showWindow();
        return { ok: false, message: "服务还没有生成 Token，请先启动服务" };
    }
    const url = buildLink(cfg.token);
    shell.openExternal(url);
    return { ok: true };
}

/* ---------- IPC ---------- */

function registerIpc() {
    ipcMain.handle("state:get", () => publicState());
    ipcMain.handle("logs:get", () => state.logs);
    ipcMain.handle("service:start", () => startServer());
    ipcMain.handle("service:stop", () => stopServer());
    ipcMain.handle("service:restart", () => restart());
    ipcMain.handle("token:copy", () => {
        const cfg = readAgentConfig();
        if (!cfg?.token) return { ok: false, message: "暂无 Token" };
        clipboard.writeText(cfg.token);
        return { ok: true, message: "Token 已复制" };
    });
    ipcMain.handle("endpoint:copy", () => {
        clipboard.writeText(state.endpoint || `http://127.0.0.1:${state.port}`);
        return { ok: true, message: "Endpoint 已复制" };
    });
    ipcMain.handle("link:copy", () => {
        const cfg = readAgentConfig();
        if (!cfg?.token) return { ok: false, message: "暂无 Token" };
        clipboard.writeText(buildLink(cfg.token));
        return { ok: true, message: "连接链接已复制" };
    });
    ipcMain.handle("canvas:open", () => openCanvas());
    ipcMain.handle("canvas:set-url", (_event, url) => {
        settings.canvasUrl = String(url || "").trim() || DEFAULT_CANVAS_URL;
        saveSettings();
        broadcast();
        return { ok: true };
    });
    ipcMain.handle("settings:set", (_event, patch) => {
        settings = { ...settings, ...(patch || {}) };
        saveSettings();
        broadcast();
        return { ok: true };
    });
    ipcMain.handle("config:reveal", () => {
        const dir = path.dirname(agentConfigPath());
        if (fs.existsSync(dir)) shell.openPath(dir);
        return { ok: true };
    });
    ipcMain.handle("logs:clear", () => {
        state.logs = [];
        send("log", []);
        return { ok: true };
    });
}

/* ---------- 生命周期 ---------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => showWindow());

    app.whenReady().then(() => {
        loadSettings();
        configPath = agentConfigPath();
        // 环境快照：装机环境出问题时，这几行决定能不能远程定位。
        pushLog(
            `[launcher] v${app.getVersion()} · ${process.platform}/${process.arch} · electron ${process.versions.electron} · node ${process.versions.node}`,
        );
        pushLog(`[launcher] 入口 ${serverEntry()} · 配置 ${configPath} · 安装目录 ${path.dirname(process.execPath)}`);
        ensureUpgradeBackup();
        registerIpc();
        createWindow();
        createTray();
        // 开机自启
        if (!app.isPackaged) {
            app.setLoginItemSettings({ openAtLogin: false });
        }
        if (settings.autoStartService) {
            setTimeout(() => startServer(), 500);
        } else {
            broadcast();
        }
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
            else showWindow();
        });
    });

    app.on("window-all-closed", () => {
        if (!IS_MAC) {
            // 托盘常驻：窗口关闭不退出
        }
    });

    app.on("before-quit", () => {
        quitting = true;
        killServerSync();
    });
}
