<script setup lang="ts">
import { computed, ref } from 'vue'
import BankCard from '@/components/BankCard.vue'
import PoliticsPanel from '@/components/PoliticsPanel.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatMoneyCompact, formatPercent } from '@/lib/format'
import { BANKS, findBank } from '@/data/banks'
import { ASSETS } from '@/data/assets'
import MediaPanel from '@/components/MediaPanel.vue'

const game = useGameStore()
const macro = computed(() => game.state?.macro ?? null)

const PHASE_LABEL: Record<string, string> = {
  expansao: 'Expansão',
  pico: 'Pico do ciclo',
  recessao: 'Recessão',
  recuperacao: 'Recuperação',
}

const loans = computed(() => game.state?.banking.loans ?? [])
const cards = computed(() => game.state?.banking.cards ?? [])
const score = computed(() => game.state?.player.creditScore ?? 0)
const playerOffice = computed(() => game.state?.player.office ?? null)
const owned = computed(() => game.state?.personalAssets.assets ?? [])
const shopping = ref(false)

function bankName(id: string): string {
  return findBank(id)?.name ?? id
}

function payoff(loanId: string, amount: number): void {
  game.dispatch({ kind: 'pagarEmprestimo', loanId, amount })
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Mundo" subtitle="Economia, bancos e política" />

    <section v-if="macro" class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <div class="flex items-baseline justify-between">
          <p class="text-sm font-medium">{{ PHASE_LABEL[macro.cyclePhase] }}</p>
          <p class="tnum text-xs text-muted">confiança {{ Math.round(macro.confidence) }}</p>
        </div>
        <dl class="mt-3 grid grid-cols-3 gap-2">
          <div>
            <dt class="text-[11px] text-muted">Selic</dt>
            <dd class="tnum text-base font-semibold text-accent">
              {{ formatPercent(macro.selic, 2) }}
            </dd>
          </div>
          <div>
            <dt class="text-[11px] text-muted">Inflação</dt>
            <dd class="tnum text-base font-semibold">{{ formatPercent(macro.inflation, 1) }}</dd>
          </div>
          <div>
            <dt class="text-[11px] text-muted">Desemprego</dt>
            <dd class="tnum text-base font-semibold">
              {{ formatPercent(macro.unemployment, 1) }}
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="px-4 pt-4">
      <div class="flex items-baseline justify-between pb-2">
        <h2 class="text-sm font-medium text-muted">Bancos</h2>
        <span class="tnum text-xs text-muted">score {{ Math.round(score) }}</span>
      </div>
      <div class="flex flex-col gap-2">
        <BankCard v-for="bank in BANKS" :key="bank.id" :bank="bank" />
      </div>
    </section>

    <section v-if="loans.length" class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Empréstimos</h2>
      <div class="flex flex-col gap-2">
        <div
          v-for="loan in loans"
          :key="loan.id"
          class="rounded-xl border border-line bg-surface p-3"
        >
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm font-medium">{{ bankName(loan.bankId) }}</p>
            <p class="tnum text-sm text-down">{{ formatMoney(loan.remaining) }}</p>
          </div>
          <p class="tnum text-xs text-muted">
            {{ formatPercent(loan.rate, 1) }} a.a. · parcela diária
            {{ formatMoney(loan.dailyPayment) }}
          </p>
          <p v-if="loan.daysOverdue > 0" class="text-[11px] text-down">
            {{ loan.daysOverdue }} dias em atraso
          </p>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              class="h-full rounded-full bg-accent"
              :style="{ width: `${100 - (loan.remaining / loan.principal) * 100}%` }"
            />
          </div>
          <button
            class="mt-2 min-h-[40px] w-full rounded-xl border border-line text-sm"
            @click="payoff(loan.id, loan.remaining)"
          >
            Quitar agora
          </button>
        </div>
      </div>
    </section>

    <section v-if="cards.length" class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Cartões</h2>
      <div class="flex flex-col gap-2">
        <div
          v-for="card in cards"
          :key="card.bankId"
          class="rounded-xl border border-line bg-surface p-3"
        >
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm font-medium">{{ bankName(card.bankId) }}</p>
            <p class="tnum text-sm" :class="card.balance > 0 ? 'text-down' : 'text-muted'">
              {{ formatMoney(card.balance) }}
            </p>
          </div>
          <p class="tnum text-xs text-muted">
            limite {{ formatMoney(card.limit) }} · rotativo
            {{ formatPercent(card.revolvingMonthlyRate, 0) }} ao mês
          </p>
        </div>
      </div>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Bens</h2>
      <div v-if="owned.length" class="mb-2 flex flex-col gap-2">
        <div
          v-for="asset in owned"
          :key="asset.id"
          class="rounded-xl border border-line bg-surface p-3"
        >
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm font-medium">
              {{ asset.name }}
              <span v-if="asset.isResidence" class="text-[11px] text-accent">· você mora aqui</span>
            </p>
            <p class="tnum text-sm">{{ formatMoneyCompact(asset.currentValue) }}</p>
          </div>
          <p class="tnum text-[11px] text-muted">
            comprado por {{ formatMoneyCompact(asset.purchasePrice) }}
            <span v-if="asset.monthlyIncome > 0 && !asset.isResidence">
              · aluga por {{ formatMoney(asset.monthlyIncome) }}/mês
            </span>
          </p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              v-if="asset.kind === 'imovel' && !asset.isResidence"
              class="min-h-[36px] rounded-lg border border-line text-xs"
              @click="game.dispatch({ kind: 'mudarResidencia', id: asset.id })"
            >
              Morar aqui
            </button>
            <button
              class="min-h-[36px] rounded-lg border border-line text-xs text-muted"
              @click="game.dispatch({ kind: 'venderAtivo', id: asset.id })"
            >
              Vender
            </button>
          </div>
        </div>
      </div>

      <button class="text-[11px] text-accent" @click="shopping = !shopping">
        {{ shopping ? 'fechar catálogo' : 'Comprar bens' }}
      </button>

      <div v-if="shopping" class="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
        <button
          v-for="asset in ASSETS"
          :key="asset.id"
          class="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 disabled:opacity-30"
          :disabled="(game.state?.player.money ?? 0) < asset.price * (game.state?.macro.priceLevel ?? 1)"
          @click="game.dispatch({ kind: 'comprarAtivo', assetId: asset.id, financed: false })"
        >
          <div class="min-w-0">
            <p class="truncate text-sm">{{ asset.name }}</p>
            <p class="text-[11px] text-muted">
              +{{ asset.moodBonus }} humor
              <span v-if="asset.notorietyCost > 0">· +{{ asset.notorietyCost }} notoriedade</span>
            </p>
          </div>
          <p class="tnum shrink-0 text-sm">
            {{ formatMoneyCompact(asset.price * (game.state?.macro.priceLevel ?? 1)) }}
          </p>
        </button>
      </div>
    </section>

    <MediaPanel />

    <section class="px-4 pt-4">
      <div class="flex items-baseline justify-between pb-2">
        <h2 class="text-sm font-medium text-muted">Política</h2>
        <span v-if="playerOffice" class="text-[11px] text-accent">você é {{ playerOffice }}</span>
      </div>
      <PoliticsPanel />
    </section>
  </div>
</template>
