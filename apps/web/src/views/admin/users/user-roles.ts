import type { Role } from '@/api/types';

/** 角色中文名与徽标样式（账号列表 / 编辑弹窗共用）。 */
export const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  teacher: '教师',
  student: '学员',
};

export const ROLE_BADGE: Record<Role, string> = {
  admin: 'mc-badge--primary',
  teacher: 'mc-badge--success',
  student: '',
};
