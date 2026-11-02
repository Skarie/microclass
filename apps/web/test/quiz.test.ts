import { describe, expect, it } from 'vitest';
import {
  fillPlaceholder,
  joinBlankAnswers,
  judgeText,
  legacyImageUrl,
  lettersOf,
  optionIndices,
  optionLetter,
  splitBlankAnswers,
  summarizeQuiz,
} from '../src/utils/quiz';
import { groupQuestionsByType } from '../src/views/quiz/quiz-groups';
import type { QuizSubmitResult } from '../src/api/types';

describe('刷题：选项编码', () => {
  it('下标串解析、字母映射与乱序去噪', () => {
    expect(optionIndices('2,0,2')).toEqual([0, 2, 2]);
    expect(optionIndices('')).toEqual([]);
    expect(optionIndices(undefined)).toEqual([]);
    expect(optionLetter(2)).toBe('C');
    expect(lettersOf('2,0')).toBe('AC');
  });

  it('判断题文案只认 T/F', () => {
    expect(judgeText('T')).toBe('对');
    expect(judgeText('F')).toBe('错');
    expect(judgeText('0')).toBe('');
  });
});

describe('刷题：多空填空', () => {
  it('按「；」拆成固定空位并补齐', () => {
    expect(splitBlankAnswers('3；-9', 2)).toEqual(['3', '-9']);
    expect(splitBlankAnswers('3', 3)).toEqual(['3', '', '']);
    expect(splitBlankAnswers('3；-9；7', 2)).toEqual(['3', '-9', '7']);
    expect(splitBlankAnswers('', 1)).toEqual(['']);
  });

  it('提交编码与题库导入一致', () => {
    expect(joinBlankAnswers(['3', '-9'])).toBe('3；-9');
    expect(joinBlankAnswers(['main'])).toBe('main');
    expect(fillPlaceholder(2)).toContain('共 2 个空');
    expect(fillPlaceholder(1)).toContain('请填写答案');
  });
});

describe('刷题：结果统计', () => {
  const result: QuizSubmitResult = {
    attemptId: 1,
    score: 3,
    total: 4,
    manual: 1,
    best: 80,
    results: [
      {
        qid: 1,
        type: 'single',
        stem: '',
        options: [],
        image_path: '',
        given: '1',
        correct: true,
        answer: '1',
        analysis: '',
      },
      {
        qid: 2,
        type: 'multiple',
        stem: '',
        options: [],
        image_path: '',
        given: '0',
        correct: false,
        answer: '0,2',
        analysis: '',
      },
      {
        qid: 3,
        type: 'judge',
        stem: '',
        options: [],
        image_path: '',
        given: 'T',
        correct: true,
        answer: 'T',
        analysis: '',
      },
      {
        qid: 4,
        type: 'short',
        stem: '',
        options: [],
        image_path: '',
        given: '作答',
        correct: null,
        answer: '参考',
        analysis: '',
      },
    ],
  };

  it('正确/错误/待自评与得分率按后端口径', () => {
    expect(summarizeQuiz(result, 4)).toEqual({ correct: 2, wrong: 1, manual: 1, unanswered: 0, percent: 75 });
  });

  it('没有结果时全部归零', () => {
    expect(summarizeQuiz(null, 3)).toEqual({ correct: 0, wrong: 0, manual: 0, unanswered: 3, percent: 0 });
  });
});

describe('刷题：旧版配图地址', () => {
  it('题干已有内联图片时不重复渲染', () => {
    expect(legacyImageUrl({ id: 9, image_path: 'a.png', stem: '![](/api/v1/question-media/x.png)' })).toBe('');
    expect(legacyImageUrl({ id: 9, image_path: 'a.png', stem: '题干' })).toBe('/api/v1/question-images/9');
    expect(legacyImageUrl({ id: 9, image_path: '', stem: '题干' })).toBe('');
  });
});

describe('刷题：答题卡按题型分组', () => {
  const q = (id: number, type: 'single' | 'multiple' | 'judge' | 'fill' | 'short') => ({
    id,
    type,
    stem: '',
    options: [],
  });

  it('组序按题型首次出现，组内保持原题号', () => {
    const groups = groupQuestionsByType([q(1, 'single'), q(2, 'judge'), q(3, 'single'), q(4, 'judge'), q(5, 'single')]);
    expect(groups.map((g) => g.label)).toEqual(['单选题', '判断题']);
    expect(groups[0]?.items.map((item) => item.index)).toEqual([0, 2, 4]);
    expect(groups[1]?.items.map((item) => item.index)).toEqual([1, 3]);
    // 打乱后同题型题号不连续，不显示会误导的范围
    expect(groups[0]?.range).toBe('');
  });

  it('连续题号显示范围，单题只显示题号', () => {
    const groups = groupQuestionsByType([q(1, 'single'), q(2, 'single'), q(3, 'fill')]);
    expect(groups[0]?.range).toBe('1-2');
    expect(groups[1]?.range).toBe('3');
    expect(groups[1]?.items).toHaveLength(1);
  });
});
