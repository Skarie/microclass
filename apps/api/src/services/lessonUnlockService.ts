/** 课时刷题解锁判定：已完成 / 观看区间覆盖 ≥ 80% / 回退播放位置。 */
import { AppError, QUIZ_UNLOCK_RATIO, type User } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { ProgressRepository } from '../db/repositories/progressRepository.js';
import { coveredSeconds, type WatchIntervalRepository } from '../db/repositories/watchIntervalRepository.js';

export class LessonUnlockService {
  constructor(
    private readonly lessons: LessonRepository,
    private readonly progress: ProgressRepository,
    private readonly intervals: WatchIntervalRepository,
  ) {}

  /**
   * 本地视频是否已解锁刷题（嵌入/直链不限制）。
   *
   * 判定顺序（参考轻课堂：进度按「观看区间」记录，避免拖到最后就算看完）：
   *   1. 已完成标记；
   *   2. 去重后的观看区间总时长 / 视频总时长 ≥ 80%（总时长优先用 ffprobe 抽的 duration）；
   *   3. 回退到单一播放位置（历史数据或前端未上报区间时）。
   */
  isQuizUnlocked(viewer: User, lessonId: number): boolean {
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    if (lesson.video_kind !== 'local') return true;
    if (viewer.role === 'admin' || viewer.role === 'teacher') return true;

    const p = this.progress.get(viewer.id, lessonId);
    if (p?.finished === 1) return true;

    const total = lesson.duration ?? p?.duration ?? 0;
    if (!(total > 0)) return false;

    // 只要上报过观看区间，就只按区间判定（忽略播放位置）：
    // 否则「拖到结尾」会把 position 拉满而误判为看完。
    const segments = this.intervals.list(viewer.id, lessonId);
    if (segments.length > 0) {
      const covered = coveredSeconds(segments.map((s) => ({ start_sec: s.start_sec, end_sec: s.end_sec })));
      return covered / total >= QUIZ_UNLOCK_RATIO;
    }

    // 无区间记录（老数据 / 旧客户端）才回退到位置判定
    const position = p?.position ?? 0;
    return position / total >= QUIZ_UNLOCK_RATIO;
  }
}
