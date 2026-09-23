<script setup>
import { ref, computed, onMounted, watch, nextTick, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Chat } from '@ai-sdk/vue';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { useAgentStore } from '@/store/agent';
import { userDraftStore } from '@/store/draft';
import { useEmailStore } from '@/store/email';
import ToolConfirmation from './ToolConfirmation.vue';
import http from '@/axios/index.js';
import { Icon } from '@iconify/vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const props = defineProps({ visible: Boolean });
const emit = defineEmits(['close']);

const route = useRoute();
const emailStore = useEmailStore();
const { t } = useI18n();

const store = useAgentStore();
const draftStore = userDraftStore();
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(taskLists);
const scroller = ref(null);
const textareaRef = ref(null);
const input = ref('');

function getToolNameFromPart(part) {
  if (!part) return '';
  if (part.toolName) return part.toolName;
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice(5);
  }
  return '';
}

function getToolArgsFromPart(part) {
  return part?.input ?? part?.args ?? {};
}

function isToolPart(part) {
  if (!part) return false;
  return part.type === 'tool-call' || (typeof part.type === 'string' && part.type.startsWith('tool-'));
}

function hasToolOutput(part) {
  if (!part) return false;
  return part.output !== undefined || part.result !== undefined || part.state === 'output-available' || part.state === 'output-error';
}

// Detect if user is currently reading a specific email in /message (route name: 'content')
const activeEmail = computed(() => {
  if (route.name === 'content' && emailStore.contentData?.email?.emailId) {
    return emailStore.contentData.email;
  }
  return null;
});

// Token-aware transport so the JWT travels with each chat request, plus activeEmailId context.
const transport = new DefaultChatTransport({
  api: '/api/agent/chat',
  fetch: (url, init) => {
    const headers = new Headers(init?.headers || {});
    const token = localStorage.getItem('token');
    if (token) headers.set('Authorization', token);

    if (activeEmail.value?.emailId) {
      headers.set('X-Active-Email-Id', String(activeEmail.value.emailId));
    }
    return fetch(url, { ...init, headers });
  },
});

// Chat is a class. shallowRef tracks identity; the class manages internal reactivity.
const chat = shallowRef(new Chat({
  transport,
  messages: store.messages || [],
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
}));

watch(() => chat.value.messages, async () => {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}, { deep: true });

watch(() => chat.value.status, (newStatus, oldStatus) => {
  if (newStatus === 'ready' && (oldStatus === 'streaming' || oldStatus === 'submitted')) {
    const hasDraftTool = (chat.value.messages || []).some(m =>
      (m.parts || []).some(p => {
        const name = getToolNameFromPart(p);
        return ['draftReply', 'draftNew', 'sendDraft'].includes(name);
      })
    );
    if (hasDraftTool) {
      draftStore.refreshList++;
    }
  }
});

onMounted(async () => {
  if (!store.hydrated) await store.hydrate();
});

const pendingConfirm = computed(() => {
  for (const m of chat.value.messages || []) {
    for (const p of m.parts || []) {
      if (isToolPart(p)) {
        const name = getToolNameFromPart(p);
        if (['sendDraft', 'deleteEmail'].includes(name) && !hasToolOutput(p)) {
          return {
            ...p,
            toolName: name,
            args: getToolArgsFromPart(p),
            toolCallId: p.toolCallId,
          };
        }
      }
    }
  }
  return null;
});

const busy = computed(() => ['submitted', 'streaming'].includes(chat.value?.status));
const canClear = computed(() => !busy.value && Boolean(chat.value?.messages?.length));

async function onSubmit() {
  const text = input.value.trim();
  if (!text || busy.value) return;
  input.value = '';
  await chat.value.sendMessage({ text });
}

async function handleQuickAction(action) {
  if (!activeEmail.value) return;
  const id = activeEmail.value.emailId;
  const subject = activeEmail.value.subject || '';

  if (action === 'summarize') {
    if (busy.value) return;
    const prompt = t('aiAgentPromptSummarize', { id, subject });
    await chat.value.sendMessage({ text: prompt });
  } else if (action === 'todo') {
    if (busy.value) return;
    const prompt = t('aiAgentPromptTodo', { id, subject });
    await chat.value.sendMessage({ text: prompt });
  } else if (action === 'reply') {
    input.value = t('aiAgentPromptReplyPrefix', { id });
    await nextTick();
    if (textareaRef.value) {
      textareaRef.value.focus();
    }
  }
}

async function onConfirmTool({ accepted, toolCallId, toolName, args }) {
  if (!accepted) {
    if (typeof chat.value.addToolOutput === 'function') {
      await chat.value.addToolOutput({ tool: toolName, toolCallId, output: { cancelled: true } });
    } else if (typeof chat.value.addToolResult === 'function') {
      await chat.value.addToolResult({ toolCallId, output: { cancelled: true } });
    }
    return;
  }
  try {
    const r = await http.post('/agent/confirm', { name: toolName, args });
    const output = r.data || r;
    if (typeof chat.value.addToolOutput === 'function') {
      await chat.value.addToolOutput({ tool: toolName, toolCallId, output });
    } else if (typeof chat.value.addToolResult === 'function') {
      await chat.value.addToolResult({ toolCallId, output });
    }
    if (['draftReply', 'draftNew', 'sendDraft'].includes(toolName)) {
      draftStore.refreshList++;
    }
  } catch (err) {
    console.error('[agent] onConfirmTool error:', err);
    if (typeof chat.value.addToolOutput === 'function') {
      await chat.value.addToolOutput({
        tool: toolName,
        toolCallId,
        state: 'output-error',
        errorText: err?.message || 'Execution failed',
      });
    }
  }
}

async function clearChat() {
  if (!canClear.value) return;
  try {
    await ElMessageBox.confirm(
      t('aiAgentClearChatConfirm'),
      t('aiAgentClearChatTitle'),
      {
        confirmButtonText: t('confirm'),
        cancelButtonText: t('cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      }
    );
  } catch {
    return; // User cancelled
  }

  try {
    await store.clear();
    chat.value = new Chat({
      transport,
      messages: [],
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });
  } catch (e) {
    ElMessage.error(e?.message || t('aiAgentClearFailed'));
  }
}

function renderPart(part) {
  if (part.type === 'text') return md.render(part.text || '');
  if (isToolPart(part)) {
    const toolName = getToolNameFromPart(part);
    const args = getToolArgsFromPart(part);
    const hasOutput = hasToolOutput(part);
    const output = part.output ?? part.result;
    let html = `<div class="tool-call"><b>🔧 ${escape(toolName)}</b><pre>${escape(JSON.stringify(args, null, 2))}</pre></div>`;
    if (hasOutput) {
      if (part.state === 'output-error' || part.errorText) {
        html += `<div class="tool-result error"><b>❌ ${escape(toolName)} error</b><pre>${escape(part.errorText || JSON.stringify(output, null, 2))}</pre></div>`;
      } else {
        html += `<div class="tool-result"><b>✓ ${escape(toolName)}</b><pre>${escape(JSON.stringify(output, null, 2))}</pre></div>`;
      }
    }
    return html;
  }
  if (part.type === 'tool-result' || part.output) {
    const name = part.toolName || 'result';
    return `<div class="tool-result"><b>→ ${escape(name)}</b><pre>${escape(JSON.stringify(part.output || part.result, null, 2))}</pre></div>`;
  }
  return '';
}
function escape(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
</script>

<template>
  <Transition name="slide">
    <aside v-if="visible" class="agent-panel">
      <header class="agent-head">
        <span class="head-title">✨ {{ $t('aiAgentChatTitle') }}</span>
        <div class="head-actions">
          <button
            class="head-btn head-btn-danger"
            :disabled="!canClear"
            :title="$t('aiAgentClearChat')"
            @click="clearChat"
          >
            <Icon icon="material-symbols:delete-outline-rounded" width="18" height="18" />
          </button>
          <button
            class="head-btn head-btn-close"
            :title="$t('aiAgentClose')"
            @click="$emit('close')"
          >
            <Icon icon="material-symbols-light:close-rounded" width="20" height="20" />
          </button>
        </div>
      </header>

      <div v-if="activeEmail" class="active-email-card">
        <div class="card-header">
          <span class="card-badge">
            <span class="badge-dot"></span>
            {{ $t('aiAgentViewingEmail') }}
          </span>
          <span class="card-id">#{{ activeEmail.emailId }}</span>
        </div>
        <div class="card-subject" :title="activeEmail.subject">
          {{ activeEmail.subject || '(' + $t('noSubject') + ')' }}
        </div>
        <div class="card-meta">
          <span class="card-sender" :title="activeEmail.sendEmail || activeEmail.name">
            {{ activeEmail.name ? `${activeEmail.name} <${activeEmail.sendEmail}>` : activeEmail.sendEmail }}
          </span>
          <span v-if="activeEmail.createTime" class="card-date">{{ activeEmail.createTime }}</span>
        </div>
        <div class="card-actions">
          <button
            type="button"
            class="btn-action"
            :disabled="busy"
            @click="handleQuickAction('summarize')">
            📝 {{ $t('aiAgentSummarizeThis') }}
          </button>
          <button
            type="button"
            class="btn-action"
            :disabled="busy"
            @click="handleQuickAction('todo')">
            📋 {{ $t('aiAgentTodoThis') }}
          </button>
          <button
            type="button"
            class="btn-action"
            :disabled="busy"
            @click="handleQuickAction('reply')">
            ✍️ {{ $t('aiAgentReplyThis') }}
          </button>
        </div>
      </div>

      <div ref="scroller" class="agent-body">
        <div v-for="m in chat.messages" :key="m.id" :class="['msg', m.role]">
          <div v-for="(p, i) in (m.parts || [{type:'text', text:m.content}])"
               :key="i" v-html="renderPart(p)" />
        </div>
        <div v-if="chat.status === 'streaming' || chat.status === 'submitted'" class="msg assistant typing">…</div>
        <div v-if="chat.error" class="msg error">{{ chat.error.message }}</div>
      </div>

      <ToolConfirmation
        v-if="pendingConfirm"
        :tool="pendingConfirm"
        @decision="onConfirmTool" />

      <form class="agent-input" @submit.prevent="onSubmit">
        <textarea ref="textareaRef"
                  v-model="input"
                  :placeholder="$t('aiAgentChatPlaceholder')"
                  rows="2"
                  @keydown.enter.exact.prevent="onSubmit" />
        <button :disabled="busy || !input.trim()">{{ $t('aiAgentSend') }}</button>
      </form>
    </aside>
  </Transition>
</template>

<style scoped>
.agent-panel {
  position: fixed; right: 0; top: 0; bottom: 0;
  width: 400px; background: var(--el-bg-color, #fff);
  border-left: 1px solid var(--el-border-color-light, #eee);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 12px rgba(0,0,0,0.05); z-index: 1000;
}
.agent-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light, #eee);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--el-text-color-primary, #303133);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.head-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--el-text-color-secondary, #606266);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

.head-btn-close:hover:not(:disabled) {
  background: var(--el-fill-color, #f0f2f5);
  color: var(--el-text-color-primary, #303133);
}

.head-btn-danger:hover:not(:disabled) {
  background: var(--el-color-danger-light-9, #fef0f0);
  color: var(--el-color-danger, #f56c6c);
  border-color: var(--el-color-danger-light-7, #fde2e2);
}

.head-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.active-email-card {
  margin: 10px 12px 2px 12px;
  padding: 10px 12px;
  background: var(--el-color-primary-light-9, #f0f7ff);
  border: 1px solid var(--el-color-primary-light-7, #d0e7ff);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--el-color-primary, #409eff);
  font-size: 11px;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary, #409eff);
  display: inline-block;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

.card-id {
  font-family: monospace;
  font-size: 11px;
  color: var(--el-text-color-secondary, #909399);
}

.card-subject {
  font-weight: 600;
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.card-meta {
  display: flex;
  justify-content: space-between;
  color: var(--el-text-color-secondary, #606266);
  font-size: 11px;
}

.card-sender {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.card-date {
  white-space: nowrap;
  color: var(--el-text-color-placeholder, #909399);
}

.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.btn-action {
  flex: 1;
  padding: 4px 6px;
  background: var(--el-bg-color, #ffffff);
  border: 1px solid var(--el-color-primary-light-5, #b3d8ff);
  color: var(--el-color-primary, #409eff);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  display: inline-flex;
  justify-content: center;
  align-items: center;
}

.btn-action:hover:not(:disabled) {
  background: var(--el-color-primary, #409eff);
  color: #ffffff;
}

.btn-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.agent-body { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; }
.msg.user { background: #f0f7ff; }
.msg.assistant { background: #fafafa; }
.msg.error { background: #fee2e2; color: #b91c1c; font-size: 12px; }
.tool-call, .tool-result { font-size: 12px; background: #fff8e1; padding: 6px 8px; border-radius: 4px; margin: 4px 0; }
.tool-result { background: #e8f5e9; }
.tool-call pre, .tool-result pre { margin: 4px 0 0; max-height: 120px; overflow: auto; font-size: 11px; }
.agent-input { display: flex; gap: 8px; padding: 8px; border-top: 1px solid #eee; }
.agent-input textarea { flex: 1; resize: none; padding: 6px 8px; border-radius: 4px; border: 1px solid #ddd; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
.slide-enter-active, .slide-leave-active { transition: transform 0.2s ease; }
</style>
