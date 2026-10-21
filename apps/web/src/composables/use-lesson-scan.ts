import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { CourseManageResponse, CourseScanResult } from '@/api/types';

/**
 * 扫描课程文件夹：先 dryRun 预览（统计 + 缺失清单），确认后再真正导入。
 * 章节策略（第一层 / 完整路径 / 不设章节）切换时重新预览，与拆分前一致。
 */
export type ChapterMode = 'first' | 'full' | 'none';

export interface LessonScanDeps {
  courseId: () => number;
  getFolder: () => CourseManageResponse['folder'];
  openBind: () => void;
  reload: () => Promise<void>;
}

export function useLessonScan(deps: LessonScanDeps) {
  const toast = useToastStore();

  const scanModalOpen = ref(false);
  const scanning = ref(false);
  const scanPreview = ref<CourseScanResult | null>(null);
  const removeMissing = ref(false);
  /** 章节怎么定：第一层目录（默认）/ 完整目录路径 / 不设章节 */
  const chapterMode = ref<ChapterMode>('first');

  const missingFolderLessons = computed(() => (scanPreview.value?.missing ?? []).filter((m) => m.source === 'folder'));

  async function openScan(): Promise<void> {
    if (!deps.getFolder()) {
      toast.warning('请先绑定课程文件夹', '绑定后点「扫描」即可导入该文件夹里的视频');
      deps.openBind();
      return;
    }
    scanning.value = true;
    try {
      scanPreview.value = await api.post<CourseScanResult>(`/courses/${deps.courseId()}/scan`, {
        dryRun: true,
        chapterMode: chapterMode.value,
      });
      removeMissing.value = false;
      scanModalOpen.value = true;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      scanning.value = false;
    }
  }

  /** 换章节策略后重新预览（预览里的数字/章节会跟着变） */
  async function previewScan(): Promise<void> {
    scanning.value = true;
    try {
      scanPreview.value = await api.post<CourseScanResult>(`/courses/${deps.courseId()}/scan`, {
        dryRun: true,
        chapterMode: chapterMode.value,
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      scanning.value = false;
    }
  }

  async function runScan(): Promise<void> {
    scanning.value = true;
    try {
      const res = await api.post<CourseScanResult>(`/courses/${deps.courseId()}/scan`, {
        removeMissing: removeMissing.value,
        chapterMode: chapterMode.value,
      });
      const extra: string[] = [];
      if (res.assigned > 0) extra.push(`收编 ${res.assigned} 个已有课时`);
      if (res.removed > 0) extra.push(`清理 ${res.removed} 个文件已消失的课时`);
      if (res.skipped > 0) extra.push(`跳过 ${res.skipped} 个已存在`);
      toast.success(
        res.added > 0 ? `扫描完成：新增 ${res.added} 个课时` : '扫描完成：没有新视频',
        extra.join(' · ') || '课时顺序与内容保持原样',
      );
      scanModalOpen.value = false;
      await deps.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      scanning.value = false;
    }
  }

  function closeScan(): void {
    scanModalOpen.value = false;
  }

  return reactive({
    scanModalOpen,
    scanning,
    scanPreview,
    removeMissing,
    chapterMode,
    missingFolderLessons,
    openScan,
    previewScan,
    runScan,
    closeScan,
  });
}
