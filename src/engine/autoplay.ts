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
  AUTOPLAY_TOPUP_DAYS,
  MEALS_PER_DAY,
} from '../data/config'
import { MEALS } from '../data/living'
import { nominal } from './macro'

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
 * Traz dinheiro para o bolso quando o caixa não paga nem uma refeição: saca da
 * conta corrente e, se ainda faltar, resgata a aplicação que estiver livre.
 *
 * Existe porque a alternativa é o jogador **morrer de fome com dinheiro no
 * banco** — medido: a `tycoon` morreu aos 34 anos com R$ 6,66 milhões
 * aplicados, o caixa drenando R$ 341 por dia e a fome parada em 30. É o mesmo
 * princípio da ordem de débito: ninguém morre de fome ao lado da própria conta
 * bancária, e o avanço de tempo da UI cai neste mesmo caminho.
 *
 * Usa `sacar` e `resgatar`, as mesmas ações do jogador — nenhum poder
 * exclusivo do piloto automático (CLAUDE.md §4).
 */
function topUpCash(state: GameState): { state: GameState; log: LogEntry[] } {
  const log: LogEntry[] = []
  let current = state

  // Um mês de comida na refeição que o piloto automático escolheria.
  const ration =
    MEALS.find((meal) => meal.hunger >= AUTOPLAY_TARGET_HUNGER - AUTOPLAY_HUNGER_THRESHOLD) ??
    MEALS[MEALS.length - 1]
  if (!ration) return { state: current, log }
  const target =
    nominal(current.macro, ration.cost) * MEALS_PER_DAY * AUTOPLAY_TOPUP_DAYS

  for (const account of current.banking.accounts) {
    if (current.player.money >= target) break
    if (account.checking <= 0) continue
    const amount = Math.min(account.checking, target - current.player.money)
    const result = applyAction(current, { kind: 'sacar', bankId: account.bankId, amount })
    if (result.state === current) continue
    current = result.state
    log.push(...result.log)
  }

  for (const account of current.banking.accounts) {
    if (current.player.money >= target) break
    const locked =
      account.savingsLockedUntilDayIndex !== null &&
      current.date.dayIndex < account.savingsLockedUntilDayIndex
    if (locked || account.savings <= 0) continue
    const amount = Math.min(account.savings, target - current.player.money)
    const result = applyAction(current, { kind: 'resgatar', bankId: account.bankId, amount })
    if (result.state === current) continue
    current = result.state
    log.push(...result.log)
  }

  return { state: current, log }
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
  let toppedUp = false

  while (
    current.player.hunger < AUTOPLAY_HUNGER_THRESHOLD &&
    current.player.mealsToday < MEALS_PER_DAY
  ) {
    const affordable = MEALS.filter(
      (meal) => nominal(current.macro, meal.cost) <= current.player.money,
    )
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
    if (!meal) {
      // Nada cabe no bolso: tenta o banco uma vez e reavalia. Uma vez só, para
      // um jogador genuinamente quebrado não repetir saque recusado a cada volta.
      if (toppedUp) break
      toppedUp = true
      const top = topUpCash(current)
      if (top.state === current) break
      current = top.state
      log.push(...top.log)
      continue
    }
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
