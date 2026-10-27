/** 左侧目录视图：按课程（原有）/ 按册次（册次 → 章节 → 题库） */
export type BankNavView = 'course' | 'book';

/** 按册次视图的层级：册次列表 / 章节列表 / 题库列表 */
export type BookNavLevel = 'books' | 'sections' | 'banks';

/** 一个章节下的题库与题量（`section: ''` = 未分章） */
export interface SectionCount {
  section: string;
  bankCount: number;
  questionCount: number;
}

/** `GET /banks/catalog-sections?view=book` 的一个册次分组（`book: ''` = 未归类册次） */
export interface BankSectionBook {
  book: string;
  /** 该册次下存在未归属课程的题库 */
  isUnbound: boolean;
  bankCount: number;
  questionCount: number;
  sections: SectionCount[];
}

export interface BankSectionCatalog {
  view: 'book';
  books: BankSectionBook[];
}

/** 批量回填章节的预览 / 执行结果 */
export interface BackfillSectionsResult {
  dryRun: boolean;
  filled: number;
  skipped: number;
  samples: { id: number; name: string; section: string }[];
  skippedSamples: { id: number; name: string }[];
}

/** 题库体检的返回结构（体检弹窗与父页面共用） */
export interface BankHealth {
  scope: { bankId: number | null; name: string };
  stats: {
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
  };
  metadata: { withSubject: number; withBook: number; withPoint: number; withHash: number };
  duplicates: { content_hash: string; n: number; answers: number; stem: string }[];
  kinds: { kind: string; banks: number; questions: number }[];
  /** 难度结构（迁移 0016 的难度模型） */
  difficulty: {
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    levels: { level: number; questions: number }[];
    sources: { source: string; questions: number }[];
    histogram: { bucket: number; questions: number }[];
  };
}

/** 清理重复题的预览结果 */
export interface DedupeResult {
  dryRun: boolean;
  groups: number;
  removable: number;
  removed: number;
  samples: { stem: string; count: number }[];
}

/** 重算难度的预览结构 */
export interface DifficultyPreview {
  scope: { bankId: number | null; name: string };
  total: number;
  willScore: number;
  skippedManual: number;
  skippedCalibrated: number;
  cuts: { easyMax: number; mediumMax: number; five: number[] };
  predicted: {
    buckets: { difficulty: string; questions: number; ratio: number }[];
    levels: { level: number; label: string; questions: number; ratio: number }[];
  };
  current: {
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    sources: { source: string; questions: number }[];
  };
  samples: {
    easiest: { id: number; stem: string; score: number; reasons: string }[];
    hardest: { id: number; stem: string; score: number; reasons: string }[];
  };
}
