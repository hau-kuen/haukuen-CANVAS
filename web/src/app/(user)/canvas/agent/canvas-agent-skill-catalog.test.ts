import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType } from "../types";
import type { CanvasAgentContext } from "./canvas-agent-context";
import { buildCanvasAgentSkillPrompt } from "./canvas-agent-skills";
import {
    absorbLoadedCanvasAgentSkills,
    buildCanvasAgentSkillCatalog,
    buildSoulSkillGuidance,
    canReadSystemSkillFile,
    formatCanvasAgentSkillBodies,
    formatCanvasAgentSkillCatalog,
    imageGenerationNeedsSoulSkill,
    isSoul2CanvasActive,
    rememberLoadedSkill,
    resolveCanvasAgentSkillLoad,
    type CanvasAgentSkillCatalogInput,
} from "./canvas-agent-skill-catalog";
import { canvasAgentActionLabel, canvasAgentTurnTools, normalizeCanvasAgentAction } from "./canvas-agent-tools";

const streetBody = "UNIQUE_STREET_BODY 只换服装。";
const skills: CanvasAgentSkillCatalogInput[] = [
    {
        id: "soul-street",
        source: "system",
        name: "Soul 2.0 街拍穿搭",
        description: "街拍穿搭流水线",
        enabled: true,
        hasFiles: true,
        content: "---\nname: Soul 2.0 街拍穿搭\ndescription: 街拍穿搭流水线\nmetadata:\n  trigger-words: [街拍, 穿搭, 换装]\n---\n# Soul 2.0 街拍穿搭\n" + streetBody,
    },
    { id: "soul-portrait", source: "system", name: "Soul人物摄影", description: "人物写真", enabled: true, content: "人物八层提示词 UNIQUE_PORTRAIT_BODY" },
    { id: "soul-fashion", source: "system", name: "Soul时尚大片摄影", description: "时尚大片", enabled: true, content: "时尚 UNIQUE_FASHION_BODY" },
    { id: "soul-cinema", source: "system", name: "Soul电影感摄影", description: "电影感", enabled: true, content: "电影 UNIQUE_CINEMA_BODY" },
    { id: "soul-product", source: "system", name: "Soul产品静物摄影", description: "产品静物", enabled: true, content: "产品 UNIQUE_PRODUCT_BODY" },
    { id: "soul-food", source: "system", name: "Soul美食摄影", description: "美食", enabled: true, content: "美食 UNIQUE_FOOD_BODY" },
    { id: "user-1", source: "user", name: "我的分镜", description: "", enabled: true, content: "---\nname: 我的分镜\nmetadata:\n  trigger-words:\n    - 分镜表\n---\n按我的分镜表写。\nUNIQUE_USER_BODY" },
    { id: "off", source: "system", name: "停用 Skill", description: "不要出现", enabled: false, content: "DISABLED_BODY" },
    { id: "video-1", source: "system", name: "宣传片", description: "做视频", enabled: true, content: "视频流程 UNIQUE_VIDEO_BODY" },
];

function context(imageModel: string, nodes: CanvasAgentContext["nodes"] = [], selectedNodeIds: string[] = []): CanvasAgentContext {
    return {
        project: { id: "p", title: "画布", nodeCount: nodes.length, connectionCount: 0 },
        agentState: { phase: "intake", approvedNodeIds: [], referenceNodeIds: [], pendingTaskIds: [], completedTaskIds: [] },
        selectedNodeIds,
        nodes,
        connections: [],
        generation: {
            autoGenerateMedia: false,
            textModel: "text",
            imageModel,
            videoModel: "video",
            audioModel: "audio",
            imageQuality: "high",
            imageSize: "1024x1024",
            videoQuality: "high",
            videoSize: "1280x720",
            imageCount: "1",
            videoSeconds: "5",
            videoGenerateAudio: "false",
            audioVoice: "",
            audioLanguage: "",
            audioFormat: "",
            audioSpeed: "",
        },
        tasks: [],
    };
}

test("skill catalog keeps id, source, description and triggers, and omits skill bodies", () => {
    const catalog = buildCanvasAgentSkillCatalog(skills);
    const text = formatCanvasAgentSkillCatalog(catalog);
    assert.equal(catalog.some((item) => item.id === "off"), false);
    const street = catalog.find((item) => item.id === "soul-street");
    const user = catalog.find((item) => item.id === "user-1");
    assert.equal(street?.source, "system");
    assert.equal(street?.hasFiles, true);
    assert.deepEqual(street?.triggers, ["街拍", "穿搭", "换装"]);
    assert.equal(street?.description, "街拍穿搭流水线");
    assert.deepEqual(user?.triggers, ["分镜表"]);
    assert.match(user?.description || "", /按我的分镜表/);
    assert.match(text, /system soul-street｜Soul 2\.0 街拍穿搭；有附属文件/);
    assert.match(text, /user user-1｜我的分镜/);
    assert.equal(text.includes(streetBody), false);
    assert.equal(text.includes("UNIQUE_USER_BODY"), false);
    assert.equal(text.includes("DISABLED_BODY"), false);
});

test("Soul 2.0 is active for the default image model or a selected image node", () => {
    assert.equal(isSoul2CanvasActive(context("higgsfield-ai/soul/v2/standard")), true);
    assert.equal(isSoul2CanvasActive(context("nano-banana-2", [
        { id: "img", type: CanvasNodeType.Image, title: "肖像", model: "higgsfield-ai/soul/v2/standard" },
    ], ["img"])), true);
    assert.equal(isSoul2CanvasActive(context("nano-banana-2", [
        { id: "img", type: CanvasNodeType.Image, title: "肖像", model: "higgsfield-ai/soul/v2/standard" },
    ])), false);
    assert.equal(isSoul2CanvasActive(context("nano-banana-2", [
        { id: "vid", type: CanvasNodeType.Video, title: "片段", model: "higgsfield-ai/soul/v2/standard" },
    ], ["vid"])), false);
});

test("Soul 2.0 guidance asks for the matching Soul skill before image prompts and still allows other work", () => {
    const catalog = buildCanvasAgentSkillCatalog(skills);
    const guidance = buildSoulSkillGuidance(catalog, true);
    assert.match(guidance, /【Soul 2\.0 优先】/);
    assert.match(guidance, /Soul 2\.0 街拍穿搭/);
    assert.match(guidance, /Soul人物摄影/);
    assert.match(guidance, /Soul时尚大片摄影/);
    assert.match(guidance, /Soul电影感摄影/);
    assert.match(guidance, /Soul产品静物摄影/);
    assert.match(guidance, /Soul美食摄影/);
    assert.match(guidance, /generate_image/);
    assert.match(guidance, /clothingSwap/);
    assert.match(guidance, /视频、音频/);
    assert.equal(guidance.includes(streetBody), false);
    const prompt = buildCanvasAgentSkillPrompt("intake", "帮我拍一组街拍", context("higgsfield-ai/soul/v2/standard"), undefined, undefined, false, false, {
        catalog: formatCanvasAgentSkillCatalog(catalog),
        guidance,
    });
    assert.equal(prompt.includes("可用 Skill 目录"), true);
    assert.equal(prompt.includes("【Soul 2.0 优先】"), true);
    assert.equal(prompt.includes("autoGenerateMedia"), true);
    assert.equal(prompt.includes("Hybrid"), true);
    assert.equal(imageGenerationNeedsSoulSkill({ catalog, soulActive: true, loadedCount: 0, manual: false }), true);
    assert.equal(imageGenerationNeedsSoulSkill({ catalog, soulActive: true, loadedCount: 1, manual: false }), false);
    assert.equal(imageGenerationNeedsSoulSkill({ catalog, soulActive: true, loadedCount: 0, manual: true }), false);
    assert.equal(imageGenerationNeedsSoulSkill({ catalog, soulActive: false, loadedCount: 0, manual: false }), false);
});

test("non-Soul turns can load a matching skill without Soul priority", () => {
    const catalog = buildCanvasAgentSkillCatalog(skills);
    const guidance = buildSoulSkillGuidance(catalog, false);
    assert.equal(guidance.includes("【Soul 2.0 优先】"), false);
    assert.match(guidance, /load_skill/);
    assert.match(guidance, /视频、音频/);
});

test("load_skill resolves system and user skills and rejects missing or locked ids", () => {
    assert.equal(resolveCanvasAgentSkillLoad(skills, { skillId: "soul-street", source: "system" }, false).ok, true);
    const user = resolveCanvasAgentSkillLoad(skills, { skillId: "user-1" }, false);
    assert.equal(user.ok && user.skill.source, "user");
    assert.equal(user.ok && user.skill.content.includes("UNIQUE_USER_BODY"), true);
    assert.equal(resolveCanvasAgentSkillLoad(skills, { skillId: "missing" }, false).ok, false);
    assert.equal(resolveCanvasAgentSkillLoad(skills, { skillId: "  " }, false).ok, false);
    assert.equal(resolveCanvasAgentSkillLoad(skills, { skillId: "off" }, false).ok, false);
    assert.equal(resolveCanvasAgentSkillLoad(skills, { skillId: "soul-street", source: "user" }, false).ok, false);
    const locked = resolveCanvasAgentSkillLoad(skills, { skillId: "soul-street" }, true);
    assert.equal(locked.ok, false);
    assert.equal(!locked.ok && locked.code, "skill_selection_locked");
});

test("a loaded system skill with files can be read, and unrelated skills cannot", () => {
    const loaded = resolveCanvasAgentSkillLoad(skills, { skillId: "soul-street" }, false);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const user = resolveCanvasAgentSkillLoad(skills, { skillId: "user-1" }, false);
    assert.equal(user.ok, true);
    if (!user.ok) return;
    let active = rememberLoadedSkill([{ id: "manual-user", source: "user" as const }], { id: loaded.skill.id, source: loaded.skill.source });
    assert.equal(canReadSystemSkillFile(active, loaded.skill.id), true);
    assert.equal(loaded.skill.hasFiles, true);
    active = rememberLoadedSkill(active, { id: user.skill.id, source: user.skill.source });
    assert.equal(canReadSystemSkillFile(active, user.skill.id), false);
    assert.equal(canReadSystemSkillFile(active, "soul-portrait"), false);
    assert.equal(canReadSystemSkillFile([{ id: "soul-portrait", source: "system" }], "soul-portrait"), true);
});

test("manual skill selection replaces discovery and on-demand loading", () => {
    const catalog = buildCanvasAgentSkillCatalog(skills);
    const discovery = { catalog: formatCanvasAgentSkillCatalog(catalog), guidance: buildSoulSkillGuidance(catalog, true) };
    const manual = buildCanvasAgentSkillPrompt("intake", "按我选的做", context("higgsfield-ai/soul/v2/standard"), "MANUAL_SKILL_BODY", undefined, false, false, discovery, "manual");
    assert.match(manual, /【用户所选 Skill 根内容】/);
    assert.match(manual, /MANUAL_SKILL_BODY/);
    assert.equal(manual.includes("可用 Skill 目录"), false);
    assert.equal(manual.includes("【Soul 2.0 优先】"), false);
    assert.equal(manual.includes("Hybrid"), false);
    const names = canvasAgentTurnTools({ discovery: false, skillFiles: true }).map((tool) => tool.function.name);
    assert.equal(names.includes("load_skill"), false);
    assert.equal(names.includes("read_skill_file"), true);
});

test("a loaded skill governs the rest of the turn", () => {
    const loaded = absorbLoadedCanvasAgentSkills([], [
        { result: { ok: false, skillId: "soul-street", content: streetBody } },
        { result: { ok: true, skillId: "soul-street", source: "system", name: "Soul 2.0 街拍穿搭", content: streetBody, hasFiles: true } },
        { result: { ok: true, skillId: "soul-street", source: "system", name: "Soul 2.0 街拍穿搭", content: streetBody, hasFiles: true } },
    ]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].hasFiles, true);
    const prompt = buildCanvasAgentSkillPrompt("intake", "街拍", context("higgsfield-ai/soul/v2/standard"), formatCanvasAgentSkillBodies(loaded), undefined, true, false, {
        catalog: "【可用 Skill 目录】\nshould-not-appear",
        guidance: "【Soul 2.0 优先】",
    }, "loaded");
    assert.match(prompt, /【已加载 Skill 根内容】/);
    assert.match(prompt, /UNIQUE_STREET_BODY/);
    assert.match(prompt, /clothingSwap/);
    assert.match(prompt, /read_skill_file/);
    assert.match(prompt, /autoGenerateMedia/);
    assert.equal(prompt.includes("可用 Skill 目录"), false);
    assert.equal(prompt.includes("Hybrid"), false);
    const action = normalizeCanvasAgentAction("load_skill", { skillId: "soul-street", source: "system" }, "call-1");
    assert.equal(canvasAgentActionLabel(action, buildCanvasAgentSkillCatalog(skills)), "正在加载 Skill「Soul 2.0 街拍穿搭」");
    assert.throws(() => normalizeCanvasAgentAction("load_skill", { skillId: "soul-street", source: "other" }), /source/);
});
