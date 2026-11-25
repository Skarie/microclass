# fnOS FPK 打包流水线

微课堂以 **fnOS 原生应用**形态发布：随包携带编译产物与生产依赖，安装即用，无需在 NAS 上联网安装 npm 依赖。

## 目录结构

```
ops/fpk/
├── manifest                 # 应用清单：appname/version/display_name/install_dep_apps
├── ICON.PNG, ICON_256.PNG   # 应用中心图标（256 / 64 见 app/ui/images）
├── build.sh                 # 组装 staging（可选直接调用 fnpack）
├── sync-content.sh          # 把 Docker 生产的内容数据单向快照同步到本应用
├── cmd/                     # 生命周期脚本，由 fnOS 调用
│   ├── main                 #   start | stop | status（真正的服务启停逻辑）
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

`build.sh` 会把下列内容装配进 `app/server/`：

| 来源                     | 目标                               | 说明                         |
| ------------------------ | ---------------------------------- | ---------------------------- |
| `apps/api/dist`          | `dist/`                            | 后端编译产物                 |
| `apps/web/dist`          | `web/`                             | 前端构建产物（同源托管）     |
| `db/migrations`          | `migrations/`                      | 启动时自动迁移               |
| `packages/shared/dist`   | `node_modules/@microclass/shared/` | 共享包（按包名解析）         |
| `npm install --omit=dev` | `node_modules/`                    | 生产依赖（fastify 全家桶等） |

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

## 与 Docker 版共用内容（单向快照）

同一台 NAS 上可以同时跑 Docker 生产（8091，卷 `microclass_data`）和 fnOS 原生应用（8092，
`/vol1/@appdata/microclass/data`）：**内容共用，账号各自独立**。

| 项目                                                       | 是否同步 | 说明                                                    |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------- |
| 课程 / 章节 / 课时 / 知识点                                | ✅       | 内容表整体复制                                          |
| 题库 / 题目 / 题目配图 / 题组 / 标签 / 公告 / 练习链接     | ✅       | 含 `uploads/`（视频、封面、题图）、`knowledge-media/`   |
| 账号（`users`）                                            | ❌       | FPK 只保留 `admin`，密码仍取自 `$TRIM_PKGVAR/adminpass` |
| 学习进度 / 练习 / 考试记录 / 错题 / 笔记 / 收藏 / 审计日志 | ❌       | 同步时清空                                              |

```bash
sudo bash ops/fpk/sync-content.sh            # 停两边 → 备份 FPK 数据 → 复制 db+媒体 → 剥离账号/行为 → 重启 → 对比计数
sudo bash ops/fpk/sync-content.sh --compare  # 只对比内容计数，不改数据
```

注意：

- **不要在两边同时录入内容**：同步是单向覆盖，以最后一次同步为准；Docker 侧永远作为主库。
- **管理员密码不随内容同步**：复制会带入 Docker 的 `admin` 凭据，脚本在剥离阶段会把 FPK 自己的
  admin 凭据（即 `$TRIM_PKGVAR/adminpass` 那份）写回去，先用 `dump-admin` 保存、同步后 `restore-admin` 还原。
- 脚本只读 Docker 卷（`compose stop` / `start`，不 `down`、不删卷），只写 FPK 数据目录；失败会自动把两边拉起来。
- `media-cache/`（HLS 转码缓存）不复制，FPK 侧播放时按需重建；1.2 GB 的大库首次启动会稍慢。
- 需把已删账号的行从物理页抹掉时，加 `MC_SYNC_VACUUM=1`（耗时更长）。

## 运行时约定

| 项目       | 值                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 端口       | `8092`（`app/ui/config` 与 `cmd/main` 需保持一致）                                                                        |
| 程序目录   | `$TRIM_APPDEST` → `/vol1/@appcenter/microclass`（服务在 `$TRIM_APPDEST/server`，`fnpack` 把 `app/` 内容解包到该目录根下） |
| 数据目录   | `$TRIM_PKGVAR/data` → `/vol1/@appdata/microclass/data`                                                                    |
| 初始管理员 | `admin`，密码首次启动生成于 `$TRIM_PKGVAR/adminpass`（600）                                                               |
| 日志       | `$TRIM_PKGVAR/info.log`                                                                                                   |
| PID        | `$TRIM_PKGVAR/app.pid`（丢失时按进程命令行兜底）                                                                          |
| 升级前备份 | `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`（保留 5 份）                                                            |
| 数据库迁移 | 服务启动时自动执行（幂等）                                                                                                |

> **注意**：实测 fnOS 1.2.1102 只注入 `TRIM_APPDEST`，**没有 `TRIM_PKGDIR`**；`cmd/main` 带 `set -u`，
> 引用未定义变量会立刻退出，应用中心表现为启动失败（错误码 10330 / 10500）。脚本已按 `TRIM_APPDEST`
> 取值并保留 `TRIM_PKGDIR` 回退。版本号由 `cmd/main` 从随包 `manifest` 读取后以 `MC_VERSION` 注入。

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
