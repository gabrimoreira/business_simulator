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
import { employed, fresh, funded } from './helpers'
import { runDays } from '@/engine/autoplay'
import { bankBalance } from '@/engine/selectors'

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

    // Bolsa é transferência, então cai em `transfers` e não em `groups` — mas a
    // categoria continua sendo lida do id do mesmo jeito.
    const acao = applyAction(funded(fresh(), 10_000_000), {
      kind: 'comprarAcao',
      companyId: 'pulso',
      shares: 10,
      limitPrice: null,
    })
    expect(ledgerFor(acao.log).transfers[0]!.label).toBe('Bolsa')
  })

  it('comprar ação não mexe no saldo: é transferência, não perda', () => {
    /**
     * O erro que o playtest apontou.
     *
     * Comprar R$ 50 mil em ação sai do caixa e entra na carteira: patrimônio
     * idêntico. Somar isso ao saldo fazia o balanço do mês oscilar a esmo, "pra
     * mais ou pra menos", sem relação com o que o jogador ganhou ou perdeu.
     */
    const rico = funded(fresh(), 10_000_000)
    const comprou = applyAction(rico, {
      kind: 'comprarAcao',
      companyId: 'pulso',
      shares: 1000,
      limitPrice: null,
    })
    const ledger = ledgerFor(comprou.log)

    expect(ledger.net).toBe(0)
    expect(ledger.spent).toBe(0)
    expect(ledger.moved).toBeGreaterThan(0)
    expect(ledger.transfers.length).toBeGreaterThan(0)
    expect(ledger.groups).toHaveLength(0)
  })

  it('salário e contas continuam mexendo no saldo', () => {
    // O contraponto: renda e despesa **mudam** patrimônio e têm de contar.
    const ledger = ledgerFor([entry('player', 2000, 'Salário'), entry('player', -900, 'Contas')])
    expect(ledger.net).toBe(1100)
    expect(ledger.moved).toBe(0)
    expect(ledger.transfers).toHaveLength(0)
  })

  it('aplicar no banco é transferência; comer não é', () => {
    const rico = funded(fresh(), 100_000)
    const aplicou = applyAction(rico, { kind: 'aplicar', bankId: 'povo', amount: 10_000 })
    expect(ledgerFor(aplicou.log).net).toBe(0)

    const comeu = applyAction(rico, { kind: 'comer', mealId: 'normal' })
    expect(ledgerFor(comeu.log).net).toBeLessThan(0)
  })

  it('dinheiro de NPC não entra no extrato do jogador', () => {
    // O log da engine é do **mundo**. `agents.ts` registra a recompra defensiva
    // de uma empresa da IA com `amount`, e somá-la fazia o resumo de um mês
    // aparecer como −R$ 54,9 milhões no playtest.
    const ledger = ledgerFor([
      entry('ai', -54_918_694, 'Trilha Calçados contrata banco de defesa'),
      entry('player', -900, 'Contas'),
    ])
    expect(ledger.net).toBe(-900)
    expect(ledger.groups).toHaveLength(1)
  })

  it('o extrato fecha com o que saiu do bolso, num trimestre simulado', () => {
    /**
     * O invariante que torna a lista de permissão verificável em vez de
     * palpite: sem ação manual, transferência entre caixa e banco se anula na
     * soma, então o saldo do extrato tem de bater **exatamente** com a variação
     * de `caixa + banco`.
     *
     * Usa `runDays` da autoplay, e não o helper `advance`: o helper devolve só
     * as entradas do tick e descarta o log das refeições, o que dava uma
     * diferença de R$ 1.790 e por um momento pareceu bug do extrato.
     */
    let state = employed(fresh(), 5000, 50_000)
    const antes = state.player.money + bankBalance(state)

    const entries: LogEntry[] = []
    for (let day = 0; day < 90; day += 1) {
      const result = runDays(state, 1)
      state = result.state
      entries.push(...(result.log[0]?.entries ?? []))
    }

    const depois = state.player.money + bankBalance(state)
    expect(ledgerFor(entries).net).toBeCloseTo(depois - antes, 2)
  })

  it('lote vazio devolve extrato zerado, sem quebrar', () => {
    const ledger = ledgerFor([])
    expect(ledger.groups).toEqual([])
    expect(ledger.net).toBe(0)
  })

  it('fonte desconhecida fica de fora, que é o lado seguro de errar', () => {
    // Inverte a regra anterior de propósito. O extrato é do **jogador**, e o log
    // é do mundo: um sistema novo que registre dinheiro de NPC precisa ficar
    // fora por omissão. Foi somando fonte desconhecida que o resumo de um mês
    // apareceu como −R$ 54,9 milhões.
    const ledger = ledgerFor([entry('sistema-novo', -42)])
    expect(ledger.groups).toHaveLength(0)
    expect(ledger.net).toBe(0)
  })
})
