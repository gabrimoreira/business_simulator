<script setup lang="ts">
import { computed, ref } from 'vue'
import CompetitionPanel from '@/components/CompetitionPanel.vue'
import EmptyState from '@/components/EmptyState.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatMoneyCompact, formatPercent } from '@/lib/format'
import { annualizedProfit, capacityOf, valuationOf } from '@/engine/companies'
import { sectorMultiple } from '@/engine/market'
import { INDUSTRIES, findIndustry } from '@/data/industries'
import { CONTROL, OPERATIONS } from '@/data/config'

const game = useGameStore()

const owned = computed(() => {
  const state = game.state
  if (!state) return []
  return state.companyOrder
    .map((id) => state.companies[id])
    .filter((company) => company?.managedBy === 'player')
    .map((company) => {
      const industry = findIndustry(company!.industryId)!
      const multiple = sectorMultiple(industry.multipleBase, state.macro.selic)
      const labor =
        company!.workforce.headcount * industry.outputPerEmployee * (company!.workforce.productivity / 100)
      const capital = company!.capitalStock * industry.capitalTurnover
      return {
        company: company!,
        industry,
        valuation: valuationOf(company!, multiple),
        capacity: capacityOf(company!, industry),
        // Qual dos dois está segurando a produção: gente ou máquina.
        bottleneck: capital < labor ? 'capital' : 'pessoas',
        // Elegibilidade a IPO: quatro trimestres divulgados e os pisos do §5.6.
        canIpo:
          company!.quartersReported >= CONTROL.ipoMinQuarters &&
          company!.revenue >= CONTROL.ipoMinAnnualRevenue * state.macro.priceLevel &&
          annualizedProfit(company!) >= CONTROL.ipoMinAnnualProfit * state.macro.priceLevel,
        laborCapacity: labor,
        capitalCapacity: capital,
      }
    })
})

const showRivals = ref(false)

// --- fundação --------------------------------------------------------------
const founding = ref(false)
const name = ref('')
const industryId = ref(INDUSTRIES[0]!.id)
const capital = ref<number | null>(null)

const minCapital = computed(() =>
  Math.round(OPERATIONS.minFoundingCapital * (game.state?.macro.priceLevel ?? 1)),
)

function found(): void {
  if (!name.value.trim() || !capital.value) return
  game.dispatch({
    kind: 'fundarEmpresa',
    name: name.value.trim(),
    industryId: industryId.value,
    capital: capital.value,
  })
  name.value = ''
  capital.value = null
  founding.value = false
  navigator.vibrate?.(20)
}

// --- gestão ----------------------------------------------------------------
const amount = ref<number | null>(null)

function adjustPrice(companyId: string, delta: number): void {
  const company = game.state?.companies[companyId]
  if (!company) return
  game.dispatch({ kind: 'ajustarPreco', companyId, price: company.price + delta })
}

function adjustRatio(companyId: string, kind: 'ajustarMarketing' | 'investirPeD', delta: number): void {
  const company = game.state?.companies[companyId]
  if (!company) return
  const current = kind === 'ajustarMarketing' ? company.directives.marketingRatio : company.directives.rndRatio
  game.dispatch({ kind, companyId, ratio: Math.max(0, current + delta) })
}

/** IPO: preço de abertura derivado do valuation, float mínimo do §5.6. */
function openCapital(companyId: string, valuation: number): void {
  const company = game.state?.companies[companyId]
  if (!company) return
  const shares = company.ownership.reduce((sum, entry) => sum + entry.shares, 0) || 1_000_000
  game.dispatch({
    kind: 'abrirCapital',
    companyId,
    bankId: 'meridiano',
    floatPct: 0.3,
    pricePerShare: Math.max(0.5, valuation / shares),
  })
  navigator.vibrate?.(30)
}

function hire(companyId: string, count: number): void {
  const company = game.state?.companies[companyId]
  const industry = company ? findIndustry(company.industryId) : null
  if (!company || !industry || !game.state) return
  const salary = industry.outputPerEmployee * industry.payrollRatio * game.state.macro.priceLevel
  game.dispatch({ kind: 'contratar', companyId, count, salary })
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Negócios" subtitle="Suas empresas e a concorrência" />

    <section v-for="item in owned" :key="item.company.id" class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-base font-semibold">{{ item.company.name }}</p>
            <p class="text-xs text-muted">
              {{ item.industry.name }} ·
              {{ item.company.isPublic ? 'listada' : 'fechada' }} ·
              {{ item.company.status === 'ativa' ? 'operando' : item.company.status }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="tnum text-sm font-semibold text-accent">
              {{ formatMoneyCompact(item.valuation) }}
            </p>
            <p class="text-[11px] text-muted">valuation</p>
          </div>
        </div>

        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Receita/ano</dt>
            <dd class="tnum">{{ formatMoneyCompact(item.company.revenue) }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Lucro/tri</dt>
            <dd class="tnum" :class="(item.company.profitHistory[0] ?? 0) >= 0 ? 'text-up' : 'text-down'">
              {{ formatMoneyCompact(item.company.profitHistory[0] ?? 0) }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Caixa</dt>
            <dd class="tnum" :class="item.company.cash >= 0 ? '' : 'text-down'">
              {{ formatMoneyCompact(item.company.cash) }}
            </dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Quadro</dt>
            <dd class="tnum">{{ Math.round(item.company.workforce.headcount) }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Qualidade</dt>
            <dd class="tnum">{{ Math.round(item.company.productQuality) }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Marca</dt>
            <dd class="tnum">{{ Math.round(item.company.brandAwareness) }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Moral</dt>
            <dd class="tnum">{{ Math.round(item.company.workforce.morale) }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="text-muted">Participação</dt>
            <dd class="tnum">{{ formatPercent(item.company.marketShare, 2) }}</dd>
          </div>
        </dl>

        <p class="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-muted">
          Capacidade limitada por <span class="text-warn">{{ item.bottleneck }}</span> ·
          máquina sustenta {{ formatMoneyCompact(item.capitalCapacity) }}, equipe
          {{ formatMoneyCompact(item.laborCapacity) }}
        </p>

        <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div class="rounded-lg border border-line p-2 text-center">
            <p class="text-muted">Preço</p>
            <p class="tnum py-1 text-sm">{{ item.company.price.toFixed(2) }}</p>
            <div class="flex gap-1">
              <button class="min-h-[32px] flex-1 rounded border border-line" @click="adjustPrice(item.company.id, -0.05)">−</button>
              <button class="min-h-[32px] flex-1 rounded border border-line" @click="adjustPrice(item.company.id, 0.05)">+</button>
            </div>
          </div>
          <div class="rounded-lg border border-line p-2 text-center">
            <p class="text-muted">Marketing</p>
            <p class="tnum py-1 text-sm">{{ formatPercent(item.company.directives.marketingRatio, 0) }}</p>
            <div class="flex gap-1">
              <button class="min-h-[32px] flex-1 rounded border border-line" @click="adjustRatio(item.company.id, 'ajustarMarketing', -0.01)">−</button>
              <button class="min-h-[32px] flex-1 rounded border border-line" @click="adjustRatio(item.company.id, 'ajustarMarketing', 0.01)">+</button>
            </div>
          </div>
          <div class="rounded-lg border border-line p-2 text-center">
            <p class="text-muted">P&D</p>
            <p class="tnum py-1 text-sm">{{ formatPercent(item.company.directives.rndRatio, 0) }}</p>
            <div class="flex gap-1">
              <button class="min-h-[32px] flex-1 rounded border border-line" @click="adjustRatio(item.company.id, 'investirPeD', -0.01)">−</button>
              <button class="min-h-[32px] flex-1 rounded border border-line" @click="adjustRatio(item.company.id, 'investirPeD', 0.01)">+</button>
            </div>
          </div>
        </div>

        <input
          v-model.number="amount"
          class="selectable mt-3 min-h-[44px] w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
          type="number"
          inputmode="decimal"
          min="0"
          placeholder="Valor para investir em capacidade"
        />
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button
            class="min-h-[44px] rounded-xl border border-line text-sm font-medium disabled:opacity-30"
            :disabled="!amount || amount > item.company.cash"
            @click="game.dispatch({ kind: 'expandirCapacidade', companyId: item.company.id, investment: amount ?? 0 })"
          >
            Ampliar capacidade
          </button>
          <button
            class="min-h-[44px] rounded-xl border border-line text-sm font-medium"
            @click="hire(item.company.id, 1)"
          >
            Contratar 1
          </button>
          <button
            class="min-h-[44px] rounded-xl border border-line text-sm text-muted"
            @click="game.dispatch({ kind: 'demissaoEmMassa', companyId: item.company.id, count: Math.max(1, Math.round(item.company.workforce.headcount * 0.1)) })"
          >
            Demitir 10%
          </button>
          <button
            v-if="!item.company.isPublic"
            class="min-h-[44px] rounded-xl border border-accent/50 text-sm font-medium text-accent"
            @click="game.dispatch({ kind: 'venderEmpresa', companyId: item.company.id })"
          >
            Vender empresa
          </button>
          <button
            v-if="!item.company.isPublic"
            class="min-h-[44px] rounded-xl border border-line text-sm font-medium disabled:opacity-30"
            :disabled="!item.canIpo"
            @click="openCapital(item.company.id, item.valuation)"
          >
            Abrir capital
          </button>
        </div>
      </div>
    </section>

    <section class="px-4 pt-4">
      <div v-if="!founding">
        <EmptyState
          v-if="owned.length === 0"
          title="Você não tem empresas"
          description="Fundar custa capital e um bloco de ação. O capital vira máquina: no começo é ele, e não a demanda, que limita quanto você consegue produzir."
          phase="funde a primeira"
        />
        <button
          class="mt-2 min-h-[48px] w-full rounded-xl bg-accent text-base font-semibold text-bg"
          @click="founding = true"
        >
          Fundar empresa
        </button>
      </div>

      <div v-else class="rounded-2xl border border-line bg-surface p-4">
        <h2 class="text-sm font-medium">Nova empresa</h2>
        <input
          v-model="name"
          class="selectable mt-3 min-h-[44px] w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
          type="text"
          maxlength="28"
          placeholder="Nome"
        />
        <select
          v-model="industryId"
          class="mt-2 min-h-[44px] w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
        >
          <option v-for="industry in INDUSTRIES" :key="industry.id" :value="industry.id">
            {{ industry.name }} · margem {{ formatPercent(industry.baseMargin, 0) }} · giro
            {{ industry.capitalTurnover.toFixed(1) }}×
          </option>
        </select>
        <input
          v-model.number="capital"
          class="selectable mt-2 min-h-[44px] w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
          type="number"
          inputmode="decimal"
          :min="minCapital"
          :placeholder="`Capital (mínimo ${formatMoney(minCapital)})`"
        />
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button
            class="min-h-[48px] rounded-xl bg-accent text-base font-semibold text-bg disabled:opacity-30"
            :disabled="!name.trim() || !capital || capital < minCapital"
            @click="found"
          >
            Fundar
          </button>
          <button class="min-h-[48px] rounded-xl border border-line text-sm" @click="founding = false">
            Cancelar
          </button>
        </div>
      </div>
    </section>

    <section class="px-4 pt-4">
      <div class="flex items-baseline justify-between pb-2">
        <h2 class="text-sm font-medium text-muted">Concorrência</h2>
        <button class="text-[11px] text-accent" @click="showRivals = !showRivals">
          {{ showRivals ? 'ocultar' : 'ver setores' }}
        </button>
      </div>
      <CompetitionPanel v-if="showRivals" />
      <p v-else class="px-1 text-[11px] text-muted">
        Balanço divulgado tem até um trimestre de atraso. Preço é público hoje.
      </p>
    </section>
  </div>
</template>
