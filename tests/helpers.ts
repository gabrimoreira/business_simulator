/**
 * Helpers compartilhados pelos testes de engine.
 *
 * A regra que justifica este arquivo: **um jogador que não come morre no dia
 * ~35**, e a partir daí `worldTick` para de avançar porque a partida encerrou.
 * Qualquer teste que precise de tempo passando tem de alimentar o jogador, ou
 * mede silenciosamente um mundo congelado.
 */
import { applyAction } from '@/engine/actions'
import { worldTick } from '@/engine/tick'
import { createInitialState } from '@/engine/newGame'
import type { GameAction, GameState, LogEntry } from '@/engine/types'

export function fresh(seed = 42, name = 'Teste'): GameState {
  return createInitialState({ seed, playerName: name, now: 0 })
}

/** Estado com dinheiro de sobra, para testar regras que não são sobre grana. */
export function funded(state: GameState, money = 1_000_000): GameState {
  return { ...state, player: { ...state.player, money } }
}

/** Insiste na candidatura até ser contratado — a chance é ~39% por tentativa. */
export function hire(state: GameState, jobId = 'atendente'): GameState {
  let current = state
  for (let i = 0; i < 60 && !current.player.currentJobId; i += 1) {
    current = applyAction(current, { kind: 'candidatar', jobId }).state
  }
  if (!current.player.currentJobId) throw new Error('não foi contratado em 60 tentativas')
  return current
}

/** Empregado, com salário e caixa definidos, sem depender do RNG. */
export function employed(state: GameState, salary = 5000, money = 100_000): GameState {
  return {
    ...state,
    player: {
      ...state.player,
      money,
      currentJobId: 'atendente',
      career: { ...state.player.career, jobId: 'atendente', salary },
    },
  }
}

export function withMacro(state: GameState, patch: Partial<GameState['macro']>): GameState {
  return { ...state, macro: { ...state.macro, ...patch } }
}

/** Um dia de vida: come o necessário, executa a ação opcional e avança o tick. */
export function liveDay(
  state: GameState,
  action?: GameAction,
): { state: GameState; entries: LogEntry[] } {
  let current = state
  while (current.player.hunger < 60 && current.player.mealsToday < 3) {
    const before = current
    current = applyAction(current, { kind: 'comer', mealId: 'normal' }).state
    if (current === before) break
  }
  if (action) current = applyAction(current, action).state
  const result = worldTick(current, 1)
  return { state: result.state, entries: result.log[0]?.entries ?? [] }
}

/** Vários dias de vida, acumulando o log. */
export function advance(
  state: GameState,
  days: number,
): { state: GameState; entries: LogEntry[] } {
  let current = state
  const entries: LogEntry[] = []
  for (let day = 0; day < days; day += 1) {
    const result = liveDay(current)
    current = result.state
    entries.push(...result.entries)
  }
  return { state: current, entries }
}
