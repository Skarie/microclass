/**
 * 课程封面缩略图地址。
 *
 * 后端 `GET /api/v1/course-cover/:id?w=<120..1600>` 返回 webp 缩略图（无参数仍是原图）。
 * 卡片按 400 取、hero 按 800 取：同一课在「我的课程」「大厅」「推荐」里复用 400 的缓存。
 */
export const COVER_CARD_WIDTH = 400;
export const COVER_HERO_WIDTH = 800;

export function coverUrl(id: number, width: number): string {
  return `/api/v1/course-cover/${id}?w=${width}`;
}
