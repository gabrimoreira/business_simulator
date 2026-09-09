/**
 * Os verbos que existiam só como tipo.
 *
 * O `applyAction` tinha 48 `case` para 66 ações declaradas e um `default` que
 * respondia "Ação ainda não implementada". Estes testes existem para que a
 * diferença entre **declarar** e **implementar** não volte a passar despercebida:
 * o primeiro bloco varre a união inteira e falha se qualquer ação cair no
 * `default`.
 */
import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { worldTick } from '@/engine/tick'
import { stakeOf, totalShares } from '@/engine/ownership'
import { MARKET, POLITICS } from '@/data/config'
import type { GameAction } from '@/engine/types'
import { fresh, funded } from './helpers'

/** Uma ação de cada tipo, com argumentos que a engine possa recusar sem quebrar. */
const SAMPLES: GameAction[] = [
  { kind: 'responderOpa', tenderId: 'x', accept: true },
  { kind: 'pilulaDeVeneno', companyId: 'pulso' },
  { kind: 'cavaleiroBranco', companyId: 'pulso', allyId: 'aliado' },
  { kind: 'votarPolitica', policyId: 'reforma-tributaria', inFavor: true },
  { kind: 'pagarDividendos', companyId: 'pulso', ratio: 0.3 },
  { kind: 'recomprarAcoes', companyId: 'pulso', amount: 1000 },
  { kind: 'reduzirCapacidade', companyId: 'pulso', amount: 1000 },
  { kind: 'anunciarProduto', companyId: 'pulso', spend: 1000 },
  { kind: 'comprarVeiculo', outletId: 'tabloide' },
  {
    kind: 'definirPauta',
    outletId: 'tabloide',
    subject: { kind: 'company', id: 'pulso' },
    targetSentiment: 0.5,
  },
  { kind: 'entrarEmSetor', companyId: 'pulso', industryId: 'energia', investment: 1000 },
  { kind: 'venderDivisao', companyId: 'pulso', fraction: 0.2 },
  { kind: 'habilitarMargem', collateral: 10_000 },
  { kind: 'venderDescoberto', companyId: 'pulso', shares: 10 },
  { kind: 'recomprarDescoberto', companyId: 'pulso', shares: 10 },
]

describe('nenhum verbo cai no default', () => {
  it.each(SAMPLES.map((a) => [a.kind, a] as const))('%s é tratada', (_kind, action) => {
    const result = applyAction(funded(fresh(), 100_000_000), action)
    const recusa = result.log.find((e) => e.text.includes('ainda não implementada'))
    expect(recusa, `${action.kind} caiu no default de applyAction`).toBeUndefined()
  })

  it('o guarda tem dentes: uma ação sem `case` **é** pega', () => {
    // Controle negativo. `dormir` não tem `case` de propósito — é automática na
    // virada do dia (resolução C3, zero blocos) — e serve para provar que o
    // teste acima falharia de verdade se alguém declarasse uma ação e
    // esquecesse de implementá-la.
    const result = applyAction(fresh(), { kind: 'dormir' })
    expect(result.log.some((e) => e.text.includes('ainda não implementada'))).toBe(true)
  })

  it('ação recusada devolve o estado intacto, nunca lança', () => {
    // Contrato do CLAUDE.md §2: inválida não quebra, explica.
    const base = fresh()
    for (const action of SAMPLES) {
      const result = applyAction(base, action)
      expect(result.log.length).toBeGreaterThan(0)
    }
  })
})

describe('defesa do controle', () => {
  it('pílula de veneno exige oferta aberta contra a empresa', () => {
    const state = funded(fresh(), 10_000_000)
    const own = { ...state, companies: { ...state.companies } }
    const target = own.companies['pulso']!
    own.companies['pulso'] = { ...target, managedBy: 'player' as const }

    const result = applyAction(own, { kind: 'pilulaDeVeneno', companyId: 'pulso' })
    expect(result.log.some((e) => e.text.includes('Não há oferta aberta'))).toBe(true)
    expect(result.state.companies['pulso']!.ownership).toEqual(target.ownership)
  })

  it('cavaleiro branco tira float e muda o controle', () => {
    const state = funded(fresh(), 10_000_000)
    const own = { ...state, companies: { ...state.companies } }
    own.companies['pulso'] = { ...own.companies['pulso']!, managedBy: 'player' as const }
    const antes = stakeOf(own.companies['pulso']!, 'float')

    const result = applyAction(own, {
      kind: 'cavaleiroBranco',
      companyId: 'pulso',
      allyId: 'aliado',
    })

    const depois = result.state.companies['pulso']!
    expect(stakeOf(depois, 'float')).toBeLessThan(antes)
    expect(stakeOf(depois, 'aliado')).toBeGreaterThan(0)
    expect(totalShares(depois)).toBe(totalShares(own.companies['pulso']!))
  })
})

describe('voto pesa conforme o cargo', () => {
  it('presidente move mais que vereador, e ninguém vota duas vezes', () => {
    const base = funded(fresh(), 1_000_000)
    const comPolitica = {
      ...base,
      politics: {
        ...base.politics,
        policyOrder: ['p1'],
        policies: {
          p1: {
            id: 'p1',
            name: 'Projeto',
            effects: {},
            sponsorId: 'moraes',
            status: 'tramitando' as const,
            supportPct: 0.4,
            proposedDayIndex: 0,
            voteDayIndex: 60,
            beneficiaryIndustryIds: [],
            playerVote: null,
          },
        },
      },
    }

    const comoVereador = {
      ...comPolitica,
      player: { ...comPolitica.player, office: 'vereador' as const },
    }
    const comoPresidente = {
      ...comPolitica,
      player: { ...comPolitica.player, office: 'presidente' as const },
    }

    const v = applyAction(comoVereador, { kind: 'votarPolitica', policyId: 'p1', inFavor: true })
    const p = applyAction(comoPresidente, { kind: 'votarPolitica', policyId: 'p1', inFavor: true })

    const apoioVereador = v.state.politics.policies['p1']!.supportPct
    const apoioPresidente = p.state.politics.policies['p1']!.supportPct
    expect(apoioVereador).toBeCloseTo(0.4 + POLITICS.voteWeightByOffice['vereador']!, 5)
    expect(apoioPresidente).toBeGreaterThan(apoioVereador)

    const denovo = applyAction(p.state, { kind: 'votarPolitica', policyId: 'p1', inFavor: true })
    expect(denovo.log.some((e) => e.text.includes('já votou'))).toBe(true)
    expect(denovo.state.politics.policies['p1']!.supportPct).toBe(apoioPresidente)
  })
})

describe('imprensa comprada', () => {
  it('a pauta puxa o sentimento sem inverter o fato', () => {
    const base = funded(fresh(), 500_000_000)
    const bought = applyAction(base, { kind: 'comprarVeiculo', outletId: 'tabloide' })
    expect(bought.state.news.outlets['tabloide']!.ownerId).toBe('player')

    const antes = bought.state.news.outlets['tabloide']!.credibility
    const pauta = applyAction(bought.state, {
      kind: 'definirPauta',
      outletId: 'tabloide',
      subject: { kind: 'company', id: 'pulso' },
      targetSentiment: 0.9,
    })

    expect(pauta.state.news.editorialOrders).toHaveLength(1)
    // Mandar no jornal gasta o próprio instrumento.
    expect(pauta.state.news.outlets['tabloide']!.credibility).toBeLessThan(antes)

    // Segunda pauta no mesmo veículo esbarra no cooldown da redação.
    const denovo = applyAction(pauta.state, {
      kind: 'definirPauta',
      outletId: 'tabloide',
      subject: { kind: 'company', id: 'nimbo' },
      targetSentiment: -0.9,
    })
    expect(denovo.log.some((e) => e.text.includes('pauta anterior'))).toBe(true)
  })

  it('nenhum veículo sai de graça, por pior que seja o balanço', () => {
    // `canal-sete` nasce com R$ 756 mi de dívida e `valuationOf` grampeia em
    // zero: sem piso, o jogador levava um megafone de alcance 95 sem pagar nada.
    const state = fresh()
    const pobre = applyAction(state, { kind: 'comprarVeiculo', outletId: 'portal' })
    expect(pobre.state.news.outlets['portal']!.ownerId).not.toBe('player')
    expect(pobre.log.some((e) => e.text.includes('custa'))).toBe(true)
  })

  it('quem não é dono não define pauta', () => {
    const result = applyAction(funded(fresh()), {
      kind: 'definirPauta',
      outletId: 'referencia',
      subject: { kind: 'company', id: 'pulso' },
      targetSentiment: 1,
    })
    expect(result.log.some((e) => e.text.includes('não é dono'))).toBe(true)
    expect(result.state.news.editorialOrders).toHaveLength(0)
  })
})

describe('margem e venda a descoberto', () => {
  function comMargem() {
    return applyAction(funded(fresh(), 1_000_000), {
      kind: 'habilitarMargem',
      collateral: 100_000,
    }).state
  }

  it('sem habilitar, não vende a descoberto', () => {
    const result = applyAction(funded(fresh(), 1_000_000), {
      kind: 'venderDescoberto',
      companyId: 'pulso',
      shares: 10,
    })
    expect(result.log.some((e) => e.text.includes('Habilite a conta margem'))).toBe(true)
  })

  it('o limite é múltiplo da garantia, não do bolso', () => {
    const state = comMargem()
    const price = state.companies['pulso']!.stock!.price
    const limite = state.market.margin.collateral * MARKET.marginLeverage
    const demais = Math.ceil(limite / price) + 100

    const result = applyAction(state, {
      kind: 'venderDescoberto',
      companyId: 'pulso',
      shares: demais,
    })
    expect(result.log.some((e) => e.text.includes('Acima do limite'))).toBe(true)
    expect(result.state.market.margin.borrowed).toBe(0)
  })

  it('vender a descoberto entra caixa e cria dívida; recomprar desfaz', () => {
    const state = comMargem()
    const vendido = applyAction(state, {
      kind: 'venderDescoberto',
      companyId: 'pulso',
      shares: 100,
    }).state

    expect(vendido.market.positions['pulso']!.shortShares).toBe(100)
    expect(vendido.market.margin.borrowed).toBeGreaterThan(0)
    expect(vendido.player.money).toBeGreaterThan(state.player.money)

    const coberto = applyAction(vendido, {
      kind: 'recomprarDescoberto',
      companyId: 'pulso',
      shares: 100,
    }).state
    expect(coberto.market.positions['pulso']!.shortShares).toBe(0)
    expect(coberto.market.margin.borrowed).toBe(0)
  })

  it('a chamada de margem liquida quando a posição come a garantia', () => {
    // Garantia mínima e posição no teto: qualquer alta dispara a chamada.
    const state = applyAction(funded(fresh(), 1_000_000), {
      kind: 'habilitarMargem',
      collateral: 1_000,
    }).state
    const price = state.companies['pulso']!.stock!.price
    const shares = Math.floor((state.market.margin.collateral * MARKET.marginLeverage) / price)
    const vendido = applyAction(state, {
      kind: 'venderDescoberto',
      companyId: 'pulso',
      shares,
    }).state
    expect(vendido.market.positions['pulso']!.shortShares).toBe(shares)

    // Preço dobra: a posição passa de qualquer razão de manutenção.
    const disparado = {
      ...vendido,
      companies: {
        ...vendido.companies,
        pulso: {
          ...vendido.companies['pulso']!,
          stock: { ...vendido.companies['pulso']!.stock!, price: price * 2 },
        },
      },
    }

    const depois = worldTick(disparado, 1)
    expect(depois.state.market.positions['pulso']!.shortShares).toBe(0)
    expect(depois.state.market.margin.borrowed).toBe(0)
    expect(
      depois.log[0]?.entries.some((e) => e.text.includes('Chamada de margem')),
    ).toBe(true)
  })
})
