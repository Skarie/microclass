/**
 * 体检计算 runner：把「算全库体检」这件事交给**独立子进程**。
 *
 * 2.3.2 起改为 `ionice -c3 nice -n 19` 启动的子进程（容器里没有 ionice 时自动回退）：
 * 全库扫描是几十万行 / GB 级读，机械盘上会和主服务抢 IO；用 idle 级 IO 优先级 +
 * 最低 CPU 优先级跑，主线程的请求不再被它拖住。
 *
 * 测试/本地小库仍用 `createInlineHealthRunner(db)`：同一段聚合在主线程算，
 * 便于断言并发与落库。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.js';
import type { SettingsRepository } from '../db/repositories/settingsRepository.js';
import { computeGlobalHealthPayload, type BankHealthPayload } from '../db/repositories/bankHealthPayload.js';

/** 一次体检计算（异步：生产走子进程，测试可替换） */
export type BankHealthRunner = (limit: number) => Promise<BankHealthPayload>;

/** 子进程输出的消息约定 */
interface ChildMessage {
  ok: boolean;
  payload?: BankHealthPayload;
  error?: string;
}

/** 跑一次子进程并把 stdout 的 JSON 解析成 payload */
function runHealthChild(bin: string, args: string[], dbFile: string, limit: number): Promise<BankHealthPayload> {
  return new Promise<BankHealthPayload>((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, MC_HEALTH_DB: dbFile, MC_HEALTH_LIMIT: String(limit) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream) {
      reject(new Error('体检子进程没有可读的 stdout'));
      return;
    }
    let stdout = '';
    let stderr = '';
    stdoutStream.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    stderrStream?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => {
      let message: ChildMessage;
      try {
        message = JSON.parse(stdout.trim() || '{}') as ChildMessage;
      } catch {
        reject(new Error(`体检子进程输出不可解析（code=${code}）: ${stderr.slice(0, 200)}`));
        return;
      }
      if (message.ok && message.payload) {
        resolve(message.payload);
        return;
      }
      reject(new Error(message.error ?? `体检子进程异常退出（code=${code}）`));
    });
  });
}

/**
 * 生产 runner：idle IO + 最低 CPU 优先级跑子进程。
 *
 * 容器镜像里可能没有 ionice（极简镜像），此时按同样参数回退到普通子进程，
 * 保证功能不受影响，只是少了 IO 限速。
 */
export function createWorkerHealthRunner(dbFile: string): BankHealthRunner {
  return async (limit) => {
    // 编译产物里本文件在 dist/services/，子进程入口在 dist/workers/
    const childScript = fileURLToPath(new URL('../workers/bankHealthChild.js', import.meta.url));
    const plain = [process.execPath, childScript];
    // 三级回退：容器里用 ionice（idle IO）+ nice(19)；没有 ionice 就只 nice；
    // 开发机（Windows/macOS）两者都没有，直接跑 node —— 功能不能因此不可用。
    const attempts: { bin: string; args: string[] }[] = [
      { bin: 'ionice', args: ['-c3', '-n', '7', 'nice', '-n', '19', ...plain] },
      { bin: 'nice', args: ['-n', '19', ...plain] },
      { bin: process.execPath, args: [childScript] },
    ];
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        return await runHealthChild(attempt.bin, attempt.args, dbFile, limit);
      } catch (e) {
        lastError = e;
        // 只有「命令不存在」才继续回退；其它错误（算挂了、超时）直接抛出
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('体检子进程无法启动');
  };
}

/** 进程内 runner：测试与「无法起进程」的场景（语义与子进程完全一致） */
export function createInlineHealthRunner(db: Db, settings: SettingsRepository): BankHealthRunner {
  return (limit) => Promise.resolve().then(() => computeGlobalHealthPayload(db, settings, limit));
}
