import { modelChannelDefaultBaseUrls, type ModelChannelProtocol } from "./model-channel";

export type QuickChannelDraft = {
    protocol: ModelChannelProtocol;
    name: string;
    baseUrl: string;
    apiKey: string;
    presetId?: string;
};

export type ChannelPreset = {
    id: string;
    label: string;
    protocol: ModelChannelProtocol;
    baseUrl: string;
    keyUrl?: string;
    hint?: string;
    group: "常用" | "聚合 / 中转" | "官方 / 直连" | "本地 / 工作流";
};

/** 比协议更细一层的服务商预设：同一协议下固定了 baseUrl，点一下就填好。 */
export const channelPresets: ChannelPreset[] = [
    { id: "grsai", label: "grsai", protocol: "openai", baseUrl: "https://api.grsai.ai/v1", hint: "nano-banana 系列 / OpenAI 兼容", group: "常用" },
    { id: "deepseek", label: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", hint: "文本模型", group: "常用" },
    { id: "siliconflow", label: "硅基流动", protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", keyUrl: "https://cloud.siliconflow.cn/account/ak", hint: "文本 / 生图 / 视频", group: "常用" },
    { id: "openrouter", label: "OpenRouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", hint: "多模型聚合", group: "常用" },
    { id: "kie", label: "KIE", protocol: "kie", baseUrl: modelChannelDefaultBaseUrls.kie, keyUrl: "https://kie.ai/api-key", hint: "生图 / 视频", group: "常用" },
    { id: "apimart", label: "APIMart", protocol: "apimart", baseUrl: modelChannelDefaultBaseUrls.apimart, keyUrl: "https://apimart.ai/register", group: "聚合 / 中转" },
    { id: "88api", label: "88API", protocol: "88api", baseUrl: modelChannelDefaultBaseUrls["88api"], keyUrl: "https://88api.ai/sign-up", group: "聚合 / 中转" },
    { id: "tokendance", label: "TokenDance", protocol: "tokendance", baseUrl: modelChannelDefaultBaseUrls.tokendance, hint: "支持账号登录，不用手填 Key", group: "聚合 / 中转" },
    { id: "grsaivideo", label: "grsai 视频", protocol: "grsaivideo", baseUrl: modelChannelDefaultBaseUrls.grsaivideo, hint: "wan / minimax 视频", group: "聚合 / 中转" },
    { id: "openai", label: "OpenAI", protocol: "openai", baseUrl: modelChannelDefaultBaseUrls.openai, keyUrl: "https://platform.openai.com/api-keys", group: "官方 / 直连" },
    { id: "gemini", label: "Gemini", protocol: "gemini", baseUrl: modelChannelDefaultBaseUrls.gemini, keyUrl: "https://aistudio.google.com/apikey", group: "官方 / 直连" },
    { id: "ark", label: "火山方舟", protocol: "ark", baseUrl: modelChannelDefaultBaseUrls.ark, keyUrl: "https://console.volcengine.com/ark", hint: "豆包 / 即梦", group: "官方 / 直连" },
    { id: "minimax", label: "MiniMax", protocol: "minimax", baseUrl: modelChannelDefaultBaseUrls.minimax, keyUrl: "https://metaso.cn/minimax-h3/", group: "官方 / 直连" },
    { id: "higgsfield", label: "Higgsfield", protocol: "higgsfield", baseUrl: modelChannelDefaultBaseUrls.higgsfield, keyUrl: "https://console.higgsfield.ai", hint: "Soul ID / 视频", group: "官方 / 直连" },
    { id: "mimo", label: "MiMo", protocol: "mimo", baseUrl: modelChannelDefaultBaseUrls.mimo, keyUrl: "https://platform.xiaomimimo.com/", group: "官方 / 直连" },
    { id: "comfyui", label: "ComfyUI（本地）", protocol: "comfyui", baseUrl: "", hint: "地址在「选择」里配置，如 127.0.0.1:8188", group: "本地 / 工作流" },
    { id: "runninghub", label: "RunningHub", protocol: "runninghub", baseUrl: modelChannelDefaultBaseUrls.runninghub, hint: "云端工作流", group: "本地 / 工作流" },
    { id: "autodl", label: "AutoDL", protocol: "autodl", baseUrl: modelChannelDefaultBaseUrls.autodl, group: "本地 / 工作流" },
];

const hostAliases: Record<string, string> = {
    "api.grsai.ai": "grsai",
    "grsai.ai": "grsai",
    "api.deepseek.com": "deepseek",
    "api.siliconflow.cn": "siliconflow",
    "openrouter.ai": "openrouter",
    "api.anthropic.com": "openai",
    "api.moonshot.cn": "openai",
    "dashscope.aliyuncs.com": "openai",
    "api.minimax.chat": "minimax",
    "metaso.cn": "minimax",
    "api.xiaomimimo.com": "mimo",
    "api.higgsfield.ai": "higgsfield",
    "api.kie.ai": "kie",
    "api.apimart.ai": "apimart",
    "88api.ai": "88api",
    "tokendance.space": "tokendance",
    "ark.cn-beijing.volces.com": "ark",
    "www.runninghub.cn": "runninghub",
    "runninghub.cn": "runninghub",
    "autodl.art": "autodl",
    "127.0.0.1:8188": "comfyui",
    "localhost:8188": "comfyui",
};

export function hostOf(input: string) {
    const value = input.trim();
    if (!value) return "";
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
        return url.host.toLowerCase();
    } catch {
        return "";
    }
}

export function normalizeBaseUrl(input: string) {
    const value = input.trim().replace(/[),;'"]+$/, "");
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, "");
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)/i.test(value);
    return (isLocal ? "http://" : "https://") + value.replace(/\/+$/, "");
}

const BARE_HOST_PATTERN = /(?<![a-z0-9./-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s,|"'）)\u0000]*)?/gi;
const LOCAL_HOST_PATTERN = /(?<![a-z0-9./-])(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})(?:\/[^\s,|"'）)\u0000]*)?/gi;

/** 给裸域名补上协议，避免用户还得自己写 https:// */
function prepareQuickText(text: string) {
    const found: string[] = [];
    const masked = text.replace(URL_PATTERN, (match) => {
        found.push(match);
        return `\u0000U${found.length - 1}\u0000`;
    });
    const filled = masked.replace(LOCAL_HOST_PATTERN, (match) => `http://${match}`).replace(BARE_HOST_PATTERN, (match) => `https://${match}`);
    return filled.replace(/\u0000U(\d+)\u0000/g, (_match, index: string) => found[Number(index)]);
}

export function presetForBaseUrl(baseUrl: string): ChannelPreset | undefined {
    const host = hostOf(baseUrl);
    if (!host) return undefined;
    const aliasId = hostAliases[host];
    if (aliasId) return channelPresets.find((preset) => preset.id === aliasId);
    return channelPresets.find((preset) => {
        const presetHost = hostOf(preset.baseUrl);
        return presetHost && (presetHost === host || host.endsWith("." + presetHost) || presetHost.endsWith("." + host));
    });
}

function draftFrom(baseUrl: string, apiKey: string, name?: string): QuickChannelDraft {
    const preset = presetForBaseUrl(baseUrl);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    return {
        protocol: preset?.protocol || "openai",
        presetId: preset?.id,
        name: name?.trim() || preset?.label || (hostOf(normalizedBaseUrl) || "新渠道"),
        baseUrl: normalizedBaseUrl,
        apiKey: apiKey.trim(),
    };
}

export function draftFromPreset(preset: ChannelPreset, apiKey = ""): QuickChannelDraft {
    return {
        protocol: preset.protocol,
        presetId: preset.id,
        name: preset.label,
        baseUrl: preset.baseUrl,
        apiKey,
    };
}

export type QuickParseResult = {
    drafts: QuickChannelDraft[];
    warnings: string[];
    /** 有 URL 没 Key 的条目，需要用户补 Key */
    missingKeys: number;
};

const URL_PATTERN = /https?:\/\/[^\s,|"'<>）)]+/gi;

function collectKeys(text: string) {
    const found: string[] = [];
    const push = (value: string) => {
        const key = value.replace(/^["'`]|["'`]$/g, "");
        if (key && !found.includes(key)) found.push(key);
    };
    for (const match of text.matchAll(/sk-[A-Za-z0-9_-]{6,}/g)) push(match[0]);
    for (const match of text.matchAll(/(?:api[_-]?key|apikey|access[_-]?key|token|key)\s*[:=]\s*["'`]?([A-Za-z0-9_.-]{12,})["'`]?/gi)) push(match[1]);
    for (const match of text.matchAll(/[A-Za-z0-9_-]{32,}/g)) push(match[0]);
    return found;
}

/** 支持：URL|KEY、url,key、两行分写、export KEY=xx + BASE_URL=xx、以及 JSON。 */
export function parseQuickChannelText(input: string): QuickParseResult {
    const warnings: string[] = [];
    const text = input.trim();
    if (!text) return { drafts: [], warnings: ["还没有内容"], missingKeys: 0 };

    if (text.startsWith("{") || text.startsWith("[")) {
        try {
            const data = JSON.parse(text) as unknown;
            const list = Array.isArray(data) ? data : [data];
            const drafts: QuickChannelDraft[] = [];
            for (const item of list) {
                if (!item || typeof item !== "object") continue;
                const record = item as Record<string, unknown>;
                const baseUrl = String(record.baseUrl ?? record.base_url ?? record.url ?? record.endpoint ?? record.host ?? "").trim();
                const apiKey = String(record.apiKey ?? record.api_key ?? record.apikey ?? record.key ?? record.token ?? "").trim();
                const name = String(record.name ?? record.label ?? "").trim();
                if (!baseUrl && !apiKey) continue;
                drafts.push(draftFrom(baseUrl, apiKey, name));
            }
            if (!drafts.length) warnings.push("JSON 里没找到 baseUrl / apiKey 字段");
            return { drafts, warnings, missingKeys: drafts.filter((draft) => !draft.apiKey).length };
        } catch {
            warnings.push("看起来像 JSON 但解析失败，已改按文本解析");
        }
    }

    const prepared = prepareQuickText(text);
    const urls = Array.from(prepared.matchAll(URL_PATTERN), (match) => normalizeBaseUrl(match[0]));
    const keys = collectKeys(prepared.replace(URL_PATTERN, " "));
    const uniqueUrls = Array.from(new Set(urls));

    if (!uniqueUrls.length && !keys.length) {
        return { drafts: [], warnings: ["没识别到地址或 Key，试试 https://api.xxx.com/v1|sk-xxx"], missingKeys: 0 };
    }
    if (!uniqueUrls.length) {
        return { drafts: [], warnings: ["只识别到 Key，缺少 Base URL —— 请在下方协议里选一家，或补上地址"], missingKeys: keys.length };
    }

    const drafts = uniqueUrls.map((url, index) => draftFrom(url, keys[index] || ""));
    const missingKeys = drafts.filter((draft) => !draft.apiKey).length;
    if (missingKeys) warnings.push(`${missingKeys} 个服务商还缺 API Key，可以添加后再补`);
    if (keys.length > uniqueUrls.length) warnings.push(`有 ${keys.length - uniqueUrls.length} 个 Key 没配上地址，已忽略`);
    return { drafts, warnings, missingKeys };
}

export function maskKey(key: string) {
    const value = key.trim();
    if (!value) return "未填写";
    if (value.length <= 8) return "••••";
    return value.slice(0, 4) + "••••" + value.slice(-4);
}
