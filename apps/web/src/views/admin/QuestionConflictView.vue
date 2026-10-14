<script setup lang="ts">
/**
 * 同题不同答案核对页。
 *
 * 数据口径：题干 + 选项完全相同（同一内容指纹）但答案不一致的题组。
 * 这类题不能像重复题那样自动删——不知道该信哪个答案，必须人来定：
 *   1. 逐组核对：看组内每道题来自哪个题库/册次，选定一个答案，整组统一；
 *   2. 批量按多数答案：一组里出现次数最多的答案即选定值（票数并列的不猜，留人工）；
 *   3. 忽略：确认「答案不同是合理的」，不再出现在待核对列表（题目保持原样）。
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import AppModal from '@/components/AppModal.vue';
import AnswerText from '@/components/AnswerText.vue';
import EmptyState from '@/components/EmptyState.vue';
import RichText from '@/components/RichText.vue';

interface AnswerStat {
  answer: string;
  n: number;
  first_id: number;
}

interface ConflictGroup {
  contentHash: string;
  stem: string;
  status: 'pending' | 'resolved' | 'ignored';
  groupSize: number;
  answerCount: number;
  answers: AnswerStat[];
  chosenAnswer: string;
  reviewerName: string;
  updatedAt: number;
}

interface ConflictListResponse {
  counts: { pending: number; resolved: number; ignored: number; total: number };
  sync: { scanned: boolean; reason: string; stale: boolean; ageMs: number };
  page: number;
  pageSize: number;
  total: number;
  items: ConflictGroup[];
}

interface ConflictQuestion {
  id: number;
  answer: string;
  type: string;
  difficulty: string;
  stem: string;
  bank_id: number;
  bank_name: string;
  bank_kind: string;
  source_no: string;
  source_path: string;
}

interface ConflictDetailResponse {
  group: ConflictGroup;
  questions: ConflictQuestion[];
}

interface ResolveResponse {
  updated: number;
  answer: string;
}

interface MajorityResponse {
  groups: number;
  questions: number;
  skipped: number;
  dryRun: boolean;
  samples: { stem: string; answer: string; n: number }[];
}

interface SyncResponse {
  scannedGroups: number;
  reason: string;
  inserted: number;
  removed: number;
  pending: number;
  total: number;
  ms: { scan: number; cleanup: number; write: number; meta: number; total: number };
}

type StatusFilter = 'pending' | 'resolved' | 'ignored' | 'all';

const PAGE_SIZE = 20;
const KIND_LABEL: Record<string, string> = { lesson: '课时配套', chapter: '章节题库', paper: '整卷试卷' };
const DIFFICULTY_LABEL: Record<string, string> = { easy: '基础', medium: '中等', hard: '较难' };
const SYNC_REASON_LABEL: Record<string, string> = {
  never: '台账还没建立',
  empty: '台账为空',
  grew: '题库有新增题目',
  ttl: '超过 5 分钟没刷新',
  fresh: '台账是最新的',
  forced: '手动重新扫描',
};

/** 台账过期时给用户的提示（列表页不隐式扫库，避免整站被长扫描卡住） */
const staleHint = computed(() => {
  const sync = data.value?.sync;
  if (!sync?.stale) return '';
  if (sync.reason === 'never') return '台账还没建立，点「重新扫描全库」开始（首次扫描在冷缓存下可能要几分钟）。';
  if (sync.reason === 'empty') return '台账为空，点「重新扫描全库」重新建立。';
  if (sync.reason === 'grew') return '题库有新增题目，点「重新扫描全库」看看有没有新的冲突组。';
  return '台账已超过 5 分钟，点「重新扫描全库」刷新。';
});

/** 台账年龄（分钟），让用户判断数据新不新 */
function ageLabel(ms: number): string {
  if (!Number.isFinite(ms)) return '未知';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

const toast = useToastStore();

const statusFilter = ref<StatusFilter>('pending');
const keyword = ref('');
const loading = ref(false);
const scanning = ref(false);
const data = ref<ConflictListResponse | null>(null);
const page = ref(1);

/** 按题干关键字在前端过滤当前页（后端分页基于台账，逐页看更省事） */
const visibleGroups = computed(() => {
  const groups = data.value?.items ?? [];
  const k = keyword.value.trim().toLowerCase();
  if (!k) return groups;
  return groups.filter((g) => `${g.stem} ${g.answers.map((a) => a.answer).join(' ')}`.toLowerCase().includes(k));
});

const totalPages = computed(() => {
  const t = data.value?.total ?? 0;
  return Math.max(1, Math.ceil(t / PAGE_SIZE));
});

async function load(keepPage = false): Promise<void> {
  loading.value = true;
  try {
    if (!keepPage) page.value = 1;
    data.value = await api.get<ConflictListResponse>('/question-conflicts', {
      status: statusFilter.value,
      page: page.value,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    toast.error(errorMessage(e));
    data.value = null;
  } finally {
    loading.value = false;
  }
}

function switchStatus(next: StatusFilter): void {
  statusFilter.value = next;
  keyword.value = '';
  void load();
}

function goto(next: number): void {
  page.value = Math.min(Math.max(1, next), totalPages.value);
  void load(true);
}

/**
 * 手动重新扫描：这是**唯一**会扫全库的入口。
 * 冷缓存（容器/系统刚重启）时全库分组在 NAS 上要几分钟，期间服务端事件循环被占住，
 * 所以按钮要明确提示「可能较慢」，并把服务端返回的分段耗时显示出来。
 */
async function rescan(): Promise<void> {
  scanning.value = true;
  try {
    const res = await api.post<SyncResponse>('/question-conflicts/sync');
    toast.success(
      `扫描完成：台账 ${res.total} 组（待核对 ${res.pending}），共 ${(res.ms.total / 1000).toFixed(1)} 秒` +
        `（扫描 ${(res.ms.scan / 1000).toFixed(1)}s / 写台账 ${((res.ms.cleanup + res.ms.write) / 1000).toFixed(1)}s）`,
    );
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    scanning.value = false;
  }
}

/* ---------------- 逐组核对 ---------------- */
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<ConflictDetailResponse | null>(null);
const choice = ref('');
const saving = ref(false);

async function openDetail(group: ConflictGroup): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = null;
  // 默认预选票数最多的答案，减少点击
  choice.value = group.answers[0]?.answer ?? '';
  try {
    const res = await api.get<ConflictDetailResponse>(`/question-conflicts/${group.contentHash}`);
    detail.value = res;
    if (res.group.status === 'resolved' && res.group.chosenAnswer) choice.value = res.group.chosenAnswer;
  } catch (e) {
    toast.error(errorMessage(e));
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

async function resolveGroup(): Promise<void> {
  const hash = detail.value?.group.contentHash;
  if (!hash) return;
  if (!choice.value.trim()) {
    toast.error('请先选择或填写正确答案');
    return;
  }
  saving.value = true;
  try {
    const res = await api.post<ResolveResponse>(`/question-conflicts/${hash}/resolve`, { answer: choice.value });
    toast.success(`已统一为「${res.answer}」，共更新 ${res.updated} 道题`);
    detailOpen.value = false;
    await load(true);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function ignoreGroup(): Promise<void> {
  const hash = detail.value?.group.contentHash;
  if (!hash) return;
  saving.value = true;
  try {
    await api.post(`/question-conflicts/${hash}/ignore`);
    toast.success('已忽略该组，不再提示（题目未改动）');
    detailOpen.value = false;
    await load(true);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function reopenGroup(): Promise<void> {
  const hash = detail.value?.group.contentHash;
  if (!hash) return;
  saving.value = true;
  try {
    await api.post(`/question-conflicts/${hash}/reopen`);
    toast.success('已恢复为待核对');
    detailOpen.value = false;
    await load(true);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

/* ---------------- 批量按多数答案 ---------------- */
const majorityOpen = ref(false);
const majorityLoading = ref(false);
const majorityPreview = ref<MajorityResponse | null>(null);

async function previewMajority(): Promise<void> {
  majorityOpen.value = true;
  majorityLoading.value = true;
  majorityPreview.value = null;
  try {
    majorityPreview.value = await api.post<MajorityResponse>('/question-conflicts/resolve-majority');
  } catch (e) {
    toast.error(errorMessage(e));
    majorityOpen.value = false;
  } finally {
    majorityLoading.value = false;
  }
}

async function applyMajority(): Promise<void> {
  majorityLoading.value = true;
  try {
    const res = await api.post<MajorityResponse>('/question-conflicts/resolve-majority?dryRun=0');
    toast.success(`已按多数答案处理 ${res.groups} 组（${res.questions} 题），跳过并列 ${res.skipped} 组`);
    majorityOpen.value = false;
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    majorityLoading.value = false;
  }
}

/* ---------------- 批量合并同义写法 ---------------- */
interface EquivalentResponse {
  groups: number;
  questions: number;
  skipped: number;
  dryRun: boolean;
  samples: { stem: string; from: string[]; merged: string }[];
}

const equivOpen = ref(false);
const equivLoading = ref(false);
const equivPreview = ref<EquivalentResponse | null>(null);

async function previewEquivalent(): Promise<void> {
  equivOpen.value = true;
  equivLoading.value = true;
  equivPreview.value = null;
  try {
    equivPreview.value = await api.post<EquivalentResponse>('/question-conflicts/resolve-equivalent');
  } catch (e) {
    toast.error(errorMessage(e));
    equivOpen.value = false;
  } finally {
    equivLoading.value = false;
  }
}

async function applyEquivalent(): Promise<void> {
  equivLoading.value = true;
  try {
    const res = await api.post<EquivalentResponse>('/question-conflicts/resolve-equivalent?dryRun=0');
    toast.success(`已合并 ${res.groups} 组同义写法（${res.questions} 题），其余 ${res.skipped} 组留给人工`);
    equivOpen.value = false;
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    equivLoading.value = false;
  }
}

function fmtTime(seconds: number): string {
  if (!seconds) return '';
  const d = new Date(seconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(() => void load());
</script>

<template>
  <div class="mc-col conflict">
    <PageHeader
      title="同题不同答案核对"
      description="题干与选项完全相同、但答案不一致的题组。系统不会自动删改，请看清题目来源后选定一个答案，或确认「答案不同是合理的」后忽略；同一答案的不同写法可以一键合并成「两种写法都算对」。"
      icon="conflict"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '冲突题核对' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="scanning" @click="rescan">
          {{ scanning ? '扫描中（全库分组，冷缓存可能要几分钟）…' : '重新扫描全库' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="previewEquivalent">合并同义写法</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="previewMajority">
          按多数答案批量处理
        </button>
      </template>
    </PageHeader>

    <p v-if="staleHint" class="stale" :class="{ 'stale--strong': data?.total === 0 }">
      <Icon name="alert" :size="15" /> {{ staleHint }}
    </p>

    <section class="mc-card">
      <div class="mc-card__body tabs">
        <button
          v-for="tab in [
            { key: 'pending' as StatusFilter, label: '待核对', n: data?.counts.pending ?? 0 },
            { key: 'resolved' as StatusFilter, label: '已核对', n: data?.counts.resolved ?? 0 },
            { key: 'ignored' as StatusFilter, label: '已忽略', n: data?.counts.ignored ?? 0 },
            { key: 'all' as StatusFilter, label: '全部', n: data?.counts.total ?? 0 },
          ]"
          :key="tab.key"
          class="tab"
          :class="{ 'tab--active': statusFilter === tab.key }"
          type="button"
          @click="switchStatus(tab.key)"
        >
          {{ tab.label }}
          <span class="tab__n">{{ tab.n }}</span>
        </button>
        <span class="mc-muted tabs__hint">
          台账：{{ SYNC_REASON_LABEL[data?.sync.reason ?? ''] ?? '—' }}
          <template v-if="data && Number.isFinite(data.sync.ageMs)"> · 更新于 {{ ageLabel(data.sync.ageMs) }}</template>
        </span>
        <input
          v-model="keyword"
          class="mc-input tabs__search"
          type="search"
          placeholder="本页内搜索题干/答案"
          aria-label="本页内搜索题干或答案"
        />
      </div>
    </section>

    <div v-if="loading && !data" class="loading"><div class="mc-skeleton loading__row" /></div>

    <section v-else-if="data" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">冲突组</span>
        <span class="mc-muted">{{ data.total }} 组 · 第 {{ data.page }}/{{ totalPages }} 页</span>
      </div>

      <EmptyState
        v-if="visibleGroups.length === 0"
        :title="statusFilter === 'pending' ? '没有待核对的冲突组' : '没有记录'"
        description="导入新题库后点「重新扫描全库」即可发现新的冲突组。"
      />

      <ul v-else class="list">
        <li v-for="g in visibleGroups" :key="g.contentHash" class="item">
          <div class="item__main">
            <RichText class="item__stem" :text="g.stem" />
            <div class="item__answers">
              <span
                v-for="a in g.answers"
                :key="a.answer"
                class="mc-badge"
                :class="a.n === g.answers[0]?.n ? 'mc-badge--primary' : ''"
              >
                答案「<AnswerText :answer="a.answer" />」× {{ a.n }}
              </span>
              <span v-if="g.status === 'resolved'" class="mc-badge mc-badge--success">
                已核对：<AnswerText :answer="g.chosenAnswer || '—'" />{{ g.reviewerName ? ` · ${g.reviewerName}` : '' }}
              </span>
              <span v-else-if="g.status === 'ignored'" class="mc-badge">已忽略</span>
            </div>
          </div>
          <div class="item__meta mc-muted">
            共 {{ g.groupSize }} 题 / {{ g.answerCount }} 种答案
            <template v-if="g.updatedAt"> · {{ fmtTime(g.updatedAt) }}</template>
          </div>
          <button class="mc-btn mc-btn--sm" type="button" @click="openDetail(g)">
            {{ g.status === 'pending' ? '核对' : '查看' }}
          </button>
        </li>
      </ul>

      <div v-if="totalPages > 1" class="pager">
        <button class="mc-btn mc-btn--sm" type="button" :disabled="page <= 1" @click="goto(page - 1)">上一页</button>
        <span class="mc-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="page >= totalPages" @click="goto(page + 1)">
          下一页
        </button>
      </div>
    </section>

    <!-- 逐组核对 -->
    <AppModal :open="detailOpen" title="核对冲突组" width="820px" @close="detailOpen = false">
      <div v-if="detailLoading" class="loading"><div class="mc-skeleton loading__row" /></div>
      <div v-else-if="detail" class="mc-col detail">
        <p class="mc-muted">组内 {{ detail.questions.length }} 道题，题干与选项一致。选定答案后整组统一。</p>

        <div class="mc-table-wrap" tabindex="0" role="region" aria-label="数据表（可用方向键横向滚动）">
          <table class="mc-table mc-table--compact">
            <thead>
              <tr>
                <th>#</th>
                <th>现有答案</th>
                <th>所在题库</th>
                <th>类型</th>
                <th>难度</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="q in detail.questions" :key="q.id">
                <td>{{ q.id }}</td>
                <td>
                  <button class="answer-pick" type="button" @click="choice = q.answer">
                    <AnswerText :answer="q.answer" :type="q.type" />
                  </button>
                </td>
                <td>{{ q.bank_name }}</td>
                <td>{{ KIND_LABEL[q.bank_kind] ?? q.bank_kind ?? '—' }}</td>
                <td>{{ DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty ?? '—' }}</td>
                <td class="mc-muted">{{ q.source_no || q.source_path || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mc-col pick">
          <span class="mc-label">选定正确答案（点答案或直接填写）</span>
          <div class="pick__answers">
            <button
              v-for="a in detail.group.answers"
              :key="a.answer"
              class="answer-pick"
              :class="{ 'answer-pick--on': choice === a.answer }"
              type="button"
              @click="choice = a.answer"
            >
              <AnswerText :answer="a.answer" /> <span class="mc-muted">×{{ a.n }}</span>
            </button>
          </div>
          <input v-model="choice" class="mc-input" type="text" placeholder="正确答案" aria-label="正确答案" />
          <p v-if="detail.group.status === 'resolved'" class="mc-muted">
            上次核对：<AnswerText :answer="detail.group.chosenAnswer" /> · {{ detail.group.reviewerName }}
            {{ detail.group.updatedAt ? ` · ${fmtTime(detail.group.updatedAt)}` : '' }}
          </p>
          <p v-else-if="detail.group.status === 'ignored'" class="mc-muted">
            该组已被忽略（答案不同视为合理）。如需重新处理请点「恢复为待核对」。
          </p>
        </div>
      </div>

      <template #footer>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="saving" @click="ignoreGroup">忽略该组</button>
        <button
          v-if="detail?.group.status !== 'pending'"
          class="mc-btn mc-btn--sm"
          type="button"
          :disabled="saving"
          @click="reopenGroup"
        >
          恢复为待核对
        </button>
        <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="detailOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="saving" @click="resolveGroup">
          {{ saving ? '处理中…' : '统一为选定答案' }}
        </button>
      </template>
    </AppModal>

    <!-- 批量合并同义写法 -->
    <AppModal :open="equivOpen" title="合并同义写法" width="680px" @close="equivOpen = false">
      <div v-if="equivLoading && !equivPreview" class="loading">
        <div class="mc-skeleton loading__row" />
      </div>
      <div v-else-if="equivPreview" class="mc-col majority">
        <p>
          可自动合并 <strong>{{ equivPreview.groups }}</strong> 组（共 {{ equivPreview.questions }} 题）： 组内各写法
          <strong>数学上等价</strong>，合并后两种写法都算对；
          <strong>其余 {{ equivPreview.skipped }} 组是真的答案不同</strong>，需要人工判断（含票数并列的）。
        </p>
        <ul v-if="equivPreview.samples.length > 0" class="majority__samples">
          <li v-for="(s, i) in equivPreview.samples" :key="i">
            <span class="mc-muted"><RichText inline :text="s.stem" /></span><br />
            {{ s.from.join('  ／  ') }} → <AnswerText :answer="s.merged" />
          </li>
        </ul>
        <p class="mc-muted">为什么是合并而不是投票：投票是二选一，会把另一种正确写法判成错；合并是「都接受」。</p>
      </div>

      <template #footer>
        <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="equivOpen = false">取消</button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="equivLoading || (equivPreview?.groups ?? 0) === 0"
          @click="applyEquivalent"
        >
          {{ equivLoading ? '处理中…' : '确认合并' }}
        </button>
      </template>
    </AppModal>

    <!-- 批量按多数答案 -->
    <AppModal :open="majorityOpen" title="按多数答案批量处理" width="640px" @close="majorityOpen = false">
      <div v-if="majorityLoading && !majorityPreview" class="loading">
        <div class="mc-skeleton loading__row" />
      </div>
      <div v-else-if="majorityPreview" class="mc-col majority">
        <p>
          将处理 <strong>{{ majorityPreview.groups }}</strong> 组（共 {{ majorityPreview.questions }} 题）：
          每组采用出现次数最多的答案；<strong>票数并列的 {{ majorityPreview.skipped }} 组不处理</strong>，留给人工判断。
        </p>
        <ul v-if="majorityPreview.samples.length > 0" class="majority__samples">
          <li v-for="(s, i) in majorityPreview.samples" :key="i">
            <span class="mc-muted"><RichText inline :text="s.stem" /></span> → 答案「<AnswerText
              :answer="s.answer"
            />」（{{ s.n }} 票）
          </li>
        </ul>
        <p class="mc-muted">此操作会修改题目答案（每次核对都会写审计日志，可在设置里查）。</p>
      </div>

      <template #footer>
        <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="majorityOpen = false">取消</button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="majorityLoading || (majorityPreview?.groups ?? 0) === 0"
          @click="applyMajority"
        >
          {{ majorityLoading ? '处理中…' : '确认执行' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.conflict {
  gap: var(--mc-space-4);
}

.head {
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-4);
  flex-wrap: wrap;
}

.head__actions {
  display: flex;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.tabs {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill, 999px);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.tab--active {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
  font-weight: 600;
}

.tab__n {
  font-variant-numeric: tabular-nums;
}

.tabs__hint {
  margin-left: auto;
}

.tabs__search {
  max-width: 240px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-top: 1px solid var(--mc-border);
}

.item:first-child {
  border-top: none;
}

.item__main {
  flex: 1;
  min-width: 0;
}

.item__stem {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item__answers {
  display: flex;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  margin-top: 6px;
}

.item__meta {
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
}

.detail {
  gap: var(--mc-space-3);
}

.pick {
  gap: var(--mc-space-2);
}

.pick__answers {
  display: flex;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.answer-pick {
  padding: 2px 10px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.answer-pick--on {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
  font-weight: 600;
}

.majority {
  gap: var(--mc-space-3);
}

.majority__samples {
  margin: 0;
  padding-left: 18px;
  max-height: 240px;
  overflow-y: auto;
}

.loading__row {
  height: 72px;
  border-radius: var(--mc-radius);
}

.stale {
  margin: 0;
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-warning);
  border-radius: var(--mc-radius);
  background: var(--mc-warning-soft);
  font-size: var(--mc-text-sm);
}

.stale--strong {
  font-weight: 600;
}
</style>
