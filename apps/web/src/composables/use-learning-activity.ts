/**
 * 首页学习日历：`/me/activity?days=30` → 热力格 + 连续天数。
 *
 * 只取数、把原始日期交给 `utils/learning-activity` 铺格子；
 * 接口失败（例如后端尚未上线）按「没有记录」处理，显示去看课的引导而不是报错。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { ActivityDay, ActivityResponse } from '@/api/activity';
import { buildCalendar } from '@/utils/learning-activity';

export function useLearningActivity(days = 30) {
  const raw = ref<ActivityDay[]>([]);
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<ActivityResponse>('/me/activity', { days });
      raw.value = Array.isArray(res?.days) ? res.days : [];
    } catch {
      raw.value = [];
    } finally {
      loading.value = false;
    }
  }

  const calendar = computed(() => buildCalendar(raw.value));

  return { raw, loading, calendar, load };
}
