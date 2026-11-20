/**
 * 难度阈值（cuts）在 settings 里的 key 与解析逻辑。
 *
 * 单独成文件的原因：体检 worker 需要「只读连接 + 同一套阈值口径」，
 * 若从 difficultyService 里 import 会把整个难度服务（含审计/预览）拖进 worker；
 * 同时 difficultyService 已在文件行数守卫的技术债基线里（只能减不能增）。
 */
import { DEFAULT_CUTS, type DifficultyCuts } from './difficulty.js';

/** 难度阈值在 settings 表里的 key */
export const DIFFICULTY_CUTS_KEY = 'difficulty_cuts';

/** settings 里的 JSON 文本 → 阈值；缺省/损坏都回退默认（与库里的 difficulty 保持一致） */
export function parseDifficultyCuts(raw: string | undefined): DifficultyCuts {
  if (!raw) return DEFAULT_CUTS;
  try {
    const parsed = JSON.parse(raw) as Partial<DifficultyCuts>;
    const five = Array.isArray(parsed.five) && parsed.five.length === 4 ? parsed.five : DEFAULT_CUTS.five;
    return {
      easyMax: Number(parsed.easyMax ?? DEFAULT_CUTS.easyMax),
      mediumMax: Number(parsed.mediumMax ?? DEFAULT_CUTS.mediumMax),
      five: [five[0] ?? 24, five[1] ?? 36, five[2] ?? 50, five[3] ?? 66],
    };
  } catch {
    return DEFAULT_CUTS;
  }
}
