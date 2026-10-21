<script setup lang="ts">
/**
 * 组卷页 = 老师嘴里的四步（按需求原话设计）：
 *   ① 选范围：按章节 / 知识点圈定（支持跨章节、跨册、多个知识点；也能切全库）
 *   ② 选组卷方式：**随机组卷**（填题型数量 + 每题分值，在所选范围里抽）
 *                或 **自己挑题**（打开题库，左侧还是这个范围，自己勾选 / 全选筛选结果）
 *                已有卷子时还能一键生成**平行卷（A/B 卷）**
 *   ③ 看卷子：题干、选项都能看到，能展开看答案解析，能**换一题**、改分值、调顺序、删除
 *   ④ 打印预览：纸张 A3 / A4、横竖版、单双栏、含答案解析 / 答题卡 / 密封线，内嵌预览后打印或导出
 *
 * 页面只做编排：数据与请求在 composables/use-exam-*.ts，界面按步骤拆到 ./compose/*。
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import QuestionPickerPanel from '@/components/compose/QuestionPickerPanel.vue';
import ComposeHeader from './compose/ComposeHeader.vue';
import ComposeStepNav from './compose/ComposeStepNav.vue';
import ComposeRangeStep from './compose/ComposeRangeStep.vue';
import ComposeModesStep from './compose/ComposeModesStep.vue';
import ComposePaperStep from './compose/ComposePaperStep.vue';
import ComposePrintStep from './compose/ComposePrintStep.vue';
import ComposeParallelModal from './compose/ComposeParallelModal.vue';
import ComposeExamDialogs from './compose/ComposeExamDialogs.vue';
import { useExamCompose, type ComposeHooks } from '@/composables/use-exam-compose';
import { useExamRange } from '@/composables/use-exam-range';
import { useExamRandom } from '@/composables/use-exam-random';
import { useExamPaper } from '@/composables/use-exam-paper';
import { useExamStructure } from '@/composables/use-exam-structure';
import { useExamSettings } from '@/composables/use-exam-settings';
import { useExamParallel } from '@/composables/use-exam-parallel';
import { useExamPrint } from '@/composables/use-exam-print';

const router = useRouter();
const hooks: ComposeHooks = {};
const compose = useExamCompose(hooks);
const range = useExamRange({ getExamId: () => compose.examId });
const random = useExamRandom({ compose, range });
const paper = useExamPaper({ compose });
const structure = useExamStructure({ compose, random });
const settings = useExamSettings({ compose });
const parallel = useExamParallel({ compose });
const print = useExamPrint({ compose });

hooks.loadRange = range.loadFacets;
hooks.onExamSwitched = range.reset;
hooks.onExamLoaded = (exam) => {
  settings.hydrate(exam);
  structure.hydrateSections(exam);
};

const picking = ref(false);
const blueprintOpen = ref(false);
const replaceOpen = ref(false);
const replaceQuestionId = ref<number | null>(null);

/** 步骤条点击 = 退出挑题视图并落点（与拆分前一致） */
function go(step: number): void {
  picking.value = false;
  compose.step = step;
}

function reloadPaper(): void {
  void compose.loadPaper();
}

function openReplace(id: number): void {
  replaceQuestionId.value = id;
  replaceOpen.value = true;
}

function onBlueprintComposed(): void {
  void compose.loadPaper();
  void compose.loadExam();
  compose.step = 3;
}
</script>

<template>
  <section class="page mc-col">
    <ComposeHeader
      :title="compose.exam?.title ?? '加载中…'"
      :paper-count="compose.paper.length"
      @back="router.push('/admin/exams')"
      @blueprint="blueprintOpen = true"
      @print="compose.step = 4"
    />

    <ComposeStepNav
      :step="compose.step"
      :paper-count="compose.paper.length"
      :total-score="paper.totalScore"
      @update:step="go"
    />

    <div v-if="compose.loading" class="mc-skeleton stp__loading" />

    <!-- ②b 自己挑题（整页三区：筛选 / 列表 / 已选篮） -->
    <QuestionPickerPanel
      v-if="!compose.loading && picking"
      :exam-id="compose.examId"
      :in-paper="compose.paper.map((q) => q.id)"
      :paper="compose.paper"
      :initial-selected="range.selected"
      :default-scope="range.scope"
      @added="reloadPaper"
      @remove="paper.removeById"
      @clear="paper.clearPaper"
      @next="go(3)"
      @back="picking = false"
    />

    <ComposeRangeStep v-else-if="compose.step === 1" :range="range" @next="compose.step = 2" />

    <ComposeModesStep
      v-else-if="compose.step === 2"
      :range="range"
      :compose="compose"
      :random="random"
      :parallel="parallel"
      @pick="picking = true"
      @next="compose.step = 3"
      @back="compose.step = 1"
      @open-parallel="parallel.parallelOpen = true"
    />

    <ComposePaperStep
      v-else-if="compose.step === 3"
      :compose="compose"
      :paper="paper"
      :structure="structure"
      :settings="settings"
      @pick="picking = true"
      @next="compose.step = 4"
      @replace="openReplace"
    />

    <ComposePrintStep
      v-else
      :compose="compose"
      :print="print"
      :total-score="paper.totalScore"
      :estimated-minutes="paper.estimatedMinutes"
      @back="compose.step = 3"
    />

    <ComposeParallelModal :compose="compose" :parallel="parallel" />

    <ComposeExamDialogs
      :compose="compose"
      :blueprint-open="blueprintOpen"
      :replace-open="replaceOpen"
      :replace-question-id="replaceQuestionId"
      @close-blueprint="blueprintOpen = false"
      @composed="onBlueprintComposed"
      @close-replace="replaceOpen = false"
      @replaced="reloadPaper"
    />
  </section>
</template>

<style scoped>
.stp__loading {
  height: 260px;
  border-radius: var(--mc-radius);
}
</style>
