---
name: Soul人物摄影
description: |
  生成照片级的人物写真与形象图（电商模特、个人形象照、UGC 广告人物、生活方式人物）。我会先确认人物特征、用途、气质与画幅，再按「主体+年龄特征+表情+造型+光线+相机构图+背景+技术质量」八层框架写提示词，强调真实皮肤质感、自然表情与可信的人物状态，避免 AI 塑料感。适合电商模特图、形象照、UGC 广告、生活方式人物，不适合多人复杂叙事或视频。
metadata:
  trigger-words: [人物摄影, 人像, 模特图, 写真, 形象照, 生活方式, UGC人物, 电商模特, 女性人物, 真实感人物, portrait, character, photorealistic person]
---

# Soul 人物摄影

把「一个人 + 一个用途」做成一张看起来像真人的照片。核心是：**真实感优先于完美——人物要像你在 TikTok、小红书、街拍里看到的人，而不是杂志封面 AI 脸。** 用皮肤质感、自然表情、可信光线与平台化造型，让成片有「被拍下来」的真实感。

## 当前画布能力规则

- 生成前先用 `get_generation_config` 读取画布真实生图模型（Higgsfield Soul 2.0），不得臆测。
- 画布内置虚拟摄影器材库（相机、镜头、焦段、光圈），人物优先用 35–85mm 与 f/1.4–f/2.8 浅景深；自拍感可写 26mm 手机焦段。若模型不支持参数，把机身镜头焦段光圈写进提示词。
- 本 Skill 只生成静态人物照片，不生成视频、不做数字人动画。

## Soul 2.0 硬规则（生成前逐条检查）

Soul 2.0 的质量来自布光与肤质的具体描述，不来自堆词。以下规则决定出图是商业级还是废片：

- **提示词用英文，60–120 词**，最多 150 词。超过后模型开始丢细节，手部和五官先崩。
- **一个维度一句话**：主体+年龄特征 → 表情姿态 → 服装造型 → 光线 → 机位/镜头/景深 → 背景。
- **只写正向描述**：Soul 没有 negative prompt。写 `natural skin texture with visible pores` 而不是 `no plastic skin`，写 `tack sharp eyes` 而不是 `no blur`。
- **不写品牌名、真实人名、明星名字**：会触发 ip 审核直接失败。
- **不堆 `8K / ultra detailed / masterpiece / stunning / hyperrealistic`**：这些词正是恐怖谷来源。
- **画幅只有 7 档**：1:1、4:3、3:4、3:2、2:3、16:9、9:16，其他比例上游直接报错。
- **清晰度由画布统一提交 1080p**，提示词里不要再写分辨率。
- **多张变体要换表情/姿态/光位**，同一段提示词重复生成只会得到近似复制品。

## 启动前询问（强制 Gate）

每次触发后、正式生成前，一次性问清以下字段。已提供的直接说明「已检测到」：

1. **人物特征**：性别、年龄区间、肤色、发型发色、气质。没有素材时先出「风格基准候选」供挑。
2. **用途**：电商模特图 / 个人形象照 / UGC 广告人物 / 生活方式 / 写真。用途决定真实感强度（UGC 最真实、形象照可略精致）。
3. **表情与能量**：对镜头自然交流 / 展示产品 / 生活抓拍 / 高级冷峻 / 亲和微笑，由用途决定。
4. **服装造型**：休闲 / 精致 / 运动 / 奢华 / 自然妆容。给出具体单品与颜色。
5. **光线**：黄金时刻 / 环形光 / 窗光 / 阴天户外 / 由用途推荐。
6. **画幅**：1:1 / 3:4 / 4:3 / 9:16 / 16:9，默认 3:4 竖版人像。

用户说「你看着办」时，agent 按用途选推荐默认，并把采用的选择展示出来再继续。

## 画布工作流（自动搭建）

1. 用 `get_canvas_summary`、`query_canvas_nodes` 摸清现有节点与人物素材，复用已有参考图。
2. 用 `get_generation_config` 读真实模型与参数。
3. 用 `create_text_node` 把确认后的需求写成简报节点。
4. 用 `generate_image` 出图，`create_connection` 连「参考图 → 简报 → 成片」，`create_group` 归组、`arrange_nodes` 整理。
5. 每次生成后用 `get_media_task_status` 确认完成；先出 2–3 张不同光线/表情的候选让用户挑方向，再沿方向批量。

## 八层 Prompt 框架（喂给 Soul 2.0 用英文）

```
[主体描述] + [年龄&特征] + [表情&姿态] + [服装&造型] + [光线] + [相机&构图] + [背景] + [技术质量]
```

### 核心原则：真实感优先

- **皮肤质感**：写 `natural skin texture with subtle pores`、`realistic skin with light freckles`。**禁用** `perfect`、`flawless`、`porcelain`（触发 AI 塑料脸）。
- **表情**：对镜头交流感写 `mid-conversation expression, slightly raised eyebrows, genuine smile`；展示产品写 `looking at product with genuine interest, slight smile`；生活抓拍写 `candid laugh, looking slightly off-camera`。
- **造型真实**：头发用 `loose beach waves`、`messy bun with face-framing pieces`，避免沙龙完美感。

### 表情能量库

| 场景 | 表情提示词 |
|---|---|
| 对镜头交流（testimonial） | mid-conversation expression, warm engaged eyes, about to speak |
| 产品展示 | looking at product with genuine interest, holding product near face |
| 生活抓拍 | candid laugh, relaxed pose, caught mid-action |

### 光线方案

| 光线 | 提示词 |
|---|---|
| 黄金时刻（最通用） | warm golden hour sunlight, soft directional light from the side |
| 环形光（美妆护肤） | soft ring light illumination, even facial lighting, catchlights in eyes |
| 窗光（室内） | soft natural window light from the left, gentle shadows |
| 阴天户外（生活） | soft diffused outdoor lighting, no harsh shadows |

### 相机与构图

- 特写肖像：`close-up portrait, head and shoulders, shallow depth of field f/1.8`
- 自拍感：`selfie angle, slightly above eye level, 26mm lens`
- 中景：`medium shot, waist up, f/2.0 shallow depth of field`

### 技术质量标签（固定收尾）

```
photorealistic, natural skin texture, natural color grading, shot on Sony A7III
```

**禁用**：`8K`、`hyperrealistic`、`perfect`、`stunning`——这些推向 AI 恐怖谷。

## 输出规范

- 每批交付附说明：用了什么光线、什么焦段、为什么符合该用途的真实感要求；标注最推荐的一张。
- 交付前逐张检查：皮肤质感是否自然、眼神是否有光、五官是否变形、是否有塑料感；发现就重生成或局部修复，不把明显瑕疵交给用户。
- UGC/电商模特图预留文案位或产品展示空间；形象照主体居中、背景干净。
