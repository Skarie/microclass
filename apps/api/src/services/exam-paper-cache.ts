/**
 * 卷面缓存：交卷 / 查成绩时不再每次重读整卷。
 *
 * 起因：压测里 1064 题的卷、60 人同时交卷要 7 秒 —— 慢的不是判分（纯内存计算），
 * 而是每次提交都 `listQuestions` 读 1064 行（含题干/选项/解析），60 次就是 6.4 万行。
 * 卷面在考试期间只读，缓存 60 秒足够；改卷/换题/删除时主动失效。
 *
 * 缓存实例由 `ExamService` 持有并注入作答/成绩服务，
 * 保证「交卷读到的卷面」与「成绩页重建用的卷面」是同一份。
 */
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { PaperRow } from './paperCommon.js';

export class ExamPaperCache {
  private static readonly PAPER_TTL_MS = 15_000;
  private readonly paperCache = new Map<number, { rows: PaperRow[]; at: number }>();

  constructor(private readonly exams: Pick<ExamRepository, 'listQuestions'>) {}

  paperOf(examId: number): PaperRow[] {
    const hit = this.paperCache.get(examId);
    const now = Date.now();
    if (hit && now - hit.at < ExamPaperCache.PAPER_TTL_MS) return hit.rows;
    const rows = this.exams.listQuestions(examId);
    if (this.paperCache.size > 300) this.paperCache.clear();
    this.paperCache.set(examId, { rows, at: now });
    return rows;
  }

  /** 卷面变更后失效（改卷、删除、换题时调用） */
  clearPaper(examId: number): void {
    this.paperCache.delete(examId);
  }
}
