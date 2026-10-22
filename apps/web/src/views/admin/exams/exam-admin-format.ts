/** 考试管理用到的纯格式化函数（无响应式依赖，便于单测与复用） */

/** 分值显示：保留 1 位小数（避免浮点尾巴 50.099999999999994） */
export function fmtScore(value: number | undefined | null): string {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN');
}
