<script setup lang="ts">
/**
 * 设计系统 / 组件规范。
 *
 * 两个用途：
 *  1. 团队看"标准长什么样"——颜色、排版、间距、按钮层级、表单、标签、进度、表格、空状态的唯一出处；
 *  2. **视觉回归的稳定靶子**：这一页不依赖业务数据，截图对比不会因为数据变化误报。
 *
 * 约定：新增组件先在这里加一段，再用于业务页面。
 */
import { ref } from 'vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import BarList from '@/components/charts/BarList.vue';
import type { BarItem } from '@/components/charts/types';
import TrendChart from '@/components/charts/TrendChart.vue';
import Sparkline from '@/components/charts/Sparkline.vue';
import ProgressRing from '@/components/charts/ProgressRing.vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import StatCard from '@/components/StatCard.vue';
import Tag from '@/components/Tag.vue';
import Toolbar from '@/components/Toolbar.vue';
import { ICONS, type IconName } from '@/components/icons';

const iconNames = Object.keys(ICONS) as IconName[];
const menuPick = ref('');
const progress = ref(42);

/** 图表示例数据（与学情分析页同结构，方便对照组件用法） */
const dsBars: BarItem[] = [
  {
    key: 'a',
    label: '年、月、日时间的推算',
    value: 20,
    tone: 'danger',
    icon: 'close',
    valueText: '0%',
    hint: '20 错 / 20 作答',
  },
  {
    key: 'b',
    label: '圆锥的体积',
    value: 1,
    tone: 'success',
    icon: 'award',
    valueText: '99%',
    hint: '1 错 / 142 作答',
  },
  {
    key: 'c',
    label: '化学变化和物理变化',
    value: 1,
    tone: 'success',
    icon: 'award',
    valueText: '98%',
    hint: '1 错 / 41 作答',
  },
  {
    key: 'd',
    label: '人类重要的营养物质',
    value: 0,
    tone: 'info',
    icon: 'helpCircle',
    valueText: '—',
    hint: '数据不足',
  },
];

const dsTrend = [
  { day: '2026-09-10', graded: 40, wrong: 6, accuracy: 0.85 },
  { day: '2026-09-11', graded: 72, wrong: 9, accuracy: 0.875 },
  { day: '2026-09-12', graded: 55, wrong: 4, accuracy: 0.927 },
  { day: '2026-09-13', graded: 96, wrong: 18, accuracy: 0.8125 },
  { day: '2026-09-14', graded: 61, wrong: 5, accuracy: 0.918 },
];
const colorTokens = [
  ['--mc-primary', '主色'],
  ['--mc-primary-fg', '主色（文字用）'],
  ['--mc-primary-soft', '主色浅底'],
  ['--mc-success', '成功'],
  ['--mc-success-fg', '成功（文字用）'],
  ['--mc-warning', '警告'],
  ['--mc-warning-fg', '警告（文字用）'],
  ['--mc-danger', '危险'],
  ['--mc-danger-fg', '危险（文字用）'],
  ['--mc-info', '信息'],
  ['--mc-text', '正文'],
  ['--mc-text-secondary', '次要文字'],
  ['--mc-text-muted', '弱化文字'],
  ['--mc-bg', '页面底色'],
  ['--mc-bg-sunken', '凹陷底色'],
  ['--mc-border', '边框'],
];
</script>

<template>
  <section class="page mc-col ds">
    <PageHeader
      title="设计系统"
      description="颜色令牌、排版层级、按钮优先级与基础组件的唯一出处。新增组件先在这里落地，再用于业务页面。"
      icon="grid"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '设计系统' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" @click="progress = progress >= 100 ? 0 : progress + 12">
          <Icon name="refresh" :size="15" />
          改一个进度值
        </button>
      </template>
    </PageHeader>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">图表 Charts（自建 SVG，不引第三方库）</span>
        <span class="mc-muted ds__note">全部走设计令牌 · 带无障碍名 · 明暗主题同一套</span>
      </div>
      <div class="mc-card__body ds__col">
        <div class="ds__row ds__row--top">
          <DonutChart
            :segments="[
              { label: '掌握', value: 5, tone: 'success', icon: 'award' },
              { label: '薄弱', value: 2, tone: 'warning', icon: 'alert' },
              { label: '未掌握', value: 1, tone: 'danger', icon: 'close' },
              { label: '数据不足', value: 3, tone: 'info', icon: 'helpCircle' },
            ]"
            :center-value="11"
            center-label="个知识点"
          />
        </div>
        <BarList :items="dsBars" caption="示例条形榜" clickable />
        <TrendChart :data="dsTrend" :height="200" />
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">指标卡 StatCard</span></div>
      <div class="mc-card__body ds__row">
        <StatCard label="课程总数" :value="53" unit="门" icon="courses" tone="primary" />
        <StatCard
          label="已学完课时"
          :value="128"
          unit="个"
          icon="check-circle"
          tone="success"
          :trend="{ value: 8, label: '较上周' }"
        />
        <StatCard label="待核对冲突" :value="120" unit="组" icon="conflict" tone="warning" hint="需要人工判断" />
        <StatCard label="整体正确率" :value="'94%'" icon="chartBar" tone="success" hint="错 25 条">
          <template #visual>
            <ProgressRing :value="0.94" tone="success" label="正确率 94%" />
            <Sparkline :values="[12, 30, 18, 42, 36, 60, 55]" tone="success" />
          </template>
        </StatCard>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">按钮优先级 Button</span></div>
      <div class="mc-card__body ds__col">
        <div class="ds__row">
          <button class="mc-btn mc-btn--primary" type="button"><Icon name="plus" :size="15" />主操作</button>
          <button class="mc-btn mc-btn--soft" type="button"><Icon name="upload" :size="15" />次操作（软色）</button>
          <button class="mc-btn" type="button">普通按钮</button>
          <button class="mc-btn mc-btn--ghost" type="button">弱化（ghost）</button>
          <button class="mc-btn mc-btn--danger" type="button">危险（描边）</button>
          <button class="mc-btn mc-btn--danger-solid" type="button">危险（实心）</button>
          <button class="mc-btn mc-btn--icon" type="button" aria-label="图标按钮">
            <Icon name="settings" :size="16" />
          </button>
          <button class="mc-btn mc-btn--primary" type="button" disabled>禁用</button>
        </div>
        <div class="ds__row">
          <button class="mc-btn mc-btn--sm" type="button">小号</button>
          <button class="mc-btn" type="button">中号</button>
          <button class="mc-btn mc-btn--lg" type="button">大号</button>
          <DropdownMenu
            :items="[
              { key: 'a', label: '导出 CSV', icon: 'download', hint: 'Excel 编辑' },
              { key: 'b', label: '导出 Word', icon: 'print' },
              { key: 'c', label: '删除题库', icon: 'trash', danger: true },
              { key: 'd', label: '不可用项', icon: 'close', disabled: true },
            ]"
            @select="menuPick = $event"
          />
          <span class="mc-muted">下拉选中：{{ menuPick || '（未选）' }}</span>
        </div>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">标签与进度 Tag / ProgressBar</span></div>
      <div class="mc-card__body ds__col">
        <div class="ds__row">
          <Tag>中性</Tag>
          <Tag tone="primary" icon="book-open">主色</Tag>
          <Tag tone="success" icon="check">已学完</Tag>
          <Tag tone="warning" icon="alert">待核对</Tag>
          <Tag tone="danger" icon="close">冲突</Tag>
          <Tag tone="info" icon="info">信息</Tag>
          <Tag outline tone="primary">描边</Tag>
          <Tag size="sm">小号</Tag>
        </div>
        <div class="ds__col ds__progress">
          <ProgressBar :value="progress" :label="`${progress}%`" />
          <ProgressBar :value="progress" tone="success" show-value />
          <ProgressBar :value="3" label="3%（最小可见宽度）" />
          <ProgressBar :value="100" tone="success" label="100%" />
        </div>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">工具栏与表单 Toolbar / Form</span></div>
      <Toolbar>
        <template #left>
          <label class="mc-row ds__pick">
            <span class="mc-label">类型</span>
            <select class="mc-select" aria-label="类型">
              <option>全部类型</option>
            </select>
          </label>
          <label class="mc-row ds__pick">
            <span class="mc-label">关键词</span>
            <input class="mc-input" type="search" placeholder="搜索题干关键词" aria-label="关键词" />
          </label>
          <label class="mc-checkbox"><input type="checkbox" checked /> 只看未完成</label>
        </template>
        <template #right>
          <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button"><Icon name="reset" :size="15" />重置</button>
          <button class="mc-btn mc-btn--sm" type="button"><Icon name="search" :size="15" />查询</button>
        </template>
      </Toolbar>
      <div class="mc-card__body ds__col">
        <div class="mc-field">
          <label class="mc-label mc-label--required" for="ds-input">必填输入</label>
          <input id="ds-input" class="mc-input" placeholder="请输入内容" />
          <span class="mc-hint">提示文字：这里是填写说明。</span>
        </div>
        <div class="mc-field">
          <label class="mc-label" for="ds-error">校验失败的样子</label>
          <input id="ds-error" class="mc-input" value="错误值" aria-invalid="true" />
          <span class="mc-error-text">该值与题干答案不一致。</span>
        </div>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">表格 Table</span></div>
      <div class="mc-table-wrap" tabindex="0" role="region" aria-label="设计系统示例表格（可用方向键横向滚动）">
        <table class="mc-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>题干</th>
              <th>题型</th>
              <th class="mc-num">分值</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Java 中定义常量的关键字是？</td>
              <td><Tag size="sm">单选题</Tag></td>
              <td class="mc-num">3</td>
            </tr>
            <tr>
              <td>2</td>
              <td>程序入口方法是 ____ 。</td>
              <td><Tag size="sm" tone="info">填空题</Tag></td>
              <td class="mc-num">4</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">空状态 EmptyState</span></div>
      <div class="mc-card__body ds__row">
        <EmptyState icon="search" title="没有匹配的课程" description="换个关键词或清空筛选条件试试。" />
        <EmptyState
          icon="video"
          title="还没有课时"
          description="上传视频或新建课时后在这里管理。"
          action-text="新建课时"
        />
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">颜色令牌</span></div>
      <div class="mc-card__body ds__swatches">
        <div v-for="[token, label] in colorTokens" :key="token" class="ds__swatch">
          <span class="ds__swatch-chip" :style="{ background: `var(${token})` }" />
          <span class="ds__swatch-label">{{ label }}</span>
          <code class="ds__swatch-token">{{ token }}</code>
        </div>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header"><span class="mc-card__title">排版层级</span></div>
      <div class="mc-card__body ds__col">
        <p class="ds__type ds__type--4xl">4xl 40px 页面巨标题</p>
        <p class="ds__type ds__type--3xl">3xl 32px 区块标题</p>
        <p class="ds__type ds__type--2xl">2xl 28px 页面标题</p>
        <p class="ds__type ds__type--lg">lg 18px 卡片标题</p>
        <p class="ds__type ds__type--md">md 15px 小标题</p>
        <p class="ds__type">base 14px 正文：题目与解析都用这一级，行高 1.6。</p>
        <p class="ds__type ds__type--sm mc-muted">sm 13px 弱化说明文字</p>
        <p class="ds__type ds__type--xs mc-muted">xs 12px 表格与标签辅助文字</p>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">图标集（{{ iconNames.length }} 个）</span>
        <span class="mc-muted">24×24 描边、currentColor、线宽 1.75</span>
      </div>
      <div class="mc-card__body ds__icons">
        <span v-for="name in iconNames" :key="name" class="ds__icon" :title="name">
          <Icon :name="name" :size="20" />
          <code>{{ name }}</code>
        </span>
      </div>
    </section>
  </section>
</template>

<style scoped>
.ds__col {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}

.ds__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-3);
  align-items: center;
}

.ds__pick {
  gap: var(--mc-space-2);
}

.ds__progress {
  gap: var(--mc-space-3);
  max-width: 520px;
}

.ds__swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--mc-space-3);
}

.ds__swatch {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
}

.ds__swatch-chip {
  width: 26px;
  height: 26px;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  flex: none;
}

.ds__swatch-label {
  color: var(--mc-text-secondary);
}

.ds__swatch-token {
  color: var(--mc-text-muted);
  font-family: var(--mc-font-mono);
  font-size: var(--mc-text-xs);
  margin-left: auto;
}

.ds__type {
  margin: 0;
}

.ds__type--4xl {
  font-size: var(--mc-text-4xl);
  font-weight: var(--mc-font-bold);
}

.ds__type--3xl {
  font-size: var(--mc-text-3xl);
  font-weight: var(--mc-font-semibold);
}

.ds__type--2xl {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
}

.ds__type--lg {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
}

.ds__type--md {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-medium);
}

.ds__type--sm {
  font-size: var(--mc-text-sm);
}

.ds__type--xs {
  font-size: var(--mc-text-xs);
}

.ds__icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--mc-space-2);
}

.ds__icon {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  color: var(--mc-text-secondary);
}

.ds__icon code {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  font-family: var(--mc-font-mono);
}
.ds__note {
  font-size: var(--mc-text-xs);
}

.ds__row--top {
  align-items: flex-start;
}
</style>
