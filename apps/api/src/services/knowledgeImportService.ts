/**
 * 知识点批量导入：编排 zip 读取、逐条规划与写库/审计。
 * 解析、匹配、图片重写在 `knowledgeImportPlanner`（dryRun 与正式导入共用同一套逻辑）。
 */
import { AppError, type User } from '@microclass/shared';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { KnowledgeRepository } from '../db/repositories/knowledgeRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { LessonCandidate } from '../domain/knowledgeImport.js';
import { ZipArchive } from '../utils/zipArchive.js';
import type { KnowledgeMediaStore } from './knowledgeMediaStore.js';
import type { KnowledgeImportUpload } from './knowledgeImportUpload.js';
import { KnowledgeImportPlanner } from './knowledgeImportPlanner.js';
import { MAX_MD_BYTES, type ImageLookup, type KnowledgeImportReport } from './knowledgeImportTypes.js';

export class KnowledgeImportService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly lessons: LessonRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly media: KnowledgeMediaStore,
    private readonly audit: AuditRepository,
  ) {}

  async importUpload(
    actor: User,
    courseId: number,
    upload: KnowledgeImportUpload,
    dryRun: boolean,
  ): Promise<KnowledgeImportReport> {
    if (!this.courses.findById(courseId)) throw AppError.notFound('课程不存在');
    const candidates: LessonCandidate[] = this.lessons
      .listByCourse(courseId)
      .map((lesson) => ({ id: lesson.id, title: lesson.title, group_name: lesson.group_name }));

    const planner = new KnowledgeImportPlanner(candidates, this.knowledge, this.media, dryRun);
    const archives: ZipArchive[] = [];
    try {
      for (const zipPath of upload.zips) {
        const archive = await ZipArchive.open(zipPath);
        archives.push(archive);
        const lookup: ImageLookup = {
          has: (zipEntry) => archive.has(zipEntry),
          read: (zipEntry, maxBytes) => archive.readBinary(zipEntry, maxBytes),
        };
        for (const mdPath of archive.markdownPaths()) {
          const content = await archive.readMarkdownFile(mdPath, MAX_MD_BYTES);
          if (content !== null) await planner.plan({ path: mdPath, content, lookup });
        }
      }
      for (const md of upload.markdowns) {
        await planner.plan({ path: md.name, content: md.content, lookup: null });
      }
    } finally {
      for (const archive of archives) archive.close();
    }

    const report = planner.report();
    if (dryRun) return report;

    const inputs = planner.inputs();
    this.knowledge.createMany(inputs);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.import',
      targetType: 'course',
      targetId: courseId,
      detail: {
        imported: inputs.length,
        skipped: report.skipped,
        unmatched: report.unmatched,
        missingImages: report.missingImages,
      },
    });
    return { ...report, imported: inputs.length };
  }
}
