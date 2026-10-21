/** 课时归属与排序的纯规则：改绑 ID 归一化、拖拽排序校验、扫描插入点计算。 */
import { AppError } from '@microclass/shared';

/** 批量改绑：只保留正整数并去重，保持首次出现顺序 */
export function normalizeAssignIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

/**
 * 拖拽排序必须提交课程当前课时的完整排列：
 * 重复 → 明确提示；数量或集合不一致 → 提示刷新后重试。
 */
export function validateReorderIds(ids: number[], current: number[]): number[] {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw AppError.badRequest('排序列表里有重复的课时');
  const same = unique.length === current.length && unique.every((id) => current.includes(id));
  if (!same) {
    throw AppError.badRequest('排序列表与课程当前课时不一致，请刷新页面后重试');
  }
  return unique;
}

/**
 * 扫描新增课时的插入点：同章节最后一条之后；本课程还没有这个章节就追加到末尾。
 * 返回可直接传给 `Array.prototype.splice` 的下标。
 */
export function insertionIndex(layout: { chapter: string }[], chapter: string): number {
  let anchor = layout.length - 1;
  for (let i = layout.length - 1; i >= 0; i -= 1) {
    if (layout[i]?.chapter === chapter) {
      anchor = i;
      break;
    }
  }
  return anchor + 1;
}
