/**
 * 试卷 HTML 渲染（打印/预览用，纯函数）。
 *
 * 为什么要服务端出 HTML 而不是前端渲染后打印：
 *  - 打印要在**任何浏览器/任何机器**上都能出正确的 A4/A3 版式，不能依赖前端 JS 跑完；
 *  - 公式必须真实排版：题库里大量 `$...$` LaTeX，这里用 KaTeX **服务端**渲染成
 *    `<span class="katex">`（前端只负责把 `katex.min.css` + 字体取回来），
 *    否则打印出来的数学卷子全是 `\frac{1}{2}` 这种源码；
 *  - `@page { size: A4 }` / `size: A3` 决定纸张，`preferCSSPageSize` 下浏览器导出 PDF 也按它走。
 *
 * 版式对齐常见真卷：试卷头（标题/满分/时间/注意事项）→ 考生信息栏 → 得分栏 →
 * 大题（一、单选题（本大题共 10 小题，每小题 3 分，共 30 分））→ 题号连续 → 选项横排 →
 * 填空/解答留作答空间 → 可选：密封线（左侧竖排）、答题卡（独立一页）、答案与解析卷。
 */
import katex from 'katex';
import { scanBareLatex } from '@microclass/shared';
import type { QuestionType } from '@microclass/shared';

export type PaperSize = 'A4' | 'A3';

export interface PaperRenderQuestion {
  no: number;
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  score: number;
  difficulty?: string;
  point?: string;
}

export interface PaperRenderSection {
  name: string;
  type: string;
  /** 每题分值（用于「每小题 X 分」） */
  score: number;
  questions: PaperRenderQuestion[];
}

export interface PaperRenderOptions {
  size: PaperSize;
  orientation: 'portrait' | 'landscape';
  /** 分栏（A3 常用双栏） */
  columns: 1 | 2;
  /** 附答案与解析 */
  withAnswers: boolean;
  /** 附答题卡（独立一页） */
  withAnswerSheet: boolean;
  /** 左侧密封线 */
  withSeal: boolean;
  /** 每题后标注分值 */
  showScoreBox: boolean;
  /** 试卷头信息 */
  siteName: string;
  title: string;
  durationMinutes: number;
  totalScore: number;
  /** 填空题作答行数 / 解答题留白高度（mm） */
  fillLines: number;
  answerSpaceMm: number;
  /** 载入后自动弹出打印对话框 */
  autoPrint: boolean;
}

export const DEFAULT_PAPER_OPTIONS: Omit<PaperRenderOptions, 'title'> = {
  size: 'A4',
  orientation: 'portrait',
  columns: 1,
  withAnswers: false,
  withAnswerSheet: false,
  withSeal: false,
  showScoreBox: true,
  siteName: '微课堂',
  durationMinutes: 60,
  totalScore: 100,
  fillLines: 1,
  answerSpaceMm: 30,
  autoPrint: false,
};

const TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/** HTML 转义（题面里的 `<`、`&` 必须转义，否则版式会崩） */
function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 题面 → HTML：文本转义 + KaTeX 渲染 + 图片标签 + 换行处理。
 * 支持 `$$...$$`（行间公式）、`$...$`（行内公式）、`![](url)` 图片，
 * 以及**没写 `$` 定界的裸 LaTeX**（真机解析里 2,817 行、题干 168 行是这种写法，
 * 与前端共用 `scanBareLatex`，避免"屏幕上渲染了、打印出来还是源码"）。
 */
export function renderRichText(raw: string): string {
  const text = String(raw ?? '');
  if (!text) return '';
  const out: string[] = [];
  // 依次切出 图片 / 行间公式 / 行内公式
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const renderMath = (tex: string, displayMode: boolean): void => {
    const body = tex.trim();
    if (!body) return;
    try {
      out.push(katex.renderToString(body, { throwOnError: false, displayMode, output: 'html' }));
    } catch {
      out.push(esc(body));
    }
  };
  const pushText = (chunk: string): void => {
    if (!chunk) return;
    // 文本片段里可能藏着裸 LaTeX（`\frac{3}{2}`），按 span 再切一次
    const spans = scanBareLatex(chunk);
    let cursor = 0;
    for (const span of spans) {
      pushPlain(chunk.slice(cursor, span.start));
      renderMath(span.tex, span.display);
      cursor = span.end;
    }
    pushPlain(chunk.slice(cursor));
  };
  const pushPlain = (chunk: string): void => {
    if (!chunk) return;
    const html = esc(chunk)
      .replace(/\r?\n{2,}/g, '</p><p class="ptext">')
      .replace(/\r?\n/g, '<br>');
    out.push(html);
  };
  while ((match = pattern.exec(text)) !== null) {
    pushText(text.slice(last, match.index));
    if (match[1]) {
      out.push(`<img class="pimg" src="${esc(match[1])}" alt="">`);
    } else {
      renderMath(match[2] ?? match[3] ?? '', Boolean(match[2]));
    }
    last = match.index + match[0].length;
  }
  pushText(text.slice(last));
  return out.join('');
}

/** 判断题在卷面上的选项写法 */
function optionsForQuestion(question: PaperRenderQuestion): string[] {
  if (question.type === 'judge') return ['正确', '错误'];
  return question.options ?? [];
}

const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 单题 HTML */
function renderQuestion(question: PaperRenderQuestion, options: PaperRenderOptions, sectionType: string): string {
  const parts: string[] = [`<div class="q" id="q${question.no}">`];
  parts.push('<div class="q__head">');
  parts.push(`<span class="q__no">${question.no}.</span>`);
  parts.push(`<span class="q__stem">${renderRichText(question.stem)}</span>`);
  if (options.showScoreBox && question.score > 0) parts.push(`<span class="q__score">（${question.score} 分）</span>`);
  parts.push('</div>');

  const list = optionsForQuestion(question);
  if (
    sectionType === 'single' ||
    sectionType === 'multiple' ||
    question.type === 'single' ||
    question.type === 'multiple'
  ) {
    if (list.length > 0) {
      parts.push('<div class="q__options">');
      list.forEach((option, index) => {
        parts.push(
          `<span class="opt"><b>${OPTION_LETTERS[index] ?? '?'}.</b> ${renderRichText(String(option).replace(/^[A-Za-z][.、．]\s*/, ''))}</span>`,
        );
      });
      parts.push('</div>');
    }
  } else if (question.type === 'judge') {
    parts.push('<div class="q__options"><span class="opt">（　　）</span></div>');
  } else if (question.type === 'fill') {
    parts.push(
      `<div class="q__answer-lines">${'<div class="line"></div>'.repeat(Math.max(1, options.fillLines))}</div>`,
    );
  } else {
    parts.push(`<div class="q__answer-space" style="min-height:${Math.max(15, options.answerSpaceMm)}mm"></div>`);
  }

  if (options.withAnswers) {
    const answer = String(question.answer ?? '').trim();
    const analysis = String(question.analysis ?? '').trim();
    parts.push('<div class="q__answer">');
    parts.push(`<span class="q__answer-label">【答案】</span><span>${renderRichText(answer || '—')}</span>`);
    if (analysis)
      parts.push(
        `<div class="q__analysis"><span class="q__answer-label">【解析】</span>${renderRichText(analysis)}</div>`,
      );
    parts.push('</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

/** 答题卡（选择题涂卡 + 主观题作答区） */
function renderAnswerSheet(sections: PaperRenderSection[], options: PaperRenderOptions): string {
  const objective = sections.flatMap((s) => s.questions).filter((q) => q.type === 'single' || q.type === 'multiple');
  const subjective = sections.flatMap((s) => s.questions).filter((q) => q.type !== 'single' && q.type !== 'multiple');
  const rows: string[] = ['<section class="sheet page-break">'];
  rows.push(`<h2 class="sheet__title">${esc(options.title)} · 答题卡</h2>`);
  rows.push('<div class="sheet__info">班级：__________ 姓名：__________ 学号：__________ 得分：________</div>');
  if (objective.length > 0) {
    rows.push('<h3 class="sheet__sub">一、选择题（请把正确选项涂满）</h3>');
    rows.push('<table class="sheet__table"><thead><tr><th>题号</th><th>选项</th></tr></thead><tbody>');
    for (const q of objective) {
      const letters = optionsForQuestion(q);
      const cells = letters.map((_, i) => `<span class="bubble">${OPTION_LETTERS[i] ?? '?'}</span>`).join(' ');
      rows.push(`<tr><td>${q.no}</td><td>${cells}</td></tr>`);
    }
    rows.push('</tbody></table>');
  }
  if (subjective.length > 0) {
    rows.push('<h3 class="sheet__sub">二、非选择题（请在各题指定区域内作答）</h3>');
    for (const q of subjective) {
      rows.push(
        `<div class="sheet__blank"><div class="sheet__blank-no">${q.no}.</div><div class="sheet__blank-box" style="min-height:${Math.max(25, options.answerSpaceMm)}mm"></div></div>`,
      );
    }
  }
  rows.push('</section>');
  return rows.join('');
}

/** 完整的试卷 HTML 文档 */
export function renderPaperHtml(input: {
  sections: PaperRenderSection[];
  options: PaperRenderOptions;
  katexHref: string;
}): string {
  const { sections } = input;
  const options = input.options;
  const pageSize = `${options.size} ${options.orientation}`;
  const body: string[] = [];

  body.push('<div class="paper">');
  if (options.withSeal) {
    body.push(
      `<div class="seal"><div class="seal__text">学校：__________　班级：__________　姓名：__________　考号：__________</div><div class="seal__line">密 封 线 内 不 要 答 题</div></div>`,
    );
  }
  body.push('<header class="head">');
  body.push(`<div class="head__site">${esc(options.siteName)}</div>`);
  body.push(`<h1 class="head__title">${esc(options.title)}</h1>`);
  body.push(
    `<div class="head__meta">（满分 ${options.totalScore} 分　考试时间 ${options.durationMinutes} 分钟　共 ${sections.reduce((s, x) => s + x.questions.length, 0)} 小题）</div>`,
  );
  body.push(
    '<table class="head__info"><tbody><tr><td>班级：</td><td class="u"></td><td>姓名：</td><td class="u"></td><td>学号：</td><td class="u"></td><td>得分：</td><td class="u"></td></tr></tbody></table>',
  );
  body.push('</header>');

  const columns = options.columns === 2 ? ' paper__body--cols' : '';
  body.push(`<div class="paper__body${columns}">`);
  sections.forEach((section, index) => {
    const count = section.questions.length;
    const total = section.questions.reduce((s, q) => s + (q.score > 0 ? q.score : 0), 0);
    const per = section.score > 0 ? section.score : count > 0 && total > 0 ? total / count : 0;
    const label = section.name || `${CN_NUM[index] ?? index + 1}、${TYPE_LABEL[section.type] ?? section.type}`;
    body.push('<section class="section">');
    body.push(
      `<h2 class="section__title">${esc(label)}<span class="section__meta">（本大题共 ${count} 小题${per > 0 ? `，每小题 ${round1(per)} 分，共 ${round1(per * count)} 分` : ''}）</span></h2>`,
    );
    for (const question of section.questions) {
      body.push(renderQuestion(question, options, section.type));
    }
    body.push('</section>');
  });
  body.push('</div>');
  body.push('</div>');

  if (options.withAnswerSheet) body.push(renderAnswerSheet(sections, options));

  const printScript = options.autoPrint
    ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},300);});</script>'
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<link rel="stylesheet" href="${esc(input.katexHref)}">
<style>
  @page { size: ${pageSize}; margin: ${options.withSeal ? '14mm 12mm 14mm 26mm' : '14mm 12mm'}; }
  :root { --line: #333; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #000; background: #fff;
    font-family: "Songti SC", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", serif;
    font-size: 10.5pt; line-height: 1.7;
  }
  .paper { width: 100%; max-width: 100%; }
  .paper__body--cols { column-count: 2; column-gap: 10mm; column-rule: 1px dashed #bbb; }
  .paper__body--cols .q { break-inside: avoid; }
  .head { text-align: center; margin-bottom: 4mm; }
  .head__site { font-size: 9pt; color: #444; letter-spacing: 2px; }
  .head__title { font-size: 15pt; margin: 2mm 0 1mm; letter-spacing: 1px; }
  .head__meta { font-size: 9.5pt; color: #333; }
  .head__info { width: 100%; margin-top: 3mm; border-collapse: collapse; font-size: 10pt; }
  .head__info td { padding: 1mm 1mm; }
  .head__info td.u { border-bottom: 1px solid var(--line); min-width: 22mm; }
  .section { margin-top: 4mm; }
  .section__title { font-size: 11.5pt; margin: 0 0 2mm; }
  .section__meta { font-size: 9.5pt; font-weight: normal; color: #333; }
  .q { margin: 0 0 3mm; break-inside: avoid; }
  .q__head { display: block; }
  .q__no { font-weight: bold; margin-right: 2px; }
  .q__score { color: #444; font-size: 9.5pt; }
  .q__options { display: flex; flex-wrap: wrap; gap: 3mm 8mm; margin: 1mm 0 0 5mm; }
  .opt { min-width: 34mm; }
  .q__answer-lines .line { border-bottom: 1px solid var(--line); height: 7mm; margin: 2mm 0 0 5mm; }
  .q__answer-space { border: 1px dashed #bbb; margin: 2mm 0 0 5mm; }
  .q__answer { margin: 1.5mm 0 0 5mm; padding: 1.5mm 2mm; border-left: 3px solid #666; background: #f7f7f7; font-size: 10pt; }
  .q__answer-label { font-weight: bold; }
  .q__analysis { margin-top: 1mm; color: #222; }
  .pimg { max-width: 70%; max-height: 45mm; vertical-align: middle; }
  .katex { font-size: 1.02em; }
  .page-break { break-before: page; }
  .sheet { margin-top: 6mm; font-size: 10pt; }
  .sheet__title { text-align: center; font-size: 14pt; margin: 0 0 2mm; }
  .sheet__info { text-align: center; margin-bottom: 3mm; }
  .sheet__sub { font-size: 11pt; margin: 3mm 0 1.5mm; }
  .sheet__table { width: 100%; border-collapse: collapse; }
  .sheet__table th, .sheet__table td { border: 1px solid var(--line); padding: 1mm 2mm; }
  .bubble { display: inline-block; width: 5.5mm; height: 5.5mm; line-height: 5.5mm; text-align: center; border: 1px solid var(--line); border-radius: 1mm; margin-right: 1.5mm; }
  .sheet__blank { margin: 2mm 0; }
  .sheet__blank-no { font-weight: bold; }
  .sheet__blank-box { border: 1px dashed #999; margin-top: 1mm; }
  .seal { position: fixed; left: 4mm; top: 0; bottom: 0; width: 14mm; border-right: 1px dashed var(--line); }
  .seal__text { writing-mode: vertical-rl; font-size: 9pt; margin-top: 20mm; letter-spacing: 1px; }
  .seal__line { position: absolute; bottom: 20mm; left: 3mm; writing-mode: vertical-rl; font-size: 9pt; color: #444; }
  @media screen { body { background: #f5f5f5; } .paper { background: #fff; margin: 8mm auto; padding: 10mm; max-width: ${options.size === 'A3' ? '420mm' : '210mm'}; box-shadow: 0 1px 6px rgb(0 0 0 / 15%); } }
</style>
</head>
<body>
${body.join('\n')}
${printScript}
</body>
</html>`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 把「按题型分组」的结果转成试卷大题（题号跨大题连续） */
export function buildSections(
  groups: { type: string; label?: string; score: number; questions: Omit<PaperRenderQuestion, 'no'>[] }[],
): PaperRenderSection[] {
  let no = 0;
  return groups.map((group, index) => ({
    name: group.label ?? `${CN_NUM[index] ?? index + 1}、${TYPE_LABEL[group.type] ?? group.type}`,
    type: group.type,
    score: group.score,
    questions: group.questions.map((question) => {
      no += 1;
      return { ...question, no };
    }),
  }));
}
