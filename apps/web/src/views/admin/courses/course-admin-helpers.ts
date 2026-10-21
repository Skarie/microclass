import type { Category, Course, MediaRoot } from '@/api/types';

/**
 * 课程行的展示文案。纯函数，课程网格 / 课程表格共用，
 * 不依赖组件状态，便于单独测试与复用。
 */
export function categoryName(course: Course, categories: Category[]): string {
  if (course.category_name) return course.category_name;
  if (course.category_id === null) return '未分类';
  return categories.find((c) => c.id === course.category_id)?.name ?? '未分类';
}

/** 课程文件夹的展示文案（未绑定返回空串） */
export function folderLabel(course: Course, roots: MediaRoot[]): string {
  if (!course.folder_root_id) return '';
  const root = roots.find((r) => r.id === course.folder_root_id);
  const base = root?.name ?? course.folder_root_id;
  const sub = course.folder_path ?? '';
  return sub ? `${base} / ${sub}` : base;
}
