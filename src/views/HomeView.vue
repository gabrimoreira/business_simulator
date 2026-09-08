<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatMoneyCompact } from '@/lib/format'

const game = useGameStore()
const player = computed(() => game.state?.player ?? null)

const vitals = computed(() => {
  const p = player.value
  if (!p) return []
  return [
    { label: 'Energia', value: p.energy, color: 'bg-accent' },
    { label: 'Saúde', value: p.health, color: 'bg-up' },
    { label: 'Humor', value: p.mood, color: 'bg-warn' },
    { label: 'Fome', value: p.hunger, color: 'bg-down' },
  ]
})
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Início" :subtitle="player ? `Olá, ${player.name}` : ''" />

    <section class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <p class="text-xs uppercase tracking-wide text-muted">Patrimônio líquido</p>
        <p class="tnum mt-1 text-2xl font-semibold text-accent">
          {{ formatMoneyCompact(game.playerNetWorth) }}
        </p>

        <dl class="mt-4 grid grid-cols-2 gap-3">
          <div v-for="vital in vitals" :key="vital.label">
            <div class="flex items-baseline justify-between">
              <dt class="text-xs text-muted">{{ vital.label }}</dt>
              <dd class="tnum text-xs text-muted">{{ Math.round(vital.value) }}</dd>
            </div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                class="h-full rounded-full"
                :class="vital.color"
                :style="{ width: `${Math.max(0, Math.min(100, vital.value))}%` }"
              />
            </div>
          </div>
        </dl>
      </div>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Manchetes</h2>
      <EmptyState
        title="O mundo ainda não se moveu"
        description="Este é o feed de notícias: é por aqui que você vai descobrir escândalos, resultados trimestrais e rumores que movem preços antes de virarem fato."
        phase="Fase 4"
      />
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Ações do dia</h2>
      <EmptyState
        title="Nenhuma ação disponível"
        description="Trabalhar, estudar, academia, lazer e socializar entram com os blocos de ação, junto do relógio que faz o tempo passar."
        phase="Fase 1"
      />
    </section>
  </div>
</template>
