/**
 * A tela de patrimônio.
 *
 * O único teste que importa aqui é o de reconciliação: a soma dos grupos tem de
 * bater com `netWorth` ao centavo. Uma tela que lista o que é seu e fecha num
 * número diferente do placar do jogo é pior que nenhuma — o jogador se orienta
 * por ela.
 */
import { describe, expect, it } from 'vitest'
import { holdingsFor } from '@/ui/holdings'
import { applyAction } from '@/engine/actions'
import { netWorth, outletHoldingsValue } from '@/engine/selectors'
import { fresh, funded, employed, advance } from './helpers'
import type { GameState } from '@/engine/types'

/** Um jogador com um pouco de cada coisa: ação, bem, empresa, banco e dívida. */
function comDeTudo(): GameState {
  // Empregado: sem renda comprovada nenhum banco empresta, e o teste precisa de
  // uma dívida de verdade para checar o sinal do grupo.
  let state = employed(fresh(), 5_000, 50_000_000)

  state = applyAction(state, {
    kind: 'comprarAcao',
    companyId: 'pulso',
    shares: 500,
    limitPrice: null,
  }).state
  state = applyAction(state, { kind: 'aplicar', bankId: 'povo', amount: 200_000 }).state
  state = applyAction(state, {
    kind: 'fundarEmpresa',
    name: 'Oficina',
    industryId: 'varejo',
    capital: 300_000,
  }).state
  const asset = state.personalAssets.assets[0]
  expect(asset).toBeUndefined()
  state = applyAction(state, { kind: 'comprarAtivo', assetId: 'carro-popular', financed: false }).state
  state = applyAction(state, {
    kind: 'tomarEmprestimo',
    bankId: 'povo',
    loanKind: 'pessoal',
    amount: 5_000,
    termDays: 720,
  }).state
  expect(state.banking.loans.some((loan) => loan.borrower === 'player')).toBe(true)
  return state
}

describe('patrimônio', () => {
  it('a soma dos grupos bate com o patrimônio líquido', () => {
    const state = comDeTudo()
    const holdings = holdingsFor(state)
    expect(holdings.total).toBeCloseTo(netWorth(state), 2)
  })

  it('continua batendo depois de um ano de mundo rodando', () => {
    // O caso que pega sistema novo: preço de ação muda, bem deprecia, empresa
    // dá lucro, empréstimo amortiza. Se algum deles sair da conta, aparece aqui.
    const state = advance(comDeTudo(), 365).state
    const holdings = holdingsFor(state)
    expect(holdings.total).toBeCloseTo(netWorth(state), 2)
  })

  it('separa dívida de ativo, e dívida entra negativa', () => {
    const state = comDeTudo()
    const holdings = holdingsFor(state)
    const dividas = holdings.groups.find((group) => group.label === 'Dívidas')
    expect(dividas).toBeDefined()
    expect(dividas!.total).toBeLessThan(0)
    expect(holdings.debts).toBe(dividas!.total)
    expect(holdings.assets).toBeGreaterThan(0)
    expect(holdings.assets + holdings.debts).toBeCloseTo(holdings.total, 2)
  })

  it('mostra os grupos que o jogador realmente tem, e só eles', () => {
    const state = comDeTudo()
    const labels = holdingsFor(state).groups.map((group) => group.label)
    expect(labels).toContain('Ações')
    expect(labels).toContain('Bens')
    expect(labels).toContain('Empresas')
    expect(labels).toContain('Contas e aplicações')
    // Nenhum veículo comprado ainda.
    expect(labels).not.toContain('Imprensa')
  })

  it('jogo recém-criado não quebra e não inventa grupo', () => {
    const state = fresh()
    const holdings = holdingsFor(state)
    expect(holdings.total).toBeCloseTo(netWorth(state), 2)
    expect(holdings.groups.every((group) => group.lines.length > 0)).toBe(true)
  })

  it('empresa listada não é contada duas vezes', () => {
    /**
     * A participação em empresa aberta já está em Ações. Se o grupo Empresas a
     * somasse de novo, o total estouraria o patrimônio — e era o jeito mais
     * fácil de esta tela mentir.
     */
    const state = comDeTudo()
    const holdings = holdingsFor(state)
    const empresas = holdings.groups.find((group) => group.label === 'Empresas')
    for (const line of empresas?.lines ?? []) {
      const id = line.id.replace('empresa-', '')
      expect(state.companies[id]!.isPublic).toBe(false)
    }
    expect(holdings.total).toBeCloseTo(netWorth(state), 2)
  })

  it('jornal comprado vira patrimônio, e não some do placar', () => {
    /**
     * O buraco que esta tela expôs: `comprarVeiculo` debitava o preço e o
     * veículo não entrava em lugar nenhum. Comprar imprensa apagava dinheiro do
     * placar para sempre — a mesma família do defeito de `privateHoldingsValue`,
     * em que possuir valia menos que a coisa vale.
     */
    const antes = funded(fresh(), 500_000_000)
    const outletId = antes.news.outletOrder[0]!
    const patrimonioAntes = netWorth(antes)

    const depois = applyAction(antes, { kind: 'comprarVeiculo', outletId }).state
    expect(depois.news.outlets[outletId]!.ownerId).toBe('player')
    expect(outletHoldingsValue(depois)).toBeGreaterThan(0)

    // Comprar troca dinheiro por jornal: o patrimônio não muda de verdade.
    expect(netWorth(depois)).toBeCloseTo(patrimonioAntes, 2)

    const holdings = holdingsFor(depois)
    expect(holdings.groups.map((group) => group.label)).toContain('Imprensa')
    expect(holdings.total).toBeCloseTo(netWorth(depois), 2)
  })
})
