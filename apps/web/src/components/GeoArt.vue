<script setup lang="ts">
/**
 * 主色横幅右侧的单色几何装饰：同心圆 + 弧线 + 点阵。
 * 只描边、不填色块（shape 之外没有画面），颜色跟 currentColor，透明度由 CSS 控制。
 */
</script>

<template>
  <div class="geo" aria-hidden="true">
    <svg class="geo__svg" viewBox="0 0 360 260" preserveAspectRatio="xMidYMid slice">
      <circle cx="238" cy="74" r="96" class="geo__ring" />
      <circle cx="238" cy="74" r="62" class="geo__ring geo__ring--thin" />
      <circle cx="238" cy="74" r="24" class="geo__core" />
      <path d="M18 260A196 196 0 0 1 214 64" class="geo__arc" />
      <path d="M286 260 360 186" class="geo__line" />
      <path d="M322 260 360 222" class="geo__line" />
      <path d="M36 40h132" class="geo__dots" />
      <path d="M36 58h84" class="geo__dots" />
      <circle cx="338" cy="120" r="5" class="geo__dot" />
      <circle cx="338" cy="146" r="5" class="geo__dot" />
    </svg>
  </div>
</template>

<style scoped>
.geo {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: var(--mc-hero-fg);
  pointer-events: none;
}

.geo__svg {
  position: absolute;
  top: 0;
  right: 0;
  width: min(52%, 520px);
  height: 100%;
}

.geo__ring {
  fill: none;
  stroke: currentcolor;
  stroke-opacity: 0.16;
  stroke-width: 1.5;
}

.geo__ring--thin {
  stroke-opacity: 0.1;
}

.geo__core {
  fill: currentcolor;
  opacity: 0.1;
}

.geo__arc {
  fill: none;
  stroke: currentcolor;
  stroke-opacity: 0.14;
  stroke-width: 1.5;
}

.geo__line {
  stroke: currentcolor;
  stroke-opacity: 0.16;
  stroke-width: 1.5;
}

.geo__dots {
  stroke: currentcolor;
  stroke-opacity: 0.2;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 0 9;
}

.geo__dot {
  fill: currentcolor;
  opacity: 0.22;
}

@media (max-width: 720px) {
  .geo__svg {
    width: 92%;
    opacity: 0.7;
  }
}
</style>
