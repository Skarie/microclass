/**
 * 某门课程的章节/课时细节：只服务「关联课时」下拉。
 *
 * 左栏导航用 catalog-sections 的轻量计数，不拉整棵课时树；这里按需拉当前课程，
 * 从 use-bank-catalog 抽出，避免目录编排文件继续膨胀。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';

export interface CatalogLesson {
  id: number;
  title: string;
  bankCount: number;
  questionCount: number;
  banks: { id: number; name: string; kind: string; questionCount: number }[];
}

/** 单个课程的章节/课时细节：用于「关联课时」下拉（左栏导航已不使用它） */
export interface CatalogDetail {
  course: { id: number; name: string } | undefined;
  chapters: {
    name: string;
    lessonCount: number;
    bankCount: number;
    questionCount: number;
    lessons: CatalogLesson[];
    banks: { id: number; name: string; kind: string; point: string; questionCount: number }[];
  }[];
}

export function useBankCourseDetail() {
  const toast = useToastStore();
  const catalogCourseDetail = ref<CatalogDetail | null>(null);
  const catalogCourseLoading = ref<number | null>(null);

  /**
   * 「关联课时」下拉的选项：只列**当前选中课程**的课时（含章节分组）。
   * 全库有 3,700+ 个课时，一次性拉 1.9MB 塞进下拉既慢又没法用；
   * 课程目录里已经有这些课时，直接用。
   */
  const courseLessonOptions = computed(() => {
    const chapters = catalogCourseDetail.value?.chapters ?? [];
    return chapters.flatMap((chapter) =>
      chapter.lessons.map((lesson) => ({ id: lesson.id, title: `${chapter.name} · ${lesson.title}` })),
    );
  });

  async function loadCatalogCourse(courseId: number): Promise<void> {
    catalogCourseLoading.value = courseId;
    try {
      catalogCourseDetail.value = await api.get<CatalogDetail>(`/banks/catalog?courseId=${courseId}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      catalogCourseLoading.value = null;
    }
  }

  return { catalogCourseDetail, catalogCourseLoading, courseLessonOptions, loadCatalogCourse };
}
