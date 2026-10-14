/**
 * 视频路径找回：把「记录路径对不上、但文件其实在盘上」的课时修回来。
 *
 * 真机背景：3,768 个课时里有 1,130 个记录的 `video_path` 打不开。摸清后发现根因是
 * **记录路径少了最后一级「课时序号」目录**：
 *   记录：小学数学/二年级上册/二 表内乘法和除法（一）/书海遨游-乘法的初步认识.mp4
 *   实际：小学数学/二年级上册/二 表内乘法和除法（一）/3.2 初步认识乘法意义/书海遨游-乘法的初步认识.mp4
 * 抽样 200 个失效路径，**父目录 200/200 都存在**，只是文件在更深一层。
 *
 * 找回规则（按可信度从高到低，只有唯一命中才敢自动改）：
 *   1. 记录目录下（含更深一层）同名的文件，恰好一个 → 采用
 *   2. 整个媒体根下同名文件恰好一个 → 采用
 *   3. 其余一律不动（宁可留给人看，也不要指错视频）
 */

/** 文件名归一化：去空白/标点/大小写/括号备注，用于同名判断 */
export function normalizeVideoName(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[—–−－~～]/g, '-')
    .replace(/[\s_\-·．.、,，:：;；'"“”‘’()（）[\]【】]/g, '');
}

export interface VideoFile {
  /** 相对媒体根的路径，写回 `lessons.video_path` */
  rel: string;
  /** 绝对路径，仅用于判断目录关系 */
  full: string;
}

export interface VideoMatch {
  rel: string;
  reason: 'same-dir' | 'same-dir-deep' | 'global-unique';
}

/**
 * 给定记录路径与媒体根下的全部视频文件，找唯一候选。
 *
 * 匹配顺序（先精确后宽容，**每一步都要求唯一命中**）：
 *   1. 记录目录下（含更深一层）**文件名完全相同**
 *   2. 整个媒体根下文件名完全相同且唯一
 *   3. 记录目录下（含更深一层）归一化同名（`——`/`-`、括号备注、空白差异）
 *   4. 整个媒体根下归一化同名且唯一
 * 某一步命中多个候选时（例如「笔算乘法（一）/（二）」归一化后同名）不猜，返回 null 交给人看：
 * 宁可漏修，也不能把「（一）」的课时指到「（二）」的视频上。
 */
export function pickVideoCandidate(recordedDir: string, recordedName: string, files: VideoFile[]): VideoMatch | null {
  const baseName = (rel: string): string => rel.split('/').pop() ?? '';
  const dirOf = (rel: string): string => {
    const parts = rel.split('/');
    parts.pop();
    return parts.join('/');
  };
  const prefix = recordedDir === '' ? '' : `${recordedDir}/`;

  const pick = (pool: VideoFile[]): VideoMatch | null => {
    const inDir = pool.filter((f) => dirOf(f.rel) === recordedDir);
    if (inDir.length === 1) return { rel: inDir[0]!.rel, reason: 'same-dir' };
    const deeper = pool.filter((f) => f.rel.startsWith(prefix) && dirOf(f.rel) !== recordedDir);
    if (deeper.length === 1) return { rel: deeper[0]!.rel, reason: 'same-dir-deep' };
    if (pool.length === 1) return { rel: pool[0]!.rel, reason: 'global-unique' };
    return null;
  };

  // 1) 文件名完全相同（真机里「（一）/(二)」这类序号只有原名能区分）
  const exactHit = pick(files.filter((f) => baseName(f.rel) === recordedName));
  if (exactHit) return exactHit;

  // 2) 归一化同名
  const wanted = normalizeVideoName(recordedName);
  return pick(files.filter((f) => normalizeVideoName(baseName(f.rel)) === wanted));
}
