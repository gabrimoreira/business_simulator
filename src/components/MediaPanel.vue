<script setup lang="ts">
/**
 * Comprar o jornal e mandar na pauta.
 *
 * "Compre o jornal que conta a história" é a primeira linha da descrição do
 * jogo, e era a metade que não existia: dava para assinar um veículo, não para
 * ser dono dele.
 *
 * A pauta puxa o sentimento das manchetes daquele veículo sobre o alvo
 * escolhido — não inverte o fato, e cobra credibilidade a cada uso. Como o
 * choque de preço de uma manchete é proporcional à credibilidade, quem abusa
 * termina com um megafone que ninguém escuta.
 */
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatMoneyCompact } from '@/lib/format'
import { valuationOf } from '@/engine/companies'
import { sectorMultiple } from '@/engine/market'
import { findIndustry } from '@/data/industries'
import { NEWS } from '@/data/config'
import { nominal } from '@/engine/macro'

const game = useGameStore()
const aiming = ref<string | null>(null)

const outlets = computed(() => {
  const state = game.state
  if (!state) return []
  return state.news.outletOrder.flatMap((id) => {
    const outlet = state.news.outlets[id]
    if (!outlet) return []
    const listed = outlet.companyId ? state.companies[outlet.companyId] : null
    const industry = listed ? findIndustry(listed.industryId) : null
    // Mesma conta do motor: o alcance é piso, e o valuation só manda quando
    // passa dele. Sem o piso, veículo listado e endividado saía por R$ 0,00.
    const floor = nominal(state.macro, outlet.reach * NEWS.outletPricePerReach)
    const price =
      listed && industry
        ? Math.max(floor, valuationOf(listed, sectorMultiple(industry.multipleBase, state.macro.selic)))
        : floor
    const order = state.news.editorialOrders.find(
      (item) => item.outletId === id && state.date.dayIndex < item.cooldownUntilDayIndex,
    )
    return [{ outlet, price, mine: outlet.ownerId === 'player', order }]
  })
})

/** Alvos de pauta: as empresas que o feed cobre. */
const subjects = computed(() => {
  const state = game.state
  if (!state) return []
  return state.companyOrder.flatMap((id) => {
    const company = state.companies[id]
    return company ? [{ id, name: company.name }] : []
  })
})

function buy(outletId: string): void {
  game.dispatch({ kind: 'comprarVeiculo', outletId })
}

function setAgenda(outletId: string, companyId: string, targetSentiment: number): void {
  game.dispatch({
    kind: 'definirPauta',
    outletId,
    subject: { kind: 'company', id: companyId },
    targetSentiment,
  })
  aiming.value = null
}
</script>

<template>
  <section class="px-4 pt-4">
    <h2 class="pb-2 text-sm font-medium text-muted">Imprensa</h2>

    <div class="flex flex-col gap-2">
      <div
        v-for="item in outlets"
        :key="item.outlet.id"
        class="rounded-xl border border-line bg-surface p-3"
        :class="{ 'border-accent/50': item.mine }"
      >
        <div class="flex items-baseline justify-between gap-2">
          <p class="text-sm font-medium">{{ item.outlet.name }}</p>
          <p class="shrink-0 text-[11px] text-muted">
            alcance {{ Math.round(item.outlet.reach) }} · credibilidade
            {{ Math.round(item.outlet.credibility) }}
          </p>
        </div>

        <button
          v-if="!item.mine"
          class="mt-2 flex min-h-[44px] w-full items-center justify-between rounded-lg border border-line px-3 text-xs"
          @click="buy(item.outlet.id)"
        >
          <span>Comprar</span>
          <span class="tnum text-muted">{{ formatMoneyCompact(item.price) }}</span>
        </button>

        <template v-else>
          <p v-if="item.order" class="pt-2 text-[11px] text-muted">
            Pauta em vigor até o dia {{ item.order.cooldownUntilDayIndex }}.
          </p>
          <button
            v-else
            class="mt-2 min-h-[44px] w-full rounded-lg border border-line text-xs"
            @click="aiming = aiming === item.outlet.id ? null : item.outlet.id"
          >
            {{ aiming === item.outlet.id ? 'cancelar' : 'Definir pauta' }}
          </button>

          <div v-if="aiming === item.outlet.id" class="flex flex-col gap-1 pt-2">
            <div v-for="subject in subjects" :key="subject.id" class="flex items-center gap-1">
              <span class="flex-1 truncate text-[11px]">{{ subject.name }}</span>
              <button
                class="min-h-[40px] rounded-lg border border-up/40 px-2 text-[11px] text-up"
                @click="setAgenda(item.outlet.id, subject.id, 1)"
              >
                elogiar
              </button>
              <button
                class="min-h-[40px] rounded-lg border border-down/40 px-2 text-[11px] text-down"
                @click="setAgenda(item.outlet.id, subject.id, -1)"
              >
                atacar
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <p class="px-1 pt-2 text-[11px] text-muted">
      A pauta enquadra, não inventa: puxa o tom das manchetes e custa
      credibilidade — e é a credibilidade que faz a manchete mover preço.
    </p>
  </section>
</template>
