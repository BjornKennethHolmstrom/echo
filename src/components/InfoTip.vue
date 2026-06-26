<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

defineProps({ label: { type: String, default: 'Explanation' } });

const open = ref(false);
const root = ref(null);

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <span class="infotip" ref="root">
    <button
      type="button"
      class="dot"
      :aria-label="label"
      @click.stop="open = !open"
      @keydown.escape="open = false"
    >?</button>
    <span v-if="open" class="bubble" role="tooltip"><slot /></span>
  </span>
</template>

<style scoped>
.infotip { position: relative; display: inline-flex; vertical-align: middle; }
.dot {
  width: 1.15em; height: 1.15em; line-height: 1; padding: 0; margin-left: 0.35em;
  border-radius: 50%; border: 1px solid #b8b8b8; background: #fff; color: #666;
  font-size: 0.72rem; cursor: pointer;
}
.dot:hover { border-color: #666; color: #222; }
.bubble {
  position: absolute; z-index: 30; top: 1.5em; left: 0;
  width: 17rem; max-width: 72vw; padding: 0.6rem 0.7rem;
  background: #1c1c1c; color: #f3f3f3;
  font-size: 0.8rem; font-weight: 400; line-height: 1.45; text-align: left;
  border-radius: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
</style>
