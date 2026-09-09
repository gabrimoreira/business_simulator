import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import {
  acceptanceChance,
  controlLevelFor,
  managementConfidence,
  referencePrice,
  stakeOf,
  totalShares,
} from '@/engine/ownership'
import { annualizedProfit } from '@/engine/companies'
import { CONTROL } from '@/data/config'
import type { GameState } from '@/engine/types'
import { advance, fresh, funded } from './helpers'

const TARGET = 'pulso'

/** Compra respeitando o teto de volume diário, como um comprador real faria. */
function accumulate(state: GameState, companyId: string, days: number): GameState {
  let current = state
  for (let i = 0; i < days; i += 1) {
    const company = current.companies[companyId]!
    const float = company.ownership.find((entry) => entry.holderId === 'float')?.shares ?? 0
    if (float <= 0) break
    const lot = Math.min(Math.floor(company.stock!.sharesOutstanding * 0.004), float)
    if (lot <= 0) break
    current = applyAction(current, {
      kind: 'comprarAcao',
      companyId,
      shares: lot,
      limitPrice: null,
    }).state
    current = advance(current, 1).state
  }
  return current
}

describe('limiares de controle', () => {
  it('cada faixa destrava o poder certo', () => {
    expect(controlLevelFor(0.02)).toBe('nenhum')
    expect(controlLevelFor(0.05)).toBe('relevante')
    expect(controlLevelFor(0.15)).toBe('conselho')
    expect(controlLevelFor(0.25)).toBe('bloqueio')
    expect(controlLevelFor(0.51)).toBe('controle')
    expect(controlLevelFor(0.9)).toBe('fechamento')
  })

  it('o capital nasce repartido entre float e blocos identificáveis', () => {
    const state = fresh()
    for (const id of state.companyOrder) {
      const company = state.companies[id]!
      const holders = company.ownership.map((entry) => entry.holderId)
      expect(holders).toContain('float')
      // Sem acionistas nomeados não há de quem comprar participação relevante.
      expect(holders.filter((holder) => holder !== 'float').length).toBeGreaterThanOrEqual(3)
      expect(totalShares(company)).toBe(company.stock!.sharesOutstanding)
    }
  })
})

describe('acumulação de posição', () => {
  const start = funded(fresh(), 1_500_000_000)
  const accumulated = accumulate(advance(start, 120).state, TARGET, 260)

  /**
   * A partir da Fase 6b, comprar o float **não basta**: o conselho reage e tira
   * papel do mercado. Fechar o controle exige a oferta pública — que é
   * exatamente o caminho que o §5.6 desenha.
   */
  const controlled = (() => {
    let current = accumulated
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const company = current.companies[TARGET]!
      if (stakeOf(company, 'player') > CONTROL.controlStake) break
      const outside = company.ownership
        .filter((entry) => entry.holderId !== 'player')
        .reduce((sum, entry) => sum + entry.shares, 0)
      current = applyAction(current, {
        kind: 'lancarOpa',
        companyId: TARGET,
        premium: 0.9,
        sharesSought: outside,
      }).state
      current = advance(current, CONTROL.tenderDays + 3).state
    }
    return current
  })()

  it('a defesa do conselho impede tomar o controle só comprando float', () => {
    expect(stakeOf(accumulated.companies[TARGET]!, 'player')).toBeGreaterThan(
      CONTROL.relevantStake,
    )
    expect(accumulated.ai.defenses.some((defense) => defense.againstId === 'player')).toBe(true)
  })

  it('a oferta pública fecha o controle e troca quem dirige a empresa', () => {
    const company = controlled.companies[TARGET]!
    expect(stakeOf(company, 'player')).toBeGreaterThan(CONTROL.controlStake)
    expect(company.managedBy).toBe('player')
    // Sem agente: quem manda agora é o jogador.
    expect(controlled.ai.agents[TARGET]).toBeUndefined()
  })

  it('cruzar 5% gera divulgação e manchete, sem inundar o feed', () => {
    const disclosures = accumulated.ownershipDisclosures.filter(
      (item) => item.companyId === TARGET,
    )
    expect(disclosures.length).toBeGreaterThan(0)
    // Divulga ao cruzar faixa, não a cada compra.
    expect(disclosures.length).toBeLessThan(12)
    expect(
      accumulated.news.headlines.some((headline) => headline.text.includes('acumula')),
    ).toBe(true)
  })

  it('a empresa controlada aparece no painel de gestão e aceita diretriz', () => {
    const changed = applyAction(controlled, {
      kind: 'ajustarPreco',
      companyId: TARGET,
      price: 1.1,
    })
    expect(changed.state.companies[TARGET]!.price).toBeCloseTo(1.1, 6)
  })
})

describe('OPA', () => {
  const base = advance(funded(fresh(), 3_000_000_000), 120).state

  it('prêmio maior compra mais blocos', () => {
    const company = base.companies[TARGET]!
    const low = acceptanceChance(base, company, 'minoritarios@pulso', 0.1)
    const high = acceptanceChance(base, company, 'minoritarios@pulso', 0.8)
    expect(high).toBeGreaterThan(low)
  })

  it('bloco leal resiste mais que fundo', () => {
    const company = base.companies[TARGET]!
    expect(acceptanceChance(base, company, 'familia@pulso', 0.5)).toBeLessThan(
      acceptanceChance(base, company, 'minoritarios@pulso', 0.5),
    )
  })

  it('gestão bem avaliada segura o acionista', () => {
    const company = base.companies[TARGET]!
    const wellRun = { ...company, reputation: 95, profitHistory: [1e9, 1e9, 1e9, 1e9] }
    const badlyRun = { ...company, reputation: 10, profitHistory: [-1e9, -1e9, -1e9, -1e9] }
    expect(managementConfidence(wellRun)).toBeGreaterThan(managementConfidence(badlyRun))
    expect(acceptanceChance(base, wellRun, 'fundo-aurora@pulso', 0.4)).toBeLessThan(
      acceptanceChance(base, badlyRun, 'fundo-aurora@pulso', 0.4),
    )
  })

  it('a oferta é lançada, tem prazo e resolve no vencimento', () => {
    const company = base.companies[TARGET]!
    const outside = company.ownership
      .filter((entry) => entry.holderId !== 'player')
      .reduce((sum, entry) => sum + entry.shares, 0)

    const launched = applyAction(base, {
      kind: 'lancarOpa',
      companyId: TARGET,
      premium: 0.7,
      sharesSought: outside,
    })
    expect(launched.state.tenders).toHaveLength(1)
    expect(launched.state.tenders[0]!.status).toBe('aberta')
    expect(launched.state.player.blocksUsedToday).toBe(1)

    const pending = advance(launched.state, CONTROL.tenderDays - 2).state
    expect(pending.tenders[0]!.status).toBe('aberta')

    const resolved = advance(pending, 5).state
    expect(resolved.tenders[0]!.status).not.toBe('aberta')
    expect(stakeOf(resolved.companies[TARGET]!, 'player')).toBeGreaterThan(0)
    // Tomar empresa à força chama atenção.
    expect(resolved.player.notoriety).toBeGreaterThan(0)
  })

  it('recusa oferta sem caixa', () => {
    const broke = { ...base, player: { ...base.player, money: 100 } }
    const result = applyAction(broke, {
      kind: 'lancarOpa',
      companyId: TARGET,
      premium: 0.5,
      sharesSought: 1_000_000,
    })
    expect(result.log[0]?.text).toContain('caixa')
    expect(result.state.tenders).toHaveLength(0)
  })

  it('o preço de referência é a média da janela, não o preço de hoje', () => {
    const company = base.companies[TARGET]!
    const reference = referencePrice(company)
    expect(reference).toBeGreaterThan(0)
    expect(reference).not.toBe(company.stock!.price)
  })
})

describe('IPO', () => {
  function founded(capital = 400_000): { state: GameState; id: string } {
    const start = funded(fresh(), 5_000_000)
    const result = applyAction(start, {
      kind: 'fundarEmpresa',
      name: 'Minha Listada',
      industryId: 'tecnologia',
      capital,
    })
    const id = result.state.companyOrder[result.state.companyOrder.length - 1]!
    return { state: result.state, id }
  }

  it('recusa antes de quatro trimestres divulgados', () => {
    const { state, id } = founded()
    const result = applyAction(state, {
      kind: 'abrirCapital',
      companyId: id,
      bankId: 'meridiano',
      floatPct: 0.3,
      pricePerShare: 1,
    })
    expect(result.log[0]?.text).toContain('trimestres')
    expect(result.state.companies[id]!.isPublic).toBe(false)
  })

  it('recusa quando receita e lucro não alcançam o piso', () => {
    const { state, id } = founded()
    const grown = advance(state, 400).state
    const result = applyAction(grown, {
      kind: 'abrirCapital',
      companyId: id,
      bankId: 'meridiano',
      floatPct: 0.3,
      pricePerShare: 1,
    })
    // Empresa pequena não abre capital.
    expect(result.log[0]?.text).toContain('abaixo do exigido')
  })

  it('abre capital, entra caixa e o jogador dilui', () => {
    const { state, id } = founded()
    let grown = advance(state, 400).state
    // Injeta escala suficiente para passar nos pisos do §5.6.
    const company = grown.companies[id]!
    grown = {
      ...grown,
      companies: {
        ...grown.companies,
        [id]: {
          ...company,
          revenue: 40_000_000,
          profitHistory: [3_000_000, 3_000_000, 3_000_000, 3_000_000],
          quartersReported: 6,
        },
      },
    }

    const before = grown.companies[id]!.cash
    const result = applyAction(grown, {
      kind: 'abrirCapital',
      companyId: id,
      bankId: 'meridiano',
      floatPct: 0.3,
      pricePerShare: 12,
    })
    const listed = result.state.companies[id]!

    expect(listed.isPublic).toBe(true)
    expect(listed.stock).not.toBeNull()
    expect(listed.cash).toBeGreaterThan(before)
    // Diluiu: não tem mais 100%.
    expect(stakeOf(listed, 'player')).toBeCloseTo(0.7, 2)
    expect(result.state.ipos).toHaveLength(1)
    expect(result.state.ipos[0]!.feePaid).toBeGreaterThan(0)
    expect(annualizedProfit(listed)).toBeGreaterThan(0)
  })
})

describe('antitruste', () => {
  it('participação acima do limiar abre investigação', () => {
    // A participação é **recalculada** todo tick a partir da atratividade, então
    // não adianta injetá-la à mão: o passo de empresas sobrescreve antes do de
    // mercado ler. O jeito honesto é montar um domínio de fato — marca no teto
    // para o alvo, marca no chão para as rivais.
    const start = funded(fresh(), 1000)
    const id = 'nimbo'
    const rivals = start.industries['tecnologia']!.companyOrder.filter((item) => item !== id)

    const companies = { ...start.companies }
    // Capacidade também precisa acompanhar: participação é a **realizada**, e
    // quem não consegue produzir devolve a fatia para as rivais.
    const target = companies[id]!
    companies[id] = {
      ...target,
      managedBy: 'player' as const,
      brandAwareness: 100,
      capitalStock: target.capitalStock * 4,
      workforce: { ...target.workforce, headcount: target.workforce.headcount * 4 },
      directives: { ...target.directives, headcountTarget: target.workforce.headcount * 4 },
    }
    for (const rival of rivals) {
      companies[rival] = { ...companies[rival]!, brandAwareness: 1, productQuality: 5 }
    }

    const after = advance({ ...start, companies }, 5).state
    expect(after.companies[id]!.marketShare).toBeGreaterThan(CONTROL.antitrustShare)
    expect(after.politics.antitrustCases.some((item) => item.targetId === id)).toBe(true)
    expect(after.player.notoriety).toBeGreaterThan(0)
  })
})
