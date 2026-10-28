/**
 * 迁移 0025 的数据回填：把旧的 `banks.lesson_id` 绑定转成实践关联。
 *
 * 旧语义是「一个题库只挂一个课时」；新表把课时放进 `practice_link_lessons`，
 * 所以每个有 lesson_id 的题库得到一条 target_type='bank' 的 practice_link，
 * 再挂一条课时关联。幂等：同一个题库已经存在 bank 关联时不再新建，只补课时。
 */
import type { Db } from './client.js';

export interface LegacyLessonLinkResult {
  links: number;
  lessons: number;
}

interface LegacyBankRow {
  id: number;
  lesson_id: number;
}

export function backfillLegacyLessonLinks(db: Db): LegacyLessonLinkResult {
  const rows = db.all<LegacyBankRow>('SELECT id, lesson_id FROM banks WHERE lesson_id IS NOT NULL ORDER BY id');
  let links = 0;
  let lessons = 0;

  for (const row of rows) {
    let linkId = db.get<{ id: number }>(
      "SELECT id FROM practice_links WHERE target_type = 'bank' AND bank_id = ? ORDER BY id LIMIT 1",
      [row.id],
    )?.id;
    if (linkId === undefined) {
      linkId = db.run(
        "INSERT INTO practice_links (target_type, bank_id, question_id, chapter, section) VALUES ('bank', ?, NULL, '', '')",
        [row.id],
      ).lastInsertRowid;
      links += 1;
    }
    lessons += db.run('INSERT OR IGNORE INTO practice_link_lessons (link_id, lesson_id) VALUES (?, ?)', [
      linkId,
      row.lesson_id,
    ]).changes;
  }

  return { links, lessons };
}
