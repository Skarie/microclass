/** 知识点讲义导出：课程/课时范围 → 讲义大纲 → Markdown / Word。 */
import { AppError } from '@microclass/shared';
import type { Lesson } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { KnowledgeRepository } from '../db/repositories/knowledgeRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { KnowledgeRow } from '../domain/knowledgeTypes.js';
import { buildDocx, type DocxBlock } from '../utils/docx.js';
import type { KnowledgeOutline } from './lessonTypes.js';

export class LessonKnowledgeExportService {
  constructor(
    private readonly lessons: LessonRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly courses: CourseRepository,
  ) {}

  /**
   * 导出知识点讲义：`{ courseId }` 导整门课程（课程级共享 + 按章节 → 课时组织），
   * `{ lessonId }` 只导一个课时。文本类知识点导出正文；链接类导出可点链接；
   * 附件类导出文件名（文件本身在课时页下载）。
   */
  knowledgeOutline(scope: { courseId?: number; lessonId?: number }): KnowledgeOutline {
    let lessons: Lesson[] = [];
    let title = '';
    let courseItems: KnowledgeRow[] = [];
    if (scope.lessonId !== undefined) {
      const lesson = this.lessons.findById(scope.lessonId);
      if (!lesson) throw AppError.notFound('课时不存在');
      lessons = [lesson];
      title = lesson.title;
    } else if (scope.courseId !== undefined) {
      const course = this.courses.findById(scope.courseId);
      if (!course) throw AppError.notFound('课程不存在');
      lessons = this.lessons.listByCourse(scope.courseId);
      courseItems = this.knowledge.listByCourse(scope.courseId);
      title = course.name;
    } else {
      throw AppError.badRequest('必须指定课程或课时');
    }

    const chapters: KnowledgeOutline['chapters'] = [];
    let totalItems = courseItems.length;
    for (const lesson of lessons) {
      const items = this.knowledge.listByLesson(lesson.id);
      totalItems += items.length;
      const chapterName = lesson.group_name || '未分章';
      let chapter = chapters.find((c) => c.chapter === chapterName);
      if (!chapter) {
        chapter = { chapter: chapterName, lessons: [] };
        chapters.push(chapter);
      }
      chapter.lessons.push({ lesson, items });
    }

    const lessonCount = lessons.length;
    return {
      title,
      subtitle: `微课堂导出 · ${lessonCount} 个课时 · ${totalItems} 条知识点`,
      courseItems,
      chapters,
      totalItems,
    };
  }

  /** 知识点讲义 → Markdown（课程级共享置顶；课程内再按章节分层；单课时直接列知识点） */
  knowledgeToMarkdown(scope: { courseId?: number; lessonId?: number }): { filename: string; body: string } {
    const outline = this.knowledgeOutline(scope);
    const withChapters = scope.courseId !== undefined;
    const out: string[] = [`# ${outline.title} · 知识点讲义`, '', `> ${outline.subtitle}`, ''];

    if (outline.courseItems.length > 0) {
      out.push('## 课程共享知识点', '');
      for (const item of outline.courseItems) {
        out.push(`**${item.title}**`, '');
        pushKnowledgeMarkdown(out, item);
      }
      out.push('---', '');
    }

    for (const chapter of outline.chapters) {
      if (withChapters) out.push(`## ${chapter.chapter}`, '');
      for (const { lesson, items } of chapter.lessons) {
        if (withChapters) out.push(`### ${lesson.title}`, '');
        if (items.length === 0) {
          out.push('_（本课时暂无知识点）_', '');
          continue;
        }
        for (const item of items) {
          out.push(withChapters ? `**${item.title}**` : `## ${item.title}`, '');
          pushKnowledgeMarkdown(out, item);
        }
        out.push('---', '');
      }
    }
    return { filename: `${outline.title}_知识点.md`, body: out.join('\n') };
  }

  /** 知识点讲义 → Word（.docx，课程共享 + 章节/课时分层标题） */
  knowledgeToDocx(scope: { courseId?: number; lessonId?: number }): { filename: string; body: Buffer } {
    const outline = this.knowledgeOutline(scope);
    const withChapters = scope.courseId !== undefined;
    const blocks: DocxBlock[] = [
      { type: 'title', text: `${outline.title} · 知识点讲义` },
      { type: 'subtitle', text: outline.subtitle },
    ];

    if (outline.courseItems.length > 0) {
      blocks.push({ type: 'heading', text: '课程共享知识点' });
      for (const item of outline.courseItems) {
        blocks.push({ type: 'strong', text: item.title });
        pushKnowledgeBlock(blocks, item);
      }
    }

    for (const chapter of outline.chapters) {
      if (withChapters) blocks.push({ type: 'heading', text: chapter.chapter });
      for (const { lesson, items } of chapter.lessons) {
        if (withChapters) blocks.push({ type: 'heading2', text: lesson.title });
        if (items.length === 0) {
          blocks.push({ type: 'analysis', text: '（本课时暂无知识点）' });
          continue;
        }
        for (const item of items) {
          blocks.push({ type: withChapters ? 'strong' : 'heading2', text: item.title });
          pushKnowledgeBlock(blocks, item);
        }
      }
    }
    if (outline.totalItems === 0) {
      blocks.push({ type: 'analysis', text: '这门课程还没有任何知识点。' });
    }
    return {
      filename: `${outline.title}_知识点.docx`,
      body: buildDocx({ title: `${outline.title} 知识点讲义`, blocks, images: [] }),
    };
  }
}

/** 文本 / 链接 / 附件三种知识点在 Markdown 里的一行/一段写法 */
function pushKnowledgeMarkdown(out: string[], item: KnowledgeRow): void {
  if (item.kind === 'link') out.push(`- 链接：<${item.url}>`);
  else if (item.kind === 'file') out.push(`- 附件：${item.file_name || item.title}（在微课堂课时页下载）`);
  else if (item.content.trim()) out.push(item.content.trim());
  out.push('');
}

/** 链接/附件/正文分别落到不同的 docx 块类型（与 Markdown 导出口径一致） */
function pushKnowledgeBlock(blocks: DocxBlock[], item: KnowledgeRow): void {
  if (item.kind === 'link') blocks.push({ type: 'text', text: `链接：${item.url}` });
  else if (item.kind === 'file') {
    blocks.push({ type: 'text', text: `附件：${item.file_name || item.title}（在微课堂课时页下载）` });
  } else if (item.content.trim()) {
    blocks.push({ type: 'text', text: item.content.trim() });
  }
}
