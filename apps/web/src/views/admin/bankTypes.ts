/** 左侧目录视图：题库（文件夹树）/ 课程关联 */
export type BankNavView = 'folder' | 'course';

/** 文件夹筛选：全部题库 / 未分类 / 某个文件夹 */
export type FolderFilter = 'all' | 'none' | number;

/** 课程筛选：全部题库 / 未关联 / 某门课程 */
export type CourseFilter = 'all' | 'unbound' | number;

/** 文件夹树节点（计数含子孙，排序由后端给出） */
export interface BankFolder {
  id: number;
  parentId: number | null;
  name: string;
  sort: number;
  bankCount: number;
  questionCount: number;
  folderCount: number;
  children: BankFolder[];
}

export interface BankFolderResponse {
  folders: BankFolder[];
  unfiled: { bankCount: number; questionCount: number };
}

/** 树形渲染用的一行（扁平化后带层级；避免递归组件与样式穿透问题） */
export interface BankFolderRow extends BankFolder {
  depth: number;
  path: string;
  hasChildren: boolean;
}

/** 表单里的文件夹选项（缩进提示层级） */
export interface BankFolderOption {
  id: number;
  name: string;
  depth: number;
  path: string;
  label: string;
}

/** 课程关联视图的一门课程（只含有题库的课程） */
export interface BankCourseSummaryRow {
  courseId: number;
  name: string;
  bankCount: number;
  questionCount: number;
}

export interface BankCourseSummary {
  courses: BankCourseSummaryRow[];
  unbound: { bankCount: number; questionCount: number };
}

/** 题库类型中文名（左栏题库行用） */
export const KIND_LABEL: Record<string, string> = { lesson: '课时配套', chapter: '章节题库', paper: '整卷试卷' };

/** 兼容 camelCase / snake_case 两种后端字段命名（按实际返回适配） */
export function bankFolderId(bank: { folderId?: number | null; folder_id?: number | null }): number | null {
  return bank.folderId ?? bank.folder_id ?? null;
}

export function bankFolderPath(bank: { folderPath?: string; folder_path?: string }): string {
  return bank.folderPath ?? bank.folder_path ?? '';
}

export function bankCourseName(bank: { courseName?: string; course_name?: string }): string {
  return bank.courseName ?? bank.course_name ?? '';
}

export function bankCourseId(bank: { courseId?: number | null; course_id?: number | null }): number | null {
  return bank.courseId ?? bank.course_id ?? null;
}

export function bankLessonTitle(bank: { lessonTitle?: string; lesson_title?: string }): string {
  return bank.lessonTitle ?? bank.lesson_title ?? '';
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
