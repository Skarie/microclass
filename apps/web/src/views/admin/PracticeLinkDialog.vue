<script setup lang="ts">
/**
 * 关联课时弹窗（一个组件覆盖四种粒度：整个题库 / 章节 / 小节 / 单题）。
 *
 * 交互：先选课程 → 勾选该课程下的课时（可搜索）→ 保存。
 * 已有关联时把旧课时显示成可移除的 chip：保存是覆盖式 PATCH，全部移除则 DELETE。
 * 状态与请求都在 use-practice-links，这里只负责渲染。
 */
import { reactive } from 'vue';
import AppModal from '@/components/AppModal.vue';
import type { usePracticeLinks } from '@/composables/use-practice-links';

const props = defineProps<{ links: ReturnType<typeof usePracticeLinks> }>();
const state = reactive(props.links);
</script>

<template>
  <AppModal :open="state.dialogOpen" :title="state.dialogTitle" width="640px" @close="state.closeDialog">
    <div class="mc-col">
      <p class="pl-target mc-muted">{{ state.targetLabel }}</p>
      <p v-if="state.existingId !== null" class="pl-note">
        当前已关联 {{ state.existingCount }} 个课时；保存会用当前勾选覆盖。
      </p>

      <label class="mc-field">
        <span class="mc-label">① 先选课程</span>
        <select v-model="state.courseId" class="mc-select" aria-label="选择课程" @change="state.onCourseChange">
          <option value="">请选择课程</option>
          <option v-for="course in state.courses" :key="course.id" :value="course.id">{{ course.name }}</option>
        </select>
      </label>

      <template v-if="state.courseId !== ''">
        <label class="mc-field">
          <span class="mc-label">② 勾选课时（可多选）</span>
          <input
            v-model.trim="state.lessonKeyword"
            class="mc-input"
            type="search"
            placeholder="搜索课时标题或章节"
            aria-label="搜索课时"
          />
        </label>

        <div v-if="state.lessonsLoading" class="pl-list">
          <div v-for="i in 3" :key="i" class="mc-skeleton pl-skeleton" />
        </div>
        <ul v-else-if="state.visibleLessons.length > 0" class="pl-list">
          <li v-for="lesson in state.visibleLessons" :key="lesson.id">
            <label class="pl-item">
              <input
                type="checkbox"
                :checked="state.isLessonSelected(lesson.id)"
                @change="state.toggleLesson(lesson.id)"
              />
              <span class="pl-item__title" :title="lesson.title">{{ lesson.title }}</span>
              <span v-if="lesson.group_name" class="pl-item__group mc-muted">{{ lesson.group_name }}</span>
            </label>
          </li>
        </ul>
        <p v-else class="mc-hint">该课程下没有匹配的课时，换个课程或关键词试试。</p>
      </template>
      <p v-else class="mc-hint">先选课程，再勾选要关联的课时。</p>

      <div v-if="state.selectedLessons.length > 0" class="mc-col pl-picked">
        <span class="mc-label">已选 {{ state.selectedLessons.length }} 个课时</span>
        <div class="mc-row mc-row--wrap pl-chips">
          <span v-for="lesson in state.selectedLessons" :key="lesson.id" class="pl-chip">
            {{ lesson.title }}
            <button
              class="pl-chip__remove"
              type="button"
              :aria-label="`移除 ${lesson.title}`"
              @click="state.toggleLesson(lesson.id)"
            >
              ×
            </button>
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="state.closeDialog">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="state.saving" @click="state.save">
        {{ state.saving ? '保存中…' : '保存关联' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped src="./practice-link-dialog.css"></style>
