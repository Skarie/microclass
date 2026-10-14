# V1 → V2 切换 Runbook（EVO4）

> 适用对象：当前在 EVO4 上运行 V1 的两端 —— Docker（8091）与 fnOS FPK（8092）。
> 本文给出**可回滚**的切换步骤。切换会替换正在提供服务的进程，请在产品侧确认时机后执行；
> 数据是向后兼容的（V2 的 `0001` 迁移与 V1 结构一致且幂等），但**切换前必须完成备份**。

## 0. 前置检查（切换前执行）

```bash
# 1) 磁盘余量（备份 + 镜像需要空间）
df -h /vol1

# 2) 确认三端产物已就绪
ls -lh /vol1/1000/microclass-releases/microclass-2.0.0.fpk
sudo docker images microclass --format '{{.Repository}}:{{.Tag}} {{.Size}}'

# 3) 记录当前 V1 的运行状态（回滚时对照）
sudo docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep -E 'microclass|8091'
sudo /vol1/@appcenter/microclass/cmd/main status && echo 'FPK V1 运行中'
```

**备份（必做，两端各一份）**

```bash
# Docker 端：数据在 mcdata 卷
sudo docker run --rm -v mcdata:/data -v /vol1/1000/microclass-releases:/backup alpine \
  tar -czf /backup/v1-docker-data-$(date +%Y%m%d-%H%M).tar.gz -C /data .

# FPK 端：用仓库自带脚本（VACUUM INTO 一致性快照）
cd /vol1/1000/microclass && /vol1/@appcenter/nodejs_v22/bin/node ops/scripts/backup.mjs \
  --data-dir /vol1/@appdata/microclass/data \
  --out /vol1/1000/microclass-releases --keep 7
```

备份完成后**务必验证**（任选其一）：

```bash
# 看归档内容与大小
tar -tzf /vol1/1000/microclass-releases/microclass-*.tar.gz | head
# 或直接做一次恢复演练到临时目录（推荐）
node ops/scripts/restore.mjs --from <备份包> --data-dir /tmp/restore-drill
```

## 1. 切换 Docker 端（8091）

```bash
cd /vol1/1000/microclass            # 或者放源码的目录
sudo docker compose -f ops/docker/docker-compose.yml down     # 停 V1
sudo docker compose -f ops/docker/docker-compose.yml up -d    # 起 V2（镜像 microclass:2.0.0）

# 验证
curl -fsS http://127.0.0.1:8091/api/v1/readyz
curl -fsS http://127.0.0.1:8091/api/v1/version      # 应返回 2.0.0
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8091/          # 200（SPA）
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8091/wrong-book # 200（深链回退）
sudo docker compose -f ops/docker/docker-compose.yml logs --tail 50         # 观察迁移日志
```

数据卷 `mcdata` 原样沿用；服务启动时会自动执行 `0002–0004` 迁移（幂等）。

## 2. 切换 FPK 端（8092）

```bash
# 安装新版本（同一 appname，appcenter-cli 会走升级流程；
# cmd/upgrade_init 会先把数据目录打包到 $TRIM_PKGVAR/backup/pre-upgrade-*.tar.gz）
sudo appcenter-cli install-fpk /vol1/1000/microclass-releases/microclass-2.0.0.fpk

# 验证
sudo /vol1/@appcenter/microclass/cmd/main status && echo '运行中'
curl -fsS http://127.0.0.1:8092/api/v1/version       # 应返回 2.0.0
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8092/
tail -30 /vol1/@appdata/microclass/info.log
```

管理员密码：若 `$TRIM_PKGVAR/adminpass` 已存在则沿用 V1 的密码（不会覆盖），可直接用原密码登录。

## 3. 切换后验收清单

- [ ] `/api/v1/version` 返回 2.0.0（两端）
- [ ] 用**原有的 V1 管理员账号密码**登录成功
- [ ] 课程大厅能看到 V1 时期的课程与课时（数据未丢）
- [ ] 打开一个课时：视频可播放、知识点与笔记面板正常（笔记为改造后首次使用）
- [ ] 课后练习可提交并判分；错题本收录正确
- [ ] 考试列表可见、可作答、成绩可查（若 V1 已建考试）
- [ ] 学习统计页有数据；统计 CSV 可下载
- [ ] 浏览器控制台无报错
- [ ] `sudo docker compose logs` / `info.log` 无 ERROR

## 4. 回滚

> V1 已按用户要求下线：源码、旧镜像（`microclass:0.1`）与 V1 数据卷均已清理，
> 归档为 `microclass-v1-legacy-<时间戳>.tar.gz` 与 `microclass-v1-data-<时间戳>.tar.gz`
> （见 `docs/deploy.md` 的「V1 归档位置」）。因此回滚的首选是**回退 V2 的历史版本包**，
> 而不是回到 V1。

**回退 V2 版本**

```bash
cd /vol1/1000/microclass
sudo docker compose down
sudo docker run -d --name microclass-api -p 8091:8091 \
  -e MC_ADMIN_PASS='<原密码>' -v microclass_v2_preview:/app/data \
  -v /vol1/1000/JAVA课:/media/java:ro -v /vol1/1000:/media/nas:ro -v /vol1:/vol1:ro \
  microclass:<上一个版本号>
```

**FPK**：安装上一个版本的 fpk 包；`cmd/upgrade_init` 会在升级前自动把数据目录备份到
`$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`。

**数据回滚**（仅当必须回到切换前状态时）

```bash
# 停止服务后
node ops/scripts/restore.mjs --from <切换前备份> --data-dir <数据目录> --force
```

脚本会先做 `PRAGMA integrity_check`，并把现有目录改名保留为 `<数据目录>.pre-restore-<时间戳>`。

## 5. 注意事项

1. **先备份再切换**，且备份要落到另一个目录（不要只放在数据目录里）。
2. 迁移是**单向加法**（新增表/列与索引），因此切换后回退到上一个 V2 版本不会有结构冲突；
   但新版本写入的数据（如考试成绩单、审计日志）在旧版本里看不到（不会报错）。
3. 两个端口可以**先后切换**，也可以长期并存（Docker 用 `-p` 指定端口；FPK 的端口可用 `MC_PORT` 覆盖做灰度）。
4. 切换期间建议在反向代理上返回维护页或短暂停写，避免有人正在交卷时被中断。
