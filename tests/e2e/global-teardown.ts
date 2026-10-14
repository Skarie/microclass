import fs from 'node:fs';
import path from 'node:path';

/**
 * E2E 收尾：清理历史运行留下的数据目录。
 *
 * 服务在测试结束后已被 Playwright 停止，但 Windows 上文件句柄可能延迟释放，
 * 因此这里逐个 try/catch，删不掉就留给下次运行（下一次本就是新目录，不影响正确性）。
 */
export default function globalTeardown(): void {
  const base = path.resolve('build/e2e-data');
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base)) {
    const target = path.join(base, entry);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // 句柄未释放：忽略，下次运行仍使用全新目录
    }
  }
}
