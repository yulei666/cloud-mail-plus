<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({ tool: { type: Object, required: true } });
const emit = defineEmits(['decision']);
const { t } = useI18n();

const toolName = computed(() =>
  props.tool?.toolName ||
  (typeof props.tool?.type === 'string' && props.tool.type.startsWith('tool-')
    ? props.tool.type.slice(5)
    : '')
);
const args = computed(() => props.tool?.args ?? props.tool?.input ?? {});

const title = computed(() =>
  toolName.value === 'sendDraft'
    ? '📤 ' + t('aiAgentConfirmSend')
    : '🗑 ' + t('aiAgentConfirmDelete')
);
const danger = computed(() => toolName.value === 'deleteEmail' && args.value?.permanent);

function decide(accepted) {
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
      <div v-if="toolName === 'sendDraft'" class="confirm-info">
        <p class="desc">{{ $t('aiAgentConfirmSendDesc', { id: args.draftId }) }}</p>
        <div class="tag-row">
          <span class="label">{{ $t('aiAgentDraftId') }}:</span>
          <span class="badge">#{{ args.draftId }}</span>
        </div>
      </div>
      <div v-else-if="toolName === 'deleteEmail'" class="confirm-info">
        <p class="desc">{{ $t('aiAgentConfirmDeleteDesc', { id: args.emailId }) }}</p>
        <div class="tag-row">
          <span class="label">{{ $t('aiAgentEmailId') }}:</span>
          <span class="badge">#{{ args.emailId }}</span>
        </div>
      </div>
      <pre v-else>{{ JSON.stringify(args, null, 2) }}</pre>
      <p v-if="danger" class="warn">⚠ {{ $t('aiAgentPermanentWarn') }}</p>
      <div class="actions">
        <button class="cancel" @click="decide(false)">{{ $t('aiAgentCancel') }}</button>
        <button class="confirm" :class="{ danger }" @click="decide(true)">
          {{ toolName === 'sendDraft' ? $t('aiAgentSend') : $t('aiAgentConfirmDelete') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-confirm { padding: 12px; border-top: 1px solid #eee; background: #fffaf0; }
.tool-confirm-card { padding: 12px; border-radius: 6px; background: #fff; border: 1px solid #ffd699; }
.tool-confirm-card.danger { border-color: #f87171; }
.tool-confirm h3 { margin: 0 0 8px; font-size: 14px; }
.confirm-info { margin: 6px 0; }
.confirm-info .desc { font-size: 13px; color: #4b5563; margin: 0 0 6px; }
.confirm-info .tag-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.confirm-info .badge { background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-weight: 600; color: #1f2937; }
.tool-confirm pre { font-size: 11px; background: #f8f8f8; padding: 6px; border-radius: 4px; max-height: 100px; overflow: auto; }
.warn { color: #b91c1c; font-size: 12px; margin: 6px 0 0; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.actions button { padding: 6px 14px; border-radius: 4px; border: 1px solid #ddd; cursor: pointer; }
.actions .confirm { background: #4ade80; color: white; border-color: #16a34a; }
.actions .confirm.danger { background: #ef4444; border-color: #b91c1c; }
.actions .cancel { background: #f3f4f6; }
</style>
