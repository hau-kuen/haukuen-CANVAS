import { isWorkflowProtocol } from "@/lib/model-channel";
import { normalizeLocalChannels, type AiConfig } from "@/stores/use-config-store";

export const CLOTHING_SWAP_INSTRUCTION = "Only replace the clothing with the garment reference. Keep the person, hair, pose, camera, scene, and lighting unchanged.";

export function isSoulImageModel(model: string) {
    const name = model.toLowerCase();
    return name.includes("soul") || name.includes("higgsfield");
}

export function isClothingEditModel(model: string) {
    const name = model.toLowerCase();
    if (!name || name.includes("video") || isSoulImageModel(name)) return false;
    if (name.includes("text-to-image") && !name.includes("image-to-image") && !name.includes("edit")) return false;
    return name.includes("gpt-image") || name.includes("image-edit") || name.includes("image-to-image") || name.includes("/edit") || name.includes("nano-banana") || (name.includes("seedream") && name.includes("edit"));
}

export function findClothingEditTarget(config: AiConfig) {
    const channels = config.channelMode === "remote" ? config.publicChannels : normalizeLocalChannels(config);
    const options = channels.filter((channel) => !isWorkflowProtocol(channel.protocol || "")).flatMap((channel) =>
        (channel.models || []).filter(isClothingEditModel).map((model) => ({ model, channelId: channel.id || "" })),
    );
    options.sort((a, b) => clothingEditRank(a.model) - clothingEditRank(b.model));
    return options[0] || null;
}

export function prepareOutfitImageRequest(config: AiConfig, prompt: string) {
    if (!config.clothingSwap) return { config, prompt };
    let next: AiConfig = { ...config, clothingSwap: false };
    if (isSoulImageModel(config.model)) {
        const target = findClothingEditTarget(config);
        if (!target) throw new Error("换装需要已配置的图片编辑模型（例如 GPT Image），不能提交到 Soul image-to-image");
        next = { ...next, model: target.model, imageChannelId: target.channelId, activeChannelId: target.channelId, soulId: "", soulStrength: "" };
    }
    const text = prompt.includes("Keep the person, hair, pose, camera, scene, and lighting unchanged") ? prompt : `${prompt.trim()}\n${CLOTHING_SWAP_INSTRUCTION}`;
    return { config: next, prompt: text };
}

export function soulReferenceFields(config: AiConfig): Record<string, string | number> {
    if (config.clothingSwap || !isSoulImageModel(config.model)) return {};
    const id = (config.soulId || "").trim();
    if (!id) return {};
    const raw = config.soulStrength;
    if (raw == null) return { custom_reference_id: id, custom_reference_strength: 1 };
    const text = String(raw).trim();
    if (!text) throw new Error("Soul ID 强度必须大于 0 且不超过 1");
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) throw new Error("Soul ID 强度必须大于 0 且不超过 1");
    return { custom_reference_id: id, custom_reference_strength: parsed };
}

export function higgsfieldChannel(config: AiConfig) {
    const channels = config.channelMode === "remote" ? config.publicChannels : normalizeLocalChannels(config);
    const preferred = channels.find((channel) => channel.id === config.imageChannelId && (channel.protocol === "higgsfield" || (channel.models || []).some(isSoulImageModel)));
    return preferred || channels.find((channel) => channel.protocol === "higgsfield" || (channel.models || []).some(isSoulImageModel)) || null;
}

function clothingEditRank(model: string) {
    const name = model.toLowerCase();
    if (name.includes("gpt-image") && !(name.includes("text-to-image") && !name.includes("image-to-image") && !name.includes("edit"))) return 0;
    if (name.includes("gpt-image")) return 1;
    if (name.includes("image-edit") || name.includes("/edit") || name.includes("image-to-image")) return 2;
    return 3;
}
