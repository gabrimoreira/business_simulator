<script setup lang="ts">
import { computed, ref } from 'vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import StockSheet from '@/components/StockSheet.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatMoneyCompact, formatPercent } from '@/lib/format'
import { portfolioValue } from '@/engine/selectors'
import { INDUSTRIES } from '@/data/industries'

const game = useGameStore()
const macro = computed(() => game.state?.macro ?? null)
const selected = ref<string | null>(null)

interface Row {
  id: string
  name: string
  industryId: string
  price: number
  change: number
  shares: number
}

const rows = computed<Row[]>(() => {
  const state = game.state
  if (!state) return []
  return state.companyOrder.flatMap((id) => {
    const company = state.companies[id]
    const stock = company?.stock
    if (!company || !stock) return []
    const previous = stock.history[stock.history.length - 1]?.open ?? stock.price
    return [
      {
        id,
        name: company.name,
        industryId: company.industryId,
        price: stock.price,
        change: previous > 0 ? stock.price / previous - 1 : 0,
        shares: state.market.positions[id]?.shares ?? 0,
      },
    ]
  })
})

const bySector = computed(() =>
  INDUSTRIES.map((industry) => ({
    industry,
    rows: rows.value.filter((row) => row.industryId === industry.id),
  })).filter((group) => group.rows.length > 0),
)

const portfolio = computed(() => (game.state ? portfolioValue(game.state) : 0))

const indexChange = computed(() => {
  const history = macro.value?.marketIndexHistory ?? []
  const previous = history[history.length - 2]?.close
  if (!previous || !macro.value) return 0
  return macro.value.marketIndex / previous - 1
})

const openOrders = computed(() => game.state?.market.orders ?? [])
const taxDebts = computed(() => game.state?.market.taxDebts ?? [])

function nameOf(companyId: string): string {
  return game.state?.companies[companyId]?.name ?? companyId
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Mercado" subtitle="Índice, ativos e carteira" />

    <section v-if="macro" class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <div class="flex items-end justify-between">
          <div>
            <p class="text-xs uppercase tracking-wide text-muted">Índice</p>
            <p class="tnum text-2xl font-semibold">{{ macro.marketIndex.toFixed(1) }}</p>
          </div>
          <p class="tnum text-sm font-semibold" :class="indexChange >= 0 ? 'text-up' : 'text-down'">
            {{ indexChange >= 0 ? '+' : '' }}{{ formatPercent(indexChange, 2) }}
          </p>
        </div>
        <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt class="text-muted">Selic</dt>
            <dd class="tnum">{{ formatPercent(macro.selic, 2) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Inflação</dt>
            <dd class="tnum">{{ formatPercent(macro.inflation, 1) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Carteira</dt>
            <dd class="tnum text-accent">{{ formatMoneyCompact(portfolio) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section v-if="taxDebts.length" class="px-4 pt-3">
      <div
        v-for="debt in taxDebts"
        :key="debt.id"
        class="flex items-center justify-between gap-3 rounded-xl border border-down/40 bg-surface p-3"
      >
        <div>
          <p class="text-sm font-medium text-down">Imposto pendente</p>
          <p class="tnum text-xs text-muted">
            {{ formatMoney(debt.amount + debt.penalty) }} com multa
          </p>
        </div>
        <button
          class="min-h-[40px] shrink-0 rounded-lg border border-line px-3 text-sm"
          @click="game.dispatch({ kind: 'pagarImposto', debtId: debt.id })"
        >
          Pagar
        </button>
      </div>
    </section>

    <section v-if="openOrders.length" class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Ordens em livro</h2>
      <div class="flex flex-col gap-2">
        <div
          v-for="order in openOrders"
          :key="order.id"
          class="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ nameOf(order.companyId) }}</p>
            <p class="tnum text-xs text-muted">
              {{ order.side }} {{ order.shares }} a {{ formatMoney(order.limitPrice ?? 0) }}
            </p>
          </div>
          <button
            class="min-h-[40px] shrink-0 rounded-lg border border-line px-3 text-sm text-muted"
            @click="game.dispatch({ kind: 'cancelarOrdem', orderId: order.id })"
          >
            Cancelar
          </button>
        </div>
      </div>
    </section>

    <section v-for="group in bySector" :key="group.industry.id" class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">{{ group.industry.name }}</h2>
      <div class="overflow-hidden rounded-2xl border border-line bg-surface">
        <button
          v-for="row in group.rows"
          :key="row.id"
          class="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left last:border-b-0"
          @click="selected = row.id"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ row.name }}</p>
            <p v-if="row.shares > 0" class="tnum text-[11px] text-accent">
              {{ row.shares }} em carteira
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="tnum text-sm">{{ formatMoney(row.price) }}</p>
            <p class="tnum text-[11px]" :class="row.change >= 0 ? 'text-up' : 'text-down'">
              {{ row.change >= 0 ? '+' : '' }}{{ formatPercent(row.change, 2) }}
            </p>
          </div>
        </button>
      </div>
    </section>

    <StockSheet v-if="selected" :company-id="selected" @close="selected = null" />
  </div>
</template>
