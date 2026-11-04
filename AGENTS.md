# 前端设计工作流（强制）

本项目的所有前端界面改动都必须按下面的流程走，不允许直接改样式。

## 1. 先加载设计技能

写任何前端代码之前，先调用技能：

- `impeccable`：设计判断、评审、打磨、排版、布局、动效、反模式检测
- `ui-ux-pro-max`：需要设计方向/配色/字体/UX 规范时，用 `design_recommend` / `design_search` / `design_review`

新页面、新模块、改版 → 先 `design_recommend` 拿方向，再结合项目现有 token 落地（不要直接套用推荐配色，项目有自己的设计系统）。

## 2. 遵守项目设计系统

- 颜色/间距/字号/圆角/行高只能使用 `apps/web/src/styles/tokens.css` 里的 token
- 布局值用语义 token，禁止裸色值、裸行高、非 4 倍数间距
- 设计守卫测试（`apps/web/test/design-scale.test.ts`）会拦住违规写法
- 单文件 100~200 行、硬上限 300 行；样式跟组件走（`<style scoped>` 不穿透子组件）

## 3. 改完必须自检

1. 跑 Impeccable 检测器：
   `node C:/Users/28610/.dsh/profiles/desktop/node_modules/dsh-impeccable/assets/impeccable/scripts/detect.mjs --json <改动目录>`
   结果必须为空，否则修掉。
2. 跑 UI/UX 审查工具：`design_review`，按返回的「严重/高」条目处理。
3. 截图验收：1440 与 390 各一张，关键状态（空/加载/错误/选中/禁用）都要看。
4. 门禁：`npx prettier --check .`、`npx eslint .`、`npm run typecheck`、`npx vitest run`、`npm run build`、`node tools/check-file-size.mjs`。

## 4. 设计质量底线

- 不为了"好看"牺牲信息密度：工具型页面以扫读效率和操作准确为先
- 状态必须齐全：hover / active / focus-visible / disabled / loading / empty / error
- 触控目标：移动端 ≥44px，桌面 ≥24px（WCAG 2.2）
- 动效克制：150~300ms，优先 transform/opacity，避免动画 width/height/padding
- 颜色不能是唯一信息载体（对错、状态要配图标或文字）
