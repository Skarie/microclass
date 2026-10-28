/**
 * 题库文件夹路由：文件夹树、课程关联视图汇总、以及教师/管理员可用的文件夹增删改。
 *
 * 与 `banks-crud`（题库自身）分开：文件夹是树，写操作只有三类（建 / 改名或移动 / 删空目录）。
 * 路径、请求体与返回结构见产品契约：
 *   GET    /banks/folders              文件夹树 + 未分类统计
 *   GET    /banks/course-summary       有关联课程的题库汇总
 *   POST   /banks/folders              新建（201）
 *   PATCH  /banks/folders/:id          改名 / 移动 / 排序
 *   DELETE /banks/folders/:id          只能删空文件夹
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import type { FolderCreateInput, FolderUpdateInput } from '../services/bankFolderService.js';

const folderCreateBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    parentId: { type: ['integer', 'null'] },
    /** 上限放宽到 200，由服务端 trim 后再校验 120（避免「前后空格把合法名字顶成 400」） */
    name: { type: 'string', minLength: 1, maxLength: 200 },
  },
  additionalProperties: false,
} as const;

const folderUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    parentId: { type: ['integer', 'null'] },
    sort: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

/** `/banks/folders/:id` 的 id：非整数直接 400（而不是落到 SQL 里查不到变 404） */
function folderIdOf(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('文件夹 id 非法');
  return id;
}

export async function registerBankFolderRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 文件夹树：bankCount/questionCount 含子孙，folderCount 是直接子文件夹数 */
  app.get('/banks/folders', async (req, reply) => {
    requireUser(req, reply);
    return deps.bankService.folderTree();
  });

  /** 课程关联视图：只返回有题库的课程 + 未关联课程的合计 */
  app.get('/banks/course-summary', async (req, reply) => {
    requireUser(req, reply);
    return deps.bankService.folderCourseSummary();
  });

  app.post('/banks/folders', { schema: { body: folderCreateBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const body = req.body as FolderCreateInput;
    const folder = deps.bankService.createFolder(actor, {
      name: body.name,
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
    });
    return reply.code(201).send({ folder });
  });

  app.patch('/banks/folders/:id', { schema: { body: folderUpdateBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    return { folder: deps.bankService.updateFolder(actor, folderIdOf(req), req.body as FolderUpdateInput) };
  });

  app.delete('/banks/folders/:id', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    deps.bankService.removeFolder(actor, folderIdOf(req));
    return { ok: true };
  });
}
