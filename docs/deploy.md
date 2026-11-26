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

MC_VERSION=$(node -p "require('./package.json').version")
docker build -f ops/docker/Dockerfile \
  --build-arg MC_VERSION=$MC_VERSION \
  --build-arg INSTALL_FFMPEG=1 \
  -t microclass:$MC_VERSION .
```

> NAS / 无 Docker 的宿主机（只能在远端构建）用仓库脚本，版本号自动从源码包读取并记录：
>
> ```bash
> bash ops/deploy/build-image.sh /tmp/docker-src.tar.gz   # 构建 + 写 .image-tag
> bash ops/deploy/redeploy.sh                             # 按 .image-tag 重建并校验
> ```

构建参数（都可省略）：

| 参数              | 默认     | 说明                                                              |
| ----------------- | -------- | ----------------------------------------------------------------- |
| `MC_VERSION`      | 源码版本 | 注入版本号，与 `/api/v1/version` 返回一致                         |
| `INSTALL_FFMPEG`  | `1`      | 设 `0` 得到精简镜像（约 289 MB），代价是**没有**视频时长/封面抽取 |
| `APT_MIRROR_HOST` | —        | 国内建议 `mirrors.aliyun.com`，否则 apt 很慢                      |
| `NPM_REGISTRY`    | —        | 国内建议 `https://registry.npmmirror.com`                         |

镜像特征：多阶段构建、运行阶段**非 root（uid 10001）**、内置 `HEALTHCHECK`。带 ffmpeg 约 752 MB。

### 1.2 用 docker compose 启动（最省事）

```bash
cp ops/docker/.env.example ops/docker/.env
vim ops/docker/.env            # 至少改 MC_ADMIN_PASS
cd ops/docker && docker compose up -d
```

- 编排文件：`ops/docker/docker-compose.yml`；容器名 `microclass-api`，数据卷 `mcdata:/app/data`。
- 媒体目录：在 compose 里加只读挂载（例 `- /vol1/1000/JAVA课:/media/java:ro`），再用 `MC_MEDIA_ROOTS` 或后台登记。
  `path` 要填**容器内路径**；容器内 uid 10001 需要对该目录可读（否则播放 403）。详见 **[video.md](video.md) 第 2.1 节**。

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

**视频媒体目录**（本地部署没有容器映射）：`MC_MEDIA_ROOTS` 直接填**宿主机绝对路径**，并确保 `User=` 指定的系统用户可读；
若启用了 `ProtectSystem=strict`，记得加 `ReadOnlyPaths=/srv/media`。详见 **[video.md](video.md) 第 2.2 节**。

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

> 生产环境（固定发布目录、初始密码、应用权限、Docker → FPK 数据迁移）的完整步骤见 3.5。

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
- 视频媒体目录：FPK 是 native 应用，**直接填 NAS 真实路径**（如 `/vol1/1000/media/math7`），或在界面里添加；权限见 [video.md](video.md) 第 2.3 节
- 升级前自动备份：`cmd/upgrade_init` 打包到 `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`，保留最近 5 份

### 3.4 排障

```bash
cat /vol1/@appdata/microclass/info.log            # 启动日志
/vol1/@appcenter/microclass/cmd/main status        # exit 0 运行中 / 3 未运行
curl -s localhost:8092/api/v1/healthz              # 存活探针
```

### 3.5 fnOS 应用（FPK）安装、权限与数据迁移

> 本节按**已完成的一次真实部署**写成：应用中心安装 native 包，监听 **8092**，数据在
> `/vol1/@appdata/microclass/data`。它与 Docker 生产（**8091**、数据卷 `microclass_data`）互不读写，
> 可同机并存；但**同一份数据只能有一个进程写**（见 3.5.4）。

#### 3.5.1 安装与升级

前提：`nodejs_v22` 已安装（包的 `install_dep_apps` 会带上；缺失时先在应用中心装）：

```bash
ls -l /vol1/@appcenter/nodejs_v22/bin/node
```

安装与升级是**同一条命令**，换新包路径再执行一次即为升级（`cmd/upgrade_init` 会先备份数据目录到
`/vol1/@appdata/microclass/backup/`，保留最近 5 份）：

```bash
# 首次安装
sudo appcenter-cli install-fpk /vol1/1000/microclass-releases/microclass-2.3.1.fpk

# 升级：换成新包路径，再执行同一条命令
sudo appcenter-cli install-fpk /vol1/1000/microclass-releases/microclass-<新版本>.fpk
```

查看状态：

```bash
appcenter-cli list | grep -i microclass             # 已安装应用
sudo /vol1/@appcenter/microclass/cmd/main status    # exit 0=运行中，3=未运行
curl -fsS http://127.0.0.1:8092/api/v1/version      # 版本号应与安装包一致
curl -fsS http://127.0.0.1:8092/api/v1/healthz      # {"status":"ok",...}
```

浏览器入口 `http://<NAS-IP>:8092/`。运行时路径与 Docker 的对应关系：

| 项       | FPK（native 应用）                                              | Docker（生产，参考）                                                    |
| -------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 端口     | **8092**                                                        | 8091（另有 8093 历史入口）                                              |
| 数据目录 | `/vol1/@appdata/microclass/data`（SQLite + uploads + 会话密钥） | 卷 `microclass_data`，宿主 `/vol1/docker/volumes/microclass_data/_data` |
| 程序目录 | `/vol1/@appcenter/microclass`（升级整体替换，**不要放数据**）   | `/vol1/1000/microclass-deploy`                                          |
| 日志     | `/vol1/@appdata/microclass/info.log`                            | `docker compose logs`                                                   |
| 启停     | `cmd/main` 的 `start` / `stop` / `status`                       | `docker compose ... up -d` / `stop` / `restart`                         |

> 两套**完全隔离**：端口、数据目录、进程都不同。FPK 的安装/升级/卸载不动 `microclass_data` 卷，
> Docker 的重建也不动 `/vol1/@appdata/microclass`。需要同一份数据时只能迁移（3.5.4），
> **不能**让两边同时指向同一个 `microclass.db`。

#### 3.5.2 初始管理员

账号固定为 `admin`。首次启动生成随机密码写入 `/vol1/@appdata/microclass/adminpass`（权限 600）：

```bash
sudo ls -l /vol1/@appdata/microclass/adminpass     # -rw------- ... adminpass
sudo cat /vol1/@appdata/microclass/adminpass
```

- **首次登录后立即改密**：应用内「个人中心 → 修改密码」。
- 该文件只在**首次创建管理员**时使用；改密后文件内容不会同步更新，别把它当密码管理器。
- 升级、重启不会重置密码；重装包也不会丢账号（数据目录保留）。库里已有管理员时 `MC_ADMIN_PASS` 不生效。

#### 3.5.3 应用权限（媒体共享目录）

FPK 按 `config/privilege` 的 `run-as: package` 运行，默认读不到 NAS 共享目录。视频放在
`/vol1/1000/JAVA课`、`/vol1/1000` 这类目录时，先授权：

1. fnOS「**设置 → 应用权限 → 微课堂**」；
2. 给要用的媒体共享目录勾选**读取**（播放只需读，不要给写）；
3. 保存后**重启应用**，权限才会应用到新进程：

```bash
sudo /vol1/@appcenter/microclass/cmd/main stop
sudo /vol1/@appcenter/microclass/cmd/main start
sudo /vol1/@appcenter/microclass/cmd/main status
```

然后进「课程管理 → 媒体目录 → 添加媒体目录」，路径填 **NAS 真实路径**（native 应用没有容器映射），
例如 `/vol1/1000/JAVA课`。用运行用户验证可读（能输出字节数即正常）：

```bash
FPK_USER=$(ps -o user= -p "$(cat /vol1/@appdata/microclass/app.pid)" | tr -d ' ')
echo "FPK 运行用户: $FPK_USER"
sudo -u "$FPK_USER" head -c 16 "/vol1/1000/JAVA课/示例.mp4" | wc -c
```

> 授权前已添加的目录同样受影响：授权并重启后，回媒体目录点一次「重新扫描」，文件数才会更新。
> 权限不足时表现为目录文件数为 0，或播放/接口返回 403「文件不可读」。
> `app.pid` 被 fnOS 清理时，运行用户可用 `stat -c '%U' /vol1/@appdata/microclass/data/microclass.db`
> 或 `pgrep -af '/server/dist/server.js'` 反查（`ps -o user= -p <pid>`）。

#### 3.5.4 把 Docker 生产数据迁到 FPK（可选，二选一）

适用场景：让 8092 的 FPK 接管现有生产数据。**迁移窗口内两边都停，迁移后只保留一套对外服务。**
SQLite 同一时刻只允许一个写者，两个进程同时写同一个库会 `database is locked`，甚至损坏数据 ——
所以**禁止双写**，也不要把 FPK 的数据目录再挂进 Docker（或反过来）。

前置：在 8091 后台记下课程 / 课时 / 题库数量，迁移后在 8092 对照；备份统一放
`/vol1/1000/microclass-backup`（不要放进数据目录）。

**① 备份 Docker 数据卷**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /vol1/1000/microclass-backup
docker volume inspect microclass_data >/dev/null   # 卷必须存在，否则备份出来是空的
docker run --rm -v microclass_data:/data \
  -v /vol1/1000/microclass-backup:/backup alpine \
  tar czf "/backup/docker-data-$TS.tar.gz" -C /data .
ls -lh "/vol1/1000/microclass-backup/docker-data-$TS.tar.gz"
```

> 当前用户不在 `docker` 组时，给 `docker run` 加 `sudo`。宿主上的等价路径是
> `/vol1/docker/volumes/microclass_data/_data`。备份后立即执行 ② 停写；若要求严格一致，
> 也可把 ① 放到 ② 之后（服务已停时快照最干净）。

**② 停 Docker（只停 api，卷保留）**

```bash
cd /vol1/1000/microclass-deploy
docker compose -f compose.evo4.yml stop api
docker compose -f compose.evo4.yml ps        # api 应为 exited
```

**③ 记录 FPK 运行用户，再停 FPK**

`cmd/main stop` 会删除 `app.pid`，所以**先记录运行用户**：

```bash
FPK_USER=$(ps -o user= -p "$(cat /vol1/@appdata/microclass/app.pid)" | tr -d ' ')
echo "FPK 运行用户: $FPK_USER"
sudo /vol1/@appcenter/microclass/cmd/main stop
```

pid 文件已被 fnOS 清理时，用数据目录现有文件的属主判断（由服务进程创建）：

```bash
stat -c '%U:%G' /vol1/@appdata/microclass/data/microclass.db
# 或先 pgrep -af '/server/dist/server.js' 找到 pid，再 ps -o user= -p <pid>
```

**④ 复制数据并修正属主**

Docker 卷里的文件属主是**容器运行用户**（镜像默认 10001，生产 compose 也可能写成 `1000:1000`），
FPK 是 package 用户，两者不同，直接拷会读不了/写不了：

```bash
sudo cp -a /vol1/docker/volumes/microclass_data/_data/. /vol1/@appdata/microclass/data/
sudo chown -R "$FPK_USER":"$FPK_USER" /vol1/@appdata/microclass/data
sudo ls -ln /vol1/@appdata/microclass/data | head
```

> 运行用户与主组同名时上面的 `chown` 即可；不同名时用
> `sudo chown -R "$FPK_USER:$(id -gn "$FPK_USER")" /vol1/@appdata/microclass/data`。

**⑤ 启动 FPK 并验收**

```bash
sudo /vol1/@appcenter/microclass/cmd/main start
sudo /vol1/@appcenter/microclass/cmd/main status
curl -fsS http://127.0.0.1:8092/api/v1/version
curl -fsS http://127.0.0.1:8092/api/v1/healthz
```

用**迁移前 Docker 侧的管理员账号**登录（不是 `adminpass` 里的初始密码——那只对应 FPK 首次启动的空库），
并核对数量：

```bash
read -rsp 'admin 密码（迁移前 Docker 侧的密码）: ' MC_PASS; echo
curl -fsS -c /tmp/mc.jar -o /dev/null -w 'login HTTP %{http_code}\n' \
  -X POST http://127.0.0.1:8092/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$MC_PASS\"}"

# 课程数（带登录 Cookie）
curl -fsS -b /tmp/mc.jar http://127.0.0.1:8092/api/v1/courses \
  | /vol1/@appcenter/nodejs_v22/bin/node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("课程数:",Array.isArray(j)?j.length:(j.courses??[]).length)})'

# 题库数（limit=1 只取一条，total 为全量计数）
curl -fsS -b /tmp/mc.jar 'http://127.0.0.1:8092/api/v1/banks?limit=1' \
  | /vol1/@appcenter/nodejs_v22/bin/node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("题库数:",j.total)})'
```

浏览器再走一遍：8092 能登录 → 课程大厅有课 → 点开课时能播放/拖进度 → 题库与错题本有数据 →
「媒体目录」文件数不为 0。

> 迁移后「媒体目录」里可能还留着 Docker 的**容器内路径**（如 `/media/java`、`/media/nas`）。
> FPK 是 native 应用，这些路径在 NAS 上不存在，要改成 NAS 真实路径（如 `/vol1/1000/JAVA课`）
> 并重新扫描，否则课时视频会 404。

**⑥ 回滚（切回 Docker）**

```bash
# 停 FPK
sudo /vol1/@appcenter/microclass/cmd/main stop

# 起 Docker（卷内数据没动过，直接起即可）
cd /vol1/1000/microclass-deploy
docker compose -f compose.evo4.yml start api
docker compose -f compose.evo4.yml ps
curl -fsS http://127.0.0.1:8091/api/v1/readyz
```

如果迁移期间 Docker 卷被写过（例如误起了容器），用 ① 的备份恢复卷再起：

```bash
cd /vol1/1000/microclass-deploy
docker compose -f compose.evo4.yml stop api
docker run --rm -v microclass_data:/data \
  -v /vol1/1000/microclass-backup:/backup alpine \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /backup/docker-data-<TS>.tar.gz -C /data'
docker compose -f compose.evo4.yml start api
curl -fsS http://127.0.0.1:8091/api/v1/readyz
```

`<TS>` 换成 ① 生成的时间戳（`ls /vol1/1000/microclass-backup/docker-data-*.tar.gz` 可查）。

**⑦ 迁移后的硬约束**

- 只保留一套对外服务：切到 FPK 后 Docker 端保持 `stop`（不要 `up -d`，也不要在 NAS UI 点「启动/重构」），
  反代与端口映射只指向 8092。
- 只是试用 FPK 的话，验收完按 ⑥ 回滚并停掉 FPK，让 8091 继续对外。
- 任何时候都**不要**让两个进程写同一个 `microclass.db`，也不要把 `/vol1/@appdata/microclass/data`
  作为 Docker 的 `/app/data` 挂载。

#### 3.5.5 常见问题（FPK）

依赖 `nodejs_v22` 缺失时应用起不来，先确认 `/vol1/@appcenter/nodejs_v22/bin/node` 存在；其余按现象对表：

| 现象                                              | 原因                                                                                     | 处理                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 应用中心报 **10330**（安装/启动失败）             | 旧包 `cmd/main` 在 `set -u` 下引用了新版 fnOS 不再注入的 `TRIM_PKGDIR`，脚本一启动就退出 | 升级到已修复的包（按 `TRIM_APPDEST` 定位程序目录，保留 `TRIM_PKGDIR` 回退）；装完 `cmd/main status` 应为 0，仍失败看 `info.log` |
| 应用中心报 **10500**（进程在跑却提示未运行/失败） | fnOS 会清理 `$TRIM_PKGVAR/app.pid`，旧 `status` 只认 pid 文件                            | 新包 `status` 已加健康探针与 `pgrep` 兜底：先 `curl -fsS localhost:8092/api/v1/healthz`，再 `cmd/main stop` + `start` 重建 pid  |
| 桌面图标点开**页面空白**                          | `app/ui/config` 的端口与 `cmd/main` 的 `PORT` 不一致，或服务没起来                       | 两处都应为 8092；`curl -sI localhost:8092/` 应返回 200 `text/html`；否则看 `info.log`                                           |
| **视频目录看不到** / 播放 403                     | 应用未获媒体共享目录读权限（native 应用按 package 用户运行）                             | 「设置 → 应用权限」给「微课堂」对应目录读取权限，然后重启应用（见 3.5.3）                                                       |
| `/api/v1/version` **显示 2.0.0**                  | `MC_VERSION` 未注入，API 回退到硬编码版本                                                | 新包由 `cmd/main` 从 `TRIM_APPVER`/`manifest` 注入；确认 `manifest` 的 `version` 正确后重装并重启，再 `curl .../version` 校验   |

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
MC_VERSION=<新版本>
docker build -f ops/docker/Dockerfile --build-arg MC_VERSION=$MC_VERSION -t microclass:$MC_VERSION .
cd ops/docker && MC_VERSION=$MC_VERSION docker compose -f compose.evo4.yml up -d --force-recreate --no-deps api
# compose 现在要求 .env 必须有 MC_VERSION（缺了会直接报错，不再静默回退 2.0.0）
docker compose logs -f --tail 100          # 观察迁移与启动
```

> **NAS 图形界面里点「重构 / 重建」之前，务必确认部署目录的 `.env` 有 `MC_VERSION=<目标版本>`
> 且该版本的镜像已经 `docker build` 出来。** 界面上的「重构」等价于 `docker compose up`，
> 它只读 `.env`，不会再执行 `docker build`；`.env` 里版本写错（例如残留 `MC_VERSION=2.0.0`）
> 就会去用旧镜像，表现为「页面主题/版本回退」。版本相关的重建请优先用：
>
> ```bash
> cd /vol1/1000/microclass-deploy
> cat .image-tag                      # 应有目标版本号
> grep '^MC_VERSION=' .env            # 应与 .image-tag 一致
> bash redeploy.sh                    # 会按 .image-tag 重建并校验运行镜像
> ```
>
> 另外：本项目生产编排的 Compose 项目名是 `microclass-prod`（不是 `microclass`）。
> 宿主机上若有历史部署 `/opt/microclass`（项目名 `microclass`，容器名恰为 **`microclass`**，
> 镜像 `microclass:0.1`，映射 8091，是旧的 V1/V2 单文件应用），它一旦被启动/重建会抢占 8091
> 并顶掉本项目网络，请停用并删除该容器：
>
> ```bash
> docker stop microclass          # 停掉旧容器
> docker rm microclass            # 删除旧容器（它自己的数据在卷 microclass_mcdata 里，删容器不影响该卷）
> ```
>
> **以后只启动 `microclass-api`（由本目录 compose.evo4.yml 管理）；不要 `docker start microclass`、
> 也不要在 NAS UI 里对名为 `microclass` 的项目点「启动/重构」。** 不要在同一台机器上同时跑两套。

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

### 5.5 同机旧版本清理（先备份卷，再删镜像 / 卷 / 旧目录）

同一台机器跑过旧版（例如 `/opt/microclass` 那套 V1，容器名 `microclass`、镜像 `microclass:0.1`、
数据卷 `microclass_mcdata`）时，可以按下面顺序清理。**铁律：先备份、再删除；生产用的
`microclass_data` 卷与 `/vol1/1000/microclass-deploy` 永远不动。**

```bash
# 0) 盘点：确认 8091 是 microclass-api + 目标镜像，且待删卷没有容器引用
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'
docker images microclass --format '{{.Tag}} | {{.ID}} | {{.Size}} | {{.CreatedSince}}'
docker volume ls | grep -i microclass
docker ps -a --filter volume=microclass_mcdata -q          # 应无输出
docker inspect microclass-api --format '{{.Config.Image}}' # 应为生产版本

# 1) 备份（必须）：旧卷 + 旧目录，落到 /vol1/1000/microclass-backup
mkdir -p /vol1/1000/microclass-backup
TS=$(date +%Y%m%d-%H%M%S)
docker run --rm --user 0:0 -v microclass_mcdata:/data:ro \
  -v /vol1/1000/microclass-backup:/backup alpine:latest \
  tar czf "/backup/microclass_mcdata-$TS.tar.gz" -C /data .
tar czf "/vol1/1000/microclass-backup/opt-microclass-$TS.tar.gz" -C /opt microclass
ls -lh /vol1/1000/microclass-backup/ && sha256sum /vol1/1000/microclass-backup/*.tar.gz

# 2) 删旧镜像（只删确认废弃的标签；保留当前生产与上一版用于回滚）
docker rmi microclass:0.1 microclass:2.2.0 microclass:2.0.0-prev-0912
docker image prune -f                                      # 只清 dangling，不加 -a

# 3) 删旧容器 / 卷 / 网络 / 旧目录（备份成功且确认无引用之后）
docker rm -f microclass
docker volume rm microclass_mcdata microclass_v2_preview
docker network rm microclass_default
rm -rf /opt/microclass

# 4) 验证：只剩生产容器与保留镜像，接口正常
docker ps -a --filter name=microclass --format '{{.Names}} | {{.Image}} | {{.Status}}'
docker images microclass
curl -s http://127.0.0.1:8091/api/v1/version && curl -s http://127.0.0.1:8091/api/v1/readyz
```

清理前还要确认旧目录没有被系统服务引用；有引用就**停止清理、先解绑**，不要强删：

```bash
systemctl list-units --all | grep -i microclass
ls /etc/systemd/system | grep -i microclass
ls /vol1/@appcenter /vol1/@appdata 2>/dev/null | grep -i microclass
```

> **保留清单（不要删）**：数据卷 `microclass_data`、部署目录 `/vol1/1000/microclass-deploy`、
> 镜像 `microclass:<当前版本>` 与 `microclass:<上一版本>`（回滚用）、网络 `microclass-prod_default`、
> 题库导入包目录 `/vol1/1000/microclass-bank-import`、V1 归档 `/vol1/1000/microclass-releases`（取证/回滚用）。
> 备份默认留在 `/vol1/1000/microclass-backup/`，确认不再需要后再手工删。

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
| 容器     | `microclass-api`，镜像 `microclass:<版本>`（compose 读 `MC_VERSION`），`restart=unless-stopped`                    |
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

# 重建前先对版本：两者必须一致，否则会起旧镜像（NAS UI 点「重构」同理）
cat .image-tag && grep '^MC_VERSION=' .env
```

> **同一台机器上不要保留第二套映射 8091 的旧部署**（例如 `/opt/microclass`，项目名 `microclass`）。
> 它「重构」时会重建同名网络 `microclass_default`，让本项目的 `microclass-api` 直接 exit 128
> （`network ... not found`）并抢走 8091，页面就会变成旧版。本项目项目名已改为
> `microclass-prod`；旧部署请 `docker stop microclass` 并把 `restart` 调成 `"no"`。

新增媒体目录：在 `compose.evo4.yml` 加一行 `- /宿主机路径:/容器内路径:ro` →
`sudo docker compose -f compose.evo4.yml up -d`（重建容器，数据卷保留）→
后台 **课程管理 → 媒体目录 → 添加媒体目录** 填**容器内路径**。

> ⚠️ `MC_MEDIA_ROOTS` 只在「库里还没有媒体目录」时播种一次：一旦用界面加过目录，再改环境变量**不会生效**（继续用界面加即可）。

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

## 外网访问（反向代理 / 域名 / 端口映射）

从家外访问时如果出现 **「跨站请求被拒绝：Origin 不被信任」**，是 CSRF 的 Origin 校验挡住了写请求
（POST/PUT/PATCH/DELETE）。同源访问（内网 IP 直连）不会触发。

排查顺序：

1. **反代要透传 Host 与协议**（nginx 示例）：

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:8091;
     proxy_set_header Host $host;                  # 关键：不传的话后端看到 127.0.0.1
     proxy_set_header X-Forwarded-Proto $scheme;  # 关键：TLS 终止时后端是 http
     proxy_set_header X-Forwarded-Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

2. **在环境变量里登记外网地址**（反代改了 Host 或前后端不同域时必须）：

   ```yaml
   environment:
     MC_ALLOWED_ORIGINS: 'https://mc.example.com,http://192.168.0.105:8091'
   ```

   支持通配：`https://*.example.com`。
   **改完需要重启容器**（环境变量在启动时读取）。

3. **反代之后设 `MC_TRUST_PROXY=1`**（从 X-Forwarded-For 取真实客户端 IP，限流按 IP 时更准确）。

4. 校验：

   ```bash
   curl -i -X POST https://mc.example.com/api/v1/auth/login \
     -H 'Origin: https://mc.example.com' -H 'content-type: application/json' \
     -d '{"username":"admin","password":"..."}'
   ```

   返回 200 即正常；仍 403 时错误信息里会带上被拒的 Origin，照它填进 `MC_ALLOWED_ORIGINS` 即可。

5. **`MC_ALLOWED_ORIGINS` 必须精确到端口**（最容易踩的坑）：

   浏览器发的是 `Origin: https://<域名>:<端口>`，校验是**规范化后精确匹配**（只去掉 `:443`/`:80`），
   中间端口不会被忽略；`https://*.example.com` 通配**只匹配主机名，不匹配端口**。

   ```bash
   # 别猜端口，直接从日志里读浏览器真实发的 Origin（最可靠）
   sudo docker logs --since 30m microclass-api 2>&1 | grep '堵住了一个 Origin' | tail -5
   # → {"level":40,...,"origin":"https://office.app.5ddd.com:38065","msg":"堵住了一个 Origin ..."}
   ```

   实测案例：反代端口从 `43175` 换成 `38065` 后，白名单只写了 `:43175` → 一直 403；
   把 `https://office.app.5ddd.com:38065` 加进去立刻恢复。**同一域名多个入口时，每个端口都要登记**。

6. **改完 `.env` 必须 `--force-recreate`**（`docker restart` 不会重读 compose 插值的环境变量）：

   ```bash
   cd /vol1/1000/microclass-deploy
   sudo docker compose -f compose.evo4.yml up -d --force-recreate --no-deps api
   # 或者用仓库脚本（同样会 force-recreate）
   sudo bash redeploy.sh
   ```

   已经踩过的坑：只改 `.env` 不重建 → 容器里 `MC_ALLOWED_ORIGINS` 仍是空/旧值，403 照旧。
   验证容器里到底有没有：

   ```bash
   sudo docker exec microclass-api sh -c 'echo "ALLOWED=[$MC_ALLOWED_ORIGINS]"'
   sudo docker inspect microclass-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ALLOWED_ORIGINS
   ```

7. **验证要模拟「反代改写 Host」**（这是真实链路，而不是直连）：

   ```bash
   # 合法 Origin + 被改写的 Host → 应 401（凭据错）或 200，绝不能 403
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8091/api/v1/auth/login \
     -H 'Origin: https://office.app.5ddd.com:38065' -H 'Host: 127.0.0.1:8091' \
     -H 'X-Forwarded-Proto: https' -H 'content-type: application/json' \
     -d '{"username":"admin","password":"<真实密码>"}'

   # 未登记域名必须是 403（确认防护没被放空）
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8091/api/v1/auth/login \
     -H 'Origin: https://evil.example.com' -H 'Host: 127.0.0.1:8091' \
     -H 'content-type: application/json' -d '{"username":"x","password":"x"}'
   ```

   参考生效值（本机实测）：

   ```dotenv
   # /vol1/1000/microclass-deploy/.env（不要加引号，逗号分隔且不要空格）
   MC_TRUST_PROXY=1
   MC_ALLOWED_ORIGINS=https://office.app.5ddd.com:38065,https://office.app.5ddd.com:43175,https://office.app.5ddd.com,http://office.app.5ddd.com:38065
   ```

   会话 Cookie 是 `HttpOnly; SameSite=Lax`，**不含 `Secure`**：https 反代下正常工作，
   但如果同一入口还能用 `http://` 访问，Cookie 会随 http 明文发出，建议反代强制跳 https。

---

## 8. 题库体检：对生产的影响与开关（2.3.2）

「题库体检」= 全库聚合（元数据覆盖率 / 质量统计 / 重复题），要扫 **39.6 万题 / 1.2 GB 库**。
放在机械盘上是一次重度 IO：早期同步实现直接把事件循环占住（实测冷缓存 6.5 分钟全站卡死）；
2.3.1 改成「持久缓存 + 后台 worker + 202」，但**启动预热和过期自动重算本身仍是一次全库扫描**。

2.3.2 起的默认行为：

| 项目             | 默认                                                             |
| ---------------- | ---------------------------------------------------------------- |
| 启动预热         | **关闭**                                                         |
| 缓存过期自动重算 | **关闭**（读到过期缓存会返回旧结果并带 `stale: true`）           |
| 何时才会真算     | 管理端题库页点「重新体检」→ `GET /api/v1/banks/health?refresh=1` |
| 计算进程         | 独立子进程，`ionice -c3 nice -n 19`（容器无 ionice 时自动回退）  |
| 算完收尾         | 写缓存后 `PRAGMA wal_checkpoint(TRUNCATE)`，避免 WAL 只涨不落    |

```bash
# 想恢复「过期自动算」（不推荐大库使用）
docker compose -f compose.evo4.yml ...      # 在 .env 或 environment 里加
MC_HEALTH_AUTO=1
```

判断当前状态：

```bash
curl -s localhost:8091/api/v1/banks/health/status   # 需教师/管理员 cookie
# { "status": "ready" | "computing" | "stale", "computedAt": 1763... }
```

**建议**：大库（>500 MB）保持默认关闭，只在低峰手动点「重新体检」；`stale` 的旧数据不影响日常刷题，
只影响管理端那张体检报表的新鲜度。

---

## 9. 看门狗（整站无响应的兜底）

docker 自带 healthcheck 只会把容器标记成 `unhealthy`，**不会重启**。
2026-11-26 00:06 就出现过「进程还在、healthz 超时、整站不可用」持续数分钟的情况，靠人工重启才恢复。

`ops/deploy/watchdog.sh` 补上这一环：

```bash
# 安装（root，在 NAS 上）
install -m 755 ops/deploy/watchdog.sh /vol1/1000/microclass-deploy/watchdog.sh
( crontab -l 2>/dev/null; \
  echo '*/2 * * * * /vol1/1000/microclass-deploy/watchdog.sh >> /var/log/microclass-watchdog.log 2>&1' \
) | crontab -
crontab -l | grep watchdog          # 确认已写入
tail -f /var/log/microclass-watchdog.log
```

行为：

- 每 2 分钟 `curl http://127.0.0.1:8091/api/v1/healthz`（超时 5s）；
- **连续 2 次**失败才 `docker restart microclass-api`（单次磁盘抖动不误杀）；
- 重启后 20s 复查：恢复则记一行日志；仍失败则只记日志、**停止自动重启**（防重启风暴，等人工）；
- 用 `flock` 防重叠执行；状态文件 `/tmp/microclass-watchdog.state`。

替代方案：`willfarrell/autoheal`（需挂载 docker.sock，会按 `autoheal=true` 标签自动重启 unhealthy 容器）。
内网/离线环境优先用上面的 cron 脚本，不引入新镜像。

### 事故记录：2026-11-26 00:06 整站无响应

| 项目     | 内容                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 现象     | 8091 全站不可达（宿主 `curl` 8s 超时），容器 `unhealthy`，但进程未退出；8092 学生端返回 `upstream_unavailable`    |
| 持续     | 约 5 分钟（00:06 起），人工 `docker restart` 后恢复                                                               |
| 取证     | 旧容器日志随 compose `--force-recreate` 丢失；`bank_health_cache.computed_at`=21:42（未过期）→ **不是体检在跑**； |
|          | 容器内存 52 MB / 2 GiB（无 OOM）；WAL 0 字节；事故后 `announcements`（小表）仍需 2.4s → 磁盘延迟抖动明显          |
| 根因     | 组合因素：**(b) 存储 IO 延迟 + 同步 SQLite 架构** —— `node:sqlite` 是同步 API，任一慢查询都会卡住整个事件循环；   |
|          | 机械盘 IO 抖动（NAS 上还有下载/媒体任务）时，健康检查这类纯内存接口也被拖死。体检 worker 当时未运行，属潜在引信   |
| 处置     | 重启容器恢复；2.3.2 关闭自动体检、体检降优先级、算完 checkpoint、补看门狗                                         |
| 遗留风险 | 体检改为手动后仍需在低峰点；同步 SQLite 的固有风险未消除（彻底方案：换异步驱动或读写分离/独立进程）               |

## 10. SQLite 内存参数（稳定性补丁，2026-11-26）

生产两次「整站无响应」的根因是同一个：**同步 `node:sqlite` 在机械盘上读页时阻塞事件循环**。
补丁把页缓存与 mmap 调大，让 1.2 GB 的库尽量常驻内存，减少随机读盘。

落点：`apps/api/src/db/client.ts` 的 `Db` 构造函数（**只在 sqlite 连接上**执行；`MC_DB=pg` 不经过这里）。

| PRAGMA               | 值                   | 说明                                            |
| -------------------- | -------------------- | ----------------------------------------------- |
| `cache_size`         | `-262144`（≈256 MB） | 页缓存（原 64 MB）                              |
| `mmap_size`          | `2147483648`（2 GB） | 只读映射整个库，热页命中后不再读盘（原 256 MB） |
| `synchronous`        | `NORMAL`             | WAL 下减少 fsync；崩溃最多丢最后一个事务        |
| `busy_timeout`       | `5000`               | 锁等待 5 s                                      |
| `temp_store`         | `MEMORY`             | 排序/分组临时表放内存                           |
| `journal_size_limit` | `64 MB`              | 限制 `-wal` 膨胀                                |
| `query_only`         | `ON`（只读连接）     | 体检子进程只读连接显式禁写                      |

**权衡**：`mmap` 是虚拟地址空间映射，不直接等于 RSS（实测容器 RSS 仍 < 300 MB，上限 2 GiB）；
`cache_size` 会实实在在占内存，2 GiB 上限下足够。若未来把内存上限压到 1 GiB 以下，先把
`cache_size` 降回 `-131072`（128 MB）。

**回退**：把 `cache_size`/`mmap_size` 改回 `-65536`/`268435456` 即回到补丁前行为（无需改表/迁移数据）。

**注意**：`PRAGMA` 是**连接级**的，用 `node -e` 另开连接看到的永远是默认值；
要看实际生效值，得在 `Db` 构造之后打印，或直接看行为（`/api/v1/healthz` 延迟、`iostat` 读放大）。

### 实测（NAS，NVMe 副本，50 次/接口，低峰）

| 接口                                     | 补丁前 P50 / P95 | 补丁后 P50 / P95                     |
| ---------------------------------------- | ---------------- | ------------------------------------ |
| `GET /api/v1/courses`                    | 5.3 ms / 6.4 ms  | 见下方「补丁后」一节（同一脚本复测） |
| `GET /api/v1/banks/1/questions?limit=20` | 1.5 ms / 2.2 ms  | 同上                                 |

> 说明：NVMe 副本上热页命中率高，差异会被掩盖；机械盘（生产 `/vol1`）上收益更明显。
> 生产验证只看「不再出现 healthz 超时」与 `iostat` 读放大下降，不做压测。
>
> ⚠️ **禁止用 NVMe 做验证**（2026-11-27 用户要求）：所有数据/副本一律在 `/vol1` 机械盘；
> 在 NVMe 上测「不卡」会掩盖机械盘冷页问题（2.4.0 就是这样漏掉的）。

## 11. 部署预热（必须做，2.4.1 起内置）

**为什么**：SQLite 在机械盘上冷页很贵。2.4.1 部署后首次 `GET /api/v1/banks/catalog` 实测 **54.6 s**
（`mmap_size=256MB` 下走普通 read，逐页缺页），期间 Node 事件循环被占住，用户会以为站点挂了。

**做法**：`redeploy.sh` 在 `readyz=200` 之后、宣布成功之前，**顺序**打这几个重接口（每接口超时 180 s，
失败只告警不阻断），把页缓存焐热；随后再跑一次热态探针。

```
预热 /api/v1/banks/catalog
预热 /api/v1/banks/catalog-sections?view=book
预热 /api/v1/courses
预热 /api/v1/settings
预热 /api/v1/announcements
热态探针：healthz=200/0.002s courses=401/0.002s   # 401 是未登录，属预期
```

实测（2.4.1，NAS，2026-11-27 23:20）：容器 recreate → readyz 2 s → 5 个预热接口各 1.5–3.2 ms
（此时页缓存已热）→ 部署完成。**用户首访已是热态。**

**手动预热**（不重新部署时）：

```bash
for p in /api/v1/banks/catalog '/api/v1/banks/catalog-sections?view=book' /api/v1/courses /api/v1/settings /api/v1/announcements; do
  curl -s -o /dev/null -w "$p %{time_total}s\n" -m 180 "http://127.0.0.1:8091$p"
done
```

> 冷启动后如果跳过预热直接压测关键接口，测到的会是「冷页代价」而不是性能问题 ——
> 切流验证清单里必须先预热再测。
