#!/usr/bin/env node
/**
 * 脱敏验收：证明 UI / 日志 / 打包产物都拿不到凭证。
 *
 *   npm run verify
 *
 * 只做静态与纯函数断言，不需要 Electron 运行时，可在 CI 里跑。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const L = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(L, p), "utf8");

const { maskToken, redactWith, createRedactor } = require(path.join(L, "electron/redact.js"));

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
    if (cond) {
        pass++;
        console.log("PASS " + name);
    } else {
        fail++;
        console.log("FAIL " + name + (detail ? "  << " + detail : ""));
    }
}

const main = read("electron/main.js");
const app = read("ui/app.js");
const preload = read("electron/preload.js");
const redactSrc = read("electron/redact.js");
const pkg = JSON.parse(read("package.json"));

const TOKEN = "a1b2c3" + "b".repeat(54) + "d4e5"; // 6+54+4 = 64，与真实 token 长度一致

/* ---------- 掩码 ---------- */
ok("mask 空值返回空", maskToken("") === "");
ok("mask 短值不泄漏", !maskToken("abc123").includes("abc123"));
ok("mask 长值保留首6尾4", maskToken(TOKEN) === "a1b2c3…d4e5");
ok("mask 结果不含原文", !maskToken("f".repeat(64)).includes("f".repeat(20)));

/* ---------- 打码 ---------- */
const redactCases = [
    ["64位hex", "token=" + TOKEN, "token=[REDACTED]", TOKEN],
    ["上游已打码形态", "Connect token: a1b2c3…d4e5", "Connect token: [REDACTED]", "a1b2c3"],
    ["上游三点打码形态", "token: 147dde...15a6", "[REDACTED]", "147dde"],
    ["sk- key", "key sk-proj-abcdefghijklmnop1234", "[REDACTED]", "abcdefghijklmnop"],
    ["Bearer", "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abc", "Bearer [REDACTED]", "eyJhbGciOiJIUzI1NiJ9"],
    ["agentToken", "http://x/#agentToken=" + TOKEN, "agentToken=[REDACTED]", TOKEN],
    ["apiKey json", '{"apiKey":"secret-value-1234"}', "[REDACTED]", "secret-value-1234"],
    ["password", "password=hunter2hunter2", "[REDACTED]", "hunter2hunter2"],
];
for (const [name, input, want, gone] of redactCases) {
    const out = redactWith(input, TOKEN);
    ok("redact " + name, out.includes(want) && !out.includes(gone), "got: " + out);
}

/* ---------- 正常日志不误伤 ---------- */
for (const line of [
    "server listening on http://127.0.0.1:3210",
    "PID 25980 uptime 12s",
    "launcher v0.1.6 ready",
    "[canvas-agent] 已绑定会话 clientId=abc-123",
]) {
    ok("no false positive: " + line.slice(0, 28), redactWith(line, TOKEN) === line, redactWith(line, TOKEN));
}

ok(
    "createRedactor 掩码已知 token",
    (() => {
        const out = createRedactor(TOKEN)("raw " + TOKEN);
        return !out.includes(TOKEN) && out.includes("[REDACTED]") && !out.includes("a1b2c3");
    })()
);

/* ---------- 状态不回传明文 ---------- */
const stateFn = main.slice(main.indexOf("function publicState"), main.indexOf("function publicState") + 1400);
ok("publicState 无 token 明文字段", !/^\s*token:\s*token/m.test(stateFn) && !/token:\s*cfg\?\.token/.test(stateFn));
ok("publicState 无 link 明文字段", !/\blink:\s*buildLink/.test(stateFn));
ok("publicState 有 tokenMasked", /tokenMasked/.test(stateFn));
ok("publicState 有 linkMasked", /linkMasked/.test(stateFn));
ok("pushLog 入队前打码", /redact\(String\(line\)\)|redact\(line\)/.test(main));

/* ---------- UI 不碰明文 ---------- */
ok("app.js 无 state.token", !/state\.token\b/.test(app));
ok("app.js 无 state.link", !/state\.link\b/.test(app));
ok("app.js 无 tokenVisible 开关", !/tokenVisible/.test(app));
ok("app.js 用 tokenMasked", /state\.tokenMasked/.test(app));
ok("app.js 复制走 IPC", /copyToken\(\)/.test(app));

/* ---------- 复制链路闭合 ---------- */
ok("preload 暴露 copyToken", /copyToken:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("token:copy"\)/.test(preload));
ok("preload 暴露 copyLink", /copyLink:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("link:copy"\)/.test(preload));
ok("main 处理 token:copy", /ipcMain\.handle\("token:copy"/.test(main));
ok("token:copy 写剪贴板", /clipboard\.writeText\(cfg\.token\)/.test(main));

/* ---------- 打包过滤 ---------- */
const filter = pkg.build.extraResources[0].filter || [];
const needed = [
    "!**/.env", "!**/.env.*", "!**/*.pem", "!**/*.key", "!**/*.p12",
    "!**/*.db", "!**/*.sqlite*", "!**/*credential*", "!**/*secret*",
    "!**/codex-agent.json", "!**/*.ldb", "!data/**",
];
for (const pat of needed) ok("filter " + pat, filter.includes(pat), JSON.stringify(filter));

/* ---------- 默认安装目录不能只认 D 盘 ---------- */
// 硬编码 D:\AI\Canvas Agent 时，没有 D 盘的机器会拿到非法默认路径，
// 一路「下一步」就装到不存在的盘 —— 表现为「装不上 / 装完不启动」。
const nsh = read("build/installer.nsh");
ok("安装目录有非 D 盘回落", nsh.includes("LOCALAPPDATA\\Programs\\Canvas Agent"), "缺回落路径");
ok("安装目录先探测 D 盘存在", nsh.includes("IfFileExists") && nsh.includes("D:\\*.*"));
ok("写注册表用变量而非硬编码盘符", !/InstallLocation\s+"D:/.test(nsh));

/* ---------- 源码无硬编码凭证 ---------- */
ok("redact.js 无 sk- 硬编码", !/sk-[A-Za-z0-9]{20,}/.test(redactSrc));
ok("launcher 源码无 64hex 明文", !/\b[a-f0-9]{64}\b/i.test(main + app + preload));

/* ---------- 升级备份也不留明文 ---------- */
const backupFn = main.slice(main.indexOf("function ensureUpgradeBackup"), main.indexOf("function ensureUpgradeBackup") + 2000);
ok("备份不再 copyFileSync 直拷凭据", !/copyFileSync\(src/.test(backupFn), "仍在使用 copyFileSync");
ok("备份把 token 置为 [REDACTED]", /obj\.token\s*=\s*"\[REDACTED\]"/.test(backupFn));
ok("备份解析失败走 redact", /body\s*=\s*redact\(raw\)/.test(backupFn));
ok("备份说明原配置不被覆盖", /升级不覆盖/.test(backupFn));

/* ---------- 版本可见 ---------- */
ok("托盘 tooltip 带版本号", /setToolTip\(`Canvas Agent v\$\{app\.getVersion\(\)\}/.test(main));
ok("托盘菜单首行显示版本", /label: `Canvas Agent v\$\{app\.getVersion\(\)\}`/.test(main));

/* ---------- 存活探针不能把 401 当死亡 ---------- */
const probeFn = main.slice(main.indexOf("function probeHealth"), main.indexOf("function startHealthCheck"));
ok("探针不再只认 200", !/ok:\s*res\.statusCode === 200/.test(probeFn), "又退回了只认 200");
ok("探针把 401 也算存活", /statusCode < 500/.test(probeFn));
ok("探针应答非 JSON 不算死亡", /非 JSON 也说明端口通了/.test(probeFn));

/* ---------- 故障可取证 ---------- */
ok("日志落盘", /function appendLogFile/.test(main) && /appendFileSync\(file/.test(main));
ok("日志有体积上限轮转", /renameSync\(file, file \+ "\.1"\)/.test(main));
ok("日志路径暴露给界面", /logPath:\s*logFile\(\)/.test(main));
ok("端口占用翻译成人话", /EADDRINUSE/.test(main) && /已被其他程序占用/.test(main));
ok("启动记录环境快照", /electron \$\{process\.versions\.electron\}/.test(main));

/* ---------- 版本号一致 ---------- */
const lock = JSON.parse(read("package-lock.json"));
ok(
    "package.json 与 lock 版本一致 (" + pkg.version + ")",
    pkg.version === lock.version && pkg.version === lock.packages[""].version,
    "lock=" + lock.version + " root=" + lock.packages[""].version
);

console.log("\nRESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail === 0 ? 0 : 1);
