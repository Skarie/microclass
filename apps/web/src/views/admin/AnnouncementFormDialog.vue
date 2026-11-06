<script setup lang="ts">
/**
 * 公告新建 / 编辑弹窗：标题、正文、级别、置顶、发布。
 *
 * 校验在前端先做一遍（标题必填、正文必填、级别必须是枚举），错误就地显示在字段下，
 * 不靠 toast 打回；提交成功后由父组件关闭弹窗。
 */
import { ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import { ANNOUNCEMENT_LEVELS } from '@/api/announcement';
import { isAnnouncementLevel, levelMeta } from '@/utils/announcement';
import type { Announcement, AnnouncementLevel, AnnouncementPayload } from '@/api/announcement';

const props = defineProps<{ open: boolean; target: Announcement | null; saving: boolean }>();
const emit = defineEmits<{ close: []; submit: [payload: AnnouncementPayload] }>();

const title = ref('');
const body = ref('');
const level = ref<AnnouncementLevel>('info');
const pinned = ref(false);
const published = ref(true);
const errors = ref<{ title?: string; body?: string }>({});

/* 每次打开都按目标重置：编辑后再次打开新建，不能残留上一条的内容 */
watch(
  () => [props.open, props.target] as const,
  ([open, target]) => {
    if (!open) return;
    title.value = target?.title ?? '';
    body.value = target?.body ?? '';
    level.value = target && isAnnouncementLevel(target.level) ? target.level : 'info';
    pinned.value = target?.pinned ?? false;
    published.value = target ? target.published !== false : true;
    errors.value = {};
  },
  { immediate: true },
);

function submit(): void {
  const next: { title?: string; body?: string } = {};
  if (!title.value.trim()) next.title = '标题不能为空';
  if (!body.value.trim()) next.body = '正文不能为空';
  errors.value = next;
  if (next.title || next.body) return;
  emit('submit', {
    title: title.value.trim(),
    body: body.value.trim(),
    level: level.value,
    pinned: pinned.value,
    published: published.value,
  });
}
</script>

<template>
  <AppModal :open="open" :title="target ? '编辑公告' : '新建公告'" width="560px" @close="emit('close')">
    <div class="ann-form">
      <label class="mc-field">
        <span class="mc-label">标题</span>
        <input
          v-model="title"
          class="mc-input"
          type="text"
          maxlength="120"
          placeholder="一句话说清这条公告要大家做什么"
          :aria-invalid="Boolean(errors.title)"
        />
        <span v-if="errors.title" class="ann-form__error">{{ errors.title }}</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">正文</span>
        <textarea
          v-model="body"
          class="mc-textarea"
          rows="6"
          maxlength="5000"
          placeholder="补充细节：时间、影响范围、需要谁做什么。首页只显示前 60 字摘要。"
          :aria-invalid="Boolean(errors.body)"
        />
        <span v-if="errors.body" class="ann-form__error">{{ errors.body }}</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">级别</span>
        <select v-model="level" class="mc-select">
          <option v-for="value in ANNOUNCEMENT_LEVELS" :key="value" :value="value">
            {{ levelMeta(value).label }}
          </option>
        </select>
        <span class="mc-hint">级别决定首页条目的图标与底色：通知=主色、提醒=琥珀、重要=砖红。</span>
      </label>

      <div class="ann-form__switches">
        <label class="mc-checkbox">
          <input v-model="pinned" type="checkbox" />
          置顶（列表与首页排在最前）
        </label>
        <label class="mc-checkbox">
          <input v-model="published" type="checkbox" />
          发布（取消勾选则存为草稿，学员看不到）
        </label>
      </div>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" :disabled="saving" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.ann-form {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}

.ann-form__error {
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-danger-fg);
}

.ann-form__switches {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}
</style>
