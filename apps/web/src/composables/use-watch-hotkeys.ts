import type { Ref } from 'vue';

interface WatchHotkeysDeps {
  videoRef: Ref<HTMLVideoElement | null>;
  isEmbed: () => boolean;
  playerInView: Ref<boolean>;
  stepRate: (dir: 1 | -1) => void;
}

/**
 * 观看页键盘快捷键：空格/k 播放暂停、←→ 快退快进 5 秒、f 全屏、m 静音、< > 调速。
 * 只在播放器进入视口、且没有在输入时才接管，避免抢走页面滚动或误暂停。
 */
export function useWatchHotkeys(deps: WatchHotkeysDeps) {
  function onPlayerHotkey(e: KeyboardEvent): void {
    const el = deps.videoRef.value;
    if (!el || deps.isEmbed() || !deps.playerInView.value) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (document.querySelector('.mc-modal')) return;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        if (el.paused) void el.play();
        else el.pause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        el.currentTime = Math.max(0, el.currentTime - 5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        el.currentTime = Math.min(el.duration || 0, el.currentTime + 5);
        break;
      case 'f':
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen();
        break;
      case 'm':
        e.preventDefault();
        el.muted = !el.muted;
        break;
      case '>':
      case '.':
        e.preventDefault();
        deps.stepRate(1);
        break;
      case '<':
      case ',':
        e.preventDefault();
        deps.stepRate(-1);
        break;
      default:
        break;
    }
  }

  function attachHotkeys(): void {
    window.addEventListener('keydown', onPlayerHotkey);
  }

  function detachHotkeys(): void {
    window.removeEventListener('keydown', onPlayerHotkey);
  }

  return { attachHotkeys, detachHotkeys };
}
