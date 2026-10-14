# 部署手册

三种方式选一种，**推荐 Docker**。全文命令可直接复制（`<尖括号>` 处替换成你的值）。

- [0. 前置条件与选型](#0-前置条件与选型)
- [1. Docker 部署（推荐）](#1-docker-部署推荐)
- [2. 本地 / 服务器直接运行](#2-本地--服务器直接运行)
- [3. fnOS FPK（飞牛应用中心）](#3-fnos-fpk飞牛应用中心)
- [4. 反向代理（生产必备）](#4-反向代理生产必备)
- [5. 升级、回滚、备份、恢复](#5-升级回滚备份恢复)
- [6. 部署后自检清单](#6-部署后自检清单)
- [7. 常见问题](#7-常见问题)
- [附录 A：某个真实部署的现状（NAS/compose）](#附录-a某个真实部署的现状nascompose)
- [附录 B：数据迁移与历史版本](#附录-b数据迁移与历史版本)

---

## 0. 前置条件与选型

| 项                     | 要求                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| Node（非 Docker 方式） | **≥ 22.5**（依赖内置 `node:sqlite`）；`node -v` 确认                        |
| Docker（推荐方式）     | 20.10+；`docker compose` v2                                                 |
| 磁盘                   | 数据目录（SQLite + 上传的视频）；若视频用「媒体目录」挂载则**不占**容器磁盘 |
| 端口                   | 默认 **8091**；被占用就改 `MC_PORT`                                         |
| 内存                   | 1 GB 可跑；题库很大（几十万题）建议 2 GB+                                   |
| 可选                   | `ffmpeg` / `ffprobe`（抽视频时长与封面，缺失也能用）                        |

**选型建议**：单机 NAS/小服务器 → Docker；想改代码/调试 → 本地运行；飞牛系统且要从应用中心安装 → FPK。

---

## 1. Docker 部署（推荐）

### 1.1 构建镜像

```bash
git clone https://github.com/Skarie/microclass.git
cd microclass

docker build -f ops/docker/Dockerfile \
  --build-arg MC_VERSION=2.0.0 \
  --build-arg INSTALL_FFMPEG=1 \
  -t microclass:2.0.0 .
```

构建参数（都可省略）：

| 参数              | 默认    | 说明                                                              |
| ----------------- | ------- | ----------------------------------------------------------------- |
| `MC_VERSION`      | `2.0.0` | 注入版本号，与 `/api/v1/version` 返回一致                         |
| `INSTALL_FFMPEG`  | `1`     | 设 `0` 得到精简镜像（约 289 MB），代价是**没有**视频时长/封面抽取 |
| `APT_MIRROR_HOST` | —       | 国内建议 `mirrors.aliyun.com`，否则 apt 很慢                      |
| `NPM_REGISTRY`    | —       | 国内建议 `https://registry.npmmirror.com`                         |

镜像特征：多阶段构建、运行阶段**非 root（uid 10001）**、内置 `HEALTHCHECK`。带 ffmpeg 约 752 MB。

### 1.2 用 docker compose 启动（最省事）

```bash
cp ops/docker/.env.example ops/docker/.env
vim ops/docker/.env            # 至少改 MC_ADMIN_PASS
cd ops/docker && docker compose up -d
```

- 编排文件：`ops/docker/docker-compose.yml`；容器名 `microclass-api`，数据卷 `mcdata:/app/data`。
- 媒体目录：在 compose 里加只读挂载（例 `- /vol1/1000/JAVA课:/media/java:ro`），再用 `MC_MEDIA_ROOTS` 或后台登记（见 [video.md](video.md)）。

### 1.3 用 docker run 启动（手动可控）

```bash
docker run -d --name microclass \
  -p 8091:8091 \
  -e MC_ENV=production \
  -e MC_ADMIN_USER=admin \
  -e MC_ADMIN_PASS='换成强密码' \
  -e MC_SITE_NAME='微课堂' \
  -e MC_MEDIA_ROOTS='[{"id":"math7","name":"数学·七年级","path":"/media/math7"}]' \
  -v microclass_data:/app/data \
  -v /volume1/media/math7:/media/math7:ro \
  --restart unless-stopped \
  microclass:2.0.0
```

**必须做的两件事**：

1. **数据要落在卷里**（`-v microclass_data:/app/data`）——否则容器重建 = 数据全丢。
2. **媒体目录权限**：容器以 uid 10001 运行，读不到就播放 403。见下。

### 1.4 媒体目录权限（最常见的坑）

NAS 上的视频常属于某个用户（如 fnOS 的 1000）且权限 `700`，容器读不到会返回
`403 文件不可读：请确认应用运行用户对媒体目录有读权限`。二选一：

```bash
# 方案 A（推荐）：让容器用媒体属主身份运行，并把数据卷属主改成同一用户
id -u <媒体属主>                                   # 例：1000
sudo chown -R 1000:1000 /vol1/1000/microclass-data
# docker run 加 --user 1000:1000（compose 里写 user: "1000:1000"）

# 方案 B：放开媒体目录读权限（同机其他用户也可读，自行评估）
sudo chmod o+x /vol1/1000
sudo chmod -R o+rX /vol1/1000/JAVA课
```

自查（能输出字节数即正常）：

```bash
docker exec microclass sh -c 'head -c 16 "/media/math7/示例.mp4" | wc -c'
```

### 1.5 首次启动会做什么

- 自动执行数据库迁移（幂等，无需手工 `npm run migrate`）；
- 若库中还没有管理员，按 `MC_ADMIN_USER` / `MC_ADMIN_PASS` 创建（**之后再改环境变量不会覆盖已有账号**）；
- 生成会话密钥（未配 `MC_SESSION_SECRET` 时写入 `MC_DATA_DIR/.secret`，权限 600）。

---

## 2. 本地 / 服务器直接运行

```bash
npm install

cp .env.example .env        # 至少改 MC_ADMIN_PASS、MC_SESSION_SECRET
npm run migrate             # 建库 + 迁移

# 开发（热重载）
npm run dev                 # API  → http://127.0.0.1:8091/api/v1
npm run dev:web             # 前端 dev server（另开终端，代理 API）

# 生产
npm run build               # 构建 shared → api → web
MC_ENV=production MC_DATA_DIR=/srv/microclass/data MC_ADMIN_PASS='强密码' npm start
```

生产建议显式指定数据目录（默认 `./data`，里面是 SQLite、上传文件、会话密钥）：

```bash
MC_ENV=production \
MC_DATA_DIR=/srv/microclass/data \
MC_PORT=8091 \
MC_ADMIN_USER=admin MC_ADMIN_PASS='强密码' \
npm start
```

**systemd 示例**（`/etc/systemd/system/microclass.service`）：

```ini
[Unit]
Description=MicroClass
After=network.target

[Service]
Type=simple
User=microclass
WorkingDirectory=/opt/microclass
EnvironmentFile=/opt/microclass/.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=5
# 数据目录与媒体目录都要可读
ReadWritePaths=/srv/microclass/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now microclass
sudo systemctl status microclass
journalctl -u microclass -f
```

---

## 3. fnOS FPK（飞牛应用中心）

形态：native 应用 + `install_dep_apps = nodejs_v22`，随包携带编译产物与生产依赖，安装即用（无需在 NAS 上联网装依赖）。

### 3.1 打包

```bash
bash ops/fpk/build.sh                 # 组装 staging（build/fpk/microclass）
bash ops/fpk/build.sh --with-fnpack   # 在有 fnpack 的机器上直接产出 .fpk
```

`fnpack` 只随 fnOS 提供，所以通常在开发机组装、在 NAS 上打包：

```bash
bash ops/fpk/build.sh
tar -czf microclass-fpk-src.tar.gz -C build/fpk microclass
scp microclass-fpk-src.tar.gz <user>@<NAS-IP>:/tmp/
ssh <user>@<NAS-IP> 'cd /tmp && tar -xzf microclass-fpk-src.tar.gz && cd microclass && fnpack build microclass'
```

### 3.2 安装与升级

```bash
# fnOS 上（需要管理员权限）；再次执行即为升级
appcenter-cli install-fpk /tmp/microclass/microclass.fpk
```

### 3.3 包内布局与运行时约定

```
microclass/
├── manifest                 # appname/version/display_name/install_dep_apps
├── ICON.PNG, ICON_256.PNG   # 应用中心图标
├── cmd/                     # 生命周期脚本（main 负责 start/stop/status）
├── config/{privilege,resource}
└── app/
    ├── ui/config            # 桌面入口（端口 8092）
    └── server/              # dist + node_modules + migrations + web
```

- 数据目录：`$TRIM_PKGVAR/data`（`/vol1/@appdata/microclass/data`），升级保留
- 初始管理员密码：首次启动写入 `$TRIM_PKGVAR/adminpass`（权限 600），启动日志见 `info.log`
- 端口：**8092**（`app/ui/config` 与 `cmd/main` 两处要同步改）
- 升级前自动备份：`cmd/upgrade_init` 打包到 `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`，保留最近 5 份

### 3.4 排障

```bash
cat /vol1/@appdata/microclass/info.log            # 启动日志
/vol1/@appcenter/microclass/cmd/main status        # exit 0 运行中 / 3 未运行
curl -s localhost:8092/api/v1/healthz              # 存活探针
```

---

## 4. 反向代理（生产必备）

要点：终止 TLS、透传 `X-Request-Id`、设 `MC_TRUST_PROXY=true`；**视频要放开缓冲与大文件**，否则拖不动进度条。

### 4.1 Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name class.example.com;

  ssl_certificate     /etc/letsencrypt/live/class.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/class.example.com/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000" always;

  client_max_body_size 2g;        # 上传视频（与 MC_MAX_VIDEO_MB 对齐）

  location / {
    proxy_pass http://127.0.0.1:8091;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-Id      $request_id;

    # 视频流式（关键）：不缓冲，透传 Range，允许断点续播
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
  }
}
```

### 4.2 Caddy

```caddyfile
class.example.com {
  encode zstd gzip
  request_body { max_size 2GB }
  reverse_proxy 127.0.0.1:8091 {
    header_up X-Request-Id {http.request.uuid}
    flush_interval -1        # 关闭缓冲，保证视频流式
  }
}
```

### 4.3 环境变量联动

```bash
MC_TRUST_PROXY=true           # 让应用信任 X-Forwarded-*
MC_ALLOWED_ORIGINS=           # 同源部署留空；前后端分域时填前端域名（逗号分隔）
MC_CSP=1                      # 想让应用下发严格 CSP 时开；反代已下发就别重复
```

---

## 5. 升级、回滚、备份、恢复

### 5.1 升级（Docker）

```bash
cd microclass && git pull
docker build -f ops/docker/Dockerfile --build-arg MC_VERSION=<新版本> -t microclass:<新版本> .
cd ops/docker && docker compose up -d      # 重建容器，数据卷保留
docker compose logs -f --tail 100          # 观察迁移与启动
```

> 迁移在启动时自动执行且**纯加法**（只新增表/列/索引），因此旧版本代码仍能跑在新库上。

### 5.2 回滚

```bash
# 方式一：换回旧镜像标签
docker compose down
docker run -d --name microclass -p 8091:8091 -v microclass_data:/app/data microclass:<旧版本>

# 方式二：用备份快照恢复数据（见 5.4）
```

### 5.3 备份

```bash
# 应用自带的备份脚本（一致性快照；SQLite 会走 WAL 检查点）
MC_DATA_DIR=/path/to/data npm run backup -- --data-dir /path/to/data --out /backup --keep 7
```

```bash
# 或直接对数据卷打包（Docker 场景）
docker run --rm -v microclass_data:/data:ro -v /backup:/backup alpine \
  sh -c 'tar -czf /backup/microclass-data-$(date +%Y%m%d-%H%M).tar.gz -C /data .'
```

### 5.4 恢复

```bash
# 停服务 → 用备份覆盖数据目录 → 起服务
docker compose down
tar -xzf /backup/microclass-data-YYYYmmdd-HHMM.tar.gz -C /vol1/1000/microclass-data
docker compose up -d
curl -s localhost:8091/api/v1/readyz
```

> 备份 = `MC_DATA_DIR` 整目录（SQLite + uploads + 会话密钥）。**视频如果走媒体目录挂载，不在这里面**，需要你另行备份那些目录。

---

## 6. 部署后自检清单

```bash
BASE=http://127.0.0.1:8091

curl -s $BASE/api/v1/healthz                 # 存活：{"status":"ok",...}
curl -s $BASE/api/v1/readyz                  # 就绪（含数据库连通）：{"status":"ready","db":"ok"}
curl -s $BASE/api/v1/version                 # 版本号与镜像一致
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/            # 200 text/html（SPA）
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/admin/exams # 200 text/html（深链可直开）
```

然后逐项确认：

- [ ] 浏览器打开站点，用 `MC_ADMIN_USER` / `MC_ADMIN_PASS` 能登录
- [ ] 「课程管理 → 媒体目录」能看到挂载的目录，文件数不为 0
- [ ] 课程绑定文件夹 → **预览扫描**有内容 → 正式扫描后课时出现
- [ ] 观看页能播放、**能拖动进度条**、退出再进能续播（验证 Range 与反代缓冲）
- [ ] 「学员与账号」能新建学生账号并登录
- [ ] `MC_DATA_DIR` 在卷/备份计划里；媒体目录在备份计划里
- [ ] 数据库很大时，`/api/v1/banks/health` 首次调用约 1 秒内返回（后续走缓存）

---

## 7. 常见问题

| 现象                       | 原因                                                | 处理                                          |
| -------------------------- | --------------------------------------------------- | --------------------------------------------- |
| 容器起来但访问 502/超时    | 端口未映射或宿主防火墙                              | `docker ps` 看端口；`-p 8091:8091`            |
| 登录提示密码错误           | 管理员只在**首次**按环境变量创建，之后改 env 不生效 | 进容器改库或删除卷重来（会丢数据）            |
| 视频播放 403「文件不可读」 | 容器用户对媒体目录无读权限                          | 见 1.4                                        |
| 视频播放 404               | 磁盘文件已删/改名                                   | 重扫课程文件夹（可开清理缺失）                |
| 能播但拖不动进度条         | 反代缓冲了响应                                      | 加 `proxy_buffering off`（见 4.1/4.2）        |
| 上传视频失败               | 超过 `MC_MAX_VIDEO_MB`；反代 body 限制；磁盘满      | 三处一起调：env、`client_max_body_size`、磁盘 |
| 时长/封面为空              | 镜像未装 ffmpeg 或文件探测失败                      | `INSTALL_FFMPEG=1` 重建；不影响播放           |
| 数据"没了"                 | 数据卷没挂载（容器重建即丢）                        | 必须 `-v <卷>:/app/data`                      |
| 迁移报错/启动失败          | 数据目录权限、磁盘满、库损坏                        | 看日志；用备份恢复（5.4）                     |
| 时间/时区不对              | 容器时区                                            | `-e TZ=Asia/Shanghai`                         |

---

## 附录 A：某个真实部署的现状（NAS/compose）

> 这一节是**某台真实机器**的配置留档，供同类环境参考；新部署不需要照抄。

| 项目     | 值                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 部署目录 | `/vol1/1000/microclass-deploy/`（`compose.evo4.yml` + `.env`，`.env` 权限 600）                                    |
| 容器     | `microclass-api`，镜像 `microclass:2.0.0`，`restart=unless-stopped`                                                |
| 端口     | 8091（默认入口）与 8093（历史入口），同一实例                                                                      |
| 运行用户 | `1000:1000`（与媒体目录属主一致）                                                                                  |
| 数据卷   | `microclass_data`（external，升级/重启都保留）                                                                     |
| 媒体挂载 | `/vol1/1000/JAVA课 → /media/java`、`/vol1/1000 → /media/nas`、`/vol2/1000/思酷睿课程 → /media/sikuruike`（均只读） |
| 数据目录 | 卷内 `/app/data`（SQLite + uploads + 会话密钥）                                                                    |

日常操作：

```bash
cd /vol1/1000/microclass-deploy
docker compose -f compose.evo4.yml ps              # healthy 即正常
docker compose -f compose.evo4.yml logs -f --tail 100
docker compose -f compose.evo4.yml restart
docker compose -f compose.evo4.yml down            # 停止（数据卷保留）
docker compose -f compose.evo4.yml up -d           # 更新镜像后重建
```

新增媒体目录：在 `compose.evo4.yml` 加一行 `- /宿主机路径:/容器内路径:ro` →
`sudo docker compose -f compose.evo4.yml up -d`（重建容器，数据卷保留）→
后台 **课程管理 → 媒体目录 → 添加媒体目录** 填**容器内路径**。

反向代理补充：该实例通过反代对外提供 HTTPS，配置要点同第 4 节。

---

## 附录 B：数据迁移与历史版本

V2 的 `0001_initial_schema.sql` 与 V1 结构一致且全部 `IF NOT EXISTS`，因此可直接对既有数据库执行迁移：

```bash
MC_DATA_DIR=/path/to/existing/data npm run migrate   # 自动补 schema_migrations 与 audit_logs
```

- 迁移是**纯加法**，旧版本代码仍能在迁移后的库上运行；
- 回滚预案：迁移前先备份（见 5.3），失败时用备份恢复；
- **V1 源码不在本仓库**（已归档为 `build/archive/microclass-v1-legacy-<时间戳>.tar.gz` 与
  `/vol1/1000/microclass-releases/microclass-v1-legacy-<时间戳>.tar.gz`，解包即得 `server.js` + `public/` + `lib/`）。

相关文档：[视频挂载完全指南](video.md)、[运维手册](ops-runbook.md)、[安全设计](security.md)、[版本与发布](release.md)。
