import { computed, reactive, ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { Course } from '@/api/types';

/**
 * 课程增删改：新建 / 编辑表单、删除、封面上传。
 * 依赖的「课程列表」与刷新动作由页面注入，便于和 use-course-list 共享同一份状态。
 */
interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface CoverResponse {
  ok: boolean;
  cover: string;
}

export interface CourseCrudDeps {
  getCourses: () => Course[];
  reloadCourses: () => Promise<unknown>;
  refreshAll: () => Promise<void>;
  coverInput: Ref<HTMLInputElement | null>;
}

export function useCourseCrud(deps: CourseCrudDeps) {
  const router = useRouter();
  const toast = useToastStore();

  const formOpen = ref(false);
  const saving = ref(false);
  const editingId = ref<number | null>(null);
  const form = reactive<{
    name: string;
    description: string;
    categoryId: number | '';
    sort: number;
    published: boolean;
  }>({
    name: '',
    description: '',
    categoryId: '',
    sort: 0,
    published: true,
  });

  const coverTargetId = ref<number | null>(null);
  const uploadingCover = ref(false);

  /**
   * 课程行的「⋯」菜单。次要操作（编辑 / 封面 / 删除）不再常显：
   * 53 门课 × 4 个按钮会把页面堆满，而且删除按钮常驻容易误点。
   */
  const courseMenuItems = computed<MenuItem[]>(() => [
    { key: 'edit', label: '编辑课程', icon: 'edit' },
    { key: 'cover', label: '上传封面', icon: 'image', disabled: uploadingCover.value },
    { key: 'delete', label: '删除课程', icon: 'trash', danger: true },
  ]);

  function openCreate(): void {
    editingId.value = null;
    form.name = '';
    form.description = '';
    form.categoryId = '';
    form.sort = deps.getCourses().length;
    form.published = true;
    formOpen.value = true;
  }

  function openEdit(course: Course): void {
    editingId.value = course.id;
    form.name = course.name;
    form.description = course.description;
    form.categoryId = course.category_id === null ? '' : course.category_id;
    form.sort = course.sort;
    form.published = course.published === 1;
    formOpen.value = true;
  }

  function closeForm(): void {
    formOpen.value = false;
  }

  async function save(): Promise<void> {
    const name = form.name.trim();
    if (!name) {
      toast.warning('请填写课程名称');
      return;
    }
    const payload = {
      name,
      description: form.description.trim(),
      published: form.published,
      categoryId: form.categoryId === '' ? null : Number(form.categoryId),
      sort: Number(form.sort) || 0,
    };
    saving.value = true;
    try {
      if (editingId.value === null) {
        const created = await api.post<OkIdResponse>('/courses', payload);
        toast.success(`课程「${name}」已创建`, '接下来进入课程，选一个视频文件夹并扫描即可导入课时');
        formOpen.value = false;
        await deps.reloadCourses();
        // 新建后直接进入该课程的课时管理，省掉「再找一遍」这一步
        void router.push({ name: 'admin-course-lessons', params: { id: created.id } });
        return;
      }
      await api.put<OkResponse>(`/courses/${editingId.value}`, payload);
      toast.success(`课程「${name}」已保存`);
      formOpen.value = false;
      await deps.reloadCourses();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  async function removeCourse(course: Course): Promise<void> {
    if (
      !window.confirm(
        `确定删除课程「${course.name}」吗？该课程下的 ${course.total ?? 0} 个课时会变成「未归类课时」（可在课程管理的未归类列表里重新改绑），此操作不可恢复。`,
      )
    )
      return;
    try {
      await api.del<OkResponse>(`/courses/${course.id}`);
      toast.success(`课程「${course.name}」已删除`);
      await deps.refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function pickCover(course: Course): void {
    coverTargetId.value = course.id;
    deps.coverInput.value?.click();
  }

  async function onCoverPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const id = coverTargetId.value;
    coverTargetId.value = null;
    if (!file || id === null) return;
    const fd = new FormData();
    fd.append('file', file);
    uploadingCover.value = true;
    try {
      await api.upload<CoverResponse>(`/courses/${id}/cover`, fd);
      toast.success('封面已更新');
      await deps.reloadCourses();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      uploadingCover.value = false;
    }
  }

  return reactive({
    formOpen,
    saving,
    editingId,
    form,
    uploadingCover,
    courseMenuItems,
    openCreate,
    openEdit,
    closeForm,
    save,
    removeCourse,
    pickCover,
    onCoverPicked,
  });
}
