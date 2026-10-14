/**
 * 试卷预览与打印路由。
 *
 * - `GET /exams/:id/paper.html`：服务端渲染的**可打印试卷**（A4/A3、横竖版、双栏、
 *   含答案与解析、答题卡、密封线），浏览器直接打印或「另存为 PDF」；
 * - `GET /paper-assets/katex.min.css` 与 `/paper-assets/fonts/:file`：自托管 KaTeX 样式与字体，
 *   局域网/离线环境不依赖 CDN，否则打印出来的数学公式没有字体（会错位）。
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';

const require = createRequire(import.meta.url);
/** katex 的 dist 目录（CSS 与 fonts 都从这里取，随镜像一起发布） */
function katexDistDir(): string {
  try {
    return path.dirname(require.resolve('katex/dist/katex.min.css'));
  } catch {
    return '';
  }
}

export async function registerPaperRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 自托管 KaTeX 样式（试卷 HTML 里的 <link>） */
  app.get('/paper-assets/katex.min.css', async (_req, reply) => {
    const file = path.join(katexDistDir(), 'katex.min.css');
    if (!fs.existsSync(file)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '缺少 katex 资源' } });
    return reply
      .type('text/css; charset=utf-8')
      .header('cache-control', 'public, max-age=604800')
      .send(fs.readFileSync(file));
  });

  /** KaTeX 字体（@font-face 会按相对路径请求 fonts/xxx.woff2） */
  app.get('/paper-assets/fonts/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[\w.-]+\.(woff2?|ttf)$/i.test(file)) throw AppError.badRequest('文件名非法');
    const abs = path.join(katexDistDir(), 'fonts', file);
    if (!abs.startsWith(path.join(katexDistDir(), 'fonts')) || !fs.existsSync(abs)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '字体不存在' } });
    }
    const type = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'font/ttf';
    return reply.type(type).header('cache-control', 'public, max-age=604800').send(fs.readFileSync(abs));
  });

  /**
   * 可打印试卷。查询参数：
   *   `size=A4|A3`、`orientation=portrait|landscape`、`columns=1|2`、
   *   `answers=1`（附答案与解析）、`sheet=1`（附答题卡）、`seal=1`（密封线）、
   *   `print=1`（载入后自动弹打印对话框）、`scoreBox=0`（不显示每题分值）。
   */
  app.get('/exams/:id/paper.html', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const q = req.query as Record<string, string | undefined>;
    const html = deps.examService.paperHtml(id, {
      size: q.size === 'A3' ? 'A3' : 'A4',
      orientation: q.orientation === 'landscape' ? 'landscape' : 'portrait',
      columns: q.columns === '2' ? 2 : 1,
      withAnswers: q.answers === '1' || q.answers === 'true',
      withAnswerSheet: q.sheet === '1' || q.sheet === 'true',
      withSeal: q.seal === '1' || q.seal === 'true',
      showScoreBox: q.scoreBox !== '0',
      autoPrint: q.print === '1' || q.print === 'true',
      ...(q.fillLines ? { fillLines: Math.max(1, Math.min(5, Number(q.fillLines) || 1)) } : {}),
      ...(q.answerSpace ? { answerSpaceMm: Math.max(15, Math.min(120, Number(q.answerSpace) || 30)) } : {}),
    });
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
  });
}
