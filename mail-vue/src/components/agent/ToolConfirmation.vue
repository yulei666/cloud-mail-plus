<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import http from '@/axios/index.js';

const props = defineProps({
  tool: { type: Object, required: true },
  submitting: { type: Boolean, default: false },
});
const emit = defineEmits(['decision']);
const { t } = useI18n();

const localSubmitting = ref(false);
const preview = ref(null);
const loadingPreview = ref(false);
const previewError = ref('');

const toolName = computed(() =>
  props.tool?.toolName ||
  (typeof props.tool?.type === 'string' && props.tool.type.startsWith('tool-')
    ? props.tool.type.slice(5)
    : '')
);
const args = computed(() => props.tool?.args ?? props.tool?.input ?? {});

const isBusy = computed(() => props.submitting || localSubmitting.value);

const title = computed(() =>
  toolName.value === 'sendDraft'
    ? '📤 ' + t('aiAgentConfirmSend')
    : '🗑 ' + t('aiAgentConfirmDelete')
);
const danger = computed(() => toolName.value === 'deleteEmail' && args.value?.permanent);

async function loadPreview() {
  const targetId = toolName.value === 'sendDraft' ? Number(args.value?.draftId) : Number(args.value?.emailId);
  if (!targetId) return;
  loadingPreview.value = true;
  previewError.value = '';
  preview.value = null;
  try {
    const res = await http.get('/agent/preview', {
      params: { name: toolName.value, id: targetId },
      noMsg: true,
    });
    preview.value = res.data || res;
  } catch (e) {
    if (toolName.value === 'sendDraft') {
      previewError.value = t('aiAgentDraftNotFound');
    } else {
      previewError.value = t('aiAgentEmailNotFound');
    }
  } finally {
    loadingPreview.value = false;
  }
}

watch(
  () => [toolName.value, args.value?.draftId, args.value?.emailId],
  () => {
    loadPreview();
  },
  { immediate: true }
);

function decide(accepted) {
  if (isBusy.value) return;
  if (accepted && (previewError.value || loadingPreview.value)) return;
  localSubmitting.value = true;
  emit('decision', {
    accepted,
    toolCallId: props.tool.toolCallId,
    toolName: toolName.value,
    args: args.value,
  });
}
</script>

<template>
  <div class="tool-confirm">
    <div class="tool-confirm-card" :class="{ danger }">
      <h3>{{ title }}</h3>

      <!-- sendDraft -->
      <div v-if="toolName === 'sendDraft'" class="confirm-info">
        <p class="desc">{{ $t('aiAgentConfirmSendDesc', { id: args.draftId }) }}</p>

        <div v-if="loadingPreview" class="preview-status loading">
          <span class="spinner-small"></span>
          <span>{{ $t('aiAgentLoadingDetails') }}</span>
        </div>

        <div v-else-if="previewError" class="preview-status error">
          <span>⚠️ {{ previewError }}</span>
        </div>

        <div v-else-if="preview" class="preview-box">
          <div class="preview-field">
            <span class="field-label">{{ $t('sender') }}:</span>
            <span class="field-val" :title="preview.from">{{ preview.from || '-' }}</span>
          </div>
          <div class="preview-field">
            <span class="field-label">{{ $t('recipient') }}:</span>
            <span class="field-val" :title="preview.to">{{ preview.to || '-' }}</span>
          </div>
          <div class="preview-field">
            <span class="field-label">{{ $t('subject') }}:</span>
            <span class="field-val bold" :title="preview.subject">{{ preview.subject || '(' + $t('noSubject') + ')' }}</span>
          </div>
          <div v-if="preview.preview" class="preview-snippet">
            {{ preview.preview }}
          </div>
        </div>

        <div class="tag-row">
          <span class="label">{{ $t('aiAgentDraftId') }}:</span>
          <span class="badge">#{{ args.draftId }}</span>
        </div>
      </div>

      <!-- deleteEmail -->
      <div v-else-if="toolName === 'deleteEmail'" class="confirm-info">
        <p class="desc">{{ $t('aiAgentConfirmDeleteDesc', { id: args.emailId }) }}</p>

        <div v-if="loadingPreview" class="preview-status loading">
          <span class="spinner-small"></span>
          <span>{{ $t('aiAgentLoadingDetails') }}</span>
        </div>

        <div v-else-if="previewError" class="preview-status error">
          <span>⚠️ {{ previewError }}</span>
        </div>

        <div v-else-if="preview" class="preview-box">
          <div class="preview-field">
            <span class="field-label">{{ $t('sender') }}:</span>
            <span class="field-val" :title="preview.from">{{ preview.from || '-' }}</span>
          </div>
          <div class="preview-field">
            <span class="field-label">{{ $t('subject') }}:</span>
            <span class="field-val bold" :title="preview.subject">{{ preview.subject || '(' + $t('noSubject') + ')' }}</span>
          </div>
          <div v-if="preview.preview" class="preview-snippet">
            {{ preview.preview }}
          </div>
        </div>

        <div class="tag-row">
          <span class="label">{{ $t('aiAgentEmailId') }}:</span>
          <span class="badge">#{{ args.emailId }}</span>
          <span v-if="args.permanent" class="warn-badge">{{ $t('aiAgentPermanentWarn') }}</span>
        </div>
      </div>

      <pre v-else>{{ JSON.stringify(args, null, 2) }}</pre>

      <p v-if="danger" class="warn">⚠ {{ $t('aiAgentPermanentWarn') }}</p>

      <div class="actions">
        <button class="cancel" :disabled="isBusy" @click="decide(false)">{{ $t('aiAgentCancel') }}</button>
        <button
          class="confirm"
          :class="{ danger }"
          :disabled="isBusy || loadingPreview || Boolean(previewError)"
          @click="decide(true)"
        >
          <span v-if="isBusy" class="spinner-small"></span>
          {{ toolName === 'sendDraft' ? $t('aiAgentSend') : $t('aiAgentConfirmDelete') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-confirm { padding: 12px; border-top: 1px solid var(--el-border-color-light, #eee); background: var(--el-fill-color-light, #fffaf0); }
.tool-confirm-card { padding: 12px; border-radius: 8px; background: var(--el-bg-color, #fff); border: 1px solid #ffd699; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.tool-confirm-card.danger { border-color: #f87171; }
.tool-confirm h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--el-text-color-primary, #111827); }
.confirm-info { margin: 6px 0; }
.confirm-info .desc { font-size: 13px; color: var(--el-text-color-regular, #4b5563); margin: 0 0 8px; }

.preview-status { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; }
.preview-status.loading { background: #f3f4f6; color: #6b7280; }
.preview-status.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }

.preview-box { background: var(--el-fill-color-lighter, #f9fafb); border: 1px solid var(--el-border-color-lighter, #e5e7eb); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 12px; }
.preview-field { display: flex; gap: 6px; margin-bottom: 4px; line-height: 1.4; }
.field-label { color: var(--el-text-color-secondary, #6b7280); flex-shrink: 0; min-width: 48px; }
.field-val { color: var(--el-text-color-primary, #1f2937); word-break: break-all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-val.bold { font-weight: 600; }
.preview-snippet { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--el-border-color-lighter, #e5e7eb); color: var(--el-text-color-regular, #4b5563); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.confirm-info .tag-row { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 6px; }
.confirm-info .badge { background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-weight: 600; color: #1f2937; }
.warn-badge { background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
.tool-confirm pre { font-size: 11px; background: #f8f8f8; padding: 6px; border-radius: 4px; max-height: 100px; overflow: auto; }
.warn { color: #b91c1c; font-size: 12px; margin: 6px 0 0; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.actions button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.15s, background-color 0.15s; }
.actions button:disabled { opacity: 0.55; cursor: not-allowed; }
.actions .confirm { background: #22c55e; color: white; border-color: #16a34a; }
.actions .confirm:hover:not(:disabled) { background: #16a34a; }
.actions .confirm.danger { background: #ef4444; border-color: #dc2626; }
.actions .confirm.danger:hover:not(:disabled) { background: #dc2626; }
.actions .cancel { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
.actions .cancel:hover:not(:disabled) { background: #e5e7eb; }

.spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.preview-status .spinner-small {
  border-color: rgba(107, 114, 128, 0.3);
  border-top-color: #4b5563;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
