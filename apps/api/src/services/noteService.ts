/**
 * 课时笔记服务：观看页右侧笔记面板的读取、新增、删除。
 * 笔记只能由本人访问（仓储层按 user_id 过滤）。
 */
import { AppError, type LessonNote, type User } from '@microclass/shared';
import type { NoteRepository } from '../db/repositories/noteRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';

export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly lessons: LessonRepository,
  ) {}

  list(viewer: User, lessonId: number): { notes: LessonNote[]; count: number } {
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.notFound('课时不存在');
    const notes = this.notes.listByLesson(viewer.id, lessonId);
    return { notes, count: notes.length };
  }

  create(viewer: User, lessonId: number, input: { pos?: number; text: string }): number {
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.notFound('课时不存在');
    const text = String(input.text ?? '').trim();
    if (!text) throw AppError.badRequest('笔记内容不能为空');
    if (text.length > 2000) throw AppError.badRequest('笔记内容过长（上限 2000 字）');
    const rawPos = Number(input.pos ?? 0);
    const pos = Number.isFinite(rawPos) && rawPos >= 0 ? rawPos : 0;
    return this.notes.create({ userId: viewer.id, lessonId, pos, text });
  }

  remove(viewer: User, id: number): void {
    const note = this.notes.findById(id, viewer.id);
    if (!note) throw AppError.notFound('笔记不存在');
    this.notes.delete(id, viewer.id);
  }
}
