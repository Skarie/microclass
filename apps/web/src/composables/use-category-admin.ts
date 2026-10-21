import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Category } from '@/api/types';

/**
 * 分类管理：新增 / 删除分类。删除只把课程改为「未分类」，不删除课程。
 * 与课程增删改分开，避免一个组合式函数同时管表单、封面和分类。
 */
interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

export interface CategoryAdminDeps {
  reloadCourses: () => Promise<unknown>;
}

export function useCategoryAdmin(deps: CategoryAdminDeps) {
  const toast = useToastStore();

  const catOpen = ref(false);
  const catBusy = ref(false);
  const newCategoryName = ref('');

  function openCategories(): void {
    catOpen.value = true;
  }

  function closeCategories(): void {
    catOpen.value = false;
  }

  async function addCategory(): Promise<void> {
    const name = newCategoryName.value.trim();
    if (!name) {
      toast.warning('请填写分类名称');
      return;
    }
    catBusy.value = true;
    try {
      await api.post<OkIdResponse>('/categories', { name });
      newCategoryName.value = '';
      toast.success(`分类「${name}」已创建`);
      await deps.reloadCourses();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      catBusy.value = false;
    }
  }

  async function removeCategory(category: Category): Promise<void> {
    if (!window.confirm(`确定删除分类「${category.name}」吗？该分类下的课程会变成未分类。`)) return;
    catBusy.value = true;
    try {
      await api.del<OkResponse>(`/categories/${category.id}`);
      toast.success(`分类「${category.name}」已删除`);
      await deps.reloadCourses();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      catBusy.value = false;
    }
  }

  return reactive({
    catOpen,
    catBusy,
    newCategoryName,
    openCategories,
    closeCategories,
    addCategory,
    removeCategory,
  });
}
