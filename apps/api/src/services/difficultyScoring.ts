/**
 * 难度先验打分：按 id 游标分页取特征 → 内存里逐题算分（**不写库**）。
 *
 * 从 `DifficultyService` 抽出（行数守卫）。大库（39.6 万题）下两个关键点：
 *   - 分页读，一次只把 `SCORE_PAGE` 条特征读进内存，不整库加载；
 *   - 页与页之间让出事件循环，避免同步 SQLite + 纯计算长时间卡住请求。
 *
 * `manual` / `calibrated` 的题默认跳过：人工判断与真实数据都比模型先验可靠。
 */
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import { scoreDifficulty } from '../domain/difficulty.js';
import { parseOptions } from '../domain/question.js';
import { yieldToEventLoop } from '../utils/async.js';

/** 一页读多少题：读放大与让出频率的折中（500–1000 区间，实测见提交说明） */
export const SCORE_PAGE = 1000;

export interface ScoredItem {
  id: number;
  score: number;
  source: 'auto';
  reasons: string;
  level: number;
  difficulty: string;
}

export interface ScoredBatch {
  items: ScoredItem[];
  skippedManual: number;
  skippedCalibrated: number;
  total: number;
}

export async function scoreBatch(
  questions: QuestionRepository,
  bankId: number | undefined,
  options: { keepManual?: boolean; keepCalibrated?: boolean; onlyUnscored?: boolean },
): Promise<ScoredBatch> {
  const keepManual = options.keepManual !== false;
  const keepCalibrated = options.keepCalibrated !== false;
  const out: ScoredItem[] = [];
  let skippedManual = 0;
  let skippedCalibrated = 0;
  let afterId = 0;
  let total = 0;
  for (;;) {
    const rows = await questions.difficultyFeatures({
      ...(bankId === undefined ? {} : { bankId }),
      afterId,
      limit: SCORE_PAGE,
      ...(options.onlyUnscored ? { onlyUnscored: true } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = row.id;
      total += 1;
      const source = String(row.difficulty_source ?? '');
      if (keepManual && source === 'manual') {
        skippedManual += 1;
        continue;
      }
      if (keepCalibrated && source === 'calibrated') {
        skippedCalibrated += 1;
        continue;
      }
      const scored = scoreDifficulty({
        type: row.type,
        stem: row.stem,
        options: parseOptions(row.options),
        answer: row.answer,
        blanks: countBlanks(row.type, row.answer, row.stem),
        hasImage: row.has_image === 1,
        subject: row.subject,
        stage: row.stage,
        book: row.book,
        chapter: row.chapter,
        point: row.point,
        bankKind: row.bank_kind,
        bankName: row.bank_name,
        legacyDifficulty: row.difficulty,
      });
      out.push({
        id: row.id,
        score: scored.score,
        source: 'auto',
        reasons: scored.reasons
          .filter((r) => r.key !== 'base')
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
          .slice(0, 3)
          .map((r) => `${r.label} ${r.delta > 0 ? '+' : ''}${r.delta}`)
          .join('、'),
        // level / difficulty 由调用方在本轮 cuts 定了之后统一派生（与落库口径一致）
        level: 3,
        difficulty: 'medium',
      });
    }
    if (rows.length >= SCORE_PAGE) await yieldToEventLoop();
  }
  return { items: out, skippedManual, skippedCalibrated, total };
}

/** 填空题空位数：优先看题干里的空位记号，其次看答案里的多空分隔符 */
export function countBlanks(type: string, answer: string, stem: string): number {
  if (type !== 'fill') return 0;
  const marks = (stem.match(/_{2,}|＿{2,}|\(\s*\)|（\s*）/g) ?? []).length;
  if (marks > 0) return marks;
  const parts = String(answer ?? '')
    .split(/[；;]/)
    .filter((s) => s.trim() !== '');
  return parts.length;
}
