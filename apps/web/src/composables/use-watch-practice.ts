/**
 * 观看页「本课时练习」的数据层：拉 `GET /lessons/:id/practice` 的题库/单题汇总。
 *
 * 没有任何关联时区块整体不渲染（不占位）；接口失败（权限/网络）也只是不显示，
 * 不能影响视频播放与「课后练习」入口。
 */
import { computed, reactive, ref, watch, type Ref } from 'vue';
import { practiceApi, type LessonPractice } from '@/api/practice';

export function useWatchPractice(lessonId: Ref<number>) {
  const data = ref<LessonPractice | null>(null);
  const loading = ref(false);

  const banks = computed(() => data.value?.banks ?? []);
  const questions = computed(() => data.value?.questions ?? []);
  const hasAny = computed(() => banks.value.length > 0 || questions.value.length > 0);

  async function load(): Promise<void> {
    const id = lessonId.value;
    if (!Number.isInteger(id) || id <= 0) {
      data.value = null;
      return;
    }
    loading.value = true;
    try {
      data.value = await practiceApi.lessonPractice(id);
    } catch {
      // 静默失败：区块不显示即可，观看页其它功能不受影响
      data.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch(lessonId, () => void load(), { immediate: true });

  return reactive({ loading, banks, questions, hasAny, reload: load });
}
