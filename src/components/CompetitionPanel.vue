<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatMoneyCompact, formatPercent } from '@/lib/format'
import { INDUSTRIES } from '@/data/industries'

const game = useGameStore()

/**
 * Tudo aqui sai do `PublicView`, não do estado real: o jogador vê o que o
 * mercado divulgou, com o atraso de até um trimestre da Regra 2. Preço é
 * público em tempo real; balanço não.
 */
const sectors = computed(() => {
  const state = game.state
  if (!state) return []
  const view = state.publicView

  return INDUSTRIES.map((industry) => {
    const ids = state.industries[industry.id]?.companyOrder ?? []
    const rows = ids.flatMap((id) => {
      const published = view.companies[id]
      const company = state.companies[id]
      if (!published || !company) return []
      return [
        {
          id,
          name: company.name,
          price: company.price,
          isMine: company.managedBy === 'player',
          share: published.marketShare,
          revenue: published.revenue,
          profit: published.profit,
          ageDays: state.date.dayIndex - published.asOfDayIndex,
          // Últimas jogadas conhecidas: as manchetes que a decisão gerou.
          moves: state.news.headlines
            .filter((headline) => headline.eventId?.startsWith(`ai-${id}-`))
            .slice(-2)
            .reverse(),
        },
      ]
    })
    return { industry, rows: rows.sort((a, b) => b.share - a.share) }
  }).filter((group) => group.rows.length > 0)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-for="group in sectors" :key="group.industry.id">
      <h3 class="pb-1 text-xs uppercase tracking-wide text-muted">{{ group.industry.name }}</h3>
      <div class="overflow-hidden rounded-2xl border border-line bg-surface">
        <div
          v-for="row in group.rows"
          :key="row.id"
          class="border-b border-line px-4 py-3 last:border-b-0"
          :class="row.isMine ? 'bg-accent/5' : ''"
        >
          <div class="flex items-baseline justify-between gap-3">
            <p class="truncate text-sm font-medium" :class="row.isMine ? 'text-accent' : ''">
              {{ row.name }}
            </p>
            <p class="tnum shrink-0 text-sm">{{ formatPercent(row.share, 1) }}</p>
          </div>
          <p class="tnum text-[11px] text-muted">
            preço {{ row.price.toFixed(2) }} · receita {{ formatMoneyCompact(row.revenue) }} · lucro
            <span :class="row.profit >= 0 ? 'text-up' : 'text-down'">
              {{ formatMoneyCompact(row.profit) }}
            </span>
          </p>
          <p class="text-[11px] text-warn">
            {{ row.ageDays <= 0 ? 'divulgado hoje' : `dados de ${row.ageDays} dias atrás` }}
          </p>
          <p
            v-for="move in row.moves"
            :key="move.id"
            class="mt-1 truncate text-[11px] text-muted"
          >
            › {{ move.text }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
