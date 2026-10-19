# 代码规范与重构计划

> 目标：文件别长成巨石、命名与职责一致、重复逻辑收敛、别人接手能看懂。
> 触发：2026-10 巡检发现单文件最大 3021 行，且出现过"推送后 CI 才报 lint 错"的重复事故。

## 一、现状（行数 Top 10）

| 文件                                           | 行数      | 问题                                         |
| ---------------------------------------------- | --------- | -------------------------------------------- |
| `apps/web/src/views/admin/BankAdminView.vue`   | **3021**  | 列表/导入/去重/健康检查/编辑全挤在一个组件里 |
| `apps/api/src/services/examService.ts`         | **1570**  | 组卷、判分、成绩、打印、导出混在一起         |
| `apps/web/src/views/admin/CourseAdminView.vue` | 1504      | 课程树 + 课时 + 媒体管理混在一起             |
| `apps/web/src/views/admin/ExamComposeView.vue` | 1408      | 组卷交互与渲染耦合                           |
| `apps/api/src/services/bankService.ts`         | 1268      | 题目 CRUD、导入、去重、体检、导出混在一起    |
| `CourseLessonAdminView.vue`                    | 996       |                                              |
| `lessonService.ts`                             | 890       |                                              |
| `WatchView.vue`                                | 873       | 播放、进度、笔记、问答、快捷键混在一起       |
| `questionRepository.ts` / `examRepository.ts`  | 804 / 798 | SQL 集中尚可，但领域方法偏多                 |

## 二、规范（新代码必须遵守）

1. **单文件上限 500 行**（Vue 单文件组件指 `<script setup>` + `<template>` 合计；超过就要拆）。
2. **一个文件一个职责**：服务按领域拆（组卷 ≠ 判分 ≠ 成绩单 ≠ 打印）；组件按「一块可独立刷新的界面」拆。
3. **命名与职责一致**：例如 `mediaOptimizeService`（faststart + HLS），不再叫 faststart —— 名字只描述一半功能，接手的人会误判。
4. **共享逻辑收敛到 `utils/`**：同一种格式化/校验只写一次。
5. **类型就近集中**：模块内类型放在文件顶部或 `types.ts`，跨模块共享才进 `packages/shared`。
6. **提交前跑校验**：`npx prettier --check . && npx eslint . && npm run typecheck`（仓库已装 pre-push 钩子，CI 再兜底）。
7. **行为改动配测试**：动判分/权限/计分逻辑，先在 `apps/api/test` 补用例。

## 三、拆分顺序（每步独立可验证）

### 第 1 步：`BankAdminView.vue`（3021 → 4 个面板组件）

```
views/admin/bank/
  BankListView.vue        题库列表 + 搜索/筛选
  BankImportPanel.vue     批量导入（含图片/公式）
  BankHealthPanel.vue     体检/去重/冲突扫描
  BankQuestionEditor.vue  单题编辑与配图
```

父组件只保留 tab 状态与数据加载。

### 第 2 步：`examService.ts`（1570 → 三个服务）

```
services/examGradeService.ts     判分（纯函数 + 小题型策略）
services/examPaperService.ts     组卷/换题/结构（大题分值与排序）
services/examReportService.ts    成绩单/打印 HTML/导出
```

`examService` 保留编排与对外 API，内部委托给上面三个。

### 第 3 步：其余大文件

- `CourseAdminView` / `CourseLessonAdminView`：抽「课程树」「课时列表」「媒体选择器」；
- `WatchView`：抽 `usePlayerHotkeys`、`useAutoSaveProgress`、`useNotes` 组合式函数；
- `bankService`：导入与去重各拆一个 service。

## 四、验收标准

- 行数 Top 10 全部 ≤ 800 行，新增文件 ≤ 500 行；
- `prettier --check .`、`eslint .`（0 error）、`npm run typecheck` 全过；
- 测试数量不减少（当前 488 通过 / 1 skipped），API 419 通过；
- 行为不变：E2E 40 条通过。

## 五、已完成的规范化

- `mediaFaststartService` → `mediaOptimizeService`：名字覆盖 faststart + HLS 两件事；
- 视频 / HLS / 缓存 / Origin 校验的行为都有测试与文档（`docs/video-playback.md`、`docs/deploy.md`）。
