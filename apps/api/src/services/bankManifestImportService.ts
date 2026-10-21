/**
 * 资料提炼结果（manifest）批量导入：外部脚本把每道题连同配图一起提交，
 * 这里把 `[[img:N]]` 占位符换成内容寻址的题图 URL，再逐题独立落库。
 */
import { AppError, type QuestionType, type User } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import type { BankQuestionService } from './bankQuestionService.js';
import type { BankQuestionImageService } from './bankQuestionImageService.js';

type ImportFile = { fileName: string; data: Buffer; mimeType: string };

export class BankManifestImportService {
  constructor(
    private readonly banks: BankRepository,
    private readonly audit: AuditRepository,
    private readonly media: QuestionMediaStore,
    private readonly questions: BankQuestionService,
    private readonly questionImages: BankQuestionImageService,
  ) {}

  /**
   * 批量导入题目（资料提炼结果）。逐题独立：某一题失败只记下原因，不影响其它题。
   * 带图的题走 `createImageQuestion`（题面是图，题干可为空）；纯文字题走 `createQuestion`。
   */
  importQuestions(
    actor: User,
    bankId: number,
    rawQuestions: unknown[],
    files: Map<string, ImportFile>,
    /**
     * 内联题图：key 为数字（对应 manifest 里的 `[[img:0]]`），value 为图片字节。
     * 服务端把它们存进题图仓库（内容寻址去重），再把占位符换成 markdown 图片。
     */
    mediaFiles: Map<number, ImportFile> = new Map(),
  ): { inserted: number; failed: { index: number; reason: string }[]; missingAnswer: number } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    let inserted = 0;
    const failed: { index: number; reason: string }[] = [];

    /**
     * 把 `[[img:N]]` 占位符换成题图 URL。一次性把整份资料的图放在同一个请求里带上，
     * 避免"一张图一个请求"把限流打满（真机 429 的根因）。
     */
    const mediaUrlCache = new Map<number, string>();
    const replaceMediaPlaceholders = (text: string): string =>
      text.replace(/\[\[img:(\d+)\]\]/g, (_m, n: string) => {
        const idx = Number(n);
        if (mediaUrlCache.has(idx)) return mediaUrlCache.get(idx) ?? '';
        const f = mediaFiles.get(idx);
        if (!f) {
          mediaUrlCache.set(idx, '');
          return '';
        }
        const saved = this.media.save(f.data);
        const url = saved ? `![](${saved.url})` : '';
        mediaUrlCache.set(idx, url);
        return url;
      });

    /** 只认基本类型：manifest 是外部数据，字段可能是对象/数组，直接 String() 会得到 '[object Object]' */
    const asText = (v: unknown): string =>
      typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

    rawQuestions.forEach((raw, index) => {
      const q = (raw ?? {}) as Record<string, unknown>;
      const type = (asText(q.type) || 'short') as QuestionType;
      const stem = replaceMediaPlaceholders(asText(q.stem)).trim();
      const options = Array.isArray(q.options)
        ? q.options.map((o) => replaceMediaPlaceholders(asText(o))).filter((s) => s !== '')
        : [];
      const answer = replaceMediaPlaceholders(asText(q.answer));
      const analysis = replaceMediaPlaceholders(asText(q.analysis));
      const meta = {
        ...(asText(q.chapter) ? { chapter: asText(q.chapter) } : {}),
        ...(asText(q.point) ? { point: asText(q.point) } : {}),
        ...(asText(q.difficulty) ? { difficulty: asText(q.difficulty) } : {}),
        ...(asText(q.subject) ? { subject: asText(q.subject) } : {}),
        ...(asText(q.book) ? { book: asText(q.book) } : {}),
      };
      const imageField = asText(q.image);
      const file = imageField === '' ? undefined : files.get(imageField);
      try {
        if (file) {
          this.questionImages.createImageQuestion(actor, {
            bankId,
            type,
            ...(stem ? { stem } : {}),
            answer,
            analysis,
            ...meta,
            file,
          });
        } else {
          this.questions.createQuestion(actor, {
            bankId,
            type,
            stem,
            ...(options.length > 0 ? { options } : {}),
            answer,
            analysis,
            // 批量导入允许缺答案（由调用方在 finally 里统计 missingAnswer）
            allowMissingAnswer: true,
            ...meta,
          });
        }
        inserted += 1;
      } catch (e) {
        failed.push({ index, reason: e instanceof Error ? e.message : '未知错误' });
      }
    });

    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.import_batch',
      targetType: 'bank',
      targetId: bankId,
      detail: { inserted, failed: failed.length },
    });
    /**
     * 缺答案的题数：答案册没覆盖/被水印遮挡时，题目**照样入库**（不整题丢弃），
     * 这里如实报出来，便于导入脚本与老师后续补答案。
     */
    const missingAnswer = rawQuestions.filter((q) => {
      const a = (q as { answer?: unknown })?.answer;
      return typeof a !== 'string' || a.trim() === '';
    }).length;
    return { inserted, failed, missingAnswer };
  }
}
