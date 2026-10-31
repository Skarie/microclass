/**
 * 「教师版题库」整册覆盖导入的入参 / 报告结构（CLI 原样打印为 JSON）。
 */

export interface TeacherBankImportInput {
  /** 学科：数学 / 化学 / 物理 */
  subject: string;
  /** 册次，如「七年级上册（新）」（与课程名的册次段一致） */
  book: string;
  /** 源目录：题库_教师版根目录，或 `<...>/<学科>/<册次>`，或 `<册次>` 目录本身 */
  sourceDir: string;
  /** 只统计不写库（题图也不落盘） */
  dryRun?: boolean;
  /** samples 最多保留多少条（默认 20） */
  maxSamples?: number;
}

/** 每个小节的落地情况 */
export interface TeacherBankImportSample {
  chapter: string;
  section: string;
  /** dry-run 下新建的题库还没有 id → null */
  bankId: number | null;
  action: 'replace' | 'create';
  questions: number;
}

export interface TeacherBankImportReport {
  dryRun: boolean;
  /** 命中的课程名；没匹配到为 null */
  course: string | null;
  /** 扫描到的小节数（`题目.md` 文件数） */
  sections: number;
  /** 复用（整库覆盖）的题库数 */
  banksMatched: number;
  /** 新建的题库数 */
  banksCreated: number;
  /** 解析出的题目数 */
  questions: number;
  /** 带配图的题目数 */
  questionsWithImages: number;
  /** 找不到的图片文件数 */
  missingImages: number;
  /** 未知题型（已归入简答题）的题目数 */
  unknownTypes: number;
  /** 正式导入写入的题目数（dry-run 不出现该字段） */
  imported?: number;
  samples: TeacherBankImportSample[];
  /** 没匹配到课程的册次 */
  unmatchedCourses: string[];
}
