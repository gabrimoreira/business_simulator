/**
 * Estratégias do runner headless (spec §7). Vivem fora de `src/engine/` porque
 * são política de jogador, não regra de mundo — mas usam exatamente as mesmas
 * ações que a UI dispara.
 */
import type { ActionBlockKind, GameAction, GameState } from '@/engine/types'
import { JOBS } from '@/data/jobs'
import { COURSES } from '@/data/courses'
import { jobEligibility } from '@/engine/player'

/** Reserva de sobrevivência antes de gastar com matrícula: ~2 meses de custo. */
const SURVIVAL_BUFFER = 3000

export const STRATEGY_IDS = [
  'passive',
  'investor',
  'entrepreneur',
  'tycoon',
  'pricewar',
  'raider',
] as const
export type StrategyId = (typeof STRATEGY_IDS)[number]

export interface Strategy {
  id: StrategyId
  routine: ActionBlockKind[]
  /** Cursos que a estratégia persegue, em ordem. */
  coursePlan: string[]
  /** Intervalo entre tentativas de vaga, para não torrar o RNG todo dia. */
  applyEveryDays: number
}

const STRATEGIES: Record<StrategyId, Strategy> = {
  // "Só trabalha": sem estudar, a carreira trava no cargo 2 — é o que sustenta o
  // alvo de patrimônio do GAME_DESIGN §2.1.
  passive: {
    id: 'passive',
    // Um turno de trabalho por dia: o salário é mensal, então dobrar a jornada
    // não paga nada além de desempenho. O terceiro bloco vai para socializar,
    // que é o único caminho de carisma de quem não estuda — e sem carisma 30 a
    // carreira trava no cargo de entrada, não no cargo 2 previsto no §2.2.
    routine: ['trabalhar', 'socializar', 'lazer'],
    coursePlan: [],
    applyEveryDays: 30,
  },
  investor: {
    id: 'investor',
    routine: ['trabalhar', 'lazer', 'estudar'],
    coursePlan: ['tecnico', 'graduacao', 'pos', 'mba'],
    applyEveryDays: 30,
  },
  // As três abaixo ainda se comportam como `investor`; ganham corpo nas fases
  // 3, 5 e 6.
  entrepreneur: {
    id: 'entrepreneur',
    routine: ['trabalhar', 'estudar', 'lazer'],
    coursePlan: ['tecnico', 'graduacao'],
    applyEveryDays: 30,
  },
  tycoon: {
    id: 'tycoon',
    routine: ['trabalhar', 'estudar', 'socializar'],
    coursePlan: ['oratoria', 'graduacao', 'mba'],
    applyEveryDays: 30,
  },
  pricewar: {
    id: 'pricewar',
    routine: ['trabalhar', 'trabalhar', 'lazer'],
    coursePlan: [],
    applyEveryDays: 30,
  },
  raider: {
    id: 'raider',
    routine: ['trabalhar', 'estudar', 'lazer'],
    coursePlan: ['financas', 'graduacao'],
    applyEveryDays: 30,
  },
}

export function getStrategy(id: StrategyId): Strategy {
  return STRATEGIES[id]
}

/**
 * Ações fora dos blocos que a estratégia toma no dia: candidatar-se à melhor
 * vaga elegível e manter uma matrícula em curso.
 */
export function decideActions(state: GameState, strategy: Strategy): GameAction[] {
  const actions: GameAction[] = []
  const { player } = state

  // Desempregado procura todo dia; empregado tenta promoção na cadência. Sem
  // isso o jogador passa o primeiro mês sem renda e morre de fome.
  const searching =
    !player.currentJobId || state.date.dayIndex % strategy.applyEveryDays === 0
  if (searching) {
    const currentLevel = player.currentJobId
      ? (JOBS.find((job) => job.id === player.currentJobId)?.level ?? -1)
      : -1
    const best = JOBS.filter((job) => job.level > currentLevel)
      .filter((job) => jobEligibility(state, job.id).ok)
      .sort((a, b) => b.salary - a.salary)[0]
    if (best) actions.push({ kind: 'candidatar', jobId: best.id })
  }

  if (!player.activeCourse) {
    const next = strategy.coursePlan.find((id) => !player.education.includes(id))
    const course = next ? COURSES.find((item) => item.id === next) : undefined
    // Matricular gastando o último centavo mata de fome antes do primeiro
    // diploma: guarda uns meses de custo de vida antes de pagar a matrícula.
    if (course && player.money >= course.cost + SURVIVAL_BUFFER) {
      actions.push({ kind: 'matricular', courseId: course.id })
    }
  }

  return actions
}
