<script setup lang="ts">
import ToastHost from '@/components/ToastHost.vue';
</script>

<template>
  <a class="mc-skip-link" href="#mc-main">跳到主要内容</a>
  <RouterView />
  <ToastHost />
</template>
