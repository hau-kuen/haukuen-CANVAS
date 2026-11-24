import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { APP_VERSION } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

// 版本来源：优先 jsDelivr（国内可直连），失败回落 raw.githubusercontent.com。
// 指向本仓库（hau-kuen/haukuen-CANVAS），上游 tigerowo/infinite-canvas 的版本号与本项目不同步。
const repoSlug = "hau-kuen/haukuen-CANVAS";
const versionSources = [
    `https://cdn.jsdelivr.net/gh/${repoSlug}@main/VERSION`,
    `https://raw.githubusercontent.com/${repoSlug}/main/VERSION`,
];
const changelogSources = [
    `https://cdn.jsdelivr.net/gh/${repoSlug}@main/CHANGELOG.md`,
    `https://raw.githubusercontent.com/${repoSlug}/main/CHANGELOG.md`,
];

/** 依次尝试多个源，返回第一个成功的内容。 */
async function fetchFirstText(urls: string[]): Promise<string> {
    for (const url of urls) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) continue;
            const text = (await response.text()).trim();
            if (text) return text;
        } catch {
            /* 换下一个源 */
        }
    }
    throw new Error("所有源都不可用");
}

/**
 * 取最新版本号。
 * 注意 jsDelivr 对 @main 有缓存（可达数小时），发版后可能读到旧值，
 * 所以先用 GitHub Releases API（实时），失败再退回 CDN / raw。
 */
async function fetchLatestVersion(): Promise<string> {
    const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/latest`;
    try {
        const response = await fetch(apiUrl, { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
        if (response.ok) {
            const data = (await response.json()) as { tag_name?: unknown };
            if (typeof data.tag_name === "string" && data.tag_name.trim()) return data.tag_name.trim();
        }
    } catch {
        /* 退回静态源 */
    }
    return fetchFirstText(versionSources);
}

function readLocalReleases(): ReleaseInfo[] {
    try {
        return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
    } catch {
        return [];
    }
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)\.?(\d+)?/);
    return match ? match.slice(1).filter(Boolean).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async () => {
        try {
            const version = await fetchLatestVersion();
            setLatestVersion(version || currentVersion);
            return true;
        } catch {
            return false;
        }
    }, [currentVersion]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [version, changelog] = await Promise.all([
                    fetchLatestVersion(),
                    fetchFirstText(changelogSources),
                ]);
                setLatestVersion(version || currentVersion);
                if (changelog) setReleases(parseChangelog(changelog));
                if (showMessage) message.success("已获取最新版本信息");
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error("获取最新版本信息失败");
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
