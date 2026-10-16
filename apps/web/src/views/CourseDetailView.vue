<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import ProgressBar from '@/components/ProgressBar.vue';
import Icon from '@/components/Icon.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Course, Exam, Lesson } from '@/api/types';

interface CourseDetailResponse {
  course: Course & { fav: boolean };
  lessons: Lesson[];
}

interface ExamsResponse {
  exams: Exam[];
}

const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();
const courseId = computed(() => Number(route.params.id));

const { data, loading, run } = useAsync<CourseDetailResponse>(() =>
  api.get<CourseDetailResponse>(`/courses/${courseId.value}`),
);
const exams = ref<Exam[]>([]);

async function loadExams(): Promise<void> {
  try {
    exams.value = (await api.get<ExamsResponse>(`/courses/${courseId.value}/exams`)).exams;
  } catch {
    exams.value = [];
  }
}
void loadExams();
watch(courseId, () => {
  void run();
  void loadExams();
});

/** 按章节分组：group_name 为空的归入「未分章」 */
const chapters = computed(() => {
  const lessons = data.value?.lessons ?? [];
  const map = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key = lesson.group_name || '未分章';
    const list = map.get(key);
    if (list) list.push(lesson);
    else map.set(key, [lesson]);
  }
  return [...map.entries()].map(([name, items]) => ({ name, lessons: items }));
});

const stats = computed(() => {
  const lessons = data.value?.lessons ?? [];
  const finished = lessons.filter((l) => l.progress?.finished === 1).length;
  const quizzed = lessons.filter((l) => l.progress?.quiz_done === 1).length;
  const total = lessons.length;
  return {
    total,
    finished,
    quizzed,
    percent: total === 0 ? 0 : Math.round((finished / total) * 100),
  };
});

/** 继续学习的目标课时：第一个未完成的课时，全部完成则回到第一节 */
const resumeLesson = computed<Lesson | undefined>(() => {
  const lessons = data.value?.lessons ?? [];
  return lessons.find((l) => l.progress?.finished !== 1) ?? lessons[0];
});

function lessonState(lesson: Lesson): { label: string; cls: string } {
  if (lesson.progress?.finished === 1) return { label: '已学完', cls: 'mc-badge--success' };
  if ((lesson.progress?.position ?? 0) > 0) return { label: '学习中', cls: 'mc-badge--primary' };
  return { label: '未开始', cls: '' };
}

function progressPercent(lesson: Lesson): number {
  const p = lesson.progress;
  if (!p || p.duration <= 0) return p?.finished === 1 ? 100 : 0;
  return Math.min(100, Math.round((p.position / p.duration) * 100));
}

async function toggleFav(): Promise<void> {
  const course = data.value?.course;
  if (!course) return;
  try {
    const res = await api.post<{ fav: boolean }>(`/courses/${course.id}/fav`);
    course.fav = res.fav;
    toast.success(res.fav ? '已收藏' : '已取消收藏');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
</script>

<template>
  <section v-if="loading && !data" class="mc-col">
    <div class="mc-skeleton detail__hero" />
    <div class="mc-skeleton" style="height: 200px" />
  </section>

  <EmptyState
    v-else-if="!data"
    icon="x-circle"
    title="课程不存在或没有访问权限"
    description="它可能已被删除，或仍是未发布的草稿。"
  />

  <section v-else class="detail mc-col">
    <nav class="detail__crumbs" aria-label="面包屑">
      <RouterLink class="detail__crumb" :to="{ name: 'hall' }">
        <Icon name="hall" :size="14" />
        课程大厅
      </RouterLink>
      <Icon name="chevron-right" :size="13" class="detail__crumb-sep" />
      <span class="detail__crumb detail__crumb--current">{{ data.course.name }}</span>
    </nav>

    <header class="detail__hero mc-card">
      <div class="detail__cover">
        <img v-if="data.course.cover" :src="`/api/v1/course-cover/${data.course.id}`" :alt="data.course.name" />
        <span v-else class="detail__cover-fallback" aria-hidden="true"><Icon name="graduation" :size="34" /></span>
      </div>

      <div class="detail__info">
        <div class="mc-row mc-row--wrap">
          <h2 class="detail__title">{{ data.course.name }}</h2>
          <span v-if="data.course.published !== 1" class="mc-badge mc-badge--warning">草稿（仅教师可见）</span>
          <span v-if="data.course.category_name" class="mc-badge">{{ data.course.category_name }}</span>
        </div>
        <p class="mc-secondary detail__desc">{{ data.course.description || '暂无课程简介' }}</p>

        <div class="detail__stats">
          <div
            class="mc-progress detail__bar"
            role="progressbar"
            :aria-valuenow="stats.percent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="mc-progress__bar"
              :class="{ 'mc-progress__bar--success': stats.percent >= 100 }"
              :style="{ width: `${stats.percent}%` }"
            />
          </div>
          <span class="mc-muted detail__stats-text">
            共 {{ stats.total }} 课时 · 已学完 {{ stats.finished }} · 已练习 {{ stats.quizzed }} · 进度
            {{ stats.percent }}%
          </span>
        </div>

        <div class="mc-row mc-row--wrap">
          <RouterLink
            v-if="resumeLesson"
            class="mc-btn mc-btn--primary"
            :to="{ name: 'watch', params: { id: resumeLesson.id } }"
          >
            {{ stats.finished > 0 ? '继续学习' : '开始学习' }}
          </RouterLink>
          <button class="mc-btn" type="button" @click="toggleFav">
            <Icon name="star" :size="15" :filled="Boolean(data.course.fav)" />
            {{ data.course.fav ? '已收藏' : '收藏' }}
          </button>
          <RouterLink
            v-if="auth.isTeacher"
            class="mc-btn"
            :to="{ name: 'admin-course-lessons', params: { id: courseId } }"
          >
            管理课时
          </RouterLink>
        </div>
      </div>
    </header>

    <section v-if="exams.length > 0" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">课程考试</span>
        <span class="mc-muted">{{ exams.length }} 场</span>
      </div>
      <ul class="exam-list">
        <li v-for="exam in exams" :key="exam.id" class="exam-item">
          <div class="mc-col exam-item__info">
            <div class="mc-row mc-row--wrap">
              <strong>{{ exam.title }}</strong>
              <span v-if="exam.status !== 'published'" class="mc-badge mc-badge--warning">未发布</span>
              <span class="mc-badge">{{ exam.qcount ?? exam.question_count ?? 0 }} 题</span>
              <span class="mc-badge">限时 {{ exam.duration_minutes }} 分钟</span>
              <span class="mc-badge">及格线 {{ exam.pass_score }}%</span>
            </div>
            <span class="mc-muted mc-clamp-2">{{ exam.description || '暂无考试说明' }}</span>
          </div>

          <div class="exam-item__action">
            <template v-if="exam.my">
              <span class="mc-badge" :class="exam.my.passed === 1 ? 'mc-badge--success' : 'mc-badge--danger'">
                {{ exam.my.score }}/{{ exam.my.total }} {{ exam.my.passed === 1 ? '及格' : '不及格' }}
              </span>
              <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'exam-result', params: { id: exam.id } }"
                >查看成绩</RouterLink
              >
            </template>
            <RouterLink
              v-else-if="exam.status === 'published'"
              class="mc-btn mc-btn--primary mc-btn--sm"
              :to="{ name: 'exam-take', params: { id: exam.id } }"
            >
              开始考试
            </RouterLink>
            <RouterLink v-else class="mc-btn mc-btn--sm" :to="{ name: 'admin-exams', query: { exam: String(exam.id) } }"
              >去组卷</RouterLink
            >
          </div>
        </li>
      </ul>
    </section>

    <section class="chapters mc-col">
      <EmptyState
        v-if="chapters.length === 0"
        icon="video"
        title="该课程还没有课时"
        description="教师可在「课时管理」中添加视频，或从媒体目录批量导入。"
      />

      <article v-for="chapter in chapters" :key="chapter.name" class="mc-card chapter">
        <div class="mc-card__header">
          <span class="mc-card__title">{{ chapter.name }}</span>
          <span class="mc-muted">{{ chapter.lessons.length }} 课时</span>
        </div>
        <ul class="lesson-list">
          <li v-for="(lesson, index) in chapter.lessons" :key="lesson.id" class="lesson">
            <RouterLink class="lesson__main" :to="{ name: 'watch', params: { id: lesson.id } }">
              <span class="lesson__index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="lesson__text">
                <span class="lesson__title">{{ lesson.title }}</span>
                <span class="mc-muted lesson__meta">
                  {{
                    lesson.video_kind === 'local' ? '本地视频' : lesson.video_kind === 'embed' ? '嵌入播放' : '外部链接'
                  }}
                  <template v-if="lesson.progress?.quiz_done === 1">
                    · 练习最好成绩 {{ lesson.progress.quiz_best }}%</template
                  >
                </span>
                <ProgressBar
                  v-if="progressPercent(lesson) > 0"
                  class="lesson__bar"
                  :value="progressPercent(lesson)"
                  :tone="lesson.progress?.finished === 1 ? 'success' : 'primary'"
                  :label="`${progressPercent(lesson)}%`"
                  :aria-label="`${lesson.title} 观看进度`"
                />
              </span>
            </RouterLink>
            <div class="lesson__actions">
              <span class="mc-badge" :class="lessonState(lesson).cls">{{ lessonState(lesson).label }}</span>
              <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'quiz', params: { id: lesson.id } }"
                >课后练习</RouterLink
              >
            </div>
          </li>
        </ul>
      </article>
    </section>
  </section>
</template>

<style scoped>
.detail__hero {
  display: flex;
  gap: var(--mc-space-6);
  padding: var(--mc-space-6);
}

.detail__hero.mc-skeleton {
  height: 200px;
}

.detail__cover {
  flex: none;
  width: 220px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
  overflow: hidden;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  color: var(--mc-primary-fg);
  opacity: 0.9;
}

.detail__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail__info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.detail__title {
  font-size: var(--mc-text-xl);
}

.detail__desc {
  margin: 0;
  max-width: 760px;
}

.detail__stats {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  max-width: 520px;
}

.detail__bar {
  height: 8px;
}

.detail__stats-text {
  font-size: var(--mc-text-xs);
}

.exam-list,
.lesson-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.exam-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-4);
  padding: var(--mc-space-4) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
}

.exam-item:last-child {
  border-bottom: none;
}

.exam-item__info {
  gap: var(--mc-space-1);
}

.exam-item__action {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.lesson {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-4);
  padding: var(--mc-space-3) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
  transition: background var(--mc-transition);
}

.lesson:last-child {
  border-bottom: none;
}

.lesson:hover {
  background: var(--mc-bg-hover);
}

.lesson__main {
  display: flex;
  align-items: center;
  gap: var(--mc-space-4);
  flex: 1;
  min-width: 0;
  color: inherit;
}

.lesson__index {
  font-family: var(--mc-font-mono);
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
  flex: none;
}

.lesson__text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  flex: 1;
}

.lesson__title {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-medium);
}

.lesson__meta {
  font-size: var(--mc-text-xs);
}

.lesson__bar {
  height: 4px;
  max-width: 320px;
  margin-top: 4px;
}

.lesson__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex: none;
}

@media (max-width: 900px) {
  .detail__hero {
    flex-direction: column;
  }

  .detail__cover {
    width: 100%;
  }

  .lesson {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
