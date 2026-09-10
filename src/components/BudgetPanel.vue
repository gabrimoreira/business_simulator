<script setup lang="ts">
/**
 * O extrato do mês: o que entra, o que sai, e quando.
 *
 * Existe porque o jogo tem treze fluxos de dinheiro e a interface mostrava dois
 * números — caixa e patrimônio — mais um log cronológico. As saídas grandes são
 * automáticas e em dias fixos, e o débito tira da conta corrente antes do caixa,
 * então o número do topo caía sozinho sem o jogador ter clicado em nada.
 *
 * Mostra só o **recorrente**. Compra de ação, venda de empresa e empréstimo são
 * eventos, não orçamento: incluí-los faria o saldo do mês oscilar sem significar
 * nada.
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatMoney } from '@/lib/format'
import { monthlyBudget, nextMoneyEvent } from '@/engine/selectors'
import { CAREER } from '@/data/config'

const game = useGameStore()

const budget = computed(() => (game.state ? monthlyBudget(game.state) : null))
const next = computed(() => (game.state ? nextMoneyEvent(game.state) : null))

/**
 * Na carência do primeiro mês o motor não cobra contas. Sem este aviso, o
 * jogador vê despesa prevista que não acontece e conclui que o extrato mente.
 */
const inGrace = computed(
  () => (game.state?.date.dayIndex ?? 0) < CAREER.firstBillsGraceDays,
)
</script>

<template>
  <section v-if="budget" class="px-4 pt-3">
    <div class="rounded-2xl border border-line bg-surface p-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-medium">Por mês</h2>
        <p v-if="next" class="text-[11px] text-muted">
          {{ next.days === 0 ? `${next.label} hoje` : `${next.label} em ${next.days} d` }}
        </p>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p class="pb-1 text-[11px] uppercase tracking-wide text-muted">Entra</p>
          <div v-for="line in budget.income" :key="line.label" class="flex justify-between gap-2">
            <span class="truncate text-[11px] text-muted">{{ line.label }}</span>
            <span class="tnum shrink-0 text-[11px] text-up">{{ formatMoney(line.amount) }}</span>
          </div>
          <p v-if="budget.income.length === 0" class="text-[11px] text-muted">
            Nada — você não tem emprego.
          </p>
        </div>

        <div>
          <p class="pb-1 text-[11px] uppercase tracking-wide text-muted">Sai</p>
          <div v-for="line in budget.expenses" :key="line.label" class="flex justify-between gap-2">
            <span class="truncate text-[11px] text-muted">{{ line.label }}</span>
            <span class="tnum shrink-0 text-[11px] text-down">{{ formatMoney(line.amount) }}</span>
          </div>
        </div>
      </div>

      <div class="mt-3 flex items-baseline justify-between border-t border-line pt-2">
        <span class="text-xs font-medium">Sobra por mês</span>
        <span
          class="tnum text-sm font-semibold"
          :class="budget.net >= 0 ? 'text-up' : 'text-down'"
        >
          {{ formatMoney(budget.net) }}
        </span>
      </div>

      <p v-if="inGrace" class="pt-2 text-[11px] text-muted">
        Primeiro mês: as contas só começam a ser cobradas no dia
        {{ CAREER.firstBillsGraceDays }}.
      </p>
      <p v-else-if="budget.net < 0" class="pt-2 text-[11px] text-down">
        Você gasta mais do que ganha. Sem mudar isso, o caixa acaba.
      </p>
      <p v-else class="pt-2 text-[11px] text-muted">
        Comida não entra aqui: ela sai a cada refeição, não uma vez por mês.
      </p>
    </div>
  </section>
</template>
