---
title: 局域网多人协作版需求文档
description: NAS 统一存储 + 角色权限 + 本地数字资产库（v0.9.0 需求草案）
---

# 局域网多人协作版需求文档

**目标版本**：v0.9.0（在 v0.8.5 基础上）
**一句话定位**：把当前"单机 / 浏览器本地为主"的画布，改造成"一台机器跑服务、多台电脑用浏览器协作、所有图片与工程文件统一落在局域网 NAS"的团队工具。

---

## 1. 现状盘点（基于当前代码）

先明确已有能力和真实缺口，避免重复开发。

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| 用户与角色 | 已有 `guest / user / admin` 三种角色，有注册、登录、LinuxDo 登录、JWT | `model/user.go`、`service/auth.go` |
| 登录墙 | **没有**。`UserAuth` 中间件在未登录时直接顶替为默认 admin 账号 | `middleware/admin.go:26-31` |
| 存储抽象 | 已有 local / S3 / WebDAV 三种 Provider，支持多 Provider 轮询、PathPrefix、容量检测、SHA256 记录 | `service/storage.go`、`model/setting.go:183-215` |
| NAS 接入 | WebDAV 已可用，且支持 `AllowPrivateNetwork` 访问内网地址（群晖场景已具备） | `service/webdav_storage.go:30` |
| 图片落盘路径 | `pathPrefix/userId/projectId-title/YYYY-MM/uuid.ext` | `service/local_storage.go:190-196` |
| 图片读取 | `GET /api/files/:id`、`/api/files/:id/content`，**无鉴权**，任何人拿到 ID 即可下载 | `router/router.go:27-32` |
| 画布工程 | 存 DB 表 `canvas_projects`（主键 userID+ID），只有 JSON 字段 `ProjectData`，不落 NAS | `model/canvas_project.go` |
| 前端持久化 | 本地优先（localforage）+ 登录后同步到服务端 | `web/src/services/image-storage.ts:60-61` |
| 资产库 | 现有 `/asset-library` 是管理员维护的**提示词素材库**，不是用户生成内容的资产库 | `web/src/app/(user)/asset-library/page.tsx` |
| 管理后台 | 已有用户、积分、AI 日志、提示词、技能、设置（含存储配置） | `web/src/app/(admin)/admin/*` |

### 结论：本版本要解决的不是"再加个存储"，而是三件事

1. **身份**：把"默认 admin 自动登录"关掉，改成真实的多用户登录体系。
2. **存储权威**：从"浏览器本地为主"改成"NAS 为唯一权威副本"，浏览器只做缓存。
3. **可见性**：从"工程只属于自己、别人完全看不到"改成"按角色和可见性分层的只读共享"。

---

## 2. 目标与非目标

### 目标

- G1 任何一台局域网电脑用浏览器打开同一地址，看到的图片和工程完全一致，不存在"图在我这台、你打不开"。
- G2 所有生成图、上传图、工程 JSON 都落在 NAS，且目录结构可读、可被群晖快照/备份直接保护。
- G3 三类角色权限清晰可执行：访客只能看公开内容；用户可读写自己的、只读别人的；管理员全权。
- G4 管理员有独立的权限管理模块，能改角色、停用、重置密码、看审计日志。
- G5 有一个真正的本地数字资产库：按作者 / 项目 / 类型 / 时间筛选，能预览、下载、引用到画布。

### 非目标（本版本不做）

- 不做实时多人同屏协作（无 CRDT / 无 WebSocket 协同光标）。
- 不做公网发布、外部分享链接、客户审片门户（放 P2）。
- 不做细到"单个节点级"的权限。
- 不做多租户（一套部署 = 一个工作室）。

---

## 3. 角色与权限矩阵

### 3.1 角色定义

| 角色 | 说明 | 取得方式 |
| --- | --- | --- |
| 访客 guest | 未登录，或管理员创建的临时账号 | 自动（未登录）/ 管理员创建 |
| 用户 user | 工作室成员，正常创作 | 管理员创建，或开放注册时自助注册 |
| 管理员 admin | 工作室负责人 / IT | 首个账号自动成为 admin；后续由 admin 指定 |

### 3.2 权限矩阵

| 能力 | 访客 | 用户 | 管理员 |
| --- | --- | --- | --- |
| 浏览公开作品（可见性=public 的项目缩略图与图片） | ✅ | ✅ | ✅ |
| 浏览团队作品（可见性=team） | ❌ | ✅ 只读 | ✅ |
| 浏览私有作品（visible=private） | ❌ | 仅自己 | ✅ 全部 |
| 打开他人画布工程 | ❌ | ✅ 只读模式 | ✅ 只读 + 可删除 |
| 新建 / 保存 / 删除自己的工程 | ❌ | ✅ | ✅ |
| 修改他人工程 | ❌ | ❌ | ❌（只能删除/转移，防误改） |
| 复制他人工程到自己名下 | ❌ | ✅ | ✅ |
| AI 生成（消耗算力/API） | ❌（可配置为限量试用） | ✅ | ✅ |
| 上传图片到 NAS | ❌ | ✅ 限自己配额 | ✅ 不限 |
| 下载他人原始图片 | ❌ | ✅ | ✅ |
| 资产库检索 / 预览 / 引用 | 仅 public | 全部团队可见范围 | 全部 |
| 用户管理（增删改、角色、停用、重置密码） | ❌ | ❌ | ✅ |
| 存储配置（NAS 地址、Provider、配额） | ❌ | ❌ | ✅ |
| 审计日志 | ❌ | 仅自己的操作 | 全部 |
| 删除他人资产 / 回收站还原 | ❌ | ❌ | ✅ |

### 3.3 可见性模型（项目级）

每个画布工程带 `visibility` 字段：

- `private`：仅作者 + 管理员可见。适合未定稿方案。
- `team`：**默认值**。团队内所有用户只读可见，只有作者可写。
- `public`：访客也可只读浏览（用于工作室作品墙）。

规则：
- 作者可随时切换自己的项目可见性（`private ↔ team ↔ public`）。
- 管理员可切换任意项目可见性（用于下架敏感内容）。
- 只读访问**永远不能写回**：只读用户打开工程后，任何保存动作必须被前端禁用 + 后端二次校验拒绝。

---

## 4. 功能需求

### 4.1 统一身份与登录（P0）

**FR-1.1** 移除默认 admin 兜底。`UserAuth` 未登录时返回 401，不再顶替 `DefaultAutoLoginUser()`。
> 改动点：`middleware/admin.go:26-31`。这是本版本第一优先级的改动，否则后面所有权限都是摆设。

**FR-1.2** 首次启动引导：库中无用户时，`/setup` 页面创建第一个管理员账号（用户名 + 密码 + 显示名）。已存在用户时该页面 403。

**FR-1.3** 登录页支持"记住我"，会话有效期默认 7 天；管理员可在设置里调整（1~30 天）。

**FR-1.4** 关闭自助注册（默认关闭）。管理员在"用户管理"里手动创建账号，创建时可选角色与初始配额。若开启注册，新用户默认角色为 `user`，状态 `active`。

**FR-1.5** 密码策略：最少 8 位；管理员可一键重置为随机密码并强制首次登录修改（P1）。

**FR-1.6** 管理员恢复通道：进程环境变量 `ADMIN_RECOVERY=1` 启动时，允许通过 CLI 子命令 `./infinite-canvas reset-password -u <name>` 重置密码。避免"忘了 admin 密码就重装"。

**FR-1.7** 同一账号可在多台电脑同时登录（局域网场景这是刚需，不做单点踢出）。

### 4.2 NAS 统一存储（P0）

#### 4.2.1 存储拓扑决策

推荐结构：

```
[群晖 NAS]  ←── SMB(首选) / WebDAV(备用) ──→  [一台常开主机: 后端服务 + DB]  ←── HTTP ──→ [多台电脑浏览器]
      ↑                                              ↓
      └──────── 图片/工程/缩略图 全部落这里          SQLite 必须放主机本地盘
```

**必须写进实施约束的三条：**

1. **SQLite 数据库绝不能放 NAS/SMB 上**（文件锁不可靠，会损坏）。DB 放主机本地 SSD；若要多实例，改用 MySQL/PostgreSQL 并单独部署。
2. **后端只跑一台**（单实例）。浏览器访问的是这台机器的 IP:端口。多实例在 P2 再讨论，需共享 DB + 纯对象存储（不能再用 local provider）。
3. **用户机器 C 盘不落任何业务数据**。默认 `data/storage` 在配置 NAS 后必须改为 NAS 挂载路径，启动时校验，若仍指向本地盘且已启用 NAS 则打印警告。

**Provider 选型建议：**

| 方案 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| SMB 挂载成盘符（如 `Z:\`）+ `local` provider | 千兆局域网直接文件 IO，大文件/视频快；实现零改动 | 依赖 Windows 服务账号持有凭据；断连时写入失败；只能单实例 | **首选**，用于棚拍大图与视频 |
| WebDAV + `webdav` provider | 跨平台、无需挂载、可跨网 | 群晖 WebDAV 小文件写放大，明显慢于 SMB | **备用/跨网**，已支持 `AllowPrivateNetwork` |
| S3（MinIO 自建） | 对象语义最干净 | 需额外部署维护 | 不推荐一人公司规模使用 |

**FR-2.1** 管理后台"存储设置"增加"NAS 预设"：填 NAS 地址 + 账号 + 根目录（如 `/volume1/canvas`），一键测试连通性并写入 Provider 列表，`PathPrefix=canvas`。

**FR-2.2** 存储模式固定为 `global`（全员共用 NAS），关闭"用户自配 WebDAV/S3"（`AllowUserProvider=false`）。理由：本地资产库要统一索引，用户各自配云存储会让索引失去意义。保留开关但默认关闭。

**FR-2.3** 上传失败必须有明确错误码与提示（NAS 不可达 / 目录无权限 / 容量超限 / 单文件超限），前端不能静默失败后把图片留在浏览器本地。

#### 4.2.2 NAS 目录规范（固定，不再随 provider 类型变化）

```
<RootPath>/canvas/
├── projects/
│   └── <userId>/<projectId>-<项目名>/
│       ├── snapshot-<yyyymmdd-HHMMSS>.json    # 工程快照
│       ├── latest.json                        # 最近一次保存（覆盖写）
│       └── images/
│           ├── <objectId>.png                 # 原图
│           └── <objectId>.webp                # 512px 缩略图
├── uploads/
│   └── <userId>/<yyyy-mm>/<objectId>.<ext>    # 手动上传的参考图/素材
├── generated/
│   └── <userId>/<yyyy-mm>/<objectId>.<ext>    # AI 生成图（不与项目绑定时）
└── trash/
    └── <yyyy-mm>/<objectId>.<ext>             # 删除的资产（保留 30 天）
```

说明：
- 目录里 `userId` 用可读形式 `<username>-<id前6位>`，便于在群晖文件管理器里直接辨认作者。
- 工程相关图片放在工程目录下，是为了"项目整个文件夹拷走就能交付客户"。
- 现有 key 生成逻辑（`service/local_storage.go:190`）需扩展：增加 `kind`（project-image / upload / generated）与可读 userId 段。

#### 4.2.3 工程文件落 NAS

**FR-2.4** 每次保存工程时，除写 DB 外，异步写一份 `latest.json` 到 NAS；每 30 分钟或每 20 次保存，另存一份带时间戳的 `snapshot-*.json`。

**FR-2.5** DB 新增字段记录 `snapshotObjectId`、`snapshotUpdatedAt`，用于校验一致性；提供管理后台"一致性检查"按钮，比对 DB 与 NAS 中工程快照差异并列出缺失项。

**FR-2.6** 图片节点必须引用 `server:<objectId>`，禁止引用浏览器本地 blob。打开工程时若遇到 `local:` 前缀的历史键，显示占位图并在资产库提供"上传本地缓存"的修复入口（见 4.6 迁移）。

#### 4.2.4 缩略图与性能

**FR-2.7** 上传时同步生成 512px 长边 WebP 缩略图，落同目录，DB 记录 `thumbnailObjectId`。资产库、团队作品页**只加载缩略图**，点开详情才拉原图。

**FR-2.8** 列表页分页 24/页，服务端返回 `total`；缩略图请求走签名 URL，可被浏览器缓存 7 天（`Cache-Control: private, max-age=604800`）。

#### 4.2.5 容量与清理

**FR-2.9** 沿用现有容量检测（`StorageCapacityCheckSetting`），增加"每用户配额"：`users.quotaBytes`，超配额时拒绝上传并提示已用/上限。

**FR-2.10** 删除资产进 `trash/`，30 天后由定时任务物理删除；管理后台可"立即清理回收站"。

**FR-2.11** 去重：上传前按 SHA256 查 `storage_objects`，命中已有对象则复用（同一张参考图被多人上传不重复占用 NAS）。

### 4.3 本地数字资产库（DAM，P0/P1）

**定义**：统一索引"用户生成的图片 / 上传的素材 / 工程快照"，与现有"提示词素材库"是两个东西。

**FR-3.1 命名整改**：现有 `/asset-library`（提示词）改名为"提示词库"，导航文案调整；新页面 `/assets` 作为"资产库"。避免用户混淆。

**FR-3.2 资产列表**：卡片瀑布流，每张显示缩略图、作者、所属项目、创建时间、尺寸、类型徽标（生成/上传/视频）。

**FR-3.3 筛选**：作者（多选）、项目（多选）、类型（图片/视频/工程快照）、来源（生成/上传）、时间范围、关键词（文件名 / 提示词 / 项目名）。

**FR-3.4 详情抽屉**：大图预览、提示词全文（生成图）、出图参数（模型 / 尺寸 / 种子）、原始文件下载、"引用到当前画布"、"复制到我的资产"。

**FR-3.5 权限落地**：列表只返回当前用户有权查看的资产（SQL 层过滤，不靠前端隐藏）。他人资产只能下载/引用，不能删除。

**FR-3.6 引用语义**：把他人图片拖进自己画布时，创建**引用型节点**（指向原 objectId），不复制文件；原作者删除时，引用节点显示"源文件已删除"而非崩坏。

**FR-3.7 批量操作**（P1）：多选下载（打包 zip）、批量打标签、批量移动到项目。

### 4.4 他人画布只读浏览（P0）

**FR-4.1 团队作品页 `/team`**：按更新时间倒序的工程卡片（缩略图 = 工程内最新/最大图片，或用户手动设定的封面），显示作者、更新时间、节点数、可见性徽标。

**FR-4.2 打开他人工程**：进入画布后顶部显示只读横幅"只读浏览 · 作者：XXX · 更新于 …"，隐藏所有生成 / 编辑 / 保存 / 删除入口（含快捷键拦截）。

**FR-4.3 复制到我的**：一键创建副本（新 projectId，`userId=自己`，`copiedFrom=<原ID>`），复制后立即可编辑。副本与原工程完全独立。

**FR-4.4 后端强校验**：`POST /api/v1/canvas/projects` 中若 `project.userId != 当前用户` 且非新建，直接 403。不能只靠前端隐藏按钮。

**FR-4.5 乐观锁**：工程表增加 `version` 字段，保存时带 `version`，不匹配返回 409 + 提示"该工程已在其他窗口被修改，请刷新"。防同一人两台电脑同时改同一工程导致覆盖。

### 4.5 管理员模块（P0/P1）

**FR-5.1 用户管理增强**（现有页面 `/admin/users` 扩展）：
- 列表列：用户名、显示名、角色、状态、已用空间/配额、最近登录、创建时间。
- 操作：新建、改角色（访客/用户/管理员）、停用/启用、重置密码（生成随机密码并一次性展示）、设置配额、删除（软删，禁用登录但保留资产）。
- 批量：批量停用、批量改角色。

**FR-5.2 存储管理页**：
- NAS 连接配置 + 连通性测试 + 写入/读取/删除三项自检。
- 容量仪表：总容量、已用、各用户占用 Top 10。
- 一致性检查：DB 索引 vs NAS 实际文件差异。

**FR-5.3 资产治理**：全部资产列表（含他人私有），可删除/还原/改可见性；孤儿文件扫描（NAS 有文件但 DB 无记录，反之亦然）。

**FR-5.4 审计日志**（P1）：记录登录、创建/删除用户、改角色、删除资产、改可见性、重置密码，字段 `actorId / action / targetType / targetId / ip / createdAt`，保留 180 天。

**FR-5.5 系统设置**：会话有效期、是否允许注册、访客是否可浏览 public 作品、单用户默认配额、回收站保留天数。

### 4.6 迁移与兼容（P0，一次性）

**FR-6.1** 现有 `data/storage` 下的历史文件（按旧 key 结构）保持可读：`/api/files/:id/content` 继续支持旧 `objectKey`；提供后台"迁移到新目录结构"任务（移动文件 + 更新 objectKey），迁移期间可回滚（只改 DB，不动文件）。

**FR-6.2** 浏览器 localforage 里未上传的图片：登录后进入资产库时提示"检测到 N 张本地图片未同步到 NAS"，提供一键上传（带进度、失败重试、去重）。

**FR-6.3** 现有 `canvas_projects.projectData` 中的 `local:` 图片键，在打开工程时按 FR-2.6 处理，不阻塞打开。

**FR-6.4** 现有账户（含默认 admin）在升级后首启动强制走 `/setup` 或改密流程，不允许继续用默认密码。

---

## 5. 数据模型变更

> 按 `AGENTS.md` 约定：项目未上线，直接改表结构，不写兼容迁移逻辑（4.6 的数据迁移是业务工具，不是 schema 兼容）。

### 5.1 `users`（扩展）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| role | string | 已有：guest/user/admin |
| status | string | 已有：active/ban |
| quotaBytes | int64 | 新增，0 = 不限 |
| usedBytes | int64 | 新增，冗余统计，定时校准 |
| mustChangePassword | bool | 新增，P1 使用 |
| lastActiveAt | string | 新增，最近一次操作时间（区别于 lastLoginAt） |

### 5.2 `canvas_projects`（扩展）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| userId | string | 已有 |
| id | string | 已有 |
| title | string | 新增，项目名（NAS 目录与列表展示用） |
| visibility | string | 新增，private/team/public，默认 team |
| coverObjectId | string | 新增，封面图 |
| snapshotObjectId | string | 新增，最近快照 |
| snapshotUpdatedAt | string | 新增 |
| version | int | 新增，乐观锁 |
| nodeCount | int | 新增，列表展示 |
| bytes | int64 | 新增，工程占用（含图片合计） |
| projectData | text | 已有 |
| deletedAt | string | 已有，软删 |

### 5.3 `storage_objects`（扩展）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| kind | string | 新增：project-image / upload / generated / snapshot / thumbnail / video |
| projectId | string | 新增，索引 |
| visibility | string | 新增，继承项目或独立设置（上传素材默认 team） |
| prompt | text | 新增，生成图的提示词（资产库搜索用） |
| model | string | 新增，生成模型 |
| width / height | int | 已有 |
| sha256 | string | 已有，去重用，加索引 |
| deletedAt | string | 已有，回收站 |

### 5.4 新增 `audit_logs`

```
id, actorId, actorName, action, targetType, targetId, detail(text), ip, createdAt
```

---

## 6. 接口清单（约定：`{code,data,msg}`）

### 6.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/bootstrap` | 是否已初始化（无用户则 true） |
| POST | `/api/auth/setup` | 首次创建管理员 |
| POST | `/api/auth/login` | 登录（现有，补 rememberMe） |
| POST | `/api/auth/logout` | 清 cookie |
| GET | `/api/auth/me` | 当前用户 + 权限能力集 |
| POST | `/api/auth/change-password` | 自助改密 |

### 6.2 工程与团队浏览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/canvas/projects?scope=mine\|team\|all&userId=&keyword=&page=` | 列表，`scope` 决定权限过滤 |
| GET | `/api/v1/canvas/projects/:id` | 详情，返回 `projectData` + `readonly` + `owner` |
| POST | `/api/v1/canvas/projects` | 保存（校验 owner + version，冲突 409） |
| POST | `/api/v1/canvas/projects/:id/copy` | 复制到我的 |
| PATCH | `/api/v1/canvas/projects/:id` | 改标题 / 可见性 / 封面 |
| DELETE | `/api/v1/canvas/projects/:id` | 软删（作者或 admin） |

### 6.3 资产库

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/assets?author=&project=&kind=&source=&from=&to=&keyword=&page=` | 分页检索（SQL 级权限过滤） |
| GET | `/api/v1/assets/:id` | 详情（含提示词、参数） |
| GET | `/api/v1/assets/:id/download` | 原图下载（签名 URL，记录审计） |
| GET | `/api/v1/assets/stats` | 当前用户已用空间 / 配额 |
| POST | `/api/v1/assets/batch-tag` | 批量打标签（P1） |

### 6.4 文件访问（改造：加鉴权）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/files/:id` | 元信息（需登录 + 权限校验） |
| GET | `/api/files/:id/content?exp=&sig=` | 内容。签名由服务端用 HMAC(JWTSecret, id+exp+userId) 生成，有效期 15 分钟；无签名则退回校验 Cookie/Token |
| GET | `/api/thumb/:id` | 缩略图，签名同上 |

> 现状是 `/api/files/:id` 挂在无鉴权的 `api` 组（`router/router.go:27-32`），必须迁移到鉴权组。设计判断：`<img src>` 无法带 Authorization 头，所以用短时签名 URL，而不是让前端 fetch 转 blob（后者会让瀑布流卡顿）。

### 6.5 管理后台

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/admin/users` | 已有，补 quota/role 校验 |
| PATCH | `/api/admin/users/:id/role` | 改角色（禁止把最后一个 admin 降级） |
| PATCH | `/api/admin/users/:id/status` | 停用/启用 |
| POST | `/api/admin/users/:id/reset-password` | 重置密码 |
| GET | `/api/admin/storage/health` | NAS 读/写/删三项自检 |
| GET | `/api/admin/storage/usage` | 容量 + Top 用户 |
| POST | `/api/admin/storage/consistency-check` | DB 与 NAS 差异 |
| GET | `/api/admin/audit-logs` | 审计日志分页 |
| GET/DELETE | `/api/admin/assets` | 全量资产治理 |

---

## 7. 前端页面与交互

| 页面 | 路由 | 要点 |
| --- | --- | --- |
| 首次初始化 | `/setup` | 无用户时自动跳转；创建管理员 |
| 登录 | `/login` | 现有页面改造：去掉自动进入画布，补"记住我" |
| 团队作品 | `/team` | 工程卡片瀑布流 + 作者/时间筛选 + 可见性徽标 |
| 画布（只读） | `/canvas/:id?mode=readonly` | 顶部只读横幅、隐藏编辑入口、禁用快捷键、"复制到我的"主按钮 |
| 资产库 | `/assets` | 筛选栏 + 瀑布流 + 详情抽屉 + 引用/下载 |
| 提示词库 | `/asset-library`（改名） | 现有页面，文案改为"提示词库" |
| 用户管理 | `/admin/users` | 扩展配额、角色下拉、重置密码、停用 |
| 存储管理 | `/admin/storage` | NAS 配置向导 + 自检 + 容量仪表 + 一致性检查 |
| 审计日志 | `/admin/audit` | 表格 + 筛选 |
| 个人设置 | `/settings/profile` | 改密、查看自己的空间占用 |

**交互原则**（延续 `AGENTS.md` 画布规范）：
- 只读模式不做"半可用"：不能点但看起来能点的按钮一律隐藏，不留灰按钮。
- 大图预览用现有 Modal 风格；列表懒加载，滚动到视口再请求缩略图。
- 所有失败（NAS 断连、配额满、无权限）给出中文明确提示 + 下一步动作（如"检查 NAS 连接"）。

---

## 8. 关键流程

### 8.1 生成一张图并落 NAS

```
前端点生成 → 后端调模型 → 拿到图片二进制
  → 计算 SHA256（去重查 storage_objects）
  → 写 NAS: projects/<user>/<project>/images/<oid>.png
  → 生成缩略图 <oid>.webp
  → 插 storage_objects（kind=project-image, projectId, prompt, model）
  → 返回 { objectId, url: /api/files/<oid>/content?sig=... }
→ 前端写入图片节点 storageKey=server:<oid>
```

失败处理：NAS 写入失败 → 任务标记 `storage_failed`，保留上游临时 URL 并在画布节点上标黄提示，30 分钟内可重试。

### 8.2 保存工程

```
保存 → DB 写入（version+1）
     → 异步写 NAS latest.json（失败入重试队列，指数退避 3 次）
     → 每 30min 落一份快照
```

### 8.3 打开他人工程（只读）

```
GET /projects/:id → 校验：owner=自己 或 visibility∈{team,public} 或 admin
→ 返回 projectData + readonly=true + owner 信息
→ 前端只读模式；图片 URL 重新签名（不复用他人会话的签名）
```

---

## 9. 非功能需求

| 项 | 要求 |
| --- | --- |
| 内网性能 | 团队作品页首屏 < 1.5s（20 张缩略图）；画布打开 100 节点工程 < 3s |
| 并发 | 10 人同时在线、3 人同时保存，不出现数据错乱（乐观锁兜底） |
| 存储安全 | 所有 NAS 路径必须经过越界校验（已有 `localObjectFilePath` 防御，保持）；WebDAV 凭据仅服务端持有，绝不下发前端 |
| 访问控制 | 任何文件/工程/资产接口都必须服务端校验，禁止"前端隐藏即安全" |
| 可用性 | NAS 断连时：已打开的画布可继续编辑并本地暂存，恢复后提示"有 N 项待同步"，不丢数据 |
| 备份 | 依赖群晖 Snapshot + Hyper Backup（NAS 端，每日）；应用层每日导出 `projects/*/latest.json` 到 `backup/` |
| 磁盘 | 主机本地盘只放 DB + 日志，不存业务文件；启动时对 `data/storage` 指向本地盘的情况给出警告 |
| 审计 | 删除、改角色、下载原图必须留痕（P1） |

---

## 10. 分期计划

### P0（本版本必须，约 6~8 个工作日）

1. 关闭默认 admin 兜底 + `/setup` 初始化 + 登录墙（FR-1.1~1.4）
2. NAS Provider 配置 + 目录规范 + 上传/读取链路打通（FR-2.1~2.3）
3. 文件接口鉴权改造（签名 URL）（6.4）
4. 工程快照落 NAS + `latest.json`（FR-2.4）
5. 团队作品页 + 只读画布 + 复制到我的（FR-4.1~4.4）
6. 资产库基础版（列表/筛选/预览/下载/引用）（FR-3.2~3.6）
7. 用户管理增强（角色/状态/配额/重置密码）（FR-5.1）

### P1（下一迭代）

缩略图与性能优化、乐观锁、审计日志、容量配额与回收站、一致性检查、批量操作、改密流程、资产治理页。

### P2（视情况）

项目成员级授权、评论批注、客户审片外链、实时协作、多实例部署、手机端浏览。

---

## 11. 验收标准

**存储与多机一致性**
- [ ] A 电脑生成 5 张图，B 电脑登录同一地址，在资产库与对应工程中能立即看到这 5 张，且能下载原图。
- [ ] 断开 NAS 后上传，界面明确提示失败原因；恢复后重试成功，不留半截文件。
- [ ] NAS 上能按 `<userId>/<projectId>-<名称>/` 找到工程目录，直接用文件管理器拷走可交付。

**权限**
- [ ] 未登录访问任何 `/api/v1/**` 返回 401，不再自动获得 admin。
- [ ] 用户 U1 打开 U2 的 team 工程：可看、不能改、无保存入口；直接调用保存接口返回 403。
- [ ] 用户无法看到他人 `private` 工程的任何入口（列表、搜索、直接 URL 均拒绝）。
- [ ] 最后一个管理员不可被降级或停用。
- [ ] 访客只能看到 `public` 项目，看不到工程数据接口。

**资产库**
- [ ] 按作者、项目、时间、类型四个维度组合筛选结果正确。
- [ ] 他人资产可下载、可引用到画布，但不能删除。
- [ ] 瀑布流 24 张缩略图总请求体积 < 2MB。

**工程**
- [ ] 两台电脑同时编辑同一工程，后保存者收到 409 提示而不是静默覆盖。
- [ ] 复制他人的工程后可自由编辑，原工程不受影响。

---

## 12. 环境实测与部署前置（2026-11-23 实测）

**当前局域网实测结果：**

| 项 | 实测值 |
| --- | --- |
| 网段 | `192.168.31.0/24`，网关 `192.168.31.1`（小米路由器，MAC `50:4f:3b:13:e3:0f`） |
| 开发主机 | `192.168.31.68`（网线，千兆） |
| 在线设备 | 18 台（含 2 台 Apple TV/HomePod 占用 5000 端口，易误判为 DSM） |
| 群晖 NAS | **未发现**：全网段 5000/5001/5005/5006/6690 无响应，ARP 表无群晖 OUI（`00:11:32` / `90:09:D0`），SSDP 与 mDNS 无回应 |

**结论：NAS 目前不在这张网上，或未完成 DSM 初始化。本版本实施前必须先解决这一项。**

**上线前置条件（按顺序）：**

1. NAS 开机并通过 `find.synology.com` 或 Synology Assistant 完成 DSM 安装，在路由器里做 **DHCP 静态保留**（固定 IP，避免存储配置失效）。
2. 创建专用账号 `canvas`（只给目标共享文件夹的读写权限，不给管理员权限）；服务端只用这个账号，不用 admin 账号。
3. 建共享文件夹 `canvas`，开启 SMB（SMB3，最低 SMB2）；若用 WebDAV 方案再启用 WebDAV Server 套件。
4. 共享文件夹开启"回收站"（双保险，应用层已有 `trash/`）。
5. 主机挂载为盘符（如 `Z:`），并在 Windows 服务账号下保存凭据（`cmdkey /add`），否则服务重启后挂载失效。
6. NAS 与主机接同一台路由器/交换机，走千兆口；NAS 设不休眠（硬盘休眠会导致首次访问 3~5s 抖动）。

**型号分支（DS220 有两个版本，方案不同）：**

| 型号 | 硬件 | 能力 | 对方案的影响 |
| --- | --- | --- | --- |
| DS220j | ARM RTD1296 / 512MB | 不支持 Docker，文件系统 ext4（无 Btrfs 快照） | 后端必须留在 Windows 主机；NAS 只做 SMB 文件存储；备份靠 Hyper Backup 定时任务，不能靠快照 |
| DS220+ | Intel J4025 / 2GB（可扩 6GB） | 支持 Container Manager（Docker）、Btrfs、快照 | 后端可容器化搬到 NAS；推荐顺手扩内存到 6GB；可用 Snapshot Replication 做工程 JSON 历史版本 |

> 不论哪个型号，**SQLite 都不放 NAS**（SMB 上 SQLite 文件锁不可靠，会损坏库）。DB 放主机本地盘（建议 `D:`，主机 C 盘只剩 14G）。

---

## 13. 风险与待确认

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 关掉默认 admin 后无人知道密码 | 团队当天无法工作 | 上线前用 `/setup` 建两个 admin 账号；保留 `ADMIN_RECOVERY` 命令 |
| NAS 走 WebDAV 慢（群晖小文件多） | 生成图入库慢、瀑布流卡 | 默认推 SMB 挂载 + local provider；WebDAV 仅备用 |
| 大视频文件（MiniMax/H3 输出）经 WebDAV 写入超时 | 任务失败 | 视频单独走 SMB 路径，或调大超时到 15 分钟并支持分片 |
| 历史 localforage 图片未同步 | 老工程在图缺失 | FR-6.2 一键上传工具 + 打开时占位提示 |
| 主机休眠/重启导致服务中断 | 全员不能用 | 主机设不休眠；用计划任务开机自启（现有 `launch.ps1` 扩展） |

**待确认（需要用户拍板）**

1. NAS 品牌型号与协议：群晖（WebDAV/SMB）？QNAP？是否有 Docker 可跑 MinIO？
2. 后端服务主机是否就是现在这台 Windows（C 盘仅剩 14G）？是否需要迁到 NAS 上跑 Docker？
3. 用户量级：大概几个人同时用？是否需要"访客"实际使用，还是只留角色占位？
4. 图片/工程是否需要对外（客户）出链接？影响 P2 是否提前。
5. 生成图是否全部永久保留，还是按项目结项后归档/清理（影响容量规划）。

---

## 14. 改动清单（给实现用的文件级地图）

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 中间件 | `middleware/admin.go` | 删除默认 admin 兜底；新增 `RequireRole`、`ProjectAccess` |
| 认证 | `service/auth.go`、`handler/auth.go` | 新增 setup / bootstrap / change-password |
| 存储 | `service/storage.go`、`service/local_storage.go`、`service/webdav_storage.go` | 目录规范扩展（kind + 可读 userId）、缩略图、去重、签名 URL |
| 工程 | `model/canvas_project.go`、`service/canvas_project.go`、`handler/canvas_project.go` | 新增 title/visibility/version/snapshot 字段；scope 过滤；copy 接口；快照落盘 |
| 资产 | `model/asset.go`（或新 `model/digital_asset.go`）、`service/assets.go` | 区分"提示词素材"与"数字资产"，新表/新字段与检索 |
| 路由 | `router/router.go` | 文件接口迁入鉴权组；新增 team/assets/admin 路由 |
| 前端 | `web/src/app/(user)/team/`、`assets/`、`canvas/[id]/` | 新增页面与只读模式 |
| 前端 | `web/src/services/image-storage.ts` | 强制 server 模式；去掉跨机失效的本地 blob 依赖 |
| 前端 | `web/src/app/(admin)/admin/users|storage|audit/` | 扩展管理功能 |
| 文档 | `docs/backend/backend-database.md`、`docs/overview/features.md`、`docs/progress/*` | 按 `AGENTS.md` 同步更新 |
