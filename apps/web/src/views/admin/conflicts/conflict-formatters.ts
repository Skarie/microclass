/**
 * 冲突题页共用的小映射与格式化（纯常量 + 纯函数，放页面目录下，只有这一页用）：
 * 台账状态文案、题库类型/难度、台账年龄与时间戳。
 */
export const PAGE_SIZE = 20;

export const KIND_LABEL: Record<string, string> = { lesson: '课时配套', chapter: '章节题库', paper: '整卷试卷' };

export const DIFFICULTY_LABEL: Record<string, string> = { easy: '基础', medium: '中等', hard: '较难' };

export const SYNC_REASON_LABEL: Record<string, string> = {
  never: '台账还没建立',
  empty: '台账为空',
  grew: '题库有新增题目',
  ttl: '超过 5 分钟没刷新',
  fresh: '台账是最新的',
  forced: '手动重新扫描',
};

/** 台账年龄（分钟），让用户判断数据新不新 */
export function ageLabel(ms: number): string {
  if (!Number.isFinite(ms)) return '未知';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

/** 台账里的时间戳是秒，展示成「2026-01-02 03:04」 */
export function fmtTime(seconds: number): string {
  if (!seconds) return '';
  const d = new Date(seconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
