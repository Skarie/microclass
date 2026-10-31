/**
 * 「小节 → 题库」匹配规则与难度换算（纯函数，无 IO）。
 *
 * 匹配优先级（只看同一门课程下的题库）：
 *   1. 题库的 `section` = 章节，且题库名**最后一段** = 小节 → 命中（最可靠）；
 *   2. 题库名**包含**小节且**唯一命中** → 命中（兼容「章节（括号说明）· 小节」之外的命名）；
 *   3. 都没有 → 新建题库（`章节 · 小节`，kind=chapter）。
 *
 * 难度换算：题源的「难度值」≈正确率（越大越基础），平台的 `difficulty_score`
 * 是 0–100 综合分（越大越难），所以按 `(1 - 难度值) × 100` 换算并四舍五入，
 * 与既有难度模型、三档切点（`DEFAULT_CUTS`）同一口径。
 */
import { DEFAULT_CUTS } from './difficulty.js';

/** 参与匹配的题库（只取需要的列） */
export interface TeacherBankCandidate {
  id: number;
  name: string;
  section: string;
}

export type TeacherBankMatchAction = 'replace' | 'create';

export interface TeacherBankMatch {
  action: TeacherBankMatchAction;
  /** 命中/新建题库的 id；dry-run 下的新建为 null */
  bankId: number | null;
  reason: 'section-and-tail' | 'name-contains' | 'none';
}

/** 题库名按 `·` 分段后取最后一段（`第一章 有理数（说明）· 数轴` → `数轴`） */
export function lastBankNameSegment(name: string): string {
  const parts = String(name ?? '')
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** 新建题库的命名：`章节 · 小节`（只有章节时退回章节名） */
export function teacherBankName(chapter: string, section: string): string {
  const left = String(chapter ?? '').trim();
  const right = String(section ?? '').trim();
  if (left === '') return right;
  if (right === '' || right === left) return left;
  return `${left} · ${right}`;
}

/** 小节 → 题库匹配结果（调用方负责按 id 升序传入，命中取最靠前的一条） */
export function matchTeacherBank(
  candidates: readonly TeacherBankCandidate[],
  chapter: string,
  section: string,
): TeacherBankMatch {
  const chapterKey = String(chapter ?? '').trim();
  const sectionKey = String(section ?? '').trim();
  const exact = candidates.find(
    (bank) => bank.section.trim() === chapterKey && lastBankNameSegment(bank.name) === sectionKey,
  );
  if (exact) return { action: 'replace', bankId: exact.id, reason: 'section-and-tail' };
  if (sectionKey !== '') {
    const fuzzy = candidates.filter((bank) => bank.name.includes(sectionKey));
    if (fuzzy.length === 1) {
      const hit = fuzzy[0];
      if (hit) return { action: 'replace', bankId: hit.id, reason: 'name-contains' };
    }
  }
  return { action: 'create', bankId: null, reason: 'none' };
}

/** 难度值 0~1（≈正确率）→ 平台难度分 0~100（越大越难）；缺省返回 -1（未标注） */
export function difficultyScoreFrom01(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return -1;
  const ratio = Math.min(1, Math.max(0, value));
  const score = Math.round((1 - ratio) * 100);
  return Math.min(100, Math.max(1, score));
}

/** 难度分 → 三档（与 `difficultyService` 落库口径一致）；未标注返回空串 */
export function difficultyLabelFromScore(score: number): string {
  if (!Number.isInteger(score) || score < 0) return '';
  if (score < DEFAULT_CUTS.easyMax) return 'easy';
  if (score < DEFAULT_CUTS.mediumMax) return 'medium';
  return 'hard';
}
