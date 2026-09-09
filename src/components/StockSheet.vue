<script setup lang="ts">
import { computed, ref } from 'vue'
import StockChart from '@/components/StockChart.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatPercent } from '@/lib/format'
import { fairValue, slippageFor, brokerage } from '@/engine/market'
import { findIndustry } from '@/data/industries'

const props = defineProps<{ companyId: string }>()
const emit = defineEmits<{ close: [] }>()

const game = useGameStore()
const shares = ref<number | null>(null)
const limit = ref<number | null>(null)

const company = computed(() => game.state?.companies[props.companyId] ?? null)
const stock = computed(() => company.value?.stock ?? null)
const position = computed(() => game.state?.market.positions[props.companyId] ?? null)
const industry = computed(() =>
  company.value ? findIndustry(company.value.industryId)?.name : null,
)

const fair = computed(() =>
  game.state && company.value ? fairValue(game.state, company.value) : 0,
)

/** Preço estimado da ordem, já com o deslizamento da quantidade pedida. */
const estimate = computed(() => {
  const quantity = shares.value ?? 0
  if (!stock.value || quantity <= 0) return null
  const slip = slippageFor(stock.value, quantity)
  const price = stock.value.price * (1 + slip)
  const notional = price * quantity
  return { price, slip, total: notional + brokerage(notional) }
})

const pnl = computed(() => {
  if (!position.value || !stock.value || position.value.shares <= 0) return null
  const value = position.value.shares * stock.value.price
  const cost = position.value.shares * position.value.avgPrice
  return { value, absolute: value - cost, percent: cost > 0 ? value / cost - 1 : 0 }
})

function trade(kind: 'comprarAcao' | 'venderAcao'): void {
  const quantity = shares.value
  if (!quantity || quantity <= 0) return
  game.dispatch({
    kind,
    companyId: props.companyId,
    shares: Math.floor(quantity),
    limitPrice: limit.value && limit.value > 0 ? limit.value : null,
  })
  shares.value = null
  limit.value = null
  navigator.vibrate?.(18)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-black/70" @click.self="emit('close')">
    <div
      v-if="company && stock"
      class="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5"
      style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.25rem)"
    >
      <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold">{{ company.name }}</h2>
          <p class="text-xs text-muted">{{ industry }}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="tnum text-lg font-semibold">{{ formatMoney(stock.price) }}</p>
          <p class="tnum text-[11px] text-muted">justo {{ formatMoney(fair) }}</p>
        </div>
      </div>

      <div class="mt-3">
        <StockChart :candles="stock.history" />
      </div>

      <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt class="text-muted">Dividendo</dt>
          <dd class="tnum">{{ formatPercent(stock.dividendYieldTarget, 1) }}</dd>
        </div>
        <div>
          <dt class="text-muted">Beta</dt>
          <dd class="tnum">{{ stock.beta.toFixed(2) }}</dd>
        </div>
        <div>
          <dt class="text-muted">Situação</dt>
          <dd class="capitalize">{{ company.status === 'ativa' ? 'normal' : company.status }}</dd>
        </div>
      </dl>

      <div v-if="pnl" class="mt-3 rounded-xl bg-surface-2 p-3">
        <div class="flex items-baseline justify-between">
          <p class="text-xs text-muted">
            {{ position?.shares }} ações · médio {{ formatMoney(position?.avgPrice ?? 0) }}
          </p>
          <p class="tnum text-sm font-semibold" :class="pnl.absolute >= 0 ? 'text-up' : 'text-down'">
            {{ formatMoney(pnl.absolute) }} ({{ formatPercent(pnl.percent, 1) }})
          </p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <input
          v-model.number="shares"
          class="selectable min-h-[44px] rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
          type="number"
          inputmode="numeric"
          min="1"
          placeholder="Quantidade"
        />
        <input
          v-model.number="limit"
          class="selectable min-h-[44px] rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
          type="number"
          inputmode="decimal"
          min="0"
          placeholder="Limite (opcional)"
        />
      </div>

      <p v-if="estimate" class="tnum mt-2 text-[11px] text-muted">
        A mercado sai a {{ formatMoney(estimate.price) }} ({{ formatPercent(estimate.slip, 2) }} de
        deslizamento) · total {{ formatMoney(estimate.total) }}
      </p>

      <div class="mt-3 grid grid-cols-2 gap-2">
        <button
          class="min-h-[48px] rounded-xl bg-accent text-base font-semibold text-bg disabled:opacity-30"
          :disabled="!shares"
          @click="trade('comprarAcao')"
        >
          Comprar
        </button>
        <button
          class="min-h-[48px] rounded-xl border border-line text-base font-semibold disabled:opacity-30"
          :disabled="!shares || !position || position.shares <= 0"
          @click="trade('venderAcao')"
        >
          Vender
        </button>
      </div>

      <button class="mt-3 min-h-[44px] w-full rounded-xl text-sm text-muted" @click="emit('close')">
        Fechar
      </button>
    </div>
  </div>
</template>
