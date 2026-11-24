"use strict";

const api = window.agent;
const $ = (id) => document.getElementById(id);

let current = null;
let logOpen = false;
let ticks = 0;

document.body.classList.add(api.platform === "darwin" ? "mac" : "win");

/* ---------- 渲染 ---------- */

function statusLabel(status) {
    return (
        {
            stopped: "未启动",
            starting: "启动中",
            running: "运行中",
            stopping: "停止中",
            error: "异常",
        }[status] || status
    );
}

function render(state) {
    current = state;

    const pill = $("statusPill");
    pill.className = "status-pill " + state.status;
    $("statusText").textContent = statusLabel(state.status);

    $("endpoint").textContent = state.endpoint;
    $("endpointText").textContent = state.endpoint;
    $("pidText").textContent = state.pid ? `PID ${state.pid}` : "—";
    // 明文 token / 完整链接只在主进程，界面永远只显示掩码，复制走 IPC
    $("tokenText").textContent = state.hasToken ? state.tokenMasked || "已生成" : "启动后生成";
    $("tokenText").style.cursor = state.hasToken ? "pointer" : "default";
    $("tokenText").title = state.hasToken ? "点击复制完整 Token" : "";

    $("linkText").textContent = state.hasToken ? state.linkMasked : "首次启动后生成";
    $("linkText").title = state.hasToken ? "点击复制完整连接链接" : "";

    $("canvasUrl").value = state.canvasUrl || "";
    $("optAutoStart").checked = Boolean(state.autoStartService);
    $("optCloseToTray").checked = Boolean(state.closeToTray);

    const running = state.status === "running" || state.status === "starting";
    const btn = $("btnToggle");
    btn.textContent = running ? "停止服务" : "启动服务";
    btn.classList.toggle("danger", running);
    $("btnRestart").disabled = !running;

    if (state.error) {
        $("errorText").hidden = false;
        $("errorText").textContent = state.error;
    } else {
        $("errorText").hidden = true;
    }

    updateUptime();
}

function updateUptime() {
    if (!current) return;
    if (current.status === "running" && current.startedAt) {
        const sec = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        $("uptimeText").textContent = m > 0 ? `已运行 ${m}m ${s}s` : `已运行 ${s}s`;
    } else {
        $("uptimeText").textContent = current.status === "starting" ? "正在就绪…" : "—";
    }
}

let lastLogs = [];

function renderLogs(lines) {
    lastLogs = lines || [];
    const box = $("logs");
    const empty = $("logsEmpty");
    const has = lastLogs.length > 0;
    box.hidden = !logOpen || !has;
    if (empty) empty.hidden = !logOpen || has;
    if (!has) {
        box.textContent = "";
        return;
    }
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.textContent = lastLogs.join("\n");
    if (atBottom) box.scrollTop = box.scrollHeight;
}

let toastTimer = null;
function toast(message) {
    if (!message) return;
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

async function refresh() {
    const state = await api.getState();
    render(state);
}

/* ---------- 事件 ---------- */

$("btnToggle").addEventListener("click", async () => {
    const running = current && (current.status === "running" || current.status === "starting");
    $("btnToggle").disabled = true;
    const res = running ? await api.stop() : await api.start();
    $("btnToggle").disabled = false;
    if (res && res.ok === false && res.message) toast(res.message);
    await refresh();
});

$("btnRestart").addEventListener("click", async () => {
    await api.restart();
    toast("正在重启服务…");
    setTimeout(refresh, 1500);
});

$("tokenText").addEventListener("click", async () => {
    if (!current?.hasToken) return;
    const res = await api.copyToken();
    toast(res.message || (res.ok ? "Token 已复制到剪贴板" : "复制失败"));
});

$("btnCopyEndpoint").addEventListener("click", async () => {
    const res = await api.copyEndpoint();
    toast(res.message || (res.ok ? "已复制" : "复制失败"));
});

$("btnCopyToken").addEventListener("click", async () => {
    const res = await api.copyToken();
    toast(res.message || (res.ok ? "已复制" : "复制失败"));
});

$("btnCopyLink").addEventListener("click", async () => {
    const res = await api.copyLink();
    toast(res.message || (res.ok ? "已复制" : "复制失败"));
});

$("linkText").addEventListener("click", async () => {
    if (!current?.hasToken) return;
    const res = await api.copyLink();
    toast(res.message || "已复制");
});

$("btnOpenCanvas").addEventListener("click", async () => {
    await api.setCanvasUrl($("canvasUrl").value);
    const res = await api.openCanvas();
    if (res && res.message) toast(res.message);
});

$("btnSaveUrl").addEventListener("click", async () => {
    await api.setCanvasUrl($("canvasUrl").value);
    toast("画布地址已保存");
});

$("canvasUrl").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("btnSaveUrl").click();
});

$("btnRevealConfig").addEventListener("click", () => api.revealConfig());

$("btnToggleLogs").addEventListener("click", () => {
    logOpen = !logOpen;
    $("btnToggleLogs").textContent = logOpen ? "收起" : "展开";
    if (logOpen) api.getLogs().then(renderLogs);
    else renderLogs(lastLogs);
});

$("btnClearLogs").addEventListener("click", async () => {
    await api.clearLogs();
    renderLogs([]);
});

$("optAutoStart").addEventListener("change", async (event) => {
    await api.setSettings({ autoStartService: event.target.checked });
});

$("optCloseToTray").addEventListener("change", async (event) => {
    await api.setSettings({ closeToTray: event.target.checked });
});

/* ---------- 订阅 ---------- */

api.onState(render);
api.onLog((lines) => {
    if (logOpen) renderLogs(lines);
});

setInterval(updateUptime, 1000);
refresh().then(() => api.getLogs().then(renderLogs));
