/**
 * PG 集成测试（收尾批次）：5 个最后迁到 AsyncDb 的仓储在**真 PG** 上的行为。
 *
 * 覆盖 `QuestionConflictRepository` / `QuestionGroupRepository` / `KnowledgeRepository` /
 * `TagRepository` / `BankFolderRepository`，以及它们带进来的方言点：
 *   - #19 `unixepoch()` → `nowSeconds`（台账 updated_at / last_sync_at 是整数秒）
 *   - #22 `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`（题目标签）
 *   - #26 `datetime('now')` → `nowText`（题组时间列）
 *   - #27 `parent_id IS ?` → `IS NOT DISTINCT FROM`（文件夹同级查找/排序）
 *   - #28 `rowid` → `question_id`（题组成员顺序的兜底键）
 *   - #6/#8 citext + `LOWER() LIKE LOWER()`（标签重名与搜索）
 *   - #17 int8 → number（计数、id、水位）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/db/pg/pool.js';
import type { AsyncDb } from '../src/db/async.js';
import { BankRepository } from '../src/db/repositories/bankRepository.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import { QuestionConflictRepository } from '../src/db/repositories/questionConflictRepository.js';
import { QuestionGroupRepository } from '../src/db/repositories/questionGroupRepository.js';
import { KnowledgeRepository } from '../src/db/repositories/knowledgeRepository.js';
import { TagRepository } from '../src/db/repositories/tagRepository.js';
import { BankFolderRepository } from '../src/db/repositories/bankFolderQueries.js';
import { closePg, pgEnabled, resetPgSchema } from './helpers/pgTestDb.js';

describe.skipIf(!pgEnabled)('PG 收尾批次仓储', () => {
  let db: AsyncDb;
  let questions: QuestionRepository;
  let banks: BankRepository;
  let conflicts: QuestionConflictRepository;
  let groups: QuestionGroupRepository;
  let knowledge: KnowledgeRepository;
  let tags: TagRepository;
  let folders: BankFolderRepository;
  let courseId = 0;
  let lessonId = 0;
  let bankId = 0;
  let q1 = 0;
  let q2 = 0;

  beforeAll(async () => {
    db = await resetPgSchema();
    banks = new BankRepository(null, db);
    questions = new QuestionRepository(null, db);
    conflicts = new QuestionConflictRepository(db);
    groups = new QuestionGroupRepository(db);
    knowledge = new KnowledgeRepository(db);
    tags = new TagRepository(db);
    folders = new BankFolderRepository(db);

    const course = await db.get<{ id: number | string }>('INSERT INTO courses (name) VALUES (?) RETURNING id', [
      '收尾课程',
    ]);
    courseId = Number(course?.id ?? 0);
    const lesson = await db.get<{ id: number | string }>(
      'INSERT INTO lessons (title, video_kind, video_path, course_id) VALUES (?,?,?,?) RETURNING id',
      ['收尾课时', 'local', 'a.mp4', courseId],
    );
    lessonId = Number(lesson?.id ?? 0);
    bankId = await banks.create({ name: '收尾题库', kind: 'chapter', courseId });
    q1 = await questions.create({ bankId, type: 'single', stem: '同题', options: ['A', 'B'], answer: 'A' });
    q2 = await questions.create({ bankId, type: 'single', stem: '变式', options: ['A', 'B'], answer: 'A' });
  });

  afterAll(async () => {
    await closePg(db);
  });

  describe('QuestionConflictRepository：台账扫描 + 复核（#19 nowSeconds）', () => {
    it('sync 扫出「同题不同答案」并落台账；已核对组被打回 pending', async () => {
      // 两个题同一 content_hash、答案不同 → 冲突组
      await questions.create({
        bankId,
        type: 'single',
        stem: '冲突题',
        options: ['A', 'B'],
        answer: 'A',
        contentHash: 'h-conflict',
      });
      await questions.create({
        bankId,
        type: 'single',
        stem: '冲突题',
        options: ['A', 'B'],
        answer: 'B',
        contentHash: 'h-conflict',
      });

      const first = await conflicts.sync();
      expect(first.scanned).toBeGreaterThanOrEqual(1);
      expect(first.inserted).toBeGreaterThanOrEqual(1);

      const page = await conflicts.list({ status: 'all' });
      const group = page.items.find((row) => row.content_hash === 'h-conflict');
      expect(group).toBeDefined();
      expect(group?.group_size).toBe(2);
      expect(group?.answer_count).toBe(2); // COUNT(DISTINCT answer)：A / B 两种答案
      expect(typeof group?.updated_at).toBe('number');
      // 列表一次查回本页各组的答案分布
      const answers = page.answers.get('h-conflict') ?? [];
      expect(answers.map((a) => a.answer).sort()).toEqual(['A', 'B']);
      expect(answers.every((a) => typeof a.n === 'number' && typeof a.first_id === 'number')).toBe(true);

      // 记复核结论 → status 变更，updated_at 是整数秒（#19）
      await conflicts.upsertStatus('h-conflict', 'resolved', 'A', { id: 1, name: '老师' }, { groupSize: 2 });
      const resolved = await conflicts.find('h-conflict');
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.chosen_answer).toBe('A');
      expect(typeof resolved?.updated_at).toBe('number');
      expect(resolved?.updated_at).toBeGreaterThan(1_600_000_000);

      // 再扫一次：仍是冲突（题目没改）→ resolved 被打回 pending 重新提示
      await conflicts.sync();
      expect((await conflicts.find('h-conflict'))?.status).toBe('pending');

      const counts = await conflicts.counts();
      expect(typeof counts.total).toBe('number');
      expect(counts.pending).toBeGreaterThanOrEqual(1);

      const staleness = await conflicts.staleness();
      expect(staleness.stale).toBe(false); // 刚扫过、水位一致
    });

    it('questions / answers / answersFor 读得到题目与答案分布', async () => {
      const rows = await conflicts.questions('h-conflict');
      expect(rows.length).toBe(2);
      expect(rows.every((r) => typeof r.id === 'number' && typeof r.bank_id === 'number')).toBe(true);
      expect(rows.every((r) => r.bank_name === '收尾题库')).toBe(true);

      const answers = await conflicts.answers('h-conflict');
      expect(answers.map((a) => a.answer).sort()).toEqual(['A', 'B']);

      const bulk = await conflicts.answersFor(['h-conflict']);
      expect(bulk.get('h-conflict')?.length).toBe(2);
    });
  });

  describe('QuestionGroupRepository：RETURNING id / nowText / 行序（#14 #26 #28）', () => {
    it('create → 列表带角色计数；加题后 items 母题在前、updated_at 刷新', async () => {
      const id = await groups.create('PG 题组', '备注', 7);
      expect(id).toBeGreaterThan(0);

      const found = await groups.findById(id);
      expect(found?.title).toBe('PG 题组');
      expect(typeof found?.id).toBe('number');
      expect(found?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); // nowText 文本口径

      await groups.upsertItem(id, q1, 'variant', 1);
      await groups.upsertItem(id, q2, 'stem', 0);
      await groups.touch(id);

      const items = await groups.items(id);
      expect(items.map((i) => i.id)).toEqual([q2, q1]); // 母题在前
      expect(items.every((i) => typeof i.sort === 'number')).toBe(true);

      const list = await groups.list('PG');
      const row = list.find((g) => g.id === id);
      expect(row?.stemCount).toBe(1);
      expect(row?.variantCount).toBe(1);
      expect(row?.total).toBe(2);
      expect((await groups.itemRoles(id)).get(q2)).toBe('stem');
      expect(await groups.countItems(id)).toBe(2);
      expect(await groups.nextSort(id)).toBe(2);
      expect(await groups.questionExists(q1)).toBe(true);

      const ofQuestion = await groups.groupsOfQuestion(q1);
      expect(ofQuestion[0]?.title).toBe('PG 题组');
      expect(await groups.removeItem(id, q1)).toBe(1);
      await groups.remove(id);
      expect(await groups.findById(id)).toBeUndefined();
    });
  });

  describe('KnowledgeRepository：RETURNING id / createMany 事务（#14）', () => {
    it('课时级增删改查 + maxSort / existsTextTitle', async () => {
      const id = await knowledge.create({ lessonId, title: 'PG 知识点', kind: 'text', content: '正文', sort: 1 });
      expect(id).toBeGreaterThan(0);
      const row = await knowledge.findById(id);
      expect(row?.title).toBe('PG 知识点');
      expect(typeof row?.id).toBe('number');
      expect(typeof row?.sort).toBe('number');
      expect(await knowledge.existsTextTitle({ lessonId }, 'PG 知识点')).toBe(true);
      expect(await knowledge.existsTextTitle({ lessonId }, '没有这个')).toBe(false);
      expect(await knowledge.maxSort({ lessonId })).toBe(1);

      await knowledge.update(id, { title: 'PG 知识点（改）', content: '新正文' });
      expect((await knowledge.findById(id))?.title).toBe('PG 知识点（改）');
      expect((await knowledge.listByLesson(lessonId)).length).toBe(1);

      await knowledge.delete(id);
      expect(await knowledge.findById(id)).toBeUndefined();
    });

    it('createMany 同一事务写入；课程级与课时级互不串', async () => {
      const ids = await knowledge.createMany([
        { lessonId, title: '批量一', kind: 'text', content: 'a' },
        { lessonId, title: '批量二', kind: 'text', content: 'b', sort: 2 },
        { courseId, title: '课程级', kind: 'text', content: 'c' },
      ]);
      expect(ids.length).toBe(3);
      expect(ids.every((n) => n > 0)).toBe(true);
      expect((await knowledge.listByLesson(lessonId)).length).toBe(2);
      expect((await knowledge.listByCourse(courseId)).length).toBe(1);
    });
  });

  describe('TagRepository：citext 重名 / ON CONFLICT DO NOTHING / likeCI（#6 #8 #22）', () => {
    it('同名（大小写不同）被认出；列表带题目数', async () => {
      const id = await tags.create({ name: 'Java', note: '语言', createdBy: 1 });
      expect(id).toBeGreaterThan(0);
      const dup = await tags.findByName('java');
      expect(dup?.id).toBe(id); // citext：大小写不敏感
      const found = await tags.findById(id);
      expect(found?.name).toBe('Java');
      expect(typeof found?.id).toBe('number');

      await tags.setQuestionTags(q1, [id, id]);
      expect(await tags.countQuestions(id)).toBe(1); // 去重插入
      const list = await tags.list('jav'); // LOWER() LIKE LOWER()：大小写不敏感搜索
      expect(list[0]?.questionCount).toBe(1);
      expect(typeof list[0]?.questionCount).toBe('number');

      const ofQuestion = await tags.tagsOfQuestion(q1);
      expect(ofQuestion.map((t) => t.name)).toEqual(['Java']);
      expect(await tags.existingTagIds([id, 999999])).toEqual([id]);
      expect(await tags.existingQuestionIds([q1, 999999])).toEqual([q1]);
      expect((await tags.tagIdsOfQuestions([q1])).get(q1)).toEqual([id]);
    });

    it('batch 三种语义：add 去重计数、remove 只删指定、replace 覆盖', async () => {
      const a = await tags.create({ name: '易错', note: '', createdBy: 1 });
      const b = await tags.create({ name: '高考真题', note: '', createdBy: 1 });
      await tags.setQuestionTags(q1, []); // 上个用例给 q1 打过 Java，这里从空开始

      expect(await tags.batch([q1], [a], 'add')).toBe(1);
      expect(await tags.batch([q1], [a], 'add')).toBe(0); // 已存在 → 无变更
      expect((await tags.tagIdsOfQuestions([q1])).get(q1)?.sort()).toEqual([a].sort());

      expect(await tags.batch([q1], [b], 'add')).toBe(1);
      expect(await tags.batch([q1], [a], 'remove')).toBe(1);
      expect((await tags.tagIdsOfQuestions([q1])).get(q1)).toEqual([b]);

      expect(await tags.batch([q1], [a, b], 'replace')).toBe(1);
      expect((await tags.tagIdsOfQuestions([q1])).get(q1)?.sort()).toEqual([a, b].sort());
      // replace 成空 = 清空
      expect(await tags.batch([q1], [], 'replace')).toBe(1);
      expect((await tags.tagIdsOfQuestions([q1])).get(q1)).toBeUndefined();

      const renamed = await tags.findById(a);
      await tags.update(a, { name: '易错（改）', note: 'x', createdBy: renamed?.created_by ?? 1 });
      expect((await tags.findById(a))?.name).toBe('易错（改）');
      await tags.remove(b);
      expect(await tags.findById(b)).toBeUndefined();
    });
  });

  describe('BankFolderRepository：IS NOT DISTINCT FROM / int8 / 汇总（#27 #17）', () => {
    it('顶层（parent_id NULL）与子级都能正确查同级同名与末尾 sort', async () => {
      const root = await folders.insert(null, '根目录', 0);
      expect(root.id).toBeGreaterThan(0);
      expect(root.parent_id).toBeNull();
      const child = await folders.insert(root.id, '子目录', 0);
      expect(child.parent_id).toBe(root.id);

      // NULL 安全等值：parent_id IS NOT DISTINCT FROM NULL
      expect((await folders.findByParentAndName(null, '根目录'))?.id).toBe(root.id);
      expect((await folders.findByParentAndName(root.id, '子目录'))?.id).toBe(child.id);
      expect(await folders.findByParentAndName(root.id, '根目录')).toBeUndefined();

      expect(await folders.nextSort(null)).toBe(1);
      expect(await folders.nextSort(root.id)).toBe(1);
      expect(await folders.childCount(root.id)).toBe(1);
      expect(await folders.bankCount(root.id)).toBe(0);

      const renamed = await folders.update(child.id, { name: '子目录（改）', parentId: root.id, sort: 5 });
      expect(renamed.name).toBe('子目录（改）');
      expect(renamed.sort).toBe(5);
      const all = await folders.all();
      expect(all.map((f) => f.id)).toContain(root.id);
      expect(all.every((f) => typeof f.sort === 'number')).toBe(true);
    });

    it('directCounts / unfiled / courseSummary 的计数是 number', async () => {
      const folder = await folders.insert(null, '归类目录', 3);
      await banks.update(bankId, { name: '收尾题库', folderId: folder.id, courseId });
      await banks.create({ name: '未分类题库', kind: 'chapter' }); // folder_id NULL / course_id NULL

      const direct = await folders.directCounts();
      expect(direct.find((d) => d.folderId === folder.id)?.bankCount).toBe(1);
      expect(direct.every((d) => typeof d.questionCount === 'number')).toBe(true);

      const unfiled = await folders.unfiled();
      expect(unfiled.bankCount).toBeGreaterThanOrEqual(1);
      expect(typeof unfiled.questionCount).toBe('number');

      const summary = await folders.courseSummary();
      const course = summary.courses.find((c) => c.courseId === courseId);
      expect(course?.bankCount).toBe(1);
      expect(typeof course?.questionCount).toBe('number');
      expect(typeof summary.unbound.bankCount).toBe('number');

      expect(await folders.bankCount(folder.id)).toBe(1);
      await folders.remove(folder.id);
      expect(await folders.findById(folder.id)).toBeUndefined();
    });
  });
});
