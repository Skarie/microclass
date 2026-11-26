/**
 * 跨库 SQL 片段（SQLite / PostgreSQL 都能跑）。
 *
 * 为什么不直接写 `ILIKE`：SQLite 没有 ILIKE；也不能只写 `LIKE` —— SQLite 的 LIKE 对 ASCII
 * 默认大小写不敏感、PostgreSQL 的 LIKE 区分大小写，迁移后搜索会「明明有却搜不到」。
 * 用 `LOWER(列) LIKE LOWER(?)` 两边语义一致（中文不受影响，ASCII 大小写不敏感）。
 */

import type { DbDriverName } from './async.js';

/** 大小写不敏感的关键字匹配（占位符仍是 `?`，由 AsyncDb 负责翻译成 `$n`） */
export function likeCI(column: string): string {
  return `LOWER(${column}) LIKE LOWER(?)`;
}

/**
 * 「当前 Unix 秒」的方言表达式（方言 #19）。
 *
 * SQLite 有内置 `unixepoch()`，PostgreSQL 没有；两库都产出**整数秒**，
 * 与各表 `INTEGER` 时间戳列的语义保持一致（切流前不需要改数据）。
 * 只用于 SQL 文本里的方言片段（不是参数），调用方按 `AsyncDb.driver` 选择。
 */
export function nowSeconds(driver: DbDriverName): string {
  return driver === 'pg' ? '(EXTRACT(EPOCH FROM now()))::bigint' : 'unixepoch()';
}

/**
 * 学习日历/趋势的「按日」表达式（方言 #21）。
 *
 * SQLite 用 `date(col,'unixepoch'[,'localtime'])` 修饰符语法；PostgreSQL 没有这套修饰符，
 * 用 `to_char(to_timestamp(col) AT TIME ZONE <zone>,'YYYY-MM-DD')` 得到同样的 `YYYY-MM-DD` 文本。
 *
 * `local: true` 是**服务器本地日**口径（学习日历：学生看到的「今天」）；
 * `local: false` 是 **UTC 日**口径（学情分析 trend，与迁移前完全一致）。
 * PG 侧的本地时区固定 `Asia/Shanghai`：生产与用户都在东八区，切流后不依赖容器 TZ。
 */
export function unixDay(column: string, driver: DbDriverName, options: { local?: boolean } = {}): string {
  if (driver === 'pg') {
    const zone = options.local ? PG_LOCAL_DAY_ZONE : 'UTC';
    return `to_char(to_timestamp(${column}) AT TIME ZONE '${zone}','YYYY-MM-DD')`;
  }
  return options.local ? `date(${column}, 'unixepoch', 'localtime')` : `date(${column}, 'unixepoch')`;
}

/** 学习日历的本地时区（与 `activityRepository` 的 `localtime` 口径对应） */
export const PG_LOCAL_DAY_ZONE = 'Asia/Shanghai';

/**
 * 标题的「自然序数字前缀」（方言 #16）。
 *
 * `lessons` 的自然序按标题开头的数字排（`2. xxx` 排在 `10. xxx` 前面，与轻课室的 sort_order 一致）。
 * SQLite 的 `CAST(title AS INTEGER)` 取前导数字、非数字开头得 0；
 * PostgreSQL 的 `CAST` 遇到「第X课」这类非数字串会**直接报错**，所以只能用正则取同样的前导数字：
 * `substring(trim(title) from '^[+-]?[0-9]+')`，取不到时为 NULL，再 `COALESCE(…, 0)` 收敛成 0。
 *
 * 两边结果保持一致（含前导空白与正负号）；只用于 ORDER BY 片段，不参与比较/索引。
 */
export function naturalNumberPrefix(column: string, driver: DbDriverName): string {
  return driver === 'pg'
    ? `COALESCE(NULLIF(substring(trim(${column}) from '^[+-]?[0-9]+'), '')::bigint, 0)`
    : `CAST(${column} AS INTEGER)`;
}

/**
 * 两参取大（方言 #20）。
 *
 * SQLite 的 `MAX(a,b)` 是标量函数；PostgreSQL 的 `MAX` 只有聚合形式，`MAX(a,b)` 直接报错，
 * 必须用 `GREATEST(a,b)`。只用于 upsert 的 `SET cur = MAX(cur, excluded.cur)` 这类写法。
 *
 * 注意 NULL 语义有小差异：SQLite 的标量 `max()` 遇 NULL 返回 NULL，PG 的 `GREATEST` 会忽略 NULL。
 * 当前唯一调用点 `lesson_progress.finished/quiz_best` 由写路径保证非 NULL（列默认 0），
 * 历史脏数据若为 NULL 只在 PG 侧表现为「取到非 NULL 的那个值」，不会写坏数据。
 */
export function maxOf(a: string, b: string, driver: DbDriverName): string {
  return driver === 'pg' ? `GREATEST(${a}, ${b})` : `MAX(${a}, ${b})`;
}

/**
 * 「当前时间」的 UTC 文本（`YYYY-MM-DD HH:MM:SS`）表达式（方言 #26）。
 *
 * SQLite 的 `datetime('now')` 产出 UTC 文本；PG 没有 `datetime()`，
 * 用 `to_char(now() AT TIME ZONE 'utc', …)` 得到同样的文本（与 DDL 生成器的映射规则一致，见 #4）。
 * 时间列在库里是 TEXT，切流前后可直接比较/排序。
 */
export function nowText(driver: DbDriverName): string {
  return driver === 'pg' ? "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')" : "datetime('now')";
}

/**
 * 大小写不敏感的列引用（方言 #6 的运行时一半）。
 *
 * SQLite 的 `COLLATE NOCASE` 是列/表达式级排序规则；PG 没有这个排序规则，
 * `tags.name` 在 PG 里已是 `citext`（见 `ops/scripts/pg/post-schema.pg.sql`），
 * 等值比较与排序天然大小写不敏感，直接写列名即可。
 * 只用于 `tags.name` 这类在 PG 侧已改 citext 的列。
 */
export function nocase(column: string, driver: DbDriverName): string {
  return driver === 'pg' ? column : `${column} COLLATE NOCASE`;
}

/**
 * NULL 安全的等值比较（方言 #27）。
 *
 * SQLite 允许 `parent_id IS ?`（`IS` 可带参数）；PG 的 `IS` 只接受 `NULL` 字面量，
 * 写成 `IS $1` 是语法错误，必须用 `IS NOT DISTINCT FROM`。
 * sqlite 侧保持 `IS ?` 不动（语义相同，执行计划不变）。
 */
export function nullSafeEq(column: string, driver: DbDriverName): string {
  return driver === 'pg' ? `${column} IS NOT DISTINCT FROM ?` : `${column} IS ?`;
}

/**
 * 「插入顺序」兜底列（方言 #28）。
 *
 * `question_group_items` 没有自增 id，SQLite 用隐式 `rowid` 做同 sort 的稳定次序；
 * PG 表没有 rowid，退化为按主键另一半 `question_id` 排（顺序稳定，但不等价于插入顺序）。
 * 只用于 `ORDER BY` 的最后一个键。
 */
export function insertionOrder(alias: string, driver: DbDriverName): string {
  return driver === 'pg' ? `${alias}.question_id` : `${alias}.rowid`;
}

/**
 * 把 `answers` 这类 JSON 数组展开成行（方言 #24）。
 *
 * SQLite 用表值函数 `json_each(col)`；PostgreSQL 用 `jsonb_array_elements(col::jsonb)`，
 * 并需要 `CROSS JOIN LATERAL` 才能引用左侧的列。列类型是 `text`（保持 SQLite 的存储形态），
 * 因此 PG 侧显式 `::jsonb`。
 *
 * 返回值拼在 FROM 的源表后面，例如：
 *   `FROM attempts a ${jsonArrayJoin('a.answers', 'je', driver)}`
 */
export function jsonArrayJoin(column: string, alias: string, driver: DbDriverName): string {
  return driver === 'pg'
    ? `CROSS JOIN LATERAL jsonb_array_elements(${column}::jsonb) AS ${alias}(value)`
    : `, json_each(${column}) ${alias}`;
}

/** JSON 数组元素的整数字段（如 `qid`）；两库都返回整数或 NULL */
export function jsonIntField(alias: string, field: string, driver: DbDriverName): string {
  return driver === 'pg'
    ? `CAST(${alias}.value->>'${field}' AS INTEGER)`
    : `CAST(json_extract(${alias}.value, '$.${field}') AS INTEGER)`;
}

/**
 * JSON 数组元素的布尔字段 → `1`/`0`/`NULL`（如 `correct`）。
 *
 * 必须保住 NULL：`correct: null` 是主观题（待自评），不能算错。
 * SQLite 的 `json_extract` 对 true/false/null 直接返回 1/0/null；
 * PG 的 `->>` 返回文本 `'true'/'false'`，用 `CASE` 显式映射（`::int` 对 NULL 行为不一致，别用）。
 */
export function jsonBoolIntField(alias: string, field: string, driver: DbDriverName): string {
  return driver === 'pg'
    ? `CASE WHEN ${alias}.value->>'${field}' = 'true' THEN 1 WHEN ${alias}.value->>'${field}' = 'false' THEN 0 END`
    : `json_extract(${alias}.value, '$.${field}')`;
}
