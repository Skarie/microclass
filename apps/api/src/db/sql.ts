/**
 * 跨库 SQL 片段（SQLite / PostgreSQL 都能跑）。
 *
 * 为什么不直接写 `ILIKE`：SQLite 没有 ILIKE；也不能只写 `LIKE` —— SQLite 的 LIKE 对 ASCII
 * 默认大小写不敏感、PostgreSQL 的 LIKE 区分大小写，迁移后搜索会「明明有却搜不到」。
 * 用 `LOWER(列) LIKE LOWER(?)` 两边语义一致（中文不受影响，ASCII 大小写不敏感）。
 */

/** 大小写不敏感的关键字匹配（占位符仍是 `?`，由 AsyncDb 负责翻译成 `$n`） */
export function likeCI(column: string): string {
  return `LOWER(${column}) LIKE LOWER(?)`;
}
