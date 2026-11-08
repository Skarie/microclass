<script setup lang="ts">
import { RouterLink } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import type { Course } from '@/api/types';

/**
 * 课程课时管理页的页头 + 课时动作条：标题/面包屑/统计标签，
 * 以及刷新、抽取时长、上传视频、新建课时、扫描文件夹。
 */
defineProps<{
  course: Course | null;
  lessonCount: number;
  chapterCount: number;
  loading: boolean;
  probing: boolean;
  probeProgress: string;
  scanning: boolean;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'probe'): void;
  (e: 'upload'): void;
  (e: 'create'): void;
  (e: 'scan'): void;
}>();
</script>

<template>
  <PageHeader
    :title="course?.name ?? '课程'"
    description="管理本课程的章节与课时：上传视频、绑定媒体目录批量导入、拖拽排序、维护知识点。"
    icon="video"
    :breadcrumb="[
      { label: '首页', to: '/' },
      { label: '课程管理', to: '/admin/courses' },
      { label: course?.name ?? '课时管理' },
    ]"
  >
    <template #actions>
      <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'admin-courses' }">
        <Icon name="arrow-left" :size="16" />
        课程管理
      </RouterLink>
      <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="emit('refresh')">
        <Icon name="refresh" :size="16" />
        刷新
      </button>
    </template>
    <template #meta>
      <Tag v-if="course" :tone="course.published === 1 ? 'success' : 'warning'" icon="check">
        {{ course.published === 1 ? '已发布' : '草稿' }}
      </Tag>
      <Tag icon="video">{{ lessonCount }} 课时</Tag>
      <Tag icon="list">{{ chapterCount }} 章节</Tag>
      <Tag icon="check-circle">已学完 {{ course?.finished ?? 0 }}</Tag>
      <Tag icon="folder">{{ course?.category_name || '未分类' }}</Tag>
    </template>
  </PageHeader>

  <!-- 课时相关动作条（课程信息已上移到页头，这里不再重复） -->
  <div class="toolbar mc-card">
    <div class="mc-row mc-row--wrap toolbar__top">
      <div class="mc-spacer" />
      <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="emit('refresh')">刷新</button>
      <button
        class="mc-btn mc-btn--sm"
        type="button"
        :disabled="probing || lessonCount === 0"
        :title="lessonCount === 0 ? '还没有课时' : '为还没有元数据的视频抽取时长与封面'"
        @click="emit('probe')"
      >
        {{ probing ? probeProgress || '抽取中…' : '抽取时长/封面' }}
      </button>
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('upload')">
        <Icon name="upload" :size="16" /> 上传视频
      </button>
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('create')">新建课时</button>
      <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="scanning" @click="emit('scan')">
        {{ scanning ? '扫描中…' : '扫描文件夹' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.toolbar__top {
  align-items: center;
}
</style>
