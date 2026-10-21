/**
 * 课程管理页共享类型：选项卡、课程展示方式、批量改绑作用域。
 * 页内四个区块（课程列表 / 全部课时 / 未归类课时 / 媒体目录）都引用这里。
 */
export type Tab = 'courses' | 'lessons' | 'orphans' | 'roots';

/** 课程展示方式：列表优先，localStorage 记住用户选择 */
export type ViewMode = 'grid' | 'list';

/** 批量改绑的作用域：全部课时 / 未归类课时 */
export type AssignScope = 'all' | 'orphans';
