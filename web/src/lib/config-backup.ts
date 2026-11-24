import type { AiConfig, LocalModelChannel } from "@/stores/use-config-store";
import { modelChannelProtocols } from "./model-channel";

export const CONFIG_BACKUP_KIND = "infinite-canvas-api-config";
export const CONFIG_BACKUP_VERSION = 1;
export const CONFIG_SNAPSHOT_KEY = "infinite-canvas:api-config-snapshots";
export const MAX_CONFIG_SNAPSHOTS = 8;

/** 备份里额外记录"当前选了哪个渠道的哪个模型"，恢复后不用再手动挑一遍。 */
export type ConfigBackupSelection = {
    channelMode: AiConfig["channelMode"];
    imageChannelId: string;
    videoChannelId: string;
    textChannelId: string;
    audioChannelId: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
};

export type ConfigBackupFile = {
    kind: typeof CONFIG_BACKUP_KIND;
    version: number;
    exportedAt: string;
    channels: LocalModelChannel[];
    selection: ConfigBackupSelection;
};

export type ConfigSnapshot = ConfigBackupFile & { id: string; signature: string; savedAt: string };

export function pickSelection(config: AiConfig): ConfigBackupSelection {
    return {
        channelMode: config.channelMode,
        imageChannelId: config.imageChannelId || "",
        videoChannelId: config.videoChannelId || "",
        textChannelId: config.textChannelId || "",
        audioChannelId: config.audioChannelId || "",
        model: config.model || "",
        imageModel: config.imageModel || "",
        videoModel: config.videoModel || "",
        textModel: config.textModel || "",
        audioModel: config.audioModel || "",
    };
}

function slimChannel(channel: LocalModelChannel): LocalModelChannel {
    return {
        id: channel.id,
        protocol: channel.protocol,
        name: channel.name,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        models: Array.isArray(channel.models) ? channel.models : [],
        modelCapabilities: channel.modelCapabilities || {},
        ...(channel.uploadApiKey || channel.bridgeId || channel.comfyUrl || channel.workflowDir || channel.workflowSummaries?.length
            ? {
                  uploadApiKey: channel.uploadApiKey || "",
                  bridgeId: channel.bridgeId || "",
                  comfyUrl: channel.comfyUrl || "",
                  workflowDir: channel.workflowDir || "",
                  workflowSummaries: channel.workflowSummaries || [],
              }
            : {}),
    };
}

export function buildConfigBackup(config: AiConfig): ConfigBackupFile {
    const channels = (Array.isArray(config.localChannels) ? config.localChannels : []).filter((channel) => channel && channel.protocol).map(slimChannel);
    return {
        kind: CONFIG_BACKUP_KIND,
        version: CONFIG_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        channels,
        selection: pickSelection(config),
    };
}

export function backupSignature(backup: Pick<ConfigBackupFile, "channels" | "selection">) {
    return JSON.stringify({
        channels: backup.channels.map((channel) => [channel.id, channel.protocol, channel.name, channel.baseUrl, channel.apiKey, channel.uploadApiKey || "", (channel.models || []).join(",")]),
        selection: backup.selection,
    });
}

export function configBackupFileName(now = new Date(), prefix = "canvas-api-backup") {
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `${prefix}-${stamp}.json`;
}

export function configBackupToText(backup: ConfigBackupFile) {
    return JSON.stringify(backup, null, 2);
}

/** 浏览器里直接存成文件，用户丢桌面/网盘，重装或换机都能拿回来。 */
export function downloadConfigBackup(config: AiConfig) {
    const backup = buildConfigBackup(config);
    const text = configBackupToText(backup);
    const fileName = configBackupFileName();
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { fileName, backup, text };
}

function normalizeBackupBaseUrl(value: unknown) {
    const trimmed = String(value ?? "")
        .trim()
        .replace(/[),;'"]+$/, "")
        .replace(/\/+$/, "");
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(trimmed)) return `http://${trimmed}`;
    return `https://${trimmed}`;
}

function normalizeBackupProtocol(value: unknown): LocalModelChannel["protocol"] {
    const protocol = typeof value === "string" ? value.trim().toLowerCase() : "";
    const matched = modelChannelProtocols.find((item) => item.value === protocol);
    return (matched?.value as LocalModelChannel["protocol"]) ?? "openai";
}

function normalizeBackupChannels(raw: unknown): LocalModelChannel[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item, index) => ({
            id: typeof item.id === "string" && item.id ? item.id : `restored-${index + 1}`,
            protocol: normalizeBackupProtocol(item.protocol),
            name: typeof item.name === "string" ? item.name : `渠道 ${index + 1}`,
            baseUrl: normalizeBackupBaseUrl(item.baseUrl ?? item.base_url),
            apiKey: typeof item.apiKey === "string" ? item.apiKey : typeof item.api_key === "string" ? item.api_key : typeof item.key === "string" ? item.key : "",
            models: Array.isArray(item.models) ? item.models.filter((model): model is string => typeof model === "string") : [],
            modelCapabilities: (item.modelCapabilities as LocalModelChannel["modelCapabilities"]) || {},
            ...(typeof item.uploadApiKey === "string" ? { uploadApiKey: item.uploadApiKey } : {}),
            ...(typeof item.bridgeId === "string" ? { bridgeId: item.bridgeId } : {}),
            ...(typeof item.comfyUrl === "string" ? { comfyUrl: item.comfyUrl } : {}),
            ...(typeof item.workflowDir === "string" ? { workflowDir: item.workflowDir } : {}),
            ...(Array.isArray(item.workflowSummaries) ? { workflowSummaries: item.workflowSummaries as LocalModelChannel["workflowSummaries"] } : {}),
        }))
        .filter((channel) => channel.baseUrl || channel.apiKey || channel.protocol === "comfyui");
}

const DEFAULT_SELECTION: ConfigBackupSelection = {
    channelMode: "local",
    imageChannelId: "",
    videoChannelId: "",
    textChannelId: "",
    audioChannelId: "",
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
};

/** 兼容四种来源：本功能导出的 json、直接黏贴的 zustand persist 内容、裸渠道数组、旧版 { config: {...} }。 */
export function parseConfigBackup(input: string): { ok: true; backup: ConfigBackupFile } | { ok: false; error: string } {
    const text = input.trim();
    if (!text) return { ok: false, error: "内容是空的" };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: "不是合法的 JSON，检查是不是复制完整" };
    }
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "JSON 结构不对" };

    const root = parsed as Record<string, unknown>;
    const state = (root.state && typeof root.state === "object" ? root.state : root) as Record<string, unknown>;
    const config = (state.config && typeof state.config === "object" ? state.config : state) as Record<string, unknown>;

    const rawChannels = root.channels ?? config.localChannels ?? config.channels ?? (Array.isArray(parsed) ? parsed : undefined);
    const channels = normalizeBackupChannels(rawChannels);
    if (!channels.length) return { ok: false, error: "没找到渠道配置，确认文件里含 localChannels / channels" };

    const rawSelection = (root.selection && typeof root.selection === "object" ? root.selection : config) as Record<string, unknown>;
    const pick = (key: keyof ConfigBackupSelection) => (typeof rawSelection[key] === "string" ? (rawSelection[key] as string) : (DEFAULT_SELECTION[key] as string));
    const channelIds = new Set(channels.map((channel) => channel.id));

    return {
        ok: true,
        backup: {
            kind: CONFIG_BACKUP_KIND,
            version: typeof root.version === "number" ? root.version : CONFIG_BACKUP_VERSION,
            exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : new Date().toISOString(),
            channels,
            selection: {
                channelMode: pick("channelMode") === "remote" ? "remote" : "local",
                imageChannelId: channelIds.has(pick("imageChannelId")) ? pick("imageChannelId") : "",
                videoChannelId: channelIds.has(pick("videoChannelId")) ? pick("videoChannelId") : "",
                textChannelId: channelIds.has(pick("textChannelId")) ? pick("textChannelId") : "",
                audioChannelId: channelIds.has(pick("audioChannelId")) ? pick("audioChannelId") : "",
                model: pick("model"),
                imageModel: pick("imageModel"),
                videoModel: pick("videoModel"),
                textModel: pick("textModel"),
                audioModel: pick("audioModel"),
            },
        },
    };
}

export function summarizeConfigBackup(backup: Pick<ConfigBackupFile, "channels">) {
    const keys = backup.channels.filter((channel) => channel.apiKey.trim()).length;
    const models = backup.channels.reduce((total, channel) => total + (channel.models?.length || 0), 0);
    return { channels: backup.channels.length, keys, models };
}

function readSnapshotRaw(): ConfigSnapshot[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = JSON.parse(window.localStorage.getItem(CONFIG_SNAPSHOT_KEY) || "[]");
        return Array.isArray(raw) ? (raw as ConfigSnapshot[]).filter((item) => item && Array.isArray(item.channels)) : [];
    } catch {
        return [];
    }
}

export function readConfigSnapshots(): ConfigSnapshot[] {
    // 存储顺序就是“新的在前”，不再按时间重排：同一毫秒内多次保存会被重排打乱
    return readSnapshotRaw();
}

/** 每次渠道/Key/选择变化都留一份，最多 8 份，内容相同的只刷新时间不重复占用。 */
export function saveConfigSnapshot(config: AiConfig) {
    if (typeof window === "undefined") return null;
    const backup = buildConfigBackup(config);
    if (!backup.channels.length) return null;
    const signature = backupSignature(backup);
    const existing = readSnapshotRaw();
    const same = existing.find((item) => item.signature === signature);
    const head: ConfigSnapshot = {
        ...backup,
        id: same?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        signature,
        savedAt: backup.exportedAt,
    };
    const next = [head, ...existing.filter((item) => item.signature !== signature)].slice(0, MAX_CONFIG_SNAPSHOTS);
    try {
        window.localStorage.setItem(CONFIG_SNAPSHOT_KEY, JSON.stringify(next));
    } catch {
        return null;
    }
    return head;
}

export function removeConfigSnapshot(id: string) {
    if (typeof window === "undefined") return;
    const next = readSnapshotRaw().filter((item) => item.id !== id);
    window.localStorage.setItem(CONFIG_SNAPSHOT_KEY, JSON.stringify(next));
}

export function latestConfigSnapshot() {
    return readConfigSnapshots()[0] || null;
}

export function formatSnapshotTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (input: number) => String(input).padStart(2, "0");
    return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
