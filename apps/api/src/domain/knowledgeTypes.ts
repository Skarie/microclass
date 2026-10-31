/**
 * 知识点行的 API 侧类型。
 *
 * `@microclass/shared` 里的 `Knowledge` 是课时级时代的形状（lesson_id 必填），
 * 本版新增课程级（lesson_id 为空、course_id 非空）。为了不牵动前端共享包的改动，
 * 这里在 API 内部覆盖这两个字段；返回给前端的 JSON 只是多一个 `course_id`，属于纯增量。
 */
import type { Knowledge as SharedKnowledge } from '@microclass/shared';

export interface KnowledgeRow extends Omit<SharedKnowledge, 'lesson_id'> {
  /** 课时级知识点所属课时；课程级为 null */
  lesson_id: number | null;
  /** 课程级知识点所属课程；课时级为 null */
  course_id: number | null;
}

/** 知识点归属：二选一（课时级传 lessonId，课程级传 courseId） */
export interface KnowledgeScope {
  lessonId?: number;
  courseId?: number;
}
