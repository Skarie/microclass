<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import type { Lesson } from '@/api/types';
import type { useWatchPlayback } from '@/composables/use-watch-playback';
import type { useWatchProgress } from '@/composables/use-watch-progress';

/**
 * 观看页播放器卡片：视频 / 嵌入 iframe、倍速与快捷键工具条、播完自动下一节横幅。
 * 播放能力在 use-watch-playback，进度上报在 use-watch-progress，这里只绑 DOM 事件。
 */
const props = defineProps<{
  videoSrc: string;
  isEmbed: boolean;
  nextLesson: Lesson | undefined;
  player: ReturnType<typeof useWatchPlayback>;
  progress: ReturnType<typeof useWatchProgress>;
}>();

function onLoadedMetadata(e: Event): void {
  const video = e.target as HTMLVideoElement;
  props.player.onLoadedMetadata(video);
  props.progress.onLoadedMetadata(video);
}
</script>

<template>
  <div class="player mc-card">
    <video
      v-if="!isEmbed"
      :ref="player.setVideo"
      class="player__video"
      :src="videoSrc"
      controls
      controlslist="nodownload"
      preload="metadata"
      playsinline
      @timeupdate="progress.onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @pause="progress.onPause"
      @ended="progress.onEnded"
      @play="progress.onPlayEvent"
      @seeking="progress.onSeeking"
    />
    <iframe
      v-else
      class="player__frame"
      :src="videoSrc"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
      title="嵌入视频"
    />

    <div v-if="!isEmbed" class="player__tools">
      <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="player.rewind(15)">
        <Icon name="reset" :size="14" />
        后退 15 秒
      </button>
      <div class="player__rates" role="group" aria-label="播放速度">
        <button
          v-for="r in player.rates"
          :key="r"
          class="mc-btn mc-btn--sm"
          :class="player.rate === r ? 'mc-btn--primary' : 'mc-btn--ghost'"
          type="button"
          :aria-pressed="player.rate === r"
          @click="player.setRate(r)"
        >
          {{ r }}×
        </button>
      </div>
      <span class="player__hint mc-muted">
        空格 播放/暂停 · ← → 快退/快进 5 秒 · f 全屏 · m 静音 · &lt; &gt; 调速
      </span>
    </div>

    <div v-if="player.autoNextIn > 0 && nextLesson" class="player__next">
      <span>
        <strong class="mc-num">{{ player.autoNextIn }}</strong> 秒后播放下一节：{{ nextLesson.title }}
      </span>
      <button class="mc-btn mc-btn--sm mc-btn--primary" type="button" @click="player.goNextNow">立即播放</button>
      <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="player.cancelAutoNext">取消</button>
    </div>
  </div>
</template>

<style scoped>
.player {
  overflow: hidden;
  background: var(--mc-player-bg);
  box-shadow: var(--mc-elev-raised);
}

/* 播放器工具条：倍速 + 快捷键提示（对标主流学习平台） */
.player__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-3);
  background: var(--mc-bg-elevated);
}

.player__rates {
  display: flex;
  gap: var(--mc-space-1);
}

.player__hint {
  font-size: var(--mc-text-xs);
}

/* 播完自动下一节的横幅（5 秒倒计时，可取消） */
.player__next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-primary-soft);
  border-top: 1px solid var(--mc-primary-border);
  font-size: var(--mc-text-sm);
}

.player__video,
.player__frame {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--mc-player-bg);
  border: none;
}
</style>
