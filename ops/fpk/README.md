# fnOS FPK 打包流水线

微课堂以 **fnOS 原生应用**形态发布：随包携带编译产物与生产依赖，安装即用，无需在 NAS 上联网安装 npm 依赖。

## 目录结构

```
ops/fpk/
├── manifest                 # 应用清单：appname/version/display_name/install_dep_apps
├── ICON.PNG, ICON_256.PNG   # 应用中心图标（256 / 64 见 app/ui/images）
├── build.sh                 # 组装 staging（可选直接调用 fnpack）
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
ssh <user>@<NAS-IP> 'cd /tmp && tar -xzf microclass-fpk-src.tar.gz && cd microclass && fnpack build microclass'
```

若当前机器本身就有 `fnpack`（例如直接在 NAS 上开发），可一步到位：

```bash
bash ops/fpk/build.sh --with-fnpack
```

## 安装 / 升级 / 卸载

```bash
appcenter-cli install-fpk /tmp/microclass/microclass.fpk   # 首次安装；再次执行即升级
/vol1/@appcenter/microclass/cmd/main status                # 0=运行中，3=未运行
appcenter-cli uninstall microclass                         # 卸载（保留 appdata 数据）
```

## 运行时约定

| 项目       | 值                                                             |
| ---------- | -------------------------------------------------------------- |
| 端口       | `8092`（`app/ui/config` 与 `cmd/main` 需保持一致）             |
| 数据目录   | `$TRIM_PKGVAR/data` → `/vol1/@appdata/microclass/data`         |
| 初始管理员 | `admin`，密码首次启动生成于 `$TRIM_PKGVAR/adminpass`（600）    |
| 日志       | `$TRIM_PKGVAR/info.log`                                        |
| PID        | `$TRIM_PKGVAR/app.pid`                                         |
| 升级前备份 | `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`（保留 5 份） |
| 数据库迁移 | 服务启动时自动执行（幂等）                                     |

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
