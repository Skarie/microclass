/**
 * 极简 MIME 映射（仅服务端出流需要，前端资源由构建产物自带类型）。
 */
import path from 'node:path';

const MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeFor(filePath: string): string {
  return MAP[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 绝不允许内联展示的类型：HTML / SVG / XML 可以在同源下执行脚本，
 * 而文件内容来自用户上传，内联即等于存储型 XSS。一律作为附件下载。
 */
const NEVER_INLINE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)/i;

/** 可以安全内联的类型：光栅图片、PDF、音视频、纯文本类 */
const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|bmp|x-icon)|application\/pdf|video\/|audio\/|text\/)/i;

export function isInlineMime(mime: string): boolean {
  if (NEVER_INLINE.test(mime)) return false;
  return INLINE_SAFE.test(mime);
}
