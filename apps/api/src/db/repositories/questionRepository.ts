/**
 * 题目（questions）仓储。
 * options 以 JSON 字符串入库，answer 编码见 domain/question.ts。
 */
import type { Question, QuestionType } from '@microclass/shared';
import { hasMediaOnlyAnalysis, parseOptions, questionFingerprint } from '../../domain/question.js';
import type { Db } from '../client.js';

/** 同步 sleep：批量写脚本在 NAS 慢盘上要退避重试，这里不能用 await */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** SQLITE_BUSY / database is locked 判定 */
function isBusyError(e: unknown): boolean {
  const err = e as { errcode?: number; code?: string; message?: string };
  return err?.errcode === 5 || /locked|busy/i.test(String(err?.message ?? ''));
}

/**
 * 写事务重试：真机上（NAS 机械盘）一次批次提交可能超过 `busy_timeout`，
 * 与运行中的服务撞车就会抛 `database is locked`（导入器同样处理过这个问题）。
 */
function withBusyRetry<T>(fn: () => T, attempts = 6): T {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      if (!isBusyError(e)) throw e;
      sleepSync(Math.min(15000, 500 * 2 ** i));
    }
  }
  throw lastError;
}

export interface QuestionInput {
  bankId: number;
  lessonId?: number | null;
  type: QuestionType;
  stem: string;
  imagePath?: string;
  options: string[];
  answer: string;
  analysis?: string;
  sort?: number;
  /** 难度：easy / medium / hard（空串 = 未标注） */
  difficulty?: string;
  /** 标准化元数据（迁移 0008）：学科 / 学段 / 书册 / 章节 / 知识点 / 来源目录 / 原题号 / 内容指纹 */
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  point?: string;
  sourcePath?: string;
  sourceNo?: string;
  contentHash?: string;
  /** 题干/选项/解析里是否引用了题图（体检统计用，避免 LIKE 全表扫描） */
  hasImage?: boolean;
  /** 解析是否「只有图片、没有一个字」（迁移 0020 预计算列） */
  analysisMediaOnly?: boolean;
}

export interface QuestionFilter {
  type?: QuestionType;
  keyword?: string;
  difficulty?: string;
  /** 标准化元数据筛选（题库体检 / 组卷按知识点抽题用） */
  subject?: string;
  book?: string;
  chapter?: string;
  point?: string;
  stage?: string;
  /** 只看有配图 / 没有配图的题 */
  hasImage?: boolean;
  /** 只看「解析只有图片、没有一个字」的题（迁移 0020 预计算列） */
  mediaOnlyAnalysis?: boolean;
}

/** 题干里引用内容寻址题图（题库导入的题）→ 用于「缺图/带图」统计 */
const IMAGE_REF = 'question-media';

export class QuestionRepository {
  constructor(private readonly db: Db) {}

  private where(filter?: QuestionFilter): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.difficulty) {
      clauses.push('difficulty = ?');
      params.push(filter.difficulty);
    }
    if (filter?.keyword) {
      clauses.push('(stem LIKE ? OR analysis LIKE ?)');
      const like = `%${filter.keyword}%`;
      params.push(like, like);
    }
    if (filter?.subject) {
      clauses.push('subject = ?');
      params.push(filter.subject);
    }
    if (filter?.stage) {
      clauses.push('stage = ?');
      params.push(filter.stage);
    }
    if (filter?.book) {
      clauses.push('book = ?');
      params.push(filter.book);
    }
    if (filter?.chapter) {
      clauses.push('chapter = ?');
      params.push(filter.chapter);
    }
    if (filter?.point) {
      clauses.push('point = ?');
      params.push(filter.point);
    }
    if (filter?.hasImage === true) {
      clauses.push(`(stem LIKE '%${IMAGE_REF}%' OR options LIKE '%${IMAGE_REF}%' OR analysis LIKE '%${IMAGE_REF}%')`);
    }
    if (filter?.hasImage === false) {
      clauses.push(
        `(stem NOT LIKE '%${IMAGE_REF}%' AND options NOT LIKE '%${IMAGE_REF}%' AND analysis NOT LIKE '%${IMAGE_REF}%')`,
      );
    }
    if (filter?.mediaOnlyAnalysis === true) {
      // 走部分索引 idx_questions_analysis_media_only，不再做字符串剥离
      clauses.push('analysis_media_only = 1');
    }
    return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params };
  }

  listByBank(bankId: number, filter?: QuestionFilter, page?: { limit: number; offset: number }): Question[] {
    const { sql, params } = this.where(filter);
    const paging = page ? ' LIMIT ? OFFSET ?' : '';
    const pagingParams = page ? [page.limit, page.offset] : [];
    return this.db.all<Question>(`SELECT * FROM questions WHERE bank_id = ?${sql} ORDER BY sort, id${paging}`, [
      bankId,
      ...params,
      ...pagingParams,
    ]);
  }

  countByBank(bankId: number, filter?: QuestionFilter): number {
    const { sql, params } = this.where(filter);
    return (
      this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?${sql}`, [bankId, ...params])
        ?.c ?? 0
    );
  }

  findById(id: number): Question | undefined {
    return this.db.get<Question>('SELECT * FROM questions WHERE id = ?', [id]);
  }

  findByIds(ids: number[]): Question[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.all<Question>(`SELECT * FROM questions WHERE id IN (${placeholders})`, ids);
  }

  /** 课时可刷的题：题目直接挂课时，或题目所属题库挂课时 */
  listByLesson(lessonId: number): Question[] {
    return this.db.all<Question>(
      `SELECT q.* FROM questions q
       LEFT JOIN banks b ON b.id = q.bank_id
       WHERE q.lesson_id = ? OR b.lesson_id = ?
       ORDER BY q.sort, q.id`,
      [lessonId, lessonId],
    );
  }

  create(input: QuestionInput): number {
    const created = this.db.run(
      `INSERT INTO questions
         (bank_id, lesson_id, type, stem, image_path, options, answer, analysis, sort, difficulty,
          subject, stage, book, chapter, point, source_path, source_no, content_hash, has_image,
          analysis_media_only)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.bankId,
        input.lessonId ?? null,
        input.type,
        input.stem,
        input.imagePath ?? '',
        JSON.stringify(input.options),
        input.answer,
        input.analysis ?? '',
        input.sort ?? 0,
        input.difficulty ?? '',
        input.subject ?? '',
        input.stage ?? '',
        input.book ?? '',
        input.chapter ?? '',
        input.point ?? '',
        input.sourcePath ?? '',
        input.sourceNo ?? '',
        input.contentHash ?? '',
        input.hasImage ? 1 : 0,
        input.analysisMediaOnly ? 1 : 0,
      ],
    ).lastInsertRowid;
    this.bumpBankCount(input.bankId, 1);
    return created;
  }

  /**
   * 维护题库题量（迁移 0019 的预计算列）。
   *
   * 为什么必须维护：题库列表/目录树要显示「每个题库多少题」，
   * 现场统计（相关子查询或全表分组）在真机冷缓存下要 **100 秒**，
   * 期间同步执行的 SQLite 会把整个站点卡住。写路径顺手加减是零成本的。
   */
  private bumpBankCount(bankId: number | null | undefined, delta: number): void {
    if (typeof bankId !== 'number' || !Number.isInteger(bankId) || delta === 0) return;
    this.db.run('UPDATE banks SET question_count = MAX(0, question_count + ?) WHERE id = ?', [delta, bankId]);
  }

  update(id: number, input: QuestionInput): void {
    const before = this.db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
    // `analysisMediaOnly` 用 `undefined` 表示「不动这一列」：不是所有调用方都关心这个预计算列
    // （例如「同题不同答案」核对只改答案），无条件写会把标记清成 0。
    const setMediaOnly = input.analysisMediaOnly !== undefined;
    this.db.run(
      `UPDATE questions SET
         bank_id = ?, lesson_id = ?, type = ?, stem = ?, image_path = ?, options = ?, answer = ?, analysis = ?,
         sort = ?, difficulty = ?, subject = ?, stage = ?, book = ?, chapter = ?, point = ?,
         source_path = ?, source_no = ?, content_hash = ?, has_image = ?${setMediaOnly ? ', analysis_media_only = ?' : ''}
       WHERE id = ?`,
      [
        input.bankId,
        input.lessonId ?? null,
        input.type,
        input.stem,
        input.imagePath ?? '',
        JSON.stringify(input.options),
        input.answer,
        input.analysis ?? '',
        input.sort ?? 0,
        input.difficulty ?? '',
        input.subject ?? '',
        input.stage ?? '',
        input.book ?? '',
        input.chapter ?? '',
        input.point ?? '',
        input.sourcePath ?? '',
        input.sourceNo ?? '',
        input.contentHash ?? '',
        input.hasImage ? 1 : 0,
        ...(setMediaOnly ? [input.analysisMediaOnly ? 1 : 0] : []),
        id,
      ],
    );
    if (before && before.bank_id !== input.bankId) {
      this.bumpBankCount(before.bank_id, -1);
      this.bumpBankCount(input.bankId, 1);
    }
  }

  /** 只更新标准化元数据（回填历史数据用，不动题面与答案） */
  setMetadata(
    id: number,
    meta: Pick<QuestionInput, 'subject' | 'stage' | 'book' | 'chapter' | 'point' | 'sourcePath' | 'contentHash'>,
  ): void {
    this.db.run(
      'UPDATE questions SET subject = ?, stage = ?, book = ?, chapter = ?, point = ?, source_path = ?, content_hash = ? WHERE id = ?',
      [
        meta.subject ?? '',
        meta.stage ?? '',
        meta.book ?? '',
        meta.chapter ?? '',
        meta.point ?? '',
        meta.sourcePath ?? '',
        meta.contentHash ?? '',
        id,
      ],
    );
  }

  /* ---------------- 难度模型（迁移 0016） ---------------- */

  /**
   * 取一批题的难度判定特征（分页）。
   * 只选判定需要的列，避免把 analysis 这类大字段读进来放大 I/O。
   */
  difficultyFeatures(
    options: { bankId?: number; afterId?: number; limit?: number; onlyAuto?: boolean; onlyUnscored?: boolean } = {},
  ): {
    id: number;
    bank_id: number;
    type: QuestionType;
    stem: string;
    options: string;
    answer: string;
    has_image: number;
    subject: string;
    stage: string;
    book: string;
    chapter: string;
    point: string;
    difficulty: string;
    difficulty_source: string;
    bank_kind: string;
    bank_name: string;
  }[] {
    const clauses: string[] = ['q.id > ?'];
    const params: unknown[] = [options.afterId ?? 0];
    if (options.bankId !== undefined) {
      clauses.push('q.bank_id = ?');
      params.push(options.bankId);
    }
    // 只重算「模型算出来的」：人工标注(manual)与已校准(calibrated)默认不动
    if (options.onlyAuto) clauses.push("(q.difficulty_source IS NULL OR q.difficulty_source IN ('', 'auto'))");
    if (options.onlyUnscored) clauses.push('(q.difficulty_score IS NULL OR q.difficulty_score < 0)');
    return this.db.all(
      `SELECT q.id, q.bank_id, q.type, q.stem, q.options, q.answer, q.has_image,
              q.subject, q.stage, q.book, q.chapter, q.point, q.difficulty, q.difficulty_source,
              COALESCE(b.kind, '') AS bank_kind, COALESCE(b.name, '') AS bank_name
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY q.id LIMIT ?`,
      [...params, Math.min(5000, Math.max(1, options.limit ?? 2000))],
    );
  }

  /** 取几道题的题干与题库名（难度预览的样例题用，避免全量读大字段） */
  stemsByIds(ids: number[]): { id: number; stem: string; bank_name: string }[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.all<{ id: number; stem: string; bank_name: string }>(
      `SELECT q.id, q.stem, COALESCE(b.name, '') AS bank_name FROM questions q
       LEFT JOIN banks b ON b.id = q.bank_id WHERE q.id IN (${placeholders})`,
      ids,
    );
  }

  /** 全库难度分（走 idx_questions_difficulty_score，纯索引扫描） */
  allDifficultyScores(): number[] {
    return this.db
      .all<{ difficulty_score: number }>('SELECT difficulty_score FROM questions WHERE difficulty_score >= 0')
      .map((r) => r.difficulty_score);
  }

  difficultyScoreOf(id: number): { id: number; difficulty_score: number } | undefined {
    return this.db.get<{ id: number; difficulty_score: number }>(
      'SELECT id, difficulty_score FROM questions WHERE id = ?',
      [id],
    );
  }

  /**
   * 每题的真实作答统计（难度校准的数据源）。
   * 数据来自随堂练习（`attempts`）与考试（`exam_attempts`）的 answers JSON：
   * `[{ qid, answer, correct }]`，`correct` 为 null 表示该题型不自动判分（不计入）。
   */
  answerStats(): Map<number, { id: number; total: number; correct: number }> {
    const out = new Map<number, { id: number; total: number; correct: number }>();
    for (const table of ['attempts', 'exam_attempts'] as const) {
      let afterId = 0;
      for (;;) {
        const rows = this.db.all<{ id: number; answers: string }>(
          `SELECT id, answers FROM ${table} WHERE id > ? ORDER BY id LIMIT 1000`,
          [afterId],
        );
        if (rows.length === 0) break;
        for (const row of rows) {
          afterId = row.id;
          let parsed: unknown;
          try {
            parsed = JSON.parse(row.answers);
          } catch {
            continue;
          }
          if (!Array.isArray(parsed)) continue;
          for (const raw of parsed) {
            const item = raw as { qid?: unknown; correct?: unknown };
            const qid = Number(item.qid);
            if (!Number.isInteger(qid) || qid <= 0) continue;
            if (typeof item.correct !== 'boolean') continue; // 简答题不自动判分，不作为难度证据
            const stat = out.get(qid) ?? { id: qid, total: 0, correct: 0 };
            stat.total += 1;
            if (item.correct) stat.correct += 1;
            out.set(qid, stat);
          }
        }
      }
    }
    return out;
  }

  /** 批量写难度结果（score + 三档 + 来源 + 校准信息） */
  setDifficulty(
    items: {
      id: number;
      score: number;
      difficulty: string;
      source: 'auto' | 'calibrated' | 'manual';
      n?: number;
      p?: number | null;
    }[],
  ): number {
    if (items.length === 0) return 0;
    let updated = 0;
    withBusyRetry(() =>
      this.db.transaction(() => {
        for (const it of items) {
          this.db.run(
            `UPDATE questions SET difficulty_score = ?, difficulty = ?, difficulty_source = ?,
               difficulty_n = ?, difficulty_p = ?, difficulty_at = unixepoch() WHERE id = ?`,
            [it.score, it.difficulty, it.source, it.n ?? 0, it.p ?? null, it.id],
          );
          updated += 1;
        }
      }),
    );
    return updated;
  }

  /** 单题难度（老师手动指定：来源标 manual，之后重算不会覆盖） */
  setManualDifficulty(id: number, difficulty: string, score: number): void {
    this.db.run(
      `UPDATE questions SET difficulty = ?, difficulty_score = ?, difficulty_source = 'manual',
         difficulty_at = unixepoch() WHERE id = ?`,
      [difficulty, score, id],
    );
  }

  /**
   * 难度分布与来源统计（体检 / 重算预览用）。
   * `cuts` 与落库时用的分档阈值一致，保证界面上的三档/五级与库里的 `difficulty` 完全对得上。
   */
  difficultyStats(
    bankId: number | undefined,
    cuts: { easyMax: number; mediumMax: number; five: [number, number, number, number] },
  ): {
    total: number;
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    levels: { level: number; questions: number }[];
    sources: { source: string; questions: number }[];
    histogram: { bucket: number; questions: number }[];
  } {
    const scope = bankId === undefined ? '' : ' AND bank_id = ?';
    const params = bankId === undefined ? [] : [bankId];
    const [p20, p40, p60, p80] = cuts.five;
    /**
     * **一次全表扫描**算出全部口径：按 (level, source, difficulty, bucket) 复合分组，
     * 结果集很小（≤ 6×5×5×10 行），再在 JS 里汇总。
     * 原来是 6 条独立的 COUNT/GROUP BY —— 冷缓存时就是 6 遍全表，体检页会像卡死（实测 69 秒）。
     */
    const rows = this.db.all<{
      level: number;
      source: string;
      difficulty: string;
      bucket: number;
      questions: number;
    }>(
      `SELECT CASE
                WHEN difficulty_score IS NULL OR difficulty_score < 0 THEN 0
                WHEN difficulty_score < ? THEN 1
                WHEN difficulty_score < ? THEN 2
                WHEN difficulty_score < ? THEN 3
                WHEN difficulty_score < ? THEN 4
                ELSE 5 END AS level,
              CASE WHEN difficulty_source IS NULL OR difficulty_source = '' THEN 'unknown' ELSE difficulty_source END AS source,
              COALESCE(difficulty, '') AS difficulty,
              CASE WHEN difficulty_score IS NULL OR difficulty_score < 0 THEN -1 ELSE CAST(difficulty_score / 10 AS INTEGER) END AS bucket,
              COUNT(*) AS questions
       FROM questions WHERE 1=1${scope}
       GROUP BY level, source, difficulty, bucket`,
      [p20, p40, p60, p80, ...params],
    );
    const total = rows.reduce((s, r) => s + Number(r.questions), 0);
    const unscored = rows.reduce((s, r) => (r.level === 0 ? s + Number(r.questions) : s), 0);
    const sumBy = (key: (r: (typeof rows)[number]) => string | number): Map<string | number, number> => {
      const m = new Map<string | number, number>();
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.questions));
      return m;
    };
    const bucketRows = [...sumBy((r) => r.difficulty)].map(([difficulty, questions]) => ({
      difficulty: String(difficulty),
      questions,
    }));
    bucketRows.sort((a, b) => b.questions - a.questions);
    const levelRows = [...sumBy((r) => r.level)]
      .map(([level, questions]) => ({ level: Number(level), questions }))
      .sort((a, b) => a.level - b.level);
    const sourceRows = [...sumBy((r) => r.source)]
      .map(([source, questions]) => ({ source: String(source), questions }))
      .sort((a, b) => b.questions - a.questions);
    const histogramRows = [...sumBy((r) => r.bucket)]
      .filter(([bucket]) => Number(bucket) >= 0)
      .map(([bucket, questions]) => ({ bucket: Number(bucket), questions }))
      .sort((a, b) => a.bucket - b.bucket);
    return {
      total,
      unscored,
      buckets: bucketRows,
      levels: levelRows,
      sources: sourceRows,
      histogram: histogramRows,
    };
  }

  setImage(id: number, imagePath: string): void {
    this.db.run('UPDATE questions SET image_path = ? WHERE id = ?', [imagePath, id]);
  }

  delete(id: number): void {
    const before = this.db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
    this.db.run('DELETE FROM questions WHERE id = ?', [id]);
    if (before) this.bumpBankCount(before.bank_id, -1);
  }

  /** 批量插入（CSV 导入），返回写入条数 */
  insertMany(inputs: QuestionInput[]): number {
    if (inputs.length === 0) return 0;
    let inserted = 0;
    this.db.transaction(() => {
      for (const input of inputs) {
        this.create(input);
        inserted += 1;
      }
    });
    return inserted;
  }

  /**
   * 题库体检：全库（或某个题库）的标准化统计。
   * - 总量 / 难度缺失 / 答案为空 / 无配图 / 有配图（`has_image` 预计算列，不再 LIKE 全表扫描）
   * - 重复题：同 content_hash 出现多次（跨题库也能查出来）
   * - 答案冲突：同 content_hash 但答案不一致
   *
   * 性能：全库 36.6 万题 / 590MB、NAS 机械盘上，原先 10 条独立聚合要几十秒；
   * 现在合成 2 条 SQL（1 次全表聚合 + 1 次按指纹分组），临时表放内存。
   */
  health(bankId?: number): {
    total: number;
    missingDifficulty: number;
    emptyAnswer: number;
    withoutImage: number;
    withImage: number;
    /** 解析只有图片、没有一个字的题（图片里是解析文字截图） */
    mediaOnlyAnalysis: number;
    duplicateGroups: number;
    duplicateQuestions: number;
    conflictGroups: number;
    noFingerprint: number;
  } {
    const scope = bankId === undefined ? '' : ' AND bank_id = ?';
    const params = bankId === undefined ? [] : [bankId];
    // 五个计数分开查，每条都能走索引：
    // 原来是一条 `SUM(CASE WHEN col = '' ...)` 全表聚合 —— 一列都不在索引里，
    // 冷缓存时要读完整库（真机实测 505 秒，体检页会像卡死）。
    // 迁移 0014 给「空值列」建了部分索引（只存 = '' 的行，通常几十行），
    // 于是 difficulty/answer/content_hash 的空值统计变成走小索引；has_image 用既有索引；
    // COUNT(*) 只读主键/rowid。
    const countWhere = (where: string): number =>
      this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE ${where}${scope}`, params)?.c ?? 0;
    const base = {
      total: countWhere('1=1'),
      missingDifficulty: countWhere("difficulty = ''"),
      emptyAnswer: countWhere("answer = ''"),
      withImage: countWhere('has_image = 1'),
      mediaOnlyAnalysis: countWhere('analysis_media_only = 1'),
      noFingerprint: countWhere("content_hash = ''"),
    };
    const dup = this.db.get<{ groups: number; questions: number; conflicts: number }>(
      `WITH g AS (
           SELECT content_hash, COUNT(*) AS n, COUNT(DISTINCT answer) AS a
           FROM questions WHERE content_hash <> ''${scope}
           GROUP BY content_hash HAVING COUNT(*) > 1
         )
         SELECT COUNT(*) AS groups, COALESCE(SUM(n), 0) AS questions, COALESCE(SUM(a > 1), 0) AS conflicts FROM g`,
      params,
    ) ?? { groups: 0, questions: 0, conflicts: 0 };
    const total = Number(base.total ?? 0);
    const withImage = Number(base.withImage ?? 0);
    return {
      total,
      missingDifficulty: Number(base.missingDifficulty ?? 0),
      emptyAnswer: Number(base.emptyAnswer ?? 0),
      withImage,
      withoutImage: total - withImage,
      mediaOnlyAnalysis: Number(base.mediaOnlyAnalysis ?? 0),
      duplicateGroups: Number(dup.groups ?? 0),
      duplicateQuestions: Number(dup.questions ?? 0),
      conflictGroups: Number(dup.conflicts ?? 0),
      noFingerprint: Number(base.noFingerprint ?? 0),
    };
  }

  /**
   * 元数据覆盖率：某一列非空的题目数（体检用）。
   *
   * 用「总数 − 空值数」而不是 `WHERE col <> ''`：空值那一侧有**部分索引**
   * （迁移 0014/0015，只存 `= ''` 的几十行），而 `<> ''` 没有任何索引可用 ——
   * 真机冷缓存实测一次 `<> ''` 统计要读完整库（500 秒级），体检页会像卡死。
   */
  countByMeta(
    bankId: number | undefined,
    column: 'subject' | 'book' | 'point' | 'content_hash',
    /**
     * 已知总数（体检已经算过 total 时传进来）——**省掉一次全表 COUNT(*)**。
     * 冷缓存下每次全表扫描都是几秒级，四个字段省 4 遍。
     */
    knownTotal?: number,
  ): number {
    const scope = bankId === undefined ? '' : ' AND bank_id = ?';
    const params = bankId === undefined ? [] : [bankId];
    const total =
      knownTotal ?? this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE 1=1${scope}`, params)?.c ?? 0;
    const empty =
      this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE ${column} = ''${scope}`, params)?.c ?? 0;
    return Math.max(0, total - empty);
  }

  /**
   * 回填 `analysis_media_only`（迁移 0020 的预计算列，老数据跑一次）。
   *
   * 判定要「去掉图片标记后没剩下字」，SQL 做不了字符串剥离，所以按 id 分页把候选行取出来在
   * JS 里判，再批量更新。候选用 `LIKE '%![%'`（**任何** markdown 图片，含外部图床 ——
   * 真机有 11 道题解析指向阿里云 OSS），不能只按本站题图收窄，否则会漏。
   * 幂等：跑第二遍结果相同（重复跑只是白扫一遍含图的行）。
   */
  backfillAnalysisMediaOnly(batchSize = 2000): number {
    let lastId = 0;
    let updated = 0;
    for (;;) {
      const rows = this.db.all<{ id: number; analysis: string }>(
        `SELECT id, analysis FROM questions
         WHERE id > ? AND analysis LIKE '%![%' ORDER BY id LIMIT ?`,
        [lastId, batchSize],
      );
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1]?.id ?? lastId;
      const only = rows.filter((r) => hasMediaOnlyAnalysis(r.analysis)).map((r) => r.id);
      if (only.length > 0) {
        withBusyRetry(() =>
          this.db.transaction(() => {
            for (const id of only) this.db.run('UPDATE questions SET analysis_media_only = 1 WHERE id = ?', [id]);
          }),
        );
        updated += only.length;
      }
    }
    return updated;
  }

  /** 回填 `has_image`（老数据一次性；导入器对新数据会直接写这一列） */
  backfillHasImage(batchSize = 5000): number {
    let updated = 0;
    for (;;) {
      const rows = this.db.all<{ id: number }>(
        `SELECT id FROM questions
         WHERE has_image = 0 AND (stem LIKE '%${IMAGE_REF}%' OR options LIKE '%${IMAGE_REF}%' OR analysis LIKE '%${IMAGE_REF}%')
         LIMIT ?`,
        [batchSize],
      );
      if (rows.length === 0) break;
      withBusyRetry(() =>
        this.db.transaction(() => {
          for (const r of rows) this.db.run('UPDATE questions SET has_image = 1 WHERE id = ?', [r.id]);
        }),
      );
      updated += rows.length;
    }
    return updated;
  }

  /**
   * 全量重算内容指纹（指纹算法升级时用一次）。
   *
   * 为什么需要：指纹的归一化口径变了（例如图片从「忽略」改成「按地址参与」），
   * 老数据的 `content_hash` 就与新算法不一致 —— 查重会把不同的看图题当成同一题。
   * 按 id 分页重算，跑第二遍得到同样的结果（幂等），返回实际更新的行数。
   */
  rehashContentHash(batchSize = 2000, onProgress?: (done: number, total: number) => void): number {
    const total = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c ?? 0;
    let lastId = 0;
    let updated = 0;
    for (;;) {
      const rows = this.db.all<{ id: number; stem: string; options: string }>(
        'SELECT id, stem, options FROM questions WHERE id > ? ORDER BY id LIMIT ?',
        [lastId, batchSize],
      );
      if (rows.length === 0) break;
      withBusyRetry(() =>
        this.db.transaction(() => {
          for (const r of rows) {
            const hash = questionFingerprint(r.stem, parseOptions(r.options));
            this.db.run('UPDATE questions SET content_hash = ? WHERE id = ?', [hash, r.id]);
            lastId = r.id;
          }
        }),
      );
      updated += rows.length;
      onProgress?.(updated, total);
    }
    return updated;
  }

  /** 缺少内容指纹的题目数（体检/回填用） */
  countMissingContentHash(): number {
    return (
      this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM questions WHERE content_hash IS NULL OR content_hash = ''")
        ?.c ?? 0
    );
  }

  /**
   * 回填空的内容指纹。
   *
   * 为什么要：指纹是查重与「同题不同答案」体检的判据，导入器会写入，
   * 但**管理端手工新增/编辑**的题目历史上不会写（已在服务层修掉），老数据用这个补一次。
   */
  backfillContentHash(batchSize = 2000): number {
    let updated = 0;
    for (;;) {
      const rows = this.db.all<{ id: number; stem: string; options: string }>(
        `SELECT id, stem, options FROM questions
         WHERE content_hash IS NULL OR content_hash = '' LIMIT ?`,
        [batchSize],
      );
      if (rows.length === 0) break;
      withBusyRetry(() =>
        this.db.transaction(() => {
          for (const r of rows) {
            this.db.run('UPDATE questions SET content_hash = ? WHERE id = ?', [
              questionFingerprint(r.stem, parseOptions(r.options)),
              r.id,
            ]);
          }
        }),
      );
      updated += rows.length;
    }
    return updated;
  }

  /** 跨题库检索（按知识点/书册/难度），带题库名便于展示 */
  searchByMeta(options: {
    subject?: string;
    book?: string;
    chapter?: string;
    point?: string;
    difficulty?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): (Question & { bank_name: string })[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const key of ['subject', 'book', 'chapter', 'point', 'difficulty', 'type'] as const) {
      const value = options[key];
      if (value) {
        clauses.push(`q.${key} = ?`);
        params.push(value);
      }
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(200, Math.max(1, options.limit ?? 30));
    const offset = Math.max(0, options.offset ?? 0);
    return this.db.all<Question & { bank_name: string }>(
      `SELECT q.*, COALESCE(b.name, '') AS bank_name FROM questions q
       LEFT JOIN banks b ON b.id = q.bank_id${where}
       ORDER BY q.id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
  }

  /** 按知识点聚合统计（有多少题、难度分布、来自几个题库） */
  pointStats(options: { subject?: string; book?: string; point?: string; limit?: number }): {
    subject: string;
    book: string;
    point: string;
    questions: number;
    easy: number;
    medium: number;
    hard: number;
    banks: number;
  }[] {
    const clauses: string[] = ["q.point <> ''"];
    const params: unknown[] = [];
    if (options.subject) {
      clauses.push('q.subject = ?');
      params.push(options.subject);
    }
    if (options.book) {
      clauses.push('q.book = ?');
      params.push(options.book);
    }
    if (options.point) {
      clauses.push('q.point LIKE ?');
      params.push(`%${options.point}%`);
    }
    const limit = Math.min(500, Math.max(1, options.limit ?? 50));
    return this.db.all(
      `SELECT q.subject, q.book, q.point, COUNT(*) AS questions,
              SUM(CASE WHEN q.difficulty = 'easy' THEN 1 ELSE 0 END) AS easy,
              SUM(CASE WHEN q.difficulty = 'medium' THEN 1 ELSE 0 END) AS medium,
              SUM(CASE WHEN q.difficulty = 'hard' THEN 1 ELSE 0 END) AS hard,
              COUNT(DISTINCT q.bank_id) AS banks
       FROM questions q WHERE ${clauses.join(' AND ')}
       GROUP BY q.subject, q.book, q.point
       ORDER BY questions DESC LIMIT ?`,
      [...params, limit],
    );
  }

  /**
   * 重复题分组（体检明细）：返回 hash、题数、答案种类、示例题干。
   *
   * 注意：示例题干**不参与分组聚合**（原写法 `MIN(stem)` 会让全表回表读题干，
   * 真机冷缓存一次要读完整库、几百秒）。这里先用 `(content_hash, answer)` 覆盖索引算出分组，
   * 再只对要展示的这 `limit` 组各取一条题干。
   */
  duplicateGroups(
    limit: number,
    bankId?: number,
  ): { content_hash: string; n: number; answers: number; stem: string }[] {
    const scope = bankId === undefined ? '' : ' AND bank_id = ?';
    const params = bankId === undefined ? [] : [bankId];
    const capped = Math.min(200, Math.max(1, limit));
    return this.db.all(
      `WITH g AS (
         SELECT content_hash, COUNT(*) AS n, COUNT(DISTINCT answer) AS answers
         FROM questions WHERE content_hash <> ''${scope}
         GROUP BY content_hash HAVING COUNT(*) > 1
         ORDER BY n DESC, content_hash LIMIT ?
       )
       SELECT g.content_hash, g.n, g.answers,
              (SELECT q.stem FROM questions q WHERE q.content_hash = g.content_hash LIMIT 1) AS stem
       FROM g ORDER BY g.n DESC, g.content_hash`,
      [...params, capped],
    );
  }

  /**
   * 同一题库内、指纹相同**且答案一致**的重复题：每组保留 id 最小的一条，返回要删除的 id。
   * 答案不一致的组不自动处理（属于「同题不同答案」的数据质量问题，由 `health().conflictGroups` 报出）。
   */
  duplicateIdsInBank(bankId: number, limit = 5000): { hash: string; keepId: number; removeIds: number[] }[] {
    const rows = this.db.all<{ content_hash: string; id: number; answer: string }>(
      `SELECT content_hash, id, answer FROM questions
       WHERE bank_id = ? AND content_hash <> '' ORDER BY content_hash, id`,
      [bankId],
    );
    const groups = new Map<string, { keepId: number; answer: string; removeIds: number[]; conflict: boolean }>();
    for (const r of rows) {
      const g = groups.get(r.content_hash);
      if (!g) {
        groups.set(r.content_hash, { keepId: r.id, answer: r.answer, removeIds: [], conflict: false });
        continue;
      }
      if (g.answer === r.answer) g.removeIds.push(r.id);
      else g.conflict = true; // 同题不同答案：不自动删
    }
    return [...groups.entries()]
      .filter(([, g]) => g.removeIds.length > 0 && !g.conflict)
      .slice(0, limit)
      .map(([hash, g]) => ({ hash, keepId: g.keepId, removeIds: g.removeIds }));
  }

  /** 批量删除（去重/清理用，一个事务）；同步维护题库题量 */
  deleteMany(ids: number[]): number {
    if (ids.length === 0) return 0;
    let removed = 0;
    this.db.transaction(() => {
      for (const id of ids) {
        const before = this.db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
        this.db.run('DELETE FROM questions WHERE id = ?', [id]);
        if (before) this.bumpBankCount(before.bank_id, -1);
        removed += 1;
      }
    });
    return removed;
  }

  /**
   * 按题库重新统计题量（兜底修复）。
   * 正常写路径都会维护 `banks.question_count`，这里用于：
   *   · 历史数据/运维脚本绕过写路径直接改题目后；
   *   · 体检发现对不上时。
   * 返回被修正的题库数（只更新真正不一致的）。
   */
  fixBankQuestionCounts(): number {
    return this.db.run(
      `UPDATE banks
       SET question_count = (SELECT COUNT(*) FROM questions q WHERE q.bank_id = banks.id)
       WHERE question_count <> (SELECT COUNT(*) FROM questions q WHERE q.bank_id = banks.id)`,
    ).changes;
  }
}
