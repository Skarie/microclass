import { reactive, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { LessonNote } from '@/api/types';

interface WatchNotesDeps {
  lessonId: Ref<number>;
  /** 新增笔记记录在当前播放位置 */
  currentTime: () => number;
}

/** 观看页笔记：列表、新增（记在当前播放位置）、删除。 */
export function useWatchNotes(deps: WatchNotesDeps) {
  const toast = useToastStore();
  const notes = ref<LessonNote[]>([]);
  const noteText = ref('');
  const saving = ref(false);

  async function loadNotes(): Promise<void> {
    try {
      notes.value = (await api.get<{ notes: LessonNote[] }>(`/lessons/${deps.lessonId.value}/notes`)).notes;
    } catch {
      notes.value = [];
    }
  }

  async function addNote(): Promise<void> {
    const text = noteText.value.trim();
    if (!text) return;
    saving.value = true;
    try {
      await api.post(`/lessons/${deps.lessonId.value}/notes`, { pos: Math.round(deps.currentTime()), text });
      noteText.value = '';
      await loadNotes();
      toast.success('笔记已保存');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  async function removeNote(id: number): Promise<void> {
    try {
      await api.del(`/notes/${id}`);
      await loadNotes();
      toast.success('笔记已删除');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** 换课时清空未保存的草稿（与拆分前一致） */
  function resetText(): void {
    noteText.value = '';
  }

  return reactive({ notes, noteText, saving, loadNotes, addNote, removeNote, resetText });
}
