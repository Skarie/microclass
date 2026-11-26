/**
 * 观看区间仓储：记录「已看片段」，用去重后的总时长判断是否看完。
 * 参考轻课堂的 watch_intervals（user_id + 起止秒）。
 *
 * P0 阶段 2：改走 `AsyncDb`（sqlite / pg 双栈）。
 * `record` 是「读旧区间 → 算并集 → 先删后插」的多语句写路径，必须整体在一个事务里：
 * 中途失败要连带前面的 DELETE 一起回滚，否则会把学生已看的片段删掉、留下空表。
 *
 * 纯函数（`mergeIntervals` / `coveredSeconds`）保持同步：只做内存计算、不碰库。
 */
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';

export interface WatchInterval {
  id: number;
  user_id: number;
  lesson_id: number;
  start_sec: number;
  end_sec: number;
  updated_at: number;
}

/** 把区间合并成互不重叠的片段（输入不要求有序） */
export function mergeIntervals(input: { start_sec: number; end_sec: number }[]): { start: number; end: number }[] {
  const sorted = input
    .map((i) => ({ start: Math.max(0, Math.floor(i.start_sec)), end: Math.max(0, Math.floor(i.end_sec)) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** 合并后区间覆盖的总秒数 */
export function coveredSeconds(input: { start_sec: number; end_sec: number }[]): number {
  return mergeIntervals(input).reduce((acc, i) => acc + (i.end - i.start), 0);
}

export class WatchIntervalRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  /**
   * 记录区间：与**已有区间取并集**后重写（保持表内互不重叠）。
   * 注意不能只删重叠行再插新行 —— 那会把「已看过的相邻部分」一并丢掉
   * （例如先 0-270，再 270-1080，必须得到 0-1080 而不是 270-1080）。
   */
  async record(userId: number, lessonId: number, intervals: { start: number; end: number }[]): Promise<number> {
    const incoming = intervals.map((i) => ({ start_sec: i.start, end_sec: i.end }));
    const existing = (await this.list(userId, lessonId)).map((i) => ({
      start_sec: i.start_sec,
      end_sec: i.end_sec,
    }));
    const merged = mergeIntervals([...existing, ...incoming]);
    if (merged.length === 0) return 0;
    return this.adb().transaction(async (tx) => {
      await tx.run('DELETE FROM watch_intervals WHERE user_id = ? AND lesson_id = ?', [userId, lessonId]);
      for (const seg of merged) {
        await tx.run('INSERT INTO watch_intervals (user_id, lesson_id, start_sec, end_sec) VALUES (?,?,?,?)', [
          userId,
          lessonId,
          seg.start,
          seg.end,
        ]);
      }
      return merged.length;
    });
  }

  async list(userId: number, lessonId: number): Promise<WatchInterval[]> {
    return this.adb().all<WatchInterval>(
      'SELECT * FROM watch_intervals WHERE user_id = ? AND lesson_id = ? ORDER BY start_sec',
      [userId, lessonId],
    );
  }

  /** 去重后的已看秒数（用于「看完 80%」判定） */
  async covered(userId: number, lessonId: number): Promise<number> {
    return coveredSeconds(await this.list(userId, lessonId));
  }

  async clear(userId: number, lessonId: number): Promise<void> {
    await this.adb().run('DELETE FROM watch_intervals WHERE user_id = ? AND lesson_id = ?', [userId, lessonId]);
  }
}
