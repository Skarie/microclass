/**
 * 「教师版题库」整册覆盖导入的数据访问：课程定位、题库候选、文件夹归属、
 * 题库内的题目整批替换。
 *
 * 与既有仓储一样是**无业务规则**的取数与写入；匹配规则在
 * `domain/teacherBankMatch`，编排在 `services/teacherBankImportService`。
 */
import type { Db } from '../client.js';
import type { QuestionInput } from './question-types.js';
import { withBusyRetry } from './question-write.js';
import { bookKeyOfCourseName, normalizeBookKey } from './bankNaming.js';
import type { TeacherBankCandidate } from '../../domain/teacherBankMatch.js';

export interface TeacherCourseRow {
  id: number;
  name: string;
}

/** 导入用的题目行：比通用 `QuestionInput` 少 `bankId`（由写入方法给），多一个难度分 */
export type TeacherQuestionRow = Omit<QuestionInput, 'bankId'> & { difficultyScore: number };

export interface NewTeacherBankInput {
  name: string;
  subject: string;
  book: string;
  section: string;
  courseId: number;
  folderId: number | null;
}

/** 按「学科 + 册次」找课程：册次按 `normalizeBookKey` 归一化后比较，学科按课程名包含判断 */
export function findTeacherCourse(db: Db, subject: string, book: string): TeacherCourseRow | null {
  const wanted = normalizeBookKey(book);
  if (wanted === '') return null;
  const subjectKey = String(subject ?? '').trim();
  const rows = db.all<TeacherCourseRow>('SELECT id, name FROM courses ORDER BY id');
  const hit = rows.find(
    (row) =>
      normalizeBookKey(bookKeyOfCourseName(row.name)) === wanted &&
      (subjectKey === '' || row.name.includes(subjectKey)),
  );
  return hit ?? null;
}

export class TeacherBankRepository {
  constructor(private readonly db: Db) {}

  /** 该课程下的题库（匹配只看这些，避免串到别的册次） */
  candidates(courseId: number): TeacherBankCandidate[] {
    return this.db.all<TeacherBankCandidate>('SELECT id, name, section FROM banks WHERE course_id = ? ORDER BY id', [
      courseId,
    ]);
  }

  /**
   * 按层级建文件夹（年级 / 册次 / 章节），返回最深一级 id。
   * 同名同级已存在就复用（重复导入不会堆文件夹）。
   */
  ensureFolderPath(names: readonly string[]): number | null {
    let parentId: number | null = null;
    for (const raw of names) {
      const name = String(raw ?? '').trim();
      if (name === '') continue;
      const found = this.findChildFolder(parentId, name);
      if (found !== null) {
        parentId = found;
        continue;
      }
      parentId = this.db.run('INSERT INTO bank_folders (parent_id, name, sort) VALUES (?,?,?)', [
        parentId,
        name,
        this.nextFolderSort(parentId),
      ]).lastInsertRowid;
    }
    return parentId;
  }

  /** 同级同名文件夹 id（`parent_id` 可为 NULL） */
  private findChildFolder(parentId: number | null, name: string): number | null {
    const row = this.db.get<{ id: number }>(
      'SELECT id FROM bank_folders WHERE parent_id IS ? AND name = ? ORDER BY id LIMIT 1',
      [parentId, name],
    );
    return row?.id ?? null;
  }

  /** 同级末尾的 sort（空目录返回 0） */
  private nextFolderSort(parentId: number | null): number {
    return (
      this.db.get<{ s: number }>('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM bank_folders WHERE parent_id IS ?', [
        parentId,
      ])?.s ?? 0
    );
  }

  /** 新建章节题库（kind=chapter，不挂课时） */
  createBank(input: NewTeacherBankInput): number {
    return this.db.run(
      `INSERT INTO banks (name, kind, subject, book, section, course_id, folder_id)
       VALUES (?, 'chapter', ?, ?, ?, ?, ?)`,
      [input.name, input.subject, input.book, input.section, input.courseId, input.folderId],
    ).lastInsertRowid;
  }

  /** 题库当前题量 */
  questionCount(bankId: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [bankId])?.c ?? 0;
  }

  /**
   * 整库覆盖：同一事务里「删旧题 + 插新题 + 重算题量」，
   * 中途失败整体回滚，不会留下半新半旧的题库。
   * 注意：`questions` 上的外键是 ON DELETE CASCADE，删题会同时把题从已组好的试卷
   * （`exam_questions`）与错题本里移出 —— 这正是「以新数据为准」的预期语义。
   */
  replaceBankQuestions(bankId: number, inputs: readonly TeacherQuestionRow[]): number {
    return this.writeQuestions(bankId, inputs, true);
  }

  /** 只插入（新建题库用） */
  insertBankQuestions(bankId: number, inputs: readonly TeacherQuestionRow[]): number {
    return this.writeQuestions(bankId, inputs, false);
  }

  private writeQuestions(bankId: number, inputs: readonly TeacherQuestionRow[], replace: boolean): number {
    if (inputs.length === 0) return 0;
    let inserted = 0;
    withBusyRetry(() =>
      this.db.transaction(() => {
        inserted = 0;
        if (replace) this.db.run('DELETE FROM questions WHERE bank_id = ?', [bankId]);
        for (const input of inputs) {
          this.insertRow(bankId, input);
          inserted += 1;
        }
        this.db.run(
          'UPDATE banks SET question_count = (SELECT COUNT(*) FROM questions WHERE bank_id = ?) WHERE id = ?',
          [bankId, bankId],
        );
      }),
    );
    return inserted;
  }

  /**
   * 单题写入。列清单与 `question-write.createQuestion` 保持一致，另加
   * `source_id`（迁移 0027）与 `difficulty_score`（迁移 0016）；
   * 批量导入不走逐题 `bumpBankCount`，题量在批次末尾重算一次。
   */
  private insertRow(bankId: number, input: TeacherQuestionRow): void {
    this.db.run(
      `INSERT INTO questions
         (bank_id, lesson_id, type, stem, image_path, options, answer, analysis, sort, difficulty,
          difficulty_score, subject, stage, book, chapter, section, point, source_path, source_no, source_id,
          content_hash, has_image, analysis_media_only)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        bankId,
        input.lessonId ?? null,
        input.type,
        input.stem,
        input.imagePath ?? '',
        JSON.stringify(input.options),
        input.answer,
        input.analysis ?? '',
        input.sort ?? 0,
        input.difficulty ?? '',
        input.difficultyScore,
        input.subject ?? '',
        input.stage ?? '',
        input.book ?? '',
        input.chapter ?? '',
        input.section ?? '',
        input.point ?? '',
        input.sourcePath ?? '',
        input.sourceNo ?? '',
        input.sourceId ?? '',
        input.contentHash ?? '',
        input.hasImage ? 1 : 0,
        input.analysisMediaOnly ? 1 : 0,
      ],
    );
  }
}
