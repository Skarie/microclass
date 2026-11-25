/**
 * 站点设置仓储（settings 表，键值对）。
 *
 * P0 阶段 2（B2，方案 B）：
 *   - **写**走 `AsyncDb`（sqlite / pg 双栈），`set/setBool` 是异步的；
 *   - **读**默认走进程内快照（`load()` 在启动时把整张表读进内存），因为 settings 是低频配置表，
 *     而它的读点散落在 difficulty / 体检 payload / 媒体目录等**同步**路径上，
 *     全改 async 会级联 10+ 文件（见 docs/postgres-migration.md）。
 *   - 写操作会**同步更新快照**，所以写完立刻读能读到新值（读自己写）。
 *
 * 跨进程语义：快照是进程内的。体检子进程是短命进程，启动时 `await load()` 一次即可；
 * 其它进程（如有）改设置后，本进程需重新 `load()` 才能看到。
 */
import type { AsyncDb } from '../async.js';

export class SettingsRepository {
  /** 全表快照（key → value）；`load()` 之前为空，`getSync` 读它 */
  private snapshot = new Map<string, string>();
  private loaded = false;

  constructor(private readonly db: AsyncDb) {}

  /** 启动时调用：把整张 settings 表读进快照（幂等，可重复调用刷新） */
  async load(): Promise<void> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const next = new Map<string, string>();
    for (const r of rows) next.set(r.key, r.value);
    this.snapshot = next;
    this.loaded = true;
  }

  /** 快照是否已加载（用于断言/诊断） */
  isLoaded(): boolean {
    return this.loaded;
  }

  // ---------- 同步读（走快照） ----------

  getSync(key: string): string | undefined {
    return this.snapshot.get(key);
  }

  getBoolSync(key: string, fallback: boolean): boolean {
    const v = this.snapshot.get(key);
    if (v === undefined) return fallback;
    return v === '1' || v.toLowerCase() === 'true';
  }

  allSync(): Record<string, string> {
    return Object.fromEntries(this.snapshot);
  }

  // ---------- 异步读（走库，供管理端需要「绝对最新」的场景） ----------

  async get(key: string): Promise<string | undefined> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value;
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const v = await this.get(key);
    if (v === undefined) return fallback;
    return v === '1' || v.toLowerCase() === 'true';
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ---------- 异步写（写库 + 同步更新快照） ----------

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
    this.snapshot.set(key, value);
  }

  async setBool(key: string, value: boolean): Promise<void> {
    await this.set(key, value ? '1' : '0');
  }
}
