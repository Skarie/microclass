/** 账号列表与审计日志共用的时间 / detail 文本格式化。 */

export function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN');
}

/** 审计日志 detail 里可能是任意 JSON 值，按原始类型安全转文本（对象走 JSON 序列化） */
function detailValueText(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return JSON.stringify(value) ?? '';
  }
}

export function formatDetail(detail: string | null): string {
  if (!detail) return '—';
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed === null || typeof parsed !== 'object') return detailValueText(parsed);
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => `${key}=${detailValueText(value)}`)
      .join(', ');
  } catch {
    return detail;
  }
}
