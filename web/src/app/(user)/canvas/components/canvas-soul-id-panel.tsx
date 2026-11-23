"use client";

import { useEffect, useState } from "react";

import { isSoulImageModel } from "@/lib/soul-outfit";
import { canvasThemes } from "@/lib/canvas-theme";
import { createSoulId, getSoulId, listSoulIds, soulStatusLabel, type SoulReference } from "@/services/api/soul-id";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasSoulIdPanelProps = {
    config: AiConfig;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChange: (patch: { soulId?: string; soulStrength?: string }) => void;
};

export function CanvasSoulIdPanel({ config, theme, onChange }: CanvasSoulIdPanelProps) {
    const [items, setItems] = useState<SoulReference[]>([]);
    const [status, setStatus] = useState("");
    const [name, setName] = useState("");
    const [urls, setUrls] = useState("");
    const [authorized, setAuthorized] = useState(false);
    const [busy, setBusy] = useState(false);
    const selected = (config.soulId || "").trim();
    const strength = config.soulStrength || "1";
    const selectedItem = items.find((item) => item.id === selected);
    const selectedReady = selectedItem?.status === "completed";

    const listKey = `${config.channelMode}:${config.imageChannelId}:${config.model}`;
    useEffect(() => {
        if (!isSoulImageModel(config.model)) return;
        let stop = false;
        void listSoulIds(config)
            .then((page) => {
                if (!stop) setItems(page.items);
            })
            .catch((error: unknown) => {
                if (!stop) setStatus(error instanceof Error ? error.message : "Soul ID 列表读取失败");
            });
        return () => {
            stop = true;
        };
        // 只在模型和渠道变化时重拉列表。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listKey]);

    const pendingIds = items.flatMap((item) => (item.id && item.status !== "completed" && item.status !== "failed" ? [item.id] : []));
    if (selected && !items.some((item) => item.id === selected)) pendingIds.push(selected);
    const pendingKey = pendingIds.join(",");
    useEffect(() => {
        if (!pendingKey) return;
        const ids = pendingKey.split(",");
        const timer = window.setInterval(() => {
            ids.forEach((id) => {
                void getSoulId(config, id)
                    .then((next) => setItems((prev) => {
                        const rest = prev.filter((item) => item.id !== next.id);
                        return [next, ...rest];
                    }))
                    .catch(() => undefined);
            });
        }, 4000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingKey]);

    useEffect(() => {
        if (selectedItem?.status && selectedItem.status !== "completed") onChange({ soulId: "", soulStrength: strength || "1" });
        // 已知未完成的 Soul ID 不能留在生成配置里。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, selectedItem?.status]);

    if (!isSoulImageModel(config.model)) return null;

    const train = async (files: FileList | null) => {
        if (!authorized) {
            setStatus("请先确认照片中的人物已授权");
            return;
        }
        const fileUrls = files?.length ? await Promise.all(Array.from(files).slice(0, 40).map(readFileAsDataUrl)) : [];
        const imageUrls = [...fileUrls, ...urls.split(/\s+/).map((item) => item.trim()).filter(Boolean)];
        if (!name.trim() || !imageUrls.length) {
            setStatus("请填写角色名，并提供训练照片");
            return;
        }
        setBusy(true);
        setStatus(imageUrls.length < 20 ? "照片少于 20 张，身份可能不稳定，仍会提交训练" : "正在创建 Soul ID");
        try {
            const created = await createSoulId(config, { name: name.trim(), authorized: true, imageUrls });
            setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
            if (created.status === "completed") onChange({ soulId: created.id, soulStrength: strength || "1" });
            setStatus(created.status === "completed" ? created.warning || "Soul ID 已可用" : created.warning || `训练已开始：${soulStatusLabel(created.status)}。完成后才能用于出图`);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Soul ID 创建失败");
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="space-y-2 border-t pt-3 text-xs" style={{ borderColor: theme.toolbar.border }}>
            <div className="font-medium">Soul ID</div>
            <p style={{ color: theme.node.muted }}>模式 B 固定人物时选用已完成的 Soul ID。训练只用已授权照片，model_version 为 v2。</p>
            <label className="block space-y-1">
                <span style={{ color: theme.node.muted }}>角色</span>
                <select
                    className="h-8 w-full rounded-md border bg-transparent px-2"
                    style={{ borderColor: theme.toolbar.border, color: theme.node.text }}
                    value={selectedReady ? selected : ""}
                    onChange={(event) => {
                        const next = items.find((item) => item.id === event.target.value);
                        if (next && next.status !== "completed") return;
                        onChange({ soulId: event.target.value, soulStrength: strength });
                    }}
                >
                    <option value="">不固定人物</option>
                    {items.map((item) => (
                        <option key={item.id} value={item.id} disabled={item.status !== "completed"}>
                            {item.name || item.id} · {soulStatusLabel(item.status)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="block space-y-1">
                <span style={{ color: theme.node.muted }}>强度 {strength}</span>
                <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={Number(strength) > 0 ? strength : 1}
                    onChange={(event) => onChange({ soulId: selected, soulStrength: event.target.value })}
                />
            </label>
            <label className="block space-y-1">
                <span style={{ color: theme.node.muted }}>新角色名称</span>
                <input className="h-8 w-full rounded-md border bg-transparent px-2" style={{ borderColor: theme.toolbar.border }} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="block space-y-1">
                <span style={{ color: theme.node.muted }}>公网图片 URL，一行一个</span>
                <textarea className="h-16 w-full rounded-md border bg-transparent px-2 py-1" style={{ borderColor: theme.toolbar.border }} value={urls} onChange={(event) => setUrls(event.target.value)} />
            </label>
            <label className="flex items-start gap-2">
                <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
                <span>我确认这些照片中的人物已授权用于 Soul ID 训练，不含未授权的他人肖像。</span>
            </label>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md px-2" style={{ background: theme.node.fill }}>
                {busy ? "提交中" : "从本地照片训练"}
                <input
                    className="hidden"
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={busy}
                    onChange={(event) => {
                        void train(event.target.files);
                        event.target.value = "";
                    }}
                />
            </label>
            <button type="button" className="ml-2 h-8 rounded-md px-2" style={{ background: theme.node.fill }} disabled={busy} onClick={() => void train(null)}>
                用 URL 训练
            </button>
            {status ? <p style={{ color: theme.node.muted }}>{status}</p> : null}
        </section>
    );
}

function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("训练图片无法读取"));
        reader.readAsDataURL(file);
    });
}
