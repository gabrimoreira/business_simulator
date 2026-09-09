/**
 * Passo 11 do tick: a percepção pública.
 *
 * Roda **fora** do `produce`, sobre o estado já finalizado. Dentro do draft, a
 * referência ao array de candles é um proxy que o Immer finaliza copiando — o
 * que fazia o tick ficar mais caro a cada candle acumulado. Do lado de fora, a
 * referência compartilhada é literal, como a resolução C12 pede.
 */
import type { DayMarkers } from './clock'
import type { GameState, PublicView } from './types'

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
export function buildPublicView(state: GameState, markers: DayMarkers): PublicView {
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
        employeeCount: company.workforce.headcount,
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

