import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { PAGE_SIZE } from '@/views/admin/conflicts/conflict-formatters';

/**
 * 「同题不同答案」台账列表：
 *   - 数据口径：题干 + 选项完全相同（同一内容指纹）但答案不一致的题组；
 *   - 状态页签（待核对 / 已核对 / 已忽略 / 全部）+ 台账分页 + 本页内搜索；
 *   - 列表页**不隐式扫库**（冷缓存时全库分组要几分钟，会把整站卡住），只有 rescan() 会扫。
 */
export interface AnswerStat {
  answer: string;
  n: number;
  first_id: number;
}

export interface ConflictGroup {
  contentHash: string;
  stem: string;
  status: 'pending' | 'resolved' | 'ignored';
  groupSize: number;
  answerCount: number;
  answers: AnswerStat[];
  chosenAnswer: string;
  reviewerName: string;
  updatedAt: number;
}

export interface ConflictListResponse {
  counts: { pending: number; resolved: number; ignored: number; total: number };
  sync: { scanned: boolean; reason: string; stale: boolean; ageMs: number };
  page: number;
  pageSize: number;
  total: number;
  items: ConflictGroup[];
}

export type StatusFilter = 'pending' | 'resolved' | 'ignored' | 'all';

interface SyncResponse {
  scannedGroups: number;
  reason: string;
  inserted: number;
  removed: number;
  pending: number;
  total: number;
  ms: { scan: number; cleanup: number; write: number; meta: number; total: number };
}

export function useQuestionConflicts() {
  const toast = useToastStore();

  const statusFilter = ref<StatusFilter>('pending');
  const keyword = ref('');
  const loading = ref(false);
  const scanning = ref(false);
  const data = ref<ConflictListResponse | null>(null);
  const page = ref(1);

  /** 台账过期时给用户的提示（列表页不隐式扫库，避免整站被长扫描卡住） */
  const staleHint = computed(() => {
    const sync = data.value?.sync;
    if (!sync?.stale) return '';
    if (sync.reason === 'never') return '台账还没建立，点「重新扫描全库」开始（首次扫描在冷缓存下可能要几分钟）。';
    if (sync.reason === 'empty') return '台账为空，点「重新扫描全库」重新建立。';
    if (sync.reason === 'grew') return '题库有新增题目，点「重新扫描全库」看看有没有新的冲突组。';
    return '台账已超过 5 分钟，点「重新扫描全库」刷新。';
  });

  /** 按题干关键字在前端过滤当前页（后端分页基于台账，逐页看更省事） */
  const visibleGroups = computed(() => {
    const groups = data.value?.items ?? [];
    const k = keyword.value.trim().toLowerCase();
    if (!k) return groups;
    return groups.filter((g) => `${g.stem} ${g.answers.map((a) => a.answer).join(' ')}`.toLowerCase().includes(k));
  });

  const totalPages = computed(() => {
    const t = data.value?.total ?? 0;
    return Math.max(1, Math.ceil(t / PAGE_SIZE));
  });

  async function load(keepPage = false): Promise<void> {
    loading.value = true;
    try {
      if (!keepPage) page.value = 1;
      data.value = await api.get<ConflictListResponse>('/question-conflicts', {
        status: statusFilter.value,
        page: page.value,
        pageSize: PAGE_SIZE,
      });
    } catch (e) {
      toast.error(errorMessage(e));
      data.value = null;
    } finally {
      loading.value = false;
    }
  }

  function switchStatus(next: StatusFilter): void {
    statusFilter.value = next;
    keyword.value = '';
    void load();
  }

  function goto(next: number): void {
    page.value = Math.min(Math.max(1, next), totalPages.value);
    void load(true);
  }

  /**
   * 手动重新扫描：这是**唯一**会扫全库的入口。
   * 冷缓存（容器/系统刚重启）时全库分组在 NAS 上要几分钟，期间服务端事件循环被占住，
   * 所以按钮要明确提示「可能较慢」，并把服务端返回的分段耗时显示出来。
   */
  async function rescan(): Promise<void> {
    scanning.value = true;
    try {
      const res = await api.post<SyncResponse>('/question-conflicts/sync');
      toast.success(
        `扫描完成：台账 ${res.total} 组（待核对 ${res.pending}），共 ${(res.ms.total / 1000).toFixed(1)} 秒` +
          `（扫描 ${(res.ms.scan / 1000).toFixed(1)}s / 写台账 ${((res.ms.cleanup + res.ms.write) / 1000).toFixed(1)}s）`,
      );
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      scanning.value = false;
    }
  }

  return reactive({
    statusFilter,
    keyword,
    loading,
    scanning,
    data,
    page,
    staleHint,
    visibleGroups,
    totalPages,
    load,
    switchStatus,
    goto,
    rescan,
  });
}
