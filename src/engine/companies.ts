/**
 * Passo 5 do tick: operação das empresas. TypeScript puro.
 *
 * Nesta fase o resultado é **exógeno**: a receita persegue uma tendência que se
 * move com o ciclo, a sazonalidade do setor e a sensibilidade a juros, e a
 * margem comprime na recessão. A Fase 5 substitui a origem da receita pela
 * disputa de participação de mercado (resolução C4) sem mudar a forma do estado
 * nem o resto do pipeline — é por isso que `revenue`, `costs`, `cash` e
 * `profitHistory` já são exatamente os campos definitivos.
 */
import type { Company, GameState, LogEntry } from './types'
import type { DayMarkers } from './clock'
import { nextNormal } from './rng'
import { COMPANY_OPS, MACRO, MARKET } from '../data/config'
import { findIndustry, type IndustryDefinition } from '../data/industries'

/**
 * Efeito do ciclo sobre o resultado do setor. `rateSensitivity` negativa (banco)
 * inverte o sinal: juro alto engorda o spread bancário.
 */
export function cycleEarningsFactor(industry: IndustryDefinition, state: GameState): number {
  const demandPull = MACRO.demandFactor[state.macro.cyclePhase] - 1
  const ratePressure = industry.rateSensitivity * (state.macro.selic - MARKET.selicReference)
  return 1 + demandPull - ratePressure
}

/** Lucro anualizado pelos últimos 4 trimestres fechados. */
export function annualizedProfit(company: Company): number {
  const quarters = company.profitHistory.slice(0, 4)
  if (quarters.length === 0) return company.lastQuarterProfit * 4
  const sum = quarters.reduce((total, value) => total + value, 0)
  return (sum / quarters.length) * 4
}

/** Juros anuais que a dívida da empresa custa hoje. */
export function debtInterest(state: GameState, company: Company): number {
  return company.debt * (state.macro.selic + COMPANY_OPS.debtSpread)
}

/**
 * Um dia de operação. Separado de `stepCompanies` porque a IA da Fase 5b precisa
 * rodar exatamente esta função em modo hipotético (`projectQuarter`), sem
 * duplicar regra de negócio (spec §5.12).
 */
export function stepCompanyDay(draft: GameState, company: Company): void {
  const industry = findIndustry(company.industryId)
  if (!industry || company.status !== 'ativa') return

  // Tendência: cresce com inflação e com o crescimento real do setor.
  const dailyGrowth = (draft.macro.inflation + industry.realGrowth) / 365
  company.capacity *= 1 + dailyGrowth

  const month = draft.date.month
  const seasonality = industry.seasonality[month - 1] ?? 1
  const target = company.capacity * seasonality * cycleEarningsFactor(industry, draft)

  company.revenue +=
    (target - company.revenue) * COMPANY_OPS.revenueSpeed +
    company.revenue * nextNormal(draft.rng) * COMPANY_OPS.revenueNoise

  if (company.revenue < 0) company.revenue = 0

  // Margem comprime na recessão e expande no pico.
  const demandPull = MACRO.demandFactor[draft.macro.cyclePhase] - 1
  const margin = company.baseMargin * (1 + demandPull * COMPANY_OPS.marginCycleWeight)
  const operating = company.revenue * margin
  const interest = debtInterest(draft, company)
  const pretax = operating - interest

  company.costs = company.revenue - operating + interest
  const tax = pretax > 0 ? pretax * industry.taxRate : 0
  const annualProfit = pretax - tax

  const dailyProfit = annualProfit / 365
  company.cash += dailyProfit
  company.lastQuarterProfit += dailyProfit
}

function closeQuarter(draft: GameState, company: Company, log: LogEntry[]): void {
  company.profitHistory.unshift(company.lastQuarterProfit)
  if (company.profitHistory.length > COMPANY_OPS.profitHistorySize) {
    company.profitHistory.length = COMPANY_OPS.profitHistorySize
  }
  company.lastQuarterProfit = 0
  company.quartersReported += 1

  if (company.cash < 0) {
    company.quartersNegativeCash += 1
  } else {
    company.quartersNegativeCash = 0
  }

  if (
    company.status === 'ativa' &&
    company.quartersNegativeCash >= MARKET.quartersToBankruptcy
  ) {
    company.status = 'recuperacaoJudicial'
    company.quartersInRj = 0
    log.push({
      id: `rj-${company.id}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'critico',
      source: 'companies',
      text: `${company.name} entrou em recuperação judicial.`,
      amount: null,
    })
    return
  }

  if (company.status === 'recuperacaoJudicial') {
    company.quartersInRj += 1
    if (company.cash > 0) {
      // Sobreviveu: volta a operar.
      company.status = 'ativa'
      company.quartersInRj = 0
      company.quartersNegativeCash = 0
      log.push({
        id: `rj-out-${company.id}-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: 'bom',
        source: 'companies',
        text: `${company.name} saiu da recuperação judicial.`,
        amount: null,
      })
    } else if (company.quartersInRj >= MARKET.quartersToDelisting) {
      company.status = 'deslistada'
      log.push({
        id: `delist-${company.id}-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: 'critico',
        source: 'companies',
        text: `${company.name} foi deslistada. Quem tinha ação não tem mais nada.`,
        amount: null,
      })
    }
  }
}

export function stepCompanies(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    if (!company) continue
    if (company.status === 'deslistada' || company.status === 'fechada') continue

    // Empresa em recuperação judicial ainda opera, mas sem gerar caixa novo:
    // é o passo `closeQuarter` que decide se ela volta ou some.
    if (company.status === 'ativa') stepCompanyDay(draft, company)

    if (markers.isQuarterEnd) closeQuarter(draft, company, log)
  }
}
