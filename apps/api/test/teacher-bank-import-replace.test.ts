/**
 * 「教师版题库」覆盖语义：命中已有题库时先删旧题再插新题，重复导入幂等。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTeacherBankImport } from '../src/services/teacherBankImportService.js';
import {
  BOOK,
  CHAPTER,
  SECTION_A,
  createTeacherBankFixture,
  type TeacherBankFixture,
} from './helpers/teacherBankFixture.js';

const OLD_BANK_ID = 5;

let fx: TeacherBankFixture;

beforeAll(() => {
  fx = createTeacherBankFixture();
  // 模拟上一轮导入留下的题库（section = 章节、题库名末段 = 小节 → 应被命中覆盖）
  fx.db.run('INSERT INTO banks (id, name, kind, subject, book, section, course_id) VALUES (?,?,?,?,?,?,?)', [
    OLD_BANK_ID,
    `${CHAPTER} · ${SECTION_A}`,
    'chapter',
    '数学',
    BOOK,
    CHAPTER,
    1,
  ]);
  fx.db.run('INSERT INTO questions (bank_id, type, stem, answer, sort) VALUES (?,?,?,?,?)', [
    OLD_BANK_ID,
    'single',
    '旧题（应被删除）',
    '0',
    0,
  ]);
  fx.db.run('UPDATE banks SET question_count = 1 WHERE id = ?', [OLD_BANK_ID]);
});

afterAll(() => {
  fx.cleanup();
});

describe('整库覆盖', () => {
  it('命中的题库先删除全部旧题，再写入该小节的新题', () => {
    const report = runTeacherBankImport(fx.db, fx.media, { subject: '数学', book: BOOK, sourceDir: fx.sourceRoot });
    expect(report.banksMatched).toBe(1);
    expect(report.banksCreated).toBe(1);
    expect(report.imported).toBe(4);
    expect(report.samples.map((sample) => sample.action)).toEqual(['replace', 'create']);

    const rows = fx.db.all<{ stem: string; source_id: string }>(
      'SELECT stem, source_id FROM questions WHERE bank_id = ? ORDER BY sort',
      [OLD_BANK_ID],
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.stem === '旧题（应被删除）')).toBe(false);
    expect(rows.map((row) => row.source_id)).toEqual(['511916', '511917']);
    expect(
      fx.db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [OLD_BANK_ID]),
    ).toMatchObject({ question_count: 2 });
  });

  it('重复导入幂等：题量与题库/文件夹数量都不变', () => {
    const before = {
      questions: fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c,
      banks: fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM banks')?.c,
      folders: fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bank_folders')?.c,
    };
    const report = runTeacherBankImport(fx.db, fx.media, { subject: '数学', book: BOOK, sourceDir: fx.sourceRoot });
    expect(report.banksMatched).toBe(2);
    expect(report.banksCreated).toBe(0);
    expect(report.imported).toBe(4);
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c).toBe(before.questions);
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM banks')?.c).toBe(before.banks);
    expect(fx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bank_folders')?.c).toBe(before.folders);
  });
});
