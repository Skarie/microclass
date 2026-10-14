/**
 * 下载响应头：文件名走 RFC 5987（中文安全），并禁止缓存。
 * 放在这里而不是各路由里重复拼，避免「有的接口带 BOM/有的不带」这类不一致。
 */

/** 文本类下载（Markdown / CSV / JSON） */
export function textHeaders(filename: string, contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store',
  };
}

/** Word（.docx）下载 */
export function docxHeaders(filename: string): Record<string, string> {
  return textHeaders(filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
