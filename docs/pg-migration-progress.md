# PostgreSQL 迁移进度与交接文档

> 目的：换会话/换人也能无损接手。**最后更新：2026-11-27（exams/attempts 批次 1：只读方法）**

## 0. 一句话现状

数据访问层已抽象出 `AsyncDb`（sqlite / PG 双栈）。已迁移：**公告、题库（banks，读写全量）、题目写入（questions 写）、设置（settings 快照）、课时/课程（lessons/courses，读写全量）、用户/鉴权（users/auth，读写全量）、学习进度/观看区间/笔记（progress/watch/notes，读写全量）、考试只读（exams 读 20 方法 + 题池/选题树/细目表/卷面缓存）**。
生产仍 `MC_DB=sqlite`（2.4.1），**未切 PG**。剩余：**exams 写（批次 2）+ attempts（交卷/判分/错题本）+ analytics/stats/activity**。

## 1. 已完成域（按 commit）

| commit    | 域                   | 关键点                                                                                             |
| --------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `66e4e8f` | PG 运行形态          | 同机容器 `microclass-db`、数据目录 `/vol1/1000/microclass-pg`、DDL/装载工具链                      |
| `3779721` | announcements + 地基 | `AsyncDb`、pg 连接池、driver 单例、`settings` 异步写 + 启动快照读                                  |
| `0e95c6a` | banks 读（A）        | 目录/章节 7 方法                                                                                   |
| `ed78803` | banks 读（B）        | `listBanks/countBanks/findBankWithStats`                                                           |
| `acc72c6` | banks 读（C）        | `findById/findByName/kindStats/questionCount/绑定统计` + 10 个服务 async 化                        |
| `88f0d48` | banks 写             | 9 方法；`AsyncDb.transaction` 改造；回滚测试                                                       |
| `b201ec4` | questions 写         | 16 方法；`RETURNING id`；批量写事务；回滚测试                                                      |
| `da4a0ad` | lessons/courses 读写 | 36 方法；`RETURNING id`；删除/重排/改绑/收藏/分类走事务；服务与路由补 await                        |
| `e95226b` | users / auth         | 10 方法；`RETURNING id`；**鉴权链路 `onRequest` 的 `users.findById` 补 await**；authService 全异步 |
| `8faa2dc` | progress/notes/watch | 16 方法；区间 record 走事务（中途失败整批回滚）；笔记 `RETURNING id`；路由补 await                 |
| `0ae37a4` | exams 读（批次 1）   | 读 20 方法 + 题池/选题树/细目表/卷面缓存；写路径 SQL 未动；21 个契约测试                           |
| `a667f09` | 稳定性补丁           | SQLite 页缓存 256 MB / mmap 2 GB / 只读 `query_only`                                               |
| `cac6d05` | 部署护栏             | api healthcheck `start_period` 60 s、`retries` 5                                                   |
| `0aa7300` | 2.4.0                | 版本与 CHANGELOG                                                                                   |

## 2. 剩余域（实测规模）

| 域                     | 仓储方法数                          | 备注                                                                                                                                                                |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| exams                  | exam 32（读 20 已迁 / 写 12 待迁）  | **批次 1 已完成**：读、题池、选题树、细目表、卷面缓存；**批次 2**：create/update/delete/setStructure、加删改题/换题/排序/applySection/clearQuestions + 交卷与错题本 |
| attempts               | attemptRepository ~7、wrongs ~5     | 与 exams 写同批（交卷判分落库 + 错题本写入）；`unixepoch()` 方言见 §4 #19                                                                                           |
| analytics              | analytics 8、`ActivityRepository` 3 | 只读聚合；`activityRepository` 用 `date(...,'unixepoch','localtime')`，PG 方言待改（见 §4 方言 #21）                                                                |
| stats（课时/课程统计） | `StatsRepository` 3                 | 在 `noteRepository.ts` 里，仍同步 `Db`；读 `lesson_progress`/`attempts`，跟着 analytics 批次一起改                                                                  |

> users/auth（`e95226b`）、progress/notes/watch（`8faa2dc`）已迁完；收藏（favorites）在 lessons/courses 批次（`da4a0ad`）内已迁。
> 已迁域牵出的服务（stats/quiz/practiceLink/exam-lifecycle/lessonUnlock/note 等）都 async 化了，
> 下一域改 exams/analytics 时注意这些服务的调用点仍要 `await`；`reply.send(<Promise>)` 依旧是 tsc 抓不到的坑。

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

> **已登记的例外（exams 批次 1，批次 2 消除）**：写方法 `update`/`setStructure` 读旧考试行、
> `replaceQuestion` 读卷内旧配置，仍用**模块内私有**同步读（`findByIdSync` / `questionInExamSync`，不从门面导出）。
> 原因：本批只迁读方法，写方法的 SQL 与事务必须一行不动；若让它们 await 读方法会改动写路径的同步行为。
> 批次 2 把写方法迁 `AsyncDb` 时**必须删掉这两个函数**（届时写路径统一 `await this.findById`）。

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
9. **`unixepoch()`（方言 #19）**：`progressRepository.upsert` / `markQuizDone` 的 SQL 里直接用 `unixepoch()`（不只是 DEFAULT）；PG 无此函数，切流前换 `EXTRACT(EPOCH FROM now())::bigint`
10. **`MAX(a, b)` 标量形式（方言 #20）**：`lesson_progress` 的 upsert `DO UPDATE SET finished = MAX(finished, excluded.finished)`、`quiz_best = MAX(...)` —— SQLite 是标量两参 `max()`，PG 里 `MAX` 是聚合会直接报错；切流前改 `GREATEST(a, b)`（PG）或 `CASE WHEN`
11. **`date(col,'unixepoch','localtime')`（方言 #21）**：`activityRepository`（学习日历）用的 SQLite 修饰符语法；PG 需 `to_char(to_timestamp(col) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`。属 analytics 批次，未改
12. **`INSERT OR IGNORE` / `INSERT OR REPLACE`（方言 #22，exams 写批次）**：`exam-questions.addQuestions` 用 `INSERT OR IGNORE` 去重加题、`replaceQuestion` 用 `INSERT OR REPLACE` 保持卷内位置；PG 无此语法 → 改 `ON CONFLICT (exam_id, question_id) DO NOTHING` / 先 `DELETE` 再 `INSERT`（本来就在同一事务内）。**本批只读，未改**
13. **int8 字符串在读层的收敛（方言 #17 的落地）**：`COUNT/SUM/MAX(sort)` 在 PG 回传字符串。批次 1 的读方法（`listByCourseWithStats`/`attemptCount`/`pickCount`/`summarizeTaxonomy`/facets/points）已在仓储边界统一 `Number()`；`addQuestions` 的 `MAX(sort)` 也加了 `Number()`，**但写方法整体仍待批次 2**。全局 `types.setTypeParser(20)` 仍建议在切流前统一加
14. **`LIKE` 大小写（方言 #8 的确认站点）**：exam 题池的 `keyword`/`point`/`chapter`（`exam-pool-filter.ts`）与 `pointStats.point`（`exam-stats.ts`）依赖 SQLite 的 ASCII 大小写不敏感；PG 侧切流前统一换 `likeCI`/`ILIKE`

## 5. 测试基线

- `npx vitest run`：**987 passed / 7 skipped**（基线 939/6 → +lessons/courses 14 → +users/auth 4 → +progress/notes/watch 9 → +exams 只读 21；
  新增 `test/exam-read-async.test.ts` 21 条：19 个读方法逐个断言「返回 Promise 且只经 AsyncDb」+ int8 收敛 + 写方法不碰 AsyncDb；skip 里含 PG 集成测试，需 `MC_PG_TEST_URL`）
- `npx playwright test`：**40/40**
- `npx eslint .`：0 error（4 warning 为既有 console）
- `npm run build`、`node tools/check-file-size.mjs`（app.ts 362 行基线 382，624 个文件）

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

1. 继续剩余域：**exams 写 + attempts（批次 2）** → **analytics/stats/activity**（exams 只读已于本批完成；
   每域独立提交、sqlite 全绿、更新本文件进度表）
   批次 2 清单与风险见 §7.4.2。
2. 每域收尾照旧扫一遍 `reply.send(Promise)` / `{ id: service.x() }` 这类漏 await（本轮又抓到十余处，
   `tsc` 全部不报错；`requireUser` 保持同步返回 `req.authUser`，只有 `users.findById` 需要 await）
3. 全部域迁完后再排 PG 切流窗口（01:00–06:00），Runbook 见 `docs/postgres-migration.md` §12.2；
   切流前先清 §4 的方言 TODO（#19 `unixepoch()`、#20 `MAX(a,b)`、#21 `date(...,'unixepoch')`、#16 自然序、#17 int8 parser、#22 `INSERT OR IGNORE/REPLACE`）

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

### 7.4.2 批次 2 预估（exams 写 + attempts）

| 项               | 预估                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 方法数           | exam 写 12（create/update/delete/setStructure/setQuestionMeta/reorder/replaceQuestion/addQuestions/removeQuestion/applySection/clearQuestions + 平行卷抄结构）+ `attemptRepository` 7 + `WrongQuestionRepository` 5 |
| 必改方言         | `INSERT OR IGNORE/REPLACE` → `ON CONFLICT`/先删后插（#22）；`unixepoch()` 在错题本 upsert（#19）；`RETURNING id` 取代 `lastInsertRowid`（exam create、attempt create）                                              |
| 事务边界（重点） | 交卷 = 判分(纯内存) + `createAttempt` 落库 + 审计（`writeBuffered`）；组卷 = `clearQuestions` + `addQuestions` + 逐题 `setQuestionMeta`；批次 2 需把「交卷 + 错题本」纳入同一事务，并补「中途失败整批回滚」测试     |
| 缓存             | `submit` 读 `paperOf`、改卷/删题 `clearPaper`：写迁异步后必须保证「先失效缓存、再写库」或写成功后失效，避免交卷读到旧卷                                                                                             |
| 测试成本         | `exam-grading.test.ts` 已 async 化；批次 2 需再补交卷回滚测试（临时触发器制造中途失败，口径同 `progress-write-transaction.test.ts`）与错题本并发 upsert                                                             |
| 风险点           | 交卷是学生端高频写路径：`createAttempt` 改异步后要注意 sqlite `BEGIN IMMEDIATE` 与 PG 单连接事务的差异；`writeBuffered` 审计在事务外，回滚后不能留下「已交卷」审计                                                  |

## 8. 关键文件索引

| 主题                      | 文件                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| 异步数据端口              | `apps/api/src/db/async.ts`                                        |
| 驱动选择 / 单例           | `apps/api/src/db/driver.ts`                                       |
| PG 连接池                 | `apps/api/src/db/pg/pool.ts`                                      |
| 方言小工具（likeCI）      | `apps/api/src/db/sql.ts`                                          |
| PG DDL 生成               | `ops/scripts/pg/gen-schema.mjs`、`post-schema.pg.sql`             |
| 装载/校验                 | `ops/scripts/pg/load-pg.sh`、`verify-parity.sh`、`export-tsv.mjs` |
| 备份                      | `ops/deploy/pg-backup.sh`、`ops/deploy/backup.sh`                 |
| 预发 IO 门槛              | `ops/scripts/pg/guard-io.sh`                                      |
| 迁移总文档                | `docs/postgres-migration.md`                                      |
| lessons/courses 事务      | `apps/api/test/lesson-course-write-transaction.test.ts`           |
| users/auth 鉴权链路       | `apps/api/test/auth-async.test.ts`                                |
| progress/notes/watch 事务 | `apps/api/test/progress-write-transaction.test.ts`                |
| exams 只读契约（批次 1）  | `apps/api/test/exam-read-async.test.ts`                           |
| 卷面缓存口径              | `apps/api/test/exam-paper-cache.test.ts`                          |
