<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import HeadlineList from '@/components/HeadlineList.vue'
import BudgetPanel from '@/components/BudgetPanel.vue'
import RoutineEditor from '@/components/RoutineEditor.vue'
import TakeoverAlert from '@/components/TakeoverAlert.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { ACTION_COSTS, MEALS_PER_DAY } from '@/data/config'
import { MEALS } from '@/data/living'
import { findJob } from '@/data/jobs'
import type { GameAction } from '@/engine/types'
import { barScale } from '@/ui/motion'
import { useFlash } from '@/ui/useFlash'

const game = useGameStore()

// Patrimônio líquido pisca junto com o caixa: é o placar do jogo.
const worthFlash = useFlash(() => game.playerNetWorth, 0.005)
const player = computed(() => game.state?.player ?? null)

const vitals = computed(() => {
  const p = player.value
  if (!p) return []
  return [
    { label: 'Energia', value: p.energy, color: 'bg-accent' },
    { label: 'Saúde', value: p.health, color: 'bg-up' },
    { label: 'Humor', value: p.mood, color: 'bg-warn' },
    { label: 'Fome', value: p.hunger, color: 'bg-down' },
  ]
})

const job = computed(() => (player.value?.currentJobId ? findJob(player.value.currentJobId) : null))

interface ActionButton {
  label: string
  hint: string
  action: GameAction
  energy: number
  disabled: boolean
  reason: string | null
}

const actions = computed<ActionButton[]>(() => {
  const p = player.value
  if (!p) return []
  const noBlocks = game.blocksLeft <= 0

  const build = (
    label: string,
    hint: string,
    action: GameAction,
    energy: number,
    extraReason: string | null = null,
  ): ActionButton => ({
    label,
    hint,
    action,
    energy,
    disabled: noBlocks || p.energy < energy || extraReason !== null,
    reason: extraReason ?? (noBlocks ? 'Sem blocos hoje' : p.energy < energy ? 'Sem energia' : null),
  })

  return [
    build(
      'Trabalhar',
      job.value ? job.value.title : 'sem emprego',
      { kind: 'trabalhar' },
      ACTION_COSTS.trabalhar.energy,
      job.value ? null : 'Você precisa de um emprego',
    ),
    build(
      'Estudar',
      p.activeCourse ? 'curso em andamento' : 'sem matrícula',
      { kind: 'estudar' },
      ACTION_COSTS.estudar.energy,
      p.activeCourse ? null : 'Matricule-se no Perfil',
    ),
    build('Academia', '+preparo, +saúde', { kind: 'academia' }, ACTION_COSTS.academia.energy),
    build('Lazer', '+humor', { kind: 'lazer' }, ACTION_COSTS.lazer.energy),
    build('Socializar', '+carisma, +contatos', { kind: 'socializar' }, ACTION_COSTS.socializar.energy),
    build(
      'Hora extra',
      '+60% do dia, −humor',
      { kind: 'horaExtra' },
      ACTION_COSTS.horaExtra.energy,
      job.value ? null : 'Você precisa de um emprego',
    ),
  ]
})

const mealsLeft = computed(() => MEALS_PER_DAY - (player.value?.mealsToday ?? 0))

const headlines = computed(() => game.state?.news.headlines ?? [])

/** O boletim é o único veículo que exige assinatura. */
const premium = computed(() => {
  const state = game.state
  if (!state) return null
  const outlet = state.news.outlets['boletim']
  if (!outlet) return null
  const subscribed = state.market.subscriptions.some((item) => item.outletId === outlet.id)
  return { outlet, subscribed }
})

function act(action: GameAction): void {
  game.dispatch(action)
}

function advance(days: number): void {
  game.dispatch({ kind: 'avancarTempo', days })
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Início" :subtitle="player ? `Olá, ${player.name}` : ''" />

    <!-- Acima de tudo: oferta hostil tem prazo, e prazo que passa é decisão
         tomada por omissão. -->
    <TakeoverAlert />

    <section class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <p class="text-xs uppercase tracking-wide text-muted">Patrimônio líquido</p>
        <p class="tnum mt-1 text-2xl font-semibold text-accent" :class="worthFlash">
          {{ formatMoneyCompact(game.playerNetWorth) }}
        </p>
        <p v-if="player && player.overdueBills > 0" class="tnum mt-1 text-xs text-down">
          {{ formatMoney(player.overdueBills) }} em contas atrasadas
        </p>

        <dl class="mt-4 grid grid-cols-2 gap-3">
          <div v-for="vital in vitals" :key="vital.label">
            <div class="flex items-baseline justify-between">
              <dt class="text-xs text-muted">{{ vital.label }}</dt>
              <dd class="tnum text-xs text-muted">{{ Math.round(vital.value) }}</dd>
            </div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <!-- `scaleX` sobre largura total, e não `width`: a barra anima no
                   compositor em vez de forçar layout a cada quadro. -->
              <div
                class="barra h-full w-full rounded-full"
                :class="vital.color"
                :style="{ transform: `scaleX(${barScale(vital.value)})` }"
              />
            </div>
          </div>
        </dl>
      </div>
    </section>

    <BudgetPanel />

    <section class="px-4 pt-4">
      <div class="flex items-baseline justify-between pb-2">
        <h2 class="text-sm font-medium text-muted">Manchetes</h2>
        <button
          v-if="premium && !premium.subscribed"
          class="text-[11px] text-accent"
          @click="game.dispatch({ kind: 'assinarVeiculo', outletId: premium.outlet.id })"
        >
          Assinar {{ premium.outlet.name }}
        </button>
        <button
          v-else-if="premium"
          class="text-[11px] text-muted"
          @click="game.dispatch({ kind: 'cancelarAssinatura', outletId: premium.outlet.id })"
        >
          Cancelar boletim
        </button>
      </div>

      <HeadlineList v-if="headlines.length" :headlines="headlines" :limit="10" />
      <EmptyState
        v-else
        title="O mundo ainda não se moveu"
        description="É por aqui que você descobre escândalos, resultados e rumores. Rumor move preço antes de virar fato — e nem todo rumor vira."
        phase="aguardando o primeiro evento"
      />
    </section>

    <section class="px-4 pt-4">
      <div class="flex items-baseline justify-between pb-2">
        <h2 class="text-sm font-medium text-muted">Ações do dia</h2>
        <span class="tnum text-xs text-muted">{{ game.blocksLeft }} de 3 blocos</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="item in actions"
          :key="item.label"
          class="min-h-[64px] rounded-xl border border-line bg-surface px-3 py-2 text-left disabled:opacity-40"
          :disabled="item.disabled"
          @click="act(item.action)"
        >
          <span class="block text-sm font-medium">{{ item.label }}</span>
          <span class="block text-[11px] text-muted">
            {{ item.disabled && item.reason ? item.reason : item.hint }}
          </span>
          <span class="tnum mt-0.5 block text-[11px] text-muted">−{{ item.energy }} energia</span>
        </button>
      </div>
    </section>

    <section class="px-4 pt-4">
      <div class="flex items-baseline justify-between pb-2">
        <h2 class="text-sm font-medium text-muted">Comer</h2>
        <span class="tnum text-xs text-muted">{{ mealsLeft }} refeições hoje</span>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="meal in MEALS"
          :key="meal.id"
          class="min-h-[56px] rounded-xl border border-line bg-surface px-2 py-2 disabled:opacity-40"
          :disabled="mealsLeft <= 0 || (player?.money ?? 0) < meal.cost"
          @click="act({ kind: 'comer', mealId: meal.id })"
        >
          <span class="block text-xs font-medium">{{ meal.name }}</span>
          <span class="tnum block text-[11px] text-muted">{{ formatMoney(meal.cost) }}</span>
          <span class="tnum block text-[11px] text-muted">+{{ meal.hunger }} fome</span>
        </button>
      </div>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Avançar tempo</h2>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="min-h-[48px] rounded-xl border border-line bg-surface text-sm font-medium"
          @click="advance(7)"
        >
          Uma semana
        </button>
        <button
          class="min-h-[48px] rounded-xl border border-line bg-surface text-sm font-medium"
          @click="advance(30)"
        >
          Um mês
        </button>
      </div>
      <p class="px-1 pb-2 pt-2 text-[11px] text-muted">
        Executa a rotina abaixo automaticamente e resume o que aconteceu.
      </p>
      <RoutineEditor />
    </section>

    <section v-if="game.dayLog.length" class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Registro</h2>
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="item in game.dayLog.slice(0, 8)"
          :key="item.id + item.dayIndex + item.text"
          class="flex items-baseline justify-between gap-3 rounded-xl bg-surface px-3 py-2"
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
      </ul>
    </section>
  </div>
</template>
