# fnOS FPK 打包流水线（学生端）

微课堂在 fnOS 上以 **学生端应用** 形态发布：包里只有学生版前端 + 一个零依赖网关，
`/api/*` 反向代理到 Docker 生产（8091）。**账号、学习记录、题库只有一份**（在 Docker 里），
不存在两边不同步；教学/题库/系统管理仍只在 Docker 版里提供。

## 目录结构

```
ops/fpk/
├── manifest                 # 应用清单：appname/version/display_name/install_dep_apps
├── ICON.PNG, ICON_256.PNG   # 应用中心图标（256 / 64 见 app/ui/images）
├── build.sh                 # 组装 staging（学生版前端 + 网关）
├── server/proxy.mjs         # 网关：托管静态资源 + 把 /api/* 反代到 8091（零依赖）
├── sync-content.sh          # 【已过时】离线快照方案，见文末说明
├── cmd/                     # 生命周期脚本，由 fnOS 调用
│   ├── main                 #   start | stop | status（启停网关）
│   ├── install_init         #   安装前
│   ├── install_callback     #   安装后：准备数据目录
│   ├── upgrade_init         #   升级前：自动备份数据目录（失败即中止升级）
│   ├── upgrade_callback     #   升级后
│   ├── uninstall_init       #   卸载前：先停服务
│   ├── uninstall_callback   #   卸载后：保留数据目录
│   ├── config_init          #   改配置前
│   └── config_callback      #   改配置后
├── config/
│   ├── privilege            # {"defaults":{"run-as":"package"}}
│   └── resource             # 数据共享目录声明
└── app/
    ├── ui/config            # 桌面图标入口（端口 8092）
    └── ui/images/           # icon_64.png / icon_256.png
```

`build.sh` 只装配两样东西进 `app/server/`（产物约 3 MB，不再带 API 与 node_modules）：

| 来源                       | 目标        | 说明                                             |
| -------------------------- | ----------- | ------------------------------------------------ |
| `apps/web/dist`（学生版）  | `web/`      | `VITE_APP_EDITION=student` 构建，隐藏教学/管理端 |
| `ops/fpk/server/proxy.mjs` | `proxy.mjs` | 静态托管 + `/api` 反代到 `http://127.0.0.1:8091` |

## 构建

```bash
# 1. 组装（任何装了 Node 的机器都能跑）
bash ops/fpk/build.sh

# 2. 传输到 NAS 并在 NAS 上打包（fnpack 只随 fnOS 提供）
tar -czf microclass-fpk-src.tar.gz -C build/fpk microclass
scp microclass-fpk-src.tar.gz <user>@<NAS-IP>:/tmp/
ssh <user>@<NAS-IP> 'cd /tmp && mkdir -p fpk && tar -xzf microclass-fpk-src.tar.gz -C fpk && cd fpk && fnpack build -d microclass'
```

`fnpack build` 只接受 `-d/--directory`（默认当前目录），没有位置参数；产物落在执行命令的当前目录。

若当前机器本身就有 `fnpack`（例如直接在 NAS 上开发），可一步到位：

```bash
bash ops/fpk/build.sh --with-fnpack
```

## 安装 / 升级 / 卸载

```bash
appcenter-cli install-fpk /tmp/microclass/microclass.fpk   # 首次安装；再次执行即升级
appcenter-cli status microclass                            # running / stopped（需 sudo）
appcenter-cli stop microclass && appcenter-cli start microclass
appcenter-cli uninstall microclass                         # 卸载（保留 appdata 数据）
```

> 生命周期脚本在运行时位于 **`/var/apps/microclass/cmd/`**（fnOS 管理目录），不在 `$TRIM_APPDEST`
> 下；手动调试需自行注入 `TRIM_APPDEST` / `TRIM_PKGVAR` 环境变量。

## 与 Docker 版共用账号与数据

fnOS 应用（8092）**不持有数据库**：`/api/*` 全部反代到 Docker 生产（8091，卷 `microclass_data`），
所以账号、学习记录、题库、视频只有一份，学生在 fnOS 里注册/做题，管理端立刻能看到，反之亦然。

| 项目                                      | 说明                                                            |
| ----------------------------------------- | --------------------------------------------------------------- |
| 账号（`users`）                           | 共用 Docker 库；学生在 8092 自注册即写入 8091                   |
| 学习进度 / 练习 / 考试 / 错题 / 收藏      | 共用 Docker 库                                                  |
| 课程 / 课时 / 知识点 / 题库 / 题目 / 媒体 | 共用 Docker 卷（`uploads/`、`knowledge-media/`）                |
| 教学管理 / 题库管理 / 学员 / 系统设置     | **只在 8091 提供**，8092 是学生端（`VITE_APP_EDITION=student`） |

关键约束：

- **8092 依赖 8091 在线**：Docker 停了，学生端会返回「微课堂暂时无法连接」。docker 容器设了
  `restart: unless-stopped`，NAS 重启后会自己起来。
- 网关默认上游写死 `http://127.0.0.1:8091`，需要改端口/地址时在应用环境里设 `MC_UPSTREAM`。
- 学生端构建把 `/admin/*` 路由拦回课程大厅，并强制「学员视图」，管理入口不会出现。
- FPK 数据目录（`/vol1/@appdata/microclass/data`）现在只留历史数据，不再读写；确认无用后可清理
  旧快照：`rm -rf .../data/microclass.db* .../data/uploads .../data/knowledge-media`（释放约 4 GB）。

## 【已过时】离线快照方案

`ops/fpk/sync-content.sh` 是上一版「FPK 自己存一份内容库」时的一次性同步脚本（停写 → 复制 db+媒体 →
剥离非 admin 账号 → 还原 admin 凭据 → 启动 → 对比计数）。改成反代后 **不再需要**，仅在这些场景保留：

- 想让 fnOS 应用在 8091 停机时仍可离线看课（会失去「共用账号/记录」）；
- 需要把生产内容导一份快照到别处做验证。

用它就要接受：内容以最后一次同步为准、两边不能同时录入、账号/学习记录各自独立。

## 运行时约定

| 项目       | 值                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 端口       | `8092`（`app/ui/config` 与 `cmd/main` 需保持一致）                                                                        |
| 程序目录   | `$TRIM_APPDEST` → `/vol1/@appcenter/microclass`（网关在 `$TRIM_APPDEST/server`，`fnpack` 把 `app/` 内容解包到该目录根下） |
| 上游 API   | `http://127.0.0.1:8091`（Docker 生产；可用环境变量 `MC_UPSTREAM` 覆盖）                                                   |
| 账号       | 与 Docker 共用，应用内**没有** `adminpass` 之类的独立凭据                                                                 |
| 数据库     | **无**。网关只转发 `/api/*`，不落任何业务数据                                                                             |
| 日志       | `$TRIM_PKGVAR/info.log`                                                                                                   |
| PID        | `$TRIM_PKGVAR/app.pid`（丢失时按进程命令行兜底）                                                                          |
| 升级前备份 | `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`（保留 5 份）                                                            |

> **注意**：实测 fnOS 1.2.1102 只注入 `TRIM_APPDEST`，**没有 `TRIM_PKGDIR`**；`cmd/main` 带 `set -u`，
> 引用未定义变量会立刻退出，应用中心表现为启动失败（错误码 10330 / 10500）。脚本已按 `TRIM_APPDEST`
> 取值并保留 `TRIM_PKGDIR` 回退。`/api/v1/version` 返回的是 **Docker 侧的 node 版本**
> （如 `v22.23.2` 而不是 FPK 的 `v22.23.5`），可用来确认反代生效。

## 排障

```bash
tail -f /vol1/@appdata/microclass/info.log
curl -s localhost:8092/api/v1/healthz
curl -s localhost:8092/api/v1/version
ls -la /vol1/@appdata/microclass/backup/
```

常见问题：

- **启动失败**：先看 `info.log`；确认 `install_dep_apps = nodejs_v22` 已安装（`/vol1/@appcenter/nodejs_v22/bin/node` 存在）。
- **桌面图标点开是空白**：确认 `app/ui/config` 的端口与 `cmd/main` 的 `PORT` 一致，且 `curl localhost:8092/` 返回 HTML。
- **视频目录看不到**：fnOS 应用运行在受限权限下，需要在「设置 → 应用权限」中授予对应共享目录的读取权限，或把视频放进共享目录后重启应用。
