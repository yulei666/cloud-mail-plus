import { useMediaQuery } from '@vueuse/core';

export const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
