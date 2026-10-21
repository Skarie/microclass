/** 课时领域共享类型：入参、文件夹绑定/扫描结果、知识点讲义的中间结构。 */
import type { Knowledge, Lesson } from '@microclass/shared';

export interface LessonInputDto {
  title: string;
  description?: string;
  videoKind: Lesson['video_kind'];
  mediaRoot?: string;
  videoPath: string;
  sort?: number;
  groupName?: string;
  courseId?: number | null;
  source?: 'manual' | 'folder';
}

/** 课程文件夹绑定信息（管理页展示用） */
export interface CourseFolderInfo {
  rootId: string;
  rootName: string;
  /** 媒体根下的相对路径（空串 = 根目录本身） */
  path: string;
  available: boolean;
  lastScanAt: number | null;
}

/** 课程文件夹扫描结果：dryRun 时只统计不写库 */
export interface CourseScanResult {
  dryRun: boolean;
  courseId: number;
  folder: CourseFolderInfo;
  /** 磁盘上扫描到的视频总数 */
  onDisk: number;
  folders: number;
  added: number;
  /** 原本挂在别的课程、被收编到本课程的课时数 */
  assigned: number;
  /** 章节名随文件夹同步更新的课时数 */
  updated: number;
  skipped: number;
  missing: { id: number; title: string; videoPath: string; source: 'manual' | 'folder' }[];
  removed: number;
  total: number;
  newLessonIds: number[];
}

/** 章节怎么定：first（默认，第一层目录）/ full（完整目录路径）/ none（不设章节） */
export type ChapterMode = 'first' | 'full' | 'none';

export interface CourseScanInput {
  dryRun?: boolean;
  removeMissing?: boolean;
  onDuplicate?: 'skip' | 'assign';
  chapterMode?: ChapterMode;
}

export interface KnowledgeInput {
  lessonId: number;
  title: string;
  kind: 'text' | 'file' | 'link';
  content?: string;
  url?: string;
  fileName?: string;
  filePath?: string;
}

/** 知识点附件上传入参 */
export interface UploadKnowledgeFileInput {
  lessonId: number;
  title?: string;
  fileName: string;
  data: Buffer;
}

/** 知识点讲义导出结构：课程级按章节分组，单课时只有一个分组 */
export interface KnowledgeOutline {
  title: string;
  subtitle: string;
  chapters: { chapter: string; lessons: { lesson: Lesson; items: Knowledge[] }[] }[];
  totalItems: number;
}

/** 网页上传视频后创建课时的入参 */
export interface UploadLessonInput {
  title: string;
  videoPath: string;
  relPath?: string;
  groupName?: string;
  courseId?: number | null;
  sort?: number;
}

/** 单个课时的元数据抽取结果 */
export interface LessonProbeResult {
  available: boolean;
  duration: number | null;
  coverPath: string;
  mediaType: string;
}

export interface LessonProbePendingResult {
  probed: number;
  failed: number;
  remaining: number;
  available: boolean;
}
