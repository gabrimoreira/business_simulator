/**
 * Os quatro bancos da tabela de `docs/GAME_DESIGN.md §3.8`.
 *
 * O `savingsFactor` é fração da Selic — nunca 1. Renda fixa sem risco rendendo a
 * Selic cheia tornaria "não jogar" uma estratégia viável (risco 1 do §4).
 */

export interface BankDefinition {
  id: string
  name: string
  /** Fração da Selic paga na aplicação. */
  savingsFactor: number
  /** Score mínimo para abrir conta e tomar crédito. */
  minScore: number
  /** Somado à Selic no custo do empréstimo. */
  spread: number
  /** Limite de crédito como múltiplo da renda mensal. */
  incomeMultiple: number
  /** Carência da aplicação, em dias. 0 = liquidez diária. */
  lockDays: number
  /** Limite do cartão como múltiplo da renda mensal. */
  cardLimitMultiple: number
  /** Rotativo, ao mês. */
  cardMonthlyRate: number
}

export const BANKS: BankDefinition[] = [
  {
    id: 'raiz',
    name: 'Cooperativa Raiz',
    savingsFactor: 0.75,
    minScore: 200,
    spread: 0.26,
    incomeMultiple: 1.5,
    lockDays: 0,
    cardLimitMultiple: 0.4,
    cardMonthlyRate: 0.14,
  },
  {
    id: 'povo',
    name: 'Banco do Povo',
    savingsFactor: 0.7,
    minScore: 300,
    spread: 0.18,
    incomeMultiple: 3,
    lockDays: 0,
    cardLimitMultiple: 0.8,
    cardMonthlyRate: 0.14,
  },
  {
    id: 'meridiano',
    name: 'Banco Meridiano',
    savingsFactor: 0.8,
    minScore: 500,
    spread: 0.12,
    incomeMultiple: 8,
    lockDays: 0,
    cardLimitMultiple: 1.5,
    cardMonthlyRate: 0.12,
  },
  {
    id: 'aurora',
    name: 'Aurora Investimentos',
    savingsFactor: 0.92,
    minScore: 650,
    spread: 0.08,
    incomeMultiple: 20,
    /** CDB com carência: rende mais, mas prende o dinheiro por 90 dias. */
    lockDays: 90,
    cardLimitMultiple: 3,
    cardMonthlyRate: 0.1,
  },
]

export function findBank(id: string): BankDefinition | null {
  return BANKS.find((bank) => bank.id === id) ?? null
}
