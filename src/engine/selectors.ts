/**
 * Derivações do estado. TypeScript puro, sem memoização (o estado é imutável e a
 * UI recalcula por render). Só entra aqui o que tem pelo menos dois consumidores
 * concretos hoje (spec §10.6).
 */
import type { GameState } from './types'

/** Caixa em conta corrente + aplicações, somando todos os bancos. */
export function bankBalance(state: GameState): number {
  let total = 0
  for (const account of state.banking.accounts) {
    total += account.checking + account.savings
  }
  return total
}

/** Valor de mercado da carteira de ações, a preço de fechamento de hoje. */
export function portfolioValue(state: GameState): number {
  let total = 0
  for (const companyId of state.market.positionOrder) {
    const position = state.market.positions[companyId]
    const company = state.companies[companyId]
    if (!position || !company?.stock) continue
    total += position.shares * company.stock.price
  }
  return total
}

/** Valor das empresas controladas pelo jogador, pela participação que ele detém. */
export function privateHoldingsValue(state: GameState): number {
  let total = 0
  for (const companyId of state.companyOrder) {
    const company = state.companies[companyId]
    if (!company || company.isPublic) continue
    const shares = company.ownership.reduce(
      (sum, entry) => (entry.holderId === 'player' ? sum + entry.shares : sum),
      0,
    )
    const totalShares = company.ownership.reduce((sum, entry) => sum + entry.shares, 0)
    if (totalShares <= 0) continue
    const equity = Math.max(0, company.cash - company.debt)
    total += (shares / totalShares) * equity
  }
  return total
}

/** Soma das dívidas pessoais: empréstimos, cartão e pendência de imposto. */
export function totalDebt(state: GameState): number {
  let total = 0
  for (const loan of state.banking.loans) {
    if (loan.borrower === 'player') total += loan.remaining
  }
  for (const card of state.banking.cards) total += card.balance
  for (const debt of state.market.taxDebts) total += debt.amount + debt.penalty
  return total
}

/** Patrimônio líquido. */
export function netWorth(state: GameState): number {
  const assets = state.personalAssets.assets.reduce((sum, asset) => sum + asset.currentValue, 0)
  return (
    state.player.money +
    bankBalance(state) +
    portfolioValue(state) +
    privateHoldingsValue(state) +
    assets -
    totalDebt(state)
  )
}

/** Renda diária recorrente: salário rateado + aluguéis recebidos. */
export function dailyIncome(state: GameState): number {
  const salary = state.player.career.salary / 30
  const rents = state.personalAssets.assets.reduce((sum, asset) => sum + asset.monthlyIncome / 30, 0)
  return salary + rents
}
