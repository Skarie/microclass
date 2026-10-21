/**
 * 题库列表：当前目录范围下的加载、关键词搜索、排序、分页与选中项。
 *
 * 从 use-bank-catalog 抽出：目录树只回答「有哪些课程/册次」，
 * 本文件只回答「这个范围内的题库有哪些」；筛选类型变化时两边各自刷新。
 */
import { computed, ref, watch, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';

interface BankListResponse {
  banks: Bank[];
  /** 当前筛选条件下的题库总数（服务端分页用） */
  total?: number;
}

/** 题库类型筛选：空串 = 全部类型 */
export type BankKindFilter = '' | 'lesson' | 'chapter' | 'paper';

/** 题库列表的范围：由目录树（课程 / 未归属册次 / 关键词 / 类型）决定 */
export interface BankListScope {
  kindFilter: Ref<BankKindFilter>;
  bankKeyword: Ref<string>;
  unboundBook: Ref<string>;
  onlyUnbound: Ref<boolean>;
  catalogCourseId: Ref<number | null>;
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
 * 左栏一次最多 300 条，每条都带一个下拉菜单组件，DOM 会到 4000+ 节点；
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
      const res = await api.get<BankListResponse>('/banks', {
        ...(scope.kindFilter.value === '' ? {} : { kind: scope.kindFilter.value }),
        ...(scope.bankKeyword.value ? { keyword: scope.bankKeyword.value } : {}),
        ...(scope.unboundBook.value ? { book: scope.unboundBook.value } : {}),
        ...(scope.onlyUnbound.value
          ? { courseId: 'unbound' }
          : scope.catalogCourseId.value === null
            ? {}
            : { courseId: scope.catalogCourseId.value }),
        // 服务端分页：一次最多取 300 个题库（全库有 1.2 万个，之前一次全拉会拖垮页面）
        limit: BANKS_PAGE,
        offset: 0,
      });
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
