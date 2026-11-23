import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { isClothingEditModel, prepareOutfitImageRequest, soulReferenceFields } from "./soul-outfit";

const soulID = "11111111-1111-4111-8111-111111111111";

function config(patch: Partial<AiConfig>): AiConfig {
    return {
        ...defaultConfig,
        channelMode: "local",
        model: "higgsfield-ai/soul/v2/standard",
        imageModel: "higgsfield-ai/soul/v2/standard",
        soulId: soulID,
        localChannels: [
            { id: "hf", protocol: "higgsfield", name: "Higgsfield", baseUrl: "https://api.higgsfield.ai", apiKey: "k", models: ["higgsfield-ai/soul/v2/standard"] },
            { id: "edit", protocol: "openai", name: "Edit", baseUrl: "https://example.com", apiKey: "k", models: ["gpt-image-2", "flux-pro", "nano-banana-2"] },
        ],
        ...patch,
    };
}

test("prepareOutfitImageRequest moves clothing swap off Soul image-to-image", () => {
    const prepared = prepareOutfitImageRequest(config({ clothingSwap: true, soulStrength: "1" }), "replace the jacket");
    assert.equal(prepared.config.model, "gpt-image-2");
    assert.equal(prepared.config.imageChannelId, "edit");
    assert.equal(prepared.config.activeChannelId, "edit");
    assert.equal(prepared.config.soulId, "");
    assert.equal(prepared.config.clothingSwap, false);
    assert.equal(prepared.config.model.includes("soul"), false);
    assert.match(prepared.prompt, /Keep the person, hair, pose, camera, scene, and lighting unchanged/);
});

test("prepareOutfitImageRequest throws when no edit model is configured", () => {
    assert.throws(
        () => prepareOutfitImageRequest(config({
            clothingSwap: true,
            localChannels: [{ id: "hf", protocol: "higgsfield", name: "Higgsfield", baseUrl: "https://api.higgsfield.ai", apiKey: "k", models: ["higgsfield-ai/soul/v2/standard"] }],
        }), "swap"),
        /不能提交到 Soul image-to-image/,
    );
});

test("soulReferenceFields keeps omitted strength at 1 and rejects invalid values", () => {
    const base = config({ soulStrength: undefined });
    assert.equal(soulReferenceFields(base).custom_reference_strength, 1);
    assert.equal(soulReferenceFields(config({ soulStrength: "0.4" })).custom_reference_strength, 0.4);
    for (const soulStrength of ["0", "1.2", "", "nope"]) {
        assert.throws(() => soulReferenceFields(config({ soulStrength })), /强度必须大于 0/);
    }
});

test("isClothingEditModel does not treat text-only flux or Soul as an edit target", () => {
    assert.equal(isClothingEditModel("gpt-image-2"), true);
    assert.equal(isClothingEditModel("flux-2/pro-image-to-image"), true);
    assert.equal(isClothingEditModel("flux-pro"), false);
    assert.equal(isClothingEditModel("gpt-image/1.5-text-to-image"), false);
    assert.equal(isClothingEditModel("higgsfield-ai/soul/v2/standard"), false);
});
