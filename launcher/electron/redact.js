"use strict";

/**
 * 脱敏工具：Token / API Key 一律不出主进程。
 *
 * 设计原则
 * - UI 只接收掩码，明文只留在主进程内存与磁盘；
 * - 日志入库前统一过 redactWith()，避免子进程 stdout 打印凭证；
 * - 匹配规则宁可多打码，也不让 sk- / Bearer / agentToken 漏出去。
 */

const MASK_ELLIPSIS = "…";

/** 前 6 位 + … + 后 4 位；过短直接整体隐藏 */
function maskToken(token) {
    const value = String(token || "");
    if (!value) return "";
    if (value.length <= 12) return MASK_ELLIPSIS;
    return value.slice(0, 6) + MASK_ELLIPSIS + value.slice(-4);
}

/**
 * @param {string} line  原始日志/文本
 * @param {string} knownToken 已知 Token，精确命中时替换成 [REDACTED]
 *
 * 注意与 maskToken 的分工：
 * - maskToken 给 UI 单字段展示用，保留首6尾4 便于用户辨认是哪把 token；
 * - redactWith 给日志落盘/外发用，一律 [REDACTED]，不留任何首尾片段。
 */
function redactWith(line, knownToken) {
    let out = String(line == null ? "" : line);
    const token = String(knownToken || "");
    if (token) out = out.split(token).join("[REDACTED]");

    return out
        // 64 位 hex（canvas-agent 的 Token 形态）
        .replace(/[a-f0-9]{64}/gi, "[REDACTED]")
        // 上游已经打过码的形态：147dde…15a6 / 147dde...15a6 —— 也不许留片段
        .replace(/\b[a-f0-9]{4,8}(?:…|\.{3})[a-f0-9]{4}\b/gi, "[REDACTED]")
        // OpenAI / 各家 sk- 前缀
        .replace(/(sk-)[A-Za-z0-9_-]{8,}/g, "$1[REDACTED]")
        // Authorization: Bearer xxx
        .replace(/(Bearer\s+)[A-Za-z0-9_\-.=]{8,}/gi, "$1[REDACTED]")
        // URL query: agentToken=xxx
        .replace(/(agentToken=)[^&\s"']+/g, "$1[REDACTED]")
        // key/value 形式
        .replace(
            /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd)["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/gi,
            "$1[REDACTED]"
        );
}

/** 已知 Token 时预先绑定，返回可复用的 redact 函数 */
function createRedactor(knownToken) {
    return (line) => redactWith(line, knownToken);
}

module.exports = { maskToken, redactWith, createRedactor, MASK_ELLIPSIS };
