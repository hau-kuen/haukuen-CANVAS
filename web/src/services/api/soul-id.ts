import { higgsfieldChannel } from "@/lib/soul-outfit";
import { channelIdForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export type SoulReference = {
    id: string;
    name: string;
    modelVersion: string;
    status: string;
    thumbnailUrl?: string;
    createdAt?: string;
    inProgressAt?: string;
    failReason?: string;
    warning?: string;
};

export type SoulReferencePage = {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    items: SoulReference[];
};

export function soulStatusLabel(status: string) {
    switch (status) {
        case "completed":
            return "可用";
        case "failed":
            return "失败";
        case "in_progress":
            return "训练中";
        case "queued":
            return "排队中";
        case "not_ready":
            return "未就绪";
        default:
            return status || "未知";
    }
}

export async function listSoulIds(config: AiConfig, page = 1, pageSize = 20) {
    const payload = await soulRequest<SoulReferencePage>(config, "GET", `/api/v1/higgsfield/soul-ids?page=${page}&pageSize=${pageSize}`);
    return { ...payload, items: payload.items || [] };
}

export async function getSoulId(config: AiConfig, id: string) {
    return soulRequest<SoulReference>(config, "GET", `/api/v1/higgsfield/soul-ids/${encodeURIComponent(id)}`);
}

export async function createSoulId(config: AiConfig, input: { name: string; authorized: boolean; imageUrls: string[] }) {
    return soulRequest<SoulReference>(config, "POST", "/api/v1/higgsfield/soul-ids", input);
}

async function soulRequest<T>(config: AiConfig, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const channel = higgsfieldChannel({ ...config, imageChannelId: config.imageChannelId || channelIdForActiveModel(config) });
    if (!channel?.id) throw new Error("请先配置 Higgsfield 渠道");
    const token = useUserStore.getState().token;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    headers[config.channelMode === "remote" ? "X-Model-Channel-ID" : "X-User-Model-Channel-ID"] = channel.id;
    const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string; data?: T } | null;
    if (!payload || payload.code !== 0 || payload.data === undefined || payload.data === null) {
        throw new Error(payload?.msg || "Soul ID 请求失败");
    }
    return payload.data;
}
