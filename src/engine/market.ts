/**
 * Passo 6 do tick: precificação das ações, execução de ordens, dividendos e
 * imposto. TypeScript puro.
 *
 * A fórmula de preço é a do spec §5.3, com as constantes em `data/config.ts`:
 *
 *   drift      = clamp((valorJusto − preço) / preço, ±5%) × meanReversionRate
 *   marketMove = beta × variação diária do índice
 *   eventShock = choques de notícia do dia (Fase 4)
 *   noise      = normal × volatilidade do papel
 */
import type { Candle, Company, GameState, LogEntry, Order, Position, Stock } from './types'
import type { DayMarkers } from './clock'
import { nextNormal } from './rng'
import { MARKET } from '../data/config'
import { findIndustry } from '../data/industries'
import { annualizedProfit } from './companies'
import { debit } from './banking'
import { applyControl, checkDisclosure, resolveTender } from './ownership'
import { CONTROL } from '../data/config'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Múltiplo pago pelo setor. Encolhe quando a Selic sobe — é o canal pelo qual o
 * juro derruba a bolsa inteira. O piso na Selic evita múltiplo explodindo
 * quando o juro vai a zero; o clamp final evita o setor inteiro virar pó num
 * choque (risco 3 do GAME_DESIGN §4).
 */
export function sectorMultiple(multipleBase: number, selic: number): number {
  const ratio = MARKET.selicReference / Math.max(MARKET.selicFloorForMultiple, selic)
  const multiple = multipleBase * ratio ** MARKET.multipleExponent
  return clamp(
    multiple,
    multipleBase * MARKET.multipleFloorRatio,
    multipleBase * MARKET.multipleCeilingRatio,
  )
}

/**
 * Valor justo por ação: lucro anualizado × múltiplo do setor ÷ ações.
 *
 * Empresa no prejuízo **não vale zero**: cai para um múltiplo de receita, como
 * o mercado real faz. Sem essa saída, um único trimestre ruim levava o valor
 * justo a zero e o preço despencava por um degrau, em vez de por uma ladeira.
 */
export function fairValue(state: GameState, company: Company): number {
  const industry = findIndustry(company.industryId)
  const stock = company.stock
  if (!industry || !stock || stock.sharesOutstanding <= 0) return 0

  const multiple = sectorMultiple(industry.multipleBase, state.macro.selic)
  const profit = annualizedProfit(company)
  if (profit > 0) return (profit * multiple) / stock.sharesOutstanding

  const revenueMultiple = multiple * industry.baseMargin * 0.5
  return Math.max(0, (company.revenue * revenueMultiple) / stock.sharesOutstanding)
}

/** Volume máximo negociável no dia, em ações. */
export function dailyVolume(stock: Stock): number {
  return stock.sharesOutstanding * MARKET.dailyVolumeRatio
}

/** Deslizamento de preço de uma ordem, em fração. Ordem grande custa caro. */
export function slippageFor(stock: Stock, shares: number): number {
  const volume = dailyVolume(stock)
  if (volume <= 0) return MARKET.slippageCap
  const ratio = shares / volume
  return Math.min(MARKET.slippageCap, ratio ** MARKET.slippageExponent * MARKET.slippageK)
}

export function brokerage(notional: number): number {
  return MARKET.brokerageFixed + notional * MARKET.brokeragePercent
}

/**
 * Fator de mercado do dia: a variação que um papel de beta 1 sofreria. Vem do
 * ciclo, do movimento da Selic e da confiança — os deltas são medidos contra o
 * `PublicView` congelado ontem, que é a única foto de ontem que existe.
 */
export function marketFactor(draft: GameState): number {
  const phaseDrift = MARKET.indexPhaseDrift[draft.macro.cyclePhase] / 365
  const selicDelta = draft.macro.selic - draft.publicView.macro.selic
  const confidenceDelta = draft.macro.confidence - draft.publicView.macro.confidence
  return (
    phaseDrift -
    selicDelta * MARKET.selicShock +
    confidenceDelta * MARKET.confidenceEffect +
    nextNormal(draft.rng) * MARKET.indexVolatility
  )
}

function pushCandle(stock: Stock, dayIndex: number, open: number, close: number): void {
  const high = Math.max(open, close)
  const low = Math.min(open, close)
  stock.history.push({
    dayIndex,
    open,
    high,
    low,
    close,
    volume: stock.volumeToday,
    isWeekly: false,
  })
  compactHistory(stock)
}

/**
 * Janela deslizante: 365 candles diários; o que envelhece vira candle semanal
 * (spec §3.5).
 *
 * Compacta **uma semana inteira de cada vez**, e só quando há semana cheia
 * sobrando. Converter um candle por dia não encolhe nada — vira um semanal por
 * diário — e reconstruir o array todo dia dentro do draft do Immer custava
 * segundos por ano simulado.
 */
function compactHistory(stock: Stock): void {
  const dailyCount = stock.history.length - stock.weeklyCount
  if (dailyCount <= MARKET.dailyCandleWindow + 7) return

  const start = stock.weeklyCount
  const chunk = stock.history.slice(start, start + 7)
  if (chunk.length < 7) return

  const first = chunk[0]
  const last = chunk[chunk.length - 1]
  if (!first || !last) return

  const weekly: Candle = {
    dayIndex: first.dayIndex,
    open: first.open,
    high: Math.max(...chunk.map((candle) => candle.high)),
    low: Math.min(...chunk.map((candle) => candle.low)),
    close: last.close,
    volume: chunk.reduce((sum, candle) => sum + candle.volume, 0),
    isWeekly: true,
  }

  stock.history.splice(start, 7, weekly)
  stock.weeklyCount += 1

  if (stock.weeklyCount > MARKET.weeklyCandleWindow) {
    const drop = stock.weeklyCount - MARKET.weeklyCandleWindow
    stock.history.splice(0, drop)
    stock.weeklyCount -= drop
  }
}

function priceStocks(draft: GameState, log: LogEntry[]): void {
  const factor = marketFactor(draft)
  let capBefore = 0
  let capAfter = 0

  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    const stock = company?.stock
    if (!company || !stock) continue

    const open = stock.price
    capBefore += open * stock.sharesOutstanding

    if (company.status === 'deslistada') {
      stock.price = 0
      stock.volumeToday = 0
      continue
    }

    const fair = fairValue(draft, company)
    const gap = fair > 0 ? clamp((fair - open) / open, -MARKET.driftClamp, MARKET.driftClamp) : 0
    const drift = gap * MARKET.meanReversionRate
    const shock = clamp(stock.eventShockToday, -MARKET.eventShockCap, MARKET.eventShockCap)
    const noise = nextNormal(draft.rng) * stock.volatility

    const ret = drift + stock.beta * factor + shock + noise
    stock.price = Math.max(0.01, open * (1 + ret))
    stock.eventShockToday = 0

    pushCandle(stock, draft.date.dayIndex, open, stock.price)
    stock.volumeToday = 0
    capAfter += stock.price * stock.sharesOutstanding
  }

  if (capBefore > 0) {
    draft.macro.marketIndex *= capAfter / capBefore
    draft.macro.marketIndexHistory.push({
      dayIndex: draft.date.dayIndex,
      open: draft.macro.marketIndex,
      high: draft.macro.marketIndex,
      low: draft.macro.marketIndex,
      close: draft.macro.marketIndex,
      volume: 0,
      isWeekly: false,
    })
    // Corta em blocos: aparar um elemento por dia refaz o array todo dia.
    if (draft.macro.marketIndexHistory.length > MARKET.dailyCandleWindow + 30) {
      draft.macro.marketIndexHistory.splice(0, 30)
    }
  }
  void log
}

// ---------------------------------------------------------------------------
// Carteira e ordens
// ---------------------------------------------------------------------------

export function getPosition(state: GameState, companyId: string): Position | null {
  return state.market.positions[companyId] ?? null
}

function ensurePosition(draft: GameState, companyId: string): Position {
  let position = draft.market.positions[companyId]
  if (!position) {
    position = { companyId, shares: 0, avgPrice: 0, shortShares: 0 }
    draft.market.positions[companyId] = position
    draft.market.positionOrder.push(companyId)
  }
  return position
}

/** Move ações entre o float e um detentor, mantendo `ownership` coerente. */
function transferOwnership(company: Company, holderId: 'player', shares: number): void {
  const float = company.ownership.find((entry) => entry.holderId === 'float')
  let holder = company.ownership.find((entry) => entry.holderId === holderId)
  if (!holder) {
    holder = { holderId, shares: 0 }
    company.ownership.push(holder)
  }
  if (float) float.shares -= shares
  holder.shares += shares
}

export interface FillResult {
  ok: boolean
  reason: string | null
  shares: number
  price: number
  cost: number
}

/** Executa uma compra a mercado, com slippage e corretagem. */
export function fillBuy(draft: GameState, companyId: string, shares: number): FillResult {
  const company = draft.companies[companyId]
  const stock = company?.stock
  if (!company || !stock || company.status === 'deslistada') {
    return { ok: false, reason: 'Ativo indisponível.', shares: 0, price: 0, cost: 0 }
  }
  if (shares <= 0) return { ok: false, reason: 'Quantidade inválida.', shares: 0, price: 0, cost: 0 }

  const float = company.ownership.find((entry) => entry.holderId === 'float')
  if (!float || float.shares < shares) {
    return { ok: false, reason: 'Não há papéis suficientes em circulação.', shares: 0, price: 0, cost: 0 }
  }

  const price = stock.price * (1 + slippageFor(stock, shares))
  const notional = price * shares
  const cost = notional + brokerage(notional)
  if (draft.player.money < cost) {
    return { ok: false, reason: 'Dinheiro insuficiente.', shares: 0, price, cost }
  }

  draft.player.money -= cost
  stock.volumeToday += shares

  const position = ensurePosition(draft, companyId)
  const totalCost = position.avgPrice * position.shares + notional
  position.shares += shares
  position.avgPrice = totalCost / position.shares
  transferOwnership(company, 'player', shares)
  checkDisclosure(draft, company, [])
  applyControl(draft, company, [])

  return { ok: true, reason: null, shares, price, cost }
}

/** Executa uma venda a mercado. Devolve o resultado realizado no `cost`. */
export function fillSell(draft: GameState, companyId: string, shares: number): FillResult {
  const company = draft.companies[companyId]
  const stock = company?.stock
  const position = draft.market.positions[companyId]
  if (!company || !stock) {
    return { ok: false, reason: 'Ativo indisponível.', shares: 0, price: 0, cost: 0 }
  }
  if (!position || position.shares < shares || shares <= 0) {
    return { ok: false, reason: 'Você não tem essas ações.', shares: 0, price: 0, cost: 0 }
  }

  const price = stock.price * (1 - slippageFor(stock, shares))
  const notional = price * shares
  const proceeds = notional - brokerage(notional)

  draft.player.money += proceeds
  stock.volumeToday += shares

  const realized = (price - position.avgPrice) * shares
  draft.market.realizedPnlMonth += realized
  draft.market.realizedPnlTotal += realized
  draft.market.salesVolumeMonth += notional

  position.shares -= shares
  if (position.shares <= 0) {
    position.shares = 0
    position.avgPrice = 0
  }
  transferOwnership(company, 'player', -shares)
  applyControl(draft, company, [])

  return { ok: true, reason: null, shares, price, cost: realized }
}

/** Ordens-limite executam no tick em que o preço cruza o limite. */
function executeLimitOrders(draft: GameState, log: LogEntry[]): void {
  const remaining: Order[] = []

  for (const order of draft.market.orders) {
    const company = draft.companies[order.companyId]
    const stock = company?.stock
    if (!company || !stock) continue

    if (order.expiresDayIndex !== null && draft.date.dayIndex > order.expiresDayIndex) {
      log.push({
        id: `order-exp-${order.id}`,
        dayIndex: draft.date.dayIndex,
        severity: 'info',
        source: 'market',
        text: `Ordem em ${company.name} expirou.`,
        amount: null,
      })
      continue
    }

    const limit = order.limitPrice
    const crossed =
      limit !== null && (order.side === 'compra' ? stock.price <= limit : stock.price >= limit)

    if (!crossed) {
      remaining.push(order)
      continue
    }

    const result =
      order.side === 'compra'
        ? fillBuy(draft, order.companyId, order.shares)
        : fillSell(draft, order.companyId, order.shares)

    if (!result.ok) {
      // Não executou: mantém em livro em vez de sumir em silêncio.
      remaining.push(order)
      continue
    }

    log.push({
      id: `order-fill-${order.id}`,
      dayIndex: draft.date.dayIndex,
      severity: order.side === 'compra' ? 'info' : 'bom',
      source: 'market',
      text: `Ordem limite executada: ${order.side} de ${order.shares} ${company.name}.`,
      amount: order.side === 'compra' ? -result.cost : result.cost,
    })
  }

  draft.market.orders = remaining
}

/** Dividendos trimestrais, creditados em caixa (spec §5.3). */
function payDividends(draft: GameState, log: LogEntry[]): void {
  let total = 0

  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    const stock = company?.stock
    if (!company || !stock || company.status !== 'ativa') continue
    if (stock.dividendYieldTarget <= 0 || company.cash <= 0) continue

    const perShare = (stock.price * stock.dividendYieldTarget) / 4
    const payout = perShare * stock.sharesOutstanding
    const affordable = Math.max(0, company.cash * (1 - MARKET.dividendCashReserve))
    const paid = Math.min(payout, affordable)
    if (paid <= 0) continue

    company.cash -= paid
    const perShareActual = paid / stock.sharesOutstanding

    const position = draft.market.positions[id]
    if (position && position.shares > 0) {
      const received = perShareActual * position.shares
      draft.player.money += received
      draft.market.dividendsReceivedTotal += received
      total += received
    }

    // Os rivais também vivem do que possuem. Sem isto o tycoon torrava a
    // fortuna comprando e depois passava a partida inteira sem caixa — e um
    // antagonista sem dinheiro não ataca ninguém.
    for (const tycoonId of draft.ai.tycoonOrder) {
      const tycoon = draft.ai.tycoons[tycoonId]
      if (!tycoon) continue
      const held = company.ownership
        .filter((entry) => entry.holderId === tycoonId)
        .reduce((sum, entry) => sum + entry.shares, 0)
      if (held > 0) tycoon.cash += perShareActual * held
    }
  }

  if (total > 0) {
    log.push({
      id: `dividends-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'market',
      text: 'Dividendos creditados.',
      amount: total,
    })
  }
}

/**
 * IR de 15% sobre lucro realizado no mês, com isenção para vendas até o teto
 * mensal. Sem caixa, vira pendência com multa (resolução C6). O lucro é zerado
 * no mesmo passo em que o imposto é apurado — é isso que torna "cobrado
 * exatamente uma vez" testável.
 */
function settleCapitalGainsTax(draft: GameState, log: LogEntry[]): void {
  const profit = draft.market.realizedPnlMonth
  const sales = draft.market.salesVolumeMonth
  const exemption = MARKET.monthlySalesExemption * draft.macro.priceLevel

  draft.market.realizedPnlMonth = 0
  draft.market.salesVolumeMonth = 0

  if (profit <= 0 || sales <= exemption) return

  const tax = profit * MARKET.capitalGainsTax
  const unpaid = debit(draft, tax)

  if (unpaid > 0.005) {
    draft.market.taxDebts.push({
      id: `tax-${draft.date.dayIndex}`,
      amount: unpaid,
      createdDayIndex: draft.date.dayIndex,
      penalty: unpaid * MARKET.taxDebtPenalty,
    })
    draft.player.creditScore = Math.max(0, draft.player.creditScore - 40)
  }

  log.push({
    id: `tax-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'ruim',
    source: 'market',
    text: unpaid > 0.005 ? 'Imposto sobre ganho de capital ficou pendente.' : 'Imposto sobre ganho de capital pago.',
    amount: -(tax - unpaid),
  })
}

function accrueTaxDebts(draft: GameState): void {
  for (const debtItem of draft.market.taxDebts) {
    debtItem.penalty += debtItem.amount * (MARKET.taxDebtMonthlyInterest / 30)
  }
}

/** Vencimento das OPAs e antitruste (spec §5.6). */
function stepCorporate(draft: GameState, log: LogEntry[]): void {
  // Divulgação velha não é ameaça: sem janela, a lista cresce para sempre e a
  // varredura de ameaça do conselho vira O(n) por empresa por dia.
  if (draft.ownershipDisclosures.length > 200) {
    draft.ownershipDisclosures.splice(0, draft.ownershipDisclosures.length - 200)
  }

  for (const tender of draft.tenders) {
    if (tender.status !== 'aberta') continue
    if (draft.date.dayIndex < tender.expiresDayIndex) continue
    resolveTender(draft, tender, log)
  }
  draft.tenders = draft.tenders.filter(
    (tender) => tender.status === 'aberta' || draft.date.dayIndex - tender.expiresDayIndex < 30,
  )

  // Antitruste: acima do limiar de participação, investigação aberta.
  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    if (!company || company.managedBy !== 'player') continue
    if (company.marketShare < CONTROL.antitrustShare) continue
    const open = draft.politics.antitrustCases.some(
      (item) => item.targetId === id && item.status === 'investigando',
    )
    if (open) continue

    draft.politics.antitrustCases.push({
      id: `anti-${id}-${draft.date.dayIndex}`,
      industryId: company.industryId,
      targetId: id,
      openedDayIndex: draft.date.dayIndex,
      deadlineDayIndex: draft.date.dayIndex + CONTROL.antitrustDeadlineDays,
      status: 'investigando',
      lobbyMitigation: 0,
    })
    draft.player.notoriety = Math.min(100, draft.player.notoriety + 10)
    log.push({
      id: `anti-${id}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'ruim',
      source: 'ownership',
      text: `${company.name} passou de ${(CONTROL.antitrustShare * 100).toFixed(0)}% do setor: o regulador abriu investigação.`,
      amount: null,
    })
  }
}

export function stepMarket(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  priceStocks(draft, log)
  executeLimitOrders(draft, log)
  stepCorporate(draft, log)
  accrueTaxDebts(draft)
  if (markers.isQuarterEnd) payDividends(draft, log)
  if (markers.isMonthEnd) settleCapitalGainsTax(draft, log)
}
