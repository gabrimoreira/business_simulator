<script setup lang="ts">
import { computed, ref } from 'vue'
import StockChart from '@/components/StockChart.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatPercent } from '@/lib/format'
import { fairValue, slippageFor, brokerage } from '@/engine/market'
import { CONTROL_LABEL, controlLevelFor, referencePrice, stakeOf } from '@/engine/ownership'
import { findIndustry } from '@/data/industries'
import { CONTROL } from '@/data/config'

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

/** Participação e o poder que ela destrava (spec §5.6). */
const control = computed(() => {
  const c = company.value
  if (!c) return null
  const stake = stakeOf(c, 'player')
  return { stake, level: controlLevelFor(stake), label: CONTROL_LABEL[controlLevelFor(stake)] }
})

const openTender = computed(
  () => game.state?.tenders.find((t) => t.companyId === props.companyId && t.status === 'aberta') ?? null,
)

const premium = ref(30)

/** Custo estimado de comprar tudo que não é seu, pelo prêmio escolhido. */
const tenderCost = computed(() => {
  const c = company.value
  if (!c) return null
  const shares = c.ownership
    .filter((entry) => entry.holderId !== 'player')
    .reduce((sum, entry) => sum + entry.shares, 0)
  const price = referencePrice(c) * (1 + premium.value / 100)
  return { shares, total: shares * price, price }
})

function launchTender(): void {
  const cost = tenderCost.value
  if (!cost) return
  game.dispatch({
    kind: 'lancarOpa',
    companyId: props.companyId,
    premium: premium.value / 100,
    sharesSought: cost.shares,
  })
}

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
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-black/70" @click.self="emit('close')">
    <div
      v-if="company && stock"
      class="sheet-panel max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5"
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

      <div v-if="control && control.stake > 0" class="mt-3 rounded-xl border border-line p-3">
        <div class="flex items-baseline justify-between">
          <p class="text-xs text-muted">Sua participação</p>
          <p class="tnum text-sm font-semibold text-accent">
            {{ formatPercent(control.stake, 1) }}
          </p>
        </div>
        <p class="mt-0.5 text-[11px] text-warn">{{ control.label }}</p>

        <div v-if="control.level === 'fechamento'" class="mt-2">
          <button
            class="min-h-[40px] w-full rounded-lg border border-accent/50 text-sm text-accent"
            @click="game.dispatch({ kind: 'fecharCapital', companyId: props.companyId })"
          >
            Fechar o capital
          </button>
        </div>
      </div>

      <div class="mt-3 rounded-xl border border-line p-3">
        <p v-if="openTender" class="text-xs text-warn">
          Oferta aberta com prêmio de {{ formatPercent(openTender.premium, 0) }} — decide em
          {{ openTender.expiresDayIndex - (game.state?.date.dayIndex ?? 0) }} dias.
        </p>
        <template v-else>
          <div class="flex items-baseline justify-between">
            <p class="text-xs text-muted">Oferta pública (OPA)</p>
            <p class="tnum text-xs">prêmio {{ premium }}%</p>
          </div>
          <input
            v-model.number="premium"
            class="mt-2 w-full"
            type="range"
            :min="CONTROL.minPremium * 100"
            max="120"
            step="5"
          />
          <p v-if="tenderCost" class="tnum text-[11px] text-muted">
            {{ formatPercent(tenderCost.shares / (stock.sharesOutstanding || 1), 0) }} do capital por
            {{ formatMoney(tenderCost.total) }}
          </p>
          <button
            class="mt-2 min-h-[40px] w-full rounded-lg border border-line text-sm disabled:opacity-30"
            :disabled="!tenderCost || tenderCost.total > (game.state?.player.money ?? 0)"
            @click="launchTender"
          >
            Lançar oferta
          </button>
        </template>
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
