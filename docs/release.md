# 版本与发布

## 版本号来源

单一事实来源是根 `package.json` 的 `version`，三处产物从它派生：

| 产物        | 注入方式                                                                   |
| ----------- | -------------------------------------------------------------------------- |
| 后端 API    | 环境变量 `MC_VERSION`（`GET /api/v1/version` 返回），Docker/FPK 构建时传入 |
| Docker 镜像 | `--build-arg MC_VERSION=<版本>`（Compose 里用 `${MC_VERSION:-2.0.0}`）     |
| FPK 应用包  | `ops/fpk/manifest` 的 `version`（`build.sh` 会按 package.json 覆盖）       |

发版步骤：

1. 更新根 `package.json` 的 `version`（workspace 包的版本可保持一致），在 `CHANGELOG.md` 增加条目；
2. 跑完整质量门禁：`npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && npm run build && npm run test:e2e`；
3. 产出三端产物（见下）；
4. 打标签（如仓库纳入版本管理）：`git tag -a v<版本> -m "微课堂 <版本>"`；
5. 按「部署前检查」逐项确认后再上线。

## 三端产物

```bash
# 1) 本地 / 裸机
npm run build && MC_ENV=production MC_PORT=8091 npm start

# 2) Docker
docker build -f ops/docker/Dockerfile --build-arg MC_VERSION=<版本> -t microclass:<版本> .
docker save microclass:<版本> | gzip > microclass-<版本>-image.tar.gz   # 离线分发
# 或直接：cd ops/docker && docker compose up -d --build

# 3) fnOS FPK
bash ops/fpk/build.sh
# 到 NAS 上：fnpack build microclass  →  appcenter-cli install-fpk microclass.fpk
```

镜像与 FPK 包都不含运行时数据，数据库与上传文件在数据目录（Docker 卷 `mcdata` / fnOS `@appdata/microclass/data`）。

### 产物优化空间（后续可做，非必需）

- **镜像体积与构建耗时**：运行镜像约 290MB，大头是 `node_modules`；构建时 `COPY node_modules`
  在 NAS 机械盘上要数分钟（已用 `COPY --chown` 免去递归 chown）。若要更快更小，可用 esbuild 把 API
  打成单文件（Fastify 与业务代码均为纯 JS，`node:sqlite` 是内置模块），运行阶段只留 bundle，
  镜像可降到约 80MB，构建近乎瞬时。
- **FPK 体积**：同理，staging 的 24MB 主要是生产依赖，bundle 后可降到几 MB。

## 部署前检查

- [ ] `npm run backup` 已生成最新备份（升级/迁移前必备）
- [ ] `MC_ADMIN_PASS` 已设置为强密码（仅首次初始化使用）
- [ ] `MC_SESSION_SECRET` 已显式配置（否则会生成并持久化在数据目录 `.secret`）
- [ ] `MC_TRUST_PROXY` 仅在反向代理之后设为 1
- [ ] 媒体目录已挂载且应用有读取权限
- [ ] 反代已透传 `X-Request-Id`，并按需开启 HTTPS/HSTS/CSP
- [ ] `curl -fsS http://<host>:<port>/api/v1/readyz` 返回 `{"status":"ready"}`

## 升级与回滚

**升级（Docker）**

```bash
docker compose pull || docker compose build
docker compose up -d
docker compose logs -f --tail 50      # 观察迁移日志
```

**升级（FPK）**：`appcenter-cli install-fpk microclass.fpk`
—— `cmd/upgrade_init` 会在升级前把数据目录打包到 `$TRIM_PKGVAR/backup/pre-upgrade-<时间戳>.tar.gz`（保留 5 份）。

**数据库迁移**：服务启动时自动执行且幂等；历史迁移的校验和被记录，被篡改会直接拒绝启动（保护数据一致性）。

**回滚**

1. 停止服务（`docker compose down` / 应用中心停止）；
2. 还原代码/镜像到上一版本（`docker tag` 旧镜像 / 重新安装旧 FPK）；
3. 用备份恢复数据：`npm run restore -- --from <备份包> --data-dir <数据目录> --force`
   （脚本会先做 `integrity_check`，并把现有目录改名保留为 `<数据目录>.pre-restore-<时间戳>`）；
4. 启动服务并校验 `/api/v1/readyz`、`/api/v1/version` 与关键页面。

> V1 原型已下线并从仓库移除（源码归档为 `microclass-v1-legacy-<时间戳>.tar.gz`，见 `docs/deploy.md`）。
> 由于 V2 的迁移是**纯加法**，旧库与旧代码仍相互兼容，必要时可用历史镜像/版本包回退。

## 兼容性

- **V1 数据**：`0001_initial_schema.sql` 与 V1 结构一致且 `IF NOT EXISTS`，可直接接管既有数据库；
  `0004` 迁移按 V1 的 `client_id = 'u<userId>'` 约定回填刷题记录归属。
- **账号**：V1 的用户密码哈希（scrypt）在 V2 下可直接登录（已在真实数据上验证）。
- **答案编码**：题库的 answer 仍使用 V1 的「选项下标」编码，CSV 导入导出格式（中文题型、字母答案、BOM+CRLF）与 V1 完全一致。
