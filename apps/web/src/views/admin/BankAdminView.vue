<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import QuestionEditor from './QuestionEditor.vue';
import BankHealthPanel from './BankHealthPanel.vue';
import BankOverviewHeader from './BankOverviewHeader.vue';
import BankFormDialog from './BankFormDialog.vue';
import BankQuickDialogs from './BankQuickDialogs.vue';
import BankDifficultyCalcDialog from './BankDifficultyCalcDialog.vue';
import BankImportResult from './BankImportResult.vue';
import { TYPE_LABEL, TYPE_OPTIONS } from './questionTypes';
import { difficultyLabel } from '@/composables/difficulty';
import { KIND_LABEL, useBankCatalog, type BankCatalogDeps } from '@/composables/use-bank-catalog';
import { useQuestionList } from '@/composables/use-question-list';
import { useBankImport } from '@/composables/use-bank-import';
import { useBankActions } from '@/composables/use-bank-actions';

/**
 * 本组件只做组合式函数的编排：目录 → 题目列表 → 导入导出 → 题库操作。
 * 业务状态各自落在对应的组合式函数里，跨函数只通过参数/返回值传递（没有全局单例）。
 * 弹窗、编辑器与页面头部都是独立组件，这里仅把状态与操作接上。
 */
const catalogDeps: BankCatalogDeps = {
  // 先占位：题目列表创建后立刻回填（loadBanks 只在挂载与用户交互之后才调用）
  loadQuestions: async () => {},
  clearQuestions: () => {},
};
const catalogApi = useBankCatalog(catalogDeps);
/** 两个隐藏的文件输入框：模板 ref 必须由本组件持有，再把 ref 注入相关组合式函数 */
const fileInput = ref<HTMLInputElement | null>(null);
const qImageInput = ref<HTMLInputElement | null>(null);
const questionApi = useQuestionList({
  selectedBankId: catalogApi.selectedBankId,
  selectedBank: catalogApi.selectedBank,
  loadBanks: catalogApi.loadBanks,
  qImageInput,
});
catalogDeps.loadQuestions = questionApi.loadQuestions;
catalogDeps.clearQuestions = questionApi.clearQuestions;

const importApi = useBankImport({
  selectedBankId: catalogApi.selectedBankId,
  selectedBank: catalogApi.selectedBank,
  loadQuestions: questionApi.loadQuestions,
  loadBanks: catalogApi.loadBanks,
  page: questionApi.page,
  fileInput,
});
const actionsApi = useBankActions({
  selectedBankId: catalogApi.selectedBankId,
  selectedBank: catalogApi.selectedBank,
  loadBanks: catalogApi.loadBanks,
  loadQuestions: questionApi.loadQuestions,
  loadCatalog: catalogApi.loadCatalog,
  downloadTemplate: importApi.downloadTemplate,
  exportBank: importApi.exportBank,
});

/* 模板绑定：只解构模板真正用到的状态与操作 */
const {
  catalog,
  catalogCourseId,
  onlyUnbound,
  bankKeyword,
  bankSort,
  showAllBanks,
  visibleBanks,
  sortedBanks,
  visibleCourses,
  searchActive,
  browseLevel,
  activeCourseName,
  courseLessonOptions,
  banks,
  banksLoading,
  selectedBankId,
  selectedBank,
  kindFilter,
  rebinding,
  loadBanks,
  pickCourse,
  pickUnbound,
  bindBankCourse,
  rebind,
} = catalogApi;

const {
  questions,
  questionsLoading,
  typeFilter,
  difficultyFilter,
  keyword,
  mediaOnlyFilter,
  showMoreFilters,
  page,
  total,
  pageSize,
  totalPages,
  selectedIds,
  selectedCount,
  allOnPageSelected,
  toggleSelect,
  toggleSelectAllOnPage,
  clearSelection,
  bulkDifficultyItems,
  bulkBusy,
  bulkSetDifficulty,
  bulkDelete,
  isStemExpanded,
  toggleStem,
  tableWrap,
  activeRow,
  keywordInput,
  onTableKeydown,
  difficultyTitle,
  DIFFICULTY_OPTIONS,
  answerText,
  density,
  showMeta,
  viewMenuItems,
  onViewMenu,
  loadPrefs,
  selectBank,
  search,
  resetFilters,
  showMediaOnlyQuestions,
  setTypeFilter,
  setDifficultyFilter,
  goPage,
  goPageTo,
  changePageSize,
  qOpen,
  qSaving,
  qEditingId,
  qImagePath,
  qForm,
  openCreateQuestion,
  openEditQuestion,
  saveQuestion,
  removeQuestion,
  pickQuestionImage,
  onQuestionImagePicked,
} = questionApi;

const { importing, importResult, pickImportFile, onImportFilePicked } = importApi;

const {
  bankFormOpen,
  bankSaving,
  bankEditingId,
  bankForm,
  openCreateBank,
  saveBank,
  dedupeBusy,
  dedupeResult,
  applyDedupe,
  diffOpen,
  diffBusy,
  diffPreview,
  diffScopeAll,
  openDifficulty,
  loadDifficultyPreview,
  applyDifficulty,
  calibrateDifficulty,
  examOpen,
  examSaving,
  examForm,
  courses,
  loadCourses,
  createExamFromBank,
  healthOpen,
  healthLoading,
  health,
  loadHealth,
  toggleHealth,
  bindBookTarget,
  bindCourseId,
  bindingBook,
  openBindBook,
  closeBindBook,
  confirmBindBook,
  bankMenuItems,
  bankRowMenuItems,
  onBankRowMenu,
  onBankMenuSelect,
} = actionsApi;

/** 文档级快捷键：/ 聚焦题干搜索（在输入框里打字时不拦截） */
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== '/') return;
  const target = event.target as HTMLElement | null;
  const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  if (typing) return;
  event.preventDefault();
  keywordInput.value?.focus();
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown);
});

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown);
  loadPrefs();
  void loadCourses();
  void catalogApi.loadCatalog();
  void loadBanks(false);
  // 指标卡片要用体检数据（服务端已预热 + 5 分钟缓存，约 20ms；失败不影响页面）
  void loadHealth(true);
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="题库管理"
      description="按课程/章节维护题库，导入 CSV 或 Markdown 题目，导出 Word/CSV，处理重复题与难度标注。"
      icon="bank"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '题库管理' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="healthLoading" @click="toggleHealth">
          <Icon name="shield" :size="15" />
          {{ healthOpen ? '收起体检' : '题库体检' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="banksLoading" @click="loadBanks()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openCreateBank">
          <Icon name="plus" :size="15" />
          新建题库
        </button>
      </template>
    </PageHeader>

    <!-- 指标卡片行：先给全局规模感，再进入具体操作（对标学之思/超星的工作台形态） -->
    <!-- KPI 卡片行 + 按册次挂课程弹窗 -->
    <BankOverviewHeader
      :binding="catalog.binding"
      :question-total="health ? health.stats.total : null"
      :empty-answer="health ? health.stats.emptyAnswer : null"
      :bind-book-target="bindBookTarget"
      :bind-course-id="bindCourseId"
      :courses="courses"
      :binding-book="bindingBook"
      @pick-unbound="pickUnbound('')"
      @close-bind="closeBindBook"
      @confirm-bind="confirmBindBook"
      @update:bind-course-id="bindCourseId = $event"
    />
    <!-- 题库体检：弹窗展示，避免在页面中间插入整块导致布局跳动 -->
    <BankHealthPanel
      v-if="health"
      :open="healthOpen"
      :health="health"
      :loading="healthLoading"
      :diff-busy="diffBusy"
      @close="healthOpen = false"
      @refresh="loadHealth()"
      @show-media-only="showMediaOnlyQuestions"
      @recalc="openDifficulty"
      @calibrate="calibrateDifficulty"
    />

    <div class="layout">
      <aside class="mc-card bank-panel">
        <div class="mc-card__header">
          <span class="mc-card__title">题库导航</span>
          <span class="mc-muted">
            {{ browseLevel === 'courses' ? catalog.courses.length + ' 门课程' : banks.length + ' 个题库' }}
          </span>
        </div>

        <!-- 搜索与类型筛选：属于「题库列表」，从课程树里提出来放到显眼位置 -->
        <div class="tree__toolbar">
          <input
            v-model.trim="bankKeyword"
            class="mc-input tree__search"
            type="search"
            placeholder="搜题库名（回车或输入即筛）"
            aria-label="搜索题库名"
            @keyup.enter="loadBanks(false)"
          />
          <select
            v-model="kindFilter"
            class="mc-select tree__kind"
            aria-label="按题库类型筛选"
            @change="loadBanks(false)"
          >
            <option value="">全部类型</option>
            <option value="lesson">课时配套</option>
            <option value="chapter">章节题库</option>
            <option value="paper">整卷试卷</option>
          </select>
        </div>

        <!-- 一级：课程列表（"未归属课程"置顶）；搜索时自动跳到搜索结果 -->
        <ul v-if="browseLevel === 'courses'" class="nav-list">
          <li class="nav-item" @click="pickUnbound('')">
            <span class="mc-truncate">未归属课程</span>
            <span class="mc-muted nav-item__meta">
              {{ catalog.unbound.bankCount }} 库 / {{ catalog.unbound.questionCount }} 题
            </span>
          </li>
          <li v-for="course in visibleCourses" :key="course.id" class="nav-item" @click="pickCourse(course.id)">
            <span class="mc-truncate">{{ course.name }}</span>
            <span class="mc-muted nav-item__meta">{{ course.bankCount }} 库 / {{ course.questionCount }} 题</span>
          </li>
        </ul>

        <!-- 二级：未归属课程 → 按册次分组 -->
        <template v-else-if="browseLevel === 'books'">
          <div class="nav-crumb">
            <button class="nav-crumb__back" type="button" @click="pickCourse(null)">← 全部课程</button>
            <span class="mc-muted mc-truncate">/ 未归属课程</span>
          </div>
          <ul class="nav-list">
            <li v-for="item in catalog.unboundBooks" :key="item.book" class="nav-item" @click="pickUnbound(item.book)">
              <span class="mc-truncate">{{ item.book }}</span>
              <span class="mc-muted nav-item__meta">{{ item.bankCount }} 库 / {{ item.questionCount }} 题</span>
              <!-- 1700+ 个未归属题库一个个挂太费事：按册次一次挂完 -->
              <button
                v-if="courses.length > 0"
                class="mc-btn mc-btn--ghost mc-btn--sm nav-item__bind"
                type="button"
                @click.stop="openBindBook(item)"
              >
                挂到课程
              </button>
            </li>
          </ul>
          <button
            class="mc-btn mc-btn--ghost mc-btn--sm tree__rebind"
            type="button"
            :disabled="rebinding"
            @click="rebind"
          >
            {{ rebinding ? '匹配中…' : '自动匹配课程归属' }}
          </button>
        </template>

        <!-- 三级：题库列表（搜索结果 / 某课程 / 某册次），带面包屑可返回 -->
        <div v-else class="bank-panel__list">
          <div class="nav-crumb">
            <button class="nav-crumb__back" type="button" @click="pickCourse(null)">← 全部课程</button>
            <span class="mc-muted mc-truncate">/ {{ searchActive ? bankKeyword : activeCourseName }}</span>
          </div>
          <div class="bank-panel__listhead mc-row">
            <span class="mc-muted">题库</span>
            <div class="mc-spacer" />
            <select v-model="bankSort" class="mc-select bank-panel__sort" aria-label="题库排序">
              <option value="default">最新创建</option>
              <option value="questions">题量最多</option>
              <option value="name">按名称</option>
            </select>
          </div>

          <div v-if="banksLoading && banks.length === 0" class="bank-panel__loading">
            <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
          </div>

          <EmptyState
            v-else-if="banks.length === 0"
            icon="bank"
            title="这个范围里还没有题库"
            description="换个课程/章节看看，或直接新建题库。"
            action-text="新建题库"
            @action="openCreateBank"
          />

          <ul v-else class="bank-list">
            <li
              v-for="bank in visibleBanks"
              :key="bank.id"
              class="bank-item"
              :class="{ 'bank-item--active': bank.id === selectedBankId }"
              @click="selectBank(bank)"
            >
              <div class="bank-item__main">
                <span class="bank-item__name" :title="bank.name">{{ bank.name }}</span>
                <span class="mc-muted bank-item__meta">
                  {{ KIND_LABEL[bank.kind ?? ''] ?? '' }} · {{ bank.question_count }} 题
                </span>
              </div>
              <!-- 行内只留一个「⋯」：原来常显 3 个按钮（重命名/删除等），又挤又容易误点删除 -->
              <div class="bank-item__actions">
                <select
                  v-if="onlyUnbound"
                  class="mc-select bank-item__bind"
                  aria-label="挂到课程"
                  @click.stop
                  @change="bindBankCourse(bank, Number(($event.target as HTMLSelectElement).value) || null)"
                >
                  <option value="">挂到课程…</option>
                  <option v-for="course in catalog.courses" :key="course.id" :value="course.id">
                    {{ course.name }}
                  </option>
                </select>
                <DropdownMenu
                  :items="bankRowMenuItems()"
                  label=""
                  icon="more"
                  :show-caret="false"
                  aria-label="题库操作（重命名 / 删除）"
                  variant="ghost"
                  @select="(key) => onBankRowMenu(bank, key)"
                />
              </div>
            </li>
          </ul>

          <button
            v-if="!showAllBanks && banks.length > visibleBanks.length"
            class="mc-btn mc-btn--ghost mc-btn--sm bank-panel__more"
            type="button"
            @click="showAllBanks = true"
          >
            显示全部 {{ sortedBanks.length }} 个（当前只显示前 {{ visibleBanks.length }} 个）
          </button>
        </div>
      </aside>

      <section class="mc-card question-panel">
        <!-- 题库头部：标题单行截断 + 右侧操作区固定（标题很长时不会把按钮挤到下一行） -->
        <div class="mc-card__header bank-head">
          <div class="bank-head__title">
            <span class="bank-head__name mc-truncate">{{ selectedBank ? selectedBank.name : '请选择题库' }}</span>
            <span v-if="selectedBank" class="bank-head__count mc-muted">共 {{ total }} 题</span>
          </div>
          <div class="bank-head__actions">
            <DropdownMenu
              :items="bankMenuItems"
              label="导出 / 更多"
              :icon="null"
              variant="ghost"
              @select="onBankMenuSelect"
            />
            <button
              class="mc-btn mc-btn--soft mc-btn--sm"
              type="button"
              :disabled="importing || !selectedBank"
              @click="pickImportFile"
            >
              <Icon name="upload" :size="15" />
              {{ importing ? '导入中…' : '导入题目' }}
            </button>
            <button
              class="mc-btn mc-btn--primary mc-btn--sm"
              type="button"
              :disabled="!selectedBank"
              @click="openCreateQuestion"
            >
              <Icon name="plus" :size="15" />
              新建题目
            </button>
          </div>
        </div>

        <div class="mc-card__body mc-col">
          <div class="mc-row mc-row--wrap filters">
            <div class="chips" role="group" aria-label="按题型筛选">
              <button
                class="chip"
                :class="{ 'chip--active': typeFilter === '' }"
                type="button"
                @click="setTypeFilter('')"
              >
                全部题型
              </button>
              <button
                v-for="t in TYPE_OPTIONS"
                :key="t"
                class="chip"
                :class="{ 'chip--active': typeFilter === t }"
                type="button"
                @click="setTypeFilter(t)"
              >
                {{ TYPE_LABEL[t] }}
              </button>
            </div>
            <div class="chips" role="group" aria-label="按难度筛选">
              <button
                class="chip"
                :class="{ 'chip--active': difficultyFilter === '' }"
                type="button"
                @click="setDifficultyFilter('')"
              >
                全部难度
              </button>
              <button
                v-for="d in DIFFICULTY_OPTIONS"
                :key="d.value"
                class="chip"
                :class="{ 'chip--active': difficultyFilter === d.value }"
                type="button"
                @click="setDifficultyFilter(d.value)"
              >
                {{ d.label }}
              </button>
            </div>
            <!-- 输入即搜（400ms 防抖），不再需要点"搜索" -->
            <input
              ref="keywordInput"
              v-model.trim="keyword"
              class="mc-input filters__keyword"
              type="search"
              placeholder="搜索题干关键词（输入即搜）"
              aria-label="搜索题干"
              @keyup.enter="search"
            />
            <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="resetFilters">重置</button>
            <DropdownMenu :items="viewMenuItems" label="显示" :icon="null" variant="ghost" @select="onViewMenu" />
            <label class="filters__more">
              <input v-model="showMoreFilters" type="checkbox" aria-label="展开更多筛选" />
              更多筛选
            </label>
            <label
              v-if="showMoreFilters"
              class="filters__check"
              title="解析本身是一张图（文字在图里）：搜不到、也改不了，先筛出来"
            >
              <input v-model="mediaOnlyFilter" type="checkbox" aria-label="只看解析只有图片" @change="search" />
              只看「解析只有图片」
            </label>
          </div>

          <!-- 选中后出现的批量操作条：不再需要一条条点 -->
          <div v-if="selectedCount > 0" class="bulk-bar">
            <span class="bulk-bar__count">已选 {{ selectedCount }} 题</span>
            <div class="mc-spacer" />
            <DropdownMenu
              :items="bulkDifficultyItems"
              label="批量改难度"
              :icon="null"
              variant="soft"
              :disabled="bulkBusy"
              @select="(key) => bulkSetDifficulty(key as 'easy' | 'medium' | 'hard')"
            />
            <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" :disabled="bulkBusy" @click="bulkDelete">
              批量删除
            </button>
            <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="clearSelection">取消选择</button>
          </div>

          <EmptyState
            v-if="!selectedBank"
            icon="arrow-left"
            title="请先在左侧选择题库"
            description="选中题库后即可查看、编辑其中的题目，并导入导出 CSV。"
          />

          <div v-else-if="questionsLoading && questions.length === 0" class="loading">
            <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
          </div>

          <EmptyState
            v-else-if="questions.length === 0"
            icon="info"
            title="没有匹配的题目"
            description="可以调整筛选条件，或新建一道题目；也可以用 CSV 批量导入。"
            action-text="新建题目"
            @action="openCreateQuestion"
          />

          <template v-else>
            <!-- 键盘流：↑↓ 移动当前题、Enter 编辑、/ 聚焦搜索、Esc 取消 -->
            <div
              class="mc-table-wrap table-wrap"
              :class="{ 'table-wrap--compact': density === 'compact' }"
              tabindex="0"
              role="region"
              aria-label="题目表（上下键移动当前题，回车编辑，斜杠聚焦搜索）"
              @keydown="onTableKeydown"
              @click="tableWrap?.focus()"
            >
              <table class="mc-table mc-table--compact">
                <thead>
                  <tr>
                    <th class="col-check">
                      <label class="check-hit">
                        <input
                          type="checkbox"
                          aria-label="选中本页全部题目"
                          :checked="allOnPageSelected"
                          @change="toggleSelectAllOnPage"
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
                    v-for="(question, index) in questions"
                    :key="question.id"
                    :class="{
                      'row--selected': selectedIds.has(question.id),
                      'row--active': activeRow === index,
                    }"
                  >
                    <td class="col-check">
                      <label class="check-hit">
                        <input
                          type="checkbox"
                          :aria-label="`选中第 ${(page - 1) * pageSize + index + 1} 题`"
                          :checked="selectedIds.has(question.id)"
                          @change="toggleSelect(question.id)"
                        />
                      </label>
                    </td>
                    <td class="mc-mono col-no">{{ (page - 1) * pageSize + index + 1 }}</td>
                    <td>
                      <div class="stem" :class="{ 'stem--clamped': !isStemExpanded(question.id) }">
                        <RichText class="stem__text" :text="question.stem" />
                      </div>
                      <button
                        v-if="question.stem.length > 90"
                        class="stem__toggle"
                        type="button"
                        @click="toggleStem(question.id)"
                      >
                        {{ isStemExpanded(question.id) ? '收起' : '展开完整题干' }}
                      </button>
                      <!-- 次要信息（难度 / 知识点 / 册次）收进题干下方一行小字，可按偏好隐藏 -->
                      <div v-if="showMeta" class="stem__meta mc-row mc-row--wrap">
                        <span
                          class="diff-text"
                          :class="`diff-text--${question.difficulty ?? 'none'}`"
                          :title="difficultyTitle(question)"
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
                      <span class="answer-clamp" :title="answerText(question)">{{ answerText(question) }}</span>
                    </td>
                    <td class="col-ops">
                      <div class="row-actions">
                        <button class="mc-btn mc-btn--sm" type="button" @click="openEditQuestion(question)">
                          编辑
                        </button>
                        <button
                          class="mc-btn mc-btn--sm mc-btn--danger"
                          type="button"
                          @click="removeQuestion(question)"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="pager">
              <span class="mc-muted">共 {{ total }} 题 · 第 {{ page }} / {{ totalPages }} 页</span>
              <label class="pager__size">
                <span class="mc-muted">每页</span>
                <select v-model.number="pageSize" class="mc-select" aria-label="每页条数" @change="changePageSize">
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                </select>
              </label>
              <div class="mc-spacer" />
              <button class="mc-btn mc-btn--sm" type="button" :disabled="page <= 1" @click="goPageTo(1)">首页</button>
              <button class="mc-btn mc-btn--sm" type="button" :disabled="page <= 1" @click="goPage(-1)">上一页</button>
              <button class="mc-btn mc-btn--sm" type="button" :disabled="page >= totalPages" @click="goPage(1)">
                下一页
              </button>
              <button
                class="mc-btn mc-btn--sm"
                type="button"
                :disabled="page >= totalPages"
                @click="goPageTo(totalPages)"
              >
                末页
              </button>
            </div>
          </template>
        </div>
      </section>
    </div>

    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      accept=".csv,.md,.markdown,.txt,.docx,text/csv,text/markdown"
      aria-hidden="true"
      tabindex="-1"
      @change="onImportFilePicked"
    />
    <input
      ref="qImageInput"
      class="hidden-input"
      type="file"
      accept="image/*"
      aria-hidden="true"
      tabindex="-1"
      @change="onQuestionImagePicked"
    />

    <!-- 重算难度（先预览再执行） -->
    <BankDifficultyCalcDialog
      :open="diffOpen"
      :busy="diffBusy"
      :scope-all="diffScopeAll"
      :bank-name="selectedBank?.name ?? ''"
      :preview="diffPreview"
      @close="diffOpen = false"
      @apply="applyDifficulty"
      @toggle-scope="
        diffScopeAll = !diffScopeAll;
        loadDifficultyPreview();
      "
    />

    <!-- 清理重复题 / 整卷建考试 两个弹窗 -->
    <BankQuickDialogs
      :dedupe-open="dedupeResult !== null"
      :dedupe="dedupeResult"
      :dedupe-busy="dedupeBusy"
      :exam-open="examOpen"
      :exam-saving="examSaving"
      :exam-form="examForm"
      :courses="courses"
      :bank-name="selectedBank?.name ?? ''"
      :bank-question-count="selectedBank?.question_count ?? 0"
      @close-dedupe="dedupeResult = null"
      @apply-dedupe="applyDedupe"
      @close-exam="examOpen = false"
      @create-exam="createExamFromBank"
    />

    <!-- 题库表单 -->
    <BankFormDialog
      :open="bankFormOpen"
      :editing-id="bankEditingId"
      :saving="bankSaving"
      :form="bankForm"
      :lesson-options="courseLessonOptions"
      :catalog-course-id="catalogCourseId"
      @close="bankFormOpen = false"
      @save="saveBank"
    />

    <!-- 题目编辑器 -->
    <QuestionEditor
      :open="qOpen"
      :editing-id="qEditingId"
      :saving="qSaving"
      :image-path="qImagePath"
      :current-question="questions.find((q) => q.id === qEditingId) ?? null"
      :form="qForm"
      @close="qOpen = false"
      @save="saveQuestion"
      @pick-image="pickQuestionImage"
    />

    <!-- 导入结果 -->
    <BankImportResult :open="importResult !== null" :result="importResult" @close="importResult = null" />
  </section>
</template>

<style scoped src="./bank-admin.css"></style>
