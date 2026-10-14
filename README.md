# 微课堂 MicroClass

> 面向班级/机构的企业级轻量学习平台：**课程 → 章节 → 课时**、题库与考试、学习进度与错题本。
> 技术栈：TypeScript + Fastify + SQLite（后端） / Vue3 + Vite + TS（前端，构建中） / 三端交付（本地 · Docker · fnOS FPK）。

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## 快速开始

```bash
# 1) 依赖（Node ≥ 22.5）
npm install

# 2) 数据库迁移（首次自动创建；兼容 V1 的 data/microclass.db）
npm run migrate

# 3) 开发模式（热重载）
npm run dev            # API: http://127.0.0.1:8091/api/v1

# 4) 质量门禁
npm run format:check && npm run lint && npm run typecheck && npm run test
```

首次启动会用 `MC_ADMIN_USER` / `MC_ADMIN_PASS`（默认 `admin` / `admin123`）引导创建管理员，请在正式环境立即修改。

## 目录结构

```
apps/api         后端服务（分层：routes → services → repositories → db）
apps/web         前端应用（Vue3 + Vite + TS）
packages/shared  前后端共享类型 / 常量 / 错误码
db/migrations    编号 SQL 迁移（schema_migrations 版本表 + 校验和防漂移）
ops              部署与运维（Docker/Compose/FPK/备份）
docs             架构 / API / 部署 / 运维 / 安全 / 发布 / 使用说明
```

## 常用命令

| 命令                                                    | 说明                                  |
| ------------------------------------------------------- | ------------------------------------- |
| `npm run dev`                                           | 启动 API（tsx watch）                 |
| `npm run dev:web`                                       | 启动前端 dev server（Vite，代理 API） |
| `npm run build`                                         | 构建 shared → api → web               |
| `npm run typecheck` / `npm run lint` / `npm run format` | 类型/规范/格式化                      |
| `npm run test` / `npm run test:coverage`                | 单元与集成测试 / 覆盖率门禁           |
| `npm run test:e2e`                                      | Playwright 端到端测试（需先 build）   |
| `npm run migrate`                                       | 执行数据库迁移                        |
| `npm run backup` / `npm run restore`                    | 数据备份 / 恢复（一致性快照）         |
| `npm start`                                             | 生产模式启动（需先 build）            |

## 配置（环境变量）

| 变量                                         | 默认                 | 说明                                                                         |
| -------------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `MC_ENV`                                     | `development`        | `development` / `test` / `production`                                        |
| `MC_HOST` / `MC_PORT`                        | `0.0.0.0` / `8091`   | 监听地址与端口                                                               |
| `MC_SITE_NAME`                               | `微课堂`             | 站点名称                                                                     |
| `MC_DATA_DIR`                                | `./data`             | 数据目录（SQLite、上传、会话密钥）                                           |
| `MC_MIGRATIONS_DIR`                          | `./db/migrations`    | 迁移 SQL 目录                                                                |
| `MC_ADMIN_USER` / `MC_ADMIN_PASS`            | `admin` / `admin123` | 首次引导管理员（已存在则不覆盖）                                             |
| `MC_ALLOW_REGISTER`                          | `true`               | 是否开放学生自助注册                                                         |
| `MC_MEDIA_ROOTS`                             | 空                   | 媒体根目录 JSON 数组：`[{"id":"java","name":"Java课","path":"/media/java"}]` |
| `MC_MAX_UPLOAD_MB`                           | `50`                 | 附件/图片上传大小上限                                                        |
| `MC_MAX_VIDEO_MB`                            | `2048`               | 单个视频上传上限（MB，网页直接上传用）                                       |
| `MC_FFPROBE_PATH` / `MC_FFMPEG_PATH`         | 自动探测             | ffprobe/ffmpeg 路径；缺失则跳过「时长/封面」抽取                             |
| `MC_RATE_LIMIT_MAX` / `MC_RATE_LIMIT_WINDOW` | `300` / `1 minute`   | 限流                                                                         |
| `MC_TRUST_PROXY`                             | `true`               | 反代场景下信任 `X-Forwarded-*`                                               |
| `MC_ALLOWED_ORIGINS`                         | 空                   | 允许的跨站 Origin（逗号分隔）；同源请求自动放行，跨站写请求一律 403          |
| `MC_CSP`                                     | `false`              | 设为 `1` 时下发严格 CSP（反代已下发 CSP 时保持关闭）                         |
| `MC_LOG_LEVEL`                               | `info`               | 日志级别（`silent` 可用于测试）                                              |
| `MC_SESSION_SECRET`                          | 自动生成             | 会话签名密钥（未配置则写入 `data/.secret`，0600）                            |

## 文档索引

- 架构与依赖方向、可观测性：[docs/architecture.md](docs/architecture.md)
- 接口说明（另有 OpenAPI 3.1：`GET /api/v1/openapi.json`）：[docs/api.md](docs/api.md)
- 部署（本地 / Docker / fnOS FPK / 反向代理）：[docs/deploy.md](docs/deploy.md)
- 教师使用说明（文件夹 → 课程、批量归类、常见疑问）：[docs/usage.md](docs/usage.md)
- 运维手册（巡检、日志、备份恢复、定时任务）：[docs/ops-runbook.md](docs/ops-runbook.md)
- 安全设计与复核记录：[docs/security.md](docs/security.md)
- 版本与发布、升级回滚：[docs/release.md](docs/release.md)
- V1 → V2 线上切换 Runbook（含回滚）：[docs/cutover.md](docs/cutover.md)
- 分阶段计划与进度：[docs/roadmap.md](docs/roadmap.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

**硬性要求**：任何写操作都要有 schema 校验、鉴权守卫与审计记录；任何错误都走统一错误信封；任何新增表结构都通过迁移文件，不修改历史迁移。

## 状态

- **Phase 1 后端**：完成。账号/课程/章节/课时/媒体目录/知识点与附件/题库与题目（含配图、CSV 导入导出）/刷题判分/错题本/考试与成绩单/学习统计/笔记
- **Phase 2 前端**：完成。Vue 3 + Vite + TS 设计系统（明暗双主题、可访问性），学生端（课程大厅 → 课程详情 → 观看页 → 练习 → 错题本 → 考试 → 个人中心）与管理端（课程管理〔课程/未归类课时/媒体目录〕→ 课程课时管理〔文件夹扫描 + 拖拽排序〕/题库/考试/统计/学员/设置）
- **Phase 3 交付**：Docker（多阶段 + 非 root + 健康检查）、fnOS FPK 流水线（含升级前自动备份）、`npm run backup/restore`、OpenAPI 3.1、版本注入、部署/运维/安全/发布/使用文档
- **Phase 4 验收**：安全复核、Playwright E2E、本地/Docker/FPK 三端实机验收、V1→V2 数据迁移与备份恢复演练
- 质量门禁：`format:check` / `lint` / `typecheck` / **130 项测试**（覆盖率 84%+）/ **6 项 E2E** / `npm audit` 0 漏洞
- **V1 原型已下线并删除**（源码、镜像、数据卷均已清理，另存归档可恢复）：V2 可直接接管 V1 的 SQLite 库（`0001` 迁移结构与 V1 一致且幂等，`0004` 回填历史刷题记录归属），V1 时期的账号密码在 V2 上可直接登录

## 许可

MIT，见 [LICENSE](LICENSE)。
