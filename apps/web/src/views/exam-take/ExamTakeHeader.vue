<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';

/** 答题页页头：标题 / 说明 / 面包屑 / 返回大厅（已交卷状态复用同一份）。 */
defineProps<{ title: string; description: string }>();
</script>

<template>
  <PageHeader
    :title="`在线考试 · ${title}`"
    :description="description"
    icon="exam"
    :breadcrumb="[{ label: '课程大厅', to: '/' }, { label: '在线考试' }]"
  >
    <template #actions>
      <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'hall' }">
        <Icon name="hall" :size="15" />
        返回课程大厅
      </RouterLink>
    </template>
  </PageHeader>
</template>
