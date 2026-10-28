/**
 * 题库文件夹树：加载、选中、展开与 CRUD。
 *
 * 文件夹计数含子孙（后端已算好且排好序），前端只负责扁平化渲染与持久化
 * 「选中了哪个文件夹」；题库列表过滤在 use-bank-list 里读 selectedFolder。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import {
  allFolderIds,
  flattenFolderOptions,
  flattenFolderRows,
  folderPathOf,
  hasFolder,
} from '@/views/admin/folder-tree';
import type { BankFolder, BankFolderResponse, FolderFilter } from '@/views/admin/bankTypes';

export interface BankFolderDeps {
  /** 文件夹增删改后刷新右侧题库列表（选中项可能被删除） */
  reloadBanks: () => Promise<void>;
}

export function useBankFolders(deps: BankFolderDeps) {
  const toast = useToastStore();

  const folderTree = ref<BankFolder[]>([]);
  const unfiled = ref({ bankCount: 0, questionCount: 0 });
  const foldersLoading = ref(false);
  const expandedFolders = ref<Set<number>>(new Set());
  const selectedFolder = ref<FolderFilter>('all');
  let loadedOnce = false;

  const folderRows = computed(() => flattenFolderRows(folderTree.value, expandedFolders.value));
  const folderOptions = computed(() => flattenFolderOptions(folderTree.value));
  const folderCount = computed(() => allFolderIds(folderTree.value).length);
  /** 全部题库数：根文件夹计数已含子孙，再补未分类 */
  const folderBankTotal = computed(
    () => folderTree.value.reduce((sum, folder) => sum + folder.bankCount, 0) + unfiled.value.bankCount,
  );
  const selectedFolderName = computed(() => {
    if (selectedFolder.value === 'all') return '全部题库';
    if (selectedFolder.value === 'none') return '未分类';
    return folderPathOf(folderTree.value, selectedFolder.value) || '全部题库';
  });

  /* ---------------- 加载 ---------------- */
  async function loadFolders(): Promise<void> {
    foldersLoading.value = true;
    try {
      const res = await api.get<BankFolderResponse>('/banks/folders');
      folderTree.value = res.folders ?? [];
      unfiled.value = res.unfiled ?? { bankCount: 0, questionCount: 0 };
      if (!loadedOnce) {
        expandedFolders.value = new Set(allFolderIds(folderTree.value));
        loadedOnce = true;
      }
      if (typeof selectedFolder.value === 'number' && !hasFolder(folderTree.value, selectedFolder.value)) {
        selectedFolder.value = 'all';
      }
    } catch (e) {
      toast.error(errorMessage(e));
      folderTree.value = [];
    } finally {
      foldersLoading.value = false;
    }
  }

  function selectFolder(filter: FolderFilter): void {
    selectedFolder.value = filter;
  }

  function toggleFolder(id: number): void {
    const next = new Set(expandedFolders.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedFolders.value = next;
  }

  /* ---------------- 新建 / 重命名 ---------------- */
  const folderDialogOpen = ref(false);
  const folderDialogMode = ref<'create' | 'rename'>('create');
  const folderDialogName = ref('');
  const folderDialogParent = ref<number | null>(null);
  const folderDialogTarget = ref<BankFolder | null>(null);
  const folderSaving = ref(false);

  const folderDialogTitle = computed(() => (folderDialogMode.value === 'create' ? '新建文件夹' : '重命名文件夹'));
  const folderDialogParentName = computed(() => {
    if (folderDialogParent.value === null) return '根目录';
    return folderPathOf(folderTree.value, folderDialogParent.value) || '根目录';
  });

  function openCreateFolder(parentId: number | null): void {
    folderDialogMode.value = 'create';
    folderDialogParent.value = parentId;
    folderDialogTarget.value = null;
    folderDialogName.value = '';
    folderDialogOpen.value = true;
  }

  function openRenameFolder(folder: BankFolder): void {
    folderDialogMode.value = 'rename';
    folderDialogParent.value = folder.parentId;
    folderDialogTarget.value = folder;
    folderDialogName.value = folder.name;
    folderDialogOpen.value = true;
  }

  function closeFolderDialog(): void {
    folderDialogOpen.value = false;
    folderDialogTarget.value = null;
  }

  async function saveFolder(): Promise<void> {
    const name = folderDialogName.value.trim();
    if (name === '') {
      toast.warning('请填写文件夹名称');
      return;
    }
    folderSaving.value = true;
    try {
      if (folderDialogMode.value === 'create') {
        const parentId = folderDialogParent.value;
        const res = await api.post<{ folder: BankFolder }>('/banks/folders', { parentId, name });
        if (parentId !== null) {
          const next = new Set(expandedFolders.value);
          next.add(parentId);
          expandedFolders.value = next;
        }
        toast.success(`文件夹「${name}」已创建`);
        closeFolderDialog();
        await loadFolders();
        selectedFolder.value = res.folder.id;
      } else if (folderDialogTarget.value !== null) {
        await api.patch<{ folder: BankFolder }>(`/banks/folders/${folderDialogTarget.value.id}`, { name });
        toast.success(`文件夹已重命名为「${name}」`);
        closeFolderDialog();
        await loadFolders();
      }
      await deps.reloadBanks();
    } catch (e) {
      // 409（同级重名）等业务错误：直接展示后端 message
      toast.error(errorMessage(e));
    } finally {
      folderSaving.value = false;
    }
  }

  /* ---------------- 删除（非空 409 由后端拦截） ---------------- */
  async function deleteFolder(folder: BankFolder): Promise<void> {
    if (!window.confirm(`确定删除文件夹「${folder.name}」吗？只有空文件夹可以删除，里面的题库和子文件夹需要先移走。`)) {
      return;
    }
    try {
      await api.del<{ ok: boolean }>(`/banks/folders/${folder.id}`);
      toast.success(`文件夹「${folder.name}」已删除`);
      await loadFolders();
      await deps.reloadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return {
    folderTree,
    unfiled,
    foldersLoading,
    expandedFolders,
    selectedFolder,
    folderRows,
    folderOptions,
    folderCount,
    folderBankTotal,
    selectedFolderName,
    loadFolders,
    selectFolder,
    toggleFolder,
    folderDialogOpen,
    folderDialogMode,
    folderDialogName,
    folderDialogParentName,
    folderDialogTarget,
    folderSaving,
    folderDialogTitle,
    openCreateFolder,
    openRenameFolder,
    closeFolderDialog,
    saveFolder,
    deleteFolder,
  };
}
