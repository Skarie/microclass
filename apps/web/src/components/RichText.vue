<script setup lang="ts">
/**
 * 富文本渲染：把题库里的纯文本渲染成「文字 + 图片 + 数学公式」。
 *
 * 为什么需要它：导入的题目里图会出现在题干、选项、解析三处（平均 1.8 张/题），
 * 数学题还大量使用 LaTeX。题面文本里用两种约定：
 *   - 图片：`![](/api/v1/question-media/<sha1>.png)`（内容寻址，长缓存）
 *   - 公式：`$...$` 行内、`$$...$$` 独立成行
 *
 * 安全：文本一律 HTML 转义，只有认定过的图片地址与 KaTeX 自己生成的 HTML 才注入；
 * 图片地址只允许本站 `/api/v1/question-media/` 或 http(s)，其余按纯文本显示（挡掉 javascript: 之类）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { isFigureImage, splitRichText } from '@/utils/richText';

const props = withDefaults(defineProps<{ text?: string | null; inline?: boolean }>(), {
  text: '',
  inline: false,
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMath(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: display, output: 'html' });
  } catch {
    return escapeHtml(latex);
  }
}

const root = ref<HTMLElement | null>(null);
const segments = computed(() => splitRichText(String(props.text ?? '')));

const html = computed(() =>
  segments.value
    .map((seg) => {
      if (seg.kind === 'text') return escapeHtml(seg.value);
      if (seg.kind === 'math') return renderMath(seg.value, seg.display === true);
      return `<img class="rich-img" src="${escapeHtml(seg.value)}" alt="${escapeHtml(seg.alt ?? '')}" loading="lazy" />`;
    })
    .join(''),
);

/**
 * 大图按「整幅图」居中展示、公式碎片按行内展示：
 * 加载后量一下真实像素——高度超过 200px 或宽度超过 480px 的当整幅图，
 * 其余（几分之几、单个数字、小符号）留在文字行里，不再强制换行。
 */
function classifyImages(): void {
  const el = root.value;
  if (!el) return;
  for (const img of el.querySelectorAll<HTMLImageElement>('img.rich-img')) {
    const apply = (): void => {
      img.classList.toggle('rich-img--figure', isFigureImage(img.naturalWidth, img.naturalHeight));
    };
    if (img.complete && img.naturalHeight > 0) apply();
    else img.addEventListener('load', apply, { once: true });
  }
}

onMounted(() => void nextTick(classifyImages));
watch(html, () => void nextTick(classifyImages));
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- 文本已逐段转义，只注入图片标签与 KaTeX 生成的 HTML -->
  <span v-if="props.inline" ref="root" class="rich rich--inline" v-html="html" />
  <div v-else ref="root" class="rich" v-html="html" />
</template>

<style scoped>
.rich {
  white-space: pre-wrap;
  word-break: break-word;
}

.rich--inline {
  display: inline;
  white-space: normal;
}

/**
 * 题图默认按**行内元素**渲染：题库里有大量「一个公式 / 一个分数」的小图，
 * 之前 `display:block` 会把句子强行断开。整幅图（大图）由脚本加上
 * `.rich-img--figure` 变成居中的块级图。
 */
.rich :deep(.rich-img) {
  display: inline-block;
  max-width: 100%;
  max-height: 320px;
  margin: 0 3px;
  vertical-align: middle;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
}

.rich :deep(.rich-img--figure) {
  display: block;
  margin: var(--mc-space-2) auto;
}

.rich--inline :deep(.rich-img) {
  max-height: 56px;
  margin: 0 4px;
}

/**
 * 行内模式下的「整幅图」不能按 56px 压：真机上有 19,507 道题的**解析本身就是一张
 * 843×248 的文字截图**，压到 56px 高只有 ~190px 宽，等于看不清（用户反馈
 * 「解析全是图片」多半就是这么看到的）。整幅图给足高度，小公式碎片继续按 56px 行内显示。
 */
.rich--inline :deep(.rich-img--figure) {
  display: inline-block;
  max-height: 320px;
  margin: 4px 0;
  vertical-align: top;
}

.rich :deep(.katex) {
  font-size: 1.02em;
}

.rich :deep(.katex-display) {
  margin: var(--mc-space-2) 0;
  overflow-x: auto;
  overflow-y: hidden;
}
</style>
