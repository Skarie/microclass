# 微课堂 · 架构说明（V2 企业级）

> 目标：把 V1 单文件原型重构为可长期演进的工程化系统，同时保留三端部署（本地 / Docker / fnOS FPK）与既有数据。

## 1. 仓库结构

```
microclass/
├─ apps/
│  ├─ api/                 # 后端（TypeScript + Fastify）
│  │  ├─ src/
│  │  │  ├─ config/        # 环境变量加载与校验（fail-fast）
│  │  │  ├─ db/            # 连接、迁移执行器、仓储层（repositories）
│  │  │  ├─ security/      # 密码哈希（scrypt）、会话签名（HMAC Cookie）
│  │  │  ├─ services/      # 业务服务（认证/课程/课时/媒体/存储/进度）
│  │  │  ├─ routes/        # HTTP 路由（/api/v1/*），仅做参数校验与编排
│  │  │  ├─ http/          # 守卫（requireUser/requireAdmin）与统一错误处理
│  │  │  ├─ utils/         # Range 流、MIME 等无状态工具
│  │  │  ├─ app.ts         # 依赖装配 + 插件 + 钩子 + 路由
│  │  │  └─ server.ts      # 进程入口与优雅退出
│  │  └─ test/             # Vitest 单元 + Fastify inject 集成测试
│  └─ web/                 # 前端（Vue3 + Vite + TS）— 见「路线图」
├─ packages/shared/        # 前后端共享：类型、常量、错误码、领域错误
├─ db/migrations/          # 编号 SQL 迁移（含 schema_migrations 版本表）
├─ ops/                    # Docker/Compose/FPK/备份/运维脚本
├─ docs/                   # 架构、API、部署、运维手册、贡献指南
└─ .github/workflows/ci.yml
```

## 2. 分层与依赖方向

```
routes → services → repositories → db
   ↘ http(guards/errors)         ↘ shared(types/errors/constants)
```

- **routes**：只做鉴权守卫、schema 校验、DTO 转换，禁止写 SQL 与业务分支。
- **services**：业务规则与事务边界；抛 `AppError`（领域错误），不感知 HTTP。
- **repositories**：SQL 与行映射；不抛 HTTP 语义错误。
- **shared**：类型与错误码单一来源，前端复用。

## 3. 数据与迁移

- 单文件 SQLite（`data/microclass.db`），WAL 模式，`foreign_keys=ON`，`busy_timeout=5000`。
- 迁移文件 `db/migrations/NNNN_name.sql`，按版本号顺序执行；已应用版本记录校验和，**修改历史迁移会直接报错**（防漂移）。
- `0001_initial_schema.sql` = V1 结构基线（`IF NOT EXISTS`），可在既有 V1 数据库上直接执行，实现零停机接管。
- `0002_audit_and_settings.sql` 引入 `audit_logs` 与管理端设置项。
- `0005` 增加视频元数据（`duration`/`cover_path`/`media_type`/`probed_at`）与观看区间 `watch_intervals`。
- `0006_course_folders.sql` 让课程绑定磁盘文件夹（`courses.folder_root_id`/`folder_path`/`last_scan_at`），
  并给 `lessons.source` 打上来源标记（`manual` 手工/上传、`folder` 扫描导入），
  使「重新扫描」可以安全地只同步/清理扫描来的课时，而不碰老师手工建的课时。

## 4. 安全基线

| 项       | 实现                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 密码存储 | `scrypt` + 每用户随机盐，常量时间比较                                   |
| 会话     | HMAC-SHA256 签名的无状态令牌，HttpOnly + SameSite=Lax Cookie，默认 7 天 |
| 角色     | `admin` / `teacher` / `student`，守卫集中校验                           |
| 输入校验 | Fastify JSON Schema（AJV），失败返回统一 400 + details                  |
| 限流     | `@fastify/rate-limit`（默认 300 次/分钟，可配）                         |
| 安全头   | `@fastify/helmet`（CSP 默认关闭，交由反代或后续开启）                   |
| 日志脱敏 | pino redact：cookie / authorization / 密码字段                          |
| 审计     | `audit_logs` 记录登录、失败登录、课程/课时/用户/设置等写操作            |
| 路径安全 | 媒体根与上传目录统一 `resolve` + 越界校验，拒绝目录穿越                 |

## 5. 可观测性

- 结构化 JSON 日志（生产），开发环境可选 pretty；每条请求带 `x-request-id`（透传或生成），错误响应内回传 `requestId`。
- `GET /api/v1/healthz`（存活）、`GET /api/v1/readyz`（依赖探测）、`GET /api/v1/version`（版本信息）。
- `GET /api/v1/audit-logs`（管理员）用于审计排查。

## 6. 三端部署一致性

| 形态     | 运行方式                                   | 说明                              |
| -------- | ------------------------------------------ | --------------------------------- |
| 本地     | `npm run dev` / `npm run start`            | 开发者本机，数据在 `data/`        |
| Docker   | `ops/docker/Dockerfile`（多阶段）+ Compose | 产物镜像，挂载 `data/` 与媒体目录 |
| fnOS FPK | `ops/fpk/`（native + nodejs_v22）          | 与 V1 相同形态，改为发布构建产物  |

数据目录（`MC_DATA_DIR`）、端口（`MC_PORT`）、管理员引导账号（`MC_ADMIN_USER/PASS`）均通过环境变量注入，三端同源。

## 7. 质量门禁

- `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm run test` → `npm run test:coverage`（line ≥60% / branch ≥50%）→ `npm run build`
- CI：GitHub Actions（`.github/workflows/ci.yml`），含 Docker 镜像构建任务。

## 8. 待补齐（见 docs/roadmap.md）

题库/考试/错题本/媒体批量导入的服务与路由已规划，前端 apps/web 尚未落地，运维脚本与 FPK 流水线待补。
