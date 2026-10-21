<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import type { LessonNote } from '@/api/types';

/**
 * 侧栏笔记卡：记笔记（当前位置）、按时间点跳转、删除。
 * 数据与保存动作在 use-watch-notes，这里只负责输入与列表展示。
 */
const props = defineProps<{
  notes: LessonNote[];
  noteText: string;
  saving: boolean;
  currentTime: number;
  formatTime: (seconds: number) => string;
}>();

const emit = defineEmits<{
  (e: 'update:noteText', value: string): void;
  (e: 'add'): void;
  (e: 'remove', id: number): void;
  (e: 'seek', seconds: number): void;
}>();

const text = computed({
  get: () => props.noteText,
  set: (value: string) => emit('update:noteText', value),
});
</script>

<template>
  <div class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">我的笔记</span>
      <span class="mc-muted">{{ notes.length }} 条</span>
    </div>
    <div class="notes">
      <div class="mc-field">
        <textarea
          v-model="text"
          class="mc-textarea"
          placeholder="记录这一刻的重点…（可点击笔记时间跳转播放位置）"
          aria-label="笔记内容"
        />
        <div class="mc-row mc-row--between">
          <span class="mc-hint">将记录在当前播放位置 {{ formatTime(currentTime) }}</span>
          <button
            class="mc-btn mc-btn--primary mc-btn--sm"
            type="button"
            :disabled="saving || !noteText.trim()"
            @click="emit('add')"
          >
            保存笔记
          </button>
        </div>
      </div>

      <EmptyState
        v-if="notes.length === 0"
        icon="pen-line"
        title="还没有笔记"
        description="边看边记，复习时可按时间点回看。"
      />
      <ul v-else class="notes__list">
        <li v-for="note in notes" :key="note.id" class="note">
          <button
            class="note__time"
            type="button"
            :title="`跳转到 ${formatTime(note.pos)}`"
            @click="emit('seek', note.pos)"
          >
            {{ formatTime(note.pos) }}
          </button>
          <span class="note__text">{{ note.text }}</span>
          <button class="note__del" type="button" aria-label="删除笔记" @click="emit('remove', note.id)">×</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notes {
  padding: var(--mc-space-4) var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.notes__list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.note__time {
  flex: none;
  border: none;
  background: transparent;
  color: var(--mc-primary-fg);
  font-family: var(--mc-font-mono);
  font-size: var(--mc-text-xs);
  cursor: pointer;
  padding: 0;
}

.note__text {
  flex: 1;
  font-size: var(--mc-text-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.note__del {
  flex: none;
  border: none;
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
  font-size: var(--mc-text-base);
  line-height: var(--mc-leading-display);
}
</style>
