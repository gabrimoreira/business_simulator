<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatPercent } from '@/lib/format'
import { creditLimitFor, loanRateFor, savingsRateFor } from '@/engine/banking'
import type { BankDefinition } from '@/data/banks'

const props = defineProps<{ bank: BankDefinition }>()
const game = useGameStore()

const open = ref(false)
const amount = ref<number | null>(null)
const term = ref(720)

const account = computed(
  () => game.state?.banking.accounts.find((item) => item.bankId === props.bank.id) ?? null,
)
const hasAccess = computed(() => (game.state?.player.creditScore ?? 0) >= props.bank.minScore)
const savingsRate = computed(() => (game.state ? savingsRateFor(game.state, props.bank) : 0))
const loanRate = computed(() => (game.state ? loanRateFor(game.state, props.bank) : 0))
const creditLimit = computed(() => (game.state ? creditLimitFor(game.state, props.bank) : 0))
const locked = computed(() => {
  const until = account.value?.savingsLockedUntilDayIndex
  if (until === null || until === undefined || !game.state) return 0
  return Math.max(0, until - game.state.date.dayIndex)
})

function run(action: 'depositar' | 'sacar' | 'aplicar' | 'resgatar'): void {
  const value = amount.value
  if (!value || value <= 0) return
  game.dispatch({ kind: action, bankId: props.bank.id, amount: value })
  amount.value = null
  navigator.vibrate?.(12)
}

function borrow(): void {
  const value = amount.value
  if (!value || value <= 0) return
  game.dispatch({
    kind: 'tomarEmprestimo',
    bankId: props.bank.id,
    loanKind: 'pessoal',
    amount: value,
    termDays: term.value,
  })
  amount.value = null
  navigator.vibrate?.(20)
}
</script>

<template>
  <div class="rounded-2xl border border-line bg-surface">
    <button class="flex w-full items-start justify-between gap-3 p-4 text-left" @click="open = !open">
      <div class="min-w-0">
        <p class="text-sm font-medium">{{ bank.name }}</p>
        <p class="tnum text-xs text-muted">
          Rende {{ formatPercent(savingsRate, 2) }} a.a. · empréstimo
          {{ formatPercent(loanRate, 1) }} a.a.
        </p>
        <p v-if="!hasAccess" class="text-[11px] text-warn">Exige score {{ bank.minScore }}</p>
        <p v-else-if="bank.lockDays > 0" class="text-[11px] text-muted">
          Carência de {{ bank.lockDays }} dias
        </p>
      </div>
      <div class="shrink-0 text-right">
        <p class="tnum text-sm font-semibold text-accent">
          {{ formatMoney((account?.checking ?? 0) + (account?.savings ?? 0)) }}
        </p>
        <p class="text-[11px] text-muted">{{ open ? 'fechar' : 'abrir' }}</p>
      </div>
    </button>

    <div v-if="open" class="border-t border-line p-4">
      <dl v-if="account" class="mb-3 grid grid-cols-2 gap-2 text-xs">
        <div class="flex justify-between gap-2">
          <dt class="text-muted">Conta</dt>
          <dd class="tnum">{{ formatMoney(account.checking) }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-muted">Aplicado</dt>
          <dd class="tnum">{{ formatMoney(account.savings) }}</dd>
        </div>
      </dl>
      <p v-if="locked > 0" class="mb-3 text-[11px] text-warn">
        Aplicação em carência por mais {{ locked }} dias.
      </p>

      <input
        v-model.number="amount"
        class="selectable mb-2 min-h-[44px] w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
        type="number"
        inputmode="decimal"
        min="0"
        placeholder="Valor"
      />

      <div class="grid grid-cols-2 gap-2">
        <button
          class="min-h-[44px] rounded-xl border border-line text-sm font-medium disabled:opacity-30"
          :disabled="!hasAccess"
          @click="run('aplicar')"
        >
          Aplicar
        </button>
        <button
          class="min-h-[44px] rounded-xl border border-line text-sm font-medium disabled:opacity-30"
          :disabled="!account || locked > 0"
          @click="run('resgatar')"
        >
          Resgatar
        </button>
        <button
          class="min-h-[44px] rounded-xl border border-line text-sm font-medium disabled:opacity-30"
          :disabled="!hasAccess"
          @click="run('depositar')"
        >
          Depositar
        </button>
        <button
          class="min-h-[44px] rounded-xl border border-line text-sm font-medium disabled:opacity-30"
          :disabled="!account"
          @click="run('sacar')"
        >
          Sacar
        </button>
      </div>

      <div class="mt-4 border-t border-line pt-3">
        <div class="flex items-baseline justify-between">
          <p class="text-xs text-muted">Crédito disponível</p>
          <p class="tnum text-xs">{{ formatMoney(creditLimit) }}</p>
        </div>
        <div class="mt-2 flex gap-2">
          <button
            v-for="option in [360, 720, 1080]"
            :key="option"
            class="min-h-[36px] flex-1 rounded-lg border text-xs"
            :class="term === option ? 'border-accent text-accent' : 'border-line text-muted'"
            @click="term = option"
          >
            {{ option / 30 }} meses
          </button>
        </div>
        <button
          class="mt-2 min-h-[44px] w-full rounded-xl border border-line text-sm font-medium disabled:opacity-30"
          :disabled="!hasAccess || creditLimit <= 0"
          @click="borrow"
        >
          Pegar emprestado
        </button>
        <button
          class="mt-2 min-h-[44px] w-full rounded-xl border border-line text-sm text-muted disabled:opacity-30"
          :disabled="!hasAccess"
          @click="game.dispatch({ kind: 'contratarCartao', bankId: bank.id })"
        >
          Pedir cartão de crédito
        </button>
      </div>
    </div>
  </div>
</template>
