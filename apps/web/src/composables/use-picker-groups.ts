/**
 * 组卷「自己挑题」里的题组逻辑：候选列表、按题组筛题池、整组加入。
 *
 * 为什么单独成 composable：`QuestionPickerPanel.vue` 已经顶到文件行数上限
 * （tools/file-size-baseline.json 只能减不能增），把这块请求逻辑抽出来后，
 * 面板只保留「三区编排」，这里可以独立演进（比如以后加「按题组随机抽一题」）。
 *
 * 整组加入的顺序约定：服务端 `GET /question-groups/:id` 已按「母题在前、变式按 sort」
 * 返回，这里只按原顺序提交 questionIds —— 试卷接口按数组顺序落 sort，母题因此排在变式前。
 */
import { computed, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { PickerGroupSummary } from '@/components/compose/types';

export interface PickerGroupsDeps {
  /** 当前考试 id（加入试卷用） */
  examId: () => number;
  /** 与面板共用的忙状态：整组加入期间禁用加入按钮 */
  busy: Ref<boolean>;
  /** 加入成功后刷新题池（已在卷内的题要从列表里去掉） */
  refresh: () => Promise<void>;
  /** 已加入的题数（交给面板 emit('added') 让外层重载卷面） */
  onAdded: (count: number) => void;
}

export function usePickerGroups(deps: PickerGroupsDeps) {
  const toast = useToastStore();
  const groups = ref<PickerGroupSummary[]>([]);
  const groupId = ref<number | null>(null);
  const group = computed(() => groups.value.find((g) => g.id === groupId.value) ?? null);

  /** 题组候选：跨题库，与「范围」筛选无关，进页面拉一次 */
  async function loadGroups(): Promise<void> {
    try {
      const res = await api.get<{ groups: PickerGroupSummary[] }>('/question-groups');
      groups.value = res.groups;
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** 下拉 change：空串 = 全部题组 */
  function onGroupChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    groupId.value = raw === '' ? null : Number(raw);
    void deps.refresh();
  }

  function clearGroup(): void {
    groupId.value = null;
    void deps.refresh();
  }

  async function addWholeGroup(): Promise<void> {
    const current = group.value;
    if (!current) return;
    deps.busy.value = true;
    try {
      const detail = await api.get<{ questions: { id: number }[] }>(`/question-groups/${current.id}`);
      const ids = detail.questions.map((q) => q.id);
      if (ids.length === 0) {
        toast.info('这个题组里还没有题目');
        return;
      }
      const res = await api.post<{ added: number }>(`/exams/${deps.examId()}/questions`, { questionIds: ids });
      toast.success(res.added > 0 ? `整组加入 ${res.added} 题（母题在前）` : '这组题已经全在试卷里了');
      deps.onAdded(res.added);
      await deps.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      deps.busy.value = false;
    }
  }

  return { groups, groupId, group, loadGroups, onGroupChange, clearGroup, addWholeGroup };
}
