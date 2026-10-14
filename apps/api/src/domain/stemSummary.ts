/**
 * 台账里的题干摘要：**不能切断 markdown 图片/链接**。
 *
 * 真机 bug：冲突题列表第一题的图片显示成源码 `![](/api/v1/question-media`。
 * 根因是这里原来直接 `stem.slice(0, 200)`，正好切在图片 URL 中间，
 * 前端拿到的就是一段残缺的 markdown，只能当普通文本渲染。
 */
export function stemSummary(stem: string, max = 200): string {
  const text = String(stem ?? '');
  if (text.length <= max) return text;
  let cut = text.slice(0, max);

  // 未闭合的图片 `![...](` ：回退到 `![` 之前
  const lastImage = cut.lastIndexOf('![');
  if (lastImage >= 0 && cut.indexOf(')', lastImage) === -1) cut = cut.slice(0, lastImage);

  // 未闭合的链接 `[...](`（不含图片）：同样回退
  const lastLink = cut.lastIndexOf('](');
  if (lastLink >= 0 && cut.indexOf(')', lastLink) === -1) {
    const bracket = cut.lastIndexOf('[', lastLink);
    if (bracket >= 0) cut = cut.slice(0, bracket);
  }

  return `${cut.trimEnd()}…`;
}
