# 贡献指南

> 面向代码、文档与测试的贡献者。提交前请至少读完「质量门禁」与「数据库迁移规则」两节；
> 改界面再加读「设计规范」。行为准则：一个 PR 只做一件事，改动越小越容易 review。

## 1. 开发环境

- **Node ≥ 22.5**（后端用 `node:sqlite`；CI 与生产为 Node 22）
- **npm workspaces**：`apps/*`、`packages/*`，根目录一次 `npm install` 即可
- 编辑器建议启用仓库自带的 ESLint + Prettier 配置

```bash
git clone https://github.com/Skarie/microclass.git
cd microclass
npm install
cp .env.example .env      # 至少改 MC_ADMIN_PASS；默认 MC_DB=sqlite
npm run migrate           # 建库 + 执行全部迁移
npm run dev               # API: http://127.0.0.1:8091/api/v1
npm run dev:web           # 前端 dev server（另开终端，代理 API）
```

本地默认是 **SQLite**（`data/microclass.db`），不需要装 PostgreSQL。
首次启动按 `MC_ADMIN_USER` / `MC_ADMIN_PASS` 引导创建管理员（默认 `admin` / `admin123`，仅本地使用）。

### 用 PostgreSQL 模式开发

生产是 `MC_DB=pg`，涉及数据层 / SQL 的改动最好在两种驱动下都跑一遍：

```bash
# 只起 db（api 仍在本机跑，方便热重载）
docker compose -f ops/docker/compose.evo4.yml up -d db

export MC_DB=pg
# 本机进程连 compose 暴露的 127.0.0.1:55432；api 容器内则用 db:5432
export MC_PG_URL='postgres://microclass:<密码>@127.0.0.1:55432/microclass'
npm run migrate
npm run dev
```

- PG 集成用例默认 **skip**，把 `MC_PG_TEST_URL` 指向**专用测试库**（不要指向生产库）才会跑：
  `MC_PG_TEST_URL=postgres://…/microclass_test npm run test`。
- 不要在生产实例上跑迁移演练、压测或 `--force-recreate`；需要真库验证时用临时库。

## 2. 分支与提交

- 分支：`feat/xxx`、`fix/xxx`、`docs/xxx`、`chore/xxx`、`ops/xxx`
- 提交信息：**一句中文短句 + 2–4 行正文**，说清「为什么」与「影响了什么」；
  类型前缀沿用仓库习惯（`feat(api)：`、`fix(web)：`、`docs(pg)：`、`ops(backup)：`）。
- **一个提交只做一件事**：重构与行为变更分开；格式化单独提交；不要在同一提交里顺手改文案。

```text
fix(api)：非法路径 id 返回 400 而不是 500

路径参数统一走 parseIntegerId，非正整数抛 AppError.badRequest；
鉴权钩子先执行，未登录仍是 401。
新增 id-params 测试 10 条。
```

## 3. 代码规范（硬性）

1. **类型严格**：`strict` + `noUncheckedIndexedAccess`；禁止 `any`（必要时 `unknown` + 收窄）。
2. **ESM / NodeNext**：相对导入必须带 `.js` 后缀（`import { x } from './x.js'`），不要省略扩展名。
3. **分层不得跨越**：`routes → services → repositories → domain`。
   - routes 只做鉴权守卫、JSON Schema 校验、DTO 转换，**不写 SQL、不写业务分支**；
   - repositories 只管 SQL 与行映射，**不抛 HTTP 语义错误**；
   - services 管业务规则与事务边界，抛 `AppError`（`@microclass/shared`），不感知 Fastify；
   - 纯计算（判分、评分、难度、格式化）抽到 `domain/` 或 `utils/`，先写单测。
4. **错误统一**：走错误信封（`{error:{code,message,requestId}}`），禁止裸 `throw new Error` 暴露给用户。
5. **写操作三件套**：JSON Schema 校验 + 鉴权守卫 + 审计（`audit.write`）。
6. **日志脱敏**：不打印密码、Cookie、令牌、`MC_PG_URL`；新增敏感字段同步 `logger.ts` 的 redact 列表。
7. **单文件行数**：目标 **100–200 行**，硬上限 **300 行**；拆分方式见 [docs/code-standards.md](docs/code-standards.md)。
   历史超限文件登记在 `tools/file-size-baseline.json`，**只能变小**；拆小了记得从基线删除。
8. **不引入第三方图表库**：图表在 `apps/web/src/components/charts/`，几何计算在 `utils/chart.ts`（有单测）。

## 4. 质量门禁（提交前全绿）

```bash
npx prettier --check .
npm run lint
npm run typecheck
npm run test                  # vitest：单元 + Fastify inject 集成
npx playwright test           # E2E：需先 npm run build（面向生产构建产物）
npm run build
npm run verify:size           # 单文件行数守卫
```

- 覆盖率门槛：line ≥ 60%、branch ≥ 50%（`npm run test:coverage`）。
- CI 在每次 PR 跑「质量 / E2E / Docker 镜像冒烟」三个 job，并设 `npm audit --omit=dev --audit-level=high`。
- 当前基线（2.4.4）：vitest **1152 passed / 35 skipped**，E2E **40/40**，行数守卫 **631 文件 / 19 项技术债**。
  只增不减：新增测试不要靠删旧用例换绿灯。

## 5. 数据库迁移规则

**编号递增、纯加法、历史不改。**

- 新文件：`db/migrations/NNNN_短名.sql`（四位编号，当前到 `0031`）；不要复用或跳号后回填。
- 只做加法：新增表 / 列 / 索引 / 约束。删列、改名、改类型必须**新迁移**并保留兼容期（先加新列、回填、再切读）。
- 历史迁移**禁止修改**：`schema_migrations` 记录校验和，改动会让已有部署启动失败。
- 迁移同时服务 SQLite 与 PG：先在 SQLite 跑通，再到 PG 真库（`MC_PG_TEST_URL`）验证。
- 涉及数据回填时拆成独立脚本 / 一次性迁移，并写清幂等条件（`IF NOT EXISTS`、`ON CONFLICT`）。

### PostgreSQL 方言注意点（踩过的坑）

| 主题              | 写法                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 占位符            | 继续写 `?`，`AsyncDb` 会转 `$n`；**不要手写 `?1`**（会被拆成 `$11`，2.4.2 的 catalog 500 即此类）                            |
| 插入或忽略 / 替换 | `INSERT … ON CONFLICT (…) DO NOTHING`；替换用 `ON CONFLICT … DO UPDATE`，自引用列写全表名（`t.col = t.col + 1`）             |
| 自增 id           | `INSERT … RETURNING id`，不要用 `lastInsertRowid`                                                                            |
| 两参 MAX          | `GREATEST(a, b)`（或用 `db/sql.ts` 的 `maxOf`）；`IFNULL` → `COALESCE`                                                       |
| 大小写不敏感      | `ILIKE` 或 `LOWER(col) LIKE LOWER(?)`（SQLite 的 `LIKE` 默认对 ASCII 不敏感，别依赖这个差异）                                |
| 大小写不敏感唯一  | 名称类列用 `citext`（如 `tags.name`），配套索引重建                                                                          |
| 别名              | camelCase 别名加双引号：`AS "questionCount"`；否则 PG 折叠成小写，前端读到 `undefined` 且不报错                              |
| GROUP BY          | **必须覆盖 SELECT 里的表达式本身**：`SELECT COALESCE(q.book,'') … GROUP BY q.book` 在 PG 直接报错；`HAVING` 不能引用输出别名 |
| 布尔聚合          | `SUM(CASE WHEN … THEN 1 ELSE 0 END)`，PG 没有 `SUM(boolean)`                                                                 |
| int8 / numeric    | 计数、`SUM`、`RETURNING id` 在仓储边界 `Number()`（驱动层已兜底，但边界仍要收）                                              |
| 时间 / 日期       | 用 `nowSeconds` / `nowText` / `unixDay` helper，不要直接写 `unixepoch()` / `datetime('now')` / `date(…)`                     |
| JSON 展开         | `jsonArrayJoin` / `jsonIntField` / `jsonBoolIntField`，不要写 `json_each` / `json_extract`                                   |
| NULL 比较         | `nullSafeEq(column, driver)`（PG 用 `IS NOT DISTINCT FROM`），不要写 `col IS ?`                                              |
| 稳定排序          | `insertionOrder(alias, driver)`（PG 没有 `rowid`）                                                                           |

> **GROUP BY 那条是 2.4.4 线上实测缺陷**：`exam-facets` 的册次/章节树在 PG 下 500，SQLite E2E 全绿也抓不到。
> 改 SQL 时若只在 SQLite 跑过，请在 PR 里注明「未跑 PG」，并补一条 PG 真库用例或源码守卫测试。

## 6. 设计规范（改 UI 必读）

1. **样式只走令牌**：颜色 / 间距 / 圆角 / 阴影 / 字号一律用 `apps/web/src/styles/tokens.css` 的变量，禁止硬编码色值。
2. **4px 栅格**：间距只用 `4 / 8 / 12 / 16 / 24 / 32`；字号只用 6 档（12/14/16/22/28 + 等宽 13）。
3. **圆角 token**：控件 4px、容器 8px、胶囊 999px；静态卡片用 1px 边框，不用阴影。
4. **禁止**渐变装饰、`border-left/right ≥3px` 的侧边色条、卡中卡、一屏多个主按钮。
5. **可访问性**：`npx playwright test tests/e2e/a11y.spec.ts` 必须 0 个 serious/critical（WCAG 2.0/2.1 A+AA）；
   小字颜色用 `--mc-*-fg` 前景色令牌，不要拿填充色当文字色。
6. **设计守卫**：`apps/web/test/design-guard.test.ts`（随 `npm test` 跑）扫描硬编码色值与 emoji 图标；
   视觉回归在 `tests/e2e/visual.spec.ts`，确认 diff 符合预期后才 `--update-snapshots`。
7. 新组件先在 `/admin/design`（`DesignSystemView.vue`）加示例，再用于业务页面；图表规则见 [docs/design-guidelines.md](docs/design-guidelines.md)。

## 7. PR 检查清单

- [ ] 变更聚焦：一个 PR 只做一件事；标题与提交信息能说明动机
- [ ] 测试：新增 / 修改的行为有单测或集成测试；`npm run test` 全绿
- [ ] 数据层：改了 SQL 或仓储？在 SQLite 与 PG（`MC_PG_TEST_URL`）下都验证过，或明确标注未跑 PG
- [ ] 迁移：新文件编号递增、纯加法、历史迁移未改；回填脚本幂等
- [ ] 门禁：`format:check` / `lint` / `typecheck` / `build` / `verify:size` 全绿；E2E 通过（UI 改动）
- [ ] 文档：API 变更更新 `docs/api.md`，架构变更更新 `docs/architecture.md`，部署 / 运维变更更新 `docs/deploy.md` / `docs/ops-runbook.md`，用户可见变更补 `CHANGELOG.md`
- [ ] 界面：截图 / 视觉基线按需更新；a11y 无 serious/critical
- [ ] 安全：没有提交 token、密码、`.env`、`MC_PG_URL`；日志无敏感信息

## 8. 安全

- **不得提交任何秘密**：`.env`、连接串、会话密钥、管理员密码、备份文件都在 `.gitignore` 里；示例文件只放占位符。
- 配置一律走环境变量；生产必须修改 `MC_ADMIN_PASS` 并给 `MC_SESSION_SECRET` 一个足够长的随机值。
- `MC_PG_URL` 含数据库密码：日志里用 `describePgUrl()`（只保留 `host:port/db`），不要整串打印。
- 新增写接口必须挂鉴权守卫、schema 校验与审计；路径参数统一走 `parseIntegerId`，避免非数字 id 变成 500。
- 发现漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 Issue。

## 9. 贡献授权

本项目采用 **PolyForm Noncommercial 1.0.0**（禁止商用）。提交 Issue / PR 即表示你同意：

1. 你的贡献以**本项目当前许可**授权给本项目及下游使用者；
2. 你同意作者可将你的贡献**一并纳入未来的商业授权版本**（双许可 / 商业授权）；
3. 你确认贡献为你原创，或已获得必要授权，不存在第三方权利冲突。

> 第 2 条是为了保留「社区版 + 商业授权」双轨的可能。如果你不接受，请先与作者沟通再提交。
