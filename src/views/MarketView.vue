<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatPercent } from '@/lib/format'

const game = useGameStore()
const macro = computed(() => game.state?.macro ?? null)
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Mercado" subtitle="Índice, ativos, ordens e carteira" />

    <section v-if="macro" class="px-4 pt-3">
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-xl border border-line bg-surface px-3 py-2.5">
          <p class="text-[11px] text-muted">Ciclo</p>
          <p class="text-base font-semibold capitalize">{{ macro.cyclePhase }}</p>
        </div>
        <div class="rounded-xl border border-line bg-surface px-3 py-2.5">
          <p class="text-[11px] text-muted">Selic</p>
          <p class="tnum text-base font-semibold">{{ formatPercent(macro.selic, 2) }}</p>
        </div>
        <div class="rounded-xl border border-line bg-surface px-3 py-2.5">
          <p class="text-[11px] text-muted">Inflação</p>
          <p class="tnum text-base font-semibold">{{ formatPercent(macro.inflation, 1) }}</p>
        </div>
      </div>
    </section>

    <section class="px-4 pt-4">
      <EmptyState
        title="Bolsa fechada"
        description="28 empresas em 7 setores, gráfico de candle com pan e zoom, ordens a mercado e limite, carteira com preço médio e dividendos trimestrais."
        phase="Fase 3"
      />
    </section>
  </div>
</template>
