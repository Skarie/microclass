# PostgreSQL 切流 Runbook（最终版）

> 版本：`microclass:2.4.2`（commit `c72677e`）· 执行窗口：2026-11-27 02:21–03:2x（01:00–06:00 低峰）
> 结果：**已切流**，`MC_DB=pg`，24 项验证全绿，SQLite 卷与旧镜像保留可回滚。
> 配套：`docs/postgres-migration.md`（原理/方言）、`docs/pg-migration-progress.md`（进度与逐批记录）。

## 0. 一句话流程

```text
预检(只读) → 停 api(只停 api，PG 不动) → 备份(SQLite 库 tar + pg_dump) → 全量同步(export+load)
→ 一致性校验(行数+10 组指纹) → .env 切 MC_DB=pg + redeploy → 24 项验证 → 观察 20 min → 收尾
失败判据：任一验证项失败 → 10 分钟内 `MC_DB=sqlite` + 回滚镜像 + redeploy（SQLite 卷全程不动）
```

## 1. 前置条件（缺一不可）

| #   | 条件                      | 校验命令                                                                             | 本次实测                                |
| --- | ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | 代码侧迁移收口 + 门禁全绿 | `vitest` / E2E 40 / typecheck / eslint / prettier / build / size guard               | 1128 passed·30 skipped；E2E 40/40；全绿 |
| 2   | 版本与镜像已就绪          | `docker images microclass:2.4.2`                                                     | `c1279ce13772`（含 readyz 修复）        |
| 3   | PG 容器 healthy           | `docker exec microclass-db pg_isready -U microclass -d microclass`                   | accepting connections                   |
| 4   | 处于低峰窗口且 IO < 70%   | `bash ops/scripts/pg/guard-io.sh`                                                    | `/vol1 util=20%`                        |
| 5   | 生产交接前健康            | `curl -s -o /dev/null -w '%{http_code}' :8091/api/v1/healthz`                        | 200（api 2.4.1 healthy，restarts=0）    |
| 6   | 回滚镜像存在              | `docker images microclass:2.3.3-stable`、`microclass:2.4.1`                          | 都存在                                  |
| 7   | 不做第二份 API、不碰 NVMe | 只看宿主 8091；导出目录 `/vol1/1000/mc-pg-sync`、备份 `/vol1/1000/microclass-backup` | 遵守                                    |

## 2. 时间线（2026-11-27，实测）

| 时刻        | 步骤                              | 耗时    | 结果 / 证据                                                   |
| ----------- | --------------------------------- | ------- | ------------------------------------------------------------- |
| 02:07–02:21 | 构建 `microclass:2.4.2`（首次）   | ~14 min | sha `0a186d46…`；ffmpeg apt 占大头                            |
| 02:21:23    | 预检（IO / 健康 / 基线）          | 30 s    | `/vol1 util=20%`，version 2.4.1，api healthy                  |
| 02:21:38    | **停 api**（PG 不动）             | 6 s     | `microclass-api Exited (0) 02:21:44`；`ss -ltnp               | grep 8091` = 空 |
| 02:21:51    | SQLite 行数基线                   | 9 s     | 30 表合计 **454,135 行**（`sqlite-counts-before.log`）        |
| 02:32:15    | 备份：SQLite 库 tar               | 3m40s   | 311 MB，sha256 `0303f4c3…a201db`                              |
| 02:35:55    | 备份：`pg_dump -Fc`               | 38 s    | 121 MB，sha256 `c09c691e…7bb395`                              |
| 02:36–02:44 | `gen-schema` + `export-tsv`       | 7m06s   | 512 MB TSV；`questions` 396,505 行用 415 s（机械盘冷页）      |
| 02:44:17    | 首次 `load-pg`                    | 失败    | `Permission denied` 读 TSV（root 0600）→ 修 `chmod a+rX` 重试 |
| 02:44:17    | `load-pg` 重试                    | 1m47s   | 30 表 **行数全部一致**；`questions` 77 s；序列已 `setval`     |
| 02:46–02:48 | 一致性校验 `verify-parity.sh`     | ~2 min  | **10/10 指纹一致**；`schema_migrations` 31=31                 |
| 02:52–02:58 | 重建镜像（含 readyz 修复）        | ~6 min  | sha `c1279ce13772`；`.image-tag=2.4.2`                        |
| 02:59:37    | **切库 + redeploy**               | **9 s** | `readyz=200` 第 6 秒；运行镜像 `microclass:2.4.2`             |
| 02:59:50    | 首轮 24 项验证                    | 20 s    | 23/24（`/banks` 断言写错响应形状，非产品问题）                |
| 03:00:08    | 修正断言后复跑                    | 20 s    | **24/24 全绿**（`verify10-20261127-030008.log`）              |
| 03:00:1x    | 观察 20 min（30 s × 40）          | 20 min  | 0/40 非 200；P95 healthz 23 ms / courses 19 ms / banks 14 ms  |
| 03:20–03:24 | **发现并修复目录接口 500**（§10） | ~4 min  | `?N` 占位符 + 裸驼峰别名；最终镜像 sha `e1e6d3f6f13c`         |
| 03:24:31    | 重建镜像 + redeploy               | 2 s     | readyz 2 秒；`/banks/catalog` 200/26 ms、sections 200/31 ms   |
| 03:25:07    | 24 项复跑                         | 20 s    | **24/24 全绿**，慢查询 0 条（`verify10-20261127-032507.log`） |

## 3. 步骤与命令（可原样复跑）

### 3.1 预检（只读）

```bash
cd /vol1/1000/microclass-deploy
sudo bash /tmp/guard-io.sh                                   # /vol1 util < 70%
curl -s http://127.0.0.1:8091/api/v1/version
docker inspect microclass-api --format '{{.Config.Image}} {{.State.Health.Status}} restarts={{.RestartCount}}'
```

### 3.2 停写（只停 api，PG 保持）

```bash
sudo docker compose -p microclass-prod -f compose.evo4.yml stop api
ss -ltnp | grep 8091 || echo '8091 已释放'
docker ps --filter name=microclass --format '{{.Names}} {{.Status}}'   # api=Exited(0)，db=Up
```

> 为什么只停 api：体检 worker 是 api 的子进程，随 api 退出；PG 容器保持运行，同步期间不再有写入。

### 3.3 备份（停写后）

```bash
VOL=$(docker volume inspect microclass_data -f '{{.Mountpoint}}')     # /vol1/docker/volumes/microclass_data/_data
BD=/vol1/1000/microclass-backup
# a) SQLite 库文件（含 -wal/-shm/.secret）。卷里另有 6.7 GB media-cache / 2.7 GB uploads 等
#    只读内容，切流不写它们；全卷 14 GB 在机械盘上实测 ~1.2 MB/s（>2 h），窗口内不可行。
tar -cf - -C "$VOL" microclass.db microclass.db-wal microclass.db-shm .secret | gzip -1 > "$BD/sqlite-db-vol-$(date +%Y%m%d-%H%M%S).tar.gz"
# b) PG 快照
docker exec microclass-db pg_dump -U microclass -Fc microclass > "$BD/pg-$(date +%Y%m%d-%H%M%S).dump"
cd "$BD" && sha256sum sqlite-db-vol-*.tar.gz pg-*.dump | tee sha256-$(date +%Y%m%d-%H%M%S).txt
```

### 3.4 全量同步（SQLite 停写快照 → PG）

```bash
SRC=/vol1/1000/mc-pg-run; EXPORT=/vol1/1000/mc-pg-sync
NODE=/vol1/@appcenter/nodejs_v22/bin/node
rm -rf "$SRC"; mkdir -p "$SRC"; tar xzf /tmp/docker-src-2.4.2.tar.gz -C "$SRC"
"$NODE" "$SRC/ops/scripts/pg/gen-schema.mjs" "$VOL/microclass.db" /tmp/schema.pg.sql
"$NODE" "$SRC/ops/scripts/pg/export-tsv.mjs" "$VOL/microclass.db" "$EXPORT"
chmod -R a+rX "$EXPORT"        # 关键：root 0600 的 TSV 进容器后 postgres(999) 读不了
PG_USER=microclass bash "$SRC/ops/scripts/pg/load-pg.sh" microclass-db microclass \
  /tmp/schema.pg.sql "$SRC/ops/scripts/pg/post-schema.pg.sql" "$EXPORT"
```

> `load-pg.sh` 会 **DROP/CREATE** 目标库（幂等重装），所以它只能指向 `microclass`（生产库）
> 且必须在 api 停写时跑。它自带 `setval(max(id))` 与「逐表行数 vs manifest」校验。

### 3.5 一致性校验（必须全绿才继续）

```bash
PG_USER=microclass bash "$SRC/ops/scripts/pg/verify-parity.sh" "$VOL/microclass.db" microclass-db microclass
# 期望：✓ 10 组聚合指纹完全一致；sqlite=31 / pg=31（schema_migrations）
```

### 3.6 切库 + 发布

```bash
cd /vol1/1000/microclass-deploy
cp -a .env .env.bak-cutover-$(date +%Y%m%d-%H%M%S)
sed -i 's/^MC_DB=.*/MC_DB=pg/' .env
sed -i 's/^MC_VERSION=.*/MC_VERSION=2.4.2/' .env
printf '2.4.2' > .image-tag
sudo bash redeploy.sh          # 自带 readyz 闸门 + 5 个重接口预热
```

> `redeploy.sh` 的 readyz 闸门在 2.4.2 起探**当前驱动**（`GET /readyz` 返回 `driver: pg`），
> 不再出现「PG 挂了但 readyz 200」。

## 4. 验证清单（26 项，实测全绿）

| #   | 项                        | 通过标准                      | 实测                                         |
| --- | ------------------------- | ----------------------------- | -------------------------------------------- |
| 1   | `/version`                | `2.4.2`                       | 200 / 1.3 ms                                 |
| 2   | `/healthz`                | 200                           | 200 / 1.3 ms                                 |
| 3   | `/readyz`                 | 200（`driver=pg`）            | 200 / 1.6 ms                                 |
| 4   | 登录 admin                | 200 + `Set-Cookie`            | 200 / 694 ms（bcrypt 为主）                  |
| 5   | 课程列表                  | 200，53 条                    | 200 / 22.8 ms                                |
| 6   | 题库列表 `?limit=5`       | 200，首屏 5 条 / 共 13,258    | 200 / 6.5 ms                                 |
| 7   | 题目详情                  | 200，id 对得上                | 200 / 2.6 ms                                 |
| 8a  | 刷题取题                  | 200，≥1 题                    | 200 / 85.7 ms                                |
| 8b  | 刷题提交                  | 200，`attempts` +1（PG 写入） | 200 / 1.28 s；13→14→15                       |
| 9a  | 组卷-新建考试             | 200，返回 id                  | 200 / 76 ms（id=3）                          |
| 9b  | 组卷-随机抽题             | 200                           | 200 / 250 ms                                 |
| 9c  | 组卷-读回卷面             | 200                           | 200 / 2.3 ms                                 |
| 9d  | 组卷-删除（级联）         | 200                           | 200 / 73.6 ms                                |
| 10a | 设置读取                  | 200                           | 200 / 4.0 ms                                 |
| 10b | 公告创建                  | 200/201                       | 201 / 100.6 ms                               |
| 10c | 公告修改                  | 200                           | 200 / 69.1 ms                                |
| 10d | 公告删除                  | 200                           | 200 / 69.4 ms                                |
| 10e | 审计落 PG                 | `audit_logs` 增长             | 29,538 → 29,541（**不再写 SQLite**）         |
| 11a | 8092 healthz              | 200                           | 200 / 2.2 ms                                 |
| 11b | 8092 首页                 | 200                           | 200 / 0.9 ms                                 |
| 12  | `schema_migrations`       | sqlite 与 pg 条数一致         | 31 = 31                                      |
| 13  | PG 连接数                 | ≤ 100，无堆积                 | 2（active=1 / idle=1）                       |
| 14  | 慢查询（>200 ms）         | 无持续慢查询                  | 稳定期 **0 条**（装载后首 2 次写抖动已消失） |
| 15  | `/banks/catalog`          | 200                           | 200 / **26 ms**（PG 方言修复后，见 §10）     |
| 16  | `/banks/catalog-sections` | 200                           | 200 / **31 ms**（同上）                      |

证据：`/vol1/1000/microclass-deploy/verify10-20261127-030008.log`

## 5. 观察与性能

**观察窗口**：03:00:18–03:19:52，每 30 s 一次，40 个样本（带登录 cookie 打 healthz / courses / banks）。

| 指标             | P50   | P95   | max   | 非 200 |
| ---------------- | ----- | ----- | ----- | ------ |
| `/healthz`       | 14 ms | 23 ms | 32 ms | 0/40   |
| `/courses`       | 16 ms | 19 ms | 28 ms | 0/40   |
| `/banks?limit=5` | 11 ms | 14 ms | 20 ms | 0/40   |

- 容器：`microclass:2.4.2` healthy，**restarts=0**；PG 连接 2（active=1 / idle=1）。
- 慢查询（>200 ms）：**稳定期 0 条**（装载后前两次写出现 205 ms / 1144 ms，属「装载 + 首个 checkpoint」冷抖动，之后不再出现）。
- 探针数值含 `curl` 进程启动与建连开销（约 10 ms）；服务端自报 healthz 约 1.3 ms。
- 稳态写路径复测：刷题提交 **174 ms**（切流后首次 1.28 s）、组卷建卷首次 1.54 s、读回 3 ms。

## 6. 回滚（三级，任一失败即执行）

**总原则**：SQLite 卷与 `/vol1/1000/microclass-data` 全程不动；切流后的写只进 PG，
回滚后这些写不会回到 SQLite（切流窗口 20 分钟内可接受；如需保留，先导出 PG 增量）。

```bash
# L1（首选）：回到 sqlite 分支，镜像仍是 2.4.2（同一份代码，排除"镜像问题"）
cd /vol1/1000/microclass-deploy
sed -i 's/^MC_DB=.*/MC_DB=sqlite/' .env
printf '2.4.2' > .image-tag && sed -i 's/^MC_VERSION=.*/MC_VERSION=2.4.2/' .env
sudo bash redeploy.sh

# L2：镜像也可疑 → 用上一版
printf '2.4.1' > .image-tag && sed -i 's/^MC_VERSION=.*/MC_VERSION=2.4.1/' .env
sudo bash redeploy.sh

# L3：完全回到 2.3.3（stability 基线）
printf '2.3.3-stable' > .image-tag && sed -i 's/^MC_VERSION=.*/MC_VERSION=2.3.3-stable/' .env
sudo bash redeploy.sh
```

回滚后自检：`/version`（版本对）、`/readyz`（`driver=sqlite`）、`/courses`、8092 首页。
数据恢复（仅在 SQLite 库文件损坏时才需要）：

```bash
sudo docker compose -p microclass-prod -f compose.evo4.yml stop api
VOL=$(docker volume inspect microclass_data -f '{{.Mountpoint}}')
sudo tar -xzf /vol1/1000/microclass-backup/sqlite-db-vol-20261127-023215.tar.gz -C "$VOL"
sudo docker compose -p microclass-prod -f compose.evo4.yml start api
```

PG 侧恢复：`pg_restore -U microclass -d microclass --clean --if-exists <dump>`（先停 api）。

## 7. 备份清单（本次）

| 文件                                   | 大小   | sha256                                                             |
| -------------------------------------- | ------ | ------------------------------------------------------------------ |
| `sqlite-db-vol-20261127-023215.tar.gz` | 311 MB | `0303f4c3fced48ca274d18f340bd25d9815066e0d1054903b4d82e8831a201db` |
| `pg-20261127-023215.dump`              | 121 MB | `c09c691e99ed1fc59a174460dcdbec61c7da1b49f0115483e4c6f4343d7bb395` |
| `sha256-20261127-023215.txt`           | 193 B  | 上面两行的校验和清单                                               |

目录：`/vol1/1000/microclass-backup/`（与 PG 数据同在 `/vol1`，**同盘**，见 §8 风险 4）。

## 8. 已知风险与后续监控

0. **切流中踩到的 4 个坑（下次务必先看）**：
   - `export-tsv` 产物是 root 0600 → `docker cp` 进容器后 postgres(999) 读不了（`load-pg.sh` 已加 `chmod -R a+rX`）；
   - **`?1` 编号占位符**不被 `?`→`$n` 重写器支持（`?1` 会变 `$11`）；
   - **`HAVING`/`ORDER BY` 引用裸 camelCase 别名**在 PG 下折叠成小写 → 列不存在（#29 的引用侧）；
   - `/readyz` 曾只 ping SQLite → PG 挂了也 200（2.4.2 已改探当前驱动）。

1. **同盘风险**：PG 数据、备份、SQLite 都在 `/vol1` 机械盘；盘坏则全没。建议把
   `/vol1/1000/microclass-backup` 每周 rsync 到外置盘/异机（`sda`/`sdb` 仍闲置）。
2. **写延迟**：装载后前两次写出现 205 ms / 1.1 s（机械盘 fsync + 装载后 checkpoint），稳定期复测刷题提交 **174 ms**、
   慢查询 **0 条**。若后续高峰期提交 P95 > 300 ms，再考虑 `synchronous_commit=off`（牺牲少量持久性换延迟）。
3. **冷启动慢查询**：`log_min_duration_statement=200` 会记录装载/首次访问的冷页查询，属预期；
   持续出现新的慢查询才需要处理（`docker logs microclass-db | grep duration`）。
4. **审计/链接/缓存已同库**：2.4.2 起 3 个仓储走 `AsyncDb`，PG 模式下不再写 SQLite。
5. **体检全库聚合**：`/banks/health`（不带 bankId）会起 worker 扫 39.6 万题，切流后首次触发仍很重，
   建议仍只在管理端手动 refresh 时使用（`MC_HEALTH_AUTO=0` 默认关）。
6. **回滚窗口**：切流后写入 PG 的数据（本窗口内 2 条 attempt、3 条审计、临时考试/公告已删）
   回滚后不回到 SQLite。

## 9. 证据文件（NAS）

| 路径                                                         | 内容                                |
| ------------------------------------------------------------ | ----------------------------------- |
| `/vol1/1000/microclass-deploy/preflight-20261127-022123.log` | 预检（IO/版本/健康/PG 行数）        |
| `/vol1/1000/microclass-deploy/sqlite-counts-before.log`      | 停写后 30 表行数基线                |
| `/vol1/1000/microclass-backup/sha256-20261127-023215.txt`    | 备份校验和                          |
| `/vol1/1000/mc-pg-sync/`                                     | 导出 TSV + manifest（512 MB）       |
| `/vol1/1000/microclass-build/build-2.4.2.log`                | 镜像构建日志（两次，后者含 readyz） |
| `/vol1/1000/microclass-deploy/verify10-20261127-030008.log`  | 24 项验证逐条结果                   |
| `/vol1/1000/microclass-deploy/observe-20261127-0300*.log`    | 20 分钟观察 + P50/P95               |

## 10. 切流后事故与修复：题库目录接口 500（03:20–03:25）

**现象**：PG 模式下 `/banks/catalog`、`/banks/catalog-sections?view=book` 返回 500，SQLite 模式下正常；
切流后的 24 项清单没有覆盖这两个重聚合读接口，所以「全线绿灯」是假象。

| #   | 根因                                               | 报错                                                          | 修法                              |
| --- | -------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| 1   | `?1` 编号占位符（7 处）                            | `could not determine data type of parameter $1`（`?1`→`$11`） | 改裸 `?`，参数传两份              |
| 2   | `HAVING bankCount > 0`（`catalogCourses`）         | `column "bankcount" does not exist`                           | `HAVING COUNT(DISTINCT b.id) > 0` |
| 3   | `ORDER BY bankCount DESC`（`catalogUnboundBooks`） | 同上                                                          | `ORDER BY COUNT(*) DESC`          |

**处置**：修 SQL（`b8fa57d`）→ 补两层守卫（`?N` 源码扫描 + `HAVING`/`ORDER BY` 裸驼峰扫描 + sqlite 计数对照）
→ 重建镜像 `e1e6d3f6f13c` → `redeploy.sh`（2 秒）→ 只读端点全量扫描无 500 → 24 项复跑 24/24、慢查询 0。

**给下次的硬规则**：切流验证清单必须**逐个打所有重聚合读接口**（catalog / catalog-sections / analytics 各页 /
stats / tags / question-conflicts / exams-pool），不能只验主链路 + 写路径；parity 只保证数据一致，不保证 SQL 能在 PG 跑。
