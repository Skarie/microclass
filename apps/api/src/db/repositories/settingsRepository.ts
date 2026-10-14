/**
 * 站点设置仓储（settings 表，键值对）。
 */
import type { Db } from '../client.js';

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  get(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value;
  }

  getBool(key: string, fallback: boolean): boolean {
    const v = this.get(key);
    if (v === undefined) return fallback;
    return v === '1' || v.toLowerCase() === 'true';
  }

  set(key: string, value: string): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  setBool(key: string, value: boolean): void {
    this.set(key, value ? '1' : '0');
  }

  all(): Record<string, string> {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
