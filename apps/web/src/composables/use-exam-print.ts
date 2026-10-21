import { computed, reactive, ref } from 'vue';
import type { ExamCompose } from '@/composables/use-exam-compose';

/** 第④步「打印预览」：纸张 / 方向 / 分栏 / 答案 / 答题卡 / 密封线，与 /paper.html 查询参数一一对应。 */
export function useExamPrint({ compose }: { compose: ExamCompose }) {
  const printOptions = reactive({
    size: 'A4',
    orientation: 'portrait',
    columns: 1,
    answers: false,
    sheet: false,
    seal: true,
  });
  /** 改版式时给 iframe 换一个 cache-busting 参数，强制重载 */
  const previewNonce = ref(0);

  function paperUrl(withPrint = false): string {
    const params = new URLSearchParams({
      size: printOptions.size,
      orientation: printOptions.orientation,
      columns: String(printOptions.columns),
      answers: printOptions.answers ? '1' : '0',
      sheet: printOptions.sheet ? '1' : '0',
      seal: printOptions.seal ? '1' : '0',
    });
    if (withPrint) params.set('print', '1');
    return `/api/v1/exams/${compose.examId}/paper.html?${params.toString()}`;
  }

  const previewSrc = computed(() => `${paperUrl(false)}&_=${previewNonce.value}`);

  function refreshPreview(): void {
    previewNonce.value += 1;
  }

  function openPrint(): void {
    window.open(paperUrl(true), '_blank');
  }

  function openPaperWord(): void {
    window.open(`/api/v1/exams/${compose.examId}/paper.docx?answers=${printOptions.answers ? '1' : '0'}`, '_blank');
  }

  return reactive({ printOptions, previewSrc, refreshPreview, openPrint, openPaperWord });
}

export type ExamPrint = ReturnType<typeof useExamPrint>;
