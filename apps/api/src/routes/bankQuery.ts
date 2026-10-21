/**
 * 题库接口的查询参数解析（路由与业务共用，避免各写一份校验）。
 */
import { AppError } from '@microclass/shared';
import type { BankKind } from '../db/repositories/bankRepository.js';

/**
 * 解析 `kind` 查询参数：空串 = 全部类型。
 * 非法值直接 400，而不是静默忽略筛选（否则界面切换后看似生效、实际没筛）。
 * 重载保证：调用方已判空（字符串）时拿到的一定是具体类型，目录接口才需要保留空串。
 */
export function parseBankKind(raw: string): BankKind;
export function parseBankKind(raw: string | undefined): BankKind | '';
export function parseBankKind(raw: string | undefined): BankKind | '' {
  if (!raw) return '';
  if (raw === 'lesson' || raw === 'chapter' || raw === 'paper') return raw;
  throw AppError.badRequest('kind 只能是 lesson/chapter/paper');
}
