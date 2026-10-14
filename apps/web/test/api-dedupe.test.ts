/**
 * API 客户端「GET 去重 + 极短缓存」的行为测试。
 *
 * 背景（真机自查）：同一个页面里布局/视图/子组件各自请求同一份数据，
 * `/admin/courses` 一次加载把 `GET /courses` 发了 3 次、`/me/summary` 2 次，
 * 考试管理页把 `GET /courses/7/exams` 同一毫秒发了 2 次。
 *
 * 这里锁住三条不变量：
 *   1. 同一时刻的并发 GET 只发一次请求（进行中合并）；
 *   2. 1 秒内的相同 GET 复用结果；
 *   3. **写操作后缓存立即失效**（写后读必须拿新数据），且错误不会被缓存。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';

const okJson = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  }) as unknown as Response;

describe('API 客户端 GET 去重', () => {
  let calls: string[] = [];

  beforeEach(() => {
    api.clearCache();
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        return okJson({ url, courses: [] });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('并发 GET 只发一次请求（进行中合并）', async () => {
    const [a, b, c] = await Promise.all([api.get('/courses'), api.get('/courses'), api.get('/courses')]);
    expect(calls.filter((u) => u === 'GET /api/v1/courses')).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('1 秒内的相同 GET 复用结果，超过 1 秒会重新请求', async () => {
    await api.get('/me/summary');
    await api.get('/me/summary');
    expect(calls).toHaveLength(1);

    // 时间推进到缓存过期后必须重新请求
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1500);
    await api.get('/me/summary');
    expect(calls).toHaveLength(2);
  });

  it('写操作后缓存立即失效（写后读拿新数据）', async () => {
    await api.get('/courses');
    expect(calls).toHaveLength(1);
    await api.post('/courses', { name: '新课程' });
    await api.get('/courses');
    // 1 次 GET + 1 次 POST + 1 次 GET（没有被旧缓存挡住）
    expect(calls.filter((u) => u === 'GET /api/v1/courses')).toHaveLength(2);
  });

  it('失败的请求不会被缓存（下次仍会重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: { code: 'INTERNAL', message: '炸了' } }),
          headers: new Headers(),
        } as unknown as Response;
      }),
    );
    await expect(api.get('/banks')).rejects.toThrow();
    await expect(api.get('/banks')).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});
