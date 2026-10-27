/**
 * 题库课程归属的批量操作：单个题库挂/移课程，以及按课时/册次自动匹配。
 *
 * 从 use-bank-catalog 抽出：这些动作只改 `course_id`，却要同时刷新课程目录、
 * 题库列表和按册次目录的「未归属」标记。
 */
import { ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';

interface OkResponse {
  ok: boolean;
}

export interface BankRebindDeps {
  loadCatalog: () => Promise<void>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  loadBookCatalog: () => Promise<void>;
}

export function useBankRebind(deps: BankRebindDeps) {
  const toast = useToastStore();
  const rebinding = ref(false);
  /** 自动匹配后仍未归属的册次（提示老师手工挂） */
  const unmatchedBooks = ref<{ book: string; banks: number }[]>([]);

  /** 把某个题库挂到指定课程（「未归属」里手工归类） */
  async function bindBankCourse(bank: Bank, courseId: number | null): Promise<void> {
    try {
      await api.put<OkResponse>(`/banks/${bank.id}`, { name: bank.name, lessonId: bank.lesson_id, courseId });
      toast.success(courseId === null ? `已把「${bank.name}」移出课程` : `已把「${bank.name}」挂到课程`);
      await Promise.all([deps.loadCatalog(), deps.loadBanks(), deps.loadBookCatalog()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function rebind(): Promise<void> {
    rebinding.value = true;
    try {
      const res = await api.post<{
        byLesson: number;
        byBook: number;
        unmatched: number;
        unmatchedBooks: { book: string; banks: number }[];
      }>('/banks/rebind-courses');
      toast.success(`已归属课程：课时推导 ${res.byLesson} 个、册次匹配 ${res.byBook} 个；仍未归属 ${res.unmatched} 个`);
      unmatchedBooks.value = res.unmatchedBooks;
      await deps.loadCatalog();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      rebinding.value = false;
    }
  }

  return { rebinding, unmatchedBooks, bindBankCourse, rebind };
}
