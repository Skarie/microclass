import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { KnowledgeImportResult } from '@/api/knowledge';

/**
 * 批量导入知识点向导的状态层：选文件 → dryRun 预览 → 正式导入。
 *
 * 大文件（100MB 级）走 XHR 上传进度：`uploadWithProgress` 的 percent 到 100 后
 * 服务端还要解析 Markdown / ZIP，所以再切到「解析中…」，避免进度条卡在 100% 让人以为卡死。
 */
type Phase = 'idle' | 'uploading' | 'parsing';

export interface KnowledgeImportDeps {
  courseId: () => number;
  /** 正式导入成功后刷新课程知识点 / 课时列表 */
  onImported: () => Promise<void> | void;
}

function normalize(result: KnowledgeImportResult): KnowledgeImportResult {
  return {
    ...result,
    items: result.items ?? [],
    unmatchedItems: result.unmatchedItems ?? [],
  };
}

export function useKnowledgeImport(deps: KnowledgeImportDeps) {
  const toast = useToastStore();
  const open = ref(false);
  const files = ref<File[]>([]);
  const preview = ref<KnowledgeImportResult | null>(null);
  const busy = ref(false);
  const phase = ref<Phase>('idle');
  const percent = ref(0);
  const error = ref('');

  const fileNames = computed(() => files.value.map((f) => f.name).join('、'));
  const canImport = computed(() => preview.value !== null && preview.value.items.length > 0 && !busy.value);
  const busyText = computed(() => {
    if (phase.value === 'parsing') return '上传完成，解析中…';
    if (phase.value === 'uploading') return percent.value > 0 ? `上传中 ${percent.value}%` : '上传/解析中…';
    return '';
  });

  function reset(): void {
    files.value = [];
    preview.value = null;
    busy.value = false;
    phase.value = 'idle';
    percent.value = 0;
    error.value = '';
  }

  function openWizard(): void {
    reset();
    open.value = true;
  }

  function close(): void {
    open.value = false;
    reset();
  }

  function onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (picked.length === 0) return;
    const bad = picked.find((f) => !/\.(zip|md)$/i.test(f.name));
    if (bad) {
      toast.warning('只支持 .zip 压缩包或 .md 文件', bad.name);
      return;
    }
    if (picked.length > 1 && picked.some((f) => /\.zip$/i.test(f.name))) {
      toast.warning('压缩包请单独上传', 'ZIP 里已经包含章节与所有 Markdown 文件');
      return;
    }
    files.value = picked;
    void loadPreview();
  }

  /** 上传同一批文件；dryRun 只解析不写库 */
  async function upload(dryRun: boolean): Promise<KnowledgeImportResult> {
    const form = new FormData();
    for (const file of files.value) form.append('file', file);
    const query = dryRun ? '?dryRun=1' : '';
    phase.value = 'uploading';
    percent.value = 0;
    try {
      const result = await api.uploadWithProgress<KnowledgeImportResult>(
        `/courses/${deps.courseId()}/knowledge/import${query}`,
        form,
        (p) => {
          percent.value = p;
          if (p >= 100) phase.value = 'parsing';
        },
      );
      return normalize(result);
    } finally {
      phase.value = 'idle';
    }
  }

  async function loadPreview(): Promise<void> {
    if (files.value.length === 0) return;
    busy.value = true;
    error.value = '';
    preview.value = null;
    try {
      preview.value = await upload(true);
    } catch (e) {
      error.value = errorMessage(e);
      toast.error(error.value);
    } finally {
      busy.value = false;
    }
  }

  async function confirm(): Promise<void> {
    if (!canImport.value) return;
    busy.value = true;
    error.value = '';
    try {
      const result = await upload(false);
      toast.success(`已导入 ${result.imported ?? result.matched} 个知识点，跳过 ${result.skipped} 个`);
      open.value = false;
      reset();
      await deps.onImported();
    } catch (e) {
      error.value = errorMessage(e);
      toast.error(error.value);
    } finally {
      busy.value = false;
    }
  }

  return reactive({
    open,
    files,
    fileNames,
    preview,
    busy,
    percent,
    error,
    canImport,
    busyText,
    openWizard,
    close,
    onFilePicked,
    confirm,
  });
}
