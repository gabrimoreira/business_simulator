/**
 * Avanço de tempo: gasta os blocos do dia segundo a rotina do jogador e chama o
 * tick. TypeScript puro.
 *
 * Existe porque três consumidores concretos precisam do **mesmo** caminho: o
 * botão de avançar semana/mês, o catch-up offline e o runner headless. Se cada
 * um tivesse o seu laço, a UI e o `sim` divergiriam e o balanceamento mediria
 * outra coisa que não o jogo.
 *
 * Nota de contrato: a `GameAction` `avancarTempo` é roteada para cá — ela não é
 * tratada por `applyAction`, que por contrato não avança o tempo.
 */
import type { ActionBlockKind, DayLog, GameAction, GameState, LogEntry } from './types'
import { applyAction } from './actions'
import { worldTick } from './tick'
import {
  ACTION_BLOCKS_PER_DAY,
  AUTOPLAY_HUNGER_THRESHOLD,
  AUTOPLAY_TARGET_HUNGER,
  MEALS_PER_DAY,
} from '../data/config'
import { MEALS } from '../data/living'

function actionFor(kind: ActionBlockKind): GameAction | null {
  switch (kind) {
    case 'trabalhar':
      return { kind: 'trabalhar' }
    case 'horaExtra':
      return { kind: 'horaExtra' }
    case 'estudar':
      return { kind: 'estudar' }
    case 'academia':
      return { kind: 'academia' }
    case 'lazer':
      return { kind: 'lazer' }
    case 'socializar':
      return { kind: 'socializar' }
    case 'gerir':
      // Gestão vira diretriz persistente (GAME_DESIGN C2): não há ação diária.
      return null
  }
}

/**
 * Come sozinho quando a fome cai abaixo do limiar, escolhendo a refeição mais
 * barata que couber no bolso. Sem isso, qualquer rotina automática mata o
 * jogador de fome em duas semanas — e o runner mediria a inanição, não a
 * estratégia.
 */
function autoEat(state: GameState): { state: GameState; log: LogEntry[] } {
  let current = state
  const log: LogEntry[] = []

  while (
    current.player.hunger < AUTOPLAY_HUNGER_THRESHOLD &&
    current.player.mealsToday < MEALS_PER_DAY
  ) {
    const affordable = MEALS.filter((meal) => meal.cost <= current.player.money)
    // A mais barata que realmente mata a fome; se nenhuma couber no bolso, a que
    // mais alimenta entre as possíveis. Comer sempre marmita é morte lenta:
    // ela restaura menos que o consumo diário e ainda tira saúde.
    const hunger = current.player.hunger
    const meal =
      affordable.find((item) => hunger + item.hunger >= AUTOPLAY_TARGET_HUNGER) ??
      // Ninguém mata a fome de uma vez: come a opção mais eficiente em custo por
      // ponto de fome e volta na próxima iteração. Escolher "a que mais
      // alimenta" fazia o jogador quebrado comprar restaurante.
      affordable.reduce<(typeof MEALS)[number] | null>(
        (best, item) =>
          best === null || item.cost / item.hunger < best.cost / best.hunger ? item : best,
        null,
      )
    if (!meal) break
    const result = applyAction(current, { kind: 'comer', mealId: meal.id })
    if (result.state === current) break
    current = result.state
    log.push(...result.log)
  }

  return { state: current, log }
}

/** Gasta os blocos restantes do dia segundo a rotina. */
export function runRoutineDay(state: GameState): { state: GameState; log: LogEntry[] } {
  let current = state
  const log: LogEntry[] = []

  const fed = autoEat(current)
  current = fed.state
  log.push(...fed.log)

  let guard = 0
  while (current.player.blocksUsedToday < ACTION_BLOCKS_PER_DAY && guard < ACTION_BLOCKS_PER_DAY) {
    const kind = current.player.routine[current.player.blocksUsedToday % current.player.routine.length]
    guard += 1
    if (!kind) break
    const action = actionFor(kind)
    if (!action) break
    const result = applyAction(current, action)
    // Ação recusada (sem energia, sem emprego): não insiste, o dia acabou. E o
    // log da recusa é descartado de propósito: a rotina automática esbarrando
    // no teto de energia é operação normal, não notícia — logá-la enchia o
    // resumo de um mês com trinta linhas de "Energia insuficiente".
    if (result.state.player.blocksUsedToday === current.player.blocksUsedToday) {
      current = result.state
      break
    }
    log.push(...result.log)
    current = result.state
  }

  return { state: current, log }
}

export interface RunDaysResult {
  state: GameState
  log: DayLog[]
}

/**
 * Roda `days` dias: rotina do dia, depois o tick. Para assim que a partida
 * encerra (morte ou aposentadoria).
 */
export function runDays(state: GameState, days: number): RunDaysResult {
  let current = state
  const dayLogs: DayLog[] = []

  for (let i = 0; i < days; i += 1) {
    if (current.meta.ending) break

    const routine = runRoutineDay(current)
    current = routine.state

    const ticked = worldTick(current, 1)
    current = ticked.state

    const tickEntries = ticked.log[0]?.entries ?? []
    dayLogs.push({
      dayIndex: current.date.dayIndex,
      entries: [...routine.log, ...tickEntries],
      headlineIds: [],
    })
  }

  return { state: current, log: dayLogs }
}
