import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { MediaRoot } from '@/api/types';

/**
 * 媒体目录：列表加载、添加 / 移除，以及“浏览服务器文件夹”选择器。
 * 目标路径只做登记、不复制视频；增删后通过页面注入的 refreshAll 同步课程文件夹文案。
 */
interface MediaRootsResponse {
  mediaRoots: MediaRoot[];
}

interface FsBrowseResponse {
  path: string;
  parent: string | null;
  roots: string[];
  dirs: string[];
}

interface OkResponse {
  ok: boolean;
}

export interface MediaRootDeps {
  refreshAll: () => Promise<void>;
}

export function useMediaRoots(deps: MediaRootDeps) {
  const toast = useToastStore();

  const roots = ref<MediaRoot[]>([]);
  const rootsLoading = ref(false);
  const addRootOpen = ref(false);
  const newRootName = ref('');
  const newRootPath = ref('');
  const rootSaving = ref(false);

  const fsPath = ref('');
  const fsData = ref<FsBrowseResponse | null>(null);
  const fsLoading = ref(false);
  const fsPickerOpen = ref(false);

  async function loadRoots(): Promise<void> {
    rootsLoading.value = true;
    try {
      const res = await api.get<MediaRootsResponse>('/media-roots');
      roots.value = res.mediaRoots;
    } catch (e) {
      toast.error(errorMessage(e));
      roots.value = [];
    } finally {
      rootsLoading.value = false;
    }
  }

  function openAddRoot(): void {
    newRootName.value = '';
    newRootPath.value = '';
    addRootOpen.value = true;
    void loadFs('');
  }

  function closeAddRoot(): void {
    addRootOpen.value = false;
  }

  async function addRoot(): Promise<void> {
    const name = newRootName.value.trim();
    const path = newRootPath.value.trim();
    if (!name) {
      toast.warning('请填写显示名称');
      return;
    }
    if (!path) {
      toast.warning('请用「浏览目录」选择服务器上的文件夹');
      return;
    }
    rootSaving.value = true;
    try {
      await api.post<OkResponse>('/media-roots', { name, path });
      toast.success(`媒体目录「${name}」已添加`, '接下来可在课程里把它（或其子目录）绑定为「课程文件夹」');
      addRootOpen.value = false;
      await deps.refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      rootSaving.value = false;
    }
  }

  async function removeRoot(root: MediaRoot): Promise<void> {
    const used = root.lessons ?? 0;
    if (root.internal) {
      toast.warning('这是系统内置目录（站内上传的视频存这里），不能移除');
      return;
    }
    if (
      !window.confirm(
        `确定移除媒体目录「${root.name}」吗？路径 ${root.path}${used > 0 ? `（当前有 ${used} 个课时在使用，需先改绑或删除）` : ''}`,
      )
    )
      return;
    try {
      await api.del<OkResponse>(`/media-roots/${root.id}`);
      toast.success(`媒体目录「${root.name}」已移除`);
      await deps.refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function loadFs(path: string): Promise<void> {
    fsLoading.value = true;
    try {
      const res = await api.get<FsBrowseResponse>('/fs/browse', path ? { path } : undefined);
      fsData.value = res;
      fsPath.value = res.path;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      fsLoading.value = false;
    }
  }

  function openFsPicker(): void {
    fsPickerOpen.value = true;
    void loadFs(newRootPath.value.trim());
  }

  function closeFsPicker(): void {
    fsPickerOpen.value = false;
  }

  function joinPath(base: string, name: string): string {
    if (!base) return name;
    const sep = base.includes('\\') ? '\\' : '/';
    return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
  }

  function fsEnter(dir: string): void {
    void loadFs(joinPath(fsData.value?.path ?? '', dir));
  }

  function fsUp(): void {
    void loadFs(fsData.value?.parent ?? '');
  }

  function fsPick(): void {
    newRootPath.value = fsData.value?.path ?? '';
    fsPickerOpen.value = false;
  }

  return reactive({
    roots,
    rootsLoading,
    addRootOpen,
    newRootName,
    newRootPath,
    rootSaving,
    fsPath,
    fsData,
    fsLoading,
    fsPickerOpen,
    loadRoots,
    openAddRoot,
    closeAddRoot,
    addRoot,
    removeRoot,
    loadFs,
    openFsPicker,
    closeFsPicker,
    fsEnter,
    fsUp,
    fsPick,
  });
}
