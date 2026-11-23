---
title: 待测试
description: 当前版本已实现但仍需人工验证的变更项
---

# 待测试

## Soul 2.0 街拍穿搭与 Soul ID

- 画布 Agent 技能列表应出现「Soul 2.0 街拍穿搭」。已有数据库不用重建：重启后端后会补上这条新 Skill，已改过的 Skill 正文不会被覆盖。升级前就已经不在库里的旧默认 Skill 不会被加回来。在管理后台删除默认 Skill 后，下次启动不会再自动加回。
- 技能说明四步流水线和模式 A / B。模式 A 用文字出多个人物基底，选定后再换装。模式 B 必须先有状态为可用的 Soul ID，主图换装成功后，用换好的主图统一其余套图的衣服。
- 图片设置在模型为 Soul 时显示 Soul ID：可列出已有角色、用已授权照片或公网 URL 训练。未勾选授权不能提交，也不会把照片传到 Higgsfield。训练请求的 `model_version` 为 `v2`。排队、训练中或失败的 Soul ID 不能选中，也不能拿去出图；训练完成后选项才会可用。
- 只有状态为已完成的 Soul ID 会进入 Soul 2.0 文生图请求的 `custom_reference_id`。强度省略时为 1；填写 0、大于 1 或无法解析的值会直接报错，不会被改成 1。请求里不会自行添加 `style_id`。
- 换装节点使用 `edit_image` 且 `clothingSwap` 为 true。提交时改走已配置的 GPT Image 或其他图片编辑模型，并带上只换服装、保持人物头发姿态机位场景光线不变的说明。没有编辑模型时会报错，不会进入 `/higgsfield-ai/soul/v2/image-to-image`。
- 场景参考图仍走 Soul image-to-image。画幅吸附、1080p、`soul/v2` 的 `batch_size` 保持原样。
- 换装后需要人工看剪裁、颜色、五金、印花和配饰。鞋、大印花、Logo 和细小配饰失败时用 Photoshop 修。

不需要在 CI 里消耗 Higgsfield 额度。请求形状、路由和 Soul ID 载荷有单元测试。

## Soul 2.0 出图质量修正

- 提交 Higgsfield 时固定带上 `resolution`：默认 `1080p`，只有请求里 quality 为 `low/720p/1.5k/fast/draft` 才降到 `720p`。此前不传该字段，上游按最低档出图，同样的提示词画面尺寸只有 1152×1536，笔画发糊。
- 画幅吸附：`size` 换算出的比例会吸附到 Higgsfield 支持的 7 档（1:1、4:3、3:4、3:2、2:3、16:9、9:16）。此前 1280×800、1440×900 之类的尺寸会换算出 8:5 等非法比例，上游直接 400。
- 张数映射：`n` / `count` 在 `soul/v2` 提交 `batch_size`（4 张），在 `soul/standard` 提交 `num_images`；`model`、`size`、`quality`、`response_format`、`n`、`count` 提交前剔除。
- 五个 Soul Skill（产品/电影感/时尚/人物/美食）新增「Soul 2.0 硬规则」：英文 60–120 词、只写正向描述、不写品牌名与真实 Logo、不堆 8K 类标签、画幅仅 7 档、多张变体必须换光位机位。
- 电影感 Skill 的 21:9 改为 16:9 出图后裁切（Soul 无 21:9 画幅，且不存在 `soul_cinematic` 模型）。
- 画布 Agent 图片 Skill 增加 Soul 2.0 专用提示词规则，生成前即约束词数与写法。

验证要点：画布图片节点默认尺寸出图应为 1536×2048（3:4）而不是 1152×1536；非标准尺寸不再报 400；同一提示词连出 4 张应是 4 个不同角度/光位。

## Soul 2.0 参考图（image-to-image）

- 画布参考图现在会走 Higgsfield image-to-image 端点（`/higgsfield-ai/soul/v2/image-to-image`），而不是被 standard 端点静默忽略。
- 后端 `handler/higgsfield.go`：参考图（multipart `image` 文件 / JSON `image`·`image_url`·`image_urls` 的 base64 dataUrl 或 http URL）会自动上传到 Higgsfield CDN（`POST /files/generate-upload-url` → 带 `upload_headers` 的 `PUT`），转成公网 `image_url`。
- 已实测闭环：本地 PNG（4.2MB）→ 上传（200）→ image-to-image（200）→ 轮询 completed → 出图成功。上传接口已确认无 2MB 限制。
- 单张参考图（Soul V2 上限 1 张）；带参考图时不设 batch_size。

验证要点：画布里给图片节点接一张摄影参考图，生成结果应体现参考图的色调/材质/光位（此前参考图完全不生效，只按文字 prompt 出图）。
