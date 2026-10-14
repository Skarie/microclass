/**
 * 统一 API 客户端：
 * - 同源调用 /api/v1（开发期由 Vite 代理到 API 服务）
 * - 自动带 Cookie（同源默认带；跨源时用 credentials: include）
 * - 统一解析错误信封 { error: { code, message, requestId, details } }
 * - 401 时广播事件，由路由守卫跳登录
 */
import type { ApiErrorBody, Page } from './types';

const BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: unknown;

  constructor(status: number, body?: { code?: string; message?: string; requestId?: string; details?: unknown }) {
    super(body?.message ?? `请求失败（${status}）`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? 'INTERNAL';
    this.requestId = body?.requestId ?? '';
    this.details = body?.details;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  /**
   * 查询参数。数组会序列化成**重复参数**（`?points=a&points=b`），
   * 因为组卷的章节/知识点/题型筛选本身就是多选（后端按重复参数解析）。
   */
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
  /** 表单上传（multipart） */
  formData?: FormData;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      // 重复参数：?points=a&points=b（后端 listParam 支持；逗号拼接会撞上名字里自带逗号的知识点）
      for (const item of value) {
        if (item === '') continue;
        search.append(key, item);
      }
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * GET 请求的**去重 + 极短缓存**。
 *
 * 真机自查发现的问题：同一个页面里多个组件（布局 + 视图 + 子组件）各自请求同一份数据，
 * 例如 `/admin/courses` 一次加载把 `GET /courses` 发了 **3 次**、`/me/summary` 2 次，
 * 考试管理页把 `GET /courses/7/exams` **同一毫秒发了 2 次**。既浪费带宽也在 NAS 上拖慢首屏。
 *
 * 处理：
 *   - **进行中请求合并**：同一 URL 在途时复用同一个 Promise；
 *   - **1 秒内的相同 GET 复用结果**：抹掉"同一屏里先后两次"的重复（人眼无感，但省一半请求）；
 *   - **任何写操作（POST/PUT/DELETE/上传）立即清空缓存**：保证写后读不会拿到旧数据。
 * 不改变接口语义：超过 1 秒或发生过写操作，就照常重新请求。
 */
const GET_TTL_MS = 1000;
const getCache = new Map<string, { at: number; value: unknown }>();
const inflightGets = new Map<string, Promise<unknown>>();

function clearGetCache(): void {
  getCache.clear();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path, options.query);

  // 命中极短缓存：直接复用（只在没有 AbortSignal 时，避免影响取消语义）
  if (method === 'GET' && !options.signal) {
    const cached = getCache.get(url);
    if (cached && Date.now() - cached.at < GET_TTL_MS) return cached.value as T;
    const pending = inflightGets.get(url);
    if (pending) return pending as Promise<T>;
  }

  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (body !== undefined) init.body = body;
  if (options.signal) init.signal = options.signal;

  const run = async (): Promise<T> => {
    const res = await fetch(url, init);

    // 需要拿原始文本（CSV/文件流）时改用 raw() 系列方法
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const envelope = parsed as ApiErrorBody | null;
      const error = new ApiError(res.status, envelope?.error);
      if (res.status === 401 && !path.startsWith('/auth/')) {
        window.dispatchEvent(new CustomEvent('microclass:unauthorized'));
      }
      throw error;
    }
    return parsed as T;
  };

  const task = run();

  if (method !== 'GET') {
    // 写操作后清空缓存：写后读必须拿到新数据
    clearGetCache();
    return task;
  }

  if (options.signal) return task;

  inflightGets.set(url, task);
  try {
    const value = await task;
    getCache.set(url, { at: Date.now(), value });
    return value;
  } finally {
    inflightGets.delete(url);
  }
}

export const api = {
  /**
   * 清空 GET 缓存。**登录/退出登录时必须调用**：否则换账号后可能读到上一个会话的缓存数据。
   */
  clearCache(): void {
    clearGetCache();
  },
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal): Promise<T> =>
    request<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData): Promise<T> => request<T>(path, { method: 'POST', formData }),

  /**
   * 带进度回调的上传（大文件视频用）。
   * fetch 无法获取上传进度，因此这里用 XHR；错误信封解析与 request() 保持一致。
   */
  uploadWithProgress<T>(path: string, formData: FormData, onProgress?: (percent: number) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}${path}`, true);
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        let parsed: unknown = null;
        try {
          parsed = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : null;
        } catch {
          parsed = xhr.responseText;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed as T);
          return;
        }
        reject(new ApiError(xhr.status, (parsed as ApiErrorBody | null)?.error));
      });
      xhr.addEventListener('error', () => reject(new ApiError(0, { code: 'INTERNAL', message: '网络错误，上传失败' })));
      xhr.addEventListener('abort', () => reject(new ApiError(0, { code: 'INTERNAL', message: '上传已取消' })));
      xhr.send(formData);
    });
  },

  /**
   * 下载（CSV 等）：自动从 Content-Disposition 解析文件名并触发浏览器下载。
   * 统一走这里，避免各处重复实现「文件名带中文」的处理。
   */
  async download(path: string, query?: RequestOptions['query']): Promise<void> {
    const res = await fetch(buildUrl(path, query), { credentials: 'include' });
    if (!res.ok) {
      const text = await res.text();
      let parsed: ApiErrorBody | null = null;
      try {
        parsed = JSON.parse(text) as ApiErrorBody;
      } catch {
        /* 非 JSON 错误体，使用默认文案 */
      }
      throw new ApiError(res.status, parsed?.error);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const filename = match?.[1] ? decodeURIComponent(match[1]) : 'download.csv';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export type { Page };
