/**
 * 题库章节目录与批量回填路由。
 *
 * - `GET /banks/catalog-sections?view=book|course&kind=`：前端「册次 → 章节 → 题库」的数据源；
 * - `POST /banks/backfill-sections`：给历史题库补章节（dryRun 预览，确认后写库）。
 *
 * 现有 `GET /banks/catalog`（课程 → 章节 → 小节 → 题库）保持不变，两者并存。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import {
  parseBackfillSectionsBody,
  parseBankSectionCatalogQuery,
  type BankSectionCatalogQuery,
} from './bankSectionQuery.js';

export async function registerBankSectionRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/banks/catalog-sections', async (req, reply) => {
    requireUser(req, reply);
    const { view, kind } = parseBankSectionCatalogQuery(req.query as BankSectionCatalogQuery);
    return deps.bankService.catalogSections(view, kind);
  });

  app.post('/banks/backfill-sections', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const { dryRun, kind } = parseBackfillSectionsBody(req.body);
    return deps.bankService.backfillSections(actor, { dryRun, kind });
  });
}
