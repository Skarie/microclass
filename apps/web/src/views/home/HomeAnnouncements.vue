<script setup lang="ts">
/**
 * 首页 · 公告：登录可读，最多显示 2 条。
 *
 * - 级别决定左侧图标与软色底：info=主色、warning=琥珀、danger=砖红；
 * - 置顶显示「置顶」小标签，时间用相对时间（今天 / 昨天 / N 天前），摘要是正文前 60 字；
 * - 没有公告时整个模块不渲染（v-if），不占位也不显示空卡片；
 * - 点击条目用弹窗看全文（HomeAnnouncementDialog）。
 */
import { computed, onMounted, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import HomeAnnouncementDialog from './HomeAnnouncementDialog.vue';
import { useAnnouncements } from '@/composables/use-announcements';
import { levelMeta, relativeDay, summaryOf } from '@/utils/announcement';
import type { Announcement } from '@/api/announcement';

const { items, load } = useAnnouncements(5);
const shown = computed(() => items.value.slice(0, 2));
const active = ref<Announcement | null>(null);

onMounted(() => void load());
</script>

<template>
  <section v-if="shown.length > 0" class="ann" aria-label="公告">
    <ul class="ann__list">
      <li v-for="item in shown" :key="item.id" class="ann__cell">
        <button
          class="ann__item"
          type="button"
          :class="`ann__item--${item.level}`"
          :aria-label="`查看公告：${item.title}`"
          @click="active = item"
        >
          <span class="ann__icon" aria-hidden="true">
            <Icon :name="levelMeta(item.level).icon" :size="18" />
          </span>

          <span class="ann__main">
            <span class="ann__head">
              <span class="ann__title">{{ item.title }}</span>
              <Tag v-if="item.pinned" tone="warning" size="sm">置顶</Tag>
              <span class="ann__time">{{ relativeDay(item.createdAt) }}</span>
            </span>
            <span class="ann__body">{{ summaryOf(item.body) }}</span>
          </span>

          <Icon class="ann__more" name="chevron-right" :size="16" />
        </button>
      </li>
    </ul>

    <HomeAnnouncementDialog :open="active !== null" :item="active" @close="active = null" />
  </section>
</template>

<style scoped>
.ann__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--mc-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 整条可点：按钮自身就是卡片，hover 只改描边，不做位移动效 */
.ann__item {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
  width: 100%;
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  color: var(--mc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: var(--mc-transition-all);
}

.ann__item--info {
  border-color: var(--mc-primary-border);
  background: var(--mc-primary-soft);
}

.ann__item--warning {
  border-color: var(--mc-warning-border);
  background: var(--mc-warning-soft);
}

.ann__item--danger {
  border-color: var(--mc-border-strong);
  background: var(--mc-danger-soft);
}

@media (hover: hover) and (pointer: fine) {
  .ann__item:hover {
    border-color: var(--mc-primary);
  }
}

.ann__item:focus-visible {
  outline: none;
  box-shadow: var(--mc-focus-ring);
}

.ann__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-elevated);
}

.ann__item--info .ann__icon {
  color: var(--mc-primary-fg);
}

.ann__item--warning .ann__icon {
  color: var(--mc-warning-fg);
}

.ann__item--danger .ann__icon {
  color: var(--mc-danger-fg);
}

.ann__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.ann__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.ann__title {
  overflow: hidden;
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
  color: var(--mc-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann__time {
  flex: none;
  margin-left: auto;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.ann__body {
  overflow: hidden;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann__more {
  flex: none;
  color: var(--mc-text-muted);
}

/* 窄屏：标题允许两行，时间被挤到下一行右侧，不再把标题压成半句话 */
@media (max-width: 900px) {
  .ann__head {
    flex-wrap: wrap;
  }

  .ann__title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
  }

  .ann__time {
    margin-left: auto;
  }
}
</style>
