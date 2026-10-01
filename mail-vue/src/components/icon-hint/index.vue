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
import { useMediaQuery } from '@vueuse/core';

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

const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
</script>

<style>
@media (hover: none) and (pointer: coarse) {
  .icon-hint-popper {
    display: none !important;
  }
}
</style>
