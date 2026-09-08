<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="px-4 pb-1 pt-4">
    <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>
    <p v-if="subtitle" class="mt-0.5 text-sm text-muted">{{ subtitle }}</p>
  </div>
</template>
