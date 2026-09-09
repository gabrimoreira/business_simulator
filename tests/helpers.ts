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

/**
 * Vários dias de vida, acumulando o log.
 *
 * **Grita se a partida encerrar no meio.** `worldTick` para de avançar quando
 * `meta.ending` é marcado, então um jogador que morre de fome congela o mundo — e
 * o helper devolveria, em silêncio, um estado parado no dia da morte. Já custou
 * horas de diagnóstico em quatro fases: testes mediam "dez anos" que na verdade
 * eram sessenta dias.
 */
export function advance(
  state: GameState,
  days: number,
): { state: GameState; entries: LogEntry[] } {
  if (days > SYNC_DAY_LIMIT) {
    throw new Error(
      `advance() só vai até ${SYNC_DAY_LIMIT} dias; foram pedidos ${days}. ` +
        'Use await advanceAsync(): acima disso o corpo do teste bloqueia o worker por mais de um minuto ' +
        'e o RPC do reporter estoura, deixando `vitest run` vermelho com todos os testes verdes.',
    )
  }
  return runDaysSync(state, days)
}

/**
 * O limite de dias que `advance()` aceita rodar de uma vez.
 *
 * O número vem do birpc do vitest: o worker manda `onTaskUpdate` ao reporter e
 * tem **60 segundos** para ler a resposta. Um dia de mundo listado custa até
 * ~50ms, então cerca de 1.200 dias já estouram. 700 deixa margem de sobra.
 */
const SYNC_DAY_LIMIT = 700

/**
 * `advance()` para horizontes longos, cedendo o event loop de vez em quando.
 *
 * Não muda uma única asserção: a engine é pura e síncrona, o `await` só
 * devolve a vez ao worker para ele responder ao reporter. Ceder por tempo, e
 * não a cada N dias, porque o custo do dia varia em duas ordens de grandeza
 * entre um jogador desempregado e um mundo com 28 listadas operando.
 */
export async function advanceAsync(
  state: GameState,
  days: number,
  onDay?: (state: GameState) => void,
): Promise<{ state: GameState; entries: LogEntry[] }> {
  let current = state
  const entries: LogEntry[] = []
  let lastYield = Date.now()
  for (let day = 0; day < days; day += 1) {
    const result = runDaysSync(current, 1)
    current = result.state
    entries.push(...result.entries)
    onDay?.(current)
    if (Date.now() - lastYield > YIELD_EVERY_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      lastYield = Date.now()
    }
  }
  return { state: current, entries }
}

/** Um segundo de CPU entre respiros: 60x de margem contra o timeout do birpc. */
const YIELD_EVERY_MS = 1000

function runDaysSync(
  state: GameState,
  days: number,
): { state: GameState; entries: LogEntry[] } {
  let current = state
  const entries: LogEntry[] = []
  for (let day = 0; day < days; day += 1) {
    const before = current.date.dayIndex
    const result = liveDay(current)
    current = result.state
    entries.push(...result.entries)
    if (current.date.dayIndex === before) {
      throw new Error(
        `advance() parou no dia ${before} de ${days}: a partida encerrou (${current.meta.ending ?? 'motivo desconhecido'}). ` +
          'Financie o jogador com funded() antes de simular.',
      )
    }
  }
  return { state: current, entries }
}
