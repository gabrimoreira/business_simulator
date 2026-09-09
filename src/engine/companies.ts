/**
 * Passo 5 do tick: operação das empresas. TypeScript puro.
 *
 * A receita vem da **disputa de participação de mercado** (resolução C4 do
 * GAME_DESIGN): cada empresa tem uma atratividade função de qualidade, marca e
 * preço; a participação é a atratividade relativa dentro do setor; e a receita é
 * a demanda que couber na capacidade instalada.
 *
 *   atratividade = 0,40·qualidade^0,9 + 0,35·marca^0,8 + 0,25·fatorPreço
 *   share_i      = atratividade_i / Σ atratividade do setor
 *   unidades_i   = min(demanda_i, capacidade_i)
 *   receita_i    = unidades_i × preço_i
 *
 * Preço é índice em torno de 1,0: cortar preço ganha share e encolhe margem, que
 * é a tensão que a IA da Fase 5b vai explorar. **Mesma engine para a empresa do
 * jogador e para a concorrente** (spec §5.5).
 */
import type { Company, GameState, LogEntry } from './types'
import type { DayMarkers } from './clock'
import { nextNormal } from './rng'
import { COMPANY_OPS, MACRO, MARKET, OPERATIONS } from '../data/config'
import { findIndustry, type IndustryDefinition } from '../data/industries'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Efeito do ciclo sobre a demanda do setor; juro alto engorda o banco. */
export function cycleDemandFactor(industry: IndustryDefinition, state: GameState): number {
  const demandPull = MACRO.demandFactor[state.macro.cyclePhase] - 1
  const ratePressure = industry.rateSensitivity * (state.macro.selic - MARKET.selicReference)
  return Math.max(0.2, 1 + demandPull - ratePressure)
}

/**
 * Resposta da demanda **do setor** ao nível de preço. É o que impede o setor
 * inteiro de subir preço junto sem perder volume — sem isso o preço não tem
 * âncora nenhuma.
 */
export function marketDemandFactor(averagePrice: number): number {
  if (averagePrice <= 0) return OPERATIONS.priceFactorCap
  return (1 / averagePrice) ** OPERATIONS.marketPriceElasticity
}

/** Fator de preço da atratividade: preço abaixo da média do setor atrai. */
export function priceFactor(price: number, averagePrice: number): number {
  if (price <= 0) return OPERATIONS.priceFactorCap
  return Math.min(OPERATIONS.priceFactorCap, (averagePrice / price) ** OPERATIONS.priceElasticity)
}

/** Atratividade da empresa: o que decide a fatia que ela leva do setor. */
export function attractiveness(company: Company, averagePrice: number): number {
  const quality = (clamp(company.productQuality, 0, 100) / 100) ** OPERATIONS.qualityExponent
  const brand = (clamp(company.brandAwareness, 0, 100) / 100) ** OPERATIONS.brandExponent
  const price = priceFactor(company.price, averagePrice) ** OPERATIONS.priceExponent
  return brand * (OPERATIONS.qualityBase + OPERATIONS.qualityWeight * quality) * price
}

/** Capacidade anual em unidades: quadro × produtividade, corrigido pela moral. */
export function capacityOf(company: Company, industry: IndustryDefinition): number {
  // A moral **não** entra aqui de propósito: ela já move a produtividade. Somar
  // os dois criava o laço moral → capacidade → sobrecarga → moral, que levava
  // toda empresa a zero em três anos.
  const productivity = company.workforce.productivity / 100
  const labor = company.workforce.headcount * industry.outputPerEmployee * productivity
  // Gente sem máquina não produz: o menor dos dois manda.
  const capital = company.capitalStock * industry.capitalTurnover
  return Math.min(labor, capital)
}

/** Capital necessário para sustentar uma dada capacidade anual. */
export function capitalNeededFor(revenueCapacity: number, industry: IndustryDefinition): number {
  return revenueCapacity / industry.capitalTurnover
}

/** Custo variável por unidade, no índice de preço de referência. */
export function unitCost(industry: IndustryDefinition, company: Company): number {
  const contribution =
    company.baseMargin + industry.payrollRatio + company.directives.marketingRatio + company.directives.rndRatio
  return Math.max(0.05, 1 - contribution)
}

/** Lucro anualizado pelos últimos 4 trimestres fechados. */
export function annualizedProfit(company: Company): number {
  const quarters = company.profitHistory.slice(0, 4)
  if (quarters.length === 0) return company.lastQuarterProfit * 4
  const sum = quarters.reduce((total, value) => total + value, 0)
  return (sum / quarters.length) * 4
}

export function debtInterest(state: GameState, company: Company): number {
  return company.debt * (state.macro.selic + COMPANY_OPS.debtSpread)
}

/**
 * Valuation de venda: múltiplo do setor × lucro anualizado, descontado da dívida
 * e da reputação ruim, com piso em fração da receita (spec §5.5).
 */
export function valuationOf(company: Company, sectorMultiple: number): number {
  const profit = annualizedProfit(company)
  const base = Math.max(profit * sectorMultiple, company.revenue * OPERATIONS.saleRevenueFloor)
  const reputationPenalty = 1 - ((100 - company.reputation) / 100) * OPERATIONS.saleReputationWeight
  return Math.max(0, base * reputationPenalty - company.debt * OPERATIONS.saleDebtDiscount + company.cash)
}

// ---------------------------------------------------------------------------
// Passo diário
// ---------------------------------------------------------------------------

interface SectorAllocation {
  averagePrice: number
  /** Demanda diária do setor, em unidades. */
  dailyUnits: number
  shares: Map<string, number>
}

/**
 * Participações do setor no dia. Exportado porque o teste do §8 ("participações
 * somam 1 dentro de cada setor, todo tick") mede exatamente isto.
 */
export function allocateSector(
  state: GameState,
  industry: IndustryDefinition,
  companyIds: string[],
): SectorAllocation {
  const active = companyIds
    .map((id) => state.companies[id])
    .filter((company): company is Company => !!company && company.status !== 'deslistada' && company.status !== 'fechada')

  const averagePrice =
    active.length > 0 ? active.reduce((sum, company) => sum + company.price, 0) / active.length : 1

  let total = 0
  const scores = new Map<string, number>()
  for (const company of active) {
    const score = attractiveness(company, averagePrice)
    scores.set(company.id, score)
    total += score
  }

  const shares = new Map<string, number>()
  for (const [id, score] of scores) {
    shares.set(id, total > 0 ? score / total : 0)
  }

  const seasonality = industry.seasonality[state.date.month - 1] ?? 1
  const marketSize = state.industries[industry.id]?.marketSize ?? industry.marketSize
  const dailyUnits =
    (marketSize / 365) *
    seasonality *
    cycleDemandFactor(industry, state) *
    marketDemandFactor(averagePrice)

  return { averagePrice, dailyUnits, shares }
}

/**
 * Um dia de operação de uma empresa, dado o que o setor lhe alocou.
 *
 * Separada porque a IA da Fase 5b precisa rodar **esta** função em modo
 * hipotético (`projectQuarter`), sem duplicar regra de negócio (spec §5.12).
 */
export function stepCompanyDay(
  draft: GameState,
  company: Company,
  industry: IndustryDefinition,
  unitsSold: number,
  demandUnits: number,
): void {
  const capacity = capacityOf(company, industry) / 365
  const units = unitsSold

  const utilizationRatio = capacity > 0 ? Math.min(1, units / capacity) : 0
  const price = company.price * draft.macro.priceLevel
  const revenue = units * price
  const variable = units * unitCost(industry, company) * draft.macro.priceLevel

  const payroll = (company.workforce.headcount * company.workforce.avgSalary) / 365
  const marketing = revenue * company.directives.marketingRatio
  const rnd = revenue * company.directives.rndRatio
  const interest = debtInterest(draft, company) / 365

  const pretax = revenue - variable - payroll - marketing - rnd - interest
  const taxRate = draft.industries[industry.id]?.taxRate ?? industry.taxRate
  const tax = pretax > 0 ? pretax * taxRate : 0
  const profit = pretax - tax

  company.cash += profit
  company.lastQuarterProfit += profit
  company.marketingSpend = marketing * 365

  // Receita e custos ficam anualizados: é assim que a UI e o valuation leem.
  company.revenue = revenue * 365
  company.costs = (variable + payroll + marketing + rnd + interest) * 365
  company.capacity = capacity * 365

  // Marca e qualidade: sobem com gasto, decaem sozinhas.
  const sectorScale = Math.max(1, industry.marketSize / 365)
  const saturation = 1 - company.brandAwareness / 100
  company.brandAwareness = clamp(
    company.brandAwareness * (1 - OPERATIONS.brandDecayRate) +
      ((marketing / sectorScale) * OPERATIONS.brandGainPerRatio +
        utilizationRatio * OPERATIONS.brandGainPerUtilization) *
        saturation,
    0,
    100,
  )

  company.rndProgress += rnd
  const rndIntensity = revenue > 0 ? rnd / revenue : 0
  company.productQuality = clamp(
    company.productQuality * (1 - OPERATIONS.qualityDecayRate) +
      rndIntensity * OPERATIONS.qualityGainPerRndRatio,
    0,
    100,
  )

  // Reajuste de dissídio: sem ele o salário nominal congela enquanto o mercado
  // sobe com a inflação, e toda empresa do jogo perde a equipe em uma década.
  company.workforce.avgSalary *= 1 + draft.macro.inflation / 365

  // Moral persegue um alvo: salário acima do mercado sobe, sobrecarga derruba.
  const marketSalary = industry.outputPerEmployee * industry.payrollRatio * draft.macro.priceLevel
  const salaryGap = marketSalary > 0 ? company.workforce.avgSalary / marketSalary - 1 : 0
  // A sobrecarga satura: ter dez vezes mais demanda que capacidade não é dez
  // vezes pior que ter o dobro — e sem o teto a empresa nova, que sempre tem
  // mais demanda do que consegue atender, ficava com moral zero para sempre.
  const utilization = capacity > 0 ? demandUnits / capacity : 0
  const overload = Math.min(1, Math.max(0, utilization - 1))
  const moraleTarget = clamp(
    70 + salaryGap * OPERATIONS.moraleSalaryWeight - overload * OPERATIONS.moraleOverloadWeight,
    0,
    100,
  )
  company.workforce.morale += (moraleTarget - company.workforce.morale) * OPERATIONS.moraleSpeed

  const productivityTarget = clamp(80 + (company.workforce.morale - 50) * 0.4, 0, OPERATIONS.productivityMax)
  company.workforce.productivity +=
    (productivityTarget - company.workforce.productivity) * OPERATIONS.productivitySpeed

  // Capital deprecia todo dia e, na empresa dirigida pela IA, é reposto e
  // ampliado com parte do lucro — é o equivalente automático do que o jogador
  // faz com `expandirCapacidade`.
  company.capitalStock *= 1 - OPERATIONS.capitalDepreciation / 365
  if (company.managedBy === 'ai' && profit > 0) {
    company.capitalStock += profit * OPERATIONS.aiReinvestRatio
    company.cash -= profit * OPERATIONS.aiReinvestRatio
  }

  // Quadro persegue o alvo da diretriz. Para a empresa dirigida pela IA, o alvo
  // é a demanda que ela está deixando na mesa — sem isso a concorrente nunca
  // contrata, vive sobrecarregada e definha. A Fase 5b troca esta regra pelo
  // motor de utilidade.
  if (company.managedBy === 'ai' && industry.outputPerEmployee > 0) {
    // Não adianta contratar além do que o capital instalado sustenta.
    const supported = company.capitalStock * industry.capitalTurnover
    const wanted = Math.min(demandUnits * 365, supported)
    const needed = wanted / (industry.outputPerEmployee * (company.workforce.productivity / 100))
    company.directives.headcountTarget = Math.max(1, Math.round(needed))
  }
  const target = Math.max(1, company.directives.headcountTarget)
  const drift = (target - company.workforce.headcount) * OPERATIONS.headcountAdjustSpeed
  // Contratar custa caixa; demitir devolve folha, mas ninguém contrata sem ter.
  if (drift > 0 && company.cash > 0) {
    company.workforce.headcount += drift
    company.cash -= (drift * company.workforce.avgSalary) / 12
  } else if (drift < 0) {
    company.workforce.headcount = Math.max(1, company.workforce.headcount + drift)
  }
}

// ---------------------------------------------------------------------------
// Projeção hipotética (spec §5.12)
// ---------------------------------------------------------------------------

/** O que o agente enxerga de resultado ao projetar um candidato. */
export interface Projection {
  revenue: number
  profit: number
  cash: number
  share: number
  quality: number
  brand: number
  leverage: number
  margin: number
}

/** Alteração que o candidato aplica na empresa antes de projetar. */
export interface CandidateOverride {
  price?: number
  marketingRatio?: number
  rndRatio?: number
  headcountTarget?: number
  capitalAdd?: number
  payoutRatio?: number
}

function cloneForProjection(company: Company): Company {
  return {
    ...company,
    workforce: { ...company.workforce },
    directives: { ...company.directives },
    profitHistory: [...company.profitHistory],
    ownership: company.ownership.map((entry) => ({ ...entry })),
    stock: company.stock ? { ...company.stock, history: [] } : null,
  }
}

/**
 * Roda um trimestre hipotético com **a mesma** `stepCompanyDay` da simulação
 * real (spec §5.12): a IA não duplica regra de negócio, ela roda a engine em
 * modo hipotético.
 *
 * Os concorrentes ficam **congelados** no que o `PublicView` mostra — decisão
 * registrada no `GAME_DESIGN`: projetar o setor inteiro custaria quatro vezes o
 * orçamento da resolução C5 e compraria pouco, porque dentro de um trimestre
 * ninguém reage mesmo. É também o que a informação imperfeita da Regra 2 permite
 * saber.
 *
 * Passo semanal, 13 iterações: mesma regra, custo sete vezes menor.
 */
export function projectQuarter(
  state: GameState,
  company: Company,
  industry: IndustryDefinition,
  rivals: Company[],
  override: CandidateOverride,
  steps = 13,
  stepDays = 7,
): Projection {
  const subject = cloneForProjection(company)
  if (override.price !== undefined) {
    subject.price = override.price
    subject.directives.price = override.price
  }
  if (override.marketingRatio !== undefined) subject.directives.marketingRatio = override.marketingRatio
  if (override.rndRatio !== undefined) subject.directives.rndRatio = override.rndRatio
  if (override.headcountTarget !== undefined) subject.directives.headcountTarget = override.headcountTarget
  if (override.payoutRatio !== undefined) subject.directives.payoutRatio = override.payoutRatio
  if (override.capitalAdd) {
    subject.capitalStock += override.capitalAdd
    subject.cash -= override.capitalAdd
  }

  const frozen = rivals.map(cloneForProjection)
  const all = [subject, ...frozen]
  const averagePrice = all.reduce((sum, item) => sum + item.price, 0) / all.length

  let profit = 0
  const seasonality = industry.seasonality[state.date.month - 1] ?? 1
  const marketSize = state.industries[industry.id]?.marketSize ?? industry.marketSize
  const dailyUnits =
    (marketSize / 365) *
    seasonality *
    cycleDemandFactor(industry, state) *
    marketDemandFactor(averagePrice)

  let shareSum = 0
  for (let step = 0; step < steps; step += 1) {
    const scores = all.map((item) => attractiveness(item, averagePrice))
    const total = scores.reduce((sum, value) => sum + value, 0)
    const share = total > 0 ? (scores[0] ?? 0) / total : 0
    shareSum += share

    const cashBefore = subject.cash
    const capacity = capacityOf(subject, industry) / 365
    const units = Math.min(dailyUnits * share, capacity)
    for (let day = 0; day < stepDays; day += 1) {
      stepCompanyDay(state, subject, industry, units, dailyUnits * share)
    }
    profit += subject.cash - cashBefore
  }

  const revenue = subject.revenue
  return {
    revenue,
    profit,
    cash: subject.cash,
    share: shareSum / steps,
    quality: subject.productQuality,
    brand: subject.brandAwareness,
    leverage: revenue > 0 ? subject.debt / revenue : 0,
    margin: revenue > 0 ? (profit * (365 / (steps * stepDays))) / revenue : 0,
  }
}

function closeQuarter(draft: GameState, company: Company, log: LogEntry[]): void {
  company.profitHistory.unshift(company.lastQuarterProfit)
  if (company.profitHistory.length > COMPANY_OPS.profitHistorySize) {
    company.profitHistory.length = COMPANY_OPS.profitHistorySize
  }
  company.lastQuarterProfit = 0
  company.quartersReported += 1
  company.quartersNegativeCash = company.cash < 0 ? company.quartersNegativeCash + 1 : 0

  if (company.status === 'ativa' && company.quartersNegativeCash >= MARKET.quartersToBankruptcy) {
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
        text: company.isPublic
          ? `${company.name} foi deslistada. Quem tinha ação não tem mais nada.`
          : `${company.name} fechou as portas.`,
        amount: null,
      })
    }
  }
}

export function stepCompanies(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  for (const industryId of draft.industryOrder) {
    const industry = findIndustry(industryId)
    const industryState = draft.industries[industryId]
    if (!industry || !industryState) continue

    // Tendência cresce com inflação e crescimento real; o tamanho corrente volta
    // para ela, o que impede os choques de evento de derivarem para sempre.
    industryState.trendSize *= 1 + (draft.macro.inflation + industry.realGrowth) / 365
    industryState.marketSize +=
      (industryState.trendSize - industryState.marketSize) * OPERATIONS.marketSizeReversion

    const ids = industryState.companyOrder
    const allocation = allocateSector(draft, industry, ids)
    industryState.averagePrice = allocation.averagePrice

    // Alocação em duas passadas. A primeira decide quantas unidades cada uma
    // vende, redistribuindo o que não coube na capacidade de quem estourou; a
    // segunda roda o dia. Rodar `stepCompanyDay` de novo para redistribuir
    // contabilizaria receita e custo em dobro.
    const demand = new Map<string, number>()
    const capacity = new Map<string, number>()
    const sold = new Map<string, number>()
    let unmet = 0

    for (const id of ids) {
      const company = draft.companies[id]
      if (!company) continue
      if (company.status === 'deslistada' || company.status === 'fechada') {
        company.marketShare = 0
        continue
      }
      const share = allocation.shares.get(id) ?? 0
      const wanted = allocation.dailyUnits * share
      const room = capacityOf(company, industry) / 365
      demand.set(id, wanted)
      capacity.set(id, room)
      sold.set(id, Math.min(wanted, room))
      unmet += Math.max(0, wanted - room)
    }

    if (unmet > 0.001) {
      const spare = [...capacity.entries()].filter(([id, room]) => room - (sold.get(id) ?? 0) > 0)
      const totalSpare = spare.reduce((sum, [id, room]) => sum + (room - (sold.get(id) ?? 0)), 0)
      for (const [id, room] of spare) {
        const free = room - (sold.get(id) ?? 0)
        const extra = totalSpare > 0 ? Math.min(free, unmet * (free / totalSpare)) : 0
        sold.set(id, (sold.get(id) ?? 0) + extra)
      }
    }

    // Participação é a **realizada**: quem não tem capacidade para atender não
    // fica com a fatia, ela vai para quem entregou. Reportar a fatia alocada
    // dava a uma empresa de uma pessoa 16% de um setor de bilhões.
    const totalSold = [...sold.values()].reduce((sum, value) => sum + value, 0)
    for (const id of ids) {
      const company = draft.companies[id]
      if (!company || company.status === 'deslistada' || company.status === 'fechada') continue
      company.marketShare = totalSold > 0 ? (sold.get(id) ?? 0) / totalSold : 0
      stepCompanyDay(draft, company, industry, sold.get(id) ?? 0, demand.get(id) ?? 0)
    }

    // Ruído idiossincrático: duas empresas idênticas não têm o mesmo trimestre.
    for (const id of ids) {
      const company = draft.companies[id]
      if (!company || company.status !== 'ativa') continue
      company.cash += (company.revenue / 365) * nextNormal(draft.rng) * COMPANY_OPS.revenueNoise
    }

    if (markers.isQuarterEnd) {
      for (const id of ids) {
        const company = draft.companies[id]
        if (company) closeQuarter(draft, company, log)
      }
    }
  }
}
