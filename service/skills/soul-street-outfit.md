---
name: Soul 2.0 街拍穿搭
description: |
  把一套街拍穿搭做成可挑选的出图流水线。先用文字定下穿搭，再用 Higgsfield Soul 2.0 生成人物与场景基底，然后用图片编辑模型只换服装，最后对照服装参考检查并让用户挑选。支持两种模式：不同人物与场景穿同一件衣服，或用 Soul ID 固定同一个模特拍一整套动作。适合街拍、lookbook 套图和服装替换，不负责视频。
metadata:
  trigger-words: [街拍, 穿搭, 换装, Soul ID, 街拍穿搭, lookbook 套图, 服装替换, street fashion]
---

# Soul 2.0 街拍穿搭

这条流水线把「定穿搭」和「换上真实衣服」拆开。Soul 2.0 负责人物、场景和照片感；服装替换交给图片编辑模型。不要把服装图交给 Soul image-to-image，那条链路会把参考图当成场景和构图，不能稳定地只换衣服。

DeepSeek 只能写提示词或看图提意见，不能生图，也不能改图。

## 四步

1. **先用文字定穿搭。** 此时不要上传服装图。写成可拍摄的英文描述：单品、廓形、材质、颜色、配饰。不写品牌名和真实 Logo。
2. **用 Higgsfield Soul 2.0 出人物 + 场景基底。** 只提交文字。模式 B 另加已完成的 Soul ID。
3. **用图片编辑模型换装。** 调用 `edit_image`，并设置 `clothingSwap: true`。基底图是要保留的人，服装节点是衣服参考。提示词必须写明：只替换服装，人物、头发、姿态、机位、场景和光线都保持不变。
4. **对照服装参考检查，让用户挑。** 看剪裁、颜色、五金、印花和配饰。鞋、大面积印花、Logo 和细小配饰经常失败，需要时告诉用户用 Photoshop 修。

## 启动前询问

用户没说明模式时，先问是 A 还是 B，不要直接出图。

同时收齐这些信息；用户说「你看着办」时，按下面的默认值执行，并把采用的选择写进简报：

1. **模式**：A 不同人物和场景、同一件衣服；B 同一个模特、同一个场景、一整套动作。
2. **穿搭方向**：上装、下装、鞋、外套、包和配饰。默认一套松弛的城市街头层次，颜色不超过三种。
3. **人物**：模式 A 要年龄感、气质和几位不同的人；模式 B 必须先有 Soul ID。
4. **场景**：默认白天城市人行道，有真实背景，不要影棚无缝纸。
5. **动作 / 表情**：朋友随手拍，放松、不对称、表情自然，衣服或头发可以有一点运动。
6. **机位与景别**：默认竖幅 3:4。模式 B 再在全身、半身、坐姿、自拍之间变化。

## Soul 2.0 硬规则

生成前用 `get_generation_config` 读真实模型。Soul 2.0 使用 `higgsfield-ai/soul/v2/standard`。提示词用英文，60–120 词。一个维度一句：人物与穿搭、场景、光线、机位。只写画面里有什么。不写品牌、型号、真实 Logo。不堆 `8K`、`masterpiece`、`ultra detailed`。画幅只有 1:1、4:3、3:4、3:2、2:3、16:9、9:16。清晰度由画布提交 1080p，提示词里不写分辨率。多张图必须换动作、表情、机位或景别。

每条 Soul 提示词以这句结尾：`Vertical 3:4, no interface, caption or watermark.`

不要编造 `style_id` 或 Moodboard UUID。

## Soul ID（只用于模式 B）

模式 B 在出基底之前必须有一个状态为 `completed` 的 Soul ID。画布图片设置里可以列出现有 Soul ID、查看训练状态，或用已授权的多角度照片开始训练。训练请求的 `model_version` 必须是 `v2`。官方通常需要 20 张以上、多角度、公网可访问的照片。没有人物授权时不要训练，也不要用用户没确认的照片。

生成时把 `soulId` 传给 `generate_image`。强度 `soulStrength` 取 (0, 1]，不要传 0；用户没指定时用 1。后端会写成 `custom_reference_id` 和 `custom_reference_strength`。`get_generation_config` 会返回当前选中的 `soulId`。模式 A 不要传 `soulId`，这样才会是不同的人。

## 模式 A：不同的人，同一件衣服

1. 写一份穿搭简报。
2. 用 `generate_image` 出 3 张以上人物 + 场景基底。只传文字，不连服装图，不传 `soulId`。每张换人、换场景或换动作。
3. 等用户选定要继续的基底。
4. 把服装参考放进画布，但不要拿去跑 Soul。
5. 对每张选中的基底调用 `edit_image`：`sourceNodeIds` 先是基底、后是服装图，`clothingSwap: true`。编辑模型由画布从已配置的 GPT Image 或其他编辑模型里选择，不会改走 Soul image-to-image。

## 模式 B：同一个模特，一整套

1. 没有可用 Soul ID 就停下来，请用户在图片设置里选一个已完成的，或先训练。
2. 穿搭、发型和场景写成固定描述。只变化动作、表情、机位和景别，例如全身走路、半身回头、坐下、自拍。
3. 用 `generate_image` 出一套基底，每张都传同一个 `soulId`，不上传服装图。先出一张主图，再出其余景别。
4. 先只换主图：`edit_image` + `clothingSwap: true`，来源是主图和服装参考。
5. 主图换装结果确认后，用它做服装统一参考，给其余基底逐张换装。`sourceNodeIds` 顺序是：该张基底、已换好的主图。提示词写明衣服以图片 2 的上装、下装、鞋和配饰为准，人物、头发、姿态、机位、场景和光线仍以图片 1 为准。

## 换装提示词

英文，并且包含这句：

`Only replace the clothing with the garment reference. Keep the person, hair, pose, camera, scene, and lighting unchanged.`

`clothingSwap` 只能出现在 `edit_image`。不要用 `generate_image` 带服装图去换装。

## 画布节点

按这个结构搭建，并连线、分组：

- 文本节点「穿搭简报」：模式、人物、场景、穿搭、机位。
- 分组「基底图」：模式 A 的多人物基底，或模式 B 的同一模特套图。`generate_image` 的 `sourceNodeIds` 放简报节点，由工具建立连线。
- 图片节点「服装参考」：用户提供的衣服。换装时作为 `edit_image` 的来源，不要拿去跑 Soul。
- 分组「换装结果」：`edit_image` 的 `sourceNodeIds` 按「基底、服装参考」排列。模式 B 统一其余图片时，顺序是「该张基底、已换装主图」。

用 `create_text_node`、`generate_image`、`edit_image`、`create_group`、`arrange_nodes`。同一对节点不要再额外 `create_connection`。生成后用 `get_media_task_status` 看结果，再请用户挑选，不要一次换完整套却不给确认点。

## 提示词骨架

```
A candid street photo taken by a friend, relaxed asymmetrical pose, natural expression, clothes and hair slightly in motion, small real-world imperfections kept. [person], [outfit in plain words], [scene and daylight], [camera distance and angle]. Vertical 3:4, no interface, caption or watermark.
```

模式 B 的变体只替换动作、表情、机位和景别，穿搭、发型和场景句子保持同一套词。
