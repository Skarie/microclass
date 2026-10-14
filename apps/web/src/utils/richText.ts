/**
 * 题面富文本切分：把题库里的纯文本切成「文字 / 图片 / 公式」片段。
 *
 * 约定（与导入器一致）：
 *   - 图片：`![](/api/v1/question-media/<sha1>.png)`（内容寻址）
 *   - 公式：`$...$` 行内、`$$...$$` 独立成行
 *
 * 关键处理：题库里图片几乎都单独占一行（实测 12.8 万道题干是「文字\n\n![](图)」），
 * 但其中很多图其实是「几分之几」这类公式碎片；如果保留换行，前端就会把句子强行拆断。
 * 因此这里把图片前后的换行/空白**统一收成一个空格**，由渲染层再按图片实际大小
 * 决定「行内展示」还是「整幅图居中展示」。
 */

export interface RichSegment {
  kind: 'text' | 'image' | 'math';
  value: string;
  alt?: string;
  display?: boolean;
}

import { scanBareLatex } from '@microclass/shared';

export { scanBareLatex };

/** 只允许站内题目图片或 http(s) 图片；其它（含 javascript:）返回 null */
export function safeImageUrl(url: string): string | null {
  const u = url.trim();
  if (u.startsWith('/api/v1/question-media/')) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return null;
}

export function splitRichText(text: string): RichSegment[] {
  const raw: RichSegment[] = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) raw.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined || m[2] !== undefined) {
      const url = safeImageUrl(m[2] ?? '');
      if (url) raw.push({ kind: 'image', value: url, alt: m[1] ?? '' });
      else raw.push({ kind: 'text', value: m[0] });
    } else if (m[3] !== undefined) {
      raw.push({ kind: 'math', value: m[3], display: true });
    } else {
      raw.push({ kind: 'math', value: m[4] ?? '', display: false });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) raw.push({ kind: 'text', value: text.slice(last) });

  const out: RichSegment[] = [];
  for (const seg of raw) {
    if (seg.kind === 'image') {
      const prev = out[out.length - 1];
      if (prev?.kind === 'text') prev.value = prev.value.replace(/\s+$/, ' ');
      out.push(seg);
      continue;
    }
    if (seg.kind === 'text') {
      const prev = out[out.length - 1];
      out.push({ kind: 'text', value: prev?.kind === 'image' ? seg.value.replace(/^\s+/, ' ') : seg.value });
      continue;
    }
    out.push(seg);
  }
  // 再把文本片段里**没写 `$` 定界**的公式拆成 math（真机解析里 2,817 行是这种写法，
  // 以前会原样显示成 `\frac{3}{2}` 这种源码）
  return out
    .flatMap((seg) => (seg.kind === 'text' ? splitBareLatexInText(seg) : [seg]))
    .filter((s) => !(s.kind === 'text' && s.value === ''));
}

/** 把一个文本片段按裸 LaTeX 再切成 文本 / 公式 片段 */
function splitBareLatexInText(seg: RichSegment): RichSegment[] {
  const spans = scanBareLatex(seg.value);
  if (spans.length === 0) return [seg];
  const result: RichSegment[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start > last) result.push({ kind: 'text', value: seg.value.slice(last, span.start) });
    result.push({ kind: 'math', value: span.tex, display: span.display });
    last = span.end;
  }
  if (last < seg.value.length) result.push({ kind: 'text', value: seg.value.slice(last) });
  return result;
}

/** 按图片真实像素判断是「整幅图」（居中块级）还是「行内小图」（公式碎片） */
export function isFigureImage(naturalWidth: number, naturalHeight: number): boolean {
  return naturalHeight > 200 || naturalWidth > 480;
}
