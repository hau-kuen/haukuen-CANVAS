"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, ClipboardPaste, FolderPlus, GalleryHorizontal, GalleryHorizontalEnd, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "../types";
import type { VideoFramePosition } from "../utils/canvas-video-frame";

export function CanvasNodeContextMenu({ menu, canCaptureVideoFrame, canSaveToAssets, onClose, onCaptureVideoFrame, onSaveToAssets, onDuplicate, onDelete }: { menu: ContextMenuState; canCaptureVideoFrame: boolean; canSaveToAssets?: boolean; onClose: () => void; onCaptureVideoFrame: (position: VideoFramePosition) => void; onSaveToAssets?: () => void; onDuplicate: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {canCaptureVideoFrame ? (
                <>
                    <MenuButton icon={<BetweenHorizontalStart className="size-4" />} label="截取首帧" onClick={() => onCaptureVideoFrame("first")} />
                    <MenuButton icon={<GalleryHorizontalEnd className="size-4" />} label="截取尾帧" onClick={() => onCaptureVideoFrame("last")} />
                    <MenuButton icon={<GalleryHorizontal className="size-4" />} label="截取当前帧" onClick={() => onCaptureVideoFrame("current")} />
                    <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                </>
            ) : null}
            {menu.type === "node" && canSaveToAssets && onSaveToAssets ? (
                <MenuButton icon={<FolderPlus className="size-4" />} label="储存到素材" onClick={onSaveToAssets} />
            ) : null}
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label="复制" onClick={onDuplicate} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false, shortcut, disabled = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; shortcut?: string; disabled?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" disabled={disabled} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
            {shortcut ? <span className="ml-auto pl-4 text-[11px] opacity-50">{shortcut}</span> : null}
        </button>
    );
}

export function CanvasContextMenu({ x, y, canUndo, canRedo, onClose, onUpload, onAddNode, onUndo, onRedo, onPaste }: { x: number; y: number; canUndo: boolean; canRedo: boolean; onClose: () => void; onUpload: () => void; onAddNode: () => void; onUndo: () => void; onRedo: () => void; onPaste: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: x, top: y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <MenuButton icon={<Upload className="size-4" />} label="上传" shortcut="U" onClick={onUpload} />
            <MenuButton icon={<Plus className="size-4" />} label="添加节点" onClick={onAddNode} />
            <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
            <MenuButton icon={<Undo2 className="size-4" />} label="撤销" shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo} />
            <MenuButton icon={<Redo2 className="size-4" />} label="重做" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={onRedo} />
            <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
            <MenuButton icon={<ClipboardPaste className="size-4" />} label="粘贴" shortcut="Ctrl+V" onClick={onPaste} />
        </div>
    );
}
