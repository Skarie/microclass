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
2. **禁止 NVMe**（用户要求 2026-11-27）：数据/副本/PG 全在 `/vol1`；`/var/lib/mc-preprod-data` 已删除。
   在 NVMe 上验证会掩盖机械盘冷页问题（2.4.0 的教训），验证改为「低峰发布 + 真实路径验证 + 快速回滚」
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

**现象特征**：2.4.0 下 `courses`、`banks?limit=5` 正常且很快，但**一旦请求 `banks/catalog` 等接口，
后续所有请求（含纯内存的 `/settings`、8092 代理）全部超时** → 事件循环被同步操作卡死，不是单接口慢。

### 7.1.1 定位结论（2026-11-26 22:45，已修；⚠️ 当时用的是 NVMe 副本，掩盖了机械盘冷页）

**同一份 NVMe 副本上，2.3.3 与 2.4.0 性能完全一致**（注意：NVMe 掩盖了机械盘冷页问题，不能作为发布依据）：

| 镜像               | `/banks/catalog` | `/banks/catalog-sections` | `/settings` | `/announcements` |
| ------------------ | ---------------- | ------------------------- | ----------- | ---------------- |
| `microclass:2.3.3` | 11 ms            | 28 ms                     | 1.9 ms      | 2.4 ms           |
| `microclass:2.4.0` | 11 ms            | 28 ms                     | 1.6 ms      | 1.8 ms           |

隔离复现（8097 / sqlite / NVMe 副本）里 `/banks/catalog` 仅 **217 ms**，随后 `/settings` 2.8 ms、`/healthz` 2.1 ms —— **不卡**。
说明 2.4.0 代码路径没有缺陷；生产卡死是「**新容器冷页 + 机械盘 + 大聚合同步执行**」的组合。

**根因**：`a667f09` 把 `PRAGMA mmap_size` 提到 **2 GB**。mmap 很大时冷页是**按页同步缺页**（每页一次随机读，机械盘 ~12 ms/页）；
2.4.0 是新容器、页缓存全冷，`/banks/catalog` 这类扫大表的聚合就触发逐页读盘风暴，把事件循环卡住数十秒（生产实测 >25 s）。
2.3.3 容器已运行 18 小时、OS 页缓存是热的，所以看不出问题。

**修复**：`mmap_size` 回退 **256 MB**（`MC_SQLITE_MMAP_MB` 可覆盖），256 MB 时大扫描退回常规 `read()` 路径、由内核预读处理；
`cache_size` 保留 256 MB。文件：`apps/api/src/db/client.ts`。

**验证**：`tsc` 0、`vitest 939 passed / 6 skipped`、eslint 0、prettier、size guard 全绿。
**2.4.1 已验证**（低峰直接发布，2026-11-27 23:00）：首次 `/banks/catalog` 冷页 **54.6 s**（机械盘，mmap 256 MB），
其后 `/settings` **71 ms**、`/healthz` 6 ms、`/courses` 17 ms、8092 4 ms；第二轮全部 <20 ms；容器 healthy、`restarts=0`。
发布回滚点为 `2.3.3-stable`。

## 7.2 下次会话的起点

1. 继续剩余域：lessons/courses → users/auth/progress/notes/favorites/watch → exams/analytics/attempts
   （每域独立提交、sqlite 全绿、更新本文件进度表）
2. 全部域迁完后再排 PG 切流窗口（01:00–06:00），Runbook 见 `docs/postgres-migration.md` §12.2

## 7.3 2.4.1 发布记录（2026-11-27 23:00）

| 项                                    | 值                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 版本/镜像                             | `2.4.1` / `microclass:2.4.1`                                                                 |
| 回滚点                                | `microclass:2.3.3-stable`（sha `2d6eea511ee3`，已确认存在）                                  |
| 部署方式                              | 低峰直接 `redeploy.sh`（不建第二份副本，遵守「禁止 NVMe」）                                  |
| 首次 `/banks/catalog`（冷页、机械盘） | **54.6 s**（mmap 256 MB；这是冷页真实代价，不是卡死）                                        |
| 其后 `/settings`                      | **71 ms**（< 100 ms 要求）                                                                   |
| `/healthz`                            | 6 ms；`/courses` 17 ms；`8092` 4 ms                                                          |
| 第二轮（warm）                        | catalog 10 ms / settings 1 ms / healthz 1 ms                                                 |
| 10 分钟观察（20 样本，30 s 间隔）     | settings 最大 **2 ms**、healthz 最大 **2 ms**、util 峰值 20%、`restarts=0`、`health=healthy` |
| 结论                                  | **通过**，生产停留 2.4.1，`.image-tag=2.4.1`、`MC_VERSION=2.4.1`                             |

> ⚠️ 冷页 54.6 s 仍是隐患：部署/重启后第一批访问 `/banks/catalog` 的用户会等近 1 分钟。
> 后续可考虑「启动后后台预热 catalog 相关表」（低优先级，不在切流前动）。

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
