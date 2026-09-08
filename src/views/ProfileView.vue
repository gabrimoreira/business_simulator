<script setup lang="ts">
import { computed, ref } from 'vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatMoneyCompact } from '@/lib/format'

const game = useGameStore()
const fileInput = ref<HTMLInputElement | null>(null)
const message = ref<string | null>(null)

const player = computed(() => game.state?.player ?? null)

const skills = computed(() => {
  const s = player.value?.skills
  if (!s) return []
  return [
    { label: 'Inteligência', value: s.intelligence },
    { label: 'Carisma', value: s.charisma },
    { label: 'Técnica', value: s.technical },
    { label: 'Preparo físico', value: s.fitness },
  ]
})

function exportSave(): void {
  const json = game.exportSave()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `capital-save-${game.state?.date.dayIndex ?? 0}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  message.value = 'Save exportado.'
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await game.importSave(await file.text())
    message.value = 'Save importado.'
  } catch (err) {
    message.value = err instanceof Error ? err.message : 'Falha ao importar.'
  } finally {
    input.value = ''
  }
}

async function deleteGame(): Promise<void> {
  await game.deleteGame()
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Perfil" :subtitle="player ? player.name : ''" />

    <section v-if="player" class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <div class="flex items-baseline justify-between">
          <p class="text-xs uppercase tracking-wide text-muted">Patrimônio líquido</p>
          <p class="tnum text-base font-semibold text-accent">
            {{ formatMoneyCompact(game.playerNetWorth) }}
          </p>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">Idade</dt>
            <dd class="tnum">{{ player.age }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Emprego</dt>
            <dd>{{ player.currentJobId ?? 'nenhum' }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Score</dt>
            <dd class="tnum">{{ player.creditScore }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Reputação</dt>
            <dd class="tnum">{{ player.publicReputation }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Skills</h2>
      <div class="rounded-2xl border border-line bg-surface p-4">
        <div v-for="skill in skills" :key="skill.label" class="py-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-sm">{{ skill.label }}</span>
            <span class="tnum text-xs text-muted">{{ Math.round(skill.value) }}</span>
          </div>
          <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              class="h-full rounded-full bg-accent"
              :style="{ width: `${Math.max(0, Math.min(100, skill.value))}%` }"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Save</h2>
      <div class="flex flex-col gap-2">
        <button
          class="min-h-[48px] rounded-xl border border-line bg-surface px-4 text-left text-sm font-medium"
          @click="exportSave"
        >
          Exportar para arquivo
        </button>
        <button
          class="min-h-[48px] rounded-xl border border-line bg-surface px-4 text-left text-sm font-medium"
          @click="fileInput?.click()"
        >
          Importar de arquivo
        </button>
        <input
          ref="fileInput"
          class="hidden"
          type="file"
          accept="application/json"
          @change="onFileChosen"
        />
        <button
          class="min-h-[48px] rounded-xl border border-down/40 bg-surface px-4 text-left text-sm font-medium text-down"
          @click="deleteGame"
        >
          Apagar partida
        </button>
        <p v-if="message" class="selectable px-1 text-xs text-muted">{{ message }}</p>
        <p class="px-1 text-xs text-muted">
          Versão do save: {{ game.state?.saveVersion }} · seed {{ game.state?.rng.seed }}
        </p>
      </div>
    </section>
  </div>
</template>
