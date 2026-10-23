/**
 * 卷面缓存（`ExamPaperCache`）单测：
 *   - TTL 内复用同一份卷面，避免交卷时重复读整卷；
 *   - 超过 TTL 重新取数；
 *   - 改卷 / 删题后 `clearPaper` 立即失效。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamPaperCache } from '../src/services/exam-paper-cache.js';
import type { PaperRow } from '../src/services/paperCommon.js';

const row = { id: 1, type: 'single', score: 10 } as PaperRow;

function makeCache(): { cache: ExamPaperCache; listQuestions: ReturnType<typeof vi.fn> } {
  const listQuestions = vi.fn(() => [row]);
  return { cache: new ExamPaperCache({ listQuestions }), listQuestions };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('卷面缓存', () => {
  it('TTL 内复用同一份卷面，只读一次库', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { cache, listQuestions } = makeCache();

    expect(cache.paperOf(7)).toBe(cache.paperOf(7));
    expect(listQuestions).toHaveBeenCalledTimes(1);
  });

  it('超过 TTL 后重新取数', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const { cache, listQuestions } = makeCache();

    cache.paperOf(7);
    now.mockReturnValue(15_001);
    cache.paperOf(7);
    expect(listQuestions).toHaveBeenCalledTimes(2);
  });

  it('clearPaper 后立即失效（改卷 / 删题场景）', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { cache, listQuestions } = makeCache();

    cache.paperOf(7);
    cache.clearPaper(7);
    cache.paperOf(7);
    expect(listQuestions).toHaveBeenCalledTimes(2);
  });
});
