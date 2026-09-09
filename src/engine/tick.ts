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
import type { DayLog, GameState, LogEntry, PublicView, TickResult } from './types'
import { stepClock, type DayMarkers } from './clock'
import { stepMacro } from './macro'
import { stepEvents } from './events'
import { stepNews } from './news'
import { stepCompanies } from './companies'
import { stepMarket } from './market'
import { stepBanking } from './banking'
import { stepPlayer } from './player'
import { LOG_WINDOW_SIZE } from '../data/config'

/* eslint-disable @typescript-eslint/no-unused-vars -- passos ainda vazios */

/** Passo 4 — agentes NPC decidem lendo o PublicView de ontem. Fase 5b. */
function stepAi(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/** Passo 8 — aprovação, tramitação, eleições. Fase 7. */
function stepPolitics(_draft: GameState, _markers: DayMarkers, _log: LogEntry[]): void {}

/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Passo 11 — congela o `PublicView` que os agentes vão ler **amanhã**.
 *
 * Roda **fora** do `produce`, sobre o estado já finalizado. Dentro do draft, a
 * referência ao array de candles é um proxy que o Immer finaliza copiando — o
 * que fazia o tick ficar mais caro a cada candle acumulado. Do lado de fora, a
 * referência compartilhada é literal, como a resolução C12 pede.
 *
 * Preço e volume são públicos em tempo real; **balanço não**. Os números das
 * empresas só são reescritos no fim de trimestre e, fora dele, o snapshot
 * anterior é carregado adiante por referência. É esse atraso de até um
 * trimestre que a §5.12 Regra 2 exige, e é ele que torna manipulação de mídia
 * viável mais adiante.
 */
function buildPublicView(state: GameState, markers: DayMarkers): PublicView {
  const stocks: PublicView['stocks'] = {}
  for (const id of state.companyOrder) {
    const stock = state.companies[id]?.stock
    if (!stock) continue
    // `history` compartilha referência com o estado: copiar 28 × 365 candles por
    // dia seria caro e inútil, já que candle fechado é imutável (C12).
    stocks[id] = { price: stock.price, volume: stock.volumeToday, history: stock.history }
  }

  let companies = state.publicView.companies
  let companyOrder = state.publicView.companyOrder

  if (markers.isQuarterEnd || companyOrder.length === 0) {
    companies = {}
    companyOrder = []
    for (const id of state.companyOrder) {
      const company = state.companies[id]
      if (!company) continue
      companies[id] = {
        companyId: id,
        asOfDayIndex: state.date.dayIndex,
        revenue: company.revenue,
        profit: company.profitHistory[0] ?? 0,
        cash: company.cash,
        debt: company.debt,
        employeeCount: company.employees.length,
        marketShare: company.marketShare,
        reputation: company.reputation,
        // Empresa privada não divulga preço: o concorrente enxerga pouco (C13).
        price: company.isPublic ? company.price : null,
      }
      companyOrder.push(id)
    }
  }

  const industryAveragePrice: Record<string, number> = {}
  for (const industryId of state.industryOrder) {
    industryAveragePrice[industryId] = state.industries[industryId]?.averagePrice ?? 0
  }

  return {
    date: state.date,
    macro: {
      asOfDayIndex: state.date.dayIndex,
      selic: state.macro.selic,
      inflation: state.macro.inflation,
      confidence: state.macro.confidence,
      marketIndex: state.macro.marketIndex,
      unemployment: state.macro.unemployment,
      cyclePhase: state.macro.cyclePhase,
    },
    stocks,
    companies,
    companyOrder,
    headlines: state.news.headlines,
    disclosures: state.ownershipDisclosures,
    industryAveragePrice,
  }
}

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
