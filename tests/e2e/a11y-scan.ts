import type { Page } from '@playwright/test';
import AxeBuilderImport from '@axe-core/playwright';

/**
 * axe 扫描封装。
 *
 * 为什么要这一层：`@axe-core/playwright` 的类型在 ESLint 的类型感知规则下解析不到，
 * 直接 import 会报 `no-unsafe-call`。这里显式声明我们用到的最小类型面，
 * 既消掉规则报错，也让调用方拿到的违规结构是**有类型**的（不再 any）。
 */
export interface AxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

export interface AxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

interface AxeResults {
  violations: AxeViolation[];
}

interface AxeBuilderLike {
  withTags(tags: string[]): AxeBuilderLike;
  analyze(): Promise<AxeResults>;
}

const AxeBuilder = AxeBuilderImport as unknown as new (options: { page: Page }) => AxeBuilderLike;

/** 扫描当前页面（WCAG 2.0/2.1 A + AA） */
export async function scanPage(page: Page): Promise<AxeViolation[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations;
}

/** 只保留严重/致命项（交付阻塞口径） */
export function blockingOf(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

/** 把违规整理成可读报告，便于照着改 */
export function formatViolations(violations: AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.impact === 'serious' || v.impact === 'critical' ? '!!' : '  '} ${v.id} [${v.impact ?? 'n/a'}] ×${v.nodes.length} ${v.help}\n` +
        v.nodes
          .slice(0, 6)
          .map(
            (n) =>
              `      ${JSON.stringify(n.target)} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 200)}`,
          )
          .join('\n'),
    )
    .join('\n');
}
