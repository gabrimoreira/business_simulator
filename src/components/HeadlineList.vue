<script setup lang="ts">
import { computed } from 'vue'
import type { Headline } from '@/engine/types'
import { useGameStore } from '@/stores/game'

const props = defineProps<{ headlines: Headline[]; limit?: number }>()

const game = useGameStore()

const items = computed(() =>
  [...props.headlines]
    .reverse()
    .slice(0, props.limit ?? 12)
    .map((headline) => ({
      headline,
      outlet: game.state?.news.outlets[headline.outletId]?.name ?? headline.outletId,
      age: (game.state?.date.dayIndex ?? 0) - headline.dayIndex,
    })),
)

function ageLabel(age: number): string {
  if (age <= 0) return 'hoje'
  if (age === 1) return 'ontem'
  return `há ${age} dias`
}
</script>

<template>
  <ul class="flex flex-col gap-2">
    <li
      v-for="item in items"
      :key="item.headline.id"
      class="rounded-xl border border-line bg-surface p-3"
      :class="{
        'border-l-2 border-l-down': item.headline.sentiment <= -0.4,
        'border-l-2 border-l-up': item.headline.sentiment >= 0.4,
      }"
    >
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-[11px] uppercase tracking-wide text-muted">{{ item.outlet }}</p>
        <p class="shrink-0 text-[11px] text-muted">{{ ageLabel(item.age) }}</p>
      </div>
      <p class="mt-0.5 text-sm leading-snug">{{ item.headline.text }}</p>
      <p v-if="item.headline.isRumor" class="mt-1 text-[11px] text-warn">
        Rumor · {{ Math.round(item.headline.accuracy * 100) }}% de acerto histórico deste veículo
      </p>
    </li>
  </ul>
</template>
