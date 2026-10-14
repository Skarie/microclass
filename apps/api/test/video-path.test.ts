/**
 * 视频路径找回规则（真机 1,130 个失效路径的根因是「少了最后一级课时序号目录」）。
 */
import { describe, expect, it } from 'vitest';
import { normalizeVideoName, pickVideoCandidate } from '../src/domain/videoPath.js';

const f = (rel: string) => ({ rel, full: `/media/${rel}` });

describe('视频文件名归一化', () => {
  it('去空白/标点/大小写/括号备注（只用于文件名，不用于整条路径）', () => {
    expect(normalizeVideoName('书海遨游-乘法的初步认识.mp4')).toBe(normalizeVideoName('书海遨游_乘法的初步认识.MP4'));
    expect(normalizeVideoName('神奇的尺子——线段.mp4')).toBe(normalizeVideoName('神奇的尺子-线段.mp4'));
    expect(normalizeVideoName('第1课时(拓展).mp4')).toBe(normalizeVideoName('第1课时.mp4'));
  });
});

describe('视频路径找回', () => {
  it('记录目录下更深一层同名 → 修回（真机主因）', () => {
    const files = [
      f('小学数学/二年级上册/二 表内乘法和除法（一）/3.2 初步认识乘法意义/书海遨游-乘法的初步认识.mp4'),
      f('小学数学/二年级上册（新）/第二章 1~6的表内乘法/2.1 同数连加的应用/书海遨游-乘法的初步认识.mp4'),
    ];
    const m = pickVideoCandidate('小学数学/二年级上册/二 表内乘法和除法（一）', '书海遨游-乘法的初步认识.mp4', files);
    expect(m?.reason).toBe('same-dir-deep');
    expect(m?.rel).toContain('3.2 初步认识乘法意义');
  });

  it('记录目录下就是同名文件 → 修回', () => {
    const files = [f('小学数学/二年级上册/一 认识厘米和米/神奇的尺子-认识厘米和米.mp4')];
    const m = pickVideoCandidate('小学数学/二年级上册/一 认识厘米和米', '神奇的尺子-认识厘米和米.mp4', files);
    expect(m?.reason).toBe('same-dir');
  });

  it('同名文件唯一但在别的目录 → 也修回（并标明依据）', () => {
    const files = [f('初中数学/七年级上册/第一章/1.1/有理数.mp4')];
    const m = pickVideoCandidate('小学数学/二年级上册/别的目录', '有理数.mp4', files);
    expect(m?.reason).toBe('global-unique');
  });

  it('同名有多个候选且都不在记录目录下 → 不猜，返回 null', () => {
    const files = [f('A/1.1/有理数.mp4'), f('B/2.2/有理数.mp4')];
    expect(pickVideoCandidate('C/3.3', '有理数.mp4', files)).toBeNull();
  });

  it('归一化后同名但带序号（（一）/（二））→ 按原名精确匹配，指到对的那个', () => {
    const files = [
      f('小学数学/三年级上册/一 乘法/1.1 口算/魔法哈哈镜-笔算乘法（一）.mp4'),
      f('小学数学/三年级上册/一 乘法/1.2 笔算/魔法哈哈镜-笔算乘法（二）.mp4'),
    ];
    const one = pickVideoCandidate('小学数学/三年级上册/一 乘法', '魔法哈哈镜-笔算乘法（一）.mp4', files);
    const two = pickVideoCandidate('小学数学/三年级上册/一 乘法', '魔法哈哈镜-笔算乘法（二）.mp4', files);
    expect(one?.rel).toContain('（一）');
    expect(two?.rel).toContain('（二）');
  });

  it('记录目录下有多个同名（不同子目录）→ 不猜', () => {
    const files = [f('A/1.1/有理数.mp4'), f('A/1.2/有理数.mp4')];
    expect(pickVideoCandidate('A', '有理数.mp4', files)).toBeNull();
  });

  it('盘上完全没有这个文件 → null', () => {
    expect(pickVideoCandidate('A', '不存在.mp4', [f('A/1.1/别的.mp4')])).toBeNull();
  });
});
