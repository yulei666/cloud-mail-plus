<script setup>
import { ref, computed, onMounted, watch, nextTick, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Chat } from '@ai-sdk/vue';
import { DefaultChatTransport } from 'ai';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { useAgentStore } from '@/store/agent';
import { userDraftStore } from '@/store/draft';
import { useEmailStore } from '@/store/email';
import ToolConfirmation from './ToolConfirmation.vue';
import http from '@/axios/index.js';

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

    const targetUrl = new URL(url, window.location.origin);
    if (activeEmail.value?.emailId) {
      targetUrl.searchParams.set('activeEmailId', String(activeEmail.value.emailId));
      headers.set('X-Active-Email-Id', String(activeEmail.value.emailId));
    }
    return fetch(targetUrl.toString(), { ...init, headers });
  },
});

// Chat is a class. shallowRef tracks identity; the class manages internal reactivity.
const chat = shallowRef(new Chat({ transport, messages: store.messages || [] }));

watch(() => chat.value.messages, async () => {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}, { deep: true });

watch(() => chat.value.status, (newStatus, oldStatus) => {
  if (newStatus === 'ready' && (oldStatus === 'streaming' || oldStatus === 'submitted')) {
    const hasDraftTool = (chat.value.messages || []).some(m =>
      (m.parts || []).some(p =>
        (p.type === 'tool-call' || (typeof p.type === 'string' && p.type.startsWith('tool-'))) &&
        ['draftReply', 'draftNew', 'sendDraft'].includes(p.toolName)
      )
    );
    if (hasDraftTool) {
      draftStore.refreshList++;
    }
  }
});

onMounted(async () => {
  if (!store.hydrated) await store.hydrate();
});

const pendingConfirm = computed(() =>
  chat.value.messages
    .flatMap(m => m.parts || [])
    .find(p =>
      (p.type === 'tool-call' || (typeof p.type === 'string' && p.type.startsWith('tool-'))) &&
      ['sendDraft', 'deleteEmail'].includes(p.toolName) &&
      !(p.output || p.result)
    )
);

async function onSubmit() {
  const text = input.value.trim();
  if (!text || chat.value.status === 'streaming') return;
  input.value = '';
  await chat.value.sendMessage({ text });
}

async function handleQuickAction(action) {
  if (!activeEmail.value) return;
  const id = activeEmail.value.emailId;
  const subject = activeEmail.value.subject || '';

  if (action === 'summarize') {
    if (chat.value.status === 'streaming') return;
    const prompt = t('aiAgentPromptSummarize', { id, subject });
    await chat.value.sendMessage({ text: prompt });
  } else if (action === 'todo') {
    if (chat.value.status === 'streaming') return;
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
    chat.value.addToolResult({ toolCallId, output: { cancelled: true } });
    return;
  }
  const r = await http.post('/agent/confirm', { name: toolName, args });
  chat.value.addToolResult({ toolCallId, output: r.data || r });
  if (['draftReply', 'draftNew', 'sendDraft'].includes(toolName)) {
    draftStore.refreshList++;
  }
}

async function clearChat() {
  await store.clear();
  chat.value = new Chat({ transport, messages: [] });
}

function renderPart(part) {
  if (part.type === 'text') return md.render(part.text || '');
  if (part.type === 'tool-call' || (typeof part.type === 'string' && part.type.startsWith('tool-'))) {
    const args = part.args || part.input;
    return `<div class="tool-call"><b>🔧 ${part.toolName || part.type}</b><pre>${escape(JSON.stringify(args, null, 2))}</pre></div>`;
  }
  if (part.type === 'tool-result' || part.output) {
    return `<div class="tool-result"><b>→ ${part.toolName || 'result'}</b><pre>${escape(JSON.stringify(part.output || part.result, null, 2))}</pre></div>`;
  }
  return '';
}
function escape(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
</script>

<template>
  <Transition name="slide">
    <aside v-if="visible" class="agent-panel">
      <header class="agent-head">
        <span>✨ {{ $t('aiAgentChatTitle') }}</span>
        <div>
          <button @click="clearChat" :title="$t('aiAgentClearChat')">🗑</button>
          <button @click="$emit('close')" title="×">×</button>
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
            :disabled="chat.status === 'streaming'"
            @click="handleQuickAction('summarize')">
            📝 {{ $t('aiAgentSummarizeThis') }}
          </button>
          <button
            type="button"
            class="btn-action"
            :disabled="chat.status === 'streaming'"
            @click="handleQuickAction('todo')">
            📋 {{ $t('aiAgentTodoThis') }}
          </button>
          <button
            type="button"
            class="btn-action"
            :disabled="chat.status === 'streaming'"
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
        <button :disabled="chat.status === 'streaming' || !input.trim()">{{ $t('aiAgentSend') }}</button>
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
.agent-head { padding: 12px 16px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; font-weight: 600; }

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
  background: #ffffff;
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
