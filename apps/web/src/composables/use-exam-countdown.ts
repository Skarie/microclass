import { onBeforeUnmount, ref } from 'vue';
import { useToastStore } from '@/stores/toast';

/**
 * 考试倒计时：进入作答页即开始（不限时考试 duration_minutes 为 0 或缺失）。
 * 到点前 1 分钟提示一次，到点提示并触发自动交卷；倒计时读数的计算口径与原页面完全一致。
 */
export function useExamCountdown(onExpire: () => void) {
  const toast = useToastStore();
  const startedAt = ref(Date.now());
  const limitSeconds = ref(0);
  const remaining = ref(0);

  let timer: number | undefined;
  let warned = false;

  function formatClock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function stop(): void {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function tick(): void {
    const left = Math.max(0, limitSeconds.value - Math.floor((Date.now() - startedAt.value) / 1000));
    remaining.value = left;
    if (left > 0 && left <= 60 && !warned) {
      warned = true;
      toast.warning('距离考试结束不足 1 分钟，请尽快交卷');
    }
    if (left <= 0) {
      stop();
      toast.info('考试时间已到，正在自动交卷');
      onExpire();
    }
  }

  function start(minutes: number | undefined): void {
    stop();
    startedAt.value = Date.now();
    limitSeconds.value = Math.max(0, Math.floor((minutes ?? 0) * 60));
    remaining.value = limitSeconds.value;
    warned = false;
    if (limitSeconds.value > 0) timer = window.setInterval(tick, 1000);
  }

  onBeforeUnmount(stop);

  return { startedAt, limitSeconds, remaining, start, stop, formatClock };
}
