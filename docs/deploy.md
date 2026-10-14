# 部署手册

## 1. 本地（开发 / 小规模）

```bash
npm install
npm run migrate
npm run dev          # 开发
npm run build && npm start   # 生产
```

数据默认落在 `./data`（SQLite、上传文件、会话密钥）。生产建议显式指定：

```bash
MC_ENV=production MC_DATA_DIR=/srv/microclass/data MC_PORT=8091 \
MC_ADMIN_USER=admin MC_ADMIN_PASS='强密码' npm start
```

## 2. Docker

```bash
cp ops/docker/.env.example ops/docker/.env   # 填写 MC_ADMIN_PASS 等
cd ops/docker && docker compose up -d --build
```

要点：

- 镜像多阶段构建，运行阶段非 root（uid 10001）、内置 HEALTHCHECK
- 数据卷 `mcdata:/app/data`；媒体目录按需以只读方式挂载（如 `/vol1/1000:/media/nas:ro`）
- 媒体根目录通过 `MC_MEDIA_ROOTS` 注入，或在管理端「视频文件夹」页添加（仅能看到已挂载路径）

### 2.0 镜像构建参数（ffmpeg 与国内源）

```bash
docker build -f ops/docker/Dockerfile \
  --build-arg MC_VERSION=2.0.0 \
  --build-arg INSTALL_FFMPEG=1 \                     # 默认 1；设 0 得到精简镜像（289MB，跳过时长/封面抽取）
  --build-arg APT_MIRROR_HOST=mirrors.aliyun.com \   # 国内建议指定，否则 apt 极慢
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  -t microclass:2.0.0 .
```

内置 ffmpeg 后镜像约 **752MB**（Debian ffmpeg 依赖较重），换来「视频时长 + 封面」自动抽取；
容器内可用 `docker exec microclass-api ffprobe -version` 自查；抽取失败会在接口里返回 `available:false`，
不影响播放与判分。相关环境变量：`MC_FFPROBE_PATH` / `MC_FFMPEG_PATH`（留空按 PATH 探测）。

### 2.1 EVO4 现状（线上部署，compose 管理）

EVO4 上跑的就是这一套，编排文件已随仓库提供：`ops/docker/compose.evo4.yml`。

| 项目     | 值                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 部署目录 | `/vol1/1000/microclass-deploy/`（含 `compose.evo4.yml` 与 `.env`，`.env` 权限 600）                                                 |
| 容器     | `microclass-api`，镜像 `microclass:2.0.0`，`restart=unless-stopped`                                                                 |
| 端口     | **8091**（默认入口）与 **8093**（历史入口），两个端口指向同一实例                                                                   |
| 运行用户 | `1000:1000`（与媒体目录属主一致，见下节「媒体目录权限」）                                                                           |
| 数据卷   | `microclass_data`（external，编排不会重建；升级/重启都保留）                                                                        |
| 媒体挂载 | `/vol1/1000/JAVA课 → /media/java`、`/vol1/1000 → /media/nas`、`/vol1 → /vol1`、`/vol2/1000/思酷睿课程 → /media/sikuruike`（均只读） |
| 数据目录 | 卷内 `/app/data`（SQLite + uploads + 会话密钥）                                                                                     |

> 新增媒体目录的步骤：在 `compose.evo4.yml` 里加一行 `- /宿主机路径:/容器内路径:ro` →
> `sudo docker compose -f compose.evo4.yml up -d`（会重建容器，数据卷保留）→
> 在 **课程管理 → 媒体目录 → 添加媒体目录** 里填**容器内路径**（例如 `/media/sikuruike`）。

日常操作（需要 sudo）：

```bash
cd /vol1/1000/microclass-deploy
docker compose -f compose.evo4.yml ps            # 状态（healthy 即正常）
docker compose -f compose.evo4.yml logs -f --tail 100
docker compose -f compose.evo4.yml restart
docker compose -f compose.evo4.yml down          # 停止（数据卷保留）

# 更新到新版本：先替换镜像标签/build，再 up -d
docker compose -f compose.evo4.yml up -d
```

备份：在宿主机执行 `npm run backup -- --data-dir <volume 挂载路径>`，或直接对卷打快照：

```bash
sudo docker run --rm -v microclass_data:/data:ro -v /vol1/1000/microclass-releases:/backup alpine \
  sh -c "tar -czf /backup/microclass-data-$(date +%Y%m%d-%H%M).tar.gz -C /data ."
```

> 历史说明：V1（fnOS FPK，8092）与其数据卷已按要求清理，归档见本文末「V1 归档位置」；
> 当前部署的数据来源是 V2 自己的数据卷，不再依赖任何 V1 数据。

### 媒体目录权限（重要，实测踩过）

容器以非 root（uid 10001）运行，**必须能读到媒体文件**。NAS 上的视频往往属于某个用户（如 fnOS 的 uid 1000）且权限为 `700`，
此时容器读不到，播放视频会返回 `403 文件不可读：请确认应用运行用户对媒体目录有读权限`（V2 会给出明确提示与 requestId，便于定位）。

两种解决办法，任选其一：

```bash
# 方案 A（推荐）：让容器以媒体属主身份运行，并把数据卷属主调整为同一用户
sudo chown -R 1000:1000 /vol1/1000/microclass-data          # 数据卷挂载点的属主
docker run -d --name microclass-api --user 1000:1000 \
  -v microclass_mcdata:/app/data \
  -v /vol1/1000/JAVA课:/media/java:ro ... microclass:2.0.0
# compose 写法：user: "1000:1000"，并对卷执行一次 chown

# 方案 B：放开媒体目录的读权限（对同机其他用户也可读，注意评估）
sudo chmod o+x /vol1/1000                 # 父目录需要可穿越
sudo chmod -R o+rX /vol1/1000/JAVA课      # 媒体目录与文件可读
```

自查命令：

```bash
# 以容器内用户身份试读一个视频文件，能输出字节数即正常
docker exec microclass-api sh -c 'head -c 16 "/media/java/示例.mp4" | wc -c'
```

## 3. fnOS FPK（飞牛应用中心）

形态：native 应用 + `install_dep_apps = nodejs_v22`，随包携带编译产物与生产依赖，安装即用（无需在 NAS 上联网安装依赖）。

### 3.1 打包

```bash
bash ops/fpk/build.sh            # 组装 staging（build/fpk/microclass）
bash ops/fpk/build.sh --with-fnpack   # 在装有 fnpack 的机器上直接产出 .fpk
```

`fnpack` 只随 fnOS 提供，因此在开发机上通常分两步：本地组装 → 上传到 NAS → NAS 上打包。

```bash
# 本地组装并打包传输
bash ops/fpk/build.sh
tar -czf microclass-fpk-src.tar.gz -C build/fpk microclass

# NAS 上（示例路径）
scp microclass-fpk-src.tar.gz <user>@<NAS-IP>:/tmp/
ssh <user>@<NAS-IP> 'cd /tmp && tar -xzf microclass-fpk-src.tar.gz && cd microclass && fnpack build microclass'
```

安装与升级：

```bash
# fnOS 上（需要管理员权限）
appcenter-cli install-fpk /tmp/microclass/microclass.fpk     # 首次安装
appcenter-cli install-fpk /tmp/microclass/microclass.fpk     # 再次执行即为升级
```

### 3.2 包内布局与运行时约定

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
- 初始管理员密码：首次启动写入 `$TRIM_PKGVAR/adminpass`（权限 600），也可在 `info.log` 中查看启动日志
- 数据库迁移：服务启动时自动执行（幂等），无需手工 `npm run migrate`
- 端口：8092（`app/ui/config` 与 `cmd/main` 中一致；如需修改请同步两处）
- 升级前自动备份：`cmd/upgrade_init` 会把数据目录打包到 `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`，仅保留最近 5 份

### 3.3 排障

```bash
cat /vol1/@appdata/microclass/info.log          # 启动日志与应用输出
/vol1/@appcenter/microclass/cmd/main status      # 运行状态（exit 0 运行中 / 3 未运行）
curl -s localhost:8092/api/v1/healthz            # 存活探针
```

## 4. V1 → V2 数据迁移

V2 的 `0001_initial_schema.sql` 与 V1 结构一致且全部 `IF NOT EXISTS`，因此：

```bash
# 直接对现有 V1 数据库执行迁移即可（自动补 schema_migrations 与 audit_logs）
MC_DATA_DIR=/path/to/existing/data npm run migrate
```

回滚预案：迁移前备份（见 ops-runbook.md）。迁移是**纯加法**（只新增表/列/索引），因此旧版本代码仍能在迁移后的库上运行；但 V1 代码与镜像已按用户要求清理（归档见下），回滚请用 V2 的历史镜像/版本包，或用备份快照恢复数据。

> **V1 归档位置**（如需找回 V1 源码）：仓库已不再包含 `legacy/`，归档为
> `build/archive/microclass-v1-legacy-<时间戳>.tar.gz`（本地）与
> `/vol1/1000/microclass-releases/microclass-v1-legacy-<时间戳>.tar.gz`（NAS），
> 解包即得完整 V1 源码（`server.js` + `public/` + `lib/` + QA 脚本）。

## 5. 反向代理（可选，推荐生产）

- 终止 TLS（HTTPS）、开启 HSTS、按需开启 CSP
- 透传 `X-Request-Id`（便于全链路排查），设置 `MC_TRUST_PROXY=true`
- 大视频走 `proxy_buffering off;` 并放开 `client_max_body_size`
