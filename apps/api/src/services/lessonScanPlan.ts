/**
 * 课程文件夹扫描的纯规划：把磁盘扫描结果与现有课时对照成
 * 「新增 / 收编 / 章节同步 / 跳过」，以及缺失去重（不写库）。
 */
import type { Lesson } from '@microclass/shared';
import type { ChapterMode, CourseScanResult } from './lessonTypes.js';
import { chapterFromRelDir, joinRel, naturalSort } from './lessonInput.js';

export interface ScannedFolderLike {
  folder: string;
  videos: string[];
}

export interface ScanPlanInput {
  folders: ScannedFolderLike[];
  /** 课程文件夹相对媒体根的路径（决定 video_path 前缀） */
  folderPath: string;
  courseId: number;
  chapterMode: ChapterMode;
  existing: Lesson[];
  onDuplicate?: 'skip' | 'assign';
}

export interface ScanPlan {
  onDisk: Set<string>;
  planned: { videoPath: string; chapter: string; title: string }[];
  steal: number[];
  sync: { id: number; chapter: string }[];
  assigned: number;
  updated: number;
  skipped: number;
}

export function planScan(input: ScanPlanInput): ScanPlan {
  const byPath = new Map(input.existing.filter((l) => l.video_kind === 'local').map((l) => [l.video_path, l] as const));
  const onDisk = new Set<string>();
  const planned: ScanPlan['planned'] = [];
  const steal: number[] = [];
  const sync: ScanPlan['sync'] = [];
  let assigned = 0;
  let updated = 0;
  let skipped = 0;

  for (const scanned of input.folders) {
    const chapter = chapterFromRelDir(scanned.folder, input.chapterMode);
    for (const fileName of naturalSort(scanned.videos)) {
      // video_path 必须是**相对媒体根**的路径（播放时用 mediaRoot + videoPath 定位文件），
      // 所以课程文件夹本身的那一层要带上；chapter 则是相对课程文件夹的
      const dir = joinRel(input.folderPath, scanned.folder);
      const videoPath = dir === '' ? fileName : `${dir}/${fileName}`;
      onDisk.add(videoPath);
      const hit = byPath.get(videoPath);
      if (!hit) {
        planned.push({ videoPath, chapter, title: fileName.replace(/\.[^.]+$/, '') });
        continue;
      }
      if (hit.course_id !== input.courseId) {
        if (input.onDuplicate === 'skip') {
          skipped += 1;
        } else {
          assigned += 1;
          steal.push(hit.id);
        }
        continue;
      }
      if (hit.source !== 'manual' && hit.group_name !== chapter) {
        updated += 1;
        sync.push({ id: hit.id, chapter });
        continue;
      }
      skipped += 1;
    }
  }

  return { onDisk, planned, steal, sync, assigned, updated, skipped };
}

/**
 * 磁盘上已消失的课时（只统计本课程、且路径落在该文件夹下的本地视频）。
 * `stillExists` 负责把相对路径解析成绝对路径并 stat；解析失败也按缺失处理。
 */
export function findMissingLessons(
  existing: Lesson[],
  courseId: number,
  onDisk: Set<string>,
  stillExists: (videoPath: string) => boolean,
): CourseScanResult['missing'] {
  const missing: CourseScanResult['missing'] = [];
  for (const lesson of existing) {
    if (lesson.course_id !== courseId || lesson.video_kind !== 'local') continue;
    if (onDisk.has(lesson.video_path)) continue;
    if (stillExists(lesson.video_path)) continue;
    const source: 'manual' | 'folder' = lesson.source === 'folder' ? 'folder' : 'manual';
    missing.push({ id: lesson.id, title: lesson.title, videoPath: lesson.video_path, source });
  }
  return missing;
}
