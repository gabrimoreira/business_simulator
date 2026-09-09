<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatMoneyCompact } from '@/lib/format'
import { ENDGAME } from '@/data/config'

const game = useGameStore()

const ENDING_TITLE: Record<string, string> = {
  aposentadoria: 'Você chegou aos 65',
  morte: 'Fim da linha',
  falencia: 'Você quebrou',
  prisao: 'A conta chegou',
}

const run = computed(() => {
  const state = game.state
  if (!state?.meta.ending) return null
  return {
    ending: state.meta.ending,
    title: ENDING_TITLE[state.meta.ending] ?? 'Fim de jogo',
    netWorth: game.playerNetWorth,
    years: Math.floor(state.date.dayIndex / 365),
    age: state.player.age,
    companies: state.meta.companiesFoundedCount,
    offices: state.meta.officesHeld,
    // Manchete de encerramento, escrita pelo veículo de maior alcance.
    headline:
      [...state.news.headlines].reverse().find((item) => item.id.startsWith('hl-fim-'))?.text ?? '',
    outlet: state.news.outlets[
      [...state.news.headlines].reverse().find((item) => item.id.startsWith('hl-fim-'))?.outletId ??
        ''
    ]?.name,
  }
})

const unlockedNow = computed(() =>
  (game.state?.meta.unlockedArchetypes ?? []).filter((id) => id !== 'comum'),
)

const ARCHETYPE_LABEL: Record<string, string> = {
  herdeiro: 'Herdeiro — começa com dinheiro e reputação manchada',
  genio: 'Gênio — inteligência alta, carisma baixo',
  filhoDePolitico: 'Filho de político — contatos e reputação de berço',
}

async function restart(): Promise<void> {
  await game.deleteGame()
}
</script>

<template>
  <div
    v-if="run"
    class="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg px-6"
    style="padding-top: calc(env(safe-area-inset-top, 0px) + 3rem); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 2rem)"
  >
    <p class="text-xs uppercase tracking-[0.2em] text-accent">{{ run.years }} anos de jogo</p>
    <h1 class="mt-2 text-3xl font-semibold leading-tight tracking-tight">{{ run.title }}</h1>

    <blockquote
      v-if="run.headline"
      class="mt-5 border-l-2 border-accent pl-4"
    >
      <p class="text-base leading-snug">{{ run.headline }}</p>
      <p v-if="run.outlet" class="pt-1 text-[11px] uppercase tracking-wide text-muted">
        {{ run.outlet }}
      </p>
    </blockquote>

    <dl class="mt-6 grid grid-cols-2 gap-3">
      <div class="rounded-xl border border-line bg-surface p-3">
        <dt class="text-[11px] text-muted">Patrimônio líquido</dt>
        <dd class="tnum text-lg font-semibold text-accent">
          {{ formatMoneyCompact(run.netWorth) }}
        </dd>
      </div>
      <div class="rounded-xl border border-line bg-surface p-3">
        <dt class="text-[11px] text-muted">Idade final</dt>
        <dd class="tnum text-lg font-semibold">{{ run.age }}</dd>
      </div>
      <div class="rounded-xl border border-line bg-surface p-3">
        <dt class="text-[11px] text-muted">Empresas fundadas</dt>
        <dd class="tnum text-lg font-semibold">{{ run.companies }}</dd>
      </div>
      <div class="rounded-xl border border-line bg-surface p-3">
        <dt class="text-[11px] text-muted">Cargos ocupados</dt>
        <dd class="text-sm font-semibold">
          {{ run.offices.length ? run.offices.join(', ') : 'nenhum' }}
        </dd>
      </div>
    </dl>

    <section v-if="unlockedNow.length" class="mt-6">
      <h2 class="pb-2 text-sm font-medium text-muted">Desbloqueado para a próxima</h2>
      <p
        v-for="id in unlockedNow"
        :key="id"
        class="rounded-xl border border-accent/40 bg-surface p-3 text-sm"
      >
        {{ ARCHETYPE_LABEL[id] ?? id }}
      </p>
    </section>

    <section v-if="game.ranking.length" class="mt-6">
      <h2 class="pb-2 text-sm font-medium text-muted">Ranking local</h2>
      <ol class="flex flex-col gap-1.5">
        <li
          v-for="(entry, index) in game.ranking.slice(0, ENDGAME.rankingSize)"
          :key="entry.id"
          class="flex items-baseline justify-between gap-3 rounded-xl bg-surface px-3 py-2"
        >
          <span class="truncate text-sm">
            {{ index + 1 }}. {{ entry.playerName }}
            <span class="text-[11px] text-muted">{{ entry.ending }}</span>
          </span>
          <span class="tnum shrink-0 text-sm text-accent">
            {{ formatMoneyCompact(entry.netWorth) }}
          </span>
        </li>
      </ol>
    </section>

    <button
      class="mt-8 min-h-[52px] w-full rounded-xl bg-accent text-base font-semibold text-bg"
      @click="restart"
    >
      Começar de novo
    </button>
  </div>
</template>
