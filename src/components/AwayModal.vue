<script setup lang="ts">
import { computed } from 'vue'
import type { DayLog } from '@/engine/types'
import { formatMoney } from '@/lib/format'

const props = defineProps<{ log: DayLog[]; title: string }>()
const emit = defineEmits<{ close: [] }>()

/** Um mês de dias vira uma lista ilegível: agrega e mostra o que importa. */
const summary = computed(() => {
  const entries = props.log.flatMap((day) => day.entries)
  const money = entries.reduce((sum, item) => sum + (item.amount ?? 0), 0)
  const notable = entries.filter((item) => item.severity === 'bom' || item.severity === 'ruim' || item.severity === 'critico')
  return {
    days: props.log.length,
    money,
    notable: notable.slice(-12).reverse(),
    quietCount: entries.length - notable.length,
  }
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-black/70" @click.self="emit('close')">
    <div
      class="max-h-[80dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5"
      style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.25rem)"
    >
      <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
      <h2 class="text-lg font-semibold">{{ title }}</h2>
      <p class="mt-1 text-sm text-muted">
        {{ summary.days }} {{ summary.days === 1 ? 'dia' : 'dias' }} ·
        <span class="tnum" :class="summary.money >= 0 ? 'text-up' : 'text-down'">
          {{ formatMoney(summary.money) }}
        </span>
      </p>

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
