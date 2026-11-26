# PostgreSQL 迁移进度与交接文档

> 目的：换会话/换人也能无损接手。**最后更新：2026-11-27（收尾批次：5 个小仓储 + PG 集成测试实跑）**

## 0. 一句话现状

数据访问层已抽象出 `AsyncDb`（sqlite / PG 双栈）。已迁移：**公告、题库（banks，读写全量）、题目（questions，读写全量）、设置（settings 快照）、课时/课程（lessons/courses，读写全量）、用户/鉴权（users/auth，读写全量）、学习进度/观看区间/笔记（progress/watch/notes，读写全量）、考试（exams，读写全量 + 组卷事务）、刷题记录/错题本（attempts/wrong_questions，读写全量 + 交卷事务）、学情分析/学习统计/学习日历（analytics/stats/activity，只读聚合）、易错题挑题（`QuestionStatsRepository`，只读聚合）、冲突题台账（`QuestionConflictRepository`）、题组（`QuestionGroupRepository`）、知识点（`KnowledgeRepository`）、标签（`TagRepository`）、题库文件夹（`BankFolderRepository`）**。
生产仍 `MC_DB=sqlite`（2.4.1），**未切 PG**（本轮没有做任何切流动作）。
**代码侧迁移已全部收口**：主链路 + 5 个小仓储都已走 `AsyncDb`，体检子进程在 `MC_DB=pg` 时不再打开只读 SQLite。
**PG 集成测试已在真库实跑通过（51/51，`microclass_test`）** —— 见 §7.9 与 `docs/postgres-migration.md` §11.1。
剩下的是**切流动作**：预演（`docs/postgres-migration.md` §12.2）、数据一致性校验、备份、回滚演练、镜像重建；
以及 3 个仍用同步 `Db` 的非业务仓储（审计/体检缓存/练习链接，见 §7.9.3）。

## 1. 已完成域（按 commit）

| commit    | 域                       | 关键点                                                                                                            |
| --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `66e4e8f` | PG 运行形态              | 同机容器 `microclass-db`、数据目录 `/vol1/1000/microclass-pg`、DDL/装载工具链                                     |
| `3779721` | announcements + 地基     | `AsyncDb`、pg 连接池、driver 单例、`settings` 异步写 + 启动快照读                                                 |
| `0e95c6a` | banks 读（A）            | 目录/章节 7 方法                                                                                                  |
| `ed78803` | banks 读（B）            | `listBanks/countBanks/findBankWithStats`                                                                          |
| `acc72c6` | banks 读（C）            | `findById/findByName/kindStats/questionCount/绑定统计` + 10 个服务 async 化                                       |
| `88f0d48` | banks 写                 | 9 方法；`AsyncDb.transaction` 改造；回滚测试                                                                      |
| `b201ec4` | questions 写             | 16 方法；`RETURNING id`；批量写事务；回滚测试                                                                     |
| `da4a0ad` | lessons/courses 读写     | 36 方法；`RETURNING id`；删除/重排/改绑/收藏/分类走事务；服务与路由补 await                                       |
| `e95226b` | users / auth             | 10 方法；`RETURNING id`；**鉴权链路 `onRequest` 的 `users.findById` 补 await**；authService 全异步                |
| `8faa2dc` | progress/notes/watch     | 16 方法；区间 record 走事务（中途失败整批回滚）；笔记 `RETURNING id`；路由补 await                                |
| `0ae37a4` | exams 读（批次 1）       | 读 20 方法 + 题池/选题树/细目表/卷面缓存；写路径 SQL 未动；21 个契约测试                                          |
| `37fbadd` | exams 写 + attempts      | exam 写 12 方法 + 组卷事务；attempts/错题本读写 + 交卷事务；`RETURNING id`；方言 #19/#22/#23；19 条新测试         |
| `9be51a7` | analytics/stats/activity | 13 个只读方法 async；方言 #21 `unixDay`；方言 #24 JSON 展开；int8 `Number()`；16 条新测试                         |
| `ab535fb` | questions 读 + 易错题    | 19 个读方法 async + `app.ts` 注入 `asyncDb`；`QuestionStatsRepository` 改方言 JSON；方言 #16/#17/#20；31 条新测试 |
| `614a241` | 收尾：5 个小仓储         | 冲突台账/题组/知识点/标签/文件夹全迁 `AsyncDb`；体检子进程不再开 SQLite；方言 #26–#31；PG 集成测试 51/51 实跑     |
| `8d6a34f` | 部署加固                 | `redeploy.sh` 带 `-p microclass-prod` + 网络丢失自愈重试（数据卷保留）；排障见 `docs/deploy.md` §7.1              |
| `a667f09` | 稳定性补丁               | SQLite 页缓存 256 MB / mmap 2 GB / 只读 `query_only`                                                              |
| `cac6d05` | 部署护栏                 | api healthcheck `start_period` 60 s、`retries` 5                                                                  |
| `0aa7300` | 2.4.0                    | 版本与 CHANGELOG                                                                                                  |

## 2. 剩余域（实测规模）

| 域                                                                   | 规模                    | 备注                                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~questions 读（`QuestionRepository`）~~                             | ~~19 方法 / 47 调用点~~ | **已完成（`ab535fb`）**：读写同批走 `AsyncDb`，`app.ts` 注入 `asyncDb`；契约见 `test/question-read-async.test.ts`（含「create → findById 能读到」）     |
| ~~易错题统计（`QuestionStatsRepository`）~~                          | ~~2 方法 / 3 调用点~~   | **已完成（`ab535fb`）**：`json_each/json_extract` → `jsonArrayJoin/jsonIntField/jsonBoolIntField`（#24）；缓存命中不查库，`cachedAt()` 保持同步快照语义 |
| ~~`QuestionConflictRepository` / `QuestionGroupRepository`~~         | ~~冲突台账 + 题组~~     | **已完成（收尾批次）**：台账扫描/复核 + 题组 CRUD 全部 `AsyncDb`；`unixepoch()` 4 处 → `nowSeconds`（#19）；契约见 `test/repo-async-final.test.ts`      |
| ~~`KnowledgeRepository` / `TagRepository` / `BankFolderRepository`~~ | ~~同步 `Db` 小仓储~~    | **已完成（收尾批次）**：知识点 `RETURNING id` + 批量事务、标签 `ON CONFLICT DO NOTHING` + citext、文件夹 `IS NOT DISTINCT FROM`（#26/#27/#28）          |
| `auditRepository`（审计）                                            | 同步 `Db` + 内存缓冲    | **未迁**：PG 模式下审计仍写 SQLite。切流前必须决定「接受分库」还是「迁 AsyncDb」（建议后者，否则切流后审计与业务不同库）                                |
| `bankHealthCacheRepository`（体检缓存）                              | 同步 `Db`               | **未迁**：丢了只是重算，风险低；但 PG 模式下「体检结果」会落在 SQLite，切流清单里标注                                                                   |
| `practiceLinkQueries`（练习链接）                                    | 同步 `Db`               | **未迁**：业务数据（低频写入）；PG 模式下会写 SQLite，切流前需迁或确认可弃                                                                              |

> exams（读写全量，含组卷事务）与 attempts/错题本（含交卷事务）已在 `37fbadd` 迁完；
> 收藏（favorites）在 lessons/courses 批次（`da4a0ad`）内已迁；analytics/stats/activity 在 `9be51a7` 迁完；
> questions 读与易错题挑题在 `ab535fb` 迁完 —— **`MC_DB=pg` 下主链路（题库/题目/刷题/考试/统计）读写都在 PG**。
> 已迁域牵出的服务（stats/quiz/practiceLink/exam-lifecycle/lessonUnlock/note/difficulty 等）都 async 化了，
> 新增读方法时注意调用点仍要 `await`；`reply.send(<Promise>)` 依旧是 tsc 抓不到的坑
> （本批把 `banks-questions` / `banks-question-media` / `difficulty` / `exams-pool` 的 send 全部补了 await，
> 现存无 await 的 `reply.send(...)` 都只接受同步值：冲突台账的 list/rescan/detail/ignore/reopen）。

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
6. **`CAST(title AS INTEGER)`（lessons 自然序，方言 #16）— 已处理（`ab535fb`）**：`db/sql.ts` 新增
   `naturalNumberPrefix(column, driver)`（sqlite 原样 `CAST(title AS INTEGER)`；pg →
   `COALESCE(NULLIF(substring(trim(title) from '^[+-]?[0-9]+'), '')::bigint, 0)`），
   `lessonRepository` 的 `NATURAL_ORDER` 改成按 `adb().driver` 生成（`listAll`/`listByCourse` 两处）。
   SQLite 侧排序表达式逐字不变；PG 侧不再对「第X课」这类标题报 `invalid input syntax for integer`。
7. **int8（`COUNT/SUM/MAX`、`RETURNING id`）— 已处理（`ab535fb`）**：`db/pg/pool.ts` 加
   `types.setTypeParser(20, Number)`（驱动层全局兜底），仓储边界的 `Number()` 保持不动（双保险）。
   契约见 `test/question-read-async.test.ts` 的 `OID 20 → number` 用例。
8. 课时扫描的 `findMissingLessons` 判定回调**保持同步**（只做 `fs` 判定、不碰库）；落库步骤已 await —— 不要为了「全 async」把它改成异步，会打乱扫描顺序
9. **`unixepoch()`（方言 #19）— 已处理（`37fbadd`，`ab535fb` 补漏）**：新增 `db/sql.ts` 的 `nowSeconds(driver)`
   （sqlite → `unixepoch()`，pg → `(EXTRACT(EPOCH FROM now()))::bigint`）。已覆盖
   `wrong_questions` 的 upsert/掌握标记、`attempts` 相关写、`progressRepository.upsert`/`markQuizDone`，
   `ab535fb` 又补上 `question-difficulty` 的 `setDifficulty` / `setManualDifficulty`；
   SQLite 侧文本与迁移前完全一致（行为不变），PG 侧不再出现 SQLite 专有函数。
   ⚠️ 仍剩 `questionConflictRepository` 的 4 处 `unixepoch()`（该仓储整体未迁）。
   表 DEFAULT 的 `unixepoch()` 仍由生成器负责（§9 #5）。
10. **`MAX(a, b)` 标量形式（方言 #20）— 已处理（`ab535fb`）**：`db/sql.ts` 新增
    `maxOf(a, b, driver)`（sqlite `MAX(a,b)` / pg `GREATEST(a,b)`），`progressRepository.upsert` 的
    `finished` 与 `markQuizDone` 的 `quiz_best` 都改用它。NULL 语义差异已写在 `maxOf` 注释里
    （SQLite 标量 `max()` 遇 NULL 返回 NULL，PG `GREATEST` 忽略 NULL；写路径保证这两列非 NULL）。
    analytics/stats/activity 的 SQL 里没有两参 `MAX`（只有聚合 `MAX(score)`）。
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
    （含批次 1 的 exams 读、错题本 `count`/`list`、analytics/activity/stats 的计数与 id、`ab535fb` 的 questions 读
    `countByBank/countAll/countByMeta/health/pointStats/duplicateGroups/duplicateSummary`）已在仓储边界统一 `Number()`；
    写路径的 `RETURNING id`（`exams.create`、`exam_attempts.createAttempt`、`attempts.create`）同样 `Number()`；
    全局 `types.setTypeParser(20)` 已在 `ab535fb` 落到 `pg/pool.ts`（驱动层兜底）。
14. **`LIKE` 大小写（方言 #23）— 已处理（`37fbadd`）**：`exam-pool-filter` 的 `keyword`/`point`/`chapter`
    与 `exam-stats.pointStats.point` 全部改用 `likeCI`（`LOWER(列) LIKE LOWER(?)`），
    SQLite 侧行为不变（中文不受影响、ASCII 仍大小写不敏感），PG 侧不再依赖 SQLite 默认语义
15. **`json_each` / `json_extract`（方言 #24）— 已全部处理（analytics 批次 + `ab535fb`）**：`db/sql.ts` 新增
    `jsonArrayJoin`（sqlite `, json_each(col) alias` / pg `CROSS JOIN LATERAL jsonb_array_elements(col::jsonb) AS alias(value)`）、
    `jsonIntField`（`CAST(json_extract(...) AS INTEGER)` / `CAST(alias.value->>'field' AS INTEGER)`）、
    `jsonBoolIntField`（sqlite 原 `json_extract` 的 1/0/NULL；pg 用 `CASE ... ->> 'true'/'false'`，**保住 NULL 主观题**）。
    已覆盖 `analyticsRepository` 的练习 + 考试作答展开，`ab535fb` 又覆盖 `QuestionStatsRepository.errorByQuestion`
    （易错题挑题）：SQLite 侧 SQL 文本与迁移前一致，PG 侧不再出现 `json_each`/`json_extract`。
16. **`SUM(布尔表达式)`（新发现，`ab535fb`）**：`duplicateSummary` 的 `SUM(a > 1)` 在 SQLite 里能求和布尔值，
    PG 没有 `sum(boolean)`（`function sum(boolean) does not exist`），改成 `SUM(CASE WHEN a > 1 THEN 1 ELSE 0 END)`
    （两库语义一致）。写新的聚合 SQL 时**不要**把比较表达式直接塞进 `SUM`。

## 5. 测试基线

- `npx vitest run`：**1114 passed / 30 skipped**（收尾批次 +61；skip 从 7 → 30 是新增 `pg-core.test.ts` 14 条与
  `pg-final-repos.test.ts` 9 条默认 skip，设 `MC_PG_TEST_URL` 才会跑）
  - 收尾批次新增 `test/repo-async-final.test.ts` **61 条**：5 个仓储 52 个方法「返回 Promise 且只经 AsyncDb」逐条钉、
    int8 收敛（台账计数/组计数/标签题目数/文件夹汇总/RETURNING id）、#26/#27/#28 表达式契约、
    #29 源码扫描守卫（禁止裸 camelCase 别名）、#30 upsert SQL 守卫（自引用写全表名）、
    `app.ts` 注入断言、以及**路由层返回真实结构而非 `{}`**（题组/标签/文件夹/冲突台账/课程详情 knowledge——漏 await 会变 `{}`）
  - 真 PG 侧新增 `test/pg-core.test.ts`（14）+ `test/pg-final-repos.test.ts`（9），装置在 `test/helpers/pgTestDb.ts`
    - `test/fixtures/pg-schema.sql`；实跑结果见 §7.9.2
- `npx playwright test`：**40/40**
- `npm run typecheck`、`npx eslint .`：0 error（4 warning 为既有 console）
- `npm run build`、`npx prettier --check .`、`node tools/check-file-size.mjs`（**625 文件 / 技术债 20**）

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

## 7.7 `QuestionRepository` 读方法盘点（**已完成，`ab535fb`**；下面是当时的盘点原文）

> ✅ **状态：已在 `ab535fb` 清零**，本条保留作「为什么必须读写同批改」的项目记忆。
> 当时的结论：**19 个同步读方法 / 47 个 src 调用点**，而且 `app.ts` 是 `new QuestionRepository(db)`，
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

## 7.8 questions 读 + 易错题挑题迁移记录（2026-11-27，`ab535fb`）

### 7.8.1 本批做了什么

| 项                 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓储读方法（19）   | `question-query`：`listByBank`/`countByBank`/`listAll`/`countAll`/`findById`/`findByIds`/`listByLesson`/`searchByMeta`/`stemsByIds`；`question-stats`：`questionHealth`/`countByMeta`/`pointStats`/`difficultyStats`；`question-difficulty`：`difficultyFeatures`/`allDifficultyScores`/`difficultyScoreOf`/`answerStats`；`question-dedupe`：`duplicateGroups`/`duplicateSummary`/`duplicateIdsInBank` —— 全部 `AsyncDb` + `async`，`QuestionRepository` 门面同步改 `Promise`                                                                                                                                                                          |
| **DI（读写同批）** | `app.ts`：`new QuestionRepository(db)` → `new QuestionRepository(db, asyncDb)`；`new QuestionStatsRepository(db)` → `new QuestionStatsRepository(asyncDb)`。**只补 DI 不改读 = 写 PG 读 SQLite；只改读不补 DI = 写 SQLite 读 PG**，两者必须同一批                                                                                                                                                                                                                                                                                                                                                                                                       |
| 体检 worker        | `bankHealthPayload.computeGlobalHealthPayload` 里的 `new QuestionRepository(db)` 改成 `(db, asyncDb)`，`difficultyStats` 也改收 `AsyncDb`；worker 侧（`workers/bankHealthChild`）本来就按 `MC_DB` 建了 PG/sqlite 的 `AsyncDb`，现在题目聚合也走它（PG 模式不再从 SQLite 算体检）                                                                                                                                                                                                                                                                                                                                                                        |
| 易错题挑题         | `QuestionStatsRepository.errorByQuestion` 改 `async` + `AsyncDb`；`json_each`/`json_extract` 换 `jsonArrayJoin`/`jsonIntField`/`jsonBoolIntField`（#24）；`cachedAt()` **保持同步**（纯内存快照，与 `settings.getSync` 同类，不碰库）                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 调用点 await       | 10 个 service + 4 个路由：`bankQuestionService`（含 `listQuestionsGlobal`/`findQuestion`/`searchQuestions` 改 async）、`bankHealthService`（体检 + 去重，样例题干由逐组 `findById` 合并成一次 `findByIds`）、`bankCatalogService`、`bankExportService`×3、`bankService.detail`、`bankQuestionImageService.attachImage`、`difficultyService`（`stats`/`preview`/`apply`/`calibrate` + 私有 `scoreBatch`/`bankName`/`stemOf`/`allScores`/`question`/`answerStats` 全 async）、`quizService`×3、`paperReplace`、`practiceLinkService`、`questionConflictService.resolve`；路由 `banks-questions`×3、`banks-question-media`、`difficulty`×2、`exams-pool`×2 |
| `reply.send` 扫描  | 全量扫过 `reply.send(`：现存不带 `await` 的都只接受**同步值**（冲突台账 `list`/`rescan`/`detail`/`ignore`/`reopen`、`buildPoolQuestions` 已 await）；本批改动的 4 个路由全部补了 `await`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 方言 #16           | `db/sql.ts` 新增 `naturalNumberPrefix`：sqlite 原样 `CAST(title AS INTEGER)`；pg `COALESCE(NULLIF(substring(trim(title) from '^[+-]?[0-9]+'), '')::bigint, 0)`。`lessonRepository` 的 `NATURAL_ORDER` 改成按 `adb().driver` 生成（只在 lessons 排序处用）                                                                                                                                                                                                                                                                                                                                                                                               |
| 方言 #17           | `db/pg/pool.ts` 加 `types.setTypeParser(20, Number)`（驱动层全局兜底）；questions 读的计数/聚合仍在仓储边界 `Number()`（双保险）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 方言 #20           | `db/sql.ts` 新增 `maxOf(a, b, driver)`：sqlite `MAX(a,b)` / pg `GREATEST(a,b)`；`progressRepository.upsert` 的 `finished`、`markQuizDone` 的 `quiz_best` 改用（NULL 语义差异写在注释里）                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 方言 #19 补漏      | `question-difficulty` 的 `setDifficulty` / `setManualDifficulty` 里 2 处 `unixepoch()` 改 `nowSeconds(driver)`（原先漏在难度写路径）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 方言 #25（新发现） | `duplicateSummary` 的 `SUM(a > 1)` 在 PG 不存在（`sum(boolean)` 报错），改 `SUM(CASE WHEN a > 1 THEN 1 ELSE 0 END)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 测试               | 新增 `test/question-read-async.test.ts` 31 条（见 §5）；`question-write-transaction.test.ts` 的 4 处同步读补 `await`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 门禁               | vitest **1053 passed / 7 skipped**（+31）、E2E 40/40、typecheck 0、eslint 0（4 既有 warning）、prettier、build、size guard（624 文件，app.ts 未增长，仍 382）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 7.8.2 本批没有做的事（切流前清单）

- **PG 集成测试**：本批所有断言都在 SQLite 上跑（硬规则：只用 SQLite 验证）。`MC_PG_TEST_URL` 分支
  （`pg-announcements.test.ts` 等）仍需在非生产机、非 NVMe 的窗口里实跑一次；
- **切流预演**：`docs/postgres-migration.md` §12.2（停 API → 备份 SQLite → `MC_DB=pg` → 起新镜像 → 冒烟 → 回滚），
  需要用户确认窗口，本批**没有**执行；
- **未迁的小仓储**：`QuestionConflictRepository`（台账 + 全库指纹扫描，内部 4 处 `unixepoch()`）、
  `QuestionGroupRepository`、`KnowledgeRepository`、`TagRepository`、`BankFolderRepository` 仍是同步 `Db`。
  PG 模式下这些读写会落回 SQLite（切流清单里要标注），但不阻塞主链路（题库/题目/刷题/考试/统计）；
- **难度 `preview`/`calibrate` 的 PG 行为**：SQL 文本未变（无新方言），但 `calibrate` 现在逐题 `await`，
  PG 下是 N 次小查询（原先同步同数量）—— 若真机上候选人很多，切流后再评估批量取。

## 7.9 收尾批次：5 个小仓储 + 体检子进程 + PG 集成测试实跑（2026-11-27，`614a241`）

### 7.9.1 本批做了什么

| 项                    | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 冲突题台账            | `QuestionConflictRepository` 11 方法全改 `AsyncDb`/`async`：`sync`（全库分组 + 台账写入改 `AsyncDb.transaction`，**事务内所有语句走 `tx`**，题干样例查询也跟着走 `tx`）、`staleness`、`list`（**顺带返回本页答案分布**，省掉一次 `answersFor` 往返）、`questions`/`answers`/`answersFor`/`find`/`upsertStatus`/`counts`。**4 处 `unixepoch()` → `nowSeconds(driver)`**（#19：`markSynced` 2 处 + `upsertStatus` 2 处）                                                                                                                                                                                                  |
| 冲突台账拆文件        | 只读 SQL 拆到新文件 `question-conflict-queries.ts`（`listConflicts`/`conflictQuestions`/`conflictAnswers`/`answersForHashes`/`findConflict`/`conflictCounts`）：本文件在行数守卫基线里（304 行只能减不能增），拆完 **304 → 262**，已从 `tools/file-size-baseline.json` 删除（技术债 21 → 20）                                                                                                                                                                                                                                                                                                                           |
| 题组                  | `QuestionGroupRepository` 15 方法 async；`create` 改 `INSERT … RETURNING id`（#14）；`datetime('now')` → `nowText(driver)`（#26）；`ORDER BY … i.rowid` → `insertionOrder(alias, driver)`（#28：sqlite `rowid` / pg `question_id`）；列表关键词改 `likeCI`（#8）                                                                                                                                                                                                                                                                                                                                                        |
| 知识点                | `KnowledgeRepository` 9 方法 async；`create` 用 `RETURNING id`；`createMany` 改 `AsyncDb.transaction(async tx)` 且**逐条走 `tx`**（`create(input, tx)`）；`maxSort`/`created_at` 等 int8 收敛（#17）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 标签                  | `TagRepository` 11 方法 async；`INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`（#22，两库同一句）；`name COLLATE NOCASE` → `nocase(col, driver)`（#6：PG 侧 `tags.name` 是 citext）；列表/回显排序与搜索统一 `likeCI`；`RETURNING id`；`questionCount`/`tagIdsOfQuestions` 的 int8 收敛                                                                                                                                                                                                                                                                                                                                   |
| 题库文件夹            | `BankFolderRepository`（`bankFolderQueries.ts`）12 方法 async；`parent_id IS ?` → `nullSafeEq(col, driver)`（#27：PG 的 `IS` 不接受参数，改 `IS NOT DISTINCT FROM`）；`insert` 用 `RETURNING id`；`directCounts`/`unfiled`/`courseSummary` 的 `COUNT/SUM` 收敛成 number                                                                                                                                                                                                                                                                                                                                                 |
| DI（读写同批）        | `app.ts`：`new KnowledgeRepository(asyncDb)`、`new QuestionConflictRepository(asyncDb)`；`BankService` 里 `new BankFolderRepository(banks.asyncPort())`（`BankRepository` 新增 `asyncPort()`，**保证文件夹与题库用同一个 asyncDb**）；`routes/questionGroups.ts`/`routes/tags.ts` 用 `getAsyncDb(deps.config, deps.db)` 取进程级单例（`app.ts` 已到行数基线，不再加字段）                                                                                                                                                                                                                                               |
| 调用点 await          | 12 个服务 + 6 个路由：`questionConflictService`（freshness/rescan/list/detail/ignore/reopen/collectPendingGroups 全 async）、`questionGroupService`、`tagService`、`bankFolderService`（tree/exists/create/update/remove/nodeOf/isDescendant）、`bankService.create/update`、`courseKnowledgeService`、`lessonKnowledgeService`、`lessonKnowledgeExportService`、`knowledgeImportService`、`knowledgeImportPlanner`（`nextSort` → async）、`lessonService`（detail 的 knowledge、update/removeKnowledge 转发）；路由 `questionConflicts`×8、`questionGroups`×7、`tags`×6、`banks-folders`×5、`knowledge`×3、`courses`×1 |
| `reply.send(Promise)` | 全量扫过：`questionConflicts` 的 `reply.send(...)` **全部补 `await`**（原来 detail/ignore/reopen/rescan 是「同步值」，迁完变 Promise，漏 await 会返回 `{}`）；顺手扫了 `utils/range`、`courseCover`、`banks-question-media`（都是 stream，同步）与 `difficulty`（已 await）                                                                                                                                                                                                                                                                                                                                             |
| 体检子进程            | `workers/bankHealthChild.ts`：`MC_DB=pg` 时**只连 PG**（`AsyncDb` 即连接池），`db` 传 `null`、**不打开只读 SQLite**，`MC_HEALTH_DB` 不再是必需项（sqlite 模式行为完全不变）。配套：`QuestionRepository`/`BankRepository` 的 `db` 参数放宽为 `Db \| null`，`adb()` 在「既没 asyncDb 又没 db」时抛明确错误（而不是静默退回 SQLite）                                                                                                                                                                                                                                                                                       |
| 新方言                | #26 `nowText`、#27 `nullSafeEq`、#28 `insertionOrder`（新增到 `db/sql.ts`）；#29 camelCase 别名加引号（33 处）、#30 `ON CONFLICT DO UPDATE` 自引用写全表名、#31 `gen-schema.mjs` 补 `ON DELETE CASCADE` —— 后 3 条都是**真库跑出来的 bug**，详见 `docs/postgres-migration.md` §9 与 §11.1                                                                                                                                                                                                                                                                                                                               |
| 测试                  | 新增 `test/repo-async-final.test.ts` 61 条（52 个方法「返回 Promise 且只经 AsyncDb」逐条钉、int8 收敛、4 个新方言表达式、#29 源码扫描守卫、#30 upsert SQL 守卫、`app.ts` 注入断言、**路由返回真实结构而非 `{}`**）；新增 `test/pg-core.test.ts` 14 条 + `test/pg-final-repos.test.ts` 9 条（真 PG，见 §7.9.2）；`test/helpers/pgTestDb.ts`（测试库守卫 + 整份 schema 重建）与 `test/fixtures/pg-schema.sql`（生成器产出的同构 schema）                                                                                                                                                                                  |
| PG 集成测试           | **在 NAS 的一次性容器里对 `microclass_test` 实跑：5 个文件 / 51 条全过**（详见 §7.9.2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 门禁                  | vitest **1114 passed / 30 skipped**（+61 passed；skip 从 7 → 30 是因为新增 2 个 PG 套件默认 skip）；E2E **40/40**；typecheck 0；eslint **0 error**（4 既有 warning）；prettier；build；size guard（**625 文件 / 技术债 20**）                                                                                                                                                                                                                                                                                                                                                                                           |

### 7.9.2 PG 集成测试实跑（真库，一次性容器）

**环境**：NAS `FN-EVO4-4723`；一次性容器 `--rm --network microclass-prod_default --cpus 2 --memory 2g`（node:22-alpine）；
连 `db:5432` 的 **`microclass_test`**（**不是生产库 `microclass`**）；源码只读挂载后容器内 `npm ci`；
跑前 `ops/scripts/pg/guard-io.sh` 报 `/vol1 util=20%`（阈值 70）。生产 `microclass-api` 未被本测试启停（测试库与生产库同实例但不同 database）。

**结果：`Test Files 5 passed (5) / Tests 51 passed (51)`**

| 文件                                      | 条数 | 覆盖                                                                                                                                                                                                   |
| ----------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pg-core.test.ts`                         | 14   | questions 读写（RETURNING/int8/聚合）、banks 事务回滚、刷题交卷事务、考试交卷事务、progress 区间（GREATEST + 先删后插回滚）、analytics 全方言（JSON 展开/UTC 日/int8/主观题排除）                      |
| `pg-final-repos.test.ts`                  | 9    | 本批 5 个仓储在真 PG 上的行为：冲突台账 `sync/staleness/list/upsertStatus`、题组行序与计数、知识点 `createMany` 事务、标签 citext + `ON CONFLICT`、文件夹 `IS NOT DISTINCT FROM` + 汇总 + **级联删除** |
| `pg-announcements.test.ts`                | 4    | 既有基线                                                                                                                                                                                               |
| `bank-write-transaction.test.ts`          | 9    | 8 条 sqlite + 1 条 PG 分支（`BEGIN/ROLLBACK` 整批回滚）                                                                                                                                                |
| `lesson-course-write-transaction.test.ts` | 15   | 14 条 sqlite + 1 条 PG 分支（`RETURNING id` + 事务回滚）                                                                                                                                               |

**这一轮真库跑出来的 4 个真 bug（都已修，且都补了守卫测试）**：

1. **`MAX(0, question_count + ?)`**（`question-write.bumpBankCount`）—— PG `function max(integer, bigint) does not exist`。
   **影响：PG 模式下新建/删除题目直接 500**。改 `maxOf('0', 'question_count + ?', driver)`（#20 残留）。
2. **camelCase 别名被 PG 小写**（7 文件 33 处 `AS questionCount` → `questioncount`）——
   **影响：题库列表的 `folderId/courseName/lessonTitle`、目录计数、题组/标签/文件夹计数全部静默 `undefined`/0，不报错**。
   全部加双引号（#29），并在 `repo-async-final.test.ts` 里加「源码扫描：禁止裸 camelCase 别名」守卫。
3. **`ON CONFLICT DO UPDATE SET x = x + 1` 歧义引用**（`wrong_questions`、`lesson_progress`）——
   PG `column reference "wrong_count" is ambiguous`。**影响：刷题交卷、进度上报直接失败**。改全表名（#30）+ SQL 文本守卫。
4. **`gen-schema.mjs` 丢掉 `ON DELETE CASCADE`**（21 个外键退化成 `NO ACTION`）——
   **影响：PG 下删题组/题库/标签报外键冲突，删除功能不可用**。生成器改为搬运 `PRAGMA foreign_key_list` 的
   `on_delete`/`on_update`（#31），测试 fixture 重新生成并验证「删题组级联删成员」。

> 这 4 条都是「SQLite 全绿、切 PG 才炸」的典型：**每个域迁完必须真库跑一遍**，`tsc` + sqlite 测试都抓不到。

### 7.9.3 切流前剩余清单（本批收尾后）

代码侧已经全部迁完，**剩下都是「动作」**（完整版见 `docs/postgres-migration.md` §12.3）：

1. **审计日志仍在 SQLite**（`auditRepository` 同步 `Db` + 内存缓冲）—— 切流后审计与业务不同库，需先决定：迁 `AsyncDb`（建议）或明确接受分库；
2. `bankHealthCacheRepository`（体检缓存，可丢）与 `practiceLinkQueries`（练习链接，业务数据，**建议迁**）仍是同步 `Db`；
3. **切流预演（§12.2）没做**：停 API → 备份 SQLite → `MC_DB=pg` → 起新镜像 → 10 条验证 → 回滚路径，需要用户确认窗口；
4. 数据一致性未校验：`verify-parity.sh` 10 组指纹 + `schema_migrations` 对齐（重活，只在窗口内跑）；
5. 备份（`pg_dump -Fc` + SQLite 卷 tar）与回滚演练未做；
6. **新镜像未构建**：`.image-tag` 仍是 `2.4.1`（本批代码含 #29/#30/#31 修复，切流前要 `build-image.sh` 重新出镜像）；
7. 难度 `preview`/`calibrate` 在 PG 下是逐题小查询（N 次），切流后按真机数据量再评估批量取。

## 7.10 生产事故：compose 网络丢失导致 API 起不来（2026-11-27，已修复，加固 `8d6a34f`）

**现象**：用户报 `docker compose up` 失败 `failed to set up container networking: network 123cf6… not found`；
8091 全站不可用（8092 前端反代返回 502 `upstream_unavailable`），watchdog 每 2 分钟 `docker restart microclass-api` 均失败。

**根因**（三层叠加）：

1. 宿主机上有**两套历史项目**：老项目 `microclass`（网络 `microclass_default`，ID `123cf6…`）与新项目 `microclass-prod`（网络 `microclass-prod_default`）。
   老网络 `microclass_default` 已被删除（`docker network ls` 里不存在），但老容器 `microclass-api`（image `microclass:2.3.0`）仍引用那个已消失的 NetworkID；
2. `microclass-api` 这个**容器名**被老容器占着，`compose -p microclass-prod up` 无法创建同名容器；而 `redeploy.sh` 调 compose 时**没带 `-p`**，靠文件里的 `name:` 兜底，一旦项目名/网络名漂移就会踩到老容器；
3. 另有一个「容器已被删除、进程还在」的孤儿 API 进程（pid 707273，cgroup 指向已不存在的容器 `778463b8…`），
   仍在旧 netns 里监听 172.26.0.2:8091（宿主不可达）—— 它不占宿主端口，但会误导排查、并占着数据卷里的 SQLite 句柄。

**修复动作**（全程 `-v` 未使用，数据卷 `microclass_data` / `/vol1/1000/microclass-pg` 原样保留）：

```bash
cd /vol1/1000/microclass-deploy
kill -9 707273                                   # 孤儿进程（其容器已不存在）
docker rm -f microclass-api                      # 老项目残留容器（引用已删除网络）
docker volume inspect microclass_data            # 确认卷与 microclass.db 仍在
docker compose -p microclass-prod -f compose.evo4.yml down --remove-orphans   # 不带 -v
docker compose -p microclass-prod -f compose.evo4.yml up -d
```

**验证结果**：`microclass-api` `Up (healthy)`（image `microclass:2.4.1`）、`microclass-db` healthy，两者都在 `microclass-prod_default`；
8091/8092/8093 的 `healthz`/`readyz` 全 200（healthz 1.3 ms），`version=2.4.1`；admin 登录 200 + `Set-Cookie`；
`/courses` 200（17 KB）、`/banks` 200（135 KB，冷缓存 3.1 s）、`/tags` 200、`/question-groups` 200；8092 前端首页 200。
网络列表只剩 `microclass-prod_default`，无引用旧网络的残留容器。

**加固**（随本批提交）：`ops/deploy/redeploy.sh` 统一带 `-p microclass-prod`，并在启动失败且日志含
`network … not found` / `container name … already in use` 时自动执行 `down --remove-orphans`（**不带 `-v`**）后重试一次；
`docs/deploy.md` 增加「network not found」排障小节。

## 8. 关键文件索引

| 主题                                                                             | 文件                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 异步数据端口                                                                     | `apps/api/src/db/async.ts`                                         |
| 驱动选择 / 单例                                                                  | `apps/api/src/db/driver.ts`                                        |
| PG 连接池                                                                        | `apps/api/src/db/pg/pool.ts`                                       |
| 方言小工具（likeCI / nowSeconds / unixDay / JSON / naturalNumberPrefix / maxOf） | `apps/api/src/db/sql.ts`                                           |
| PG DDL 生成                                                                      | `ops/scripts/pg/gen-schema.mjs`、`post-schema.pg.sql`              |
| 装载/校验                                                                        | `ops/scripts/pg/load-pg.sh`、`verify-parity.sh`、`export-tsv.mjs`  |
| 备份                                                                             | `ops/deploy/pg-backup.sh`、`ops/deploy/backup.sh`                  |
| 预发 IO 门槛                                                                     | `ops/scripts/pg/guard-io.sh`                                       |
| 迁移总文档                                                                       | `docs/postgres-migration.md`                                       |
| lessons/courses 事务                                                             | `apps/api/test/lesson-course-write-transaction.test.ts`            |
| users/auth 鉴权链路                                                              | `apps/api/test/auth-async.test.ts`                                 |
| progress/notes/watch 事务                                                        | `apps/api/test/progress-write-transaction.test.ts`                 |
| exams 读写契约                                                                   | `apps/api/test/exam-read-async.test.ts`                            |
| exams 写方言契约（批次 2）                                                       | `apps/api/test/exam-write-async.test.ts`                           |
| exams/attempts 事务与回滚                                                        | `apps/api/test/exam-write-transaction.test.ts`                     |
| 卷面缓存口径                                                                     | `apps/api/test/exam-paper-cache.test.ts`                           |
| analytics 只经 AsyncDb + 方言                                                    | `apps/api/test/analytics-async.test.ts`                            |
| analytics/activity 日期与 int8 对照                                              | `apps/api/test/analytics-date-parity.test.ts`                      |
| questions 读只经 AsyncDb + 读后写可见 + 方言 16/17/20                            | `apps/api/test/question-read-async.test.ts`                        |
| 收尾 5 仓储只经 AsyncDb + 新方言 #26–#30 契约                                    | `apps/api/test/repo-async-final.test.ts`                           |
| PG 集成测试装置（建库守卫 + 同构 schema）                                        | `apps/api/test/helpers/pgTestDb.ts`、`test/fixtures/pg-schema.sql` |
| PG 核心链路实跑（questions/banks/交卷/progress/analytics）                       | `apps/api/test/pg-core.test.ts`                                    |
| PG 收尾仓储实跑（冲突/题组/知识点/标签/文件夹）                                  | `apps/api/test/pg-final-repos.test.ts`                             |
| compose 网络故障排障（network not found）                                        | `docs/deploy.md` §「network not found」、`ops/deploy/redeploy.sh`  |
