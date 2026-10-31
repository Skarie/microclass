/**
 * 「教师版题库」整册覆盖导入服务：dry-run 不写库、正式导入的字段/文件夹/题型映射。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTeacherBankImport } from '../src/services/teacherBankImportService.js';
import {
  BOOK,
  CHAPTER,
  COURSE,
  SECTION_A,
  createTeacherBankFixture,
  type TeacherBankFixture,
} from './helpers/teacherBankFixture.js';

interface QuestionRow {
  id: number;
  type: string;
  stem: string;
  options: string;
  answer: string;
  analysis: string;
  difficulty: string;
  difficulty_score: number;
  chapter: string;
  section: string;
  source_id: string;
  image_path: string;
  has_image: number;
}

let fx: TeacherBankFixture;

beforeAll(() => {
  fx = createTeacherBankFixture();
});

afterAll(() => {
  fx.cleanup();
});

describe('dry-run 只统计不写库', () => {
  it('返回完整报告，但库里没有题库/题目/文件夹，也不落题图', () => {
    const report = runTeacherBankImport(fx.db, fx.media, {
      subject: '数学',
      book: BOOK,
      sourceDir: fx.sourceRoot,
      dryRun: true,
    });
    expect(report).toMatchObject({
      dryRun: true,
      course: COURSE,
      sections: 2,
      banksMatched: 0,
      banksCreated: 2,
      questions: 4,
      questionsWithImages: 1,
      missingImages: 1,
      unknownTypes: 1,
    });
    expect('imported' in report).toBe(false);
    expect(report.samples).toHaveLength(2);
    expect(report.samples[0]).toMatchObject({ chapter: CHAPTER, section: SECTION_A, action: 'create', questions: 2 });
    expect(report.samples[0]?.bankId).toBeNull();
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM banks')?.c).toBe(0);
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c).toBe(0);
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bank_folders')?.c).toBe(0);
    expect(fx.media.stats().files).toBe(0);
  });

  it('课程匹配不到 → 整册跳过并报告', () => {
    const report = runTeacherBankImport(fx.db, fx.media, {
      subject: '化学',
      book: BOOK,
      sourceDir: fx.sourceRoot,
      dryRun: true,
    });
    expect(report.course).toBeNull();
    expect(report.sections).toBe(0);
    expect(report.unmatchedCourses).toEqual([`化学·${BOOK}`]);
  });
});

describe('正式导入', () => {
  let bankA = 0;

  it('新建两个章节题库，写入 4 道题', () => {
    const report = runTeacherBankImport(fx.db, fx.media, {
      subject: '数学',
      book: BOOK,
      sourceDir: fx.sourceRoot,
    });
    expect(report).toMatchObject({
      dryRun: false,
      course: COURSE,
      sections: 2,
      banksMatched: 0,
      banksCreated: 2,
      questions: 4,
      imported: 4,
    });
    expect(report.samples.map((sample) => sample.action)).toEqual(['create', 'create']);
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c).toBe(4);
    bankA = report.samples[0]?.bankId ?? 0;
    expect(bankA).toBeGreaterThan(0);
  });

  it('题目字段：题型/答案/解析合并/难度换算/source_id/配图 URL', () => {
    const rows = fx.db.all<QuestionRow>('SELECT * FROM questions WHERE bank_id = ? ORDER BY sort', [bankA]);
    expect(rows).toHaveLength(2);
    const first = rows[0];
    expect(first?.type).toBe('single');
    expect(first?.source_id).toBe('511916');
    expect(first?.stem).toContain('/api/v1/question-media/');
    expect(first?.image_path).toMatch(/^question-media\/[0-9a-f]{2}\/[0-9a-f]{40}\.png$/);
    expect(first?.has_image).toBe(1);
    expect(JSON.parse(first?.options ?? '[]')).toEqual(['$-2$', '$1$', '$2$', '$5$']);
    expect(first?.answer).toBe('1');
    expect(first?.difficulty).toBe('easy');
    expect(first?.difficulty_score).toBe(36);
    expect(first?.analysis).toContain('向右移动用加法');
    expect(first?.analysis).toContain('【AI 解析】');
    expect(first?.analysis).toContain('【解题思路】');
    expect(first?.analysis).toContain('【相关知识点】');
    expect(first?.chapter).toBe(CHAPTER);
    expect(first?.section).toBe(SECTION_A);
    expect(fx.media.stats().files).toBe(1);
  });

  it('缺图保留原相对路径并计数，不阻断导入', () => {
    const fill = fx.db.get<QuestionRow>('SELECT * FROM questions WHERE source_id = ?', ['511917']);
    expect(fill?.type).toBe('fill');
    expect(fill?.answer).toBe('7；-7');
    expect(fill?.stem).toContain('images/missing.png');
    expect(fill?.has_image).toBe(0);
  });

  it('未知题型归简答题，判断题答案落成 T/F', () => {
    const material = fx.db.get<QuestionRow>('SELECT * FROM questions WHERE source_id = ?', ['511921']);
    expect(material?.type).toBe('short');
    const judge = fx.db.get<QuestionRow>('SELECT * FROM questions WHERE source_id = ?', ['511920']);
    expect(judge?.type).toBe('judge');
    expect(judge?.answer).toBe('F');
  });

  it('新建题库归属「年级 / 册次 / 章节」文件夹，命名「章节 · 小节」', () => {
    const created = fx.db.get<{
      id: number;
      name: string;
      kind: string;
      subject: string;
      book: string;
      section: string;
    }>('SELECT id, name, kind, subject, book, section FROM banks WHERE name LIKE ? LIMIT 1', [`${CHAPTER} · 相反数`]);
    expect(created).toMatchObject({
      name: `${CHAPTER} · 相反数`,
      kind: 'chapter',
      subject: '数学',
      book: BOOK,
      section: CHAPTER,
    });
    const folderPath = fx.db
      .all<{ name: string }>(
        `WITH RECURSIVE up(id, parent_id, name) AS (
           SELECT id, parent_id, name FROM bank_folders WHERE id = (SELECT folder_id FROM banks WHERE id = ?)
           UNION ALL SELECT f.id, f.parent_id, f.name FROM bank_folders f JOIN up ON f.id = up.parent_id
         ) SELECT name FROM up`,
        [created?.id],
      )
      .map((folder) => folder.name);
    expect(folderPath).toEqual([CHAPTER, BOOK, '七年级']);
  });
});
