/**
 * 首页公告：登录可读的 `/announcements?limit=5`。
 *
 * 公告是首页的「加分项」：接口失败时静默降级为空列表（整块不渲染），
 * 不弹错、不挡住看板的其他数字。
 */
import { ref } from 'vue';
import { api } from '@/api/client';
import type { Announcement, AnnouncementListResponse } from '@/api/announcement';

export function useAnnouncements(limit = 5) {
  const items = ref<Announcement[]>([]);
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<AnnouncementListResponse>('/announcements', { limit });
      items.value = Array.isArray(res?.announcements) ? res.announcements : [];
    } catch {
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { items, loading, load };
}
