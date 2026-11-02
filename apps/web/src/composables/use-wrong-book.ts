import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useQuizFlow } from '@/composables/use-quiz-flow';
import { useToastStore } from '@/stores/toast';
import { judgeLocally, summarizeQuiz } from '@/utils/quiz';
import type { GradedItem, QuestionType, WrongItem } from '@/api/types';

interface WrongBookResponse {
  total: number;
  pending: number;
  items: WrongItem[];
}

/**
 * 错题本：取列表 `GET /me/wrong-questions`、筛选、看解析、标记掌握/移除（接口与 toast 沿用旧版）。
 * 单题导航与作答状态在 use-quiz-flow；「查看答案与解析」用本地自评，不额外请求接口。
 */
export function useWrongBook() {
  const router = useRouter();
  const toast = useToastStore();

  /** false：只看未掌握（服务端过滤）；题型与关键词是本地筛选 */
  const includeMastered = ref(false);
  const keyword = ref('');
  const typeFilter = ref<'' | QuestionType>('');
  const busyId = ref<number | null>(null);
  const revealedIds = ref<Set<number>>(new Set());

  const { data, loading, run } = useAsync<WrongBookResponse>(() =>
    api.get<WrongBookResponse>('/me/wrong-questions', includeMastered.value ? { includeMastered: 1 } : undefined),
  );

  const allItems = computed<WrongItem[]>(() => data.value?.items ?? []);
  const items = computed<WrongItem[]>(() => {
    const kw = keyword.value.trim().toLowerCase();
    return allItems.value.filter(
      (item) =>
        (typeFilter.value === '' || item.type === typeFilter.value) &&
        (kw === '' || item.stem.toLowerCase().includes(kw)),
    );
  });
  const questions = computed<WrongItem[]>(() => items.value);
  const flow = useQuizFlow(questions, { summary: () => summarizeQuiz(null, items.value.length) });

  const totalCount = computed(() => data.value?.total ?? 0);
  const pendingCount = computed(() => data.value?.pending ?? 0);
  const masteredCount = computed(() => Math.max(0, totalCount.value - pendingCount.value));
  const itemMap = computed(() => new Map(allItems.value.map((item) => [item.id, item])));
  const masteredIds = computed(
    () => new Set(allItems.value.filter((item) => item.mastered === 1).map((item) => item.id)),
  );
  /** 已看 = 作答过或看过解析 */
  const seenIds = computed(() => {
    const set = new Set(flow.answeredIds.value);
    for (const id of revealedIds.value) if (itemMap.value.has(id)) set.add(id);
    return set;
  });
  const seenCount = computed(() => seenIds.value.size);
  const seenPercent = computed(() =>
    items.value.length > 0 ? Math.round((seenCount.value / items.value.length) * 100) : 0,
  );
  const filteredEmpty = computed(() => allItems.value.length > 0 && items.value.length === 0);

  function isRevealed(qid: number): boolean {
    return revealedIds.value.has(qid);
  }

  function toggleReveal(qid: number): void {
    const next = new Set(revealedIds.value);
    if (next.has(qid)) next.delete(qid);
    else next.add(qid);
    revealedIds.value = next;
  }

  function gradedOf(qid: number): GradedItem | null {
    if (!revealedIds.value.has(qid)) return null;
    const item = itemMap.value.get(qid);
    if (!item) return null;
    const given = flow.answers[qid] ?? '';
    return {
      qid,
      type: item.type,
      stem: item.stem,
      options: item.options,
      image_path: item.image_path,
      given,
      correct: judgeLocally(item.type, given, item.answer),
      answer: item.answer ?? '',
      analysis: item.analysis ?? '',
    };
  }

  /** 刷新列表；标记掌握后当前题可能从「只看未掌握」里消失，尽量停在原题号 */
  async function refresh(silent = false, keepIndex = false): Promise<void> {
    const index = flow.currentIndex.value;
    await run(silent);
    if (!keepIndex) return;
    await nextTick();
    flow.goTo(Math.min(index, Math.max(0, items.value.length - 1)));
  }

  async function toggleMaster(item: WrongItem): Promise<void> {
    busyId.value = item.id;
    try {
      const nextMastered = item.mastered !== 1;
      await api.post(`/me/wrong-questions/${item.id}/master`, { mastered: nextMastered });
      toast.success(nextMastered ? '已标记为掌握' : '已取消掌握标记');
      await refresh(true, true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      busyId.value = null;
    }
  }

  async function remove(item: WrongItem): Promise<void> {
    if (!window.confirm('确定要把这道题从错题本移除吗？')) return;
    busyId.value = item.id;
    try {
      await api.del(`/me/wrong-questions/${item.id}`);
      toast.success('已从错题本移除');
      await refresh(true, true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      busyId.value = null;
    }
  }

  /** 回到该题所属课时的练习页重新作答（与旧版一致） */
  function practice(item: WrongItem): void {
    if (item.lesson_id === null) return;
    void router.push({ name: 'quiz', params: { id: item.lesson_id } });
  }

  watch(includeMastered, () => void refresh());

  return reactive({
    data,
    loading,
    run,
    includeMastered,
    keyword,
    typeFilter,
    items,
    allItems,
    questions,
    totalCount,
    pendingCount,
    masteredCount,
    filteredEmpty,
    busyId,
    isRevealed,
    toggleReveal,
    gradedOf,
    currentIndex: flow.currentIndex,
    current: flow.current,
    answers: flow.answers,
    multipleAnswers: flow.multipleAnswers,
    answeredIds: seenIds,
    answeredCount: seenCount,
    pickedOf: flow.pickedOf,
    setAnswer: flow.setAnswer,
    isMarked: flow.isMarked,
    toggleMark: flow.toggleMark,
    markedIds: flow.markedIds,
    choose: flow.choose,
    goTo: flow.goTo,
    next: flow.next,
    prev: flow.prev,
    verdicts: computed<Record<number, boolean | null>>(() => ({})),
    submitting: false,
    revealed: false,
    summary: flow.summary,
    count: 0,
    unlocked: true,
    submit: async (): Promise<boolean> => false,
    masteredIds,
    seenCount,
    seenPercent,
    refresh,
    toggleMaster,
    remove,
    practice,
  });
}
