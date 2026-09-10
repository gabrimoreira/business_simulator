<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import AwayModal from '@/components/AwayModal.vue'
import BottomNav from '@/components/BottomNav.vue'
import EndScreen from '@/components/EndScreen.vue'
import NewGamePanel from '@/components/NewGamePanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import { useGameStore } from '@/stores/game'
import { installUnlockOnFirstGesture, play } from '@/ui/sound'

const game = useGameStore()

const ENDING_LABELS: Record<string, string> = {
  morte: 'Você morreu',
  aposentadoria: 'Você se aposentou',
  falencia: 'Você faliu',
  prisao: 'Você foi preso',
  desistencia: 'Você encerrou a partida',
}

const endingLabel = computed(() => {
  const ending = game.state?.meta.ending
  return ending ? (ENDING_LABELS[ending] ?? 'Fim de jogo') : ''
})

onMounted(async () => {
  // Antes do load: o áudio precisa estar armado quando o primeiro toque vier,
  // e o navegador só libera `AudioContext` dentro de um gesto do usuário.
  installUnlockOnFirstGesture()
  await game.load()
  if (game.hasGame) game.startTicker()
})

// O arpejo de fecho, uma vez só. Fica aqui e não no `EndScreen` porque a
// partida também pode encerrar durante um avanço de tempo, com a tela ainda
// montada — e um `onMounted` no componente perderia esse caso.
watch(
  () => game.state?.meta.ending ?? null,
  (ending, before) => {
    if (ending && !before) play('fim')
  },
)

// A partida pode nascer depois do load (tela de nova partida).
watch(
  () => game.hasGame,
  (has) => (has ? game.startTicker() : game.stopTicker()),
)

onUnmounted(() => game.stopTicker())
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
      <!-- Partida encerrada: o tick para de avançar, e sem este aviso a tela
           continua oferecendo ações que não fazem nada. A tela de encerramento
           com ranking e New Game+ é da Fase 8. -->
      <div
        v-if="game.state?.meta.ending"
        class="border-b border-down/40 bg-down/10 px-4 py-2 text-center text-xs text-down"
      >
        {{ endingLabel }} — o tempo parou aqui. Apague a partida no Perfil para recomeçar.
      </div>
      <main class="flex-1 overflow-y-auto overscroll-contain pb-2">
        <!-- `out-in` para as duas telas não se sobreporem durante o cruzamento,
             com duração curta: a barra inferior tem de responder como botão. -->
        <RouterView v-slot="{ Component }">
          <Transition name="aba" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
      <BottomNav />
      <Transition name="fecho" appear>
        <EndScreen v-if="game.state?.meta.ending" />
      </Transition>
      <Transition name="sheet">
        <AwayModal
          v-if="game.awayLog.length"
          :log="game.awayLog"
          :title="game.awayTitle"
          @close="game.clearAwayLog()"
        />
      </Transition>
    </template>
  </div>
</template>
