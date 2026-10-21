import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Lesson } from '@/api/types';

/**
 * 课程课时管理页的课时动作：新建 / 编辑 / 知识点 / 上传视频 / 删除、
 * 整门课程知识点导出、批量抽取视频时长与封面。请求参数与文案与拆分前逐字一致。
 */
interface OkResponse {
  ok: boolean;
}

interface ProbeResponse {
  probed: number;
  failed: number;
  remaining: number;
  available: boolean;
}

export interface CourseLessonActionDeps {
  courseId: () => number;
  reload: () => Promise<void>;
}

export function useCourseLessonActions(deps: CourseLessonActionDeps) {
  const toast = useToastStore();

  const formOpen = ref(false);
  const editingLesson = ref<Lesson | null>(null);
  const knOpen = ref(false);
  const knLesson = ref<Lesson | null>(null);
  const uploadOpen = ref(false);
  const exporting = ref(false);
  const probing = ref(false);
  const probeProgress = ref('');

  function openCreate(): void {
    editingLesson.value = null;
    formOpen.value = true;
  }

  function openEdit(lesson: Lesson): void {
    editingLesson.value = lesson;
    formOpen.value = true;
  }

  function closeForm(): void {
    formOpen.value = false;
  }

  function openKnowledge(lesson: Lesson): void {
    knLesson.value = lesson;
    knOpen.value = true;
  }

  function closeKnowledge(): void {
    knOpen.value = false;
  }

  async function onSaved(): Promise<void> {
    formOpen.value = false;
    await deps.reload();
  }

  async function removeLesson(lesson: Lesson): Promise<void> {
    if (!window.confirm(`确定删除课时「${lesson.title}」吗？该课时的进度、练习记录与知识点会一并移除，且不可恢复。`))
      return;
    try {
      await api.del<OkResponse>(`/lessons/${lesson.id}`);
      toast.success(`课时「${lesson.title}」已删除`);
      await deps.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function onUploaded(): Promise<void> {
    await deps.reload();
  }

  /** 关闭上传弹窗时再刷一次 */
  async function closeUpload(): Promise<void> {
    uploadOpen.value = false;
    await deps.reload();
  }

  async function exportKnowledge(format: 'md' | 'docx'): Promise<void> {
    exporting.value = true;
    try {
      await api.download(`/courses/${deps.courseId()}/knowledge.${format}`);
      toast.success('课程讲义已开始下载', '按「章节 → 课时」组织，含文本/链接/附件名');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      exporting.value = false;
    }
  }

  async function probePending(): Promise<void> {
    probing.value = true;
    probeProgress.value = '';
    let probed = 0;
    let failed = 0;
    try {
      for (let round = 0; round < 50; round += 1) {
        const res = await api.post<ProbeResponse>('/lessons/probe-pending');
        if (!res.available) {
          toast.warning('运行环境里没有 ffprobe，无法抽取视频时长/封面', '可在镜像或宿主机安装 ffmpeg 后重试');
          break;
        }
        probed += res.probed;
        failed += res.failed;
        if (res.probed === 0 && res.failed === 0) break;
        probeProgress.value = `已处理 ${probed} 个，失败 ${failed} 个…`;
        if (res.remaining === 0) break;
      }
      if (probed > 0 || failed > 0) {
        toast.success(`已抽取 ${probed} 个视频的时长与封面`, failed > 0 ? `${failed} 个文件无法解析（已跳过）` : '');
        await deps.reload();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      probing.value = false;
      probeProgress.value = '';
    }
  }

  return reactive({
    formOpen,
    editingLesson,
    knOpen,
    knLesson,
    uploadOpen,
    exporting,
    probing,
    probeProgress,
    openCreate,
    openEdit,
    closeForm,
    openKnowledge,
    closeKnowledge,
    onSaved,
    removeLesson,
    onUploaded,
    closeUpload,
    exportKnowledge,
    probePending,
  });
}
