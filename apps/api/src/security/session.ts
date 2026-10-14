/**
 * 会话令牌：HMAC-SHA256 签名的无状态令牌，置于 HttpOnly Cookie。
 * 密钥优先取环境变量，否则持久化到 dataDir/.secret（0600）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SESSION_COOKIE, SESSION_TTL_MS } from '@microclass/shared';

export interface SessionPayload {
  uid: number;
  role: string;
  exp: number;
  /** 随机串，便于日志区分会话 */
  sid: string;
}

export class SessionSigner {
  private readonly secret: string;

  constructor(secret: string | null, dataDir: string) {
    if (secret && secret.length >= 16) {
      this.secret = secret;
      return;
    }
    const file = path.join(dataDir, '.secret');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length >= 16) {
        this.secret = existing;
        return;
      }
    } catch {
      /* 首次运行，下面生成 */
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    this.secret = generated;
  }

  sign(payload: Omit<SessionPayload, 'exp' | 'sid'> & Partial<Pick<SessionPayload, 'exp' | 'sid'>>): string {
    const full: SessionPayload = {
      uid: payload.uid,
      role: payload.role,
      exp: payload.exp ?? Date.now() + SESSION_TTL_MS,
      sid: payload.sid ?? crypto.randomBytes(8).toString('hex'),
    };
    const body = Buffer.from(JSON.stringify(full)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string | undefined | null): SessionPayload | null {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
      if (!payload.exp || payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  static cookieOptions(): { httpOnly: true; sameSite: 'lax'; path: string; maxAge: number; secure: boolean } {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: process.env.MC_COOKIE_SECURE === '1',
    };
  }

  static cookieName(): string {
    return SESSION_COOKIE;
  }
}
