/**
 * 实践关联（整个题库 / 章节 / 小节 / 单题 → 多个课时）的弹窗编排。
 *
 * - 关联列表缓存与徽标：use-practice-link-cache（按题库缓存，页面各区块共用）；
 * - 课程 / 课时勾选草稿：use-practice-lessons（按课程拉课时，已选跨课程保留）；
 * - 这里只负责「打开哪个粒度、保存时 POST 还是 PATCH / DELETE」。
 */
import { computed, ref } from 'vue';
import { practiceApi, type PracticeLinkInput, type PracticeTargetType } from '@/api/practice';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { usePracticeLinkCache } from '@/composables/use-practice-link-cache';
import { usePracticeLessons } from '@/composables/use-practice-lessons';
import { findPracticeLink, practiceTargetOf, targetLabelOf, type PracticeTarget } from '@/utils/practice-link';

export type { PracticeTarget, PracticeTargetType };

export function usePracticeLinks() {
  const toast = useToastStore();
  const cache = usePracticeLinkCache();
  const lessons = usePracticeLessons();

  const dialogOpen = ref(false);
  const saving = ref(false);
  const target = ref<PracticeTarget | null>(null);
  const existingId = ref<number | null>(null);
  /** 打开弹窗时已有关联的课时数（与当前勾选无关，用于提示「保存会覆盖」） */
  const existingCount = ref(0);

  const dialogTitle = computed(() => {
    const type = target.value?.type;
    const kind = type === 'bank' ? '整个题库' : type === 'chapter' ? '本章' : type === 'section' ? '本小节' : '单题';
    return `关联课时 · ${kind}`;
  });
  const targetLabel = computed(() => (target.value ? targetLabelOf(target.value) : ''));

  async function openDialog(next: PracticeTarget): Promise<void> {
    dialogOpen.value = true;
    saving.value = false;
    target.value = next;
    existingId.value = null;
    existingCount.value = 0;
    lessons.resetDraft();

    await cache.loadBankLinks(next.bankId, true, true);
    const existing = findPracticeLink(cache.linksOf(next.bankId), next) ?? null;
    existingId.value = existing?.id ?? null;
    existingCount.value = existing?.lessonIds.length ?? 0;
    lessons.seedFromLink(existing);

    await lessons.loadCourses();
    const preferred = lessons.preferredCourseId(existing, next.courseId ?? null);
    const chosen = lessons.courses.value.some((course) => course.id === preferred)
      ? preferred
      : (lessons.courses.value[0]?.id ?? '');
    await lessons.loadLessons(chosen ?? '');
  }

  function openBankLink(bank: { id: number; name: string }, hint?: number | null): void {
    void openDialog(practiceTargetOf('bank', bank, { courseId: hint }));
  }
  function openChapterLink(bank: { id: number; name: string }, chapter: string, hint?: number | null): void {
    void openDialog(practiceTargetOf('chapter', bank, { chapter, courseId: hint }));
  }
  function openSectionLink(
    bank: { id: number; name: string },
    chapter: string,
    section: string,
    hint?: number | null,
  ): void {
    void openDialog(practiceTargetOf('section', bank, { chapter, section, courseId: hint }));
  }
  function openQuestionLink(
    bank: { id: number; name: string },
    question: { id: number; stem: string },
    hint?: number | null,
  ): void {
    void openDialog(
      practiceTargetOf('question', bank, { questionId: question.id, stem: question.stem, courseId: hint }),
    );
  }

  function closeDialog(): void {
    dialogOpen.value = false;
  }

  async function save(): Promise<void> {
    const current = target.value;
    if (current === null || saving.value) return;
    const ids = [...lessons.selectedIds.value];
    if (ids.length === 0 && existingId.value === null) {
      toast.warning('请至少选择一个课时');
      return;
    }
    saving.value = true;
    try {
      if (ids.length === 0) {
        if (existingId.value !== null) await practiceApi.remove(existingId.value);
        toast.success('已取消关联');
      } else if (existingId.value !== null) {
        await practiceApi.update(existingId.value, ids);
        toast.success(`已关联 ${ids.length} 个课时`);
      } else {
        const input: PracticeLinkInput = { targetType: current.type, bankId: current.bankId, lessonIds: ids };
        if (current.type === 'question' && current.questionId !== null) input.questionId = current.questionId;
        if (current.type === 'chapter' || current.type === 'section') input.chapter = current.chapter;
        if (current.type === 'section') input.section = current.section;
        await practiceApi.create(input);
        toast.success(`已关联 ${ids.length} 个课时`);
      }
      await cache.loadBankLinks(current.bankId, true);
      dialogOpen.value = false;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  return {
    ...cache,
    ...lessons,
    dialogOpen,
    saving,
    target,
    existingId,
    existingCount,
    dialogTitle,
    targetLabel,
    openBankLink,
    openChapterLink,
    openSectionLink,
    openQuestionLink,
    closeDialog,
    save,
  };
}

export type PracticeLinksApi = ReturnType<typeof usePracticeLinks>;
