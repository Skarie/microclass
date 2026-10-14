# 贡献指南

## 开发环境

- Node ≥ 22.5（使用 `node:sqlite`）
- `npm install` → `npm run migrate` → `npm run dev`
- 编辑器建议启用 ESLint + Prettier（仓库已含配置）

## 分支与提交

- 分支：`feat/xxx`、`fix/xxx`、`chore/xxx`、`docs/xxx`
- 提交信息：Conventional Commits（`feat(api): …`、`fix(web): …`、`docs: …`）
- 一个 PR 只做一件事；改动需同步更新 `CHANGELOG.md` 的 `Unreleased`

## 代码规范（硬性）

1. **分层不得跨越**：路由不写 SQL，仓储不抛 HTTP 语义错误，服务不做 HTTP 处理。
2. **错误统一**：抛 `AppError`（来自 `@microclass/shared`），禁止裸 `throw new Error` 暴露给用户。
3. **输入必须校验**：路由用 JSON Schema 声明 `body/querystring/params`。
4. **写操作必须审计**：服务层调用 `audit.write`（登录、课程/课时/用户/设置等）。
5. **迁移只增不改**：新变更必须新建 `db/migrations/NNNN_*.sql`；历史迁移禁止修改。
6. **类型严格**：`strict` + `noUncheckedIndexedAccess`；禁止 `any`（必要时用 `unknown` + 收窄）。
7. **日志脱敏**：不得打印密码、Cookie、令牌；新增字段请同步 `logger.ts` 的 redact 列表。

## 测试要求

- 新增服务/仓储：补单元测试（覆盖正常 + 边界 + 错误路径）
- 新增路由：补 `fastify.inject` 集成测试（含鉴权与校验失败用例）
- 覆盖率不得低于门禁（line ≥ 60% / branch ≥ 50%），下降需在 PR 中说明理由

## 前端界面规范（改 UI 必读）

1. **样式只走令牌**：颜色/间距/圆角/阴影/字号一律用 `styles/tokens.css` 的变量，禁止硬编码色值；
2. **新组件先进设计系统页**：`apps/web/src/views/admin/DesignSystemView.vue`（路由 `/admin/design`）
   是组件与令牌的唯一出处 —— 新增组件先在这里加一段，再用于业务页面；
3. **图标用 `Icon` 组件**（`components/icons.ts` 的图标名是联合类型，拼错在 typecheck 阶段报错），
   不要再拿 emoji 当图标（emoji 字形/线宽跨平台不一致，也无法跟随主题色）；
4. **页面结构统一**：`PageHeader`（标题/描述/面包屑/操作区）→ `Toolbar`（筛选/操作）→ 内容卡片；
5. **主次操作分明**：一屏只保留一个主按钮（`mc-btn--primary`），次要动作用 `mc-btn--soft`/ghost，
   低频操作收进 `DropdownMenu`（真机踩过：题库详情区曾 8 个同权重按钮并排）；
6. **可访问性硬门槛**：`npx playwright test tests/e2e/a11y.spec.ts` 必须 0 个 serious/critical
   （口径 WCAG 2.0/2.1 A+AA）。小字颜色必须用 `--mc-*-fg` 前景色令牌，
   直接用填充色做文字对比度会不足 4.5:1（真机实测 primary 4.07 / success 4.48 / warning 3.74）。

### 图表（数据可视化）

**不要引入第三方图表库**（自托管轻量平台，且图表库自带硬编码颜色会绕过设计令牌与 `design-guard`）。
现成的图形都在 `apps/web/src/components/charts/`，几何计算在 `apps/web/src/utils/chart.ts`（**有单测**）：

| 组件           | 用途                                      | 要点                                                               |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `DonutChart`   | 占比分布（如掌握度四档）                  | 圆心可放总数；图例带图标与百分比；`gapDeg` 控制扇区间隙            |
| `BarList`      | 排行/对比（知识点薄弱、学员错题、错误率） | `tone` 决定颜色；`valueText`/`hint` 补数值与说明；`clickable` 下钻 |
| `TrendChart`   | 时间趋势（作答量 + 正确率）               | 自带坐标轴/网格/悬浮明细；柱宽有上限，几天数据也不会变成色块       |
| `Sparkline`    | KPI 卡里的迷你走势                        | 纯装饰（`aria-hidden`），数值在卡片文字上                          |
| `ProgressRing` | KPI 卡里的百分比环                        | **必须给 `label`**（屏幕阅读器读它）；小数值用 `text` 传精确文本   |

规矩：

1. 颜色只能通过 `tone`（映射到 `--mc-*` 令牌），**禁止**在组件里写色值；
2. 图必须有无障碍名（`role="img"` + `aria-label` 概述，或 `ProgressRing` 的 `label`），
   数值不能只靠颜色表达；
3. 新增图形先加几何函数到 `utils/chart.ts` 并补单测（弧线边界、除零、单点数据最容易出错），
   再到 `/admin/design` 的设计系统页加示例 —— 那里同时是视觉回归的靶子。

## 提交前自检

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npx playwright test          # 含无障碍扫描与视觉回归
```

改动界面的额外步骤：

```bash
# 视觉回归基线（首次或"确实要改外观"时）：确认 diff 符合预期后再更新
npx playwright test visual --update-snapshots
# 详细无障碍报告（哪个元素、差多少对比度）
MC_BASE_HOST=http://127.0.0.1:8091 node build/a11y-report.mjs --only 题库管理
# 真机截图巡检（登录 → 逐页截图 + 控制台错误）
MC_BASE_HOST=http://<NAS-IP>:8091 MC_ADMIN_PASS=… node build/ui-audit-shots.mjs
```

开发期连远端真机数据（视觉迭代不用反复打镜像）：

```bash
MC_DEV_API=http://<NAS-IP>:8091 npm run dev:web
```

## 文档要求

- 新增/变更 API：更新 `docs/api.md`
- 变更架构或依赖方向：更新 `docs/architecture.md`
- 变更部署或运维方式：更新 `docs/deploy.md` / `docs/ops-runbook.md`

## 贡献授权（重要）

本项目采用 **PolyForm Noncommercial 1.0.0**（禁止商用）。提交 Issue/PR 即表示你同意：

1. 你的贡献以**本项目当前许可**授权给本项目及下游使用者；
2. 你同意作者可将你的贡献**一并纳入未来的商业授权版本**（即允许作者对本项目（含你的贡献）进行双许可/商业授权）；
3. 你确认贡献为你原创，或你已获得必要的授权，不存在第三方权利冲突。

> 第 2 条是为了保留"社区版 + 商业授权"双轨的可能。如果你不接受，请先与作者沟通再提交。
