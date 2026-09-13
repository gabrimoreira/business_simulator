<script setup lang="ts">
/**
 * Tudo que é seu, num lugar só.
 *
 * O que existia estava espalhado por quatro telas: ação como uma linha dentro
 * da lista de *todas* as empresas da bolsa, bem no meio do Mundo entre banco e
 * política, empresa em Negócios, jornal dentro do painel de imprensa, dívida em
 * lugar nenhum. Nenhuma tela respondia "o que eu tenho".
 *
 * **Somente leitura, de propósito.** Cada linha leva para onde se age sobre
 * ela. Isto é um extrato; um quarto lugar de comprar só dividiria a atenção.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { holdingsFor, type HoldingGroup } from '@/ui/holdings'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import ScreenTitle from '@/components/ScreenTitle.vue'

const game = useGameStore()
const router = useRouter()

const holdings = computed(() => (game.state ? holdingsFor(game.state) : null))

/** Começa com tudo aberto: a queixa era não conseguir ver, não ver demais. */
const collapsed = ref<Set<string>>(new Set())
function toggle(label: string): void {
  const next = new Set(collapsed.value)
  if (next.has(label)) next.delete(label)
  else next.add(label)
  collapsed.value = next
}

function share(group: HoldingGroup): number {
  const assets = holdings.value?.assets ?? 0
  if (assets <= 0 || group.total <= 0) return 0
  return Math.min(100, (group.total / assets) * 100)
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Patrimônio" />

    <section v-if="holdings" class="px-4">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <p class="text-[11px] uppercase tracking-wide text-muted">Patrimônio líquido</p>
        <p class="tnum text-3xl font-semibold">{{ formatMoney(holdings.total) }}</p>
        <div class="mt-2 flex justify-between text-[11px] text-muted">
          <span>Bens e aplicações {{ formatMoneyCompact(holdings.assets) }}</span>
          <span v-if="holdings.debts < 0" class="text-down">
            Dívidas {{ formatMoneyCompact(holdings.debts) }}
          </span>
        </div>
      </div>
    </section>

    <p
      v-if="holdings && holdings.groups.length === 0"
      class="px-4 pt-4 text-sm leading-relaxed text-muted"
    >
      Você ainda não tem nada além do que está no bolso. O que você comprar —
      ação, imóvel, empresa, jornal — aparece aqui separado por tipo.
    </p>

    <section v-for="group in holdings?.groups ?? []" :key="group.label" class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface">
        <button
          class="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
          @click="toggle(group.label)"
        >
          <span class="min-w-0">
            <span class="block text-sm font-medium">{{ group.label }}</span>
            <span class="block text-[11px] text-muted">
              {{ group.lines.length }} {{ group.lines.length === 1 ? 'item' : 'itens' }}
            </span>
          </span>
          <span
            class="tnum shrink-0 text-sm font-semibold"
            :class="group.total < 0 ? 'text-down' : ''"
          >
            {{ formatMoneyCompact(group.total) }}
          </span>
        </button>

        <!-- Uma barra por grupo: o peso de cada coisa no bolo, sem precisar
             dividir os números de cabeça. -->
        <div v-if="share(group) > 0" class="mx-4 h-1 overflow-hidden rounded-full bg-line">
          <div class="h-full rounded-full bg-accent" :style="{ width: `${share(group)}%` }" />
        </div>

        <div v-if="!collapsed.has(group.label)" class="px-4 pb-3 pt-2">
          <p class="pb-2 text-[11px] leading-snug text-muted">{{ group.hint }}</p>
          <ul class="divide-y divide-line">
            <li v-for="line in group.lines" :key="line.id">
              <component
                :is="line.route ? 'button' : 'div'"
                class="flex w-full items-baseline justify-between gap-3 py-2 text-left"
                @click="line.route ? router.push(line.route) : undefined"
              >
                <span class="min-w-0">
                  <span class="block truncate text-xs">{{ line.label }}</span>
                  <span v-if="line.detail" class="block truncate text-[11px] text-muted">
                    {{ line.detail }}
                  </span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="tnum block text-xs" :class="line.value < 0 ? 'text-down' : ''">
                    {{ formatMoneyCompact(line.value) }}
                  </span>
                  <span
                    v-if="line.change !== undefined"
                    class="tnum block text-[11px]"
                    :class="line.change >= 0 ? 'text-up' : 'text-down'"
                  >
                    {{ line.change >= 0 ? '+' : '' }}{{ formatMoneyCompact(line.change) }}
                  </span>
                </span>
              </component>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
