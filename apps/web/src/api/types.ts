/**
 * 前端视图模型：与 API 返回结构保持一致（snake_case 直接沿用，
 * 避免在前后端之间做无意义的大小写转换）。
 */

export type Role = 'admin' | 'teacher' | 'student';
export type QuestionType = 'single' | 'multiple' | 'judge' | 'fill' | 'short';
export type VideoKind = 'local' | 'embed' | 'url';
export type KnowledgeKind = 'text' | 'file' | 'link';
/** 课时来源：手工创建/上传，还是从课程文件夹扫描出来的 */
export type LessonSource = 'manual' | 'folder';

export interface User {
  id: number;
  username: string;
  role: Role;
  display_name: string;
  created_at: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Course {
  id: number;
  name: string;
  description: string;
  sort: number;
  created_at: number;
  category_id: number | null;
  cover: string;
  published: 0 | 1;
  category_name?: string;
  total?: number;
  finished?: number;
  quiz?: number;
  fav?: boolean;
  /** 课程绑定的媒体根目录 id（课程文件夹），未绑定为 null */
  folder_root_id?: string | null;
  /** 媒体根目录下的相对路径（空串表示根目录本身） */
  folder_path?: string | null;
  /** 上次扫描导入时间（秒），未扫描过为 null */
  last_scan_at?: number | null;
}

/** 媒体文件夹（服务器上的视频目录） */
export interface MediaRoot {
  id: string;
  name: string;
  path: string;
  available?: boolean;
  /** 使用该目录的课时数 */
  lessons?: number;
  /** 系统内置目录（站内上传），不可移除 */
  internal?: boolean;
}

export interface Category {
  id: number;
  name: string;
  sort: number;
}

export interface LessonProgress {
  position: number;
  duration: number;
  finished: 0 | 1;
  quiz_done: 0 | 1;
  quiz_best: number;
}

export interface Lesson {
  id: number;
  title: string;
  description: string;
  video_kind: VideoKind;
  media_root: string;
  video_path: string;
  sort: number;
  created_at: number;
  group_name: string;
  course_id: number | null;
  progress: LessonProgress | null;
  /** 视频总秒数（后端 ffprobe 抽取，未抽取为 null） */
  duration?: number | null;
  /** 封面图相对路径（后端 ffmpeg 抽帧） */
  cover_path?: string;
  /** 媒体类型（video/audio/other） */
  media_type?: string;
  /** 元数据抽取时间（为空表示还没抽过） */
  probed_at?: number | null;
  /** 课时来源：manual（手工/上传）/ folder（课程文件夹扫描导入） */
  source?: LessonSource;
}

/** 课程课时管理页的响应（含课程文件夹绑定情况） */
export interface CourseManageResponse {
  course: Course;
  lessons: Lesson[];
  folder: {
    rootId: string;
    rootName: string;
    path: string;
    available: boolean;
    lastScanAt: number | null;
  } | null;
}

/** 课程文件夹扫描结果（dryRun=true 时只统计不写库） */
export interface CourseScanResult {
  dryRun: boolean;
  courseId: number;
  folder: { rootId: string; rootName: string; path: string; available: boolean };
  /** 磁盘上扫描到的视频总数 */
  onDisk: number;
  /** 扫描到的子文件夹数 */
  folders: number;
  added: number;
  /** 原本挂在别的课程下、被收编到本课程的课时数 */
  assigned: number;
  /** 章节名随文件夹同步更新的课时数 */
  updated: number;
  skipped: number;
  /** 课时仍在、但磁盘上文件已消失的列表 */
  missing: { id: number; title: string; videoPath: string; source: LessonSource }[];
  /** removeMissing=true 时实际删除的课时数 */
  removed: number;
  /** 扫描后本课程的课时总数 */
  total: number;
  /** 本次新增的课时 id（用于后台抽取时长/封面） */
  newLessonIds: number[];
}

export interface Knowledge {
  id: number;
  lesson_id: number;
  title: string;
  kind: KnowledgeKind;
  file_name: string;
  file_path: string;
  content: string;
  url: string;
  sort: number;
  created_at: number;
}

export interface QuestionView {
  id: number;
  bank_id: number;
  lesson_id: number | null;
  type: QuestionType;
  stem: string;
  image_path: string;
  options: string[];
  sort: number;
  /** 难度：easy / medium / hard（空串 = 未标注） */
  difficulty?: string;
  /** 难度模型（迁移 0016）：0–100 综合分、五级星级（1 最易 … 5 最难）、来源 */
  difficulty_score?: number;
  difficulty_level?: number;
  difficulty_source?: string;
  difficulty_n?: number;
  difficulty_p?: number | null;
  /** 填空题空位数（>1 时学生按顺序用「；」分隔作答） */
  blanks?: number;
  /** 标准化元数据（迁移 0008） */
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  point?: string;
  source_path?: string;
  source_no?: string;
  answer?: string;
  analysis?: string;
}

export interface Bank {
  id: number;
  name: string;
  lesson_id: number | null;
  created_at: number;
  lesson_title: string;
  question_count: number;
  /** 题库类型：lesson 课时配套 / chapter 章节题库 / paper 整卷试卷 */
  kind?: 'lesson' | 'chapter' | 'paper';
  subject?: string;
  book?: string;
}

export interface GradedItem {
  qid: number;
  type: QuestionType;
  stem: string;
  options: string[];
  image_path: string;
  given: string;
  correct: boolean | null;
  answer: string;
  analysis: string;
}

export interface QuizSubmitResult {
  attemptId: number;
  score: number;
  total: number;
  manual: number;
  best: number;
  results: GradedItem[];
}

export interface WrongItem extends QuestionView {
  wrong_count: number;
  mastered: 0 | 1;
  last_at: number;
}

export interface Attempt {
  id: number;
  lesson_id: number;
  lesson_title: string;
  score: number;
  total: number;
  created_at: number;
}

export interface Exam {
  id: number;
  course_id: number;
  title: string;
  description: string;
  duration_minutes: number;
  pass_score: number;
  status: 'draft' | 'published';
  created_at: number;
  qcount?: number;
  question_count?: number;
  attempt_count?: number;
  my?: { score: number; total: number; passed: 0 | 1; used_seconds: number; created_at: number } | null;
}

export interface ExamSubmitResult {
  attemptId: number;
  score: number;
  total: number;
  passed: boolean;
  need: number;
  usedSeconds: number;
  manual: number;
  results: GradedItem[];
  created_at?: number;
}

export interface LessonStatRow {
  id: number;
  username: string;
  display_name: string;
  watched: boolean;
  finished: boolean;
  percent: number;
  quiz_done: boolean;
  best_score: number;
  attempts: number;
  updated_at: number | null;
}

export interface LessonStats {
  lesson: { id: number; title: string };
  summary: {
    students: number;
    watched: number;
    finished: number;
    not_started: number;
    quizzed: number;
    not_quizzed: number;
    avg: number;
    best: number;
  };
  rows: LessonStatRow[];
}

export interface CourseStats {
  course: { id: number; name: string };
  summary: { lessons: number; students: number; avg_finish_rate: number; avg_quiz_rate: number };
  lessons: {
    id: number;
    title: string;
    group_name: string;
    watched: number;
    finished: number;
    quizzed: number;
    finish_rate: number;
    quiz_rate: number;
    avg_score: number;
  }[];
}

export interface Summary {
  minutes: number;
  finishedLessons: number;
  quizzed: number;
  level: string;
  nextMinutes: number | null;
}

export interface LessonNote {
  id: number;
  user_id: number;
  lesson_id: number;
  pos: number;
  text: string;
  created_at: number;
}
