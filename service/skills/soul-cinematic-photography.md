---
name: Soul电影感摄影
description: |
  生成电影感氛围的静态照片——用电影布光、构图与调色控制画面情绪。我会先确认主题、情绪基调与画幅，再按电影语言选布光（三点布光/明暗对比/剪影/黄金时刻/月光/霓虹/体积光等）、选构图（三分法/引导线/负空间/框中框）、定调色（青橙/暖冷对比/去饱和强调色），产出有叙事张力的电影感单帧。适合品牌氛围图、剧照感、概念视觉、情绪大片，不适合产品上架图或电商白底图。
metadata:
  trigger-words: [电影感, 电影画面, 剧照感, 氛围图, 情绪大片, 电影摄影, 电影布光, 电影调色, cinematic, film look, movie still, 视觉大片]
---

# Soul 电影感摄影

把一张静态照片做出电影镜头的感觉。核心是：**用光线定情绪、用构图定张力、用调色定气质——三者合力让单帧产生叙事感，仿佛是从一部电影里截出来的一格。** 目标不是「好看」，而是让画面「有戏」。

## 当前画布能力规则

- 生成前先用 `get_generation_config` 读取画布真实生图模型（Higgsfield Soul 2.0 对应 `higgsfield-ai/soul/standard` 或 `soul/v2/standard`），不得臆测模型，画布也没有 `soul_cinematic` 这类模型。宽幅只能用 16:9，需要更宽就后期裁切。
- 画布内置虚拟摄影器材库，电影感优先用变形宽银幕等效焦段（如 35–50mm anamorphic）与浅景深；若模型不支持参数，把镜头焦段光圈写进提示词。
- 本 Skill 只生成静态电影感照片，不生成视频、不做镜头运动（那是视频模型的事）。

## Soul 2.0 硬规则（生成前逐条检查）

Soul 2.0 的质量来自布光与材质的具体描述，不来自堆词。以下规则决定出图是商业级还是废片：

- **提示词用英文，60–120 词**，最多 150 词。超过后模型开始丢细节，先崩的是反光和结构。
- **一个维度一句话**：主体+材质 → 场景/台面 → 光位与强度 → 机位/镜头/光圈 → 影调。写到能直接拍出来的程度。
- **只写正向描述**：Soul 没有 negative prompt。写 `plain unlabeled surface` 而不是 `no text`，写 `tack sharp` 而不是 `no blur`，写 `even matte panel` 而不是 `avoid reflections`。
- **不写品牌名、型号、真实 Logo**：会触发 ip 审核，或让模型硬造乱码 Logo 和假文字。要干净表面就写 `unbranded, unmarked`。
- **不堆 `8K / ultra detailed / masterpiece / stunning / hyperrealistic`**：这些词不提升清晰度，只换来塑料感和 AI 味。
- **画幅只有 7 档**：1:1、4:3、3:4、3:2、2:3、16:9、9:16，其他比例上游直接报错（21:9 也不行）。
- **清晰度由画布统一提交 1080p**，提示词里不要再写分辨率。
- **多张变体要换光位/机位/影调**，同一段提示词重复生成只会得到近似复制品。

## 启动前询问（强制 Gate）

每次触发后、正式生成前，一次性问清：

1. **主题**：人物 / 场景 / 静物 / 概念。是什么、在什么环境。
2. **情绪基调**：悬疑 / 浪漫 / 孤独 / 史诗 / 怀旧 / 危险 / 静谧。情绪决定布光与调色。
3. **画幅**：16:9（宽银幕，默认）/ 21:9、2.35:1 观感先出 16:9 再裁切；竖版 9:16 用于社交。
4. **布光方向**：由情绪推荐（见下表），或用户指定。
5. **调色方向**：青橙 / 暖冷对比 / 去饱和强调色 / 漂白旁路 / 胶片颗粒，由情绪推荐。

用户说「你看着办」时，agent 按情绪基调选推荐布光 + 调色，并把采用的选择展示出来再继续。

## 画布工作流（自动搭建）

1. 用 `get_canvas_summary`、`query_canvas_nodes` 摸清现有节点与素材。
2. 用 `get_generation_config` 读真实模型（Soul 2.0 只有 7 档画幅，宽幅上限 16:9）。
3. 用 `create_text_node` 把确认后的主题、情绪、布光、调色写成简报节点。
4. 用 `generate_image` 出图，`create_connection` 连链路，`create_group` 归组、`arrange_nodes` 整理。
5. 每次生成后用 `get_media_task_status` 确认；先出 2–3 张不同布光/调色候选让用户挑方向，再沿方向精修。

## 10 种电影布光（按情绪选）

| 布光 | 情绪 | 提示词（英文） |
|---|---|---|
| 三点布光 | 经典叙事 | three-point lighting: warm key at 45° left, soft fill right, rim light behind |
| 明暗对比/黑片 | 危险、心理深度 | chiaroscuro: 90% shadow, hard-edged single light, near-absent midtones, film noir |
| 剪影逆光 | 神秘、力量 | silhouette: subject fully backlit, outline against bright background, no fill light |
| 黄金时刻 | 怀旧、浪漫 | golden hour: warm amber low-angle light, 3200K, soft shadows with warm spill |
| 月光 | 孤独、梦幻 | moonlight: cool blue 6000K, low-angle directional, blue-tinted shadows |
| 霓虹/实用光 | 赛博朋克、现实 | practical neon: visible neon sources, cyan-magenta color cast, hard multi-angle shadows |
| 柔光阴天 | 平静、清晰 | soft overcast: diffused daylight, no harsh shadows, even ambient illumination |
| 体积光/上帝光 | 神圣、宏大 | volumetric god rays: light through particle atmosphere, visible dust motes, light as substance |
| 荧光/机构光 | 临床、不安 | fluorescent institutional: cool green-gray 4500K, harsh overhead, soulless even light |
| 火光/烛光 | 亲密、原始 | firelight: warm orange-red 1500–2000K, flickering, large dancing shadows |

## 构图法则（定张力）

- **三分法**：主体放九宫格交叉点，地平线在上下三分之一线，不对称制造张力。
- **引导线**：道路/栏杆/光影线条汇聚向主体，制造纵深与视觉牵引。
- **负空间**：主体只占画面 15%，其余留空，制造孤立与强调。
- **框中框**：用窗、门、树枝等自然边框嵌套主体，制造层次。
- **对称 vs 不对称**：对称制造庄重/神圣，不对称制造紧张与自然感。

## 氛围元素（加质感）

- **雾/霾**：`thick atmospheric haze obscures 40% of background, light diffuses through particles`——神秘、柔边。
- **胶片颗粒**：`35mm film grain, visible in shadow areas, analog cinematic texture`——怀旧、真实。
- **浅景深虚化**：`shallow depth of field, circular bokeh from practical lights`——分离主体、电影纵深。
- **运动模糊**：`motion blur on moving elements, blur trails, subject sharp`——速度与动感（静态图里暗示运动）。

## 调色方案（定气质）

| 调色 | 提示词（英文） | 气质 |
|---|---|---|
| 青橙 | teal-orange grade: shadows toward cyan, highlights toward orange-gold | 现代大片、高预算 |
| 暖冷对比 | warm subject 3000K against cool blue shadow 6000K | 视觉分离、冲击 |
| 去饱和强调色 | desaturate to 30%, only red remains 100% saturated | 聚焦、情绪强度 |
| 漂白旁路 | bleach bypass: crushed blacks, lifted greys, grain in blacks | 复古、胶片 |
| 胶片颗粒 | film grain + warm color grading | 怀旧、年代感 |

## Prompt 构造模板（喂给 Soul 2.0 用英文）

```
[主题与环境] + [情绪基调] + [布光方案] + [构图法则] + [氛围元素] + [调色方案] + [画幅 16:9] + [cinematic still, anamorphic lens]
```

需要 21:9 的宽银幕观感：先按 16:9 生成，再上下裁切。Soul 没有 21:9，直接写会报错。

## 输出规范

- 每批交付附说明：用了什么布光、什么构图、什么调色、为什么符合该情绪；标注最推荐的一张。
- 交付前检查：光线方向是否一致、阴影是否自然、调色是否统一、构图是否有张力。
- 电影感图适合做品牌氛围 KV、概念海报、剧照参考；如需文字排版，预留负空间。
