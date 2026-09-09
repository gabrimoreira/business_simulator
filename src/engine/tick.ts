/**
 * `worldTick(state, days) => { state, log }` — contrato do spec §3.2.
 *
 * **A ordem dos 11 passos é fixa e não pode ser alterada** (spec §3.3):
 *
 *   clock → macro → events → ai → companies → market → banking → politics →
 *   news → player → perception
 *
 * Notícia é sempre a penúltima etapa: ela reporta o que já aconteceu. Um evento
 * que "vaza antes" é rumor gerado no passo `events`, nunca uma inversão de ordem.
 *
 * O passo `perception` congela o `PublicView` do dia, que os agentes usarão
 * **amanhã** — é o que elimina a dependência circular entre agentes e cria o
 * atraso de informação que torna manipulação de mídia viável.
 *
 * Os passos ainda vazios existem como chamadas nominais aqui, na posição certa,
 * para que a ordem nasça completa e nenhuma fase futura precise reordenar nada.
 */
import { produce } from 'immer'
import type { DayLog, GameState, LogEntry, TickResult } from './types'
import { stepClock, type DayMarkers } from './clock'
import { stepMacro } from './macro'
import { stepEvents } from './events'
import { stepNews } from './news'
import { stepAi } from './agents'
import { stepCompanies } from './companies'
import { stepMarket } from './market'
import { stepBanking } from './banking'
import { stepPolitics } from './politics'
import { buildPublicView } from './perception'
import { stepPlayer } from './player'
import { LOG_WINDOW_SIZE } from '../data/config'

/* eslint-disable @typescript-eslint/no-unused-vars -- passos ainda vazios */

/* eslint-enable @typescript-eslint/no-unused-vars */

/** Simula um dia. Exportado para o teste de ordem do tick. */
export function tickOneDay(state: GameState): { state: GameState; log: LogEntry[] } {
  const log: LogEntry[] = []

  let markers: DayMarkers | null = null

  const next = produce(state, (draft) => {
    markers = stepClock(draft)
    stepMacro(draft, markers, log)
    stepEvents(draft, markers, log)
    stepAi(draft, markers, log)
    stepCompanies(draft, markers, log)
    stepMarket(draft, markers, log)
    stepBanking(draft, markers, log)
    stepPolitics(draft, markers, log)
    stepNews(draft, markers, log)
    stepPlayer(draft, markers, log)

    draft.log.push(...log)
    if (draft.log.length > LOG_WINDOW_SIZE) {
      draft.log.splice(0, draft.log.length - LOG_WINDOW_SIZE)
    }
  })

  // Passo 11, sobre o estado finalizado.
  const withPerception: GameState = markers
    ? { ...next, publicView: buildPublicView(next, markers) }
    : next

  return { state: withPerception, log }
}

export function worldTick(state: GameState, days: number): TickResult {
  const dayLogs: DayLog[] = []
  let current = state

  for (let i = 0; i < days; i += 1) {
    // Partida encerrada não avança mais: morte e aposentadoria são absorventes.
    if (current.meta.ending) break
    const result = tickOneDay(current)
    current = result.state
    dayLogs.push({
      dayIndex: current.date.dayIndex,
      entries: result.log,
      headlineIds: [],
    })
  }

  return { state: current, log: dayLogs }
}
