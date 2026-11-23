---
name: Soul美食摄影
description: |
  生成让人有食欲的美食照片。我会先确认菜品品类、关键瞬间（money shot）、光线与场景，再按品类选调性、按「食欲感」原则控质感（拉丝、蒸汽、光泽、汤汁、酥脆），产出能让人看饿的商业美食图。内置 12 类美食调性、15 个 hero 瞬间、5 种美食布光，适合餐饮菜单、外卖电商、美食自媒体、食品广告，不适合人物大片或产品静物。
metadata:
  trigger-words: [美食摄影, 食物摄影, 餐饮, 菜单, 外卖, 食品广告, 美食大片, 甜品, 咖啡, 饮品, food photography, 食欲感]
---

# Soul 美食摄影

把「一道菜」拍出让人看饿的效果。核心是：**食欲感第一——用质感（拉丝/蒸汽/光泽/汤汁/酥脆）传递味道，用暖光传递新鲜，用「关键瞬间」制造想吃的冲动。** 目标不是把菜拍清楚，而是让观众分泌口水。

## 当前画布能力规则

- 生成前先用 `get_generation_config` 读取画布真实生图模型（Higgsfield Soul 2.0），不得臆测。
- 画布内置虚拟摄影器材库（相机、镜头、焦段、光圈），美食常用微距/中焦（50–100mm）+ f/2.8–f/5.6（既要细节又留景深）；俯拍 flat-lay 用 f/8 保证整体锐利。若模型不支持参数，把镜头焦段光圈写进提示词。
- 本 Skill 只生成静态美食照片，不生成视频、不做 ASMR 动作。

## Soul 2.0 硬规则（生成前逐条检查）

Soul 2.0 的质量来自布光与材质的具体描述，不来自堆词。以下规则决定出图是商业级还是废片：

- **提示词用英文，60–120 词**，最多 150 词。超过后模型开始丢细节，先崩的是反光和结构。
- **一个维度一句话**：主体+材质 → 场景/台面 → 光位与强度 → 机位/镜头/光圈 → 影调。写到能直接拍出来的程度。
- **只写正向描述**：Soul 没有 negative prompt。写 `plain unlabeled surface` 而不是 `no text`，写 `tack sharp` 而不是 `no blur`。
- **不写品牌名、型号、真实 Logo**：会触发 ip 审核，或让模型硬造乱码 Logo 和假文字。
- **不堆 `8K / ultra detailed / masterpiece / stunning / hyperrealistic`**：这些词不提升清晰度，只换来塑料感和 AI 味。
- **画幅只有 7 档**：1:1、4:3、3:4、3:2、2:3、16:9、9:16，其他比例上游直接报错。
- **清晰度由画布统一提交 1080p**，提示词里不要再写分辨率。
- **多张变体要换菜式状态/机位/光线**，同一段提示词重复生成只会得到近似复制品。

## 启动前询问（强制 Gate）

每次触发后、正式生成前，一次性问清：

1. **菜品品类**：精致料理/快餐/烘焙/咖啡/鸡尾酒/果汁/亚洲菜/意式/烧烤/甜品/健康轻食/街头小吃。
2. **关键瞬间（money shot）**：拉丝 / 淋汁 / 切面露出 / 蒸汽 / 酥脆碎裂 / 汤汁流动，按品类推荐。
3. **光线**：暖主光 45° / 背光显蒸汽 / 侧光显质感 / 自然窗光 / 烛光，按调性推荐。
4. **场景与背景**：木质台面 / 白盘 / 生活场景 / 深色氛围，按调性推荐。
5. **画幅**：1:1 / 3:4 / 4:3 / 16:9，默认 1:1 或 3:4。

用户说「你看着办」时，agent 按品类选推荐瞬间 + 光线 + 场景，并把采用的选择展示出来再继续。

## 画布工作流（自动搭建）

1. 用 `get_canvas_summary`、`query_canvas_nodes` 摸清现有节点与素材。
2. 用 `get_generation_config` 读真实模型与参数。
3. 用 `create_text_node` 把确认后的需求写成简报节点。
4. 用 `generate_image` 出图，`create_connection` 连链路，`create_group` 归组、`arrange_nodes` 整理。
5. 每次生成后用 `get_media_task_status` 确认；先出 1–2 张方向基准让用户确认，再沿方向批量。

## 12 类美食调性（按品类选）

| 品类 | 调性 | 关键提示词（英文） |
|---|---|---|
| 精致料理 | 优雅、艺术 | elegant plating, precise presentation, soft lighting, artistic sauce lines |
| 快餐/简餐 | 速度、过瘾 | generous portions, cheese oozing, sauce dripping, bold saturated colors |
| 烘焙/点心 | 层次、黄油香 | golden-brown lamination, flaky layers, buttery shine, fresh crumb |
| 咖啡/咖啡馆 | 仪式、温暖 | latte art, rising steam, espresso crema, warm light, condensation |
| 鸡尾酒/烈酒 | 精致、氛围 | backlit bottle, liquid color, ice detail, garnish, condensation on glass |
| 果汁/冰沙 | 活力、新鲜 | layered colors, vibrant fresh, condensation, ice detail, natural light |
| 亚洲菜（面/炒/饺子） | 镬气、热腾 | wok sizzle, steam cloud, sauce clinging, chopstick twirl, noodle drape |
| 意式/地中海 | 传统、质朴 | olive oil drizzle, fresh basil, mozzarella stretch, tomato color, wooden surface |
| 烧烤 | 烟熏、炭香 | flame kiss, char marks, backlit smoke, bark texture, pink center |
| 甜品 | 纵欲、戏剧 | chocolate shine, ganache pour, caramel drip, cream texture, sugar crystal |
| 健康轻食 | 新鲜、生机 | vibrant vegetables, fresh greens, dressing drizzle, seed scatter, water droplets |
| 街头小吃 | 能量、真实 | sauce drip, bold garnish, steam cloud, vendor skill, saturated color |

## 15 个 hero 瞬间（制造食欲的关键帧）

| 瞬间 | 提示词（英文） |
|---|---|
| 拉丝到极限 | melted cheese pulled into 12-inch stretch, backlit glow, strand at max elasticity |
| 淋汁光泽瀑布 | sauce poured and cascading, golden backlight, steam rising, pooling on plate |
| 切面露出内里 | clean cut revealing distinct interior layers, crumb detail in sharp focus |
| 倒饮冰块交互 | liquid poured over ice, color prominent, condensation forming on glass |
| 蒸汽背光发光 | hot food steaming, vapor backlit golden, steam illuminated like glowing gold |
| 食材雨落 | fresh herbs raining down onto plated food, micro-particles visible in light |
| 油淋汇池 | olive oil drizzled in slow line, pooling, sheen catching light, luxury slick |
| 巧克力流淌 | melted chocolate flowing from height, glossy surface, macro detail |
| 撕面包出蒸汽 | hands tearing fresh bread, steam releasing from warm crumb, tear texture visible |
| 水果汁爆 | fresh fruit cut, juice spurting, droplets caught mid-air, vibrant color |
| 酥脆碎裂 | fork cutting crispy exterior, shattering, creamy interior oozing, macro cut surface |
| 热锅滋滋 | protein hitting hot pan, immediate sear, color change raw to seared, oil jumping |
| 叉子穿过嫩肉 | fork through tender protein, interior revealed, juice and glaze visible |
| 糖霜滴落 | viscous glaze dripping down pastry, shine catching light, glossy finish |
| 第一口瞬间 | hands bringing food to mouth, moment before contact, sensory pleasure evident |

## 5 种美食布光（定食欲）

| 布光 | 用途 | 提示词（英文） |
|---|---|---|
| 暖主光 45° | 最通用，暖调诱人 | warm key light at 45°, golden-hour warmth, 2700–3200K, flattering for texture |
| 背光显蒸汽/光泽 | 戏剧呈现、蒸汽发光 | backlight, steam glows golden, glaze and oil become luminous, separation and depth |
| 侧光显质感 | 纹理与立体 | light grazing across surface, reveals crumb/crust/sear, shadow and highlight play |
| 自然窗光 | 新鲜健康类 | soft window light, no harsh shadows, cool-to-neutral, intimate approachable |
| 烛光氛围 | 精致晚宴/饮品 | warm intimate tungsten glow, luxury celebration mood, flatters food |

## Prompt 构造模板（喂给 Soul 2.0 用英文）

```
[菜品品类 + 调性] + [hero 瞬间] + [光线] + [背景/台面] + [机位/镜头] + [appetizing, food photography, glossy texture, macro detail]
```

## 输出规范

- 每批交付附说明：什么品类、用了什么 hero 瞬间、什么光线、为什么有食欲感；标注最推荐的一张。
- 交付前检查：蒸汽/光泽是否自然、色彩是否真实不假、质感是否到位（拉丝/酥脆/汤汁）。
- 餐饮菜单可用俯拍或 45° 角；外卖电商图突出菜品主体与诱人质感；避免死黑、避免假艳（色彩假 = 像塑料食物）。
