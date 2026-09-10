/**
 * O extrato por categoria.
 *
 * A regra de classificação é o que erra — e um extrato que classifica errado é
 * pior que nenhum, porque o jogador se orienta por ele.
 */
import { describe, expect, it } from 'vitest'
import { ledgerFor } from '@/ui/ledger'
import type { LogEntry, Money } from '@/engine/types'
import { applyAction } from '@/engine/actions'
import { fresh, funded } from './helpers'

function entry(source: string, amount: Money | null, text = 'x'): LogEntry {
  return { id: `${source}-${amount}-${text}`, dayIndex: 1, severity: 'info', source, text, amount }
}

describe('extrato por categoria', () => {
  it('separa ganho de gasto dentro do mesmo sistema', () => {
    // Salário e contas do mês saem os dois de `player`. Somá-los num grupo só
    // devolveria o líquido, que é exatamente o número inútil que este módulo
    // existe para substituir.
    const ledger = ledgerFor([entry('player', 2000, 'Salário'), entry('player', -900, 'Contas')])

    expect(ledger.groups).toHaveLength(2)
    expect(ledger.groups.map((g) => g.label).sort()).toEqual(['Salário', 'Vida e contas'])
    expect(ledger.income).toBe(2000)
    expect(ledger.spent).toBe(-900)
    expect(ledger.net).toBe(1100)
  })

  it('ignora o que não é dinheiro', () => {
    // O log tem promoção, manchete e evento sem `amount`. Misturá-los faria o
    // extrato parecer errado.
    const ledger = ledgerFor([
      entry('player', null, 'Promovido'),
      entry('news', null, 'Manchete'),
      entry('player', -50, 'Refeição'),
    ])
    expect(ledger.groups).toHaveLength(1)
    expect(ledger.net).toBe(-50)
  })

  it('ignora movimento de valor zero', () => {
    expect(ledgerFor([entry('player', 0)]).groups).toHaveLength(0)
  })

  it('o que mais moveu o caixa vem primeiro', () => {
    const ledger = ledgerFor([
      entry('news', -180, 'Assinatura'),
      entry('banking', -3000, 'Parcela'),
      entry('assets', 500, 'Aluguel'),
    ])
    expect(ledger.groups.map((g) => g.label)).toEqual([
      'Banco e parcelas',
      'Aluguéis',
      'Imprensa',
    ])
  })

  it('agrupa várias entradas da mesma categoria e guarda as linhas', () => {
    const ledger = ledgerFor([
      entry('player', -8, 'Marmita'),
      entry('player', -20, 'Refeição'),
      entry('player', -60, 'Restaurante'),
    ])
    expect(ledger.groups).toHaveLength(1)
    expect(ledger.groups[0]!.total).toBe(-88)
    expect(ledger.groups[0]!.lines).toHaveLength(3)
  })

  it('categoriza ação do jogador pelo id que a engine gera', () => {
    // Trava o acoplamento: o parser lê `act-{dia}-{bloco}-{kind}`, o formato que
    // `entryFor` monta em `engine/actions.ts`. Este teste usa a engine de
    // verdade, então mudar o formato do id quebra aqui — e não no extrato do
    // jogador, silenciosamente.
    const comprou = applyAction(funded(fresh(), 1_000_000), { kind: 'comer', mealId: 'marmita' })
    const ledger = ledgerFor(comprou.log)
    expect(ledger.groups[0]!.label).toBe('Comida')

    const acao = applyAction(funded(fresh(), 10_000_000), {
      kind: 'comprarAcao',
      companyId: 'pulso',
      shares: 10,
      limitPrice: null,
    })
    expect(ledgerFor(acao.log).groups[0]!.label).toBe('Bolsa')
  })

  it('lote vazio devolve extrato zerado, sem quebrar', () => {
    const ledger = ledgerFor([])
    expect(ledger.groups).toEqual([])
    expect(ledger.net).toBe(0)
  })

  it('fonte desconhecida não some do extrato', () => {
    // Um sistema novo que ainda não tem rótulo próprio precisa aparecer, senão
    // o total dos grupos deixa de bater com o líquido.
    const ledger = ledgerFor([entry('sistema-novo', -42)])
    expect(ledger.groups).toHaveLength(1)
    expect(ledger.groups[0]!.label).toBe('Outras saídas')
    const soma = ledger.groups.reduce((total, group) => total + group.total, 0)
    expect(soma).toBe(ledger.net)
  })
})
