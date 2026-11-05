<script setup lang="ts">
/**
 * 空状态占位：统一「图标 32px 主色软底圆形 + 标题 15/600 + 描述 13 muted + 主操作」。
 * 全站（首页/大厅/题库/错题本/学情）共用这一套，不再各页自己画插画或只放一句话。
 *
 * `icon` 传图标名（推荐，见 components/icons.ts）；为了兼容既有调用，
 * 也接受其它字符串（会回退到 book-open，避免模板报错）。
 */
import Icon from './Icon.vue';
import { ICONS, type IconName } from './icons';

const props = withDefaults(
  defineProps<{
    icon?: string;
    title: string;
    description?: string;
    actionText?: string;
  }>(),
  { icon: 'book-open', description: '', actionText: '' },
);
const emit = defineEmits<{ action: [] }>();

const isIconName = (v: string): v is IconName => Object.prototype.hasOwnProperty.call(ICONS, v);
</script>

<template>
  <div class="empty">
    <span class="empty__icon" aria-hidden="true">
      <Icon :name="isIconName(props.icon) ? props.icon : 'book-open'" :size="32" />
    </span>
    <div class="empty__title">{{ title }}</div>
    <p v-if="description" class="empty__desc">{{ description }}</p>
    <button v-if="actionText" class="mc-btn mc-btn--primary empty__action" type="button" @click="emit('action')">
      {{ actionText }}
    </button>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-10) var(--mc-space-4);
  text-align: center;
}

.empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.empty__title {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text);
}

.empty__desc {
  margin: 0;
  max-width: 460px;
  font-size: 13px;
  line-height: var(--mc-leading);
  color: var(--mc-text-muted);
}

.empty__action {
  margin-top: var(--mc-space-1);
}
</style>
