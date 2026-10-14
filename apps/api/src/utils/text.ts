/**
 * 外部输入 → 文本的受控转换。
 *
 * 直接用 `String(value)` 处理 unknown 会得到 `[object Object]`，
 * 因此这里只接受原始类型，其它（对象/数组/函数）一律按空串处理，
 * 避免脏数据被写进数据库或 CSV。
 */
export function asText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      // undefined / null / object / symbol / function 一律按空串处理
      return '';
  }
}

/** 去除首尾空白（非文本输入按空串处理） */
export function asTrimmed(value: unknown): string {
  return asText(value).trim();
}
