<script setup lang="ts">
/**
 * 登录页左侧品牌区：极浅品牌底色 + 产品名 + 一句话价值 + 3 条特性。
 * 不用大渐变/光斑：品牌感靠色块、字阶与细线；移动端整块隐藏（表单卡顶部另有小品牌头）。
 */
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';

defineProps<{ siteName: string }>();

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: 'courses', title: '课程有结构', text: '课程 → 章节 → 课时，按顺序学，进度自动记。' },
  { icon: 'bank', title: '练习有反馈', text: '题库组卷、自动判分，错题自动收进错题本。' },
  { icon: 'chartBar', title: '学习有记录', text: '观看时长与完成度留在本机，随时回看。' },
];
</script>

<template>
  <aside class="brand">
    <div class="brand__inner">
      <header class="brand__head">
        <span class="brand__logo" aria-hidden="true">微</span>
        <span class="brand__name">{{ siteName }}</span>
      </header>

      <div class="brand__pitch">
        <h2 class="brand__title">看的每一分钟，<br />都算数。</h2>
        <p class="brand__sub">课程、练习与学习记录，都在本机。</p>
      </div>

      <ul class="brand__features">
        <li v-for="f in features" :key="f.title" class="brand__feature">
          <span class="brand__icon" aria-hidden="true"><Icon :name="f.icon" :size="18" /></span>
          <span class="brand__feature-text">
            <strong>{{ f.title }}</strong>
            <span>{{ f.text }}</span>
          </span>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--mc-space-12);
  background: var(--mc-primary-soft);
  border-right: 1px solid var(--mc-primary-border);
}

.brand__inner {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-8);
  width: min(400px, 100%);
}

.brand__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
}

.brand__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--mc-radius-md);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-bold);
}

.brand__name {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-primary-fg);
}

.brand__title {
  margin: 0;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
}

.brand__sub {
  margin: var(--mc-space-3) 0 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  color: var(--mc-text-secondary);
}

.brand__features {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  margin: 0;
  padding: var(--mc-space-5) 0 0;
  border-top: 1px solid var(--mc-primary-border);
  list-style: none;
}

.brand__feature {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
}

.brand__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
  flex: none;
}

.brand__feature-text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text-muted);
}

.brand__feature-text strong {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}
</style>
