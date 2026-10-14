import { describe, expect, it } from 'vitest';
import {
  coveredSeconds,
  mergeIntervals,
  WatchIntervalRepository,
} from '../src/db/repositories/watchIntervalRepository.js';
import { Db } from '../src/db/client.js';

/** 只含 watch_intervals 的内存库，用于验证「多次上报取并集」的持久化语义 */
function memoryRepo(): WatchIntervalRepository {
  const db = new Db(':memory:');
  db.exec(`CREATE TABLE watch_intervals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    lesson_id INTEGER NOT NULL,
    start_sec INTEGER NOT NULL,
    end_sec INTEGER NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch())
  );`);
  return new WatchIntervalRepository(db);
}

/**
 * 观看区间语义：去重合并后统计「真正看过多久」，
 * 参考飞牛轻课堂的 watch_intervals 设计（拖到最后不等于看完）。
 */
describe('观看区间合并', () => {
  it('重叠区间被合并，不重复计时', () => {
    const merged = mergeIntervals([
      { start_sec: 0, end_sec: 30 },
      { start_sec: 20, end_sec: 50 },
      { start_sec: 45, end_sec: 60 },
    ]);
    expect(merged).toEqual([{ start: 0, end: 60 }]);
    expect(
      coveredSeconds([
        { start_sec: 0, end_sec: 30 },
        { start_sec: 20, end_sec: 50 },
      ]),
    ).toBe(50);
  });

  it('乱序输入也能正确合并', () => {
    expect(
      mergeIntervals([
        { start_sec: 100, end_sec: 120 },
        { start_sec: 10, end_sec: 20 },
        { start_sec: 15, end_sec: 25 },
      ]),
    ).toEqual([
      { start: 10, end: 25 },
      { start: 100, end: 120 },
    ]);
  });

  it('相邻区间合并成一段', () => {
    expect(
      mergeIntervals([
        { start_sec: 0, end_sec: 10 },
        { start_sec: 10, end_sec: 20 },
      ]),
    ).toEqual([{ start: 0, end: 20 }]);
  });

  it('丢弃空/负区间，并保留小数取整', () => {
    expect(
      mergeIntervals([
        { start_sec: 5, end_sec: 5 },
        { start_sec: 8, end_sec: 3 },
        { start_sec: 1.4, end_sec: 4.9 },
      ]),
    ).toEqual([{ start: 1, end: 4 }]);
  });

  it('跳跃观看（拖进度条）只累计真正看过的部分', () => {
    // 看 0-30 秒，再拖到 900 秒看 30 秒 → 共 60 秒，而不是 930 秒
    expect(
      coveredSeconds([
        { start_sec: 0, end_sec: 30 },
        { start_sec: 900, end_sec: 930 },
      ]),
    ).toBe(60);
  });

  it('多次上报取并集：先 0-270 再 270-1080，应为 0-1080（不能丢前一段）', () => {
    const repo = memoryRepo();
    repo.record(1, 9, [{ start: 0, end: 270 }]);
    expect(repo.covered(1, 9)).toBe(270);
    repo.record(1, 9, [{ start: 270, end: 1080 }]);
    expect(repo.covered(1, 9)).toBe(1080);
    expect(repo.list(1, 9)).toHaveLength(1);
  });

  it('分段观看：中间跳过不计时，但已看部分累加', () => {
    const repo = memoryRepo();
    repo.record(1, 9, [{ start: 0, end: 30 }]);
    repo.record(1, 9, [{ start: 900, end: 930 }]);
    expect(repo.covered(1, 9)).toBe(60);
    expect(repo.list(1, 9)).toHaveLength(2);
    // 补看中间 30-900 后合并成一段，总时长 930
    repo.record(1, 9, [{ start: 30, end: 900 }]);
    expect(repo.covered(1, 9)).toBe(930);
    expect(repo.list(1, 9)).toHaveLength(1);
  });

  it('重复上报同一段不会重复计时', () => {
    const repo = memoryRepo();
    repo.record(1, 9, [{ start: 100, end: 200 }]);
    repo.record(1, 9, [{ start: 100, end: 200 }]);
    repo.record(1, 9, [{ start: 150, end: 160 }]);
    expect(repo.covered(1, 9)).toBe(100);
  });

  it('不同用户/课时互不影响', () => {
    const repo = memoryRepo();
    repo.record(1, 9, [{ start: 0, end: 100 }]);
    repo.record(2, 9, [{ start: 0, end: 50 }]);
    repo.record(1, 10, [{ start: 0, end: 10 }]);
    expect(repo.covered(1, 9)).toBe(100);
    expect(repo.covered(2, 9)).toBe(50);
    expect(repo.covered(1, 10)).toBe(10);
  });

  it('空输入返回 0', () => {
    expect(coveredSeconds([])).toBe(0);
    expect(mergeIntervals([])).toEqual([]);
  });
});
