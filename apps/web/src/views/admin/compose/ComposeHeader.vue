<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';

/**
 * 组卷页顶部：标题 + 三个动作（返回列表 / 细目表配题 / 打印预览）。
 * 打印与配题在试卷为空时禁用（与拆分前一致）。
 */
defineProps<{ title: string; paperCount: number }>();
const emit = defineEmits<{
  back: [];
  blueprint: [];
  print: [];
}>();
</script>

<template>
  <PageHeader :title="`组卷：${title}`" icon="exam">
    <template #actions>
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('back')">
        <Icon name="arrow-left" :size="15" />
        返回考试列表
      </button>
      <button class="mc-btn mc-btn--sm" type="button" :disabled="paperCount === 0" @click="emit('blueprint')">
        <Icon name="grid" :size="15" />
        按细目表配题
      </button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="paperCount === 0"
        @click="emit('print')"
      >
        <Icon name="print" :size="15" />
        打印预览
      </button>
    </template>
  </PageHeader>
</template>
