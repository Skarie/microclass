/**
 * 批量导入的清单 / 文件校验（从 `routes/banks.ts` 抽出的纯逻辑）。
 *
 * 锁住拆分前的边界：扩展名白名单、空文件与 20MB 上限、`media<N>` 字段识别、
 * 400 张题图上限，以及 manifest 的空 / 非法 JSON / 非数组 / 超过 500 题四类 400。
 * 这些错误文案是前端直接提示给老师的，改动会立刻被看到，所以逐条断言。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  MAX_MANIFEST_QUESTIONS,
  MAX_MEDIA_FILES,
  importFileError,
  isImportFileName,
  mediaFieldIndex,
  mediaFilesError,
  parseImportManifest,
} from '../src/domain/bankImport.js';

function expectBadRequest(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toMatchObject({ status: 400, message });
    return;
  }
  throw new Error(`expected 400: ${message}`);
}

describe('导入文件白名单与大小', () => {
  it('CSV / Markdown / 纯文本 / Word 都允许，且不区分大小写', () => {
    for (const name of ['题库.csv', 'A.MD', 'note.markdown', '题块.txt', '试卷.DOCX']) {
      expect(isImportFileName(name), name).toBe(true);
    }
    for (const name of ['题库.xlsx', 'a.pdf', 'noext']) {
      expect(isImportFileName(name), name).toBe(false);
    }
  });

  it('空文件 / 超过 20MB 各给一条可读错误，合法大小返回 null', () => {
    expect(importFileError(0)).toBe('文件内容为空');
    expect(importFileError(MAX_IMPORT_BYTES + 1)).toBe('文件过大（上限 20MB）');
    expect(importFileError(1)).toBeNull();
    expect(importFileError(MAX_IMPORT_BYTES)).toBeNull();
  });
});

describe('multipart 题图字段与数量上限', () => {
  it('media<N> 解析成题图序号，其它字段（含题图正文文件）不当作题图', () => {
    expect(mediaFieldIndex('media0')).toBe(0);
    expect(mediaFieldIndex('media12')).toBe(12);
    expect(mediaFieldIndex('media')).toBeUndefined();
    expect(mediaFieldIndex('image')).toBeUndefined();
    expect(mediaFieldIndex('mediax')).toBeUndefined();
  });

  it('400 张以内放行，超限提示带本次张数', () => {
    expect(mediaFilesError(0)).toBeNull();
    expect(mediaFilesError(MAX_MEDIA_FILES)).toBeNull();
    expect(mediaFilesError(MAX_MEDIA_FILES + 1)).toContain('401');
    expect(mediaFilesError(MAX_MEDIA_FILES + 1)).toContain('400');
  });
});

describe('manifest 清单校验', () => {
  it('合法清单原样返回 questions 数组', () => {
    const questions = [{ type: 'judge', stem: '1+1=2', answer: '对' }];
    expect(parseImportManifest(JSON.stringify({ questions }))).toEqual(questions);
  });

  it('空 manifest / 非法 JSON / 非数组 / 超过 500 题都是 400', () => {
    expectBadRequest(() => parseImportManifest('   '), '缺少 manifest（题目清单 JSON）');
    expectBadRequest(() => parseImportManifest('not-json'), 'manifest 不是合法 JSON');
    expectBadRequest(() => parseImportManifest('{}'), 'manifest.questions 必须是非空数组');
    expectBadRequest(() => parseImportManifest('{"questions":[]}'), 'manifest.questions 必须是非空数组');
    expectBadRequest(() => parseImportManifest('null'), 'manifest.questions 必须是非空数组');
    const tooMany = Array.from({ length: MAX_MANIFEST_QUESTIONS + 1 }, () => ({}));
    expectBadRequest(() => parseImportManifest(JSON.stringify({ questions: tooMany })), '一次最多导入 500 题，请分批');
  });
});
