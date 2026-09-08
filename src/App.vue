<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import BottomNav from '@/components/BottomNav.vue'
import NewGamePanel from '@/components/NewGamePanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import { useGameStore } from '@/stores/game'

const game = useGameStore()

onMounted(() => {
  void game.load()
})
</script>

<template>
  <div class="flex h-dvh flex-col bg-bg">
    <template v-if="game.status === 'carregando' || game.status === 'inicial'">
      <div class="flex flex-1 items-center justify-center">
        <p class="text-sm text-muted">Carregando…</p>
      </div>
    </template>

    <template v-else-if="game.status === 'erro'">
      <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p class="text-base font-semibold">Não foi possível abrir o save</p>
        <p class="selectable text-sm text-muted">{{ game.error }}</p>
      </div>
    </template>

    <NewGamePanel v-else-if="!game.hasGame" />

    <template v-else>
      <StatusBar />
      <main class="flex-1 overflow-y-auto overscroll-contain pb-2">
        <RouterView />
      </main>
      <BottomNav />
    </template>
  </div>
</template>
