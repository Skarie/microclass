<script setup lang="ts">
/**
 * 题组详情（题库页「题组」视图的右栏）：
 * 组信息 + 计数 + 组内题目（母题在前、变式按 sort），支持「加入题目」「移出」「重命名」「删除」。
 *
 * 题目只在这里展示关系与角色；改题干请回「题目」视图，避免两个地方都能编辑造成困惑。
 */
import { computed } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import DifficultyBadge from '@/components/DifficultyBadge.vue';
import { ROLE_LABEL } from '@/api/question-group';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { QuestionGroupDetail } from '@/api/question-group';

const props = defineProps<{
  detail: QuestionGroupDetail | null;
  loading: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  add: [];
  'remove-item': [questionId: number];
  rename: [];
  remove: [];
}>();

const menuItems: MenuItem[] = [
  { key: 'rename', label: '重命名 / 改备注', icon: 'edit' },
  { key: 'delete', label: '删除题组', icon: 'trash', danger: true },
];

const counts = computed(() => {
  const detail = props.detail;
  return `${detail?.roleCounts.stem ?? 0} 母题 · ${detail?.roleCounts.variant ?? 0} 变式 · 共 ${detail?.total ?? 0} 题`;
});

function onMenu(key: string): void {
  if (key === 'rename') emit('rename');
  else if (key === 'delete') emit('remove');
}
</script>

<template>
  <section class="mc-card gd">
    <div class="mc-card__header gd__head">
      <div class="gd__headline">
        <span class="mc-card__title mc-truncate">{{ detail ? detail.title : '题组详情' }}</span>
        <span class="gd__counts">{{ counts }}</span>
      </div>
      <div class="gd__actions">
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="!detail || busy"
          @click="emit('add')"
        >
          <Icon name="plus" :size="16" />
          加入题目
        </button>
        <DropdownMenu v-if="detail" :items="menuItems" label="更多" :icon="null" variant="ghost" @select="onMenu" />
      </div>
    </div>

    <div class="mc-card__body mc-col">
      <p v-if="detail?.note" class="gd__note">{{ detail.note }}</p>

      <EmptyState
        v-if="!detail && !loading"
        icon="list"
        title="选择一个题组"
        description="左侧列出的题组可以点开查看：组里哪道是母题、哪些是变式，以及它们在本组里的顺序。"
      />

      <div v-else-if="loading && !detail" class="gd__skeleton">
        <div v-for="i in 4" :key="i" class="mc-skeleton gd__skeleton-row" />
      </div>

      <EmptyState
        v-else-if="detail && detail.questions.length === 0"
        icon="plus"
        title="这个题组还没有题目"
        description="点右上角「加入题目」，从任意题库挑几道题进来；第一道建议设为母题，其余设为变式。"
        action-text="加入题目"
        @action="emit('add')"
      />

      <ol v-else-if="detail" class="gd__list">
        <li v-for="(question, index) in detail.questions" :key="question.id" class="gd__row">
          <span class="gd__no">{{ index + 1 }}</span>
          <span class="mc-badge gd__role" :class="question.role === 'stem' ? 'gd__role--stem' : ''">
            {{ ROLE_LABEL[question.role] }}
          </span>
          <div class="gd__stem">
            <RichText class="gd__stemtext" :text="question.stem" />
            <DifficultyBadge :difficulty="question.difficulty" />
          </div>
          <button
            class="mc-btn mc-btn--ghost mc-btn--sm gd__remove"
            type="button"
            :disabled="busy"
            @click="emit('remove-item', question.id)"
          >
            移出
          </button>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped src="./question-group-detail.css"></style>
