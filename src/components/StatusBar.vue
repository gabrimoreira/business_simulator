<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatGameDate, formatMoneyCompact } from '@/lib/format'
import { ACTION_BLOCKS_PER_DAY } from '@/data/config'
import { useFlash } from '@/ui/useFlash'
import { nextMoneyEvent } from '@/engine/selectors'

const game = useGameStore()

const date = computed(() => (game.state ? formatGameDate(game.state.date) : '—'))
const age = computed(() => game.state?.player.age ?? 0)
const money = computed(() => formatMoneyCompact(game.state?.player.money ?? 0))
const blocks = computed(() => game.blocksLeft)

// O caixa é o número que o jogador olha o tempo todo. Piscar na direção da
// mudança é o que faz salário, conta e compra serem percebidos sem abrir o log.
const cashFlash = useFlash(() => game.state?.player.money ?? 0, 0.005)

/**
 * "em caixa" não dizia nada que o número já não dissesse. No lugar, o próximo
 * evento de dinheiro: é aqui que o jogador olha quando o caixa cai sozinho no
 * dia 10.
 */
const moneyEvent = computed(() => {
  if (!game.state) return 'em caixa'
  const next = nextMoneyEvent(game.state)
  return next.days === 0 ? `${next.label} hoje` : `${next.label} em ${next.days} d`
})
</script>

<template>
  <header
    class="border-b border-line bg-surface/95 backdrop-blur-sm"
    style="padding-top: env(safe-area-inset-top, 0px)"
  >
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0">
        <p class="tnum text-sm font-medium leading-tight">{{ date }}</p>
        <p class="text-[11px] leading-tight text-muted">{{ age }} anos</p>
      </div>

      <div class="flex items-center gap-3">
        <div class="text-right">
          <p class="tnum text-sm font-semibold leading-tight text-accent" :class="cashFlash">
            {{ money }}
          </p>
          <p class="text-[11px] leading-tight text-muted">
            {{ moneyEvent }}
          </p>
        </div>
        <div class="flex items-center gap-1" :aria-label="`${blocks} blocos de ação restantes`">
          <span
            v-for="index in ACTION_BLOCKS_PER_DAY"
            :key="index"
            class="pip h-5 w-1.5 rounded-full"
            :class="index <= blocks ? 'bg-accent' : 'pip-gasto bg-line'"
          />
        </div>
      </div>
    </div>
  </header>
</template>
