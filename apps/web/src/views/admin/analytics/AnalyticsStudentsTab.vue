<script setup lang="ts">
import BarList from '@/components/charts/BarList.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import type { BarItem } from '@/components/charts/types';
import { MASTERY_ICON, MASTERY_LABEL, MASTERY_TONE, pct, type StudentsResponse } from './analytics-types';

/** 学员学情页签：条形榜按错题数排序 + 明细表（水平 / 最弱知识点）。 */
defineProps<{ students: StudentsResponse | null; bars: BarItem[] }>();
</script>

<template>
  <div class="mc-card ana__panel">
    <template v-if="students && students.students.length > 0">
      <div class="mc-card__title-row">
        <span class="mc-card__title">按错题数排序（条长 = 错题数）</span>
        <span class="mc-muted ana__titlehint">共 {{ students.students.length }} 名学员有作答数据</span>
      </div>
      <BarList :items="bars" :limit="15" caption="学员错题数对比" />
      <div class="ana__tablewrap">
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>学员</th>
              <th>作答</th>
              <th>正确率</th>
              <th>水平</th>
              <th>错题数</th>
              <th>涉及知识点</th>
              <th>最弱知识点</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in students.students" :key="s.user_id">
              <td>{{ s.display_name || s.username }}</td>
              <td>{{ s.graded }}</td>
              <td>{{ pct(s.accuracy) }}</td>
              <td>
                <Tag :tone="MASTERY_TONE[s.level]" size="sm">
                  <Icon :name="MASTERY_ICON[s.level]" :size="14" />
                  {{ MASTERY_LABEL[s.level] }}
                </Tag>
              </td>
              <td>{{ s.wrong }}</td>
              <td>{{ s.points }}</td>
              <td>
                <span v-if="s.weakest_point">{{ s.weakest_point }}（错 {{ s.weakest_wrong }}）</span>
                <span v-else class="mc-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mc-hint">{{ students.dataNote }}</p>
    </template>
    <EmptyState
      v-else
      icon="users"
      title="还没有学员作答数据"
      description="学员做过课后练习或提交过考试后，这里会按错题数排出需要关注的人。"
    />
  </div>
</template>

<style scoped>
/* 卡片内边距：直接在 .mc-card 里放内容，没有走 __header/__body，必须自己留白 */
.ana__panel {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-6);
}

.ana__tablewrap {
  overflow-x: auto;
}

/* 标题行：标题 + 灰度说明，宽屏同行，窄屏换行，绝不再贴边 */
.mc-card__title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--mc-space-1) var(--mc-space-3);
  margin-bottom: var(--mc-space-3);
}

.mc-card__title-row .mc-card__title {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-snug);
}

/* 标题旁说明文字：次要色、小一号、可换行 */
.ana__titlehint {
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
}

@media (max-width: 720px) {
  .ana__panel {
    padding: var(--mc-space-4);
  }
}
</style>
