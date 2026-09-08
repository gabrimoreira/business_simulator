<script setup lang="ts">
/** Placeholder honesto: diz o que a tela vai ser e em que fase ela chega. */
defineProps<{ title: string; description: string; phase: string }>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-10 text-center">
    <div class="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
      <svg
        class="h-5 w-5 text-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
      >
        <path d="M12 8v5M12 16.5v.5" />
        <circle cx="12" cy="12" r="8.5" />
      </svg>
    </div>
    <h2 class="text-base font-semibold">{{ title }}</h2>
    <p class="max-w-[34ch] text-sm leading-relaxed text-muted">{{ description }}</p>
    <span class="rounded-full border border-line px-2.5 py-1 text-[11px] uppercase tracking-wide text-muted">
      {{ phase }}
    </span>
  </div>
</template>
