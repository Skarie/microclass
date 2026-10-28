/**
 * 题库列表：当前文件夹 / 课程范围下的加载、关键词搜索、排序、分页与选中项。
 *
 * 两个视图共用同一个列表：文件夹视图传 `folderId=<id>`（或 `none`），
 * 课程关联视图传 `courseId=<id>`（或 `unbound`）。
 */
import { computed, ref, watch, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';
import type { BankNavView, CourseFilter, FolderFilter } from '@/views/admin/bankTypes';

interface BankListResponse {
  banks: Bank[];
  /** 当前筛选条件下的题库总数（服务端分页用） */
  total?: number;
}

/** 题库类型筛选：空串 = 全部类型 */
export type BankKindFilter = '' | 'lesson' | 'chapter' | 'paper';

/** 题库列表的范围：由左栏（文件夹 / 课程 / 关键词 / 类型）决定 */
export interface BankListScope {
  kindFilter: Ref<BankKindFilter>;
  bankKeyword: Ref<string>;
  navView: Ref<BankNavView>;
  folderFilter: Ref<FolderFilter>;
  courseFilter: Ref<CourseFilter>;
}

/** 题库列表要用的外部能力：题目列表的加载与清空（由父组件注入，运行时才调用） */
export interface BankListDeps {
  loadQuestions: () => Promise<void>;
  clearQuestions: () => void;
}

/** 服务端分页：一次最多取 300 个题库（全库有 1.2 万个，之前一次全拉会拖垮页面） */
const BANKS_PAGE = 300;

/**
 * 题库列表先只渲染前 50 条（可展开）。
 * 300 条每行都带一个下拉菜单组件，DOM 会到 4000+ 节点；
 * 绝大多数情况下老师会先搜索，先给 50 条既够用又轻。
 */
const BANK_LIST_PAGE = 50;

export function useBankList(scope: BankListScope, deps: BankListDeps) {
  const toast = useToastStore();

  const banks = ref<Bank[]>([]);
  /** 当前筛选条件下题库总数（服务端分页，页面只取前 N 个，避免一次拉 1 万多条） */
  const banksTotal = ref(0);
  const banksLoading = ref(false);
  const selectedBankId = ref<number | null>(null);

  const selectedBank = computed(() => banks.value.find((b) => b.id === selectedBankId.value) ?? null);

  const showAllBanks = ref(false);
  /** 排序：默认沿用服务端顺序（最新创建在前），可切题量/名称 */
  const bankSort = ref<'default' | 'questions' | 'name'>('default');
  const sortedBanks = computed(() => {
    if (bankSort.value === 'default') return banks.value;
    const copy = [...banks.value];
    if (bankSort.value === 'questions') copy.sort((a, b) => b.question_count - a.question_count);
    else copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return copy;
  });
  const visibleBanks = computed(() =>
    showAllBanks.value ? sortedBanks.value : sortedBanks.value.slice(0, BANK_LIST_PAGE),
  );

  /**
   * 题库名**输入即搜**（300ms 防抖）。
   * 左栏搜索原来只认回车，老师输完常常以为"没搜到"；与题目关键词搜索保持一致。
   */
  let bankKeywordTimer: ReturnType<typeof setTimeout> | undefined;
  watch(scope.bankKeyword, () => {
    if (bankKeywordTimer) clearTimeout(bankKeywordTimer);
    bankKeywordTimer = setTimeout(() => void loadBanks(false), 300);
  });

  async function loadBanks(keepSelection = true): Promise<void> {
    banksLoading.value = true;
    try {
      const params = new URLSearchParams();
      const kind = scope.kindFilter.value;
      if (kind !== '') params.set('kind', kind);
      if (scope.bankKeyword.value !== '') params.set('keyword', scope.bankKeyword.value);
      if (scope.navView.value === 'folder') {
        // folderId=none 是有效筛选值（未分类），不能用空串表示
        const folder = scope.folderFilter.value;
        if (folder === 'none') params.set('folderId', 'none');
        else if (typeof folder === 'number') params.set('folderId', String(folder));
      } else {
        const course = scope.courseFilter.value;
        if (course === 'unbound') params.set('courseId', 'unbound');
        else if (typeof course === 'number') params.set('courseId', String(course));
      }
      // 服务端分页：一次最多取 300 个题库（全库有 1.2 万个，之前一次全拉会拖垮页面）
      params.set('limit', String(BANKS_PAGE));
      params.set('offset', '0');
      const res = await api.get<BankListResponse>(`/banks?${params.toString()}`);
      banks.value = res.banks;
      banksTotal.value = res.total ?? res.banks.length;
      const stillThere = banks.value.some((b) => b.id === selectedBankId.value);
      if (!keepSelection || !stillThere) {
        selectedBankId.value = banks.value[0]?.id ?? null;
      }
      if (selectedBankId.value === null) deps.clearQuestions();
      else await deps.loadQuestions();
    } catch (e) {
      toast.error(errorMessage(e));
      banks.value = [];
      selectedBankId.value = null;
    } finally {
      banksLoading.value = false;
    }
  }

  return {
    banks,
    banksTotal,
    banksLoading,
    selectedBankId,
    selectedBank,
    showAllBanks,
    bankSort,
    sortedBanks,
    visibleBanks,
    loadBanks,
  };
}
