import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { taylorRate } from '@/engine/macro'
import { amortizingPayment, creditLimitFor, loanRateFor, savingsRateFor } from '@/engine/banking'
import { BANKS, findBank } from '@/data/banks'
import { BANKING, MACRO } from '@/data/config'
import type { CyclePhase } from '@/engine/types'
import { worldTick } from '@/engine/tick'
import { advance, employed, fresh, funded, liveDay, withMacro } from './helpers'

describe('macro', () => {
  it('a Selic sobe quando a inflação estoura a meta', () => {
    const hot = withMacro(fresh(), { inflation: 0.12, inflationTarget: 0.045, outputGap: 0.02 })
    expect(taylorRate(hot.macro)).toBeGreaterThan(hot.macro.selic)

    const after = advance(funded(hot), 200).state
    expect(after.macro.selic).toBeGreaterThan(hot.macro.selic)
  })

  it('a Selic cai quando a economia esfria', () => {
    const cold = withMacro(fresh(), {
      inflation: 0.01,
      cyclePhase: 'recessao',
      outputGap: -0.03,
      selic: 0.14,
    })
    const after = advance(funded(cold), 300).state
    expect(after.macro.selic).toBeLessThan(0.14)
  })

  it('mantém Selic e inflação dentro dos limites em 3650 dias', () => {
    let state = funded(fresh())
    let minSelic = Infinity
    let maxSelic = -Infinity
    for (let i = 0; i < 1800; i += 1) {
      state = liveDay(state).state
      minSelic = Math.min(minSelic, state.macro.selic)
      maxSelic = Math.max(maxSelic, state.macro.selic)
      expect(Number.isFinite(state.macro.inflation)).toBe(true)
    }
    expect(minSelic).toBeGreaterThanOrEqual(MACRO.selicMin)
    expect(maxSelic).toBeLessThanOrEqual(MACRO.selicMax)
    expect(state.macro.inflation).toBeGreaterThanOrEqual(MACRO.inflationMin)
    expect(state.macro.inflation).toBeLessThanOrEqual(MACRO.inflationMax)
  })

  it('percorre as quatro fases do ciclo em 10 anos', () => {
    let state = funded(fresh())
    const seen = new Set<CyclePhase>()
    // Aqui o horizonte **é** o teste: o ciclo completo leva de 2 a 7 anos.
    for (let i = 0; i < 3650; i += 1) {
      state = liveDay(state).state
      seen.add(state.macro.cyclePhase)
    }
    expect(seen.size).toBe(4)
  })

  it('o índice de preços acompanha a inflação', () => {
    const state = advance(funded(withMacro(fresh(), { inflation: 0.1 })), 365).state
    // Inflação passeia, então a checagem é de ordem de grandeza, não exata.
    expect(state.macro.priceLevel).toBeGreaterThan(1.03)
    expect(state.macro.priceLevel).toBeLessThan(1.2)
  })

  it('o custo de vida sobe junto com os preços', () => {
    const base = employed(fresh(), 5000, 100_000_000)
    const early = advance(base, 40)
    const earlyBill = early.entries.find((e) => e.text.includes('Contas do mês'))

    const later = advance(early.state, 2200)
    const lateBill = [...later.entries].reverse().find((e) => e.text.includes('Contas do mês'))

    expect(earlyBill?.amount).toBeDefined()
    expect(lateBill?.amount).toBeDefined()
    expect(Math.abs(lateBill!.amount!)).toBeGreaterThan(Math.abs(earlyBill!.amount!) * 1.2)
  })
})

describe('aplicações', () => {
  it('rendem fração da Selic, e a Selic manda no rendimento', () => {
    const apply = (selic: number): number => {
      let state = withMacro(employed(fresh()), { selic, inflation: 0.04 })
      // Congela o banco central para isolar o efeito da Selic no rendimento.
      state = { ...state, macro: { ...state.macro, nextMeetingDayIndex: 999_999 } }
      state = applyAction(state, { kind: 'aplicar', bankId: 'povo', amount: 10_000 }).state
      const after = advance(state, 365).state
      return after.banking.accounts[0]?.savings ?? 0
    }

    const low = apply(0.04)
    const high = apply(0.14)
    expect(high).toBeGreaterThan(low)

    // 14% × fator 0,70 ≈ 9,8% ao ano.
    const bank = findBank('povo')!
    expect(high / 10_000 - 1).toBeCloseTo(0.14 * bank.savingsFactor, 2)
  })

  it('abre a conta no primeiro depósito e respeita o score mínimo', () => {
    const state = employed(fresh())
    expect(state.banking.accounts).toHaveLength(0)

    const opened = applyAction(state, { kind: 'depositar', bankId: 'povo', amount: 100 }).state
    expect(opened.banking.accounts[0]?.bankId).toBe('povo')

    // Aurora exige 650; o jogador começa com 300.
    const refused = applyAction(state, { kind: 'aplicar', bankId: 'aurora', amount: 100 })
    expect(refused.log[0]?.text).toContain('score')
  })

  it('o CDB prende o dinheiro na carência, e novo aporte não renova a carência', () => {
    let state = employed({ ...fresh(), player: { ...fresh().player, creditScore: 800 } })
    state = applyAction(state, { kind: 'aplicar', bankId: 'aurora', amount: 10_000 }).state

    const locked = applyAction(state, { kind: 'resgatar', bankId: 'aurora', amount: 1000 })
    expect(locked.log[0]?.text).toContain('carência')

    state = advance(state, 40).state
    state = applyAction(state, { kind: 'aplicar', bankId: 'aurora', amount: 5000 }).state
    state = advance(state, 60).state // 100 dias do primeiro aporte

    const freed = applyAction(state, { kind: 'resgatar', bankId: 'aurora', amount: 1000 })
    expect(freed.state.player.money).toBeGreaterThan(state.player.money)
  })
})

describe('crédito', () => {
  it('o custo do empréstimo é Selic + spread + penalidade de score', () => {
    const bank = findBank('povo')!
    const good = { ...employed(fresh()), player: { ...employed(fresh()).player, creditScore: 700 } }
    const bad = { ...employed(fresh()), player: { ...employed(fresh()).player, creditScore: 320 } }

    expect(loanRateFor(good, bank)).toBeCloseTo(good.macro.selic + bank.spread, 4)
    expect(loanRateFor(bad, bank)).toBeGreaterThan(loanRateFor(good, bank))
  })

  it('a Selic muda o custo do crédito', () => {
    const bank = findBank('povo')!
    const cheap = withMacro(employed(fresh()), { selic: 0.03 })
    const dear = withMacro(employed(fresh()), { selic: 0.2 })
    expect(loanRateFor(dear, bank) - loanRateFor(cheap, bank)).toBeCloseTo(0.17, 4)
  })

  it('respeita o limite por múltiplo da renda e exige renda', () => {
    const bank = findBank('povo')!
    const state = employed(fresh(), 5000)
    expect(creditLimitFor(state, bank)).toBe(5000 * bank.incomeMultiple)

    const tooBig = applyAction(state, {
      kind: 'tomarEmprestimo',
      bankId: 'povo',
      loanKind: 'pessoal',
      amount: 5000 * bank.incomeMultiple + 1,
      termDays: 360,
    })
    expect(tooBig.log[0]?.text).toContain('Limite')

    const jobless = applyAction(fresh(), {
      kind: 'tomarEmprestimo',
      bankId: 'povo',
      loanKind: 'pessoal',
      amount: 1000,
      termDays: 360,
    })
    expect(jobless.log[0]?.text).toContain('renda')
  })

  it('a parcela amortiza a dívida até zero no prazo, cobrando juros', () => {
    let state = employed(fresh(), 5000, 200_000)
    state = applyAction(state, {
      kind: 'tomarEmprestimo',
      bankId: 'povo',
      loanKind: 'pessoal',
      amount: 10_000,
      termDays: 360,
    }).state

    const loan = state.banking.loans[0]!
    expect(loan.dailyPayment * 360).toBeGreaterThan(10_000)
    expect(loan.dailyPayment).toBeCloseTo(amortizingPayment(10_000, loan.rate, 360), 6)

    const after = advance(state, 361).state
    expect(after.banking.loans).toHaveLength(0)
  })

  it('atraso de 30 dias derruba o score', () => {
    let state = employed(fresh(), 5000, 20_000)
    state = applyAction(state, {
      kind: 'tomarEmprestimo',
      bankId: 'povo',
      loanKind: 'pessoal',
      amount: 15_000,
      termDays: 360,
    }).state

    // A regra é testada no ponto exato em que ela dispara. Simular dois meses
    // de inadimplência não serve: sem caixa o jogador morre de fome antes, e
    // qualquer evento que pingue dinheiro paga uma parcela e zera o contador.
    const loan = state.banking.loans[0]!
    state = {
      ...state,
      player: {
        ...state.player,
        money: 0,
        currentJobId: null,
        career: { ...state.player.career, jobId: null, salary: 0 },
      },
      banking: {
        ...state.banking,
        loans: [{ ...loan, daysOverdue: BANKING.scoreLateAfterDays - 1 }],
      },
    }
    const before = state.player.creditScore

    const after = worldTick(state, 1).state
    expect(after.banking.loans[0]!.daysOverdue).toBe(BANKING.scoreLateAfterDays)
    expect(before - after.player.creditScore).toBeGreaterThanOrEqual(BANKING.scoreLatePenalty)
  })

  it('a recuperação passiva de score para no teto sem histórico de crédito', () => {
    const state = advance(employed(fresh(), 5000, 500_000), 1800).state
    expect(state.player.creditScore).toBe(BANKING.scoreCleanRecoveryCeiling)
  })
})

describe('cartão de crédito', () => {
  it('cobre a conta que o caixa não paga e cobra rotativo', () => {
    let state = employed(fresh(), 5000, 0)
    state = { ...state, player: { ...state.player, creditScore: 600 } }
    state = applyAction(state, { kind: 'contratarCartao', bankId: 'meridiano' }).state
    expect(state.banking.cards[0]?.limit).toBe(5000 * findBank('meridiano')!.cardLimitMultiple)

    // Sem emprego e com caixa só para comer, o cartão absorve a conta do mês.
    // (Dinheiro zerado não serve: o jogador morre de fome antes do dia 10 do
    // segundo mês, que é quando a primeira conta vence.)
    state = {
      ...state,
      player: {
        ...state.player,
        money: 1200,
        currentJobId: null,
        career: { ...state.player.career, salary: 0 },
      },
    }
    state = advance(state, 45).state
    expect(state.banking.cards[0]!.balance).toBeGreaterThan(0)
    expect(state.player.overdueBills).toBe(0)

    // E o saldo do cartão cresce sozinho enquanto não é pago.
    const balance = state.banking.cards[0]!.balance
    const later = advance(state, 10).state
    expect(later.banking.cards[0]!.balance).toBeGreaterThan(balance)
  })
})

describe('cobertura dos bancos', () => {
  it('todo banco tem rendimento abaixo da Selic e spread positivo', () => {
    const state = fresh()
    for (const bank of BANKS) {
      expect(bank.savingsFactor).toBeLessThan(1)
      expect(savingsRateFor(state, bank)).toBeLessThan(state.macro.selic)
      expect(bank.spread).toBeGreaterThan(0)
    }
  })
})
