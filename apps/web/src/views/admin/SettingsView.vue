<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';

interface SettingsResponse {
  settings: { allow_register: string };
}

interface SaveSettingsResponse {
  ok: boolean;
  allowRegister: boolean;
}

interface VersionResponse {
  name: string;
  version: string;
  env: string;
  node: string;
}

const auth = useAuthStore();
const toast = useToastStore();

const loading = ref(false);
const saving = ref(false);
const allowRegister = ref(true);
const version = ref<VersionResponse | null>(null);
const versionLoading = ref(false);

async function loadSettings(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<SettingsResponse>('/settings');
    allowRegister.value = res.settings.allow_register === '1';
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

async function saveSettings(): Promise<void> {
  saving.value = true;
  try {
    const res = await api.put<SaveSettingsResponse>('/settings', { allowRegister: allowRegister.value });
    allowRegister.value = res.allowRegister;
    toast.success(res.allowRegister ? '已开放学员自助注册' : '已关闭学员自助注册');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function loadVersion(): Promise<void> {
  versionLoading.value = true;
  try {
    version.value = await api.get<VersionResponse>('/version');
  } catch (e) {
    toast.error(errorMessage(e));
    version.value = null;
  } finally {
    versionLoading.value = false;
  }
}

onMounted(() => {
  void loadSettings();
  void loadVersion();
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="系统设置"
      description="站点级开关与运行参数。网页上只暴露可安全修改的项，其余通过环境变量配置。"
      icon="settings"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '系统设置' }]"
    >
      <template #actions>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'admin-design' }">
          <Icon name="grid" :size="15" />
          设计系统
        </RouterLink>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="loadSettings">
          <Icon name="refresh" :size="15" />
          重新读取
        </button>
      </template>
    </PageHeader>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title"><Icon name="user" :size="16" /> 注册与账号</span>
      </div>

      <div class="mc-card__body mc-col">
        <label class="mc-checkbox">
          <input v-model="allowRegister" type="checkbox" :disabled="loading" />
          开放学员自助注册（关闭后只能由管理员在「学员与账号」中创建账号）
        </label>

        <p class="mc-hint">
          该开关对应服务端设置项 <span class="mc-mono">allow_register</span>，会立即影响登录页的「注册」入口。
          首次启动的默认值来自环境变量 <span class="mc-mono">MC_ALLOW_REGISTER</span>。
        </p>

        <div class="mc-row">
          <button class="mc-btn mc-btn--primary" type="button" :disabled="saving || loading" @click="saveSettings">
            {{ saving ? '保存中…' : '保存设置' }}
          </button>
          <span class="mc-muted"> 当前状态：{{ allowRegister ? '已开放注册' : '已关闭注册' }} </span>
        </div>

        <p class="mc-hint">
          说明：服务端为避免误操作，只暴露了注册开关这一项可在网页上修改；站点名称、端口、上传大小、限流等其余配置
          需要调整环境变量（如 <span class="mc-mono">MC_SITE_NAME</span>、<span class="mc-mono">MC_PORT</span>、
          <span class="mc-mono">MC_MAX_UPLOAD_MB</span>）后重启服务。
        </p>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">环境信息</span>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="versionLoading" @click="loadVersion">刷新</button>
      </div>

      <div class="mc-card__body">
        <dl class="info">
          <div class="info__row">
            <dt class="mc-muted">站点名称</dt>
            <dd>{{ auth.siteName }}</dd>
          </div>
          <div class="info__row">
            <dt class="mc-muted">当前登录账号</dt>
            <dd>
              {{ auth.displayName || '—' }}
              <span class="mc-badge">{{ auth.isAdmin ? '管理员' : auth.isTeacher ? '教师' : '学员' }}</span>
            </dd>
          </div>
          <div class="info__row">
            <dt class="mc-muted">API 名称</dt>
            <dd class="mc-mono">{{ version?.name ?? '—' }}</dd>
          </div>
          <div class="info__row">
            <dt class="mc-muted">API 版本</dt>
            <dd class="mc-mono">{{ version?.version ?? '—' }}</dd>
          </div>
          <div class="info__row">
            <dt class="mc-muted">运行环境</dt>
            <dd>
              <span class="mc-badge" :class="version?.env === 'production' ? 'mc-badge--success' : 'mc-badge--warning'">
                {{ version?.env ?? '未知' }}
              </span>
            </dd>
          </div>
          <div class="info__row">
            <dt class="mc-muted">Node 版本</dt>
            <dd class="mc-mono">{{ version?.node ?? '—' }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">运维提示</span>
      </div>

      <div class="mc-card__body">
        <ul class="tips">
          <li class="tips__item">
            <strong>数据目录备份</strong>
            <span class="mc-secondary">
              全部业务数据都在数据目录（默认 <span class="mc-mono">data/</span>，可用
              <span class="mc-mono">MC_DATA_DIR</span> 修改）中：SQLite 数据库、上传的封面 / 附件 / 配图、会话密钥。
              定期整目录备份即可完整恢复。
            </span>
          </li>
          <li class="tips__item">
            <strong>Docker / FPK 部署</strong>
            <span class="mc-secondary">
              仓库自带 <span class="mc-mono">ops/docker/docker-compose.yml</span> 与
              <span class="mc-mono">Dockerfile</span>。容器化部署时，务必把宿主机上的视频文件夹与数据目录挂载进容器，
              否则「媒体目录」里添加的路径将不可访问。
            </span>
          </li>
          <li class="tips__item">
            <strong>数据库迁移</strong>
            <span class="mc-secondary">
              升级版本后执行
              <span class="mc-mono">npm run migrate</span> 应用数据库迁移脚本；服务启动时也会自动执行一次迁移。
            </span>
          </li>
          <li class="tips__item">
            <strong>会话与安全</strong>
            <span class="mc-secondary">
              生产环境请显式设置 <span class="mc-mono">MC_SESSION_SECRET</span> 与
              <span class="mc-mono">MC_ADMIN_PASS</span>，并把服务置于 HTTPS 反向代理之后。
            </span>
          </li>
        </ul>
      </div>
    </section>
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.info {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--mc-space-3) var(--mc-space-5);
}

.info__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.info__row dt {
  flex: none;
  min-width: 96px;
  font-size: var(--mc-text-xs);
}

.info__row dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
  word-break: break-all;
}

.tips {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}

.tips__item {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-left: 3px solid var(--mc-primary);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-sm);
}
</style>
