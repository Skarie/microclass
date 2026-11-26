/**
 * 仓储层：只负责 SQL 与行映射，不含业务规则。
 *
 * P0 阶段 2：改为走 `AsyncDb`（sqlite / pg 双栈），方法全部异步。
 * `create` 用 `INSERT ... RETURNING id`（SQLite 3.35+ 与 PG 都支持），不再依赖 lastInsertRowid。
 */
import type { User } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';

export interface UserRow extends User {
  pass_salt: string;
  pass_hash: string;
}

export class UserRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  /** 已迁移方法统一走异步端口；单测直接注入 `Db` 时退回 sqlite 包装（行为等价） */
  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async count(): Promise<number> {
    const row = await this.adb().get<{ c: number | string }>('SELECT COUNT(*) AS c FROM users');
    return Number(row?.c ?? 0);
  }

  async findByUsername(username: string): Promise<UserRow | undefined> {
    return this.adb().get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
  }

  async findById(id: number): Promise<UserRow | undefined> {
    return this.adb().get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  }

  async listStudents(): Promise<User[]> {
    return this.adb().all<User>(
      "SELECT id, username, role, display_name, created_at FROM users WHERE role = 'student' ORDER BY id",
    );
  }

  async listAll(): Promise<User[]> {
    return this.adb().all<User>('SELECT id, username, role, display_name, created_at FROM users ORDER BY id');
  }

  async create(input: {
    username: string;
    salt: string;
    hash: string;
    role: User['role'];
    displayName?: string;
  }): Promise<number> {
    const row = await this.adb().get<{ id: number | string }>(
      `INSERT INTO users (username, pass_salt, pass_hash, role, display_name)
       VALUES (?,?,?,?,?)
       RETURNING id`,
      [input.username, input.salt, input.hash, input.role, input.displayName ?? ''],
    );
    return Number(row?.id ?? 0);
  }

  async updatePassword(id: number, salt: string, hash: string): Promise<void> {
    await this.adb().run('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?', [salt, hash, id]);
  }

  async updateProfile(id: number, username: string, displayName: string): Promise<void> {
    await this.adb().run('UPDATE users SET username = ?, display_name = ? WHERE id = ?', [username, displayName, id]);
  }

  async deleteStudent(id: number): Promise<number> {
    const result = await this.adb().run("DELETE FROM users WHERE id = ? AND role = 'student'", [id]);
    return result.changes;
  }
}
