import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import {
  attractiveness,
  capacityOf,
  capitalNeededFor,
  priceFactor,
  unitCost,
  valuationOf,
} from '@/engine/companies'
import { sectorMultiple } from '@/engine/market'
import { findIndustry } from '@/data/industries'
import { OPERATIONS } from '@/data/config'
import type { GameState } from '@/engine/types'
import { statementFor } from '@/ui/companyStatement'
import { annualizedProfit } from '@/engine/companies'
import { advance, advanceAsync, fresh, funded } from './helpers'

function foundedState(capital = 200_000, industryId = 'varejo'): { state: GameState; id: string } {
  const start = funded(fresh(), 2_000_000)
  const result = applyAction(start, {
    kind: 'fundarEmpresa',
    name: 'Minha Empresa',
    industryId,
    capital,
  })
  const id = result.state.companyOrder[result.state.companyOrder.length - 1]!
  return { state: result.state, id }
}

describe('participação de mercado', () => {
  it('soma 1 dentro de cada setor, todo tick', () => {
    let state = funded(fresh(), 5_000_000)
    for (let day = 0; day < 400; day += 1) {
      state = advance(state, 1).state
      for (const industryId of state.industryOrder) {
        const ids = state.industries[industryId]!.companyOrder
        const total = ids.reduce((sum, id) => sum + (state.companies[id]?.marketShare ?? 0), 0)
        expect(total).toBeCloseTo(1, 6)
      }
    }
  })

  it('empresa fora do ar não guarda participação', () => {
    const state = funded(fresh(), 1000)
    const id = state.companyOrder[0]!
    const broken = {
      ...state,
      companies: { ...state.companies, [id]: { ...state.companies[id]!, status: 'deslistada' as const } },
    }
    const after = advance(broken, 2).state
    expect(after.companies[id]!.marketShare).toBe(0)
  })
})

describe('atratividade', () => {
  it('sem marca não há fatia, por mais barato que seja', () => {
    const state = fresh()
    const known = state.companies['nimbo']!
    const unknown = { ...known, brandAwareness: 1, productQuality: 90, price: 0.5 }
    expect(attractiveness(unknown, 1)).toBeLessThan(attractiveness(known, 1) * 0.2)
  })

  it('preço abaixo da média atrai, com teto', () => {
    expect(priceFactor(0.8, 1)).toBeGreaterThan(1)
    expect(priceFactor(1.2, 1)).toBeLessThan(1)
    expect(priceFactor(0.001, 1)).toBeLessThanOrEqual(OPERATIONS.priceFactorCap)
  })
})

describe('capacidade', () => {
  it('é o menor entre o que a equipe e o capital sustentam', () => {
    const industry = findIndustry('varejo')!
    const base = fresh().companies['casapronta']!

    const semCapital = { ...base, capitalStock: 1000 }
    expect(capacityOf(semCapital, industry)).toBeCloseTo(1000 * industry.capitalTurnover, 4)

    const semGente = { ...base, workforce: { ...base.workforce, headcount: 1 } }
    expect(capacityOf(semGente, industry)).toBeCloseTo(
      industry.outputPerEmployee * (base.workforce.productivity / 100),
      4,
    )
  })

  it('o capital necessário sai do giro do setor', () => {
    const industry = findIndustry('tecnologia')!
    expect(capitalNeededFor(1_000_000, industry)).toBeCloseTo(1_000_000 / industry.capitalTurnover, 6)
  })
})

describe('empresa do jogador', () => {
  it('fundar cobra o capital, consome bloco e nasce 100% sua', () => {
    const before = funded(fresh(), 2_000_000)
    const { state, id } = foundedState(200_000)
    const company = state.companies[id]!

    expect(state.player.money).toBeCloseTo(before.player.money - 200_000, 2)
    expect(state.player.blocksUsedToday).toBe(1)
    expect(company.isPublic).toBe(false)
    expect(company.managedBy).toBe('player')
    expect(company.ownership).toEqual([{ holderId: 'player', shares: 1_000_000 }])
    expect(company.capitalStock).toBe(200_000)
  })

  it('recusa capital abaixo do mínimo', () => {
    const result = applyAction(funded(fresh(), 2_000_000), {
      kind: 'fundarEmpresa',
      name: 'Fiado',
      industryId: 'varejo',
      capital: 100,
    })
    expect(result.log[0]?.text).toContain('Capital mínimo')
    expect(result.state.companyOrder).toHaveLength(28)
  })

  it('opera, fatura e aparece no setor', () => {
    const { state, id } = foundedState(300_000)
    const after = advance(state, 200).state
    const company = after.companies[id]!

    expect(company.revenue).toBeGreaterThan(0)
    expect(company.status).toBe('ativa')
    expect(after.industries['varejo']!.companyOrder).toContain(id)
  })

  it('a diretriz é persistente e só custa bloco ao mudar', () => {
    const { state, id } = foundedState()
    const ticked = advance(state, 3).state
    expect(ticked.player.blocksUsedToday).toBe(0)

    const changed = applyAction(ticked, { kind: 'ajustarPreco', companyId: id, price: 0.9 })
    expect(changed.state.companies[id]!.price).toBeCloseTo(0.9, 6)
    expect(changed.state.player.blocksUsedToday).toBe(1)

    // No dia seguinte a empresa continua operando com o preço novo, de graça.
    const next = advance(changed.state, 2).state
    expect(next.companies[id]!.price).toBeCloseTo(0.9, 6)
    expect(next.player.blocksUsedToday).toBe(0)
  })

  it('cortar preço ganha atratividade e encolhe a margem', () => {
    const { state, id } = foundedState()
    const company = state.companies[id]!
    const industry = findIndustry(company.industryId)!

    const cheaper = { ...company, price: 0.8 }
    expect(attractiveness(cheaper, 1)).toBeGreaterThan(attractiveness(company, 1))

    // A margem por unidade cai junto: é a tensão que a Fase 5b vai explorar.
    const cost = unitCost(industry, company)
    expect((0.8 - cost) / 0.8).toBeLessThan((company.price - cost) / company.price)
  })

  it('contratar custa caixa da empresa e aumenta o quadro', () => {
    const { state, id } = foundedState(400_000)
    const before = state.companies[id]!
    const after = applyAction(state, {
      kind: 'contratar',
      companyId: id,
      count: 3,
      salary: 42_000,
    }).state.companies[id]!

    expect(after.workforce.headcount).toBe(before.workforce.headcount + 3)
    expect(after.cash).toBeLessThan(before.cash)
  })

  it('demissão em massa derruba moral e reputação', () => {
    const { state, id } = foundedState(400_000)
    const hired = applyAction(state, {
      kind: 'contratar',
      companyId: id,
      count: 20,
      salary: 42_000,
    }).state
    const before = hired.companies[id]!

    const after = applyAction(hired, { kind: 'demissaoEmMassa', companyId: id, count: 10 })
      .state.companies[id]!
    expect(after.workforce.headcount).toBe(before.workforce.headcount - 10)
    expect(after.workforce.morale).toBeLessThan(before.workforce.morale)
    expect(after.reputation).toBeLessThan(before.reputation)
  })

  it('ampliar capacidade converte caixa em capital', () => {
    const { state, id } = foundedState(300_000)
    const before = state.companies[id]!
    const after = applyAction(state, {
      kind: 'expandirCapacidade',
      companyId: id,
      investment: 100_000,
    }).state.companies[id]!

    expect(after.capitalStock).toBeCloseTo(before.capitalStock + 100_000, 2)
    expect(after.cash).toBeCloseTo(before.cash - 100_000, 2)
  })

  it('vender devolve o valuation e tira a empresa do setor', () => {
    const { state, id } = foundedState(300_000)
    const grown = advance(state, 400).state
    const company = grown.companies[id]!
    const industry = findIndustry(company.industryId)!
    const expected = valuationOf(company, sectorMultiple(industry.multipleBase, grown.macro.selic))

    const sold = applyAction(grown, { kind: 'venderEmpresa', companyId: id })
    expect(sold.state.player.money).toBeCloseTo(grown.player.money + expected, 2)
    expect(sold.state.companyOrder).not.toContain(id)
    expect(sold.state.industries['varejo']!.companyOrder).not.toContain(id)
  })

  it('empresa sem caixa por três trimestres vai para recuperação judicial', () => {
    const { state, id } = foundedState(300_000)
    // Folha impagável: 400 pessoas para uma estrutura de 300 mil.
    const broke = applyAction(state, {
      kind: 'contratar',
      companyId: id,
      count: 400,
      salary: 60_000,
    }).state
    const doomed = {
      ...broke,
      companies: {
        ...broke.companies,
        [id]: { ...broke.companies[id]!, cash: -1000, workforce: { ...broke.companies[id]!.workforce, headcount: 400 } },
      },
    }
    const after = advance(doomed, 400).state
    expect(['recuperacaoJudicial', 'deslistada']).toContain(after.companies[id]!.status)
  })
})

describe('mundo listado continua vivo', () => {
  it('cinco anos sem quebradeira generalizada', async () => {
    const state = (await advanceAsync(funded(fresh(), 5_000_000), 1825)).state
    const dead = state.companyOrder.filter((id) => state.companies[id]!.status !== 'ativa')
    expect(dead.length).toBeLessThan(6)
    expect(state.macro.marketIndex).toBeGreaterThan(50)
  })
})

describe('demonstrativo da empresa', () => {
  /**
   * O mesmo princípio do extrato pessoal: demonstrativo que não fecha com o que
   * o motor faz é pior que nenhum, porque o jogador decide olhando para ele.
   */
  it('as linhas somam o lucro que o tick de fato produz', async () => {
    const base = funded(fresh(), 50_000_000)
    const fundada = applyAction(base, {
      kind: 'fundarEmpresa',
      name: 'Teste',
      industryId: 'varejo',
      capital: 200_000,
    }).state
    const rodada = (await advanceAsync(fundada, 400)).state

    const id = rodada.companyOrder.find((c) => rodada.companies[c]?.managedBy === 'player')!
    const company = rodada.companies[id]!
    const industry = findIndustry(company.industryId)!
    const statement = statementFor(rodada, company, industry)

    // O lucro do demonstrativo é a soma das próprias linhas.
    const soma = statement.lines.reduce((total, line) => total + line.amount, 0)
    expect(soma).toBeCloseTo(statement.profit, 2)

    // E bate com o lucro anualizado que o motor calcula, dentro do ruído diário
    // do próprio `stepCompanyDay` (`revenueNoise`).
    const doMotor = annualizedProfit(company)
    if (Math.abs(doMotor) > 1000) {
      expect(Math.abs(statement.profit - doMotor) / Math.abs(doMotor)).toBeLessThan(0.35)
    }
  })

  it('aponta o gargalo certo: sem capital, é capital', async () => {
    const base = funded(fresh(), 50_000_000)
    // Capital no mínimo e gente demais: a máquina é que segura.
    const fundada = applyAction(base, {
      kind: 'fundarEmpresa',
      name: 'Apertada',
      industryId: 'varejo',
      capital: 60_000,
    }).state
    const id = fundada.companyOrder.find((c) => fundada.companies[c]?.managedBy === 'player')!
    const contratou = applyAction(fundada, {
      kind: 'contratar',
      companyId: id,
      count: 20,
      salary: 42_000,
    }).state
    const rodada = (await advanceAsync(contratou, 120)).state

    const company = rodada.companies[id]!
    const statement = statementFor(rodada, company, findIndustry(company.industryId)!)
    expect(statement.bottleneck).toBe('capital')
  })
})
