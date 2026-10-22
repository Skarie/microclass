import { reactive, ref } from 'vue';
import type { Exam } from '@/api/types';

/** 打印 / 整卷预览选项（服务端按这些参数渲染试卷） */
export interface ExamPaperOptions {
  size: string;
  orientation: string;
  columns: number;
  answers: boolean;
  sheet: boolean;
  seal: boolean;
  scoreBox: boolean;
}

export interface ExamAdminPaperDeps {
  getSelectedExam: () => Exam | null;
}

/**
 * 试卷预览 / 打印：列表行可直接用默认版式打开，选中的考试还能在弹窗里
 * 调纸张、方向、分栏与含答案 / 答题卡 / 密封线，再打开打印视图。
 */
export function useExamAdminPaper({ getSelectedExam }: ExamAdminPaperDeps) {
  const printOpen = ref(false);
  const printOptions = reactive<ExamPaperOptions>({
    size: 'A4',
    orientation: 'portrait',
    columns: 1,
    answers: false,
    sheet: false,
    seal: false,
    scoreBox: true,
  });
  const previewOpen = ref(false);
  const previewSrc = ref('');

  function paperUrl(print = false): string {
    const exam = getSelectedExam();
    if (!exam) return '';
    const params = new URLSearchParams({
      size: printOptions.size,
      orientation: printOptions.orientation,
      columns: String(printOptions.columns),
      answers: printOptions.answers ? '1' : '0',
      sheet: printOptions.sheet ? '1' : '0',
      seal: printOptions.seal ? '1' : '0',
      scoreBox: printOptions.scoreBox ? '1' : '0',
    });
    if (print) params.set('print', '1');
    return `/api/v1/exams/${exam.id}/paper.html?${params.toString()}`;
  }

  /** 列表页直接用默认版式打开某场考试的试卷（预览 / 打印） */
  function openPaperFor(exam: Exam, options?: { print?: boolean; answers?: boolean }): void {
    const params = new URLSearchParams({
      size: 'A4',
      orientation: 'portrait',
      columns: '1',
      answers: options?.answers ? '1' : '0',
      sheet: '0',
      seal: '0',
      scoreBox: '1',
    });
    if (options?.print) params.set('print', '1');
    window.open(`/api/v1/exams/${exam.id}/paper.html?${params.toString()}`, '_blank', 'noopener');
  }

  /** 打印：新窗口打开服务端渲染的试卷并自动弹打印对话框（可另存为 PDF） */
  function openPrint(): void {
    if (!getSelectedExam()) return;
    printOpen.value = false;
    window.open(paperUrl(true), '_blank', 'noopener');
  }

  /** 成绩单区的「打印 / 导出 PDF」：先关预览再开选项，避免叠两层 */
  function openPrintOptions(): void {
    previewOpen.value = false;
    printOpen.value = true;
  }

  /** 整卷预览：同版式嵌在弹窗里（所见即所印）；从打印选项进来时先关掉选项弹窗，避免叠两层 */
  function openPaperPreview(): void {
    if (!getSelectedExam()) return;
    printOpen.value = false;
    previewSrc.value = paperUrl(false);
    previewOpen.value = true;
  }

  return reactive({
    printOpen,
    printOptions,
    previewOpen,
    previewSrc,
    openPaperFor,
    openPrintOptions,
    openPrint,
    openPaperPreview,
  });
}
