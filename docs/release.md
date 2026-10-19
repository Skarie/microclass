# 版本与发布

## 版本号怎么定

用语义化版本，规则简单：

| 改动类型                                               | 升哪一位     | 例子                 |
| ------------------------------------------------------ | ------------ | -------------------- |
| 修 bug、文案、样式微调                                 | patch +1     | 2.1.0 → 2.1.1        |
| 新功能、界面结构/信息架构调整、配色体系变化            | minor +1     | 2.1.1 → 2.2.0        |
| 不兼容变更（接口、数据迁移、部署方式、配置项语义变化） | major +1     | 2.2.0 → 3.0.0        |
| 纯文档/CI/注释，不影响运行产物                         | 可以不升版本 | 或随下一次功能一起升 |

判断不清时按 minor 处理。**同一次改动要在一个版本里做完**：先改完、跑完门禁，再统一升版本、写 CHANGELOG、打 tag。

## 版本号在哪些地方

`apps/web/package.json` 是前端产物的单一来源，其余地方保持同步：

| 产物           | 来源                                      | 怎么体现                       |
| -------------- | ----------------------------------------- | ------------------------------ |
| 前端界面       | `apps/web/package.json` → 构建期 `define` | 页脚与登录页显示 `v<版本>`     |
| 后端 API       | 环境变量 `MC_VERSION`                     | `GET /api/v1/version`          |
| Docker 镜像    | 构建参数 `--build-arg MC_VERSION`         | 镜像 tag                       |
| FPK 应用包     | `ops/fpk/manifest`（`build.sh` 覆盖）     | 应用中心里显示的版本           |
| 根 / workspace | 各 `package.json` 保持一致                | 便于 `npm ls` 与依赖解析不出错 |

所以升版本时至少要改：根 `package.json`、`apps/api`、`apps/web`、`packages/shared` 四处，并同步 `package-lock.json`（`npm install --package-lock-only`）。
**注意**：workspace 之间的依赖要用 `"*"` 而不是精确版本，否则升级后容器里 `npm ci` 会去公共 registry 找旧版本直接 404。

## 发版步骤

1. 改完代码，跑门禁：`npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build && npm run test:e2e`；
2. 升版本（上面四处）+ 同步锁文件；
3. `CHANGELOG.md` 顶部加 `## [x.y.z] - YYYY-MM-DD`，写清"改了什么、为什么、注意点"；
4. 提交、推送 `main`；
5. 打 tag 并推送：`git tag -a vx.y.z -m "vx.y.z · 一句话主题"` → `git push origin vx.y.z`；
6. 建 GitHub Release，标题用 `vx.y.z · 一句话主题`，正文直接取 CHANGELOG 该版本段落；
7. 确认 CI 三个 job 全绿，再部署并核对线上版本号（页脚 / 登录页 / `/api/v1/version`）。

## 提交说明怎么写

写给下一个看日志的人看，不写给评审机器人看：

- 标题一句话说清"改了什么"，中文即可，不超过 40 字，结尾不加句号；
- 正文只在需要时写，2～4 行讲"为什么"，不复述代码；
- 不写"验证：xx 通过"这类流水账 —— CI 会替你证明；
- 不写"按用户要求""这是第一版/最终版"之类的话，也不要用 markdown 加粗和分组标题；
- 一次提交只做一件事；顺手改的东西要么拆开，要么在正文提一句。

示例（好）：

```text
去掉侧边栏，改成顶部导航

侧边栏太像后台模板，管理入口也挤。改成顶部横向导航，
管理项收进下拉，窄屏用抽屉。
```

示例（不好）：大段分点、加粗小标题、末尾附测试清单与"验证"说明。

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
