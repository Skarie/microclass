/**
 * 知识点相关视图模型：课程级知识点（整门课共享）与批量导入。
 *
 * 课程级知识点的增删改查与课时级共用 `Knowledge` 结构，
 * 区别只在挂载处：课程级没有课时（lesson_id 为 null），走 /courses/:id/knowledge。
 */
import type { Knowledge } from './types';

export type { Knowledge };

/** 批量导入：一个 Markdown 文件（或压缩包里的一个文件）匹配到的课时 */
export interface KnowledgeImportItem {
  lessonId: number;
  lessonTitle: string;
  chapter: string;
  /** 知识点标题（通常取自文件名） */
  title: string;
  /** 正文长度（字符数） */
  chars: number;
  /** 正文里引用的图片数 */
  images: number;
}

/** 批量导入：没有匹配到课时的条目 */
export interface KnowledgeImportUnmatched {
  title: string;
  chapter: string;
  /** 后端原因码：no-lesson / ambiguous 等 */
  reason: string;
}

/** dryRun 预览与正式导入的响应结构（正式导入额外返回 imported） */
export interface KnowledgeImportResult {
  dryRun: boolean;
  /** 将导入（或已导入）的课时数 */
  matched: number;
  unmatched: number;
  skipped: number;
  /** 正文引用了、但压缩包里没有的图片数 */
  missingImages: number;
  items: KnowledgeImportItem[];
  unmatchedItems: KnowledgeImportUnmatched[];
  /** 正式导入实际写入的知识点数 */
  imported?: number;
}

/** 新增/编辑知识点的请求体（课程级只支持文本与外链，与课时级校验一致） */
export interface KnowledgePayload {
  title: string;
  kind: 'text' | 'link';
  content?: string;
  url?: string;
}
