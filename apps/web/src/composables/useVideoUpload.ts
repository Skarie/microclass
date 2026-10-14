/**
 * 网页上传视频的共用逻辑。
 *
 * 「课时管理」与「课程课时管理」都需要：把视频（可整个文件夹拖进来）排队 → 顺序上传 →
 * 生成课时。这里把队列、拖拽目录递归、进度与失败重试收敛成一个组合式函数，
 * 两个页面只负责各自的界面，避免同一套逻辑抄两遍。
 *
 * 设计要点：
 * - **顺序上传**：并发上传多个大文件会把 NAS 的磁盘与内存打满，逐个上传进度也更清晰；
 * - **失败可重试**：失败项保留在队列里，再次点「上传」只重传 pending/error 的项；
 * - **章节自动识别**：拖入文件夹时浏览器给出 webkitRelativePath，取顶层目录当章节名，
 *   与「一个子文件夹 = 一章」的素材习惯一致。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  /** 去重用的稳定键：相对路径 + 大小 + 修改时间 */
  key: string;
  file: File;
  /** 相对路径（拖拽文件夹时用于自动分章） */
  relPath: string;
  progress: number;
  status: UploadStatus;
  message: string;
}

/** 允许上传的视频扩展名（与后端白名单保持一致） */
export const VIDEO_FILE_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv', '.ts', '.m4v'];

export function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** FileList（可能带 webkitRelativePath）→ 上传队列项 */
export function itemsFromFileList(files: FileList | File[]): UploadItem[] {
  const out: UploadItem[] = [];
  for (const f of Array.from(files)) {
    if (!isVideoFile(f.name)) continue;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    out.push({
      key: `${rel || f.name}#${f.size}#${f.lastModified}`,
      file: f,
      relPath: rel || f.name,
      progress: 0,
      status: 'pending',
      message: '',
    });
  }
  return out;
}

/** 递归读取拖入的文件夹（浏览器给出 FileSystemEntry 树，可拿到相对路径） */
export async function itemsFromDataTransfer(dt: DataTransfer): Promise<UploadItem[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return itemsFromFileList(dt.files);

  const out: UploadItem[] = [];
  const pushFile = (file: File, path: string): void => {
    if (!isVideoFile(file.name)) return;
    out.push({
      key: `${path}#${file.size}#${file.lastModified}`,
      file,
      relPath: path,
      progress: 0,
      status: 'pending',
      message: '',
    });
  };

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      await new Promise<void>((resolve) => {
        (entry as FileSystemFileEntry).file(
          (file) => {
            pushFile(file, path);
            resolve();
          },
          () => resolve(),
        );
      });
      return;
    }
    if (!entry.isDirectory) return;
    const dirPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve) =>
        reader.readEntries(
          (batch) => resolve(batch),
          () => resolve([]),
        ),
      );
    for (;;) {
      const batch = await readBatch();
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, dirPath);
    }
  };

  for (const entry of entries) await walk(entry, '');
  return out;
}

export type ChapterMode = 'auto' | 'none' | 'custom';

export interface StartUploadOptions {
  /** 目标课程（null = 不归属任何课程，课后可在课时管理里改绑） */
  courseId: number | null;
  /** 章节策略：按文件夹自动 / 不设章节 / 统一章节名 */
  chapterMode: ChapterMode;
  /** chapterMode = 'custom' 时的章节名 */
  chapterName?: string;
}

export interface UploadSummary {
  done: number;
  failed: number;
}

export interface UseVideoUpload {
  queue: Ref<UploadItem[]>;
  uploading: Ref<boolean>;
  done: Ref<number>;
  failed: Ref<number>;
  dropActive: Ref<boolean>;
  /** 队列里能自动识别出的章节（相对路径的顶层目录） */
  chapters: ComputedRef<string[]>;
  addFiles(files: FileList | File[]): void;
  addFromDataTransfer(dt: DataTransfer): Promise<void>;
  onPick(event: Event): void;
  clearFinished(): void;
  reset(): void;
  start(options: StartUploadOptions): Promise<UploadSummary>;
}

export function useVideoUpload(): UseVideoUpload {
  const toast = useToastStore();
  const queue = ref<UploadItem[]>([]);
  const uploading = ref(false);
  const done = ref(0);
  const failed = ref(0);
  const dropActive = ref(false);

  const chapters = computed(() => {
    const set = new Set<string>();
    for (const item of queue.value) {
      const parts = item.relPath.split('/').filter(Boolean);
      if (parts.length > 1) set.add(parts[0] ?? '');
    }
    return [...set];
  });

  function addToQueue(items: UploadItem[]): void {
    if (items.length === 0) {
      toast.warning('没有识别到视频文件', `支持 ${VIDEO_FILE_EXTENSIONS.map((e) => e.slice(1)).join(' / ')}`);
      return;
    }
    const existing = new Set(queue.value.map((i) => i.key));
    const fresh = items.filter((i) => !existing.has(i.key));
    queue.value = [...queue.value, ...fresh];
    if (fresh.length === 0) toast.info('这些视频已经在待上传列表里了');
  }

  async function addFromDataTransfer(dt: DataTransfer): Promise<void> {
    dropActive.value = false;
    addToQueue(await itemsFromDataTransfer(dt));
  }

  function onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) addToQueue(itemsFromFileList(input.files));
    input.value = '';
  }

  function clearFinished(): void {
    queue.value = queue.value.filter((i) => i.status !== 'done');
  }

  function reset(): void {
    queue.value = [];
    done.value = 0;
    failed.value = 0;
    uploading.value = false;
  }

  async function start(options: StartUploadOptions): Promise<UploadSummary> {
    const pending = queue.value.filter((i) => i.status === 'pending' || i.status === 'error');
    if (pending.length === 0) {
      toast.warning('请先选择要上传的视频');
      return { done: 0, failed: 0 };
    }
    if (options.chapterMode === 'custom' && !(options.chapterName ?? '').trim()) {
      toast.warning('请填写统一章节名，或把章节改为「按文件夹自动」');
      return { done: 0, failed: 0 };
    }

    uploading.value = true;
    done.value = 0;
    failed.value = 0;
    for (const item of pending) {
      item.status = 'uploading';
      item.progress = 0;
      try {
        const fd = new FormData();
        fd.append('file', item.file, item.file.name);
        if (options.courseId !== null) fd.append('courseId', String(options.courseId));
        if (options.chapterMode === 'custom') fd.append('groupName', (options.chapterName ?? '').trim());
        else if (options.chapterMode === 'auto' && item.relPath.includes('/')) fd.append('relPath', item.relPath);
        await api.uploadWithProgress<{ ok: boolean; id: number }>('/lessons/upload', fd, (p) => {
          item.progress = p;
        });
        item.status = 'done';
        item.progress = 100;
        done.value += 1;
      } catch (e) {
        item.status = 'error';
        item.message = errorMessage(e);
        failed.value += 1;
      }
    }
    uploading.value = false;

    if (failed.value === 0) {
      toast.success(`已上传 ${done.value} 个视频并生成课时`, '章节与课程可在列表里继续调整');
    } else {
      toast.warning(`上传结束：成功 ${done.value} 个，失败 ${failed.value} 个`, '失败项可点「重试」');
    }
    return { done: done.value, failed: failed.value };
  }

  return {
    queue,
    uploading,
    done,
    failed,
    dropActive,
    chapters,
    addFiles: (files: FileList | File[]) => addToQueue(itemsFromFileList(files)),
    addFromDataTransfer,
    onPick,
    clearFinished,
    reset,
    start,
  };
}
