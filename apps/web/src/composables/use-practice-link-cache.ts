/**
 * 实践关联列表的缓存与徽标：按题库拉一次「这个题库挂了哪些课时」，全页面共用。
 *
 * 题库列表一次可能显示 50 个题库，逐个请求会打爆接口：限制最多给 60 个行补徽标，
 * 并发 3 个；已经加载过的题库直接命中缓存，保存关联后由调用方 force 刷新。
 */
import { reactive } from 'vue';
import { practiceApi, type PracticeLink } from '@/api/practice';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { bankPracticeLink, findPracticeLink, linkBadge, practiceTargetOf, type LinkBadge } from '@/utils/practice-link';

const BADGE_BANK_LIMIT = 60;
const BADGE_CONCURRENCY = 3;

export function usePracticeLinkCache() {
  const toast = useToastStore();
  const linksByBank = reactive<Record<number, PracticeLink[]>>({});
  const loadedBanks = new Set<number>();
  const pendingBanks = new Map<number, Promise<void>>();

  function linksOf(bankId: number): PracticeLink[] {
    return linksByBank[bankId] ?? [];
  }

  async function loadBankLinks(bankId: number, force = false, notify = false): Promise<void> {
    if (!force && loadedBanks.has(bankId)) return;
    const pending = pendingBanks.get(bankId);
    if (pending) return pending;
    const task = (async (): Promise<void> => {
      try {
        linksByBank[bankId] = await practiceApi.listByBank(bankId);
        loadedBanks.add(bankId);
      } catch (e) {
        if (notify) toast.error(errorMessage(e));
      } finally {
        pendingBanks.delete(bankId);
      }
    })();
    pendingBanks.set(bankId, task);
    await task;
  }

  /** 给当前屏幕上的题库行补徽标（限制数量 + 并发） */
  async function ensureBankLinks(ids: number[]): Promise<void> {
    const queue = ids.filter((id) => !loadedBanks.has(id) && !pendingBanks.has(id)).slice(0, BADGE_BANK_LIMIT);
    if (queue.length === 0) return;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length) {
        const id = queue[cursor];
        cursor += 1;
        if (id !== undefined) await loadBankLinks(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BADGE_CONCURRENCY, queue.length) }, () => worker()));
  }

  const bankBadge = (bankId: number): LinkBadge | null => linkBadge(bankPracticeLink(linksOf(bankId)));
  const chapterBadge = (bankId: number, chapter: string): LinkBadge | null =>
    linkBadge(findPracticeLink(linksOf(bankId), practiceTargetOf('chapter', { id: bankId, name: '' }, { chapter })));
  const sectionBadge = (bankId: number, chapter: string, section: string): LinkBadge | null =>
    linkBadge(
      findPracticeLink(linksOf(bankId), practiceTargetOf('section', { id: bankId, name: '' }, { chapter, section })),
    );
  const questionBadge = (bankId: number, questionId: number): LinkBadge | null =>
    linkBadge(
      findPracticeLink(linksOf(bankId), practiceTargetOf('question', { id: bankId, name: '' }, { questionId })),
    );

  return {
    linksByBank,
    linksOf,
    loadBankLinks,
    ensureBankLinks,
    bankBadge,
    chapterBadge,
    sectionBadge,
    questionBadge,
  };
}
