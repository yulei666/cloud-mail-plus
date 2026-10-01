<template>
  <el-tooltip
    v-bind="$attrs"
    :disabled="!canHover || disabled"
    :popper-class="['icon-hint-popper', popperClass].filter(Boolean).join(' ')"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </el-tooltip>
</template>

<script setup>
import { canHover } from '@/utils/device-utils';

defineOptions({
  inheritAttrs: false,
});

defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  popperClass: {
    type: String,
    default: '',
  },
});
</script>

<style>
@media (hover: none) and (pointer: coarse) {
  .icon-hint-popper {
    display: none !important;
  }
}
</style>
