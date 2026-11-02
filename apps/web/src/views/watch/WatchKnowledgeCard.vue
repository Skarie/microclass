<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import WatchKnowledgeGroup from './WatchKnowledgeGroup.vue';
import type { Knowledge } from '@/api/types';

/**
 * 侧栏知识点卡：分「本节知识点」与「课程知识点（整门课共享）」两组。
 * 老师/管理员在卡片右上角有「编辑」入口（只编辑课时级知识点；课程级在课程管理页维护）。
 */
const props = defineProps<{
  knowledge: Knowledge[];
  courseKnowledge?: Knowledge[];
  /** 老师 / 管理员才显示编辑按钮 */
  canEdit?: boolean;
}>();

const emit = defineEmits<{ (e: 'edit'): void }>();

function total(): number {
  return props.knowledge.length + (props.courseKnowledge?.length ?? 0);
}
</script>

<template>
  <div class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">知识点</span>
      <div class="head-actions">
        <span class="mc-muted">{{ total() }} 条</span>
        <button v-if="canEdit" class="edit-pill" type="button" @click="emit('edit')">
          <Icon name="edit" :size="14" />
          编辑
        </button>
      </div>
    </div>
    <div class="knowledge">
      <EmptyState
        v-if="total() === 0"
        icon="list"
        title="暂无知识点"
        description="教师可在课时下补充讲义、链接或附件。"
      />
      <template v-else>
        <WatchKnowledgeGroup
          v-if="knowledge.length > 0"
          :items="knowledge"
          :title="courseKnowledge && courseKnowledge.length > 0 ? '本节知识点' : undefined"
        />
        <WatchKnowledgeGroup
          v-if="courseKnowledge && courseKnowledge.length > 0"
          :items="courseKnowledge"
          title="课程知识点"
          caption="整门课共享"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.edit-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-3);
  border: 0;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-primary-fg);
  font: inherit;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  cursor: pointer;
  transition: background var(--mc-transition);
}

.edit-pill:hover {
  background: var(--mc-primary-soft);
}

.edit-pill:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 2px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.knowledge {
  padding: var(--mc-space-4) var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}
</style>
