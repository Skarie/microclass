/**
 * 题目仓储的公开输入/输出类型。
 *
 * 从 questionRepository 抽出：领域模块（查询、写入、统计、难度、去重、维护）都要用这些结构，
 * 集中定义避免模块之间互相 import；`questionRepository.ts` 仍从原路径 re-export，调用方无感。
 */
import type { Question, QuestionType } from '@microclass/shared';

/** 题干里引用内容寻址题图（题库导入的题）→ 用于「缺图/带图」统计与回填 */
export const QUESTION_MEDIA_REF = 'question-media';

export interface QuestionInput {
  bankId: number;
  lessonId?: number | null;
  type: QuestionType;
  stem: string;
  imagePath?: string;
  options: string[];
  answer: string;
  analysis?: string;
  sort?: number;
  /** 难度：easy / medium / hard（空串 = 未标注） */
  difficulty?: string;
  /** 标准化元数据（迁移 0008）：学科 / 学段 / 书册 / 章节 / 知识点 / 来源目录 / 原题号 / 内容指纹 */
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  /** 小节（迁移 0025，可空） */
  section?: string;
  point?: string;
  sourcePath?: string;
  sourceNo?: string;
  contentHash?: string;
  /** 题干/选项/解析里是否引用了题图（体检统计用，避免 LIKE 全表扫描） */
  hasImage?: boolean;
  /** 解析是否「只有图片、没有一个字」（迁移 0020 预计算列） */
  analysisMediaOnly?: boolean;
}

export interface QuestionFilter {
  type?: QuestionType;
  keyword?: string;
  difficulty?: string;
  /** 标准化元数据筛选（题库体检 / 组卷按知识点抽题用） */
  subject?: string;
  book?: string;
  chapter?: string;
  /** 小节精确筛选（迁移 0025） */
  section?: string;
  point?: string;
  stage?: string;
  /** 只看有配图 / 没有配图的题 */
  hasImage?: boolean;
  /** 只看「解析只有图片、没有一个字」的题（迁移 0020 预计算列） */
  mediaOnlyAnalysis?: boolean;
}

/** 分页窗口：列表 SQL 只有传了 page 才追加 LIMIT/OFFSET（与拆分前一致） */
export interface QuestionPage {
  limit: number;
  offset: number;
}

/** 体检统计（`health()` 的返回结构） */
export interface QuestionHealth {
  total: number;
  missingDifficulty: number;
  emptyAnswer: number;
  withoutImage: number;
  withImage: number;
  /** 解析只有图片、没有一个字的题（图片里是解析文字截图） */
  mediaOnlyAnalysis: number;
  duplicateGroups: number;
  duplicateQuestions: number;
  conflictGroups: number;
  noFingerprint: number;
}

/** 难度判定特征行：只选判定需要的列，避免读 analysis 这类大字段 */
export interface DifficultyFeatureRow {
  id: number;
  bank_id: number;
  type: QuestionType;
  stem: string;
  options: string;
  answer: string;
  has_image: number;
  subject: string;
  stage: string;
  book: string;
  chapter: string;
  point: string;
  difficulty: string;
  difficulty_source: string;
  bank_kind: string;
  bank_name: string;
}

export interface DifficultyFeatureOptions {
  bankId?: number;
  afterId?: number;
  limit?: number;
  onlyAuto?: boolean;
  onlyUnscored?: boolean;
}

/** 难度分档阈值（三档 + 五级切点），与落库时用的口径一致 */
export interface DifficultyStatsCuts {
  easyMax: number;
  mediumMax: number;
  five: [number, number, number, number];
}

/** 难度分布与来源统计（体检 / 重算预览用） */
export interface DifficultyStats {
  total: number;
  unscored: number;
  buckets: { difficulty: string; questions: number }[];
  levels: { level: number; questions: number }[];
  sources: { source: string; questions: number }[];
  histogram: { bucket: number; questions: number }[];
}

/** 难度分布 SQL 的复合分组行；汇总成 DifficultyStats 是纯函数（便于单测） */
export interface DifficultyLevelRow {
  level: number;
  source: string;
  difficulty: string;
  bucket: number;
  questions: number;
}

export interface DifficultyScoreRow {
  id: number;
  difficulty_score: number;
}

export interface QuestionStemRow {
  id: number;
  stem: string;
  bank_name: string;
}

export interface AnswerStat {
  id: number;
  total: number;
  correct: number;
}

/** 批量写难度结果的入参（score + 三档 + 来源 + 校准信息） */
export interface DifficultyUpdateItem {
  id: number;
  score: number;
  difficulty: string;
  source: 'auto' | 'calibrated' | 'manual';
  n?: number;
  p?: number | null;
}

/** 跨题库检索条件（按知识点/书册/难度） */
export interface SearchMetaOptions {
  subject?: string;
  book?: string;
  chapter?: string;
  point?: string;
  difficulty?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

/** 知识点聚合条件 */
export interface PointStatsOptions {
  subject?: string;
  book?: string;
  point?: string;
  limit?: number;
}

export interface PointStatRow {
  subject: string;
  book: string;
  point: string;
  questions: number;
  easy: number;
  medium: number;
  hard: number;
  banks: number;
}

/** 带题库名的题目（跨题库检索结果） */
export type QuestionWithBankName = Question & { bank_name: string };
