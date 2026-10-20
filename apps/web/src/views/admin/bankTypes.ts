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
