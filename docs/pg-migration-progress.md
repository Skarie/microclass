# PostgreSQL 迁移进度与交接文档

> 目的：换会话/换人也能无损接手。**最后更新：2026-11-27（analytics/stats/activity 只读聚合）**

## 0. 一句话现状

数据访问层已抽象出 `AsyncDb`（sqlite / PG 双栈）。已迁移：**公告、题库（banks，读写全量）、题目写入（questions 写）、设置（settings 快照）、课时/课程（lessons/courses，读写全量）、用户/鉴权（users/auth，读写全量）、学习进度/观看区间/笔记（progress/watch/notes，读写全量）、考试（exams，读写全量 + 组卷事务）、刷题记录/错题本（attempts/wrong_questions，读写全量 + 交卷事务）、学情分析/学习统计/学习日历（analytics/stats/activity，只读聚合）**。
生产仍 `MC_DB=sqlite`（2.4.1），**未切 PG**。剩余：**questions 读（`QuestionRepository` 19 个同步读方法）+ 易错题统计（`QuestionStatsRepository` 的 SQLite JSON 聚合）**，以及方言 #16（自然序）、#20（`MAX(a,b)`）、#17（全局 int8 parser）。

## 1. 已完成域（按 commit）

| commit    | 域                       | 关键点                                                                                                    |
| --------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `66e4e8f` | PG 运行形态              | 同机容器 `microclass-db`、数据目录 `/vol1/1000/microclass-pg`、DDL/装载工具链                             |
| `3779721` | announcements + 地基     | `AsyncDb`、pg 连接池、driver 单例、`settings` 异步写 + 启动快照读                                         |
| `0e95c6a` | banks 读（A）            | 目录/章节 7 方法                                                                                          |
| `ed78803` | banks 读（B）            | `listBanks/countBanks/findBankWithStats`                                                                  |
| `acc72c6` | banks 读（C）            | `findById/findByName/kindStats/questionCount/绑定统计` + 10 个服务 async 化                               |
| `88f0d48` | banks 写                 | 9 方法；`AsyncDb.transaction` 改造；回滚测试                                                              |
| `b201ec4` | questions 写             | 16 方法；`RETURNING id`；批量写事务；回滚测试                                                             |
| `da4a0ad` | lessons/courses 读写     | 36 方法；`RETURNING id`；删除/重排/改绑/收藏/分类走事务；服务与路由补 await                               |
| `e95226b` | users / auth             | 10 方法；`RETURNING id`；**鉴权链路 `onRequest` 的 `users.findById` 补 await**；authService 全异步        |
| `8faa2dc` | progress/notes/watch     | 16 方法；区间 record 走事务（中途失败整批回滚）；笔记 `RETURNING id`；路由补 await                        |
| `0ae37a4` | exams 读（批次 1）       | 读 20 方法 + 题池/选题树/细目表/卷面缓存；写路径 SQL 未动；21 个契约测试                                  |
| `37fbadd` | exams 写 + attempts      | exam 写 12 方法 + 组卷事务；attempts/错题本读写 + 交卷事务；`RETURNING id`；方言 #19/#22/#23；19 条新测试 |
| `9be51a7` | analytics/stats/activity | 13 个只读方法 async；方言 #21 `unixDay`；方言 #24 JSON 展开；int8 `Number()`；16 条新测试                 |
| `a667f09` | 稳定性补丁               | SQLite 页缓存 256 MB / mmap 2 GB / 只读 `query_only`                                                      |
| `cac6d05` | 部署护栏                 | api healthcheck `start_period` 60 s、`retries` 5                                                          |
| `0aa7300` | 2.4.0                    | 版本与 CHANGELOG                                                                                          |

## 2. 剩余域（实测规模）

| 域                                      | 规模                               | 备注                                                                                                                                |
| --------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| questions 读（`QuestionRepository`）    | 19 个同步读方法 / 47 个 src 调用点 | 读写仍在同一个仓储：app.ts 未注入 asyncDb，PG 模式下连「写」也退回 SQLite（§7.7 盘点）                                              |
| 易错题统计（`QuestionStatsRepository`） | 2 个方法 / 3 个 src 调用点         | 用 SQLite 的 `json_each/json_extract` 聚合 `attempts.answers`；PG 模式直接报错，需下一批改用 `db/sql.ts` 的 JSON 方言辅助（§9 #24） |

> exams（读写全量，含组卷事务）与 attempts/错题本（含交卷事务）已在 `37fbadd` 迁完；
> 收藏（favorites）在 lessons/courses 批次（`da4a0ad`）内已迁；analytics/stats/activity 在 `9be51a7` 迁完。
> 已迁域牵出的服务（stats/quiz/practiceLink/exam-lifecycle/lessonUnlock/note 等）都 async 化了，
> 新增读方法时注意调用点仍要 `await`；`reply.send(<Promise>)` 依旧是 tsc 抓不到的坑。
> ⚠️ **questions 读仍未迁**（且 app.ts 未注入 asyncDb，写也没真正走 PG，见 §7.7）：
> PG 模式下这些读写会落回 SQLite，属于切流前必须清掉的跨库混合点。

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

> **批次 1 的临时例外已清零（`37fbadd`）**：写方法 `update`/`setStructure` 读旧考试行、
> `replaceQuestion` 读卷内旧配置，批次 1 用的是模块内私有同步读（`findByIdSync` / `questionInExamSync`）；
> 批次 2 已**删除这两个函数**，写路径统一 `await this.findById(...)` / `await questionInExam(...)`。
> 测试口径见 `apps/api/test/exam-read-async.test.ts`（写方法也必须是 Promise 且不碰同步 Db）。

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
6. `CAST(title AS INTEGER)`（lessons 自然序）：SQLite 非数字前缀 → 0，**PG 会直接报错**；切流前必须按方言生成排序表达式
7. int8（`COUNT/SUM/MAX`、`RETURNING id`）经 node-postgres 默认返回 **string**；建议在 `pg/pool.ts` 加 `types.setTypeParser(20, Number)`（所有已迁移域共同待办）
8. 课时扫描的 `findMissingLessons` 判定回调**保持同步**（只做 `fs` 判定、不碰库）；落库步骤已 await —— 不要为了「全 async」把它改成异步，会打乱扫描顺序
9. **`unixepoch()`（方言 #19）— 已处理（`37fbadd`）**：新增 `db/sql.ts` 的 `nowSeconds(driver)`
   （sqlite → `unixepoch()`，pg → `(EXTRACT(EPOCH FROM now()))::bigint`）。已覆盖
   `wrong_questions` 的 upsert/掌握标记、`attempts` 相关写、`progressRepository.upsert`/`markQuizDone`；
   SQLite 侧文本与迁移前完全一致（行为不变），PG 侧不再出现 SQLite 专有函数。
   表 DEFAULT 的 `unixepoch()` 仍由生成器负责（§9 #5）。
10. **`MAX(a, b)` 标量形式（方言 #20）**：`lesson_progress` 的 upsert `DO UPDATE SET finished = MAX(finished, excluded.finished)`、`quiz_best = MAX(...)` —— SQLite 是标量两参 `max()`，PG 里 `MAX` 是聚合会直接报错；切流前改 `GREATEST(a, b)`（PG）或 `CASE WHEN`。**未改**；analytics/stats/activity 的 SQL 里没有两参 `MAX`（只有聚合 `MAX(score)`），本批不涉及
11. **`date(col,'unixepoch','localtime')`（方言 #21）— 已处理（analytics 批次）**：新增 `db/sql.ts` 的
    `unixDay(column, driver, { local })`：sqlite 原样 `date(..., 'unixepoch'[,'localtime'])`；pg →
    `to_char(to_timestamp(col) AT TIME ZONE 'UTC' | 'Asia/Shanghai','YYYY-MM-DD')`。
    学习日历（`activityRepository`）用 `local: true`（Asia/Shanghai），
    学情趋势（`analyticsRepository.trend`）保持迁移前的 **UTC 日**（`local: false`）。
    SQLite 侧 SQL 文本与迁移前完全一致，行为不变。
12. **`INSERT OR IGNORE` / `INSERT OR REPLACE`（方言 #22）— 已处理（`37fbadd`）**：`exam-questions.addQuestions`
    改 `ON CONFLICT (exam_id, question_id) DO NOTHING`（`changes > 0` 仍是「真的新增」，不占 sort）；
    `replaceQuestion` 先 `DELETE` 旧题再 `INSERT … ON CONFLICT (exam_id, question_id) DO UPDATE`（等价原 `REPLACE`，
    保持卷内位置/分值/大题）；组卷 `applyComposition` 同事务内复用同一句。契约见 `test/exam-write-async.test.ts`
13. **int8 字符串在读层的收敛（方言 #17 的落地）**：`COUNT/SUM/MAX(sort)` 在 PG 回传字符串。所有已迁移读方法
    （含批次 1 的 exams 读、错题本 `count`/`list`、本批 analytics/activity/stats 的计数与 id）已在仓储边界统一 `Number()`；写路径的 `RETURNING id`
    （`exams.create`、`exam_attempts.createAttempt`、`attempts.create`）同样 `Number()`。全局 `types.setTypeParser(20)` 仍是切流前待办
14. **`LIKE` 大小写（方言 #23）— 已处理（`37fbadd`）**：`exam-pool-filter` 的 `keyword`/`point`/`chapter`
    与 `exam-stats.pointStats.point` 全部改用 `likeCI`（`LOWER(列) LIKE LOWER(?)`），
    SQLite 侧行为不变（中文不受影响、ASCII 仍大小写不敏感），PG 侧不再依赖 SQLite 默认语义
15. **`json_each` / `json_extract`（方言 #24）— 已处理（analytics 批次）**：`db/sql.ts` 新增
    `jsonArrayJoin`（sqlite `, json_each(col) alias` / pg `CROSS JOIN LATERAL jsonb_array_elements(col::jsonb) AS alias(value)`）、
    `jsonIntField`（`CAST(json_extract(...) AS INTEGER)` / `CAST(alias.value->>'field' AS INTEGER)`）、
    `jsonBoolIntField`（sqlite 原 `json_extract` 的 1/0/NULL；pg 用 `CASE ... ->> 'true'/'false'`，**保住 NULL 主观题**）。
    已覆盖 `analyticsRepository` 的练习 + 考试作答展开；`QuestionStatsRepository`（易错题统计）**仍是 SQLite 专有 JSON**，待迁

## 5. 测试基线

- `npx vitest run`：**1022 passed / 7 skipped**（基线 939/6 → +lessons/courses 14 → +users/auth 4 → +progress/notes/watch 9 → +exams 只读 21 → +exams 写/交卷 19 → +analytics/stats/activity 16；
  analytics 批次新增 `test/analytics-async.test.ts` 14 条（只经 AsyncDb、方言 #21/#24、stats int8）与
  `test/analytics-date-parity.test.ts` 2 条（int8 收敛 + 真 SQLite 的本地日/UTC 日分桶对照）；
  批次 2 的 `test/exam-write-async.test.ts` 10 条与 `test/exam-write-transaction.test.ts` 9 条保持；
  `test/exam-read-async.test.ts` 的 21 条是「读写都只经 AsyncDb」契约；skip 里含 PG 集成测试，需 `MC_PG_TEST_URL`）
- `npx playwright test`：**40/40**
- `npm run typecheck`、`npx eslint .`：0 error（4 warning 为既有 console）
- `npm run build`、`npx prettier --check .`、`node tools/check-file-size.mjs`（624 个文件）

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

1. 剩余域：**questions 读（`QuestionRepository` 19 个同步读方法，§7.7 已盘点）** 与
   **易错题统计（`QuestionStatsRepository`）**；两者都必须在切流前迁掉
2. 每域收尾照旧扫一遍 `reply.send(Promise)` / `{ id: service.x() }` 这类漏 await（本轮又抓到十余处，
   `tsc` 全部不报错；`requireUser` 保持同步返回 `req.authUser`，只有 `users.findById` 需要 await）
3. 全部域迁完后再排 PG 切流窗口（01:00–06:00），Runbook 见 `docs/postgres-migration.md` §12.2；
   切流前先清 §4 剩余方言 TODO（#20 `MAX(a,b)`、#16 自然序、#17 全局 int8 parser）
4. **切流前另一个跨库混合点**：`QuestionRepository` 的读方法仍是同步 `Db`，且 `app.ts` 未注入 `asyncDb`
   （写方法也退回 SQLite），详见 §7.7；必须在同一批里完成「读写都 AsyncDb」，不能只补 DI

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

## 7.4 exams/attempts 批次 1（只读）迁移记录（2026-11-27）

### 7.4.1 本批做了什么

| 项           | 内容                                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓储读方法   | `examRepository` 20 个：`listByCourse`/`listByCourseWithStats`/`findById`、`listQuestions`/`questionInExam`/`questionIds`、`pick`/`pickIds`/`pickCount`/`pool`/`search`、`taxonomy`/`pointStats`、`facets`/`pointsOf`、`attemptCount`/`findAttempt`/`attemptsOf`/`attemptsByUser`（全部 `AsyncDb` + `async`，计数统一 `Number()`） |
| 写方法       | create/update/delete/setStructure、setQuestionMeta/reorder/replaceQuestion/addQuestions/removeQuestion/applySection/clearQuestions、createAttempt **SQL 与事务一行未动**，仍走同步 `Db`                                                                                                                                            |
| 写路径读旧值 | `update`/`setStructure` 的旧值、`replaceQuestion` 的卷内配置改用**模块内私有**同步读（`findByIdSync`/`questionInExamSync`），不从仓储门面导出；批次 2 改造写方法时删除                                                                                                                                                             |
| 服务传播     | `lifecycle`/`paper-workbench`/`paper-edit`/`parallel`/`attempt`(take)/`result`/`paper*`/`statsService.meOverview` 全部 async 化；`bankCatalogService.createExamFromBank` 补 `await`。写落库仍是同步调用，**顺序与事务边界不变**                                                                                                    |
| 卷面缓存     | `ExamPaperCache.paperOf` 改为 async：TTL 命中仍返回同一份数组（不读库），未命中才 `await listQuestions` 并落缓存 —— 语义与缓存口径不变                                                                                                                                                                                             |
| 路由         | `routes/exams-{crud,pool,paper,compose,attempts}.ts`、`routes/paper.ts` 补 await；`GET /exams/:id` 的 `{ exam }` 与交卷/CSV 的「先取字段再拼响应」逐处显式 await                                                                                                                                                                   |
| 契约测试     | 新增 `test/exam-read-async.test.ts`（21 条）：每个读方法返回 Promise 且只经 AsyncDb、PG int8 字符串收敛成 number、写方法不碰 AsyncDb                                                                                                                                                                                               |
| 方言         | 未引入 `json_extract`/`group_concat`/窗口函数；确认新增待办见 §4 #12–#14 与 `docs/postgres-migration.md` §9 #22–#23（`INSERT OR IGNORE/REPLACE`、LIKE 大小写站点）                                                                                                                                                                 |

### 7.4.2 批次 2 清单（已完成，实际记录见 §7.5）

| 项               | 预估                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 方法数           | exam 写 12（create/update/delete/setStructure/setQuestionMeta/reorder/replaceQuestion/addQuestions/removeQuestion/applySection/clearQuestions + 平行卷抄结构）+ `attemptRepository` 7 + `WrongQuestionRepository` 5 |
| 必改方言         | `INSERT OR IGNORE/REPLACE` → `ON CONFLICT`/先删后插（#22）；`unixepoch()` 在错题本 upsert（#19）；`RETURNING id` 取代 `lastInsertRowid`（exam create、attempt create）                                              |
| 事务边界（重点） | 交卷 = 判分(纯内存) + `createAttempt` 落库 + 审计（`writeBuffered`）；组卷 = `clearQuestions` + `addQuestions` + 逐题 `setQuestionMeta`；批次 2 需把「交卷 + 错题本」纳入同一事务，并补「中途失败整批回滚」测试     |
| 缓存             | `submit` 读 `paperOf`、改卷/删题 `clearPaper`：写迁异步后必须保证「先失效缓存、再写库」或写成功后失效，避免交卷读到旧卷                                                                                             |
| 测试成本         | `exam-grading.test.ts` 已 async 化；批次 2 需再补交卷回滚测试（临时触发器制造中途失败，口径同 `progress-write-transaction.test.ts`）与错题本并发 upsert                                                             |
| 风险点           | 交卷是学生端高频写路径：`createAttempt` 改异步后要注意 sqlite `BEGIN IMMEDIATE` 与 PG 单连接事务的差异；`writeBuffered` 审计在事务外，回滚后不能留下「已交卷」审计                                                  |

## 7.5 exams/attempts 批次 2（写 + 交卷 + 错题本）迁移记录（2026-11-27，`37fbadd`）

### 7.5.1 本批做了什么

| 项           | 内容                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓储写方法   | `examRepository` 12 个：`create`/`update`/`delete`/`setStructure`、`setQuestionMeta`/`reorder`/`replaceQuestion`/`addQuestions`/`removeQuestion`/`applySection`/`clearQuestions`、`recordAttempt`（+ 组卷 `applyComposition`）；全部 `AsyncDb` + `async`，事务内语句走 `tx`                       |
| attempts     | `AttemptRepository.create`/`listByUser`/`bestPercent`/`countByLesson` 改 async；新增 `recordSubmission`（attempt + 错题本效果同事务）；`ExamAttemptService.submit` 改用 `exams.recordAttempt`（单事务边界）                                                                                       |
| 错题本       | `WrongQuestionRepository` 5 方法（`upsertWrong`/`markMastered`/`setMastered`/`remove`/`list`+`count`）改 async；`list`/`count` 在边界 `Number()` 收敛 int8（方言 #17）                                                                                                                            |
| 交卷事务     | **刷题交卷** = 判分（纯内存）+ `attempts` 落库 + 错题本 upsert/标记掌握，同一 `AsyncDb.transaction`；**考试交卷** = `exam_attempts` 落库单事务，审计 `writeBuffered` 在提交**之后**（回滚不留「已交卷」审计）                                                                                     |
| 组卷事务     | `applyComposition`：清空（可选）+ 批量加题 + 逐题写分值/大题在**同一事务**；`paperCompose.autoCompose` 挑题阶段仍按「清空后」口径排除（`replaceExisting` 时为空集合），挑完一次性落库；中途失败整批回滚                                                                                           |
| 卷面缓存     | 写成功后失效：`ExamPaperEditService`（加题/随机/配额/分值/排序/结构/删题）、`ExamPaperWorkbench`（智能组卷/换题）、`ExamLifecycleService`（改/删考试）都在 `await` 写成功之后 `clearPaper` —— 紧接着的交卷按新卷判分                                                                              |
| 删除同步兜底 | 批次 1 的 `findByIdSync` / `questionInExamSync` 已删除；`update`/`setStructure` 读旧值、`replaceQuestion` 读卷内配置统一 `await`                                                                                                                                                                  |
| 服务/路由    | `quizService.submit` 走 `recordSubmission`，`bestPercent`/`listByUser`/`wrongBook`/`setMastered`/`removeFromWrongBook` 全部 await；`routes/quiz.ts` 的掌握/移除补 await；`paper*`/`parallel`/`lifecycle` 写调用全部 await                                                                         |
| 方言         | #22：`INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`、`INSERT OR REPLACE` → 先删后插 + `ON CONFLICT DO UPDATE`；#19：`unixepoch()` → `nowSeconds(driver)`（错题本/进度）；#14：`RETURNING id`（exam/attempt）；#23：`likeCI`（题池与 pointStats）。详见 `docs/postgres-migration.md` §9 #19/#22/#23 |
| 测试         | 新增 `exam-write-async.test.ts`（10 条：方言 SQL + `RETURNING id` + int8 收敛）与 `exam-write-transaction.test.ts`（9 条：组卷回滚/刷题交卷回滚/考试交卷回滚与审计/错题本并发 upsert/缓存失效）；`exam-read-async.test.ts` 改为「读写都只经 AsyncDb」                                             |

### 7.5.2 事务与回滚口径（临时触发器制造失败）

| 场景                    | 失败点（测试里临时触发器）         | 断言                                                                 |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| 组卷（replaceExisting） | `BEFORE INSERT ON exam_questions`  | 旧卷**不被清空**（DELETE 一起回滚），题目/顺序原样                   |
| 刷题交卷                | `BEFORE INSERT ON wrong_questions` | attempt 行回滚，错题本次数/掌握状态不变                              |
| 考试交卷                | `BEFORE INSERT ON exam_attempts`   | 无成绩行、`audit_logs` 无 `exam.submit` 记录；恢复后交卷成功才写审计 |

### 7.5.3 本批之后的剩余

- ~~analytics（8）/ `ActivityRepository`（3）/ `StatsRepository`（3）~~ → 已在 `9be51a7` 完成（§7.6）；
- 方言剩余：#20（`MAX(a,b)` 标量）、#16（自然序）、#17（全局 int8 parser）；#21/#24 已收口；
- ⚠️ `QuestionRepository` 19 个读方法仍同步 `Db`，且 DI 未注入 asyncDb（§7.7 盘点）；
- ⚠️ `QuestionStatsRepository` 仍用 SQLite 专有 JSON（方言 #24），PG 模式会直接报错。

## 7.6 analytics/stats/activity（只读聚合）迁移记录（2026-11-27，`9be51a7`）

### 7.6.1 本批做了什么

| 项             | 内容                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓储读方法     | `analyticsRepository` 7 个公开方法 + 私有 `gradedCte`（`totals`/`points`/`students`/`questions`/`trend`/`studentAccounts`/`scopeSize`）；`ActivityRepository` 3 个（`lessonDays`/`quizDays`/`daily`）；`StatsRepository` 3 个（`students`/`lessonRows` 改 async，`lessonSummary` 保持纯函数）——全部 `AsyncDb` + Promise，`app.ts` 注入 `asyncDb`                       |
| 方言 #21       | 新增 `db/sql.ts` 的 `unixDay(column, driver, { local })`。SQLite 原样 `date(col,'unixepoch'[,'localtime'])`；PG `to_char(to_timestamp(col) AT TIME ZONE 'UTC' \| 'Asia/Shanghai','YYYY-MM-DD')`。日历用 `local:true`、趋势保持 UTC 日；测试断言 SQLite 文本不变、PG 无 `'unixepoch'`                                                                                   |
| 方言 #24（新） | 发现 analytics 的作答展开用了 SQLite 专有的 `json_each`/`json_extract`（原文档「本库未用」不准确）。新增 `jsonArrayJoin`/`jsonIntField`/`jsonBoolIntField`：SQLite 原样，PG 用 `jsonb_array_elements` + `->>` + `CASE`；**主观题 `correct:null` 在 PG 侧仍映射为 NULL 并被 `IN (1,0)` 排除**                                                                           |
| PG 语法修整    | `students` 的 `GROUP BY` 补齐 `u.username/u.display_name`、`questions` 补齐题目列（PG 不允许非聚合列）；最弱知识点的 `HAVING wrong > 0` 改成完整表达式（PG 不允许 HAVING 引用输出别名）                                                                                                                                                                                |
| int8（#17）    | 计数、`user_id`、`question_id`、`lesson_progress` 的整数列、`MAX(score)` 全部在仓储边界 `Number()`；`statsService.lessonStats/courseStats`、`analyticsService.*` 只拿 number                                                                                                                                                                                           |
| 服务/路由      | `AnalyticsService` 的缓存与 6 个方法 async 化（`cached` 变 `Promise`），内部只读查询 `Promise.all`；`StatsService.courseStats` 用 `for…of` 逐个 `await`（保持顺序、避免 PG 池并发打满）；`routes/analytics*`、`routes/stats*`、`routes/exams-crud`（`/me/exams`）补 await；`routes/activity` 通过 `getAsyncDb(deps.config, deps.db)` 注入（`app.ts` 已到行数守卫上限） |
| 测试           | 新增 `test/analytics-async.test.ts`（14 条：只经 AsyncDb、方言 #21/#24、stats int8）与 `test/analytics-date-parity.test.ts`（2 条：int8 收敛、真 SQLite 的本地日/UTC 日分桶对照 + 主观题排除）                                                                                                                                                                         |
| 门禁           | vitest **1022 passed / 7 skipped**（+16）、E2E 40/40、typecheck 0、eslint 0、prettier、build、size guard（624 文件，baseline 仅上调 analyticsRepository/analyticsService 的行数预算）                                                                                                                                                                                  |

### 7.6.2 本批没有做的事

- **#20 `MAX(a,b)`**：本域 SQL 只有聚合 `MAX(score)`，没有两参标量形式；`lesson_progress` upsert 仍待改；
- **#16 自然序**：`lessons` 的 `CAST(title AS INTEGER)` 与本批无关，仍未处理；
- **`QuestionStatsRepository`**：同样是「作答 JSON 聚合」，但属易错题挑题（exams 域），仍同步 `Db` + SQLite JSON，下一批必须迁。

## 7.7 `QuestionRepository` 读方法盘点（本批未改，切流前必须清）

> 结论：**19 个同步读方法 / 47 个 src 调用点**。而且 `app.ts` 是 `new QuestionRepository(db)`，
> **没有注入 `asyncDb`** —— 仓储里 16 个 `async` 写方法的 `adb()` 会退回 `createSqliteAsyncDb(this.db)`，
> 所以 PG 模式下 questions 是「**读写都落 SQLite**」，比原文档写的「写已 AsyncDb」更严重。
> 当前生产 `MC_DB=sqlite`，且切流前禁止 `MC_DB=pg`，因此暂无生产影响；但必须与读方法一起修，
> 不能只补 DI（只补 DI 会变成「写 PG、读 SQLite」的更糟混合态）。

| #   | 同步读方法            | src 调用点 | 主要调用方（文件）                                                                                                                          |
| --- | --------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `listByBank`          |          6 | bankCatalogService、bankExportService×3、bankQuestionService、bankService                                                                   |
| 2   | `countByBank`         |          1 | bankQuestionService                                                                                                                         |
| 3   | `listAll`             |          1 | bankQuestionService                                                                                                                         |
| 4   | `countAll`            |          1 | bankQuestionService                                                                                                                         |
| 5   | `findById`            |         10 | bankHealthService、bankQuestionImageService、bankQuestionService×4、paperReplace、practiceLinkService、questionConflictService、quizService |
| 6   | `findByIds`           |          1 | bankQuestionService（链式调用）                                                                                                             |
| 7   | `listByLesson`        |          2 | quizService×2（学生刷题页高频）                                                                                                             |
| 8   | `difficultyFeatures`  |          2 | difficultyService                                                                                                                           |
| 9   | `stemsByIds`          |          1 | difficultyService                                                                                                                           |
| 10  | `allDifficultyScores` |          1 | difficultyService                                                                                                                           |
| 11  | `difficultyScoreOf`   |          1 | difficultyService                                                                                                                           |
| 12  | `answerStats`         |          1 | difficultyService                                                                                                                           |
| 13  | `difficultyStats`     |          4 | routes/difficulty、difficultyService×3                                                                                                      |
| 14  | `health`              |          2 | bankHealthPayload、bankHealthService                                                                                                        |
| 15  | `countByMeta`         |          8 | bankHealthPayload×4、bankHealthService×4                                                                                                    |
| 16  | `searchByMeta`        |          1 | bankQuestionService                                                                                                                         |
| 17  | `pointStats`          |          1 | bankQuestionService                                                                                                                         |
| 18  | `duplicateGroups`     |          2 | bankHealthPayload、bankHealthService                                                                                                        |
| 19  | `duplicateIdsInBank`  |          1 | bankHealthService                                                                                                                           |

**风险（按严重度）**：

1. **读写分裂/读后写不可见**：PG 模式下写若改走 PG，`create/update/import` 后紧接的 `findById`/`listByBank`
   会查 SQLite（旧数据）→ 404 或列表缺新题；考试组卷、刷题判分拿不到刚导入的题。
2. **学生高频路径**：`quizService.listByLesson`/`findById` 是刷题页每次打开都走的路径，PG 模式下
   会读不到 PG 中的题目（或读到旧题），影响面最大。
3. **老师端批量操作**：题库列表/导出、`bankHealthService`（全库体检）、`difficultyService`（难度重算）、
   `questionConflictService`（同题不同答案）、`practiceLinkService`、`paperReplace` 都依赖这些同步读。
4. **bank health worker**：`bankHealthPayload` 自己 `new QuestionRepository(db)`（只读 worker 线程），
   即使 API 侧迁完，worker 仍会从 SQLite 算体检 → PG 模式结果不可信，需要单独改。
5. **async 传播面大**：调用点分布在 10 个 service + 1 个 route，全部要补 `await`；同批必须扫
   `reply.send(Promise)`（`questionConflicts` 路由已有该写法）并补契约测试（可照抄 `exam-read-async.test.ts`）。

**建议下一批口径**：19 个读方法 → `AsyncDb` + `async`；`app.ts` 注入 `asyncDb`；`bankHealthPayload` 的
worker 也走 `AsyncDb`（只读连接）；新增 `question-read-async.test.ts` 钉「只经 AsyncDb + int8 收敛」，
并补一条「create 后立即 findById 能读到」的读后写用例（SQLite 下即可验证调用链）。

## 8. 关键文件索引

| 主题                                               | 文件                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| 异步数据端口                                       | `apps/api/src/db/async.ts`                                        |
| 驱动选择 / 单例                                    | `apps/api/src/db/driver.ts`                                       |
| PG 连接池                                          | `apps/api/src/db/pg/pool.ts`                                      |
| 方言小工具（likeCI / nowSeconds / unixDay / JSON） | `apps/api/src/db/sql.ts`                                          |
| PG DDL 生成                                        | `ops/scripts/pg/gen-schema.mjs`、`post-schema.pg.sql`             |
| 装载/校验                                          | `ops/scripts/pg/load-pg.sh`、`verify-parity.sh`、`export-tsv.mjs` |
| 备份                                               | `ops/deploy/pg-backup.sh`、`ops/deploy/backup.sh`                 |
| 预发 IO 门槛                                       | `ops/scripts/pg/guard-io.sh`                                      |
| 迁移总文档                                         | `docs/postgres-migration.md`                                      |
| lessons/courses 事务                               | `apps/api/test/lesson-course-write-transaction.test.ts`           |
| users/auth 鉴权链路                                | `apps/api/test/auth-async.test.ts`                                |
| progress/notes/watch 事务                          | `apps/api/test/progress-write-transaction.test.ts`                |
| exams 读写契约                                     | `apps/api/test/exam-read-async.test.ts`                           |
| exams 写方言契约（批次 2）                         | `apps/api/test/exam-write-async.test.ts`                          |
| exams/attempts 事务与回滚                          | `apps/api/test/exam-write-transaction.test.ts`                    |
| 卷面缓存口径                                       | `apps/api/test/exam-paper-cache.test.ts`                          |
| analytics 只经 AsyncDb + 方言                      | `apps/api/test/analytics-async.test.ts`                           |
| analytics/activity 日期与 int8 对照                | `apps/api/test/analytics-date-parity.test.ts`                     |
