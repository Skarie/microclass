/**
 * 题目编辑器：弹窗开关、表单状态、新建/编辑保存与配图上传。
 *
 * 从 use-question-list 抽出。表单的默认值、题目回填与选项压缩是纯函数，
 * 放在 utils/question-form.ts；这里只留「弹窗 + 请求 + 刷新」这些动作。
 * 单条删除不在这里：它和批量删除共用确认与刷新流程，归 use-question-selection。
 */
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { blankQuestionForm, compactOptions, questionFormFrom, type QuestionFormDraft } from '@/utils/question-form';
import type { Bank, QuestionView } from '@/api/types';

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface ImageResponse {
  ok: boolean;
  imagePath: string;
}

/** 编辑器要用的外部状态：当前题库、隐藏的配图输入框与刷新动作 */
export interface QuestionEditorDeps {
  selectedBankId: Ref<number | null>;
  selectedBank: ComputedRef<Bank | null>;
  /** 模板里的 ref="qImageInput"：配图上传必须由页面持有 DOM ref */
  qImageInput: Ref<HTMLInputElement | null>;
  /** 当前列表总数：新建题目默认排在最后 */
  total: Ref<number>;
  loadQuestions: () => Promise<void>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
}

export function useQuestionEditor(deps: QuestionEditorDeps) {
  const toast = useToastStore();

  const qOpen = ref(false);
  const qSaving = ref(false);
  const qEditingId = ref<number | null>(null);
  const qImagePath = ref('');
  const qForm = reactive<QuestionFormDraft>(blankQuestionForm());

  const isChoice = computed(() => qForm.type === 'single' || qForm.type === 'multiple');

  function resetQuestionForm(): void {
    qEditingId.value = null;
    qImagePath.value = '';
    Object.assign(qForm, blankQuestionForm());
  }

  function openCreateQuestion(): void {
    if (deps.selectedBankId.value === null) {
      toast.warning('请先选择或创建一个题库');
      return;
    }
    resetQuestionForm();
    qForm.sort = deps.total.value;
    qOpen.value = true;
  }

  function openEditQuestion(question: QuestionView): void {
    resetQuestionForm();
    qEditingId.value = question.id;
    qImagePath.value = question.image_path;
    Object.assign(qForm, questionFormFrom(question));
    qOpen.value = true;
  }

  async function saveQuestion(): Promise<void> {
    const bankId = deps.selectedBankId.value;
    if (bankId === null) return;
    const stem = qForm.stem.trim();
    if (!stem) {
      toast.warning('请填写题干');
      return;
    }

    const { texts, map } = compactOptions(qForm.options);
    let answer = '';
    if (isChoice.value) {
      if (texts.length < 2) {
        toast.warning('选择题至少需要 2 个非空选项');
        return;
      }
      const picked = qForm.type === 'single' ? [qForm.singleAnswer] : [...qForm.multipleAnswer].sort((a, b) => a - b);
      const indexes: number[] = [];
      for (const index of picked) {
        const mapped = map.indexOf(index);
        if (mapped >= 0) indexes.push(mapped);
      }
      if (indexes.length === 0) {
        toast.warning('请勾选正确答案');
        return;
      }
      answer = [...new Set(indexes)].sort((a, b) => a - b).join(',');
    } else if (qForm.type === 'judge') {
      answer = qForm.judgeAnswer;
    } else {
      answer = qForm.textAnswer.trim();
      if (!answer) {
        toast.warning(qForm.type === 'fill' ? '请填写填空题答案' : '请填写参考答案');
        return;
      }
    }

    const payload = {
      bankId,
      lessonId: deps.selectedBank.value?.lesson_id ?? null,
      type: qForm.type,
      stem,
      options: isChoice.value ? texts : [],
      answer,
      analysis: qForm.analysis.trim(),
      sort: Number(qForm.sort) || 0,
      // 非空表示老师手动指定（后端记 difficulty_source = 'manual'，之后自动重算不会覆盖）
      difficulty: qForm.difficulty,
    };

    qSaving.value = true;
    try {
      if (qEditingId.value === null) {
        await api.post<OkIdResponse>(`/banks/${bankId}/questions`, payload);
        toast.success('题目已添加');
      } else {
        await api.put<OkResponse>(`/questions/${qEditingId.value}`, payload);
        toast.success('题目已保存');
      }
      qOpen.value = false;
      await deps.loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      qSaving.value = false;
    }
  }

  function pickQuestionImage(): void {
    if (qEditingId.value === null) {
      toast.info('请先保存题目，再上传配图');
      return;
    }
    deps.qImageInput.value?.click();
  }

  async function onQuestionImagePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const id = qEditingId.value;
    if (!file || id === null) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.upload<ImageResponse>(`/questions/${id}/image`, fd);
      qImagePath.value = res.imagePath;
      toast.success('配图已上传');
      await deps.loadQuestions();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return {
    qOpen,
    qSaving,
    qEditingId,
    qImagePath,
    qForm,
    openCreateQuestion,
    openEditQuestion,
    saveQuestion,
    pickQuestionImage,
    onQuestionImagePicked,
  };
}
