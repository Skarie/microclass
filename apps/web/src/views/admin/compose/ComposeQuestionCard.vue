<script setup lang="ts">
import Tag from '@/components/Tag.vue';
import RichText from '@/components/RichText.vue';
import type { ExamCompose, PaperQuestion } from '@/composables/use-exam-compose';
import type { ExamPaper } from '@/composables/use-exam-paper';

/**
 * 卷面上的一道题：题干 / 选项 / 可展开的答案解析，
 * 以及改分值、改所属大题、放大、换一题、上移下移、删除。
 */
defineProps<{ question: PaperQuestion; compose: ExamCompose; paper: ExamPaper }>();
const emit = defineEmits<{ view: [question: PaperQuestion]; replace: [id: number] }>();
</script>

<template>
  <article class="stp__q">
    <div class="stp__qtop">
      <span class="stp__qno">{{ paper.qIndex(question.id) }}</span>
      <div class="stp__qbody">
        <RichText class="stp__qstem" :text="question.stem" />
        <ul v-if="question.options.length > 0" class="stp__opts">
          <li v-for="(opt, oi) in question.options" :key="oi">
            <span class="stp__optlabel">{{ String.fromCharCode(65 + oi) }}.</span>
            <RichText inline :text="opt" />
          </li>
        </ul>
        <div v-if="paper.isOpen(question.id)" class="stp__answer">
          <p><strong>答案：</strong>{{ question.answer || '（未录入）' }}</p>
          <p v-if="question.analysis"><strong>解析：</strong><RichText inline :text="question.analysis" /></p>
        </div>
      </div>
    </div>
    <div class="stp__qbar">
      <Tag size="sm">{{ compose.typeLabel(question.type) }}</Tag>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="paper.toggle(question.id)">
        {{ paper.isOpen(question.id) ? '收起答案' : '看答案与解析' }}
      </button>
      <label class="stp__field">
        <span class="mc-label">分值</span>
        <input
          class="mc-input stp__num"
          type="number"
          min="0"
          step="0.5"
          :value="question.score"
          :aria-label="`第 ${paper.qIndex(question.id)} 题分值`"
          @change="paper.setScore(question, Number(($event.target as HTMLInputElement).value) || 0)"
        />
      </label>
      <label class="stp__field">
        <span class="mc-label">所属大题</span>
        <input
          class="mc-input stp__sectioninput"
          type="text"
          :value="question.section"
          placeholder="如 一、单选题"
          :aria-label="`第 ${paper.qIndex(question.id)} 题所属大题`"
          @change="paper.setSection(question, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <span class="mc-spacer" />
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="emit('view', question)">放大看</button>
      <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="emit('replace', question.id)">换一题</button>
      <button
        class="mc-btn mc-btn--ghost mc-btn--sm"
        type="button"
        :disabled="paper.qIndex(question.id) === 1"
        @click="paper.move(paper.qIndex(question.id) - 1, -1)"
      >
        上移
      </button>
      <button
        class="mc-btn mc-btn--ghost mc-btn--sm"
        type="button"
        :disabled="paper.qIndex(question.id) === compose.paper.length"
        @click="paper.move(paper.qIndex(question.id) - 1, 1)"
      >
        下移
      </button>
      <button class="mc-btn mc-btn--danger-ghost mc-btn--sm" type="button" @click="paper.removeQuestion(question)">
        删除
      </button>
    </div>
  </article>
</template>

<style scoped>
.stp__q {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.stp__qtop {
  display: flex;
  gap: var(--mc-space-2);
}

.stp__qno {
  min-width: 24px;
  height: 24px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mc-text-xs);
  flex: none;
}

.stp__qbody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__qstem {
  line-height: var(--mc-leading);
}

.stp__opts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__optlabel {
  margin-right: 4px;
  color: var(--mc-text-muted);
}

.stp__answer {
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-primary-border);
  background: var(--mc-primary-soft);
  border-radius: var(--mc-radius);
}

.stp__answer p {
  margin: 0 0 4px;
}

.stp__qbar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-left: 32px;
}

.stp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stp__num {
  width: 76px;
}

.stp__sectioninput {
  width: 132px;
}
</style>
