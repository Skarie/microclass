/**
 * 「题库_教师版」目录扫描：定位册次根目录，找出每个小节下的 `题目.md`。
 *
 * 目录约定：
 *   <源目录>/<学科>/<册次>/<章节>/<小节>/题目.md + images/*
 * 也兼容直接把 `<册次>` 目录作为源目录传入（`<章节目录>/<小节>/题目.md`）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 题目文件名（与采集侧一致） */
export const TEACHER_QUESTION_FILE = '题目.md';

/** 一个小节的来源信息（章节/小节还会被 md 头部的元信息覆盖，取更权威的那份） */
export interface TeacherBankSectionSource {
  /** `题目.md` 绝对路径 */
  mdPath: string;
  /** 相对册次根目录的路径，写进 `questions.source_path` */
  relPath: string;
  /** 章节目录名（元信息缺失时兜底） */
  chapterDir: string;
  /** 小节目录名（元信息缺失时兜底） */
  sectionDir: string;
}

/** 递归找 `题目.md`（最多 6 层，避免误传入超大目录时扫盘） */
function findQuestionFiles(dir: string, depth: number, out: string[]): void {
  if (depth > 6) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) findQuestionFiles(abs, depth + 1, out);
    else if (entry.isFile() && entry.name === TEACHER_QUESTION_FILE) out.push(abs);
  }
}

/**
 * 源目录 → 册次根目录：
 * `<源目录>/<学科>/<册次>` → `<源目录>/<册次>` → 源目录本身，取第一个存在的。
 */
export function resolveTeacherBookRoot(sourceDir: string, subject: string, book: string): string | null {
  const root = path.resolve(sourceDir);
  const candidates = [path.join(root, subject, book), path.join(root, book), root];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* 不存在就试下一个 */
    }
  }
  return null;
}

/** 扫描册次根目录下的所有小节（按相对路径排序，保证每次导入顺序稳定） */
export function scanTeacherBankSections(bookRoot: string): TeacherBankSectionSource[] {
  const files: string[] = [];
  findQuestionFiles(bookRoot, 0, files);
  const out = files.map((mdPath) => {
    const relPath = path.relative(bookRoot, mdPath).split(path.sep).join('/');
    const parts = relPath.split('/');
    // 去掉末尾的 `题目.md`：剩下 [章节, 小节] / [章节] / []
    const dirs = parts.slice(0, -1);
    return {
      mdPath,
      relPath,
      chapterDir: dirs.length >= 2 ? (dirs[0] ?? '') : '',
      sectionDir: dirs.length >= 2 ? (dirs[1] ?? '') : (dirs[0] ?? ''),
    };
  });
  return out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}
