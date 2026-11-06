/**
 * 首页推荐课程：完全在前端算，不改后端。
 *
 * 规则（按优先级）：
 *   1. 排除「在学 / 已学完 / 已收藏」——首页已有它们的入口，推荐要给新东西；
 *   2. 与在学课程同分类的优先（「同类课程」），其次按发布时间从新到旧（「新上线」）；
 *   3. 最多 3 张，凑不满就少给几张，不拿已排除的课填数。
 */
import { statusOf } from './course-meta';
import type { Course } from '@/api/types';

export type RecommendReason = 'same-category' | 'new';

export interface Recommendation {
  course: Course;
  reason: RecommendReason;
}

export const REASON_LABEL: Record<RecommendReason, string> = {
  'same-category': '同类课程',
  new: '新上线',
};

/** 理由标签语气：同类用主色（与在学相关），新上线用信息色（与分类无关） */
export const REASON_TONE: Record<RecommendReason, 'primary' | 'info'> = {
  'same-category': 'primary',
  new: 'info',
};

export function pickRecommendations(courses: Course[], limit = 3): Recommendation[] {
  const learningCategories = new Set(
    courses.filter((course) => statusOf(course) === 'learning').map((course) => course.category_id),
  );

  const candidates = courses.filter((course) => !course.fav && statusOf(course) === 'new');

  return candidates
    .map((course) => ({
      course,
      same: course.category_id != null && learningCategories.has(course.category_id),
    }))
    .sort((a, b) => Number(b.same) - Number(a.same) || b.course.created_at - a.course.created_at)
    .slice(0, limit)
    .map(({ course, same }) => ({ course, reason: same ? 'same-category' : 'new' }));
}
