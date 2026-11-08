import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import type { CourseManageResponse, MediaRoot } from '@/api/types';

/**
 * 课程文件夹：绑定 / 更换 / 解绑，以及「浏览媒体目录」选择器。
 * 文件夹与媒体目录由页面持有，这里通过 getter 读取，避免复制状态。
 */
interface BrowseResponse {
  path: string;
  dirs: string[];
  files: { name: string; size: number }[];
}

export interface CourseFolderDeps {
  courseId: () => number;
  getFolder: () => CourseManageResponse['folder'];
  getRoots: () => MediaRoot[];
  reload: () => Promise<void>;
}

export function useCourseFolder(deps: CourseFolderDeps) {
  const toast = useToastStore();

  const bindOpen = ref(false);
  const bindRootId = ref('');
  const bindPath = ref('');
  const binding = ref(false);

  const pickerOpen = ref(false);
  const pickerPath = ref('');
  const pickerDirs = ref<string[]>([]);
  const pickerLoading = ref(false);

  function openBind(): void {
    bindRootId.value = deps.getFolder()?.rootId ?? deps.getRoots()[0]?.id ?? '';
    bindPath.value = deps.getFolder()?.path ?? '';
    bindOpen.value = true;
    pickerOpen.value = false;
  }

  function closeBind(): void {
    bindOpen.value = false;
  }

  async function loadPicker(path: string): Promise<void> {
    if (!bindRootId.value) {
      toast.warning('请先选择媒体目录');
      return;
    }
    pickerLoading.value = true;
    try {
      const res = await api.get<BrowseResponse>(`/media-roots/${bindRootId.value}/browse`, path ? { path } : undefined);
      pickerPath.value = res.path;
      pickerDirs.value = res.dirs;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      pickerLoading.value = false;
    }
  }

  function openPicker(): void {
    pickerOpen.value = true;
    void loadPicker(bindPath.value);
  }

  function closePicker(): void {
    pickerOpen.value = false;
  }

  function pickerEnter(dir: string): void {
    void loadPicker(pickerPath.value ? `${pickerPath.value}/${dir}` : dir);
  }

  function pickerUp(): void {
    const parts = pickerPath.value.split('/').filter(Boolean);
    parts.pop();
    void loadPicker(parts.join('/'));
  }

  function pickerPick(): void {
    bindPath.value = pickerPath.value;
    pickerOpen.value = false;
  }

  async function saveBind(): Promise<void> {
    if (!bindRootId.value) {
      toast.warning('请选择媒体目录');
      return;
    }
    binding.value = true;
    try {
      await api.put<{ ok: boolean }>(`/courses/${deps.courseId()}/folder`, {
        rootId: bindRootId.value,
        path: bindPath.value.trim(),
      });
      toast.success('课程文件夹已绑定', '点「扫描」即可把该文件夹里的视频导入为课时');
      bindOpen.value = false;
      await deps.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      binding.value = false;
    }
  }

  async function unbind(): Promise<void> {
    const ok = await askConfirm({
      title: '解绑课程文件夹',
      message: '解绑后本课程不再与该文件夹联动。',
      detail: '已经导入的课时会保留，不受影响。',
      confirmText: '解绑',
    });
    if (!ok) return;
    try {
      await api.put<{ ok: boolean }>(`/courses/${deps.courseId()}/folder`, { rootId: null });
      toast.success('已解绑课程文件夹');
      await deps.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return reactive({
    bindOpen,
    bindRootId,
    bindPath,
    binding,
    pickerOpen,
    pickerPath,
    pickerDirs,
    pickerLoading,
    openBind,
    closeBind,
    loadPicker,
    openPicker,
    closePicker,
    pickerEnter,
    pickerUp,
    pickerPick,
    saveBind,
    unbind,
  });
}
