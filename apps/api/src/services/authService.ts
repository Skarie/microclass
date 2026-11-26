/**
 * 认证服务：登录、注册、改密、管理员引导初始化。
 *
 * P0 阶段 2：`UserRepository` 走 `AsyncDb` 后本服务全部方法改异步，
 * 调用点（`http/guards.ts` 的 onRequest、`routes/auth.ts`、`routes/users.ts`、`app.ts` 引导）
 * 必须 `await` —— 否则会把 Promise 当成 user 用（鉴权链路最容易踩）。
 */
import { AppError } from '@microclass/shared';
import type { UserRepository } from '../db/repositories/userRepository.js';
import type { SettingsRepository } from '../db/repositories/settingsRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import { assertPasswordPolicy, hashPassword, newSalt, verifyPassword } from '../security/password.js';
import type { SessionSigner } from '../security/session.js';
import type { User } from '@microclass/shared';

const USERNAME_RE = /^[a-z0-9_\u4e00-\u9fa5]{2,32}$/i;

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditRepository,
    private readonly signer: SessionSigner,
  ) {}

  /** 首次启动引导：无任何用户时创建管理员 */
  async bootstrapAdmin(username: string, password: string): Promise<number | null> {
    if ((await this.users.count()) > 0) return null;
    assertPasswordPolicy(password);
    const salt = newSalt();
    const id = await this.users.create({
      username: username.toLowerCase(),
      salt,
      hash: hashPassword(password, salt),
      role: 'admin',
      displayName: '管理员',
    });
    await this.audit.write({
      actorId: id,
      actorName: username,
      action: 'user.bootstrap_admin',
      targetType: 'user',
      targetId: id,
    });
    return id;
  }

  async login(input: {
    username: string;
    password: string;
    ip?: string;
    requestId?: string;
  }): Promise<{ user: User; token: string }> {
    const username = (input.username ?? '').trim().toLowerCase();
    const row = await this.users.findByUsername(username);
    if (!row || !verifyPassword(input.password ?? '', row.pass_salt, row.pass_hash)) {
      await this.audit.write({
        action: 'auth.login_failed',
        actorName: username,
        ip: input.ip,
        requestId: input.requestId,
      });
      throw AppError.unauthorized('用户名或密码错误');
    }
    const user: User = {
      id: row.id,
      username: row.username,
      role: row.role,
      display_name: row.display_name,
      created_at: row.created_at,
    };
    const token = this.signer.sign({ uid: user.id, role: user.role });
    await this.audit.write({
      actorId: user.id,
      actorName: user.username,
      action: 'auth.login',
      ip: input.ip,
      requestId: input.requestId,
    });
    return { user, token };
  }

  async register(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<{ user: User; token: string }> {
    if (!this.settings.getBoolSync('allow_register', true)) {
      throw AppError.forbidden('未开放自助注册，请联系管理员开通账号');
    }
    const username = (input.username ?? '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw AppError.badRequest('用户名需为 2-32 位字母/数字/下划线/中文');
    assertPasswordPolicy(input.password ?? '');
    if (await this.users.findByUsername(username)) throw AppError.conflict('用户名已存在');
    const salt = newSalt();
    const id = await this.users.create({
      username,
      salt,
      hash: hashPassword(input.password, salt),
      role: 'student',
      displayName: input.displayName?.trim() || username,
    });
    const user = await this.users.findById(id);
    if (!user) throw AppError.internal('创建用户失败');
    const publicUser: User = {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      created_at: user.created_at,
    };
    await this.audit.write({
      actorId: id,
      actorName: username,
      action: 'auth.register',
      targetType: 'user',
      targetId: id,
    });
    return { user: publicUser, token: this.signer.sign({ uid: id, role: 'student' }) };
  }

  async changePassword(input: { userId: number; oldPassword: string; newPassword: string }): Promise<void> {
    const row = await this.users.findById(input.userId);
    if (!row) throw AppError.notFound('用户不存在');
    if (!verifyPassword(input.oldPassword ?? '', row.pass_salt, row.pass_hash)) {
      throw AppError.badRequest('原密码不正确');
    }
    assertPasswordPolicy(input.newPassword ?? '');
    const salt = newSalt();
    await this.users.updatePassword(row.id, salt, hashPassword(input.newPassword, salt));
    await this.audit.write({
      actorId: row.id,
      actorName: row.username,
      action: 'auth.change_password',
      targetType: 'user',
      targetId: row.id,
    });
  }

  /** 管理员创建学生（或教师） */
  async createUserByAdmin(
    input: { username: string; password: string; role?: 'student' | 'teacher'; displayName?: string },
    actor: User,
  ): Promise<number> {
    const username = (input.username ?? '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw AppError.badRequest('用户名需为 2-32 位字母/数字/下划线/中文');
    assertPasswordPolicy(input.password ?? '');
    if (await this.users.findByUsername(username)) throw AppError.conflict('用户名已存在');
    const role = input.role === 'teacher' ? 'teacher' : 'student';
    const salt = newSalt();
    const id = await this.users.create({
      username,
      salt,
      hash: hashPassword(input.password, salt),
      role,
      displayName: input.displayName?.trim() || username,
    });
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'user.create',
      targetType: 'user',
      targetId: id,
      detail: { role },
    });
    return id;
  }

  async resetPasswordByAdmin(userId: number, newPassword: string, actor: User): Promise<void> {
    const row = await this.users.findById(userId);
    if (!row) throw AppError.notFound('用户不存在');
    assertPasswordPolicy(newPassword);
    const salt = newSalt();
    await this.users.updatePassword(userId, salt, hashPassword(newPassword, salt));
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'user.reset_password',
      targetType: 'user',
      targetId: userId,
    });
  }
}
