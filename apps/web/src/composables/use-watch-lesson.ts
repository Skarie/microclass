import { computed, reactive, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import type { Knowledge, Lesson } from '@/api/types';

interface LessonDetailResponse {
  lesson: Lesson;
  knowledge: Knowledge[];
  /** 该课时所属课程的课程级知识点（整门课共享） */
  courseKnowledge?: Knowledge[];
}

/**
 * 观看页的数据层：课时详情 / 知识点 / 同课程课时（上一节、下一节）。
 * 页面只做编排，视频源地址也在这里统一算好（本地走 Range 流，外部链接直接用原地址）。
 */
export function useWatchLesson(lessonId: Ref<number>) {
  const { data, loading, run } = useAsync<LessonDetailResponse>(() =>
    api.get<LessonDetailResponse>(`/lessons/${lessonId.value}`),
  );

  const lesson = computed(() => data.value?.lesson ?? null);
  const knowledge = computed(() => data.value?.knowledge ?? []);
  const courseKnowledge = computed(() => data.value?.courseKnowledge ?? []);
  const siblingLessons = ref<Lesson[]>([]);

  /** 视频源：本地视频走后端 Range 流，外部链接/嵌入直接用原地址 */
  const videoSrc = computed(() => {
    const l = lesson.value;
    if (!l) return '';
    return l.video_kind === 'local' ? `/api/v1/lessons/${l.id}/video` : l.video_path;
  });

  const isEmbed = computed(() => lesson.value?.video_kind === 'embed');

  const prevLesson = computed(() => {
    const list = siblingLessons.value;
    const index = list.findIndex((l) => l.id === lessonId.value);
    return index > 0 ? list[index - 1] : undefined;
  });

  const nextLesson = computed(() => {
    const list = siblingLessons.value;
    const index = list.findIndex((l) => l.id === lessonId.value);
    return index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;
  });

  async function loadSiblings(): Promise<void> {
    const l = lesson.value;
    if (!l) return;
    try {
      const query = l.course_id === null ? { course: 'orphan' } : { course: l.course_id };
      siblingLessons.value = (await api.get<{ lessons: Lesson[] }>('/lessons', query)).lessons;
    } catch {
      siblingLessons.value = [];
    }
  }

  /** 静默重载（学完后刷新进度，错误交给 useAsync 的静默逻辑） */
  function reload(): Promise<LessonDetailResponse | null> {
    return run(true);
  }

  return reactive({
    data,
    loading,
    run,
    reload,
    lesson,
    knowledge,
    courseKnowledge,
    videoSrc,
    isEmbed,
    prevLesson,
    nextLesson,
    loadSiblings,
  });
}
