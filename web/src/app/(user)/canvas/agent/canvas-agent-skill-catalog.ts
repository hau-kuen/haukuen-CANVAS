import { isSoulImageModel } from "@/lib/soul-outfit";

export type CanvasAgentSkillSource = "system" | "user";

export type CanvasAgentSkillCatalogInput = {
    id: string;
    source: CanvasAgentSkillSource;
    name: string;
    description?: string;
    content?: string;
    enabled?: boolean;
    hasFiles?: boolean;
};

export type CanvasAgentSkillCatalogItem = {
    id: string;
    source: CanvasAgentSkillSource;
    name: string;
    description: string;
    triggers: string[];
    hasFiles: boolean;
};

export type CanvasAgentLoadedSkill = {
    id: string;
    source: CanvasAgentSkillSource;
    name: string;
    content: string;
    hasFiles?: boolean;
};

export type CanvasAgentSkillLoadResult =
    | { ok: true; skill: CanvasAgentLoadedSkill }
    | { ok: false; code: "skill_selection_locked" | "skill_not_found"; message: string };

const DESCRIPTION_LIMIT = 160;
const TRIGGER_LIMIT = 8;

export const SOUL_SKILL_REQUIRED_MESSAGE = "当前图片模型是 Higgsfield Soul / Soul 2.0。编写提示词或调用 generate_image、edit_image 之前，先 load_skill 加载最匹配的 Soul Skill。这批图片操作未执行。";

export function loadedSkillToolMessage(hasFiles: boolean) {
    return "已加载。本轮创作流程和提示词以该 Skill 为准，优先于内置创作模板。CORE、真实画布和工具结果、自动生成开关、换装 clothingSwap 与 Soul ID 约束仍然有效。"
        + (hasFiles ? "需要附属文件时调用 read_skill_file，skillId 使用本条 id。" : "");
}

export function buildCanvasAgentSkillCatalog(skills: CanvasAgentSkillCatalogInput[]): CanvasAgentSkillCatalogItem[] {
    return skills.flatMap((skill) => {
        const id = skill.id.trim();
        const name = skill.name.trim();
        if (skill.enabled === false || !id || !name || (skill.source !== "system" && skill.source !== "user")) return [];
        return [{
            id,
            source: skill.source,
            name,
            description: clip(skill.description?.trim() || descriptionFromContent(skill.content || "")),
            triggers: triggerWords(skill.content || ""),
            hasFiles: skill.hasFiles === true,
        }];
    });
}

export function formatCanvasAgentSkillCatalog(items: CanvasAgentSkillCatalogItem[]) {
    if (!items.length) return "【可用 Skill 目录】\n当前没有可加载的系统或用户 Skill。";
    const lines = items.map((item) => {
        const files = item.hasFiles ? "；有附属文件" : "";
        const triggers = item.triggers.length ? `；触发：${item.triggers.join("、")}` : "";
        return `- ${item.source} ${item.id}｜${item.name}${files}｜${item.description}${triggers}`;
    });
    return "【可用 Skill 目录】\n只可加载下列 id。目录不含正文，需要时调用 load_skill。\n" + lines.join("\n");
}

export function isSoulSkillName(name: string) {
    return /soul/i.test(name);
}

export function isSoul2CanvasActive(context: {
    generation: { imageModel?: string };
    selectedNodeIds: string[];
    nodes: Array<{ id: string; type: string; model?: string }>;
}) {
    if (isSoulImageModel(context.generation.imageModel || "")) return true;
    const selected = new Set(context.selectedNodeIds);
    return context.nodes.some((node) => selected.has(node.id) && node.type === "image" && isSoulImageModel(node.model || ""));
}

export function buildSoulSkillGuidance(catalog: CanvasAgentSkillCatalogItem[], soulActive: boolean) {
    if (!soulActive) {
        return "用户没有手动选择 Skill。目录中有明确对口的 Skill 时，先调用 load_skill 再写提示词或生成；对不上就用内置流程。用户明确要视频、音频、剧本或其他流程时，加载对应 Skill，不要套用无关的图片 Skill。";
    }
    const hints = catalog.filter((item) => isSoulSkillName(item.name)).map((item) => {
        const hint = soulIntentHint(item.name);
        return hint ? `${hint}：优先「${item.name}」（${item.id}）` : `「${item.name}」（${item.id}）`;
    });
    return [
        "【Soul 2.0 优先】",
        "当前默认图片模型或选中的图片节点是 Higgsfield Soul / Soul 2.0，且用户没有手动选择 Skill。",
        "编写图片提示词或调用 generate_image、edit_image 之前，必须先 load_skill 加载最匹配的一条 Soul Skill。",
        hints.length ? "按用户意图选择：" + hints.join("；") + "。" : "目录中没有名称包含 Soul 的 Skill 时，继续使用内置图片规则里的 Soul 2.0 提示词约束。",
        "用户明确要视频、音频、剧本，或明确点名其他 Skill 时，改加载那个 Skill，不要强行套 Soul。",
        "换装必须 edit_image 且 clothingSwap 为 true，服装图不要交给 Soul image-to-image。模式 B 先确认 Soul ID 已完成，再用 generate_image 的 soulId；模式 A 不要传 soulId。",
        "CORE、真实画布和工具结果、自动生成开关始终有效。",
    ].join("\n");
}

export function imageGenerationNeedsSoulSkill(input: {
    catalog?: CanvasAgentSkillCatalogItem[];
    soulActive: boolean;
    loadedCount: number;
    manual: boolean;
}) {
    if (input.manual || input.loadedCount > 0 || !input.soulActive) return false;
    return Boolean(input.catalog?.some((item) => isSoulSkillName(item.name)));
}

export function resolveCanvasAgentSkillLoad(skills: CanvasAgentSkillCatalogInput[], args: { skillId?: unknown; source?: unknown }, manualSelection: boolean): CanvasAgentSkillLoadResult {
    if (manualSelection) return { ok: false, code: "skill_selection_locked", message: "用户已手动选择 Skill，本轮沿用所选 Skill" };
    const skillId = typeof args.skillId === "string" ? args.skillId.trim() : "";
    const source = args.source === "system" || args.source === "user" ? args.source : "";
    if (!skillId) return { ok: false, code: "skill_not_found", message: "缺少 Skill ID" };
    const matches = skills.filter((skill) => skill.enabled !== false && skill.id === skillId && (!source || skill.source === source) && (skill.source === "system" || skill.source === "user"));
    if (matches.length !== 1) return { ok: false, code: "skill_not_found", message: "Skill 不存在或未启用" };
    const skill = matches[0];
    const name = skill.name.trim();
    const content = (skill.content || "").trim();
    if (!name || !content) return { ok: false, code: "skill_not_found", message: "Skill 不存在或未启用" };
    return { ok: true, skill: { id: skill.id, source: skill.source, name, content, hasFiles: skill.hasFiles === true } };
}

export function rememberLoadedSkill<T extends { id: string; source: CanvasAgentSkillSource }>(active: T[], skill: T) {
    if (active.some((item) => item.id === skill.id && item.source === skill.source)) return active;
    return [...active, skill];
}

export function canReadSystemSkillFile(active: Array<{ id: string; source: string }>, skillId: string) {
    return active.some((item) => item.id === skillId && item.source === "system");
}

export function formatCanvasAgentSkillBodies(skills: Array<{ id: string; source: CanvasAgentSkillSource; name: string; content: string }>) {
    return skills.map((skill, index) => `【完整 Skill ${index + 1}：${skill.name}（${skill.source === "system" ? `系统 Skill ID：${skill.id}` : "用户 Skill"}）】\n${skill.content}`).join("\n\n");
}

export function absorbLoadedCanvasAgentSkills(loaded: CanvasAgentLoadedSkill[], items: Array<{ result: { ok?: boolean; skillId?: unknown; source?: unknown; name?: unknown; content?: unknown; hasFiles?: unknown } }>) {
    const next = [...loaded];
    for (const { result } of items) {
        if (!result.ok || typeof result.skillId !== "string" || typeof result.content !== "string" || !result.content.trim()) continue;
        if (result.source !== "system" && result.source !== "user") continue;
        if (next.some((skill) => skill.id === result.skillId && skill.source === result.source)) continue;
        next.push({
            id: result.skillId,
            source: result.source,
            name: typeof result.name === "string" && result.name.trim() ? result.name.trim() : result.skillId,
            content: result.content,
            hasFiles: result.hasFiles === true,
        });
    }
    return next;
}

function soulIntentHint(name: string) {
    if (/街拍|穿搭/.test(name)) return "街拍、穿搭、换装、lookbook";
    if (/人物/.test(name)) return "人物写真、模特";
    if (/时尚/.test(name)) return "时尚大片";
    if (/电影/.test(name)) return "电影感";
    if (/产品|静物/.test(name)) return "产品静物";
    if (/美食/.test(name)) return "美食";
    return "";
}

function clip(text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    const chars = Array.from(normalized);
    return chars.length > DESCRIPTION_LIMIT ? chars.slice(0, DESCRIPTION_LIMIT).join("") : normalized;
}

function descriptionFromContent(content: string) {
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const line = body.split(/\r?\n/).map((item) => item.trim()).find((item) => item && !item.startsWith("#"));
    return (line || "").replace(/^[-*]\s+/, "");
}

function triggerWords(content: string) {
    const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front) return [];
    const inline = front[1].match(/trigger-words:\s*\[([^\]]*)\]/);
    const words = inline ? inline[1].split(",") : listWords(front[1]);
    return words.map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean).slice(0, TRIGGER_LIMIT);
}

function listWords(block: string) {
    const lines = block.split(/\r?\n/);
    const start = lines.findIndex((line) => /^trigger-words:\s*$/.test(line.trim()));
    if (start < 0) return [];
    const words: string[] = [];
    for (const line of lines.slice(start + 1)) {
        const item = line.match(/^\s+-\s+(.+)$/);
        if (!item) break;
        words.push(item[1]);
    }
    return words;
}
