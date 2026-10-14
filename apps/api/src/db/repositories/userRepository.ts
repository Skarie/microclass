/**
 * 仓储层：只负责 SQL 与行映射，不含业务规则。
 */
import type { User } from '@microclass/shared';
import type { Db } from '../client.js';

export interface UserRow extends User {
  pass_salt: string;
  pass_hash: string;
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  count(): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c ?? 0;
  }

  findByUsername(username: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
  }

  findById(id: number): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  }

  listStudents(): User[] {
    return this.db.all<User>(
      "SELECT id, username, role, display_name, created_at FROM users WHERE role = 'student' ORDER BY id",
    );
  }

  listAll(): User[] {
    return this.db.all<User>('SELECT id, username, role, display_name, created_at FROM users ORDER BY id');
  }

  create(input: { username: string; salt: string; hash: string; role: User['role']; displayName?: string }): number {
    const info = this.db.run(
      'INSERT INTO users (username, pass_salt, pass_hash, role, display_name) VALUES (?,?,?,?,?)',
      [input.username, input.salt, input.hash, input.role, input.displayName ?? ''],
    );
    return info.lastInsertRowid;
  }

  updatePassword(id: number, salt: string, hash: string): void {
    this.db.run('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?', [salt, hash, id]);
  }

  updateProfile(id: number, username: string, displayName: string): void {
    this.db.run('UPDATE users SET username = ?, display_name = ? WHERE id = ?', [username, displayName, id]);
  }

  deleteStudent(id: number): number {
    const info = this.db.run("DELETE FROM users WHERE id = ? AND role = 'student'", [id]);
    return info.changes;
  }
}
