# 代码规范（当前与后续开发都适用）

> 这份规范是可执行的，不是倡议：`node tools/check-file-size.mjs` 会在本地 pre-push 和 CI 里跑。
> 违反「文件行数」规则会直接失败。

## 一、单文件百行级

| 规则             | 数值                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| 单个源文件目标   | **100 ~ 200 行**                                                                     |
| 单个源文件硬上限 | **300 行**（新文件超过直接失败）                                                     |
| 历史超限文件     | 登记在 `tools/file-size-baseline.json`，**只能变小，不能变大**；拆小了要从基线里删掉 |

适用范围：`apps/api/src`、`apps/web/src`、`packages` 下的 `.ts` / `.vue` / `.css`。

拆分方式：

- **界面**：按「一块可独立刷新的区域」拆组件（弹窗、面板、列表、表单各一个文件）；
- **逻辑**：按职责抽 composable（Vue）或 service（API），一个文件只做一件事；
- **纯函数**：放 `utils/` 或独立的领域模块，方便单测；
- **样式**：跟着组件走。Vue 的 `<style scoped>` 不会作用到子组件内部，抽组件时必须把相关规则一起搬走 —— 这是本项目已经踩过的坑。

## 二、组件与服务的边界

1. 一个组件只负责一块界面；数据加载走 composable，不直接堆在组件里。
2. 一个 service 只负责一个领域动作（判分 ≠ 组卷 ≠ 成绩单 ≠ 导出）。
3. 跨模块共享的类型放 `types.ts` / `packages/shared`，不要各自复制。
4. 纯计算（判分、评分、格式化）抽成不依赖 DB/Fastify 的函数，先写单测。

## 三、提交前必须通过

```bash
npx prettier --check .
npx eslint .
npm run typecheck
npx vitest run
node tools/check-file-size.mjs
```

`pre-push` 钩子与 CI 会跑上述检查（GitHub Actions 的 Lint · Typecheck · Test · Build）。

## 四、重构时的铁律

1. **行为不变**：只搬代码，不改 API 路径、参数、文案、排序/筛选规则。
2. **样式跟着组件走**：抽组件时把用到的 CSS 规则一起搬进新组件，搬完截图对比。
3. **类型共享**：父组件私有的类型（interface）在拆分后要提到共享模块。
4. **一步一验证**：每拆一个文件跑一次 typecheck + build，全部拆完再跑 E2E。
