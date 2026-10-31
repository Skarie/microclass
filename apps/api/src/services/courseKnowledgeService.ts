/** 课程级知识点：整门课共享，不挂课时。 */
import { AppError, type User } from '@microclass/shared';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { KnowledgeRepository } from '../db/repositories/knowledgeRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { KnowledgeRow } from '../domain/knowledgeTypes.js';
import { isHttpUrl } from './lessonInput.js';

export interface CourseKnowledgeInput {
  title: string;
  kind: 'text' | 'link' | 'file';
  content?: string;
  url?: string;
}

export class CourseKnowledgeService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** 课程级知识点（按 sort,id） */
  list(courseId: number): KnowledgeRow[] {
    if (!this.courses.findById(courseId)) throw AppError.notFound('课程不存在');
    return this.knowledge.listByCourse(courseId);
  }

  add(actor: User, courseId: number, input: CourseKnowledgeInput): number {
    if (!this.courses.findById(courseId)) throw AppError.notFound('课程不存在');
    if (input.kind === 'file') {
      throw AppError.badRequest('课程级知识点暂不支持上传附件，请改为文本或链接，或挂到具体课时下');
    }
    if (input.kind !== 'text' && input.kind !== 'link') throw AppError.badRequest('知识点类型只能是 text 或 link');
    const title = String(input.title ?? '').trim();
    if (!title) throw AppError.badRequest('标题不能为空');
    if (input.kind === 'link' && !isHttpUrl(input.url ?? '')) throw AppError.badRequest('链接必须以 http(s):// 开头');

    const id = this.knowledge.create({
      courseId,
      title,
      kind: input.kind,
      content: input.content ?? '',
      url: input.kind === 'link' ? (input.url ?? '') : '',
      sort: this.knowledge.maxSort({ courseId }) + 1,
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.create',
      targetType: 'knowledge',
      targetId: id,
      detail: { courseId, kind: input.kind, scope: 'course' },
    });
    return id;
  }
}
