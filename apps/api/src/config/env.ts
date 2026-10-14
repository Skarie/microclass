/**
 * 运行时配置：全部来自环境变量，启动时校验，失败即快速退出（fail-fast）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 仓库根目录。HERE 是 `apps/api/src/config`（编译后为 `apps/api/dist/config`），
 * 因此需要向上四级才能回到 monorepo 根。
 */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

/**
 * 读取器统一以传入的 env 为准（而不是直接读 process.env），
 * 这样测试可以用一个显式的 env 对象覆盖任意变量。
 */
function str(name: string, fallback: string, env: NodeJS.ProcessEnv): string {
  const v = env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number, env: NodeJS.ProcessEnv, min?: number, max?: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number.parseInt(raw, 10);
  if (Number.isNaN(v)) throw new Error(`环境变量 ${name} 必须是整数，当前为 "${raw}"`);
  if (min !== undefined && v < min) throw new Error(`环境变量 ${name} 不能小于 ${min}`);
  if (max !== undefined && v > max) throw new Error(`环境变量 ${name} 不能大于 ${max}`);
  return v;
}

function bool(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  siteName: string;
  logLevel: string;
  /** 数据目录（SQLite / 上传文件 / 会话密钥） */
  dataDir: string;
  /** 迁移 SQL 目录 */
  migrationsDir: string;
  /** 前端构建产物目录（存在则托管） */
  webDistDir: string;
  /** 管理员引导账号（仅首次初始化使用） */
  bootstrapAdminUser: string;
  bootstrapAdminPass: string;
  /** 初始媒体根目录（首次初始化写入设置，JSON 数组） */
  mediaRoots: unknown[];
  /** 会话密钥（不配置则持久化到 dataDir/.secret） */
  sessionSecret: string | null;
  /** 是否开放学生自助注册 */
  allowRegister: boolean;
  /** 上传大小上限（MB） */
  maxUploadMb: number;
  /** 单个视频上传上限（MB）；课程视频通常远大于普通附件 */ maxVideoMb: number;
  /** 限流：每窗口请求数 */
  rateLimitMax: number;
  rateLimitWindow: string;
  /** 可信代理（反代场景下取真实 IP/协议） */
  trustProxy: boolean;
  /** 跨站请求白名单（Origin 校验）；同源请求自动放行，无需配置 */
  allowedOrigins: string[];
  /** 是否下发严格 CSP（默认关闭；同源托管时可开启） */
  cspEnabled: boolean;
  /** ffprobe 可执行文件路径（留空则按 PATH 探测；缺失时跳过元数据抽取） */
  ffprobePath: string;
  /** ffmpeg 可执行文件路径（同上，用于抽封面帧） */
  ffmpegPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = str('MC_DATA_DIR', path.join(REPO_ROOT, 'data'), env);
  let mediaRoots: unknown[] = [];
  const rawRoots = env.MC_MEDIA_ROOTS;
  if (rawRoots) {
    try {
      const parsed: unknown = JSON.parse(rawRoots);
      if (Array.isArray(parsed)) mediaRoots = parsed;
    } catch {
      throw new Error('环境变量 MC_MEDIA_ROOTS 必须是 JSON 数组');
    }
  }
  const appEnv = str('MC_ENV', str('NODE_ENV', 'development', env), env);
  return {
    env: (['development', 'test', 'production'].includes(appEnv) ? appEnv : 'development') as AppConfig['env'],
    host: str('MC_HOST', '0.0.0.0', env),
    port: int('MC_PORT', 8091, env, 1, 65535),
    siteName: str('MC_SITE_NAME', '微课堂', env),
    logLevel: str('MC_LOG_LEVEL', 'info', env),
    dataDir: path.resolve(dataDir),
    migrationsDir: str('MC_MIGRATIONS_DIR', path.join(REPO_ROOT, 'db', 'migrations'), env),
    webDistDir: str('MC_WEB_DIST', path.join(REPO_ROOT, 'apps', 'web', 'dist'), env),
    bootstrapAdminUser: str('MC_ADMIN_USER', 'admin', env),
    bootstrapAdminPass: str('MC_ADMIN_PASS', 'admin123', env),
    mediaRoots,
    sessionSecret: env.MC_SESSION_SECRET ?? null,
    allowRegister: bool('MC_ALLOW_REGISTER', true, env),
    maxUploadMb: int('MC_MAX_UPLOAD_MB', 50, env, 1, 2048),
    maxVideoMb: int('MC_MAX_VIDEO_MB', 2048, env, 1, 20480),
    rateLimitMax: int('MC_RATE_LIMIT_MAX', 300, env, 1),
    rateLimitWindow: str('MC_RATE_LIMIT_WINDOW', '1 minute', env),
    trustProxy: bool('MC_TRUST_PROXY', true, env),
    allowedOrigins: str('MC_ALLOWED_ORIGINS', '', env)
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter((s) => s !== ''),
    cspEnabled: bool('MC_CSP', false, env),
    ffprobePath: str('MC_FFPROBE_PATH', '', env),
    ffmpegPath: str('MC_FFMPEG_PATH', '', env),
  };
}
