import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { activeDeltasOf, applyActiveDeltas, lobbyShift, netLobby } from '@/engine/politics'
import { findPolicyDef, POLICY_DEFS } from '@/data/policies'
import { POLITICS } from '@/data/config'
import { findIndustry } from '@/data/industries'
import type { GameState, Policy } from '@/engine/types'
import { advance, fresh, funded } from './helpers'

/** Põe uma política em tramitação, com a votação no dia pedido. */
function tabling(state: GameState, policyId: string, voteInDays = 60): GameState {
  const definition = findPolicyDef(policyId)!
  const policy: Policy = {
    id: definition.id,
    name: definition.name,
    effects: definition.effects,
    sponsorId: state.politics.politicianOrder[0]!,
    status: 'tramitando',
    supportPct: definition.baseSupport,
    proposedDayIndex: state.date.dayIndex,
    voteDayIndex: state.date.dayIndex + voteInDays,
    beneficiaryIndustryIds: definition.beneficiaryIndustryIds,
  }
  return {
    ...state,
    politics: {
      ...state.politics,
      policies: { ...state.politics.policies, [policy.id]: policy },
      policyOrder: [...state.politics.policyOrder, policy.id],
    },
  }
}

/** Aprova uma política à força, para medir o efeito dela. */
function enacted(state: GameState, policyId: string): GameState {
  const definition = findPolicyDef(policyId)!
  const policy: Policy = {
    id: definition.id,
    name: definition.name,
    effects: definition.effects,
    sponsorId: state.politics.politicianOrder[0]!,
    status: 'aprovada',
    supportPct: 0.8,
    proposedDayIndex: 0,
    voteDayIndex: 1,
    beneficiaryIndustryIds: definition.beneficiaryIndustryIds,
  }
  const next = {
    ...state,
    politics: {
      ...state.politics,
      policies: { ...state.politics.policies, [policy.id]: policy },
      policyOrder: [...state.politics.policyOrder, policy.id],
    },
    industries: Object.fromEntries(
      Object.entries(state.industries).map(([id, industry]) => [id, { ...industry }]),
    ),
    macro: { ...state.macro },
  }
  applyActiveDeltas(next)
  return next
}

describe('política aprovada altera o imposto', () => {
  it('o incentivo à tecnologia derruba a alíquota do setor', () => {
    const before = fresh()
    const base = findIndustry('tecnologia')!.taxRate
    expect(before.industries['tecnologia']!.taxRate).toBeCloseTo(base, 6)

    const after = enacted(before, 'incentivo-tecnologia')
    const delta = POLICY_DEFS.find((p) => p.id === 'incentivo-tecnologia')!.effects
      .taxRateByIndustry!['tecnologia']!

    expect(after.industries['tecnologia']!.taxRate).toBeCloseTo(base + delta, 6)
    expect(after.industries['tecnologia']!.subsidyRatio).toBeGreaterThan(0)
    // Setor não citado fica onde estava.
    expect(after.industries['bancos']!.taxRate).toBeCloseTo(findIndustry('bancos')!.taxRate, 6)
  })

  it('o efeito é recalculado do conjunto, não somado ao estado', () => {
    const once = enacted(fresh(), 'incentivo-tecnologia')
    // Reaplicar não acumula: é a diferença entre recalcular e somar delta.
    const twice = { ...once, industries: { ...once.industries } }
    applyActiveDeltas(twice)
    expect(twice.industries['tecnologia']!.taxRate).toBeCloseTo(
      once.industries['tecnologia']!.taxRate,
      6,
    )

    // Revogar devolve o mundo ao lugar.
    const repealed = {
      ...once,
      politics: {
        ...once.politics,
        policies: {
          ...once.politics.policies,
          'incentivo-tecnologia': {
            ...once.politics.policies['incentivo-tecnologia']!,
            status: 'rejeitada' as const,
          },
        },
      },
      industries: { ...once.industries },
      macro: { ...once.macro },
    }
    applyActiveDeltas(repealed)
    expect(repealed.industries['tecnologia']!.taxRate).toBeCloseTo(
      findIndustry('tecnologia')!.taxRate,
      6,
    )
  })

  it('e isso aparece no lucro das empresas do setor', () => {
    const seed = 5
    const days = 200
    const control = advance(funded(fresh(seed), 5_000_000), days).state
    const incentivized = advance(enacted(funded(fresh(seed), 5_000_000), 'incentivo-tecnologia'), days).state

    const sumProfit = (state: GameState, industryId: string): number =>
      state.industries[industryId]!.companyOrder.reduce(
        (sum, id) => sum + (state.companies[id]?.profitHistory[0] ?? 0),
        0,
      )

    // Menos imposto, mais lucro — no setor beneficiado e não nos outros.
    expect(sumProfit(incentivized, 'tecnologia')).toBeGreaterThan(sumProfit(control, 'tecnologia'))
  })

  it('o alvo de inflação obedece à política monetária aprovada', () => {
    const after = enacted(fresh(), 'meta-inflacao')
    expect(after.macro.inflationTarget).toBeLessThan(fresh().macro.inflationTarget)
  })
})

describe('lobby é leilão', () => {
  it('o deslocamento tem retorno decrescente', () => {
    const one = lobbyShift(POLITICS.lobbyUnit)
    const four = lobbyShift(POLITICS.lobbyUnit * 4)
    expect(four).toBeGreaterThan(one)
    // Quatro vezes o dinheiro não compra quatro vezes o resultado.
    expect(four).toBeLessThan(one * 4)
  })

  it('o dinheiro do outro lado cancela o seu', () => {
    let state = tabling(funded(fresh(), 100_000_000), 'aperto-ambiental')
    state = applyAction(state, {
      kind: 'fazerLobby',
      policyId: 'aperto-ambiental',
      amount: 5_000_000,
      direction: 1,
    }).state
    const soloShift = netLobby(state, 'aperto-ambiental')
    expect(soloShift).toBeGreaterThan(0)

    // Entra o contra-lobby com o mesmo valor: o saldo zera.
    state = {
      ...state,
      politics: {
        ...state.politics,
        lobbyEfforts: [
          ...state.politics.lobbyEfforts,
          {
            id: 'contra',
            policyId: 'aperto-ambiental',
            actorId: 'ferro-norte',
            amount: 5_000_000,
            direction: -1 as const,
            dayIndex: state.date.dayIndex,
          },
        ],
      },
    }
    expect(Math.abs(netLobby(state, 'aperto-ambiental'))).toBeLessThan(1e-9)

    // Quem gastar mais move o apoio.
    state = applyAction(state, {
      kind: 'fazerLobby',
      policyId: 'aperto-ambiental',
      amount: 20_000_000,
      direction: 1,
    }).state
    expect(netLobby(state, 'aperto-ambiental')).toBeGreaterThan(0)
  })

  it('o lobby decide a votação e some depois dela', () => {
    // Apoio começa em 0,3: sem lobby, o projeto cai.
    const base = tabling(funded(fresh(), 500_000_000), 'aperto-ambiental', 20)
    const semLobby = advance(base, 25).state
    expect(semLobby.politics.policies['aperto-ambiental']!.status).toBe('rejeitada')

    const comLobby = applyAction(base, {
      kind: 'fazerLobby',
      policyId: 'aperto-ambiental',
      amount: 400_000_000,
      direction: 1,
    }).state
    const votado = advance(comLobby, 25).state
    expect(votado.politics.policies['aperto-ambiental']!.status).toBe('aprovada')
    // O leilão daquele projeto se encerra com a votação.
    expect(
      votado.politics.lobbyEfforts.filter((effort) => effort.policyId === 'aperto-ambiental'),
    ).toHaveLength(0)
  })

  it('recusa lobby em política que não está em votação', () => {
    const result = applyAction(funded(fresh(), 10_000_000), {
      kind: 'fazerLobby',
      policyId: 'reforma-tributaria',
      amount: 1_000_000,
      direction: 1,
    })
    expect(result.log[0]?.text).toContain('votação')
  })
})

describe('doações e lealdade', () => {
  it('doar compra lealdade, com retorno decrescente', () => {
    const state = funded(fresh(), 100_000_000)
    const id = state.politics.politicianOrder[0]!

    const small = applyAction(state, { kind: 'doar', politicianId: id, amount: 100_000, fromCompanyId: null }).state
    const big = applyAction(state, { kind: 'doar', politicianId: id, amount: 1_000_000, fromCompanyId: null }).state

    const smallGain = small.politics.politicians[id]!.loyaltyToPlayer
    const bigGain = big.politics.politicians[id]!.loyaltyToPlayer
    expect(bigGain).toBeGreaterThan(smallGain)
    expect(bigGain).toBeLessThan(smallGain * 10)
  })

  it('doação de empresa é rastreável e custa mais notoriedade', () => {
    const base = funded(fresh(), 100_000_000)
    const id = base.politics.politicianOrder[0]!
    const companyId = base.companyOrder[0]!
    const owned = {
      ...base,
      companies: {
        ...base.companies,
        [companyId]: { ...base.companies[companyId]!, managedBy: 'player' as const, cash: 5_000_000 },
      },
    }

    const pessoal = applyAction(base, { kind: 'doar', politicianId: id, amount: 1_000_000, fromCompanyId: null }).state
    const empresa = applyAction(owned, { kind: 'doar', politicianId: id, amount: 1_000_000, fromCompanyId: companyId }).state

    expect(pessoal.politics.donations[0]!.traceable).toBe(false)
    expect(empresa.politics.donations[0]!.traceable).toBe(true)
    expect(empresa.player.notoriety).toBeGreaterThan(pessoal.player.notoriety)
    // Saiu do caixa da empresa, não do bolso.
    expect(empresa.companies[companyId]!.cash).toBeLessThan(owned.companies[companyId]!.cash)
    expect(empresa.player.money).toBe(owned.player.money)
  })

  it('a lealdade esfria com o tempo', () => {
    const state = applyAction(funded(fresh(), 100_000_000), {
      kind: 'doar',
      politicianId: fresh().politics.politicianOrder[0]!,
      amount: 2_000_000,
      fromCompanyId: null,
    }).state
    const id = state.politics.politicianOrder[0]!
    const before = state.politics.politicians[id]!.loyaltyToPlayer
    const later = advance(state, 200).state
    expect(later.politics.politicians[id]!.loyaltyToPlayer).toBeLessThan(before)
  })
})

describe('notoriedade e investigação', () => {
  it('notoriedade decai sozinha: chamar atenção não é crime permanente', () => {
    const noisy = { ...fresh(), player: { ...fresh().player, notoriety: 50 } }
    const later = advance(funded(noisy), 200).state
    expect(later.player.notoriety).toBeLessThan(50)
  })

  it('abre investigação acima do limiar', () => {
    const noisy = funded({
      ...fresh(),
      player: { ...fresh().player, notoriety: POLITICS.investigationThreshold + 5 },
    })
    const after = advance(noisy, 3).state
    expect(after.politics.investigations.some((item) => item.targetId === 'player')).toBe(true)
  })

  it('sem prova, arquiva; com prova, condena', () => {
    const noisy = funded({
      ...fresh(),
      player: { ...fresh().player, notoriety: POLITICS.investigationThreshold + 5 },
    })

    const clean = advance(noisy, POLITICS.investigationDeadlineDays + 10).state
    const cleanCase = clean.politics.investigations[0]!
    expect(cleanCase.evidence).toBeCloseTo(0, 6)
    expect(cleanCase.status).toBe('arquivada')

    // Agora com prova pesada: a condenação vem.
    const guilty = advance(
      {
        ...noisy,
        politics: {
          ...noisy.politics,
          investigations: [
            {
              id: 'inq-teste',
              targetId: 'player' as const,
              openedDayIndex: 0,
              deadlineDayIndex: 5,
              evidence: 500,
              status: 'aberta' as const,
              lawyerSpend: 0,
              shieldedByPoliticianId: null,
            },
          ],
        },
      },
      10,
    ).state

    expect(guilty.politics.investigations[0]!.status).toBe('condenada')
    expect(guilty.player.incarceratedDays).toBeGreaterThan(0)
    expect(guilty.player.publicReputation).toBeLessThan(0)
  })

  it('advogado apaga prova', () => {
    // `funded` sobrescreve o dinheiro: o valor vai no segundo argumento, senão
    // a ação é recusada por falta de caixa e o teste mede nada.
    const withCase = funded({
      ...fresh(),
      politics: {
        ...fresh().politics,
        investigations: [
          {
            id: 'inq-teste',
            targetId: 'player' as const,
            openedDayIndex: 0,
            deadlineDayIndex: 400,
            evidence: 10,
            status: 'aberta' as const,
            lawyerSpend: 0,
            shieldedByPoliticianId: null,
          },
        ],
      },
    }, 50_000_000)

    const defended = applyAction(withCase, {
      kind: 'contratarAdvogado',
      investigationId: 'inq-teste',
      spend: 5_000_000,
    }).state
    expect(defended.politics.investigations[0]!.evidence).toBeLessThan(10)
  })

  it('preso não age', () => {
    const jailed = {
      ...fresh(),
      player: { ...fresh().player, incarceratedDays: 30, money: 1_000_000 },
    }
    const result = applyAction(jailed, { kind: 'lazer' })
    expect(result.log[0]?.text).toContain('preso')
    expect(result.state.player.blocksUsedToday).toBe(0)
  })
})

describe('carreira política', () => {
  it('exige carisma, reputação e caixa de campanha', () => {
    const weak = funded(fresh(), 100_000_000)
    const result = applyAction(weak, {
      kind: 'candidatarCargo',
      office: 'senador',
      campaignSpend: 5_000_000,
    })
    expect(result.log[0]?.text).toContain('Carisma')
    expect(result.state.player.office).toBeNull()
  })

  it('com os requisitos, a candidatura acontece e pode eleger', () => {
    const strong = {
      ...funded(fresh(), 500_000_000),
      player: {
        ...fresh().player,
        money: 500_000_000,
        publicReputation: 60,
        skills: { ...fresh().player.skills, charisma: 95 },
      },
    }
    let elected = false
    let current = strong
    for (let attempt = 0; attempt < 20 && !elected; attempt += 1) {
      const result = applyAction(current, {
        kind: 'candidatarCargo',
        office: 'vereador',
        campaignSpend: 2_000_000,
      })
      current = { ...result.state, player: { ...result.state.player, blocksUsedToday: 0 } }
      elected = current.player.office !== null
    }
    expect(elected).toBe(true)
    expect(current.meta.officesHeld).toContain('vereador')
  })

  it('só quem tem cargo propõe política', () => {
    const result = applyAction(funded(fresh(), 10_000_000), {
      kind: 'proporPolitica',
      policyId: 'reforma-tributaria',
    })
    expect(result.log[0]?.text).toContain('cargo eletivo')
  })
})

describe('congresso vivo', () => {
  it('propõe, vota e elege ao longo de dez anos', () => {
    const state = advance(funded(fresh(), 5_000_000_000), 3650).state
    expect(state.politics.policyOrder.length).toBeGreaterThan(2)
    expect(state.politics.elections.length).toBeGreaterThanOrEqual(2)
    // O catálogo não se esgota: projeto rejeitado volta.
    const decided = state.politics.policyOrder.filter(
      (id) => state.politics.policies[id]!.status !== 'tramitando',
    )
    expect(decided.length).toBeGreaterThan(0)
  })

  it('os deltas vigentes refletem só o que está aprovado', () => {
    const state = enacted(fresh(), 'subsidio-energia')
    const deltas = activeDeltasOf(state)
    expect(deltas.subsidyByIndustry?.['energia']).toBeGreaterThan(0)
    expect(deltas.subsidyByIndustry?.['tecnologia'] ?? 0).toBe(0)
  })
})
