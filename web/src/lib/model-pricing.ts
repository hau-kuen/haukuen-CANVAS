/**
 * grsai 模型计费参考（积分），来源：https://grsai.ai/zh/models（2026-11-23 抓取）。
 *
 * 换算口径按用户要求：1 RMB = 12500 积分。
 * 注意：grsai 官网自己的参考价是「积分 / 20,000」，这里刻意用 12,500，
 * 因为用户是按自己充值的实际汇率算成本的。改汇率只改 CREDITS_PER_CNY。
 *
 * 这些积分是 grsai 平台扣的费用，与本项目自建的 users.credits 无关；
 * 这里只做「选模型时看到大概花多少钱」的展示，不参与扣费。
 */

export const CREDITS_PER_CNY = 12500;

type PriceEntry = {
    /** 基础积分价（图片模型 = 每次；视频模型 = 最低档，见 variants） */
    credits: number;
    /** 分档价格（视频按分辨率，图片按质量档），key 用于展示 */
    variants?: Record<string, number>;
    /** 计价单位说明 */
    unit?: string;
};

const PRICES: Record<string, PriceEntry> = {
    // ── GPT Image ──────────────────────────────────────────
    "gpt-image-2.5": { credits: 600, unit: "次" },
    "gpt-image-2.5-flare": { credits: 2000, unit: "次" },
    "gpt-image-2.5-sunburst": { credits: 2400, unit: "次" },
    "gpt-image-2.6": { credits: 600, unit: "次" },
    "gpt-image-2.6-flare": { credits: 2000, unit: "次" },
    "gpt-image-2.6-sunburst": { credits: 2400, unit: "次" },
    "gpt-image-2": { credits: 600, unit: "次" },
    "gpt-image-2-vip": { credits: 2000, unit: "次" },

    // ── Nano Banana ────────────────────────────────────────
    "nano-banana-2.1": { credits: 1200, unit: "次" },
    "nano-banana-2": { credits: 1200, unit: "次" },
    "nano-banana-pro": { credits: 1800, unit: "次" },
    "nano-banana-2-lite": { credits: 440, unit: "次" },
    "nano-banana-fast": { credits: 440, unit: "次" },
    "nano-banana-2-cl": { credits: 6000, unit: "次" },
    "nano-banana-pro-cl": { credits: 10000, unit: "次" },
    "nano-banana-2-2k-cl": { credits: 9000, unit: "次" },
    "nano-banana-2-4k-cl": { credits: 13000, unit: "次" },
    "nano-banana-pro-vip": { credits: 10000, unit: "次" },
    "nano-banana-pro-4k-vip": { credits: 18000, unit: "次" },

    // ── 视频（按分辨率分档，价格按 10 秒计）────────────────
    "wan-3.0": {
        credits: 2700,
        unit: "10秒",
        variants: { "480p": 2700, "720p": 5400, "1080p": 10800 },
    },
    "minimax-h3": {
        credits: 1000,
        unit: "10秒",
        variants: { "480p": 1000, "768p": 1400, "1080p": 3000 },
    },
    "agnes-video-2.5": {
        credits: 4600,
        unit: "10秒",
        variants: { "720p": 4600, "1080p": 6900, "2k": 9200 },
    },
};

export function creditsToCny(credits: number) {
    return credits / CREDITS_PER_CNY;
}

/** 人民币展示：<0.1 保留 3 位有效小数，>=0.1 保留 2 位。 */
export function formatCny(credits: number) {
    const cny = creditsToCny(credits);
    if (cny < 0.01) return `¥${cny.toFixed(4)}`;
    if (cny < 0.1) return `¥${cny.toFixed(3)}`;
    return `¥${cny.toFixed(2)}`;
}

/** 积分 + 人民币，如「600点 ≈¥0.048」。 */
export function formatCreditsPrice(credits: number) {
    return `${credits}点 ≈${formatCny(credits)}`;
}

export function modelPriceEntry(model: string): PriceEntry | undefined {
    if (!model) return undefined;
    const key = model.trim();
    if (PRICES[key]) return PRICES[key];
    // 兼容大小写 / 别名（如 grsai 返回 gemini-3.1-flash-image-preview）
    const lower = key.toLowerCase();
    return PRICES[lower] || PRICES[lower.replace(/^grsai\//, "")];
}

/** 模型的一条价格摘要（取最低档），用于下拉项右侧标注。 */
export function modelPriceLabel(model: string): string {
    const entry = modelPriceEntry(model);
    if (!entry) return "";
    const base = `${formatCreditsPrice(entry.credits)}`;
    return entry.unit && entry.unit !== "次" ? `${base}/${entry.unit}` : base;
}

/** 视频模型按分辨率给价，用于参数面板或提示。 */
export function videoResolutionPrice(model: string, resolution: string): number | undefined {
    const entry = modelPriceEntry(model);
    if (!entry?.variants) return undefined;
    return entry.variants[resolution];
}

/** 该模型是否已有价格数据（没有就不显示标签，避免显示错误价格）。 */
export function hasModelPrice(model: string) {
    return Boolean(modelPriceEntry(model));
}
