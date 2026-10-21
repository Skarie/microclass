import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';

/**
 * 组卷页的核心状态：考试 id、考试详情、卷面题目、细目表统计与三步加载。
 * 页面只做编排；范围、卷面编辑、设置、打印各自在独立组合式函数里。
 */
export interface Exam {
  id: number;
  course_id: number;
  title: string;
  duration_minutes: number;
  pass_score: number;
  total_score: number;
  status: 'draft' | 'published';
  structure?: string;
  start_at?: number;
  end_at?: number;
  attempt_limit?: number;
  shuffle_questions?: number;
  show_answers?: number;
}

export interface PaperQuestion {
  id: number;
  type: string;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  score: number;
  section: string;
}

export interface Blueprint {
  stats: {
    questions: number;
    estimatedMinutes: number;
    byType: { type: string; count: number; score: number }[];
  };
  target: {
    ratio: Partial<Record<'easy' | 'medium' | 'hard', number>>;
    actual: Partial<Record<'easy' | 'medium' | 'hard', number>>;
  };
  suggestions: string[];
}

/** 跨组合式函数的挂接点：各函数创建顺序不同，用可变对象避免循环依赖。 */
export interface ComposeHooks {
  /** 考试详情加载完成（设置面板 / 试卷结构据此回填） */
  onExamLoaded?: (exam: Exam) => void;
  /** 路由里的 :id 换了（范围选择需要清空） */
  onExamSwitched?: () => void;
  /** 加载范围树（第①步数据） */
  loadRange?: () => Promise<void>;
}

export const TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

export const LEVEL_LABEL: Record<'easy' | 'medium' | 'hard', string> = {
  easy: '基础',
  medium: '中档',
  hard: '较难',
};

export const QUOTA_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;
export const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export const STEPS = [
  { n: 1, label: '选范围', hint: '章节 / 知识点' },
  { n: 2, label: '选组卷方式', hint: '随机 / 自己挑' },
  { n: 3, label: '看卷子', hint: '可换题、改分值' },
  { n: 4, label: '打印预览', hint: 'A3 / A4' },
];

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export function fmtScore(v: number | undefined | null): string {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function useExamCompose(hooks: ComposeHooks = {}) {
  const route = useRoute();
  const toast = useToastStore();
  /**
   * 考试 id 用 ref + 监听路由参数：同一路由只换 :id 时 Vue 会复用组件，
   * 若在 setup 里算成常量，跳到另一场考试（如生成平行卷后）页面仍显示旧数据。
   */
  const examId = ref(Number(route.params.id));

  const loading = ref(true);
  const busy = ref(false);
  const step = ref(1);
  /**
   * 跳转到另一场考试后的落点：默认回第①步；
   * 但"刚生成平行卷"时老师要看的是新卷内容，所以由发起方标记落在第③步
   * （用标记而不是事后改 step —— 路由 watch 是异步的，事后改会被它覆盖）。
   */
  const landOnPaper = ref(false);
  const exam = ref<Exam | null>(null);
  const paper = ref<PaperQuestion[]>([]);
  const blueprint = ref<Blueprint | null>(null);

  async function loadExam(): Promise<void> {
    const res = await api.get<{ exam: Exam }>(`/exams/${examId.value}`);
    const e = res.exam;
    exam.value = e;
    hooks.onExamLoaded?.(e);
  }

  async function loadPaper(): Promise<void> {
    const res = await api.get<{ questions: PaperQuestion[] }>(`/exams/${examId.value}/paper`);
    paper.value = res.questions ?? [];
    blueprint.value = await api.get<Blueprint>(`/exams/${examId.value}/blueprint`);
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      await loadExam();
      await loadPaper();
      await hooks.loadRange?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      loading.value = false;
    }
  }

  onMounted(loadAll);

  watch(
    () => route.params.id,
    async (id) => {
      const next = Number(id);
      if (!Number.isFinite(next) || next === examId.value) return;
      examId.value = next;
      step.value = landOnPaper.value ? 3 : 1;
      landOnPaper.value = false;
      hooks.onExamSwitched?.();
      await loadAll();
    },
  );

  return reactive({
    examId,
    loading,
    busy,
    step,
    landOnPaper,
    exam,
    paper,
    blueprint,
    typeLabel,
    fmtScore,
    loadExam,
    loadPaper,
    loadAll,
  });
}

export type ExamCompose = ReturnType<typeof useExamCompose>;
