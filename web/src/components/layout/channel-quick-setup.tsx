"use client";

import { Button, Input, Modal } from "antd";
import { useMemo, useState } from "react";

import { channelPresets, draftFromPreset, maskKey, parseQuickChannelText, type ChannelPreset, type QuickChannelDraft } from "@/lib/channel-quick-config";

const presetGroups: ChannelPreset["group"][] = ["常用", "聚合 / 中转", "官方 / 直连", "本地 / 工作流"];

export function ChannelPresetPickerModal({ open, onCancel, onPick }: { open: boolean; onCancel: () => void; onPick: (preset: ChannelPreset) => void }) {
    return (
        <Modal title="选择服务商" open={open} onCancel={onCancel} footer={null} width={720} centered styles={{ body: { maxHeight: "68vh", overflowY: "auto" } }}>
            <div className="mb-3 text-xs text-stone-500">点一下就填好地址，只需要再贴一个 API Key。找不到自己的服务商就用「粘贴配置」，任何 OpenAI 兼容地址都能用。</div>
            <div className="space-y-4">
                {presetGroups.map((group) => {
                    const items = channelPresets.filter((preset) => preset.group === group);
                    if (!items.length) return null;
                    return (
                        <div key={group}>
                            <div className="mb-2 text-xs font-medium text-stone-400">{group}</div>
                            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                                {items.map((preset) => (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => onPick(preset)}
                                        className="rounded-lg border border-stone-200 p-2.5 text-left transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:hover:border-stone-500 dark:hover:bg-stone-800"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm font-medium">{preset.label}</span>
                                            <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800">{preset.protocol}</span>
                                        </div>
                                        <div className="mt-1 truncate text-[11px] text-stone-500">{preset.hint || preset.baseUrl || "本地服务"}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}

const PLACEHOLDER = [
    "https://api.grsai.ai/v1|sk-你的key",
    "",
    "或者直接贴后台给的一整段：",
    "export OPENAI_BASE_URL=https://api.deepseek.com/v1",
    "export OPENAI_API_KEY=sk-xxxx",
    "",
    "也支持 {\"baseUrl\": \"...\", \"apiKey\": \"...\"}",
].join("\n");

export function QuickPasteSetupModal({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: (drafts: QuickChannelDraft[]) => void }) {
    const [text, setText] = useState("");
    const parsed = useMemo(() => parseQuickChannelText(text), [text]);

    const reset = () => setText("");
    const confirm = () => {
        if (!parsed.drafts.length) return;
        onConfirm(parsed.drafts);
        reset();
    };

    return (
        <Modal
            title="粘贴即配置"
            open={open}
            onCancel={() => { reset(); onCancel(); }}
            width={620}
            centered
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-stone-500">会按地址自动识别服务商，识别不到就按 OpenAI 兼容处理</span>
                    <Button type="primary" disabled={!parsed.drafts.length} onClick={confirm}>
                        添加 {parsed.drafts.length || ""} 个渠道
                    </Button>
                </div>
            }
        >
            <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} rows={7} placeholder={PLACEHOLDER} className="font-mono text-xs" />
            {parsed.warnings.length ? (
                <div className="mt-2 space-y-1">
                    {parsed.warnings.map((warning) => (
                        <div key={warning} className="text-xs text-amber-600 dark:text-amber-500">{warning}</div>
                    ))}
                </div>
            ) : null}
            {parsed.drafts.length ? (
                <div className="mt-3 space-y-1.5 rounded-lg border border-stone-200 p-2 dark:border-stone-700">
                    <div className="text-xs font-medium text-stone-500">识别结果</div>
                    {parsed.drafts.map((draft, index) => (
                        <div key={`${draft.baseUrl}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                                <span className="font-medium">{draft.name}</span>
                                <span className="ml-2 text-stone-500">{draft.baseUrl || "地址待补"}</span>
                            </div>
                            <span className={draft.apiKey ? "shrink-0 text-stone-500" : "shrink-0 text-amber-600"}>{maskKey(draft.apiKey)}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </Modal>
    );
}

export function presetToDraft(preset: ChannelPreset) {
    return draftFromPreset(preset);
}
