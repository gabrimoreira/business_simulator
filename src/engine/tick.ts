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
import { stepBanking } from './banking'
import { stepPlayer } from './player'
import { LOG_WINDOW_SIZE } from '../data/config'

/* eslint-disable @typescript-eslint/no-unused-vars -- passos ainda vazios */

/** Passo 3 — sorteio de eventos do mundo e rumores. Fase 4. */
function stepEvents(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/** Passo 4 — agentes NPC decidem lendo o PublicView de ontem. Fase 5b. */
function stepAi(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/** Passo 5 — receita, custos, lucro, caixa, moral, P&D. Fase 5. */
function stepCompanies(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/** Passo 6 — precificação de ações e execução de ordens. Fase 3. */
function stepMarket(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/** Passo 8 — aprovação, tramitação, eleições. Fase 7. */
function stepPolitics(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/** Passo 9 — converte os eventos do dia em manchetes por veículo. Fase 4. */
function stepNews(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Passo 11 — congela o `PublicView`. Enquanto a macro não se move e não há
 * empresas, publica só data e macro sem lag; a estrutura já é a definitiva.
 */
function stepPerception(draft: GameState): void {
  draft.publicView = {
    date: draft.date,
    macro: {
      asOfDayIndex: draft.date.dayIndex,
      selic: draft.macro.selic,
      inflation: draft.macro.inflation,
      confidence: draft.macro.confidence,
      marketIndex: draft.macro.marketIndex,
      unemployment: draft.macro.unemployment,
      cyclePhase: draft.macro.cyclePhase,
    },
    stocks: {},
    companies: {},
    companyOrder: [],
    headlines: draft.news.headlines,
    disclosures: draft.ownershipDisclosures,
    industryAveragePrice: {},
  }
}

/** Simula um dia. Exportado para o teste de ordem do tick. */
export function tickOneDay(state: GameState): { state: GameState; log: LogEntry[] } {
  const log: LogEntry[] = []

  const next = produce(state, (draft) => {
    const markers = stepClock(draft)
    stepMacro(draft, markers, log)
    stepEvents(draft, markers, log)
    stepAi(draft, markers, log)
    stepCompanies(draft, markers, log)
    stepMarket(draft, markers, log)
    stepBanking(draft, markers, log)
    stepPolitics(draft, markers, log)
    stepNews(draft, markers, log)
    stepPlayer(draft, markers, log)
    stepPerception(draft)

    draft.log.push(...log)
    if (draft.log.length > LOG_WINDOW_SIZE) {
      draft.log.splice(0, draft.log.length - LOG_WINDOW_SIZE)
    }
  })

  return { state: next, log }
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
