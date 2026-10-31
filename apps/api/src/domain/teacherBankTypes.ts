/**
 * 「教师版题库」解析结果的公开类型（解析器、写库服务与 CLI 共用）。
 *
 * 字段与 `题目.md` 一一对应：`answer` 已按平台既有编码规范化，
 * `images` 保留 Markdown 里的**相对引用**（如 `images/a1.png`），由写库服务
 * 负责落到题图仓库并改写成可访问 URL。
 */
import type { QuestionType } from '@microclass/shared';

/** 文件头元信息（`> 学科：…　书册：…　章节：…`） */
export interface TeacherBankMeta {
  subject: string;
  version: string;
  book: string;
  chapter: string;
  pointId: string;
  /** 采集侧声明的题目总数（仅用于核对，不参与入库） */
  total: number;
}

/** 一道题的选项：`no` 是 0 基下标（A=0），与 `questions.options` 数组顺序一致 */
export interface TeacherBankOption {
  no: number;
  content: string;
}

export interface TeacherQuestionDraft {
  /** 内部题型（未知题型归 short，由 `typeLabel` 保留原文） */
  type: QuestionType;
  /** 原题型标签，如「单选题」「解答题」「未知题型」 */
  typeLabel: string;
  /** 题目标识（稳定去重键，写入 `questions.source_id`） */
  sourceId: string;
  /** 难度值 0~1（≈正确率，越大越基础）；缺省为 null */
  difficulty01: number | null;
  stem: string;
  options: TeacherBankOption[];
  /** 已编码：单选 "1" / 多选 "0,2" / 判断 "T"|"F" / 填空 `空1|备选；空2` / 简答原文 */
  answer: string;
  /** 解析 + AI解析 */
  analysis: string;
  /** 解题思路（入库时并入 analysis） */
  thought: string;
  /** 解题方法（入库时并入 analysis） */
  method: string;
  /** 相关知识点（入库时并入 analysis） */
  points: string;
  /** 题内引用的图片相对路径（去重后） */
  images: string[];
}

/** 一份 `题目.md` 的解析结果 */
export interface TeacherBankDoc {
  /** 一级标题，通常是「小节」名 */
  title: string;
  meta: TeacherBankMeta;
  questions: TeacherQuestionDraft[];
  /** 出现过的未知题型标签（已归到 short，用于统计报告） */
  unknownTypes: string[];
}
