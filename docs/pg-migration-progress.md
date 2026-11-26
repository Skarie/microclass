# PostgreSQL 迁移进度与交接文档

> 目的：换会话/换人也能无损接手。**最后更新：2026-11-27（2.4.0 发布批次）**

## 0. 一句话现状

数据访问层已抽象出 `AsyncDb`（sqlite / PG 双栈）。已迁移：**公告、题库（banks，读写全量）、题目写入（questions 写）、设置（settings 快照）**。
生产仍 `MC_DB=sqlite`（2.4.0），**未切 PG**。剩余：lessons/courses、users/auth/progress/notes/favorites/watch、exams/analytics/attempts。

## 1. 已完成域（按 commit）

| commit    | 域                   | 关键点                                                                        |
| --------- | -------------------- | ----------------------------------------------------------------------------- |
| `66e4e8f` | PG 运行形态          | 同机容器 `microclass-db`、数据目录 `/vol1/1000/microclass-pg`、DDL/装载工具链 |
| `3779721` | announcements + 地基 | `AsyncDb`、pg 连接池、driver 单例、`settings` 异步写 + 启动快照读             |
| `0e95c6a` | banks 读（A）        | 目录/章节 7 方法                                                              |
| `ed78803` | banks 读（B）        | `listBanks/countBanks/findBankWithStats`                                      |
| `acc72c6` | banks 读（C）        | `findById/findByName/kindStats/questionCount/绑定统计` + 10 个服务 async 化   |
| `88f0d48` | banks 写             | 9 方法；`AsyncDb.transaction` 改造；回滚测试                                  |
| `b201ec4` | questions 写         | 16 方法；`RETURNING id`；批量写事务；回滚测试                                 |
| `a667f09` | 稳定性补丁           | SQLite 页缓存 256 MB / mmap 2 GB / 只读 `query_only`                          |
| `cac6d05` | 部署护栏             | api healthcheck `start_period` 60 s、`retries` 5                              |
| `0aa7300` | 2.4.0                | 版本与 CHANGELOG                                                              |

## 2. 剩余域（实测规模）

| 域                                                  | 仓储方法数                                        | 备注                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| le/s / courses                                      | `lessonRepository` 19、`courseRepository` 19      | 服务层 `lessonService`/`lessonFolderService`/`lessonScanService` 已因 mediaRoot 异步化被动改过，需复核 await 完整性 |
| users / auth / progress / notes / favorites / watch | user 10、progress 6、notes/favorites/watch 各 5~8 | 刷题提交、观看进度的写路径多；`authService` 已 async（settings 快照）                                               |
| exams / analytics / attempts                        | exam 32、analytics 8、attempts ~10                | 组卷/交卷跨表写多，事务边界要逐个确认                                                                               |

## 3. 每域改造模板（照抄即可）

```ts
// 1) 查询层：Db → AsyncDb，函数加 async/Promise，读调用加 await
export async function listXxx(db: AsyncDb, ...): Promise<Row[]> {
  return db.all<Row>('SELECT ... WHERE id = ?', [id]);
}

// 2) 仓储：注入 asyncDb，写/读方法 async，测试里 adb() 兜底
constructor(private readonly db: Db, private readonly asyncDb?: AsyncDb) {}
private adb(): AsyncDb { return this.asyncDb ?? createSqliteAsyncDb(this.db); }

// 3) 自增：禁止 lastInsertRowid，统一 RETURNING id
const row = await this.adb().get<{ id: number }>('INSERT ... RETURNING id', [...]);

// 4) 事务：同步回调改成 async，语句必须走 tx
await this.adb().transaction(async (tx) => {
  await tx.run('UPDATE ...');
});

// 5) 读旧值：await this.findById(id)（不要用同步兜底）
```

**调用点排查清单**（每域必做）：

- `tsc` 只能抓「类型不匹配」，抓不到 `reply.send(Promise)`（响应体变 `{}`）→ 路由层要人工/脚本再扫一遍
- 服务里 `const x = this.repo.method()` 这类取值必须 `await`
- 循环里的写（导入/批量）必须 `await`，必要时 `for…of` 替代 `forEach`
- 测试里直接调服务方法的断言要补 await（本次踩过 4 个测试文件）

## 4. 方言 TODO（未验证项）

1. `LIKE` 大小写：已统一 `LOWER() LIKE LOWER()`（`apps/api/src/db/sql.ts` 的 `likeCI`），新代码搜索必须用它
2. `AsyncDb.transaction` 的 PG 语义：sqlite 已实跑（`test/bank-write-transaction.test.ts`、`test/question-write-transaction.test.ts`），PG 分支写在同一文件、需 `MC_PG_TEST_URL`
3. 布尔列：`0/1` 整数，PG 侧保持 `bigint`（不做 boolean 化）
4. 触发器/`IDENTITY` 序列：装载后需 `setval(max(id))`（`ops/scripts/pg/load-pg.sh` 已处理）
5. `findByIdSync` 已删除；`settings.getSync` 是快照设计的一部分，**不是**过渡函数，保留

## 5. 测试基线

- `npx vitest run`：**939 passed / 6 skipped**（其中 4 条为 PG 集成测试，需 `MC_PG_TEST_URL`）
- `npx playwright test`：**40/40**
- `npx eslint .`：0 error（4 warning 为既有 console）
- `npm run build`、`node tools/check-file-size.mjs`（app.ts 382 行基线）

## 6. 严禁事项（血泪教训）

1. **不要在同一台 NAS 上起预发容器**、不要并行打 8091/8097、不要读生产库做对比 ——
   2026-11-26 因此发生 3 次生产卡顿（02:57 / 03:48 / 04:38）。检查清单见 `docs/postgres-migration.md` §12.1
2. 预发数据副本放 NVMe（`/var/lib/mc-preprod-data`），不要放 `/vol1`
3. 重活（PG 重装、`pg_dump`、全量聚合体检）只在 01:00–06:00 跑
4. 部署后若 5 分钟内出现两次 healthcheck 超时 → 立即回滚并停手
5. 切流前不要 `MC_DB=pg` 跑任何环境（会形成部分域 PG + 部分域 SQLite 的混合写路径，跨库事务不可用）

## 7. 切流 Runbook

见 `docs/postgres-migration.md` **§12.2 切流预演草案**（窗口、前置检查、停 API 顺序、增量同步、10 条验证、回滚命令）。
本文件只记录进度，不重复 Runbook 细节。

## 7.1 ⚠️ 2.4.0 发布事故与回滚记录（2026-11-26 22:28）

**结论：2.4.0 已回滚，生产现为 `microclass:2.3.3`（`MC_DB=sqlite`），稳定。**

| 时间        | 事件                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22:25       | `microclass:2.4.0` 构建完成；`microclass:2.3.3-stable` 已打标                                                                                                          |
| 22:28       | `redeploy.sh` 切到 2.4.0，readyz 通过                                                                                                                                  |
| 22:28–22:38 | 10 分钟观察：20 样本中 19 个正常（healthz ≤4 ms、courses ≤16 ms、util 20%），**首个样本 000**                                                                          |
| 22:39       | 稳态复核：`/banks/catalog`、`/banks/catalog-sections`、`/settings`、`/announcements`、`/lessons/:id/quiz`、8092 healthz **持续 000（>25 s 超时）**，容器转 `unhealthy` |
| 22:41       | **回滚**：`.image-tag=2.3.3-stable` + `MC_VERSION=2.3.3` + `redeploy.sh`                                                                                               |
| 22:42       | 回滚后全部接口 200（含 catalog / settings / announcements / 8092），healthy                                                                                            |
| 22:45       | 版本字符串修回 `2.3.3`（`2.3.3` 与 `2.3.3-stable` 同一 sha）；重复抽检 3 次均正常（未登录返回 401 属预期）                                                             |

**现象特征**（供后续定位）：2.4.0 下 `courses`、`banks?limit=5` 正常且很快，但**一旦请求 `banks/catalog` 等接口，
后续所有请求（含纯内存的 `/settings`、8092 代理）全部超时** → 事件循环被同步操作卡死，不是单接口慢。

**最可疑点**（按 C 批改动推断）：

1. `bankCatalogService.catalog()` 里 `courseBindingStats` 已改 async，若某处仍按同步用（或反之），
   可能拿到 Promise 而未消费，配合 sqlite 同步查询放大了阻塞；
2. `banks/catalog` 的 `catalogCourses/catalogUnbound/catalogUnboundBooks` 三条聚合在 1.2 GB 库 + 机械盘上冷页读取，
   若在**主线程同步**执行会阻塞事件循环（2.3.3 同样有这些查询，但 2.4.0 的 `settings.load()` 预热/顺序变化可能改变了冷页分布）；
3. 需在**本地 sqlite 副本**上逐条计时与 `EXPLAIN QUERY PLAN`，不要在 NAS 起预发。

**复现建议（本地，安全）**：用 `build/e2e-data/*` 或生产库副本，`node --experimental-sqlite` 直接跑
`catalogCourses` 等三条 SQL 并计时；再起本地 API（`MC_DATA_DIR` 指向副本）打 `/banks/catalog` 复现卡死。

## 7.2 下次会话的起点

1. 先本地定位 2.4.0 卡死（见上），修复后重发 2.4.x
2. 再继续剩余域：lessons/courses → users/auth/progress/notes/favorites/watch → exams/analytics/attempts
3. 全部域迁完 + 本地复测通过，才安排 PG 切流窗口（01:00–06:00）

## 8. 关键文件索引

| 主题                 | 文件                                                              |
| -------------------- | ----------------------------------------------------------------- |
| 异步数据端口         | `apps/api/src/db/async.ts`                                        |
| 驱动选择 / 单例      | `apps/api/src/db/driver.ts`                                       |
| PG 连接池            | `apps/api/src/db/pg/pool.ts`                                      |
| 方言小工具（likeCI） | `apps/api/src/db/sql.ts`                                          |
| PG DDL 生成          | `ops/scripts/pg/gen-schema.mjs`、`post-schema.pg.sql`             |
| 装载/校验            | `ops/scripts/pg/load-pg.sh`、`verify-parity.sh`、`export-tsv.mjs` |
| 备份                 | `ops/deploy/pg-backup.sh`、`ops/deploy/backup.sh`                 |
| 预发 IO 门槛         | `ops/scripts/pg/guard-io.sh`                                      |
| 迁移总文档           | `docs/postgres-migration.md`                                      |
