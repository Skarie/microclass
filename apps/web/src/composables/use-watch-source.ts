import { nextTick, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import type { Lesson } from '@/api/types';

interface WatchSourceDeps {
  videoRef: Ref<HTMLVideoElement | null>;
  lesson: () => Lesson | null;
  isEmbed: () => boolean;
}

/**
 * 播放源：HLS 优先、MP4 兜底。
 *
 * 入库流水线切好 HLS 后，`video-sources` 会返回 m3u8；拿不到就继续用模板里的
 * MP4 src（后端 Range 流）。iOS/Safari 用原生播放 m3u8，其它浏览器动态加载 hls.js。
 */
export function useWatchSource(deps: WatchSourceDeps) {
  const hlsUrl = ref<string | null>(null);
  let hlsInstance: { destroy: () => void } | null = null;

  function destroyHls(): void {
    if (hlsInstance) {
      try {
        hlsInstance.destroy();
      } catch {
        /* ignore */
      }
      hlsInstance = null;
    }
  }

  /** 查询本课时有没有 HLS 产物（后端入库流水线自动生成） */
  async function loadSourceInfo(): Promise<void> {
    hlsUrl.value = null;
    const l = deps.lesson();
    if (!l || l.video_kind !== 'local') return;
    try {
      const res = await api.get<{ mp4: string | null; hls: string | null }>(`/lessons/${l.id}/video-sources`);
      hlsUrl.value = res.hls;
    } catch {
      hlsUrl.value = null;
    }
  }

  async function setupPlayback(): Promise<void> {
    await nextTick();
    const video = deps.videoRef.value;
    if (!video || deps.isEmbed()) return;
    destroyHls();
    const url = hlsUrl.value;
    if (!url) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      return;
    }
    try {
      const { default: HlsCtor } = await import('hls.js');
      if (!HlsCtor.isSupported()) return;
      // hls.js 接管前先清掉模板绑定的 MP4 源，避免 MediaSource 冲突
      video.removeAttribute('src');
      video.load();
      const hls = new HlsCtor({ maxBufferLength: 30 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hlsInstance = hls;
    } catch {
      /* 加载失败就走 MP4 兜底（模板 src 仍在） */
      const fallback = deps.lesson();
      video.src = (fallback ? `/api/v1/lessons/${fallback.id}/video` : '') || '';
    }
  }

  return { hlsUrl, loadSourceInfo, setupPlayback, destroyHls };
}
