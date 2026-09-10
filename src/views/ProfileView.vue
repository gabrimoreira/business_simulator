<script setup lang="ts">
import { computed, ref } from 'vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
import { useGameStore } from '@/stores/game'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { JOBS, findJob } from '@/data/jobs'
import { COURSES, findCourse } from '@/data/courses'
import { jobEligibility } from '@/engine/player'
import { CAREER } from '@/data/config'
import { isMuted, toggleMuted } from '@/ui/sound'
import { monthlyBudget } from '@/engine/selectors'
import { nominal } from '@/engine/macro'
import { useFlash } from '@/ui/useFlash'

const game = useGameStore()

// Patrimônio líquido pisca junto com o caixa: é o placar do jogo.
const worthFlash = useFlash(() => game.playerNetWorth, 0.005)
const fileInput = ref<HTMLInputElement | null>(null)
const message = ref<string | null>(null)

const player = computed(() => game.state?.player ?? null)

// Preferência do aparelho, não da partida: mora no localStorage e não viaja no
// save exportado. O `ref` existe só para a tela reagir ao clique.
const muted = ref(isMuted())
function onToggleSound(): void {
  muted.value = toggleMuted()
}

const job = computed(() => (player.value?.currentJobId ? findJob(player.value.currentJobId) : null))

const activeCourse = computed(() => {
  const active = player.value?.activeCourse
  if (!active) return null
  const course = findCourse(active.courseId)
  if (!course) return null
  return { course, done: active.daysDone, total: course.studyDays }
})

/** Vagas com o motivo da recusa à vista — a mesma resposta que a ação usa. */
const openings = computed(() => {
  const state = game.state
  if (!state) return []
  return JOBS.filter((item) => item.id !== state.player.currentJobId).map((item) => ({
    job: item,
    eligibility: jobEligibility(state, item.id),
  }))
})

const availableCourses = computed(() => {
  const state = game.state
  const p = player.value
  if (!state || !p) return []
  // Custo em nominal de hoje, como o motor cobra — a tabela está em R$ do ano 0.
  const orcamento = monthlyBudget(state)
  return COURSES.filter((course) => !p.education.includes(course.id)).map((course) => {
    const cost = nominal(state.macro, course.cost)
    return {
      course,
      cost,
      blocked:
        course.requires.find((id) => !p.education.includes(id)) ??
        (p.money < cost ? 'sem dinheiro' : null),
      /**
       * Matricular e ficar sem o que comer é a armadilha do início de jogo.
       *
       * Medido: com R$ 3.519 o jogador paga R$ 2.411 pelo curso, sobra R$ 1.108,
       * e cinco dias depois as contas do mês levam R$ 990. Aí não há comida, a
       * energia despenca, ele para de trabalhar e a partida trava por décadas
       * com o curso parado no quarto bloco.
       */
      apertado: p.money - cost < orcamento.totalExpenses,
    }
  })
})

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

/**
 * Encerrar por vontade própria.
 *
 * Pede confirmação porque **não é o mesmo que apagar**: encerrar fecha a
 * partida, escreve a manchete de fecho e grava o resultado no ranking, que
 * sobrevive ao New Game+. Um toque acidental aqui custa a corrida inteira.
 */
const quitting = ref(false)

function quit(): void {
  game.dispatch({ kind: 'encerrarPartida', ending: 'desistencia' })
  quitting.value = false
}
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Perfil" :subtitle="player ? player.name : ''" />

    <section v-if="player" class="px-4 pt-3">
      <div class="rounded-2xl border border-line bg-surface p-4">
        <div class="flex items-baseline justify-between">
          <p class="text-xs uppercase tracking-wide text-muted">Patrimônio líquido</p>
          <p class="tnum text-base font-semibold text-accent" :class="worthFlash">
            {{ formatMoneyCompact(game.playerNetWorth) }}
          </p>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
          <div class="flex justify-between gap-2">
            <dt class="shrink-0 text-muted">Idade</dt>
            <dd class="tnum">{{ player.age }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="shrink-0 text-muted">Emprego</dt>
            <dd class="truncate text-right">{{ job?.title ?? 'nenhum' }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="shrink-0 text-muted">Score</dt>
            <dd class="tnum">{{ player.creditScore }}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt class="shrink-0 text-muted">Reputação</dt>
            <dd class="tnum">{{ player.publicReputation }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section v-if="player" class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Carreira</h2>
      <div class="rounded-2xl border border-line bg-surface p-4">
        <template v-if="job">
          <div class="flex items-baseline justify-between">
            <p class="text-sm font-medium">{{ job.title }}</p>
            <p class="tnum text-sm text-accent">{{ formatMoney(player.career.salary) }}/mês</p>
          </div>
          <div class="mt-3">
            <div class="flex items-baseline justify-between">
              <span class="text-xs text-muted">Desempenho</span>
              <span class="tnum text-xs text-muted">
                {{ Math.round(player.career.performance) }}/{{ CAREER.minPerformanceForPromotion }}
                para promoção
              </span>
            </div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                class="h-full rounded-full bg-accent"
                :style="{ width: `${Math.max(0, Math.min(100, player.career.performance))}%` }"
              />
            </div>
          </div>
          <p class="tnum mt-2 text-xs text-muted">{{ player.career.daysInJob }} dias no cargo</p>
          <button
            class="mt-3 min-h-[40px] w-full rounded-xl border border-line text-sm text-muted"
            @click="game.dispatch({ kind: 'pedirDemissao' })"
          >
            Pedir demissão
          </button>
        </template>
        <p v-else class="text-sm text-muted">Sem emprego. Candidate-se a uma vaga abaixo.</p>
      </div>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Vagas</h2>
      <ul class="flex flex-col gap-2">
        <li
          v-for="opening in openings"
          :key="opening.job.id"
          class="rounded-xl border border-line bg-surface p-3"
        >
          <div class="flex items-baseline justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ opening.job.title }}</p>
              <p class="tnum text-xs text-muted">
                {{ formatMoney(opening.job.salary) }}/mês · desgaste {{ opening.job.wear }}
              </p>
            </div>
            <button
              class="min-h-[40px] shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-bg disabled:opacity-30"
              :disabled="!opening.eligibility.ok"
              @click="game.dispatch({ kind: 'candidatar', jobId: opening.job.id })"
            >
              Candidatar
            </button>
          </div>
          <p v-if="!opening.eligibility.ok" class="pt-1.5 text-[11px] text-muted">
            {{ opening.eligibility.missing.join(' · ') }}
          </p>
        </li>
      </ul>
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Educação</h2>
      <div v-if="activeCourse" class="mb-2 rounded-xl border border-line bg-surface p-3">
        <div class="flex items-baseline justify-between">
          <p class="text-sm font-medium">{{ activeCourse.course.name }}</p>
          <p class="tnum text-xs text-muted">{{ activeCourse.done }}/{{ activeCourse.total }}</p>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full bg-accent"
            :style="{ width: `${(activeCourse.done / activeCourse.total) * 100}%` }"
          />
        </div>
      </div>
      <ul class="flex flex-col gap-2">
        <li
          v-for="item in availableCourses"
          :key="item.course.id"
          class="flex items-baseline justify-between gap-3 rounded-xl border border-line bg-surface p-3"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ item.course.name }}</p>
            <p class="tnum text-xs text-muted">
              {{ formatMoney(item.cost) }} · {{ item.course.studyDays }} blocos de estudo
            </p>
            <p v-if="item.blocked" class="text-[11px] text-muted">Requer: {{ item.blocked }}</p>
            <p v-else-if="item.apertado" class="text-[11px] text-warn">
              Depois de pagar, você fica sem o suficiente para as contas do mês.
            </p>
          </div>
          <button
            class="min-h-[40px] shrink-0 rounded-lg border border-line px-3 text-sm font-medium disabled:opacity-30"
            :disabled="!!item.blocked || !!activeCourse"
            @click="game.dispatch({ kind: 'matricular', courseId: item.course.id })"
          >
            Matricular
          </button>
        </li>
      </ul>
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
      <h2 class="pb-2 text-sm font-medium text-muted">Preferências</h2>
      <button
        class="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-line bg-surface px-4 text-sm font-medium"
        @click="onToggleSound"
      >
        <span>Som</span>
        <span :class="muted ? 'text-muted' : 'text-accent'">{{ muted ? 'desligado' : 'ligado' }}</span>
      </button>
      <p class="px-1 pt-1 text-xs text-muted">
        A vibração continua nos dois casos — é o retorno que funciona no silencioso.
      </p>
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
          v-if="!game.state?.meta.ending"
          class="min-h-[48px] rounded-xl border border-line bg-surface px-4 text-left text-sm font-medium"
          @click="quitting = !quitting"
        >
          {{ quitting ? 'cancelar' : 'Encerrar partida' }}
        </button>
        <div v-if="quitting" class="rounded-xl border border-warn/40 bg-surface p-3">
          <p class="text-xs leading-snug">
            Encerrar fecha a partida agora e grava o resultado no ranking. Não dá
            para voltar — mas o histórico e os arquétipos destravados
            permanecem.
          </p>
          <button
            class="mt-2 min-h-[44px] w-full rounded-lg border border-warn/50 text-sm font-semibold text-warn"
            @click="quit"
          >
            Encerrar aos {{ game.state?.player.age }} anos
          </button>
        </div>
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
