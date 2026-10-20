<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
// 表单对象由父组件持有，子组件就地编辑嵌套字段（v-model），不改引用
/**
 * 题目编辑器（从 BankAdminView 抽出）。
 * 表单状态仍由父组件持有（保存/校验要用），这里只负责渲染与局部交互。
 */
import AppModal from '@/components/AppModal.vue';
import DifficultyBadge from '@/components/DifficultyBadge.vue';
import { TYPE_LABEL, TYPE_OPTIONS } from './questionTypes';
import { computed } from 'vue';
import type { QuestionType, QuestionView } from '@/api/types';

interface OptionDraft {
  text: string;
}

const props = defineProps<{
  open: boolean;
  editingId: number | null;
  saving: boolean;
  imagePath: string;
  currentQuestion: QuestionView | null | undefined;
  form: {
    type: QuestionType;
    stem: string;
    options: OptionDraft[];
    singleAnswer: number;
    multipleAnswer: number[];
    judgeAnswer: string;
    textAnswer: string;
    analysis: string;
    sort: number;
    difficulty: string;
  };
}>();

const emit = defineEmits<{ close: []; save: []; 'pick-image': [] }>();

/** 选择题（单选/多选）才显示选项编辑区 */
const isChoice = computed(() => props.form.type === 'single' || props.form.type === 'multiple');

function letter(index: number): string {
  return String.fromCharCode(65 + index);
}

function addOption(): void {
  props.form.options.push({ text: '' });
}

function removeOption(index: number): void {
  if (props.form.options.length <= 2) return;
  props.form.options.splice(index, 1);
  if (props.form.singleAnswer >= props.form.options.length) props.form.singleAnswer = 0;
  props.form.multipleAnswer = props.form.multipleAnswer.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
}
</script>

<template>
  <AppModal :open="open" :title="editingId === null ? '新建题目' : '编辑题目'" width="720px" @close="emit('close')">
    <div class="mc-col">
      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label mc-label--required">题型</span>
          <select v-model="form.type" class="mc-select">
            <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
          </select>
        </label>

        <label class="mc-field">
          <span class="mc-label">排序</span>
          <input v-model.number="form.sort" class="mc-input" type="number" min="0" />
        </label>
      </div>

      <label class="mc-field">
        <span class="mc-label mc-label--required">题干</span>
        <textarea v-model="form.stem" class="mc-textarea" maxlength="4000" placeholder="请输入题目内容" />
      </label>

      <div class="mc-col image-block">
        <div class="mc-row mc-row--between mc-row--wrap">
          <span class="mc-label">题目配图</span>
          <button class="mc-btn mc-btn--sm" type="button" @click="emit('pick-image')">
            {{ imagePath ? '更换配图' : '上传配图' }}
          </button>
        </div>
        <img
          v-if="imagePath && editingId !== null"
          class="image-block__preview"
          :src="`/api/v1/question-images/${editingId}`"
          alt="题目配图预览"
        />
        <span v-else class="mc-hint">
          {{ editingId === null ? '题目保存后即可上传配图。' : '当前没有配图，支持 jpg / png / gif / webp。' }}
        </span>
      </div>

      <template v-if="isChoice">
        <div class="mc-col">
          <div class="mc-row mc-row--between">
            <span class="mc-label mc-label--required">
              {{ form.type === 'single' ? '选项（单选：勾选唯一正确答案）' : '选项（多选：勾选全部正确答案）' }}
            </span>
            <button class="mc-btn mc-btn--sm" type="button" @click="addOption">添加选项</button>
          </div>

          <div v-for="(option, oi) in form.options" :key="oi" class="option-row">
            <label v-if="form.type === 'single'" class="option-row__pick">
              <input v-model="form.singleAnswer" type="radio" name="q-answer" :value="oi" />
              <span class="option-row__letter">{{ letter(oi) }}</span>
            </label>
            <label v-else class="option-row__pick">
              <input v-model="form.multipleAnswer" type="checkbox" :value="oi" />
              <span class="option-row__letter">{{ letter(oi) }}</span>
            </label>

            <input
              v-model="option.text"
              class="mc-input"
              type="text"
              maxlength="1000"
              :placeholder="`选项 ${letter(oi)} 内容`"
            />

            <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="removeOption(oi)">删除</button>
          </div>
        </div>
      </template>

      <template v-else-if="form.type === 'judge'">
        <div class="mc-field">
          <span class="mc-label mc-label--required">正确答案</span>
          <div class="mc-row judge-row">
            <label class="mc-checkbox">
              <input v-model="form.judgeAnswer" type="radio" name="q-judge" value="T" />
              对
            </label>
            <label class="mc-checkbox">
              <input v-model="form.judgeAnswer" type="radio" name="q-judge" value="F" />
              错
            </label>
          </div>
        </div>
      </template>

      <label v-else-if="form.type === 'fill'" class="mc-field">
        <span class="mc-label mc-label--required">填空答案</span>
        <input
          v-model="form.textAnswer"
          class="mc-input"
          type="text"
          maxlength="2000"
          placeholder="多个可接受答案用 | 分隔，例如：final|final 关键字"
        />
        <span class="mc-hint">学生填写其中任意一个即判为正确。</span>
      </label>

      <label v-else class="mc-field">
        <span class="mc-label mc-label--required">参考答案</span>
        <textarea
          v-model="form.textAnswer"
          class="mc-textarea"
          maxlength="2000"
          placeholder="简答题不自动判分，此处填写参考要点供学生自评"
        />
      </label>

      <label class="mc-field">
        <span class="mc-label">解析</span>
        <textarea
          v-model="form.analysis"
          class="mc-textarea"
          maxlength="4000"
          placeholder="讲解为什么选这个答案（可选）"
        />
      </label>

      <label class="mc-field">
        <span class="mc-label">难度</span>
        <select v-model="form.difficulty" class="mc-select">
          <option value="">自动判定（推荐）</option>
          <option value="easy">基础</option>
          <option value="medium">中等</option>
          <option value="hard">较难</option>
        </select>
        <span class="mc-hint">
          「自动判定」由难度模型按内容特征打分（学段年级、题型、算式与公式复杂度、小问数、阅读量、看图、高阶目标），
          并按分位数分成三档/五级；手动选择会记为<strong>人工标注</strong>，之后的自动重算不会覆盖。
        </span>
      </label>

      <p v-if="editingId !== null" class="mc-muted">
        当前难度：
        <DifficultyBadge
          :score="currentQuestion?.difficulty_score"
          :difficulty="currentQuestion?.difficulty"
          :source="currentQuestion?.difficulty_source"
          :samples="currentQuestion?.difficulty_n"
        />
      </p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="emit('save')">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: var(--mc-space-4);
}

.option-row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.option-row__pick {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  cursor: pointer;
  flex: none;
}

.option-row__letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
}

.judge-row {
  gap: var(--mc-space-5);
}

.image-block {
  padding: var(--mc-space-3);
  border: 1px dashed var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.image-block__preview {
  max-width: 100%;
  max-height: 200px;
  align-self: flex-start;
  border-radius: var(--mc-radius);
  border: 1px solid var(--mc-border);
}
</style>
