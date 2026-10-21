/**
 * 试卷结构：大题（名称/题型/每题分值/说明）、中文序号、结构解析与落库。
 *
 * 结构是“卷面长什么样”的唯一来源：组卷页保存它、打印/Word 导出读它。
 * 坏数据（历史 JSON 损坏、字段类型不对）一律退化成空数组，不让接口整体失败。
 */
import type { User } from '@microclass/shared';
import { findExam, writeAudit, type ExamPaperDeps } from './paperCommon.js';
import type { DifficultyTarget, PaperSection } from './paperTypes.js';

/** 试卷大题习惯用中文序号（一、单选题 二、填空题…） */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function cnNumber(n: number): string {
  return CN_NUM[n - 1] ?? String(n);
}

/** 题型中文名（大题默认名与细目表展示用） */
export const TYPE_NAME: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

/** 试卷结构（大题）解析：坏数据不炸，退化成空数组 */
export function parseStructure(raw: unknown): PaperSection[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        name: typeof row.name === 'string' ? row.name : '',
        type: typeof row.type === 'string' ? row.type : '',
        score: Number(row.score) || 0,
        description: typeof row.description === 'string' ? row.description : '',
      };
    });
  } catch {
    return [];
  }
}

/**
 * 大题标题：老师填了名称就用它，否则按序号 + 题型生成（「一、单选题」）。
 * 序号按传入顺序算，与题型无关；没有题型的占位行也会占一个序号（与历史行为一致）。
 */
export function sectionLabel(index: number, section: PaperSection): string {
  return section.name || `${cnNumber(index)}、${TYPE_NAME[section.type] ?? section.type}`;
}

/**
 * 保存试卷结构：大题分组（名称/题型/每题分值/说明）+ 目标难度配比 + 总分。
 * `applyScores` 会把「某大题下的题目」分值统一刷成该大题的标准分值。
 */
export function setStructure(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  sections: PaperSection[],
  difficultyTarget?: DifficultyTarget,
  totalScore?: number,
  applyScores = true,
): void {
  findExam(deps.exams, examId);
  deps.exams.setStructure(
    examId,
    JSON.stringify(sections),
    difficultyTarget ? JSON.stringify(difficultyTarget) : undefined,
    totalScore,
  );
  // 把每个大题的「名称 + 每题分值」刷到该题型的题目上（组卷按题型生成大题）
  let touched = 0;
  if (applyScores) {
    let index = 0;
    for (const section of sections) {
      index += 1;
      if (!section.type) continue;
      touched += deps.exams.applySection(
        examId,
        section.type,
        sectionLabel(index, section),
        Number(section.score) || 0,
      );
    }
  }
  writeAudit(deps, actor, 'exam.structure', examId, {
    sections: sections.length,
    difficultyTarget: difficultyTarget ?? {},
    totalScore,
    touched,
  });
}
