/**
 * Passo 7 do tick: juros de aplicações e dívidas, parcelas, score.
 * TypeScript puro.
 *
 * Tudo aqui é função da Selic: o rendimento da aplicação é `selic × fator do
 * banco`, e o custo do empréstimo é `selic + spread + penalidade de score`. É o
 * que faz o passo `macro` ser sentido no bolso do jogador (spec §5.4).
 */
import type { BankAccount, GameState, Loan, LogEntry } from './types'
import type { DayMarkers } from './clock'
import { BANKING } from '../data/config'
import { findBank, type BankDefinition } from '../data/banks'

function clampScore(value: number): number {
  return Math.min(BANKING.scoreMax, Math.max(BANKING.scoreMin, value))
}

/** Converte taxa anual em taxa diária equivalente composta. */
export function dailyRate(annualRate: number): number {
  return (1 + annualRate) ** (1 / 365) - 1
}

/** Rendimento anual oferecido por um banco, dada a Selic de hoje. */
export function savingsRateFor(state: GameState, bank: BankDefinition): number {
  return state.macro.selic * bank.savingsFactor
}

/**
 * Custo do empréstimo: Selic + spread do banco + penalidade proporcional à
 * distância do score de referência. Score ruim não bloqueia, encarece.
 */
export function loanRateFor(state: GameState, bank: BankDefinition): number {
  const gap = Math.max(0, BANKING.scoreRateReference - state.player.creditScore)
  const penalty = (gap / BANKING.scoreRateReference) * BANKING.scoreRatePenaltyMax
  return state.macro.selic + bank.spread + penalty
}

/** Renda mensal considerada pelo banco: salário mais aluguéis recebidos. */
export function monthlyIncome(state: GameState): number {
  const rents = state.personalAssets.assets.reduce((sum, asset) => sum + asset.monthlyIncome, 0)
  return state.player.career.salary + rents
}

/** Teto de crédito do banco, já descontado o que o jogador já deve a ele. */
export function creditLimitFor(state: GameState, bank: BankDefinition): number {
  const limit = monthlyIncome(state) * bank.incomeMultiple
  const outstanding = state.banking.loans
    .filter((loan) => loan.bankId === bank.id && loan.borrower === 'player')
    .reduce((sum, loan) => sum + loan.remaining, 0)
  return Math.max(0, limit - outstanding)
}

/** Parcela diária que amortiza `principal` em `termDays` à taxa dada. */
export function amortizingPayment(principal: number, annualRate: number, termDays: number): number {
  const r = dailyRate(annualRate)
  if (r <= 0) return principal / termDays
  return (principal * r) / (1 - (1 + r) ** -termDays)
}

export function findAccount(state: GameState, bankId: string): BankAccount | null {
  return state.banking.accounts.find((account) => account.bankId === bankId) ?? null
}

/** Saldo líquido disponível: caixa na mão mais conta corrente. */
export function availableCash(state: GameState): number {
  return state.player.money + state.banking.accounts.reduce((sum, a) => sum + a.checking, 0)
}

/**
 * Debita um valor do caixa e, se faltar, das contas correntes. Devolve o que
 * não conseguiu pagar. Usado por contas de casa, parcelas e fatura.
 */
export function debit(draft: GameState, amount: number): number {
  let remaining = amount

  // **Conta corrente primeiro, caixa depois.** Ninguém paga o aluguel com o
  // dinheiro do almoço: com a ordem invertida, as contas do mês esvaziavam o
  // caixa e o jogador ficava sem o que comer com saldo no banco — o `pricewar`
  // atravessou dez anos com saúde média de 6,8 por causa disso.
  for (const account of draft.banking.accounts) {
    if (remaining <= 0) break
    const fromChecking = Math.min(account.checking, remaining)
    account.checking -= fromChecking
    remaining -= fromChecking
  }

  const fromCash = Math.min(draft.player.money, remaining)
  draft.player.money -= fromCash
  remaining -= fromCash

  return remaining
}

function accrueSavings(draft: GameState): void {
  for (const account of draft.banking.accounts) {
    if (account.savings <= 0) continue
    const bank = findBank(account.bankId)
    if (!bank) continue
    account.savingsRate = draft.macro.selic * bank.savingsFactor
    account.savings *= 1 + dailyRate(account.savingsRate)
  }
}

function chargeLoan(draft: GameState, loan: Loan, log: LogEntry[]): void {
  const r = dailyRate(loan.rate)
  loan.remaining *= 1 + r

  const due = Math.min(loan.dailyPayment, loan.remaining)
  const unpaid = debit(draft, due)

  if (unpaid > 0.005) {
    loan.daysOverdue += 1
    draft.player.creditScore = clampScore(draft.player.creditScore - 0.5)
    if (loan.daysOverdue === BANKING.scoreLateAfterDays) {
      draft.banking.paymentsLate += 1
      draft.player.creditScore = clampScore(draft.player.creditScore - BANKING.scoreLatePenalty)
      draft.player.publicReputation = Math.max(-100, draft.player.publicReputation - 2)
      log.push({
        id: `loan-late-${loan.id}-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: 'ruim',
        source: 'banking',
        text: 'Empréstimo em atraso há 30 dias: seu score despencou.',
        amount: null,
      })
    }
    // O que não foi pago volta para o saldo devedor.
    loan.remaining += unpaid
    return
  }

  loan.remaining -= due - unpaid
  loan.daysOverdue = 0
  draft.banking.paymentsOnTime += 1
  draft.player.creditScore = clampScore(
    draft.player.creditScore + BANKING.scoreOnTimePaymentPerDay,
  )
}

function settleLoans(draft: GameState, log: LogEntry[]): void {
  const settled = draft.banking.loans.filter((loan) => loan.remaining <= 0.01)
  for (const loan of settled) {
    draft.player.creditScore = clampScore(
      draft.player.creditScore + BANKING.scoreLoanSettledBonus,
    )
    log.push({
      id: `loan-done-${loan.id}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'banking',
      text: 'Empréstimo quitado.',
      amount: null,
    })
  }
  if (settled.length > 0) {
    draft.banking.loans = draft.banking.loans.filter((loan) => loan.remaining > 0.01)
  }
}

/** Fatura do cartão: cobra o que dá, o resto entra no rotativo punitivo. */
function chargeCards(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  for (const card of draft.banking.cards) {
    if (card.balance <= 0) continue

    if (draft.date.day === card.statementDay) {
      const unpaid = debit(draft, card.balance)
      const paid = card.balance - unpaid
      card.balance = unpaid
      if (paid > 0) {
        log.push({
          id: `card-${card.bankId}-${draft.date.dayIndex}`,
          dayIndex: draft.date.dayIndex,
          severity: unpaid > 0 ? 'ruim' : 'info',
          source: 'banking',
          text: unpaid > 0 ? 'Fatura paga parcialmente: entrou no rotativo.' : 'Fatura paga.',
          amount: -paid,
        })
      }
    } else {
      // Rotativo composto diariamente.
      card.balance *= 1 + (1 + card.revolvingMonthlyRate) ** (1 / 30) - 1
    }
  }
  void markers
}

/** Alavancagem acima do permitido corrói o score todo dia. */
function scoreMaintenance(draft: GameState): void {
  const income = monthlyIncome(draft)
  const debt =
    draft.banking.loans.reduce((sum, loan) => sum + loan.remaining, 0) +
    draft.banking.cards.reduce((sum, card) => sum + card.balance, 0)

  const overdue = draft.player.overdueBills > 0 || draft.banking.loans.some((l) => l.daysOverdue > 0)

  if (income > 0) {
    const leverage = debt / income
    const excess = Math.max(0, leverage - BANKING.leverageFreeMultiple)
    if (excess > 0) {
      draft.player.creditScore = clampScore(
        draft.player.creditScore - excess * 0.1 * BANKING.scoreLeveragePenaltyPerStep,
      )
    }
  }

  // Recuperação de quem está em dia. Sem isso, quem atrasa uma conta no começo
  // da partida chega à Fase 3 com o score arruinado e sem caminho de volta.
  if (!overdue && draft.player.creditScore < BANKING.scoreCleanRecoveryCeiling) {
    draft.player.creditScore = Math.min(
      BANKING.scoreCleanRecoveryCeiling,
      clampScore(draft.player.creditScore + BANKING.scoreCleanRecoveryPerDay),
    )
  }
}

/** Parcela de empréstimo empresarial: sai do caixa da empresa, não do bolso. */
function chargeCompanyLoan(draft: GameState, loan: Loan): void {
  const company = draft.companies[loan.borrower]
  if (!company) return
  const r = dailyRate(loan.rate)
  loan.remaining *= 1 + r
  const due = Math.min(loan.dailyPayment, loan.remaining)
  company.cash -= due
  loan.remaining -= due
  if (loan.remaining <= 0.01) company.debt = Math.max(0, company.debt - loan.principal)
}

export function stepBanking(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  accrueSavings(draft)
  for (const loan of draft.banking.loans) {
    if (loan.borrower === 'player') chargeLoan(draft, loan, log)
    else chargeCompanyLoan(draft, loan)
  }
  settleLoans(draft, log)
  chargeCards(draft, markers, log)
  scoreMaintenance(draft)
}
