<script setup lang="ts">
/**
 * 答案展示组件：把「原样答案」渲染成可读的样子。
 *
 *   `\frac{3}{9}|\frac{1}{3}；4`  →  空1 ⅓ 或 1/3   空2 4（公式用 KaTeX 渲染）
 *
 * 只影响显示：判分、写库、`choice` 之类的取值一律用原始 `answer` 字符串。
 */
import { computed } from 'vue';
import RichText from './RichText.vue';
import { isMultiPart, splitAnswer } from '@/utils/answer';

const props = withDefaults(defineProps<{ answer?: string | null; type?: string }>(), {
  answer: '',
  type: '',
});

const blanks = computed(() => splitAnswer(props.answer ?? '', props.type));
const multi = computed(() => isMultiPart(blanks.value));
</script>

<template>
  <span class="ans" :title="props.answer ?? ''">
    <template v-for="blank in blanks" :key="blank.index">
      <span v-if="multi" class="ans__blank">{{ blank.index + 1 }}</span>
      <template v-for="opt in blank.options" :key="opt.index">
        <span v-if="opt.index > 0" class="ans__or">或</span>
        <RichText inline :text="opt.rich" />
      </template>
    </template>
  </span>
</template>

<style scoped>
.ans {
  display: inline;
}

/* 多空答案前面标个序号，读起来才有「第几个空」的概念 */
.ans__blank {
  display: inline-block;
  min-width: 1.1em;
  margin-right: 2px;
  padding: 0 3px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-soft);
  font-size: 0.82em;
  text-align: center;
  color: var(--mc-text-muted);
}

.ans__or {
  margin: 0 3px;
  color: var(--mc-text-muted);
  font-size: 0.88em;
}
</style>
