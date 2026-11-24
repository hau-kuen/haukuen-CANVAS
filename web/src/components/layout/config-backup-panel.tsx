"use client";

import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Modal, Space, Tag, Typography } from "antd";

import {
    buildConfigBackup,
    configBackupToText,
    downloadConfigBackup,
    formatSnapshotTime,
    parseConfigBackup,
    readConfigSnapshots,
    removeConfigSnapshot,
    saveConfigSnapshot,
    summarizeConfigBackup,
    type ConfigBackupFile,
    type ConfigSnapshot,
} from "@/lib/config-backup";
import { normalizeLocalChannels, useConfigStore, type AiConfig } from "@/stores/use-config-store";

type ConfigBackupPanelProps = {
    open: boolean;
    onClose: () => void;
};

const { Text, Paragraph } = Typography;

export function ConfigBackupPanel({ open, onClose }: ConfigBackupPanelProps) {
    const { message, modal } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>([]);
    const [pasteText, setPasteText] = useState("");
    const [busy, setBusy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const summary = summarizeConfigBackup({ channels: config.localChannels || [] });

    useEffect(() => {
        if (open) setSnapshots(readConfigSnapshots());
    }, [open]);

    const refreshSnapshots = () => setSnapshots(readConfigSnapshots());

    const handleDownload = () => {
        if (!summary.channels) {
            message.warning("当前没有可备份的渠道");
            return;
        }
        const { fileName } = downloadConfigBackup(config);
        saveConfigSnapshot(config);
        refreshSnapshots();
        message.success(`已导出 ${fileName}`);
    };

    const handleCopy = async () => {
        if (!summary.channels) {
            message.warning("当前没有可备份的渠道");
            return;
        }
        const text = configBackupToText(buildConfigBackup(config));
        try {
            await navigator.clipboard.writeText(text);
            message.success("配置 JSON 已复制（含 Key，注意别发到公开地方）");
        } catch {
            setPasteText(text);
            message.info("浏览器不让直接写剪贴板，已放到下面的输入框里，手动复制即可");
        }
    };

    const applyBackup = (backup: ConfigBackupFile, sourceLabel: string) => {
        // 覆盖前先留一份当前配置，误点也能退回来
        saveConfigSnapshot(config);
        const channels = normalizeLocalChannels({ ...config, localChannels: backup.channels });
        const byId = new Map(channels.map((channel) => [channel.id, channel]));
        const resolveChannel = (id: string) => (byId.has(id) ? id : channels[0]?.id || "");
        const resolveModel = (channelId: string, wanted: string) => {
            const channel = byId.get(channelId);
            if (!channel) return wanted || "";
            if (wanted && channel.models.includes(wanted)) return wanted;
            return channel.models[0] || wanted || "";
        };
        const selection = backup.selection;
        const imageChannelId = resolveChannel(selection.imageChannelId);
        const videoChannelId = resolveChannel(selection.videoChannelId);
        const textChannelId = resolveChannel(selection.textChannelId);
        const audioChannelId = resolveChannel(selection.audioChannelId);
        const imageModel = resolveModel(imageChannelId, selection.imageModel);
        const videoModel = resolveModel(videoChannelId, selection.videoModel);
        const textModel = resolveModel(textChannelId, selection.textModel);
        const audioModel = resolveModel(audioChannelId, selection.audioModel);
        const activeModel = (selection.model && channels.some((channel) => channel.models.includes(selection.model)) ? selection.model : "") || imageModel || textModel || videoModel || audioModel;
        const primary = byId.get(imageChannelId) || channels[0];

        const next: AiConfig = {
            ...config,
            channelMode: selection.channelMode === "remote" && config.publicChannels?.length ? "remote" : "local",
            localChannels: channels,
            imageChannelId,
            videoChannelId,
            textChannelId,
            audioChannelId,
            imageModel,
            videoModel,
            textModel,
            audioModel,
            model: activeModel,
            activeChannelId: imageChannelId,
            baseUrl: primary?.baseUrl || config.baseUrl,
            apiKey: primary?.apiKey || config.apiKey,
            models: channels.flatMap((channel) => channel.models),
            imageModels: byId.get(imageChannelId)?.models || [],
            videoModels: byId.get(videoChannelId)?.models || [],
            textModels: byId.get(textChannelId)?.models || [],
            audioModels: byId.get(audioChannelId)?.models || [],
        };
        useConfigStore.setState({ config: next });
        saveConfigSnapshot(next);
        setSnapshots(readConfigSnapshots());
        const stats = summarizeConfigBackup(backup);
        message.success(`已恢复 ${stats.channels} 个渠道 / ${stats.keys} 个 Key（来源：${sourceLabel}）`);
    };

    const confirmApply = (backup: ConfigBackupFile, sourceLabel: string) => {
        const stats = summarizeConfigBackup(backup);
        modal.confirm({
            title: "用这份备份覆盖当前配置？",
            content: `将替换为 ${stats.channels} 个渠道、${stats.keys} 个 Key。当前配置会先自动存一份快照，随时可以退回。`,
            okText: "覆盖并恢复",
            cancelText: "取消",
            onOk: () => applyBackup(backup, sourceLabel),
        });
    };

    const handlePasteRestore = () => {
        const result = parseConfigBackup(pasteText);
        if (!result.ok) {
            message.error(result.error);
            return;
        }
        confirmApply(result.backup, "粘贴内容");
    };

    const handleFile = (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        const reader = new FileReader();
        reader.onload = () => {
            setBusy(false);
            const result = parseConfigBackup(String(reader.result || ""));
            if (!result.ok) {
                message.error(`这个文件读不出来：${result.error}`);
                return;
            }
            confirmApply(result.backup, file.name);
        };
        reader.onerror = () => {
            setBusy(false);
            message.error("读文件失败");
        };
        reader.readAsText(file, "utf-8");
    };

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={700} title="API 配置备份与恢复" destroyOnHidden>
            <div className="space-y-4 pt-1">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Text strong>当前配置</Text>
                        <Space size={4} wrap>
                            <Tag>{summary.channels} 个渠道</Tag>
                            <Tag color={summary.keys ? "green" : "default"}>{summary.keys} 个已填 Key</Tag>
                            <Tag>{summary.models} 个模型</Tag>
                        </Space>
                    </div>
                    <Paragraph type="secondary" className="!mb-2 !mt-2 !text-xs">
                        备份文件里包含渠道地址、API Key、模型列表和当前选中的模型。换版本、重装、清缓存后，导入这个文件就能回到现在的状态。
                    </Paragraph>
                    <Space wrap>
                        <Button type="primary" onClick={handleDownload} disabled={!summary.channels}>
                            下载备份文件
                        </Button>
                        <Button onClick={handleCopy} disabled={!summary.channels}>
                            复制 JSON
                        </Button>
                        <Button disabled={!summary.channels} onClick={() => { saveConfigSnapshot(config); refreshSnapshots(); message.success("已存一份本机快照"); }}>
                            立即存快照
                        </Button>
                    </Space>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <Text strong>从备份恢复</Text>
                    <Paragraph type="secondary" className="!mb-2 !mt-2 !text-xs">
                        支持本功能导出的文件，也支持直接粘旧的 localStorage 内容（含 localChannels 即可）。
                    </Paragraph>
                    <Input.TextArea
                        value={pasteText}
                        onChange={(event) => setPasteText(event.target.value)}
                        placeholder='把备份 JSON 粘在这里，例如 {"channels":[...]}'
                        autoSize={{ minRows: 3, maxRows: 6 }}
                        spellCheck={false}
                    />
                    <Space wrap className="mt-2">
                        <Button type="primary" onClick={handlePasteRestore} disabled={!pasteText.trim()}>
                            恢复粘贴内容
                        </Button>
                        <Button onClick={() => fileInputRef.current?.click()} loading={busy}>
                            选择备份文件…
                        </Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json,.txt"
                            className="hidden"
                            onChange={(event) => {
                                handleFile(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </Space>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between">
                        <Text strong>本机自动快照</Text>
                        <Text type="secondary" className="!text-xs">改配置时自动记录，最多 8 份</Text>
                    </div>
                    <div className="mt-2 space-y-2">
                        {snapshots.length === 0 ? (
                            <Text type="secondary" className="!text-xs">还没有快照。保存一次配置、或点上面的“立即存快照”就会生成。</Text>
                        ) : (
                            snapshots.map((snapshot) => (
                                <div key={snapshot.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/20 px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm text-white/85">{formatSnapshotTime(snapshot.savedAt)}</div>
                                        <div className="truncate text-xs text-white/45">
                                            {snapshot.channels.length} 个渠道 · {snapshot.channels.filter((channel) => (channel.apiKey || "").trim()).length} 个 Key
                                            {snapshot.channels[0] ? ` · ${snapshot.channels.map((channel) => channel.name).slice(0, 2).join(" / ")}` : ""}
                                        </div>
                                    </div>
                                    <Space size={4}>
                                        <Button size="small" onClick={() => confirmApply(snapshot, `快照 ${formatSnapshotTime(snapshot.savedAt)}`)}>
                                            恢复
                                        </Button>
                                        <Button
                                            size="small"
                                            danger
                                            type="text"
                                            onClick={() => {
                                                removeConfigSnapshot(snapshot.id);
                                                refreshSnapshots();
                                                message.success("已删除该快照");
                                            }}
                                        >
                                            删除
                                        </Button>
                                    </Space>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <Text type="secondary" className="!text-xs">
                    提示：已登录账号时配置本来就会同步到服务端；这份备份主要是给“换地址/换机器/清缓存/重装”兜底。备份里有 Key，别上传到公开网盘。
                </Text>
            </div>
        </Modal>
    );
}
