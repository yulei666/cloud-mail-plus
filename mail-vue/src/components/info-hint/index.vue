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
import { useMediaQuery } from '@vueuse/core';

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

const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
const computedTrigger = computed(() => props.trigger || (canHover.value ? 'hover' : 'click'));
</script>
