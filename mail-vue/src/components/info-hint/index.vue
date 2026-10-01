<template>
  <el-tooltip
    v-bind="$attrs"
    :trigger="computedTrigger"
    :popper-class="['info-hint-popper', popperClass].filter(Boolean).join(' ')"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </el-tooltip>
</template>

<script setup>
import { computed } from 'vue';
import { canHover } from '@/utils/device-utils';

defineOptions({
  inheritAttrs: false,
});

const props = defineProps({
  popperClass: {
    type: String,
    default: '',
  },
  trigger: {
    type: [String, Array],
    default: undefined,
  },
});

const computedTrigger = computed(() => props.trigger || (canHover.value ? 'hover' : 'click'));
</script>
