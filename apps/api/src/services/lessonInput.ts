/**
 * 课时入参与扫描导入的纯逻辑：标题/章节推导、路径规范化、文件名自然序、
 * 外部视频地址归一化。不依赖仓储，便于单测。
 */
import type { ChapterMode, LessonInputDto } from './lessonTypes.js';

/** 去掉最后一个扩展名；不裁剪空白（扫描导入直接使用磁盘文件名） */
export function stripExtension(value: string): string {
  return String(value ?? '').replace(/\.[^.]+$/, '');
}

/** 网页上传的标题：去首尾空白再去扩展名 */
export function normalizeUploadTitle(raw: string): string {
  return stripExtension(String(raw ?? '').trim());
}

/**
 * 网页上传的章节推断：显式指定 > 相对路径的顶层目录 > 空（未分章）。
 * 拖拽整个文件夹时浏览器给出的 relPath 可能是反斜杠。
 */
export function inferUploadGroupName(groupName?: string, relPath?: string): string {
  let value = groupName?.trim() ?? '';
  if (!value && relPath) {
    const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length > 1) value = (parts[0] ?? '').slice(0, 120);
  }
  return value;
}

/** 课时入参归一化：外部视频先把地址洗干净再落库，本地视频原样返回 */
export function normalizeLessonInput(input: LessonInputDto): LessonInputDto {
  if (input.videoKind === 'local') return input;
  const normalized = normalizeExternalVideoUrl(input.videoPath ?? '');
  return { ...input, videoPath: normalized ?? String(input.videoPath ?? '').trim() };
}

/**
 * 把「平台嵌入代码 / 地址」归一化成可用的 http(s) 地址；不是可用地址时返回 null。
 * 同时接受：整段 `<iframe …>` 代码、`//host/path` 协议相对地址、普通 http(s) 地址。
 */
export function normalizeExternalVideoUrl(raw: string): string | null {
  let value = String(raw ?? '').trim();
  if (!value) return null;

  const iframe = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(value);
  if (iframe?.[1]) {
    value = iframe[1].trim();
  } else if (/<iframe/i.test(value)) {
    // 粘了一段 iframe 代码但里面没有 src
    return null;
  }

  if (value.startsWith('//')) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  if (value.length > 1000) return null;
  return value;
}

/**
 * 文件名自然序：`2. xxx.mp4` 要排在 `10. xxx.mp4` 前面。
 * 素材文件名普遍带序号，字典序会把列表排成 1, 10, 11, 2…（轻课堂的 sort_order 同理）。
 */
export function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

/** 拼接相对路径片段，自动忽略空段（不用 path.join，避免 Windows 上出现反斜杠） */
export function joinRel(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

/** 导入时用户填写的文件夹相对路径：去首尾空白与首尾斜杠 */
export function trimFolderPath(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
}

/** 绑定课程文件夹时的路径：兼容 Windows 反斜杠，再去首尾空白与斜杠 */
export function normalizeBoundFolderPath(raw: string | undefined): string {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

/** 选中的文件夹自身名字（作为其直接下属视频的章节名）；根目录为空串 */
export function folderSelfName(rel: string): string {
  return rel === '' ? '' : (rel.split('/').pop() ?? '');
}

/**
 * 章节怎么定（默认取课程文件夹下的**第一层**目录）：
 *   - `first`：`第一章 有理数/3.1 乘方/xx.mp4` → 章节「第一章 有理数」
 *   - `full` ：章节 = 相对课程文件夹的完整目录路径
 *   - `none` ：不设章节（全部归入「未分章」）
 */
export function chapterFromRelDir(relDir: string, mode: ChapterMode): string {
  if (mode === 'none' || relDir === '') return '';
  if (mode === 'full') return relDir;
  return relDir.split('/')[0] ?? '';
}

/** 知识点链接校验规则（纯函数，错误文案由调用方决定） */
export function isHttpUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}
