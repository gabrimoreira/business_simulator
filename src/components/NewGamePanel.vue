<script setup lang="ts">
import { ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { START_AGE } from '@/data/config'

const game = useGameStore()
const name = ref('')
const busy = ref(false)

async function start(): Promise<void> {
  const trimmed = name.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  try {
    await game.startNewGame(trimmed)
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
        quem escreve as regras. Até os 65.
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
