import { computed, reactive, ref, type ComponentPublicInstance, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useWatchHotkeys } from './use-watch-hotkeys';
import { useWatchSource } from './use-watch-source';
import type { Lesson } from '@/api/types';

/** 播放速度选项（主流播放器都有，且学生长期用 1.5x） */
export const WATCH_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const RATE_KEY = 'mc.watch.rate';
type Rate = (typeof WATCH_RATES)[number];

interface WatchPlaybackDeps {
  lessonId: Ref<number>;
  lesson: () => Lesson | null;
  isEmbed: () => boolean;
  nextLesson: () => Lesson | undefined;
}

/**
 * 观看页播放器能力：倍速（记住上次选择）、快捷键、自动下一节、
 * HLS 优先 / MP4 兜底的播放源挂载，以及进度百分比。
 * 这里只碰 <video> 本身；进度上报与笔记在各自 composable 里。
 */
export function useWatchPlayback(deps: WatchPlaybackDeps) {
  const router = useRouter();
  const videoRef = ref<HTMLVideoElement | null>(null);
  const currentTime = ref(0);
  const duration = ref(0);
  const rate = ref<number>(readRate());
  const playerInView = ref(true);
  const autoNextIn = ref(0);
  const source = useWatchSource({ videoRef, lesson: deps.lesson, isEmbed: deps.isEmbed });

  let observer: IntersectionObserver | null = null;
  let autoNextTimer: number | null = null;

  /** 模板里用 `:ref="player.setVideo"` 绑定，视频元素就能被组合式函数读到 */
  function setVideo(el: Element | ComponentPublicInstance | null): void {
    videoRef.value = el instanceof HTMLVideoElement ? el : null;
  }

  /** 播放速度：记住上次选择（主流播放器都有，且学生长期用 1.5x） */
  function readRate(): number {
    try {
      const v = Number(window.localStorage.getItem(RATE_KEY));
      return (WATCH_RATES as readonly number[]).includes(v) ? v : 1;
    } catch {
      return 1;
    }
  }

  function setRate(v: number): void {
    rate.value = v;
    const el = videoRef.value;
    if (el) el.playbackRate = v;
    try {
      window.localStorage.setItem(RATE_KEY, String(v));
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  /** 一键后退（不用精准拖进度条）——MOOC 用户反馈里反复提到的诉求 */
  function rewind(seconds = 15): void {
    const el = videoRef.value;
    if (!el) return;
    el.currentTime = Math.max(0, el.currentTime - seconds);
  }

  function stepRate(dir: 1 | -1): void {
    const idx = WATCH_RATES.indexOf(rate.value as Rate);
    const next = WATCH_RATES[Math.max(0, Math.min(WATCH_RATES.length - 1, idx + dir))] ?? 1;
    setRate(next);
  }

  const hotkeys = useWatchHotkeys({ videoRef, isEmbed: deps.isEmbed, playerInView, stepRate });

  /** 播完自动下一节：5 秒倒计时，可取消（主流学习平台都这么做） */
  function startAutoNext(): void {
    const next = deps.nextLesson();
    if (!next) return;
    autoNextIn.value = 5;
    autoNextTimer = window.setInterval(() => {
      autoNextIn.value -= 1;
      if (autoNextIn.value <= 0) {
        cancelAutoNext();
        void router.push({ name: 'watch', params: { id: next.id } });
      }
    }, 1000);
  }

  function cancelAutoNext(): void {
    if (autoNextTimer) window.clearInterval(autoNextTimer);
    autoNextTimer = null;
    autoNextIn.value = 0;
  }

  function goNextNow(): void {
    const next = deps.nextLesson();
    cancelAutoNext();
    if (next) void router.push({ name: 'watch', params: { id: next.id } });
  }

  const watchedPercent = computed(() => {
    if (duration.value > 0) return Math.min(100, Math.round((currentTime.value / duration.value) * 100));
    const p = deps.lesson()?.progress;
    if (p && p.duration > 0) return Math.min(100, Math.round((p.position / p.duration) * 100));
    return p?.finished === 1 ? 100 : 0;
  });

  /** 本地视频需看完 80% 才解锁刷题（与后端规则一致） */
  const quizUnlocked = computed(() => {
    const l = deps.lesson();
    if (!l) return false;
    if (l.video_kind !== 'local') return true;
    if (l.progress?.finished === 1) return true;
    return watchedPercent.value >= 80;
  });

  function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  function seekTo(seconds: number): void {
    const video = videoRef.value;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
  }

  /** 元数据就绪：恢复倍速、开始观察是否在视口内、记录总时长 */
  function onLoadedMetadata(video: HTMLVideoElement): void {
    video.playbackRate = rate.value;
    if (!observer && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          playerInView.value = entries.some((e) => e.isIntersecting);
        },
        { threshold: 0.3 },
      );
      observer.observe(video);
    }
    duration.value = video.duration || 0;
  }

  function disconnectObserver(): void {
    observer?.disconnect();
  }

  /** 换课时：清空播放位置与时长（与拆分前一致，不清保存时间/覆盖度） */
  function reset(): void {
    currentTime.value = 0;
    duration.value = 0;
  }

  return reactive({
    videoRef,
    setVideo,
    rate,
    rates: WATCH_RATES,
    setRate,
    rewind,
    stepRate,
    currentTime,
    duration,
    watchedPercent,
    quizUnlocked,
    formatTime,
    seekTo,
    loadSourceInfo: source.loadSourceInfo,
    setupPlayback: source.setupPlayback,
    destroyHls: source.destroyHls,
    autoNextIn,
    startAutoNext,
    cancelAutoNext,
    goNextNow,
    attachHotkeys: hotkeys.attachHotkeys,
    detachHotkeys: hotkeys.detachHotkeys,
    onLoadedMetadata,
    disconnectObserver,
    reset,
  });
}
