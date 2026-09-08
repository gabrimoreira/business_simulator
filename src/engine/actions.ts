/**
 * `applyAction(state, action) => { state, log }` — contrato do spec §3.2.
 * Puro e determinístico: nada aqui lê relógio, DOM ou `Math.random`.
 *
 * Ação inválida **não lança**: devolve o estado intacto e um log explicando o
 * motivo. Quem chama (UI, autoplay, runner) trata os três casos do mesmo jeito.
 */
import { produce } from 'immer'
import type { ActionResult, GameAction, GameState, LogEntry, Skills } from './types'
import { ACTION_BLOCKS_PER_DAY, ACTION_COSTS, MEALS_PER_DAY, VITALS } from '../data/config'
import { findMeal } from '../data/living'
import { findJob } from '../data/jobs'
import { findCourse } from '../data/courses'
import { chance } from './rng'
import { clamp, hireChance, jobEligibility, performanceGain, workEnergyCost } from './player'

const clampVital = (value: number): number => clamp(value, 0, VITALS.max)

/**
 * Id determinístico: dia + blocos já gastos + tipo da ação. Precisa ser
 * reproduzível porque o log entra no estado, e o teste de determinismo compara
 * o estado inteiro.
 */
function entryFor(state: GameState, action: GameAction) {
  const id = `act-${state.date.dayIndex}-${state.player.blocksUsedToday}-${action.kind}`
  return (
    severity: LogEntry['severity'],
    text: string,
    amount: number | null = null,
  ): LogEntry => ({
    id,
    dayIndex: state.date.dayIndex,
    severity,
    source: 'action',
    text,
    amount,
  })
}

function blocksLeft(state: GameState): number {
  return ACTION_BLOCKS_PER_DAY - state.player.blocksUsedToday
}

function addSkills(target: Skills, grants: Partial<Skills>): void {
  for (const [key, value] of Object.entries(grants) as Array<[keyof Skills, number]>) {
    target[key] = clamp(target[key] + value, 0, 100)
  }
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  const log: LogEntry[] = []

  const entry = entryFor(state, action)

  const next = produce(state, (draft) => {
    const { player } = draft

    if (player.incarceratedDays > 0 && action.kind !== 'definirRotina') {
      log.push(entry('ruim', 'Você está preso e não pode agir.'))
      return
    }

    switch (action.kind) {
      case 'trabalhar':
      case 'horaExtra': {
        const config = action.kind === 'trabalhar' ? ACTION_COSTS.trabalhar : ACTION_COSTS.horaExtra
        if (!player.currentJobId) {
          log.push(entry('ruim', 'Você não tem emprego.'))
          return
        }
        const cost = workEnergyCost(state, config.energy)
        if (blocksLeft(state) < config.blocks) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (player.energy < cost) {
          log.push(entry('ruim', 'Energia insuficiente.'))
          return
        }
        player.blocksUsedToday += config.blocks
        player.energy = clampVital(player.energy - cost)
        player.career.performance = clamp(player.career.performance + performanceGain(state), 0, 100)

        if (action.kind === 'horaExtra') {
          const extra = (player.career.salary / 30) * (ACTION_COSTS.horaExtra.payMultiplier - 1)
          player.money += extra
          player.mood = clampVital(player.mood + ACTION_COSTS.horaExtra.moodDelta)
          log.push(entry('info', 'Hora extra.', extra))
        } else {
          player.mood = clampVital(player.mood + ACTION_COSTS.trabalhar.moodDelta)
          log.push(entry('info', 'Dia de trabalho.'))
        }
        return
      }

      case 'estudar': {
        const config = ACTION_COSTS.estudar
        if (!player.activeCourse) {
          log.push(entry('ruim', 'Você não está matriculado em nenhum curso.'))
          return
        }
        if (blocksLeft(state) < config.blocks) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (player.energy < config.energy) {
          log.push(entry('ruim', 'Energia insuficiente.'))
          return
        }
        player.blocksUsedToday += config.blocks
        player.energy = clampVital(player.energy - config.energy)
        player.skills.intelligence = clamp(
          player.skills.intelligence + config.intelligenceGain,
          0,
          100,
        )
        player.activeCourse.daysDone += 1

        const course = findCourse(player.activeCourse.courseId)
        if (course && player.activeCourse.daysDone >= course.studyDays) {
          // Concluído: concede as skills e entra em `education` uma única vez.
          addSkills(player.skills, course.grants)
          if (!player.education.includes(course.id)) player.education.push(course.id)
          player.activeCourse = null
          log.push(entry('bom', `Curso concluído: ${course.name}.`))
        } else {
          log.push(entry('info', 'Dia de estudo.'))
        }
        return
      }

      case 'academia':
      case 'lazer':
      case 'socializar': {
        const config = ACTION_COSTS[action.kind]
        if (blocksLeft(state) < config.blocks) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (player.energy < config.energy) {
          log.push(entry('ruim', 'Energia insuficiente.'))
          return
        }
        player.blocksUsedToday += config.blocks
        player.energy = clampVital(player.energy - config.energy)

        // Cada ramo lê a sua própria constante: indexar `ACTION_COSTS` pela união
        // devolve a união dos três formatos, e o TS não a estreita pelo `if`.
        if (action.kind === 'academia') {
          const academia = ACTION_COSTS.academia
          player.skills.fitness = clamp(player.skills.fitness + academia.fitnessGain, 0, 100)
          player.health = clampVital(player.health + academia.healthGain)
          log.push(entry('info', 'Treino feito.'))
        } else if (action.kind === 'lazer') {
          player.mood = clampVital(player.mood + ACTION_COSTS.lazer.moodGain)
          log.push(entry('info', 'Descanso.'))
        } else {
          const social = ACTION_COSTS.socializar
          player.skills.charisma = clamp(player.skills.charisma + social.charismaGain, 0, 100)
          player.contacts += social.contacts
          log.push(entry('info', 'Você fez contatos.'))
        }
        return
      }

      case 'comer': {
        const meal = findMeal(action.mealId)
        if (!meal) {
          log.push(entry('ruim', 'Refeição desconhecida.'))
          return
        }
        if (player.mealsToday >= MEALS_PER_DAY) {
          log.push(entry('ruim', 'Você já comeu o bastante hoje.'))
          return
        }
        if (player.money < meal.cost) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }
        player.money -= meal.cost
        player.mealsToday += 1
        player.hunger = clampVital(player.hunger + meal.hunger)
        player.health = clampVital(player.health + meal.health)
        player.mood = clampVital(player.mood + meal.mood)
        player.energy = clampVital(player.energy + meal.energy)
        log.push(entry('info', meal.name, -meal.cost))
        return
      }

      case 'matricular': {
        const course = findCourse(action.courseId)
        if (!course) {
          log.push(entry('ruim', 'Curso desconhecido.'))
          return
        }
        if (player.education.includes(course.id)) {
          log.push(entry('ruim', 'Você já concluiu esse curso.'))
          return
        }
        if (player.activeCourse) {
          log.push(entry('ruim', 'Você já está matriculado em outro curso.'))
          return
        }
        const missingRequisite = course.requires.find((id) => !player.education.includes(id))
        if (missingRequisite) {
          log.push(entry('ruim', `Exige ${missingRequisite} concluído.`))
          return
        }
        if (player.money < course.cost) {
          log.push(entry('ruim', 'Dinheiro insuficiente para a matrícula.'))
          return
        }
        player.money -= course.cost
        player.activeCourse = { courseId: course.id, daysDone: 0 }
        log.push(entry('info', `Matriculado em ${course.name}.`, -course.cost))
        return
      }

      case 'candidatar': {
        const job = findJob(action.jobId)
        if (!job) {
          log.push(entry('ruim', 'Vaga inexistente.'))
          return
        }
        if (player.currentJobId === job.id) {
          log.push(entry('ruim', 'Você já ocupa esse cargo.'))
          return
        }
        const eligibility = jobEligibility(state, job.id)
        if (!eligibility.ok) {
          log.push(entry('ruim', `Requisitos não atendidos: ${eligibility.missing.join('; ')}`))
          return
        }
        // Consome RNG mesmo quando falha: o determinismo depende do consumo, não
        // do resultado.
        const hired = chance(draft.rng, hireChance(state, job.id))
        if (!hired) {
          log.push(entry('ruim', `Você não foi selecionado para ${job.title}.`))
          return
        }
        player.currentJobId = job.id
        player.career.jobId = job.id
        player.career.salary = job.salary
        player.career.daysInJob = 0
        player.career.daysSinceLastRaise = 0
        player.career.performance = 50
        log.push(entry('bom', `Contratado: ${job.title}.`))
        return
      }

      case 'pedirDemissao': {
        if (!player.currentJobId) {
          log.push(entry('ruim', 'Você não tem emprego.'))
          return
        }
        player.currentJobId = null
        player.career.jobId = null
        player.career.salary = 0
        player.career.daysInJob = 0
        player.career.performance = 50
        log.push(entry('info', 'Você pediu demissão.'))
        return
      }

      case 'definirRotina': {
        if (action.routine.length === 0) {
          log.push(entry('ruim', 'A rotina não pode ser vazia.'))
          return
        }
        player.routine = action.routine.slice(0, ACTION_BLOCKS_PER_DAY)
        log.push(entry('info', 'Rotina atualizada.'))
        return
      }

      default:
        // Ações das fases seguintes; `avancarTempo` é roteada para runDays.
        log.push(entry('ruim', `Ação ainda não implementada: ${action.kind}.`))
    }
  })

  return { state: next, log }
}
