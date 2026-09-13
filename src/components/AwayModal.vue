<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DayLog } from '@/engine/types'
import { formatMoney } from '@/lib/format'
import { ledgerFor } from '@/ui/ledger'

const props = defineProps<{ log: DayLog[]; title: string }>()
const emit = defineEmits<{ close: [] }>()

/**
 * Um mês de dias vira uma lista ilegível: agrega e mostra o que importa.
 *
 * O extrato por categoria veio depois, e é a parte que faltava: antes o resumo
 * mostrava **um número líquido só**, e quem avançava um mês via o caixa cair
 * sem saber o que causou. Pior, a lista filtrava por severidade, então comida e
 * contas — que são `info` — sumiam justamente do resumo financeiro.
 */
const summary = computed(() => {
  const entries = props.log.flatMap((day) => day.entries)
  const notable = entries.filter((item) => item.severity === 'bom' || item.severity === 'ruim' || item.severity === 'critico')
  return {
    days: props.log.length,
    ledger: ledgerFor(entries),
    notable: notable.slice(-12).reverse(),
    quietCount: entries.length - notable.length,
  }
})

/** Grupo aberto no extrato; só um por vez, para o modal não virar uma parede. */
const open = ref<string | null>(null)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-black/70" @click.self="emit('close')">
    <div
      class="sheet-panel max-h-[80dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5"
      style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.25rem)"
    >
      <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
      <h2 class="text-lg font-semibold">{{ title }}</h2>
      <p class="mt-1 text-sm text-muted">
        {{ summary.days }} {{ summary.days === 1 ? 'dia' : 'dias' }} ·
        <span class="tnum" :class="summary.ledger.net >= 0 ? 'text-up' : 'text-down'">
          {{ formatMoney(summary.ledger.net) }}
        </span>
      </p>

      <!-- O que moveu o caixa, por categoria. Tocar abre as linhas do grupo. -->
      <div v-if="summary.ledger.groups.length" class="mt-3 rounded-xl bg-surface-2 p-3">
        <p class="pb-2 text-[11px] uppercase tracking-wide text-muted">No dinheiro</p>
        <div v-for="group in summary.ledger.groups" :key="group.label">
          <button
            class="flex min-h-[36px] w-full items-baseline justify-between gap-3 text-left"
            @click="open = open === group.label ? null : group.label"
          >
            <span class="text-xs">{{ group.label }}</span>
            <span
              class="tnum shrink-0 text-xs"
              :class="group.total >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatMoney(group.total) }}
            </span>
          </button>
          <ul v-if="open === group.label" class="pb-1 pl-3">
            <li
              v-for="line in group.lines.slice(-6)"
              :key="line.id + line.dayIndex"
              class="flex items-baseline justify-between gap-3"
            >
              <span class="truncate text-[11px] text-muted">{{ line.text }}</span>
              <span class="tnum shrink-0 text-[11px] text-muted">
                {{ formatMoney(line.amount ?? 0) }}
              </span>
            </li>
          </ul>
        </div>

        <!-- Fora do saldo de propósito: comprar ação tira do caixa e põe na
             carteira, com patrimônio idêntico. Contar isso como perda fazia o
             total do mês dançar sem significar nada. -->
        <p
          v-if="summary.ledger.moved > 0"
          class="mt-2 border-t border-line pt-2 text-[11px] text-muted"
        >
          {{ formatMoney(summary.ledger.moved) }} movimentados entre caixa, banco
          e carteira — não é ganho nem perda.
        </p>
      </div>

      <ul class="mt-4 flex flex-col gap-2">
        <li
          v-for="item in summary.notable"
          :key="item.id + item.dayIndex"
          class="flex items-baseline justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2"
        >
          <span
            class="text-sm"
            :class="{
              'text-up': item.severity === 'bom',
              'text-down': item.severity === 'ruim' || item.severity === 'critico',
            }"
            >{{ item.text }}</span
          >
          <span v-if="item.amount !== null" class="tnum shrink-0 text-xs text-muted">
            {{ formatMoney(item.amount) }}
          </span>
        </li>
        <li v-if="summary.notable.length === 0" class="text-sm text-muted">
          Nada de especial aconteceu.
        </li>
      </ul>

      <button
        class="mt-5 min-h-[48px] w-full rounded-xl bg-accent text-base font-semibold text-bg"
        @click="emit('close')"
      >
        Continuar
      </button>
    </div>
  </div>
</template>
