<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Toolbar from '@/components/Toolbar.vue';
import Icon from '@/components/Icon.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Course, CourseStats, Lesson, LessonStats } from '@/api/types';

interface CourseListResponse {
  courses: Course[];
}

interface LessonListResponse {
  lessons: Lesson[];
}

const toast = useToastStore();

const tab = ref<'lesson' | 'course'>('lesson');
const courses = ref<Course[]>([]);
const courseId = ref<number | ''>('');
const lessons = ref<Lesson[]>([]);
const lessonId = ref<number | ''>('');
const lessonsLoading = ref(false);

const lessonStats = ref<LessonStats | null>(null);
const lessonLoading = ref(false);

const courseStats = ref<CourseStats | null>(null);
const courseLoading = ref(false);

async function loadCourses(): Promise<void> {
  try {
    const res = await api.get<CourseListResponse>('/courses');
    courses.value = res.courses;
    const first = res.courses[0];
    if (first && courseId.value === '') courseId.value = first.id;
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function loadLessons(): Promise<void> {
  if (courseId.value === '') {
    lessons.value = [];
    lessonId.value = '';
    lessonStats.value = null;
    return;
  }
  lessonsLoading.value = true;
  try {
    const res = await api.get<LessonListResponse>('/lessons', { course: Number(courseId.value) });
    lessons.value = res.lessons;
    const stillThere = lessons.value.some((l) => l.id === lessonId.value);
    const first = lessons.value[0];
    if (!stillThere && first) lessonId.value = first.id;
    if (lessons.value.length === 0) {
      lessonId.value = '';
      lessonStats.value = null;
    }
  } catch (e) {
    toast.error(errorMessage(e));
    lessons.value = [];
    lessonId.value = '';
    lessonStats.value = null;
  } finally {
    lessonsLoading.value = false;
  }
}

async function loadLessonStats(): Promise<void> {
  if (lessonId.value === '') {
    lessonStats.value = null;
    return;
  }
  lessonLoading.value = true;
  try {
    lessonStats.value = await api.get<LessonStats>(`/stats/lessons/${lessonId.value}`);
  } catch (e) {
    toast.error(errorMessage(e));
    lessonStats.value = null;
  } finally {
    lessonLoading.value = false;
  }
}

async function loadCourseStats(): Promise<void> {
  if (courseId.value === '') {
    courseStats.value = null;
    return;
  }
  courseLoading.value = true;
  try {
    courseStats.value = await api.get<CourseStats>(`/stats/courses/${courseId.value}`);
  } catch (e) {
    toast.error(errorMessage(e));
    courseStats.value = null;
  } finally {
    courseLoading.value = false;
  }
}

async function refresh(): Promise<void> {
  if (tab.value === 'lesson') await loadLessonStats();
  else await loadCourseStats();
}

async function switchTab(next: 'lesson' | 'course'): Promise<void> {
  if (tab.value === next) return;
  tab.value = next;
  if (next === 'lesson') {
    if (lessons.value.length === 0) await loadLessons();
    await loadLessonStats();
  } else {
    await loadCourseStats();
  }
}

async function exportCsv(): Promise<void> {
  if (tab.value === 'lesson') {
    if (lessonId.value === '') {
      toast.warning('请先选择课时');
      return;
    }
    try {
      await api.download(`/stats/lessons/${lessonId.value}.csv`);
      toast.success('课时统计已开始下载');
    } catch (e) {
      toast.error(errorMessage(e));
    }
    return;
  }
  if (courseId.value === '') {
    toast.warning('请先选择课程');
    return;
  }
  try {
    await api.download(`/stats/courses/${courseId.value}.csv`);
    toast.success('课程统计已开始下载');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function formatTime(unixSeconds: number | null): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN');
}

watch(courseId, async () => {
  courseStats.value = null;
  await loadLessons();
  if (tab.value === 'lesson') await loadLessonStats();
  else await loadCourseStats();
});

watch(lessonId, () => {
  if (tab.value === 'lesson') void loadLessonStats();
});

onMounted(async () => {
  await loadCourses();
  await loadLessons();
  await loadLessonStats();
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="学习统计"
      description="按课时或课程查看每位学员的观看时长、完成情况与练习成绩，可导出 CSV 给教研复盘。"
      icon="stats"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '学习统计' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" @click="refresh">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="tab === 'lesson' ? lessonId === '' : courseId === ''"
          @click="exportCsv"
        >
          <Icon name="download" :size="15" />
          导出 CSV
        </button>
      </template>
    </PageHeader>

    <Toolbar>
      <template #left>
        <div class="tabs">
          <button
            class="mc-btn mc-btn--sm"
            :class="{ 'mc-btn--primary': tab === 'lesson' }"
            type="button"
            @click="switchTab('lesson')"
          >
            课时统计
          </button>
          <button
            class="mc-btn mc-btn--sm"
            :class="{ 'mc-btn--primary': tab === 'course' }"
            type="button"
            @click="switchTab('course')"
          >
            课程统计
          </button>
        </div>

        <label class="mc-row toolbar__pick">
          <span class="mc-label">课程</span>
          <select v-model="courseId" class="mc-select" aria-label="选择课程">
            <option value="">请选择课程</option>
            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>

        <label v-if="tab === 'lesson'" class="mc-row toolbar__pick">
          <span class="mc-label">课时</span>
          <select v-model="lessonId" class="mc-select" aria-label="选择课时" :disabled="lessonsLoading">
            <option value="">请选择课时</option>
            <option v-for="l in lessons" :key="l.id" :value="l.id">{{ l.title }}</option>
          </select>
        </label>
      </template>
    </Toolbar>

    <!-- 课时统计 -->
    <template v-if="tab === 'lesson'">
      <section v-if="lessonId === ''" class="mc-card">
        <EmptyState
          icon="stats"
          title="请选择要统计的课时"
          description="选择课程与课时后，可以看到每位学员的观看时长、完成情况与练习成绩。"
        />
      </section>

      <section v-else-if="lessonLoading && !lessonStats" class="mc-card loading">
        <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
      </section>

      <template v-else-if="lessonStats">
        <div class="mc-grid mc-grid--stats">
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.students }}</span>
            <span class="stat__label">学生数</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.watched }}</span>
            <span class="stat__label">已观看</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.finished }}</span>
            <span class="stat__label">已完成</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.not_started }}</span>
            <span class="stat__label">未开始</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.quizzed }}</span>
            <span class="stat__label">已刷题</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.avg }}</span>
            <span class="stat__label">平均分</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ lessonStats.summary.best }}</span>
            <span class="stat__label">最高分</span>
          </div>
        </div>

        <section class="mc-card">
          <div class="mc-card__header">
            <span class="mc-card__title">{{ lessonStats.lesson.title }}</span>
            <span class="mc-muted">{{ lessonStats.summary.not_quizzed }} 人尚未刷题</span>
          </div>

          <div v-if="lessonStats.rows.length === 0" class="mc-card__body">
            <EmptyState
              icon="users"
              title="还没有学员数据"
              description="学员开始观看该课时后，这里会显示每个人的学习进度。"
            />
          </div>

          <div v-else class="mc-table-wrap table-wrap">
            <table class="mc-table mc-table--compact">
              <thead>
                <tr>
                  <th>学号</th>
                  <th>姓名</th>
                  <th>观看</th>
                  <th>完成</th>
                  <th>进度</th>
                  <th>刷题</th>
                  <th>最好成绩</th>
                  <th>次数</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in lessonStats.rows" :key="row.id">
                  <td class="mc-mono">{{ row.username }}</td>
                  <td>{{ row.display_name || '—' }}</td>
                  <td>
                    <span class="mc-badge" :class="row.watched ? 'mc-badge--success' : ''">
                      {{ row.watched ? '已观看' : '未观看' }}
                    </span>
                  </td>
                  <td>
                    <span class="mc-badge" :class="row.finished ? 'mc-badge--success' : 'mc-badge--warning'">
                      {{ row.finished ? '已完成' : '未完成' }}
                    </span>
                  </td>
                  <td>
                    <div class="progress-cell">
                      <div class="mc-progress">
                        <div
                          class="mc-progress__bar"
                          :class="{ 'mc-progress__bar--success': row.finished }"
                          :style="{ width: `${Math.min(100, Math.max(0, row.percent))}%` }"
                        />
                      </div>
                      <span class="mc-muted progress-cell__text">{{ row.percent }}%</span>
                    </div>
                  </td>
                  <td>
                    <span class="mc-badge" :class="row.quiz_done ? 'mc-badge--primary' : ''">
                      {{ row.quiz_done ? '已完成' : '未完成' }}
                    </span>
                  </td>
                  <td>{{ row.best_score }}</td>
                  <td>{{ row.attempts }}</td>
                  <td class="mc-muted">{{ formatTime(row.updated_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <section v-else class="mc-card">
        <EmptyState icon="stats" title="暂时无法加载课时统计" description="请点击右上角刷新重试。" />
      </section>
    </template>

    <!-- 课程统计 -->
    <template v-else>
      <section v-if="courseId === ''" class="mc-card">
        <EmptyState
          icon="stats"
          title="请选择要统计的课程"
          description="选择课程后，可以看到每节课的完成率、刷题率与平均分。"
        />
      </section>

      <section v-else-if="courseLoading && !courseStats" class="mc-card loading">
        <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
      </section>

      <template v-else-if="courseStats">
        <div class="mc-grid mc-grid--stats">
          <div class="stat mc-card">
            <span class="stat__value">{{ courseStats.summary.lessons }}</span>
            <span class="stat__label">课时数</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ courseStats.summary.students }}</span>
            <span class="stat__label">学生数</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ courseStats.summary.avg_finish_rate }}%</span>
            <span class="stat__label">平均完成率</span>
          </div>
          <div class="stat mc-card">
            <span class="stat__value">{{ courseStats.summary.avg_quiz_rate }}%</span>
            <span class="stat__label">平均刷题率</span>
          </div>
        </div>

        <section class="mc-card">
          <div class="mc-card__header">
            <span class="mc-card__title">{{ courseStats.course.name }} · 课时明细</span>
            <span class="mc-muted">共 {{ courseStats.lessons.length }} 个课时</span>
          </div>

          <div v-if="courseStats.lessons.length === 0" class="mc-card__body">
            <EmptyState icon="video" title="该课程还没有课时" description="先到「课时管理」中添加视频课时。" />
          </div>

          <div v-else class="mc-table-wrap table-wrap">
            <table class="mc-table mc-table--compact">
              <thead>
                <tr>
                  <th>章节</th>
                  <th>课时</th>
                  <th>观看</th>
                  <th>完成</th>
                  <th>已刷题</th>
                  <th>完成率</th>
                  <th>刷题率</th>
                  <th>平均分</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in courseStats.lessons" :key="row.id">
                  <td>{{ row.group_name || '未分章' }}</td>
                  <td>
                    <span class="lesson-name">{{ row.title }}</span>
                  </td>
                  <td>{{ row.watched }}</td>
                  <td>{{ row.finished }}</td>
                  <td>{{ row.quizzed }}</td>
                  <td>
                    <div class="progress-cell">
                      <div class="mc-progress">
                        <div
                          class="mc-progress__bar"
                          :class="{ 'mc-progress__bar--success': row.finish_rate >= 100 }"
                          :style="{ width: `${Math.min(100, Math.max(0, row.finish_rate))}%` }"
                        />
                      </div>
                      <span class="mc-muted progress-cell__text">{{ row.finish_rate }}%</span>
                    </div>
                  </td>
                  <td>
                    <div class="progress-cell">
                      <div class="mc-progress">
                        <div
                          class="mc-progress__bar"
                          :style="{ width: `${Math.min(100, Math.max(0, row.quiz_rate))}%` }"
                        />
                      </div>
                      <span class="mc-muted progress-cell__text">{{ row.quiz_rate }}%</span>
                    </div>
                  </td>
                  <td>{{ row.avg_score }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <section v-else class="mc-card">
        <EmptyState icon="stats" title="暂时无法加载课程统计" description="请点击右上角刷新重试。" />
      </section>
    </template>
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.tabs {
  display: inline-flex;
  gap: var(--mc-space-2);
}

.toolbar__pick {
  gap: var(--mc-space-2);
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 46px;
}

.table-wrap {
  max-height: 58vh;
  overflow: auto;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--mc-space-4);
}

.stat__value {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
}

.stat__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.progress-cell {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 140px;
}

.progress-cell .mc-progress {
  flex: 1;
}

.progress-cell__text {
  font-size: var(--mc-text-xs);
  flex: none;
  min-width: 36px;
  text-align: right;
}

.lesson-name {
  display: inline-block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
