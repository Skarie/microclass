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
