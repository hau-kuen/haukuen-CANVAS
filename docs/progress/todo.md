---
title: TODO
description: 当前项目后续值得处理的事项
---

# TODO

本文档用来记录当前项目后续比较值得处理的事项。

街拍穿搭这一轮里，授权上传时序、未完成 Soul ID、升级误恢复已删 Skill、强度被改成 1，都已改完。还需要人工点选确认的步骤记在待测试，这里不另开开发待办。

## v0.9.0 局域网多人协作版（进行中）

- 需求文档：`docs/business/lan-multiuser-dam.md`（14 章，含角色矩阵/接口清单/改动清单）
- 前置测试报告：`docs/business/lan-nas-preflight.md`（NAS 已打通）
- NAS 状态：DS220j / DSM 6.2.3，IP `192.168.2.200`，共享 `canvas` 挂载 `Z:`（账号 canvas），千兆 111 MB/s
- 挂载脚本：`scripts/setup-nas.ps1`（已实测通过）

### P0 待办（按依赖顺序）

1. **关默认 admin 后门**：`middleware/admin.go:26-31` 未登录自动顶替 admin，改为返回 401（权限系统地基，最先做）。
2. 首次初始化 `/setup` 创建管理员 + 登录墙（FR-1.1~1.4）。
3. ~~文件接口鉴权~~ **已完成（默认关闭）**：`/api/files/:id/content` 支持 `?exp=&sig=` 短时签名；新增 `GET /api/files/:id/signed?ttl=`；开关 `SIGNED_URL_REQUIRED=true` 后无签名一律 401。默认 false，存量画布直链不受影响。前端「只存 id、渲染时换签名」待登录墙（第 1、2 项）落地后一起改。
4. 工程快照落 NAS：`canvas_projects` 增加 title/visibility/version/snapshot 字段；保存时写 `latest.json` + 定时快照。
5. 团队作品页 `/team` + 只读画布模式 +「复制到我的」（FR-4.1~4.4）。
6. 资产库基础版 `/assets`：列表/筛选/预览/下载/引用（FR-3.2~3.6）。
7. 用户管理增强：角色/状态/配额/重置密码（FR-5.1）。

### 存储接入要点（改后端时注意）

- 后端 local provider 指向 `Z:\`（RootPath），目录骨架已建：`projects/ uploads/ generated/ trash/ _meta/`。
- SQLite 留本地盘，**不放 NAS**（SMB 文件锁会损坏库）。
- 前端 `image-storage.ts` 改为 server 权威、localforage 仅缓存，去掉跨机失效的本地 blob 依赖。
- 只读访问永远不能写回：前端禁用 + 后端二次校验（`POST /api/v1/canvas/projects` 校验 owner）。

### P1（后续）

缩略图性能、乐观锁、审计日志、容量配额、回收站清理、一致性检查。

## 本地定制：API 配置简化（勿被上游覆盖）

- 新增 `web/src/lib/channel-quick-config.ts`：黏贴文本 → 自动识别服务商/协议/baseUrl/key（支持 URL|KEY、export 行、JSON、裸域名、本地地址）。
- 新增 `web/src/components/layout/channel-quick-setup.tsx`：服务商卡片选择器 + 黏贴即配置弹窗。
- 改 `app-config-modal.tsx`：渠道行默认折叠成一行摘要（协议/名称/模型数/Key 状态/测试/选择/展开/删除），新增「黏贴配置」「新增渠道」「备份/恢复」入口，添加后自动拉模型。
- 新增 `web/src/lib/config-backup.ts` + `web/src/components/layout/config-backup-panel.tsx`：API 配置备份与恢复。导出 JSON 文件（ASCII 文件名 `canvas-api-backup-YYYYMMDD-HHmm.json`）、复制 JSON、粘贴/选文件导入、本机自动快照（localStorage `infinite-canvas:api-config-snapshots`，最多 8 份，内容相同只刷新时间）。恢复前自动给当前配置留快照，可退回；导入兼容本功能导出格式、裸渠道数组、旧版 `{state:{config:{localChannels}}}`。
- 改 `client-root-init.tsx`：订阅 configStore，渠道/Key/选型变化 1.5s 防抖后写快照，清缓存或换版本后可退回。
- 拉上游后冲突点就在 `app-config-modal.tsx` 的渠道列表区块，参考本地版本重新合并。

## 上游整合记录

- 2026-11-23 合并 PR #2 `cursor/canvas-agent-skill-discovery-084d`（grokbot 做的画布 Agent 按需加载 Skill）：10 文件 +567/-30，零冲突。新增 `canvas-agent-skill-catalog.ts` + 测试（bun test 8 pass），改 `canvas-agent-runtime.ts`、`canvas-agent-skills.ts`、`canvas-agent-tools.ts`、`skills/core.ts`、`use-codex-agent.ts`、`canvas-assistant-panel.tsx`。与本地 API 配置改动无文件重叠。
- 升级前备份放 `data/backups/20261123-2351-api-pre-upgrade/`（DB 快照 + .env + Chrome localStorage 原始 .ldb + 导出 JSON），说明见该目录 README.md。
- 新增 `scripts/extract-chrome-localstorage.py`：解析 Chrome/Edge 的 Local Storage LevelDB（自带 snappy 解压），把 localStorage 导出成 JSON，用于升级前后核对 API 渠道是否还在。渠道真实存放位置是 `infinite-canvas:ai_config_store` → `state.config.localChannels`，不在后端库。
