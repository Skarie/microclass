<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';
import WatchHeader from './watch/WatchHeader.vue';
import WatchPlayer from './watch/WatchPlayer.vue';
import WatchMeta from './watch/WatchMeta.vue';
import WatchKnowledgeCard from './watch/WatchKnowledgeCard.vue';
import WatchNotesCard from './watch/WatchNotesCard.vue';
import WatchPracticeCard from './watch/WatchPracticeCard.vue';
import { useWatchLesson } from '@/composables/use-watch-lesson';
import { useWatchPlayback } from '@/composables/use-watch-playback';
import { useWatchProgress } from '@/composables/use-watch-progress';
import { useWatchNotes } from '@/composables/use-watch-notes';
import { useWatchPractice } from '@/composables/use-watch-practice';

/**
 * 观看页只做编排：
 *  - 课时 / 知识点 / 上下节：use-watch-lesson
 *  - 播放器（倍速、快捷键、自动下一节、HLS 优先 MP4 兜底）：use-watch-playback
 *  - 进度上报、观看区间、15 秒自动保存：use-watch-progress
 *  - 笔记：use-watch-notes
 * 界面按区块拆到 ./watch/*。
 */
const route = useRoute();
const lessonId = computed(() => Number(route.params.id));

const lessonState = useWatchLesson(lessonId);
const playback = useWatchPlayback({
  lessonId,
  lesson: () => lessonState.lesson,
  isEmbed: () => lessonState.isEmbed,
  nextLesson: () => lessonState.nextLesson,
});
const progress = useWatchProgress({
  lesson: () => lessonState.lesson,
  player: playback,
  reload: lessonState.reload,
});
const notes = useWatchNotes({ lessonId, currentTime: () => playback.currentTime });
/** 本课时练习：教师通过实践关联挂到本课时的题库 / 章节 / 小节 / 单题 */
const practice = useWatchPractice(lessonId);

/** 课时数据 + 笔记 + 同课程目录（顺序与拆分前一致） */
async function loadPage(): Promise<void> {
  await lessonState.run();
  await Promise.all([notes.loadNotes(), lessonState.loadSiblings()]);
}

onMounted(async () => {
  await loadPage();
  progress.startAutoSave();
  playback.attachHotkeys();
  await playback.loadSourceInfo();
  await playback.setupPlayback();
});

watch(lessonId, async () => {
  playback.reset();
  notes.resetText();
  await loadPage();
  await playback.loadSourceInfo();
  await playback.setupPlayback();
});

onBeforeUnmount(() => {
  playback.destroyHls();
  progress.stopAutoSave();
  playback.detachHotkeys();
  playback.cancelAutoNext();
  playback.disconnectObserver();
  if (playback.videoRef && playback.videoRef.currentTime > 0) {
    void progress.flushIntervals();
  }
});
</script>

<template>
  <section v-if="lessonState.loading && !lessonState.lesson" class="mc-col">
    <div class="mc-skeleton" style="height: 420px" />
  </section>

  <EmptyState
    v-else-if="!lessonState.lesson"
    icon="video"
    title="课时不存在"
    description="它可能已被删除，或链接有误。"
  />

  <section v-else class="watch">
    <div class="watch__main">
      <WatchHeader
        :lesson="lessonState.lesson"
        :quiz-unlocked="playback.quizUnlocked"
        @mark-finished="progress.markFinished"
      />

      <WatchPlayer
        :video-src="lessonState.videoSrc"
        :is-embed="lessonState.isEmbed"
        :next-lesson="lessonState.nextLesson"
        :player="playback"
        :progress="progress"
      />

      <WatchMeta
        :quiz-unlocked="playback.quizUnlocked"
        :watched-percent="playback.watchedPercent"
        :covered-percent="progress.coveredPercent"
        :current-time="playback.currentTime"
        :duration="playback.duration"
        :saved-at="progress.savedAt"
        :prev-lesson="lessonState.prevLesson"
        :next-lesson="lessonState.nextLesson"
        :format-time="playback.formatTime"
      />
    </div>

    <aside class="watch__side">
      <WatchKnowledgeCard :knowledge="lessonState.knowledge" />

      <WatchPracticeCard :practice="practice" :lesson-id="lessonId" />

      <WatchNotesCard
        :notes="notes.notes"
        :note-text="notes.noteText"
        :saving="notes.saving"
        :current-time="playback.currentTime"
        :format-time="playback.formatTime"
        @update:note-text="notes.noteText = $event"
        @add="notes.addNote"
        @remove="notes.removeNote"
        @seek="playback.seekTo"
      />
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

.watch__side {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  position: sticky;
  top: calc(var(--mc-topbar-height) + var(--mc-space-4));
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
