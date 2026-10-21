import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Lesson } from '@/api/types';
import type { useWatchPlayback } from './use-watch-playback';

interface IntervalReport {
  coveredSeconds: number;
  duration: number;
  percent: number;
  finished: boolean;
}

interface WatchProgressDeps {
  lesson: () => Lesson | null;
  player: ReturnType<typeof useWatchPlayback>;
  /** 学完后静默重载课时（进度条 / 已学完标记） */
  reload: () => Promise<unknown>;
}

/**
 * 观看进度：位置上报、观看区间上报（拖到最后不算看完）、15 秒自动保存、
 * 断点续播提示与学完动作。所有 intervals 文案与节奏与拆分前逐字一致。
 */
export function useWatchProgress(deps: WatchProgressDeps) {
  const toast = useToastStore();
  const savedAt = ref<string>('');
  const coveredPercent = ref<number | null>(null);
  /** 当前这段连续播放的起点；null 表示还没开始/刚 seek 过 */
  let segmentStart: number | null = null;
  let timer: number | undefined;

  /** 上报进度：本地视频按真实播放位置，外部链接按完成标记 */
  async function reportProgress(position: number, total: number, finished: boolean): Promise<void> {
    const l = deps.lesson();
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

  /** 把「刚看过的这一段」上报；同时更新播放位置，保证断点续播 */
  async function flushIntervals(final = false): Promise<void> {
    const l = deps.lesson();
    const video = deps.player.videoRef;
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
    segmentStart = deps.player.videoRef?.currentTime ?? null;
  }

  function onTimeUpdate(): void {
    const video = deps.player.videoRef;
    if (!video) return;
    deps.player.currentTime = video.currentTime;
    // 记录连续播放的起点（暂停/拖动时会在别处重置）
    if (segmentStart === null) segmentStart = video.currentTime;
  }

  /** 元数据就绪：断点续播（距上次位置超过 5 秒且未看完时跳转） */
  function onLoadedMetadata(video: HTMLVideoElement): void {
    const l = deps.lesson();
    const resume = l?.progress?.position ?? 0;
    if (resume > 5 && (l?.progress?.finished ?? 0) !== 1 && resume < video.duration - 5) {
      video.currentTime = resume;
      toast.info(`已从 ${deps.player.formatTime(resume)} 继续播放`);
    }
    segmentStart = video.currentTime;
  }

  function onPause(): void {
    void flushIntervals();
  }

  function onEnded(): void {
    if (!deps.player.videoRef) return;
    void flushIntervals(true);
    toast.success('本课时已学完');
    void deps.reload();
    deps.player.startAutoNext();
  }

  function onPlayEvent(): void {
    if (segmentStart === null) segmentStart = deps.player.videoRef?.currentTime ?? null;
  }

  function startAutoSave(): void {
    stopAutoSave();
    // 每 15 秒把「刚看过的这一段」上报为观看区间（服务端做去重合并）
    timer = window.setInterval(() => {
      const video = deps.player.videoRef;
      if (!video || video.paused) return;
      void flushIntervals();
    }, 15000);
  }

  function stopAutoSave(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  }

  async function markFinished(): Promise<void> {
    await reportProgress(deps.player.duration, deps.player.duration, true);
    toast.success('已标记为学完');
    await deps.reload();
  }

  return reactive({
    savedAt,
    coveredPercent,
    reportProgress,
    flushIntervals,
    onSeeking,
    onTimeUpdate,
    onLoadedMetadata,
    onPause,
    onEnded,
    onPlayEvent,
    startAutoSave,
    stopAutoSave,
    markFinished,
  });
}
