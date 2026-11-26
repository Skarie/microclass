/**
 * 卷面缓存（`ExamPaperCache`）单测：
 *   - TTL 内复用同一份卷面，避免交卷时重复读整卷；
 *   - 超过 TTL 重新取数；
 *   - 改卷 / 删题后 `clearPaper` 立即失效。
 *
 * P0 阶段 2（批次 1）：`listQuestions` 改为 AsyncDb 异步读，`paperOf` 返回 Promise；
 * 缓存语义（命中不读库、返回同一份数组、TTL 与失效）保持不变，这里逐条钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamPaperCache } from '../src/services/exam-paper-cache.js';
import type { PaperRow } from '../src/services/paperCommon.js';

const row = { id: 1, type: 'single', score: 10 } as PaperRow;

function makeCache(): { cache: ExamPaperCache; listQuestions: ReturnType<typeof vi.fn> } {
  const listQuestions = vi.fn(async () => [row]);
  return { cache: new ExamPaperCache({ listQuestions }), listQuestions };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('卷面缓存', () => {
  it('TTL 内复用同一份卷面，只读一次库', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { cache, listQuestions } = makeCache();

    const first = await cache.paperOf(7);
    const second = await cache.paperOf(7);
    expect(second).toBe(first);
    expect(listQuestions).toHaveBeenCalledTimes(1);
  });

  it('超过 TTL 后重新取数', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const { cache, listQuestions } = makeCache();

    await cache.paperOf(7);
    now.mockReturnValue(15_001);
    await cache.paperOf(7);
    expect(listQuestions).toHaveBeenCalledTimes(2);
  });

  it('clearPaper 后立即失效（改卷 / 删题场景）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { cache, listQuestions } = makeCache();

    await cache.paperOf(7);
    cache.clearPaper(7);
    await cache.paperOf(7);
    expect(listQuestions).toHaveBeenCalledTimes(2);
  });
});
