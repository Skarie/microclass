/**
 * 批量导入的「规划」阶段：把每条 md 匹配到课时、处理重复、抽取并重写图片。
 *
 * 不直接写库（正式导入由 KnowledgeImportService 统一 insert），dryRun 只是不落图片，
 * 因此预览与正式导入走的是同一套匹配/统计逻辑，不会出现「预览能过、导入却不同」。
 */
import path from 'node:path';
import type { LessonCandidate, LessonMatch } from '../domain/knowledgeImport.js';
import {
  collectImageRefs,
  firstHeading,
  matchLesson,
  normalizeTitle,
  parseSourcePath,
  previewMediaUrl,
  rewriteImageLinks,
  stripSequencePrefix,
} from '../domain/knowledgeImport.js';
import type { KnowledgeRepository } from '../db/repositories/knowledgeRepository.js';
import { isKnowledgeImage, type KnowledgeMediaStore } from './knowledgeMediaStore.js';
import {
  MAX_IMAGE_BYTES,
  type KnowledgeImportItem,
  type KnowledgeImportReport,
  type KnowledgeImportUnmatchedItem,
  type MarkdownSource,
  type PlannedKnowledge,
  type UnmatchedReason,
} from './knowledgeImportTypes.js';

const MD_EXT = /\.(md|markdown)$/i;

export class KnowledgeImportPlanner {
  private readonly planned: (KnowledgeImportItem & { content: string; sort: number })[] = [];
  private readonly unmatchedItems: KnowledgeImportUnmatchedItem[] = [];
  private readonly createdKeys = new Set<string>();
  private readonly sortNext = new Map<number, number>();
  private lastReason: UnmatchedReason = 'no-lesson';
  private matched = 0;
  private skipped = 0;
  private missingImages = 0;

  constructor(
    private readonly candidates: LessonCandidate[],
    private readonly knowledge: KnowledgeRepository,
    private readonly media: KnowledgeMediaStore,
    private readonly dryRun: boolean,
  ) {}

  /** 处理一条 md（zip 条目或直接上传） */
  async plan(source: MarkdownSource): Promise<void> {
    const parsed = parseSourcePath(source.path);
    const rawTitle = path.posix.basename(source.path).replace(MD_EXT, '');
    const attempts: { matchTitle: string; reportTitle: string }[] = [
      { matchTitle: parsed.title, reportTitle: rawTitle },
    ];
    if (!parsed.hasChapter) {
      const heading = firstHeading(source.content);
      if (heading) attempts.push({ matchTitle: stripSequencePrefix(heading), reportTitle: heading });
    }

    const found = this.findMatch(attempts);
    if (!found) {
      this.unmatchedItems.push({ title: rawTitle, chapter: parsed.chapter, reason: this.lastReason });
      return;
    }
    this.matched += 1;

    const knowledgeTitle = normalizeTitle(found.match.lessonTitle);
    const key = `${found.match.lessonId}\u0000${knowledgeTitle}`;
    if (
      this.createdKeys.has(key) ||
      this.knowledge.existsTextTitle({ lessonId: found.match.lessonId }, knowledgeTitle)
    ) {
      this.skipped += 1;
      return;
    }
    this.createdKeys.add(key);

    const rewritten = await this.rewrite(source);
    this.missingImages += rewritten.missingImages;
    this.planned.push({
      lessonId: found.match.lessonId,
      lessonTitle: found.match.lessonTitle,
      chapter: parsed.chapter,
      title: found.reportTitle,
      chars: rewritten.content.length,
      images: rewritten.images,
      content: rewritten.content,
      sort: this.nextSort(found.match.lessonId),
    });
  }

  report(): KnowledgeImportReport {
    return {
      dryRun: this.dryRun,
      matched: this.matched,
      unmatched: this.unmatchedItems.length,
      skipped: this.skipped,
      missingImages: this.missingImages,
      items: this.planned.map((item) => ({
        lessonId: item.lessonId,
        lessonTitle: item.lessonTitle,
        chapter: item.chapter,
        title: item.title,
        chars: item.chars,
        images: item.images,
      })),
      unmatchedItems: this.unmatchedItems,
    };
  }

  /** 正式导入用：待写入的知识点行 */
  inputs(): PlannedKnowledge[] {
    return this.planned.map((item) => ({
      lessonId: item.lessonId,
      title: item.lessonTitle,
      kind: 'text',
      content: item.content,
      sort: item.sort,
    }));
  }

  private findMatch(
    attempts: { matchTitle: string; reportTitle: string }[],
  ): { match: Extract<LessonMatch, { kind: 'matched' }>; reportTitle: string } | null {
    for (const attempt of attempts) {
      if (!attempt.matchTitle) continue;
      const result = matchLesson(this.candidates, attempt.matchTitle);
      if (result.kind === 'matched') return { match: result, reportTitle: attempt.reportTitle };
      this.lastReason = result.reason;
    }
    return null;
  }

  private nextSort(lessonId: number): number {
    const cached = this.sortNext.get(lessonId);
    if (cached !== undefined) {
      this.sortNext.set(lessonId, cached + 1);
      return cached;
    }
    const start = this.knowledge.maxSort({ lessonId }) + 1;
    this.sortNext.set(lessonId, start + 1);
    return start;
  }

  /** 逐张读取图片并落盘（dryRun 用占位 URL），再重写 Markdown 中的相对图片路径 */
  private async rewrite(source: MarkdownSource): Promise<{ content: string; images: number; missingImages: number }> {
    const urlOf = new Map<string, string | null>();
    for (const ref of collectImageRefs(source.content, source.path)) {
      // 只抽取可展示的光栅图片；SVG / 脚本类按缺失处理（同源内联有 XSS 风险）
      if (!source.lookup || !isKnowledgeImage(ref.path) || !source.lookup.has(ref.path)) {
        urlOf.set(ref.path, null);
        continue;
      }
      if (this.dryRun) {
        urlOf.set(ref.path, previewMediaUrl(ref.path));
        continue;
      }
      try {
        const data = await source.lookup.read(ref.path, MAX_IMAGE_BYTES);
        if (data) urlOf.set(ref.path, this.media.save(data, path.posix.basename(ref.path)).url);
      } catch {
        /* 单张图片读取失败按缺失处理，不中断整包导入 */
      }
    }
    return rewriteImageLinks(source.content, source.path, (zipPath) => urlOf.get(zipPath) ?? null);
  }
}
