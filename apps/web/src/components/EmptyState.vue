<script setup lang="ts">
/**
 * 空状态占位：统一图标、标题、说明与可选操作按钮。
 *
 * `icon` 传图标名（推荐，见 components/icons.ts）；为了兼容既有调用，
 * 也接受 emoji 之类的任意字符串（会按文本渲染）。
 */
import Icon from './Icon.vue';
import { ICONS, type IconName } from './icons';

const props = defineProps<{
  icon?: string;
  title: string;
  description?: string;
  actionText?: string;
}>();
const emit = defineEmits<{ action: [] }>();

const isIconName = (v: string): v is IconName => Object.prototype.hasOwnProperty.call(ICONS, v);
</script>

<template>
  <div class="mc-empty">
    <div class="mc-empty__icon" aria-hidden="true">
      <Icon v-if="props.icon && isIconName(props.icon)" :name="props.icon" :size="26" />
      <Icon v-else name="book-open" :size="26" />
    </div>
    <div class="empty__title">{{ title }}</div>
    <p v-if="description" class="empty__desc">{{ description }}</p>
    <button v-if="actionText" class="mc-btn mc-btn--soft" type="button" @click="emit('action')">
      {{ actionText }}
    </button>
  </div>
</template>

<style scoped>
.empty__title {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.empty__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
  max-width: 460px;
}
</style>
