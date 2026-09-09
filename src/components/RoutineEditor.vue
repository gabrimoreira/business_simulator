<script setup lang="ts">
/**
 * Escolhe os três blocos que o avanço de tempo executa todo dia.
 *
 * Fica colado no botão de avançar tempo, e não no Perfil, porque é ali que a
 * pergunta aparece: "executa sua rotina automaticamente" não quer dizer nada se
 * não dá para ver nem trocar qual é.
 *
 * A rotina inicial é `trabalhar / lazer / trabalhar`, e o segundo `trabalhar`
 * **não rende nada** além de desempenho — o salário é mensal (GAME_DESIGN §7).
 * Sem este editor o jogador rodava o loop principal do jogo numa configuração
 * ruim sem ter como corrigir.
 */
import { computed } from 'vue'
import type { ActionBlockKind } from '@/engine/types'
import { useGameStore } from '@/stores/game'
import { ACTION_BLOCKS_PER_DAY, ACTION_COSTS } from '@/data/config'

const game = useGameStore()

/**
 * O que cada bloco faz, em uma linha.
 *
 * `gerir` fica de fora: pela resolução C2 a gestão é diretriz persistente, não
 * ação diária, e `autoplay` já a trata como bloco vazio.
 */
const OPTIONS: Array<{ kind: ActionBlockKind; label: string; hint: string }> = [
  { kind: 'trabalhar', label: 'Trabalhar', hint: 'desempenho para promoção' },
  { kind: 'horaExtra', label: 'Hora extra', hint: 'paga mais, custa humor' },
  { kind: 'estudar', label: 'Estudar', hint: 'exige matrícula ativa' },
  { kind: 'academia', label: 'Academia', hint: 'preparo e saúde' },
  { kind: 'lazer', label: 'Lazer', hint: 'humor' },
  { kind: 'socializar', label: 'Socializar', hint: 'carisma e contatos' },
]

const routine = computed<ActionBlockKind[]>(() => {
  const current = game.state?.player.routine ?? []
  // Completa até três: rotina curta é válida na engine (ela cicla), mas um
  // editor com buraco confunde.
  return Array.from(
    { length: ACTION_BLOCKS_PER_DAY },
    (_, i) => current[i % Math.max(1, current.length)] ?? 'lazer',
  )
})

const energyCost = computed(() =>
  routine.value.reduce((total, kind) => {
    const cost = ACTION_COSTS[kind as keyof typeof ACTION_COSTS]
    return total + (cost?.energy ?? 0)
  }, 0),
)

/** Sem descanso o dia não fecha: é a resolução C3, e ela tem número. */
const noRest = computed(() => !routine.value.includes('lazer'))

function setBlock(index: number, kind: ActionBlockKind): void {
  const next = [...routine.value]
  next[index] = kind
  game.dispatch({ kind: 'definirRotina', routine: next })
}
</script>

<template>
  <div class="rounded-xl border border-line bg-surface p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-xs font-medium uppercase tracking-wide text-muted">Rotina do dia</h3>
      <span class="tnum text-[11px] text-muted">−{{ energyCost }} energia</span>
    </div>

    <div class="mt-2 flex flex-col gap-2">
      <div v-for="(block, index) in routine" :key="index" class="flex items-center gap-2">
        <span class="w-4 shrink-0 text-center text-[11px] text-muted">{{ index + 1 }}</span>
        <div class="flex flex-1 flex-wrap gap-1">
          <button
            v-for="option in OPTIONS"
            :key="option.kind"
            class="min-h-[44px] flex-1 rounded-lg border px-2 text-[11px] font-medium leading-tight"
            :class="
              block === option.kind
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line text-muted'
            "
            :aria-pressed="block === option.kind"
            @click="setBlock(index, option.kind)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="noRest" class="pt-2 text-[11px] text-down">
      Três blocos pesados não cabem no dia: sem lazer, humor e saúde despencam.
    </p>
    <p v-else class="pt-2 text-[11px] text-muted">
      {{ OPTIONS.find((o) => o.kind === routine[0])?.hint }}
    </p>
  </div>
</template>
