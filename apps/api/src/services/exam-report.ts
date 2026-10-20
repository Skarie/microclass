/**
 * 考试成绩单 / 打印导出：个人成绩复盘、成绩单与 CSV、可打印试卷 HTML、试卷 Word。
 *
 * 本模块只做「把已有数据渲染成对外结果」，不写库、不碰 Fastify；
 * 需要的数据（考试、卷面、作答行）由 `ExamService` 取好传进来，方便单独验证版式与字段。
 */
import type { Exam, QuestionType, User } from '@microclass/shared';
import type { ExamAttempt } from '../db/repositories/examRepository.js';
import { buildDocx, type DocxBlock, type DocxImage } from '../utils/docx.js';
import { inlineImagesToDocx } from '../utils/questionDocxImages.js';
import { parseOptions } from '../domain/question.js';
import { DEFAULT_PAPER_OPTIONS, buildSections, renderPaperHtml, type PaperRenderOptions } from '../domain/paperHtml.js';
import type { ExamGradedItem, ExamSubmitResult } from './exam-grade.js';
import { cnNumber, parseStructure, TYPE_NAME, type PaperRow } from './exam-paper.js';

/** 题型中文名（试卷导出 Word 用） */
const TYPE_LABEL_CN: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

/** 解析历史作答 JSON，坏数据不至于让接口整体失败 */
export function safeParseResults(raw: string): ExamGradedItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExamGradedItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * 导出试卷 Word（.docx）：版式与题库导出一致，题图内联，可按需带答案解析。
 * 为什么要有它：老师交卷给教研/印刷时常用 Word 二次排版，PDF 打印解决不了这个需求。
 */
export function buildPaperDocx(
  exam: Exam,
  questions: PaperRow[],
  options: { withAnswers?: boolean } | undefined,
  resolveMedia: (file: string) => string | null,
): { filename: string; body: Buffer } {
  const withAnswers = options?.withAnswers !== false;
  const blocks: DocxBlock[] = [
    { type: 'title', text: exam.title },
    {
      type: 'subtitle',
      text: `共 ${questions.length} 题 · 满分 ${Number(exam.total_score ?? 100)} 分 · 限时 ${exam.duration_minutes} 分钟 · 及格 ${exam.pass_score}%`,
    },
  ];
  const images: DocxImage[] = [];

  let lastSection = '';
  questions.forEach((q, i) => {
    const section = String(q.section ?? '');
    if (section !== '' && section !== lastSection) {
      blocks.push({ type: 'heading', text: section });
      lastSection = section;
    }
    blocks.push({
      type: 'heading2',
      text: `${i + 1}. ${TYPE_LABEL_CN[q.type] ?? q.type}（${Number(q.score) || 0} 分）`,
    });
    blocks.push({
      type: 'text',
      text: inlineImagesToDocx(String(q.stem ?? ''), images, (file) => resolveMedia(file)),
    });

    const optionTexts = parseOptions(String(q.options ?? '[]'));
    const isChoice = q.type === 'single' || q.type === 'multiple';
    optionTexts.forEach((opt, oi) => {
      const label = String.fromCharCode(65 + oi);
      blocks.push({
        type: 'option',
        text: `${label}. ${inlineImagesToDocx(opt, images, (file) => resolveMedia(file))}`,
      });
    });
    void isChoice;

    if (withAnswers) {
      blocks.push({ type: 'answer', text: `答案：${String(q.answer ?? '') || '（未录入）'}` });
      const analysis = String(q.analysis ?? '');
      if (analysis.trim() !== '') {
        blocks.push({
          type: 'analysis',
          text: `解析：${inlineImagesToDocx(analysis, images, (file) => resolveMedia(file))}`,
        });
      }
    }
    blocks.push({ type: 'divider', text: '' });
  });

  return { filename: `${exam.title}_试卷.docx`, body: buildDocx({ title: exam.title, blocks, images }) };
}

/**
 * 可打印试卷 HTML（A4/A3、横竖版、双栏、含答案、答题卡、密封线）。
 * 版式与公式排版都在服务端完成，保证任何浏览器「打印 / 另存为 PDF」的结果一致。
 */
export function buildPaperHtml(exam: Exam, rows: PaperRow[], overrides?: Partial<PaperRenderOptions>): string {
  const fallbackScore = rows.length > 0 ? Number(exam.total_score ?? 100) / rows.length : 0;
  const structure = parseStructure(exam.structure);
  const structureByType = new Map(structure.map((s) => [s.type, s]));

  // 卷面按常见顺序分大题：单选 → 多选 → 判断 → 填空 → 解答
  const order: QuestionType[] = ['single', 'multiple', 'judge', 'fill', 'short'];
  const groups: Parameters<typeof buildSections>[0] = [];
  let index = 0;
  for (const type of order) {
    const list = rows.filter((q) => q.type === type);
    if (list.length === 0) continue;
    index += 1;
    const configured = structureByType.get(type);
    groups.push({
      type,
      label: configured?.name || `${cnNumber(index)}、${TYPE_NAME[type] ?? type}`,
      score: configured?.score ?? Number(list[0]?.score ?? 0),
      questions: list.map((q) => ({
        type: q.type as QuestionType,
        stem: q.stem,
        options: parseOptions(q.options),
        answer: q.answer,
        analysis: q.analysis,
        score: Number(q.score) > 0 ? Number(q.score) : Math.round(fallbackScore * 10) / 10,
        difficulty: q.difficulty ?? '',
        point: q.point ?? '',
      })),
    });
  }
  const sections = buildSections(groups);
  return renderPaperHtml({
    sections,
    katexHref: '/api/v1/paper-assets/katex.min.css',
    options: {
      ...DEFAULT_PAPER_OPTIONS,
      title: exam.title,
      durationMinutes: exam.duration_minutes,
      totalScore: Number(exam.total_score ?? 100),
      ...(overrides ?? {}),
    },
  });
}

export type MyResult = ExamSubmitResult & { created_at: number; answersHidden?: boolean };

/** 我的成绩（含逐题结果，便于复盘） */
export function buildMyResult(exam: Exam, attempt: ExamAttempt, paperRows: PaperRow[], viewer: User): MyResult {
  const need = Math.ceil((attempt.total * exam.pass_score) / 100);
  const stored = safeParseResults(attempt.answers);
  // 新数据只存四元组，按（已缓存的）卷面补全题干/选项/解析；老数据本身完整则原样用
  const paperById = new Map(paperRows.map((q) => [q.id, q]));
  const results = stored.map((r) => {
    if (r.stem) return r;
    const q = paperById.get(r.qid);
    if (!q) return r;
    return {
      ...r,
      type: q.type as QuestionType,
      stem: q.stem,
      options: parseOptions(q.options),
      image_path: q.image_path,
      answer: q.answer,
      analysis: q.analysis,
    };
  });
  /**
   * 交卷后是否公布答案解析（学习通里的"答案公布"开关）：
   * 老师/管理员始终能看；学员在 show_answers=0 时只看到得分与是否答对，看不到正确答案与解析。
   * 这样安排是因为"考完先讲评再公布"是常见做法。
   */
  const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
  const hideAnswers = !isManager && Number(exam.show_answers ?? 1) === 0;
  return {
    attemptId: attempt.id,
    score: attempt.score,
    total: attempt.total,
    passed: attempt.passed === 1,
    need,
    usedSeconds: attempt.used_seconds,
    manual: results.filter((r) => r.correct === null).length,
    results: hideAnswers ? results.map((r) => ({ ...r, answer: '', analysis: '' })) : results,
    ...(hideAnswers ? { answersHidden: true } : {}),
    created_at: attempt.created_at,
  };
}

export interface ScoreSheet {
  exam: Exam;
  rows: {
    user_id: number;
    username: string;
    display_name: string;
    score: number;
    total: number;
    passed: 0 | 1;
    used_seconds: number;
    created_at: number;
  }[];
  summary: {
    attempts: number;
    passed: number;
    pass_rate: number;
    avg: number;
    best: number;
    worst: number;
    avg_seconds: number;
  };
}

/** 成绩单：全部学生作答 + 统计（管理端） */
export function buildScoreSheet(
  exam: Exam,
  attempts: (ExamAttempt & { username: string; display_name: string })[],
): ScoreSheet {
  const rows = attempts.map((a) => ({
    user_id: a.user_id,
    username: a.username,
    display_name: a.display_name,
    score: a.score,
    total: a.total,
    passed: a.passed,
    used_seconds: a.used_seconds,
    created_at: a.created_at,
  }));
  const scores = rows.map((r) => r.score);
  const passedCount = rows.filter((r) => r.passed === 1).length;
  const avg = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  const avgSeconds = rows.length > 0 ? Math.round(rows.reduce((a, r) => a + r.used_seconds, 0) / rows.length) : 0;
  return {
    exam,
    rows,
    summary: {
      attempts: rows.length,
      passed: passedCount,
      pass_rate: rows.length > 0 ? Math.round((passedCount / rows.length) * 1000) / 10 : 0,
      avg,
      best: scores.length > 0 ? Math.max(...scores) : 0,
      worst: scores.length > 0 ? Math.min(...scores) : 0,
      avg_seconds: avgSeconds,
    },
  };
}

/** 成绩单 CSV */
export function buildScoreSheetCsv(sheet: ScoreSheet): { filename: string; rows: unknown[][] } {
  const { exam, rows } = sheet;
  return {
    filename: `${exam.title}_成绩单.csv`,
    rows: [
      ['学号', '姓名', '得分', '总分', '是否及格', '用时(秒)', '交卷时间'],
      ...rows.map((r) => [
        r.username,
        r.display_name,
        r.score,
        r.total,
        r.passed === 1 ? '及格' : '不及格',
        r.used_seconds,
        new Date(r.created_at * 1000).toLocaleString('zh-CN'),
      ]),
    ],
  };
}
