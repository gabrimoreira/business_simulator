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
import type { ArchetypeId } from '@/engine/types'
import { stakeOf } from '@/engine/ownership'
import { statementFor } from '@/ui/companyStatement'

/** Prazo do crédito empresarial oferecido pelo botão: dez anos. */
const BUSINESS_LOAN_TERM_DAYS = 3650
/** Frações do caixa que cada botão de um toque compromete. */
const BUYBACK_CASH_SHARE = 0.25
const CAMPAIGN_CASH_SHARE = 0.1
const SHRINK_SHARE = 0.2
const DIVISION_SALE = 0.25

const game = useGameStore()

const owned = computed(() => {
  const state = game.state
  if (!state) return []
  return state.companyOrder
    .map((id) => state.companies[id])
    // Inclui as delegadas: continuam suas, só não consomem bloco.
    .filter(
      (company) =>
        company?.managedBy === 'player' ||
        (company && state.ai.agents[company.id]?.appointedByPlayer),
    )
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
        ceo: state.ai.agents[company!.id]?.appointedByPlayer
          ? (state.ai.profiles[state.ai.agents[company!.id]!.profileId]?.name ?? null)
          : null,
        // Elegibilidade a IPO: quatro trimestres divulgados e os pisos do §5.6.
        canIpo:
          company!.quartersReported >= CONTROL.ipoMinQuarters &&
          company!.revenue >= CONTROL.ipoMinAnnualRevenue * state.macro.priceLevel &&
          annualizedProfit(company!) >= CONTROL.ipoMinAnnualProfit * state.macro.priceLevel,
        laborCapacity: labor,
        capitalCapacity: capital,
        statement: statementFor(state, company!, industry),
      }
    })
})

const showRivals = ref(false)
const delegating = ref<string | null>(null)

const profiles = computed(() => Object.values(game.state?.ai.profiles ?? {}))

/** Delegação da resolução C2: o late game é nomear personalidades, não clicar. */
/** Quanto do caixa da empresa é seu, pela participação que você tem. */
function withdrawLimit(companyId: string): number {
  const state = game.state
  const company = state?.companies[companyId]
  if (!state || !company) return 0
  return Math.max(0, company.cash) * stakeOf(company, 'player')
}

function inject(companyId: string): void {
  if (!amount.value || amount.value <= 0) return
  game.dispatch({ kind: 'aportarCapital', companyId, amount: amount.value })
}

function withdraw(companyId: string): void {
  // Sem valor digitado, retira a fatia inteira que lhe cabe.
  const limit = withdrawLimit(companyId)
  const value = amount.value && amount.value > 0 ? Math.min(amount.value, limit) : limit
  if (value <= 0) return
  game.dispatch({ kind: 'retirarDaEmpresa', companyId, amount: value })
}

function takeBack(companyId: string): void {
  game.dispatch({ kind: 'assumirGestao', companyId })
}

function appoint(companyId: string, profileId: ArchetypeId): void {
  game.dispatch({ kind: 'nomearCeo', companyId, profileId })
  delegating.value = null
}

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
}

function hire(companyId: string, count: number): void {
  const company = game.state?.companies[companyId]
  const industry = company ? findIndustry(company.industryId) : null
  if (!company || !industry || !game.state) return
  const salary = industry.outputPerEmployee * industry.payrollRatio * game.state.macro.priceLevel
  game.dispatch({ kind: 'contratar', companyId, count, salary })
}

// --- caixa da empresa -----------------------------------------------------

/** Crédito empresarial: metade da receita menos a dívida (o motor confere). */
function creditRoom(companyId: string): number {
  const company = game.state?.companies[companyId]
  if (!company) return 0
  return Math.max(0, company.revenue * 0.5 - company.debt)
}

function borrow(companyId: string): void {
  const amount = creditRoom(companyId)
  if (amount <= 0) return
  game.dispatch({
    kind: 'emprestimoEmpresarial',
    companyId,
    bankId: 'meridiano',
    amount,
    termDays: BUSINESS_LOAN_TERM_DAYS,
  })
}

function setPayout(companyId: string, ratio: number): void {
  game.dispatch({ kind: 'pagarDividendos', companyId, ratio })
}

function buyBackShares(companyId: string): void {
  const company = game.state?.companies[companyId]
  if (!company) return
  game.dispatch({ kind: 'recomprarAcoes', companyId, amount: company.cash * BUYBACK_CASH_SHARE })
}

function advertise(companyId: string): void {
  const company = game.state?.companies[companyId]
  if (!company) return
  game.dispatch({ kind: 'anunciarProduto', companyId, spend: company.cash * CAMPAIGN_CASH_SHARE })
}

function shrink(companyId: string): void {
  const company = game.state?.companies[companyId]
  if (!company) return
  game.dispatch({
    kind: 'reduzirCapacidade',
    companyId,
    amount: company.capitalStock * SHRINK_SHARE,
  })
}

function fireOne(companyId: string): void {
  // O motor trata `demitir` como demissão de um; o id serve de registro.
  game.dispatch({ kind: 'demitir', companyId, employeeId: `emp@${companyId}` })
}

// --- M&A ------------------------------------------------------------------

/** Setores diferentes do atual, para diversificar. */
function otherIndustries(companyId: string) {
  const company = game.state?.companies[companyId]
  return INDUSTRIES.filter((industry) => industry.id !== company?.industryId)
}

/** Capital que o setor exige por funcionário — o piso que o motor cobra. */
function entryCost(industryId: string): number {
  const industry = findIndustry(industryId)
  return industry ? industry.outputPerEmployee / industry.capitalTurnover : 0
}

function enterSector(companyId: string, industryId: string): void {
  game.dispatch({
    kind: 'entrarEmSetor',
    companyId,
    industryId,
    investment: entryCost(industryId),
  })
}

function sellDivision(companyId: string): void {
  game.dispatch({ kind: 'venderDivisao', companyId, fraction: DIVISION_SALE })
}

/** Alvos de fusão: mesma indústria e já sob controle do jogador. */
function mergeTargets(companyId: string) {
  const state = game.state
  const acquirer = state?.companies[companyId]
  if (!state || !acquirer) return []
  return state.companyOrder
    .map((id) => state.companies[id])
    .filter(
      (target) =>
        target !== undefined &&
        target.id !== companyId &&
        target.industryId === acquirer.industryId &&
        stakeOf(target, 'player') > CONTROL.controlStake,
    )
}

function merge(acquirerId: string, targetId: string): void {
  game.dispatch({ kind: 'fundir', acquirerId, targetId, cash: 0 })
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
              <template v-if="item.ceo">· CEO {{ item.ceo }}</template>
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
        <!-- Para onde vai o dinheiro: a mesma conta que o motor faz todo dia. -->
        <details class="mt-3">
          <summary class="min-h-[44px] cursor-pointer list-none rounded-xl border border-line px-3 py-3 text-sm text-muted">
            De onde vem e para onde vai
          </summary>
          <div class="flex flex-col gap-1 pt-2">
            <div
              v-for="line in item.statement.lines"
              :key="line.label"
              class="flex items-baseline justify-between gap-3"
            >
              <span class="text-xs">
                {{ line.label }}
                <span v-if="line.hint" class="text-[11px] text-muted">· {{ line.hint }}</span>
              </span>
              <span class="tnum shrink-0 text-xs" :class="line.amount >= 0 ? 'text-up' : 'text-down'">
                {{ formatMoneyCompact(line.amount) }}
              </span>
            </div>
            <div class="mt-1 flex items-baseline justify-between border-t border-line pt-1">
              <span class="text-xs font-medium">Lucro por ano</span>
              <span
                class="tnum text-sm font-semibold"
                :class="item.statement.profit >= 0 ? 'text-up' : 'text-down'"
              >
                {{ formatMoneyCompact(item.statement.profit) }}
              </span>
            </div>

            <p class="pt-2 text-[11px] text-muted">
              Capacidade de {{ formatMoneyCompact(item.statement.capacity) }}/ano, limitada por
              <strong>{{ item.statement.bottleneck }}</strong>.
              <template v-if="item.statement.bottleneck === 'mão de obra'">
                Contratar mais um exige {{ formatMoneyCompact(item.statement.capitalPerHead) }}
                de capital junto — é o giro de {{ item.industry.capitalTurnover }}× do setor.
              </template>
              <template v-else-if="item.statement.bottleneck === 'capital'">
                Há gente ociosa: ampliar capacidade rende mais que contratar.
              </template>
              <template v-else>
                Você produz mais do que vende. Preço, marca e qualidade movem a
                demanda — capacidade não.
              </template>
            </p>
          </div>
        </details>

        <!-- O aviso que faltava antes da recuperação judicial. -->
        <p
          v-if="item.statement.negativeQuarters > 0"
          class="mt-2 rounded-xl border border-down/40 bg-down/10 p-3 text-[11px] text-down"
        >
          Caixa negativo há {{ item.statement.negativeQuarters }}
          {{ item.statement.negativeQuarters === 1 ? 'trimestre' : 'trimestres' }} — mais
          {{ item.statement.quartersToBankruptcy - item.statement.negativeQuarters }}
          e a empresa vai a recuperação judicial.
        </p>

        <!-- Dinheiro entre o seu bolso e o da empresa. O campo de valor acima
             serve aos dois. -->
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button
            class="min-h-[44px] rounded-xl border border-line px-2 text-xs leading-tight font-medium disabled:opacity-30"
            :disabled="!amount || amount > (game.state?.player.money ?? 0)"
            @click="inject(item.company.id)"
          >
            Aportar do meu bolso
            <span class="block text-[11px] font-normal text-muted">vira caixa da empresa</span>
          </button>
          <button
            class="min-h-[44px] rounded-xl border border-line px-2 text-xs leading-tight font-medium disabled:opacity-30"
            :disabled="withdrawLimit(item.company.id) <= 0"
            @click="withdraw(item.company.id)"
          >
            Retirar para mim
            <span class="tnum block text-[11px] font-normal text-muted">
              até {{ formatMoneyCompact(withdrawLimit(item.company.id)) }}
            </span>
          </button>
        </div>

        <div class="mt-2 grid grid-cols-2 gap-2">
          <!-- Cada botão diz o que **aquele real** compra. Ampliar capacidade só
               compra máquina; se quem segura a produção é gente, o dinheiro sai
               e a capacidade não se move — foi exatamente o que o playtest
               relatou: "não consegui ver efeito além de gastar caixa". -->
          <button
            class="min-h-[44px] rounded-xl border px-2 text-xs leading-tight font-medium disabled:opacity-30"
            :class="item.statement.bottleneck === 'capital' ? 'border-accent/50 text-accent' : 'border-line'"
            :disabled="!amount || amount > item.company.cash"
            @click="game.dispatch({ kind: 'expandirCapacidade', companyId: item.company.id, investment: amount ?? 0 })"
          >
            Ampliar capacidade
            <span class="block text-[11px] font-normal text-muted">
              <template v-if="item.statement.bottleneck === 'capital'">
                +{{ formatMoneyCompact((amount ?? 0) * item.industry.capitalTurnover) }} de produção
              </template>
              <template v-else>não muda nada agora</template>
            </span>
          </button>
          <button
            class="min-h-[44px] rounded-xl border px-2 text-xs leading-tight font-medium"
            :class="item.statement.bottleneck === 'mão de obra' ? 'border-accent/50 text-accent' : 'border-line'"
            @click="hire(item.company.id, 1)"
          >
            Contratar 1
            <span class="block text-[11px] font-normal text-muted">
              <template v-if="item.statement.bottleneck === 'mão de obra'">
                +{{ formatMoneyCompact(item.industry.outputPerEmployee * (item.company.workforce.productivity / 100)) }} de produção
              </template>
              <template v-else>há gente ociosa</template>
            </span>
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
          <button
            class="min-h-[44px] rounded-xl border border-line text-sm text-muted"
            @click="fireOne(item.company.id)"
          >
            Demitir 1
          </button>
          <button
            class="min-h-[44px] rounded-xl border border-line text-sm text-muted"
            @click="shrink(item.company.id)"
          >
            Encolher 20%
          </button>
          <button
            v-if="!item.ceo"
            class="col-span-2 min-h-[44px] rounded-xl border border-line text-sm text-muted"
            @click="delegating = delegating === item.company.id ? null : item.company.id"
          >
            {{ delegating === item.company.id ? 'cancelar' : 'Nomear um CEO' }}
          </button>
          <button
            v-else
            class="col-span-2 min-h-[44px] rounded-xl border border-accent/50 text-sm font-medium text-accent"
            @click="takeBack(item.company.id)"
          >
            Reassumir a gestão
          </button>
        </div>

        <!-- O que a delegação custa, **antes** do clique: era porta de mão única,
             e quem nomeava por engano perdia a empresa sem ter vendido nada. -->
        <p v-if="delegating === item.company.id" class="pt-2 text-[11px] text-warn">
          O CEO decide preço, marketing, P&D e contratação sozinho, e a empresa sai
          dos seus blocos do dia. Você pode reassumir depois, enquanto tiver o
          controle acionário.
        </p>

        <!-- Caixa: crédito, dividendo, recompra e campanha. -->
        <div class="grid grid-cols-2 gap-2 pt-2">
          <button
            class="min-h-[44px] rounded-xl border border-line px-2 text-xs leading-tight disabled:opacity-30"
            :disabled="creditRoom(item.company.id) <= 0"
            @click="borrow(item.company.id)"
          >
            Tomar crédito
            <span class="tnum block text-muted">
              {{ formatMoneyCompact(creditRoom(item.company.id)) }}
            </span>
          </button>
          <button
            class="min-h-[44px] rounded-xl border border-line px-2 text-xs leading-tight"
            @click="advertise(item.company.id)"
          >
            Campanha
            <span class="block text-muted">10% do caixa em marca</span>
          </button>
          <button
            class="min-h-[44px] rounded-xl border border-line px-2 text-xs leading-tight"
            @click="setPayout(item.company.id, item.company.directives.payoutRatio > 0 ? 0 : 0.3)"
          >
            Dividendos
            <span class="block text-muted">
              {{ Math.round(item.company.directives.payoutRatio * 100) }}% do lucro
            </span>
          </button>
          <button
            v-if="item.company.isPublic"
            class="min-h-[44px] rounded-xl border border-line px-2 text-xs leading-tight"
            @click="buyBackShares(item.company.id)"
          >
            Recomprar ações
            <span class="block text-muted">25% do caixa</span>
          </button>
        </div>

        <!-- M&A: diversificar, vender pedaço, incorporar controlada. -->
        <details class="pt-2">
          <summary class="min-h-[44px] cursor-pointer list-none rounded-xl border border-line px-3 py-3 text-sm text-muted">
            Reorganizar
          </summary>
          <div class="flex flex-col gap-2 pt-2">
            <button
              class="min-h-[44px] rounded-xl border border-line px-3 text-left text-xs"
              @click="sellDivision(item.company.id)"
            >
              Vender 25% da operação
            </button>
            <button
              v-for="target in mergeTargets(item.company.id)"
              :key="target!.id"
              class="min-h-[44px] rounded-xl border border-line px-3 text-left text-xs"
              @click="merge(item.company.id, target!.id)"
            >
              Incorporar {{ target!.name }}
            </button>
            <p class="px-1 text-[11px] text-muted">Entrar em outro setor</p>
            <button
              v-for="industry in otherIndustries(item.company.id)"
              :key="industry.id"
              class="flex min-h-[44px] items-center justify-between rounded-xl border border-line px-3 text-left text-xs disabled:opacity-30"
              :disabled="item.company.cash < entryCost(industry.id)"
              @click="enterSector(item.company.id, industry.id)"
            >
              <span>{{ industry.name }}</span>
              <span class="tnum text-muted">{{ formatMoneyCompact(entryCost(industry.id)) }}</span>
            </button>
          </div>
        </details>

        <div v-if="delegating === item.company.id" class="mt-2 rounded-xl border border-line p-3">
          <p class="pb-2 text-[11px] text-muted">
            Você escolhe a personalidade e vive com o que ela faz — a empresa sai da sua lista
            de blocos diários.
          </p>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="profile in profiles"
              :key="profile.id"
              class="min-h-[40px] rounded-lg border border-line px-1 text-[11px]"
              @click="appoint(item.company.id, profile.id)"
            >
              {{ profile.name }}
            </button>
          </div>
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
