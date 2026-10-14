/**
 * 密码哈希：scrypt（Node 内置），常量时间比较。
 */
import crypto from 'node:crypto';

const KEY_LEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function newSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS).toString('hex');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** 密码强度：最少 6 位（企业环境可通过环境变量收紧） */
export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('密码至少 6 位');
  }
  if (password.length > 128) {
    throw new Error('密码过长');
  }
}
