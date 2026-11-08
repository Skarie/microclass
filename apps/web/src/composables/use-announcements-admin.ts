/**
 * 管理端公告：列表 / 新建 / 编辑 / 删除。
 *
 * 写操作成功后**重新拉列表**（不本地拼装）：置顶与发布时间的排序由后端定，
 * 前端自己插一条会和服务端的顺序不一致。失败统一 toast，不吞错。
 */
import { ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Announcement, AnnouncementListResponse, AnnouncementPayload } from '@/api/announcement';

export function useAnnouncementsAdmin() {
  const toast = useToastStore();
  const items = ref<Announcement[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const removing = ref<number | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<AnnouncementListResponse>('/admin/announcements');
      items.value = Array.isArray(res?.announcements) ? res.announcements : [];
    } catch (e) {
      items.value = [];
      toast.error(errorMessage(e));
    } finally {
      loading.value = false;
    }
  }

  /** 新建（id 省略）或编辑；返回是否成功，由调用方决定关不关弹窗 */
  async function save(payload: AnnouncementPayload, id?: number): Promise<boolean> {
    saving.value = true;
    try {
      if (id === undefined) {
        await api.post<Announcement>('/admin/announcements', payload);
      } else {
        await api.put<Announcement>(`/admin/announcements/${id}`, payload);
      }
      toast.success(id === undefined ? `已创建公告「${payload.title}」` : `已保存公告「${payload.title}」`);
      await load();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function remove(id: number): Promise<boolean> {
    removing.value = id;
    try {
      await api.del<{ ok: boolean }>(`/admin/announcements/${id}`);
      toast.success('公告已删除');
      await load();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      removing.value = null;
    }
  }

  return { items, loading, saving, removing, load, save, remove };
}
