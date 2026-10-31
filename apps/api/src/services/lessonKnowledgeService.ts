/** 课时知识点：文本 / 链接 / 附件知识点的增删改与附件上传，含审计。 */
import path from 'node:path';
import { AppError, type User } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { KnowledgeRepository } from '../db/repositories/knowledgeRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { StorageService } from './storageService.js';
import type { KnowledgeInput, UploadKnowledgeFileInput } from './lessonTypes.js';
import { isHttpUrl } from './lessonInput.js';

export class LessonKnowledgeService {
  constructor(
    private readonly lessons: LessonRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly audit: AuditRepository,
    private readonly storage: StorageService,
  ) {}

  addKnowledge(actor: User, input: KnowledgeInput): number {
    const lesson = this.lessons.findById(input.lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    const title = (input.title ?? '').trim();
    if (!title) throw AppError.badRequest('标题不能为空');
    if (input.kind === 'link' && !isHttpUrl(input.url ?? '')) throw AppError.badRequest('链接必须以 http(s):// 开头');
    const id = this.knowledge.create({ ...input, title });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.create',
      targetType: 'knowledge',
      targetId: id,
      detail: { lessonId: input.lessonId, kind: input.kind },
    });
    return id;
  }

  removeKnowledge(actor: User, id: number): { filePath: string } {
    const row = this.knowledge.findById(id);
    if (!row) throw AppError.notFound('知识点不存在');
    this.knowledge.delete(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.delete',
      targetType: 'knowledge',
      targetId: id,
    });
    return { filePath: row.file_path };
  }

  /** 更新知识点：链接类型改 URL，其余类型改正文 */
  updateKnowledge(actor: User, id: number, input: { title?: string; content?: string; url?: string }): void {
    const row = this.knowledge.findById(id);
    if (!row) throw AppError.notFound('知识点不存在');
    const title = String(input.title ?? row.title).trim() || row.title;
    if (row.kind === 'link') {
      const url = String(input.url ?? row.url);
      if (!isHttpUrl(url)) throw AppError.badRequest('链接必须以 http(s):// 开头');
      this.knowledge.update(id, { title, url });
    } else {
      this.knowledge.update(id, { title, content: String(input.content ?? row.content) });
    }
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.update',
      targetType: 'knowledge',
      targetId: id,
    });
  }

  /** 上传知识点附件（课件/讲义等），落盘到 uploads/knowledge 并绑定课时 */
  uploadKnowledgeFile(actor: User, input: UploadKnowledgeFileInput): { id: number; fileName: string } {
    const lesson = this.lessons.findById(input.lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    if (!input.data || input.data.length === 0) throw AppError.badRequest('文件为空');
    const fileName = path.basename(String(input.fileName || 'file'));
    const saved = this.storage.save({
      subdir: 'knowledge',
      fileName,
      data: input.data,
    });
    const title = String(input.title ?? '').trim() || fileName || '知识点文件';
    const id = this.knowledge.create({
      lessonId: input.lessonId,
      title,
      kind: 'file',
      fileName,
      filePath: saved.relPath,
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.upload',
      targetType: 'knowledge',
      targetId: id,
      detail: { lessonId: input.lessonId, fileName, size: saved.size },
    });
    return { id, fileName };
  }
}
