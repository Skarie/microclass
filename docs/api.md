# API 一览（v1）

统一前缀：`/api/v1`。统一错误信封：

```json
{ "error": { "code": "BAD_REQUEST", "message": "请求参数校验失败", "requestId": "…", "details": {} } }
```

错误码：`BAD_REQUEST` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `RATE_LIMITED` 429 · `INTERNAL` 500。

## 健康与元信息

| 方法 | 路径       | 权限 | 说明                           |
| ---- | ---------- | ---- | ------------------------------ |
| GET  | `/healthz` | 公开 | 存活探针                       |
| GET  | `/readyz`  | 公开 | 就绪探针（含数据库探测）       |
| GET  | `/version` | 公开 | 版本 / 环境 / Node 版本        |
| GET  | `/meta`    | 公开 | 站点名、当前用户、是否开放注册 |

## 认证

| 方法 | 路径             | 权限 | 说明                                                           |
| ---- | ---------------- | ---- | -------------------------------------------------------------- |
| POST | `/auth/login`    | 公开 | `{username,password}` → 设置会话 Cookie                        |
| POST | `/auth/register` | 公开 | `{username,password,displayName?}`（受 `allow_register` 控制） |
| POST | `/auth/logout`   | 公开 | 清除 Cookie                                                    |
| GET  | `/me`            | 登录 | 当前用户                                                       |
| PUT  | `/me/password`   | 登录 | `{oldPassword,newPassword}`                                    |

## 课程与分类

| 方法   | 路径                 | 权限        | 说明                                                                  |
| ------ | -------------------- | ----------- | --------------------------------------------------------------------- |
| GET    | `/courses`           | 登录        | 课程列表（含分类名、课时统计、当前用户进度与收藏）+ 分类 + 未归类统计 |
| GET    | `/courses/:id`       | 登录        | 课程详情 + 课时（含进度）；学生不可见草稿                             |
| POST   | `/courses`           | 教师/管理员 | 新建课程（分类、发布开关）                                            |
| PUT    | `/courses/:id`       | 教师/管理员 | 更新课程                                                              |
| DELETE | `/courses/:id`       | 管理员      | 删除课程（课时回到未归类，不删数据）                                  |
| POST   | `/courses/:id/fav`   | 登录        | 收藏/取消收藏（幂等切换）                                             |
| POST   | `/courses/:id/cover` | 教师/管理员 | 上传封面（multipart，字段名 `file`）                                  |
| GET    | `/course-cover/:id`  | 登录        | 读取封面                                                              |
| GET    | `/categories`        | 登录        | 分类列表                                                              |
| POST   | `/categories`        | 教师/管理员 | 新建分类                                                              |
| DELETE | `/categories/:id`    | 管理员      | 删除分类（课程置为无分类）                                            |

## 课时与知识点

| 方法   | 路径                           | 权限        | 说明                               |
| ------ | ------------------------------ | ----------- | ---------------------------------- |
| GET    | `/lessons?course=<id\|orphan>` | 登录        | 课时列表（含进度）                 |
| GET    | `/lessons/:id`                 | 登录        | 课时详情 + 知识点                  |
| POST   | `/lessons`                     | 教师/管理员 | 新建课时（本地/嵌入/直链）         |
| POST   | `/lessons/upload`              | 教师/管理员 | 上传视频并生成课时（见下）         |
| PUT    | `/lessons/:id`                 | 教师/管理员 | 更新课时                           |
| DELETE | `/lessons/:id`                 | 教师/管理员 | 删除课时                           |
| GET    | `/lessons/:id/video`           | 登录        | 本地视频流（支持 HTTP Range）      |
| POST   | `/lessons/batch-assign`        | 教师/管理员 | 批量改绑归属（见下）               |
| GET    | `/knowledge/:id/file`          | 登录        | 知识点文件下载/内联                |
| POST   | `/lessons/:id/knowledge`       | 教师/管理员 | 新增知识点（文本/链接/文件）       |
| PUT    | `/knowledge/:id`               | 教师/管理员 | 更新知识点标题与正文/链接          |
| DELETE | `/knowledge/:id`               | 教师/管理员 | 删除知识点（同时清理文件）         |
| GET    | `/courses/:id/knowledge.md`    | 教师/管理员 | 导出整门课程知识点讲义（Markdown） |
| GET    | `/courses/:id/knowledge.docx`  | 教师/管理员 | 导出整门课程知识点讲义（Word）     |
| GET    | `/lessons/:id/knowledge.md`    | 教师/管理员 | 导出单个课时的知识点（Markdown）   |
| GET    | `/lessons/:id/knowledge.docx`  | 教师/管理员 | 导出单个课时的知识点（Word）       |

**知识点讲义导出**（`knowledge.md` / `knowledge.docx`）

- 课程级按 **章节 → 课时** 组织；课时级直接列知识点（不套章节层级）；
- 文本类导出正文，链接类导出可点链接，附件类导出**文件名**（文件本身走 `/knowledge/:id/file` 下载）；
- 导出的是标准 .docx（ZIP + OOXML，可直接用 Word/WPS 打开），课程没有知识点时也会给出「暂无知识点」而不是报错。

**批量改绑** `POST /lessons/batch-assign`

```jsonc
{
  "lessonIds": [12, 13, 14], // 要改绑的课时 id（去重，最多 2000 个）
  "courseId": 6, // 目标课程；传 null 表示移出课程、回到「未归类」
  "groupName": "第一章 Java 基础", // 可选：统一章节名；省略则各自保留原章节
}
// → { "ok": true, "updated": 3, "courseId": 6, "groupName": "第一章 Java 基础" }
```

改绑是改归属、不复制数据（课时内容、学习进度、刷题记录都跟随保留）；会写入审计日志 `lesson.batch_assign`。

**网页直接上传视频** `POST /lessons/upload`（multipart）

| 字段        | 必填 | 说明                                                      |
| ----------- | ---- | --------------------------------------------------------- |
| `file`      | 是   | 视频文件；扩展名须在 `mp4/webm/mov/mkv/avi/flv/ts/m4v` 内 |
| `courseId`  | 否   | 目标课程 id；不传则成为「未归类课时」                     |
| `groupName` | 否   | 统一章节名                                                |
| `relPath`   | 否   | 上传时的相对路径，用于自动推断章节（取顶层目录名）        |
| `sort`      | 否   | 排序值                                                    |

```jsonc
// → { "ok": true, "id": 128, "size": 10485760, "fileName": "第01讲.mp4" }
```

- 文件**流式写盘**（不经过内存），落到 `<MC_DATA_DIR>/uploads/videos/`；
- 视频自动登记到内置媒体目录 `uploads`（显示名「站内上传（课程视频）」，不可删除），播放走与本地视频一致的 Range 流；
- 单个文件上限 `MC_MAX_VIDEO_MB`（默认 2048 MB）。

## 媒体文件夹

| 方法   | 路径                            | 权限        | 说明                               |
| ------ | ------------------------------- | ----------- | ---------------------------------- |
| GET    | `/media-roots`                  | 教师/管理员 | 列表（可用性 + 引用课时数）        |
| POST   | `/media-roots`                  | 教师/管理员 | 添加文件夹（保存时校验存在且可读） |
| DELETE | `/media-roots/:id`              | 教师/管理员 | 移除（有课时引用时拒绝）           |
| GET    | `/media-roots/:id/browse?path=` | 教师/管理员 | 目录浏览（选视频）                 |
| GET    | `/media-roots/:id/scan?path=`   | 教师/管理员 | 按子文件夹扫描视频（导入预览）     |
| POST   | `/media-roots/:id/import`       | 教师/管理员 | 批量导入（见下）                   |
| GET    | `/fs/browse?path=`              | 登录        | 服务器目录浏览（选择文件夹）       |

**批量导入** `POST /media-roots/:id/import`

```jsonc
{
  "path": "", // 相对媒体根的子路径；留空表示整棵树
  "courseId": 6, // 三选一：导入到已有课程
  "courseName": "Java 程序设计", // 三选一：用这个名字新建课程后导入（返回 course）
  "onDuplicate": "assign", // skip（默认，跳过已存在）| assign（把已存在课时收编到目标课程）
}
// → { "ok": true, "added": 30, "skipped": 0, "assigned": 0, "folders": 3, "course": null }
```

- `courseId` 与 `courseName` 互斥（同时传 → 400）；
- 子文件夹名 → 章节（`group_name`）；选中子文件夹导入时，该文件夹自身的直接视频章节名取该文件夹名；
- 「收编」（`onDuplicate: "assign"`）解决「先把视频导进来、之后才建课程」时再导入却零归入的问题；
- 导入只登记「媒体目录 + 相对路径」，不复制视频文件；重复视频默认跳过。

## 课程文件夹（课程 → 课时 的日常维护路径）

课程可以绑定一个媒体文件夹（`courses.folder_root_id` + `folder_path`），之后「加了新课就扫描一下」：

| 方法 | 路径                         | 权限        | 说明                                                               |
| ---- | ---------------------------- | ----------- | ------------------------------------------------------------------ |
| GET  | `/courses/:id/manage`        | 教师/管理员 | 课程 + 课时（含进度）+ 文件夹绑定情况（管理页用）                  |
| PUT  | `/courses/:id/folder`        | 教师/管理员 | 绑定/更换/解绑（`{rootId, path}`；`rootId: null` 解绑）            |
| POST | `/courses/:id/scan`          | 教师/管理员 | 扫描文件夹并导入课时（`dryRun` / `removeMissing` / `chapterMode`） |
| PUT  | `/courses/:id/lessons/order` | 教师/管理员 | 保存课时顺序（`{ids:[...]}`，必须是该课程全部课时的一个排列）      |

**绑定** `PUT /courses/:id/folder`

```jsonc
{ "rootId": "mmtyn1kte", "path": "Java 程序设计" } // path 留空 = 整个媒体目录
// rootId 传 null 即解绑：已导入的课时保留，只是不再与磁盘联动
```

- 路径经 `../` 越界校验，目录必须存在且可访问（400 明确说明原因）；
- **一个文件夹只能绑定一门课程**，重复绑定返回 409 并指出占用它的课程。

**扫描** `POST /courses/:id/scan`

```jsonc
{
  "dryRun": true, // 只统计不写库（界面上用来先给老师看预览）
  "removeMissing": false, // 顺带清理「扫描导入且磁盘文件已消失」的课时
  "onDuplicate": "assign", // assign（默认，把同路径课时收编到本课程）| skip
  "chapterMode": "first", // first（默认，课程文件夹下第一层目录）| full（完整相对路径）| none（不设章节）
}
// → { dryRun, courseId, folder, onDisk, folders, added, assigned, updated,
//     skipped, missing: [{id,title,videoPath,source}], removed, total, newLessonIds }
```

- `chapterMode` 决定章节怎么取：素材常按「章 / 节 / 视频」多层放（例如 `第一章 有理数/3.1 乘方/xx.mp4`），
  默认 `first` 只取第一层当章节，`full` 取完整相对路径；
- 课程文件夹自身的直接视频 → 章节为空（未分章）；
- 新课时插到「同章节最后一条之后」，手工拖拽的顺序不会被下一次扫描打乱；
- `source = 'folder'`（扫描导入）的课时章节名随文件夹同步（换 `chapterMode` 重扫会更新它们）；
  `source = 'manual'`（手工/上传）的课时**章节不会被改写、也永远不会被自动删除**，文件消失时只在 `missing` 里提示；
- 扫描成功后更新 `courses.last_scan_at`，新增课时进入**后台串行抽取队列**（同一时刻只跑一个 ffprobe/ffmpeg，
  避免批量导入时并发抽帧把容器内存打爆；不阻塞响应）。

## 题库与题目

| 方法   | 路径                     | 权限        | 说明                                                                                 |
| ------ | ------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| GET    | `/banks?lessonId=`       | 登录        | 题库列表（含题目数）                                                                 |
| POST   | `/banks`                 | 教师/管理员 | 新建题库                                                                             |
| PUT    | `/banks/:id`             | 教师/管理员 | 重命名 / 改关联课时                                                                  |
| DELETE | `/banks/:id`             | 管理员      | 删除题库（题目一并删除）                                                             |
| GET    | `/banks/:id/questions`   | 登录        | 题目分页列表（题型/难度/关键词筛选；`mediaOnlyAnalysis=1` 只看「解析只有图片」的题） |
| POST   | `/banks/:id/questions`   | 教师/管理员 | 新增题目                                                                             |
| PUT    | `/questions/:id`         | 教师/管理员 | 更新题目                                                                             |
| DELETE | `/questions/:id`         | 教师/管理员 | 删除题目                                                                             |
| POST   | `/questions/:id/image`   | 教师/管理员 | 上传题目配图（图片白名单）                                                           |
| GET    | `/question-images/:id`   | 登录        | 读取题目配图                                                                         |
| GET    | `/question-media/:file`  | 登录        | 读取题库导入的配图（内容寻址，可长缓存）                                             |
| POST   | `/banks/:id/import`      | 教师/管理员 | 导入题目（CSV / Markdown / Word，见下）                                              |
| GET    | `/banks/:id/export.csv`  | 教师/管理员 | 导出 CSV                                                                             |
| GET    | `/banks/:id/export.md`   | 教师/管理员 | 导出 Markdown                                                                        |
| GET    | `/banks/:id/export.docx` | 教师/管理员 | 导出 Word（配图内嵌）                                                                |
| GET    | `/banks/template.csv`    | 教师/管理员 | CSV 导入模板                                                                         |
| GET    | `/banks/template.md`     | 教师/管理员 | Markdown 导入模板                                                                    |

**题库标准化与质量**

| 方法 | 路径                                                            | 权限        | 说明                                                                                                                                       |
| ---- | --------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET  | `/banks?kind=&subject=&book=&keyword=&courseId=&limit=&offset=` | 登录        | 按题库类型/学科/书册/关键字/归属课程筛选；`limit` 默认 300（上限 500），**返回 `{ banks, total }` 分页**                                   |
| GET  | `/banks/catalog?courseId=`                                      | 登录        | 目录树：不带 courseId 返回课程列表+未归属册次；带则返回「章节→小节→题库」                                                                  |
| POST | `/banks/rebind-courses`                                         | 教师/管理员 | 一键回填归属课程（课时推导 + 册次匹配，匹配不上的如实报出）                                                                                |
| POST | `/banks/fix-question-counts`                                    | 教师/管理员 | 重算 `banks.question_count`（题干增删改已同步维护，此接口用于兜底修数）                                                                    |
| GET  | `/banks/health?bankId=&limit=&refresh=1`                        | 教师/管理员 | 题库体检：重复题、同题不同答案、元数据覆盖率、类型分布、「解析只有图片」数量（`stats.mediaOnlyAnalysis`）                                  |
| POST | `/banks/:id/dedupe`                                             | 教师/管理员 | 题库内去重（默认 dry-run 预览，答案不同组不删）                                                                                            |
| GET  | `/questions/search?subject=&book=&point=&difficulty=&keyword=`  | 登录        | 跨题库找题 + 知识点聚合统计                                                                                                                |
| POST | `/banks/:id/exam`                                               | 教师/管理员 | 用整卷试卷题库一键建考试                                                                                                                   |
| GET  | `/question-conflicts?status=&page=&pageSize=`                   | 登录        | 「同题不同答案」组列表（待核对/已核对/已忽略/全部 + 答案分布）                                                                             |
| GET  | `/question-conflicts/:hash`                                     | 登录        | 某一组的全部题目（题库、类型、难度、来源），用于判断信哪个答案                                                                             |
| POST | `/question-conflicts/:hash/resolve`                             | 教师/管理员 | 选定答案并**整组统一**（body `{ answer }`）                                                                                                |
| POST | `/question-conflicts/:hash/ignore`                              | 教师/管理员 | 忽略该组（答案不同视为合理，题目不改动）                                                                                                   |
| POST | `/question-conflicts/:hash/reopen`                              | 教师/管理员 | 恢复为待核对                                                                                                                               |
| POST | `/question-conflicts/sync`                                      | 教师/管理员 | 重新扫描全库刷新台账（返回分段耗时 `ms`；列表接口**不会**隐式扫库）                                                                        |
| POST | `/question-conflicts/resolve-majority?dryRun=0&limit=`          | 教师/管理员 | 批量按多数答案处理（默认只预演；票数并列的组跳过不猜）                                                                                     |
| POST | `/question-conflicts/resolve-equivalent?dryRun=0&limit=`        | 教师/管理员 | 批量合并**同义写法**（默认只预演）：`\left(2,0\right)`≡`(2,0)`、`\frac{2}{5}`≡`0.4`、`7`≡`七` 合并成「两种都算对」；真的不同答案跳过留人工 |
| GET  | `/questions/difficulty?bankId=`                                 | 登录        | 难度现状：三档/五级/来源分布、未评估数、分档阈值（见 difficulty.md）                                                                       |
| GET  | `/questions/difficulty/preview?bankId=`                         | 教师/管理员 | 重算难度**预览**（不写库）：评估题量、跳过的人工/校准数、预测分布                                                                          |
| POST | `/questions/difficulty/apply?bankId=&dryRun=`                   | 教师/管理员 | 批量写回难度（人工标注与已校准的题默认不动）                                                                                               |
| POST | `/questions/difficulty/calibrate?dryRun=0&minSamples=&k=`       | 教师/管理员 | 用真实作答数据校准难度（默认只预演）                                                                                                       |

```jsonc
// GET /question-conflicts?status=pending →
// { "counts": { "pending": 771, "resolved": 12, "ignored": 3, "total": 786 },
//   "sync": { "scanned": false, "reason": "fresh", "stale": false, "ageMs": 42000 },
//   "page": 1, "pageSize": 20, "total": 771,
//   "items": [{ "contentHash": "…", "stem": "3 时 = ____ 分", "groupSize": 4, "answerCount": 2,
//               "answers": [{ "answer": "180", "n": 3, "first_id": 12 }] }] }
// POST /question-conflicts/sync →
// { "reason": "forced", "scannedGroups": 771, "inserted": 0, "removed": 0, "pending": 771, "total": 771,
//   "ms": { "scan": 812, "cleanup": 1, "write": 12, "meta": 3, "total": 830 } }
```

> `sync` 是**唯一**会扫全库的入口：36.6 万题的分组扫描在 NAS 慢盘上冷缓存实测要几十秒到几分钟
> （同步 API 会占住事件循环），所以列表接口只报告台账是否过期，由界面提示用户去点按钮。

**导入** `POST /banks/:id/import`（multipart，字段名 `file`，上限 20MB）

| 扩展名                       | 解析方式                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `.csv`                       | 表头自动识别（题型/题干/选项A~F/答案/解析），兼容 Excel 导出 |
| `.md` / `.markdown` / `.txt` | 纯文本题块：题型行 → 题干 → 选项 → `答案：` → `解析：`       |
| `.docx`                      | 抽出 Word 正文文本后，走**与 Markdown 完全相同**的题块解析   |

```jsonc
// → { "ok": true, "inserted": 28,
//     "errors": ["第 3 题（原文第 21 行）: 单选答案应为单个字母(A-F)，收到: \"X\""],
//     "warnings": ["第 7 题: 忽略了 1 个图片链接（https://…）—— 图片请在题目编辑里上传"] }
```

- 逐题校验：失败的题带**题号 + 原文行号**返回，不影响其它题；
- 纯文本格式的宽容度：题型行支持 `## 单选题` / `**多选题**` / `[判断题]` / `第 1 题 · 单选` / 纯文字行，
  也支持题型写在题干开头（`【判断题】Java 是编译型语言。`）；选项支持 `A.` `A、` `A)` `A．` `（A）`；
  选项/答案/解析顺序任意；分隔线 `---` 与普通标题 `# 题库名` 会被忽略；
- **填空题答案编码**：多个空按题目顺序用 `；` 分隔，同一个空的多种可接受写法用 `|`
  （如 `-\frac{3}{4}|-0.75；4；5`）；学生作答同样用 `；` 分隔，服务端**逐空比对**，
  空数不符或任一空不匹配即判错。题面视图里会带 `blanks`（空位数）供前端提示；
- 图片：导入时 Markdown 图片链接**不下载**（避免 SSRF 与体积问题），只在 `warnings` 里提示；
  导出 Word 时站内配图会**内嵌**进 docx（单个文件即可打印/分发）。

**导出**：`export.md` / `export.docx` 支持 `?answers=0`，导出**不含答案解析**的学生版试卷。

## 用户与设置（管理员）

| 方法      | 路径                 | 说明                                    |
| --------- | -------------------- | --------------------------------------- |
| GET       | `/users?role=all`    | 账号列表                                |
| POST      | `/users`             | 新建学生/教师                           |
| PUT       | `/users/:id`         | 改资料 / 重置密码                       |
| DELETE    | `/users/:id`         | 删除学生（含其进度）                    |
| GET       | `/audit-logs?limit=` | 审计日志                                |
| GET / PUT | `/settings`          | 读取/更新站点设置（如 `allowRegister`） |

## 学习进度

| 方法 | 路径                  | 权限 | 说明                                                           |
| ---- | --------------------- | ---- | -------------------------------------------------------------- |
| GET  | `/progress`           | 登录 | 我的进度列表                                                   |
| POST | `/progress`           | 登录 | `{lessonId,position,duration,finished?}` 上报（断点续播/看完） |
| POST | `/progress/intervals` | 登录 | 批量上报**观看区间**（服务端取并集后落库，覆盖 ≥95% 自动完成） |
| GET  | `/progress/intervals` | 登录 | 读回某课时的观看区间                                           |
| GET  | `/me/summary`         | 登录 | 累计学习分钟、完成课时、刷题数、等级                           |

## 考试与组卷

| 方法 | 路径                                                 | 权限        | 说明                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/exams`                                             | 教师/管理员 | 新建考试（`totalScore` 试卷总分，默认 100）                                                                                                                                                                                                                |
| GET  | `/exams/:id/paper`（含卷面字段 `score` / `section`） | 教师/管理员 | 试卷内容（卷内题目 + 课程题池）                                                                                                                                                                                                                            |
| GET  | `/exams/:id/pool`                                    | 教师/管理员 | **组卷挑题**：范围**默认 = 本考试所属课程**（跨课程须显式 `scope=all`）+ 题型/难度档/难度分区间/关键词/带图；**多选**用重复参数：`books` `chapters` `points` `types` `levels`（精确匹配，空值用哨兵 `__none__`）；排序与分页，`excludeInExam=1` 排除已入卷 |
| POST | `/exams/:id/parallel`                                | 教师/管理员 | **平行组卷（A/B 卷）**：逐题配同题型/同难度/同知识点的另一道题，沿用分值、大题、结构与考试设置；返回 `shortfall` 与逐题明细                                                                                                                                |
| POST | `/exams/:id/compose`                                 | 教师/管理员 | 随机 / 细目表组卷。除 `quota`/`cells`/`ratio` 外，支持**多选范围** `books`/`chapters`/`points`（可跨章节/跨册）与 `scores`（按题型落分值）                                                                                                                 |
| GET  | `/exams/:id/paper.docx?answers=0`                    | 教师/管理员 | **导出试卷 Word**（docx，题图内联；`answers=0` 为学生卷不含答案解析）                                                                                                                                                                                      |

> 考试设置（对标超星学习通）：创建/更新考试支持 `startAt` / `endAt`（unix 秒，0 = 不限）、
> `attemptLimit`（0 = 不限）、`shuffleQuestions`、`showAnswers`。学员在未开始/已结束/次数用尽时会被拒绝，
> 老师不受限；`showAnswers=false` 时学员成绩单不返回答案与解析。
> | GET | `/exams/:id/facets` | 教师/管理员 | **选题树**：册次 → 章节（带题量）+ 题型/难度/题库计数；计数跟随 `types/levels/keyword` 变化，`excludeInExam=1` 与题池同口径 |
> | GET | `/exams/:id/points` | 教师/管理员 | 知识点清单 + 题量（按 `books/chapters` 懒加载，`pointKeyword` 搜索）；知识点真机有 5380 个，不整棵返回 |
> | POST | `/exams/:id/questions` | 教师/管理员 | 加题两种方式：① `{ questionIds: [...] }` 勾选加入；② `{ filters, limit }` **按当前筛选整批加入**（"全选筛选结果"，服务端取 id，返回 `matched/added/truncated`） |
> | GET | `/exams/:id/blueprint` | 教师/管理员 | 试卷统计 + **双向细目表**（知识点 × 题型 × 难度）+ 目标配比达成情况与缺口提示 |
> | POST | `/exams/:id/compose` | 教师/管理员 | **组卷**（两种输入二选一）：① `cells` 双向细目表「知识点 × 题型 × 难度」逐格数量，逐格返回 `added/missing/available`；② `quota` 题型配额 + `ratio` 难度配比（合计 1）。缺口一律如实返回 |
> | GET | `/exams/:id/taxonomy?scope=&courseId=&limit=` | 教师/管理员 | **细目表参考数据**：当前范围里每个知识点的「题型 × 难度」可选题量（编辑器用它显示"题池够不够"） |
> | GET | `/exams/:id/questions/:qid/candidates?limit=` | 教师/管理员 | **换题候选**（不随机）：按匹配强度分组（同知识点同难度 → 同难度 → 相近难度 ±15 → 同题型），组内按难度分差排序 |
> | POST | `/exams/:id/questions/:qid/replace` | 教师/管理员 | **换一题**：带 `{ withId }` 就用指定候选（老师挑中的那道）；不带则保持原来的随机替换（兼容旧界面/脚本） |
> | GET | `/exams/:id/pool?...&orderBy=error_desc&minAttempts=` | 教师/管理员 | **易错题挑题**：按真实作答错误率排序（威尔逊置信下界，样本少自动降权）；`minAttempts` 默认 2。每行都带 `attempts/wrong/error_rate` |
> | PUT | `/exams/:id/questions/:qid` | 教师/管理员 | 改卷内某题的分值 / 大题分组 |
> | POST | `/exams/:id/questions/order` | 教师/管理员 | 重排卷内顺序（body `{ questionIds: [...] }`） |
> | PUT | `/exams/:id/structure` | 教师/管理员 | 保存试卷结构：大题（名称/题型/每题分值）+ 目标难度配比 + 总分；`applyScores=false` 只存不刷分值 |
> | POST | `/exams/:id/questions/random` | 教师/管理员 | 随机/按题型配额 + 难度配额抽题（保留的旧接口） |

**学情分析**（机构视角；全部只读，数据来自真实作答，主观题 `correct=null` 不计入）

| 方法 | 路径                                                             | 权限        | 说明                                                                                                               |
| ---- | ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| GET  | `/analytics/overview?courseId=&days=&trendDays=`                 | 教师/管理员 | KPI（活跃学员/作答条目/正确率/题目与知识点覆盖率）+ 按天趋势 + 掌握度分布 + **数据规模说明 `dataNote`**            |
| GET  | `/analytics/points?courseId=&days=&limit=&questionsPerPoint=`    | 教师/管理员 | 知识点掌握度：**薄弱优先**排序，分档 `poor/weak/mastered/insufficient`（< 3 次作答一律"数据不足"），含典型错题下钻 |
| GET  | `/analytics/students?courseId=&days=&limit=`                     | 教师/管理员 | 学员学情：作答条目、正确率、错题数、涉及知识点、**最弱知识点**                                                     |
| GET  | `/analytics/wrong-questions?courseId=&days=&limit=&minAttempts=` | 教师/管理员 | 高频错题榜（威尔逊下界排序，`minAttempts` 默认 2 过滤噪声）                                                        |
| GET  | `/analytics/wrong-questions.csv?...`                             | 教师/管理员 | 高频错题 CSV（带 UTF-8 BOM，Excel 直接打开不乱码）                                                                 |
| GET  | `/analytics/review.md?courseId=&days=&limit=`                    | 教师/管理员 | **讲评清单 Markdown**：数据规模 + 需重点讲的知识点（含典型错题）+ 高频错题，可直接发给教研/打印                    |

> 掌握度分档阈值集中定义在 `apps/api/src/services/analyticsService.ts` 的 `MASTERY`（≥3 次才下结论；≥80% 掌握、60–80% 薄弱、<60% 未掌握），界面文案与后端同源。结果缓存 60 秒；`days` 不传即全部历史。
> | GET | `/exams/:id/paper.html` | 教师/管理员 | **可打印试卷 HTML**（A4/A3、横竖版、双栏、含答案、答题卡、密封线；见 [paper-print.md](paper-print.md)） |
> | GET | `/paper-assets/katex.min.css`、`/paper-assets/fonts/:file` | 公开 | 自托管 KaTeX 样式与字体（离线打印不掉字体） |
> | GET | `/exams/:id/scores`、`/exams/:id/scores.csv` | 教师/管理员 | 成绩单与导出 |

> 判分口径：题目设了分值就按分值累加，否则退回「对几题」折算（保持老试卷行为不变）；
> `pass_score` 始终是百分比。

## 教学管理看板与统计

| 方法 | 路径                     | 权限        | 说明                     |
| ---- | ------------------------ | ----------- | ------------------------ |
| GET  | `/stats/lessons/:id`     | 教师/管理员 | 单课时学情（按学生明细） |
| GET  | `/stats/lessons/:id.csv` | 教师/管理员 | 单课时学情 CSV           |
| GET  | `/stats/courses/:id`     | 教师/管理员 | 课程学情汇总             |
| GET  | `/stats/courses/:id.csv` | 教师/管理员 | 课程学情 CSV             |
| GET  | `/audit-logs?limit=`     | 管理员      | 审计日志                 |

## 还没做的（记录备查）

HLS 多码率转码与字幕、班级/分组授权（`course_groups`）、AI 批改、题目图片随 Word 导入一起带入、
音视频之外的文档型课时（PDF/PPT 内嵌预览）。
