<script setup lang="ts">
import { reactive } from 'vue';
import RichText from '@/components/RichText.vue';
import { difficultyLabel } from '@/composables/difficulty';
import { TYPE_LABEL } from './questionTypes';
import type { useQuestionList } from '@/composables/use-question-list';

/**
 * 右栏题目表格（从 BankAdminView 抽出）：
 * 全选/单选、序号、题干（限行 + 展开）、难度等元信息、题型、答案、行内编辑/删除。
 * 键盘流（↑↓ / Enter / Esc）由组合式函数统一处理，这里只把事件接上。
 */
const props = defineProps<{
  questions: ReturnType<typeof useQuestionList>;
}>();

const questionApi = props.questions;
const questionsState = reactive(questionApi);
</script>

<template>
  <!-- 键盘流：↑↓ 移动当前题、Enter 编辑、/ 聚焦搜索、Esc 取消 -->
  <div
    class="mc-table-wrap table-wrap question-table"
    :class="{ 'table-wrap--compact': questionsState.density === 'compact' }"
    tabindex="0"
    role="region"
    aria-label="题目表（上下键移动当前题，回车编辑，斜杠聚焦搜索）"
    @keydown="questionsState.onTableKeydown"
    @click="questionsState.tableWrap?.focus()"
  >
    <table class="mc-table mc-table--compact">
      <thead>
        <tr>
          <th class="col-check">
            <label class="check-hit">
              <input
                type="checkbox"
                aria-label="选中本页全部题目"
                :checked="questionsState.allOnPageSelected"
                @change="questionsState.toggleSelectAllOnPage"
              />
            </label>
          </th>
          <th class="col-no">序号</th>
          <th>题干</th>
          <th class="col-type">题型</th>
          <th class="col-answer">答案</th>
          <th class="col-ops">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(question, index) in questionsState.questions"
          :key="question.id"
          :class="{
            'row--selected': questionsState.selectedIds.has(question.id),
            'row--active': questionsState.activeRow === index,
          }"
        >
          <td class="col-check">
            <label class="check-hit">
              <input
                type="checkbox"
                :aria-label="`选中第 ${(questionsState.page - 1) * questionsState.pageSize + index + 1} 题`"
                :checked="questionsState.selectedIds.has(question.id)"
                @change="questionsState.toggleSelect(question.id)"
              />
            </label>
          </td>
          <td class="mc-mono col-no">{{ (questionsState.page - 1) * questionsState.pageSize + index + 1 }}</td>
          <td>
            <div class="stem" :class="{ 'stem--clamped': !questionsState.isStemExpanded(question.id) }">
              <RichText class="stem__text" :text="question.stem" />
            </div>
            <button
              v-if="question.stem.length > 90"
              class="stem__toggle"
              type="button"
              @click="questionsState.toggleStem(question.id)"
            >
              {{ questionsState.isStemExpanded(question.id) ? '收起' : '展开完整题干' }}
            </button>
            <!-- 次要信息（难度 / 知识点 / 册次）收进题干下方一行小字，可按偏好隐藏 -->
            <div v-if="questionsState.showMeta" class="stem__meta mc-row mc-row--wrap">
              <span
                class="diff-text"
                :class="`diff-text--${question.difficulty ?? 'none'}`"
                :title="questionsState.difficultyTitle(question)"
              >
                难度 {{ difficultyLabel(question.difficulty) }}
                <!-- 未评估时后端返回 -1，只在真正算过（>0）时显示分数 -->
                <template v-if="(question.difficulty_score ?? -1) > 0">
                  · {{ Math.round(question.difficulty_score ?? 0) }}
                </template>
              </span>
              <span v-if="question.point" class="mc-muted stem__meta-item">· {{ question.point }}</span>
              <span v-if="question.book" class="mc-muted stem__meta-item">· {{ question.book }}</span>
              <span v-if="question.options.length > 0" class="mc-muted stem__meta-item">
                · {{ question.options.length }} 个选项
              </span>
            </div>
          </td>
          <td class="col-type">
            <span class="mc-badge" :class="question.type === 'multiple' ? 'mc-badge--primary' : ''">
              {{ TYPE_LABEL[question.type] }}
            </span>
          </td>
          <td class="mc-mono col-answer">
            <span class="answer-clamp" :title="questionsState.answerText(question)">{{
              questionsState.answerText(question)
            }}</span>
          </td>
          <td class="col-ops">
            <div class="row-actions">
              <button class="mc-btn mc-btn--sm" type="button" @click="questionsState.openEditQuestion(question)">
                编辑
              </button>
              <button
                class="mc-btn mc-btn--sm mc-btn--danger"
                type="button"
                @click="questionsState.removeQuestion(question)"
              >
                删除
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./question-table.css"></style>
