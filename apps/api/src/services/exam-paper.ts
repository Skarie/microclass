/**
 * 试卷服务入口：对外导出保持不变，实现按领域拆到同目录 `paper*` 模块。
 *
 * 模块职责：
 *  - `paperCommon`    仓储依赖、考试校验、卷面视图、审计写入
 *  - `paperTypes`     结构 / 细目表 / 组卷 / 平行卷 / 换题的对外类型
 *  - `paperStructure` 大题结构（名称/题型/分值）与难度配比
 *  - `paperBlueprint` 卷面统计 + 双向细目表（纯计算）
 *  - `paperCompose`   智能组卷编排（配额 / 细目表两种模式）
 *  - `paperRange`     组卷范围与难度回退挑题
 *  - `paperQuota`     题型配额 + 难度配额组卷
 *  - `paperParallel`  平行卷逐题配对
 *  - `paperReplace`   换题候选 / 按指定候选换题 / 自动换题
 *  - `paperEdit`      加题、随机加题、改分值/大题、排序、删题
 *
 * `ExamService` 与路由继续从本文件 import，签名与行为不变。
 */
export { cnNumber, TYPE_NAME, parseStructure, setStructure } from './paperStructure.js';
export { findExam, paperView } from './paperCommon.js';
export type { ExamPaperDeps, PaperRow } from './paperCommon.js';
export type {
  AutoComposeInput,
  AutoComposeResult,
  BlueprintResult,
  ParallelMatch,
  SimilarCandidatesResult,
} from './paperTypes.js';
export { buildBlueprint, taxonomy } from './paperBlueprint.js';
export { autoCompose } from './paperCompose.js';
export { addByQuota } from './paperQuota.js';
export { matchParallelQuestions } from './paperParallel.js';
export { replaceQuestion, replaceWith, similarCandidates } from './paperReplace.js';
export { addQuestions, addRandom, removeQuestion, reorder, setQuestionMeta } from './paperEdit.js';
