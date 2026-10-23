<script setup lang="ts">
/** 页脚：产品说明 / 帮助文档入口 / 版本与版权信息。 */
const appVersion = __APP_VERSION__;
</script>

<template>
  <footer class="footer">
    <div class="footer__cols">
      <section class="footer__col">
        <h2 class="footer__title">微课堂</h2>
        <p class="footer__text">
          自托管轻量学习平台：课程视频、章节归类、课后练习与错题本一体，学习数据保存在你自己的机器上。
        </p>
      </section>
      <nav class="footer__col" aria-label="帮助与文档">
        <h2 class="footer__title">帮助</h2>
        <span class="footer__text">部署维护：docs/deploy.md</span>
        <span class="footer__text">视频与媒体目录：docs/video.md</span>
        <span class="footer__text">界面规范：docs/design-guidelines.md</span>
      </nav>
    </div>
    <div class="footer__bar">
      <span>微课堂 v{{ appVersion }} · 自托管部署</span>
      <span>数据仅存于本机；课程内容版权归各自权利人所有。</span>
    </div>
  </footer>
</template>

<style scoped>
/* ---------- 页脚 ---------- */
.footer {
  padding: var(--mc-space-6) var(--mc-space-5) var(--mc-space-5);
  border-top: 1px solid var(--mc-border);
  background: var(--mc-bg-elevated);
}

.footer__cols {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr);
  gap: var(--mc-space-8);
  max-width: 1200px;
  margin: 0 auto;
}

.footer__col {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  min-width: 0;
}

.footer__title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.footer__text {
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-relaxed);
  color: var(--mc-text-muted);
}

.footer__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2) var(--mc-space-6);
  max-width: 1200px;
  margin: var(--mc-space-4) auto 0;
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

@media (max-width: 900px) {
  .footer__cols {
    grid-template-columns: 1fr;
    gap: var(--mc-space-4);
  }
}
</style>
