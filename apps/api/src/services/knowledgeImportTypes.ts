/** 知识点批量导入的共享类型与上限。 */

/** 单个 md 上限（zip 内） */
export const MAX_MD_BYTES = 20 * 1024 * 1024;
/** 单张图片上限 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type UnmatchedReason = 'no-lesson' | 'multiple-lessons';

export interface KnowledgeImportItem {
  lessonId: number;
  lessonTitle: string;
  chapter: string;
  /** 源文件标题（保留 `1.1 ` 序号，便于老师对照素材） */
  title: string;
  chars: number;
  images: number;
}

export interface KnowledgeImportUnmatchedItem {
  title: string;
  chapter: string;
  reason: UnmatchedReason;
}

export interface KnowledgeImportReport {
  dryRun: boolean;
  matched: number;
  unmatched: number;
  skipped: number;
  missingImages: number;
  /** 正式导入时写入的条数；dryRun 不返回该字段 */
  imported?: number;
  items: KnowledgeImportItem[];
  unmatchedItems: KnowledgeImportUnmatchedItem[];
}

/** zip 内图片的按需读取接口（dryRun 只用 has） */
export interface ImageLookup {
  has(zipPath: string): boolean;
  read(zipPath: string, maxBytes: number): Promise<Buffer | null>;
}

export interface MarkdownSource {
  path: string;
  content: string;
  /** zip 内的图片索引；直接上传的 md 为 null */
  lookup: ImageLookup | null;
}

/** 待写入数据库的课时级知识点行 */
export interface PlannedKnowledge {
  lessonId: number;
  title: string;
  kind: 'text';
  content: string;
  sort: number;
}
