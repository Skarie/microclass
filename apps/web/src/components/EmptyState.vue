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
    <!-- 自查清单 #29 / 35 妙招 #7：空状态要有专门设计，用插画而不是一句话 -->
    <div class="mc-empty__art" aria-hidden="true">
      <svg class="empty__art" viewBox="0 0 200 132" role="presentation" focusable="false">
        <ellipse class="art__shadow" cx="100" cy="118" rx="62" ry="8" />
        <rect class="art__card art__card--back" x="30" y="26" width="140" height="78" rx="14" />
        <rect class="art__card" x="22" y="18" width="140" height="78" rx="14" />
        <rect class="art__line" x="38" y="38" width="74" height="8" rx="4" />
        <rect class="art__line art__line--soft" x="38" y="54" width="104" height="6" rx="3" />
        <rect class="art__line art__line--soft" x="38" y="66" width="86" height="6" rx="3" />
        <circle class="art__dot" cx="152" cy="52" r="12" />
      </svg>
      <span class="mc-empty__icon">
        <Icon v-if="props.icon && isIconName(props.icon)" :name="props.icon" :size="26" />
        <Icon v-else name="book-open" :size="26" />
      </span>
    </div>
    <div class="empty__title">{{ title }}</div>
    <p v-if="description" class="empty__desc">{{ description }}</p>
    <button v-if="actionText" class="mc-btn mc-btn--soft" type="button" @click="emit('action')">
      {{ actionText }}
    </button>
  </div>
</template>

<style scoped>
.mc-empty__art {
  position: relative;
  width: 200px;
  height: 132px;
  margin-bottom: var(--mc-space-4);
}

.empty__art {
  width: 100%;
  height: 100%;
}

.art__shadow {
  fill: var(--mc-surface-2);
}

.art__card {
  fill: var(--mc-bg-elevated);
  stroke: var(--mc-border);
}

.art__card--back {
  fill: var(--mc-primary-soft);
  stroke: var(--mc-primary-border);
}

.art__line {
  fill: var(--mc-primary);
  opacity: 0.55;
}

.art__line--soft {
  fill: var(--mc-border-strong);
  opacity: 0.7;
}

.art__dot {
  fill: var(--mc-accent);
  opacity: 0.85;
}

.mc-empty__icon {
  position: absolute;
  right: 8px;
  bottom: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
  color: var(--mc-primary-fg);
}

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
