import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { fairValue, sectorMultiple, slippageFor } from '@/engine/market'
import { annualizedProfit } from '@/engine/companies'
import { MARKET } from '@/data/config'
import { findIndustry } from '@/data/industries'
import type { CyclePhase, GameState } from '@/engine/types'
import { advance, fresh, funded, liveDay, withMacro } from './helpers'

const FIRST = 'nimbo'

function rich(seed = 42): GameState {
  return funded(fresh(seed), 50_000_000)
}

function setPrice(state: GameState, companyId: string, price: number): GameState {
  const company = state.companies[companyId]!
  return {
    ...state,
    companies: {
      ...state.companies,
      [companyId]: { ...company, stock: { ...company.stock!, price } },
    },
  }
}

/** Trava o ciclo numa fase para medir o efeito dela sem transição no meio. */
function lockCycle(state: GameState, phase: CyclePhase): GameState {
  return withMacro(state, { cyclePhase: phase, cycleDayCounter: 0, cycleTargetDays: 99_999 })
}

describe('mundo listado', () => {
  it('nasce com 28 empresas em 7 setores e preço vindo dos fundamentos', () => {
    const state = fresh()
    expect(state.companyOrder).toHaveLength(28)
    expect(state.industryOrder).toHaveLength(7)

    for (const id of state.companyOrder) {
      const company = state.companies[id]!
      expect(company.stock).not.toBeNull()
      expect(company.stock!.price).toBeGreaterThan(0)
      // Preço de abertura dentro de ±10% do valor justo, por construção.
      const fair = fairValue(state, company)
      expect(company.stock!.price / fair).toBeGreaterThan(0.85)
      expect(company.stock!.price / fair).toBeLessThan(1.15)
    }
  })

  it('a soma das participações de cada setor é 1', () => {
    const state = fresh()
    for (const industryId of state.industryOrder) {
      const ids = state.industries[industryId]!.companyOrder
      const total = ids.reduce((sum, id) => sum + state.companies[id]!.marketShare, 0)
      expect(total).toBeCloseTo(1, 6)
    }
  })
})

describe('precificação', () => {
  it('o múltiplo do setor encolhe quando a Selic sobe', () => {
    const base = 20
    expect(sectorMultiple(base, 0.05)).toBeGreaterThan(sectorMultiple(base, 0.2))
    expect(sectorMultiple(base, 0.2)).toBeGreaterThan(sectorMultiple(base, 0.3))
  })

  it('o múltiplo tem piso e teto, para um choque de juro não zerar o mercado', () => {
    const base = 20
    expect(sectorMultiple(base, 0.99)).toBeGreaterThanOrEqual(base * MARKET.multipleFloorRatio)
    expect(sectorMultiple(base, 0.0001)).toBeLessThanOrEqual(base * MARKET.multipleCeilingRatio)
  })

  it('o valor justo cai quando a Selic sobe', () => {
    const cheap = withMacro(fresh(), { selic: 0.05 })
    const dear = withMacro(fresh(), { selic: 0.25 })
    const company = cheap.companies[FIRST]!
    expect(fairValue(dear, dear.companies[FIRST]!)).toBeLessThan(fairValue(cheap, company))
  })

  it('preço nunca fica negativo e o histórico é limitado', () => {
    const state = advance(rich(), 900).state
    for (const id of state.companyOrder) {
      const stock = state.companies[id]!.stock!
      expect(stock.price).toBeGreaterThanOrEqual(0)
      expect(stock.history.length).toBeLessThanOrEqual(
        MARKET.dailyCandleWindow + MARKET.weeklyCandleWindow + 7,
      )
      expect(stock.weeklyCount).toBeLessThanOrEqual(MARKET.weeklyCandleWindow)
    }
  })

  it('a carteira reage ao ciclo: recessão derruba o índice, expansão levanta', () => {
    const boom = advance(lockCycle(rich(), 'expansao'), 730).state
    const bust = advance(lockCycle(rich(), 'recessao'), 730).state
    expect(bust.macro.marketIndex).toBeLessThan(boom.macro.marketIndex)
    expect(bust.macro.marketIndex).toBeLessThan(100)
  })
})

describe('ordens', () => {
  it('compra a mercado debita preço + corretagem e registra preço médio', () => {
    const before = rich()
    const price = before.companies[FIRST]!.stock!.price
    const after = applyAction(before, {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 100,
      limitPrice: null,
    }).state

    const position = after.market.positions[FIRST]!
    expect(position.shares).toBe(100)
    expect(position.avgPrice).toBeGreaterThanOrEqual(price)
    expect(after.player.money).toBeLessThan(before.player.money - price * 100)
  })

  it('operar na bolsa não consome bloco de ação', () => {
    const after = applyAction(rich(), {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 10,
      limitPrice: null,
    }).state
    expect(after.player.blocksUsedToday).toBe(0)
  })

  it('ordem grande sofre mais deslizamento que ordem pequena', () => {
    const stock = fresh().companies[FIRST]!.stock!
    const small = slippageFor(stock, 1000)
    const big = slippageFor(stock, 1_000_000)
    expect(big).toBeGreaterThan(small)
    expect(big).toBeLessThanOrEqual(MARKET.slippageCap)
  })

  it('a compra reduz o float e devolve ao vender', () => {
    const start = rich()
    const floatBefore = start.companies[FIRST]!.ownership.find((o) => o.holderId === 'float')!.shares

    let state = applyAction(start, {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 5000,
      limitPrice: null,
    }).state
    expect(
      state.companies[FIRST]!.ownership.find((o) => o.holderId === 'float')!.shares,
    ).toBe(floatBefore - 5000)
    expect(state.companies[FIRST]!.ownership.find((o) => o.holderId === 'player')!.shares).toBe(5000)

    state = applyAction(state, {
      kind: 'venderAcao',
      companyId: FIRST,
      shares: 5000,
      limitPrice: null,
    }).state
    expect(
      state.companies[FIRST]!.ownership.find((o) => o.holderId === 'float')!.shares,
    ).toBe(floatBefore)
  })

  it('recusa vender o que não tem e comprar sem dinheiro', () => {
    const broke = { ...fresh(), player: { ...fresh().player, money: 10 } }
    expect(
      applyAction(broke, { kind: 'comprarAcao', companyId: FIRST, shares: 1000, limitPrice: null })
        .log[0]?.text,
    ).toContain('Dinheiro insuficiente')
    expect(
      applyAction(rich(), { kind: 'venderAcao', companyId: FIRST, shares: 10, limitPrice: null })
        .log[0]?.text,
    ).toContain('não tem')
  })

  it('ordem limite só executa quando o preço cruza', () => {
    const start = rich()
    const price = start.companies[FIRST]!.stock!.price

    // Limite bem abaixo do mercado: fica em livro.
    let state = applyAction(start, {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 100,
      limitPrice: price * 0.5,
    }).state
    expect(state.market.orders).toHaveLength(1)
    expect(state.market.positions[FIRST]).toBeUndefined()

    state = liveDay(state).state
    expect(state.market.orders).toHaveLength(1)

    // Agora o preço cai abaixo do limite: executa no tick seguinte.
    state = setPrice(state, FIRST, price * 0.4)
    state = liveDay(state).state
    expect(state.market.orders).toHaveLength(0)
    expect(state.market.positions[FIRST]?.shares).toBe(100)
  })

  it('a ordem limite expira e some do livro', () => {
    const price = rich().companies[FIRST]!.stock!.price
    let state = applyAction(rich(), {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 10,
      limitPrice: price * 0.01,
    }).state
    expect(state.market.orders).toHaveLength(1)
    state = advance(state, 45).state
    expect(state.market.orders).toHaveLength(0)
  })

  it('cancelar remove a ordem do livro', () => {
    const price = rich().companies[FIRST]!.stock!.price
    let state = applyAction(rich(), {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 10,
      limitPrice: price * 0.5,
    }).state
    const orderId = state.market.orders[0]!.id
    state = applyAction(state, { kind: 'cancelarOrdem', orderId }).state
    expect(state.market.orders).toHaveLength(0)
  })
})

describe('imposto sobre ganho de capital', () => {
  it('é cobrado exatamente uma vez, e não cobra quem está na isenção', () => {
    let state = rich()
    state = applyAction(state, {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 20_000,
      limitPrice: null,
    }).state

    // Preço dobra: a venda gera lucro bem acima da isenção mensal.
    const price = state.companies[FIRST]!.stock!.price
    state = setPrice(state, FIRST, price * 2)
    state = applyAction(state, {
      kind: 'venderAcao',
      companyId: FIRST,
      shares: 20_000,
      limitPrice: null,
    }).state

    const profit = state.market.realizedPnlMonth
    expect(profit).toBeGreaterThan(0)

    // Avança até o fim do mês e conta as cobranças.
    const result = advance(state, 60)
    const charges = result.entries.filter((entry) => entry.text.includes('ganho de capital'))
    expect(charges).toHaveLength(1)
    expect(result.state.market.realizedPnlMonth).toBe(0)

    // Venda pequena não paga nada.
    let small = rich()
    small = applyAction(small, {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 10,
      limitPrice: null,
    }).state
    small = setPrice(small, FIRST, small.companies[FIRST]!.stock!.price * 2)
    small = applyAction(small, {
      kind: 'venderAcao',
      companyId: FIRST,
      shares: 10,
      limitPrice: null,
    }).state
    const quiet = advance(small, 60)
    expect(quiet.entries.filter((e) => e.text.includes('ganho de capital'))).toHaveLength(0)
  })

  it('sem caixa, o imposto vira pendência com multa', () => {
    let state = rich()
    state = applyAction(state, {
      kind: 'comprarAcao',
      companyId: FIRST,
      shares: 20_000,
      limitPrice: null,
    }).state
    state = setPrice(state, FIRST, state.companies[FIRST]!.stock!.price * 2)
    state = applyAction(state, {
      kind: 'venderAcao',
      companyId: FIRST,
      shares: 20_000,
      limitPrice: null,
    }).state
    state = { ...state, player: { ...state.player, money: 0 } }

    const after = advance(state, 40).state
    expect(after.market.taxDebts.length).toBeGreaterThan(0)
    expect(after.market.taxDebts[0]!.penalty).toBeGreaterThan(0)
  })
})

describe('dividendos', () => {
  it('são creditados no fim do trimestre a quem tem a ação', () => {
    // Uma pagadora de dividendo alta: Ferro Norte, yield 7%.
    let state = funded(fresh(7), 200_000_000)
    state = applyAction(state, {
      kind: 'comprarAcao',
      companyId: 'ferro-norte',
      shares: 100_000,
      limitPrice: null,
    }).state

    const result = advance(state, 120)
    const dividends = result.entries.filter((entry) => entry.text.includes('Dividendos'))
    expect(dividends.length).toBeGreaterThan(0)
    expect(result.state.market.dividendsReceivedTotal).toBeGreaterThan(0)
  })
})

describe('fundamentos', () => {
  it('o lucro anualizado usa os quatro últimos trimestres fechados', () => {
    const company = fresh().companies[FIRST]!
    const quarter = company.profitHistory[0]!
    expect(annualizedProfit(company)).toBeCloseTo(quarter * 4, 6)
  })

  it('juro alto machuca o lucro do setor sensível e ajuda o banco', () => {
    const industry = findIndustry('varejo')!
    const bank = findIndustry('bancos')!
    expect(industry.rateSensitivity).toBeGreaterThan(0)
    expect(bank.rateSensitivity).toBeLessThan(0)
  })
})
