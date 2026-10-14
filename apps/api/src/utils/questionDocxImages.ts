/**
 * 题干/选项/解析里的内联题图 → docx 图片标记。
 *
 * 从 BankService 抽出来的（试卷 Word 导出也要用同一套逻辑）：
 * 真机上大量题目的题干带 `![](/api/v1/question-media/<sha1>.png)`，
 * Word 里必须变成真正的嵌入图片，否则导出稿全是这行源码文本。
 */
import { imageExtension, imageSize, readImageFile, type DocxImage } from './docx.js';

/** 题图 URL 形如 /api/v1/question-media/<40 位 sha1>.<ext> */
const MEDIA_RE = /!\[[^\]]*\]\(\/api\/v1\/question-media\/([0-9a-f]{40}\.[a-z]+)\)/gi;

export function inlineImagesToDocx(
  text: string,
  images: DocxImage[],
  resolve: (file: string) => string | null,
): string {
  if (!text || !text.includes('question-media')) return text;
  return text.replace(MEDIA_RE, (_full, file: string) => {
    const abs = resolve(file);
    const data = abs ? readImageFile(abs) : null;
    if (!abs || !data) return '';
    const size = imageSize(data) ?? { width: 480, height: 270 };
    const scale = size.width > 480 ? 480 / size.width : 1;
    images.push({
      name: `image${images.length + 1}.${imageExtension(data, abs)}`,
      data,
      widthPx: Math.round(size.width * scale),
      heightPx: Math.round(size.height * scale),
    });
    return ` [[img:${images.length}]] `;
  });
}
