<script setup lang="ts">
import { computed, reactive } from 'vue';
import DropdownMenu, { type MenuItem } from '@/components/DropdownMenu.vue';
import RichText from '@/components/RichText.vue';
import { difficultyLabel } from '@/composables/difficulty';
import { questionGroupsOf } from '@/utils/question-sections';
import { TYPE_LABEL } from './questionTypes';
import type { Bank, QuestionView } from '@/api/types';
import type { useQuestionList } from '@/composables/use-question-list';
import type { usePracticeLinks } from '@/composables/use-practice-links';

/**
 * 右栏题目表格（从 BankAdminView 抽出）：
 * 按章节分组的题目行、全选/单选、序号、题干（限行 + 展开）、难度等元信息、题型、答案、
 * 行内编辑/删除/关联课时。键盘流（↑↓ / Enter / Esc）由组合式函数统一处理，这里只把事件接上。
 */
const props = defineProps<{
  questions: ReturnType<typeof useQuestionList>;
  bank: Bank | null;
  practice: ReturnType<typeof usePracticeLinks>;
  /** 题库归属课程：关联课时弹窗预选课程用 */
  courseId: number | null;
}>();

const questionApi = props.questions;
const questionsState = reactive(questionApi);
const practiceState = reactive(props.practice);

/** 按章节分组：同章节的题挨在一起，空章节固定最后（「未分章」） */
const groups = computed(() => questionGroupsOf(questionsState.questions));

/** 章节 / 小节在接口里是可空字段：模板里统一走这两个取值函数 */
function chapterOf(question: QuestionView): string {
  return question.chapter ?? '';
}
function sectionOf(question: QuestionView): string {
  return question.section ?? '';
}

/** 分组后行号仍按「当前页题目顺序」连续编号 */
function rowIndex(question: QuestionView): number {
  return questionsState.questions.indexOf(question);
}
function rowNumber(question: QuestionView): number {
  return (questionsState.page - 1) * questionsState.pageSize + rowIndex(question) + 1;
}

const rowMenuItems: MenuItem[] = [
  { key: 'edit', label: '编辑', icon: 'edit' },
  { key: 'practice', label: '关联课时', icon: 'courses' },
  { key: 'delete', label: '删除', icon: 'trash', danger: true },
];

function onRowMenu(question: QuestionView, key: string): void {
  if (key === 'edit') questionsState.openEditQuestion(question);
  else if (key === 'delete') void questionsState.removeQuestion(question);
  else if (key === 'practice' && props.bank) practiceState.openQuestionLink(props.bank, question, props.courseId);
}
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
        <template v-for="group in groups" :key="group.chapter">
          <!-- 章节分组行：章节名 + 题数 + 已关联徽标 + 「关联本章课时」 -->
          <tr class="qgroup">
            <td colspan="6">
              <div class="qgroup__inner">
                <span class="qgroup__name">{{ group.label }}</span>
                <span class="mc-muted qgroup__count">{{ group.questions.length }} 题</span>
                <span
                  v-if="bank && group.chapter.trim() !== '' && practiceState.chapterBadge(bank.id, group.chapter)"
                  class="mc-badge qgroup__badge"
                  :title="practiceState.chapterBadge(bank.id, group.chapter)?.title"
                >
                  {{ practiceState.chapterBadge(bank.id, group.chapter)?.text }}
                </span>
                <div class="mc-spacer" />
                <button
                  v-if="bank && group.chapter.trim() !== ''"
                  class="mc-btn mc-btn--sm mc-btn--ghost"
                  type="button"
                  @click="practiceState.openChapterLink(bank, group.chapter, courseId)"
                >
                  关联本章课时
                </button>
              </div>
            </td>
          </tr>

          <tr
            v-for="question in group.questions"
            :key="question.id"
            :class="{
              'row--selected': questionsState.selectedIds.has(question.id),
              'row--active': questionsState.activeRow === rowIndex(question),
            }"
          >
            <td class="col-check">
              <label class="check-hit">
                <input
                  type="checkbox"
                  :aria-label="`选中第 ${rowNumber(question)} 题`"
                  :checked="questionsState.selectedIds.has(question.id)"
                  @change="questionsState.toggleSelect(question.id)"
                />
              </label>
            </td>
            <td class="mc-mono col-no">{{ rowNumber(question) }}</td>
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
              <!-- 小节：跟随题目的小字标签；旁边就是「关联本节课时」（section 粒度） -->
              <div v-if="sectionOf(question)" class="stem__section">
                <span class="mc-muted stem__section-name">小节 {{ sectionOf(question) }}</span>
                <span
                  v-if="bank && practiceState.sectionBadge(bank.id, chapterOf(question), sectionOf(question))"
                  class="mc-badge"
                  :title="practiceState.sectionBadge(bank.id, chapterOf(question), sectionOf(question))?.title"
                >
                  {{ practiceState.sectionBadge(bank.id, chapterOf(question), sectionOf(question))?.text }}
                </span>
                <button
                  v-if="bank && chapterOf(question).trim() !== ''"
                  class="stem__section-link"
                  type="button"
                  @click.stop="practiceState.openSectionLink(bank, chapterOf(question), sectionOf(question), courseId)"
                >
                  关联本节课时
                </button>
              </div>
              <!-- 次要信息（难度 / 知识点 / 册次 / 单题关联标记）收进题干下方一行小字 -->
              <div
                v-if="
                  questionsState.showMeta ||
                  sectionOf(question) ||
                  (bank !== null && practiceState.questionBadge(bank.id, question.id))
                "
                class="stem__meta mc-row mc-row--wrap"
              >
                <template v-if="questionsState.showMeta">
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
                </template>
                <span
                  v-if="bank && practiceState.questionBadge(bank.id, question.id)"
                  class="mc-badge"
                  :title="practiceState.questionBadge(bank.id, question.id)?.title"
                >
                  {{ practiceState.questionBadge(bank.id, question.id)?.text }}
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
              <DropdownMenu
                :items="rowMenuItems"
                label=""
                icon="more"
                :show-caret="false"
                aria-label="题目操作（编辑 / 关联课时 / 删除）"
                variant="ghost"
                @select="(key) => onRowMenu(question, key)"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./question-table.css"></style>
