# 重构路线图（V2 企业级）

> 原则：每一步都可独立验证；**功能不减、数据不丢、三端可部署**。

## 阶段 0：工程化地基 ✅ 已完成（待运行时验证）

- [x] 新仓库结构（apps/packages/db/ops/docs/.github）
- [x] TypeScript 严格模式、ESLint（type-aware）、Prettier、EditorConfig
- [x] Vitest + 覆盖率门槛；迁移单测 + Fastify inject 集成测试
- [x] 编号化 SQL 迁移 + `schema_migrations` 版本表 + 篡改检测
- [x] `packages/shared`：类型 / 常量 / 错误码 / 领域错误
- [x] LICENSE、CHANGELOG、.gitignore、CI 流水线
- [ ] `npm install` 与首次全量验证（**等待本机 shell 恢复**）

## 阶段 1：后端分层与 API v1 🚧 进行中

- [x] Fastify 应用装配（cookie / helmet / rate-limit / multipart / static）
- [x] 统一错误信封 `{error:{code,message,requestId,details}}` + requestId 全链路
- [x] 守卫：requireUser / requireAdmin / requireTeacherOrAdmin
- [x] 认证：登录、注册、登出、改密、meta、管理员引导
- [x] 课程：列表聚合、详情、增删改、封面上传、收藏、分类
- [x] 课时：列表（含进度）、详情（含知识点）、增删改、视频 Range 流
- [x] 媒体文件夹：列表、增删、浏览、扫描、**按文件夹批量导入**、服务器目录浏览
- [x] 用户与设置（管理员）：学生/教师账号、重置密码、审计日志、注册开关
- [x] 学习进度：上报、查询、学习概览（时长/等级）
- [ ] 题库（banks/questions）：CRUD、CSV 导入导出、模板、图片题
- [ ] 刷题与判分：取题（隐藏答案）、随机抽 N 题、提交判分、错题本
- [ ] 考试中心：考试 CRUD、组题（随机/勾选）、限时考试、成绩单
- [ ] 统计报表：课程维度统计与 CSV 导出
- [ ] 文件上传补全：知识点附件、题目图片

## 阶段 2：前端重构（Vue3 + Vite + TS）⏳ 待开始

- [ ] 设计系统：令牌（色彩/间距/字体/圆角/阴影）、组件库（Button/Input/Table/Modal/Toast/Drawer/Tabs/Progress…）
- [ ] 布局壳：侧边导航 + 顶栏 + 面包屑；响应式与**无障碍**（键盘、focus、aria）
- [ ] 学员端：课程大厅（分类/收藏/进度）→ 课程页（章节树 + 课时 + 考试）→ 播放页（倍速/笔记/知识点/断点续播）→ 刷题/错题本/考试
- [ ] 管理端：数据表格（排序/筛选/分页）、表单校验、批量导入向导、组题与统计
- [ ] 状态管理（Pinia）+ 路由守卫 + API 客户端（错误信封统一处理）+ 暗色模式 + i18n(zh/en)
- [ ] 对齐标杆：超星学习通 / 中国大学 MOOC 的信息架构与交互

## 阶段 3：交付与运维 ⏳ 待开始

- [ ] 多阶段 Dockerfile（构建 → 运行，非 root 运行、健康检查）
- [ ] Compose 生产模板（含反向代理、备份卷、资源限制）
- [ ] FPK 打包流水线（native + nodejs_v22），版本号与 CHANGELOG 联动
- [ ] 数据库备份/恢复脚本（含 `VACUUM INTO` 一致性快照与定时任务）
- [ ] 部署手册、运维手册（日志/指标/排障/回滚）、OpenAPI 文档
- [ ] 发布流程：语义化版本、变更日志、产物校验（SHA256）

## 阶段 4：加固与验收 ⏳ 待开始

- [ ] E2E（Playwright）：注册→学习→刷题→错题→考试→统计 全链路
- [ ] 负载与并发（Range 流并发、SQLite 写并发策略）
- [ ] 安全复核（CSRF 策略、CSP、上传类型白名单、越权矩阵）
- [ ] 三端一致性验收（本地 / Docker / FPK）+ 数据迁移演练（V1 → V2 回滚预案）
