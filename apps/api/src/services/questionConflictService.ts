/**
 * 冲突题核对服务：把「同题不同答案」的组列出、逐组选定答案、批量按多数答案处理。
 *
 * 业务口径：
 * - **不自动删题**：冲突说明有数据质量问题，最终由老师决定信哪个答案；
 * - **选定后整组统一**：把该组所有题目的答案改成选定值（指纹相同 → 题干+选项相同，答案应当一致）；
 * - **可忽略**：确认「答案不同是合理的」（例如同一题干下有多种问法）时标记 ignored，
 *   不再出现在待核对列表，但题目保持原样。
 */
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type {
  QuestionConflictRepository,
  ConflictStatus,
  ConflictRow,
} from '../db/repositories/questionConflictRepository.js';
import { answersEquivalent, mergeAnswerText } from '../domain/answerNormalize.js';
import { AppError, type User } from '@microclass/shared';

export interface ConflictGroupDto {
  contentHash: string;
  stem: string;
  status: ConflictStatus;
  groupSize: number;
  answerCount: number;
  answers: { answer: string; n: number; first_id: number }[];
  chosenAnswer: string;
  reviewerName: string;
  updatedAt: number;
}

export class QuestionConflictService {
  constructor(
    private readonly conflicts: QuestionConflictRepository,
    private readonly questions: QuestionRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * 台账状态：**只看状态，不扫库**。
   *
   * 为什么不在列表页隐式重扫：node:sqlite 是同步 API，一次全库分组会把整个事件循环占住，
   * 而真机冷缓存时（容器刚重启 / 系统刚重启）实测要几分钟 —— 那会让整个站点跟着卡死。
   * 因此扫描只由用户点「重新扫描全库」（`POST /question-conflicts/sync`）或运维脚本触发；
   * 列表页只报告「台账是否过期、为什么过期」，由界面提示用户去点那个按钮。
   */
  freshness(): {
    stale: boolean;
    reason: string;
    ageMs: number;
    pending: number;
    total: number;
    counts: { pending: number; resolved: number; ignored: number; total: number };
  } {
    const staleness = this.conflicts.staleness();
    const counts = this.conflicts.counts();
    return {
      stale: staleness.stale,
      reason: staleness.reason,
      ageMs: staleness.ageMs,
      pending: counts.pending,
      total: counts.total,
      counts,
    };
  }

  /** 显式扫描（用户点按钮 / 运维脚本）；返回分段耗时便于排查慢在哪一步 */
  rescan(): {
    reason: 'forced';
    scannedGroups: number;
    inserted: number;
    removed: number;
    pending: number;
    total: number;
    ms: { scan: number; cleanup: number; write: number; meta: number; total: number };
  } {
    const res = this.conflicts.sync();
    return {
      reason: 'forced',
      scannedGroups: res.scanned,
      inserted: res.inserted,
      removed: res.removed,
      pending: res.pending,
      total: res.scanned,
      ms: res.ms,
    };
  }

  list(options: { status?: ConflictStatus | 'all'; page?: number; pageSize?: number }): {
    counts: { pending: number; resolved: number; ignored: number; total: number };
    sync: { scanned: false; reason: string; stale: boolean; ageMs: number };
    page: number;
    pageSize: number;
    total: number;
    items: ConflictGroupDto[];
  } {
    const fresh = this.freshness();
    const page = this.conflicts.list(options);
    const answers = this.conflicts.answersFor(page.items.map((i) => i.content_hash));
    return {
      counts: fresh.counts,
      sync: { scanned: false, reason: fresh.reason, stale: fresh.stale, ageMs: fresh.ageMs },
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      items: page.items.map((row) => ({
        contentHash: row.content_hash,
        stem: row.sample_stem,
        status: row.status,
        groupSize: row.group_size,
        answerCount: row.answer_count,
        answers: answers.get(row.content_hash) ?? [],
        chosenAnswer: row.chosen_answer,
        reviewerName: row.reviewer_name,
        updatedAt: row.updated_at,
      })),
    };
  }

  /** 某一组的全部题目（含题库名与来源，便于判断该信哪个答案） */
  detail(hash: string): {
    group: ConflictGroupDto;
    questions: ReturnType<QuestionConflictRepository['questions']>;
  } {
    const row = this.conflicts.find(hash);
    if (!row) throw AppError.notFound('这一组冲突题不存在（可能已被合并或修改）');
    return {
      group: {
        contentHash: row.content_hash,
        stem: row.sample_stem,
        status: row.status,
        groupSize: row.group_size,
        answerCount: row.answer_count,
        answers: this.conflicts.answers(hash),
        chosenAnswer: row.chosen_answer,
        reviewerName: row.reviewer_name,
        updatedAt: row.updated_at,
      },
      questions: this.conflicts.questions(hash),
    };
  }

  /** 选定答案：整组统一成这个答案 */
  resolve(
    actor: User,
    hash: string,
    answer: string,
    options?: { sync?: boolean },
  ): { updated: number; answer: string } {
    const group = this.detail(hash);
    const chosen = String(answer ?? '').trim();
    if (!chosen) throw AppError.badRequest('请选择或填写正确答案');
    const ids = group.questions.map((q) => q.id);
    let updated = 0;
    for (const id of ids) {
      const q = this.questions.findById(id);
      if (!q) continue;
      this.questions.update(id, {
        bankId: q.bank_id,
        lessonId: q.lesson_id,
        type: q.type,
        stem: q.stem,
        imagePath: q.image_path,
        options: JSON.parse(q.options) as string[],
        answer: chosen,
        analysis: q.analysis,
        sort: q.sort,
        difficulty: q.difficulty,
        subject: q.subject,
        stage: q.stage,
        book: q.book,
        chapter: q.chapter,
        point: q.point,
        sourcePath: q.source_path,
        sourceNo: q.source_no,
        contentHash: q.content_hash,
        hasImage: q.has_image === 1,
      });
      updated += 1;
    }
    // 答案统一后这组不再是冲突，台账同步删除；批量处理时由调用方在末尾统一同步一次
    // （sync 是全表分组，逐组调用会把批量操作拖成 N 次全表扫描）
    if (options?.sync !== false) this.conflicts.sync();
    this.conflicts.upsertStatus(
      hash,
      'resolved',
      chosen,
      { id: actor.id, name: actor.username },
      {
        groupSize: group.questions.length,
        answerCount: 1, // 统一之后只剩一个答案
        sampleStem: group.group.stem,
      },
    );
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question_conflict.resolve',
      targetType: 'question',
      detail: { hash, answer: chosen, updated },
    });
    return { updated, answer: chosen };
  }

  /** 忽略：确认这一组的多种答案是合理的，不再提示 */
  ignore(actor: User, hash: string): { ok: true } {
    const group = this.detail(hash);
    this.conflicts.upsertStatus(hash, 'ignored', group.group.chosenAnswer, { id: actor.id, name: actor.username });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question_conflict.ignore',
      targetType: 'question',
      detail: { hash },
    });
    return { ok: true };
  }

  /** 恢复为待核对 */
  reopen(actor: User, hash: string): { ok: true } {
    this.detail(hash);
    this.conflicts.upsertStatus(hash, 'pending', '', { id: actor.id, name: actor.username });
    return { ok: true };
  }

  /**
   * 批量按「多数答案」处理待核对组：该组出现次数最多的答案即选定值（并列时不动，留人工判断）。
   * `dryRun` 只统计不写库。
   */
  resolveMajority(
    actor: User,
    options?: { dryRun?: boolean; limit?: number },
  ): {
    groups: number;
    questions: number;
    skipped: number;
    dryRun: boolean;
    samples: { stem: string; answer: string; n: number }[];
  } {
    // 台账可能过期（导入了新题库），但这里不重扫：以台账现状为准，界面会提示去重扫。
    const limit = Math.max(1, Math.min(5000, options?.limit ?? 1000));
    const pending = this.collectPendingGroups(limit);
    let groups = 0;
    let questions = 0;
    let skipped = 0;
    const samples: { stem: string; answer: string; n: number }[] = [];
    const dryRun = options?.dryRun !== false;
    for (const { row, answers } of pending) {
      if (answers.length < 2) continue;
      const top = answers[0];
      const tied = answers.filter((a) => a.n === top?.n).length > 1;
      if (!top || tied) {
        skipped += 1; // 票数并列：不猜，留人工核对
        continue;
      }
      groups += 1;
      questions += row.group_size;
      if (samples.length < 10) samples.push({ stem: row.sample_stem.slice(0, 80), answer: top.answer, n: top.n });
      if (!dryRun) this.resolve(actor, row.content_hash, top.answer, { sync: false });
    }
    if (!dryRun) this.conflicts.sync();
    return { groups, questions, skipped, dryRun, samples };
  }

  /**
   * 翻页取全部待核对组（**不能用单页**）。
   *
   * `conflicts.list()` 的单页上限是 100，之前批量操作用 `pageSize: limit` 只拿到前 100 组，
   * 第 101 组以后被**静默跳过**（真机 207 组时只处理了 50 组可合并的，其余没动）。
   * 这里先把待处理组连同答案分布一次性快照下来，再统一判断/落库，
   * 避免边写边翻页导致漏组（写操作会把组的状态改掉，翻页会漂移）。
   */
  private collectPendingGroups(limit: number): { row: ConflictRow; answers: { answer: string; n: number }[] }[] {
    const pageSize = 100;
    const out: { row: ConflictRow; answers: { answer: string; n: number }[] }[] = [];
    for (let page = 1; out.length < limit; page += 1) {
      const res = this.conflicts.list({ status: 'pending', page, pageSize });
      if (res.items.length === 0) break;
      const answers = this.conflicts.answersFor(res.items.map((i) => i.content_hash));
      for (const row of res.items) {
        out.push({
          row,
          answers: (answers.get(row.content_hash) ?? []).map((a) => ({ answer: a.answer, n: a.n })),
        });
        if (out.length >= limit) break;
      }
      if (res.items.length < pageSize) break;
    }
    return out;
  }

  /**
   * 批量合并「同一个答案的不同写法」（默认只预演，`dryRun=0` 才落库）。
   *
   * 为什么需要：待核对组里**大多数不是答案写错**，而是同一答案的不同写法
   * （`\left(2,0\right)` / `(2,0)`、`\frac{2}{5}(或)0.4` / `\frac{2}{5}`、`7|七` / `7`、
   * `x\le7|7\ge x` / `x\le7`）。对这类组「投票选一个」是错的做法 —— 会把另一种正确写法判错；
   * 正确做法是**合并成可接受写法**（`A|B`），学生写哪个都对。
   *
   * 只有组内写法两两等价时才自动处理；真的不同答案（`1260` vs `12600`、`圆心` vs `圆心上`）
   * 一律跳过留人工 —— 真机数据显示，多数票本身也可能是错的（1260 那组就是）。
   */
  resolveEquivalent(
    actor: User,
    options?: { dryRun?: boolean; limit?: number },
  ): {
    groups: number;
    questions: number;
    skipped: number;
    dryRun: boolean;
    samples: { stem: string; from: string[]; merged: string }[];
  } {
    const limit = Math.max(1, Math.min(5000, options?.limit ?? 1000));
    const pending = this.collectPendingGroups(limit);
    let groups = 0;
    let questions = 0;
    let skipped = 0;
    const samples: { stem: string; from: string[]; merged: string }[] = [];
    const dryRun = options?.dryRun !== false;
    for (const { row, answers } of pending) {
      if (answers.length < 2) continue;
      const variants = answers.map((a) => a.answer);
      const first = variants[0] ?? '';
      if (!variants.every((v) => answersEquivalent(first, v))) {
        skipped += 1;
        continue;
      }
      const merged = variants.reduce((acc, v) => mergeAnswerText(acc, v), first);
      groups += 1;
      questions += row.group_size;
      if (samples.length < 10) samples.push({ stem: row.sample_stem.slice(0, 80), from: variants, merged });
      // 批量场景不逐组 sync（每组一次全表分组太贵），末尾统一同步一次
      if (!dryRun) this.resolve(actor, row.content_hash, merged, { sync: false });
    }
    if (!dryRun) this.conflicts.sync();
    return { groups, questions, skipped, dryRun, samples };
  }
}
