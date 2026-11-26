# 运维手册（Runbook）

## 1. 日常巡检

| 检查项   | 命令 / 位置                                      | 期望                           |
| -------- | ------------------------------------------------ | ------------------------------ |
| 存活     | `curl -fsS http://127.0.0.1:8091/api/v1/healthz` | `{"status":"ok"}`              |
| 就绪     | `curl -fsS http://127.0.0.1:8091/api/v1/readyz`  | `{"status":"ready","db":"ok"}` |
| 版本     | `curl -fsS http://127.0.0.1:8091/api/v1/version` | 版本号与预期一致               |
| 容器状态 | `docker compose ps`                              | `healthy`                      |
| 迁移状态 | `npm run migrate`                                | 输出“已是最新”或列出新应用迁移 |
| 审计日志 | `GET /api/v1/audit-logs?limit=50`（管理员）      | 可回溯登录与写操作             |

## 2. 日志

- 生产为**结构化 JSON**（pino）；每条请求带 `x-request-id`，错误响应中亦返回 `requestId`。
- 排查路径：用用户报错页面的 `requestId` 在日志中检索 → 定位请求与堆栈。
- 日志级别：`MC_LOG_LEVEL=debug|info|warn|error|silent`。
- 容器日志轮转已配置（`json-file`，`10m × 5`）。

## 3. 备份与恢复（SQLite）

> 2.4.3 起生产主库是 **PostgreSQL**（见 §7）；本节保留给历史归档与手工快照场景。
> SQLite 卷仍会由统一备份入口 `backup.sh` 一起打包（历史归档 + `uploads/` 等文件）。

### 3.1 一键备份 / 恢复（推荐）

仓库自带零依赖脚本，开发机（Windows/Linux）与服务器行为一致：

```bash
npm run backup                                  # 默认备份 <MC_DATA_DIR 或 ./data>
npm run backup -- --data-dir /vol1/@appdata/microclass/data --out /vol1/1000/backups --keep 14
npm run restore -- --from /vol1/1000/backups/microclass-20260912-010000.tar.gz --data-dir ./data --force
```

脚本的关键设计：

- **一致性**：SQLite 处于 WAL 模式，直接拷贝 `.db` 会丢数据；脚本用 `VACUUM INTO` 生成快照（先 `wal_checkpoint(TRUNCATE)`），再连同 `uploads/`、`.secret` 与 `MANIFEST.json` 打成 `microclass-<时间戳>.tar.gz`。
- **可验证**：恢复前用 `PRAGMA integrity_check` 校验归档，并打印表数量与 `schema_migrations` 版本；坏归档直接拒绝，不会覆盖现有数据。
- **可回滚**：目标目录非空时必须显式 `--force`，脚本会把原目录改名为 `<数据目录>.pre-restore-<时间戳>` 保留，回滚只需改回名字。
- **保留策略**：`--keep N`（默认 7）自动清理最旧归档。

> 恢复前请先停服务（`npm start` 进程 / `docker compose down` / fnOS 应用中心停止），否则运行中的进程仍持有旧数据库句柄。恢复后启动服务会自动执行迁移（幂等）。

### 3.2 手工快照（无脚本时）

```bash
# 一致性快照（不中断服务）
sqlite3 data/microclass.db "VACUUM INTO 'backup/microclass-$(date +%F-%H%M).db'"

# 或容器内
docker exec microclass-api node -e "
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync('/app/data/microclass.db');
  db.exec(\"VACUUM INTO '/app/data/backup/microclass-$(date +%F).db'\");
"
```

恢复：停止服务 → 备份坏文件 → 用快照替换 `data/microclass.db`（同时删除 `-wal/-shm`）→ 启动 → 校验 `readyz` 与迁移状态。

> 建议：每日定时快照 + 保留 7/4/12 份（日/周/月），并定期做**恢复演练**（本仓库已用真实数据演练过一遍，可参考 `ops/scripts/restore.mjs` 的输出作为验收证据）。

## 3.3 定时备份示例（NAS / Debian，cron）

```cron
# 每天 03:30 备份到共享目录，保留 14 份
30 3 * * * cd /vol1/1000/microclass && /vol1/@appcenter/nodejs_v22/bin/node ops/scripts/backup.mjs \
  --data-dir /vol1/@appdata/microclass/data --out /vol1/1000/backups --keep 14 >> /vol1/1000/backups/cron.log 2>&1
```

### 3.4 批量导入教辅题库（题库包）

外部教辅题库（按知识点组织的 Markdown + 图片）通过**题库包**导入，详细说明见
[bank-import.md](bank-import.md)。运维只需要记住三步：

```bash
# 1) 包传到服务器后拷进容器
sudo docker cp /tmp/import-pilot.tar.gz microclass-api:/tmp/
sudo docker exec microclass-api mkdir -p /tmp/pack
sudo docker exec microclass-api tar -xzf /tmp/import-pilot.tar.gz -C /tmp/pack

# 2) 先干跑，再正式导入（幂等：重复执行不会产生重复题目；--replace 才会覆盖）
sudo docker exec microclass-api node /app/ops/scripts/import-bank-manifest.mjs /tmp/pack --dry-run
sudo docker exec microclass-api node /app/ops/scripts/import-bank-manifest.mjs /tmp/pack

# 3) 清理容器内临时文件（图片已经落到数据卷的 uploads/question-media/）
sudo docker exec microclass-api rm -rf /tmp/pack
```

要点：导入脚本随镜像发布在 `/app/ops/scripts/`；**导入前先 `npm run backup`**；
大批量导入会持续写图片，注意数据目录剩余空间；导入结果与审计日志可用于事后核对。

批量导入时注意两件事（都是真机踩过的）：

- 从电脑上传到 NAS 的包可能是 `----------`（上传工具按 umask 落盘），`docker cp` 会**保留权限**，
  容器里的 app 用户读不到 → `tar: Cannot open: Permission denied`。先 `chmod 644 packs/*.tar.gz`；
- 每个包含几十 MB 到 100 MB 图片，导入完记得 `docker exec microclass-api rm -rf /tmp/pack`（脚本已代做）。

### 3.5 题库批量维护（回填 / 重算）

`ops/scripts/backfill-question-meta.mjs` 负责题目标准化元数据，四种模式（都在容器内跑）：

```bash
# 1) 回填缺失的内容指纹与带图标记（幂等，可随时跑）
sudo docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs

# 2) 指纹算法升级后全量重算（会改写所有题目行）
sudo docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs --only rehash

# 3) 标记「解析只有图片、没有一个字」（迁移 0020 的预计算列；真机 19,507 道 / 4.7 秒）
sudo docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs --only analysis-media
```

> 升级到含迁移 `0020` 的版本后跑一次 3)：它让题库体检能给出「解析只有图片」的数量，
> 并支持 `GET /banks/:id/questions?mediaOnlyAnalysis=1` 把这类题筛出来。
> 判定口径在 `apps/api/src/domain/question.ts` 的 `hasMediaOnlyAnalysis()`：
> **有 markdown 图片**（本站题图或 http(s) 外链都算）且去掉图片标记后一个字都不剩。

### 3.5.1 「同题不同答案」清理（两个只读报告脚本）

```bash
# 台账分类报告：哪些是同义写法（可一键合并）、哪些是真的答案不同（要人工）
sudo docker exec microclass-api node /app/ops/scripts/answer-conflict-report.mjs --samples 10

# 人工核对工作表：导出 CSV + Markdown（带客观提示：空数不一致 / 票数并列 / 数值不同）
sudo docker exec microclass-api node /app/ops/scripts/answer-conflict-worksheet.mjs --out /tmp
sudo docker cp microclass-api:/tmp/conflict-review.csv ./conflict-review.csv
```

处理顺序：先用「合并同义写法」（界面按钮，或 `POST /question-conflicts/resolve-equivalent?dryRun=0`）
把写法差异消掉，再用工作表人工过剩下的真冲突。

> 注意：**不要对真冲突盲目用「按多数答案」**。真机上就有多数票是错的例子：
> 「两个因数的积是 126，把两个因数分别乘 10」正确答案是 `12600`，而 4 条数据写成 `1260`。
> 批量接口只处理能证明等价的组；「按多数答案」请配合工作表人工确认。

### 3.5.2 视频路径体检与找回（导入后建议跑一次）

导入教辅/课程包后，`lessons.video_path` 可能没写全（真机 1,130/3,768 个课时少了最后一级课时目录）。
两个脚本都在容器内跑：

```bash
# 体检：失效路径有多少、能不能找回、盘上有没有没人引用的视频
sudo docker exec microclass-api node /app/ops/scripts/video-path-audit.mjs

# 找回（默认预演；--apply 落库；清单写到 /tmp）
sudo docker exec microclass-api node /app/ops/scripts/repair-video-paths.mjs
sudo docker exec microclass-api node /app/ops/scripts/repair-video-paths.mjs --apply --out /tmp
sudo docker cp microclass-api:/tmp/video-path-unfixable.csv ./video-path-unfixable.csv
```

找回规则（`apps/api/src/domain/videoPath.ts`）：先**文件名完全相同**、再**归一化同名**（`——`/`-`、
括号备注、空白差异）；每一步都要求**唯一命中**，命中多个候选（如「笔算乘法（一）/（二）」归一化后同名）
一律不动，列进 `video-path-unfixable.csv` 交人工。

**大批量重算请在停服后独占执行**（真机踩过）：

```bash
cd /vol1/1000/microclass-deploy
sudo docker compose -f compose.evo4.yml stop api                 # 停服务，避免写锁争用
sudo docker run --rm --user 1000:1000 -v microclass_data:/app/data microclass:2.0.0 \
  node /app/ops/scripts/backfill-question-meta.mjs --only rehash   # 独占跑
sudo docker compose -f compose.evo4.yml up -d                    # 起服务
```

要点与踩坑记录：

- **为什么必须独占**：一次批次提交在慢盘上可能超过默认的 5 秒 `busy_timeout`，
  与运行中的服务撞写锁就抛 `database is locked`（脚本已内置退避重试 + `busy_timeout=120s`，但独占最快最稳）；
- **别用 `docker exec -d` 或超时较短的 SSH 会话跑长任务**：会话被掐断后容器内的进程会被留下继续跑，
  与下一次重算互相抢锁（真机上出现过两个重算进程互等、看起来像「卡死」）；要么独占 + `docker run -d`，
  要么把命令挂在 tmux/screen 里；
- **磁盘读带宽是真瓶颈**：这台 NAS 实测顺序写 26MB/s、**顺序读只有 ~1.9MB/s**（`VACUUM` 600MB 要 386 秒），
  所以全库扫描/重算这类读密集操作慢是磁盘决定的 —— 这也是「冲突题扫描绝不放在请求路径里」的原因；
- 大批量操作前先 `npm run backup`（见 3.4）。

### 3.6 难度重算（内容特征先验 / 作答校准）

见 [difficulty.md](difficulty.md)。要点：

```bash
sudo docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs --dry-run   # 先预览
sudo docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs            # 全库重算
sudo docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs --calibrate # 用作答数据校准
```

- **人工标注（manual）与已校准（calibrated）的题默认不动**（`--force-all` 才会覆盖）；
- 全库 36.6 万题是读密集操作（题干+选项+答案），建议停服独占执行，与 3.5 的批量维护同一套路；
- 难度是**可重算的派生数据**：模型升级后重跑即可，不动题面与答案。

## 4. 接口文档与联调

- OpenAPI 3.1：`GET /api/v1/openapi.json`（约 70 个路径，按 system/auth/courses/lessons/banks/quiz/exams/stats/admin 分组），可直接喂给 Apifox / Postman / Swagger UI。
- 前端联调：`npm run dev:web`（Vite 5173，已把 `/api` 代理到 8091），生产由 API 同源托管 `apps/web/dist`，无需额外静态服务器。
- 未带 Cookie 的受保护接口统一返回 `401` + 错误信封；SPA 深链接（如 `/admin/exams`）由服务端回退到 `index.html`，API 路径仍返回 JSON。

## 5. 常见问题

| 症状                           | 可能原因                                                   | 处理                                                               |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 启动即退出，日志报环境变量错误 | 配置非法（如 `MC_PORT` 非数字）                            | 按 `docs/deploy.md` 修正；配置为 fail-fast 设计                    |
| 401 频繁                       | 会话密钥变更（`data/.secret` 被删）或 Cookie 域/协议不匹配 | 恢复密钥文件；反代场景确认 `MC_TRUST_PROXY`、`MC_COOKIE_SECURE`    |
| 429                            | 触发限流                                                   | 调整 `MC_RATE_LIMIT_MAX` / `MC_RATE_LIMIT_WINDOW` 或排查异常客户端 |
| 上传失败 400                   | 超出 `MC_MAX_UPLOAD_MB` 或类型不符                         | 调整上限；图片类上传仅接受 `image/*`                               |
| 本地视频 404                   | 媒体根路径在运行环境内不可见                               | Docker 需先挂载目录；用「视频文件夹」页的服务器浏览确认路径        |
| 迁移报“校验和不一致”           | 历史迁移文件被修改                                         | 回退文件内容，新增迁移表达变更                                     |
| 数据库锁等待                   | 长事务或并发写                                             | 检查慢查询；SQLite 已设 `busy_timeout=5000`，必要时串行化写操作    |

## 5. 发布与回滚

1. 发布前：`npm run format:check && npm run lint && npm run typecheck && npm run test` 全绿
2. 备份数据库与 `data/` 目录
3. 部署新版本 → 启动时自动执行迁移 → 校验 `readyz`
4. 回滚：回退镜像/代码；如迁移不可逆，用备份快照恢复（迁移为纯加法，旧代码在迁移后的库上仍可运行；V1 源码已归档，见 `docs/deploy.md` 的「V1 归档位置」）

## 6. 容量与性能

- SQLite 单文件，适合中小规模（数千学员/十万级记录）；写并发敏感，重写场景考虑 PostgreSQL 适配（仓储层已隔离 SQL）
- 视频走 Range 流，不落应用内存；大文件建议反向代理层缓存/直出
- `lesson_progress`、`attempts`、`audit_logs` 会持续增长，建议按月归档或清理旧记录

### 6.1 慢盘（NAS 机械盘）下的性能特征与测量方法

- 实测基线（EVO4）：顺序写 ~26 MB/s，**顺序读只有 ~1.9 MB/s**；620MB 的库读一遍是分钟级。
  **SQLite 是同步 API —— 一条慢查询会阻塞整个站点**，所以任何列表/统计接口都必须带分页上限，
  不要在请求路径上做无上限的全表聚合（`banks.question_count` 预计算就是为此而做）。
- 这台机器上还跑着一台 4GB 的 Windows 虚拟机（qemu）和厂商 NAS 代理（`mtgpa_server`），
  文件缓存经常被挤掉，于是同一个接口「冷/热」能差 2–3 个数量级。
- **测量方法：清缓存后连打两次，只有第二次才是 SQL 的真实成本**：

  ```bash
  sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'
  curl -fsS -b $COOKIE -o /dev/null -w '冷 %{time_total}s\n' 'http://127.0.0.1:8091/api/v1/banks?limit=300'
  curl -fsS -b $COOKIE -o /dev/null -w '热 %{time_total}s\n' 'http://127.0.0.1:8091/api/v1/banks?limit=300'
  ```

  2026-09 实测（同一台机、同一进程）：`banks/health` 冷 **66 s** → 热 **1.6 ms**；
  `banks?limit=300` 冷 **1.9 s** → 热 **4.9 ms**；`exams/8/paper` 冷 **168 s** → 热 **0.17 s**。
  结论：**怀疑「某页慢」时先用热缓存复测**，否则会把慢盘误判成查询或前端缺陷。

- 题库题量由 `banks.question_count` 维护（迁移 `0019`），一旦发现列表题量与实际不符，
  用 `POST /banks/fix-question-counts` 重算。
- 长期建议：给 `microclass_data` 数据卷加 SSD 缓存或直接放 SSD；视频库可留在机械盘
  （大文件顺序读受随机 I/O 影响小）。

## 7. PostgreSQL 备份与恢复演练（2.4.3+ 生产）

> 现状：生产 `2.4.3`，数据层为 **PostgreSQL 16.16**（容器 `microclass-db`，数据目录 bind 到
> `/vol1/1000/microclass-pg`）；SQLite 卷 `microclass_data` 降为历史归档，但 `uploads/` 等文件仍在卷里，
> 所以统一备份入口会同时打一份卷 tar。**数据与备份同在 `/vol1`（同盘）**，见 §7.4 风险。

### 7.1 安装与 cron（root）

仓库两个脚本：`ops/deploy/pg-backup.sh`（PG 逻辑备份）与 `ops/deploy/backup.sh`（统一入口：PG + SQLite 卷，
任一失败退出非零）。安装/更新时先备份旧文件再 `install -m 755`：

```bash
sudo install -m 755 ops/deploy/pg-backup.sh /vol1/1000/microclass-deploy/pg-backup.sh
sudo install -m 755 ops/deploy/backup.sh    /vol1/1000/microclass-deploy/backup.sh
sudo bash /vol1/1000/microclass-deploy/backup.sh     # 先手动跑一次确认
```

root crontab（**保留已有其他行**，只追加这一行）：

```cron
30 3 * * * /vol1/1000/microclass-deploy/backup.sh >> /var/log/microclass-backup.log 2>&1
```

验证：

```bash
crontab -l | grep microclass                          # 应看到 backup.sh + 已有 watchdog.sh
ls -lh /vol1/1000/microclass-backup/pg/ | tail        # 最近的 microclass-<TS>.dump
tail -20 /var/log/microclass-backup.log               # cron 次日应有输出
```

### 7.2 产物、耗时与保留策略

| 产物          | 路径                                                                                      | 实测（2026-11-27）                   |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| PG 逻辑备份   | `/vol1/1000/microclass-backup/pg/microclass-<TS>.dump`（`pg_dump -Fc`）                   | 126,837,387 B（121 MiB）/ 20s        |
| SQLite 卷归档 | `/vol1/1000/microclass-backup/sqlite-volume-<TS>.tar.gz`（排除 `media-cache`、`backups`） | 2,901,729,866 B（2.7 GiB）/ ~25 分钟 |
| 运行日志      | `.../backup.log`、`.../pg/backup.log`、`/var/log/microclass-backup.log`（cron 输出）      | —                                    |

- 保留：PG 7 份（`MC_PG_BACKUP_KEEP`，默认 7）；SQLite 卷 7 份（`backup.sh` 内置）。
- **7 份不会打满，但会逼近告警线**：7×(121 MiB + 2.7 GiB) ≈ **19.7 GiB**；当时 `/vol1` 已用 373G/466G（81%）、
  剩余 91G，稳态约 **84%**。若只保 3 份 SQLite 卷（PG 仍 7 份），稳态回落到 ~81%。
- **告警阈值建议**：`/vol1` 使用率 **≥85% 告警、≥90% 严重**（备份与数据同盘，95% 以上备份自己会写失败）；
  最新 dump **超过 26 小时未更新** → cron 失败告警；dump 大小 **< 50 MB** 或比前一日缩小 >30% → 立即人工检查
  （脚本自身只拦 <1 MB）；`backup.sh` 退出码非 0 → 查 `.../backup.log`。
- 慢盘现实：这台 NAS 顺序读 ~1.9 MB/s，SQLite 卷 tar（源 ~5 GB）要跑 ~25 分钟；凌晨 3:30 跑完不影响白天。
- 清理提示：`microclass-backup/` 里还有历史手工产物（`fpk-data-*.tar.gz` ~0.64 GB、`pg-*.dump` 121 MB、
  `sqlite-db-vol-*.tar.gz` 311 MB），不在自动轮转范围内，确认无用后可手工删。

### 7.3 恢复演练（每季度一次，默认不碰生产库）

原则：**同一个 PG 实例里建临时库 `microclass_restore_test` → `pg_restore` → 只读校验 → 立即 `DROP`**，
不 stop 生产容器、不 `down -v`、不碰 NVMe。

```bash
DB=microclass_restore_test
DUMP=$(ls -1t /vol1/1000/microclass-backup/pg/microclass-*.dump | head -1)
sha256sum "$DUMP"                                     # 记录校验和

sudo docker exec microclass-db psql -U microclass -d postgres -c "DROP DATABASE IF EXISTS $DB;"
sudo docker exec microclass-db psql -U microclass -d postgres -c "CREATE DATABASE $DB OWNER microclass;"
time sudo docker exec -i microclass-db pg_restore -U microclass -d $DB --no-owner --no-privileges < "$DUMP"

# 只读校验（与生产逐项对比）
Q="select (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') tables,
          (select count(*) from schema_migrations) migrations,
          (select count(*) from courses) courses,
          (select count(*) from banks) banks,
          (select count(*) from questions) questions,
          (select count(*) from users) users;"
sudo docker exec microclass-db psql -U microclass -d microclass -tAc "$Q"   # 生产基线
sudo docker exec microclass-db psql -U microclass -d $DB -tAc "$Q"          # 恢复库，应与生产一致
sudo docker exec microclass-db psql -U microclass -d $DB -tAc \
  "select count(*) from questions where stem is null or btrim(stem)='';"     # 应为 0
sudo docker exec microclass-db psql -U microclass -d $DB -tAc \
  "select id||' | '||left(stem,60) from questions order by random() limit 3;" # 抽样 3 题非空

# 清理（必须），并确认生产行数未变
sudo docker exec microclass-db psql -U microclass -d postgres -c "DROP DATABASE $DB;"
sudo docker exec microclass-db psql -U microclass -d postgres -tAc \
  "select count(*) from pg_database where datname='$DB';"                   # 应为 0
```

**2026-11-27 实测（生产 2.4.3）**：dump `microclass-20261127-045242.dump`（126,837,387 B，
sha256 `01b0d5a1bf6911d4a8f7077cdc183969ca4caa3c35e83d61802abac5cbe5df39`）；`pg_restore` **68s**、rc=0、
stderr 0 行；恢复库 **30 表 / 31 迁移 / 53 courses / 13258 banks / 396505 questions / 6 users**，与生产一致，
`empty_stem=0`、FK 21、`questions_id_seq.last_value=449543`、库大小 622 MB；抽样 3 题 stem 非空；
`DROP DATABASE` 后临时库不存在，生产行数演练前后一致。

> 演练频率建议：**每季度一次**，以及「大版本升级 / 数据迁移 / 换盘」之后各补一次。
> 只在临时库验证，生产库上的真实恢复见 §7.5。

### 7.4 风险：数据与备份同盘

PG 数据目录、SQLite 卷、备份都在 `/vol1`（机械盘）。这块盘坏 = 数据与备份一起丢。
缓解顺序：**每周把 `/vol1/1000/microclass-backup/pg/` + 最新卷 tar `rsync` 到外置盘/异机**
（`docs/pg-cutover-runbook.md` §8 风险 4），其次才是「多留几份」。
**不要把备份放回 NVMe/系统盘**：系统盘故障与数据盘故障是两类风险，且 NVMe 空间小。

### 7.5 真实灾难恢复（整库损坏）

```bash
# 0) 停 api（不要 down -v，不要碰卷/数据目录）
sudo docker compose -f /vol1/1000/microclass-deploy/compose.evo4.yml stop api
# 1) 断开残留连接 → 重建空库（db 容器保持运行）
sudo docker exec microclass-db psql -U microclass -d postgres -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname='microclass' and pid<>pg_backend_pid();"
sudo docker exec microclass-db psql -U microclass -d postgres -c "DROP DATABASE microclass;"
sudo docker exec microclass-db psql -U microclass -d postgres -c "CREATE DATABASE microclass OWNER microclass;"
# 2) 恢复最新 dump
LATEST=$(ls -1t /vol1/1000/microclass-backup/pg/microclass-*.dump | head -1)
sudo docker exec -i microclass-db pg_restore -U microclass -d microclass --no-owner --no-privileges < "$LATEST"
# 3) 起 api 并校验（启动时迁移幂等补齐）
sudo docker compose -f /vol1/1000/microclass-deploy/compose.evo4.yml up -d api
curl -fsS http://127.0.0.1:8091/api/v1/readyz
```

> **不要对运行中的 `microclass` 库直接 `pg_restore` 覆盖**：中途失败会留下半套对象，排查成本远高于重建空库。
> 恢复用的是同版本 `pg_restore`（PG 16）；跨大版本恢复先用目标版本 `pg_restore` 或 `pg_dump -Fp` 转出 SQL。
