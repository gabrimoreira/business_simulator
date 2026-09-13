<script setup lang="ts">
import { RETIREMENT_AGE } from '@/data/config'
import { ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { START_AGE } from '@/data/config'
import type { StartArchetype } from '@/engine/types'

const game = useGameStore()
const name = ref('')
const busy = ref(false)
const archetype = ref<StartArchetype>('comum')

const ARCHETYPE_LABEL: Record<string, string> = {
  comum: 'Comum',
  herdeiro: 'Herdeiro',
  genio: 'Gênio',
  filhoDePolitico: 'Filho de político',
}

async function start(): Promise<void> {
  const trimmed = name.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  try {
    await game.startNewGame(trimmed, archetype.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="flex min-h-dvh flex-col justify-center gap-8 px-6"
    style="padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <div>
      <p class="text-xs uppercase tracking-[0.2em] text-accent">Capital</p>
      <h1 class="mt-2 text-3xl font-semibold leading-tight tracking-tight">
        Você tem {{ START_AGE }} anos<br />e nenhum centavo.
      </h1>
      <p class="mt-3 max-w-[38ch] text-sm leading-relaxed text-muted">
        Trabalhe, estude, invista, funde empresas. Compre o jornal que conta a história e financie
        quem escreve as regras. Até os {{ RETIREMENT_AGE }}.
      </p>
    </div>

    <form class="flex flex-col gap-3" @submit.prevent="start">
      <label class="text-sm text-muted" for="player-name">Seu nome</label>
      <input
        id="player-name"
        v-model="name"
        class="selectable min-h-[48px] rounded-xl border border-line bg-surface px-4 text-base outline-none focus:border-accent"
        type="text"
        maxlength="24"
        autocomplete="off"
        placeholder="Como a imprensa vai te chamar"
      />
      <div v-if="game.unlocked.length > 1" class="flex flex-wrap gap-2 pb-1">
        <button
          v-for="id in game.unlocked"
          :key="id"
          type="button"
          class="min-h-[40px] rounded-lg border px-3 text-xs"
          :class="archetype === id ? 'border-accent text-accent' : 'border-line text-muted'"
          @click="archetype = id"
        >
          {{ ARCHETYPE_LABEL[id] ?? id }}
        </button>
      </div>

      <button
        class="min-h-[48px] rounded-xl bg-accent px-4 text-base font-semibold text-bg disabled:opacity-40"
        type="submit"
        :disabled="!name.trim() || busy"
      >
        {{ busy ? 'Começando…' : 'Começar' }}
      </button>
    </form>
  </div>
</template>
