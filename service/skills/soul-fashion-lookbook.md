---
name: Soul时尚大片摄影
description: |
  生成时尚 editorial 级的模特大片与 lookbook 图。我会先确认服装品类（高级定制/街头/运动/正装/休闲/泳装/配饰等）、模特姿态、面料材质、场景与光线，再按品类选对应风格关键词、按面料控质感、按场景定调性，产出有杂志感的时尚大片。内置 11 类时尚风格、模特姿态/表情关键词库、10 类面料表现与 10 种时尚布光，适合品牌 lookbook、时尚 editorial、服装广告、电商模特图，不适合产品静物或美食。
metadata:
  trigger-words: [时尚摄影, 时尚大片, 时装, lookbook, editorial, 服装广告, 模特大片, 街拍, 高级定制, 时装周, fashion photography, 潮流]
---

# Soul 时尚大片摄影

把「一套穿搭 + 一个场景」做成一张有杂志感的时尚大片。核心是：**服装是主角，模特是载体——用姿态展现剪影、用面料质感传递价值、用场景与光线定品牌调性。** 目标不是把人拍美，而是让衣服「卖得动、记得住」。

## 当前画布能力规则

- 生成前先用 `get_generation_config` 读取画布真实生图模型（Higgsfield Soul 2.0），不得臆测。
- 画布内置虚拟摄影器材库（相机、镜头、焦段、光圈），时尚大片常用中长焦（85–135mm）压缩空间、浅景深（f/1.4–f/2.8）突出主体；全身 lookbook 可用 50mm 标准焦段。若模型不支持参数，把镜头焦段光圈写进提示词。
- 本 Skill 只生成静态时尚照片，不生成视频、不做走秀动画。

## Soul 2.0 硬规则（生成前逐条检查）

Soul 2.0 的质量来自布光与材质的具体描述，不来自堆词。以下规则决定出图是商业级还是废片：

- **提示词用英文，60–120 词**，最多 150 词。超过后模型开始丢细节，先崩的是反光和结构。
- **一个维度一句话**：主体+材质 → 场景/台面 → 光位与强度 → 机位/镜头/光圈 → 影调。写到能直接拍出来的程度。
- **只写正向描述**：Soul 没有 negative prompt。写 `plain unlabeled surface` 而不是 `no text`，写 `tack sharp` 而不是 `no blur`。
- **不写品牌名、型号、真实 Logo**：会触发 ip 审核，或让模型硬造乱码 Logo 和假文字。要干净表面就写 `unbranded, unmarked`。
- **不堆 `8K / ultra detailed / masterpiece / stunning / hyperrealistic`**：这些词不提升清晰度，只换来塑料感和 AI 味。
- **画幅只有 7 档**：1:1、4:3、3:4、3:2、2:3、16:9、9:16，其他比例上游直接报错。
- **清晰度由画布统一提交 1080p**，提示词里不要再写分辨率。
- **多张变体要换姿态/光位/场景**，同一段提示词重复生成只会得到近似复制品。

## 启动前询问（强制 Gate）

每次触发后、正式生成前，一次性问清：

1. **服装品类**：高级定制/街头/运动/正装/休闲/泳装/配饰/可持续/复古/晚装，品类决定风格关键词与调性。
2. **模特方向**：性别、气质、姿态（走姿/站姿/坐姿）、表情（高级冷峻/亲和/性感/叛逆）。
3. **面料**：丝绸/牛仔/皮革/雪纺/针织/天鹅绒/亮片/蕾丝/科技面料/皮草，面料决定质感表现。
4. **场景**：纯色影棚/街头/自然/海滩/室内/天台/工业。
5. **光线**：编辑棚闪/黄金时刻/明亮日光/霓虹/窗光/戏剧逆光/凝胶，按调性推荐。
6. **画幅**：3:4（lookbook 竖版默认）/ 2:3 / 9:16 / 1:1。

用户说「你看着办」时，agent 按品类选推荐风格 + 场景 + 光线，并把采用的选择展示出来再继续。

## 画布工作流（自动搭建）

1. 用 `get_canvas_summary`、`query_canvas_nodes` 摸清现有节点与参考图。
2. 用 `get_generation_config` 读真实模型与参数。
3. 用 `create_text_node` 把确认后的需求写成简报节点。
4. 用 `generate_image` 出图，`create_connection` 连链路，`create_group` 归组、`arrange_nodes` 整理。
5. 每次生成后用 `get_media_task_status` 确认；先出 2–3 张不同姿态/场景候选让用户挑方向，再沿方向批量。

## 11 类时尚风格关键词（按品类选）

| 品类 | 调性 | 关键提示词（英文） |
|---|---|---|
| 高级定制/奢华 | 戏剧、精致 | dramatic silhouette, flowing fabric, jewel tones, editorial lighting, intricate detailing |
| 街头/城市 | 叛逆、态度 | bold colors, graphic prints, oversized fit, sneaker focus, street energy, confident swagger |
| 运动/机能 | 动感、性能 | high-tech fabrics, seamless design, performance details, dynamic pose, athletic energy |
| 正装/商务 | 利落、专业 | structured silhouette, tailored fit, minimalist elegance, power pose, strong eye contact |
| 休闲/日常 | 真实、亲和 | comfortable fit, effortless style, genuine movement, relatable, natural daylight |
| 泳装/海滩 | 自信、活力 | bold colors, body-confident pose, beach setting, glowing skin, tropical glow |
| 配饰（鞋包珠宝） | 工艺、细节 | intricate detailing, craftsmanship, luxury materials, tactile surface, macro detail |
| 可持续/环保 | 自然、本真 | natural materials, artisanal, organic, earthy tones, natural light, garden setting |
| 复古/年代 | 怀旧、经典 | retro silhouette, period details, nostalgic, sepia tones, heritage piece |
| 晚装/派对 | 华丽、戏剧 | glamorous silhouette, dramatic color, sequins, evening elegance, statement piece |
| 童装 | 活力、天真 | playful design, bright colors, fun patterns, joyful energy, candid movement |

## 模特姿态关键词库

- **站姿**：standing profile（侧面显剪影）/ three-quarter turn（四分之三显前后）/ hands on hips（叉腰显气场）/ hands in pockets（插兜显松弛）/ over-shoulder glance（回眸显神秘）/ lean or recline（倚靠显慵懒）。
- **表情**：strong gaze（强注视）/ subtle smile（浅笑）/ smoldering look（欲感）/ blank slate（高级冷面，让衣服说话）/ genuine laugh（真实大笑）/ contemplative gaze（沉思）/ attitude side-eye（斜眼态度）。
- **态度**：grace & poise（优雅克制）/ confident swagger（自信张扬）/ relaxed & approachable（松弛亲和）。

## 10 类面料表现（控质感）

| 面料 | 提示词（英文） |
|---|---|
| 丝绸/缎 | silk sheen, liquid drape, soft specular highlights, flowing fabric |
| 牛仔/棉 | denim texture, cotton weave, natural creases, casual structure |
| 皮革/麂皮 | leather grain, suede nap, rich texture, tailored edge |
| 雪纺/轻薄 | chiffon float, lightweight sheer, airy movement, backlit transparency |
| 针织/毛衣 | knit texture, chunky weave, soft volume, cozy drape |
| 天鹅绒/丝绒 | velvet pile, crushed texture, light-absorbing depth, jewel tone |
| 亮片/珠饰 | sequin sparkle, beaded detail, light-catching shimmer |
| 蕾丝/薄纱 | lace pattern, sheer overlay, delicate detail |
| 科技/机能面料 | technical fabric, matte performance, seamless construction, reflective accents |
| 皮草/仿皮草 | fur texture, soft volume, luxurious depth |

## 10 种时尚布光（定调性）

| 布光 | 适用 | 提示词（英文） |
|---|---|---|
| 编辑棚闪 | 高定、lookbook | crisp directional flash, clean shadows, bright background separation |
| 黄金时刻 | 通用、泳装 | golden hour light, warm flattering, soft shadows, amber tones |
| 明亮日光 | 街头、运动 | bright natural daylight, high-contrast shadows, colors pop with clarity |
| 霓虹/夜 | 街头、当代 | neon signs cast colored light, urban night, color-shifted shadows |
| 自然窗光 | 日常、可持续 | soft window light, gentle directional, intimate, flattering |
| 戏剧逆光 | 奢华、晚装 | backlighting creates silhouette, moody high-contrast, garment shape emphasized |
| 凝胶色光 | 编辑、实验 | colored gel light, fashion-forward color cast, artistic mood |
| 实用光 | 街头、真实 | practical light sources in frame, atmospheric realism |
| 柔光箱 | 专业 lookbook | soft box diffused light, no harsh shadows, even illumination |
| 双灯（主+辅） | 专业编辑 | key light left creates dimension, fill light right softens, three-dimensional |

## 场景库（定环境）

- **纯色影棚**（白/黑/彩背景）：clean studio backdrop, no distractions, high-fashion minimalist。
- **城市街头**：urban street, brick walls, graffiti, gritty authentic energy。
- **自然花园**：lush garden, green foliage, romantic organic。
- **海滩**：sandy beach, ocean waves, tropical summer。
- **室内家居**：cozy interior, warm tones, intimate domestic。
- **天台天际线**：rooftop, city skyline, golden hour, aspirational urban。
- **工业仓库**：industrial warehouse, concrete walls, metal beams, edgy moody。

## Prompt 构造模板（喂给 Soul 2.0 用英文）

```
[服装品类 + 调性] + [模特特征 + 姿态 + 表情] + [面料质感] + [场景] + [布光] + [机位/镜头] + [fashion editorial, lookbook, sharp fabric detail]
```

## 输出规范

- 每批交付附说明：什么品类风格、什么姿态、什么场景光线、为什么符合品牌调性；标注最推荐的一张。
- 交付前检查：服装轮廓是否清晰、面料质感是否对、姿态是否自然、光线是否统一。
- lookbook 可连出「全身 + 半身 + 细节特写」多张成组；电商模特图预留文案位。
