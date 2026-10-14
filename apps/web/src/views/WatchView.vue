<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import type { Knowledge, Lesson, LessonNote } from '@/api/types';

interface LessonDetailResponse {
  lesson: Lesson;
  knowledge: Knowledge[];
}

const route = useRoute();
const toast = useToastStore();
const lessonId = computed(() => Number(route.params.id));

const videoRef = ref<HTMLVideoElement | null>(null);
const notes = ref<LessonNote[]>([]);
const siblingLessons = ref<Lesson[]>([]);
const noteText = ref('');
const saving = ref(false);
const savedAt = ref<string>('');
const currentTime = ref(0);
const duration = ref(0);

const { data, loading, run } = useAsync<LessonDetailResponse>(() =>
  api.get<LessonDetailResponse>(`/lessons/${lessonId.value}`),
);

const lesson = computed(() => data.value?.lesson ?? null);
const knowledge = computed(() => data.value?.knowledge ?? []);

/** 视频源：本地视频走后端 Range 流，外部链接/嵌入直接用原地址 */
const videoSrc = computed(() => {
  const l = lesson.value;
  if (!l) return '';
  return l.video_kind === 'local' ? `/api/v1/lessons/${l.id}/video` : l.video_path;
});

const isEmbed = computed(() => lesson.value?.video_kind === 'embed');

const watchedPercent = computed(() => {
  if (duration.value > 0) return Math.min(100, Math.round((currentTime.value / duration.value) * 100));
  const p = lesson.value?.progress;
  if (p && p.duration > 0) return Math.min(100, Math.round((p.position / p.duration) * 100));
  return p?.finished === 1 ? 100 : 0;
});

/** 本地视频需看完 80% 才解锁刷题（与后端规则一致） */
const quizUnlocked = computed(() => {
  const l = lesson.value;
  if (!l) return false;
  if (l.video_kind !== 'local') return true;
  if (l.progress?.finished === 1) return true;
  return watchedPercent.value >= 80;
});

const prevLesson = computed(() => {
  const list = siblingLessons.value;
  const index = list.findIndex((l) => l.id === lessonId.value);
  return index > 0 ? list[index - 1] : undefined;
});
const nextLesson = computed(() => {
  const list = siblingLessons.value;
  const index = list.findIndex((l) => l.id === lessonId.value);
  return index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;
});

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 上报进度：本地视频按真实播放位置，外部链接按完成标记 */
async function reportProgress(position: number, total: number, finished: boolean): Promise<void> {
  const l = lesson.value;
  if (!l || l.video_kind === 'embed') return;
  if (!Number.isFinite(position) || position < 0) return;
  try {
    await api.post('/progress', {
      lessonId: l.id,
      position: Math.round(position),
      duration: Math.round(total),
      finished,
    });
    savedAt.value = new Date().toLocaleTimeString('zh-CN');
  } catch (e) {
    // 进度上报失败不打断播放，仅提示一次
    toast.warning('进度保存失败', errorMessage(e));
  }
}

/* ---------------- 观看区间上报（拖到最后不算看完） ---------------- */
const coveredPercent = ref<number | null>(null);
/** 当前这段连续播放的起点；null 表示还没开始/刚 seek 过 */
let segmentStart: number | null = null;

interface IntervalReport {
  coveredSeconds: number;
  duration: number;
  percent: number;
  finished: boolean;
}

/** 把「刚看过的这一段」上报；同时更新播放位置，保证断点续播 */
async function flushIntervals(final = false): Promise<void> {
  const l = lesson.value;
  const video = videoRef.value;
  if (!l || l.video_kind === 'embed' || !video) return;

  const intervals: { start: number; end: number }[] = [];
  const now = video.currentTime;
  if (segmentStart !== null && now > segmentStart + 1) {
    intervals.push({ start: Math.floor(segmentStart), end: Math.floor(now) });
  }
  if (intervals.length === 0 && !final) return;
  segmentStart = now;

  try {
    const res = await api.post<{ ok: true } & IntervalReport>('/progress/intervals', {
      lessonId: l.id,
      position: Math.round(now),
      duration: Math.round(video.duration || 0),
      finished: final && Math.abs(now - (video.duration || 0)) < 1,
      intervals,
    });
    coveredPercent.value = res.percent;
    savedAt.value = new Date().toLocaleTimeString('zh-CN');
  } catch (e) {
    toast.warning('进度保存失败', errorMessage(e));
  }
}

/** 拖动进度条后需要断开当前片段，避免把「跳过的部分」算成看过 */
function onSeeking(): void {
  void flushIntervals();
  segmentStart = videoRef.value?.currentTime ?? null;
}

let timer: number | undefined;

function onTimeUpdate(): void {
  const video = videoRef.value;
  if (!video) return;
  currentTime.value = video.currentTime;
  // 记录连续播放的起点（暂停/拖动时会在别处重置）
  if (segmentStart === null) segmentStart = video.currentTime;
}

function onLoadedMetadata(): void {
  const video = videoRef.value;
  const l = lesson.value;
  if (!video) return;
  duration.value = video.duration || 0;
  const resume = l?.progress?.position ?? 0;
  // 断点续播：距上次位置超过 5 秒且未看完时跳转
  if (resume > 5 && (l?.progress?.finished ?? 0) !== 1 && resume < video.duration - 5) {
    video.currentTime = resume;
    toast.info(`已从 ${formatTime(resume)} 继续播放`);
  }
  segmentStart = video.currentTime;
}

function onPause(): void {
  void flushIntervals();
}

function onEnded(): void {
  const video = videoRef.value;
  if (!video) return;
  void flushIntervals(true);
  toast.success('本课时已学完');
  void run(true);
}

function onPlayEvent(): void {
  if (segmentStart === null) segmentStart = videoRef.value?.currentTime ?? null;
}

function seekTo(seconds: number): void {
  const video = videoRef.value;
  if (!video) return;
  video.currentTime = seconds;
  void video.play().catch(() => undefined);
}

async function loadNotes(): Promise<void> {
  try {
    notes.value = (await api.get<{ notes: LessonNote[] }>(`/lessons/${lessonId.value}/notes`)).notes;
  } catch {
    notes.value = [];
  }
}

async function loadSiblings(): Promise<void> {
  const l = lesson.value;
  if (!l) return;
  try {
    const query = l.course_id === null ? { course: 'orphan' } : { course: l.course_id };
    siblingLessons.value = (await api.get<{ lessons: Lesson[] }>('/lessons', query)).lessons;
  } catch {
    siblingLessons.value = [];
  }
}

async function addNote(): Promise<void> {
  const text = noteText.value.trim();
  if (!text) return;
  saving.value = true;
  try {
    await api.post(`/lessons/${lessonId.value}/notes`, { pos: Math.round(currentTime.value), text });
    noteText.value = '';
    await loadNotes();
    toast.success('笔记已保存');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function removeNote(id: number): Promise<void> {
  try {
    await api.del(`/notes/${id}`);
    await loadNotes();
    toast.success('笔记已删除');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function markFinishedManually(): Promise<void> {
  await reportProgress(duration.value, duration.value, true);
  toast.success('已标记为学完');
  await run(true);
}

function startAutoSave(): void {
  stopAutoSave();
  // 每 15 秒把「刚看过的这一段」上报为观看区间（服务端做去重合并）
  timer = window.setInterval(() => {
    const video = videoRef.value;
    if (!video || video.paused) return;
    void flushIntervals();
  }, 15000);
}

function stopAutoSave(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

onMounted(async () => {
  await run();
  await Promise.all([loadNotes(), loadSiblings()]);
  startAutoSave();
});

onBeforeUnmount(() => {
  stopAutoSave();
  const video = videoRef.value;
  if (video && video.currentTime > 0) {
    void flushIntervals();
  }
});

watch(lessonId, async () => {
  currentTime.value = 0;
  duration.value = 0;
  noteText.value = '';
  await run();
  await Promise.all([loadNotes(), loadSiblings()]);
});
</script>

<template>
  <section v-if="loading && !lesson" class="mc-col">
    <div class="mc-skeleton" style="height: 420px" />
  </section>

  <EmptyState v-else-if="!lesson" icon="video" title="课时不存在" description="它可能已被删除，或链接有误。" />

  <section v-else class="watch">
    <div class="watch__main">
      <header class="watch__header mc-card">
        <div class="mc-col watch__title-block">
          <nav class="watch__crumbs" aria-label="面包屑">
            <RouterLink
              v-if="lesson.course_id !== null"
              class="watch__crumb"
              :to="{ name: 'course', params: { id: lesson.course_id } }"
            >
              <Icon name="arrow-left" :size="14" />
              返回课程
            </RouterLink>
            <template v-if="lesson.group_name">
              <Icon name="chevron-right" :size="13" class="watch__crumb-sep" />
              <span class="watch__crumb">{{ lesson.group_name }}</span>
            </template>
            <Icon name="chevron-right" :size="13" class="watch__crumb-sep" />
            <span class="watch__crumb watch__crumb--current">{{ lesson.title }}</span>
          </nav>
          <div class="mc-row mc-row--wrap watch__title-row">
            <h2 class="watch__title">{{ lesson.title }}</h2>
            <span v-if="lesson.progress?.finished === 1" class="mc-badge mc-badge--success">已学完</span>
          </div>
          <p v-if="lesson.description" class="mc-secondary watch__desc">{{ lesson.description }}</p>
        </div>

        <div class="mc-row mc-row--wrap watch__header-actions">
          <button
            v-if="lesson.video_kind !== 'local'"
            class="mc-btn mc-btn--sm"
            type="button"
            @click="markFinishedManually"
          >
            <Icon name="check" :size="15" />
            标记为已学完
          </button>
          <RouterLink
            class="mc-btn mc-btn--primary mc-btn--sm"
            :class="{ 'watch__quiz-locked': !quizUnlocked }"
            :to="{ name: 'quiz', params: { id: lesson.id } }"
          >
            <Icon name="pen-line" :size="15" />
            课后练习{{ lesson.progress?.quiz_done === 1 ? `（最好 ${lesson.progress.quiz_best}%）` : '' }}
          </RouterLink>
        </div>
      </header>

      <div class="player mc-card">
        <video
          v-if="!isEmbed"
          ref="videoRef"
          class="player__video"
          :src="videoSrc"
          controls
          controlslist="nodownload"
          preload="metadata"
          playsinline
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onLoadedMetadata"
          @pause="onPause"
          @ended="onEnded"
          @play="onPlayEvent"
          @seeking="onSeeking"
        />
        <iframe
          v-else
          class="player__frame"
          :src="videoSrc"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          title="嵌入视频"
        />
      </div>

      <div v-if="!quizUnlocked" class="notice mc-card">
        <Icon name="shield" :size="15" class="watch__lock" />
        <span> 本地视频需看完 <strong>80%</strong> 才能解锁课后练习，当前已观看 {{ watchedPercent }}%。 </span>
      </div>

      <div class="watch__meta mc-card">
        <div class="mc-row mc-row--between">
          <span class="mc-muted">
            观看进度 {{ watchedPercent }}%
            <template v-if="coveredPercent !== null"> · 实际看过 {{ coveredPercent }}%</template>
            <template v-if="duration > 0"> · {{ formatTime(currentTime) }} / {{ formatTime(duration) }}</template>
            <template v-if="savedAt"> · 已自动保存（{{ savedAt }}）</template>
          </span>
          <div class="mc-row">
            <RouterLink
              v-if="prevLesson"
              class="mc-btn mc-btn--sm"
              :to="{ name: 'watch', params: { id: prevLesson.id } }"
            >
              ← 上一节
            </RouterLink>
            <RouterLink
              v-if="nextLesson"
              class="mc-btn mc-btn--sm"
              :to="{ name: 'watch', params: { id: nextLesson.id } }"
            >
              下一节 →
            </RouterLink>
          </div>
        </div>
        <div
          class="mc-progress watch__progress"
          role="progressbar"
          :aria-valuenow="watchedPercent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="mc-progress__bar" :style="{ width: `${watchedPercent}%` }" />
        </div>
      </div>
    </div>

    <aside class="watch__side">
      <div class="mc-card">
        <div class="mc-card__header">
          <span class="mc-card__title">知识点</span>
          <span class="mc-muted">{{ knowledge.length }} 条</span>
        </div>
        <div class="knowledge">
          <EmptyState
            v-if="knowledge.length === 0"
            icon="list"
            title="暂无知识点"
            description="教师可在课时下补充讲义、链接或附件。"
          />
          <ol v-else class="knowledge__list">
            <li v-for="item in knowledge" :key="item.id" class="knowledge__item">
              <template v-if="item.kind === 'link'">
                <a :href="item.url" target="_blank" rel="noopener noreferrer"
                  ><Icon name="arrow-right" :size="14" /> {{ item.title }}</a
                >
              </template>
              <template v-else-if="item.kind === 'file'">
                <a :href="`/api/v1/knowledge/${item.id}/file`" target="_blank" rel="noopener noreferrer">
                  <Icon name="copy" :size="14" /> {{ item.title }}
                </a>
                <span class="mc-muted knowledge__file">{{ item.file_name }}</span>
              </template>
              <template v-else>
                <details>
                  <summary><Icon name="list" :size="14" /> {{ item.title }}</summary>
                  <p class="knowledge__content">{{ item.content }}</p>
                </details>
              </template>
            </li>
          </ol>
        </div>
      </div>

      <div class="mc-card">
        <div class="mc-card__header">
          <span class="mc-card__title">我的笔记</span>
          <span class="mc-muted">{{ notes.length }} 条</span>
        </div>
        <div class="notes">
          <div class="mc-field">
            <textarea
              v-model="noteText"
              class="mc-textarea"
              placeholder="记录这一刻的重点…（可点击笔记时间跳转播放位置）"
              aria-label="笔记内容"
            />
            <div class="mc-row mc-row--between">
              <span class="mc-hint">将记录在当前播放位置 {{ formatTime(currentTime) }}</span>
              <button
                class="mc-btn mc-btn--primary mc-btn--sm"
                type="button"
                :disabled="saving || !noteText.trim()"
                @click="addNote"
              >
                保存笔记
              </button>
            </div>
          </div>

          <EmptyState
            v-if="notes.length === 0"
            icon="pen-line"
            title="还没有笔记"
            description="边看边记，复习时可按时间点回看。"
          />
          <ul v-else class="notes__list">
            <li v-for="note in notes" :key="note.id" class="note">
              <button
                class="note__time"
                type="button"
                :title="`跳转到 ${formatTime(note.pos)}`"
                @click="seekTo(note.pos)"
              >
                {{ formatTime(note.pos) }}
              </button>
              <span class="note__text">{{ note.text }}</span>
              <button class="note__del" type="button" aria-label="删除笔记" @click="removeNote(note.id)">×</button>
            </li>
          </ul>
        </div>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.watch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--mc-space-5);
  align-items: start;
}

.watch__main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  min-width: 0;
}

.watch__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-4);
  padding: var(--mc-space-4) var(--mc-space-5);
}

.watch__title-block {
  gap: var(--mc-space-2);
  min-width: 0;
}

/* 课时上下文：课程 › 章节 › 课时（学生看视频时最常问"我在哪一章"） */
.watch__crumbs {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  min-width: 0;
  flex-wrap: wrap;
}

.watch__crumb {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--mc-text-muted);
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

a.watch__crumb:hover {
  color: var(--mc-primary-fg);
}

.watch__crumb--current {
  color: var(--mc-text-secondary);
  font-weight: var(--mc-font-medium);
}

.watch__crumb-sep {
  color: var(--mc-border-strong);
}

.watch__title-row {
  align-items: center;
  gap: var(--mc-space-2);
}

.watch__lock {
  color: var(--mc-warning-fg);
  vertical-align: -2px;
}

.watch__title {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  letter-spacing: var(--mc-tracking-tight);
}

.watch__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.watch__header-actions {
  flex: none;
}

.watch__quiz-locked {
  opacity: 0.7;
}

.player {
  overflow: hidden;
  background: var(--mc-player-bg);
  box-shadow: var(--mc-elev-raised);
}

.player__video,
.player__frame {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--mc-player-bg);
  border: none;
}

.notice {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  border-color: transparent;
  font-size: var(--mc-text-sm);
}

.watch__meta {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4) var(--mc-space-5);
  font-size: var(--mc-text-sm);
}

.watch__progress {
  height: 8px;
}

.watch__side {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  position: sticky;
  top: calc(var(--mc-topbar-height) + var(--mc-space-4));
}

.knowledge,
.notes {
  padding: var(--mc-space-4) var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.knowledge__list,
.notes__list {
  margin: 0;
  padding-left: var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
}

.notes__list {
  padding-left: 0;
  list-style: none;
}

.knowledge__file {
  display: block;
  font-size: var(--mc-text-xs);
}

.knowledge__content {
  margin: var(--mc-space-2) 0 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  white-space: pre-wrap;
}

.knowledge__item details summary {
  cursor: pointer;
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.note__time {
  flex: none;
  border: none;
  background: transparent;
  color: var(--mc-primary-fg);
  font-family: var(--mc-font-mono);
  font-size: var(--mc-text-xs);
  cursor: pointer;
  padding: 0;
}

.note__text {
  flex: 1;
  font-size: var(--mc-text-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.note__del {
  flex: none;
  border: none;
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}

@media (max-width: 1100px) {
  .watch {
    grid-template-columns: 1fr;
  }

  .watch__side {
    position: static;
  }
}
</style>
