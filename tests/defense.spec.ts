import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import {
  buyback,
  familyRefuses,
  poisonPill,
  stakeOf,
  totalShares,
  whiteKnight,
} from '@/engine/ownership'
import { DEFENSE, TYCOONS } from '@/data/config'
import { TYCOON_SEEDS } from '@/data/tycoons'
import type { GameState } from '@/engine/types'
import { advance, fresh, funded } from './helpers'

const TARGET = 'pulso'

/** Compra até cruzar a fatia pedida, respeitando o teto de volume diário. */
function accumulateTo(state: GameState, companyId: string, target: number): GameState {
  let current = state
  for (let i = 0; i < 400; i += 1) {
    const company = current.companies[companyId]!
    if (stakeOf(company, 'player') >= target) break
    const float = company.ownership.find((entry) => entry.holderId === 'float')?.shares ?? 0
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

describe('defesa do conselho', () => {
  it('acumular 5% dispara reação defensiva em menos de 15 dias', () => {
    const start = advance(funded(fresh(), 2_000_000_000), 90).state
    const crossed = accumulateTo(start, TARGET, DEFENSE.wakeStake + 0.01)
    expect(stakeOf(crossed.companies[TARGET]!, 'player')).toBeGreaterThanOrEqual(DEFENSE.wakeStake)

    const after = advance(crossed, 15).state
    const against = after.ai.defenses.filter(
      (defense) => defense.companyId === TARGET && defense.againstId === 'player',
    )
    expect(against.length).toBeGreaterThan(0)

    // O prazo conta a partir da **divulgação** que acordou o conselho, não do
    // fim da acumulação: a defesa costuma vir antes de eu parar de comprar.
    const disclosure = after.ownershipDisclosures.find(
      (item) => item.companyId === TARGET && item.holderId === 'player',
    )
    expect(disclosure).toBeDefined()
    expect(against[0]!.dayIndex - disclosure!.dayIndex).toBeLessThanOrEqual(15)
  })

  it('a defesa vira manchete: o jogador precisa ver que acordou o conselho', () => {
    const start = advance(funded(fresh(), 2_000_000_000), 90).state
    const after = advance(accumulateTo(start, TARGET, 0.06), 15).state
    expect(
      after.news.headlines.some(
        (headline) =>
          headline.subject.kind === 'company' &&
          headline.subject.id === TARGET &&
          /recompra|diluidora|cavaleiro|defesa/i.test(headline.text),
      ),
    ).toBe(true)
  })

  it('o conselho marca rancor em quem atacou', () => {
    const start = advance(funded(fresh(), 2_000_000_000), 90).state
    const after = advance(accumulateTo(start, TARGET, 0.06), 15).state
    const agent = after.ai.agents[TARGET]
    expect(agent?.grudge['player'] ?? 0).toBeGreaterThan(0)
  })
})

describe('mecânica das defesas', () => {
  it('a pílula de veneno transfere valor do atacante, sem criar nem destruir', () => {
    const state = fresh()
    const company = { ...state.companies[TARGET]!, stock: { ...state.companies[TARGET]!.stock! } }
    company.ownership = company.ownership.map((entry) => ({ ...entry }))
    company.ownership.push({ holderId: 'player', shares: 10_000_000 })
    company.stock.sharesOutstanding = totalShares(company)

    const sharesBefore = totalShares(company)
    const priceBefore = company.stock.price
    const capBefore = sharesBefore * priceBefore
    const raiderBefore = stakeOf(company, 'player')
    const raiderValueBefore = 10_000_000 * priceBefore

    poisonPill(company, 'player', DEFENSE.poisonPillIssue)

    const capAfter = totalShares(company) * company.stock.price
    // Valor de mercado intacto: a pílula não inventa dinheiro nem queima.
    expect(capAfter).toBeCloseTo(capBefore, 0)
    // O atacante fica com menos poder e menos valor.
    expect(stakeOf(company, 'player')).toBeLessThan(raiderBefore)
    expect(10_000_000 * company.stock.price).toBeLessThan(raiderValueBefore)
  })

  it('a recompra retira ações de circulação e gasta caixa', () => {
    const state = fresh()
    const company = {
      ...state.companies[TARGET]!,
      cash: 50_000_000,
      stock: { ...state.companies[TARGET]!.stock! },
      ownership: state.companies[TARGET]!.ownership.map((entry) => ({ ...entry })),
    }
    const sharesBefore = company.stock.sharesOutstanding
    const cashBefore = company.cash

    const bought = buyback(state, company, 10_000_000)

    expect(bought).toBeGreaterThan(0)
    expect(company.stock.sharesOutstanding).toBe(sharesBefore - bought)
    expect(company.cash).toBeLessThan(cashBefore)
  })

  it('o cavaleiro branco tira papéis do mercado', () => {
    const state = fresh()
    const company = {
      ...state.companies[TARGET]!,
      ownership: state.companies[TARGET]!.ownership.map((entry) => ({ ...entry })),
    }
    const floatBefore = company.ownership.find((entry) => entry.holderId === 'float')!.shares

    const moved = whiteKnight(company, 'cavaleiro@pulso', DEFENSE.whiteKnightFloat)

    expect(moved).toBeGreaterThan(0)
    expect(company.ownership.find((entry) => entry.holderId === 'float')!.shares).toBe(
      floatBefore - moved,
    )
    expect(totalShares(company)).toBe(
      state.companies[TARGET]!.ownership.reduce((sum, entry) => sum + entry.shares, 0),
    )
  })
})

describe('Herdeiro', () => {
  it('a família recusa OPA com qualquer prêmio', () => {
    const state = fresh()
    // Órion Medicina é dirigida por um Herdeiro na distribuição da seed.
    const company = state.companies['orion-med']!
    expect(state.ai.agents['orion-med']!.profileId).toBe('herdeiro')
    expect(familyRefuses(state, company, 'familia@orion-med')).toBe(true)

    // O mesmo bloco numa empresa de outro arquétipo não tem essa blindagem.
    expect(familyRefuses(state, state.companies['nimbo']!, 'familia@nimbo')).toBe(false)
  })

  it('uma oferta com prêmio de 100% não move o bloco familiar', () => {
    const start = advance(funded(fresh(), 5_000_000_000), 90).state
    const company = start.companies['orion-med']!
    const familyBefore = company.ownership.find((entry) =>
      entry.holderId.startsWith('familia@'),
    )!.shares

    const launched = applyAction(start, {
      kind: 'lancarOpa',
      companyId: 'orion-med',
      premium: 1,
      sharesSought: company.stock!.sharesOutstanding,
    })
    const resolved = advance(launched.state, 35).state
    const familyAfter = resolved.companies['orion-med']!.ownership.find((entry) =>
      entry.holderId.startsWith('familia@'),
    )!.shares

    expect(familyAfter).toBe(familyBefore)
  })
})

describe('tycoons rivais', () => {
  // Caixa alto no jogador só para o mundo continuar rodando: quem morre de
  // fome congela o tick e o teste passaria a medir um mundo parado.
  const played = advance(funded(fresh(), 5_000_000_000), 900).state

  it('existem, têm patrimônio e acumulam posição de verdade', () => {
    expect(played.ai.tycoonOrder).toHaveLength(TYCOON_SEEDS.length)
    const stakes = played.ai.tycoonOrder.flatMap((tycoonId) =>
      played.companyOrder.map((companyId) => stakeOf(played.companies[companyId]!, tycoonId)),
    )
    expect(Math.max(...stakes)).toBeGreaterThan(TYCOONS.tenderFromStake)
  })

  it('aparecem nas manchetes pelo nome', () => {
    const names = TYCOON_SEEDS.map((seed) => seed.name)
    expect(
      played.news.headlines.some((headline) => names.some((name) => headline.text.includes(name))),
    ).toBe(true)
  })

  it('lançam oferta hostil quando formam base', () => {
    const tenders = played.tenders.filter((tender) => tender.bidderId !== 'player')
    expect(tenders.length).toBeGreaterThan(0)
    expect(tenders[0]!.hostile).toBe(true)
  })

  it('um rival acima de 50% tira a empresa do jogador', () => {
    const base = funded(fresh(), 5_000_000)
    const id = 'pulso'
    const tycoonId = TYCOON_SEEDS[0]!.id
    const company = base.companies[id]!
    const shares = company.stock!.sharesOutstanding

    const seized = {
      ...base,
      companies: {
        ...base.companies,
        [id]: {
          ...company,
          managedBy: 'player' as const,
          ownership: [
            { holderId: tycoonId, shares: Math.round(shares * 0.6) },
            { holderId: 'float', shares: shares - Math.round(shares * 0.6) },
          ],
        },
      },
    }

    const after = advance(seized, 2).state
    expect(after.companies[id]!.managedBy).toBe('ai')
    expect(after.ai.tycoons[tycoonId]!.controlledCompanyIds).toContain(id)
    expect(after.log.some((entry) => entry.text.includes('não é mais sua'))).toBe(true)
  })
})

describe('nomeação de CEO', () => {
  function controlled(): { state: GameState; id: string } {
    const base = funded(fresh(), 5_000_000)
    const id = 'pulso'
    const company = base.companies[id]!
    const shares = company.stock!.sharesOutstanding
    return {
      state: {
        ...base,
        companies: {
          ...base.companies,
          [id]: {
            ...company,
            managedBy: 'player' as const,
            ownership: [{ holderId: 'player', shares }],
          },
        },
      },
      id,
    }
  }

  it('exige controle', () => {
    const result = applyAction(funded(fresh(), 5_000_000), {
      kind: 'nomearCeo',
      companyId: 'nimbo',
      profileId: 'fortaleza',
    })
    expect(result.log[0]?.text).toContain('controlar')
  })

  it('delega a empresa e aplica as regras do arquétipo na diretriz', () => {
    const { state, id } = controlled()
    const result = applyAction(state, { kind: 'nomearCeo', companyId: id, profileId: 'oficina' })
    const company = result.state.companies[id]!

    expect(company.managedBy).toBe('ai')
    expect(result.state.ai.agents[id]!.profileId).toBe('oficina')
    expect(result.state.ai.agents[id]!.appointedByPlayer).toBe(true)
    // A Oficina chega mandando: P&D no piso do arquétipo.
    expect(company.directives.rndRatio).toBeGreaterThanOrEqual(0.25)
    expect(result.state.player.blocksUsedToday).toBe(1)
  })

  it('a delegação sobrevive à reavaliação de controle', () => {
    const { state, id } = controlled()
    const delegated = applyAction(state, {
      kind: 'nomearCeo',
      companyId: id,
      profileId: 'fortaleza',
    }).state

    const later = advance(delegated, 30).state
    expect(later.companies[id]!.managedBy).toBe('ai')
    expect(later.ai.agents[id]!.appointedByPlayer).toBe(true)
  })
})
