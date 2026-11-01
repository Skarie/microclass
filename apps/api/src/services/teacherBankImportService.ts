/**
 * 「教师版题库」整册覆盖导入（可复用服务，CLI 与测试共用）。
 *
 * 语义：**以新数据为准**。命中的题库先删掉全部旧题、再写入该小节的所有新题
 * （同一事务，失败回滚）；没有命中就按「年级 / 册次 / 章节」新建章节题库。
 * 重复导入是幂等的：新建的题库下一轮会被「section + 题目名末段」命中并覆盖，题量不会翻倍。
 *
 * dry-run 只读：不写库、也不落题图文件，统计口径与正式导入一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client.js';
import {
  TeacherBankRepository,
  findTeacherCourse,
  type TeacherQuestionRow,
} from '../db/repositories/teacherBankQueries.js';
import { parseGrade } from '../domain/bankFolderGrouping.js';
import { inferStage } from '../domain/difficulty.js';
import { hasMediaOnlyAnalysis, hasQuestionImage, questionFingerprint } from '../domain/question.js';
import {
  difficultyLabelFromScore,
  difficultyScoreFrom01,
  matchTeacherBank,
  teacherBankName,
} from '../domain/teacherBankMatch.js';
import { isKnownTeacherTypeLabel, parseTeacherBankMarkdown } from '../domain/teacherBankParse.js';
import type { TeacherQuestionDraft } from '../domain/teacherBankTypes.js';
import { TeacherImageResolver, rewriteTeacherImageRefs } from './teacherBankImages.js';
import type { TeacherBankImportInput, TeacherBankImportReport } from './teacherBankImportTypes.js';
import { resolveTeacherBookRoot, scanTeacherBankSections } from './teacherBankScan.js';
import type { QuestionMediaStore } from './questionMediaStore.js';

/** 题面里的题图 URL（取第一张写 `image_path`，旧视图与 Word 导出按它取图） */
const MEDIA_URL = /!\[[^\]]*\]\((\/api\/v1\/question-media\/[0-9a-f]{40}\.[a-z]+)\)/i;

/** 解析 + AI解析 + 思路/方法/知识点，分段保留（便于老师阅读与按关键字搜索） */
function composeAnalysis(draft: TeacherQuestionDraft): string {
  return [
    draft.analysis,
    draft.thought === '' ? '' : `【解题思路】\n${draft.thought}`,
    draft.method === '' ? '' : `【解题方法】\n${draft.method}`,
    draft.points === '' ? '' : `【相关知识点】\n${draft.points}`,
  ]
    .filter((block) => block !== '')
    .join('\n\n');
}

/** 一个小节的写库上下文 */
interface RowContext {
  subject: string;
  book: string;
  chapter: string;
  section: string;
  relPath: string;
  baseDir: string;
  resolver: TeacherImageResolver;
}

/** 解析结果 → 入库行：改写题图、合并解析、换算难度、算内容指纹 */
function buildRow(draft: TeacherQuestionDraft, index: number, ctx: RowContext): TeacherQuestionRow {
  const rewrite = (text: string): string => rewriteTeacherImageRefs(text, ctx.baseDir, ctx.resolver);
  const stem = rewrite(draft.stem);
  const options = [...draft.options].sort((a, b) => a.no - b.no).map((option) => rewrite(option.content));
  const analysis = rewrite(composeAnalysis(draft));
  const score = difficultyScoreFrom01(draft.difficulty01);
  const firstImage = MEDIA_URL.exec([stem, ...options, analysis].join('\n'))?.[1];
  return {
    type: draft.type,
    stem,
    imagePath: firstImage === undefined ? '' : (ctx.resolver.relPathOf(firstImage) ?? ''),
    options,
    answer: draft.answer,
    analysis,
    sort: index,
    difficulty: difficultyLabelFromScore(score),
    difficultyScore: score,
    subject: ctx.subject,
    stage: inferStage(ctx.book),
    book: ctx.book,
    chapter: ctx.chapter,
    section: ctx.section,
    sourcePath: ctx.relPath,
    sourceId: draft.sourceId,
    contentHash: questionFingerprint(stem, options),
    hasImage: hasQuestionImage(stem, options, analysis),
    analysisMediaOnly: hasMediaOnlyAnalysis(analysis),
  };
}

function initialReport(dryRun: boolean, courseName: string | null): TeacherBankImportReport {
  const report: TeacherBankImportReport = {
    dryRun,
    course: courseName,
    sections: 0,
    banksMatched: 0,
    banksCreated: 0,
    questions: 0,
    questionsWithImages: 0,
    missingImages: 0,
    unknownTypes: 0,
    samples: [],
    unmatchedCourses: [],
  };
  if (!dryRun) report.imported = 0;
  return report;
}

/** 导入一个册次；返回统计报告（dry-run 时 `imported` 不出现） */
export function runTeacherBankImport(
  db: Db,
  media: QuestionMediaStore,
  input: TeacherBankImportInput,
): TeacherBankImportReport {
  const dryRun = input.dryRun === true;
  const course = findTeacherCourse(db, input.subject, input.book);
  const report = initialReport(dryRun, course?.name ?? null);
  if (!course) {
    report.unmatchedCourses.push([input.subject.trim(), input.book.trim()].filter(Boolean).join('·'));
    return report;
  }
  const bookRoot = resolveTeacherBookRoot(input.sourceDir, input.subject, input.book);
  if (bookRoot === null) return report;

  const sources = scanTeacherBankSections(bookRoot);
  report.sections = sources.length;
  const repo = new TeacherBankRepository(db);
  const resolver = new TeacherImageResolver(media, dryRun);
  const maxSamples = Math.max(0, input.maxSamples ?? 20);
  let imported = 0;

  const usedBankIds = new Set<number>();
  for (const source of sources) {
    const doc = parseTeacherBankMarkdown(fs.readFileSync(source.mdPath, 'utf8'));
    const chapter = doc.meta.chapter.trim() || source.chapterDir;
    const section = source.sectionDir.trim() || doc.title;
    const subject = doc.meta.subject.trim() || input.subject.trim();
    const book = doc.meta.book.trim() || input.book.trim();
    report.questions += doc.questions.length;
    report.unknownTypes += doc.questions.filter((q) => !isKnownTeacherTypeLabel(q.typeLabel)).length;
    // 空小节（文件缺失/全部无题干）不动已有题库，避免一次坏数据把整库清空
    if (doc.questions.length === 0) continue;

    const ctx: RowContext = {
      subject,
      book,
      chapter,
      section,
      relPath: source.relPath,
      baseDir: path.dirname(source.mdPath),
      resolver,
    };
    const rows = doc.questions.map((draft, index) => buildRow(draft, index, ctx));
    report.questionsWithImages += rows.filter((row) => row.hasImage === true).length;

    const match = matchTeacherBank(repo.candidates(course.id), chapter, section, usedBankIds);
    let bankId = match.bankId;
    if (match.action === 'replace' && bankId !== null) {
      report.banksMatched += 1;
    } else {
      report.banksCreated += 1;
      if (!dryRun) {
        const folderId = repo.ensureFolderPath([parseGrade(course.name), book, chapter]);
        bankId = repo.createBank({
          name: teacherBankName(chapter, section),
          subject,
          book,
          section: chapter,
          courseId: course.id,
          folderId,
        });
      }
    }
    if (bankId !== null) usedBankIds.add(bankId);
    if (!dryRun && bankId !== null) {
      imported +=
        match.action === 'replace' ? repo.replaceBankQuestions(bankId, rows) : repo.insertBankQuestions(bankId, rows);
    }
    if (report.samples.length < maxSamples) {
      report.samples.push({
        chapter,
        section,
        bankId: dryRun && match.action === 'create' ? null : bankId,
        action: match.action,
        questions: doc.questions.length,
      });
    }
  }

  report.missingImages = resolver.missingCount;
  if (!dryRun) report.imported = imported;
  return report;
}
